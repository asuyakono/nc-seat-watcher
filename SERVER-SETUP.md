# サーバーでの高頻度実行セットアップ

GitHub Actions はスケジュールが間引かれて実質1時間間隔になるため、**自分のサーバーの cron** で数分間隔で回す構成に切り替えます。state.json はディスクにそのまま残るので、GitHub 版のような commit/push は不要です。

前提: Linux サーバー（Ubuntu/Debian 想定）に SSH でログインでき、`sudo` が使えること。

## 1. Node.js を用意（v20以上）

```bash
node -v   # v20 以上ならスキップ可
# 無い/古い場合（Ubuntu/Debian）:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

## 2. リポジトリを取得

```bash
cd ~
git clone https://github.com/asuyakono/nc-seat-watcher.git
cd nc-seat-watcher
```

## 3. 依存とブラウザをインストール

```bash
npm install
# Playwright 用のシステムライブラリ + Chromium
npx playwright install --with-deps chromium
```
（`--with-deps` が権限で失敗する場合は `sudo npx playwright install-deps chromium` の後に `npx playwright install chromium`）

## 4. Slack Webhook を設定

```bash
cp .env.example .env
nano .env    # SLACK_WEBHOOK_URL を実際の値に
```

## 5. 手動で動作確認

```bash
bash run.sh
```
`新島 (NJM) → 調布 (CHU) ...: NC202満席 ...` のように出れば成功。空席が出ていれば Slack に通知が飛びます。

## 6. cron に登録（5分間隔）

```bash
crontab -e
```
末尾に次を追加（パスは実際の場所に合わせる）:

```
*/5 * * * * /home/YOUR_USER/nc-seat-watcher/run.sh >> /home/YOUR_USER/nc-seat-watcher/watch.log 2>&1
```

- `run.sh` は多重起動を防ぐロック付きなので、実行が5分を超えても安全。
- ログは `watch.log` に追記される。`tail -f watch.log` で監視可能。
- 間隔を変えたいときは `*/5` を `*/3`（3分）等に変更。

## 7. GitHub Actions 版を停止（重複通知を防ぐ）

サーバーとGitHubの両方が動くと二重通知になります。GitHub側を止めます:
GitHub → リポジトリ → **Actions** タブ → 左の「NC seat watch」→ 右上「•••」→ **Disable workflow**

---

## メモ
- 監視対象の変更は `config.json` を編集して保存するだけ（サーバー上で直接編集 or `git pull`）。
- `state.json` は前回状態の記録。消すと次回は全便を「初回」とみなして現在空席の便を通知する。
- Slack Webhook URL は `.env` に置き、リポジトリにはコミットされない（.gitignore 済み）。
