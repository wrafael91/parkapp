import { afterAll, describe, expect, it } from "vitest";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { lockVehicleType, setCapacity } from "../capacity/capacity.js";
import { deactivatePeriodCap, setPeriodCap } from "../rates/period-cap.js";
import { setGracePeriod, setRate } from "../rates/rate-settings.js";
import { registerEntry } from "./entry.service.js";
import { registerExit } from "./exit.service.js";
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

  it("keeps the cap in force at entry (BR-11, BR-18)", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const periodCap = await setPeriodCap(db, {
        hours: 12,
        value: 11000,
        now: RATES_FROM,
        changedBy: { userId: setup.userId, ip: IP },
      });

      const result = await registerEntry(db, {
        plate: "ABC123",
        vehicleType: "CAR",
        color: "Rojo",
        userId: setup.userId,
        ip: IP,
        now: NOW,
      });

      if (!periodCap.ok || !result.ok) throw new Error("setup failed");
      const stay = await db.stay.findUniqueOrThrow({ where: { id: result.stayId } });
      expect(stay.periodCapId).toBe(periodCap.periodCapId);
    });
  });

  // Passes since the red of cycle F, on purpose: it fixes that turning the cap off
  // means no cap for new stays (BR-18).
  it("keeps no cap when it was turned off before the entry (BR-11)", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const changedBy = { userId: setup.userId, ip: IP };
      await setPeriodCap(db, { hours: 12, value: 11000, now: RATES_FROM, changedBy });
      await deactivatePeriodCap(db, { now: new Date("2026-11-08T12:00:00.000Z"), changedBy });

      const result = await registerEntry(db, {
        plate: "ABC123",
        vehicleType: "CAR",
        color: "Rojo",
        userId: setup.userId,
        ip: IP,
        now: NOW,
      });

      if (!result.ok) throw new Error("entry not registered");
      const stay = await db.stay.findUniqueOrThrow({ where: { id: result.stayId } });
      expect(stay.periodCapId).toBeNull();
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
      await db.stay.update({
        where: { id: first.stayId },
        data: {
          status: "CLOSED",
          exitTime: new Date("2026-11-09T15:00:00.000Z"),
          exitById: setup.userId,
        },
      });

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

// BR-19. The spaces are set relative to the vehicles already inside, so a
// development database with active stays does not change the result.
const SPACES_FROM = new Date("2026-11-08T12:00:00.000Z");
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

function activeCount(db: Prisma.TransactionClient, vehicleType: "CAR" | "MOTORCYCLE") {
  return db.stay.count({ where: { vehicleType, status: "ACTIVE" } });
}

async function setSpaces(
  db: Prisma.TransactionClient,
  setup: Setup,
  vehicleType: "CAR" | "MOTORCYCLE",
  spaces: number | null,
  now = SPACES_FROM,
) {
  const result = await setCapacity(db, {
    vehicleType,
    spaces,
    now,
    changedBy: { userId: setup.userId, ip: IP },
  });
  if (!result.ok) throw new Error(`spaces not set: ${result.reason}`);
  return result.capacityId;
}

function enter(
  db: Prisma.TransactionClient,
  setup: Setup,
  plate: string,
  vehicleType: "CAR" | "MOTORCYCLE" = "CAR",
  now = NOW,
) {
  return registerEntry(db, {
    plate,
    vehicleType,
    color: "Rojo",
    userId: setup.userId,
    ip: IP,
    now,
  });
}

describe("registerEntry with spaces (BR-19)", () => {
  it("rejects a car when no spaces are left, records INGRESO_RECHAZADO_SIN_CUPO and creates nothing", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const inside = await activeCount(db, "CAR");
      const capacityId = await setSpaces(db, setup, "CAR", inside + 1);
      expect((await enter(db, setup, "ABC123")).ok).toBe(true);
      const staysBefore = await db.stay.count();

      const result = await registerEntry(db, {
        plate: "abc-124",
        vehicleType: "CAR",
        color: " Azul ",
        brand: " Kia ",
        userId: setup.userId,
        ip: IP,
        now: at(1),
      });

      expect(result).toEqual({ ok: false, reason: "noCapacity" });
      expect(await db.stay.count()).toBe(staysBefore);
      const events = await db.auditEvent.findMany({
        where: { action: "ENTRY_REJECTED_NO_CAPACITY" },
      });
      expect(events).toEqual([
        expect.objectContaining({
          userId: setup.userId,
          entity: "cupo",
          entityId: capacityId,
          detail: { placa: "ABC124", color: "Azul", marca: "Kia", dentro: inside + 1 },
          ip: IP,
          occurredAt: at(1),
        }),
      ]);
    });
  });

  it("lets motorcycles in when the cars are full, and the other way around", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      await setSpaces(db, setup, "CAR", await activeCount(db, "CAR"));
      await setSpaces(db, setup, "MOTORCYCLE", (await activeCount(db, "MOTORCYCLE")) + 1);

      expect(await enter(db, setup, "ABC12D", "MOTORCYCLE")).toMatchObject({ ok: true });
      expect(await enter(db, setup, "ABC123")).toEqual({ ok: false, reason: "noCapacity" });
      expect(await enter(db, setup, "ABC12E", "MOTORCYCLE", at(1))).toEqual({
        ok: false,
        reason: "noCapacity",
      });
      await setSpaces(db, setup, "CAR", (await activeCount(db, "CAR")) + 1, at(2));
      expect(await enter(db, setup, "ABC123", "CAR", at(3))).toMatchObject({ ok: true });
    });
  });

  it("frees a space when a vehicle leaves, and does not count voided stays (BR-12)", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      await setSpaces(db, setup, "CAR", (await activeCount(db, "CAR")) + 1);
      const first = await enter(db, setup, "ABC123");
      if (!first.ok) throw new Error("entry not registered");
      expect(await enter(db, setup, "ABC124", "CAR", at(1))).toMatchObject({ ok: false });

      await registerExit(db, { stayId: first.stayId, userId: setup.userId, ip: IP, now: at(2) });
      const second = await enter(db, setup, "ABC124", "CAR", at(3));
      if (!second.ok) throw new Error("entry not registered after the exit");
      await db.stay.update({
        where: { id: second.stayId },
        data: {
          status: "VOIDED",
          voidedAt: at(4),
          voidedById: setup.userId,
          voidReason: "Ingreso de prueba",
        },
      });

      expect(await enter(db, setup, "ABC125", "CAR", at(5))).toMatchObject({ ok: true });
    });
  });

  it("keeps the vehicles inside when the spaces go below them, and waits for a space", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const inside = await activeCount(db, "CAR");
      await setSpaces(db, setup, "CAR", inside + 2);
      const first = await enter(db, setup, "ABC123");
      const second = await enter(db, setup, "ABC124");
      if (!first.ok || !second.ok) throw new Error("entries not registered");

      await setSpaces(db, setup, "CAR", inside + 1, at(1));

      expect(await activeCount(db, "CAR")).toBe(inside + 2);
      expect(await enter(db, setup, "ABC125", "CAR", at(2))).toMatchObject({ ok: false });
      await registerExit(db, { stayId: first.stayId, userId: setup.userId, ip: IP, now: at(3) });
      expect(await enter(db, setup, "ABC125", "CAR", at(4))).toMatchObject({ ok: false });
      await registerExit(db, { stayId: second.stayId, userId: setup.userId, ip: IP, now: at(5) });
      expect(await enter(db, setup, "ABC125", "CAR", at(6))).toMatchObject({ ok: true });
    });
  });

  it("takes no vehicles of a type with 0 spaces", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      await setSpaces(db, setup, "MOTORCYCLE", 0);

      expect(await enter(db, setup, "ABC12D", "MOTORCYCLE")).toEqual({
        ok: false,
        reason: "noCapacity",
      });
      expect(await enter(db, setup, "ABC123")).toMatchObject({ ok: true });
    });
  });

  it("has no limit for a type without spaces, or whose limit was removed", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      expect(await enter(db, setup, "ABC123")).toMatchObject({ ok: true });
      await setSpaces(db, setup, "CAR", 0);
      expect(await enter(db, setup, "ABC124", "CAR", at(1))).toMatchObject({ ok: false });

      await setSpaces(db, setup, "CAR", null, at(2));

      expect(await enter(db, setup, "ABC124", "CAR", at(3))).toMatchObject({ ok: true });
      expect(await db.auditEvent.count({ where: { action: "ENTRY_REJECTED_NO_CAPACITY" } })).toBe(
        1,
      );
    });
  });

  it("checks a cloned plate before the spaces (BR-03)", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      await setSpaces(db, setup, "CAR", (await activeCount(db, "CAR")) + 1);
      expect((await enter(db, setup, "ABC123")).ok).toBe(true);

      expect(await enter(db, setup, "ABC123", "CAR", at(1))).toEqual({
        ok: false,
        reason: "plateActive",
      });
      expect(await db.auditEvent.count({ where: { action: "ENTRY_REJECTED_NO_CAPACITY" } })).toBe(
        0,
      );
    });
  });

  it("takes the lock of its type before checking the plate and counting the vehicles inside", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      await setSpaces(db, setup, "CAR", (await activeCount(db, "CAR")) + 1);
      const calls: string[] = [];
      const record = <T extends object>(name: string, target: T): T =>
        new Proxy(target, {
          get(object, property) {
            const value: unknown = Reflect.get(object, property);
            if (typeof value !== "function") return value;
            return (...args: unknown[]) => {
              calls.push(`${name}${String(property)}`);
              return value.apply(object, args);
            };
          },
        });
      const recorded = new Proxy(db, {
        get(object, property) {
          if (property === "stay") return record("stay.", object.stay);
          if (property === "capacity") return record("capacity.", object.capacity);
          if (property === "$executeRaw") {
            return (query: TemplateStringsArray, ...values: unknown[]) => {
              calls.push("lock");
              return object.$executeRaw(query, ...values);
            };
          }
          return Reflect.get(object, property);
        },
      });

      expect(await enter(recorded, setup, "ABC123")).toMatchObject({ ok: true });
      expect(calls.slice(0, 4)).toEqual([
        "lock",
        "stay.findFirst",
        "capacity.findFirst",
        "stay.count",
      ]);
    });
  });
});

// A transaction on another connection holds the lock of a vehicle type until the
// test lets it go. It writes nothing, so the entry's own transaction waits only for
// the lock. Nothing is committed.
async function holdLock(vehicleType: "CAR" | "MOTORCYCLE") {
  let release!: () => void;
  let taken!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const lockTaken = new Promise<void>((resolve) => (taken = resolve));
  const transaction = prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE parkapp_app");
      await lockVehicleType(tx, vehicleType);
      taken();
      await held;
    },
    { timeout: 15_000 },
  );
  // If taking the lock fails, the transaction rejects and so does the test.
  await Promise.race([lockTaken, transaction]);
  return { release, transaction };
}

describe("registerEntry at the same time as another entry (BR-19)", () => {
  it("waits until the transaction holding the lock of its type ends", async () => {
    const holder = await holdLock("CAR");
    let entered = false;
    const entry = asApp(async (db) => {
      const setup = await setUp(db);
      expect(await enter(db, setup, "ABC123")).toMatchObject({ ok: true });
      entered = true;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(entered).toBe(false);
    } finally {
      holder.release();
      await holder.transaction;
      await entry;
    }
    expect(entered).toBe(true);
  });

  it("does not wait for the lock of the other vehicle type", async () => {
    const holder = await holdLock("CAR");
    let entered = false;
    try {
      await asApp(async (db) => {
        const setup = await setUp(db);
        expect(await enter(db, setup, "ABC12D", "MOTORCYCLE")).toMatchObject({ ok: true });
        entered = true;
      });
    } finally {
      holder.release();
      await holder.transaction;
    }
    expect(entered).toBe(true);
  });
});
