// GET /api/auth/login → redirect to Keycloak with PKCE. The verifier and state wait in a short-lived signed cookie.
import { NextResponse } from "next/server";
import { client, oidc, redirectUri } from "@/lib/oidc";
import { cookieOptions, sign, TX_COOKIE } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const cfg = await oidc();
  const codeVerifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const url = client.buildAuthorizationUrl(cfg, {
    redirect_uri: redirectUri(),
    scope: "openid profile email",
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: "S256",
    state,
  });
  const res = NextResponse.redirect(url);
  res.cookies.set(TX_COOKIE, await sign({ codeVerifier, state }, "10m"), cookieOptions(600));
  return res;
}
