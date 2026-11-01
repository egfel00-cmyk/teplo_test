const { chromium } = require('playwright'); const cases = require('./cases.json');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1000, height: 1300 } });
  await p.goto('file://' + __dirname + '/gen.html'); await p.evaluate(() => document.fonts.ready);
  for (const c of cases) { await p.evaluate(c => window.setCase(c), c); await p.waitForTimeout(150); await p.screenshot({ path: __dirname + '/' + c.id + '.jpg', type: 'jpeg', quality: 80 }); }
  await b.close(); })();
