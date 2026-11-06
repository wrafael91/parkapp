import { describe, expect, it } from "vitest";
import { isSessionActive, sessionExpiry } from "./session-policy.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const signedInAt = new Date("2026-11-05T13:00:00.000Z");

function session(lastActivityMinutes: number, revokedAt: Date | null = null) {
  return {
    lastActivityAt: new Date(signedInAt.getTime() + lastActivityMinutes * MINUTE),
    expiresAt: sessionExpiry(signedInAt),
    revokedAt,
  };
}

function at(minutesAfterSignIn: number): Date {
  return new Date(signedInAt.getTime() + minutesAfterSignIn * MINUTE);
}

describe("session expiry (NFR-04)", () => {
  it("expires 12 hours after sign-in", () => {
    expect(sessionExpiry(signedInAt).getTime() - signedInAt.getTime()).toBe(12 * HOUR);
  });

  it("is active right after sign-in", () => {
    expect(isSessionActive(session(0), at(0))).toBe(true);
  });

  it("is active after 29 minutes and 59 seconds without activity", () => {
    expect(isSessionActive(session(0), new Date(at(30).getTime() - 1000))).toBe(true);
  });

  it("ends after 30 minutes without activity", () => {
    expect(isSessionActive(session(0), at(30))).toBe(false);
  });

  it("ends at 12 hours even with recent activity", () => {
    expect(isSessionActive(session(12 * 60 - 1), new Date(at(12 * 60).getTime() - 1))).toBe(true);
    expect(isSessionActive(session(12 * 60 - 1), at(12 * 60))).toBe(false);
  });

  it("ends when it is revoked", () => {
    expect(isSessionActive(session(0, at(1)), at(2))).toBe(false);
  });
});
