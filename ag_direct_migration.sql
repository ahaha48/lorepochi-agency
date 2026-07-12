-- ================================================================
-- ロレポチ代理店版 マイグレーション: 代理店直エンドユーザー対応
-- ★ Supabase SQL Editor で全文を実行（本番ロレポチと同一プロジェクト・ag_ 接頭辞）
--
-- 目的: ブローカーを介さず代理店に直属するエンドユーザーを登録可能にする
--   階層: 代理店(ag_agencies) → ブローカー(ag_brokers) → エンドユーザー
--   これまで: エンドユーザーは必ずブローカー経由（broker_id NOT NULL）
--   これから: 「ブローカー経由」か「代理店直（agency_id）」のどちらか一方
--
-- 安全性:
--   ・列追加 / NOT NULL 緩和 / CHECK 追加のみ（DROP・データ更新なし）
--   ・既存行は全て broker_id を持つため XOR CHECK を必ず満たす＝弾かれない
--   ・本番ロレポチ（ag_ 以外）のテーブルには一切触れない
-- ================================================================

-- 1) 代理店直の所属先を保持する agency_id 列を追加（NULL 許可）
ALTER TABLE ag_end_users
  ADD COLUMN IF NOT EXISTS agency_id BIGINT REFERENCES ag_agencies(id) ON DELETE CASCADE;

-- 2) ブローカー必須をやめる（代理店直では broker_id が NULL）
ALTER TABLE ag_end_users
  ALTER COLUMN broker_id DROP NOT NULL;

-- 3) 「ブローカー経由」か「代理店直」の“ちょうど一方”だけを許可（XOR）
--    → 両方セット / 両方 NULL を DB レベルで物理的に禁止（UI バグの保険）
ALTER TABLE ag_end_users
  DROP CONSTRAINT IF EXISTS ag_end_users_broker_xor_agency;
ALTER TABLE ag_end_users
  ADD CONSTRAINT ag_end_users_broker_xor_agency
  CHECK ((broker_id IS NOT NULL) <> (agency_id IS NOT NULL));

-- 確認用（任意）: 制約が付いたか
-- SELECT conname FROM pg_constraint WHERE conrelid = 'ag_end_users'::regclass;

-- ================================================================
-- ロールバック（必要時のみ・下記コメントを外して上から順に実行）
-- ★ 注意: 代理店直ユーザー（broker_id IS NULL）が 1 件でも存在すると
--   最後の SET NOT NULL が失敗します。先に該当行を削除するか broker_id を
--   埋めてから実行すること。
-- ----------------------------------------------------------------
-- ALTER TABLE ag_end_users DROP CONSTRAINT IF EXISTS ag_end_users_broker_xor_agency;
-- ALTER TABLE ag_end_users DROP COLUMN IF EXISTS agency_id;
-- ALTER TABLE ag_end_users ALTER COLUMN broker_id SET NOT NULL;
-- ================================================================
