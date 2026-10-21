#!/usr/bin/env bash
# Run the full Playwright suite (chromium, firefox, webkit) in the official image.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="$(node -p "require('@playwright/test/package.json').version")"
exec podman run --rm --ipc=host \
	-v "$PWD":/work:Z -v /work/node_modules -w /work \
	"mcr.microsoft.com/playwright:v${VERSION}-noble" \
	bash -c 'npm ci --no-audit --no-fund && npm run paraglide && npx playwright test "$@"' _ "$@"
