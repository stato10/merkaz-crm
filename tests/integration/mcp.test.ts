import { beforeAll, describe, expect, it } from "vitest";
import * as mcp from "@/app/api/mcp/route";
import { db, schema } from "@/db";
import { addKey, createTenant, type Tenant } from "../support/fixtures";

let t: Tenant;
let salesKey: string;

async function rpc(method: string, params: unknown = {}, key: string | null = t.key) {
  const headers = new Headers({ "content-type": "application/json", accept: "application/json, text/event-stream" });
  if (key) headers.set("authorization", `Bearer ${key}`);
  const res = await mcp.POST(
    new Request("http://localhost/api/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }),
  );
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  t = await createTenant("Mcp");
  salesKey = await addKey(t.orgId, t.userId, "sales");
  await db.insert(schema.contacts).values({ orgId: t.orgId, firstName: "Noa", lastName: "Mizrahi", email: "noa@mcp.test" });
});

describe("MCP server", () => {
  it("rejects requests without an API key", async () => {
    const r = await rpc("tools/list", {}, null);
    expect(r.status).toBe(401);
  });

  it("initializes", async () => {
    const r = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(r.status).toBe(200);
    expect(r.body.result.serverInfo.name).toBe("merkaz-crm");
    expect(r.body.result.capabilities.tools).toBeDefined();
  });

  it("lists the tools the key's role allows, with JSON schemas and hints", async () => {
    const admin = await rpc("tools/list");
    const names = admin.body.result.tools.map((x: { name: string }) => x.name);
    expect(names).toContain("handoff_to_human");
    const search = admin.body.result.tools.find((x: { name: string }) => x.name === "search_contacts");
    expect(search.inputSchema).toMatchObject({ type: "object", required: ["query"], additionalProperties: false });
    expect(search.annotations.readOnlyHint).toBe(true);

    const sales = await rpc("tools/list", {}, salesKey);
    const salesNames = sales.body.result.tools.map((x: { name: string }) => x.name);
    expect(salesNames).toContain("pipeline_summary");
    expect(salesNames).not.toContain("handoff_to_human");
  });

  it("calls tools inside the key's organization", async () => {
    const r = await rpc("tools/call", { name: "search_contacts", arguments: { query: "noa" } });
    expect(r.body.result.isError).toBeUndefined();
    expect(JSON.parse(r.body.result.content[0].text)).toEqual([expect.objectContaining({ name: "Noa Mizrahi", email: "noa@mcp.test" })]);
  });

  it("returns tool errors as isError results", async () => {
    const denied = await rpc("tools/call", { name: "update_ticket", arguments: { ticket_number: 1 } }, salesKey);
    expect(denied.body.result).toMatchObject({ isError: true });
    expect(denied.body.result.content[0].text).toContain("not allowed");
    const bad = await rpc("tools/call", { name: "get_ticket", arguments: { ticket_number: 999999 } });
    expect(bad.body.result).toMatchObject({ isError: true, content: [{ text: "Ticket #999999 does not exist" }] });
  });
});
