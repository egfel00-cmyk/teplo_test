// 147-а (власник 14.11, 12:33): «Інший постачальник» і пошук постачальника в довіднику — поле зі списком у «Кому платите»:
// писати або гортати; назва або місто; список звужується з кожною літерою; обраний — у «Куди передати»; «Як за адресою квартири» — повернути.
// cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_pcat.cjs
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : '')); } };
const B = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(B); await p.evaluate(s => { localStorage.clear(); localStorage.setItem('teplo.v1', JSON.stringify(s)); localStorage.setItem('teplo.cc', JSON.stringify({ v: 1, a: 0, at: new Date().toISOString(), id: 'x' })); }, demo({ elec: true }));
  await p.goto('about:blank'); await p.goto(B + '#elec'); await p.waitForTimeout(800);
  const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')));
  ok('посилання під «Куди передати» — «Інший постачальник»', /^Інший постачальник$/.test((await p.textContent('[data-key="my-link-elec"]').catch(() => '')).trim()));
  await p.evaluate(() => { const f = document.querySelector('#my-elec'); let d = f && f.closest('details'); while (d) { d.open = true; d = d.parentElement && d.parentElement.closest('details'); } });
  await p.waitForTimeout(200);
  ok('у «Кому платите» — поле пошуку «Назва постачальника або місто»', /Назва постачальника або місто/.test(await p.getAttribute('#pcat-elec', 'placeholder').catch(() => '')));
  await p.focus('#pcat-elec'); await p.waitForTimeout(900);
  const all = await p.$$eval('#pcat-elec-l [role=option]', es => es.map(e => e.textContent));
  ok('фокус — список усіх постачальників світла (гортати), 6 областей', all.length === 6 && all.some(x => /Львівенергозбут/.test(x)) && all.some(x => /YASNO/.test(x)), all);
  await p.type('#pcat-elec', 'буч', { delay: 30 }); await p.waitForTimeout(200);
  const bu = await p.$$eval('#pcat-elec-l [role=option]', es => es.map(e => e.textContent));
  ok('«буч» — за містом: Київська обласна енергопостачальна, підпис «Буча»', bu.length === 1 && /Київська обласна/.test(bu[0]) && /Буча/.test(bu[0]), bu);
  await p.fill('#pcat-elec', 'львов'); await p.waitForTimeout(200);
  const lv = await p.$$eval('#pcat-elec-l [role=option]', es => es.map(e => e.textContent));
  ok('«львов» (рос.) → Львівенергозбут першим', lv.length >= 1 && /Львівенергозбут/.test(lv[0]), lv);
  await p.fill('#pcat-elec', 'qqqzzz'); await p.waitForTimeout(150);
  ok('нічого не знайшли — підказка про «Інший постачальник»', /Нікого не знайшли/.test(await p.textContent('#pcat-elec-l')));
  await p.fill('#pcat-elec', 'львів'); await p.waitForTimeout(150);
  await p.keyboard.press('Enter'); await p.waitForTimeout(900);
  let s = await st(), pr = s.places[0].prov && s.places[0].prov.elec;
  ok('Enter — обрано Львівенергозбут: prov.elec.sel, own = 0', pr && pr.sel && /Львівенергозбут/.test(pr.sel.o) && !pr.own && pr.sel.n && pr.sel.h, pr);
  ok('«Куди передати» — тепер Львівенергозбут', /Львівенергозбут/.test(await p.textContent('[data-key="where-elec"]').catch(() => '')));
  await p.evaluate(() => { const f = document.querySelector('#my-elec'); let d = f && f.closest('details'); while (d) { d.open = true; d = d.parentElement && d.parentElement.closest('details'); } });
  ok('варіант «з довідника» — назва обраного й «обрали самі»', /Львівенергозбут/.test(await p.textContent('[data-key="my-elec-0"]').catch(() => '') || await p.textContent('#my-elec')) && /обрали самі/.test(await p.textContent('#my-elec')));
  await p.click('[data-key="pcat-off-elec"]'); await p.waitForTimeout(500); s = await st();
  ok('«Як за адресою квартири» — вибір прибрано', !(s.places[0].prov.elec || {}).sel);
  // вода: вибір мишею зі списку
  await p.goto(B + '#water-cold'); await p.waitForTimeout(700);
  await p.evaluate(() => { const f = document.querySelector('#my-water'); let d = f && f.closest('details'); while (d) { d.open = true; d = d.parentElement && d.parentElement.closest('details'); } });
  await p.click('#pcat-water'); await p.waitForTimeout(900); await p.type('#pcat-water', 'буча', { delay: 20 }); await p.waitForTimeout(200);
  await p.click('#pcat-water-l [role=option] >> nth=0'); await p.waitForTimeout(800); s = await st();
  ok('вода: «буча» → дотик — Бучасервіс', /Бучасервіс/.test(((s.places[0].prov || {}).water || {}).sel && s.places[0].prov.water.sel.o), (s.places[0].prov || {}).water);
  ok('без помилок JS', !errs.length, errs);
  await b.close(); console.log(`\n${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})();
