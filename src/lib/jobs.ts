// A small job queue in Postgres. The API enqueues; the worker claims jobs with FOR UPDATE SKIP LOCKED,
// so several workers could run safely without taking the same job.
import { pool } from "./db";

export async function enqueueEmail(emailId: number): Promise<{ queued: boolean; reason?: string }> {
  const active = await pool.query(
    "SELECT 1 FROM jobs WHERE type = 'process_email' AND (payload->>'email_id')::bigint = $1 AND status IN ('queued', 'running')",
    [emailId],
  );
  if (active.rows.length) return { queued: false, reason: "already in the queue" };
  await pool.query("INSERT INTO jobs (type, payload) VALUES ('process_email', $1)", [{ email_id: emailId }]);
  await pool.query("UPDATE emails SET status = 'queued' WHERE id = $1", [emailId]);
  return { queued: true };
}

export interface Job {
  id: number;
  type: string;
  payload: { email_id: number };
  attempts: number;
}

export async function claimJob(): Promise<Job | null> {
  const { rows } = await pool.query(`
    UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = now()
    WHERE id = (
      SELECT id FROM jobs WHERE status = 'queued' AND run_after <= now()
      ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
    )
    RETURNING id, type, payload, attempts`);
  return rows[0] ? { ...rows[0], id: Number(rows[0].id) } : null;
}

export async function finishJob(id: number) {
  await pool.query("UPDATE jobs SET status = 'done', updated_at = now() WHERE id = $1", [id]);
}

const MAX_ATTEMPTS = 2;

export async function failJob(job: Job, error: string) {
  const retry = job.attempts < MAX_ATTEMPTS;
  await pool.query(
    "UPDATE jobs SET status = $2, last_error = $3, run_after = now() + make_interval(secs => $4), updated_at = now() WHERE id = $1",
    [job.id, retry ? "queued" : "failed", error, retry ? 30 * job.attempts : 0],
  );
}
