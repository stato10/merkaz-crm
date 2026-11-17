import type { Metadata } from "next";
import { Avatar, Badge, Card, PageHeader } from "@/components/ui";
import { roleLabels, type RoleName } from "@/lib/permissions";
import { listMembers } from "@/lib/queries";
import { requirePermission } from "@/lib/session";
import { changeRole } from "./actions";
import { InviteForm, RoleSelect } from "./client";

export const metadata: Metadata = { title: "צוות והרשאות" };

export default async function TeamPage() {
  const ctx = await requirePermission({ member: ["create"] });
  const members = await listMembers(ctx.orgId);
  const canEditRoles = ctx.can({ member: ["update"] });

  return (
    <>
      <PageHeader title="צוות והרשאות" description="מי עובד במערכת ומה מותר לו לעשות" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {members.map((m) => (
              <li key={m.memberId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Avatar name={m.name} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{m.name}</div>
                  <div className="ltr text-start text-xs text-muted">{m.email}</div>
                </div>
                {m.role === "owner" || !canEditRoles || m.userId === ctx.userId ? (
                  <Badge tone={m.role === "owner" ? "accent" : "neutral"}>
                    {roleLabels[m.role as RoleName] ?? m.role}
                  </Badge>
                ) : (
                  <RoleSelect role={m.role} action={changeRole.bind(null, m.memberId)} />
                )}
              </li>
            ))}
          </ul>
        </Card>
        <div className="grid h-fit gap-6">
          <Card className="p-5">
            <h2 className="mb-4 font-semibold">הזמנת חבר צוות</h2>
            <InviteForm />
          </Card>
          <Card className="p-5 text-sm">
            <h2 className="mb-3 font-semibold">מה כל תפקיד יכול</h2>
            <dl className="grid gap-2 text-muted">
              <div><dt className="inline font-medium text-ink">מנהל: </dt><dd className="inline">הכל, כולל צוות והגדרות</dd></div>
              <div><dt className="inline font-medium text-ink">איש מכירות: </dt><dd className="inline">אנשי קשר, חברות ועסקאות</dd></div>
              <div><dt className="inline font-medium text-ink">נציג שירות: </dt><dd className="inline">פניות ואנשי קשר, צפייה בשאר</dd></div>
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
