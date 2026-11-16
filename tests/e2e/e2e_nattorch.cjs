// 161-а: рідний ліхтарик застосунку iPhone (apps/ios NativeTorch) у «Камері з підказками»: є PeredaiNative.torch — кнопка видна,
// дотик → peredaiTorch {on: true}, ще раз → {on: false}, закрили камеру з увімкненим → {on: false}; немає — як було (кнопки немає без torch у треку).
// cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_nattorch.cjs   (сайт 127.0.0.1:8013; підроблена камера Chromium без файлу)
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const BASE = 'http://127.0.0.1:8013/';
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  for (const nat of [true, false]) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    if (nat) await ctx.addInitScript(() => { window.__t = []; window.PeredaiNative = { torch: 1 }; window.webkit = { messageHandlers: { peredaiTorch: { postMessage: m => { window.__t.push(m.on); return Promise.resolve(JSON.stringify({ on: m.on })); } } } }; });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo({}));
    await p.goto(BASE + '#photo'); await p.reload(); await p.waitForTimeout(700);
    await p.click('[data-act="cam"][data-kind="heat"]');
    await p.waitForFunction(() => { const v = document.querySelector('.cam-v'); return v && v.videoWidth > 0; }, null, { timeout: 15000 });
    const vis = await p.$eval('.cam-torch', el => !el.hidden);
    if (!nat) { ok('браузер: кнопки ліхтарика немає (у підробленої камери torch немає)', !vis); await ctx.close(); continue; }
    ok('застосунок: кнопка ліхтарика видна', vis);
    await p.click('.cam-torch'); await p.waitForTimeout(200);
    ok('дотик → peredaiTorch {on: true}, кнопка натиснута', JSON.stringify(await p.evaluate(() => window.__t)) === '[true]' && await p.$eval('.cam-torch', el => el.getAttribute('aria-pressed')) === 'true');
    await p.click('.cam-torch'); await p.waitForTimeout(200);
    ok('ще раз → {on: false}', JSON.stringify(await p.evaluate(() => window.__t)) === '[true,false]' && await p.$eval('.cam-torch', el => el.getAttribute('aria-pressed')) === 'false');
    await p.click('.cam-torch'); await p.waitForTimeout(200); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    ok('закрили з увімкненим → {on: false}', JSON.stringify(await p.evaluate(() => window.__t)) === '[true,false,true,false]' && !(await p.$('.cam')));
    ok('без помилок JS', !errs.length, errs);
    await ctx.close();
  }
  await b.close(); console.log(`\n${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
