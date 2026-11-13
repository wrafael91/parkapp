// Tests of /api/tarifas and /api/periodo-gracia (rates.routes.ts).
import type { Express } from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma, PrismaClient, Role } from "../../generated/prisma/client.js";
import { hashSessionToken } from "../accounts/session-token.js";
import { setGracePeriod, setRate } from "./rate-settings.js";

const prisma = createPrismaClient(config.databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
});

class Rollback extends Error {}

const ORIGIN = "https://rolopark.com";
const IP = "198.51.100.42";
const TOKEN = "token-de-prueba-de-las-rutas-de-tarifas-0001";

// Like the other route tests, each test runs as parkapp_app and always rolls
// back. The route's transaction is a savepoint inside the test transaction.
async function withApp(test: (app: Express, db: Prisma.TransactionClient) => Promise<void>) {
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE parkapp_app");
        const prismaInTest = {
          $transaction: async (run: (db: Prisma.TransactionClient) => Promise<unknown>) => {
            await tx.$executeRawUnsafe("SAVEPOINT route");
            try {
              const result = await run(tx);
              await tx.$executeRawUnsafe("RELEASE SAVEPOINT route");
              return result;
            } catch (error) {
              await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT route");
              throw error;
            }
          },
        } as unknown as PrismaClient;
        await test(createApp(prismaInTest, { allowedOrigin: ORIGIN }), tx);
        throw new Rollback();
      },
      { timeout: 15_000 },
    );
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

// A user with an active session, and the production values ($230, $161 and 5
// minutes) loaded 10 minutes ago by the bootstrap script.
async function signedIn(db: Prisma.TransactionClient, role: Role) {
  const user = await db.user.create({
    data: {
      name: role === "ADMINISTRATOR" ? "Administrador de tarifas" : "Operador de tarifas",
      email: "rutas.tarifas@example.com",
      passwordHash: "not-a-real-hash",
      role,
    },
  });
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(TOKEN),
      ip: IP,
      expiresAt: minutesFromNow(60),
    },
  });
  const loadedAt = minutesFromNow(-10);
  const car = await setRate(db, {
    vehicleType: "CAR",
    valuePerMinute: 230,
    createdById: user.id,
    now: loadedAt,
  });
  const motorcycle = await setRate(db, {
    vehicleType: "MOTORCYCLE",
    valuePerMinute: 161,
    createdById: user.id,
    now: loadedAt,
  });
  const grace = await setGracePeriod(db, { minutes: 5, createdById: user.id, now: loadedAt });
  if (!car.ok || !motorcycle.ok || !grace.ok) throw new Error("setup failed");
  return { user, loadedAt, cookie: `sesion=${TOKEN}` };
}

// Nginx sends the client's IP in X-Forwarded-For (arquitectura 6.3).
function get(app: Express, url: string, cookie?: string) {
  const req = request(app).get(url).set("X-Forwarded-For", IP);
  return cookie === undefined ? req : req.set("Cookie", cookie);
}

describe("GET /api/tarifas and GET /api/periodo-gracia (FR-16, FR-17)", () => {
  it("answers the current rate of each vehicle type with its legal cap", async () => {
    await withApp(async (app, db) => {
      const { loadedAt, cookie } = await signedIn(db, "ADMINISTRATOR");

      const response = await get(app, "/api/tarifas", cookie);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        tarifas: [
          {
            tipoVehiculo: "CARRO",
            valorMinuto: 230,
            topeLegal: 230,
            vigenteDesde: loadedAt.toISOString(),
          },
          {
            tipoVehiculo: "MOTO",
            valorMinuto: 161,
            topeLegal: 161,
            vigenteDesde: loadedAt.toISOString(),
          },
        ],
      });
    });
  });

  it("answers the current grace period", async () => {
    await withApp(async (app, db) => {
      const { loadedAt, cookie } = await signedIn(db, "ADMINISTRATOR");

      const response = await get(app, "/api/periodo-gracia", cookie);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ minutos: 5, vigenteDesde: loadedAt.toISOString() });
    });
  });
});
