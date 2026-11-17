import "server-only";
import { and, count, desc, eq, ilike, or, type SQL, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ContactStatus } from "./labels";

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
  filter: { contactId?: string; companyId?: string },
  limit = 50,
) {
  const where: SQL[] = [eq(activities.orgId, orgId)];
  if (filter.contactId) where.push(eq(activities.contactId, filter.contactId));
  if (filter.companyId) where.push(eq(activities.companyId, filter.companyId));
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
