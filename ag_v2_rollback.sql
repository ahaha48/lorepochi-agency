-- ================================================================
-- ロレポチ代理店版 v2 ロールバック（ag_v2_migration.sql を元に戻す用）
-- ★ 注意: ブローカーの「データ」は v2 で削除済みのため復元されません
--   （v2適用時点でブローカー経由は0件運用だったため、実データ損失はなし）。
--   本スクリプトは「構造(ag_brokers/broker_id/XOR制約)」と「報酬単価」を
--   v1 相当へ戻します。
-- ★ 本番1期生ロレポチ・ロレクエには無影響（ag_ 接頭辞のみ操作）。
-- ★ 使う時だけ Supabase SQL Editor に貼って実行してください。
-- ================================================================

-- ① ブローカーテーブルを再作成（空）＋RLS復元
CREATE TABLE IF NOT EXISTS ag_brokers (
  id         BIGINT PRIMARY KEY,
  agency_id  BIGINT NOT NULL REFERENCES ag_agencies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  note       TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE ag_brokers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow authenticated" ON ag_brokers;
CREATE POLICY "Allow authenticated" ON ag_brokers FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ② エンドユーザーに broker_id を戻す＋XOR制約を復元
--    （既存行は agency_id 有り・broker_id NULL → XOR を満たすため制約追加は成功）
ALTER TABLE ag_end_users ALTER COLUMN agency_id DROP NOT NULL;
ALTER TABLE ag_end_users ADD COLUMN IF NOT EXISTS broker_id BIGINT REFERENCES ag_brokers(id) ON DELETE CASCADE;
ALTER TABLE ag_end_users DROP CONSTRAINT IF EXISTS ag_end_users_broker_xor_agency;
ALTER TABLE ag_end_users ADD CONSTRAINT ag_end_users_broker_xor_agency
  CHECK ((broker_id IS NOT NULL) <> (agency_id IS NOT NULL));

-- ③ 報酬単価を v1 相当へ戻す＋列DEFAULT復元
UPDATE ag_config
   SET fee_enduser_weekly  = 500,
       cap_enduser_monthly = 3000,
       fee_agency_weekly   = 1250
 WHERE key = 'main';
ALTER TABLE ag_config ALTER COLUMN fee_enduser_weekly  SET DEFAULT 500;
ALTER TABLE ag_config ALTER COLUMN cap_enduser_monthly SET DEFAULT 3000;
ALTER TABLE ag_config ALTER COLUMN fee_agency_weekly    SET DEFAULT 1250;
