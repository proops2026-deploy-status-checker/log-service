import type { Prisma, PrismaClient } from "@prisma/client";
import type { LogCursor, LogLevel, LogRecord, LogRepository, NewLogEntry } from "./domain";

export class PrismaLogRepository implements LogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async ping(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }

  append(deployId: string, entry: NewLogEntry): Promise<LogRecord> {
    return this.prisma.logEntry.create({ data: { deployId, level: entry.level, message: entry.message } });
  }

  async appendMany(deployId: string, entries: NewLogEntry[]): Promise<number> {
    // One multi-row INSERT: atomic, and BIGSERIAL assigns seq in VALUES order, so a CI script's
    // lines keep their order even though they share one timestamp.
    const { count } = await this.prisma.logEntry.createMany({
      data: entries.map((entry) => ({ deployId, level: entry.level, message: entry.message }))
    });
    return count;
  }

  async list(deployId: string, filter: { level?: LogLevel }, cursor: LogCursor | undefined, limit: number) {
    const where: Prisma.LogEntryWhereInput = {
      deployId,
      level: filter.level,
      ...(cursor
        ? {
            OR: [
              { timestamp: { gt: cursor.timestamp } },
              { timestamp: cursor.timestamp, seq: { gt: cursor.seq } }
            ]
          }
        : {})
    };

    const rows = await this.prisma.logEntry.findMany({
      where,
      orderBy: [{ timestamp: "asc" }, { seq: "asc" }],
      take: limit + 1
    });
    return { items: rows.slice(0, limit), hasMore: rows.length > limit };
  }
}
