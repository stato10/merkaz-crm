"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") || "/";
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    setError("");
    const { error } = await authClient.signIn.email({
      email: String(f.get("email")),
      password: String(f.get("password")),
    });
    setPending(false);
    if (error) {
      setError("האימייל או הסיסמה שגויים");
      return;
    }
    router.replace(next.startsWith("/") ? next : "/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <Field label="אימייל">
        <Input name="email" type="email" autoComplete="email" required dir="ltr" />
      </Field>
      <Field label="סיסמה">
        <Input name="password" type="password" autoComplete="current-password" required dir="ltr" />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button disabled={pending} className="mt-1 w-full">
        {pending ? "מתחבר…" : "התחברות"}
      </Button>
    </form>
  );
}

/** Public demo: one click into the seeded demo organization (NEXT_PUBLIC_DEMO_MODE=1). */
export function DemoLogin() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="grid gap-2 rounded-md border border-accent/30 bg-accent-soft p-4">
      <p className="text-sm font-medium text-ink">רוצים להציץ? יש חשבון הדגמה עם נתונים מלאים.</p>
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          const { error } = await authClient.signIn.email({
            email: process.env.NEXT_PUBLIC_DEMO_EMAIL ?? "demo@merkaz.dev",
            password: process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? "merkaz-demo-2026",
          });
          setPending(false);
          if (error) return setError("חשבון ההדגמה לא זמין כרגע");
          router.replace("/");
          router.refresh();
        }}
      >
        {pending ? "נכנס…" : "כניסה לחשבון ההדגמה"}
      </Button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
