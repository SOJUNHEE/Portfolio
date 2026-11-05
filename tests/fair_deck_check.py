"""박람회 슬라이드 보기 화면(/static/ppt/index.html) 점검 — Playwright.

사용: python tests/fair_deck_check.py [사이트 주소]   (기본 http://127.0.0.1:5000)
휴대폰(390·360px)·태블릿(768px)·PC(1440px)에서 가로 넘침, 장 수, 이전/다음, 화면 크게 보기·닫기·다음 장,
#번호 바로가기, 콘솔 오류를 확인한다. 실패가 있으면 종료 코드 1."""
import sys
from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5000').rstrip('/') + '/static/ppt/index.html'
fails, passes = [], 0


def check(cond, name):
    global passes
    if cond:
        passes += 1
    else:
        fails.append(name)


with sync_playwright() as p:
    b = p.chromium.launch()
    for w, h, expect in ((390, 844, 'tall'), (360, 740, 'tall'), (768, 1024, 'tall'), (1440, 900, 'wide')):
        pg = b.new_page(viewport={'width': w, 'height': h}, has_touch=w < 900)
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)[:120]))
        pg.on('console', lambda m: errs.append(m.text[:120]) if m.type == 'error' else None)
        pg.goto(BASE, wait_until='networkidle')
        pg.wait_for_timeout(500)
        tag = f'{w}px'
        check(pg.evaluate('document.documentElement.getAttribute("data-layout")') == expect, f'{tag} 배치 {expect}')
        check(pg.locator('#track .slide').count() == 15, f'{tag} 슬라이드 15장')
        check(pg.evaluate('document.documentElement.scrollWidth - innerWidth') <= 0, f'{tag} 가로 넘침 없음')
        check(pg.inner_text('#counter') == '1 / 15', f'{tag} 첫 장 번호')
        check(pg.is_disabled('#prev'), f'{tag} 첫 장에서 이전 비활성')
        first = pg.locator('#track .slide').first.bounding_box()
        check(pg.evaluate("Array.from(document.querySelectorAll('#track .slide')).every(s => { const r = s.getBoundingClientRect(); return Array.from(s.querySelectorAll('*')).every(e => { const q = e.getBoundingClientRect(); return !q.width || (q.right <= r.right + 1 && q.bottom <= r.bottom + 1); }); })"), f'{tag} 슬라이드 안 내용이 밖으로 안 나감')
        check(first['width'] >= min(w - 40, 590) or w >= 900, f'{tag} 첫 슬라이드가 화면 폭을 거의 채움 (태블릿은 600px까지)')
        if expect == 'tall':
            fs = pg.evaluate("parseFloat(getComputedStyle(document.querySelector('#track .s-meta dd')).fontSize)")
            check(fs >= 12, f'{tag} 작은 글자 {fs:.1f}px ≥ 12')
            fb = pg.evaluate("parseFloat(getComputedStyle(document.querySelector('#track .sf-item:nth-child(2) .s-flow-b')).fontSize)")
            check(fb >= 13.5, f'{tag} 본문 {fb:.1f}px ≥ 13.5')
            print(f'{tag} 본문 글자 {fb:.1f}px · 작은 글자 {fs:.1f}px')
        pg.click('#next'); pg.wait_for_timeout(700)
        check(pg.inner_text('#counter') == '2 / 15', f'{tag} 다음 → 2/15')
        check('문제 정의' in pg.inner_text('#proj-name'), f'{tag} 위쪽에 프로젝트·장 이름')
        pg.click('#prev'); pg.wait_for_timeout(700)
        check(pg.inner_text('#counter') == '1 / 15', f'{tag} 이전 → 1/15')
        pg.locator('#track .sf-item').first.locator('[data-zoom]').click()
        pg.wait_for_timeout(300)
        check(pg.evaluate('document.getElementById("zoom").open'), f'{tag} 화면 크게 보기 열림')
        check(pg.evaluate('document.getElementById("zoom-img").naturalWidth') > 1000, f'{tag} 확대 이미지 원본 해상도')
        pg.click('#zoom-next'); pg.wait_for_timeout(700)
        check(not pg.evaluate('document.getElementById("zoom").open') and pg.inner_text('#counter') == '2 / 15', f'{tag} 확대 화면에서 다음 장')
        pg.goto(BASE + '#11', wait_until='networkidle'); pg.wait_for_timeout(600)
        check(pg.inner_text('#counter') == '11 / 15' and 'AXPORT' in pg.inner_text('#proj-name'), f'{tag} #11 바로가기')
        for i in range(4):   # 11 → 15
            pg.click('#next'); pg.wait_for_timeout(600)
        check(pg.inner_text('#counter') == '15 / 15' and pg.is_disabled('#next'), f'{tag} 마지막 장에서 다음 비활성')
        for href in ('sojunhee-portfolio-fair.pdf', 'sojunhee-portfolio-fair.pptx'):
            r = pg.request.get(BASE.rsplit('/', 1)[0] + '/' + href)
            check(r.status == 200 and int(r.headers.get('content-length', '1')) > 10000, f'{tag} {href} 받기')
        check(not errs, f'{tag} 콘솔 오류 없음 {errs[:2]}')
        pg.close()
    b.close()

print(f'pass {passes} fail {len(fails)}')
for f in fails:
    print('FAIL', f)
sys.exit(1 if fails else 0)
