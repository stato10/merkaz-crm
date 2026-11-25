import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { Badge, Card, cx, PageHeader } from "@/components/ui";
import { db, schema } from "@/db";
import { RATE_LIMIT } from "@/lib/api/handler";
import { webhookEvents } from "@/lib/api/events";
import { formatDate } from "@/lib/labels";
import { requirePermission } from "@/lib/session";
import { MAX_ATTEMPTS } from "@/lib/webhooks";
import { ActionButton } from "../../deals/client";
import { deleteWebhook, retryWebhookDelivery, revokeApiKey, sendTestWebhook, toggleWebhook } from "./actions";
import { CopyField, NewKeyForm, NewWebhookForm, RevealSecret, ToggleSwitch } from "./client";

export const metadata: Metadata = { title: "מפתחים ואינטגרציות" };

const roleName: Record<string, string> = { admin: "מלאה", sales: "מכירות", agent: "שירות" };
const deliveryTone = { pending: "warn", succeeded: "ok", failed: "danger" } as const;
const deliveryLabel = { pending: "ממתין לניסיון חוזר", succeeded: "נמסר", failed: "נכשל" } as const;

export default async function DevelopersPage() {
  const ctx = await requirePermission({ settings: ["update"] });
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;

  const [keys, endpoints, deliveries] = await Promise.all([
    db.select().from(schema.apiKeys).where(eq(schema.apiKeys.orgId, ctx.orgId)).orderBy(desc(schema.apiKeys.createdAt)),
    db.select().from(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.orgId, ctx.orgId)).orderBy(schema.webhookEndpoints.createdAt),
    db
      .select({
        id: schema.webhookDeliveries.id,
        event: schema.webhookDeliveries.event,
        status: schema.webhookDeliveries.status,
        attempts: schema.webhookDeliveries.attempts,
        code: schema.webhookDeliveries.lastStatusCode,
        error: schema.webhookDeliveries.lastError,
        createdAt: schema.webhookDeliveries.createdAt,
        url: schema.webhookEndpoints.url,
      })
      .from(schema.webhookDeliveries)
      .innerJoin(schema.webhookEndpoints, eq(schema.webhookEndpoints.id, schema.webhookDeliveries.endpointId))
      .where(eq(schema.webhookDeliveries.orgId, ctx.orgId))
      .orderBy(desc(schema.webhookDeliveries.createdAt))
      .limit(15),
  ]);
  const activeKeys = keys.filter((k) => !k.revokedAt);

  return (
    <>
      <PageHeader title="מפתחים ואינטגרציות" description="חיבור מערכות אחרות ל-CRM דרך API ו-Webhooks" />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid content-start gap-6">
          <Card className="p-5">
            <h2 className="font-semibold">מפתחות API</h2>
            <p className="mt-1 mb-4 text-sm text-muted">
              כל מפתח שייך לארגון ומוגבל להרשאה שבחרתם. שומרים רק טביעה מוצפנת שלו, לא את המפתח עצמו.
            </p>
            <NewKeyForm />
            {keys.length > 0 && (
              <ul className="mt-5 divide-y divide-line border-t border-line">
                {keys.map((k) => (
                  <li key={k.id} className={cx("flex flex-wrap items-center gap-x-4 gap-y-1 py-3", k.revokedAt && "opacity-60")}>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{k.name}</p>
                      <p className="text-xs text-muted">
                        <span className="ltr inline-block font-mono">{k.prefix}…</span> · נוצר {formatDate(k.createdAt)}
                        {" · "}
                        {k.lastUsedAt ? `שימוש אחרון ${formatDate(k.lastUsedAt)}` : "עוד לא בשימוש"}
                      </p>
                    </div>
                    {k.revokedAt ? (
                      <Badge>בוטל</Badge>
                    ) : (
                      <>
                        <Badge tone={k.role === "admin" ? "accent" : "neutral"}>{roleName[k.role] ?? k.role}</Badge>
                        <ActionButton
                          action={revokeApiKey.bind(null, k.id)}
                          label="ביטול"
                          variant="ghost"
                          confirmText={`לבטל את "${k.name}"? מערכות שמשתמשות בו יפסיקו לעבוד מיד.`}
                        />
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="font-semibold">Webhooks</h2>
            <p className="mt-1 mb-4 text-sm text-muted">
              כשמשהו משתנה ב-CRM נשלחת הודעה חתומה לכתובת שלכם. אם הכתובת לא עונה, ננסה שוב עד {MAX_ATTEMPTS} פעמים ברווחים הולכים וגדלים.
            </p>
            {endpoints.length > 0 && (
              <ul className="mb-5 divide-y divide-line border-y border-line">
                {endpoints.map((ep) => (
                  <li key={ep.id} className="grid gap-2 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <ToggleSwitch on={ep.active} action={toggleWebhook.bind(null, ep.id)} label={`שליחה ל-${ep.url}`} />
                      <span className="ltr min-w-0 flex-1 truncate text-start font-mono text-sm">{ep.url}</span>
                      <Badge tone={ep.active ? "ok" : "neutral"}>{ep.active ? "פעיל" : "מושהה"}</Badge>
                    </div>
                    <p className="text-xs text-muted">
                      {ep.events.length ? <span className="ltr inline-block font-mono">{ep.events.join(", ")}</span> : "כל האירועים"}
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <RevealSecret secret={ep.secret} />
                      <span className="ms-auto flex gap-2">
                        <ActionButton action={sendTestWebhook.bind(null, ep.id)} label="שליחת בדיקה" />
                        <ActionButton action={deleteWebhook.bind(null, ep.id)} label="מחיקה" variant="ghost" confirmText="למחוק את הכתובת? הודעות שממתינות לה יימחקו." />
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <NewWebhookForm events={webhookEvents} />
          </Card>

          {deliveries.length > 0 && (
            <Card className="overflow-hidden">
              <h2 className="px-5 pt-5 pb-3 font-semibold">משלוחים אחרונים</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-y border-line text-[13px] text-muted">
                      <th className="px-5 py-2.5 text-start font-normal">אירוע</th>
                      <th className="px-3 py-2.5 text-start font-normal">מצב</th>
                      <th className="px-3 py-2.5 text-start font-normal">ניסיונות</th>
                      <th className="px-3 py-2.5 text-start font-normal">תשובה</th>
                      <th className="px-3 py-2.5 text-start font-normal">מתי</th>
                      <th className="px-5 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {deliveries.map((d) => (
                      <tr key={d.id} className="h-14">
                        <td className="px-5">
                          <span className="ltr block text-start font-mono text-xs">{d.event}</span>
                          <span className="ltr block max-w-64 truncate text-start text-xs text-muted">{d.url}</span>
                        </td>
                        <td className="px-3"><Badge tone={deliveryTone[d.status]}>{deliveryLabel[d.status]}</Badge></td>
                        <td className="px-3 tabular-nums">{d.attempts}</td>
                        <td className="ltr px-3 text-start font-mono text-xs text-muted" title={d.error ?? undefined}>
                          {d.code ?? (d.error ? "שגיאת רשת" : "—")}
                        </td>
                        <td className="px-3 text-muted">{formatDate(d.createdAt)}</td>
                        <td className="px-5 text-end">
                          {d.status !== "succeeded" && <ActionButton action={retryWebhookDelivery.bind(null, d.id)} label="ניסיון חוזר" variant="ghost" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>

        <Card className="h-fit p-5 text-sm">
          <h2 className="font-semibold">התחלה מהירה</h2>
          <dl className="mt-3 grid gap-3">
            <div className="grid gap-1.5">
              <dt className="text-muted">כתובת בסיס</dt>
              <dd><CopyField value={`${origin}/api/v1`} label="כתובת בסיס" /></dd>
            </div>
            <div className="grid gap-1.5">
              <dt className="text-muted">בקשה ראשונה</dt>
              <dd>
                <pre dir="ltr" className="overflow-x-auto rounded bg-surface-2 p-3 text-start font-mono text-xs leading-relaxed">
{`curl ${origin}/api/v1/contacts \\
  -H "Authorization: Bearer crm_live_…"`}
                </pre>
              </dd>
            </div>
            <div>
              <dt className="text-muted">מגבלת קצב</dt>
              <dd className="mt-1">{RATE_LIMIT.limit} בקשות לדקה לכל מפתח</dd>
            </div>
            <div>
              <dt className="text-muted">אימות Webhooks</dt>
              <dd className="mt-1">
                בכותרת <span className="ltr inline-block font-mono text-xs">X-CRM-Signature</span> יש חותמת זמן וחתימת HMAC-SHA256 על הגוף.
              </dd>
            </div>
          </dl>
          <a href="/api/v1/openapi.json" target="_blank" className="mt-4 inline-block font-medium text-accent hover:underline">
            מפרט OpenAPI מלא
          </a>
          <p className="mt-3 text-xs text-muted">{activeKeys.length} מפתחות פעילים · {endpoints.length} כתובות Webhook</p>

          <h2 className="mt-6 border-t border-line pt-5 font-semibold">שרת MCP</h2>
          <p className="mt-1 mb-3 text-muted">
            חיבור Claude ועוזרי AI אחרים ישירות ל-CRM. הכלים הזמינים נקבעים לפי ההרשאה של המפתח.
          </p>
          <CopyField value={`${origin}/api/mcp`} label="כתובת שרת MCP" />
          <pre dir="ltr" className="mt-3 overflow-x-auto rounded bg-surface-2 p-3 text-start font-mono text-xs leading-relaxed">
{`claude mcp add --transport http merkaz \\
  ${origin}/api/mcp \\
  --header "Authorization: Bearer crm_live_…"`}
          </pre>
        </Card>
      </div>
    </>
  );
}
