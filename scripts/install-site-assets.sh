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
cp "$ROOT/site-assets/workflows/check-new-tags.yml" .github/workflows/check-new-tags.yml
cp "$ROOT/site-assets/scripts/gen_llms_txt.py" scripts/gen_llms_txt.py
cp "$ROOT/site-assets/scripts/check_new_tags.py" scripts/check_new_tags.py
OPTIONS=$(printf '"%s", ' ${TAXONOMY_TERMS//,/ }); OPTIONS="[ ${OPTIONS%, } ]"
sed -e "s#__REPO__#${GH_OWNER}/${GH_REPO}#" -e "s#__BRANCH__#${GH_BRANCH}#" \
    -e "s#__BASE_URL__#${URL}#" -e "s#__SITE_URL__#${SITE_URL}#" \
    -e "s#__IMAGES_DIR__#${IMAGES_DIR}#" \
    -e "s#__TAXONOMY_LABEL__#${TAXONOMY_LABEL}#" -e "s#__TAXONOMY_KEY__#${TAXONOMY_KEY}#" \
    -e "s#__TAXONOMY_OPTIONS__#${OPTIONS}#" \
    "$ROOT/site-assets/admin/config.yml.tmpl" > admin/config.yml
git add -A
if git diff --cached --quiet; then
  echo "Site assets already current — nothing to commit."
else
  git -c user.name=phaedrus -c user.email=phaedrus@users.noreply.github.com \
    commit -m "chore: add/update phaedrus (Decap admin + llms.txt automation)"
  git push -u origin "$BR" --force-with-lease
fi
PR_TITLE="phaedrus setup: Decap admin + llms.txt automation"
PR_BODY=$(cat <<EOF
Wires this site into [phaedrus](https://github.com/geoffscott/phaedrus) — a small toolkit that converges three authoring doors on a single PR review gate.

## What this PR adds

- **\`admin/index.html\`** — Decap CMS loader (the page served at \`/admin/\`).
- **\`admin/config.yml\`** — Decap config generated for this site:
  - Backend: GitHub (\`${GH_OWNER}/${GH_REPO}\`, branch \`${GH_BRANCH}\`)
  - OAuth proxy: \`${URL}\`
  - Media folder: \`${IMAGES_DIR}\`
  - Taxonomy: **${TAXONOMY_LABEL}** → ${TAXONOMY_TERMS}
- **\`.github/workflows/update-llms-txt.yml\`** — regenerates \`${LLMS_TXT}\` on every push to \`${GH_BRANCH}\` that touches posts, authors, the site config, or the generator itself. Commits back with \`phaedrus-bot\` as author; no-op when already current.
- **\`.github/workflows/check-new-tags.yml\`** — runs on every PR touching \`_posts/**\`. If the PR introduces a tag that doesn't appear on any post on \`${GH_BRANCH}\`, posts a sticky comment listing the new tags. **Non-blocking** — just gives reviewers a heads-up so they can spot typos / synonyms before the taxonomy quietly grows.
- **\`scripts/gen_llms_txt.py\`** — site-agnostic generator. Reads this repo's own \`_config.yml\` for the permalink template and any extra collections; falls back to Jekyll defaults.
- **\`scripts/check_new_tags.py\`** — the detector used by the check-new-tags workflow above.

## What this enables

Once merged, all three authoring doors land as PRs on \`${GH_BRANCH}\` for human review:

| Door | How |
|---|---|
| **Humans** | Visit \`${SITE_URL%/}/admin/\` → Decap CMS in the browser. |
| **AI / agents** | Claude.ai and any MCP-aware client connect to the phaedrus MCP server (already deployed). |
| **Forks + PRs** | Unchanged; still works the way it always has. |

## Operator action — before merging

1. **Add the autogen markers to \`${LLMS_TXT}\`.** Anywhere in the file:

   \`\`\`
   <!-- phaedrus:llms-autogen:start -->
   <!-- phaedrus:llms-autogen:end -->
   \`\`\`

   Everything between is owned by phaedrus and gets regenerated; everything outside is preserved byte-for-byte.

2. **Backfill \`description:\` in existing posts' front matter** (optional but recommended). That one-liner shows up in \`${LLMS_TXT}\` bullets and as the SEO meta description. Posts without it become bare-title bullets.

## After merging

- Visit \`${SITE_URL%/}/admin/\` — Decap should hand you off through the OAuth proxy at \`${URL}\` and back.
- The next push to \`${GH_BRANCH}\` will trigger the **Update llms.txt** workflow under Actions; expect green.

## Re-running this PR

Re-running \`make install-site-assets SITE=…\` on phaedrus pushes new commits to this same branch (\`${BR}\`) — the PR will update in place rather than open a duplicate.

---

phaedrus is MIT-licensed. Site content keeps whatever license this repo declares.
EOF
)
if gh pr view "$BR" >/dev/null 2>&1; then
  echo "PR for ${BR} already exists; leaving its description as-is. Edit on GitHub if you want to refresh it."
else
  gh pr create --base "$GH_BRANCH" --head "$BR" --title "$PR_TITLE" --body "$PR_BODY" || \
    echo "Branch pushed; open the PR manually."
fi
echo "NOTE: add the AUTOGEN markers to ${LLMS_TXT} and backfill post 'description:' before first merge (Spec B §1.1)."
