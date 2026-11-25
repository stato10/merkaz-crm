"use client";

import Link from "next/link";
import { useActionState, useOptimistic, useState, useTransition } from "react";
import { Avatar, Button, cx, Field, Input, Select } from "@/components/ui";
import { formatDateOnly, formatMoney } from "@/lib/labels";
import type { FormState } from "../contacts/actions";

type Opt = { id: string; name: string };
type Stage = { id: string; name: string; probability: number };

/* ---------------- Form ---------------- */

export function DealForm({
  action,
  stages,
  contacts,
  companies,
  members,
  defaults = {},
  submitLabel,
  disabled,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  stages: Stage[];
  contacts: Opt[];
  companies: Opt[];
  members: Opt[];
  defaults?: {
    title?: string;
    amount?: number;
    stageId?: string;
    contactId?: string | null;
    companyId?: string | null;
    ownerId?: string | null;
    expectedClose?: string | null;
  };
  submitLabel: string;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="grid gap-4">
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="שם העסקה">
            <Input name="title" required maxLength={140} defaultValue={defaults.title} placeholder="למשל: חבילת שירות שנתית" />
          </Field>
        </div>
        <Field label="סכום (₪)">
          <Input
            name="amount"
            inputMode="numeric"
            dir="ltr"
            className="text-end tabular-nums"
            defaultValue={defaults.amount ? String(defaults.amount) : ""}
            placeholder="0"
          />
        </Field>
        <Field label="שלב">
          <Select name="stageId" required defaultValue={defaults.stageId ?? stages[0]?.id}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.probability}%
              </option>
            ))}
          </Select>
        </Field>
        <Field label="איש קשר">
          <Select name="contactId" defaultValue={defaults.contactId ?? ""}>
            <option value="">ללא</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="חברה" hint="ריק: החברה של איש הקשר.">
          <Select name="companyId" defaultValue={defaults.companyId ?? ""}>
            <option value="">ללא</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="אחראי">
          <Select name="ownerId" defaultValue={defaults.ownerId ?? ""}>
            <option value="">ללא</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="צפי סגירה">
          <Input name="expectedClose" type="date" defaultValue={defaults.expectedClose ?? ""} />
        </Field>
      </fieldset>
      {!disabled && (
        <div className="flex items-center gap-3">
          <Button disabled={pending}>{pending ? "שומר…" : submitLabel}</Button>
          {state?.error && (
            <p role="alert" className="text-sm text-danger">
              {state.error}
            </p>
          )}
          {state?.ok && <p role="status" className="text-sm text-ok">נשמר</p>}
        </div>
      )}
    </form>
  );
}

/* ---------------- Board ---------------- */

export type BoardDeal = {
  id: string;
  title: string;
  amount: number;
  currency: string;
  stageId: string;
  expectedClose: string | null;
  party: string | null;
  ownerName: string | null;
};

export function Board({
  stages,
  deals,
  today,
  canMove,
  move,
}: {
  stages: Stage[];
  deals: BoardDeal[];
  today: string;
  canMove: boolean;
  move: (id: string, stageId: string) => Promise<FormState>;
}) {
  const [optimistic, apply] = useOptimistic(deals, (list, m: { id: string; stageId: string }) =>
    list.map((d) => (d.id === m.id ? { ...d, stageId: m.stageId } : d)),
  );
  const [, start] = useTransition();
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const drop = (stageId: string, id: string) => {
    const d = optimistic.find((x) => x.id === id);
    if (!d || d.stageId === stageId) return;
    setError(null);
    start(async () => {
      apply({ id, stageId });
      const r = await move(id, stageId);
      if (r?.error) setError(r.error);
    });
  };

  return (
    <>
      {error && (
        <p role="alert" className="mb-3 rounded bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="-mx-4 overflow-x-auto px-4 pb-4 md:-mx-9 md:px-9">
        <ol className="flex min-w-max gap-4" aria-label="שלבי המכירה">
          {stages.map((s) => {
            const items = optimistic.filter((d) => d.stageId === s.id);
            const sum = items.reduce((a, d) => a + d.amount, 0);
            return (
              <li
                key={s.id}
                aria-labelledby={`st-${s.id}`}
                className={cx(
                  "flex w-72 shrink-0 flex-col rounded-md transition-colors",
                  over === s.id && dragging ? "bg-accent-soft ring-2 ring-brand/40" : "bg-surface-2/0",
                )}
                onDragOver={(e) => {
                  if (!canMove || !dragging) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (over !== s.id) setOver(s.id);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  const id = e.dataTransfer.getData("text/x-deal");
                  if (id) drop(s.id, id);
                }}
              >
                <div className="border-t-[3px] border-brand/70 px-1 pt-3 pb-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <h2 id={`st-${s.id}`} className="truncate text-sm font-medium text-ink">
                      {s.name}
                    </h2>
                    <span className="shrink-0 text-xs text-muted tabular-nums">{s.probability}%</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    <span className="font-medium text-ink-2 tabular-nums">{formatMoney(sum)}</span>
                    {" · "}
                    {items.length === 1 ? "עסקה אחת" : `${items.length} עסקאות`}
                  </p>
                </div>
                <ul className="grid min-h-24 content-start gap-2.5 px-1 pb-2">
                  {items.map((d) => {
                    const late = d.expectedClose !== null && d.expectedClose < today;
                    return (
                      <li
                        key={d.id}
                        draggable={canMove}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/x-deal", d.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDragging(d.id);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                        className={cx(
                          "rounded-md bg-surface shadow-card transition-opacity",
                          canMove && "cursor-grab active:cursor-grabbing",
                          dragging === d.id && "opacity-50",
                        )}
                      >
                        <Link href={`/deals/${d.id}`} draggable={false} className="group block p-3.5">
                          <span className="block text-sm font-medium leading-snug text-ink group-hover:text-accent">
                            {d.title}
                          </span>
                          {d.party && <span className="mt-0.5 block truncate text-xs text-muted">{d.party}</span>}
                          <span className="mt-3 flex items-center gap-2">
                            <span className="text-sm font-semibold text-ink tabular-nums">
                              {formatMoney(d.amount, d.currency)}
                            </span>
                            {d.expectedClose && (
                              <span
                                className={cx("ms-auto text-xs tabular-nums", late ? "font-medium text-danger" : "text-muted")}
                                title={late ? "עבר מועד הצפי לסגירה" : "צפי סגירה"}
                              >
                                {formatDateOnly(d.expectedClose)}
                              </span>
                            )}
                            {d.ownerName && (
                              <span className={cx(!d.expectedClose && "ms-auto")} title={d.ownerName}>
                                <Avatar name={d.ownerName} size={22} />
                              </span>
                            )}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                  {items.length === 0 && (
                    <li className="grid h-20 place-items-center rounded-md border border-dashed border-line text-xs text-muted">
                      {canMove ? "גררו עסקה לכאן" : "אין עסקאות"}
                    </li>
                  )}
                </ul>
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}

/* ---------------- Deal page ---------------- */

/** Clickable stage steps. Moves the deal on click; read-only when the deal is closed. */
export function StageBar({
  stages,
  current,
  disabled,
  move,
}: {
  stages: Stage[];
  current: string;
  disabled?: boolean;
  move: (stageId: string) => Promise<FormState>;
}) {
  const [optimistic, set] = useOptimistic(current);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const idx = stages.findIndex((s) => s.id === optimistic);
  return (
    <div>
      <ol className="flex gap-1" aria-label="שלב העסקה" aria-busy={pending}>
        {stages.map((s, i) => {
          const done = i < idx;
          const here = i === idx;
          return (
            <li key={s.id} className="min-w-0 flex-1">
              <button
                type="button"
                disabled={disabled || here}
                aria-current={here ? "step" : undefined}
                title={`${s.name} · ${s.probability}%`}
                onClick={() => {
                  setError(null);
                  start(async () => {
                    set(s.id);
                    const r = await move(s.id);
                    if (r?.error) setError(r.error);
                  });
                }}
                className={cx(
                  "block h-9 w-full truncate rounded-sm px-2 text-xs font-medium transition-colors",
                  here && "bg-accent text-accent-ink",
                  done && "bg-accent-soft text-accent",
                  !here && !done && "bg-surface-2 text-muted",
                  !disabled && !here && "hover:bg-accent-soft hover:text-accent",
                  disabled && !here && "cursor-default",
                )}
              >
                {s.name}
              </button>
            </li>
          );
        })}
      </ol>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function CloseDeal({ action }: { action: (s: FormState, f: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [losing, setLosing] = useState(false);
  if (losing) {
    return (
      <form action={formAction} className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
        <input type="hidden" name="outcome" value="lost" />
        <label className="grid min-w-56 flex-1 gap-1 text-sm">
          <span className="font-medium">למה העסקה לא נסגרה?</span>
          <Input name="reason" required maxLength={300} autoFocus placeholder="מחיר, תזמון, הלך למתחרה…" />
        </label>
        <Button variant="danger" disabled={pending}>
          {pending ? "שומר…" : "סימון כלא נסגרה"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setLosing(false)}>
          ביטול
        </Button>
        {state?.error && (
          <p role="alert" className="w-full text-sm text-danger">
            {state.error}
          </p>
        )}
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={formAction}>
        <input type="hidden" name="outcome" value="won" />
        <Button disabled={pending}>{pending ? "שומר…" : "נחתמה"}</Button>
      </form>
      <Button variant="secondary" onClick={() => setLosing(true)}>
        לא נסגרה
      </Button>
      {state?.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
    </div>
  );
}

export function ActionButton({
  action,
  label,
  confirmText,
  variant = "secondary",
}: {
  action: () => Promise<FormState>;
  label: string;
  confirmText?: string;
  variant?: "secondary" | "danger" | "ghost";
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant={variant}
        disabled={pending}
        onClick={() => {
          if (confirmText && !confirm(confirmText)) return;
          start(async () => {
            const r = await action();
            if (r?.error) setError(r.error);
          });
        }}
      >
        {label}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}
