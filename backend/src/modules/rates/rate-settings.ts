import type { Prisma, VehicleType } from "../../generated/prisma/client.js";

// Receives the transaction it runs in, like the session service.
type Db = Prisma.TransactionClient;

// Who changed a value from the app (US-11 and US-12). The bootstrap script
// leaves it out: it acts as the system, so its events have no user and no IP.
export interface ChangedBy {
  userId: number;
  ip: string;
}

// NFR-12 and RI-18: the user and the IP go together, or neither does.
function auditActor(changedBy: ChangedBy | undefined) {
  return changedBy === undefined ? {} : { userId: changedBy.userId, ip: changedBy.ip };
}

interface SetRateInput {
  vehicleType: VehicleType;
  valuePerMinute: number;
  createdById: number;
  now: Date;
  changedBy?: ChangedBy;
}

export type SetRateResult =
  | { ok: true; rateId: number }
  | { ok: false; reason: "invalidValue" | "noLegalCap" }
  | { ok: false; reason: "aboveLegalCap"; legalCap: number };

// FR-16: the administrator from the app (US-11), or the bootstrap script.
export async function setRate(db: Db, input: SetRateInput): Promise<SetRateResult> {
  // RI-09: whole pesos per minute, VAT included (BR-09), greater than zero.
  if (!Number.isInteger(input.valuePerMinute) || input.valuePerMinute <= 0) {
    return { ok: false, reason: "invalidValue" };
  }
  const legalCap = await db.legalCap.findFirst({
    where: {
      vehicleType: input.vehicleType,
      validFrom: { lte: input.now },
      OR: [{ validTo: null }, { validTo: { gt: input.now } }],
    },
  });
  if (legalCap === null) {
    return { ok: false, reason: "noLegalCap" };
  }
  // BR-10: never above the current legal cap of its vehicle type.
  if (input.valuePerMinute > legalCap.valuePerMinute) {
    return { ok: false, reason: "aboveLegalCap", legalCap: legalCap.valuePerMinute };
  }
  // BR-11 and RI-08: a rate is never edited. The current version is closed and
  // a new one starts, so every stay keeps the rate it entered with.
  await db.rate.updateMany({
    where: { vehicleType: input.vehicleType, validTo: null },
    data: { validTo: input.now },
  });
  const rate = await db.rate.create({
    data: {
      vehicleType: input.vehicleType,
      valuePerMinute: input.valuePerMinute,
      legalCapId: legalCap.id,
      validFrom: input.now,
      createdById: input.createdById,
    },
  });
  // From the app, the event has the user and the IP (NFR-12). From the script,
  // a system event without either (RI-18), like CUENTA_CREADA; creada_por_id
  // keeps the account.
  await db.auditEvent.create({
    data: {
      action: "RATE_CHANGED",
      entity: "tarifa",
      entityId: rate.id,
      occurredAt: input.now,
      ...auditActor(input.changedBy),
    },
  });
  return { ok: true, rateId: rate.id };
}

interface SetGracePeriodInput {
  minutes: number;
  createdById: number;
  now: Date;
  changedBy?: ChangedBy;
}

export type SetGracePeriodResult =
  { ok: true; gracePeriodId: number } | { ok: false; reason: "invalidMinutes" };

// FR-17: the administrator from the app (US-12), or the bootstrap script.
export async function setGracePeriod(
  db: Db,
  input: SetGracePeriodInput,
): Promise<SetGracePeriodResult> {
  // RI-10: whole minutes, zero or more (zero means no grace period).
  if (!Number.isInteger(input.minutes) || input.minutes < 0) {
    return { ok: false, reason: "invalidMinutes" };
  }
  // BR-11 and RI-08: versions are closed, never edited, as with the rate.
  await db.gracePeriod.updateMany({
    where: { validTo: null },
    data: { validTo: input.now },
  });
  const gracePeriod = await db.gracePeriod.create({
    data: { minutes: input.minutes, validFrom: input.now, createdById: input.createdById },
  });
  // With the user and the IP from the app, as TARIFA_CAMBIADA (NFR-12, RI-18).
  await db.auditEvent.create({
    data: {
      action: "GRACE_PERIOD_CHANGED",
      entity: "periodo_gracia",
      entityId: gracePeriod.id,
      occurredAt: input.now,
      ...auditActor(input.changedBy),
    },
  });
  return { ok: true, gracePeriodId: gracePeriod.id };
}
