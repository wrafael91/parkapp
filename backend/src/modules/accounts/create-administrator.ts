import type { Prisma } from "../../generated/prisma/client.js";
import { hashPassword } from "./password.js";

// Receives the transaction it runs in, like the session service.
type Db = Prisma.TransactionClient;

interface CreateAdministratorInput {
  name: string;
  email: string;
  password: string;
  now: Date;
}

export type CreateAdministratorResult = { ok: true; userId: number };

// There is no public sign-up: the bootstrap script creates the first
// administrator (requisitos 1.3).
export async function createAdministrator(
  db: Db,
  input: CreateAdministratorInput,
): Promise<CreateAdministratorResult> {
  // RI-15: emails are stored in lowercase, without spaces.
  const email = input.email.trim().toLowerCase();
  const user = await db.user.create({
    data: {
      name: input.name.trim(),
      email,
      passwordHash: await hashPassword(input.password),
      role: "ADMINISTRATOR",
      // RI-16: whoever runs the script knows the password, so it must change.
      mustChangePassword: true,
      createdAt: input.now,
    },
  });
  // The system creates the account, not a person or a request, so the event
  // has no user and no IP (RI-18). It never stores the password (RI-14).
  await db.auditEvent.create({
    data: {
      action: "ACCOUNT_CREATED",
      entity: "usuario",
      entityId: user.id,
      occurredAt: input.now,
    },
  });
  return { ok: true, userId: user.id };
}
