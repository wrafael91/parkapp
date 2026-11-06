import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { PrismaClient } from "./generated/prisma/client.js";

// These requests are rejected or answered before any database access.
const unusedPrisma = {} as PrismaClient;
const ORIGIN = "https://rolopark.com";

describe("createApp", () => {
  it("checks the Origin of requests to /api that may change data", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = createApp(unusedPrisma, { allowedOrigin: "https://rolopark.com" });

    const response = await request(app).post("/api/salud");

    expect(response.status).toBe(403);
    expect(response.body.error.codigo).toBe("ORIGEN_NO_PERMITIDO");
  });

    it.each([
    ["get", "/api/no-existe"],
    ["post", "/api/salud"],
  ] as const)("answers a %s to %s with 404 NO_ENCONTRADO in JSON", async (method, path) => {
    const app = createApp(unusedPrisma, { allowedOrigin: ORIGIN });

    const response = await request(app)[method](path).set("Origin", ORIGIN);

    expect(response.status).toBe(404);
    expect(response.body.error.codigo).toBe("NO_ENCONTRADO");
  });

  it("answers malformed JSON with 400 ENTRADA_INVALIDA", async () => {
    const app = createApp(unusedPrisma, { allowedOrigin: ORIGIN });

    const response = await request(app)
      .post("/api/no-existe")
      .set("Origin", ORIGIN)
      .set("Content-Type", "application/json")
      .send("{");

    expect(response.status).toBe(400);
    expect(response.body.error.codigo).toBe("ENTRADA_INVALIDA");
  });

  it("rejects a body over 10 kB with 400 ENTRADA_INVALIDA", async () => {
    const app = createApp(unusedPrisma, { allowedOrigin: ORIGIN });

    const response = await request(app)
      .post("/api/no-existe")
      .set("Origin", ORIGIN)
      .send({ relleno: "x".repeat(11 * 1024) });

    expect(response.status).toBe(400);
    expect(response.body.error.codigo).toBe("ENTRADA_INVALIDA");
  });
});
