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

function post(app: Express, cookie: string | undefined, body: object) {
  const req = request(app).post(URL).set("Origin", ORIGIN).set("X-Forwarded-For", IP);
  return (cookie === undefined ? req : req.set("Cookie", cookie)).send(body);
}

function capEvents(db: Prisma.TransactionClient) {
  return db.auditEvent.count({ where: { action: "PERIOD_CAP_CHANGED" } });
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

describe("POST /api/tope-periodo turns the cap on or changes it (FR-23, BR-18)", () => {
  it("creates a version valid from now, closes the previous one and logs the user and the IP", async () => {
    await withApp(async (app, db) => {
      const { user, changedBy, cookie } = await signedIn(db, "ADMINISTRATOR");
      const previous = await setPeriodCap(db, {
        hours: 12,
        value: 11000,
        now: minutesFromNow(-10),
        changedBy,
      });
      if (!previous.ok) throw new Error("setup failed");
      const before = Date.now();

      const response = await post(app, cookie, { horas: 13, valor: 11000 });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        topePeriodo: { horas: 13, valor: 11000, vigenteDesde: expect.any(String) },
      });
      const validFrom = new Date(response.body.topePeriodo.vigenteDesde).getTime();
      expect(validFrom).toBeGreaterThanOrEqual(before);
      // BR-11: the previous version is closed, not changed.
      const closed = await db.periodCap.findUniqueOrThrow({ where: { id: previous.periodCapId } });
      expect(closed).toMatchObject({ hours: 12, value: 11000 });
      expect(closed.validTo?.getTime()).toBe(validFrom);
      const created = await db.periodCap.findFirstOrThrow({ where: { validTo: null } });
      expect(created).toMatchObject({ hours: 13, value: 11000, createdById: user.id });
      const event = await db.auditEvent.findFirstOrThrow({
        where: { action: "PERIOD_CAP_CHANGED", entityId: created.id },
      });
      expect(event).toMatchObject({ userId: user.id, entity: "tope_periodo", ip: IP });
    });
  });

  // The limits of criterion 8 of #14: from 1 to 24 hours (RI-20) and a value
  // up to $1,000,000.
  it.each([
    [1, 1],
    [24, 1_000_000],
  ])("turns the cap on with %i hours and $%i", async (horas, valor) => {
    await withApp(async (app, db) => {
      const { cookie } = await signedIn(db, "ADMINISTRATOR");

      const response = await post(app, cookie, { horas, valor });

      expect(response.status).toBe(201);
      expect(response.body.topePeriodo).toMatchObject({ horas, valor });
      expect(await db.periodCap.count({ where: { validTo: null } })).toBe(1);
    });
  });

  it.each([
    ["0 hours", { horas: 0, valor: 11000 }],
    ["25 hours", { horas: 25, valor: 11000 }],
    ["hours that are not whole", { horas: 12.5, valor: 11000 }],
    ["hours as a string", { horas: "12", valor: 11000 }],
    ["no hours", { valor: 11000 }],
    ["a value of $0", { horas: 12, valor: 0 }],
    ["a negative value", { horas: 12, valor: -11000 }],
    ["a value over $1,000,000", { horas: 12, valor: 1_000_001 }],
    ["a value with cents", { horas: 12, valor: 11000.5 }],
    ["a value as a string", { horas: 12, valor: "11000" }],
    ["no value", { horas: 12 }],
    ["activo true", { activo: true }],
    ["an empty body", {}],
  ])("rejects %s with 400 ENTRADA_INVALIDA and changes nothing", async (_case, body) => {
    await withApp(async (app, db) => {
      const { changedBy, cookie } = await signedIn(db, "ADMINISTRATOR");
      await setPeriodCap(db, { hours: 12, value: 11000, now: minutesFromNow(-10), changedBy });
      const versionsBefore = await db.periodCap.count();
      const eventsBefore = await capEvents(db);

      const response = await post(app, cookie, body);

      expect(response.status).toBe(400);
      expect(response.body.error.codigo).toBe("ENTRADA_INVALIDA");
      expect(await db.periodCap.count()).toBe(versionsBefore);
      expect(await db.periodCap.count({ where: { validTo: null } })).toBe(1);
      expect(await capEvents(db)).toBe(eventsBefore);
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

  const changes = [[{ horas: 12, valor: 11000 }], [{ activo: false }]] as const;

  it.each(changes)("POST %j without a session answers 401 and changes nothing", async (body) => {
    await withApp(async (app, db) => {
      const eventsBefore = await capEvents(db);

      const response = await post(app, undefined, body);

      expect(response.status).toBe(401);
      expect(response.body.error.codigo).toBe("NO_AUTENTICADO");
      expect(await db.periodCap.count({ where: { validTo: null } })).toBe(0);
      expect(await capEvents(db)).toBe(eventsBefore);
    });
  });

  it("a POST without a session answers 401 before the body is validated", async () => {
    await withApp(async (app) => {
      const response = await post(app, undefined, { horas: "x" });

      expect(response.status).toBe(401);
    });
  });

  it.each(changes)(
    "POST %j by an operator answers 403, logs ACCESO_DENEGADO and changes nothing",
    async (body) => {
      await withApp(async (app, db) => {
        const { user, changedBy, cookie } = await signedIn(db, "OPERATOR");
        await setPeriodCap(db, { hours: 12, value: 11000, now: minutesFromNow(-10), changedBy });
        const versionsBefore = await db.periodCap.count();

        const response = await post(app, cookie, body);

        expect(response.status).toBe(403);
        expect(response.body).toEqual({
          error: { codigo: "ACCESO_DENEGADO", mensaje: "No tienes permiso para esta acción." },
        });
        const events = await db.auditEvent.findMany({
          where: { action: "ACCESS_DENIED", userId: user.id },
        });
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ detail: { metodo: "POST", ruta: URL }, ip: IP });
        expect(await db.periodCap.count()).toBe(versionsBefore);
        expect(await db.periodCap.count({ where: { validTo: null } })).toBe(1);
      });
    },
  );

  it("an operator gets 403 before the body is validated", async () => {
    await withApp(async (app, db) => {
      const { cookie } = await signedIn(db, "OPERATOR");

      const response = await post(app, cookie, { horas: "x" });

      expect(response.status).toBe(403);
    });
  });

  // Passes from the start, on purpose: the Origin check of app.ts runs before
  // every route (docs/modelo-amenazas.md, 7.4).
  it("a change without Origin answers 403 ORIGEN_NO_PERMITIDO and changes nothing", async () => {
    await withApp(async (app, db) => {
      const { cookie } = await signedIn(db, "ADMINISTRATOR");

      const response = await request(app)
        .post(URL)
        .set("Cookie", cookie)
        .send({ horas: 12, valor: 11000 });

      expect(response.status).toBe(403);
      expect(response.body.error.codigo).toBe("ORIGEN_NO_PERMITIDO");
      expect(await db.periodCap.count({ where: { validTo: null } })).toBe(0);
    });
  });
});
