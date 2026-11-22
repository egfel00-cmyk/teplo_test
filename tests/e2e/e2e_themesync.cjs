// 174-я (власник 22.11: «тема однакова на всіх пристроях — змінив на одному, на інших уже змінена»): телефон і комп'ютер одного акаунта.
// Тема за замовчуванням — «Темна»; «Світла» на телефоні → комп'ютер після опиту сервера теж світлий; «Латунь» на комп'ютері → телефон після перезавантаження.
// node e2e_themesync.cjs  (локальний сервер 127.0.0.1:8013)
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const mk = async (w, cs) => { const p = await (await b.newContext({ viewport: { width: w, height: 844 }, locale: 'uk-UA', colorScheme: cs })).newPage(); p.on('pageerror', e => errs.push(e.message)); return p; };
  const ph = await mk(390, 'light'), pc = await mk(1280, 'light');
  const th = p => p.evaluate(() => [document.documentElement.getAttribute('data-theme'), document.documentElement.getAttribute('data-skin') || '', (JSON.parse(localStorage.getItem('teplo.v1') || '{}').ui || {}).theme || ''].join('|'));
  const poll = p => p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const email = 'theme' + Date.now() + '@teplo.test', pw = 'Pass-12345678';
  // телефон: акаунт з даними, тему не обирали
  await ph.goto(U); await ph.evaluate(() => localStorage.clear()); await ph.reload(); await ph.waitForTimeout(600);
  ok('реєстрація', await ph.evaluate(([e, x]) => window.TeploSync.register(e, x).then(j => j._status), [email, pw]) === 200);
  await ph.evaluate(s => { delete s.theme; delete s.themeV; delete s.demoToday; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, demo({}));
  await ph.reload(); await ph.waitForTimeout(2500);
  ok('за замовчуванням — «Темна», хоч телефон світлий', /^dark\|\|/.test(await th(ph)), await th(ph));
  // комп'ютер: вхід тим самим акаунтом
  await pc.goto(U); await pc.evaluate(() => localStorage.clear()); await pc.reload(); await pc.waitForTimeout(600);
  ok('вхід на комп\'ютері', await pc.evaluate(([e, x]) => window.TeploSync.login(e, x).then(j => j._status), [email, pw]) === 200);
  await pc.goto(U + '#home'); await pc.reload(); await pc.waitForTimeout(2500);
  ok('комп\'ютер теж темний', /^dark/.test(await th(pc)), await th(pc));
  // телефон: «Світла» в Налаштуваннях
  await ph.goto(U + '#prefs-look'); await ph.waitForTimeout(600);
  await ph.click('[data-key=prefs-theme] [data-act=theme][data-v=light]'); await ph.waitForTimeout(2500);
  ok('телефон — світла, вибір записано (ui)', (await th(ph)) === 'light||light', await th(ph));
  const sv = await ph.evaluate(async () => (await (await fetch('api/state', { credentials: 'same-origin' })).json()).state.ui);
  ok('на сервері — ui.theme light з міткою часу', sv && sv.theme === 'light' && sv.at > 0, sv);
  await poll(pc); await pc.waitForTimeout(3000);
  ok('комп\'ютер підхопив світлу без перезавантаження (опит сервера)', /^light/.test(await th(pc)), await th(pc));
  // комп'ютер: «Латунь» → телефон після перезавантаження
  await pc.goto(U + '#prefs-look'); await pc.waitForTimeout(600);
  await pc.click('[data-key=prefs-theme] [data-act=theme][data-v=brass]'); await pc.waitForTimeout(2500);
  await ph.reload(); await ph.waitForTimeout(3000);
  ok('телефон після перезавантаження — «Латунь»', (await th(ph)) === 'dark|brass|brass', await th(ph));
  ok('без помилок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
