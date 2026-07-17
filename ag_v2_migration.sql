-- ================================================================
-- ロレポチ代理店版 v2 マイグレーション
--   ① ブローカー層(ag_brokers)の廃止（代理店→エンドユーザーの2階層へ）
--   ② 報酬単価の変更（エンド 1週1,000円/上限5,000円・代理店 1週2,000円/合計8,000円）
-- ★ 本番1期生ロレポチ(app_config/members 等)・ロレクエ(lq_) には無影響。
--   本スクリプトは ag_ 接頭辞テーブルのみを操作します。
-- ★ Supabase SQL Editor で全文実行。破壊的DDL(DROP)を含むため、
--   「Potential issue detected」ダイアログが出たら内容を確認のうえ同意して Run。
-- ================================================================

-- === 事前確認（実行前に目視。どちらも 0 が想定）=====================
-- ブローカー登録数（0件想定＝全員が代理店直のため）
SELECT count(*) AS brokers_count FROM ag_brokers;
-- 所属代理店(agency_id)が未設定のエンドユーザー（下の backfill 後に 0 になる想定）
SELECT count(*) AS enduser_without_agency FROM ag_end_users WHERE agency_id IS NULL;

-- === ① バックフィル（安全網：万一ブローカー経由が残っていれば代理店直へ移す）===
--   ※ XOR制約により broker_id を持つ行は agency_id が NULL。ブローカーの所属代理店を継がせる。
UPDATE ag_end_users eu
   SET agency_id = b.agency_id
  FROM ag_brokers b
 WHERE eu.broker_id = b.id
   AND eu.agency_id IS NULL;

-- === ② 構造変更（トランザクションで一括。途中失敗は自動ロールバック＝半壊防止）====
BEGIN;
  -- XOR制約が broker_id を参照するため、列DROPより先に制約をDROP
  ALTER TABLE ag_end_users DROP CONSTRAINT IF EXISTS ag_end_users_broker_xor_agency;
  -- broker_id 列を削除（ag_brokers への外部キーもここで消える）
  ALTER TABLE ag_end_users DROP COLUMN IF EXISTS broker_id;
  -- 代理店直属を必須化（残NULLがあればここで失敗→全ロールバック）
  ALTER TABLE ag_end_users ALTER COLUMN agency_id SET NOT NULL;
  -- ブローカーテーブル削除
  DROP TABLE IF EXISTS ag_brokers CASCADE;
COMMIT;

-- === ③ 報酬単価の更新（実行時は DB(ag_config) が優先のため、この UPDATE が必須）====
UPDATE ag_config
   SET fee_enduser_weekly  = 1000,   -- エンド 1週 1,000円（旧500）
       cap_enduser_monthly = 5000,   -- エンド 月上限 5,000円（旧3,000／1000×4+ボーナス1000）
       fee_agency_weekly   = 2000    -- 代理店 1週 2,000円（旧1,250／4週=8,000円）
 WHERE key = 'main';
-- 列DEFAULTも新値へ（新規行・再作成時の既定を揃える）
ALTER TABLE ag_config ALTER COLUMN fee_enduser_weekly  SET DEFAULT 1000;
ALTER TABLE ag_config ALTER COLUMN cap_enduser_monthly SET DEFAULT 5000;
ALTER TABLE ag_config ALTER COLUMN fee_agency_weekly    SET DEFAULT 2000;

-- === 事後確認（値が 1000 / 5000 / 2000、still_null が 0 であること）==========
SELECT fee_enduser_weekly, cap_enduser_monthly, fee_agency_weekly FROM ag_config WHERE key = 'main';
SELECT count(*) AS enduser_total,
       count(*) FILTER (WHERE agency_id IS NULL) AS still_null
  FROM ag_end_users;
