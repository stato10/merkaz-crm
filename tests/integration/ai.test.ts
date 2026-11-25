import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "@/db";
import { type Message, type ModelCall, runAgent, toolsForMode } from "@/lib/ai/agent";
import { type Principal, runTool } from "@/lib/ai/run-tool";
import { fromLocalInput } from "@/lib/labels";
import { createTenant, type Tenant } from "../support/fixtures";

let a: Tenant;
let b: Tenant;
let pa: Principal;
let contactId: string;
const TICKET = 1001;

async function seedTenant(t: Tenant, first: string) {
  const [c] = await db
    .insert(schema.contacts)
    .values({ orgId: t.orgId, firstName: first, lastName: "Levi", email: `${first.toLowerCase()}@acme.test`, phone: "050-1234567" })
    .returning();
  const [tk] = await db
    .insert(schema.tickets)
    .values({ orgId: t.orgId, number: TICKET, subject: `Login broken for ${first}`, contactId: c.id, priority: "high" })
    .returning();
  await db.insert(schema.ticketMessages).values({ orgId: t.orgId, ticketId: tk.id, kind: "inbound", body: "I cannot log in" });
  return c.id;
}

beforeAll(async () => {
  a = await createTenant("AiA");
  b = await createTenant("AiB");
  contactId = await seedTenant(a, "Dana");
  await seedTenant(b, "Other");
  pa = { orgId: a.orgId, actorId: a.userId, role: "owner", via: "agent" };
});

describe("CRM tools", () => {
  it("finds contacts by name, email and phone digits", async () => {
    for (const q of ["dana", "acme.test", "0501234567", "+972 50 123 4567"]) {
      const r = await runTool(pa, "search_contacts", { query: q });
      expect(r.ok).toBe(true);
      expect((r as { data: { name: string }[] }).data.map((c) => c.name)).toEqual(["Dana Levi"]);
    }
  });

  it("reads a ticket with its conversation, only within the tenant", async () => {
    const r = await runTool(pa, "get_ticket", { ticket_number: TICKET });
    expect(r).toMatchObject({
      ok: true,
      data: { number: TICKET, subject: "Login broken for Dana", contact: { id: contactId }, messages: [{ from: "customer", body: "I cannot log in" }] },
    });
    // Tenant B has its own #1001; A never sees it, and B never sees A's contact.
    const rb = await runTool({ ...pa, orgId: b.orgId, actorId: b.userId }, "get_contact", { contact_id: contactId });
    expect(rb).toEqual({ ok: false, error: `Contact ${contactId} does not exist` });
  });

  it("returns validation errors the model can read, instead of throwing", async () => {
    expect(await runTool(pa, "get_ticket", { ticket_number: "abc" })).toMatchObject({ ok: false, error: expect.stringContaining("Invalid input") });
    expect(await runTool(pa, "nope", {})).toEqual({ ok: false, error: "Unknown tool: nope" });
  });

  it("enforces the caller's role", async () => {
    const sales: Principal = { ...pa, role: "sales" };
    expect(await runTool(sales, "handoff_to_human", { ticket_number: TICKET, reason: "x" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("not allowed"),
    });
    expect(toolsForMode("copilot", sales).map((t) => t.name)).not.toContain("update_ticket");
  });

  it("hands a ticket off: internal note, reopened, priority only goes up, audited", async () => {
    const r = await runTool(pa, "handoff_to_human", { ticket_number: TICKET, reason: "Customer asks for a refund", priority: "normal" });
    expect(r).toMatchObject({ ok: true, data: { priority: "high", status: "open" } });
    const [t] = await db.select().from(schema.tickets).where(and(eq(schema.tickets.orgId, a.orgId), eq(schema.tickets.number, TICKET)));
    const notes = await db.select().from(schema.ticketMessages).where(and(eq(schema.ticketMessages.ticketId, t.id), eq(schema.ticketMessages.kind, "note")));
    expect(notes.map((n) => n.body)).toEqual(["🤖 הועבר לטיפול נציג: Customer asks for a refund"]);
    const audit = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.orgId, a.orgId), eq(schema.auditLog.action, "ticket.handoff")));
    expect(audit[0].metadata).toMatchObject({ via: "agent", tool: "handoff_to_human" });
  });

  it("books appointments and refuses overlaps for the same person", async () => {
    const day = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const ok = await runTool(pa, "book_appointment", { contact_id: contactId, title: "Demo", starts_at: `${day}T10:00`, duration_minutes: 60 });
    expect(ok).toMatchObject({ ok: true, data: { starts_at: `${day} 10:00` } });
    const [appt] = await db.select().from(schema.appointments).where(eq(schema.appointments.orgId, a.orgId));
    expect(appt.startsAt.getTime()).toBe(fromLocalInput(`${day}T10:00`)!.getTime());

    const clash = await runTool(pa, "book_appointment", { contact_id: contactId, title: "Other", starts_at: `${day}T10:30` });
    expect(clash).toMatchObject({ ok: false, error: expect.stringContaining("overlaps") });

    const avail = await runTool(pa, "check_availability", { date: day });
    expect(avail).toMatchObject({ ok: true, data: { booked: [{ from: "10:00", to: "11:00" }] } });
  });

  it("gives the drafting agent read-only tools plus handoff", () => {
    const names = toolsForMode("draft_reply", pa).map((t) => t.name);
    expect(names).toContain("get_ticket");
    expect(names).toContain("handoff_to_human");
    expect(names).not.toContain("book_appointment");
    expect(names).not.toContain("update_ticket");
  });
});

/* A scripted model: each call returns the next canned message. */
function scripted(turns: Partial<Message>[]): { call: ModelCall; seen: Parameters<ModelCall>[0][] } {
  const seen: Parameters<ModelCall>[0][] = [];
  let i = 0;
  const call: ModelCall = async (params, onText) => {
    seen.push(structuredClone(params));
    const m = turns[i++];
    for (const b of m.content ?? []) if (b.type === "text") onText(b.text);
    return {
      id: `msg_${i}`,
      type: "message",
      role: "assistant",
      model: params.model,
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
      ...m,
    } as Message;
  };
  return { call, seen };
}

describe("agent loop", () => {
  it("runs requested tools under the principal and returns the final answer", async () => {
    const { call, seen } = scripted([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "get_ticket", input: { ticket_number: TICKET } }] as never },
      { content: [{ type: "text", text: "שלום דנה, בדקנו ונחזור אלייך היום." }] as never },
    ]);
    const events: string[] = [];
    const r = await runAgent({
      principal: pa,
      mode: "draft_reply",
      messages: [{ role: "user", content: "Draft a reply to ticket #1001" }],
      call,
      onEvent: (e) => events.push(e.type),
    });
    expect(r.text).toBe("שלום דנה, בדקנו ונחזור אלייך היום.");
    expect(r.toolCalls).toEqual([{ name: "get_ticket", input: { ticket_number: TICKET }, ok: true }]);
    // The tool result went back to the model in one user message, with real data.
    const back = seen[1].messages.at(-1)!;
    expect(back.role).toBe("user");
    const result = (back.content as { type: string; content: string }[])[0];
    expect(result.type).toBe("tool_result");
    expect(JSON.parse(result.content)).toMatchObject({ number: TICKET, subject: "Login broken for Dana" });
    expect(events).toEqual(["tool_start", "tool_end", "text", "done"]);
    // Request shape: current model, refusal fallbacks, cached tool list, no mutating tools in drafts.
    expect(seen[0]).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
    expect(seen[0].tools!.at(-1)).toHaveProperty("cache_control");
    expect(seen[0].tools!.map((t) => (t as { name: string }).name)).not.toContain("book_appointment");
  });

  it("refuses tools outside the mode even if the model asks for them", async () => {
    const { call } = scripted([
      { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "update_ticket", input: { ticket_number: TICKET, status: "resolved" } }] as never },
      { content: [{ type: "text", text: "ok" }] as never },
    ]);
    const r = await runAgent({ principal: pa, mode: "draft_reply", messages: [{ role: "user", content: "x" }], call });
    expect(r.toolCalls).toEqual([{ name: "update_ticket", input: expect.anything(), ok: false }]);
    const [t] = await db.select().from(schema.tickets).where(and(eq(schema.tickets.orgId, a.orgId), eq(schema.tickets.number, TICKET)));
    expect(t.status).not.toBe("resolved");
  });

  it("stops on a refusal without running tools", async () => {
    const { call, seen } = scripted([
      { stop_reason: "refusal", content: [{ type: "tool_use", id: "t1", name: "get_ticket", input: {} }] as never },
    ]);
    const r = await runAgent({ principal: pa, mode: "copilot", messages: [{ role: "user", content: "x" }], call });
    expect(r.stopReason).toBe("refusal");
    expect(r.toolCalls).toEqual([]);
    expect(seen).toHaveLength(1);
  });
});
