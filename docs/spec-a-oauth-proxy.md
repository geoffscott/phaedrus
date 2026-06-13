# Spec A — Decap OAuth proxy

The OAuth proxy is the **human authoring door** for phaedrus. It is the external
OAuth client that Decap CMS opens when an editor clicks "Login with GitHub" in
the site's `/admin/`. The proxy holds the GitHub OAuth App **client secret** so
Decap (which is purely browser-side) never has to. It is config-driven via env
vars so the same code deploys for every site.

Lives at: `services/oauth-proxy/` — a Cloud Functions gen2 HTTP function called
`decapOauth`, deployed by `scripts/deploy-proxy.sh`.

## Configuration (env)

All values are injected at deploy time from the active `sites/<key>.env`:

| Var                          | Source                  | Purpose                                                                |
| ---------------------------- | ----------------------- | ---------------------------------------------------------------------- |
| `GITHUB_OAUTH_CLIENT_ID`     | `$GH_CLIENT_ID` exported by operator | Public client id from the GitHub OAuth App.                |
| `GITHUB_OAUTH_CLIENT_SECRET` | Secret Manager (`*-github-oauth-client-secret`) | OAuth App secret.                               |
| `STATE_SIGNING_KEY`          | Secret Manager (`*-state-signing-key`) | HMAC key used to sign the `state` parameter.             |
| `OAUTH_SCOPE`                | derived from `GH_VISIBILITY` (`public` → `public_repo`, `private` → `repo`) | Scope requested from GitHub. |
| `ALLOWED_ORIGIN`             | `SITE_ORIGIN`           | The origin we will `postMessage` the token back to. Hard pin.          |
| `BASE_URL`                   | set on the second deploy phase | The public URL the proxy is reached at — used to build `redirect_uri` and Decap's `base_url`. The function's own `*.run.app` URL by default, or `https://$AUTH_DOMAIN` when a custom domain is configured. |

## Routes

- `GET /auth` — Entry point. Generates a fresh `state = base64url(payload).base64url(hmacSha256(payload))` where `payload = {nonce, ts}`, then 302-redirects to `https://github.com/login/oauth/authorize?client_id=…&redirect_uri=BASE_URL/callback&scope=…&state=…&allow_signup=false`.
- `GET /callback` — Receives `?code=…&state=…` from GitHub. Verifies the HMAC and TTL (10 minutes). Exchanges `code` for an access token at `https://github.com/login/oauth/access_token`. Returns an HTML page that `postMessage`s the result back to `ALLOWED_ORIGIN`.
- `GET /health` — Liveness check.

## Decap handshake protocol

Decap's external OAuth client convention:

1. The popup posts `"authorizing:github"` to its `opener` (Decap listens for the ping).
2. Decap replies — the message handler ignores anything not from `ALLOWED_ORIGIN`.
3. We send the final payload:
   - Success: `"authorization:github:success:{\"token\":\"…\",\"provider\":\"github\"}"`
   - Error:   `"authorization:github:error:{\"message\":\"…\"}"`

Both are sent with `targetOrigin = ALLOWED_ORIGIN`, never `'*'`.

## Security notes

- The OAuth App **client secret never leaves Secret Manager → Cloud Function env**.
- `state` is HMAC-signed with a per-site random key (`*-state-signing-key`, generated at bootstrap, never logged). 10-minute TTL.
- `postMessage` target is pinned to `ALLOWED_ORIGIN`. Refuses `'*'`.
- The function refuses the token exchange if GitHub's response is missing `access_token`.
- The Cloud Function runs as a dedicated runtime SA (`<prefix>-oauth-rt`) with **only** `secretmanager.secretAccessor` on the two relevant secrets.

## Idempotency

`deploy-proxy.sh` is two-phase to handle the chicken-and-egg with `BASE_URL`:

1. First `gcloud functions deploy` with `BASE_URL=PENDING` — creates or updates the function and assigns it its URL.
2. Read the URL back with `gcloud functions describe …`.
3. Second `gcloud functions deploy --update-env-vars="BASE_URL=$URL"` — same URL on every subsequent run, so this converges.

The OAuth App callback you configure in the GitHub UI is `$BASE_URL/callback`.

## Custom domains (optional)

By default the proxy and the MCP server each answer on their own `*.run.app`
URL. Two optional, independent vars in `sites/<key>.env` put a custom subdomain
on either service via a **plain Cloud Run domain mapping** — one host per
service, no load balancer (`scripts/deploy-domain.sh`, `make deploy-domain`):

| Var | Maps to | Result |
|---|---|---|
| `MCP_DOMAIN` (e.g. `mcp.example.org`) | MCP server | `https://mcp.example.org/mcp` |
| `AUTH_DOMAIN` (e.g. `auth.example.org`) | OAuth proxy | OAuth flow at `https://auth.example.org` |

A domain mapping maps one host to one service, which is exactly the shape here —
two services, two subdomains. (Putting *both* on a single host path-routed
(`api.example.org/mcp` + `/auth`) is the one thing a mapping can't do; that would
need a load balancer, which is deliberately not used here.)

Operational consequences:

- **When `AUTH_DOMAIN` is set, `BASE_URL` becomes `https://$AUTH_DOMAIN`** (set by
  `deploy-proxy.sh`), so the GitHub `redirect_uri` is `https://$AUTH_DOMAIN/callback`.
  **Update the GitHub OAuth App's Authorization callback URL to match** — a stale
  callback breaks login. Decap's `base_url` (written by `install-site-assets.sh`)
  likewise becomes `https://$AUTH_DOMAIN`.
- **Cloudflare must be DNS-only (grey cloud)** on the `CNAME` the mapping prints
  (→ `ghs.googlehosted.com`), at least until the Google-managed cert provisions
  (~15–60 min). Orange-cloud proxying terminates TLS at Cloudflare's edge and
  blocks cert validation; switch to proxied (SSL Full (strict)) only afterward.
- **One-time:** the parent domain must be verified for your account
  (`gcloud domains verify <parent-domain>`) before a mapping is accepted.
- **Requires the gcloud `beta` component** (`gcloud components install beta`).
  Managed Cloud Run domain mappings are `gcloud beta run domain-mappings`; the GA
  `gcloud run domain-mappings` is the Cloud Run for Anthos surface. The script
  preflights this and exits with that instruction if beta is missing.
- Domain mappings add no recurring cost beyond the services themselves.
- `make deploy-domain` is idempotent (skips existing mappings) and a no-op when
  both vars are empty; `make deploy` runs it last. `make destroy` deletes the
  mappings.

## Bot backend — authenticating GitHub-API proxy (`/github`)

By default the proxy only does OAuth: it hands Decap the **logged-in user's own
token**, and Decap talks to `api.github.com` directly. That means `/admin/` only
works for people with push access to the content repo (their token must be able to
push the branch). To open `/admin/` to **any GitHub-account holder with no push
access** — without the fork-based "Open Authoring" flow — a site sets
`DECAP_BOT_BACKEND=true` (see Spec B §0). `install-site-assets.sh` then writes
`api_root: $BASE_URL/github` into `admin/config.yml`, so Decap routes **all** its
REST calls through this proxy (REST only — phaedrus never sets `use_graphql`).

Under `/github`, the proxy is an **authenticating reverse proxy** to
`https://api.github.com`. It swaps the `Authorization` per route:

| Incoming path (after `/github`) | Forwarded as | Why |
|---|---|---|
| `/user`, `/user/*`, `/users/*` | the **contributor's** OAuth token (passthrough) | Identity + public-profile reads — an installation token can't call `/user`, and Decap fetches the commit author's profile via `/users/<login>` (e.g. the bot's, for its avatar on the workflow card). Never touches the App token. |
| `/repos/$GH_OWNER/$CONTENT_REPO[/*]` | the **GitHub App installation token** | Lets a no-push-access contributor create branches, commits, and PRs on the content repo. The App is the **committer** (commit *author* is the human — see below); the gate (branch protection) still applies. |
| anything else | — | `403`. Stops the App token being used as a general api.github.com relay. |

Mechanics:

- **Token validation.** Before using the App token on a repo path, the proxy
  validates the contributor's bearer token against `GET /user` (cached ~5 min by
  token hash) and refuses if invalid — so the powerful App token is never lent to an
  anonymous caller. (The MCP door is already unauthenticated and App-backed, so this
  is strictly *more* gated than the existing automation door.)
- **Installation token.** Minted exactly like the MCP server's identity (App JWT →
  `GET /repos/{o}/{r}/installation` → `POST /app/installations/{id}/access_tokens`),
  using the **same GitHub App and secrets** (`*-mcp-github-app-id`, `*-mcp-github-app-key`).
  `bootstrap.sh` grants the proxy SA `secretAccessor` on them; `deploy-proxy.sh`
  mounts them plus `GH_OWNER`/`CONTENT_REPO`/`GH_BRANCH`. Cached in-memory, refreshed
  ~1 min before expiry. The JWT is signed with `node:crypto` (RS256) — no extra deps.
- **CORS.** `/admin/` is on `SITE_ORIGIN` while `api_root` is the proxy host, so the
  proxy answers the preflight and pins `Access-Control-Allow-Origin` to
  `ALLOWED_ORIGIN`, exposing `Link`/`ETag`/rate-limit headers.
- **Pagination.** The upstream `Link` header's `api.github.com` URLs are rewritten to
  `$BASE_URL/github` so follow-up pages stay on the proxy.
- **Repo-permissions rewrite.** Decap's `hasWriteAccess()` reads `permissions.push`
  from `GET /repos/{owner}/{repo}` and refuses login if it's false. An installation
  token isn't a *user*, so GitHub reports all-false permissions there — which would
  block every contributor. Since writes genuinely go through the App via this proxy,
  the proxy rewrites **only that one response** (exact repo path, `GET`, JSON 200) to
  report `push: true`. Subpaths and all other responses pass through byte-for-byte.
- **Commit attribution.** On the commit-creating writes (`POST …/git/commits` and
  `PUT …/contents/…`), the proxy injects an `author` built from the validated
  contributor's identity, using their GitHub **noreply** email
  (`<id>+<login>@users.noreply.github.com`) — so `git log` credits the human and the
  commit links to their profile **without exposing any private email**. It sets
  `author` only and omits `committer`, so GitHub fills the committer in from the
  author too: the commit ends up **fully attributed to the contributor** (author and
  committer), linked to their account. The App identity is purely *authorization* —
  the installation token is what actually creates the commit/ref/PR — and is what
  *opens* the PR. Because `author` is taken from the validated token (not from the
  request body), a contributor cannot spoof someone else's identity.

The bot backend requires the GitHub App to also grant **Issues: Read & write**
(Decap's editorial workflow manages PR labels). It is **off by default**; sites that
don't set `DECAP_BOT_BACKEND` never exercise the `/github` route or the App secrets.

## What's intentionally not here

- No session/cookie state. The proxy is stateless — every request is independent.
- No multi-site routing. One function per site (`$NAME_PREFIX-oauth`).
- No refresh-token handling. GitHub OAuth Apps don't issue refresh tokens for this flow; Decap re-runs `/auth` when its token expires.
