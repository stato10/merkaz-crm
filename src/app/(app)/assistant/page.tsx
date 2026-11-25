import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui";
import { aiConfigured } from "@/lib/ai/agent";
import { getCtx } from "@/lib/session";
import { AssistantChat } from "./chat";

export const metadata: Metadata = { title: "עוזר AI" };

export default async function AssistantPage() {
  const ctx = await getCtx();
  const suggestions = [
    ctx.can({ ticket: ["read"] }) && "אילו פניות דחופות פתוחות עכשיו?",
    ctx.can({ deal: ["read"] }) && "מה מצב הצנרת והתחזית המשוקללת?",
    ctx.can({ contact: ["read"] }) && "מה הסטטוס מול אבי גולן מגלבוע לוגיסטיקה?",
    ctx.can({ appointment: ["read"] }) && "מה פנוי ביום ראשון הקרוב?",
  ].filter((s): s is string => Boolean(s));

  return (
    <>
      <PageHeader
        title="עוזר AI"
        description="שאלו על לקוחות, עסקאות, פניות ותורים, או בקשו לבצע פעולה. העוזר עובד עם ההרשאות שלכם בלבד."
      />
      {aiConfigured() ? (
        <AssistantChat suggestions={suggestions} />
      ) : (
        <Card className="p-6 text-sm text-muted">
          העוזר עוד לא הוגדר בסביבה הזו. כדי להפעיל אותו מגדירים את משתנה הסביבה{" "}
          <code className="ltr rounded bg-surface-2 px-1.5 py-0.5 text-ink">ANTHROPIC_API_KEY</code>.
        </Card>
      )}
    </>
  );
}
