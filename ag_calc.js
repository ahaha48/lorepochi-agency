/* ================================================================
 * ロレポチ代理店版 報酬計算エンジン（純関数・ブラウザ/Node 両対応）
 *
 * 設計の要点（レビュー反映済み）:
 *  - 金額・日数は config で一元化（DEFAULT_CONFIG）
 *  - 当選は ag_wins を正データとする。「当選回数カウンタ」は使わない
 *  - 応募フィーは「その週までに当選があるか」の“時点判定”
 *      → 何度再計算しても過去の金額がブレない（当選前の週の1,000円が消えない）
 *  - 3つのトリガを分離:
 *      応募フィー停止 = 当選日(won_date)
 *      支払確定       = 入店完了(store_entry_completed)
 *      180日制限起算  = 入店完了日(なければ当選日)
 *  - 当選者フィーは「入店完了した順」で 1件目=50,000 / 2件目以降=70,000
 *  - 未確定当選（入店未完了）は保留。支払いには含めない
 *
 * v3改定（月間コンプリートボーナス廃止・代理店応募フィー1,000円）:
 *  - 1応募（必要店舗数すべてに応募＋結果SS確認）につき、エンド1,000円／代理店1,000円
 *  - 月間コンプリートボーナスは廃止（fee_enduser_monthly_bonus = 0）
 *  - 当選まわり（1件目50,000／2件目以降70,000／エンド20,000＋インセンティブ）は変更なし
 *
 * v4改定（rule_v4_from_month 以降の月に適用。null なら v3 のまま＝ロールバック用）:
 *  - 1カウント = 応募完了SS5枚（lottery_stores >= required_stores）＋ 結果SS5枚（result_ss）
 *  - カウントの計上月は「結果SS5枚を送った日（result_ss_date）」の月
 *      月末が火曜日の場合は、翌月1日（水曜）の報告も当月扱い
 *      result_ss_date が無い旧データは入力月（row.month）に計上
 *  - 初月（参加月）は達成回数×単価をそのまま支払う（月途中参加OK）
 *  - 2ヶ月目以降は「その月の応募分をすべてやりきる（コンプリート）」が支払条件
 *      未完了の月は 0 円（エンド・代理店とも。回数は保持して表示用に返す）
 *      コンプリート判定 = その月の全週で条件達成（当選週以降は判定対象外）
 *  - 参加月は start_month（手動指定）＞ 週次入力で活動があった最初の月（自動）
 *  - 単価はエンド1,000円／代理店1,000円のまま。当選まわりも変更なし
 *
 * v4b（③の適用開始月を②から分離）:
 *  - ②「結果SS日で計上」は rule_v4_from_month（9月）から
 *  - ③「初月は回数分／2ヶ月目以降はコンプリート必須」は rule_v4_complete_from_month（10月）から
 *      ②だけ適用の月（9月）は、計上カウント×単価をそのまま支払う（コンプリート条件なし）
 *      null で③を全期間オフ。キー未設定（undefined）なら rule_v4_from_month と同じ月から③を適用
 * ================================================================ */
(function (global) {
  'use strict';

  var DEFAULT_CONFIG = {
    required_stores: 5,
    fee_enduser_weekly: 1000,
    fee_enduser_monthly_bonus: 0,   // v3: 月間コンプリートボーナスは廃止
    cap_enduser_monthly: 6000,      // v3: 1,000円×最大6週分。上限で切り捨てないための保険値
    reward_enduser_win: 20000,
    fee_agency_weekly: 1000,        // v3: 1応募につき1,000円（旧2,000）
    fee_agency_win_1st: 50000,
    fee_agency_win_2nd: 70000, // 入店完了2件目以降（3件目以降も暫定同額。将来ルール要確認）
    restriction_days: 180,
    rule_v4_from_month: 9,          // v4: この月以降に「結果SS日で計上」(②) を適用。null で v4 全体を無効
    rule_v4_complete_from_month: 10, // v4b: この月以降に「初月は回数分／2ヶ月目以降はコンプリート必須」(③) を適用。null で③をオフ
  };

  // (aM,aW) <= (bM,bW)
  function weekLE(aM, aW, bM, bW) { return aM < bM || (aM === bM && aW <= bW); }

  function conditionMet(row, cfg) {
    // 抽選は「必要店舗数以上」、結果は「結果SS確認（1タップ・真偽）」で達成
    return (row.lottery_stores || 0) >= cfg.required_stores &&
           row.result_ss === true;
  }

  // そのエンドユーザーに (month,week) 以前（当該週含む）の当選があるか
  function hasWinByWeek(wins, endUserId, month, week) {
    return wins.some(function (w) {
      return w.end_user_id === endUserId && w.won_date &&
             weekLE(w.month, w.week, month, week);
    });
  }

  // 応募フィーが発生する週か（条件達成 かつ 1本目フェーズ＝当該週までに当選なし）
  function feeApplies(row, wins, cfg) {
    return conditionMet(row, cfg) &&
           !hasWinByWeek(wins, row.end_user_id, row.month, row.week);
  }

  // --- 日付ユーティリティ（YYYYMMDD, UTCで日付境界を統一）---
  function parseYMD(s) {
    if (!s || String(s).length < 8) return null;
    s = String(s);
    return new Date(Date.UTC(+s.slice(0,4), +s.slice(4,6) - 1, +s.slice(6,8)));
  }
  function addDays(date, days) {
    var d = new Date(date.getTime()); d.setUTCDate(d.getUTCDate() + days); return d;
  }
  function fmtYMD(date) {
    return '' + date.getUTCFullYear() +
      String(date.getUTCMonth() + 1).padStart(2, '0') +
      String(date.getUTCDate()).padStart(2, '0');
  }
  function daysBetween(a, b) { return Math.round((b.getTime() - a.getTime()) / 86400000); }
  function calMonth(ymd) { return ymd ? +String(ymd).slice(4,6) : null; }

  // ---------------------------------------------------------------
  // v4: 計上月・初月・コンプリート判定
  // ---------------------------------------------------------------

  // その月に v4 ルールを適用するか（入力月 row.month で判定する）
  function v4Applies(month, cfg) {
    return cfg.rule_v4_from_month != null && month >= cfg.rule_v4_from_month;
  }

  // ③（初月は回数分／2ヶ月目以降はコンプリート必須）をその月に適用するか。
  // ②が適用されている月のうち rule_v4_complete_from_month 以降。null なら全期間オフ。
  // キー未設定（undefined）なら rule_v4_from_month と同じ月から（旧挙動）
  function completeRuleApplies(month, cfg) {
    if (!v4Applies(month, cfg)) return false;
    var from = (cfg.rule_v4_complete_from_month === undefined) ? cfg.rule_v4_from_month : cfg.rule_v4_complete_from_month;
    return from != null && month >= from;
  }

  // 結果SS日 → 計上月。月末が火曜日なら、翌月1日（水曜）の報告は前月扱い
  function accountingMonthOfResult(ymd) {
    var d = parseYMD(ymd);
    if (!d) return null;
    if (d.getUTCDate() === 1) {
      var prev = addDays(d, -1);
      if (prev.getUTCDay() === 2) return prev.getUTCMonth() + 1;   // 2 = 火曜
    }
    return d.getUTCMonth() + 1;
  }

  // 週次行の計上月。v4適用月で結果SS日があればその日付の月、なければ入力月
  function rowAccountingMonth(row, cfg) {
    if (v4Applies(row.month, cfg) && row.result_ss_date) {
      var m = accountingMonthOfResult(row.result_ss_date);
      if (m != null) return m;
    }
    return row.month;
  }

  // 何らかの入力（応募 or 結果SS）がある行か（参加月の自動判定に使う）
  function hasActivity(row) { return (row.lottery_stores || 0) > 0 || row.result_ss === true; }

  // 参加月（初月）。start_month の手動指定が最優先。なければ活動があった最初の入力月。活動なしは null
  function firstMonthOf(endUserId, weeklyRows, endUser) {
    if (endUser && endUser.start_month != null && endUser.start_month !== '') return +endUser.start_month;
    var fm = null;
    weeklyRows.forEach(function (r) {
      if (r.end_user_id === endUserId && hasActivity(r) && (fm == null || r.month < fm)) fm = r.month;
    });
    return fm;
  }

  // その月に計上されるカウント行（達成 かつ 1本目フェーズ かつ 計上月一致）
  function monthlyCountRows(endUserId, month, weeklyRows, wins, cfg) {
    return weeklyRows.filter(function (r) {
      return r.end_user_id === endUserId && feeApplies(r, wins, cfg) &&
             rowAccountingMonth(r, cfg) === month;
    });
  }

  // コンプリート = その月の全週で条件達成。当選週以降の週は判定対象外（応募フィー自体が止まるため）
  // 週リストが無い月（設定未登録）は判定できないので未完了扱い
  function isMonthComplete(endUserId, month, weeklyRows, wins, weeksOfMonth, cfg) {
    if (!weeksOfMonth || !weeksOfMonth.length) return false;
    var rows = weeklyRows.filter(function (r) { return r.end_user_id === endUserId && r.month === month; });
    return weeksOfMonth.every(function (wk) {
      if (hasWinByWeek(wins, endUserId, month, wk)) return true;
      var r = rows.find(function (x) { return x.week === wk; });
      return !!r && conditionMet(r, cfg);
    });
  }

  // v4 の月次状態（エンド・代理店で共通）
  function monthlyStatus(endUserId, month, weeklyRows, wins, weeksOfMonth, cfg, endUser) {
    var rows = monthlyCountRows(endUserId, month, weeklyRows, wins, cfg);
    var fm = firstMonthOf(endUserId, weeklyRows, endUser);
    var isFirst = fm == null || month <= fm;
    var complete = isFirst ? true : isMonthComplete(endUserId, month, weeklyRows, wins, weeksOfMonth, cfg);
    // ③がまだ適用されない月（9月分）は、未完了でも計上カウント分をそのまま支払う
    var useComplete = completeRuleApplies(month, cfg);
    return { count: rows.length, rows: rows, firstMonth: fm, isFirstMonth: isFirst,
             complete: complete, completeRule: useComplete, payable: !useComplete || isFirst || complete };
  }

  // 週次入力から計上されうる月の一覧（昇順）。結果SS日で翌月に繰り越された月も含む
  function accountingMonthsOf(weeklyRows, cfg) {
    var s = {};
    weeklyRows.forEach(function (r) { if (hasActivity(r)) s[rowAccountingMonth(r, cfg)] = true; });
    return Object.keys(s).map(Number).sort(function (a, b) { return a - b; });
  }

  // ---------------------------------------------------------------
  // 月次集計
  // ---------------------------------------------------------------

  // エンドユーザーの、ある月の参加報酬
  //   v3: 週次1,000円×達成週（ボーナスは廃止＝常に0）
  //   v4: 1,000円×計上カウント。初月はそのまま、2ヶ月目以降はコンプリートした月のみ支払い
  function endUserMonthlyParticipation(endUserId, month, weeklyRows, wins, weeksOfMonth, cfg, endUser) {
    if (v4Applies(month, cfg)) {
      var st = monthlyStatus(endUserId, month, weeklyRows, wins, weeksOfMonth, cfg, endUser);
      var sum = st.count * cfg.fee_enduser_weekly;
      return {
        weekly: sum, bonus: 0, feeWeeks: st.count, v4: true,
        firstMonth: st.firstMonth, isFirstMonth: st.isFirstMonth, complete: st.complete, completeRule: st.completeRule, payable: st.payable,
        total: st.payable ? Math.min(sum, cfg.cap_enduser_monthly) : 0
      };
    }
    var rows = weeklyRows.filter(function (r) { return r.end_user_id === endUserId && r.month === month; });
    var feeWeeks = rows.filter(function (r) { return feeApplies(r, wins, cfg); });
    var weeklySum = feeWeeks.length * cfg.fee_enduser_weekly;
    // ボーナス: 当月の全週すべて条件達成 かつ 当月末まで1本目フェーズ
    //   ※ v3で fee_enduser_monthly_bonus = 0 になったため、現行ルールでは常に0円。
    //     ルールが戻る可能性を考えて判定ロジック自体は残してある（金額はconfig側で制御）。
    var allMet = (weeksOfMonth && weeksOfMonth.length > 0) && weeksOfMonth.every(function (wk) {
      var r = rows.find(function (x) { return x.week === wk; });
      return r && conditionMet(r, cfg);
    });
    var lastWeek = (weeksOfMonth && weeksOfMonth.length) ? Math.max.apply(null, weeksOfMonth) : 0;
    var firstPhaseAllMonth = !hasWinByWeek(wins, endUserId, month, lastWeek);
    var bonus = (allMet && firstPhaseAllMonth) ? cfg.fee_enduser_monthly_bonus : 0;
    return {
      weekly: weeklySum, bonus: bonus, feeWeeks: feeWeeks.length, v4: false, payable: true,
      total: Math.min(weeklySum + bonus, cfg.cap_enduser_monthly)
    };
  }

  // エンドユーザーの、ある月の代理店応募フィー（1,000円×カウント、上限/ボーナスなし）
  //   v4: エンドと同じ判定（初月はそのまま、2ヶ月目以降はコンプリート月のみ）
  function agencyMonthlyAppFee(endUserId, month, weeklyRows, wins, cfg, weeksOfMonth, endUser) {
    if (v4Applies(month, cfg)) {
      var st = monthlyStatus(endUserId, month, weeklyRows, wins, weeksOfMonth, cfg, endUser);
      return { feeWeeks: st.count, v4: true, isFirstMonth: st.isFirstMonth, complete: st.complete, completeRule: st.completeRule, payable: st.payable,
               total: st.payable ? st.count * cfg.fee_agency_weekly : 0 };
    }
    var rows = weeklyRows.filter(function (r) { return r.end_user_id === endUserId && r.month === month; });
    var n = rows.filter(function (r) { return feeApplies(r, wins, cfg); }).length;
    return { feeWeeks: n, v4: false, payable: true, total: n * cfg.fee_agency_weekly };
  }

  // 入店完了した当選（完了順に 1件目=50,000 / 2件目以降=70,000）
  function completedWins(endUserId, wins, cfg) {
    var done = wins.filter(function (w) {
      return w.end_user_id === endUserId && w.store_entry_completed && w.store_entry_date;
    }).slice().sort(function (a, b) {
      if (a.store_entry_date !== b.store_entry_date) return a.store_entry_date < b.store_entry_date ? -1 : 1;
      if ((a.won_date || '') !== (b.won_date || '')) return (a.won_date || '') < (b.won_date || '') ? -1 : 1;
      return (a.id || 0) - (b.id || 0);
    });
    return done.map(function (w, i) {
      return {
        win: w, order: i + 1,
        agencyFee: i === 0 ? cfg.fee_agency_win_1st : cfg.fee_agency_win_2nd,
        endUserReward: cfg.reward_enduser_win + (w.purchase_incentive || 0),
        accountingMonth: calMonth(w.store_entry_date)
      };
    });
  }

  // 未確定当選（入店未完了）＝保留
  function pendingWins(wins) {
    return wins.filter(function (w) { return !w.store_entry_completed; });
  }

  // 制限（解除期間）
  function restriction(win, cfg, todayYMD) {
    var base = (win.store_entry_completed && win.store_entry_date) ? win.store_entry_date : win.won_date;
    var baseD = parseYMD(base);
    if (!baseD) return null;
    var release = addDays(baseD, cfg.restriction_days);
    var remaining = daysBetween(parseYMD(todayYMD), release);
    return { base: base, releaseDate: fmtYMD(release), remaining: remaining,
             soon: remaining >= 0 && remaining <= 7, released: remaining < 0 };
  }

  // 全体集計（代理店別・エンドユーザー別）
  function aggregate(data, cfg) {
    cfg = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    var endUsers = data.endUsers,
        weekly = data.weekly, wins = data.wins, weeksPerMonth = data.weeksPerMonth || {};
    // 登録済みの月 ∪ 結果SS日で繰り越された月（v4）。繰り越し先の月を落とさない
    var monthSet = {};
    Object.keys(weeksPerMonth).forEach(function (m) { monthSet[+m] = true; });
    accountingMonthsOf(weekly, cfg).forEach(function (m) { monthSet[m] = true; });
    var months = Object.keys(monthSet).map(Number).sort(function (a, b) { return a - b; });

    var perEndUser = {}, perAgency = {};
    function add(map, id, field, amt) {
      if (!map[id]) map[id] = { appFee: 0, winFee: 0, total: 0 };
      map[id][field] += amt; map[id].total += amt;
    }

    endUsers.forEach(function (u) {
      // エンドユーザーは agency_id で直接代理店に紐づく（ブローカー廃止）
      var agencyId = u.agency_id || null;
      var euPart = 0, euWin = 0, agAppFee = 0, agWinFee = 0;

      months.forEach(function (m) {
        var wk = weeksPerMonth[m] || weeksPerMonth[String(m)];
        euPart  += endUserMonthlyParticipation(u.id, m, weekly, wins, wk, cfg, u).total;
        agAppFee += agencyMonthlyAppFee(u.id, m, weekly, wins, cfg, wk, u).total;
      });
      completedWins(u.id, wins, cfg).forEach(function (c) {
        euWin += c.endUserReward; agWinFee += c.agencyFee;
      });

      perEndUser[u.id] = { participation: euPart, winReward: euWin, total: euPart + euWin };
      if (agencyId != null) { add(perAgency, agencyId, 'appFee', agAppFee); add(perAgency, agencyId, 'winFee', agWinFee); }
    });

    return { perEndUser: perEndUser, perAgency: perAgency };
  }

  var API = {
    DEFAULT_CONFIG: DEFAULT_CONFIG, weekLE: weekLE, conditionMet: conditionMet,
    hasWinByWeek: hasWinByWeek, feeApplies: feeApplies,
    v4Applies: v4Applies, completeRuleApplies: completeRuleApplies, accountingMonthOfResult: accountingMonthOfResult, rowAccountingMonth: rowAccountingMonth,
    firstMonthOf: firstMonthOf, monthlyCountRows: monthlyCountRows, isMonthComplete: isMonthComplete,
    monthlyStatus: monthlyStatus, accountingMonthsOf: accountingMonthsOf,
    endUserMonthlyParticipation: endUserMonthlyParticipation,
    agencyMonthlyAppFee: agencyMonthlyAppFee, completedWins: completedWins,
    pendingWins: pendingWins, restriction: restriction, aggregate: aggregate,
    parseYMD: parseYMD, addDays: addDays, fmtYMD: fmtYMD, daysBetween: daysBetween, calMonth: calMonth
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.AgCalc = API;
})(typeof window !== 'undefined' ? window : this);
