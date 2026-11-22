// Session = a signed JWT in an httpOnly cookie (HS256 with SESSION_SECRET). Works in the Edge middleware
// and in Node route handlers. Roles come from Keycloak (realm roles mapped into the ID token as "roles").
import { jwtVerify, SignJWT } from "jose";

export const SESSION_COOKIE = "rw_session";
export const TX_COOKIE = "rw_oidc_tx"; // short-lived: PKCE verifier + state during the login redirect

export type Role = "sales-manager" | "viewer";

export interface SessionUser {
  sub: string;
  name: string;
  email: string;
  roles: Role[];
  idToken: string; // kept for RP-initiated logout (id_token_hint)
}

function key() {
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return new TextEncoder().encode(secret);
}

export async function sign(payload: Record<string, unknown>, expiresIn: string) {
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(expiresIn).sign(key());
}

export async function verify<T>(token: string | undefined): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return payload as T;
  } catch {
    return null;
  }
}

export const readSession = (token: string | undefined) => verify<SessionUser>(token);

export const canApprove = (user: SessionUser | null) => Boolean(user?.roles.includes("sales-manager"));

export const cookieOptions = (maxAgeSec: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: (process.env.APP_URL ?? "").startsWith("https://"),
  path: "/",
  maxAge: maxAgeSec,
});
