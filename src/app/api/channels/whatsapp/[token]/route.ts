import { timingSafeEqual } from "node:crypto";
import { openSecrets } from "@/lib/channels/crypto";
import { parseWhatsApp, verifyMetaSignature } from "@/lib/channels/parse";
import { accountByToken, applyStatuses, ingestInbound } from "@/lib/channels/service";
import { log } from "@/lib/log";
import { rateLimit } from "@/lib/rate-limit";

const MAX_BYTES = 1_000_000;
type Ctx = { params: Promise<{ token: string }> };

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Meta's subscription handshake: echo hub.challenge when hub.verify_token matches the channel's token. */
export async function GET(req: Request, { params }: Ctx) {
  const { token } = await params;
  const account = await accountByToken(token, "whatsapp");
  const q = new URL(req.url).searchParams;
  if (!account || q.get("hub.mode") !== "subscribe" || !same(q.get("hub.verify_token") ?? "", account.inboundToken)) {
    return new Response("forbidden", { status: 403 });
  }
  return new Response(q.get("hub.challenge") ?? "", { headers: { "content-type": "text/plain" } });
}

/** WhatsApp Cloud API webhook: customer messages and delivery receipts. Signed with the Meta app secret. */
export async function POST(req: Request, { params }: Ctx) {
  const { token } = await params;
  const account = await accountByToken(token, "whatsapp");
  if (!account) return Response.json({ error: "not_found" }, { status: 404 });
  const rl = await rateLimit(`channel:${account.id}`, 600, 60);
  if (!rl.allowed) return Response.json({ error: "rate_limited" }, { status: 429 });

  const raw = await req.text();
  if (raw.length > MAX_BYTES) return Response.json({ error: "too_large" }, { status: 413 });
  if (account.provider === "meta") {
    const { appSecret } = openSecrets(account.secrets);
    if (!appSecret || !verifyMetaSignature(appSecret, raw, req.headers.get("x-hub-signature-256"))) {
      log.warn("channel.whatsapp_bad_signature", { account: account.id });
      return Response.json({ error: "invalid_signature" }, { status: 401 });
    }
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const p = parseWhatsApp(json);
  // One Meta app can serve several numbers; only accept events for this channel's number.
  const expected = account.config.phoneNumberId;
  if (account.provider === "meta" && p.phoneNumberId && expected && p.phoneNumberId !== expected) {
    return Response.json({ ok: true, ignored: true });
  }
  try {
    let tickets = 0;
    for (const m of p.messages) {
      const r = await ingestInbound(account, m);
      if (!r.duplicate) tickets++;
    }
    const statuses = await applyStatuses(account.orgId, p.statuses);
    return Response.json({ ok: true, messages: tickets, statuses });
  } catch (err) {
    log.error("channel.whatsapp_ingest_failed", { account: account.id, err });
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
