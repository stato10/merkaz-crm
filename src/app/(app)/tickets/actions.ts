"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { runAgent } from "@/lib/ai/agent";
import { aiGate } from "@/lib/ai/guard";
import { deliverMessage, replyRoute } from "@/lib/channels/service";
import { ticketPriorities, ticketStatuses } from "@/lib/labels";
import { log } from "@/lib/log";
import { audit, type Ctx, ForbiddenError, requirePermission } from "@/lib/session";
import type { FormState } from "../contacts/actions";

const { tickets, ticketMessages } = schema;

const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

function fail(e: unknown): FormState {
  if (e instanceof ForbiddenError) return { error: e.message };
  throw e;
}

async function checkRefs(ctx: Ctx, contactId: string | null, assigneeId: string | null) {
  if (contactId) {
    const c = await db.query.contacts.findFirst({
      where: and(eq(schema.contacts.id, contactId), eq(schema.contacts.orgId, ctx.orgId)),
      columns: { id: true },
    });
    if (!c) return "איש הקשר לא נמצא";
  }
  if (assigneeId) {
    const m = await db.query.member.findFirst({
      where: and(eq(schema.member.userId, assigneeId), eq(schema.member.organizationId, ctx.orgId)),
      columns: { id: true },
    });
    if (!m) return "הנציג לא נמצא בארגון";
  }
  return null;
}

const ticketInput = z.object({
  subject: z.string().trim().min(1, "חסר נושא לפנייה").max(200),
  body: z.string().trim().min(1, "תארו את הבקשה של הלקוח").max(10000),
  contactId: z.preprocess(emptyToNull, z.uuid("איש הקשר לא תקין").nullable()),
  assigneeId: z.preprocess(emptyToNull, z.string().nullable()),
  priority: z.enum(ticketPriorities).default("normal"),
  channel: z.enum(["manual", "phone", "email", "whatsapp", "web"]).default("phone"),
});

export async function createTicket(_: FormState, form: FormData): Promise<FormState> {
  let id: string;
  try {
    const ctx = await requirePermission({ ticket: ["create"] });
    const parsed = ticketInput.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { body, ...v } = parsed.data;
    const refErr = await checkRefs(ctx, v.contactId, v.assigneeId);
    if (refErr) return { error: refErr };

    id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(tickets)
        .values({
          ...v,
          orgId: ctx.orgId,
          createdById: ctx.userId,
          number: sql`(select coalesce(max(${tickets.number}), 1000) + 1 from ${tickets} where ${tickets.orgId} = ${ctx.orgId})`,
        })
        .returning({ id: tickets.id, number: tickets.number });
      await tx.insert(ticketMessages).values({
        orgId: ctx.orgId,
        ticketId: row.id,
        kind: "inbound",
        authorId: ctx.userId,
        body,
      });
      if (v.contactId) {
        await tx.insert(schema.activities).values({
          orgId: ctx.orgId,
          actorId: ctx.userId,
          contactId: v.contactId,
          type: "ticket",
          body: `נפתחה פנייה #${row.number}: ${v.subject}`,
        });
      }
      return row.id;
    });
    await audit(ctx, "ticket.create", id);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/tickets");
  redirect(`/tickets/${id}`);
}

const messageInput = z.object({
  kind: z.enum(["outbound", "note", "inbound"]),
  body: z.string().trim().min(1, "אי אפשר לשלוח הודעה ריקה").max(10000),
});

export async function addMessage(ticketId: string, _: FormState, form: FormData): Promise<FormState> {
  let delivery: Awaited<ReturnType<typeof deliverMessage>> = null;
  try {
    const ctx = await requirePermission({ ticket: ["update"] });
    const parsed = messageInput.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const t = await db.query.tickets.findFirst({
      where: and(eq(tickets.id, ticketId), eq(tickets.orgId, ctx.orgId)),
      columns: { id: true, status: true, assigneeId: true, channelAccountId: true, replyTo: true },
    });
    if (!t) return { error: "הפנייה לא נמצאה" };
    const { kind, body } = parsed.data;
    // Replies on a ticket that came in on a connected channel go out on that channel.
    const route = kind === "outbound" ? await replyRoute(ctx.orgId, t) : null;

    const messageId = await db.transaction(async (tx) => {
      const [m] = await tx
        .insert(ticketMessages)
        .values({
          orgId: ctx.orgId,
          ticketId,
          kind,
          authorId: ctx.userId,
          body,
          ...(route ? { channel: route.account.kind, delivery: "queued" } : {}),
        })
        .returning({ id: ticketMessages.id });
      // A reply waits on the customer; a new customer message reopens the ticket.
      // Whoever answers an unassigned ticket takes it.
      const status = kind === "outbound" ? "pending" : kind === "inbound" ? "open" : t.status;
      await tx
        .update(tickets)
        .set({
          status,
          resolvedAt: status === "resolved" ? undefined : null,
          lastMessageAt: kind === "note" ? undefined : new Date(),
          assigneeId: t.assigneeId ?? (kind === "outbound" ? ctx.userId : null),
        })
        .where(eq(tickets.id, ticketId));
      return m.id;
    });
    if (route) {
      delivery = await deliverMessage(ctx.orgId, messageId);
      await audit(ctx, "ticket.reply", ticketId, { channel: route.account.kind, ok: delivery?.ok ?? false });
    }
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
  // The reply is saved either way; a failed send shows on the message with a retry button.
  if (delivery && !delivery.ok) return { ok: true, error: `התגובה נשמרה אבל לא נשלחה: ${delivery.error}` };
  return { ok: true };
}

/** Retry sending a failed outbound message. */
export async function resendMessage(ticketId: string, messageId: string): Promise<FormState> {
  try {
    const ctx = await requirePermission({ ticket: ["update"] });
    const m = await db.query.ticketMessages.findFirst({
      where: and(eq(ticketMessages.id, messageId), eq(ticketMessages.orgId, ctx.orgId), eq(ticketMessages.ticketId, ticketId)),
      columns: { delivery: true },
    });
    if (m?.delivery !== "failed") return { error: "ההודעה לא ממתינה לשליחה חוזרת" };
    const r = await deliverMessage(ctx.orgId, messageId);
    revalidatePath(`/tickets/${ticketId}`);
    if (r && !r.ok) return { error: r.error };
  } catch (e) {
    return fail(e);
  }
  return { ok: true };
}

export type DraftResult = { draft?: string; handedOff?: string; error?: string };

/** Ask the agent for a reply draft. It reads the ticket and the customer, and may hand off instead. */
export async function draftReply(ticketId: string): Promise<DraftResult> {
  try {
    const ctx = await requirePermission({ ticket: ["update"] });
    const t = await db.query.tickets.findFirst({
      where: and(eq(tickets.id, ticketId), eq(tickets.orgId, ctx.orgId)),
      columns: { number: true },
    });
    if (!t) return { error: "הפנייה לא נמצאה" };
    const gate = await aiGate(ctx.orgId, ctx.userId);
    if (!gate.ok) return { error: gate.error };

    const r = await runAgent({
      principal: { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, via: "agent" },
      mode: "draft_reply",
      messages: [{ role: "user", content: `Draft a reply to ticket #${t.number}.` }],
    });
    if (r.toolCalls.some((c) => c.name === "handoff_to_human" && c.ok)) {
      revalidatePath(`/tickets/${ticketId}`);
      revalidatePath("/tickets");
      return { handedOff: r.text.replace(/^הועבר לנציג:\s*/, "") };
    }
    if (!r.text.trim()) return { error: "הסוכן לא הצליח לנסח תשובה. נסו שוב." };
    return { draft: r.text.trim() };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    log.error("ai.draft_failed", { ticketId, err: e });
    return { error: "שירות ה-AI לא זמין כרגע. נסו שוב בעוד רגע." };
  }
}

const propsInput = z.object({
  status: z.enum(ticketStatuses),
  priority: z.enum(ticketPriorities),
  assigneeId: z.preprocess(emptyToNull, z.string().nullable()),
});

export async function updateTicket(ticketId: string, _: FormState, form: FormData): Promise<FormState> {
  try {
    const ctx = await requirePermission({ ticket: ["update"] });
    const parsed = propsInput.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const v = parsed.data;
    const refErr = await checkRefs(ctx, null, v.assigneeId);
    if (refErr) return { error: refErr };
    const before = await db.query.tickets.findFirst({
      where: and(eq(tickets.id, ticketId), eq(tickets.orgId, ctx.orgId)),
    });
    if (!before) return { error: "הפנייה לא נמצאה" };

    await db
      .update(tickets)
      .set({
        ...v,
        resolvedAt:
          v.status === "resolved" ? (before.resolvedAt ?? new Date()) : null,
      })
      .where(eq(tickets.id, ticketId));
    if (before.status !== v.status && v.status === "resolved" && before.contactId) {
      await db.insert(schema.activities).values({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        contactId: before.contactId,
        type: "ticket",
        body: `פנייה #${before.number} טופלה`,
      });
    }
    await audit(ctx, "ticket.update", ticketId, v);
  } catch (e) {
    return fail(e);
  }
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/tickets");
  return { ok: true };
}
