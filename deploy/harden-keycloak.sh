#!/bin/bash
# Public demo hardening, run after Keycloak has started (idempotent):
# the shared demo accounts must not open the account console (change password, profile, sessions).
# Usage: bash deploy/harden-keycloak.sh <compose args...>
set -euo pipefail
KC="docker compose $* exec -T keycloak /opt/keycloak/bin/kcadm.sh"
PASS=$(grep -E '^KEYCLOAK_ADMIN_PASSWORD=' .env.production | cut -d= -f2-)
$KC config credentials --server http://localhost:8080 --realm master --user admin --password "$PASS" >/dev/null
$KC remove-roles -r routewise --rname default-roles-routewise --cclientid account --rolename manage-account --rolename view-profile 2>/dev/null || true
$KC get roles/default-roles-routewise/composites -r routewise --fields name
