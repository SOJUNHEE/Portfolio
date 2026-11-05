/* 슬라이드 그리기 + 보기 화면(휴대폰·PC) + 내보내기 화면.
 * 내용은 slides.js(window.DECK) 하나에서만 읽는다. 16:9는 'wide', 휴대폰 4:5는 'tall' 배치만 다르다. */
(function () {
  'use strict';
  var D = window.DECK, N = D.slides.length;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) setText(e, text);
    return e;
  }
  function setText(e, text) {   // \n 은 줄바꿈 (HTML로 해석하지 않음)
    String(text).split('\n').forEach(function (line, i) {
      if (i) e.appendChild(document.createElement('br'));
      e.appendChild(document.createTextNode(line));
    });
  }
  function add(parent) { for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
  function list(items, cls) { var ul = el('ul', cls); items.forEach(function (t) { ul.appendChild(el('li', null, t)); }); return ul; }
  function project(p) { return D.projects[p - 1]; }
  // 16:9는 원본 줄바꿈을 지키고, 휴대폰(4:5)은 좁은 폭에 맞게 자연스럽게 줄바꿈한다
  function titleFor(s, layout) { return layout === 'tall' ? s.title.split('\n').join(' ') : s.title; }

  function figure(img, opts) {
    var f = el('figure', 's-fig' + (opts && opts.compact ? ' compact' : ''));
    var b = el('button', 's-zoom');
    b.type = 'button';
    b.setAttribute('data-zoom', img.src);
    b.setAttribute('data-caption', img.caption);
    b.setAttribute('aria-label', img.caption + ' — 크게 보기');
    var i = el('img');
    i.src = img.src; i.alt = img.caption; i.loading = 'eager'; i.decoding = 'async';
    b.appendChild(i);
    if (opts && opts.compact) b.appendChild(el('span', 's-zoom-hint', '화면 크게 보기'));
    return add(f, b, el('figcaption', null, img.caption));
  }

  var BODY = {
    summary: function (s, layout) {
      var left = el('div', 's-lead');
      if (s.profile) {
        var pr = el('div', 's-profile');
        add(pr, el('strong', null, D.profile.name), el('span', null, D.profile.role), el('span', null, D.profile.career));
        left.appendChild(pr);
      }
      add(left, el('p', 's-kicker', s.kicker), el('h2', 's-title', titleFor(s, layout)));
      var dl = el('dl', 's-meta');
      s.meta.forEach(function (m) { add(dl, el('dt', null, m[0]), el('dd', null, m[1])); });
      var note = el('p', 's-note', s.note);
      var body = el('div', 's-body');
      if (layout === 'tall') add(body, left, figure(s.image), dl, note);
      else { add(left, dl, note); add(body, left, figure(s.image)); }
      return body;
    },
    problem: function (s) {
      var big = el('div', 's-big');
      add(big, el('p', 's-big-v', s.big.value), el('p', 's-big-l', s.big.label));
      var side = el('div', 's-side');
      add(side, el('p', 's-side-h', s.side.head), el('p', 's-side-b', s.side.body));
      var flow = el('ol', 's-flow');
      s.items.forEach(function (it, i) {
        var li = el('li');
        add(li, el('span', 's-num', String(i + 1)), add(el('div'), el('p', 's-flow-h', it[0]), el('p', 's-flow-b', it[1])));
        flow.appendChild(li);
      });
      return add(el('div', 's-body'), add(el('div', 's-col'), big, side), flow);
    },
    sources: function (s) {
      var src = el('ul', 's-sources');
      s.sources.forEach(function (t) { src.appendChild(el('li', null, t)); });
      var panel = el('div', 's-areas');
      var tiles = el('ul');
      s.areas.forEach(function (t) { tiles.appendChild(el('li', null, t)); });
      add(panel, el('p', 's-areas-h', s.areasHead), tiles, el('p', 's-areas-s', s.areasSub));
      var diagram = add(el('div', 's-diagram'), src, el('span', 's-arrow', '→'), panel);
      var band = el('p', 's-band');
      add(band, el('strong', null, s.big.value), document.createTextNode(s.big.label));
      return add(el('div', 's-body'), diagram, band);
    },
    process: function (s, layout) {
      var steps = el('ol', 's-steps');
      s.steps.forEach(function (st, i) {
        var li = el('li');
        add(li, el('span', 's-num', String(i + 1)), el('p', 's-step-h', st[0]), el('p', 's-step-b', st[1]));
        steps.appendChild(li);
      });
      var trial = el('ol', 's-trial');
      ['시도', '막힘', '바꾼 방법'].forEach(function (label, i) {
        var li = el('li', 'tr-' + i);
        add(li, el('span', 's-chip', label), el('p', null, s.trial[i]));
        trial.appendChild(li);
      });
      return add(el('div', 's-body'), steps, add(el('div', 's-lower'), trial, s.image ? figure(s.image, { compact: layout === 'tall' }) : null));
    },
    ai: function (s) {
      function col(c, cls, chip) { return add(el('div', 's-role ' + cls), el('span', 's-chip', chip), el('p', 's-role-h', c.head), list(c.items)); }
      var third = el('div', 's-role third');
      add(third, el('p', 's-role-h', s.third.head));
      if (s.third.quotes) third.appendChild(list(s.third.quotes, 'quotes'));
      if (s.third.items) third.appendChild(list(s.third.items));
      if (s.third.quote) add(third, el('p', 's-quote', s.third.quote), el('p', 's-answer', s.third.answer));
      var roles = add(el('div', 's-roles'), col(s.ai, 'ai', 'AI'), el('span', 's-arrow', '→'), col(s.me, 'me', '판단·검증'), third);
      var bottom = el('div', 's-check' + (s.terminal ? '' : ' plain'));
      if (s.terminal) {
        var term = el('div', 's-term');
        add(term, el('code', 's-cmd', s.terminal.cmd), el('code', 's-out', s.terminal.out));
        bottom.appendChild(term);
      }
      add(bottom, add(el('p', 's-verify'), el('span', 's-chip', '검증'), document.createTextNode(s.verify)));
      return add(el('div', 's-body'), roles, bottom);
    },
    result: function (s) {
      var stats = el('ul', 's-stats');
      s.stats.forEach(function (st) {
        var li = el('li');
        var v = el('p', 's-stat-v' + (st[0].length > 7 ? ' long' : ''), st[0]);
        add(li, v, el('p', 's-stat-l', st[1]));
        stats.appendChild(li);
      });
      var ba = el('div', 's-ba');
      add(ba, add(el('div', 's-before'), el('span', 's-chip', '전'), el('p', null, s.before)), el('span', 's-arrow', '→'), add(el('div', 's-after'), el('span', 's-chip', '후'), el('p', null, s.after)));
      var more = el('dl', 's-more');
      add(more, el('dt', null, '배운 점'), el('dd', null, s.learned), el('dt', null, '다음 개선'), el('dd', null, s.next));
      if (s.contact) add(more, el('dt', null, '연락처'), el('dd', null, D.contact));
      return add(el('div', 's-body'), stats, ba, more, s.note ? el('p', 's-note', s.note) : null);
    }
  };

  function slide(i, layout) {
    var s = D.slides[i], pj = project(s.p);
    var a = el('article', 'slide ' + layout + ' t-' + s.type);
    a.setAttribute('data-n', i + 1);
    a.setAttribute('aria-label', (i + 1) + ' / ' + N + ' · ' + pj.name + ' · ' + s.part);
    var top = el('header', 's-top');
    add(top, el('span', 's-proj', 'PROJECT ' + pj.no + ' · ' + pj.name), el('span', 's-part', s.part));
    a.appendChild(top);
    if (s.type !== 'summary') a.appendChild(el('h2', 's-title', titleFor(s, layout)));
    a.appendChild(BODY[s.type](s, layout));
    var foot = el('footer', 's-foot');
    var dots = el('span', 's-dots');
    D.projects.forEach(function (p) { dots.appendChild(el('i', p.no === s.p ? 'on' : '')); });
    add(foot, el('span', null, D.owner + ' · 포트폴리오'), dots, el('span', 's-no', (i + 1) + ' / ' + N));
    a.appendChild(foot);
    var frame = el('div', 'sf ' + layout);   // 글자 크기(cqw)의 기준이 되는 틀 = 슬라이드 폭
    frame.appendChild(a);
    var item = el('div', 'sf-item');         // 보기 화면에서 한 장씩 넘기는 칸
    item.appendChild(frame);
    return item;
  }

  window.DeckRender = { slide: slide, count: N };

  /* ---------------- 내보내기 화면 (export.html?layout=wide|tall) ---------------- */
  var exp = document.getElementById('export');
  if (exp) {
    var q = new URLSearchParams(location.search), layout = q.get('layout') === 'tall' ? 'tall' : 'wide';
    document.documentElement.className = 'export-' + layout;
    for (var k = 0; k < N; k++) exp.appendChild(slide(k, layout));
    return;
  }

  /* ---------------- 보기 화면 (index.html) ---------------- */
  var track = document.getElementById('track');
  if (!track) return;
  var counter = document.getElementById('counter'), projName = document.getElementById('proj-name');
  var prev = document.getElementById('prev'), next = document.getElementById('next');
  var dlg = document.getElementById('zoom'), dlgImg = document.getElementById('zoom-img'), dlgCap = document.getElementById('zoom-cap');
  var current = 0, layoutNow = null;
  var mq = window.matchMedia('(max-width: 820px) and (orientation: portrait)');

  function build() {
    var layout = mq.matches ? 'tall' : 'wide';
    if (layout === layoutNow) return;
    layoutNow = layout;
    document.documentElement.setAttribute('data-layout', layout);
    track.textContent = '';
    for (var k = 0; k < N; k++) track.appendChild(slide(k, layout));
    go(current, false);
  }
  function label(i) {
    var s = D.slides[i];
    counter.textContent = (i + 1) + ' / ' + N;
    projName.textContent = 'PROJECT ' + s.p + ' · ' + project(s.p).name + ' · ' + s.part;
    prev.disabled = i === 0;
    next.disabled = i === N - 1;
  }
  function go(i, smooth) {
    current = Math.max(0, Math.min(N - 1, i));
    var target = track.children[current];
    if (target) track.scrollTo({ left: target.offsetLeft - track.offsetLeft, behavior: smooth ? 'smooth' : 'auto' });
    label(current);
    if (history.replaceState) history.replaceState(null, '', '#' + (current + 1));
  }
  var timer = null;
  track.addEventListener('scroll', function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      var w = track.clientWidth, i = Math.round(track.scrollLeft / (w || 1));
      if (i !== current) { current = Math.max(0, Math.min(N - 1, i)); label(current); if (history.replaceState) history.replaceState(null, '', '#' + (current + 1)); }
    }, 80);
  }, { passive: true });
  prev.addEventListener('click', function () { go(current - 1, true); });
  next.addEventListener('click', function () { go(current + 1, true); });
  document.addEventListener('keydown', function (e) {
    if (dlg.open) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(current + 1, true); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(current - 1, true); }
  });
  track.addEventListener('click', function (e) {
    var b = e.target.closest('[data-zoom]');
    if (!b) return;
    dlgImg.src = b.getAttribute('data-zoom');
    dlgImg.alt = b.getAttribute('data-caption');
    dlgCap.textContent = b.getAttribute('data-caption');
    dlg.showModal();
  });
  document.getElementById('zoom-close').addEventListener('click', function () { dlg.close(); });
  document.getElementById('zoom-next').addEventListener('click', function () { dlg.close(); go(current + 1, true); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });

  var start = parseInt((location.hash || '').slice(1), 10);
  if (start >= 1 && start <= N) current = start - 1;
  build();
  window.addEventListener('hashchange', function () { var n = parseInt(location.hash.slice(1), 10); if (n >= 1 && n <= N && n - 1 !== current) go(n - 1, false); });
  if (mq.addEventListener) mq.addEventListener('change', build); else mq.addListener(build);
  window.addEventListener('resize', function () { clearTimeout(timer); timer = setTimeout(function () { go(current, false); }, 120); });
})();
