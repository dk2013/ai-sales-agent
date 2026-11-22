// GET /api/auth/callback?code=…&state=… → exchange the code (with the PKCE verifier) for tokens,
// validate the ID token (signature, issuer, audience, expiry — done by openid-client), create our session.
import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/config";
import { client, oidc } from "@/lib/oidc";
import { cookieOptions, SESSION_COOKIE, sign, TX_COOKIE, verify, type Role } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const tx = await verify<{ codeVerifier: string; state: string }>(req.cookies.get(TX_COOKIE)?.value);
  if (!tx) return NextResponse.redirect(new URL("/login?error=expired", config.appUrl));

  try {
    const cfg = await oidc();
    // Behind a proxy req.url can have an internal host; rebuild the callback URL from APP_URL.
    const current = new URL(`${config.appUrl}/api/auth/callback${req.nextUrl.search}`);
    const tokens = await client.authorizationCodeGrant(cfg, current, {
      pkceCodeVerifier: tx.codeVerifier,
      expectedState: tx.state,
    });
    const claims = tokens.claims();
    if (!claims || !tokens.id_token) throw new Error("No ID token");
    const roles = ((claims.roles as string[] | undefined) ?? []).filter((r): r is Role => r === "sales-manager" || r === "viewer");
    if (!roles.length) return NextResponse.redirect(new URL("/login?error=no_role", config.appUrl));

    const session = await sign(
      {
        sub: claims.sub,
        name: (claims.name as string) ?? (claims.preferred_username as string) ?? "User",
        email: (claims.email as string) ?? "",
        roles,
        idToken: tokens.id_token,
      },
      "8h",
    );
    const res = NextResponse.redirect(new URL("/", config.appUrl));
    res.cookies.set(SESSION_COOKIE, session, cookieOptions(8 * 3600));
    res.cookies.delete(TX_COOKIE);
    return res;
  } catch (err) {
    console.error("OIDC callback failed:", err);
    return NextResponse.redirect(new URL("/login?error=callback", config.appUrl));
  }
}
