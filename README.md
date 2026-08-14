# tally

家計簿・資産管理・日記をまとめた個人向けWebアプリです。

## 起動方法

Docker Desktopを起動して、プロジェクト直下で次を実行してください。

```bash
docker compose up --build
```

- アプリ: http://localhost:3000
- APIドキュメント: http://localhost:8000/docs

初回は画面の「新規アカウント作成」から登録してください。最初に登録したユーザーが管理者になり、以降は一般ユーザーとして作成されます。停止は `docker compose down`、DBも初期化する場合はバックアップ取得後に `docker compose down -v` を実行してください。

MCPサーバーは、設定画面でユーザー専用MCPトークンを作成し、`cd backend && MCP_ACCESS_TOKEN=<token> uv run python -m app.mcp.server` でstdio起動できます。HTTP接続では `Authorization: Bearer <token>` を設定してください。バックエンドテストは `cd backend && uv run pytest` です。

パスワード再設定メールを本番利用する場合は、`.env.example` のSMTP項目を設定してください。開発環境では送信トークンを画面に引き継いで、そのまま再設定を検証できます。

## 主な設計

- 口座残高は初期残高と取引から計算し、派生値の不整合を防ぎます。
- 振替は同じ `transfer_group_id` の出金・入金2明細で表現し、総資産に影響させません。
- 資産推移はMVPでは取引から再計算します。データ量増加時にスナップショットを追加できます。
- 定期取引はルールIDと期間キーの一意制約で二重生成を防止します。
- REST APIとMCPは同じService Layerを利用します。
- ログインセッションはHttpOnly Cookieで端末に30日間保持され、API・MCPともサーバー側でユーザー所有権を検証します。
- バックアップはスキーマバージョン付きJSONです。復元は全件検証後、DBトランザクション内で置換します。
