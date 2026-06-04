# phaedrus

A publishing toolkit that lets humans, AI agents, and developers contribute to the same Jekyll site through the same PR review gate.

Editors use Decap CMS in the browser. AI assistants (anything that speaks MCP — Claude.ai, Claude Code, etc.) commit through a typed authoring toolset. Developers fork and open a PR. Every door routes through GitHub's review before anything ships to GitHub Pages. Deploy once per site into your own GCP project; config-driven, MIT, no lock-in.

Powers [Kindness Flywheel](https://kindnessflywheel.org) and [Table](https://tabledialogue.com).

## Why phaedrus

- **One review gate, three doors.** Web CMS, MCP, and fork+PR all converge on the same PR review — every change is reviewed before publish. Decap uses editorial workflow (PR per post), the MCP opens a PR per session, fork+PR is PRs by definition.
- **Your content stays a plain Jekyll repo on GitHub Pages.** Nothing is locked into phaedrus's infra — pull the proxy and MCP server down and the site keeps publishing.
- **Config-driven and multi-site.** The same code deploys for every site; per-site `sites/<key>.env` controls the rest.

## Who it's for

Solo authors, small editorial teams, and orgs running a Jekyll/GitHub Pages site who want a friendly web CMS *and* want AI agents to be first-class contributors — without giving up review discipline.

**Not** for dynamic apps, non-Git backends, or operators unwilling to bring their own GCP project.

## What gets deployed

Per site, into **your** GCP project:

- An **OAuth proxy** (Cloud Functions gen2) so Decap can log into GitHub from the browser without exposing the client secret.
- An **MCP server** that gives AI agents a typed authoring surface over your content repo (create posts, manage authors, open PRs).

Content stays in your existing Jekyll repo on GitHub. See [`docs/spec-a-oauth-proxy.md`](docs/spec-a-oauth-proxy.md) and [`docs/spec-b-authoring-automation.md`](docs/spec-b-authoring-automation.md) for the architecture.

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

## Requirements, cost & license

- **Requirements:** a Jekyll/GitHub Pages content repo, and a GCP project with billing enabled.
- **Cost:** both services scale to zero when idle. The proxy (Cloud Functions gen2) only fires on editor logins; the MCP server (Cloud Run) only fires while an agent is authoring. For a typical small site, traffic stays well inside GCP's always-free tiers for Cloud Run, Cloud Functions, and Secret Manager — expect near-zero ongoing cost. (Initial source-deploys use Cloud Build minutes, which are also free-tier for low volumes.)
- **License:** MIT. Published content keeps whatever license your content repo declares.
