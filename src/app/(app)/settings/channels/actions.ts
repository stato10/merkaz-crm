"use server";

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { sealSecrets } from "@/lib/channels/crypto";
import { phoneDigits } from "@/lib/channels/parse";
import { ingestInbound } from "@/lib/channels/service";
import { audit, ForbiddenError, requirePermission } from "@/lib/session";
import type { FormState } from "../../contacts/actions";

const PATH = "/settings/channels";
const admin = () => requirePermission({ settings: ["update"] });
const { channelAccounts } = schema;

function fail(e: unknown): FormState {
  if (e instanceof ForbiddenError) return { error: e.message };
  throw e;
}

const base = z.object({
  name: z.string().trim().min(1, "תנו לערוץ שם, למשל: שירות לקוחות").max(60),
});
const email = base.extend({
  kind: z.literal("email"),
  address: z.email("כתובת השולח לא תקינה").trim().toLowerCase(),
});
const whatsapp = base.extend({
  kind: z.literal("whatsapp"),
  address: z
    .string()
    .trim()
    .transform((v) => phoneDigits(v))
    .pipe(z.string().regex(/^\d{8,15}$/, "מספר הטלפון לא תקין")),
});
const input = z.discriminatedUnion("kind", [email, whatsapp]);
const req = (label: string) => z.string().trim().min(1, `חסר ${label}`).max(500);

/** Provider credentials, validated per provider. Secrets are encrypted before they touch the database. */
type Fields = { ok: true; config: Record<string, string>; secrets: string | null } | { ok: false; error: string };

function providerFields(kind: "email" | "whatsapp", provider: string, form: Record<string, unknown>): Fields {
  if (provider === "sandbox") return { ok: true, config: {}, secrets: null };
  if (kind === "email" && provider === "postmark") {
    const r = z.object({ serverToken: req("Server Token") }).safeParse(form);
    if (!r.success) return { ok: false, error: r.error.issues[0].message };
    return { ok: true, config: { messageStream: "outbound" }, secrets: sealSecrets(r.data) };
  }
  if (kind === "whatsapp" && provider === "meta") {
    const r = z
      .object({
        phoneNumberId: z.string().trim().regex(/^\d{5,25}$/, "מזהה מספר הטלפון (Phone number ID) הוא מספר ארוך"),
        accessToken: req("אסימון גישה"),
        appSecret: req("App Secret"),
      })
      .safeParse(form);
    if (!r.success) return { ok: false, error: r.error.issues[0].message };
    const { phoneNumberId, ...secrets } = r.data;
    return { ok: true, config: { phoneNumberId }, secrets: sealSecrets(secrets) };
  }
  return { ok: false, error: "הספק לא מתאים לסוג הערוץ" };
}

export async function createChannel(_: FormState, form: FormData): Promise<FormState> {
  try {
    const ctx = await admin();
    const raw = Object.fromEntries(form);
    const parsed = input.safeParse(raw);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const provider = String(raw.provider ?? "sandbox");
    const p = providerFields(parsed.data.kind, provider, raw);
    if (!p.ok) return { error: p.error };
    const existing = await db.$count(channelAccounts, eq(channelAccounts.orgId, ctx.orgId));
    if (existing >= 10) return { error: "אפשר לחבר עד 10 ערוצים" };
    const [row] = await db
      .insert(channelAccounts)
      .values({
        orgId: ctx.orgId,
        kind: parsed.data.kind,
        provider,
        name: parsed.data.name,
        address: parsed.data.address,
        config: p.config,
        secrets: p.secrets,
        inboundToken: randomBytes(24).toString("base64url"),
      })
      .returning({ id: channelAccounts.id });
    await audit(ctx, "channel.create", row.id, { kind: parsed.data.kind, provider });
    revalidatePath(PATH);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function toggleChannel(id: string, active: boolean): Promise<FormState> {
  try {
    const ctx = await admin();
    await db.update(channelAccounts).set({ active }).where(and(eq(channelAccounts.id, id), eq(channelAccounts.orgId, ctx.orgId)));
    await audit(ctx, active ? "channel.enable" : "channel.disable", id);
    revalidatePath(PATH);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function deleteChannel(id: string): Promise<FormState> {
  try {
    const ctx = await admin();
    await db.delete(channelAccounts).where(and(eq(channelAccounts.id, id), eq(channelAccounts.orgId, ctx.orgId)));
    await audit(ctx, "channel.delete", id);
    revalidatePath(PATH);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

const simInput = z.object({
  from: z.string().trim().min(3, "מאיפה ההודעה?").max(120),
  name: z.string().trim().max(80).optional(),
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().min(1, "כתבו את ההודעה של הלקוח").max(4000),
});

export type SimState = (FormState & { ticketId?: string }) | undefined;

/** Sandbox channels only: play a customer message through the real inbound pipeline. */
export async function simulateInbound(id: string, _: SimState, form: FormData): Promise<SimState> {
  try {
    const ctx = await admin();
    const a = await db.query.channelAccounts.findFirst({
      where: and(eq(channelAccounts.id, id), eq(channelAccounts.orgId, ctx.orgId)),
    });
    if (!a || a.provider !== "sandbox") return { error: "אפשר לדמות הודעות רק בערוץ בדיקה" };
    if (!a.active) return { error: "הערוץ מושבת" };
    const parsed = simInput.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const v = parsed.data;
    const from = a.kind === "email" ? v.from.toLowerCase() : phoneDigits(v.from);
    if (a.kind === "email" ? !z.email().safeParse(from).success : !/^\d{8,15}$/.test(from)) {
      return { error: a.kind === "email" ? "כתובת האימייל לא תקינה" : "מספר הטלפון לא תקין" };
    }
    const r = await ingestInbound(a, {
      from,
      name: v.name || null,
      subject: a.kind === "email" ? v.subject || "פנייה חדשה" : null,
      body: v.body,
      externalId: `${a.kind === "email" ? "email" : "wa"}:sim_${randomBytes(9).toString("base64url")}`,
      inReplyTo: null,
      at: new Date(),
    });
    revalidatePath("/tickets");
    return { ok: true, ticketId: r.ticketId };
  } catch (e) {
    return fail(e);
  }
}
