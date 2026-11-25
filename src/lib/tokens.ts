import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Pure crypto helpers for API keys and webhook signatures (no DB, unit-tested). */

export const API_KEY_PREFIX = "crm_live_";

export function generateApiKey() {
  const token = API_KEY_PREFIX + randomBytes(24).toString("base64url");
  return { token, prefix: token.slice(0, API_KEY_PREFIX.length + 4), hash: hashToken(token) };
}

/** API keys are high-entropy random strings, so a fast hash is enough (no salt/KDF needed). */
export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function looksLikeApiKey(token: string) {
  return token.startsWith(API_KEY_PREFIX) && token.length >= API_KEY_PREFIX.length + 20;
}

export function generateWebhookSecret() {
  return "whsec_" + randomBytes(24).toString("base64url");
}

/**
 * Stripe-style signature header: `t=<unix seconds>,v1=<hex hmac>` where the
 * HMAC-SHA256 covers `${t}.${body}`. Including the timestamp stops replays.
 */
export function signWebhook(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const sig = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

export function verifyWebhook(
  secret: string,
  body: string,
  header: string,
  toleranceSec = 300,
  now = Math.floor(Date.now() / 1000),
) {
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1) return false;
  if (Math.abs(now - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parts.v1, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Exponential backoff with a cap: 30s, 1m, 2m, 4m … up to 6h. */
export function backoffSeconds(attempt: number) {
  return Math.min(30 * 2 ** Math.max(0, attempt - 1), 6 * 60 * 60);
}
