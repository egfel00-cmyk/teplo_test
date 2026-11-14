// 150-а (власник 14.11: «у квартирі „Победа“ міняю постачальника електроенергії на свого — зберігається, після оновлення знову скидається;
// виправ, бо не лише в мене»). Причина: сервер (PHP json_decode(…, true)) повертав порожній об'єкт {} масивом [] — prov квартири ставав [],
// застосунок писав prov.elec у масив, а JSON.stringify властивості масиву викидає: ні в localStorage, ні на сервер. На екрані — видно, після
// оновлення — пропало. Тут: старі дані на сервері з "prov":[] → обрати свого → оновити (і з localStorage, і без — як вікно Telegram) → свій на місці.
// cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_provarr.cjs   (сайт 127.0.0.1:8013, SITE_DATA=/tmp/teplo_data, sqlite)
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const { execFileSync } = require('child_process');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : '')); } };
const U = 'http://127.0.0.1:8013/', DB = process.env.DB || '/tmp/teplo_data/dev.sqlite';
const sql = (q, ...a) => execFileSync('python3', ['-c', 'import sqlite3,sys,json; c=sqlite3.connect(sys.argv[1]); r=c.execute(sys.argv[2], json.loads(sys.argv[3])).fetchall(); c.commit(); print(json.dumps(r))', DB, q, JSON.stringify(a)], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
(async () => {
  try { sql('DELETE FROM rate_limits'); } catch (e) { /* немає таблиці — перший запуск */ }
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const wait = ms => p.waitForTimeout(ms);
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  const server = () => p.evaluate(async () => (await (await fetch('api/state', { credentials: 'same-origin' })).json()).state);
  const pob = s => (s.places || []).find(x => x.id === 'pob') || {};
  const email = 'provarr' + Date.now() + '@teplo.test', pw = 'Pass-12345678';

  // 1. вхід і дані: друга квартира «Победа» зі світлом, prov — порожній об'єкт (так буває після «Інший»/«Скасувати»/вибору населеного пункту)
  await p.goto(U); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('teplo.cc', JSON.stringify({ v: 1, a: 0, at: new Date().toISOString(), id: 'x' })); });
  await p.reload(); await wait(600);
  const reg = await p.evaluate(([e, x]) => window.TeploSync.register(e, x).then(j => j._status), [email, pw]);
  ok('реєстрація', reg === 200, reg);
  const d = demo({}); const now = Date.now();
  d.places.push({ id: 'pob', v: 2, name: 'Победа', color: 'violet', address: 'м. Харків, вул. Тестова, 1', meter: null, baseline: null, prov: {}, meters: [{ id: 'ep', kind: 'elec', zones: 1 }], updatedAt: now });
  d.placeId = 'pob'; d.updatedAt = now;
  await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), d); await p.reload(); await wait(3000);
  let sv = await server();
  ok('на сервері — «Победа» зі світлом', pob(sv).name === 'Победа' && (pob(sv).meters || []).length === 1, pob(sv));
  ok('сервер віддає порожній prov об\'єктом {}, не []', !Array.isArray(pob(sv).prov) && typeof pob(sv).prov === 'object', pob(sv).prov);

  // 2. старі дані, як записав сервер до 150-ї: "prov":[] — і нова версія, щоб застосунок узяв їх
  const uid = JSON.parse(sql('SELECT id FROM users WHERE email = ?', email))[0][0];
  sql('UPDATE user_state SET data = replace(data, \'"prov":{}\', \'"prov":[]\'), version = version + 1 WHERE user_id = ?', uid);
  ok('у базі — "prov":[] (як старі дані)', JSON.parse(sql('SELECT data FROM user_state WHERE user_id = ?', uid))[0][0].includes('"prov":[]'));
  await p.evaluate(() => localStorage.removeItem('teplo.v1')); await p.goto('about:blank'); await p.goto(U + '#elec'); await wait(3000);
  ok('застосунок узяв старі дані: «Победа» на місці', pob(await st()).name === 'Победа', pob(await st()));
  await p.goto(U + '?go=elec&place=pob'); await wait(2500);   // як кнопка з нагадування: сторінка світла «Победи»

  // 3. «Кому платите» → «Інший постачальник» (як власник: на сторінці світла)
  if (!(await p.$('[data-key="my-elec-1"]'))) console.log('DBG', await p.evaluate(() => location.hash + ' | ' + (document.querySelector('main') || document.body).innerText.slice(0, 600).replace(/\s+/g, ' ')));
  await p.evaluate(() => { const f = document.getElementById('my-elec'); const dd = f && f.closest('details'); if (dd) dd.open = true; });
  await p.click('[data-key="my-elec-1"]'); await wait(600);
  await p.fill('#my-elec-name', 'Жилстрой'); await p.press('#my-elec-name', 'Tab'); await wait(2500);   // Sync — через 1,2 с
  let s = await st();
  ok('одразу: у localStorage свій — «Жилстрой»', (pob(s).prov || {}).elec && pob(s).prov.elec.own === 1 && pob(s).prov.elec.name === 'Жилстрой', pob(s).prov);
  sv = await server();
  ok('одразу: на сервері свій — «Жилстрой»', ((pob(sv).prov || {}).elec || {}).name === 'Жилстрой', pob(sv).prov);

  // 4. оновлення сторінки — свій лишається (і з localStorage, і без — вікно Telegram на Mac його губить)
  await p.reload(); await wait(3000); s = await st();
  ok('після оновлення: свій «Жилстрой» на місці', ((pob(s).prov || {}).elec || {}).own === 1 && pob(s).prov.elec.name === 'Жилстрой', pob(s).prov);
  ok('…і в «Кому платите» обрано свого', await p.isChecked('[data-key="my-elec-1"]').catch(() => false));
  await p.evaluate(() => localStorage.removeItem('teplo.v1')); await p.goto('about:blank'); await p.goto(U + '#elec'); await wait(3000); s = await st();
  ok('без localStorage (лише сервер): свій «Жилстрой» на місці', ((pob(s).prov || {}).elec || {}).name === 'Жилстрой', pob(s).prov);
  ok('без помилок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
