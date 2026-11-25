import { type ContactStatus, contactStatuses, contactStatusLabel } from "@/lib/labels";
import { toCsv } from "@/lib/csv";
import { listContacts } from "@/lib/queries";
import { audit, requirePermission } from "@/lib/session";

/** Download the organization's contacts as an Excel-friendly CSV. */
export async function GET(req: Request) {
  const ctx = await requirePermission({ contact: ["read"] });
  const s = new URL(req.url).searchParams.get("status");
  const status = contactStatuses.includes(s as ContactStatus) ? (s as ContactStatus) : undefined;
  const rows = await listContacts(ctx.orgId, { status, limit: 50_000 });
  const csv = toCsv(
    ["שם פרטי", "שם משפחה", "אימייל", "טלפון", "תפקיד", "חברה", "סטטוס", "תגיות", "אחראי", "נוצר"],
    rows.map((c) => [
      c.firstName,
      c.lastName,
      c.email,
      c.phone,
      c.title,
      c.companyName,
      contactStatusLabel[c.status],
      c.tags,
      c.ownerName,
      c.createdAt,
    ]),
  );
  await audit(ctx, "contact.export", status ?? "all", { rows: rows.length });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="contacts-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
}
