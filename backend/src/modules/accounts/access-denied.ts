import type { Prisma } from "../../generated/prisma/client.js";

// Receives the transaction it runs in, like the session service.
type Db = Prisma.TransactionClient;

interface AccessDeniedInput {
  userId: number;
  ip: string;
  method: string;
  url: string;
  now: Date;
}

// NFR-05: a signed-in user asked for an action that their role does not allow
// (matrix 1.2). The route answers 403 ACCESO_DENEGADO after this event commits.
// As the catalog says (docs/modelo-datos.md, 4.1), the event keeps the method
// and the route without the query string, and has no entity.
export async function recordAccessDenied(db: Db, input: AccessDeniedInput): Promise<void> {
  await db.auditEvent.create({
    data: {
      action: "ACCESS_DENIED",
      userId: input.userId,
      ip: input.ip,
      detail: { metodo: input.method, ruta: input.url.split("?")[0] },
      occurredAt: input.now,
    },
  });
}
