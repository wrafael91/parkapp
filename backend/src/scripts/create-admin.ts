// Bootstrap script: creates the first administrator account (requisitos 1.3).
// It runs on the server, through Session Manager, with the parkapp_app URL.
// The password comes through standard input, so it never appears in the shell
// history, in the process list or in this script's output:
//
//   printf '%s' "$CLAVE" | node dist/scripts/create-admin.js <correo> "<nombre>"
//
// DATABASE_URL must be set. This file does not import config.ts, which also
// requires PORT and reads .env.
import { createPrismaClient } from "../db.js";
import { createAdministrator } from "../modules/accounts/create-administrator.js";

const USAGE =
  'Uso: printf \'%s\' "$CLAVE" | DATABASE_URL=... node dist/scripts/create-admin.js <correo> "<nombre>"';

const REJECTED = {
  passwordLength: "La contraseña debe tener entre 15 y 64 caracteres. No se creó la cuenta.",
  emailInUse: "Ya existe una cuenta con ese correo. No se creó ni se cambió nada.",
} as const;

async function readPassword(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  // A final line break (echo, or a typed line) is not part of the password.
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
}

async function main(): Promise<number> {
  const [email, name] = process.argv.slice(2);
  const databaseUrl = process.env.DATABASE_URL;
  if (!email || !name || !databaseUrl) {
    console.error(USAGE);
    return 2;
  }
  // Without a pipe, the terminal would show the password as it is typed.
  if (process.stdin.isTTY) {
    console.error("La contraseña va por la entrada estándar (con printf y |).");
    console.error(USAGE);
    return 2;
  }

  const password = await readPassword();
  const prisma = createPrismaClient(databaseUrl);
  try {
    const result = await prisma.$transaction((db) =>
      createAdministrator(db, { name, email, password, now: new Date() }),
    );
    if (!result.ok) {
      console.error(REJECTED[result.reason]);
      return 1;
    }
    console.log(`Cuenta de administrador creada (id ${result.userId}).`);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

process.exitCode = await main();
