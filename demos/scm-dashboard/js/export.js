/* =====================================================================
 * js/export.js — 숫자 서식 + CSV 내보내기 ("엑셀로 내보내기")
 * ---------------------------------------------------------------------
 * - 화면 표와 CSV는 같은 열 정의와 같은 서식 함수를 사용합니다.
 *   (숫자는 화면에서 천 단위 구분 기호만 추가하고, CSV에는 같은 값을 구분 기호 없이 기록)
 * - CSV는 UTF-8 BOM(﻿)을 붙여 엑셀에서 한글이 깨지지 않게 합니다.
 * - 현재 필터가 적용된 행 전체를 내보냅니다(화면 표가 일부만 보여줄 때도 전체).
 * ===================================================================== */
(function (global) {
  'use strict';
  var D = global.SCM_DATA;
  var C = D.cal;

  /* ---------------- 서식 ---------------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  var F = {
    int: function (v) { return v === null || v === undefined || isNaN(v) ? '—' : Math.round(v).toLocaleString('ko-KR'); },
    intRaw: function (v) { return v === null || v === undefined || isNaN(v) ? '' : String(Math.round(v)); },
    num1: function (v) { return v === null || v === undefined || isNaN(v) ? '—' : (Math.round(v * 10) / 10).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); },
    num1Raw: function (v) { return v === null || v === undefined || isNaN(v) ? '' : (Math.round(v * 10) / 10).toFixed(1); },
    pct: function (v, d) { if (v === null || v === undefined || isNaN(v)) return '—'; d = d === undefined ? 1 : d; return (v * 100).toFixed(d) + '%'; },
    pct2: function (v) { return F.pct(v, 2); },
    pp: function (v, d) { if (v === null || v === undefined || isNaN(v)) return '—'; d = d === undefined ? 1 : d; var x = v * 100; return (x > 0 ? '+' : x < 0 ? '−' : '±') + Math.abs(x).toFixed(d) + '%p'; },
    signed: function (v) { if (v === null || v === undefined || isNaN(v)) return '—'; var r = Math.round(v); return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toLocaleString('ko-KR'); },
    signedRaw: function (v) { return v === null || v === undefined || isNaN(v) ? '' : String(Math.round(v)); },
    won: function (v) { return v === null || v === undefined || isNaN(v) ? '—' : Math.round(v).toLocaleString('ko-KR') + '원'; },
    wonShort: function (v) {
      if (v === null || v === undefined || isNaN(v)) return '—';
      var a = Math.abs(v), s = v < 0 ? '−' : '';
      if (a >= 1e8) return s + (a / 1e8).toFixed(2) + '억원';
      if (a >= 1e4) return s + Math.round(a / 1e4).toLocaleString('ko-KR') + '만원';
      return s + Math.round(a).toLocaleString('ko-KR') + '원';
    },
    date: function (d) { return d === null || d === undefined ? '—' : C.isoOf(d); },
    dateShort: function (d) { if (d === null || d === undefined) return '—'; var s = C.isoOf(d); return s.slice(5).replace('-', '/') + '(' + C.DOW_KO[C.dowOf(d)] + ')'; },
    datetime: function (t) {
      if (t === null || t === undefined) return '—';
      var d = Math.floor(t / 1440), m = t % 1440;
      return C.isoOf(d) + ' ' + pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
    },
    hours: function (v) { return v === null || v === undefined || isNaN(v) ? '—' : (Math.round(v * 10) / 10).toFixed(1) + '시간'; },
    statusLabel: function (s) { return { ok: '정상', warn: '주의', risk: '위험' }[s] || '—' ; },
    month: function (m) { return m ? m.replace('-', '.') : '—'; }
  };

  /* 열 정의: { label, value(row), type, align }
   *  type: text | int | num1 | pct | pct2 | won | signed | date | datetime | hours | status
   *  화면 문자열 = display(col,row), CSV 문자열 = csv(col,row) */
  function display(col, row) {
    var v = col.value(row);
    switch (col.type) {
      case 'int': return F.int(v);
      case 'num1': return F.num1(v);
      case 'pct': return F.pct(v);
      case 'pct2': return F.pct2(v);
      case 'won': return F.int(v);
      case 'signed': return F.signed(v);
      case 'date': return F.date(v);
      case 'datetime': return F.datetime(v);
      case 'hours': return F.num1(v);
      case 'status': return F.statusLabel(v);
      default: return v === null || v === undefined || v === '' ? '—' : String(v);
    }
  }
  function csv(col, row) {
    var v = col.value(row);
    switch (col.type) {
      case 'int': case 'won': return F.intRaw(v);
      case 'signed': return F.signedRaw(v);
      case 'num1': case 'hours': return F.num1Raw(v);
      case 'pct': case 'pct2': case 'date': case 'datetime': case 'status': return display(col, row) === '—' ? '' : display(col, row);
      default: return v === null || v === undefined ? '' : String(v);
    }
  }
  function esc(s) {
    s = String(s);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCSV(columns, rows) {
    var lines = [columns.map(function (c) { return esc(c.csvLabel || c.label); }).join(',')];
    rows.forEach(function (r) { lines.push(columns.map(function (c) { return esc(csv(c, r)); }).join(',')); });
    return '﻿' + lines.join('\r\n');
  }
  function download(filename, columns, rows) {
    var blob = new Blob([toCSV(columns, rows)], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  global.SCMExport = { fmt: F, display: display, csv: csv, toCSV: toCSV, download: download };
})(typeof window !== 'undefined' ? window : globalThis);
