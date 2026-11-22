// POST /api/sandbox/reset → start the demo over (sales managers only)
import { requireManager } from "@/lib/auth";
import { resetSandbox } from "@/lib/seed";

export const runtime = "nodejs";

export async function POST() {
  const user = await requireManager();
  if (user instanceof Response) return user;
  return Response.json(await resetSandbox());
}
