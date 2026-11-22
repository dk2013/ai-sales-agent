import "./load-env";

// Usage: npx tsx scripts/mcp-smoke.ts   — starts the MCP server, lists tools, calls the read-only ones.
async function main() {
  const { connectMcp } = await import("../src/agent/mcp-client");
  const mcp = await connectMcp();
  console.log("Tools:", mcp.tools.map((t) => t.name).join(", "));
  const show = async (name: string, args: Record<string, unknown>) => {
    const r = await mcp.call(name, args);
    console.log(`\n${name}(${JSON.stringify(args)})${r.isError ? " ERROR" : ""}\n${r.text.slice(0, 600)}`);
  };
  await show("crm_find_contact", { email: "alex@novakcouriers.example" });
  await show("crm_find_contact", { email: "nobody@nowhere.example" });
  await show("pricing_quote", { vehicles: 60, annual: true });
  await show("pricing_quote", { vehicles: 12, nonprofit: true });
  await show("calendar_free_slots", { days: 5, duration_minutes: 30 });
  await show("propose_meeting", { run_id: 1, email_id: 1, start: "2026-11-28T15:00:00Z", duration_minutes: 30, title: "test" });
  await show("knowledge_search", { question: "Which RouteWise plan includes SSO?" });
  await mcp.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
