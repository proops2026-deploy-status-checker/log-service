import type { LogRecord } from "./domain";

// Public response shape (snake_case, IRD-002 §7). `seq` is internal: it only feeds the cursor.
export interface LogDto {
  id: string;
  deploy_id: string;
  timestamp: string;
  level: string;
  message: string;
}

export function toLogDto(log: LogRecord): LogDto {
  return {
    id: log.id,
    deploy_id: log.deployId,
    timestamp: log.timestamp.toISOString(),
    level: log.level,
    message: log.message
  };
}
