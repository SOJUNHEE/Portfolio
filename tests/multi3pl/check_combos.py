"""다품종 3PL 운영 대시보드 (/demo/scm-dashboard/) — 화면 조합 점검 (Playwright)
사용법: python tests/multi3pl/check_combos.py http://127.0.0.1:5000/demo/scm-dashboard/

화면 10개 × 상품군 6가지(전체 + 5개) × 화면 폭 2가지(1440px·390px) = 120개 조합을 하나씩 열어
  - 가로 넘침(문서 폭 > 화면 폭)
  - 차트 누락(보이는 canvas에 Chart.js 차트가 없거나 크기가 0)
  - 콘솔 오류·페이지 오류
  - 필터 적용 확인(필터 범위 문구에 선택한 상품군 이름이 나오는지)
를 확인한다. 결과는 조합 수와 실패 목록(JSON)으로 출력하고, 실패가 있으면 종료 코드 1.
(포트폴리오의 '120개 화면 조합 오류 0건'을 다시 확인할 수 있게 만든 스크립트. 2026-11-10 작성)
"""
import json
import sys

from playwright.sync_api import sync_playwright

base = sys.argv[1].rstrip('/') + '/'
WIDTHS = ((1440, 900), (390, 844))
results, fails = [], []

with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h in WIDTHS:
        pg = b.new_page(viewport={'width': w, 'height': h})
        errs = []
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)[:160]))
        pg.on('console', lambda m: errs.append('console: ' + m.text[:160]) if m.type == 'error' else None)
        pg.goto(base, wait_until='networkidle')
        # 메뉴·필터가 그려질 때까지 기다린다(그려지기 전에 읽으면 조합 0개로 '통과'처럼 보이는 문제 방지)
        pg.wait_for_function("document.querySelectorAll('#nav [data-screen]').length >= 10 && document.querySelectorAll('#fInd option').length >= 6", timeout=15000)
        pg.wait_for_timeout(500)
        screens = pg.evaluate("[...document.querySelectorAll('#nav [data-screen]')].map(e => e.dataset.screen)")
        inds = pg.evaluate("[...document.querySelectorAll('#fInd option')].map(o => [o.value, o.textContent.trim()])")
        if len(screens) != 10 or len(inds) != 6:
            fails.append({'width': w, 'problems': [f'화면 {len(screens)}개·상품군 {len(inds)}개를 읽음(기대 10·6)']})
        for ind, ind_name in inds:
            pg.evaluate("v => { const s = document.getElementById('fInd'); s.value = v; s.dispatchEvent(new Event('change', {bubbles: true})); }", ind)
            pg.wait_for_timeout(300)
            for sid in screens:
                errs.clear()
                pg.evaluate("id => { location.hash = id; }", sid)
                pg.wait_for_timeout(450)
                r = pg.evaluate("""() => {
                  const view = document.getElementById('view') || document.body;
                  const canvases = [...view.querySelectorAll('canvas')].filter(c => c.offsetParent !== null);
                  const missing = canvases.filter(c => !(window.Chart && Chart.getChart(c)) || !c.clientWidth || !c.clientHeight).length;
                  const scope = (document.body.innerText.match(/필터 적용 범위[^\\n]*/) || [''])[0];
                  return {overflow: document.documentElement.scrollWidth > innerWidth + 1, charts: canvases.length, missing, scope,
                          hash: location.hash};
                }""")
                problems = []
                if r['overflow']: problems.append('가로 넘침')
                if r['missing']: problems.append(f"차트 누락 {r['missing']}/{r['charts']}")
                if errs: problems.append('; '.join(errs[:3]))
                if r['hash'] != '#' + sid: problems.append('화면 이동 실패 ' + r['hash'])
                if r['scope'] and ind_name not in r['scope']: problems.append('필터 미적용: ' + r['scope'][:60])
                combo = {'width': w, 'ind': ind, 'screen': sid, 'charts': r['charts'], 'problems': problems}
                results.append(combo)
                if problems:
                    fails.append(combo)
        pg.close()
    b.close()

summary = {'combos': len(results), 'by_width': {str(w): sum(1 for r in results if r['width'] == w) for w, _ in WIDTHS}, 'screens': len({r['screen'] for r in results}), 'inds': len({r['ind'] for r in results}),
           'widths': [w for w, _ in WIDTHS], 'charts_checked': sum(r['charts'] for r in results),
           'pass': len(results) - len(fails), 'fail': len(fails), 'fails': fails[:20]}
print(json.dumps(summary, ensure_ascii=False, indent=1))
sys.exit(1 if fails or len(results) != 120 else 0)
