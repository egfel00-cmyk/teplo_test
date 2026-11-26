// 191-а: попередження про затверджений новий тариф (власник 26.11: «предупреждал про обновление тарифов и подкреплял документами»).
// Харків, вода з 01.01.2027 — 57,504 / 27,992 (рішення виконкому від 12.11.2026): за 45 днів — банер під квартирою на головній з підставою,
// «Зрозуміло» ховає; раніше 45 днів, своя ціна, без водоміра — банера немає; у «Постачальниках» — підстава під «З 1 січня…».
// Нужен сайт 127.0.0.1:8013 (SITE_DATA=/tmp/teplo_data). node tests/e2e/e2e_tariff.cjs
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const txt = sel => p.textContent(sel).then(s => String(s || '').replace(/\s+/g, ' ').trim()).catch(() => '');
  const put = async (s, route) => { await p.goto(U + 'api/health'); await p.evaluate(x => localStorage.setItem('teplo.v1', JSON.stringify(x)), s); await p.goto(U + '#' + route); await p.waitForTimeout(1600); };
  const st = (today, f) => { const s = demo({ today }); s.places[0].address = 'вул. Сумська, 10, кв. 12'; if (f) f(s); return s; };
  const B = '[data-key="tar-main:water:2027-01-01"]';
  await put(st('2026-11-26'), 'home');
  const t1 = await txt(B);
  ok('26.11: банер «З 1 січня 2027 дорожчає вода», Харківводоканал, 48,63 → 57,50 ₴/м³ (+18 %), водовідведення 20,61 → 27,99 (+36 %)',
    /З 1 січня 2027 дорожчає вода/.test(t1) && /Харківводоканал/.test(t1) && /48,63 → 57,50 ₴\/м³ \+18 %/.test(t1) && /20,61 → 27,99 ₴\/м³ \+36 %/.test(t1), t1);
  ok('…підстава: рішення виконкому Харківської міської ради від 12.11.2026', /Підстава: рішення виконкому Харківської міської ради від 12\.11\.2026/.test(t1), t1);
  ok('…під шапкою квартири, над картками лічильників', await p.evaluate(b => { const a = document.querySelector(b), c = document.querySelector('.ucards'); return !!a && !!c && !!(a.compareDocumentPosition(c) & 4); }, B));
  await p.click('[data-key="tar-ok-water"]'); await p.waitForTimeout(500);
  ok('«Зрозуміло» — банер зник і не повертається після перезавантаження', !(await p.$(B)) && await p.reload().then(() => p.waitForTimeout(1200)).then(() => p.$(B)).then(x => !x)
    && await p.evaluate(() => !!(JSON.parse(localStorage.getItem('teplo.v1')).tarSeen || {})['main:water:2027-01-01']));
  await put(st('2026-11-10'), 'home');
  ok('10.11 (раніше 45 днів) — банера немає', !(await p.$(B)));
  await put(st('2026-11-26', s => { s.places[0].prov = { water: { supply: '50', drain: '21' } }; }), 'home');
  ok('своя ціна з платіжки — банера немає', !(await p.$(B)));
  await put(st('2026-11-26', s => { s.places[0].water.meters = []; }), 'home');
  ok('без водоміра — банера немає', !(await p.$(B)));
  await put(st('2026-11-26'), 'pvp-water-main');
  const pv = await txt('[data-key="prov-next-doc-water"]');
  ok('екран постачальника води: під «З 1 січня 2027 — …» — підстава наступного тарифу', /рішення виконкому Харківської міської ради від 12\.11\.2026/.test(pv), pv);
  ok('без помилок JS', !errs.length, errs);
  await b.close(); console.log(`\n${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})();
