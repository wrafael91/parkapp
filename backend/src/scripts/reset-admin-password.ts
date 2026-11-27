// Recovery script: resets the password of an administrator account, for when
// nobody can sign in as one (requisitos 1.3). It runs on the server, through
// Session Manager, with the parkapp_app URL. Like create-admin.ts, it reads the
// password from standard input, so it never appears in the shell history, in
// the process list or in this script's output:
//
//   printf '%s' "$CLAVE" | node dist/scripts/reset-admin-password.js <correo>
//
// DATABASE_URL must be set. This file does not import config.ts, which also
// requires PORT and reads .env.
import { createPrismaClient } from "../db.js";
import { resetAdministratorPassword } from "../modules/accounts/reset-administrator-password.js";

const USAGE =
  "Uso: printf '%s' \"$CLAVE\" | DATABASE_URL=... node dist/scripts/reset-admin-password.js <correo>";

const REJECTED = {
  passwordLength: "La contraseña debe tener entre 15 y 64 caracteres. No se cambió nada.",
  notFound: "No existe una cuenta con ese correo. No se cambió nada.",
  notAdministrator:
    "Esa cuenta no es de administrador: la contraseña de un operador la restablece un administrador desde la aplicación. No se cambió nada.",
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
  const [email] = process.argv.slice(2);
  const databaseUrl = process.env.DATABASE_URL;
  if (!email || !databaseUrl) {
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
      resetAdministratorPassword(db, { email, password, now: new Date() }),
    );
    if (!result.ok) {
      console.error(REJECTED[result.reason]);
      return 1;
    }
    console.log(
      `Contraseña restablecida (cuenta ${result.userId}). Se cerraron sus sesiones abiertas.`,
    );
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

process.exitCode = await main();
