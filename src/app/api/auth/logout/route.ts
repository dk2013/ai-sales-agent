// GET /api/auth/logout → drop our session and end the Keycloak SSO session too (RP-initiated logout),
// otherwise the next "Sign in" would log the user straight back in.
import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/config";
import { client, oidc } from "@/lib/oidc";
import { readSession, SESSION_COOKIE } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  let target = new URL("/login", config.appUrl);
  if (user) {
    try {
      target = client.buildEndSessionUrl(await oidc(), {
        id_token_hint: user.idToken,
        post_logout_redirect_uri: `${config.appUrl}/login`,
      });
    } catch {
      // Keycloak unreachable: still log out locally
    }
  }
  const res = NextResponse.redirect(target);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
