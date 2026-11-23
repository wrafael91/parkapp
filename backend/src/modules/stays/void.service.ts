import type { Prisma } from "../../generated/prisma/client.js";

// Receives the transaction it runs in, like the entry and exit services.
type Db = Prisma.TransactionClient;

interface VoidStayInput {
  stayId: number;
  // The state the administrator saw: active or closed (FR-15).
  seen: "ACTIVE" | "CLOSED";
  reason: string;
  userId: number;
  ip: string;
  now: Date;
}

export type VoidStayResult =
  { ok: true } | { ok: false; reason: "notFound" | "alreadyVoided" | "changed" };

// FR-15: the administrator voids an active or closed stay, with a reason. Nothing
// is deleted or edited (BR-12): the stay keeps its data and, if it was closed, its
// exit and its receipt, which is void because its stay is (data model, decision
// 5). The server sets the time and the user (BR-16).
export async function voidStay(db: Db, input: VoidStayInput): Promise<VoidStayResult> {
  const stay = await db.stay.findUniqueOrThrow({ where: { id: input.stayId } });
  await db.stay.update({
    where: { id: stay.id },
    data: {
      status: "VOIDED",
      voidedAt: input.now,
      voidedById: input.userId,
      voidReason: input.reason,
    },
  });
  // The reason stays in the stay, so the event has no detail (data model, 4.1).
  await db.auditEvent.create({
    data: {
      action: "STAY_VOIDED",
      userId: input.userId,
      entity: "estadia",
      entityId: stay.id,
      ip: input.ip,
      occurredAt: input.now,
    },
  });
  return { ok: true };
}
