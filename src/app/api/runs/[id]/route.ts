// GET /api/runs/:id → one agent run: the email, triage + qualification, the step timeline and the proposals
import { costUsd } from "@/agent/llm";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "Invalid id" }, { status: 400 });
  const run = await pool.query(
    `SELECT r.*, e.from_name, e.from_email, e.subject, e.body, e.received_at, e.category
     FROM agent_runs r JOIN emails e ON e.id = r.email_id WHERE r.id = $1`,
    [id],
  );
  if (!run.rows[0]) return Response.json({ error: "Not found" }, { status: 404 });
  const [steps, approvals] = await Promise.all([
    pool.query("SELECT id, agent, kind, name, data, ms, created_at FROM agent_steps WHERE run_id = $1 ORDER BY id", [id]),
    pool.query("SELECT id, kind, payload, status, decided_by, decided_at, result FROM approvals WHERE run_id = $1 ORDER BY id", [id]),
  ]);
  const r = run.rows[0];
  return Response.json({
    run: {
      id: Number(r.id), status: r.status, model: r.model, error: r.error, result: r.result,
      started_at: r.started_at, finished_at: r.finished_at,
      tokens: r.prompt_tokens + r.completion_tokens, cost_usd: costUsd(r.prompt_tokens, r.completion_tokens),
    },
    email: { id: Number(r.email_id), from_name: r.from_name, from_email: r.from_email, subject: r.subject, body: r.body, received_at: r.received_at, category: r.category },
    steps: steps.rows.map((s) => ({ ...s, id: Number(s.id) })),
    approvals: approvals.rows.map((a) => ({ ...a, id: Number(a.id) })),
  });
}
