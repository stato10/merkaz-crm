import { CalendarClock, Inbox, Mail, MessageSquare, Pencil, Phone, Plus, Users } from "lucide-react";
import Link from "next/link";
import { activityLabel, formatDateTime, timeAgo } from "@/lib/labels";

const icons: Record<string, React.ReactNode> = {
  note: <MessageSquare size={14} />,
  call: <Phone size={14} />,
  email: <Mail size={14} />,
  meeting: <Users size={14} />,
  created: <Plus size={14} />,
  updated: <Pencil size={14} />,
  ticket: <Inbox size={14} />,
  appointment: <CalendarClock size={14} />,
};

type Item = {
  id: string;
  type: string;
  body: string;
  createdAt: Date;
  actorName: string | null;
  contactId: string | null;
  contactFirst: string | null;
  contactLast: string | null;
};

export function Timeline({ items, showContact }: { items: Item[]; showContact?: boolean }) {
  if (!items.length) return <p className="text-sm text-muted">אין עדיין פעילות.</p>;
  return (
    <ol className="grid gap-4">
      {items.map((a) => (
        <li key={a.id} className="flex gap-3">
          <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-muted">
            {icons[a.type] ?? icons.note}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
              <span className="font-medium text-ink">{activityLabel[a.type] ?? a.type}</span>
              {showContact && a.contactId && (
                <Link href={`/contacts/${a.contactId}`} className="hover:text-accent">
                  {`${a.contactFirst ?? ""} ${a.contactLast ?? ""}`.trim()}
                </Link>
              )}
              <span>{a.actorName ?? "מערכת"}</span>
              <time dateTime={a.createdAt.toISOString()} title={formatDateTime(a.createdAt)}>
                {timeAgo(a.createdAt)}
              </time>
            </div>
            <p className="mt-1 text-sm whitespace-pre-wrap">{a.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
