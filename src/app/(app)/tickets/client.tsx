"use client";

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Button, cx, Field, Input, Select, Textarea } from "@/components/ui";
import {
  ticketPriorities,
  ticketPriorityLabel,
  ticketStatuses,
  ticketStatusLabel,
} from "@/lib/labels";
import type { FormState } from "../contacts/actions";

type Action = (s: FormState, f: FormData) => Promise<FormState>;
type Opt = { id: string; name: string };

export function NewTicketForm({
  action,
  contacts,
  members,
  defaultContactId,
}: {
  action: Action;
  contacts: Opt[];
  members: Opt[];
  defaultContactId?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="איש קשר">
          <Select name="contactId" defaultValue={defaultContactId ?? ""}>
            <option value="">ללא</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="ערוץ">
          <Select name="channel" defaultValue="phone">
            <option value="phone">טלפון</option>
            <option value="email">אימייל</option>
            <option value="whatsapp">וואטסאפ</option>
            <option value="web">אתר</option>
            <option value="manual">אחר</option>
          </Select>
        </Field>
      </div>
      <Field label="נושא">
        <Input name="subject" required maxLength={200} placeholder="למשל: בקשה להזיז תור" />
      </Field>
      <Field label="מה הלקוח ביקש" hint="מה שהלקוח אמר או כתב. זו תהיה ההודעה הראשונה בשיחה.">
        <Textarea name="body" required rows={5} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="דחיפות">
          <Select name="priority" defaultValue="normal">
            {ticketPriorities.map((p) => (
              <option key={p} value={p}>
                {ticketPriorityLabel[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="שיבוץ לנציג">
          <Select name="assigneeId" defaultValue="">
            <option value="">לא שובצה</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button disabled={pending}>{pending ? "פותח…" : "פתיחת פנייה"}</Button>
        {state?.error && <p className="text-sm text-danger" role="alert">{state.error}</p>}
      </div>
    </form>
  );
}

const kinds = [
  { v: "outbound", label: "תגובה ללקוח" },
  { v: "note", label: "הערה פנימית" },
  { v: "inbound", label: "הלקוח כתב" },
] as const;

type DraftFn = () => Promise<{ draft?: string; handedOff?: string; error?: string }>;

export function Composer({ action, draft }: { action: Action; draft?: DraftFn }) {
  const [ai, setAi] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (s, f) => {
    const r = await action(s, f);
    if (r?.ok) setAi(null);
    return r;
  }, undefined);
  const [kind, setKind] = useState<(typeof kinds)[number]["v"]>("outbound");
  const ref = useRef<HTMLFormElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const router = useRouter();
  const [drafting, startDraft] = useTransition();
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);

  const suggest = () =>
    startDraft(async () => {
      setAi(null);
      const r = await draft!();
      if (r.draft && bodyRef.current) {
        setKind("outbound");
        bodyRef.current.value = r.draft;
        bodyRef.current.focus();
        setAi({ tone: "ok", text: "טיוטה מוכנה. עברו עליה, ערכו ושמרו." });
      } else if (r.handedOff) {
        setAi({ tone: "warn", text: `הסוכן העביר את הפנייה לנציג: ${r.handedOff}` });
        router.refresh();
      } else {
        setAi({ tone: "error", text: r.error ?? "משהו השתבש" });
      }
    });
  return (
    <form
      ref={ref}
      action={formAction}
      className={cx(
        "rounded-xl border p-3 transition-colors focus-within:ring-2",
        kind === "note"
          ? "border-warn/50 bg-warn-soft/40 focus-within:border-warn focus-within:ring-warn/25"
          : "border-line bg-surface focus-within:border-accent focus-within:ring-accent/20",
      )}
    >
      <fieldset className="mb-2 flex gap-1">
        <legend className="sr-only">סוג הודעה</legend>
        {kinds.map((k) => (
          <label
            key={k.v}
            className={cx(
              "flex h-8 cursor-pointer items-center rounded-md px-2.5 text-sm",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent",
              kind === k.v ? "bg-surface-2 font-medium text-ink" : "text-muted hover:text-ink",
            )}
          >
            <input
              type="radio"
              name="kind"
              value={k.v}
              checked={kind === k.v}
              onChange={() => setKind(k.v)}
              className="sr-only"
            />
            {k.label}
          </label>
        ))}
      </fieldset>
      <Textarea
        ref={bodyRef}
        name="body"
        required
        rows={kind === "outbound" && ai?.tone === "ok" ? 7 : 3}
        aria-label="תוכן ההודעה"
        className="resize-none border-0 bg-transparent px-1 shadow-none focus:border-0 focus:ring-0"
        placeholder={
          kind === "note"
            ? "רק הצוות רואה הערות פנימיות"
            : kind === "inbound"
              ? "מה הלקוח אמר בטלפון או כתב בערוץ אחר"
              : "כתבו תשובה ללקוח"
        }
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button disabled={pending || drafting}>{pending ? "שומר…" : kind === "outbound" ? "שמירת תגובה" : "הוספה"}</Button>
        {draft && kind === "outbound" && (
          <Button type="button" variant="secondary" onClick={suggest} disabled={drafting || pending} aria-busy={drafting}>
            <Sparkles size={16} strokeWidth={1.8} aria-hidden className={cx(drafting && "animate-pulse")} />
            {drafting ? "הסוכן קורא את הפנייה…" : "טיוטה עם AI"}
          </Button>
        )}
        {ai && (
          <p
            role="status"
            className={cx("text-sm", ai.tone === "error" ? "text-danger" : ai.tone === "warn" ? "text-warn" : "text-muted")}
          >
            {ai.text}
          </p>
        )}
        {kind === "outbound" && !state?.error && !ai && (
          <p className="text-xs text-muted">
            ערוץ שליחה עדיין לא מחובר. התגובה נשמרת בפנייה, ושולחים אותה ללקוח בנפרד.
          </p>
        )}
        {state?.error && <p className="text-sm text-danger" role="alert">{state.error}</p>}
      </div>
    </form>
  );
}

export function TicketProps({
  action,
  defaults,
  members,
  disabled,
}: {
  action: Action;
  defaults: { status: string; priority: string; assigneeId: string | null };
  members: Opt[];
  disabled?: boolean;
}) {
  const [dirty, setDirty] = useState(false);
  const touch = () => setDirty(true);
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (s, f) => {
    const r = await action(s, f);
    if (r?.ok) setDirty(false);
    return r;
  }, undefined);
  return (
    <form action={formAction} className="grid gap-3">
      <fieldset disabled={disabled || pending} className="grid gap-3">
        <Field label="סטטוס">
          <Select name="status" defaultValue={defaults.status} onChange={touch}>
            {ticketStatuses.map((s) => (
              <option key={s} value={s}>
                {ticketStatusLabel[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="דחיפות">
          <Select name="priority" defaultValue={defaults.priority} onChange={touch}>
            {ticketPriorities.map((p) => (
              <option key={p} value={p}>
                {ticketPriorityLabel[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="נציג">
          <Select name="assigneeId" defaultValue={defaults.assigneeId ?? ""} onChange={touch}>
            <option value="">לא שובצה</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
      </fieldset>
      {!disabled && (
        <div className="flex min-h-9 items-center gap-3">
          {dirty && (
            <Button disabled={pending}>{pending ? "שומר…" : "שמירת שינויים"}</Button>
          )}
          <p aria-live="polite" className="text-xs">
            {state?.error ? (
              <span className="text-danger">{state.error}</span>
            ) : state?.ok && !dirty ? (
              <span className="text-ok">נשמר</span>
            ) : null}
          </p>
        </div>
      )}
    </form>
  );
}
