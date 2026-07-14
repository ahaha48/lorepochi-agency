-- ============================================================
-- 代理店応募フィー単価の修正: 1000円 → 1250円
-- 正しいルール: 1応募＆当落SS(5店舗)につき1250円、
--              4週コンプリートで代理店報酬合計 1250×4 = 5000円
-- 影響範囲: ag_config の key='main' 1行のみ（他テーブルは無変更）。
--          まだ払い出し前のため、過去月が1250で再計算されても問題なし。
-- 適用日: 2026-07-15
-- ============================================================

-- 1) 実行時に使われる値（★これが本番表示を直す本体）
UPDATE ag_config SET fee_agency_weekly = 1250 WHERE key = 'main';

-- 2) 将来の新規行のための列デフォルト（既存行は書き換えない）
ALTER TABLE ag_config ALTER COLUMN fee_agency_weekly SET DEFAULT 1250;

-- 確認用（実行後に値を目視）:
-- SELECT key, fee_agency_weekly FROM ag_config WHERE key = 'main';   -- → 1250 になっていればOK

-- ============================================================
-- ロールバック（元に戻す場合はこの2行を実行）
-- UPDATE ag_config SET fee_agency_weekly = 1000 WHERE key = 'main';
-- ALTER TABLE ag_config ALTER COLUMN fee_agency_weekly SET DEFAULT 1000;
-- ============================================================
