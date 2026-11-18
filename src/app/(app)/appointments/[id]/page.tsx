import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackLink, Card } from "@/components/ui";
import { formatDay, formatTime, fullName, toLocalInput } from "@/lib/labels";
import { contactOptions, getAppointment, listMembers } from "@/lib/queries";
import { requirePermission } from "@/lib/session";
import { setAppointmentStatus, updateAppointment } from "../actions";
import { AppointmentForm, StatusSelect } from "../client";

export const metadata: Metadata = { title: "תור" };

export default async function AppointmentPage({ params }: PageProps<"/appointments/[id]">) {
  const ctx = await requirePermission({ appointment: ["read"] });
  const { id } = await params;
  const row = await getAppointment(ctx.orgId, id);
  if (!row) notFound();
  const a = row.appt;
  const [contacts, members] = await Promise.all([contactOptions(ctx.orgId), listMembers(ctx.orgId)]);
  const canEdit = ctx.can({ appointment: ["update"] });
  const name = fullName({ firstName: row.contactFirst, lastName: row.contactLast });

  return (
    <>
      <BackLink href="/appointments">תורים</BackLink>
      <div className="mt-3 mb-6 flex flex-wrap items-center gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{a.title}</h1>
          <p className="mt-0.5 text-sm text-muted">
            {formatDay(a.startsAt)} · <span className="ltr inline-block">{formatTime(a.startsAt)}–{formatTime(a.endsAt)}</span> ·{" "}
            <Link href={`/contacts/${a.contactId}`} className="hover:text-ink">
              {name}
            </Link>
          </p>
        </div>
        <StatusSelect
          status={a.status}
          action={setAppointmentStatus.bind(null, id)}
          disabled={!canEdit}
        />
      </div>
      <Card className="max-w-2xl p-5">
        <h2 className="mb-4 font-semibold">{canEdit ? "שינוי מועד ופרטים" : "פרטים"}</h2>
        <AppointmentForm
          action={updateAppointment.bind(null, id)}
          contacts={contacts}
          members={members.map((m) => ({ id: m.userId, name: m.name }))}
          defaults={{
            contactId: a.contactId,
            title: a.title,
            startsAt: toLocalInput(a.startsAt),
            duration: Math.round((a.endsAt.getTime() - a.startsAt.getTime()) / 60000),
            assigneeId: a.assigneeId,
            location: a.location,
            notes: a.notes,
          }}
          submitLabel="שמירה"
          disabled={!canEdit}
        />
      </Card>
    </>
  );
}
