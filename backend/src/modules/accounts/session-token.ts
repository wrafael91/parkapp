import { createHash, randomBytes } from "node:crypto";

// ADR 0003: a random 256-bit token travels in the cookie, and the database
// keeps only its SHA-256 hash, so a leaked table cannot be used to sign in.
const TOKEN_BYTES = 32;

export interface SessionToken {
  token: string;
  tokenHash: string;
}

export function createSessionToken(): SessionToken {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
