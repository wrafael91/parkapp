import { afterAll, describe, expect, it } from "vitest";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { setGracePeriod, setRate } from "../rates/rate-settings.js";
import { registerEntry } from "./entry.service.js";

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
const NOW = new Date("2026-11-09T14:30:00.000Z");
const IP = "203.0.113.30";

interface Setup {
  userId: number;
  carRateId: number;
  motorcycleRateId: number;
  gracePeriodId: number;
}

// An operator plus the rates and the grace period that every entry needs (BR-11).
async function setUp(db: Prisma.TransactionClient): Promise<Setup> {
  const user = await db.user.create({
    data: {
      name: "Operador de prueba",
      email: "operador.ingresos@example.com",
      passwordHash: "not-a-real-hash",
      role: "OPERATOR",
    },
  });
  const now = RATES_FROM;
  const car = await setRate(db, {
    vehicleType: "CAR",
    valuePerMinute: 200,
    createdById: user.id,
    now,
  });
  const motorcycle = await setRate(db, {
    vehicleType: "MOTORCYCLE",
    valuePerMinute: 150,
    createdById: user.id,
    now,
  });
  const grace = await setGracePeriod(db, { minutes: 5, createdById: user.id, now });
  if (!car.ok || !motorcycle.ok || !grace.ok) throw new Error("setup failed");
  return {
    userId: user.id,
    carRateId: car.rateId,
    motorcycleRateId: motorcycle.rateId,
    gracePeriodId: grace.gracePeriodId,
  };
}

describe("registerEntry (FR-07, BR-02, BR-16)", () => {
  it("registers an active stay with the normalized plate, the server time and the user", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);

      const result = await registerEntry(db, {
        plate: " abc-123 ",
        vehicleType: "CAR",
        color: " Rojo ",
        brand: "Mazda",
        userId: setup.userId,
        ip: IP,
        now: NOW,
      });

      if (!result.ok) throw new Error("entry not registered");
      const stay = await db.stay.findUniqueOrThrow({ where: { id: result.stayId } });
      expect(stay).toMatchObject({
        plate: "ABC123",
        vehicleType: "CAR",
        color: "Rojo",
        brand: "Mazda",
        status: "ACTIVE",
        entryTime: NOW,
        entryById: setup.userId,
      });
    });
  });

  it("keeps the current rate of its vehicle type and the current grace period (BR-11, RI-06)", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);

      const result = await registerEntry(db, {
        plate: "abc12d",
        vehicleType: "MOTORCYCLE",
        color: "Negro",
        userId: setup.userId,
        ip: IP,
        now: NOW,
      });

      if (!result.ok) throw new Error("entry not registered");
      const stay = await db.stay.findUniqueOrThrow({ where: { id: result.stayId } });
      expect(stay).toMatchObject({
        rateId: setup.motorcycleRateId,
        gracePeriodId: setup.gracePeriodId,
        brand: null,
      });
    });
  });

  it("records INGRESO_REGISTRADO with the user and the IP (NFR-12)", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);

      const result = await registerEntry(db, {
        plate: "ABC123",
        vehicleType: "CAR",
        color: "Rojo",
        userId: setup.userId,
        ip: IP,
        now: NOW,
      });

      if (!result.ok) throw new Error("entry not registered");
      const events = await db.auditEvent.findMany({
        where: { action: "ENTRY_REGISTERED", entity: "estadia", entityId: result.stayId },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        userId: setup.userId,
        ip: IP,
        detail: null,
        occurredAt: NOW,
      });
    });
  });
});

describe("registerEntry rejects", () => {
  it.each([
    ["a motorcycle plate for a car", "ABC12D", "CAR"],
    ["a car plate for a motorcycle", "ABC123", "MOTORCYCLE"],
  ] as const)("%s and creates nothing (FR-08)", async (_case, plate, vehicleType) => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const staysBefore = await db.stay.count();
      const eventsBefore = await db.auditEvent.count();

      const result = await registerEntry(db, {
        plate,
        vehicleType,
        color: "Rojo",
        userId: setup.userId,
        ip: IP,
        now: NOW,
      });

      expect(result).toEqual({ ok: false, reason: "invalidPlate" });
      expect(await db.stay.count()).toBe(staysBefore);
      expect(await db.auditEvent.count()).toBe(eventsBefore);
    });
  });
});

describe("registerEntry with a plate already inside (BR-03, FR-09)", () => {
  it("rejects it, records INGRESO_RECHAZADO_PLACA_ACTIVA with the rejected vehicle and creates nothing", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const first = await registerEntry(db, {
        plate: "ABC123",
        vehicleType: "CAR",
        color: "Rojo",
        userId: setup.userId,
        ip: IP,
        now: NOW,
      });
      const staysBefore = await db.stay.count();

      const result = await registerEntry(db, {
        plate: "abc 123",
        vehicleType: "CAR",
        color: " Azul ",
        brand: " Renault ",
        userId: setup.userId,
        ip: IP,
        now: new Date("2026-11-09T15:00:00.000Z"),
      });

      if (!first.ok) throw new Error("entry not registered");
      expect(result).toEqual({ ok: false, reason: "plateActive" });
      expect(await db.stay.count()).toBe(staysBefore);
      const events = await db.auditEvent.findMany({
        where: { action: "ENTRY_REJECTED_ACTIVE_PLATE", entity: "estadia", entityId: first.stayId },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        userId: setup.userId,
        ip: IP,
        detail: { tipo_vehiculo: "CARRO", color: "Azul", marca: "Renault" },
      });
    });
  });

  it("accepts it again once its stay is no longer active", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const first = await registerEntry(db, {
        plate: "ABC123",
        vehicleType: "CAR",
        color: "Rojo",
        userId: setup.userId,
        ip: IP,
        now: NOW,
      });
      if (!first.ok) throw new Error("entry not registered");
      await db.stay.update({ where: { id: first.stayId }, data: { status: "CLOSED" } });

      const result = await registerEntry(db, {
        plate: "ABC123",
        vehicleType: "CAR",
        color: "Rojo",
        userId: setup.userId,
        ip: IP,
        now: new Date("2026-11-09T18:00:00.000Z"),
      });

      expect(result.ok).toBe(true);
    });
  });
});
