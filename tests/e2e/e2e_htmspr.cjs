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
  ok('історія: лютий — офіційно 4 657 грн (4625,73 + 31,20), без «≈», «ХТМ нарахував 2,796 Гкал»', /4\s?657/.test(h1) && !/≈/.test(h1) && /ХТМ нарахував 2,796 Гкал/.test(h1), h1);
  ok('…березень — 3 334 грн (3403,12 + 31,20 − пільга 100)', /3\s?334/.test(h2) && /ХТМ нарахував 2,057 Гкал/.test(h2), h2);
  ok('…квітень (довідки ще немає) — наш розрахунок «≈»', /≈/.test(h3) && !/ХТМ нарахував/.test(h3), h3);
  await p.goto(U + '#rec-r1'); await wait(1500);
  const pan = await p.textContent('[data-key=rec-htm]').catch(() => '');
  ok('картка лютого: «Нараховано ХТМ за лютий 2026» — різниця 1,290, частка втрат 1,506 (210,3 × 56,6 / 7902,8 м²), витрата 2,796, тариф 1 654,41, абонплата, разом', /Нараховано ХТМ за лютий 2026/.test(pan)
    && /1,290 Гкал/.test(pan) && /1,506 Гкал/.test(pan) && /210,3 × 56,6 \/ 7902,8/.test(pan) && /2,796 Гкал/.test(pan) && /1\s?654,41/.test(pan) && /31,20/.test(pan) && /4\s?656,93/.test(pan), pan);
  await p.goto(U + '#rec-r3'); await wait(1500);
  const used = await p.textContent('[data-key=rec-used]').catch(() => '');
  // квітень: 0,530 Гкал; k = (1,506 + 1,079) / (1,290 + 0,978) = 1,1398…; тепло 0,530 × 1654,41 = 876,84; частка 0,530 × k × 1654,41 ≈ 999,4; абонплата 31,20
  const k = (2.796 - 1.29 + 2.057 - 0.978) / (1.29 + 0.978), exp = 0.53 * 1654.41 * (1 + k) + 31.2;
  const got = Number((used.match(/≈\s*([\d\s ]+,\d\d)/) || [])[1]?.replace(/[\s ]/g, '').replace(',', '.'));
  ok('квітень (без довідки): розрахунок як у ХТМ — тариф 1654,41, частка втрат будинку за попередні місяці, абонплата 31,20 (≈ ' + exp.toFixed(2) + ')', Math.abs(got - exp) < 0.6 && /частка будинку/.test(used) && /1\s?654,41/.test(used), [got, used]);
  ok('без ошибок JS', !errs.length, errs);
  console.log('Итог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
