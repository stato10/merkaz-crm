import type { Metadata } from "next";
import Link from "next/link";
import { Avatar, Badge, buttonClass, Card, cx, EmptyState, Input, PageHeader } from "@/components/ui";
import {
  dayKey,
  type DealStatus,
  dealStatuses,
  dealStatusLabel,
  dealStatusTone,
  formatDate,
  formatDateOnly,
  formatMoney,
  fromLocalInput,
  fullName,
} from "@/lib/labels";
import { listDeals, listStages, pipelineSummary } from "@/lib/queries";
import { requirePermission } from "@/lib/session";
import { moveDeal } from "./actions";
import { Board } from "./client";

export const metadata: Metadata = { title: "עסקאות" };

const party = (d: { companyName: string | null; contactFirst: string | null; contactLast: string | null }) =>
  [d.companyName, d.contactFirst ? fullName({ firstName: d.contactFirst, lastName: d.contactLast ?? "" }) : null]
    .filter(Boolean)
    .join(" · ") || null;

export default async function DealsPage({ searchParams }: PageProps<"/deals">) {
  const ctx = await requirePermission({ deal: ["read"] });
  const sp = await searchParams;
  const list = sp.view === "list";
  const mine = sp.mine === "1";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const status: DealStatus = dealStatuses.includes(sp.status as DealStatus) ? (sp.status as DealStatus) : "open";
  const ownerId = mine ? ctx.userId : undefined;
  const today = dayKey(new Date());
  const monthStart = fromLocalInput(`${today.slice(0, 7)}-01T00:00`)!;

  const [stages, deals, sum] = await Promise.all([
    listStages(ctx.orgId),
    listDeals(ctx.orgId, { status: list ? status : "open", ownerId, q: list ? q : undefined }),
    pipelineSummary(ctx.orgId, monthStart, ownerId),
  ]);
  const canCreate = ctx.can({ deal: ["create"] });

  const href = (p: { list?: boolean; mine?: boolean; status?: DealStatus }) => {
    const u = new URLSearchParams();
    if (p.list ?? list) u.set("view", "list");
    if (p.mine ?? mine) u.set("mine", "1");
    const s = p.status ?? status;
    if ((p.list ?? list) && s !== "open") u.set("status", s);
    if ((p.list ?? list) && q) u.set("q", q);
    const qs = u.toString();
    return qs ? `/deals?${qs}` : "/deals";
  };

  const tabClass = (on: boolean) =>
    cx("h-7 rounded px-3 leading-7", on ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-ink");

  return (
    <>
      <PageHeader
        title="עסקאות"
        description="המכירות שבדרך, לפי שלב"
        actions={
          canCreate && (
            <Link href="/deals/new" className={buttonClass()}>
              עסקה חדשה
            </Link>
          )
        }
      />

      <Card className="mb-6 grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:divide-x-reverse">
        <Stat label="צנרת פתוחה" value={formatMoney(sum.openSum)} meta={sum.openCount === 1 ? "עסקה אחת" : `${sum.openCount} עסקאות`} />
        <Stat label="תחזית משוקללת" value={formatMoney(sum.weighted)} meta="סכום × סיכוי השלב" />
        <Stat
          label="נחתמו החודש"
          value={formatMoney(sum.wonSum)}
          meta={`${sum.wonCount} נחתמו · ${sum.lostCount} לא נסגרו`}
          tone="ok"
        />
      </Card>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav aria-label="תצוגה" className="flex rounded border border-line bg-surface p-0.5 text-sm">
          <Link href={href({ list: false })} aria-current={!list ? "page" : undefined} className={tabClass(!list)}>
            לוח
          </Link>
          <Link href={href({ list: true })} aria-current={list ? "page" : undefined} className={tabClass(list)}>
            רשימה
          </Link>
        </nav>
        <nav aria-label="של מי" className="flex rounded border border-line bg-surface p-0.5 text-sm">
          <Link href={href({ mine: false })} aria-current={!mine ? "page" : undefined} className={tabClass(!mine)}>
            כל הצוות
          </Link>
          <Link href={href({ mine: true })} aria-current={mine ? "page" : undefined} className={tabClass(mine)}>
            שלי
          </Link>
        </nav>
        {list && (
          <>
            <nav aria-label="סינון לפי סטטוס" className="flex gap-1 text-sm">
              {dealStatuses.map((s) => (
                <Link
                  key={s}
                  href={href({ status: s })}
                  aria-current={status === s ? "page" : undefined}
                  className={cx(
                    "h-8 rounded px-3 leading-8",
                    status === s ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface hover:text-ink",
                  )}
                >
                  {dealStatusLabel[s]}
                </Link>
              ))}
            </nav>
            <form className="ms-auto w-full sm:w-64" role="search">
              <input type="hidden" name="view" value="list" />
              {mine && <input type="hidden" name="mine" value="1" />}
              {status !== "open" && <input type="hidden" name="status" value={status} />}
              <Input name="q" type="search" defaultValue={q} placeholder="חיפוש עסקה, חברה או איש קשר" aria-label="חיפוש עסקאות" />
            </form>
          </>
        )}
        {!list && (
          <p className="ms-auto hidden text-xs text-muted md:block">גררו כרטיס לשלב אחר, או פתחו עסקה כדי לעדכן אותה</p>
        )}
      </div>

      {!list ? (
        deals.length === 0 && !mine ? (
          <Card>
            <EmptyState
              title="אין עסקאות פתוחות"
              body="עסקה היא מכירה שבדרך: מי הלקוח, כמה היא שווה ובאיזה שלב היא נמצאת."
              action={
                canCreate && (
                  <Link href="/deals/new" className={buttonClass("secondary")}>
                    פתיחת עסקה
                  </Link>
                )
              }
            />
          </Card>
        ) : (
          <Board
            stages={stages.map((s) => ({ id: s.id, name: s.name, probability: s.probability }))}
            deals={deals.map((d) => ({
              id: d.id,
              title: d.title,
              amount: d.amount,
              currency: d.currency,
              stageId: d.stageId,
              expectedClose: d.expectedClose,
              party: party(d),
              ownerName: d.ownerName,
            }))}
            today={today}
            canMove={ctx.can({ deal: ["update"] })}
            move={moveDeal}
          />
        )
      ) : (
        <Card className="overflow-hidden">
          {deals.length === 0 ? (
            <EmptyState
              title={q ? "לא נמצאו עסקאות" : `אין עסקאות ב״${dealStatusLabel[status]}״`}
              body={q ? "נסו חיפוש אחר." : undefined}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-line text-start text-[13px] text-muted">
                    <th className="px-5 py-3 text-start font-normal">עסקה</th>
                    <th className="px-3 py-3 text-start font-normal">{status === "open" ? "שלב" : "סטטוס"}</th>
                    <th className="px-3 py-3 text-end font-normal">סכום</th>
                    <th className="px-3 py-3 text-start font-normal">אחראי</th>
                    <th className="px-5 py-3 text-start font-normal">{status === "open" ? "צפי סגירה" : "נסגרה"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {deals.map((d) => {
                    const late = status === "open" && d.expectedClose !== null && d.expectedClose < today;
                    return (
                      <tr key={d.id} className="h-16 hover:bg-surface-2">
                        <td className="max-w-80 px-5">
                          <Link href={`/deals/${d.id}`} className="block truncate font-medium hover:text-accent">
                            {d.title}
                          </Link>
                          <span className="block truncate text-xs text-muted">{party(d) ?? "—"}</span>
                        </td>
                        <td className="px-3">
                          {status === "open" ? (
                            <span className="text-ink-2">{d.stageName}</span>
                          ) : (
                            <Badge tone={dealStatusTone[d.status]}>{dealStatusLabel[d.status]}</Badge>
                          )}
                        </td>
                        <td className="px-3 text-end font-medium tabular-nums">{formatMoney(d.amount, d.currency)}</td>
                        <td className="px-3">
                          {d.ownerName ? (
                            <span className="flex items-center gap-2">
                              <Avatar name={d.ownerName} size={24} />
                              <span className="truncate text-ink-2">{d.ownerName}</span>
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className={cx("px-5 tabular-nums", late ? "font-medium text-danger" : "text-muted")}>
                          {status === "open"
                            ? d.expectedClose
                              ? formatDateOnly(d.expectedClose)
                              : "—"
                            : d.closedAt
                              ? formatDate(d.closedAt)
                              : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

function Stat({ label, value, meta, tone }: { label: string; value: string; meta: string; tone?: "ok" }) {
  return (
    <div className="px-5 py-4">
      <p className="text-[13px] text-muted">{label}</p>
      <p className={cx("mt-1 text-2xl font-medium tabular-nums", tone === "ok" ? "text-ok" : "text-ink")}>{value}</p>
      <p className="mt-0.5 text-xs text-muted">{meta}</p>
    </div>
  );
}
