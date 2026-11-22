// Proposed actions and their execution. The agents can only CREATE proposals;
// execute() runs after a human approves, and re-validates everything itself.
import type { PoolClient } from "pg";
import { isBusinessSlot, isFree, slotLabel } from "./calendar";
import { pool, withTransaction } from "./db";
import { planForFleet, quote, type Plan } from "./pricing";

export type ApprovalKind = "send_reply" | "book_meeting" | "update_crm";

export interface ReplyPayload { email_id: number; to: string; subject: string; body: string }
export interface MeetingPayload { email_id: number; attendee: string; start: string; duration_minutes: number; title: string; label?: string }
export interface CrmPayload {
  email_id: number;
  contact: { name: string; email: string; company?: string | null; fleet_size?: number | null };
  stage: "new" | "qualified" | "meeting" | "disqualified";
  deal?: { vehicles: number } | null;
  note: string;
}

// Cheap policy checks shown to the human reviewer next to the proposal.
export function policyWarnings(kind: ApprovalKind, payload: unknown): string[] {
  const warnings: string[] = [];
  if (kind === "send_reply") {
    const p = payload as ReplyPayload;
    const text = `${p.subject}\n${p.body}`;
    // Discounts: only 15% (annual) and 20% (non-profit) are allowed. Look at percentages near discount words,
    // so SLA terms like "a credit of 10% for each 0.1% below target" are not flagged.
    for (const m of text.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)) {
      const around = text.slice(Math.max(0, (m.index ?? 0) - 60), (m.index ?? 0) + 60).toLowerCase();
      const aboutDiscount = /discount|\boff\b|reduc|promo|cheaper|lifetime/.test(around);
      if (aboutDiscount && ![15, 20].includes(Number(m[1]))) warnings.push(`Offers a ${m[1]}% discount; only 15% (annual billing) and 20% (non-profit) are allowed.`);
    }
    const others = [...text.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)].map((m) => m[0]).filter((e) => e.toLowerCase() !== p.to.toLowerCase());
    if (others.length) warnings.push(`Contains other email addresses: ${others.join(", ")}`);
    if (/customer (list|emails)|list of (our|your) customers/i.test(text)) warnings.push("Mentions a customer list.");
  }
  return [...new Set(warnings)];
}

export async function createApproval(runId: number, kind: ApprovalKind, payload: object) {
  const warnings = policyWarnings(kind, payload);
  const { rows } = await pool.query(
    "INSERT INTO approvals (run_id, kind, payload) VALUES ($1, $2, $3) RETURNING id",
    [runId, kind, { ...payload, warnings }],
  );
  return { approval_id: Number(rows[0].id), status: "pending_human_approval", warnings };
}

async function upsertContact(c: PoolClient, p: CrmPayload["contact"], stage?: string): Promise<number> {
  const { rows } = await c.query(
    `INSERT INTO contacts (name, email, company, fleet_size, stage) VALUES ($1, $2, $3, $4, coalesce($5, 'new'))
     ON CONFLICT (email) DO UPDATE SET
       name = EXCLUDED.name,
       company = coalesce(EXCLUDED.company, contacts.company),
       fleet_size = coalesce(EXCLUDED.fleet_size, contacts.fleet_size),
       -- never downgrade an existing customer
       stage = CASE WHEN contacts.stage = 'customer' THEN contacts.stage ELSE coalesce($5, contacts.stage) END,
       updated_at = now()
     RETURNING id`,
    [p.name, p.email.toLowerCase(), p.company ?? null, p.fleet_size ?? null, stage ?? null],
  );
  return Number(rows[0].id);
}

async function contactIdByEmail(c: PoolClient, email: string): Promise<number | null> {
  const { rows } = await c.query("SELECT id FROM contacts WHERE lower(email) = lower($1)", [email]);
  return rows[0] ? Number(rows[0].id) : null;
}

async function executeOne(c: PoolClient, kind: ApprovalKind, payload: Record<string, unknown>) {
  if (kind === "update_crm") {
    const p = payload as unknown as CrmPayload;
    const contactId = await upsertContact(c, p.contact, p.stage);
    let deal = null;
    if (p.deal?.vehicles) {
      const q = quote(p.deal.vehicles);
      const { rows } = await c.query(
        `INSERT INTO deals (contact_id, plan, vehicles, monthly_value) VALUES ($1, $2, $3, $4) RETURNING id, plan, monthly_value`,
        [contactId, q.plan as Plan, p.deal.vehicles, q.monthly],
      );
      deal = rows[0];
    }
    await c.query("INSERT INTO activities (contact_id, type, summary) VALUES ($1, 'note', $2)", [contactId, p.note]);
    return { contact_id: contactId, deal };
  }
  if (kind === "book_meeting") {
    const p = payload as unknown as MeetingPayload;
    const start = new Date(p.start);
    if (!isBusinessSlot(start, p.duration_minutes) || !(await isFree(start, p.duration_minutes))) {
      throw new Error(`Slot ${slotLabel(start)} is no longer free`);
    }
    const end = new Date(start.getTime() + p.duration_minutes * 60_000);
    const { rows } = await c.query(
      "INSERT INTO calendar_events (title, starts_at, ends_at, attendee_email) VALUES ($1, $2, $3, $4) RETURNING id",
      [p.title, start.toISOString(), end.toISOString(), p.attendee],
    );
    const contactId = await contactIdByEmail(c, p.attendee);
    if (contactId) {
      await c.query("INSERT INTO activities (contact_id, type, summary) VALUES ($1, 'meeting', $2)", [contactId, `${p.title} — ${slotLabel(start)}`]);
      await c.query("UPDATE contacts SET stage = 'meeting', updated_at = now() WHERE id = $1 AND stage NOT IN ('customer')", [contactId]);
    }
    return { event_id: Number(rows[0].id), when: slotLabel(start) };
  }
  // send_reply: nothing leaves the sandbox, the message goes to the outbox table
  const p = payload as unknown as ReplyPayload;
  const { rows } = await c.query(
    "INSERT INTO outbox (email_id, to_email, subject, body) VALUES ($1, $2, $3, $4) RETURNING id",
    [p.email_id, p.to, p.subject, p.body],
  );
  const contactId = await contactIdByEmail(c, p.to);
  if (contactId) await c.query("INSERT INTO activities (contact_id, type, summary) VALUES ($1, 'email_out', $2)", [contactId, `Sent: ${p.subject}`]);
  return { outbox_id: Number(rows[0].id) };
}

// Approve or reject one proposal. Edits (for replies) are applied before execution.
export async function decide(
  approvalId: number,
  decision: "approve" | "reject",
  user: string,
  edits?: { subject?: string; body?: string },
) {
  return withTransaction(async (c) => {
    const { rows } = await c.query("SELECT id, run_id, kind, payload, status FROM approvals WHERE id = $1 FOR UPDATE", [approvalId]);
    const a = rows[0];
    if (!a) throw new Error("Approval not found");
    if (a.status !== "pending") throw new Error(`Already ${a.status}`);

    let payload = a.payload as Record<string, unknown>;
    if (decision === "approve" && a.kind === "send_reply" && edits) {
      payload = { ...payload, ...(edits.subject ? { subject: edits.subject } : {}), ...(edits.body ? { body: edits.body } : {}), edited: true };
    }
    const result = decision === "approve" ? await executeOne(c, a.kind, payload) : null;
    await c.query(
      "UPDATE approvals SET status = $2, payload = $3, decided_by = $4, decided_at = now(), result = $5 WHERE id = $1",
      [approvalId, decision === "approve" ? "approved" : "rejected", payload, user, result],
    );
    await c.query(
      "INSERT INTO agent_steps (run_id, agent, kind, name, data) VALUES ($1, 'human', 'human', $2, $3)",
      [a.run_id, `${decision}d ${a.kind}`, { approval_id: approvalId, by: user, result, edited: Boolean(payload.edited) }],
    );

    // When nothing is pending any more, the run and the email are done.
    const pending = await c.query("SELECT 1 FROM approvals WHERE run_id = $1 AND status = 'pending' LIMIT 1", [a.run_id]);
    if (!pending.rows.length) {
      await c.query("UPDATE agent_runs SET status = 'completed', finished_at = coalesce(finished_at, now()) WHERE id = $1", [a.run_id]);
      await c.query("UPDATE emails SET status = 'done' WHERE id = (SELECT email_id FROM agent_runs WHERE id = $1)", [a.run_id]);
    }
    return { id: approvalId, status: decision === "approve" ? "approved" : "rejected", result };
  });
}

export { planForFleet };
