import "./load-env";

// Usage: npm run agent -- <email id or sample key>   — runs the agent team on one email and prints the timeline.
async function main() {
  const arg = process.argv[2];
  if (!arg) throw new Error("Usage: npm run agent -- <email id | sample key>");
  const { pool } = await import("../src/lib/db");
  const { connectMcp } = await import("../src/agent/mcp-client");
  const { processEmail, runCost } = await import("../src/agent/orchestrator");

  const { rows } = await pool.query("SELECT id FROM emails WHERE id::text = $1 OR sample_key = $1", [arg]);
  if (!rows[0]) throw new Error(`No email ${arg}`);
  const mcp = await connectMcp();
  const started = Date.now();
  try {
    const runId = await processEmail(Number(rows[0].id), mcp);
    const steps = await pool.query("SELECT agent, kind, name, data, ms FROM agent_steps WHERE run_id = $1 ORDER BY id", [runId]);
    for (const s of steps.rows) {
      const detail = s.kind === "tool_call" ? JSON.stringify(s.data) : s.kind === "output" ? JSON.stringify(s.data).slice(0, 300) : "";
      console.log(`  [${s.agent}] ${s.kind}${s.name ? ` ${s.name}` : ""}${s.ms ? ` (${s.ms}ms)` : ""} ${detail}`);
    }
    const approvals = await pool.query("SELECT kind, payload FROM approvals WHERE run_id = $1 ORDER BY id", [runId]);
    for (const a of approvals.rows) {
      const warnings = a.payload.warnings?.length ? `  WARNING: ${a.payload.warnings.join("; ")}` : "";
      console.log(`\n  PROPOSED ${a.kind}${warnings}`);
      console.log(`  ${JSON.stringify({ ...a.payload, warnings: undefined }, null, 2).replace(/\n/g, "\n  ")}`);
    }
    console.log(`\nrun ${runId}: ${((Date.now() - started) / 1000).toFixed(1)}s, $${(await runCost(runId)).toFixed(4)}`);
  } finally {
    await mcp.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
