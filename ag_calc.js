/* ================================================================
 * ロレポチ代理店版 報酬計算エンジン（純関数・ブラウザ/Node 両対応）
 *
 * 設計の要点（レビュー反映済み）:
 *  - 金額・日数は config で一元化（DEFAULT_CONFIG）
 *  - 当選は ag_wins を正データとする。「当選回数カウンタ」は使わない
 *  - 応募フィーは「その週までに当選があるか」の“時点判定”
 *      → 何度再計算しても過去の金額がブレない（当選前の週の500/1000が消えない）
 *  - 3つのトリガを分離:
 *      応募フィー停止 = 当選日(won_date)
 *      支払確定       = 入店完了(store_entry_completed)
 *      180日制限起算  = 入店完了日(なければ当選日)
 *  - 当選者フィーは「入店完了した順」で 1件目=50,000 / 2件目以降=70,000
 *  - 未確定当選（入店未完了）は保留。支払いには含めない
 * ================================================================ */
(function (global) {
  'use strict';

  var DEFAULT_CONFIG = {
    required_stores: 5,
    fee_enduser_weekly: 500,
    fee_enduser_monthly_bonus: 1000,
    cap_enduser_monthly: 3000,
    reward_enduser_win: 20000,
    fee_agency_weekly: 1000,
    fee_agency_win_1st: 50000,
    fee_agency_win_2nd: 70000, // 入店完了2件目以降（3件目以降も暫定同額。将来ルール要確認）
    restriction_days: 180,
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

  // エンドユーザーの、ある月の参加報酬（週次500 + ボーナス、上限3000）
  function endUserMonthlyParticipation(endUserId, month, weeklyRows, wins, weeksOfMonth, cfg) {
    var rows = weeklyRows.filter(function (r) { return r.end_user_id === endUserId && r.month === month; });
    var feeWeeks = rows.filter(function (r) { return feeApplies(r, wins, cfg); });
    var weeklySum = feeWeeks.length * cfg.fee_enduser_weekly;
    // ボーナス: 当月の全週すべて条件達成 かつ 当月末まで1本目フェーズ
    var allMet = (weeksOfMonth && weeksOfMonth.length > 0) && weeksOfMonth.every(function (wk) {
      var r = rows.find(function (x) { return x.week === wk; });
      return r && conditionMet(r, cfg);
    });
    var lastWeek = (weeksOfMonth && weeksOfMonth.length) ? Math.max.apply(null, weeksOfMonth) : 0;
    var firstPhaseAllMonth = !hasWinByWeek(wins, endUserId, month, lastWeek);
    var bonus = (allMet && firstPhaseAllMonth) ? cfg.fee_enduser_monthly_bonus : 0;
    return {
      weekly: weeklySum, bonus: bonus, feeWeeks: feeWeeks.length,
      total: Math.min(weeklySum + bonus, cfg.cap_enduser_monthly)
    };
  }

  // エンドユーザーの、ある月の代理店応募フィー（1000×feeweeks、上限/ボーナスなし）
  function agencyMonthlyAppFee(endUserId, month, weeklyRows, wins, cfg) {
    var rows = weeklyRows.filter(function (r) { return r.end_user_id === endUserId && r.month === month; });
    var n = rows.filter(function (r) { return feeApplies(r, wins, cfg); }).length;
    return { feeWeeks: n, total: n * cfg.fee_agency_weekly };
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

  // 全体集計（ブローカー別・代理店別・エンドユーザー別）
  function aggregate(data, cfg) {
    cfg = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    var agencies = data.agencies, brokers = data.brokers, endUsers = data.endUsers,
        weekly = data.weekly, wins = data.wins, weeksPerMonth = data.weeksPerMonth || {};
    var months = Object.keys(weeksPerMonth).map(Number);

    var agencyOfBroker = {}; brokers.forEach(function (b) { agencyOfBroker[b.id] = b.agency_id; });

    var perEndUser = {}, perBroker = {}, perAgency = {};
    function add(map, id, field, amt) {
      if (!map[id]) map[id] = { appFee: 0, winFee: 0, total: 0 };
      map[id][field] += amt; map[id].total += amt;
    }

    endUsers.forEach(function (u) {
      // 代理店直（broker なし）は agency_id で直接代理店に紐づく。broker があればそちら優先。
      var brokerId = u.broker_id || null;
      var agencyId = brokerId ? agencyOfBroker[brokerId] : (u.agency_id || null);
      var euPart = 0, euWin = 0, agAppFee = 0, agWinFee = 0;

      months.forEach(function (m) {
        euPart  += endUserMonthlyParticipation(u.id, m, weekly, wins, weeksPerMonth[m], cfg).total;
        agAppFee += agencyMonthlyAppFee(u.id, m, weekly, wins, cfg).total;
      });
      completedWins(u.id, wins, cfg).forEach(function (c) {
        euWin += c.endUserReward; agWinFee += c.agencyFee;
      });

      perEndUser[u.id] = { participation: euPart, winReward: euWin, total: euPart + euWin };
      // ブローカーは代理店直ユーザーには存在しない → null キーを作らない
      if (brokerId != null) { add(perBroker, brokerId, 'appFee', agAppFee); add(perBroker, brokerId, 'winFee', agWinFee); }
      if (agencyId != null) { add(perAgency, agencyId, 'appFee', agAppFee); add(perAgency, agencyId, 'winFee', agWinFee); }
    });

    return { perEndUser: perEndUser, perBroker: perBroker, perAgency: perAgency };
  }

  var API = {
    DEFAULT_CONFIG: DEFAULT_CONFIG, weekLE: weekLE, conditionMet: conditionMet,
    hasWinByWeek: hasWinByWeek, feeApplies: feeApplies,
    endUserMonthlyParticipation: endUserMonthlyParticipation,
    agencyMonthlyAppFee: agencyMonthlyAppFee, completedWins: completedWins,
    pendingWins: pendingWins, restriction: restriction, aggregate: aggregate,
    parseYMD: parseYMD, addDays: addDays, fmtYMD: fmtYMD, daysBetween: daysBetween, calMonth: calMonth
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.AgCalc = API;
})(typeof window !== 'undefined' ? window : this);
