"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export function SignupForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    setError("");
    const { error } = await authClient.signUp.email({
      name: String(f.get("name")),
      email: String(f.get("email")),
      password: String(f.get("password")),
    });
    setPending(false);
    if (error) {
      setError(
        error.code === "USER_ALREADY_EXISTS" || error.status === 422
          ? "כבר קיים חשבון עם האימייל הזה"
          : "לא הצלחנו לפתוח את החשבון. נסו שוב.",
      );
      return;
    }
    // An invite link brings the user back to accept it; otherwise set up an org.
    router.replace(next?.startsWith("/") ? next : "/onboarding");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <Field label="שם מלא">
        <Input name="name" autoComplete="name" required />
      </Field>
      <Field label="אימייל">
        <Input name="email" type="email" autoComplete="email" required dir="ltr" />
      </Field>
      <Field label="סיסמה" hint="לפחות 8 תווים">
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          dir="ltr"
        />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button disabled={pending} className="mt-1 w-full">
        {pending ? "פותח חשבון…" : "פתיחת חשבון"}
      </Button>
    </form>
  );
}
