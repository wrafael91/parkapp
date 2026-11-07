import { afterAll, describe, expect, it } from "vitest";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { setRate } from "./rate-settings.js";

const prisma = createPrismaClient(config.databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
});

class Rollback extends Error {}

// Runs a test as parkapp_app, the role the script uses on the server, and
// always rolls back (S2-19). The legal caps come from their migration (BR-15).
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

async function createAdmin(db: Prisma.TransactionClient): Promise<number> {
  const user = await db.user.create({
    data: {
      name: "Administrador de prueba",
      email: "admin.tarifas@example.com",
      passwordHash: "not-a-real-hash",
      role: "ADMINISTRATOR",
    },
  });
  return user.id;
}

const NOW = new Date("2026-11-07T15:00:00.000Z");

describe("setRate (BR-09, BR-10)", () => {
  it("creates a rate version tied to the current legal cap of its vehicle type", async () => {
    await asApp(async (db) => {
      const createdById = await createAdmin(db);
      const carCap = await db.legalCap.findFirstOrThrow({
        where: { vehicleType: "CAR", validTo: null },
      });

      const result = await setRate(db, {
        vehicleType: "CAR",
        valuePerMinute: 200,
        createdById,
        now: NOW,
      });

      if (!result.ok) throw new Error("rate not created");
      const rate = await db.rate.findUniqueOrThrow({ where: { id: result.rateId } });
      expect(rate).toMatchObject({
        vehicleType: "CAR",
        valuePerMinute: 200,
        legalCapId: carCap.id,
        validFrom: NOW,
        validTo: null,
        createdById,
      });
    });
  });

  it("records TARIFA_CAMBIADA for the new version as a system event (RI-18)", async () => {
    await asApp(async (db) => {
      const createdById = await createAdmin(db);

      const result = await setRate(db, {
        vehicleType: "CAR",
        valuePerMinute: 200,
        createdById,
        now: NOW,
      });

      if (!result.ok) throw new Error("rate not created");
      const events = await db.auditEvent.findMany({
        where: { action: "RATE_CHANGED", entity: "tarifa", entityId: result.rateId },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ userId: null, detail: null, ip: null, occurredAt: NOW });
    });
  });

  it("accepts a rate equal to the legal cap (BR-10)", async () => {
    await asApp(async (db) => {
      const createdById = await createAdmin(db);

      const result = await setRate(db, {
        vehicleType: "MOTORCYCLE",
        valuePerMinute: 161,
        createdById,
        now: NOW,
      });

      expect(result.ok).toBe(true);
    });
  });
});

describe("setRate rejects and creates nothing", () => {
  it.each([
    [
      "a car rate above the car cap",
      "CAR",
      231,
      { ok: false, reason: "aboveLegalCap", legalCap: 230 },
    ],
    [
      "a motorcycle rate above its cap, though below the car cap",
      "MOTORCYCLE",
      200,
      { ok: false, reason: "aboveLegalCap", legalCap: 161 },
    ],
    ["a rate of zero", "CAR", 0, { ok: false, reason: "invalidValue" }],
    ["a negative rate", "CAR", -50, { ok: false, reason: "invalidValue" }],
    ["a rate with cents", "CAR", 200.5, { ok: false, reason: "invalidValue" }],
  ] as const)("%s", async (_case, vehicleType, valuePerMinute, expected) => {
    await asApp(async (db) => {
      const createdById = await createAdmin(db);
      const ratesBefore = await db.rate.count();
      const eventsBefore = await db.auditEvent.count();

      const result = await setRate(db, { vehicleType, valuePerMinute, createdById, now: NOW });

      expect(result).toEqual(expected);
      expect(await db.rate.count()).toBe(ratesBefore);
      expect(await db.auditEvent.count()).toBe(eventsBefore);
    });
  });

  it("a date with no current legal cap", async () => {
    await asApp(async (db) => {
      const createdById = await createAdmin(db);
      const ratesBefore = await db.rate.count();

      const result = await setRate(db, {
        vehicleType: "CAR",
        valuePerMinute: 200,
        createdById,
        now: new Date("2025-12-31T12:00:00.000Z"),
      });

      expect(result).toEqual({ ok: false, reason: "noLegalCap" });
      expect(await db.rate.count()).toBe(ratesBefore);
    });
  });
});
