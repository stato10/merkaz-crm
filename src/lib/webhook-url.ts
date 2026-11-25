/**
 * Basic SSRF guard for customer-supplied webhook URLs. Rejects non-HTTPS URLs
 * and private/loopback hosts in production. (DNS rebinding is out of scope;
 * deliveries also refuse redirects.)
 */
export function checkWebhookUrl(raw: string, production = process.env.NODE_ENV === "production") {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "כתובת לא תקינה";
  }
  if (u.username || u.password) return "אין להכניס פרטי התחברות בכתובת";
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const local = isPrivateHost(host);
  if (u.protocol === "https:") return production && local ? "אי אפשר לשלוח לכתובת פנימית" : null;
  if (u.protocol === "http:" && !production && local) return null; // local testing
  return "הכתובת חייבת להתחיל ב-https://";
}

export function isPrivateHost(host: string) {
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return true;
  if (host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
    return host.includes(":");
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}
