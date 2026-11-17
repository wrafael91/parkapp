import type { Request } from "express";
import type { Prisma } from "../../generated/prisma/client.js";
import { recordAccessDenied } from "./access-denied.js";
import { readSessionToken } from "./session-cookie.js";
import { authenticate, type SessionUser } from "./session.service.js";

type Db = Prisma.TransactionClient;

// Matrix 1.2: only an administrator configures the rates and manages the
// accounts. Without a session, 401 before anything else; an operator gets 403,
// and the rejection is logged (NFR-05). The body is validated after this.
export async function authorizeAdministrator(
  db: Db,
  req: Request,
  now: Date,
): Promise<{ kind: "unauthenticated" | "denied" } | { kind: "allowed"; user: SessionUser }> {
  const token = readSessionToken(req.get("Cookie"));
  const user = token === null ? null : await authenticate(db, { token, now });
  if (user === null) return { kind: "unauthenticated" };
  if (user.role !== "ADMINISTRATOR") {
    await recordAccessDenied(db, {
      userId: user.id,
      ip: req.ip ?? "",
      method: req.method,
      url: req.originalUrl,
      now,
    });
    return { kind: "denied" };
  }
  return { kind: "allowed", user };
}
