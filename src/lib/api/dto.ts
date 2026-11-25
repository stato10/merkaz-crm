/** Public API shape: snake_case keys, ISO dates, no internal tenant column. */
const snake = (k: string) => k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

export function toApi(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "orgId") continue;
    out[snake(k)] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

export function encodeCursor(createdAt: Date, id: string) {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id])).toString("base64url");
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [t, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const createdAt = new Date(t);
    if (typeof id !== "string" || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}
