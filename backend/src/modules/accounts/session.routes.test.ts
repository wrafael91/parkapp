import type { Express } from "express";
import request from "supertest";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { hashPassword } from "./password.js";
import { hashSessionToken } from "./session-token.js";

const prisma = createPrismaClient(config.databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(() => {
  vi.restoreAllMocks();
});

class Rollback extends Error {}

const ORIGIN = "https://rolopark.com";
const EMAIL = "admin.rutas@example.com";
const PASSWORD = "otra frase de paso bastante larga";
const IP = "198.51.100.7";

// Like the service tests, each test runs as parkapp_app and always rolls back.
// The routes call prisma.$transaction; here it reuses the test transaction.
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

async function createUser(db: Prisma.TransactionClient) {
  return db.user.create({
    data: {
      name: "Administradora de rutas",
      email: EMAIL,
      passwordHash: await hashPassword(PASSWORD),
      role: "ADMINISTRATOR",
    },
  });
}

// Nginx sends the client's IP in X-Forwarded-For (arquitectura 6.3).
function postSession(app: Express, body: object = { correo: EMAIL, contrasena: PASSWORD }) {
  return request(app).post("/api/sesion").set("Origin", ORIGIN).set("X-Forwarded-For", IP).send(body);
}

function sessionCookie(response: request.Response): string {
  const cookies: string[] = response.get("Set-Cookie") ?? [];
  const cookie = cookies.find((value) => value.startsWith("sesion="));
  if (cookie === undefined) throw new Error("no sesion cookie");
  return cookie;
}

function tokenOf(cookie: string): string {
  return cookie.slice("sesion=".length, cookie.indexOf(";"));
}

describe("POST /api/sesion (FR-01)", () => {
  it("signs in, answers with the user in Spanish and sets the session cookie", async () => {
    await withApp(async (app, db) => {
      const user = await createUser(db);

      const response = await postSession(app);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        usuario: {
          id: user.id,
          nombre: "Administradora de rutas",
          rol: "ADMINISTRADOR",
          debeCambiarContrasena: true,
        },
      });
      // docs/modelo-amenazas.md, 7.2
      const cookie = sessionCookie(response);
      expect(cookie).toMatch(/^sesion=[\w-]{43};/);
      for (const attribute of ["Max-Age=43200", "Path=/api", "HttpOnly", "Secure", "SameSite=Strict"]) {
        expect(cookie).toContain(`; ${attribute}`);
      }
      expect(cookie).not.toContain("Domain");
    });
  });

  it("stores the client IP that Nginx sends in X-Forwarded-For (A-25)", async () => {
    await withApp(async (app, db) => {
      await createUser(db);

      const response = await postSession(app);

      const session = await db.session.findUniqueOrThrow({
        where: { tokenHash: hashSessionToken(tokenOf(sessionCookie(response))) },
      });
      expect(session.ip).toBe(IP);
    });
  });

  it.each([
    ["a wrong password", EMAIL, `${PASSWORD}!`],
    ["an unknown email", "nadie@example.com", PASSWORD],
  ])("answers %s with 401 NO_AUTENTICADO and no cookie", async (_case, correo, contrasena) => {
    await withApp(async (app, db) => {
      await createUser(db);

      const response = await postSession(app, { correo, contrasena });

      expect(response.status).toBe(401);
      expect(response.body.error.codigo).toBe("NO_AUTENTICADO");
      expect(response.get("Set-Cookie")).toBeUndefined();
    });
  });

  it.each([
    ["no password", { correo: EMAIL }],
    ["an email that is not text", { correo: 123, contrasena: PASSWORD }],
    ["an empty email", { correo: "", contrasena: PASSWORD }],
    ["a password over 64 characters", { correo: EMAIL, contrasena: "a".repeat(65) }],
  ])("rejects a body with %s with 400 ENTRADA_INVALIDA (NFR-06)", async (_case, body) => {
    await withApp(async (app, db) => {
      await createUser(db);

      const response = await postSession(app, body);

      expect(response.status).toBe(400);
      expect(response.body.error.codigo).toBe("ENTRADA_INVALIDA");
      expect(await db.auditEvent.count({ where: { ip: IP } })).toBe(0);
    });
  });

  it("rejects a sign-in without Origin before touching the database (section 7.4)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await withApp(async (app, db) => {
      const user = await createUser(db);

      const response = await request(app)
        .post("/api/sesion")
        .set("X-Forwarded-For", IP)
        .send({ correo: EMAIL, contrasena: PASSWORD });

      expect(response.status).toBe(403);
      expect(response.body.error.codigo).toBe("ORIGEN_NO_PERMITIDO");
      expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
      expect(await db.auditEvent.count({ where: { ip: IP } })).toBe(0);
    });
  });
});
