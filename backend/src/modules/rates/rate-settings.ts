import type { Prisma, VehicleType } from "../../generated/prisma/client.js";

// Receives the transaction it runs in, like the session service.
type Db = Prisma.TransactionClient;

interface SetRateInput {
  vehicleType: VehicleType;
  valuePerMinute: number;
  createdById: number;
  now: Date;
}

export type SetRateResult =
  | { ok: true; rateId: number }
  | { ok: false; reason: "invalidValue" | "noLegalCap" }
  | { ok: false; reason: "aboveLegalCap"; legalCap: number };

// The bootstrap script loads the rate (US-11 moves it to the app in Sprint 3).
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
  // The script acts as the system, not through a request, so the event has no
  // user and no IP (RI-18), like CUENTA_CREADA. creada_por_id keeps the account.
  await db.auditEvent.create({
    data: { action: "RATE_CHANGED", entity: "tarifa", entityId: rate.id, occurredAt: input.now },
  });
  return { ok: true, rateId: rate.id };
}

interface SetGracePeriodInput {
  minutes: number;
  createdById: number;
  now: Date;
}

export type SetGracePeriodResult =
  { ok: true; gracePeriodId: number } | { ok: false; reason: "invalidMinutes" };

// The bootstrap script loads the grace period (US-12 moves it to the app later).
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
  // A system event, like TARIFA_CAMBIADA from the script (RI-18).
  await db.auditEvent.create({
    data: {
      action: "GRACE_PERIOD_CHANGED",
      entity: "periodo_gracia",
      entityId: gracePeriod.id,
      occurredAt: input.now,
    },
  });
  return { ok: true, gracePeriodId: gracePeriod.id };
}
