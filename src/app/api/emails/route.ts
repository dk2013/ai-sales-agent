// GET /api/emails → inbox with the latest agent run for each email
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { rows } = await pool.query(`
    SELECT e.id, e.from_name, e.from_email, e.subject, e.received_at, e.status, e.category,
           r.id AS run_id, r.status AS run_status,
           r.result->'qualification'->>'priority' AS priority,
           r.result->'qualification'->>'plan' AS plan,
           (SELECT count(*)::int FROM approvals a WHERE a.run_id = r.id AND a.status = 'pending') AS pending
    FROM emails e
    LEFT JOIN LATERAL (SELECT * FROM agent_runs WHERE email_id = e.id ORDER BY id DESC LIMIT 1) r ON true
    ORDER BY e.received_at DESC`);
  return Response.json({ emails: rows.map((r) => ({ ...r, id: Number(r.id), run_id: r.run_id ? Number(r.run_id) : null })) });
}
