"use server";

import { and, eq, gt, lt, ne, notInArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { appointmentStatuses, formatDay, formatTime, fromLocalInput } from "@/lib/labels";
import { audit, type Ctx, ForbiddenError, requirePermission } from "@/lib/session";
import type { FormState } from "../contacts/actions";

const { appointments } = schema;

const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

function fail(e: unknown): FormState {
  if (e instanceof ForbiddenError) return { error: e.message };
  throw e;
}

const input = z.object({
  contactId: z.uuid("בחרו איש קשר"),
  title: z.string().trim().min(1, "חסר תיאור לתור").max(120),
  startsAt: z.string(),
  duration: z.coerce.number().int().min(5).max(600).default(30),
  assigneeId: z.preprocess(emptyToNull, z.string().nullable()),
  location: z.preprocess(emptyToNull, z.string().trim().max(200).nullable()),
  notes: z.preprocess(emptyToNull, z.string().trim().max(5000).nullable()),
});

type Parsed = Omit<z.infer<typeof input>, "startsAt" | "duration"> & { startsAt: Date; endsAt: Date };

async function parseAndCheck(ctx: Ctx, form: FormData, selfId?: string): Promise<Parsed | string> {
  const parsed = input.safeParse(Object.fromEntries(form));
  if (!parsed.success) return parsed.error.issues[0].message;
  const { startsAt: raw, duration, ...v } = parsed.data;
  const startsAt = fromLocalInput(raw);
  if (!startsAt) return "בחרו תאריך ושעה";
  const endsAt = new Date(startsAt.getTime() + duration * 60000);

  const c = await db.query.contacts.findFirst({
    where: and(eq(schema.contacts.id, v.contactId), eq(schema.contacts.orgId, ctx.orgId)),
    columns: { id: true },
  });
  if (!c) return "איש הקשר לא נמצא";
  if (v.assigneeId) {
    const m = await db.query.member.findFirst({
      where: and(eq(schema.member.userId, v.assigneeId), eq(schema.member.organizationId, ctx.orgId)),
      columns: { id: true },
    });
    if (!m) return "איש הצוות לא נמצא בארגון";

    // One person cannot be in two appointments at once.
    const clash = await db.query.appointments.findFirst({
      where: and(
        eq(appointments.orgId, ctx.orgId),
        eq(appointments.assigneeId, v.assigneeId),
        notInArray(appointments.status, ["cancelled", "no_show"]),
        lt(appointments.startsAt, endsAt),
        gt(appointments.endsAt, startsAt),
        ...(selfId ? [ne(appointments.id, selfId)] : []),
      ),
      columns: { startsAt: true, endsAt: true },
    });
    if (clash) {
      return `המועד תפוס: לאותו איש צוות כבר יש תור ${formatDay(clash.startsAt)} ${formatTime(clash.startsAt)}–${formatTime(clash.endsAt)}`;
    }
  }
  return { ...v, startsAt, endsAt };
}

export async function createAppointment(_: FormState, form: FormData): Promise<FormState> {
  let contactId: string;
  try {
    const ctx = await requirePermission({ appointment: ["create"] });
    const v = await parseAndCheck(ctx, form);
    if (typeof v === "string") return { error: v };
    contactId = v.contactId;
    const [row] = await db
      .insert(appointments)
      .values({ ...v, orgId: ctx.orgId })
      .returning({ id: appointments.id });
    await db.insert(schema.activities).values({
      orgId: ctx.orgId,
      actorId: ctx.userId,
      contactId: v.contactId,
      type: "appointment",
      body: `נקבע תור: ${v.title}, ${formatDay(v.startsAt)} ${formatTime(v.startsAt)}`,
    });
    await audit(ctx, "appointment.create", row.id);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/appointments");
  revalidatePath(`/contacts/${contactId}`);
  redirect("/appointments");
}

export async function updateAppointment(id: string, _: FormState, form: FormData): Promise<FormState> {
  try {
    const ctx = await requirePermission({ appointment: ["update"] });
    const before = await db.query.appointments.findFirst({
      where: and(eq(appointments.id, id), eq(appointments.orgId, ctx.orgId)),
    });
    if (!before) return { error: "התור לא נמצא" };
    const v = await parseAndCheck(ctx, form, id);
    if (typeof v === "string") return { error: v };
    await db.update(appointments).set(v).where(eq(appointments.id, id));
    if (before.startsAt.getTime() !== v.startsAt.getTime()) {
      await db.insert(schema.activities).values({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        contactId: v.contactId,
        type: "appointment",
        body: `התור הוזז ל${formatDay(v.startsAt)} ${formatTime(v.startsAt)} (היה ${formatDay(before.startsAt)} ${formatTime(before.startsAt)})`,
      });
    }
    await audit(ctx, "appointment.update", id);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/appointments");
  revalidatePath(`/appointments/${id}`);
  return { ok: true };
}

export async function setAppointmentStatus(id: string, status: string): Promise<FormState> {
  try {
    const ctx = await requirePermission({ appointment: ["update"] });
    const s = z.enum(appointmentStatuses).safeParse(status);
    if (!s.success) return { error: "סטטוס לא תקין" };
    const [row] = await db
      .update(appointments)
      .set({ status: s.data })
      .where(and(eq(appointments.id, id), eq(appointments.orgId, ctx.orgId)))
      .returning({ contactId: appointments.contactId });
    if (!row) return { error: "התור לא נמצא" };
    await audit(ctx, "appointment.status", id, { status: s.data });
    revalidatePath(`/contacts/${row.contactId}`);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/appointments");
  revalidatePath(`/appointments/${id}`);
  return { ok: true };
}
