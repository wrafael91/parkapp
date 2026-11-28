import type { Prisma } from "../../generated/prisma/client.js";
import { hashPassword, isAcceptableLength, verifyPassword } from "./password.js";
import { hashSessionToken } from "./session-token.js";

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

export type ChangeOwnPasswordResult =
  { ok: true } | { ok: false; reason: "passwordLength" | "wrongPassword" | "samePassword" };

// US-05, FR-06: a signed-in user changes his own password, including the
// mandatory change of a password someone else assigned (RI-16).
export async function changeOwnPassword(
  db: Db,
  input: ChangeOwnPasswordInput,
): Promise<ChangeOwnPasswordResult> {
  // NFR-02: from 15 to 64 characters. The leaked password list comes with #50.
  if (!isAcceptableLength(input.newPassword)) {
    return { ok: false, reason: "passwordLength" };
  }
  const user = await db.user.findUniqueOrThrow({ where: { id: input.userId } });
  // An open session is not enough: whoever left it open is not asked again.
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    return { ok: false, reason: "wrongPassword" };
  }
  // RI-16: whoever assigned the current password knows it, so the new one must
  // be different. It is not a composition rule (NFR-02).
  if (await verifyPassword(user.passwordHash, input.newPassword)) {
    return { ok: false, reason: "samePassword" };
  }
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false },
  });
  // NFR-04: the other sessions end now; the one that made the change stays.
  await db.session.updateMany({
    where: {
      userId: user.id,
      revokedAt: null,
      tokenHash: { not: hashSessionToken(input.token) },
    },
    data: { revokedAt: input.now },
  });
  // It never stores the password (RI-14).
  await db.auditEvent.create({
    data: {
      action: "PASSWORD_CHANGED",
      userId: user.id,
      entity: "usuario",
      entityId: user.id,
      ip: input.ip,
      occurredAt: input.now,
    },
  });
  return { ok: true };
}
