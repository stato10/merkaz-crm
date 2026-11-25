import "server-only";
import { db, schema } from "@/db";
import { defer } from "./defer";
import { log } from "./log";
import { attemptAll, enqueueEvent } from "./webhooks";

export type AuditEntry = {
  orgId: string;
  actorId: string | null;
  action: string;
  target: string;
  metadata?: Record<string, unknown>;
};

/**
 * Single choke point for state changes: append to the audit log, then enqueue
 * webhook deliveries (outbox) and try them after the response is sent.
 */
export async function writeAudit(e: AuditEntry) {
  await db.insert(schema.auditLog).values(e);
  try {
    const ids = await enqueueEvent(e.orgId, e.action, e.target, e.metadata);
    if (ids.length) await defer(() => attemptAll(ids));
  } catch (err) {
    // Never fail the user's action because of a webhook; the row is retried by cron.
    log.error("webhook.enqueue_failed", { action: e.action, orgId: e.orgId, err });
  }
}
