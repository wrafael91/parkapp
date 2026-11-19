import type { Prisma, VehicleType } from "../../generated/prisma/client.js";
import type { ChangedBy } from "../rates/rate-settings.js";

// Receives the transaction it runs in, like the rate settings.
type Db = Prisma.TransactionClient;

export async function lockVehicleType(_db: Db, _vehicleType: VehicleType): Promise<void> {
  throw new Error("Not implemented");
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

export async function setCapacity(_db: Db, _input: SetCapacityInput): Promise<SetCapacityResult> {
  throw new Error("Not implemented");
}
