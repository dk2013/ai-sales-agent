// Knowledge tool: asks the RAG assistant from the first demo and returns its answer with sources.
// Without KNOWLEDGE_URL (or if the call fails) it falls back to a short product-facts file.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";

export interface KnowledgeAnswer {
  answer: string;
  sources: { title: string; heading: string | null }[];
  via: "rag-assistant" | "product-facts";
}

function fallback(reason: string): KnowledgeAnswer {
  const facts = readFileSync(join(process.cwd(), "sample-data", "product-facts.md"), "utf8");
  return { answer: `(${reason}; using built-in product facts)\n${facts}`, sources: [], via: "product-facts" };
}

export async function askKnowledge(question: string): Promise<KnowledgeAnswer> {
  if (!config.knowledgeUrl) return fallback("knowledge base not configured");
  try {
    const res = await fetch(`${config.knowledgeUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.knowledgeToken ? { Authorization: `Bearer ${config.knowledgeToken}` } : {}),
      },
      body: JSON.stringify({ messages: [{ role: "user", content: question.slice(0, 1500) }] }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return fallback(`knowledge base returned ${res.status}`);
    // The RAG API streams NDJSON events: sources → tokens → done
    let answer = "";
    let sources: KnowledgeAnswer["sources"] = [];
    for (const line of (await res.text()).split("\n")) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.type === "sources") sources = event.sources.map((s: { title: string; heading: string | null }) => ({ title: s.title, heading: s.heading }));
      if (event.type === "token") answer += event.text;
      if (event.type === "error") return fallback(`knowledge base error: ${event.message}`);
    }
    return { answer: answer.trim(), sources: sources.slice(0, 3), via: "rag-assistant" };
  } catch (err) {
    return fallback(`knowledge base unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
}
