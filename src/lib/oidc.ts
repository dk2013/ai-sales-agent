// OpenID Connect with Keycloak: Authorization Code flow + PKCE, using openid-client.
// discovery() reads the realm's /.well-known/openid-configuration once and caches it.
import * as client from "openid-client";
import { config } from "./config";

// Cached per module, NOT on globalThis: Next.js bundles each route separately, so a Configuration created
// by another route's copy of openid-client would fail the library's `instanceof Configuration` check.
const g: { oidcConfig?: Promise<client.Configuration> } = {};

export function oidc(): Promise<client.Configuration> {
  g.oidcConfig ??= client
    .discovery(
      new URL(config.oidcIssuer),
      config.oidcClientId,
      config.oidcClientSecret,
      undefined,
      // local Keycloak runs on plain http; production uses https
      config.oidcIssuer.startsWith("http://") ? { execute: [client.allowInsecureRequests] } : undefined,
    )
    .catch((err) => {
      g.oidcConfig = undefined; // retry on the next request
      throw err;
    });
  return g.oidcConfig;
}

export const redirectUri = () => `${config.appUrl}/api/auth/callback`;

export { client };
