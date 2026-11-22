import "./load-env";

// Usage: npm run worker — processes queued emails one by one (keeps one MCP connection open).
async function main() {
  const { connectMcp } = await import("../src/agent/mcp-client");
  const { processEmail } = await import("../src/agent/orchestrator");
  const { claimJob, finishJob, failJob } = await import("../src/lib/jobs");

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
