// Ручне вікно барабана: що читає розпізнавач (TeploOCR._recBox) у режимах inv/bin/plain/red.
// node tests/ocr-lab/box.cjs <папка> <фото> '[{"cx":390,"cy":690,"w":520,"h":105,"angle":0.05}]'
// ручное окно: TeploOCR._recBox(file, blk, mode) → что читает распознаватель
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..'), [dir, file, blks] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.route('http://lab.test/**', r => { const u = new URL(r.request().url()); if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><script src="/web/ocr/engine.js"></script>' });
    const f = u.pathname.startsWith('/img/') ? path.join(dir, u.pathname.slice(5)) : path.join(ROOT, u.pathname); const ty = { js: 'text/javascript', mjs: 'text/javascript', wasm: 'application/wasm' }[f.split('.').pop()] || 'application/octet-stream';
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: 'nf' }); r.fulfill({ contentType: ty, body: fs.readFileSync(f) }); });
  await p.goto('http://lab.test/'); await p.evaluate(() => TeploOCR.load('/web/ocr/'));
  for (const blk of JSON.parse(blks)) for (const m of ['inv', 'bin', 'plain', 'red']) {
    const r = await p.evaluate(async ([f, blk, m]) => { const blob = await (await fetch('/img/' + f)).blob(); const r = await TeploOCR._recBox(blob, blk, m); return r.text + ' ' + (r.score || 0).toFixed(2); }, [file, blk, m]);
    console.log(JSON.stringify(blk), m, r);
  }
  await b.close();
})();
