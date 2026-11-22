// Helpers for route handlers: who is calling, and may they do this?
import { cookies } from "next/headers";
import { canApprove, readSession, SESSION_COOKIE, type SessionUser } from "./session";

export async function currentUser(): Promise<SessionUser | null> {
  return readSession((await cookies()).get(SESSION_COOKIE)?.value);
}

// Returns the user, or a Response to send back (401 / 403).
export async function requireManager(): Promise<SessionUser | Response> {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!canApprove(user)) return Response.json({ error: "Only sales managers can do this (read-only role)" }, { status: 403 });
  return user;
}
