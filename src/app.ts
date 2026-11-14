import express from "express";
import type { LogRepository } from "./domain";
import { encodeCursor } from "./cursor";
import { toLogDto } from "./dto";
import { errorHandler, notFound, requestId } from "./http";
import { appendLogBatchBody, appendLogBody, deployIdParams, listLogsQuery } from "./validation";

export interface AppDependencies {
  repo: LogRepository;
}

// IRD-002: append-only, always paginated, never calls Deploy Service (a log for an unknown deploy
// id is accepted — the deploy id is a logical reference only, Decision #2/#4).
export function createApp({ repo }: AppDependencies) {
  const app = express();
  app.disable("x-powered-by");
  app.use(requestId);
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", async (_req, res) => {
    try {
      await repo.ping();
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });

  // CI submits one log line (US-LS-01).
  app.post("/deploys/:id/logs", async (req, res) => {
    const { id } = deployIdParams.parse(req.params);
    const entry = appendLogBody.parse(req.body);
    res.status(201).json(toLogDto(await repo.append(id, entry)));
  });

  // CI submits up to 500 lines in one request, stored atomically and in order.
  app.post("/deploys/:id/logs/batch", async (req, res) => {
    const { id } = deployIdParams.parse(req.params);
    const { entries } = appendLogBatchBody.parse(req.body);
    res.status(201).json({ count: await repo.appendMany(id, entries) });
  });

  // Logs in time order, one page at a time (US-LS-02/03/04).
  app.get("/deploys/:id/logs", async (req, res) => {
    const { id } = deployIdParams.parse(req.params);
    const { limit, level, cursor } = listLogsQuery.parse(req.query);
    const page = await repo.list(id, { level }, cursor, limit);
    const last = page.items.at(-1);
    res.json({
      items: page.items.map(toLogDto),
      next_cursor: page.hasMore && last ? encodeCursor({ timestamp: last.timestamp, seq: last.seq }) : null
    });
  });

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
