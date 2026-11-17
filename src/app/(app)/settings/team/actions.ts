"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { audit, ForbiddenError, requirePermission } from "@/lib/session";

export type InviteState = { error?: string; link?: string } | undefined;

const roleEnum = z.enum(["admin", "sales", "agent"]);

export async function inviteMember(_: InviteState, form: FormData): Promise<InviteState> {
  try {
    const ctx = await requirePermission({ invitation: ["create"] });
    const parsed = z
      .object({ email: z.email("אימייל לא תקין"), role: roleEnum })
      .safeParse(Object.fromEntries(form));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const inv = await auth.api.createInvitation({
      headers: await headers(),
      body: { ...parsed.data, organizationId: ctx.orgId, resend: true },
    });
    await audit(ctx, "member.invite", parsed.data.email, { role: parsed.data.role });
    revalidatePath("/settings/team");
    return { link: `/invite/${inv.id}` };
  } catch (e) {
    if (e instanceof ForbiddenError) return { error: e.message };
    const msg = (e as { body?: { message?: string } }).body?.message;
    return { error: msg ?? "לא הצלחנו ליצור הזמנה" };
  }
}

export async function changeRole(memberId: string, role: string) {
  const ctx = await requirePermission({ member: ["update"] });
  const r = roleEnum.parse(role);
  await auth.api.updateMemberRole({
    headers: await headers(),
    body: { memberId, role: r, organizationId: ctx.orgId },
  });
  await audit(ctx, "member.role", memberId, { role: r });
  revalidatePath("/settings/team");
}
