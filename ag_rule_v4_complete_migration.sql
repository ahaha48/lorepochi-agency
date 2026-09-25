-- ================================================================
-- ロレポチ代理店版 v4b マイグレーション（③の適用開始月を②から分離）
--
--   v4 では次の2つを ag_config.rule_v4_from_month（=9）で一括して切り替えていた。
--     ② カウントの計上月 = 「結果SS5枚を送った日」の月（月末が火曜なら翌月1日も当月）
--     ③ 初月は達成回数分を支払い。2ヶ月目以降は「その月をコンプリート」した場合のみ支払い
--   v4b では ③ の適用開始月を rule_v4_complete_from_month（=10）に分離する。
--     → ② は 9月分から、③ は 10月分から。9月分は結果SS日で計上した回数×単価をそのまま支払う。
--
-- ★ 本番1期生ロレポチ(app_config/members 等)・ロレクエ(lq_) には無影響。
--   本スクリプトは ag_config への列追加1本と key='main' 1行の UPDATE のみ（DROP/DELETEなし）。
--
-- ★★ 実行順序が重要 ★★
--   1. このSQLを Supabase SQL Editor で STEP 1 → STEP 2 → STEP 3 の順に実行する
--   2. その後で新しい index.html / ag_calc.js を公開（git push）する
--   逆にすると、新しい管理画面が rule_v4_complete_from_month を保存しようとして
--   「column does not exist」で月・週セレクタの保存に失敗する。
-- 適用日: 2026-09-25
-- ================================================================

-- === STEP 1: 事前確認 =============================================================
--   列がまだ無いこと（0行）と、rule_v4_from_month = 9 であることを確認する
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_name = 'ag_config' AND column_name = 'rule_v4_complete_from_month';
SELECT rule_v4_from_month, fee_enduser_weekly, fee_agency_weekly FROM ag_config WHERE key = 'main';

-- === STEP 2: 列追加＋適用開始月の設定（途中失敗時は自動ロールバック）===================
BEGIN;
  ALTER TABLE ag_config ADD COLUMN IF NOT EXISTS rule_v4_complete_from_month INTEGER DEFAULT 10;
  UPDATE ag_config SET rule_v4_complete_from_month = 10 WHERE key = 'main';
COMMIT;

-- === STEP 3: 事後確認（rule_v4_from_month = 9, rule_v4_complete_from_month = 10 ならOK）====
SELECT rule_v4_from_month, rule_v4_complete_from_month FROM ag_config WHERE key = 'main';

-- === STEP 4: 新しい index.html を公開したら、開いている管理画面タブを全てハードリロード ======
--   管理画面は起動時に ag_config を読み込み、月・週セレクタ操作のたびに丸ごと upsert で書き戻す。
--   ag_config を手動で UPDATE したときも（下のロールバック含む）、更新前に開いていたタブが
--   古い値を書き戻すため、必ず全タブをハードリロードすること。

-- ================================================================
-- 変更したい場合
--   ③の適用開始月を変える（例: 11月分から）:
--     UPDATE ag_config SET rule_v4_complete_from_month = 11 WHERE key = 'main';
--
-- ロールバック（2種類あるので注意）
--   (a) 本日公開済みの v4 の挙動（③も9月分から適用）に戻す:
--     UPDATE ag_config SET rule_v4_complete_from_month = 9 WHERE key = 'main';
--     ※ ファイル側を git revert で戻してもよい。旧 ag_calc.js は新列を無視するので DB はそのままで可
--   (b) ③（初月/コンプリート条件）を全期間オフにする（②の結果SS日計上は残る）:
--     UPDATE ag_config SET rule_v4_complete_from_month = NULL WHERE key = 'main';
--   いずれも実行後は全タブをハードリロードすること。
--   ※ 列ごと消す場合（通常は不要）:
--     ALTER TABLE ag_config DROP COLUMN IF EXISTS rule_v4_complete_from_month;
-- ================================================================
