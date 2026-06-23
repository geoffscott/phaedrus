// phaedrus — Decap CMS external OAuth client for GitHub.
// Cloud Functions gen2 HTTP entry point: decapOauth.
// Routes:
//   GET /auth      Decap popup opens here; we sign state and redirect to GitHub.
//   GET /callback  GitHub redirects here; we exchange the code and postMessage to opener.
//
// Required env (all injected by scripts/deploy-proxy.sh):
//   GITHUB_OAUTH_CLIENT_ID       Public OAuth App client id.
//   GITHUB_OAUTH_CLIENT_SECRET   From Secret Manager.
//   STATE_SIGNING_KEY            From Secret Manager (HMAC secret).
//   OAUTH_SCOPE                  "public_repo" or "repo".
//   ALLOWED_ORIGIN               The site origin (SITE_ORIGIN) — restricts the postMessage target.
//   BASE_URL                     Public URL of this function (set by the second deploy phase).

const functions = require('@google-cloud/functions-framework');
const crypto = require('node:crypto');

const STATE_TTL_MS = 10 * 60 * 1000;

const env = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env: ${k}`);
  return v;
};

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlDecode = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
};

function signState(payload, key) {
  const body = b64url(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', key).update(body).digest();
  return `${body}.${b64url(mac)}`;
}

function verifyState(token, key) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', key).update(body).digest();
  const actual = b64urlDecode(sig);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(body).toString('utf8'));
  } catch {
    return null;
  }
  if (!payload?.ts || Date.now() - payload.ts > STATE_TTL_MS) return null;
  return payload;
}

function htmlMessage(status, content, allowedOrigin) {
  // Decap listens for messages of the form:
  //   "authorization:github:success:<json>" or "authorization:github:error:<json>"
  // We send to the exact ALLOWED_ORIGIN; Decap's handshake protocol exchanges a
  // ready ping before we post the actual payload.
  const message = `authorization:github:${status}:${JSON.stringify(content)}`;
  const origin = JSON.stringify(allowedOrigin);
  const msg = JSON.stringify(message);
  return `<!doctype html><html><head><meta charset="utf-8"><title>phaedrus</title></head><body>
<script>
(function () {
  var allowed = ${origin};
  var payload = ${msg};
  function send() {
    if (!window.opener) return;
    window.opener.postMessage(payload, allowed);
  }
  function receive(e) {
    if (e.origin !== allowed) return;
    if (e.data === 'authorizing:github') send();
  }
  window.addEventListener('message', receive, false);
  // Kick off the handshake; Decap may ping us first.
  if (window.opener) window.opener.postMessage('authorizing:github', allowed);
  setTimeout(send, 250);
  setTimeout(function () { window.close(); }, 5000);
})();
</script>
<p>phaedrus: authentication ${status}. You may close this window.</p>
</body></html>`;
}

// --- Bot backend (DECAP_BOT_BACKEND) -------------------------------------------
// When a site opts in, Decap's `backend.api_root` points at `${BASE_URL}/github`
// and every GitHub REST call arrives here carrying the logged-in user's OAuth token.
// We forward to api.github.com, but swap the token: `/user` runs as the human (so
// Decap shows the real contributor and attributes the commit author), while repo
// paths run as the phaedrus GitHub App installation — so a contributor with NO push
// access (and no fork) can land a branch + PR on the content repo for review. Any
// path outside that allowlist is refused so the app token can't be used as a general
// api.github.com relay. Mirrors the MCP server's GitHub App identity.

const GH_API = 'https://api.github.com';
const GH_UA = 'phaedrus-oauth-proxy';

// GitHub App JWT (RS256) — signed with node:crypto so the proxy needs no extra deps.
function signAppJwt(appId, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: String(appId) }));
  const data = `${header}.${payload}`;
  const sig = crypto.createSign('RSA-SHA256').update(data).sign(privateKey);
  return `${data}.${b64url(sig)}`;
}

// Module-cached installation token (and its installation id). Refreshed ~1m early.
let instCache = { id: null, token: null, exp: 0 };
async function getInstallationToken() {
  if (instCache.token && instCache.exp - Date.now() > 60 * 1000) return instCache.token;
  const appId = env('GITHUB_APP_ID');
  const privateKey = env('GITHUB_APP_PRIVATE_KEY');
  const owner = env('GH_OWNER');
  const repo = env('CONTENT_REPO');
  const jwt = signAppJwt(appId, privateKey);
  const appHeaders = { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json', 'User-Agent': GH_UA };
  if (!instCache.id) {
    const r = await fetch(`${GH_API}/repos/${owner}/${repo}/installation`, { headers: appHeaders });
    if (!r.ok) throw new Error(`installation lookup failed: ${r.status}`);
    instCache.id = (await r.json()).id;
  }
  const tr = await fetch(`${GH_API}/app/installations/${instCache.id}/access_tokens`, { method: 'POST', headers: appHeaders });
  if (!tr.ok) throw new Error(`installation token mint failed: ${tr.status}`);
  const data = await tr.json();
  instCache.token = data.token;
  instCache.exp = new Date(data.expires_at).getTime();
  return instCache.token;
}

// Validate the contributor's OAuth token (so the app token isn't lent to anonymous
// callers) AND capture their identity for commit attribution. Returns {login,id,name}
// or null. Cached briefly by token hash to avoid a /user round-trip per request.
const userCache = new Map();
async function getValidatedUser(token) {
  const key = crypto.createHash('sha256').update(token).digest('hex');
  const hit = userCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.user;
  const r = await fetch(`${GH_API}/user`, {
    headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': GH_UA },
  });
  if (!r.ok) return null;
  const u = await r.json();
  const user = { login: u.login, id: u.id, name: u.name };
  userCache.set(key, { exp: Date.now() + 5 * 60 * 1000, user });
  return user;
}

// The contributor's commit author identity. We use GitHub's noreply email
// (<id>+<login>@users.noreply.github.com) so the commit links to their profile
// without ever exposing a private address. The bot remains the committer.
function commitAuthor(user) {
  return {
    name: user.name || user.login,
    email: `${user.id}+${user.login}@users.noreply.github.com`,
  };
}

function setCors(res, allowedOrigin) {
  res.set('Access-Control-Allow-Origin', allowedOrigin);
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization,Content-Type,Accept,If-Match,If-None-Match');
  res.set('Access-Control-Max-Age', '600');
  res.set('Access-Control-Expose-Headers',
    'Link,ETag,X-OAuth-Scopes,X-RateLimit-Limit,X-RateLimit-Remaining,X-RateLimit-Reset');
}

async function handleGithubProxy(req, res, url) {
  const allowed = env('ALLOWED_ORIGIN');
  setCors(res, allowed); // set first, so even error responses are CORS-readable
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const sub = url.pathname.slice('/github'.length) || '/';
  const owner = env('GH_OWNER');
  const repo = env('CONTENT_REPO');
  const userToken = String(req.headers['authorization'] || '').replace(/^(token|Bearer)\s+/i, '').trim();

  let outboundAuth;
  let contributor = null;
  if (sub === '/user' || sub.startsWith('/user/') || sub.startsWith('/users/')) {
    // Identity + public-profile reads run as the human: installation tokens can't
    // call /user, and Decap fetches the commit author's profile via /users/<login>
    // (e.g. the bot's, to render its avatar on the editorial-workflow card). These
    // use the contributor's own token only — never the App token — so the repo-only
    // guard on the App identity below stays intact.
    if (!userToken) { res.status(401).json({ message: 'missing_token' }); return; }
    outboundAuth = `token ${userToken}`;
  } else if (sub === `/repos/${owner}/${repo}` || sub.startsWith(`/repos/${owner}/${repo}/`)) {
    contributor = userToken ? await getValidatedUser(userToken) : null;
    if (!contributor) {
      res.status(401).json({ message: 'invalid_token' });
      return;
    }
    outboundAuth = `token ${await getInstallationToken()}`;
  } else {
    console.log(`[github] 403 forbidden_path ${req.method} ${sub}`);
    res.status(403).json({ message: 'forbidden_path' });
    return;
  }

  const headers = {
    Authorization: outboundAuth,
    Accept: req.headers['accept'] || 'application/vnd.github+json',
    'User-Agent': GH_UA,
  };
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
  if (req.headers['if-match']) headers['If-Match'] = req.headers['if-match'];
  if (req.headers['if-none-match']) headers['If-None-Match'] = req.headers['if-none-match'];

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  let outBody = hasBody ? req.rawBody : undefined;
  // Attribute the commit to the contributor (the App stays the committer). Decap
  // builds commits via the Git Data API (POST git/commits) or the contents API
  // (PUT contents/…); inject `author` on both so `git log` credits the human.
  const isCommitWrite = contributor && (
    (req.method === 'POST' && sub === `/repos/${owner}/${repo}/git/commits`) ||
    (req.method === 'PUT' && sub.startsWith(`/repos/${owner}/${repo}/contents/`))
  );
  if (isCommitWrite && req.rawBody?.length) {
    try {
      const body = JSON.parse(req.rawBody.toString('utf8'));
      body.author = commitAuthor(contributor);
      outBody = Buffer.from(JSON.stringify(body));
      headers['Content-Type'] = 'application/json';
    } catch { /* not JSON — forward unchanged */ }
  }
  const ghRes = await fetch(`${GH_API}${sub}${url.search || ''}`, {
    method: req.method,
    headers,
    body: outBody,
  });

  const ct = ghRes.headers.get('content-type') || '';
  // Decap's hasWriteAccess() reads `permissions.push` from GET /repos/:owner/:repo
  // and refuses login if it's false. An installation token isn't a user, so GitHub
  // reports all-false permissions there — but writes genuinely go through the App
  // via this proxy, so report write access on this one endpoint. (Only the exact
  // repo path, GET, JSON 200 — subpaths and everything else pass through verbatim.)
  const isRepoMeta = req.method === 'GET' && sub === `/repos/${owner}/${repo}`;
  let buf;
  let rewrote = false;
  if (isRepoMeta && ghRes.ok && ct.includes('json')) {
    const data = await ghRes.json();
    data.permissions = { admin: false, maintain: false, push: true, triage: true, pull: true };
    buf = Buffer.from(JSON.stringify(data));
    rewrote = true;
  } else {
    buf = Buffer.from(await ghRes.arrayBuffer());
  }
  if (ct) res.set('Content-Type', ct);
  if (!rewrote) {
    // Skip the upstream ETag when we changed the body — it no longer matches.
    const etag = ghRes.headers.get('etag');
    if (etag) res.set('ETag', etag);
  }
  // Keep paginated follow-up requests on the proxy, not direct to api.github.com.
  const link = ghRes.headers.get('link');
  if (link) {
    const proxyRoot = `${env('BASE_URL').replace(/\/+$/, '')}/github`;
    res.set('Link', link.split(GH_API).join(proxyRoot));
  }
  for (const h of ['x-oauth-scopes', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-github-request-id']) {
    const v = ghRes.headers.get(h);
    if (v) res.set(h, v);
  }
  console.log(`[github] ${req.method} ${sub} -> ${ghRes.status}${rewrote ? ' (perms+)' : ''}`);
  res.status(ghRes.status).send(buf);
}

functions.http('decapOauth', async (req, res) => {
  try {
    const url = new URL(req.url, env('BASE_URL'));
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/github' || path.startsWith('/github/')) {
      await handleGithubProxy(req, res, url);
      return;
    }

    if (path === '/auth' || path === '/') {
      const state = signState(
        { nonce: crypto.randomBytes(16).toString('hex'), ts: Date.now() },
        env('STATE_SIGNING_KEY')
      );
      const params = new URLSearchParams({
        client_id: env('GITHUB_OAUTH_CLIENT_ID'),
        redirect_uri: `${env('BASE_URL').replace(/\/+$/, '')}/callback`,
        scope: env('OAUTH_SCOPE'),
        state,
        allow_signup: 'false',
      });
      res.redirect(302, `https://github.com/login/oauth/authorize?${params.toString()}`);
      return;
    }

    if (path === '/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const allowed = env('ALLOWED_ORIGIN');
      if (!code || !verifyState(state, env('STATE_SIGNING_KEY'))) {
        res.status(400).type('html').send(
          htmlMessage('error', { message: 'invalid_or_expired_state' }, allowed)
        );
        return;
      }
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: env('GITHUB_OAUTH_CLIENT_ID'),
          client_secret: env('GITHUB_OAUTH_CLIENT_SECRET'),
          code,
          redirect_uri: `${env('BASE_URL').replace(/\/+$/, '')}/callback`,
        }),
      });
      const data = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok || !data.access_token) {
        res.status(400).type('html').send(
          htmlMessage('error', { message: data.error || 'token_exchange_failed' }, allowed)
        );
        return;
      }
      res.status(200).type('html').send(
        htmlMessage('success', { token: data.access_token, provider: 'github' }, allowed)
      );
      return;
    }

    if (path === '/health') {
      res.status(200).json({ ok: true });
      return;
    }

    res.status(404).type('text/plain').send('not found');
  } catch (err) {
    console.error('phaedrus oauth error', err);
    res.status(500).type('text/plain').send('internal error');
  }
});
