import "server-only";
import { lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";

export type RateResult = { allowed: boolean; limit: number; remaining: number; resetAt: number };

/**
 * Fixed-window rate limit stored in Postgres, so it holds across every
 * serverless instance without adding Redis. One upsert per request.
 */
export async function rateLimit(bucket: string, limit: number, windowSec: number): Promise<RateResult> {
  const now = Date.now();
  const windowStart = Math.floor(now / 1000 / windowSec) * windowSec;
  const resetAt = (windowStart + windowSec) * 1000;
  const key = `${bucket}:${windowStart}`;

  const [row] = await db
    .insert(schema.rateLimits)
    .values({ key, count: 1, expiresAt: new Date(resetAt) })
    .onConflictDoUpdate({ target: schema.rateLimits.key, set: { count: sql`${schema.rateLimits.count} + 1` } })
    .returning({ count: schema.rateLimits.count });

  // Opportunistic cleanup instead of a separate job.
  if (Math.random() < 0.01) {
    await db.delete(schema.rateLimits).where(lt(schema.rateLimits.expiresAt, new Date(now)));
  }

  return { allowed: row.count <= limit, limit, remaining: Math.max(0, limit - row.count), resetAt };
}
