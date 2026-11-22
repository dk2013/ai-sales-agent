// Orchestration is plain code, not another LLM: triage → (lead) qualify → draft, or (support) support.
// Fixed order = predictable cost and behaviour; the agents decide only within their own step.
import { config } from "../lib/config";
import { getEmail } from "../lib/crm";
import { pool } from "../lib/db";
import { planForFleet } from "../lib/pricing";
import { draftAgent, qualifyAgent, supportAgent, triageAgent, type Qualification, type Triage } from "./agents";
import { costUsd } from "./llm";
import { logStep, runAgent, type RunContext } from "./loop";
import type { McpConnection } from "./mcp-client";

function emailBlock(e: { id: number; from_name: string; from_email: string; subject: string; body: string; received_at: Date }) {
  return `<email id="${e.id}" received="${new Date(e.received_at).toISOString()}">
From: ${e.from_name} <${e.from_email}>
Subject: ${e.subject}

${e.body}
</email>`;
}

export async function processEmail(emailId: number, mcp: McpConnection): Promise<number> {
  const email = await getEmail(emailId);
  if (!email) throw new Error(`Email ${emailId} not found`);
  await pool.query("UPDATE emails SET status = 'processing' WHERE id = $1", [emailId]);
  const { rows } = await pool.query("INSERT INTO agent_runs (email_id, model) VALUES ($1, $2) RETURNING id", [emailId, config.openaiModel]);
  const runId = Number(rows[0].id);
  const ctx: RunContext = { runId, emailId, mcp, usage: { prompt: 0, completion: 0 } };
  const block = emailBlock(email);
  const result: Record<string, unknown> = {};

  try {
    const triage = await runAgent<Triage>(triageAgent, block, ctx);
    result.triage = triage;
    await pool.query("UPDATE emails SET category = $2 WHERE id = $1", [emailId, triage.category]);

    if (triage.category === "lead") {
      const qualification = await runAgent<Qualification>(
        qualifyAgent,
        `${block}\n\nTriage result:\n${JSON.stringify(triage, null, 2)}`,
        ctx,
      );
      // Business rule in code: the plan follows the fleet size, whatever the model said.
      // No fleet size in the email → no plan yet (the reply should ask for it).
      const rulePlan = triage.fleet_size ? planForFleet(triage.fleet_size) : "unknown";
      if (qualification.plan !== rulePlan) {
        await logStep(runId, "orchestrator", "output", "plan corrected by business rule", { model_said: qualification.plan, rule: rulePlan });
        qualification.plan = rulePlan;
        if (rulePlan === "unknown") qualification.quote_summary = null;
      }
      result.qualification = qualification;
      await runAgent(
        draftAgent,
        `${block}\n\nTriage result:\n${JSON.stringify(triage, null, 2)}\n\nQualification brief:\n${JSON.stringify(qualification, null, 2)}`,
        ctx,
      );
    } else if (triage.category === "support") {
      await runAgent(supportAgent, `${block}\n\nTriage result:\n${JSON.stringify(triage, null, 2)}`, ctx);
    } else {
      await logStep(runId, "orchestrator", "output", `no action: ${triage.category}`, { reason: triage.summary });
    }

    const pending = await pool.query("SELECT count(*)::int AS n FROM approvals WHERE run_id = $1 AND status = 'pending'", [runId]);
    const waiting = pending.rows[0].n > 0;
    await pool.query(
      `UPDATE agent_runs SET status = $2, result = $3, prompt_tokens = $4, completion_tokens = $5,
         finished_at = CASE WHEN $2 = 'completed' THEN now() ELSE NULL END WHERE id = $1`,
      [runId, waiting ? "awaiting_approval" : "completed", result, ctx.usage.prompt, ctx.usage.completion],
    );
    await pool.query("UPDATE emails SET status = $2 WHERE id = $1", [
      emailId,
      waiting ? "awaiting_approval" : triage.category === "spam" ? "ignored" : "done",
    ]);
    return runId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logStep(runId, "orchestrator", "error", "run failed", { message });
    await pool.query(
      "UPDATE agent_runs SET status = 'failed', error = $2, result = $3, prompt_tokens = $4, completion_tokens = $5, finished_at = now() WHERE id = $1",
      [runId, message, result, ctx.usage.prompt, ctx.usage.completion],
    );
    await pool.query("UPDATE emails SET status = 'failed' WHERE id = $1", [emailId]);
    throw err;
  }
}

export async function runCost(runId: number) {
  const { rows } = await pool.query("SELECT prompt_tokens, completion_tokens FROM agent_runs WHERE id = $1", [runId]);
  return rows[0] ? costUsd(rows[0].prompt_tokens, rows[0].completion_tokens) : 0;
}
