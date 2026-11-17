import type { Prisma } from "../../generated/prisma/client.js";

// Receives the transaction it runs in, like the session service.
type Db = Prisma.TransactionClient;

// Who made the change and from where, for the audit log (RI-18).
interface ChangedBy {
  userId: number;
  ip: string;
}

interface CreateOperatorInput {
  name: string;
  email: string;
  password: string;
  now: Date;
  createdBy: ChangedBy;
}

export type CreateOperatorResult =
  { ok: true; userId: number } | { ok: false; reason: "passwordLength" | "emailInUse" };

// US-02, FR-03: an administrator creates an operator account. There is no
// public sign-up, and administrators come only from the bootstrap script
// (requirements 1.3, decision 3).
export async function createOperator(
  _db: Db,
  _input: CreateOperatorInput,
): Promise<CreateOperatorResult> {
  throw new Error("Not implemented");
}
