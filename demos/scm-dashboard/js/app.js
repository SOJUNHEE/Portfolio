/* =====================================================================
 * js/app.js — 화면 전환, 필터, 렌더링, 분석 요약
 * ---------------------------------------------------------------------
 * - 수치는 모두 metrics.js에서 계산한 값을 사용합니다.
 * - 표는 하나의 열 정의로 화면과 CSV를 함께 만듭니다 (export.js).
 * - 분석 요약 문장은 필터 결과로 계산한 수치로 매번 다시 작성합니다.
 * ===================================================================== */
(function () {
  'use strict';
  var D = window.SCM_DATA, S = window.SCMMetrics, CH = window.SCMCharts, X = window.SCMExport, Fm = X.fmt;
  var M = D.meta, Cal = D.cal, SK = D.skus;
  var END = M.END_DAY;

  var DEFAULT_FILTER = { period: '90d', from: null, to: null, channel: 'ALL', product: 'ALL' };
  var state = {
    screen: 'overview',
    filter: JSON.parse(JSON.stringify(DEFAULT_FILTER)),
    local: { actionGroup: 'ALL', reconDiffOnly: false, billDiffOnly: false, billMonth: 'ALL', issueStatus: 'ALL', simSku: null, simShare: null, mmOpenOnly: false }
  };
  var exportsReg = {}, blocks = {}, hooks = [];
  var F = null;

  var SCREENS = [
    { id: 'overview', no: '01', ko: '종합 현황', en: 'Overview', duty: '' },
    { id: 'orders', no: '02', ko: '주문·발주·출고', en: 'Order to Ship', duty: '담당 업무 1' },
    { id: 'b2b', no: '03', ko: 'B2B 거래처 입출고', en: 'B2B Fulfillment', duty: '담당 업무 2 · 3' },
    { id: 'inventory', no: '04', ko: '재고 운영', en: 'Inventory', duty: '담당 업무 2 · 3' },
    { id: 'issues', no: '05', ko: '3PL·이슈·유관부서', en: '3PL & Issues', duty: '담당 업무 3 · 4' },
    { id: 'integrity', no: '06', ko: '데이터 정합성·재고 정상화', en: 'Data Integrity', duty: '담당 업무 5 · 6' },
    { id: 'settlement', no: '07', ko: '정산 검증·운영 효율', en: 'Settlement & Efficiency', duty: '담당 업무 6 · 우대사항' },
    { id: 'ratecard', no: '08', ko: '3PL 견적 단가', en: '3PL Rate Card', duty: '담당 업무 4 · 6' }
  ];
  var RENDER = {};

  /* ------------------------------------------------------------------
   * 공통 도우미
   * ------------------------------------------------------------------ */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function skuName(s) { return SK[s].name; }
  var CH_NAME = {};
  D.channels.b2c.forEach(function (c) { CH_NAME[c.id] = c.name; });
  D.channels.b2b.forEach(function (c) { CH_NAME[c.id] = c.name; });
  CH_NAME.CENTER = '센터 공통(입고)';
  function chName(id) { return CH_NAME[id] || id; }
  function statusHtml(st, label) {
    if (!st) return '<span class="status none">' + esc(label || '해당 없음') + '</span>';
    return '<span class="status ' + st + '">' + esc(label || Fm.statusLabel(st)) + '</span>';
  }
  function section(o) {
    return '<section class="section"' + (o.id ? ' id="' + o.id + '"' : '') + '>' +
      '<div class="section-head"><div>' +
      (o.en ? '<span class="eyebrow">' + esc(o.en) + '</span>' : '') +
      '<h2>' + esc(o.ko) + '</h2>' +
      (o.desc ? '<p class="section-desc">' + o.desc + '</p>' : '') +
      '</div>' + (o.tools ? '<div class="section-tools">' + o.tools + '</div>' : '') + '</div>' +
      o.body + '</section>';
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
  function naBox(text) { return '<div class="na-box">' + esc(text) + '</div>'; }
  function scopeTag(text) { return '<span class="tag">' + esc(text) + '</span>'; }
  function hook(fn) { hooks.push(fn); }
  function fileName(screenKo, name) {
    return ('SCM_' + screenKo + '_' + name + '_' + Cal.isoOf(F.from) + '_' + Cal.isoOf(F.to) + '.csv').replace(/[\\/:*?"<>|·\s]+/g, '_');
  }
  function pctSplit(v, d) {
    if (v === null || v === undefined) return '—';
    return (v * 100).toFixed(d === undefined ? 1 : d);
  }
  function mmdd(d) { return Cal.isoOf(d).slice(5).replace('-', '/'); }

  /* 표: columns = [{label, value(row), type, html(row)?, cls?}] */
  function table(key, cfg) {
    var cols = cfg.columns, rows = cfg.rows, limit = cfg.limit === undefined ? 50 : cfg.limit;
    exportsReg[key] = { filename: cfg.filename, columns: cols, rows: rows };
    var numeric = { int: 1, num1: 1, pct: 1, pct2: 1, won: 1, signed: 1, hours: 1 };
    var shown = limit ? rows.slice(0, limit) : rows;
    var h = '<div class="table-block">';
    h += '<div class="table-foot" style="margin:0 0 8px"><span>' + (cfg.caption ? cfg.caption + ' · ' : '') + '<b class="num">' + Fm.int(rows.length) + '</b>건' +
      (rows.length > shown.length ? ' (상위 ' + shown.length + '건 표시, 전체는 엑셀로 내보내기)' : '') + '</span>' +
      '<button type="button" class="btn" data-export="' + key + '">' + dlIcon() + '엑셀로 내보내기</button></div>';
    h += '<div class="table-wrap' + (cfg.scroll ? ' table-scroll' : '') + '"><table class="data"><thead><tr>';
    cols.forEach(function (c) { h += '<th class="' + (numeric[c.type] ? 'r' : '') + '">' + esc(c.label) + '</th>'; });
    h += '</tr></thead><tbody>';
    if (!shown.length) h += '<tr><td colspan="' + cols.length + '" class="muted c">' + esc(cfg.empty || '해당 기간에 데이터가 없습니다.') + '</td></tr>';
    shown.forEach(function (r) {
      var rc = cfg.rowClass ? cfg.rowClass(r) : '';
      h += '<tr' + (rc ? ' class="' + rc + '"' : '') + '>';
      cols.forEach(function (c) {
        var cls = (numeric[c.type] ? 'r ' : '') + (c.cls || '') + (LONG_COL.test(c.label) ? ' wrap' : '');
        var content = c.html ? c.html(r) : esc(X.display(c, r));
        h += '<td class="' + cls + '">' + content + '</td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table></div></div>';
    return h;
  }
  // 긴 문장이 들어가는 열만 줄바꿈 허용 (나머지 열은 한 줄 유지, 표는 가로 스크롤)
  var LONG_COL = /(내용|사유|비고|원인|근거|조치|메모|검증식|해석|처리$|패턴|대상$)/;
  function dlIcon() {
    return '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1v7M3 5l3 3 3-3M1.5 10.5h9" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
  }
  function statusCol(label, fn, textFn) {
    return { label: label, type: 'text', value: function (r) { return textFn ? textFn(r) : fn(r) ? Fm.statusLabel(fn(r)) : '해당 없음'; }, html: function (r) { return statusHtml(fn(r), textFn ? textFn(r) : null); } };
  }
  function skuCol(label, fn) {
    return { label: label || '상품', type: 'text', value: function (r) { return skuName(fn ? fn(r) : r.sku); } };
  }
  function block(id, fn) {
    blocks[id] = fn;
    return '<div id="' + id + '">' + fn() + '</div>';
  }
  function refreshBlock(id) {
    var el = document.getElementById(id);
    if (!el || !blocks[id]) return;
    hooks = [];
    el.innerHTML = blocks[id]();
    runHooks();
  }
  function runHooks() { var h = hooks; hooks = []; h.forEach(function (fn) { fn(); }); }
  function summary(items) {
    var list = items.filter(Boolean);
    if (!list.length) list = ['선택한 필터 조건에 해당하는 데이터가 부족해 해석을 생략합니다.'];
    return '<section class="summary" aria-label="분석 요약"><span class="eyebrow">Analysis</span><h2>분석 요약</h2><ol>' +
      list.map(function (t) { return '<li><span>' + t + '</span></li>'; }).join('') + '</ol></section>';
  }
  function b(x) { return '<b>' + x + '</b>'; }
  function pctTxt(v, d) { return Fm.pct(v, d); }
  function ppTxt(v, d) { return Fm.pp(v, d); }

  /* ==================================================================
   * 01 종합 현황
   * ================================================================== */
  var KPI_GO = { sameDay: 'orders', lead: 'orders', b2bOnTime: 'b2b', misRate: 'issues', matchRate: 'integrity', billDiff: 'settlement' };
  function kpiValueHtml(k) {
    if (k.na) return '<div class="kpi-value na">—</div>';
    var v = k.value;
    if (k.key === 'lead') return '<div class="kpi-value">' + Fm.num1(v) + '<small>시간</small></div>';
    if (k.key === 'misRate') return '<div class="kpi-value">' + pctSplit(v, 2) + '<small>%</small></div>';
    if (k.key === 'billDiff') return '<div class="kpi-value">' + Fm.int(v) + '<small>원</small></div>';
    return '<div class="kpi-value">' + pctSplit(v) + '<small>%</small></div>';
  }
  function kpiTargetText(k) {
    switch (k.key) {
      case 'lead': return '목표 ' + k.target + '시간 이내';
      case 'misRate': return '목표 ' + Fm.pct(k.target, 2) + ' 이하';
      case 'billDiff': return '목표 0원 (청구 = 실적)';
      default: return '목표 ' + Fm.pct(k.target) + ' 이상';
    }
  }
  function kpiDeltaText(k) {
    if (k.delta === null) return '전월 비교 불가';
    var d = k.delta, txt;
    if (k.key === 'lead') txt = (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d).toFixed(1) + '시간';
    else if (k.key === 'misRate') txt = Fm.pp(d, 2);
    else if (k.key === 'billDiff') txt = Fm.signed(d) + '원';
    else txt = Fm.pp(d);
    var better = k.key === 'billDiff' ? Math.abs(k.monthValue) < Math.abs(k.prevValue) : (k.dir === 'up' ? d > 0 : d < 0);
    var same = Math.abs(d) < 1e-9;
    return Fm.month(k.month) + ' vs ' + Fm.month(k.prevMonth) + ' <b>' + txt + '</b> ' + (same ? '변동 없음' : better ? '<span class="up">▲ 개선</span>' : '<span class="down">▼ 악화</span>');
  }
  function kpiDetailText(k) {
    var d = k.detail;
    if (!d) return '';
    switch (k.key) {
      case 'sameDay': return Fm.int(d.num) + ' / ' + Fm.int(d.den) + '건 (마감 전 주문)';
      case 'lead': return '출고 완료 ' + Fm.int(d.n) + '건 평균';
      case 'b2bOnTime': return Fm.int(d.num) + ' / ' + Fm.int(d.den) + '건 (만기 도래 발주)';
      case 'misRate': return '오출고 ' + Fm.int(d.num) + ' / 출고 ' + Fm.int(d.den) + '건';
      case 'matchRate': return Fm.int(d.num) + ' / ' + Fm.int(d.den) + ' SKU (' + Fm.dateShort(F.to) + ' 기준)';
      case 'billDiff': return d.months.length + '개월 · 차이 항목 ' + d.lines + '건';
    }
    return '';
  }
  function kpiScopeText(k) {
    if (k.scope === 'b2c') return 'B2C';
    if (k.scope === 'b2b') return 'B2B';
    var notes = [];
    if (F.channel !== 'ALL') notes.push('채널 무관');
    if (k.key === 'billDiff' && F.product !== 'ALL') notes.push('상품 무관');
    return '센터' + (notes.length ? ' · ' + notes.join(' · ') : '');
  }
  function kpiCard(k) {
    var na = k.na ? (k.scope === 'b2c' ? 'B2B 채널 선택 중 — B2C 지표 해당 없음' : 'B2C 채널 선택 중 — B2B 지표 해당 없음') : '';
    return '<div class="kpi' + (k.na ? '' : ' ' + k.status) + '">' +
      '<div class="kpi-top"><span class="kpi-label">' + esc(k.label) + '</span><span class="kpi-scope">' + esc(kpiScopeText(k)) + '</span></div>' +
      kpiValueHtml(k) +
      (k.na ? '<div class="kpi-meta">' + esc(na) + '</div>' :
        '<div class="kpi-meta"><span>' + esc(kpiTargetText(k)) + '</span></div>' +
        '<div class="kpi-meta"><span>' + kpiDeltaText(k) + '</span></div>' +
        '<div class="kpi-meta"><span>' + esc(kpiDetailText(k)) + '</span></div>') +
      '<div class="kpi-foot">' + (k.na ? statusHtml(null) : statusHtml(k.status, k.status === 'ok' ? '정상 · 목표 달성' : k.status === 'warn' ? '주의 · 목표 미달' : '위험 · 목표 미달')) +
      '<button type="button" class="link-btn" data-go="' + KPI_GO[k.key] + '">원인 보기</button></div>' +
      '</div>';
  }

  function actionRows() {
    var a = S.actionList(F), rows = [];
    a.pendingOrders.forEach(function (r) {
      rows.push({ group: '미출고 주문', id: r.id, target: r.channel, content: r.stage + ' · ' + r.reason,
        due: '경과 ' + Fm.num1(r.elapsedH) + '시간', status: r.elapsedH > 72 ? 'risk' : 'warn', go: 'orders', sortKey: -r.elapsedH });
    });
    a.b2bDue.forEach(function (r) {
      var dueTxt = r.req < END ? '요청일 ' + mmdd(r.req) + ' 경과' : r.req === END ? '오늘 납품 요청' : '요청일 ' + Fm.dateShort(r.req);
      rows.push({ group: 'B2B 납품 임박', id: r.id, target: r.account, content: skuName(r.sku) + ' ' + Fm.int(r.qty) + '개 · 출고 예정 ' + mmdd(r.shipDay) + (r.risk !== 'ok' ? ' · 재고 ' + (r.risk === 'risk' ? '부족' : '안전 재고 하회') : ''),
        due: dueTxt, status: r.risk === 'risk' || r.req < END ? 'risk' : r.risk === 'warn' || r.req <= END + 1 ? 'warn' : 'ok', go: 'b2b', sortKey: r.req });
    });
    a.openMismatches.forEach(function (m) {
      rows.push({ group: '미해결 불일치', id: m.id, target: skuName(m.sku), content: M.causes[m.cause].label + ' · ' + m.qty + '개 (' + M.stages[m.stage - 1] + ' 단계)',
        due: '발견 후 ' + (END - m.detect) + '일', status: END - m.detect > 7 ? 'risk' : 'warn', go: 'integrity', sortKey: m.detect });
    });
    a.overdueIssues.forEach(function (it) {
      rows.push({ group: '기한 초과 이슈', id: it.id, target: chName(it.channel), content: it.type + ' · ' + it.cause + ' → ' + it.nextAction,
        due: '기한 ' + mmdd(it.due) + ' (' + (END - it.due) + '일 초과)', status: 'risk', go: 'issues', sortKey: it.due });
    });
    a.pendingBilling.forEach(function (bl) {
      rows.push({ group: '검증 대기 청구', id: bl.id, target: '3PL ' + Fm.month(bl.month) + ' 청구', content: bl.item + (bl.hasDiff ? ' · 실적 대비 ' + (bl.diffQty ? Fm.signed(bl.diffQty) + bl.unit : '단가 ' + Fm.signed(bl.priceDiff) + '원') + ' (' + Fm.signed(bl.diffAmt) + '원)' : ' · 실적 대사 필요'),
        due: '10월 정산 마감 전', status: bl.hasDiff ? 'risk' : 'warn', go: 'settlement', sortKey: -Math.abs(bl.diffAmt) });
    });
    var order = { risk: 0, warn: 1, ok: 2 };
    var gOrder = ['미출고 주문', 'B2B 납품 임박', '미해결 불일치', '기한 초과 이슈', '검증 대기 청구'];
    rows.sort(function (x, y) { return order[x.status] - order[y.status] || gOrder.indexOf(x.group) - gOrder.indexOf(y.group) || x.sortKey - y.sortKey; });
    return { rows: rows, groups: gOrder, a: a };
  }

  RENDER.overview = function () {
    var k = S.kpis(F);
    var h = section({
      en: 'Key Metrics', ko: '핵심 지표',
      desc: '카드 수치는 선택 기간 기준입니다. 전월 대비는 기간 종료일이 속한 달(월초~종료일)과 직전 달을 비교합니다. 목표에 못 미치면 상태를 함께 표시합니다.',
      body: '<div class="kpi-grid">' + k.map(kpiCard).join('') + '</div>'
    });

    h += section({
      en: 'Trend', ko: '출고·납기 추이',
      desc: '당일 출고율(B2C)과 B2B 납기 준수율을 ' + (F.days <= 31 ? '일' : '주') + ' 단위로 비교합니다. 회색 점선은 목표 95%입니다.',
      body: panel('당일 출고율 · B2B 납기 준수율', F.days <= 31 ? '일별' : '주별 (월요일 시작)', chartBox('chOvTrend', '', '당일 출고율과 B2B 납기 준수율 추이'))
    });
    hook(function () { drawOverviewTrend(); });

    var ar = actionRows();
    h += section({
      en: "Today's Actions", ko: '오늘 조치할 목록',
      desc: '기준 시각 ' + M.nowLabel + ' 현재 상태입니다(기간 필터 미적용, 채널·상품 필터 적용). 타일을 누르면 해당 구분만 표시합니다.',
      body: block('blk-actions', function () { return actionBlock(ar); })
    });

    h += summary(overviewSummary(k, ar));
    return h;
  };
  function actionBlock(ar) {
    var g = state.local.actionGroup;
    var tiles = '<div class="action-tiles">' + ar.groups.map(function (name) {
      var list = ar.rows.filter(function (r) { return r.group === name; });
      var risk = list.filter(function (r) { return r.status === 'risk'; }).length;
      return '<button type="button" class="action-tile" data-action-group="' + esc(name) + '" aria-pressed="' + (g === name) + '">' +
        '<div class="stat-label">' + esc(name) + '</div><div class="stat-value">' + Fm.int(list.length) + '<small>건</small></div>' +
        '<div class="stat-sub">' + (list.length ? (risk ? statusHtml('risk', '위험 ' + risk + '건') : statusHtml('warn', '확인 필요')) : statusHtml('ok', '없음')) + '</div></button>';
    }).join('') + '</div>';
    var rows = g === 'ALL' ? ar.rows : ar.rows.filter(function (r) { return r.group === g; });
    var cols = [
      { label: '구분', type: 'text', value: function (r) { return r.group; }, cls: 'nowrap' },
      { label: '대상 ID', type: 'text', value: function (r) { return r.id; }, cls: 'nowrap' },
      { label: '대상', type: 'text', value: function (r) { return r.target; } },
      { label: '내용', type: 'text', value: function (r) { return r.content; } },
      { label: '경과·기한', type: 'text', value: function (r) { return r.due; }, cls: 'nowrap' },
      statusCol('긴급도', function (r) { return r.status; }),
      { label: '화면', type: 'text', value: function (r) { return SCREENS.filter(function (s) { return s.id === r.go; })[0].ko; }, html: function (r) { return '<button type="button" class="link-btn" data-go="' + r.go + '">' + esc(SCREENS.filter(function (s) { return s.id === r.go; })[0].ko) + '</button>'; } }
    ];
    return tiles + (g !== 'ALL' ? '<p class="table-foot" style="margin:0 0 8px"><button type="button" class="link-btn" data-action-group="ALL">전체 구분 보기</button></p>' : '') +
      table('actions', { columns: cols, rows: rows, filename: fileName('종합현황', '오늘조치목록'), limit: 30, rowClass: function (r) { return r.status === 'risk' ? 'flag' : ''; } });
  }
  function drawOverviewTrend() {
    var P = CH.palette();
    var buckets = [];
    if (F.days <= 31) for (var d = F.from; d <= F.to; d++) buckets.push([d, d]);
    else {
      var d2 = F.from;
      while (d2 <= F.to) {
        var w = Cal.dowOf(d2), end = Math.min(F.to, d2 + ((7 - w) % 7));
        buckets.push([d2, end]); d2 = end + 1;
      }
    }
    var sd = [], bt = [];
    buckets.forEach(function (bk) {
      var G = S.withPeriod(F, bk[0], bk[1]);
      sd.push(F.b2c ? S.sameDayRate(G).value : null);
      var bo = F.b2b ? S.b2bOnTime(G) : null;
      bt.push(bo && bo.den >= 5 ? bo.value : null);   // 표본 5건 미만 구간은 제외
    });
    var labels = buckets.map(function (bk) { return mmdd(bk[0]); });
    var ds = [];
    if (F.b2c) ds.push({ type: 'line', label: '당일 출고율(B2C)', data: sd, borderColor: P.primary, backgroundColor: P.primary, spanGaps: true });
    if (F.b2b) ds.push({ type: 'line', label: 'B2B 납기 준수율', data: bt, borderColor: P.tone(2), backgroundColor: P.tone(2), borderDash: [6, 4], spanGaps: true });
    ds.push({ type: 'line', label: '목표 95%', data: labels.map(function () { return 0.95; }), borderColor: P.sub, borderDash: [3, 3], borderWidth: 1, pointRadius: 0 });
    var sc = CH.baseScales({ yFmt: function (v) { return Math.round(v * 100) + '%'; }, beginAtZero: false });
    var all = sd.concat(bt).filter(function (v) { return v !== null; });
    sc.y.min = Math.max(0, Math.floor((Math.min.apply(null, all.concat([0.95])) - 0.05) * 10) / 10);
    sc.y.max = 1;
    CH.render('chOvTrend', { type: 'line', data: { labels: labels, datasets: ds }, options: {
      scales: sc, interaction: { mode: 'index', intersect: false },
      plugins: { tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + Fm.pct(c.parsed.y); } } } }
    } });
  }
  function overviewSummary(k, ar) {
    var out = [];
    var get = function (key) { return k.filter(function (x) { return x.key === key; })[0]; };
    var sd = get('sameDay'), b2b = get('b2bOnTime'), mr = get('matchRate'), bd = get('billDiff');
    if (!sd.na) {
      var hr = S.hourlySameDay(F);
      var gap = hr.am !== null && hr.pm !== null ? hr.am - hr.pm : null;
      out.push('<span class="flow-tag">지표 → 원인 → 조치</span>당일 출고율은 ' + b(pctTxt(sd.value)) + '로 목표 95%' + (sd.value >= 0.95 ? '를 달성했습니다.' : '에 ' + b(Fm.pp(0.95 - sd.value).replace('+', '')) + ' 못 미칩니다.') +
        (gap !== null ? ' 12시 이전 주문은 ' + b(pctTxt(hr.am)) + '가 당일 출고되지만 12~14시 주문은 ' + b(pctTxt(hr.pm)) + '에 그칩니다. 13:00 수작업 출고 지시 배치 이후 등록된 주문이 14:00 마감을 놓치는 구조이므로, 발주 등록→출고 지시 자동 연동(또는 13:50 추가 배치)을 우선 과제로 제안합니다.' : ''));
    }
    if (!mr.na && mr.value !== null) {
      var open = ar.a.openMismatches;
      var setbom = open.filter(function (m) { return m.cause === 'SETBOM'; }).length;
      out.push('<span class="flow-tag">지표 → 원인 → 조치</span>시스템 재고 일치율은 ' + b(pctTxt(mr.value)) + '(' + mr.detail.num + '/' + mr.detail.den + ' SKU)입니다. 미해결 불일치 ' + b(open.length + '건') +
        (open.length ? ' 중 ' + b(setbom + '건') + '이 세트 구성품 차감 누락으로, 아직 ERP BOM 매핑을 하지 않은 데일리 케어 세트 계열에서 반복됩니다. 실사 조정만으로는 다시 어긋나므로 BOM 매핑을 먼저 마치는 것이 정상화의 조건입니다.' : '이며, 원인 조치가 끝난 SKU는 일치 상태를 유지하고 있습니다.'));
    }
    var parts = [];
    if (!b2b.na && b2b.value !== null) parts.push('B2B 납기 준수율은 ' + b(pctTxt(b2b.value)) + (b2b.value < 0.95 ? '로, 라이브·공동구매 직후 B2C 물량이 몰린 날 B2B 출고가 뒤로 밀린 영향이 큽니다(B2B 화면의 주간 부하 비교 참고)' : '로 목표를 달성했습니다'));
    if (bd.value) parts.push('3PL 청구 검증에서 ' + b(Fm.won(bd.detail.over)) + '의 과다 청구 항목을 찾았습니다(' + bd.detail.lines + '개 항목)');
    if (parts.length) out.push('<span class="flow-tag">지표 → 원인 → 조치</span>' + parts.join('. ') + '. 이 두 항목은 담당 업무 1·4(출고 일정 조율)와 담당 업무 6(정산 검증)에서 바로 회수·개선할 수 있는 금액과 건수입니다.');
    return out;
  }

  /* ==================================================================
   * 02 주문·발주·출고
   * ================================================================== */
  RENDER.orders = function () {
    if (!F.b2c) return naBox('B2B 채널이 선택되어 있습니다. 이 화면은 B2C 주문 기준이므로 채널을 "전체" 또는 B2C 채널로 바꾸면 표시됩니다.');
    var fn = S.funnel(F), hr = S.hourlySameDay(F), sd = S.sameDayRate(F), lead = S.avgLead(F);
    var c = fn.counts;
    var times = [fn.regMin / 60, fn.releaseH, fn.shipH];
    var maxI = times.indexOf(Math.max.apply(null, times.map(function (t) { return t || 0; })));
    function arrow(i, v, unit) {
      return '<div class="funnel-arrow' + (i === maxI ? ' bottleneck' : '') + '"><span class="arrow">→</span><b>' + (v === null ? '—' : Fm.num1(v)) + unit + '</b><span>평균 소요' + (i === maxI ? ' · 병목' : '') + '</span></div>';
    }
    function step(label, n, sub) { return '<div class="funnel-step">' + stat(label, Fm.int(n), '건', sub) + '</div>'; }
    var funnelHtml = '<div class="funnel">' +
      step('주문 수집', c.collected, '취소 ' + Fm.int(c.cancelled) + '건 포함') + arrow(0, fn.regMin, '분') +
      step('발주 등록', c.registered, 'OMS 자동 등록') + arrow(1, fn.releaseH, '시간') +
      step('출고 지시', c.released, '보류 ' + Fm.int(c.hold) + '건 별도') + arrow(2, fn.shipH, '시간') +
      step('출고 완료', c.shipped, '송장 미연동 ' + Fm.int(c.invoicePending) + '건') + '</div>';
    var h = section({
      en: 'Order Pipeline', ko: '주문 처리 단계',
      desc: '주문 수집 → 발주 등록 → 출고 지시 → 출고 완료 단계별 건수(기준 시각 현재 도달 여부)와 단계 간 평균 소요시간입니다. 가장 오래 걸리는 구간을 병목으로 표시합니다.',
      body: funnelHtml + '<div class="stat-row" style="margin-top:16px">' +
        stat('당일 출고율', pctSplit(sd.value), '%', Fm.int(sd.num) + ' / ' + Fm.int(sd.den) + '건') +
        stat('평균 출고 소요시간', Fm.num1(lead.value), '시간', '주문 → 출고 완료') +
        stat('12시 이전 주문 당일 출고율', pctSplit(hr.am), '%', Fm.int(hr.amN) + '건 기준') +
        stat('12~14시 주문 당일 출고율', pctSplit(hr.pm), '%', Fm.int(hr.pmN) + '건 기준') + '</div>'
    });

    var daily = S.dailyVsCapacity(F);
    var overDays = daily.filter(function (r) { return r.over; });
    var peak = daily.reduce(function (a, r) { return r.total > a.total ? r : a; }, { total: 0 });
    h += section({
      en: 'Demand vs Capacity', ko: '채널별 일 주문량과 3PL 일 처리량',
      desc: '막대는 선택 채널의 일 주문량, 회색 점선은 3PL 일 처리 가능 건수(' + Fm.int(M.CAPACITY) + '건)입니다. 음영은 전체 B2C 주문이 처리량을 넘은 날입니다.',
      body: panel('일 주문량 · 처리 가능량', '처리량 초과일 ' + overDays.length + '일 · 최대 ' + Fm.int(peak.total) + '건' + (peak.day !== undefined ? ' (' + Fm.dateShort(peak.day) + ', 처리량의 ' + (peak.total / M.CAPACITY).toFixed(1) + '배)' : ''),
        chartBox('chDaily', 'tall', '채널별 일 주문량과 3PL 처리량'))
    });
    hook(function () { drawDaily(daily); });

    h += section({
      en: 'Same-day Shipping by Hour', ko: '주문 시간대별 당일 출고율',
      desc: '출고 마감(14:00) 전 영업일 주문을 주문 시각별로 나눴습니다. 발주 등록 → 출고 지시는 하루 두 번(10:00, 13:00 전후) 수작업으로 업로드합니다.',
      body: panel('시간대별 당일 출고율', '0~13시 주문 (14시 이후 주문은 익일 출고 대상)', chartBox('chHourly', '', '주문 시간대별 당일 출고율'))
    });
    hook(function () { drawHourly(hr); });

    var pend = S.pendingOrders(F);
    var stageCnt = {};
    pend.forEach(function (r) { stageCnt[r.stage] = (stageCnt[r.stage] || 0) + 1; });
    var pendCols = [
      { label: '주문번호', type: 'text', value: function (r) { return r.id; }, cls: 'nowrap' },
      { label: '채널', type: 'text', value: function (r) { return r.channel; } },
      { label: '주문 일시', type: 'datetime', value: function (r) { return r.orderedAt; }, cls: 'nowrap' },
      { label: '경과(시간)', type: 'hours', value: function (r) { return r.elapsedH; } },
      { label: '단계', type: 'text', value: function (r) { return r.stage; } },
      { label: '사유', type: 'text', value: function (r) { return r.reason; } },
      { label: '상품', type: 'text', value: function (r) { return skuName(r.items[0][0]) + (r.items.length > 1 ? ' 외 ' + (r.items.length - 1) + '종' : ''); } },
      { label: '수량', type: 'int', value: function (r) { return r.qty; } },
      statusCol('상태', function (r) { return r.elapsedH > 72 ? 'risk' : r.elapsedH > 24 ? 'warn' : 'ok'; }, function (r) { return r.elapsedH > 72 ? '72시간 초과' : r.elapsedH > 24 ? '24시간 초과' : '정상 진행'; })
    ];
    h += section({
      en: 'Unshipped & On-hold', ko: '미출고·보류 주문',
      desc: '기준 시각 ' + M.nowLabel + ' 현재 출고되지 않은 주문입니다(기간 필터 미적용). 단계별: ' + Object.keys(stageCnt).map(function (s) { return s + ' ' + stageCnt[s] + '건'; }).join(' · '),
      body: table('pending', { columns: pendCols, rows: pend, filename: fileName('주문출고', '미출고보류주문'), limit: 15, rowClass: function (r) { return r.elapsedH > 72 ? 'flag' : ''; } })
    });

    var pc = S.prepackCompare(F);
    var pb = pc.before.live, pa = pc.after.live;
    h += section({
      en: 'Set Pre-packing', ko: '세트 사전 포장 도입 전후 출고 소요시간',
      desc: '2026-07-15부터 라이브·공동구매 세트를 방송 전 영업일과 매주 월요일에 미리 포장합니다. 라이브 주문의 평균 출고 소요시간을 도입 전후로 비교합니다.',
      body: '<div class="stat-row">' +
        stat('도입 전 라이브 주문 평균', pb ? Fm.num1(pb.avg) : '—', '시간', pb ? Fm.int(pb.n) + '건 · 48시간 초과 ' + pctTxt(pb.over48) : '기간 내 도입 전 데이터 없음') +
        stat('도입 후 라이브 주문 평균', pa ? Fm.num1(pa.avg) : '—', '시간', pa ? Fm.int(pa.n) + '건 · 48시간 초과 ' + pctTxt(pa.over48) : '기간 내 도입 후 데이터 없음') +
        stat('개선 폭', pb && pa ? Fm.num1(pb.avg - pa.avg) : '—', '시간', pb && pa ? '평균 ' + pctTxt((pb.avg - pa.avg) / pb.avg) + ' 단축' : '기간을 넓히면 비교할 수 있습니다') +
        stat('일반 주문 평균(참고)', pc.after.norm ? Fm.num1(pc.after.norm.avg) : pc.before.norm ? Fm.num1(pc.before.norm.avg) : '—', '시간', '라이브 외 주문') +
        '</div><div style="margin-top:16px">' + panel('라이브 일자별 평균 출고 소요시간', '진한 파랑 = 도입 후, 연한 파랑 = 도입 전', chartBox('chPrepack', '', '라이브 일자별 평균 출고 소요시간')) + '</div>'
    });
    hook(function () { drawPrepack(pc); });

    h += summary(ordersSummary(sd, hr, fn, overDays, daily, pc, pend));
    return h;
  };
  function dayLabels(rows) { return rows.map(function (r) { return mmdd(r.day); }); }
  function drawDaily(daily) {
    var P = CH.palette();
    var labels = dayLabels(daily);
    var ds = [];
    D.channels.b2c.forEach(function (c, i) {
      if (!F.b2cCh[i]) return;
      ds.push({ type: 'bar', label: c.name, data: daily.map(function (r) { return r.byCh[i]; }), backgroundColor: P.tone(i), stack: 'o', barPercentage: 1, categoryPercentage: 0.9 });
    });
    ds.push({ type: 'line', label: '3PL 일 처리 가능 건수', data: daily.map(function (r) { return r.capacity; }), borderColor: P.sub, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, spanGaps: false, stack: 'cap' });
    var bands = [];
    daily.forEach(function (r, i) { if (r.over) bands.push({ from: i, to: i, color: P.status('risk', 0.08) }); });
    var sc = CH.baseScales({ stacked: true, yFmt: function (v) { return Fm.int(v); } });
    CH.render('chDaily', { type: 'bar', data: { labels: labels, datasets: ds }, options: {
      scales: sc, interaction: { mode: 'index', intersect: false },
      plugins: {
        markers: { bands: bands },
        tooltip: { callbacks: {
          title: function (it) { var r = daily[it[0].dataIndex]; return Fm.dateShort(r.day) + (r.live ? ' · 라이브' : '') + (r.over ? ' · 처리량 초과' : ''); },
          label: function (c) { return c.dataset.label + ': ' + (c.parsed.y === null ? '휴무' : Fm.int(c.parsed.y) + '건'); },
          footer: function (it) { var r = daily[it[0].dataIndex]; return '전체 B2C 주문 ' + Fm.int(r.total) + '건 · 3PL 처리 ' + Fm.int(r.processedOrders) + '건'; }
        } }
      }
    } });
  }
  function drawHourly(hr) {
    var P = CH.palette();
    var rows = hr.hours.slice(0, 14);
    CH.render('chHourly', { type: 'bar', data: {
      labels: rows.map(function (r) { return r.hour + '시'; }),
      datasets: [{ label: '당일 출고율', data: rows.map(function (r) { return r.rate; }), backgroundColor: P.primary, maxBarThickness: 36 }]
    }, options: {
      scales: CH.baseScales({ yFmt: function (v) { return Math.round(v * 100) + '%'; }, yMax: 1 }),
      plugins: {
        legend: { display: false },
        markers: { hlines: [{ y: 0.95, label: '목표 95%' }], vlines: [{ index: 12.5, label: '13:00 출고 지시 배치' }] },
        tooltip: { callbacks: { label: function (c) { var r = rows[c.dataIndex]; return '당일 출고율 ' + Fm.pct(r.rate) + ' (' + Fm.int(r.sameDay) + '/' + Fm.int(r.eligible) + '건)'; } } }
      }
    } });
  }
  function drawPrepack(pc) {
    var P = CH.palette();
    var rows = pc.liveDays;
    var idx = -1;
    rows.forEach(function (r, i) { if (idx < 0 && r.after && i > 0) idx = i - 0.5; });
    CH.render('chPrepack', { type: 'bar', data: {
      labels: rows.map(function (r) { return mmdd(r.day); }),
      datasets: [
        { label: '도입 전', data: rows.map(function (r) { return r.after ? null : r.avgLead; }), backgroundColor: P.soft, skipNull: true, maxBarThickness: 28 },
        { label: '도입 후', data: rows.map(function (r) { return r.after ? r.avgLead : null; }), backgroundColor: P.primary, skipNull: true, maxBarThickness: 28 }
      ]
    }, options: {
      scales: CH.baseScales({ yFmt: function (v) { return v + 'h'; } }),
      plugins: {
        markers: { hlines: [{ y: 24, label: '목표 24시간' }], vlines: idx >= 0 ? [{ index: idx, label: '07/15 세트 사전 포장 도입' }] : [] },
        tooltip: { callbacks: { label: function (c) { var r = rows[c.dataIndex]; return '평균 ' + Fm.num1(r.avgLead) + '시간 · ' + Fm.int(r.n) + '건 · 최대 D+' + r.maxDays; } } }
      }
    } });
  }
  function ordersSummary(sd, hr, fn, overDays, daily, pc, pend) {
    var out = [];
    out.push('<span class="flow-tag">지표 → 원인</span>단계별 평균 소요시간은 수집→등록 ' + b(Fm.num1(fn.regMin) + '분') + ', 등록→지시 ' + b(Fm.num1(fn.releaseH) + '시간') + ', 지시→완료 ' + b(Fm.num1(fn.shipH) + '시간') + '으로 발주 등록 → 출고 지시 구간이 가장 깁니다. ' +
      (hr.am !== null && hr.pm !== null ? '12시 이전 주문의 당일 출고율은 ' + b(pctTxt(hr.am)) + ', 12~14시 주문은 ' + b(pctTxt(hr.pm)) + '로 ' + b(Fm.pp(hr.am - hr.pm).replace('+', '')) + ' 차이가 납니다. 3PL 처리 단계가 아니라 내부 수작업 지시 단계가 원인입니다.' : ''));
    var liveOver = overDays.filter(function (r) { return r.live; }).length;
    if (overDays.length) {
      var maxR = Math.max.apply(null, overDays.map(function (r) { return r.total / M.CAPACITY; }));
      out.push('<span class="flow-tag">지표 → 원인</span>기간 중 B2C 주문이 3PL 처리량을 넘은 날은 ' + b(overDays.length + '일') + '(라이브·공동구매 ' + liveOver + '일)이고, 최대 처리량의 ' + b(maxR.toFixed(1) + '배') + '까지 몰렸습니다. ' +
        (pc.before.live && pc.after.live ? '세트 사전 포장 도입 후 라이브 주문 평균 출고 소요시간이 ' + b(Fm.num1(pc.before.live.avg) + '→' + Fm.num1(pc.after.live.avg) + '시간') + ', 48시간 초과 비중이 ' + b(pctTxt(pc.before.live.over48) + '→' + pctTxt(pc.after.live.over48)) + '로 줄었습니다.' : '라이브 일정은 3PL과 최소 3영업일 전에 공유해 인력·세트 사전 포장을 준비해야 합니다.'));
    } else {
      out.push('<span class="flow-tag">지표</span>선택 기간에는 B2C 주문이 3PL 처리량을 넘은 날이 없습니다. 기간을 넓히면 라이브·공동구매 일자의 적체 패턴을 볼 수 있습니다.');
    }
    var long = pend.filter(function (r) { return r.elapsedH > 72; });
    out.push('<span class="flow-tag">조치</span>① 출고 지시를 OMS→WMS 자동 연동으로 바꾸거나 13:50 마지막 배치를 추가해 오후 주문 당일 출고율을 끌어올리고, ② 라이브 일정은 3PL과 미리 공유해 세트 사전 포장 물량을 확정합니다. ' +
      '③ 현재 72시간이 넘은 미출고 주문 ' + b(long.length + '건') + (long.length ? '(주로 ' + topKey(long, 'reason') + ')은 CS와 고객 안내 후 보류 해제 여부를 오늘 결정합니다.' : '은 없습니다.'));
    return out;
  }
  function topKey(list, key) {
    var m = {};
    list.forEach(function (r) { m[r[key]] = (m[r[key]] || 0) + 1; });
    return Object.keys(m).sort(function (a, b2) { return m[b2] - m[a]; })[0] || '';
  }

  /* ==================================================================
   * 03 B2B 거래처 입출고
   * ================================================================== */
  RENDER.b2b = function () {
    if (!F.b2b) return naBox('B2C 채널이 선택되어 있습니다. 이 화면은 약국·피부미용 의원·총판 B2B 발주 기준이므로 채널을 "전체" 또는 B2B 유형으로 바꾸면 표시됩니다.');
    var ot = S.b2bOnTime(F), vol = S.b2bVolume(F), shelf = S.shelfLife(F), inv = S.invoiceRecon(F), late = S.lateAccounts(F);
    var lateN = late.reduce(function (a, r) { return a + r.late; }, 0), openN = late.reduce(function (a, r) { return a + r.open; }, 0);
    var h = section({
      en: 'B2B Summary', ko: 'B2B 납품 현황',
      desc: '납품 요청일이 선택 기간 안이면서 기준일 이전인 발주(만기 도래 건)를 기준으로 합니다. 발주 1건 = 1개 SKU 라인입니다.',
      body: '<div class="stat-row">' +
        stat('B2B 납기 준수율', pctSplit(ot.value), '%', '요청일 이내 전량 납품 ' + Fm.int(ot.num) + '/' + Fm.int(ot.den) + '건') +
        stat('만기 도래 발주', Fm.int(vol.lines), '건', Fm.int(vol.qty) + '개') +
        stat('지연 납품', Fm.int(lateN), '건', '요청일 이후 납품') +
        stat('미납(현재)', Fm.int(openN), '건', '요청일 경과·미출고') +
        stat('분할 납품', Fm.int(vol.split), '건', '적재 한도·재고 부족') +
        stat('유통기한 기준 미달', Fm.int(shelf.below.length), '건', '잔여율 70% 미만 · ' + pctTxt(shelf.belowRate)) + '</div>'
    });

    var sch = S.b2bSchedule(F);
    h += section({
      en: 'Delivery Schedule', ko: '이번 주 · 다음 주 출고 일정표',
      desc: '미출고 B2B 발주를 출고 예정일에 배치했습니다(기간 필터 미적용). 가용 재고에서 B2C 일평균 출고와 앞선 B2B 출고를 차례로 빼서 재고가 모자라면 위험, 안전 재고 아래로 내려가면 주의로 표시합니다.',
      body: scheduleHtml(sch) + '<div style="margin-top:16px">' + table('schedule', {
        columns: [
          { label: '출고 예정일', type: 'date', value: function (r) { return r.shipDay; }, cls: 'nowrap' },
          { label: '발주번호', type: 'text', value: function (r) { return r.id; }, cls: 'nowrap' },
          { label: '거래처', type: 'text', value: function (r) { return r.account; } },
          { label: '유형', type: 'text', value: function (r) { return chName(r.type); } },
          { label: '지역', type: 'text', value: function (r) { return r.region; } },
          skuCol('상품'),
          { label: '수량', type: 'int', value: function (r) { return r.qty; } },
          { label: '납품 요청일', type: 'date', value: function (r) { return r.req; }, cls: 'nowrap' },
          { label: '출고 후 예상 재고', type: 'int', value: function (r) { return r.projectedLeft; } },
          statusCol('재고 위험', function (r) { return r.risk; }, function (r) { return r.risk === 'risk' ? '위험 · 재고 부족' : r.risk === 'warn' ? '주의 · 안전 재고 하회' : '정상'; }),
          { label: '비고', type: 'text', value: function (r) { return (r.overdue ? '요청일 경과 · ' : '') + (r.delayReason || ''); } }
        ], rows: sch.rows, filename: fileName('B2B', '출고일정표'), limit: 20, caption: '일정표 전체 목록',
        rowClass: function (r) { return r.risk === 'risk' ? 'flag' : ''; }
      }) + '</div>'
    });

    h += section({
      en: 'On-time Delivery', ko: '유형별 · 지역별 납기 준수율',
      desc: '회색 점선은 목표 95%입니다.',
      body: '<div class="grid-2">' + panel('거래처 유형별', '약국 · 피부미용 의원 · 총판', chartBox('chB2bType', 'short', '거래처 유형별 납기 준수율')) +
        panel('지역별', '거래처 소재지 기준', chartBox('chB2bRegion', 'short', '지역별 납기 준수율')) + '</div>'
    });
    var wl = S.weeklyLoad(F);
    h += section({
      en: 'B2C Load vs B2B', ko: 'B2C 주문 부하와 B2B 납기 준수율 (주별)',
      desc: '가로축은 주간 B2C 주문 건수 ÷ (3PL 일 처리량 × 영업일), 세로축은 같은 주 납품 요청 건의 납기 준수율입니다. 파란 점은 B2C 물량이 몰려 3PL 적체(연장 근무)가 발생한 주, 연한 점은 일반 주입니다.',
      body: panel('주별 분포', wl.length + '주 · 주당 B2B 만기 발주 5건 이상', chartBox('chB2bLoad', '', 'B2C 주문 부하와 B2B 납기 준수율'))
    });
    hook(function () { drawB2bCharts(wl); });

    h += section({
      en: 'Late & Missed Accounts', ko: '납품 지연 · 미납 상위 거래처',
      desc: '선택 기간 만기 도래 발주 중 지연 또는 미납이 있는 거래처를 지연·미납 건수 순으로 정렬했습니다.',
      body: table('lateAcc', {
        columns: [
          { label: '거래처', type: 'text', value: function (r) { return r.name; } },
          { label: '유형', type: 'text', value: function (r) { return chName(r.type); } },
          { label: '지역', type: 'text', value: function (r) { return r.region; } },
          { label: '발주 주기', type: 'text', value: function (r) { return r.cycle; } },
          { label: '희망 요일', type: 'text', value: function (r) { return r.pref; } },
          { label: '발주', type: 'int', value: function (r) { return r.n; } },
          { label: '지연', type: 'int', value: function (r) { return r.late; } },
          { label: '미납', type: 'int', value: function (r) { return r.open; } },
          { label: '준수율', type: 'pct', value: function (r) { return r.rate; } },
          { label: '평균 지연(일)', type: 'num1', value: function (r) { return r.avgDelay; } },
          { label: '주요 사유', type: 'text', value: function (r) { return r.topReason; } }
        ], rows: late, filename: fileName('B2B', '지연미납거래처'), limit: 15
      })
    });

    h += section({
      en: 'Lot & Shelf Life', ko: '납품 로트와 유통기한 잔여율',
      desc: '유통기한 잔여율 = 남은 유통기한 일수 ÷ 전체 유통기한 일수 (납품일 기준). 거래처 기준은 70% 이상입니다.',
      body: '<div class="grid-2">' + panel('납품 건 잔여율 분포', '선택 기간 납품 ' + Fm.int(shelf.total) + '건', chartBox('chShelf', 'short', '유통기한 잔여율 분포')) +
        panel('기준 미달 SKU', '잔여율 70% 미만 납품 건수', shelfSkuList(shelf)) + '</div><div style="margin-top:16px">' +
        table('shelf', {
          columns: [
            { label: '발주번호', type: 'text', value: function (r) { return r.id; }, cls: 'nowrap' },
            { label: '거래처', type: 'text', value: function (r) { return r.account; } },
            skuCol('상품'),
            { label: '납품일', type: 'date', value: function (r) { return r.deliver; }, cls: 'nowrap' },
            { label: '수량', type: 'int', value: function (r) { return r.qty; } },
            { label: '로트', type: 'text', value: function (r) { return r.lot; }, cls: 'nowrap' },
            { label: '제조일', type: 'date', value: function (r) { return r.mfg; }, cls: 'nowrap' },
            { label: '유통기한', type: 'date', value: function (r) { return r.exp; }, cls: 'nowrap' },
            { label: '잔여율', type: 'pct', value: function (r) { return r.ratio; } },
            { label: '거래처 기준', type: 'pct', value: function (r) { return r.min; } },
            statusCol('판정', function () { return 'risk'; }, function () { return '기준 미달'; })
          ], rows: shelf.below, filename: fileName('B2B', '유통기한기준미달'), limit: 15, caption: '기준 미달 납품', empty: '선택 기간에 기준 미달 납품이 없습니다.'
        }) + '</div>'
    });
    hook(function () { drawShelf(shelf); });

    h += section({
      en: 'Invoice Reconciliation', ko: '거래명세서와 실제 출고 수량 대사',
      desc: '첫 납품분의 거래명세서 기재 수량과 WMS 실제 출고 수량을 비교합니다.',
      body: '<div class="stat-row">' + stat('대사 건수', Fm.int(inv.n), '건') + stat('일치', Fm.int(inv.ok), '건', pctTxt(inv.rate)) +
        stat('불일치', Fm.int(inv.mismatch), '건', '수량 차이 합 ' + Fm.int(inv.diffQty) + '개') +
        stat('주요 원인', inv.rows.length ? esc(topKey(inv.rows, 'reason')) : '—', '', '') + '</div><div style="margin-top:16px">' +
        table('invoice', {
          columns: [
            { label: '발주번호', type: 'text', value: function (r) { return r.id; }, cls: 'nowrap' },
            { label: '거래처', type: 'text', value: function (r) { return r.account; } },
            skuCol('상품'),
            { label: '납품일', type: 'date', value: function (r) { return r.deliver; }, cls: 'nowrap' },
            { label: '명세서 수량', type: 'int', value: function (r) { return r.invoiceQty; } },
            { label: '실제 출고', type: 'int', value: function (r) { return r.shipQty; } },
            { label: '차이', type: 'signed', value: function (r) { return r.diff; } },
            { label: '차이 금액(공급가, 원)', type: 'won', value: function (r) { return r.amount; } },
            { label: '원인', type: 'text', value: function (r) { return r.reason; } },
            { label: '정정 조치', type: 'text', value: function (r) { return r.reason.indexOf('분할') >= 0 ? '잔량 납품분 별도 명세서 발행' : '수정 거래명세서 발행 · 영업 공유'; } }
          ], rows: inv.rows, filename: fileName('B2B', '거래명세서대사'), limit: 15, caption: '불일치 건', empty: '선택 기간에 불일치 건이 없습니다.'
        }) + '</div>'
    });

    h += summary(b2bSummary(ot, wl, late, shelf, inv, sch));
    return h;
  };
  function scheduleHtml(sch) {
    var h = '<div class="schedule">';
    var cells = sch.days;
    cells.forEach(function (c, i) {
      if (i === 0 || i === 5) h += '<div class="sched-week">' + (i === 0 ? '이번 주' : '다음 주') + ' · ' + mmdd(c.day) + ' ~ ' + mmdd(cells[Math.min(cells.length - 1, i + 4)].day) + '</div>';
      var past = c.day < END;
      var cls = 'sched-day' + (c.day === END ? ' today' : '') + (!c.biz || past ? ' off' : '');
      var body = '';
      if (!c.biz) body = '<p class="muted" style="padding:0 12px 12px;font-size:12px">휴일 · 출고 없음</p>';
      else if (past) {
        var done = 0;
        D.b2b.forEach(function (x) { if (F.b2bType[x.type] && F.sku[x.sku]) x.ships.forEach(function (s) { if (s.day === c.day) done++; }); });
        body = '<p class="muted" style="padding:0 12px 12px;font-size:12px">출고 완료 ' + Fm.int(done) + '건</p>';
      } else {
        body = '<ul class="sched-list">' + c.items.map(function (r) {
          return '<li><span class="acc" title="' + esc(r.account) + '">' + esc(r.account) + '</span><span class="num">' + Fm.int(r.qty) + '</span>' +
            '<span class="meta">' + esc(skuName(r.sku)) + (r.risk !== 'ok' ? ' ' + statusHtml(r.risk, r.risk === 'risk' ? '재고 부족' : '안전 재고 하회') : '') + (r.overdue ? ' <span class="tag solid">요청일 경과</span>' : '') + '</span></li>';
        }).join('') + '</ul>';
      }
      var riskN = c.items.filter(function (r) { return r.risk === 'risk'; }).length;
      h += '<div class="' + cls + '"><div class="sched-head"><span class="sched-date">' + Fm.dateShort(c.day) + (c.day === END ? ' · 오늘' : '') + '</span>' +
        '<span class="sched-count">' + (c.biz && !past ? Fm.int(c.items.length) + '건' + (riskN ? ' · 위험 ' + riskN : '') : '') + '</span></div>' + body + '</div>';
    });
    h += '</div><div class="sched-legend">' + statusHtml('risk', '위험 · 출고 시점 재고 부족') + statusHtml('warn', '주의 · 안전 재고 하회') + '<span><span class="tag solid">요청일 경과</span> 납품 요청일이 지난 미납 건</span></div>';
    return h;
  }
  function shelfSkuList(shelf) {
    var keys = Object.keys(shelf.bySku).sort(function (a, c) { return shelf.bySku[c] - shelf.bySku[a]; });
    if (!keys.length) return '<p class="muted" style="font-size:13px">선택 기간에는 기준 미달 납품이 없습니다.</p>';
    return '<div class="table-wrap"><table class="data"><thead><tr><th>상품</th><th class="r">기준 미달 건</th><th>권장 조치</th></tr></thead><tbody>' +
      keys.map(function (s) {
        return '<tr><td>' + esc(skuName(+s)) + '</td><td class="r">' + shelf.bySku[s] + '</td><td>잔여율 70% 이상 로트 지정 출고 · 장기 로트는 B2C 프로모션 전환</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function drawB2bCharts(wl) {
    var P = CH.palette();
    var typ = S.complianceByType(F).filter(function (r) { return F.b2bType[r.key]; });
    var reg = S.complianceByRegion(F);
    var pctOpt = function (rows) {
      return {
        scales: CH.baseScales({ yFmt: function (v) { return Math.round(v * 100) + '%'; }, yMax: 1 }),
        plugins: { legend: { display: false }, markers: { hlines: [{ y: 0.95, label: '목표 95%' }] },
          tooltip: { callbacks: { label: function (c) { var r = rows[c.dataIndex]; return '준수율 ' + Fm.pct(r.rate) + ' (' + r.ok + '/' + r.n + '건)'; } } } }
      };
    };
    CH.render('chB2bType', { type: 'bar', data: { labels: typ.map(function (r) { return chName(r.key); }), datasets: [{ label: '납기 준수율', data: typ.map(function (r) { return r.rate; }), backgroundColor: P.primary, maxBarThickness: 48 }] }, options: pctOpt(typ) });
    CH.render('chB2bRegion', { type: 'bar', data: { labels: reg.map(function (r) { return r.key; }), datasets: [{ label: '납기 준수율', data: reg.map(function (r) { return r.rate; }), backgroundColor: P.primary, maxBarThickness: 36 }] }, options: pctOpt(reg) });
    var liveW = wl.filter(function (w) { return w.overtime > 0; }), normW = wl.filter(function (w) { return !w.overtime; });
    var pt = function (w) { return { x: w.load, y: w.rate, w: w }; };
    CH.render('chB2bLoad', { type: 'scatter', data: { datasets: [
      { label: '3PL 적체 발생 주', data: liveW.map(pt), backgroundColor: P.primary, pointRadius: 5, pointHoverRadius: 7 },
      { label: '일반 주', data: normW.map(pt), backgroundColor: P.soft, pointRadius: 5, pointHoverRadius: 7 }
    ] }, options: {
      scales: {
        x: { type: 'linear', grid: { color: P.grid }, border: { display: false }, title: { display: true, text: 'B2C 주문 부하 (주문 ÷ 처리 가능량)', color: P.sub }, ticks: { callback: function (v) { return Math.round(v * 100) + '%'; } } },
        y: { grid: { color: P.grid }, border: { display: false }, max: 1, title: { display: true, text: 'B2B 납기 준수율', color: P.sub }, ticks: { callback: function (v) { return Math.round(v * 100) + '%'; } } }
      },
      plugins: { markers: { hlines: [{ y: 0.95, label: '목표 95%' }] },
        tooltip: { callbacks: { label: function (c) { var w = c.raw.w; return mmdd(w.week) + ' 주 · 적체 ' + w.overtime + '일 · 라이브 ' + w.live + '회 · 부하 ' + Fm.pct(w.load, 0) + ' · 준수율 ' + Fm.pct(w.rate) + ' (' + w.ok + '/' + w.n + ')'; } } } }
    } });
  }
  function drawShelf(shelf) {
    var P = CH.palette();
    CH.render('chShelf', { type: 'bar', data: { labels: shelf.buckets.map(function (x) { return x.label; }),
      datasets: [{ label: '납품 건수', data: shelf.buckets.map(function (x) { return x.n; }), backgroundColor: P.primary, maxBarThickness: 56 }] },
      options: { scales: CH.baseScales({ yFmt: function (v) { return Fm.int(v); } }), plugins: { legend: { display: false },
        markers: { vlines: [{ index: 1.5, label: '거래처 기준 70%' }] },
        tooltip: { callbacks: { label: function (c) { return Fm.int(c.parsed.y) + '건'; } } } } } });
  }
  function b2bSummary(ot, wl, late, shelf, inv, sch) {
    var out = [];
    var liveW = wl.filter(function (w) { return w.overtime; }), normW = wl.filter(function (w) { return !w.overtime; });
    var avg = function (a) { var n = 0, o = 0; a.forEach(function (w) { n += w.n; o += w.ok; }); return n ? o / n : null; };
    var lv = avg(liveW), nv = avg(normW);
    if (ot.value !== null) out.push('<span class="flow-tag">지표 → 원인</span>B2B 납기 준수율은 ' + b(pctTxt(ot.value)) + '입니다. ' +
      (lv !== null && nv !== null ? 'B2C 물량이 몰려 3PL 적체가 생긴 주(' + liveW.length + '주)는 ' + b(pctTxt(lv)) + ', 일반 주(' + normW.length + '주)는 ' + b(pctTxt(nv)) + '로, 라이브·공동구매 직후 B2C 적체를 먼저 처리하느라 B2B 출고가 후순위로 밀립니다.' : '선택 기간에는 적체 주와 일반 주를 비교할 표본이 부족합니다.') +
      (late.length ? ' 지연·미납 1위 거래처는 ' + b(esc(late[0].name)) + '(' + late[0].late + '건 지연, ' + late[0].open + '건 미납)이며 주요 사유는 "' + esc(late[0].topReason) + '"입니다.' : ''));
    var riskRows = sch.rows.filter(function (r) { return r.risk === 'risk'; });
    out.push('<span class="flow-tag">지표 → 조치</span>향후 2주 출고 일정 ' + b(sch.rows.length + '건') + ' 중 재고 부족 위험이 ' + b(riskRows.length + '건') +
      (riskRows.length ? '(' + esc(skuName(riskRows[0].sku)) + ' 중심)입니다. 영업과 납품일 조정·분할 납품 여부를 미리 협의하고, 라이브 일정이 잡힌 주에는 B2B 출고 슬롯을 먼저 확보하도록 3PL 작업 순서를 고정할 것을 제안합니다.' : '로 재고 측면의 위험은 없습니다. 라이브 일정이 잡힌 주에는 B2B 출고 슬롯을 먼저 확보하도록 3PL 작업 순서를 고정할 것을 제안합니다.'));
    var shelfTxt = shelf.below.length ? '유통기한 잔여율 70% 미만 납품이 ' + b(shelf.below.length + '건') + '(' + pctTxt(shelf.belowRate) + ') 있었고 ' + esc(Object.keys(shelf.bySku).map(function (s) { return skuName(+s); }).slice(0, 2).join(', ')) + '에 집중됩니다. 저회전 SKU의 장기 로트가 선입선출로 B2B에 먼저 나간 결과이므로, B2B 출고는 잔여율 기준 로트 지정(FEFO 예외)으로 바꿔야 합니다.' : '유통기한 잔여율 기준 미달 납품은 없습니다.';
    out.push('<span class="flow-tag">지표 → 조치</span>' + shelfTxt + ' 거래명세서 대사에서는 ' + b(inv.mismatch + '건') + '의 수량 불일치가 있었고' + (inv.rows.length ? ', 주요 원인은 "' + esc(topKey(inv.rows, 'reason')) + '"입니다.' : '.'));
    return out;
  }

  /* ==================================================================
   * 04 재고 운영
   * ================================================================== */
  RENDER.inventory = function () {
    var st = S.stockStatusRows(F), sell = S.sellable(F), risk = S.stockoutRisk(F), inb = S.inboundRows(F);
    var tot = st.reduce(function (a, r) { a.av += r.available; a.h += r.hold; a.d += r.defect; a.r += r.returnWait; return a; }, { av: 0, h: 0, d: 0, r: 0 });
    var chNote = F.channel !== 'ALL' ? ' ' + scopeTag('재고는 센터 단위 · 채널 필터 미적용') : '';
    var h = section({
      en: 'Stock by Status', ko: 'SKU별 현재고 (상태별)',
      desc: '기준일 ' + M.endIso + ' 마감 재고입니다. 세트는 사전 포장 완료 재고만 표시합니다(구성품 재고는 각 단품에 포함).' + chNote,
      body: '<div class="stat-row">' + stat('가용', Fm.int(tot.av), '개') + stat('보류', Fm.int(tot.h), '개', '품질 재검사 등') + stat('불량', Fm.int(tot.d), '개', '월말 폐기 대상') + stat('반품 대기', Fm.int(tot.r), '개', '검수 전 반품') + '</div>' +
        '<div class="grid-2" style="margin-top:16px">' + panel('상태별 재고', '가용 · 보류 · 불량 · 반품 대기', chartBox('chStock', 'xtall', 'SKU별 상태별 재고')) +
        '<div>' + table('stock', {
          columns: [skuCol('상품'), { label: '가용', type: 'int', value: function (r) { return r.available; } }, { label: '보류', type: 'int', value: function (r) { return r.hold; } },
            { label: '불량', type: 'int', value: function (r) { return r.defect; } }, { label: '반품 대기', type: 'int', value: function (r) { return r.returnWait; } },
            { label: '합계', type: 'int', value: function (r) { return r.total; } }, { label: '보류 사유', type: 'text', value: function (r) { return r.holdReason || ''; } }],
          rows: st, filename: fileName('재고운영', '상태별재고'), limit: 0, scroll: true
        }) + '</div></div>'
    });
    hook(function () { drawStock(st); });

    var shareLbl = D.channels.b2c.map(function (c) { return c.name; });
    h += section({
      en: 'Sellable Stock by Channel', ko: '채널별 가용 재고 (판매 가능 수량)',
      desc: '판매 가능 수량 = 현재고(가용) − B2B 확정 발주(미출고 잔량) − 안전 재고. B2C 채널 배분은 최근 28일 채널별 판매 비중을 따릅니다. 세트는 사전 포장 재고 + 구성품으로 추가 작업할 수 있는 수량입니다.',
      body: table('sellable', {
        columns: [skuCol('상품'),
          { label: '가용', type: 'int', value: function (r) { return r.available; } },
          { label: 'B2B 확정 발주', type: 'int', value: function (r) { return SK[r.sku].isSet ? null : r.confirmedB2B; } },
          { label: '안전 재고', type: 'int', value: function (r) { return SK[r.sku].isSet ? null : r.safety; } },
          { label: '판매 가능', type: 'int', value: function (r) { return r.sellable; }, cls: 'strong' }
        ].concat(shareLbl.map(function (n, i) { return { label: n, type: 'int', value: function (r) { return r.byChannel[i]; } }; })).concat([
          statusCol('상태', function (r) { return r.sellable < 0 ? 'risk' : r.sellable < r.safety ? 'warn' : 'ok'; }, function (r) { return r.sellable < 0 ? '위험 · B2B 확정분 부족' : r.sellable < r.safety ? '주의 · 여유 적음' : '정상'; })
        ]),
        rows: sell, filename: fileName('재고운영', '채널별가용재고'), limit: 0, scroll: true,
        rowClass: function (r) { return r.sellable < 0 ? 'flag' : ''; }
      })
    });

    h += section({
      en: 'Stock-out Risk', ko: '품절 위험 SKU와 품절 예상일',
      desc: '가용 재고에서 B2C 일평균 출고(최근 28일, 영업일 환산)와 B2B 확정 발주를 출고 예정일에 빼고, 입고 예정 수량을 더해 45일을 추정합니다. 다음 입고 전에 재고가 0 아래로 내려가면 위험입니다.',
      body: table('risk', {
        columns: [skuCol('상품'),
          statusCol('판정', function (r) { return r.status; }, function (r) { return r.status === 'risk' ? '위험 · 입고 전 품절' : r.status === 'warn' ? '주의 · 안전 재고 하회' : '정상'; }),
          { label: '가용', type: 'int', value: function (r) { return SK[r.sku].isSet ? r.prepacked + r.buildable : r.available; } },
          { label: '일평균 출고', type: 'num1', value: function (r) { return SK[r.sku].isSet ? r.b2cAvg : r.dailyAvg; } },
          { label: '커버 일수', type: 'num1', value: function (r) { return r.coverDays; } },
          { label: 'B2B 확정 잔량', type: 'int', value: function (r) { return r.confirmedB2B; } },
          { label: '품절 예상일', type: 'date', value: function (r) { return r.stockoutDay; }, cls: 'nowrap' },
          { label: '안전 재고 하회일', type: 'date', value: function (r) { return r.belowSafetyDay; }, cls: 'nowrap' },
          { label: '다음 입고', type: 'date', value: function (r) { return r.nextInbound ? r.nextInbound.day : null; }, cls: 'nowrap' },
          { label: '입고 수량', type: 'int', value: function (r) { return r.nextInbound ? r.nextInbound.qty : null; } },
          { label: '비고', type: 'text', value: function (r) { return (r.setBased ? '구성품 ' + skuName(r.limiting) + ' 기준 · ' : '') + (r.nextInbound && r.nextInbound.reason ? r.nextInbound.reason : ''); } }
        ], rows: risk, filename: fileName('재고운영', '품절위험'), limit: 0, scroll: true,
        rowClass: function (r) { return r.status === 'risk' ? 'flag' : ''; }
      })
    });

    var singles = risk.filter(function (r) { return !SK[r.sku].isSet; });
    if (state.local.simSku === null || !F.sku[state.local.simSku] || SK[state.local.simSku].isSet) state.local.simSku = singles.length ? singles[0].sku : SK.filter(function (k) { return !k.isSet; })[0].idx;
    var sim0 = S.simulate(state.local.simSku, 0.5);
    if (state.local.simShare === null) state.local.simShare = Math.min(100, Math.ceil(sim0.needShare * 20) * 5);
    h += section({
      en: 'Allocation Simulator', ko: 'B2C · B2B 재고 배분 시뮬레이터',
      desc: '향후 28일 공급(현재 가용 + 기간 내 입고 예정)을 B2B와 B2C에 나누는 비율을 바꾸면 B2B 미납 수량과 B2C 품절 시점이 어떻게 바뀌는지 보여줍니다. B2B 수요는 확정 발주 + 미확정 구간의 최근 28일 평균입니다.',
      body: '<div class="sim"><div class="sim-controls">' +
        '<div class="field"><label for="simSku">상품</label><select id="simSku" class="inline-select" data-sim="sku">' +
        SK.filter(function (k) { return !k.isSet && F.sku[k.idx]; }).map(function (k) { return '<option value="' + k.idx + '"' + (k.idx === state.local.simSku ? ' selected' : '') + '>' + esc(k.name) + '</option>'; }).join('') + '</select></div>' +
        '<div><div class="sim-share"><span>B2B 배분 비율</span><b id="simShareTxt">' + state.local.simShare + '%</b></div>' +
        '<input type="range" min="0" max="100" step="5" value="' + state.local.simShare + '" data-sim="share" aria-label="B2B 배분 비율"></div>' +
        '<p class="muted" style="font-size:12px">B2B 확정 발주를 모두 채우려면 공급의 <b id="simNeed">' + Fm.pct(sim0.needShare, 0) + '</b>가 필요합니다. 비율을 낮추면 B2C 품절이 늦춰지는 대신 B2B 미납이 생깁니다.</p>' +
        '</div>' + block('blk-sim', simResultHtml) + '</div>'
    });

    var im = S.inboundMonthly(F);
    h += section({
      en: 'Inbound vs Plan', ko: '입고 예정 대비 실제 입고 · 검수 수량 차이',
      desc: '입고 예정일 기준입니다. 검수 수량 = 예정 수량 − 공급사 부족 − 검수 불량. 미입고 지연 건과 기준일 이후 입고 예정 건도 함께 표시합니다.',
      body: panel('월별 예정 · 검수 수량', '회색 = 예정, 파랑 = 검수 완료', chartBox('chInbound', 'short', '월별 입고 예정 대비 검수 수량')) + '<div style="margin-top:16px">' +
        table('inbound', {
          columns: [
            { label: '입고번호', type: 'text', value: function (r) { return r.id; }, cls: 'nowrap' }, skuCol('상품'),
            { label: '입고 예정일', type: 'date', value: function (r) { return r.planned; }, cls: 'nowrap' },
            { label: '실제 입고일', type: 'date', value: function (r) { return r.actual; }, cls: 'nowrap' },
            { label: '지연(일)', type: 'int', value: function (r) { return r.delayDays; } },
            { label: '예정 수량', type: 'int', value: function (r) { return r.plannedQty; } },
            { label: '검수 수량', type: 'int', value: function (r) { return r.inspectedQty; } },
            { label: '차이', type: 'signed', value: function (r) { return r.diff; } },
            { label: '차이 사유', type: 'text', value: function (r) { return r.reason; } },
            { label: '상태', type: 'text', value: function (r) { return r.status; } },
            { label: '지연 사유', type: 'text', value: function (r) { return r.delayReason; } }
          ], rows: inb, filename: fileName('재고운영', '입고예정대비실적'), limit: 25,
          rowClass: function (r) { return r.status === '지연(미입고)' || (r.diff && r.diff < 0) ? 'flag' : ''; }
        }) + '</div>'
    });
    hook(function () { drawInbound(im); drawSim(); });

    h += summary(inventorySummary(risk, sell, inb, tot));
    return h;
  };
  function simResultHtml() {
    var r = S.simulate(state.local.simSku, state.local.simShare / 100);
    var full = S.simulate(state.local.simSku, r.needShare);
    return '<div><div class="stat-row">' +
      stat('공급 가능(28일)', Fm.int(r.supplyNow + r.inboundQty), '개', '현재 ' + Fm.int(r.supplyNow) + ' + 입고 ' + Fm.int(r.inboundQty)) +
      stat('B2B 수요(28일)', Fm.int(r.b2bDemand), '개', '배분 ' + Fm.int(r.b2bAlloc) + '개') +
      stat('B2B 미납 예상', Fm.int(r.b2bShort), '개', r.b2bShort ? statusHtml('risk', '미납 발생') : statusHtml('ok', '전량 충족')) +
      stat('B2C 품절 예상일', r.b2cStockout ? Fm.dateShort(r.b2cStockout) : '28일 내 없음', '', 'B2B 전량 충족 시 ' + (full.b2cStockout ? Fm.dateShort(full.b2cStockout) : '28일 내 없음')) +
      '</div><div style="margin-top:16px">' + panel('B2C 배분 재고 추이', '파란 실선 = 현재 비율, 회색 점선 = B2B 전량 충족 비율(' + Fm.pct(r.needShare, 0) + ')', chartBox('chSim', 'short', 'B2C 배분 재고 추이')) + '</div></div>';
  }
  function drawSim() {
    var P = CH.palette();
    var r = S.simulate(state.local.simSku, state.local.simShare / 100);
    var full = S.simulate(state.local.simSku, r.needShare);
    var labels = r.series.map(function (v, i) { return mmdd(END + i); });
    CH.render('chSim', { type: 'line', data: { labels: labels, datasets: [
      { label: '현재 비율 (B2B ' + state.local.simShare + '%)', data: r.series, borderColor: P.primary, backgroundColor: P.primary },
      { label: 'B2B 전량 충족 (' + Fm.pct(r.needShare, 0) + ')', data: full.series, borderColor: P.sub, borderDash: [5, 4], backgroundColor: P.sub }
    ] }, options: { scales: CH.baseScales({ beginAtZero: false, yFmt: function (v) { return Fm.int(v); } }), interaction: { mode: 'index', intersect: false },
      plugins: { markers: { hlines: [{ y: 0, label: '품절선', color: P.text }] }, tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + Fm.int(c.parsed.y) + '개'; } } } } } });
  }
  function drawStock(st) {
    var P = CH.palette();
    var labels = st.map(function (r) { return skuName(r.sku); });
    var keys = [['available', '가용'], ['hold', '보류'], ['defect', '불량'], ['returnWait', '반품 대기']];
    var sc = CH.baseScales({ stacked: true });
    CH.render('chStock', { type: 'bar', data: { labels: labels, datasets: keys.map(function (k, i) {
      return { label: k[1], data: st.map(function (r) { return r[k[0]]; }), backgroundColor: P.tone(i), stack: 's', barPercentage: 0.8 };
    }) }, options: {
      indexAxis: 'y',
      scales: { x: { stacked: true, grid: { color: P.grid }, border: { display: false }, ticks: { callback: function (v) { return Fm.int(v); } } },
        y: { stacked: true, grid: { display: false }, ticks: { autoSkip: false, font: { size: 11 } } } },
      interaction: { mode: 'index', intersect: false },
      plugins: { tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + Fm.int(c.parsed.x) + '개'; } } } }
    } });
    void sc;
  }
  function drawInbound(im) {
    var P = CH.palette();
    CH.render('chInbound', { type: 'bar', data: { labels: im.map(function (r) { return Fm.month(r.month); }), datasets: [
      { label: '예정 수량', data: im.map(function (r) { return r.plannedQty; }), backgroundColor: P.plan, maxBarThickness: 28 },
      { label: '검수 수량', data: im.map(function (r) { return r.inspectedQty; }), backgroundColor: P.primary, maxBarThickness: 28 }
    ] }, options: { scales: CH.baseScales({ yFmt: function (v) { return Fm.int(v); } }), interaction: { mode: 'index', intersect: false },
      plugins: { tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + Fm.int(c.parsed.y) + '개'; }, footer: function (it) { var r = im[it[0].dataIndex]; return '입고 ' + r.n + '건 · 지연 ' + r.late + '건 · 수량 차이 ' + r.diffN + '건'; } } } } } });
  }
  function inventorySummary(risk, sell, inb, tot) {
    var out = [];
    var rk = risk.filter(function (r) { return r.status === 'risk' && !SK[r.sku].isSet; });
    var wn = risk.filter(function (r) { return r.status === 'warn' && !SK[r.sku].isSet; });
    if (rk.length) {
      var r0 = rk[0];
      out.push('<span class="flow-tag">지표 → 원인</span>' + b(esc(skuName(r0.sku))) + '은 가용 ' + b(Fm.int(r0.available) + '개') + '로 ' + b(Fm.num1(r0.coverDays) + '일') + '분이며, 품절 예상일 ' + b(Fm.dateShort(r0.stockoutDay)) + '이 다음 입고 ' + b(r0.nextInbound ? Fm.dateShort(r0.nextInbound.day) : '미정') + '보다 빠릅니다' +
        (r0.nextInbound && r0.nextInbound.reason ? '(' + esc(r0.nextInbound.reason) + ')' : '') + '. 이 SKU를 구성품으로 쓰는 세트도 같은 날 위험해집니다.' + (rk.length > 1 ? ' 그 밖의 위험 SKU ' + (rk.length - 1) + '종.' : ''));
    } else out.push('<span class="flow-tag">지표</span>선택한 상품에는 입고 전 품절이 예상되는 SKU가 없습니다.' + (wn.length ? ' 안전 재고 하회 예상 SKU는 ' + wn.length + '종입니다.' : ''));
    var neg = sell.filter(function (r) { return r.sellable < 0 && !SK[r.sku].isSet; });
    out.push('<span class="flow-tag">지표 → 조치</span>판매 가능 수량이 음수인 SKU는 ' + b(neg.length + '종') + (neg.length ? '(' + esc(neg.map(function (r) { return skuName(r.sku); }).slice(0, 3).join(', ')) + ')으로, B2B 확정 발주와 안전 재고를 지키면 B2C에 팔 재고가 없다는 뜻입니다. 배분 시뮬레이터에서 B2B 우선 비율을 정하고 영업·CS와 B2C 판매 제한(채널별 노출 수량) 시점을 합의해야 합니다.' : '입니다. B2B 확정분과 안전 재고를 뺀 뒤에도 B2C 판매 여유가 있습니다.'));
    var late = inb.filter(function (r) { return r.status === '지연(미입고)' || r.status === '지연 입고'; });
    var diff = inb.filter(function (r) { return r.diff; });
    out.push('<span class="flow-tag">지표 → 조치</span>선택 기간 입고 ' + b(inb.length + '건') + ' 중 지연 ' + b(late.length + '건') + ', 검수 수량 차이 ' + b(diff.length + '건') + '입니다. 검수 차이는 ERP 입고 전표를 검수 수량 기준으로 정정해야 시스템 불일치(입고 검수 미반영)로 번지지 않습니다. 보류 ' + Fm.int(tot.h) + '개는 품질 판정 일정을 확인해 가용 전환 시점을 출고 일정표에 반영합니다.');
    return out;
  }

  /* ==================================================================
   * 05 3PL·이슈·유관부서
   * ================================================================== */
  RENDER.issues = function () {
    var tp = F.b2c ? S.tplPerformance(F) : null;
    var tm = F.b2c ? tplTrend() : [];
    var h = '';
    if (tp) {
      h += section({
        en: '3PL Performance', ko: '3PL 성과',
        desc: '출고 정확도 = (출고 − 오출고·수량 차이·누락) ÷ 출고 · 마감 준수율 = 마감 전 출고 지시 건 중 당일 출고 완료 비율 · 가동률 = 일 처리량 ÷ 처리 가능 ' + M.CAPACITY + '건(영업일 평균, 연장 근무 포함).',
        body: '<div class="stat-row">' +
          stat('출고 정확도', pctSplit(tp.accuracy, 2), '%', '오류 ' + Fm.int(tp.errors) + ' / 출고 ' + Fm.int(tp.shipped) + '건 · 목표 99.80%') +
          stat('마감 준수율', pctSplit(tp.cutoff), '%', Fm.int(tp.releasedOk) + ' / ' + Fm.int(tp.released) + '건 · 목표 98%') +
          stat('평균 가동률', pctSplit(tp.utilization, 0), '%', '최대 ' + Fm.pct(tp.maxUtil, 0) + ' · 적정 70~90%') +
          stat('연장 근무일', Fm.int(tp.overtimeDays), '일', '영업일 ' + tp.bizDays + '일 중') + '</div>' +
          '<div style="margin-top:16px">' + panel((F.days <= 92 ? '주별' : '월별') + ' 출고 정확도 · 마감 준수율', '파란 실선 = 출고 정확도, 보라 점선 = 마감 준수율', chartBox('chTpl', 'short', '3PL 월별 성과')) + '</div>'
      });
      hook(function () { drawTpl(tm); });
    } else h += section({ en: '3PL Performance', ko: '3PL 성과', body: naBox('3PL 출고 성과는 B2C 출고 기준입니다. 채널을 "전체" 또는 B2C 채널로 바꾸면 표시됩니다.') });

    var pa = S.pareto(F), causes = S.issueCauses(F);
    h += section({
      en: 'Issue Pareto', ko: '이슈 유형별 파레토와 원인 분류',
      desc: '막대 = 유형별 비중, 점선 = 누적 비중. 같은 % 축을 씁니다.',
      body: '<div class="grid-2">' + panel('유형별 파레토', '선택 기간 접수 ' + Fm.int(pa.total) + '건', chartBox('chPareto', '', '이슈 유형별 파레토')) +
        '<div>' + table('causes', {
          columns: [{ label: '유형', type: 'text', value: function (r) { return r.type; } }, { label: '원인', type: 'text', value: function (r) { return r.cause; } },
            { label: '건수', type: 'int', value: function (r) { return r.n; } }, { label: '평균 소요일', type: 'num1', value: function (r) { return r.avgDays; } }],
          rows: causes, filename: fileName('3PL이슈', '원인분류'), limit: 10, caption: '원인 분류'
        }) + '</div></div>'
    });
    hook(function () { drawPareto(pa); });

    var src = S.issueBySource(F), dept = S.issueByDept(F);
    var byCols = function (lbl) {
      return [{ label: lbl, type: 'text', value: function (r) { return r.key; } }, { label: '건수', type: 'int', value: function (r) { return r.n; } },
        { label: '처리 중', type: 'int', value: function (r) { return r.open; } }, { label: '기한 초과', type: 'int', value: function (r) { return r.overdue; } },
        { label: '평균 처리 소요일(완료)', type: 'num1', value: function (r) { return r.avgDays; } }];
    };
    h += section({
      en: 'By Channel & Department', ko: '접수 경로별 · 담당 부서별 이슈',
      desc: '접수 경로(CS · 영업 · 3PL)와 담당 부서별 건수, 처리 중 건수, 평균 처리 소요일입니다.',
      body: '<div class="grid-2"><div>' + table('bySource', { columns: byCols('접수 경로'), rows: src, filename: fileName('3PL이슈', '접수경로별'), limit: 0, caption: '접수 경로별' }) + '</div><div>' +
        table('byDept', { columns: byCols('담당 부서'), rows: dept, filename: fileName('3PL이슈', '담당부서별'), limit: 0, caption: '담당 부서별' }) + '</div></div>'
    });

    h += section({
      en: 'Issue Log', ko: '이슈 목록',
      tools: '<div class="seg" role="group" aria-label="상태 필터">' + [['ALL', '전체'], ['접수', '접수'], ['처리 중', '처리 중'], ['완료', '완료'], ['OVERDUE', '기한 초과']].map(function (s) {
        return '<button type="button" data-issue-status="' + s[0] + '" aria-pressed="' + (state.local.issueStatus === s[0]) + '">' + s[1] + '</button>';
      }).join('') + '</div>',
      desc: '미완료·기한 초과 건을 위로 정렬했습니다. 처리 기한은 유형별 SLA(오출고 2일, 출고 지연 1일, 파손 3일, 수량 차이 3일, 누락 2일)입니다.',
      body: block('blk-issues', issueListHtml)
    });

    var cards = S.preventionCards(F);
    h += section({
      en: 'Recurrence Prevention', ko: '재발 방지 카드',
      desc: '원인 → 조치 → 결과를 한 세트로 정리했습니다. 결과는 조치일 전후 전체 기간을 비교합니다(채널·상품 필터 반영).',
      body: '<div class="cards-3">' + cards.map(function (c) {
        return '<article class="prevent"><h3>' + esc(c.title) + '</h3><dl><div><dt>Cause · 원인</dt><dd>' + esc(c.cause) + '</dd></div><div><dt>Action · 조치</dt><dd>' + esc(c.action) + '</dd></div></dl>' +
          '<div class="result"><span class="eyebrow">Result · 결과</span>' + c.result.map(function (r) {
            var f = r.unit === 'h' ? function (v) { return Fm.num1(v) + '시간'; } : r.unit === 'pct2' ? Fm.pct2 : Fm.pct;
            return '<div class="result-row"><span>' + esc(r.label) + (r.note ? '<br><span class="muted">' + esc(r.note) + '</span>' : '') + '</span><span class="vals">' +
              (r.before !== null ? '<span class="from">' + f(r.before) + '</span>' : '') + (r.after !== null ? f(r.after) : '—') + '</span></div>';
          }).join('') + '</div></article>';
      }).join('') + '</div>'
    });

    h += summary(issuesSummary(tp, pa, causes, src, dept, cards));
    return h;
  };
  function issueListHtml() {
    var list = S.issueList(F, state.local.issueStatus);
    return table('issues', {
      columns: [
        { label: '이슈 ID', type: 'text', value: function (r) { return r.id; }, cls: 'nowrap' },
        { label: '접수일', type: 'date', value: function (r) { return r.day; }, cls: 'nowrap' },
        { label: '유형', type: 'text', value: function (r) { return r.type; } },
        { label: '채널', type: 'text', value: function (r) { return chName(r.channel); } },
        { label: '원인', type: 'text', value: function (r) { return r.cause; } },
        { label: '접수 경로', type: 'text', value: function (r) { return r.source; } },
        { label: '담당 부서', type: 'text', value: function (r) { return r.dept; } },
        statusCol('상태', function (r) { return r.overdue ? 'risk' : r.status === '완료' ? 'ok' : 'warn'; }, function (r) { return r.overdue ? r.status + ' · 기한 초과' : r.status; }),
        { label: '처리 기한', type: 'date', value: function (r) { return r.due; }, cls: 'nowrap' },
        { label: '소요일', type: 'int', value: function (r) { return r.days; } },
        { label: '다음 조치', type: 'text', value: function (r) { return r.nextAction; } },
        { label: '관련 건', type: 'text', value: function (r) { return r.ref; }, cls: 'nowrap' }
      ], rows: list, filename: fileName('3PL이슈', '이슈목록_' + state.local.issueStatus), limit: 30,
      rowClass: function (r) { return r.overdue ? 'flag' : ''; }
    });
  }
  function tplTrend() {
    if (F.days > 92) return S.tplMonthly(F).map(function (r) { r.label = Fm.month(r.month); return r; });
    var out = [], d = F.from;
    while (d <= F.to) {
      var end = Math.min(F.to, d + ((7 - Cal.dowOf(d)) % 7));
      var t = S.tplPerformance(S.withPeriod(F, d, end));
      if (t.shipped) out.push({ label: mmdd(d), accuracy: t.accuracy, cutoff: t.cutoff, utilization: t.utilization, overtimeDays: t.overtimeDays });
      d = end + 1;
    }
    return out;
  }
  function drawTpl(tm) {
    var P = CH.palette();
    var all = [];
    tm.forEach(function (r) { all.push(r.accuracy, r.cutoff); });
    all = all.filter(function (v) { return v !== null; });
    var sc = CH.baseScales({ beginAtZero: false, yFmt: function (v) { return (v * 100).toFixed(1) + '%'; } });
    sc.y.min = Math.max(0, Math.floor((Math.min.apply(null, all.concat([0.98])) - 0.01) * 100) / 100); sc.y.max = 1;
    CH.render('chTpl', { type: 'line', data: { labels: tm.map(function (r) { return r.label; }), datasets: [
      { label: '출고 정확도', data: tm.map(function (r) { return r.accuracy; }), borderColor: P.primary, backgroundColor: P.primary, pointRadius: 3 },
      { label: '마감 준수율', data: tm.map(function (r) { return r.cutoff; }), borderColor: P.tone(2), backgroundColor: P.tone(2), borderDash: [6, 4], pointRadius: 3 }
    ] }, options: { scales: sc, interaction: { mode: 'index', intersect: false },
      plugins: { tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + Fm.pct(c.parsed.y, 2); }, footer: function (it) { var r = tm[it[0].dataIndex]; return '가동률 ' + Fm.pct(r.utilization, 0) + ' · 연장 근무 ' + r.overtimeDays + '일'; } } } } } });
  }
  function drawPareto(pa) {
    var P = CH.palette();
    CH.render('chPareto', { type: 'bar', data: { labels: pa.rows.map(function (r) { return r.type; }), datasets: [
      { type: 'bar', label: '유형별 비중', data: pa.rows.map(function (r) { return r.share; }), backgroundColor: P.primary, maxBarThickness: 56, order: 2 },
      { type: 'line', label: '누적 비중', data: pa.rows.map(function (r) { return r.cum; }), borderColor: P.tone(2), backgroundColor: P.tone(2), borderDash: [5, 4], pointRadius: 3, order: 1 }
    ] }, options: { scales: CH.baseScales({ yMax: 1, yFmt: function (v) { return Math.round(v * 100) + '%'; } }),
      plugins: { markers: { hlines: [{ y: 0.8, label: '80%' }] }, tooltip: { callbacks: { label: function (c) { var r = pa.rows[c.dataIndex]; return c.dataset.label + ': ' + Fm.pct(c.parsed.y) + (c.datasetIndex === 0 ? ' (' + Fm.int(r.n) + '건)' : ''); } } } } } });
  }
  function issuesSummary(tp, pa, causes, src, dept, cards) {
    var out = [];
    if (pa.total) {
      var top = pa.rows[0];
      var topCause = causes.filter(function (c) { return c.type === top.type; })[0];
      out.push('<span class="flow-tag">지표 → 원인</span>선택 기간 이슈 ' + b(Fm.int(pa.total) + '건') + ' 중 ' + b(top.type) + '가 ' + b(pctTxt(top.share)) + '로 가장 많고, 상위 2개 유형이 누적 ' + b(pctTxt(pa.rows[1] ? pa.rows[1].cum : top.cum)) + '를 차지합니다.' +
        (topCause ? ' ' + top.type + '의 1순위 원인은 "' + esc(topCause.cause) + '"(' + topCause.n + '건)입니다.' : ''));
    } else out.push('선택 기간에 접수된 이슈가 없습니다.');
    var slow = dept.filter(function (d) { return d.avgDays !== null; }).sort(function (a, c) { return c.avgDays - a.avgDays; })[0];
    var od = dept.reduce(function (a, d) { return a + d.overdue; }, 0);
    out.push('<span class="flow-tag">지표 → 조치</span>' + (tp ? '3PL 출고 정확도는 ' + b(Fm.pct(tp.accuracy, 2)) + ', 마감 준수율은 ' + b(pctTxt(tp.cutoff)) + '입니다. ' : '') +
      (slow ? '평균 처리 소요일이 가장 긴 부서는 ' + b(slow.key) + '(' + Fm.num1(slow.avgDays) + '일)이고 기한 초과 미결 이슈는 ' + b(od + '건') + '입니다. 영업 접수 건(B2B 지연·명세서 차이)은 SCM이 원인을 확인해 회신 기한을 정해 두고, 3PL 귀책 건은 주간 회의에서 건별 재발 방지 조치를 받습니다.' : ''));
    var c1 = cards[0].result[0], c2 = cards[1].result[0];
    out.push('<span class="flow-tag">조치 → 결과</span>재발 방지 조치의 효과: 세트 사전 포장 후 세트 주문 누락률 ' + b(Fm.pct2(c1.before) + '→' + Fm.pct2(c1.after)) + ', 본품·미니 로케이션 분리 후 오출고율 ' + b(Fm.pct2(c2.before) + '→' + Fm.pct2(c2.after)) + '. 같은 방식으로 "원인 → 조치 → 결과"를 카드로 남기면 유관부서와 개선 효과를 숫자로 공유할 수 있습니다.');
    return out;
  }

  /* ==================================================================
   * 06 데이터 정합성·재고 정상화
   * ================================================================== */
  RENDER.integrity = function () {
    var fl = S.systemFlow(F), tr = S.matchTrend(F), cs = S.mismatchCauseSummary(F), nm = S.normalization(F), rules = S.validationRules(F);
    var chNote = F.channel !== 'ALL' ? ' ' + scopeTag('재고 대사는 센터 단위 · 주문 흐름만 채널 필터 적용') : '';
    var h = section({
      en: 'System Flow', ko: 'OMS → WMS → ERP 데이터 흐름',
      desc: '선택 기간 B2C 주문이 세 시스템을 거치며 건수·수량이 어디서 달라지는지 보여줍니다. 재고 합계는 기간 종료일(' + Fm.dateShort(F.to) + ') 기준입니다.' + chNote,
      body: flowHtml(fl)
    });

    h += section({
      en: 'Three-way Reconciliation', ko: 'SKU별 3시스템 수량 대사',
      tools: '<label class="toggle"><input type="checkbox" data-toggle="reconDiffOnly"' + (state.local.reconDiffOnly ? ' checked' : '') + '> 차이 나는 행만 보기</label>',
      desc: '재고는 기간 종료일 마감 수량, 출고는 선택 기간 합계입니다. 차이 기준은 WMS(실물 관리 시스템)입니다.',
      body: block('blk-recon', reconHtml)
    });

    h += section({
      en: 'Match Rate Trend', ko: '시스템 재고 일치율 추이와 실사·조정 효과',
      desc: '시스템 재고 일치율 = OMS·WMS·ERP 수량이 모두 같은 SKU 수 ÷ 전체 SKU 수. 세로 점선은 정기 실사·조정일, 짧은 점선은 원인 조치(재발 방지)일입니다.',
      body: panel('일별 일치율', '목표 98% · 대상 ' + F.skuList.length + ' SKU', chartBox('chMatch', 'tall', '시스템 재고 일치율 추이') +
        (tr.fixes.length ? '<p class="chart-note">원인 조치: ' + tr.fixes.map(function (f) { return mmdd(f.day) + ' ' + esc(f.label); }).join(' · ') + '</p>' : '')) + '<div style="margin-top:16px">' +
        table('countEffect', {
          columns: [
            { label: '실사·조정일', type: 'date', value: function (r) { return r.day; } },
            { label: '실사 전일 일치율', type: 'pct', value: function (r) { return r.before; } },
            { label: '실사 직후', type: 'pct', value: function (r) { return r.at; } },
            { label: '4주 후', type: 'pct', value: function (r) { return r.after4w; } },
            { label: '4주 후 변화', type: 'text', value: function (r) { return r.after4w === null ? '' : Fm.pp(r.after4w - r.at); } },
            { label: '해석', type: 'text', value: function (r) { return r.after4w === null ? '4주 경과 전' : r.after4w < r.at - 0.05 ? '재발 — 원인 미조치 SKU가 다시 어긋남' : '정상화 유지'; } }
          ], rows: tr.effects, filename: fileName('정합성', '실사효과'), limit: 0, caption: '실사·조정 효과', empty: '선택 기간에 정기 실사일이 없습니다. 기간을 넓혀 보세요.'
        }) + '</div>'
    });
    hook(function () { drawMatch(tr); });

    h += section({
      en: 'Root Causes', ko: '불일치 원인별 건수와 건별 정정 조치',
      tools: '<label class="toggle"><input type="checkbox" data-toggle="mmOpenOnly"' + (state.local.mmOpenOnly ? ' checked' : '') + '> 미해결 건만 보기</label>',
      desc: '선택 기간에 발견한 불일치 ' + Fm.int(cs.total) + '건 중 상위 3개 원인이 ' + b(pctTxt(cs.top3Share)) + '를 차지합니다. 건별 추정 원인은 수량 차이 패턴(어느 시스템이 다른지)과 근거 거래로 판단합니다.',
      body: '<div class="grid-2">' + panel('원인별 건수', '막대 = 건수', chartBox('chCause', 'short', '불일치 원인별 건수')) +
        '<div>' + table('causeSum', {
          columns: [{ label: '원인', type: 'text', value: function (r) { return r.label; } }, { label: '건수', type: 'int', value: function (r) { return r.n; } },
            { label: '수량 합', type: 'int', value: function (r) { return r.qty; } }, { label: '미해결', type: 'int', value: function (r) { return r.open; } },
            { label: '패턴', type: 'text', value: function (r) { return M.causes[r.cause].pattern; } }],
          rows: cs.rows, filename: fileName('정합성', '원인별건수'), limit: 0, caption: '원인 요약'
        }) + '</div></div><div style="margin-top:16px">' + block('blk-mm', mmListHtml) + '</div>'
    });
    hook(function () { drawCause(cs); });

    var maxR = nm[0].reached || 1;
    h += section({
      en: 'Normalization Progress', ko: '재고 정상화 진행표',
      desc: '선택 기간 발견 건이 각 단계에 도달한 건수입니다. 일일 대사로 바로 정정한 건은 실사 단계를 거치지 않으므로 실사 단계 건수가 조정보다 적을 수 있습니다.',
      body: '<div class="stages">' + nm.map(function (s) {
        return '<div class="stage"><div class="stage-no">STEP ' + s.stage + '</div><div style="font-weight:700">' + esc(s.label) + '</div>' +
          '<div class="stage-bar"><span style="width:' + Math.round(s.reached / maxR * 100) + '%"></span></div>' +
          '<div class="stat-value" style="font-size:24px">' + Fm.int(s.reached) + '<small>건</small></div><div class="stat-sub">' + (s.stage <= 3 ? '현재 이 단계 ' + s.current + '건' : s.stage === 5 ? '원인 조치 완료' : '조정 완료 ' + s.current + '건') + '</div></div>';
      }).join('') + '</div>'
    });

    var cc = S.cycleCountRows(F);
    h += section({
      en: 'Cycle Count Log', ko: '재고 실사 이력',
      desc: '정기 실사에서 차이가 있었던 SKU입니다. 전산 수량은 WMS, OMS·ERP 차이는 실물 대비입니다. 원인 조치가 없으면 6주 안에 다시 어긋나는지(재발)를 함께 봅니다.',
      body: table('cycle', {
        columns: [
          { label: '실사일', type: 'date', value: function (r) { return r.day; }, cls: 'nowrap' }, skuCol('상품'),
          { label: '전산(WMS)', type: 'int', value: function (r) { return r.bookQty; } }, { label: '실물', type: 'int', value: function (r) { return r.physicalQty; } },
          { label: '차이(실물−전산)', type: 'signed', value: function (r) { return r.diff; } },
          { label: 'OMS 차이', type: 'signed', value: function (r) { return r.omsDiff; } }, { label: 'ERP 차이', type: 'signed', value: function (r) { return r.erpDiff; } },
          { label: '원인', type: 'text', value: function (r) { return r.causeLabel; } },
          { label: '조정 처리', type: 'text', value: function (r) { return r.adjusted ? '완료' : '—'; } },
          { label: '원인 조치', type: 'text', value: function (r) { return r.rootCauseFixed ? '완료' : '미조치'; } },
          statusCol('6주 내 재발', function (r) { return r.recurred ? 'risk' : 'ok'; }, function (r) { return r.recurred ? '재발(' + r.recurDays + '일 후)' : '재발 없음'; })
        ], rows: cc, filename: fileName('정합성', '재고실사이력'), limit: 25, empty: '선택 기간에 정기 실사일이 없습니다.',
        rowClass: function (r) { return r.recurred ? 'flag' : ''; }
      })
    });

    h += section({
      en: 'Validation Rules', ko: '검증 규칙 목록',
      desc: '매일·매월 자동 점검하는 규칙과 선택 기간 위반 건수입니다. 위반 0건이면 정상, 3건 이하 주의, 그 이상 위험입니다.',
      body: table('rules', {
        columns: [{ label: 'ID', type: 'text', value: function (r) { return r.id; } }, { label: '규칙', type: 'text', value: function (r) { return r.name; }, cls: 'strong' },
          { label: '검증식', type: 'text', value: function (r) { return r.formula; } }, { label: '주기', type: 'text', value: function (r) { return r.freq; } },
          { label: '대상', type: 'text', value: function (r) { return r.target; } },
          { label: '위반', type: 'text', value: function (r) { return r.fail === null ? '해당 없음' : r.fail + r.unit; } },
          statusCol('판정', function (r) { return r.status; }), { label: '주요 원인', type: 'text', value: function (r) { return r.hint; } }],
        rows: rules, filename: fileName('정합성', '검증규칙'), limit: 0
      })
    });

    h += summary(integritySummary(tr, cs, cc, fl));
    return h;
  };
  function flowHtml(fl) {
    function node(name, role, rows) {
      return '<div class="flow-node"><h3>' + name + '</h3><div class="role">' + role + '</div><dl>' +
        rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl></div>';
    }
    function link(ok, items) {
      return '<div class="flow-link"><span class="arrow">→</span>' + statusHtml(ok ? 'ok' : 'risk', ok ? '일치' : '불일치 발생') + '<ul>' + items.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul></div>';
    }
    var o = fl.omsWms, w = fl.wmsErp;
    return '<div class="flow">' +
      node('OMS', '주문 수집 · 출고 요청', [['주문', Fm.int(fl.oms.n) + '건'], ['수량', Fm.int(fl.oms.qty) + '개'], ['재고 합계', Fm.int(fl.stock.oms) + '개']]) +
      link(o.ok, ['진행 중(정상) ' + Fm.int(fl.inProgress.n) + '건', '취소·변경 미반영 ' + o.cancel.n + '건 · ' + o.cancel.qty + '개', '출고 스캔 오류 ' + o.scan.n + '건']) +
      node('WMS', '출고 처리 · 실물 재고', [['출고 완료', Fm.int(fl.wms.n) + '건'], ['수량', Fm.int(fl.wms.qty) + '개'], ['재고 합계', Fm.int(fl.stock.wms) + '개']]) +
      link(w.ok, ['세트 구성품 차감 누락 ' + w.setbom.n + '건 · ' + w.setbom.qty + '개', '반품 입고 미처리 ' + w.ret.n + '건 · ' + w.ret.qty + '개', '입고 검수 미반영 ' + w.inbound.n + '건']) +
      node('ERP', '출고 전표 · 재고 자산', [['출고 전표', Fm.int(fl.wms.n) + '건'], ['차감 수량', Fm.int(w.erpQty) + '개'], ['재고 합계', Fm.int(fl.stock.erp) + '개']]) +
      '</div>';
  }
  function reconHtml() {
    var rows = S.reconTable(F);
    if (state.local.reconDiffOnly) rows = rows.filter(function (r) { return !r.match; });
    return table('recon', {
      columns: [skuCol('상품'),
        { label: 'OMS 재고', type: 'int', value: function (r) { return r.oms; } }, { label: 'WMS 재고', type: 'int', value: function (r) { return r.wms; } },
        { label: 'ERP 재고', type: 'int', value: function (r) { return r.erp; } },
        { label: 'OMS−WMS', type: 'signed', value: function (r) { return r.omsDiff; } }, { label: 'ERP−WMS', type: 'signed', value: function (r) { return r.erpDiff; } },
        { label: '출고 OMS', type: 'int', value: function (r) { return r.outOms; } }, { label: '출고 WMS', type: 'int', value: function (r) { return r.outWms; } },
        { label: '출고 ERP', type: 'int', value: function (r) { return r.outErp; } },
        statusCol('대사 결과', function (r) { return r.match ? 'ok' : 'risk'; }, function (r) { return r.match ? '일치' : r.stockMatch ? '출고 수량 불일치' : '재고 불일치'; }),
        { label: '추정 원인', type: 'text', value: function (r) { return r.causeLabel; } }, { label: '수량 패턴', type: 'text', value: function (r) { return r.pattern; } },
        { label: '권장 정정 조치', type: 'text', value: function (r) { return r.action; } }],
      rows: rows, filename: fileName('정합성', '3시스템대사' + (state.local.reconDiffOnly ? '_차이만' : '')), limit: 0, scroll: true,
      rowClass: function (r) { return r.match ? '' : 'flag'; }, empty: '차이 나는 SKU가 없습니다.'
    });
  }
  function mmListHtml() {
    var rows = S.mismatchList(F);
    if (state.local.mmOpenOnly) rows = rows.filter(function (r) { return r.open; });
    return table('mismatch', {
      columns: [
        { label: '불일치 ID', type: 'text', value: function (r) { return r.id; }, cls: 'nowrap' }, skuCol('상품'),
        { label: '발생일', type: 'date', value: function (r) { return r.occur; }, cls: 'nowrap' }, { label: '발견일', type: 'date', value: function (r) { return r.detect; }, cls: 'nowrap' },
        { label: '수량', type: 'int', value: function (r) { return r.qty; } },
        { label: '추정 원인', type: 'text', value: function (r) { return r.causeLabel; } }, { label: '패턴', type: 'text', value: function (r) { return r.pattern; } },
        { label: '근거', type: 'text', value: function (r) { return r.evidence; } },
        statusCol('진행 단계', function (r) { return r.open ? (r.stage <= 2 ? 'risk' : 'warn') : 'ok'; }, function (r) { return r.stageLabel + (r.open ? ' (미해결)' : ''); }),
        { label: '해결일', type: 'date', value: function (r) { return r.resolve; }, cls: 'nowrap' }, { label: '해결 방식', type: 'text', value: function (r) { return r.resolvedBy; } },
        { label: '권장 정정 조치', type: 'text', value: function (r) { return r.action; } }
      ], rows: rows, filename: fileName('정합성', '불일치건별'), limit: 20, caption: '불일치 건별 목록',
      rowClass: function (r) { return r.open ? 'flag' : ''; }, empty: '해당 조건의 불일치 건이 없습니다.'
    });
  }
  function drawMatch(tr) {
    var P = CH.palette();
    var rows = tr.rows;
    var vl = [];
    // 실사일과 원인 조치일이 같으면 라벨 하나로 합침
    tr.counts.forEach(function (c) {
      var nFix = tr.fixes.filter(function (f) { return f.day === c; }).length;
      vl.push({ index: c - F.from, label: '실사·조정 ' + mmdd(c) + (nFix ? ' + 원인 조치 ' + nFix + '건' : ''), dash: [4, 3] });
    });
    tr.fixes.filter(function (f) { return tr.counts.indexOf(f.day) < 0; }).forEach(function (f) {
      vl.push({ index: f.day - F.from, label: '원인 조치 ' + mmdd(f.day), dash: [2, 2], color: P.sub, row: 1 });
    });
    var vals = rows.map(function (r) { return r.rate; }).filter(function (v) { return v !== null; });
    var sc = CH.baseScales({ beginAtZero: false, yFmt: function (v) { return Math.round(v * 100) + '%'; } });
    sc.y.min = Math.max(0, Math.floor((Math.min.apply(null, vals.concat([0.98])) - 0.05) * 10) / 10); sc.y.max = 1;
    CH.render('chMatch', { type: 'line', data: { labels: rows.map(function (r) { return mmdd(r.day); }), datasets: [
      { label: '시스템 재고 일치율', data: rows.map(function (r) { return r.rate; }), borderColor: P.primary, backgroundColor: P.primary, stepped: true }
    ] }, options: { scales: sc, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, markers: { hlines: [{ y: 0.98, label: '목표 98%' }], vlines: vl },
        tooltip: { callbacks: { label: function (c) { var r = rows[c.dataIndex]; return '일치율 ' + Fm.pct(r.rate) + ' (' + r.ok + '/' + r.n + ' SKU)'; } } } } } });
  }
  function drawCause(cs) {
    var P = CH.palette();
    CH.render('chCause', { type: 'bar', data: { labels: cs.rows.map(function (r) { return r.label; }), datasets: [
      { label: '건수', data: cs.rows.map(function (r) { return r.n; }), backgroundColor: P.primary, maxBarThickness: 22 }
    ] }, options: { indexAxis: 'y', scales: { x: { grid: { color: P.grid }, border: { display: false }, beginAtZero: true }, y: { grid: { display: false } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { var r = cs.rows[c.dataIndex]; return r.n + '건 · ' + r.qty + '개 · 미해결 ' + r.open + '건'; } } } } } });
  }
  function integritySummary(tr, cs, cc, fl) {
    var out = [];
    var last = tr.rows.length ? tr.rows[tr.rows.length - 1] : null;
    if (cs.total) {
      var t3 = cs.rows.slice(0, 3).map(function (r) { return r.label + ' ' + r.n + '건'; }).join(', ');
      out.push('<span class="flow-tag">지표 → 원인</span>기간 말 시스템 재고 일치율은 ' + b(pctTxt(last ? last.rate : null)) + '이며, 선택 기간 불일치 ' + b(Fm.int(cs.total) + '건') + '의 ' + b(pctTxt(cs.top3Share)) + '가 세 가지 원인(' + esc(t3) + ')에 집중됩니다. 세 원인 모두 사람의 실수가 아니라 시스템 간 연동 규칙이 빠진 구조적 문제입니다.');
    } else out.push('<span class="flow-tag">지표</span>선택 기간에 발견된 불일치가 없습니다. 기간 말 일치율은 ' + b(pctTxt(last ? last.rate : null)) + '입니다.');
    if (tr.effects.length) {
      var e = tr.effects.filter(function (x) { return x.after4w !== null; });
      var fixed = cc.filter(function (c) { return c.rootCauseFixed; }), unfixed = cc.filter(function (c) { return !c.rootCauseFixed; });
      var rr = function (a) { return a.length ? a.filter(function (c) { return c.recurred; }).length / a.length : null; };
      out.push('<span class="flow-tag">조치 → 결과</span>정기 실사·조정 직후 일치율은 ' + (e.length ? b(Fm.pct(e[0].before) + '→' + Fm.pct(e[0].at)) + '로 올랐다가 4주 뒤 ' + b(Fm.pct(e[0].after4w)) + '로 다시 떨어졌습니다' : '올랐습니다') +
        '. 실사 후 6주 안에 다시 어긋난 비율은 원인 조치 SKU ' + b(rr(fixed) === null ? '—' : pctTxt(rr(fixed))) + ', 미조치 SKU ' + b(rr(unfixed) === null ? '—' : pctTxt(rr(unfixed))) + '입니다. 실사로 숫자를 맞추는 것만으로는 정상화되지 않는다는 근거입니다.');
    } else out.push('<span class="flow-tag">조치 → 결과</span>선택 기간에는 정기 실사가 없습니다. 기간을 6개월 이상으로 넓히면 실사 후 일치율이 올랐다가 원인 미조치 SKU에서 다시 떨어지는 패턴을 볼 수 있습니다.');
    out.push('<span class="flow-tag">조치</span>우선순위: ① 데일리 케어 세트 ERP BOM 매핑(세트 구성품 차감 누락 재발 차단) ② OMS 취소 → WMS 출고 지시 자동 회수 범위를 전 채널로 확대 ③ 반품 입고 D+1 마감 준수 여부를 검증 규칙 R1로 매일 점검. 규칙 위반 건은 다음 날 오전 대사 목록으로 자동 생성해 일일 대사 정정 비율을 높입니다.');
    return out;
  }

  /* ==================================================================
   * 07 정산 검증·운영 효율
   * ================================================================== */
  RENDER.settlement = function () {
    var note = (F.channel !== 'ALL' || F.product !== 'ALL') ? ' ' + scopeTag('정산은 센터 단위 · 채널·상품 필터 미적용(효율 지표는 채널·상품 반영)') : '';
    var months = S.costTrend(F).map(function (r) { return r.month; });
    if (state.local.billMonth !== 'ALL' && months.indexOf(state.local.billMonth) < 0) state.local.billMonth = 'ALL';
    var h = section({
      en: '3PL Invoice Audit', ko: '3PL 청구 내역 검증',
      tools: '<select class="inline-select" data-select="billMonth" aria-label="청구 월"><option value="ALL">전체 월</option>' + months.map(function (m) { return '<option value="' + m + '"' + (state.local.billMonth === m ? ' selected' : '') + '>' + Fm.month(m) + '</option>'; }).join('') + '</select>' +
        '<label class="toggle"><input type="checkbox" data-toggle="billDiffOnly"' + (state.local.billDiffOnly ? ' checked' : '') + '> 차이 나는 항목만 보기</label>',
      desc: '정산 차이 금액 = Σ(청구 수량 − 실적 수량) × 계약 단가 + Σ 청구 수량 × (청구 단가 − 계약 단가). 계약 단가는 해당 월 물량 구간의 견적 단가(08 3PL 견적 단가)입니다. 실적 수량은 WMS 출고·입고·재고 기록과 택배 송장 기록에서 집계했습니다.' + note,
      body: block('blk-bill', billHtml)
    });

    var ct = S.costTrend(F);
    h += section({
      en: 'Logistics Cost', ko: '월별 물류비와 출고 1건당 물류비',
      desc: '출고 1건당 물류비 = 월 물류비 합계(실적 기준) ÷ 월 출고 건수(B2C 주문 + B2B 출고). 기간을 3개월 이상으로 넓히면 추이를 볼 수 있습니다.',
      body: '<div class="grid-2">' + panel('월별 물류비', '회색 = 청구 금액, 파랑 = 검증 후(실적 기준)', chartBox('chCost', 'short', '월별 물류비')) +
        panel('출고 1건당 물류비', '실적 기준', chartBox('chPerShip', 'short', '출고 1건당 물류비')) + '</div><div style="margin-top:16px">' +
        table('cost', {
          columns: [{ label: '월', type: 'text', value: function (r) { return Fm.month(r.month); } },
            { label: '청구 금액(원)', type: 'won', value: function (r) { return r.billed; } }, { label: '검증 후 금액(원)', type: 'won', value: function (r) { return r.actual; } },
            { label: '차이(원)', type: 'signed', value: function (r) { return r.diff; } }, { label: '출고 건수', type: 'int', value: function (r) { return r.outbound; } },
            { label: '건당 물류비(원)', type: 'won', value: function (r) { return r.perShipment; } }].concat(['보관료', '입고 작업비', '일반 포장비', '택배비', '기타'].map(function (c) {
              return { label: c + '(원)', type: 'won', value: function (r) { return r.byCat[c] || 0; } };
            })),
          rows: ct, filename: fileName('정산', '월별물류비'), limit: 0, caption: '월별 물류비 구성(실적 기준)'
        }) + '</div>'
    });

    var ef = S.efficiency(F);
    h += section({
      en: 'Efficiency', ko: '운영 효율 지표',
      desc: '합포장 비율 = 합포장 출고 ÷ 합포장 대상(동일 수취인 당일 복수 주문) · 건당 택배비 = 택배비 ÷ 박스 수 · 과대 박스 비율 = 필요 규격보다 큰 박스 사용 비중.',
      body: F.b2c ? '<div class="grid-3">' + panel('합포장 · 과대 박스 비율', '파란 실선 = 합포장, 보라 점선 = 과대 박스', chartBox('chMerge', 'short', '합포장 비율과 과대 박스 비율')) +
        panel('건당 택배비', '박스 1개당 평균', chartBox('chParcel', 'short', '건당 택배비')) +
        panel('박스 규격별 사용 비중', '극소 · 소 · 중 · 대', chartBox('chBox', 'short', '박스 규격별 사용 비중')) + '</div>' : naBox('효율 지표는 B2C 출고 기준입니다.')
    });

    var op = S.opportunities(F);
    h += section({
      en: 'Savings Opportunity', ko: '개선 기회 요약',
      desc: '검증으로 찾아낸 과다 청구 금액과, 효율화로 줄일 수 있는 예상 금액(선택 기간 기준, 연환산 병기)입니다.',
      body: '<div class="stat-row">' +
        stat('검증으로 찾은 금액', Fm.int(op.verifiedOver), '원', '과다 청구 ' + op.verifiedLines + '개 항목 · 순차이 ' + Fm.signed(op.verifiedNet) + '원') +
        stat('박스 규격 하향', Fm.int(op.boxSave), '원', '과대 박스를 필요 규격으로 바꿀 때 택배비 차이') +
        stat('합포장 80% 달성', Fm.int(op.mergeSave), '원', '현재 합포장 비율 ' + pctTxt(op.mergeRate)) +
        stat('기간 합계', Fm.int(op.total), '원', '') +
        stat('효율화 연환산', Fm.wonShort(op.annualEfficiency), '', '박스·합포장 절감 × ' + op.annualFactor.toFixed(1)) + '</div>'
    });
    hook(function () { drawCost(ct); if (F.b2c) drawEff(ef); });

    h += summary(settlementSummary(ct, ef, op));
    return h;
  };
  function billHtml() {
    var rows = S.billingInPeriod(F);
    if (state.local.billMonth !== 'ALL') rows = rows.filter(function (r) { return r.month === state.local.billMonth; });
    if (state.local.billDiffOnly) rows = rows.filter(function (r) { return r.hasDiff; });
    var sumB = rows.reduce(function (a, r) { return a + r.billedAmt; }, 0), sumD = rows.reduce(function (a, r) { return a + r.diffAmt; }, 0);
    return '<div class="stat-row" style="margin-bottom:16px">' + stat('청구 금액', Fm.int(sumB), '원', rows.length + '개 항목') + stat('정산 차이 금액', Fm.signed(sumD), '원', '(청구 − 실적) × 단가') +
      stat('차이 항목', rows.filter(function (r) { return r.hasDiff; }).length, '개', '수량 ' + Fm.signed(rows.reduce(function (a, r) { return a + r.qtyDiffAmt; }, 0)) + ' · 단가 ' + Fm.signed(rows.reduce(function (a, r) { return a + r.priceDiffAmt; }, 0)) + '원') + stat('검증 대기', rows.filter(function (r) { return r.status === '검증 대기'; }).length, '개', '') + '</div>' +
      table('billing', {
        columns: [
          { label: '월', type: 'text', value: function (r) { return Fm.month(r.month); } }, { label: '구분', type: 'text', value: function (r) { return r.cat; } },
          { label: '항목', type: 'text', value: function (r) { return r.item; } }, { label: '단위', type: 'text', value: function (r) { return r.unit; } },
          { label: '청구 수량', type: 'int', value: function (r) { return r.billedQty; } }, { label: '실적 수량', type: 'int', value: function (r) { return r.actualQty; } },
          { label: '수량 차이', type: 'signed', value: function (r) { return r.diffQty; } },
          { label: '적용 구간', type: 'text', value: function (r) { return r.tier ? r.tier + '구간' : ''; } },
          { label: '계약 단가(원)', type: 'won', value: function (r) { return r.unitPrice; } }, { label: '청구 단가(원)', type: 'won', value: function (r) { return r.billedUnitPrice; } },
          { label: '청구 금액(원)', type: 'won', value: function (r) { return r.billedAmt; } }, { label: '차이 금액(원)', type: 'signed', value: function (r) { return r.diffAmt; }, cls: 'strong' },
          statusCol('검증 상태', function (r) { return r.hasDiff ? 'risk' : r.status === '검증 대기' ? 'warn' : 'ok'; }, function (r) { return r.status + (r.hasDiff ? ' · 차이' : ''); }),
          { label: '차이 원인 메모', type: 'text', value: function (r) { return r.memo; } }, { label: '처리', type: 'text', value: function (r) { return r.resolution; } }
        ], rows: rows, filename: fileName('정산', '3PL청구검증' + (state.local.billDiffOnly ? '_차이만' : '')), limit: 40,
        rowClass: function (r) { return r.hasDiff ? 'flag' : ''; }, empty: '조건에 맞는 청구 항목이 없습니다.'
      });
  }
  function drawCost(ct) {
    var P = CH.palette();
    var labels = ct.map(function (r) { return Fm.month(r.month); });
    CH.render('chCost', { type: 'bar', data: { labels: labels, datasets: [
      { label: '청구 금액', data: ct.map(function (r) { return r.billed; }), backgroundColor: P.plan, maxBarThickness: 26 },
      { label: '검증 후 금액', data: ct.map(function (r) { return r.actual; }), backgroundColor: P.primary, maxBarThickness: 26 }
    ] }, options: { scales: CH.baseScales({ yFmt: function (v) { return Math.round(v / 1e6) + '백만'; } }), interaction: { mode: 'index', intersect: false },
      plugins: { tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + Fm.won(c.parsed.y); }, footer: function (it) { return '차이 ' + Fm.signed(ct[it[0].dataIndex].diff) + '원'; } } } } } });
    CH.render('chPerShip', { type: 'line', data: { labels: labels, datasets: [
      { label: '출고 1건당 물류비', data: ct.map(function (r) { return r.perShipment; }), borderColor: P.primary, backgroundColor: P.primary, pointRadius: 3 }
    ] }, options: { scales: CH.baseScales({ beginAtZero: false, yFmt: function (v) { return Fm.int(v); } }), plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return Fm.won(c.parsed.y); } } } } } });
  }
  function drawEff(ef) {
    var P = CH.palette();
    var labels = ef.map(function (r) { return Fm.month(r.month); });
    CH.render('chMerge', { type: 'line', data: { labels: labels, datasets: [
      { label: '합포장 비율', data: ef.map(function (r) { return r.mergeRate; }), borderColor: P.primary, backgroundColor: P.primary, pointRadius: 3 },
      { label: '과대 박스 비율', data: ef.map(function (r) { return r.overBoxRate; }), borderColor: P.tone(2), backgroundColor: P.tone(2), borderDash: [5, 4], pointRadius: 3 }
    ] }, options: { scales: CH.baseScales({ yMax: 1, yFmt: function (v) { return Math.round(v * 100) + '%'; } }), plugins: { markers: { hlines: [{ y: 0.8, label: '합포장 목표 80%' }] }, tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + Fm.pct(c.parsed.y); } } } } } });
    CH.render('chParcel', { type: 'line', data: { labels: labels, datasets: [
      { label: '건당 택배비', data: ef.map(function (r) { return r.parcelPerBox; }), borderColor: P.primary, backgroundColor: P.primary, pointRadius: 3 }
    ] }, options: { scales: CH.baseScales({ beginAtZero: false, yFmt: function (v) { return Fm.int(v); } }), plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return Fm.won(c.parsed.y); } } } } } });
    var sizes = ['극소', '소', '중', '대'];
    CH.render('chBox', { type: 'bar', data: { labels: labels, datasets: sizes.map(function (s, i) {
      return { label: s, data: ef.map(function (r) { return r.boxShare[i]; }), backgroundColor: P.tone(i), stack: 'b', maxBarThickness: 32 };
    }) }, options: { scales: CH.baseScales({ stacked: true, yMax: 1, yFmt: function (v) { return Math.round(v * 100) + '%'; } }), interaction: { mode: 'index', intersect: false },
      plugins: { tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + Fm.pct(c.parsed.y); } } } } } });
  }
  function settlementSummary(ct, ef, op) {
    var out = [];
    var rows = S.billingInPeriod(F).filter(function (r) { return r.hasDiff; }).sort(function (a, c) { return Math.abs(c.diffAmt) - Math.abs(a.diffAmt); });
    if (rows.length) {
      var r0 = rows[0];
      out.push('<span class="flow-tag">지표 → 원인</span>청구와 실적을 항목별로 대조한 결과 ' + b(rows.length + '개 항목') + '에서 차이가 났고, 과다 청구는 ' + b(Fm.won(op.verifiedOver)) + '입니다. 가장 큰 차이는 ' + b(Fm.month(r0.month) + ' ' + esc(r0.item)) + '(' + (r0.diffQty ? Fm.signed(r0.diffQty) + esc(r0.unit) : '단가 ' + Fm.signed(r0.priceDiff) + '원') + ', ' + Fm.signed(r0.diffAmt) + '원)로 "' + esc(r0.memo) + '"이 원인입니다.');
    } else out.push('<span class="flow-tag">지표</span>선택 기간 청구 내역은 모든 항목이 실적과 일치합니다.');
    if (ct.length) {
      var last = ct[ct.length - 1], first = ct[0];
      out.push('<span class="flow-tag">지표</span>출고 1건당 물류비는 ' + (ct.length > 1 ? b(Fm.won(first.perShipment) + '→' + Fm.won(last.perShipment)) + '(' + Fm.month(first.month) + '→' + Fm.month(last.month) + ')' : b(Fm.won(last.perShipment))) + '이며, 택배비가 물류비의 ' + b(pctTxt((last.byCat['택배비'] || 0) / last.actual)) + ', 일반 포장비가 ' + b(pctTxt((last.byCat['일반 포장비'] || 0) / last.actual)) + '입니다. 두 항목 모두 구간·사이즈별 견적 단가로 정해지므로 08 3PL 견적 단가 화면에서 단가 인하 우선순위를 확인합니다.');
    }
    out.push('<span class="flow-tag">조치</span>① 송장번호 기준 중복 검증과 출고 건수 대사(취소·보류 해제 재지시 건 제외)를 월 마감 체크리스트에 넣어 청구서 수령 후 3영업일 안에 소명을 요청하고, ② OMS 합포장 규칙(동일 수취인·당일)을 자동 적용해 합포장 비율을 ' + pctTxt(op.mergeRate) + '→80%로 올리고, ③ 박스 자동 추천으로 과대 박스를 줄입니다. 효율화 예상 절감액은 연 ' + b(Fm.wonShort(op.annualEfficiency)) + '입니다.');
    return out;
  }

  /* ==================================================================
   * 08 3PL 견적 단가
   * ================================================================== */
  var SIZE_LBL = { S: '소형', M: '중형', L: '대형' };
  function tierRange(t) { return Fm.int(t.min) + (t.max ? ' ~ ' + Fm.int(t.max) : ' 이상') + '박스'; }
  RENDER.ratecard = function () {
    var RC = S.rateCard(), tm = S.tierMonths(F), sc = S.sizeCost(F), pr = S.priceReduction(F);
    var note = (F.channel !== 'ALL' || F.product !== 'ALL') ? ' ' + scopeTag('견적 단가·박스 수는 센터 단위 · 채널·상품 필터 미적용') : '';
    var last = tm[tm.length - 1];
    var h = '';
    if (!last) return naBox('선택 기간에 해당하는 월이 없습니다.');
    var curTier = last.tier;
    var priceCols = function (kind) {
      return [
        { label: '구간', type: 'text', value: function (r) { return r.label; }, cls: 'strong' },
        { label: '월 B2C 택배 박스 수', type: 'text', value: function (r) { return r.range; } }
      ].concat(['S', 'M', 'L'].map(function (z) { return { label: SIZE_LBL[z] + '(원)', type: 'won', value: function (r) { return r[kind][z]; } }; }))
        .concat([{ label: '비고', type: 'text', value: function (r) { return r.note; } }]);
    };
    var tierRows = RC.tiers.map(function (t) {
      return { label: t.label, range: tierRange(t), packing: RC.packing[t.id], parcel: RC.parcel[t.id], id: t.id,
        total: { S: RC.packing[t.id].S + RC.parcel[t.id].S, M: RC.packing[t.id].M + RC.parcel[t.id].M, L: RC.packing[t.id].L + RC.parcel[t.id].L },
        note: t.id === curTier ? Fm.month(last.month) + ' 적용 구간' : '' };
    });
    var bench = { label: '비교 견적', range: RC.benchmark.label, packing: RC.benchmark.packing, parcel: RC.benchmark.parcel, id: 'BM',
      total: { S: RC.benchmark.packing.S + RC.benchmark.parcel.S, M: RC.benchmark.packing.M + RC.benchmark.parcel.M, L: RC.benchmark.packing.L + RC.benchmark.parcel.L }, note: '협상 기준선' };
    var flag = function (r) { return r.id === curTier ? 'flag' : ''; };
    var avgPerBox = sc.totalBoxes ? sc.totalCost / sc.totalBoxes : null;
    h += section({
      en: 'Rate Card', ko: '3PL 물류비 견적 단가',
      desc: '구간은 ' + esc(RC.basis) + '로 정하고, 그 달의 모든 박스에 해당 구간 단가를 적용합니다. ' + esc(RC.excluded) + '. 박스당 물류비 = 일반 포장 단가 + 택배비 단가.' + note,
      body: '<div class="stat-row" style="margin-bottom:16px">' +
        stat(Fm.month(last.month) + ' 적용 구간', curTier, '구간', '산정 물량 ' + Fm.int(last.basis) + '박스') +
        stat('다음 구간까지', last.toNext === null ? '—' : Fm.int(last.toNext), last.toNext === null ? '' : '박스', last.nextTier ? last.nextTier + '구간 진입 시 월 ' + Fm.won(last.cost - last.costIfNext) + ' 절감' : '최상위 구간') +
        stat('B2B 택배 포함 시', last.tierIfB2B, '구간', 'B2B 택배 ' + Fm.int(last.b2bParcels) + '박스 · 월 ' + Fm.won(last.saveIfB2B) + ' 절감') +
        stat('박스당 평균 물류비', Fm.int(avgPerBox), '원', '선택 기간 포장 + 택배 · ' + sc.months + '개월') + '</div>' +
        '<div class="grid-2">' +
        '<div>' + table('rcPack', { columns: priceCols('packing'), rows: tierRows.concat([bench]), filename: fileName('3PL견적', '일반포장단가'), limit: 0, caption: '일반 포장 단가(피킹·포장·박스·완충재)', rowClass: flag }) + '</div>' +
        '<div>' + table('rcParcel', { columns: priceCols('parcel'), rows: tierRows.concat([bench]), filename: fileName('3PL견적', '택배비단가'), limit: 0, caption: '택배비 단가', rowClass: flag }) + '</div>' +
        '</div><div class="grid-2" style="margin-top:24px">' +
        '<div>' + table('rcTotal', { columns: priceCols('total'), rows: tierRows.concat([bench]), filename: fileName('3PL견적', '박스당물류비'), limit: 0, caption: '박스당 물류비(포장 + 택배)', rowClass: flag }) + '</div>' +
        '<div>' + table('rcSize', {
          columns: [{ label: '사이즈', type: 'text', value: function (r) { return r.label; }, cls: 'strong' }, { label: '규격 기준', type: 'text', value: function (r) { return r.spec; } },
            { label: '적용 박스', type: 'text', value: function (r) { return r.boxLabel; } }],
          rows: RC.sizes, filename: fileName('3PL견적', '사이즈기준'), limit: 0, caption: '사이즈 기준'
        }) + '<p class="chart-note">기타 단가(구간 무관): ' + RC.others.map(function (o) { return esc(o.item) + ' ' + Fm.int(o.price) + '원/' + esc(o.unit); }).join(' · ') + '</p></div></div>'
    });

    h += section({
      en: 'Tier Impact', ko: '월별 구간 적용과 물류비 영향',
      desc: '막대는 월 택배 박스 수(파랑 = 구간 산정에 들어가는 B2C, 연한 파랑 = 산정에서 빠지는 B2B 택배), 점선은 구간 경계입니다. 같은 물량이라도 경계를 넘으면 그 달의 모든 박스 단가가 내려갑니다.',
      body: panel('월 택배 박스 수와 구간 경계', 'A │ B 9,000 · B │ C 11,000 · C │ D 14,000', chartBox('chTier', '', '월 택배 박스 수와 구간 경계')) + '<div style="margin-top:16px">' +
        table('tierMonths', {
          columns: [
            { label: '월', type: 'text', value: function (r) { return Fm.month(r.month); } },
            { label: '산정 물량(B2C)', type: 'int', value: function (r) { return r.basis; } },
            { label: '적용 구간', type: 'text', value: function (r) { return r.tier; }, cls: 'strong' },
            { label: '다음 구간까지(박스)', type: 'int', value: function (r) { return r.toNext; } },
            { label: '포장+택배 비용(원)', type: 'won', value: function (r) { return r.cost; } },
            { label: '박스당(원)', type: 'won', value: function (r) { return r.perBox; } },
            { label: '다음 구간 단가 적용 시(원)', type: 'won', value: function (r) { return r.costIfNext; } },
            { label: '구간 상향 효과(원)', type: 'signed', value: function (r) { return r.costIfNext === null ? null : r.costIfNext - r.cost; } },
            { label: 'B2B 택배', type: 'int', value: function (r) { return r.b2bParcels; } },
            { label: 'B2B 포함 시 구간', type: 'text', value: function (r) { return r.tierIfB2B; } },
            { label: 'B2B 포함 시 절감(원)', type: 'won', value: function (r) { return r.saveIfB2B; } }
          ], rows: tm, filename: fileName('3PL견적', '월별구간적용'), limit: 0,
          rowClass: function (r) { return r.toNext !== null && r.toNext <= 500 ? 'flag' : ''; }
        }) + '<p class="chart-note">표시된 행은 다음 구간까지 500박스 이하로 남은 달입니다.</p></div>'
    });
    hook(function () { drawTier(tm); });

    h += section({
      en: 'Cost by Size & Box', ko: '사이즈별 · 박스별 물류비',
      desc: '선택 기간의 사이즈별 박스 수와 구간 단가 기준 비용입니다. 박스 규격별로는 필요한 규격보다 큰 박스를 써서 상위 사이즈 단가가 적용된 추가 비용을 함께 봅니다.',
      body: '<div class="grid-2">' + panel('사이즈별 물류비 구성', '파랑 = 택배비, 연한 파랑 = 일반 포장비', chartBox('chSize', 'short', '사이즈별 물류비 구성')) +
        '<div>' + table('sizeCost', {
          columns: [{ label: '사이즈', type: 'text', value: function (r) { return r.label; }, cls: 'strong' },
            { label: '박스 수', type: 'int', value: function (r) { return r.boxes; } }, { label: '박스 비중', type: 'pct', value: function (r) { return r.boxShare; } },
            { label: '평균 포장 단가(원)', type: 'won', value: function (r) { return r.avgPack; } }, { label: '평균 택배 단가(원)', type: 'won', value: function (r) { return r.avgParcel; } },
            { label: '박스당 물류비(원)', type: 'won', value: function (r) { return r.perBox; } },
            { label: '비용 합계(원)', type: 'won', value: function (r) { return r.total; } }, { label: '비용 비중', type: 'pct', value: function (r) { return r.costShare; } }],
          rows: sc.rows, filename: fileName('3PL견적', '사이즈별물류비'), limit: 0, caption: '사이즈별'
        }) + '<div style="margin-top:16px">' + table('boxCost', {
          columns: [{ label: '박스 규격', type: 'text', value: function (r) { return r.label; } }, { label: '적용 사이즈', type: 'text', value: function (r) { return SIZE_LBL[r.size]; } },
            { label: '사용 수(B2C)', type: 'int', value: function (r) { return r.n; } }, { label: '과대 박스', type: 'int', value: function (r) { return r.over; } },
            { label: '과대 비율', type: 'pct', value: function (r) { return r.n ? r.over / r.n : null; } },
            { label: '상위 사이즈 단가로 늘어난 비용(원)', type: 'won', value: function (r) { return r.extra; } }],
          rows: sc.boxes, filename: fileName('3PL견적', '박스규격별'), limit: 0, caption: '박스 규격별'
        }) + '</div></div></div>'
    });
    hook(function () { drawSizeCost(sc); });

    h += section({
      en: 'Where to Cut', ko: '단가를 줄여야 하는 부분',
      desc: '단가 인하 효과 = (현재 적용 단가 − 비교 견적 단가) × 월평균 박스 수. 단가 차이가 커도 물량이 적으면 효과가 작으므로 금액 기준으로 순위를 매깁니다. 현재 단가는 ' + Fm.month(pr.curMonth) + ' 적용 구간(' + pr.curTier + ') 기준입니다.',
      body: '<div class="stat-row" style="margin-bottom:16px">' + pr.levers.map(function (l) {
        return stat(l.name, Fm.wonShort(l.monthly), '/월', esc(l.how) + ' · 연 ' + Fm.wonShort(l.annual));
      }).join('') + '</div><div class="grid-2">' +
        panel('항목별 월 절감 가능액', '단가 협상 기준', chartBox('chCut', 'short', '항목별 월 절감 가능액')) +
        '<div>' + table('priceCut', {
          columns: [{ label: '순위', type: 'int', value: function (r) { return r.rank; } }, { label: '항목', type: 'text', value: function (r) { return r.label; }, cls: 'strong' },
            { label: '현재 단가(원)', type: 'won', value: function (r) { return r.price; } }, { label: '비교 견적(원)', type: 'won', value: function (r) { return r.bench; } },
            { label: '단가 차이(원)', type: 'signed', value: function (r) { return r.gap; } }, { label: '차이율', type: 'pct', value: function (r) { return r.gapRate; } },
            { label: '월평균 박스', type: 'int', value: function (r) { return r.monthlyBoxes; } },
            { label: '월 절감 가능액(원)', type: 'won', value: function (r) { return r.monthlySave; } }, { label: '비중', type: 'pct', value: function (r) { return r.share; } }],
          rows: pr.items, filename: fileName('3PL견적', '단가인하우선순위'), limit: 0, caption: '단가 인하 우선순위',
          rowClass: function (r) { return r.rank <= 2 ? 'flag' : ''; }
        }) + '</div></div>'
    });
    hook(function () { drawCut(pr); });

    h += summary(ratecardSummary(tm, sc, pr, last));
    return h;
  };
  function drawTier(tm) {
    var P = CH.palette();
    CH.render('chTier', { type: 'bar', data: { labels: tm.map(function (r) { return Fm.month(r.month); }), datasets: [
      { label: 'B2C 택배(구간 산정)', data: tm.map(function (r) { return r.basis; }), backgroundColor: P.primary, stack: 't', maxBarThickness: 36 },
      { label: 'B2B 택배(산정 제외)', data: tm.map(function (r) { return r.b2bParcels; }), backgroundColor: P.soft, stack: 't', maxBarThickness: 36 }
    ] }, options: { scales: CH.baseScales({ stacked: true, yFmt: function (v) { return Fm.int(v); } }), interaction: { mode: 'index', intersect: false },
      plugins: { markers: { hlines: [{ y: 9000, label: 'A │ B  9,000' }, { y: 11000, label: 'B │ C  11,000' }, { y: 14000, label: 'C │ D  14,000' }] },
        tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + Fm.int(c.parsed.y) + '박스'; },
          footer: function (it) { var r = tm[it[0].dataIndex]; return r.tier + '구간 적용' + (r.toNext !== null ? ' · 다음 구간까지 ' + Fm.int(r.toNext) + '박스' : '') + ' · B2B 포함 시 ' + r.tierIfB2B + '구간'; } } } } } });
  }
  function drawSizeCost(sc) {
    var P = CH.palette();
    CH.render('chSize', { type: 'bar', data: { labels: sc.rows.map(function (r) { return r.label; }), datasets: [
      { label: '택배비', data: sc.rows.map(function (r) { return r.parcel; }), backgroundColor: P.primary, stack: 'c', maxBarThickness: 56 },
      { label: '일반 포장비', data: sc.rows.map(function (r) { return r.pack; }), backgroundColor: P.soft, stack: 'c', maxBarThickness: 56 }
    ] }, options: { scales: CH.baseScales({ stacked: true, yFmt: function (v) { return Math.round(v / 1e6) + '백만'; } }), interaction: { mode: 'index', intersect: false },
      plugins: { tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + Fm.won(c.parsed.y); }, footer: function (it) { var r = sc.rows[it[0].dataIndex]; return Fm.int(r.boxes) + '박스 · 박스당 ' + Fm.won(r.perBox); } } } } } });
  }
  function drawCut(pr) {
    var P = CH.palette();
    CH.render('chCut', { type: 'bar', data: { labels: pr.items.map(function (r) { return r.label; }), datasets: [
      { label: '월 절감 가능액', data: pr.items.map(function (r) { return r.monthlySave; }), backgroundColor: P.primary, maxBarThickness: 22 }
    ] }, options: { indexAxis: 'y', scales: { x: { grid: { color: P.grid }, border: { display: false }, beginAtZero: true, ticks: { callback: function (v) { return Math.round(v / 1e4) + '만'; } } }, y: { grid: { display: false } } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { var r = pr.items[c.dataIndex]; return Fm.won(r.monthlySave) + '/월 · 단가 차이 ' + Fm.signed(r.gap) + '원 × ' + Fm.int(r.monthlyBoxes) + '박스'; } } } } } });
  }
  function ratecardSummary(tm, sc, pr, last) {
    var out = [];
    var b2bMonths = tm.filter(function (r) { return r.saveIfB2B > 0; });
    var b2bSave = b2bMonths.reduce(function (a, r) { return a + r.saveIfB2B; }, 0);
    out.push('<span class="flow-tag">지표 → 원인</span>' + Fm.month(last.month) + ' 구간 산정 물량은 ' + b(Fm.int(last.basis) + '박스') + '로 ' + b(last.tier + '구간') + '이 적용됐고' +
      (last.nextTier ? ', ' + last.nextTier + '구간까지 ' + b(Fm.int(last.toNext) + '박스') + '가 모자랍니다. 구간 산정에서 B2B 택배 ' + Fm.int(last.b2bParcels) + '박스가 빠지는 계약 조건 때문입니다.' : '.') +
      (b2bMonths.length ? ' 선택 기간 ' + tm.length + '개월 중 ' + b(b2bMonths.length + '개월') + '은 B2B 택배를 포함하면 한 단계 위 구간이 되어 ' + b(Fm.won(b2bSave)) + '(월평균 ' + Fm.won(b2bSave / tm.length) + ')을 덜 냈을 것입니다.' : ''));
    var top = pr.items[0], low = pr.items[pr.items.length - 1];
    var small = sc.rows.filter(function (r) { return r.size === 'S'; })[0];
    if (top) out.push('<span class="flow-tag">지표 → 조치</span>단가 인하 1순위는 ' + b(top.label) + '입니다. 비교 견적과의 차이는 ' + Fm.int(top.gap) + '원으로 크지 않지만, 소형 박스가 전체의 ' + b(pctTxt(small.boxShare)) + '라 월 ' + b(Fm.won(top.monthlySave)) + '(우선순위 전체의 ' + pctTxt(top.share) + ')가 걸려 있습니다. 대형은 단가 차이가 같아도 물량이 적어 효과가 ' + Fm.won(low.monthlySave) + ' 수준입니다. 협상은 소형 택배비·소형 포장 단가부터, 근거는 비교 견적과 월 물량 추이로 준비합니다.');
    out.push('<span class="flow-tag">조치</span>① 재계약 시 구간 산정 물량에 B2B 택배를 포함하거나 경계(11,000박스)를 낮추고, ② 소형 단가를 비교 견적 수준으로 협상하며, ③ 과대 박스로 상위 사이즈 단가가 붙은 ' + b(Fm.won(sc.overExtra)) + '는 박스 자동 추천으로 줄입니다. 합포장을 늘리면 박스 수가 줄어 구간이 내려갈 수 있으므로, 경계 근처 달에는 합포장 효과와 구간 단가 변화를 함께 계산해 결정합니다. 구간 단가가 실제 청구에 반영됐는지는 07 정산 검증의 "청구 단가 = 계약 단가" 대사로 매월 확인합니다.');
    return out;
  }

  /* ------------------------------------------------------------------
   * 필터·내비게이션·이벤트
   * ------------------------------------------------------------------ */
  function initControls() {
    var nav = document.getElementById('nav');
    nav.innerHTML = SCREENS.map(function (s) {
      return '<li><button type="button" data-screen="' + s.id + '"><span class="nav-no">' + s.no + '</span><span class="nav-ko">' + esc(s.ko) + '</span><span class="nav-en">' + esc(s.en) + '</span></button></li>';
    }).join('');
    document.getElementById('sidebarFoot').innerHTML =
      '<dt>기준 시각</dt><dd>' + M.nowLabel + '</dd><dt>데이터 기간</dt><dd>' + M.startIso + ' ~ ' + M.endIso + '</dd>' +
      '<dt>3PL 센터 (가정)</dt><dd>일 ' + Fm.int(M.CAPACITY) + '건 · 마감 ' + D.center.cutoff + '</dd><dt>데이터</dt><dd>가상 데이터 (시드 ' + M.seed + ')</dd>';
    var ch = document.getElementById('fChannel');
    ch.innerHTML = '<option value="ALL">전체 채널</option><optgroup label="B2C"><option value="B2C">B2C 전체</option>' +
      D.channels.b2c.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('') + '</optgroup>' +
      '<optgroup label="B2B"><option value="B2B">B2B 전체</option>' + D.channels.b2b.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('') + '</optgroup>';
    var cats = [];
    SK.forEach(function (k) { if (cats.indexOf(k.category) < 0) cats.push(k.category); });
    document.getElementById('fProduct').innerHTML = '<option value="ALL">전체 상품</option><optgroup label="카테고리">' +
      cats.map(function (c) { return '<option value="cat:' + esc(c) + '">' + esc(c) + ' 전체</option>'; }).join('') + '</optgroup><optgroup label="SKU">' +
      SK.map(function (k) { return '<option value="sku:' + k.id + '">' + esc(k.name) + '</option>'; }).join('') + '</optgroup>';
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
      if (t.id === 'fChannel') state.filter.channel = t.value;
      if (t.id === 'fProduct') state.filter.product = t.value;
      syncControls();
      render();
    });
    document.getElementById('fReset').addEventListener('click', function () {
      state.filter = JSON.parse(JSON.stringify(DEFAULT_FILTER));
      syncControls(); render();
    });
    nav.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-screen]');
      if (btn) go(btn.getAttribute('data-screen'));
    });

    var view = document.getElementById('view');
    view.addEventListener('click', function (e) {
      var ex = e.target.closest('[data-export]');
      if (ex) { var r = exportsReg[ex.getAttribute('data-export')]; if (r) X.download(r.filename, r.columns, r.rows); return; }
      var g = e.target.closest('[data-go]');
      if (g) { go(g.getAttribute('data-go')); return; }
      var ag = e.target.closest('[data-action-group]');
      if (ag) {
        var v = ag.getAttribute('data-action-group');
        state.local.actionGroup = state.local.actionGroup === v ? 'ALL' : v;
        var ar = actionRows();
        blocks['blk-actions'] = function () { return actionBlock(ar); };
        refreshBlock('blk-actions'); return;
      }
      var is = e.target.closest('[data-issue-status]');
      if (is) {
        state.local.issueStatus = is.getAttribute('data-issue-status');
        document.querySelectorAll('[data-issue-status]').forEach(function (bt) { bt.setAttribute('aria-pressed', String(bt === is)); });
        refreshBlock('blk-issues');
      }
    });
    view.addEventListener('change', function (e) {
      var t = e.target;
      var tg = t.getAttribute('data-toggle');
      if (tg) {
        state.local[tg] = t.checked;
        refreshBlock({ reconDiffOnly: 'blk-recon', billDiffOnly: 'blk-bill', mmOpenOnly: 'blk-mm' }[tg]);
        return;
      }
      if (t.getAttribute('data-select') === 'billMonth') { state.local.billMonth = t.value; refreshBlock('blk-bill'); return; }
      if (t.getAttribute('data-sim') === 'sku') {
        state.local.simSku = +t.value;
        var r = S.simulate(state.local.simSku, 0.5);
        state.local.simShare = Math.min(100, Math.ceil(r.needShare * 20) * 5);
        var range = view.querySelector('[data-sim="share"]');
        if (range) range.value = state.local.simShare;
        updateSimText(r);
        refreshBlock('blk-sim'); drawSim();
      }
    });
    view.addEventListener('input', function (e) {
      if (e.target.getAttribute('data-sim') === 'share') {
        state.local.simShare = +e.target.value;
        updateSimText();
        refreshBlock('blk-sim'); drawSim();
      }
    });
    window.addEventListener('hashchange', function () {
      var id = location.hash.replace('#', '');
      if (id && id !== state.screen && SCREENS.some(function (s) { return s.id === id; })) { state.screen = id; render(); }
    });
  }
  function updateSimText(r) {
    var t = document.getElementById('simShareTxt'); if (t) t.textContent = state.local.simShare + '%';
    if (r) { var n = document.getElementById('simNeed'); if (n) n.textContent = Fm.pct(r.needShare, 0); }
  }
  function syncControls() {
    var f = state.filter;
    document.getElementById('fPeriod').value = f.period;
    document.getElementById('fChannel').value = f.channel;
    document.getElementById('fProduct').value = f.product;
    document.getElementById('customRange').classList.toggle('on', f.period === 'custom');
    if (f.period === 'custom') { document.getElementById('fFrom').value = f.from; document.getElementById('fTo').value = f.to; }
  }
  function go(id) {
    state.screen = id;
    if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
    render();
    window.scrollTo(0, 0);
    document.getElementById('view').focus({ preventScroll: true });
  }
  function scopeLineHtml() {
    var chSel = document.getElementById('fChannel'), prSel = document.getElementById('fProduct');
    return '적용 범위 <strong>' + Cal.isoOf(F.from) + ' ~ ' + Cal.isoOf(F.to) + '</strong> (' + F.days + '일) · 채널 <strong>' + esc(chSel.options[chSel.selectedIndex].text) + '</strong> · 상품 <strong>' +
      esc(prSel.options[prSel.selectedIndex].text) + '</strong> · 기준 시각 ' + M.nowLabel;
  }

  function render() {
    F = S.resolveFilter(state.filter);
    exportsReg = {}; blocks = {}; hooks = [];
    CH.destroyAll();
    var sc = SCREENS.filter(function (s) { return s.id === state.screen; })[0] || SCREENS[0];
    document.querySelectorAll('#nav [data-screen]').forEach(function (bt) {
      if (bt.getAttribute('data-screen') === sc.id) bt.setAttribute('aria-current', 'page'); else bt.removeAttribute('aria-current');
    });
    document.getElementById('pageEyebrow').textContent = sc.no + ' · ' + sc.en;
    document.getElementById('pageTitle').textContent = sc.ko;
    document.getElementById('pageDuty').textContent = sc.duty;
    document.getElementById('scopeLine').innerHTML = scopeLineHtml();
    document.title = sc.ko + ' · K-Beauty Brand SCM Operations — Portfolio';
    var view = document.getElementById('view');
    view.innerHTML = RENDER[sc.id]();
    runHooks();
  }

  // 시작
  CH.applyDefaults();
  initControls();
  var h0 = location.hash.replace('#', '');
  if (SCREENS.some(function (s) { return s.id === h0; })) state.screen = h0;
  render();
  // 서체 로딩 후 차트 글꼴 반영
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { CH.applyDefaults(); render(); });

  // 점검용 노출
  window.SCMApp = { state: state, render: render, go: go, exports: function () { return exportsReg; } };
})();
