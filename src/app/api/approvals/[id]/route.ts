// POST /api/approvals/:id  { decision: "approve" | "reject", subject?, body? } → the human decides.
// Only now does anything happen: the reply goes to the outbox, the meeting to the calendar, the data to the CRM.
import { requireManager } from "@/lib/auth";
import { decide } from "@/lib/approvals";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireManager();
  if (user instanceof Response) return user;
  const { id } = await params;
  if (!/^\d+$/.test(id)) return Response.json({ error: "Invalid id" }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { decision?: string; subject?: string; body?: string } | null;
  if (body?.decision !== "approve" && body?.decision !== "reject") {
    return Response.json({ error: "decision must be approve or reject" }, { status: 400 });
  }
  const edits = {
    subject: typeof body.subject === "string" ? body.subject.slice(0, 200) : undefined,
    body: typeof body.body === "string" ? body.body.slice(0, 4000) : undefined,
  };
  try {
    return Response.json(await decide(Number(id), body.decision, user.name, edits));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
  }
}
