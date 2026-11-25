import "server-only";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db, schema } from "@/db";
import { writeAudit } from "./audit";
import { auth } from "./auth";
import { type Permissions, roleCan, type RoleName } from "./permissions";

export type Ctx = {
  userId: string;
  userName: string;
  userEmail: string;
  orgId: string;
  orgName: string;
  role: RoleName;
  can: (p: Permissions) => boolean;
};

/** Current signed-in user + active organization. Redirects when missing. */
export const getCtx = cache(async (): Promise<Ctx> => {
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) redirect("/login");

  const orgId = s.session.activeOrganizationId;
  if (!orgId) redirect("/onboarding");

  const row = await db
    .select({ role: schema.member.role, orgName: schema.organization.name })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(and(eq(schema.member.userId, s.user.id), eq(schema.member.organizationId, orgId)))
    .limit(1);
  if (!row[0]) redirect("/onboarding");

  const role = row[0].role as RoleName;
  return {
    userId: s.user.id,
    userName: s.user.name,
    userEmail: s.user.email,
    orgId,
    orgName: row[0].orgName,
    role,
    can: (p) => roleCan(role, p),
  };
});

export class ForbiddenError extends Error {
  constructor() {
    super("אין לך הרשאה לפעולה הזו");
  }
}

export async function requirePermission(p: Permissions): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx.can(p)) throw new ForbiddenError();
  return ctx;
}

export async function audit(
  ctx: Ctx,
  action: string,
  target: string,
  metadata?: Record<string, unknown>,
) {
  await writeAudit({ orgId: ctx.orgId, actorId: ctx.userId, action, target, metadata });
}
