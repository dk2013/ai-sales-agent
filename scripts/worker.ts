import "./load-env";

// Usage: npm run worker — processes queued emails one by one (keeps one MCP connection open).
async function main() {
  const { connectMcp } = await import("../src/agent/mcp-client");
  const { processEmail } = await import("../src/agent/orchestrator");
  const { claimJob, finishJob, failJob } = await import("../src/lib/jobs");
  const { config } = await import("../src/lib/config");
  const { pool } = await import("../src/lib/db");
  const { resetSandbox } = await import("../src/lib/seed");

  // Public demo: reset the sandbox once a day after 04:00 Toronto time, so every visitor starts fresh.
  let lastResetCheck = 0;
  async function nightlyReset() {
    if (!config.demoMode || Date.now() - lastResetCheck < 60_000) return;
    lastResetCheck = Date.now();
    const local = new Intl.DateTimeFormat("en-CA", { timeZone: config.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(new Date());
    const part = (t: string) => local.find((p) => p.type === t)?.value ?? "";
    const today = `${part("year")}-${part("month")}-${part("day")}`;
    if (Number(part("hour")) < 4) return;
    const { rows } = await pool.query("SELECT value FROM meta WHERE key = 'last_demo_reset'");
    if (rows[0]?.value === today) return;
    await resetSandbox();
    await pool.query("INSERT INTO meta (key, value) VALUES ('last_demo_reset', $1) ON CONFLICT (key) DO UPDATE SET value = $1", [today]);
    console.log(`worker: nightly sandbox reset for ${today}`);
  }

  const mcp = await connectMcp();
  console.log(`worker: connected to MCP (${mcp.tools.length} tools), waiting for jobs`);
  let stopping = false;
  const stop = async () => {
    stopping = true;
    await mcp.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (!stopping) {
    await nightlyReset().catch((err) => console.error("worker: nightly reset failed", err.message));
    const job = await claimJob().catch((err) => {
      console.error("worker: claim failed", err.message);
      return null;
    });
    if (!job) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    const started = Date.now();
    try {
      const runId = await processEmail(job.payload.email_id, mcp);
      await finishJob(job.id);
      console.log(`worker: email ${job.payload.email_id} → run ${runId} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await failJob(job, message);
      console.error(`worker: email ${job.payload.email_id} failed: ${message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
