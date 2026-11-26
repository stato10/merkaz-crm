import { log } from "@/lib/log";
import { parseInboundEmail } from "@/lib/channels/parse";
import { accountByToken, ingestInbound } from "@/lib/channels/service";
import { rateLimit } from "@/lib/rate-limit";

const MAX_BYTES = 2_000_000;

/**
 * Inbound email webhook. Point Postmark's inbound webhook (or any forwarder
 * posting { from, subject, text }) at /api/channels/email/<token>. The token
 * is the secret: it is random, per channel, and shown only to admins.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const account = await accountByToken(token, "email");
  if (!account) return Response.json({ error: "not_found" }, { status: 404 });
  const rl = await rateLimit(`channel:${account.id}`, 600, 60);
  if (!rl.allowed) return Response.json({ error: "rate_limited" }, { status: 429 });

  const raw = await req.text();
  if (raw.length > MAX_BYTES) return Response.json({ error: "too_large" }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const msg = parseInboundEmail(json);
  // 200 on unusable mail so the provider does not retry it forever.
  if (!msg) return Response.json({ ok: true, ignored: true });

  try {
    const r = await ingestInbound(account, msg);
    return Response.json({ ok: true, ticket_id: r.ticketId, created: r.created, duplicate: r.duplicate });
  } catch (err) {
    log.error("channel.email_ingest_failed", { account: account.id, err });
    return Response.json({ error: "internal" }, { status: 500 });
  }
}
