#!/usr/bin/env bash
set -euo pipefail
load_site() {
  set -a; source "sites/${SITE}.env"; set +a
  # Back-compat: GH_REPO was the original name for the content-repo identifier.
  # gh CLI also recognizes GH_REPO (expecting "owner/repo"), so leaving it
  # exported breaks gh commands. Migrate transparently and always unset.
  if [ -z "${CONTENT_REPO:-}" ] && [ -n "${GH_REPO:-}" ]; then
    echo "note: sites/${SITE}.env still uses GH_REPO; rename to CONTENT_REPO. (GH_REPO collides with gh CLI.)" >&2
    export CONTENT_REPO="$GH_REPO"
  fi
  unset GH_REPO
  test -n "${CONTENT_REPO:-}" || { echo "Missing CONTENT_REPO in sites/${SITE}.env"; exit 1; }
  : "${GCP_PROJECT:=$(gcloud config get-value project 2>/dev/null)}"
  test -n "${GCP_PROJECT}" || { echo "No GCP project set (gcloud config set project …)"; exit 1; }
  export GCP_PROJECT
  export OAUTH_SCOPE=$([[ "${GH_VISIBILITY}" == "private" ]] && echo "repo" || echo "public_repo")
  export PROXY_FN="${NAME_PREFIX}-oauth"
  export MCP_SVC="${NAME_PREFIX}-mcp"
  export PROXY_SA="${NAME_PREFIX}-oauth-rt@${GCP_PROJECT}.iam.gserviceaccount.com"
  export MCP_SA="${NAME_PREFIX}-mcp-rt@${GCP_PROJECT}.iam.gserviceaccount.com"
  export SEC_CLIENT="${NAME_PREFIX}-github-oauth-client-secret"
  export SEC_STATE="${NAME_PREFIX}-state-signing-key"
  export SEC_APPKEY="${NAME_PREFIX}-mcp-github-app-key"
  export SEC_APPID="${NAME_PREFIX}-mcp-github-app-id"
  # Optional custom subdomains, one per service, via plain Cloud Run domain
  # mappings (no load balancer). Either/both/neither. See scripts/deploy-domain.sh.
  export MCP_DOMAIN="${MCP_DOMAIN:-}"     # e.g. mcp.example.org  -> MCP server
  export AUTH_DOMAIN="${AUTH_DOMAIN:-}"   # e.g. auth.example.org -> OAuth proxy
  # Decap bot backend: when "true", the /admin/ door is opened to any GitHub-account
  # holder with no push access. Decap's GitHub API is pointed at the proxy's /github
  # route, which performs writes as the phaedrus GitHub App (no fork) — a branch + PR
  # land directly on the content repo for review. Default off; opt in per site.
  export DECAP_BOT_BACKEND="${DECAP_BOT_BACKEND:-false}"
  # The public base URL the OAuth proxy and Decap should use: the custom auth
  # domain if set, else empty so deploy-proxy/install-site-assets fall back to
  # the proxy's own *.run.app URL (resolved at deploy time).
  export PUBLIC_BASE_URL=$([ -n "${AUTH_DOMAIN}" ] && echo "https://${AUTH_DOMAIN}" || echo "")
}
require_cmd() { command -v "$1" >/dev/null || { echo "Missing dependency: $1"; exit 1; }; }
