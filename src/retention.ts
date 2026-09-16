import { PrismaClient } from "@prisma/client";

const RETENTION_DAYS = 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export async function purgeExpiredLogs(prisma: PrismaClient, now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * ONE_DAY_MS);
  try {
    const { count } = await prisma.logEntry.deleteMany({ where: { timestamp: { lt: cutoff } } });
    await prisma.purgeAuditLog.create({ data: { ranAt: now, cutoff, deletedCount: count, status: "success" } });
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

export function scheduleDailyPurge(prisma: PrismaClient) {
  let timer: NodeJS.Timeout;
  const runAndReschedule = () => {
    purgeExpiredLogs(prisma).catch((err) => console.error("log retention purge failed:", err));
    timer = setTimeout(runAndReschedule, ONE_DAY_MS);
  };
  timer = setTimeout(runAndReschedule, msUntilNext2amUtc());
  return { stop: () => clearTimeout(timer) };
}
