import { describe, expect, it } from "vitest";
import { normalizePlate } from "./plate.js";

describe("normalizePlate (FR-08, RI-01)", () => {
  it.each([
    ["a car plate typed with a hyphen", "abc-123", "CAR", "ABC123"],
    ["a car plate with spaces around and inside", " abc 123 ", "CAR", "ABC123"],
    ["a motorcycle plate", "abc12d", "MOTORCYCLE", "ABC12D"],
    ["a motorcycle plate with a hyphen", "ABC-12D", "MOTORCYCLE", "ABC12D"],
  ] as const)("saves %s in uppercase, without spaces or hyphens", (_case, input, type, plate) => {
    expect(normalizePlate(input, type)).toBe(plate);
  });

  it.each([
    ["a motorcycle plate as a car", "ABC12D", "CAR"],
    ["a car plate as a motorcycle", "ABC123", "MOTORCYCLE"],
    ["four digits", "ABC1234", "CAR"],
    ["two letters", "AB1234", "CAR"],
    ["a letter that is not A to Z", "ÑBC123", "CAR"],
    ["another separator", "ABC.123", "CAR"],
    ["an empty plate", "", "CAR"],
  ] as const)("rejects %s", (_case, input, type) => {
    expect(normalizePlate(input, type)).toBeNull();
  });
});
