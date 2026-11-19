import { normalizePlate } from "../../domain/plate.js";
import type { Prisma, VehicleType } from "../../generated/prisma/client.js";
import { lockVehicleType } from "../capacity/capacity.js";

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
  | { ok: true; stayId: number }
  | { ok: false; reason: "invalidPlate" | "plateActive" | "noCapacity" };

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
  // BR-19: entries of the same vehicle type run one at a time from here until the
  // transaction ends, so the count below cannot miss a vehicle that another entry is
  // registering. Taking the lock before BR-03 also turns two simultaneous entries
  // of the same plate into one entry and one cloned-plate rejection.
  await lockVehicleType(db, input.vehicleType);
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
  // BR-19: free spaces are the current spaces of the type minus its active stays;
  // closed and voided stays do not count. A type without spaces has no limit. The
  // rejection is recorded with the rejected vehicle, which no stay keeps.
  const capacity = await db.capacity.findFirst({
    where: { vehicleType: input.vehicleType, validTo: null },
  });
  if (capacity !== null) {
    const inside = await db.stay.count({
      where: { vehicleType: input.vehicleType, status: "ACTIVE" },
    });
    if (inside >= capacity.spaces) {
      await db.auditEvent.create({
        data: {
          action: "ENTRY_REJECTED_NO_CAPACITY",
          userId: input.userId,
          entity: "cupo",
          entityId: capacity.id,
          detail: { placa: plate, color, marca: brand, dentro: inside },
          ip: input.ip,
          occurredAt: input.now,
        },
      });
      return { ok: false, reason: "noCapacity" };
    }
  }
  // BR-11 and RI-06: the stay keeps the rate, the grace period and the cap in force now.
  const current = {
    validFrom: { lte: input.now },
    OR: [{ validTo: null }, { validTo: { gt: input.now } }],
  };
  const rate = await db.rate.findFirstOrThrow({
    where: { vehicleType: input.vehicleType, ...current },
  });
  const gracePeriod = await db.gracePeriod.findFirstOrThrow({ where: current });
  // BR-18: the cap may be off. Then the stay keeps no cap and is charged by the minute.
  const periodCap = await db.periodCap.findFirst({ where: current });
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
      periodCapId: periodCap?.id ?? null,
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
