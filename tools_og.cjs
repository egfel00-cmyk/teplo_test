// Картинка для превью ссылки в мессенджерах и соцсетях (1200×630): web/og-uk-5.jpg и web/og-ru-5.jpg.
// Снимает настоящий первый экран лендинга (телефон + четыре табло: тепло, вода, світло, газ), подставляет короткий текст и адрес сайта.
// Локальный сервер должен быть запущен: SITE_BASE= SITE_DATA=/tmp/teplo_data php -S 127.0.0.1:8013 index.php
// Запуск: NODE_PATH=$(npm root -g) node tools_og.cjs [http://127.0.0.1:8013/] [peredai.com.ua]
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:8013/';
const DOMAIN = process.argv[3] || 'peredai.com.ua';
const TXT = {
  uk: { locale: 'uk-UA', lead: 'Тепло, вода, світло й газ: сфотографуйте — цифри розпізнаються самі. Підкажемо, куди й до якого числа передати.', badge: 'Безкоштовно — Харківщина, Київщина, Одещина, Львівщина' },
  ru: { locale: 'ru-RU', lead: 'Тепло, вода, свет и газ: сфотографируйте — цифры распознаются сами. Подскажем, куда и до какого числа передать.', badge: 'Бесплатно — Харьковщина, Киевщина, Одесщина, Львовщина' },
};
(async () => {
  const br = await chromium.launch();
  for (const lang of Object.keys(TXT)) {
    const x = TXT[lang];
    const ctx = await br.newContext({ viewport: { width: 1200, height: 630 }, locale: x.locale, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await ctx.addInitScript(() => { try { localStorage.setItem('teplo.v1', JSON.stringify({ v: 1, theme: 'light' })); } catch (e) {} });
    const p = await ctx.newPage();
    await p.route('**/api/events', r => r.abort());
    await p.goto(BASE); await p.waitForSelector('.lp-hero'); await p.waitForTimeout(1500);
    await p.evaluate(({ x, domain }) => {
      document.querySelectorAll('.top, .fab, .lp-ctas, .lp-trust, .lp-link, .lp-hero ~ *').forEach(e => e.style.display = 'none');
      const h = document.querySelector('.lp-hero');
      Object.assign(h.style, { margin: '0', borderRadius: '0', width: '1200px', height: '630px', minHeight: '0', boxSizing: 'border-box' });
      document.querySelector('.lp-badge').lastChild.textContent = x.badge;
      document.querySelector('.lp-lead').textContent = x.lead;
      const d = document.createElement('p'); d.textContent = domain;
      Object.assign(d.style, { margin: '26px 0 0', font: '600 30px/1 var(--font, sans-serif)', color: '#fff', letterSpacing: '.01em' });
      document.querySelector('.lp-copy').appendChild(d);
      window.scrollTo(0, 0);
      const r = h.getBoundingClientRect(); window.scrollBy(0, r.top);
    }, { x, domain: DOMAIN });
    await p.waitForTimeout(600);
    const box = await (await p.$('.lp-hero')).boundingBox();
    const out = path.join(__dirname, `web/og-${lang}-5.jpg`);
    await p.screenshot({ path: out, type: 'jpeg', quality: 86, clip: { x: box.x, y: box.y, width: 1200, height: 630 } });
    console.log(out, Math.round(box.width) + '×' + Math.round(box.height));
    await ctx.close();
  }
  await br.close();
})();
