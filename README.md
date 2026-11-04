# 備品管理アプリ（MVP）

社員が持ち出した備品（コピー用紙・ボールペン・乾電池など）を記録し、欠品前に補充を促す社内向けWebアプリです。

- 利用画面：PC・タブレットで備品と数量を選び、社員番号を「受取サイン」として入力して記録
- 生成AI：文章による使用登録（「単3電池4本とA4用紙1冊」→ 備品と数量を読み取る）／月次の報告用サマリー
- 通知：受取時に本人と備品担当者へメール、しきい値以下の備品は毎日9:00に補充依頼メール

---

## 1. 構成と技術選定

```
[利用端末/管理者のブラウザ]
      │  GitHub Pages（静的配信: React + Vite）
      ▼
[Supabase]
  ├ PostgreSQL ─ テーブル / RLS / RPC関数（在庫更新などの業務ロジック）
  │    └ pg_cron ─ 毎日 00:00 UTC(=9:00 JST) 補充依頼の登録 / 毎分 send-mail 起動
  ├ Auth ─ 管理者のメールアドレス＋パスワードログイン
  ├ Storage ─ 備品画像
  └ Edge Functions (Deno)
       ├ send-mail       … mail_outbox を読んで Gmail SMTP(465) で送信
       ├ parse-usage     … 文章 → 備品と数量（Claude API）
       ├ monthly-report  … 月次集計 → 報告文（Claude API）
       └ admin-users     … 管理者アカウントの追加・削除
```

| 選定 | 理由 |
|---|---|
| GitHub Pages | 静的配信のみで無料。サーバー運用が不要 |
| Supabase | DB・認証・ストレージ・定期実行・サーバー処理が一式そろい、`supabase start` でローカルに同じ環境を作れる |
| ロジックをDB関数に集約 | 在庫の減算・履歴登録・メール登録を1トランザクションで行えるため、同時利用でも在庫がマイナスにならず、失敗時の不整合も起きない |
| Outbox方式のメール | 送信を在庫更新から切り離す。送信に失敗しても在庫・履歴は二重更新されず、自動で再送する |
| Gmail SMTP（465番） | 社内SMTPにはクラウドから届かないため。Edge Functions は 25/587番が使えないので SSL の465番を使う |
| Claude API | ツール呼び出し（構造化出力）で、備品IDと数量を確実にJSONで受け取れる |

---

## 2. 画面構成

**利用画面**（`/#/`・ログインなし・端末キー必須）

1. 端末キー入力（初回とキー変更時のみ）
2. 備品選択：カード一覧から選び、数量を＋／−で指定。または文章を入力して「AIで読み取る」→ 読み取り結果の確認画面
3. 社員番号入力 →「使う」→「〇〇さんが受取として記録しますか？」
   - はい：登録して完了画面へ
   - いいえ：備品選択へ戻る
4. 完了：使用後の在庫を表示し、15秒後に最初の画面へ戻る

**管理画面**（`/#/admin`・管理者のメールアドレス＋パスワードでログイン）

| メニュー | 内容 |
|---|---|
| ダッシュボード | しきい値以下の備品、本日の受取件数、送信失敗メール、運用上の注意 |
| 補充 | 備品・補充数・実際の購入単価（税抜）を登録し、更新後の在庫数を表示（メール通知なし） |
| 利用状況 | 登録日時・備品名・使用数量・社員番号・氏名。期間で絞り込み、CSV出力 |
| 備品マスタ | 商品名・単位・画像1枚・現在庫数・通知しきい値・税抜価格・仕訳項目 |
| 社員マスタ | 社員番号・氏名・メールアドレス |
| 仕訳マスタ | 仕訳項目（事務用品費・消耗品費など）の登録・編集 |
| 月次レポート | 仕訳ごとの費用（使用ベースと購入ベースを並べて表示）、備品ごとの増減、AIが書く報告用サマリー（生成ボタン） |
| メール・通知 | 送信状況、失敗したメールの再送、補充依頼の手動実行、補充依頼の送信記録 |
| 端末キー | 端末キーの変更（ランダム生成あり）、ロック中の接続元の解除 |
| 管理者 | 管理者の追加（メールアドレス＋初期パスワード）・削除、自分のパスワード変更 |

---

## 3. データ構造（`supabase/migrations/`）

| テーブル | 内容 |
|---|---|
| `items` | 備品マスタ（名前・単位・画像パス・在庫・しきい値・税抜単価・仕訳ID・有効フラグ） |
| `account_titles` | 仕訳マスタ |
| `employees` | 社員マスタ（社員番号は一意） |
| `usage_batches` | 受取1回分。IDは端末が発行するリクエストIDで、二重送信を防ぐ。社員番号と氏名は記録時点の値を保存 |
| `usages` | 受取明細（備品名・単価・仕訳・使用後在庫は記録時点の値を保存） |
| `restocks` | 補充履歴（実際の購入単価・補充前後の在庫・登録者） |
| `reminder_log` | 補充依頼の送信記録。**主キー（備品, 日付）** で同じ日の重複送信を防ぐ |
| `mail_outbox` | 送信待ちメール（状態・試行回数・次回送信時刻・エラー内容） |
| `app_admins` | 管理者（＝通知メールの宛先） |
| `app_settings` | 端末キー（bcryptでハッシュ化）と版数 |
| `auth_failures` | 接続元IPごとの失敗回数とロック（端末キー・社員番号の総当たり対策） |
| `monthly_reports` | AIが生成した月次レポート |

**権限**

- 利用端末（anon）はテーブルを直接読めません。呼べるのは端末キー付きの `kiosk_*` 関数だけです。備品一覧に価格や仕訳は含めません。
- 管理者は、RLS（行単位のアクセス制御）の `is_admin()` 判定でマスタ・履歴を参照・編集できます。在庫・履歴の書き込みは関数経由のみです。
- メール送信用の関数は service_role（サーバー側）だけが実行できます。

---

## 4. 処理方針

### 使用（`kiosk_use_items`）

1 回の呼び出しを1トランザクションとして、次の順で処理します。

1. 端末キーを確認する
2. 同じリクエストIDの処理を直列化し、処理済みならその結果を返す（再送・二度押しで二重登録しない）
3. 数量が正の整数かを確認する（同じ備品が複数行あれば合算）
4. 社員番号が登録済みかを確認する
5. 対象の備品をID順に `FOR UPDATE` でロックし、在庫を確認する。**1品目でも不足していれば、何も登録せずに理由（希望数と在庫数）を返す**
6. 在庫を減らし、利用履歴を登録し、`mail_outbox` に本人宛と担当者全員宛のメールを登録する（すべて同じトランザクション内）

### メール送信（`send-mail`）

- pg_cron が毎分、送信待ちがあるときだけ send-mail を起動します。
- 送信処理は `FOR UPDATE SKIP LOCKED` で送信待ちを取得し、1通ごとに間隔をあけて送ります。
- 失敗した場合は、2・4・8…分後に再送します。最大5回で「失敗」にし、管理画面から再送できます。
- 送信処理は在庫や履歴に一切触れません。

### 補充依頼（`run_daily_reminders`）

- 毎日9:00（日本時間）に、`在庫 <= しきい値` の有効な備品を `reminder_log` に `ON CONFLICT DO NOTHING` で登録します。
- 新しく登録できた備品だけを、担当者ごとに1通のメールにまとめて送ります。本文には備品名・現在庫数・通知しきい値を記載します。
- 定期処理が再実行されたり手動で実行されたりしても、同じ日に同じ備品へ重複して通知しません。
- 補充後もしきい値以下なら翌日も対象になり、しきい値を上回れば対象から外れます。

### 月次集計（`admin_monthly_summary`）

- 使用ベースは「使用数 × 使用時点のマスタ単価」、購入ベースは「補充数 × 実際の購入単価」で、仕訳ごと・備品ごとに集計します（いずれも税抜）。
- あわせて、前月の使用数、補充数、直近30日の平均使用数から計算した在庫切れまでの予測日数を出します。
- `monthly-report` がこの集計値を Claude に渡し、報告用の文章を作らせます。数値は集計値だけを使うよう指示しています。

---

## 5. ローカル起動手順

**前提**

- Docker Desktop
- Node.js 22 以上
- Deno 2（Edge Functions のテストに使う場合）

```bash
# 1) 依存関係
npm install
npm --prefix web install

# 2) Supabase をローカル起動（初回はイメージ取得に数分かかります）
npx supabase start
#   表示される API URL / anon key（Publishable key）/ service_role key（Secret key）を控える
#   マイグレーションと seed（サンプルデータ）が自動で入ります

# 3) Edge Functions の環境変数
cp supabase/functions/.env.example supabase/functions/.env
#   ANTHROPIC_API_KEY を設定（AI機能を使う場合）
npx supabase functions serve --env-file supabase/functions/.env

# 4) 最初の管理者を作成（別ターミナル）
SUPABASE_SERVICE_ROLE_KEY=<service_role key> npm run create-admin -- admin@example.com 'Admin-Pass-2026'

# 5) 画面
cp web/.env.example web/.env.local      # VITE_SUPABASE_ANON_KEY に anon key を設定
npm run web:dev                          # http://localhost:5173
```

**アクセス先**

| URL | 内容 |
|---|---|
| http://localhost:5173/#/ | 利用画面（開発用の端末キー：`dev-device-key`） |
| http://localhost:5173/#/admin | 管理画面 |
| http://127.0.0.1:54323 | Supabase Studio（DBの中身を確認） |
| http://127.0.0.1:54324 | Mailpit（`MAIL_PROVIDER=smtp` のとき、送信メールを確認） |

サンプルの社員番号は `1001`（山田 太郎）、`1002`（佐藤 花子）、`1003`（鈴木 一郎・メールアドレスなし）です。

> **Windows の場合**：環境変数の付け方が異なります。PowerShell では `$env:SUPABASE_SERVICE_ROLE_KEY="..."; npm run create-admin -- admin@example.com 'Admin-Pass-2026'` のように実行してください。

### メールを実際に送らずに確認する

| `MAIL_PROVIDER` | 動作 |
|---|---|
| `log`（既定） | 送信内容を `functions serve` のログに出すだけ |
| `smtp` | ローカルの Mailpit に送る。`.env.example` のコメントどおり、`SMTP_HOST=host.docker.internal`・`SMTP_PORT=54325`・`SMTP_SECURE=false` を設定し、http://127.0.0.1:54324 で受信内容を確認 |
| `fail` | 常に送信失敗として扱う（再送と失敗表示の確認用） |

どの設定でも、管理画面の「メール・通知」で送信待ち・送信済み・失敗の状態と本文を確認できます。

pg_cron は毎分 send-mail を呼びます。すぐに送りたいときは次を実行します。

```bash
MAIL_WORKER_SECRET=local-dev-worker-secret npm run mail:flush
```

---

## 6. テスト手順

```bash
npx supabase test db        # DBの動作テスト（pgTAP、81項目）
npm run test:concurrency    # 同時利用テスト（supabase start 済みのDBに対して実行）
npm run functions:test      # Edge Functions の単体テスト（Deno）
npm run web:test            # 画面ロジックの単体テスト（Vitest）
```

| 要件 | テスト |
|---|---|
| 正常な使用（在庫の減算・履歴・メール本文） | `01_usage.test.sql` |
| 未登録の社員番号 | `01_usage.test.sql` |
| 在庫不足（複数品目のうち1つが不足しても全部登録しない） | `01_usage.test.sql` |
| 数量が正の整数でない（0・負数・小数・文字列） | `01_usage.test.sql` |
| 二重送信で二重登録しない | `01_usage.test.sql` |
| 端末キーの誤り・総当たりロック・anonの権限 | `01_usage.test.sql` |
| 補充による在庫加算（メールは送らない） | `02_restock_reminder.test.sql` |
| しきい値以下での日次通知（本文に備品名・在庫・しきい値） | `02_restock_reminder.test.sql` |
| 補充後もしきい値以下なら翌日も通知 | `02_restock_reminder.test.sql` |
| しきい値を超えたら通知停止 | `02_restock_reminder.test.sql` |
| 同じ日の重複通知防止 | `02_restock_reminder.test.sql` |
| メール送信失敗時に在庫・履歴が変わらず、再送に回る | `02_restock_reminder.test.sql` / `send-mail/worker.test.ts` |
| 端末キーの変更 | `02_restock_reminder.test.sql` |
| 月次集計（仕訳別の使用ベース／購入ベース、前月比） | `03_monthly.test.sql` |
| 同時利用で在庫がマイナスにならない（30件同時・在庫10） | `scripts/concurrency-test.mjs` |
| AI出力の検証（存在しないID・不正な数量を除外） | `parse-usage/parse.test.ts` |

Docker が使えない環境では、PostgreSQL 16 に pgTAP と pg_cron を入れれば、`scripts/native-test/run.sh` で同じ pgTAP テストを実行できます。Supabase 固有の部分は簡易的な代替（スタブ）で補っています。

### 手動での動作確認の例

1. `dev-device-key` で端末を登録し、単4乾電池（在庫6・しきい値8）を1本、社員番号 `1001` で受け取る → 完了画面で「補充依頼対象」と表示される
2. 管理画面の「メール・通知」→「本日の補充依頼を今すぐ実行」→ 補充依頼メールが登録される。もう一度押すと「本日分はすでに通知済み」と表示される
3. 「補充」で単4乾電池を10本登録 → 更新後の在庫数と「翌日以降の補充依頼は停止します」が表示される
4. AI入力欄に「単3電池を4本とA4の紙1冊」と入れて読み取り → 確認画面 → 社員番号 → はい
5. 「月次レポート」で集計を確認し、「AIレポートを生成」を押す

---

## 7. 本番構築手順

### 7-1. Supabase

1. プロジェクトを作成する（リージョンは Tokyo を推奨）。
2. マイグレーションと関数を反映する。

   ```bash
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   npx supabase functions deploy
   ```

   GitHub Actions の「Supabase にDB変更・関数を反映」を手動実行しても同じです。

3. Auth の設定で「Allow new users to sign up」をオフにする（管理者は管理画面かスクリプトで追加します）。
4. 送信処理の呼び出し先を Vault に登録する（SQL Editor で実行）。

   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/send-mail', 'mail_worker_url');
   select vault.create_secret('<ランダムな長い文字列>', 'mail_worker_secret');
   ```

5. Edge Functions の秘密情報を登録する。

   ```bash
   npx supabase secrets set ANTHROPIC_API_KEY=... CLAUDE_MODEL=... \
     MAIL_PROVIDER=smtp SMTP_HOST=smtp.gmail.com SMTP_PORT=465 SMTP_SECURE=true \
     SMTP_USER=<Gmailアドレス> SMTP_PASS=<アプリパスワード> MAIL_FROM=<Gmailアドレス> \
     MAIL_WORKER_SECRET=<Vaultと同じ値> ALLOWED_ORIGIN=https://<org>.github.io
   ```

6. 最初の管理者を作成する：`SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... npm run create-admin -- <email> <password>`
7. 管理画面の「端末キー」で本番用の端末キーを設定する（seed は本番には入らないため、設定するまで端末キーは未設定のままです）。

### 7-2. Gmail

1. 送信専用の Gmail アカウントを作り、2段階認証を有効にする。
2. 「アプリパスワード」を発行し、`SMTP_PASS` に設定する。
3. 無料の Gmail は1日の送信数に上限があります（目安500通）。送信間隔は `MAIL_SEND_INTERVAL_MS`、1回の最大送信数は `MAIL_BATCH_SIZE` で調整できます。
4. 社内の受信側で迷惑メール扱いされないか、最初に数通送って確認してください。必要ならこのアドレスを許可リストに登録します。

### 7-3. GitHub Pages

1. リポジトリの Settings → Pages → Source を「GitHub Actions」にする。
2. Settings → Secrets and variables → Actions に次を登録する。

   | 種類 | 名前 |
   |---|---|
   | Variables | `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_PROJECT_REF` |
   | Secrets | `SUPABASE_ACCESS_TOKEN`、`SUPABASE_DB_PASSWORD` |

3. main に push すると画面が公開されます（`https://<org>.github.io/<repo>/`）。

---

## 8. 運用上の注意・制約

- **社員番号は本人確認ではありません。** 他人の番号を入力すれば、その人の名前で記録できてしまいます。この点を利用画面と管理画面に表示しています。受取のたびに本人へメールを送り、心当たりのない記録に本人が気づけるようにしています。
- **端末キーは簡易的な制限です。** GitHub Pages はインターネットに公開されるため、社内ネットワーク限定にはなりません。キーは12文字以上のランダムな文字列にし、定期的に（例：月1回）変更してください。退職者や異動者が出たときも変更してください。
- 端末キーを知っている人は、社員番号を入力すれば氏名を確認できます。社員番号を順に試す総当たりを防ぐため、同じ接続元から未登録番号の入力が15分間に30回続くと、15分間ロックします。
- 接続元IPは、Supabase の前段が付けるヘッダー（`cf-connecting-ip` など）から判定します。ヘッダーの付き方によっては、ロックが接続元ごとではなく広くかかる可能性があります。その場合は管理画面の「端末キー」からロックを解除できます。
- メールは「少なくとも1回」届く方式です。送信直後に処理が異常終了すると、まれに同じメールが2通届く可能性があります。在庫と履歴は二重に更新されません。
- Supabase の無料プランは、1週間使われないとプロジェクトが一時停止されます。停止中は9時の補充依頼も動きません。
- AI（Claude）が読み取った結果は必ず確認画面を通し、在庫の最終判定はDBで行います。月次レポートの文章はAIが作るため、数値は画面の表で確認してください。
