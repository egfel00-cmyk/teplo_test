// Ролик «живого» телефона лендинга для владельца: кадры цикла (seek, детерминированно) → PNG → ffmpeg.
// cd tests/design && NODE_PATH=$(npm root -g) node lpvideo.cjs <папка> [тема] [fps]
const { chromium } = require('playwright');
(async () => {
  const [out, th = 'dark', fps = '20'] = process.argv.slice(2);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'uk-UA', colorScheme: th === 'light' ? 'light' : 'dark' });
  await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:8013/');
  await p.evaluate(th => { localStorage.setItem('teplo.v1', JSON.stringify({ theme: th, themeV: 3 })); localStorage.setItem('teplo.fx', 'full'); localStorage.setItem('teplo.cc', JSON.stringify({ v: 1, a: 0, at: new Date().toISOString(), id: 'x' })); }, th);
  await p.reload(); await p.waitForTimeout(1500);
  await p.evaluate(() => { const s = document.querySelector('.lp-hero'); window.scrollTo(0, s.getBoundingClientRect().top + scrollY + s.offsetHeight - innerHeight); }); await p.waitForTimeout(600);
  const n = 12000 / (1000 / +fps);
  for (let i = 0; i < n; i++) {
    await p.evaluate(t => TeploLpDemo.seek(t), Math.round(i * 1000 / +fps));
    await p.screenshot({ path: `${out}/v_${String(i).padStart(4, '0')}.png` });
  }
  await b.close();
})();
