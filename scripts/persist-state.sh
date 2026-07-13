#!/usr/bin/env bash
# state.json に変化があればコミット＆pushして次回実行に引き継ぐ。
# このワークフローは schedule / workflow_dispatch でのみ起動するため、
# push によるトリガーループは発生しない（[skip ci] 不要）。
set -euo pipefail

if git diff --quiet -- state.json; then
  echo "state.json 変化なし"
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add state.json
git commit -m "chore: update seat state"
git push
echo "state.json を更新しました"
