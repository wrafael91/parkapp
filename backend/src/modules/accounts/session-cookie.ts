import type { CookieOptions } from "express";
import { MAX_LIFETIME_MS } from "./session-policy.js";

// Session cookie (ADR 0003; docs/modelo-amenazas.md, 7.2).
export const SESSION_COOKIE = "sesion";

// No Domain attribute: the cookie stays on rolopark.com, without subdomains.
// Max-Age is the 12-hour maximum of NFR-04; the server still checks the
// 30-minute idle timeout and revocation on every request.
export const sessionCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "strict",
  path: "/api",
  maxAge: MAX_LIFETIME_MS,
};

const PREFIX = `${SESSION_COOKIE}=`;

// Reads the token from the Cookie header without a parsing library: the token
// is base64url, so it needs no decoding. Returns null if there is none.
export function readSessionToken(cookieHeader: string | undefined): string | null {
  for (const part of cookieHeader?.split(";") ?? []) {
    const cookie = part.trim();
    if (cookie.startsWith(PREFIX)) {
      return cookie.slice(PREFIX.length) || null;
    }
  }
  return null;
}
