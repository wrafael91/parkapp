import { normalizePlate } from "../../domain/plate.js";
import type { Prisma, VehicleType } from "../../generated/prisma/client.js";

// Receives the transaction it runs in, like the session service.
type Db = Prisma.TransactionClient;

interface RegisterEntryInput {
  plate: string;
  vehicleType: VehicleType;
  color: string;
  brand?: string;
  userId: number;
  ip: string;
  now: Date;
}

export type RegisterEntryResult =
  { ok: true; stayId: number } | { ok: false; reason: "invalidPlate" };

// FR-07 and BR-02. The server assigns the entry time and the user (BR-16).
export async function registerEntry(
  db: Db,
  input: RegisterEntryInput,
): Promise<RegisterEntryResult> {
  const plate = normalizePlate(input.plate, input.vehicleType);
  if (plate === null) {
    return { ok: false, reason: "invalidPlate" };
  }
  // BR-11 and RI-06: the stay keeps the rate and the grace period in force now.
  const current = {
    validFrom: { lte: input.now },
    OR: [{ validTo: null }, { validTo: { gt: input.now } }],
  };
  const rate = await db.rate.findFirstOrThrow({
    where: { vehicleType: input.vehicleType, ...current },
  });
  const gracePeriod = await db.gracePeriod.findFirstOrThrow({ where: current });
  const brand = input.brand?.trim();
  const stay = await db.stay.create({
    data: {
      plate,
      vehicleType: input.vehicleType,
      color: input.color.trim(),
      brand: brand ? brand : null,
      entryTime: input.now,
      entryById: input.userId,
      rateId: rate.id,
      gracePeriodId: gracePeriod.id,
    },
  });
  await db.auditEvent.create({
    data: {
      action: "ENTRY_REGISTERED",
      userId: input.userId,
      entity: "estadia",
      entityId: stay.id,
      ip: input.ip,
      occurredAt: input.now,
    },
  });
  return { ok: true, stayId: stay.id };
}
