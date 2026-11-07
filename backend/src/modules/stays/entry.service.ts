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
  { ok: true; stayId: number } | { ok: false; reason: "invalidPlate" | "plateActive" };

// The values stored in the database (schema.prisma), for the audit log.
const VEHICLE_TYPE_VALUES: Record<VehicleType, string> = { CAR: "CARRO", MOTORCYCLE: "MOTO" };

// FR-07 and BR-02. The server assigns the entry time and the user (BR-16).
export async function registerEntry(
  db: Db,
  input: RegisterEntryInput,
): Promise<RegisterEntryResult> {
  const plate = normalizePlate(input.plate, input.vehicleType);
  if (plate === null) {
    return { ok: false, reason: "invalidPlate" };
  }
  const color = input.color.trim();
  const brand = input.brand?.trim() || null;
  // BR-03: a plate that is already inside may be a cloned plate. The attempt is
  // recorded with the rejected vehicle, which no stay keeps (FR-09).
  const active = await db.stay.findFirst({ where: { plate, status: "ACTIVE" } });
  if (active !== null) {
    await db.auditEvent.create({
      data: {
        action: "ENTRY_REJECTED_ACTIVE_PLATE",
        userId: input.userId,
        entity: "estadia",
        entityId: active.id,
        detail: { tipo_vehiculo: VEHICLE_TYPE_VALUES[input.vehicleType], color, marca: brand },
        ip: input.ip,
        occurredAt: input.now,
      },
    });
    return { ok: false, reason: "plateActive" };
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
  const stay = await db.stay.create({
    data: {
      plate,
      vehicleType: input.vehicleType,
      color,
      brand,
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
