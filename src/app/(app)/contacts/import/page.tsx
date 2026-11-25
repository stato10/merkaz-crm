import type { Metadata } from "next";
import { BackLink, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/session";
import { ImportFlow } from "./client";

export const metadata: Metadata = { title: "ייבוא אנשי קשר" };

export default async function ImportPage() {
  await requirePermission({ contact: ["create"] });
  return (
    <>
      <BackLink href="/contacts">אנשי קשר</BackLink>
      <div className="mt-3">
        <PageHeader
          title="ייבוא אנשי קשר"
          description="מקובץ CSV מאקסל, Google Sheets או מערכת קודמת. עמודות בעברית או באנגלית."
        />
      </div>
      <ImportFlow />
    </>
  );
}
