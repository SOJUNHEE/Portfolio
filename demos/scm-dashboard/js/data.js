/* =====================================================================
 * js/data.js — 가상 데이터 생성
 * ---------------------------------------------------------------------
 * 본 파일의 모든 수치는 지원용 포트폴리오를 위한 가상 데이터입니다.
 * 네오심플릭스의 실제 주문·재고·정산 수치가 아닙니다.
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
   * 3. 상품 마스터 (단품 6종 × 규격 3종 + 세트 3종 = 21 SKU)
   * ------------------------------------------------------------------ */
  var BASES = [
    { code: 'CR', name: 'PDRN 크림', category: '크림', price: 38000, cost: 9200, shelfM: 30, b2c: 1.0 },
    { code: 'SE', name: 'PDRN 세럼', category: '세럼', price: 42000, cost: 10400, shelfM: 30, b2c: 1.25 },
    { code: 'MS', name: 'PDRN 마스크', category: '마스크', price: 24000, cost: 5600, shelfM: 24, b2c: 0.7 },
    { code: 'SN', name: '선 세럼', category: '선케어', price: 29000, cost: 7100, shelfM: 24, b2c: 0.8 },
    { code: 'LP', name: '립 세럼', category: '립케어', price: 18000, cost: 4200, shelfM: 24, b2c: 0.5 },
    { code: 'SC', name: '두피 세럼', category: '두피케어', price: 34000, cost: 8600, shelfM: 30, b2c: 0.55 }
  ];
  var SPECS = [
    { code: 'STD', label: '본품', pm: 1, w: 1, vol: 1 },
    { code: 'LRG', label: '대용량', pm: 1.65, w: 0.28, vol: 1.6 },
    { code: 'MINI', label: '미니', pm: 0.38, w: 0.16, vol: 0.4 }
  ];
  var skus = [];
  var skuById = {};
  BASES.forEach(function (b) {
    SPECS.forEach(function (sp) {
      var s = {
        idx: skus.length,
        id: 'RJ-' + b.code + '-' + sp.code,
        name: b.name + ' ' + sp.label,
        base: b.code, spec: sp.code, specLabel: sp.label,
        category: b.category,
        price: Math.round(b.price * sp.pm / 100) * 100,
        cost: Math.round(b.cost * sp.pm / 10) * 10,
        shelfLifeDays: Math.round(b.shelfM * 30.4),
        isSet: false, components: [], vol: sp.vol,
        b2cWeight: b.b2c * sp.w
      };
      skus.push(s); skuById[s.id] = s;
    });
  });
  function sid(id) { return skuById[id].idx; }
  var SETS = [
    { id: 'RJ-SET-HOME', name: 'PDRN 홈케어 세트', price: 72000, comps: [['RJ-CR-STD', 1], ['RJ-SE-STD', 1]], w: 0.42, liveW: 35, bomRisk: 0.006 },
    { id: 'RJ-SET-INT', name: 'PDRN 집중 세트', price: 79000, comps: [['RJ-SE-STD', 1], ['RJ-MS-STD', 2]], w: 0.36, liveW: 25, bomRisk: 0.006 },
    { id: 'RJ-SET-DAILY', name: '데일리 케어 세트', price: 52000, comps: [['RJ-SN-STD', 1], ['RJ-LP-STD', 1], ['RJ-CR-MINI', 1]], w: 0.28, liveW: 15, bomRisk: 0.03 }
  ];
  SETS.forEach(function (st) {
    var comps = st.comps.map(function (c) { return { idx: sid(c[0]), qty: c[1] }; });
    var s = {
      idx: skus.length, id: st.id, name: st.name, base: 'SET', spec: 'SET', specLabel: '세트',
      category: '세트', price: st.price,
      cost: comps.reduce(function (a, c) { return a + skus[c.idx].cost * c.qty; }, 0) + 600,
      shelfLifeDays: Math.min.apply(null, comps.map(function (c) { return skus[c.idx].shelfLifeDays; })),
      isSet: true, components: comps, vol: 2.5, b2cWeight: st.w, liveWeight: st.liveW
    };
    skus.push(s); skuById[s.id] = s;
  });
  var NSKU = skus.length;
  var SINGLE_IDX = skus.filter(function (s) { return !s.isSet; }).map(function (s) { return s.idx; });
  var SET_IDX = skus.filter(function (s) { return s.isSet; }).map(function (s) { return s.idx; });
  var ALL_IDX = skus.map(function (s) { return s.idx; });

  // 선케어 계절성 (5~8월 성수기)
  var SUN_SEASON = { 1: 0.7, 2: 0.75, 3: 0.95, 4: 1.2, 5: 1.5, 6: 1.8, 7: 1.9, 8: 1.6, 9: 1.1, 10: 0.85, 11: 0.75, 12: 0.7 };
  function seasonFactor(s, day) {
    if (skus[s].base !== 'SN') return 1;
    return SUN_SEASON[+isoOf(day).slice(5, 7)];
  }
  function b2cWeights(day) {
    return ALL_IDX.map(function (s) { return skus[s].b2cWeight * seasonFactor(s, day); });
  }
  var LIVE_W = ALL_IDX.map(function (s) {
    var k = skus[s];
    if (k.isSet) return k.liveWeight;
    return { 'RJ-SE-STD': 10, 'RJ-CR-STD': 8, 'RJ-MS-STD': 4, 'RJ-SN-STD': 3 }[k.id] || 0;
  });

  /* ------------------------------------------------------------------
   * 4. 채널, 3PL 센터
   * ------------------------------------------------------------------ */
  var B2C_CHANNELS = [
    { id: 'MALL', name: '자사몰' },
    { id: 'OM_A', name: '오픈마켓A' },
    { id: 'OM_B', name: '오픈마켓B' },
    { id: 'LIVE', name: '라이브·공동구매' }
  ];
  var B2B_TYPES = [
    { id: 'PHARM', name: '약국' },
    { id: 'CLINIC', name: '피부미용 의원' },
    { id: 'DIST', name: '총판' }
  ];
  var center = {
    name: '3PL A센터 (가정)',
    dailyCapacity: CAPACITY,
    overtimeCapacity: OVERTIME_CAPACITY,
    cutoff: '14:00',
    releaseBatches: '10:00, 13:00 (발주 등록 → 출고 지시 수작업 업로드)'
  };

  /* ------------------------------------------------------------------
   * 5. B2B 거래처 300곳
   * ------------------------------------------------------------------ */
  var REGIONS = ['서울', '경기', '인천', '부산', '대구', '대전', '광주', '기타'];
  var REGION_W = [30, 28, 6, 9, 6, 4, 4, 13];
  var DISTRICTS = {
    '서울': ['강남', '서초', '송파', '마포', '영등포', '성동', '용산', '종로', '강서', '노원'],
    '경기': ['분당', '수원', '일산', '용인', '안양', '부천', '화성', '평택'],
    '인천': ['송도', '부평', '남동'],
    '부산': ['해운대', '서면', '동래', '수영'],
    '대구': ['수성', '중구', '달서'],
    '대전': ['둔산', '유성'],
    '광주': ['상무', '첨단'],
    '기타': ['청주', '천안', '전주', '창원', '원주', '제주']
  };
  var PHARM_NAMES = ['온누리', '새봄', '늘푸른', '하나', '미소', '바른', '열린', '중앙', '제일', '우리', '봄날', '해맑은', '건강한', '소망', '큰마음', '참좋은', '행복한', '다온', '한빛', '푸른숲'];
  var CLINIC_NAMES = ['맑은', '고운', '라온', '더고운', '결', '리즈', '루미', '온유', '담은', '유어스', '디어', '세움'];
  var DIST_NAMES = ['한결메디', '바른유통', '동방메디칼', '새길팜', '미래헬스', '청운메디', '해솔유통', '대한메디스'];
  var DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];

  var accounts = [];
  var nameUsed = {};
  function makeAccount(type) {
    var region = pickW(REGIONS, REGION_W);
    var district = pick(DISTRICTS[region]);
    var name, guard = 0;
    do {
      if (type === 'PHARM') name = pick(PHARM_NAMES) + '약국(' + district + ')';
      else if (type === 'CLINIC') name = pick(CLINIC_NAMES) + '피부과의원(' + district + ')';
      else name = pick(DIST_NAMES) + ' ' + region + '지점';
      guard++;
      if (guard > 6) name += ' ' + (guard - 5);
    } while (nameUsed[name]);
    nameUsed[name] = true;
    var cycle = type === 'PHARM' ? pickW([7, 14, 28], [10, 60, 30])
      : type === 'CLINIC' ? pickW([7, 14, 28], [10, 40, 50])
        : pickW([7, 14], [80, 20]);
    var d1 = randInt(1, 5), d2 = randInt(1, 5);
    var pref = chance(0.5) && d1 !== d2 ? [d1, d2].sort() : [d1];
    accounts.push({
      idx: accounts.length,
      id: 'AC-' + pad(accounts.length + 1, 4),
      name: name, type: type, region: region, district: district,
      cycleDays: cycle,
      cycleLabel: cycle === 7 ? '주 1회' : cycle === 14 ? '격주' : '월 1회',
      preferredDays: pref,
      preferredLabel: pref.map(function (x) { return DOW_KO[x]; }).join('·'),
      minShelfLifeRatio: 0.70
    });
  }
  var ai;
  for (ai = 0; ai < 190; ai++) makeAccount('PHARM');
  for (ai = 0; ai < 90; ai++) makeAccount('CLINIC');
  for (ai = 0; ai < 20; ai++) makeAccount('DIST');

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
      var nLive = live ? Math.max(0, Math.round(CAPACITY * rand(3.0, 3.9)) - n) : 0;
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
        var ch = pickW([0, 1, 2, 3], [0.32, 0.28, 0.22, 0.18]);
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
    var confusable = o.items.some(function (it) { return skus[it[0]].spec === 'STD' || skus[it[0]].spec === 'MINI'; });
    var pConf = confusable ? (sd < LOCATION_SPLIT_DAY ? 0.0016 : 0.00025) : 0;
    var pBase = 0.0011 * (o.overtimeShip ? 1.9 : 1);
    var r = rnd();
    if (r < pConf) { o.mis = true; o.misCause = '유사 SKU 혼동(본품·미니 인접 로케이션)'; }
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
  var B2B_W = {
    PHARM: { 'RJ-CR-STD': 25, 'RJ-SE-STD': 22, 'RJ-SN-STD': 15, 'RJ-LP-STD': 10, 'RJ-SC-STD': 10, 'RJ-MS-STD': 8, 'RJ-MS-MINI': 7, 'RJ-SN-MINI': 6, 'RJ-CR-MINI': 3, 'RJ-SE-MINI': 3, 'RJ-CR-LRG': 3 },
    CLINIC: { 'RJ-SE-STD': 25, 'RJ-CR-STD': 20, 'RJ-MS-STD': 20, 'RJ-CR-LRG': 10, 'RJ-SE-LRG': 10, 'RJ-SN-STD': 10, 'RJ-MS-MINI': 5, 'RJ-LP-LRG': 5, 'RJ-SC-STD': 4 },
    DIST: { 'RJ-CR-STD': 25, 'RJ-SE-STD': 25, 'RJ-MS-STD': 15, 'RJ-SN-STD': 15, 'RJ-LP-STD': 10, 'RJ-SC-STD': 10 }
  };
  var B2B_WARR = {};
  Object.keys(B2B_W).forEach(function (t) {
    B2B_WARR[t] = ALL_IDX.map(function (s) { return B2B_W[t][skus[s].id] || 0; });
  });
  function b2bQty(type, s) {
    if (type === 'DIST') return randInt(2, 10) * 30;
    if (skus[s].spec === 'MINI') return randInt(1, 5) * 10;
    if (type === 'CLINIC') return randInt(2, 10) * 6;
    return randInt(1, 5) * 6;
  }
  var b2b = [];
  (function generateB2B() {
    accounts.forEach(function (a) {
      var recv = bizOnOrAfter(randInt(0, a.cycleDays - 1));
      var seq = 0;
      while (recv <= END_DAY) {
        seq++;
        var leadMin = a.type === 'PHARM' ? 2 : a.type === 'CLINIC' ? 3 : 5;
        var leadMax = a.type === 'PHARM' ? 5 : a.type === 'CLINIC' ? 8 : 10;
        var req = addBiz(recv, randInt(leadMin, leadMax));
        for (var k = 0; k < 3; k++) {                       // 납품 희망 요일로 맞춤
          if (a.preferredDays.indexOf(dowOf(req)) >= 0) break;
          req = nextBiz(req);
        }
        var plan = Math.max(addBiz(req, -1), nextBiz(recv));
        var nLines = a.type === 'DIST' ? pickW([1, 2, 3], [0.4, 0.4, 0.2]) : pickW([1, 2], [0.7, 0.3]);
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
  var SLOW = ['RJ-MS-MINI', 'RJ-SN-MINI', 'RJ-LP-LRG'];
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
  var RISK_SE = sid('RJ-SE-STD');
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
  //  - PDRN 세럼 본품: 원료 수급 지연 (기준일 재고 약 7일분 → 품절 위험)
  var RISK_RULES = [
    { sku: RISK_SE, from: dayOf('2026-08-01'), coverDays: 7, factor: 1.0, restDay: dayOf('2026-10-19'), reason: '원료 수급 지연', budget: null }
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
    { sku: sid('RJ-MS-MINI'), from: dayOf('2026-06-01'), done: false },
    { sku: sid('RJ-SN-MINI'), from: dayOf('2026-07-01'), done: false }
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
    // 확정 B2B 발주(향후 21일)도 반영
    return Math.max(sum / 28, expDemand[s]);
  }

  var kitTotalByDay = [];
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
        b2bQueue.forEach(function (x) {
          if (x.waitUntil > d) { remain.push(x); return; }
          if (!x.attempted) {
            x.attempted = true;
            if (shipLog.overtime[d] && chance(0.5)) {
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
          // 총판 대량 발주는 출고 차량 적재 한도로 일부 분할 납품
          if (!x.ships.length && x.type === 'DIST' && x.qty >= 240 && chance(0.25)) {
            lim = Math.round(x.qty * 0.6 / 30) * 30; x.loadSplit = true;
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
              if (!x.delayReason) x.delayReason = '출고 차량 적재 한도(분할 납품)';
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
          var D = demandEstimate(s2, d);
          var pos = stock[s2] + pipeline[s2] - deficit[s2];
          if (pos < D * 34) placeInbound(s2, d, Math.max(300, Math.ceil(D * 45 / 100) * 100));
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

  /* ------------------------------------------------------------------
   * 12. 재고 상태 (기준일): 가용 / 보류 / 불량 / 반품 대기
   * ------------------------------------------------------------------ */
  var HOLD_LOTS = { 'RJ-SE-LRG': { qty: 240, reason: '품질 재검사(점도 편차)' }, 'RJ-CR-MINI': { qty: 120, reason: '라벨 인쇄 확인' } };
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
    CANCEL: { label: '주문 취소·변경 미반영', pattern: 'OMS ≠ WMS·ERP', action: 'WMS 출고 지시 취소 처리 후 OMS 재고 재동기화, 취소 주문 자동 회수 규칙 적용' },
    SETBOM: { label: '세트 구성품 차감 누락', pattern: 'ERP ≠ OMS·WMS', action: 'ERP 세트 BOM(구성품) 매핑 등록 후 누락분 구성품 차감 전표 발행' },
    RETURN: { label: '반품 입고 미처리', pattern: 'WMS·ERP < 실물', action: '반품 대기 구역 실물 확인 후 WMS 반품 입고 처리, 반품 D+1 처리 마감 규칙 적용' },
    INBOUND: { label: '입고 검수 수량 미반영', pattern: 'ERP ≠ OMS·WMS', action: 'ERP 입고 전표를 검수 수량 기준으로 정정, 검수 결과 연동 확인' },
    SCAN: { label: '출고 스캔 오류', pattern: 'WMS·ERP ≠ 실물', action: '해당 로케이션 부분 실사 후 WMS 수량 조정, 스캐너 이중 스캔 방지 설정' }
  };
  // 원인 조치(재발 방지) 이력
  var FIXES = [
    { day: dayOf('2026-06-30'), cause: 'SETBOM', set: 'RJ-SET-HOME', label: 'ERP 세트 BOM 매핑 — PDRN 홈케어 세트' },
    { day: dayOf('2026-08-31'), cause: 'SETBOM', set: 'RJ-SET-INT', label: 'ERP 세트 BOM 매핑 — PDRN 집중 세트' },
    { day: dayOf('2026-08-31'), cause: 'RETURN', set: null, label: '반품 입고 D+1 처리 마감 규칙' },
    { day: dayOf('2026-08-31'), cause: 'CANCEL', set: null, label: '오픈마켓 취소 주문 출고 지시 자동 회수' }
  ];
  // SKU별 원인 노출 (일 발생 확률)
  var exposures = [];   // {sku, cause, set, h}
  skus.forEach(function (k) {
    var vf = k.spec === 'STD' || k.isSet ? 1 : k.spec === 'LRG' ? 0.5 : 0.3;
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
  var ISSUE_SLA = { '오출고': 2, '출고 지연': 1, '파손': 3, '수량 차이': 3, '누락': 2 };
  var NEXT_ACTION = {
    '오출고': ['회수 송장 발행 및 정상품 재발송', '회수품 입고 확인 후 재고 반영'],
    '출고 지연': ['출고 예정일 회신(CS·영업)', '우선 출고 지시 및 송장 회신'],
    '파손': ['택배사 사고 접수 및 교환 발송', '택배사 보상 청구 진행 확인'],
    '수량 차이': ['실물·전산 수량 재확인', '거래명세서 정정 발행 또는 추가 출고'],
    '누락': ['누락 구성품 추가 발송', '세트 작업 지시서 재점검']
  };
  function addIssue(day, type, channel, cause, source, dept, ref) {
    if (day > END_DAY) return;
    var base = { '오출고': [1, 4], '출고 지연': [0, 2], '파손': [1, 6], '수량 차이': [1, 7], '누락': [1, 3] }[type];
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
    workLogs[m] = { month: m, stockUnitDays: 0, days: 0, inboundQty: 0, b2cShipped: 0, b2bShipments: 0, distShipments: 0,
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
      if (x.type === 'DIST') wl3.distShipments++;
      else { wl3.boxes[3]++; wl3.b2bParcels++; }
    });
  });
  /* 3PL 견적 단가표 (Rate Card)
   *  - 구간: 월 B2C 택배 출고 박스 수(합포장 후 박스 기준). B2B 택배는 같은 구간 단가를 적용하되 구간 산정에서 제외
   *  - 사이즈: 소형(극소·소 박스) / 중형(중 박스) / 대형(대 박스, B2B 약국·의원 택배 포함)
   *  - 일반 포장 단가 = 피킹·검수·포장 작업 + 박스·완충재 (박스 1개당)
   *  - 택배비 단가 = 택배 운임 (박스 1개당, 전국 동일)
   *  - 비교 견적 = 동일 물량 기준 타 3PL 2곳 견적 평균(가상), 단가 협상 기준선 */
  var RATE_CARD = {
    basis: '월 B2C 택배 출고 박스 수 (합포장 후 박스 기준)',
    excluded: 'B2B 택배(약국·의원)는 구간 산정에서 제외, 단가는 해당 월 구간 단가 적용',
    tiers: [
      { id: 'A', label: 'A구간', min: 0, max: 9000 },
      { id: 'B', label: 'B구간', min: 9001, max: 11000 },
      { id: 'C', label: 'C구간', min: 11001, max: 14000 },
      { id: 'D', label: 'D구간', min: 14001, max: null }
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
      { item: '총판 화물 운송비', unit: '건', price: 42000 }
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
    { key: 'freight', cat: '기타', item: '총판 화물 운송비', unit: '건', price: fixed(42000), actual: function (w) { return w.distShipments; } }
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
      stages: STAGES, causes: CAUSES, issueSla: ISSUE_SLA, minShelfLifeRatio: 0.70
    },
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
