import type { Express } from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma, PrismaClient, Role } from "../../generated/prisma/client.js";
import { hashPassword } from "./password.js";
import { hashSessionToken } from "./session-token.js";

const prisma = createPrismaClient(config.databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
});

class Rollback extends Error {}

const ORIGIN = "https://rolopark.com";
const PASSWORD = "la contrasena que asigno otra persona";
const NEW_PASSWORD = "una frase de paso que solo yo conozco";
const TOKEN = "token-de-una-cuenta-con-el-cambio-pendiente";
const COOKIE = `sesion=${TOKEN}`;
const IP = "198.51.100.16";

// Like the other route tests, each test runs as parkapp_app and always rolls
// back. The app calls prisma.$transaction; here it reuses the test transaction.
async function withApp(test: (app: Express, db: Prisma.TransactionClient) => Promise<void>) {
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE parkapp_app");
        const prismaInTest = {
          $transaction: (run: (db: Prisma.TransactionClient) => Promise<unknown>) => run(tx),
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

// An account with an open session; by default its password was assigned by
// someone else and must change (RI-16).
async function signedIn(
  db: Prisma.TransactionClient,
  options: { role?: Role; mustChangePassword?: boolean; active?: boolean } = {},
) {
  const user = await db.user.create({
    data: {
      name: "Cuenta con sesión",
      email: "cambio.pendiente@example.com",
      passwordHash: await hashPassword(PASSWORD),
      role: options.role ?? "OPERATOR",
      mustChangePassword: options.mustChangePassword ?? true,
      active: options.active ?? true,
    },
  });
  const session = await db.session.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(TOKEN),
      ip: IP,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    },
  });
  return { user, session };
}

function get(app: Express, url: string) {
  return request(app).get(url).set("Cookie", COOKIE);
}

function post(app: Express, url: string, body: object) {
  return request(app)
    .post(url)
    .set("Origin", ORIGIN)
    .set("Cookie", COOKIE)
    .set("X-Forwarded-For", IP)
    .send(body);
}

describe("a pending password change (RI-16)", () => {
  it.each([
    ["the vehicles inside", "OPERATOR", "/api/estadias?estado=ACTIVA"],
    ["the history", "OPERATOR", "/api/estadias?fecha=2026-11-28"],
    ["the spaces", "OPERATOR", "/api/cupos"],
    ["the rates", "ADMINISTRATOR", "/api/tarifas"],
    ["the accounts", "ADMINISTRATOR", "/api/usuarios"],
    ["a route that does not exist", "OPERATOR", "/api/no-existe"],
  ])("answers 403 CAMBIO_CONTRASENA_PENDIENTE to %s (%s)", async (_case, role, url) => {
    await withApp(async (app, db) => {
      await signedIn(db, { role: role as Role });

      const response = await get(app, url);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: {
          codigo: "CAMBIO_CONTRASENA_PENDIENTE",
          mensaje: "Debes cambiar tu contraseña antes de continuar.",
        },
      });
    });
  });

  it("does not register an entry, and logs nothing", async () => {
    await withApp(async (app, db) => {
      await signedIn(db);
      const eventsBefore = await db.auditEvent.count();

      const response = await post(app, "/api/estadias", {
        placa: "TST170",
        tipoVehiculo: "CARRO",
        color: "Gris",
      });

      expect(response.status).toBe(403);
      expect(response.body.error.codigo).toBe("CAMBIO_CONTRASENA_PENDIENTE");
      expect(await db.stay.count({ where: { plate: "TST170" } })).toBe(0);
      expect(await db.auditEvent.count()).toBe(eventsBefore);
    });
  });

  it("does not refresh the session's last activity (NFR-04)", async () => {
    await withApp(async (app, db) => {
      const { session } = await signedIn(db);

      await get(app, "/api/cupos");

      const after = await db.session.findUniqueOrThrow({ where: { id: session.id } });
      expect(after.lastActivityAt).toEqual(session.lastActivityAt);
    });
  });

  it("still lets the user see his session and sign out", async () => {
    await withApp(async (app, db) => {
      await signedIn(db);

      const session = await get(app, "/api/sesion");
      expect(session.status).toBe(200);
      expect(session.body.usuario.debeCambiarContrasena).toBe(true);

      const signOut = await request(app)
        .delete("/api/sesion")
        .set("Origin", ORIGIN)
        .set("Cookie", COOKIE);
      expect(signOut.status).toBe(204);
    });
  });

  it("lets the user change the password, and then use the app", async () => {
    await withApp(async (app, db) => {
      await signedIn(db);

      const change = await post(app, "/api/sesion/contrasena", {
        actual: PASSWORD,
        nueva: NEW_PASSWORD,
      });
      expect(change.status).toBe(200);

      const response = await get(app, "/api/estadias?estado=ACTIVA");
      expect(response.status).toBe(200);
    });
  });
});

describe("without a pending password change", () => {
  it("lets the user use the app", async () => {
    await withApp(async (app, db) => {
      await signedIn(db, { mustChangePassword: false });

      const response = await get(app, "/api/estadias?estado=ACTIVA");

      expect(response.status).toBe(200);
    });
  });

  // 401, not 403: a session that does not work reveals nothing about the account.
  it.each([
    ["a revoked session", { revokedAt: new Date() }],
    ["a session idle for 31 minutes", { lastActivityAt: new Date(Date.now() - 31 * 60_000) }],
  ])("answers 401 to %s, even with the change pending", async (_case, change) => {
    await withApp(async (app, db) => {
      const { session } = await signedIn(db);
      await db.session.update({ where: { id: session.id }, data: change });

      const response = await get(app, "/api/estadias?estado=ACTIVA");

      expect(response.status).toBe(401);
      expect(response.body.error.codigo).toBe("NO_AUTENTICADO");
    });
  });

  it("answers 401 to a deactivated account, even with the change pending", async () => {
    await withApp(async (app, db) => {
      await signedIn(db, { active: false });

      const response = await get(app, "/api/estadias?estado=ACTIVA");

      expect(response.status).toBe(401);
    });
  });

  it("answers 401 without a session cookie", async () => {
    await withApp(async (app) => {
      const response = await request(app).get("/api/estadias?estado=ACTIVA");

      expect(response.status).toBe(401);
    });
  });
});
