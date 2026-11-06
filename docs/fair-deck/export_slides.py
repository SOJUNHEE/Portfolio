"""박람회 슬라이드 내보내기 — static/ppt/slides.js(단일 원본)를 16:9·4:5로 그려 PNG·PDF·PPTX를 만든다.

사용: python docs/fair-deck/export_slides.py [사이트 주소]   (기본 http://127.0.0.1:5000, 먼저 python app.py 실행)
결과 (static/ppt/):
  상세 20장  s01~s20.png(16:9, 1920×1080) · m01~m20.png(휴대폰, 폭 1080) · sojunhee-portfolio-fair.pdf · sojunhee-portfolio-fair.pptx
  핵심 10장  c01~c10.png(16:9) · sojunhee-portfolio-core10.pdf · sojunhee-portfolio-core10.pptx
  PPTX는 이미지형(13.33×7.5in) + 발표자 노트.
넘침 점검: 슬라이드 밖으로 나간 요소가 있으면 목록을 출력하고 종료 코드 1."""
import json
import pathlib
import subprocess
import sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'static' / 'ppt'
BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5000').rstrip('/')

OVERFLOW = r"""() => Array.from(document.querySelectorAll('.slide')).map((s, k) => {
  const r = s.getBoundingClientRect(), bad = [];
  s.querySelectorAll('*').forEach(e => {
    const q = e.getBoundingClientRect();
    if (!q.width || !q.height) return;
    const tall = s.classList.contains('tall');   // 4:5는 아래로 늘어날 수 있으므로 가로 넘침만 본다
    if ((!tall && (q.bottom > r.bottom - 2 || q.top < r.top + 1)) || q.right > r.right - 2 || q.left < r.left + 1) bad.push(e.className || e.tagName);
  });
  if (!s.classList.contains('tall')) s.querySelectorAll('.s-body, .s-lead, .s-col').forEach(e => { if (e.scrollHeight > e.clientHeight + 2) bad.push('overflow:' + e.className); });
  return [k + 1, [...new Set(bad)].slice(0, 6)];
}).filter(x => x[1].length)"""

# (set, layout, 폭, 배율, 이미지 접두어, PDF 이름, PPTX 이름, 제목)
JOBS = (
    ('full', 'wide', 1600, 1.2, 's', 'sojunhee-portfolio-fair.pdf', 'sojunhee-portfolio-fair.pptx', '소준희 포트폴리오 — 상세 20장'),
    ('core', 'wide', 1600, 1.2, 'c', 'sojunhee-portfolio-core10.pdf', 'sojunhee-portfolio-core10.pptx', '소준희 포트폴리오 — 핵심 10장'),
    ('full', 'tall', 1080, 1, 'm', None, None, None),
)

problems, pptx = {}, []
with sync_playwright() as p:
    b = p.chromium.launch()
    for set_, layout, width, scale, prefix, pdf, ppt, title in JOBS:
        pg = b.new_page(viewport={'width': width, 'height': 1200}, device_scale_factor=scale)
        pg.goto(f'{BASE}/static/ppt/export.html?layout={layout}&set={set_}', wait_until='networkidle')
        pg.evaluate('document.fonts.ready')
        pg.wait_for_timeout(800)
        problems[f'{set_}-{layout}'] = pg.evaluate(OVERFLOW)
        if layout == 'tall':
            print('휴대폰 높이 비율(1.25가 4:5):', pg.evaluate("Array.from(document.querySelectorAll('.slide')).map(s => +(s.offsetHeight / s.offsetWidth).toFixed(2))"))
        for old in OUT.glob(f'{prefix}[0-9][0-9].png'):
            old.unlink()
        slides = pg.locator('.slide')
        for i in range(slides.count()):
            slides.nth(i).screenshot(path=str(OUT / f'{prefix}{i + 1:02d}.png'))
        if pdf:
            pg.emulate_media(media='print')
            pg.pdf(path=str(OUT / pdf), width='1600px', height='900px', print_background=True, margin={'top': '0', 'right': '0', 'bottom': '0', 'left': '0'})
            (OUT / f'_notes_{prefix}.json').write_text(json.dumps(pg.evaluate('window.DECK_EXPORT'), ensure_ascii=False), encoding='utf-8')
            pptx.append((prefix, ppt, title))
        print(set_, layout, slides.count(), '장')
        pg.close()
    b.close()

code = 0
for prefix, ppt, title in pptx:
    r = subprocess.run(['node', str(pathlib.Path(__file__).with_name('make_pptx.js')), str(OUT), prefix, ppt, title], capture_output=True, text=True, encoding='utf-8')
    print(r.stdout.strip(), r.stderr.strip()[:500])
    code |= r.returncode
    (OUT / f'_notes_{prefix}.json').unlink()
print('넘침', json.dumps(problems, ensure_ascii=False))
sys.exit(1 if any(problems.values()) or code else 0)
