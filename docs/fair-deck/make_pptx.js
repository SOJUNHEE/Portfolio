// 16:9 슬라이드 이미지(s01~s15.png)로 PPTX를 만든다. 어느 PC·Google 슬라이드에서 열어도 글꼴이 바뀌지 않게 이미지로 넣고,
// 발표 내용은 발표자 노트에 둔다. 사용: node make_pptx.js <static/ppt 경로>  (pptxgenjs 필요: npm install pptxgenjs)
const path = require('path');
const fs = require('fs');
const pptxgen = require('pptxgenjs');

const dir = process.argv[2];
const notes = JSON.parse(fs.readFileSync(path.join(dir, '_notes.json'), 'utf-8'));
const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9';
pres.author = '소준희';
pres.title = '소준희 포트폴리오 — 박람회용';
notes.forEach((n, i) => {
  const s = pres.addSlide();
  const img = path.join(dir, `s${String(i + 1).padStart(2, '0')}.png`);
  s.addImage({ path: img, x: 0, y: 0, w: 10, h: 5.625, altText: `슬라이드 ${i + 1}` });
  if (n) s.addNotes(n);
});
pres.writeFile({ fileName: path.join(dir, 'sojunhee-portfolio-fair.pptx') }).then(f => console.log('pptx', path.basename(f)));
