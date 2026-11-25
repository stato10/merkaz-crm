import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { log } from "../log";
import { type Principal, runTool, toolsFor } from "./run-tool";
import { type CrmTool, inputSchema } from "./tools";

export type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
export type Message = Anthropic.Beta.Messages.BetaMessage;
type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type ToolResultBlock = Anthropic.Beta.Messages.BetaToolResultBlockParam;
type ToolUseBlock = Anthropic.Beta.Messages.BetaToolUseBlock;

export const MODEL = "claude-opus-5-5";

/** One model turn. Injected in tests and evals; the default streams through the SDK. */
export type ModelCall = (params: Params, onText: (delta: string) => void) => Promise<Message>;

let client: Anthropic | null = null;

export const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

export const streamModel: ModelCall = async (params, onText) => {
  client ??= new Anthropic();
  const stream = client.beta.messages.stream(params);
  stream.on("text", onText);
  return stream.finalMessage();
};

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_end"; id: string; name: string; ok: boolean; error?: string }
  | { type: "done"; stopReason: string };

export type AgentMode = "copilot" | "draft_reply";

export type AgentResult = {
  /** Full transcript including tool calls, to continue the conversation. */
  messages: MessageParam[];
  /** The final assistant text. */
  text: string;
  toolCalls: { name: string; input: unknown; ok: boolean }[];
  stopReason: string;
  usage: { input: number; output: number; cacheRead: number };
};

const MAX_TURNS = 10;

const COMMON = `You work inside "מרכז", a Hebrew CRM for sales and customer service teams in Israel.
Ground every fact in the CRM: look records up with the tools instead of assuming, and never invent prices, dates, discounts, policies or promises. If the data does not answer the question, say so.
Amounts are in Israeli shekels (₪). Times are Israel time. Today is {{today}}.
Write in natural, warm, professional Hebrew unless the user writes in another language. Keep answers short and concrete.`;

const PROMPTS: Record<AgentMode, string> = {
  copilot: `${COMMON}

You are the team's copilot. The person you are talking to is a member of the team (role: {{role}}), not a customer.
Answer questions about customers, deals, tickets and the calendar, and carry out actions they ask for with the tools.
Before any change that a customer will see or that is hard to undo (booking an appointment, changing a ticket's status), state exactly what you are about to do in one line, then do it. When a tool fails, explain the problem plainly and suggest the next step.
Format with short lines or a compact list. Refer to tickets as #number.`,

  draft_reply: `${COMMON}

You draft replies to customers on service tickets. A human agent reviews your draft before it is sent, so write the message itself, addressed to the customer, ready to send.
Process:
1. Read the ticket with get_ticket, and the customer with get_contact when there is one.
2. Decide: can you answer helpfully and safely from what the CRM shows?
   - Yes: reply with the draft only. Acknowledge the issue, answer or give the concrete next step, and sign as "צוות התמיכה". No placeholders like [שם].
   - No: call handoff_to_human with a clear reason for the human agent, then reply with one line starting "הועבר לנציג:" and the reason.
Always hand off: refunds, credits, double charges or any billing dispute; price or contract changes; an angry customer or one threatening to leave; security, privacy or data-loss reports; anything you would have to guess.
Never promise a refund, a discount, a deadline or a fix that the CRM does not already show.`,
};

function systemPrompt(mode: AgentMode, p: Principal) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", dateStyle: "full" }).format(new Date());
  return PROMPTS[mode].replaceAll("{{today}}", today).replaceAll("{{role}}", p.role);
}

export function toolsForMode(mode: AgentMode, p: Principal): CrmTool[] {
  return mode === "draft_reply"
    ? toolsFor(p.role, { readOnly: true, include: ["handoff_to_human"] })
    : toolsFor(p.role);
}

function apiTools(tools: CrmTool[]): Anthropic.Beta.Messages.BetaTool[] {
  return tools.map((t, i) => ({
    name: t.name,
    description: t.description,
    input_schema: inputSchema(t) as Anthropic.Beta.Messages.BetaTool["input_schema"],
    // Cache the system prompt and the tool list together: they never change within a mode.
    ...(i === tools.length - 1 ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
}

/**
 * The agent loop: call Claude, run the tools it asks for (as the principal,
 * under RLS and RBAC), feed the results back, until it answers.
 */
export async function runAgent(opts: {
  principal: Principal;
  mode: AgentMode;
  messages: MessageParam[];
  onEvent?: (e: AgentEvent) => void;
  call?: ModelCall;
  effort?: "low" | "medium" | "high";
}): Promise<AgentResult> {
  const { principal, mode, onEvent = () => {}, call = streamModel } = opts;
  const tools = toolsForMode(mode, principal);
  const allowed = new Set(tools.map((t) => t.name));
  const messages = [...opts.messages];
  const toolCalls: AgentResult["toolCalls"] = [];
  const usage = { input: 0, output: 0, cacheRead: 0 };
  let text = "";
  let stopReason = "max_turns";

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const message = await call(
      {
        model: MODEL,
        max_tokens: 16000,
        system: [{ type: "text", text: systemPrompt(mode, principal) }],
        tools: apiTools(tools),
        messages,
        output_config: { effort: opts.effort ?? (mode === "draft_reply" ? "medium" : "low") },
        // A declined request is retried on a fallback model chosen by the API.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      (delta) => onEvent({ type: "text", text: delta }),
    );
    usage.input += message.usage.input_tokens;
    usage.output += message.usage.output_tokens;
    usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;

    text = message.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    stopReason = message.stop_reason ?? "end_turn";
    messages.push({ role: "assistant", content: message.content });

    if (message.stop_reason === "pause_turn") continue;
    // A refusal or a truncated turn can cut a tool call off mid-input: never run it.
    if (message.stop_reason !== "tool_use") break;

    const uses = message.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    const results: ToolResultBlock[] = await Promise.all(
      uses.map(async (u) => {
        onEvent({ type: "tool_start", id: u.id, name: u.name, input: u.input });
        const r = allowed.has(u.name)
          ? await runTool(principal, u.name, u.input)
          : { ok: false as const, error: `${u.name} is not available here` };
        toolCalls.push({ name: u.name, input: u.input, ok: r.ok });
        onEvent({ type: "tool_end", id: u.id, name: u.name, ok: r.ok, error: r.ok ? undefined : r.error });
        return {
          type: "tool_result" as const,
          tool_use_id: u.id,
          content: JSON.stringify(r.ok ? r.data : { error: r.error }),
          ...(r.ok ? {} : { is_error: true }),
        };
      }),
    );
    // All results of one turn go back in a single user message.
    messages.push({ role: "user", content: results });
  }

  if (stopReason === "refusal" && !text) text = "לא אוכל לעזור בבקשה הזו.";
  if (stopReason === "max_turns") log.warn("ai.max_turns", { mode, orgId: principal.orgId });
  onEvent({ type: "done", stopReason });
  log.info("ai.agent", { mode, via: principal.via, orgId: principal.orgId, tools: toolCalls.length, stopReason, ...usage });
  return { messages, text, toolCalls, stopReason, usage };
}
