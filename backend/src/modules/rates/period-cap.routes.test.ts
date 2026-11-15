// Tests of /api/tope-periodo (rates.routes.ts).
import type { Express } from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma, PrismaClient, Role } from "../../generated/prisma/client.js";
import { closeCurrentVersions } from "../../versions.test-helper.js";
import { hashSessionToken } from "../accounts/session-token.js";
import { deactivatePeriodCap, setPeriodCap } from "./period-cap.js";

const prisma = createPrismaClient(config.databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
});

class Rollback extends Error {}

const ORIGIN = "https://rolopark.com";
const IP = "198.51.100.42";
const TOKEN = "token-de-prueba-de-las-rutas-del-tope-00001";
const URL = "/api/tope-periodo";

// Like the other route tests, each test runs as parkapp_app and always rolls
// back. The route's transaction is a savepoint inside the test transaction. The
// versions in force in a development database are closed first, so a cap
// loaded there does not change these tests.
async function withApp(test: (app: Express, db: Prisma.TransactionClient) => Promise<void>) {
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE parkapp_app");
        await closeCurrentVersions(tx);
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

function minutesFromNow(minutes: number, seconds = 0): Date {
  return new Date(Date.now() + (minutes * 60 + seconds) * 1000);
}

// A user with an active session. With no cap in force, as in production
// before the administrator turns it on.
async function signedIn(db: Prisma.TransactionClient, role: Role) {
  const user = await db.user.create({
    data: {
      name: role === "ADMINISTRATOR" ? "Administrador del tope" : "Operador del tope",
      email: "rutas.tope@example.com",
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
  return { user, changedBy: { userId: user.id, ip: IP }, cookie: `sesion=${TOKEN}` };
}

// Nginx sends the client's IP in X-Forwarded-For (arquitectura 6.3).
function get(app: Express, cookie?: string) {
  const req = request(app).get(URL).set("X-Forwarded-For", IP);
  return cookie === undefined ? req : req.set("Cookie", cookie);
}

describe("GET /api/tope-periodo (FR-23)", () => {
  it("answers null when no cap is in force", async () => {
    await withApp(async (app, db) => {
      const { cookie } = await signedIn(db, "ADMINISTRATOR");

      const response = await get(app, cookie);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ topePeriodo: null });
    });
  });

  it("answers the cap in force", async () => {
    await withApp(async (app, db) => {
      const { changedBy, cookie } = await signedIn(db, "ADMINISTRATOR");
      const setAt = minutesFromNow(-10);
      await setPeriodCap(db, { hours: 12, value: 11000, now: setAt, changedBy });

      const response = await get(app, cookie);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        topePeriodo: { horas: 12, valor: 11000, vigenteDesde: setAt.toISOString() },
      });
    });
  });

  it("answers null after the cap was turned off", async () => {
    await withApp(async (app, db) => {
      const { changedBy, cookie } = await signedIn(db, "ADMINISTRATOR");
      await setPeriodCap(db, { hours: 12, value: 11000, now: minutesFromNow(-10), changedBy });
      await deactivatePeriodCap(db, { now: minutesFromNow(-5), changedBy });

      const response = await get(app, cookie);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ topePeriodo: null });
    });
  });
});

describe("access to /api/tope-periodo (NFR-05, matrix 1.2)", () => {
  it("GET without a session answers 401", async () => {
    await withApp(async (app) => {
      const response = await get(app);

      expect(response.status).toBe(401);
      expect(response.body.error.codigo).toBe("NO_AUTENTICADO");
    });
  });

  it("GET by an operator answers 403 and logs ACCESO_DENEGADO", async () => {
    await withApp(async (app, db) => {
      const { user, cookie } = await signedIn(db, "OPERATOR");

      const response = await get(app, cookie);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: { codigo: "ACCESO_DENEGADO", mensaje: "No tienes permiso para esta acción." },
      });
      const events = await db.auditEvent.findMany({
        where: { action: "ACCESS_DENIED", userId: user.id },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ detail: { metodo: "GET", ruta: URL }, ip: IP });
    });
  });
});
