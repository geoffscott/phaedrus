SHELL := /bin/bash
SITE ?=
export SITE

.PHONY: help configure bootstrap secrets deploy deploy-proxy deploy-mcp deploy-domain install-site-assets destroy
help:
	@echo "Targets: configure | bootstrap | secrets | deploy | deploy-proxy | deploy-mcp | deploy-domain | install-site-assets | destroy"
	@echo "Usage:   make configure   then   make <target> SITE=<key>   (config at sites/<key>.env)"

configure: ; ./scripts/configure.sh

_guard:
	@test -n "$(SITE)" || { echo "Set SITE=<key>. Run 'make configure' first if you haven't."; exit 1; }
	@test -f "sites/$(SITE).env" || { echo "Missing sites/$(SITE).env — run 'make configure'."; exit 1; }

bootstrap: _guard ; ./scripts/bootstrap.sh
secrets: _guard ; ./scripts/secrets.sh
deploy-proxy: _guard ; ./scripts/deploy-proxy.sh
deploy-mcp: _guard ; ./scripts/deploy-mcp.sh
deploy-domain: _guard ; ./scripts/deploy-domain.sh
deploy: deploy-proxy deploy-mcp deploy-domain
install-site-assets: _guard ; ./scripts/install-site-assets.sh
destroy: _guard ; ./scripts/destroy.sh
