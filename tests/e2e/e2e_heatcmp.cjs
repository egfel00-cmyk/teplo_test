// 130-а (власник 13.11: «чому з 20 листопада до 20 лютого — між ними ж були показання», «чому по лічильнику й у ХТМ різні суми», «Гкал — зрозуміло, що для опалення»):
// рядки й картка тепла — від попередніх показань (і «для себе»), «від передачі» — підписом; ремонт у періоді — словами; сезон: «Лічильник» з поділом осінніх показань,
// «ХТМ» з перерахунками, «Чому не збігається»; легенда «Гкал — тепло на опалення»; без «введено вручну». Сайт 8013 (sqlite).
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const { execFileSync } = require('child_process'); const path = require('path');
const U = 'http://127.0.0.1:8013/', DATA = process.env.SITE_DATA || '/tmp/teplo_data', theme = 'light';
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA', colorScheme: theme })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(1200);
  await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678'), 'own' + Date.now() + '@teplo.test');
  const s = demo({ view: 'heat', today: '2026-11-13' });
  const R = (id, d, e, st, own) => ({ id, place: 'main', htm: { date: d, energy: e }, status: st, own: !!own, createdAt: d + 'T10:00:00Z', updatedAt: 1, source: 'manual' });
  s.baseline = s.places[0].baseline = { date: '2024-02-14', energy: '0.500' }; s.places[0].area = '54.3';
  s.readings = [R('a1', '2024-03-16', '1.917', 'accepted'), R('a2', '2024-11-20', '2.600', 'accepted'), R('a3', '2025-01-20', '9.003', 'accepted'), R('a4', '2025-02-20', '11.448', 'accepted'),
    R('a5', '2025-03-20', '12.300', 'accepted'), R('a6', '2025-11-20', '13.245', 'accepted'), R('a7', '2025-12-10', '13.900', 'checked', true), R('a8', '2026-02-20', '15.482', 'accepted'),
    R('a9', '2026-03-23', '17.609', 'accepted'), R('a10', '2026-11-05', '17.914', 'checked')];
  s.places[0].gaps = [{ id: 'g1', what: 'heat', from: '2025-12-12', to: '2026-01-21', reason: 'repair', fresh: false, updatedAt: 1 }];
  await p.evaluate(x => { x.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(x)); }, s); await p.reload(); await p.waitForTimeout(1500);
  const uid = await p.evaluate(() => window.TeploSync.api('GET', '/me').then(j => j.user.id));
  const rows = [], add = (ym, g, cost, rc) => rows.push({ ym, heat: { area: 54.3, gcal: g, cost, recalc: rc || 0 } });
  [['2023-11', 1.2], ['2023-12', 1.3], ['2024-01', 1.4], ['2024-02', 0.9], ['2024-03', 0.471]].forEach(([m, g]) => add(m, g, g * 1539.5 + 29.4));
  [['2024-11', 0.6], ['2024-12', 1.7], ['2025-01', 1.8], ['2025-02', 2.3], ['2025-03', 0.95]].forEach(([m, g]) => add(m, g, g * 1539.5 + 29.4));
  [['2025-11', 1.065], ['2025-12', 2.0], ['2026-01', 2.4], ['2026-02', 2.095, -174.58], ['2026-03', 2.437, -1190.31]].forEach(([m, g, rc]) => add(m, g, g * 1539.5 + 29.4, rc));
  ['2026-07', '2026-08', '2026-09', '2026-10'].forEach(m => add(m, 0, 29.4));
  execFileSync('php', ['-r', `define('TEPLO',1); require 'app/core.php'; require 'app/htmsvc.php'; HtmSpr::saveNar(${uid}, 'main', json_decode('${JSON.stringify({ from: '01.10.2021', start: { heat: 0 }, rows })}', true));`],
    { env: Object.assign({}, process.env, { SITE_DATA: DATA, SITE_BASE: '' }), cwd: path.join(__dirname, '../..') });
  await p.goto(U + '#history'); await p.reload(); await p.waitForTimeout(2500);
  const sum = async k => (await p.textContent('[data-key=season-' + k + '] summary')).replace(/\s+/g, ' ');
  const s23 = await sum(2023), s25 = await sum(2025), s26 = await sum(2026);
  ok('легенда: Гкал — тепло на опалення, 1 Гкал = 1 540 грн', /Гкал — тепло, що пішло на опалення квартири: 1 Гкал = 1\s540 грн/.test(await p.textContent('[data-key=hs-unit]')));
  ok('2023/24: «Лічильник у застосунку — з 14 лютого 2024» (ХТМ рахував без нього)', /з 14 лютого 2024/.test(s23), s23);
  ok('2025/26: ХТМ з перерахунками (нараховано окремо) і ремонт 12 грудня – 21 січня', /з перерахунками −1\s?365 грн/.test(s25) && /Лічильник знімали 12 грудня – 21 січня/.test(s25), s25);
  ok('2026/27: осінні показання поділено — кінець минулого сезону там', /Осінні показання поділено/.test(s26) && /ХТМ\s*0,000 Гкал\s*118 грн/.test(s26), s26);
  const r8 = await p.textContent('[data-key=reading-a8]'), r10 = await p.textContent('[data-key=reading-a10]');
  ok('рядок 20.02.2026 — від показань «для себе» 10.12 (+1,582), «від передачі 20 листопада: +2,237 Гкал» підписом', /\+1,582 Гкал/.test(r8) && /від передачі 20 листопада: \+2,237 Гкал/.test(r8) && /72 дн\., з них 40 без лічильника/.test(r8), r8);
  ok('рядок 05.11.2026 — «з них ≈ … Гкал — кінець сезону 2025/26»', /\+0,305 Гкал/.test(r10) && /з них ≈ 0,\d{3} Гкал — кінець сезону 2025\/26/.test(r10), r10);
  // сезони = рядки: сума «Лічильника» без оцінки ремонту = усім рядкам показань
  const tot = await p.evaluate(() => { const n = s => parseFloat(String(s).replace(/[^0-9,]/g, '').replace(',', '.')) || 0;
    return { rows: [...document.querySelectorAll('li.hli-heat:not(.hli-nar):not(.hli-bill) .hr-q, li.gap-row .hr-q')].reduce((a, e) => a + n(e.textContent), 0), seasons: [...document.querySelectorAll('[data-key^=season-own-] .ss-q b')].reduce((a, e) => a + n(e.textContent), 0) }; });
  ok('усі сезони «Лічильник» = сума рядків показань і ремонту (нічого не загубили й не задвоїли)', Math.abs(tot.seasons - tot.rows) < 0.004, tot);
  await p.goto(U + '#rec-a8'); await p.waitForTimeout(800);
  const card = (await p.textContent('[data-key=rec-used]')).replace(/\s+/g, ' '), head = await p.textContent('main h1 + p').catch(() => '');
  ok('картка 20.02: «з 10 грудня 2025 до 20 лютого 2026 · лічильник рахував 32 дн., ще 40 дн. його знімали (12 грудня – 21 січня)»', /з 10 грудня 2025 до 20 лютого 2026 · лічильник рахував 32 дн\., ще 40 дн\. його знімали \(12 грудня – 21 січня\)/.test(card), card.slice(0, 300));
  ok('картка: «Від передачі 20 листопада: +2,237 Гкал ≈ … — від цих показань рахує ХТМ (між ними показань: 1…)»', /Від передачі 20 листопада 2025: \+2,237 Гкал ≈ [\d\s]+,\d\d грн — від цих показань рахує ХТМ \(між ними показань: 1/.test(card), card.slice(-400));
  ok('без «введено вручну»', !/введено вручну/.test(await p.textContent('main')));
  // 138-а: статистика — «Лічильник і ХТМ по місяцях» (два стовпці на місяць, останні 12 місяців з даними, легенда)
  await p.goto(U + '#stats'); await p.reload(); await p.waitForTimeout(2500);
  const stm = await p.$('[data-key=stm-panel]');
  const nmk = stm ? await stm.$$eval('svg .mk', a => a.length) : 0, tips = stm ? await stm.$$eval('svg .mk', a => a.map(x => x.getAttribute('data-tip'))) : [];
  ok('статистика: «Лічильник і ХТМ по місяцях» — до 12 місяців, легенда, у підказці обидва', !!stm && nmk >= 6 && nmk <= 12 && /ХТМ нарахував/.test(await stm.textContent())
    && tips.some(t => /ХТМ: 2,4/.test(t) && /лічильник:/.test(t)), { nmk, t: tips.slice(0, 3) });
  if (stm) await stm.screenshot({ path: '/tmp/shot_stm.png' });
  ok('без помилок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
