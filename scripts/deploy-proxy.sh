#!/usr/bin/env bash
set -euo pipefail; source scripts/lib.sh; load_site
: "${GH_CLIENT_ID:?export GH_CLIENT_ID=… (from the GitHub OAuth App)}"
( cd services/oauth-proxy
  gcloud functions deploy "$PROXY_FN" --gen2 --runtime=nodejs22 --region="$GCP_REGION" \
    --source=. --entry-point=decapOauth --trigger-http --allow-unauthenticated \
    --service-account="$PROXY_SA" \
    --set-env-vars="GITHUB_OAUTH_CLIENT_ID=${GH_CLIENT_ID},OAUTH_SCOPE=${OAUTH_SCOPE},ALLOWED_ORIGIN=${SITE_ORIGIN},BASE_URL=PENDING" \
    --set-secrets="GITHUB_OAUTH_CLIENT_SECRET=${SEC_CLIENT}:latest,STATE_SIGNING_KEY=${SEC_STATE}:latest" \
    --memory=256Mi --min-instances=0 --max-instances=3 --timeout=30s )
URL=$(gcloud functions describe "$PROXY_FN" --region="$GCP_REGION" --gen2 --format='value(serviceConfig.uri)')
[ -n "$URL" ] || URL=$(gcloud functions describe "$PROXY_FN" --region="$GCP_REGION" --gen2 --format='value(url)')
gcloud functions deploy "$PROXY_FN" --gen2 --region="$GCP_REGION" --source=services/oauth-proxy \
  --entry-point=decapOauth --update-env-vars="BASE_URL=${URL}"
echo "PROXY_URL=${URL}"
echo "→ GitHub OAuth App callback: ${URL}/callback   (also base_url in admin/config.yml)"
