import type { Prisma } from "../../generated/prisma/client.js";
import { hashPassword, isAcceptableLength } from "./password.js";

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
  db: Db,
  input: CreateOperatorInput,
): Promise<CreateOperatorResult> {
  // NFR-02: from 15 to 64 characters. The leaked password list comes with #50.
  if (!isAcceptableLength(input.password)) {
    return { ok: false, reason: "passwordLength" };
  }
  // RI-15: emails are stored in lowercase, without spaces.
  const email = input.email.trim().toLowerCase();
  if ((await db.user.findUnique({ where: { email } })) !== null) {
    return { ok: false, reason: "emailInUse" };
  }
  const user = await db.user.create({
    data: {
      name: input.name.trim(),
      email,
      passwordHash: await hashPassword(input.password),
      role: "OPERATOR",
      // RI-16: the administrator knows the initial password, so it must change.
      // US-05 makes the change mandatory before any other action.
      mustChangePassword: true,
      createdAt: input.now,
    },
  });
  // The password never reaches the audit log (RI-14).
  await db.auditEvent.create({
    data: {
      action: "ACCOUNT_CREATED",
      userId: input.createdBy.userId,
      entity: "usuario",
      entityId: user.id,
      ip: input.createdBy.ip,
      occurredAt: input.now,
    },
  });
  return { ok: true, userId: user.id };
}

interface SetAccountActiveInput {
  userId: number;
  active: boolean;
  now: Date;
  changedBy: ChangedBy;
}

export type SetAccountActiveResult =
  { ok: true } | { ok: false; reason: "notFound" | "notOperator" | "alreadyInState" };

// US-03, FR-04: an administrator deactivates or reactivates an operator
// account. Accounts are never deleted, so every record keeps who made it
// (BR-02, BR-12).
export async function setAccountActive(
  db: Db,
  input: SetAccountActiveInput,
): Promise<SetAccountActiveResult> {
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (user === null) return { ok: false, reason: "notFound" };
  // Only operator accounts, so the only administrator cannot lock himself out.
  if (user.role !== "OPERATOR") return { ok: false, reason: "notOperator" };
  if (user.active === input.active) return { ok: false, reason: "alreadyInState" };
  await db.user.update({ where: { id: user.id }, data: { active: input.active } });
  if (!input.active) {
    // NFR-04: the open sessions end now. Authentication already rejects an
    // inactive account; revoking them keeps a reactivation from reviving them.
    await db.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: input.now },
    });
  }
  await db.auditEvent.create({
    data: {
      action: input.active ? "ACCOUNT_REACTIVATED" : "ACCOUNT_DEACTIVATED",
      userId: input.changedBy.userId,
      entity: "usuario",
      entityId: user.id,
      ip: input.changedBy.ip,
      occurredAt: input.now,
    },
  });
  return { ok: true };
}
