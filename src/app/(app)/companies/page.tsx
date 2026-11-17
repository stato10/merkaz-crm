import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, Input, PageHeader } from "@/components/ui";
import { listCompanies } from "@/lib/queries";
import { requirePermission } from "@/lib/session";
import { saveCompany } from "./actions";
import { CompanyForm } from "./company-form";

export const metadata: Metadata = { title: "חברות" };

export default async function CompaniesPage({ searchParams }: PageProps<"/companies">) {
  const ctx = await requirePermission({ company: ["read"] });
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const rows = await listCompanies(ctx.orgId, q);

  return (
    <>
      <PageHeader title="חברות" description={`${rows.length} חברות`} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          <form role="search" className="mb-4 sm:w-72">
            <Input name="q" type="search" defaultValue={q} placeholder="חיפוש חברה" aria-label="חיפוש" />
          </form>
          <Card className="overflow-hidden">
            {rows.length === 0 ? (
              <EmptyState title={q ? "לא נמצאו חברות" : "עדיין אין חברות"} />
            ) : (
              <ul className="divide-y divide-line">
                {rows.map((c) => (
                  <li key={c.id}>
                    <Link href={`/companies/${c.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-surface-2/50">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-muted">
                          {[c.industry, c.domain].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </div>
                      <span className="text-sm text-muted">{c.contactCount} אנשי קשר</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        {ctx.can({ company: ["create"] }) && (
          <Card className="h-fit p-5">
            <h2 className="mb-4 font-semibold">חברה חדשה</h2>
            <CompanyForm action={saveCompany.bind(null, null)} submitLabel="הוספה" resetOnSave />
          </Card>
        )}
      </div>
    </>
  );
}
