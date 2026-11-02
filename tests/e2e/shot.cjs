// node shot.cjs '<json opts>' route1 route2 ... → /tmp/shot_<route>.png (мобильный экран)
const { chromium } = require('playwright');
const demo = require('./demo.cjs');
(async () => {
  const opts = JSON.parse(process.argv[2] || '{}'), routes = process.argv.slice(3);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: opts.w || 390, height: opts.h || 844 }, deviceScaleFactor: 1, colorScheme: opts.dark ? 'dark' : 'light' });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto('http://127.0.0.1:8013/'); 
  await p.evaluate(s => { localStorage.setItem('teplo.v1', JSON.stringify(s)); }, demo(opts));
  for (const r of routes) {
    const [route, clicks] = r.split('|');
    await p.goto('http://127.0.0.1:8013/#' + route); await p.reload(); await p.waitForTimeout(700);
    for (const c of (clicks ? clicks.split(';') : [])) { await p.click(c); await p.waitForTimeout(400); }
    const name = (route + (clicks ? '_' + clicks.replace(/[^a-z0-9]+/gi, '') : '')).replace(/[^a-z0-9_-]/gi, '_');
    await p.screenshot({ path: '/tmp/shot_' + name + '.png', fullPage: !!opts.full });
    console.log('saved /tmp/shot_' + name + '.png');
  }
  if (errs.length) console.log(errs.join('\n'));
  await b.close();
})();
