/* =====================================================================
 * js/data.js — 가상 데이터 생성 (Fashion 3PL Control Tower)
 * ---------------------------------------------------------------------
 * 여러 패션 브랜드(화주사)의 상품을 맡아 운영하는 3PL 물류센터를 가정한 시뮬레이션입니다.
 * - 화주사·상품·주문·재고·인력·단가·청구 금액은 모두 가상 데이터입니다(시드 고정 난수).
 * - 하루 단위로 입고 → 적치 → B2C·B2B 출고 → 반품 처리 → 재고 반영 순서를 실제로 계산합니다.
 *   그래서 프로모션 물량, 결품, 인력 결원 같은 시나리오가 SLA·재고·반품·생산성 수치에 함께 나타납니다.
 * - 기간: 2026-04-01 ~ 2026-09-30, 기준 시각 2026-09-30 15:30 (마지막 날은 진행 중)
 * ===================================================================== */
(function (global) {
  'use strict';

  var SEED = 20260930;
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var rnd = mulberry32(SEED);
  function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
  function pickW(list, wf) {
    var tot = 0, i;
    for (i = 0; i < list.length; i++) tot += wf(list[i]);
    var r = rnd() * tot;
    for (i = 0; i < list.length; i++) { r -= wf(list[i]); if (r <= 0) return list[i]; }
    return list[list.length - 1];
  }

  /* ---------------- 달력 ---------------- */
  var T0 = Date.UTC(2026, 3, 1), DAYS = 183, END = DAYS - 1;
  var DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
  function isoOf(d) { return new Date(T0 + d * 864e5).toISOString().slice(0, 10); }
  function dayOf(iso) { var p = iso.split('-'); return Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - T0) / 864e5); }
  function dowOf(d) { return new Date(T0 + d * 864e5).getUTCDay(); }
  // 센터 휴무일(가정): 주말 + 아래 날짜
  var HOLI_ISO = ['2026-05-05', '2026-05-25', '2026-06-03', '2026-08-17', '2026-09-24', '2026-09-25'];
  var HOLI = {};
  HOLI_ISO.forEach(function (s) { HOLI[dayOf(s)] = true; });
  function isBiz(d) { var w = dowOf(d); return w >= 1 && w <= 5 && !HOLI[d]; }
  function nextBiz(d) { do { d++; } while (!isBiz(d)); return d; }
  function bizOnOrAfter(d) { while (!isBiz(d)) d++; return d; }
  function addBiz(d, n) { for (var i = 0; i < n; i++) d = nextBiz(d); return d; }
  function monthOf(d) { return isoOf(d).slice(0, 7); }
  var MONTHS = [];
  for (var md = 0; md < DAYS; md++) if (MONTHS.indexOf(monthOf(md)) < 0) MONTHS.push(monthOf(md));
  function monthRange(m) {
    var s = dayOf(m + '-01'), e = s;
    while (e + 1 < DAYS && monthOf(e + 1) === m) e++;
    return [s, e];
  }
  var cal = { isoOf: isoOf, dayOf: dayOf, dowOf: dowOf, DOW_KO: DOW_KO, isBiz: isBiz, nextBiz: nextBiz, bizOnOrAfter: bizOnOrAfter, addBiz: addBiz, monthOf: monthOf, months: MONTHS, monthRange: monthRange };

  var NOW = 15 * 60 + 30;          // 기준 시각 15:30 (마지막 날)
  var WORK_START = 9 * 60, WORK_END = 18 * 60;   // 정규 근무 09:00~18:00, 연장 최대 1.5시간
  var LAST_TRUCK = 19 * 60 + 30;   // 택배 마지막 상차(연장 포함)

  /* ---------------- 표준 생산성(가정) ---------------- */
  var STD = {
    b2c: 15.5,     // B2C 1인 시간당 처리 주문(피킹+패킹, 평균 1.4라인 기준)
    b2b: 180,      // B2B 1인 시간당 처리 pcs(피킹·검수·납품처 라벨·박스)
    inbound: 150,  // 입고 1인 시간당 검수·적치 pcs
    ret: 16        // 반품 1인 시간당 검수·분류 pcs(택·오염 확인, 재포장 포함)
  };
  var BASE_STAFF = { inbound: 3, b2c: 10, b2b: 1, ret: 1 };
  var MAX_TEMPS = 10;   // 하루 확보 가능한 단기 인력 상한(가정)   // 정규 인원(가정)

  /* ---------------- 화주사(가상 브랜드) ---------------- */
  var BRANDS = [
    { id: 'A', name: '브랜드 A', cat: '캐주얼', channel: '자사몰 · 패션 플랫폼', base: 360, cutoff: 14 * 60, sla: 0.98, b2bLead: 2, retRate: 0.06, exShare: 0.45,
      dests: ['직영 매장 1', '직영 매장 2', '팝업 스토어'], b2bDays: [2, 5], b2bQty: [300, 700],
      inDays: [2, 5], cover: 30, palletPcs: 320, zone: 'A', pallets: 82,
      rates: { inbound: 120, storage: 18000, b2c: 900, extra: 250, b2b: 180, ret: 1000, pack: 250 } },
    { id: 'B', name: '브랜드 B', cat: '여성복', channel: '자사몰 · 백화점 온라인몰', base: 220, cutoff: 13 * 60, sla: 0.98, b2bLead: 2, retRate: 0.11, exShare: 0.55,
      dests: ['백화점 매장 1', '백화점 매장 2', '아울렛 매장'], b2bDays: [1, 3, 5], b2bQty: [200, 500],
      inDays: [3], cover: 35, palletPcs: 260, zone: 'B', pallets: 70,
      rates: { inbound: 130, storage: 20000, b2c: 950, extra: 300, b2b: 200, ret: 1100, pack: 300 } },
    { id: 'C', name: '브랜드 C', cat: '스포츠웨어', channel: '자사몰 · 오픈마켓', base: 150, cutoff: 15 * 60, sla: 0.97, b2bLead: 3, retRate: 0.045, exShare: 0.35,
      dests: ['편집숍 A', '편집숍 B', '스포츠 매장 C', '도매 거래처 D'], b2bDays: [1, 2, 3, 4, 5], b2bQty: [150, 500],
      inDays: [1, 4], cover: 30, palletPcs: 360, zone: 'C', pallets: 62,
      rates: { inbound: 110, storage: 17000, b2c: 850, extra: 250, b2b: 160, ret: 950, pack: 250 } },
    { id: 'D', name: '브랜드 D', cat: '슈즈·잡화', channel: '자사몰 · 패션 플랫폼', base: 120, cutoff: 14 * 60, sla: 0.98, b2bLead: 2, retRate: 0.07, exShare: 0.6,
      dests: ['슈즈 편집숍 1', '백화점 잡화 매장', '온라인 도매몰'], b2bDays: [2, 4], b2bQty: [150, 400],
      inDays: [3], cover: 35, palletPcs: 120, zone: 'D', pallets: 88,
      rates: { inbound: 150, storage: 22000, b2c: 1000, extra: 350, b2b: 220, ret: 1200, pack: 350 } }
  ];
  var BI = {};
  BRANDS.forEach(function (b, i) { BI[b.id] = i; });

  var COLOR_CODE = { '화이트': 'WH', '블랙': 'BK', '그레이': 'GY', '네이비': 'NV', '연청': 'LB', '진청': 'DB', '베이지': 'BE', '아이보리': 'IV', '스카이': 'SK', '오트밀': 'OT', '차콜': 'CC', '라이트그레이': 'LG', '카키': 'KH', '브라운': 'BR' };
  var STYLES = {
    A: [['A-TS', '오버핏 반팔 티셔츠', ['화이트', '블랙'], ['S', 'M', 'L', 'XL'], 1.3, 'SS', '의류'],
        ['A-HD', '기모 후드 집업', ['그레이', '네이비'], ['S', 'M', 'L', 'XL'], 1.0, 'FW', '의류'],
        ['A-DN', '와이드 데님 팬츠', ['연청', '진청'], ['S', 'M', 'L', 'XL'], 0.9, 'ALL', '의류'],
        ['A-CP', '로고 볼캡', ['블랙', '베이지'], ['FREE'], 0.5, 'ALL', '잡화']],
    B: [['B-BL', '린넨 블라우스', ['아이보리', '스카이'], ['S', 'M', 'L'], 1.0, 'SS', '의류'],
        ['B-SL', '와이드 슬랙스', ['블랙', '베이지'], ['S', 'M', 'L'], 1.3, 'ALL', '의류'],
        ['B-KN', '캐시미어 블렌드 니트', ['오트밀', '차콜'], ['S', 'M', 'L'], 0.8, 'FW', '의류'],
        ['B-DR', '플리츠 원피스', ['네이비', '블랙'], ['S', 'M', 'L'], 0.9, 'ALL', '의류']],
    C: [['C-RT', '러닝 티셔츠', ['블랙', '라이트그레이'], ['S', 'M', 'L', 'XL'], 1.2, 'SS', '의류'],
        ['C-LG', '트레이닝 레깅스', ['블랙', '네이비'], ['S', 'M', 'L', 'XL'], 1.0, 'ALL', '의류'],
        ['C-WB', '윈드브레이커', ['블랙', '카키'], ['S', 'M', 'L', 'XL'], 0.8, 'FW', '의류'],
        ['C-SC', '러닝 양말 3팩', ['화이트', '블랙'], ['FREE'], 0.6, 'ALL', '잡화']],
    D: [['D-SN', '캔버스 스니커즈', ['화이트', '블랙'], ['230', '240', '250', '260', '270'], 1.2, 'ALL', '신발'],
        ['D-SD', '스포츠 샌들', ['블랙', '베이지'], ['230', '250', '270'], 0.9, 'SS', '신발'],
        ['D-BT', '첼시 부츠', ['블랙', '브라운'], ['240', '250', '260', '270'], 0.6, 'FW', '신발'],
        ['D-BG', '캔버스 토트백', ['베이지', '블랙'], ['FREE'], 0.7, 'ALL', '잡화']]
  };
  var SIZE_W = {
    'S,M,L,XL': { S: 0.2, M: 0.35, L: 0.3, XL: 0.15 }, 'S,M,L': { S: 0.3, M: 0.42, L: 0.28 }, 'FREE': { FREE: 1 },
    '230,240,250,260,270': { 230: 0.12, 240: 0.2, 250: 0.26, 260: 0.24, 270: 0.18 }, '230,250,270': { 230: 0.3, 250: 0.4, 270: 0.3 },
    '240,250,260,270': { 240: 0.22, 250: 0.3, 260: 0.28, 270: 0.2 }
  };
  function sizeW(sizes, sz) { return SIZE_W[sizes.join(',')][sz]; }
  // 월별 시즌 계수 (4월~9월)
  var SEASON = { SS: [1.0, 1.2, 1.3, 1.3, 1.0, 0.5], FW: [0.4, 0.2, 0.15, 0.15, 0.5, 1.4], ALL: [1, 1, 1, 1, 1, 1] };
  var MI = [];
  for (var mi0 = 0; mi0 < DAYS; mi0++) MI.push(MONTHS.indexOf(monthOf(mi0)));
  function mIdx(d) { return MI[Math.min(d, DAYS - 1)]; }

  var SKUS = [], STYLE_LIST = [];
  BRANDS.forEach(function (b) {
    STYLES[b.id].forEach(function (st, si) {
      // st = [스타일 코드, 상품명, 색상, 사이즈, 인기 가중치, 시즌, 품목]
      STYLE_LIST.push({ id: st[0], brand: b.id, name: st[1], colors: st[2], sizes: st[3], season: st[5], cat: st[6] });
      st[2].forEach(function (col, ci) {
        st[3].forEach(function (sz, zi) {
          SKUS.push({
            idx: SKUS.length, id: st[0] + '-' + COLOR_CODE[col] + '-' + sz, brand: b.id, style: st[0], styleName: st[1], color: col, size: sz, season: st[5], cat: st[6],
            name: st[1] + ' ' + col + ' ' + sz,
            w: st[4] * (ci === 0 ? 0.55 : 0.45) * sizeW(st[3], sz),
            loc: b.zone + '-' + ('0' + (si + 1)).slice(-2) + '-' + (ci + 1) + '-' + ('0' + (zi + 1)).slice(-2)
          });
        });
      });
    });
  });
  var SKU_BY_ID = {};
  SKUS.forEach(function (s) { SKU_BY_ID[s.id] = s.idx; });
  var BRAND_SKUS = { A: [], B: [], C: [], D: [] };
  SKUS.forEach(function (s) { BRAND_SKUS[s.brand].push(s); });
  var LOC_PER_SKU = 3;   // 피킹 로케이션 1 + 보관(리저브) 로케이션 2

  /* ---------------- 시나리오(가상) ---------------- */
  var SC = {
    promoJun: [dayOf('2026-06-15'), dayOf('2026-06-16')],
    promo: [dayOf('2026-09-07'), dayOf('2026-09-09')],
    seasonOffB: [dayOf('2026-08-18'), dayOf('2026-08-31')],
    shortage: [dayOf('2026-09-15'), dayOf('2026-09-17')],
    stockoutSku: 'B-SL-BK-M',
    stockoutHold: [dayOf('2026-08-12'), dayOf('2026-09-28')],   // 생산 지연으로 입고가 끊긴 기간
    stockoutArrive: dayOf('2026-09-29'),
    seasonOpenC: [dayOf('2026-09-15'), dayOf('2026-09-16')],
    retTempFrom: dayOf('2026-09-21'),
    fwBuild: dayOf('2026-08-10')
  };
  function inR(d, r) { return d >= r[0] && d <= r[1]; }
  var SCENARIOS = [
    { id: 'promo', title: '프로모션 주문 급증', brand: 'A', from: SC.promo[0], to: SC.promo[1],
      setup: '브랜드 A 가을 기획전으로 3일간 B2C 주문이 평소의 약 3.5배로 늘어남. 인력 계획은 1.8배 물량 기준으로 세웠고 단기 인력은 하루 최대 10명까지만 확보 가능.',
      see: ['b2c', 'labor', 'returns'] },
    { id: 'stockout', title: '특정 사이즈 결품', brand: 'B', from: SC.stockoutHold[0], to: SC.stockoutArrive,
      setup: '브랜드 B 와이드 슬랙스 블랙 M 사이즈의 생산이 늦어져 8/12 이후 추가 입고가 끊기고 9/29에 재입고됨. 이 사이즈가 포함된 주문은 결품 대기로 출고가 미뤄짐.',
      see: ['inventory', 'b2c', 'inbound'] },
    { id: 'returns', title: '반품 적체', brand: 'B', from: SC.seasonOffB[0], to: SC.retTempFrom,
      setup: '브랜드 B 시즌오프(8/18~8/31) 주문의 반품·교환이 늘고, 9월 기획전 반품까지 겹쳐 반품 검수 대기가 쌓임. 9/21부터 반품 인원 1명 추가.',
      see: ['returns', 'labor', 'inventory'] },
    { id: 'b2b', title: 'B2B 납기 지연', brand: 'C', from: SC.seasonOpenC[0], to: SC.seasonOpenC[1] + 4,
      setup: '브랜드 C 편집숍 시즌 오픈 대량 발주(9/15~9/16, 4건)가 인력 결원 기간과 겹쳐 B2B 출고가 납기를 넘김. 대량 발주에 맞춰 9월 초 입고 물량은 미리 늘려 둠.',
      see: ['b2b', 'labor'] },
    { id: 'shortage', title: '작업 인력 부족', brand: null, from: SC.shortage[0], to: SC.shortage[1],
      setup: '9/15~9/17 정규 인원 결원과 단기 인력 취소로 계획 대비 실제 인원이 줄어 처리 능력이 떨어짐.',
      see: ['labor', 'b2c', 'b2b'] }
  ];

  /* ---------------- 수요 ---------------- */
  var DOW_F = [1.0, 1.12, 1.05, 1.0, 0.98, 0.92, 0.85];
  var HOUR_W = [3, 2, 1, 1, 1, 1, 2, 3, 4, 5, 6, 6, 6, 5, 5, 5, 5, 5, 6, 7, 8, 8, 7, 5];
  var HOUR_TOT = HOUR_W.reduce(function (a, x) { return a + x; }, 0);
  function brandFactor(b, d) {
    var f = 1;
    if (b === 'A' && (inR(d, SC.promoJun))) f *= 2.0;
    if (b === 'A' && (inR(d, SC.promo))) f *= 3.5;
    if (b === 'B' && inR(d, SC.seasonOffB)) f *= 1.35;
    if (b === 'C' && d >= dayOf('2026-09-01')) f *= 1.15;
    return f;
  }
  // 하루 예상 출고(개) = B2C 판매 + B2B 납품 — 발주(입고 계획)용
  function b2bDaily(b) {
    var perDay = b.id === 'C' ? 1.5 : b.b2bDays.length / 5;
    return perDay * (b.b2bQty[0] + b.b2bQty[1]) / 2 * 5 / 7;
  }
  var demCache = {};
  function skuDemand(s, d) {
    var key = s.idx + ':' + mIdx(d) + ':' + brandFactor(s.brand, d);
    if (demCache[key] !== undefined) return demCache[key];
    var b = BRANDS[BI[s.brand]];
    var tot = 0, tot2 = 0;
    BRAND_SKUS[s.brand].forEach(function (x) { tot += x.w * SEASON[x.season][mIdx(d)]; tot2 += x.w * SEASON[x.season][mIdx(d)] + 0.05; });
    var v = b.base * 1.4 * Math.min(brandFactor(s.brand, d), 1.5) * (s.w * SEASON[s.season][mIdx(d)] / tot) + b2bDaily(b) * ((s.w * SEASON[s.season][mIdx(d)] + 0.05) / tot2);
    demCache[key] = v;
    return v;
  }
  function sampleMinute(maxMin) {
    for (;;) {
      var r = rnd() * HOUR_TOT, h = 0;
      while (h < 23 && (r -= HOUR_W[h]) > 0) h++;
      var m = h * 60 + Math.floor(rnd() * 60);
      if (maxMin === undefined || m < maxMin) return m;
    }
  }
  var nowShare = (function () {   // 마지막 날 15:30까지의 주문 비중
    var s = 0;
    for (var h = 0; h < 15; h++) s += HOUR_W[h];
    return (s + HOUR_W[15] * 0.5) / HOUR_TOT;
  })();

  /* ---------------- 생성 상태 ---------------- */
  var stock = SKUS.map(function (s) { return Math.round(skuDemand(s, 0) * BRANDS[BI[s.brand]].cover); });
  var startStock = stock.slice();
  var orders = [], ordersByDay = [], shipByDay = [];
  var b2b = [], inbound = [], returns = [], labor = [], cycle = [];
  var stockDaily = [];          // [day] = 브랜드별 마감 재고(개) {A,B,C}
  var skuZeroDays = SKUS.map(function () { return []; });   // 결품(가용 0) 일자
  var b2cPending = [], b2bPending = [], inPending = [], retPending = [];
  var alloc = SKUS.map(function () { return 0; });   // 마지막 날 할당(출고 예정) 수량
  var zeroRun = SKUS.map(function () { return 0; });  // 연속 결품 일수
  var oSeq = 0, bSeq = 0, iSeq = 0, rSeq = 0;
  for (var z = 0; z < DAYS; z++) { ordersByDay.push([]); shipByDay.push([]); }

  function newOrder(brand, day, t, lines, ex) {
    var b = BRANDS[BI[brand]];
    var due = isBiz(day) && t < b.cutoff ? day : nextBiz(day);
    var o = { id: 'O' + (++oSeq), brand: brand, day: day, t: t, lines: lines, due: due, ex: !!ex,
      hold: null, ship: null, shipT: null, pickT: null, packT: null, late: false, cause: null, mis: null, blocked: 0, plan: null };
    if (!ex && rnd() < 0.004) o.hold = addBiz(due, ri(1, 2));   // 주소 확인·고객 요청 보류 → SLA 제외
    orders.push(o); ordersByDay[day].push(o); b2cPending.push(o);
    return o;
  }
  function genLines(brand, d) {
    var n = rnd() < 0.7 ? 1 : rnd() < 0.73 ? 2 : 3, lines = [], used = {};
    for (var i = 0; i < n; i++) {
      var s = pickW(BRAND_SKUS[brand], function (x) { return used[x.idx] || zeroRun[x.idx] >= 2 ? 0 : x.w * SEASON[x.season][mIdx(d)]; });   // 2일 이상 가용 0이면 쇼핑몰 품절 처리(가정)
      used[s.idx] = 1;
      lines.push([s.idx, rnd() < 0.9 ? 1 : 2]);
    }
    return lines;
  }
  function stockOk(lines) { return lines.every(function (l) { return stock[l[0]] >= l[1]; }); }

  // 입고 계획: 입고 요일마다 목표 재고 일수에 맞춰 발주(가정). 결품 시나리오 SKU는 생산 지연 기간에 제외
  var inTransit = SKUS.map(function () { return 0; });
  function planInbound(b, d) {
    var lines = [], qty = 0;
    BRAND_SKUS[b.id].forEach(function (s) {
      if (s.id === SC.stockoutSku && d >= SC.stockoutHold[0] && d < SC.stockoutArrive) return;
      var dem = skuDemand(s, Math.min(END, d + 10));
      var cover = b.cover + (s.season === 'FW' && d >= SC.fwBuild ? 20 : 0) + (b.id === 'C' && d >= dayOf('2026-09-01') && d < SC.seasonOpenC[1] ? 25 : 0);   // C: 시즌 오픈 대량 발주 대비
      var need = dem * cover - (stock[s.idx] + inTransit[s.idx]);
      if (s.id === SC.stockoutSku && d === SC.stockoutArrive) need = Math.max(need, dem * 40);
      if (need > dem * 7) {
        var q = Math.round(need / 10) * 10;
        lines.push([s.idx, q]); qty += q; inTransit[s.idx] += q;
      }
    });
    if (!lines.length) return;
    var rec = lines.map(function (l) { return [l[0], l[1]]; }), diff = 0;
    if (rnd() < 0.12) {   // 수량 차이(입고 예정 대비 부족)
      var li = ri(0, rec.length - 1), dq = Math.max(1, Math.round(rec[li][1] * (0.01 + rnd() * 0.02)));
      rec[li][1] -= dq; diff = dq;
    }
    var defect = 0;
    rec.forEach(function (l) { var x = Math.round(l[1] * (rnd() < 0.5 ? 0.002 : 0.006) * rnd()); l.push(x); defect += x; });
    var urgent = lines.some(function (l) { return zeroRun[l[0]] > 0; });   // 결품 SKU가 포함된 입고는 먼저 적치
    var ib = { id: 'IN' + (++iSeq), brand: b.id, arrive: d, asnQty: qty, recvQty: qty - diff, diff: diff, defect: defect, lines: lines, recv: rec, urgent: urgent,
      done: 0, putaway: null, diffNote: diff ? '입고 예정 대비 부족 · 화주사 확인 요청' : '' };
    inbound.push(ib); inPending.push(ib);
  }

  /* ---------------- 하루씩 시뮬레이션 ---------------- */
  for (var d = 0; d < DAYS; d++) {
    var isEnd = d === END;
    // 1) B2C 주문 접수
    BRANDS.forEach(function (b) {
      var n = Math.round(b.base * DOW_F[dowOf(d)] * brandFactor(b.id, d) * (0.92 + rnd() * 0.16) * (isEnd ? nowShare : 1));
      var ts = [];
      for (var i = 0; i < n; i++) ts.push(sampleMinute(isEnd ? NOW : undefined));
      ts.sort(function (x, y) { return x - y; });
      ts.forEach(function (t) { newOrder(b.id, d, t, genLines(b.id, d)); });
    });
    // B2B 발주 접수
    if (isBiz(d)) BRANDS.forEach(function (b) {
      var cnt = b.b2bDays.indexOf(dowOf(d)) >= 0 ? (b.id === 'C' ? (rnd() < 0.5 ? 1 : 2) : 1) : 0;
      if (b.id === 'C' && inR(d, SC.seasonOpenC)) cnt += 2;
      for (var k = 0; k < cnt; k++) {
        var big = b.id === 'C' && inR(d, SC.seasonOpenC) && k >= cnt - 2;
        var qty = big ? ri(1500, 2200) : ri(b.b2bQty[0], b.b2bQty[1]);
        var ns = ri(4, 8), pool = BRAND_SKUS[b.id].slice(), ls = [], wsum = 0;
        for (var j = 0; j < ns && pool.length; j++) {
          var s = pickW(pool, function (x) { return x.w * SEASON[x.season][mIdx(d)] + 0.05; });
          pool.splice(pool.indexOf(s), 1);
          ls.push([s.idx, s.w * SEASON[s.season][mIdx(d)] + 0.05]); wsum += ls[ls.length - 1][1];
        }
        var lines = ls.map(function (l) { return [l[0], Math.max(5, Math.round(qty * l[1] / wsum / 5) * 5)]; });
        qty = lines.reduce(function (a, l) { return a + l[1]; }, 0);
        var bo = { id: 'B2B' + (++bSeq), brand: b.id, dest: b.dests[ri(0, b.dests.length - 1)], day: d, t: ri(10 * 60, 16 * 60), due: addBiz(d, big ? 2 : b.b2bLead),
          lines: lines, qty: qty, big: big, alloc: null, shipQty: 0, short: 0, done: 0, ship: null, late: false, cause: null, start: null };
        if (d === END && bo.t > NOW) continue;
        b2b.push(bo); b2bPending.push(bo);
      }
    });
    // 입고 도착(입고 요일)
    if (isBiz(d)) BRANDS.forEach(function (b) { if (b.inDays.indexOf(dowOf(d)) >= 0 || (b.id === 'B' && d === SC.stockoutArrive)) planInbound(b, d); });

    if (!isBiz(d)) {
      stockDaily.push(brandStock());
      markZero(d);
      continue;
    }

    // 2) 인력 계획(전날 기준 예측) → 실제 인원
    var queue = b2cPending.filter(function (o) { return o.due <= d; });
    var knownDue = queue.filter(function (o) { return o.day < d; }).length;
    var expToday = 0;
    BRANDS.forEach(function (b) {
      var pf = brandFactor(b.id, d);
      if (b.id === 'A' && inR(d, SC.promo)) pf = 1.8;   // 기획전 물량을 1.8배로 예측(실제 약 3.5배)
      var pre = 0;
      for (var h = 0; h < b.cutoff / 60; h++) pre += HOUR_W[h];
      expToday += b.base * DOW_F[dowOf(d)] * pf * pre / HOUR_TOT;
    });
    var fc = knownDue + expToday;
    var b2cPlan = Math.max(BASE_STAFF.b2c - 2, Math.min(BASE_STAFF.b2c + MAX_TEMPS, Math.ceil(fc / (8 * STD.b2c * 0.95))));
    var b2bWork = b2bPending.reduce(function (a, o) { return a + (o.due <= addBiz(d, 1) ? o.qty - o.done : 0); }, 0);
    var b2bPlan = Math.max(BASE_STAFF.b2b, Math.min(3, Math.ceil(b2bWork / (8 * STD.b2b))));
    var inWork = inPending.reduce(function (a, x) { return a + x.recvQty - x.done; }, 0);
    var inPlan = d >= SC.fwBuild ? 4 : BASE_STAFF.inbound;
    var retPlan = d >= SC.retTempFrom ? 2 : BASE_STAFF.ret;
    var plan = { inbound: inPlan, b2c: b2cPlan, b2b: b2bPlan, ret: retPlan };
    var absent = { inbound: 0, b2c: rnd() < 0.35 ? ri(1, 2) : 0, b2b: rnd() < 0.1 ? 1 : 0, ret: 0 };
    var tempsPlanned = Math.max(0, b2cPlan - BASE_STAFF.b2c), tempsCancel = 0;
    if (inR(d, SC.shortage)) { absent.b2c = ri(3, 4); tempsCancel = Math.min(tempsPlanned, 2); absent.b2b = Math.max(1, b2bPlan - 1); absent.ret = 1; absent.inbound = 1; }
    var act = {};
    Object.keys(plan).forEach(function (k) { act[k] = Math.max(0, plan[k] - absent[k] - (k === 'b2c' ? tempsCancel : 0)); });
    var prod = 0.93 + rnd() * 0.12;
    if (tempsPlanned - tempsCancel > 0) prod *= 1 - 0.1 * (tempsPlanned - tempsCancel) / Math.max(1, act.b2c);   // 단기 인력은 숙련도가 낮다고 가정

    // 3) B2C 출고: 납기(due) 오늘 이하 주문을 납기·접수 순으로 처리
    queue = b2cPending.filter(function (o) { return o.due <= d && (o.hold === null || o.hold <= d); });
    queue.sort(function (x, y) { return x.due - y.due || x.day - y.day || x.t - y.t; });
    var capReg = act.b2c * 8 * STD.b2c * prod;
    var otH = queue.length > capReg ? Math.min(1.5, (queue.length - capReg) / Math.max(1, act.b2c * STD.b2c * prod)) : 0;
    var capTot = Math.floor(capReg + act.b2c * otH * STD.b2c * prod);
    var winEnd = WORK_END + otH * 60;
    var k2 = 0, shippedToday = 0, linesToday = 0, blockedToday = 0;
    var spread = Math.max(1, Math.min(queue.filter(function (o) { return stockOk(o.lines); }).length, capTot));
    var mixRate = (inR(d, SC.promo) || inR(d, SC.shortage) || inR(d, SC.promoJun)) ? 0.0024 : 0.0007;
    for (var qi = 0; qi < queue.length && k2 < capTot; qi++) {
      var o = queue[qi];
      if (!stockOk(o.lines)) { o.blocked++; blockedToday++; continue; }
      var slot = WORK_START + Math.round((k2 / spread) * (winEnd - WORK_START));   // 처리 물량을 근무 시간 전체에 나눠 배치
      var earliest = o.day === d ? o.t + 45 : WORK_START;
      var st = Math.max(slot, earliest);
      if (st > Math.min(winEnd, LAST_TRUCK)) continue;
      o.lines.forEach(function (l) { stock[l[0]] -= l[1]; });
      var pickT = Math.max(o.day === d ? o.t + 10 : WORK_START - 20, st - ri(25, 70)), packT = Math.max(pickT + 3, st - ri(5, 20));
      if (isEnd && st > NOW) {   // 기준 시각 이후 출고 예정(진행 중)
        o.plan = st; o.pickT = pickT; o.packT = packT;
        o.lines.forEach(function (l) { alloc[l[0]] += l[1]; });
      } else {
        o.ship = d; o.shipT = st; o.pickT = pickT; o.packT = packT;
        shipByDay[d].push(o); shippedToday++;
        if (rnd() < mixRate) o.mis = ['사이즈 오출고', '색상 오출고', '수량 누락'][ri(0, 2)];
      }
      linesToday += o.lines.length;
      k2++;
    }
    b2cPending = b2cPending.filter(function (o) { return o.ship === null && o.plan === null; });
    var afterOff = !isBiz(d - 1) || !isBiz(d - 2);   // 직전에 휴무일이 있어 물량이 몰린 날
    if (!isEnd) b2cPending.forEach(function (o) {
      if (o.due === d && !o.late && o.hold === null) {
        o.late = true;
        o.cause = o.blocked ? '결품 대기' : inR(d, SC.shortage) ? '작업 인력 부족' : (inR(d, SC.promo) || inR(d, SC.promoJun)) ? '프로모션 물량 급증' : afterOff ? '주말·연휴 후 물량 집중' : '처리 용량 초과';
      }
    });

    // 4) B2B 출고: 납기 순으로 작업, 하루 처리량(pcs) 안에서 진행
    var b2bCap = act.b2b * 8 * STD.b2b * (0.95 + rnd() * 0.08), b2bDoneToday = 0;
    b2bPending.sort(function (x, y) { return x.due - y.due || x.day - y.day; });
    for (var bi2 = 0; bi2 < b2bPending.length && b2bCap > 0; bi2++) {
      var bo2 = b2bPending[bi2];
      if (bo2.day === d && bo2.t > 15 * 60) continue;
      if (bo2.alloc === null) {   // 작업 시작 시 재고 할당(부족분은 결품 부분 출고)
        bo2.start = d;
        bo2.alloc = bo2.lines.map(function (l) { var q = Math.min(l[1], Math.max(0, stock[l[0]])); stock[l[0]] -= q; return [l[0], q]; });
        bo2.shipQty = bo2.alloc.reduce(function (a, l) { return a + l[1]; }, 0);
        bo2.short = bo2.qty - bo2.shipQty;
      }
      var w2 = Math.min(b2bCap, bo2.shipQty - bo2.done);
      bo2.done += w2; b2bCap -= w2; b2bDoneToday += w2;
      if (bo2.done >= bo2.shipQty) {
        if (isEnd) { bo2.plan = d; bo2.alloc.forEach(function (l) { alloc[l[0]] += l[1]; }); }
        else bo2.ship = d;
      }
    }
    b2bPending = b2bPending.filter(function (o) { return o.ship === null && o.plan === undefined; });
    if (!isEnd) b2bPending.forEach(function (o) {
      if (o.due === d && !o.late) {
        o.late = true;
        o.cause = inR(d, SC.shortage) ? '작업 인력 부족' : o.big ? '대량 발주 집중' : '처리 용량 초과';
      }
    });

    // 5) 입고 검수·적치 (도착 순, 하루 처리량 pcs)
    var inCap = act.inbound * 8 * STD.inbound * (0.95 + rnd() * 0.08), inDoneToday = 0;
    inPending.sort(function (x, y) { return (y.urgent ? 1 : 0) - (x.urgent ? 1 : 0) || x.arrive - y.arrive; });
    for (var ii = 0; ii < inPending.length && inCap > 0; ii++) {
      var ib2 = inPending[ii];
      var w3 = Math.min(inCap, ib2.recvQty - ib2.done);
      ib2.done += w3; inCap -= w3; inDoneToday += w3;
      if (ib2.done >= ib2.recvQty) {
        ib2.putaway = d;
        ib2.recv.forEach(function (l) { stock[l[0]] += l[1] - l[2]; });
        ib2.lines.forEach(function (l) { inTransit[l[0]] -= l[1]; });
      }
    }
    inPending = inPending.filter(function (x) { return x.putaway === null; });

    // 6) 반품 검수·분류 (도착 순)
    var retCap = Math.floor(act.ret * 8 * STD.ret * (0.95 + rnd() * 0.08)), retDoneToday = 0;
    retPending.sort(function (x, y) { return x.arrive - y.arrive; });
    for (var rj = 0; rj < retPending.length && retCap > 0; rj++) {
      var rt = retPending[rj];
      if (rt.arrive > d) continue;
      rt.done = d; retCap--; retDoneToday++;
      rt.grade = rt.reason === '상품 불량' ? '불량 · 화주사 반송' : (rnd() < 0.88 || rt.reason === '오출고 회수') ? 'A급 재입고' : 'B급 · 별도 보관';
      if (rt.grade === 'A급 재입고') stock[rt.sku] += 1;
      if (rt.reason === '사이즈 교환' && !isEnd) {   // 교환 출고 주문 생성
        var s0 = SKUS[rt.sku], sib = BRAND_SKUS[s0.brand].filter(function (x) { return x.style === s0.style && x.color === s0.color && x.idx !== s0.idx; });
        var ns2 = sib.length ? sib[ri(0, sib.length - 1)] : s0;
        rt.exOrder = newOrder(s0.brand, d, 17 * 60, [[ns2.idx, 1]], true).id;
      }
    }
    retPending = retPending.filter(function (x) { return x.done === null; });

    // 7) 반품 발생(오늘 출고분 → 며칠 뒤 도착)
    shipByDay[d].forEach(function (o) {
      if (o.ex) return;
      var b = BRANDS[BI[o.brand]];
      var rate = b.retRate * (o.brand === 'B' && inR(o.day, SC.seasonOffB) ? 3 : 1);
      var reason = null;
      if (o.mis) reason = '오출고 회수';
      else if (rnd() < rate) reason = rnd() < b.exShare ? '사이즈 교환' : rnd() < 0.85 ? '단순 변심' : '상품 불량';
      if (!reason) return;
      var arr = bizOnOrAfter(d + ri(3, 8));
      if (arr > END) return;
      var r = { id: 'R' + (++rSeq), brand: o.brand, order: o.id, sku: o.lines[0][0], reason: reason, arrive: arr, done: null, grade: null, exOrder: null };
      returns.push(r); retPending.push(r);
    });

    // 8) 일별 인력·작업 기록
    var reqB2c = queue.length / STD.b2c;
    labor.push({
      day: d, plan: plan, act: act, absent: absent, temps: tempsPlanned - tempsCancel, tempsPlanned: tempsPlanned, otH: Math.round(otH * 10) / 10, prod: prod,
      vol: { b2c: k2, b2cLines: linesToday, b2cQueue: queue.length, b2cBlocked: blockedToday, b2b: Math.round(b2bDoneToday), inbound: Math.round(inDoneToday), ret: retDoneToday, b2cCap: capTot },
      req: { b2c: reqB2c, b2b: b2bWork / STD.b2b, inbound: inWork / STD.inbound, ret: retPending.length / STD.ret + retDoneToday / STD.ret },
      hours: { b2c: act.b2c * (8 + otH), b2b: act.b2b * 8, inbound: act.inbound * 8, ret: act.ret * 8 }
    });
    stockDaily.push(brandStock());
    markZero(d);
  }

  function brandStock() {
    var o = { A: 0, B: 0, C: 0, D: 0 };
    SKUS.forEach(function (s) { o[s.brand] += stock[s.idx] + alloc[s.idx]; });
    return o;
  }
  function markZero(day) {
    SKUS.forEach(function (s) {
      if (stock[s.idx] <= 0) { skuZeroDays[s.idx].push(day); zeroRun[s.idx]++; } else zeroRun[s.idx] = 0;
    });
  }

  /* ---------------- 월말 재고 실사(로케이션 단위) ---------------- */
  MONTHS.forEach(function (m) {
    var r = monthRange(m), last = r[1];
    while (!isBiz(last) && last > r[0]) last--;
    if (last >= END) return;   // 9월은 월말 실사 전
    BRANDS.forEach(function (b) {
      var locs = BRAND_SKUS[b.id].length * LOC_PER_SKU;
      var lam = (b.id === 'B' && (m === '2026-08')) ? 4 : 0.6;
      var miss = 0;
      for (var i = 0; i < 6; i++) if (rnd() < lam / 6) miss++;
      var units = BRAND_SKUS[b.id].reduce(function (a, s) { return a + Math.max(0, stockDaily[last][b.id] / BRAND_SKUS[b.id].length); }, 0);
      var diffUnits = 0;
      for (var j = 0; j < miss; j++) diffUnits += ri(1, 6);
      cycle.push({ month: m, day: last, brand: b.id, locs: locs, matched: locs - miss, diffLocs: miss, units: Math.round(units), diffUnits: diffUnits,
        note: miss ? (b.id === 'B' && m === '2026-08' ? '반품 재입고 위치 혼재(같은 스타일 사이즈 섞임)' : '피킹 후 위치 오적치') : '' });
    });
  });

  /* ---------------- 청구서(가상) — 실적 기준 금액에 일부 오류를 넣음 ---------------- */
  function monthQty(b, m) {
    var r = monthRange(m), q = { inbound: 0, storagePalletDays: 0, b2cOrders: 0, b2cExtra: 0, b2b: 0, ret: 0 };
    inbound.forEach(function (x) { if (x.brand === b.id && x.putaway !== null && x.putaway >= r[0] && x.putaway <= r[1]) q.inbound += x.recvQty; });
    for (var dd = r[0]; dd <= r[1]; dd++) {
      q.storagePalletDays += stockDaily[dd][b.id] / b.palletPcs;
      shipByDay[dd].forEach(function (o) {
        if (o.brand !== b.id || o.ex) return;
        q.b2cOrders++;
        q.b2cExtra += o.lines.reduce(function (a, l) { return a + l[1]; }, 0) - 1;
      });
    }
    b2b.forEach(function (x) { if (x.brand === b.id && x.ship !== null && x.ship >= r[0] && x.ship <= r[1]) q.b2b += x.shipQty; });
    returns.forEach(function (x) { if (x.brand === b.id && x.done !== null && x.done >= r[0] && x.done <= r[1] && x.reason !== '오출고 회수') q.ret++; });
    q.storagePalletDays = Math.round(q.storagePalletDays);
    return q;
  }
  var BILL_ITEMS = [
    { key: 'inbound', label: '입고 검수·적치', unit: 'pcs', rate: 'inbound', qty: function (q) { return q.inbound; } },
    { key: 'storage', label: '보관', unit: '파렛트·월', rate: 'storage', qty: function (q) { return Math.round(q.storagePalletDays / 30 * 10) / 10; } },
    { key: 'b2c', label: 'B2C 출고 기본', unit: '건', rate: 'b2c', qty: function (q) { return q.b2cOrders; } },
    { key: 'extra', label: 'B2C 추가 pcs', unit: 'pcs', rate: 'extra', qty: function (q) { return q.b2cExtra; } },
    { key: 'pack', label: '부자재(박스·폴리백)', unit: '건', rate: 'pack', qty: function (q) { return q.b2cOrders; } },
    { key: 'b2b', label: 'B2B 출고', unit: 'pcs', rate: 'b2b', qty: function (q) { return q.b2b; } },
    { key: 'ret', label: '반품 검수·분류', unit: 'pcs', rate: 'ret', qty: function (q) { return q.ret; } }
  ];
  var invoices = [];
  var BILL_ERR = [
    { month: '2026-07', brand: 'C', item: 'b2b', kind: 'qty', delta: -1240, note: 'B2B 출고 1건(1,240pcs) 청구 누락 — 7월 말 출고분이 다음 달 집계로 넘어감' },
    { month: '2026-08', brand: 'B', item: 'ret', kind: 'qty', delta: 180, note: '반품 재검수 건 중복 집계(180pcs)' },
    { month: '2026-09', brand: 'A', item: 'extra', kind: 'rate', delta: 50, note: '기획전 기간 추가 pcs 단가 300원 적용(계약 단가 250원)' }
  ];
  MONTHS.forEach(function (m) {
    BRANDS.forEach(function (b) {
      var q = monthQty(b, m);
      BILL_ITEMS.forEach(function (it) {
        var qty = it.qty(q), rate = b.rates[it.rate], err = BILL_ERR.filter(function (e) { return e.month === m && e.brand === b.id && e.item === it.key; })[0];
        var bq = qty, br = rate;
        if (err && err.kind === 'qty') bq = qty + err.delta;
        if (err && err.kind === 'rate') br = rate + err.delta;
        invoices.push({ month: m, brand: b.id, item: it.key, qty: bq, rate: br, amount: Math.round(bq * br), note: err ? err.note : '', status: m === monthOf(END) ? '가집계(마감 전)' : '청구 완료' });
      });
    });
  });

  var data = {
    meta: {
      seed: SEED, END_DAY: END, DAYS: DAYS, NOW: NOW, startIso: isoOf(0), endIso: isoOf(END), nowLabel: isoOf(END) + ' 15:30',
      WORK_START: WORK_START, WORK_END: WORK_END, LAST_TRUCK: LAST_TRUCK, STD: STD, BASE_STAFF: BASE_STAFF, LOC_PER_SKU: LOC_PER_SKU,
      holidays: HOLI_ISO, scenarioDays: SC, center: '가상 패션 3PL 센터 (화주사 4곳)', checked: '2026-10-20'
    },
    cal: cal,
    brands: BRANDS, styles: STYLE_LIST, skus: SKUS, skuById: SKU_BY_ID,
    orders: orders, ordersByDay: ordersByDay, shipByDay: shipByDay,
    b2b: b2b, inbound: inbound, returns: returns, labor: labor, cycle: cycle,
    stock: stock, alloc: alloc, startStock: startStock, stockDaily: stockDaily, skuZeroDays: skuZeroDays,
    billItems: BILL_ITEMS, billErrors: BILL_ERR, invoices: invoices, monthQty: monthQty,
    scenarios: SCENARIOS, inRange: inR
  };
  global.SCM_DATA = data;
})(typeof window !== 'undefined' ? window : globalThis);
