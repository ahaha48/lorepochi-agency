-- ================================================================
-- ロレポチ代理店版 マイグレーション: 週次「結果SS」を1タップ（真偽）化
-- ★ Supabase SQL Editor で全文を実行（本番ロレポチと同一プロジェクト・ag_ 接頭辞）
--
-- 目的: 結果スクショ確認を「店舗数(result_stores)」から
--       「結果SS✓の1タップ(result_ss / 真偽)」に変更（1期生ロレポチと同方式）
--   達成条件: 抽選 required_stores 店舗以上 ＆ 結果SS✓
--
-- 安全性: ag_weekly のみ。列追加→バックフィル→旧列削除の順。
--   ・現状 ag_weekly は 0 件（実データなし）だが、将来データがある場合も
--     result_stores >= 5 だった週を result_ss = TRUE に引き継ぐ。
--   ・本番ロレポチ（ag_ 以外）のテーブルには一切触れない。
-- ================================================================

-- 1) 結果SS（真偽）列を追加
ALTER TABLE ag_weekly
  ADD COLUMN IF NOT EXISTS result_ss BOOLEAN DEFAULT FALSE;

-- 2) 旧「結果店舗数」からバックフィル（5店舗以上を確認済み＝結果SS✓とみなす）
--    ※ result_stores 列がまだ存在する場合のみ実行される
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ag_weekly' AND column_name = 'result_stores'
  ) THEN
    EXECUTE 'UPDATE ag_weekly SET result_ss = TRUE WHERE COALESCE(result_stores,0) >= 5';
  END IF;
END $$;

-- 3) 旧「結果店舗数」列を削除
ALTER TABLE ag_weekly
  DROP COLUMN IF EXISTS result_stores;

-- ================================================================
-- ロールバック（必要時のみ・下記コメントを外して上から順に実行）
-- ----------------------------------------------------------------
-- ALTER TABLE ag_weekly ADD COLUMN IF NOT EXISTS result_stores INTEGER DEFAULT 0;
-- UPDATE ag_weekly SET result_stores = 5 WHERE result_ss = TRUE;   -- 真偽→代表値(5)へ復元
-- ALTER TABLE ag_weekly DROP COLUMN IF EXISTS result_ss;
-- ================================================================
