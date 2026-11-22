// MCP server: exposes the sales tools over the Model Context Protocol (stdio transport).
// Our own agent worker connects to it as an MCP client, and the same server can be added to
// Claude Desktop or Cursor. Read tools return data; propose_* tools only create proposals that wait
// for a human: nothing with side effects is executed from here.
import "../../scripts/load-env";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createApproval } from "../lib/approvals";
import { freeSlots, isBusinessSlot, isFree, slotLabel } from "../lib/calendar";
import { findContact, getEmail } from "../lib/crm";
import { askKnowledge } from "../lib/knowledge";
import { quote } from "../lib/pricing";

const server = new McpServer({ name: "routewise-sales-tools", version: "1.0.0" });

const json = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true });

// The worker injects run_id itself; the model never sees or chooses it.
const runId = z.number().int().positive().describe("Agent run id (filled in by the runtime)");

// ---------- Read tools ----------

server.registerTool(
  "crm_find_contact",
  {
    title: "Find CRM contact",
    description: "Look up a contact in the CRM by email or company name. Returns the contact with deals and recent activities, or null if not found.",
    inputSchema: { email: z.string().optional(), company: z.string().optional() },
    annotations: { readOnlyHint: true },
  },
  async ({ email, company }) => {
    if (!email && !company) return fail("Provide email or company");
    return json(await findContact({ email, company }));
  },
);

server.registerTool(
  "pricing_quote",
  {
    title: "Price quote",
    description: "Calculate the RouteWise plan and price for a fleet size. Always use this instead of doing price math yourself.",
    inputSchema: {
      vehicles: z.number().int().positive().max(100000),
      annual: z.boolean().optional().describe("Annual billing (15% discount)"),
      nonprofit: z.boolean().optional().describe("Registered non-profit (20% discount)"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ vehicles, annual, nonprofit }) => json(quote(vehicles, { annual, nonprofit })),
);

server.registerTool(
  "knowledge_search",
  {
    title: "Search product knowledge base",
    description: "Ask the RouteWise knowledge base (RAG assistant) a product question. Returns an answer with sources. Use it for features, integrations, security, SLA, data hosting, trial and refund policy.",
    inputSchema: { question: z.string().min(3).max(500) },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ question }) => json(await askKnowledge(question)),
);

server.registerTool(
  "calendar_free_slots",
  {
    title: "Free meeting slots",
    description: "List free slots in the sales team calendar (business days, 10:00-16:00 Eastern). Use the returned start value in propose_meeting.",
    inputSchema: {
      days: z.number().int().min(1).max(14).optional().describe("How many days ahead to look (default 7)"),
      duration_minutes: z.union([z.literal(30), z.literal(45), z.literal(60)]).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ days, duration_minutes }) => json(await freeSlots(days ?? 7, duration_minutes ?? 30)),
);

// ---------- Proposal tools (need human approval) ----------

server.registerTool(
  "propose_reply",
  {
    title: "Propose email reply",
    description: "Propose a reply to the customer's email. It is NOT sent: a human reviews, edits and approves it first.",
    inputSchema: {
      run_id: runId,
      email_id: z.number().int().positive(),
      subject: z.string().min(3).max(200),
      body: z.string().min(20).max(4000),
    },
  },
  async ({ run_id, email_id, subject, body }) => {
    const email = await getEmail(email_id);
    if (!email) return fail(`Email ${email_id} not found`);
    return json(await createApproval(run_id, "send_reply", { email_id, to: email.from_email, subject, body }));
  },
);

server.registerTool(
  "propose_meeting",
  {
    title: "Propose meeting",
    description: "Propose booking a meeting with the sender in one of the free slots from calendar_free_slots. It is NOT booked until a human approves.",
    inputSchema: {
      run_id: runId,
      email_id: z.number().int().positive(),
      start: z.string().describe("ISO start time exactly as returned by calendar_free_slots"),
      duration_minutes: z.union([z.literal(30), z.literal(45), z.literal(60)]),
      title: z.string().min(3).max(120),
    },
  },
  async ({ run_id, email_id, start, duration_minutes, title }) => {
    const email = await getEmail(email_id);
    if (!email) return fail(`Email ${email_id} not found`);
    const when = new Date(start);
    if (Number.isNaN(when.getTime())) return fail("start is not a valid ISO time");
    if (!isBusinessSlot(when, duration_minutes) || !(await isFree(when, duration_minutes))) {
      return fail(`${slotLabel(when)} is not a free business slot. Call calendar_free_slots and pick one of those.`);
    }
    return json(
      await createApproval(run_id, "book_meeting", { email_id, attendee: email.from_email, start: when.toISOString(), duration_minutes, title, label: slotLabel(when) }),
    );
  },
);

server.registerTool(
  "propose_crm_update",
  {
    title: "Propose CRM update",
    description: "Propose creating or updating the sender's CRM contact, its stage and (for qualified leads) a deal. Applied only after human approval; the plan and price are calculated by the system from the vehicle count.",
    inputSchema: {
      run_id: runId,
      email_id: z.number().int().positive(),
      name: z.string().min(1),
      company: z.string().nullable().optional(),
      fleet_size: z.number().int().positive().nullable().optional(),
      stage: z.enum(["new", "qualified", "meeting", "disqualified"]),
      deal_vehicles: z.number().int().positive().nullable().optional().describe("Vehicles for a new open deal; omit if no deal yet"),
      note: z.string().min(5).max(1000).describe("Short summary for the CRM activity log"),
    },
  },
  async ({ run_id, email_id, name, company, fleet_size, stage, deal_vehicles, note }) => {
    const email = await getEmail(email_id);
    if (!email) return fail(`Email ${email_id} not found`);
    return json(
      await createApproval(run_id, "update_crm", {
        email_id,
        contact: { name, email: email.from_email, company: company ?? null, fleet_size: fleet_size ?? null },
        stage,
        deal: deal_vehicles ? { vehicles: deal_vehicles } : null,
        note,
      }),
    );
  },
);

// stdout belongs to the MCP protocol: log only to stderr
server.connect(new StdioServerTransport()).catch((err) => {
  console.error("MCP server failed:", err);
  process.exit(1);
});
