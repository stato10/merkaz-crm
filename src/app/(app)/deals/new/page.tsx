import type { Metadata } from "next";
import { BackLink, Card, PageHeader } from "@/components/ui";
import { companyOptions, contactOptions, listMembers, listStages } from "@/lib/queries";
import { requirePermission } from "@/lib/session";
import { createDeal } from "../actions";
import { DealForm } from "../client";

export const metadata: Metadata = { title: "עסקה חדשה" };

export default async function NewDealPage({ searchParams }: PageProps<"/deals/new">) {
  const ctx = await requirePermission({ deal: ["create"] });
  const sp = await searchParams;
  const [stages, contacts, companies, members] = await Promise.all([
    listStages(ctx.orgId),
    contactOptions(ctx.orgId),
    companyOptions(ctx.orgId),
    listMembers(ctx.orgId),
  ]);
  const pick = (v: unknown, opts: { id: string }[]) =>
    typeof v === "string" && opts.some((o) => o.id === v) ? v : undefined;
  return (
    <>
      <BackLink href="/deals">עסקאות</BackLink>
      <div className="mt-3">
        <PageHeader title="עסקה חדשה" />
      </div>
      <Card className="max-w-2xl p-5">
        <DealForm
          action={createDeal}
          stages={stages}
          contacts={contacts}
          companies={companies}
          members={members.map((m) => ({ id: m.userId, name: m.name }))}
          defaults={{
            contactId: pick(sp.contact, contacts),
            companyId: pick(sp.company, companies),
            ownerId: ctx.userId,
          }}
          submitLabel="פתיחת עסקה"
        />
      </Card>
    </>
  );
}
