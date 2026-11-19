import { afterAll, describe, expect, it } from "vitest";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { lockVehicleType, setCapacity } from "./capacity.js";
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

const IP = "203.0.113.40";
const NOW = new Date("2026-11-19T15:00:00.000Z");
const LATER = new Date("2026-11-19T16:00:00.000Z");

async function createAdmin(db: Prisma.TransactionClient) {
  const user = await db.user.create({
    data: {
      name: "Administrador de prueba",
      email: "admin.cupos@example.com",
      passwordHash: "not-a-real-hash",
      role: "ADMINISTRATOR",
    },
  });
  return { userId: user.id, ip: IP };
}

function currentCapacity(db: Prisma.TransactionClient, vehicleType: "CAR" | "MOTORCYCLE") {
  return db.capacity.findFirst({ where: { vehicleType, validTo: null } });
}

describe("setCapacity (BR-19)", () => {
  it("creates a version with the vehicle type, the spaces and the administrator", async () => {
    await asApp(async (db) => {
      const changedBy = await createAdmin(db);

      const result = await setCapacity(db, {
        vehicleType: "CAR",
        spaces: 30,
        now: NOW,
        changedBy,
      });

      expect(result).toEqual({ ok: true, capacityId: expect.any(Number) });
      expect(await currentCapacity(db, "CAR")).toMatchObject({
        spaces: 30,
        validFrom: NOW,
        validTo: null,
        createdById: changedBy.userId,
      });
      expect(await currentCapacity(db, "MOTORCYCLE")).toBeNull();
    });
  });

  it("closes the current version of the type and keeps it (BR-12, RI-08)", async () => {
    await asApp(async (db) => {
      const changedBy = await createAdmin(db);
      const motorcycles = { vehicleType: "MOTORCYCLE" as const, spaces: 250, now: NOW, changedBy };
      await setCapacity(db, motorcycles);
      const first = await setCapacity(db, { ...motorcycles, vehicleType: "CAR", spaces: 30 });

      const second = await setCapacity(db, {
        vehicleType: "CAR",
        spaces: 16,
        now: LATER,
        changedBy,
      });

      if (!first.ok || !second.ok || first.capacityId === null) throw new Error("not set");
      expect(
        await db.capacity.findUniqueOrThrow({ where: { id: first.capacityId } }),
      ).toMatchObject({ spaces: 30, validTo: LATER });
      expect(await currentCapacity(db, "CAR")).toMatchObject({ id: second.capacityId, spaces: 16 });
      // The other vehicle type keeps its spaces.
      expect(await currentCapacity(db, "MOTORCYCLE")).toMatchObject({ spaces: 250, validTo: null });
    });
  });

  it("accepts 0 spaces, so the lot takes no vehicles of that type, and 10,000 (RI-21)", async () => {
    await asApp(async (db) => {
      const changedBy = await createAdmin(db);

      const none = await setCapacity(db, {
        vehicleType: "MOTORCYCLE",
        spaces: 0,
        now: NOW,
        changedBy,
      });
      const most = await setCapacity(db, {
        vehicleType: "CAR",
        spaces: 10000,
        now: NOW,
        changedBy,
      });

      expect(none.ok && most.ok).toBe(true);
      expect(await currentCapacity(db, "MOTORCYCLE")).toMatchObject({ spaces: 0 });
      expect(await currentCapacity(db, "CAR")).toMatchObject({ spaces: 10000 });
    });
  });

  it("rejects spaces outside 0 to 10,000 or not whole, and writes nothing (RI-21)", async () => {
    await asApp(async (db) => {
      const changedBy = await createAdmin(db);
      await setCapacity(db, { vehicleType: "CAR", spaces: 30, now: NOW, changedBy });

      for (const spaces of [-1, 10001, 2.5, Number.NaN]) {
        const result = await setCapacity(db, { vehicleType: "CAR", spaces, now: LATER, changedBy });
        expect(result).toEqual({ ok: false, reason: "invalidSpaces" });
      }

      expect(await currentCapacity(db, "CAR")).toMatchObject({ spaces: 30, validTo: null });
      expect(await db.auditEvent.count({ where: { action: "CAPACITY_CHANGED" } })).toBe(1);
    });
  });

  it("removes the limit by closing the current version without starting another", async () => {
    await asApp(async (db) => {
      const changedBy = await createAdmin(db);
      const set = await setCapacity(db, { vehicleType: "CAR", spaces: 30, now: NOW, changedBy });

      const removed = await setCapacity(db, {
        vehicleType: "CAR",
        spaces: null,
        now: LATER,
        changedBy,
      });

      if (!set.ok || set.capacityId === null) throw new Error("not set");
      expect(removed).toEqual({ ok: true, capacityId: null });
      expect(await currentCapacity(db, "CAR")).toBeNull();
      expect(await db.capacity.findUniqueOrThrow({ where: { id: set.capacityId } })).toMatchObject({
        validTo: LATER,
      });
    });
  });

  it("answers noCapacity when the type has no limit to remove, and writes nothing", async () => {
    await asApp(async (db) => {
      const changedBy = await createAdmin(db);

      const result = await setCapacity(db, {
        vehicleType: "MOTORCYCLE",
        spaces: null,
        now: NOW,
        changedBy,
      });

      expect(result).toEqual({ ok: false, reason: "noCapacity" });
      expect(await db.auditEvent.count({ where: { action: "CAPACITY_CHANGED" } })).toBe(0);
    });
  });

  it("rejects a request older than the current version, and writes nothing (RI-07)", async () => {
    await asApp(async (db) => {
      const changedBy = await createAdmin(db);
      // Another administrator saved at LATER, while this request, taken at NOW,
      // waited for the lock.
      await setCapacity(db, { vehicleType: "CAR", spaces: 30, now: LATER, changedBy });

      for (const now of [NOW, LATER]) {
        const result = await setCapacity(db, { vehicleType: "CAR", spaces: 25, now, changedBy });
        expect(result).toEqual({ ok: false, reason: "changedMeanwhile" });
      }

      expect(await currentCapacity(db, "CAR")).toMatchObject({ spaces: 30, validTo: null });
      expect(await db.auditEvent.count({ where: { action: "CAPACITY_CHANGED" } })).toBe(1);
    });
  });

  it("records CUPO_CAMBIADO with the user, the IP and the version (NFR-12)", async () => {
    await asApp(async (db) => {
      const changedBy = await createAdmin(db);
      const set = await setCapacity(db, { vehicleType: "CAR", spaces: 30, now: NOW, changedBy });
      await setCapacity(db, { vehicleType: "CAR", spaces: null, now: LATER, changedBy });

      if (!set.ok) throw new Error("not set");
      const events = await db.auditEvent.findMany({
        where: { action: "CAPACITY_CHANGED" },
        orderBy: { id: "asc" },
      });
      // When the limit is removed, the event points to the closed version.
      expect(events).toEqual([
        expect.objectContaining({
          userId: changedBy.userId,
          entity: "cupo",
          entityId: set.capacityId,
          detail: null,
          ip: IP,
          occurredAt: NOW,
        }),
        expect.objectContaining({ entityId: set.capacityId, ip: IP, occurredAt: LATER }),
      ]);
    });
  });
});

// Two transactions at once, each on its own connection. The first one only takes
// the lock and holds it until the test lets it go: it does not close the current
// versions, whose row locks would make the second transaction wait for another
// reason. Nothing is committed.
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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("lockVehicleType (BR-19)", () => {
  it("makes a second transaction of the same type wait until the first one ends", async () => {
    const first = await holdLock("CAR");
    let secondDone = false;
    const second = asApp(async (db) => {
      await lockVehicleType(db, "CAR");
      secondDone = true;
    });
    try {
      await wait(300);
      expect(secondDone).toBe(false);
    } finally {
      first.release();
      await first.transaction;
      await second;
    }
    expect(secondDone).toBe(true);
  });

  it("does not make a motorcycle wait for a car", async () => {
    const car = await holdLock("CAR");
    let motorcycleDone = false;
    try {
      await asApp(async (db) => {
        await lockVehicleType(db, "MOTORCYCLE");
        motorcycleDone = true;
      });
    } finally {
      car.release();
      await car.transaction;
    }
    expect(motorcycleDone).toBe(true);
  });

  it("makes a change of the spaces wait for the lock of its type", async () => {
    const first = await holdLock("MOTORCYCLE");
    let changed = false;
    const change = asApp(async (db) => {
      const changedBy = await createAdmin(db);
      await setCapacity(db, { vehicleType: "MOTORCYCLE", spaces: 250, now: NOW, changedBy });
      changed = true;
    });
    try {
      await wait(300);
      expect(changed).toBe(false);
    } finally {
      first.release();
      await first.transaction;
      await change;
    }
    expect(changed).toBe(true);
  });
});
