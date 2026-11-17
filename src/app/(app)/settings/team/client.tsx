"use client";

import { useActionState, useTransition } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { inviteMember } from "./actions";

const assignable = [
  ["sales", "איש מכירות"],
  ["agent", "נציג שירות"],
  ["admin", "מנהל"],
] as const;

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteMember, undefined);
  const link = state?.link ? new URL(state.link, location.origin).toString() : null;
  return (
    <form action={action} className="grid gap-4">
      <Field label="אימייל">
        <Input name="email" type="email" dir="ltr" required />
      </Field>
      <Field label="תפקיד">
        <Select name="role" defaultValue="sales">
          {assignable.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </Select>
      </Field>
      <Button disabled={pending}>{pending ? "יוצר…" : "יצירת הזמנה"}</Button>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      {link && (
        <div className="grid gap-1.5 rounded-lg bg-accent-soft p-3 text-sm">
          <span>שלחו את הקישור לחבר הצוות:</span>
          <Input readOnly value={link} dir="ltr" onFocus={(e) => e.currentTarget.select()} aria-label="קישור הזמנה" />
        </div>
      )}
    </form>
  );
}

export function RoleSelect({
  role,
  action,
}: {
  role: string;
  action: (role: string) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  return (
    <Select
      className="w-36"
      defaultValue={role}
      disabled={pending}
      aria-label="תפקיד"
      onChange={(e) => {
        const v = e.currentTarget.value;
        start(() => action(v));
      }}
    >
      {assignable.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </Select>
  );
}
