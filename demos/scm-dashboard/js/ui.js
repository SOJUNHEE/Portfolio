/* =====================================================================
 * js/ui.js — 두 데모가 함께 쓰는 화면 틀과 위젯 (개인 학습 프로젝트)
 * - 표 하나의 열 정의로 화면·검색·페이지·CSV를 만들고, 수치는 metrics.js 결과만 씁니다.
 * - 사이트마다 다른 것은 화면 목록과 화면 내용(app.js)뿐입니다.
 * ===================================================================== */
(function () {
  'use strict';
  var D = window.SCM_DATA, S = window.SCMMetrics, CH = window.SCMCharts, X = window.SCMExport, Fm = X.fmt;
  var M = D.meta, Cal = D.cal, END = M.END_DAY, IT = D.IT, INDI = D.INDI;
  var DEFAULT_FILTER = { period: 'all', from: null, to: null, ind: 'ALL', ch: 'ALL' };
  var state = { screen: null, filter: JSON.parse(JSON.stringify(DEFAULT_FILTER)), tables: {}, local: { wave: null, issueKind: 'ALL', pivot: { row: 'ind', col: 'month', val: 'orders' } } };
  var exportsReg = {}, tableReg = {}, hooks = [], F = null, SCREENS = [], RENDER = {}, CFG = {};
  var CH_NAME = {}; D.channels.forEach(function (c) { CH_NAME[c.id] = c.name; });

  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function scr(id) { return SCREENS.filter(function (s) { return s.id === id; })[0]; }
  function nm(id) { return IT[id] ? IT[id].name : id; }
  function ni(id) { return INDI[id].name; }
  function statusHtml(st, label) { if (!st) return '<span class="status none">' + esc(label || '해당 없음') + '</span>'; return '<span class="status ' + st + '">' + esc(label || Fm.statusLabel(st)) + '</span>'; }
  function section(o) { return '<section class="section"><div class="section-head"><div>' + (o.en ? '<span class="eyebrow">' + esc(o.en) + '</span>' : '') + '<h2>' + esc(o.ko) + '</h2>' + (o.desc ? '<p class="section-desc">' + o.desc + '</p>' : '') + '</div>' + (o.tools ? '<div class="section-tools">' + o.tools + '</div>' : '') + '</div>' + o.body + '</section>'; }
  function panel(title, sub, body) { return '<div class="panel"><div class="panel-head"><div><div class="panel-title">' + esc(title) + '</div>' + (sub ? '<div class="panel-sub">' + sub + '</div>' : '') + '</div></div>' + body + '</div>'; }
  function chartBox(id, cls, label) { return '<div class="chart-box ' + (cls || '') + '"><canvas id="' + id + '" role="img" aria-label="' + esc(label || '차트') + '"></canvas></div>'; }
  function stat(label, value, unit, sub) { return '<div class="stat"><div class="stat-label">' + esc(label) + '</div><div class="stat-value">' + value + (unit ? '<small>' + esc(unit) + '</small>' : '') + '</div>' + (sub ? '<div class="stat-sub">' + sub + '</div>' : '') + '</div>'; }
  function statRow(a) { return '<div class="stat-row">' + a.join('') + '</div>'; }
  function naBox(t) { return '<div class="na-box">' + esc(t) + '</div>'; }
  function hook(fn) { hooks.push(fn); }
  function fileName(a, b) { return (CFG.prefix + '_' + a + '_' + b + '_' + Cal.isoOf(F.from) + '_' + Cal.isoOf(F.to) + '.csv').replace(/[\\/:*?"<>|·\s]+/g, '_'); }
  function mmdd(d) { return Cal.isoOf(d).slice(5).replace('-', '/'); }
  function hhmm(t) { return ('0' + Math.floor(t / 60)).slice(-2) + ':' + ('0' + (t % 60)).slice(-2); }
  function b(x) { return '<b>' + x + '</b>'; }
  function goBtn(id, label) { var s = scr(id); return '<button type="button" class="link-btn" data-go="' + s.id + '">' + esc(label || s.no + ' ' + s.ko) + '</button>'; }
  function summary(items) { var list = items.filter(Boolean); if (!list.length) list = ['선택한 필터 조건에 해당하는 데이터가 부족해 해석을 생략합니다.']; return '<section class="summary" aria-label="가상 시나리오 기준 요약"><span class="eyebrow">Analysis · Sample Data</span><h2>가상 시나리오 기준 요약</h2><ol>' + list.map(function (t) { return '<li><span>' + t + '</span></li>'; }).join('') + '</ol></section>'; }
  function dlIcon() { return '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1v7M3 5l3 3 3-3M1.5 10.5h9" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>'; }
  function statusCol(label, fn, textFn) { return { label: label, type: 'text', value: function (r) { return textFn ? textFn(r) : fn(r) ? Fm.statusLabel(fn(r)) : '해당 없음'; }, html: function (r) { return statusHtml(fn(r), textFn ? textFn(r) : null); } }; }
  function chCol(fn) { return { label: '채널', type: 'text', value: function (r) { return CH_NAME[fn(r)]; }, cls: 'nowrap' }; }
  function indCol(fn) { return { label: '상품군', type: 'text', value: function (r) { return ni(fn(r)); }, cls: 'nowrap' }; }
  function linesTxt(lines) { return lines.map(function (l) { return nm(l[0]) + ' ×' + l[1]; }).join(', '); }
  function stTone(s) { return /취소|대기|보류|부족|요청|제한/.test(s) ? 'warn' : 'ok'; }
  function sumOf(a, f) { return a.reduce(function (s, x) { return s + f(x); }, 0); }
  function intAxis() { return function (v) { return Fm.int(v); }; }
  function wonAxis() { return function (v) { return Fm.wonShort(v); }; }
  function weekBuckets() { var out = [], d = F.from; while (d <= F.to) { var w = Cal.dowOf(d), e = Math.min(F.to, d + ((7 - w) % 7)); out.push([d, e]); d = e + 1; } return out; }
  function hbar(id, labels, label, data, colors) {
    hook(function () {
      var P = CH.palette();
      CH.render(id, { type: 'bar', data: { labels: labels, datasets: [{ label: label, data: data, backgroundColor: colors ? data.map(function (v, i) { return P.tone(colors(i)); }) : P.tone(0) }] },
        options: { indexAxis: 'y', scales: (function () { var sc = CH.baseScales({}); delete sc.y.ticks.callback; delete sc.y.beginAtZero; sc.x.ticks.callback = intAxis(); sc.x.grid = { color: P.grid }; sc.y.grid = { display: false }; return sc; })(), plugins: { legend: { display: false } } } });
    });
  }

  /* 표 */
  var NUMERIC = { int: 1, num1: 1, pct: 1, pct2: 1, won: 1, signed: 1, hours: 1 };
  var LONG_COL = /(내용|사유|비고|원인|조치|메모|설명|이슈|문제|영향|직접|근거|기준|점검|상품$|상품명|항목$|규칙|실제 경력|검수|보관|포장|반품 판정|화면)/;
  function table(key, cfg) {
    tableReg[key] = cfg; state.tables[key] = state.tables[key] || { q: '', page: 0 };
    exportsReg[key] = { filename: cfg.filename, columns: cfg.columns, rows: function () { return filteredRows(key); } };
    var ts = state.tables[key];
    return '<div class="table-block" data-table="' + key + '"><div class="table-tools"><span class="t-count">' + (cfg.caption ? esc(cfg.caption) + ' · ' : '') + '<span data-count="' + key + '"></span></span><span class="t-right">' +
      (cfg.search === false ? '' : '<input type="search" class="t-search" data-search="' + key + '" placeholder="' + esc(cfg.searchHint || '표 안에서 검색') + '" aria-label="표 검색" value="' + esc(ts.q) + '">') +
      '<button type="button" class="btn" data-export="' + key + '">' + dlIcon() + 'CSV 내보내기</button></span></div><div data-tbody="' + key + '">' + tableBody(key) + '</div></div>';
  }
  function filteredRows(key) { var cfg = tableReg[key], q = (state.tables[key].q || '').trim().toLowerCase(); if (!q) return cfg.rows; var terms = q.split(/\s+/); return cfg.rows.filter(function (r) { var t = cfg.columns.map(function (c) { return X.display(c, r); }).join(' ').toLowerCase(); return terms.every(function (x) { return t.indexOf(x) >= 0; }); }); }
  function tableBody(key) {
    var cfg = tableReg[key], cols = cfg.columns, rows = filteredRows(key), ts = state.tables[key], size = cfg.pageSize || 12, pages = Math.max(1, Math.ceil(rows.length / size));
    if (ts.page >= pages) ts.page = pages - 1;
    var shown = cfg.pageSize === 0 ? rows : rows.slice(ts.page * size, ts.page * size + size);
    var h = '<div class="table-wrap"><table class="data"><thead><tr>';
    cols.forEach(function (c) { h += '<th class="' + (NUMERIC[c.type] ? 'r' : '') + '" scope="col">' + esc(c.label) + '</th>'; });
    h += '</tr></thead><tbody>';
    if (!shown.length) h += '<tr><td colspan="' + cols.length + '" class="muted c">' + esc(ts.q ? '검색 결과가 없습니다.' : (cfg.empty || '해당 기간에 데이터가 없습니다.')) + '</td></tr>';
    shown.forEach(function (r) { var rc = cfg.rowClass ? cfg.rowClass(r) : ''; h += '<tr' + (rc ? ' class="' + rc + '"' : '') + '>'; cols.forEach(function (c) { h += '<td class="' + (NUMERIC[c.type] ? 'r ' : '') + (c.cls || '') + (LONG_COL.test(c.label) ? ' wrap' : '') + '">' + (c.html ? c.html(r) : esc(X.display(c, r))) + '</td>'; }); h += '</tr>'; });
    h += '</tbody></table></div>';
    if (cfg.pageSize !== 0 && pages > 1) h += '<div class="pager"><span>' + (ts.page * size + 1) + '–' + Math.min(rows.length, ts.page * size + size) + ' / ' + Fm.int(rows.length) + '건</span><button type="button" data-page="' + key + '" data-dir="-1"' + (ts.page === 0 ? ' disabled' : '') + '>이전</button><span>' + (ts.page + 1) + ' / ' + pages + '</span><button type="button" data-page="' + key + '" data-dir="1"' + (ts.page >= pages - 1 ? ' disabled' : '') + '>다음</button></div>';
    return h + '<span hidden data-total="' + key + '">' + rows.length + '</span>';
  }
  function refreshTable(key) { var el = document.querySelector('[data-tbody="' + key + '"]'); if (el) el.innerHTML = tableBody(key); updateCount(key); }
  function updateCount(key) { var c = document.querySelector('[data-count="' + key + '"]'); if (!c) return; var n = filteredRows(key).length, all = tableReg[key].rows.length; c.innerHTML = '<b class="num">' + Fm.int(n) + '</b>건' + (n !== all ? ' (전체 ' + Fm.int(all) + '건 중 검색 결과)' : ''); }
  function steps(list, cls) { return '<div class="stages case ' + (cls || '') + '">' + list.map(function (x, i) { return '<div class="stage"><div class="stage-no">STEP ' + (i + 1) + '</div><div class="stage-title">' + esc(x[0]) + '</div><div class="stat-value">' + x[1] + '<small>' + esc(x[2]) + '</small></div><div class="stat-sub">' + esc(x[3]) + '</div></div>'; }).join('') + '</div>'; }

  /* KPI */
  function kpiValueHtml(k) {
    if (k.na || k.value === null || k.value === undefined) return '<div class="kpi-value na">—</div>';
    if (k.unit === '%') return '<div class="kpi-value">' + (k.value * 100).toFixed(1) + '<small>%</small></div>';
    if (k.unit === '%2') return '<div class="kpi-value">' + (k.value * 100).toFixed(2) + '<small>%</small></div>';
    if (k.unit === '라인') return '<div class="kpi-value">' + Fm.num1(k.value) + '<small>라인</small></div>';
    return '<div class="kpi-value">' + Fm.int(k.value) + '<small>' + esc(k.unit) + '</small></div>';
  }
  function kpiCard(k) {
    var st = S.kpiStatus(k), tgt = k.target === undefined || k.target === null ? '' : k.key === 'mis' ? '목표 ' + (k.target * 100).toFixed(1) + '% 이하' : '목표 ' + (k.target * 100).toFixed(0) + '% 이상';
    var go = k.go && scr(k.go) ? goBtn(k.go, '자세히') : '';
    return '<div class="kpi' + (st ? ' ' + st : '') + '" data-kpi="' + k.key + '"><div class="kpi-top"><span class="kpi-label">' + esc(k.label) + '</span></div><p class="kpi-hint">' + esc(k.hint) + '</p>' + kpiValueHtml(k) +
      (k.na ? '<div class="kpi-meta">현재 필터에 해당하지 않음</div>' : (tgt ? '<div class="kpi-meta"><span>' + esc(tgt) + '</span></div>' : '') + '<div class="kpi-meta"><span>' + esc(k.detail) + '</span></div>') +
      (st || go ? '<div class="kpi-foot">' + (st ? statusHtml(st, st === 'ok' ? '정상' : st === 'warn' ? '주의' : '확인 필요') : '<span></span>') + go + '</div>' : '') + '</div>';
  }

  /* 공통 위젯 — 재고·실사·이동·발주·기한·옵션·세트·반품·미출고 */
  var W = {
    stockTable: function (key) {
      var sn = S.stockNow(F);
      return table(key || 'stockNow', {
        columns: [indCol(function (r) { return r.ind; }), { label: 'SKU', type: 'text', value: function (r) { return r.item; }, cls: 'nowrap' }, { label: '상품명', type: 'text', value: function (r) { return nm(r.item); } },
          { label: '정상', type: 'int', value: function (r) { return r.normal; } }, { label: '보류', type: 'int', value: function (r) { return r.hold; } }, { label: '출고 제한', type: 'int', value: function (r) { return r.limited; } }, { label: '격리', type: 'int', value: function (r) { return r.dmg; } },
          { label: '출고 예약', type: 'int', value: function (r) { return r.res; } }, { label: '가용', type: 'int', value: function (r) { return r.avail; } }, { label: '전산 판매 가능', type: 'int', value: function (r) { return r.sysGood; } }, { label: '실물−전산', type: 'signed', value: function (r) { return r.gap; } }],
        rows: sn, filename: fileName('재고', '기준일재고'), rowClass: function (r) { return r.gap ? 'flag' : ''; }, searchHint: 'SKU·상품명 검색'
      });
    },
    countTable: function () {
      var ct = S.counts(F);
      return table('counts', {
        columns: [{ label: '실사일', type: 'date', value: function (r) { return r.d; }, cls: 'nowrap' }, indCol(function (r) { return r.ind; }), { label: '상품', type: 'text', value: function (r) { return nm(r.item); } }, { label: '실물', type: 'int', value: function (r) { return r.phys; } }, { label: '전산', type: 'int', value: function (r) { return r.sys; } },
          { label: '차이', type: 'signed', value: function (r) { return r.diff; } }, { label: '격리 차이', type: 'signed', value: function (r) { return r.dmgDiff; } }, { label: '원인', type: 'text', value: function (r) { return r.causes.map(function (c) { return c.cause + ' ' + Fm.signed(c.qty); }).join(' · ') || '—'; } }],
        rows: ct.diffs.slice().reverse(), filename: fileName('재고', '실사차이'), empty: '선택 기간에 실사 차이가 없습니다.', searchHint: '상품·원인 검색'
      });
    },
    moveTable: function () {
      return table('moves', {
        columns: [{ label: '일자', type: 'date', value: function (r) { return r.d; }, cls: 'nowrap' }, { label: '구분', type: 'text', value: function (r) { return r.type; }, cls: 'nowrap' }, { label: '상품', type: 'text', value: function (r) { return nm(r.item); } }, { label: '로트', type: 'text', value: function (r) { return r.lot; }, cls: 'nowrap' },
          { label: '수량', type: 'signed', value: function (r) { return r.qty; } }, { label: '건수', type: 'int', value: function (r) { return r.n; } }, { label: '참조', type: 'text', value: function (r) { return r.ref || '—'; }, cls: 'nowrap' }],
        rows: S.movesIn(F).slice().reverse(), filename: fileName('재고', '이동이력'), searchHint: '구분·상품·로트 검색'
      });
    },
    poTable: function () {
      return table('pos', {
        columns: [{ label: '요청번호', type: 'text', value: function (r) { return r.id; }, cls: 'nowrap' }, { label: '요청일', type: 'date', value: function (r) { return r.d; } }, { label: '상품', type: 'text', value: function (r) { return nm(r.item); } }, { label: '수량', type: 'int', value: function (r) { return r.qty; } },
          { label: '예정 입고', type: 'date', value: function (r) { return r.plan; } }, { label: '실제 입고', type: 'text', value: function (r) { return r.arrive === null ? '입고 예정 (' + Cal.isoOf(r.eta) + ')' : Cal.isoOf(r.arrive); }, cls: 'nowrap' }, { label: '비고', type: 'text', value: function (r) { return r.note || '—'; } }],
        rows: S.posIn(F).slice().reverse(), filename: fileName('재고', '재고발주'), rowClass: function (r) { return r.note ? 'flag' : ''; }, searchHint: '상품·요청번호 검색'
      });
    },
    importTable: function () {
      var list = S.posIn(F).filter(function (p) { return p.stages; });
      return table('imports', {
        columns: [{ label: '요청번호', type: 'text', value: function (r) { return r.id; }, cls: 'nowrap' }, { label: '상품', type: 'text', value: function (r) { return nm(r.item); } }, { label: '수량', type: 'int', value: function (r) { return r.qty; } }, { label: '선적', type: 'date', value: function (r) { return r.stages.선적; } }, { label: '입항', type: 'date', value: function (r) { return r.stages.입항; } },
          { label: '통관', type: 'date', value: function (r) { return r.stages.통관; } }, { label: '보세 반출', type: 'date', value: function (r) { return r.stages.보세반출; } }, { label: '입고', type: 'text', value: function (r) { return r.arrive === null ? '예정 ' + Cal.isoOf(r.eta) : Cal.isoOf(r.arrive); }, cls: 'nowrap' }, { label: '비고', type: 'text', value: function (r) { return r.note || '—'; } }],
        rows: list.slice().reverse(), filename: fileName('식품', '수입일정'), rowClass: function (r) { return r.delayed ? 'flag' : ''; }, pageSize: 8, searchHint: '상품·요청번호 검색'
      });
    },
    expiry: function (label) {
      var ex = S.expiry(F), id = 'chExp' + (label || '');
      var h = statRow([stat('출고 로트 평균 잔여', ex.avgRemain === null ? '—' : Fm.int(ex.avgRemain), '일', '기간 내 출고 기준'), stat('출고 로트 최소 잔여', ex.minRemain === null ? '—' : Fm.int(ex.minRemain), '일', '출고 제한 기준 60일'), stat('출고 제한 재고', Fm.int(ex.limited), '개', '잔여 60일 미만')]) +
        '<div class="grid-2">' + panel('기한 구간별 실물', '개 · 기준일 ' + M.endIso, chartBox(id, '', '기한 구간별 재고')) + panel('구간별 합계', '', table('buckets', { columns: [{ label: '잔여 기한', type: 'text', value: function (r) { return r.label; }, cls: 'strong' }, { label: '로트', type: 'int', value: function (r) { return r.lots; } }, { label: '실물', type: 'int', value: function (r) { return r.units; } }], rows: ex.buckets, filename: fileName('기한', '구간별'), pageSize: 0, search: false })) + '</div>';
      hook(function () { var P = CH.palette(); CH.render(id, { type: 'bar', data: { labels: ex.buckets.map(function (x) { return x.label; }), datasets: [{ label: '실물(개)', data: ex.buckets.map(function (x) { return x.units; }), backgroundColor: ex.buckets.map(function (x, i) { return i === 0 ? P.tone(2) : P.tone(0); }) }] }, options: { scales: CH.baseScales({ yFmt: intAxis() }), plugins: { legend: { display: false } } } }); });
      return h + table('lots', {
        columns: [{ label: '로트', type: 'text', value: function (r) { return r.lot.id; }, cls: 'strong nowrap' }, { label: '상품', type: 'text', value: function (r) { return nm(r.lot.item); } }, { label: '로케이션', type: 'text', value: function (r) { return r.lot.loc; }, cls: 'nowrap' }, { label: '입고일', type: 'date', value: function (r) { return r.lot.inDay; } }, { label: '기한', type: 'date', value: function (r) { return r.lot.exp; } }, { label: '잔여일', type: 'int', value: function (r) { return r.remain; } },
          statusCol('상태', function (r) { return r.state === '정상' ? 'ok' : 'warn'; }, function (r) { return r.state; }), { label: '실물', type: 'int', value: function (r) { return r.lot.good; } }, { label: '예약', type: 'int', value: function (r) { return r.lot.res; } }, { label: '격리', type: 'int', value: function (r) { return r.lot.dmg; } }],
        rows: ex.lots, filename: fileName('기한', '로트별'), rowClass: function (r) { return r.state !== '정상' ? 'flag' : ''; }, pageSize: 8, searchHint: '상품·로트·상태 검색'
      });
    },
    matrix: function () {
      var m = S.matrix();
      return table('matrix', {
        columns: [{ label: '스타일', type: 'text', value: function (r) { return r.style; }, cls: 'strong nowrap' }, { label: '색상', type: 'text', value: function (r) { return r.color; }, cls: 'nowrap' }, { label: '시즌', type: 'text', value: function (r) { return r.season; } }, { label: 'S', type: 'int', value: function (r) { return r.S; } }, { label: 'M', type: 'int', value: function (r) { return r.M; } }, { label: 'L', type: 'int', value: function (r) { return r.L; } }, { label: '합계', type: 'int', value: function (r) { return r.total; } }],
        rows: m, filename: fileName('의류', '색상사이즈재고'), pageSize: 0, search: false, rowClass: function (r) { return r.S === 0 || r.M === 0 || r.L === 0 ? 'flag' : ''; }
      });
    },
    sets: function () {
      return table('sets', {
        columns: [indCol(function (r) { return r.ind; }), { label: '세트', type: 'text', value: function (r) { return nm(r.item); }, cls: 'strong' }, { label: '구성', type: 'text', value: function (r) { return r.bom.map(function (x) { return nm(x[0]) + ' ×' + x[1]; }).join(' + '); }, cls: 'wrap' }, { label: '기간 출고', type: 'int', value: function (r) { return r.shipped; } }, { label: '조립 가능', type: 'int', value: function (r) { return r.can; } }, { label: '제약 구성품', type: 'text', value: function (r) { return nm(r.limit); }, cls: 'wrap' }],
        rows: S.sets(F), filename: fileName('세트', '세트재고'), pageSize: 0, search: false
      });
    },
    aging: function (days) {
      var a = S.aging(F, days);
      return table('aging', {
        columns: [{ label: '로트', type: 'text', value: function (r) { return r.lot.id; }, cls: 'nowrap' }, { label: '상품', type: 'text', value: function (r) { return nm(r.lot.item); } }, { label: '시즌', type: 'text', value: function (r) { return r.season || '—'; } }, { label: '입고일', type: 'date', value: function (r) { return r.lot.inDay; } }, { label: '입고 후 일수', type: 'int', value: function (r) { return r.age; } }, { label: '실물', type: 'int', value: function (r) { return r.lot.good; } }],
        rows: a, filename: fileName('재고', '장기재고'), pageSize: 8, search: false, empty: '장기 재고가 없습니다.'
      });
    },
    byItem: function (key) {
      return table(key || 'byItem', {
        columns: [{ label: '상품', type: 'text', value: function (r) { return nm(r.item); } }, { label: '출고 라인', type: 'int', value: function (r) { return r.orders; } }, { label: '출고 수량', type: 'int', value: function (r) { return r.units; } }, { label: '오출고', type: 'int', value: function (r) { return r.mis; } }, { label: '반품', type: 'int', value: function (r) { return r.rets; } }, { label: '재판매 불가', type: 'int', value: function (r) { return r.bad; } }],
        rows: S.byItem(F).sort(function (a, c) { return c.units - a.units; }), filename: fileName('상품', '상품별'), pageSize: 10, searchHint: '상품 검색'
      });
    },
    returns: function () {
      var is = S.issues(F);
      return table('rets', {
        columns: [{ label: '반품번호', type: 'text', value: function (r) { return r.ret.id; }, cls: 'nowrap' }, { label: '주문번호', type: 'text', value: function (r) { return r.id; }, cls: 'nowrap' }, indCol(function (r) { return r.ind; }), { label: '상품', type: 'text', value: function (r) { return nm(r.ret.item); } }, { label: '수량', type: 'int', value: function (r) { return r.ret.qty; } }, { label: '사유', type: 'text', value: function (r) { return r.ret.reason; } }, { label: '요청일', type: 'date', value: function (r) { return r.ret.req; } },
          { label: '입고일', type: 'text', value: function (r) { return r.ret.done === null ? '회수 중' : Cal.isoOf(r.ret.done); }, cls: 'nowrap' }, { label: '판정', type: 'text', value: function (r) { return r.ret.grade || '—'; }, cls: 'nowrap' }],
        rows: is.rets.slice().reverse(), filename: fileName('반품', '반품목록'), searchHint: '반품번호·상품·판정 검색'
      });
    },
    late: function () {
      var is = S.issues(F);
      return table('late', {
        columns: [{ label: '주문번호', type: 'text', value: function (r) { return r.id; }, cls: 'nowrap' }, indCol(function (r) { return r.ind; }), chCol(function (r) { return r.ch; }), { label: '주문 시각', type: 'text', value: function (r) { return Cal.isoOf(r.day) + ' ' + hhmm(r.t); }, cls: 'nowrap' }, { label: '출고 기한', type: 'date', value: function (r) { return r.due; } },
          { label: '출고 확정', type: 'text', value: function (r) { return r.ship === null ? '미출고' : Cal.isoOf(r.ship); }, cls: 'nowrap' }, { label: '원인', type: 'text', value: function (r) { return r.lateCause; } }],
        rows: is.late.slice().reverse(), filename: fileName('이슈', '미출고'), searchHint: '주문번호·원인 검색'
      });
    },
    issueList: function () {
      var is = S.issues(F), kinds = ['ALL', '오출고', '배송 중 파손', '배송 지연', '반품'], list = state.local.issueKind === 'ALL' ? is.list : is.list.filter(function (i) { return i.kind === state.local.issueKind; });
      return { tools: '<div class="seg" role="group" aria-label="이슈 유형">' + kinds.map(function (k) { return '<button type="button" data-issue-kind="' + k + '" aria-pressed="' + (state.local.issueKind === k) + '">' + (k === 'ALL' ? '전체' : k) + '</button>'; }).join('') + '</div>',
        body: table('issues', {
          columns: [{ label: '접수번호', type: 'text', value: function (r) { return r.id; }, cls: 'nowrap' }, { label: '접수일', type: 'date', value: function (r) { return r.d; } }, { label: '유형', type: 'text', value: function (r) { return r.kind; }, cls: 'strong nowrap' }, { label: '주문번호', type: 'text', value: function (r) { return r.order; }, cls: 'nowrap' }, indCol(function (r) { return r.ind; }), { label: '상품', type: 'text', value: function (r) { return nm(r.item); } }, { label: '조치', type: 'text', value: function (r) { return r.act; } },
            { label: '처리', type: 'text', value: function (r) { if (r.reship) { var re = D.OD[r.reship]; return re.ship !== null ? '재출고 ' + Cal.isoOf(re.ship) : '재출고 대기'; } if (r.ret) { var o = D.OD[r.order]; return o.ret.done !== null ? '입고 ' + Cal.isoOf(o.ret.done) + ' · ' + o.ret.grade : '회수 중'; } return '기록'; }, cls: 'wrap' }],
          rows: list.slice().reverse(), filename: fileName('이슈', '이슈목록'), searchHint: '주문번호·유형·상품 검색'
        }) };
    },
    checks: function () {
      return table('checks', {
        columns: [{ label: '점검', type: 'text', value: function (r) { return r.check; }, cls: 'strong' }, { label: '기준', type: 'text', value: function (r) { return r.rule; } }, { label: '결과(건)', type: 'int', value: function (r) { return r.n; } }, statusCol('상태', function (r) { return r.info ? null : r.n ? 'risk' : 'ok'; }, function (r) { return r.info ? '차단 확인' : r.n ? '확인 필요' : '이상 없음'; })],
        rows: S.integrity(F), filename: fileName('점검', '정합성'), pageSize: 0, search: false
      });
    },
    indRules: function () {
      return table('indRules', {
        columns: [{ label: '상품군', type: 'text', value: function (r) { return r.name; }, cls: 'strong nowrap' }, { label: '가상 화주사', type: 'text', value: function (r) { return r.client; } }, { label: '입고 검수', type: 'text', value: function (r) { return r.qc.join(' · '); } }, { label: '보관', type: 'text', value: function (r) { return r.storage; } }, { label: '배정 규칙', type: 'text', value: function (r) { return r.pickRule; }, cls: 'nowrap' }, { label: '포장', type: 'text', value: function (r) { return r.packNote; } }, { label: '반품 판정', type: 'text', value: function (r) { return r.retGrades.join(' · '); } }, { label: '실제 경력 연결', type: 'text', value: function (r) { return r.real; } }],
        rows: D.inds, filename: fileName('소개', '상품군기준'), pageSize: 0, search: false
      });
    }
  };

  /* 셸 */
  function initControls() {
    var nav = document.getElementById('nav'), lastG = null, html = '';
    SCREENS.forEach(function (s) { if (s.group !== lastG) { html += '<li class="nav-group" aria-hidden="true">' + esc(s.group) + '</li>'; lastG = s.group; } html += '<li><button type="button" data-screen="' + s.id + '"><span class="nav-no">' + s.no + '</span><span class="nav-ko">' + esc(s.ko) + '</span><span class="nav-en">' + esc(s.en) + '</span></button></li>'; });
    nav.innerHTML = html;
    document.getElementById('sidebarFoot').innerHTML = '<dt>기준일</dt><dd>' + M.nowLabel + '</dd><dt>데이터 기간</dt><dd>' + M.startIso + ' ~ ' + M.endIso + '</dd><dt>구성</dt><dd>가상 센터 1곳 · 가상 화주사 5곳</dd><dt>수치</dt><dd>모두 가상 (시드 ' + M.seed + ')</dd>';
    document.getElementById('fInd').innerHTML = '<option value="ALL">전체 상품군</option>' + D.inds.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('');
    var fc = document.getElementById('fCh'); if (fc) fc.innerHTML = '<option value="ALL">전체 채널</option>' + D.channels.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('');
    var fFrom = document.getElementById('fFrom'), fTo = document.getElementById('fTo');
    [fFrom, fTo].forEach(function (el) { el.min = M.startIso; el.max = M.endIso; });
    syncControls();
    document.getElementById('filters').addEventListener('change', function (e) {
      var t = e.target;
      if (t.id === 'fPeriod') { state.filter.period = t.value; if (t.value === 'custom' && !state.filter.from) { state.filter.from = Cal.isoOf(END - 29); state.filter.to = M.endIso; } }
      if (t.id === 'fFrom') state.filter.from = t.value;
      if (t.id === 'fTo') state.filter.to = t.value;
      if (state.filter.from && state.filter.to && state.filter.from > state.filter.to) { var tmp = state.filter.from; state.filter.from = state.filter.to; state.filter.to = tmp; }
      if (t.id === 'fInd') state.filter.ind = t.value;
      if (t.id === 'fCh') state.filter.ch = t.value;
      resetTables(); syncControls(); render();
    });
    document.getElementById('fReset').addEventListener('click', function () { state.filter = JSON.parse(JSON.stringify(DEFAULT_FILTER)); state.local.wave = null; resetTables(); syncControls(); render(); });
    nav.addEventListener('click', function (e) { var btn = e.target.closest('[data-screen]'); if (btn) go(btn.getAttribute('data-screen')); });
    var view = document.getElementById('view');
    view.addEventListener('click', function (e) {
      var ex = e.target.closest('[data-export]'); if (ex) { var r = exportsReg[ex.getAttribute('data-export')]; if (r) X.download(r.filename, r.columns, r.rows()); return; }
      var g = e.target.closest('[data-go]'); if (g) { go(g.getAttribute('data-go')); return; }
      var si = e.target.closest('[data-set-ind]'); if (si) { state.filter.ind = si.getAttribute('data-set-ind'); resetTables(); syncControls(); render(); return; }
      var pg = e.target.closest('[data-page]'); if (pg) { var k = pg.getAttribute('data-page'); state.tables[k].page += +pg.getAttribute('data-dir'); refreshTable(k); return; }
      var ik = e.target.closest('[data-issue-kind]'); if (ik) { state.local.issueKind = ik.getAttribute('data-issue-kind'); if (state.tables.issues) state.tables.issues.page = 0; render(true); }
    });
    view.addEventListener('change', function (e) {
      if (e.target.hasAttribute('data-wave')) { state.local.wave = +e.target.value; ['pick', 'wave'].forEach(function (k) { if (state.tables[k]) state.tables[k].page = 0; }); render(true); }
      if (e.target.hasAttribute('data-pivot')) { state.local.pivot[e.target.getAttribute('data-pivot')] = e.target.value; render(true); }
    });
    view.addEventListener('input', function (e) { var k = e.target.getAttribute('data-search'); if (k) { state.tables[k].q = e.target.value; state.tables[k].page = 0; refreshTable(k); } });
    window.addEventListener('hashchange', function () { var id = location.hash.replace('#', ''); if (id && id !== state.screen && scr(id)) { state.screen = id; render(); } });
  }
  function resetTables() { Object.keys(state.tables).forEach(function (k) { state.tables[k].page = 0; }); }
  function syncControls() {
    var f = state.filter, fc = document.getElementById('fCh');
    document.getElementById('fPeriod').value = f.period; document.getElementById('fInd').value = f.ind; if (fc) fc.value = f.ch;
    document.getElementById('customRange').classList.toggle('on', f.period === 'custom');
    if (f.period === 'custom') { document.getElementById('fFrom').value = f.from; document.getElementById('fTo').value = f.to; }
  }
  function go(id) { state.screen = id; if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id); render(); window.scrollTo(0, 0); document.getElementById('view').focus({ preventScroll: true }); }
  function scopeLineHtml() { var i = document.getElementById('fInd'), c = document.getElementById('fCh'); return '필터 적용 범위 <strong>' + Cal.isoOf(F.from) + ' ~ ' + Cal.isoOf(F.to) + '</strong> (' + F.days + '일) · <strong>' + esc(i.options[i.selectedIndex].text) + '</strong>' + (c ? ' · <strong>' + esc(c.options[c.selectedIndex].text) + '</strong>' : '') + ' · <span class="scope-sample">가상 데이터</span>'; }
  function render(keep) {
    F = S.resolveFilter(state.filter);
    exportsReg = {}; tableReg = {}; hooks = [];
    CH.destroyAll();
    var sc = scr(state.screen) || SCREENS[0];
    document.querySelectorAll('#nav [data-screen]').forEach(function (bt) { if (bt.getAttribute('data-screen') === sc.id) bt.setAttribute('aria-current', 'page'); else bt.removeAttribute('aria-current'); });
    document.getElementById('pageEyebrow').textContent = sc.no + ' · ' + sc.en;
    document.getElementById('pageTitle').textContent = sc.ko;
    document.getElementById('scopeLine').innerHTML = scopeLineHtml();
    document.title = sc.ko + ' · ' + CFG.title + ' (개인 학습 프로젝트)';
    var y = window.scrollY;
    document.getElementById('view').innerHTML = RENDER[sc.id]();
    Object.keys(tableReg).forEach(updateCount);
    var h = hooks; hooks = []; h.forEach(function (fn) { fn(); });
    if (keep) window.scrollTo(0, y);
  }
  function start(cfg) {
    CFG = cfg; SCREENS = cfg.screens; RENDER = cfg.render;
    state.screen = SCREENS[0].id;
    var qi = new URLSearchParams(location.search).get('ind'); if (qi && INDI[qi]) state.filter.ind = qi;
    CH.applyDefaults();
    initControls();
    var h0 = location.hash.replace('#', '');
    if (scr(h0)) state.screen = h0;
    render();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { CH.applyDefaults(); render(true); });
    window.SCMApp = { state: state, render: render, go: go, exports: function () { return exportsReg; }, screens: SCREENS };
  }

  window.UI = { start: start, esc: esc, nm: nm, ni: ni, statusHtml: statusHtml, section: section, panel: panel, chartBox: chartBox, stat: stat, statRow: statRow, naBox: naBox, hook: hook, fileName: fileName, mmdd: mmdd, hhmm: hhmm, b: b, goBtn: goBtn, summary: summary, statusCol: statusCol, chCol: chCol, indCol: indCol, linesTxt: linesTxt, stTone: stTone, sumOf: sumOf, intAxis: intAxis, wonAxis: wonAxis, weekBuckets: weekBuckets, hbar: hbar, table: table, steps: steps, kpiCard: kpiCard, W: W, state: state, F: function () { return F; } };
})();
