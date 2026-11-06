import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseOrigin, requireAllowedOrigin } from "./origin.js";

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

describe("requireAllowedOrigin", () => {
  function createTestApp() {
    const app = express();
    app.use(requireAllowedOrigin("https://rolopark.com"));
    app.all("/test", (_req, res) => {
      res.status(204).end();
    });
    return app;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function silenceWarnings() {
    return vi.spyOn(console, "warn").mockImplementation(() => {});
  }

  it.each([
    ["no Origin", undefined],
    ["Origin: null", "null"],
    ["another site", "https://ejemplo.net"],
    ["a look-alike domain", "https://rolopark.com.ejemplo.net"],
    ["another scheme", "http://rolopark.com"],
    ["the www name", "https://www.rolopark.com"],
  ])("rejects a POST with %s", async (_case, origin) => {
    silenceWarnings();
    const req = request(createTestApp()).post("/test");
    const response = await (origin === undefined ? req : req.set("Origin", origin));

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: {
        codigo: "ORIGEN_NO_PERMITIDO",
        mensaje: "La petición no proviene de la aplicación.",
      },
    });
  });

  it("rejects a DELETE from another site", async () => {
    silenceWarnings();
    const response = await request(createTestApp()).delete("/test").set("Origin", "https://ejemplo.net");

    expect(response.status).toBe(403);
  });

  it("lets a POST from the allowed origin through", async () => {
    const response = await request(createTestApp()).post("/test").set("Origin", "https://rolopark.com");

    expect(response.status).toBe(204);
  });

  it.each(["get", "head", "options"] as const)(
    "does not check %s requests",
    async (method) => {
      const response = await request(createTestApp())[method]("/test");

      expect(response.status).toBe(204);
    },
  );

  it("logs the method, the path without the query and the origin received", async () => {
    const warn = silenceWarnings();

    await request(createTestApp()).post("/test?token=secreto").set("Origin", "https://ejemplo.net");

    expect(warn).toHaveBeenCalledOnce();
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('POST /test from origin "https://ejemplo.net"');
    expect(message).not.toContain("secreto");
  });
});
