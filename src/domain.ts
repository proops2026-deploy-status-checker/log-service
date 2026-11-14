// Domain types for the Log Service, independent of Prisma so the HTTP layer
// and its tests never need a generated client or a database.

export const LOG_LEVELS = ["info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogRecord {
  id: string;
  deployId: string;
  timestamp: Date;
  level: LogLevel;
  message: string;
  /** Insertion order (BIGSERIAL). Tie-breaker for logs written in the same millisecond. */
  seq: bigint;
}

export interface NewLogEntry {
  level: LogLevel;
  message: string;
}

// Keyset position: the last item of the previous page (ordering is timestamp ASC, seq ASC).
export interface LogCursor {
  timestamp: Date;
  seq: bigint;
}

export interface LogRepository {
  ping(): Promise<void>;
  append(deployId: string, entry: NewLogEntry): Promise<LogRecord>;
  /** All-or-nothing, stored in the given order. Returns the number of rows written. */
  appendMany(deployId: string, entries: NewLogEntry[]): Promise<number>;
  list(
    deployId: string,
    filter: { level?: LogLevel },
    cursor: LogCursor | undefined,
    limit: number
  ): Promise<{ items: LogRecord[]; hasMore: boolean }>;
}
