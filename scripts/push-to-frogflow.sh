#!/usr/bin/env bash
# Перенос репозитория в https://github.com/FrogFlow/frogflow
# Запуск на машине с доступом к FrogFlow (PAT или gh auth login).
set -euo pipefail

NEW_REPO="${NEW_REPO:-https://github.com/FrogFlow/frogflow.git}"
SOURCE="${SOURCE:-origin}"

echo "→ Fetch from ${SOURCE}..."
git fetch "${SOURCE}"

echo "→ Push master to FrogFlow..."
git push "${NEW_REPO}" master:master

echo "→ Push feature branches (если есть)..."
for branch in cursor/telegram-mini-app-c478 cursor/web-storefront-cart-handoff-c478; do
  if git show-ref --verify --quiet "refs/heads/${branch}"; then
    git push "${NEW_REPO}" "${branch}:${branch}" || true
  fi
done

echo "✓ Готово. Проверьте: https://github.com/FrogFlow/frogflow"
