// Нарахування ХТМ по всіх місяцях (82-а, 09.11): «Довідка щодо нарахувань та оплати» кабінету → nar (сервер); в історії тепла — сума ХТМ місяця і рядки
// «Нараховано ХТМ» за місяці без показань; у картці місяця — чому ХТМ інакше, ніж лічильник (березень 2026 власника: наш 2,127 + ЗБП, ХТМ 2,437 — тепло
// з показань квітня в кінці сезону). Нужен сайт 8013 (SITE_DATA с config.php, sqlite); дані кладемо в SITE_DATA, як робот.
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const { execFileSync } = require('child_process'); const path = require('path');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', DATA = process.env.SITE_DATA || '/tmp/teplo_data';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); const wait = ms => p.waitForTimeout(ms);
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(500);
  ok('реєстрація', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'hn' + Date.now() + '@teplo.test') === 200);
  const st = demo({ today: '2026-11-06' }); st.places[0].area = '54.3';
  const R = (id, d, e) => ({ id, place: 'main', htm: { date: d, energy: e, volume: '2300', hours: '34000', errHours: '153', errCode: 'E---' }, status: 'accepted', createdAt: d + 'T10:00:00Z', updatedAt: 1, source: 'manual' });
  st.readings = [R('j1', '2026-01-24', '7.919'), R('f1', '2026-02-24', '10.000'), R('m1', '2026-03-24', '12.127'), R('a1', '2026-04-03', '12.432')];
  st.baseline = { date: '2026-01-24', energy: '7.919' }; st.places[0].baseline = st.baseline;
  await p.evaluate(s => { s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, st);
  await p.reload(); await wait(2000);
  const uid = await p.evaluate(() => window.TeploSync.api('GET', '/me').then(j => j.user.id));
  // з «Довідки щодо нарахувань»: листопад 2025 (показань у застосунку немає), лютий = лічильник 2,081 + ЗБП, березень 2,437 = 2,127 + 0,305 (квітень) + ЗБП, квітень — лише абонплата й перерахунок
  const nar = { from: '01.10.2021', start: { heat: 0 }, rows: [
    { ym: '2025-11', heat: { area: 54.3, gcal: 1.065, cost: 1669.3, paid: 29.4, saldo: 1669.3 } },
    { ym: '2026-01', heat: { area: 54.3, gcal: 2.4, cost: 3724.2, paid: 3000, saldo: 2393.5 } },
    { ym: '2026-02', heat: { area: 54.3, gcal: 2.095, cost: 3254.6, recalc: -174.58, paid: 3000, saldo: 2473.52 } },
    { ym: '2026-03', heat: { area: 54.3, gcal: 2.274, cost: 3530.24, paid: 3254.6, saldo: 3000.12 } },
    { ym: '2026-04', heat: { area: 54.3, cost: 29.4, recalc: -1190.31, paid: 3781.2, saldo: -1941.99 } }] };
  // і «Довідка по теплу» за березень (уточнене): 2,437 Гкал, 3751,80 + абонплата 29,40 — у рахунку того місяця інше (2,274: наперед і зняте)
  const spr = [{ ym: '2026-03', flat: 2.437, cost: 3751.8, abon: 29.4, lgota: 0, sFlat: 54.3 }];
  execFileSync('php', ['-r', `define('TEPLO',1); require 'app/core.php'; require 'app/htmsvc.php'; HtmSpr::saveNar(${uid}, 'main', json_decode('${JSON.stringify(nar)}', true));
    HtmSpr::save(${uid}, 'main', ['rows' => json_decode('${JSON.stringify(spr)}', true), 'cols' => ['ym', 'flat', 'cost'], 'fmt' => ['ym' => '##.####', 'num' => '#.###']]);`],
    { env: Object.assign({}, process.env, { SITE_DATA: DATA, SITE_BASE: '' }), cwd: path.join(__dirname, '../..') });
  ok('GET /api/htm/spr — нарахування квартири (nar) — 5 місяців', await p.evaluate(() => window.TeploSync.api('GET', '/htm/spr').then(j => j.places.length === 1 && j.places[0].nar.rows.length === 5)));
  await p.goto(U + '#history'); await wait(500); await p.reload(); await wait(2500);
  const tx = async k => (await p.textContent('[data-key=' + k + ']').catch(() => '')) || '';
  const hm = await tx('reading-m1'), ha = await tx('reading-a1'), hn = await tx('hnar-2025-11');
  ok('історія: березень — сума ХТМ 3 781 грн без «≈», «ХТМ нарахував 2,437 Гкал»', /3\s?781/.test(hm) && !/≈/.test(hm) && /ХТМ нарахував 2,437 Гкал/.test(hm), hm);
  ok('…квітень — у ХТМ лише абонплата (29 грн), «тепло — у нарахуванні ХТМ за березень 2026»', /\b29\b/.test(ha) && /тепло — у нарахуванні ХТМ за березень 2026/.test(ha), ha);
  ok('…листопад 2025 без показань — рядок «Нараховано ХТМ»: 1,065 Гкал, 1 669 грн', /Нараховано ХТМ/.test(hn) && /1,065/.test(hn) && /1\s?669/.test(hn), hn);
  ok('…місяців із показаннями окремим рядком немає (січень, лютий, березень, квітень)', !(await p.$('[data-key=hnar-2026-03]')) && !(await p.$('[data-key=hnar-2026-01]')));
  await p.goto(U + '#rec-m1'); await wait(1500);
  const br = await tx('rec-htm-sum'); await p.click('[data-key=rec-htm-sum]'); await wait(300);
  const why = await p.$eval('[data-key=hsp-why]', e => [e.getAttribute('data-why'), e.textContent]).catch(() => null), pan = await tx('rec-htm');
  ok('картка березня: «Нараховано ХТМ за березень 2026 · 2,437 Гкал · 3 781,20 грн · з показаннями наступного місяця»', /березень 2026/.test(br) && /2,437 Гкал/.test(br) && /3\s?781,20/.test(br) && /з показаннями наступного місяця/.test(br), br);
  ok('…чому: tail — ХТМ додав 0,305 Гкал з показань 3 квітня 2026; 2,127 + 0,305 + ЗБП 0,014 ≈ 2,437', why && why[0] === 'tail' && /0,305 Гкал/.test(why[1]) && /3 квітня 2026/.test(why[1]) && /2,127 \+ 0,305 \+ ЗБП 0,014 ≈ 2,437/.test(why[1]), why);
  ok('…і рядки нарахування: оплати 3 254,60, борг на кінець 3 000,12; рахунок за квітень — перерахунок −1 190,31', /Надійшло оплат/.test(pan) && /3\s?254,60/.test(pan) && /Борг на кінець місяця/.test(pan) && /3\s?000,12/.test(pan) && /перерахунок −1\s?190,31/.test(pan), pan);
  ok('…«У рахунку за цей місяць 2,274 Гкал · 3 530,24 грн» і чому рахунок інший, ніж довідка', /У рахунку за цей місяць/.test(pan) && /2,274 Гкал · 3\s?530,24 грн/.test(pan) && /тепло[мю]? наперед/.test(await tx('hsp-billdiff')), pan);
  await p.locator('[data-key=rec-htm]').screenshot({ path: '/tmp/shot_hnar_m1.png' }).catch(() => {});
  await p.goto(U + '#rec-f1'); await wait(1200); await p.click('[data-key=rec-htm-sum]').catch(() => {}); await wait(300);
  const wf = await p.$eval('[data-key=hsp-why]', e => [e.getAttribute('data-why'), e.textContent]).catch(() => null);
  ok('картка лютого: збігається — лічильник 2,081 + ЗБП 0,014 = 2,095', wf && wf[0] === 'zbp' && /2,081 Гкал/.test(wf[1]) && /0,014/.test(wf[1]), wf);
  await p.goto(U + '#rec-a1'); await wait(1200);
  const ba = await tx('rec-htm-sum'); await p.click('[data-key=rec-htm-sum]').catch(() => {}); await wait(300);
  ok('картка квітня: «тепло — у ХТМ за березень 2026», пояснення hsp-moved, перерахунок −1 190,31', /тепло — у ХТМ за березень 2026/.test(ba) && /лише абонплата/.test(await tx('hsp-moved')) && /−1\s?190,31/.test(await tx('rec-htm')), [ba, await tx('rec-htm')]);
  await p.goto(U + '#hnar-2025-11'); await wait(1200);
  const nv = await p.textContent('main').catch(() => '');
  ok('#hnar-2025-11: «Нараховано ХТМ · листопад 2025», 1 669,30 грн · 1,065 Гкал, розгорнуто, оплати й борг', /Нараховано ХТМ · листопад 2025/.test(nv) && /1\s?669,30/.test(nv) && /1,065 Гкал/.test(nv) && await p.$eval('details[data-key=rec-htm]', d => d.open).catch(() => false), nv.slice(0, 400));
  // показань квітня в застосунку немає, а в журналі ХТМ є (прийняті) — пояснення все одно з квітня (журнал кабінету)
  execFileSync('php', ['-r', `define('TEPLO',1); require 'app/core.php'; require 'app/htmsvc.php'; $f = glob(HtmSpr::dir() . '/${uid}_*.json')[0]; $j = json_decode(file_get_contents($f), true);
    $j['own'] = [['date' => '2026-01-24', 'energy' => 7.919, 'status' => 'ok'], ['date' => '2026-02-24', 'energy' => 10.0, 'status' => 'ok'], ['date' => '2026-03-24', 'energy' => 12.127, 'status' => 'ok'], ['date' => '2026-04-03', 'energy' => 12.432, 'status' => 'ok']]; file_put_contents($f, json_encode($j));`],
    { env: Object.assign({}, process.env, { SITE_DATA: DATA, SITE_BASE: '' }), cwd: path.join(__dirname, '../..') });
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.readings.forEach(r => { if (r.id === 'a1') { r.deleted = true; r.updatedAt = Date.now(); } }); s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.goto(U + '#rec-m1'); await p.reload(); await wait(2500); await p.click('[data-key=rec-htm-sum]').catch(() => {}); await wait(300);
  const wj = await p.$eval('[data-key=hsp-why]', e => [e.getAttribute('data-why'), e.textContent]).catch(() => null);
  ok('квітня в застосунку немає, у журналі ХТМ — є: те саме пояснення (0,305 Гкал з показань 3 квітня 2026)', wj && wj[0] === 'tail' && /0,305 Гкал/.test(wj[1]) && /3 квітня 2026/.test(wj[1]), wj);
  ok('без помилок JS', !errs.length, errs);
  console.log('Итог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
