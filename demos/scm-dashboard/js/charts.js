/* =====================================================================
 * js/charts.js — Chart.js 공통 스타일과 생성 도우미
 * ---------------------------------------------------------------------
 * - 색상은 css/style.css의 CSS 변수에서만 읽습니다.
 *   실적 = --chart-1, 계획·목표 = --chart-plan(회색, 점선),
 *   비교 계열 = --chart-2~4(색각 검증 통과) + 선 종류(실선·점선)
 *   (검정 단색은 장시간 보기 어려워 차트 전용 블루·바이올렛 계열을 사용)
 * - 상태 색(--ok/--warn/--risk)은 상태 표시(예: 처리량 초과 구간)에만 사용
 * - 하나의 차트에는 하나의 Y축만 사용합니다.
 * ===================================================================== */
(function (global) {
  'use strict';
  var registry = {};

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function rgba(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function palette() {
    var p = cssVar('--chart-1');
    var series = [cssVar('--chart-1'), cssVar('--chart-2'), cssVar('--chart-3'), cssVar('--chart-4')];
    return {
      primary: p,
      soft: cssVar('--chart-2'),
      plan: cssVar('--chart-plan'),
      grid: cssVar('--chart-grid'),
      accent: cssVar('--brand-accent') || p,
      text: cssVar('--text'),
      sub: cssVar('--text-sub'),
      line: cssVar('--line'),
      bgSub: cssVar('--bg-sub'),
      bg: cssVar('--bg'),
      ok: cssVar('--ok'), warn: cssVar('--warn'), risk: cssVar('--risk'),
      // 계열 색 (0번 = 실적)
      tone: function (i) { return series[i % series.length]; },
      alpha: function (a) { return rgba(p, a); },
      grey: function () { return cssVar('--chart-plan'); },
      status: function (k, a) { return rgba(cssVar({ ok: '--ok', warn: '--warn', risk: '--risk' }[k]), a === undefined ? 1 : a); }
    };
  }

  /* 기준선·구간 표시 플러그인
   * options.plugins.markers = {
   *   vlines: [{ index, label, dash }],   // x 인덱스 위치의 세로선
   *   bands:  [{ from, to, color }],      // x 인덱스 구간 음영
   *   hlines: [{ y, label }]              // y 값 가로선
   * } */
  var markersPlugin = {
    id: 'markers',
    beforeDatasetsDraw: function (chart, args, opts) {
      if (!opts || !opts.bands) return;
      var x = chart.scales.x, area = chart.chartArea, ctx = chart.ctx;
      ctx.save();
      opts.bands.forEach(function (b) {
        var half = (x.getPixelForValue(1) - x.getPixelForValue(0)) / 2 || 0;
        var x1 = x.getPixelForValue(b.from) - half, x2 = x.getPixelForValue(b.to) + half;
        ctx.fillStyle = b.color;
        ctx.fillRect(Math.max(area.left, x1), area.top, Math.min(area.right, x2) - Math.max(area.left, x1), area.bottom - area.top);
      });
      ctx.restore();
    },
    afterDatasetsDraw: function (chart, args, opts) {
      if (!opts) return;
      var P = palette(), ctx = chart.ctx, area = chart.chartArea;
      ctx.save();
      ctx.font = '600 11px ' + getComputedStyle(document.body).fontFamily;
      (opts.vlines || []).forEach(function (v, i) {
        var px = chart.scales.x.getPixelForValue(v.index);
        if (px < area.left - 1 || px > area.right + 1) return;
        ctx.strokeStyle = v.color || P.text;
        ctx.lineWidth = 1;
        ctx.setLineDash(v.dash || [4, 3]);
        ctx.beginPath(); ctx.moveTo(px, area.top); ctx.lineTo(px, area.bottom); ctx.stroke();
        if (v.label) {
          ctx.setLineDash([]);
          var w = ctx.measureText(v.label).width;
          var tx = px + 4 + w > area.right ? px - 6 - w : px + 6;
          var ty = area.top + 12 + (v.row || 0) * 16;
          ctx.fillStyle = P.bg; ctx.fillRect(tx - 3, ty - 11, w + 6, 15);   // 라벨 바탕(가독성)
          ctx.fillStyle = P.text;
          ctx.fillText(v.label, tx, ty);
        }
      });
      (opts.hlines || []).forEach(function (h) {
        var py = chart.scales.y.getPixelForValue(h.y);
        if (py < area.top || py > area.bottom) return;
        ctx.strokeStyle = h.color || P.sub;
        ctx.lineWidth = 1;
        ctx.setLineDash(h.dash || [5, 4]);
        ctx.beginPath(); ctx.moveTo(area.left, py); ctx.lineTo(area.right, py); ctx.stroke();
        if (h.label) {
          ctx.setLineDash([]);
          var hw = ctx.measureText(h.label).width;
          ctx.fillStyle = P.bg; ctx.fillRect(area.left + 1, py - 15, hw + 8, 14);   // 라벨 바탕(가독성)
          ctx.fillStyle = P.sub;
          ctx.fillText(h.label, area.left + 5, py - 4);   // 왼쪽에 표기해 세로선 라벨과 겹치지 않게
        }
      });
      ctx.restore();
    }
  };

  function applyDefaults() {
    if (!global.Chart) return;
    var P = palette();
    var C = global.Chart;
    C.register(markersPlugin);
    C.defaults.font.family = getComputedStyle(document.body).fontFamily;
    C.defaults.font.size = 12.5;
    C.defaults.color = P.sub;
    C.defaults.borderColor = P.line;
    C.defaults.animation.duration = 250;
    C.defaults.maintainAspectRatio = false;
    C.defaults.responsive = true;
    C.defaults.plugins.legend.position = 'top';
    C.defaults.plugins.legend.align = 'start';
    C.defaults.plugins.legend.labels.boxWidth = 10;
    C.defaults.plugins.legend.labels.boxHeight = 10;
    C.defaults.plugins.legend.labels.padding = 14;
    C.defaults.plugins.legend.labels.color = P.text;
    C.defaults.plugins.legend.labels.font = { size: 12.5, weight: '600' };
    C.defaults.plugins.tooltip.backgroundColor = P.text;
    C.defaults.plugins.tooltip.titleColor = P.bg;
    C.defaults.plugins.tooltip.bodyColor = P.bg;
    C.defaults.plugins.tooltip.cornerRadius = 2;
    C.defaults.plugins.tooltip.padding = 10;
    C.defaults.plugins.tooltip.boxPadding = 4;
    C.defaults.plugins.tooltip.titleFont = { weight: '700' };
    C.defaults.elements.bar.borderRadius = 2;
    C.defaults.elements.bar.borderSkipped = false;
    C.defaults.elements.line.borderWidth = 2.5;
    C.defaults.elements.line.tension = 0;
    C.defaults.elements.point.radius = 0;
    C.defaults.elements.point.hoverRadius = 4;
    C.defaults.elements.point.hitRadius = 8;
  }

  function baseScales(opts) {
    var P = palette();
    opts = opts || {};
    return {
      x: {
        stacked: !!opts.stacked,
        grid: { display: false },
        border: { color: P.line },
        ticks: { color: P.sub, maxRotation: 0, autoSkip: true, autoSkipPadding: 12 }
      },
      y: {
        stacked: !!opts.stacked,
        beginAtZero: opts.beginAtZero !== false,
        min: opts.yMin, max: opts.yMax,
        grid: { color: P.grid, drawTicks: false },
        border: { display: false },
        ticks: { color: P.sub, padding: 8, callback: opts.yFmt || undefined, maxTicksLimit: 6 },
        title: opts.yTitle ? { display: true, text: opts.yTitle, color: P.sub, font: { size: 11 } } : undefined
      }
    };
  }

  function render(id, config) {
    var el = document.getElementById(id);
    if (!el || !global.Chart) return null;
    if (registry[id]) { registry[id].destroy(); delete registry[id]; }
    registry[id] = new global.Chart(el.getContext('2d'), config);
    return registry[id];
  }
  function destroyAll() {
    Object.keys(registry).forEach(function (k) { registry[k].destroy(); delete registry[k]; });
  }

  global.SCMCharts = {
    palette: palette, rgba: rgba, applyDefaults: applyDefaults, baseScales: baseScales,
    render: render, destroyAll: destroyAll, registry: registry
  };
})(window);
