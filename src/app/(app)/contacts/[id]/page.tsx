import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail, Phone, Plus } from "lucide-react";
import { Avatar, BackLink, Badge, buttonClass, Card } from "@/components/ui";
import { Timeline } from "@/components/timeline";
import {
  appointmentStatusLabel,
  appointmentStatusTone,
  contactStatusLabel,
  contactStatusTone,
  formatDay,
  formatTime,
  fullName,
  startOfDay,
  ticketStatusLabel,
  ticketStatusTone,
  timeAgo,
} from "@/lib/labels";
import {
  companyOptions,
  getContact,
  listActivities,
  listAppointments,
  listMembers,
  listTickets,
} from "@/lib/queries";
import { requirePermission } from "@/lib/session";
import { deleteContact, logActivity, updateContact } from "../actions";
import { ContactForm } from "../contact-form";
import { ActivityComposer, DeleteButton } from "./client";

export const metadata: Metadata = { title: "איש קשר" };

export default async function ContactPage({ params }: PageProps<"/contacts/[id]">) {
  const ctx = await requirePermission({ contact: ["read"] });
  const { id } = await params;
  const row = await getContact(ctx.orgId, id);
  if (!row) notFound();
  const c = row.contact;
  const canTickets = ctx.can({ ticket: ["read"] });
  const canAppts = ctx.can({ appointment: ["read"] });
  const [activities, companies, members, tickets, appts] = await Promise.all([
    listActivities(ctx.orgId, { contactId: id }),
    companyOptions(ctx.orgId),
    listMembers(ctx.orgId),
    canTickets ? listTickets(ctx.orgId, { contactId: id, limit: 5 }) : [],
    canAppts ? listAppointments(ctx.orgId, { contactId: id, from: startOfDay(new Date()), limit: 5 }) : [],
  ]);
  const canEdit = ctx.can({ contact: ["update"] });

  return (
    <>
      <BackLink href="/contacts">אנשי קשר</BackLink>
      <div className="mt-3 mb-6 flex flex-wrap items-center gap-4">
        <Avatar name={fullName(c)} size={52} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{fullName(c)}</h1>
          <p className="mt-0.5 text-sm text-muted">
            {[c.title, row.companyName].filter(Boolean).join(" · ") || "ללא חברה"}
          </p>
        </div>
        <Badge tone={contactStatusTone[c.status]}>{contactStatusLabel[c.status]}</Badge>
        {c.email && (
          <a href={`mailto:${c.email}`} className={buttonClass("secondary")}>
            <Mail size={15} aria-hidden /> אימייל
          </a>
        )}
        {c.phone && (
          <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className={buttonClass("secondary")}>
            <Phone size={15} aria-hidden /> חיוג
          </a>
        )}
        {ctx.can({ contact: ["delete"] }) && <DeleteButton action={deleteContact.bind(null, id)} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="grid content-start gap-6">
        {(canTickets || canAppts) && (
          <Card className="p-5">
            <h2 className="mb-3 font-semibold">שירות</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              {canAppts && (
                <section aria-label="תורים קרובים">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm text-muted">תורים קרובים</h3>
                    {ctx.can({ appointment: ["create"] }) && (
                      <Link href={`/appointments/new?contact=${id}`} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
                        <Plus size={14} aria-hidden /> תור
                      </Link>
                    )}
                  </div>
                  {appts.length === 0 ? (
                    <p className="text-sm text-muted">אין תורים קרובים.</p>
                  ) : (
                    <ul className="grid gap-2">
                      {appts.map((a) => (
                        <li key={a.id}>
                          <Link href={`/appointments/${a.id}`} className="block rounded-lg border border-line px-3 py-2 hover:bg-surface-2/60">
                            <span className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium">{a.title}</span>
                              <Badge tone={appointmentStatusTone[a.status]}>{appointmentStatusLabel[a.status]}</Badge>
                            </span>
                            <span className="block text-xs text-muted">
                              {formatDay(a.startsAt)} · {formatTime(a.startsAt)}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
              {canTickets && (
                <section aria-label="פניות">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm text-muted">פניות</h3>
                    {ctx.can({ ticket: ["create"] }) && (
                      <Link href={`/tickets/new?contact=${id}`} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
                        <Plus size={14} aria-hidden /> פנייה
                      </Link>
                    )}
                  </div>
                  {tickets.length === 0 ? (
                    <p className="text-sm text-muted">אין פניות.</p>
                  ) : (
                    <ul className="grid gap-2">
                      {tickets.map((t) => (
                        <li key={t.id}>
                          <Link href={`/tickets/${t.id}`} className="block rounded-lg border border-line px-3 py-2 hover:bg-surface-2/60">
                            <span className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium">{t.subject}</span>
                              <Badge tone={ticketStatusTone[t.status]}>{ticketStatusLabel[t.status]}</Badge>
                            </span>
                            <span className="block text-xs text-muted">
                              <span className="ltr inline-block">#{t.number}</span> · {timeAgo(t.lastMessageAt)}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </div>
          </Card>
        )}
        <Card className="p-5">
          <h2 className="mb-4 font-semibold">פרטים</h2>
          <ContactForm
            action={updateContact.bind(null, id)}
            companies={companies}
            members={members.map((m) => ({ id: m.userId, name: m.name }))}
            defaults={c}
            submitLabel="שמירה"
            disabled={!canEdit}
          />
        </Card>
        </div>
        <Card className="p-5">
          <h2 className="mb-4 font-semibold">ציר זמן</h2>
          {canEdit && <ActivityComposer action={logActivity.bind(null, id)} />}
          <Timeline items={activities} />
        </Card>
      </div>
    </>
  );
}
