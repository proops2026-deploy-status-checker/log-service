import { PrismaClient } from "@prisma/client";
import { createApp } from "./app";
import { PrismaLogRepository } from "./repository";
import { purgeExpiredLogs, scheduleDailyPurge } from "./retention";

// Process wiring only: build real dependencies, start HTTP + the retention schedule, shut down cleanly.
const port = Number(process.env.PORT ?? 3002);
const shutdownTimeoutMs = 10_000;

const prisma = new PrismaClient();
const app = createApp({ repo: new PrismaLogRepository(prisma) });
const retention = scheduleDailyPurge(() => purgeExpiredLogs(prisma));

const server = app.listen(port, () => {
  console.log(`log-service listening on port ${port}`);
});

// Kubernetes sends SIGTERM before killing the Pod: stop the schedule and new connections,
// let in-flight requests finish, close PostgreSQL, then exit (force-exit if they hang).
function shutdown(signal: NodeJS.Signals): void {
  console.log(`log-service received ${signal}, shutting down`);
  retention.stop();
  setTimeout(() => process.exit(1), shutdownTimeoutMs).unref();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
