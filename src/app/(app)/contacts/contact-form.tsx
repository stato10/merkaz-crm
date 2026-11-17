"use client";

import { useActionState } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { contactStatuses, contactStatusLabel } from "@/lib/labels";
import type { FormState } from "./actions";

type Opt = { id: string; name: string };
type Defaults = {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  source?: string | null;
  status?: string;
  companyId?: string | null;
  ownerId?: string | null;
  tags?: string[];
};

export function ContactForm({
  action,
  companies,
  members,
  defaults = {},
  submitLabel,
  disabled,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  companies: Opt[];
  members: Opt[];
  defaults?: Defaults;
  submitLabel: string;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="grid gap-4">
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
        <Field label="שם פרטי">
          <Input name="firstName" required defaultValue={defaults.firstName} />
        </Field>
        <Field label="שם משפחה">
          <Input name="lastName" defaultValue={defaults.lastName} />
        </Field>
        <Field label="אימייל">
          <Input name="email" type="email" dir="ltr" defaultValue={defaults.email ?? ""} />
        </Field>
        <Field label="טלפון">
          <Input name="phone" type="tel" dir="ltr" defaultValue={defaults.phone ?? ""} />
        </Field>
        <Field label="חברה">
          <Select name="companyId" defaultValue={defaults.companyId ?? ""}>
            <option value="">ללא</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="תפקיד">
          <Input name="title" defaultValue={defaults.title ?? ""} />
        </Field>
        <Field label="סטטוס">
          <Select name="status" defaultValue={defaults.status ?? "lead"}>
            {contactStatuses.map((s) => (
              <option key={s} value={s}>
                {contactStatusLabel[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="אחראי">
          <Select name="ownerId" defaultValue={defaults.ownerId ?? ""}>
            <option value="">אני</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="מקור">
          <Input name="source" placeholder="אתר, הפניה, אירוע…" defaultValue={defaults.source ?? ""} />
        </Field>
        <Field label="תגיות" hint="מופרדות בפסיקים">
          <Input name="tags" defaultValue={defaults.tags?.join(", ") ?? ""} />
        </Field>
      </fieldset>
      <div className="flex items-center gap-3">
        {!disabled && (
          <Button disabled={pending}>{pending ? "שומר…" : submitLabel}</Button>
        )}
        {state?.error && (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        )}
        {state?.ok && (
          <p role="status" className="text-sm text-ok">
            נשמר
          </p>
        )}
      </div>
    </form>
  );
}
