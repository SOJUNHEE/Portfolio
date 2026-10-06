/* =====================================================================
 * js/metrics.js — 지표 계산
 * ---------------------------------------------------------------------
 * 모든 지표는 이 파일에서만 계산합니다. 화면(app.js)과 CSV(export.js)는
 * 여기서 반환한 값을 그대로 사용하므로 화면 수치와 파일 수치가 같습니다.
 *
 * [필터 적용 규칙]
 *  - 기간: 주문은 주문일, 출고 지표는 출고일, B2B는 납품 요청일, 이슈는 접수일,
 *          재고 스냅샷은 기간 종료일, 정산은 기간과 겹치는 월 기준
 *  - 채널: B2C 채널을 고르면 B2B 지표는 "해당 없음", B2B 유형을 고르면 B2C 지표는 "해당 없음"
 *          재고·정산은 센터 단위이므로 채널 필터를 적용하지 않음
 *  - 상품: 주문은 해당 SKU를 포함한 주문, B2B·재고·불일치·실사는 해당 SKU
 *          정산은 SKU 단위가 아니므로 상품 필터를 적용하지 않음
 *
 * [핵심 지표 계산식]
 *  당일 출고율        = 출고 마감(14:00) 전 주문 중 당일 출고 완료 건 / 출고 마감 전 주문 건
 *                      (영업일 주문, 취소 제외)
 *  평균 출고 소요시간 = Σ(출고 완료 일시 − 주문 일시) / 출고 완료 건
 *  B2B 납기 준수율    = 납품 요청일 이내 전량 납품 건 / 전체 B2B 발주 건
 *                      (분모: 납품 요청일이 기간 안이면서 기준일 이전인 건)
 *  오출고율           = 오출고 건 / 전체 출고 건 (B2C 출고 기준)
 *  가용 재고(판매 가능) = 현재고(가용 상태) − B2B 확정 발주 − 안전 재고
 *  유통기한 잔여율    = 남은 유통기한 일수(유통기한 − 납품일) / 전체 유통기한 일수
 *  시스템 재고 일치율 = OMS·WMS·ERP 수량이 모두 같은 SKU 수 / 전체 SKU 수 (기간 종료일)
 *  정산 차이 금액     = Σ(청구 수량 − 실적 수량) × 계약 단가 + Σ 청구 수량 × (청구 단가 − 계약 단가)
 *                    = Σ(청구 금액 − 실적 수량 × 계약 단가)   (계약 단가 = 해당 월 물량 구간의 견적 단가)
 *  박스당 물류비     = 일반 포장 단가[구간][사이즈] + 택배비 단가[구간][사이즈]
 *  출고 1건당 물류비  = 월 물류비 합계 / 월 출고 건수
 * ===================================================================== */
(function (global) {
  'use strict';
  var D = global.SCM_DATA;
  var M = D.meta, C = D.cal, SK = D.skus;
  var NSKU = SK.length;
  var END = M.END_DAY, NOW = M.NOW;
  var B2C_IDS = D.channels.b2c.map(function (c) { return c.id; });
  var B2B_IDS = D.channels.b2b.map(function (c) { return c.id; });

  /* ------------------------------------------------------------------
   * 0. 사전 색인
   * ------------------------------------------------------------------ */
  var shippedByDay = [], d0;
  for (d0 = 0; d0 <= END; d0++) shippedByDay[d0] = [];
  var orderById = {};
  D.orders.forEach(function (o) {
    orderById[o.id] = o;
    if (o.tS !== null) shippedByDay[Math.floor(o.tS / 1440)].push(o);
  });
  var releasedByDay = [];
  for (d0 = 0; d0 <= END; d0++) releasedByDay[d0] = [];
  D.orders.forEach(function (o) { if (o.tX !== null) releasedByDay[Math.floor(o.tX / 1440)].push(o); });
  var b2bById = {};
  D.b2b.forEach(function (x) { b2bById[x.id] = x; });
  var inboundById = {};
  D.inbounds.forEach(function (ib) { inboundById[ib.id] = ib; });
  // 이슈 → 관련 SKU
  D.issues.forEach(function (it) {
    if (orderById[it.ref]) it.skus = orderById[it.ref].items.map(function (x) { return x[0]; });
    else if (b2bById[it.ref]) it.skus = [b2bById[it.ref].sku];
    else if (inboundById[it.ref]) it.skus = [inboundById[it.ref].sku];
    else it.skus = [];
  });
  // SKU별 일 출고량 (B2C 구성품 기준 + B2B)
  var outB2C = SK.map(function () { return new Array(END + 1).fill(0); });
  var outB2B = SK.map(function () { return new Array(END + 1).fill(0); });
  D.orders.forEach(function (o) {
    if (o.tS === null) return;
    var sd = Math.floor(o.tS / 1440);
    o.items.forEach(function (it) {
      var k = SK[it[0]];
      if (k.isSet) k.components.forEach(function (c) { outB2C[c.idx][sd] += c.qty * it[1]; });
      else outB2C[it[0]][sd] += it[1];
    });
  });
  D.b2b.forEach(function (x) { x.ships.forEach(function (s) { outB2B[x.sku][s.day] += s.qty; }); });
  // 세트 SKU 자체 판매량 (사전 포장 재고 소진 계산용)
  var setSales = SK.map(function () { return new Array(END + 1).fill(0); });
  D.orders.forEach(function (o) {
    if (o.tS === null) return;
    var sd = Math.floor(o.tS / 1440);
    o.items.forEach(function (it) { if (SK[it[0]].isSet) setSales[it[0]][sd] += it[1]; });
  });
  // 채널별 SKU 판매(주문 기준, 구성품 환산 X)
  var monthStartDay = {}, monthEndDay = {};
  for (d0 = 0; d0 <= END; d0++) {
    var mo = C.monthOf(d0);
    if (monthStartDay[mo] === undefined) monthStartDay[mo] = d0;
    monthEndDay[mo] = d0;
  }

  /* ------------------------------------------------------------------
   * 1. 필터
   * ------------------------------------------------------------------ */
  var PERIODS = { '7d': 7, '30d': 30, '90d': 90, '180d': 180, '365d': 365 };
  function clampDay(d) { return Math.max(0, Math.min(END, d)); }

  function resolveFilter(st) {
    var from, to;
    if (st.period === 'custom' && st.from && st.to) {
      from = clampDay(C.dayOf(st.from)); to = clampDay(C.dayOf(st.to));
      if (from > to) { var t = from; from = to; to = t; }
    } else {
      to = END; from = clampDay(END - (PERIODS[st.period] || 30) + 1);
    }
    var ch = st.channel || 'ALL';
    var b2c = ch === 'ALL' || ch === 'B2C' || B2C_IDS.indexOf(ch) >= 0;
    var b2b = ch === 'ALL' || ch === 'B2B' || B2B_IDS.indexOf(ch) >= 0;
    var b2cCh = B2C_IDS.map(function (id) { return b2c && (ch === 'ALL' || ch === 'B2C' || ch === id); });
    var b2bType = {};
    B2B_IDS.forEach(function (id) { b2bType[id] = b2b && (ch === 'ALL' || ch === 'B2B' || ch === id); });
    var prod = st.product || 'ALL';
    var sku = SK.map(function (k) {
      if (prod === 'ALL') return true;
      if (prod.indexOf('cat:') === 0) return k.category === prod.slice(4);
      if (prod.indexOf('sku:') === 0) return k.id === prod.slice(4);
      return true;
    });
    return {
      from: from, to: to, days: to - from + 1,
      channel: ch, product: prod,
      b2c: b2c, b2b: b2b, b2cCh: b2cCh, b2bType: b2bType,
      sku: sku, allSku: prod === 'ALL', skuList: SK.filter(function (k) { return sku[k.idx]; }).map(function (k) { return k.idx; })
    };
  }
  function withPeriod(F, from, to) {
    var G = {}; for (var k in F) G[k] = F[k];
    G.from = from; G.to = to; G.days = to - from + 1;
    return G;
  }
  function orderInScope(o, F) {
    if (!F.b2c || !F.b2cCh[o.ch]) return false;
    if (F.allSku) return true;
    for (var i = 0; i < o.items.length; i++) if (F.sku[o.items[i][0]]) return true;
    return false;
  }
  function b2bInScope(x, F) { return F.b2b && F.b2bType[x.type] && F.sku[x.sku]; }
  function issueInScope(it, F) {
    if (it.channel === 'CENTER') { if (F.channel !== 'ALL') return false; }
    else if (B2C_IDS.indexOf(it.channel) >= 0) { if (!F.b2c || !F.b2cCh[B2C_IDS.indexOf(it.channel)]) return false; }
    else if (!F.b2b || !F.b2bType[it.channel]) return false;
    if (F.allSku) return true;
    return it.skus.some(function (s) { return F.sku[s]; });
  }
  function eachOrder(F, fn) {
    for (var d = F.from; d <= F.to; d++) {
      var list = D.ordersByDay[d];
      for (var i = 0; i < list.length; i++) if (orderInScope(list[i], F)) fn(list[i]);
    }
  }
  function eachShipped(F, fn) {
    for (var d = F.from; d <= F.to; d++) {
      var list = shippedByDay[d];
      for (var i = 0; i < list.length; i++) if (orderInScope(list[i], F)) fn(list[i]);
    }
  }
  function ratio(n, d) { return d > 0 ? n / d : null; }
  function isSameDayEligible(o) {
    // 출고 마감 전 주문: 영업일 14:00 이전 주문, 취소 제외
    return o.tC === null && C.BIZ[o.day] && (o.tO % 1440) < M.CUTOFF;
  }
  function isSameDay(o) { return o.tS !== null && Math.floor(o.tS / 1440) === o.day; }

  /* ------------------------------------------------------------------
   * 2. 종합 KPI
   * ------------------------------------------------------------------ */
  var KPI_DEF = {
    sameDay: { label: '당일 출고율', unit: '%', target: 0.95, dir: 'up', warn: 0.90, scope: 'b2c' },
    lead: { label: '평균 출고 소요시간', unit: 'h', target: 24, dir: 'down', warn: 32, scope: 'b2c' },
    b2bOnTime: { label: 'B2B 납기 준수율', unit: '%', target: 0.95, dir: 'up', warn: 0.88, scope: 'b2b' },
    misRate: { label: '오출고율', unit: '%', target: 0.002, dir: 'down', warn: 0.003, scope: 'b2c' },
    matchRate: { label: '시스템 재고 일치율', unit: '%', target: 0.98, dir: 'up', warn: 0.93, scope: 'center' },
    billDiff: { label: '정산 검증 차이 금액', unit: '원', target: 0, dir: 'down', warn: 300000, scope: 'center' }
  };
  function statusOf(key, v) {
    if (v === null || v === undefined) return null;
    var k = KPI_DEF[key];
    if (k.dir === 'up') return v >= k.target ? 'ok' : v >= k.warn ? 'warn' : 'risk';
    var a = Math.abs(v);
    return a <= k.target ? 'ok' : a <= k.warn ? 'warn' : 'risk';
  }

  function sameDayRate(F) {
    var num = 0, den = 0;
    eachOrder(F, function (o) { if (isSameDayEligible(o)) { den++; if (isSameDay(o)) num++; } });
    return { value: ratio(num, den), num: num, den: den };
  }
  function avgLead(F) {
    var sum = 0, n = 0;
    eachOrder(F, function (o) { if (o.tS !== null) { sum += (o.tS - o.tO) / 60; n++; } });
    return { value: n ? sum / n : null, n: n };
  }
  function b2bDue(F) {
    // 납품 요청일이 기간 안이면서 기준일 이전(만기 도래)인 발주 건
    var to = Math.min(F.to, END);
    return D.b2b.filter(function (x) { return x.req >= F.from && x.req <= to && b2bInScope(x, F); });
  }
  function b2bOnTime(F) {
    var list = b2bDue(F);
    var ok = list.filter(function (x) { return x.onTime; }).length;
    return { value: ratio(ok, list.length), num: ok, den: list.length };
  }
  function misRate(F) {
    var mis = 0, n = 0;
    eachShipped(F, function (o) { n++; if (o.mis) mis++; });
    return { value: ratio(mis, n), num: mis, den: n };
  }
  function matchRate(F, day) {
    var d = day === undefined ? F.to : day;
    var row = D.matchDaily[d];
    var n = 0, ok = 0;
    F.skuList.forEach(function (s) { n++; if (row[s]) ok++; });
    return { value: ratio(ok, n), num: ok, den: n };
  }
  function billingInPeriod(F) {
    return D.billing.filter(function (b) {
      return monthStartDay[b.month] <= F.to && monthEndDay[b.month] >= F.from;
    }).map(billRow);
  }
  var billItemByKey = {};
  D.billItems.forEach(function (bi) { billItemByKey[bi.key] = bi; });
  function billRow(b) {
    var act = billItemByKey[b.key].actual(D.workLogs[b.month]);
    var billedAmt = b.billedQty * b.billedUnitPrice, actualAmt = act * b.unitPrice;
    return {
      id: b.id, month: b.month, cat: b.cat, item: b.item, unit: b.unit, tier: b.tier,
      billedQty: b.billedQty, actualQty: act, diffQty: b.billedQty - act,
      unitPrice: b.unitPrice, billedUnitPrice: b.billedUnitPrice, priceDiff: b.billedUnitPrice - b.unitPrice,
      billedAmt: billedAmt, actualAmt: actualAmt,
      qtyDiffAmt: (b.billedQty - act) * b.unitPrice,                       // 수량 차이 금액
      priceDiffAmt: b.billedQty * (b.billedUnitPrice - b.unitPrice),       // 단가(구간) 차이 금액
      diffAmt: billedAmt - actualAmt,                                      // 정산 차이 금액 = 청구 금액 − 실적 수량 × 계약 단가
      hasDiff: b.billedQty !== act || b.billedUnitPrice !== b.unitPrice,
      status: b.status, memo: b.memo, resolution: b.resolution
    };
  }
  function billDiff(F) {
    var rows = billingInPeriod(F);
    var sum = rows.reduce(function (a, r) { return a + r.diffAmt; }, 0);
    var over = rows.reduce(function (a, r) { return a + Math.max(0, r.diffAmt); }, 0);
    return { value: sum, over: over, lines: rows.filter(function (r) { return r.hasDiff; }).length, months: uniq(rows.map(function (r) { return r.month; })),
      qty: rows.reduce(function (a, r) { return a + r.qtyDiffAmt; }, 0), price: rows.reduce(function (a, r) { return a + r.priceDiffAmt; }, 0) };
  }
  function uniq(a) { return a.filter(function (v, i) { return a.indexOf(v) === i; }); }

  function kpiValues(F) {
    return {
      sameDay: F.b2c ? sameDayRate(F) : null,
      lead: F.b2c ? avgLead(F) : null,
      b2bOnTime: F.b2b ? b2bOnTime(F) : null,
      misRate: F.b2c ? misRate(F) : null,
      matchRate: matchRate(F),
      billDiff: billDiff(F)
    };
  }
  function kpis(F) {
    var cur = kpiValues(F);
    // 전월 대비: 기간 종료일이 속한 달(월초~종료일) vs 직전 달 전체
    var mo = C.monthOf(F.to);
    var ms = monthStartDay[mo];
    var prevMo = ms > 0 ? C.monthOf(ms - 1) : null;
    var thisM = kpiValues(withPeriod(F, ms, F.to));
    var prevM = prevMo ? kpiValues(withPeriod(F, monthStartDay[prevMo], monthEndDay[prevMo])) : null;
    return Object.keys(KPI_DEF).map(function (key) {
      var def = KPI_DEF[key];
      var v = cur[key] ? cur[key].value : null;
      var a = thisM[key] ? thisM[key].value : null;
      var b = prevM && prevM[key] ? prevM[key].value : null;
      return {
        key: key, label: def.label, unit: def.unit, target: def.target, dir: def.dir, scope: def.scope,
        value: v, detail: cur[key], status: statusOf(key, v),
        month: mo, prevMonth: prevMo, monthValue: a, prevValue: b,
        delta: a !== null && b !== null ? a - b : null,
        na: cur[key] === null
      };
    });
  }

  /* ------------------------------------------------------------------
   * 3. 오늘 조치할 목록 (기준 시각 현재, 기간 필터 미적용)
   * ------------------------------------------------------------------ */
  function pendingOrders(F) {
    var rows = [];
    if (!F.b2c) return rows;
    for (var d = Math.max(0, END - 40); d <= END; d++) {
      D.ordersByDay[d].forEach(function (o) {
        if (!orderInScope(o, F) || o.tS !== null || o.tC !== null) return;
        var onHold = o.hold && o.hold.end > NOW;
        var stage, reason;
        if (o.tR > NOW) { stage = '수집'; reason = 'OMS 자동 수집 후 발주 등록 대기'; }
        else if (onHold) { stage = '보류'; reason = o.hold.reason; }
        else if (o.tX === null) {
          stage = '발주 등록';
          reason = (o.tR % 1440) >= 13 * 60 ? '13:00 출고 지시 배치 이후 등록(익일 지시)' : '출고 지시 대기';
        } else { stage = '출고 지시'; reason = o.live ? '라이브 주문 순차 출고 대기' : '3PL 처리 대기(처리량 초과)'; }
        rows.push({
          id: o.id, channel: D.channels.b2c[o.ch].name, orderedAt: o.tO, elapsedH: (NOW - o.tO) / 60,
          stage: stage, reason: reason, items: o.items, qty: o.qty, live: o.live
        });
      });
    }
    rows.sort(function (a, b) { return b.elapsedH - a.elapsedH; });
    return rows;
  }

  function stockProjection(F) {
    // SKU별 향후 45일 재고 추정: 가용 재고 − B2C 일평균 출고 − B2B 확정 발주(출고 예정일) + 입고 예정
    var H = 45;
    var res = {};
    SK.forEach(function (k) {
      var s = k.idx;
      var b2cAvg = 0, b2bAvg = 0;
      for (var d = END - 27; d <= END; d++) { b2cAvg += outB2C[s][d]; b2bAvg += outB2B[s][d]; }
      if (k.isSet) { b2cAvg = 0; for (var d2 = END - 27; d2 <= END; d2++) b2cAvg += setSales[s][d2]; }
      b2cAvg /= 28; b2bAvg /= 28;
      var confirmed = new Array(H + 1).fill(0);
      var confirmedTotal = 0;
      var lastConfirmedDay = END;
      D.b2b.forEach(function (x) {
        if (x.sku !== s || x.delivered !== null) return;
        var rem = x.qty - x.shippedQty;
        var day = Math.max(END + 1, x.waitUntil > x.plan ? x.waitUntil : x.plan);
        var off = Math.min(H, Math.max(1, day - END));
        confirmed[off] += rem; confirmedTotal += rem;
        lastConfirmedDay = Math.max(lastConfirmedDay, day);
      });
      var inb = new Array(H + 1).fill(0);
      var nextInbound = null;
      D.inbounds.forEach(function (ib) {
        if (ib.sku !== s || ib.arrived) return;
        var off = ib.actual - END;
        if (off >= 1 && off <= H) inb[off] += ib.plannedQty;
        if (!nextInbound || ib.actual < nextInbound.day) nextInbound = { day: ib.actual, qty: ib.plannedQty, planned: ib.planned, reason: ib.delayReason };
      });
      var avail = D.stockStatus[s].available;
      var proj = [avail], cur = avail, stockoutDay = null, belowSafetyDay = null;
      for (var i = 1; i <= H; i++) {
        var dd = END + i;
        var b2bDemand = confirmed[i] + (dd > lastConfirmedDay ? b2bAvg : 0);
        if (C.BIZ[dd]) cur -= b2cAvg * (7 / 5);  // 영업일 출고 (주말 물량 포함)
        cur -= b2bDemand;
        cur += inb[i];
        proj.push(cur);
        if (stockoutDay === null && cur < 0) stockoutDay = dd;
        if (belowSafetyDay === null && cur < k.safetyStock) belowSafetyDay = dd;
      }
      var daily = b2cAvg + b2bAvg;
      res[s] = {
        sku: s, available: avail, b2cAvg: b2cAvg, b2bAvg: b2bAvg, dailyAvg: daily,
        coverDays: daily > 0 ? avail / daily : null,
        confirmedB2B: confirmedTotal, nextInbound: nextInbound,
        stockoutDay: stockoutDay, belowSafetyDay: belowSafetyDay, projection: proj,
        status: stockoutDay !== null && stockoutDay <= END + 21 && (!nextInbound || nextInbound.day > stockoutDay) ? 'risk'
          : belowSafetyDay !== null && belowSafetyDay <= END + 14 ? 'warn' : 'ok'
      };
    });
    // 세트: 사전 포장 재고 + 구성품으로 추가 작업 가능한 수량, 위험도는 가장 부족한 구성품 기준
    SK.filter(function (k) { return k.isSet; }).forEach(function (k) {
      var worst = null;
      k.components.forEach(function (c) {
        var p = res[c.idx];
        if (!worst || (p.stockoutDay || 9999) < (worst.stockoutDay || 9999) || (p.coverDays || 999) < (worst.coverDays || 999)) worst = p;
      });
      var r = res[k.idx];
      var buildable = Math.min.apply(null, k.components.map(function (c) { return Math.floor(Math.max(0, res[c.idx].available) / c.qty); }));
      r.prepacked = r.available;
      r.buildable = buildable;
      r.limiting = worst.sku;
      r.coverDays = worst.coverDays;
      r.stockoutDay = worst.stockoutDay;
      r.belowSafetyDay = worst.belowSafetyDay;
      r.nextInbound = worst.nextInbound;
      r.status = worst.status;
      r.setBased = true;
    });
    return res;
  }

  function weekStart(d) { var w = C.dowOf(d); return d - ((w + 6) % 7); }
  function b2bSchedule(F) {
    // 이번 주 + 다음 주 영업일, 미납·미출고 B2B 발주를 출고 예정일 기준 배치
    var ws = weekStart(END);
    var days = [];
    for (var i = 0; i < 14; i++) {
      var d = ws + i;
      var w = C.dowOf(d);
      if (w === 0 || w === 6) continue;
      days.push({ day: d, biz: !!C.BIZ[d], items: [] });
    }
    var proj = stockProjection(F);
    // SKU별 누적 수요로 재고 위험 판정
    var cum = {};
    var lines = D.b2b.filter(function (x) { return x.delivered === null && b2bInScope(x, F) && x.plan <= ws + 13; });
    lines.sort(function (a, b) { return a.plan - b.plan || a.req - b.req; });
    var rows = [];
    lines.forEach(function (x) {
      var s = x.sku, rem = x.qty - x.shippedQty;
      var p = proj[s];
      var shipDay = Math.max(END, x.waitUntil > x.plan ? x.waitUntil : x.plan);
      if (!C.BIZ[shipDay]) shipDay = C.nextBiz(shipDay);
      cum[s] = (cum[s] || 0) + rem;
      var inboundBefore = 0;
      D.inbounds.forEach(function (ib) { if (ib.sku === s && !ib.arrived && ib.actual <= shipDay) inboundBefore += ib.plannedQty; });
      var b2cUse = p.b2cAvg * Math.max(0, shipDay - END);
      var left = p.available + inboundBefore - b2cUse - cum[s];
      var risk = left < 0 ? 'risk' : left < SK[s].safetyStock ? 'warn' : 'ok';
      var overdue = x.req < END + 0 || (x.req <= END && x.delivered === null);
      var row = {
        id: x.id, account: D.accounts[x.acc].name, type: x.type, region: x.region, sku: s, qty: rem,
        recv: x.recv, req: x.req, plan: x.plan, shipDay: shipDay, overdue: x.req <= END && x.delivered === null && x.req < shipDay,
        risk: risk, projectedLeft: Math.round(left), status: x.status, delayReason: x.delayReason
      };
      rows.push(row);
      var cell = days.filter(function (c) { return c.day === shipDay; })[0];
      if (cell) cell.items.push(row);
    });
    return { weekStart: ws, days: days, rows: rows };
  }

  function actionList(F) {
    var pend = pendingOrders(F).filter(function (r) { return r.elapsedH > 24 || r.stage === '보류'; });
    // 납품 임박: 내일까지 납품 요청분(요청일 경과 포함) 또는 3영업일 안에 재고 위험이 있는 건
    var sched = F.b2b ? b2bSchedule(F).rows.filter(function (r) { return r.req <= C.nextBiz(END) || (r.req <= C.addBiz(END, 3) && r.risk !== 'ok'); }) : [];
    var openMm = D.mismatches.filter(function (m) { return m.resolve === null && F.sku[m.sku]; });
    var overdue = D.issues.filter(function (it) { return it.overdue && issueInScope(it, F); });
    var pendingBill = D.billing.filter(function (b) { return b.status === '검증 대기'; }).map(billRow);
    return { pendingOrders: pend, b2bDue: sched, openMismatches: openMm, overdueIssues: overdue, pendingBilling: pendingBill };
  }

  /* ------------------------------------------------------------------
   * 4. 주문·발주·출고
   * ------------------------------------------------------------------ */
  function funnel(F) {
    // 단계별 건수(기준 시각 현재 도달 여부)와 단계 간 평균 소요시간
    var c = { collected: 0, registered: 0, released: 0, shipped: 0, hold: 0, cancelled: 0, invoicePending: 0 };
    var t1 = 0, n1 = 0, t2 = 0, n2 = 0, t3 = 0, n3 = 0;
    eachOrder(F, function (o) {
      c.collected++;
      if (o.tC !== null) { c.cancelled++; }
      if (o.tR <= NOW) { c.registered++; t1 += o.tR - o.tO; n1++; }
      if (o.hold && o.hold.end > NOW && o.tS === null && o.tC === null) c.hold++;
      if (o.tX !== null && o.tX <= NOW) { c.released++; t2 += o.tX - o.tR; n2++; }
      if (o.tS !== null) { c.shipped++; t3 += o.tS - o.tX; n3++; if (!o.invoiceLinked) c.invoicePending++; }
    });
    return {
      counts: c,
      regMin: n1 ? t1 / n1 : null,           // 주문 수집 → 발주 등록 (분)
      releaseH: n2 ? t2 / n2 / 60 : null,    // 발주 등록 → 출고 지시 (시간)
      shipH: n3 ? t3 / n3 / 60 : null        // 출고 지시 → 출고 완료 (시간)
    };
  }

  function dailyVsCapacity(F) {
    var rows = [];
    for (var d = F.from; d <= F.to; d++) {
      var byCh = [0, 0, 0, 0], total = 0;
      D.ordersByDay[d].forEach(function (o) {
        total++;
        if (orderInScope(o, F)) byCh[o.ch]++;
      });
      rows.push({
        day: d, byCh: byCh, filtered: byCh[0] + byCh[1] + byCh[2] + byCh[3], total: total,
        capacity: C.BIZ[d] ? M.CAPACITY : null,
        processedUnits: D.shipLog.processedUnits[d], processedOrders: D.shipLog.processedOrders[d],
        backlog: D.shipLog.backlogStartOrders[d],
        over: total > M.CAPACITY, live: M.liveDays.indexOf(d) >= 0
      });
    }
    return rows;
  }

  function hourlySameDay(F) {
    var h = [];
    for (var i = 0; i < 24; i++) h.push({ hour: i, orders: 0, eligible: 0, sameDay: 0, rate: null });
    eachOrder(F, function (o) {
      if (o.tC !== null) return;
      h[o.hr].orders++;
      if (isSameDayEligible(o)) { h[o.hr].eligible++; if (isSameDay(o)) h[o.hr].sameDay++; }
    });
    h.forEach(function (r) { r.rate = ratio(r.sameDay, r.eligible); });
    var am = h.slice(0, 12).reduce(function (a, r) { a.n += r.sameDay; a.d += r.eligible; return a; }, { n: 0, d: 0 });
    var pm = h.slice(12, 14).reduce(function (a, r) { a.n += r.sameDay; a.d += r.eligible; return a; }, { n: 0, d: 0 });
    return { hours: h, am: ratio(am.n, am.d), pm: ratio(pm.n, pm.d), amN: am.d, pmN: pm.d };
  }

  function prepackCompare(F) {
    // 라이브 주문의 출고 소요시간: 세트 사전 포장 도입(2026-07-15) 전후 비교
    var groups = { before: { live: [], norm: [] }, after: { live: [], norm: [] } };
    var perLive = {};
    eachOrder(F, function (o) {
      if (o.tS === null) return;
      var lead = (o.tS - o.tO) / 60;
      var g = o.day >= M.PREPACK_DAY ? groups.after : groups.before;
      (o.live ? g.live : g.norm).push(lead);
      if (o.live) {
        var p = perLive[o.day] || (perLive[o.day] = { day: o.day, n: 0, sum: 0, maxDays: 0 });
        p.n++; p.sum += lead;
        p.maxDays = Math.max(p.maxDays, Math.floor(o.tS / 1440) - o.day);
      }
    });
    function stat(a) {
      if (!a.length) return null;
      var s = a.reduce(function (x, y) { return x + y; }, 0);
      var over48 = a.filter(function (v) { return v > 48; }).length;
      return { n: a.length, avg: s / a.length, over48: over48 / a.length };
    }
    return {
      before: { live: stat(groups.before.live), norm: stat(groups.before.norm) },
      after: { live: stat(groups.after.live), norm: stat(groups.after.norm) },
      liveDays: Object.keys(perLive).map(function (k) {
        var p = perLive[k]; return { day: p.day, n: p.n, avgLead: p.sum / p.n, maxDays: p.maxDays, after: p.day >= M.PREPACK_DAY };
      }).sort(function (a, b) { return a.day - b.day; })
    };
  }

  /* ------------------------------------------------------------------
   * 5. B2B 거래처 입출고
   * ------------------------------------------------------------------ */
  function complianceBy(F, keyFn, keys) {
    var map = {};
    keys.forEach(function (k) { map[k] = { key: k, n: 0, ok: 0 }; });
    b2bDue(F).forEach(function (x) {
      var k = keyFn(x);
      if (!map[k]) map[k] = { key: k, n: 0, ok: 0 };
      map[k].n++; if (x.onTime) map[k].ok++;
    });
    return keys.map(function (k) { var r = map[k]; r.rate = ratio(r.ok, r.n); return r; });
  }
  function complianceByType(F) { return complianceBy(F, function (x) { return x.type; }, B2B_IDS); }
  function complianceByRegion(F) {
    return complianceBy(F, function (x) { return x.region; }, ['서울', '경기', '인천', '부산', '대구', '대전', '광주', '기타']);
  }
  function weeklyLoad(F) {
    // 주별 B2C 주문 부하(주문 건 / (일 처리량 × 영업일))와 B2B 납기 준수율
    var weeks = {};
    for (var d = F.from; d <= Math.min(F.to, END); d++) {
      var ws = weekStart(d);
      var w = weeks[ws] || (weeks[ws] = { week: ws, orders: 0, bizDays: 0, n: 0, ok: 0, live: 0, overtime: 0 });
      if (D.shipLog.overtime[d]) w.overtime++;   // 3PL 적체(연장 근무)일
      w.orders += D.ordersByDay[d].length;
      if (C.BIZ[d]) w.bizDays++;
      if (M.liveDays.indexOf(d) >= 0) w.live++;
    }
    b2bDue(F).forEach(function (x) { var w = weeks[weekStart(x.req)]; if (w) { w.n++; if (x.onTime) w.ok++; } });
    return Object.keys(weeks).map(function (k) {
      var w = weeks[k];
      w.load = w.bizDays ? w.orders / (M.CAPACITY * w.bizDays) : null;
      w.rate = ratio(w.ok, w.n);
      return w;
    }).filter(function (w) { return w.n >= 5 && w.load !== null; }).sort(function (a, b) { return a.week - b.week; });
  }
  function lateAccounts(F) {
    var map = {};
    b2bDue(F).forEach(function (x) {
      var a = map[x.acc] || (map[x.acc] = { acc: x.acc, n: 0, ok: 0, late: 0, open: 0, delaySum: 0, delayN: 0, reasons: {} });
      a.n++;
      if (x.onTime) a.ok++;
      else if (x.delivered === null) a.open++;
      else { a.late++; a.delaySum += x.delivered - x.req; a.delayN++; }
      if (!x.onTime && x.delayReason) a.reasons[x.delayReason] = (a.reasons[x.delayReason] || 0) + 1;
    });
    return Object.keys(map).map(function (k) {
      var a = map[k], acc = D.accounts[a.acc];
      var topReason = Object.keys(a.reasons).sort(function (p, q) { return a.reasons[q] - a.reasons[p]; })[0] || '';
      return {
        acc: a.acc, name: acc.name, type: acc.type, region: acc.region, cycle: acc.cycleLabel, pref: acc.preferredLabel,
        n: a.n, ok: a.ok, late: a.late, open: a.open, rate: ratio(a.ok, a.n),
        avgDelay: a.delayN ? a.delaySum / a.delayN : null, topReason: topReason
      };
    }).filter(function (a) { return a.late + a.open > 0; })
      .sort(function (p, q) { return (q.late + q.open) - (p.late + p.open) || p.rate - q.rate; });
  }
  function deliveredInPeriod(F) {
    var out = [];
    D.b2b.forEach(function (x) {
      if (!b2bInScope(x, F)) return;
      x.ships.forEach(function (s) {
        if (s.deliver >= F.from && s.deliver <= F.to) out.push({ line: x, ship: s });
      });
    });
    return out;
  }
  function shelfLife(F) {
    var min = M.minShelfLifeRatio;
    var buckets = [{ label: '60% 미만', lo: -1, hi: 0.6 }, { label: '60~70%', lo: 0.6, hi: 0.7 }, { label: '70~80%', lo: 0.7, hi: 0.8 }, { label: '80~90%', lo: 0.8, hi: 0.9 }, { label: '90% 이상', lo: 0.9, hi: 9 }];
    buckets.forEach(function (b) { b.n = 0; });
    var below = [];
    var all = deliveredInPeriod(F);
    all.forEach(function (r) {
      var v = r.ship.ratio;
      buckets.forEach(function (b) { if (v >= b.lo && v < b.hi) b.n++; });
      var acc = D.accounts[r.line.acc];
      if (v < acc.minShelfLifeRatio) {
        var lot = D.lots[r.ship.lot];
        below.push({
          id: r.line.id, account: acc.name, type: r.line.type, sku: r.line.sku, qty: r.ship.qty,
          deliver: r.ship.deliver, lot: r.ship.lot, mfg: lot ? lot.mfg : null, exp: lot ? lot.exp : null,
          ratio: v, min: acc.minShelfLifeRatio
        });
      }
    });
    below.sort(function (a, b) { return a.ratio - b.ratio; });
    var bySku = {};
    below.forEach(function (b) { bySku[b.sku] = (bySku[b.sku] || 0) + 1; });
    return { total: all.length, buckets: buckets, below: below, belowRate: ratio(below.length, all.length), min: min, bySku: bySku };
  }
  function invoiceRecon(F) {
    var rows = [];
    var n = 0, ok = 0;
    D.b2b.forEach(function (x) {
      if (!b2bInScope(x, F) || !x.ships.length) return;
      var dd = x.ships[0].deliver;
      if (dd < F.from || dd > F.to) return;
      n++;
      if (x.invoiceMatch) { ok++; return; }
      rows.push({
        id: x.id, account: D.accounts[x.acc].name, type: x.type, sku: x.sku, deliver: dd,
        invoiceQty: x.invoiceQty, shipQty: x.actualShipQty, diff: x.invoiceQty - x.actualShipQty,
        amount: (x.invoiceQty - x.actualShipQty) * Math.round(SK[x.sku].price * 0.55),
        reason: x.invoiceReason, split: x.split
      });
    });
    return { n: n, ok: ok, mismatch: rows.length, rate: ratio(ok, n), rows: rows,
      diffQty: rows.reduce(function (a, r) { return a + Math.abs(r.diff); }, 0) };
  }
  function b2bVolume(F) {
    var lines = b2bDue(F);
    return { lines: lines.length, qty: lines.reduce(function (a, x) { return a + x.qty; }, 0),
      split: lines.filter(function (x) { return x.split; }).length };
  }

  /* ------------------------------------------------------------------
   * 6. 재고 운영
   * ------------------------------------------------------------------ */
  function stockStatusRows(F) {
    return F.skuList.map(function (s) {
      var r = D.stockStatus[s];
      return { sku: s, available: r.available, hold: r.hold, defect: r.defect, returnWait: r.returnWait, total: r.total, holdReason: r.holdReason };
    });
  }
  function confirmedB2BBySku() {
    var m = SK.map(function () { return 0; });
    D.b2b.forEach(function (x) { if (x.delivered === null) m[x.sku] += x.qty - x.shippedQty; });
    return m;
  }
  function channelShare(s) {
    // 최근 28일 B2C 채널별 판매 비중 (해당 SKU 포함 주문 수량 기준)
    var q = [0, 0, 0, 0], tot = 0;
    for (var d = END - 27; d <= END; d++) {
      D.ordersByDay[d].forEach(function (o) {
        o.items.forEach(function (it) {
          var hit = it[0] === s || (SK[it[0]].isSet && SK[it[0]].components.some(function (c) { return c.idx === s; }));
          if (hit) { q[o.ch] += it[1]; tot += it[1]; }
        });
      });
    }
    return q.map(function (v) { return tot ? v / tot : 0.25; });
  }
  function sellable(F) {
    // 판매 가능 수량 = 현재고(가용) − B2B 확정 발주 − 안전 재고, B2C 채널별로 최근 28일 판매 비중대로 배분
    var conf = confirmedB2BBySku();
    function single(s) { return D.stockStatus[s].available - conf[s] - SK[s].safetyStock; }
    return F.skuList.map(function (s) {
      var avail = D.stockStatus[s].available;
      var sellableQty = single(s);
      var buildable = null;
      if (SK[s].isSet) {
        // 세트 판매 가능 = 사전 포장 재고 + 구성품 판매 가능 수량으로 추가 작업 가능한 세트 수
        buildable = Math.min.apply(null, SK[s].components.map(function (c) { return Math.floor(Math.max(0, single(c.idx)) / c.qty); }));
        sellableQty = avail + buildable;
      }
      var share = channelShare(s);
      return {
        sku: s, available: avail, confirmedB2B: conf[s], safety: SK[s].safetyStock, sellable: sellableQty, buildable: buildable,
        byChannel: share.map(function (p) { return Math.max(0, Math.floor(Math.max(0, sellableQty) * p)); }), share: share
      };
    });
  }
  function inboundRows(F) {
    var rows = [];
    D.inbounds.forEach(function (ib) {
      if (!F.sku[ib.sku]) return;
      var key = ib.arrived ? ib.actual : ib.planned;
      if (key < F.from || key > Math.max(F.to, F.to === END ? M.HORIZON : F.to)) return;
      var status;
      if (ib.arrived) status = ib.actual > ib.planned ? '지연 입고' : '입고 완료';
      else status = ib.planned <= END ? '지연(미입고)' : '입고 예정';
      rows.push({
        id: ib.id, sku: ib.sku, planned: ib.planned, actual: ib.arrived ? ib.actual : null, eta: ib.arrived ? null : ib.actual,
        delayDays: ib.arrived ? ib.actual - ib.planned : (ib.planned <= END ? END - ib.planned : 0),
        plannedQty: ib.plannedQty, inspectedQty: ib.inspectedQty, diff: ib.arrived ? ib.inspectedQty - ib.plannedQty : null,
        shortQty: ib.shortQty, defectQty: ib.defectQty, reason: ib.diffReason || '', delayReason: ib.delayReason || '',
        lot: ib.lotNo, status: status
      });
    });
    rows.sort(function (a, b) { return a.planned - b.planned; });
    return rows;
  }
  function inboundMonthly(F) {
    var map = {};
    inboundRows(F).forEach(function (r) {
      if (r.actual === null) return;
      var m = C.monthOf(r.planned);
      var o = map[m] || (map[m] = { month: m, plannedQty: 0, inspectedQty: 0, n: 0, late: 0, diffN: 0 });
      o.plannedQty += r.plannedQty; o.inspectedQty += r.inspectedQty; o.n++;
      if (r.delayDays > 0) o.late++;
      if (r.diff) o.diffN++;
    });
    return Object.keys(map).sort().map(function (k) { return map[k]; });
  }
  function stockoutRisk(F) {
    var proj = stockProjection(F);
    return F.skuList.map(function (s) { return proj[s]; })
      .sort(function (a, b) {
        var o = { risk: 0, warn: 1, ok: 2 };
        return o[a.status] - o[b.status] || (a.coverDays || 999) - (b.coverDays || 999);
      });
  }
  function simulate(s, b2bShare, horizon) {
    // 배분 시뮬레이터: 향후 H일 공급(가용 재고 + 입고 예정)을 B2B/B2C에 비율로 나눔
    var H = horizon || 28;
    var p = stockProjection({})[s];
    var b2bDemand = 0, b2cDaily = p.b2cAvg;
    D.b2b.forEach(function (x) {
      if (x.sku !== s || x.delivered !== null) return;
      var day = Math.max(END + 1, x.plan);
      if (day <= END + H) b2bDemand += x.qty - x.shippedQty;
    });
    var confirmedDays = 14;
    b2bDemand += p.b2bAvg * Math.max(0, H - confirmedDays);  // 미확정 구간은 최근 28일 평균으로 보충
    var inb = [];
    D.inbounds.forEach(function (ib) { if (ib.sku === s && !ib.arrived && ib.actual - END <= H) inb.push(ib); });
    var supplyNow = Math.max(0, p.available);
    var inboundQty = inb.reduce(function (a, ib) { return a + ib.plannedQty; }, 0);
    var b2bAlloc = Math.round((supplyNow + inboundQty) * b2bShare);
    var b2bShort = Math.max(0, Math.round(b2bDemand - b2bAlloc));
    // B2C 재고 추이 (현재고 배분분 + 입고 시점 배분분)
    var b2cStock = supplyNow * (1 - b2bShare);
    var series = [Math.round(b2cStock)], stockout = null;
    for (var i = 1; i <= H; i++) {
      var d = END + i;
      inb.forEach(function (ib) { if (ib.actual === d) b2cStock += ib.plannedQty * (1 - b2bShare); });
      if (C.BIZ[d]) b2cStock -= b2cDaily * 7 / 5;
      if (stockout === null && b2cStock < 0) stockout = d;
      series.push(Math.round(b2cStock));
    }
    var needShare = (supplyNow + inboundQty) > 0 ? Math.min(1, b2bDemand / (supplyNow + inboundQty)) : 1;
    return {
      sku: s, horizon: H, supplyNow: supplyNow, inboundQty: inboundQty, b2bDemand: Math.round(b2bDemand),
      b2cDaily: b2cDaily, b2bAlloc: b2bAlloc, b2bShort: b2bShort, b2cStockout: stockout, series: series,
      needShare: needShare, b2cCoverDays: b2cDaily > 0 ? supplyNow * (1 - b2bShare) / (b2cDaily) : null
    };
  }

  /* ------------------------------------------------------------------
   * 7. 3PL·이슈·유관부서
   * ------------------------------------------------------------------ */
  function tplPerformance(F) {
    // 출고 정확도 = (출고 건 − 오출고·수량 차이·누락 건) / 출고 건
    // 마감 준수율 = 마감 전 출고 지시 건 중 당일 출고 완료 건 / 마감 전 출고 지시 건
    // 가동률     = 일 처리 단위 / 일 처리 가능 건수 (영업일 평균)
    var shipped = 0, err = 0;
    eachShipped(F, function (o) { shipped++; if (o.mis || o.qtyErr || o.missing) err++; });
    var rel = 0, relOk = 0;
    // 출고 지시일 기준 (주문일과 무관)
    for (var xd = F.from; xd <= F.to; xd++) {
      releasedByDay[xd].forEach(function (o) {
        if (!orderInScope(o, F) || (o.tX % 1440) > M.CUTOFF || o.tC !== null) return;
        rel++;
        if (o.tS !== null && Math.floor(o.tS / 1440) === xd) relOk++;
      });
    }
    var util = [], over = 0;
    for (var d2 = F.from; d2 <= F.to; d2++) {
      if (!C.BIZ[d2]) continue;
      util.push(D.shipLog.processedUnits[d2] / M.CAPACITY);
      if (D.shipLog.overtime[d2]) over++;
    }
    return {
      accuracy: ratio(shipped - err, shipped), shipped: shipped, errors: err,
      cutoff: ratio(relOk, rel), released: rel, releasedOk: relOk,
      utilization: util.length ? util.reduce(function (a, b) { return a + b; }, 0) / util.length : null,
      overtimeDays: over, bizDays: util.length,
      maxUtil: util.length ? Math.max.apply(null, util) : null
    };
  }
  function tplMonthly(F) {
    var rows = [];
    D.meta.months.forEach(function (m) {
      var ms = monthStartDay[m], me = monthEndDay[m];
      if (me < F.from || ms > F.to) return;
      var G = withPeriod(F, Math.max(ms, F.from), Math.min(me, F.to));
      var t = tplPerformance(G);
      rows.push({ month: m, accuracy: t.accuracy, cutoff: t.cutoff, utilization: t.utilization, overtimeDays: t.overtimeDays });
    });
    return rows;
  }
  function issuesInPeriod(F) {
    return D.issues.filter(function (it) { return it.day >= F.from && it.day <= F.to && issueInScope(it, F); });
  }
  var ISSUE_TYPES = ['출고 지연', '오출고', '누락', '수량 차이', '파손'];
  function pareto(F) {
    var list = issuesInPeriod(F);
    var map = {};
    ISSUE_TYPES.forEach(function (t) { map[t] = 0; });
    list.forEach(function (it) { map[it.type]++; });
    var rows = ISSUE_TYPES.map(function (t) { return { type: t, n: map[t] }; }).sort(function (a, b) { return b.n - a.n; });
    var cum = 0, tot = list.length;
    rows.forEach(function (r) { cum += r.n; r.share = ratio(r.n, tot); r.cum = ratio(cum, tot); });
    return { total: tot, rows: rows };
  }
  function issueCauses(F) {
    var map = {};
    issuesInPeriod(F).forEach(function (it) {
      var k = it.type + '|' + it.cause;
      var r = map[k] || (map[k] = { type: it.type, cause: it.cause, n: 0, days: 0 });
      r.n++; r.days += it.days;
    });
    return Object.keys(map).map(function (k) { var r = map[k]; r.avgDays = r.days / r.n; return r; })
      .sort(function (a, b) { return b.n - a.n; });
  }
  function issueBy(F, field, keys) {
    var map = {};
    keys.forEach(function (k) { map[k] = { key: k, n: 0, open: 0, overdue: 0, days: 0, closed: 0 }; });
    issuesInPeriod(F).forEach(function (it) {
      var r = map[it[field]] || (map[it[field]] = { key: it[field], n: 0, open: 0, overdue: 0, days: 0, closed: 0 });
      r.n++;
      if (it.status === '완료') { r.closed++; r.days += it.days; } else r.open++;
      if (it.overdue) r.overdue++;
    });
    return keys.map(function (k) { var r = map[k]; r.avgDays = r.closed ? r.days / r.closed : null; return r; });
  }
  function issueBySource(F) { return issueBy(F, 'source', ['CS', '영업', '3PL']); }
  function issueByDept(F) { return issueBy(F, 'dept', ['SCM', '3PL', '영업', '품질']); }
  function issueList(F, statusFilter) {
    return issuesInPeriod(F).filter(function (it) {
      if (!statusFilter || statusFilter === 'ALL') return true;
      if (statusFilter === 'OVERDUE') return it.overdue;
      return it.status === statusFilter;
    }).slice().sort(function (a, b) {
      var ord = function (x) { return x.overdue ? 0 : x.status === '접수' ? 1 : x.status === '처리 중' ? 2 : 3; };
      return ord(a) - ord(b) || b.day - a.day;
    });
  }
  function preventionCards(F) {
    // 재발 방지 카드: 원인 → 조치 → 결과 (채널·상품 필터 반영, 전체 기간 비교)
    var all = withPeriod(F, 0, END);
    // (1) 세트 사전 포장
    var setB = { n: 0, miss: 0 }, setA = { n: 0, miss: 0 };
    eachShipped(all, function (o) {
      if (!o.hasSet) return;
      var g = Math.floor(o.tS / 1440) >= M.PREPACK_DAY ? setA : setB;
      g.n++; if (o.missing) g.miss++;
    });
    var pc = prepackCompare(all);
    // (2) 본품·미니 로케이션 분리
    var locB = { n: 0, m: 0 }, locA = { n: 0, m: 0 };
    eachShipped(all, function (o) {
      var g = Math.floor(o.tS / 1440) >= M.LOCATION_SPLIT_DAY ? locA : locB;
      g.n++; if (o.mis) g.m++;
    });
    // (3) ERP 세트 BOM 매핑: 조치 SKU vs 미조치 SKU의 실사 후 재발률
    var fixedRec = { n: 0, r: 0 }, openRec = { n: 0, r: 0 };
    D.cycleCounts.forEach(function (c) {
      if (!F.sku[c.sku] || !c.adjusted || c.day < C.dayOf('2026-06-30')) return;
      var g = c.rootCauseFixed ? fixedRec : openRec;
      g.n++; if (c.recurred) g.r++;
    });
    return [
      {
        title: '세트 구성품 누락 · 라이브 출고 지연',
        cause: '라이브·공동구매 세트 주문을 출고 당일 현장에서 키팅 → 처리량 초과와 구성품 누락 동시 발생',
        action: '2026-07-15 세트 사전 포장 도입 (라이브 전 영업일·매주 월요일 작업)',
        result: [
          { label: '세트 주문 누락률', before: ratio(setB.miss, setB.n), after: ratio(setA.miss, setA.n), unit: 'pct2' },
          { label: '라이브 주문 평균 출고 소요시간', before: pc.before.live ? pc.before.live.avg : null, after: pc.after.live ? pc.after.live.avg : null, unit: 'h' }
        ]
      },
      {
        title: '유사 SKU 오출고 (본품·미니)',
        cause: '본품과 미니가 인접 로케이션에 같은 외관으로 보관 → 피킹 혼동',
        action: '2026-05-01 본품·미니 로케이션 분리 및 미니 전용 선반 라벨',
        result: [
          { label: '오출고율', before: ratio(locB.m, locB.n), after: ratio(locA.m, locA.n), unit: 'pct2' }
        ]
      },
      {
        title: '세트 구성품 차감 누락 (ERP)',
        cause: 'ERP에 세트 BOM이 없어 세트 판매 시 구성품 재고가 차감되지 않음',
        action: '2026-06-30 홈케어 세트, 2026-08-31 집중 세트 BOM 매핑 (데일리 케어 세트는 미조치)',
        result: [
          { label: '실사 후 6주 내 재발률(원인 조치 SKU)', before: null, after: ratio(fixedRec.r, fixedRec.n), unit: 'pct', note: fixedRec.n + '건 중 ' + fixedRec.r + '건' },
          { label: '실사 후 6주 내 재발률(미조치 SKU)', before: null, after: ratio(openRec.r, openRec.n), unit: 'pct', note: openRec.n + '건 중 ' + openRec.r + '건' }
        ]
      }
    ];
  }

  /* ------------------------------------------------------------------
   * 8. 데이터 정합성·재고 정상화
   * ------------------------------------------------------------------ */
  function mismatchesInPeriod(F) {
    return D.mismatches.filter(function (m) { return m.detect >= F.from && m.detect <= F.to && F.sku[m.sku]; });
  }
  function systemFlow(F) {
    // OMS(주문·출고 요청) → WMS(출고 처리) → ERP(출고 전표·재고 차감)
    var oms = { n: 0, qty: 0 }, wms = { n: 0, qty: 0 }, inProg = { n: 0, qty: 0 };
    eachOrder(F, function (o) {
      if (o.tC !== null) return;
      oms.n++; oms.qty += o.qty;
      if (o.tS !== null) { wms.n++; wms.qty += o.qty; } else { inProg.n++; inProg.qty += o.qty; }
    });
    var mm = mismatchesInPeriod(F);
    function sum(cause) {
      var l = mm.filter(function (m) { return m.cause === cause; });
      return { n: l.length, qty: l.reduce(function (a, m) { return a + m.qty; }, 0) };
    }
    var cancel = sum('CANCEL'), setbom = sum('SETBOM'), ret = sum('RETURN'), inb = sum('INBOUND'), scan = sum('SCAN');
    var snap = D.systemsAt(F.to);
    var stockSum = { oms: 0, wms: 0, erp: 0 };
    F.skuList.forEach(function (s) { stockSum.oms += snap[s].oms; stockSum.wms += snap[s].wms; stockSum.erp += snap[s].erp; });
    return {
      oms: oms, wms: wms, inProgress: inProg,
      omsWms: { cancel: cancel, scan: scan, ok: cancel.n === 0 && scan.n === 0 },
      wmsErp: { setbom: setbom, ret: ret, inbound: inb, erpQty: wms.qty - setbom.qty, ok: setbom.n + ret.n + inb.n === 0 },
      stock: stockSum
    };
  }
  function inferCause(r) {
    // 수량 패턴 기반 추정 원인
    var c = M.causes;
    if (r.match) return null;
    if (r.active.length) {
      var cnt = {};
      r.active.forEach(function (m) { cnt[m.cause] = (cnt[m.cause] || 0) + m.qty; });
      var top = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; })[0];
      return top;
    }
    if (r.oms !== r.wms && r.wms === r.erp) return 'CANCEL';
    if (r.erp !== r.wms && r.oms === r.wms) return 'SETBOM';
    return 'SCAN';
  }
  function reconTable(F) {
    var snap = D.systemsAt(F.to);
    return F.skuList.map(function (s) {
      var r = snap[s];
      // 기간 출고 수량: WMS = 실제 출고, OMS = WMS − 취소 미반영 수량, ERP = WMS − 세트 구성품 차감 누락 수량
      var out = 0;
      for (var d = F.from; d <= F.to; d++) out += outB2C[s][d] + outB2B[s][d];
      if (SK[s].isSet) { out = 0; for (var d2 = F.from; d2 <= F.to; d2++) out += setSales[s][d2]; }
      var mm = D.mismatches.filter(function (m) { return m.sku === s && m.occur >= F.from && m.occur <= F.to; });
      var outOms = out - mm.filter(function (m) { return m.cause === 'CANCEL'; }).reduce(function (a, m) { return a + m.qty; }, 0);
      var outErp = out - mm.filter(function (m) { return m.cause === 'SETBOM'; }).reduce(function (a, m) { return a + m.qty; }, 0);
      var cause = inferCause(r);
      return {
        sku: s, oms: r.oms, wms: r.wms, erp: r.erp, truth: r.truth,
        omsDiff: r.oms - r.wms, erpDiff: r.erp - r.wms,
        outOms: outOms, outWms: out, outErp: outErp,
        match: r.match && outOms === out && outErp === out, stockMatch: r.match,
        cause: cause, causeLabel: cause ? M.causes[cause].label : '', pattern: cause ? M.causes[cause].pattern : '',
        action: cause ? M.causes[cause].action : '', openEvents: r.active.length
      };
    });
  }
  function matchTrend(F) {
    var rows = [];
    for (var d = F.from; d <= F.to; d++) {
      var mr = matchRate(F, d);
      rows.push({ day: d, rate: mr.value, ok: mr.num, n: mr.den });
    }
    var counts = M.COUNT_DAYS.filter(function (c) { return c >= F.from && c <= F.to; });
    var fixes = M.fixes.filter(function (f) { return f.day >= F.from && f.day <= F.to; });
    // 실사 효과: 실사 전일 → 실사일 → 4주 후
    var effects = counts.map(function (c) {
      var before = matchRate(F, Math.max(0, c - 1)).value;
      var at = matchRate(F, c).value;
      var after4w = c + 28 <= END ? matchRate(F, c + 28).value : null;
      return { day: c, before: before, at: at, after4w: after4w };
    });
    return { rows: rows, counts: counts, fixes: fixes, effects: effects };
  }
  function mismatchCauseSummary(F) {
    var list = mismatchesInPeriod(F);
    var keys = Object.keys(M.causes);
    var rows = keys.map(function (k) {
      var l = list.filter(function (m) { return m.cause === k; });
      return { cause: k, label: M.causes[k].label, n: l.length, qty: l.reduce(function (a, m) { return a + m.qty; }, 0),
        open: l.filter(function (m) { return m.resolve === null; }).length };
    }).sort(function (a, b) { return b.n - a.n; });
    var top3 = rows.slice(0, 3).reduce(function (a, r) { return a + r.n; }, 0);
    return { total: list.length, rows: rows, top3Share: ratio(top3, list.length) };
  }
  function mismatchList(F) {
    return mismatchesInPeriod(F).map(function (m) {
      return {
        id: m.id, sku: m.sku, occur: m.occur, detect: m.detect, cause: m.cause, causeLabel: M.causes[m.cause].label,
        pattern: M.causes[m.cause].pattern, evidence: m.evidence, qty: m.qty,
        stage: m.stage, stageLabel: M.stages[m.stage - 1], resolve: m.resolve, resolvedBy: m.resolvedBy || '',
        open: m.resolve === null, action: M.causes[m.cause].action, rootFixed: m.rootFixed
      };
    }).sort(function (a, b) { return (b.open - a.open) || b.detect - a.detect; });
  }
  function normalization(F) {
    var list = mismatchesInPeriod(F);
    return M.stages.map(function (label, i) {
      // 일일 대사로 정정한 건은 실사 단계를 거치지 않음
      var reached = i === 2 ? list.filter(function (m) { return m.counted; }).length : list.filter(function (m) { return m.stage >= i + 1; }).length;
      var current = list.filter(function (m) { return m.stage === i + 1 && (m.resolve === null || i >= 3); }).length;
      return { stage: i + 1, label: label, reached: reached, current: current };
    });
  }
  function cycleCountRows(F) {
    return D.cycleCounts.filter(function (c) { return c.day >= F.from && c.day <= F.to && F.sku[c.sku] && c.adjusted; })
      .sort(function (a, b) { return b.day - a.day || a.sku - b.sku; });
  }
  function validationRules(F) {
    var mm = mismatchesInPeriod(F);
    function cnt(c) { return mm.filter(function (m) { return m.cause === c; }).length; }
    var snap = D.systemsAt(F.to);
    var stockOff = F.skuList.filter(function (s) { return !snap[s].match; }).length;
    var inv = F.b2b ? invoiceRecon(F) : null;
    var bill = billingInPeriod(F).filter(function (r) { return r.hasDiff; }).length;
    var rules = [
      { id: 'R1', name: 'WMS 재고 정합', formula: 'WMS 재고 = 전일 재고 + 입고 − 출고 + 반품', freq: '일 마감', target: 'WMS', fail: cnt('RETURN') + cnt('SCAN'), unit: '건', hint: '반품 입고 미처리·출고 스캔 오류' },
      { id: 'R2', name: '세트 구성품 차감', formula: '세트 판매 수량 × 구성 수량 = 구성품 차감 수량(ERP)', freq: '일 마감', target: 'ERP', fail: cnt('SETBOM'), unit: '건', hint: 'ERP 세트 BOM 미등록' },
      { id: 'R3', name: '주문 취소 연동', formula: 'OMS 취소 건 = WMS 출고 지시 취소 건', freq: '2시간', target: 'OMS ↔ WMS', fail: cnt('CANCEL'), unit: '건', hint: '출고 지시 후 취소 미회수' },
      { id: 'R4', name: '입고 검수 연동', formula: 'WMS 검수 수량 = ERP 입고 전표 수량', freq: '입고 시', target: 'WMS ↔ ERP', fail: cnt('INBOUND'), unit: '건', hint: '예정 수량으로 전표 생성' },
      { id: 'R5', name: '3시스템 재고 일치', formula: 'OMS 재고 = WMS 재고 = ERP 재고 (SKU별)', freq: '일 마감', target: 'OMS·WMS·ERP', fail: stockOff, unit: 'SKU', hint: '기간 종료일 기준' },
      { id: 'R6', name: '거래명세서 대사', formula: '거래명세서 수량 = 실제 출고 수량 (B2B 납품 건)', freq: '납품 시', target: 'ERP ↔ WMS', fail: inv ? inv.mismatch : null, unit: '건', hint: '분할 납품 미반영·수기 작성' },
      { id: 'R7', name: '3PL 청구 검증', formula: '청구 수량 = 작업 실적 수량, 청구 단가 = 해당 월 구간 견적 단가', freq: '월 마감', target: '3PL 청구서', fail: bill, unit: '항목', hint: '송장 중복·건수 과다·구간 단가 미적용' }
    ];
    rules.forEach(function (r) { r.status = r.fail === null ? null : r.fail === 0 ? 'ok' : r.fail <= 3 ? 'warn' : 'risk'; });
    return rules;
  }

  /* ------------------------------------------------------------------
   * 9. 정산 검증·운영 효율
   * ------------------------------------------------------------------ */
  function costTrend(F) {
    var rows = [];
    M.months.forEach(function (m) {
      if (monthEndDay[m] < F.from || monthStartDay[m] > F.to) return;
      var lines = D.billing.filter(function (b) { return b.month === m; }).map(billRow);
      var billed = lines.reduce(function (a, r) { return a + r.billedAmt; }, 0);
      var actual = lines.reduce(function (a, r) { return a + r.actualAmt; }, 0);
      var wl = D.workLogs[m];
      var byCat = {};
      lines.forEach(function (r) { byCat[r.cat] = (byCat[r.cat] || 0) + r.actualAmt; });
      rows.push({
        month: m, billed: billed, actual: actual, diff: billed - actual, outbound: wl.outbound,
        perShipment: actual / wl.outbound,              // 출고 1건당 물류비 = 월 물류비 합계(실적 기준) / 월 출고 건수
        perShipmentBilled: billed / wl.outbound, byCat: byCat
      });
    });
    return rows;
  }
  var RC = D.rateCard;
  function sizeOfBox(box) { return box <= 1 ? 'S' : box === 2 ? 'M' : 'L'; }
  function tierOfDay(d) { return D.workLogs[C.monthOf(d)].tier; }
  function boxCost(tier, size) { return RC.packing[tier][size] + RC.parcel[tier][size]; }   // 박스당 물류비(포장 + 택배)
  function efficiency(F) {
    var rows = [];
    M.months.forEach(function (m) {
      var ms = monthStartDay[m], me = monthEndDay[m];
      if (me < F.from || ms > F.to) return;
      var G = withPeriod(F, Math.max(ms, F.from), Math.min(me, F.to));
      var target = 0, merged = 0, boxes = [0, 0, 0, 0], parcel = 0, over = 0, overSave = 0, shipped = 0, unmergedSave = 0;
      var tier = D.workLogs[m].tier;
      eachShipped(G, function (o) {
        shipped++;
        var sz = sizeOfBox(o.box);
        if (o.grp && (o.merged || isSecondOfGroup(o))) { target++; if (o.merged) merged++; else unmergedSave += boxCost(tier, sz); }
        if (!o.merged) { boxes[o.box]++; parcel += RC.parcel[tier][sz]; }
        if (!o.merged && o.box > o.boxNeed) { over++; overSave += boxCost(tier, sz) - boxCost(tier, sizeOfBox(o.boxNeed)); }
      });
      var nb = boxes[0] + boxes[1] + boxes[2] + boxes[3];
      rows.push({
        month: m, shipped: shipped, mergeTarget: target, merged: merged,
        mergeRate: ratio(merged, target),               // 합포장 비율 = 합포장 출고 건 / 합포장 대상(동일 수취인 당일 복수 주문) 건
        boxes: boxes, boxShare: boxes.map(function (b) { return ratio(b, nb); }),
        parcelPerBox: ratio(parcel, nb),                // 건당 택배비 = 택배비 합계 / 택배 박스 수
        overBox: over, overBoxRate: ratio(over, nb), overBoxSave: overSave, unmergedSave: unmergedSave
      });
    });
    return rows;
  }
  var secondOfGroup = {};
  (function () {
    var seen = {};
    D.orders.forEach(function (o) { if (!o.grp) return; if (seen[o.grp]) secondOfGroup[o.idx] = true; else seen[o.grp] = true; });
  })();
  function isSecondOfGroup(o) { return !!secondOfGroup[o.idx]; }
  function opportunities(F) {
    var bd = billDiff(F);
    var eff = efficiency(F);
    var overSave = eff.reduce(function (a, r) { return a + r.overBoxSave; }, 0);
    var unmerged = eff.reduce(function (a, r) { return a + r.unmergedSave; }, 0);
    var target = eff.reduce(function (a, r) { return a + r.mergeTarget; }, 0);
    var merged = eff.reduce(function (a, r) { return a + r.merged; }, 0);
    // 합포장 비율을 80%까지 올릴 때 절감액 = 미합포장 절감 가능액 × (80% − 현재 비율) / (100% − 현재 비율)
    var rate = ratio(merged, target) || 0;
    var mergeSave = rate < 0.8 ? unmerged * (0.8 - rate) / (1 - rate) : 0;
    var annual = 365 / F.days;
    return {
      verifiedOver: bd.over, verifiedNet: bd.value, verifiedLines: bd.lines,
      boxSave: overSave, mergeSave: mergeSave, mergeRate: rate,
      total: bd.over + overSave + mergeSave,
      annualEfficiency: (overSave + mergeSave) * annual, annualFactor: annual
    };
  }

  /* ------------------------------------------------------------------
   * 9-1. 3PL 견적 단가 (구간 × 사이즈)
   *  - 구간 산정: 월 B2C 택배 박스 수 → A/B/C/D, 해당 월 전체 박스에 그 구간 단가 적용
   *  - 박스당 물류비 = 일반 포장 단가 + 택배비 단가
   *  - 월별·사이즈별 수치는 센터 단위(채널·상품 필터 미적용), 기간과 겹치는 월 기준
   * ------------------------------------------------------------------ */
  function monthsInPeriod(F) {
    return M.months.filter(function (m) { return monthEndDay[m] >= F.from && monthStartDay[m] <= F.to; });
  }
  function tierIndex(id) { return RC.tiers.map(function (t) { return t.id; }).indexOf(id); }
  function costAtTier(w, tier) {
    return ['S', 'M', 'L'].reduce(function (a, z) { return a + w.sizeBoxes[z] * boxCost(tier, z); }, 0);
  }
  function tierMonths(F) {
    return monthsInPeriod(F).map(function (m) {
      var w = D.workLogs[m];
      var ti = tierIndex(w.tier), next = RC.tiers[ti + 1] || null;
      var cost = costAtTier(w, w.tier);
      return {
        month: m, basis: w.tierBasis, b2bParcels: w.b2bParcels, totalBoxes: w.totalBoxes, sizeBoxes: w.sizeBoxes,
        tier: w.tier, nextTier: next ? next.id : null, toNext: next ? next.min - w.tierBasis : null,
        cost: cost,                                                 // 구간 단가 기준 포장 + 택배 비용
        costIfNext: next ? costAtTier(w, next.id) : null,           // 같은 물량에 다음 구간 단가를 적용하면
        tierIfB2B: w.tierIfB2B, costIfB2B: costAtTier(w, w.tierIfB2B),
        saveIfB2B: cost - costAtTier(w, w.tierIfB2B),               // B2B 택배를 구간 산정에 포함할 때 절감
        perBox: cost / w.totalBoxes
      };
    });
  }
  function sizeCost(F) {
    var ms = monthsInPeriod(F);
    var rows = RC.sizes.map(function (z) {
      var boxes = 0, pack = 0, parcel = 0;
      ms.forEach(function (m) {
        var w = D.workLogs[m], n = w.sizeBoxes[z.id];
        boxes += n; pack += n * RC.packing[w.tier][z.id]; parcel += n * RC.parcel[w.tier][z.id];
      });
      return { size: z.id, label: z.label, spec: z.spec, boxLabel: z.boxLabel, boxes: boxes, pack: pack, parcel: parcel, total: pack + parcel,
        avgPack: boxes ? pack / boxes : null, avgParcel: boxes ? parcel / boxes : null, perBox: boxes ? (pack + parcel) / boxes : null };
    });
    var tb = rows.reduce(function (a, r) { return a + r.boxes; }, 0), tc = rows.reduce(function (a, r) { return a + r.total; }, 0);
    rows.forEach(function (r) { r.boxShare = ratio(r.boxes, tb); r.costShare = ratio(r.total, tc); });
    // 박스 규격별(극소·소·중·대) 사용 수와 과대 박스로 생긴 추가 비용 (B2C, 센터 전체)
    var labels = ['극소', '소', '중', '대'];
    var box = labels.map(function (l, i) { return { box: i, label: l, size: sizeOfBox(i), n: 0, over: 0, extra: 0 }; });
    if (ms.length) {
      for (var d = monthStartDay[ms[0]]; d <= monthEndDay[ms[ms.length - 1]]; d++) {
        var t = tierOfDay(d);
        shippedByDay[d].forEach(function (o) {
          if (o.merged) return;
          var b = box[o.box];
          b.n++;
          if (o.box > o.boxNeed) { b.over++; b.extra += boxCost(t, sizeOfBox(o.box)) - boxCost(t, sizeOfBox(o.boxNeed)); }
        });
      }
    }
    return { rows: rows, totalBoxes: tb, totalCost: tc, months: ms.length, boxes: box,
      overExtra: box.reduce(function (a, b) { return a + b.extra; }, 0) };
  }
  function priceReduction(F) {
    // 단가 인하 우선순위 = (현재 적용 단가 − 비교 견적 단가) × 월평균 박스 수
    var ms = monthsInPeriod(F);
    if (!ms.length) return { items: [], levers: [], curTier: null };
    var cur = D.workLogs[ms[ms.length - 1]].tier;
    var avg = { S: 0, M: 0, L: 0 };
    ms.forEach(function (m) { ['S', 'M', 'L'].forEach(function (z) { avg[z] += D.workLogs[m].sizeBoxes[z] / ms.length; }); });
    var items = [];
    [['packing', '일반 포장'], ['parcel', '택배비']].forEach(function (k) {
      RC.sizes.forEach(function (z) {
        var price = RC[k[0]][cur][z.id], bench = RC.benchmark[k[0]][z.id];
        var gap = price - bench;
        items.push({ kind: k[1], size: z.id, label: k[1] + '(' + z.label + ')', tier: cur, price: price, bench: bench, gap: gap,
          gapRate: gap / price, monthlyBoxes: avg[z.id], monthlySave: Math.max(0, gap) * avg[z.id] });
      });
    });
    items.sort(function (a, b) { return b.monthlySave - a.monthlySave; });
    var totSave = items.reduce(function (a, r) { return a + r.monthlySave; }, 0);
    items.forEach(function (r, i) { r.rank = i + 1; r.share = ratio(r.monthlySave, totSave); });
    var tm = tierMonths(F), sc = sizeCost(F), eff = efficiency(F), op = opportunities(F);
    var n = ms.length;
    var levers = [
      { id: 'nego', name: '단가 협상', how: '현재 ' + cur + '구간 단가를 비교 견적 수준으로 인하', monthly: totSave },
      { id: 'tier', name: '구간 산정 기준 변경', how: 'B2B 택배(약국·의원)를 구간 산정 물량에 포함', monthly: tm.reduce(function (a, r) { return a + r.saveIfB2B; }, 0) / n,
        months: tm.filter(function (r) { return r.saveIfB2B > 0; }).length },
      { id: 'size', name: '박스 규격 하향', how: '필요 규격보다 큰 박스 사용을 줄여 소형·중형 단가 적용', monthly: sc.overExtra / n },
      { id: 'merge', name: '합포장 확대', how: '동일 수취인 당일 주문 합포장 80% 달성', monthly: op.mergeSave / Math.max(1, eff.length) }
    ];
    levers.forEach(function (l) { l.annual = l.monthly * 12; });
    levers.sort(function (a, b) { return b.monthly - a.monthly; });
    return { items: items, levers: levers, curTier: cur, curMonth: ms[ms.length - 1], monthlyTotal: totSave, avgBoxes: avg };
  }

  /* ------------------------------------------------------------------
   * 10. 공개 API
   * ------------------------------------------------------------------ */
  global.SCMMetrics = {
    resolveFilter: resolveFilter, withPeriod: withPeriod, KPI_DEF: KPI_DEF, statusOf: statusOf,
    kpis: kpis, kpiValues: kpiValues, actionList: actionList,
    sameDayRate: sameDayRate, avgLead: avgLead, b2bOnTime: b2bOnTime, misRate: misRate, matchRate: matchRate, billDiff: billDiff,
    funnel: funnel, dailyVsCapacity: dailyVsCapacity, hourlySameDay: hourlySameDay, pendingOrders: pendingOrders, prepackCompare: prepackCompare,
    b2bSchedule: b2bSchedule, complianceByType: complianceByType, complianceByRegion: complianceByRegion, weeklyLoad: weeklyLoad,
    lateAccounts: lateAccounts, shelfLife: shelfLife, invoiceRecon: invoiceRecon, b2bVolume: b2bVolume,
    stockStatusRows: stockStatusRows, sellable: sellable, inboundRows: inboundRows, inboundMonthly: inboundMonthly,
    stockoutRisk: stockoutRisk, stockProjection: stockProjection, simulate: simulate,
    tplPerformance: tplPerformance, tplMonthly: tplMonthly, pareto: pareto, issueCauses: issueCauses,
    issueBySource: issueBySource, issueByDept: issueByDept, issueList: issueList, preventionCards: preventionCards,
    systemFlow: systemFlow, reconTable: reconTable, matchTrend: matchTrend, mismatchCauseSummary: mismatchCauseSummary,
    mismatchList: mismatchList, normalization: normalization, cycleCountRows: cycleCountRows, validationRules: validationRules,
    billingInPeriod: billingInPeriod, costTrend: costTrend, efficiency: efficiency, opportunities: opportunities,
    rateCard: function () { return RC; }, tierMonths: tierMonths, sizeCost: sizeCost, priceReduction: priceReduction, boxCost: boxCost
  };
})(typeof window !== 'undefined' ? window : globalThis);
