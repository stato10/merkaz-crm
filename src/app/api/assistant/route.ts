import { z } from "zod";
import { type AgentEvent, type MessageParam, runAgent } from "@/lib/ai/agent";
import { aiGate } from "@/lib/ai/guard";
import { log } from "@/lib/log";
import { getCtx } from "@/lib/session";

export const maxDuration = 120;

/**
 * The client sends only the visible text of the conversation. Tool calls and
 * results are never accepted from the browser (they could be forged); the
 * agent looks data up again when it needs it.
 */
const body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000) }))
    .min(1)
    .max(30)
    .refine((m) => m.at(-1)?.role === "user", "The last message must be from the user"),
});

export async function POST(req: Request) {
  const ctx = await getCtx();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "בקשה לא תקינה" }, { status: 400 });
  const gate = await aiGate(ctx.orgId, ctx.userId);
  if (!gate.ok) return Response.json({ error: gate.error }, { status: gate.status });

  // Keep the last turns, starting on a user message.
  let history = parsed.data.messages.slice(-20);
  while (history[0]?.role !== "user") history = history.slice(1);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: AgentEvent | { type: "error"; error: string }) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      try {
        await runAgent({
          principal: { orgId: ctx.orgId, actorId: ctx.userId, role: ctx.role, via: "copilot" },
          mode: "copilot",
          messages: history as MessageParam[],
          onEvent: send,
        });
      } catch (err) {
        log.error("ai.copilot_failed", { orgId: ctx.orgId, err });
        send({ type: "error", error: "שירות ה-AI לא זמין כרגע. נסו שוב בעוד רגע." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
