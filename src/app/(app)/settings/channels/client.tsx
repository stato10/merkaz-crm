"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { providersFor } from "@/lib/channels/options";
import { createChannel, type SimState } from "./actions";

type Kind = keyof typeof providersFor;

export function NewChannelForm() {
  const [state, action, pending] = useActionState(createChannel, undefined);
  const [kind, setKind] = useState<Kind>("whatsapp");
  const [provider, setProvider] = useState<string>("sandbox");
  return (
    <form action={action} className="grid gap-4" key={state?.ok ? "done" : "form"}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="סוג ערוץ">
          <Select
            name="kind"
            value={kind}
            onChange={(e) => {
              setKind(e.currentTarget.value as Kind);
              setProvider("sandbox");
            }}
          >
            <option value="whatsapp">WhatsApp</option>
            <option value="email">אימייל</option>
          </Select>
        </Field>
        <Field label="ספק">
          <Select name="provider" value={provider} onChange={(e) => setProvider(e.currentTarget.value)}>
            {providersFor[kind].map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="שם הערוץ">
          <Input name="name" required maxLength={60} placeholder="למשל: שירות לקוחות" />
        </Field>
        {kind === "email" ? (
          <Field label="כתובת השולח" hint="הכתובת שהלקוחות יראו בתשובות">
            <Input name="address" type="email" dir="ltr" required placeholder="support@company.co.il" />
          </Field>
        ) : (
          <Field label="מספר ה-WhatsApp העסקי">
            <Input name="address" type="tel" dir="ltr" required placeholder="+972 52 000 0000" />
          </Field>
        )}
      </div>

      {provider === "postmark" && (
        <Field label="Server Token" hint="ב-Postmark: Servers ← השרת שלכם ← API Tokens">
          <Input name="serverToken" type="password" dir="ltr" autoComplete="off" required />
        </Field>
      )}
      {provider === "meta" && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Phone number ID" hint="ב-Meta: WhatsApp ← API Setup">
            <Input name="phoneNumberId" dir="ltr" inputMode="numeric" required />
          </Field>
          <Field label="אסימון גישה" hint="אסימון קבוע של System User">
            <Input name="accessToken" type="password" dir="ltr" autoComplete="off" required />
          </Field>
          <Field label="App Secret" hint="App settings ← Basic. משמש לאימות ה-webhook">
            <Input name="appSecret" type="password" dir="ltr" autoComplete="off" required />
          </Field>
        </div>
      )}
      {provider === "sandbox" && (
        <p className="text-sm text-muted">
          ערוץ בדיקה עובר דרך אותו מסלול כמו ערוץ אמיתי, אבל שום הודעה לא יוצאת מהמערכת. אפשר לדמות בו הודעות של לקוחות.
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button disabled={pending}>{pending ? "מחבר…" : "חיבור ערוץ"}</Button>
        {state?.error && (
          <p className="text-sm text-danger" role="alert">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}

export function SimulateForm({
  kind,
  action,
}: {
  kind: Kind;
  action: (s: SimState, f: FormData) => Promise<SimState>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="grid gap-3 rounded-lg border border-dashed border-line p-4" key={state?.ticketId ?? "sim"}>
      <p className="text-sm font-medium">דימוי הודעה של לקוח</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={kind === "email" ? "מאת (אימייל)" : "מאת (טלפון)"}>
          <Input
            name="from"
            dir="ltr"
            required
            type={kind === "email" ? "email" : "tel"}
            placeholder={kind === "email" ? "dana@example.co.il" : "052-123-4567"}
          />
        </Field>
        <Field label="שם הלקוח">
          <Input name="name" maxLength={80} placeholder="דנה לוי" />
        </Field>
      </div>
      {kind === "email" && (
        <Field label="נושא" hint="כדי לענות לפנייה קיימת, כללו בנושא את מספרה, למשל [#1001]">
          <Input name="subject" maxLength={200} />
        </Field>
      )}
      <Field label="ההודעה">
        <Textarea name="body" required rows={3} maxLength={4000} />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={pending}>
          {pending ? "שולח…" : "שליחה כלקוח"}
        </Button>
        {state?.ticketId && (
          <Link href={`/tickets/${state.ticketId}`} className="text-sm font-medium text-accent hover:underline">
            לפנייה שנוצרה
          </Link>
        )}
        {state?.error && (
          <p className="text-sm text-danger" role="alert">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}
