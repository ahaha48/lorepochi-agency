-- ================================================================
-- ロレポチ代理店版 6店舗化マイグレーション（必要店舗数 5 → 6、2026-10-21(水)の週から）
--
--   背景: ロレックス抽選の応募店舗に「三越日本橋」が加わり、今週から 6 店舗になった。
--   週次の達成条件「抽選 N 店舗以上 ＆ 結果SS✓」の N を、適用開始週以降だけ 6 にする。
--
--   ★ 過去の週は従来どおり 5 店舗で判定される（遡及しない）。
--     ag_config.required_stores（=5）はそのまま残し、新しい列で「6 を使い始める週」を持つ:
--       required_stores_v2            … 適用開始週以降の必要店舗数（6）
--       required_stores_v2_from_month … 適用開始の月
--       required_stores_v2_from_week  … 適用開始の週
--     計算エンジン（ag_calc.js: requiredStores）は (from_month, from_week) 以降の週だけ v2 を使う。
--     from_month / from_week が NULL の間は全期間 5 のまま（＝このSQLを流す前と同じ）。
--
-- ★ 本番1期生ロレポチ(app_config/members 等)・ロレクエ(lq_) には無影響。
--   ag_config の列追加と key='main' 1行の UPDATE のみ（DROP/DELETE なし）。
-- ★ 新しい index.html / ag_calc.js は、このSQLを流す前に公開されていても壊れない
--   （CFG_DEFAULT に新しい列を持たせていないため、月・週の保存は従来どおり動く）。
--   ただし 6 店舗判定が効き始めるのは、このSQLで列と値が入ってから。
-- 適用日: 2026-10-21
-- ================================================================

-- === STEP 1: 事前確認（★実行して結果を控える）====================================
--   管理画面で「今の週」が、6店舗になる最初の週（2026-10-21(水)の週）を指していることを確認する。
--   1期生ツールと同じ数え方（その月の第N水曜）なら 10月 第3週。
SELECT cur_month, cur_week, required_stores, weeks_per_month FROM ag_config WHERE key = 'main';
--   ↑ 確認すること:
--     ・weeks_per_month の "10" に 3 が含まれている（10月 第3週が登録済み）。無ければ先に管理画面で「第3週を追加」する
--     ・STEP 2 の UPDATE に書く月・週（既定 10 / 3）が、6店舗になる最初の週と一致している
--       ※ cur_month / cur_week が前の週のまま（例: 10 / 2）でも、STEP 2 は明示値を使うので影響しない

-- === STEP 2: 列追加＋適用開始週の設定（途中失敗時は自動ロールバック）===================
BEGIN;
  ALTER TABLE ag_config ADD COLUMN IF NOT EXISTS required_stores_v2            INTEGER DEFAULT 6;
  ALTER TABLE ag_config ADD COLUMN IF NOT EXISTS required_stores_v2_from_month INTEGER;
  ALTER TABLE ag_config ADD COLUMN IF NOT EXISTS required_stores_v2_from_week  INTEGER;
  -- 適用開始週 = 2026年10月 第3週（10/21(水)の週）。管理画面の週番号が違う数え方なら、ここを合わせてから実行する
  UPDATE ag_config
     SET required_stores_v2 = 6,
         required_stores_v2_from_month = 10,
         required_stores_v2_from_week  = 3
   WHERE key = 'main';
COMMIT;

--   代替: 管理画面で「今の週」を6店舗の最初の週に合わせてある状態なら、その週を開始週にすることもできる
--   （cur_week が前の週のままだと、その週の達成判定まで6店舗になってしまうので、必ず STEP 1 で確認してから）
--   UPDATE ag_config SET required_stores_v2 = 6, required_stores_v2_from_month = cur_month, required_stores_v2_from_week = cur_week WHERE key = 'main';

-- === STEP 3: 事後確認（required_stores=5, required_stores_v2=6, from が 10 / 3 であればOK）==========
SELECT required_stores, required_stores_v2, required_stores_v2_from_month, required_stores_v2_from_week
  FROM ag_config WHERE key = 'main';

-- === STEP 4: 開いている管理画面タブをハードリロード ==========================================
--   管理画面は起動時に ag_config を読み込む。リロード後、週次画面の「条件：抽選 N 店舗以上」が
--   適用開始週以降で 6、それより前の週で 5 と表示されれば反映済み。

-- ================================================================
-- ロールバック（計算を全期間 5 店舗に戻す。列は残しても無害なので消さない）
--   UPDATE ag_config SET required_stores_v2_from_month = NULL, required_stores_v2_from_week = NULL WHERE key = 'main';
--   ※ ファイル側（ag_calc.js / index.html / ag_schema.sql）も git で戻すこと。
--   ※ 列ごと消す場合（通常は不要）:
--     ALTER TABLE ag_config DROP COLUMN IF EXISTS required_stores_v2;
--     ALTER TABLE ag_config DROP COLUMN IF EXISTS required_stores_v2_from_month;
--     ALTER TABLE ag_config DROP COLUMN IF EXISTS required_stores_v2_from_week;
-- ================================================================
