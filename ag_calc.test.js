/* ロレポチ代理店版 計算エンジンの検証テスト（node ag_calc.test.js で実行）
 * 手計算した期待値と突き合わせる。特に:
 *  - 当選前の週の報酬が、後から当選が入っても消えないこと（R1修正の確認）
 *  - 途中当選週はフィーなし
 *  - 入店完了順で 1件目50,000 / 2件目70,000
 *  - v3: 月間コンプリートボーナス廃止（全週達成でも 0 円）
 *  - v3: 1応募につき エンド1,000円 / 代理店1,000円
 *  - 月上限が達成週ぶんの報酬を切り捨てないこと（最大6週=6,000円）
 *  - v4: 計上月は結果SS日の月（月末が火曜なら翌月1日も当月）
 *  - v4: 初月は達成回数分／2ヶ月目以降はコンプリートした月のみ支払い（未完了は0円・エンドも代理店も）
 *  - v4: 当選週以降はコンプリート判定の対象外／改定前の月は v3 のまま／null で全期間 v3
 *  - v4b: ③（初月/コンプリート）の適用開始は rule_v4_complete_from_month（既定10月）。
 *         DEFAULT_CONFIG を継承する cfg4 も暗黙に「③は10月から」で走る（既存の v4 テストは9月の未完了ケースを含まない）
 */
var C = require('./ag_calc.js');

var pass = 0, fail = 0;
function eq(actual, expected, label) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '\n      期待: ' + e + '\n      実際: ' + a); }
}

var cfg = C.DEFAULT_CONFIG;

// ---- 達成条件: 抽選>=必要店舗数 ＆ 結果SS✓（1タップ真偽）----
console.log('達成条件（抽選店舗数 ＆ 結果SS真偽）');
eq(C.conditionMet({ lottery_stores: 5, result_ss: true },  cfg), true,  '抽選5 ＆ 結果SS✓ → 達成');
eq(C.conditionMet({ lottery_stores: 5, result_ss: false }, cfg), false, '抽選5でも 結果SS✗ → 未達成');
eq(C.conditionMet({ lottery_stores: 3, result_ss: true },  cfg), false, '結果SS✓でも 抽選不足 → 未達成');

// ---- シナリオ1: 当選なし（基本の週次集計・v3でボーナスは常に0）----
console.log('シナリオ1: 当選なし');
var base = {
  agencies: [{ id: 1, name: 'A' }],
  endUsers: [{ id: 100, agency_id: 1 }, { id: 101, agency_id: 1 }],
  weeksPerMonth: { 1: [1, 2, 3, 4] },
  weekly: [
    // U100: 全週達成
    { month: 1, week: 1, end_user_id: 100, lottery_stores: 5, result_ss: true },
    { month: 1, week: 2, end_user_id: 100, lottery_stores: 5, result_ss: true },
    { month: 1, week: 3, end_user_id: 100, lottery_stores: 5, result_ss: true },
    { month: 1, week: 4, end_user_id: 100, lottery_stores: 5, result_ss: true },
    // U101: 第2週だけ抽選3店舗で未達成
    { month: 1, week: 1, end_user_id: 101, lottery_stores: 5, result_ss: true },
    { month: 1, week: 2, end_user_id: 101, lottery_stores: 3, result_ss: true },
    { month: 1, week: 3, end_user_id: 101, lottery_stores: 5, result_ss: true },
    { month: 1, week: 4, end_user_id: 101, lottery_stores: 5, result_ss: true },
  ],
  wins: [],
};

var p100 = C.endUserMonthlyParticipation(100, 1, base.weekly, base.wins, [1,2,3,4], cfg);
eq(p100.total, 4000, 'U100 参加報酬 = 1000×4 = 4000（v3: ボーナスなし）');
eq(p100.bonus, 0, '★v3: 全4週達成でも月間コンプリートボーナスは0');
var p101 = C.endUserMonthlyParticipation(101, 1, base.weekly, base.wins, [1,2,3,4], cfg);
eq(p101.total, 3000, 'U101 参加報酬 = 1000×3（第2週未達成）= 3000');
eq(p101.bonus, 0, 'U101 ボーナスなし（未達成週あり）');
eq(C.agencyMonthlyAppFee(100, 1, base.weekly, base.wins, cfg).total, 4000, 'U100 代理店応募フィー = 1000×4 = 4000');
eq(C.agencyMonthlyAppFee(101, 1, base.weekly, base.wins, cfg).total, 3000, 'U101 代理店応募フィー = 1000×3 = 3000');

var agg1 = C.aggregate(base, cfg);
eq(agg1.perAgency[1], { appFee: 7000, winFee: 0, total: 7000 }, '代理店A合計 = 4000+3000 = 7000（弊社→代理店の支払額）');

// ---- シナリオ1b: 月上限が達成週ぶんを切り捨てないこと（v3で上限6,000円）----
console.log('シナリオ1b: 月上限（6週ある月でも切り捨てない）');
var w6 = [1,2,3,4,5,6].map(function (wk) {
  return { month: 3, week: wk, end_user_id: 100, lottery_stores: 5, result_ss: true };
});
var p6 = C.endUserMonthlyParticipation(100, 3, w6, [], [1,2,3,4,5,6], cfg);
eq(p6.total, 6000, '6週すべて達成 = 1000×6 = 6000（上限で切り捨てられない）');
eq(C.agencyMonthlyAppFee(100, 3, w6, [], cfg).total, 6000, '代理店も 1000×6 = 6000（エンドと同額）');

// ---- シナリオ2: 途中当選 + 入店完了（R1修正の確認）----
console.log('シナリオ2: 途中当選 + 入店完了（過去の週報酬が消えないか）');
var s2 = JSON.parse(JSON.stringify(base));
s2.weeksPerMonth = { 1: [1,2,3,4], 2: [1,2,3,4] };
// U100が月2第1週で当選し入店完了、購入インセンティブ5000
s2.wins = [{ id: 1, end_user_id: 100, won_date: '20260210', shop: '銀座', month: 2, week: 1,
             store_entry_completed: true, store_entry_date: '20260215', purchase_incentive: 5000 }];
// 月2の週次（当選週）
s2.weekly.push({ month: 2, week: 1, end_user_id: 100, lottery_stores: 5, result_ss: true });

// ★R1: 当選が後から入っても、月1（当選前）の報酬は 4000 のまま消えない
var p100m1 = C.endUserMonthlyParticipation(100, 1, s2.weekly, s2.wins, [1,2,3,4], cfg);
eq(p100m1.total, 4000, '★R1: 当選後の再計算でも月1参加報酬は4000のまま（消えない）');
eq(C.agencyMonthlyAppFee(100, 1, s2.weekly, s2.wins, cfg).total, 4000, '★R1: 月1の代理店応募フィーも4000のまま');

// 途中当選週（月2第1週）はフィーなし
eq(C.feeApplies({ month: 2, week: 1, end_user_id: 100, lottery_stores: 5, result_ss: true }, s2.wins, cfg),
   false, '途中当選週はフィー発生しない');
var p100m2 = C.endUserMonthlyParticipation(100, 2, s2.weekly, s2.wins, [1,2,3,4], cfg);
eq(p100m2.total, 0, '月2（当選週のみ提出）参加報酬 = 0');

// 入店完了 → 当選報酬・当選者フィー
var cw = C.completedWins(100, s2.wins, cfg);
eq(cw.length, 1, '入店完了した当選は1件');
eq(cw[0].agencyFee, 50000, '1件目の代理店当選者フィー = 50,000');
eq(cw[0].endUserReward, 25000, 'エンド当選報酬 = 20,000 + インセンティブ5,000 = 25,000');
eq(cw[0].accountingMonth, 2, '会計月 = 入店完了日(20260215)の2月');

// ---- シナリオ3: 2本目当選（入店完了順で70,000）----
console.log('シナリオ3: 2本目当選（入店完了順で70,000）');
var s3 = JSON.parse(JSON.stringify(s2));
s3.wins.push({ id: 2, end_user_id: 100, won_date: '20260510', shop: '大阪', month: 5, week: 2,
               store_entry_completed: true, store_entry_date: '20260515', purchase_incentive: 3000 });
var cw3 = C.completedWins(100, s3.wins, cfg);
eq(cw3.length, 2, '入店完了2件');
eq(cw3[0].agencyFee, 50000, '入店完了1件目 = 50,000');
eq(cw3[1].agencyFee, 70000, '入店完了2件目 = 70,000');
eq(cw3[1].endUserReward, 23000, '2件目エンド報酬 = 20,000 + 3,000 = 23,000');

// 2本目フェーズ（当選後の週）は応募フィーなし
eq(C.feeApplies({ month: 3, week: 1, end_user_id: 100, lottery_stores: 5, result_ss: true }, s3.wins, cfg),
   false, '当選後（2本目フェーズ）の週は応募フィーなし');

// ---- シナリオ4: 制限（解除期間）----
console.log('シナリオ4: 制限（解除期間）180日');
var r1 = C.restriction(s2.wins[0], cfg, '20260708');
eq(r1.releaseDate, '20260814', '入店完了20260215 + 180日 = 20260814');
eq(r1.remaining, 37, '本日20260708からの残り日数 = 37');
eq(r1.soon, false, '7日以内ではない');
// まもなく解除（残り3日）になるケースを合成
var soonBase = C.fmtYMD(C.addDays(C.parseYMD('20260708'), 3 - cfg.restriction_days));
var r2 = C.restriction({ store_entry_completed: true, store_entry_date: soonBase, won_date: soonBase }, cfg, '20260708');
eq(r2.remaining, 3, '合成ケース: 残り3日');
eq(r2.soon, true, '残り7日以内 → まもなく解除 = true');

// ---- シナリオ5: 複数代理店にまたがる集計（ブローカー廃止・全員代理店直）----
console.log('シナリオ5: 複数代理店・全員代理店直の集計');
function metRow(m, wk, eu) { return { month: m, week: wk, end_user_id: eu, lottery_stores: 5, result_ss: true }; }
var s5 = {
  agencies: [{ id: 1, name: 'A' }, { id: 2, name: 'C' }],
  endUsers: [
    { id: 100, agency_id: 1 },   // 代理店A直
    { id: 200, agency_id: 1 },   // 代理店A直
    { id: 300, agency_id: 2 },   // 代理店C直
  ],
  weeksPerMonth: { 1: [1, 2, 3, 4] },
  weekly: [
    metRow(1,1,100), metRow(1,2,100), metRow(1,3,100), metRow(1,4,100),
    metRow(1,1,200), metRow(1,2,200), metRow(1,3,200), metRow(1,4,200),
    metRow(1,1,300), metRow(1,2,300), metRow(1,3,300), metRow(1,4,300),
  ],
  wins: [],
};
var agg5 = C.aggregate(s5, cfg);
// 各ユーザーの代理店応募フィー = 1000 × 4週 = 4000
eq(agg5.perAgency[1],  { appFee: 8000, winFee: 0, total: 8000 }, '代理店A = U100 + U200 = 8000');
eq(agg5.perAgency[2],  { appFee: 4000, winFee: 0, total: 4000 }, '代理店C = U300のみ = 4000');
eq(agg5.perAgency['null'], undefined, 'perAgency に "null" キーが作られない');
eq(agg5.perAgency['undefined'], undefined, 'perAgency に "undefined" キーが作られない');
eq(agg5.perEndUser[200].total, 4000, '代理店直U200 の参加報酬も通常どおり 4000');


// ================================================================
// v4: 結果SS日で計上・初月は回数分・2ヶ月目以降はコンプリート必須
// ================================================================
var cfg4 = Object.assign({}, C.DEFAULT_CONFIG, { rule_v4_from_month: 9 });
function v4Row(m, wk, eu, date, stores) {
  return { month: m, week: wk, end_user_id: eu, lottery_stores: (stores == null ? 5 : stores), result_ss: true, result_ss_date: date || null };
}
var W = [1,2,3,4];

console.log('v4-1: 計上月の判定（結果SS日・月末火曜の例外）');
eq(C.accountingMonthOfResult('20260924'), 9,  '9/24 → 9月分');
eq(C.accountingMonthOfResult('20261001'), 10, '2026-09-30は水曜 → 10/1の報告は10月分');
eq(C.accountingMonthOfResult('20260701'), 6,  '2026-06-30は火曜 → 7/1(水)の報告は6月分（例外）');
eq(C.accountingMonthOfResult('20260702'), 7,  '7/2 → 7月分（例外は1日だけ）');
eq(C.accountingMonthOfResult(''), null,       '空は null');
eq(C.rowAccountingMonth(v4Row(9,4,1,'20261006'), cfg4), 10, '9月第4週の応募でも結果SS日が10/6なら10月分');
eq(C.rowAccountingMonth(v4Row(9,1,1,null), cfg4), 9,        '結果SS日なし（旧データ）は入力月に計上');
eq(C.rowAccountingMonth(v4Row(8,4,1,'20260902'), cfg4), 8,  '改定前の月（8月）は結果SS日を無視して入力月');
eq(C.v4Applies(8, cfg4), false, '8月は v3');
eq(C.v4Applies(9, cfg4), true,  '9月から v4');
eq(C.v4Applies(9, Object.assign({}, cfg4, { rule_v4_from_month: null })), false, 'rule_v4_from_month=null なら全期間 v3');

console.log('v4-2: 初月は達成回数分を支払う（月途中参加OK）');
var u500 = { id: 500, agency_id: 1 };
var rows2 = [ v4Row(9,3,500,'20260929'), v4Row(9,4,500,'20261006') ];   // 9月第3週から参加。第4週の結果は10/6に報告
var p92 = C.endUserMonthlyParticipation(500, 9, rows2, [], W, cfg4, u500);
eq(p92.isFirstMonth, true, '9月が初月（自動判定）');
eq(p92.feeWeeks, 1,        '9月分のカウント = 1（第4週の結果は10月分に繰り越し）');
eq(p92.total, 1000,        '初月は未完了でも 1000×1 = 1000');
eq(C.agencyMonthlyAppFee(500, 9, rows2, [], cfg4, W, u500).total, 1000, '代理店応募フィーも 1000');
eq(C.firstMonthOf(500, rows2, u500), 9, '参加月の自動判定 = 9');

console.log('v4-3: 2ヶ月目コンプリート → 支払い／未完了 → 0円（回数は保持）');
var rows3 = rows2.concat([ v4Row(10,1,500,'20261013'), v4Row(10,2,500,'20261020'), v4Row(10,3,500,'20261027'), v4Row(10,4,500,'20261103') ]);
var p10 = C.endUserMonthlyParticipation(500, 10, rows3, [], W, cfg4, u500);
eq(p10.isFirstMonth, false, '10月は2ヶ月目');
eq(p10.complete, true,      '10月は全4週達成 → コンプリート');
eq(p10.feeWeeks, 4,         '10月分カウント = 9月第4週(10/6) + 10月第1〜3週 = 4');
eq(p10.total, 4000,         '10月 = 1000×4 = 4000');
eq(C.agencyMonthlyAppFee(500, 10, rows3, [], cfg4, W, u500).total, 4000, '代理店も 4000');
var p11 = C.endUserMonthlyParticipation(500, 11, rows3, [], W, cfg4, u500);
eq(p11.feeWeeks, 1,     '11月分カウント = 10月第4週(11/3報告) の1回');
eq(p11.complete, false, '11月は未完了（11月の応募が無い）');
eq(p11.total, 0,        '未完了の月は 0 円（11月を完了すれば 1000 になる）');
var rows3b = rows3.filter(function (r) { return !(r.month === 10 && r.week === 2); });   // 10月第2週を抜く
var p10b = C.endUserMonthlyParticipation(500, 10, rows3b, [], W, cfg4, u500);
eq(p10b.complete, false, '10月第2週が抜けると未完了');
eq(p10b.feeWeeks, 3,     '回数は 3 として保持（表示用）');
eq(p10b.total, 0,        '★未完了月はエンド 0 円');
eq(C.agencyMonthlyAppFee(500, 10, rows3b, [], cfg4, W, u500).total, 0, '★未完了月は代理店も 0 円');
var rows3c = rows3b.concat([ v4Row(10,2,500,'20261020',3) ]);   // 第2週を3店舗（未達成）で戻す
eq(C.endUserMonthlyParticipation(500, 10, rows3c, [], W, cfg4, u500).total, 0, '第2週が3店舗（未達成）でも未完了 → 0 円');

console.log('v4-4: 途中当選（当選週以降はコンプリート判定の対象外）');
var u600 = { id: 600, agency_id: 1 };
var rows4 = [ v4Row(8,1,600,null), v4Row(8,3,600,null),                          // 8月（v3・旧データ）
              v4Row(10,1,600,'20261013'), v4Row(10,2,600,'20261020') ];          // 10月は第2週まで
var wins4 = [{ id: 9, end_user_id: 600, won_date: '20261021', shop: '銀座並木通り', month: 10, week: 3, store_entry_completed: false }];
var p4 = C.endUserMonthlyParticipation(600, 10, rows4, wins4, W, cfg4, u600);
eq(p4.isFirstMonth, false, '初月は8月なので10月は2ヶ月目以降');
eq(p4.complete, true,      '第3週で当選 → 第3・4週は判定対象外 → コンプリート扱い');
eq(p4.total, 2000,         '当選前の2回分 = 2000 を支払う');
eq(C.endUserMonthlyParticipation(600, 10, rows4.concat([v4Row(10,3,600,'20261027')]), wins4, W, cfg4, u600).feeWeeks, 2, '当選週の行はカウントしない');

console.log('v4-5: 改定前の月は旧ルール（未完了でも達成分を支払う）');
var p8 = C.endUserMonthlyParticipation(600, 8, rows4, [], W, cfg4, u600);
eq(p8.v4, false,   '8月は v3 判定');
eq(p8.total, 2000, '8月は第1・3週だけでも 1000×2 = 2000（コンプリート条件なし）');
eq(C.agencyMonthlyAppFee(600, 8, rows4, [], cfg4, W, u600).total, 2000, '代理店も 2000');

console.log('v4-6: rule_v4_from_month=null なら未完了月も従来どおり支払う（ロールバック）');
var cfgNull = Object.assign({}, cfg4, { rule_v4_from_month: null });
eq(C.endUserMonthlyParticipation(500, 10, rows3b, [], W, cfgNull, u500).total, 3000, 'v3: 10月は達成3週 = 3000');
eq(C.endUserMonthlyParticipation(500, 9, rows3b, [], W, cfgNull, u500).total, 2000,  'v3: 結果SS日を無視して9月は2週 = 2000');

console.log('v4-7: 参加月の手動指定（start_month）');
var u700 = { id: 700, agency_id: 1 };
var rows7 = [ v4Row(9,1,700,'20260908'), v4Row(9,2,700,'20260915'), v4Row(9,3,700,'20260922'), v4Row(9,4,700,'20261006'),
              v4Row(10,1,700,'20261013'), v4Row(10,2,700,'20261020') ];
eq(C.endUserMonthlyParticipation(700, 10, rows7, [], W, cfg4, u700).total, 0, '自動判定（初月9月）→ 10月は未完了 = 0');
var u700b = Object.assign({}, u700, { start_month: 10 });
var p7 = C.endUserMonthlyParticipation(700, 10, rows7, [], W, cfg4, u700b);
eq(p7.isFirstMonth, true, 'start_month=10 → 10月を初月として扱う');
eq(p7.total, 3000,        '初月 = 9月第4週の繰越 + 10月第1・2週 = 3000');
eq(C.endUserMonthlyParticipation(700, 9, rows7, [], W, cfg4, u700b).total, 3000, 'start_month より前の月も初月扱い（回数分を支払う）');

console.log('v4-8: aggregate が結果SS日で繰り越した月を落とさない');
var s8 = {
  agencies: [{ id: 1, name: 'TMサロン' }],
  endUsers: [u500],
  weeksPerMonth: { 9: [1,2,3,4], 10: [1,2,3,4] },   // 11月はまだ未登録
  weekly: rows3, wins: [],
};
eq(C.accountingMonthsOf(rows3, cfg4), [9,10,11], '計上月一覧 = 9,10,11（11月は繰り越し先）');
var agg8 = C.aggregate(s8, cfg4);
eq(agg8.perEndUser[500].participation, 5000, '9月1000 + 10月4000 + 11月0（未完了）= 5000');
eq(agg8.perAgency[1], { appFee: 5000, winFee: 0, total: 5000 }, '代理店TMサロン = 5000');
var s8b = Object.assign({}, s8, { weeksPerMonth: { 9: [1,2,3,4], 10: [1,2,3,4], 11: [1,2,3,4] },
  weekly: rows3.concat([ v4Row(11,1,500,'20261110'), v4Row(11,2,500,'20261117'), v4Row(11,3,500,'20261124'), v4Row(11,4,500,'20261201') ]) });
eq(C.aggregate(s8b, cfg4).perEndUser[500].participation, 9000, '11月をコンプリートすると 10月第4週分＋11月第1〜3週 = 4000 が加わり 9000');

console.log('v4-9: ③（初月/コンプリート条件）の適用開始月を分離（②は9月から、③は10月から）');
var cfg4b = Object.assign({}, cfg4, { rule_v4_from_month: 9, rule_v4_complete_from_month: 10 });
var u800 = { id: 800, agency_id: 1 };
// 初月は7月（8月以前は v3 なので結果SS日は無視される）。9月は3/4週だけ達成
var rows9 = [ v4Row(7,1,800,null), v4Row(8,1,800,null),
              v4Row(9,1,800,'20260908'), v4Row(9,2,800,'20260915'), v4Row(9,3,800,'20260922') ];
var p9b = C.endUserMonthlyParticipation(800, 9, rows9, [], W, cfg4b, u800);
eq(C.completeRuleApplies(9, cfg4b), false, '9月は③の対象外');
eq(C.completeRuleApplies(10, cfg4b), true, '10月から③を適用');
eq(p9b.isFirstMonth, false, '初月は7月なので9月は2ヶ月目以降');
eq(p9b.complete, false,     '9月は3/4週で未完了');
eq(p9b.completeRule, false, '9月には③が適用されない');
eq(p9b.total, 3000,         '★9月は未完了でも回数分 1000×3 = 3000');
eq(C.agencyMonthlyAppFee(800, 9, rows9, [], cfg4b, W, u800).total, 3000, '★代理店も回数分 3000');
// 9月に6回計上 → エンドは月上限 6000、代理店は上限なし
var rows9x = rows9.concat([ v4Row(9,4,800,'20260929'), v4Row(9,5,800,'20260930'), v4Row(9,6,800,'20260930') ]);
eq(C.endUserMonthlyParticipation(800, 9, rows9x, [], [1,2,3,4,5,6], cfg4b, u800).total, 6000, '9月6回はエンド上限 6000');
eq(C.agencyMonthlyAppFee(800, 9, rows9x, [], cfg4b, [1,2,3,4,5,6], u800).total, 6000, '代理店は 6000');
// 10月: 第1〜3週のみ達成 → 未完了 → 0円
var rows10 = rows9.concat([ v4Row(10,1,800,'20261013'), v4Row(10,2,800,'20261020'), v4Row(10,3,800,'20261027') ]);
var p10b = C.endUserMonthlyParticipation(800, 10, rows10, [], W, cfg4b, u800);
eq(p10b.completeRule, true, '10月は③の対象');
eq(p10b.feeWeeks, 3,        '10月分カウント = 3');
eq(p10b.complete, false,    '10月は第4週が未達成 → 未完了');
eq(p10b.total, 0,           '★10月は未完了なので 0 円');
eq(C.agencyMonthlyAppFee(800, 10, rows10, [], cfg4b, W, u800).total, 0, '★代理店も 0 円');
// 10月第4週も達成（結果は11/3 → 11月分に計上）→ 10月はコンプリートだが計上は3回
var rows10c = rows10.concat([ v4Row(10,4,800,'20261103') ]);
var p10c = C.endUserMonthlyParticipation(800, 10, rows10c, [], W, cfg4b, u800);
eq(p10c.complete, true, '10月は全4週達成 → コンプリート');
eq(p10c.feeWeeks, 3,    '10月分カウントは第1〜3週の3回（第4週は11/3報告で11月分）');
eq(p10c.total, 3000,    '10月コンプリート → 1000×3 = 3000');
// 9月第4週の結果SS日が10/6 → 10月分に計上され、10月のコンプリート次第
var rows9c = rows9.concat([ v4Row(9,4,800,'20261006') ]);
eq(C.endUserMonthlyParticipation(800, 9, rows9c, [], W, cfg4b, u800).total, 3000, '9月第4週(10/6報告)は9月分に入らない → 9月は3000のまま');
var rows10d = rows9c.concat([ v4Row(10,1,800,'20261013'), v4Row(10,2,800,'20261020') ]);
eq(C.endUserMonthlyParticipation(800, 10, rows10d, [], W, cfg4b, u800).total, 0, '9月第4週の繰越があっても10月が未完了なら 0 円');
var rows10e = rows10d.concat([ v4Row(10,3,800,'20261027'), v4Row(10,4,800,'20261103') ]);
var p10e = C.endUserMonthlyParticipation(800, 10, rows10e, [], W, cfg4b, u800);
eq(p10e.feeWeeks, 4, '10月分カウント = 9月第4週(10/6) + 10月第1〜3週 = 4');
eq(p10e.total, 4000, '10月コンプリート → 4000');
// 10月から参加した人は10月が初月 → 未完了でも回数分
var u801 = { id: 801, agency_id: 1 };
var rows801 = [ v4Row(10,2,801,'20261020'), v4Row(10,3,801,'20261027') ];
var p801 = C.endUserMonthlyParticipation(801, 10, rows801, [], W, cfg4b, u801);
eq(p801.isFirstMonth, true, '10月参加なら10月が初月');
eq(p801.total, 2000,        '初月は未完了でも回数分 2000');
// rule_v4_complete_from_month = null → ③を全期間オフ（②は生きている）
var cfgNull = Object.assign({}, cfg4b, { rule_v4_complete_from_month: null });
eq(C.completeRuleApplies(10, cfgNull), false, 'null なら10月も③オフ');
eq(C.endUserMonthlyParticipation(800, 10, rows10, [], W, cfgNull, u800).total, 3000, 'null: 10月3/4週でも回数分 3000');
eq(C.rowAccountingMonth(v4Row(9,4,800,'20261006'), cfgNull), 10, 'null でも②（結果SS日で計上）は有効');
// キー未設定（undefined）→ rule_v4_from_month と同じ月から③（旧挙動）
var cfgU = Object.assign({}, cfg4b); delete cfgU.rule_v4_complete_from_month;
eq(C.completeRuleApplies(9, cfgU), true, 'キー未設定なら9月から③（従来どおり）');
eq(C.endUserMonthlyParticipation(800, 9, rows9, [], W, cfgU, u800).total, 0, 'キー未設定: 9月3/4週は 0 円（従来どおり）');
eq(C.completeRuleApplies(10, Object.assign({}, cfg4b, { rule_v4_from_month: null })), false, 'rule_v4_from_month=null なら③もオフ');
// 集計（aggregate）でも 9月は回数分、10月はコンプリート次第
var s9 = { agencies: [{ id: 1, name: 'TMサロン' }], endUsers: [u800],
           weeksPerMonth: { 7:[1,2,3,4], 8:[1,2,3,4], 9:[1,2,3,4], 10:[1,2,3,4] }, weekly: rows10, wins: [] };
eq(C.aggregate(s9, cfg4b).perEndUser[800].participation, 5000, '7月1000 + 8月1000 + 9月3000 + 10月0（未完了）= 5000');
eq(C.aggregate(s9, cfgNull).perEndUser[800].participation, 8000, 'null（③オフ）なら 10月も3000 が加わり 8000');

console.log('\n結果: ' + pass + ' 件成功 / ' + fail + ' 件失敗');
process.exit(fail === 0 ? 0 : 1);
