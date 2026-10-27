import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";

describe("GET /api/salud", () => {
  const prisma = createPrismaClient(config.databaseUrl);
  const unreachablePrisma = createPrismaClient(
    "postgresql://parkapp:unused@127.0.0.1:1/parkapp_dev",
  );

  afterAll(async () => {
    await prisma.$disconnect();
    await unreachablePrisma.$disconnect();
  });

  it("returns 200 when the database responds", async () => {
    const response = await request(createApp(prisma)).get("/api/salud");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ estado: "ok" });
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });

  it("returns 503 without internal details when the database is unreachable", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await request(createApp(unreachablePrisma)).get("/api/salud");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ estado: "no_disponible" });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});