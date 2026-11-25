"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { formatMoney } from "@/lib/labels";
import { audit, type Ctx, ForbiddenError, requirePermission } from "@/lib/session";
import type { FormState } from "../contacts/actions";

const { deals, pipelineStages } = schema;

const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

function fail(e: unknown): FormState {
  if (e instanceof ForbiddenError) return { error: e.message };
  throw e;
}

const input = z.object({
  title: z.string().trim().min(1, "חסר שם לעסקה").max(140),
  amount: z.preprocess(
    (v) => (typeof v === "string" ? v.replace(/[,\s₪]/g, "") || "0" : v),
    z.coerce.number({ error: "סכום לא תקין" }).int("סכום בשקלים שלמים").min(0, "סכום לא תקין").max(1_000_000_000),
  ),
  stageId: z.uuid("בחרו שלב"),
  contactId: z.preprocess(emptyToNull, z.uuid().nullable()),
  companyId: z.preprocess(emptyToNull, z.uuid().nullable()),
  ownerId: z.preprocess(emptyToNull, z.string().nullable()),
  expectedClose: z.preprocess(emptyToNull, z.iso.date("תאריך לא תקין").nullable()),
});

type Input = z.infer<typeof input>;

/** Every reference must belong to the caller's organization. Fills the company from the contact. */
async function checkRefs(ctx: Ctx, v: Input): Promise<string | Input> {
  const stage = await db.query.pipelineStages.findFirst({
    where: and(eq(pipelineStages.id, v.stageId), eq(pipelineStages.orgId, ctx.orgId)),
    columns: { id: true },
  });
  if (!stage) return "השלב לא נמצא";
  let companyId = v.companyId;
  if (v.contactId) {
    const c = await db.query.contacts.findFirst({
      where: and(eq(schema.contacts.id, v.contactId), eq(schema.contacts.orgId, ctx.orgId)),
      columns: { companyId: true },
    });
    if (!c) return "איש הקשר לא נמצא";
    companyId ??= c.companyId;
  }
  if (companyId) {
    const c = await db.query.companies.findFirst({
      where: and(eq(schema.companies.id, companyId), eq(schema.companies.orgId, ctx.orgId)),
      columns: { id: true },
    });
    if (!c) return "החברה לא נמצאה";
  }
  if (v.ownerId) {
    const m = await db.query.member.findFirst({
      where: and(eq(schema.member.userId, v.ownerId), eq(schema.member.organizationId, ctx.orgId)),
      columns: { id: true },
    });
    if (!m) return "האחראי לא נמצא בארגון";
  }
  return { ...v, companyId };
}

async function loadDeal(ctx: Ctx, id: string) {
  return db.query.deals.findFirst({
    where: and(eq(deals.id, id), eq(deals.orgId, ctx.orgId)),
  });
}

async function stageName(ctx: Ctx, id: string) {
  const s = await db.query.pipelineStages.findFirst({
    where: and(eq(pipelineStages.id, id), eq(pipelineStages.orgId, ctx.orgId)),
    columns: { name: true },
  });
  return s?.name ?? null;
}

type DealRef = { id: string; contactId: string | null; companyId: string | null };

async function logDeal(ctx: Ctx, d: DealRef, body: string) {
  await db.insert(schema.activities).values({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    dealId: d.id,
    contactId: d.contactId,
    companyId: d.companyId,
    type: "deal",
    body,
  });
}

function refresh(d: DealRef) {
  revalidatePath("/deals");
  revalidatePath(`/deals/${d.id}`);
  revalidatePath("/");
  if (d.contactId) revalidatePath(`/contacts/${d.contactId}`);
  if (d.companyId) revalidatePath(`/companies/${d.companyId}`);
}

export async function createDeal(_: FormState, form: FormData): Promise<FormState> {
  let id: string;
  try {
    const ctx = await requirePermission({ deal: ["create"] });
    const parsed = input.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const v = await checkRefs(ctx, parsed.data);
    if (typeof v === "string") return { error: v };
    const [row] = await db
      .insert(deals)
      .values({ ...v, ownerId: v.ownerId ?? ctx.userId, orgId: ctx.orgId })
      .returning({ id: deals.id, contactId: deals.contactId, companyId: deals.companyId });
    id = row.id;
    await logDeal(ctx, row, `נפתחה עסקה: ${v.title}, ${formatMoney(v.amount)}`);
    await audit(ctx, "deal.create", id);
    refresh(row);
  } catch (e) {
    return fail(e);
  }
  redirect(`/deals/${id}`);
}

export async function updateDeal(id: string, _: FormState, form: FormData): Promise<FormState> {
  try {
    const ctx = await requirePermission({ deal: ["update"] });
    const before = await loadDeal(ctx, id);
    if (!before) return { error: "העסקה לא נמצאה" };
    const parsed = input.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const v = await checkRefs(ctx, parsed.data);
    if (typeof v === "string") return { error: v };
    const stageMoved = v.stageId !== before.stageId;
    await db
      .update(deals)
      .set({ ...v, ...(stageMoved && { stageChangedAt: new Date() }) })
      .where(eq(deals.id, id));
    const after = { id, contactId: v.contactId, companyId: v.companyId };
    if (stageMoved) await logDeal(ctx, after, `הועברה לשלב ${await stageName(ctx, v.stageId)}`);
    if (v.amount !== before.amount) {
      await logDeal(ctx, after, `הסכום שונה ל־${formatMoney(v.amount)} (היה ${formatMoney(before.amount)})`);
    }
    await audit(ctx, "deal.update", id);
    refresh(after);
    if (before.contactId !== v.contactId) refresh(before);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

/** Board drag-and-drop and the stage bar on the deal page. */
export async function moveDeal(id: string, stageId: string): Promise<FormState> {
  try {
    const ctx = await requirePermission({ deal: ["update"] });
    if (!z.uuid().safeParse(stageId).success) return { error: "השלב לא נמצא" };
    const d = await loadDeal(ctx, id);
    if (!d) return { error: "העסקה לא נמצאה" };
    if (d.status !== "open") return { error: "העסקה סגורה. פתחו אותה מחדש כדי להזיז שלב." };
    if (d.stageId === stageId) return { ok: true };
    const name = await stageName(ctx, stageId);
    if (!name) return { error: "השלב לא נמצא" };
    await db.update(deals).set({ stageId, stageChangedAt: new Date() }).where(eq(deals.id, id));
    await logDeal(ctx, d, `הועברה לשלב ${name}`);
    await audit(ctx, "deal.move", id, { stageId });
    refresh(d);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

const closeInput = z.object({
  outcome: z.enum(["won", "lost"]),
  reason: z.preprocess((v) => (v === undefined ? null : emptyToNull(v)), z.string().trim().max(300).nullable()),
});

export async function closeDeal(id: string, _: FormState, form: FormData): Promise<FormState> {
  try {
    const ctx = await requirePermission({ deal: ["update"] });
    const parsed = closeInput.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: "בחרו תוצאה" };
    const { outcome, reason } = parsed.data;
    if (outcome === "lost" && !reason) return { error: "כתבו בקצרה למה העסקה לא נסגרה" };
    const d = await loadDeal(ctx, id);
    if (!d) return { error: "העסקה לא נמצאה" };
    if (d.status !== "open") return { error: "העסקה כבר סגורה" };
    await db
      .update(deals)
      .set({ status: outcome, closedAt: new Date(), lostReason: outcome === "lost" ? reason : null })
      .where(eq(deals.id, id));
    await logDeal(
      ctx,
      d,
      outcome === "won"
        ? `העסקה נחתמה: ${formatMoney(d.amount, d.currency)}`
        : `העסקה לא נסגרה. סיבה: ${reason}`,
    );
    // A won deal makes the contact a customer.
    if (outcome === "won" && d.contactId) {
      const [c] = await db
        .update(schema.contacts)
        .set({ status: "customer" })
        .where(and(eq(schema.contacts.id, d.contactId), eq(schema.contacts.orgId, ctx.orgId)))
        .returning({ id: schema.contacts.id });
      if (c) revalidatePath("/contacts");
    }
    await audit(ctx, `deal.${outcome}`, id);
    refresh(d);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function reopenDeal(id: string): Promise<FormState> {
  try {
    const ctx = await requirePermission({ deal: ["update"] });
    const d = await loadDeal(ctx, id);
    if (!d) return { error: "העסקה לא נמצאה" };
    if (d.status === "open") return { ok: true };
    await db
      .update(deals)
      .set({ status: "open", closedAt: null, lostReason: null })
      .where(eq(deals.id, id));
    await logDeal(ctx, d, "העסקה נפתחה מחדש");
    await audit(ctx, "deal.reopen", id);
    refresh(d);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

const noteInput = z.object({
  type: z.enum(["note", "call", "email", "meeting"]).default("note"),
  body: z.string().trim().min(1, "אי אפשר לשמור רישום ריק").max(5000),
});

export async function logDealActivity(id: string, _: FormState, form: FormData): Promise<FormState> {
  try {
    const ctx = await requirePermission({ deal: ["update"] });
    const parsed = noteInput.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const d = await loadDeal(ctx, id);
    if (!d) return { error: "העסקה לא נמצאה" };
    await db.insert(schema.activities).values({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      dealId: id,
      contactId: d.contactId,
      companyId: d.companyId,
      ...parsed.data,
    });
    refresh(d);
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export async function deleteDeal(id: string): Promise<FormState> {
  try {
    const ctx = await requirePermission({ deal: ["delete"] });
    const [d] = await db
      .delete(deals)
      .where(and(eq(deals.id, id), eq(deals.orgId, ctx.orgId)))
      .returning({ id: deals.id, contactId: deals.contactId, companyId: deals.companyId });
    if (!d) return { error: "העסקה לא נמצאה" };
    await audit(ctx, "deal.delete", id);
    refresh(d);
  } catch (e) {
    return fail(e);
  }
  redirect("/deals");
}
