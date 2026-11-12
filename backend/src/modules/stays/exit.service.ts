import { calculateFee } from "../../domain/fee.js";
import type { Prisma } from "../../generated/prisma/client.js";

// Receives the transaction it runs in, like the entry service.
type Db = Prisma.TransactionClient;

interface RegisterExitInput {
  stayId: number;
  userId: number;
  ip: string;
  now: Date;
}

export type RegisterExitResult =
  { ok: true; receiptId: number } | { ok: false; reason: "notFound" | "notActive" };

// FR-12 to FR-14. The server assigns the exit time and the user (BR-16).
export async function registerExit(db: Db, input: RegisterExitInput): Promise<RegisterExitResult> {
  const stay = await db.stay.findUnique({
    where: { id: input.stayId },
    include: { rate: true, gracePeriod: true },
  });
  if (stay === null) {
    return { ok: false, reason: "notFound" };
  }
  // BR-11: the rate and the grace period stored with the stay, the ones in
  // force at entry. The fee is calculated before writing: a RangeError leaves
  // the stay active and issues no receipt.
  const fee = calculateFee({
    entryTime: stay.entryTime,
    exitTime: input.now,
    valuePerMinute: stay.rate.valuePerMinute,
    gracePeriodMinutes: stay.gracePeriod.minutes,
  });
  // RI-04: only an active stay is closed; a closed or voided one keeps its data.
  // The condition also makes two simultaneous exits of the same stay close it
  // once: the second one waits for the row and then updates nothing.
  const closed = await db.stay.updateMany({
    where: { id: stay.id, status: "ACTIVE" },
    data: { status: "CLOSED", exitTime: input.now, exitById: input.userId },
  });
  if (closed.count === 0) {
    return { ok: false, reason: "notActive" };
  }
  // RI-11 and RI-12: one receipt per exit, in the same transaction, with the
  // results of the calculation as they are (data model, decision 5).
  const receipt = await db.receipt.create({ data: { stayId: stay.id, ...fee } });
  await db.auditEvent.create({
    data: {
      action: "EXIT_REGISTERED",
      userId: input.userId,
      entity: "estadia",
      entityId: stay.id,
      ip: input.ip,
      occurredAt: input.now,
    },
  });
  return { ok: true, receiptId: receipt.id };
}
