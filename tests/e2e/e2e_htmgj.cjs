// Кабінет ХТМ іншого приладу (125-а; скрини власника 12.11.2026): енергія в ГДж, три колонки часу — Bd, Fd і «Час роботи з витратою (Pd)».
// Теплолічильник T330 у ГДж → «Підключити кабінет» на стенді (сценарій gj_pd) → застосунок сам ставить «Як у вашому кабінеті ХТМ»: ГДж і 3 колонки →
// «Перевірте ще раз» — ГДж з табло (без перерахунку) і Pd → «Так, внести» → на стенді запис з Pd, задача в ГДж.
// Нужны: сайт 127.0.0.1:8013 (SITE_DATA=/tmp/teplo_data, config.php: 'htm_cab_base' => 'http://127.0.0.1:8099') і стенд ХТМ (tests/htm-mock, порт 8099).
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', M = 'http://127.0.0.1:8099';
const stand = body => fetch(M + '/stand/admin', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
(async () => {
  await stand('act=reset'); await stand('act=set&scenario=gj_pd&today=2026-11-10&robot_delay=99999');
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  const wait = ms => p.waitForTimeout(ms), vis = async sel => !!(await p.$(sel)) && await p.isVisible(sel), txt = sel => p.textContent(sel).catch(() => '');
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(500);
  ok('регистрация', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'gj' + Date.now() + '@teplo.test') === 200);
  await p.evaluate(s => {
    const m = { modelId: 't330', unit: 'GJ' }; s.meter = m; s.places[0].meter = m;
    s.readings.push({ id: 'rgj', place: 'main', htm: { date: '2026-11-10', energy: 14.4448, volume: '2332.676', flow: '0.063', power: '1.5', tSupply: '50.12', tReturn: '30.4', hours: '35078', errHours: '153', flowHours: '35100', errCode: 'E---' },
      raw: { energy: '60.478', flowHours: '35100' }, unit: 'GJ', status: 'checked', createdAt: '2026-11-10T09:00:00Z', updatedAt: Date.now(), source: 'manual' });
    s.focusId = 'rgj'; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s));
  }, demo({ today: '2026-11-10' }));
  await p.reload(); await wait(1500);
  await p.goto(U + '#heat'); await wait(1000);
  ok('сторінка тепла: у налаштуваннях — «Як у вашому кабінеті ХТМ»', !!(await p.$('[data-key=htm-form]')));
  await p.goto(U + '#htmcab'); await wait(800);
  await p.fill('#hc-email', 'test@stand.local'); await p.fill('#hc-pass', 'stand-pass-123'); await p.fill('#hc-phone', '050 111 22 33'); await p.check('#hc-consent');
  await p.click('[data-key=hc-connect-go]'); await p.waitForSelector('[data-key=hc-check]', { timeout: 15000 }).catch(() => {}); await wait(800);
  let s = await st();
  ok('підключили → кабінет сам сказав: ГДж і 3 колонки часу — лічильник це знає', s.meter.htmUnit === 'GJ' && s.meter.htmTimes === 3, s.meter);
  await p.goto(U + '#handover'); await wait(1000);
  ok('«Передайте»: робот доступний і для ГДж-кабінету', await vis('[data-key=handover-auto] [data-key=hc-ask]'), await txt('.ho-steps'));
  const tb = await txt('main');
  ok('«Як передати»: енергія 60.478 ГДж з табло, «Час роботи з витратою (Pd)» 35100', /60\.478/.test(tb) && /ГДж/.test(tb) && /витратою \(Pd\)/.test(tb) && /35100/.test(tb), tb.slice(0, 600));
  await p.click('[data-key=hc-ask]'); await wait(300);
  const cf = await txt('[data-key=hc-confirm]');
  ok('«Перевірте ще раз»: 60.478 (не перераховані Гкал)', /60\.478/.test(cf) && !/14\.445/.test(cf), cf);
  await p.click('[data-key=hc-send]'); await p.waitForURL(/#status$/, { timeout: 15000 }).catch(() => {}); await wait(600);
  s = await st(); const r = s.readings.find(x => x.id === 'rgj');
  ok('«Так, внести» → «передано», чекаємо робота ХТМ', r.status === 'handed' && r.cab && r.cab.job > 0, r);
  const store = await (await fetch(M + '/stand/state')).json().catch(() => ({}));
  const last = (store.journal || []).slice(-1)[0] || {};
  ok('на стенді — запис 10.11 з Pd 35100, енергія 60.478 ГДж (= 14.445 Гкал)', last.date === '2026-11-10' && last.flowHours === 35100 && Math.abs(last.energy * 4.1868 - 60.478) < 0.0005, last);
  const hs = await p.evaluate(() => window.TeploSync.api('GET', '/cab/htm'));
  ok('задача — в одиниці кабінету: 60.478 GJ', (hs.jobs || [])[0] && hs.jobs[0].energy === '60.478' && hs.jobs[0].unit === 'GJ', hs.jobs && hs.jobs[0]);
  ok('без помилок JS', !errs.length, errs);
  await b.close(); await stand('act=reset'); await stand('act=set&scenario=ok');
  console.log(`\nИтог: ${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})();
