import express from "express";
import { PrismaClient } from "@prisma/client";

const app = express();
const port = process.env.PORT ?? 3002;
const prisma = new PrismaClient();

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

app.listen(port, () => {
  console.log(`log-service listening on port ${port}`);
});

async function shutdown() {
  await prisma.$disconnect();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
