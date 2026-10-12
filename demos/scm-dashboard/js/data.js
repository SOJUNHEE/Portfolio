/* =====================================================================
 * js/data.js — 가상 데이터 생성
 * ---------------------------------------------------------------------
 * (주)로로벨(ROROBELL) SCM 물류·재고 관리 직무 지원용 포트폴리오 데이터입니다.
 * - 실제 정보: 제품명·판매가·소비자가(로로벨 공식몰 rorobell.com, 2026-10-12 확인),
 *              판매·납품 채널과 도구(채용공고: 카페24·스마트스토어·사방넷, 쿠팡·컬리·올리브영 B2B, 수출)
 * - 가정·가상: 주문·발주·재고·매출·정산 등 모든 수치, 원가, 공급률, 유통기한, 센터·바이어 이름
 *   → 로로벨의 실제 주문·재고·매출 수치가 아닙니다.
 *
 * - 시드 고정 난수(mulberry32)를 사용하므로 새로고침해도 값이 같습니다.
 * - 기간: 2025-10-01 ~ 2026-09-30 (365일), 기준 시각: 2026-09-30 18:00
 * - 생성 순서: 달력 → 상품·채널·거래처 → B2C 주문 → 3PL 출고 큐
 *              → 재고 시뮬레이션(입고·B2C·B2B·세트 사전 포장, 로트 선입선출)
 *              → 시스템 불일치·실사 → 물류 이슈 → 3PL 정산
 * - 시간은 2025-10-01 00:00 기준 "경과 분(minute)" 정수로 저장합니다.
 * ===================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------
   * 1. 시드 고정 난수
   * ------------------------------------------------------------------ */
  var SEED = 20260930;
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rnd = mulberry32(SEED);
  function rand(a, b) { return a + (b - a) * rnd(); }
  function randInt(a, b) { return a + Math.floor((b - a + 1) * rnd()); }
  function chance(p) { return rnd() < p; }
  function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
  function pickW(items, weights) {
    var total = 0, i;
    for (i = 0; i < weights.length; i++) total += weights[i];
    var r = rnd() * total;
    for (i = 0; i < items.length; i++) { r -= weights[i]; if (r < 0) return items[i]; }
    return items[items.length - 1];
  }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }

  /* ------------------------------------------------------------------
   * 2. 달력 (영업일·공휴일)
   * ------------------------------------------------------------------ */
  var DAY0 = Date.UTC(2025, 9, 1);           // 2025-10-01
  var MS_DAY = 86400000;
  var END_DAY = 364;                          // 2026-09-30
  var HORIZON = END_DAY + 45;                 // 미래 입고·납품 예정 범위
  var NOW = END_DAY * 1440 + 18 * 60;         // 기준 시각 2026-09-30 18:00
  var CUTOFF = 14 * 60;                       // 3PL 출고 마감 14:00
  var CAPACITY = 600;                         // 3PL 일 처리 가능 건수
  var OVERTIME_CAPACITY = 900;                // 적체 시 연장 근무 처리 한도

  function dayOf(iso) {
    var p = iso.split('-');
    return Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - DAY0) / MS_DAY);
  }
  function isoOf(day) { return new Date(DAY0 + day * MS_DAY).toISOString().slice(0, 10); }
  function dowOf(day) { return new Date(DAY0 + day * MS_DAY).getUTCDay(); }
  function monthOf(day) { return isoOf(day).slice(0, 7); }

  var HOLIDAYS = [
    '2025-10-03', '2025-10-06', '2025-10-07', '2025-10-08', '2025-10-09', '2025-12-25',
    '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-02', '2026-05-05',
    '2026-05-25', '2026-06-03', '2026-08-17', '2026-09-24', '2026-09-25', '2026-10-05', '2026-10-09'
  ];
  var holidaySet = {};
  HOLIDAYS.forEach(function (h) { holidaySet[dayOf(h)] = true; });
  var BIZ = [];
  for (var bd = 0; bd <= HORIZON + 40; bd++) {
    var w = dowOf(bd);
    BIZ[bd] = w >= 1 && w <= 5 && !holidaySet[bd];
  }
  function nextBiz(d) { do { d++; } while (!BIZ[d]); return d; }
  function prevBiz(d) { do { d--; } while (d > 0 && !BIZ[d]); return d; }
  function addBiz(d, n) {
    while (n > 0) { d = nextBiz(d); n--; }
    while (n < 0) { d = prevBiz(d); n++; }
    return d;
  }
  function bizOnOrAfter(d) { return BIZ[d] ? d : nextBiz(d); }

  var PREPACK_DAY = dayOf('2026-07-15');      // 세트 사전 포장 도입일
  var LOCATION_SPLIT_DAY = dayOf('2026-05-01'); // 본품·미니 로케이션 분리일
  var COUNT_DAYS = ['2025-12-31', '2026-03-31', '2026-06-30', '2026-08-31'].map(dayOf); // 정기 실사일

  /* ------------------------------------------------------------------
   * 3. 상품 마스터 — 로로벨 공식몰 공개 제품 17종 + 세트 3종 = 20 SKU
   *    실제: 제품명, price(공식몰 판매가), list(소비자가)  — 2026-10-12 rorobell.com 확인
   *    가정: costR(원가율), shelfM(유통기한 개월), vol(포장 부피 지수), unitG(개당 출고 중량 g),
   *          b2c(B2C 판매 비중 가중치), vf(시스템 불일치 노출 가중치)
   *    lotTrace: 로트 추적·선유통기한 출고(FEFO) 관리 대상(치약·가글, 의약외품 가정)
   *    conf: 'WWTP' = 패키지가 비슷한 와와 치약 5종 (인접 로케이션 오출고 위험군)
   * ------------------------------------------------------------------ */
  var CATALOG = [
    { id: 'RB-WW-TP', name: '와와치약', category: '구강케어', list: 12500, price: 8800, costR: 0.27, shelfM: 36, vol: 0.5, unitG: 165, b2c: 3.4, vf: 1, lotTrace: true, conf: 'WWTP' },
    { id: 'RB-WW-GUM', name: '와와 잇몸 케어 치약', category: '구강케어', list: 13500, price: 9800, costR: 0.28, shelfM: 36, vol: 0.5, unitG: 165, b2c: 0.9, vf: 0.6, lotTrace: true, conf: 'WWTP' },
    { id: 'RB-WW-SNS', name: '와와 시린이 플러스 치약', category: '구강케어', list: 13500, price: 9800, costR: 0.28, shelfM: 36, vol: 0.5, unitG: 165, b2c: 0.65, vf: 0.5, lotTrace: true, conf: 'WWTP' },
    { id: 'RB-WW-WHT', name: '와와 미백 치약', category: '구강케어', list: 13500, price: 9800, costR: 0.28, shelfM: 36, vol: 0.5, unitG: 165, b2c: 0.85, vf: 0.6, lotTrace: true, conf: 'WWTP' },
    { id: 'RB-WW-KID', name: '와와 키즈 치약 (청포도향)', category: '구강케어', list: 12500, price: 8800, costR: 0.27, shelfM: 36, vol: 0.4, unitG: 95, b2c: 0.4, vf: 0.3, lotTrace: true, conf: 'WWTP' },
    { id: 'RB-WW-SPR', name: '와와 센스 스프레이', category: '구강케어', list: 12000, price: 7800, costR: 0.3, shelfM: 30, vol: 0.3, unitG: 45, b2c: 0.8, vf: 0.6 },
    { id: 'RB-WW-GRG', name: '와와 가글', category: '구강케어', list: 25500, price: 16800, costR: 0.26, shelfM: 30, vol: 1.1, unitG: 560, b2c: 0.55, vf: 0.5, lotTrace: true },
    { id: 'RB-WW-BRS', name: '와와칫솔(테트라모) 12개입', category: '구강케어', list: 54000, price: 31000, costR: 0.3, shelfM: 60, vol: 1.3, unitG: 260, b2c: 0.3, vf: 0.3 },
    { id: 'RB-WW-TCL', name: '와와 혀클리너', category: '구강케어', list: 5000, price: 2900, costR: 0.32, shelfM: 60, vol: 0.2, unitG: 30, b2c: 0.25, vf: 0.3 },
    { id: 'RB-SK-AMP', name: '퍼스트 에이드 앰플', category: '스킨케어', list: 85000, price: 65000, costR: 0.22, shelfM: 30, vol: 0.5, unitG: 180, b2c: 0.32, vf: 0.6 },
    { id: 'RB-SK-CRM', name: '워터 캐논 크림', category: '스킨케어', list: 58000, price: 48000, costR: 0.22, shelfM: 30, vol: 0.6, unitG: 220, b2c: 0.3, vf: 0.6 },
    { id: 'RB-SK-MST', name: '트윙클 미스트', category: '스킨케어', list: 38000, price: 29000, costR: 0.24, shelfM: 30, vol: 0.6, unitG: 190, b2c: 0.2, vf: 0.4, season: true },
    { id: 'RB-SK-CLN', name: '해바라기 클렌징 젤', category: '스킨케어', list: 35000, price: 28000, costR: 0.24, shelfM: 30, vol: 0.7, unitG: 250, b2c: 0.24, vf: 0.4 },
    { id: 'RB-SK-PAD', name: '산수유 토너 패드', category: '스킨케어', list: 25000, price: 25000, costR: 0.25, shelfM: 24, vol: 0.9, unitG: 280, b2c: 0.3, vf: 0.5 },
    { id: 'RB-SK-MSK', name: '김 마스크팩', category: '스킨케어', list: 20000, price: 20000, costR: 0.25, shelfM: 24, vol: 0.5, unitG: 160, b2c: 0.26, vf: 0.4 },
    { id: 'RB-SK-SRM', name: '백구슬 세럼', category: '스킨케어', list: 38000, price: 38000, costR: 0.23, shelfM: 30, vol: 0.5, unitG: 150, b2c: 0.17, vf: 0.3 },
    { id: 'RB-SK-BCR', name: '백도화지 크림', category: '스킨케어', list: 33000, price: 33000, costR: 0.23, shelfM: 30, vol: 0.6, unitG: 190, b2c: 0.13, vf: 0.3 }
  ];
  var skus = [];
  var skuById = {};
  CATALOG.forEach(function (c) {
    var s = {
      idx: skus.length, id: c.id, name: c.name,
      base: c.id.split('-')[2], spec: 'STD', specLabel: '단품', line: c.id.indexOf('RB-WW') === 0 ? '와와 구강케어' : '스킨케어',
      category: c.category, price: c.price, list: c.list,
      cost: Math.round(c.price * c.costR / 10) * 10,
      shelfLifeDays: Math.round(c.shelfM * 30.4),
      isSet: false, components: [], vol: c.vol, unitG: c.unitG,
      b2cWeight: c.b2c, vf: c.vf, lotTrace: !!c.lotTrace, conf: c.conf || null, season: !!c.season
    };
    skus.push(s); skuById[s.id] = s;
  });
  function sid(id) { return skuById[id].idx; }
  // 세트: 앰플 + 크림 SET 은 공식몰 실제 구성, 나머지 2종은 라이브·공동구매용 기획 구성(가정)
  var SETS = [
    { id: 'RB-SET-AC', name: '앰플 + 크림 SET', price: 111000, list: 143000, comps: [['RB-SK-AMP', 1], ['RB-SK-CRM', 1]], w: 0.1, liveW: 5, bomRisk: 0.006 },
    { id: 'RB-SET-TP3', name: '와와치약 3개 묶음 (기획·가정)', price: 23900, list: 37500, comps: [['RB-WW-TP', 3]], w: 0.3, liveW: 46, bomRisk: 0.006 },
    { id: 'RB-SET-ORAL', name: '와와 구강케어 세트 (기획·가정)', price: 26900, list: 43000, comps: [['RB-WW-TP', 1], ['RB-WW-GRG', 1], ['RB-WW-TCL', 1]], w: 0.16, liveW: 24, bomRisk: 0.03 }
  ];
  SETS.forEach(function (st) {
    var comps = st.comps.map(function (c) { return { idx: sid(c[0]), qty: c[1] }; });
    var s = {
      idx: skus.length, id: st.id, name: st.name, base: 'SET', spec: 'SET', specLabel: '세트', line: '세트',
      category: '세트', price: st.price, list: st.list,
      cost: comps.reduce(function (a, c) { return a + skus[c.idx].cost * c.qty; }, 0) + 600,
      shelfLifeDays: Math.min.apply(null, comps.map(function (c) { return skus[c.idx].shelfLifeDays; })),
      isSet: true, components: comps, vol: comps.reduce(function (a, c) { return a + skus[c.idx].vol * c.qty; }, 0.4),
      unitG: comps.reduce(function (a, c) { return a + skus[c.idx].unitG * c.qty; }, 40),
      b2cWeight: st.w, liveWeight: st.liveW, vf: 1, lotTrace: false, conf: null, season: false
    };
    skus.push(s); skuById[s.id] = s;
  });
  var NSKU = skus.length;
  var SINGLE_IDX = skus.filter(function (s) { return !s.isSet; }).map(function (s) { return s.idx; });
  var SET_IDX = skus.filter(function (s) { return s.isSet; }).map(function (s) { return s.idx; });
  var ALL_IDX = skus.map(function (s) { return s.idx; });

  // 미스트 계절성 (5~8월 성수기, 가정)
  var MIST_SEASON = { 1: 0.7, 2: 0.75, 3: 0.95, 4: 1.15, 5: 1.4, 6: 1.7, 7: 1.8, 8: 1.5, 9: 1.1, 10: 0.85, 11: 0.75, 12: 0.7 };
  function seasonFactor(s, day) {
    if (!skus[s].season) return 1;
    return MIST_SEASON[+isoOf(day).slice(5, 7)];
  }
  function b2cWeights(day) {
    return ALL_IDX.map(function (s) { return skus[s].b2cWeight * seasonFactor(s, day); });
  }
  var LIVE_W = ALL_IDX.map(function (s) {
    var k = skus[s];
    if (k.isSet) return k.liveWeight;
    return { 'RB-WW-TP': 12, 'RB-SK-AMP': 4, 'RB-WW-GRG': 3, 'RB-WW-SPR': 3 }[k.id] || 0;
  });

  /* ------------------------------------------------------------------
   * 4. 채널, 3PL 센터
   * ------------------------------------------------------------------ */
  // B2C: 채용공고의 '카페24, 스마트스토어, 사방넷 기반 주문·출고' — 모든 채널 주문은 사방넷(OMS)으로 수집(가정)
  var B2C_CHANNELS = [
    { id: 'CAFE24', name: '자사몰(카페24)', desc: '공식몰 rorobell.com · 카페24 기반', share: 0.38 },
    { id: 'SMART', name: '스마트스토어', desc: '네이버 스마트스토어', share: 0.4 },
    { id: 'OPEN', name: '기타 오픈마켓', desc: '사방넷으로 수집하는 기타 오픈마켓(가정)', share: 0.14 },
    { id: 'LIVE', name: '라이브·공동구매', desc: '쇼핑라이브·인플루언서 공동구매(가정)', share: 0.08 }
  ];
  // B2B: 채용공고의 '쿠팡, 컬리, 올리브영 등 B2B 주문·납품 일정 관리', '해외 출고(수출) 건 대응 및 서류 관리'
  //  supplyRate = 소비자가 대비 공급가 비율(가정). 매출은 공급가 × 출고 수량으로 계산한다.
  var B2B_TYPES = [
    { id: 'COUPANG', name: '쿠팡(로켓배송)', supplyRate: 0.55, mode: '팔레트 화물(밀크런)', note: '센터별 입고 예약 · 물류 바코드·팔레트 규격 준수' },
    { id: 'KURLY', name: '컬리', supplyRate: 0.58, mode: '박스 단위 택배', note: '입고 예약 시간 · 박스당 입수 표기' },
    { id: 'OLIVE', name: '올리브영', supplyRate: 0.5, mode: '팔레트 화물', note: '행사(올영세일) 전 물량 선입고 · 바코드 검수' },
    { id: 'EXPORT', name: '해외 수출', supplyRate: 0.42, mode: '해상·항공 수출(FOB)', note: 'C/I·P/L·원산지 증명 · 실측 중량·CBM' }
  ];
  var center = {
    name: '3PL A센터 (가정)',
    dailyCapacity: CAPACITY,
    overtimeCapacity: OVERTIME_CAPACITY,
    cutoff: '14:00',
    releaseBatches: '10:00, 13:00 (사방넷 발주 등록 → 3PL WMS 출고 지시 수작업 업로드)'
  };

  /* ------------------------------------------------------------------
   * 5. B2B 납품처 (센터·바이어 이름은 모두 가정)
   *    region = 센터 소재 권역 또는 수출 국가
   * ------------------------------------------------------------------ */
  var DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
  var ACCOUNT_DEFS = [
    { type: 'COUPANG', name: '쿠팡 FC 경기 남부 (가정)', region: '경기', cycle: 7, pref: [1, 3] },
    { type: 'COUPANG', name: '쿠팡 FC 경기 북부 (가정)', region: '경기', cycle: 7, pref: [2, 4] },
    { type: 'COUPANG', name: '쿠팡 FC 충청 (가정)', region: '충청', cycle: 7, pref: [2] },
    { type: 'COUPANG', name: '쿠팡 FC 영남 (가정)', region: '영남', cycle: 14, pref: [3] },
    { type: 'KURLY', name: '컬리 수도권 A센터 (가정)', region: '경기', cycle: 7, pref: [1, 4] },
    { type: 'KURLY', name: '컬리 수도권 B센터 (가정)', region: '경기', cycle: 14, pref: [2] },
    { type: 'OLIVE', name: '올리브영 수도권 물류센터 (가정)', region: '경기', cycle: 7, pref: [2, 4] },
    { type: 'OLIVE', name: '올리브영 영남 물류센터 (가정)', region: '영남', cycle: 14, pref: [3] },
    { type: 'EXPORT', name: '일본 드럭스토어 벤더 A (가상)', region: '일본', cycle: 35, pref: [2], ship: '해상 · 부산항', incoterms: 'FOB 부산' },
    { type: 'EXPORT', name: '대만 뷰티 유통사 B (가상)', region: '대만', cycle: 42, pref: [3], ship: '해상 · 부산항', incoterms: 'FOB 부산' },
    { type: 'EXPORT', name: '미국 온라인 셀러 C (가상)', region: '미국', cycle: 49, pref: [4], ship: '항공 · 인천공항', incoterms: 'FOB 인천' }
  ];
  var accounts = ACCOUNT_DEFS.map(function (a, i) {
    return {
      idx: i, id: 'AC-' + pad(i + 1, 4),
      name: a.name, type: a.type, region: a.region, district: a.region,
      cycleDays: a.cycle,
      cycleLabel: a.cycle === 7 ? '주 1회' : a.cycle === 14 ? '격주' : '약 ' + Math.round(a.cycle / 7) + '주 간격',
      preferredDays: a.pref,
      preferredLabel: a.pref.map(function (x) { return DOW_KO[x]; }).join('·'),
      minShelfLifeRatio: 0.70,
      ship: a.ship || null, incoterms: a.incoterms || null
    };
  });

  /* ------------------------------------------------------------------
   * 6. 라이브·공동구매 일정 (월 2회, 화·수·목)
   * ------------------------------------------------------------------ */
  var liveDays = [];
  (function () {
    var m;
    for (m = 0; m < 12; m++) {
      var cand = [];
      for (var d = 0; d <= END_DAY; d++) {
        if (monthIndex(d) !== m) continue;
        var w = dowOf(d);
        if (!BIZ[d] || w < 2 || w > 4) continue;
        if (!BIZ[d - 1] && !BIZ[d + 1]) continue;
        if (d === PREPACK_DAY) continue;
        if (d >= END_DAY - 3) continue; // 기준일 직전에는 편성하지 않음
        cand.push(d);
      }
      var chosen = [], guard = 0;
      while (chosen.length < 2 && guard < 200) {
        guard++;
        var c = pick(cand);
        if (chosen.some(function (x) { return Math.abs(x - c) < 8; })) continue;
        chosen.push(c);
      }
      chosen.sort(function (a, b) { return a - b; });
      liveDays = liveDays.concat(chosen);
    }
  })();
  function monthIndex(day) {
    var iso = isoOf(day);
    return (+iso.slice(0, 4) - 2025) * 12 + (+iso.slice(5, 7)) - 10;
  }
  var liveSet = {};
  liveDays.forEach(function (d) { liveSet[d] = true; });

  /* ------------------------------------------------------------------
   * 7. 발주 등록 → 출고 지시 수작업 배치 (영업일 10:00, 13:00 전후)
   *    이야기 3: 13:00 배치 이후 등록 건은 14:00 마감을 놓쳐 익일 출고
   * ------------------------------------------------------------------ */
  var BATCH = [];
  for (var bt = 0; bt <= HORIZON + 40; bt++) {
    BATCH[bt] = BIZ[bt] ? [600 + randInt(0, 20), 780 + randInt(0, 25)] : [];
  }
  function nextBatch(t) {
    var d = Math.floor(t / 1440);
    for (; ;) {
      var b = BATCH[d];
      for (var k = 0; k < b.length; k++) if (d * 1440 + b[k] >= t) return d * 1440 + b[k];
      d++;
    }
  }

  /* ------------------------------------------------------------------
   * 8. B2C 주문 생성
   * ------------------------------------------------------------------ */
  var HOURS = []; for (var hh = 0; hh < 24; hh++) HOURS.push(hh);
  var HOUR_W = [2, 1.2, 0.6, 0.4, 0.4, 0.6, 1.2, 2.4, 3.8, 5.2, 6.2, 6.8, 6.4, 6, 5.6, 5.4, 5.2, 5.2, 5.6, 6.6, 7.6, 8, 7, 4.4];
  var HOLD_REASONS = ['주소 확인 필요', '결제 확인 대기', '고객 배송 보류 요청', '합배송 대기', '송장 출력 오류'];
  var HOLD_W = [30, 15, 25, 18, 12];

  function sampleMinute(d, live) {
    var m;
    do {
      if (live && chance(0.65)) m = randInt(1200, 1379);   // 라이브 방송 20:00~23:00
      else m = pickW(HOURS, HOUR_W) * 60 + randInt(0, 59);
    } while (d === END_DAY && m >= 17 * 60 + 30);
    return m;
  }
  function makeItems(weights, live) {
    var n = live ? (chance(0.9) ? 1 : 2) : pickW([1, 2, 3], [0.7, 0.23, 0.07]);
    var items = [], used = {};
    var guard = 0;
    while (items.length < n && guard < 50) {
      guard++;
      var s = pickW(ALL_IDX, weights);
      if (used[s]) continue;
      used[s] = 1;
      items.push([s, pickW([1, 2, 3], [0.86, 0.11, 0.03])]);
    }
    return items;
  }
  function boxFor(vol) { return vol <= 1.0 ? 0 : vol <= 3 ? 1 : vol <= 6 ? 2 : 3; }

  var orders = [];
  var ordersByDay = [];
  var groupSeq = 0;
  (function generateOrders() {
    for (var d = 0; d <= END_DAY; d++) {
      var growth = 0.85 + 0.3 * (d / END_DAY);
      var biz = BIZ[d];
      var n = Math.round((biz ? 280 : 100) * growth * rand(0.92, 1.08));
      var live = !!liveSet[d];
      var nLive = live ? Math.max(0, Math.round(CAPACITY * rand(2.0, 2.6)) - n) : 0;   // 라이브 당일 3PL 처리량의 2~2.6배 (가정)
      var weights = b2cWeights(d);
      var dayList = [];
      var i;
      function add(isLive, ch, minute, grp) {
        var items = makeItems(isLive ? LIVE_W : weights, isLive);
        dayList.push({
          ch: ch, day: d, tO: d * 1440 + minute, items: items, live: isLive, grp: grp || 0
        });
      }
      for (i = 0; i < n; i++) {
        var ch = pickW([0, 1, 2, 3], B2C_CHANNELS.map(function (c) { return c.share; }));
        var mm = sampleMinute(d, false);
        // 동일 수취인 당일 복수 주문(합포장 대상) 약 2.5%
        if (chance(0.025)) {
          groupSeq++;
          add(false, ch, mm, groupSeq);
          var m2 = Math.min(mm + randInt(5, 180), d === END_DAY ? 17 * 60 + 29 : 1439);
          add(false, ch, m2, groupSeq);
        } else add(false, ch, mm, 0);
      }
      for (i = 0; i < nLive; i++) add(true, 3, sampleMinute(d, true), 0);
      dayList.sort(function (a, b) { return a.tO - b.tO; });
      var ymd = isoOf(d).replace(/-/g, '').slice(2);
      var grpFirst = {};
      dayList.forEach(function (o, k) {
        o.id = 'O' + ymd + pad(k + 1, 4);
        o.idx = orders.length;
        o.hr = Math.floor((o.tO % 1440) / 60);
        var vol = 0, setOnly = true;
        o.items.forEach(function (it) {
          vol += skus[it[0]].vol * it[1];
          if (!skus[it[0]].isSet) setOnly = false;
        });
        o.vol = vol;
        o.setOnly = setOnly;
        o.hasSet = o.items.some(function (it) { return skus[it[0]].isSet; });
        o.qty = o.items.reduce(function (a, it) { return a + it[1]; }, 0);
        // 합포장: 같은 그룹의 두 번째 주문은 55% 확률로 첫 주문과 한 박스로 출고
        o.merged = false;
        if (o.grp) {
          if (grpFirst[o.grp] === undefined) grpFirst[o.grp] = o.idx;
          else o.merged = chance(0.55);
        }
        o.boxNeed = boxFor(vol);
        o.box = Math.min(3, o.boxNeed + (chance(0.14) ? 1 : 0)); // 과대 박스 사용 14%
        orders.push(o);
      });
    }
  })();

  // 등록·보류·출고 지시·취소 시각
  orders.forEach(function (o) {
    o.tR = o.tO + randInt(5, 35);                         // OMS 자동 수집·발주 등록 (30분 주기)
    o.hold = null; o.tC = null; o.cancelStage = null;
    var releaseFrom = o.tR;
    if (chance(0.007)) {
      var hd = chance(0.1) ? randInt(8, 20) : randInt(1, 5);
      o.hold = { reason: pickW(HOLD_REASONS, HOLD_W), start: o.tR, end: o.tR + hd * 1440 + randInt(-300, 300) };
      releaseFrom = o.hold.end;
    }
    o.tX = nextBatch(releaseFrom);
    if (chance(0.02)) {
      if (chance(0.8)) { o.tC = o.tR + Math.floor(rnd() * (o.tX - o.tR)); o.tX = null; o.cancelStage = '출고 지시 전'; }
      else { o.tC = o.tX + randInt(5, 120); o.cancelStage = '출고 지시 후'; }
    }
    if (o.tX !== null && o.tX > NOW) o.tX = null;         // 기준 시각 이후 지시는 아직 미발생
    if (o.tC !== null && o.tC > NOW) { o.tC = null; o.cancelStage = null; }
    o.tS = null;
  });

  /* ------------------------------------------------------------------
   * 9. 3PL 출고 큐 시뮬레이션
   *    - 마감(14:00) 전 출고 지시분을 당일 처리, 처리 한도 600 단위
   *    - 적체(처리 대기 > 600)일 때 연장 근무로 900 단위까지 처리
   *    - 세트 사전 포장(2026-07-15~) 이후 세트 단독 주문은 0.4 단위로 환산
   *    - 합포장된 동반 주문은 0.3 단위
   *    - 일반 주문을 먼저 처리하고, 라이브 주문은 남은 처리량으로 순차 출고
   * ------------------------------------------------------------------ */
  var shipLog = {
    processedUnits: [], processedOrders: [], backlogStartUnits: [], backlogStartOrders: [], overtime: []
  };
  function orderUnits(o, shipDay) {
    if (o.merged) return 0.3;
    if (o.setOnly && shipDay >= PREPACK_DAY) return 0.4;
    return 1;
  }
  (function simulateShipping() {
    var rel = orders.filter(function (o) { return o.tX !== null; });
    rel.sort(function (a, b) { return a.tX - b.tX || a.tO - b.tO; });
    var p = 0;
    var queues = [{ list: [], head: 0 }, { list: [], head: 0 }];   // [일반, 라이브]
    for (var d = 0; d <= END_DAY; d++) {
      shipLog.processedUnits[d] = 0; shipLog.processedOrders[d] = 0;
      shipLog.backlogStartUnits[d] = 0; shipLog.backlogStartOrders[d] = 0; shipLog.overtime[d] = false;
      if (!BIZ[d]) continue;
      var cutoffT = d * 1440 + CUTOFF;
      while (p < rel.length && rel[p].tX <= cutoffT) { queues[rel[p].live ? 1 : 0].list.push(rel[p]); p++; }
      var units = 0, cnt = 0, k;
      queues.forEach(function (q) {
        for (k = q.head; k < q.list.length; k++) {
          if (q.list[k].tC !== null) continue;
          units += orderUnits(q.list[k], d); cnt++;
        }
      });
      shipLog.backlogStartUnits[d] = Math.round(units);
      shipLog.backlogStartOrders[d] = cnt;
      var cap = units > CAPACITY ? OVERTIME_CAPACITY : CAPACITY;
      shipLog.overtime[d] = units > CAPACITY;
      var used = 0, shipped = 0;
      queues.forEach(function (q) {
        while (q.head < q.list.length) {
          var o = q.list[q.head];
          if (o.tC !== null) { q.head++; continue; }             // 출고 지시 후 취소 → 3PL 출고 중단
          var u = orderUnits(o, d);
          if (used + u > cap) break;
          o.tS = d * 1440 + 870 + Math.floor((used / cap) * 185) + randInt(0, 4); // 14:30~17:40
          o.shipUnits = u;
          o.overtimeShip = shipLog.overtime[d];
          used += u; shipped++; q.head++;
        }
      });
      shipLog.processedUnits[d] = Math.round(used * 10) / 10;
      shipLog.processedOrders[d] = shipped;
    }
  })();

  // 출고 결과 플래그: 오출고, 누락, 파손, 수량 차이, 반품, 송장 연동
  orders.forEach(function (o) {
    o.mis = false; o.misCause = null; o.missing = false; o.damage = false; o.qtyErr = false; o.ret = null;
    o.invoiceLinked = true;
    if (o.tS === null) return;
    var sd = Math.floor(o.tS / 1440);
    // 와와 치약 5종은 패키지가 비슷해 인접 로케이션에서 혼동 → 05/01 로케이션 분리·바코드 검수 후 감소
    var confusable = o.items.some(function (it) { return skus[it[0]].conf === 'WWTP' || (skus[it[0]].isSet && skus[it[0]].components.some(function (c) { return skus[c.idx].conf === 'WWTP'; })); });
    var pConf = confusable ? (sd < LOCATION_SPLIT_DAY ? 0.0016 : 0.00025) : 0;
    var pBase = 0.0011 * (o.overtimeShip ? 1.9 : 1);
    var r = rnd();
    if (r < pConf) { o.mis = true; o.misCause = '유사 SKU 혼동(와와 치약 5종 인접 로케이션)'; }
    else if (r < pConf + pBase) { o.mis = true; o.misCause = o.overtimeShip ? '처리량 초과 시 검수 생략' : '피킹 오류'; }
    if (o.hasSet && chance(sd < PREPACK_DAY ? 0.004 : 0.0006)) o.missing = true;
    if (chance(0.0006)) o.damage = true;
    if (chance(0.0005)) o.qtyErr = true;
    if (chance(0.012)) {
      var arrive = sd + randInt(5, 12);
      var done = addBiz(arrive, randInt(0, 3));
      o.ret = { arrive: arrive, done: done, defect: chance(0.2) };
    }
    if (sd >= END_DAY - 1 && chance(0.03)) o.invoiceLinked = false;  // 최근 출고분 송장 미연동
  });

  // 일자별 인덱스
  for (var od = 0; od <= END_DAY; od++) ordersByDay[od] = [];
  orders.forEach(function (o) { ordersByDay[o.day].push(o); });

  /* ------------------------------------------------------------------
   * 10. B2B 발주 생성 (발주 1건 = 1 SKU 라인)
   * ------------------------------------------------------------------ */
  // 채널별 발주 품목 비중(가정): B2B는 와와 구강케어 중심, 올리브영·컬리는 스킨케어 일부 입점
  var B2B_W = {
    COUPANG: { 'RB-WW-TP': 30, 'RB-WW-GUM': 12, 'RB-WW-SNS': 10, 'RB-WW-WHT': 10, 'RB-WW-KID': 7, 'RB-WW-GRG': 9, 'RB-WW-BRS': 6, 'RB-WW-SPR': 6, 'RB-WW-TCL': 4 },
    KURLY: { 'RB-WW-TP': 20, 'RB-WW-KID': 10, 'RB-WW-GRG': 8, 'RB-SK-CLN': 8, 'RB-SK-PAD': 8, 'RB-SK-CRM': 6, 'RB-SK-SRM': 5, 'RB-SK-MSK': 6, 'RB-SK-BCR': 4 },
    OLIVE: { 'RB-WW-TP': 25, 'RB-WW-SPR': 10, 'RB-WW-GRG': 9, 'RB-WW-WHT': 8, 'RB-WW-GUM': 7, 'RB-WW-SNS': 6, 'RB-SK-AMP': 6, 'RB-SK-CRM': 6, 'RB-SK-MST': 5, 'RB-SK-PAD': 5, 'RB-SK-MSK': 5 },
    EXPORT: { 'RB-WW-TP': 40, 'RB-WW-WHT': 14, 'RB-WW-GUM': 10, 'RB-WW-SPR': 14, 'RB-SK-MSK': 8, 'RB-SK-AMP': 6 }
  };
  var B2B_WARR = {};
  Object.keys(B2B_W).forEach(function (t) {
    B2B_WARR[t] = ALL_IDX.map(function (s) { return B2B_W[t][skus[s].id] || 0; });
  });
  // 발주 수량(가정): 박스 입수 단위. 단가가 높은 스킨케어는 수량을 낮춘다
  function b2bQty(type, s) {
    var premium = skus[s].price >= 25000;
    if (type === 'EXPORT') return randInt(premium ? 4 : 10, premium ? 12 : 40) * 48;
    if (type === 'COUPANG') return randInt(premium ? 2 : 4, premium ? 6 : 15) * 24;
    if (type === 'OLIVE') return randInt(premium ? 2 : 3, premium ? 6 : 12) * 24;
    return randInt(premium ? 1 : 2, premium ? 4 : 8) * 12;   // KURLY
  }
  var b2b = [];
  (function generateB2B() {
    accounts.forEach(function (a) {
      var recv = bizOnOrAfter(randInt(0, a.cycleDays - 1));
      var seq = 0;
      while (recv <= END_DAY) {
        seq++;
        // 발주 접수 → 납품(입고) 요청일 리드타임(영업일, 가정)
        var leadMin = { COUPANG: 3, KURLY: 2, OLIVE: 4, EXPORT: 10 }[a.type];
        var leadMax = { COUPANG: 5, KURLY: 4, OLIVE: 7, EXPORT: 16 }[a.type];
        var req = addBiz(recv, randInt(leadMin, leadMax));
        for (var k = 0; k < 3; k++) {                       // 납품 희망 요일로 맞춤
          if (a.preferredDays.indexOf(dowOf(req)) >= 0) break;
          req = nextBiz(req);
        }
        var plan = Math.max(addBiz(req, -1), nextBiz(recv));
        var nLines = a.type === 'KURLY' ? randInt(2, 4) : randInt(3, 6);
        var used = {};
        var poNo = 'PO' + isoOf(recv).replace(/-/g, '').slice(2) + '-' + a.id.slice(3);
        for (var l = 0; l < nLines; l++) {
          var s = pickW(ALL_IDX, B2B_WARR[a.type]);
          if (used[s]) continue;
          used[s] = 1;
          b2b.push({
            idx: 0, id: poNo + '-' + (l + 1), po: poNo, acc: a.idx, type: a.type, region: a.region,
            sku: s, qty: b2bQty(a.type, s), recv: recv, req: req, plan: plan,
            ships: [], shippedQty: 0, delivered: null, lot: null, ratio: null,
            split: false, delayReason: null, waitUntil: plan, attempted: false
          });
        }
        recv = bizOnOrAfter(recv + a.cycleDays + randInt(-2, 2));
      }
    });
    b2b.sort(function (x, y) { return x.plan - y.plan || x.acc - y.acc; });
    b2b.forEach(function (x, i) { x.idx = i; });
  })();

  /* ------------------------------------------------------------------
   * 11. 재고 시뮬레이션 (로트 선입선출, 입고 발주, 세트 사전 포장, B2B 출고)
   * ------------------------------------------------------------------ */
  var lotQ = ALL_IDX.map(function () { return []; });   // [{lotNo, mfg, exp, qty}]
  var stock = ALL_IDX.map(function () { return 0; });
  var stockDaily = ALL_IDX.map(function () { return []; });
  var consDaily = ALL_IDX.map(function () { return []; }); // 일 소비량(출고 + 세트 작업)
  var deficit = ALL_IDX.map(function () { return 0; });
  var defectStock = ALL_IDX.map(function () { return 0; });
  var pipeline = ALL_IDX.map(function () { return 0; });
  var inbounds = [];
  var kitLog = [];
  var lotSeq = 0;

  // 연간 예상 일 수요 (초기 재고·안전 재고 산정용)
  var expDemand = ALL_IDX.map(function () { return 0; });
  orders.forEach(function (o) {
    if (o.tS === null) return;
    o.items.forEach(function (it) {
      var k = skus[it[0]];
      if (k.isSet) k.components.forEach(function (c) { expDemand[c.idx] += c.qty * it[1]; });
      else expDemand[it[0]] += it[1];
    });
  });
  b2b.forEach(function (x) { if (x.plan <= END_DAY) expDemand[x.sku] += x.qty; });
  expDemand = expDemand.map(function (v) { return v / 365; });
  skus.forEach(function (k) {
    k.safetyStock = k.isSet ? 0 : Math.max(30, Math.round(expDemand[k.idx] * 7 / 10) * 10);
    k.avgDailyDemand = Math.round(expDemand[k.idx] * 10) / 10;
  });
  SET_IDX.forEach(function (s) { skus[s].safetyStock = 0; });

  function makeLot(s, mfg, qty, prefix) {
    lotSeq++;
    return {
      lotNo: (prefix || 'L') + isoOf(mfg).replace(/-/g, '').slice(2) + '-' + skus[s].base + pad(lotSeq % 1000, 3),
      sku: s, mfg: mfg, exp: mfg + skus[s].shelfLifeDays, qty: qty
    };
  }
  var lotIndex = {};
  function addLot(s, lot) { lotQ[s].push(lot); stock[s] += lot.qty; lotIndex[lot.lotNo] = lot; }

  // 초기 재고: 일반 SKU 50일분(로트 2개), 저회전 SKU는 대량 초기 생산 로트 1개
  var SLOW = ['RB-WW-KID', 'RB-WW-TCL', 'RB-SK-BCR'];
  SINGLE_IDX.forEach(function (s) {
    var D = expDemand[s];
    if (SLOW.indexOf(skus[s].id) >= 0) {
      addLot(s, makeLot(s, -125, Math.ceil(D * 230 / 10) * 10));
    } else {
      addLot(s, makeLot(s, -82, Math.ceil(D * 22 / 10) * 10));
      addLot(s, makeLot(s, -38, Math.ceil(D * 30 / 10) * 10));
    }
  });

  function consume(s, q, d) {
    var taken = [];
    var lots = lotQ[s];
    while (q > 0 && lots.length) {
      var L = lots[0];
      var t = Math.min(L.qty, q);
      L.qty -= t; q -= t; stock[s] -= t;
      taken.push({ lot: L, qty: t });
      if (L.qty === 0) lots.shift();
    }
    if (q > 0) deficit[s] += q;
    if (d !== undefined) consDaily[s][d] = (consDaily[s][d] || 0) + taken.reduce(function (a, x) { return a + x.qty; }, 0) + q;
    return taken;
  }

  // 일별 B2C 출고(구성품 기준)와 세트 수요
  var b2cShipByDay = [];
  for (var dd = 0; dd <= END_DAY; dd++) b2cShipByDay[dd] = [];
  orders.forEach(function (o) { if (o.tS !== null) b2cShipByDay[Math.floor(o.tS / 1440)].push(o); });
  var setDemandByDay = SET_IDX.map(function () { return []; });
  orders.forEach(function (o) {
    if (o.tS === null) return;
    var sd = Math.floor(o.tS / 1440);
    o.items.forEach(function (it) {
      if (skus[it[0]].isSet) {
        var j = SET_IDX.indexOf(it[0]);
        setDemandByDay[j][sd] = (setDemandByDay[j][sd] || 0) + it[1];
      }
    });
  });

  // 반품 처리일 인덱스
  var returnsByDone = {};
  orders.forEach(function (o) {
    if (o.ret && o.ret.done <= END_DAY) (returnsByDone[o.ret.done] = returnsByDone[o.ret.done] || []).push(o);
  });

  var b2bByPlan = {};
  b2b.forEach(function (x) { (b2bByPlan[x.plan] = b2bByPlan[x.plan] || []).push(x); });
  var b2bQueue = [];

  // 리스크 SKU (이야기: 생산 지연에 따른 품절 위험)
  var RISK_SE = sid('RB-WW-TP');
  var inboundSeq = 0;
  function placeInbound(s, d, qty) {
    inboundSeq++;
    var planned = bizOnOrAfter(d + 21);
    var r = rnd();
    var delay = r < 0.72 ? 0 : r < 0.92 ? randInt(1, 3) : randInt(4, 7);
    var actual = addBiz(planned, delay);
    var ib = {
      idx: 0, id: 'IB-' + pad(inboundSeq, 4), sku: s, placed: d, planned: planned, actual: actual,
      plannedQty: qty, inspectedQty: null, shortQty: 0, defectQty: 0, diffReason: null,
      delayReason: delay > 0 ? pick(['공급사 생산 일정 지연', '운송 차량 배차 지연', '입고 검수 대기']) : null,
      lotNo: null, arrived: false
    };
    inbounds.push(ib); pipeline[s] += qty;
  }
  // 이야기: 공급 차질 — 8/1부터 기준일까지 받을 수 있는 입고 총량(budget)을 제한
  //  budget = 8/1~기준일 예상 출고량 × 보정계수 + 기준일 이후 목표 재고일수분 − 8/1 재고
  //  한도를 넘는 입고분은 잔량으로 분리해 10월 입고로 지연 → 기준일 재고가 목표 재고일수 수준
  //  - 와와치약: OEM 생산 일정 지연 (기준일 재고 약 7일분 → B2C·B2B 재고 배분 충돌, 품절 위험)
  var RISK_RULES = [
    { sku: RISK_SE, from: dayOf('2026-08-01'), coverDays: 7, factor: 1.0, restDay: dayOf('2026-10-19'), reason: 'OEM 생산 일정 지연', budget: null }
  ];
  function riskActivate(d) {
    RISK_RULES.forEach(function (rule) {
      if (d !== rule.from) return;
      var s = rule.sku;
      var tail = futureDemand(s, END_DAY - 27, END_DAY) / 28;
      rule.budget = Math.max(0, Math.round((futureDemand(s, d, END_DAY) * rule.factor + tail * rule.coverDays - stock[s]) / 10) * 10);
    });
  }
  function riskArrival(ib) {
    var rule = RISK_RULES.filter(function (r) { return r.sku === ib.sku && r.budget !== null; })[0];
    if (!rule) return true;
    var part = Math.min(ib.plannedQty, rule.budget);
    rule.budget -= part;
    var rest = ib.plannedQty - part;
    if (part === 0) {
      ib.actual = rule.restDay; ib.delayReason = rule.reason;
      pipeline[ib.sku] -= ib.plannedQty;                // 지연분은 발주 판단에서 제외(정상 발주 지속)
      return false;
    }
    if (rest > 0) {
      inboundSeq++;
      inbounds.push({
        idx: 0, id: 'IB-' + pad(inboundSeq, 4), sku: ib.sku, placed: ib.placed, planned: ib.planned, actual: rule.restDay,
        plannedQty: rest, inspectedQty: null, shortQty: 0, defectQty: 0, diffReason: null,
        delayReason: rule.reason + '(잔량 ' + isoOf(rule.restDay).slice(5).replace('-', '/') + ' 입고 예정)', lotNo: null, arrived: false
      });
      pipeline[ib.sku] -= rest;
      ib.plannedQty = part;
      ib.delayReason = rule.reason + '(부분 입고)';
    }
    return true;
  }

  var OLD_LOT_RULES = [
    { sku: sid('RB-WW-KID'), from: dayOf('2026-06-01'), done: false },
    { sku: sid('RB-WW-SNS'), from: dayOf('2026-07-01'), done: false }
  ];
  function futureDemand(s, from, to) {
    var sum = 0, d2, j;
    for (d2 = Math.max(0, from); d2 <= to; d2++) {
      b2cShipByDay[d2].forEach(function (o) {
        o.items.forEach(function (it) {
          if (it[0] === s) sum += it[1];
          else if (skus[it[0]].isSet) skus[it[0]].components.forEach(function (c) { if (c.idx === s) sum += c.qty * it[1]; });
        });
      });
      (b2bByPlan[d2] || []).forEach(function (x) { if (x.sku === s) sum += x.qty; });
    }
    return sum;
  }
  function demandEstimate(s, d) {
    if (d < 28) return expDemand[s];
    var sum = 0;
    for (var k = d - 28; k < d; k++) sum += consDaily[s][k] || 0;
    // B2B 대량 발주로 28일 평균이 튀는 것을 막기 위해 연평균의 1~1.5배 범위로 제한
    return Math.min(Math.max(sum / 28, expDemand[s]), expDemand[s] * 1.5);
  }

  var kitTotalByDay = [];
  var lastPlaced = {};
  (function simulateInventory() {
    for (var d = 0; d <= END_DAY; d++) {
      var s, k;
      riskActivate(d);
      // (1) 입고
      inbounds.forEach(function (ib) {
        if (ib.arrived || ib.actual !== d) return;
        if (!riskArrival(ib)) return;
        ib.arrived = true;
        var short = 0, defect = 0;
        if (chance(0.07)) { short = Math.round(ib.plannedQty * rand(0.01, 0.04)); ib.diffReason = '수량 부족(공급사 출고 누락)'; }
        if (chance(0.06)) { defect = Math.max(1, Math.round(ib.plannedQty * rand(0.002, 0.01))); ib.diffReason = ib.diffReason ? ib.diffReason + ' · 검수 불량' : '검수 불량(용기 파손·인쇄 불량)'; }
        ib.shortQty = short; ib.defectQty = defect;
        ib.inspectedQty = ib.plannedQty - short - defect;
        pipeline[ib.sku] -= ib.plannedQty;
        defectStock[ib.sku] += defect;
        var mfg = d - randInt(7, 25);
        // 이야기 7: 저회전 미니 SKU에 공급사 장기 보관 로트(제조 후 약 8개월) 입고 → B2B 유통기한 기준 미달
        var old = OLD_LOT_RULES.filter(function (r) { return r.sku === ib.sku && d >= r.from && !r.done; })[0];
        if (old) { old.done = true; mfg = d - randInt(235, 255); ib.lotNote = '공급사 장기 보관 로트(제조 후 약 8개월)'; }
        var lot = makeLot(ib.sku, mfg, ib.inspectedQty);
        ib.lotNo = lot.lotNo; ib.mfg = mfg;
        addLot(ib.sku, lot);
        if (deficit[ib.sku] > 0) {          // 결품분 상계
          var pay = Math.min(deficit[ib.sku], ib.inspectedQty);
          deficit[ib.sku] -= pay; consume(ib.sku, pay);
        }
      });
      // 월초 불량 재고 폐기
      if (isoOf(d).slice(8) === '01') defectStock = defectStock.map(function () { return 0; });
      // (2) 반품 처리
      (returnsByDone[d] || []).forEach(function (o) {
        o.items.forEach(function (it) {
          if (o.ret.defect) { defectStock[it[0]] += it[1]; return; }
          if (lotQ[it[0]].length) { lotQ[it[0]][lotQ[it[0]].length - 1].qty += it[1]; stock[it[0]] += it[1]; }
          else addLot(it[0], makeLot(it[0], d - 60, it[1], 'R'));
        });
      });
      // (3) 세트 사전 포장 (도입일 이후 월요일·라이브 전 영업일)
      kitTotalByDay[d] = 0;
      if (d >= PREPACK_DAY && BIZ[d] && (dowOf(d) === 1 || liveSet[nextBiz(d)] || d === PREPACK_DAY)) {
        SET_IDX.forEach(function (setI, j) {
          var need = 0;
          for (var f = d; f < d + 7 && f <= END_DAY; f++) need += setDemandByDay[j][f] || 0;
          need = Math.ceil(need * 1.05) - stock[setI];
          if (need <= 0) return;
          var comps = skus[setI].components;
          var buildable = Math.min.apply(null, comps.map(function (c) { return Math.floor(stock[c.idx] / c.qty); }));
          var make = Math.min(need, buildable);
          if (make <= 0) return;
          var minMfg = Infinity;
          comps.forEach(function (c) {
            var taken = consume(c.idx, c.qty * make, d);
            taken.forEach(function (t) { minMfg = Math.min(minMfg, t.lot.mfg); });
          });
          addLot(setI, makeLot(setI, minMfg, make, 'K'));
          kitLog.push({ day: d, sku: setI, qty: make });
          kitTotalByDay[d] += make;
        });
      }
      // (4) B2C 출고
      b2cShipByDay[d].forEach(function (o) {
        o.items.forEach(function (it) {
          var kk = skus[it[0]];
          if (kk.isSet) {
            var fromSet = Math.min(stock[it[0]], it[1]);
            if (fromSet > 0) consume(it[0], fromSet, d);
            var rest = it[1] - fromSet;
            if (rest > 0) kk.components.forEach(function (c) { consume(c.idx, c.qty * rest, d); });
          } else consume(it[0], it[1], d);
        });
      });
      // (5) B2B 출고 (이야기 2: B2C 적체일에는 B2B 출고를 뒤로 미룸)
      if (b2bByPlan[d]) b2bQueue = b2bQueue.concat(b2bByPlan[d]);
      if (BIZ[d]) {
        var remain = [];
        var poPostponed = {};   // B2C 적체일의 후순위 판단은 발주(PO) 단위로 한 번만
        b2bQueue.forEach(function (x) {
          if (x.waitUntil > d) { remain.push(x); return; }
          if (!x.attempted) {
            x.attempted = true;
            if (shipLog.overtime[d] && poPostponed[x.po] === undefined) poPostponed[x.po] = chance(0.3);
            if (shipLog.overtime[d] && poPostponed[x.po]) {
              x.waitUntil = addBiz(d, randInt(1, 2)); x.delayReason = 'B2C 물량 집중으로 B2B 출고 후순위';
              remain.push(x); return;
            }
            if (chance(0.03)) {
              x.waitUntil = addBiz(d, 1); x.delayReason = '출고 작업 지연(센터 인력)';
              remain.push(x); return;
            }
          }
          var rem = x.qty - x.shippedQty;
          var lim = rem;
          // 수출 대량 발주는 선적 일정(선복·컨테이너 적재)에 맞춰 일부를 1차 선적으로 분할
          if (!x.ships.length && x.type === 'EXPORT' && x.qty >= 960 && chance(0.3)) {
            lim = Math.round(x.qty * 0.6 / 48) * 48; x.loadSplit = true;
          }
          var q = Math.min(lim, stock[x.sku]);
          if (q > 0) {
            var taken = consume(x.sku, q, d);
            var main = taken.reduce(function (a, t) { return !a || t.qty > a.qty ? t : a; }, null);
            var deliverDay = nextBiz(d);
            var minRatio = Math.min.apply(null, taken.map(function (t) {
              return (t.lot.exp - deliverDay) / skus[x.sku].shelfLifeDays;
            }));
            x.ships.push({ day: d, deliver: deliverDay, qty: q, lot: main.lot.lotNo, ratio: Math.round(minRatio * 1000) / 1000 });
            x.shippedQty += q;
          }
          if (x.shippedQty < x.qty) {
            if (x.shippedQty > 0) x.split = true;
            if (x.loadSplit && x.ships.length === 1 && q === lim) {
              x.waitUntil = nextBiz(d);
              if (!x.delayReason) x.delayReason = '선적 일정 분할(1차 선적 후 잔량 출고)';
            } else if (!x.delayReason || x.delayReason.indexOf('재고') < 0) {
              x.delayReason = x.shippedQty > 0 ? '재고 부족(분할 납품)' : '재고 부족(입고 대기)';
            }
            remain.push(x);
          } else {
            var last = x.ships[x.ships.length - 1];
            x.delivered = last.deliver;
          }
        });
        b2bQueue = remain;
      }
      // (6) 입고 발주 (영업일, 단품만): 재고 + 입고 예정 < 30일분이면 45일분 발주
      if (BIZ[d]) {
        SINGLE_IDX.forEach(function (s2) {
          if (lastPlaced[s2] !== undefined && d - lastPlaced[s2] < 7) return;   // B2B 대량 발주로 수요가 튀어도 중복 발주하지 않음
          var D = demandEstimate(s2, d);
          var pos = stock[s2] + pipeline[s2] - deficit[s2];
          if (pos < D * 34) { placeInbound(s2, d, Math.max(300, Math.ceil(D * 45 / 100) * 100)); lastPlaced[s2] = d; }
        });
      }
      // (7) 일 마감 재고 기록
      for (s = 0; s < NSKU; s++) stockDaily[s][d] = stock[s];
    }
  })();

  // 공급 차질 SKU: 기준일 이후 잔량 입고일 전 도착 예정분도 잔량 입고일로 지연
  RISK_RULES.forEach(function (rule) {
    inbounds.forEach(function (ib) {
      if (ib.sku === rule.sku && !ib.arrived && ib.actual > END_DAY && ib.actual < rule.restDay) { ib.actual = rule.restDay; ib.delayReason = rule.reason; }
    });
  });
  inbounds.sort(function (a, b) { return a.planned - b.planned || a.sku - b.sku; });
  inbounds.forEach(function (ib, i) { ib.idx = i; });

  // B2B 센터 입고 반려 (쿠팡·컬리·올리브영): 물류 바코드·팔레트 규격·입수 표기·입고 예약 시간
  //  06/01 'B2B 채널별 입고 체크리스트 + D-1 사전 검수' 도입 후 반려 확률 감소 → 반려 시 재입고 2영업일 소요
  var B2B_CHECK_DAY = dayOf('2026-06-01');
  var REJECT_REASONS = {
    COUPANG: ['외박스 물류 바코드 미부착·오부착', '팔레트 적재 높이 초과', '입고 예약 시간 미준수'],
    KURLY: ['박스당 입수 표기 오류', '입고 예약 시간 미준수'],
    OLIVE: ['외박스 물류 바코드 미부착·오부착', '팔레트 적재 높이 초과', '박스당 입수 표기 오류']
  };
  b2b.forEach(function (x) {
    x.rejected = null;
    if (!REJECT_REASONS[x.type] || !x.ships.length) return;
    var first = x.ships[0];
    if (!chance(first.day < B2B_CHECK_DAY ? 0.035 : 0.006)) return;
    x.rejected = { day: first.deliver, reason: pick(REJECT_REASONS[x.type]) };
    x.ships.forEach(function (s) { s.deliver = addBiz(s.deliver, 2); });   // 반송 후 재입고
    if (x.delivered !== null) x.delivered = x.ships[x.ships.length - 1].deliver;
    if (!x.delayReason) x.delayReason = '센터 입고 반려 후 재입고(' + x.rejected.reason + ')';
  });

  // B2B 상태·로트·유통기한·거래명세서 대사
  b2b.forEach(function (x) {
    if (x.ships.length) {
      var minR = Math.min.apply(null, x.ships.map(function (s) { return s.ratio; }));
      var main = x.ships.reduce(function (a, s) { return !a || s.qty > a.qty ? s : a; }, null);
      x.lot = main.lot; x.ratio = minR;
      x.firstShip = x.ships[0].day;
    }
    // 납기: 요청일 이내 전량 납품
    x.onTime = x.delivered !== null && x.delivered <= x.req;
    if (x.delivered !== null) x.status = x.split ? '분할 납품 완료' : '납품 완료';
    else if (x.shippedQty > 0) x.status = '부분 납품';
    else if (x.req <= END_DAY) x.status = '미납';
    else x.status = '출고 예정';
    // 거래명세서 대사: 첫 납품분 거래명세서 기재 수량(invoiceQty) vs 실제 출고 수량(actualShipQty)
    x.invoiceQty = null; x.actualShipQty = null;
    x.invoiceMatch = true; x.invoiceReason = null;
    if (x.ships.length) {
      x.actualShipQty = x.ships[0].qty;
      x.invoiceQty = x.actualShipQty;
      if (x.split && chance(0.5)) {
        x.invoiceQty = x.qty;
        x.invoiceReason = '분할 납품 미반영(전량 기재)';
      } else if (chance(0.015)) {
        x.invoiceQty = Math.max(1, x.actualShipQty + pick([-6, -3, -2, -1, 1, 2, 3, 6]));
        x.invoiceReason = pick(['거래명세서 수기 작성 오기', '증정품 수량 포함 기재', '반품 차감 미반영']);
      }
      x.invoiceMatch = x.invoiceQty === x.actualShipQty;
      if (x.invoiceMatch) x.invoiceReason = null;
    }
  });

  /* 수출 출고 서류 (PO 단위, 모두 가정)
   *  - 카톤: 48개입, 카톤당 0.042㎥, 포장재 0.6kg / 총중량 = 순중량 × 1.08 + 카톤 수 × 0.6kg
   *  - 서류: 상업송장(C/I), 포장명세서(P/L), 원산지 증명서(C/O), 성분표·제조 증명(일본 바이어 요청)
   *  - 3PL 실측 중량과 P/L 기재 중량 차이 허용 범위 0.5% */
  var EXPORT_TOLERANCE = 0.005;
  var exportDocs = [];
  (function buildExportDocs() {
    var byPo = {};
    b2b.forEach(function (x) {
      if (x.type !== 'EXPORT') return;
      var p = byPo[x.po];
      if (!p) {
        p = byPo[x.po] = { po: x.po, acc: x.acc, recv: x.recv, req: x.req, lines: [], qty: 0, cartons: 0, netKg: 0, shipped: 0 };
        exportDocs.push(p);
      }
      p.lines.push(x);
      p.qty += x.qty;
      p.cartons += Math.ceil(x.qty / 48);
      p.netKg += x.qty * skus[x.sku].unitG / 1000;
      p.shipped += x.shippedQty;
      p.req = Math.max(p.req, x.req);
    });
    exportDocs.forEach(function (p) {
      var acc = accounts[p.acc];
      p.buyer = acc.name; p.country = acc.region; p.ship = acc.ship; p.incoterms = acc.incoterms;
      p.netKg = Math.round(p.netKg * 10) / 10;
      p.grossKg = Math.round((p.netKg * 1.08 + p.cartons * 0.6) * 10) / 10;
      p.cbm = Math.round(p.cartons * 0.042 * 100) / 100;
      p.pallets = Math.ceil(p.cartons / 40);
      var allDone = p.lines.every(function (x) { return x.delivered !== null; });
      var firstShip = Math.min.apply(null, p.lines.filter(function (x) { return x.ships.length; }).map(function (x) { return x.ships[0].day; }).concat([Infinity]));
      p.shipDay = isFinite(firstShip) ? firstShip : null;
      p.status = allDone ? '선적 완료' : p.shipped > 0 ? '부분 선적' : p.req <= END_DAY ? '선적 지연' : '선적 준비';
      var dueIn = p.req - END_DAY;
      var ready = p.shipDay !== null;
      p.docs = [
        { key: 'CI', name: '상업송장(C/I)', ok: ready || dueIn <= 10, status: ready ? '발행 완료' : dueIn <= 10 ? '작성 완료' : '작성 전' },
        { key: 'PL', name: '포장명세서(P/L)', ok: ready, status: ready ? '실측 반영 발행' : '3PL 실측 대기' },
        { key: 'CO', name: '원산지 증명서(C/O)', ok: ready, status: ready ? '발급 완료' : dueIn <= 5 ? '발급 신청' : '신청 전' }
      ];
      if (p.country === '일본') p.docs.push({ key: 'SPEC', name: '성분표·제조 증명(바이어 요청)', ok: ready || dueIn <= 7, status: ready || dueIn <= 7 ? '제출 완료' : '제조사 요청 중' });
      p.measuredKg = ready ? Math.round(p.grossKg * (1 + rand(-0.002, 0.002)) * 10) / 10 : null;
      p.weightGap = null; p.docIssue = null;
    });
    // 이야기: 일본 바이어 최근 선적 PO 1건에서 P/L 기재 총중량이 실측과 2.4% 차이 → 정정 재발행(통관 보류 방지)
    var jp = exportDocs.filter(function (p) { return p.country === '일본' && p.shipDay !== null; }).sort(function (a, b) { return b.shipDay - a.shipDay; })[0];
    if (jp) {
      jp.measuredKg = Math.round(jp.grossKg * 1.024 * 10) / 10;
      jp.docIssue = { day: jp.shipDay, reason: 'P/L 총중량 실측 차이 2.4%(허용 0.5% 초과) — 카톤 중량 표준값 미갱신', action: '실측값으로 P/L 정정 재발행 · SKU 제원 마스터 갱신' };
      jp.docs.filter(function (d) { return d.key === 'PL'; })[0].status = '정정 재발행';
    }
    exportDocs.forEach(function (p) { if (p.measuredKg !== null) p.weightGap = (p.measuredKg - p.grossKg) / p.grossKg; });
    exportDocs.sort(function (a, b) { return b.req - a.req; });
  })();

  /* ------------------------------------------------------------------
   * 12. 재고 상태 (기준일): 가용 / 보류 / 불량 / 반품 대기
   * ------------------------------------------------------------------ */
  var HOLD_LOTS = { 'RB-WW-GRG': { qty: 240, reason: '품질 재검사(용기 누액 확인)' }, 'RB-SK-SRM': { qty: 120, reason: '라벨 인쇄 확인' } };
  var stockStatus = skus.map(function (k) {
    var onHand = stockDaily[k.idx][END_DAY];
    var hold = HOLD_LOTS[k.id] ? Math.min(HOLD_LOTS[k.id].qty, Math.floor(onHand * 0.5)) : 0;
    return { sku: k.idx, onHand: onHand, hold: hold, holdReason: HOLD_LOTS[k.id] ? HOLD_LOTS[k.id].reason : null, defect: defectStock[k.idx], returnWait: 0 };
  });
  orders.forEach(function (o) {
    if (!o.ret) return;
    var arriveT = o.ret.arrive, doneT = o.ret.done;
    if (arriveT <= END_DAY && doneT > END_DAY) o.items.forEach(function (it) { stockStatus[it[0]].returnWait += it[1]; });
  });
  stockStatus.forEach(function (r) { r.available = r.onHand - r.hold; r.total = r.onHand + r.defect + r.returnWait; });

  /* ------------------------------------------------------------------
   * 13. 시스템 불일치(OMS·WMS·ERP)와 재고 실사
   *     이야기 4: 원인 3가지(취소·변경 미반영, 세트 구성품 차감 누락, 반품 입고 미처리) 집중
   *     이야기 5: 실사·조정 후 일치율 상승 → 원인 조치 없는 SKU는 수 주 뒤 재발
   * ------------------------------------------------------------------ */
  var CAUSES = {
    CANCEL: { label: '주문 취소·변경 미반영', pattern: 'OMS ≠ WMS·ERP', action: 'WMS 출고 지시 취소 처리 후 사방넷(OMS) 재고 재동기화, 취소 주문 자동 회수 규칙 적용' },
    SETBOM: { label: '세트 구성품 차감 누락', pattern: 'ERP ≠ OMS·WMS', action: 'ERP 세트 BOM(구성품) 매핑 등록 후 누락분 구성품 차감 전표 발행' },
    RETURN: { label: '반품 입고 미처리', pattern: 'WMS·ERP < 실물', action: '반품 대기 구역 실물 확인 후 WMS 반품 입고 처리, 반품 D+1 처리 마감 규칙 적용' },
    INBOUND: { label: '입고 검수 수량 미반영', pattern: 'ERP ≠ OMS·WMS', action: 'ERP 입고 전표를 검수 수량 기준으로 정정, 검수 결과 연동 확인' },
    SCAN: { label: '출고 스캔 오류', pattern: 'WMS·ERP ≠ 실물', action: '해당 로케이션 부분 실사 후 WMS 수량 조정, 스캐너 이중 스캔 방지 설정' }
  };
  // 원인 조치(재발 방지) 이력
  var FIXES = [
    { day: dayOf('2026-06-30'), cause: 'SETBOM', set: 'RB-SET-AC', label: 'ERP 세트 BOM 매핑 — 앰플 + 크림 SET' },
    { day: dayOf('2026-08-31'), cause: 'SETBOM', set: 'RB-SET-TP3', label: 'ERP 세트 BOM 매핑 — 와와치약 3개 묶음' },
    { day: dayOf('2026-08-31'), cause: 'RETURN', set: null, label: '반품 입고 D+1 처리 마감 규칙' },
    { day: dayOf('2026-08-31'), cause: 'CANCEL', set: null, label: '사방넷 취소 주문 → WMS 출고 지시 자동 회수' }
  ];
  // SKU별 원인 노출 (일 발생 확률)
  var exposures = [];   // {sku, cause, set, h}
  skus.forEach(function (k) {
    var vf = k.vf;   // 판매량이 많은 SKU일수록 취소·반품으로 어긋날 기회가 많다(가정)
    exposures.push({ sku: k.idx, cause: 'CANCEL', set: null, h: 0.0055 * vf });
    if (!k.isSet) exposures.push({ sku: k.idx, cause: 'RETURN', set: null, h: 0.0045 * vf });
    exposures.push({ sku: k.idx, cause: k.isSet ? 'SCAN' : (chance(0.5) ? 'INBOUND' : 'SCAN'), set: null, h: 0.0008 });
  });
  SETS.forEach(function (st) {
    exposures.push({ sku: sid(st.id), cause: 'SETBOM', set: st.id, h: st.bomRisk * 0.8 });
    st.comps.forEach(function (c) { exposures.push({ sku: sid(c[0]), cause: 'SETBOM', set: st.id, h: st.bomRisk }); });
  });
  function fixFactor(e, d) {
    var f = 1;
    FIXES.forEach(function (fx) {
      if (d < fx.day || fx.cause !== e.cause) return;
      if (fx.set && fx.set !== e.set) return;
      f *= fx.cause === 'SETBOM' ? 0.05 : fx.cause === 'RETURN' ? 0.2 : 0.5;
    });
    return f;
  }
  var mismatches = [];
  (function generateMismatches() {
    var seq = 0;
    for (var d = 1; d <= END_DAY; d++) {
      if (COUNT_DAYS.indexOf(d) >= 0) continue;
      exposures.forEach(function (e) {
        if (!chance(e.h * fixFactor(e, d))) return;
        seq++;
        var q;
        if (e.cause === 'CANCEL') q = randInt(1, 4);
        else if (e.cause === 'SETBOM') q = randInt(2, 12);
        else if (e.cause === 'RETURN') q = randInt(1, 5);
        else if (e.cause === 'INBOUND') q = randInt(10, 60);
        else q = randInt(1, 3);
        var off = { oms: 0, wms: 0, erp: 0 };
        if (e.cause === 'CANCEL') off.oms = q;
        else if (e.cause === 'SETBOM') off.erp = q;
        else if (e.cause === 'RETURN') { off.wms = -q; off.erp = -q; }
        else if (e.cause === 'INBOUND') off.erp = q;
        else { var sg = chance(0.5) ? 1 : -1; off.wms = sg * q; off.erp = sg * q; }
        var detect = Math.min(END_DAY, d + (chance(0.7) ? randInt(0, 1) : randInt(2, 6)));
        var nextCount = COUNT_DAYS.filter(function (c) { return c > d; })[0];
        var resolve = null, resolvedBy = null;
        if (chance(e.cause === 'SETBOM' ? 0.1 : 0.3)) {
          var fixDay = detect + randInt(2, 10);
          if (fixDay <= END_DAY && (!nextCount || fixDay < nextCount)) { resolve = fixDay; resolvedBy = '일일 대사 정정'; }
        }
        if (resolve === null && nextCount) { resolve = nextCount; resolvedBy = '정기 실사 조정'; }
        mismatches.push({
          idx: 0, id: 'MM-' + pad(seq, 4), sku: e.sku, cause: e.cause, set: e.set,
          occur: d, detect: detect, resolve: resolve, resolvedBy: resolvedBy, qty: q, off: off
        });
      });
    }
    mismatches.sort(function (a, b) { return a.detect - b.detect || a.sku - b.sku; });
    mismatches.forEach(function (m, i) { m.idx = i; m.id = 'MM-' + pad(i + 1, 4); });
  })();

  // 근거 주문(취소·반품) 연결 및 정상화 단계
  var ordersBySku = ALL_IDX.map(function () { return []; });
  orders.forEach(function (o) { o.items.forEach(function (it) { ordersBySku[it[0]].push(o); }); });
  mismatches.forEach(function (m) {
    var ev = null;
    var list = ordersBySku[m.sku];
    if (m.cause === 'CANCEL') {
      ev = list.filter(function (o) { return o.tC !== null && Math.abs(Math.floor(o.tC / 1440) - m.occur) <= 3; })[0];
      m.evidence = ev ? '주문 ' + ev.id + ' 취소 후 WMS 출고 지시 미취소' : 'OMS 주문 변경(수량 감소) 건 WMS 미반영';
    } else if (m.cause === 'RETURN') {
      ev = list.filter(function (o) { return o.ret && Math.abs(o.ret.arrive - m.occur) <= 4; })[0];
      m.evidence = ev ? '주문 ' + ev.id + ' 반품 실물 입고, WMS 반품 입고 미등록' : '반품 대기 구역 실물 존재, WMS 미등록';
    } else if (m.cause === 'SETBOM') {
      m.evidence = skus[m.sku].isSet ? skuById[m.set].name + ' 판매분 ERP 세트 코드만 차감' : skuById[m.set].name + ' 판매 시 ERP 구성품 미차감';
    } else if (m.cause === 'INBOUND') {
      m.evidence = '입고 예정 수량으로 ERP 입고 전표 생성(검수 차이 미반영)';
    } else {
      m.evidence = '출고 검수 단계 이중 스캔 또는 스캔 누락';
    }
    // 정상화 단계: 발견 → 원인 확인 → 실사 → 조정 → 재발 방지
    var fixedNow = FIXES.some(function (fx) {
      return fx.cause === m.cause && (!fx.set || fx.set === m.set) && m.resolve !== null && fx.day <= m.resolve + 0 && fx.day >= m.occur;
    });
    if (m.resolve !== null && m.resolve <= END_DAY) {
      m.stage = m.resolvedBy === '정기 실사 조정' ? (fixedNow ? 5 : 4) : (fixedNow ? 5 : 4);
      m.counted = m.resolvedBy === '정기 실사 조정';
    } else {
      m.resolve = null; m.resolvedBy = null;
      m.stage = (END_DAY - m.detect) <= 2 ? 1 : chance(0.3) ? 3 : 2;
      m.counted = m.stage >= 3;
    }
    m.rootFixed = fixedNow;
  });
  var STAGES = ['발견', '원인 확인', '실사', '조정', '재발 방지'];

  // 일자별 시스템 수량 계산
  function systemsAt(day) {
    var rows = skus.map(function (k) {
      var truth = stockDaily[k.idx][day];
      return { sku: k.idx, truth: truth, oms: truth, wms: truth, erp: truth, active: [] };
    });
    mismatches.forEach(function (m) {
      if (m.occur > day) return;
      if (m.resolve !== null && m.resolve <= day) return;
      var r = rows[m.sku];
      r.oms += m.off.oms; r.wms += m.off.wms; r.erp += m.off.erp;
      r.active.push(m);
    });
    rows.forEach(function (r) { r.match = r.oms === r.wms && r.wms === r.erp; });
    return rows;
  }
  // 일자별 SKU 일치 여부 (비트 배열)
  var matchDaily = [];
  (function () {
    for (var d = 0; d <= END_DAY; d++) matchDaily[d] = ALL_IDX.map(function () { return true; });
    mismatches.forEach(function (m) {
      var end = m.resolve === null ? END_DAY + 1 : m.resolve;
      for (var d2 = m.occur; d2 < end && d2 <= END_DAY; d2++) matchDaily[d2][m.sku] = false;
    });
  })();

  // 재고 실사 이력
  var cycleCounts = [];
  COUNT_DAYS.forEach(function (cd, ci) {
    var before = systemsAt(cd - 1);
    var nextCd = COUNT_DAYS[ci + 1] || END_DAY + 1;
    skus.forEach(function (k) {
      var r = before[k.idx];
      var causes = {};
      r.active.forEach(function (m) { causes[m.cause] = (causes[m.cause] || 0) + 1; });
      var main = Object.keys(causes).sort(function (a, b) { return causes[b] - causes[a]; })[0] || null;
      var fixed = FIXES.some(function (fx) {
        return fx.day === cd && (fx.set ? (skus[k.idx].isSet ? k.id === fx.set : skuById[fx.set].components.some(function (c) { return c.idx === k.idx; })) : true) && (main ? fx.cause === main : false);
      });
      var recur = mismatches.filter(function (m) { return m.sku === k.idx && m.occur > cd && m.occur <= cd + 42 && m.occur < nextCd; });
      var wasMismatch = !r.match || r.wms !== r.truth;
      cycleCounts.push({
        id: 'CC-' + isoOf(cd).replace(/-/g, '').slice(2) + '-' + pad(k.idx + 1, 2),
        day: cd, sku: k.idx,
        bookQty: r.wms, physicalQty: r.truth, diff: r.truth - r.wms,
        omsDiff: r.oms - r.truth, erpDiff: r.erp - r.truth,
        mismatch: wasMismatch, cause: main, causeLabel: main ? CAUSES[main].label : '차이 없음',
        adjusted: wasMismatch, rootCauseFixed: wasMismatch ? fixed : null,
        recurred: wasMismatch ? recur.length > 0 : null,
        recurDays: recur.length ? recur[0].occur - cd : null
      });
    });
  });

  /* ------------------------------------------------------------------
   * 14. 물류 이슈
   * ------------------------------------------------------------------ */
  var issues = [];
  var ISSUE_SLA = { '오출고': 2, '출고 지연': 1, '파손': 3, '수량 차이': 3, '누락': 2, '입고 반려': 2, '서류 보완': 1 };
  var NEXT_ACTION = {
    '오출고': ['회수 송장 발행 및 정상품 재발송', '회수품 입고 확인 후 재고 반영'],
    '출고 지연': ['출고 예정일 회신(CS·영업)', '우선 출고 지시 및 송장 회신'],
    '파손': ['택배사 사고 접수 및 교환 발송', '택배사 보상 청구 진행 확인'],
    '수량 차이': ['실물·전산 수량 재확인', '거래명세서 정정 발행 또는 추가 출고'],
    '누락': ['누락 구성품 추가 발송', '세트 작업 지시서 재점검'],
    '입고 반려': ['반송 물량 회수·재작업 지시(라벨·적재)', '센터 재입고 예약 확정 및 체크리스트 보완'],
    '서류 보완': ['3PL 실측값으로 서류 정정', '정정 서류 바이어·관세사 재송부']
  };
  function addIssue(day, type, channel, cause, source, dept, ref) {
    if (day > END_DAY) return;
    var base = { '오출고': [1, 4], '출고 지연': [0, 2], '파손': [1, 6], '수량 차이': [1, 7], '누락': [1, 3], '입고 반려': [1, 4], '서류 보완': [0, 2] }[type];
    var days = randInt(base[0], base[1]);
    if (chance(0.06)) days += randInt(4, 10);
    var resolvedDay = day + days;
    var open = resolvedDay > END_DAY;
    var status = open ? (END_DAY - day <= 1 ? '접수' : '처리 중') : '완료';
    var due = day + ISSUE_SLA[type];
    issues.push({
      idx: 0, id: '', day: day, type: type, channel: channel, cause: cause, source: source, dept: dept,
      status: status, due: due, resolvedDay: open ? null : resolvedDay,
      days: open ? END_DAY - day : days, overdue: open && due < END_DAY, ref: ref,
      nextAction: status === '완료' ? '—' : NEXT_ACTION[type][status === '접수' ? 0 : 1]
    });
  }
  orders.forEach(function (o) {
    var ch = B2C_CHANNELS[o.ch].id;
    if (o.tS === null) {
      // 72시간 넘게 출고되지 않은 주문 중 일부는 CS 문의로 접수
      return;
    }
    var sd = Math.floor(o.tS / 1440);
    if (o.mis) addIssue(sd + randInt(1, 3), '오출고', ch, o.misCause, chance(0.85) ? 'CS' : '3PL', '3PL', o.id);
    if (o.missing) addIssue(sd + randInt(1, 3), '누락', ch, sd < PREPACK_DAY ? '세트 구성품 누락(현장 키팅)' : '사전 포장 세트 구성 오류', 'CS', '3PL', o.id);
    if (o.damage) addIssue(sd + randInt(1, 3), '파손', ch, chance(0.7) ? '택배 운송 중 파손' : '완충재 부족(포장 불량)', 'CS', chance(0.7) ? '3PL' : '품질', o.id);
    if (o.qtyErr) addIssue(sd + randInt(1, 3), '수량 차이', ch, '피킹 수량 오류', 'CS', '3PL', o.id);
    var lead = (o.tS - o.tO) / 60;
    var holdLong = o.hold && (o.hold.end - o.hold.start) > 2 * 1440;
    if (lead > 72 && chance(holdLong ? 0.25 : o.live ? 0.02 : 0.06)) {
      var cause = holdLong ? '보류 해제 지연(' + o.hold.reason + ')'
        : o.live || shipLog.overtime[sd] ? '라이브·공동구매 물량 집중(처리량 초과)'
          : '연휴·주말 이월 물량';
      addIssue(Math.floor(o.tO / 1440) + 3, '출고 지연', ch, cause, 'CS', 'SCM', o.id);
    }
  });
  // 미출고 장기 주문 CS 문의 (기준일 시점)
  orders.forEach(function (o) {
    if (o.tS !== null || o.tC !== null) return;
    if ((NOW - o.tO) / 60 > 72 && chance(0.35)) {
      addIssue(Math.floor(o.tO / 1440) + 3, '출고 지연', B2C_CHANNELS[o.ch].id, o.hold ? '보류 해제 지연(' + o.hold.reason + ')' : '처리량 초과 이월', 'CS', 'SCM', o.id);
    }
  });
  b2b.forEach(function (x) {
    var lateDay = x.req + 1;
    var late = (x.delivered !== null && x.delivered > x.req) || (x.delivered === null && x.req < END_DAY);
    if (late && chance(0.45)) {
      addIssue(lateDay, '출고 지연', x.type, x.delayReason || '출고 작업 지연(센터 인력)', '영업', 'SCM', x.id);
    }
    if (x.ships.length && !x.invoiceMatch && chance(0.7)) {
      addIssue(x.ships[0].deliver + randInt(0, 2), '수량 차이', x.type, x.invoiceReason, '영업', x.invoiceReason.indexOf('수기') >= 0 ? '영업' : 'SCM', x.id);
    }
    if (x.rejected) addIssue(x.rejected.day, '입고 반려', x.type, x.rejected.reason, '영업', '3PL', x.id);
  });
  exportDocs.forEach(function (p) {
    if (p.docIssue) addIssue(p.docIssue.day, '서류 보완', 'EXPORT', p.docIssue.reason, '3PL', 'SCM', p.lines[0].id);
  });
  inbounds.forEach(function (ib) {
    if (ib.arrived && ib.diffReason) addIssue(ib.actual, '수량 차이', 'CENTER', ib.shortQty ? '입고 수량 부족(공급사)' : '입고 검수 불량', '3PL', 'SCM', ib.id);
  });
  issues.sort(function (a, b) { return a.day - b.day; });
  issues.forEach(function (it, i) { it.idx = i; it.id = 'IS-' + pad(i + 1, 5); });

  /* ------------------------------------------------------------------
   * 15. 3PL 작업 기록(실적)과 월별 청구 내역
   *     이야기 6: 택배비 중복 청구(2·7·9월), 포장(출고 작업) 건수 과다(4·8월), 구간 단가 미적용(7월)
   * ------------------------------------------------------------------ */
  var months = [];
  for (var md = 0; md <= END_DAY; md++) { var mo = monthOf(md); if (months.indexOf(mo) < 0) months.push(mo); }
  var workLogs = {};
  months.forEach(function (m) {
    workLogs[m] = { month: m, stockUnitDays: 0, days: 0, inboundQty: 0, b2cShipped: 0, b2bShipments: 0, freightShipments: 0,
      boxes: [0, 0, 0, 0], b2bParcels: 0, returns: 0, kitted: 0 };
  });
  for (var wd = 0; wd <= END_DAY; wd++) {
    var wl = workLogs[monthOf(wd)];
    var tot = 0;
    for (var s3 = 0; s3 < NSKU; s3++) tot += stockDaily[s3][wd];
    wl.stockUnitDays += tot; wl.days++;
    wl.kitted += kitTotalByDay[wd] || 0;
  }
  inbounds.forEach(function (ib) { if (ib.arrived) workLogs[monthOf(ib.actual)].inboundQty += ib.inspectedQty; });
  orders.forEach(function (o) {
    if (o.tS === null) return;
    var wl2 = workLogs[monthOf(Math.floor(o.tS / 1440))];
    wl2.b2cShipped++;
    if (!o.merged) wl2.boxes[o.box]++;
    if (o.ret && o.ret.done <= END_DAY) workLogs[monthOf(o.ret.done)].returns++;
  });
  b2b.forEach(function (x) {
    x.ships.forEach(function (sp) {
      var wl3 = workLogs[monthOf(sp.day)];
      wl3.b2bShipments++;
      if (x.type !== 'KURLY') wl3.freightShipments++;   // 쿠팡·올리브영·수출은 팔레트 화물, 컬리는 박스 택배
      else { wl3.boxes[3]++; wl3.b2bParcels++; }
    });
  });
  /* 3PL 견적 단가표 (Rate Card)
   *  - 구간: 월 B2C 택배 출고 박스 수(합포장 후 박스 기준). B2B 택배는 같은 구간 단가를 적용하되 구간 산정에서 제외
   *  - 사이즈: 소형(극소·소 박스) / 중형(중 박스) / 대형(대 박스, B2B 컬리 박스 택배 포함)
   *  - 일반 포장 단가 = 피킹·검수·포장 작업 + 박스·완충재 (박스 1개당)
   *  - 택배비 단가 = 택배 운임 (박스 1개당, 전국 동일)
   *  - 비교 견적 = 동일 물량 기준 타 3PL 2곳 견적 평균(가상), 단가 협상 기준선 */
  var RATE_CARD = {
    basis: '월 B2C 택배 출고 박스 수 (합포장 후 박스 기준)',
    excluded: 'B2B 택배(컬리 박스 납품)는 구간 산정에서 제외, 단가는 해당 월 구간 단가 적용',
    tiers: [
      { id: 'A', label: 'A구간', min: 0, max: 8000 },
      { id: 'B', label: 'B구간', min: 8001, max: 10000 },
      { id: 'C', label: 'C구간', min: 10001, max: 12500 },
      { id: 'D', label: 'D구간', min: 12501, max: null }
    ],
    sizes: [
      { id: 'S', label: '소형', spec: '세 변 합 80cm 이하 · 2kg 이하', boxes: [0, 1], boxLabel: '극소·소 박스' },
      { id: 'M', label: '중형', spec: '세 변 합 100cm 이하 · 5kg 이하', boxes: [2], boxLabel: '중 박스' },
      { id: 'L', label: '대형', spec: '세 변 합 120cm 이하 · 10kg 이하', boxes: [3], boxLabel: '대 박스 · B2B 택배' }
    ],
    packing: {
      A: { S: 1080, M: 1340, L: 1700 }, B: { S: 1000, M: 1250, L: 1600 },
      C: { S: 940, M: 1180, L: 1520 }, D: { S: 880, M: 1110, L: 1450 }
    },
    parcel: {
      A: { S: 2600, M: 3000, L: 3700 }, B: { S: 2450, M: 2850, L: 3500 },
      C: { S: 2350, M: 2760, L: 3420 }, D: { S: 2280, M: 2680, L: 3350 }
    },
    benchmark: {
      label: '타 3PL 비교 견적 평균(동일 물량, 가상)',
      packing: { S: 900, M: 1120, L: 1450 },
      parcel: { S: 2280, M: 2700, L: 3350 }
    },
    others: [
      { item: '보관료', unit: '팔레트·월', price: 28000 },
      { item: '입고 작업비', unit: '개', price: 40 },
      { item: '반품 처리비', unit: '건', price: 1500 },
      { item: '세트 사전 포장 작업비', unit: '세트', price: 350 },
      { item: 'B2B 화물 운송비(팔레트)', unit: '건', price: 42000 }
    ]
  };
  function tierOf(boxes) {
    for (var i = RATE_CARD.tiers.length - 1; i >= 0; i--) if (boxes >= RATE_CARD.tiers[i].min) return RATE_CARD.tiers[i].id;
    return 'A';
  }

  months.forEach(function (m) {
    var wl4 = workLogs[m];
    wl4.avgStockUnits = Math.round(wl4.stockUnitDays / wl4.days);
    wl4.pallets = Math.ceil(wl4.avgStockUnits / 1000);
    wl4.outbound = wl4.b2cShipped + wl4.b2bShipments;
    wl4.totalBoxes = wl4.boxes[0] + wl4.boxes[1] + wl4.boxes[2] + wl4.boxes[3];
    // 사이즈별 박스 수: B2C 박스 + B2B 택배(대형)
    wl4.b2cBoxes = wl4.totalBoxes - wl4.b2bParcels;
    wl4.sizeBoxes = { S: wl4.boxes[0] + wl4.boxes[1], M: wl4.boxes[2], L: wl4.boxes[3] };
    wl4.tierBasis = wl4.b2cBoxes;                    // 구간 산정 기준 물량
    wl4.tier = tierOf(wl4.tierBasis);
    wl4.tierIfB2B = tierOf(wl4.totalBoxes);          // B2B 택배를 산정에 포함할 때의 구간
  });

  function packPrice(size) { return function (w) { return RATE_CARD.packing[w.tier][size]; }; }
  function parcelPrice(size) { return function (w) { return RATE_CARD.parcel[w.tier][size]; }; }
  function fixed(p) { return function () { return p; }; }
  var BILL_ITEMS = [
    { key: 'storage', cat: '보관료', item: '보관료', unit: '팔레트', price: fixed(28000), actual: function (w) { return w.pallets; } },
    { key: 'inbound', cat: '입고 작업비', item: '입고 작업비', unit: '개', price: fixed(40), actual: function (w) { return w.inboundQty; } },
    { key: 'packS', cat: '일반 포장비', item: '일반 포장비(소형)', unit: '박스', size: 'S', price: packPrice('S'), actual: function (w) { return w.sizeBoxes.S; } },
    { key: 'packM', cat: '일반 포장비', item: '일반 포장비(중형)', unit: '박스', size: 'M', price: packPrice('M'), actual: function (w) { return w.sizeBoxes.M; } },
    { key: 'packL', cat: '일반 포장비', item: '일반 포장비(대형)', unit: '박스', size: 'L', price: packPrice('L'), actual: function (w) { return w.sizeBoxes.L; } },
    { key: 'parcelS', cat: '택배비', item: '택배비(소형)', unit: '박스', size: 'S', price: parcelPrice('S'), actual: function (w) { return w.sizeBoxes.S; } },
    { key: 'parcelM', cat: '택배비', item: '택배비(중형)', unit: '박스', size: 'M', price: parcelPrice('M'), actual: function (w) { return w.sizeBoxes.M; } },
    { key: 'parcelL', cat: '택배비', item: '택배비(대형)', unit: '박스', size: 'L', price: parcelPrice('L'), actual: function (w) { return w.sizeBoxes.L; } },
    { key: 'returns', cat: '기타', item: '반품 처리비', unit: '건', price: fixed(1500), actual: function (w) { return w.returns; } },
    { key: 'kitting', cat: '기타', item: '세트 사전 포장 작업비', unit: '세트', price: fixed(350), actual: function (w) { return w.kitted; } },
    { key: 'freight', cat: '기타', item: 'B2B 화물 운송비(팔레트)', unit: '건', price: fixed(42000), actual: function (w) { return w.freightShipments; } }
  ];
  // 수량 차이(rate/add) 또는 단가 차이(tier: 청구서에 적용된 구간)
  var BILL_DIFF = {
    '2025-12|storage': { add: 3, memo: '월말 반품 대기 구역 팔레트를 보관 팔레트로 중복 산정' },
    '2026-01|inbound': { rate: -0.006, memo: '1/28 입고분 청구 누락(익월 소급 청구 예정)' },
    '2026-02|parcelS': { rate: 0.014, memo: '설 연휴 재발송 송장이 원 송장과 함께 중복 청구' },
    '2026-04|packS': { rate: 0.025, memo: '출고 지시 후 취소된 주문이 포장 건수에 포함' },
    '2026-07|parcelS': { rate: 0.021, memo: '송장 재발행 건 중복 청구(동일 주문번호 2회)' },
    '2026-07|parcelM': { rate: 0.016, memo: '송장 재발행 건 중복 청구(동일 주문번호 2회)' },
    '2026-07|packS': { tier: 'B', memo: 'C구간 진입 월인데 B구간 단가로 청구(구간 단가 미적용)' },
    '2026-07|packM': { tier: 'B', memo: 'C구간 진입 월인데 B구간 단가로 청구(구간 단가 미적용)' },
    '2026-07|packL': { tier: 'B', memo: 'C구간 진입 월인데 B구간 단가로 청구(구간 단가 미적용)' },
    '2026-08|packS': { rate: 0.042, memo: '보류 해제 후 재지시 건을 포장 건수에 이중 집계' },
    '2026-09|parcelS': { rate: 0.018, memo: '송장 재발행 건 중복 청구 의심(검증 진행 중)' }
  };
  var billing = [];
  months.forEach(function (m) {
    var w = workLogs[m];
    BILL_ITEMS.forEach(function (bi) {
      var act = bi.actual(w);
      if (bi.key === 'kitting' && act === 0) return;
      var df = BILL_DIFF[m + '|' + bi.key];
      var billed = act;
      var contract = bi.price(w);
      var billedPrice = contract;
      if (df && df.tier) billedPrice = RATE_CARD.packing[df.tier][bi.size];
      else if (df) billed = df.add !== undefined ? act + df.add : Math.round(act * (1 + df.rate));
      var verified = m < '2026-09';
      billing.push({
        id: 'BL-' + m.replace('-', '') + '-' + pad(BILL_ITEMS.indexOf(bi) + 1, 2),
        month: m, key: bi.key, cat: bi.cat, item: bi.item, unit: bi.unit, size: bi.size || null, tier: bi.size ? w.tier : null,
        billedQty: billed, unitPrice: contract, billedUnitPrice: billedPrice,
        status: verified ? '검증 완료' : '검증 대기',
        memo: df ? df.memo : '',
        resolution: df ? (verified ? (billed * billedPrice > act * contract ? '청구 정정 완료(익월 차감)' : '소급 청구 승인') : '3PL 소명 요청') : ''
      });
    });
  });

  /* ------------------------------------------------------------------
   * 16. 내보내기
   * ------------------------------------------------------------------ */
  global.SCM_DATA = {
    meta: {
      seed: SEED, startIso: isoOf(0), endIso: isoOf(END_DAY), nowLabel: isoOf(END_DAY) + ' 18:00',
      END_DAY: END_DAY, HORIZON: HORIZON, NOW: NOW, CUTOFF: CUTOFF,
      CAPACITY: CAPACITY, OVERTIME_CAPACITY: OVERTIME_CAPACITY,
      PREPACK_DAY: PREPACK_DAY, LOCATION_SPLIT_DAY: LOCATION_SPLIT_DAY,
      COUNT_DAYS: COUNT_DAYS, months: months, liveDays: liveDays, fixes: FIXES,
      stages: STAGES, causes: CAUSES, issueSla: ISSUE_SLA, minShelfLifeRatio: 0.70,
      B2B_CHECK_DAY: B2B_CHECK_DAY, exportTolerance: EXPORT_TOLERANCE, riskSku: RISK_SE, riskReason: RISK_RULES[0].reason, riskRestIso: isoOf(RISK_RULES[0].restDay)
    },
    brand: {
      name: '로로벨', en: 'ROROBELL', company: '(주)로로벨', site: 'rorobell.com', checked: '2026-10-12',
      categories: ['스킨케어', '메이크업', '선케어', '오랄케어'],
      hq: '서울 성동구 성수동', mall: '카페24 기반 공식몰'
    },
    exportDocs: exportDocs,
    cal: { BIZ: BIZ, isoOf: isoOf, dayOf: dayOf, dowOf: dowOf, monthOf: monthOf, addBiz: addBiz, nextBiz: nextBiz, DOW_KO: DOW_KO },
    skus: skus, skuById: skuById,
    channels: { b2c: B2C_CHANNELS, b2b: B2B_TYPES },
    center: center,
    accounts: accounts,
    orders: orders, ordersByDay: ordersByDay, ordersBySku: ordersBySku,
    shipLog: shipLog,
    b2b: b2b,
    inbounds: inbounds,
    lots: lotIndex,
    stockDaily: stockDaily, consDaily: consDaily, stockStatus: stockStatus, deficit: deficit,
    kitLog: kitLog,
    mismatches: mismatches, matchDaily: matchDaily, systemsAt: systemsAt, cycleCounts: cycleCounts,
    issues: issues,
    workLogs: workLogs, billing: billing, billItems: BILL_ITEMS, rateCard: RATE_CARD
  };
})(typeof window !== 'undefined' ? window : globalThis);
