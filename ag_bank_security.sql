-- ================================================================
-- ロレポチ代理店版：銀行口座を「管理者専用テーブル」に分離する追加設定
-- ★ すでに ag_schema.sql を実行済みのDBに対して、Supabase SQL Editor で1回実行
-- ★ ag_ テーブルのみ対象。本番ロレポチ（members等）・ロレクエ（lq_等）には無影響。
-- ★ まだ口座を入力していない前提（列削除で失われる実データはなし）
-- ================================================================

-- 1. 通常テーブルから口座列を除去（＝入力部隊でも読めてしまう状態を解消）
ALTER TABLE ag_end_users DROP COLUMN IF EXISTS bank_info;
ALTER TABLE ag_agencies  DROP COLUMN IF EXISTS bank_info;

-- 2. 管理者専用の口座テーブルを作成
CREATE TABLE IF NOT EXISTS ag_bank_accounts (
  owner_type TEXT   NOT NULL,          -- 'end_user' | 'agency'
  owner_id   BIGINT NOT NULL,          -- ag_end_users.id / ag_agencies.id
  bank_info  TEXT   DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (owner_type, owner_id)
);

-- 3. RLS：管理者メールのみ許可（他のログインユーザーには1行も返らない）
ALTER TABLE ag_bank_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin only" ON ag_bank_accounts;
CREATE POLICY "Admin only" ON ag_bank_accounts FOR ALL TO authenticated
  USING     ( (auth.jwt() ->> 'email') IN ('ahahakoubou48@gmail.com') )
  WITH CHECK ( (auth.jwt() ->> 'email') IN ('ahahakoubou48@gmail.com') );

-- 管理者を追加する場合は上記2箇所の IN('...') にメールを足す。例:
--   IN ('ahahakoubou48@gmail.com', 'another-admin@example.com')
