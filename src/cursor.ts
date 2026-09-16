export function parseCursor(value: unknown): { timestamp: Date; id: string } | null {
  if (typeof value !== "string") return null;
  try {
    const [timestampMs, id] = Buffer.from(value, "base64").toString("utf8").split(":");
    const timestamp = new Date(Number(timestampMs));
    return Number.isNaN(timestamp.valueOf()) || !id ? null : { timestamp, id };
  } catch {
    return null;
  }
}
