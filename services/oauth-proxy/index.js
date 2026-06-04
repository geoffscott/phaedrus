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

functions.http('decapOauth', async (req, res) => {
  try {
    const url = new URL(req.url, env('BASE_URL'));
    const path = url.pathname.replace(/\/+$/, '') || '/';

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
