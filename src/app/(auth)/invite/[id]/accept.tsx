"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { Button, buttonClass } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export function AcceptInvite({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const next = encodeURIComponent(`/invite/${id}`);

  if (isPending) return <p className="text-sm text-muted">טוען…</p>;

  if (!session)
    return (
      <div className="grid gap-2">
        <Link href={`/signup?next=${next}`} className={buttonClass()}>פתיחת חשבון</Link>
        <Link href={`/login?next=${next}`} className={buttonClass("secondary")}>כבר יש לי חשבון</Link>
      </div>
    );

  return (
    <div className="grid gap-3">
      <p className="text-sm">
        מחובר/ת בתור <span className="ltr font-medium">{session.user.email}</span>
      </p>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          const { data, error } = await authClient.organization.acceptInvitation({ invitationId: id });
          if (error || !data) {
            setBusy(false);
            setError("ההזמנה לא תקפה, פגה, או נשלחה לאימייל אחר.");
            return;
          }
          await authClient.organization.setActive({ organizationId: data.invitation.organizationId });
          router.replace("/");
          router.refresh();
        }}
      >
        {busy ? "מצטרף…" : "הצטרפות לארגון"}
      </Button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
