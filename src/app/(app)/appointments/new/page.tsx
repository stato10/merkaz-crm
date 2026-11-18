import type { Metadata } from "next";
import { BackLink, Card, PageHeader } from "@/components/ui";
import { fromLocalInput, toLocalInput } from "@/lib/labels";
import { contactOptions, listMembers } from "@/lib/queries";
import { requirePermission } from "@/lib/session";
import { createAppointment } from "../actions";
import { AppointmentForm } from "../client";

export const metadata: Metadata = { title: "תור חדש" };

/** Next round hour in the business zone, as a datetime-local value. */
function nextHour() {
  const s = toLocalInput(new Date(Date.now() + 3600000));
  return toLocalInput(fromLocalInput(`${s.slice(0, 13)}:00`)!);
}

export default async function NewAppointmentPage({ searchParams }: PageProps<"/appointments/new">) {
  const ctx = await requirePermission({ appointment: ["create"] });
  const sp = await searchParams;
  const [contacts, members] = await Promise.all([contactOptions(ctx.orgId), listMembers(ctx.orgId)]);
  const contact =
    typeof sp.contact === "string" && contacts.some((c) => c.id === sp.contact) ? sp.contact : undefined;
  return (
    <>
      <BackLink href="/appointments">תורים</BackLink>
      <div className="mt-3">
        <PageHeader title="תור חדש" />
      </div>
      <Card className="max-w-2xl p-5">
        <AppointmentForm
          action={createAppointment}
          contacts={contacts}
          members={members.map((m) => ({ id: m.userId, name: m.name }))}
          defaults={{ contactId: contact, startsAt: nextHour(), assigneeId: ctx.userId }}
          submitLabel="קביעת תור"
        />
      </Card>
    </>
  );
}
