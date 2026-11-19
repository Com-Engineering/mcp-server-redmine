# 変更履歴

本リポジトリは [yonaka15/mcp-server-redmine](https://github.com/yonaka15/mcp-server-redmine) からフォークしたものです。
フォーク元の最終コミット `0fae130`（Merge pull request #63, 2025-07-20）以降に、本リポジトリで行った変更を記載します。

---

## 2026-11-19 チケット削除・ウォッチャー操作が動かない問題を修正

### 背景

`delete_issue` / `add_issue_watcher` / `remove_issue_watcher` はツール一覧に出ているが、
`src/handlers/issues.ts` の末尾が `// ... rest of the handlers unchanged ...` のままでハンドラが実装されておらず、
呼ぶと必ず `Unknown tool` になっていた（フォーク元からの不具合）。API クライアント側のメソッドは実装済みだった。

### 変更内容

- **3 つのハンドラを実装**（`deleteIssue` / `addWatcher` / `removeWatcher` を呼ぶ）
- **`add_issue_watcher` は追加後に結果を確認する**
  - Redmine は存在しない・ロック中・チケットを見る権限がないユーザーを指定しても、何もせず 204 を返す
  - 追加後に `include=watchers` でチケットを取り直し、ウォッチャーに入っていなければエラーを返す
- **`get_issue` の `include=watchers` でウォッチャー一覧を出力**
  - Redmine は `watchers: [{id, name}]` を返すが、スキーマに無く検証で除去されていた。スキーマ・型・整形処理に追加
- **ツールとハンドラの対応を検査するテストを追加**（`src/handlers/__tests__/registry.test.ts`）
  - ツール一覧にあるのにハンドラが無い（またはその逆）ものがあれば失敗する。修正前はこの 3 つを検出することを確認

### 主な変更ファイル

| 種別 | ファイル |
|---|---|
| 変更 | `src/handlers/issues.ts`（3 ハンドラ） |
| 変更 | `src/lib/types/issues/schema.ts`、`src/lib/types/issues/types.ts`、`src/formatters/issues.ts`（ウォッチャー一覧） |

### テスト

- ユニットテストを追加（`src/handlers/__tests__/issues/delete_watchers.test.ts`、`src/handlers/__tests__/registry.test.ts`）
  - 127 件 → 141 件、全件成功
- 実機の Redmine（6.1.0）で動作確認（テストチケット #15466〜#15468。いずれも `delete_issue` で削除済み）
  - ウォッチャーの追加 → `get_issue` で一覧に出る → 削除 → 一覧から消える
  - 存在しないユーザーの追加はエラー（修正前は成功と表示されていた）
  - `delete_issue` で削除後、`get_issue` は 404。再度の削除も 404

---

## 2026-11-19 チケットへの添付ファイル追加に対応

### 背景

Playwright で画面確認したときのスクリーンショットを、テストのエビデンスとしてチケットに添付したい。
従来は添付ファイルの取得（`get_attachment`）しかできず、追加する手段がなかった。

### 変更内容

- **新規ツール `add_attachment` を追加**
  - 引数はチケット ID・ファイルの絶対パスの配列（`file_paths`）・説明（`description`、全ファイル共通）・コメント（`notes`）・`private_notes`
  - MCP サーバーはローカルで動くため、ファイルはパスで受け取って読む（base64 で渡す方式は、大きなファイルで会話が膨らむため採らない）
  - 処理の流れ
    1. 全ファイルを先に確認（絶対パスか、存在するか、通常のファイルか、空でないか）。1 つでも不正なら API を呼ばずにエラー
    2. 1 ファイルずつ `POST /uploads.json?filename=...`（`application/octet-stream`）でアップロードし、トークンを受け取る
    3. `PUT /issues/:id.json` に `uploads`（トークン・ファイル名・content_type・説明）とコメントをまとめて送る。履歴は 1 件になる
  - アップロードの途中で失敗した場合はチケットを更新しない（使われなかったトークンは Redmine 側で破棄される）
  - content_type は拡張子から判定（画像・PDF・テキスト・Office 等。不明なものは `application/octet-stream`）
  - サイズ上限は Redmine の設定に従う（超過時は Redmine の 422 エラーをそのまま返す）
- `AttachmentsClient.uploadFile`、`RedmineUploadResult` / `RedmineIssueUpload` 型を追加し、`RedmineIssueUpdate` に `uploads` を追加

### 主な変更ファイル

| 種別 | ファイル |
|---|---|
| 変更 | `src/tools/attachments.ts`、`src/tools/index.ts`、`src/handlers/index.ts`（ツール定義・登録） |
| 変更 | `src/handlers/attachments.ts`（`add_attachment` ハンドラ・ファイル確認・content_type 判定） |
| 変更 | `src/lib/client/attachments.ts`（`uploadFile`） |
| 変更 | `src/lib/types/attachments/`、`src/lib/types/issues/types.ts`（型・zod スキーマ・`uploads`） |

### テスト

- ユニットテストを追加（`src/handlers/__tests__/attachments/add.test.ts`）
  - 113 件 → 127 件、全件成功
- 実機の Redmine（6.1.0）で動作確認（テストチケット #15465）
  - Playwright MCP で撮ったスクリーンショット（日本語ファイル名）とテキストファイルを、コメント付きで 1 回で添付。履歴 1 件に 2 ファイルが記録されることを確認
  - 添付した画像を `get_attachment` で取得できることを確認
  - 存在しないファイルを含む場合・相対パスの場合は何も添付されずにエラー

---

## 2026-11-19 チケットコメントの編集に対応、ユーザー取得のエラーを修正

### 背景

- 既存のコメント（journal の notes）を直す手段がなく、誤記があっても追記で訂正するしかなかった。
  Redmine 5.0 で追加された `PUT /journals/:id.json` を使えば編集できる。
- `list_users` / `show_user` が、パスワードを一度も変更していないユーザー（`passwd_changed_on` が null）を含むと、
  毎回 zod の検証エラー（`expected string, received null`）になり使えなかった。

### 変更内容

- **新規ツール `update_journal` を追加**
  - journal ID と新しい本文（`notes`）を指定してコメントを書き換える。`private_notes` でプライベート設定も変更できる
  - 本文は全体の置き換え。journal ID は `get_issue` に `include=journals` を指定して取得する（既存の出力に含まれる）
  - 空（空白のみを含む）の本文はエラーにして API を呼ばない。Redmine は本文を空にすると、変更履歴を持たないコメントを削除するため
  - 編集できるのは API キーのユーザーに権限があるコメントのみ（通常は本人または管理者）。権限がない・存在しない場合は Redmine のエラー（403 / 404）をそのまま返す
- **ユーザーのスキーマで `passwd_changed_on` の null を許容**
  - `src/lib/types/users/schema.ts` を `z.string().nullable().optional()` に変更。null のときは出力から省く（既存の処理のまま）

### 主な変更ファイル

| 種別 | ファイル |
|---|---|
| 変更 | `src/tools/issues.ts`、`src/tools/index.ts`、`src/handlers/index.ts`（ツール定義・登録、`get_issue` の説明文） |
| 変更 | `src/handlers/issues.ts`（`update_journal` ハンドラ） |
| 変更 | `src/lib/client/issues.ts`、`src/lib/types/issues/types.ts`（`updateJournal`・`RedmineJournalUpdate`） |
| 変更 | `src/lib/types/users/schema.ts`、`src/lib/types/users/types.ts`（`passwd_changed_on` の null 許容） |

### テスト

- ユニットテストを追加（`src/lib/__tests__/client/journals/`、`src/handlers/__tests__/journals/`、`src/lib/__tests__/client/users/get.test.ts` に null のケース）
  - 103 件 → 113 件、全件成功。null のケースは修正前に失敗することを確認
- 実機の Redmine（6.1.0）で動作確認（テストチケット #15465）
  - コメントを追加 → `update_journal` で書き換え → `get_issue` で新しい本文になっていることを確認
  - 空の本文は API を呼ばずにエラー、存在しない journal ID は 404
  - `list_users` / `show_user` がエラーなく一覧・詳細を返すことを確認

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
