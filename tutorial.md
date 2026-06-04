# Deploy phaedrus for a site

## Pick your project
<walkthrough-project-setup></walkthrough-project-setup>
Run: `gcloud config set project <walkthrough-project-id/>`

## Configure your site
```sh
make configure        # walks each setting; Enter accepts the KF default
```

## Bootstrap GCP
```sh
make bootstrap SITE=<key>
```

## Create the two GitHub apps (manual)

GitHub apps are owned by a **user account or an organization** (not a repo). Recommended: create both under the same account that owns your content repo (your `GH_OWNER`) so bot attribution stays on-brand and ownership transfers with the org. Your personal account also works if you don't have org-owner permissions.

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

<walkthrough-conclusion-trophy></walkthrough-conclusion-trophy>
