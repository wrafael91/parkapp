// Bootstrap script: loads the per-minute rates and the grace period, which every
// entry needs (US-11 and US-12 move them to the app later). It runs on the
// server, through Session Manager, with the parkapp_app URL:
//
//   DATABASE_URL=... node dist/scripts/set-rates.js <correo> <carro> <moto> <gracia>
//
// <correo> is an active administrator, saved as the one who created the
// versions. Each run creates a new version of the three values and closes the
// current ones (BR-11), in one transaction: if one is rejected, nothing changes.
// DATABASE_URL must be set. This file does not import config.ts, which also
// requires PORT and reads .env.
import { createPrismaClient } from "../db.js";
import type { VehicleType } from "../generated/prisma/client.js";
import { setGracePeriod, setRate, type SetRateResult } from "../modules/rates/rate-settings.js";

const USAGE =
  "Uso: DATABASE_URL=... node dist/scripts/set-rates.js <correo> <carro> <moto> <gracia>";

const VEHICLE_NAMES: Record<VehicleType, string> = { CAR: "carro", MOTORCYCLE: "moto" };

const NOTHING_CHANGED = "No se cambió nada.";

class Rejected extends Error {}

function rateRejection(
  vehicleType: VehicleType,
  result: Extract<SetRateResult, { ok: false }>,
): string {
  const vehicle = VEHICLE_NAMES[vehicleType];
  switch (result.reason) {
    case "invalidValue":
      return `La tarifa de ${vehicle} debe ser un número entero de pesos mayor que cero.`;
    case "noLegalCap":
      return `No hay un tope legal vigente para ${vehicle}.`;
    case "aboveLegalCap":
      return `La tarifa de ${vehicle} supera el tope legal vigente ($${result.legalCap} por minuto).`;
  }
}

// Only digits: "1e2", "0x10" or "2.5" are not accepted as whole numbers.
function toWholeNumber(text: string): number {
  return /^\d+$/.test(text) ? Number(text) : Number.NaN;
}

async function main(): Promise<number> {
  const [email, car, motorcycle, grace] = process.argv.slice(2);
  const databaseUrl = process.env.DATABASE_URL;
  if (!email || !car || !motorcycle || !grace || !databaseUrl) {
    console.error(USAGE);
    return 2;
  }

  const prisma = createPrismaClient(databaseUrl);
  try {
    const now = new Date();
    const name = await prisma.$transaction(async (db) => {
      // RI-15: emails are stored in lowercase, without spaces.
      const admin = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
      if (admin === null || admin.role !== "ADMINISTRATOR" || !admin.active) {
        throw new Rejected("No hay una cuenta de administrador activa con ese correo.");
      }
      const rates: [VehicleType, string][] = [
        ["CAR", car],
        ["MOTORCYCLE", motorcycle],
      ];
      for (const [vehicleType, value] of rates) {
        const result = await setRate(db, {
          vehicleType,
          valuePerMinute: toWholeNumber(value),
          createdById: admin.id,
          now,
        });
        if (!result.ok) throw new Rejected(rateRejection(vehicleType, result));
      }
      const result = await setGracePeriod(db, {
        minutes: toWholeNumber(grace),
        createdById: admin.id,
        now,
      });
      if (!result.ok) {
        throw new Rejected("El periodo de gracia debe ser un número entero de minutos (0 o más).");
      }
      return admin.name;
    });

    // Read back what is now current, as the entries will (BR-11).
    const current = await prisma.rate.findMany({
      where: { validTo: null },
      include: { legalCap: true },
      orderBy: { vehicleType: "asc" },
    });
    const gracePeriod = await prisma.gracePeriod.findFirstOrThrow({ where: { validTo: null } });
    for (const rate of current) {
      console.log(
        `Tarifa de ${VEHICLE_NAMES[rate.vehicleType]}: $${rate.valuePerMinute} por minuto (tope legal: $${rate.legalCap.valuePerMinute}).`,
      );
    }
    console.log(`Periodo de gracia: ${gracePeriod.minutes} minutos.`);
    console.log(`Versiones creadas a nombre de ${name}.`);
    return 0;
  } catch (error) {
    if (!(error instanceof Rejected)) throw error;
    console.error(`${error.message} ${NOTHING_CHANGED}`);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

process.exitCode = await main();
