import { describe, expect, it } from "vitest";
import { readSessionToken } from "./session-cookie.js";

describe("readSessionToken", () => {
  it("reads the sesion cookie among others", () => {
    expect(readSessionToken("tema=oscuro; sesion=abc-123_XYZ; idioma=es")).toBe("abc-123_XYZ");
  });

  it.each([
    ["no Cookie header", undefined],
    ["no sesion cookie", "tema=oscuro"],
    ["a cookie whose name only ends in sesion", "otrasesion=abc"],
    ["an empty value", "sesion="],
  ])("returns null with %s", (_case, header) => {
    expect(readSessionToken(header)).toBeNull();
  });
});
