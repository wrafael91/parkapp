import { normalizePlate } from "../../domain/plate.js";
import type { Prisma, VehicleType } from "../../generated/prisma/client.js";
import { lockVehicleType } from "../capacity/capacity.js";

// Receives the transaction it runs in, like the entry and exit services.
type Db = Prisma.TransactionClient;

interface CorrectStayInput {
  stayId: number;
  plate: string;
  vehicleType: VehicleType;
  color: string;
  brand?: string | null;
  reason: string;
  userId: number;
  ip: string;
  now: Date;
}

export type CorrectStayResult =
  | { ok: true; stayId: number }
  | {
      ok: false;
      reason: "invalidPlate" | "notFound" | "notActive" | "noChanges" | "plateActive" | "noRate";
    };

// FR-21 for an active stay (BR-17): the administrator corrects the plate, the
// vehicle type, the color or the brand. Nothing is edited in place (BR-12): the
// stay is voided and a replacement takes its place, with the times the server
// registered (BR-16).
export async function correctStay(db: Db, input: CorrectStayInput): Promise<CorrectStayResult> {
  // FR-08 and RI-01: the plate must have the format of the corrected type.
  const plate = normalizePlate(input.plate, input.vehicleType);
  if (plate === null) {
    return { ok: false, reason: "invalidPlate" };
  }
  const color = input.color.trim();
  const brand = input.brand?.trim() || null;
  const stay = await db.stay.findUnique({ where: { id: input.stayId } });
  if (stay === null) {
    return { ok: false, reason: "notFound" };
  }
  if (stay.status !== "ACTIVE") {
    return { ok: false, reason: "notActive" };
  }
  if (
    plate === stay.plate &&
    input.vehicleType === stay.vehicleType &&
    color === stay.color &&
    brand === stay.brand
  ) {
    return { ok: false, reason: "noChanges" };
  }
  // RI-02: the corrected plate cannot be active in another stay.
  const active = await db.stay.findFirst({
    where: { plate, status: "ACTIVE", id: { not: stay.id } },
  });
  if (active !== null) {
    return { ok: false, reason: "plateActive" };
  }
  await db.stay.update({
    where: { id: stay.id },
    data: {
      status: "VOIDED",
      voidedAt: input.now,
      voidedById: input.userId,
      voidReason: input.reason,
    },
  });
  // RI-19: the replacement points to the voided stay and keeps its entry time and
  // the user who registered the entry.
  const replacement = await db.stay.create({
    data: {
      plate,
      vehicleType: input.vehicleType,
      color,
      brand,
      entryTime: stay.entryTime,
      entryById: stay.entryById,
      rateId: stay.rateId,
      gracePeriodId: stay.gracePeriodId,
      periodCapId: stay.periodCapId,
      replacesId: stay.id,
    },
  });
  await db.auditEvent.create({
    data: {
      action: "STAY_CORRECTED",
      userId: input.userId,
      entity: "estadia",
      entityId: replacement.id,
      ip: input.ip,
      occurredAt: input.now,
    },
  });
  return { ok: true, stayId: replacement.id };
}
