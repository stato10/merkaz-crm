"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button, Field, Input } from "@/components/ui";
import type { FormState } from "../contacts/actions";

type D = { name?: string; domain?: string | null; industry?: string | null; phone?: string | null; address?: string | null };

export function CompanyForm({
  action,
  defaults = {},
  submitLabel,
  resetOnSave,
  disabled,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  defaults?: D;
  submitLabel: string;
  resetOnSave?: boolean;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSave) ref.current?.reset();
  }, [state, resetOnSave]);
  return (
    <form ref={ref} action={formAction} className="grid gap-4">
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
        <Field label="שם החברה">
          <Input name="name" required defaultValue={defaults.name} />
        </Field>
        <Field label="תחום">
          <Input name="industry" defaultValue={defaults.industry ?? ""} />
        </Field>
        <Field label="אתר">
          <Input name="domain" dir="ltr" placeholder="example.co.il" defaultValue={defaults.domain ?? ""} />
        </Field>
        <Field label="טלפון">
          <Input name="phone" type="tel" dir="ltr" defaultValue={defaults.phone ?? ""} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="כתובת">
            <Input name="address" defaultValue={defaults.address ?? ""} />
          </Field>
        </div>
      </fieldset>
      <div className="flex items-center gap-3">
        {!disabled && <Button disabled={pending}>{pending ? "שומר…" : submitLabel}</Button>}
        {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        {state?.ok && <p role="status" className="text-sm text-ok">נשמר</p>}
      </div>
    </form>
  );
}
