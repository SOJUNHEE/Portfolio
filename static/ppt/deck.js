/* 슬라이드 그리기 + 보기 화면(휴대폰·PC) + 내보내기 화면.
 * 내용은 slides.js(window.DECK) 하나에서만 읽는다. 16:9는 'wide', 휴대폰 4:5는 'tall' 배치만 다르다.
 * 보기 화면 순서: 종합 소개(#intro) → 상세 20장(#1~#20).  내보내기: set=full(20장) | set=core(10장 핵심본). */
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
  function lines(text, layout) { return layout === 'tall' ? String(text).split('\n').join(' ') : text; }
  function titleFor(s, layout) { return lines(s.title, layout); }
  // 프로젝트 p의 첫 장(한 줄 요약) 위치 (0부터)
  function firstOf(p) { for (var i = 0; i < N; i++) if (D.slides[i].p === p) return i; return 0; }
  function find(p, type) { for (var i = 0; i < N; i++) if (D.slides[i].p === p && D.slides[i].type === type) return i; return -1; }

  function figure(img, opts) {
    var f = el('figure', 's-fig' + (opts && opts.compact ? ' compact' : '') + (img.fit === 'contain' ? ' contain' : ''));
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
  function profileBlock() {
    var pr = el('div', 's-profile');
    add(pr, el('strong', null, D.profile.name), el('span', null, D.profile.role), el('span', null, D.profile.career));
    return pr;
  }

  var BODY = {
    intro: function (s, layout, ctx) {
      var I = D.intro;
      var facts = el('dl', 's-facts');
      I.facts.forEach(function (f) { add(facts, add(el('div'), el('dt', null, f[0]), el('dd', null, f[1]))); });
      var cards = el('ol', 's-cards');
      D.projects.forEach(function (pj) {
        var c = el(ctx.interactive ? 'button' : 'div', 's-card');
        if (ctx.interactive) {
          c.type = 'button';
          c.setAttribute('data-jump', pj.no);
          c.setAttribute('aria-label', 'PROJECT ' + pj.no + ' ' + pj.name + ' 보기');
        }
        add(c, add(el('span', 's-card-meta'), el('span', 's-card-no', 'PROJECT ' + pj.no), el('span', 's-card-kind', pj.kind)), el('strong', 's-card-name', pj.name), el('span', 's-card-short', pj.short));
        if (ctx.interactive) c.appendChild(el('span', 's-card-go', '보기 →'));
        cards.appendChild(add(el('li'), c));
      });
      return add(el('div', 's-body'), profileBlock(), el('h2', 's-title', lines(I.title, layout)), facts, el('p', 's-intro-lead', I.lead), cards);
    },
    summary: function (s, layout) {
      var left = el('div', 's-lead');
      if (s.profile) left.appendChild(profileBlock());
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
      var uses = !!s.trialLabels;   // 시도·막힘·바꾼 방법 대신 '실제로 쓴 곳'을 보여 주는 장
      var trial = el('ol', 's-trial' + (uses ? ' uses' : ''));
      (s.trialLabels || ['시도', '막힘', '바꾼 방법']).forEach(function (label, i) {
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
    result: function (s, layout) {
      var stats = el('ul', 's-stats n' + s.stats.length);
      s.stats.forEach(function (st) {
        var li = el('li');
        var v = el('p', 's-stat-v' + (st[0].length > 7 ? ' long' : ''), st[0]);
        add(li, v, add(el('div', 's-stat-t'), el('p', 's-stat-l', st[1]), st[2] ? el('p', 's-stat-c', st[2]) : null));
        stats.appendChild(li);
      });
      var ba = el('div', 's-ba');
      add(ba, add(el('div', 's-before'), el('span', 's-chip', '전'), el('p', null, s.before)), el('span', 's-arrow', '→'), add(el('div', 's-after'), el('span', 's-chip', '후'), el('p', null, s.after)));
      var more = el('dl', 's-more');
      add(more, el('dt', null, '배운 점'), el('dd', null, s.learned), el('dt', null, '다음 개선'), el('dd', null, s.next));
      return add(el('div', 's-body'), stats, ba, more, s.note ? el('p', 's-note', s.note) : null);
    }
  };

  /* item: { kind: 'intro' } 또는 { kind: 'slide', i }.  no: 꼬리말 번호 문자열 */
  function render(item, layout, no, interactive) {
    var s = item.kind === 'intro' ? { type: 'intro', part: '종합 소개' } : D.slides[item.i];
    var pj = s.p ? project(s.p) : null;
    var a = el('article', 'slide ' + layout + ' t-' + s.type + (s.contact ? ' is-last' : ''));
    a.setAttribute('data-n', item.kind === 'intro' ? 0 : item.i + 1);
    a.setAttribute('aria-label', no + ' · ' + (pj ? pj.name + ' · ' : '') + s.part);
    var top = el('header', 's-top');
    add(top, el('span', 's-proj', pj ? 'PROJECT ' + pj.no + ' · ' + pj.name : '소준희 포트폴리오 · 프로젝트 4개'), el('span', 's-part', s.part));
    a.appendChild(top);
    if (s.type !== 'summary' && s.type !== 'intro') a.appendChild(el('h2', 's-title', titleFor(s, layout)));
    a.appendChild(BODY[s.type](s, layout, { interactive: !!interactive }));
    var foot = el('footer', 's-foot' + (s.contact ? ' closing' : ''));
    if (s.contact) {   // 마지막 장: 꼬리말 자리에 가치 문장 + 실제 연락처만
      add(foot, el('p', 's-closing-v', lines(D.closing, layout)), el('p', 's-closing-c', D.contact), el('span', 's-no', no));
    } else {
      var dots = el('span', 's-dots');
      D.projects.forEach(function (p) { dots.appendChild(el('i', s.p && p.no === s.p ? 'on' : '')); });
      add(foot, el('span', null, D.owner + ' · 포트폴리오'), dots, el('span', 's-no', no));
    }
    a.appendChild(foot);
    var frame = el('div', 'sf ' + layout);   // 글자 크기(cqw)의 기준이 되는 틀 = 슬라이드 폭
    frame.appendChild(a);
    var wrap = el('div', 'sf-item');          // 보기 화면에서 한 장씩 넘기는 칸
    wrap.appendChild(frame);
    return wrap;
  }

  // 10장 핵심본 구성: [['intro'], [p, type], ...] → item 목록
  function coreItems() {
    return D.core.map(function (c) { return c[0] === 'intro' ? { kind: 'intro' } : { kind: 'slide', i: find(c[0], c[1]) }; });
  }
  function fullItems() { var a = []; for (var k = 0; k < N; k++) a.push({ kind: 'slide', i: k }); return a; }

  window.DeckRender = { render: render, count: N, coreItems: coreItems, fullItems: fullItems };

  /* ---------------- 내보내기 화면 (export.html?layout=wide|tall&set=full|core) ---------------- */
  var exp = document.getElementById('export');
  if (exp) {
    var q = new URLSearchParams(location.search), layout = q.get('layout') === 'tall' ? 'tall' : 'wide';
    var set = q.get('set') === 'core' ? coreItems() : fullItems();
    document.documentElement.className = 'export-' + layout + ' set-' + (q.get('set') === 'core' ? 'core' : 'full');
    set.forEach(function (it, k) { exp.appendChild(render(it, layout, (k + 1) + ' / ' + set.length, false)); });
    window.DECK_EXPORT = set.map(function (it) { return it.kind === 'intro' ? (D.intro.notes || '') : (D.slides[it.i].notes || ''); });
    return;
  }

  /* ---------------- 보기 화면 (index.html) ---------------- */
  var track = document.getElementById('track');
  if (!track) return;
  var counter = document.getElementById('counter'), projName = document.getElementById('proj-name');
  var prev = document.getElementById('prev'), next = document.getElementById('next');
  var chips = document.getElementById('chips');
  var dlg = document.getElementById('zoom'), dlgImg = document.getElementById('zoom-img'), dlgCap = document.getElementById('zoom-cap');
  var zoomNext = document.getElementById('zoom-next');
  var ITEMS = [{ kind: 'intro' }].concat(fullItems()), M = ITEMS.length;   // 0 = 종합 소개, 1~20 = 상세
  var current = 0, layoutNow = null;
  var mq = window.matchMedia('(max-width: 820px) and (orientation: portrait)');

  // 프로젝트 바로가기 칩: 소개 + 프로젝트 4개
  function chip(text, pos, p) {
    var b = el('button', 'v-chip', text);
    b.type = 'button';
    b.setAttribute('data-go', pos);
    if (p) b.setAttribute('data-p', p);
    return b;
  }
  chips.appendChild(chip('소개', 0, 0));
  D.projects.forEach(function (pj) { chips.appendChild(chip(pj.no + ' ' + pj.tag, firstOf(pj.no) + 1, pj.no)); });

  function hashFor(pos) { return pos === 0 ? '#intro' : '#' + pos; }
  function parseHash() {
    var h = (location.hash || '').slice(1);
    if (!h || h === 'intro') return 0;
    var n = parseInt(h, 10);
    return n >= 1 && n <= N ? n : 0;
  }
  function build() {
    var layout = mq.matches ? 'tall' : 'wide';
    if (layout === layoutNow) return;
    layoutNow = layout;
    document.documentElement.setAttribute('data-layout', layout);
    track.textContent = '';
    ITEMS.forEach(function (it, k) { track.appendChild(render(it, layout, k === 0 ? '소개' : k + ' / ' + N, true)); });
    go(current, false, false);
  }
  function label(pos) {
    var it = ITEMS[pos], s = it.kind === 'slide' ? D.slides[it.i] : null;
    counter.textContent = pos === 0 ? '소개' : pos + ' / ' + N;
    projName.textContent = s ? 'PROJECT ' + s.p + ' · ' + project(s.p).name + ' · ' + s.part : '종합 소개 · 프로젝트 4개 바로가기';
    prev.disabled = pos === 0;
    next.disabled = pos === M - 1;
    zoomNext.disabled = pos === M - 1;
    var p = s ? s.p : 0;
    Array.prototype.forEach.call(chips.children, function (c) {
      if (+c.getAttribute('data-p') === p) c.setAttribute('aria-current', 'true'); else c.removeAttribute('aria-current');
    });
    var on = chips.querySelector('[aria-current]');
    if (on && chips.scrollWidth > chips.clientWidth) chips.scrollLeft = on.offsetLeft - chips.offsetLeft - 16;
  }
  // 긴 장을 아래로 읽다가 넘기면, 새 장의 맨 위(핵심 문장)부터 보이게
  function toTop(smooth) {
    var top = track.getBoundingClientRect().top;
    if (top < 0) window.scrollTo({ top: window.scrollY + top - 8, behavior: smooth ? 'smooth' : 'auto' });
  }
  function setHash(push) {
    var h = hashFor(current);
    if (location.hash === h) return;
    if (push && history.pushState) history.pushState(null, '', h);
    else if (history.replaceState) history.replaceState(null, '', h);
  }
  function go(pos, smooth, push) {
    current = Math.max(0, Math.min(M - 1, pos));
    var target = track.children[current];
    if (target) track.scrollTo({ left: target.offsetLeft - track.offsetLeft, behavior: smooth ? 'smooth' : 'auto' });
    label(current);
    setHash(push);
  }
  var timer = null;
  track.addEventListener('scroll', function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      var w = track.clientWidth, i = Math.round(track.scrollLeft / (w || 1));
      if (i !== current) { current = Math.max(0, Math.min(M - 1, i)); label(current); setHash(false); toTop(false); }
    }, 80);
  }, { passive: true });
  prev.addEventListener('click', function () { go(current - 1, true, false); toTop(false); });
  next.addEventListener('click', function () { go(current + 1, true, false); toTop(false); });
  // 바로가기는 방문 기록을 남겨, 휴대폰 '뒤로' 버튼으로 직전 장에 돌아올 수 있게
  chips.addEventListener('click', function (e) {
    var b = e.target.closest('[data-go]');
    if (b) { go(+b.getAttribute('data-go'), true, true); toTop(false); }
  });
  document.addEventListener('keydown', function (e) {
    if (dlg.open) return;
    if (e.target.closest && e.target.closest('summary, a, input')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(current + 1, true, false); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(current - 1, true, false); }
    if (e.key === 'Home' && e.target === track) { e.preventDefault(); go(0, true, false); }
  });
  var lastFocus = null;
  function openZoom(b) {
    lastFocus = b;
    dlgImg.src = b.getAttribute('data-zoom');
    dlgImg.alt = b.getAttribute('data-caption');
    dlgCap.textContent = b.getAttribute('data-caption');
    document.documentElement.classList.add('zoom-open');   // 뒤 화면이 같이 스크롤되지 않게
    dlg.showModal();
    document.getElementById('zoom-close').focus();
  }
  track.addEventListener('click', function (e) {
    var j = e.target.closest('[data-jump]');
    if (j) { go(firstOf(+j.getAttribute('data-jump')) + 1, true, true); toTop(false); return; }
    var b = e.target.closest('[data-zoom]');
    if (b) openZoom(b);
  });
  dlg.addEventListener('close', function () {
    document.documentElement.classList.remove('zoom-open');
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  });
  document.getElementById('zoom-close').addEventListener('click', function () { dlg.close(); });
  zoomNext.addEventListener('click', function () { lastFocus = null; dlg.close(); go(current + 1, true, false); toTop(false); next.focus({ preventScroll: true }); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });

  current = parseHash();
  build();
  function fromHistory() { var n = parseHash(); if (n !== current) { if (dlg.open) dlg.close(); go(n, false, false); toTop(false); } }
  window.addEventListener('popstate', fromHistory);
  window.addEventListener('hashchange', fromHistory);
  if (mq.addEventListener) mq.addEventListener('change', build); else mq.addListener(build);
  window.addEventListener('resize', function () { clearTimeout(timer); timer = setTimeout(function () { go(current, false, false); }, 120); });
})();
