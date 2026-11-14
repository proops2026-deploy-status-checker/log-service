import type { LogCursor } from "./domain";

// Opaque keyset cursor: base64url("<timestamp epoch ms>:<seq>"). Clients must not parse it (IRD-002 §8).

export function encodeCursor(cursor: LogCursor): string {
  return Buffer.from(`${cursor.timestamp.getTime()}:${cursor.seq}`, "utf8").toString("base64url");
}

export function decodeCursor(value: unknown): LogCursor | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 100) return null;

  const match = /^(\d{1,15}):(\d{1,19})$/.exec(Buffer.from(value, "base64url").toString("utf8"));
  if (!match) return null;

  return { timestamp: new Date(Number(match[1])), seq: BigInt(match[2]) };
}
