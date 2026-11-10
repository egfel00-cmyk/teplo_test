// Телефон с плашками лічильників с лендинга — прозрачным PNG (2x) для промо-картинок.
// Сайт: SITE_BASE= SITE_DATA=/tmp/teplo_data php -S 127.0.0.1:8013 index.php ; NODE_PATH=$(npm root -g) node stage.cjs out.png
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] || 'stage.png';
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, locale: 'uk-UA', reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:8013/#welcome'); await p.waitForTimeout(1500);
  await p.addStyleTag({ content: `html, body, .lp, .lp .lp-plate { background: transparent !important; box-shadow: none !important; }
    .lp .lp-plate::before, .lp-screw, .lp-copy, header, .top, .fb-fab, [data-key="feedback"], .lp-sec, .lp-end, .lp-foot, .lp-fine { visibility: hidden !important; }
    .lp-stage, .lp-stage * { visibility: visible !important; } *, *::before, *::after { animation: none !important; transition: none !important; }` });
  await p.evaluate(() => document.querySelectorAll('body *').forEach(e => { if (!e.closest('.lp-stage') && !e.querySelector('.lp-stage')) e.style.visibility = 'hidden'; }));
  await p.waitForTimeout(400);
  const r = await p.locator('.lp-stage').boundingBox();
  const m = 48;
  await p.screenshot({ path: out, omitBackground: true, clip: { x: r.x - m, y: r.y - m, width: r.width + 2 * m, height: r.height + 2 * m } });
  console.log(JSON.stringify(r));
  await b.close();
})();
