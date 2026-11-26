import type { Prisma } from "../../generated/prisma/client.js";

// Receives the transaction it runs in, like the session service.
type Db = Prisma.TransactionClient;

interface ResetAdministratorPasswordInput {
  email: string;
  password: string;
  now: Date;
}

export type ResetAdministratorPasswordResult =
  { ok: true; userId: number } | { ok: false; reason: "notFound" };

export async function resetAdministratorPassword(
  _db: Db,
  _input: ResetAdministratorPasswordInput,
): Promise<ResetAdministratorPasswordResult> {
  throw new Error("Not implemented yet");
}
