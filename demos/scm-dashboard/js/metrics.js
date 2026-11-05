/* =====================================================================
 * js/metrics.js — 지표 계산 (화면·CSV·점검 스크립트가 모두 이 함수만 사용)
 * 필터 F = { from, to, days, ind('ALL'|BEA|FOD|FSH|HOM|GFT), ch('ALL'|OWN|OMA|OMB|B2B) }
 * - 공통 지표(입고·출고·재고·반품·생산성)는 상품군끼리 더하고 비교합니다.
 * - 상품군 전용 지표(소비기한·옵션·세트 등)는 해당 상품군에서만 계산하고 합산하지 않습니다.
 * - 주문 흐름은 주문일, 출고는 출고 확정일, 입고는 도착일, 이슈는 접수일, 정산은 월 단위로 셉니다.
 * ===================================================================== */
(function (global) {
  'use strict';
  var D = global.SCM_DATA, C = D.cal, M = D.meta, END = M.END_DAY, IT = D.IT, INDI = D.INDI;

  function resolveFilter(f) {
    var to = END, from;
    switch (f.period) {
      case '30d': from = END - 29; break;
      case '90d': from = END - 89; break;
      case 'all': from = 0; break;
      case 'custom':
        from = Math.max(0, Math.min(END, C.dayOf(f.from))); to = Math.max(0, Math.min(END, C.dayOf(f.to)));
        if (from > to) { var t = from; from = to; to = t; }
        break;
      default: from = 0;
    }
    return { from: from, to: to, days: to - from + 1, ind: f.ind || 'ALL', ch: f.ch || 'ALL', period: f.period };
  }
  function withPeriod(F, a, b) { return { from: a, to: b, days: b - a + 1, ind: F.ind, ch: F.ch, period: 'custom' }; }
  function indOk(F, ind) { return F.ind === 'ALL' || F.ind === ind; }
  function chOk(F, ch) { return F.ch === 'ALL' || F.ch === ch; }
  function ok(F, o) { return indOk(F, o.ind) && chOk(F, o.ch); }
  function inR(d, F) { return d !== null && d !== undefined && d >= F.from && d <= F.to; }
  function sum(a, f) { var s = 0; for (var i = 0; i < a.length; i++) s += f ? f(a[i]) : a[i]; return s; }
  function ratio(n, d) { return d ? n / d : null; }
  function units(lines) { return sum(lines, function (l) { return l[1]; }); }
  function shippedOk(o) { return o.cancelStage === null || o.cancelStage === '출고 후 취소(반품)'; }
  function monthsIn(F) { return C.months.filter(function (m) { var r = C.monthRange(m); return r[1] >= F.from && r[0] <= F.to; }); }

  /* ---------------- 일자별 인덱스 (상품군 × 채널) ---------------- */
  var IDX = {};
  D.inds.forEach(function (x) { D.channels.forEach(function (c) { var a = []; for (var d = 0; d <= END; d++) a.push({ received: 0, inv: 0, ship: 0, voided: 0, shipUnits: 0, pickLines: 0 }); IDX[x.id + '|' + c.id] = a; }); });
  D.orders.forEach(function (o) {
    var a = IDX[o.ind + '|' + o.ch];
    if (o.kind === '주문') a[o.day].received++;
    if (o.invDay !== null) a[o.invDay].inv++;
    if (o.ship !== null) { a[o.ship].ship++; a[o.ship].shipUnits += units(o.lines); a[o.ship].pickLines += o.picks.length; }
    if (o.cancelStage === '송장 발행 후 취소') a[o.cancel].voided++;
  });
  var SHIPQ = []; for (var sd = 0; sd <= END; sd++) SHIPQ.push({ q: 0, late: 0, mv: 0 });
  D.orders.forEach(function (o) { if (o.ship !== null) o.picks.forEach(function (p) { SHIPQ[o.ship].q += p.qty; if (o.sysLate) SHIPQ[o.ship].late += p.qty; }); });
  D.moves.forEach(function (m) { if (m.type === '출고 확정') SHIPQ[m.d].mv -= m.qty; });
  function daily(F) {
    var keys = Object.keys(IDX).filter(function (k) { var p = k.split('|'); return indOk(F, p[0]) && chOk(F, p[1]); }), rows = [], inv = 0, ship = 0, voided = 0;
    for (var d = 0; d <= F.to; d++) {
      var r = { day: d, received: 0, inv: 0, ship: 0, voided: 0, shipUnits: 0, pickLines: 0 };
      keys.forEach(function (k) { var x = IDX[k][d]; r.received += x.received; r.inv += x.inv; r.ship += x.ship; r.voided += x.voided; r.shipUnits += x.shipUnits; r.pickLines += x.pickLines; });
      inv += r.inv; ship += r.ship; voided += r.voided;
      if (d >= F.from) { r.backlog = inv - ship - voided; r.cap = D.dailyOps[d].cap; rows.push(r); }
    }
    return rows;
  }

  /* ---------------- 주문 → 출고 흐름 ---------------- */
  var STAGES = ['주문 접수', '주문 검증', '피킹리스트', '송장 등록', '검수·포장', '출고 확정', '재고 반영'];
  function custOrders(F) { return D.orders.filter(function (o) { return o.kind === '주문' && inR(o.day, F) && ok(F, o); }); }
  function lateCause(o) {
    if (o.short) return '재고 부족 (입고 대기)';
    var p = M.sc.promo[o.ind];
    if (o.due >= p[0] && o.due <= p[1] + 3) return '행사 주문 집중 (처리 능력 초과)';
    if (!C.isBiz(o.due - 1)) return '휴일 후 주문 집중 (처리 능력 초과)';
    return '처리 능력 초과';
  }
  function flow(F) {
    var list = custOrders(F), valid = list.filter(function (o) { return o.cancelStage !== '피킹 전 취소'; });
    var reach = { '주문 접수': list.length, '주문 검증': valid.length, '피킹리스트': list.filter(function (o) { return o.waved !== null; }).length, '송장 등록': list.filter(function (o) { return o.inv !== null; }).length,
      '검수·포장': list.filter(function (o) { return o.packed !== null; }).length, '출고 확정': list.filter(function (o) { return o.ship !== null; }).length, '재고 반영': list.filter(function (o) { return o.ship !== null && !o.sysLate; }).length };
    var base = list.filter(function (o) { return !o.mismatch && shippedOk(o) && (o.ship !== null || o.due < END); });
    var same = base.filter(function (o) { return o.ship === o.due; }).length;
    var late = base.filter(function (o) { return o.ship === null ? o.due < END : o.ship > o.due; }).map(function (o) { o.lateCause = lateCause(o); return o; });
    return { list: list, reach: reach, cancelBefore: list.length - valid.length, voided: list.filter(function (o) { return o.cancelStage === '송장 발행 후 취소'; }).length, mismatch: list.filter(function (o) { return o.mismatch; }).length,
      sysLate: list.filter(function (o) { return o.sysLate; }).length, baseN: base.length, sameDay: same, sameDayRate: ratio(same, base.length), late: late };
  }
  function status(o, x) {
    if (o.cancel !== null && o.cancel <= x && o.cancelStage !== '출고 후 취소(반품)') return o.cancelStage;
    if (o.ship !== null && o.ship <= x) { if (o.ret && o.ret.req <= x) return o.ret.done !== null && o.ret.done <= x ? '반품 입고' : '반품 요청'; return o.deliver !== null && o.deliver <= x ? '배송 완료' : '출고 확정 · 배송 중'; }
    if (o.waved !== null && o.waved <= x) return '송장 발행 · 출고 대기';
    if (o.short && o.elig <= x) return '재고 부족 대기';
    if (o.mismatch && o.elig > x) return '검증 보류 (코드 불일치)';
    return '검증 완료 · 피킹 대기';
  }
  function openOrders(F) { return D.orders.filter(function (o) { return ok(F, o) && o.day <= F.to && (o.ship === null || o.ship > F.to) && !(o.cancel !== null && o.cancel <= F.to && o.cancelStage !== '출고 후 취소(반품)'); }); }

  var CANCEL_ACT = { '피킹 전 취소': '출고 대상에서 제외', '송장 발행 후 취소': '송장 취소 · 로트 예약 해제', '출고 후 취소(반품)': '회수 요청 · 반품 입고 후 재고 반영' };
  function orderCheck(F) {
    var list = custOrders(F), dups = D.dups.filter(function (x) { return inR(x.d, F) && ok(F, x); });
    var changes = D.changes.filter(function (x) { return inR(x.d, F) && ok(F, D.OD[x.order]); }), log = [];
    dups.forEach(function (x) { log.push({ d: x.d, t: x.t, type: '중복 주문 행', ind: x.ind, ch: x.ch, chNo: x.chNo, order: x.of, detail: '같은 채널 주문번호가 주문서에 두 번 내려옴', act: '중복 행 제외' }); });
    list.filter(function (o) { return o.mismatch; }).forEach(function (o) { log.push({ d: o.day, t: o.t, type: '상품코드 불일치', ind: o.ind, ch: o.ch, chNo: o.chNo, order: o.id, detail: '채널 옵션코드가 매핑표에 없음', act: '매핑표 추가 후 ' + C.isoOf(o.elig) + ' 피킹' }); });
    changes.forEach(function (x) { var o = D.OD[x.order]; log.push({ d: x.d, t: o.t, type: '수량 변경', ind: o.ind, ch: o.ch, chNo: o.chNo, order: o.id, detail: IT[x.item].name + ' ' + x.from + ' → ' + x.to, act: '피킹 전 주문 수량 수정' }); });
    D.orders.forEach(function (o) { if (o.kind === '주문' && o.cancel !== null && inR(o.cancel, F) && ok(F, o)) log.push({ d: o.cancel, t: o.t, type: o.cancelStage, ind: o.ind, ch: o.ch, chNo: o.chNo, order: o.id, detail: o.inv ? '송장 ' + o.inv : '송장 발행 전', act: CANCEL_ACT[o.cancelStage] }); });
    log.sort(function (a, b) { return b.d - a.d || b.t - a.t; });
    function grp(arr, key, name) { return arr.map(function (c) {
      var l = list.filter(function (o) { return o[key] === c.id; });
      return { id: c.id, name: c[name], orders: l.length, units: sum(l, function (o) { return units(o.lines); }), dup: dups.filter(function (x) { return x[key] === c.id; }).length, mismatch: l.filter(function (o) { return o.mismatch; }).length,
        change: changes.filter(function (x) { return D.OD[x.order][key] === c.id; }).length, cancel: l.filter(function (o) { return o.cancel !== null && o.cancelStage !== '출고 후 취소(반품)'; }).length,
        shipped: l.filter(function (o) { return o.ship !== null && o.ship <= F.to; }).length, waiting: l.filter(function (o) { return (o.ship === null || o.ship > F.to) && shippedOk(o); }).length };
    }); }
    var mm = list.filter(function (o) { return o.mismatch; }).length;
    return { list: list, dups: dups, changes: changes, log: log, byCh: grp(D.channels.filter(function (c) { return chOk(F, c.id); }), 'ch', 'name'), byInd: grp(D.inds.filter(function (c) { return indOk(F, c.id); }), 'ind', 'name'), rows: list.length + dups.length, errN: dups.length + mm, errRate: ratio(dups.length + mm, list.length + dups.length) };
  }

  /* ---------------- 입고 · 검수 · 적치 ---------------- */
  function inbound(F) {
    var list = D.receipts.filter(function (r) { return inR(r.arrive, F) && indOk(F, r.ind); });
    var by = {}; list.forEach(function (r) { INDI[r.ind].qc.forEach(function (q, i) { var k = r.ind + '|' + q; by[k] = by[k] || { ind: r.ind, item: q, ng: 0 }; by[k].ng += r.ngBy[i]; }); });
    var plan = sum(list, function (r) { return r.plan; }), recv = sum(list, function (r) { return r.recv; }), good = sum(list, function (r) { return r.ok; }), ng = sum(list, function (r) { return r.ng; });
    return { list: list, n: list.length, plan: plan, recv: recv, good: good, ng: ng, short: list.filter(function (r) { return r.recv < r.plan; }).length, ngRate: ratio(ng, recv), put: sum(list.filter(function (r) { return r.put <= F.to; }), function (r) { return r.ok; }), qc: Object.keys(by).map(function (k) { return by[k]; }),
      avgLead: list.length ? sum(list, function (r) { return r.put - r.arrive; }) / list.length : null };
  }

  /* ---------------- 피킹 · 출고 ---------------- */
  function waveDays(F) { var a = []; for (var d = F.from; d <= F.to; d++) if (C.isBiz(d)) a.push(d); return a; }
  function picking(F, day) {
    var w = D.orders.filter(function (o) { return o.waved === day && ok(F, o); }), agg = {};
    w.forEach(function (o) { o.picks.forEach(function (p) { if (!agg[p.lot]) agg[p.lot] = { loc: p.loc, item: p.item, lot: p.lot, exp: p.exp, qty: 0, orders: 0 }; agg[p.lot].qty += p.qty; agg[p.lot].orders++; }); });
    var pick = Object.keys(agg).map(function (k) { return agg[k]; }).sort(function (a, b) { return a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0; });
    var rows = w.map(function (o) { return { o: o, status: o.cancelStage === '송장 발행 후 취소' && o.cancel === day ? '송장 취소' : o.ship === day ? '택배 인계 (출고 확정)' : o.ship !== null ? '다음 날 출고 확정 (' + C.isoOf(o.ship).slice(5) + ')' : '포장 대기' }; });
    return { day: day, orders: w, pick: pick, rows: rows, units: sum(pick, function (p) { return p.qty; }), shipped: rows.filter(function (r) { return r.status === '택배 인계 (출고 확정)'; }).length, voided: rows.filter(function (r) { return r.status === '송장 취소'; }).length };
  }
  function outbound(F) {
    var rows = daily(F), ship = D.orders.filter(function (o) { return inR(o.ship, F) && ok(F, o); });
    return { rows: rows, inv: sum(rows, function (r) { return r.inv; }), ship: sum(rows, function (r) { return r.ship; }), voided: sum(rows, function (r) { return r.voided; }), backlog: rows.length ? rows[rows.length - 1].backlog : 0, shipUnits: sum(rows, function (r) { return r.shipUnits; }), pickLines: sum(rows, function (r) { return r.pickLines; }),
      caught: ship.filter(function (o) { return o.inspect === '오피킹 발견 → 재피킹'; }).length, mispick: ship.filter(function (o) { return o.mispick; }).length, optBlock: ship.filter(function (o) { return o.optBlock; }).length, orders: ship };
  }

  /* ---------------- 재고 · 실사 ---------------- */
  function countCauses(c, item) {
    var g = D.gaps.filter(function (x) { return x.item === item && x.d < c.d && (c.prev < 0 ? x.d >= 0 : x.d >= c.prev); }), by = {};
    g.forEach(function (x) { by[x.cause] = (by[x.cause] || 0) + x.q; });
    return Object.keys(by).map(function (k) { return { cause: k, qty: by[k] }; }).filter(function (x) { return x.qty; });
  }
  function counts(F) {
    var rows = [];
    D.counts.filter(function (c) { return inR(c.d, F); }).forEach(function (c) { c.rows.forEach(function (r) { if (!indOk(F, r.ind)) return; var diff = r.phys - r.sys, dd = r.dmgPhys - r.dmgSys; rows.push({ d: c.d, item: r.item, ind: r.ind, sys: r.sys, phys: r.phys, diff: diff, dmgSys: r.dmgSys, dmgPhys: r.dmgPhys, dmgDiff: dd, causes: diff || dd ? countCauses(c, r.item) : [] }); }); });
    var match = rows.filter(function (r) { return r.diff === 0 && r.dmgDiff === 0; }).length;
    return { rows: rows, n: rows.length, match: match, rate: ratio(match, rows.length), diffs: rows.filter(function (r) { return r.diff !== 0 || r.dmgDiff !== 0; }) };
  }
  function lotState(l, x) { return x < l.holdUntil ? '보류 (검수·라벨)' : l.exp !== null && l.exp - x < M.MIN_REMAIN ? '출고 제한 (기한 임박)' : '정상'; }
  function stockNow(F) {
    return D.items.filter(function (it) { return D.stockable(it) && indOk(F, it.ind); }).map(function (it) {
      var r = { item: it.id, ind: it.ind, zone: it.zone, normal: 0, hold: 0, limited: 0, dmg: 0, res: 0, sysGood: 0, sysDmg: 0, good: 0 };
      it.lots.forEach(function (l) { var s = lotState(l, END); if (s === '정상') r.normal += l.good; else if (s.indexOf('보류') === 0) r.hold += l.good; else r.limited += l.good; r.dmg += l.dmg; r.res += l.res; r.sysGood += l.sysGood; r.sysDmg += l.sysDmg; r.good += l.good; });
      r.avail = r.normal - r.res; r.phys = r.good + r.dmg; r.gap = r.good - r.sysGood;
      return r;
    });
  }
  function zones(F) {
    return D.zones.filter(function (z) { return indOk(F, z.ind); }).map(function (z) {
      var ls = D.lots.filter(function (l) { return IT[l.item].zone === z.id; }), u = sum(ls, function (l) { return l.good + l.dmg; }), inv = {};
      ls.forEach(function (l) { if (l.good + l.dmg > 0) inv[l.item] = 1; });
      return { id: z.id, name: z.name, ind: z.ind, cap: z.cap, units: u, util: u / z.cap, skus: Object.keys(inv).length, lots: ls.filter(function (l) { return l.good + l.dmg > 0; }).length };
    });
  }
  function movesIn(F) { return D.moves.filter(function (m) { return inR(m.d, F) && indOk(F, m.ind); }); }
  function posIn(F) { return D.pos.filter(function (p) { return (inR(p.d, F) || inR(p.eta, F)) && indOk(F, p.ind); }); }
  function turnover(F) {   // 재고 회전 일수 = 기간 종료일 재고 ÷ 기간 일평균 출고 수량
    return D.inds.filter(function (x) { return indOk(F, x.id); }).map(function (x) {
      var G = { from: F.from, to: F.to, days: F.days, ind: x.id, ch: 'ALL', period: 'custom' }, out = sum(daily(G), function (r) { return r.shipUnits; }), stock = D.stockDaily[F.to][x.id];
      return { ind: x.id, stock: stock, outPerDay: out / F.days, days: ratio(stock, out / F.days) };
    });
  }

  /* ---------------- 소비기한·로트 ---------------- */
  var BUCKETS = [['60일 미만 (출고 제한)', -1e9, 59], ['60~120일', 60, 120], ['121~180일', 121, 180], ['181일 이상', 181, 1e9]];
  function expiry(F) {
    var lots = D.lots.filter(function (l) { return l.exp !== null && l.good + l.dmg > 0 && indOk(F, l.ind); }).map(function (l) { return { lot: l, remain: l.exp - END, state: lotState(l, END) }; }).sort(function (a, b) { return a.lot.item < b.lot.item ? -1 : a.lot.item > b.lot.item ? 1 : a.lot.exp - b.lot.exp; });
    var buckets = BUCKETS.map(function (b) { var ls = lots.filter(function (x) { return x.remain >= b[1] && x.remain <= b[2]; }); return { label: b[0], units: sum(ls, function (x) { return x.lot.good; }), lots: ls.length }; });
    var picks = []; D.orders.forEach(function (o) { if (inR(o.ship, F) && ok(F, o)) o.picks.forEach(function (p) { if (p.exp !== null) picks.push({ remain: p.exp - o.ship, qty: p.qty }); }); });
    return { lots: lots, buckets: buckets, picks: picks.length, minRemain: picks.length ? Math.min.apply(null, picks.map(function (p) { return p.remain; })) : null, avgRemain: picks.length ? sum(picks, function (p) { return p.remain * p.qty; }) / sum(picks, function (p) { return p.qty; }) : null, limited: buckets[0].units };
  }

  /* ---------------- 세트 · 옵션 · 시즌 (상품군 전용) ---------------- */
  function sets(F) {
    return D.items.filter(function (x) { return x.bom && indOk(F, x.ind); }).map(function (x) {
      var can = Infinity, short = null;
      x.bom.forEach(function (b) { var a = sum(IT[b[0]].lots.filter(function (l) { return lotState(l, END) === '정상'; }), function (l) { return l.good - l.res; }), c = Math.floor(a / b[1]); if (c < can) { can = c; short = b[0]; } });
      var shipped = sum(D.orders.filter(function (o) { return inR(o.ship, F) && o.ind === x.ind; }), function (o) { return sum(o.lines.filter(function (l) { return l[0] === x.id; }), function (l) { return l[1]; }); });
      return { item: x.id, ind: x.ind, bom: x.bom, can: can, limit: short, shipped: shipped };
    });
  }
  function matrix() {   // 의류 스타일 × 색상 × 사이즈 판매 가능 실물
    var styles = {}; D.items.filter(function (x) { return x.ind === 'FSH'; }).forEach(function (x) { var k = x.style + ' ' + x.color, s = styles[k] = styles[k] || { style: x.style, color: x.color, season: x.season, S: 0, M: 0, L: 0, sold: 0 }; s[x.size] = sum(x.lots, function (l) { return l.good; }); });
    return Object.keys(styles).map(function (k) { var s = styles[k]; s.total = s.S + s.M + s.L; return s; });
  }
  function seasonFlow(F) {
    var rows = monthsIn(F).map(function (m) { var r = C.monthRange(m), a = { month: m, SS: 0, FW: 0 }; D.orders.forEach(function (o) { if (o.ind === 'FSH' && o.ship !== null && o.ship >= r[0] && o.ship <= r[1]) o.lines.forEach(function (l) { a[IT[l[0]].season] += l[1]; }); }); return a; });
    return rows;
  }
  function aging(F, days) {   // 입고 후 days일이 지났고 기준일에 재고가 남은 로트
    return D.lots.filter(function (l) { return indOk(F, l.ind) && l.exp === null && l.good > 0 && END - l.inDay >= days; }).map(function (l) { return { lot: l, age: END - l.inDay, season: IT[l.item].season }; }).sort(function (a, b) { return b.age - a.age; });
  }
  function byItem(F) {   // 상품별 주문·출고·반품·오류
    var map = {}; D.items.filter(function (x) { return indOk(F, x.ind) && !x.comp; }).forEach(function (x) { map[x.id] = { item: x.id, ind: x.ind, orders: 0, units: 0, mis: 0, rets: 0, retUnits: 0, bad: 0 }; });
    D.orders.forEach(function (o) {
      if (o.kind === '주문' && inR(o.ship, F) && ok(F, o)) o.lines.forEach(function (l) { var r = map[l[0]]; if (r) { r.orders++; r.units += l[1]; if (o.mispick) r.mis++; } });
      if (o.ret && inR(o.ret.req, F) && ok(F, o)) { var r2 = map[o.ret.item]; if (r2) { r2.rets++; r2.retUnits += o.ret.qty; if (o.ret.grade && o.ret.grade !== '재판매 가능') r2.bad += o.ret.qty; } }
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }
  function weeklyByItem(F, item) { var o = {}; D.orders.forEach(function (x) { if (inR(x.ship, F) && x.kind === '주문') x.lines.forEach(function (l) { if (l[0] === item) { var w = x.ship - (x.ship + 4) % 7; o[w] = (o[w] || 0) + l[1]; } }); }); return Object.keys(o).map(function (k) { return { week: +k, qty: o[k] }; }); }
  function promoPlan(F) {   // 상품군별 행사 기간의 주문·출고·대기
    return D.inds.filter(function (x) { return indOk(F, x.id); }).map(function (x) {
      var p = M.sc.promo[x.id], list = D.orders.filter(function (o) { return o.kind === '주문' && o.ind === x.id && o.day >= p[0] && o.day <= p[1]; }), days = p[1] - p[0] + 1;
      var late = list.filter(function (o) { return !o.mismatch && shippedOk(o) && o.ship !== null && o.ship > o.due; }).length;
      return { ind: x.id, from: p[0], to: p[1], factor: p[2], orders: list.length, perDay: list.length / days, units: sum(list, function (o) { return units(o.lines); }), late: late };
    });
  }

  /* ---------------- 인력 · 생산성 (센터 공통 인력, 상품군은 물량 비중으로 나눔) ---------------- */
  function volOf(F, key) {
    if (key === 'recv') return sum(D.receipts.filter(function (r) { return inR(r.arrive, F) && indOk(F, r.ind); }), function (r) { return r.recv; });
    if (key === 'put') return sum(D.receipts.filter(function (r) { return inR(r.put, F) && indOk(F, r.ind); }), function (r) { return r.ok; });
    if (key === 'ret') return D.orders.filter(function (o) { return o.ret && inR(o.ret.done, F) && indOk(F, o.ind); }).length;
    var G = { from: F.from, to: F.to, days: F.days, ind: F.ind, ch: 'ALL', period: 'custom' }, rows = daily(G);
    return sum(rows, function (r) { return key === 'pick' ? r.pickLines : r.ship; });
  }
  function labor(F) {
    var days = D.labor.filter(function (l) { return inR(l.d, F); });
    var proc = D.proc.map(function (p) {
      var vol = sum(days, function (l) { return l.vol[p.key]; }), hrs = sum(days, function (l) { return l.hours[p.key]; }), v = F.ind === 'ALL' ? vol : volOf(F, p.key), uph = ratio(vol, hrs);
      return { key: p.key, label: p.label, unit: p.unit, std: D.uph[p.key], vol: v, centerVol: vol, centerHours: hrs, hours: uph ? v / uph : 0, uph: uph };
    });
    var hours = sum(proc, function (p) { return p.hours; }), avail = sum(days, function (l) { return sum(Object.keys(l.act), function (k) { return l.act[k]; }) * M.HOURS + (l.temps) * M.HOURS + l.otH * (l.act.pack + l.temps); });
    return { days: days, proc: proc, hours: hours, avail: avail, util: ratio(sum(proc, function (p) { return p.centerHours; }), avail), temps: sum(days, function (l) { return l.temps; }), otH: sum(days, function (l) { return l.otH * (l.act.pack + l.temps); }),
      head: days.length ? sum(days, function (l) { return sum(Object.keys(l.act), function (k) { return l.act[k]; }) + l.temps; }) / days.length : null, peakDays: days.filter(function (l) { return l.temps > 0 || l.otH > 0; }) };
  }
  function laborRow(l) { var a = Object.keys(l.act), act = sum(a, function (k) { return l.act[k]; }), plan = sum(a, function (k) { return l.plan[k]; }); return { d: l.d, plan: plan, act: act, temps: l.temps, otH: l.otH, cap: l.cap, shipped: l.vol.pack, l: l }; }

  /* ---------------- 출고 이슈 ---------------- */
  function issues(F) {
    var list = D.issues.filter(function (i) { return inR(i.d, F) && ok(F, D.OD[i.order]); }), by = {};
    list.forEach(function (i) { by[i.kind] = (by[i.kind] || 0) + 1; });
    var fl = flow(F), reships = D.orders.filter(function (o) { return o.kind === '재출고' && inR(o.day, F) && ok(F, o); });
    var reOk = reships.filter(function (o) { return o.ship !== null && o.ship <= C.addBiz(o.elig, 1); }).length;
    var rets = D.orders.filter(function (o) { return o.ret && inR(o.ret.req, F) && ok(F, o); }), wh = D.damages.filter(function (x) { return inR(x.d, F) && indOk(F, x.ind); });
    var grades = {}; rets.forEach(function (o) { if (o.ret.grade) grades[o.ret.grade] = (grades[o.ret.grade] || 0) + 1; });
    return { list: list, by: by, late: fl.late, reships: reships, reOk: reOk, reRate: ratio(reOk, reships.filter(function (o) { return o.ship !== null || C.addBiz(o.elig, 1) < END; }).length), rets: rets, retDone: rets.filter(function (o) { return o.ret.done !== null; }).length, grades: grades, whDmg: wh, whDmgQty: sum(wh, function (x) { return x.qty; }) };
  }
  function returnStats(F) {
    return D.inds.filter(function (x) { return indOk(F, x.id); }).map(function (x) {
      var G = { from: F.from, to: F.to, days: F.days, ind: x.id, ch: F.ch, period: 'custom' }, ob = outbound(G), is = issues(G), n = is.rets.length, done = is.retDone, re = is.grades['재판매 가능'] || 0;
      return { ind: x.id, ship: ob.ship, rets: n, rate: ratio(n, ob.ship), done: done, resale: re, resaleRate: ratio(re, done), grades: is.grades };
    });
  }

  /* ---------------- 화주사별 월 정산 대조 ---------------- */
  var CAUSES = ['송장 발행 후 취소 건 청구', '센터 귀책 재출고 청구', '계약 단가 오적용', '보관 수량 과다 산정', '근거 없는 수량 차이'];
  function voidedIn(m, ind) { var r = C.monthRange(m); return D.orders.filter(function (o) { return o.ind === ind && o.cancelStage === '송장 발행 후 취소' && o.cancel >= r[0] && o.cancel <= r[1]; }); }
  function faultIn(m, ind) { var r = C.monthRange(m); return D.orders.filter(function (o) { return o.ind === ind && o.kind === '재출고' && o.fault === '센터' && o.ship !== null && o.ship >= r[0] && o.ship <= r[1]; }); }
  function classify(r) {
    if (r.billRate !== r.rate) return { cause: CAUSES[2], basis: '계약 단가 ' + r.rate.toLocaleString('ko-KR') + '원 · 초안 단가 ' + r.billRate.toLocaleString('ko-KR') + '원' };
    var dq = r.billQty - r.qty, c = voidedIn(r.month, r.ind).length, f = faultIn(r.month, r.ind).length;
    if (c && dq === c) return { cause: CAUSES[0], basis: '초안 − 실적 = ' + dq + ' = 그달 송장 취소 ' + c + '건' };
    if (f && dq === f) return { cause: CAUSES[1], basis: '초안 − 실적 = ' + dq + ' = 그달 센터 귀책 재출고 ' + f + '건' };
    if (r.item === 'store') return { cause: CAUSES[3], basis: '초안 ' + r.billQty + ' · 일평균 재고 환산 ' + r.qty + ' 파렛트' };
    return { cause: CAUSES[4], basis: '초안 − 실적 = ' + dq };
  }
  function settlement(F) {
    var months = monthsIn(F), rows = [];
    months.forEach(function (m) { D.inds.filter(function (x) { return indOk(F, x.id); }).forEach(function (x) {
      var q = D.monthActual(m, x.id);
      D.billItems.forEach(function (it) { var st = D.statements.filter(function (s) { return s.month === m && s.ind === x.id && s.item === it.key; })[0], rate = D.rates[it.key]; rows.push({ month: m, ind: x.id, item: it.key, label: it.label, unit: it.unit, qty: q[it.key], rate: rate, actual: q[it.key] * rate, billQty: st.qty, billRate: st.rate, billed: st.amount, diff: st.amount - q[it.key] * rate, status: st.status }); });
    }); });
    var diffs = rows.filter(function (r) { return r.diff !== 0; }).map(function (r) { var c = classify(r); r.cause = c.cause; r.basis = c.basis; return r; });
    var causes = CAUSES.map(function (c) { var rs = diffs.filter(function (d) { return d.cause === c; }); return { cause: c, rows: rs.length, months: rs.map(function (d) { return d.month; }).filter(function (v, i, a) { return a.indexOf(v) === i; }), amount: sum(rs, function (d) { return d.diff; }) }; }).filter(function (c) { return c.rows; });
    var evidence = [];
    causes.forEach(function (c) { diffs.filter(function (d) { return d.cause === c.cause; }).forEach(function (d) {
      if (c.cause === CAUSES[0] && d.item === 'base') voidedIn(d.month, d.ind).forEach(function (o) { var unit = sum(diffs.filter(function (x) { return x.month === d.month && x.ind === d.ind && x.cause === c.cause; }), function (x) { return x.rate; }); evidence.push({ month: d.month, ind: d.ind, cause: c.cause, ref: o.id + ' / 송장 ' + o.inv, detail: '송장 발행 ' + C.isoOf(o.invDay) + ' · 취소 ' + C.isoOf(o.cancel) + ' · 출고 기록 없음', qty: 1, amount: unit }); });
      else if (c.cause === CAUSES[1] && d.item === 'base') faultIn(d.month, d.ind).forEach(function (o) { var unit = sum(diffs.filter(function (x) { return x.month === d.month && x.ind === d.ind && x.cause === c.cause; }), function (x) { return x.rate; }); evidence.push({ month: d.month, ind: d.ind, cause: c.cause, ref: o.id + ' (원주문 ' + o.parent + ')', detail: '오출고 재출고 · 귀책 센터 · 출고 ' + C.isoOf(o.ship), qty: 1, amount: unit }); });
      else if (c.cause !== CAUSES[0] && c.cause !== CAUSES[1]) evidence.push({ month: d.month, ind: d.ind, cause: c.cause, ref: d.label, detail: d.basis, qty: Math.abs(d.billQty - d.qty) || d.qty, amount: d.diff });
    }); });
    var monthly = months.map(function (m) { var rs = rows.filter(function (r) { return r.month === m; }); return { month: m, actual: sum(rs, function (r) { return r.actual; }), billed: sum(rs, function (r) { return r.billed; }), diff: sum(rs, function (r) { return r.diff; }) }; });
    return { months: months, rows: rows, monthly: monthly, actual: sum(rows, function (r) { return r.actual; }), billed: sum(rows, function (r) { return r.billed; }), diff: sum(rows, function (r) { return r.diff; }), diffs: diffs, causes: causes, evidence: evidence };
  }

  /* ---------------- 데이터 정합성 점검 ---------------- */
  function integrity(F) {
    var cancelShipped = D.orders.filter(function (o) { return o.cancel !== null && inR(o.cancel, F) && indOk(F, o.ind) && o.cancelStage !== '출고 후 취소(반품)' && o.ship !== null; }).length;
    var voidShipped = D.invoices.filter(function (iv) { return iv.voided !== null && inR(iv.voided, F) && indOk(F, iv.ind) && iv.ship !== null; }).length;
    var reInFlow = flow(F).list.filter(function (o) { return o.kind !== '주문'; }).length;
    var seen = {}, retDup = 0; D.retLog.forEach(function (x) { if (x.result !== '재고 반영' || !inR(x.d, F) || !indOk(F, x.ind)) return; if (seen[x.ret]) retDup++; seen[x.ret] = 1; });
    var blocked = D.retLog.filter(function (x) { return x.result === '중복 등록 차단' && inR(x.d, F) && indOk(F, x.ind); }).length;
    var sn = stockNow(F), availBad = 0;
    sn.forEach(function (r) { var a = sum(IT[r.item].lots.filter(function (l) { return lotState(l, END) === '정상'; }), function (l) { return l.good - l.res; }); if (a !== r.avail) availBad++; });
    var ex = expiry(F), exLots = D.lots.filter(function (l) { return l.exp !== null && indOk(F, l.ind); });
    var expBad = sum(ex.buckets, function (b) { return b.units; }) !== sum(exLots, function (l) { return l.good; }) ? 1 : 0;
    var shipBad = 0; for (var d = F.from; d <= F.to; d++) if (SHIPQ[d].mv + SHIPQ[d].late !== SHIPQ[d].q) shipBad++;
    var qtyBad = D.orders.filter(function (o) { return inR(o.ship, F) && indOk(F, o.ind) && Object.keys(o.need).some(function (c) { return o.need[c] !== sum(o.picks.filter(function (p) { return p.item === c; }), function (p) { return p.qty; }); }); }).length;
    var optBad = F.ind === 'ALL' || F.ind === 'FSH' ? (function () { var m = sum(matrix(), function (s) { return s.total; }), t = sum(D.lots.filter(function (l) { return l.ind === 'FSH'; }), function (l) { return l.good; }); return m === t ? 0 : 1; })() : 0;
    var allD = D.stockDaily[END], lotSum = {}; D.lots.forEach(function (l) { lotSum[l.ind] = (lotSum[l.ind] || 0) + l.good; });
    var sdBad = D.inds.filter(function (x) { return indOk(F, x.id) && allD[x.id] !== lotSum[x.id]; }).length;
    return [
      { check: '취소 주문이 출고에 집계됐는가', rule: '피킹 전·송장 발행 후 취소 주문은 출고 확정 0건', n: cancelShipped },
      { check: '취소된 송장이 출고 원장에 남았는가', rule: '취소 송장은 출고 확정 기록 0건', n: voidShipped },
      { check: '주문 수량과 피킹 수량이 다른 주문', rule: '세트는 구성품으로 풀어서 주문 수량 = 로트 배정 수량', n: qtyBad },
      { check: '출고 확정과 재고 차감이 다른 날', rule: '출고 확정 수량 = 재고 차감 수량 (+ 전산 누락분)', n: shipBad },
      { check: '재출고가 새 주문으로 집계됐는가', rule: '재출고는 원주문에 연결, 주문 접수 건수 제외', n: reInFlow },
      { check: '반품이 재고에 두 번 반영됐는가', rule: '반품 번호당 재고 반영 1회', n: retDup },
      { check: '격리·보류·임박 재고가 가용에 포함됐는가', rule: '가용 = 정상 로트 실물 − 출고 예약', n: availBad },
      { check: '소비기한별 합계가 로트 합계와 다른가', rule: '소비기한 구간 합계 = 기한 관리 로트 실물 합계', n: expBad },
      { check: '옵션별 재고 합계가 의류 재고와 다른가', rule: '색상·사이즈 합계 = 의류 로트 실물 합계', n: optBad },
      { check: '일별 재고 기록이 로트 합계와 다른 상품군', rule: '기준일 일별 재고 = 로트 실물 합계', n: sdBad },
      { check: '반품 중복 등록 시도 (차단됨)', rule: '같은 반품 번호 두 번째 스캔은 등록 거부', n: blocked, info: true }
    ];
  }
  function improve(F) {
    var months = monthsIn(F).map(function (m) {
      var r = C.monthRange(m), G = withPeriod(F, Math.max(F.from, r[0]), Math.min(F.to, r[1])), oc = orderCheck(G), ob = outbound(G), dm = D.damages.filter(function (x) { return inR(x.d, G) && indOk(F, x.ind); });
      return { month: m, rows: oc.rows, errN: oc.errN, errRate: oc.errRate, mismatch: oc.list.filter(function (o) { return o.mismatch; }).length, dup: oc.dups.length, caught: ob.caught, mispick: ob.mispick, ship: ob.ship, dmg: dm.length, dmgMiss: dm.filter(function (x) { return !x.registered; }).length, countDiff: counts(G).diffs.length };
    });
    function split(before) {
      var list = D.orders.filter(function (o) { return o.kind === '주문' && o.ch === 'OMB' && inR(o.day, F) && indOk(F, o.ind) && (o.day < M.STD_DATE) === before; }), dm = D.damages.filter(function (x) { return inR(x.d, F) && indOk(F, x.ind) && (x.d < M.STD_DATE) === before; });
      var pl = D.labor.filter(function (l) { return inR(l.d, F) && (l.d < M.STD_DATE) === before; }), pv = sum(pl, function (l) { return l.vol.pick; }), ph = sum(pl, function (l) { return l.hours.pick; });
      return { omb: list.length, mismatch: list.filter(function (o) { return o.mismatch; }).length, mRate: ratio(list.filter(function (o) { return o.mismatch; }).length, list.length), dmg: dm.length, dmgMiss: dm.filter(function (x) { return !x.registered; }).length, dRate: ratio(dm.filter(function (x) { return !x.registered; }).length, dm.length), pickUph: ratio(pv, ph) };
    }
    return { months: months, before: split(true), after: split(false), checks: integrity(F) };
  }

  /* ---------------- 피벗 (데이터 분석 화면 · Excel 내보내기와 같은 원본) ---------------- */
  var PIVOT_DIM = { ind: { label: '상품군', of: function (o) { return INDI[o.ind].name; } }, ch: { label: '채널', of: function (o) { return D.CHI[o.ch].name; } }, month: { label: '출고 월', of: function (o) { return C.monthOf(o.ship).replace('-', '.'); } } };
  var PIVOT_VAL = { orders: { label: '출고 건수', of: function () { return 1; } }, units: { label: '출고 수량', of: function (o) { return units(o.lines); } }, lines: { label: '피킹 라인', of: function (o) { return o.picks.length; } } };
  function pivot(F, rowKey, colKey, valKey) {
    var R = PIVOT_DIM[rowKey], Co = PIVOT_DIM[colKey], V = PIVOT_VAL[valKey], rows = {}, cols = {}, cell = {};
    D.orders.forEach(function (o) { if (!inR(o.ship, F) || !ok(F, o)) return; var r = R.of(o), c = Co.of(o), v = V.of(o); rows[r] = (rows[r] || 0) + v; cols[c] = (cols[c] || 0) + v; cell[r + '|' + c] = (cell[r + '|' + c] || 0) + v; });
    var rk = Object.keys(rows).sort(), ck = Object.keys(cols).sort();
    return { rowLabel: R.label, colLabel: Co.label, valLabel: V.label, rows: rk, cols: ck, cell: cell, rowTotal: rows, colTotal: cols, total: sum(rk, function (k) { return rows[k]; }) };
  }

  /* ---------------- KPI ---------------- */
  function commonKpis(F) {   // 전체·산업별 모두 같은 기준으로 계산되는 공통 지표
    var fl = flow(F), ib = inbound(F), ob = outbound(F), ct = counts(F), is = issues(F);
    return [
      { key: 'in', label: '입고 수량', value: ib.good, unit: '개', hint: '검수 합격 후 적치 대상 수량', detail: '입고 ' + ib.n + '건 · 검수 불량 ' + ib.ng + '개', go: 'inbound' },
      { key: 'ship', label: '출고 건수', value: ob.ship, unit: '건', hint: '택배 인계까지 끝난 출고 확정 건수 (재출고 포함)', detail: ob.shipUnits.toLocaleString('ko-KR') + '개 · 재출고 ' + is.reships.length + '건', go: 'outbound' },
      { key: 'same', label: '당일 출고율', value: fl.sameDayRate, unit: '%', target: 0.98, hint: '13시(데모 가정) 전 검증 완료 주문의 당일 출고 비율', detail: fl.sameDay + ' / ' + fl.baseN + '건', go: 'outbound' },
      { key: 'acc', label: '재고 정확도', value: ct.rate, unit: '%', target: 0.9, hint: '주간 실사에서 실물과 전산이 같은 (주 × SKU) 비율', detail: ct.match + ' / ' + ct.n, go: 'stock', na: !ct.n },
      { key: 'mis', label: '오출고율', value: ratio(ob.mispick, ob.ship), unit: '%2', target: 0.001, hint: '출고 확정 주문 중 다른 상품이 나간 비율', detail: ob.mispick + ' / ' + ob.ship + '건', go: 'issues' },
      { key: 'ret', label: '반품 건수', value: is.rets.length, unit: '건', hint: '요청일 기준, 상품군마다 판정 기준이 다름', detail: '입고 완료 ' + is.retDone + '건', go: 'returns' }
    ];
  }
  function indKpis(F) {   // 선택한 상품군에서만 의미 있는 지표. 전체에서는 표시하지 않음
    var ind = F.ind; if (ind === 'ALL') return [];
    var sn = stockNow(F), ob = outbound(F), st = sets(F), is = issues(F), ex = expiry(F), rs = returnStats(F)[0], ib = inbound(F), minSet = st.length ? Math.min.apply(null, st.map(function (s) { return s.can; })) : null;
    var tv = turnover(F)[0], limited = sum(sn, function (r) { return r.limited; }), dmg = sum(sn, function (r) { return r.dmg; });
    if (ind === 'BEA') return [
      { key: 'set', label: '세트 조립 가능 수', value: minSet, unit: '세트', hint: '구성품 가용 재고로 만들 수 있는 최소 세트 수', detail: st.map(function (s) { return IT[s.item].name + ' ' + s.can; }).join(' · ') },
      { key: 'near', label: '사용기한 임박 재고', value: limited, unit: '개', hint: '잔여 60일 미만(학습용 기준) 로트 실물', detail: '로트 관리 대상 ' + ex.lots.length + '개' },
      { key: 'ng', label: '입고 검수 불량', value: ib.ng, unit: '개', hint: '라벨·로트·누액 검수 불합격', detail: '불량률 ' + ((ib.ngRate || 0) * 100).toFixed(2) + '%' },
      { key: 'promo', label: '행사 일평균 주문', value: Math.round(promoPlan(F)[0].perDay), unit: '건', hint: '행사 기간 일평균 주문 (6월, 가정)', detail: '행사 중 지연 ' + promoPlan(F)[0].late + '건' }];
    if (ind === 'FOD') return [
      { key: 'near', label: '소비기한 임박 재고', value: limited, unit: '개', hint: '잔여 60일 미만(학습용 기준) 로트 실물', detail: '출고 제한' },
      { key: 'avg', label: '출고 로트 평균 잔여', value: ex.avgRemain === null ? null : Math.round(ex.avgRemain), unit: '일', hint: 'FEFO 배정된 출고 로트의 평균 잔여 소비기한', detail: '최소 ' + ex.minRemain + '일' },
      { key: 'turn', label: '재고 회전 일수', value: tv.days === null ? null : Math.round(tv.days), unit: '일', hint: '기간 종료일 재고 ÷ 일평균 출고 수량', detail: '일평균 출고 ' + Math.round(tv.outPerDay) + '개' },
      { key: 'delay', label: '수입 입고 지연', value: posIn(F).filter(function (p) { return p.delayed; }).length, unit: '건', hint: '예정일보다 늦어진 수입 발주', detail: '통관 검사 지연 (가정)' }];
    if (ind === 'FSH') return [
      { key: 'out', label: '결품 옵션', value: sn.filter(function (r) { return r.avail <= 0 && IT[r.item].season === 'FW'; }).length, unit: '개', hint: '현 시즌(FW) 색상·사이즈 중 가용 재고 0', detail: '전체 ' + sn.length + '개 옵션' },
      { key: 'rr', label: '반품률', value: rs.rate, unit: '%', target: null, hint: '반품 요청 ÷ 출고 건수', detail: rs.rets + ' / ' + rs.ship + '건' },
      { key: 'resale', label: '재판매 전환율', value: rs.resaleRate, unit: '%', target: null, hint: '입고 완료 반품 중 재판매 가능 판정', detail: rs.resale + ' / ' + rs.done + '건' },
      { key: 'age', label: '장기 재고', value: sum(aging(F, 90).filter(function (a) { return a.season === 'SS'; }), function (a) { return a.lot.good; }), unit: '개', hint: '입고 90일 경과한 지난 시즌(SS) 재고', detail: '기준일 현재' }];
    if (ind === 'HOM') return [
      { key: 'err', label: '출고 오류율', value: ratio(ob.mispick, ob.ship), unit: '%2', hint: '오출고 ÷ 출고 건수', detail: ob.mispick + '건' },
      { key: 'bad', label: '불량·파손 격리', value: dmg + is.whDmgQty, unit: '개', hint: '기준일 격리 재고 + 기간 내 창고 파손', detail: '격리 ' + dmg + ' · 창고 파손 ' + is.whDmgQty },
      { key: 'lines', label: '출고 건당 피킹 라인', value: ratio(ob.pickLines, ob.ship), unit: '라인', hint: '다품종 합포 수준', detail: ob.pickLines + ' / ' + ob.ship },
      { key: 'b2b', label: 'B2B 출고 수량', value: sum(ob.orders.filter(function (o) { return o.ch === 'B2B'; }), function (o) { return units(o.lines); }), unit: '개', hint: 'B2B 납품 출고 수량', detail: ob.orders.filter(function (o) { return o.ch === 'B2B'; }).length + '건' }];
    return [
      { key: 'set', label: '세트 조립 가능 수', value: minSet, unit: '세트', hint: '상자·카드 포함 구성품 기준 최소 세트 수', detail: st.map(function (s) { return IT[s.item].name + ' ' + s.can; }).join(' · ') },
      { key: 'block', label: '최종 검수 재작업', value: ob.optBlock, unit: '건', hint: '출고 전 옵션·구성품 불일치 발견', detail: '출고 ' + ob.ship + '건 중' },
      { key: 'rp', label: '재포장 필요 반품', value: rs.grades['재포장 필요'] || 0, unit: '건', hint: '반품 입고 판정', detail: '반품 ' + rs.rets + '건' },
      { key: 'opt', label: '옵션 상품 출고', value: sum(byItem(F).filter(function (r) { return IT[r.item].option; }), function (r) { return r.units; }), unit: '개', hint: '길이·호수 옵션 상품 출고 수량', detail: '옵션 ' + D.items.filter(function (x) { return x.ind === 'GFT' && x.option; }).length + '종' }];
  }
  function kpiStatus(k) {
    if (k.na || k.value === null || k.value === undefined || k.target === undefined || k.target === null) return null;
    if (k.key === 'mis') return k.value <= k.target ? 'ok' : k.value <= k.target * 2 ? 'warn' : 'risk';
    return k.value >= k.target ? 'ok' : k.value >= k.target - 0.05 ? 'warn' : 'risk';
  }
  function actions(F) {
    var a = [], op = openOrders(F), ob = outbound(F);
    var short = op.filter(function (o) { return o.short && o.waved === null && o.elig <= F.to; });
    if (short.length) a.push({ pri: 1, area: '재고 부족', what: '재고 부족으로 피킹 못 한 주문 ' + short.length + '건', act: '입고 예정일 확인 · 화주사에 출고 지연 공유', go: 'stock' });
    var over = op.filter(function (o) { return o.due < F.to && o.waved !== null; });
    if (over.length) a.push({ pri: 1, area: '미출고', what: '송장 발행 후 출고 기한이 지난 주문 ' + over.length + '건', act: '패킹 우선순위 조정 · 추가 집하 요청', go: 'outbound' });
    if (ob.backlog) a.push({ pri: 2, area: '출고 대기', what: '기간 종료일 포장 대기 ' + ob.backlog + '건', act: '다음 영업일 첫 출고분으로 배정', go: 'outbound' });
    var lastC = D.counts.filter(function (c) { return c.d <= F.to; }).slice(-1)[0];
    if (lastC) lastC.rows.filter(function (r) { return indOk(F, r.ind) && (r.sys !== r.phys || r.dmgSys !== r.dmgPhys); }).forEach(function (r) { a.push({ pri: 2, area: '재고 실사', what: IT[r.item].name + ' 실물 ' + r.phys + ' / 전산 ' + r.sys, act: '이동 이력·파손 기록 확인 후 조정 사유 기록', go: 'stock' }); });
    var lim = sum(stockNow(F), function (r) { return r.limited; });
    if (lim) a.push({ pri: 2, area: '기한 임박', what: '출고 제한(기한 임박) 재고 ' + lim + '개', act: '처리 방법을 화주사와 협의', go: 'stock' });
    return a.sort(function (x, y) { return x.pri - y.pri; });
  }

  global.SCMMetrics = {
    resolveFilter: resolveFilter, withPeriod: withPeriod, indOk: indOk, chOk: chOk, STAGES: STAGES, units: units, sum: sum, ratio: ratio, monthsIn: monthsIn,
    flow: flow, status: status, openOrders: openOrders, orderCheck: orderCheck, inbound: inbound, waveDays: waveDays, picking: picking, daily: daily, outbound: outbound,
    counts: counts, countCauses: countCauses, lotState: lotState, stockNow: stockNow, zones: zones, movesIn: movesIn, posIn: posIn, turnover: turnover, expiry: expiry, BUCKETS: BUCKETS,
    sets: sets, matrix: matrix, seasonFlow: seasonFlow, aging: aging, byItem: byItem, weeklyByItem: weeklyByItem, promoPlan: promoPlan, labor: labor, laborRow: laborRow,
    issues: issues, returnStats: returnStats, CAUSES: CAUSES, settlement: settlement, integrity: integrity, improve: improve, pivot: pivot, PIVOT_DIM: PIVOT_DIM, PIVOT_VAL: PIVOT_VAL,
    commonKpis: commonKpis, indKpis: indKpis, kpiStatus: kpiStatus, actions: actions
  };
})(typeof window !== 'undefined' ? window : globalThis);
