// 144-а (власник 14.11, iPhone: «на раскрывашку квартиры снова два тапа»): фонова перемальовка (довідник постачальників за адресою,
// дані з іншого пристрою) приходить посеред дотику — #root міняється через innerHTML, і тап губився. Тут відповідь /api/providers
// тримаємо й відпускаємо між touchStart і touchEnd: вузол під пальцем до відпускання той самий (WebKit iOS інакше скасовує тап — Chromium ні),
// картка перемикається з одного тапу, а перемальовка доходить після тапу.
// cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_taprace.cjs
const { chromium, devices } = require('playwright');
const demo = require('./demo.cjs');
let pass = 0, fail = 0;
const ok = (name, c, extra) => { if (c) pass++; else fail++; console.log((c ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext(Object.assign({}, devices['iPhone 13']));
  await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  let held = [];
  await p.route('**/api/providers**', r => { held.push(r); });
  const release = async () => { const h = held; held = []; for (const r of h) { try { const res = await r.fetch(); await r.fulfill({ response: res }); } catch (e) { /* закрита сторінка */ } } return h.length; };
  await p.goto('http://127.0.0.1:8013/');
  await p.evaluate(s => { localStorage.setItem('teplo.v1', JSON.stringify(s)); localStorage.setItem('teplo.cc', JSON.stringify({ v: 1, a: 0, at: new Date().toISOString(), id: 'x' })); localStorage.setItem('teplo.fx', 'full'); }, demo({ second: true }));
  const cdp = await ctx.newCDPSession(p);
  const isOpen = id => p.$eval('#' + id, d => d.open);
  const mark = () => p.evaluate(() => { const c = document.querySelector('#hp-p2'); if (c) c.__old = 1; });
  const fresh = () => p.evaluate(() => { const c = document.querySelector('#hp-p2'); return !!c && !c.__old; });
  // кожен раз — свіже завантаження: довідник за адресою ще не прийшов, тримаємо його відповідь до дотику
  for (const id of ['hp-p2', 'hp-main', 'hp-p2', 'hp-main']) {
    held = []; await p.goto('http://127.0.0.1:8013/#home'); await p.reload(); await p.waitForTimeout(1300);
    ok(id + ': відповідь довідника ще тримаємо', held.length > 0, 'held ' + held.length);
    await p.locator('#' + id + ' > summary').scrollIntoViewIfNeeded(); await p.waitForTimeout(150);
    const before = await isOpen(id), bb = await p.locator('#' + id + ' > summary').boundingBox(), x = bb.x + 60, y = bb.y + Math.min(bb.height / 2, 28);
    await mark();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await p.waitForTimeout(40);
    const n = await release(); await p.waitForTimeout(120);
    // WebKit на iPhone скасовує тап, якщо вузол під пальцем замінили між дотиком і відпусканням (commitPotentialTap) — Chromium так не робить,
    // тому перевіряємо саму умову: до відпускання картка та сама
    ok(id + ': до відпускання пальця картку не перемальовано', !(await fresh()));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(900);
    ok(id + (before ? ' згорнути' : ' розгорнути') + ' посеред перемальовки — з одного тапу', (await isOpen(id)) === !before, 'відпущено ' + n);
    ok(id + ': перемальовка дійшла після тапу', await fresh());
  }
  if (errs.length) console.log(errs.join('\n'));
  ok('без помилок JS', !errs.length);
  console.log(`\n${pass} ok, ${fail} fail`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
