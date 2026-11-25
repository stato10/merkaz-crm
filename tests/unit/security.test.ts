import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, toApi } from "@/lib/api/dto";
import { roleCan } from "@/lib/permissions";
import {
  API_KEY_PREFIX,
  backoffSeconds,
  generateApiKey,
  hashToken,
  looksLikeApiKey,
  signWebhook,
  verifyWebhook,
} from "@/lib/tokens";
import { checkWebhookUrl, isPrivateHost } from "@/lib/webhook-url";

describe("API keys", () => {
  it("generates unique keys and stores only a hash", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.token).not.toBe(b.token);
    expect(a.token.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(a.hash).toBe(hashToken(a.token));
    expect(a.hash).not.toContain(a.token);
    expect(a.token.startsWith(a.prefix)).toBe(true);
    expect(looksLikeApiKey(a.token)).toBe(true);
    expect(looksLikeApiKey("crm_live_short")).toBe(false);
  });
});

describe("webhook signatures", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ type: "contact.created", data: { id: "1" } });
  const now = 1_800_000_000;

  it("verifies a valid signature", () => {
    expect(verifyWebhook(secret, body, signWebhook(secret, body, now), 300, now)).toBe(true);
  });

  it("rejects a tampered body, a wrong secret and a malformed header", () => {
    const sig = signWebhook(secret, body, now);
    expect(verifyWebhook(secret, body + " ", sig, 300, now)).toBe(false);
    expect(verifyWebhook("whsec_other", body, sig, 300, now)).toBe(false);
    expect(verifyWebhook(secret, body, "v1=abc", 300, now)).toBe(false);
  });

  it("rejects replays outside the tolerance window", () => {
    const sig = signWebhook(secret, body, now - 301);
    expect(verifyWebhook(secret, body, sig, 300, now)).toBe(false);
  });

  it("backs off exponentially and caps at six hours", () => {
    expect([1, 2, 3, 4].map(backoffSeconds)).toEqual([30, 60, 120, 240]);
    expect(backoffSeconds(30)).toBe(6 * 60 * 60);
  });
});

describe("webhook URL guard (SSRF)", () => {
  it("requires https in production and blocks internal hosts", () => {
    expect(checkWebhookUrl("https://hooks.example.com/x", true)).toBeNull();
    expect(checkWebhookUrl("http://hooks.example.com/x", true)).not.toBeNull();
    expect(checkWebhookUrl("https://127.0.0.1/x", true)).not.toBeNull();
    expect(checkWebhookUrl("https://169.254.169.254/latest/meta-data", true)).not.toBeNull();
    expect(checkWebhookUrl("https://user:pass@example.com", true)).not.toBeNull();
    expect(checkWebhookUrl("not a url", true)).not.toBeNull();
  });

  it("allows http to localhost only outside production", () => {
    expect(checkWebhookUrl("http://localhost:4000/hook", false)).toBeNull();
    expect(checkWebhookUrl("http://example.com/hook", false)).not.toBeNull();
  });

  it("classifies private ranges", () => {
    for (const h of ["10.0.0.1", "172.16.5.4", "192.168.1.1", "100.64.0.1", "::1", "fd00::1", "metadata.internal"]) {
      expect(isPrivateHost(h), h).toBe(true);
    }
    for (const h of ["8.8.8.8", "172.32.0.1", "example.com", "fcbarcelona.com"]) {
      expect(isPrivateHost(h), h).toBe(false);
    }
  });
});

describe("role permissions", () => {
  it("matches the documented role matrix", () => {
    expect(roleCan("owner", { deal: ["delete"], settings: ["update"] })).toBe(true);
    expect(roleCan("admin", { settings: ["update"] })).toBe(true);
    expect(roleCan("sales", { deal: ["create", "update"] })).toBe(true);
    expect(roleCan("sales", { deal: ["delete"] })).toBe(false);
    expect(roleCan("sales", { ticket: ["update"] })).toBe(false);
    expect(roleCan("agent", { ticket: ["update"] })).toBe(true);
    expect(roleCan("agent", { deal: ["create"] })).toBe(false);
    expect(roleCan("agent", { settings: ["update"] })).toBe(false);
    expect(roleCan("nobody", { contact: ["read"] })).toBe(false);
  });
});

describe("API DTOs", () => {
  it("uses snake_case, ISO dates and hides the tenant column", () => {
    const d = new Date("2026-01-02T03:04:05.000Z");
    expect(toApi({ id: "1", orgId: "secret", firstName: "Noa", createdAt: d })).toEqual({
      id: "1",
      first_name: "Noa",
      created_at: "2026-01-02T03:04:05.000Z",
    });
  });

  it("round-trips pagination cursors and rejects garbage", () => {
    const d = new Date("2026-01-02T03:04:05.000Z");
    expect(decodeCursor(encodeCursor(d, "abc"))).toEqual({ createdAt: d, id: "abc" });
    expect(decodeCursor("not-a-cursor")).toBeNull();
  });
});
