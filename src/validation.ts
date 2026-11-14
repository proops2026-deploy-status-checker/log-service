import { z } from "zod";
import { decodeCursor } from "./cursor";
import { LOG_LEVELS } from "./domain";

// Request schemas — the single place that defines what the API accepts (IRD-002 §7).

export const MAX_MESSAGE_LENGTH = 10_000;
export const MAX_BATCH_SIZE = 500;

export const deployIdParams = z.object({
  id: z.string().uuid("must be a deploy id (UUID)")
});

const logEntry = z.object({
  level: z.enum(LOG_LEVELS),
  // Stored verbatim (indentation in stack traces matters) but must not be blank.
  message: z
    .string()
    .max(MAX_MESSAGE_LENGTH)
    .refine((message) => message.trim().length > 0, "must not be empty")
});

export const appendLogBody = logEntry;

export const appendLogBatchBody = z.object({
  entries: z.array(logEntry).min(1).max(MAX_BATCH_SIZE)
});

export const listLogsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  level: z.enum(LOG_LEVELS).optional(),
  cursor: z
    .string()
    .transform((value, ctx) => {
      const cursor = decodeCursor(value);
      if (!cursor) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid cursor" });
        return z.NEVER;
      }
      return cursor;
    })
    .optional()
});
