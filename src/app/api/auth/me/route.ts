// GET /api/auth/me → the signed-in user (without the ID token)
import { type NextRequest } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return Response.json({ user: null }, { status: 401 });
  return Response.json({ user: { name: user.name, email: user.email, roles: user.roles } });
}
