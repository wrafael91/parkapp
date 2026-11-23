import { afterAll, describe, expect, it } from "vitest";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { setCapacity } from "../capacity/capacity.js";
import { setGracePeriod, setRate } from "../rates/rate-settings.js";
import { closeCurrentVersions } from "../../versions.test-helper.js";
import { registerEntry } from "./entry.service.js";
import { registerExit } from "./exit.service.js";
import { voidStay } from "./void.service.js";

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
const EXIT = new Date("2026-11-09T13:30:00.000Z");
const VOIDED_AT = new Date("2026-11-09T15:00:00.000Z");
const IP = "203.0.113.58";

interface SetUp {
  operatorId: number;
  administratorId: number;
}

// An operator who registers the entries and exits, an administrator who voids
// them, and the production rates and grace period ($230, $161 and 5 minutes).
// The ANU plates are only for these tests, so a stay left active in the
// development database does not get in the way.
async function setUp(db: Prisma.TransactionClient): Promise<SetUp> {
  const operator = await db.user.create({
    data: {
      name: "Operador de anulaciones",
      email: "operador.anulaciones@example.com",
      passwordHash: "not-a-real-hash",
      role: "OPERATOR",
    },
  });
  const administrator = await db.user.create({
    data: {
      name: "Administrador de anulaciones",
      email: "admin.anulaciones@example.com",
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
    now: RATES_FROM,
  });
  const grace = await setGracePeriod(db, {
    minutes: 5,
    createdById: administrator.id,
    now: RATES_FROM,
  });
  if (!car.ok || !motorcycle.ok || !grace.ok) throw new Error("setup failed");
  return { operatorId: operator.id, administratorId: administrator.id };
}

async function enter(db: Prisma.TransactionClient, setup: SetUp, plate: string): Promise<number> {
  const result = await registerEntry(db, {
    plate,
    vehicleType: "CAR",
    color: "Azul",
    userId: setup.operatorId,
    ip: IP,
    now: ENTRY,
  });
  if (!result.ok) throw new Error(`entry failed: ${result.reason}`);
  return result.stayId;
}

async function leave(db: Prisma.TransactionClient, setup: SetUp, stayId: number) {
  const result = await registerExit(db, { stayId, userId: setup.operatorId, ip: IP, now: EXIT });
  if (!result.ok) throw new Error(`exit failed: ${result.reason}`);
}

// The administrator saw the stay active, unless the test says otherwise.
function voidIt(
  db: Prisma.TransactionClient,
  setup: SetUp,
  stayId: number,
  seen: "ACTIVE" | "CLOSED" = "ACTIVE",
) {
  return voidStay(db, {
    stayId,
    seen,
    reason: "El vehículo no entró",
    userId: setup.administratorId,
    ip: IP,
    now: VOIDED_AT,
  });
}

async function voidEvents(db: Prisma.TransactionClient): Promise<number> {
  return db.auditEvent.count({ where: { action: "STAY_VOIDED", ip: IP } });
}

describe("voidStay (FR-15, BR-12)", () => {
  it("voids an active stay with the reason, the administrator and the server time (case 25)", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const stayId = await enter(db, setup, "ANU123");

      const result = await voidIt(db, setup, stayId);

      expect(result).toEqual({ ok: true });
      const stay = await db.stay.findUniqueOrThrow({ where: { id: stayId } });
      expect(stay).toMatchObject({
        plate: "ANU123",
        status: "VOIDED",
        entryTime: ENTRY,
        exitTime: null,
        voidedAt: VOIDED_AT,
        voidedById: setup.administratorId,
        voidReason: "El vehículo no entró",
        replacesId: null,
      });
      expect(await db.stay.count({ where: { replacesId: stayId } })).toBe(0);
    });
  });

  it("voids a closed stay and keeps its exit and its receipt (case 26)", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const stayId = await enter(db, setup, "ANU123");
      await leave(db, setup, stayId);

      const result = await voidIt(db, setup, stayId, "CLOSED");

      expect(result).toEqual({ ok: true });
      const stay = await db.stay.findUniqueOrThrow({
        where: { id: stayId },
        include: { receipt: true },
      });
      expect(stay).toMatchObject({
        status: "VOIDED",
        exitTime: EXIT,
        exitById: setup.operatorId,
        voidedAt: VOIDED_AT,
        voidedById: setup.administratorId,
      });
      // 28 minutes at $230 with 5 of grace: the receipt is kept as it was issued.
      expect(stay.receipt).toMatchObject({ fullMinutes: 28, total: 6400 });
    });
  });

  it("frees the space of a voided active stay (BR-19)", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const full = await setCapacity(db, {
        vehicleType: "CAR",
        spaces: 1,
        now: RATES_FROM,
        changedBy: { userId: setup.administratorId, ip: IP },
      });
      if (!full.ok) throw new Error("setup failed");
      const stayId = await enter(db, setup, "ANU123");

      await voidIt(db, setup, stayId);

      // The space is free again: another car enters.
      const next = await registerEntry(db, {
        plate: "ANU124",
        vehicleType: "CAR",
        color: "Rojo",
        userId: setup.operatorId,
        ip: IP,
        now: VOIDED_AT,
      });
      expect(next).toMatchObject({ ok: true });
    });
  });

  it("records ESTADIA_ANULADA with the administrator, the IP and the stay, without detail (NFR-12)", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const stayId = await enter(db, setup, "ANU123");

      await voidIt(db, setup, stayId);

      const events = await db.auditEvent.findMany({ where: { action: "STAY_VOIDED", ip: IP } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        userId: setup.administratorId,
        entity: "estadia",
        entityId: stayId,
        ip: IP,
        occurredAt: VOIDED_AT,
        detail: null,
      });
      expect(await voidEvents(db)).toBe(1);
    });
  });
});

describe("voidStay rejects, and writes nothing", () => {
  it("a stay that does not exist", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);

      expect(await voidIt(db, setup, 2_147_483_647)).toEqual({ ok: false, reason: "notFound" });
      expect(await voidEvents(db)).toBe(0);
    });
  });

  it("a stay already voided, by a void or by a correction (RI-04)", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const voidedId = await enter(db, setup, "ANU123");
      const first = await voidIt(db, setup, voidedId);
      if (!first.ok) throw new Error(first.reason);
      const correctedId = await enter(db, setup, "ANU128");
      await db.stay.update({
        where: { id: correctedId },
        data: {
          status: "VOIDED",
          voidedAt: ENTRY,
          voidedById: setup.administratorId,
          voidReason: "Placa mal digitada",
        },
      });

      const again = await voidStay(db, {
        stayId: voidedId,
        seen: "ACTIVE",
        reason: "Otra vez",
        userId: setup.administratorId,
        ip: IP,
        now: EXIT,
      });
      const corrected = await voidIt(db, setup, correctedId);

      expect(again).toEqual({ ok: false, reason: "alreadyVoided" });
      expect(corrected).toEqual({ ok: false, reason: "alreadyVoided" });
      const voided = await db.stay.findUniqueOrThrow({ where: { id: voidedId } });
      expect(voided).toMatchObject({ voidedAt: VOIDED_AT, voidReason: "El vehículo no entró" });
      expect(await voidEvents(db)).toBe(1);
    });
  });

  it("a stay that is not as the administrator saw it, because an exit got there first (case 27)", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const stayId = await enter(db, setup, "ANU123");
      // History showed it inside; the operator registered its exit before the
      // administrator confirmed.
      await leave(db, setup, stayId);

      const result = await voidIt(db, setup, stayId, "ACTIVE");

      // The administrator decided on an active stay, not on a closed one with a
      // receipt: the void stops, and the screen shows the stay again.
      expect(result).toEqual({ ok: false, reason: "changed" });
      const stay = await db.stay.findUniqueOrThrow({ where: { id: stayId } });
      expect(stay).toMatchObject({ status: "CLOSED", voidedAt: null, voidReason: null });
      expect(await voidEvents(db)).toBe(0);
    });
  });

  it("a stay that left while the void was running", async () => {
    await asApp(async (db) => {
      const setup = await setUp(db);
      const stayId = await enter(db, setup, "ANU123");
      // The exit closes the stay right after the void reads it as active.
      const exitFirst = new Proxy(db, {
        get(object, property) {
          if (property === "stay") {
            return new Proxy(object.stay, {
              get(stay, method) {
                if (method === "findUnique") {
                  return async (args: Prisma.StayFindUniqueArgs) => {
                    const read = await object.stay.findUnique(args);
                    await object.stay.update({
                      where: { id: stayId },
                      data: { status: "CLOSED", exitTime: EXIT, exitById: setup.operatorId },
                    });
                    return read;
                  };
                }
                return Reflect.get(stay, method);
              },
            });
          }
          return Reflect.get(object, property);
        },
      });

      const result = await voidIt(exitFirst, setup, stayId);

      expect(result).toEqual({ ok: false, reason: "changed" });
      const stay = await db.stay.findUniqueOrThrow({ where: { id: stayId } });
      expect(stay).toMatchObject({ status: "CLOSED", voidedAt: null, voidReason: null });
      expect(await voidEvents(db)).toBe(0);
    });
  });
});
