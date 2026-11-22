// OpenAI Chat Completions with tool calling, on plain fetch (no SDK): every request is visible and simple.
import { config } from "../lib/config";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolDef {
  type: "function";
  function: { name: string; description?: string; parameters: Record<string, unknown> };
}

export interface ChatResult {
  message: { content: string | null; tool_calls?: ToolCall[] };
  usage: { prompt_tokens: number; completion_tokens: number };
}

export class LlmError extends Error {}

export async function chat(
  messages: Message[],
  opts: { tools?: ToolDef[]; jsonSchema?: { name: string; schema: Record<string, unknown> }; temperature?: number; parallelTools?: boolean; toolChoice?: "auto" | "none" } = {},
): Promise<ChatResult> {
  if (!config.openaiApiKey) throw new LlmError("OPENAI_API_KEY is not set");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.openaiApiKey}` },
    body: JSON.stringify({
      model: config.openaiModel,
      messages,
      temperature: opts.temperature ?? 0.2,
      ...(opts.tools?.length
        ? { tools: opts.tools, tool_choice: opts.toolChoice ?? "auto", ...(opts.toolChoice === "none" ? {} : { parallel_tool_calls: opts.parallelTools ?? true }) }
        : {}),
      // Structured output: the final answer must match this JSON schema
      ...(opts.jsonSchema ? { response_format: { type: "json_schema", json_schema: { ...opts.jsonSchema, strict: true } } } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`OpenAI error ${res.status}: ${body.slice(0, 500)}`);
    if (res.status === 429 && /quota|billing/i.test(body)) throw new LlmError("The AI budget is used up (OpenAI quota).");
    if (res.status === 429) throw new LlmError("OpenAI rate limit, try again in a minute.");
    if (res.status === 401) throw new LlmError("OpenAI API key is invalid.");
    throw new LlmError(`OpenAI request failed: ${res.status}`);
  }
  const data = await res.json();
  return { message: data.choices[0].message, usage: data.usage };
}

// gpt-4o-mini list prices per 1M tokens (override in .env if the model or prices change)
const PRICE_IN = Number(process.env.PRICE_INPUT_PER_M ?? 0.15);
const PRICE_OUT = Number(process.env.PRICE_OUTPUT_PER_M ?? 0.6);
export const costUsd = (promptTokens: number, completionTokens: number) =>
  (promptTokens * PRICE_IN + completionTokens * PRICE_OUT) / 1_000_000;
