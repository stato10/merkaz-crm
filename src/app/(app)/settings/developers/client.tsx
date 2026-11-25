"use client";

import { Check, Copy } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { createApiKey, createWebhook } from "./actions";

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <Input readOnly value={value} dir="ltr" aria-label={label} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      <Button
        type="button"
        variant="secondary"
        className="w-10 shrink-0 px-0"
        aria-label={copied ? "הועתק" : `העתקת ${label}`}
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </Button>
    </div>
  );
}

export function NewKeyForm() {
  const [state, action, pending] = useActionState(createApiKey, undefined);
  return (
    <form action={action} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
        <Field label="שם המפתח">
          <Input name="name" placeholder="למשל: טופס לידים באתר" required maxLength={60} />
        </Field>
        <Field label="הרשאה">
          <Select name="role" defaultValue="sales">
            <option value="admin">מלאה</option>
            <option value="sales">מכירות</option>
            <option value="agent">שירות</option>
          </Select>
        </Field>
        <Button disabled={pending}>{pending ? "יוצר…" : "יצירת מפתח"}</Button>
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {state?.token && (
        <div className="grid gap-2 rounded-lg border border-warn/40 bg-warn-soft p-3 text-sm">
          <p className="font-medium text-ink">העתיקו את המפתח עכשיו. מטעמי אבטחה הוא לא יוצג שוב.</p>
          <CopyField value={state.token} label="מפתח API" />
        </div>
      )}
    </form>
  );
}

export function NewWebhookForm({ events }: { events: string[] }) {
  const [state, action, pending] = useActionState(createWebhook, undefined);
  const [all, setAll] = useState(true);
  return (
    <form action={action} className="grid gap-4" key={state?.ok ? "done" : "form"}>
      <Field label="כתובת שתקבל את האירועים" hint="בקשת POST חתומה תישלח לכתובת הזו בכל אירוע">
        <Input name="url" type="url" dir="ltr" placeholder="https://example.com/hooks/crm" required />
      </Field>
      <fieldset className="grid gap-2 text-sm">
        <legend className="mb-1.5 font-medium text-ink">אירועים</legend>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="all" checked={all} onChange={(e) => setAll(e.currentTarget.checked)} className="size-4 accent-[var(--color-accent)]" />
          כל האירועים, כולל חדשים שיתווספו
        </label>
        {!all && (
          <div className="grid gap-1.5 ps-6 sm:grid-cols-2" dir="ltr">
            {events.map((e) => (
              <label key={e} className="flex items-center gap-2 font-mono text-xs">
                <input type="checkbox" name="events" value={e} className="size-4 accent-[var(--color-accent)]" />
                {e}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <div>
        <Button disabled={pending}>{pending ? "שומר…" : "הוספת כתובת"}</Button>
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
    </form>
  );
}

export function ToggleSwitch({ on, action, label }: { on: boolean; action: (v: boolean) => Promise<unknown>; label: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={pending}
      onClick={() => start(async () => void (await action(!on)))}
      className="group relative h-6 w-10 shrink-0 rounded-full bg-line transition-colors aria-checked:bg-accent disabled:opacity-50"
    >
      <span className="absolute top-0.5 start-0.5 size-5 rounded-full bg-surface shadow-card transition-transform group-aria-checked:translate-x-4 rtl:group-aria-checked:-translate-x-4" />
    </button>
  );
}

export function RevealSecret({ secret }: { secret: string }) {
  const [shown, setShown] = useState(false);
  if (!shown) {
    return (
      <button type="button" className="text-xs text-accent hover:underline" onClick={() => setShown(true)}>
        הצגת סוד החתימה
      </button>
    );
  }
  return <CopyField value={secret} label="סוד החתימה" />;
}
