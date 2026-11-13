import { afterAll, describe, expect, it } from "vitest";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { recordAccessDenied } from "./access-denied.js";

const prisma = createPrismaClient(config.databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
});

class Rollback extends Error {}

// Runs a test as parkapp_app and always rolls back (S2-19).
async function asApp(test: (db: Prisma.TransactionClient) => Promise<void>): Promise<void> {
  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL ROLE parkapp_app");
        await test(tx);
        throw new Rollback();
      },
      { timeout: 15_000 },
    );
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

async function createOperator(db: Prisma.TransactionClient): Promise<number> {
  const user = await db.user.create({
    data: {
      name: "Operador de prueba",
      email: "operador.acceso@example.com",
      passwordHash: "not-a-real-hash",
      role: "OPERATOR",
    },
  });
  return user.id;
}

const NOW = new Date("2026-11-12T15:00:00.000Z");

describe("recordAccessDenied (NFR-05)", () => {
  it("records ACCESO_DENEGADO with the user, the IP, the method and the route", async () => {
    await asApp(async (db) => {
      const userId = await createOperator(db);

      await recordAccessDenied(db, {
        userId,
        ip: "203.0.113.20",
        method: "POST",
        url: "/api/tarifas",
        now: NOW,
      });

      const events = await db.auditEvent.findMany({ where: { action: "ACCESS_DENIED", userId } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        entity: null,
        entityId: null,
        detail: { metodo: "POST", ruta: "/api/tarifas" },
        ip: "203.0.113.20",
        occurredAt: NOW,
      });
    });
  });

  it("keeps the route without the query string (docs/modelo-datos.md, 4.1)", async () => {
    await asApp(async (db) => {
      const userId = await createOperator(db);

      await recordAccessDenied(db, {
        userId,
        ip: "203.0.113.20",
        method: "GET",
        url: "/api/tarifas?correo=alguien@example.com",
        now: NOW,
      });

      const event = await db.auditEvent.findFirstOrThrow({
        where: { action: "ACCESS_DENIED", userId },
      });
      expect(event.detail).toEqual({ metodo: "GET", ruta: "/api/tarifas" });
    });
  });
});
