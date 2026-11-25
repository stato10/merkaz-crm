import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { type Principal, runTool, toolsFor } from "@/lib/ai/run-tool";
import { inputSchema } from "@/lib/ai/tools";
import { authenticate, RATE_LIMIT } from "@/lib/api/handler";
import type { RoleName } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";

/**
 * MCP server over Streamable HTTP: the same CRM tools the in-app agent uses,
 * for Claude Desktop, Claude Code or any MCP client. Authenticated with an
 * API key; the key's role decides which tools are listed and callable, and
 * every call runs under row-level security for the key's organization.
 *
 * Stateless: a new server per request, JSON responses, no sessions to keep.
 */

function unauthorized(message: string, status = 401) {
  return Response.json({ jsonrpc: "2.0", error: { code: -32001, message }, id: null }, { status });
}

function mcpServer(p: Principal) {
  const server = new Server(
    { name: "merkaz-crm", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Tools over a Hebrew CRM (contacts, companies, deals, service tickets, appointments). Look records up before acting; ticket numbers like #1003 are what get_ticket takes. Amounts are in ILS, times are Israel time.",
    },
  );
  const tools = toolsFor(p.role);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: inputSchema(t) as { type: "object" },
      annotations: { readOnlyHint: !t.mutates, destructiveHint: false, openWorldHint: false },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const r = await runTool(p, req.params.name, req.params.arguments ?? {});
    return r.ok
      ? { content: [{ type: "text", text: JSON.stringify(r.data, null, 2) }], structuredContent: { result: r.data } }
      : { content: [{ type: "text", text: r.error }], isError: true };
  });
  return server;
}

async function handle(req: Request) {
  const key = await authenticate(req);
  if (!key) return unauthorized("Missing or invalid API key. Send it as: Authorization: Bearer crm_live_…");
  const rl = await rateLimit(`api:${key.id}`, RATE_LIMIT.limit, RATE_LIMIT.windowSec);
  if (!rl.allowed) return unauthorized("Rate limit exceeded", 429);

  const server = mcpServer({ orgId: key.orgId, actorId: key.createdById, role: key.role as RoleName, via: "mcp" });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await server.close();
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
