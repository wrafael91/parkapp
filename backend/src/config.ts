import "dotenv/config";
import { parseOrigin } from "./middleware/origin.js";

// Production origin; .env sets the local one (docs/modelo-amenazas.md, 7.3).
const DEFAULT_APP_ORIGIN = "https://rolopark.com";

function readRequired(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parsePort(raw: string): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${raw}`);
  }
  return port;
}

export const config = {
  port: parsePort(readRequired("PORT")),
  databaseUrl: readRequired("DATABASE_URL"),
  appOrigin: parseOrigin(process.env.APP_ORIGIN ?? DEFAULT_APP_ORIGIN),
};
