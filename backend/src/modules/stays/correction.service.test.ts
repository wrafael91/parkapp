import { afterAll, describe, expect, it } from "vitest";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma, VehicleType } from "../../generated/prisma/client.js";
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
