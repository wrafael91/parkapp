import { afterAll, describe, expect, it } from "vitest";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { createOperator, setAccountActive } from "./operator-accounts.js";
import { verifyPassword } from "./password.js";
import { authenticate, signIn } from "./session.service.js";

const prisma = createPrismaClient(config.databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
});

class Rollback extends Error {}

// Runs a test as parkapp_app, the role of the API, and always rolls back.
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

const IP = "203.0.113.30";
const NOW = new Date("2026-11-16T02:00:00.000Z");
const EMAIL = "operador.cuentas@example.com";
const PASSWORD = "la contraseña inicial del operador";

async function administrator(db: Prisma.TransactionClient) {
  return db.user.create({
    data: {
      name: "Administrador de cuentas",
      email: "admin.cuentas@example.com",
      passwordHash: "not-a-real-hash",
      role: "ADMINISTRATOR",
    },
  });
}

async function operator(db: Prisma.TransactionClient, adminId: number) {
  const result = await createOperator(db, {
    name: "Operador de cuentas",
    email: EMAIL,
    password: PASSWORD,
    now: NOW,
    createdBy: { userId: adminId, ip: IP },
  });
  if (!result.ok) throw new Error("setup failed");
  return result.userId;
}

describe("createOperator (US-02, FR-03)", () => {
  it("creates an active operator who must change the password (RI-16)", async () => {
    await asApp(async (db) => {
      const admin = await administrator(db);

      const result = await createOperator(db, {
        name: "  Operador de cuentas ",
        email: "  Operador.Cuentas@Example.com ",
        password: PASSWORD,
        now: NOW,
        createdBy: { userId: admin.id, ip: IP },
      });

      if (!result.ok) throw new Error("account not created");
      const user = await db.user.findUniqueOrThrow({ where: { id: result.userId } });
      // RI-15: the email is stored in lowercase, without spaces.
      expect(user).toMatchObject({
        name: "Operador de cuentas",
        email: EMAIL,
        role: "OPERATOR",
        active: true,
        mustChangePassword: true,
        createdAt: NOW,
      });
      // NFR-01: only the Argon2id hash is stored.
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(await verifyPassword(user.passwordHash, PASSWORD)).toBe(true);
    });
  });

  it("records CUENTA_CREADA with the administrator and the IP, without the password", async () => {
    await asApp(async (db) => {
      const admin = await administrator(db);

      const userId = await operator(db, admin.id);

      const events = await db.auditEvent.findMany({
        where: { action: "ACCOUNT_CREATED", entity: "usuario", entityId: userId },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ userId: admin.id, ip: IP, detail: null, occurredAt: NOW });
    });
  });

  it("creates an account that can sign in (FR-01)", async () => {
    await asApp(async (db) => {
      const admin = await administrator(db);
      await operator(db, admin.id);

      const result = await signIn(db, { email: EMAIL, password: PASSWORD, ip: IP, now: NOW });

      expect(result.ok).toBe(true);
    });
  });

  it.each([
    ["shorter than 15", "a".repeat(14)],
    ["longer than 64", "a".repeat(65)],
  ])("rejects a password %s characters and creates nothing (NFR-02)", async (_case, password) => {
    await asApp(async (db) => {
      const admin = await administrator(db);
      const eventsBefore = await db.auditEvent.count();

      const result = await createOperator(db, {
        name: "Operador",
        email: EMAIL,
        password,
        now: NOW,
        createdBy: { userId: admin.id, ip: IP },
      });

      expect(result).toEqual({ ok: false, reason: "passwordLength" });
      expect(await db.user.findUnique({ where: { email: EMAIL } })).toBeNull();
      expect(await db.auditEvent.count()).toBe(eventsBefore);
    });
  });

  it("rejects an email already in use, whatever its capitals and spaces (RI-15)", async () => {
    await asApp(async (db) => {
      const admin = await administrator(db);
      await operator(db, admin.id);
      const eventsBefore = await db.auditEvent.count();

      const result = await createOperator(db, {
        name: "Otra persona",
        email: " OPERADOR.cuentas@example.com",
        password: PASSWORD,
        now: NOW,
        createdBy: { userId: admin.id, ip: IP },
      });

      expect(result).toEqual({ ok: false, reason: "emailInUse" });
      expect(await db.user.count({ where: { email: EMAIL } })).toBe(1);
      expect(await db.auditEvent.count()).toBe(eventsBefore);
    });
  });
});

describe("setAccountActive (US-03, FR-04)", () => {
  const LATER = new Date("2026-11-16T03:00:00.000Z");

  it("deactivates an operator, revokes the open sessions and records it (NFR-04)", async () => {
    await asApp(async (db) => {
      const admin = await administrator(db);
      const userId = await operator(db, admin.id);
      const signedIn = await signIn(db, { email: EMAIL, password: PASSWORD, ip: IP, now: LATER });
      if (!signedIn.ok) throw new Error("setup failed");

      const result = await setAccountActive(db, {
        userId,
        active: false,
        now: LATER,
        changedBy: { userId: admin.id, ip: IP },
      });

      expect(result).toEqual({ ok: true });
      expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).active).toBe(false);
      const sessions = await db.session.findMany({ where: { userId } });
      expect(sessions.map((session) => session.revokedAt)).toEqual([LATER]);
      const events = await db.auditEvent.findMany({
        where: { action: "ACCOUNT_DEACTIVATED", entity: "usuario", entityId: userId },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ userId: admin.id, ip: IP, occurredAt: LATER });
    });
  });

  it("reactivates an operator without reviving the sessions revoked before", async () => {
    await asApp(async (db) => {
      const admin = await administrator(db);
      const userId = await operator(db, admin.id);
      const signedIn = await signIn(db, { email: EMAIL, password: PASSWORD, ip: IP, now: LATER });
      if (!signedIn.ok) throw new Error("setup failed");
      const changedBy = { userId: admin.id, ip: IP };
      await setAccountActive(db, { userId, active: false, now: LATER, changedBy });

      const result = await setAccountActive(db, { userId, active: true, now: LATER, changedBy });

      expect(result).toEqual({ ok: true });
      expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).active).toBe(true);
      // The old token stays revoked; signing in again works.
      expect(await authenticate(db, { token: signedIn.token, now: LATER })).toBeNull();
      expect((await signIn(db, { email: EMAIL, password: PASSWORD, ip: IP, now: LATER })).ok).toBe(
        true,
      );
      const events = await db.auditEvent.count({
        where: { action: "ACCOUNT_REACTIVATED", entity: "usuario", entityId: userId },
      });
      expect(events).toBe(1);
    });
  });

  it("keeps the sessions of other accounts open", async () => {
    await asApp(async (db) => {
      const admin = await administrator(db);
      const userId = await operator(db, admin.id);
      const other = await createOperator(db, {
        name: "Otro operador",
        email: "otro.operador@example.com",
        password: PASSWORD,
        now: NOW,
        createdBy: { userId: admin.id, ip: IP },
      });
      if (!other.ok) throw new Error("setup failed");
      const otherSession = await signIn(db, {
        email: "otro.operador@example.com",
        password: PASSWORD,
        ip: IP,
        now: LATER,
      });
      if (!otherSession.ok) throw new Error("setup failed");

      await setAccountActive(db, {
        userId,
        active: false,
        now: LATER,
        changedBy: { userId: admin.id, ip: IP },
      });

      expect(await authenticate(db, { token: otherSession.token, now: LATER })).not.toBeNull();
    });
  });

  it.each([
    ["deactivate an account already deactivated", false, false, "alreadyInState"],
    ["reactivate an account already active", true, true, "alreadyInState"],
  ])("refuses to %s and changes nothing", async (_case, before, active, reason) => {
    await asApp(async (db) => {
      const admin = await administrator(db);
      const userId = await operator(db, admin.id);
      await db.user.update({ where: { id: userId }, data: { active: before } });
      const eventsBefore = await db.auditEvent.count();

      const result = await setAccountActive(db, {
        userId,
        active,
        now: LATER,
        changedBy: { userId: admin.id, ip: IP },
      });

      expect(result).toEqual({ ok: false, reason });
      expect(await db.auditEvent.count()).toBe(eventsBefore);
    });
  });

  it("refuses to deactivate an administrator account and changes nothing", async () => {
    await asApp(async (db) => {
      const admin = await administrator(db);
      const signedIn = await db.session.create({
        data: {
          userId: admin.id,
          tokenHash: "hash-de-prueba-del-administrador",
          ip: IP,
          expiresAt: new Date(LATER.getTime() + 60_000),
        },
      });
      const eventsBefore = await db.auditEvent.count();

      const result = await setAccountActive(db, {
        userId: admin.id,
        active: false,
        now: LATER,
        changedBy: { userId: admin.id, ip: IP },
      });

      expect(result).toEqual({ ok: false, reason: "notOperator" });
      expect((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).active).toBe(true);
      expect(
        (await db.session.findUniqueOrThrow({ where: { id: signedIn.id } })).revokedAt,
      ).toBeNull();
      expect(await db.auditEvent.count()).toBe(eventsBefore);
    });
  });

  it("answers notFound for an account that does not exist", async () => {
    await asApp(async (db) => {
      const admin = await administrator(db);

      const result = await setAccountActive(db, {
        userId: 2_147_483_647,
        active: false,
        now: LATER,
        changedBy: { userId: admin.id, ip: IP },
      });

      expect(result).toEqual({ ok: false, reason: "notFound" });
    });
  });
});
