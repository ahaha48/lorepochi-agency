-- ================================================================
-- ロレポチ代理店版 Supabase スキーマ
-- ★ 本番ロレポチと「同一」Supabaseプロジェクトに ag_ 接頭辞で同居させる構成
--   （無料枠が2プロジェクト上限のため。既存テーブルには一切触れず ag_ を追加するだけ）
-- ★ Supabase SQL Editor で全文実行
-- 階層: 代理店(ag_agencies) → エンドユーザー(ag_end_users)  ※ブローカー層は廃止（v2）
-- 当選の正データは ag_wins。当落・当選回数はここから導出する（スカラーで持たない）
-- ================================================================

-- 1. 代理店（TMサロン）
--    ※ 振込先口座は機微情報のため、この表には持たず ag_bank_accounts（管理者専用）に格納
CREATE TABLE IF NOT EXISTS ag_agencies (
  id         BIGINT PRIMARY KEY,           -- Date.now() 採番のため BIGINT
  name       TEXT NOT NULL,
  note       TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. エンドユーザー（応募者）
--    ※ 銀行口座は機微情報のため、この表には持たず ag_bank_accounts（管理者専用）に格納
--    ※ v2でブローカー層を廃止。エンドユーザーは代理店に直属（agency_id 必須）。
CREATE TABLE IF NOT EXISTS ag_end_users (
  id         BIGINT PRIMARY KEY,
  agency_id  BIGINT NOT NULL REFERENCES ag_agencies(id) ON DELETE CASCADE,  -- 所属代理店
  line_name  TEXT,                         -- 公式LINE名
  real_name  TEXT,                         -- 照合用の本名（機微情報）
  status     TEXT DEFAULT '応募中',
  note       TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. 週次入力（店舗数ベース・毎週水曜締め）
CREATE TABLE IF NOT EXISTS ag_weekly (
  month          INTEGER NOT NULL,         -- 暦月(1-12)
  week           INTEGER NOT NULL,         -- 月内の週(1-4/5)
  end_user_id    BIGINT NOT NULL REFERENCES ag_end_users(id) ON DELETE CASCADE,
  lottery_stores INTEGER DEFAULT 0,        -- 抽選SSを確認できた店舗数
  result_ss      BOOLEAN DEFAULT FALSE,    -- 結果SS確認（1タップ・真偽／1期生ロレポチと同方式）
  note           TEXT DEFAULT '',
  PRIMARY KEY (month, week, end_user_id)
);

-- 4. 当選（正データ）
CREATE TABLE IF NOT EXISTS ag_wins (
  id                    BIGINT PRIMARY KEY,
  end_user_id           BIGINT NOT NULL REFERENCES ag_end_users(id) ON DELETE CASCADE,
  won_date              TEXT,              -- YYYYMMDD（応募フィー停止・フェーズ判定の起点）
  shop                  TEXT,
  month                 INTEGER,           -- 当選した月（週次フェーズ判定に使用）
  week                  INTEGER,           -- 当選した週
  store_entry_completed BOOLEAN DEFAULT FALSE,  -- 入店完了（支払確定・制限起算のトリガ）
  store_entry_date      TEXT,              -- YYYYMMDD（入店完了日）
  purchase_incentive    INTEGER DEFAULT 0, -- 購入インセンティブ（当選ごと入力）
  note                  TEXT DEFAULT ''
);

-- 5. 設定（月・週の状態、金額、日数）※金額はここで一元管理＝将来変更しても過去分はコード側でスナップショット
CREATE TABLE IF NOT EXISTS ag_config (
  key                       TEXT PRIMARY KEY,
  cur_month                 INTEGER DEFAULT 1,
  cur_week                  INTEGER DEFAULT 1,
  available_months          JSONB DEFAULT '[1]',
  weeks_per_month           JSONB DEFAULT '{"1":[1,2,3,4]}',  -- 各月の週リスト
  required_stores           INTEGER DEFAULT 5,   -- 週次条件の必要店舗数（イベント時6）
  fee_enduser_weekly        INTEGER DEFAULT 1000,  -- v2: 1週1,000円
  fee_enduser_monthly_bonus INTEGER DEFAULT 1000,  -- 4週コンプで+1,000円
  cap_enduser_monthly       INTEGER DEFAULT 5000,  -- v2: MAX 5,000円
  reward_enduser_win        INTEGER DEFAULT 20000,
  fee_agency_weekly         INTEGER DEFAULT 2000,   -- v2: 1週2,000円（4週=8,000円）
  fee_agency_win_1st        INTEGER DEFAULT 50000,
  fee_agency_win_2nd        INTEGER DEFAULT 70000, -- 入店完了2件目以降
  restriction_days          INTEGER DEFAULT 180
);

INSERT INTO ag_config (key) VALUES ('main') ON CONFLICT (key) DO NOTHING;

-- 6. 銀行口座（★管理者専用テーブル）
--    エンドユーザー/代理店の口座をここに集約。RLSで管理者メールのみ許可。
--    owner_type: 'end_user' | 'agency' ／ owner_id: 各テーブルの id
CREATE TABLE IF NOT EXISTS ag_bank_accounts (
  owner_type TEXT   NOT NULL,
  owner_id   BIGINT NOT NULL,
  bank_info  TEXT   DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (owner_type, owner_id)
);

-- ================================================================
-- RLS（Row Level Security）: 認証済み（管理者）のみ全操作可
-- ★ 口座情報・本名を含むため RLS は必須。クライアントには anon キーのみ。
--   service_role キーは絶対にフロントに埋め込まないこと。
-- ================================================================
ALTER TABLE ag_agencies  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ag_end_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE ag_weekly    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ag_wins      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ag_config    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated" ON ag_agencies;
DROP POLICY IF EXISTS "Allow authenticated" ON ag_end_users;
DROP POLICY IF EXISTS "Allow authenticated" ON ag_weekly;
DROP POLICY IF EXISTS "Allow authenticated" ON ag_wins;
DROP POLICY IF EXISTS "Allow authenticated" ON ag_config;

CREATE POLICY "Allow authenticated" ON ag_agencies  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated" ON ag_end_users FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated" ON ag_weekly    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated" ON ag_wins      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated" ON ag_config    FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ★ 銀行口座テーブルだけは「管理者メールのみ」に制限（入力部隊には1行も返らない）
--   管理者を増やす場合は IN(...) にメールを追加する。
ALTER TABLE ag_bank_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin only" ON ag_bank_accounts;
CREATE POLICY "Admin only" ON ag_bank_accounts FOR ALL TO authenticated
  USING     ( (auth.jwt() ->> 'email') IN ('ahahakoubou48@gmail.com') )
  WITH CHECK ( (auth.jwt() ->> 'email') IN ('ahahakoubou48@gmail.com') );
