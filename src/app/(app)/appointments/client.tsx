"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Button, cx, Field, Input, Select, Textarea } from "@/components/ui";
import {
  type AppointmentStatus,
  appointmentStatuses,
  appointmentStatusLabel,
} from "@/lib/labels";
import type { FormState } from "../contacts/actions";

type Opt = { id: string; name: string };

const durations = [15, 30, 45, 60, 90, 120];

export function AppointmentForm({
  action,
  contacts,
  members,
  defaults = {},
  submitLabel,
  disabled,
}: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  contacts: Opt[];
  members: Opt[];
  defaults?: {
    contactId?: string;
    title?: string;
    startsAt?: string;
    duration?: number;
    assigneeId?: string | null;
    location?: string | null;
    notes?: string | null;
  };
  submitLabel: string;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const duration = defaults.duration ?? 30;
  return (
    <form action={formAction} className="grid gap-4">
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
        <Field label="איש קשר">
          <Select
            name="contactId"
            required
            defaultValue={defaults.contactId ?? ""}
          >
            <option value="" disabled>
              בחרו איש קשר
            </option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="תיאור">
          <Input
            name="title"
            required
            maxLength={120}
            defaultValue={defaults.title}
            placeholder="למשל: פגישת ייעוץ"
          />
        </Field>
        <Field label="מועד">
          <Input
            name="startsAt"
            type="datetime-local"
            required
            step={300}
            defaultValue={defaults.startsAt}
          />
        </Field>
        <Field label="משך">
          <Select name="duration" defaultValue={String(duration)}>
            {[...new Set([...durations, duration])]
              .sort((a, b) => a - b)
              .map((d) => (
                <option key={d} value={d}>
                  {d < 60
                    ? `${d} דקות`
                    : d === 60
                      ? "שעה"
                      : d === 120
                        ? "שעתיים"
                        : `${d / 60} שעות`}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="איש צוות" hint="המערכת מונעת שני תורים חופפים לאותו אדם.">
          <Select name="assigneeId" defaultValue={defaults.assigneeId ?? ""}>
            <option value="">ללא</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="מיקום">
          <Input
            name="location"
            maxLength={200}
            defaultValue={defaults.location ?? ""}
            placeholder="כתובת, חדר או קישור לשיחה"
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="הערות">
            <Textarea
              name="notes"
              rows={3}
              defaultValue={defaults.notes ?? ""}
            />
          </Field>
        </div>
      </fieldset>
      {!disabled && (
        <div className="flex items-center gap-3">
          <Button disabled={pending}>{pending ? "שומר…" : submitLabel}</Button>
          {state?.error && (
            <p className="text-sm text-danger" role="alert">
              {state.error}
            </p>
          )}
          {state?.ok && <p className="text-sm text-ok">נשמר</p>}
        </div>
      )}
    </form>
  );
}

/**
 * Saves the status after the choice settles, so stepping through options
 * with the keyboard commits only the final one. Reverts and explains on failure.
 */
export function StatusSelect({
  status,
  action,
  disabled,
}: {
  status: AppointmentStatus;
  action: (s: string) => Promise<FormState>;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<string>(status);
  const [saved, setSaved] = useState<string>(status);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const commit = (v: string) => {
    if (v === saved) return;
    start(async () => {
      const r = await action(v);
      if (r?.error) {
        setValue(saved);
        setError(r.error);
      } else {
        setSaved(v);
      }
    });
  };

  return (
    <div className="w-28 shrink-0">
      <Select
        aria-label="סטטוס התור"
        aria-describedby={error ? `${status}-err` : undefined}
        value={value}
        disabled={disabled}
        aria-busy={pending}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          setError(null);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => commit(v), 700);
        }}
        onBlur={() => {
          clearTimeout(timer.current);
          commit(value);
        }}
        className={cx("h-8 py-0 text-xs", pending && "opacity-60")}
      >
        {appointmentStatuses.map((s) => (
          <option key={s} value={s}>
            {appointmentStatusLabel[s]}
          </option>
        ))}
      </Select>
      {error && (
        <p id={`${status}-err`} role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
