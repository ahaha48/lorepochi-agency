-- ================================================================
-- ロレポチ代理店版 v3 マイグレーション（報酬計算方式の改定）
--
--   ① 代理店（PMサロン）の応募フィー: 1週2,000円 → 1応募につき1,000円
--   ② 月間コンプリートボーナス: 1,000円 → 廃止（0円）
--   ③ エンドユーザーの月上限: 5,000円 → 6,000円
--      （旧上限は「1,000×4週＋ボーナス1,000」の頭打ちだった数字。
--        ボーナス廃止後もこの値のままだと、6週ある月に達成週ぶんの
--        1,000円が黙って切り捨てられるため、上限が効かない値へ引き上げる）
--
--   ★ 変更しないもの: エンド週次1,000円 / 必要店舗数5 /
--     当選者フィー（入店完了1件目50,000・2件目以降70,000）/
--     エンド当選報酬20,000円＋買付インセンティブ / 制限180日
--
-- ★ 本番1期生ロレポチ(app_config/members 等)・ロレクエ(lq_) には無影響。
--   本スクリプトは ag_config の key='main' 1行のみを操作します（DROP/DELETEなし）。
-- ★ 計算エンジンは毎回全期間を再計算するため、過去月の集計・CSVも新レートに変わります
--   （全期間へ新レートを適用する方針で合意済み）。
-- ★ 注意: ag_v2_rollback.sql は本スクリプトより前の世代のロールバックです。
--   v3適用後にあれを実行すると代理店フィーが1,250円に戻ってしまうため、実行しないこと。
--
-- ★★ このファイルは全文一括実行しないこと（他のマイグレーションと手順が違う）。
--   STEP 1 → STEP 2 → STEP 3 の順に、各STEPを範囲選択して個別に Run すること
--   （Supabase SQL Editor は選択した範囲だけを実行できる）。
--   全文実行すると STEP 1 を読む前に STEP 2 の UPDATE が走り、
--   ロールバック先である旧値が上書きされて二度と読めなくなる。
-- 適用日: 2026-08-28
-- ================================================================

-- === STEP 1: 事前確認（★必ず実行し、結果を手元に控えてからSTEP 2へ）=========
--   ここで出た3つの値が「戻すときの正しい旧値」です。想定は 2000 / 1000 / 5000 ですが、
--   過去マイグレーションの適用状況によっては 1250 等になっている可能性があります。
SELECT fee_agency_weekly,          -- 想定: 2000（1250の可能性あり）
       fee_enduser_monthly_bonus,  -- 想定: 1000
       cap_enduser_monthly,        -- 想定: 5000
       fee_enduser_weekly,         -- 想定: 1000（変更しない）
       fee_agency_win_1st,         -- 想定: 50000（変更しない）
       fee_agency_win_2nd          -- 想定: 70000（変更しない）
  FROM ag_config WHERE key = 'main';

-- === STEP 2: 更新（途中失敗時は自動ロールバック＝半端な状態を作らない）========
BEGIN;
  UPDATE ag_config
     SET fee_agency_weekly        = 1000,   -- 1応募につき1,000円
         fee_enduser_monthly_bonus = 0,     -- 月間コンプリートボーナス廃止
         cap_enduser_monthly      = 6000    -- 1,000円×最大6週。切り捨て防止の保険値
   WHERE key = 'main';

  -- 列DEFAULTも新値へ（新規行・再作成時の既定を揃える。既存行は書き換えない）
  ALTER TABLE ag_config ALTER COLUMN fee_agency_weekly         SET DEFAULT 1000;
  ALTER TABLE ag_config ALTER COLUMN fee_enduser_monthly_bonus SET DEFAULT 0;
  ALTER TABLE ag_config ALTER COLUMN cap_enduser_monthly       SET DEFAULT 6000;
COMMIT;

-- === STEP 3: 事後確認（1000 / 0 / 6000 になっていればOK）=====================
SELECT fee_agency_weekly, fee_enduser_monthly_bonus, cap_enduser_monthly
  FROM ag_config WHERE key = 'main';

-- === STEP 4: ★管理画面タブのハードリロード（これを飛ばすと巻き戻ります）======
--   管理画面は起動時に ag_config を読み込み、月・週セレクタを操作するたびに
--   その値をまるごと upsert で書き戻します。SQL実行前から開きっぱなしのタブが
--   あると、メモリ上の旧値（2000 / 1000 / 5000）で上書きされ、この更新が
--   無音で取り消されます（画面には何も表示されません）。
--   → 開いている管理画面タブを全てハードリロードし、月または週のセレクタを1回動かしてから
--     STEP 3 のSELECTをもう一度実行し、1000 / 0 / 6000 が維持されているか確認する。
--   ※ 動かすのは「既存の選択肢」の中だけにすること。
--     「＋月追加」「＋週追加」を選ぶと運用データに月・週が本当に増えてしまう
--     （登録月が1件しかない月セレクタは選択肢が「＋月追加」しか無いので、
--       その場合は週セレクタ側で既存の週を切り替えて確認する）。

-- ================================================================
-- ロールバック（元に戻す場合）
--   ★ STEP 1 で控えた実際の値に戻すこと。下記は想定値での例です。
-- BEGIN;
--   UPDATE ag_config
--      SET fee_agency_weekly        = 2000,  -- ← STEP 1 で控えた値に置き換える
--          fee_enduser_monthly_bonus = 1000, -- ← 同上
--          cap_enduser_monthly      = 5000   -- ← 同上
--    WHERE key = 'main';
--   ALTER TABLE ag_config ALTER COLUMN fee_agency_weekly         SET DEFAULT 2000;
--   ALTER TABLE ag_config ALTER COLUMN fee_enduser_monthly_bonus SET DEFAULT 1000;
--   ALTER TABLE ag_config ALTER COLUMN cap_enduser_monthly       SET DEFAULT 5000;
-- COMMIT;
--   ※ ファイル側（ag_calc.js / index.html / ag_schema.sql）も git で戻すこと。
-- ================================================================
