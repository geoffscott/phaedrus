#!/usr/bin/env bash
set -euo pipefail; source scripts/lib.sh; load_site
# Custom domain mappings, if any were created.
[ -n "${MCP_DOMAIN}" ]  && gcloud beta run domain-mappings delete --domain="$MCP_DOMAIN"  --region="$GCP_REGION" --quiet || true
[ -n "${AUTH_DOMAIN}" ] && gcloud beta run domain-mappings delete --domain="$AUTH_DOMAIN" --region="$GCP_REGION" --quiet || true
gcloud functions delete "$PROXY_FN" --region="$GCP_REGION" --gen2 --quiet || true
gcloud run services delete "$MCP_SVC" --region="$GCP_REGION" --quiet || true
for S in "$SEC_CLIENT" "$SEC_STATE" "$SEC_APPKEY" "$SEC_APPID"; do gcloud secrets delete "$S" --quiet || true; done
gcloud iam service-accounts delete "$PROXY_SA" --quiet || true
gcloud iam service-accounts delete "$MCP_SA" --quiet || true
echo "Torn down ${SITE}. Delete the GitHub OAuth App + GitHub App in the GitHub UI separately."
