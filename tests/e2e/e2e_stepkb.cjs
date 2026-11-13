// Юзертестинг T330 (125-а, видео iPhone 12.11.2026): шаги ввода тепла.
// 1) «Дрожание»: с открытой клавиатурой высота видимой области меняется ±50 px (нижняя адресная строка iOS 26 прячется/появляется) —
//    страница не должна прокручиваться на каждое изменение; человек сам листает — не тянем назад.
// 2) Landis+Gyr: часы — отдельные экраны Bd / Fd / Pd (Pd — только для кабинета с тремя колонками), температуры чередуются на одном экране.
// 3) «Минулого разу 70751193 год» — не сравниваем, говорим, что похоже на заводской номер.
// Нужен сайт 127.0.0.1:8013 (SITE_DATA=/tmp/teplo_data). Клавиатуру iOS эмулируем подменой visualViewport.height + событием resize.
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA', hasTouch: true, isMobile: true }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const wait = ms => p.waitForTimeout(ms), txt = sel => p.textContent(sel).catch(() => '');
  const setState = async (mut) => {
    await p.evaluate(([s, mut]) => {
      const m = { modelId: 't330', unit: 'GJ' }; s.meter = m; s.places[0].meter = m;
      s.baseline = Object.assign({}, s.baseline, { date: '2026-10-20', hours: mut.badHours ? 70751193 : 34598, errHours: 330 }); s.places[0].baseline = s.baseline;
      s.readings = s.readings.map(r => r.status === 'accepted' && r.htm ? Object.assign({}, r, { htm: Object.assign({}, r.htm, { hours: mut.badHours ? 70751193 : r.htm.hours }) }) : r);
      if (mut.times3) s.meter.htmTimes = 3;
      s.draft = { date: '2026-11-12', values: {}, step: 0, source: 'manual', startedAt: new Date().toISOString() };
      s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s));
    }, [demo({ today: '2026-11-12' }), mut]);
    await p.reload(); await wait(800);
  };
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await setState({});
  // карта шагов: идём по шагам и собираем заголовки полей
  const fieldsAt = async i => { await p.goto(U + '#step-' + i); await wait(250); return p.evaluate(() => Array.from(document.querySelectorAll('[data-field]')).map(x => x.getAttribute('data-field'))); };
  const all = []; for (let i = 0; i < 9; i++) all.push((await fieldsAt(i)).join('+'));
  ok('T330 без третьей колонки: шаги в порядке экранов LOOP 1 — дата, энергия, объём, расход, мощность, часы, температуры, простой, код (Pd нет)', JSON.stringify(all) === JSON.stringify(['date', 'energy', 'volume', 'flow', 'power', 'hours', 'tSupply+tReturn', 'errHours', 'errCode']), all);
  await p.goto(U + '#step-5'); await wait(300);
  ok('…шаг «Час роботи»: табло «35611 h», без выдуманных подписей', (await p.getAttribute('#lcd-hours svg', 'aria-label', { timeout: 2000 }).catch(() => null)) === '35611' && /h/.test(await txt('#lcd-hours')));
  await p.fill('#f-hours', '17059'); await wait(150);
  ok('…ввели 17059 — на табло «17059»', (await p.getAttribute('#lcd-hours svg', 'aria-label', { timeout: 2000 }).catch(() => null)) === '17059');
  await p.goto(U + '#step-7'); await wait(300);
  ok('«час простою» пустой — кнопка «Немає на екрані — вписати 0»', !!(await p.$('[data-key=step-errhours-zero]')));
  await p.click('[data-key=step-errhours-zero]'); await wait(200);
  ok('…нажали — в поле 0, кнопка ушла, черновик сохранил 0', (await p.inputValue('#f-errHours')) === '0' && !(await p.$('[data-key=step-errhours-zero]')) && (await p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')).draft.values.errHours)) === '0');
  await p.goto(U + '#step-6'); await wait(300);
  ok('температуры — один экран, значения чередуются (класс swap, анимация)', await p.$eval('.step-lcd', el => el.classList.contains('swap') && getComputedStyle(el.querySelector('.line')).animationName === 'lcd-swap'));
  await setState({ times3: true });
  const all3 = []; for (let i = 0; i < 10; i++) all3.push((await fieldsAt(i)).join('+'));
  ok('кабинет с Bd/Fd/Pd: отдельный шаг «Pd» после простоя', JSON.stringify(all3.slice(5, 10)) === JSON.stringify(['hours', 'tSupply+tReturn', 'errHours', 'flowHours', 'errCode']), all3);
  await p.goto(U + '#step-8'); await wait(300);
  ok('…шаг Pd — подсказка про колонку «Час роботи з витратою (Pd)»', /витратою \(Pd\)/.test(await txt('.hint')), await txt('.hint'));

  // «Минулого разу 70751193 год»
  await setState({ badHours: true });
  await p.goto(U + '#step-5'); await wait(300);
  const hh = await txt('#h-hours');
  ok('прошлые часы 70751193: под полем — «схоже на заводський номер», без «Очікуємо близько 70751241»', /заводський номер/.test(hh) && !/70751241/.test(hh), hh);
  await p.fill('#f-hours', '17059'); await wait(150);
  ok('…ввели 17059 — нет «Менше за попередні (70751193)»', !/Менше за попередні/.test(await txt('#h-hours')) && !(await p.$('#fw-hours.is-block')), await txt('#h-hours'));
  await p.fill('#f-hours', '70751241'); await wait(150);
  ok('…ввели 70751241 — «стільки годин не буває»', /не буває/.test(await txt('#h-hours')), await txt('#h-hours'));

  // «дрожание»: клавиатура + адресная строка iOS 26
  await setState({});
  await p.goto(U + '#step-6'); await wait(400);
  await p.evaluate(() => { const vv = window.visualViewport; window.__H = innerHeight; Object.defineProperty(vv, 'height', { configurable: true, get: () => window.__H }); window.__scrolls = 0; const o = window.scrollBy; window.scrollBy = function () { window.__scrolls++; return o.apply(window, arguments); }; });
  await p.evaluate(() => { document.body.style.paddingBottom = '900px'; });   // есть куда листать, как на телефоне с клавиатурой
  await p.focus('#f-tSupply'); await p.evaluate(() => { window.__H = 430; window.visualViewport.dispatchEvent(new Event('resize')); }); await wait(1000);
  const s1 = await p.evaluate(() => [window.scrollY, window.__scrolls]);
  // 134-я: над шагом с клавиатурой ничего нет, не влезло — сжатие классами; прокрутка не нужна, если всё и так видно
  const vis = () => p.evaluate(() => { const r = s => { const e = document.querySelector(s); if (!e || !e.offsetParent) return null; const b = e.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom)]; };
    return { H: window.__H, top: r('.wiz-top'), f: r('[data-field]:not([type=radio])'), a: r('.wiz-actions'), c: r('.wiz-cancel'), sy: Math.round(scrollY), lv: ['kb-c1', 'kb-c2', 'kb-c3'].filter(c => document.documentElement.classList.contains(c)).join(' ') }; });
  const inView = (v, noCancel) => [v.top, v.f, v.a].concat(noCancel ? [] : [v.c]).every(x => x && x[0] >= 0 && x[1] <= v.H);
  const v6 = await vis();
  ok('клавиатура открылась (430 px): шаг, оба поля температур, «Назад/Далі» и «Скасувати» — над клавиатурой', inView(v6), v6);
  // как iOS: строка переключилась и Safari сам сдвинул страницу к полю — старый код на каждый resize крутил обратно (петля)
  await p.evaluate(async () => { const y0 = window.scrollY; window.__y0 = y0; for (let i = 0; i < 12; i++) { window.__H = i % 2 ? 480 : 430; window.scrollTo(0, y0 + (i % 2 ? 60 : 0)); window.visualViewport.dispatchEvent(new Event('resize')); await new Promise(r => setTimeout(r, 170)); } window.scrollTo(0, y0); });
  await wait(900);
  const s2 = await p.evaluate(() => [window.scrollY, window.__scrolls]);
  ok('адресная строка прячется/появляется 12 раз — страница стоит (нет петли «дрожания»)', s2[0] === s1[0] && s2[1] === s1[1], [s1, s2]);
  await p.evaluate(() => { document.dispatchEvent(new Event('touchmove')); window.scrollTo(0, 0); });
  await p.evaluate(() => { window.__H = 470; window.visualViewport.dispatchEvent(new Event('resize')); }); await wait(900);
  ok('человек сам долистал вверх — не тянем назад', await p.evaluate(() => window.scrollY) === 0);
  const f = await p.evaluate(() => { const r = document.getElementById('f-tSupply').getBoundingClientRect(); return [r.top, r.bottom]; });
  await p.evaluate(() => { window.__H = 844; window.visualViewport.dispatchEvent(new Event('resize')); }); await wait(300);
  ok('клавиатура закрылась — kb-open снят', await p.evaluate(() => !document.documentElement.classList.contains('kb-open')));
  // 134-я (видео владельца 13.11, iPhone): на «Далі»/«Назад» страница прыгала 2–3 раза за секунду — iOS ставил к верху (с плашкой квартиры), мы крутили ниже
  await p.evaluate(s => { const m = { modelId: 't330', unit: 'GJ' }; s.meter = m; s.places[0].meter = m; s.draft = { date: '2026-11-12', values: {}, step: 1, source: 'manual', startedAt: new Date().toISOString() };
    s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, demo({ today: '2026-11-12', second: true }));
  await p.reload(); await wait(600); await p.goto(U + '#step-1'); await wait(500);
  ok('две квартиры: над шагом — плашка квартиры', await p.isVisible('.place-bar'));
  const kbd = async H => { await p.evaluate(H => { const vv = window.visualViewport; if (!window.__stub) { window.__stub = 1; window.__H = innerHeight; Object.defineProperty(vv, 'height', { configurable: true, get: () => window.__H });
    window.__scrolls = 0; const o = window.scrollBy; window.scrollBy = function () { window.__scrolls++; return o.apply(window, arguments); }; document.body.style.paddingBottom = '900px'; }
    window.__H = H; vv.dispatchEvent(new Event('resize')); }, H); await wait(400); };
  await p.focus('#f-energy'); await kbd(480);
  ok('клавиатура: плашка квартиры, шапка и «Відгук» спрятаны (над шагом ничего)', !(await p.isVisible('.place-bar')) && !(await p.isVisible('header.top')) && !(await p.isVisible('.fab')));
  const v0 = await vis();
  ok('…шаг, поле, «Назад/Далі» и «Скасувати» — над клавиатурой (480 px)', inView(v0), v0);
  const next = async (sel) => { await p.evaluate(() => { window.__scrolls = 0; window.__ys = []; const t = setInterval(() => window.__ys.push(Math.round(scrollY)), 25); setTimeout(() => clearInterval(t), 1200);
    setTimeout(() => scrollTo(0, 0), 30); setTimeout(() => scrollTo(0, 0), 370); }); await p.click(sel); await wait(1300); return p.evaluate(() => [window.__ys, window.__scrolls]); };
  await p.fill('#f-energy', '213.1');
  let [ys, sc] = await next('[data-key=step-next]');
  ok('«Далі» с клавиатурой (iOS через 30 и 370 мс ставит страницу к верху): одно положение, без наших подкруток', new Set(ys).size === 1 && sc === 0, { ys: [...new Set(ys)], sc });
  const v2 = await vis();
  ok('…шаг 3 (объём): шаг, поле и все кнопки видны, фокус в поле', inView(v2) && await p.evaluate(() => document.activeElement && document.activeElement.id === 'f-volume'), v2);
  [ys, sc] = await next('[data-key=step-back]');
  ok('«Назад» — тоже одно положение', new Set(ys).size === 1 && sc === 0 && inView(await vis()), { ys: [...new Set(ys)], sc });
  // маленький телефон (SE): видимая часть 330 px — сжимаем ступенями, поле и «Назад/Далі» всё равно видны
  await kbd(330);
  await p.click('[data-key=step-next]'); await wait(700);
  const v3 = await vis();
  ok('видно 330 px: включено сжатие, поле и «Назад/Далі» над клавиатурой', !!v3.lv && inView(v3, true), v3);
  await kbd(844); await p.evaluate(() => document.activeElement && document.activeElement.blur()); await wait(200);
  ok('клавиатура закрылась — сжатие снято, плашка квартиры снова видна', !(await vis()).lv && await p.isVisible('.place-bar'));
  // «Відгук» не стрибає: прокрутка за нижній край (iOS 26 — offsetTop іде за нею) і відкрита клавіатура — без зсуву
  const nav = async (o) => p.evaluate(o => { const vv = window.visualViewport; ['height', 'offsetTop'].forEach(k => Object.defineProperty(vv, k, { configurable: true, get: () => o[k] }));
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => o.sy }); vv.dispatchEvent(new Event('scroll'));
    return getComputedStyle(document.documentElement).getPropertyValue('--nav-shift').trim(); }, o);
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  const ih = await p.evaluate(() => innerHeight), dh = await p.evaluate(() => document.documentElement.scrollHeight);
  ok('за нижнім краєм (sy > макс.) — «Відгук» на місці', (await nav({ height: ih, offsetTop: 60, sy: dh - ih + 60 })) === '0px');
  ok('клавіатура (vh 410), фокус не в полі — без зсуву вгору', (await nav({ height: 410, offsetTop: 0, sy: 0 })) === '0px');
  ok('справжнє застрягання (offsetTop 60 без прокрутки за край) — поправка є', (await nav({ height: ih, offsetTop: 60, sy: Math.max(0, dh - ih - 100) })) === '60px');
  await p.evaluate(() => { delete window.scrollY; });
  // правка запису лічильника в ГДж: енергія в ГДж (як на табло), зберегли — у Гкал
  await p.evaluate(s => { const m = { modelId: 't330', unit: 'GJ' }; s.meter = m; s.places[0].meter = m;
    s.readings.push({ id: 'rg1', place: 'main', htm: { date: '2026-11-12', energy: 50.88372, volume: 7704.98, flow: 0.582, power: 3.5, tSupply: 47.7, tReturn: 42.5, hours: 17059, errHours: 0, errCode: 'E---' }, raw: { energy: '213.040' }, unit: 'GJ', status: 'checked', createdAt: '2026-11-12T13:39:14Z', updatedAt: Date.now(), source: 'manual' });
    s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, demo({ today: '2026-11-12' }));
  await p.goto(U + '#rec-rg1-edit'); await p.reload(); await wait(800);
  ok('«Виправити» запис у ГДж: «Накопичена енергія, ГДж» = 213.040', /ГДж/.test(await txt('label[for=re-energy]')) && (await p.inputValue('#re-energy')) === '213.040', [await txt('label[for=re-energy]'), await p.inputValue('#re-energy').catch(() => '')]);
  await p.fill('#re-energy', '213.100'); await p.click('[data-key=rec-save]'); await wait(500);
  const rg = await p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')).readings.find(r => r.id === 'rg1'));
  ok('…зберегли 213.100 ГДж → у записі 50.898 Гкал, raw 213.100', Math.abs(rg.htm.energy - 50.898) < 0.001 && rg.raw.energy === '213.100', rg);
  ok('без ошибок JS', !errs.length, errs);
  await b.close();
  console.log(`\nИтог: ${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})();
