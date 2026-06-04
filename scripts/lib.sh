#!/usr/bin/env bash
set -euo pipefail
load_site() {
  set -a; source "sites/${SITE}.env"; set +a
  : "${GCP_PROJECT:=$(gcloud config get-value project 2>/dev/null)}"
  test -n "${GCP_PROJECT}" || { echo "No GCP project set (gcloud config set project …)"; exit 1; }
  export GCP_PROJECT
  export OAUTH_SCOPE=$([[ "${GH_VISIBILITY}" == "private" ]] && echo "repo" || echo "public_repo")
  # Per-post front-matter key for the taxonomy. Distinct from TAXONOMY_LABEL
  # (the UI label, e.g. "Lenses") because the singular/lowercase key looks
  # cleaner in front matter (e.g. `lens: Strategy`). Default works for KF.
  export TAXONOMY_KEY="${TAXONOMY_KEY:-lens}"
  export PROXY_FN="${NAME_PREFIX}-oauth"
  export MCP_SVC="${NAME_PREFIX}-mcp"
  export PROXY_SA="${NAME_PREFIX}-oauth-rt@${GCP_PROJECT}.iam.gserviceaccount.com"
  export MCP_SA="${NAME_PREFIX}-mcp-rt@${GCP_PROJECT}.iam.gserviceaccount.com"
  export SEC_CLIENT="${NAME_PREFIX}-github-oauth-client-secret"
  export SEC_STATE="${NAME_PREFIX}-state-signing-key"
  export SEC_APPKEY="${NAME_PREFIX}-mcp-github-app-key"
  export SEC_APPID="${NAME_PREFIX}-mcp-github-app-id"
}
require_cmd() { command -v "$1" >/dev/null || { echo "Missing dependency: $1"; exit 1; }; }
