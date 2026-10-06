// 시험용 PDF를 만든다. pages: 쪽마다 [{ text, size }] 줄 목록. 외부 의존 없이 글자만 있는 단순한 PDF(Helvetica)를 쓴다.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function makePdf(pages) {
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('PAGES');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  const esc = (t) => t.replace(/[\\()]/g, (c) => '\\' + c);
  for (const lines of pages) {
    let y = 760;
    const content = lines.map((l) => { y -= l.size + 6; return `BT /F1 ${l.size} Tf 50 ${y} Td (${esc(l.text)}) Tj ET`; }).join('\n');
    const c = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    const p = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${c} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
    kids.push(`${p} 0 R`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const L = (text, size = 10) => ({ text, size });
const para = (seed, n = 6) => Array.from({ length: n }, (_, i) => L(`Sentence ${seed}${i} explains how the mixed model parameters are estimated by maximum likelihood.`));

// 일반 논문: 제목·저자, Abstract, 번호 있는 제목, 쪽마다 머리글·쪽 번호, 참고문헌
export function samplePaper() {
  const head = (n) => [L('Journal of Fixture Statistics', 9)];
  const foot = (n) => [L(String(n), 9)];
  return [
    [...head(1), L('Fitting Linear Mixed-Effects Models', 20), L('D. Bates, M. Maechler', 11), L('Abstract', 14), ...para('a'), L('1 Introduction', 14), ...para('b'), ...foot(1)],
    [...head(2), L('2 Methods', 14), ...para('c'), L('2.1 Estimation of effects', 12), ...para('d'), ...foot(2)],
    [...head(3), L('3 Results', 14), ...para('e'), L('4 Discussion', 14), ...para('f'), ...foot(3)],
    [...head(4), L('References', 14), L('Bates, D. (2015). Fitting linear mixed-effects models. Journal of Software, 67(1).'), L('Smith, J. (2010). Another reference entry. Annals of Fixtures, 3, 10-20.'), ...foot(4)],
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'pdf');
  writeFileSync(join(dir, 'sample-paper.pdf'), makePdf(samplePaper()));
  writeFileSync(join(dir, 'scanned.pdf'), makePdf([[], [], []])); // 글자 없는 쪽만 있는 PDF (스캔본처럼)
  writeFileSync(join(dir, 'no-headings.pdf'), makePdf([para('p'), para('q'), para('r')].map((p) => [...p, ...para('s')])));
  writeFileSync(join(dir, 'not-a-pdf.pdf'), 'This is plain text, not a PDF.\n');
  console.log('written to', dir);
}
