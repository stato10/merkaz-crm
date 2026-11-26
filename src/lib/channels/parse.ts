import { createHmac, timingSafeEqual } from "node:crypto";

/** Pure parsing and verification for inbound channel webhooks (unit-tested, no DB). */

export type InboundMessage = {
  from: string; // email address (lowercase) or WhatsApp number (digits)
  name: string | null;
  subject: string | null;
  body: string;
  externalId: string;
  inReplyTo: string | null;
  at: Date;
};

export type StatusUpdate = { externalId: string; status: "sent" | "delivered" | "read" | "failed"; error: string | null };

/** International digits for a phone number: "052-778 8990" -> "972527788990". */
export function phoneDigits(raw: string, country = "972"): string {
  const d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) return d.slice(2);
  if (d.startsWith("0")) return country + d.slice(1);
  return d;
}

/** "[#1003]" in an email subject points the message at an existing ticket. */
export function ticketNumberFromSubject(subject: string | null | undefined): number | null {
  const m = subject?.match(/\[#(\d{1,9})\]/);
  return m ? Number(m[1]) : null;
}

const clean = (s: string) => s.replace(/\r\n/g, "\n").trim();

type PostmarkHeader = { Name?: string; Value?: string };
type PostmarkInbound = {
  From?: string;
  FromName?: string;
  FromFull?: { Email?: string; Name?: string };
  Subject?: string;
  TextBody?: string;
  StrippedTextReply?: string;
  HtmlBody?: string;
  MessageID?: string;
  Date?: string;
  Headers?: PostmarkHeader[];
};

/**
 * Postmark inbound webhook JSON. Also accepts a minimal generic shape
 * ({ from, name?, subject?, text, messageId?, inReplyTo? }) so any provider
 * or a small script can forward mail.
 */
export function parseInboundEmail(json: unknown): InboundMessage | null {
  if (!json || typeof json !== "object") return null;
  const p = json as PostmarkInbound & Record<string, unknown>;
  const header = (n: string) => p.Headers?.find((h) => h.Name?.toLowerCase() === n)?.Value ?? null;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);

  const from = (p.FromFull?.Email ?? p.From ?? str(p.from) ?? "").trim().toLowerCase();
  const email = from.match(/<([^>]+)>/)?.[1] ?? from;
  if (!/^[^@\s<>]+@[^@\s<>]+$/.test(email)) return null;
  const text =
    p.StrippedTextReply || p.TextBody || str(p.text) || (p.HtmlBody ? p.HtmlBody.replace(/<[^>]+>/g, " ") : "");
  const body = clean(text ?? "");
  const subject = (p.Subject ?? str(p.subject) ?? "").trim() || null;
  if (!body && !subject) return null;
  const messageId = header("message-id") ?? p.MessageID ?? str(p.messageId) ?? null;
  return {
    from: email,
    name: (p.FromFull?.Name || p.FromName || str(p.name) || "").trim() || null,
    subject,
    body: body || "(הודעה ללא תוכן)",
    externalId: messageId ? `email:${messageId}` : `email:${email}:${subject}:${body.slice(0, 64)}`,
    inReplyTo: header("in-reply-to") ?? str(p.inReplyTo) ?? null,
    at: p.Date && !Number.isNaN(Date.parse(p.Date)) ? new Date(p.Date) : new Date(),
  };
}

type WaMessage = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  image?: { caption?: string };
  document?: { caption?: string; filename?: string };
};
type WaValue = {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: WaMessage[];
  statuses?: { id?: string; status?: string; errors?: { title?: string; message?: string; code?: number }[] }[];
};

const waTypeLabel: Record<string, string> = {
  image: "תמונה",
  audio: "הודעה קולית",
  video: "וידאו",
  document: "מסמך",
  sticker: "מדבקה",
  location: "מיקום",
  contacts: "כרטיס איש קשר",
};

/** WhatsApp Cloud API webhook payload -> messages and delivery status updates. */
export function parseWhatsApp(json: unknown) {
  const out: { phoneNumberId: string | null; messages: InboundMessage[]; statuses: StatusUpdate[] } = {
    phoneNumberId: null,
    messages: [],
    statuses: [],
  };
  const entries = (json as { entry?: { changes?: { value?: WaValue }[] }[] } | null)?.entry ?? [];
  for (const e of entries) {
    for (const ch of e.changes ?? []) {
      const v = ch.value;
      if (!v) continue;
      out.phoneNumberId ??= v.metadata?.phone_number_id ?? null;
      const names = new Map((v.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]));
      for (const m of v.messages ?? []) {
        if (!m.from || !m.id) continue;
        const caption = m.image?.caption ?? m.document?.caption ?? m.document?.filename;
        const body =
          m.text?.body ??
          m.button?.text ??
          m.interactive?.button_reply?.title ??
          m.interactive?.list_reply?.title ??
          `[${waTypeLabel[m.type ?? ""] ?? "הודעה"}${caption ? `: ${caption}` : ""}]`;
        out.messages.push({
          from: m.from.replace(/\D/g, ""),
          name: names.get(m.from) ?? null,
          subject: null,
          body: clean(body),
          externalId: `wa:${m.id}`,
          inReplyTo: null,
          at: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
        });
      }
      for (const s of v.statuses ?? []) {
        if (!s.id || !["sent", "delivered", "read", "failed"].includes(s.status ?? "")) continue;
        const err = s.errors?.[0];
        out.statuses.push({
          externalId: `wa:${s.id}`,
          status: s.status as StatusUpdate["status"],
          error: err ? waErrorText(err.code, err.message ?? err.title) : null,
        });
      }
    }
  }
  return out;
}

/** Hebrew explanation for the WhatsApp errors a service team actually hits. */
export function waErrorText(code: number | undefined, fallback?: string): string {
  if (code === 131047 || code === 131026)
    return "עברו יותר מ-24 שעות מההודעה האחרונה של הלקוח, ו-WhatsApp מאפשר לשלוח עכשיו רק תבנית מאושרת.";
  if (code === 190) return "אסימון הגישה של WhatsApp פג או לא תקין. עדכנו אותו בהגדרות הערוצים.";
  if (code === 131030) return "המספר הזה לא ברשימת הנמענים המאושרים של חשבון הבדיקה ב-Meta.";
  return fallback ? `WhatsApp: ${fallback}` : "WhatsApp דחה את ההודעה.";
}

/** Meta signs webhook bodies: X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body with the app secret>. */
export function verifyMetaSignature(appSecret: string, rawBody: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const deliveryRank: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3 };

/** Status webhooks arrive out of order; never move a message backwards (read -> delivered). Returns null for no change. */
export function nextDelivery(current: string | null, incoming: StatusUpdate["status"]): string | null {
  if (current === "failed") return null;
  if (incoming === "failed") return current === "delivered" || current === "read" ? null : "failed";
  return deliveryRank[incoming] > (deliveryRank[current ?? "queued"] ?? 0) ? incoming : null;
}

/** WhatsApp allows free-form replies only within 24 hours of the customer's last message. */
export const WA_WINDOW_MS = 24 * 60 * 60 * 1000;
