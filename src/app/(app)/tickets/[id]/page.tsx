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
import { aiConfigured } from "@/lib/ai/agent";
import { kindLabel, replyRoute } from "@/lib/channels/service";
import { ActionButton } from "../../deals/client";
import { addMessage, draftReply, resendMessage, updateTicket } from "../actions";
import { Composer, TicketProps } from "../client";

export const metadata: Metadata = { title: "פנייה" };

const kindStyle = {
  inbound: "me-auto bg-accent text-accent-ink [&_.meta]:text-accent-ink/80",
  outbound: "ms-auto border border-line bg-surface",
  note: "mx-auto w-full border border-dashed border-warn/50 bg-warn-soft/60",
} as const;

const deliveryText: Record<string, string> = {
  queued: "בשליחה",
  sent: "נשלח",
  delivered: "נמסר",
  read: "נקרא",
  failed: "לא נשלח",
};

export default async function TicketPage({ params }: PageProps<"/tickets/[id]">) {
  const ctx = await requirePermission({ ticket: ["read"] });
  const { id } = await params;
  const row = await getTicket(ctx.orgId, id);
  if (!row) notFound();
  const t = row.ticket;
  const [messages, members, route] = await Promise.all([
    listTicketMessages(ctx.orgId, id),
    listMembers(ctx.orgId),
    replyRoute(ctx.orgId, t),
  ]);
  // Isolate the address as LTR so "+972…" does not flip inside the Hebrew sentence.
  const LRI = "⁦";
  const PDI = "⁩";
  const to = route ? `${LRI}${route.account.kind === "whatsapp" ? `+${route.to}` : route.to}${PDI}` : null;
  const sendVia = route
    ? {
        text: `התגובה תישלח ב${kindLabel[route.account.kind]} אל ${to}`,
        warn: route.windowClosed
          ? "עברו יותר מ-24 שעות מההודעה האחרונה של הלקוח. WhatsApp ידחה הודעה חופשית, אז כדאי להתקשר או לשלוח אימייל."
          : undefined,
      }
    : undefined;
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
              <li key={m.id} className={cx("max-w-[85%]", m.kind === "note" && "w-full max-w-full")}>
                <div className={cx("mb-2 flex items-baseline gap-2 text-xs text-muted", m.kind === "outbound" && "justify-end")}>
                  <span className="font-medium text-ink">
                    {m.kind === "inbound"
                      ? (contactName ?? "הלקוח")
                      : m.kind === "note"
                        ? `הערה פנימית · ${m.authorName ?? ""}`
                        : (m.authorName ?? "הצוות")}
                  </span>
                  <time dateTime={m.createdAt.toISOString()}>{formatDateTime(m.createdAt)}</time>
                  {m.channel && <span>· {channelLabel[m.channel] ?? m.channel}</span>}
                  {m.kind === "outbound" && m.delivery && (
                    <span className={cx(m.delivery === "failed" ? "font-medium text-danger" : m.delivery === "read" && "text-ok")}>
                      · {deliveryText[m.delivery] ?? m.delivery}
                    </span>
                  )}
                </div>
                <p className={cx("rounded-md px-5 py-4 text-sm leading-relaxed whitespace-pre-wrap", kindStyle[m.kind])}>
                  {m.body}
                </p>
                {m.delivery === "failed" && (
                  <div className="mt-2 flex flex-wrap items-center justify-end gap-2 text-xs">
                    {m.deliveryError && <span className="text-danger">{m.deliveryError}</span>}
                    {canEdit && <ActionButton action={resendMessage.bind(null, id, m.id)} label="שליחה חוזרת" variant="ghost" />}
                  </div>
                )}
              </li>
            ))}
          </ol>
          {canEdit && (
            <Composer
              sendVia={sendVia}
              action={addMessage.bind(null, id)}
              draft={aiConfigured() ? draftReply.bind(null, id) : undefined}
            />
          )}
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
