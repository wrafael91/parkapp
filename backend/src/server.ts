import { config } from "./config.js";
import { createPrismaClient } from "./db.js";
import { createApp } from "./app.js";

const HOST = "127.0.0.1";

const prisma = createPrismaClient(config.databaseUrl);
const app = createApp(prisma);

const server = app.listen(config.port, HOST, () => {
  console.log(`ParkApp API listening on http://${HOST}:${config.port}`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received, closing server`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);