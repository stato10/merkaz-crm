import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { companyOptions, listMembers } from "@/lib/queries";
import { requirePermission } from "@/lib/session";
import { createContact } from "../actions";
import { ContactForm } from "../contact-form";

export const metadata: Metadata = { title: "איש קשר חדש" };

export default async function NewContactPage() {
  const ctx = await requirePermission({ contact: ["create"] });
  const [companies, members] = await Promise.all([companyOptions(ctx.orgId), listMembers(ctx.orgId)]);
  return (
    <>
      <PageHeader title="איש קשר חדש" />
      <Card className="max-w-3xl p-6">
        <ContactForm
          action={createContact}
          companies={companies}
          members={members.map((m) => ({ id: m.userId, name: m.name }))}
          submitLabel="יצירה"
        />
      </Card>
    </>
  );
}
