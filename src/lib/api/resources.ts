import "server-only";
import { and, asc, desc, eq, ilike, or, type SQL, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { schema } from "@/db";
import { contactStatuses, dealStatuses, formatMoney, fullName, ticketPriorities, ticketStatuses } from "../labels";
import { listStages } from "../queries";
import { decodeCursor, encodeCursor, toApi } from "./dto";
import { type ApiCtx, ApiError, notFound, pageParams, readJson } from "./handler";

const { contacts, companies, deals, tickets, ticketMessages, activities, pipelineStages, member } = schema;

/* ------------------------------------------------------------------ */
/* Shared                                                              */
/* ------------------------------------------------------------------ */

type Paged = typeof contacts | typeof companies | typeof deals | typeof tickets;

/** Keyset pagination on (created_at, id), newest first. Stable under inserts, O(limit). */
async function listPage(ctx: ApiCtx, req: NextRequest, table: Paged, where: (SQL | undefined)[]) {
  const t = table as typeof contacts; // all paged tables share id/org_id/created_at
  const { limit, cursor } = pageParams(req);
  const conds: (SQL | undefined)[] = [eq(t.orgId, ctx.orgId), ...where];
  if (cursor) {
    const c = decodeCursor(cursor);
    if (!c) throw new ApiError(400, "invalid_cursor", "cursor is not valid");
    conds.push(sql`(${t.createdAt}, ${t.id}) < (${c.createdAt.toISOString()}::timestamptz, ${c.id}::uuid)`);
  }
  const rows = await ctx.tx
    .select()
    .from(t)
    .where(and(...conds))
    .orderBy(desc(t.createdAt), desc(t.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    data: page.map((r) => toApi(r)),
    next_cursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

const uuidParam = (id: string) => {
  if (!z.uuid().safeParse(id).success) throw notFound();
  return id;
};

const like = (q: string) => `%${q.replace(/[%_\\]/g, "\\$&")}%`;

/** Reference checks run inside the RLS transaction, so other tenants' ids simply don't exist. */
async function assertRef(ctx: ApiCtx, kind: "contact" | "company" | "stage" | "member", id: string | null | undefined) {
  if (!id) return;
  const found =
    kind === "member"
      ? await ctx.tx.select({ id: member.id }).from(member).where(and(eq(member.userId, id), eq(member.organizationId, ctx.orgId))).limit(1)
      : kind === "contact"
        ? await ctx.tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, id), eq(contacts.orgId, ctx.orgId))).limit(1)
        : kind === "company"
          ? await ctx.tx.select({ id: companies.id }).from(companies).where(and(eq(companies.id, id), eq(companies.orgId, ctx.orgId))).limit(1)
          : await ctx.tx.select({ id: pipelineStages.id }).from(pipelineStages).where(and(eq(pipelineStages.id, id), eq(pipelineStages.orgId, ctx.orgId))).limit(1);
  if (!found.length) {
    const field = { contact: "contact_id", company: "company_id", stage: "stage_id", member: "owner_id" }[kind];
    throw new ApiError(422, "invalid_reference", `${field} does not exist in this organization`, [{ path: field }]);
  }
}

const nullableStr = (max: number) => z.string().trim().max(max).nullable().optional();
const optionalUuid = z.uuid().nullable().optional();

/* ------------------------------------------------------------------ */
/* Contacts                                                            */
/* ------------------------------------------------------------------ */

const contactBody = z.object({
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().max(80).optional(),
  email: z.email().nullable().optional(),
  phone: nullableStr(30),
  title: nullableStr(80),
  source: nullableStr(80),
  status: z.enum(contactStatuses).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  company_id: optionalUuid,
  owner_id: z.string().nullable().optional(),
});

function contactValues(b: Partial<z.infer<typeof contactBody>>) {
  const v = {
    firstName: b.first_name,
    lastName: b.last_name,
    email: b.email,
    phone: b.phone,
    title: b.title,
    source: b.source,
    status: b.status,
    tags: b.tags ? [...new Set(b.tags)] : undefined,
    companyId: b.company_id,
    ownerId: b.owner_id,
  };
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as Partial<typeof contacts.$inferInsert>;
}

export const contactsApi = {
  async list(req: NextRequest, ctx: ApiCtx) {
    const sp = req.nextUrl.searchParams;
    const q = sp.get("q")?.trim();
    const status = sp.get("status");
    const email = sp.get("email")?.trim();
    if (status && !contactStatuses.includes(status as never)) throw new ApiError(400, "invalid_filter", "unknown status");
    return listPage(ctx, req, contacts, [
      status ? eq(contacts.status, status as (typeof contactStatuses)[number]) : undefined,
      email ? ilike(contacts.email, email) : undefined,
      sp.get("company_id") ? eq(contacts.companyId, uuidParam(sp.get("company_id")!)) : undefined,
      q
        ? or(ilike(sql`${contacts.firstName} || ' ' || ${contacts.lastName}`, like(q)), ilike(contacts.email, like(q)), ilike(contacts.phone, like(q)))
        : undefined,
    ]);
  },

  async create(req: NextRequest, ctx: ApiCtx) {
    const b = contactBody.parse(await readJson(req));
    await assertRef(ctx, "company", b.company_id);
    await assertRef(ctx, "member", b.owner_id);
    const v = contactValues(b);
    const [row] = await ctx.tx
      .insert(contacts)
      .values({ ...v, firstName: b.first_name, orgId: ctx.orgId, ownerId: b.owner_id ?? ctx.actorId })
      .returning();
    await ctx.tx.insert(activities).values({
      orgId: ctx.orgId,
      actorId: ctx.actorId,
      contactId: row.id,
      companyId: row.companyId,
      type: "created",
      body: `${fullName(row)} נוסף/ה למערכת דרך ה-API`,
    });
    ctx.audit("contact.create", row.id);
    return Response.json(toApi(row), { status: 201 });
  },

  async get(_: NextRequest, ctx: ApiCtx, id: string) {
    const [row] = await ctx.tx.select().from(contacts).where(and(eq(contacts.id, uuidParam(id)), eq(contacts.orgId, ctx.orgId)));
    if (!row) throw notFound("Contact");
    return toApi(row);
  },

  async update(req: NextRequest, ctx: ApiCtx, id: string) {
    const b = contactBody.partial().parse(await readJson(req));
    await assertRef(ctx, "company", b.company_id);
    await assertRef(ctx, "member", b.owner_id);
    const v = contactValues(b);
    if (!Object.keys(v).length) throw new ApiError(422, "empty_update", "No updatable fields in body");
    const [row] = await ctx.tx
      .update(contacts)
      .set(v)
      .where(and(eq(contacts.id, uuidParam(id)), eq(contacts.orgId, ctx.orgId)))
      .returning();
    if (!row) throw notFound("Contact");
    ctx.audit("contact.update", row.id, { fields: Object.keys(b) });
    return toApi(row);
  },

  async remove(_: NextRequest, ctx: ApiCtx, id: string) {
    const [row] = await ctx.tx
      .delete(contacts)
      .where(and(eq(contacts.id, uuidParam(id)), eq(contacts.orgId, ctx.orgId)))
      .returning({ id: contacts.id });
    if (!row) throw notFound("Contact");
    ctx.audit("contact.delete", row.id);
    return new Response(null, { status: 204 });
  },
};

/* ------------------------------------------------------------------ */
/* Companies                                                           */
/* ------------------------------------------------------------------ */

const companyBody = z.object({
  name: z.string().trim().min(1).max(120),
  domain: nullableStr(120),
  industry: nullableStr(80),
  phone: nullableStr(30),
  address: nullableStr(200),
  owner_id: z.string().nullable().optional(),
});

function companyValues(b: Partial<z.infer<typeof companyBody>>) {
  const v = { name: b.name, domain: b.domain, industry: b.industry, phone: b.phone, address: b.address, ownerId: b.owner_id };
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as Partial<typeof companies.$inferInsert>;
}

export const companiesApi = {
  async list(req: NextRequest, ctx: ApiCtx) {
    const q = req.nextUrl.searchParams.get("q")?.trim();
    return listPage(ctx, req, companies, [q ? or(ilike(companies.name, like(q)), ilike(companies.domain, like(q))) : undefined]);
  },
  async create(req: NextRequest, ctx: ApiCtx) {
    const b = companyBody.parse(await readJson(req));
    await assertRef(ctx, "member", b.owner_id);
    const [row] = await ctx.tx
      .insert(companies)
      .values({ ...companyValues(b), name: b.name, orgId: ctx.orgId, ownerId: b.owner_id ?? ctx.actorId })
      .returning();
    ctx.audit("company.create", row.id);
    return Response.json(toApi(row), { status: 201 });
  },
  async get(_: NextRequest, ctx: ApiCtx, id: string) {
    const [row] = await ctx.tx.select().from(companies).where(and(eq(companies.id, uuidParam(id)), eq(companies.orgId, ctx.orgId)));
    if (!row) throw notFound("Company");
    return toApi(row);
  },
  async update(req: NextRequest, ctx: ApiCtx, id: string) {
    const b = companyBody.partial().parse(await readJson(req));
    await assertRef(ctx, "member", b.owner_id);
    const v = companyValues(b);
    if (!Object.keys(v).length) throw new ApiError(422, "empty_update", "No updatable fields in body");
    const [row] = await ctx.tx
      .update(companies)
      .set(v)
      .where(and(eq(companies.id, uuidParam(id)), eq(companies.orgId, ctx.orgId)))
      .returning();
    if (!row) throw notFound("Company");
    ctx.audit("company.update", row.id);
    return toApi(row);
  },
};

/* ------------------------------------------------------------------ */
/* Pipeline and deals                                                  */
/* ------------------------------------------------------------------ */

export async function listPipelineStages(_: NextRequest, ctx: ApiCtx) {
  await listStages(ctx.orgId); // seeds the defaults on first use
  const rows = await ctx.tx
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.orgId, ctx.orgId))
    .orderBy(asc(pipelineStages.position));
  return { data: rows.map((r) => toApi(r)) };
}

const dealBody = z.object({
  title: z.string().trim().min(1).max(140),
  amount: z.number().int().min(0).max(1_000_000_000).default(0),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  stage_id: z.uuid().optional(),
  contact_id: optionalUuid,
  company_id: optionalUuid,
  owner_id: z.string().nullable().optional(),
  expected_close: z.iso.date().nullable().optional(),
});

const dealPatch = dealBody.partial().extend({
  status: z.enum(dealStatuses).optional(),
  lost_reason: z.string().trim().min(1).max(300).optional(),
});

async function dealLog(ctx: ApiCtx, d: { id: string; contactId: string | null; companyId: string | null }, body: string) {
  await ctx.tx.insert(activities).values({
    orgId: ctx.orgId,
    actorId: ctx.actorId,
    dealId: d.id,
    contactId: d.contactId,
    companyId: d.companyId,
    type: "deal",
    body,
  });
}

async function companyOfContact(ctx: ApiCtx, contactId: string | null | undefined) {
  if (!contactId) return null;
  const [c] = await ctx.tx.select({ companyId: contacts.companyId }).from(contacts).where(eq(contacts.id, contactId));
  return c?.companyId ?? null;
}

export const dealsApi = {
  async list(req: NextRequest, ctx: ApiCtx) {
    const sp = req.nextUrl.searchParams;
    const status = sp.get("status");
    if (status && !dealStatuses.includes(status as never)) throw new ApiError(400, "invalid_filter", "unknown status");
    return listPage(ctx, req, deals, [
      status ? eq(deals.status, status as (typeof dealStatuses)[number]) : undefined,
      sp.get("stage_id") ? eq(deals.stageId, uuidParam(sp.get("stage_id")!)) : undefined,
      sp.get("contact_id") ? eq(deals.contactId, uuidParam(sp.get("contact_id")!)) : undefined,
    ]);
  },

  async create(req: NextRequest, ctx: ApiCtx) {
    const b = dealBody.parse(await readJson(req));
    const stageId = b.stage_id ?? (await listStages(ctx.orgId))[0].id;
    await assertRef(ctx, "stage", stageId);
    await assertRef(ctx, "contact", b.contact_id);
    await assertRef(ctx, "company", b.company_id);
    await assertRef(ctx, "member", b.owner_id);
    const [row] = await ctx.tx
      .insert(deals)
      .values({
        orgId: ctx.orgId,
        title: b.title,
        amount: b.amount,
        currency: b.currency ?? "ILS",
        stageId,
        contactId: b.contact_id ?? null,
        companyId: b.company_id ?? (await companyOfContact(ctx, b.contact_id)),
        ownerId: b.owner_id ?? ctx.actorId,
        expectedClose: b.expected_close ?? null,
      })
      .returning();
    await dealLog(ctx, row, `נפתחה עסקה דרך ה-API: ${row.title}, ${formatMoney(row.amount, row.currency)}`);
    ctx.audit("deal.create", row.id);
    return Response.json(toApi(row), { status: 201 });
  },

  async get(_: NextRequest, ctx: ApiCtx, id: string) {
    const [row] = await ctx.tx.select().from(deals).where(and(eq(deals.id, uuidParam(id)), eq(deals.orgId, ctx.orgId)));
    if (!row) throw notFound("Deal");
    return toApi(row);
  },

  /** Field edits, stage moves and won/lost/reopen, with the same rules as the app. */
  async update(req: NextRequest, ctx: ApiCtx, id: string) {
    const b = dealPatch.parse(await readJson(req));
    const [before] = await ctx.tx.select().from(deals).where(and(eq(deals.id, uuidParam(id)), eq(deals.orgId, ctx.orgId)));
    if (!before) throw notFound("Deal");
    await assertRef(ctx, "stage", b.stage_id);
    await assertRef(ctx, "contact", b.contact_id);
    await assertRef(ctx, "company", b.company_id);
    await assertRef(ctx, "member", b.owner_id);

    const set: Partial<typeof deals.$inferInsert> = {};
    if (b.title !== undefined) set.title = b.title;
    if (b.amount !== undefined) set.amount = b.amount;
    if (b.currency !== undefined) set.currency = b.currency;
    if (b.contact_id !== undefined) set.contactId = b.contact_id;
    if (b.company_id !== undefined) set.companyId = b.company_id;
    if (b.owner_id !== undefined) set.ownerId = b.owner_id;
    if (b.expected_close !== undefined) set.expectedClose = b.expected_close;

    const moved = b.stage_id !== undefined && b.stage_id !== before.stageId;
    if (moved) {
      if (before.status !== "open" && b.status !== "open") {
        throw new ApiError(409, "deal_closed", "Reopen the deal (status: open) before moving it");
      }
      set.stageId = b.stage_id;
      set.stageChangedAt = new Date();
    }

    let outcome: "won" | "lost" | "reopen" | null = null;
    if (b.status && b.status !== before.status) {
      if (b.status === "lost" && !b.lost_reason) {
        throw new ApiError(422, "validation_failed", "lost_reason is required when status is lost", [{ path: "lost_reason" }]);
      }
      outcome = b.status === "open" ? "reopen" : b.status;
      set.status = b.status;
      set.closedAt = b.status === "open" ? null : new Date();
      set.lostReason = b.status === "lost" ? b.lost_reason : null;
    }
    if (!Object.keys(set).length) return toApi(before);

    const [row] = await ctx.tx.update(deals).set(set).where(eq(deals.id, before.id)).returning();
    if (moved) {
      const [s] = await ctx.tx.select({ name: pipelineStages.name }).from(pipelineStages).where(eq(pipelineStages.id, row.stageId));
      await dealLog(ctx, row, `הועברה לשלב ${s?.name ?? ""} דרך ה-API`);
      ctx.audit("deal.move", row.id, { stageId: row.stageId });
    }
    if (outcome === "won") {
      await dealLog(ctx, row, `העסקה נחתמה: ${formatMoney(row.amount, row.currency)}`);
      if (row.contactId) await ctx.tx.update(contacts).set({ status: "customer" }).where(eq(contacts.id, row.contactId));
    } else if (outcome === "lost") {
      await dealLog(ctx, row, `העסקה לא נסגרה. סיבה: ${row.lostReason}`);
    } else if (outcome === "reopen") {
      await dealLog(ctx, row, "העסקה נפתחה מחדש");
    }
    if (outcome) ctx.audit(outcome === "reopen" ? "deal.reopen" : `deal.${outcome}`, row.id);
    const fieldEdits = Object.keys(b).filter((k) => !["stage_id", "status", "lost_reason"].includes(k));
    if (fieldEdits.length) ctx.audit("deal.update", row.id, { fields: fieldEdits });
    return toApi(row);
  },
};

/* ------------------------------------------------------------------ */
/* Tickets                                                             */
/* ------------------------------------------------------------------ */

const ticketBody = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10000),
  contact_id: optionalUuid,
  assignee_id: z.string().nullable().optional(),
  priority: z.enum(ticketPriorities).optional(),
  channel: z.enum(["api", "web", "email", "phone", "whatsapp"]).default("api"),
});

const ticketPatch = z.object({
  status: z.enum(ticketStatuses).optional(),
  priority: z.enum(ticketPriorities).optional(),
  assignee_id: z.string().nullable().optional(),
});

export const ticketsApi = {
  async list(req: NextRequest, ctx: ApiCtx) {
    const status = req.nextUrl.searchParams.get("status");
    if (status && !ticketStatuses.includes(status as never)) throw new ApiError(400, "invalid_filter", "unknown status");
    return listPage(ctx, req, tickets, [status ? eq(tickets.status, status as (typeof ticketStatuses)[number]) : undefined]);
  },

  async create(req: NextRequest, ctx: ApiCtx) {
    const b = ticketBody.parse(await readJson(req));
    await assertRef(ctx, "contact", b.contact_id);
    await assertRef(ctx, "member", b.assignee_id);
    // Per-org sequential number; serialize concurrent creates for this org.
    await ctx.tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"tickets:" + ctx.orgId}))`);
    const [row] = await ctx.tx
      .insert(tickets)
      .values({
        orgId: ctx.orgId,
        subject: b.subject,
        priority: b.priority,
        channel: b.channel,
        contactId: b.contact_id ?? null,
        assigneeId: b.assignee_id ?? null,
        createdById: ctx.actorId,
        number: sql`(select coalesce(max(${tickets.number}), 1000) + 1 from ${tickets} where ${tickets.orgId} = ${ctx.orgId})`,
      })
      .returning();
    await ctx.tx.insert(ticketMessages).values({ orgId: ctx.orgId, ticketId: row.id, kind: "inbound", body: b.body });
    if (row.contactId) {
      await ctx.tx.insert(activities).values({
        orgId: ctx.orgId,
        actorId: ctx.actorId,
        contactId: row.contactId,
        type: "ticket",
        body: `נפתחה פנייה #${row.number}: ${row.subject}`,
      });
    }
    ctx.audit("ticket.create", row.id);
    return Response.json(toApi(row), { status: 201 });
  },

  async get(_: NextRequest, ctx: ApiCtx, id: string) {
    const [row] = await ctx.tx.select().from(tickets).where(and(eq(tickets.id, uuidParam(id)), eq(tickets.orgId, ctx.orgId)));
    if (!row) throw notFound("Ticket");
    const messages = await ctx.tx
      .select()
      .from(ticketMessages)
      .where(eq(ticketMessages.ticketId, row.id))
      .orderBy(asc(ticketMessages.createdAt));
    return { ...toApi(row), messages: messages.map((m) => toApi(m)) };
  },

  async update(req: NextRequest, ctx: ApiCtx, id: string) {
    const b = ticketPatch.parse(await readJson(req));
    await assertRef(ctx, "member", b.assignee_id);
    const set: Partial<typeof tickets.$inferInsert> = {};
    if (b.priority) set.priority = b.priority;
    if (b.assignee_id !== undefined) set.assigneeId = b.assignee_id;
    if (b.status) {
      set.status = b.status;
      set.resolvedAt = b.status === "resolved" ? new Date() : null;
    }
    if (!Object.keys(set).length) throw new ApiError(422, "empty_update", "No updatable fields in body");
    const [row] = await ctx.tx
      .update(tickets)
      .set(set)
      .where(and(eq(tickets.id, uuidParam(id)), eq(tickets.orgId, ctx.orgId)))
      .returning();
    if (!row) throw notFound("Ticket");
    ctx.audit("ticket.update", row.id, b);
    return toApi(row);
  },
};
