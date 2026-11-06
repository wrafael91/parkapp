import type { Prisma, Role } from "../../generated/prisma/client.js";
import { verifyPassword } from "./password.js";
import { isSessionActive, sessionExpiry } from "./session-policy.js";
import { createSessionToken, hashSessionToken } from "./session-token.js";

// Each function receives the transaction it runs in, so the route decides the
// transaction and the tests can run everything as parkapp_app and roll back.
type Db = Prisma.TransactionClient;

export interface SessionUser {
  id: number;
  name: string;
  role: Role;
  mustChangePassword: boolean;
}

export type SignInResult = { ok: true; token: string; user: SessionUser } | { ok: false };

// Verified when the email does not exist, so that answer takes as long as a
// wrong password and the response time does not reveal which accounts exist.
const UNKNOWN_ACCOUNT_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$D8aoTOr0ny0XLrY0IrZLaA$oAoZA1F5umSGJ9cpiE6tRJIZTGGjqX8NlysJDgmQz+c";

interface SignInInput {
  email: string;
  password: string;
  ip: string;
  now: Date;
}

// FR-01. Every failure gets the same answer; only the audit log keeps the
// reason (docs/modelo-datos.md, 4.1). The audit log never stores the password
// or the token (RI-14).
export async function signIn(db: Db, input: SignInInput): Promise<SignInResult> {
  // RI-15: emails are stored and looked up in lowercase, without spaces.
  const email = input.email.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });

  if (user === null) {
    await verifyPassword(UNKNOWN_ACCOUNT_HASH, input.password);
    await logFailure(db, null, "CUENTA_INEXISTENTE", input.ip);
    return { ok: false };
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    await logFailure(db, user.id, "CREDENCIALES_INVALIDAS", input.ip);
    return { ok: false };
  }
  if (!user.active) {
    await logFailure(db, user.id, "CUENTA_DESACTIVADA", input.ip);
    return { ok: false };
  }

  const { token, tokenHash } = createSessionToken();
  const session = await db.session.create({
    data: {
      userId: user.id,
      tokenHash,
      ip: input.ip,
      createdAt: input.now,
      lastActivityAt: input.now,
      expiresAt: sessionExpiry(input.now),
    },
  });
  await db.auditEvent.create({
    data: {
      action: "LOGIN_SUCCEEDED",
      userId: user.id,
      entity: "sesion",
      entityId: session.id,
      ip: input.ip,
    },
  });
  return { ok: true, token, user: toSessionUser(user) };
}

// NFR-04: returns the user of an active session and refreshes its last
// activity, or null if the session is unknown, expired, revoked or belongs to
// a deactivated account.
export async function authenticate(
  db: Db,
  input: { token: string; now: Date },
): Promise<SessionUser | null> {
  const session = await db.session.findUnique({
    where: { tokenHash: hashSessionToken(input.token) },
    include: { user: true },
  });
  if (session === null || !isSessionActive(session, input.now) || !session.user.active) {
    return null;
  }
  await db.session.update({ where: { id: session.id }, data: { lastActivityAt: input.now } });
  return toSessionUser(session.user);
}

// FR-02: revokes the session at once (NFR-04). An unknown token changes nothing.
export async function signOut(db: Db, input: { token: string; now: Date }): Promise<void> {
  await db.session.updateMany({
    where: { tokenHash: hashSessionToken(input.token), revokedAt: null },
    data: { revokedAt: input.now },
  });
}

async function logFailure(db: Db, userId: number | null, reason: string, ip: string) {
  // The person is not authenticated, so userId stays null; the account, if it
  // exists, is the entity of the event.
  await db.auditEvent.create({
    data: {
      action: "LOGIN_FAILED",
      entity: userId === null ? null : "usuario",
      entityId: userId,
      detail: { motivo: reason },
      ip,
    },
  });
}

function toSessionUser(user: SessionUser): SessionUser {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
}
