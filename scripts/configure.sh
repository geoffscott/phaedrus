#!/usr/bin/env bash
set -euo pipefail
# Walk each setting one at a time. Enter accepts the Kindness Flywheel default.
ask() {  # ask VAR "Prompt" "default"
  local __var="$1" __prompt="$2" __default="$3" __in
  read -rp "${__prompt} [${__default}]: " __in
  printf -v "$__var" '%s' "${__in:-$__default}"
}
echo "phaedrus configuration — press Enter to accept the KF default."
ask SITE_KEY       "Site key (filename + resource prefix)" "kindnessflywheel"
OUT="sites/${SITE_KEY}.env"
if [ -f "$OUT" ]; then
  read -rp "${OUT} exists. Overwrite? [y/N]: " yn
  [[ "$yn" =~ ^[Yy]$ ]] || { echo "Keeping existing ${OUT}."; exit 0; }
fi
ask SITE_NAME      "Site name"                        "Kindness Flywheel"
ask SITE_URL       "Site URL"                         "https://kindnessflywheel.org"
SITE_ORIGIN="$SITE_URL"
ask GH_OWNER       "GitHub owner (content repo)"      "kindnessflywheel"
ask GH_REPO        "GitHub repo (content)"            "kindnessflywheel-site"
ask GH_BRANCH      "Branch"                           "main"
ask GH_VISIBILITY  "Visibility (public|private)"      "public"
ask GCP_REGION     "GCP region"                       "us-central1"
ask NAME_PREFIX    "Resource name prefix"             "$SITE_KEY"
ask POSTS_DIR      "Posts dir"                         "_posts"
ask AUTHORS_DIR    "Authors dir"                       "_authors"
ask AUTHORS_DATA   "Authors data file"                "_data/authors.yml"
ask IMAGES_DIR     "Images dir"                        "assets/images/posts"
ask LLMS_TXT       "llms.txt path"                     "llms.txt"
ask TAXONOMY_LABEL "Taxonomy UI label (site-wide)"     "Lenses"
ask TAXONOMY_KEY   "Taxonomy front-matter key (per post)" "lens"
ask TAXONOMY_TERMS "Taxonomy terms (comma-separated)"  "Strategy,People,Technology,Practice,Meta"
mkdir -p sites
cat > "$OUT" <<EOF
SITE_NAME="${SITE_NAME}"
SITE_URL="${SITE_URL}"
SITE_ORIGIN="${SITE_ORIGIN}"
GH_OWNER="${GH_OWNER}"
GH_REPO="${GH_REPO}"
GH_BRANCH="${GH_BRANCH}"
GH_VISIBILITY="${GH_VISIBILITY}"
GCP_REGION="${GCP_REGION}"
NAME_PREFIX="${NAME_PREFIX}"
POSTS_DIR="${POSTS_DIR}"
AUTHORS_DIR="${AUTHORS_DIR}"
AUTHORS_DATA="${AUTHORS_DATA}"
IMAGES_DIR="${IMAGES_DIR}"
LLMS_TXT="${LLMS_TXT}"
TAXONOMY_LABEL="${TAXONOMY_LABEL}"
TAXONOMY_KEY="${TAXONOMY_KEY}"
TAXONOMY_TERMS="${TAXONOMY_TERMS}"
EOF
echo "Wrote ${OUT} (gitignored). Next: make bootstrap SITE=${SITE_KEY}"
