import http from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as contactItem from "@/app/api/v1/contacts/[id]/route";
import * as contactList from "@/app/api/v1/contacts/route";
import { db, schema } from "@/db";
import { verifyWebhook } from "@/lib/tokens";
import { MAX_ATTEMPTS, processDueDeliveries } from "@/lib/webhooks";
import { call, createTenant, type Tenant } from "../support/fixtures";

type Received = { event: string; body: string; signature: string; valid: boolean };
const SECRET = "whsec_integration";

let server: http.Server;
let base: string;
let received: Received[] = [];
let failNext = 0;
let t: Tenant;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const signature = String(req.headers["x-crm-signature"]);
      received.push({ event: String(req.headers["x-crm-event"]), body, signature, valid: verifyWebhook(SECRET, body, signature) });
      if (failNext > 0) {
        failNext--;
        res.writeHead(500).end();
      } else res.writeHead(200).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  t = await createTenant("Hooks");
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function endpoint(path: string, events: string[] = []) {
  const [ep] = await db
    .insert(schema.webhookEndpoints)
    .values({ orgId: t.orgId, url: base + path, secret: SECRET, events })
    .returning();
  return ep;
}

async function deliveriesFor(endpointId: string) {
  return db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.endpointId, endpointId));
}

describe("webhooks", () => {
  it("delivers signed events with the resource snapshot", async () => {
    const ep = await endpoint("/all");
    received = [];
    const c = await call(contactList.POST, { key: t.key, method: "POST", body: { first_name: "Hook", email: "hook@test.local" } });

    expect(received).toHaveLength(1);
    expect(received[0].event).toBe("contact.created");
    expect(received[0].valid).toBe(true);
    const payload = JSON.parse(received[0].body);
    expect(payload).toMatchObject({ type: "contact.created", data: { id: c.json.id, first_name: "Hook" } });
    expect(payload.id).toMatch(/^evt_/);
    expect(payload.data).not.toHaveProperty("org_id");

    const [d] = await deliveriesFor(ep.id);
    expect(d).toMatchObject({ status: "succeeded", attempts: 1, lastStatusCode: 200 });
    await db.update(schema.webhookEndpoints).set({ active: false }).where(eq(schema.webhookEndpoints.id, ep.id));
  });

  it("only sends subscribed events", async () => {
    const ep = await endpoint("/deletes-only", ["contact.deleted"]);
    received = [];
    const c = await call(contactList.POST, { key: t.key, method: "POST", body: { first_name: "Filter" } });
    expect(received).toHaveLength(0);
    await call(contactItem.DELETE, { key: t.key, method: "DELETE", params: { id: c.json.id } });
    expect(received.map((r) => r.event)).toEqual(["contact.deleted"]);
    expect(JSON.parse(received[0].body).data).toEqual({ id: c.json.id });
    await db.update(schema.webhookEndpoints).set({ active: false }).where(eq(schema.webhookEndpoints.id, ep.id));
  });

  it("retries failures with backoff until the endpoint recovers", async () => {
    const ep = await endpoint("/flaky");
    received = [];
    failNext = 1;
    await call(contactList.POST, { key: t.key, method: "POST", body: { first_name: "Retry" } });

    let [d] = await deliveriesFor(ep.id);
    expect(d).toMatchObject({ status: "pending", attempts: 1, lastStatusCode: 500 });
    expect(d.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 20_000);

    // Not due yet: the worker leaves it alone.
    await processDueDeliveries();
    [d] = await deliveriesFor(ep.id);
    expect(d.attempts).toBe(1);

    // Due now: the worker retries and it succeeds.
    await db.update(schema.webhookDeliveries).set({ nextAttemptAt: new Date(0) }).where(eq(schema.webhookDeliveries.id, d.id));
    await processDueDeliveries();
    [d] = await deliveriesFor(ep.id);
    expect(d).toMatchObject({ status: "succeeded", attempts: 2 });
    expect(received.filter((r) => r.valid)).toHaveLength(2);
    expect(new Set(received.map((r) => JSON.parse(r.body).id)).size).toBe(1); // same event id on retry
    await db.update(schema.webhookEndpoints).set({ active: false }).where(eq(schema.webhookEndpoints.id, ep.id));
  });

  it("gives up after the maximum number of attempts", async () => {
    const ep = await endpoint("/down");
    failNext = 1000;
    await call(contactList.POST, { key: t.key, method: "POST", body: { first_name: "Dead" } });
    const [first] = await deliveriesFor(ep.id);
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      await db.update(schema.webhookDeliveries).set({ nextAttemptAt: new Date(0) }).where(eq(schema.webhookDeliveries.id, first.id));
      await processDueDeliveries();
    }
    const [d] = await deliveriesFor(ep.id);
    expect(d).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    failNext = 0;
    await db.update(schema.webhookEndpoints).set({ active: false }).where(eq(schema.webhookEndpoints.id, ep.id));
  });

  it("does not deliver twice when two workers run at the same time", async () => {
    const ep = await endpoint("/concurrent");
    failNext = 1;
    await call(contactList.POST, { key: t.key, method: "POST", body: { first_name: "Once" } });
    expect((await deliveriesFor(ep.id))[0].status).toBe("pending");
    await db
      .update(schema.webhookDeliveries)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(schema.webhookDeliveries.endpointId, ep.id));
    received = [];
    await Promise.all([processDueDeliveries(), processDueDeliveries(), processDueDeliveries()]);
    expect(received).toHaveLength(1);
  });
});
