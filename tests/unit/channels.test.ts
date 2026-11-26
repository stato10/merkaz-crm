import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { openSecrets, sealSecrets } from "@/lib/channels/crypto";
import {
  nextDelivery,
  parseInboundEmail,
  parseWhatsApp,
  phoneDigits,
  ticketNumberFromSubject,
  verifyMetaSignature,
} from "@/lib/channels/parse";

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET ??= "unit-test-secret-unit-test-secret";
});

describe("channel secrets", () => {
  it("round-trips and does not store plaintext", () => {
    const sealed = sealSecrets({ accessToken: "EAAG-very-secret" });
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain("very-secret");
    expect(openSecrets(sealed)).toEqual({ accessToken: "EAAG-very-secret" });
  });

  it("rejects tampered ciphertext", () => {
    const sealed = sealSecrets({ a: "b" });
    const flipped = sealed.slice(0, -2) + (sealed.endsWith("A") ? "B" : "A") + sealed.slice(-1);
    expect(() => openSecrets(flipped)).toThrow();
  });
});

describe("inbound parsing", () => {
  it("normalizes Israeli phone numbers", () => {
    expect(phoneDigits("052-778 8990")).toBe("972527788990");
    expect(phoneDigits("+972 52 778 8990")).toBe("972527788990");
    expect(phoneDigits("00972527788990")).toBe("972527788990");
  });

  it("finds the ticket tag in a subject", () => {
    expect(ticketNumberFromSubject("Re: חיוב כפול [#1003]")).toBe(1003);
    expect(ticketNumberFromSubject("שאלה חדשה")).toBeNull();
  });

  it("parses Postmark inbound mail, preferring the stripped reply", () => {
    const m = parseInboundEmail({
      FromFull: { Email: "Dana@Example.co.il", Name: "דנה לוי" },
      Subject: "Re: התחברות [#1001]",
      TextBody: "תודה, עובד!\n\n> ציטוט ישן",
      StrippedTextReply: "תודה, עובד!",
      MessageID: "abc",
      Headers: [
        { Name: "Message-ID", Value: "<m1@mail.example>" },
        { Name: "In-Reply-To", Value: "<out1@mtasv.net>" },
      ],
    });
    expect(m).toMatchObject({
      from: "dana@example.co.il",
      name: "דנה לוי",
      body: "תודה, עובד!",
      externalId: "email:<m1@mail.example>",
      inReplyTo: "<out1@mtasv.net>",
    });
  });

  it("accepts the generic shape and rejects junk", () => {
    expect(parseInboundEmail({ from: "Avi <avi@x.co>", text: "שלום" })?.from).toBe("avi@x.co");
    expect(parseInboundEmail({ from: "not-an-email", text: "x" })).toBeNull();
    expect(parseInboundEmail(null)).toBeNull();
  });

  it("parses WhatsApp messages, media placeholders and statuses", () => {
    const p = parseWhatsApp({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "1234567890" },
                contacts: [{ wa_id: "972527788990", profile: { name: "יוסי" } }],
                messages: [
                  { from: "972527788990", id: "wamid.A", timestamp: "1764000000", type: "text", text: { body: "היי" } },
                  { from: "972527788990", id: "wamid.B", type: "image", image: { caption: "צילום מסך" } },
                ],
                statuses: [
                  { id: "wamid.OUT", status: "read" },
                  { id: "wamid.OUT2", status: "failed", errors: [{ code: 131047, title: "Re-engagement" }] },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(p.phoneNumberId).toBe("1234567890");
    expect(p.messages.map((m) => [m.externalId, m.name, m.body])).toEqual([
      ["wa:wamid.A", "יוסי", "היי"],
      ["wa:wamid.B", "יוסי", "[תמונה: צילום מסך]"],
    ]);
    expect(p.messages[0].at.getTime()).toBe(1764000000 * 1000);
    expect(p.statuses[0]).toEqual({ externalId: "wa:wamid.OUT", status: "read", error: null });
    expect(p.statuses[1].error).toContain("24 שעות");
  });

  it("verifies Meta signatures over the raw body", () => {
    const body = '{"entry":[]}';
    const sig = "sha256=" + createHmac("sha256", "app-secret").update(body).digest("hex");
    expect(verifyMetaSignature("app-secret", body, sig)).toBe(true);
    expect(verifyMetaSignature("app-secret", body + " ", sig)).toBe(false);
    expect(verifyMetaSignature("other", body, sig)).toBe(false);
    expect(verifyMetaSignature("app-secret", body, null)).toBe(false);
  });

  it("never moves delivery status backwards", () => {
    expect(nextDelivery("sent", "delivered")).toBe("delivered");
    expect(nextDelivery("read", "delivered")).toBeNull();
    expect(nextDelivery("delivered", "failed")).toBeNull();
    expect(nextDelivery("sent", "failed")).toBe("failed");
    expect(nextDelivery("failed", "read")).toBeNull();
  });
});
