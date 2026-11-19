import type { Prisma } from "./generated/prisma/client.js";

// For tests that run in a transaction that always rolls back: closes the current
// rate, grace period, cap and spaces versions, so a test that creates its own versions at a
// fixed date does not depend on the versions already in a development database
// (RI-07). Each version closes one millisecond after it starts, which keeps its range
// valid.
export async function closeCurrentVersions(db: Prisma.TransactionClient): Promise<void> {
  await db.$executeRawUnsafe(
    "UPDATE tarifa SET vigente_hasta = vigente_desde + interval '1 millisecond' WHERE vigente_hasta IS NULL",
  );
  await db.$executeRawUnsafe(
    "UPDATE periodo_gracia SET vigente_hasta = vigente_desde + interval '1 millisecond' WHERE vigente_hasta IS NULL",
  );
  await db.$executeRawUnsafe(
    "UPDATE tope_periodo SET vigente_hasta = vigente_desde + interval '1 millisecond' WHERE vigente_hasta IS NULL",
  );
  await db.$executeRawUnsafe(
    "UPDATE cupo SET vigente_hasta = vigente_desde + interval '1 millisecond' WHERE vigente_hasta IS NULL",
  );
}
