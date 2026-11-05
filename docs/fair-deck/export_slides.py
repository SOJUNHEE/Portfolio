"""박람회 슬라이드 내보내기 — static/ppt/slides.js(단일 원본)를 16:9·4:5로 그려 PNG·PDF·PPTX를 만든다.

사용: python docs/fair-deck/export_slides.py [사이트 주소]   (기본 http://127.0.0.1:5000, 먼저 python app.py 실행)
결과: static/ppt/s01~s15.png(16:9, 1920×1080), static/ppt/m01~m15.png(4:5, 1080×1350),
      static/ppt/sojunhee-portfolio-fair.pdf(16:9 15쪽), static/ppt/sojunhee-portfolio-fair.pptx(16:9 이미지 + 발표자 노트)
넘침 점검: 슬라이드 밖으로 나간 요소가 있으면 목록을 출력하고 종료 코드 1."""
import json
import pathlib
import subprocess
import sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'static' / 'ppt'
BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5000').rstrip('/')

OVERFLOW = r"""() => Array.from(document.querySelectorAll('.slide')).map(s => {
  const r = s.getBoundingClientRect(), bad = [];
  s.querySelectorAll('*').forEach(e => {
    const q = e.getBoundingClientRect();
    if (!q.width || !q.height) return;
    const tall = s.classList.contains('tall');   // 4:5는 아래로 늘어날 수 있으므로 가로 넘침만 본다
    if ((!tall && (q.bottom > r.bottom - 2 || q.top < r.top + 1)) || q.right > r.right - 2 || q.left < r.left + 1) bad.push(e.className || e.tagName);
  });
  if (!s.classList.contains('tall')) s.querySelectorAll('.s-body, .s-lead, .s-col').forEach(e => { if (e.scrollHeight > e.clientHeight + 2) bad.push('overflow:' + e.className); });
  return [Number(s.dataset.n), [...new Set(bad)].slice(0, 6)];
}).filter(x => x[1].length)"""

problems = {}
with sync_playwright() as p:
    b = p.chromium.launch()
    for layout, width, scale, prefix in (('wide', 1600, 1.2, 's'), ('tall', 1080, 1, 'm')):
        pg = b.new_page(viewport={'width': width, 'height': 1200}, device_scale_factor=scale)
        pg.goto(f'{BASE}/static/ppt/export.html?layout={layout}', wait_until='networkidle')
        pg.evaluate('document.fonts.ready')
        pg.wait_for_timeout(800)
        problems[layout] = pg.evaluate(OVERFLOW)
        if layout == 'tall':
            print('4:5 높이 비율(1.25가 기본):', pg.evaluate("Array.from(document.querySelectorAll('.slide')).map(s => +(s.offsetHeight / s.offsetWidth).toFixed(2))"))
        slides = pg.locator('.slide')
        for i in range(slides.count()):
            slides.nth(i).screenshot(path=str(OUT / f'{prefix}{i + 1:02d}.png'))
        if layout == 'wide':
            pg.emulate_media(media='print')
            pg.pdf(path=str(OUT / 'sojunhee-portfolio-fair.pdf'), width='1600px', height='900px', print_background=True, margin={'top': '0', 'right': '0', 'bottom': '0', 'left': '0'})
            notes = pg.evaluate('window.DECK.slides.map(s => s.notes || "")')
        pg.close()
    b.close()

(OUT / '_notes.json').write_text(json.dumps(notes, ensure_ascii=False), encoding='utf-8')
r = subprocess.run(['node', str(pathlib.Path(__file__).with_name('make_pptx.js')), str(OUT)], capture_output=True, text=True, encoding='utf-8')
print(r.stdout.strip(), r.stderr.strip()[:500])
(OUT / '_notes.json').unlink()
print('넘침', json.dumps(problems, ensure_ascii=False))
sys.exit(1 if any(problems.values()) or r.returncode else 0)
