// Нарахування ХТМ по місяцях («Довідка по теплу», HtmSpr, 08.11): в історії тепла — офіційна сума місяця (без «≈») і «ХТМ нарахував … Гкал»;
// у картці показань — як нарахував ХТМ (різниця, частка втрат будинку, тариф, абонплата, пільга, разом); розрахунок бере тариф, частку втрат і абонплату звідти.
// Нужен сайт 8013 (SITE_DATA с config.php, sqlite). Данные довідки кладём прямо в SITE_DATA (как робот после входа в кабинет).
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const { execFileSync } = require('child_process'); const path = require('path');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', DATA = process.env.SITE_DATA || '/tmp/teplo_data';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); const wait = ms => p.waitForTimeout(ms);
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(500);
  ok('регистрация', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'hs' + Date.now() + '@teplo.test') === 200);
  await p.evaluate(s => { s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, demo({ today: '2026-11-06' }));
  await p.reload(); await wait(2000);
  const uid = await p.evaluate(() => window.TeploSync.api('GET', '/me').then(j => j.user.id));
  // довідка: лютий і березень 2026 — поточні показання = наші записи 11.02 (11,402) і 12.03 (12,380); витрата більша за різницю (втрати будинку), тариф 1654,41
  const rows = [
    { ym: '2026-02', prev: 10.112, cur: 11.402, diff: 1.29, loss: 210.3, house: 1366.9, sHouse: 7902.8, sFlat: 56.6, flat: 2.796, cost: 4625.73, abon: 31.2, lgota: 0, paid: 1500 },
    { ym: '2026-03', prev: 11.402, cur: 12.38, diff: 0.978, loss: 150.6, house: 978.9, sHouse: 7902.8, sFlat: 56.6, flat: 2.057, cost: 3403.12, abon: 31.2, lgota: 100, paid: null }];
  execFileSync('php', ['-r', `define('TEPLO',1); require 'app/core.php'; require 'app/htmsvc.php'; HtmSpr::save(${uid}, 'main', ['rows' => json_decode('${JSON.stringify(rows)}', true), 'cols' => ['ym','flat','cost'], 'fmt' => ['ym' => '##.####', 'num' => '#,###']]);`],
    { env: Object.assign({}, process.env, { SITE_DATA: DATA, SITE_BASE: '' }), cwd: path.join(__dirname, '../..') });
  ok('GET /api/htm/spr — лише свої: 2 місяці', await p.evaluate(() => window.TeploSync.api('GET', '/htm/spr').then(j => j.places.length === 1 && j.places[0].rows.length === 2)));
  await p.goto(U + '#history'); await wait(500); await p.reload(); await wait(2500);
  const h1 = await p.textContent('[data-key=reading-r1]').catch(() => ''), h2 = await p.textContent('[data-key=reading-r2]').catch(() => ''), h3 = await p.textContent('[data-key=reading-r3]').catch(() => '');
  ok('історія (129-а): лютий — лічильник +1,290 Гкал ≈ грн, окремо «ХТМ за лютий 2026: 2,796 Гкал · 4 656,93 грн» (4625,73 + 31,20)', /\+1,290 Гкал≈/.test(h1) && /ХТМ за лютий 2026:2,796 Гкал4\s?656,93/.test(h1), h1);
  ok('…березень — 3 334 грн (3403,12 + 31,20 − пільга 100)', /ХТМ за березень 2026:2,057 Гкал3\s?334,32/.test(h2), h2);
  ok('…квітень (довідки ще немає) — наш розрахунок «≈»', /≈/.test(h3) && !/ХТМ нарахував/.test(h3), h3);
  await p.goto(U + '#rec-r1'); await wait(1500);
  const pan = await p.textContent('[data-key=rec-htm]').catch(() => '');
  // акордеон (81-ша): згорнуто, у заголовку — «Гкал · грн», стоїть після показань і фото, перед блоком платіжки; тап — розгортає
  const acc = await p.evaluate(() => { const d = document.querySelector('details[data-key=rec-htm]'); if (!d) return null; const vals = document.querySelector('[data-key=rec-values]'), nx = d.nextElementSibling;
    return { open: d.open, brief: (d.querySelector('.hacc-brief') || {}).textContent || '', afterVals: !!(vals && (vals.compareDocumentPosition(d) & 4)), next: nx ? (nx.getAttribute('data-key') || nx.className) : '', h: Math.round(d.getBoundingClientRect().height) }; });
  ok('«Нараховано ХТМ» — згорнутий акордеон (≤ 110 px), підсумок «2,796 Гкал · 4 656,93 грн», після показань, перед платіжкою', acc && !acc.open && /2,796 Гкал · 4\s?656,93 грн/.test(acc.brief) && acc.afterVals && /bill/i.test(acc.next) && acc.h <= 110, acc);
  await p.click('[data-key=rec-htm-sum]'); await wait(300);
  ok('тап по заголовку — розгорнуто, рядки розрахунку видно', await p.evaluate(() => { const d = document.querySelector('details[data-key=rec-htm]'); return d.open && d.querySelector('.hacc-b').getBoundingClientRect().height > 100; }));
  await p.locator('[data-key=rec-htm]').screenshot({ path: '/tmp/shot_hacc_open.png' }).catch(() => {});
  await p.click('[data-key=rec-htm-sum]'); await wait(200); await p.locator('[data-key=rec-htm]').screenshot({ path: '/tmp/shot_hacc.png' }).catch(() => {});
  ok('картка лютого: «Нараховано ХТМ за лютий 2026» — різниця 1,290, частка втрат 1,506 (210,3 × 56,6 / 7902,8 м²), витрата 2,796, тариф 1 654,41, абонплата, разом', /Нараховано ХТМ за лютий 2026/.test(pan)
    && /1,290 Гкал/.test(pan) && /1,506 Гкал/.test(pan) && /210,3 × 56,6 \/ 7902,8/.test(pan) && /2,796 Гкал/.test(pan) && /1\s?654,41/.test(pan) && /31,20/.test(pan) && /4\s?656,93/.test(pan), pan);
  await p.goto(U + '#rec-r3'); await wait(1500);
  const used = await p.textContent('[data-key=rec-used]').catch(() => '');
  // квітень: 0,530 Гкал; k = (1,506 + 1,079) / (1,290 + 0,978) = 1,1398…; тепло 0,530 × 1654,41 = 876,84; частка 0,530 × k × 1654,41 ≈ 999,4; абонплата 31,20
  const k = (2.796 - 1.29 + 2.057 - 0.978) / (1.29 + 0.978), exp = 0.53 * 1654.41 * (1 + k) + 31.2;
  const got = Number((used.match(/≈\s*([\d\s ]+,\d\d)/) || [])[1]?.replace(/[\s ]/g, '').replace(',', '.'));
  ok('квітень (без довідки): розрахунок як у ХТМ — тариф 1654,41, частка втрат будинку за попередні місяці, абонплата 31,20 (≈ ' + exp.toFixed(2) + ')', Math.abs(got - exp) < 0.6 && /частка будинку/.test(used) && /1\s?654,41/.test(used), [got, used]);
  // живий кабінет 08.11: показання в довідці — будинкового лічильника (різниця 45 Гкал, а квартирі нараховано 0,926) — без «частки втрат» мінусом
  const rowsB = [{ ym: '2026-02', prev: 512.1, cur: 557.3, diff: 45.2, loss: 4.1, house: 49.3, sHouse: 3012.5, sFlat: 56.6, flat: 0.926, cost: 1425.58, abon: 29.4, lgota: 0, paid: 1400 }];
  execFileSync('php', ['-r', `define('TEPLO',1); require 'app/core.php'; require 'app/htmsvc.php'; HtmSpr::save(${uid}, 'main', ['rows' => json_decode('${JSON.stringify(rowsB)}', true), 'cols' => ['ym','flat','cost'], 'fmt' => ['ym' => '##.####', 'num' => '#.#####']]);`],
    { env: Object.assign({}, process.env, { SITE_DATA: DATA, SITE_BASE: '' }), cwd: path.join(__dirname, '../..') });
  await p.goto(U + '#rec-r1'); await wait(300); await p.reload(); await wait(2500);
  const panB = await p.textContent('[data-key=rec-htm]').catch(() => '');
  ok('довідка з будинковим лічильником: «Будинковий лічильник: різниця показань 45,200», втрати й усього по будинку, площі 56,6 / 3012,5, витрата 0,926; без «Частки втрат»', /Будинковий лічильник: різниця показань/.test(panB) && /45,200 Гкал/.test(panB)
    && /49,300 Гкал/.test(panB) && /56,6 \/ 3012,5 м²/.test(panB) && /0,926 Гкал/.test(panB) && !/Частка теплових втрат/.test(panB) && !/−\d/.test(panB), panB);
  // 59-я сессия: витрата квартири = свій лічильник (журнал ХТМ «Всі записи», сервер кладе в own) + частка будинку понад нього; тут частка 20 % свого тепла
  const own = [['2025-12-12', 9.0], ['2026-01-12', 10.112], ['2026-02-11', 11.402], ['2026-03-12', 12.38]].map(([d, e]) => ({ date: d, energy: e, status: 'ok' })).concat([{ date: '2026-02-20', energy: 99.9, status: 'rejected' }]);
  const eM = { '2026-01': 1.112, '2026-02': 1.29, '2026-03': 0.978 }, rowsC = Object.keys(eM).map((ym, i) => { const fl = Math.round(eM[ym] * 1.2 * 1e5) / 1e5;
    return { ym, prev: 600 + i * 50, cur: 645.2 + i * 50, diff: 45.2, loss: 4.1, house: 49.3, sHouse: 3012.5, sFlat: 56.6, flat: fl, cost: Math.round(fl * 1539.5 * 100) / 100, abon: 29.4, lgota: 0, paid: null }; });
  execFileSync('php', ['-r', `define('TEPLO',1); require 'app/core.php'; require 'app/htmsvc.php'; HtmSpr::save(${uid}, 'main', ['rows' => json_decode('${JSON.stringify(rowsC)}', true), 'own' => json_decode('${JSON.stringify(own)}', true), 'cols' => ['ym','flat','cost'], 'fmt' => ['ym' => '##.####', 'num' => '#.#####']]);`],
    { env: Object.assign({}, process.env, { SITE_DATA: DATA, SITE_BASE: '' }), cwd: path.join(__dirname, '../..') });
  ok('GET /api/htm/spr — свій журнал (own) разом із довідкою', await p.evaluate(() => window.TeploSync.api('GET', '/htm/spr').then(j => (j.places[0].own || []).length === 5)));
  await p.goto(U + '#rec-r1'); await wait(300); await p.reload(); await wait(2500);
  const panC = await p.textContent('[data-key=rec-htm]').catch(() => ''); await p.locator('[data-key=rec-htm]').screenshot({ path: '/tmp/shot_htmspr_own.png' }).catch(() => {});
  ok('картка лютого: «Ваш лічильник за місяць» 1,290, «Частка будинку понад ваш лічильник» 0,258, витрата 1,548; відхилені показання з журналу не беремо', /Ваш лічильник за місяць/.test(panC) && /1,290 Гкал/.test(panC)
    && /Частка будинку понад ваш лічильник/.test(panC) && /0,258 Гкал/.test(panC) && /1,548 Гкал/.test(panC) && !/Частка теплових втрат/.test(panC), panC);
  ok('…і примітка: місяць, схоже, за середнім (своє + ЗБП менше, ніж нарахував ХТМ)', /за середнім/.test(panC), panC);
  await p.goto(U + '#rec-r3'); await wait(1500);
  const usedC = await p.textContent('[data-key=rec-used]').catch(() => '');
  const gotC = Number((usedC.match(/≈\s*([\d\s ]+,\d\d)/) || [])[1]?.replace(/[\s ]/g, '').replace(',', '.')), expC = (0.53 + 0.00025 * 56.6) * 1539.5 + 29.4;   // 65-я: частка 20 % свого тепла — не ЗБП (місяці за середнім), беремо лише ЗБП на м²
  ok('квітень (довідки ще немає): «частка будинку» 20 % — не ЗБП, не беремо: (своє 0,53 + ЗБП 0,00025 × 56,6) × 1539,50 + 29,40 (≈ ' + expC.toFixed(2) + ')', Math.abs(gotC - expC) < 0.6 && /частка будинку/.test(usedC), [gotC, usedC]);
  // 60-я: живой кабинет — «своє × (1 + k)» не держится (перевірка без себе ~80 %), а частка на м² — лучше; приложение выбирает основу само
  const rowsD = rowsC.map(r => { const fl = Math.round((eM[r.ym] + 0.5) * 1e5) / 1e5; return Object.assign({}, r, { flat: fl, cost: Math.round(fl * 1539.5 * 100) / 100 }); });
  execFileSync('php', ['-r', `define('TEPLO',1); require 'app/core.php'; require 'app/htmsvc.php'; HtmSpr::save(${uid}, 'main', ['rows' => json_decode('${JSON.stringify(rowsD)}', true), 'own' => json_decode('${JSON.stringify(own)}', true), 'cols' => ['ym','flat','cost'], 'fmt' => ['ym' => '##.####', 'num' => '#.#####']]);`],
    { env: Object.assign({}, process.env, { SITE_DATA: DATA, SITE_BASE: '' }), cwd: path.join(__dirname, '../..') });
  await p.goto(U + '#rec-r1'); await wait(300); await p.reload(); await wait(2500); await p.goto(U + '#rec-r3'); await wait(1500);
  const usedD = await p.textContent('[data-key=rec-used]').catch(() => '');
  const gotD = Number((usedD.match(/≈\s*([\d\s ]+,\d\d)/) || [])[1]?.replace(/[\s ]/g, '').replace(',', '.')), expD = (0.53 + 0.00025 * 56.6) * 1539.5 + 29.4;   // 65-я: 0,5 Гкал/міс на 56,6 м² — у 20 разів більше за ЗБП із квитанцій
  ok('частка будинку ~0,5 Гкал на місяць — не ЗБП (квитанції: 0,005–0,018): квітень = (0,53 + 0,00025 × 56,6) × 1539,50 + 29,40 (≈ ' + expD.toFixed(2) + ')', Math.abs(gotD - expD) < 0.6 && /частка будинку/.test(usedD), [gotD, usedD]);
  ok('без ошибок JS', !errs.length, errs);
  console.log('Итог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
