"""다품종 3PL 프로젝트 이미지 캡처 — python docs/capture_project_images.py http://127.0.0.1:5000/demo/scm-dashboard/
사이트 상세·카드(static/images/projects/multi3pl-*.png)와 슬라이드(static/ppt/img/3pl-*.png)에 쓰는 화면을
실제 대시보드에서 1600×1000 첫 화면으로 다시 찍는다. 대시보드 디자인을 바꾼 뒤 이미지를 맞출 때 사용 (2026-11-10 추가)."""
import pathlib
import shutil
import sys
from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5000/demo/scm-dashboard/').rstrip('/') + '/'
ROOT = pathlib.Path(__file__).resolve().parents[1]
PROJ = ROOT / 'static' / 'images' / 'projects'
PPT = ROOT / 'static' / 'ppt' / 'img'
SHOTS = [('multi3pl-overview.png', 'overview', 'ALL'), ('multi3pl-stock.png', 'stock', 'ALL'), ('multi3pl-labor.png', 'labor', 'ALL'),
         ('multi3pl-settle.png', 'settle', 'ALL'), ('multi3pl-food.png', 'focus', 'FOD')]
COPY = {'multi3pl-overview.png': '3pl-overview.png', 'multi3pl-settle.png': '3pl-settle.png'}

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1600, 'height': 1000})
    pg.goto(BASE, wait_until='networkidle')
    pg.wait_for_function("document.querySelectorAll('#nav [data-screen]').length >= 10")
    for name, screen, ind in SHOTS:
        pg.evaluate("v => { const s = document.getElementById('fInd'); if (s.value !== v) { s.value = v; s.dispatchEvent(new Event('change', {bubbles: true})); } }", ind)
        pg.click('#nav [data-screen="%s"]' % screen)
        pg.wait_for_timeout(900)
        pg.evaluate('scrollTo(0, 0)')
        pg.wait_for_timeout(300)
        pg.screenshot(path=str(PROJ / name))
        if name in COPY:
            shutil.copyfile(PROJ / name, PPT / COPY[name])
        print(name, screen, ind)
    b.close()
