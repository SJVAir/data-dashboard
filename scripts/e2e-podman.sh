#!/usr/bin/env bash
# Run the full Playwright suite (chromium, firefox, webkit) in the official image.
# Capped at 4 workers (three engines at once overload a typical machine); arguments come after
# it, so a caller's own --workers wins.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="$(node -p "require('@playwright/test/package.json').version")"
# The image has no git, so the build gets its id from here (a build with an unknown id fails).
BUILD_ID="${BUILD_ID:-$(git rev-parse HEAD)}"
exec podman run --rm --ipc=host -e BUILD_ID -e VITE_SENTRY_DSN= \
	-v "$PWD":/work:Z -v /work/node_modules -w /work \
	"mcr.microsoft.com/playwright:v${VERSION}-noble" \
	bash -c 'npm ci --no-audit --no-fund && npm run paraglide && npx playwright test --workers=4 "$@"' _ "$@"
