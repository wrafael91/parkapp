import { afterAll, describe, expect, it } from "vitest";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { deactivatePeriodCap, setPeriodCap } from "./period-cap.js";
import { closeCurrentVersions } from "../../versions.test-helper.js";

const prisma = createPrismaClient(config.databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
});

class Rollback extends Error {}

// Runs a test as parkapp_app, the role the API uses on the server, and always
// rolls back (S2-19).
async function asApp(test: (db: Prisma.TransactionClient) => Promise<void>): Promise<void> {
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE parkapp_app");
        await closeCurrentVersions(tx);
        await test(tx);
        throw new Rollback();
      },
      { timeout: 15_000 },
    );
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

const IP = "203.0.113.20";
const NOW = new Date("2026-11-14T15:00:00.000Z");
const LATER = new Date("2026-11-14T16:00:00.000Z");

async function createAdmin(db: Prisma.TransactionClient) {
  const user = await db.user.create({
    data: {
      name: "Administrador de prueba",
      email: "admin.tope@example.com",
      passwordHash: "not-a-real-hash",
      role: "ADMINISTRATOR",
    },
  });
  return { userId: user.id, ip: IP };
}

describe("setPeriodCap (BR-18)", () => {
  it("creates a version with the hours, the value and the administrator", async () => {
    await asApp(async (db) => {
      const changedBy = await createAdmin(db);

      const result = await setPeriodCap(db, { hours: 12, value: 11000, now: NOW, changedBy });

      if (!result.ok) throw new Error("cap not created");
      const periodCap = await db.periodCap.findUniqueOrThrow({ where: { id: result.periodCapId } });
      expect(periodCap).toMatchObject({
        hours: 12,
        value: 11000,
        validFrom: NOW,
        validTo: null,
        createdById: changedBy.userId,
      });
    });
  });

  it("records TOPE_PERIODO_CAMBIADO with the user and the IP (NFR-12)", async () => {
    await asApp(async (db) => {
      const changedBy = await createAdmin(db);

      const result = await setPeriodCap(db, { hours: 12, value: 11000, now: NOW, changedBy });

      if (!result.ok) throw new Error("cap not created");
      const events = await db.auditEvent.findMany({
        where: {
          action: "PERIOD_CAP_CHANGED",
          entity: "tope_periodo",
          entityId: result.periodCapId,
        },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        userId: changedBy.userId,
        detail: null,
        ip: IP,
        occurredAt: NOW,
      });
    });
  });

  it("closes the current version when it creates a new one (BR-11, RI-07)", async () => {
    await asApp(async (db) => {
      const changedBy = await createAdmin(db);
      const first = await setPeriodCap(db, { hours: 12, value: 11000, now: NOW, changedBy });

      const second = await setPeriodCap(db, { hours: 13, value: 11000, now: LATER, changedBy });

      if (!first.ok || !second.ok) throw new Error("cap not created");
      const closed = await db.periodCap.findUniqueOrThrow({ where: { id: first.periodCapId } });
      expect(closed.validTo).toEqual(LATER);
      expect(await db.periodCap.count({ where: { validTo: null } })).toBe(1);
    });
  });

  it.each([
    ["a period of 0 hours", 0, 11000, "invalidHours"],
    ["a period of 25 hours", 25, 11000, "invalidHours"],
    ["a period that is not whole hours", 12.5, 11000, "invalidHours"],
    ["a value of zero", 12, 0, "invalidValue"],
    ["a negative value", 12, -11000, "invalidValue"],
    ["a value with cents", 12, 11000.5, "invalidValue"],
  ] as const)(
    "rejects %s, creates nothing and keeps the current version (RI-20)",
    async (_case, hours, value, reason) => {
      await asApp(async (db) => {
        const changedBy = await createAdmin(db);
        const current = await setPeriodCap(db, { hours: 12, value: 11000, now: NOW, changedBy });
        const versionsBefore = await db.periodCap.count();
        const eventsBefore = await db.auditEvent.count();

        const result = await setPeriodCap(db, { hours, value, now: LATER, changedBy });

        if (!current.ok) throw new Error("cap not created");
        expect(result).toEqual({ ok: false, reason });
        expect(await db.periodCap.count()).toBe(versionsBefore);
        expect(await db.auditEvent.count()).toBe(eventsBefore);
        const kept = await db.periodCap.findUniqueOrThrow({ where: { id: current.periodCapId } });
        expect(kept.validTo).toBeNull();
      });
    },
  );
});

describe("deactivatePeriodCap (BR-18)", () => {
  it("closes the current version without creating another and records the event on it", async () => {
    await asApp(async (db) => {
      const changedBy = await createAdmin(db);
      const current = await setPeriodCap(db, { hours: 12, value: 11000, now: NOW, changedBy });
      if (!current.ok) throw new Error("cap not created");
      const versionsBefore = await db.periodCap.count();

      const result = await deactivatePeriodCap(db, { now: LATER, changedBy });

      expect(result).toEqual({ ok: true });
      const closed = await db.periodCap.findUniqueOrThrow({ where: { id: current.periodCapId } });
      expect(closed.validTo).toEqual(LATER);
      expect(await db.periodCap.count()).toBe(versionsBefore);
      expect(await db.periodCap.count({ where: { validTo: null } })).toBe(0);
      const events = await db.auditEvent.findMany({
        where: { action: "PERIOD_CAP_CHANGED", occurredAt: LATER },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        userId: changedBy.userId,
        entity: "tope_periodo",
        entityId: current.periodCapId,
        detail: null,
        ip: IP,
      });
    });
  });

  it("answers noPeriodCap when no cap is on, and writes nothing", async () => {
    await asApp(async (db) => {
      const changedBy = await createAdmin(db);
      const eventsBefore = await db.auditEvent.count();

      const result = await deactivatePeriodCap(db, { now: LATER, changedBy });

      expect(result).toEqual({ ok: false, reason: "noPeriodCap" });
      expect(await db.auditEvent.count()).toBe(eventsBefore);
    });
  });

  it("lets the administrator turn the cap on again afterwards", async () => {
    await asApp(async (db) => {
      const changedBy = await createAdmin(db);
      await setPeriodCap(db, { hours: 12, value: 11000, now: NOW, changedBy });
      await deactivatePeriodCap(db, { now: LATER, changedBy });

      const result = await setPeriodCap(db, {
        hours: 24,
        value: 20000,
        now: new Date("2026-11-14T17:00:00.000Z"),
        changedBy,
      });

      if (!result.ok) throw new Error("cap not created");
      const current = await db.periodCap.findFirstOrThrow({ where: { validTo: null } });
      expect(current).toMatchObject({ id: result.periodCapId, hours: 24, value: 20000 });
    });
  });
});
