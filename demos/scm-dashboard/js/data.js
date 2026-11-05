/* =====================================================================
 * js/data.js — 다품종 3PL 가상 센터 데이터 생성 (개인 학습 프로젝트 · SAMPLE DATA)
 * ---------------------------------------------------------------------
 * - 가상 물류센터 1곳이 5개 상품군의 가상 화주사 5곳을 운영하는 시뮬레이션입니다.
 *   상품명·코드·로케이션·로트·주문량·단가·인력은 모두 가상이며 실제 기업·브랜드와 관련이 없습니다.
 * - 상품군마다 다른 것: 입고 검수 항목, 보관 조건, 출고 배정 규칙(FEFO/FIFO), 세트 구성, 반품 판정.
 * - 공통 구조: 상품군, 화주사, 주문번호, SKU, 주문·출고 수량, 로트, 로케이션, 채널, 상태.
 * - 하루씩: 입고·검수 → 주간 실사 → 주문 접수·검증 → 피킹리스트·송장 → 검수·포장(인력 안에서)
 *   → 출고 확정·재고 반영 → 배송 → 이슈·반품 → 재고 발주 순서로 계산합니다.
 * - 재고는 로트마다 실물(판매 가능·격리)과 전산을 따로 기록하고, 둘이 어긋나는 사건은 gaps에 남깁니다.
 * - 기간: 2026-05-01 ~ 2026-10-28 (기준일 10-28 마감)
 * ===================================================================== */
(function (global) {
  'use strict';

  var SEED = 20261030;
  function mulberry32(a) {
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  var rnd = mulberry32(SEED);
  function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }
  function pickW(list, wf) { var tot = 0, i; for (i = 0; i < list.length; i++) tot += wf(list[i]); var r = rnd() * tot; for (i = 0; i < list.length; i++) { r -= wf(list[i]); if (r <= 0) return list[i]; } return list[list.length - 1]; }

  /* ---------------- 달력 ---------------- */
  var T0 = Date.UTC(2026, 4, 1), DAYS = 181, END = DAYS - 1;
  var DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
  function isoOf(d) { return new Date(T0 + d * 864e5).toISOString().slice(0, 10); }
  function dayOf(iso) { var p = iso.split('-'); return Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - T0) / 864e5); }
  function dowOf(d) { return new Date(T0 + d * 864e5).getUTCDay(); }
  var HOLI_ISO = ['2026-05-05', '2026-05-25', '2026-06-03', '2026-08-17', '2026-09-24', '2026-09-25', '2026-10-05', '2026-10-09'];
  var HOLI = {}; HOLI_ISO.forEach(function (s) { HOLI[dayOf(s)] = true; });
  function isBiz(d) { var w = dowOf(d); return w >= 1 && w <= 5 && !HOLI[d]; }
  function nextBiz(d) { do { d++; } while (!isBiz(d)); return d; }
  function bizOnOrAfter(d) { while (!isBiz(d)) d++; return d; }
  function addBiz(d, n) { for (var i = 0; i < n; i++) d = nextBiz(d); return d; }
  function monthOf(d) { return isoOf(d).slice(0, 7); }
  var MONTHS = []; for (var md = 0; md < DAYS; md++) if (MONTHS.indexOf(monthOf(md)) < 0) MONTHS.push(monthOf(md));
  function monthRange(m) { var s = dayOf(m + '-01'), e = s; while (e + 1 < DAYS && monthOf(e + 1) === m) e++; return [s, e]; }
  function lastBizOfMonth(d) { var e = monthRange(monthOf(d))[1]; while (!isBiz(e)) e--; return e; }
  function inR(d, a, b) { return d >= a && d <= b; }
  var cal = { isoOf: isoOf, dayOf: dayOf, dowOf: dowOf, DOW_KO: DOW_KO, isBiz: isBiz, nextBiz: nextBiz, bizOnOrAfter: bizOnOrAfter, addBiz: addBiz, monthOf: monthOf, months: MONTHS, monthRange: monthRange };

  /* ---------------- 운영 가정 (학습용, 특정 회사의 기준이 아님) ---------------- */
  var CUTOFF = 13 * 60, MIN_REMAIN = 60, ORDER_DAYS = 30, HOURS = 7.5;
  var STD_DATE = dayOf('2026-07-01');   // 코드 매핑표 정비 · 파손 즉시 등록 · 피킹 동선 재배치 (가상 개선)
  var UPH = { recv: 180, put: 90, pick: 42, pack: 19, ship: 70, ret: 9 };   // 공정별 표준 시간당 처리량 (가정)
  var PROC = [{ key: 'recv', label: '입고·검수', unit: '개' }, { key: 'put', label: '적치', unit: '개' }, { key: 'pick', label: '피킹', unit: '라인' }, { key: 'pack', label: '패킹', unit: '건' }, { key: 'ship', label: '출고·상차', unit: '건' }, { key: 'ret', label: '반품 처리', unit: '건' }];
  var PLAN = { recv: 2, put: 1, pick: 3, pack: 2, ship: 1, ret: 1 };

  var IND = [
    { id: 'BEA', name: '화장품·뷰티', client: '화주 A (뷰티, 가상)', daily: 66, palletPcs: 240, retRate: 0.008, ngRate: 0.006, leadBiz: 7, hasExpiry: true, pickRule: 'FEFO(사용기한)', storage: '상온', qc: ['라벨·옵션 표기', '로트 표기', '누액·파손'], packNote: '세트 구성·누액 방지 포장', retGrades: ['재판매 가능', '폐기'], real: '시뮬레이션' },
    { id: 'FOD', name: '식품', client: '화주 B (수입 식품, 가상)', daily: 58, palletPcs: 160, retRate: 0.003, ngRate: 0.004, leadBiz: 12, hasExpiry: true, pickRule: 'FEFO(소비기한)', storage: '상온·냉장', qc: ['소비기한', '한글 표시사항 라벨', '포장 상태'], packNote: '유리병 완충 · 냉장 상품 분리', retGrades: ['폐기'], real: '수입식품 통관·출고 데이터 경력(젠미코리아)과 연결, 물류센터 운영은 시뮬레이션' },
    { id: 'FSH', name: '패션·의류', client: '화주 C (의류, 가상)', daily: 54, palletPcs: 120, retRate: 0.05, ngRate: 0.008, leadBiz: 7, hasExpiry: false, pickRule: 'FIFO(입고 순)', storage: '상온 · 시즌별 존', qc: ['색상·사이즈', '수량', '오염·봉제'], packNote: '폴리백 · 옵션 재확인', retGrades: ['재판매 가능', '수선 필요', '폐기'], real: '시뮬레이션' },
    { id: 'HOM', name: '생활용품·소형가전', client: '화주 D (생활·가전, 가상)', daily: 42, palletPcs: 40, retRate: 0.015, ngRate: 0.005, leadBiz: 7, hasExpiry: false, pickRule: 'FIFO(입고 순)', storage: '상온 · 대형/소형 구분', qc: ['모델명', '외관 파손', '구성품'], packNote: '파손 주의 · 다품종 합포', retGrades: ['재판매 가능', '불량 격리'], real: '다품종 소형가전 3PL 센터 경력(제이아이로지스)과 연결' },
    { id: 'GFT', name: '주얼리·선물상품', client: '화주 E (선물, 가상)', daily: 24, palletPcs: 400, retRate: 0.02, ngRate: 0.007, leadBiz: 7, hasExpiry: false, pickRule: 'FIFO(입고 순)', storage: '상온 · 고가품 구역', qc: ['옵션', '구성품', '외관'], packNote: '선물 포장 · 출고 전 최종 검수', retGrades: ['재판매 가능', '재포장 필요'], real: '시뮬레이션' }
  ];
  var INDI = {}; IND.forEach(function (x, i) { x.idx = i; INDI[x.id] = x; });
  var CH = [{ id: 'OWN', name: '자사몰 (가정)', share: 0.3, pre: 'M' }, { id: 'OMA', name: '오픈마켓 A (가정)', share: 0.42, pre: 'A' }, { id: 'OMB', name: '오픈마켓 B (가정)', share: 0.24, pre: 'B' }, { id: 'B2B', name: 'B2B 납품 (가정)', share: 0.04, pre: 'K' }];
  var CHI = {}; CH.forEach(function (c) { CHI[c.id] = c; });
  var ZONES = [{ id: 'A', name: 'A존 뷰티', ind: 'BEA', cap: 15000 }, { id: 'B', name: 'B존 식품 상온', ind: 'FOD', cap: 11000 }, { id: 'F', name: 'F존 식품 냉장', ind: 'FOD', cap: 2800 }, { id: 'C', name: 'C존 의류', ind: 'FSH', cap: 11000 }, { id: 'D', name: 'D존 생활·가전', ind: 'HOM', cap: 7000 }, { id: 'E', name: 'E존 선물·고가', ind: 'GFT', cap: 7500 }];
  var RATES = { store: 25000, inbound: 60, base: 1100, extra: 250, kit: 800, pack: 450, ret: 2500, parcel: 3100 };
  var BILL_ITEMS = [{ key: 'store', label: '보관료', unit: '파렛트·월' }, { key: 'inbound', label: '입고료', unit: '개' }, { key: 'base', label: '출고 기본료', unit: '건' }, { key: 'extra', label: '합포 추가', unit: '개' }, { key: 'kit', label: '세트 조립', unit: '세트' }, { key: 'pack', label: '부자재', unit: '건' }, { key: 'ret', label: '반품 처리', unit: '건' }, { key: 'parcel', label: '택배비', unit: '건' }];
  var SC = {
    promo: { BEA: [dayOf('2026-06-15'), dayOf('2026-06-19'), 2.4], FSH: [dayOf('2026-08-24'), dayOf('2026-08-28'), 2.1], FOD: [dayOf('2026-09-07'), dayOf('2026-09-11'), 2.2], HOM: [dayOf('2026-06-29'), dayOf('2026-07-03'), 1.9], GFT: [dayOf('2026-05-04'), dayOf('2026-05-07'), 2.6] },
    delay: { item: 'FOD-JAM', from: dayOf('2026-07-10'), to: dayOf('2026-08-20'), biz: 7 },
    sysLate: { d: dayOf('2026-08-19'), n: 25 },
    retDup: [dayOf('2026-06-16'), dayOf('2026-09-22')],
    misWeek: [dayOf('2026-08-10'), dayOf('2026-08-13')],
    bill: { cancel: ['2026-07', 'BEA'], reship: ['2026-08', 'HOM'], kit: ['2026-09', 'GFT', 1000], store: ['2026-10', 'FOD', 6], ret: ['2026-06', 'FSH', 3000] }
  };

  /* ---------------- 상품 (모두 가상) ---------------- */
  var ITEMS = [], IT = {};
  function add(id, ind, name, o) { o = o || {}; var x = { id: id, ind: ind, name: name, w: o.w === undefined ? 1 : o.w, life: o.life || 0, fragile: !!o.fragile, cold: !!o.cold, zone: o.zone, color: o.color || null, size: o.size || null, season: o.season || null, style: o.style || null, model: o.model || null, serial: !!o.serial, option: o.option || null, bom: o.bom || null, comp: !!o.comp, price: o.price || 10000, lots: [] }; x.idx = ITEMS.length; ITEMS.push(x); IT[id] = x; }
  add('BEA-CRM', 'BEA', '수분 크림 50ml', { w: 1.3, life: 720, zone: 'A', price: 32000 });
  add('BEA-TNR', 'BEA', '약산성 토너 200ml', { w: 1.1, life: 720, zone: 'A', fragile: true, price: 24000 });
  add('BEA-SRM', 'BEA', '비타민 세럼 30ml', { w: 0.9, life: 540, zone: 'A', fragile: true, price: 38000 });
  add('BEA-CSH', 'BEA', '쿠션 파운데이션 15g', { w: 0.7, life: 540, zone: 'A', price: 29000 });
  add('BEA-MSK', 'BEA', '시트 마스크 10매', { w: 1.2, life: 720, zone: 'A', price: 18000 });
  add('BEA-SUN', 'BEA', '선크림 50ml', { w: 0.8, life: 540, zone: 'A', price: 22000 });
  add('BEA-SET1', 'BEA', '스킨케어 기획 세트', { w: 0.7, bom: [['BEA-CRM', 1], ['BEA-TNR', 1]], zone: 'A', price: 49000 });
  add('BEA-SET2', 'BEA', '세럼·마스크 세트', { w: 0.5, bom: [['BEA-SRM', 1], ['BEA-MSK', 1]], zone: 'A', price: 49000 });
  add('FOD-SNK', 'FOD', '수입 감자칩 150g', { w: 1.3, life: 270, zone: 'B', price: 4500 });
  add('FOD-CND', 'FOD', '커피 캔디 100g', { w: 1.2, life: 540, zone: 'B', price: 3800 });
  add('FOD-JAM', 'FOD', '유리병 과일잼 300g', { w: 0.8, life: 420, zone: 'B', fragile: true, price: 7800 });
  add('FOD-SOY', 'FOD', '조림 간장 500ml', { w: 0.6, life: 540, zone: 'B', fragile: true, price: 6900 });
  add('FOD-NDL', 'FOD', '건면 400g', { w: 0.7, life: 360, zone: 'B', price: 5200 });
  add('FOD-CHO', 'FOD', '초콜릿 바 100g', { w: 0.9, life: 300, zone: 'F', cold: true, price: 5500 });
  add('FOD-BTR', 'FOD', '가공 버터 200g', { w: 0.5, life: 180, zone: 'F', cold: true, price: 8900 });
  [['TEE', '코튼 티셔츠', 'SS', 1.2], ['LIN', '린넨 셔츠', 'SS', 0.8], ['KNT', '니트 가디건', 'FW', 1.0]].forEach(function (st) {
    [['WH', '화이트'], ['BK', '블랙']].forEach(function (c) {
      [['S', 0.8], ['M', 1.3], ['L', 0.9]].forEach(function (sz) {
        add('FSH-' + st[0] + '-' + c[0] + '-' + sz[0], 'FSH', st[1] + ' ' + c[1] + ' ' + sz[0], { w: st[3] * sz[1] / 2, zone: 'C', color: c[1], size: sz[0], season: st[2], style: st[1], price: st[0] === 'KNT' ? 59000 : 29000 });
      });
    });
  });
  add('HOM-KTL', 'HOM', '전기 포트 1.7L', { w: 1.1, zone: 'D', fragile: true, model: 'KT-170', serial: true, price: 39000 });
  add('HOM-FAN', 'HOM', '서큘레이터 9인치', { w: 0.9, zone: 'D', model: 'CF-09', serial: true, price: 59000 });
  add('HOM-HDR', 'HOM', '헤어드라이어', { w: 1.0, zone: 'D', model: 'HD-12', serial: true, price: 45000 });
  add('HOM-BLD', 'HOM', '미니 블렌더', { w: 0.7, zone: 'D', fragile: true, model: 'BL-05', serial: true, price: 42000 });
  add('HOM-BOX', 'HOM', '수납 박스 3입', { w: 1.3, zone: 'D', price: 19000 });
  add('HOM-MAT', 'HOM', '욕실 매트', { w: 1.1, zone: 'D', price: 15000 });
  add('HOM-TWL', 'HOM', '호텔 수건 5입', { w: 1.2, zone: 'D', price: 25000 });
  add('GFT-NK45', 'GFT', '실버 목걸이 45cm', { w: 0.8, zone: 'E', option: '길이 45cm', price: 69000 });
  add('GFT-NK42', 'GFT', '실버 목걸이 42cm', { w: 0.6, zone: 'E', option: '길이 42cm', price: 69000 });
  add('GFT-RG11', 'GFT', '실버 반지 11호', { w: 0.6, zone: 'E', option: '11호', price: 59000 });
  add('GFT-RG13', 'GFT', '실버 반지 13호', { w: 0.5, zone: 'E', option: '13호', price: 59000 });
  add('GFT-EAR', 'GFT', '드롭 귀걸이', { w: 0.7, zone: 'E', price: 49000 });
  add('GFT-BOX', 'GFT', '선물 상자', { w: 0, comp: true, zone: 'E', price: 2000 });
  add('GFT-CRD', 'GFT', '메시지 카드', { w: 0, comp: true, zone: 'E', price: 500 });
  add('GFT-SET1', 'GFT', '목걸이 선물 세트', { w: 0.9, bom: [['GFT-NK45', 1], ['GFT-BOX', 1], ['GFT-CRD', 1]], zone: 'E', price: 79000 });
  add('GFT-SET2', 'GFT', '반지 선물 세트', { w: 0.6, bom: [['GFT-RG11', 1], ['GFT-BOX', 1], ['GFT-CRD', 1]], zone: 'E', price: 69000 });
  function byInd(ind) { return ITEMS.filter(function (x) { return x.ind === ind; }); }
  function stockable(x) { return !x.bom; }
  function explode(lines) { var n = {}; lines.forEach(function (l) { var it = IT[l[0]]; (it.bom || [[l[0], 1]]).forEach(function (b) { n[b[0]] = (n[b[0]] || 0) + b[1] * l[1]; }); }); return n; }
  function unitsOf(lines) { return lines.reduce(function (a, l) { return a + l[1]; }, 0); }
  function seasonFac(x, d) { if (x.season === 'SS') return d < dayOf('2026-09-01') ? 1.1 : 0.2; if (x.season === 'FW') return d < dayOf('2026-08-01') ? 0.1 : 1.3; return 1; }

  // 일평균 수요 추정 (세트는 구성품으로 환산)
  var EST = {};
  IND.forEach(function (ind) {
    var list = byInd(ind.id).filter(function (x) { return x.w > 0; }), ws = list.reduce(function (a, x) { return a + x.w; }, 0);
    list.forEach(function (x) { var q = ind.daily * 1.5 * 1.3 * x.w / ws; (x.bom || [[x.id, 1]]).forEach(function (b) { EST[b[0]] = (EST[b[0]] || 0) + q * b[1]; }); });
  });

  /* ---------------- 로트 · 재고 ---------------- */
  var lots = [], LOT = {}, lotSeq = {}, gaps = [], moves = [], damages = [], adjustments = [], counts = [], pos = [], retLog = [], receipts = [];
  function newLot(item, d, remain, qty, holdUntil, rc) {
    var it = IT[item]; lotSeq[item] = (lotSeq[item] || 0) + 1;
    var n = lotSeq[item], slot = String(it.idx % 90 + 10);
    var l = { id: item + '-L' + ('0' + n).slice(-2), item: item, ind: it.ind, inDay: d, exp: remain === null ? null : d + remain, loc: it.zone + '-' + slot + '-' + (((n - 1) % 4) + 1), inQty: qty, good: qty, res: 0, dmg: 0, sysGood: qty, sysDmg: 0, holdUntil: holdUntil, rc: rc || null };
    lots.push(l); LOT[l.id] = l; it.lots.push(l); return l;
  }
  function allocatable(l, d) { return d >= l.holdUntil && (l.exp === null || l.exp - d >= MIN_REMAIN) && l.good - l.res > 0; }
  function cmp(a, b) { if (a.exp !== null && b.exp !== null && a.exp !== b.exp) return a.exp - b.exp; return a.inDay - b.inDay; }
  function sellLots(item, d) { return IT[item].lots.filter(function (l) { return allocatable(l, d); }).sort(cmp); }
  function avail(item, d) { return sellLots(item, d).reduce(function (a, l) { return a + l.good - l.res; }, 0); }
  function gap(d, item, lot, q, cause, ref) { gaps.push({ d: d, item: item, ind: IT[item].ind, lot: lot, q: q, cause: cause, ref: ref || '' }); }
  var moveAgg = {};
  function move(d, type, item, lot, qty, ref) {
    if (type === '출고 확정') { var k = d + '|' + lot; if (moveAgg[k]) { moveAgg[k].qty += qty; moveAgg[k].n++; return; } var m = { d: d, type: type, item: item, ind: IT[item].ind, lot: lot, qty: qty, n: 1, ref: '' }; moveAgg[k] = m; moves.push(m); return; }
    moves.push({ d: d, type: type, item: item, ind: IT[item].ind, lot: lot, qty: qty, n: 1, ref: ref || '' });
  }
  ITEMS.filter(stockable).forEach(function (x) {
    var dd = EST[x.id] || 2, ind = INDI[x.ind], r = function (a, b) { return ind.hasExpiry ? Math.max(100, Math.round(x.life * (a + rnd() * b))) : null; };
    newLot(x.id, 0, r(0.22, 0.1), Math.max(30, Math.round(dd * 10 / 10) * 10), 0);
    newLot(x.id, 0, r(0.65, 0.15), Math.max(60, Math.round(dd * (INDI[x.ind].leadBiz > 8 ? 30 : 22) / 10) * 10), 0);
  });
  var poSeq = 0, rcSeq = 0;
  // 시나리오: 잔여 소비기한이 짧은 입고분 — 판매 속도보다 많아 기준일에 출고 제한 재고로 남음
  function newPO(d, item, qty, eta, note, remain) {
    var it = IT[item], p = { id: 'PO' + (++poSeq), d: d, item: item, ind: it.ind, qty: qty, eta: eta, plan: eta, arrive: null, lot: null, note: note || '', remain: remain || null, delayed: false };
    if (it.ind === 'FOD') { var gapD = Math.max(2, Math.round((eta - d) / 5)); p.stages = { 선적: d + gapD, 입항: d + gapD * 2, 통관: d + gapD * 3, 보세반출: d + gapD * 4 }; }
    pos.push(p); return p;
  }
  newPO(dayOf('2026-08-03'), 'FOD-SOY', 1500, dayOf('2026-08-24'), '잔여 소비기한이 짧은 수입분 (가정)', 110);

  /* ---------------- 주문 ---------------- */
  var orders = [], OD = {}, ordersByDay = [], dups = [], changes = [], invoices = [], INV = {}, issues = [], dailyOps = [], labor = [], stockDaily = [];
  var delivByDay = [], unitsDay = [];
  for (var z = 0; z < DAYS; z++) { ordersByDay.push([]); delivByDay.push([]); unitsDay.push(ITEMS.map(function () { return 0; })); }
  var oSeq = 0, invSeq = 0, issSeq = 0, retSeq = 0;
  function genLines(ind, d, ch) {
    var list = byInd(ind).filter(function (x) { return x.w > 0; }), n = ch === 'B2B' ? 1 : rnd() < 0.62 ? 1 : rnd() < 0.75 ? 2 : 3, lines = [], used = {};
    n = Math.min(n, list.length);
    while (lines.length < n) { var it = pickW(list, function (x) { return x.w * seasonFac(x, d); }); if (used[it.id]) continue; used[it.id] = 1; lines.push([it.id, ch === 'B2B' ? ri(12, 40) : rnd() < 0.78 ? 1 : rnd() < 0.7 ? 2 : 3]); }
    return lines;
  }
  function newOrder(o) {
    o.id = 'OD' + (++oSeq); OD[o.id] = o;
    o.cancel = null; o.cancelStage = null; o.waved = null; o.inv = null; o.invDay = null; o.short = 0; o.packed = null; o.ship = null; o.deliver = null;
    o.picks = null; o.need = explode(o.lines); o.inspect = null; o.mispick = false; o.tdmg = false; o.sysLate = false; o.ret = null; o.optBlock = false;
    orders.push(o); ordersByDay[o.day].push(o); return o;
  }
  function eligibleWave(day, t) { return isBiz(day) && t >= CUTOFF ? nextBiz(day) : bizOnOrAfter(day); }
  var pending = [], packQueue = [], returnsDue = [], lastCount = -1, misLeft = 4;

  for (var d = 0; d < DAYS; d++) {
    var biz = isBiz(d), recvUnits = 0, putUnits = 0, retHandled = 0;
    // 1) 입고: 도착 → 검수(상품군별 항목) → 다음 영업일 적치. 식품은 라벨 확인으로 1영업일 더 보류
    if (biz) pos.forEach(function (p) {
      if (p.arrive !== null || p.eta !== d) return;
      var it = IT[p.item], ind = INDI[it.ind], recv = p.qty - (rnd() < 0.08 ? Math.round(p.qty * 0.02 / 10) * 10 : 0);
      var ng = Math.round(recv * ind.ngRate * (0.5 + rnd())), ok = recv - ng, put = nextBiz(d), hold = ind.id === 'FOD' ? addBiz(d, 2) : put;
      var ngIdx = ri(0, ind.qc.length - 1), ngBy = ind.qc.map(function (q, i) { return i === ngIdx ? ng : 0; });
      var remain = ind.hasExpiry ? (p.remain || Math.round(it.life * (0.62 + rnd() * 0.2))) : null;
      var rc = { id: 'RC' + (++rcSeq), po: p.id, item: p.item, ind: it.ind, plan: p.qty, recv: recv, ok: ok, ng: ng, ngBy: ngBy, arrive: d, put: put, hold: hold, lot: null };
      var l = newLot(p.item, d, remain, ok, hold, rc.id); rc.lot = l.id; receipts.push(rc);
      p.arrive = d; p.lot = l.id; recvUnits += recv; move(d, '입고', p.item, l.id, ok, p.id);
    });
    if (biz) receipts.forEach(function (rc) { if (rc.put === d) putUnits += rc.ok; });
    // 2) 주간 실사(월요일 출고 전): 판매 가능·격리 실물 vs 전산 → 원인 기록 후 전산을 실물에 맞춤
    if (biz && dowOf(d) === 1) {
      var rows = ITEMS.filter(stockable).map(function (x) {
        var sys = 0, phys = 0, dSys = 0, dPhys = 0;
        x.lots.forEach(function (l) { sys += l.sysGood; phys += l.good; dSys += l.sysDmg; dPhys += l.dmg; });
        return { item: x.id, ind: x.ind, sys: sys, phys: phys, dmgSys: dSys, dmgPhys: dPhys };
      });
      counts.push({ d: d, prev: lastCount, rows: rows });
      lots.forEach(function (l) {
        if (l.good !== l.sysGood) adjustments.push({ d: d, item: l.item, ind: l.ind, lot: l.id, level: '판매 가능', qty: l.good - l.sysGood });
        if (l.dmg !== l.sysDmg) adjustments.push({ d: d, item: l.item, ind: l.ind, lot: l.id, level: '격리', qty: l.dmg - l.sysDmg });
        if (l.good !== l.sysGood || l.dmg !== l.sysDmg) move(d, '실사 조정', l.item, l.id, l.good - l.sysGood, '');
        l.sysGood = l.good; l.sysDmg = l.dmg;
      });
      lastCount = d;
    }
    // 3) 주문 접수 (주말 주문은 다음 영업일 처리)
    IND.forEach(function (ind) {
      var pm = SC.promo[ind.id], fac = (biz ? 1 : 0.7) * (inR(d, pm[0], pm[1]) ? pm[2] : 1) * (0.9 + rnd() * 0.2);
      var nOrd = Math.round(ind.daily * fac);
      for (var k = 0; k < nOrd; k++) {
        var ch = pickW(CH, function (c) { return c.share; }), t = ri(0, 1439), lines = genLines(ind.id, d, ch.id), before = d < STD_DATE;
        var mismatch = rnd() < (ch.id === 'OMB' ? (before ? 0.018 : 0.003) : ch.id === 'OMA' ? (before ? 0.005 : 0.001) : 0);
        var o = newOrder({ ind: ind.id, ch: ch.id, chNo: ch.pre + String(3000000 + oSeq * 7 + ri(0, 6)), day: d, t: t, lines: lines, kind: '주문', parent: null, mismatch: mismatch });
        o.elig = eligibleWave(d, t); o.due = o.elig;
        if (mismatch) o.elig = Math.max(o.elig, nextBiz(bizOnOrAfter(d)));
        if (rnd() < 0.008) dups.push({ d: d, t: Math.min(1439, t + ri(30, 300)), ind: ind.id, ch: ch.id, chNo: o.chNo, of: o.id });
        if (ch.id !== 'B2B' && rnd() < 0.005) { var ln = o.lines[0]; var to = ln[1] === 1 ? 2 : 1; changes.push({ d: d, order: o.id, ind: ind.id, item: ln[0], from: ln[1], to: to }); ln[1] = to; o.need = explode(o.lines); }
        var r = rnd();
        o.plan = r < 0.015 ? 'beforeWave' : r < 0.018 ? 'afterInvoice' : r < 0.024 ? 'afterShip' : r < 0.024 + ind.retRate ? 'return' : null;
        if (o.plan === 'beforeWave') { o.cancel = d; o.cancelStage = '피킹 전 취소'; continue; }
        o.lines.forEach(function (l) { unitsDay[d][IT[l[0]].idx] += l[1]; Object.keys(explode([l])).forEach(function (c) { if (c !== l[0]) unitsDay[d][IT[c].idx] += explode([l])[c]; }); });
        pending.push(o);
      }
    });
    var shippedToday = 0, wavedToday = 0, voidToday = 0, shortToday = 0, catchToday = 0, pickLines = 0;
    var lab = null;
    if (biz) {
      // 4) 피킹리스트 · 송장 등록: 검증 끝난 주문을 로트에 배정 (유통기한 상품 FEFO, 그 외 입고 순). 재고가 모자라면 대기
      pending.sort(function (a, b) { return a.elig - b.elig || a.day - b.day || a.t - b.t; });
      var still = [];
      pending.forEach(function (o) {
        if (o.elig > d) { still.push(o); return; }
        var ok = Object.keys(o.need).every(function (c) { return avail(c, d) >= o.need[c]; });
        if (!ok) { o.short++; shortToday++; still.push(o); return; }
        o.picks = [];
        Object.keys(o.need).forEach(function (c) {
          var need = o.need[c];
          sellLots(c, d).forEach(function (l) { if (!need) return; var q = Math.min(need, l.good - l.res); l.res += q; need -= q; o.picks.push({ item: c, lot: l.id, loc: l.loc, exp: l.exp, qty: q }); });
        });
        o.waved = d; o.inv = String(6100000000 + (++invSeq) * 13); o.invDay = d; wavedToday++;
        var iv = { no: o.inv, order: o.id, ind: o.ind, d: d, status: '발행', ship: null, voided: null };
        invoices.push(iv); INV[iv.no] = iv;
        if (o.plan === 'afterInvoice') {
          o.picks.forEach(function (p) { LOT[p.lot].res -= p.qty; });
          o.cancel = d; o.cancelStage = '송장 발행 후 취소'; iv.status = '취소'; iv.voided = d; voidToday++;
          return;
        }
        packQueue.push(o);
      });
      pending = still;
      // 5) 인력 계획: 전일 휴무면 패킹 2명 증원, 대기가 능력을 넘으면 임시 인력·연장 (가정)
      var plan = {}; Object.keys(PLAN).forEach(function (k) { plan[k] = PLAN[k]; });
      if (!isBiz(d - 1)) { plan.pack += 2; plan.pick += 1; }
      var act = {}; Object.keys(plan).forEach(function (k) { act[k] = plan[k]; });
      if (rnd() < 0.05) act.pack = Math.max(1, act.pack - 1);
      var base = act.pack * HOURS * UPH.pack, temps = packQueue.length > base ? Math.min(1, Math.ceil((packQueue.length - base) / (HOURS * UPH.pack))) : 0;
      var cap = Math.round((act.pack + temps) * HOURS * UPH.pack), otH = 0;
      if (packQueue.length > cap) { otH = Math.min(1, Math.ceil((packQueue.length - cap) / ((act.pack + temps) * UPH.pack))); cap += Math.round((act.pack + temps) * otH * UPH.pack); }
      // 6) 검수·포장 → 7) 출고 확정(택배 인계) → 8) 재고 반영
      packQueue.sort(function (a, b) { return a.waved - b.waved || a.elig - b.elig || a.day - b.day || a.t - b.t; });
      var lateLeft = d === SC.sysLate.d ? SC.sysLate.n : 0, nextQ = [];
      packQueue.forEach(function (o) {
        if (shippedToday >= cap) { nextQ.push(o); return; }
        var pe = rnd() < (o.kind === '재출고' ? 0.002 : 0.005), forced = o.ind === 'HOM' && o.kind === '주문' && inR(d, SC.misWeek[0], SC.misWeek[1]) && misLeft > 0;
        if (forced) { misLeft--; o.inspect = '이상 없음'; o.mispick = true; } else if (pe && rnd() < 0.92) { o.inspect = '오피킹 발견 → 재피킹'; catchToday++; } else { o.inspect = '이상 없음'; if (pe) o.mispick = true; }
        if (o.ind === 'GFT' && rnd() < 0.012) o.optBlock = true;   // 출고 전 최종 검수에서 옵션·구성품 불일치 발견 → 재작업
        o.packed = d; o.ship = d; shippedToday++; pickLines += o.picks.length;
        INV[o.inv].status = '출고 확정'; INV[o.inv].ship = d;
        var late = lateLeft > 0 && o.kind === '주문'; if (late) { lateLeft--; o.sysLate = true; }
        o.picks.forEach(function (p) {
          var l = LOT[p.lot]; l.res -= p.qty; l.good -= p.qty;
          if (late) gap(d, p.item, p.lot, -p.qty, '출고 확정 전산 누락', o.id); else { l.sysGood -= p.qty; move(d, '출고 확정', p.item, p.lot, -p.qty); }
        });
        if (o.mispick) {
          var pk = o.picks[0], lo = LOT[pk.lot], q = pk.qty;
          lo.good += q; gap(d, pk.item, pk.lot, q, '오출고(주문 상품 미출고)', o.id);
          var alt = byInd(o.ind).filter(function (x) { return stockable(x) && x.id !== pk.item && sellLots(x.id, d).some(function (l) { return l.good - l.res >= q; }); })[0];
          if (alt) { var al = sellLots(alt.id, d).filter(function (l) { return l.good - l.res >= q; })[0]; al.good -= q; gap(d, alt.id, al.id, -q, '오출고(다른 상품 출고)', o.id); o.mispickItem = alt.id; }
        }
        var pm = SC.promo[o.ind], dl = d + (rnd() < 0.86 ? 1 : rnd() < 0.95 ? 2 : 3) + (inR(d, pm[0], pm[1] + 3) && rnd() < 0.2 ? 1 : 0);
        o.deliver = dl <= END ? dl : null; if (o.deliver !== null) delivByDay[o.deliver].push(o);
        if (Object.keys(o.need).some(function (c) { return IT[c].fragile; }) && rnd() < 0.008) o.tdmg = true;
      });
      packQueue = nextQ;
      lab = { d: d, plan: plan, act: act, temps: temps, otH: otH, cap: cap };
    }
    // 9) 배송 후 이슈: 오출고·배송 중 파손은 원주문에 연결된 재출고, 배송 지연 기록, 반품 요청
    (d > 0 ? delivByDay[d - 1] : []).forEach(function (o) {
      if (o.kind !== '주문') return;
      var rep = d;
      if (o.deliver - o.ship > 2) issues.push({ id: 'IS' + (++issSeq), d: o.deliver, kind: '배송 지연', order: o.id, ind: o.ind, item: o.lines[0][0], qty: 0, act: '택배사 배송 추적 · 고객 안내 요청', reship: null });
      if (o.mispick || o.tdmg) {
        var lnk = o.mispick ? o.picks[0].item : Object.keys(o.need).filter(function (c) { return IT[c].fragile; })[0];
        var qty = o.mispick ? o.picks[0].qty : 1;
        var re = newOrder({ ind: o.ind, ch: o.ch, chNo: o.chNo + '-R', day: rep, t: 10 * 60, lines: [[lnk, qty]], kind: '재출고', parent: o.id, mismatch: false, fault: o.mispick ? '센터' : '택배사' });
        re.elig = bizOnOrAfter(rep); re.due = re.elig; re.plan = null; pending.push(re);
        issues.push({ id: 'IS' + (++issSeq), d: rep, kind: o.mispick ? '오출고' : '배송 중 파손', order: o.id, ind: o.ind, item: lnk, qty: qty, act: o.mispick ? '주문 상품 재출고 · 귀책 센터' : '같은 상품 재출고 · 택배사 파손 접수', reship: re.id });
      }
      if (o.plan === 'afterShip' || o.plan === 'return') {
        var rq = rep + ri(0, 2), arr = addBiz(bizOnOrAfter(rq), 3), p0 = o.picks[0];
        o.ret = { id: 'RT' + (++retSeq), ind: o.ind, req: rq, arrive: arr <= END ? arr : null, item: p0.item, lot: p0.lot, qty: p0.qty, reason: o.plan === 'afterShip' ? '출고 후 주문 취소' : o.ind === 'FSH' ? (rnd() < 0.6 ? '사이즈 교환·변심' : '색상 변심') : '단순 변심', grade: null, done: null };
        if (o.plan === 'afterShip') { o.cancel = rq; o.cancelStage = '출고 후 취소(반품)'; }
        issues.push({ id: 'IS' + (++issSeq), d: rq, kind: '반품', order: o.id, ind: o.ind, item: o.ret.item, qty: o.ret.qty, act: '회수 요청 · 입고 검수 후 재고 반영', reship: null, ret: o.ret.id });
        if (o.ret.arrive !== null) returnsDue.push(o);
      }
    });
    // 10) 반품 입고: 상품군별 판정 후 반품 번호당 한 번만 재고 반영
    if (biz) returnsDue.forEach(function (o) {
      var rt = o.ret; if (rt.arrive !== d) return;
      var gs = INDI[o.ind].retGrades, g = gs.length === 1 ? gs[0] : rnd() < 0.72 ? gs[0] : gs[gs.length > 2 && rnd() < 0.5 ? 1 : gs.length - 1];
      rt.grade = g; var l = LOT[rt.lot];
      if (g === '재판매 가능') { l.good += rt.qty; l.sysGood += rt.qty; } else { l.dmg += rt.qty; l.sysDmg += rt.qty; }
      rt.done = d; retHandled++; move(d, g === '재판매 가능' ? '반품 입고' : '반품 격리', rt.item, rt.lot, rt.qty, rt.id);
      retLog.push({ d: d, ret: rt.id, order: o.id, ind: o.ind, result: '재고 반영', qty: rt.qty });
      if (SC.retDup.indexOf(d) >= 0 && !retLog.some(function (x) { return x.result === '중복 등록 차단' && x.d === d; })) retLog.push({ d: d, ret: rt.id, order: o.id, ind: o.ind, result: '중복 등록 차단', qty: rt.qty });
    });
    if (biz) {
      // 11) 창고 내 파손: 7/1 이전에는 전산 등록이 자주 빠짐
      if (rnd() < 0.7) {
        var fr = ITEMS.filter(function (x) { return x.fragile; }), it0 = fr[ri(0, fr.length - 1)];
        var cand = it0.lots.filter(function (l) { return l.good - l.res >= 3; });
        if (cand.length) {
          var dl2 = cand[ri(0, cand.length - 1)], dq = ri(1, 2), reg = rnd() < (d < STD_DATE ? 0.65 : 0.97);
          dl2.good -= dq; dl2.dmg += dq;
          if (reg) { dl2.sysGood -= dq; dl2.sysDmg += dq; move(d, '파손 등록', it0.id, dl2.id, -dq, ''); } else gap(d, it0.id, dl2.id, -dq, '파손 전산 미등록', '');
          damages.push({ d: d, item: it0.id, ind: it0.ind, lot: dl2.id, qty: dq, registered: reg });
        }
      }
      // 12) 월말 격리 재고 폐기: 전산에 등록된 수량만
      if (d === lastBizOfMonth(d)) lots.forEach(function (l) { if (l.sysDmg > 0) { var x = Math.min(l.sysDmg, l.dmg); l.dmg -= x; l.sysDmg -= x; if (x) move(d, '격리 폐기', l.item, l.id, -x, ''); } });
      // 13) 재고 발주: (가용 + 입고 예정) < 최근 판매 속도 × 리드타임 기준 일수 → 30일분 요청
      ITEMS.filter(stockable).forEach(function (x) {
        var since = Math.max(0, d - 27), units = 0;
        for (var dd = since; dd <= d; dd++) units += unitsDay[dd][x.idx];
        var rate = d < 28 ? (EST[x.id] || 1) : units / (d - since + 1);
        var ropDays = INDI[x.ind].leadBiz * 1.4 + 9, base0 = Math.max(rate, x.season === 'FW' && d > dayOf('2026-07-10') ? (EST[x.id] || 1) : 0);
        if (x.season === 'SS' && d >= dayOf('2026-08-20')) return;   // 지난 시즌 추가 발주 없음
        var open = pos.filter(function (p) { return p.item === x.id && p.arrive === null && p.d <= d; }).reduce(function (a, p) { return a + p.qty; }, 0);
        if (avail(x.id, d) + open < base0 * ropDays) {
          var lead = INDI[x.ind].leadBiz, p = newPO(d, x.id, Math.max(50, Math.round(base0 * ORDER_DAYS / 10) * 10), addBiz(d, lead));
          if (x.id === SC.delay.item && inR(d, SC.delay.from, SC.delay.to) && !pos.some(function (q) { return q.delayed; })) { p.eta = addBiz(p.eta, SC.delay.biz); p.delayed = true; p.note = '통관 검사 지연 (가정)'; if (p.stages) p.stages.통관 += 10; }
        }
      });
      // 14) 인력 실적 기록
      var vol = { recv: recvUnits, put: putUnits, pick: pickLines, pack: shippedToday, ship: shippedToday, ret: retHandled }, hours = {};
      PROC.forEach(function (p) { var eff = (0.92 + rnd() * 0.14) * (p.key === 'pick' && d >= STD_DATE ? 1.06 : 1); hours[p.key] = vol[p.key] / (UPH[p.key] * eff); });
      lab.vol = vol; lab.hours = hours; labor.push(lab);
    }
    var sd = {}; IND.forEach(function (x) { sd[x.id] = 0; }); ITEMS.forEach(function (x) { x.lots.forEach(function (l) { sd[x.ind] += l.good; }); });
    stockDaily.push(sd);
    dailyOps.push({ d: d, waved: wavedToday, voided: voidToday, shipped: shippedToday, cap: lab ? lab.cap : 0, backlog: packQueue.length, waiting: pending.length, short: shortToday, caught: catchToday });
  }

  /* ---------------- 화주사별 월 정산 (실적 + 의도한 오류 초안) ---------------- */
  function monthActual(m, ind) {
    var r = monthRange(m), q = { store: 0, inbound: 0, base: 0, extra: 0, kit: 0, pack: 0, ret: 0, parcel: 0, voided: 0, fault: 0 };
    var pal = 0; for (var dd = r[0]; dd <= r[1]; dd++) pal += stockDaily[dd][ind] / INDI[ind].palletPcs;
    q.store = Math.round(pal / (r[1] - r[0] + 1));
    receipts.forEach(function (x) { if (x.ind === ind && inR(x.put, r[0], r[1])) q.inbound += x.ok; });
    orders.forEach(function (o) {
      if (o.ind !== ind) return;
      if (o.cancelStage === '송장 발행 후 취소' && inR(o.cancel, r[0], r[1])) q.voided++;
      if (o.ship === null || !inR(o.ship, r[0], r[1])) return;
      if (o.kind === '재출고' && o.fault === '센터') { q.fault++; return; }
      q.base++; q.pack++; q.parcel++;
      if (o.kind === '주문') q.extra += Math.max(0, unitsOf(o.lines) - 1);
      o.lines.forEach(function (l) { if (IT[l[0]].bom) q.kit += l[1]; });
    });
    orders.forEach(function (o) { if (o.ret && o.ind === ind && o.ret.done !== null && inR(o.ret.done, r[0], r[1])) q.ret++; });
    return q;
  }
  var statements = [];
  MONTHS.forEach(function (m) {
    IND.forEach(function (ind) {
      var q = monthActual(m, ind.id);
      BILL_ITEMS.forEach(function (it) {
        var qty = q[it.key], rate = RATES[it.key], B = SC.bill;
        if (m === B.cancel[0] && ind.id === B.cancel[1] && (it.key === 'base' || it.key === 'parcel' || it.key === 'pack')) qty += q.voided;
        if (m === B.reship[0] && ind.id === B.reship[1] && (it.key === 'base' || it.key === 'parcel' || it.key === 'pack')) qty += q.fault;
        if (m === B.kit[0] && ind.id === B.kit[1] && it.key === 'kit') rate = B.kit[2];
        if (m === B.ret[0] && ind.id === B.ret[1] && it.key === 'ret') rate = B.ret[2];
        if (m === B.store[0] && ind.id === B.store[1] && it.key === 'store') qty += B.store[2];
        statements.push({ month: m, ind: ind.id, item: it.key, qty: qty, rate: rate, amount: qty * rate, status: m === monthOf(END) ? '가집계 (마감 전)' : '마감 초안' });
      });
    });
  });

  var SCENARIOS = [
    { id: 'promo', title: '상품군별 행사 집중', from: SC.promo.GFT[0], to: SC.promo.FOD[1], setup: '화주사마다 다른 시기에 행사가 있습니다(5월 선물, 6월 뷰티, 7월 초 가전, 8월 말 의류, 9월 식품). 주문이 평소 2배 안팎으로 늘고 패킹 능력을 넘긴 주문은 송장 발행 후 다음 날 출고됩니다.' },
    { id: 'delay', title: '수입 입고 지연', from: SC.delay.from, to: SC.delay.to, setup: '식품 화주의 유리병 과일잼 발주분이 통관 검사 지연(가정)으로 7영업일 늦어져 해당 상품이 결품됩니다.' },
    { id: 'std', title: '코드 매핑·파손 등록·동선 재배치', from: STD_DATE, to: END, setup: '7/1부터 채널 코드 매핑표 정비, 파손 즉시 등록, 피킹 동선 재배치를 적용했다고 가정한 개선입니다.' },
    { id: 'sysLate', title: '출고 확정 전산 누락', from: SC.sysLate.d, to: SC.sysLate.d + 5, setup: '8/19 출고분 25건의 출고 확정이 전산에서 빠져 8/24 실사에서 전산 재고가 실물보다 많게 나옵니다.' },
    { id: 'short', title: '잔여 소비기한이 짧은 입고분', from: dayOf('2026-08-24'), to: END, setup: '8/24 입고된 조림 간장 1,500개(가정)의 잔여 소비기한이 110일로, 판매 속도보다 많아 출고 제한 재고로 남습니다.' },
    { id: 'season', title: '시즌 전환', from: dayOf('2026-08-01'), to: END, setup: '의류 화주의 SS 상품 판매가 9월부터 줄고 FW 상품이 늘면서 SS 재고가 장기 재고로 남습니다.' },
    { id: 'mis', title: '신규 작업자 오출고', from: SC.misWeek[0], to: SC.misWeek[1], setup: '8월 둘째 주 생활·가전 화주 출고에서 오출고 4건이 검수를 통과해 재출고됩니다(센터 귀책, 정산에서 제외 대상).' },
    { id: 'bill', title: '월 정산 초안 오류', from: dayOf('2026-06-01'), to: END, setup: '화주사별 월 정산 초안에 취소 송장, 센터 귀책 재출고, 단가 오적용, 보관 수량 과다를 일부러 넣었습니다.' }
  ];

  global.SCM_DATA = {
    meta: { seed: SEED, END_DAY: END, DAYS: DAYS, startIso: isoOf(0), endIso: isoOf(END), nowLabel: isoOf(END) + ' 마감', CUTOFF: CUTOFF, MIN_REMAIN: MIN_REMAIN, HOURS: HOURS, STD_DATE: STD_DATE, holidays: HOLI_ISO, sc: SC },
    cal: cal, inds: IND, INDI: INDI, items: ITEMS, IT: IT, channels: CH, CHI: CHI, zones: ZONES, rates: RATES, billItems: BILL_ITEMS, scenarios: SCENARIOS, proc: PROC, uph: UPH,
    orders: orders, OD: OD, ordersByDay: ordersByDay, dups: dups, changes: changes, invoices: invoices, INV: INV, issues: issues, dailyOps: dailyOps, labor: labor, stockDaily: stockDaily,
    lots: lots, LOT: LOT, gaps: gaps, moves: moves, damages: damages, adjustments: adjustments, counts: counts, pos: pos, receipts: receipts, retLog: retLog, statements: statements,
    monthActual: monthActual, explode: explode, unitsOf: unitsOf, seasonFac: seasonFac, stockable: stockable
  };
})(typeof window !== 'undefined' ? window : globalThis);
