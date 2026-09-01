#!/usr/bin/env bash
# Push в основной репозиторий https://github.com/FrogFlow/frogflow
# Токен: FROGFLOW_GITHUB_TOKEN или GITHUB_TOKEN (не коммитить в репо).
set -euo pipefail

REPO="${REPO:-https://github.com/FrogFlow/frogflow.git}"
BRANCH="${BRANCH:-$(git branch --show-current)}"
TOKEN="${FROGFLOW_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"

if [[ -n "${TOKEN}" ]]; then
  REPO="https://${TOKEN}@github.com/FrogFlow/frogflow.git"
fi

echo "→ Push ${BRANCH} to FrogFlow/frogflow..."
git push "${REPO}" "${BRANCH}:${BRANCH}"

echo "✓ https://github.com/FrogFlow/frogflow"
