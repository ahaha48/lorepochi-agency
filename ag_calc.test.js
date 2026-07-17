/* ロレポチ代理店版 計算エンジンの検証テスト（node ag_calc.test.js で実行）
 * 手計算した期待値と突き合わせる。特に:
 *  - 当選前の週の報酬が、後から当選が入っても消えないこと（R1修正の確認）
 *  - 途中当選週はフィーなし
 *  - 入店完了順で 1件目50,000 / 2件目70,000
 *  - 月間ボーナスと5,000円上限
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

// ---- シナリオ1: 当選なし（基本の週次・ボーナス集計）----
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
eq(p100.total, 5000, 'U100 参加報酬 = 1000×4 + ボーナス1000 = 5000');
eq(p100.bonus, 1000, 'U100 ボーナス発生');
var p101 = C.endUserMonthlyParticipation(101, 1, base.weekly, base.wins, [1,2,3,4], cfg);
eq(p101.total, 3000, 'U101 参加報酬 = 1000×3（第2週未達成）、ボーナスなし = 3000');
eq(p101.bonus, 0, 'U101 ボーナスなし（全週達成でない）');
eq(C.agencyMonthlyAppFee(100, 1, base.weekly, base.wins, cfg).total, 8000, 'U100 代理店応募フィー = 2000×4 = 8000');
eq(C.agencyMonthlyAppFee(101, 1, base.weekly, base.wins, cfg).total, 6000, 'U101 代理店応募フィー = 2000×3 = 6000');

var agg1 = C.aggregate(base, cfg);
eq(agg1.perAgency[1], { appFee: 14000, winFee: 0, total: 14000 }, '代理店A合計 = 8000+6000 = 14000（弊社→代理店の支払額）');

// ---- シナリオ2: 途中当選 + 入店完了（R1修正の確認）----
console.log('シナリオ2: 途中当選 + 入店完了（過去の週報酬が消えないか）');
var s2 = JSON.parse(JSON.stringify(base));
s2.weeksPerMonth = { 1: [1,2,3,4], 2: [1,2,3,4] };
// U100が月2第1週で当選し入店完了、購入インセンティブ5000
s2.wins = [{ id: 1, end_user_id: 100, won_date: '20260210', shop: '銀座', month: 2, week: 1,
             store_entry_completed: true, store_entry_date: '20260215', purchase_incentive: 5000 }];
// 月2の週次（当選週）
s2.weekly.push({ month: 2, week: 1, end_user_id: 100, lottery_stores: 5, result_ss: true });

// ★R1: 当選が後から入っても、月1（当選前）の報酬は 5000 のまま消えない
var p100m1 = C.endUserMonthlyParticipation(100, 1, s2.weekly, s2.wins, [1,2,3,4], cfg);
eq(p100m1.total, 5000, '★R1: 当選後の再計算でも月1参加報酬は5000のまま（消えない）');
eq(C.agencyMonthlyAppFee(100, 1, s2.weekly, s2.wins, cfg).total, 8000, '★R1: 月1の代理店応募フィーも8000のまま');

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
// 各ユーザーの代理店応募フィー = 2000 × 4週 = 8000
eq(agg5.perAgency[1],  { appFee: 16000, winFee: 0, total: 16000 }, '代理店A = U100 + U200 = 16000');
eq(agg5.perAgency[2],  { appFee: 8000, winFee: 0, total: 8000 }, '代理店C = U300のみ = 8000');
eq(agg5.perAgency['null'], undefined, 'perAgency に "null" キーが作られない');
eq(agg5.perAgency['undefined'], undefined, 'perAgency に "undefined" キーが作られない');
eq(agg5.perEndUser[200].total, 5000, '代理店直U200 の参加報酬も通常どおり 5000');

console.log('\n結果: ' + pass + ' 件成功 / ' + fail + ' 件失敗');
process.exit(fail === 0 ? 0 : 1);
