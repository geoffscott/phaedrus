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
| `BASE_URL`                   | set on the second deploy phase | The function's own public URL. Used to build `redirect_uri`.    |

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

## What's intentionally not here

- No session/cookie state. The proxy is stateless — every request is independent.
- No multi-site routing. One function per site (`$NAME_PREFIX-oauth`).
- No refresh-token handling. GitHub OAuth Apps don't issue refresh tokens for this flow; Decap re-runs `/auth` when its token expires.
