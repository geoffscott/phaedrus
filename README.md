# phaedrus

Human + AI publishing for Git-backed sites. Three authoring doors (Decap web CMS,
MCP for Claude.ai/agents, fork+PR) → one PR review gate → GitHub Pages. Config-driven;
deploy once per site. Powers Kindness Flywheel and Table.

[![Open in Cloud Shell](https://gstatic.com/cloudssh/images/open-btn.svg)](https://ssh.cloud.google.com/cloudshell/open?cloudshell_git_repo=https://github.com/geoffscott/phaedrus&cloudshell_tutorial=tutorial.md)

## Quickstart (GCP Cloud Shell)

1. Click **Open in Cloud Shell** above (clones the repo, starts the walkthrough).
2. Select your GCP project: `gcloud config set project YOUR_PROJECT`
3. `make configure`                # interactive; Enter accepts the KF default for each setting
4. `make bootstrap SITE=<key>`     # enables APIs, creates SAs + secret shells
5. Create the GitHub OAuth App + GitHub App (the two manual gates — see tutorial), then:
   `make secrets SITE=<key>`       # pushes the credentials into Secret Manager
6. `make deploy SITE=<key>`        # deploys the OAuth proxy + MCP server
7. `make install-site-assets SITE=<key>`  # opens a PR adding Decap + llms.txt automation to your content repo

Every target is idempotent — safe to re-run.
Requirements: a Jekyll/GitHub Pages content repo, a GCP project with billing.
License: MIT. Published content keeps whatever license your content repo declares.
