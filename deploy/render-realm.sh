#!/bin/bash
# Builds keycloak/realm-prod.json (contains the client secret, never committed) from the template and .env.production.
set -euo pipefail
cd "$(dirname "$0")/.."
get() { grep -E "^$1=" .env.production | head -1 | cut -d= -f2-; }
APP_URL=$(get APP_URL); SECRET=$(get OIDC_CLIENT_SECRET)
test -n "$APP_URL" -a -n "$SECRET" || { echo "APP_URL and OIDC_CLIENT_SECRET must be set in .env.production"; exit 1; }
umask 077
sed -e "s|__APP_URL__|$APP_URL|g" -e "s|__CLIENT_SECRET__|$SECRET|g" keycloak/realm-prod.template.json > keycloak/realm-prod.json
chmod 644 keycloak/realm-prod.json   # the Keycloak container user must be able to read it
echo "keycloak/realm-prod.json written for $APP_URL"
