#!/usr/bin/env bash
set -euo pipefail; source scripts/lib.sh; load_site
( cd services/mcp-server
  gcloud run deploy "$MCP_SVC" --source=. --region="$GCP_REGION" \
    --service-account="$MCP_SA" \
    --set-secrets="GITHUB_APP_PRIVATE_KEY=${SEC_APPKEY}:latest,GITHUB_APP_ID=${SEC_APPID}:latest" \
    --set-env-vars="^@^GH_OWNER=${GH_OWNER}@GH_REPO=${GH_REPO}@GH_BRANCH=${GH_BRANCH}@POSTS_DIR=${POSTS_DIR}@AUTHORS_DIR=${AUTHORS_DIR}@AUTHORS_DATA=${AUTHORS_DATA}@IMAGES_DIR=${IMAGES_DIR}@TAXONOMY_TERMS=${TAXONOMY_TERMS}@TOOL_PREFIX=post_" \
    --allow-unauthenticated )
echo "MCP_URL=$(gcloud run services describe "$MCP_SVC" --region="$GCP_REGION" --format='value(status.url)')"
echo "→ Add this URL as a custom connector in Claude.ai (verify auth steps at docs.claude.com)."
