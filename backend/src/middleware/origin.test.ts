import { describe, expect, it } from "vitest";
import { parseOrigin } from "./origin.js";

describe("parseOrigin (APP_ORIGIN)", () => {
  it("accepts the production origin", () => {
    expect(parseOrigin("https://rolopark.com")).toBe("https://rolopark.com");
  });

  it("accepts a local origin with a port", () => {
    expect(parseOrigin("http://localhost:5173")).toBe("http://localhost:5173");
  });

  it.each([
    ["a trailing slash", "https://rolopark.com/"],
    ["a path", "https://rolopark.com/api"],
    ["uppercase letters", "https://RoloPark.com"],
    ["the default port", "https://rolopark.com:443"],
    ["another scheme", "ftp://rolopark.com"],
    ["no scheme", "rolopark.com"],
    ["an empty value", ""],
  ])("rejects a value with %s, naming the variable", (_case, raw) => {
    expect(() => parseOrigin(raw)).toThrow(/APP_ORIGIN/);
  });
});
