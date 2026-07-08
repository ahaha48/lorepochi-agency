-- ================================================================
-- ロレポチ代理店版 テーブル削除（元に戻す用）
-- ★ これは ag_ テーブルだけを削除します。
--   本番ロレポチ（members 等）・ロレクエ（lq_ 等）には一切影響しません。
-- ★ 使う時だけ Supabase SQL Editor に貼って実行してください。
-- ================================================================
DROP TABLE IF EXISTS ag_bank_accounts CASCADE;
DROP TABLE IF EXISTS ag_wins      CASCADE;
DROP TABLE IF EXISTS ag_weekly    CASCADE;
DROP TABLE IF EXISTS ag_end_users CASCADE;
DROP TABLE IF EXISTS ag_brokers   CASCADE;
DROP TABLE IF EXISTS ag_agencies  CASCADE;
DROP TABLE IF EXISTS ag_config    CASCADE;
