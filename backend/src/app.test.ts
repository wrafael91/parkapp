import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { PrismaClient } from "./generated/prisma/client.js";

// These requests are rejected or answered before any database access.
const unusedPrisma = {} as PrismaClient;

describe("createApp", () => {
  it("checks the Origin of requests to /api that may change data", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = createApp(unusedPrisma, { allowedOrigin: "https://rolopark.com" });

    const response = await request(app).post("/api/salud");

    expect(response.status).toBe(403);
    expect(response.body.error.codigo).toBe("ORIGEN_NO_PERMITIDO");
  });
});
