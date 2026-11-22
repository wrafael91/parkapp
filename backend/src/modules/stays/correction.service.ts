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

// FR-21 for an active stay (BR-17).
export async function correctStay(_db: Db, _input: CorrectStayInput): Promise<CorrectStayResult> {
  throw new Error("Not implemented");
}
