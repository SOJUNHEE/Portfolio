/* =====================================================================
 * js/app.js — 다품종 다화주 3PL 운영 대시보드 화면 (개인 프로젝트)
 * 공통 계산은 metrics.js, 공통 표·위젯은 ui.js를 쓰고 여기에는 화면 구성만 둡니다.
 * ===================================================================== */
(function () {
  'use strict';
  var D = window.SCM_DATA, S = window.SCMMetrics, CH = window.SCMCharts, Fm = window.SCMExport.fmt, U = window.UI, W = U.W;
  var M = D.meta, Cal = D.cal, IT = D.IT, INDI = D.INDI;
  var section = U.section, panel = U.panel, chartBox = U.chartBox, stat = U.stat, statRow = U.statRow, table = U.table, summary = U.summary, goBtn = U.goBtn, b = U.b, hook = U.hook, fileName = U.fileName, nm = U.nm, ni = U.ni, mmdd = U.mmdd, sumOf = U.sumOf, F;

  var SCREENS = [
    { id: 'intro', no: '00', ko: '데모 소개', en: '현장 흐름 · 실제 경력과 연결 · 상품군 기준', group: '안내' },
    { id: 'overview', no: '01', ko: '종합 풀필먼트 현황', en: '입출고 · 재고 · 생산성 · 상품군 비교', group: '현황' },
    { id: 'inbound', no: '02', ko: '입고·검수·적치', en: '입고 예정 대조 · 상품군별 검수 · 적치', group: '입고·재고' },
    { id: 'stock', no: '03', ko: '재고·로케이션', en: '존별 적치율 · SKU 재고 · 실사 차이', group: '입고·재고' },
    { id: 'outbound', no: '04', ko: '피킹·패킹·출고', en: '로케이션 순 피킹리스트 · 패킹 · 택배 인계', group: '출고' },
    { id: 'labor', no: '05', ko: '인력·생산성', en: '공정별 UPH · 인력 배치 · 연장 · 동선 개선', group: '출고' },
    { id: 'returns', no: '06', ko: '반품', en: '회수 · 입고 검수 · 상품군별 판정', group: '반품·이슈' },
    { id: 'issues', no: '07', ko: '출고 이슈', en: '미출고 · 오출고 · 파손 · 재출고', group: '반품·이슈' },
    { id: 'settle', no: '08', ko: '물류비·정산 대조', en: '화주사별 월 정산 초안 vs 입고·출고·반품 실적', group: '정산' },
    { id: 'focus', no: '09', ko: '상품군별 현장 기준', en: '선택한 상품군의 작업 규칙과 전용 지표', group: '상품군' }
  ];

  var CAREER = [
    ['입고·적치', ['inbound'], 'FCL 컨테이너 입출고와 하역 인력 배치 (두잇로지스) · FCL 일정관리 (제이아이로지스)', '입고 예정과 실제 수량을 맞추고, 검수·적치 대기 없이 재고로 넘깁니다.'],
    ['재고 관리', ['stock'], '재고관리, 재고 정확도 99% (제이아이로지스) · 월간 재고 마감 (굿앤파트너스) · 신규 센터 WMS 초기 데이터 세팅 (두잇로지스)', '존별 적치율과 실사 차이를 원인까지 추적합니다.'],
    ['피킹·패킹·출고', ['outbound'], '피킹·패킹 작업관리, D2C 택배·B2B 대량 출고, 오출고율 월 1% 미만 (제이아이로지스) · B2C·B2B 출고 월 50,000건 이상 (굿앤파트너스)', '로케이션 순 피킹리스트, 검수, 택배 인계를 나눠 확인합니다.'],
    ['현장 인력·동선', ['labor'], '작업동선 개선, 현장 생산성 약 5% 향상, 불필요한 연장근로·인건비 약 10% 감소 (제이아이로지스) · 출고 피크타임 분석·생산성 모니터링 (굿앤파트너스)', '공정별 처리량으로 인력을 나누고, 피크일의 임시 인력·연장을 계획합니다.'],
    ['신규 센터·이슈 대응', ['issues'], '신규 센터 입출고 레이아웃 구성, 센터 보관 효율 약 28% 개선, 고객사 클레임 당일 처리율 약 95% (두잇로지스) · 약 15개 화주사 대응 (굿앤파트너스)', '이슈를 유형·귀책별로 기록해 재출고와 재발 방지로 연결합니다.']
  ];

  function fieldFlow() {
    var ib = S.inbound(F), ob = S.outbound(F), is = S.issues(F), stockU = sumOf(S.stockNow(F), function (r) { return r.good; });
    return U.steps([
      ['입고', Fm.int(ib.recv), '개', ib.n + '건 · 예정 대비 부족 ' + ib.short + '건'],
      ['검수', Fm.int(ib.good), '개', '불합격 ' + Fm.int(ib.ng) + '개'],
      ['적치', Fm.int(ib.put), '개', '평균 ' + (ib.avgLead === null ? '—' : Fm.num1(ib.avgLead)) + '일'],
      ['재고', Fm.int(stockU), '개', '기준일 판매 가능 실물'],
      ['피킹', Fm.int(ob.pickLines), '라인', '로트 배정 라인'],
      ['패킹', Fm.int(ob.ship), '건', '검수 오피킹 발견 ' + ob.caught + '건'],
      ['출고', Fm.int(ob.ship), '건', Fm.int(ob.shipUnits) + '개 · 택배 인계'],
      ['반품', Fm.int(is.rets.length), '건', '입고 완료 ' + is.retDone + '건']
    ], 's8');
  }
  function indBanner() {
    if (F.ind === 'ALL') return '';
    var x = INDI[F.ind];
    return '<div class="ind-banner"><b>' + U.esc(x.name) + '</b><span>검수 ' + U.esc(x.qc.join(' · ')) + '</span><span>보관 ' + U.esc(x.storage) + '</span><span>배정 ' + U.esc(x.pickRule) + '</span>' + goBtn('focus', '이 상품군 기준 보기') + '</div>';
  }
  function indPicker() { return '<div class="ind-pick" role="group" aria-label="상품군 바로 선택">' + D.inds.map(function (x) { return '<button type="button" data-set-ind="' + x.id + '">' + U.esc(x.name) + '</button>'; }).join('') + '</div>'; }

  var RENDER = {};
  RENDER.intro = function () {
    F = U.F();
    var h = section({ en: 'Field Flow', ko: '입고 → 검수 → 적치 → 재고 → 피킹 → 패킹 → 출고 → 반품', desc: '가상 물류센터 1곳이 5개 상품군의 가상 화주사를 함께 운영합니다. 상품군을 고르면 숫자와 화면이 그 화주사 기준으로 바뀌고, 검수 항목과 보관·출고 규칙도 달라집니다.', tools: goBtn('overview', '현황 보기 →'), body: fieldFlow() + indPicker() });
    h += section({
      en: 'Career Link', ko: '실제 경력과 화면',
      desc: '"직접 해 온 일"은 이력서·경력기술서 기준의 실제 경력입니다. 화면의 상품군 운영 사례는 그 경험을 바탕으로 만든 시뮬레이션이며, 모든 상품군에서 근무했다는 뜻이 아닙니다.',
      body: table('career', { columns: [{ label: '현장 업무', type: 'text', value: function (r) { return r[0]; }, cls: 'strong nowrap' }, { label: '화면', type: 'text', value: function (r) { return r[1].map(function (id) { return SCREENS.filter(function (s) { return s.id === id; })[0].ko; }).join(', '); }, html: function (r) { return r[1].map(function (id) { return goBtn(id); }).join(' '); } }, { label: '직접 해 온 일', type: 'text', value: function (r) { return r[2]; } }, { label: '데모에서 보여 주는 것 (설명)', type: 'text', value: function (r) { return r[3]; }, cls: 'wrap' }], rows: CAREER, filename: fileName('소개', '경력연결'), pageSize: 0, search: false })
    });
    h += section({ en: 'Industry Rules', ko: '상품군별 운영 기준', desc: '여러 업종 화주사를 한 센터에서 운영할 때 달라지는 기준입니다. 모두 학습용 가정이며 특정 회사의 기준이 아닙니다.', body: W.indRules() });
    h += section({ en: 'Scenarios', ko: '가상 운영 시나리오', desc: '출고 마감 13시, 공정별 표준 처리량, 인력 수, 출고 제한 기준은 데모 가정입니다.', body: table('scenarios', { columns: [{ label: '시나리오', type: 'text', value: function (r) { return r.title; }, cls: 'strong nowrap' }, { label: '기간', type: 'text', value: function (r) { return mmdd(r.from) + ' ~ ' + mmdd(r.to); }, cls: 'nowrap' }, { label: '설명', type: 'text', value: function (r) { return r.setup; } }], rows: D.scenarios, filename: fileName('소개', '시나리오'), pageSize: 0, search: false }) });
    return h;
  };

  RENDER.overview = function () {
    F = U.F();
    var k = S.commonKpis(F), ik = S.indKpis(F), ac = S.actions(F), rows = S.daily(F), lb = S.labor(F);
    /* 대시보드 개편(2026-11-10): 1행 = 공통 KPI(2칸) + 지금 확인할 일(1칸), 2행 = 주별 추세(2칸) + 인력 운영(1칸), 3행 = 상품군 비교.
       계산 함수와 값은 이전과 같고 배치만 바꿨다. */
    var todo = ac.length ? '<ul class="todo">' + ac.slice(0, 8).map(function (a) { return '<li><span class="pri p' + a.pri + '">' + (a.pri === 1 ? '긴급' : '확인') + '</span><span class="area">' + U.esc(a.area) + '</span><span class="what"><b>' + U.esc(a.what) + '</b><span>조치: ' + U.esc(a.act) + '</span></span>' + goBtn(a.go, '상세') + '</li>'; }).join('') + '</ul>' : '<div class="state-card empty">지금 확인할 항목이 없습니다.</div>';
    var h = '<div class="dash-grid">' +
      U.card({ cls: 'span-2', title: F.ind === 'ALL' ? '센터 공통 지표' : ni(F.ind) + ' 공통 지표', sub: '모든 상품군에 같은 기준으로 계산 · 소비기한·옵션·세트처럼 기준이 다른 지표는 합산하지 않고 상품군을 골랐을 때만 표시', body: '<div class="kpi-grid k3">' + k.map(U.kpiCard).join('') + '</div>' }) +
      U.card({ cls: 'todo-card', title: '지금 확인할 일', sub: ac.length ? '우선순위 순 · ' + Math.min(8, ac.length) + '건' + (ac.length > 8 ? ' / 전체 ' + ac.length + '건' : '') : '현재 필터 기준', body: todo }) +
      '</div>';
    if (ik.length) h += '<div class="dash-grid">' + U.card({ cls: 'span-3', title: ni(F.ind) + ' 현장 주목 지표', sub: '선택한 상품군에만 해당하는 전용 지표', go: 'focus', body: '<div class="kpi-grid k4">' + ik.map(U.kpiCard).join('') + '</div>' }) + '</div>';
    h += '<div class="dash-grid">' +
      U.card({ cls: 'span-2', title: '주별 주문 접수와 출고 확정', sub: '건 · 주별 · ' + Cal.isoOf(F.from) + ' ~ ' + Cal.isoOf(F.to), go: 'outbound', body: chartBox('chWeek', '', '주별 주문 접수와 출고 확정') }) +
      U.card({ title: '인력 운영', sub: '센터 공통 · 선택 기간 기준', go: 'labor', body: U.metricList([
        { icon: 'people', value: lb.head === null ? '—' : Fm.num1(lb.head), unit: '명', label: '기간 평균 투입 인원' },
        { icon: 'temp', value: Fm.int(lb.temps), unit: '인일', label: '임시 인력' },
        { icon: 'clock', value: Fm.num1(lb.otH), unit: '시간', label: '연장 근무' },
        { icon: 'calendar', value: Fm.int(F.days), unit: '일', label: '조회 기간' }
      ]) }) +
      '</div>';
    if (F.ind === 'ALL') {
      var cmp = D.inds.map(function (x) { var G = S.withPeriod(F, F.from, F.to); G.ind = x.id; var ob = S.outbound(G), ib = S.inbound(G), ct = S.counts(G), fl = S.flow(G), r = S.returnStats(G)[0]; return { id: x.id, name: x.name, ship: ob.ship, units: ob.shipUnits, inb: ib.good, same: fl.sameDayRate, acc: ct.rate, ret: r.rate, stock: D.stockDaily[F.to][x.id] }; });
      h += '<div class="dash-grid">' + U.card({ cls: 'span-3', title: '상품군 비교 (공통 지표만)', sub: '상품군 이름을 누르면 그 상품군 기준으로 전환', go: 'focus', body: table('compare', { columns: [{ label: '상품군', type: 'text', value: function (r) { return r.name; }, html: function (r) { return '<button type="button" class="link-btn" data-set-ind="' + r.id + '">' + U.esc(r.name) + '</button>'; } }, { label: '입고 수량', type: 'int', value: function (r) { return r.inb; } }, { label: '출고 건수', type: 'int', value: function (r) { return r.ship; } }, { label: '출고 수량', type: 'int', value: function (r) { return r.units; } }, { label: '당일 출고율', type: 'pct', value: function (r) { return r.same; } }, { label: '재고 정확도', type: 'pct', value: function (r) { return r.acc; } }, { label: '반품률', type: 'pct', value: function (r) { return r.ret; } }, { label: '기간 종료 재고', type: 'int', value: function (r) { return r.stock; } }], rows: cmp, filename: fileName('현황', '상품군비교'), pageSize: 0, search: false }) }) + '</div>';
    }
    hook(function () {
      var P = CH.palette(), bk = U.weekBuckets();
      function agg(f) { return bk.map(function (x) { return rows.filter(function (r) { return r.day >= x[0] && r.day <= x[1]; }).reduce(function (a, r) { return a + f(r); }, 0); }); }
      CH.render('chWeek', { type: 'bar', data: { labels: bk.map(function (x) { return mmdd(x[0]); }), datasets: [{ type: 'bar', label: '출고 확정(건)', data: agg(function (r) { return r.ship; }), backgroundColor: P.tone(0) }, { type: 'line', label: '주문 접수(건)', data: agg(function (r) { return r.received; }), borderColor: P.tone(1), backgroundColor: P.tone(1) }] }, options: { scales: CH.baseScales({ yFmt: U.intAxis() }), interaction: { mode: 'index', intersect: false } } });
    });
    return h;
  };

  RENDER.inbound = function () {
    F = U.F();
    var ib = S.inbound(F);
    var h = indBanner() + section({
      en: 'Inbound', ko: '입고 예정 대조와 검수',
      desc: '도착한 물량을 입고 예정과 맞추고 상품군별 항목으로 검수한 뒤 다음 영업일에 적치합니다. 적치가 끝나기 전 수량은 보류 재고로 두고, 식품은 라벨 확인으로 하루 더 보류합니다(가정).',
      body: statRow([stat('입고 건수', Fm.int(ib.n), '건', '예정 대비 부족 ' + ib.short + '건'), stat('입고 수량', Fm.int(ib.recv), '개', '예정 ' + Fm.int(ib.plan) + '개'), stat('검수 합격', Fm.int(ib.good), '개', ''), stat('검수 불합격', Fm.int(ib.ng), '개', '불량률 ' + Fm.pct(ib.ngRate, 2)), stat('평균 적치 소요', ib.avgLead === null ? '—' : Fm.num1(ib.avgLead), '일', '도착 → 적치')]) +
        table('receipts', { columns: [{ label: '입고번호', type: 'text', value: function (r) { return r.id; }, cls: 'nowrap' }, U.indCol(function (r) { return r.ind; }), { label: '상품', type: 'text', value: function (r) { return nm(r.item); } }, { label: '도착', type: 'date', value: function (r) { return r.arrive; } }, { label: '예정', type: 'int', value: function (r) { return r.plan; } }, { label: '입고', type: 'int', value: function (r) { return r.recv; } }, { label: '합격', type: 'int', value: function (r) { return r.ok; } }, { label: '불합격', type: 'int', value: function (r) { return r.ng; } }, { label: '적치', type: 'date', value: function (r) { return r.put; } }, { label: '로트', type: 'text', value: function (r) { return r.lot; }, cls: 'nowrap' }], rows: ib.list.slice().reverse(), filename: fileName('입고', '입고목록'), rowClass: function (r) { return r.recv < r.plan ? 'flag' : ''; }, searchHint: '상품·로트 검색' })
    });
    h += section({ en: 'QC Items', ko: '상품군별 검수 항목 불합격', desc: '같은 입고 검수라도 상품군마다 보는 항목이 다릅니다.', body: table('qc', { columns: [U.indCol(function (r) { return r.ind; }), { label: '검수 항목', type: 'text', value: function (r) { return r.item; }, cls: 'strong' }, { label: '불합격 수량', type: 'int', value: function (r) { return r.ng; } }], rows: ib.qc, filename: fileName('입고', '검수항목'), pageSize: 0, search: false }) });
    return h;
  };

  RENDER.stock = function () {
    F = U.F();
    var ct = S.counts(F), z = S.zones(F), sn = S.stockNow(F);
    var h = indBanner() + section({
      en: 'Zones', ko: '존별 적치율 (기준일)',
      desc: '상품군별로 존을 나눠 보관합니다. 적치율 = 실물 ÷ 존 수용량(가정). 식품은 상온·냉장 존이 따로 있습니다.',
      body: statRow([stat('재고 정확도', ct.rate === null ? '—' : (ct.rate * 100).toFixed(1), '%', ct.match + ' / ' + ct.n + ' (주간 실사)'), stat('실사 차이', Fm.int(ct.diffs.length), '건', '기간 내'), stat('가용 재고', Fm.int(sumOf(sn, function (r) { return r.avail; })), '개', '기준일'), stat('가용 제외', Fm.int(sumOf(sn, function (r) { return r.hold + r.limited + r.dmg; })), '개', '보류·제한·격리')]) +
        table('zones', { columns: [{ label: '존', type: 'text', value: function (r) { return r.name; }, cls: 'strong nowrap' }, U.indCol(function (r) { return r.ind; }), { label: 'SKU', type: 'int', value: function (r) { return r.skus; } }, { label: '로트', type: 'int', value: function (r) { return r.lots; } }, { label: '실물', type: 'int', value: function (r) { return r.units; } }, { label: '수용량(가정)', type: 'int', value: function (r) { return r.cap; } }, { label: '적치율', type: 'pct', value: function (r) { return r.util; } }], rows: z, filename: fileName('재고', '존별적치'), pageSize: 0, search: false, rowClass: function (r) { return r.util >= 0.85 ? 'flag' : ''; } })
    });
    h += section({ en: 'SKU', ko: 'SKU별 재고', desc: '재고는 화주사(상품군) 기준이라 채널과 관계없습니다. 가용 = 정상 로트 실물 − 출고 예약.', body: W.stockTable() });
    h += section({ en: 'Cycle Count', ko: '주간 실사 차이와 원인', desc: '매주 월요일 출고 전에 실물과 전산을 비교하고, 직전 실사 이후의 파손·출고·오출고 기록으로 원인을 확인한 뒤 맞춥니다.', body: W.countTable() });
    h += section({ en: 'Movements', ko: '입출고 이동 이력', body: W.moveTable() });
    h += summary([ct.diffs.length ? '<span class="flow-tag">원인</span>실사 차이 ' + b(ct.diffs.length + '건') + '은 파손 전산 미등록, 오출고, 출고 확정 전산 누락에서 나왔습니다. 오출고는 한 번에 두 SKU의 재고를 틀어지게 합니다.' : null, '<span class="flow-tag">조치 예시</span>파손은 발견 즉시 등록하고, 택배 인계 후 출고 확정이 빠진 송장이 없는지 마감 전에 확인합니다.']);
    return h;
  };

  RENDER.outbound = function () {
    F = U.F();
    var wd = S.waveDays(F), st = U.state;
    if (st.local.wave === null || wd.indexOf(st.local.wave) < 0) st.local.wave = wd.length ? wd[wd.length - 1] : null;
    var ob = S.outbound(F), rows = S.daily(F).filter(function (r) { return Cal.isBiz(r.day); });
    var h = indBanner() + section({
      en: 'Outbound', ko: '송장 발행 vs 출고 확정',
      desc: '송장은 피킹리스트와 함께 발행하고, 출고 확정은 검수·패킹 후 택배 인계 때 합니다. 패킹 능력(인력 기준, 가정)을 넘긴 주문은 다음 날 출고됩니다.',
      body: statRow([stat('송장 발행', Fm.int(ob.inv), '건', ''), stat('출고 확정', Fm.int(ob.ship), '건', Fm.int(ob.shipUnits) + '개'), stat('피킹 라인', Fm.int(ob.pickLines), '라인', ''), stat('검수 오피킹 발견', Fm.int(ob.caught), '건', '재피킹 후 출고'), stat('기간 종료 출고 대기', Fm.int(ob.backlog), '건', '')]) + panel('일별 출고와 패킹 능력', '건 · 영업일', chartBox('chDaily', 'tall', '일별 출고 확정, 출고 대기, 패킹 능력'))
    });
    hook(function () { var P = CH.palette(); CH.render('chDaily', { type: 'bar', data: { labels: rows.map(function (r) { return mmdd(r.day); }), datasets: [{ type: 'bar', label: '출고 확정(건)', data: rows.map(function (r) { return r.ship; }), backgroundColor: P.tone(0) }, { type: 'line', label: '출고 대기(건)', data: rows.map(function (r) { return r.backlog; }), borderColor: P.tone(2), backgroundColor: P.tone(2) }, { type: 'line', label: '패킹 능력(센터 전체, 가정)', data: rows.map(function (r) { return r.cap; }), borderColor: P.plan, borderDash: [4, 3], borderWidth: 1.5 }] }, options: { scales: CH.baseScales({ yFmt: U.intAxis() }), interaction: { mode: 'index', intersect: false } } }); });
    if (st.local.wave === null) return h + U.naBox('선택 기간에 영업일이 없습니다.');
    var pk = S.picking(F, st.local.wave);
    var sel = '<label class="wave-pick">피킹 일자 <select data-wave aria-label="피킹 일자">' + wd.slice().reverse().map(function (d) { return '<option value="' + d + '"' + (d === st.local.wave ? ' selected' : '') + '>' + Cal.isoOf(d) + ' (' + Cal.DOW_KO[Cal.dowOf(d)] + ')</option>'; }).join('') + '</select></label>';
    h += section({
      en: 'Picking List', ko: Cal.isoOf(pk.day) + ' 피킹리스트 (로케이션 순)', tools: sel,
      desc: '상품별 피킹 수량을 로케이션 순서로 묶어 이동 동선을 줄입니다. 기한 관리 상품은 FEFO, 그 외는 입고 순으로 로트를 배정합니다(학습용 기준). 세트는 구성품으로 풀어 피킹합니다.',
      body: statRow([stat('피킹 주문', Fm.int(pk.orders.length), '건', ''), stat('피킹 수량', Fm.int(pk.units), '개', pk.pick.length + '개 로트'), stat('당일 택배 인계', Fm.int(pk.shipped), '건', ''), stat('당일 송장 취소', Fm.int(pk.voided), '건', '포장 전 취소')]) +
        table('pick', { columns: [{ label: '로케이션', type: 'text', value: function (r) { return r.loc; }, cls: 'strong nowrap' }, { label: 'SKU', type: 'text', value: function (r) { return r.item; }, cls: 'nowrap' }, { label: '상품명', type: 'text', value: function (r) { return nm(r.item); } }, { label: '로트', type: 'text', value: function (r) { return r.lot; }, cls: 'nowrap' }, { label: '기한', type: 'text', value: function (r) { return r.exp === null ? '—' : Cal.isoOf(r.exp); }, cls: 'nowrap' }, { label: '피킹 수량', type: 'int', value: function (r) { return r.qty; } }, { label: '주문 수', type: 'int', value: function (r) { return r.orders; } }, { label: '취급', type: 'text', value: function (r) { return IT[r.item].fragile ? '파손 주의' : IT[r.item].cold ? '냉장' : '—'; }, cls: 'nowrap' }], rows: pk.pick, filename: fileName('피킹', '피킹리스트_' + Cal.isoOf(pk.day)), pageSize: 12, search: false }) +
        table('wave', { caption: '주문별 검수·송장·인계', columns: [{ label: '주문번호', type: 'text', value: function (r) { return r.o.id; }, cls: 'nowrap' }, U.indCol(function (r) { return r.o.ind; }), { label: '송장번호', type: 'text', value: function (r) { return r.o.inv; }, cls: 'nowrap' }, { label: '상품', type: 'text', value: function (r) { return U.linesTxt(r.o.lines); } }, { label: '검수 결과', type: 'text', value: function (r) { return r.o.inspect || '—'; }, cls: 'nowrap' }, U.statusCol('인계 상태', function (r) { return /취소|대기|다음/.test(r.status) ? 'warn' : 'ok'; }, function (r) { return r.status; })], rows: pk.rows, filename: fileName('피킹', '주문별인계_' + Cal.isoOf(pk.day)), pageSize: 8, searchHint: '주문번호·송장번호 검색' })
    });
    return h;
  };

  RENDER.labor = function () {
    F = U.F();
    var lb = S.labor(F), im = S.improve(F), days = lb.days.map(S.laborRow);
    var h = indBanner() + section({
      en: 'Productivity', ko: '공정별 처리량과 시간당 생산성(UPH)',
      desc: '인력은 센터 공통이고, 공정 표준 처리량은 가정입니다. ' + (F.ind === 'ALL' ? '' : '상품군을 고르면 그 상품군의 물량과, 물량 비중으로 나눈 투입 시간을 보여 줍니다. UPH는 센터 전체 값입니다.'),
      body: statRow([stat('평균 투입 인원', lb.head === null ? '—' : Fm.num1(lb.head), '명', '영업일 평균'), stat('임시 인력', Fm.int(lb.temps), '인일', ''), stat('연장', Fm.num1(lb.otH), '시간', ''), stat('시간 활용률', lb.util === null ? '—' : (lb.util * 100).toFixed(1), '%', '투입 시간 ÷ 가용 시간'), stat('피크 대응일', Fm.int(lb.peakDays.length), '일', '임시·연장 발생')]) +
        table('proc', { columns: [{ label: '공정', type: 'text', value: function (r) { return r.label; }, cls: 'strong nowrap' }, { label: '단위', type: 'text', value: function (r) { return r.unit; } }, { label: '물량', type: 'int', value: function (r) { return r.vol; } }, { label: '투입 시간', type: 'num1', value: function (r) { return r.hours; } }, { label: 'UPH', type: 'num1', value: function (r) { return r.uph; } }, { label: '표준 UPH(가정)', type: 'int', value: function (r) { return r.std; } }], rows: lb.proc, filename: fileName('인력', '공정별'), pageSize: 0, search: false }) + panel('일별 패킹 처리와 인력', '건 · 영업일', chartBox('chLabor', '', '일별 패킹 처리와 패킹 능력'))
    });
    hook(function () { var P = CH.palette(); CH.render('chLabor', { type: 'bar', data: { labels: days.map(function (r) { return mmdd(r.d); }), datasets: [{ type: 'bar', label: '패킹 처리(건)', data: days.map(function (r) { return r.shipped; }), backgroundColor: P.tone(0) }, { type: 'line', label: '패킹 능력(건)', data: days.map(function (r) { return r.cap; }), borderColor: P.tone(1), backgroundColor: P.tone(1), borderWidth: 1.5 }] }, options: { scales: CH.baseScales({ yFmt: U.intAxis() }), interaction: { mode: 'index', intersect: false } } }); });
    h += section({ en: 'Peak Days', ko: '피크 대응일 — 임시 인력·연장', body: table('peak', { columns: [{ label: '일자', type: 'date', value: function (r) { return r.d; }, cls: 'nowrap' }, { label: '계획 인원', type: 'int', value: function (r) { return r.plan; } }, { label: '실제 인원', type: 'int', value: function (r) { return r.act; } }, { label: '임시 인력', type: 'int', value: function (r) { return r.temps; } }, { label: '연장(시간)', type: 'int', value: function (r) { return r.otH; } }, { label: '패킹 능력', type: 'int', value: function (r) { return r.cap; } }, { label: '패킹 처리', type: 'int', value: function (r) { return r.shipped; } }], rows: lb.peakDays.map(S.laborRow).reverse(), filename: fileName('인력', '피크대응'), pageSize: 8, search: false, empty: '피크 대응일이 없습니다.' }) });
    h += section({ en: 'Layout', ko: '피킹 동선 재배치 전후 (가상 시나리오)', desc: '7/1부터 출고 빈도 높은 SKU를 가까운 로케이션으로 옮겼다고 가정한 시뮬레이션입니다. 실제 성과가 아닙니다.', body: table('pickUph', { columns: [{ label: '구분', type: 'text', value: function (r) { return r[0]; }, cls: 'strong' }, { label: '피킹 UPH', type: 'num1', value: function (r) { return r[1]; } }], rows: [['적용 전', im.before.pickUph], ['적용 후', im.after.pickUph]], filename: fileName('인력', '동선전후'), pageSize: 0, search: false }) });
    return h;
  };

  RENDER.returns = function () {
    F = U.F();
    var is = S.issues(F), rs = S.returnStats(F);
    var h = indBanner() + section({
      en: 'Returns', ko: '반품 판정 — 상품군마다 기준이 다릅니다',
      desc: '식품은 재판매하지 않고, 의류는 재판매·수선·폐기로 나누며, 가전은 불량을 격리합니다(학습용 기준). 재판매 가능만 판매 가능 재고로 돌아가고, 반품 번호당 한 번만 재고에 반영합니다.',
      body: statRow([stat('반품 요청', Fm.int(is.rets.length), '건', ''), stat('입고 완료', Fm.int(is.retDone), '건', '')].concat(Object.keys(is.grades).slice(0, 3).map(function (g) { return stat(g, Fm.int(is.grades[g]), '건', ''); }))) +
        table('retInd', { columns: [U.indCol(function (r) { return r.ind; }), { label: '출고', type: 'int', value: function (r) { return r.ship; } }, { label: '반품', type: 'int', value: function (r) { return r.rets; } }, { label: '반품률', type: 'pct', value: function (r) { return r.rate; } }, { label: '입고 완료', type: 'int', value: function (r) { return r.done; } }, { label: '재판매 가능', type: 'int', value: function (r) { return r.resale; } }, { label: '재판매 전환율', type: 'pct', value: function (r) { return r.resaleRate; } }], rows: rs, filename: fileName('반품', '상품군별'), pageSize: 0, search: false })
    });
    h += section({ en: 'Return List', ko: '반품 목록', body: W.returns() });
    return h;
  };

  RENDER.issues = function () {
    F = U.F();
    var is = S.issues(F), il = W.issueList(), by = {};
    is.late.forEach(function (o) { by[o.lateCause] = (by[o.lateCause] || 0) + 1; });
    var cs = Object.keys(by).map(function (k) { return { k: k, n: by[k] }; }).sort(function (a, c) { return c.n - a.n; });
    var h = indBanner() + section({
      en: 'Issues', ko: '출고 이슈 처리', tools: il.tools,
      desc: '오출고·배송 중 파손은 원주문에 연결된 재출고로 처리하고, 재출고는 새 주문으로 세지 않습니다.',
      body: statRow([stat('미출고 (기한 초과)', Fm.int(is.late.length), '건', ''), stat('오출고', Fm.int(is.by['오출고'] || 0), '건', '재출고'), stat('배송 지연', Fm.int(is.by['배송 지연'] || 0), '건', ''), stat('파손', Fm.int((is.by['배송 중 파손'] || 0) + is.whDmg.length), '건', '배송 중 ' + (is.by['배송 중 파손'] || 0) + ' · 창고 ' + is.whDmg.length), stat('재출고 처리율', is.reRate === null ? '—' : (is.reRate * 100).toFixed(1), '%', is.reOk + ' / ' + is.reships.length)]) + il.body
    });
    h += section({ en: 'Late', ko: '미출고 — 출고 기한을 넘긴 주문', body: W.late() });
    h += section({ en: 'Late Causes', ko: '미출고 원인', body: panel('원인별 미출고', '건', chartBox('chLate', '', '미출고 원인')) });
    U.hbar('chLate', cs.map(function (x) { return x.k; }), '미출고(건)', cs.map(function (x) { return x.n; }));
    h += summary([cs.length ? '<span class="flow-tag">미출고</span>' + cs.map(function (x) { return U.esc(x.k) + ' ' + b(Fm.int(x.n) + '건'); }).join(' · ') + '.' : '<span class="flow-tag">미출고</span>선택 기간에 기한을 넘긴 주문이 없습니다.', '<span class="flow-tag">조치 예시</span>행사·연휴 다음 날은 전날 대기 건수를 현장과 공유해 인력을 미리 배치합니다.']);
    return h;
  };

  var CAUSE_ACT = { '송장 발행 후 취소 건 청구': '취소 송장 목록을 붙여 해당 수량 차감', '센터 귀책 재출고 청구': '귀책 기록을 붙여 청구에서 제외', '계약 단가 오적용': '계약 단가로 다시 계산', '보관 수량 과다 산정': '일별 재고 기록으로 파렛트 수 재산정', '근거 없는 수량 차이': '원자료 확인' };
  RENDER.settle = function () {
    F = U.F();
    var st = S.settlement(F), bad = S.integrity(F).filter(function (c) { return !c.info; }).reduce(function (a, c) { return a + c.n; }, 0);
    var h = indBanner() + section({
      en: 'Monthly Closing', ko: '화주사별 월 정산 대조',
      desc: '월 정산 초안(가상)의 항목마다 입고·출고·반품 기록으로 수량을 다시 세고 계약 단가(가정)를 곱해 비교합니다. 원인은 초안의 비고가 아니라 송장 취소·재출고 귀책·단가 기록으로 판정합니다. 3PL 쪽에서 화주사별 정산을 마감하던 실무 흐름을 데이터로 옮긴 시뮬레이션입니다.',
      body: U.steps([['실적 재계산', Fm.wonShort(st.actual), '', st.months.length + '개월 · ' + st.rows.length + '항목'], ['초안 비교', Fm.wonShort(st.billed), '', '정산 초안 합계'], ['차이 발견', Fm.int(st.diffs.length), '줄', Fm.signed(st.diff) + '원'], ['원인 분류', Fm.int(st.causes.length), '유형', st.causes.map(function (c) { return c.cause; }).join(' · ') || '해당 없음'], ['검증 결과', Fm.int(st.evidence.length), '건', '수정 근거 · 정합성 이상 ' + bad + '건']])
    });
    h += section({ en: 'Differences', ko: '차이 항목과 판정 근거', body: table('setDiff', { columns: [{ label: '월', type: 'text', value: function (r) { return r.month.replace('-', '.'); }, cls: 'nowrap' }, U.indCol(function (r) { return r.ind; }), { label: '항목', type: 'text', value: function (r) { return r.label; }, cls: 'nowrap' }, { label: '실적 수량', type: 'int', value: function (r) { return r.qty; } }, { label: '초안 수량', type: 'int', value: function (r) { return r.billQty; } }, { label: '차이(원)', type: 'signed', value: function (r) { return r.diff; } }, { label: '원인', type: 'text', value: function (r) { return r.cause; }, cls: 'strong' }, { label: '판정 근거', type: 'text', value: function (r) { return r.basis; } }], rows: st.diffs, filename: fileName('정산', '차이항목'), pageSize: 0, empty: '선택 기간에 정산 차이가 없습니다.', search: false }) +
      table('setCause', { caption: '원인별 합계', columns: [{ label: '원인', type: 'text', value: function (r) { return r.cause; }, cls: 'strong' }, { label: '월', type: 'text', value: function (r) { return r.months.map(function (m) { return m.replace('-', '.'); }).join(', '); }, cls: 'nowrap' }, { label: '차이 금액(원)', type: 'signed', value: function (r) { return r.amount; } }, { label: '조치', type: 'text', value: function (r) { return CAUSE_ACT[r.cause]; } }], rows: st.causes, filename: fileName('정산', '원인별'), pageSize: 0, search: false, empty: '분류할 차이가 없습니다.' }) +
      table('setEv', { caption: '수정 근거', columns: [{ label: '월', type: 'text', value: function (r) { return r.month.replace('-', '.'); }, cls: 'nowrap' }, U.indCol(function (r) { return r.ind; }), { label: '근거', type: 'text', value: function (r) { return r.ref; }, cls: 'nowrap' }, { label: '내용', type: 'text', value: function (r) { return r.detail; } }, { label: '금액(원)', type: 'won', value: function (r) { return r.amount; } }], rows: st.evidence, filename: fileName('정산', '수정근거'), pageSize: 8, searchHint: '주문번호·원인 검색', empty: '수정 근거가 없습니다.' }) });
    h += section({ en: 'Monthly', ko: '월별 실적 vs 초안', body: panel('월별 정산 금액', '원', chartBox('chSet', '', '월별 실적과 초안')) });
    hook(function () { var P = CH.palette(); CH.render('chSet', { type: 'bar', data: { labels: st.monthly.map(function (m) { return m.month.replace('-', '.'); }), datasets: [{ label: '실적 기준', data: st.monthly.map(function (m) { return m.actual; }), backgroundColor: P.tone(0) }, { label: '정산 초안', data: st.monthly.map(function (m) { return m.billed; }), backgroundColor: P.tone(1) }] }, options: { scales: CH.baseScales({ yFmt: U.wonAxis() }), interaction: { mode: 'index', intersect: false } } }); });
    h += section({ en: 'Statement', ko: '항목별 대조표', body: table('setRows', { columns: [{ label: '월', type: 'text', value: function (r) { return r.month.replace('-', '.'); }, cls: 'nowrap' }, U.indCol(function (r) { return r.ind; }), { label: '항목', type: 'text', value: function (r) { return r.label; } }, { label: '단위', type: 'text', value: function (r) { return r.unit; } }, { label: '실적 수량', type: 'int', value: function (r) { return r.qty; } }, { label: '단가', type: 'won', value: function (r) { return r.rate; } }, { label: '실적 금액(원)', type: 'won', value: function (r) { return r.actual; } }, { label: '초안 금액(원)', type: 'won', value: function (r) { return r.billed; } }, { label: '차이(원)', type: 'signed', value: function (r) { return r.diff; } }], rows: st.rows, filename: fileName('정산', '대조표'), rowClass: function (r) { return r.diff ? 'flag' : ''; }, searchHint: '월·상품군·항목 검색' }) });
    return h;
  };

  /* 상품군별 현장 기준 */
  var FOCUS = {
    BEA: { why: '로트 추적, 세트 구성, 누액 방지가 핵심입니다.', pts: ['입고 때 라벨·옵션·로트 표기를 확인', '사용기한이 가까운 로트부터 배정', '세트는 구성품 재고로 조립 가능 수를 먼저 계산', '행사 전 세트 물량을 미리 조립·적치'] },
    FOD: { why: '소비기한과 보관 조건이 출고 순서를 결정합니다.', pts: ['소비기한·한글 표시사항 라벨을 입고에서 확인', 'FEFO 배정과 잔여 기한 60일 출고 제한(학습용)', '상온·냉장 존 분리', '유리병 상품 완충 포장'] },
    FSH: { why: '색상·사이즈 옵션과 반품 재판매가 재고 정확도를 좌우합니다.', pts: ['색상·사이즈 옵션별 피킹', '시즌별 구역 보관', '반품은 재판매·수선·폐기로 판정', '지난 시즌 장기 재고 확인'] },
    HOM: { why: '다품종 합포와 파손·불량 분리가 핵심입니다.', pts: ['모델명·외관·구성품 입고 검수', '대형·소형 로케이션 구분', '파손 주의 상품 합포 기준', 'B2C·B2B 출고 일정 분리'] },
    GFT: { why: '옵션과 구성품, 출고 전 최종 검수가 핵심입니다.', pts: ['길이·호수 옵션 재확인', '상자·카드 구성품 재고 관리', '출고 전 최종 검수', '반품 상태 확인 후 재포장'] }
  };
  RENDER.focus = function () {
    F = U.F();
    if (F.ind === 'ALL') return section({ en: 'Select Industry', ko: '상품군을 선택하세요', desc: '상단 상품군 필터나 아래 버튼으로 고르면 해당 상품군의 작업 규칙과 전용 지표가 나타납니다.', body: indPicker() + W.indRules() });
    var x = INDI[F.ind], fc = FOCUS[F.ind], ik = S.indKpis(F);
    var h = section({ en: 'Field Rules', ko: x.name + ' 현장 기준', desc: fc.why + ' 가상 화주사 기준의 학습용 시뮬레이션입니다.' + (x.real === '시뮬레이션' ? ' 이 상품군의 작업 기준은 개인 시뮬레이션용 가정값입니다.' : ' 실제 경력 연결: ' + U.esc(x.real) + '.'), body: '<div class="grid-2">' + panel('작업 기준', '', '<ul class="plain-list">' + fc.pts.map(function (p) { return '<li>' + U.esc(p) + '</li>'; }).join('') + '</ul>') + panel('기준 요약', '', '<ul class="plain-list"><li>검수: ' + U.esc(x.qc.join(' · ')) + '</li><li>보관: ' + U.esc(x.storage) + '</li><li>배정: ' + U.esc(x.pickRule) + '</li><li>포장: ' + U.esc(x.packNote) + '</li><li>반품 판정: ' + U.esc(x.retGrades.join(' · ')) + '</li></ul>') + '</div>' });
    h += section({ en: 'Focus KPI', ko: x.name + ' 전용 지표', body: '<div class="kpi-grid k4">' + ik.map(U.kpiCard).join('') + '</div>' });
    if (F.ind === 'BEA' || F.ind === 'FOD') h += section({ en: 'Lot · Expiry', ko: F.ind === 'FOD' ? '소비기한별 재고 · FEFO' : '사용기한·로트 재고', desc: '이 기준과 FEFO 배정 방식은 학습용 시뮬레이션이며 실제 회사의 운영 기준이 아닙니다.', body: W.expiry('F') });
    if (F.ind === 'BEA' || F.ind === 'GFT') h += section({ en: 'Sets', ko: '세트 구성과 조립 가능 수', desc: '세트는 구성품으로 풀어 재고를 차감합니다. 조립 가능 수는 가장 적은 구성품이 정합니다.', body: W.sets() });
    if (F.ind === 'FSH') h += section({ en: 'Option Matrix', ko: '색상·사이즈별 재고', desc: '0이 있는 스타일은 강조됩니다.', body: W.matrix() }) + section({ en: 'Aging', ko: '장기 재고 (입고 90일 경과)', body: W.aging(90) });
    if (F.ind === 'HOM' || F.ind === 'GFT') h += section({ en: 'By Item', ko: F.ind === 'HOM' ? '품목별 출고·오출고·불량' : '옵션 상품별 출고', body: W.byItem() });
    return h;
  };

  U.start({ screens: SCREENS, render: RENDER, prefix: 'OPS', title: '다품종 3PL 운영 대시보드' });
})();
