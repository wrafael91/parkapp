import type { Prisma } from "../../generated/prisma/client.js";
import { hashPassword } from "./password.js";

// Receives the transaction it runs in, like the session service.
type Db = Prisma.TransactionClient;

interface ResetAdministratorPasswordInput {
  email: string;
  password: string;
  now: Date;
}

export type ResetAdministratorPasswordResult =
  { ok: true; userId: number } | { ok: false; reason: "notFound" };

// The recovery script resets an administrator's password when nobody can sign
// in as one: an operator's password is reset from the app (FR-05). Whoever runs
// the script proved who they are by signing in to AWS with MFA to open Session
// Manager (requisitos 1.3).
export async function resetAdministratorPassword(
  db: Db,
  input: ResetAdministratorPasswordInput,
): Promise<ResetAdministratorPasswordResult> {
  // RI-15: emails are stored and looked up in lowercase, without spaces.
  const email = input.email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  if (user === null) {
    return { ok: false, reason: "notFound" };
  }
  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(input.password),
      // RI-16: whoever runs the script knows the password, so it must change.
      mustChangePassword: true,
      // A lock for failed sign-ins (NFR-03) does not outlast a reset.
      lockedUntil: null,
    },
  });
  // NFR-04: the sessions opened with the old password end now.
  await db.session.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: input.now },
  });
  // The system resets it, not a person signed in to the app, so the event has
  // no user and no IP (RI-18). It never stores the password (RI-14).
  await db.auditEvent.create({
    data: {
      action: "PASSWORD_RESET",
      entity: "usuario",
      entityId: user.id,
      occurredAt: input.now,
    },
  });
  return { ok: true, userId: user.id };
}
