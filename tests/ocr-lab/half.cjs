// Ролик между цифрами: для каждого случая набора — что узнал движок (пара, сходство sc, отрыв margin, rank).
// NODE_PATH=$(npm root -g) node tests/ocr-lab/half.cjs water_half.json   (TPL_FONTS='["\"Liberation Sans\", sans-serif"]' — шаблоны как на телефоне)
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const ROOT = require('path').resolve(__dirname, '../..'), dir = ROOT + '/tests/ocr-lab/out', cases = require(ROOT + '/tests/ocr-lab/' + process.argv[2]);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage(); let cur = '';
  p.on('console', m => { const t = m.text(); if (/^DBG half/.test(t)) console.log(cur.padEnd(14), t.replace('DBG half ', '').slice(0, 200)); });
  await p.route('http://lab.test/**', r => { const u = new URL(r.request().url()); if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><script src="/web/ocr/engine.js"></script>' });
    const f = u.pathname.startsWith('/img/') ? path.join(dir, decodeURIComponent(u.pathname.slice(5))) : path.join(ROOT, decodeURIComponent(u.pathname)); if (!fs.existsSync(f)) return r.fulfill({status:404,body:'nf'});
    const ext = f.split('.').pop(); r.fulfill({ body: fs.readFileSync(f), contentType: {js:'text/javascript',mjs:'text/javascript',wasm:'application/wasm'}[ext] || 'application/octet-stream' }); });
  await p.goto('http://lab.test/'); await p.evaluate(() => TeploOCR.load('/web/ocr/'));
  if (process.env.MODE) await p.evaluate(m => { window.TEPLO_HALF_MODE = m; }, process.env.MODE);
  if (process.env.TPL_FONTS) await p.evaluate(f => { window.TEPLO_TPL_FONTS = JSON.parse(f); }, process.env.TPL_FONTS);
  for (const c of cases) { cur = c.id + ' ' + c.v.slice(-1); await p.evaluate(async (f) => { window.TEPLO_DRUM_LOG = true; const blob = await (await fetch('/img/' + f)).blob(); await TeploOCR.read(blob); }, c.id + '.jpg'); }
  await b.close(); })();
