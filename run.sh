#!/usr/bin/env bash
# サーバーのcronから呼ぶ実行ラッパー。
# - スクリプトのあるディレクトリへ移動
# - .env があれば環境変数として読み込む（SLACK_WEBHOOK_URL 等）
# - flock で多重起動を防止（前回の実行がまだ動いていればスキップ）
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

# 前回実行が継続中なら今回はスキップ（state.json の競合防止）
exec 9>/tmp/nc-seat-watcher.lock
if ! flock -n 9; then
  echo "$(date '+%F %T') 前回の実行が継続中のためスキップ"
  exit 0
fi

node watch.mjs
