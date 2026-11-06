// NFR-04: a session ends after 30 minutes without activity, and at most
// 12 hours after sign-in. Signing out revokes it at once (revokedAt).
const IDLE_TIMEOUT_MS = 30 * 60_000;
const MAX_LIFETIME_MS = 12 * 60 * 60_000;

export interface SessionTimes {
  lastActivityAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export function sessionExpiry(signedInAt: Date): Date {
  return new Date(signedInAt.getTime() + MAX_LIFETIME_MS);
}

export function isSessionActive(session: SessionTimes, now: Date): boolean {
  const idleMs = now.getTime() - session.lastActivityAt.getTime();
  return (
    session.revokedAt === null &&
    idleMs < IDLE_TIMEOUT_MS &&
    now.getTime() < session.expiresAt.getTime()
  );
}
