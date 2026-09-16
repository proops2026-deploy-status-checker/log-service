import express from "express";
import { LogLevel, PrismaClient } from "@prisma/client";
import { scheduleDailyPurge } from "./retention";
import { parseCursor } from "./cursor";

const app = express();
const port = process.env.PORT ?? 3002;
const prisma = new PrismaClient();
const defaultLimit = 50;
const maxLimit = 200;
const retention = scheduleDailyPurge(prisma);

app.use(express.json());

// TIE-13: readiness depends on the Log Service's own database only.
// Log ingestion, retrieval, and retention are implemented in TIE-14.
app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  }
});

app.post("/deploys/:id/logs", async (req, res) => {
  const { level, message } = req.body ?? {};
  if (!Object.values(LogLevel).includes(level) || typeof message !== "string" || !message) {
    res.status(400).json({ error: "level (info|warn|error) and message are required" });
    return;
  }
  const log = await prisma.logEntry.create({ data: { deployId: req.params.id, level, message } });
  res.status(201).json(log);
});

app.get("/deploys/:id/logs", async (req, res) => {
  const requestedLimit = Number(req.query.limit ?? defaultLimit);
  const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, maxLimit) : defaultLimit;
  const cursor = parseCursor(req.query.cursor);
  if (req.query.cursor && !cursor) { res.status(400).json({ error: "invalid cursor" }); return; }
  const level = req.query.level;
  if (level && !Object.values(LogLevel).includes(level as LogLevel)) { res.status(400).json({ error: "invalid level" }); return; }
  const entries = await prisma.logEntry.findMany({
    where: { deployId: req.params.id, ...(level ? { level: level as LogLevel } : {}), ...(cursor ? { OR: [{ timestamp: { gt: cursor.timestamp } }, { timestamp: cursor.timestamp, id: { gt: cursor.id } }] } : {}) },
    orderBy: [{ timestamp: "asc" }, { id: "asc" }], take: limit + 1
  });
  const hasNext = entries.length > limit;
  const items = hasNext ? entries.slice(0, limit) : entries;
  const last = items.at(-1);
  res.json({ items, next_cursor: hasNext && last ? Buffer.from(`${last.timestamp.valueOf()}:${last.id}`).toString("base64") : null });
});

app.listen(port, () => {
  console.log(`log-service listening on port ${port}`);
});

async function shutdown() {
  retention.stop();
  await prisma.$disconnect();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
