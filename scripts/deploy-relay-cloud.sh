#!/usr/bin/env bash
# Pushes the Relay database and the devin-relay Edge Function to a linked
# Supabase project. Secrets are read from the environment so they never reach
# the shell history, the repository, or a Vite build.
#
#   SUPABASE_PROJECT_REF=abcdefghijklmnop \
#   DEVIN_API_KEY=... DEVIN_ORG_ID=org-... \
#   RELAY_ALLOWED_ORIGINS=https://relay.example.com \
#   ./scripts/deploy-relay-cloud.sh
#
# Optional: DEVIN_API_BASE_URL (default enterprise), DEVIN_REPO,
# DEVIN_MAX_ACU_LIMIT (default 1), SKIP_CHECKS=1.
set -euo pipefail

require() {
  if [ -z "${!1:-}" ]; then
    echo "missing required environment variable: $1" >&2
    exit 1
  fi
}

require SUPABASE_PROJECT_REF
require DEVIN_API_KEY
require DEVIN_ORG_ID
require RELAY_ALLOWED_ORIGINS

api_base="${DEVIN_API_BASE_URL:-https://api.devinenterprise.com/v3}"
repo="${DEVIN_REPO:-visiontale7-svg/AIAU-Salary-neko}"
acu="${DEVIN_MAX_ACU_LIMIT:-1}"

case "$api_base" in
  https://api.devin.ai/v3|https://api.devinenterprise.com/v3) ;;
  *)
    echo "DEVIN_API_BASE_URL must be https://api.devin.ai/v3 or https://api.devinenterprise.com/v3" >&2
    exit 1
    ;;
esac

case "$RELAY_ALLOWED_ORIGINS" in
  http://*)
    echo "RELAY_ALLOWED_ORIGINS must be https origins in production" >&2
    exit 1
    ;;
esac

if [ "${SKIP_CHECKS:-}" != "1" ]; then
  npm run typecheck:relay
  npm run test:relay
  npm run build:relay
  npm run check:relay-boundaries
fi

supabase link --project-ref "$SUPABASE_PROJECT_REF"
supabase db push --linked --dry-run
supabase db push --linked
supabase config push

supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" \
  DEVIN_API_KEY="$DEVIN_API_KEY" \
  DEVIN_ORG_ID="$DEVIN_ORG_ID" \
  DEVIN_API_BASE_URL="$api_base" \
  DEVIN_REPO="$repo" \
  DEVIN_MAX_ACU_LIMIT="$acu" \
  RELAY_ALLOWED_ORIGINS="$RELAY_ALLOWED_ORIGINS"

supabase functions deploy devin-relay --project-ref "$SUPABASE_PROJECT_REF"

echo "done. next: set VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY on Vercel and run 'vercel deploy --prod'."
