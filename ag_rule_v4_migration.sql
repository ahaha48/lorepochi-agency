-- ================================================================
-- ロレポチ代理店版 v4 マイグレーション（報酬計算ルールの改定）
--
--   ① 1カウント = 応募完了SS5枚 ＋ 結果SS5枚（条件は従来どおり）
--   ② カウントの計上月 = 「結果SS5枚を送った日」の月
--        → ag_weekly に result_ss_date（YYYYMMDD）を追加。管理画面で結果SS✓を押した日が自動記録される
--        月末が火曜日の場合、翌月1日（水曜）の報告も当月扱い（計算エンジン側で判定）
--   ③ 初月（参加月）は達成回数分を支払い。2ヶ月目以降は「その月をコンプリート」した場合のみ支払い
--        → ag_end_users に start_month（参加月・任意）を追加。NULL なら週次入力があった最初の月を自動判定
--   ④ 新ルールの適用開始月 rule_v4_from_month を ag_config に追加（既定 9 = 2026年9月分から）
--        NULL にすると全期間が v3（従来）計算に戻る
--
--   ★ 変更しないもの: 単価（エンド1,000円／代理店1,000円）/ 必要店舗数5 /
--     当選者フィー（入店完了1件目50,000・2件目以降70,000）/
--     エンド当選報酬20,000円＋買付インセンティブ / 制限180日
--
-- ★ 本番1期生ロレポチ(app_config/members 等)・ロレクエ(lq_) には無影響。
--   本スクリプトは ag_ 接頭辞テーブルへの列追加と ag_config の key='main' 1行のみ（DROP/DELETEなし）。
-- ★ rule_v4_from_month より前の月（8月以前）は従来の v3 計算のまま。過去の支払済み金額は変わらない。
--
-- ★★ 実行順序が重要 ★★
--   1. このSQLを Supabase SQL Editor で STEP 1 → STEP 2 → STEP 3 の順に個別実行する
--   2. その後で新しい index.html / ag_calc.js を公開（git push）する
--   逆にすると、新しい管理画面が result_ss_date / rule_v4_from_month を保存しようとして
--   「column does not exist」で保存に失敗する。
-- 適用日: 2026-09-24
-- ================================================================

-- === STEP 1: 事前確認（★実行して結果を控える）====================================
--   列がまだ無いことと、現在の単価が 1000 / 1000 であることを確認する
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_name IN ('ag_weekly','ag_end_users','ag_config')
   AND column_name IN ('result_ss_date','start_month','rule_v4_from_month');
--   ↑ 0行が想定（すでに列がある場合は STEP 2 の ADD COLUMN IF NOT EXISTS がスキップされるだけで害はない）
SELECT fee_enduser_weekly, fee_agency_weekly, cap_enduser_monthly
  FROM ag_config WHERE key = 'main';
--   ↑ 想定: 1000 / 1000 / 6000（v4 でも変更しない）

-- === STEP 2: 列追加＋適用開始月の設定（途中失敗時は自動ロールバック）===================
BEGIN;
  -- 結果SS5枚が届いた日（計上月の基準）。旧データは NULL のまま＝入力月に計上
  ALTER TABLE ag_weekly    ADD COLUMN IF NOT EXISTS result_ss_date TEXT;
  -- 参加月（初月）の手動指定。NULL＝自動判定
  ALTER TABLE ag_end_users ADD COLUMN IF NOT EXISTS start_month INTEGER;
  -- 新ルールの適用開始月（既定 9）。既存行にも DEFAULT が入る
  ALTER TABLE ag_config    ADD COLUMN IF NOT EXISTS rule_v4_from_month INTEGER DEFAULT 9;
  UPDATE ag_config SET rule_v4_from_month = 9 WHERE key = 'main';
COMMIT;

-- === STEP 3: 事後確認（3行返り、rule_v4_from_month = 9 であればOK）==================
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_name IN ('ag_weekly','ag_end_users','ag_config')
   AND column_name IN ('result_ss_date','start_month','rule_v4_from_month');
SELECT rule_v4_from_month, fee_enduser_weekly, fee_agency_weekly FROM ag_config WHERE key = 'main';

-- === STEP 4: 新しい index.html を公開したら、開いている管理画面タブを全てハードリロード ======
--   管理画面は起動時に ag_config を読み込み、月・週セレクタ操作のたびに upsert で書き戻す。
--   古いタブは rule_v4_from_month を知らないため上書きはしない（列を送らない）が、
--   新しい計算ロジックを使うにはリロードが必要。

-- ================================================================
-- 適用開始月を変えたい場合（例: 10月分から新ルールにする）
--   UPDATE ag_config SET rule_v4_from_month = 10 WHERE key = 'main';
--   → 9月分は従来どおり「達成週×1,000円（コンプリート条件なし）」で計算される
--
-- ロールバック（計算を v3 に戻す。列は残しても害がないので消さない）
--   UPDATE ag_config SET rule_v4_from_month = NULL WHERE key = 'main';
--   ※ ファイル側（ag_calc.js / index.html / ag_schema.sql / richmenu/pages/rewards.html）も git で戻すこと。
--   ※ 列ごと消す場合（通常は不要）:
--     ALTER TABLE ag_weekly    DROP COLUMN IF EXISTS result_ss_date;
--     ALTER TABLE ag_end_users DROP COLUMN IF EXISTS start_month;
--     ALTER TABLE ag_config    DROP COLUMN IF EXISTS rule_v4_from_month;
-- ================================================================
