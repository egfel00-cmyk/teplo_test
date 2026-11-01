// Картинка для превью ссылки в мессенджерах (1200×630): web/og-uk.png и web/og-ru.png.
// Берёт настоящий ЖК-экран со страницы (локальный сервер должен быть запущен). Запуск: node tools_og.cjs http://127.0.0.1:8000/teplo_test/
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:8000/';
const TXT = {
  uk: { t: 'Показання тепла без відмов робота ХТМ', s: 'Підкажемо, що натискати на лічильнику, перевіримо цифри як робот ХТМ і підготуємо все для кабінету. Безкоштовно.', f: ['Харків', 'Теплолічильники', 'З 5 по 25 число'] },
  ru: { t: 'Показания тепла без отказов робота ХТМ', s: 'Подскажем, что нажимать на счётчике, проверим цифры как робот ХТМ и подготовим всё для кабинета. Бесплатно.', f: ['Харьков', 'Теплосчётчики', 'С 5 по 25 число'] },
};
(async () => {
  const br = await chromium.launch();
  const p = await br.newPage({ viewport: { width: 1200, height: 630 } });
  await p.goto(BASE); await p.waitForSelector('.lcd');
  const lcd = await p.$eval('.lcd', e => e.outerHTML);
  const css = fs.readFileSync(path.join(__dirname, 'web/src/styles.css'), 'utf8');
  for (const lang of Object.keys(TXT)) {
    const x = TXT[lang];
    await p.setContent(`<html><head><style>${css}
      :root { --font: "IBM Plex Sans", Inter, sans-serif; }
      body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #E9EEEB; font-family: var(--font); }
      .og { display: grid; grid-template-columns: 1fr 470px; gap: 56px; align-items: center; height: 630px; padding: 0 72px; box-sizing: border-box; position: relative; }
      .brand { display: flex; gap: 14px; align-items: center; font: 600 34px/1 var(--font); color: #17211E; margin-bottom: 34px; }
      h1 { font: 600 58px/1.06 var(--font); letter-spacing: -0.02em; margin: 0 0 24px; color: #17211E; }
      p { font: 400 26px/1.4 var(--font); color: #4A5652; margin: 0; max-width: none; }
      .chips { display: flex; gap: 10px; margin-top: 30px; flex-wrap: wrap; }
      .chips span { font: 600 19px/1 var(--font); padding: 10px 16px; border-radius: 999px; background: #fff; color: #17211E; }
      .dev { background: #F7F9F8; border-radius: 34px; padding: 34px 30px 38px; box-shadow: 0 24px 60px rgba(23,33,30,.16), inset 0 0 0 2px #CFD7D3; }
      .dev .lcd { margin: 0; }
      .btns { display: flex; justify-content: center; gap: 22px; margin-top: 26px; }
      .btns i { width: 52px; height: 52px; border-radius: 50%; background: #E9EEEB; box-shadow: inset 0 0 0 2px #CFD7D3; }
      .stripe { position: absolute; left: 0; right: 0; bottom: 0; height: 12px; background: linear-gradient(90deg, #D04A1D 0 50%, #2F68B0 50% 100%); }
    </style></head><body><div class="og"><div>
      <div class="brand"><svg width="46" height="46" viewBox="0 0 28 28" fill="none" stroke-width="3.2" stroke-linecap="round"><path d="M5 7h12a5 5 0 0 1 5 5" stroke="#D04A1D"/><path d="M22 16a5 5 0 0 1-5 5H5" stroke="#2F68B0"/><path d="M22 12v4" stroke="#17211E" stroke-width="2"/></svg>${lang === 'ru' ? 'Теплосервис' : 'Теплосервіс'}</div>
      <h1>${x.t}</h1><p>${x.s}</p><div class="chips">${x.f.map(c => `<span>${c}</span>`).join('')}</div></div>
      <div class="dev">${lcd}<div class="btns"><i></i><i></i></div></div><div class="stripe"></div></div></body></html>`);
    await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(__dirname, `web/og-${lang}.png`) });
    console.log('web/og-' + lang + '.png');
  }
  await br.close();
})();
