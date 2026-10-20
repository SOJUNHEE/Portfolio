"""13페이지 포트폴리오 PDF 출력 — python docs/portfolio-pdf/build_pdf.py [출력 경로]
deck.html(원본)을 Chromium으로 1280×720px(960×540pt) 페이지에 출력한다. 대시보드 캡처는 capture.py로 먼저 갱신한다."""
import pathlib
import sys
from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / '소준희_포트폴리오.pdf'
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1280, 'height': 720})
    pg.goto((HERE / 'deck.html').as_uri(), wait_until='networkidle')
    pg.evaluate('document.fonts.ready')
    pg.wait_for_timeout(800)
    over = pg.evaluate("""() => Array.from(document.querySelectorAll('.page')).map((pgEl, i) => {
      const r = pgEl.getBoundingClientRect();
      const bad = Array.from(pgEl.querySelectorAll('*')).filter(e => { const q = e.getBoundingClientRect(); return q.width && (q.bottom > r.bottom + 0.5 || q.right > r.right + 0.5) && !e.classList.contains('ring'); });
      return [i + 1, bad.length, bad.slice(0, 3).map(e => e.tagName + '.' + e.className + ':' + (e.innerText || '').slice(0, 30))];
    }).filter(x => x[1])""")
    print('넘침', over)
    pg.pdf(path=str(out), width='1280px', height='720px', print_background=True, margin={'top': '0', 'right': '0', 'bottom': '0', 'left': '0'})
    b.close()
print(out)
