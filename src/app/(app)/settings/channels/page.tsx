import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { Badge, Card, cx, PageHeader } from "@/components/ui";
import { db, schema } from "@/db";
import { formatDate } from "@/lib/labels";
import { requirePermission } from "@/lib/session";
import { ActionButton } from "../../deals/client";
import { CopyField, ToggleSwitch } from "../developers/client";
import { deleteChannel, simulateInbound, toggleChannel } from "./actions";
import { NewChannelForm, SimulateForm } from "./client";

export const metadata: Metadata = { title: "ערוצי תקשורת" };

const providerLabel: Record<string, string> = { sandbox: "סביבת בדיקה", postmark: "Postmark", meta: "Meta Cloud API" };
const kindName = { email: "אימייל", whatsapp: "WhatsApp" } as const;

export default async function ChannelsPage() {
  const ctx = await requirePermission({ settings: ["update"] });
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const accounts = await db
    .select()
    .from(schema.channelAccounts)
    .where(eq(schema.channelAccounts.orgId, ctx.orgId))
    .orderBy(desc(schema.channelAccounts.createdAt));

  return (
    <>
      <PageHeader
        title="ערוצי תקשורת"
        description="הודעות שלקוחות שולחים ב-WhatsApp ובאימייל נכנסות כפניות, והתשובות יוצאות באותו ערוץ"
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid content-start gap-6">
          {accounts.map((a) => {
            const url = `${origin}/api/channels/${a.kind}/${a.inboundToken}`;
            return (
              <Card key={a.id} className={cx("grid gap-4 p-5", !a.active && "opacity-70")}>
                <div className="flex flex-wrap items-center gap-3">
                  <ToggleSwitch on={a.active} action={toggleChannel.bind(null, a.id)} label={`הפעלת הערוץ ${a.name}`} />
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold">{a.name}</h2>
                    <p className="text-xs text-muted">
                      {kindName[a.kind]} ·{" "}
                      <span className="ltr inline-block">{a.kind === "whatsapp" ? `+${a.address}` : a.address}</span> · חובר{" "}
                      {formatDate(a.createdAt)}
                    </p>
                  </div>
                  <Badge tone={a.provider === "sandbox" ? "warn" : "accent"}>{providerLabel[a.provider] ?? a.provider}</Badge>
                  {!a.active && <Badge>מושבת</Badge>}
                </div>

                {a.provider !== "sandbox" && (
                  <dl className="grid gap-3 text-sm">
                    <div className="grid gap-1.5">
                      <dt className="text-muted">
                        {a.kind === "email" ? "כתובת ה-Inbound webhook ב-Postmark" : "Callback URL ב-Meta"}
                      </dt>
                      <dd>
                        <CopyField value={url} label="כתובת ה-webhook" />
                      </dd>
                    </div>
                    {a.kind === "whatsapp" && (
                      <div className="grid gap-1.5">
                        <dt className="text-muted">Verify token</dt>
                        <dd>
                          <CopyField value={a.inboundToken} label="Verify token" />
                        </dd>
                      </div>
                    )}
                  </dl>
                )}

                {a.provider === "sandbox" && a.active && (
                  <SimulateForm kind={a.kind} action={simulateInbound.bind(null, a.id)} />
                )}

                <div className="flex justify-end">
                  <ActionButton
                    action={deleteChannel.bind(null, a.id)}
                    label="ניתוק"
                    variant="ghost"
                    confirmText={`לנתק את "${a.name}"? הפניות שכבר נפתחו יישארו, אבל תשובות לא יישלחו דרכו.`}
                  />
                </div>
              </Card>
            );
          })}

          <Card className="p-5">
            <h2 className="font-semibold">חיבור ערוץ</h2>
            <p className="mt-1 mb-4 text-sm text-muted">
              פרטי הגישה לספק נשמרים מוצפנים ולא מוצגים שוב. כדי להחליף אותם, מנתקים ומחברים מחדש.
            </p>
            <NewChannelForm />
          </Card>
        </div>

        <Card className="h-fit p-5 text-sm">
          <h2 className="font-semibold">איך זה עובד</h2>
          <ol className="mt-3 grid list-decimal gap-2 ps-5 text-muted">
            <li>הודעה מלקוח פותחת פנייה, או מתווספת לפנייה הפתוחה שלו.</li>
            <li>לקוח שעוד לא במערכת נוסף כאיש קשר חדש.</li>
            <li>תשובה בפנייה נשלחת ללקוח באותו ערוץ, וסטטוס המסירה מתעדכן: נשלח, נמסר, נקרא.</li>
          </ol>

          <h3 className="mt-5 font-semibold">WhatsApp</h3>
          <p className="mt-1 text-muted">
            ב-Meta for Developers יוצרים אפליקציה עם WhatsApp, מעתיקים לכאן את Phone number ID, אסימון גישה ו-App Secret, ואז
            מגדירים את ה-Callback URL וה-Verify token שיופיעו כאן ונרשמים לשדה <span className="ltr inline-block font-mono text-xs">messages</span>.
          </p>
          <p className="mt-2 text-muted">
            אפשר לענות בהודעה חופשית רק עד 24 שעות מההודעה האחרונה של הלקוח. אחרי זה WhatsApp מחייב תבנית מאושרת.
          </p>

          <h3 className="mt-5 font-semibold">אימייל</h3>
          <p className="mt-1 text-muted">
            ב-Postmark מאמתים את דומיין השולח, ומגדירים את כתובת ה-webhook שתופיע כאן ב-Inbound stream. תשובות של לקוחות חוזרות
            לאותה פנייה לפי המספר שבנושא, למשל <span className="ltr inline-block">[#1001]</span>.
          </p>
        </Card>
      </div>
    </>
  );
}
