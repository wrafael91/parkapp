import { afterAll, describe, expect, it } from "vitest";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { createAdministrator } from "./create-administrator.js";
import { verifyPassword } from "./password.js";
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

const EMAIL = "admin.arranque@example.com";
const PASSWORD = "la frase de paso del arranque";
const NOW = new Date("2026-11-06T22:00:00.000Z");
const INPUT = { name: "Administrador de arranque", email: EMAIL, password: PASSWORD, now: NOW };

describe("createAdministrator (requisitos 1.3, RI-16)", () => {
  it("creates an active administrator who must change the password", async () => {
    await asApp(async (db) => {
      const result = await createAdministrator(db, {
        ...INPUT,
        name: "  Administrador de arranque ",
        email: "  Admin.Arranque@Example.com ",
      });

      if (!result.ok) throw new Error("account not created");
      const user = await db.user.findUniqueOrThrow({ where: { id: result.userId } });
      // RI-15: the email is stored in lowercase, without spaces.
      expect(user).toMatchObject({
        name: "Administrador de arranque",
        email: EMAIL,
        role: "ADMINISTRATOR",
        active: true,
        mustChangePassword: true,
        createdAt: NOW,
      });
      // NFR-01: only the Argon2id hash is stored.
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(await verifyPassword(user.passwordHash, PASSWORD)).toBe(true);
    });
  });

  it("records CUENTA_CREADA as a system event, without user or IP (RI-18)", async () => {
    await asApp(async (db) => {
      const result = await createAdministrator(db, INPUT);

      if (!result.ok) throw new Error("account not created");
      const events = await db.auditEvent.findMany({
        where: { action: "ACCOUNT_CREATED", entity: "usuario", entityId: result.userId },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ userId: null, detail: null, ip: null, occurredAt: NOW });
    });
  });

  it("creates an account that can sign in (FR-01)", async () => {
    await asApp(async (db) => {
      await createAdministrator(db, INPUT);

      const result = await signIn(db, {
        email: EMAIL,
        password: PASSWORD,
        ip: "203.0.113.20",
        now: NOW,
      });

      expect(result.ok).toBe(true);
    });
  });
});

describe("createAdministrator rejects", () => {
  it.each([
    ["shorter than 15", "a".repeat(14)],
    ["longer than 64", "a".repeat(65)],
  ])("a password %s characters and creates nothing (NFR-02)", async (_case, password) => {
    await asApp(async (db) => {
      const eventsBefore = await db.auditEvent.count();

      const result = await createAdministrator(db, { ...INPUT, password });

      expect(result).toEqual({ ok: false, reason: "passwordLength" });
      expect(await db.user.findUnique({ where: { email: EMAIL } })).toBeNull();
      expect(await db.auditEvent.count()).toBe(eventsBefore);
    });
  });

  it("an email already in use, whatever its capitals and spaces (RI-15)", async () => {
    await asApp(async (db) => {
      await createAdministrator(db, INPUT);
      const eventsBefore = await db.auditEvent.count();

      const result = await createAdministrator(db, {
        ...INPUT,
        name: "Otra persona",
        email: " ADMIN.Arranque@example.com",
      });

      expect(result).toEqual({ ok: false, reason: "emailInUse" });
      expect(await db.auditEvent.count()).toBe(eventsBefore);
    });
  });
});
