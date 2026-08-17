<a id="readme-top"></a>

<div align="center">
  <a href="https://github.com/tech-tatsuma/tally">
    <img src="public/favicon.svg" alt="tally logo" width="80" height="80" />
  </a>

  <h1 align="center">tally</h1>

  <p align="center">
    今日の残高を、楽しみに開く。<br />
    家計、資産、その日の出来事をひとつに記録するWebアプリです。
    <br />
    <br />
    <a href="#はじめに"><strong>はじめる »</strong></a>
    ·
    <a href="#主な機能">機能を見る</a>
    ·
    <a href="https://github.com/tech-tatsuma/tally/issues">Issueを報告</a>
  </p>
</div>

<div align="center">

[![React][react-shield]][react-url]
[![FastAPI][fastapi-shield]][fastapi-url]
[![PostgreSQL][postgres-shield]][postgres-url]
[![Docker][docker-shield]][docker-url]
[![MCP][mcp-shield]][mcp-url]

</div>

<details>
  <summary>目次</summary>
  <ol>
    <li><a href="#tallyについて">tallyについて</a></li>
    <li><a href="#主な機能">主な機能</a></li>
    <li><a href="#技術構成">技術構成</a></li>
    <li>
      <a href="#はじめに">はじめに</a>
      <ul>
        <li><a href="#動作要件">動作要件</a></li>
        <li><a href="#dockerで起動する">Dockerで起動する</a></li>
        <li><a href="#ローカル開発">ローカル開発</a></li>
      </ul>
    </li>
    <li><a href="#使い方">使い方</a></li>
    <li><a href="#権限とデータ保護">権限とデータ保護</a></li>
    <li><a href="#mcp連携">MCP連携</a></li>
    <li><a href="#バックアップと復元">バックアップと復元</a></li>
    <li><a href="#テスト">テスト</a></li>
    <li><a href="#プロジェクト構成">プロジェクト構成</a></li>
    <li><a href="#謝辞">謝辞</a></li>
  </ol>
</details>

## tallyについて

tallyは、日々の収入・支出・振替と口座残高を管理しながら、その日の出来事も残せる家計簿アプリです。単に数字を集計するだけでなく、「何に使ったか」「どんな一日だったか」まで同じ場所で振り返れます。

複数ユーザーに対応しており、口座・カテゴリ・取引・定期取引・分析結果はすべてユーザーごとに分離されます。

<p align="right">(<a href="#readme-top">先頭に戻る</a>)</p>

## 主な機能

### 家計と資産

- 銀行、現金、電子マネー、投資、クレジットカードなど複数口座の管理
- 収入・支出・振替の記録と、取引から算出する正確な口座残高
- 日記・メモを添えた取引記録
- 日次・月次・年次の収支分析、カテゴリ別支出の確認
- クレジットカードの支払口座・支払日設定と自動引落

### 自動化

- 毎月・毎年の定期収入／定期支出
- 定期取引の追加、編集、停止、削除
- 二重作成を防ぐ実行管理

### ユーザーとセキュリティ

- アカウント作成、ログイン、ログアウト
- 端末ごとに最大30日間保持するHttpOnlyセッション
- パスワード変更・パスワード再設定
- 管理者／一般ユーザーの役割分離
- ユーザーごとの専用Streamable HTTP MCP URL

### 管理機能

- 管理者によるユーザーの権限・有効状態の管理
- JSON形式のバックアップ作成・検証付き復元
- 家計データの一括削除（管理者のみ）

<p align="right">(<a href="#readme-top">先頭に戻る</a>)</p>

## 技術構成

| 領域 | 技術 |
| --- | --- |
| フロントエンド | React / Vinext / TypeScript |
| バックエンド | FastAPI / SQLAlchemy / Alembic |
| データベース | PostgreSQL |
| 認証 | セッションCookie、scryptパスワードハッシュ、再設定トークン |
| 自動処理 | Pythonスケジューラ |
| AI連携 | FastMCP / Streamable HTTP |
| 開発・起動 | Docker Compose |

<p align="right">(<a href="#readme-top">先頭に戻る</a>)</p>

## はじめに

### 動作要件

- Docker Desktop
- ローカル開発時のみ：Node.js 22以上、Python 3.12以上、[uv](https://docs.astral.sh/uv/)

### Dockerで起動する

管理者にするメールアドレスを指定して起動します。このメールアドレスで最初に登録したユーザーだけが管理者になります。

```bash
git clone https://github.com/tech-tatsuma/tally.git
cd tally

ADMIN_EMAIL=you@example.com docker compose up --build
```

起動後にブラウザで以下を開きます。

| 種別 | URL |
| --- | --- |
| アプリ | http://localhost:3000 |
| APIドキュメント | http://localhost:8000/docs |

停止する場合は次を実行します。

```bash
docker compose down
```

> [!WARNING]
> `docker compose down -v` はPostgreSQLの保存データを削除します。実行前に必ずバックアップを取得してください。

### ローカル開発

フロントエンドだけを起動する場合：

```bash
npm install
npm run dev
```

バックエンドを起動する場合は、PostgreSQLの接続情報を設定してから実行します。

```bash
cd backend
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

設定値の例は[.env.example](.env.example)を参照してください。

<p align="right">(<a href="#readme-top">先頭に戻る</a>)</p>

## 使い方

1. 初回はログイン画面から「新規アカウント作成」を選びます。
2. 管理者メールアドレスで登録した場合は、設定画面からユーザー管理・バックアップ機能を利用できます。
3. 「口座」から銀行口座、現金、投資、クレジットカードなどを追加します。
4. 「取引」で収入・支出・振替を記録し、必要に応じて日記を添えます。
5. 「定期」で家賃や給与などを登録すると、設定日に取引が自動作成されます。
6. 「分析」で実際に登録した取引に基づく収支とカテゴリ別支出を確認します。

<p align="right">(<a href="#readme-top">先頭に戻る</a>)</p>

## 権限とデータ保護

| 操作 | 一般ユーザー | 管理者 |
| --- | :---: | :---: |
| 自分の口座・取引・定期取引の管理 | ✓ | ✓ |
| 自分のプロフィール・パスワードの編集 | ✓ | ✓ |
| 自分用MCP接続URLの発行・無効化 | ✓ | ✓ |
| ユーザー管理 | — | ✓ |
| バックアップ／復元 | — | ✓ |
| 家計データの一括削除 | — | ✓ |

すべての家計データはAPI側でユーザーIDを条件にして取得・更新されます。MCPはユーザー専用の能力URLからユーザーを確定するため、他ユーザーの情報が混在することはありません。

セッションはHttpOnly Cookieで保持されます。パスワードはscryptでハッシュ化し、再設定リンクは一度だけ利用できます。

### パスワード再設定メール

本番で再設定メールを送るには、実行環境に以下のSMTP設定を与えてください。

```text
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USERNAME=...
SMTP_PASSWORD=...
SMTP_FROM=tally@example.com
```

開発環境では、再設定用トークンを画面へ引き継いでフローを確認できます。

<p align="right">(<a href="#readme-top">先頭に戻る</a>)</p>

## MCP連携

1. アプリの「設定」→「MCP連携」から「接続URLを発行」を選びます。
2. 表示されたURLをそのまま、Streamable HTTP対応のMCPクライアントへ貼り付けます。アクセストークンやAuthorizationヘッダーの設定は不要です。
3. URLは発行直後に一度だけ表示されます。再発行すると古いURLはただちに無効になり、設定画面から手動で無効化することもできます。

URLは接続権限そのものを含むため、パスワードと同様に扱い、共有・公開しないでください。サーバーはURLごとにユーザーを確定し、すべてのMCPツールをそのユーザーのデータだけに限定します。

公開環境では、バックエンドの外部URLを `MCP_PUBLIC_BASE_URL` に指定してください（例: `https://api.example.com`）。未設定時は、URLを発行したAPIリクエストのホスト名を使用します。

<p align="right">(<a href="#readme-top">先頭に戻る</a>)</p>

## バックアップと復元

管理者は「設定」→「管理者データツール」から、口座・カテゴリ・取引・定期取引をバージョン付きJSONファイルとして書き出せます。

- 復元前にJSONの形式とスキーマバージョンを検証します。
- 復元は対象ユーザーの家計データを置き換えます。
- 復元や一括削除の前に、最新バックアップを保存してください。

<p align="right">(<a href="#readme-top">先頭に戻る</a>)</p>

## テスト

```bash
# フロントエンド
npm test
npm run lint

# バックエンド
cd backend
uv run pytest
```

<p align="right">(<a href="#readme-top">先頭に戻る</a>)</p>

## プロジェクト構成

```text
.
├── app/                 # React画面とスタイル
├── backend/
│   ├── app/             # FastAPI、サービス、MCPサーバー
│   ├── alembic/         # データベースマイグレーション
│   └── tests/           # バックエンドテスト
├── public/              # アイコンなどの静的ファイル
├── tests/               # フロントエンドのレンダリングテスト
├── docker-compose.yml   # ローカル統合環境
└── DESIGN.md            # UIデザインガイド
```

<p align="right">(<a href="#readme-top">先頭に戻る</a>)</p>

## 謝辞

- READMEの構成は[Best-README-Template](https://github.com/othneildrew/Best-README-Template)を参考にしています。
- UIデザインの方向性は[DESIGN.md](DESIGN.md)に基づいています。
- バッジは[Shields.io](https://shields.io/)を利用しています。

<p align="right">(<a href="#readme-top">先頭に戻る</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
[react-shield]: https://img.shields.io/badge/React-19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB
[react-url]: https://react.dev/
[fastapi-shield]: https://img.shields.io/badge/FastAPI-0.116-009688?style=for-the-badge&logo=fastapi&logoColor=white
[fastapi-url]: https://fastapi.tiangolo.com/
[postgres-shield]: https://img.shields.io/badge/PostgreSQL-17-4169E1?style=for-the-badge&logo=postgresql&logoColor=white
[postgres-url]: https://www.postgresql.org/
[docker-shield]: https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white
[docker-url]: https://www.docker.com/
[mcp-shield]: https://img.shields.io/badge/MCP-FastMCP-412991?style=for-the-badge
[mcp-url]: https://modelcontextprotocol.io/
