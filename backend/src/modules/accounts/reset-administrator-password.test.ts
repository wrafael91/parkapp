import { afterAll, describe, expect, it } from "vitest";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma, Role } from "../../generated/prisma/client.js";
import { hashPassword, verifyPassword } from "./password.js";
import { resetAdministratorPassword } from "./reset-administrator-password.js";
import { signIn } from "./session.service.js";

const prisma = createPrismaClient(config.databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
});

class Rollback extends Error {}

// Runs a test as parkapp_app, the role the script uses on the server, and
// always rolls back (S2-19).
async function asApp(test: (db: Prisma.TransactionClient) => Promise<void>): Promise<void> {
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE parkapp_app");
        await test(tx);
        throw new Rollback();
      },
      { timeout: 15_000 },
    );
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

const EMAIL = "admin.recuperacion@example.com";
const OLD_PASSWORD = "la frase de paso que se olvido";
const NEW_PASSWORD = "la frase de paso nueva del script";
const EARLIER = new Date("2026-11-26T20:00:00.000Z");
const NOW = new Date("2026-11-26T23:30:00.000Z");
const IP = "203.0.113.30";
const INPUT = { email: EMAIL, password: NEW_PASSWORD, now: NOW };

// An account that already changed its password and is locked, so the test can
// see that the reset changes both.
async function account(db: Prisma.TransactionClient, email: string, role: Role) {
  return db.user.create({
    data: {
      name: "Cuenta de prueba",
      email,
      passwordHash: await hashPassword(OLD_PASSWORD),
      role,
      mustChangePassword: false,
      lockedUntil: new Date(NOW.getTime() + 15 * 60_000),
    },
  });
}

async function openSession(db: Prisma.TransactionClient, userId: number, tokenHash: string) {
  return db.session.create({
    data: { userId, tokenHash, ip: IP, expiresAt: new Date(NOW.getTime() + 60 * 60_000) },
  });
}

describe("resetAdministratorPassword (recovery script, RI-16)", () => {
  it("replaces an administrator's password, which must change, and unlocks the account", async () => {
    await asApp(async (db) => {
      const admin = await account(db, EMAIL, "ADMINISTRATOR");

      const result = await resetAdministratorPassword(db, {
        ...INPUT,
        email: "  Admin.Recuperacion@Example.com ",
      });

      expect(result).toEqual({ ok: true, userId: admin.id });
      const user = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
      expect(user).toMatchObject({
        name: admin.name,
        email: EMAIL,
        role: "ADMINISTRATOR",
        active: true,
        mustChangePassword: true,
        lockedUntil: null,
      });
      // NFR-01: only the Argon2id hash of the new password is stored.
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(await verifyPassword(user.passwordHash, NEW_PASSWORD)).toBe(true);
      expect(await verifyPassword(user.passwordHash, OLD_PASSWORD)).toBe(false);
    });
  });

  it("revokes the open sessions of that account and no other (NFR-04)", async () => {
    await asApp(async (db) => {
      const admin = await account(db, EMAIL, "ADMINISTRATOR");
      const other = await account(db, "otro.admin@example.com", "ADMINISTRATOR");
      const open = await openSession(db, admin.id, "hash-de-prueba-abierta");
      const signedOut = await db.session.update({
        where: { id: (await openSession(db, admin.id, "hash-de-prueba-cerrada")).id },
        data: { revokedAt: EARLIER },
      });
      const otherOpen = await openSession(db, other.id, "hash-de-prueba-de-otra-cuenta");

      await resetAdministratorPassword(db, INPUT);

      const revokedAt = async (id: number) =>
        (await db.session.findUniqueOrThrow({ where: { id } })).revokedAt;
      expect(await revokedAt(open.id)).toEqual(NOW);
      expect(await revokedAt(signedOut.id)).toEqual(EARLIER);
      expect(await revokedAt(otherOpen.id)).toBeNull();
    });
  });

  it("records CONTRASENA_RESTABLECIDA as a system event, without user or IP (RI-18)", async () => {
    await asApp(async (db) => {
      const admin = await account(db, EMAIL, "ADMINISTRATOR");

      await resetAdministratorPassword(db, INPUT);

      const events = await db.auditEvent.findMany({
        where: { action: "PASSWORD_RESET", entity: "usuario", entityId: admin.id },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ userId: null, detail: null, ip: null, occurredAt: NOW });
    });
  });

  it("lets the administrator sign in with the new password and not the old one (FR-01)", async () => {
    await asApp(async (db) => {
      await account(db, EMAIL, "ADMINISTRATOR");

      await resetAdministratorPassword(db, INPUT);

      const attempt = (password: string) =>
        signIn(db, { email: EMAIL, password, ip: IP, now: NOW });
      expect((await attempt(NEW_PASSWORD)).ok).toBe(true);
      expect((await attempt(OLD_PASSWORD)).ok).toBe(false);
    });
  });

  it("answers notFound for an email without an account and changes nothing", async () => {
    await asApp(async (db) => {
      const eventsBefore = await db.auditEvent.count();

      const result = await resetAdministratorPassword(db, INPUT);

      expect(result).toEqual({ ok: false, reason: "notFound" });
      expect(await db.auditEvent.count()).toBe(eventsBefore);
    });
  });
});

describe("resetAdministratorPassword rejects", () => {
  it.each([
    ["shorter than 15", "a".repeat(14)],
    ["longer than 64", "a".repeat(65)],
  ])("a password %s characters and changes nothing (NFR-02)", async (_case, password) => {
    await asApp(async (db) => {
      const admin = await account(db, EMAIL, "ADMINISTRATOR");
      const open = await openSession(db, admin.id, "hash-de-prueba-abierta");
      const eventsBefore = await db.auditEvent.count();

      const result = await resetAdministratorPassword(db, { ...INPUT, password });

      expect(result).toEqual({ ok: false, reason: "passwordLength" });
      expect(await db.user.findUniqueOrThrow({ where: { id: admin.id } })).toEqual(admin);
      expect((await db.session.findUniqueOrThrow({ where: { id: open.id } })).revokedAt).toBeNull();
      expect(await db.auditEvent.count()).toBe(eventsBefore);
    });
  });

  it("an operator account, whose password an administrator resets from the app (FR-05)", async () => {
    await asApp(async (db) => {
      const operator = await account(db, "operador.recuperacion@example.com", "OPERATOR");
      const open = await openSession(db, operator.id, "hash-de-prueba-del-operador");
      const eventsBefore = await db.auditEvent.count();

      const result = await resetAdministratorPassword(db, { ...INPUT, email: operator.email });

      expect(result).toEqual({ ok: false, reason: "notAdministrator" });
      expect(await db.user.findUniqueOrThrow({ where: { id: operator.id } })).toEqual(operator);
      expect((await db.session.findUniqueOrThrow({ where: { id: open.id } })).revokedAt).toBeNull();
      expect(await db.auditEvent.count()).toBe(eventsBefore);
    });
  });
});
