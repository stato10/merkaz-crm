import { Plus } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { type DealStatus, dealStatusLabel, dealStatusTone, formatMoney } from "@/lib/labels";

type Item = { id: string; title: string; amount: number; currency: string; status: DealStatus; stageName: string };

/** Compact deal list for contact and company pages. */
export function DealList({ items, newHref }: { items: Item[]; newHref?: string }) {
  const open = items.filter((d) => d.status === "open").reduce((a, d) => a + d.amount, 0);
  return (
    <section aria-label="עסקאות">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">
          עסקאות{" "}
          {open > 0 && <span className="text-sm font-normal text-muted tabular-nums">· {formatMoney(open)} פתוחות</span>}
        </h2>
        {newHref && (
          <Link href={newHref} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
            <Plus size={14} aria-hidden /> עסקה
          </Link>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted">אין עסקאות.</p>
      ) : (
        <ul className="grid gap-2">
          {items.map((d) => (
            <li key={d.id}>
              <Link href={`/deals/${d.id}`} className="flex items-center gap-3 rounded border border-line px-3 py-2 hover:bg-surface-2/60">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{d.title}</span>
                  <span className="block text-xs text-muted">{d.status === "open" ? d.stageName : dealStatusLabel[d.status]}</span>
                </span>
                <span className="text-sm font-medium tabular-nums">{formatMoney(d.amount, d.currency)}</span>
                {d.status !== "open" && <Badge tone={dealStatusTone[d.status]}>{dealStatusLabel[d.status]}</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
