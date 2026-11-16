// 165-я: скрини варіантів світлої теми (?skin=la|lb|lc) — 390 @2x, однакова висота, для колажу «як зараз / A / B / C».
// cd tests/design && NODE_PATH=$(npm root -g) node lskin.cjs /tmp/lskin [la,lb,lc] [home,water-cold,history,prefs]
// Сайт: SITE_BASE= SITE_DATA=/tmp/teplo_data php -S 127.0.0.1:8013 index.php
const { chromium } = require('playwright');
const demo = require('../e2e/demo.cjs');
(async () => {
  const out = process.argv[2] || '/tmp/lskin';
  const skins = (process.argv[3] || 'off,la,lb,lc').split(',');
  const routes = (process.argv[4] || 'home,water-cold,history,prefs').split(',');
  const H = +(process.env.H || 1100);
  const dj = process.env.DEMO || '{"second":true,"garage":"own","elec":true,"gas":true}';
  const b = await chromium.launch();
  const errs = [];
  for (const sk of skins) {
    const ctx = await b.newContext({ viewport: { width: 390, height: H }, deviceScaleFactor: 2, colorScheme: 'light', locale: 'uk-UA', reducedMotion: 'reduce' });
    await ctx.addInitScript(() => { try { localStorage.setItem('teplo.cc', JSON.stringify({ v: 1, a: false, at: Date.now(), id: 'x' })); } catch (e) {} });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(sk + ': ' + e.message));
    await p.goto('http://127.0.0.1:8013/?skin=' + sk);
    await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo(JSON.parse(dj)));
    for (const r of routes) {
      await p.goto('http://127.0.0.1:8013/#' + r); await p.reload(); await p.waitForTimeout(1000);
      await p.screenshot({ path: `${out}/${sk}_${r}.png`, clip: { x: 0, y: 0, width: 390, height: H } });
    }
    await ctx.close();
  }
  if (errs.length) console.log(errs.join('\n'));
  await b.close();
})();
