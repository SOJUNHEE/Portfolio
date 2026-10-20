/* =====================================================================
 * js/metrics.js — 지표 계산 (화면·CSV·점검 스크립트가 모두 이 함수만 사용)
 * ---------------------------------------------------------------------
 * 필터 F = { from, to, days, brand('ALL'|A~D), type('ALL'|'B2C'|'B2B') }
 * - 기간 기준은 지표마다 다릅니다. 함수 주석에 적은 기준일(납기일·출고일·도착일 등)로 셉니다.
 * - 재고·로케이션·오늘 현황은 기준 시각(마지막 날 15:30) 스냅숏이라 기간 필터를 쓰지 않습니다.
 * ===================================================================== */
(function (global) {
  'use strict';
  var D = global.SCM_DATA, C = D.cal, M = D.meta, END = M.END_DAY, NOW = M.NOW;
  var BR = {};
  D.brands.forEach(function (b) { BR[b.id] = b; });

  /* ---------------- 필터 ---------------- */
  function resolveFilter(f) {
    var to = END, from;
    switch (f.period) {
      case '7d': from = END - 6; break;
      case '30d': from = END - 29; break;
      case '90d': from = END - 89; break;
      case 'all': from = 0; break;
      case 'custom':
        from = Math.max(0, Math.min(END, C.dayOf(f.from)));
        to = Math.max(0, Math.min(END, C.dayOf(f.to)));
        if (from > to) { var t = from; from = to; to = t; }
        break;
      default: from = END - 89;
    }
    return { from: from, to: to, days: to - from + 1, brand: f.brand || 'ALL', type: f.type || 'ALL', period: f.period };
  }
  function withPeriod(F, from, to) {
    return { from: from, to: to, days: to - from + 1, brand: F.brand, type: F.type, period: 'custom' };
  }
  function bOk(F, id) { return F.brand === 'ALL' || F.brand === id; }
  function b2cOn(F) { return F.type !== 'B2B'; }
  function b2bOn(F) { return F.type !== 'B2C'; }
  function brandList(F) { return D.brands.filter(function (b) { return bOk(F, b.id); }); }
  function ratio(n, d) { return d ? n / d : null; }
  function sum(a, f) { var s = 0; for (var i = 0; i < a.length; i++) s += f ? f(a[i]) : a[i]; return s; }
  function units(o) { return sum(o.lines, function (l) { return l[1]; }); }
  function inR(d, F) { return d !== null && d !== undefined && d >= F.from && d <= F.to; }
  function prevPeriod(F) { var len = F.days; return withPeriod(F, Math.max(0, F.from - len), Math.max(0, F.from - 1)); }
  function bizDiff(a, b) { var n = 0; for (var d = a; d < b; d++) if (C.isBiz(d + 1)) n++; return n; }

  /* ---------------- 오늘(기준 시각) 현황 ---------------- */
  // 출고 대상 = 납기(due)가 오늘 이하이고 오늘 이전에 출고되지 않은 B2C 주문(화주사 요청 보류는 제외)
  // 마감 위험 = 기준 시각에 피킹 전이고 출고 예정이 17:00 이후이거나, 오늘 처리 계획에 들어가지 못한 주문
  function stageAtNow(o) {
    if (o.ship === END) return '출고 완료';
    if (o.plan === null) return '처리 대기';
    if (o.pickT > NOW) return '피킹 대기';
    if (o.packT > NOW) return '패킹 중';
    return '출고(상차) 대기';
  }
  function isRisk(o) { return o.ship === null && (o.plan === null || (o.plan > 17 * 60 && o.pickT > NOW)); }
  function todayB2c(F) {
    return D.orders.filter(function (o) {
      return bOk(F, o.brand) && o.due <= END && (o.ship === null || o.ship === END) && (o.hold === null || o.hold <= END);
    });
  }
  function today(F) {
    var list = b2cOn(F) ? todayB2c(F) : [];
    var r = { target: list.length, done: 0, inprog: 0, risk: 0, backlog: 0, stages: {}, brands: [] };
    var by = {};
    D.brands.forEach(function (b) { if (bOk(F, b.id)) by[b.id] = { id: b.id, name: b.name, cat: b.cat, target: 0, done: 0, inprog: 0, risk: 0 }; });
    list.forEach(function (o) {
      var st = stageAtNow(o), x = by[o.brand];
      x.target++;
      if (st === '출고 완료') { r.done++; x.done++; } else { r.inprog++; x.inprog++; }
      if (isRisk(o)) { r.risk++; x.risk++; }
      if (o.due < END) r.backlog++;
      r.stages[st] = (r.stages[st] || 0) + 1;
    });
    r.progress = ratio(r.done, r.target);
    r.brands = Object.keys(by).map(function (k) { var x = by[k]; x.progress = ratio(x.done, x.target); return x; });
    var lb = D.labor[D.labor.length - 1];
    r.staffAct = sum(Object.keys(lb.act), function (k) { return lb.act[k]; });
    r.staffPlan = sum(Object.keys(lb.plan), function (k) { return lb.plan[k]; });
    r.labor = lb;
    var b2bOpen = b2bOn(F) ? D.b2b.filter(function (x) { return bOk(F, x.brand) && x.ship === null; }) : [];
    r.b2bOpen = b2bOpen.length;
    r.b2bDueToday = b2bOpen.filter(function (x) { return x.due <= END; }).length;
    r.b2bOverdue = b2bOpen.filter(function (x) { return x.due < END; }).length;
    // 전일(직전 영업일) 비교
    var prev = END - 1; while (!C.isBiz(prev)) prev--;
    var pl = D.labor.filter(function (l) { return l.day === prev; })[0];
    r.prevDay = prev;
    r.prevShipped = b2cOn(F) ? D.shipByDay[prev].filter(function (o) { return bOk(F, o.brand); }).length : 0;
    r.prevStaff = pl ? sum(Object.keys(pl.act), function (k) { return pl.act[k]; }) : null;
    return r;
  }

  /* ---------------- 출고 SLA (B2C) — 납기일 기준 ---------------- */
  // 대상: 납기일이 기간 안인 B2C 주문. 화주사 요청 보류 건은 SLA에서 제외, 오늘 납기이면서 아직 처리 중인 건도 제외
  function slaBase(F) {
    var out = [];
    if (!b2cOn(F)) return out;
    for (var i = 0; i < D.orders.length; i++) {
      var o = D.orders[i];
      if (o.due < F.from || o.due > F.to || !bOk(F, o.brand) || o.hold !== null) continue;
      if (o.due === END && o.ship === null) continue;
      out.push(o);
    }
    return out;
  }
  function onTime(o) { return o.ship !== null && o.ship <= o.due; }
  function sla(F) {
    var base = slaBase(F), late = base.filter(function (o) { return !onTime(o); });
    var causes = {};
    late.forEach(function (o) { causes[o.cause] = (causes[o.cause] || 0) + 1; });
    var holds = b2cOn(F) ? D.orders.filter(function (o) { return o.hold !== null && inR(o.due, F) && bOk(F, o.brand); }).length : 0;
    var byBrand = brandList(F).map(function (b) {
      var bb = base.filter(function (o) { return o.brand === b.id; }), lt = bb.filter(function (o) { return !onTime(o); }).length;
      return { id: b.id, name: b.name, target: b.sla, n: bb.length, late: lt, rate: ratio(bb.length - lt, bb.length), cutoff: b.cutoff };
    });
    return { n: base.length, late: late.length, onTime: base.length - late.length, rate: ratio(base.length - late.length, base.length), causes: causes, holds: holds, byBrand: byBrand, lateList: late };
  }
  function slaDaily(F) {
    var rows = [];
    for (var d = F.from; d <= F.to; d++) if (C.isBiz(d)) rows.push({ day: d, n: 0, late: 0, by: {} });
    var idx = {};
    rows.forEach(function (r, i) { idx[r.day] = i; });
    slaBase(F).forEach(function (o) {
      var r = rows[idx[o.due]];
      if (!r) return;
      r.n++; if (!onTime(o)) r.late++;
      var x = r.by[o.brand] || (r.by[o.brand] = { n: 0, late: 0 });
      x.n++; if (!onTime(o)) x.late++;
    });
    rows.forEach(function (r) { r.rate = ratio(r.n - r.late, r.n); });
    return rows;
  }

  /* ---------------- B2B 납품 — 납기일 기준 ---------------- */
  function b2bDone(x) { return x.ship !== null; }
  function b2b(F) {
    if (!b2bOn(F)) return { n: 0, late: 0, rate: null, list: [], fill: null, qty: 0, shipQty: 0, causes: {}, shippedPcs: 0, shortOrders: 0 };
    var list = D.b2b.filter(function (x) { return bOk(F, x.brand) && inR(x.due, F) && (x.due < END || b2bDone(x)); });
    var late = list.filter(function (x) { return x.late; });
    var started = D.b2b.filter(function (x) { return bOk(F, x.brand) && inR(x.day, F) && x.alloc !== null; });
    var causes = {};
    late.forEach(function (x) { causes[x.cause] = (causes[x.cause] || 0) + 1; });
    var shippedPcs = sum(D.b2b.filter(function (x) { return bOk(F, x.brand) && inR(x.ship, F); }), function (x) { return x.shipQty; });
    return { n: list.length, late: late.length, rate: ratio(list.length - late.length, list.length), list: list, causes: causes,
      qty: sum(started, function (x) { return x.qty; }), shipQty: sum(started, function (x) { return x.shipQty; }), fill: ratio(sum(started, function (x) { return x.shipQty; }), sum(started, function (x) { return x.qty; })),
      shippedPcs: shippedPcs, shortOrders: started.filter(function (x) { return x.short > 0; }).length };
  }
  function b2bStatus(x) {
    if (x.ship !== null) return x.late ? '납기 후 출고' : '납기 내 출고';
    if (x.plan !== undefined) return '작업 완료 · 상차 예정';
    if (x.due < END) return '납기 초과 · 작업 중';
    if (x.alloc !== null) return '작업 중';
    return '작업 대기';
  }
  function b2bSchedule(F) {   // 오늘 기준 앞뒤 일정(기간 필터 미적용)
    return D.b2b.filter(function (x) { return bOk(F, x.brand) && b2bOn(F) && (x.ship === null || x.ship >= END - 6); })
      .sort(function (a, b) { return a.due - b.due || a.day - b.day; });
  }

  /* ---------------- 출고 일별 ---------------- */
  function outboundDaily(F) {
    var rows = [];
    for (var d = F.from; d <= F.to; d++) {
      var rec = b2cOn(F) ? D.ordersByDay[d].filter(function (o) { return bOk(F, o.brand) && !o.ex; }).length : 0;
      var ex = b2cOn(F) ? D.ordersByDay[d].filter(function (o) { return bOk(F, o.brand) && o.ex; }).length : 0;
      var sh = b2cOn(F) ? D.shipByDay[d].filter(function (o) { return bOk(F, o.brand); }) : [];
      var b2bPcs = b2bOn(F) ? sum(D.b2b.filter(function (x) { return bOk(F, x.brand) && x.ship === d; }), function (x) { return x.shipQty; }) : 0;
      var lb = D.labor.filter(function (l) { return l.day === d; })[0];
      rows.push({ day: d, biz: C.isBiz(d), received: rec, exchange: ex, shipped: sh.length, shippedUnits: sum(sh, units), b2bPcs: b2bPcs, cap: lb ? lb.vol.b2cCap : 0, queue: lb ? lb.vol.b2cQueue : 0 });
    }
    return rows;
  }
  function orderHours(F) {   // 시간대별 주문 접수(B2C)
    var h = []; for (var i = 0; i < 24; i++) h.push(0);
    if (!b2cOn(F)) return h;
    for (var d = F.from; d <= F.to; d++) D.ordersByDay[d].forEach(function (o) { if (bOk(F, o.brand) && !o.ex) h[Math.floor(o.t / 60)]++; });
    return h;
  }
  function misship(F) {
    var shipped = 0, mis = [], types = {};
    if (!b2cOn(F)) return { shipped: 0, n: 0, rate: null, list: [], types: {} };
    for (var d = F.from; d <= F.to; d++) D.shipByDay[d].forEach(function (o) {
      if (!bOk(F, o.brand)) return;
      shipped++;
      if (o.mis) { mis.push(o); types[o.mis] = (types[o.mis] || 0) + 1; }
    });
    return { shipped: shipped, n: mis.length, rate: ratio(mis.length, shipped), list: mis, types: types };
  }

  /* ---------------- 입고 — 도착일 기준 ---------------- */
  function inbound(F) {
    var list = D.inbound.filter(function (x) { return bOk(F, x.brand) && inR(x.arrive, F); });
    var done = list.filter(function (x) { return x.putaway !== null && x.putaway <= END; });
    var leads = done.map(function (x) { return bizDiff(x.arrive, x.putaway); });
    var pending = D.inbound.filter(function (x) { return bOk(F, x.brand) && x.arrive <= F.to && (x.putaway === null || x.putaway > F.to); });
    return { n: list.length, asn: sum(list, function (x) { return x.asnQty; }), recv: sum(list, function (x) { return x.recvQty; }), diff: sum(list, function (x) { return x.diff; }),
      diffN: list.filter(function (x) { return x.diff > 0; }).length, defect: sum(list, function (x) { return x.defect; }),
      sameDay: leads.filter(function (v) { return v === 0; }).length, avgLead: leads.length ? sum(leads) / leads.length : null, leadN: leads.length,
      pending: pending, pendingQty: sum(pending, function (x) { return x.recvQty - (x.putaway !== null && x.putaway <= F.to ? x.recvQty : Math.min(x.recvQty, x.done)); }), list: list };
  }
  function inboundLead(x) { return x.putaway === null ? null : bizDiff(x.arrive, x.putaway); }

  /* ---------------- 재고·로케이션 — 기준 시각 스냅숏 ---------------- */
  function skuOut(i, from, to) {   // 기간 출고 수량(B2C + B2B)
    var s = 0;
    for (var d = from; d <= to; d++) D.shipByDay[d].forEach(function (o) { o.lines.forEach(function (l) { if (l[0] === i) s += l[1]; }); });
    D.b2b.forEach(function (x) { if (x.ship !== null && x.ship >= from && x.ship <= to) x.alloc.forEach(function (l) { if (l[0] === i) s += l[1]; }); });
    return s;
  }
  var outCache = null;
  function out14() {
    if (outCache) return outCache;
    outCache = D.skus.map(function () { return 0; });
    var from = END - 14, to = END - 1;
    for (var d = from; d <= to; d++) D.shipByDay[d].forEach(function (o) { o.lines.forEach(function (l) { outCache[l[0]] += l[1]; }); });
    D.b2b.forEach(function (x) { if (x.ship !== null && x.ship >= from && x.ship <= to) x.alloc.forEach(function (l) { outCache[l[0]] += l[1]; }); });
    return outCache;
  }
  var waitCache = null;
  function waitingOrders(i) {   // 결품으로 처리 계획에 들어가지 못한 주문 수(기준 시각)
    if (!waitCache) {
      waitCache = D.skus.map(function () { return 0; });
      D.orders.forEach(function (o) {
        if (o.ship !== null || o.plan !== null || o.due > END) return;
        if (!o.lines.some(function (l) { return D.stock[l[0]] < l[1]; })) return;
        o.lines.forEach(function (l) { waitCache[l[0]]++; });
      });
    }
    return waitCache[i];
  }
  function stockStatus(r) {
    if (r.avail <= 0 || r.waiting > 0) return '결품';
    if (r.cover !== null && r.cover < 7) return '결품 위험';
    if (r.season === 'SS' && r.cover !== null && r.cover > 60) return '시즌 이월 검토';
    if (r.cover === null || r.cover > 120) return '과잉';
    return '정상';
  }
  function stockView(F) {
    var o14 = out14();
    return D.skus.filter(function (s) { return bOk(F, s.brand); }).map(function (s) {
      var avail = D.stock[s.idx], al = D.alloc[s.idx], daily = o14[s.idx] / 14;
      var r = { sku: s.idx, id: s.id, brand: s.brand, style: s.style, styleName: s.styleName, color: s.color, size: s.size, season: s.season, cat: s.cat, loc: s.loc,
        onHand: avail + al, alloc: al, avail: avail, daily: daily, cover: daily > 0 ? avail / daily : null, waiting: waitingOrders(s.idx), zeroDays: D.skuZeroDays[s.idx].length };
      r.status = stockStatus(r);
      return r;
    });
  }
  function matrix(styleId) {
    var st = D.styles.filter(function (x) { return x.id === styleId; })[0];
    return { style: st, rows: st.colors.map(function (c) {
      return { color: c, cells: st.sizes.map(function (z) { var s = D.skus.filter(function (k) { return k.style === styleId && k.color === c && k.size === z; })[0]; return { size: z, sku: s.idx, avail: D.stock[s.idx] }; }) };
    }) };
  }
  function cycleCount(F) {
    var list = D.cycle.filter(function (c) { return bOk(F, c.brand) && inR(c.day, F); });
    var locs = sum(list, function (c) { return c.locs; }), matched = sum(list, function (c) { return c.matched; });
    return { list: list, locs: locs, matched: matched, rate: ratio(matched, locs), diffLocs: locs - matched, diffUnits: sum(list, function (c) { return c.diffUnits; }) };
  }
  function stockoutEvents(F) {   // 결품(마감 재고 0) 구간
    var out = [];
    D.skus.forEach(function (s) {
      if (!bOk(F, s.brand)) return;
      var z = D.skuZeroDays[s.idx].filter(function (d) { return inR(d, F); });
      if (!z.length) return;
      var start = z[0], prev = z[0];
      for (var i = 1; i <= z.length; i++) {
        if (i < z.length && z[i] <= prev + 3) { prev = z[i]; continue; }
        var late = D.orders.filter(function (o) { return o.cause === '결품 대기' && o.due >= start && o.due <= prev + 3 && o.lines.some(function (l) { return l[0] === s.idx; }); }).length;
        out.push({ sku: s.idx, id: s.id, brand: s.brand, name: s.name, from: start, to: prev, days: z.filter(function (d) { return d >= start && d <= prev; }).length, lateOrders: late });
        if (i < z.length) { start = z[i]; prev = z[i]; }
      }
    });
    return out.sort(function (a, b) { return b.lateOrders - a.lateOrders || b.days - a.days; });
  }

  /* ---------------- 공간·적치율·시즌 재고 ---------------- */
  function zones(F) {
    return brandList(F).map(function (b) {
      var onHand = sum(D.skus.filter(function (s) { return s.brand === b.id; }), function (s) { return D.stock[s.idx] + D.alloc[s.idx]; });
      var pal = onHand / b.palletPcs;
      var seas = { SS: 0, FW: 0, ALL: 0 };
      D.skus.forEach(function (s) { if (s.brand === b.id) seas[s.season] += D.stock[s.idx] + D.alloc[s.idx]; });
      return { id: b.id, name: b.name, zone: b.zone + '존', cat: b.cat, onHand: onHand, pallets: pal, cap: b.pallets, util: pal / b.pallets, season: seas, palletPcs: b.palletPcs };
    });
  }
  function zoneDaily(F) {
    var rows = [];
    for (var d = F.from; d <= F.to; d++) {
      var r = { day: d };
      brandList(F).forEach(function (b) { r[b.id] = D.stockDaily[d][b.id] / b.palletPcs / b.pallets; });
      rows.push(r);
    }
    return rows;
  }
  function utilStatus(u) { return u >= 0.95 ? 'risk' : u >= 0.85 ? 'warn' : 'ok'; }

  /* ---------------- 반품·교환 — 도착일·처리일 기준 ---------------- */
  function returns(F) {
    var arr = D.returns.filter(function (r) { return bOk(F, r.brand) && inR(r.arrive, F); });
    var done = D.returns.filter(function (r) { return bOk(F, r.brand) && inR(r.done, F); });
    var backlog = D.returns.filter(function (r) { return bOk(F, r.brand) && r.arrive <= F.to && (r.done === null || r.done > F.to); });
    var leads = done.map(function (r) { return bizDiff(r.arrive, r.done); });
    var reasons = {}, grades = {};
    arr.forEach(function (r) { reasons[r.reason] = (reasons[r.reason] || 0) + 1; });
    done.forEach(function (r) { grades[r.grade] = (grades[r.grade] || 0) + 1; });
    var oldest = backlog.length ? Math.max.apply(null, backlog.map(function (r) { return bizDiff(r.arrive, F.to); })) : 0;
    return { arrived: arr.length, done: done.length, backlog: backlog.length, backlogList: backlog, avgLead: leads.length ? sum(leads) / leads.length : null,
      within2: leads.filter(function (v) { return v <= 2; }).length, reasons: reasons, grades: grades, oldest: oldest,
      exchanges: done.filter(function (r) { return r.exOrder; }).length, list: done };
  }
  function returnsDaily(F) {
    var rows = [];
    for (var d = F.from; d <= F.to; d++) rows.push({ day: d, arrived: 0, done: 0, backlog: 0 });
    D.returns.forEach(function (r) {
      if (!bOk(F, r.brand)) return;
      if (inR(r.arrive, F)) rows[r.arrive - F.from].arrived++;
      if (inR(r.done, F)) rows[r.done - F.from].done++;
    });
    rows.forEach(function (row) {
      row.backlog = D.returns.filter(function (r) { return bOk(F, r.brand) && r.arrive <= row.day && (r.done === null || r.done > row.day); }).length;
    });
    return rows;
  }
  function returnRate(F) {   // 반품률 = 기간 도착 반품(오출고 회수 제외) / 기간 출고(교환 출고 제외)
    var shipped = 0;
    for (var d = F.from; d <= F.to; d++) D.shipByDay[d].forEach(function (o) { if (bOk(F, o.brand) && !o.ex) shipped++; });
    var r = D.returns.filter(function (x) { return bOk(F, x.brand) && inR(x.arrive, F) && x.reason !== '오출고 회수'; }).length;
    return { returns: r, shipped: shipped, rate: ratio(r, shipped) };
  }

  /* ---------------- 인력·생산성 — 근무일 기준 (센터 공통, 화주사 필터 미적용) ---------------- */
  var PROC = [
    { key: 'b2c', label: 'B2C 피킹·패킹', unit: '건', std: function () { return M.STD.b2c; } },
    { key: 'b2b', label: 'B2B 출고', unit: 'pcs', std: function () { return M.STD.b2b; } },
    { key: 'inbound', label: '입고 검수·적치', unit: 'pcs', std: function () { return M.STD.inbound; } },
    { key: 'ret', label: '반품 검수', unit: 'pcs', std: function () { return M.STD.ret; } }
  ];
  function laborDays(F) { return D.labor.filter(function (l) { return inR(l.day, F); }); }
  function labor(F) {
    var days = laborDays(F);
    var proc = PROC.map(function (p) {
      var vol = sum(days, function (l) { return l.vol[p.key]; }), hrs = sum(days, function (l) { return l.hours[p.key]; });
      var req = sum(days, function (l) { return l.req[p.key]; });
      return { key: p.key, label: p.label, unit: p.unit, std: p.std(), vol: vol, hours: hrs, uph: ratio(vol, hrs), req: req };
    });
    var short = days.filter(function (l) { return sum(PROC, function (p) { return l.plan[p.key] - l.act[p.key]; }) >= 4 || l.vol.b2cQueue > l.vol.b2cCap; });
    return { days: days, proc: proc, otH: sum(days, function (l) { return l.otH * l.act.b2c; }), temps: sum(days, function (l) { return l.temps; }),
      planHead: sum(days, function (l) { return sum(PROC, function (p) { return l.plan[p.key]; }); }), actHead: sum(days, function (l) { return sum(PROC, function (p) { return l.act[p.key]; }); }),
      shortDays: short, b2cUph: ratio(sum(days, function (l) { return l.vol.b2c; }), sum(days, function (l) { return l.hours.b2c; })) };
  }
  function laborRow(l) {
    return { day: l.day, plan: sum(PROC, function (p) { return l.plan[p.key]; }), act: sum(PROC, function (p) { return l.act[p.key]; }), temps: l.temps, otH: l.otH,
      queue: l.vol.b2cQueue, cap: l.vol.b2cCap, shipped: l.vol.b2c, reqH: sum(PROC, function (p) { return l.req[p.key]; }), availH: sum(PROC, function (p) { return l.hours[p.key]; }), l: l };
  }

  /* ---------------- 정산 — 월 단위 ---------------- */
  // 실적 수량은 WMS 기록(입고 적치·출고·반품 처리·일별 재고)에서 다시 계산하고, 청구서(가상)와 대조합니다.
  function monthQty(b, m) {
    var r = C.monthRange(m), q = { inbound: 0, storagePalletDays: 0, b2cOrders: 0, b2cExtra: 0, b2b: 0, ret: 0 };
    D.inbound.forEach(function (x) { if (x.brand === b.id && x.putaway !== null && x.putaway >= r[0] && x.putaway <= r[1]) q.inbound += x.recvQty; });
    for (var d = r[0]; d <= r[1]; d++) {
      q.storagePalletDays += D.stockDaily[d][b.id] / b.palletPcs;
      D.shipByDay[d].forEach(function (o) { if (o.brand === b.id && !o.ex) { q.b2cOrders++; q.b2cExtra += units(o) - 1; } });
    }
    D.b2b.forEach(function (x) { if (x.brand === b.id && x.ship !== null && x.ship >= r[0] && x.ship <= r[1]) q.b2b += x.shipQty; });
    D.returns.forEach(function (x) { if (x.brand === b.id && x.done !== null && x.done >= r[0] && x.done <= r[1] && x.reason !== '오출고 회수') q.ret++; });
    q.storagePalletDays = Math.round(q.storagePalletDays);
    return q;
  }
  var billCache = {};
  function billMonths(F) { return C.months.filter(function (m) { var r = C.monthRange(m); return r[1] >= F.from && r[0] <= F.to; }); }
  function billing(F) {
    var rows = [];
    billMonths(F).forEach(function (m) {
      brandList(F).forEach(function (b) {
        var key = m + b.id, q = billCache[key] || (billCache[key] = monthQty(b, m));
        D.billItems.forEach(function (it) {
          var qty = it.qty(q), rate = b.rates[it.rate], amt = Math.round(qty * rate);
          var inv = D.invoices.filter(function (v) { return v.month === m && v.brand === b.id && v.item === it.key; })[0];
          rows.push({ month: m, brand: b.id, item: it.key, label: it.label, unit: it.unit, qty: qty, rate: rate, actual: amt,
            billQty: inv.qty, billRate: inv.rate, billed: inv.amount, diff: inv.amount - amt, note: inv.note, status: inv.status });
        });
      });
    });
    var byMonth = {};
    rows.forEach(function (r) { var k = r.month; byMonth[k] = byMonth[k] || { month: k, actual: 0, billed: 0, diff: 0, orders: 0 }; byMonth[k].actual += r.actual; byMonth[k].billed += r.billed; byMonth[k].diff += r.diff; if (r.item === 'b2c') byMonth[k].orders += r.qty; });
    var byBrand = brandList(F).map(function (b) {
      var rs = rows.filter(function (r) { return r.brand === b.id; });
      return { id: b.id, name: b.name, actual: sum(rs, function (r) { return r.actual; }), billed: sum(rs, function (r) { return r.billed; }), diff: sum(rs, function (r) { return r.diff; }), orders: sum(rs.filter(function (r) { return r.item === 'b2c'; }), function (r) { return r.qty; }) };
    });
    return { rows: rows, months: Object.keys(byMonth).map(function (k) { return byMonth[k]; }), byBrand: byBrand,
      actual: sum(rows, function (r) { return r.actual; }), billed: sum(rows, function (r) { return r.billed; }), diff: sum(rows, function (r) { return r.diff; }),
      diffRows: rows.filter(function (r) { return r.diff !== 0; }) };
  }

  /* ---------------- 표준 KPI ---------------- */
  var KPI_DEF = [
    { key: 'sla', label: '출고 SLA 준수율', unit: '%', target: 0.98, dir: 'up', hint: '납기일이 기간 안인 B2C 주문 중 납기일 안에 출고한 비율', go: 'sla' },
    { key: 'b2b', label: 'B2B 납기 준수율', unit: '%', target: 0.95, dir: 'up', hint: '납기일이 기간 안인 B2B 발주 중 납기 안에 출고한 비율', go: 'b2b' },
    { key: 'acc', label: '재고 정확도', unit: '%', target: 0.995, dir: 'up', hint: '월말 실사 로케이션 중 전산 수량과 일치한 비율', go: 'inventory' },
    { key: 'mis', label: '오출고율', unit: '%', target: 0.001, dir: 'down', hint: '출고 건 중 다른 사이즈·색상·수량으로 나간 건', go: 'b2c' },
    { key: 'uph', label: 'B2C 작업 생산성', unit: '건/시간', target: Math.round(M.STD.b2c * 0.9 * 100) / 100, dir: 'up', hint: 'B2C 출고 건 ÷ B2C 투입 시간(연장·대기 포함) · 센터 공통 · 목표 = 표준의 90%', go: 'labor' },
    { key: 'ret', label: '반품 처리 시간', unit: '영업일', target: 2, dir: 'down', hint: '반품 도착 → 검수·분류 완료 평균(처리일 기준)', go: 'returns' },
    { key: 'bill', label: '정산 차이', unit: '원', target: 0, dir: 'zero', hint: '청구 금액 − WMS 실적 기준 금액(기간이 걸친 달)', go: 'billing' }
  ];
  function kpiValue(key, F) {
    switch (key) {
      case 'sla': var s = sla(F); return { v: s.rate, n: s.n, num: s.onTime, na: !b2cOn(F) || !s.n };
      case 'b2b': var b = b2b(F); return { v: b.rate, n: b.n, num: b.n - b.late, na: !b2bOn(F) || !b.n };
      case 'acc': var c = cycleCount(F); return { v: c.rate, n: c.locs, num: c.matched, na: !c.locs };
      case 'mis': var m = misship(F); return { v: m.rate, n: m.shipped, num: m.n, na: !b2cOn(F) || !m.shipped };
      case 'uph': var l = labor(F); return { v: l.b2cUph, n: l.days.length, na: !l.days.length };
      case 'ret': var r = returns(F); return { v: r.avgLead, n: r.done, na: !r.done };
      case 'bill': var bl = billing(F); return { v: bl.diff, n: bl.diffRows.length, months: billMonths(F).length, na: !bl.rows.length };
    }
  }
  function kpiStatus(def, v) {
    if (v === null || v === undefined) return null;
    switch (def.key) {
      case 'sla': return v >= def.target ? 'ok' : v >= def.target - 0.03 ? 'warn' : 'risk';
      case 'b2b': return v >= def.target ? 'ok' : v >= def.target - 0.05 ? 'warn' : 'risk';
      case 'acc': return v >= def.target ? 'ok' : v >= 0.99 ? 'warn' : 'risk';
      case 'mis': return v <= def.target ? 'ok' : v <= def.target * 2 ? 'warn' : 'risk';
      case 'uph': return v >= def.target ? 'ok' : v >= def.target * 0.93 ? 'warn' : 'risk';
      case 'ret': return v <= def.target ? 'ok' : v <= def.target * 2 ? 'warn' : 'risk';
      case 'bill': return v === 0 ? 'ok' : Math.abs(v) < 300000 ? 'warn' : 'risk';
    }
  }
  function kpis(F) {
    var P = prevPeriod(F);
    return KPI_DEF.map(function (def) {
      var cur = kpiValue(def.key, F), prev = F.from > 0 ? kpiValue(def.key, P) : null;
      return { key: def.key, label: def.label, unit: def.unit, target: def.target, dir: def.dir, hint: def.hint, go: def.go,
        value: cur.v, detail: cur, na: cur.na, status: cur.na ? null : kpiStatus(def, cur.v),
        prev: prev && !prev.na ? prev.v : null, prevFrom: P.from, prevTo: P.to };
    });
  }

  /* ---------------- 운영 이슈 로그 ---------------- */
  function issues(F) {
    var out = [];
    // 1) B2C 지연이 몰린 날(화주사·원인별 20건 이상)
    var g = {};
    slaBase(F).forEach(function (o) {
      if (onTime(o)) return;
      var k = o.due + '|' + o.brand + '|' + o.cause;
      g[k] = (g[k] || 0) + 1;
    });
    Object.keys(g).forEach(function (k) {
      var p = k.split('|'), n = g[k];
      if (n < 20) return;
      out.push({ day: +p[0], brand: p[1], area: 'B2C 출고', title: '출고 SLA 미준수 ' + n + '건', cause: p[2], impact: n + '건 납기 다음 날 이후 출고',
        action: p[2] === '결품 대기' ? '화주사에 입고 일정 확인 · 부분 출고·취소 안내 협의' : p[2] === '작업 인력 부족' ? '결원 공정에 타 공정 인원 재배치 · 단기 인력 추가 요청' : p[2] === '프로모션 물량 급증' ? '기획전 물량 사전 공유 기준 정비 · 단기 인력 확보 상향' : '연휴·주말 다음 날 인원 계획 상향 · 전날 사전 피킹 검토',
        status: 'closed', go: 'sla', sev: n >= 200 ? 'risk' : 'warn' });
    });
    // 2) B2B 납기 지연
    b2b(F).list.filter(function (x) { return x.late; }).forEach(function (x) {
      out.push({ day: x.due, brand: x.brand, area: 'B2B 납품', title: x.dest + ' 납품 ' + (x.ship !== null ? C.isoOf(x.ship).slice(5) + ' 출고(납기 초과)' : '미출고'), cause: x.cause,
        impact: x.qty.toLocaleString('ko-KR') + 'pcs · 납기 ' + C.isoOf(x.due).slice(5), action: '납품처에 도착 일정 재안내 · 대량 발주는 납기 협의 단계에서 작업 가능량 확인', status: x.ship !== null ? 'closed' : 'open', go: 'b2b', sev: 'risk' });
    });
    // 3) 결품 구간
    stockoutEvents(F).forEach(function (e) {
      out.push({ day: e.from, brand: e.brand, area: '재고', title: e.name + ' 결품 ' + e.days + '일', cause: e.id === M.scenarioDays.stockoutSku ? '생산 지연으로 입고 중단(가상 시나리오)' : '판매 속도 대비 입고 주기 부족',
        impact: '결품 대기 지연 ' + e.lateOrders + '건', action: '결품 위험 SKU 사전 공유 · 재입고분 우선 적치', status: e.to >= END - 1 ? 'open' : 'closed', go: 'inventory', sev: e.lateOrders >= 50 ? 'risk' : 'warn' });
    });
    // 4) 입고 수량 차이
    inbound(F).list.filter(function (x) { return x.diff > 0; }).forEach(function (x) {
      out.push({ day: x.arrive, brand: x.brand, area: '입고', title: x.id + ' 입고 예정 대비 ' + x.diff + 'pcs 부족', cause: '입고 예정(ASN)과 실물 수량 차이', impact: '전산 재고 반영 전 확인 필요',
        action: x.diffNote, status: 'closed', go: 'inbound', sev: 'warn' });
    });
    // 5) 재고 실사 불일치
    cycleCount(F).list.filter(function (c) { return c.diffLocs > 0; }).forEach(function (c) {
      out.push({ day: c.day, brand: c.brand, area: '재고 실사', title: c.month.replace('-', '.') + ' 실사 불일치 ' + c.diffLocs + '로케이션', cause: c.note, impact: c.diffUnits + 'pcs 차이 조정',
        action: c.diffLocs >= 3 ? '반품 재입고 시 사이즈별 위치 재확인 · 해당 존 재실사' : '해당 로케이션 재실사 후 조정', status: 'closed', go: 'inventory', sev: c.diffLocs >= 3 ? 'risk' : 'warn' });
    });
    // 6) 정산 차이
    billing(F).diffRows.forEach(function (r) {
      out.push({ day: C.monthRange(r.month)[1], brand: r.brand, area: '정산', title: r.month.replace('-', '.') + ' ' + r.label + ' 청구 차이 ' + (r.diff > 0 ? '+' : '') + r.diff.toLocaleString('ko-KR') + '원', cause: r.note,
        impact: r.diff > 0 ? '과다 청구' : '과소 청구', action: r.status === '가집계(마감 전)' ? '청구서 확정 전 수정' : '수정 청구서 발행 · 화주사 공유', status: r.status === '가집계(마감 전)' ? 'open' : 'closed', go: 'billing', sev: 'warn' });
    });
    // 7) 반품 적체(대기 300건 이상인 날의 시작일)
    var rd = returnsDaily(F), inRun = false;
    rd.forEach(function (r, i) {
      if (r.backlog >= 300 && !inRun) {
        inRun = true;
        var j = i; while (j + 1 < rd.length && rd[j + 1].backlog >= 300) j++;
        var peak = Math.max.apply(null, rd.slice(i, j + 1).map(function (x) { return x.backlog; }));
        out.push({ day: r.day, brand: F.brand === 'ALL' ? '전체' : F.brand, area: '반품', title: '반품 검수 대기 ' + peak + '건까지 증가', cause: '시즌오프·기획전 반품 증가 대비 반품 인원 1명', impact: (j - i + 1) + '일간 대기 300건 이상',
          action: '반품 인원 추가(9/21부터 2명) · 교환 건 우선 검수', status: rd[rd.length - 1].backlog >= 300 ? 'open' : 'closed', go: 'returns', sev: peak >= 600 ? 'risk' : 'warn' });
      }
      if (r.backlog < 300) inRun = false;
    });
    // 8) 공간 적치율
    zones(F).forEach(function (z) {
      if (z.util >= 0.85) out.push({ day: END, brand: z.id, area: '공간', title: z.zone + ' 적치율 ' + Math.round(z.util * 100) + '%', cause: 'FW 입고 증가 · SS 재고 잔류', impact: '보관 위치 부족 시 입고 적치 지연',
        action: 'SS 시즌 이월 재고를 상단 랙·이월 구역으로 이동 검토', status: 'open', go: 'space', sev: utilStatus(z.util) });
    });
    return out.filter(function (x) { return x.brand === '전체' || bOk(F, x.brand); })
      .sort(function (a, b) { return (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || b.day - a.day; });
  }

  /* ---------------- 지금 할 일(우선순위) ---------------- */
  function actions(F) {
    var a = [], t = today(F);
    t.brands.forEach(function (b) {
      if (b.risk) a.push({ pri: 1, area: 'B2C 출고', brand: b.id, what: '마감 위험 ' + b.risk + '건 (진행률 ' + Math.round((b.progress || 0) * 100) + '%)', act: '피킹 대기 주문을 우선 피킹 · 패킹 인원 재배치', go: 'b2c' });
    });
    if (t.backlog) a.push({ pri: 1, area: 'B2C 출고', brand: F.brand === 'ALL' ? '전체' : F.brand, what: '납기 지난 이월 주문 ' + t.backlog + '건 포함', act: '이월 주문부터 출고 · 화주사 CS에 지연 안내 공유', go: 'sla' });
    D.b2b.filter(function (x) { return bOk(F, x.brand) && b2bOn(F) && x.ship === null && x.plan === undefined && x.due <= C.addBiz(END, 1); }).forEach(function (x) {
      a.push({ pri: x.due <= END ? 1 : 2, area: 'B2B 납품', brand: x.brand, what: x.dest + ' ' + x.qty.toLocaleString('ko-KR') + 'pcs · 납기 ' + C.isoOf(x.due).slice(5), act: 'B2B 전담 인원 우선 배정 · 상차 시간 확인', go: 'b2b' });
    });
    stockView(F).filter(function (r) { return r.status === '결품' || r.status === '결품 위험'; }).slice(0, 6).forEach(function (r) {
      a.push({ pri: r.status === '결품' ? 1 : 2, area: '재고', brand: r.brand, what: r.id + ' ' + r.status + (r.cover !== null ? ' · 재고 ' + Math.round(r.cover) + '일분' : ''), act: '화주사에 입고 일정 확인 요청 · 입고 시 우선 적치', go: 'inventory' });
    });
    var rt = returns(withPeriod(F, END, END));
    if (rt.backlog >= 100) a.push({ pri: 2, area: '반품', brand: F.brand === 'ALL' ? '전체' : F.brand, what: '반품 검수 대기 ' + rt.backlog + '건', act: '교환 건 우선 검수 · 오후 반품 인원 1명 추가', go: 'returns' });
    var ip = inbound(withPeriod(F, END - 6, END)).pending;
    if (ip.length) a.push({ pri: 2, area: '입고', brand: F.brand === 'ALL' ? '전체' : F.brand, what: '적치 대기 입고 ' + ip.length + '건', act: '결품 SKU 포함 입고부터 적치', go: 'inbound' });
    zones(F).filter(function (z) { return z.util >= 0.85; }).forEach(function (z) {
      a.push({ pri: z.util >= 0.95 ? 2 : 3, area: '공간', brand: z.id, what: z.zone + ' 적치율 ' + Math.round(z.util * 100) + '%', act: 'SS 이월 재고 이동 · 입고 예정 물량 위치 확보', go: 'space' });
    });
    billing(withPeriod(F, C.monthRange(C.monthOf(END))[0], END)).diffRows.forEach(function (r) {
      a.push({ pri: 3, area: '정산', brand: r.brand, what: r.month.replace('-', '.') + ' 가집계 ' + r.label + ' 차이 ' + r.diff.toLocaleString('ko-KR') + '원', act: '청구서 확정 전 단가 수정', go: 'billing' });
    });
    return a.sort(function (x, y) { return x.pri - y.pri; });
  }

  /* ---------------- 일일 운영 보고서 ---------------- */
  function dailyReport(F, day) {
    var P = withPeriod(F, day, day);
    var s = sla(P), bb = b2b(P), r = returns(P), ib = inbound(P), lb = D.labor.filter(function (l) { return l.day === day; })[0];
    var sh = b2cOn(F) ? D.shipByDay[day].filter(function (o) { return bOk(F, o.brand); }).length : 0;
    var rec = b2cOn(F) ? D.ordersByDay[day].filter(function (o) { return bOk(F, o.brand) && !o.ex; }).length : 0;
    return { day: day, biz: C.isBiz(day), received: rec, shipped: sh, sla: s, b2b: bb, b2bPcs: bb.shippedPcs, returns: r, inbound: ib, labor: lb || null,
      mis: misship(P).n };
  }

  global.SCMMetrics = {
    resolveFilter: resolveFilter, withPeriod: withPeriod, prevPeriod: prevPeriod, bOk: bOk, b2cOn: b2cOn, b2bOn: b2bOn, units: units, bizDiff: bizDiff,
    today: today, todayB2c: todayB2c, stageAtNow: stageAtNow, isRisk: isRisk,
    sla: sla, slaDaily: slaDaily, onTime: onTime,
    b2b: b2b, b2bStatus: b2bStatus, b2bSchedule: b2bSchedule,
    outboundDaily: outboundDaily, orderHours: orderHours, misship: misship,
    inbound: inbound, inboundLead: inboundLead,
    stockView: stockView, matrix: matrix, cycleCount: cycleCount, stockoutEvents: stockoutEvents, skuOut: skuOut,
    zones: zones, zoneDaily: zoneDaily, utilStatus: utilStatus,
    returns: returns, returnsDaily: returnsDaily, returnRate: returnRate,
    labor: labor, laborRow: laborRow, PROC: PROC,
    billing: billing, monthQty: monthQty, billMonths: billMonths,
    KPI_DEF: KPI_DEF, kpis: kpis, kpiStatus: kpiStatus,
    issues: issues, actions: actions, dailyReport: dailyReport
  };
})(typeof window !== 'undefined' ? window : globalThis);
