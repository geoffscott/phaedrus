#!/usr/bin/env bash
set -euo pipefail; source scripts/lib.sh; load_site
require_cmd gcloud
gcloud services enable cloudfunctions.googleapis.com run.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
for SA in "${NAME_PREFIX}-oauth-rt" "${NAME_PREFIX}-mcp-rt"; do
  gcloud iam service-accounts create "$SA" --display-name="phaedrus ${SITE} ${SA}" 2>/dev/null || true
done
gcloud secrets describe "$SEC_STATE" >/dev/null 2>&1 || \
  openssl rand -hex 32 | tr -d '\n' | gcloud secrets create "$SEC_STATE" --data-file=- --replication-policy=automatic
for S in "$SEC_CLIENT" "$SEC_APPKEY" "$SEC_APPID"; do
  gcloud secrets describe "$S" >/dev/null 2>&1 || printf 'PENDING' | gcloud secrets create "$S" --data-file=- --replication-policy=automatic
done
gcloud secrets add-iam-policy-binding "$SEC_CLIENT" --member="serviceAccount:${PROXY_SA}" --role=roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding "$SEC_STATE"  --member="serviceAccount:${PROXY_SA}" --role=roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding "$SEC_APPKEY" --member="serviceAccount:${MCP_SA}"   --role=roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding "$SEC_APPID"  --member="serviceAccount:${MCP_SA}"   --role=roles/secretmanager.secretAccessor
# The OAuth proxy also reads the GitHub App secrets when the bot backend is enabled
# (DECAP_BOT_BACKEND): it commits as the App on behalf of contributors with no push
# access. Harmless to grant even when the bot backend is off — unread until used.
gcloud secrets add-iam-policy-binding "$SEC_APPKEY" --member="serviceAccount:${PROXY_SA}" --role=roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding "$SEC_APPID"  --member="serviceAccount:${PROXY_SA}" --role=roles/secretmanager.secretAccessor
echo "Bootstrap complete for ${SITE}. Next: create the GitHub OAuth App + GitHub App, then 'make secrets SITE=${SITE}'."
