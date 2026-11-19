// Tests of /api/cupos (capacity.routes.ts).
import type { Express } from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma, PrismaClient, Role } from "../../generated/prisma/client.js";
import { closeCurrentVersions } from "../../versions.test-helper.js";
import { hashSessionToken } from "../accounts/session-token.js";
import { setGracePeriod, setRate } from "../rates/rate-settings.js";
import { registerEntry } from "../stays/entry.service.js";
import { registerExit } from "../stays/exit.service.js";
import { setCapacity } from "./capacity.js";

const prisma = createPrismaClient(config.databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
});

class Rollback extends Error {}

const ORIGIN = "https://rolopark.com";
const IP = "198.51.100.43";
const TOKEN = "token-de-prueba-de-las-rutas-de-cupos-00001";
const URL = "/api/cupos";

// Like the other route tests, each test runs as parkapp_app and always rolls
// back. The route's transaction is a savepoint inside the test transaction. The
// versions in force in a development database are closed first, so spaces
// loaded there do not change these tests.
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

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

// A user with an active session. Without spaces, as in production before the
// administrator sets them.
async function signedIn(db: Prisma.TransactionClient, role: Role) {
  const user = await db.user.create({
    data: {
      name: role === "ADMINISTRATOR" ? "Administrador de cupos" : "Operador de cupos",
      email: "rutas.cupos@example.com",
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

// The vehicles of a type already inside, so a development database with active
// stays does not change the results.
function inside(db: Prisma.TransactionClient, vehicleType: "CAR" | "MOTORCYCLE") {
  return db.stay.count({ where: { vehicleType, status: "ACTIVE" } });
}

// Two cars inside, one car that left and one voided, plus the rates and the grace
// period that every entry needs (BR-11).
async function carsInAndOut(db: Prisma.TransactionClient, userId: number) {
  const now = minutesFromNow(-60);
  await setRate(db, { vehicleType: "CAR", valuePerMinute: 230, createdById: userId, now });
  await setGracePeriod(db, { minutes: 5, createdById: userId, now });
  const ids: number[] = [];
  for (const plate of ["TST201", "TST202", "TST203", "TST204"]) {
    const entry = await registerEntry(db, {
      plate,
      vehicleType: "CAR",
      color: "Gris",
      userId,
      ip: IP,
      now: minutesFromNow(-30),
    });
    if (!entry.ok) throw new Error("setup failed");
    ids.push(entry.stayId);
  }
  await registerExit(db, { stayId: ids[2]!, userId, ip: IP, now: minutesFromNow(-10) });
  await db.stay.update({
    where: { id: ids[3]! },
    data: {
      status: "VOIDED",
      voidedAt: minutesFromNow(-10),
      voidedById: userId,
      voidReason: "Ingreso de prueba",
    },
  });
}

describe("GET /api/cupos (FR-24)", () => {
  it("shows an operator only the vehicles inside when no spaces are set", async () => {
    await withApp(async (app, db) => {
      const { cookie } = await signedIn(db, "OPERATOR");
      const cars = await inside(db, "CAR");
      const motorcycles = await inside(db, "MOTORCYCLE");

      const response = await get(app, cookie);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        cupos: [
          { tipoVehiculo: "CARRO", cupos: null, ocupados: cars, libres: null },
          { tipoVehiculo: "MOTO", cupos: null, ocupados: motorcycles, libres: null },
        ],
      });
    });
  });

  it("counts only the active stays, and shows the free spaces of each type", async () => {
    await withApp(async (app, db) => {
      const { user, changedBy, cookie } = await signedIn(db, "ADMINISTRATOR");
      const carsBefore = await inside(db, "CAR");
      await carsInAndOut(db, user.id);
      const at = minutesFromNow(-5);
      await setCapacity(db, { vehicleType: "CAR", spaces: carsBefore + 5, now: at, changedBy });
      await setCapacity(db, { vehicleType: "MOTORCYCLE", spaces: 0, now: at, changedBy });
      const motorcycles = await inside(db, "MOTORCYCLE");

      const response = await get(app, cookie);

      expect(response.status).toBe(200);
      expect(response.body.cupos).toEqual([
        { tipoVehiculo: "CARRO", cupos: carsBefore + 5, ocupados: carsBefore + 2, libres: 3 },
        { tipoVehiculo: "MOTO", cupos: 0, ocupados: motorcycles, libres: 0 },
      ]);
    });
  });

  it("shows 0 free spaces, not fewer, when the spaces are below the vehicles inside", async () => {
    await withApp(async (app, db) => {
      const { user, changedBy, cookie } = await signedIn(db, "OPERATOR");
      const carsBefore = await inside(db, "CAR");
      await carsInAndOut(db, user.id);
      await setCapacity(db, {
        vehicleType: "CAR",
        spaces: carsBefore + 1,
        now: minutesFromNow(-5),
        changedBy,
      });

      const response = await get(app, cookie);

      expect(response.body.cupos[0]).toEqual({
        tipoVehiculo: "CARRO",
        cupos: carsBefore + 1,
        ocupados: carsBefore + 2,
        libres: 0,
      });
    });
  });

  it("answers 401 without a session", async () => {
    await withApp(async (app) => {
      const response = await get(app);

      expect(response.status).toBe(401);
      expect(response.body.error.codigo).toBe("NO_AUTENTICADO");
    });
  });
});
