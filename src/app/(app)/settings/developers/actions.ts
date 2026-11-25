"use server";

import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { webhookEvents } from "@/lib/api/events";
import { audit, ForbiddenError, requirePermission } from "@/lib/session";
import { generateApiKey, generateWebhookSecret } from "@/lib/tokens";
import { checkWebhookUrl } from "@/lib/webhook-url";
import { attemptDelivery, retryDelivery } from "@/lib/webhooks";
import type { FormState } from "../../contacts/actions";

const PATH = "/settings/developers";
const admin = () => requirePermission({ settings: ["update"] });

function fail(e: unknown): FormState {
  if (e instanceof ForbiddenError) return { error: e.message };
  throw e;
}

export type KeyState = (FormState & { token?: string }) | undefined;

const keyInput = z.object({
  name: z.string().trim().min(1, "תנו למפתח שם, למשל: אתר החברה").max(60),
  role: z.enum(["admin", "sales", "agent"]),
});

export async function createApiKey(_: KeyState, form: FormData): Promise<KeyState> {
  try {
    const ctx = await admin();
    const parsed = keyInput.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const k = generateApiKey();
    const [row] = await db
      .insert(schema.apiKeys)
      .values({ orgId: ctx.orgId, ...parsed.data, prefix: k.prefix, hash: k.hash, createdById: ctx.userId })
      .returning({ id: schema.apiKeys.id });
    await audit(ctx, "api_key.create", row.id, { name: parsed.data.name, role: parsed.data.role });
    revalidatePath(PATH);
    return { ok: true, token: k.token };
  } catch (e) {
    return fail(e);
  }
}

export async function revokeApiKey(id: string): Promise<FormState> {
  try {
    const ctx = await admin();
    await db
      .update(schema.apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.orgId, ctx.orgId), isNull(schema.apiKeys.revokedAt)));
    await audit(ctx, "api_key.revoke", id);
    revalidatePath(PATH);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function createWebhook(_: FormState, form: FormData): Promise<FormState> {
  try {
    const ctx = await admin();
    const url = String(form.get("url") ?? "").trim();
    const urlErr = checkWebhookUrl(url);
    if (urlErr) return { error: urlErr };
    const all = form.get("all") === "on";
    const events = all ? [] : form.getAll("events").map(String).filter((e) => webhookEvents.includes(e));
    if (!all && !events.length) return { error: "בחרו לפחות אירוע אחד, או את כל האירועים" };
    const existing = await db.$count(schema.webhookEndpoints, eq(schema.webhookEndpoints.orgId, ctx.orgId));
    if (existing >= 10) return { error: "אפשר להגדיר עד 10 כתובות" };
    const [row] = await db
      .insert(schema.webhookEndpoints)
      .values({ orgId: ctx.orgId, url, events, secret: generateWebhookSecret() })
      .returning({ id: schema.webhookEndpoints.id });
    await audit(ctx, "webhook.create", row.id, { url, events });
    revalidatePath(PATH);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function toggleWebhook(id: string, active: boolean): Promise<FormState> {
  try {
    const ctx = await admin();
    await db
      .update(schema.webhookEndpoints)
      .set({ active })
      .where(and(eq(schema.webhookEndpoints.id, id), eq(schema.webhookEndpoints.orgId, ctx.orgId)));
    await audit(ctx, active ? "webhook.enable" : "webhook.disable", id);
    revalidatePath(PATH);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function deleteWebhook(id: string): Promise<FormState> {
  try {
    const ctx = await admin();
    await db
      .delete(schema.webhookEndpoints)
      .where(and(eq(schema.webhookEndpoints.id, id), eq(schema.webhookEndpoints.orgId, ctx.orgId)));
    await audit(ctx, "webhook.delete", id);
    revalidatePath(PATH);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

/** Sends a signed `ping` so the customer can check their endpoint and signature code. */
export async function sendTestWebhook(id: string): Promise<FormState> {
  try {
    const ctx = await admin();
    const ep = await db.query.webhookEndpoints.findFirst({
      where: and(eq(schema.webhookEndpoints.id, id), eq(schema.webhookEndpoints.orgId, ctx.orgId)),
      columns: { id: true },
    });
    if (!ep) return { error: "הכתובת לא נמצאה" };
    const [d] = await db
      .insert(schema.webhookDeliveries)
      .values({
        orgId: ctx.orgId,
        endpointId: ep.id,
        event: "ping",
        payload: {
          id: `evt_${randomUUID().replace(/-/g, "")}`,
          type: "ping",
          created_at: new Date().toISOString(),
          data: { message: "Test event from CRM" },
        },
      })
      .returning({ id: schema.webhookDeliveries.id });
    await attemptDelivery(d.id);
    revalidatePath(PATH);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function retryWebhookDelivery(id: string): Promise<FormState> {
  try {
    const ctx = await admin();
    await retryDelivery(ctx.orgId, id);
    revalidatePath(PATH);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}
