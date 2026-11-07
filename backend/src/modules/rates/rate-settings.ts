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
