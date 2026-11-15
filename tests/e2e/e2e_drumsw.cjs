// 153-я: пошук вікон барабана (водомір, світло, газ) — у фоновому потоці: той самий engine.js воркером, сторінка не стоїть.
// Сайт: SITE_BASE= SITE_DATA=/tmp/teplo_data php -S 127.0.0.1:8013 index.php. Кадр — синтетичний водомір (tests/ocr-lab/water.html, випадок r_novator).
const { chromium } = require('playwright'); const path = require('path');
const BASE = 'http://127.0.0.1:8013/', CASE = require('../ocr-lab/water_cases.json').find(c => c.id === 'r_novator');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
(async () => {
  const b = await chromium.launch();
  // кадр водоміра — малюємо лабораторією (у git картинок немає)
  const pg = await b.newPage({ viewport: { width: 1200, height: 1600 } }); await pg.goto('file://' + path.resolve(__dirname, '../ocr-lab/water.html'));
  await pg.evaluate(c => window.setCase(c), CASE); await pg.waitForTimeout(150); const jpg = (await pg.screenshot({ type: 'jpeg', quality: 80 })).toString('base64'); await pg.close();
  const run = async (sync) => {
    const p = await b.newPage(); const ws = [], errs = []; p.on('worker', w => ws.push(w.url())); p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + '#home'); await p.waitForTimeout(500);
    if (sync) await p.evaluate(() => { window.TEPLO_DRUMS_SYNC = true; });
    await p.evaluate(() => new Promise((ok, bad) => { const s = document.createElement('script'); s.src = '/web/ocr/engine.js?v=' + Date.now(); s.onload = ok; s.onerror = bad; document.head.appendChild(s); }));
    await p.evaluate(() => TeploOCR.load('/web/ocr/'));
    const r = await p.evaluate(async b64 => {
      const bin = atob(b64), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      const blob = new Blob([a], { type: 'image/jpeg' }), lt = [];
      const po = new PerformanceObserver(l => l.getEntries().forEach(e => lt.push(Math.round(e.duration)))); try { po.observe({ type: 'longtask' }); } catch (e) { /* без longtask */ }
      const fast = await TeploOCR.read(blob, { fast: true }), full = await TeploOCR.read(blob); po.disconnect();
      const d = x => x.drums.map(q => q.text + ',' + (q.red || '') + ',' + (q.tint || '')).join('|');
      return { fast: d(fast), full: d(full), lt: Math.max(0, ...lt) };
    }, jpg);
    await p.close(); return { r, ws: ws.filter(u => /engine\.js/.test(u)).length, errs };
  };
  const w = await run(false), s = await run(true);
  ok('воркер барабана — сам engine.js (окремий потік), без помилок сторінки', w.ws === 1 && !w.errs.length, w);
  ok('водомір з камери й повним проходом: 00502, червоні 347 — і у воркері, і в основному потоці однаково', /^00502,347/.test(w.r.fast) && /^00502,347/.test(w.r.full) && w.r.fast === s.r.fast && w.r.full === s.r.full, [w.r, s.r]);
  ok('без воркера (TEPLO_DRUMS_SYNC) — як раніше, у тому ж потоці', s.ws === 0 && !s.errs.length, s);
  ok('довгих задач сторінки ≥ 150 мс з воркером немає (пошук вікон ~0,25 с ішов в основному потоці)', w.r.lt < 150, { worker: w.r.lt, sync: s.r.lt });
  console.log(`\ne2e_drumsw: ${pass} ok, ${fail} fail`); await b.close(); process.exit(fail ? 1 : 0);
})();
