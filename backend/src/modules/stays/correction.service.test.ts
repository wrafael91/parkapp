import { afterAll, describe, expect, it } from "vitest";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma, VehicleType } from "../../generated/prisma/client.js";
import { lockVehicleType, setCapacity } from "../capacity/capacity.js";
import { setPeriodCap } from "../rates/period-cap.js";
import { setGracePeriod, setRate } from "../rates/rate-settings.js";
import { closeCurrentVersions } from "../../versions.test-helper.js";
import { correctStay } from "./correction.service.js";
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
const ENTRY = new Date("2026-11-09T13:02:00.000Z");
const CORRECTED_AT = new Date("2026-11-09T15:00:00.000Z");
const IP = "203.0.113.47";

interface SetUp {
  operatorId: number;
  administratorId: number;
}

// An operator who registers the entries, an administrator who corrects them, and
// the production rates and grace period ($230, $161 and 5 minutes). The COR plates
// are only for these tests, so a stay left active in the development database (the
// same one the tests use) does not get in the way.
async function setUp(
  db: Prisma.TransactionClient,
  options: { motorcycleRateFrom?: Date } = {},
): Promise<SetUp> {
  const operator = await db.user.create({
    data: {
      name: "Operador de ingresos",
      email: "operador.correcciones@example.com",
      passwordHash: "not-a-real-hash",
      role: "OPERATOR",
    },
  });
  const administrator = await db.user.create({
    data: {
      name: "Administrador de correcciones",
      email: "admin.correcciones@example.com",
      passwordHash: "not-a-real-hash",
      role: "ADMINISTRATOR",
    },
  });
  const car = await setRate(db, {
    vehicleType: "CAR",
    valuePerMinute: 230,
    createdById: administrator.id,
    now: RATES_FROM,
  });
  const motorcycle = await setRate(db, {
    vehicleType: "MOTORCYCLE",
    valuePerMinute: 161,
    createdById: administrator.id,
    now: options.motorcycleRateFrom ?? RATES_FROM,
  });
  const grace = await setGracePeriod(db, {
    minutes: 5,
    createdById: administrator.id,
    now: RATES_FROM,
  });
  if (!car.ok || !motorcycle.ok || !grace.ok) throw new Error("setup failed");
  return { operatorId: operator.id, administratorId: administrator.id };
}

async function enter(
  db: Prisma.TransactionClient,
  setup: SetUp,
  plate: string,
  vehicleType: VehicleType = "CAR",
  brand?: string,
): Promise<number> {
  const result = await registerEntry(db, {
    plate,
    vehicleType,
    color: "Azul",
    brand,
    userId: setup.operatorId,
    ip: IP,
    now: ENTRY,
  });
  if (!result.ok) throw new Error(`entry failed: ${result.reason}`);
  return result.stayId;
}

function correct(
  db: Prisma.TransactionClient,
  setup: SetUp,
  stayId: number,
  changes: { plate?: string; vehicleType?: VehicleType; color?: string; brand?: string | null },
) {
  return correctStay(db, {
    stayId,
    plate: changes.plate ?? "COR128",
    vehicleType: changes.vehicleType ?? "CAR",
    color: changes.color ?? "Azul",
    brand: changes.brand,
    reason: "Placa mal digitada",
    userId: setup.administratorId,
    ip: IP,
    now: CORRECTED_AT,
  });
}

async function correctionEvents(db: Prisma.TransactionClient): Promise<number> {
  return db.auditEvent.count({ where: { action: "STAY_CORRECTED", ip: IP } });
}

describe("correctStay (FR-21, BR-17)", () => {
  it("voids the stay with the reason, the administrator and the server time (BR-12, BR-16)", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const stayId = await enter(db, setup, "COR128");

      const result = await correct(db, setup, stayId, { plate: "COR123" });

      expect(result).toMatchObject({ ok: true });
      const voided = await db.stay.findUniqueOrThrow({ where: { id: stayId } });
      expect(voided).toMatchObject({
        plate: "COR128",
        status: "VOIDED",
        voidedAt: CORRECTED_AT,
        voidedById: setup.administratorId,
        voidReason: "Placa mal digitada",
        exitTime: null,
      });
    });
  });

  it("creates an active replacement with the corrected plate and the entry time of the voided stay (RI-19)", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const stayId = await enter(db, setup, "COR128");
      const original = await db.stay.findUniqueOrThrow({ where: { id: stayId } });
      const cap = await setPeriodCap(db, {
        hours: 12,
        value: 11_000,
        now: new Date("2026-11-09T14:00:00.000Z"),
        changedBy: { userId: setup.administratorId, ip: IP },
      });
      if (!cap.ok) throw new Error("setup failed");

      const result = await correct(db, setup, stayId, { plate: "cor-123", brand: " Kia " });

      if (!result.ok) throw new Error(result.reason);
      const replacement = await db.stay.findUniqueOrThrow({ where: { id: result.stayId } });
      expect(replacement).toMatchObject({
        plate: "COR123",
        vehicleType: "CAR",
        color: "Azul",
        brand: "Kia",
        status: "ACTIVE",
        entryTime: ENTRY,
        entryById: setup.operatorId,
        rateId: original.rateId,
        gracePeriodId: original.gracePeriodId,
        periodCapId: null,
        replacesId: stayId,
      });
    });
  });

  it("corrects only the color or the brand and keeps the plate (RI-02)", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const stayId = await enter(db, setup, "COR123", "CAR", "Kia");

      const result = await correct(db, setup, stayId, {
        plate: "COR123",
        color: "Rojo",
        brand: null,
      });

      if (!result.ok) throw new Error(result.reason);
      const replacement = await db.stay.findUniqueOrThrow({ where: { id: result.stayId } });
      expect(replacement).toMatchObject({ plate: "COR123", color: "Rojo", brand: null });
      expect(await db.stay.count({ where: { plate: "COR123", status: "ACTIVE" } })).toBe(1);
    });
  });

  it("records ESTADIA_CORREGIDA with the administrator, the IP and the replacement (NFR-12)", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const stayId = await enter(db, setup, "COR128");

      const result = await correct(db, setup, stayId, { plate: "COR123" });

      if (!result.ok) throw new Error(result.reason);
      const events = await db.auditEvent.findMany({ where: { action: "STAY_CORRECTED", ip: IP } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        userId: setup.administratorId,
        entity: "estadia",
        entityId: result.stayId,
        ip: IP,
        occurredAt: CORRECTED_AT,
        detail: null,
      });
    });
  });
});

describe("correctStay rejects, and writes nothing", () => {
  it("a plate without the format of the corrected type (FR-08, RI-01)", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const stayId = await enter(db, setup, "COR128");

      const asMotorcycle = await correct(db, setup, stayId, {
        plate: "COR123",
        vehicleType: "MOTORCYCLE",
      });
      const tooLong = await correct(db, setup, stayId, { plate: "COR1234" });

      expect(asMotorcycle).toEqual({ ok: false, reason: "invalidPlate" });
      expect(tooLong).toEqual({ ok: false, reason: "invalidPlate" });
      const stay = await db.stay.findUniqueOrThrow({ where: { id: stayId } });
      expect(stay.status).toBe("ACTIVE");
      expect(await correctionEvents(db)).toBe(0);
    });
  });

  it("a stay that does not exist", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);

      expect(await correct(db, setup, 2_147_483_647, { plate: "COR123" })).toEqual({
        ok: false,
        reason: "notFound",
      });
      expect(await correctionEvents(db)).toBe(0);
    });
  });

  it("a stay that already left, or that was already voided or corrected (RI-04)", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const closedId = await enter(db, setup, "COR128");
      await db.stay.update({
        where: { id: closedId },
        data: { status: "CLOSED", exitTime: CORRECTED_AT, exitById: setup.operatorId },
      });
      const correctedId = await enter(db, setup, "COR127");
      const first = await correct(db, setup, correctedId, { plate: "COR126" });
      if (!first.ok) throw new Error(first.reason);

      const closed = await correct(db, setup, closedId, { plate: "COR123" });
      const again = await correct(db, setup, correctedId, { plate: "COR125" });
      // The same correction twice, as when two administrators send it at once.
      const twice = await correct(db, setup, correctedId, { plate: "COR126" });

      expect(closed).toEqual({ ok: false, reason: "notActive" });
      expect(again).toEqual({ ok: false, reason: "notActive" });
      expect(twice).toEqual({ ok: false, reason: "notActive" });
      expect(await db.stay.count({ where: { replacesId: correctedId } })).toBe(1);
      expect(await db.stay.count({ where: { replacesId: closedId } })).toBe(0);
      expect(await correctionEvents(db)).toBe(1);
    });
  });

  it("a correction that changes nothing, once the plate is normalized", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const stayId = await enter(db, setup, "COR123", "CAR", "Kia");

      const result = await correct(db, setup, stayId, {
        plate: "cor-123",
        color: " Azul ",
        brand: "Kia",
      });

      expect(result).toEqual({ ok: false, reason: "noChanges" });
      const stay = await db.stay.findUniqueOrThrow({ where: { id: stayId } });
      expect(stay.status).toBe("ACTIVE");
      expect(await correctionEvents(db)).toBe(0);
    });
  });

  it("a corrected plate that another stay has active (RI-02)", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      await enter(db, setup, "COR123");
      const stayId = await enter(db, setup, "COR128");

      const result = await correct(db, setup, stayId, { plate: "COR123" });

      expect(result).toEqual({ ok: false, reason: "plateActive" });
      const stay = await db.stay.findUniqueOrThrow({ where: { id: stayId } });
      expect(stay.status).toBe("ACTIVE");
      expect(await db.stay.count({ where: { plate: "COR123", status: "ACTIVE" } })).toBe(1);
      expect(await correctionEvents(db)).toBe(0);
    });
  });
});

describe("correctStay with another vehicle type (BR-11, BR-19)", () => {
  it("takes the rate of the new type in force at the original entry, not the current one", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const stayId = await enter(db, setup, "COR12A", "MOTORCYCLE");
      const carAtEntry = await db.rate.findFirstOrThrow({
        where: { vehicleType: "CAR", validTo: null },
      });
      // The car rate changes after the entry and before the correction.
      const changed = await setRate(db, {
        vehicleType: "CAR",
        valuePerMinute: 200,
        createdById: setup.administratorId,
        now: new Date("2026-11-09T14:00:00.000Z"),
      });
      if (!changed.ok) throw new Error("setup failed");

      const result = await correct(db, setup, stayId, { plate: "COR123", vehicleType: "CAR" });

      if (!result.ok) throw new Error(result.reason);
      const replacement = await db.stay.findUniqueOrThrow({ where: { id: result.stayId } });
      expect(replacement).toMatchObject({ vehicleType: "CAR", rateId: carAtEntry.id });
      expect(replacement.rateId).not.toBe(changed.rateId);
    });
  });

  it("rejects it when the new type had no rate at the original entry, and writes nothing", async () => {
    await asApp(async (db) => {
      // The motorcycle rate starts after the car entered.
      const setup = await setUp(db, { motorcycleRateFrom: new Date("2026-11-09T14:00:00.000Z") });
      const stayId = await enter(db, setup, "COR123");

      const result = await correct(db, setup, stayId, {
        plate: "COR12A",
        vehicleType: "MOTORCYCLE",
      });

      expect(result).toEqual({ ok: false, reason: "noRate" });
      const stay = await db.stay.findUniqueOrThrow({ where: { id: stayId } });
      expect(stay.status).toBe("ACTIVE");
      expect(await correctionEvents(db)).toBe(0);
    });
  });

  // Passes from the start, on purpose: the correction never counted spaces. The
  // vehicle is already inside, and BR-19 does not affect the vehicles inside.
  it("corrects it even when the new type has no spaces left", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const changedBy = { userId: setup.administratorId, ip: IP };
      const full = await setCapacity(db, {
        vehicleType: "CAR",
        spaces: 1,
        now: RATES_FROM,
        changedBy,
      });
      if (!full.ok) throw new Error("setup failed");
      await enter(db, setup, "COR123");
      const stayId = await enter(db, setup, "COR12A", "MOTORCYCLE");

      const result = await correct(db, setup, stayId, { plate: "COR124", vehicleType: "CAR" });

      expect(result).toMatchObject({ ok: true });
      expect(await db.stay.count({ where: { vehicleType: "CAR", status: "ACTIVE" } })).toBe(2);
      expect(await db.stay.count({ where: { vehicleType: "MOTORCYCLE", status: "ACTIVE" } })).toBe(
        0,
      );
    });
  });

  it("takes the lock of the replacement's type before reading the stay", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const stayId = await enter(db, setup, "COR12A", "MOTORCYCLE");
      const calls: string[] = [];
      const recorded = new Proxy(db, {
        get(object, property) {
          if (property === "stay") {
            return new Proxy(object.stay, {
              get(stay, method) {
                const value = Reflect.get(stay, method);
                if (typeof value !== "function") return value;
                return (...args: unknown[]) => {
                  calls.push(`stay.${String(method)}`);
                  return value.apply(stay, args);
                };
              },
            });
          }
          if (property === "$executeRaw") {
            return (query: TemplateStringsArray, ...values: unknown[]) => {
              calls.push(`lock ${values[1]}`);
              return object.$executeRaw(query, ...values);
            };
          }
          return Reflect.get(object, property);
        },
      });

      const result = await correct(recorded, setup, stayId, {
        plate: "COR123",
        vehicleType: "CAR",
      });

      expect(result).toMatchObject({ ok: true });
      // 1 is the key of cars (capacity.ts).
      expect(calls.slice(0, 2)).toEqual(["lock 1", "stay.findUnique"]);
    });
  });

  it("voids nothing if the stay left after it was read, as when an exit gets there first (RI-04)", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const stayId = await enter(db, setup, "COR128");
      // The exit closes the stay right before the correction voids it.
      const exitFirst = new Proxy(db, {
        get(object, property) {
          if (property === "stay") {
            return new Proxy(object.stay, {
              get(stay, method) {
                if (method === "updateMany") {
                  return async (args: Prisma.StayUpdateManyArgs) => {
                    await object.stay.update({
                      where: { id: stayId },
                      data: {
                        status: "CLOSED",
                        exitTime: CORRECTED_AT,
                        exitById: setup.operatorId,
                      },
                    });
                    return object.stay.updateMany(args);
                  };
                }
                return Reflect.get(stay, method);
              },
            });
          }
          return Reflect.get(object, property);
        },
      });

      const result = await correct(exitFirst, setup, stayId, { plate: "COR123" });

      expect(result).toEqual({ ok: false, reason: "notActive" });
      const stay = await db.stay.findUniqueOrThrow({ where: { id: stayId } });
      expect(stay.status).toBe("CLOSED");
      expect(await db.stay.count({ where: { replacesId: stayId } })).toBe(0);
      expect(await correctionEvents(db)).toBe(0);
    });
  });
});

// A transaction on another connection holds the lock of a vehicle type until the
// test lets it go. It writes nothing, so the correction waits only for the lock.
async function holdLock(vehicleType: VehicleType) {
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
  await Promise.race([lockTaken, transaction]);
  return { release, transaction };
}

describe("correctStay at the same time as an entry of the new type (BR-19)", () => {
  it("waits until the transaction holding the lock of the replacement's type ends", async () => {
    const holder = await holdLock("CAR");
    let corrected = false;
    const correction = asApp(async (db) => {
      const setup = await setUp(db);
      const stayId = await enter(db, setup, "COR12A", "MOTORCYCLE");
      expect(
        await correct(db, setup, stayId, { plate: "COR123", vehicleType: "CAR" }),
      ).toMatchObject({ ok: true });
      corrected = true;
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(corrected).toBe(false);
    } finally {
      holder.release();
      await holder.transaction;
      await correction;
    }
    expect(corrected).toBe(true);
  });

  it("does not wait for the lock of the type it leaves", async () => {
    const holder = await holdLock("MOTORCYCLE");
    let corrected = false;
    try {
      await asApp(async (db) => {
        // The motorcycle entered before the lock was taken: only the correction runs now.
        const setup = await setUp(db);
        const stayId = await db.stay.create({
          data: {
            plate: "COR12A",
            vehicleType: "MOTORCYCLE",
            color: "Azul",
            entryTime: ENTRY,
            entryById: setup.operatorId,
            rateId: (
              await db.rate.findFirstOrThrow({
                where: { vehicleType: "MOTORCYCLE", validTo: null },
              })
            ).id,
            gracePeriodId: (await db.gracePeriod.findFirstOrThrow({ where: { validTo: null } })).id,
          },
        });
        const result = await correct(db, setup, stayId.id, { plate: "COR123", vehicleType: "CAR" });
        expect(result).toMatchObject({ ok: true });
        corrected = true;
      });
    } finally {
      holder.release();
      await holder.transaction;
    }
    expect(corrected).toBe(true);
  });
});
