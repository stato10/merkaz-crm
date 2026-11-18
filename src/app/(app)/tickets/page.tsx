import type { Metadata } from "next";
import Link from "next/link";
import { Avatar, Badge, buttonClass, Card, cx, EmptyState, Input, PageHeader } from "@/components/ui";
import {
  channelLabel,
  fullName,
  type TicketStatus,
  ticketPriorityLabel,
  ticketPriorityTone,
  ticketStatuses,
  ticketStatusLabel,
  timeAgo,
} from "@/lib/labels";
import { listTickets, ticketStatusCounts } from "@/lib/queries";
import { requirePermission } from "@/lib/session";

export const metadata: Metadata = { title: "פניות" };

export default async function TicketsPage({ searchParams }: PageProps<"/tickets">) {
  const ctx = await requirePermission({ ticket: ["read"] });
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const mine = sp.mine === "1";
  const status: TicketStatus = ticketStatuses.includes(sp.status as TicketStatus)
    ? (sp.status as TicketStatus)
    : "open";
  const assigneeId = mine ? ctx.userId : undefined;

  const [rows, counts] = await Promise.all([
    listTickets(ctx.orgId, { status, assigneeId, q }),
    ticketStatusCounts(ctx.orgId, assigneeId),
  ]);

  const href = (p: { status?: TicketStatus; mine?: boolean }) => {
    const u = new URLSearchParams();
    const s = p.status ?? status;
    if (s !== "open") u.set("status", s);
    if (p.mine ?? mine) u.set("mine", "1");
    if (q) u.set("q", q);
    const qs = u.toString();
    return qs ? `/tickets?${qs}` : "/tickets";
  };

  return (
    <>
      <PageHeader
        title="פניות"
        description="בקשות של לקוחות שממתינות לטיפול הצוות"
        actions={
          ctx.can({ ticket: ["create"] }) && (
            <Link href="/tickets/new" className={buttonClass()}>
              פנייה חדשה
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav aria-label="סינון לפי סטטוס" className="flex flex-wrap gap-1">
          {ticketStatuses.map((s) => (
            <Link
              key={s}
              href={href({ status: s })}
              aria-current={status === s ? "page" : undefined}
              className={cx(
                "h-8 rounded-lg px-3 text-sm leading-8",
                status === s ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              {ticketStatusLabel[s]} <span className="opacity-60">{counts[s] ?? 0}</span>
            </Link>
          ))}
        </nav>
        <div className="flex rounded-lg border border-line p-0.5 text-sm">
          {[
            { v: false, label: "כל הצוות" },
            { v: true, label: "שלי" },
          ].map((o) => (
            <Link
              key={o.label}
              href={href({ mine: o.v })}
              aria-current={mine === o.v ? "page" : undefined}
              className={cx(
                "h-7 rounded-md px-3 leading-7",
                mine === o.v ? "bg-surface-2 font-medium text-ink" : "text-muted hover:text-ink",
              )}
            >
              {o.label}
            </Link>
          ))}
        </div>
        <form className="ms-auto w-full sm:w-72" role="search">
          {status !== "open" && <input type="hidden" name="status" value={status} />}
          {mine && <input type="hidden" name="mine" value="1" />}
          <Input name="q" type="search" defaultValue={q} placeholder="חיפוש נושא, לקוח או מספר" aria-label="חיפוש פניות" />
        </form>
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            title={q ? "לא נמצאו פניות" : status === "open" ? "אין פניות פתוחות" : `אין פניות ב״${ticketStatusLabel[status]}״`}
            body={
              q
                ? "נסו חיפוש אחר."
                : status === "open"
                  ? "כל הבקשות טופלו. פנייה חדשה תופיע כאן ברגע שתיפתח."
                  : "פניות יעברו לכאן כשהסטטוס שלהן ישתנה."
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((t) => {
              const name = t.contactFirst ? fullName({ firstName: t.contactFirst, lastName: t.contactLast ?? "" }) : "ללא איש קשר";
              return (
                <li key={t.id}>
                  <Link
                    href={`/tickets/${t.id}`}
                    className="flex items-start gap-3 px-4 py-3.5 hover:bg-surface-2/50 sm:px-5"
                  >
                    <Avatar name={name} size={34} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="truncate font-medium">{t.subject}</span>
                        <span className="ltr shrink-0 text-xs text-muted">#{t.number}</span>
                      </div>
                      <p className="mt-0.5 truncate text-sm text-muted">
                        <span className="text-ink/80">{name}</span>
                        {t.preview && <> · {t.preview}</>}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                        {t.priority !== "normal" && (
                          <Badge tone={ticketPriorityTone[t.priority]}>
                            {ticketPriorityLabel[t.priority]}
                          </Badge>
                        )}
                        <span>{channelLabel[t.channel] ?? t.channel}</span>
                        <span aria-hidden>·</span>
                        <span>{t.assigneeName ?? "לא שובצה"}</span>
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-muted">{timeAgo(t.lastMessageAt)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
