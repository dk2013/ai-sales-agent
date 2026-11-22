// GET /api/approvals → proposals waiting for a human, newest first
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { rows } = await pool.query(`
    SELECT a.id, a.run_id, a.kind, a.payload, a.created_at, e.from_name, e.subject
    FROM approvals a JOIN agent_runs r ON r.id = a.run_id JOIN emails e ON e.id = r.email_id
    WHERE a.status = 'pending' ORDER BY a.id DESC`);
  return Response.json({ approvals: rows.map((a) => ({ ...a, id: Number(a.id), run_id: Number(a.run_id) })) });
}
