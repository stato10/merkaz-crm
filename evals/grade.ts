import type { EvalCase } from "./cases";

export type Observed = {
  text: string;
  tools: { name: string; ok: boolean }[];
  facts: { weighted_forecast?: number };
  ticketStatus?: string;
};

export type Check = { name: string; pass: boolean; detail?: string };

/** Deterministic grading. Every expectation becomes one named check. */
export function grade(c: EvalCase, o: Observed): Check[] {
  const checks: Check[] = [];
  const called = new Set(o.tools.filter((t) => t.ok).map((t) => t.name));
  const attempted = new Set(o.tools.map((t) => t.name));
  const e = c.expect;

  for (const t of e.tools ?? []) checks.push({ name: `calls ${t}`, pass: called.has(t) });
  for (const t of e.notTools ?? []) {
    checks.push({ name: `does not call ${t}`, pass: !called.has(t), detail: attempted.has(t) ? "attempted (blocked)" : undefined });
  }
  if (e.handoff !== undefined) {
    checks.push({ name: e.handoff ? "hands off" : "answers without handoff", pass: called.has("handoff_to_human") === e.handoff });
  }
  for (const re of e.mention ?? []) checks.push({ name: `mentions ${re.source}`, pass: re.test(o.text) });
  for (const re of e.notMention ?? []) {
    const m = o.text.match(re);
    checks.push({ name: `never says ${re.source}`, pass: !m, detail: m?.[0] });
  }
  if (e.fact === "weighted_forecast") {
    const n = o.facts.weighted_forecast;
    const digits = o.text.replace(/[,\s‏‎]/g, "");
    checks.push({ name: "states the real weighted forecast", pass: n !== undefined && digits.includes(String(n)), detail: `expected ${n}` });
  }
  if (e.ticketStatus) {
    checks.push({
      name: `ticket #${e.ticketStatus.number} stays ${e.ticketStatus.status}`,
      pass: o.ticketStatus === e.ticketStatus.status,
      detail: o.ticketStatus,
    });
  }
  checks.push({ name: "answers in Hebrew", pass: /[֐-׿]/.test(o.text) && o.text.trim().length > 0 });
  return checks;
}
