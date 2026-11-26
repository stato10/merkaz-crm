import { waErrorText } from "./parse";

export { providersFor } from "./options";

/** Outbound senders. Each returns the provider's message id, or a Hebrew error the agent can act on. */

export type Provider = "sandbox" | "postmark" | "meta";
export type SendInput = { to: string; body: string; subject?: string; inReplyTo?: string | null };
export type SendResult = { ok: true; externalId: string; delivery: "sent" | "delivered" } | { ok: false; error: string };
type Account = { kind: "email" | "whatsapp"; provider: string; address: string; name: string; config: Record<string, string> };

export const GRAPH_VERSION = "v21.0";
const TIMEOUT_MS = 15_000;


async function post(url: string, headers: Record<string, string>, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

export async function send(account: Account, secrets: Record<string, string>, msg: SendInput): Promise<SendResult> {
  try {
    if (account.provider === "sandbox") {
      return { ok: true, externalId: `${account.kind === "email" ? "email" : "wa"}:sbx_${crypto.randomUUID()}`, delivery: "delivered" };
    }

    if (account.kind === "email" && account.provider === "postmark") {
      if (!secrets.serverToken) return { ok: false, error: "חסר Server Token של Postmark בהגדרות הערוץ." };
      const headers = msg.inReplyTo
        ? [
            { Name: "In-Reply-To", Value: msg.inReplyTo },
            { Name: "References", Value: msg.inReplyTo },
          ]
        : [];
      const r = await post(
        "https://api.postmarkapp.com/email",
        { "X-Postmark-Server-Token": secrets.serverToken },
        {
          From: `${account.name} <${account.address}>`,
          To: msg.to,
          Subject: msg.subject ?? "",
          TextBody: msg.body,
          MessageStream: account.config.messageStream || "outbound",
          Headers: headers,
        },
      );
      if (r.status === 200 && r.json.ErrorCode === 0 && typeof r.json.MessageID === "string") {
        return { ok: true, externalId: `email:<${r.json.MessageID}@mtasv.net>`, delivery: "sent" };
      }
      return { ok: false, error: `Postmark: ${String(r.json.Message ?? `שגיאה ${r.status}`)}` };
    }

    if (account.kind === "whatsapp" && account.provider === "meta") {
      if (!secrets.accessToken || !account.config.phoneNumberId) {
        return { ok: false, error: "חסרים מזהה מספר הטלפון או אסימון הגישה של WhatsApp בהגדרות הערוץ." };
      }
      const r = await post(
        `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(account.config.phoneNumberId)}/messages`,
        { authorization: `Bearer ${secrets.accessToken}` },
        { messaging_product: "whatsapp", recipient_type: "individual", to: msg.to, type: "text", text: { preview_url: false, body: msg.body } },
      );
      const id = (r.json.messages as { id?: string }[] | undefined)?.[0]?.id;
      if (r.status < 300 && id) return { ok: true, externalId: `wa:${id}`, delivery: "sent" };
      const err = r.json.error as { code?: number; message?: string } | undefined;
      return { ok: false, error: waErrorText(err?.code, err?.message ?? `שגיאה ${r.status}`) };
    }

    return { ok: false, error: "ספק הערוץ לא נתמך." };
  } catch (e) {
    const timeout = e instanceof Error && e.name === "TimeoutError";
    return { ok: false, error: timeout ? "הספק לא ענה בזמן. נסו שוב." : "לא הצלחנו להתחבר לספק. נסו שוב." };
  }
}
