import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar, Badge, Card } from "@/components/ui";
import { Timeline } from "@/components/timeline";
import { contactStatusLabel, contactStatusTone, fullName } from "@/lib/labels";
import { companyOptions, getContact, listActivities, listMembers } from "@/lib/queries";
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
  const [activities, companies, members] = await Promise.all([
    listActivities(ctx.orgId, { contactId: id }),
    companyOptions(ctx.orgId),
    listMembers(ctx.orgId),
  ]);
  const canEdit = ctx.can({ contact: ["update"] });

  return (
    <>
      <Link href="/contacts" className="text-sm text-muted hover:text-ink">
        → אנשי קשר
      </Link>
      <div className="mt-3 mb-6 flex flex-wrap items-center gap-4">
        <Avatar name={fullName(c)} size={52} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{fullName(c)}</h1>
          <p className="mt-0.5 text-sm text-muted">
            {[c.title, row.companyName].filter(Boolean).join(" · ") || "ללא חברה"}
          </p>
        </div>
        <Badge tone={contactStatusTone[c.status]}>{contactStatusLabel[c.status]}</Badge>
        {ctx.can({ contact: ["delete"] }) && <DeleteButton action={deleteContact.bind(null, id)} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
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
        <Card className="p-5">
          <h2 className="mb-4 font-semibold">ציר זמן</h2>
          {canEdit && <ActivityComposer action={logActivity.bind(null, id)} />}
          <Timeline items={activities} />
        </Card>
      </div>
    </>
  );
}
