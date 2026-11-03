// Критический баг 03.11.2026: вышел из аккаунта → без входа добавил счётчики («Моя квартира» с тем же id «main») → вошёл снова —
// квартира аккаунта затёрлась данными «без входа». Должно: вошёл в аккаунт, где уже есть данные, — видишь СВОИ данные, «без входа» не вливается.
// Новый аккаунт (данных нет) — забирает то, что внесли без входа.  node e2e_account_switch.cjs  (локальный сервер 127.0.0.1:8013)
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  const server = () => p.evaluate(async () => (await (await fetch('api/state', { credentials: 'same-origin' })).json()).state);
  const main = s => (s.places || []).find(x => x.id === 'main') || {};
  const wait = ms => p.waitForTimeout(ms);
  const email = 'switch' + Date.now() + '@teplo.test', pass1 = 'Pass-12345678';

  // 1. аккаунт с данными: регистрация, потом в браузере — «реальные» данные (квартира «Победа», тепло, водомеры), синхронизация
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.goto(U + '#'); await p.reload(); await wait(600);
  const reg = await p.evaluate(([e, pw]) => window.TeploSync.register(e, pw).then(j => j._status), [email, pass1]);
  ok('регистрация', reg === 200, reg);
  await p.evaluate(s => { const d = s; d.places[0].name = 'Победа'; d.places[0].v = 2; d.places[0].updatedAt = Date.now(); d.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(d)); }, demo({}));
  await p.reload(); await wait(3500);
  let sv = await server();
  ok('данные аккаунта на сервере: «Победа», тепло, водомеры h1/c1, показания', main(sv).name === 'Победа' && !!main(sv).meter && (main(sv).water.meters || []).length === 2 && (sv.readings || []).length >= 4, { name: main(sv).name });

  // 2. выход → «как новый»: первый вход, світло і газ без входа
  await p.evaluate(() => { const x = document.createElement('button'); x.setAttribute('data-act', 'logout'); x.id = 'lo'; document.body.appendChild(x); }); await p.evaluate(() => document.getElementById('lo').click()); await wait(800);
  let s = await st();
  ok('после выхода в браузере пусто (не данные аккаунта)', !main(s).meter && !(main(s).water || {}).meters?.length && !(s.readings || []).length && !main(s).name);
  await p.goto(U + '#start'); await wait(400);
  for (const k of ['elec', 'gas']) { await p.click('[data-key=aw-' + k + '-inc]'); await wait(100); }
  await p.click('[data-key=aw-create]'); await wait(400); await p.click('[data-key=ea-save]'); await wait(400); await p.click('[data-key=ea-save]'); await wait(500);
  s = await st();
  ok('без входа добавлены світло и газ в «main» (свежая метка)', (main(s).meters || []).length === 2 && main(s).updatedAt > main(sv).updatedAt, main(s).meters);

  // 3. вход в свой аккаунт — свои данные, «без входа» не вливается ни в браузер, ни на сервер
  const li = await p.evaluate(([e, pw]) => window.TeploSync.login(e, pw).then(j => j._status), [email, pass1]);
  await wait(2500); s = await st(); sv = await server();
  ok('вход: в браузере — данные аккаунта («Победа», тепло, 2 водомера, показания)', li === 200 && main(s).name === 'Победа' && !!main(s).meter && (main(s).water.meters || []).length === 2 && (s.readings || []).length >= 4, { li, name: main(s).name, m: (main(s).meters || []).length });
  ok('вход: світло/газ «без входа» не попали в аккаунт', !(main(s).meters || []).length && !(main(sv).meters || []).length, [main(s).meters, main(sv).meters]);
  ok('на сервере квартира аккаунта цела', main(sv).name === 'Победа' && (main(sv).water.meters || []).length === 2 && !!main(sv).meter);
  await p.reload(); await wait(2000); s = await st();
  ok('после перезагрузки (тот же аккаунт) — те же данные', main(s).name === 'Победа' && (main(s).water.meters || []).length === 2);

  // 4. новый аккаунт: внёс без входа, потом зарегистрировался — данные «без входа» переходят в него
  await p.evaluate(() => { const x = document.createElement('button'); x.setAttribute('data-act', 'logout'); x.id = 'lo2'; document.body.appendChild(x); }); await p.evaluate(() => document.getElementById('lo2').click()); await wait(800);
  await p.goto(U + '#start'); await wait(400); await p.click('[data-key=aw-gas-inc]'); await p.click('[data-key=aw-create]'); await wait(400); await p.click('[data-key=ea-save]'); await wait(500);
  const reg2 = await p.evaluate(([e, pw]) => window.TeploSync.register(e, pw).then(j => j._status), ['new' + Date.now() + '@teplo.test', pass1]);
  await wait(2500); sv = await server();
  ok('новый аккаунт забрал внесённое без входа (газ)', reg2 === 200 && (main(sv).meters || []).some(m => m.kind === 'gas'), main(sv).meters);
  ok('без ошибок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
