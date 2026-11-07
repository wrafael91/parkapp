import { afterAll, describe, expect, it } from "vitest";
import { config } from "../../config.js";
import { createPrismaClient } from "../../db.js";

const prisma = createPrismaClient(config.databaseUrl);

afterAll(async () => {
  await prisma.$disconnect();
});

const REGULATION =
  "Decreto 652 de 2025, art. 200, Tabla 10 (modificado por el Decreto 026 de 2026)";
// Decreto 026 de 2026, art. 3: effective on its publication in the Registro
// Distrital (No. 8507, 27 January 2026, Bogotá time).
const VALID_FROM = new Date("2026-01-27T05:00:00.000Z");

describe("legal caps (BR-15)", () => {
  it("has the 2026 general caps as the only current cap per vehicle type (BR-10, RI-07)", async () => {
    const caps = await prisma.legalCap.findMany({
      where: { validTo: null },
      orderBy: { vehicleType: "asc" },
      select: {
        vehicleType: true,
        valuePerMinute: true,
        hasGoldSeal: true,
        regulation: true,
        validFrom: true,
      },
    });

    expect(caps).toEqual([
      {
        vehicleType: "CAR",
        valuePerMinute: 230,
        hasGoldSeal: false,
        regulation: REGULATION,
        validFrom: VALID_FROM,
      },
      {
        vehicleType: "MOTORCYCLE",
        valuePerMinute: 161,
        hasGoldSeal: false,
        regulation: REGULATION,
        validFrom: VALID_FROM,
      },
    ]);
  });
});
