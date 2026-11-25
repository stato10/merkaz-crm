import "server-only";
import { and, count, desc, eq, gte, ilike, lt, or, type SQL, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { type ContactStatus, type DealStatus, defaultStages, type TicketStatus } from "./labels";

const { contacts, companies, activities, member, user } = schema;

export async function listContacts(
  orgId: string,
  opts: { q?: string; status?: ContactStatus; companyId?: string; limit?: number } = {},
) {
  const where: SQL[] = [eq(contacts.orgId, orgId)];
  if (opts.status) where.push(eq(contacts.status, opts.status));
  if (opts.companyId) where.push(eq(contacts.companyId, opts.companyId));
  if (opts.q) {
    const q = `%${opts.q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(
      or(
        ilike(sql`${contacts.firstName} || ' ' || ${contacts.lastName}`, q),
        ilike(contacts.email, q),
        ilike(contacts.phone, q),
        ilike(companies.name, q),
      )!,
    );
  }
  return db
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      phone: contacts.phone,
      title: contacts.title,
      status: contacts.status,
      tags: contacts.tags,
      createdAt: contacts.createdAt,
      companyId: contacts.companyId,
      companyName: companies.name,
      ownerName: user.name,
    })
    .from(contacts)
    .leftJoin(companies, eq(companies.id, contacts.companyId))
    .leftJoin(user, eq(user.id, contacts.ownerId))
    .where(and(...where))
    .orderBy(desc(contacts.createdAt))
    .limit(opts.limit ?? 200);
}

export async function contactStatusCounts(orgId: string) {
  const rows = await db
    .select({ status: contacts.status, n: count() })
    .from(contacts)
    .where(eq(contacts.orgId, orgId))
    .groupBy(contacts.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<
    Record<ContactStatus, number>
  >;
}

export async function getContact(orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select({
      contact: contacts,
      companyName: companies.name,
      ownerName: user.name,
    })
    .from(contacts)
    .leftJoin(companies, eq(companies.id, contacts.companyId))
    .leftJoin(user, eq(user.id, contacts.ownerId))
    .where(and(eq(contacts.id, id), eq(contacts.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

export async function listActivities(
  orgId: string,
  filter: { contactId?: string; companyId?: string; dealId?: string },
  limit = 50,
) {
  const where: SQL[] = [eq(activities.orgId, orgId)];
  if (filter.contactId) where.push(eq(activities.contactId, filter.contactId));
  if (filter.companyId) where.push(eq(activities.companyId, filter.companyId));
  if (filter.dealId) where.push(eq(activities.dealId, filter.dealId));
  return db
    .select({
      id: activities.id,
      type: activities.type,
      body: activities.body,
      createdAt: activities.createdAt,
      actorName: user.name,
      contactId: activities.contactId,
      contactFirst: contacts.firstName,
      contactLast: contacts.lastName,
    })
    .from(activities)
    .leftJoin(user, eq(user.id, activities.actorId))
    .leftJoin(contacts, eq(contacts.id, activities.contactId))
    .where(and(...where))
    .orderBy(desc(activities.createdAt))
    .limit(limit);
}

export async function listCompanies(orgId: string, q?: string) {
  const where: SQL[] = [eq(companies.orgId, orgId)];
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(or(ilike(companies.name, like), ilike(companies.domain, like))!);
  }
  return db
    .select({
      id: companies.id,
      name: companies.name,
      domain: companies.domain,
      industry: companies.industry,
      phone: companies.phone,
      createdAt: companies.createdAt,
      ownerName: user.name,
      contactCount: sql<number>`(select count(*)::int from ${contacts} where ${contacts.companyId} = ${companies.id})`,
    })
    .from(companies)
    .leftJoin(user, eq(user.id, companies.ownerId))
    .where(and(...where))
    .orderBy(companies.name)
    .limit(500);
}

export async function companyOptions(orgId: string) {
  return db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(eq(companies.orgId, orgId))
    .orderBy(companies.name);
}

export async function getCompany(orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (
    (await db.query.companies.findFirst({
      where: and(eq(companies.id, id), eq(companies.orgId, orgId)),
    })) ?? null
  );
}

export async function listMembers(orgId: string) {
  return db
    .select({
      memberId: member.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      role: member.role,
      createdAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, orgId))
    .orderBy(member.createdAt);
}

/* ---------------- Service ---------------- */

const { tickets, ticketMessages, appointments } = schema;

const uuidRe = /^[0-9a-f-]{36}$/i;

export async function listTickets(
  orgId: string,
  opts: {
    status?: TicketStatus;
    assigneeId?: string;
    contactId?: string;
    q?: string;
    limit?: number;
  } = {},
) {
  const where: SQL[] = [eq(tickets.orgId, orgId)];
  if (opts.status) where.push(eq(tickets.status, opts.status));
  if (opts.assigneeId) where.push(eq(tickets.assigneeId, opts.assigneeId));
  if (opts.contactId) where.push(eq(tickets.contactId, opts.contactId));
  if (opts.q) {
    const q = `%${opts.q.replace(/[%_\\]/g, "\\$&")}%`;
    const n = Number(opts.q.replace(/^#/, ""));
    where.push(
      or(
        ilike(tickets.subject, q),
        ilike(sql`${contacts.firstName} || ' ' || ${contacts.lastName}`, q),
        ...(Number.isInteger(n) && n > 0 ? [eq(tickets.number, n)] : []),
      )!,
    );
  }
  return db
    .select({
      id: tickets.id,
      number: tickets.number,
      subject: tickets.subject,
      status: tickets.status,
      priority: tickets.priority,
      channel: tickets.channel,
      lastMessageAt: tickets.lastMessageAt,
      createdAt: tickets.createdAt,
      contactId: tickets.contactId,
      contactFirst: contacts.firstName,
      contactLast: contacts.lastName,
      assigneeId: tickets.assigneeId,
      assigneeName: user.name,
      preview: sql<string | null>`(select ${ticketMessages.body} from ${ticketMessages}
        where ${ticketMessages.ticketId} = ${tickets.id} and ${ticketMessages.kind} <> 'note'
        order by ${ticketMessages.createdAt} desc limit 1)`,
    })
    .from(tickets)
    .leftJoin(contacts, eq(contacts.id, tickets.contactId))
    .leftJoin(user, eq(user.id, tickets.assigneeId))
    .where(and(...where))
    .orderBy(
      sql`case ${tickets.priority} when 'urgent' then 0 when 'high' then 1 else 2 end`,
      desc(tickets.lastMessageAt),
    )
    .limit(opts.limit ?? 200);
}

export async function ticketStatusCounts(orgId: string, assigneeId?: string) {
  const where: SQL[] = [eq(tickets.orgId, orgId)];
  if (assigneeId) where.push(eq(tickets.assigneeId, assigneeId));
  const rows = await db
    .select({ status: tickets.status, n: count() })
    .from(tickets)
    .where(and(...where))
    .groupBy(tickets.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<
    Record<TicketStatus, number>
  >;
}

export async function getTicket(orgId: string, id: string) {
  if (!uuidRe.test(id)) return null;
  const [row] = await db
    .select({
      ticket: tickets,
      contactFirst: contacts.firstName,
      contactLast: contacts.lastName,
      contactEmail: contacts.email,
      contactPhone: contacts.phone,
      contactStatus: contacts.status,
    })
    .from(tickets)
    .leftJoin(contacts, eq(contacts.id, tickets.contactId))
    .where(and(eq(tickets.id, id), eq(tickets.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

export async function listTicketMessages(orgId: string, ticketId: string) {
  return db
    .select({
      id: ticketMessages.id,
      kind: ticketMessages.kind,
      body: ticketMessages.body,
      createdAt: ticketMessages.createdAt,
      authorName: user.name,
    })
    .from(ticketMessages)
    .leftJoin(user, eq(user.id, ticketMessages.authorId))
    .where(and(eq(ticketMessages.orgId, orgId), eq(ticketMessages.ticketId, ticketId)))
    .orderBy(ticketMessages.createdAt);
}

export async function listAppointments(
  orgId: string,
  opts: { from?: Date; to?: Date; contactId?: string; desc?: boolean; limit?: number } = {},
) {
  const where: SQL[] = [eq(appointments.orgId, orgId)];
  if (opts.from) where.push(gte(appointments.startsAt, opts.from));
  if (opts.to) where.push(lt(appointments.startsAt, opts.to));
  if (opts.contactId) where.push(eq(appointments.contactId, opts.contactId));
  return db
    .select({
      id: appointments.id,
      title: appointments.title,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      status: appointments.status,
      location: appointments.location,
      contactId: appointments.contactId,
      contactFirst: contacts.firstName,
      contactLast: contacts.lastName,
      contactPhone: contacts.phone,
      assigneeName: user.name,
    })
    .from(appointments)
    .innerJoin(contacts, eq(contacts.id, appointments.contactId))
    .leftJoin(user, eq(user.id, appointments.assigneeId))
    .where(and(...where))
    .orderBy(opts.desc ? desc(appointments.startsAt) : appointments.startsAt)
    .limit(opts.limit ?? 300);
}

export async function getAppointment(orgId: string, id: string) {
  if (!uuidRe.test(id)) return null;
  const [row] = await db
    .select({
      appt: appointments,
      contactFirst: contacts.firstName,
      contactLast: contacts.lastName,
    })
    .from(appointments)
    .innerJoin(contacts, eq(contacts.id, appointments.contactId))
    .where(and(eq(appointments.id, id), eq(appointments.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

export async function contactOptions(orgId: string) {
  return db
    .select({
      id: contacts.id,
      name: sql<string>`trim(${contacts.firstName} || ' ' || ${contacts.lastName})`,
    })
    .from(contacts)
    .where(eq(contacts.orgId, orgId))
    .orderBy(contacts.firstName, contacts.lastName)
    .limit(2000);
}

/* ---------------- Sales ---------------- */

const { deals, pipelineStages } = schema;

/** The organization's open stages in order. Creates the default set on first use. */
export async function listStages(orgId: string) {
  const rows = await db
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.orgId, orgId))
    .orderBy(pipelineStages.position);
  if (rows.length) return rows;
  return db.transaction(async (tx) => {
    // Serialize first-use seeding so two parallel requests don't both insert.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"stages:" + orgId}))`);
    const again = await tx
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.orgId, orgId))
      .orderBy(pipelineStages.position);
    if (again.length) return again;
    return tx
      .insert(pipelineStages)
      .values(defaultStages.map((s, i) => ({ ...s, orgId, position: i + 1 })))
      .returning();
  });
}

export async function listDeals(
  orgId: string,
  opts: {
    status?: DealStatus;
    ownerId?: string;
    contactId?: string;
    companyId?: string;
    q?: string;
    limit?: number;
  } = {},
) {
  const where: SQL[] = [eq(deals.orgId, orgId)];
  if (opts.status) where.push(eq(deals.status, opts.status));
  if (opts.ownerId) where.push(eq(deals.ownerId, opts.ownerId));
  if (opts.contactId) where.push(eq(deals.contactId, opts.contactId));
  if (opts.companyId) where.push(eq(deals.companyId, opts.companyId));
  if (opts.q) {
    const q = `%${opts.q.replace(/[%_\\]/g, "\\$&")}%`;
    where.push(
      or(
        ilike(deals.title, q),
        ilike(companies.name, q),
        ilike(sql`${contacts.firstName} || ' ' || ${contacts.lastName}`, q),
      )!,
    );
  }
  return db
    .select({
      id: deals.id,
      title: deals.title,
      amount: deals.amount,
      currency: deals.currency,
      status: deals.status,
      stageId: deals.stageId,
      stageName: pipelineStages.name,
      probability: pipelineStages.probability,
      expectedClose: deals.expectedClose,
      closedAt: deals.closedAt,
      stageChangedAt: deals.stageChangedAt,
      updatedAt: deals.updatedAt,
      contactId: deals.contactId,
      contactFirst: contacts.firstName,
      contactLast: contacts.lastName,
      companyId: deals.companyId,
      companyName: companies.name,
      ownerId: deals.ownerId,
      ownerName: user.name,
    })
    .from(deals)
    .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .leftJoin(companies, eq(companies.id, deals.companyId))
    .leftJoin(user, eq(user.id, deals.ownerId))
    .where(and(...where))
    .orderBy(desc(sql`coalesce(${deals.closedAt}, ${deals.updatedAt})`))
    .limit(opts.limit ?? 500);
}

export async function getDeal(orgId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select({
      deal: deals,
      stageName: pipelineStages.name,
      contactFirst: contacts.firstName,
      contactLast: contacts.lastName,
      contactPhone: contacts.phone,
      contactEmail: contacts.email,
      contactStatus: contacts.status,
      companyName: companies.name,
    })
    .from(deals)
    .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .leftJoin(contacts, eq(contacts.id, deals.contactId))
    .leftJoin(companies, eq(companies.id, deals.companyId))
    .where(and(eq(deals.id, id), eq(deals.orgId, orgId)))
    .limit(1);
  return row ?? null;
}

/** Headline numbers: open pipeline, weighted forecast, and deals closed since `since`. */
export async function pipelineSummary(orgId: string, since: Date, ownerId?: string) {
  const where: SQL[] = [eq(deals.orgId, orgId)];
  if (ownerId) where.push(eq(deals.ownerId, ownerId));
  const from = since.toISOString();
  const open = sql`${deals.status} = 'open'`;
  const wonSince = sql`${deals.status} = 'won' and ${deals.closedAt} >= ${from}::timestamptz`;
  const lostSince = sql`${deals.status} = 'lost' and ${deals.closedAt} >= ${from}::timestamptz`;
  const [r] = await db
    .select({
      openCount: sql<number>`count(*) filter (where ${open})::int`,
      openSum: sql<number>`coalesce(sum(${deals.amount}) filter (where ${open}), 0)::float8`,
      weighted: sql<number>`coalesce(sum(${deals.amount} * ${pipelineStages.probability} / 100.0) filter (where ${open}), 0)::float8`,
      wonCount: sql<number>`count(*) filter (where ${wonSince})::int`,
      wonSum: sql<number>`coalesce(sum(${deals.amount}) filter (where ${wonSince}), 0)::float8`,
      lostCount: sql<number>`count(*) filter (where ${lostSince})::int`,
    })
    .from(deals)
    .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
    .where(and(...where));
  return {
    openCount: Number(r?.openCount ?? 0),
    openSum: Number(r?.openSum ?? 0),
    weighted: Math.round(Number(r?.weighted ?? 0)),
    wonCount: Number(r?.wonCount ?? 0),
    wonSum: Number(r?.wonSum ?? 0),
    lostCount: Number(r?.lostCount ?? 0),
  };
}

/** How many deals sit in each stage (any status), so a stage in use can't be deleted. */
export async function stageUsage(orgId: string) {
  const rows = await db
    .select({ stageId: deals.stageId, n: count() })
    .from(deals)
    .where(eq(deals.orgId, orgId))
    .groupBy(deals.stageId);
  return Object.fromEntries(rows.map((r) => [r.stageId, r.n])) as Record<string, number>;
}
