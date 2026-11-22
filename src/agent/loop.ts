// The agent loop: the model picks tools, MCP executes them, results go back to the model, until it answers.
// Every step is written to agent_steps, which the dashboard shows as the run timeline.
import { pool } from "../lib/db";
import { config } from "../lib/config";
import { chat, type Message, type ToolDef } from "./llm";
import type { McpConnection, McpTool } from "./mcp-client";

export interface AgentDef {
  name: string; // triage / qualify / draft
  system: string;
  tools: string[]; // MCP tool names this agent may use
  output?: { name: string; schema: Record<string, unknown> }; // JSON schema for the final answer
  sequential?: boolean; // one tool call per turn, when later steps depend on earlier results
}

export interface RunContext {
  runId: number;
  emailId: number;
  mcp: McpConnection;
  usage: { prompt: number; completion: number };
}

// Fields the runtime fills in itself: the model never sees or chooses them.
const INJECTED = ["run_id", "email_id"] as const;

// Loop guards: a model that doesn't find what it wants tends to repeat the same call.
const MAX_CALLS_PER_TOOL = 3;
const stableKey = (name: string, args: Record<string, unknown>) =>
  `${name}:${JSON.stringify(Object.fromEntries(Object.entries(args).sort(([a], [b]) => a.localeCompare(b))))}`;

export async function logStep(runId: number, agent: string, kind: string, name: string | null, data: unknown, ms?: number) {
  await pool.query("INSERT INTO agent_steps (run_id, agent, kind, name, data, ms) VALUES ($1, $2, $3, $4, $5, $6)", [
    runId, agent, kind, name, data === undefined ? null : JSON.stringify(data), ms ?? null,
  ]);
}

function toOpenAiTool(tool: McpTool): ToolDef {
  const properties = { ...(tool.inputSchema.properties ?? {}) };
  for (const key of INJECTED) delete properties[key];
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        ...tool.inputSchema,
        properties,
        required: (tool.inputSchema.required ?? []).filter((r) => !(INJECTED as readonly string[]).includes(r)),
      },
    },
  };
}

const truncate = (s: string, n = 4000) => (s.length > n ? `${s.slice(0, n)}… [truncated]` : s);

export async function runAgent<T = string>(def: AgentDef, input: string, ctx: RunContext): Promise<T> {
  const available = ctx.mcp.tools.filter((t) => def.tools.includes(t.name));
  const tools = available.map(toOpenAiTool);
  const messages: Message[] = [
    { role: "system", content: def.system },
    { role: "user", content: input },
  ];
  await logStep(ctx.runId, def.name, "handoff", `${def.name} agent started`, { tools: available.map((t) => t.name) });
  const seen = new Set<string>();
  const callsPerTool = new Map<string, number>();

  for (let step = 0; step < config.maxToolSteps; step++) {
    const started = Date.now();
    // Last step: tools are switched off, so the model has to answer with what it has.
    const lastStep = step === config.maxToolSteps - 1;
    if (lastStep && tools.length) {
      messages.push({ role: "user", content: "Tool budget is used up. Give your final answer now with the information you already have." });
    }
    const { message, usage } = await chat(messages, {
      tools,
      jsonSchema: def.output,
      parallelTools: !def.sequential,
      toolChoice: lastStep ? "none" : "auto",
    });
    ctx.usage.prompt += usage.prompt_tokens;
    ctx.usage.completion += usage.completion_tokens;
    await logStep(ctx.runId, def.name, "llm", message.tool_calls?.length ? "chose tools" : "answered", {
      tokens: usage, tool_calls: message.tool_calls?.map((c) => c.function.name),
    }, Date.now() - started);

    messages.push({ role: "assistant", content: message.content, tool_calls: message.tool_calls });

    if (!message.tool_calls?.length) {
      const text = message.content ?? "";
      const result = def.output ? JSON.parse(text) : text;
      await logStep(ctx.runId, def.name, "output", null, result);
      return result as T;
    }

    for (const call of message.tool_calls) {
      const tool = available.find((t) => t.name === call.function.name);
      let resultText: string;
      let isError = false;
      const t0 = Date.now();
      try {
        if (!tool) throw new Error(`Tool ${call.function.name} is not allowed for the ${def.name} agent`);
        const args = JSON.parse(call.function.arguments || "{}") as Record<string, unknown>;
        // Inject context: the current run and email, whatever the model wrote.
        const props = tool.inputSchema.properties ?? {};
        if ("run_id" in props) args.run_id = ctx.runId;
        if ("email_id" in props) args.email_id = ctx.emailId;
        const key = stableKey(call.function.name, args);
        const count = (callsPerTool.get(call.function.name) ?? 0) + 1;
        await logStep(ctx.runId, def.name, "tool_call", call.function.name, args);
        if (seen.has(key)) {
          resultText = "Duplicate call skipped: you already have this result above. Continue with the information you have.";
          isError = true;
        } else if (count > MAX_CALLS_PER_TOOL) {
          resultText = `Limit reached: ${call.function.name} can be called at most ${MAX_CALLS_PER_TOOL} times. Continue with the information you have.`;
          isError = true;
        } else {
          seen.add(key);
          callsPerTool.set(call.function.name, count);
          const r = await ctx.mcp.call(call.function.name, args);
          resultText = r.text;
          isError = r.isError;
        }
      } catch (err) {
        resultText = `Error: ${err instanceof Error ? err.message : String(err)}`;
        isError = true;
      }
      await logStep(ctx.runId, def.name, "tool_result", call.function.name, { ok: !isError, result: truncate(resultText, 1500) }, Date.now() - t0);
      messages.push({ role: "tool", tool_call_id: call.id, content: truncate(resultText) });
    }
  }
  throw new Error(`${def.name} agent did not finish within ${config.maxToolSteps} steps`);
}
