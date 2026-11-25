import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { toApi } from "./api/dto";
import { eventFor } from "./api/events";
import { log } from "./log";
import { backoffSeconds, signWebhook } from "./tokens";

export const MAX_ATTEMPTS = 8;

const tables = {
  contact: schema.contacts,
  company: schema.companies,
  deal: schema.deals,
  ticket: schema.tickets,
  appointment: schema.appointments,
} as const;

async function snapshot(resource: keyof typeof tables, orgId: string, id: string) {
  const t = tables[resource];
  const [row] = await db.select().from(t).where(and(eq(t.id, id), eq(t.orgId, orgId))).limit(1);
  return row ? toApi(row) : { id };
}

/**
 * Called for every audited action. Writes one outbox row per subscribed
 * endpoint (durable), and returns their ids so the caller can attempt
 * delivery right away; the cron retries whatever fails.
 */
export async function enqueueEvent(orgId: string, action: string, target: string, metadata?: unknown) {
  const event = eventFor[action];
  if (!event) return [];
  const endpoints = await db
    .select({ id: schema.webhookEndpoints.id, events: schema.webhookEndpoints.events })
    .from(schema.webhookEndpoints)
    .where(and(eq(schema.webhookEndpoints.orgId, orgId), eq(schema.webhookEndpoints.active, true)));
  const targets = endpoints.filter((e) => e.events.length === 0 || e.events.includes(event));
  if (!targets.length) return [];

  const resource = action.split(".")[0] as keyof typeof tables;
  const data = event.endsWith(".deleted") ? { id: target } : await snapshot(resource, orgId, target);
  const payload = {
    id: `evt_${randomUUID().replace(/-/g, "")}`,
    type: event,
    created_at: new Date().toISOString(),
    data,
    ...(metadata && typeof metadata === "object" ? { changes: metadata } : {}),
  };
  const rows = await db
    .insert(schema.webhookDeliveries)
    .values(targets.map((e) => ({ orgId, endpointId: e.id, event, payload })))
    .returning({ id: schema.webhookDeliveries.id });
  return rows.map((r) => r.id);
}

/** Sends one delivery. Never throws; records the outcome on the row. */
export async function attemptDelivery(id: string) {
  const [d] = await db
    .select({
      id: schema.webhookDeliveries.id,
      status: schema.webhookDeliveries.status,
      attempts: schema.webhookDeliveries.attempts,
      payload: schema.webhookDeliveries.payload,
      event: schema.webhookDeliveries.event,
      url: schema.webhookEndpoints.url,
      secret: schema.webhookEndpoints.secret,
      active: schema.webhookEndpoints.active,
    })
    .from(schema.webhookDeliveries)
    .innerJoin(schema.webhookEndpoints, eq(schema.webhookEndpoints.id, schema.webhookDeliveries.endpointId))
    .where(eq(schema.webhookDeliveries.id, id))
    .limit(1);
  if (!d || d.status !== "pending") return;

  const body = JSON.stringify(d.payload);
  const attempts = d.attempts + 1;
  let statusCode: number | null = null;
  let error: string | null = null;
  const started = Date.now();
  try {
    const res = await fetch(d.url, {
      method: "POST",
      redirect: "manual", // a redirect could point at an internal host
      signal: AbortSignal.timeout(10_000),
      headers: {
        "content-type": "application/json",
        "user-agent": "CRM-Webhooks/1.0",
        "x-crm-event": d.event,
        "x-crm-delivery": d.id,
        "x-crm-signature": signWebhook(d.secret, body),
      },
      body,
    });
    statusCode = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const ok = error === null;
  const giveUp = !ok && (attempts >= MAX_ATTEMPTS || !d.active);
  await db
    .update(schema.webhookDeliveries)
    .set({
      attempts,
      lastStatusCode: statusCode,
      lastError: error,
      status: ok ? "succeeded" : giveUp ? "failed" : "pending",
      deliveredAt: ok ? new Date() : null,
      nextAttemptAt: new Date(Date.now() + backoffSeconds(attempts) * 1000),
    })
    .where(eq(schema.webhookDeliveries.id, id));
  log[ok ? "info" : "warn"]("webhook.delivery", {
    deliveryId: id,
    event: d.event,
    attempt: attempts,
    statusCode,
    ok,
    giveUp,
    ms: Date.now() - started,
    ...(error ? { error } : {}),
  });
}

/**
 * Claims due deliveries with a short lease (`FOR UPDATE SKIP LOCKED`) so
 * several workers can run at once without sending the same event twice.
 */
export async function processDueDeliveries(limit = 50) {
  const claimed = await db.execute<{ id: string }>(sql`
    update webhook_deliveries set next_attempt_at = now() + interval '2 minutes'
    where id in (
      select id from webhook_deliveries
      where status = 'pending' and next_attempt_at <= now()
      order by next_attempt_at
      limit ${limit}
      for update skip locked
    )
    returning id`);
  const ids = [...claimed].map((r) => r.id);
  for (const id of ids) await attemptDelivery(id);
  return ids.length;
}

export async function retryDelivery(orgId: string, id: string) {
  await db
    .update(schema.webhookDeliveries)
    .set({ status: "pending", nextAttemptAt: new Date() })
    .where(and(eq(schema.webhookDeliveries.id, id), eq(schema.webhookDeliveries.orgId, orgId)));
  await attemptDelivery(id);
}

export async function attemptAll(ids: string[]) {
  if (!ids.length) return;
  await Promise.all(ids.map(attemptDelivery));
}

export async function pendingCount(orgId: string, endpointIds: string[]) {
  if (!endpointIds.length) return 0;
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.webhookDeliveries)
    .where(
      and(
        eq(schema.webhookDeliveries.orgId, orgId),
        inArray(schema.webhookDeliveries.endpointId, endpointIds),
        eq(schema.webhookDeliveries.status, "pending"),
      ),
    );
  return r.n;
}
