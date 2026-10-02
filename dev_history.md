# 変更履歴

本リポジトリは [yonaka15/mcp-server-redmine](https://github.com/yonaka15/mcp-server-redmine) からフォークしたものです。
フォーク元の最終コミット `0fae130`（Merge pull request #63, 2025-07-20）以降に、本リポジトリで行った変更を記載します。

---

## 2026-10-02 チケット添付画像の取得に対応

### 背景

チケットにはスクリーンショットが添付されていることが多いが、従来は添付ファイルを取得する手段がなく、LLM が画像の内容を把握できなかった。
また、`get_issue` で `include=attachments` を指定しても、レスポンスのスキーマ検証で添付ファイル情報が除去されており、添付ファイルの有無すら分からない状態だった。

### 変更内容

- **新規ツール `get_attachment` を追加**
  - 添付ファイル ID を指定して画像を取得し、MCP の画像コンテンツ（`type: "image"`）としてメタ情報とともに返す
  - 対応形式は PNG / JPEG / GIF / WebP。それ以外のファイルはエラーとして返す
  - サイズ上限は 3.5MB（base64 化しても Claude の 1 枚あたり上限 5MB に収まるサイズ）
  - 形式判定は 2 段階
    1. ダウンロード前：Redmine の `content_type` または拡張子で判定し、対象外ならダウンロードしない
    2. ダウンロード後：ファイル先頭のマジックバイトで実際の形式を判定（拡張子偽装や HTML のエラーページ等を除外）
  - サイズもダウンロード前（メタ情報の `filesize`）と後（実データ長）の両方で確認
- **`get_issue` の出力に添付ファイル一覧を追加**
  - `include=attachments` 指定時に、ID・ファイル名・サイズ・形式・登録者・登録日時を `<attachments>` として出力
  - Issue のスキーマに `attachments` を追加し、検証時に除去されないよう修正
- **API クライアントにバイナリ取得処理を追加**
  - `BaseClient.performBinaryRequest` を追加し、エラーレスポンス処理を `createApiError` として共通化
  - ダウンロード URL は Redmine が返す `content_url` を使わず、必ず `REDMINE_HOST` を基準に `/attachments/download/:id` を組み立てる（API キーを別ホストへ送信しないため）
- README（英語版・日本語版）に添付ファイル関連ツールの説明を追記

### 主な変更ファイル

| 種別 | ファイル |
|---|---|
| 追加 | `src/tools/attachments.ts`（ツール定義） |
| 追加 | `src/handlers/attachments.ts`（ハンドラ・形式判定・サイズ制限） |
| 追加 | `src/lib/client/attachments.ts`（メタ情報取得・ダウンロード） |
| 追加 | `src/lib/types/attachments/`（型・zod スキーマ） |
| 追加 | `src/formatters/attachments.ts`（メタ情報の整形） |
| 変更 | `src/lib/client/base.ts`（バイナリ取得・エラー処理共通化） |
| 変更 | `src/formatters/issues.ts`、`src/lib/types/issues/`（添付ファイル一覧） |
| 変更 | `src/handlers/index.ts`、`src/handlers/types.ts`、`src/tools/index.ts`、`src/tools/issues.ts`（登録・型・説明文） |

### テスト

- ユニットテストを追加（`src/lib/__tests__/client/attachments/`、`src/handlers/__tests__/attachments/`）
  - 84 件 → 103 件、全件成功
- 実機の Redmine で動作確認
  - 画像添付チケット #15253：添付一覧の取得、PNG 画像の取得と内容の読み取りに成功
  - 画像以外添付チケット #15254：xlsx はダウンロードされずにエラー、同チケットの PNG は正常に取得

---

## 2026-07-30 チケット更新時のエラーを修正（`ac99d56`）

### 背景

`update_issue` を実行すると、Redmine 上では更新が成功しているにもかかわらず、毎回 zod の検証エラー（`expected object, received undefined`）が返っていた。

### 原因

Redmine はチケット更新（PUT）成功時に `204 No Content`（ボディなし）を返すが、`updateIssue` が空のレスポンスを `RedmineIssueSchema.parse(response.issue)` で検証していた。

### 変更内容

- `IssuesClient.updateIssue` のレスポンス解析を削除し、戻り値を `Promise<void>` に変更（`deleteIssue` と同じ方式）
- 変更ファイル：`src/lib/client/issues.ts`
