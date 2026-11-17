import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar, Badge, Card } from "@/components/ui";
import { Timeline } from "@/components/timeline";
import { contactStatusLabel, contactStatusTone, fullName } from "@/lib/labels";
import { getCompany, listActivities, listContacts } from "@/lib/queries";
import { requirePermission } from "@/lib/session";
import { saveCompany } from "../actions";
import { CompanyForm } from "../company-form";

export const metadata: Metadata = { title: "חברה" };

export default async function CompanyPage({ params }: PageProps<"/companies/[id]">) {
  const ctx = await requirePermission({ company: ["read"] });
  const { id } = await params;
  const company = await getCompany(ctx.orgId, id);
  if (!company) notFound();
  const [people, activities] = await Promise.all([
    listContacts(ctx.orgId, { companyId: id }),
    listActivities(ctx.orgId, { companyId: id }, 30),
  ]);

  return (
    <>
      <Link href="/companies" className="text-sm text-muted hover:text-ink">→ חברות</Link>
      <h1 className="mt-3 mb-6 text-2xl font-semibold tracking-tight">{company.name}</h1>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="grid gap-6">
          <Card className="p-5">
            <h2 className="mb-4 font-semibold">פרטים</h2>
            <CompanyForm
              action={saveCompany.bind(null, id)}
              defaults={company}
              submitLabel="שמירה"
              disabled={!ctx.can({ company: ["update"] })}
            />
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">אנשי קשר ({people.length})</h2>
            {people.length === 0 ? (
              <p className="text-sm text-muted">אין אנשי קשר משויכים.</p>
            ) : (
              <ul className="divide-y divide-line">
                {people.map((p) => (
                  <li key={p.id}>
                    <Link href={`/contacts/${p.id}`} className="flex items-center gap-3 py-2.5 hover:text-accent">
                      <Avatar name={fullName(p)} size={28} />
                      <span className="flex-1 text-sm font-medium">{fullName(p)}</span>
                      <Badge tone={contactStatusTone[p.status]}>{contactStatusLabel[p.status]}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card className="h-fit p-5">
          <h2 className="mb-4 font-semibold">פעילות</h2>
          <Timeline items={activities} showContact />
        </Card>
      </div>
    </>
  );
}
