// Budget guard for the public demo: at most DAILY_RUN_LIMIT agent runs per day (0 = no limit).
// One run costs about a cent or less with gpt-4o-mini, so 100 runs/day stays well under the OpenAI cap.
import { config } from "./config";
import { pool } from "./db";

export async function checkDailyLimit(): Promise<string | null> {
  if (!config.dailyRunLimit) return null;
  const { rows } = await pool.query(
    "SELECT count(*)::int AS n FROM jobs WHERE created_at > date_trunc('day', now())",
  );
  return rows[0].n >= config.dailyRunLimit ? "The demo reached its daily limit of agent runs. Please come back tomorrow." : null;
}
