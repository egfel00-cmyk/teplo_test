// Дорощування вікна (184-я, growWin): кандидат → вікно й прочитане. node tests/ocr-lab/grow.cjs <папка> <фото> '{"cx":530,"cy":709,"w":224,"h":74,"angle":6.17,"sure":true}' [наклон надписів]
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..'), [dir, file, cand, hint] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage(); p.on('console', m => console.log('[page]', m.text().slice(0, 300)));
  await p.route('http://lab.test/**', r => { const u = new URL(r.request().url()); if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><script src="/web/ocr/engine.js"></script>' });
    const f = u.pathname.startsWith('/img/') ? path.join(dir, u.pathname.slice(5)) : path.join(ROOT, u.pathname); const ty = { js: 'text/javascript', mjs: 'text/javascript', wasm: 'application/wasm' }[f.split('.').pop()] || 'application/octet-stream';
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: 'nf' }); r.fulfill({ contentType: ty, body: fs.readFileSync(f) }); });
  await p.goto('http://lab.test/'); await p.evaluate(() => TeploOCR.load('/web/ocr/'));
  const r = await p.evaluate(async ([f, d, h]) => { const blob = await (await fetch('/img/' + f)).blob(); return TeploOCR._grow(blob, d, h); }, [file, JSON.parse(cand), hint === undefined ? null : Number(hint)]);
  console.log(JSON.stringify(r)); await b.close();
})();
