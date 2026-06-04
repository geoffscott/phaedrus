#!/usr/bin/env bash
set -euo pipefail; source scripts/lib.sh; load_site
require_cmd git; require_cmd gh
URL=$(gcloud functions describe "$PROXY_FN" --region="$GCP_REGION" --gen2 --format='value(serviceConfig.uri)')
ROOT="$PWD"; BR="phaedrus/site-assets"
TMP=$(mktemp -d); git clone "https://github.com/${GH_OWNER}/${GH_REPO}.git" "$TMP"; cd "$TMP"
# reuse the branch if it exists (updates the open PR), else branch off the base
if git ls-remote --exit-code --heads origin "$BR" >/dev/null 2>&1; then
  git fetch origin "$BR"; git checkout "$BR"
else
  git checkout -B "$BR" "origin/${GH_BRANCH}"
fi
mkdir -p admin .github/workflows scripts
cp "$ROOT/site-assets/admin/index.html" admin/index.html
cp "$ROOT/site-assets/workflows/update-llms-txt.yml" .github/workflows/update-llms-txt.yml
cp "$ROOT/site-assets/scripts/gen_llms_txt.py" scripts/gen_llms_txt.py
OPTIONS=$(printf '"%s", ' ${TAXONOMY_TERMS//,/ }); OPTIONS="[ ${OPTIONS%, } ]"
sed -e "s#__REPO__#${GH_OWNER}/${GH_REPO}#" -e "s#__BRANCH__#${GH_BRANCH}#" \
    -e "s#__BASE_URL__#${URL}#" -e "s#__IMAGES_DIR__#${IMAGES_DIR}#" \
    -e "s#__TAXONOMY_LABEL__#${TAXONOMY_LABEL}#" -e "s#__TAXONOMY_OPTIONS__#${OPTIONS}#" \
    "$ROOT/site-assets/admin/config.yml.tmpl" > admin/config.yml
git add -A
if git diff --cached --quiet; then
  echo "Site assets already current — nothing to commit."
else
  git -c user.name=phaedrus -c user.email=phaedrus@users.noreply.github.com \
    commit -m "chore: add/update phaedrus (Decap admin + llms.txt automation)"
  git push -u origin "$BR" --force-with-lease
fi
gh pr view "$BR" >/dev/null 2>&1 || gh pr create --fill --base "$GH_BRANCH" --head "$BR" || \
  echo "Branch pushed; open the PR manually."
echo "NOTE: add the AUTOGEN markers to ${LLMS_TXT} and backfill post 'description:' before first merge (Spec B §1.1)."
