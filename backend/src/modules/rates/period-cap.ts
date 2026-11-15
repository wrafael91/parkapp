import type { Prisma } from "../../generated/prisma/client.js";
import type { ChangedBy } from "./rate-settings.js";

// Receives the transaction it runs in, like the rate settings.
type Db = Prisma.TransactionClient;

// RI-20: a period lasts from 1 to 24 whole hours (BR-18).
const MAX_PERIOD_HOURS = 24;

interface SetPeriodCapInput {
  hours: number;
  value: number;
  now: Date;
  changedBy: ChangedBy;
}

export type SetPeriodCapResult =
  { ok: true; periodCapId: number } | { ok: false; reason: "invalidHours" | "invalidValue" };

// BR-18: the administrator turns the cap on or changes it from the app. Unlike the
// rate, no bootstrap script sets it: with no cap, stays are charged by the minute.
export async function setPeriodCap(db: Db, input: SetPeriodCapInput): Promise<SetPeriodCapResult> {
  // RI-20: whole hours from 1 to 24, and whole pesos greater than zero.
  if (!Number.isInteger(input.hours) || input.hours < 1 || input.hours > MAX_PERIOD_HOURS) {
    return { ok: false, reason: "invalidHours" };
  }
  if (!Number.isInteger(input.value) || input.value <= 0) {
    return { ok: false, reason: "invalidValue" };
  }
  // BR-11 and RI-08: as with the rate, the current version is closed and a new one
  // starts, so every stay keeps the cap it entered with.
  await db.periodCap.updateMany({ where: { validTo: null }, data: { validTo: input.now } });
  const periodCap = await db.periodCap.create({
    data: {
      hours: input.hours,
      value: input.value,
      validFrom: input.now,
      createdById: input.changedBy.userId,
    },
  });
  // NFR-12: with the user and the IP, as TARIFA_CAMBIADA from the app.
  await db.auditEvent.create({
    data: {
      action: "PERIOD_CAP_CHANGED",
      userId: input.changedBy.userId,
      entity: "tope_periodo",
      entityId: periodCap.id,
      ip: input.changedBy.ip,
      occurredAt: input.now,
    },
  });
  return { ok: true, periodCapId: periodCap.id };
}

interface DeactivatePeriodCapInput {
  now: Date;
  changedBy: ChangedBy;
}

export type DeactivatePeriodCapResult = { ok: true } | { ok: false; reason: "noPeriodCap" };

// BR-18: the cap can be turned off. The current version is closed and none starts,
// so new stays have no cap; the ones already inside keep theirs (BR-11).
export async function deactivatePeriodCap(
  db: Db,
  input: DeactivatePeriodCapInput,
): Promise<DeactivatePeriodCapResult> {
  const current = await db.periodCap.findFirst({ where: { validTo: null } });
  if (current === null) {
    return { ok: false, reason: "noPeriodCap" };
  }
  // RI-08: closed once. If another request closed it first, this one updates
  // nothing and answers as if the cap were already off.
  const closed = await db.periodCap.updateMany({
    where: { id: current.id, validTo: null },
    data: { validTo: input.now },
  });
  if (closed.count === 0) {
    return { ok: false, reason: "noPeriodCap" };
  }
  // The event points to the closed version: its vigente_hasta is the time of the
  // event, and no version starts then (docs/modelo-datos.md, section 4.1).
  await db.auditEvent.create({
    data: {
      action: "PERIOD_CAP_CHANGED",
      userId: input.changedBy.userId,
      entity: "tope_periodo",
      entityId: current.id,
      ip: input.changedBy.ip,
      occurredAt: input.now,
    },
  });
  return { ok: true };
}
