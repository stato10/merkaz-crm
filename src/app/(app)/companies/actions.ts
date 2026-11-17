"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { audit, ForbiddenError, requirePermission } from "@/lib/session";
import type { FormState } from "../contacts/actions";

const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const input = z.object({
  name: z.string().trim().min(1, "שם החברה חובה").max(120),
  domain: z.preprocess(emptyToNull, z.string().trim().max(120).nullable()),
  industry: z.preprocess(emptyToNull, z.string().trim().max(80).nullable()),
  phone: z.preprocess(emptyToNull, z.string().trim().max(30).nullable()),
  address: z.preprocess(emptyToNull, z.string().trim().max(200).nullable()),
});

export async function saveCompany(
  id: string | null,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  try {
    const ctx = await requirePermission({ company: [id ? "update" : "create"] });
    const parsed = input.safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    if (id) {
      const r = await db
        .update(schema.companies)
        .set(parsed.data)
        .where(and(eq(schema.companies.id, id), eq(schema.companies.orgId, ctx.orgId)))
        .returning({ id: schema.companies.id });
      if (!r.length) return { error: "החברה לא נמצאה" };
      await audit(ctx, "company.update", id);
    } else {
      const [r] = await db
        .insert(schema.companies)
        .values({ ...parsed.data, orgId: ctx.orgId, ownerId: ctx.userId })
        .returning({ id: schema.companies.id });
      await audit(ctx, "company.create", r.id);
    }
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    throw e;
  }
  revalidatePath("/companies", "layout");
  return { ok: true };
}
