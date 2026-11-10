// Сторінка лічильника — один шаблон для всіх (03.11.2026): «Налаштування лічильника» в блоці, та сама ссилка на квартиру,
// «Куди передати» — акордеон, табло — останні прийняті / передані за статусами історії.
// node e2e_meterpage.cjs  (локальний сервер 127.0.0.1:8013)
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch(); const p = await (await require('./pvopen.cjs').ctx(b, { viewport: { width: 390, height: 844 }, locale: 'uk-UA' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(U); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo({ elec: true, gas: true }));
  const open = async (r) => { await p.goto(U + '#' + r); await p.reload(); await p.waitForTimeout(500); };
  const info = () => p.evaluate(() => ({
    set: !!document.querySelector('.mbox .mbox-set'), setOpen: !!document.querySelector('.mbox .mbox-set[open]'),
    price: !!document.querySelector('.mbox .mbox-set #mp-heat, .mbox .mbox-set #mp-ws, .mbox .mbox-set #mp-ep, .mbox .mbox-set #g-price'), setTitle: (document.querySelector('.mbox .mbox-set > summary') || {}).textContent || '',
    place: !!document.querySelector('.mbox-links a[href^="#place-"]'), toPrefs: !!document.querySelector('.mbox-links a[href="#prefs"]'),
    wacc: (() => { const d = document.querySelector('details.wacc'); return d ? (d.open ? 'open' : 'closed') : 'none'; })(),
    cap: (document.querySelector('.mbox .lcd-cap') || {}).textContent || '', box: (document.querySelector('.mbox') || {}).textContent || '' }));
  const all = {};
  for (const r of ['heat', 'water-hot', 'water-cold', 'elec', 'gas']) { await open(r); all[r] = await info(); }
  // владелец 05.11 21:35: «верни аккордеон» — «Налаштування лічильника» (номери, ціна) знову на сторінці лічильника, згорнуті; посилання на квартиру — ні
  ok('у всіх 5 лічильників на сторінці — згорнуті «Налаштування показань» (рахунки, №, ціна); без посилання на квартиру',
    Object.values(all).every(x => x.set && !x.setOpen && x.price && /Налаштування показань/.test(x.setTitle) && !x.place && !x.toPrefs), all);
  await open('place-main');
  ok('екран квартири: у кожного з 5 лічильників — свої «Налаштування лічильника»', (await p.$$('#pg-pv-meters details.mrow-set')).length === 5);
  ok('«Куди передати» — акордеон, закритий', Object.values(all).every(x => x.wacc === 'closed'), Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.wacc])));
  ok('тепло: без «Інструкція перевірена» і «Звірити в кабінеті ХТМ»', !/Інструкція перевірена|Звірити в кабінеті/.test(all.heat.box), all.heat.box.slice(0, 200));
  ok('тепло: останні прийняті — найпізніше «прийнято» з історії (10 квітня 2026), а не «Останні прийняті» з кабінету (10 грудня 2025)', /10 квітня 2026/.test(all.heat.cap), all.heat.cap);
  ok('світло: останні передані 1 жовтня, новіший 31 жовтня — «ще не передано»', /Передано 1 жовтня 2026/.test(all.elec.cap) && /31 жовтня 2026, ще не передано/.test(all.elec.box), all.elec.cap);
  await open('heat'); await p.click('details.wacc > summary'); await p.waitForTimeout(200);
  ok('тап по «Куди передати» — розкривається (кабінет ХТМ усередині)', await p.$eval('details.wacc', d => d.open) && !!(await p.$('[data-key=dest-htm-heat-cab]')));
  await p.evaluate(() => { location.hash = '#history'; }); await p.waitForTimeout(300); await p.evaluate(() => { location.hash = '#heat'; }); await p.waitForTimeout(400);
  ok('…і лишається відкритим, коли повернулись на сторінку', await p.$eval('details.wacc', d => d.open));
  // перевірка «як робот ХТМ» бере ті ж останні прийняті (а не старі з кабінету)
  const prevE = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); return s.baseline.energy; });
  ok('дані не змінені: «Останні прийняті» з кабінету лишились як були', prevE === '9.001', prevE);
  ok('без помилок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
