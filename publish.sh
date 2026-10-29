#!/usr/bin/env bash
# One-command publish (macOS/Linux/Git Bash). Requires git + GitHub CLI, logged in once: gh auth login
set -e
REPO="${1:-chaintrace-supply-chain}"
USER_NAME="$(gh api user --jq .login)"
gh repo create "$USER_NAME/$REPO" --public --source . --remote origin --push
gh api -X POST "repos/$USER_NAME/$REPO/pages" -f build_type=workflow >/dev/null 2>&1 || true
gh workflow run pages.yml -R "$USER_NAME/$REPO" >/dev/null 2>&1 || true
echo; echo "Live in about a minute at: https://$USER_NAME.github.io/$REPO/"
