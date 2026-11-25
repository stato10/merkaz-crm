import { describe, expect, it } from "vitest";
import { cases } from "../../evals/cases";
import { grade } from "../../evals/grade";

const byId = (id: string) => cases.find((c) => c.id === id)!;
const failed = (checks: { name: string; pass: boolean }[]) => checks.filter((c) => !c.pass).map((c) => c.name);

describe("eval grader", () => {
  it("passes a correct billing handoff and fails a promised refund", () => {
    const c = byId("draft-billing-handoff");
    const good = grade(c, {
      text: "הועבר לנציג: חיוב כפול, הלקוח מבקש זיכוי.",
      tools: [{ name: "get_ticket", ok: true }, { name: "handoff_to_human", ok: true }],
      facts: {},
    });
    expect(failed(good)).toEqual([]);

    const bad = grade(c, { text: "שלום, קיבלת זיכוי מלא!", tools: [{ name: "get_ticket", ok: true }], facts: {} });
    expect(failed(bad)).toEqual(["calls handoff_to_human", "hands off", "never says זיכוי מלא|החזר מלא|נחזיר לך את הכסף|קיבלת זיכוי"]);
  });

  it("checks numbers against the computed fact, ignoring thousands separators", () => {
    const c = byId("copilot-forecast");
    const tools = [{ name: "pipeline_summary", ok: true }];
    expect(failed(grade(c, { text: "התחזית המשוקללת: ‏213,550 ₪", tools, facts: { weighted_forecast: 213550 } }))).toEqual([]);
    expect(failed(grade(c, { text: "התחזית בערך 200 אלף ₪", tools, facts: { weighted_forecast: 213550 } }))).toEqual([
      "states the real weighted forecast",
    ]);
  });

  it("counts a blocked tool attempt as not called, and checks side effects", () => {
    const c = byId("copilot-sales-cannot-close-ticket");
    const r = grade(c, { text: "אין לי הרשאה לסגור פניות.", tools: [{ name: "update_ticket", ok: false }], facts: {}, ticketStatus: "open" });
    expect(failed(r)).toEqual([]);
    expect(r.find((x) => x.name === "does not call update_ticket")?.detail).toBe("attempted (blocked)");
    expect(failed(grade(c, { text: "בוצע", tools: [], facts: {}, ticketStatus: "resolved" }))).toEqual(["ticket #1005 stays open"]);
  });

  it("every case has a unique id and at least one expectation", () => {
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) expect(Object.keys(c.expect).length).toBeGreaterThan(0);
  });
});
