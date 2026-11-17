import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { Timeline } from "@/components/timeline";
import { contactStatuses, contactStatusLabel } from "@/lib/labels";
import { contactStatusCounts, listActivities, listCompanies } from "@/lib/queries";
import { getCtx } from "@/lib/session";

export default async function Overview() {
  const ctx = await getCtx();
  const canContacts = ctx.can({ contact: ["read"] });
  const [counts, companies, activities] = await Promise.all([
    canContacts ? contactStatusCounts(ctx.orgId) : {},
    ctx.can({ company: ["read"] }) ? listCompanies(ctx.orgId) : [],
    canContacts ? listActivities(ctx.orgId, {}, 15) : [],
  ]);
  const c = counts as Partial<Record<(typeof contactStatuses)[number], number>>;
  const total = contactStatuses.reduce((a, s) => a + (c[s] ?? 0), 0);

  return (
    <>
      <PageHeader title={`שלום, ${ctx.userName.split(" ")[0]}`} description={ctx.orgName} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="אנשי קשר" value={total} href="/contacts" />
        {contactStatuses.slice(0, 3).map((s) => (
          <Stat key={s} label={contactStatusLabel[s]} value={c[s] ?? 0} href={`/contacts?status=${s}`} />
        ))}
        <Stat label="חברות" value={companies.length} href="/companies" />
      </div>
      <Card className="p-5">
        <h2 className="mb-4 font-semibold">פעילות אחרונה</h2>
        <Timeline items={activities} showContact />
      </Card>
    </>
  );
}

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href}>
      <Card className="p-4 transition-colors hover:border-accent/40">
        <div className="text-sm text-muted">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString("he-IL")}</div>
      </Card>
    </Link>
  );
}
