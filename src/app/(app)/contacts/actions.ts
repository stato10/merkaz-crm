"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { contactStatuses, fullName } from "@/lib/labels";
import { audit, type Ctx, ForbiddenError, requirePermission } from "@/lib/session";

export type FormState = { error?: string; ok?: boolean } | undefined;

const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

const contactInput = z.object({
  firstName: z.string().trim().min(1, "שם פרטי חובה").max(80),
  lastName: z.string().trim().max(80).default(""),
  email: z.preprocess(emptyToNull, z.email("אימייל לא תקין").nullable()),
  phone: z.preprocess(emptyToNull, z.string().trim().max(30).nullable()),
  title: z.preprocess(emptyToNull, z.string().trim().max(80).nullable()),
  source: z.preprocess(emptyToNull, z.string().trim().max(80).nullable()),
  status: z.enum(contactStatuses).default("lead"),
  companyId: z.preprocess(emptyToNull, z.uuid().nullable()),
  ownerId: z.preprocess(emptyToNull, z.string().nullable()),
  tags: z
    .string()
    .default("")
    .transform((s) =>
      [...new Set(s.split(",").map((t) => t.trim()).filter(Boolean))].slice(0, 20),
    ),
});

function parse(form: FormData) {
  return contactInput.safeParse(Object.fromEntries(form));
}

/** Company and owner must belong to the caller's organization. */
async function checkRefs(ctx: Ctx, companyId: string | null, ownerId: string | null) {
  if (companyId) {
    const c = await db.query.companies.findFirst({
      where: and(eq(schema.companies.id, companyId), eq(schema.companies.orgId, ctx.orgId)),
      columns: { id: true },
    });
    if (!c) return "החברה לא נמצאה";
  }
  if (ownerId) {
    const m = await db.query.member.findFirst({
      where: and(eq(schema.member.userId, ownerId), eq(schema.member.organizationId, ctx.orgId)),
      columns: { id: true },
    });
    if (!m) return "האחראי לא נמצא בארגון";
  }
  return null;
}

function fail(e: unknown): FormState {
  if (e instanceof ForbiddenError) return { error: e.message };
  throw e;
}

export async function createContact(_: FormState, form: FormData): Promise<FormState> {
  let id: string;
  try {
    const ctx = await requirePermission({ contact: ["create"] });
    const parsed = parse(form);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const v = parsed.data;
    const refErr = await checkRefs(ctx, v.companyId, v.ownerId);
    if (refErr) return { error: refErr };

    const [row] = await db
      .insert(schema.contacts)
      .values({ ...v, ownerId: v.ownerId ?? ctx.userId, orgId: ctx.orgId })
      .returning({ id: schema.contacts.id });
    id = row.id;
    await db.insert(schema.activities).values({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      contactId: id,
      companyId: v.companyId,
      type: "created",
      body: `${fullName(v)} נוסף/ה למערכת`,
    });
    await audit(ctx, "contact.create", id);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/contacts");
  redirect(`/contacts/${id}`);
}

export async function updateContact(id: string, _: FormState, form: FormData): Promise<FormState> {
  try {
    const ctx = await requirePermission({ contact: ["update"] });
    const parsed = parse(form);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const v = parsed.data;
    const refErr = await checkRefs(ctx, v.companyId, v.ownerId);
    if (refErr) return { error: refErr };

    const before = await db.query.contacts.findFirst({
      where: and(eq(schema.contacts.id, id), eq(schema.contacts.orgId, ctx.orgId)),
    });
    if (!before) return { error: "איש הקשר לא נמצא" };

    await db
      .update(schema.contacts)
      .set(v)
      .where(and(eq(schema.contacts.id, id), eq(schema.contacts.orgId, ctx.orgId)));

    const changed = (Object.keys(v) as (keyof typeof v)[]).filter(
      (k) => JSON.stringify(before[k]) !== JSON.stringify(v[k]),
    );
    if (changed.length) {
      const body =
        before.status !== v.status ? `הסטטוס שונה` : `פרטי איש הקשר עודכנו`;
      await db.insert(schema.activities).values({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        contactId: id,
        type: "updated",
        body,
      });
      await audit(ctx, "contact.update", id, { fields: changed });
    }
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/contacts/${id}`);
  revalidatePath("/contacts");
  return { ok: true };
}

export async function deleteContact(id: string): Promise<FormState> {
  try {
    const ctx = await requirePermission({ contact: ["delete"] });
    const deleted = await db
      .delete(schema.contacts)
      .where(and(eq(schema.contacts.id, id), eq(schema.contacts.orgId, ctx.orgId)))
      .returning({ id: schema.contacts.id });
    if (!deleted.length) return { error: "איש הקשר לא נמצא" };
    await audit(ctx, "contact.delete", id);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/contacts");
  redirect("/contacts");
}

const activityInput = z.object({
  type: z.enum(["note", "call", "email", "meeting"]).default("note"),
  body: z.string().trim().min(1, "אי אפשר לשמור רישום ריק").max(5000),
});

export async function logActivity(
  contactId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  try {
    const ctx = await requirePermission({ contact: ["update"] });
    const parsed = activityInput.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const c = await db.query.contacts.findFirst({
      where: and(eq(schema.contacts.id, contactId), eq(schema.contacts.orgId, ctx.orgId)),
      columns: { id: true, companyId: true },
    });
    if (!c) return { error: "איש הקשר לא נמצא" };
    await db.insert(schema.activities).values({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      contactId,
      companyId: c.companyId,
      ...parsed.data,
    });
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/contacts/${contactId}`);
  return { ok: true };
}
