import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar, BackLink, Badge, Card, cx } from "@/components/ui";
import {
  channelLabel,
  contactStatusLabel,
  contactStatusTone,
  formatDateTime,
  fullName,
  ticketPriorityLabel,
  ticketPriorityTone,
  ticketStatusLabel,
  ticketStatusTone,
} from "@/lib/labels";
import { getTicket, listMembers, listTicketMessages } from "@/lib/queries";
import { requirePermission } from "@/lib/session";
import { addMessage, updateTicket } from "../actions";
import { Composer, TicketProps } from "../client";

export const metadata: Metadata = { title: "פנייה" };

const kindStyle = {
  inbound: "me-auto bg-surface-2",
  outbound: "ms-auto bg-accent-soft",
  note: "mx-auto w-full border border-dashed border-warn/50 bg-warn-soft/40",
} as const;

export default async function TicketPage({ params }: PageProps<"/tickets/[id]">) {
  const ctx = await requirePermission({ ticket: ["read"] });
  const { id } = await params;
  const row = await getTicket(ctx.orgId, id);
  if (!row) notFound();
  const t = row.ticket;
  const [messages, members] = await Promise.all([
    listTicketMessages(ctx.orgId, id),
    listMembers(ctx.orgId),
  ]);
  const canEdit = ctx.can({ ticket: ["update"] });
  const contactName = row.contactFirst
    ? fullName({ firstName: row.contactFirst, lastName: row.contactLast ?? "" })
    : null;

  return (
    <>
      <BackLink href="/tickets">פניות</BackLink>
      <div className="mt-3 mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t.subject}</h1>
          <span className="ltr text-lg text-muted">#{t.number}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
          <Badge tone={ticketStatusTone[t.status]}>{ticketStatusLabel[t.status]}</Badge>
          {t.priority !== "normal" && (
            <Badge tone={ticketPriorityTone[t.priority]}>{ticketPriorityLabel[t.priority]}</Badge>
          )}
          <span>נפתחה {formatDateTime(t.createdAt)}</span>
          <span aria-hidden>·</span>
          <span>{channelLabel[t.channel] ?? t.channel}</span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <section aria-label="שיחה" className="grid content-start gap-4">
          <ol className="grid gap-3">
            {messages.map((m) => (
              <li key={m.id} className={cx("max-w-[85%] rounded-xl px-4 py-3", kindStyle[m.kind])}>
                <div className="mb-1 flex items-baseline gap-2 text-xs text-muted">
                  <span className="font-medium text-ink/80">
                    {m.kind === "inbound"
                      ? (contactName ?? "הלקוח")
                      : m.kind === "note"
                        ? `הערה פנימית · ${m.authorName ?? ""}`
                        : (m.authorName ?? "הצוות")}
                  </span>
                  <time dateTime={m.createdAt.toISOString()}>{formatDateTime(m.createdAt)}</time>
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.body}</p>
              </li>
            ))}
          </ol>
          {canEdit && <Composer action={addMessage.bind(null, id)} />}
        </section>

        <aside className="grid content-start gap-4">
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">לקוח</h2>
            {contactName && t.contactId ? (
              <Link href={`/contacts/${t.contactId}`} className="group flex items-center gap-2.5">
                <Avatar name={contactName} size={36} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium group-hover:text-accent">{contactName}</span>
                  {row.contactStatus && (
                    <span className="mt-0.5 block">
                      <Badge tone={contactStatusTone[row.contactStatus]}>
                        {contactStatusLabel[row.contactStatus]}
                      </Badge>
                    </span>
                  )}
                </span>
              </Link>
            ) : (
              <p className="text-sm text-muted">הפנייה לא משויכת לאיש קשר.</p>
            )}
            {(row.contactPhone || row.contactEmail) && (
              <dl className="mt-3 grid gap-1 text-sm">
                {row.contactPhone && (
                  <a href={`tel:${row.contactPhone.replace(/[^\d+]/g, "")}`} className="ltr text-muted hover:text-ink">
                    {row.contactPhone}
                  </a>
                )}
                {row.contactEmail && (
                  <a href={`mailto:${row.contactEmail}`} className="ltr truncate text-muted hover:text-ink">
                    {row.contactEmail}
                  </a>
                )}
              </dl>
            )}
          </Card>
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">טיפול</h2>
            <TicketProps
              key={`${t.status}|${t.priority}|${t.assigneeId}`}
              action={updateTicket.bind(null, id)}
              defaults={{ status: t.status, priority: t.priority, assigneeId: t.assigneeId }}
              members={members.map((m) => ({ id: m.userId, name: m.name }))}
              disabled={!canEdit}
            />
          </Card>
        </aside>
      </div>
    </>
  );
}
