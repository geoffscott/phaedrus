#!/usr/bin/env bash
set -euo pipefail; source scripts/lib.sh; load_site
: "${GH_CLIENT_ID:?export GH_CLIENT_ID=… (from the GitHub OAuth App)}"
( cd services/oauth-proxy
  gcloud functions deploy "$PROXY_FN" --gen2 --runtime=nodejs22 --region="$GCP_REGION" \
    --source=. --entry-point=decapOauth --trigger-http --allow-unauthenticated \
    --service-account="$PROXY_SA" \
    --set-env-vars="GITHUB_OAUTH_CLIENT_ID=${GH_CLIENT_ID},OAUTH_SCOPE=${OAUTH_SCOPE},ALLOWED_ORIGIN=${SITE_ORIGIN},BASE_URL=PENDING,GH_OWNER=${GH_OWNER},CONTENT_REPO=${CONTENT_REPO},GH_BRANCH=${GH_BRANCH},DECAP_BOT_BACKEND=${DECAP_BOT_BACKEND}" \
    --set-secrets="GITHUB_OAUTH_CLIENT_SECRET=${SEC_CLIENT}:latest,STATE_SIGNING_KEY=${SEC_STATE}:latest,GITHUB_APP_PRIVATE_KEY=${SEC_APPKEY}:latest,GITHUB_APP_ID=${SEC_APPID}:latest" \
    --memory=256Mi --min-instances=0 --max-instances=3 --timeout=30s )
URL=$(gcloud functions describe "$PROXY_FN" --region="$GCP_REGION" --gen2 --format='value(serviceConfig.uri)')
[ -n "$URL" ] || URL=$(gcloud functions describe "$PROXY_FN" --region="$GCP_REGION" --gen2 --format='value(url)')
# BASE_URL drives the GitHub redirect_uri and Decap's base_url. Behind the custom
# domain it must be the public host, not the *.run.app URL (which the LB fronts).
PUBLIC_URL="${PUBLIC_BASE_URL:-$URL}"
gcloud functions deploy "$PROXY_FN" --gen2 --region="$GCP_REGION" --source=services/oauth-proxy \
  --entry-point=decapOauth --update-env-vars="BASE_URL=${PUBLIC_URL}"
cat <<EOF

================================================================
  phaedrus oauth-proxy deployed
================================================================
  Function URL (origin): ${URL}
  Public BASE_URL:       ${PUBLIC_URL}$([ -n "${AUTH_DOMAIN}" ] && echo "   (custom domain — run 'make deploy-domain')")

  GitHub OAuth App
  → Authorization callback URL:
      ${PUBLIC_URL}/callback
    (paste into the OAuth App's settings on github.com)

  Decap admin/config.yml
  → base_url:
      ${PUBLIC_URL}
================================================================
EOF
if [ "${DECAP_BOT_BACKEND}" = true ]; then
cat <<EOF
  Bot backend ENABLED (DECAP_BOT_BACKEND=true)
  → Decap api_root will be: ${PUBLIC_URL}/github  (set by install-site-assets)
  → The GitHub App must grant, in addition to Contents RW + Pull requests RW:
        Issues: Read & write
    (Decap's editorial workflow creates/moves PR labels.) Add it in the App's
    settings and accept the new permission on the installation, or saving from
    /admin/ will fail.
================================================================
EOF
fi
