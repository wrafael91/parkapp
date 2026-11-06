import { afterAll, describe, expect, it } from "vitest";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { hashPassword } from "./password.js";
import { hashSessionToken } from "./session-token.js";
import { signIn } from "./session.service.js";

const prisma = createPrismaClient(config.databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
});

class Rollback extends Error {}

// Runs a test as parkapp_app, the API's database role, and always rolls back.
// A missing grant fails here instead of in AWS (S2-19).
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

const EMAIL = "admin.sesiones@example.com";
const PASSWORD = "una frase de paso bastante larga";
const IP = "203.0.113.10";
const NOW = new Date("2026-11-05T13:00:00.000Z");
const MINUTE = 60_000;

async function createUser(db: Prisma.TransactionClient, active = true) {
  return db.user.create({
    data: {
      name: "Administradora de prueba",
      email: EMAIL,
      passwordHash: await hashPassword(PASSWORD),
      role: "ADMINISTRATOR",
      active,
    },
  });
}

function auditEvents(db: Prisma.TransactionClient) {
  return db.auditEvent.findMany({ where: { ip: IP }, orderBy: { id: "asc" } });
}

describe("signIn (FR-01, NFR-04)", () => {
  it("creates a session that stores only the token hash and lasts 12 hours", async () => {
    await asApp(async (db) => {
      const user = await createUser(db);

      const result = await signIn(db, { email: EMAIL, password: PASSWORD, ip: IP, now: NOW });

      if (!result.ok) throw new Error("sign-in failed");
      const session = await db.session.findUniqueOrThrow({
        where: { tokenHash: hashSessionToken(result.token) },
      });
      expect(session.userId).toBe(user.id);
      expect(session.ip).toBe(IP);
      expect(session.expiresAt).toEqual(new Date(NOW.getTime() + 12 * 60 * MINUTE));
      expect(result.user).toEqual({
        id: user.id,
        name: "Administradora de prueba",
        role: "ADMINISTRATOR",
        mustChangePassword: true,
      });
      const [event] = await auditEvents(db);
      expect(event).toMatchObject({
        action: "LOGIN_SUCCEEDED",
        userId: user.id,
        entity: "sesion",
        entityId: session.id,
      });
    });
  });

  it("ignores uppercase letters and spaces around the email (RI-15)", async () => {
    await asApp(async (db) => {
      await createUser(db);

      const result = await signIn(db, {
        email: "  Admin.Sesiones@Example.com ",
        password: PASSWORD,
        ip: IP,
        now: NOW,
      });

      expect(result.ok).toBe(true);
    });
  });

  it.each([
    ["a wrong password", true, EMAIL, `${PASSWORD}!`, "CREDENCIALES_INVALIDAS"],
    ["a deactivated account", false, EMAIL, PASSWORD, "CUENTA_DESACTIVADA"],
    ["an unknown email", true, "nadie@example.com", PASSWORD, "CUENTA_INEXISTENTE"],
  ])("rejects %s and records why", async (_case, active, email, password, reason) => {
    await asApp(async (db) => {
      const user = await createUser(db, active);

      const result = await signIn(db, { email, password, ip: IP, now: NOW });

      expect(result).toEqual({ ok: false });
      expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
      const [event] = await auditEvents(db);
      expect(event).toMatchObject({
        action: "LOGIN_FAILED",
        userId: null,
        entity: reason === "CUENTA_INEXISTENTE" ? null : "usuario",
        entityId: reason === "CUENTA_INEXISTENTE" ? null : user.id,
        detail: { motivo: reason },
      });
    });
  });

  it("never writes the password or the token to the audit log (RI-14)", async () => {
    await asApp(async (db) => {
      await createUser(db);

      const result = await signIn(db, { email: EMAIL, password: PASSWORD, ip: IP, now: NOW });
      await signIn(db, { email: EMAIL, password: `${PASSWORD}!`, ip: IP, now: NOW });

      if (!result.ok) throw new Error("sign-in failed");
      const logged = JSON.stringify(await auditEvents(db), (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      );
      expect(logged).not.toContain(PASSWORD);
      expect(logged).not.toContain(result.token);
    });
  });
});
