"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { type ContactField, contactFields, normalizeStatus, parseCsv, phoneKey, rowToContact } from "@/lib/csv";
import { log } from "@/lib/log";
import { audit, ForbiddenError, requirePermission } from "@/lib/session";

export type ImportReport = {
  error?: string;
  imported?: number;
  duplicates?: number;
  companiesCreated?: number;
  failed?: { row: number; message: string }[];
  failedCount?: number;
};

const MAX_ROWS = 5000;
const MAX_BYTES = 5 * 1024 * 1024;

const rowSchema = z.object({
  firstName: z.string({ error: "חסר שם" }).trim().min(1, "חסר שם").max(80),
  lastName: z.string().trim().max(80).default(""),
  email: z.email("אימייל לא תקין").max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  title: z.string().trim().max(80).optional(),
  source: z.string().trim().max(80).optional(),
  status: z.enum(["lead", "prospect", "customer", "churned"]).default("lead"),
  company: z.string().trim().max(120).optional(),
  tags: z.string().optional(),
});

export async function importContacts(_: ImportReport | undefined, form: FormData): Promise<ImportReport> {
  try {
    const ctx = await requirePermission({ contact: ["create"] });
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "בחרו קובץ CSV" };
    if (file.size > MAX_BYTES) return { error: "הקובץ גדול מ-5MB. פצלו אותו לכמה קבצים." };

    const mapping = z
      .array(z.enum(contactFields).nullable())
      .safeParse(JSON.parse(String(form.get("mapping") ?? "[]")));
    if (!mapping.success) return { error: "מיפוי העמודות לא תקין" };
    const map = mapping.data as (ContactField | null)[];
    if (!map.includes("firstName") && !map.includes("fullName")) {
      return { error: "סמנו איזו עמודה מכילה את השם" };
    }

    const rows = parseCsv(await file.text()).slice(1);
    if (!rows.length) return { error: "לא נמצאו שורות מתחת לכותרות" };
    if (rows.length > MAX_ROWS) return { error: `אפשר לייבא עד ${MAX_ROWS.toLocaleString("he-IL")} שורות בכל פעם` };

    // Existing keys for de-duplication (email, normalized phone).
    const existing = await db
      .select({ email: schema.contacts.email, phone: schema.contacts.phone })
      .from(schema.contacts)
      .where(eq(schema.contacts.orgId, ctx.orgId));
    const seenEmail = new Set(existing.map((c) => c.email?.toLowerCase()).filter(Boolean));
    const seenPhone = new Set(existing.map((c) => phoneKey(c.phone)).filter(Boolean));

    const companies = await db
      .select({ id: schema.companies.id, name: schema.companies.name })
      .from(schema.companies)
      .where(eq(schema.companies.orgId, ctx.orgId));
    const companyIds = new Map(companies.map((c) => [c.name.trim().toLowerCase(), c.id]));

    const failed: { row: number; message: string }[] = [];
    const valid: (z.infer<typeof rowSchema> & { line: number })[] = [];
    let duplicates = 0;

    rows.forEach((r, i) => {
      const line = i + 2; // 1-based, after the header row
      const raw = rowToContact(r, map);
      const parsed = rowSchema.safeParse({
        ...raw,
        email: raw.email?.toLowerCase(),
        status: normalizeStatus(raw.status) ?? "lead",
      });
      if (!parsed.success) {
        failed.push({ row: line, message: parsed.error.issues[0].message });
        return;
      }
      const v = parsed.data;
      const pk = phoneKey(v.phone);
      if ((v.email && seenEmail.has(v.email)) || (pk && seenPhone.has(pk))) {
        duplicates++;
        return;
      }
      if (v.email) seenEmail.add(v.email);
      if (pk) seenPhone.add(pk);
      valid.push({ ...v, line });
    });

    const newCompanies = [
      ...new Map(
        valid
          .map((v) => v.company)
          .filter((n): n is string => !!n && !companyIds.has(n.toLowerCase()))
          .map((n) => [n.toLowerCase(), n]),
      ).values(),
    ];

    await db.transaction(async (tx) => {
      if (newCompanies.length) {
        const created = await tx
          .insert(schema.companies)
          .values(newCompanies.map((name) => ({ orgId: ctx.orgId, name, ownerId: ctx.userId })))
          .returning({ id: schema.companies.id, name: schema.companies.name });
        for (const c of created) companyIds.set(c.name.toLowerCase(), c.id);
      }
      for (let i = 0; i < valid.length; i += 500) {
        const chunk = valid.slice(i, i + 500);
        const inserted = await tx
          .insert(schema.contacts)
          .values(
            chunk.map((v) => ({
              orgId: ctx.orgId,
              firstName: v.firstName,
              lastName: v.lastName,
              email: v.email ?? null,
              phone: v.phone ?? null,
              title: v.title ?? null,
              source: v.source ?? "ייבוא CSV",
              status: v.status,
              tags: v.tags ? [...new Set(v.tags.split(/[,;|]/).map((t) => t.trim()).filter(Boolean))].slice(0, 20) : [],
              companyId: v.company ? (companyIds.get(v.company.toLowerCase()) ?? null) : null,
              ownerId: ctx.userId,
            })),
          )
          .returning({ id: schema.contacts.id, companyId: schema.contacts.companyId });
        await tx.insert(schema.activities).values(
          inserted.map((c) => ({
            orgId: ctx.orgId,
            actorId: ctx.userId,
            contactId: c.id,
            companyId: c.companyId,
            type: "created",
            body: `נוסף/ה בייבוא מהקובץ ${file.name}`,
          })),
        );
      }
    });

    await audit(ctx, "contact.import", file.name, {
      imported: valid.length,
      duplicates,
      failed: failed.length,
      companiesCreated: newCompanies.length,
    });
    log.info("contacts.import", { orgId: ctx.orgId, rows: rows.length, imported: valid.length, duplicates, failed: failed.length });
    revalidatePath("/contacts");
    revalidatePath("/companies");
    return {
      imported: valid.length,
      duplicates,
      companiesCreated: newCompanies.length,
      failed: failed.slice(0, 50),
      failedCount: failed.length,
    };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    if (e instanceof SyntaxError) return { error: "מיפוי העמודות לא תקין" };
    throw e;
  }
}
