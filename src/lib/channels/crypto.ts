import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Provider credentials (API tokens, app secrets) are stored encrypted with
 * AES-256-GCM. The key is CHANNEL_SECRET_KEY (32 bytes, base64), or derived
 * from BETTER_AUTH_SECRET so a deployment works without an extra variable.
 */
function key(): Buffer {
  const explicit = process.env.CHANNEL_SECRET_KEY;
  if (explicit) {
    const k = Buffer.from(explicit, "base64");
    if (k.length !== 32) throw new Error("CHANNEL_SECRET_KEY must be 32 bytes, base64-encoded");
    return k;
  }
  const base = process.env.BETTER_AUTH_SECRET;
  if (!base) throw new Error("Set CHANNEL_SECRET_KEY or BETTER_AUTH_SECRET to store channel credentials");
  return Buffer.from(hkdfSync("sha256", base, "merkaz-crm", "channel-secrets", 32));
}

export function sealSecrets(data: Record<string, string>): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(data), "utf8"), c.final()]);
  return "v1:" + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}

export function openSecrets(sealed: string | null | undefined): Record<string, string> {
  if (!sealed) return {};
  if (!sealed.startsWith("v1:")) throw new Error("Unknown secrets format");
  const buf = Buffer.from(sealed.slice(3), "base64url");
  const d = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8"));
}
