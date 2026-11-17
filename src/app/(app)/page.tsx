import Link from "next/link";
import { Avatar, Badge, buttonClass, Card, EmptyState, PageHeader } from "@/components/ui";
import { Timeline } from "@/components/timeline";
import {
  contactStatuses,
  contactStatusLabel,
  contactStatusTone,
  fullName,
  timeAgo,
} from "@/lib/labels";
import { contactStatusCounts, listActivities, listContacts } from "@/lib/queries";
import { getCtx } from "@/lib/session";

/** Fill color for each status segment; matches the Badge tones. */
const segmentColor = {
  lead: "bg-info",
  prospect: "bg-warn",
  customer: "bg-ok",
  churned: "bg-muted/40",
} as const;

export default async function Overview() {
  const ctx = await getCtx();
  const canContacts = ctx.can({ contact: ["read"] });
  const [counts, recent, activities] = canContacts
    ? await Promise.all([
        contactStatusCounts(ctx.orgId),
        listContacts(ctx.orgId, { limit: 6 }),
        listActivities(ctx.orgId, {}, 12),
      ])
    : [{}, [], []];
  const c = counts as Partial<Record<(typeof contactStatuses)[number], number>>;
  const total = contactStatuses.reduce((a, s) => a + (c[s] ?? 0), 0);

  return (
    <>
      <PageHeader
        title={`שלום, ${ctx.userName.split(" ")[0]}`}
        description={ctx.orgName}
        actions={
          ctx.can({ contact: ["create"] }) && (
            <Link href="/contacts/new" className={buttonClass()}>
              איש קשר חדש
            </Link>
          )
        }
      />

      {canContacts && (
        <Card className="mb-6 p-5">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 className="font-semibold">מצב אנשי הקשר</h2>
            <span className="text-sm text-muted">
              <span className="font-semibold text-ink">{total.toLocaleString("he-IL")}</span> בסך הכל
            </span>
          </div>
          {total === 0 ? (
            <p className="text-sm text-muted">כשתוסיפו אנשי קשר, תראו כאן את החלוקה לפי שלב.</p>
          ) : (
            <>
              <div
                className="flex h-2.5 gap-0.5 overflow-hidden rounded-full"
                role="img"
                aria-label={contactStatuses.map((s) => `${contactStatusLabel[s]} ${c[s] ?? 0}`).join(", ")}
              >
                {contactStatuses.map((s) =>
                  c[s] ? (
                    <span
                      key={s}
                      className={segmentColor[s]}
                      style={{ width: `${((c[s] ?? 0) / total) * 100}%` }}
                    />
                  ) : null,
                )}
              </div>
              <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                {contactStatuses.map((s) => (
                  <li key={s}>
                    <Link
                      href={`/contacts?status=${s}`}
                      className="group flex items-center gap-2 text-sm"
                    >
                      <span className={`size-2 rounded-full ${segmentColor[s]}`} aria-hidden />
                      <span className="text-muted group-hover:text-ink">{contactStatusLabel[s]}</span>
                      <span className="ms-auto font-medium sm:ms-0">{c[s] ?? 0}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-5 pb-3">
            <h2 className="font-semibold">נוספו לאחרונה</h2>
            <Link href="/contacts" className="text-sm text-muted hover:text-ink">
              לכל אנשי הקשר
            </Link>
          </div>
          {recent.length === 0 ? (
            <EmptyState
              title="עדיין אין אנשי קשר"
              body="איש קשר הוא כל אדם שאתם מוכרים לו או נותנים לו שירות. התחילו מהראשון."
              action={
                ctx.can({ contact: ["create"] }) && (
                  <Link href="/contacts/new" className={buttonClass("secondary")}>
                    הוספת איש קשר
                  </Link>
                )
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/contacts/${p.id}`}
                    className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-2/60"
                  >
                    <Avatar name={fullName(p)} size={30} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{fullName(p)}</span>
                      <span className="block truncate text-xs text-muted">
                        {p.companyName ?? p.email ?? "—"}
                      </span>
                    </span>
                    <Badge tone={contactStatusTone[p.status]}>{contactStatusLabel[p.status]}</Badge>
                    <span className="hidden w-16 text-end text-xs text-muted sm:block">
                      {timeAgo(p.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 font-semibold">פעילות אחרונה</h2>
          <Timeline items={activities} showContact />
        </Card>
      </div>
    </>
  );
}
