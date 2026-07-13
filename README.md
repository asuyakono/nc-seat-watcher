# nc-seat-watcher

新中央航空（NC / 調布↔大島・新島・神津島・三宅島）の**空席をウォッチし、空席が出たらSlackに通知**するツールです。

GitHub Actions で15分ごとに予約サイトの空席照会を自動実行し、対象便が「満席 → 空席」に変わった瞬間だけSlackにポストしますPlaywrightで実際のブラウザ操作を再現しており、**予約・決済は一切行いません（検索のみ）**。

## 仕組み

```
GitHub Actions (cron 15分ごと)
  → Playwright(ヘッドレス)で空席照会フォームを入力・送信
  → 各便の在庫を判定（満席便は div.flight に sold-out クラスが付く）
  → 前回状態(state.json)と比較し、空席化した便だけSlackへPOST
  → state.json をコミットして次回に引き継ぎ
```

## セットアップ

### 1. リポジトリを用意
このフォルダをGitHubリポジトリにpushします。

```bash
git init && git add -A && git commit -m "init nc-seat-watcher"
gh repo create nc-seat-watcher --private --source=. --push
```

> **料金の注意**: GitHub Actions は**publicリポジトリなら無料・無制限**です。privateリポジトリは無料枠2000分/月で、15分間隔だと超過する可能性があります。15分間隔で回すなら **public 推奨**（このリポジトリには秘密情報を置きません。Webhook URLはSecretで管理します）。privateのままにするなら `.github/workflows/watch.yml` の cron 間隔を広げてください。

### 2. Slack Incoming Webhook を作成
1. https://api.slack.com/apps → Create New App → From scratch
2. 対象ワークスペースを選択
3. 「Incoming Webhooks」を ON → 「Add New Webhook to Workspace」で通知先チャンネルを選択
4. 発行された `https://hooks.slack.com/services/...` のURLをコピー

### 3. Webhook URL をリポジトリのSecretに登録
GitHub の リポジトリ → Settings → Secrets and variables → Actions → New repository secret

- Name: `SLACK_WEBHOOK_URL`
- Secret: 手順2のURL

### 4. 監視対象を設定
[`config.json`](config.json) を編集します。

```json
{
  "watches": [
    {
      "id": "chofu-oshima-0720",
      "tripType": "OW",
      "origin": "CHU",
      "destination": "OIM",
      "date": "2026/07/20",
      "adults": 1,
      "children": 0,
      "infants": 0,
      "flights": [],
      "notifyOnClose": true
    }
  ]
}
```

| 項目 | 説明 |
|------|------|
| `id` | 監視の一意な名前（状態管理のキー。重複不可） |
| `tripType` | `OW`（片道）。往復を見たい場合は往路・復路を別々の監視として2件登録するのが確実 |
| `origin` / `destination` | 空港コード: `CHU`調布 / `OIM`大島 / `NJM`新島 / `KAZ`神津島 / `MYE`三宅島 |
| `date` | 搭乗日 `YYYY/MM/DD`（**未来日・約3ヶ月以内**のみ。過去日は照会不可） |
| `adults`/`children`/`infants` | 人数（この人数で照会し、空席判定します） |
| `flights` | 特定便だけ通知したい場合に便名を指定（例 `["NC101","NC105"]`）。空配列 `[]` はその日の全便が対象 |
| `notifyOnClose` | `true` で「満席に戻った」ときも通知（締切のお知らせ）。不要なら `false` |

複数路線・複数日を同時に監視する場合は `watches` 配列に要素を追加します。

### 5. 動作確認
GitHub の Actions タブ → 「NC seat watch」→ **Run workflow** で手動実行できます。
初回実行時点で既に空席の便があれば通知され、以降は満席→空席の変化があったときに通知します。

## ローカルで試す

```bash
npm install
npx playwright install chromium
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/xxx"  # 省略時はコンソール出力のみ
node watch.mjs
```

## 通知の例

```
🟢 空席が出ました
調布 (CHU) → 大島 (OIM)
2026/07/20  NC 101 09:00発→09:25着
新中央航空で予約する（リンク）
```

## 注意

- 予約サイトの仕様変更でセレクタ（`div.flight` / `sold-out` 等）が変わると動かなくなる可能性があります。その場合は `watch.mjs` の判定部分の調整が必要です。
- あくまで空席の監視・通知が目的です。過度な高頻度アクセスは避けてください（既定は15分間隔）。
- 予約・座席確保・決済は行いません。空席通知を受け取ったら、ご自身でサイトから予約してください。
