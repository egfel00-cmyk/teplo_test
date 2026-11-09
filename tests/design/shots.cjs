// Скрины для дизайн-аудита: cd tests/design && NODE_PATH=$(npm root -g) node shots.cjs <папка> <ширина> <тёмная 0|1> <demo JSON|none> route|клик;клик ...
// RM=1 — prefers-reduced-motion (лендинг целиком). Сайт: SITE_BASE= SITE_DATA=/tmp/teplo_data php -S 127.0.0.1:8013 index.php
const { chromium } = require('playwright');
const demo = require('../e2e/demo.cjs');
(async () => {
  const [out, w, dark, dj, ...routes] = process.argv.slice(2);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: +w, height: +w < 600 ? 844 : 900 }, deviceScaleFactor: 1, colorScheme: dark === '1' ? 'dark' : 'light', locale: 'uk-UA', reducedMotion: process.env.RM ? 'reduce' : 'no-preference' });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto('http://127.0.0.1:8013/');
  if (dj !== 'none') await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo(JSON.parse(dj)));
  for (const r of routes) {
    const [route, clicks] = r.split('|');
    await p.goto('http://127.0.0.1:8013/#' + route); await p.reload(); await p.waitForTimeout(900);
    for (const c of (clicks ? clicks.split(';') : [])) { try { await p.click(c, { timeout: 2000 }); } catch (e) { errs.push('click ' + c); } await p.waitForTimeout(400); }
    const name = (route + (clicks ? '_' + clicks.replace(/[^a-z0-9]+/gi, '') : '')).replace(/[^a-z0-9_-]/gi, '_');
    await p.screenshot({ path: `${out}/${name}_${w}${dark === '1' ? 'd' : ''}.png`, fullPage: true });
  }
  if (errs.length) console.log(errs.join('\n'));
  await b.close();
})();
