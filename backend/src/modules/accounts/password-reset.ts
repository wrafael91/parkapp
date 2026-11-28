import type { Prisma } from "../../generated/prisma/client.js";
import { hashPassword } from "./password.js";

// Receives the transaction it runs in, like the session service.
type Db = Prisma.TransactionClient;

interface PasswordResetInput {
  userId: number;
  password: string;
  now: Date;
  // The administrator and the IP, or null when the recovery script resets it.
  resetBy: { userId: number; ip: string } | null;
}

// The part of a reset that the recovery script (an administrator's account)
// and the app (an operator's account, US-04) share. Whoever calls it checks the
// length and the account first.
export async function applyPasswordReset(db: Db, input: PasswordResetInput): Promise<void> {
  await db.user.update({
    where: { id: input.userId },
    data: {
      passwordHash: await hashPassword(input.password),
      // RI-16: whoever resets it knows the password, so it must change.
      mustChangePassword: true,
      // A lock for failed sign-ins (NFR-03) does not outlast a reset.
      lockedUntil: null,
    },
  });
  // NFR-04: the sessions opened with the old password end now.
  await db.session.updateMany({
    where: { userId: input.userId, revokedAt: null },
    data: { revokedAt: input.now },
  });
  // Without resetBy it is a system event, without user or IP (RI-18). It never
  // stores the password (RI-14).
  await db.auditEvent.create({
    data: {
      action: "PASSWORD_RESET",
      userId: input.resetBy?.userId ?? null,
      entity: "usuario",
      entityId: input.userId,
      ip: input.resetBy?.ip ?? null,
      occurredAt: input.now,
    },
  });
}
