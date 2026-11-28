import type { Prisma } from "../../generated/prisma/client.js";

// Receives the transaction it runs in, like the session service.
type Db = Prisma.TransactionClient;

interface ChangeOwnPasswordInput {
  userId: number;
  // The token of the session that asks for the change, which stays open.
  token: string;
  currentPassword: string;
  newPassword: string;
  ip: string;
  now: Date;
}

export type ChangeOwnPasswordResult = { ok: true };

export async function changeOwnPassword(
  _db: Db,
  _input: ChangeOwnPasswordInput,
): Promise<ChangeOwnPasswordResult> {
  throw new Error("Not implemented yet");
}
