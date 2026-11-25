import { timingSafeEqual } from "node:crypto";
import { log } from "@/lib/log";
import { processDueDeliveries } from "@/lib/webhooks";

/** Retry worker for the webhook outbox. Call every minute from a scheduler with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: { code: "unauthorized" } }, { status: 401 });
  }
  const processed = await processDueDeliveries();
  log.info("cron.webhooks", { processed });
  return Response.json({ processed });
}
