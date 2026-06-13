# Deploy phaedrus for a site

## Pick your project
<walkthrough-project-setup></walkthrough-project-setup>
Run: `gcloud config set project <walkthrough-project-id/>`

## Configure your site
```sh
make configure        # walks each setting; Enter accepts the KF default
```
One prompt to note: **`DECAP_BOT_BACKEND`** (default `false`). Leave it `false` and `/admin/` is the owner/maintainer door (only people with push access can use it). Set it `true` to open `/admin/` to **any GitHub-account holder** with no push access: Decap's GitHub API is routed through the proxy, which commits as the phaedrus GitHub App, so a branch + PR land on the content repo for review — no fork, nothing for the contributor to maintain. See Spec B §0. If you enable it, the GitHub App needs one extra permission (next section). Kindness Flywheel ships with it `true`.

## Bootstrap GCP
```sh
make bootstrap SITE=<key>
```

## Create the two GitHub apps (manual)

GitHub apps are owned by a **user account or an organization** (not a repo). Recommended: create both under the same account that owns your content repo (your `GH_OWNER`) so bot attribution stays on-brand and ownership transfers with the org. Your personal account also works if you don't have org-owner permissions.

**Naming**
- OAuth App: `<Site Name> CMS` — appears on the GitHub consent screen ("Authorize …"), so make it the editor-facing brand.
- GitHub App: `<NAME_PREFIX>-phaedrus` — becomes the bot author in commit history (`…-phaedrus[bot]`). Self-documents what made the commit, and the per-site prefix keeps you clear of GitHub's global-uniqueness requirement (34-char limit). OAuth App names aren't unique; just be descriptive.

### OAuth App (Decap login)
`Settings → Developer settings → OAuth Apps → New OAuth App`

- **Homepage URL:** your `SITE_URL`.
- **Authorization callback URL:** `<PROXY_URL>/callback`. `PROXY_URL` is printed after `make deploy SITE=<key>`, so set a placeholder (e.g. `https://example.com/callback`) now and update it after deploy.
- Save, then **copy the Client ID** and **generate a Client Secret** — copy that too (you only see it once).
- Export them for the next steps: `GH_CLIENT_ID` (used by `make deploy`) and `GH_CLIENT_SECRET` (used by `make secrets`).

### GitHub App (MCP commits)
`Settings → Developer settings → GitHub Apps → New GitHub App`

- **Homepage URL:** your `SITE_URL`.
- **Callback URL:** leave blank (this field is for OAuth Apps — a common confusion).
- **Webhook → Active:** uncheck.
- **Permissions → Repository:**
  - Contents: **Read & write**
  - Pull requests: **Read & write**
  - Issues: **Read & write** — **only if** you set `DECAP_BOT_BACKEND=true` (the proxy commits as this App for public `/admin/` contributors, and Decap's editorial workflow manages PR labels, which need the Issues permission). Skip it otherwise.
  - Nothing else.
- **Where can this GitHub App be installed:** "Only on this account" is fine.
- Save, then note the **App ID** and **generate + download a private-key PEM** (one-time download — store it securely; this becomes `GH_APP_KEY_FILE`).
- **Install** the app on the account that owns your content repo (`GH_OWNER`), scoped to that single repo.

> **Pitfalls:** the callback URL is OAuth-only — don't add one to the GitHub App. No webhooks needed. Create a separate app pair per site; don't share the PEM.

## Store secrets
```sh
export GH_CLIENT_SECRET=… GH_APP_ID=… GH_APP_KEY_FILE=~/app-key.pem
make secrets SITE=<key>
```

## Deploy
```sh
export GH_CLIENT_ID=…
make deploy SITE=<key>
```

## Wire up the content repo
```sh
make install-site-assets SITE=<key>
```
Set the OAuth App callback to the printed `PROXY_URL/callback`, merge the PR, and you're live.

> First run opens a richly described setup PR. Re-runs default to a generic "update site assets" title plus a diffstat — so for a meaningful change, describe it: `PR_TITLE="…" PR_BODY="…" make install-site-assets SITE=<key>`. If the PR is already open, those env vars refresh its title/description in place.

<walkthrough-conclusion-trophy></walkthrough-conclusion-trophy>
