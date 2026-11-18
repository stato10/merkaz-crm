import type { Metadata } from "next";
import { BackLink, Card, PageHeader } from "@/components/ui";
import { contactOptions, listMembers } from "@/lib/queries";
import { requirePermission } from "@/lib/session";
import { createTicket } from "../actions";
import { NewTicketForm } from "../client";

export const metadata: Metadata = { title: "פנייה חדשה" };

export default async function NewTicketPage({ searchParams }: PageProps<"/tickets/new">) {
  const ctx = await requirePermission({ ticket: ["create"] });
  const sp = await searchParams;
  const [contacts, members] = await Promise.all([contactOptions(ctx.orgId), listMembers(ctx.orgId)]);
  const contact = typeof sp.contact === "string" && contacts.some((c) => c.id === sp.contact) ? sp.contact : undefined;
  return (
    <>
      <BackLink href="/tickets">פניות</BackLink>
      <div className="mt-3">
        <PageHeader title="פנייה חדשה" description="תיעוד בקשה של לקוח שהגיעה בטלפון, באימייל או בכל ערוץ אחר" />
      </div>
      <Card className="max-w-2xl p-5">
        <NewTicketForm
          action={createTicket}
          contacts={contacts}
          members={members.map((m) => ({ id: m.userId, name: m.name }))}
          defaultContactId={contact}
        />
      </Card>
    </>
  );
}
