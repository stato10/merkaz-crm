import { Download, Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Avatar, Badge, buttonClass, Card, cx, EmptyState, Input, PageHeader } from "@/components/ui";
import {
  type ContactStatus,
  contactStatuses,
  contactStatusLabel,
  contactStatusTone,
  fullName,
  timeAgo,
} from "@/lib/labels";
import { contactStatusCounts, listContacts } from "@/lib/queries";
import { requirePermission } from "@/lib/session";

export const metadata: Metadata = { title: "אנשי קשר" };

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  const ctx = await requirePermission({ contact: ["read"] });
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const status = contactStatuses.includes(sp.status as ContactStatus)
    ? (sp.status as ContactStatus)
    : undefined;

  const [rows, counts] = await Promise.all([
    listContacts(ctx.orgId, { q, status }),
    contactStatusCounts(ctx.orgId),
  ]);
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);

  const tab = (s?: ContactStatus) => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (s) p.set("status", s);
    const qs = p.toString();
    return qs ? `/contacts?${qs}` : "/contacts";
  };

  return (
    <>
      <PageHeader
        title="אנשי קשר"
        description={`${total} אנשי קשר בארגון`}
        actions={
          <>
            <a href={`/contacts/export${status ? `?status=${status}` : ""}`} className={buttonClass("ghost")} download>
              <Download size={16} aria-hidden /> ייצוא
            </a>
            {ctx.can({ contact: ["create"] }) && (
              <>
                <Link href="/contacts/import" className={buttonClass("secondary")}>
                  <Upload size={16} aria-hidden /> ייבוא
                </Link>
                <Link href="/contacts/new" className={buttonClass()}>
                  איש קשר חדש
                </Link>
              </>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav aria-label="סינון לפי סטטוס" className="flex flex-wrap gap-1">
          {[undefined, ...contactStatuses].map((s) => (
            <Link
              key={s ?? "all"}
              href={tab(s)}
              aria-current={status === s ? "page" : undefined}
              className={cx(
                "h-8 rounded-lg px-3 text-sm leading-8",
                status === s ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              {s ? contactStatusLabel[s] : "הכל"}{" "}
              <span className="opacity-60">{s ? (counts[s] ?? 0) : total}</span>
            </Link>
          ))}
        </nav>
        <form className="ms-auto w-full sm:w-72" role="search">
          {status && <input type="hidden" name="status" value={status} />}
          <Input name="q" type="search" defaultValue={q} placeholder="חיפוש שם, אימייל, טלפון, חברה" aria-label="חיפוש" />
        </form>
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            title={q || status ? "לא נמצאו אנשי קשר" : "עדיין אין אנשי קשר"}
            body={q || status ? "נסו חיפוש אחר או הסירו את הסינון." : "הוסיפו את איש הקשר הראשון כדי להתחיל."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-[13px] text-muted">
                <tr>
                  <th className="px-5 py-4 text-start font-normal">שם</th>
                  <th className="hidden px-5 py-4 text-start font-normal sm:table-cell">חברה</th>
                  <th className="hidden px-5 py-4 text-start font-normal md:table-cell">פרטי קשר</th>
                  <th className="px-5 py-4 text-start font-normal">סטטוס</th>
                  <th className="hidden px-5 py-4 text-start font-normal lg:table-cell">אחראי</th>
                  <th className="hidden px-5 py-4 text-start font-normal lg:table-cell">נוסף</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((c) => (
                  <tr key={c.id} className="transition-colors hover:bg-surface-2">
                    <td className="h-16 px-5 py-3">
                      <Link href={`/contacts/${c.id}`} className="flex items-center gap-3 text-[15px] font-medium hover:text-accent">
                        <Avatar name={fullName(c)} size={28} />
                        <span>
                          {fullName(c)}
                          {(c.title || c.companyName) && (
                            <span className="block text-xs font-normal text-muted">
                              <span className="hidden sm:inline">{c.title}</span>
                              <span className="sm:hidden">{c.companyName ?? c.title}</span>
                            </span>
                          )}
                        </span>
                      </Link>
                    </td>
                    <td className="hidden h-16 px-5 py-3 text-muted sm:table-cell">
                      {c.companyId ? (
                        <Link href={`/companies/${c.companyId}`} className="hover:text-ink">
                          {c.companyName}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="hidden h-16 px-5 py-3 text-muted md:table-cell">
                      <span className="ltr block">{c.email ?? ""}</span>
                      <span className="ltr block text-xs">{c.phone ?? ""}</span>
                    </td>
                    <td className="h-16 px-5 py-3">
                      <Badge tone={contactStatusTone[c.status]}>{contactStatusLabel[c.status]}</Badge>
                    </td>
                    <td className="hidden h-16 px-5 py-3 whitespace-nowrap text-muted lg:table-cell">{c.ownerName ?? "—"}</td>
                    <td className="hidden h-16 px-5 py-3 whitespace-nowrap text-muted lg:table-cell">{timeAgo(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
