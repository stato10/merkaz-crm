import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar, BackLink, Badge, Card } from "@/components/ui";
import { Timeline } from "@/components/timeline";
import {
  contactStatusLabel,
  contactStatusTone,
  dealStatusLabel,
  dealStatusTone,
  formatDate,
  formatDateOnly,
  formatMoney,
  fullName,
} from "@/lib/labels";
import {
  companyOptions,
  contactOptions,
  getDeal,
  listActivities,
  listMembers,
  listStages,
} from "@/lib/queries";
import { requirePermission } from "@/lib/session";
import { ActivityComposer } from "../../contacts/[id]/client";
import { closeDeal, deleteDeal, logDealActivity, moveDeal, reopenDeal, updateDeal } from "../actions";
import { ActionButton, CloseDeal, DealForm, StageBar } from "../client";

export const metadata: Metadata = { title: "עסקה" };

function daysIn(since: Date) {
  const n = Math.floor((Date.now() - since.getTime()) / 86400000);
  return n === 0 ? "נכנסה היום" : n === 1 ? "יום אחד בשלב" : `${n} ימים בשלב`;
}

export default async function DealPage({ params }: PageProps<"/deals/[id]">) {
  const ctx = await requirePermission({ deal: ["read"] });
  const { id } = await params;
  const row = await getDeal(ctx.orgId, id);
  if (!row) notFound();
  const d = row.deal;
  const [stages, activities, contacts, companies, members] = await Promise.all([
    listStages(ctx.orgId),
    listActivities(ctx.orgId, { dealId: id }),
    contactOptions(ctx.orgId),
    companyOptions(ctx.orgId),
    listMembers(ctx.orgId),
  ]);
  const canEdit = ctx.can({ deal: ["update"] });
  const open = d.status === "open";
  const stage = stages.find((s) => s.id === d.stageId);
  const contactName = row.contactFirst ? fullName({ firstName: row.contactFirst, lastName: row.contactLast ?? "" }) : null;

  return (
    <>
      <BackLink href="/deals">עסקאות</BackLink>
      <div className="mt-3 mb-5 flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-medium text-ink">{d.title}</h1>
            <Badge tone={dealStatusTone[d.status]}>{dealStatusLabel[d.status]}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">
            {[row.companyName, contactName].filter(Boolean).join(" · ") || "ללא לקוח משויך"}
          </p>
        </div>
        <div className="text-end">
          <p className="text-[28px] leading-none font-medium text-ink tabular-nums">{formatMoney(d.amount, d.currency)}</p>
          {open && stage && (
            <p className="mt-1.5 text-xs text-muted tabular-nums">
              משוקלל {formatMoney(Math.round((d.amount * stage.probability) / 100), d.currency)} · סיכוי {stage.probability}%
            </p>
          )}
        </div>
      </div>

      <Card className="mb-6 grid gap-4 p-5">
        {open ? (
          <>
            <StageBar
              stages={stages.map((s) => ({ id: s.id, name: s.name, probability: s.probability }))}
              current={d.stageId}
              disabled={!canEdit}
              move={moveDeal.bind(null, id)}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted">
                בשלב <span className="font-medium text-ink">{row.stageName}</span> · {daysIn(d.stageChangedAt)}
                {d.expectedClose && <> · צפי סגירה {formatDateOnly(d.expectedClose)}</>}
              </p>
              {canEdit && <CloseDeal action={closeDeal.bind(null, id)} />}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">
                {d.status === "won" ? "העסקה נחתמה" : "העסקה לא נסגרה"}
                {d.closedAt && <span className="font-normal text-muted"> · {formatDate(d.closedAt)}</span>}
              </p>
              {d.lostReason && <p className="mt-0.5 text-sm text-muted">סיבה: {d.lostReason}</p>}
              <p className="mt-0.5 text-sm text-muted">שלב אחרון: {row.stageName}</p>
            </div>
            {canEdit && <ActionButton action={reopenDeal.bind(null, id)} label="פתיחה מחדש" />}
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="grid content-start gap-6">
          {contactName && d.contactId && (
            <Card className="p-5">
              <h2 className="mb-3 font-semibold">לקוח</h2>
              <Link href={`/contacts/${d.contactId}`} className="group flex items-center gap-3">
                <Avatar name={contactName} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium group-hover:text-accent">{contactName}</span>
                  <span className="block truncate text-xs text-muted ltr text-start">
                    {row.contactPhone ?? row.contactEmail ?? ""}
                  </span>
                </span>
                {row.contactStatus && (
                  <Badge tone={contactStatusTone[row.contactStatus]}>{contactStatusLabel[row.contactStatus]}</Badge>
                )}
              </Link>
            </Card>
          )}
          <Card className="p-5">
            <h2 className="mb-4 font-semibold">פרטים</h2>
            <DealForm
              key={d.updatedAt.toISOString()}
              action={updateDeal.bind(null, id)}
              stages={stages}
              contacts={contacts}
              companies={companies}
              members={members.map((m) => ({ id: m.userId, name: m.name }))}
              defaults={d}
              submitLabel="שמירה"
              disabled={!canEdit}
            />
          </Card>
          {ctx.can({ deal: ["delete"] }) && (
            <div>
              <ActionButton
                action={deleteDeal.bind(null, id)}
                label="מחיקת העסקה"
                variant="danger"
                confirmText="למחוק את העסקה? הפעולה לא ניתנת לביטול."
              />
            </div>
          )}
        </div>
        <Card className="h-fit p-5">
          <h2 className="mb-4 font-semibold">ציר זמן</h2>
          {canEdit && <ActivityComposer action={logDealActivity.bind(null, id)} />}
          <Timeline items={activities} />
        </Card>
      </div>
    </>
  );
}
