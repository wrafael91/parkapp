import { describe, expect, it } from "vitest";
import { hashPassword, isAcceptableLength, verifyPassword } from "./password.js";

const PASSWORD = "una frase de paso bastante larga";

describe("hashPassword and verifyPassword (NFR-01)", () => {
  it("hashes with Argon2id and the OWASP minimum parameters", async () => {
    const hash = await hashPassword(PASSWORD);

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hash).not.toContain(PASSWORD);
  });

  it("uses a different salt for each hash", async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });

  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword(PASSWORD);

    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
    expect(await verifyPassword(hash, `${PASSWORD}!`)).toBe(false);
  });
});

describe("isAcceptableLength (NFR-02)", () => {
  it.each([
    [14, false],
    [15, true],
    [64, true],
    [65, false],
  ])("a password of %i characters is acceptable: %s", (length, expected) => {
    expect(isAcceptableLength("a".repeat(length))).toBe(expected);
  });

  it("counts characters, not bytes or UTF-16 units", () => {
    // "ñ" takes 2 bytes, and "🚗" takes 2 UTF-16 units (4 bytes).
    expect(isAcceptableLength("ñ".repeat(40))).toBe(true);
    expect(isAcceptableLength("🚗".repeat(8))).toBe(false);
    expect(isAcceptableLength("🚗".repeat(33))).toBe(true);
  });
});
