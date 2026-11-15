import type { Prisma } from "../../generated/prisma/client.js";
import type { ChangedBy } from "./rate-settings.js";

// Receives the transaction it runs in, like the rate settings.
type Db = Prisma.TransactionClient;

interface SetPeriodCapInput {
  hours: number;
  value: number;
  now: Date;
  changedBy: ChangedBy;
}

export type SetPeriodCapResult =
  { ok: true; periodCapId: number } | { ok: false; reason: "invalidHours" | "invalidValue" };

// BR-18: turns the cap on or changes it (red of cycle E: not implemented yet).
export async function setPeriodCap(
  _db: Db,
  _input: SetPeriodCapInput,
): Promise<SetPeriodCapResult> {
  throw new Error("Not implemented");
}

interface DeactivatePeriodCapInput {
  now: Date;
  changedBy: ChangedBy;
}

export type DeactivatePeriodCapResult = { ok: true } | { ok: false; reason: "noPeriodCap" };

// BR-18: turns the cap off (red of cycle E: not implemented yet).
export async function deactivatePeriodCap(
  _db: Db,
  _input: DeactivatePeriodCapInput,
): Promise<DeactivatePeriodCapResult> {
  throw new Error("Not implemented");
}
