# tally

家計簿・資産管理・日記をまとめた個人向けWebアプリです。

## 起動方法

Docker Desktopを起動して、プロジェクト直下で次を実行してください。

```bash
docker compose up --build
```

- アプリ: http://localhost:3000
- APIドキュメント: http://localhost:8000/docs

開発用データは初回起動時に自動登録されます。停止は `docker compose down`、DBも初期化する場合はバックアップ取得後に `docker compose down -v` を実行してください。

MCPサーバーは `cd backend && uv run python -m app.mcp.server` でstdio起動できます。バックエンドテストは `cd backend && uv run pytest` です。

## 主な設計

- 口座残高は初期残高と取引から計算し、派生値の不整合を防ぎます。
- 振替は同じ `transfer_group_id` の出金・入金2明細で表現し、総資産に影響させません。
- 資産推移はMVPでは取引から再計算します。データ量増加時にスナップショットを追加できます。
- 定期取引はルールIDと期間キーの一意制約で二重生成を防止します。
- REST APIとMCPは同じService Layerを利用します。
- バックアップはスキーマバージョン付きJSONです。復元は全件検証後、DBトランザクション内で置換します。
