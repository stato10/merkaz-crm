import type { Metadata } from "next";
import Link from "next/link";
import { Badge, buttonClass, Card, cx, EmptyState, PageHeader } from "@/components/ui";
import {
  appointmentStatusLabel,
  appointmentStatusTone,
  dayKey,
  formatDay,
  formatTime,
  fullName,
  startOfDay,
} from "@/lib/labels";
import { listAppointments } from "@/lib/queries";
import { requirePermission } from "@/lib/session";
import { setAppointmentStatus } from "./actions";
import { StatusSelect } from "./client";

export const metadata: Metadata = { title: "תורים" };

const DAY = 86400000;

export default async function AppointmentsPage({ searchParams }: PageProps<"/appointments">) {
  const ctx = await requirePermission({ appointment: ["read"] });
  const sp = await searchParams;
  const past = sp.view === "past";
  const today = startOfDay(new Date());
  const rows = await listAppointments(
    ctx.orgId,
    past
      ? { from: new Date(today.getTime() - 90 * DAY), to: today, desc: true }
      : { from: today, to: new Date(today.getTime() + 60 * DAY) },
  );
  const canEdit = ctx.can({ appointment: ["update"] });

  const days = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = dayKey(r.startsAt);
    days.set(k, [...(days.get(k) ?? []), r]);
  }

  return (
    <>
      <PageHeader
        title="תורים"
        description="פגישות ותורים שנקבעו עם לקוחות"
        actions={
          ctx.can({ appointment: ["create"] }) && (
            <Link href="/appointments/new" className={buttonClass()}>
              תור חדש
            </Link>
          )
        }
      />

      <nav aria-label="תצוגה" className="mb-4 flex gap-1">
        {[
          { v: false, label: "קרובים", href: "/appointments" },
          { v: true, label: "עבר", href: "/appointments?view=past" },
        ].map((o) => (
          <Link
            key={o.label}
            href={o.href}
            aria-current={past === o.v ? "page" : undefined}
            className={cx(
              "h-8 rounded-lg px-3 text-sm leading-8",
              past === o.v ? "bg-ink text-bg" : "text-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            {o.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title={past ? "אין תורים מ־90 הימים האחרונים" : "אין תורים קרובים"}
            body={past ? "תורים שהתקיימו יופיעו כאן." : "תור שתקבעו יופיע כאן, מסודר לפי יום."}
            action={
              !past &&
              ctx.can({ appointment: ["create"] }) && (
                <Link href="/appointments/new" className={buttonClass("secondary")}>
                  קביעת תור
                </Link>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid gap-6">
          {[...days.entries()].map(([k, items]) => (
            <section key={k} aria-labelledby={`d-${k}`}>
              <h2 id={`d-${k}`} className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
                {formatDay(items[0].startsAt)}
                <span className="font-normal text-muted">{items.length} תורים</span>
              </h2>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-line">
                  {items.map((a) => {
                    const dim = a.status === "cancelled" || a.status === "no_show";
                    return (
                      <li key={a.id} className="flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5">
                        <div className={cx("ltr w-24 shrink-0 text-sm tabular-nums", dim && "text-muted line-through")}>
                          <span className="font-semibold">{formatTime(a.startsAt)}</span>
                          <span className="text-muted">–{formatTime(a.endsAt)}</span>
                        </div>
                        <Link href={`/appointments/${a.id}`} className="group min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium group-hover:text-accent">
                            {a.title}
                          </span>
                          <span className="block truncate text-xs text-muted">
                            {fullName({ firstName: a.contactFirst, lastName: a.contactLast })}
                            {a.assigneeName && ` · עם ${a.assigneeName}`}
                            {a.location && ` · ${a.location}`}
                          </span>
                        </Link>
                        {canEdit ? (
                          <StatusSelect
                            status={a.status}
                            action={setAppointmentStatus.bind(null, a.id)}
                          />
                        ) : (
                          <Badge tone={appointmentStatusTone[a.status]}>
                            {appointmentStatusLabel[a.status]}
                          </Badge>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
