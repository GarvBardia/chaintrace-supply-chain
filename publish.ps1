# One-command publish (Windows PowerShell). Requires: git + GitHub CLI (gh), logged in once with `gh auth login`.
# Usage:  .\publish.ps1            (repo name defaults to chaintrace-supply-chain)
param([string]$Repo = "chaintrace-supply-chain")
$ErrorActionPreference = "Stop"
$user = gh api user --jq .login
gh repo create "$user/$Repo" --public --source . --remote origin --push
gh api -X POST "repos/$user/$Repo/pages" -f build_type=workflow 2>$null
gh workflow run pages.yml -R "$user/$Repo" 2>$null
Write-Host "`nLive in about a minute at: https://$user.github.io/$Repo/"
