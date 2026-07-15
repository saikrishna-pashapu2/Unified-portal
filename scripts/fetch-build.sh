#!/usr/bin/env bash
#
# Downloads the prebuilt apps/web/.next for THIS checkout's commit, so the
# server never runs `next build` (which OOMs on a 4 GB box while PM2 is still
# running the previous version).
#
# Usage (on EC2, from the repo root):
#   ./scripts/fetch-build.sh
#
# The artifact is published by .github/workflows/build-artifact.yml as a public
# GitHub Release asset tagged build-<short-sha>, so no auth is needed.
#
# The repo is derived from the git remote so a rename or fork keeps working.
# Override with REPO=owner/name if needed.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v git >/dev/null 2>&1; then
  echo "error: git is required" >&2
  exit 1
fi

detect_repo() {
  local url
  url="$(git config --get remote.origin.url 2>/dev/null || true)"
  # Strip suffixes first: bash uses POSIX ERE, which has no lazy quantifier.
  url="${url%/}"
  url="${url%.git}"
  # https://github.com/OWNER/REPO or git@github.com:OWNER/REPO
  if [[ "$url" =~ github\.com[:/]([^/]+)/([^/]+)$ ]]; then
    echo "${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  else
    echo "saikrishna-pashapu2/Unified-portal"
  fi
}

REPO="${REPO:-$(detect_repo)}"

SHA="$(git rev-parse HEAD)"
SHORT="${SHA:0:12}"
TAG="build-${SHORT}"
BASE="https://github.com/${REPO}/releases/download/${TAG}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Commit:   $SHA"
echo "==> Artifact: $TAG"

if ! curl -fsSL --retry 3 --retry-delay 3 -o "$TMP/web-next.tar.gz" "$BASE/web-next.tar.gz"; then
  cat >&2 <<EOF

error: no build artifact found for commit $SHORT.

The artifact is built by GitHub Actions on push to main. Check:
  https://github.com/${REPO}/actions/workflows/build-artifact.yml
  https://github.com/${REPO}/releases/tag/${TAG}

If the workflow has not finished yet, wait and re-run this script.
Do NOT run 'pnpm build' here: it will OOM while PM2 is running.
EOF
  exit 1
fi

# Integrity: the checksum is published next to the tarball.
if curl -fsSL --retry 3 -o "$TMP/web-next.tar.gz.sha256" "$BASE/web-next.tar.gz.sha256"; then
  echo "==> Verifying checksum"
  ( cd "$TMP" && awk '{print $1"  web-next.tar.gz"}' web-next.tar.gz.sha256 | sha256sum -c - )
else
  echo "warning: checksum not published for $TAG; skipping verification" >&2
fi

if curl -fsSL --retry 3 -o "$TMP/build-info.json" "$BASE/build-info.json"; then
  echo "==> Build info:"
  cat "$TMP/build-info.json"
fi

echo "==> Extracting to apps/web/.next"
rm -rf apps/web/.next.incoming apps/web/.next.previous
mkdir -p apps/web/.next.incoming
tar -xzf "$TMP/web-next.tar.gz" -C apps/web/.next.incoming

# tar was created with `-C apps/web ./.next`, so the payload is .next/...
if [ ! -d apps/web/.next.incoming/.next ]; then
  echo "error: artifact did not contain a .next directory" >&2
  exit 1
fi

# Swap in as close to atomically as a directory rename allows.
if [ -d apps/web/.next ]; then
  mv apps/web/.next apps/web/.next.previous
fi
mv apps/web/.next.incoming/.next apps/web/.next
rm -rf apps/web/.next.incoming apps/web/.next.previous

if [ ! -f apps/web/.next/BUILD_ID ]; then
  echo "error: apps/web/.next/BUILD_ID missing - artifact looks incomplete" >&2
  exit 1
fi

echo "==> Done. apps/web/.next is ready (BUILD_ID: $(cat apps/web/.next/BUILD_ID))"
echo "    Skip 'pnpm build'. Continue with prod:check / db:migrate:deploy / pm2."
