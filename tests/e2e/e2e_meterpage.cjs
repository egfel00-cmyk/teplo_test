// Сторінка лічильника — один шаблон для всіх (03.11.2026): «Налаштування лічильника» в блоці, та сама ссилка на квартиру,
// «Куди передати» — акордеон, табло — останні внесені, підпис — їхній статус (148-а; раніше — останні прийняті / передані).
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
    cap: (document.querySelector('.mbox .lcd-cap') || {}).textContent || '', box: (document.querySelector('.mbox') || {}).textContent || '',
    lcd: Array.prototype.map.call(document.querySelectorAll('.mbox .lcd .line[data-v]'), function (l) { return l.getAttribute('data-v'); }).join(' · ') }));
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
  // 148-а (власник 14.11, скрин «ГК Победа»: «ввёл новые показания — на табло старые с прошлого раза, исправь везде»): табло — останні внесені
  // (31 жовтня: 10420 / 5225), підпис — їхній статус одним рядком; окремого рядка «Внесено …» під ним, як і раніше, немає
  ok('світло: табло — останні внесені 31 жовтня (10420 · 5225), підпис «Внесено 31 жовтня 2026, ще не передано»; другого рядка немає',
    /^Внесено 31 жовтня 2026, ще не передано$/.test(all.elec.cap.trim()) && all.elec.lcd === '10420 · 5225' && (all.elec.box.match(/Внесено/g) || []).length === 1, [all.elec.cap, all.elec.lcd]);
  await open('heat'); await p.click('details.wacc > summary'); await p.waitForTimeout(200);
  ok('тап по «Куди передати» — розкривається (кабінет ХТМ усередині)', await p.$eval('details.wacc', d => d.open) && !!(await p.$('[data-key=dest-htm-heat-cab]')));
  await p.evaluate(() => { location.hash = '#history'; }); await p.waitForTimeout(300); await p.evaluate(() => { location.hash = '#heat'; }); await p.waitForTimeout(400);
  ok('…і лишається відкритим, коли повернулись на сторінку', await p.$eval('details.wacc', d => d.open));
  // перевірка «як робот ХТМ» бере ті ж останні прийняті (а не старі з кабінету)
  const prevE = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); return s.baseline.energy; });
  ok('дані не змінені: «Останні прийняті» з кабінету лишились як були', prevE === '9.001', prevE);
  // 148-а, як у власника (скрин «ГК Победа», 14.11 13:21): оплачено 2263 (12.09.2025), внесено нові 2575 (14.11.2026), ще не оплачено —
  // табло й картка головної — 2575, підпис «Внесено 14 листопада 2026, ще не оплачено»; оплатив — «Оплачено …» з тими ж 2575
  {
    const d = demo({ garage: 'own1', atGarage: true });
    d.mrecs = d.mrecs.filter(r => r.place !== 'gar').concat([
      { id: 'gp1', place: 'gar', meter: 'eg', kind: 'elec', date: '2025-09-12', z: { all: '2263' }, base: false, sent: { obl: '2025-09-12' }, createdAt: '2025-09-12T10:00:00Z', updatedAt: 1 },
      { id: 'gp2', place: 'gar', meter: 'eg', kind: 'elec', date: '2026-11-14', z: { all: '2575' }, base: false, sent: {}, createdAt: '2026-11-14T10:00:00Z', updatedAt: 1 }]);
    await p.goto(U); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), d);
    await open('elec'); const g = await info();
    ok('гараж зі своїм постачальником: табло — нові 2575, підпис «Внесено 14 листопада 2026, ще не оплачено»', g.lcd === '2575' && /^Внесено 14 листопада 2026, ще не оплачено$/.test(g.cap.trim()), [g.lcd, g.cap]);
    await open('home'); const hv = await p.evaluate(() => Array.prototype.map.call(document.querySelectorAll('.ucard .lcd .line[data-v]'), l => l.getAttribute('data-v')).join(','));
    ok('картка головної — теж 2575', /(^|,)2575(,|$)/.test(hv), hv);
    d.mrecs.find(r => r.id === 'gp2').sent = { obl: '2026-11-14' };
    await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), d);
    await open('elec'); const g2 = await info();
    ok('оплатив — «Оплачено 14 листопада 2026», табло 2575', g2.lcd === '2575' && /^Оплачено 14 листопада 2026$/.test(g2.cap.trim()), [g2.lcd, g2.cap]);
    // 148-а (власник 13:35, скрин: «текст „Гараж № 141: показання 2263–2575, набігло 312 кВт·год, … грн, за жовтень 2026“ — і в блоці „куди платити“, для всіх своїх»)
    const pb = await p.evaluate(() => { const d = document.querySelector('details.mypay'); return d ? { purp: ((d.querySelector('[data-key="my-r-purp"]') || {}).textContent || ''),
      sum: !!d.querySelector('[data-key="my-sum"]'), paid: !!d.querySelector('.mypay-st'), all: ((d.querySelector('[data-key="my-copy-all"]') || { getAttribute: () => '' }).getAttribute('data-text') || '') } : null; });
    ok('оплачено: у «ГК Победа» лишається призначення (2263–2575, набігло 312), без «До сплати», «Оплачено» в шапці; «Скопіювати реквізити» — з призначенням',
      pb && /№ 141/.test(pb.purp) && /2263–2575/.test(pb.purp) && /312/.test(pb.purp) && !pb.sum && pb.paid && (pb.all === '' || /2263–2575/.test(pb.all)), pb);
  }
  ok('без помилок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
