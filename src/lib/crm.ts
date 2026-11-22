// Read side of the sandbox CRM, used by the MCP tools and the dashboard.
import { pool } from "./db";

export async function findContact(by: { email?: string; company?: string }) {
  const { rows } = await pool.query(
    `SELECT id, name, email, company, fleet_size, stage FROM contacts
     WHERE ($1::text IS NOT NULL AND lower(email) = lower($1))
        OR ($2::text IS NOT NULL AND company ILIKE '%' || $2 || '%')
     ORDER BY (lower(email) = lower(coalesce($1, ''))) DESC LIMIT 1`,
    [by.email ?? null, by.company ?? null],
  );
  if (!rows[0]) return null;
  const contact = rows[0];
  const [deals, activities] = await Promise.all([
    pool.query("SELECT plan, vehicles, monthly_value, stage, created_at FROM deals WHERE contact_id = $1 ORDER BY created_at DESC", [contact.id]),
    pool.query("SELECT type, summary, created_at FROM activities WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 5", [contact.id]),
  ]);
  return { ...contact, id: Number(contact.id), deals: deals.rows, recent_activities: activities.rows };
}

export async function getEmail(id: number) {
  const { rows } = await pool.query("SELECT id, from_name, from_email, subject, body, received_at, status, category FROM emails WHERE id = $1", [id]);
  return rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null;
}
