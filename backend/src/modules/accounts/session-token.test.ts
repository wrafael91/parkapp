import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSessionToken, hashSessionToken } from "./session-token.js";

describe("session tokens (ADR 0003)", () => {
  it("creates a random 256-bit token in base64url", () => {
    const { token } = createSessionToken();

    // 32 bytes are 43 base64url characters, without padding.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("creates a different token each time", () => {
    expect(createSessionToken().token).not.toBe(createSessionToken().token);
  });

  it("stores only the SHA-256 hash of the token", () => {
    const { token, tokenHash } = createSessionToken();

    expect(tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hashSessionToken(token)).toBe(tokenHash);
    expect(tokenHash).not.toContain(token);
  });
});
