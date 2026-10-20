"""PDF 7~9페이지용 대시보드 화면 캡처 — python docs/portfolio-pdf/capture.py http://127.0.0.1:5000/demo/scm-dashboard/
배포본과 같은 파일(demos/scm-dashboard)을 2배 해상도로 캡처해 img/에 저장한다. 사이트 파일은 수정하지 않는다."""
import pathlib
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5000/demo/scm-dashboard/'
OUT = pathlib.Path(__file__).resolve().parent / 'img'
OUT.mkdir(exist_ok=True)

BOX = """(sel) => { const e = document.querySelector(sel); const r = e.getBoundingClientRect();
  return { x: r.left, y: r.top + window.scrollY, width: r.width, height: r.height }; }"""


def shot(pg, name, sel=None, pad=0, viewport=False, max_h=None):
    pg.evaluate('document.fonts.ready'); pg.wait_for_timeout(700)
    if viewport:
        pg.evaluate('window.scrollTo(0, 0)'); pg.wait_for_timeout(300)
        pg.screenshot(path=str(OUT / name))
    else:
        b = pg.evaluate(BOX, sel)
        clip = {'x': b['x'] - pad, 'y': b['y'] - pad, 'width': b['width'] + pad * 2, 'height': (min(b['height'], max_h) if max_h else b['height']) + pad * 2}
        pg.screenshot(path=str(OUT / name), clip=clip, full_page=True)
    print(name)


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1440, 'height': 900}, device_scale_factor=2)
    pg.goto(BASE, wait_until='networkidle'); pg.wait_for_timeout(1500)

    def go(sid):
        pg.evaluate('(id) => SCMApp.go(id)', sid); pg.wait_for_timeout(1200)

    go('overview')
    shot(pg, 'p7-overview.png', viewport=True)                                   # 7p 대표 화면: 운영 종합 현황(오늘 진행·화주사별 진행률)
    shot(pg, 'p8-kpis.png', '.kpi-grid.k4', pad=4)                               # 8p 표준 KPI 7개
    shot(pg, 'p8-todo.png', '.todo', pad=4, max_h=420)                           # 8p 우선 처리 업무
    go('b2c')
    pg.evaluate("document.querySelector('#chCause').closest('.grid-2').setAttribute('id','capCause')")
    shot(pg, 'p9-b2c.png', '#capCause', pad=4)                                   # 9p 지연 원인 + 시간대별 주문
    go('labor')
    pg.evaluate("document.querySelector('#chLabor').closest('.panel').setAttribute('id','capLabor')")
    shot(pg, 'p9-labor.png', '#capLabor', pad=4)                                 # 9p 필요 시간 vs 투입 시간
    b.close()
