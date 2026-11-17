"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${base || "org"}-${Math.random().toString(36).slice(2, 7)}`;
}

export function OnboardingForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name")).trim();
    setPending(true);
    setError("");
    const { data, error } = await authClient.organization.create({ name, slug: slugify(name) });
    if (error || !data) {
      setPending(false);
      if (error?.status === 401) {
        router.replace("/login");
        return;
      }
      setError("לא הצלחנו להקים את הארגון. נסו שוב.");
      return;
    }
    await authClient.organization.setActive({ organizationId: data.id });
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <Field label="שם הארגון">
        <Input name="name" required maxLength={80} placeholder="לדוגמה: מרפאות השרון" />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button disabled={pending} className="w-full">
        {pending ? "מקים…" : "המשך"}
      </Button>
    </form>
  );
}
