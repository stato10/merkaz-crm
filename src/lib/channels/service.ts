import "server-only";
import { and, desc, eq, gt, inArray, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { type Tx, withTenant } from "@/db/tenant";
import { writeAudit } from "../audit";
import { log } from "../log";
import { openSecrets } from "./crypto";
import { type InboundMessage, nextDelivery, phoneDigits, type StatusUpdate, ticketNumberFromSubject, WA_WINDOW_MS } from "./parse";
import { send } from "./providers";

const { tickets, ticketMessages, contacts, channelAccounts } = schema;
type Account = typeof channelAccounts.$inferSelect;

/** A WhatsApp conversation continues on the same ticket unless it was resolved more than this long ago. */
const REOPEN_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
export const kindLabel = { email: "אימייל", whatsapp: "WhatsApp" } as const;

export async function accountByToken(token: string, kind: Account["kind"]) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  const [a] = await db
    .select()
    .from(channelAccounts)
    .where(and(eq(channelAccounts.inboundToken, token), eq(channelAccounts.kind, kind), eq(channelAccounts.active, true)))
    .limit(1);
  return a ?? null;
}

async function findOrCreateContact(tx: Tx, a: Account, m: InboundMessage) {
  if (a.kind === "email") {
    const [c] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(sql`lower(${contacts.email}) = ${m.from}`)
      .orderBy(contacts.createdAt)
      .limit(1);
    if (c) return { id: c.id, created: false };
  } else {
    const candidates = [m.from, m.from.startsWith("972") ? "0" + m.from.slice(3) : null].filter(Boolean) as string[];
    const [c] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(inArray(sql`regexp_replace(coalesce(${contacts.phone}, ''), '\\D', '', 'g')`, candidates))
      .orderBy(contacts.createdAt)
      .limit(1);
    if (c) return { id: c.id, created: false };
  }
  const fallback = a.kind === "email" ? m.from.split("@")[0] : `+${m.from}`;
  const [first, ...rest] = (m.name ?? fallback).trim().split(/\s+/);
  const [c] = await tx
    .insert(contacts)
    .values({
      orgId: a.orgId,
      firstName: first.slice(0, 80),
      lastName: rest.join(" ").slice(0, 80),
      email: a.kind === "email" ? m.from : null,
      phone: a.kind === "whatsapp" ? `+${m.from}` : null,
      source: a.kind,
    })
    .returning({ id: contacts.id });
  await tx.insert(schema.activities).values({
    orgId: a.orgId,
    contactId: c.id,
    type: "created",
    body: `נוצר אוטומטית מהודעה נכנסת ב${kindLabel[a.kind]}`,
  });
  return { id: c.id, created: true };
}

async function findTicket(tx: Tx, a: Account, m: InboundMessage, contactId: string) {
  if (a.kind === "email") {
    const number = ticketNumberFromSubject(m.subject);
    if (number) {
      const [t] = await tx.select().from(tickets).where(eq(tickets.number, number)).limit(1);
      if (t) return t;
    }
    if (m.inReplyTo) {
      const [hit] = await tx
        .select({ t: tickets })
        .from(ticketMessages)
        .innerJoin(tickets, eq(tickets.id, ticketMessages.ticketId))
        .where(eq(ticketMessages.externalId, `email:${m.inReplyTo}`))
        .limit(1);
      if (hit) return hit.t;
    }
    return null;
  }
  const [t] = await tx
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.channelAccountId, a.id),
        eq(tickets.contactId, contactId),
        or(ne(tickets.status, "resolved"), gt(tickets.resolvedAt, new Date(Date.now() - REOPEN_WINDOW_MS))),
      ),
    )
    .orderBy(desc(tickets.lastMessageAt))
    .limit(1);
  return t ?? null;
}

/**
 * Turns a customer message from a connected channel into ticket state:
 * matches or creates the contact, threads onto an existing ticket (subject tag,
 * In-Reply-To, or the open WhatsApp conversation) or opens a new one.
 * Idempotent on the provider message id, since providers retry webhooks.
 */
export async function ingestInbound(a: Account, m: InboundMessage) {
  const r = await withTenant(a.orgId, async (tx) => {
    const [dup] = await tx
      .select({ ticketId: ticketMessages.ticketId })
      .from(ticketMessages)
      .where(eq(ticketMessages.externalId, m.externalId))
      .limit(1);
    if (dup) return { ticketId: dup.ticketId, created: false, duplicate: true };

    const contact = await findOrCreateContact(tx, a, m);
    let ticket = await findTicket(tx, a, m, contact.id);
    const created = !ticket;
    if (!ticket) {
      const subject = (m.subject?.replace(/^((re|fwd?|הש|תגובה)\s*:\s*)+/i, "").trim() || m.body.split("\n")[0]).slice(0, 120);
      [ticket] = await tx
        .insert(tickets)
        .values({
          orgId: a.orgId,
          number: sql`(select coalesce(max(${tickets.number}), 1000) + 1 from ${tickets} where ${tickets.orgId} = ${a.orgId})`,
          subject: subject || `הודעה ב${kindLabel[a.kind]}`,
          channel: a.kind,
          contactId: contact.id,
          channelAccountId: a.id,
          replyTo: m.from,
        })
        .returning();
      await tx.insert(schema.activities).values({
        orgId: a.orgId,
        contactId: contact.id,
        type: "ticket",
        body: `נפתחה פנייה #${ticket.number} מ${kindLabel[a.kind]}: ${ticket.subject}`,
      });
    }
    await tx.insert(ticketMessages).values({
      orgId: a.orgId,
      ticketId: ticket.id,
      kind: "inbound",
      body: m.body.slice(0, 10000),
      channel: a.kind,
      externalId: m.externalId,
      createdAt: m.at,
    });
    await tx
      .update(tickets)
      .set({
        status: "open",
        resolvedAt: null,
        lastMessageAt: m.at,
        channelAccountId: a.id,
        replyTo: m.from,
        contactId: ticket.contactId ?? contact.id,
      })
      .where(eq(tickets.id, ticket.id));
    return { ticketId: ticket.id, created, duplicate: false };
  });
  if (!r.duplicate) {
    await writeAudit({
      orgId: a.orgId,
      actorId: null,
      action: r.created ? "ticket.create" : "ticket.message",
      target: r.ticketId,
      metadata: { via: a.kind, channel_account: a.id },
    });
  }
  return r;
}

/** Applies provider delivery receipts (sent / delivered / read / failed) to outbound messages. */
export async function applyStatuses(orgId: string, updates: StatusUpdate[]) {
  if (!updates.length) return 0;
  return withTenant(orgId, async (tx) => {
    let changed = 0;
    for (const u of updates) {
      const [m] = await tx
        .select({ id: ticketMessages.id, delivery: ticketMessages.delivery })
        .from(ticketMessages)
        .where(and(eq(ticketMessages.externalId, u.externalId), eq(ticketMessages.kind, "outbound")))
        .limit(1);
      const next = m && nextDelivery(m.delivery, u.status);
      if (!next) continue;
      await tx
        .update(ticketMessages)
        .set({ delivery: next, deliveryError: next === "failed" ? u.error : null })
        .where(eq(ticketMessages.id, m.id));
      changed++;
    }
    return changed;
  });
}

/** Where a reply on this ticket would go, if the ticket runs on an active connected channel. */
export async function replyRoute(orgId: string, ticket: { channelAccountId: string | null; replyTo: string | null; id: string }) {
  if (!ticket.channelAccountId || !ticket.replyTo) return null;
  const [a] = await db
    .select()
    .from(channelAccounts)
    .where(and(eq(channelAccounts.id, ticket.channelAccountId), eq(channelAccounts.orgId, orgId)))
    .limit(1);
  if (!a?.active) return null;
  let windowClosed = false;
  if (a.kind === "whatsapp") {
    const [last] = await db
      .select({ at: ticketMessages.createdAt })
      .from(ticketMessages)
      .where(and(eq(ticketMessages.ticketId, ticket.id), eq(ticketMessages.kind, "inbound"), eq(ticketMessages.channel, "whatsapp")))
      .orderBy(desc(ticketMessages.createdAt))
      .limit(1);
    windowClosed = !last || Date.now() - last.at.getTime() > WA_WINDOW_MS;
  }
  return { account: a, to: ticket.replyTo, windowClosed };
}

/** Sends one queued (or failed) outbound message on its ticket's channel and records the outcome. Never throws. */
export async function deliverMessage(orgId: string, messageId: string) {
  const [row] = await db
    .select({ m: ticketMessages, t: tickets, a: channelAccounts })
    .from(ticketMessages)
    .innerJoin(tickets, eq(tickets.id, ticketMessages.ticketId))
    .innerJoin(channelAccounts, eq(channelAccounts.id, tickets.channelAccountId))
    .where(and(eq(ticketMessages.id, messageId), eq(ticketMessages.orgId, orgId), eq(ticketMessages.kind, "outbound")))
    .limit(1);
  if (!row?.t.replyTo || !["queued", "failed"].includes(row.m.delivery ?? "")) return null;
  const { m, t, a } = row;
  const replyTo = row.t.replyTo;

  let inReplyTo: string | null = null;
  if (a.kind === "email") {
    const [last] = await db
      .select({ id: ticketMessages.externalId })
      .from(ticketMessages)
      .where(and(eq(ticketMessages.ticketId, t.id), eq(ticketMessages.kind, "inbound"), eq(ticketMessages.channel, "email")))
      .orderBy(desc(ticketMessages.createdAt))
      .limit(1);
    const id = last?.id?.replace(/^email:/, "");
    inReplyTo = id && /^<[^>]+>$/.test(id) ? id : null;
  }

  let result: Awaited<ReturnType<typeof send>>;
  try {
    result = !a.active
      ? { ok: false, error: "הערוץ מושבת בהגדרות." }
      : await send(a, openSecrets(a.secrets), {
          to: a.kind === "whatsapp" ? replyTo.replace(/\D/g, "") : replyTo,
          body: m.body,
          subject: `Re: ${t.subject} [#${t.number}]`,
          inReplyTo,
        });
  } catch (e) {
    log.error("channel.send_failed", { messageId, err: e });
    result = { ok: false, error: "שליחה נכשלה בגלל שגיאה פנימית." };
  }
  await db
    .update(ticketMessages)
    .set(
      result.ok
        ? { delivery: result.delivery, externalId: result.externalId, deliveryError: null }
        : { delivery: "failed", deliveryError: result.error },
    )
    .where(eq(ticketMessages.id, m.id));
  if (!result.ok) log.warn("channel.send_rejected", { messageId, provider: a.provider, error: result.error });
  return result;
}

export { phoneDigits };
