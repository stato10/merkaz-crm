import { createHmac, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as emailRoute from "@/app/api/channels/email/[token]/route";
import * as waRoute from "@/app/api/channels/whatsapp/[token]/route";
import { db, schema } from "@/db";
import { sealSecrets } from "@/lib/channels/crypto";
import { deliverMessage } from "@/lib/channels/service";
import { createTenant, type Tenant } from "../support/fixtures";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration";

let a: Tenant;
let b: Tenant;
const token = () => randomBytes(24).toString("base64url");

async function addAccount(orgId: string, v: Partial<typeof schema.channelAccounts.$inferInsert> & { kind: "email" | "whatsapp" }) {
  const [row] = await db
    .insert(schema.channelAccounts)
    .values({ orgId, provider: "sandbox", name: "test", address: v.kind === "email" ? "support@test.co" : "972535550100", inboundToken: token(), ...v })
    .returning();
  return row;
}

function post(route: typeof emailRoute | typeof waRoute, tok: string, body: unknown, headers: Record<string, string> = {}) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const kind = route === emailRoute ? "email" : "whatsapp";
  return route.POST(
    new Request(`http://localhost/api/channels/${kind}/${tok}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: raw }),
    { params: Promise.resolve({ token: tok }) },
  );
}

const waPayload = (id: string, text: string, from = "972527788990", phoneNumberId = "111") => ({
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: phoneNumberId },
            contacts: [{ wa_id: from, profile: { name: "יוסי כהן" } }],
            messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }],
          },
        },
      ],
    },
  ],
});

const ticketsOf = (orgId: string) => db.select().from(schema.tickets).where(eq(schema.tickets.orgId, orgId));
const messagesOf = (ticketId: string) =>
  db.select().from(schema.ticketMessages).where(eq(schema.ticketMessages.ticketId, ticketId)).orderBy(schema.ticketMessages.createdAt);

beforeAll(async () => {
  a = await createTenant("ChanA");
  b = await createTenant("ChanB");
});

afterEach(() => vi.unstubAllGlobals());

describe("WhatsApp inbound", () => {
  it("creates a contact and ticket, threads follow-ups and ignores provider retries", async () => {
    const acc = await addAccount(a.orgId, { kind: "whatsapp" });
    expect((await post(waRoute, acc.inboundToken, waPayload("wamid.1", "שלום, התור שלי מחר?"))).status).toBe(200);
    await post(waRoute, acc.inboundToken, waPayload("wamid.2", "אפשר להזיז ל-10?"));
    await post(waRoute, acc.inboundToken, waPayload("wamid.2", "אפשר להזיז ל-10?")); // retry

    const ts = await ticketsOf(a.orgId);
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({ channel: "whatsapp", channelAccountId: acc.id, replyTo: "972527788990", status: "open", subject: "שלום, התור שלי מחר?" });
    expect((await messagesOf(ts[0].id)).map((m) => m.body)).toEqual(["שלום, התור שלי מחר?", "אפשר להזיז ל-10?"]);
    const [c] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, ts[0].contactId!));
    expect(c).toMatchObject({ firstName: "יוסי", lastName: "כהן", phone: "+972527788990", source: "whatsapp" });
  });

  it("matches an existing contact saved with a local number", async () => {
    const [c] = await db
      .insert(schema.contacts)
      .values({ orgId: a.orgId, firstName: "מיכל", phone: "054-111-2233" })
      .returning();
    const acc = await addAccount(a.orgId, { kind: "whatsapp" });
    await post(waRoute, acc.inboundToken, waPayload("wamid.m1", "היי", "972541112233"));
    const [t] = await db.select().from(schema.tickets).where(eq(schema.tickets.channelAccountId, acc.id));
    expect(t.contactId).toBe(c.id);
  });

  it("requires a valid Meta signature and answers the verify handshake", async () => {
    const acc = await addAccount(b.orgId, {
      kind: "whatsapp",
      provider: "meta",
      config: { phoneNumberId: "222" },
      secrets: sealSecrets({ accessToken: "tok", appSecret: "app-secret" }),
    });
    const body = JSON.stringify(waPayload("wamid.s1", "חתום", "972500000001", "222"));
    expect((await post(waRoute, acc.inboundToken, body)).status).toBe(401);
    const bad = "sha256=" + createHmac("sha256", "wrong").update(body).digest("hex");
    expect((await post(waRoute, acc.inboundToken, body, { "x-hub-signature-256": bad })).status).toBe(401);
    const good = "sha256=" + createHmac("sha256", "app-secret").update(body).digest("hex");
    expect((await post(waRoute, acc.inboundToken, body, { "x-hub-signature-256": good })).status).toBe(200);
    expect(await ticketsOf(b.orgId)).toHaveLength(1);

    const verify = (vt: string) =>
      waRoute.GET(
        new Request(`http://localhost/api/channels/whatsapp/${acc.inboundToken}?hub.mode=subscribe&hub.verify_token=${vt}&hub.challenge=42`),
        { params: Promise.resolve({ token: acc.inboundToken }) },
      );
    expect(await (await verify(acc.inboundToken)).text()).toBe("42");
    expect((await verify("nope")).status).toBe(403);
  });

  it("404s on unknown or disabled channels", async () => {
    expect((await post(waRoute, token(), waPayload("x", "y"))).status).toBe(404);
    const acc = await addAccount(a.orgId, { kind: "whatsapp", active: false });
    expect((await post(waRoute, acc.inboundToken, waPayload("x", "y"))).status).toBe(404);
    // An email token does not open the WhatsApp endpoint.
    const mail = await addAccount(a.orgId, { kind: "email" });
    expect((await post(waRoute, mail.inboundToken, waPayload("x", "y"))).status).toBe(404);
  });
});

describe("Email inbound", () => {
  it("threads replies by the [#number] tag, only inside the channel's organization", async () => {
    const other = await createTenant("ChanC");
    const acc = await addAccount(other.orgId, { kind: "email" });
    const first = await post(emailRoute, acc.inboundToken, {
      FromFull: { Email: "dana@example.co.il", Name: "דנה לוי" },
      Subject: "בעיה בהתחברות",
      TextBody: "לא מצליחה להיכנס",
      Headers: [{ Name: "Message-ID", Value: "<in1@example>" }],
    });
    const { ticket_id, created } = await first.json();
    expect(created).toBe(true);
    const [t] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, ticket_id));
    expect(t.number).toBe(1001);

    await post(emailRoute, acc.inboundToken, {
      From: "dana@example.co.il",
      Subject: `Re: בעיה בהתחברות [#${t.number}]`,
      StrippedTextReply: "עכשיו זה עובד, תודה",
      Headers: [{ Name: "Message-ID", Value: "<in2@example>" }],
    });
    expect((await messagesOf(t.id)).map((m) => m.body)).toEqual(["לא מצליחה להיכנס", "עכשיו זה עובד, תודה"]);

    // Org A also has a ticket #1001; a tag must never reach across organizations.
    const accA = await addAccount(a.orgId, { kind: "email" });
    const ticketsBefore = (await ticketsOf(a.orgId)).length;
    const r = await (await post(emailRoute, accA.inboundToken, { from: "x@y.co", subject: `Re: [#${t.number}]`, text: "שלום" })).json();
    const [ta] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, r.ticket_id));
    expect(ta.orgId).toBe(a.orgId);
    expect(ta.id).not.toBe(t.id);
    expect((await ticketsOf(a.orgId)).length).toBeGreaterThanOrEqual(ticketsBefore);
  });
});

describe("Outbound delivery", () => {
  async function queued(orgId: string, acc: { id: string }, replyTo: string, body = "תשובה") {
    const [t] = await db
      .insert(schema.tickets)
      .values({ orgId, number: sql`(select coalesce(max(number), 5000) + 1 from tickets where org_id = ${orgId})`, subject: "בדיקה", channelAccountId: acc.id, replyTo })
      .returning();
    const [m] = await db
      .insert(schema.ticketMessages)
      .values({ orgId, ticketId: t.id, kind: "outbound", body, channel: "whatsapp", delivery: "queued" })
      .returning();
    return m;
  }
  const get = async (id: string) => (await db.select().from(schema.ticketMessages).where(eq(schema.ticketMessages.id, id)))[0];

  it("sandbox marks the reply delivered without any network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const acc = await addAccount(a.orgId, { kind: "whatsapp" });
    const m = await queued(a.orgId, acc, "972527788990");
    expect(await deliverMessage(a.orgId, m.id)).toMatchObject({ ok: true });
    expect((await get(m.id)).delivery).toBe("delivered");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends through the Cloud API, then applies read receipts from the webhook", async () => {
    const acc = await addAccount(a.orgId, {
      kind: "whatsapp",
      provider: "meta",
      config: { phoneNumberId: "333" },
      secrets: sealSecrets({ accessToken: "EAAtoken", appSecret: "s3" }),
    });
    const fetchSpy = vi.fn(async () => Response.json({ messages: [{ id: "wamid.OUT1" }] }));
    vi.stubGlobal("fetch", fetchSpy);
    const m = await queued(a.orgId, acc, "972527788990", "התור הוזז ל-10:00");
    expect(await deliverMessage(a.orgId, m.id)).toMatchObject({ ok: true });
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/333/messages");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer EAAtoken");
    expect(JSON.parse(init.body as string)).toMatchObject({ to: "972527788990", text: { body: "התור הוזז ל-10:00" } });
    expect(await get(m.id)).toMatchObject({ delivery: "sent", externalId: "wa:wamid.OUT1" });
    vi.unstubAllGlobals();

    const receipt = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "333" }, statuses: [{ id: "wamid.OUT1", status: "read" }] } }] }] });
    const sig = "sha256=" + createHmac("sha256", "s3").update(receipt).digest("hex");
    await post(waRoute, acc.inboundToken, receipt, { "x-hub-signature-256": sig });
    expect((await get(m.id)).delivery).toBe("read");
  });

  it("records a readable error when WhatsApp rejects the message, and can retry", async () => {
    const acc = await addAccount(a.orgId, {
      kind: "whatsapp",
      provider: "meta",
      config: { phoneNumberId: "444" },
      secrets: sealSecrets({ accessToken: "t", appSecret: "s" }),
    });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: 131047, message: "Re-engagement message" } }, { status: 400 })));
    const m = await queued(a.orgId, acc, "972527788990");
    const r = await deliverMessage(a.orgId, m.id);
    expect(r).toMatchObject({ ok: false });
    expect(await get(m.id)).toMatchObject({ delivery: "failed", deliveryError: expect.stringContaining("24 שעות") });

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ messages: [{ id: "wamid.RETRY" }] })));
    expect(await deliverMessage(a.orgId, m.id)).toMatchObject({ ok: true });
    expect(await get(m.id)).toMatchObject({ delivery: "sent", deliveryError: null });
    // Already sent: a second call is a no-op.
    expect(await deliverMessage(a.orgId, m.id)).toBeNull();
  });

  it("emails replies through Postmark with the ticket tag and threading headers", async () => {
    const acc = await addAccount(a.orgId, {
      kind: "email",
      provider: "postmark",
      name: "תמיכה",
      address: "support@test.co",
      secrets: sealSecrets({ serverToken: "pm-token" }),
    });
    const res = await (
      await post(emailRoute, acc.inboundToken, { from: "dana@example.co.il", subject: "שאלה", text: "שלום", messageId: "<q1@example>" })
    ).json();
    const [t] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, res.ticket_id));
    const [m] = await db
      .insert(schema.ticketMessages)
      .values({ orgId: a.orgId, ticketId: t.id, kind: "outbound", body: "הנה התשובה", channel: "email", delivery: "queued" })
      .returning();
    const fetchSpy = vi.fn(async () => Response.json({ ErrorCode: 0, MessageID: "pm-1" }));
    vi.stubGlobal("fetch", fetchSpy);
    expect(await deliverMessage(a.orgId, m.id)).toMatchObject({ ok: true });
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.postmarkapp.com/email");
    expect((init.headers as Record<string, string>)["X-Postmark-Server-Token"]).toBe("pm-token");
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({ From: "תמיכה <support@test.co>", To: "dana@example.co.il", Subject: `Re: שאלה [#${t.number}]`, TextBody: "הנה התשובה" });
    expect(sent.Headers).toContainEqual({ Name: "In-Reply-To", Value: "<q1@example>" });
  });

  it("cannot send another organization's message", async () => {
    const acc = await addAccount(a.orgId, { kind: "whatsapp" });
    const m = await queued(a.orgId, acc, "972527788990");
    expect(await deliverMessage(b.orgId, m.id)).toBeNull();
    const [row] = await db
      .select({ d: schema.ticketMessages.delivery })
      .from(schema.ticketMessages)
      .where(and(eq(schema.ticketMessages.id, m.id)));
    expect(row.d).toBe("queued");
  });
});
