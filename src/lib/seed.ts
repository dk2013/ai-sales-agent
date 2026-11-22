// Sandbox data: reset (CRM, calendar, first emails) and "simulate a new email" for live demos.
// Times are relative to now, so the calendar always has a realistic busy/free pattern.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pool } from "./db";

interface SampleEmail { key: string; from_name: string; from_email: string; subject: string; body: string }
interface Crm {
  contacts: {
    name: string; email: string; company: string; fleet_size: number; stage: string;
    deal?: { plan: string; vehicles: number; monthly_value: number; stage: string };
    activities: { type: string; summary: string; days_ago: number }[];
  }[];
}

export const INITIAL_INBOX = 8;
const read = <T>(file: string): T => JSON.parse(readFileSync(join(process.cwd(), "sample-data", file), "utf8"));

export async function resetSandbox(opts: { all?: boolean } = {}) {
  const emails = read<SampleEmail[]>("emails.json");
  const crm = read<Crm>("crm.json");
  const count = opts.all ? emails.length : INITIAL_INBOX;

  await pool.query("TRUNCATE jobs, approvals, agent_steps, agent_runs, outbox, calendar_events, activities, deals, contacts, emails RESTART IDENTITY CASCADE");

  for (const c of crm.contacts) {
    const { rows } = await pool.query(
      "INSERT INTO contacts (name, email, company, fleet_size, stage) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [c.name, c.email, c.company, c.fleet_size, c.stage],
    );
    const id = rows[0].id;
    if (c.deal) {
      await pool.query("INSERT INTO deals (contact_id, plan, vehicles, monthly_value, stage) VALUES ($1, $2, $3, $4, $5)", [
        id, c.deal.plan, c.deal.vehicles, c.deal.monthly_value, c.deal.stage,
      ]);
    }
    for (const a of c.activities) {
      await pool.query("INSERT INTO activities (contact_id, type, summary, created_at) VALUES ($1, $2, $3, now() - make_interval(days => $4))", [
        id, a.type, a.summary, a.days_ago,
      ]);
    }
  }

  // Busy calendar for the next two weeks, Toronto business hours: daily standup + customer calls every other day.
  // d is a local (Toronto) date; "AT TIME ZONE" turns a local wall-clock time into an absolute timestamp.
  await pool.query(`
    INSERT INTO calendar_events (title, starts_at, ends_at)
    SELECT 'Sales team standup', ((d + time '10:00') AT TIME ZONE 'America/Toronto'), ((d + time '10:30') AT TIME ZONE 'America/Toronto')
    FROM generate_series(date_trunc('day', now() AT TIME ZONE 'America/Toronto'), date_trunc('day', now() AT TIME ZONE 'America/Toronto') + interval '14 days', interval '1 day') AS d
    WHERE extract(isodow FROM d) < 6`);
  await pool.query(`
    INSERT INTO calendar_events (title, starts_at, ends_at)
    SELECT 'Customer call', ((d + time '13:00') AT TIME ZONE 'America/Toronto'), ((d + time '14:30') AT TIME ZONE 'America/Toronto')
    FROM generate_series(date_trunc('day', now() AT TIME ZONE 'America/Toronto') + interval '1 day', date_trunc('day', now() AT TIME ZONE 'America/Toronto') + interval '14 days', interval '2 days') AS d
    WHERE extract(isodow FROM d) < 6`);

  for (const [i, e] of emails.slice(0, count).entries()) {
    await pool.query(
      "INSERT INTO emails (from_name, from_email, subject, body, sample_key, received_at) VALUES ($1, $2, $3, $4, $5, now() - make_interval(mins => $6))",
      [e.from_name, e.from_email, e.subject, e.body, e.key, (count - i) * 23],
    );
  }
  const n = await pool.query("SELECT (SELECT count(*) FROM emails)::int e, (SELECT count(*) FROM contacts)::int c, (SELECT count(*) FROM calendar_events)::int k");
  return { emails: n.rows[0].e, contacts: n.rows[0].c, events: n.rows[0].k };
}

// Adds the next sample email that is not in the inbox yet (for "a new email just arrived").
export async function simulateIncoming(): Promise<{ id: number; subject: string } | null> {
  const emails = read<SampleEmail[]>("emails.json");
  const { rows } = await pool.query("SELECT sample_key FROM emails WHERE sample_key IS NOT NULL");
  const present = new Set(rows.map((r) => r.sample_key));
  const next = emails.find((e) => !present.has(e.key));
  if (!next) return null;
  const inserted = await pool.query(
    "INSERT INTO emails (from_name, from_email, subject, body, sample_key) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [next.from_name, next.from_email, next.subject, next.body, next.key],
  );
  return { id: Number(inserted.rows[0].id), subject: next.subject };
}
