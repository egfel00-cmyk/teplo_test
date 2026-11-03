// История версий данных и «Восстановить эту версию» в /admin (03.11.2026). Телефон человека: «Победа» с теплом и водомерами →
// сохранение, которое затирает квартиру (как баг входа 03.11) → админ в /admin видит версии, красное «было», восстанавливает →
// открытый сайт на телефоне сам подхватывает восстановленное (опрос сервера), на сервер «плохая» копия не возвращается.
// Второй круг: «Тестовий режим: почати спочатку» (стёр всё) → восстановление → записи вернулись.
// node e2e_restore.cjs  (локальный сервер 127.0.0.1:8013; в config.php: 'admins' => ['emails' => ['boss@teplo.test']])
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', SHOTS = process.env.SHOTS || '/tmp';
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push('app: ' + e.message));
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  const server = () => p.evaluate(async () => (await (await fetch('api/state', { credentials: 'same-origin' })).json()).state);
  const main = s => (s.places || []).find(x => x.id === 'main' && !x.deleted) || {};
  const live = a => (a || []).filter(x => !x.deleted);
  const wait = ms => p.waitForTimeout(ms);
  const poll = () => p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));   // как вернуться в открытый сайт (опрос раз в минуту)
  const email = 'restore' + Date.now() + '@teplo.test', pw = 'Pass-12345678';

  // 1. человек: аккаунт с данными
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(600);
  ok('регистрация', await p.evaluate(([e, x]) => window.TeploSync.register(e, x).then(j => j._status), [email, pw]) === 200);
  await p.evaluate(s => { s.places[0].name = 'Победа'; s.places[0].v = 2; s.places[0].updatedAt = Date.now(); s.updatedAt = Date.now(); delete s.demoToday; localStorage.setItem('teplo.v1', JSON.stringify(s)); }, demo({}));
  await p.reload(); await wait(3000);
  let sv = await server();
  ok('на сервере «Победа»: тепло, 2 водомера, показания', main(sv).name === 'Победа' && !!main(sv).meter && main(sv).water.meters.length === 2 && live(sv.readings).length === 4);

  // 2. «плохое» сохранение: квартира затёрта (без названия, тепла и водомеров), лишняя квартира, удалено показание
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')), now = Date.now(); const m = s.places.find(x => x.id === 'main');
    m.name = ''; m.meter = null; m.baseline = null; m.water = { meters: [] }; m.updatedAt = now; s.meter = null; s.baseline = null;
    s.places.push({ id: 'pjunk', name: 'Без входу', v: 2, updatedAt: now }); s.readings[0].deleted = true; s.readings[0].updatedAt = now; s.updatedAt = now;
    localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await wait(3000);
  sv = await server();
  ok('затёртая версия ушла на сервер', !main(sv).name && !main(sv).meter && live(sv.places).length === 2 && live(sv.readings).length === 3);
  const uid = await p.evaluate(() => fetch('api/me').then(r => r.json()).then(j => j.user.id));

  // 3. админ: /admin → карточка → «История версий данных»
  const a = await (await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU' })).newPage();
  a.on('pageerror', e => errs.push('admin: ' + e.message));
  await a.goto(U); await a.evaluate(() => fetch('api/config'));
  const breg = await a.evaluate(() => { const c = document.cookie.match(/ts_csrf=([^;]+)/)[1], h = { 'Content-Type': 'application/json', 'X-CSRF': decodeURIComponent(c) };
    return fetch('api/auth/register', { method: 'POST', headers: h, body: JSON.stringify({ email: 'boss@teplo.test', password: 'Boss-12345678' }) }).then(r => r.status === 200 ? 200 :
      fetch('api/auth/login', { method: 'POST', headers: h, body: JSON.stringify({ email: 'boss@teplo.test', password: 'Boss-12345678' }) }).then(r2 => r2.status)); });
  ok('админ вошёл', breg === 200, breg);
  await a.goto(U + 'admin#user-' + uid); await a.waitForSelector('#hist'); await a.click('#hist summary'); await a.waitForSelector('#hist [data-hrestore]');
  const rows = await a.$$eval('#hist tbody tr', trs => trs.map(t => t.innerText.replace(/\s+/g, ' ')));
  ok('версии: сверху текущая («сейчас»), ниже прошлые', rows.length >= 3 && /сейчас/.test(rows[0]), rows.slice(0, 3));
  ok('у затёршей версии красное «было» (квартиру и счётчики потеряли)', await a.$eval('#hist tbody tr', tr => tr.querySelectorAll('.problem').length >= 1));
  await a.screenshot({ path: SHOTS + '/shot_admin_hist.png', fullPage: false, clip: await a.$eval('#hist', el => { const r = el.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top + scrollY - 10), width: 1280, height: Math.min(900, r.height + 20) }; }) }).catch(() => {});
  // восстановить версию под текущей (до затирания): ищем самую новую, где «Победа»
  const target = await a.$$eval('#hist tbody tr', trs => { for (const t of trs.slice(1)) if (/Победа/.test(t.innerText)) { const btn = t.querySelector('[data-hrestore]'); if (btn) return btn.getAttribute('data-hrestore'); } return null; });
  ok('нашлась прошлая версия с «Победой»', !!target);
  let dlg = '';
  a.once('dialog', d => { dlg = d.message(); d.accept(); });
  await a.click('[data-hrestore="' + target + '"]'); await a.waitForSelector('#hist .okmsg', { timeout: 8000 }).catch(() => {});
  ok('подтверждение показывает «Сейчас → Станет»', /Сейчас: 2 кв\., счётчиков 0/.test(dlg) && /Станет: 1 кв\., счётчиков 3/.test(dlg) && /Победа/.test(dlg), dlg);
  const okmsg = await a.$eval('#hist .okmsg', el => el.textContent).catch(() => '');
  ok('после восстановления: сообщение «Готово», история открыта, сверху — восстановленная', /Готово: версия \d+ восстановлена как \d+/.test(okmsg) && /восстановлена/.test(await a.$eval('#hist tbody tr', tr => tr.innerText)), okmsg);
  await a.screenshot({ path: SHOTS + '/shot_admin_restored.png', clip: await a.$eval('#hist', el => { const r = el.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top + scrollY - 10), width: 1280, height: Math.min(900, r.height + 20) }; }) }).catch(() => {});
  ok('в «Входах и действиях» — запись о восстановлении', /восстановлена версия/.test(await a.$eval('main', m => m.innerText)));

  // 4. телефон человека с открытым сайтом (в браузере — затёртая копия) подхватывает восстановленное
  await poll(); await wait(2500);
  let s = await st(); sv = await server();
  ok('телефон: «Победа» с теплом и водомерами вернулась', main(s).name === 'Победа' && !!main(s).meter && main(s).water.meters.length === 2 && !!s.meter, { name: main(s).name });
  ok('телефон: лишняя квартира убрана, удалённое показание вернулось', live(s.places).length === 1 && live(s.readings).length === 4);
  await wait(2000); sv = await server();
  ok('на сервер «плохая» копия не вернулась', main(sv).name === 'Победа' && !!main(sv).meter && live(sv.places).length === 1 && live(sv.readings).length === 4);
  await p.goto(U + '#home'); await wait(800);
  const ht = await p.evaluate(() => document.body.innerText);
  ok('главная: карточки тепла и воды на месте', /Опалення/.test(ht) && /Холодна/.test(ht) && /Гаряча/.test(ht) && /Победа/.test(ht), ht.slice(0, 300));
  await p.reload(); await wait(2500); s = await st();
  ok('после перезагрузки — то же', main(s).name === 'Победа' && live(s.readings).length === 4);

  // 5. «Тестовий режим: почати спочатку» → восстановить версию до него
  await p.goto(U + '#prefs'); await wait(600);
  // кнопка — в свёрнутом разделе «Дані»: жмём как человек после раскрытия
  const wipeBtn = await p.evaluate(() => { const x = document.querySelector('[data-key=test-reset-btn]') || document.querySelector('[data-key=prefs-wipe]'); if (!x) return false; x.click(); return true; });
  if (wipeBtn) { await wait(200); await p.evaluate(() => document.querySelector('[data-key=prefs-wipe-yes]').click()); }
  await wait(3000); s = await st(); sv = await server();
  ok('стёр всё: пусто и в браузере, и на сервере', !!wipeBtn && !main(s).name && !live(s.readings).length && !live(sv.readings).length && !!sv.wipedAt);
  await a.reload(); await a.waitForSelector('#hist'); if (!(await a.$eval('#hist', d => d.open))) await a.click('#hist summary'); await a.waitForSelector('#hist [data-hrestore]');
  const t2 = await a.$$eval('#hist tbody tr', trs => { for (const t of trs.slice(1)) if (/Победа/.test(t.innerText)) return t.querySelector('[data-hrestore]').getAttribute('data-hrestore'); return null; });
  a.once('dialog', d => d.accept()); await a.click('[data-hrestore="' + t2 + '"]'); await a.waitForSelector('#hist .okmsg', { timeout: 8000 }).catch(() => {});
  await poll(); await wait(3000); s = await st(); sv = await server();
  ok('после восстановления «стёртое» вернулось на телефон и осталось на сервере', main(s).name === 'Победа' && live(s.readings).length === 4 && !s.wipedAt && main(sv).name === 'Победа' && live(sv.readings).length === 4 && !sv.wipedAt, { s: live(s.readings).length, sv: live(sv.readings).length, w: s.wipedAt });

  ok('без ошибок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
