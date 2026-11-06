// 16:9 슬라이드 이미지로 PPTX를 만든다. 어느 PC·Google 슬라이드에서 열어도 글꼴이 바뀌지 않게 이미지로 넣고,
// 발표 내용은 발표자 노트에 둔다.
// 사용: node make_pptx.js <static/ppt 경로> <이미지 접두어 s|c> <출력 파일 이름> <제목>   (pptxgenjs 필요: npm install pptxgenjs)
// 쪽 크기는 PowerPoint 기본 와이드(13.33 × 7.5in) — 슬라이드 글자 크기(pt) 기준과 같게.
const path = require('path');
const fs = require('fs');
const pptxgen = require('pptxgenjs');

const [dir, prefix = 's', outName = 'sojunhee-portfolio-fair.pptx', title = '소준희 포트폴리오 — 박람회용'] = process.argv.slice(2);
const notes = JSON.parse(fs.readFileSync(path.join(dir, `_notes_${prefix}.json`), 'utf-8'));
const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';
pres.author = '소준희';
pres.title = title;
notes.forEach((n, i) => {
  const s = pres.addSlide();
  const img = path.join(dir, `${prefix}${String(i + 1).padStart(2, '0')}.png`);
  s.addImage({ path: img, x: 0, y: 0, w: 13.333, h: 7.5, altText: `슬라이드 ${i + 1}` });
  if (n) s.addNotes(n);
});
pres.writeFile({ fileName: path.join(dir, outName) }).then(f => console.log('pptx', path.basename(f), notes.length + '장'));
