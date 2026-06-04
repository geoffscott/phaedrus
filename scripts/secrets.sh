#!/usr/bin/env bash
set -euo pipefail; source scripts/lib.sh; load_site
: "${GH_CLIENT_SECRET:?export GH_CLIENT_SECRET=…}"
: "${GH_APP_ID:?export GH_APP_ID=…}"
: "${GH_APP_KEY_FILE:?export GH_APP_KEY_FILE=/path/to/app-private-key.pem}"
sec_set() {       # name value
  local cur; cur=$(gcloud secrets versions access latest --secret="$1" 2>/dev/null || true)
  if [ "$cur" = "$2" ]; then echo "  $1 unchanged"; else printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=-; echo "  $1 updated"; fi
}
sec_set_file() {  # name file
  local cur; cur=$(gcloud secrets versions access latest --secret="$1" 2>/dev/null || true)
  if [ "$cur" = "$(cat "$2")" ]; then echo "  $1 unchanged"; else gcloud secrets versions add "$1" --data-file="$2"; echo "  $1 updated"; fi
}
sec_set "$SEC_CLIENT" "$GH_CLIENT_SECRET"
sec_set "$SEC_APPID"  "$GH_APP_ID"
sec_set_file "$SEC_APPKEY" "$GH_APP_KEY_FILE"
echo "Secrets current. GH_CLIENT_ID goes in at deploy time: export GH_CLIENT_ID before 'make deploy'."
