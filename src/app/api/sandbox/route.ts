// GET /api/sandbox → what the agents changed: CRM contacts with deals, upcoming meetings, sent emails
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const [contacts, events, outbox] = await Promise.all([
    pool.query(`
      SELECT c.id, c.name, c.email, c.company, c.fleet_size, c.stage, c.updated_at,
             (SELECT json_agg(json_build_object('plan', d.plan, 'vehicles', d.vehicles, 'monthly_value', d.monthly_value, 'stage', d.stage) ORDER BY d.created_at DESC)
                FROM deals d WHERE d.contact_id = c.id) AS deals,
             (SELECT summary FROM activities a WHERE a.contact_id = c.id ORDER BY a.created_at DESC LIMIT 1) AS last_activity
      FROM contacts c ORDER BY c.updated_at DESC`),
    pool.query("SELECT id, title, starts_at, ends_at, attendee_email FROM calendar_events WHERE ends_at > now() ORDER BY starts_at LIMIT 40"),
    pool.query("SELECT id, to_email, subject, body, sent_at FROM outbox ORDER BY sent_at DESC LIMIT 30"),
  ]);
  return Response.json({ contacts: contacts.rows, events: events.rows, outbox: outbox.rows });
}
