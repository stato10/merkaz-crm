import "server-only";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { type AuditEntry, writeAudit } from "../audit";
import { log } from "../log";
import { roleCan, type RoleName } from "../permissions";
import { type CrmTool, crmTools, getTool, ToolError } from "./tools";

/** Who a tool call acts for, and through which surface. */
export type Principal = {
  orgId: string;
  actorId: string | null;
  role: RoleName;
  via: "agent" | "copilot" | "mcp" | "eval";
};

export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

/** Tools this role may call, optionally only read-only ones. Deterministic order (prompt cache). */
export function toolsFor(role: RoleName, opts: { readOnly?: boolean; include?: string[] } = {}): CrmTool[] {
  return crmTools.filter(
    (t) =>
      roleCan(role, t.permission) &&
      (opts.include?.includes(t.name) || !(opts.readOnly && t.mutates)),
  );
}

/**
 * Executes one tool call: permission check, input validation, an RLS-scoped
 * transaction, and audit entries written after commit. Never throws for
 * expected failures, so the model can read the error and recover.
 */
export async function runTool(p: Principal, name: string, rawInput: unknown): Promise<ToolResult> {
  const tool = getTool(name);
  if (!tool) return { ok: false, error: `Unknown tool: ${name}` };
  if (!roleCan(p.role, tool.permission)) {
    return { ok: false, error: `Your role (${p.role}) is not allowed to use ${name}` };
  }
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return { ok: false, error: `Invalid input: ${z.prettifyError(parsed.error)}` };
  }

  const audits: AuditEntry[] = [];
  const started = Date.now();
  try {
    const data = await withTenant(p.orgId, (tx) =>
      // Each tool's input type is checked by its own schema above.
      (tool.run as (ctx: unknown, input: unknown) => Promise<unknown>)(
        {
          orgId: p.orgId,
          actorId: p.actorId,
          role: p.role,
          tx,
          audit: (action: string, target: string, metadata?: Record<string, unknown>) =>
            audits.push({ orgId: p.orgId, actorId: p.actorId, action, target, metadata: { ...metadata, via: p.via, tool: name } }),
        },
        parsed.data,
      ),
    );
    for (const a of audits) await writeAudit(a);
    log.info("ai.tool", { tool: name, via: p.via, orgId: p.orgId, ms: Date.now() - started });
    return { ok: true, data };
  } catch (e) {
    if (e instanceof ToolError) return { ok: false, error: e.message };
    log.error("ai.tool_failed", { tool: name, via: p.via, orgId: p.orgId, err: e });
    return { ok: false, error: "The tool failed unexpectedly. Try a different approach or hand off to a human." };
  }
}
