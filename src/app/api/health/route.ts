import { sql } from "drizzle-orm";
import { db } from "@/db";
import { log } from "@/lib/log";

/** Liveness + database readiness, for load balancers and uptime checks. */
export async function GET() {
  const started = Date.now();
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok", db: "ok", latency_ms: Date.now() - started });
  } catch (err) {
    log.error("health.db_failed", { err });
    return Response.json({ status: "degraded", db: "unreachable" }, { status: 503 });
  }
}
