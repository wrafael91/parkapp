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

// FR-15: the administrator voids an active or closed stay (BR-12).
export async function voidStay(_db: Db, _input: VoidStayInput): Promise<VoidStayResult> {
  throw new Error("Not implemented");
}
