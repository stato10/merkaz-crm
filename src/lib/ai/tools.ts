import "server-only";
import { and, asc, desc, eq, gt, gte, ilike, inArray, lt, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/db";
import type { Tx } from "@/db/tenant";
import {
  dayKey,
  formatMoney,
  fromLocalInput,
  fullName,
  ticketPriorities,
  ticketStatuses,
  toLocalInput,
} from "../labels";
import type { Permissions, RoleName } from "../permissions";

const { contacts, companies, deals, tickets, ticketMessages, activities, appointments, pipelineStages, member, user } =
  schema;

/**
 * The CRM as a set of tools. One definition serves three surfaces: the
 * in-app agent (Claude), the staff copilot and the MCP server. Every tool
 * declares the permission it needs and runs inside an RLS transaction
 * (`ctx.tx`), so a tool can never see another organization's rows.
 */

export type ToolCtx = {
  orgId: string;
  /** The person the agent acts for (signed-in user, or the API key's creator). */
  actorId: string | null;
  role: RoleName;
  tx: Tx;
  /** Queue an audit entry; written after the transaction commits. */
  audit: (action: string, target: string, metadata?: Record<string, unknown>) => void;
};

export class ToolError extends Error {}

type Def<S extends z.ZodObject> = {
  name: string;
  /** Model-facing: what the tool does, when to use it, what it returns. */
  description: string;
  input: S;
  permission: Permissions;
  /** Changes data. Read-only modes (drafting a reply) never get these. */
  mutates: boolean;
  run: (ctx: ToolCtx, input: z.infer<S>) => Promise<unknown>;
};

const define = <S extends z.ZodObject>(d: Def<S>) => d;

const like = (q: string) => `%${q.replace(/[%_\\]/g, "\\$&")}%`;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const local = (d: Date) => toLocalInput(d).replace("T", " ");

async function ticketByNumber(ctx: ToolCtx, number: number) {
  const [t] = await ctx.tx
    .select()
    .from(tickets)
    .where(and(eq(tickets.orgId, ctx.orgId), eq(tickets.number, number)))
    .limit(1);
  if (!t) throw new ToolError(`Ticket #${number} does not exist`);
  return t;
}

async function contactById(ctx: ToolCtx, id: string) {
  const [c] = await ctx.tx
    .select()
    .from(contacts)
    .where(and(eq(contacts.orgId, ctx.orgId), eq(contacts.id, id)))
    .limit(1);
  if (!c) throw new ToolError(`Contact ${id} does not exist`);
  return c;
}

async function assertMember(ctx: ToolCtx, userId: string) {
  const [m] = await ctx.tx
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, userId)))
    .limit(1);
  if (!m) throw new ToolError(`User ${userId} is not a member of this organization`);
}

/* ------------------------------------------------------------------ */
/* Read tools                                                          */
/* ------------------------------------------------------------------ */

const searchContacts = define({
  name: "search_contacts",
  description:
    "Find contacts by name, email, phone or company name. Returns up to `limit` matches with their id, which other tools need. Use this first whenever the user names a person or business.",
  input: z.object({
    query: z.string().trim().min(1).max(100).describe("Free text: part of a name, email, phone or company"),
    limit: z.number().int().min(1).max(20).default(8),
  }),
  permission: { contact: ["read"] },
  mutates: false,
  async run(ctx, { query, limit }) {
    const q = like(query);
    const digits = query.replace(/\D/g, "");
    const rows = await ctx.tx
      .select({ c: contacts, company: companies.name })
      .from(contacts)
      .leftJoin(companies, eq(companies.id, contacts.companyId))
      .where(
        and(
          eq(contacts.orgId, ctx.orgId),
          or(
            ilike(sql`${contacts.firstName} || ' ' || ${contacts.lastName}`, q),
            ilike(contacts.email, q),
            ilike(companies.name, q),
            digits.length >= 4 ? ilike(sql`regexp_replace(coalesce(${contacts.phone}, ''), '\\D', '', 'g')`, `%${digits.replace(/^972/, "").replace(/^0/, "")}%`) : undefined,
          ),
        ),
      )
      .orderBy(desc(contacts.updatedAt))
      .limit(limit);
    return rows.map(({ c, company }) => ({
      id: c.id,
      name: fullName(c),
      email: c.email,
      phone: c.phone,
      title: c.title,
      status: c.status,
      company,
    }));
  },
});

const getContact = define({
  name: "get_contact",
  description:
    "Full profile of one contact: details, company, recent activity, deals, tickets and upcoming appointments. Use it before answering questions about a customer or writing to them.",
  input: z.object({ contact_id: z.uuid() }),
  permission: { contact: ["read"] },
  mutates: false,
  async run(ctx, { contact_id }) {
    const c = await contactById(ctx, contact_id);
    const [company] = c.companyId
      ? await ctx.tx.select().from(companies).where(eq(companies.id, c.companyId)).limit(1)
      : [];
    const [recent, dealRows, ticketRows, upcoming] = await Promise.all([
      ctx.tx
        .select({ type: activities.type, body: activities.body, at: activities.createdAt })
        .from(activities)
        .where(and(eq(activities.orgId, ctx.orgId), eq(activities.contactId, c.id)))
        .orderBy(desc(activities.createdAt))
        .limit(10),
      ctx.tx
        .select({ id: deals.id, title: deals.title, amount: deals.amount, currency: deals.currency, status: deals.status, stage: pipelineStages.name })
        .from(deals)
        .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
        .where(and(eq(deals.orgId, ctx.orgId), eq(deals.contactId, c.id)))
        .orderBy(desc(deals.updatedAt))
        .limit(10),
      ctx.tx
        .select({ number: tickets.number, subject: tickets.subject, status: tickets.status, priority: tickets.priority })
        .from(tickets)
        .where(and(eq(tickets.orgId, ctx.orgId), eq(tickets.contactId, c.id)))
        .orderBy(desc(tickets.lastMessageAt))
        .limit(5),
      ctx.tx
        .select({ title: appointments.title, startsAt: appointments.startsAt, status: appointments.status })
        .from(appointments)
        .where(and(eq(appointments.orgId, ctx.orgId), eq(appointments.contactId, c.id), gte(appointments.startsAt, new Date())))
        .orderBy(asc(appointments.startsAt))
        .limit(5),
    ]);
    return {
      id: c.id,
      name: fullName(c),
      email: c.email,
      phone: c.phone,
      title: c.title,
      status: c.status,
      source: c.source,
      tags: c.tags,
      company: company ? { id: company.id, name: company.name, industry: company.industry, domain: company.domain } : null,
      recent_activity: recent.map((a) => ({ type: a.type, body: a.body, at: local(a.at) })),
      deals: dealRows.map((d) => ({ ...d, amount_display: formatMoney(d.amount, d.currency) })),
      tickets: ticketRows,
      upcoming_appointments: upcoming.map((a) => ({ title: a.title, starts_at: local(a.startsAt), status: a.status })),
    };
  },
});

const listTickets = define({
  name: "list_tickets",
  description:
    "List service tickets, most recently active first. Filter by status, priority or text in the subject. Returns ticket numbers, which get_ticket takes.",
  input: z.object({
    status: z.enum(ticketStatuses).optional(),
    priority: z.enum(ticketPriorities).optional(),
    query: z.string().trim().max(100).optional(),
    limit: z.number().int().min(1).max(25).default(10),
  }),
  permission: { ticket: ["read"] },
  mutates: false,
  async run(ctx, { status, priority, query, limit }) {
    const rows = await ctx.tx
      .select({ t: tickets, first: contacts.firstName, last: contacts.lastName, assignee: user.name })
      .from(tickets)
      .leftJoin(contacts, eq(contacts.id, tickets.contactId))
      .leftJoin(user, eq(user.id, tickets.assigneeId))
      .where(
        and(
          eq(tickets.orgId, ctx.orgId),
          status ? eq(tickets.status, status) : undefined,
          priority ? eq(tickets.priority, priority) : undefined,
          query ? ilike(tickets.subject, like(query)) : undefined,
        ),
      )
      .orderBy(desc(tickets.lastMessageAt))
      .limit(limit);
    return rows.map(({ t, first, last, assignee }) => ({
      number: t.number,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      channel: t.channel,
      contact: first ? fullName({ firstName: first, lastName: last ?? "" }) : null,
      assignee,
      last_message_at: local(t.lastMessageAt),
    }));
  },
});

const getTicket = define({
  name: "get_ticket",
  description:
    "One ticket with its full conversation (customer messages, replies and internal notes) and the customer's id. Call this before drafting any reply.",
  input: z.object({ ticket_number: z.number().int().positive() }),
  permission: { ticket: ["read"] },
  mutates: false,
  async run(ctx, { ticket_number }) {
    const t = await ticketByNumber(ctx, ticket_number);
    const [contact] = t.contactId
      ? await ctx.tx.select().from(contacts).where(eq(contacts.id, t.contactId)).limit(1)
      : [];
    const messages = await ctx.tx
      .select({ kind: ticketMessages.kind, body: ticketMessages.body, at: ticketMessages.createdAt, author: user.name })
      .from(ticketMessages)
      .leftJoin(user, eq(user.id, ticketMessages.authorId))
      .where(and(eq(ticketMessages.orgId, ctx.orgId), eq(ticketMessages.ticketId, t.id)))
      .orderBy(asc(ticketMessages.createdAt))
      .limit(50);
    return {
      number: t.number,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      channel: t.channel,
      opened_at: local(t.createdAt),
      contact: contact ? { id: contact.id, name: fullName(contact), email: contact.email, phone: contact.phone } : null,
      messages: messages.map((m) => ({
        from: m.kind === "inbound" ? "customer" : m.kind === "outbound" ? "team" : "internal_note",
        author: m.kind === "inbound" ? undefined : m.author,
        body: m.body,
        at: local(m.at),
      })),
    };
  },
});

const pipelineSummary = define({
  name: "pipeline_summary",
  description:
    "The sales pipeline at a glance: open deals per stage with totals, the weighted forecast (amount x stage probability), and deals won or lost in the last 30 days.",
  input: z.object({}),
  permission: { deal: ["read"] },
  mutates: false,
  async run(ctx) {
    const stageRows = await ctx.tx
      .select({
        name: pipelineStages.name,
        probability: pipelineStages.probability,
        count: sql<number>`count(${deals.id})::int`,
        total: sql<number>`coalesce(sum(${deals.amount}), 0)::int`,
      })
      .from(pipelineStages)
      .leftJoin(deals, and(eq(deals.stageId, pipelineStages.id), eq(deals.status, "open")))
      .where(eq(pipelineStages.orgId, ctx.orgId))
      .groupBy(pipelineStages.id)
      .orderBy(asc(pipelineStages.position));
    const since = new Date(Date.now() - 30 * 86_400_000);
    const closed = await ctx.tx
      .select({ status: deals.status, count: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${deals.amount}), 0)::int` })
      .from(deals)
      .where(and(eq(deals.orgId, ctx.orgId), inArray(deals.status, ["won", "lost"]), gte(deals.closedAt, since)))
      .groupBy(deals.status);
    const open = stageRows.reduce((s, r) => s + r.total, 0);
    const weighted = Math.round(stageRows.reduce((s, r) => s + (r.total * r.probability) / 100, 0));
    const won = closed.find((c) => c.status === "won");
    const lost = closed.find((c) => c.status === "lost");
    return {
      currency: "ILS",
      stages: stageRows.map((r) => ({ ...r, total_display: formatMoney(r.total) })),
      open_total: open,
      open_total_display: formatMoney(open),
      weighted_forecast: weighted,
      weighted_forecast_display: formatMoney(weighted),
      last_30_days: {
        won_count: won?.count ?? 0,
        won_total_display: formatMoney(won?.total ?? 0),
        lost_count: lost?.count ?? 0,
      },
    };
  },
});

const listDeals = define({
  name: "list_deals",
  description: "List deals, newest activity first. Filter by status, by contact, or by text in the title.",
  input: z.object({
    status: z.enum(["open", "won", "lost"]).optional(),
    contact_id: z.uuid().optional(),
    query: z.string().trim().max(100).optional(),
    limit: z.number().int().min(1).max(25).default(10),
  }),
  permission: { deal: ["read"] },
  mutates: false,
  async run(ctx, { status, contact_id, query, limit }) {
    const rows = await ctx.tx
      .select({ d: deals, stage: pipelineStages.name, probability: pipelineStages.probability, company: companies.name, owner: user.name })
      .from(deals)
      .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
      .leftJoin(companies, eq(companies.id, deals.companyId))
      .leftJoin(user, eq(user.id, deals.ownerId))
      .where(
        and(
          eq(deals.orgId, ctx.orgId),
          status ? eq(deals.status, status) : undefined,
          contact_id ? eq(deals.contactId, contact_id) : undefined,
          query ? ilike(deals.title, like(query)) : undefined,
        ),
      )
      .orderBy(desc(deals.updatedAt))
      .limit(limit);
    return rows.map(({ d, stage, probability, company, owner }) => ({
      id: d.id,
      title: d.title,
      amount_display: formatMoney(d.amount, d.currency),
      amount: d.amount,
      status: d.status,
      stage,
      probability,
      company,
      owner,
      expected_close: d.expectedClose,
      lost_reason: d.lostReason,
    }));
  },
});

const checkAvailability = define({
  name: "check_availability",
  description:
    "Booked appointments on one day (Israel time), per team member, so you can propose a free slot. Business hours are Sunday-Thursday 09:00-18:00.",
  input: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Day in Israel time, YYYY-MM-DD"),
    assignee_id: z.string().optional().describe("Only this team member's calendar"),
  }),
  permission: { appointment: ["read"] },
  mutates: false,
  async run(ctx, { date, assignee_id }) {
    const start = fromLocalInput(`${date}T00:00`);
    if (!start) throw new ToolError("date must be YYYY-MM-DD");
    const end = new Date(start.getTime() + 86_400_000);
    const rows = await ctx.tx
      .select({ a: appointments, assignee: user.name })
      .from(appointments)
      .leftJoin(user, eq(user.id, appointments.assigneeId))
      .where(
        and(
          eq(appointments.orgId, ctx.orgId),
          notInArray(appointments.status, ["cancelled", "no_show"]),
          lt(appointments.startsAt, end),
          gt(appointments.endsAt, start),
          assignee_id ? eq(appointments.assigneeId, assignee_id) : undefined,
        ),
      )
      .orderBy(asc(appointments.startsAt));
    const team = await ctx.tx
      .select({ id: user.id, name: user.name, role: member.role })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, ctx.orgId));
    return {
      date,
      weekday: new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", weekday: "long" }).format(new Date(start.getTime() + 12 * 3_600_000)),
      booked: rows.map(({ a, assignee }) => ({
        from: local(a.startsAt).slice(11),
        to: local(a.endsAt).slice(11),
        assignee,
        assignee_id: a.assigneeId,
      })),
      team,
    };
  },
});

/* ------------------------------------------------------------------ */
/* Write tools                                                         */
/* ------------------------------------------------------------------ */

const addContactNote = define({
  name: "add_contact_note",
  description: "Add a note to a contact's activity timeline (e.g. a summary of a call or what the customer asked for).",
  input: z.object({
    contact_id: z.uuid(),
    body: z.string().trim().min(1).max(4000),
  }),
  permission: { contact: ["update"] },
  mutates: true,
  async run(ctx, { contact_id, body }) {
    const c = await contactById(ctx, contact_id);
    const [row] = await ctx.tx
      .insert(activities)
      .values({ orgId: ctx.orgId, actorId: ctx.actorId, contactId: c.id, companyId: c.companyId, type: "note", body })
      .returning({ id: activities.id });
    ctx.audit("contact.note", c.id, { activityId: row.id });
    return { ok: true, activity_id: row.id };
  },
});

const createTicket = define({
  name: "create_ticket",
  description: "Open a new service ticket, optionally linked to a contact. Returns the new ticket number.",
  input: z.object({
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(10000).describe("The customer's request, in their words"),
    contact_id: z.uuid().optional(),
    priority: z.enum(ticketPriorities).default("normal"),
  }),
  permission: { ticket: ["create"] },
  mutates: true,
  async run(ctx, { subject, body, contact_id, priority }) {
    if (contact_id) await contactById(ctx, contact_id);
    const [row] = await ctx.tx
      .insert(tickets)
      .values({
        orgId: ctx.orgId,
        subject,
        priority,
        channel: "ai",
        contactId: contact_id ?? null,
        createdById: ctx.actorId,
        number: sql`(select coalesce(max(${tickets.number}), 1000) + 1 from ${tickets} where ${tickets.orgId} = ${ctx.orgId})`,
      })
      .returning({ id: tickets.id, number: tickets.number });
    await ctx.tx.insert(ticketMessages).values({ orgId: ctx.orgId, ticketId: row.id, kind: "inbound", body });
    if (contact_id) {
      await ctx.tx.insert(activities).values({
        orgId: ctx.orgId,
        actorId: ctx.actorId,
        contactId: contact_id,
        type: "ticket",
        body: `נפתחה פנייה #${row.number}: ${subject}`,
      });
    }
    ctx.audit("ticket.create", row.id);
    return { ok: true, ticket_number: row.number };
  },
});

const updateTicket = define({
  name: "update_ticket",
  description: "Change a ticket's status or priority.",
  input: z.object({
    ticket_number: z.number().int().positive(),
    status: z.enum(ticketStatuses).optional(),
    priority: z.enum(ticketPriorities).optional(),
  }),
  permission: { ticket: ["update"] },
  mutates: true,
  async run(ctx, { ticket_number, status, priority }) {
    const t = await ticketByNumber(ctx, ticket_number);
    if (!status && !priority) throw new ToolError("Nothing to change: pass status and/or priority");
    await ctx.tx
      .update(tickets)
      .set({
        ...(status ? { status, resolvedAt: status === "resolved" ? (t.resolvedAt ?? new Date()) : null } : {}),
        ...(priority ? { priority } : {}),
      })
      .where(eq(tickets.id, t.id));
    ctx.audit("ticket.update", t.id, { status, priority });
    return { ok: true, ticket_number, status: status ?? t.status, priority: priority ?? t.priority };
  },
});

const PRIORITY_RANK = { low: 0, normal: 1, high: 2, urgent: 3 } as const;

const handoffToHuman = define({
  name: "handoff_to_human",
  description:
    "Hand a ticket to a human agent instead of answering it yourself. Use it when the customer asks for a refund, credit or price change, is angry or threatening to leave, reports a security or data problem, or when you cannot answer from the CRM data. Leaves an internal note with your reason and reopens the ticket.",
  input: z.object({
    ticket_number: z.number().int().positive(),
    reason: z.string().trim().min(1).max(1000).describe("For the human: what the customer needs and why you handed off"),
    priority: z.enum(ticketPriorities).optional().describe("Raise the priority if the case is time-sensitive"),
  }),
  permission: { ticket: ["update"] },
  mutates: true,
  async run(ctx, { ticket_number, reason, priority }) {
    const t = await ticketByNumber(ctx, ticket_number);
    // Handoff can raise priority but never lowers what a human already set.
    const next = priority && PRIORITY_RANK[priority] > PRIORITY_RANK[t.priority] ? priority : t.priority;
    await ctx.tx.insert(ticketMessages).values({
      orgId: ctx.orgId,
      ticketId: t.id,
      kind: "note",
      authorId: ctx.actorId,
      body: `🤖 הועבר לטיפול נציג: ${reason}`,
    });
    await ctx.tx.update(tickets).set({ status: "open", priority: next, resolvedAt: null }).where(eq(tickets.id, t.id));
    ctx.audit("ticket.handoff", t.id, { reason, priority: next });
    return { ok: true, ticket_number, priority: next, status: "open" };
  },
});

const bookAppointment = define({
  name: "book_appointment",
  description:
    "Book an appointment for a contact. Check availability first. Fails if the team member already has an overlapping appointment.",
  input: z.object({
    contact_id: z.uuid(),
    title: z.string().trim().min(1).max(200),
    starts_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).describe("Israel local time, YYYY-MM-DDTHH:mm"),
    duration_minutes: z.number().int().min(10).max(240).default(30),
    assignee_id: z.string().optional().describe("Team member; defaults to the person you act for"),
    location: z.string().trim().max(200).optional(),
  }),
  permission: { appointment: ["create"] },
  mutates: true,
  async run(ctx, { contact_id, title, starts_at, duration_minutes, assignee_id, location }) {
    const c = await contactById(ctx, contact_id);
    const startsAt = fromLocalInput(starts_at);
    if (!startsAt) throw new ToolError("starts_at must be YYYY-MM-DDTHH:mm");
    if (startsAt.getTime() < Date.now()) throw new ToolError("starts_at is in the past");
    const endsAt = new Date(startsAt.getTime() + duration_minutes * 60_000);
    const assignee = assignee_id ?? ctx.actorId;
    if (assignee) {
      await assertMember(ctx, assignee);
      const [clash] = await ctx.tx
        .select({ title: appointments.title, startsAt: appointments.startsAt })
        .from(appointments)
        .where(
          and(
            eq(appointments.orgId, ctx.orgId),
            eq(appointments.assigneeId, assignee),
            notInArray(appointments.status, ["cancelled", "no_show"]),
            lt(appointments.startsAt, endsAt),
            gt(appointments.endsAt, startsAt),
          ),
        )
        .limit(1);
      if (clash) throw new ToolError(`That slot overlaps "${clash.title}" at ${local(clash.startsAt)}`);
    }
    const [row] = await ctx.tx
      .insert(appointments)
      .values({ orgId: ctx.orgId, contactId: c.id, title, startsAt, endsAt, assigneeId: assignee, location: location ?? null })
      .returning({ id: appointments.id });
    ctx.audit("appointment.create", row.id);
    return { ok: true, appointment_id: row.id, contact: fullName(c), starts_at: local(startsAt), day: dayKey(startsAt), ends_at: iso(endsAt) };
  },
});

/* ------------------------------------------------------------------ */

export const crmTools = [
  searchContacts,
  getContact,
  listTickets,
  getTicket,
  listDeals,
  pipelineSummary,
  checkAvailability,
  addContactNote,
  createTicket,
  updateTicket,
  handoffToHuman,
  bookAppointment,
] as const;

export type CrmTool = (typeof crmTools)[number];
export type ToolName = CrmTool["name"];

const byName = new Map<string, CrmTool>(crmTools.map((t) => [t.name, t]));
export const getTool = (name: string) => byName.get(name);

/** JSON Schema for a tool's input, with closed objects (required for strict tool use). */
export function inputSchema(t: CrmTool): Record<string, unknown> {
  const s = z.toJSONSchema(t.input, { io: "input", target: "draft-2020-12" }) as Record<string, unknown>;
  delete s.$schema;
  return { ...s, additionalProperties: false };
}
