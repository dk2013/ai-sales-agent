// POST /api/emails/run-all → queue every email that hasn't been processed yet
import { requireManager } from "@/lib/auth";
import { pool } from "@/lib/db";
import { checkDailyLimit } from "@/lib/limits";
import { enqueueEmail } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST() {
  const user = await requireManager();
  if (user instanceof Response) return user;
  const limit = await checkDailyLimit();
  if (limit) return Response.json({ error: limit }, { status: 429 });
  const { rows } = await pool.query("SELECT id FROM emails WHERE status = 'new' ORDER BY received_at");
  let queued = 0;
  for (const r of rows) if ((await enqueueEmail(Number(r.id))).queued) queued++;
  return Response.json({ queued });
}
