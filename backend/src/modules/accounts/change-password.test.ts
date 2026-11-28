import { afterAll, describe, expect, it } from "vitest";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { changeOwnPassword } from "./change-password.js";
import { hashPassword, verifyPassword } from "./password.js";
import { hashSessionToken } from "./session-token.js";

const prisma = createPrismaClient(config.databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
});

class Rollback extends Error {}

// Runs a test as parkapp_app, the role of the API, and always rolls back
// (S2-19).
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

const CURRENT_PASSWORD = "la contrasena que asigno otra persona";
const NEW_PASSWORD = "una frase de paso que solo yo conozco";
const TOKEN = "token-de-la-sesion-que-cambia";
const EARLIER = new Date("2026-11-28T14:00:00.000Z");
const NOW = new Date("2026-11-28T15:00:00.000Z");
const IP = "203.0.113.40";

// An account whose password someone else assigned (RI-16).
async function account(db: Prisma.TransactionClient, email = "operador.cambio@example.com") {
  return db.user.create({
    data: {
      name: "Cuenta de prueba",
      email,
      passwordHash: await hashPassword(CURRENT_PASSWORD),
      role: "OPERATOR",
      mustChangePassword: true,
    },
  });
}

async function openSession(db: Prisma.TransactionClient, userId: number, tokenHash: string) {
  return db.session.create({
    data: { userId, tokenHash, ip: IP, expiresAt: new Date(NOW.getTime() + 60 * 60_000) },
  });
}

function input(userId: number) {
  return {
    userId,
    token: TOKEN,
    currentPassword: CURRENT_PASSWORD,
    newPassword: NEW_PASSWORD,
    ip: IP,
    now: NOW,
  };
}

describe("changeOwnPassword (US-05, RI-16)", () => {
  it("replaces the password and clears the pending change", async () => {
    await asApp(async (db) => {
      const user = await account(db);

      const result = await changeOwnPassword(db, input(user.id));

      expect(result).toEqual({ ok: true });
      const changed = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(changed).toMatchObject({ mustChangePassword: false, active: true, role: "OPERATOR" });
      // NFR-01: only the Argon2id hash of the new password is stored.
      expect(changed.passwordHash).toMatch(/^\$argon2id\$/);
      expect(await verifyPassword(changed.passwordHash, NEW_PASSWORD)).toBe(true);
      expect(await verifyPassword(changed.passwordHash, CURRENT_PASSWORD)).toBe(false);
    });
  });

  it("revokes the other open sessions of the account and keeps the current one (NFR-04)", async () => {
    await asApp(async (db) => {
      const user = await account(db);
      const other = await account(db, "otro.operador@example.com");
      const current = await openSession(db, user.id, hashSessionToken(TOKEN));
      const elsewhere = await openSession(db, user.id, "hash-de-otra-sesion-abierta");
      const signedOut = await db.session.update({
        where: { id: (await openSession(db, user.id, "hash-de-una-sesion-cerrada")).id },
        data: { revokedAt: EARLIER },
      });
      const otherOpen = await openSession(db, other.id, "hash-de-la-otra-cuenta");

      await changeOwnPassword(db, input(user.id));

      const revokedAt = async (id: number) =>
        (await db.session.findUniqueOrThrow({ where: { id } })).revokedAt;
      expect(await revokedAt(current.id)).toBeNull();
      expect(await revokedAt(elsewhere.id)).toEqual(NOW);
      expect(await revokedAt(signedOut.id)).toEqual(EARLIER);
      expect(await revokedAt(otherOpen.id)).toBeNull();
    });
  });

  it("records CONTRASENA_CAMBIADA with the user and the IP, without detail (RI-14)", async () => {
    await asApp(async (db) => {
      const user = await account(db);

      await changeOwnPassword(db, input(user.id));

      const events = await db.auditEvent.findMany({
        where: { action: "PASSWORD_CHANGED", entity: "usuario", entityId: user.id },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ userId: user.id, ip: IP, detail: null, occurredAt: NOW });
    });
  });
});

describe("changeOwnPassword rejects, and changes nothing,", () => {
  it.each([
    ["a wrong current password", { currentPassword: `${CURRENT_PASSWORD}!` }, "wrongPassword"],
    [
      "a new password shorter than 15 characters",
      { newPassword: "a".repeat(14) },
      "passwordLength",
    ],
    ["a new password longer than 64 characters", { newPassword: "a".repeat(65) }, "passwordLength"],
    // RI-16: whoever assigned it would still know it.
    ["a new password equal to the current one", { newPassword: CURRENT_PASSWORD }, "samePassword"],
  ])("%s", async (_case, change, reason) => {
    await asApp(async (db) => {
      const user = await account(db);
      const elsewhere = await openSession(db, user.id, "hash-de-otra-sesion-abierta");
      const eventsBefore = await db.auditEvent.count();

      const result = await changeOwnPassword(db, { ...input(user.id), ...change });

      expect(result).toEqual({ ok: false, reason });
      expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toEqual(user);
      expect(
        (await db.session.findUniqueOrThrow({ where: { id: elsewhere.id } })).revokedAt,
      ).toBeNull();
      expect(await db.auditEvent.count()).toBe(eventsBefore);
    });
  });
});
