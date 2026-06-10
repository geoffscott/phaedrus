#!/usr/bin/env bash
set -euo pipefail; source scripts/lib.sh; load_site
# Map custom subdomains onto the two services with plain Cloud Run domain
# mappings — one hostname per service, no load balancer:
#   MCP_DOMAIN   (e.g. mcp.example.org)  -> MCP server      ->  https://MCP_DOMAIN/mcp
#   AUTH_DOMAIN  (e.g. auth.example.org) -> OAuth proxy     ->  https://AUTH_DOMAIN/auth
# Both are optional and independent; set neither and this is a no-op. Run
# `make deploy-proxy` AFTER setting AUTH_DOMAIN so the proxy's BASE_URL (hence the
# GitHub redirect_uri) points at the custom host.
#
# Idempotent: a mapping that already exists is left alone. Each mapping prints
# the DNS record to add in Cloudflare (a CNAME to ghs.googlehosted.com), which
# must be DNS-only (grey cloud) so Google can provision the managed TLS cert.
if [ -z "${MCP_DOMAIN}" ] && [ -z "${AUTH_DOMAIN}" ]; then
  echo "Neither MCP_DOMAIN nor AUTH_DOMAIN set in sites/${SITE}.env — skipping custom domains."
  exit 0
fi
require_cmd gcloud
DRY="${DRY_RUN:-}"   # DRY_RUN=1 prints the gcloud commands instead of running them.

# Managed Cloud Run domain mappings live under the `beta` track — GA
# `gcloud run domain-mappings` is the Cloud Run for Anthos (Kubernetes) surface
# and takes --namespace, not --region.
if [ -z "$DRY" ] && ! gcloud beta run domain-mappings list --help >/dev/null 2>&1; then
  echo "Needs the gcloud 'beta' component. Install it with:" >&2
  echo "  gcloud components install beta" >&2
  exit 1
fi

# A gen2 function is itself a Cloud Run service named after the function, so both
# backends map the same way: `gcloud beta run domain-mappings` against the service.
map_domain() {  # map_domain <domain> <cloud-run-service> <label>
  local domain="$1" service="$2" label="$3"
  echo
  echo "  ${label}: ${domain} -> ${service}"
  if [ -n "$DRY" ]; then
    echo "    [dry-run] gcloud beta run domain-mappings create --service=${service} --domain=${domain} --region=${GCP_REGION}"
    return
  fi
  gcloud beta run domain-mappings describe --domain="$domain" --region="$GCP_REGION" >/dev/null 2>&1 || \
    gcloud beta run domain-mappings create --service="$service" --domain="$domain" --region="$GCP_REGION"
  echo "  Cloudflare DNS — add this record, DNS-only (GREY cloud):"
  gcloud beta run domain-mappings describe --domain="$domain" --region="$GCP_REGION" \
    --format='value[separator="   "](status.resourceRecords[].name, status.resourceRecords[].type, status.resourceRecords[].rrdata)' \
    | sed 's/^/      /'
}

echo "================================================================"
echo "  phaedrus custom domains"
echo "================================================================"
echo "  (One-time: the parent domain must be verified in Google —"
echo "   'gcloud domains verify <parent-domain>' if a mapping is rejected.)"

[ -n "${MCP_DOMAIN}" ]  && map_domain "$MCP_DOMAIN"  "$MCP_SVC"  "MCP server"
[ -n "${AUTH_DOMAIN}" ] && map_domain "$AUTH_DOMAIN" "$PROXY_FN" "OAuth proxy"

cat <<EOF

  Notes:
    - Orange-cloud (Cloudflare proxy) blocks the managed cert; keep records grey.
      The cert provisions ~15-60m after DNS resolves.
EOF
[ -n "${AUTH_DOMAIN}" ] && cat <<EOF
    - GitHub OAuth App: set the Authorization callback URL to
        https://${AUTH_DOMAIN}/callback
      and run 'make deploy-proxy SITE=${SITE}' so BASE_URL matches.
EOF
[ -n "${MCP_DOMAIN}" ] && echo "    - Claude.ai connector URL: https://${MCP_DOMAIN}/mcp"
echo "================================================================"
