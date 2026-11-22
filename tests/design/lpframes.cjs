// Раскадровка «живого» телефона лендинга (175-я): кадры цикла по времени → PNG телефона.
// cd tests/design && NODE_PATH=$(npm root -g) node lpframes.cjs <папка> [тема dark|light|brass] [мс через запятую] [ru]
const { chromium } = require('playwright');
(async () => {
  const [out, th = 'dark', ts = '600,2500,3300,4100,4900,5800,6700,7700,8500,9500,10400,11300', lang] = process.argv.slice(2);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: lang === 'ru' ? 'ru-RU' : 'uk-UA', colorScheme: th === 'light' ? 'light' : 'dark' });
  await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto('http://127.0.0.1:8013/');
  await p.evaluate(th => { localStorage.setItem('teplo.v1', JSON.stringify({ theme: th, themeV: 3 })); localStorage.setItem('teplo.fx', 'full'); localStorage.setItem('teplo.cc', JSON.stringify({ v: 1, a: 0, at: new Date().toISOString(), id: 'x' })); }, th);
  await p.reload(); await p.waitForTimeout(1200);
  await p.evaluate(() => document.querySelector('.lp-phone').scrollIntoView({ block: 'center' })); await p.waitForTimeout(800);
  const run = await p.evaluate(() => window.TeploLpDemo && TeploLpDemo.running());
  console.log('running', run);
  for (const t of ts.split(',').map(Number)) {
    await p.evaluate(t => TeploLpDemo.seek(t), t); await p.waitForTimeout(120);
    await (await p.$('.lp-phone')).screenshot({ path: `${out}/f_${th}_${String(t).padStart(5, '0')}.png` });
  }
  if (errs.length) console.log(errs.join('\n'));
  await b.close();
})();
