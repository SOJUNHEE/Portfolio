/* =====================================================================
 * js/app.js — 화면 전환, 필터, 렌더링 (Fashion 3PL Control Tower)
 * ---------------------------------------------------------------------
 * - 모든 수치는 metrics.js 함수 결과를 그대로 사용합니다(화면에서 따로 계산하지 않음).
 * - 표는 하나의 열 정의로 화면·검색·페이지·CSV를 함께 만듭니다(export.js).
 * - 요약 문장은 현재 필터의 계산 결과로 매번 다시 씁니다.
 * ===================================================================== */
(function () {
  'use strict';
  var D = window.SCM_DATA, S = window.SCMMetrics, CH = window.SCMCharts, X = window.SCMExport, Fm = X.fmt;
  var M = D.meta, Cal = D.cal, END = M.END_DAY;
  var BR = {};
  D.brands.forEach(function (b) { BR[b.id] = b; });

  var DEFAULT_FILTER = { period: '90d', from: null, to: null, brand: 'ALL', type: 'ALL' };
  var state = { screen: 'overview', filter: JSON.parse(JSON.stringify(DEFAULT_FILTER)), tables: {}, local: { issueOpen: false, reportDay: null, matrixStyle: null, stockFilter: 'ALL' } };
  var exportsReg = {}, tableReg = {}, hooks = [];
  var F = null;

  var SCREENS = [
    { id: 'intro', no: '00', ko: '데모 소개', en: '구성 · 데이터 기준 · 시나리오', group: '안내' },
    { id: 'overview', no: '01', ko: '운영 종합 현황', en: '오늘 출고 진행 · 표준 KPI · 우선 처리', group: '운영 현황' },
    { id: 'clients', no: '02', ko: '화주사 관리', en: '계약 조건 · 화주사별 SLA · 물량', group: '운영 현황' },
    { id: 'inbound', no: '03', ko: '입고·검수·적치', en: '입고 예정 대비 수량 · 불량 · 적치', group: '입고·재고' },
    { id: 'inventory', no: '04', ko: 'SKU·재고·로케이션', en: '색상·사이즈 재고 · 결품 · 실사', group: '입고·재고' },
    { id: 'space', no: '05', ko: '공간·적치율·시즌 재고', en: '존별 적치율 · SS/FW 재고 구성', group: '입고·재고' },
    { id: 'b2c', no: '06', ko: 'B2C 주문·출고', en: '주문 접수 · 출고 · SLA 지연 원인', group: '출고' },
    { id: 'b2b', no: '07', ko: 'B2B 납품·출고 일정', en: '납기 · 충족률 · 납품 일정', group: '출고' },
    { id: 'returns', no: '08', ko: '반품·교환', en: '도착 · 검수 대기 · 처리 시간', group: '출고' },
    { id: 'labor', no: '09', ko: '인력·생산성', en: '계획 대비 실제 인원 · 필요 시간 · 생산성', group: '관리' },
    { id: 'billing', no: '10', ko: '3PL 물류비·정산', en: '단가표 · 월 청구 대조 · 정산 차이', group: '관리' },
    { id: 'issues', no: '11', ko: '운영 이슈·보고서', en: '이슈 로그 · 일일 운영 보고서', group: '관리' }
  ];
  var ALIAS = { sla: 'b2c' };
  var RENDER = {};

  /* ------------------------------------------------------------------
   * 공통 도우미
   * ------------------------------------------------------------------ */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function scr(id) { id = ALIAS[id] || id; return SCREENS.filter(function (s) { return s.id === id; })[0]; }
  function brandName(id) { return BR[id] ? BR[id].name : id; }
  function brandLabel(id) { return BR[id] ? BR[id].name + ' (' + BR[id].cat + ')' : id; }
  function skuName(i) { return D.skus[i].name; }
  function statusHtml(st, label) {
    if (!st) return '<span class="status none">' + esc(label || '해당 없음') + '</span>';
    return '<span class="status ' + st + '">' + esc(label || Fm.statusLabel(st)) + '</span>';
  }
  function section(o) {
    return '<section class="section"' + (o.id ? ' id="' + o.id + '"' : '') + '>' +
      '<div class="section-head"><div>' + (o.en ? '<span class="eyebrow">' + esc(o.en) + '</span>' : '') +
      '<h2>' + esc(o.ko) + '</h2>' + (o.desc ? '<p class="section-desc">' + o.desc + '</p>' : '') + '</div>' +
      (o.tools ? '<div class="section-tools">' + o.tools + '</div>' : '') + '</div>' + o.body + '</section>';
  }
  function panel(title, sub, body, tools) {
    return '<div class="panel"><div class="panel-head"><div><div class="panel-title">' + esc(title) + '</div>' +
      (sub ? '<div class="panel-sub">' + sub + '</div>' : '') + '</div>' + (tools || '') + '</div>' + body + '</div>';
  }
  function chartBox(id, cls, label) {
    return '<div class="chart-box ' + (cls || '') + '"><canvas id="' + id + '" role="img" aria-label="' + esc(label || '차트') + '"></canvas></div>';
  }
  function stat(label, value, unit, sub) {
    return '<div class="stat"><div class="stat-label">' + esc(label) + '</div><div class="stat-value">' + value +
      (unit ? '<small>' + esc(unit) + '</small>' : '') + '</div>' + (sub ? '<div class="stat-sub">' + sub + '</div>' : '') + '</div>';
  }
  function statRow(items) { return '<div class="stat-row">' + items.join('') + '</div>'; }
  function naBox(text) { return '<div class="na-box">' + esc(text) + '</div>'; }
  function hook(fn) { hooks.push(fn); }
  function runHooks() { var h = hooks; hooks = []; h.forEach(function (fn) { fn(); }); }
  function fileName(screenKo, name) {
    return ('3PL_' + screenKo + '_' + name + '_' + Cal.isoOf(F.from) + '_' + Cal.isoOf(F.to) + '.csv').replace(/[\\/:*?"<>|·\s]+/g, '_');
  }
  function mmdd(d) { return Cal.isoOf(d).slice(5).replace('-', '/'); }
  function hhmm(t) { if (t === null || t === undefined) return '—'; return ('0' + Math.floor(t / 60)).slice(-2) + ':' + ('0' + (t % 60)).slice(-2); }
  function pct(v, d) { return Fm.pct(v, d); }
  function b(x) { return '<b>' + x + '</b>'; }
  function goBtn(id, label) { var s = scr(id); return '<button type="button" class="link-btn" data-go="' + s.id + '">' + esc(label || s.no + ' ' + s.ko) + '</button>'; }
  function summary(items) {
    var list = items.filter(Boolean);
    if (!list.length) list = ['선택한 필터 조건에 해당하는 데이터가 부족해 해석을 생략합니다.'];
    return '<section class="summary" aria-label="가상 시나리오 기준 요약"><span class="eyebrow">Analysis · Sample Data</span><h2>가상 시나리오 기준 요약</h2><ol>' +
      list.map(function (t) { return '<li><span>' + t + '</span></li>'; }).join('') + '</ol></section>';
  }
  function scopeNote(txt) { return '<span class="tag">' + esc(txt) + '</span>'; }
  function dlIcon() {
    return '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1v7M3 5l3 3 3-3M1.5 10.5h9" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
  }
  function brandCol() { return { label: '화주사', type: 'text', value: function (r) { return brandName(r.brand); }, cls: 'nowrap' }; }
  function statusCol(label, fn, textFn) {
    return { label: label, type: 'text', value: function (r) { return textFn ? textFn(r) : fn(r) ? Fm.statusLabel(fn(r)) : '해당 없음'; }, html: function (r) { return statusHtml(fn(r), textFn ? textFn(r) : null); } };
  }

  /* 표: 검색 + 페이지 + CSV (columns = [{label, value(row), type, html(row)?, cls?}]) */
  var NUMERIC = { int: 1, num1: 1, pct: 1, pct2: 1, won: 1, signed: 1, hours: 1 };
  var LONG_COL = /(내용|사유|비고|원인|조치|메모|대상$|영향|설명|이슈)/;
  function table(key, cfg) {
    tableReg[key] = cfg;
    state.tables[key] = state.tables[key] || { q: '', page: 0 };
    exportsReg[key] = { filename: cfg.filename, columns: cfg.columns, rows: function () { return filteredRows(key); } };
    var ts = state.tables[key];
    var h = '<div class="table-block" data-table="' + key + '">';
    h += '<div class="table-tools"><span class="t-count">' + (cfg.caption ? esc(cfg.caption) + ' · ' : '') + '<span data-count="' + key + '"></span></span><span class="t-right">' +
      (cfg.search === false ? '' : '<input type="search" class="t-search" data-search="' + key + '" placeholder="' + esc(cfg.searchHint || '표 안에서 검색 (SKU·화주사·상태 등)') + '" aria-label="표 검색" value="' + esc(ts.q) + '">') +
      '<button type="button" class="btn" data-export="' + key + '">' + dlIcon() + 'CSV 내보내기</button></span></div>';
    h += '<div data-tbody="' + key + '">' + tableBody(key) + '</div></div>';
    return h;
  }
  function rowText(cfg, r) { return cfg.columns.map(function (c) { return X.display(c, r); }).join(' ').toLowerCase(); }
  function filteredRows(key) {
    var cfg = tableReg[key], q = (state.tables[key].q || '').trim().toLowerCase();
    if (!q) return cfg.rows;
    var terms = q.split(/\s+/);
    return cfg.rows.filter(function (r) { var t = rowText(cfg, r); return terms.every(function (x) { return t.indexOf(x) >= 0; }); });
  }
  function tableBody(key) {
    var cfg = tableReg[key], cols = cfg.columns, rows = filteredRows(key), ts = state.tables[key];
    var size = cfg.pageSize || 15, pages = Math.max(1, Math.ceil(rows.length / size));
    if (ts.page >= pages) ts.page = pages - 1;
    var shown = cfg.pageSize === 0 ? rows : rows.slice(ts.page * size, ts.page * size + size);
    var h = '<div class="table-wrap' + (cfg.scroll ? ' table-scroll' : '') + '"><table class="data"><thead><tr>';
    cols.forEach(function (c) { h += '<th class="' + (NUMERIC[c.type] ? 'r' : '') + '" scope="col">' + esc(c.label) + '</th>'; });
    h += '</tr></thead><tbody>';
    if (!shown.length) h += '<tr><td colspan="' + cols.length + '" class="muted c">' + esc(ts.q ? '검색 결과가 없습니다.' : (cfg.empty || '해당 기간에 데이터가 없습니다.')) + '</td></tr>';
    shown.forEach(function (r) {
      var rc = cfg.rowClass ? cfg.rowClass(r) : '';
      h += '<tr' + (rc ? ' class="' + rc + '"' : '') + '>';
      cols.forEach(function (c) {
        var cls = (NUMERIC[c.type] ? 'r ' : '') + (c.cls || '') + (LONG_COL.test(c.label) ? ' wrap' : '');
        h += '<td class="' + cls + '">' + (c.html ? c.html(r) : esc(X.display(c, r))) + '</td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    if (cfg.pageSize !== 0 && pages > 1) {
      h += '<div class="pager"><span>' + (ts.page * size + 1) + '–' + Math.min(rows.length, ts.page * size + size) + ' / ' + Fm.int(rows.length) + '건</span>' +
        '<button type="button" data-page="' + key + '" data-dir="-1"' + (ts.page === 0 ? ' disabled' : '') + ' aria-label="이전 페이지">이전</button>' +
        '<span>' + (ts.page + 1) + ' / ' + pages + '</span>' +
        '<button type="button" data-page="' + key + '" data-dir="1"' + (ts.page >= pages - 1 ? ' disabled' : '') + ' aria-label="다음 페이지">다음</button></div>';
    }
    h += '<span hidden data-total="' + key + '">' + rows.length + '</span>';
    return h;
  }
  function refreshTable(key) {
    var el = document.querySelector('[data-tbody="' + key + '"]');
    if (el) el.innerHTML = tableBody(key);
    updateCount(key);
  }
  function updateCount(key) {
    var c = document.querySelector('[data-count="' + key + '"]');
    if (!c) return;
    var n = filteredRows(key).length, all = tableReg[key].rows.length;
    c.innerHTML = '<b class="num">' + Fm.int(n) + '</b>건' + (n !== all ? ' (전체 ' + Fm.int(all) + '건 중 검색 결과)' : '');
  }

  /* ------------------------------------------------------------------
   * 차트 도우미
   * ------------------------------------------------------------------ */
  function weekBuckets() {
    var out = [], d = F.from;
    while (d <= F.to) { var w = Cal.dowOf(d), e = Math.min(F.to, d + ((7 - w) % 7)); out.push([d, e]); d = e + 1; }
    return out;
  }
  function useWeeks() { return F.days > 45; }
  function bucketLabel(bk) { return mmdd(bk[0]); }
  function pctAxis() { return function (v) { return Math.round(v * 100) + '%'; }; }
  function intAxis() { return function (v) { return Fm.int(v); }; }

  /* ==================================================================
   * 00 데모 소개
   * ================================================================== */
  RENDER.intro = function () {
    var h = '<div class="demo-flag"><span class="sample-badge">SAMPLE DATA</span><span>개인 학습·포트폴리오 목적으로 설계한 시연용 시스템입니다. 화주사·상품·주문·재고·인력·단가·청구 금액은 모두 가상 데이터이며, 실제 물류센터의 운영 성과를 검증한 것이 아닙니다.</span></div>';
    h += section({
      en: 'Why', ko: '이 대시보드가 다루는 운영 문제',
      desc: '물류센터(3PL·풀필먼트) 현장에서 입출고·재고·작업관리·화주사 정산을 해 온 경험을 바탕으로, 패션 다화주 센터에서 자주 생기는 문제를 화면 단위로 나눴습니다.',
      body: table('problems', {
        columns: [
          { label: '운영 문제', type: 'text', value: function (r) { return r[0]; }, cls: 'strong' },
          { label: '대시보드에서 확인하는 방법', type: 'text', value: function (r) { return r[1]; } },
          { label: '화면', type: 'text', value: function (r) { return r[2].map(function (id) { return scr(id).no + ' ' + scr(id).ko; }).join(', '); }, html: function (r) { return r[2].map(function (id) { return goBtn(id); }).join(' · '); } }
        ],
        rows: [
          ['화주사마다 출고 마감 시각·SLA가 달라 센터 전체 현황을 동시에 보기 어렵다', '화주사별 계약 조건(마감 시각·SLA 목표·B2B 납기)을 한 표에 두고, 같은 기준으로 SLA·진행률을 계산', ['clients', 'overview']],
          ['B2C·B2B 물량이 몰리면 인력·공간·출고 일정에 병목이 생긴다', '일별 필요 작업 시간과 실제 투입 시간, 존별 적치율, B2B 납기 일정을 함께 표시', ['labor', 'space', 'b2b']],
          ['재고·출고·반품·정산 데이터가 따로 있으면 원인 분석과 대응이 늦어진다', '같은 가상 데이터(주문·재고·반품·작업 기록)에서 지연 원인, 결품, 반품 대기, 청구 차이를 계산하고 이슈 로그로 연결', ['b2c', 'inventory', 'returns', 'billing', 'issues']]
        ],
        filename: fileName('소개', '운영문제'), pageSize: 0, search: false
      })
    });
    h += section({
      en: 'Scenarios', ko: '가상 운영 시나리오',
      desc: '시뮬레이션은 하루씩 입고 → 적치 → B2C·B2B 출고 → 반품 처리 → 재고 반영을 계산합니다. 아래 시나리오는 그 계산에 들어간 조건이며, 결과 수치는 각 화면에서 확인할 수 있습니다.',
      body: table('scenarios', {
        columns: [
          { label: '시나리오', type: 'text', value: function (r) { return r.title; }, cls: 'strong nowrap' },
          { label: '화주사', type: 'text', value: function (r) { return r.brand ? brandName(r.brand) : '센터 전체'; }, cls: 'nowrap' },
          { label: '기간', type: 'text', value: function (r) { return mmdd(r.from) + ' ~ ' + mmdd(r.to); }, cls: 'nowrap' },
          { label: '설정 내용', type: 'text', value: function (r) { return r.setup; } },
          { label: '확인 화면', type: 'text', value: function (r) { return r.see.map(function (id) { return scr(id).ko; }).join(', '); }, html: function (r) { return r.see.map(function (id) { return goBtn(id); }).join(' · '); } }
        ],
        rows: D.scenarios, filename: fileName('소개', '시나리오'), pageSize: 0, search: false
      })
    });
    h += section({
      en: 'KPI Definitions', ko: '표준 KPI 정의',
      desc: '지표마다 분자·분모와 기준일을 먼저 정하고, 모든 화면과 CSV가 같은 계산 함수(metrics.js)를 사용합니다. 재고 정확도(실사 일치율)와 오출고율은 서로 다른 지표로 따로 계산합니다.',
      body: table('kpidef', {
        columns: [
          { label: '지표', type: 'text', value: function (r) { return r.label; }, cls: 'strong nowrap' },
          { label: '계산 기준', type: 'text', value: function (r) { return r.hint; } },
          { label: '목표(가정)', type: 'text', value: function (r) { return kpiTargetText(r); }, cls: 'nowrap' }
        ],
        rows: S.KPI_DEF, filename: fileName('소개', 'KPI정의'), pageSize: 0, search: false
      })
    });
    h += section({
      en: 'Scope', ko: '구현 범위와 아직 하지 않은 것',
      body: '<div class="grid-2">' +
        panel('구현한 것', '', '<ul class="plain-list"><li>화주사 4곳 · 102 SKU(의류·신발·잡화, 색상·사이즈) 가상 데이터와 하루 단위 운영 시뮬레이션</li><li>12개 화면, 공통 필터(기간·화주사·출고 유형), 표 검색·페이지, CSV 내보내기(UTF-8 BOM)</li><li>표준 KPI 7개, 우선 처리 업무, 이슈 로그, 일일 운영 보고서</li><li>지표 계산 일치 자동 점검(Node)과 화면 숫자 점검(Playwright)</li></ul>') +
        panel('하지 않은 것', '', '<ul class="plain-list"><li>실제 WMS·OMS·ERP·택배사 시스템 연동 없음 (모든 계산은 브라우저 안에서 실행)</li><li>로그인·권한, 데이터베이스, 실시간 갱신 없음</li><li>실제 기업 데이터로 검증하지 않음 — 업무 시간 단축·비용 절감 효과는 확인하지 않았습니다</li><li>코드 작성에 AI 코딩 도구를 활용했고, 업무 시나리오·KPI 기준·화면 구성·검증은 직접 정하고 확인했습니다</li></ul>') +
        '</div>'
    });
    return h;
  };

  /* ==================================================================
   * 01 운영 종합 현황
   * ================================================================== */
  function kpiTargetText(k) {
    switch (k.key) {
      case 'uph': return '표준 ' + M.STD.b2c + '건의 90% (' + k.target + '건) 이상';
      case 'ret': return k.target + '영업일 이내';
      case 'bill': return '0원 (청구 = 실적)';
      case 'mis': return Fm.pct(k.target, 2) + ' 이하';
      default: return Fm.pct(k.target, 1) + ' 이상';
    }
  }
  function kpiValueHtml(k) {
    if (k.na) return '<div class="kpi-value na">—</div>';
    switch (k.key) {
      case 'uph': return '<div class="kpi-value">' + Fm.num1(k.value) + '<small>건/시간</small></div>';
      case 'ret': return '<div class="kpi-value">' + Fm.num1(k.value) + '<small>영업일</small></div>';
      case 'bill': return '<div class="kpi-value">' + Fm.signed(k.value) + '<small>원</small></div>';
      case 'mis': return '<div class="kpi-value">' + (k.value * 100).toFixed(2) + '<small>%</small></div>';
      default: return '<div class="kpi-value">' + (k.value * 100).toFixed(1) + '<small>%</small></div>';
    }
  }
  function kpiDeltaText(k) {
    if (k.prev === null || k.na) return '직전 같은 기간 비교 불가';
    var d = k.value - k.prev, txt;
    if (k.key === 'uph' || k.key === 'ret') txt = (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d).toFixed(1);
    else if (k.key === 'bill') txt = Fm.signed(d) + '원';
    else txt = Fm.pp(d, k.key === 'mis' ? 2 : 1);
    var better = k.key === 'bill' ? Math.abs(k.value) < Math.abs(k.prev) : (k.dir === 'up' ? d > 0 : d < 0);
    var same = Math.abs(d) < 1e-9;
    return '직전 ' + F.days + '일 대비 <b>' + txt + '</b> ' + (same ? '변동 없음' : better ? '<span class="up">▲ 개선</span>' : '<span class="down">▼ 악화</span>');
  }
  function kpiDetailText(k) {
    var d = k.detail;
    switch (k.key) {
      case 'sla': return Fm.int(d.num) + ' / ' + Fm.int(d.n) + '건';
      case 'b2b': return Fm.int(d.num) + ' / ' + Fm.int(d.n) + '건';
      case 'acc': return Fm.int(d.num) + ' / ' + Fm.int(d.n) + ' 로케이션';
      case 'mis': return '오출고 ' + Fm.int(d.num) + ' / 출고 ' + Fm.int(d.n) + '건';
      case 'uph': return '근무일 ' + d.n + '일 · 센터 공통';
      case 'ret': return '처리 완료 ' + Fm.int(d.n) + '건 평균';
      case 'bill': return d.months + '개월 · 차이 항목 ' + d.n + '건';
    }
    return '';
  }
  function kpiCard(k) {
    var label = k.status === 'ok' ? '정상 · 목표 달성' : k.status === 'warn' ? '주의 · 목표 미달' : k.status === 'risk' ? '위험 · 목표 미달' : '해당 없음';
    return '<div class="kpi' + (k.status ? ' ' + k.status : '') + '" data-kpi="' + k.key + '">' +
      '<div class="kpi-top"><span class="kpi-label">' + esc(k.label) + '</span></div>' +
      '<p class="kpi-hint">' + esc(k.hint) + '</p>' + kpiValueHtml(k) +
      (k.na ? '<div class="kpi-meta">현재 필터에 해당하지 않음</div>' :
        '<div class="kpi-meta"><span>목표 ' + esc(kpiTargetText(k)) + '</span></div>' +
        '<div class="kpi-meta"><span>' + kpiDeltaText(k) + '</span></div>' +
        '<div class="kpi-meta"><span>' + esc(kpiDetailText(k)) + '</span></div>') +
      '<div class="kpi-foot">' + statusHtml(k.status, label) + goBtn(k.go, '원인 보기') + '</div></div>';
  }
  function todayCards(t) {
    function card(label, val, unit, sub, cls) {
      return '<div class="today-card ' + (cls || '') + '"><div class="t-label">' + esc(label) + '</div><div class="t-value">' + val + '<small>' + esc(unit) + '</small></div><div class="t-sub">' + sub + '</div></div>';
    }
    return '<div class="today-grid">' +
      card('금일 B2C 출고 대상', Fm.int(t.target), '건', '이월(납기 지난) ' + Fm.int(t.backlog) + '건 포함 · 보류 제외', 'accent') +
      card('출고 완료', Fm.int(t.done), '건', '진행률 ' + pct(t.progress) + ' · 전일(' + mmdd(t.prevDay) + ') 종일 출고 ' + Fm.int(t.prevShipped) + '건', '') +
      card('마감 위험 물량', Fm.int(t.risk), '건', '15:30 피킹 전 · 출고 예정 17:00 이후', t.risk ? 'risk' : '') +
      card('출고 작업 인원', Fm.int(t.staffAct), '명', '계획 ' + Fm.int(t.staffPlan) + '명 · 단기 ' + Fm.int(t.labor.temps) + '명 · 전일 ' + (t.prevStaff === null ? '—' : Fm.int(t.prevStaff) + '명'), '') +
      '</div>';
  }
  function progressList(t) {
    if (!t.brands.length) return naBox('선택한 출고 유형에는 B2C 진행 현황이 없습니다.');
    return '<div class="progress-list">' + t.brands.map(function (x) {
      var p = x.progress || 0, cls = p >= 0.85 ? '' : p >= 0.6 ? 'mid' : 'low';
      return '<div class="progress-row" data-brand-progress="' + x.id + '"><div class="p-name">' + esc(x.name) + '<small>' + esc(x.cat) + ' · 마감 ' + hhmm(BR[x.id].cutoff) + '</small></div>' +
        '<div class="progress-bar" role="img" aria-label="' + esc(x.name) + ' 진행률 ' + pct(p) + '"><span class="' + cls + '" style="width:' + (p * 100).toFixed(1) + '%"></span></div>' +
        '<div class="p-val"><b>' + pct(p, 0) + '</b> · ' + Fm.int(x.done) + ' / ' + Fm.int(x.target) + '건 · 위험 ' + Fm.int(x.risk) + '</div></div>';
    }).join('') + '</div>';
  }
  function todoList(list) {
    if (!list.length) return naBox('지금 우선 처리할 항목이 없습니다.');
    var lab = { 1: '긴급', 2: '높음', 3: '보통' };
    return '<ul class="todo">' + list.slice(0, 10).map(function (a) {
      return '<li><span class="pri p' + a.pri + '">' + lab[a.pri] + '</span><span class="area">' + esc(a.area) + ' · ' + esc(a.brand === '전체' ? '전체' : brandName(a.brand)) + '</span>' +
        '<span class="what"><b>' + esc(a.what) + '</b><span>조치: ' + esc(a.act) + '</span></span>' + goBtn(a.go, '상세') + '</li>';
    }).join('') + '</ul>' + (list.length > 10 ? '<p class="more-note">외 ' + (list.length - 10) + '건 — 전체 이슈는 ' + goBtn('issues') + ' 화면에서 확인합니다.</p>' : '');
  }
  RENDER.overview = function () {
    var t = S.today(F), k = S.kpis(F), ac = S.actions(F);
    var h = section({
      en: 'Today · ' + M.nowLabel, ko: '오늘 출고 진행 현황',
      desc: '기준 시각 ' + M.nowLabel + ' 스냅숏입니다(기간 필터 미적용, 화주사·출고 유형 필터 적용). 출고 대상은 납기가 오늘 이하인 B2C 주문이며, 화주사 요청 보류 건은 제외합니다.',
      body: todayCards(t)
    });
    h += section({
      en: 'By Client', ko: '화주사별 출고 진행률',
      desc: '오늘 출고 대상 대비 출고 완료 비율입니다. 마감 위험은 15:30 현재 피킹 전이고 출고 예정이 17:00 이후인 주문입니다.',
      body: panel('화주사별 진행률', '현재 단계: ' + Object.keys(t.stages).map(function (s) { return s + ' ' + Fm.int(t.stages[s]) + '건'; }).join(' · '), progressList(t))
    });
    h += section({
      en: 'Priority', ko: '우선 처리 업무',
      desc: '위험 KPI와 현재 상태에서 바로 조치할 항목을 긴급도 순으로 모았습니다. 상세를 누르면 원인을 확인할 수 있는 화면으로 이동합니다.',
      body: todoList(ac)
    });
    h += section({
      en: 'Standard KPIs', ko: '표준 운영 KPI',
      desc: '선택 기간 기준이며, 직전 같은 길이의 기간과 비교합니다. 목표는 시연을 위해 정한 가정값입니다.',
      body: '<div class="kpi-grid k4">' + k.map(kpiCard).join('') + '</div>'
    });
    h += section({
      en: 'Trend', ko: 'B2C 주문 접수 · 출고 추이',
      desc: (useWeeks() ? '주별(월요일 시작)' : '일별') + ' 합계입니다. 출고는 출고일, 주문 접수는 접수일 기준이라 서로 다른 날짜로 셉니다.',
      body: panel('주문 접수와 출고', 'B2C · 교환 출고 포함', chartBox('chOvTrend', 'tall', 'B2C 주문 접수와 출고 추이'))
    });
    hook(drawOvTrend);
    h += summary(overviewSummary(t, k, ac));
    return h;
  };
  function drawOvTrend() {
    var rows = S.outboundDaily(F), P = CH.palette();
    var bk = useWeeks() ? weekBuckets() : rows.map(function (r) { return [r.day, r.day]; });
    var rec = [], shp = [];
    bk.forEach(function (x) {
      var rs = rows.filter(function (r) { return r.day >= x[0] && r.day <= x[1]; });
      rec.push(rs.reduce(function (a, r) { return a + r.received + r.exchange; }, 0));
      shp.push(rs.reduce(function (a, r) { return a + r.shipped; }, 0));
    });
    CH.render('chOvTrend', { type: 'bar', data: { labels: bk.map(bucketLabel), datasets: [
      { type: 'bar', label: '출고(건)', data: shp, backgroundColor: P.tone(0) },
      { type: 'line', label: '주문 접수(건)', data: rec, borderColor: P.tone(1), backgroundColor: P.tone(1) }
    ] }, options: { scales: CH.baseScales({ yFmt: intAxis(), yTitle: '건' }), interaction: { mode: 'index', intersect: false },
      plugins: { tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + Fm.int(c.parsed.y); } } } } } });
  }
  function overviewSummary(t, k, ac) {
    var out = [], get = function (key) { return k.filter(function (x) { return x.key === key; })[0]; };
    if (t.target) out.push('<span class="flow-tag">오늘</span>15:30 현재 B2C 출고 대상 ' + b(Fm.int(t.target) + '건') + ' 중 ' + b(Fm.int(t.done) + '건') + '(' + pct(t.progress) + ')을 출고했고, 이 중 ' + b(Fm.int(t.backlog) + '건') + '은 추석 연휴 뒤 이월된 주문입니다. 마감 위험 ' + b(Fm.int(t.risk) + '건') + '은 피킹 대기 주문을 우선 처리하고 패킹 인원을 재배치하는 조치로 연결합니다.');
    var s = get('sla');
    if (!s.na) out.push('<span class="flow-tag">KPI</span>선택 기간 출고 SLA 준수율은 ' + b(pct(s.value)) + '(목표 98%)입니다. 지연 원인은 ' + goBtn('b2c') + ' 화면에서 결품·인력·물량 집중으로 나눠 확인합니다.');
    var risky = k.filter(function (x) { return x.status === 'risk' || x.status === 'warn'; }).map(function (x) { return x.label; });
    if (risky.length) out.push('<span class="flow-tag">조치 연결</span>목표에 못 미친 지표: ' + b(risky.join(', ')) + '. 위험 KPI → 화주사별 상세 → 원인 → 조치 순서로 각 화면을 연결해 두었습니다.');
    return out;
  }

  /* ==================================================================
   * 02 화주사 관리
   * ================================================================== */
  RENDER.clients = function () {
    var s = S.sla(F), bb = S.b2b(F), bl = S.billing(F), rr = D.brands.filter(function (x) { return S.bOk(F, x.id); });
    var cards = '<div class="brand-cards">' + rr.map(function (x) {
      var sb = s.byBrand.filter(function (y) { return y.id === x.id; })[0];
      var ret = S.returnRate(S.withPeriod(F, F.from, F.to));
      var rrB = S.returnRate({ from: F.from, to: F.to, days: F.days, brand: x.id, type: F.type });
      var bil = bl.byBrand.filter(function (y) { return y.id === x.id; })[0];
      var st = !sb || sb.rate === null ? null : sb.rate >= x.sla ? 'ok' : sb.rate >= x.sla - 0.03 ? 'warn' : 'risk';
      return '<div class="brand-card" data-brand-card="' + x.id + '"><h3>' + esc(x.name) + '<small>' + esc(x.cat) + '</small></h3>' +
        '<dl><dt>판매 채널</dt><dd>' + esc(x.channel) + '</dd><dt>B2C 마감</dt><dd>' + hhmm(x.cutoff) + ' · SLA ' + pct(x.sla, 0) + '</dd>' +
        '<dt>SLA 준수율</dt><dd>' + (sb && sb.rate !== null ? pct(sb.rate) : '—') + '</dd><dt>납기 대상</dt><dd>' + (sb ? Fm.int(sb.n) : '—') + '건</dd>' +
        '<dt>반품률</dt><dd>' + pct(rrB.rate) + '</dd><dt>청구(기간 걸친 달)</dt><dd>' + Fm.wonShort(bil ? bil.billed : null) + '</dd></dl>' +
        statusHtml(st, st === 'ok' ? 'SLA 달성' : st === 'warn' ? 'SLA 주의' : st === 'risk' ? 'SLA 미달' : '해당 없음') + '</div>';
    }).join('') + '</div>';
    var h = section({ en: 'Clients', ko: '화주사 현황', desc: '가상 패션 브랜드 4곳입니다. SLA 준수율은 납기일 기준 B2C 주문(보류 제외), 반품률은 도착 반품(오출고 회수 제외) ÷ 출고 건입니다.', body: cards });
    h += section({
      en: 'Contract Terms', ko: '화주사별 계약 조건 (가정)',
      desc: '화주사마다 출고 마감 시각과 SLA 목표, B2B 납기, 단가가 다릅니다. 모든 화면은 이 조건을 기준으로 계산합니다.',
      body: table('contracts', {
        columns: [
          { label: '화주사', type: 'text', value: function (r) { return r.name + ' (' + r.cat + ')'; }, cls: 'strong nowrap' },
          { label: 'B2C 당일 출고 마감', type: 'text', value: function (r) { return hhmm(r.cutoff) + ' 이전 영업일 주문'; } },
          { label: 'SLA 목표', type: 'pct', value: function (r) { return r.sla; } },
          { label: 'B2B 납기', type: 'text', value: function (r) { return '발주 후 ' + r.b2bLead + '영업일'; } },
          { label: 'B2B 납품처(가상)', type: 'text', value: function (r) { return r.dests.join(', '); } },
          { label: '입고 요일', type: 'text', value: function (r) { return r.inDays.map(function (d) { return Cal.DOW_KO[d]; }).join('·'); } },
          { label: '파렛트당 pcs', type: 'int', value: function (r) { return r.palletPcs; } },
          { label: '보관 구역', type: 'text', value: function (r) { return r.zone + '존 · ' + r.pallets + '파렛트'; } }
        ],
        rows: rr, filename: fileName('화주사', '계약조건'), pageSize: 0, search: false
      })
    });
    h += section({
      en: 'SLA by Client', ko: '화주사별 SLA 추이',
      desc: (useWeeks() ? '주별' : '일별') + ' 출고 SLA 준수율입니다. 점선은 SLA 목표 98%입니다.',
      body: panel('SLA 준수율', '납기일 기준', chartBox('chClientSla', 'tall', '화주사별 SLA 추이'))
    });
    hook(drawClientSla);
    h += section({
      en: 'Volume', ko: '화주사별 물량 요약',
      body: table('clientVol', {
        columns: [
          { label: '화주사', type: 'text', value: function (r) { return brandName(r.id); }, cls: 'strong nowrap' },
          { label: 'B2C 납기 대상(건)', type: 'int', value: function (r) { return r.n; } },
          { label: '납기 지연(건)', type: 'int', value: function (r) { return r.late; } },
          { label: 'SLA 준수율', type: 'pct', value: function (r) { return r.rate; } },
          { label: 'B2B 출고(pcs)', type: 'int', value: function (r) { return S.b2b({ from: F.from, to: F.to, days: F.days, brand: r.id, type: F.type }).shippedPcs; } },
          { label: '청구 금액(원)', type: 'won', value: function (r) { var x = bl.byBrand.filter(function (y) { return y.id === r.id; })[0]; return x ? x.billed : null; } },
          statusCol('상태', function (r) { return r.rate === null ? null : r.rate >= BR[r.id].sla ? 'ok' : r.rate >= BR[r.id].sla - 0.03 ? 'warn' : 'risk'; })
        ],
        rows: s.byBrand, filename: fileName('화주사', '물량요약'), pageSize: 0, search: false
      })
    });
    var worst = s.byBrand.filter(function (x) { return x.rate !== null; }).sort(function (a, c) { return a.rate - c.rate; })[0];
    h += summary([
      worst ? '<span class="flow-tag">지표</span>선택 기간 SLA가 가장 낮은 화주사는 ' + b(brandName(worst.id)) + '(' + pct(worst.rate) + ', 지연 ' + Fm.int(worst.late) + '건)입니다. 원인별 분해는 ' + goBtn('b2c') + '에서 화주사 필터로 확인합니다.' : null,
      bb.n ? '<span class="flow-tag">B2B</span>B2B 납기 준수율 ' + b(pct(bb.rate)) + ', 충족률(발주 대비 출고 수량) ' + b(pct(bb.fill)) + '입니다.' : null
    ]);
    return h;
  };
  function drawClientSla() {
    var rows = S.slaDaily(F), P = CH.palette(), bk = useWeeks() ? weekBuckets() : rows.map(function (r) { return [r.day, r.day]; });
    var ds = D.brands.filter(function (x) { return S.bOk(F, x.id); }).map(function (x, i) {
      return { type: 'line', label: x.name, data: bk.map(function (k) {
        var n = 0, l = 0;
        rows.forEach(function (r) { if (r.day >= k[0] && r.day <= k[1] && r.by[x.id]) { n += r.by[x.id].n; l += r.by[x.id].late; } });
        return n ? (n - l) / n : null;
      }), borderColor: P.tone(i), backgroundColor: P.tone(i), borderDash: i === 3 ? [6, 3] : undefined, spanGaps: true };
    });
    ds.push({ type: 'line', label: '목표 98%', data: bk.map(function () { return 0.98; }), borderColor: P.plan, borderDash: [3, 3], borderWidth: 1 });
    var sc = CH.baseScales({ yFmt: pctAxis(), beginAtZero: false });
    sc.y.max = 1; sc.y.min = 0.6;
    CH.render('chClientSla', { type: 'line', data: { labels: bk.map(bucketLabel), datasets: ds }, options: { scales: sc, interaction: { mode: 'index', intersect: false },
      plugins: { tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + Fm.pct(c.parsed.y); } } } } } });
  }

  /* ==================================================================
   * 03 입고·검수·적치
   * ================================================================== */
  RENDER.inbound = function () {
    var ib = S.inbound(F);
    var h = section({
      en: 'Inbound', ko: '입고 요약',
      desc: '도착일이 선택 기간 안인 입고 건입니다. 입고 예정(ASN) 수량과 실물 수량을 비교하고, 불량은 판매 가능 재고에서 뺀 뒤 적치합니다. 적치 리드타임은 도착일부터 적치 완료일까지 영업일 수입니다.',
      body: statRow([
        stat('입고 건수', Fm.int(ib.n), '건', '예정 ' + Fm.int(ib.asn) + 'pcs'),
        stat('실입고 수량', Fm.int(ib.recv), 'pcs', '예정 대비 부족 ' + Fm.int(ib.diff) + 'pcs (' + Fm.int(ib.diffN) + '건)'),
        stat('검수 불량', Fm.int(ib.defect), 'pcs', '불량률 ' + Fm.pct(ib.recv ? ib.defect / ib.recv : null, 2)),
        stat('평균 적치 리드타임', Fm.num1(ib.avgLead), '영업일', '당일 적치 ' + Fm.int(ib.sameDay) + ' / ' + Fm.int(ib.leadN) + '건'),
        stat('적치 대기', Fm.int(ib.pending.length), '건', '기간 종료일 기준')
      ])
    });
    h += section({
      en: 'Weekly', ko: '주별 입고 수량',
      desc: 'FW 시즌 준비로 8월 중순부터 입고 물량이 늘어납니다(가상 시나리오). 입고 인원은 8/10부터 3명 → 4명으로 늘렸습니다.',
      body: panel('입고 수량', '도착일 기준 · 주별', chartBox('chInbound', '', '주별 입고 수량'))
    });
    hook(function () {
      var P = CH.palette(), bk = weekBuckets();
      var rec = bk.map(function (k) { return ib.list.filter(function (x) { return x.arrive >= k[0] && x.arrive <= k[1]; }).reduce(function (a, x) { return a + x.recvQty; }, 0); });
      var df = bk.map(function (k) { return ib.list.filter(function (x) { return x.arrive >= k[0] && x.arrive <= k[1]; }).reduce(function (a, x) { return a + x.diff + x.defect; }, 0); });
      CH.render('chInbound', { type: 'bar', data: { labels: bk.map(bucketLabel), datasets: [
        { label: '실입고(pcs)', data: rec, backgroundColor: P.tone(0) },
        { label: '부족·불량(pcs)', data: df, backgroundColor: P.tone(1) }
      ] }, options: { scales: CH.baseScales({ yFmt: intAxis(), yTitle: 'pcs' }), interaction: { mode: 'index', intersect: false } } });
    });
    h += section({
      en: 'Inbound List', ko: '입고 목록',
      body: table('inboundList', {
        columns: [
          { label: '입고 번호', type: 'text', value: function (r) { return r.id; }, cls: 'nowrap' },
          brandCol(),
          { label: '도착일', type: 'date', value: function (r) { return r.arrive; }, cls: 'nowrap' },
          { label: '예정(pcs)', type: 'int', value: function (r) { return r.asnQty; } },
          { label: '실입고(pcs)', type: 'int', value: function (r) { return r.recvQty; } },
          { label: '부족(pcs)', type: 'int', value: function (r) { return r.diff; } },
          { label: '불량(pcs)', type: 'int', value: function (r) { return r.defect; } },
          { label: 'SKU 수', type: 'int', value: function (r) { return r.lines.length; } },
          { label: '적치 완료', type: 'text', value: function (r) { return r.putaway === null ? '적치 중' : Cal.isoOf(r.putaway); }, cls: 'nowrap' },
          { label: '리드타임(영업일)', type: 'int', value: function (r) { return S.inboundLead(r); } },
          { label: '비고', type: 'text', value: function (r) { return (r.urgent ? '결품 SKU 포함 · 우선 적치' : '') + (r.diffNote ? (r.urgent ? ' · ' : '') + r.diffNote : ''); } }
        ],
        rows: ib.list.slice().sort(function (a, c) { return c.arrive - a.arrive; }), filename: fileName('입고', '입고목록'),
        rowClass: function (r) { return r.diff > 0 || r.urgent ? 'flag' : ''; }
      })
    });
    h += summary([
      ib.n ? '<span class="flow-tag">지표</span>입고 ' + b(Fm.int(ib.n) + '건') + ' 중 ' + b(Fm.int(ib.diffN) + '건') + '에서 예정 대비 수량 부족이 있었고, 적치 전 화주사 확인 요청으로 연결했습니다. 평균 적치 리드타임은 ' + b(Fm.num1(ib.avgLead) + '영업일') + '입니다.' : null,
      ib.list.some(function (x) { return x.urgent; }) ? '<span class="flow-tag">조치</span>결품 SKU가 포함된 입고는 적치 순서를 앞당겨 다음 날 출고에 바로 쓸 수 있게 했습니다(우선 적치 규칙).' : null
    ]);
    return h;
  };

  /* ==================================================================
   * 04 SKU·재고·로케이션
   * ================================================================== */
  var ST_ST = { '결품': 'risk', '결품 위험': 'warn', '과잉': 'warn', '시즌 이월 검토': 'warn', '정상': 'ok' };
  RENDER.inventory = function () {
    var sv = S.stockView(F), cc = S.cycleCount(F), so = S.stockoutEvents(F);
    var cnt = {};
    sv.forEach(function (r) { cnt[r.status] = (cnt[r.status] || 0) + 1; });
    var styles = D.styles.filter(function (x) { return S.bOk(F, x.brand); });
    if (!state.local.matrixStyle || !styles.some(function (x) { return x.id === state.local.matrixStyle; })) state.local.matrixStyle = styles[0].id;
    var h = section({
      en: 'Stock Snapshot · ' + M.nowLabel, ko: '재고 요약',
      desc: '기준 시각 재고입니다(기간 필터 미적용). 가용 = 출고 할당 전 수량, 할당 = 오늘 출고 예정으로 잡힌 수량입니다. 재고 일수 = 가용 ÷ 최근 14일 하루 평균 출고(B2C+B2B).',
      body: statRow([
        stat('SKU', Fm.int(sv.length), '개', '의류·신발·잡화 · 색상×사이즈'),
        stat('보유 재고', Fm.int(sv.reduce(function (a, r) { return a + r.onHand; }, 0)), 'pcs', '할당 ' + Fm.int(sv.reduce(function (a, r) { return a + r.alloc; }, 0)) + 'pcs 포함'),
        stat('결품', Fm.int(cnt['결품'] || 0), 'SKU', '가용 0 또는 결품 대기 주문'),
        stat('결품 위험', Fm.int(cnt['결품 위험'] || 0), 'SKU', '재고 7일분 미만'),
        stat('과잉·이월 검토', Fm.int((cnt['과잉'] || 0) + (cnt['시즌 이월 검토'] || 0)), 'SKU', '과잉 120일분 초과 · SS 60일분 초과'),
        stat('재고 정확도', cc.rate === null ? '—' : (cc.rate * 100).toFixed(2), '%', '기간 내 월말 실사 ' + Fm.int(cc.locs) + ' 로케이션')
      ])
    });
    h += section({
      en: 'Color × Size', ko: '스타일별 색상·사이즈 가용 재고',
      desc: '사이즈 하나만 비어도 주문이 결품 대기로 남습니다. 칸 색: 빨강 = 가용 0, 주황 = 50pcs 미만.',
      tools: '<label class="inline-select">스타일 <select data-select="matrixStyle">' + styles.map(function (x) { return '<option value="' + x.id + '"' + (x.id === state.local.matrixStyle ? ' selected' : '') + '>' + esc(brandName(x.brand) + ' · ' + x.name) + '</option>'; }).join('') + '</select></label>',
      body: '<div id="blk-matrix">' + matrixHtml() + '</div>'
    });
    h += section({
      en: 'SKU · Location', ko: 'SKU별 재고와 로케이션',
      desc: '로케이션 = 존-랙-단-칸(피킹 위치). 상태 필터와 검색으로 결품·과잉 SKU를 찾습니다.',
      tools: '<div class="seg" role="group" aria-label="재고 상태">' + ['ALL', '결품', '결품 위험', '과잉', '시즌 이월 검토'].map(function (k) {
        return '<button type="button" data-stock-filter="' + k + '" aria-pressed="' + (state.local.stockFilter === k) + '">' + (k === 'ALL' ? '전체' : k) + '</button>';
      }).join('') + '</div>',
      body: table('skuStock', {
        columns: [
          { label: 'SKU', type: 'text', value: function (r) { return r.id; }, cls: 'nowrap' },
          brandCol(),
          { label: '상품', type: 'text', value: function (r) { return r.styleName; } },
          { label: '색상', type: 'text', value: function (r) { return r.color; } },
          { label: '사이즈', type: 'text', value: function (r) { return r.size; } },
          { label: '품목·시즌', type: 'text', value: function (r) { return r.cat + ' · ' + r.season; }, cls: 'nowrap' },
          { label: '로케이션', type: 'text', value: function (r) { return r.loc; }, cls: 'nowrap' },
          { label: '보유(pcs)', type: 'int', value: function (r) { return r.onHand; } },
          { label: '할당(pcs)', type: 'int', value: function (r) { return r.alloc; } },
          { label: '가용(pcs)', type: 'int', value: function (r) { return r.avail; } },
          { label: '일 평균 출고', type: 'num1', value: function (r) { return r.daily; } },
          { label: '재고 일수', type: 'num1', value: function (r) { return r.cover; } },
          statusCol('상태', function (r) { return ST_ST[r.status]; }, function (r) { return r.status; })
        ],
        rows: sv.filter(function (r) { return state.local.stockFilter === 'ALL' || r.status === state.local.stockFilter; }).sort(function (a, c) { var o = ['결품', '결품 위험', '시즌 이월 검토', '과잉', '정상']; return o.indexOf(a.status) - o.indexOf(c.status) || (a.cover || 0) - (c.cover || 0); }),
        filename: fileName('재고', 'SKU별재고'), rowClass: function (r) { return r.status === '결품' ? 'flag' : ''; }
      })
    });
    h += section({
      en: 'Stockouts', ko: '결품 구간 (선택 기간)',
      desc: '마감 재고가 0이었던 날을 묶은 구간과, 그 SKU 때문에 결품 대기로 지연된 B2C 주문 수입니다.',
      body: table('stockouts', {
        columns: [
          { label: 'SKU', type: 'text', value: function (r) { return r.id; }, cls: 'nowrap' }, brandCol(),
          { label: '상품', type: 'text', value: function (r) { return r.name; } },
          { label: '시작', type: 'date', value: function (r) { return r.from; } },
          { label: '종료', type: 'date', value: function (r) { return r.to; } },
          { label: '결품 일수', type: 'int', value: function (r) { return r.days; } },
          { label: '결품 대기 지연(건)', type: 'int', value: function (r) { return r.lateOrders; } }
        ], rows: so, filename: fileName('재고', '결품구간'), empty: '선택 기간에 결품 구간이 없습니다.'
      })
    });
    h += section({
      en: 'Cycle Count', ko: '월말 재고 실사 (로케이션 단위)',
      desc: '재고 정확도 = 실사 로케이션 중 전산 수량과 일치한 비율입니다(오출고율과는 다른 지표). 9월은 월말 실사 전입니다.',
      body: table('cycle', {
        columns: [
          { label: '실사 월', type: 'text', value: function (r) { return r.month.replace('-', '.'); }, cls: 'nowrap' }, brandCol(),
          { label: '실사 로케이션', type: 'int', value: function (r) { return r.locs; } },
          { label: '일치', type: 'int', value: function (r) { return r.matched; } },
          { label: '불일치', type: 'int', value: function (r) { return r.diffLocs; } },
          { label: '정확도', type: 'pct2', value: function (r) { return r.matched / r.locs; } },
          { label: '차이 수량(pcs)', type: 'int', value: function (r) { return r.diffUnits; } },
          { label: '원인', type: 'text', value: function (r) { return r.note; } }
        ], rows: cc.list, filename: fileName('재고', '월말실사'), empty: '선택 기간에 월말 실사가 없습니다. 기간을 넓혀 보세요.'
      })
    });
    var worstCc = cc.list.slice().sort(function (a, c) { return c.diffLocs - a.diffLocs; })[0];
    h += summary([
      '<span class="flow-tag">재고</span>기준 시각 결품 ' + b(Fm.int(cnt['결품'] || 0) + ' SKU') + ', 결품 위험 ' + b(Fm.int(cnt['결품 위험'] || 0) + ' SKU') + '입니다. 결품 위험 SKU는 화주사에 입고 일정을 먼저 확인합니다.',
      so.length ? '<span class="flow-tag">결품</span>선택 기간 결품 대기 지연이 가장 많았던 SKU는 ' + b(so[0].id) + '(' + Fm.int(so[0].lateOrders) + '건)입니다.' + (so[0].id === M.scenarioDays.stockoutSku ? ' 가상 시나리오의 생산 지연(입고 중단) 결과입니다.' : '') : null,
      worstCc && worstCc.diffLocs ? '<span class="flow-tag">실사</span>' + worstCc.month.replace('-', '.') + ' ' + brandName(worstCc.brand) + ' 실사에서 불일치 ' + b(worstCc.diffLocs + '로케이션') + '이 나왔습니다(' + esc(worstCc.note) + ').' : null
    ]);
    return h;
  };
  function matrixHtml() {
    var mx = S.matrix(state.local.matrixStyle);
    var tot = 0;
    var h = '<div class="table-wrap"><table class="data matrix" data-matrix="' + mx.style.id + '"><thead><tr><th>색상</th>' + mx.style.sizes.map(function (z) { return '<th class="r">' + esc(z) + '</th>'; }).join('') + '<th class="r">합계</th></tr></thead><tbody>';
    mx.rows.forEach(function (r) {
      var rs = 0;
      h += '<tr><td class="strong">' + esc(r.color) + '</td>' + r.cells.map(function (c) {
        rs += c.avail;
        return '<td class="r ' + (c.avail <= 0 ? 'cell-risk' : c.avail < 50 ? 'cell-warn' : '') + '" title="' + esc(D.skus[c.sku].id) + '">' + Fm.int(c.avail) + '</td>';
      }).join('') + '<td class="r strong">' + Fm.int(rs) + '</td></tr>';
      tot += rs;
    });
    return h + '</tbody></table></div><p class="table-foot">가용 재고 합계 <b class="num">' + Fm.int(tot) + '</b>pcs · 시즌 ' + esc(mx.style.season) + ' · ' + esc(mx.style.cat) + '</p>';
  }

  /* ==================================================================
   * 05 공간·적치율·시즌 재고
   * ================================================================== */
  RENDER.space = function () {
    var zs = S.zones(F);
    var h = section({
      en: 'Zones · ' + M.nowLabel, ko: '존별 적치율',
      desc: '화주사별 보관 존의 파렛트 환산 적치율입니다(보유 재고 ÷ 파렛트당 pcs ÷ 존 파렛트 수, 기준 시각). 85% 이상 주의, 95% 이상 위험으로 봅니다. 막대는 보유 재고의 시즌 구성입니다.',
      body: '<div class="zone-grid">' + zs.map(function (z) {
        var st = S.utilStatus(z.util), tot = z.onHand || 1;
        return '<div class="zone" data-zone="' + z.id + '"><h3>' + esc(z.zone + ' · ' + z.name) + statusHtml(st, st === 'ok' ? '여유' : st === 'warn' ? '주의' : '위험') + '</h3>' +
          '<div class="z-val">' + (z.util * 100).toFixed(0) + '<small>%</small></div>' +
          '<div class="stat-sub">' + Fm.num1(z.pallets) + ' / ' + z.cap + '파렛트 · ' + Fm.int(z.onHand) + 'pcs</div>' +
          '<div class="z-bar" role="img" aria-label="시즌 구성"><i class="ss" style="width:' + (z.season.SS / tot * 100).toFixed(1) + '%"></i><i class="fw" style="width:' + (z.season.FW / tot * 100).toFixed(1) + '%"></i><i class="all" style="width:' + (z.season.ALL / tot * 100).toFixed(1) + '%"></i></div>' +
          '<div class="z-legend"><span><i style="background:var(--color-accent)"></i>SS ' + Fm.int(z.season.SS) + '</span><span><i style="background:var(--color-charcoal)"></i>FW ' + Fm.int(z.season.FW) + '</span><span><i style="background:var(--chart-3)"></i>사계절 ' + Fm.int(z.season.ALL) + '</span></div></div>';
      }).join('') + '</div>'
    });
    h += section({
      en: 'Utilization Trend', ko: '적치율 추이',
      desc: '일별 마감 재고 기준입니다. 점선은 주의 기준 85%입니다.',
      body: panel('존별 적치율', '파렛트 환산', chartBox('chSpace', 'tall', '존별 적치율 추이'))
    });
    hook(function () {
      var rows = S.zoneDaily(F), P = CH.palette(), bk = useWeeks() ? weekBuckets() : rows.map(function (r) { return [r.day, r.day]; });
      var ds = zs.map(function (z, i) {
        return { type: 'line', label: z.zone + ' (' + z.name + ')', data: bk.map(function (k) { var r = rows.filter(function (x) { return x.day === k[1]; })[0]; return r ? r[z.id] : null; }), borderColor: P.tone(i), backgroundColor: P.tone(i), borderDash: i === 3 ? [6, 3] : undefined };
      });
      var sc = CH.baseScales({ yFmt: pctAxis(), beginAtZero: false });
      sc.y.min = 0.5; sc.y.max = 1.05;
      CH.render('chSpace', { type: 'line', data: { labels: bk.map(function (k) { return mmdd(k[1]); }), datasets: ds }, options: { scales: sc, interaction: { mode: 'index', intersect: false },
        plugins: { markers: { hlines: [{ y: 0.85, label: '주의 85%' }] }, tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + Fm.pct(c.parsed.y); } } } } } });
    });
    var ss = S.stockView(F).filter(function (r) { return r.season === 'SS'; });
    h += section({
      en: 'Season Stock', ko: 'SS 시즌 재고 (이월 검토 대상)',
      desc: '9월 말 기준 SS 상품의 재고 일수입니다. 60일분이 넘으면 상단 랙·이월 구역 이동이나 화주사 반출 협의 대상으로 표시합니다.',
      body: table('ssStock', {
        columns: [
          { label: 'SKU', type: 'text', value: function (r) { return r.id; }, cls: 'nowrap' }, brandCol(),
          { label: '상품', type: 'text', value: function (r) { return r.styleName + ' ' + r.color + ' ' + r.size; } },
          { label: '로케이션', type: 'text', value: function (r) { return r.loc; }, cls: 'nowrap' },
          { label: '보유(pcs)', type: 'int', value: function (r) { return r.onHand; } },
          { label: '일 평균 출고', type: 'num1', value: function (r) { return r.daily; } },
          { label: '재고 일수', type: 'num1', value: function (r) { return r.cover; } },
          { label: '파렛트 환산', type: 'num1', value: function (r) { return r.onHand / BR[r.brand].palletPcs; } },
          statusCol('상태', function (r) { return ST_ST[r.status]; }, function (r) { return r.status; })
        ], rows: ss.sort(function (a, c) { return (c.cover || 0) - (a.cover || 0); }), filename: fileName('공간', 'SS시즌재고')
      })
    });
    var hi = zs.filter(function (z) { return z.util >= 0.85; });
    h += summary([
      hi.length ? '<span class="flow-tag">공간</span>' + hi.map(function (z) { return b(z.zone + ' ' + Math.round(z.util * 100) + '%'); }).join(', ') + '가 주의 기준(85%)을 넘었습니다. FW 입고가 늘어나는 시기에 SS 재고가 남아 있어 보관 위치가 부족해질 수 있습니다.' : '<span class="flow-tag">공간</span>모든 존이 85% 미만입니다.',
      '<span class="flow-tag">조치 예시</span>SS 이월 재고를 상단 랙·이월 구역으로 옮기고, 입고 예정 물량의 보관 위치를 먼저 확보합니다. 존 용량과 파렛트 환산 기준은 가정값입니다.'
    ]);
    return h;
  };

  /* ==================================================================
   * 06 B2C 주문·출고
   * ================================================================== */
  RENDER.b2c = function () {
    if (!S.b2cOn(F)) return naBox('출고 유형이 B2B로 선택되어 B2C 화면을 표시하지 않습니다. 필터에서 전체 또는 B2C를 선택하세요.');
    var s = S.sla(F), ms = S.misship(F), rows = S.outboundDaily(F);
    var rec = rows.reduce(function (a, r) { return a + r.received; }, 0), ex = rows.reduce(function (a, r) { return a + r.exchange; }, 0), shp = rows.reduce(function (a, r) { return a + r.shipped; }, 0);
    var h = section({
      en: 'B2C Outbound', ko: 'B2C 출고 요약',
      desc: '주문 접수는 접수일, 출고는 출고일, SLA는 납기일 기준입니다. 납기일 = 화주사 마감 시각 이전 영업일 주문은 당일, 이후는 다음 영업일.',
      body: statRow([
        stat('주문 접수', Fm.int(rec), '건', '교환 출고 ' + Fm.int(ex) + '건 별도'),
        stat('출고', Fm.int(shp), '건', '출고일 기준'),
        stat('출고 SLA', s.rate === null ? '—' : (s.rate * 100).toFixed(1), '%', Fm.int(s.onTime) + ' / ' + Fm.int(s.n) + '건 · 보류 제외 ' + Fm.int(s.holds) + '건'),
        stat('납기 지연', Fm.int(s.late), '건', '납기 다음 날 이후 출고'),
        stat('오출고', Fm.int(ms.n), '건', '오출고율 ' + Fm.pct(ms.rate, 2))
      ])
    });
    h += section({
      en: 'Daily Flow', ko: '일별 주문 접수·출고·처리 능력',
      desc: '처리 능력 = 그날 B2C 투입 인원 × 근무 시간(연장 포함) × 시간당 처리 건수입니다. 주말에 쌓인 주문이 월요일 출고 대상이 됩니다.',
      body: panel('B2C 일별 흐름', '건', chartBox('chB2cDaily', 'tall', 'B2C 일별 주문 접수와 출고'))
    });
    hook(function () {
      var P = CH.palette(), bz = rows.filter(function (r) { return r.biz || r.received; });
      CH.render('chB2cDaily', { type: 'bar', data: { labels: bz.map(function (r) { return mmdd(r.day); }), datasets: [
        { type: 'bar', label: '출고(건)', data: bz.map(function (r) { return r.shipped; }), backgroundColor: P.tone(0) },
        { type: 'line', label: '주문 접수(건)', data: bz.map(function (r) { return r.received + r.exchange; }), borderColor: P.tone(1), backgroundColor: P.tone(1) },
        { type: 'line', label: '처리 능력(건, 센터 전체)', data: bz.map(function (r) { return r.biz ? r.cap : null; }), borderColor: P.plan, borderDash: [4, 3], borderWidth: 1.5, spanGaps: false }
      ] }, options: { scales: CH.baseScales({ yFmt: intAxis(), yTitle: '건' }), interaction: { mode: 'index', intersect: false } } });
    });
    var causes = Object.keys(s.causes).map(function (k) { return { cause: k, n: s.causes[k] }; }).sort(function (a, c) { return c.n - a.n; });
    h += '<div class="grid-2">' + panel('지연 원인', '납기 지연 ' + Fm.int(s.late) + '건', chartBox('chCause', '', '지연 원인')) +
      panel('시간대별 주문 접수', '마감 시각 이후 주문은 다음 영업일 납기', chartBox('chHours', '', '시간대별 주문 접수')) + '</div>';
    hook(function () {
      var P = CH.palette();
      CH.render('chCause', { type: 'bar', data: { labels: causes.map(function (c) { return c.cause; }), datasets: [{ label: '지연(건)', data: causes.map(function (c) { return c.n; }), backgroundColor: P.tone(0) }] },
        options: { indexAxis: 'y', scales: (function () { var sc = CH.baseScales({}); delete sc.y.ticks.callback; delete sc.y.beginAtZero; sc.x.ticks.callback = intAxis(); sc.x.grid = { color: P.grid }; sc.y.grid = { display: false }; return sc; })(), plugins: { legend: { display: false } } } });
      var hr = S.orderHours(F);
      CH.render('chHours', { type: 'bar', data: { labels: hr.map(function (v, i) { return i + '시'; }), datasets: [{ label: '주문 접수(건)', data: hr, backgroundColor: hr.map(function (v, i) { return i * 60 < 14 * 60 ? P.tone(0) : P.tone(2); }) }] },
        options: { scales: CH.baseScales({ yFmt: intAxis() }), plugins: { legend: { display: false } } } });
    });
    h += section({
      en: 'Late Orders', ko: '납기 지연 주문',
      desc: '납기일이 선택 기간 안이고 납기일 안에 출고하지 못한 주문입니다. 원인은 처음 납기를 놓친 날의 상황으로 분류했습니다.',
      body: table('lateOrders', {
        columns: [
          { label: '주문번호', type: 'text', value: function (r) { return r.id; }, cls: 'nowrap' }, brandCol(),
          { label: '접수', type: 'text', value: function (r) { return Cal.isoOf(r.day) + ' ' + hhmm(r.t); }, cls: 'nowrap' },
          { label: '납기', type: 'date', value: function (r) { return r.due; }, cls: 'nowrap' },
          { label: '출고', type: 'text', value: function (r) { return r.ship === null ? (r.plan !== null ? '오늘 출고 예정' : '미출고') : Cal.isoOf(r.ship); }, cls: 'nowrap' },
          { label: '지연(영업일)', type: 'int', value: function (r) { return r.ship === null ? S.bizDiff(r.due, END) : S.bizDiff(r.due, r.ship); } },
          { label: '상품', type: 'text', value: function (r) { return r.lines.map(function (l) { return D.skus[l[0]].id + '×' + l[1]; }).join(', '); } },
          { label: '원인', type: 'text', value: function (r) { return r.cause; } }
        ], rows: s.lateList.slice().sort(function (a, c) { return c.due - a.due; }), filename: fileName('B2C출고', '납기지연'), empty: '선택 기간에 납기 지연 주문이 없습니다.'
      })
    });
    h += section({
      en: 'Mis-shipments', ko: '오출고',
      desc: '출고 후 고객 문의·회수로 확인된 사이즈·색상 오출고와 수량 누락입니다. 회수 건은 반품(오출고 회수)으로 들어와 A급 재입고됩니다.',
      body: table('misList', {
        columns: [
          { label: '주문번호', type: 'text', value: function (r) { return r.id; }, cls: 'nowrap' }, brandCol(),
          { label: '출고일', type: 'date', value: function (r) { return r.ship; } },
          { label: '유형', type: 'text', value: function (r) { return r.mis; } },
          { label: '상품', type: 'text', value: function (r) { return r.lines.map(function (l) { return D.skus[l[0]].id; }).join(', '); } }
        ], rows: ms.list.slice().sort(function (a, c) { return c.ship - a.ship; }), filename: fileName('B2C출고', '오출고'), empty: '선택 기간에 오출고가 없습니다.'
      })
    });
    h += summary([
      causes.length ? '<span class="flow-tag">원인</span>납기 지연 ' + b(Fm.int(s.late) + '건') + ' 중 가장 많은 원인은 ' + b(causes[0].cause + ' ' + Fm.int(causes[0].n) + '건') + '입니다.' + (causes.length > 1 ? ' 다음은 ' + causes.slice(1, 3).map(function (c) { return c.cause + ' ' + Fm.int(c.n) + '건'; }).join(', ') + '.' : '') : '<span class="flow-tag">원인</span>선택 기간에 납기 지연이 없습니다.',
      '<span class="flow-tag">조치 연결</span>물량 집중은 ' + goBtn('labor') + '의 필요 시간과 투입 시간, 결품 대기는 ' + goBtn('inventory') + '의 결품 구간으로 원인을 확인합니다.'
    ]);
    return h;
  };

  /* ==================================================================
   * 07 B2B 납품·출고 일정
   * ================================================================== */
  RENDER.b2b = function () {
    if (!S.b2bOn(F)) return naBox('출고 유형이 B2C로 선택되어 B2B 화면을 표시하지 않습니다. 필터에서 전체 또는 B2B를 선택하세요.');
    var bb = S.b2b(F), sch = S.b2bSchedule(F);
    var h = section({
      en: 'B2B Delivery', ko: 'B2B 납품 요약',
      desc: '매장·편집숍·도매 거래처(가상) 납품입니다. 납기 준수율은 납기일 기준, 충족률은 작업을 시작한 발주(발주일 기준)의 발주 수량 대비 출고 수량입니다. 재고가 모자라면 있는 수량만 부분 출고합니다.',
      body: statRow([
        stat('납기 대상', Fm.int(bb.n), '건', '납기일 기준'),
        stat('납기 준수율', bb.rate === null ? '—' : (bb.rate * 100).toFixed(1), '%', '지연 ' + Fm.int(bb.late) + '건'),
        stat('충족률', bb.fill === null ? '—' : (bb.fill * 100).toFixed(1), '%', '부분 출고 ' + Fm.int(bb.shortOrders) + '건'),
        stat('B2B 출고', Fm.int(bb.shippedPcs), 'pcs', '출고일 기준')
      ])
    });
    h += section({
      en: 'Schedule', ko: '납품 일정 (오늘 기준)',
      desc: '미출고 발주와 최근 7일 출고분입니다(기간 필터 미적용). 납기 순으로 정렬했습니다.',
      body: table('b2bSchedule', {
        columns: [
          { label: '발주번호', type: 'text', value: function (r) { return r.id; }, cls: 'nowrap' }, brandCol(),
          { label: '납품처', type: 'text', value: function (r) { return r.dest; }, cls: 'nowrap' },
          { label: '발주일', type: 'date', value: function (r) { return r.day; }, cls: 'nowrap' },
          { label: '납기', type: 'date', value: function (r) { return r.due; }, cls: 'nowrap' },
          { label: '발주(pcs)', type: 'int', value: function (r) { return r.qty; } },
          { label: '작업 진행', type: 'text', value: function (r) { return r.alloc === null ? '—' : Math.round(Math.min(1, r.done / Math.max(1, r.shipQty)) * 100) + '%'; } },
          statusCol('상태', function (r) { var s = S.b2bStatus(r); return /초과|후 출고/.test(s) ? 'risk' : /대기|중/.test(s) ? 'warn' : 'ok'; }, function (r) { return S.b2bStatus(r); })
        ], rows: sch, filename: fileName('B2B', '납품일정'), pageSize: 10
      })
    });
    h += section({
      en: 'Weekly', ko: '주별 B2B 출고',
      body: panel('B2B 출고 수량', '출고일 기준 · pcs', chartBox('chB2b', '', '주별 B2B 출고'))
    });
    hook(function () {
      var P = CH.palette(), bk = weekBuckets(), rows = S.outboundDaily(F);
      CH.render('chB2b', { type: 'bar', data: { labels: bk.map(bucketLabel), datasets: [{ label: 'B2B 출고(pcs)', data: bk.map(function (k) { return rows.filter(function (r) { return r.day >= k[0] && r.day <= k[1]; }).reduce(function (a, r) { return a + r.b2bPcs; }, 0); }), backgroundColor: P.tone(0) }] },
        options: { scales: CH.baseScales({ yFmt: intAxis(), yTitle: 'pcs' }), plugins: { legend: { display: false } } } });
    });
    h += section({
      en: 'B2B Orders', ko: 'B2B 발주 목록 (납기일 기준)',
      body: table('b2bList', {
        columns: [
          { label: '발주번호', type: 'text', value: function (r) { return r.id; }, cls: 'nowrap' }, brandCol(),
          { label: '납품처', type: 'text', value: function (r) { return r.dest; }, cls: 'nowrap' },
          { label: '납기', type: 'date', value: function (r) { return r.due; }, cls: 'nowrap' },
          { label: '출고', type: 'text', value: function (r) { return r.ship === null ? '미출고' : Cal.isoOf(r.ship); }, cls: 'nowrap' },
          { label: '발주(pcs)', type: 'int', value: function (r) { return r.qty; } },
          { label: '출고(pcs)', type: 'int', value: function (r) { return r.shipQty; } },
          { label: '결품(pcs)', type: 'int', value: function (r) { return r.short; } },
          statusCol('납기', function (r) { return r.late ? 'risk' : 'ok'; }, function (r) { return r.late ? '지연' : '준수'; }),
          { label: '지연 원인', type: 'text', value: function (r) { return r.cause || ''; } }
        ], rows: bb.list.slice().sort(function (a, c) { return c.due - a.due; }), filename: fileName('B2B', '발주목록'), rowClass: function (r) { return r.late ? 'flag' : ''; }
      })
    });
    var lateL = bb.list.filter(function (x) { return x.late; });
    h += summary([
      lateL.length ? '<span class="flow-tag">지연</span>납기 지연 ' + b(lateL.length + '건') + ': ' + lateL.map(function (x) { return brandName(x.brand) + ' ' + x.dest + '(' + mmdd(x.due) + ', ' + x.cause + ')'; }).join(', ') + '.' : '<span class="flow-tag">지연</span>선택 기간에 B2B 납기 지연이 없습니다.',
      '<span class="flow-tag">조치 예시</span>대량 발주는 납기 협의 단계에서 하루 작업 가능량(B2B 인원 × 8시간 × 시간당 ' + M.STD.b2b + 'pcs)을 먼저 확인하고, 인력 결원 시 B2C 인원 일부를 B2B 검수·라벨 작업에 배치합니다.'
    ]);
    return h;
  };

  /* ==================================================================
   * 08 반품·교환
   * ================================================================== */
  RENDER.returns = function () {
    var r = S.returns(F), rr = S.returnRate(F);
    var reasons = Object.keys(r.reasons).map(function (k) { return { k: k, n: r.reasons[k] }; }).sort(function (a, c) { return c.n - a.n; });
    var grades = Object.keys(r.grades).map(function (k) { return { k: k, n: r.grades[k] }; }).sort(function (a, c) { return c.n - a.n; });
    var h = section({
      en: 'Returns', ko: '반품·교환 요약',
      desc: '반품 도착 → 검수·분류(A급 재입고 / B급 별도 보관 / 불량 화주사 반송) 순서로 처리합니다. 사이즈 교환은 검수 후 교환 출고 주문을 만듭니다. 처리 시간은 도착일부터 처리일까지 영업일 수입니다.',
      body: statRow([
        stat('반품 도착', Fm.int(r.arrived), '건', '반품률 ' + Fm.pct(rr.rate, 1) + ' (오출고 회수 제외)'),
        stat('검수 완료', Fm.int(r.done), '건', '교환 출고 생성 ' + Fm.int(r.exchanges) + '건'),
        stat('평균 처리 시간', Fm.num1(r.avgLead), '영업일', '2영업일 이내 ' + Fm.pct(r.done ? r.within2 / r.done : null, 0)),
        stat('검수 대기', Fm.int(r.backlog), '건', '기간 종료일 기준 · 최장 ' + r.oldest + '영업일')
      ])
    });
    h += section({
      en: 'Backlog', ko: '반품 도착·처리·대기 추이',
      desc: '시즌오프·기획전 반품이 늘어 대기가 쌓이고, 9/21 반품 인원을 1명 → 2명으로 늘린 뒤 줄어드는 흐름입니다(가상 시나리오).',
      body: panel('반품 흐름', '건 · 일별', chartBox('chRet', 'tall', '반품 도착·처리·대기 추이'))
    });
    hook(function () {
      var rows = S.returnsDaily(F), P = CH.palette();
      CH.render('chRet', { type: 'bar', data: { labels: rows.map(function (x) { return mmdd(x.day); }), datasets: [
        { type: 'bar', label: '도착(건)', data: rows.map(function (x) { return x.arrived; }), backgroundColor: P.tone(2) },
        { type: 'bar', label: '검수 완료(건)', data: rows.map(function (x) { return x.done; }), backgroundColor: P.tone(0) },
        { type: 'line', label: '검수 대기(건, 마감 기준)', data: rows.map(function (x) { return x.backlog; }), borderColor: P.tone(1), backgroundColor: P.tone(1) }
      ] }, options: { scales: CH.baseScales({ yFmt: intAxis(), yTitle: '건' }), interaction: { mode: 'index', intersect: false } } });
    });
    h += '<div class="grid-2">' + panel('반품 사유', '도착 기준', table('retReason', {
      columns: [{ label: '사유', type: 'text', value: function (x) { return x.k; } }, { label: '건수', type: 'int', value: function (x) { return x.n; } }, { label: '비중', type: 'pct', value: function (x) { return x.n / Math.max(1, r.arrived); } }],
      rows: reasons, filename: fileName('반품', '사유'), pageSize: 0, search: false })) +
      panel('검수 결과', '처리 기준', table('retGrade', {
        columns: [{ label: '판정', type: 'text', value: function (x) { return x.k; } }, { label: '건수', type: 'int', value: function (x) { return x.n; } }, { label: '비중', type: 'pct', value: function (x) { return x.n / Math.max(1, r.done); } }],
        rows: grades, filename: fileName('반품', '검수결과'), pageSize: 0, search: false })) + '</div>';
    h += section({
      en: 'Waiting', ko: '검수 대기 목록 (기간 종료일 기준)',
      body: table('retWait', {
        columns: [
          { label: '반품번호', type: 'text', value: function (x) { return x.id; }, cls: 'nowrap' }, brandCol(),
          { label: '원 주문', type: 'text', value: function (x) { return x.order; }, cls: 'nowrap' },
          { label: 'SKU', type: 'text', value: function (x) { return D.skus[x.sku].id; }, cls: 'nowrap' },
          { label: '사유', type: 'text', value: function (x) { return x.reason; } },
          { label: '도착일', type: 'date', value: function (x) { return x.arrive; } },
          { label: '대기(영업일)', type: 'int', value: function (x) { return S.bizDiff(x.arrive, F.to); } }
        ], rows: r.backlogList.slice().sort(function (a, c) { return a.arrive - c.arrive; }), filename: fileName('반품', '검수대기'), empty: '기간 종료일 기준 검수 대기가 없습니다.'
      })
    });
    h += summary([
      '<span class="flow-tag">지표</span>선택 기간 반품 도착 ' + b(Fm.int(r.arrived) + '건') + ', 평균 처리 시간 ' + b(Fm.num1(r.avgLead) + '영업일') + '입니다. 가장 많은 사유는 ' + (reasons[0] ? b(reasons[0].k + ' ' + Fm.int(reasons[0].n) + '건') : '—') + '입니다.',
      '<span class="flow-tag">영향</span>반품 검수가 늦어지면 A급 재입고가 늦어져 가용 재고가 줄고, 교환 출고도 함께 늦어집니다. 반품 재입고 위치 혼재는 ' + goBtn('inventory') + '의 실사 불일치 원인으로도 이어집니다(8월 브랜드 B).'
    ]);
    return h;
  };

  /* ==================================================================
   * 09 인력·생산성
   * ================================================================== */
  RENDER.labor = function () {
    var lb = S.labor(F), rows = lb.days.map(S.laborRow);
    var h = '<div class="demo-flag"><span class="sample-badge">센터 공통</span><span>인력·생산성은 센터 전체 기준이라 화주사·출고 유형 필터를 적용하지 않습니다. 인원·표준 생산성은 가정값입니다.</span></div>';
    h += section({
      en: 'Labor', ko: '인력·생산성 요약',
      desc: '공정: B2C 피킹·패킹 / B2B 출고 / 입고 검수·적치 / 반품 검수. 생산성(UPH) = 처리량 ÷ 투입 시간(연장 포함, 대기 시간 포함).',
      body: statRow([
        stat('근무일', Fm.int(lb.days.length), '일', '평일 · 휴무일 제외'),
        stat('계획 대비 실제 인원', Fm.pct(lb.planHead ? lb.actHead / lb.planHead : null, 1), '', '연인원 ' + Fm.int(lb.actHead) + ' / ' + Fm.int(lb.planHead) + '명'),
        stat('단기 인력', Fm.int(lb.temps), '명·일', '물량 예측 기준 배치'),
        stat('연장 근무', Fm.int(lb.otH), '시간', 'B2C 공정 합계'),
        stat('처리 부족일', Fm.int(lb.shortDays.length), '일', '결원 4명 이상 또는 처리 능력 초과')
      ])
    });
    h += section({
      en: 'Productivity by Process', ko: '공정별 생산성',
      body: table('procUph', {
        columns: [
          { label: '공정', type: 'text', value: function (r) { return r.label; }, cls: 'strong nowrap' },
          { label: '처리량', type: 'text', value: function (r) { return Fm.int(r.vol) + r.unit; }, cls: 'nowrap' },
          { label: '투입 시간', type: 'int', value: function (r) { return r.hours; } },
          { label: '실적 UPH', type: 'num1', value: function (r) { return r.uph; } },
          { label: '표준 UPH(가정)', type: 'num1', value: function (r) { return r.std; } },
          { label: '표준 대비', type: 'pct', value: function (r) { return r.uph === null ? null : r.uph / r.std; } },
          statusCol('상태', function (r) { return r.uph === null ? null : r.uph / r.std >= 0.9 ? 'ok' : r.uph / r.std >= 0.75 ? 'warn' : 'risk'; })
        ], rows: lb.proc, filename: fileName('인력', '공정별생산성'), pageSize: 0, search: false
      })
    });
    h += section({
      en: 'Hours', ko: '일별 필요 작업 시간 vs 투입 시간',
      desc: '필요 시간 = 그날 처리해야 할 물량 ÷ 표준 UPH(전 공정 합계). 투입 시간이 필요 시간보다 적은 날은 다음 날로 물량이 이월됩니다.',
      body: panel('필요 시간과 투입 시간', '시간 · 근무일', chartBox('chLabor', 'tall', '일별 필요 작업 시간과 투입 시간'))
    });
    hook(function () {
      var P = CH.palette();
      CH.render('chLabor', { type: 'bar', data: { labels: rows.map(function (r) { return mmdd(r.day); }), datasets: [
        { type: 'bar', label: '투입 시간', data: rows.map(function (r) { return Math.round(r.availH); }), backgroundColor: P.tone(0) },
        { type: 'line', label: '필요 시간', data: rows.map(function (r) { return Math.round(r.reqH); }), borderColor: P.tone(1), backgroundColor: P.tone(1) }
      ] }, options: { scales: CH.baseScales({ yFmt: intAxis(), yTitle: '시간' }), interaction: { mode: 'index', intersect: false } } });
    });
    h += section({
      en: 'Daily Staffing', ko: '일별 인원 계획·실적',
      body: table('laborDays', {
        columns: [
          { label: '날짜', type: 'text', value: function (r) { return Fm.dateShort(r.day); }, cls: 'nowrap' },
          { label: '계획 인원', type: 'int', value: function (r) { return r.plan; } },
          { label: '실제 인원', type: 'int', value: function (r) { return r.act; } },
          { label: '단기 인력', type: 'int', value: function (r) { return r.temps; } },
          { label: '연장(시간/인)', type: 'num1', value: function (r) { return r.otH; } },
          { label: 'B2C 처리 대상(건)', type: 'int', value: function (r) { return r.queue; } },
          { label: 'B2C 처리 능력(건)', type: 'int', value: function (r) { return r.cap; } },
          { label: 'B2C 출고(건)', type: 'int', value: function (r) { return r.shipped; } },
          statusCol('상태', function (r) { return r.plan - r.act >= 4 || r.queue > r.cap ? 'risk' : r.plan > r.act ? 'warn' : 'ok'; }, function (r) { return r.plan - r.act >= 4 ? '결원' : r.queue > r.cap ? '처리 능력 초과' : r.plan > r.act ? '일부 결원' : '정상'; })
        ], rows: rows.slice().reverse(), filename: fileName('인력', '일별인원'), rowClass: function (r) { return r.plan - r.act >= 4 || r.queue > r.cap ? 'flag' : ''; }
      })
    });
    var worst = rows.slice().sort(function (a, c) { return (c.plan - c.act) - (a.plan - a.act); })[0];
    var b2cP = lb.proc[0];
    h += summary([
      '<span class="flow-tag">생산성</span>B2C 실적 UPH는 ' + b(Fm.num1(b2cP.uph) + '건/시간') + '(표준 ' + b2cP.std + '건의 ' + Fm.pct(b2cP.uph / b2cP.std, 0) + ')입니다. 물량이 적은 날에도 기본 인원을 유지해 대기 시간이 생기는 구조를 가정했습니다.',
      worst && worst.plan > worst.act ? '<span class="flow-tag">결원</span>결원이 가장 컸던 날은 ' + b(Fm.dateShort(worst.day)) + '(계획 ' + worst.plan + '명 → 실제 ' + worst.act + '명)이고, B2C 처리 대상 ' + Fm.int(worst.queue) + '건 대비 처리 능력은 ' + Fm.int(worst.cap) + '건이었습니다.' : null,
      '<span class="flow-tag">조치 예시</span>전날 수집된 주문·B2B 납기·입고 예정으로 다음 날 공정별 필요 시간을 계산해 인원을 배치하고, 결원 시 여유 공정(입고·반품)에서 B2C로 재배치합니다.'
    ]);
    return h;
  };

  /* ==================================================================
   * 10 3PL 물류비·정산
   * ================================================================== */
  RENDER.billing = function () {
    var bl = S.billing(F), rr = D.brands.filter(function (x) { return S.bOk(F, x.id); });
    var h = '<div class="demo-flag"><span class="sample-badge">월 단위</span><span>정산은 선택 기간이 걸친 달 전체를 대상으로 합니다(' + bl.months.map(function (m) { return m.month.replace('-', '.'); }).join(', ') + '). 9월은 마감 전 가집계입니다. 단가·청구 금액은 모두 가상입니다.</span></div>';
    h += section({
      en: 'Billing', ko: '정산 요약',
      desc: 'WMS 실적(입고 적치 수량, 일별 보관 재고, 출고·반품 처리 기록)으로 다시 계산한 금액과 청구서(가상)를 항목별로 대조합니다.',
      body: statRow([
        stat('실적 기준 금액', Fm.wonShort(bl.actual), '', '항목 ' + Fm.int(bl.rows.length) + '줄'),
        stat('청구 금액', Fm.wonShort(bl.billed), '', '청구서 기준'),
        stat('정산 차이', Fm.signed(bl.diff), '원', '청구 − 실적 · 차이 ' + Fm.int(bl.diffRows.length) + '줄'),
        stat('B2C 주문당 물류비', Fm.int(bl.byBrand.reduce(function (a, x) { return a + x.orders; }, 0) ? bl.actual / bl.byBrand.reduce(function (a, x) { return a + x.orders; }, 0) : null), '원', '전체 금액 ÷ B2C 출고 건(참고)')
      ])
    });
    h += section({
      en: 'Rate Card', ko: '화주사별 단가표 (가정)',
      body: table('rates', {
        columns: [{ label: '화주사', type: 'text', value: function (r) { return r.name + ' (' + r.cat + ')'; }, cls: 'strong nowrap' }].concat(D.billItems.map(function (it) {
          return { label: it.label + ' (원/' + it.unit + ')', type: 'int', value: function (r) { return r.rates[it.rate]; } };
        })), rows: rr, filename: fileName('정산', '단가표'), pageSize: 0, search: false, scroll: true
      })
    });
    h += section({
      en: 'Monthly', ko: '월별 청구 금액',
      body: panel('화주사별 월 청구', '원 · 청구서 기준', chartBox('chBill', '', '월별 청구 금액'))
    });
    hook(function () {
      var P = CH.palette();
      CH.render('chBill', { type: 'bar', data: { labels: bl.months.map(function (m) { return m.month.replace('-', '.'); }), datasets: rr.map(function (x, i) {
        return { label: x.name, data: bl.months.map(function (m) { return bl.rows.filter(function (r) { return r.month === m.month && r.brand === x.id; }).reduce(function (a, r) { return a + r.billed; }, 0); }), backgroundColor: P.tone(i) };
      }) }, options: { scales: CH.baseScales({ stacked: true, yFmt: function (v) { return Fm.wonShort(v); } }), interaction: { mode: 'index', intersect: false },
        plugins: { tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + Fm.won(c.parsed.y); } } } } } });
    });
    h += section({
      en: 'Differences', ko: '청구 차이 항목',
      desc: '청구서 수량·단가가 실적과 다른 줄입니다. 원인과 조치를 함께 기록합니다.',
      body: table('billDiff', {
        columns: [
          { label: '월', type: 'text', value: function (r) { return r.month.replace('-', '.'); }, cls: 'nowrap' }, brandCol(),
          { label: '항목', type: 'text', value: function (r) { return r.label; } },
          { label: '실적 수량', type: 'num1', value: function (r) { return r.qty; } },
          { label: '청구 수량', type: 'num1', value: function (r) { return r.billQty; } },
          { label: '계약 단가', type: 'int', value: function (r) { return r.rate; } },
          { label: '청구 단가', type: 'int', value: function (r) { return r.billRate; } },
          { label: '차이(원)', type: 'signed', value: function (r) { return r.diff; } },
          { label: '원인', type: 'text', value: function (r) { return r.note; } },
          { label: '상태', type: 'text', value: function (r) { return r.status; }, cls: 'nowrap' }
        ], rows: bl.diffRows, filename: fileName('정산', '청구차이'), empty: '선택 기간에 청구 차이가 없습니다.', pageSize: 0
      })
    });
    h += section({
      en: 'Statement', ko: '월별 정산 명세 (실적 vs 청구)',
      body: table('billRows', {
        columns: [
          { label: '월', type: 'text', value: function (r) { return r.month.replace('-', '.'); }, cls: 'nowrap' }, brandCol(),
          { label: '항목', type: 'text', value: function (r) { return r.label; } },
          { label: '단위', type: 'text', value: function (r) { return r.unit; } },
          { label: '실적 수량', type: 'num1', value: function (r) { return r.qty; } },
          { label: '단가', type: 'int', value: function (r) { return r.rate; } },
          { label: '실적 금액(원)', type: 'won', value: function (r) { return r.actual; } },
          { label: '청구 금액(원)', type: 'won', value: function (r) { return r.billed; } },
          { label: '차이(원)', type: 'signed', value: function (r) { return r.diff; } }
        ], rows: bl.rows, filename: fileName('정산', '정산명세'), rowClass: function (r) { return r.diff ? 'flag' : ''; }
      })
    });
    h += summary([
      '<span class="flow-tag">대조</span>선택 기간이 걸친 달의 청구 금액은 ' + b(Fm.won(bl.billed)) + ', 실적 기준 금액은 ' + b(Fm.won(bl.actual)) + '로 차이는 ' + b(Fm.signed(bl.diff) + '원') + '입니다.',
      bl.diffRows.length ? '<span class="flow-tag">원인</span>' + bl.diffRows.map(function (r) { return r.month.replace('-', '.') + ' ' + brandName(r.brand) + ' ' + r.label + '(' + Fm.signed(r.diff) + '원): ' + esc(r.note); }).join(' / ') : null,
      '<span class="flow-tag">조치 예시</span>월 마감 때 청구서 수량을 WMS 실적과 항목별로 맞춰 본 뒤 확정합니다. 가집계 단계에서 찾은 차이는 청구서 확정 전에 수정합니다.'
    ]);
    return h;
  };

  /* ==================================================================
   * 11 운영 이슈·보고서
   * ================================================================== */
  var AREA_GO = { 'B2C 출고': 'b2c', 'B2B 납품': 'b2b', '재고': 'inventory', '입고': 'inbound', '재고 실사': 'inventory', '정산': 'billing', '반품': 'returns', '공간': 'space' };
  RENDER.issues = function () {
    var all = S.issues(F), list = state.local.issueOpen ? all.filter(function (x) { return x.status === 'open'; }) : all;
    var day = state.local.reportDay === null ? END : state.local.reportDay;
    if (day < F.from || day > F.to) day = F.to;
    var areas = {};
    all.forEach(function (x) { areas[x.area] = (areas[x.area] || 0) + 1; });
    var h = section({
      en: 'Issue Log', ko: '운영 이슈 로그',
      desc: '계산 결과에서 자동으로 뽑은 이슈입니다(지연 20건 이상인 날, B2B 지연, 결품, 입고 수량 차이, 실사 불일치, 청구 차이, 반품 적체, 적치율 85% 이상). 원인과 조치는 가상 시나리오 기준 예시입니다.',
      tools: '<label class="toggle"><input type="checkbox" data-toggle="issueOpen"' + (state.local.issueOpen ? ' checked' : '') + '> 진행 중만 보기</label>',
      body: statRow(Object.keys(areas).map(function (k) { return stat(k, Fm.int(areas[k]), '건', ''); })) +
        table('issueLog', {
          columns: [
            { label: '날짜', type: 'date', value: function (r) { return r.day; }, cls: 'nowrap' },
            { label: '영역', type: 'text', value: function (r) { return r.area; }, cls: 'nowrap' },
            { label: '화주사', type: 'text', value: function (r) { return r.brand === '전체' ? '전체' : brandName(r.brand); }, cls: 'nowrap' },
            { label: '이슈', type: 'text', value: function (r) { return r.title; } },
            { label: '원인', type: 'text', value: function (r) { return r.cause; } },
            { label: '영향', type: 'text', value: function (r) { return r.impact; } },
            { label: '조치', type: 'text', value: function (r) { return r.action; } },
            statusCol('상태', function (r) { return r.status === 'open' ? r.sev : 'ok'; }, function (r) { return r.status === 'open' ? '진행 중' : '조치 완료'; }),
            { label: '화면', type: 'text', value: function (r) { return scr(r.go).ko; }, html: function (r) { return goBtn(r.go, '보기'); } }
          ], rows: list, filename: fileName('이슈', '이슈로그'), rowClass: function (r) { return r.status === 'open' ? 'flag' : ''; }
        })
    });
    h += section({
      en: 'Daily Report', ko: '일일 운영 보고서',
      desc: '선택한 날의 센터 운영 결과를 한 장으로 정리합니다(화주사·출고 유형 필터 적용). 마지막 날은 15:30 기준입니다.',
      tools: '<label class="inline-select">보고 날짜 <input type="date" data-report-day min="' + Cal.isoOf(F.from) + '" max="' + Cal.isoOf(F.to) + '" value="' + Cal.isoOf(day) + '"></label> <button type="button" class="btn btn-primary" data-export="report">' + dlIcon() + '보고서 CSV</button>',
      body: reportHtml(day)
    });
    h += summary([
      '<span class="flow-tag">이슈</span>선택 기간 이슈 ' + b(Fm.int(all.length) + '건') + ' 중 진행 중 ' + b(Fm.int(all.filter(function (x) { return x.status === 'open'; }).length) + '건') + '입니다. 영역별로는 ' + Object.keys(areas).map(function (k) { return k + ' ' + areas[k] + '건'; }).join(', ') + '.',
      '<span class="flow-tag">보고</span>일일 보고서는 같은 계산 함수로 만들기 때문에 화면 KPI·표와 숫자가 같습니다. 메일 발송·메신저 연동 기능은 없습니다.'
    ]);
    return h;
  };
  function reportRows(day) {
    var r = S.dailyReport(F, day), lb = r.labor;
    var rows = [
      ['보고 기준', Cal.isoOf(day) + ' (' + Cal.DOW_KO[Cal.dowOf(day)] + ')' + (day === END ? ' 15:30 기준' : '') + (r.biz ? '' : ' · 휴무일')],
      ['필터', (F.brand === 'ALL' ? '전체 화주사' : brandLabel(F.brand)) + ' · ' + (F.type === 'ALL' ? 'B2C+B2B' : F.type)],
      ['B2C 주문 접수', Fm.int(r.received) + '건'],
      ['B2C 출고', Fm.int(r.shipped) + '건'],
      ['출고 SLA (이날 납기)', r.sla.n ? pct(r.sla.rate) + ' (' + Fm.int(r.sla.onTime) + ' / ' + Fm.int(r.sla.n) + '건, 지연 ' + Fm.int(r.sla.late) + '건)' : '해당 없음'],
      ['지연 원인', Object.keys(r.sla.causes).map(function (k) { return k + ' ' + r.sla.causes[k] + '건'; }).join(', ') || '없음'],
      ['오출고', Fm.int(r.mis) + '건'],
      ['B2B 출고', Fm.int(r.b2bPcs) + 'pcs · 이날 납기 ' + Fm.int(r.b2b.n) + '건 중 지연 ' + Fm.int(r.b2b.late) + '건'],
      ['입고', Fm.int(r.inbound.n) + '건 · ' + Fm.int(r.inbound.recv) + 'pcs (부족 ' + Fm.int(r.inbound.diff) + ', 불량 ' + Fm.int(r.inbound.defect) + ')'],
      ['반품', '도착 ' + Fm.int(r.returns.arrived) + '건 · 검수 ' + Fm.int(r.returns.done) + '건 · 대기 ' + Fm.int(r.returns.backlog) + '건'],
      ['작업 인원 (센터)', lb ? '계획 ' + S.laborRow(lb).plan + '명 · 실제 ' + S.laborRow(lb).act + '명 · 단기 ' + lb.temps + '명 · 연장 ' + lb.otH + '시간/인' : '휴무일']
    ];
    return rows;
  }
  function reportHtml(day) {
    var rows = reportRows(day);
    exportsReg.report = { filename: fileName('보고서', '일일운영보고_' + Cal.isoOf(day)), columns: [{ label: '항목', type: 'text', value: function (r) { return r[0]; } }, { label: '내용', type: 'text', value: function (r) { return r[1]; } }], rows: function () { return rows; } };
    return '<div class="report" data-report="' + Cal.isoOf(day) + '"><h3>센터 일일 운영 보고 · ' + Cal.isoOf(day) + '</h3><p class="r-meta">가상 패션 3PL 센터 · 가상 데이터 · 자동 작성</p><dl>' +
      rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl></div>';
  }

  /* ------------------------------------------------------------------
   * 셸: 필터·메뉴·이벤트
   * ------------------------------------------------------------------ */
  function initControls() {
    var nav = document.getElementById('nav'), lastG = null, html = '';
    SCREENS.forEach(function (s) {
      if (s.group !== lastG) { html += '<li class="nav-group" aria-hidden="true">' + esc(s.group) + '</li>'; lastG = s.group; }
      html += '<li><button type="button" data-screen="' + s.id + '"><span class="nav-no">' + s.no + '</span><span class="nav-ko">' + esc(s.ko) + '</span><span class="nav-en">' + esc(s.en) + '</span></button></li>';
    });
    nav.innerHTML = html;
    document.getElementById('sidebarFoot').innerHTML =
      '<dt>기준 시각</dt><dd>' + M.nowLabel + '</dd><dt>데이터 기간</dt><dd>' + M.startIso + ' ~ ' + M.endIso + '</dd>' +
      '<dt>센터 (가정)</dt><dd>화주사 4곳 · ' + D.skus.length + ' SKU</dd><dt>데이터</dt><dd>모두 가상 (시드 ' + M.seed + ')</dd>';
    document.getElementById('fBrand').innerHTML = '<option value="ALL">전체 화주사</option>' + D.brands.map(function (x) { return '<option value="' + x.id + '">' + esc(x.name + ' · ' + x.cat) + '</option>'; }).join('');
    var fFrom = document.getElementById('fFrom'), fTo = document.getElementById('fTo');
    [fFrom, fTo].forEach(function (el) { el.min = M.startIso; el.max = M.endIso; });
    syncControls();

    document.getElementById('filters').addEventListener('change', function (e) {
      var t = e.target;
      if (t.id === 'fPeriod') {
        state.filter.period = t.value;
        if (t.value === 'custom' && !state.filter.from) { state.filter.from = Cal.isoOf(END - 29); state.filter.to = M.endIso; }
      }
      if (t.id === 'fFrom') state.filter.from = t.value;
      if (t.id === 'fTo') state.filter.to = t.value;
      if (state.filter.from && state.filter.to && state.filter.from > state.filter.to) {
        var tmp = state.filter.from; state.filter.from = state.filter.to; state.filter.to = tmp;
      }
      if (t.id === 'fBrand') state.filter.brand = t.value;
      if (t.id === 'fType') state.filter.type = t.value;
      resetTables(); syncControls(); render();
    });
    document.getElementById('fReset').addEventListener('click', function () {
      state.filter = JSON.parse(JSON.stringify(DEFAULT_FILTER));
      resetTables(); syncControls(); render();
    });
    nav.addEventListener('click', function (e) { var btn = e.target.closest('[data-screen]'); if (btn) go(btn.getAttribute('data-screen')); });

    var view = document.getElementById('view');
    view.addEventListener('click', function (e) {
      var ex = e.target.closest('[data-export]');
      if (ex) { var r = exportsReg[ex.getAttribute('data-export')]; if (r) X.download(r.filename, r.columns, r.rows()); return; }
      var g = e.target.closest('[data-go]');
      if (g) { go(g.getAttribute('data-go')); return; }
      var pg = e.target.closest('[data-page]');
      if (pg) { var k = pg.getAttribute('data-page'); state.tables[k].page += +pg.getAttribute('data-dir'); refreshTable(k); return; }
      var sf = e.target.closest('[data-stock-filter]');
      if (sf) { state.local.stockFilter = sf.getAttribute('data-stock-filter'); state.tables.skuStock = { q: state.tables.skuStock ? state.tables.skuStock.q : '', page: 0 }; render(true); return; }
    });
    view.addEventListener('input', function (e) {
      var k = e.target.getAttribute('data-search');
      if (k) { state.tables[k].q = e.target.value; state.tables[k].page = 0; refreshTable(k); }
    });
    view.addEventListener('change', function (e) {
      var t = e.target;
      if (t.getAttribute('data-toggle') === 'issueOpen') { state.local.issueOpen = t.checked; state.tables.issueLog = { q: state.tables.issueLog ? state.tables.issueLog.q : '', page: 0 }; render(true); return; }
      if (t.getAttribute('data-select') === 'matrixStyle') { state.local.matrixStyle = t.value; document.getElementById('blk-matrix').innerHTML = matrixHtml(); return; }
      if (t.hasAttribute('data-report-day') && t.value) { state.local.reportDay = Math.max(F.from, Math.min(F.to, Cal.dayOf(t.value))); render(true); }
    });
    window.addEventListener('hashchange', function () {
      var id = location.hash.replace('#', '');
      if (id && id !== state.screen && scr(id)) { state.screen = scr(id).id; render(); }
    });
  }
  function resetTables() { Object.keys(state.tables).forEach(function (k) { state.tables[k].page = 0; }); }
  function syncControls() {
    var f = state.filter;
    document.getElementById('fPeriod').value = f.period;
    document.getElementById('fBrand').value = f.brand;
    document.getElementById('fType').value = f.type;
    document.getElementById('customRange').classList.toggle('on', f.period === 'custom');
    if (f.period === 'custom') { document.getElementById('fFrom').value = f.from; document.getElementById('fTo').value = f.to; }
  }
  function go(id) {
    state.screen = scr(id).id;
    if (location.hash !== '#' + state.screen) history.replaceState(null, '', '#' + state.screen);
    render();
    window.scrollTo(0, 0);
    document.getElementById('view').focus({ preventScroll: true });
  }
  function scopeLineHtml() {
    var bs = document.getElementById('fBrand'), ty = document.getElementById('fType');
    return '필터 적용 범위 <strong>' + Cal.isoOf(F.from) + ' ~ ' + Cal.isoOf(F.to) + '</strong> (' + F.days + '일) · 화주사 <strong>' + esc(bs.options[bs.selectedIndex].text) + '</strong> · 출고 유형 <strong>' +
      esc(ty.options[ty.selectedIndex].text) + '</strong> · 기준 시각 ' + M.nowLabel + ' · <span class="scope-sample">가상 데이터</span>';
  }
  function render(keepScroll) {
    F = S.resolveFilter(state.filter);
    exportsReg = {}; tableReg = {}; hooks = [];
    CH.destroyAll();
    var sc = scr(state.screen) || SCREENS[1];
    document.querySelectorAll('#nav [data-screen]').forEach(function (bt) {
      if (bt.getAttribute('data-screen') === sc.id) bt.setAttribute('aria-current', 'page'); else bt.removeAttribute('aria-current');
    });
    document.getElementById('pageEyebrow').textContent = sc.no + ' · ' + sc.en;
    document.getElementById('pageTitle').textContent = sc.ko;
    document.getElementById('scopeLine').innerHTML = scopeLineHtml();
    document.title = sc.ko + ' · Fashion 3PL Control Tower (가상 데이터 · 개인 포트폴리오)';
    var y = window.scrollY;
    document.getElementById('view').innerHTML = RENDER[sc.id]();
    Object.keys(tableReg).forEach(updateCount);
    runHooks();
    if (keepScroll) window.scrollTo(0, y);
  }

  CH.applyDefaults();
  initControls();
  var h0 = location.hash.replace('#', '');
  if (scr(h0)) state.screen = scr(h0).id;
  render();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { CH.applyDefaults(); render(true); });

  // 점검용 노출
  window.SCMApp = { state: state, render: render, go: go, exports: function () { return exportsReg; }, screens: SCREENS };
})();
