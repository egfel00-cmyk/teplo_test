// Лендинг глазами нового человека: первый экран (с банером cookie) и страница целиком, по темам.
// cd tests/design && NODE_PATH=$(npm root -g) node lpshots.cjs <папка> [ширины через запятую] [темы через запятую: dark,light,brass] [ru]
// RM=1 — «Зменшити рух». Сайт: SITE_BASE= SITE_DATA=/tmp/teplo_data php -S 127.0.0.1:8013 index.php
const { chromium } = require('playwright');
(async () => {
  const [out, ws = '390,1280', ths = 'dark,light,brass', lang] = process.argv.slice(2);
  const b = await chromium.launch(); const errs = [];
  for (const w of ws.split(',').map(Number)) for (const th of ths.split(',')) {
    const h = w < 600 ? 844 : 900;
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 600 ? 2 : 1, locale: lang === 'ru' ? 'ru-RU' : 'uk-UA',
      colorScheme: th === 'light' ? 'light' : 'dark', reducedMotion: process.env.RM ? 'reduce' : 'no-preference', hasTouch: w < 600, isMobile: w < 600 });
    await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(th + w + ' pageerror: ' + e.message));
    await p.goto('http://127.0.0.1:8013/');
    await p.evaluate(th => localStorage.setItem('teplo.v1', JSON.stringify({ theme: th, themeV: 3 })), th);
    await p.reload(); await p.waitForTimeout(1500);
    const tag = `${th}_${w}${lang === 'ru' ? '_ru' : ''}`;
    await p.screenshot({ path: `${out}/first_${tag}.png` });
    // согласие — банер уходит, страница целиком
    const acc = await p.$('[data-key=cc-accept]'); if (acc) { await acc.click(); await p.waitForTimeout(300); }
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/full_${tag}.png`, fullPage: true });
    await ctx.close();
  }
  if (errs.length) console.log(errs.join('\n'));
  await b.close();
})();
