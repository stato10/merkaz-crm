import type { Metadata } from "next";
import { Suspense } from "react";
import { Card } from "@/components/ui";
import { AcceptInvite } from "./accept";

export const metadata: Metadata = { title: "הצטרפות לצוות" };

export default function InvitePage({ params }: PageProps<"/invite/[id]">) {
  return (
    <Card className="p-6">
      <h1 className="mb-1 text-xl font-semibold">הוזמנתם להצטרף</h1>
      <p className="mb-6 text-sm text-muted">
        התחברו או פתחו חשבון עם האימייל שאליו נשלחה ההזמנה, ואז אשרו.
      </p>
      <Suspense>
        <AcceptInvite params={params} />
      </Suspense>
    </Card>
  );
}
