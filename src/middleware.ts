// Every page and API route needs a valid session, except the login page and the auth endpoints.
// Role checks for actions (approve, run) happen in the route handlers themselves.
import { NextResponse, type NextRequest } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/session";

const PUBLIC = ["/login", "/api/auth/login", "/api/auth/callback", "/api/auth/logout", "/api/health"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p)) return NextResponse.next();
  const user = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (user) return NextResponse.next();
  if (pathname.startsWith("/api/")) return Response.json({ error: "Not signed in" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
