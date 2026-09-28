# Spec B — Authoring automation: MCP server, llms.txt, author contract

Spec B covers the three things that converge on the **PR review gate**:

1. The **MCP server** (`services/mcp-server/`) — the AI / agent authoring door.
2. The **llms.txt template** (`site-assets/llms.txt.tmpl`) — a Liquid page Jekyll renders at build time, so `llms.txt` stays honest as the site grows.
3. The **author contract** — the shared shape of `_authors/` + `_data/authors.yml` that Decap, the MCP, and humans all agree on.

## 0. The PR review gate

Every authoring door lands changes as a pull request against the content repo's default branch (`$GH_BRANCH`). `install-site-assets.sh` makes that convergence real with **branch protection** on that branch:

- **Require 1 approving review** before a PR can merge.
- **`enforce_admins: false`** — the rule does *not* apply to repository admins.

Branch protection is **identity-based, not per-door** — GitHub can only tell "admin" from "not admin", so the gate falls out of *who each door authenticates as*:

| Actor | Identity | On merge |
|---|---|---|
| Site owner via Decap | their own GitHub account, a repo **admin** | exempt — Decap "Publish" merges directly |
| MCP / autonomous editor (Ananda) | the **GitHub App** installation (not an admin) | PR waits for a human approval |
| Collaborators, fork PRs | non-admin accounts | PR waits for a human approval |
| Public contributor via Decap *(bot backend on)* | their own GitHub account for login; the **GitHub App** commits | App-pushed branch + PR on the content repo — waits for a human approval |

The trust model: a repo admin is trusted to publish their own edits; everything that isn't an admin — automation, outside contributors — waits for a human. Because Decap authenticates as whoever logs in, the admin exemption only applies to that person if they're actually a repo admin.

### Opening `/admin/` to the public — bot backend

phaedrus is used **primarily by site admins**; the default `/admin/` door commits as the logged-in user onto a branch **on the content repo itself**, which only works for people with push access. One site — **Kindness Flywheel**, an open-source publication — needs `/admin/` open to *any* GitHub-account holder with no push access. Setting **`DECAP_BOT_BACKEND=true`** in `sites/<site>.env` does that **without forks**:

- `install-site-assets.sh` writes `api_root: $BASE_URL/github` into `admin/config.yml`, pointing Decap's GitHub API at the OAuth proxy.
- The proxy (Spec A, "Bot backend") forwards `/user` as the human (login + commit author) but performs every repo write with the **phaedrus GitHub App installation token** — the same identity the MCP door uses. A contributor with **no push access** lands a branch + PR **directly on the content repo**; no fork, nothing for them to maintain.
- The PR targets the protected `$GH_BRANCH`, so the **1-approval gate applies** exactly as it does to MCP and collaborator PRs. The contributor cannot merge.

This is opt-in and **off by default** — admin-run sites never touch it. It is **on for `sites/kindnessflywheel.env`**. Two requirements:

- The GitHub App needs **Issues: Read & write** added (beyond Contents RW + Pull requests RW) — Decap's editorial workflow creates and moves PR labels. `deploy-proxy.sh` prints this reminder when the bot backend is on.
- `bootstrap.sh` grants the proxy's service account access to the App secrets, and `deploy-proxy.sh` mounts them. (We deliberately considered and rejected Decap "Open Authoring", which forks the repo into each contributor's account — a UX liability for non-technical authors. The bot backend keeps the whole git layer invisible.)

Setup notes:

- Setting protection needs **admin** on the content repo, and on **private** repos requires a paid GitHub plan. The installer **warns and continues** if it can't apply the rule — the repo is simply left unprotected (no gate).
- **Non-destructive on re-run:** if protection already exists, the installer leaves it untouched, so an operator who tightened the rule (required status checks, 2 reviewers, include-admins) keeps their settings.
- A solo maintainer who wants *their own* edits gated too can set `enforce_admins: true` — but GitHub never lets you approve or request changes on a PR you authored, so their own Decap PRs would then stall until a second account approves (or they temporarily lift protection to merge). The default `enforce_admins: false` deliberately avoids that dead end.

## 1. llms.txt template

`llms.txt` is an ordinary Jekyll page: Liquid with front matter (`layout: null`, `permalink: /llms.txt`, `sitemap: false`, `search: false`), the same approach `jekyll-feed` and `jekyll-sitemap` take. Jekyll already knows every post, URL, excerpt and collection when it builds, so the file is rendered from that and can't fall out of date.

- **Seeded once, then site-owned.** `install-site-assets.sh` copies `site-assets/llms.txt.tmpl` to `$LLMS_TXT` only if the site has no `llms.txt`, the same way `_data/tags.yml` is seeded. It never overwrites the file afterwards; the site edits the hand-written prose (preamble, purpose, license, contact) freely.
- **`## Posts`** loops over `site.posts`, one bullet per post: `- [title](absolute url): note`, where the note is `description`, falling back to `excerpt`. `site.posts` already excludes `published: false` and future-dated posts, and URLs come from Jekyll's own permalink rules (including `baseurl`).
- **`## Authors`** loops over the `authors` collection sorted by `title`; the note is the matching `_data/authors.yml` entry's `bio`, falling back to the author page's `description` (see §2). The whole section is wrapped in `{% if site.authors.size > 0 %}`, so a site without an `authors` collection gets no empty heading.
- **Works on classic GitHub Pages.** Plain Liquid with no plugin, so the `github-pages` plugin whitelist doesn't matter.
- **No commits.** Nothing pushes to the default branch, so it never conflicts with the PR review gate (§0).

### Why `excerpt:` is the canonical hook

Every post **must** declare a one-line `excerpt:` in front matter. It's the Jekyll-core teaser *and* the SEO meta description (jekyll-seo-tag falls back `description` → `excerpt` → `site.description`), and it's the note the `llms.txt` template shows for each post (after `description`, if set). A post may add an optional `description:` only when the SEO meta text must differ from the excerpt. `install-site-assets.sh` prints a reminder to backfill `excerpt:` on existing posts before the first merge.

### Canonical post schema

The generated Decap config and the MCP tools agree on one schema, the universal Jekyll + jekyll-seo-tag convention: `title`, `date`, `author` (singular id), `excerpt`, `tags` (≥1), `body`. `description` and `categories` are off by default and opt-in per site via `sites/<site>.posts-fields.yml`. There is no `lens` — a "lens" is just one of a post's tags. The canonical fields block lives in `site-assets/admin/posts-fields.yml`.

## 1.2. Tag-vocabulary PR check

The curated tag vocabulary lives in `_data/tags.yml` in the content repo — the single source of truth read by the Decap Tags relation widget, the MCP server (at request time), and this check. It is PR-gated, not baked into config or deploy env.

`site-assets/workflows/check-new-tags.yml` runs on every PR touching `_posts/**` or `_data/tags.yml`. It runs `scripts/check_new_tags.py`, which flags any post tag on the PR head that isn't in `_data/tags.yml`, and **posts a sticky PR comment** listing them and which post uses each.

The check is **deliberately non-blocking** — it always exits 0. Adding the tag to `_data/tags.yml` in the same PR clears the flag; that's the deliberate way to expand the vocabulary. The check catches synonyms and typos early ("Strategy" vs "strategy", "post-mortem" vs "postmortem").

Uses `marocchino/sticky-pull-request-comment@v2` to keep one comment per PR (re-runs update in place; PRs with no out-of-vocabulary tags get their comment cleared).

## 2. Author contract

All three authoring doors share the same shape:

**`_authors/<id>.md`** (Jekyll collection, rendered as author pages):

```yaml
---
name: "Jane Smith"
bio:  "Two-line bio. Plain text."
url:  "https://example.com"        # optional
avatar: "https://…"                # optional
---
```

**`_data/authors.yml`** (used by `llms.txt`, feeds, and Minimal-Mistakes-style components):

```yaml
jane-smith:
  name: "Jane Smith"
  bio:  "Two-line bio."
  url:  "https://example.com"
```

The `bio` here is the note shown for each author in the `llms.txt` `## Authors` section (§1). The template looks it up as `site.data.authors[author.title]`, so the key must match the author page's `title`, which is the shape Minimal Mistakes already uses (Kindness Flywheel: `_authors/geoff-scott.md` has `title: Geoff Scott`, keyed `Geoff Scott:` in `_data/authors.yml`). If there's no matching entry, the page's `description` is used instead.

**Posts reference an author by key** in front matter (singular `author`, the standard jekyll-seo-tag key):

```yaml
author: jane-smith
```

The value must **exactly match** the key the author is defined under in `_data/authors.yml` (and the corresponding `_authors/<key>.md`). minimal-mistakes and jekyll-seo-tag resolve the author by exact string match, so the key can be a slug (`jane-smith`) **or** a display name — Kindness Flywheel keys its author as `Geoff Scott` — but it must be identical everywhere and never renamed without rewriting every post that references it.

**Authoring through the MCP:** pass that same key verbatim as the `author` argument to `post_create` / `post_update` (e.g. `Geoff Scott` on KF, not `geoff-scott`). The MCP does not slugify or transform it — it writes the string as given, so a mismatch silently breaks the author lookup. The `author_upsert` tool and the Decap "Authors" collection write the same shape. A site that genuinely needs multiple authors per post can switch to plural `authors` via a per-site `sites/<site>.posts-fields.yml` override.

## 3. MCP server

Lives at `services/mcp-server/` (TypeScript, Node 20, Cloud Run). Authenticates to GitHub as a **GitHub App** installation; every authoring action commits to a `phaedrus/post/<slug>` (or `phaedrus/author/<id>`) branch and opens a PR against the configured default branch — **the same review gate as the human and Decap flows**.

### Transport

Streamable HTTP at `POST/GET/DELETE /mcp`. Stateless — Cloud Run instances may disappear between requests, so each request spins up a fresh `McpServer` + `StreamableHTTPServerTransport` (with `sessionIdGenerator: undefined`). `GET /health` is for the load balancer.

### Configuration (env)

All injected at deploy time by `scripts/deploy-mcp.sh`:

| Var                       | Purpose                                                              |
| ------------------------- | -------------------------------------------------------------------- |
| `GH_OWNER` / `CONTENT_REPO` | The content repo.                                                  |
| `GH_BRANCH`               | Default branch — the merge target for every PR.                      |
| `POSTS_DIR` / `AUTHORS_DIR` / `AUTHORS_DATA` / `IMAGES_DIR` | Paths in the content repo.                       |
| `TAGS_DATA`               | Path to the curated tag vocabulary (default `_data/tags.yml`); read per request to validate `tags`. |
| `TOOL_PREFIX`             | Tool-name prefix (default `post_`). Lets a host disambiguate sites. |
| `GITHUB_APP_ID`           | Secret Manager (`*-mcp-github-app-id`).                              |
| `GITHUB_APP_PRIVATE_KEY`  | Secret Manager (`*-mcp-github-app-key`); the PEM, as a string.       |

### Tools (with `TOOL_PREFIX="post_"`, the default)

| Tool             | Effect                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `post_list`      | List recent posts on `$GH_BRANCH`.                                                                                                                  |
| `post_get`       | Read a post's front matter + body.                                                                                                                  |
| `post_create`    | Validate args (slug, `excerpt`, `author`, `tags` ≥ 1 and ⊆ `_data/tags.yml`), branch `phaedrus/post/<slug>` off `$GH_BRANCH`, commit, open or reuse a PR. |
| `post_update`    | Apply patch to an existing post on the post's phaedrus branch (creates the branch from default if needed). PR remains open or is reopened.          |
| `author_upsert`  | Add/update `_authors/<id>.md` on `phaedrus/author/<id>`, open PR.                                                                                   |
| `image_upload`   | Decode base64 image, commit to `$IMAGES_DIR/<slug>/<filename>` on the post's branch. Returns the repo path for use in the post body.                |

Every write goes through the same `ensureBranch → putFile → ensurePR` pipeline (`src/github.ts`). PRs are **deduped per slug**: a second call against the same slug updates the existing PR instead of opening a new one.

### Why a GitHub App and not a PAT

- Installation tokens are short-lived (~1h) — revoke-by-rotation is automatic.
- Scope is per-repo (Contents RW, PRs RW), not per-user.
- The audit trail attributes commits to the app, not the operator's personal account.

### Forward seam — Ananda

The tool contract above is what an autonomous editor (working name: **Ananda**) integrates against. Keep the tool names, argument schemas, and PR-per-branch behavior stable: any change here is a coordinated change across sites, since every site phaedrus serves uses the same MCP surface.
