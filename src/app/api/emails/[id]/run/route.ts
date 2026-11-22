// POST /api/emails/:id/run → queue the email for the agent team (sales managers only)
import { requireManager } from "@/lib/auth";
import { checkDailyLimit } from "@/lib/limits";
import { enqueueEmail } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireManager();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "Invalid id" }, { status: 400 });
  const limit = await checkDailyLimit();
  if (limit) return Response.json({ error: limit }, { status: 429 });
  return Response.json(await enqueueEmail(Number(id)));
}
