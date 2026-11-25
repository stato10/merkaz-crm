import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import * as contactItem from "@/app/api/v1/contacts/[id]/route";
import * as contactList from "@/app/api/v1/contacts/route";
import * as dealItem from "@/app/api/v1/deals/[id]/route";
import * as dealList from "@/app/api/v1/deals/route";
import * as me from "@/app/api/v1/me/route";
import * as stages from "@/app/api/v1/pipeline/stages/route";
import * as ticketList from "@/app/api/v1/tickets/route";
import { db, schema } from "@/db";
import { withTenant } from "@/db/tenant";
import { rateLimit } from "@/lib/rate-limit";
import { addKey, call, createTenant, type Tenant } from "../support/fixtures";

let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  a = await createTenant("Alpha");
  b = await createTenant("Beta");
});

describe("authentication", () => {
  it("rejects requests without a key or with an unknown key", async () => {
    expect((await call(contactList.GET)).status).toBe(401);
    const r = await call(contactList.GET, { key: "crm_live_0000000000000000000000000000" });
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("unauthorized");
    expect(r.json.error.request_id).toBeTruthy();
  });

  it("rejects a revoked key", async () => {
    const key = await addKey(a.orgId, a.userId, "admin");
    expect((await call(me.GET, { key })).status).toBe(200);
    await db.update(schema.apiKeys).set({ revokedAt: new Date() }).where(eq(schema.apiKeys.orgId, a.orgId));
    expect((await call(me.GET, { key })).status).toBe(401);
    a.key = await addKey(a.orgId, a.userId, "admin");
  });

  it("returns the key's organization and rate-limit headers", async () => {
    const r = await call(me.GET, { key: a.key });
    expect(r.json.organization).toEqual({ id: a.orgId, name: "Alpha" });
    expect(r.headers.get("ratelimit-limit")).toBe("120");
    expect(r.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("contacts", () => {
  it("creates, reads, updates and deletes a contact", async () => {
    const created = await call(contactList.POST, {
      key: a.key,
      method: "POST",
      body: { first_name: "Noa", last_name: "Levi", email: "noa@alpha.test", tags: ["vip", "vip"] },
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ first_name: "Noa", status: "lead", tags: ["vip"], owner_id: a.userId });
    expect(created.json).not.toHaveProperty("org_id");
    const id = created.json.id;

    const got = await call(contactItem.GET, { key: a.key, params: { id } });
    expect(got.json.email).toBe("noa@alpha.test");

    const patched = await call(contactItem.PATCH, { key: a.key, method: "PATCH", params: { id }, body: { status: "customer" } });
    expect(patched.json.status).toBe("customer");

    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.target, id));
    expect(audit.map((x) => x.action).sort()).toEqual(["contact.create", "contact.update"]);
    expect(audit[0].metadata).toMatchObject({ via: "api" });

    expect((await call(contactItem.DELETE, { key: a.key, method: "DELETE", params: { id } })).status).toBe(204);
    expect((await call(contactItem.GET, { key: a.key, params: { id } })).status).toBe(404);
  });

  it("returns field-level validation errors", async () => {
    const r = await call(contactList.POST, { key: a.key, method: "POST", body: { first_name: "", email: "nope" } });
    expect(r.status).toBe(422);
    expect(r.json.error.details.map((d: { path: string }) => d.path).sort()).toEqual(["email", "first_name"]);
  });

  it("rejects malformed JSON", async () => {
    const res = await contactList.POST(
      new (await import("next/server")).NextRequest("http://localhost/api/v1/contacts", {
        method: "POST",
        headers: { authorization: `Bearer ${a.key}` },
        body: "{oops",
      }),
      { params: Promise.resolve({}) } as never,
    );
    expect(res.status).toBe(400);
  });

  it("paginates with a stable cursor", async () => {
    for (let i = 0; i < 5; i++) {
      await call(contactList.POST, { key: b.key, method: "POST", body: { first_name: `Page${i}` } });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const path: string = `/api/v1/contacts?limit=2${cursor ? `&cursor=${cursor}` : ""}`;
      const r = await call(contactList.GET, { key: b.key, path });
      expect(r.json.data.length).toBeLessThanOrEqual(2);
      seen.push(...r.json.data.map((c: { id: string }) => c.id));
      cursor = r.json.next_cursor;
    } while (cursor);
    expect(seen.length).toBe(5);
    expect(new Set(seen).size).toBe(5);
  });
});

describe("tenant isolation", () => {
  it("never shows one organization's records to another", async () => {
    const mine = await call(contactList.POST, { key: a.key, method: "POST", body: { first_name: "Private" } });
    const id = mine.json.id;

    expect((await call(contactItem.GET, { key: b.key, params: { id } })).status).toBe(404);
    expect((await call(contactItem.PATCH, { key: b.key, method: "PATCH", params: { id }, body: { first_name: "Hacked" } })).status).toBe(404);
    expect((await call(contactItem.DELETE, { key: b.key, method: "DELETE", params: { id } })).status).toBe(404);
    const list = await call(contactList.GET, { key: b.key, path: "/api/v1/contacts?limit=100" });
    expect(list.json.data.map((c: { id: string }) => c.id)).not.toContain(id);
  });

  it("enforces isolation in Postgres even when a query has no org filter", async () => {
    await call(contactList.POST, { key: a.key, method: "POST", body: { first_name: "RLS" } });
    const total = await db.select({ n: sql<number>`count(distinct org_id)::int` }).from(schema.contacts);
    expect(total[0].n).toBeGreaterThan(1);

    // A deliberately unscoped query inside the tenant transaction.
    const orgs = await withTenant(b.orgId, (tx) => tx.execute<{ org_id: string }>(sql`select distinct org_id from contacts`));
    expect([...orgs].map((r) => r.org_id)).toEqual([b.orgId]);

    // Writing a row for another tenant is rejected by the policy's WITH CHECK.
    await expect(
      withTenant(b.orgId, (tx) => tx.insert(schema.contacts).values({ orgId: a.orgId, firstName: "Sneaky" })),
    ).rejects.toThrow();
  });

  it("rejects references to another organization's records", async () => {
    const theirs = await call(contactList.POST, { key: a.key, method: "POST", body: { first_name: "Theirs" } });
    const r = await call(dealList.POST, { key: b.key, method: "POST", body: { title: "Steal", contact_id: theirs.json.id } });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("invalid_reference");
  });
});

describe("roles", () => {
  it("limits a key to its role", async () => {
    const agentKey = await addKey(a.orgId, a.userId, "agent");
    expect((await call(dealList.GET, { key: agentKey })).status).toBe(200);
    const r = await call(dealList.POST, { key: agentKey, method: "POST", body: { title: "No" } });
    expect(r.status).toBe(403);
    expect((await call(ticketList.POST, { key: agentKey, method: "POST", body: { subject: "Help", body: "Printer" } })).status).toBe(201);
  });
});

describe("deals", () => {
  it("follows the pipeline rules: default stage, moves, lost reason, won makes a customer", async () => {
    const st = await call(stages.GET, { key: a.key });
    expect(st.json.data.length).toBeGreaterThanOrEqual(2);
    const [first, second] = st.json.data;

    const contact = await call(contactList.POST, { key: a.key, method: "POST", body: { first_name: "Buyer" } });
    const deal = await call(dealList.POST, {
      key: a.key,
      method: "POST",
      body: { title: "Annual plan", amount: 48000, contact_id: contact.json.id },
    });
    expect(deal.status).toBe(201);
    expect(deal.json).toMatchObject({ stage_id: first.id, status: "open", currency: "ILS" });
    const id = deal.json.id;

    const moved = await call(dealItem.PATCH, { key: a.key, method: "PATCH", params: { id }, body: { stage_id: second.id } });
    expect(moved.json.stage_id).toBe(second.id);

    const lost = await call(dealItem.PATCH, { key: a.key, method: "PATCH", params: { id }, body: { status: "lost" } });
    expect(lost.status).toBe(422);

    const won = await call(dealItem.PATCH, { key: a.key, method: "PATCH", params: { id }, body: { status: "won" } });
    expect(won.json.status).toBe("won");
    expect(won.json.closed_at).toBeTruthy();

    const buyer = await call(contactItem.GET, { key: a.key, params: { id: contact.json.id } });
    expect(buyer.json.status).toBe("customer");

    const blocked = await call(dealItem.PATCH, { key: a.key, method: "PATCH", params: { id }, body: { stage_id: first.id } });
    expect(blocked.status).toBe(409);

    const timeline = await db.select().from(schema.activities).where(eq(schema.activities.dealId, id));
    expect(timeline.length).toBe(3); // opened, moved, won
  });
});

describe("rate limiting", () => {
  it("allows the limit and then refuses within the window", async () => {
    const bucket = `test:${Math.random()}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rateLimit(bucket, 3, 60));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3].remaining).toBe(0);
  });

  it("is atomic under concurrent requests", async () => {
    const bucket = `test:${Math.random()}`;
    const results = await Promise.all(Array.from({ length: 20 }, () => rateLimit(bucket, 10, 60)));
    expect(results.filter((r) => r.allowed).length).toBe(10);
  });
});
