import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { apiRoute, RATE_LIMIT } from "@/lib/api/handler";

/** Who am I: the key's organization and role. Handy for connection tests. */
export const GET = apiRoute(null, async (_, ctx) => {
  const [org] = await ctx.tx
    .select({ id: schema.organization.id, name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, ctx.orgId));
  return { organization: org, key_id: ctx.keyId, role: ctx.role, rate_limit: RATE_LIMIT };
});
