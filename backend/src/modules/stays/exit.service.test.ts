import { afterAll, describe, expect, it } from "vitest";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import { calculateFee } from "../../domain/fee.js";
import type { Prisma, VehicleType } from "../../generated/prisma/client.js";
import { setGracePeriod, setRate } from "../rates/rate-settings.js";
import { registerEntry } from "./entry.service.js";
import { registerExit } from "./exit.service.js";

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
        await test(tx);
        throw new Rollback();
      },
      { timeout: 15_000 },
    );
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

const RATES_FROM = new Date("2026-11-07T12:00:00.000Z");
const ENTRY = new Date("2026-11-09T14:00:00.000Z");
const IP = "203.0.113.31";

function minutesAfter(date: Date, minutes: number, seconds = 0): Date {
  return new Date(date.getTime() + (minutes * 60 + seconds) * 1000);
}

// An operator plus the production rates and grace period ($230, $161 and 5
// minutes, the values of the examples in docs/reglas-de-negocio.md). The SAL
// plates are only for these tests, so a stay left active in the development
// database (the same one the tests use) does not get in the way.
async function setUp(db: Prisma.TransactionClient): Promise<number> {
  const user = await db.user.create({
    data: {
      name: "Operador de salidas",
      email: "operador.salidas@example.com",
      passwordHash: "not-a-real-hash",
      role: "OPERATOR",
    },
  });
  const now = RATES_FROM;
  const car = await setRate(db, {
    vehicleType: "CAR",
    valuePerMinute: 230,
    createdById: user.id,
    now,
  });
  const motorcycle = await setRate(db, {
    vehicleType: "MOTORCYCLE",
    valuePerMinute: 161,
    createdById: user.id,
    now,
  });
  const grace = await setGracePeriod(db, { minutes: 5, createdById: user.id, now });
  if (!car.ok || !motorcycle.ok || !grace.ok) throw new Error("setup failed");
  return user.id;
}

async function enter(
  db: Prisma.TransactionClient,
  userId: number,
  plate: string,
  vehicleType: VehicleType,
): Promise<number> {
  const result = await registerEntry(db, {
    plate,
    vehicleType,
    color: "Gris",
    userId,
    ip: IP,
    now: ENTRY,
  });
  if (!result.ok) throw new Error("entry not registered");
  return result.stayId;
}

describe("registerExit (FR-12, FR-13, FR-14, RI-11)", () => {
  it("closes the stay and stores exactly what calculateFee returns (example 4)", async () => {
    await asApp(async (db) => {
      const userId = await setUp(db);
      const stayId = await enter(db, userId, "SAL123", "CAR");
      const exit = minutesAfter(ENTRY, 37, 50);

      const result = await registerExit(db, { stayId, userId, ip: IP, now: exit });

      if (!result.ok) throw new Error("exit not registered");
      const receipt = await db.receipt.findUniqueOrThrow({ where: { id: result.receiptId } });
      const fee = calculateFee({
        entryTime: ENTRY,
        exitTime: exit,
        valuePerMinute: 230,
        gracePeriodMinutes: 5,
      });
      expect(fee).toEqual({ fullMinutes: 37, subtotal: 8510, roundingAdjustment: 10, total: 8500 });
      expect(receipt).toMatchObject({ stayId, ...fee });
      const stay = await db.stay.findUniqueOrThrow({ where: { id: stayId } });
      expect(stay).toMatchObject({ status: "CLOSED", exitTime: exit, exitById: userId });
    });
  });

  it("charges the rate and the grace period in force at entry after they change (BR-11)", async () => {
    await asApp(async (db) => {
      const userId = await setUp(db);
      const stayId = await enter(db, userId, "SAL123", "CAR");
      const changedAt = minutesAfter(ENTRY, 10);
      await setRate(db, {
        vehicleType: "CAR",
        valuePerMinute: 200,
        createdById: userId,
        now: changedAt,
      });
      await setGracePeriod(db, { minutes: 40, createdById: userId, now: changedAt });

      const result = await registerExit(db, {
        stayId,
        userId,
        ip: IP,
        now: minutesAfter(ENTRY, 37, 50),
      });

      if (!result.ok) throw new Error("exit not registered");
      const receipt = await db.receipt.findUniqueOrThrow({ where: { id: result.receiptId } });
      expect(receipt).toMatchObject({ fullMinutes: 37, subtotal: 8510, total: 8500 });
    });
  });

  it("issues a receipt of $0 within the grace period (example 1)", async () => {
    await asApp(async (db) => {
      const userId = await setUp(db);
      const stayId = await enter(db, userId, "SAL12D", "MOTORCYCLE");

      const result = await registerExit(db, {
        stayId,
        userId,
        ip: IP,
        now: minutesAfter(ENTRY, 3),
      });

      if (!result.ok) throw new Error("exit not registered");
      const receipt = await db.receipt.findUniqueOrThrow({ where: { id: result.receiptId } });
      expect(receipt).toMatchObject({
        stayId,
        fullMinutes: 3,
        subtotal: 0,
        roundingAdjustment: 0,
        total: 0,
      });
    });
  });

  it("records SALIDA_REGISTRADA with the user and the IP (NFR-12)", async () => {
    await asApp(async (db) => {
      const userId = await setUp(db);
      const stayId = await enter(db, userId, "SAL123", "CAR");
      const exit = minutesAfter(ENTRY, 6);

      await registerExit(db, { stayId, userId, ip: IP, now: exit });

      const events = await db.auditEvent.findMany({
        where: { action: "EXIT_REGISTERED", entity: "estadia", entityId: stayId },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ userId, ip: IP, occurredAt: exit, detail: null });
    });
  });
});

describe("registerExit of a stay that is not active (RI-04, RI-11)", () => {
  it("answers notFound for a stay that does not exist and writes nothing", async () => {
    await asApp(async (db) => {
      const userId = await setUp(db);
      const last = await db.stay.aggregate({ _max: { id: true } });
      const receiptsBefore = await db.receipt.count();
      const eventsBefore = await db.auditEvent.count();

      const result = await registerExit(db, {
        stayId: (last._max.id ?? 0) + 1,
        userId,
        ip: IP,
        now: minutesAfter(ENTRY, 6),
      });

      expect(result).toEqual({ ok: false, reason: "notFound" });
      expect(await db.receipt.count()).toBe(receiptsBefore);
      expect(await db.auditEvent.count()).toBe(eventsBefore);
    });
  });

  it("answers notActive for a stay that already left and keeps its first exit", async () => {
    await asApp(async (db) => {
      const userId = await setUp(db);
      const stayId = await enter(db, userId, "SAL123", "CAR");
      const firstExit = minutesAfter(ENTRY, 6);
      await registerExit(db, { stayId, userId, ip: IP, now: firstExit });
      const receiptsBefore = await db.receipt.count();
      const eventsBefore = await db.auditEvent.count();

      const result = await registerExit(db, {
        stayId,
        userId,
        ip: IP,
        now: minutesAfter(ENTRY, 9),
      });

      expect(result).toEqual({ ok: false, reason: "notActive" });
      const stay = await db.stay.findUniqueOrThrow({ where: { id: stayId } });
      expect(stay).toMatchObject({ status: "CLOSED", exitTime: firstExit });
      expect(await db.receipt.count()).toBe(receiptsBefore);
      expect(await db.auditEvent.count()).toBe(eventsBefore);
    });
  });

  it("answers notActive for a voided stay and leaves it voided", async () => {
    await asApp(async (db) => {
      const userId = await setUp(db);
      const stayId = await enter(db, userId, "SAL123", "CAR");
      await db.stay.update({
        where: { id: stayId },
        data: {
          status: "VOIDED",
          voidedAt: minutesAfter(ENTRY, 2),
          voidedById: userId,
          voidReason: "Ingreso de prueba",
        },
      });
      const receiptsBefore = await db.receipt.count();

      const result = await registerExit(db, {
        stayId,
        userId,
        ip: IP,
        now: minutesAfter(ENTRY, 6),
      });

      expect(result).toEqual({ ok: false, reason: "notActive" });
      const stay = await db.stay.findUniqueOrThrow({ where: { id: stayId } });
      expect(stay).toMatchObject({ status: "VOIDED", exitTime: null, exitById: null });
      expect(await db.receipt.count()).toBe(receiptsBefore);
    });
  });

  // Passes since the green of cycle K, on purpose: it fixes that the fee is
  // calculated before anything is written (A-23).
  it("leaves the stay active and issues no receipt when calculateFee throws", async () => {
    await asApp(async (db) => {
      const userId = await setUp(db);
      const stayId = await enter(db, userId, "SAL123", "CAR");
      const receiptsBefore = await db.receipt.count();

      await expect(
        registerExit(db, { stayId, userId, ip: IP, now: minutesAfter(ENTRY, -1) }),
      ).rejects.toThrow(RangeError);

      const stay = await db.stay.findUniqueOrThrow({ where: { id: stayId } });
      expect(stay).toMatchObject({ status: "ACTIVE", exitTime: null, exitById: null });
      expect(await db.receipt.count()).toBe(receiptsBefore);
      const events = await db.auditEvent.count({
        where: { action: "EXIT_REGISTERED", entity: "estadia", entityId: stayId },
      });
      expect(events).toBe(0);
    });
  });
});
