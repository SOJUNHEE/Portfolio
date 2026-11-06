"""박람회 슬라이드 보기 화면(/static/ppt/index.html) 점검 — Playwright.

사용: python tests/fair_deck_check.py [사이트 주소]   (기본 http://127.0.0.1:5000)
휴대폰(390·360px)·태블릿(768px)·PC(1440px)에서 확인:
  첫 화면 = 종합 소개(프로젝트 4개 바로가기) · 프로젝트 칩 이동과 브라우저 '뒤로' · 이전/다음 · 키보드
  휴대폰 글자 하한(본문 16px, 제목 24px, 보조 14px)과 버튼 높이(44px) · 긴 장에서 넘기면 새 장 맨 위부터
  화면 크게 보기: 열림·뒤 화면 스크롤 잠금·닫기/다음 장 버튼이 화면 안·Esc · 파일 4개 받기 · 가로 넘침 · 콘솔 오류
실패가 있으면 종료 코드 1."""
import sys
from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5000').rstrip('/') + '/static/ppt/index.html'
FILES = ('sojunhee-portfolio-core10.pdf', 'sojunhee-portfolio-core10.pptx', 'sojunhee-portfolio-fair.pdf', 'sojunhee-portfolio-fair.pptx')
fails, passes = [], 0


def check(cond, name):
    global passes
    if cond:
        passes += 1
    else:
        fails.append(name)


def counter(pg):
    return pg.inner_text('#counter').strip()


def wait_counter(pg, text, ms=2500):
    try:
        pg.wait_for_function('t => document.getElementById("counter").textContent.trim() === t', arg=text, timeout=ms)
    except Exception:
        pass
    settle(pg)
    return counter(pg) == text


def settle(pg):
    """옆으로 넘어가는 움직임이 멈출 때까지 기다린다 (사람이 다음 동작을 하는 시점)."""
    last = None
    for _ in range(30):
        cur = pg.evaluate("Math.round(document.getElementById('track').scrollLeft)")
        if cur == last:
            return
        last = cur
        pg.wait_for_timeout(150)


def visible_in_viewport(pg, sel):
    return pg.evaluate("s => { const r = document.querySelector(s).getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth; }", sel)


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
        N = pg.evaluate('window.DECK.slides.length')
        check(N == 20 and pg.locator('#track .slide').count() == N + 1, f'{tag} 종합 소개 + 상세 {N}장')
        check(pg.evaluate('document.documentElement.scrollWidth - innerWidth') <= 0, f'{tag} 가로 넘침 없음')

        # 첫 화면: 종합 소개 + 프로젝트 4개 바로가기
        check(counter(pg) == '소개' and pg.is_disabled('#prev'), f'{tag} 첫 화면은 종합 소개, 이전 비활성')
        intro = pg.locator('#track .sf-item').first
        check(intro.locator('.t-intro').count() == 1 and intro.locator('[data-jump]').count() == 4, f'{tag} 소개에 프로젝트 카드 4개')
        txt = intro.inner_text()
        check(all(k in txt for k in ('4년 8개월', '풀필먼트', '재고', '정산', 'Excel')), f'{tag} 소개에 경력·Excel·4년 8개월')
        names = pg.locator('#chips .v-chip').all_inner_texts()
        check(len(names) == 5 and 'Excel' in names[1] and '3PL' in names[2] and 'AXPORT' in names[3] and 'REBOOT' in names[4], f'{tag} 프로젝트 칩 순서 {names}')
        check(pg.evaluate("Array.from(document.querySelectorAll('.slide')).every(s => { const r = s.getBoundingClientRect(); return Array.from(s.querySelectorAll('*')).every(e => { const q = e.getBoundingClientRect(); return !q.width || (q.right <= r.right + 1 && q.bottom <= r.bottom + 1); }); })"), f'{tag} 슬라이드 안 내용이 밖으로 안 나감')
        first = pg.locator('#track .slide').first.bounding_box()
        check(first['width'] >= min(w - 40, 590) or w >= 900, f'{tag} 슬라이드가 화면 폭을 거의 채움 (태블릿은 600px까지)')
        hs = pg.evaluate("Math.min(...Array.from(document.querySelectorAll('#prev, #next, .v-chip, .v-files summary, .v-links > a')).map(e => e.getBoundingClientRect().height))")
        check(hs >= 44, f'{tag} 버튼 높이 {hs:.0f}px ≥ 44')
        if expect == 'tall':
            q = "s => parseFloat(getComputedStyle(document.querySelector(s)).fontSize)"
            body = pg.evaluate(q, '#track .sf-item:nth-child(3) .s-flow-b')
            title = pg.evaluate(q, '#track .sf-item:nth-child(3) .s-title')
            small = min(pg.evaluate(q, '#track .sf-item:nth-child(2) .s-fig figcaption'), pg.evaluate(q, '#track .sf-item:nth-child(3) .s-proj'), pg.evaluate(q, '.v-help'), pg.evaluate(q, '#proj-name'))
            check(body >= 16, f'{tag} 본문 {body:.1f}px ≥ 16')
            check(title >= 24, f'{tag} 제목 {title:.1f}px ≥ 24')
            check(small >= 14, f'{tag} 보조 글자 {small:.1f}px ≥ 14')
            print(f'{tag} 본문 {body:.1f}px · 제목 {title:.1f}px · 보조 {small:.1f}px · 버튼 {hs:.0f}px')

        # 이전/다음
        pg.click('#next')
        check(wait_counter(pg, f'1 / {N}') and 'Excel' in pg.inner_text('#proj-name') and '한 줄 요약' in pg.inner_text('#proj-name'), f'{tag} 다음 → 1장 Excel 요약')
        pg.click('#next')
        check(wait_counter(pg, f'2 / {N}') and '문제 정의' in pg.inner_text('#proj-name'), f'{tag} 다음 → 2장 문제 정의')
        pg.click('#prev')
        check(wait_counter(pg, f'1 / {N}'), f'{tag} 이전 → 1장')
        # 키보드
        pg.locator('#track').focus(); pg.keyboard.press('ArrowRight')
        check(wait_counter(pg, f'2 / {N}'), f'{tag} 키보드 → 다음')
        pg.keyboard.press('ArrowLeft')
        check(wait_counter(pg, f'1 / {N}'), f'{tag} 키보드 ← 이전')

        # 프로젝트 칩 + 브라우저 뒤로
        pg.click('#chips [data-p="3"]')
        check(wait_counter(pg, f'11 / {N}') and 'AXPORT' in pg.inner_text('#proj-name'), f'{tag} AXPORT 칩 → 11장')
        check(pg.get_attribute('#chips [data-p="3"]', 'aria-current') == 'true', f'{tag} 현재 프로젝트 칩 표시')
        pg.go_back()
        check(wait_counter(pg, f'1 / {N}'), f'{tag} 브라우저 뒤로 → 직전 장(1장)')
        pg.click('#chips [data-go="0"]')
        check(wait_counter(pg, '소개'), f'{tag} 소개 칩 → 종합 소개')
        pg.locator('#track [data-jump="4"]').click()
        check(wait_counter(pg, f'16 / {N}') and 'REBOOT' in pg.inner_text('#proj-name'), f'{tag} 소개 카드 → REBOOT 16장')
        pg.go_back()
        check(wait_counter(pg, '소개'), f'{tag} 뒤로 → 종합 소개')

        # 긴 장을 아래로 읽다가 넘기면 새 장 맨 위부터
        if expect == 'tall':
            pg.click('#chips [data-p="1"]'); wait_counter(pg, f'1 / {N}')
            pg.evaluate('window.scrollTo(0, 1500)'); pg.wait_for_timeout(300)
            pg.click('#next'); wait_counter(pg, f'2 / {N}'); pg.wait_for_timeout(500)
            top = pg.evaluate("document.getElementById('track').getBoundingClientRect().top")
            check(top >= -12, f'{tag} 넘긴 뒤 새 장 맨 위가 보임 (top {top:.0f})')

        # 화면 크게 보기
        pg.goto(BASE + '#1', wait_until='networkidle'); wait_counter(pg, f'1 / {N}')
        pg.locator('#track .sf-item').nth(1).locator('[data-zoom]').click()
        pg.wait_for_timeout(300)
        check(pg.evaluate('document.getElementById("zoom").open'), f'{tag} 크게 보기 열림')
        check(pg.evaluate('document.getElementById("zoom-img").naturalWidth') > 1000, f'{tag} 확대 이미지 원본 해상도')
        check(pg.evaluate("getComputedStyle(document.body).overflow === 'hidden'"), f'{tag} 확대 중 뒤 화면 스크롤 잠금')
        check(visible_in_viewport(pg, '#zoom-close') and visible_in_viewport(pg, '#zoom-next'), f'{tag} 닫기·다음 장 버튼이 화면 안')
        pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
        check(not pg.evaluate('document.getElementById("zoom").open') and pg.evaluate("getComputedStyle(document.body).overflow !== 'hidden'"), f'{tag} Esc로 닫힘·스크롤 잠금 해제')
        pg.locator('#track .sf-item').nth(1).locator('[data-zoom]').click(); pg.wait_for_timeout(300)
        pg.click('#zoom-close'); pg.wait_for_timeout(300)
        check(not pg.evaluate('document.getElementById("zoom").open'), f'{tag} 닫기 버튼')
        pg.locator('#track .sf-item').nth(1).locator('[data-zoom]').click(); pg.wait_for_timeout(300)
        pg.click('#zoom-next')
        check(wait_counter(pg, f'2 / {N}') and not pg.evaluate('document.getElementById("zoom").open'), f'{tag} 확대 화면에서 다음 장')

        # 주소 바로가기 · 마지막 장
        pg.goto(BASE + '#11', wait_until='networkidle')
        check(wait_counter(pg, f'11 / {N}') and 'AXPORT' in pg.inner_text('#proj-name'), f'{tag} #11 바로가기')
        pg.goto(BASE + '#20', wait_until='networkidle')
        check(wait_counter(pg, f'{N} / {N}') and pg.is_disabled('#next'), f'{tag} 마지막 장에서 다음 비활성')
        check('sojh90@naver.com' in pg.locator('#track .sf-item').last.inner_text(), f'{tag} 마지막 장 연락처')

        # 파일 받기
        pg.click('.v-files summary'); pg.wait_for_timeout(200)
        check(pg.locator('.v-files-list a').count() == 4 and visible_in_viewport(pg, '.v-files-list'), f'{tag} 파일 받기 목록이 화면 안')
        for href in FILES:
            r = pg.request.get(BASE.rsplit('/', 1)[0] + '/' + href)
            check(r.status == 200 and len(r.body()) > 10000, f'{tag} {href} 받기')   # 압축 응답은 content-length가 없을 수 있음
        check(not errs, f'{tag} 콘솔 오류 없음 {errs[:2]}')
        pg.close()
    b.close()

print(f'pass {passes} fail {len(fails)}')
for f in fails:
    print('FAIL', f)
sys.exit(1 if fails else 0)
