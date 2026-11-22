// POST /api/emails/simulate → "a new email just arrived" (next sample email into the inbox)
import { requireManager } from "@/lib/auth";
import { simulateIncoming } from "@/lib/seed";

export const runtime = "nodejs";

export async function POST() {
  const user = await requireManager();
  if (user instanceof Response) return user;
  const email = await simulateIncoming();
  if (!email) return Response.json({ error: "All sample emails are already in the inbox. Reset the sandbox to start over." }, { status: 409 });
  return Response.json({ email });
}
