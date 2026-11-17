"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { Button, Select, Textarea } from "@/components/ui";
import type { FormState } from "../actions";

export function ActivityComposer({
  action,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={formAction} className="mb-6 grid gap-2">
      <Textarea name="body" required placeholder="מה קרה? סיכום שיחה, פגישה או הערה…" aria-label="תיאור" />
      <div className="flex items-center gap-2">
        <Select name="type" className="w-32" aria-label="סוג">
          <option value="note">הערה</option>
          <option value="call">שיחה</option>
          <option value="email">אימייל</option>
          <option value="meeting">פגישה</option>
        </Select>
        <Button disabled={pending}>{pending ? "שומר…" : "הוספה"}</Button>
        {state?.error && <p className="text-sm text-danger">{state.error}</p>}
      </div>
    </form>
  );
}

export function DeleteButton({ action }: { action: () => Promise<FormState> }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="danger"
      disabled={pending}
      onClick={() => {
        if (confirm("למחוק את איש הקשר? הפעולה לא ניתנת לביטול.")) start(() => void action());
      }}
    >
      מחיקה
    </Button>
  );
}
