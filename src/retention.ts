import type { PrismaClient } from "@prisma/client";

// IRD-002 Decision #5 / §6: logs older than 30 days are purged daily at 02:00 UTC.
// The purge is idempotent and every run (success or failure) is written to purge_audit_log.

const RETENTION_DAYS = 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function purgeExpiredLogs(prisma: PrismaClient, now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * ONE_DAY_MS);
  try {
    const { count } = await prisma.logEntry.deleteMany({ where: { timestamp: { lt: cutoff } } });
    await prisma.purgeAuditLog.create({ data: { ranAt: now, cutoff, deletedCount: count, status: "success" } });
    console.log(JSON.stringify({ level: "info", msg: "log retention purge", cutoff: cutoff.toISOString(), deleted_count: count }));
    return { cutoff, deletedCount: count };
  } catch (err) {
    // Best-effort audit row even on failure; swallow a secondary audit-write
    // error so it never masks the original purge failure below.
    await prisma.purgeAuditLog
      .create({
        data: {
          ranAt: now,
          cutoff,
          deletedCount: 0,
          status: "error",
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      })
      .catch(() => {});
    throw err;
  }
}

export function msUntilNext2amUtc(from: Date = new Date()): number {
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 2, 0, 0, 0));
  if (next.getTime() <= from.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - from.getTime();
}

export interface SchedulerClock {
  now: () => Date;
  setTimer: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearTimer: (timer: NodeJS.Timeout) => void;
}

const systemClock: SchedulerClock = {
  now: () => new Date(),
  setTimer: (callback, ms) => setTimeout(callback, ms),
  clearTimer: (timer) => clearTimeout(timer)
};

/**
 * Runs `purge` at every 02:00 UTC. The delay is recomputed from the clock after each run,
 * so a late timer or a slow purge never makes the schedule drift (a fixed 24 h interval would).
 */
export function scheduleDailyPurge(purge: () => Promise<unknown>, clock: SchedulerClock = systemClock) {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const scheduleNext = () => {
    if (stopped) return;
    timer = clock.setTimer(run, msUntilNext2amUtc(clock.now()));
  };

  const run = () => {
    purge()
      .catch((err) => console.error(JSON.stringify({ level: "error", msg: "log retention purge failed", error: String(err) })))
      .finally(scheduleNext);
  };

  scheduleNext();
  return {
    stop: () => {
      stopped = true;
      if (timer) clock.clearTimer(timer);
    }
  };
}
