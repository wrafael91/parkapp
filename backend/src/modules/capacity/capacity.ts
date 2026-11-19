import type { Prisma, VehicleType } from "../../generated/prisma/client.js";
import type { ChangedBy } from "../rates/rate-settings.js";

// Receives the transaction it runs in, like the rate settings.
type Db = Prisma.TransactionClient;

// RI-21: from 0 to 10,000 spaces per vehicle type. 0 means the lot does not take
// that type (lot B takes no motorcycles, docs/diagnostico.md).
export const MAX_SPACES = 10_000;

// BR-19: one transaction-level advisory lock per vehicle type, in namespace 19.
// Entries and changes of the spaces of the same type wait for each other, so two
// entries cannot both take the last space; a car never waits for a motorcycle.
// PostgreSQL releases the lock when the transaction commits or rolls back.
const LOCK_NAMESPACE = 19;
const LOCK_KEYS: Record<VehicleType, number> = { CAR: 1, MOTORCYCLE: 2 };

export async function lockVehicleType(db: Db, vehicleType: VehicleType): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACE}::int, ${LOCK_KEYS[vehicleType]}::int)`;
}

interface SetCapacityInput {
  vehicleType: VehicleType;
  // null removes the limit of the type.
  spaces: number | null;
  now: Date;
  changedBy: ChangedBy;
}

export type SetCapacityResult =
  | { ok: true; capacityId: number | null }
  | { ok: false; reason: "invalidSpaces" | "noCapacity" | "changedMeanwhile" };

// BR-19: the administrator sets the spaces of a vehicle type, or removes its limit.
export async function setCapacity(db: Db, input: SetCapacityInput): Promise<SetCapacityResult> {
  // RI-21: whole spaces from 0 to 10,000.
  if (
    input.spaces !== null &&
    (!Number.isInteger(input.spaces) || input.spaces < 0 || input.spaces > MAX_SPACES)
  ) {
    return { ok: false, reason: "invalidSpaces" };
  }
  await lockVehicleType(db, input.vehicleType);
  const current = await db.capacity.findFirst({
    where: { vehicleType: input.vehicleType, validTo: null },
  });
  if (input.spaces === null && current === null) {
    return { ok: false, reason: "noCapacity" };
  }
  // The time of the request is taken before the lock. If another administrator saved
  // the spaces of this type in the meantime, closing that version at an earlier time
  // would break RI-07, so this request is rejected and nothing is written.
  if (current !== null && current.validFrom >= input.now) {
    return { ok: false, reason: "changedMeanwhile" };
  }
  // BR-12 and RI-08: as with the rate, the current version is closed and a new one
  // starts; removing the limit closes it and starts none.
  if (current !== null) {
    await db.capacity.update({ where: { id: current.id }, data: { validTo: input.now } });
  }
  const created =
    input.spaces === null
      ? null
      : await db.capacity.create({
          data: {
            vehicleType: input.vehicleType,
            spaces: input.spaces,
            validFrom: input.now,
            createdById: input.changedBy.userId,
          },
        });
  // NFR-12: with the user and the IP. When the limit is removed, the event points to
  // the closed version, as when the period cap is turned off.
  await db.auditEvent.create({
    data: {
      action: "CAPACITY_CHANGED",
      userId: input.changedBy.userId,
      entity: "cupo",
      entityId: created?.id ?? current!.id,
      ip: input.changedBy.ip,
      occurredAt: input.now,
    },
  });
  return { ok: true, capacityId: created?.id ?? null };
}
