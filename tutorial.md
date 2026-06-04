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
1. **OAuth App** (Decap login): callback = the `PROXY_URL/callback` printed after deploy. Copy Client ID + secret.
2. **GitHub App** (MCP commits): Contents RW + Pull requests RW, installed on your content repo's owner. Note App ID; download the private-key PEM.

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
