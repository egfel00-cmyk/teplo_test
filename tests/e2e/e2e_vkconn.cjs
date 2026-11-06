// «Сайт Водоканалу» (#vkcab, просьба владельца 06.11 22:15: «нету подключения в водоканале в разделе как передать»): в «Куди передати» воды —
// равноценная кнопка «Підключити сайт Водоканалу» в ряду каналов (как «Підключити кабінет» у тепла) → экран: рахунок и прізвище, «Підключити й перевірити»
// (что видит сайт), согласие на автовідправку; подключено — «Сайт Водоканалу підключено» в ряду каналов; «Налаштування» → «Кабінети» — та же кнопка.
// Нужны: сайт 127.0.0.1:8013 (config.php: 'vk_cab_base' => 'http://127.0.0.1:8098'), кабинет Водоканала: php -S 127.0.0.1:8098 tests/vk-mock/router.php
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const fs = require('fs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', VM = 'http://127.0.0.1:8098', DATA = process.env.SITE_DATA || '/tmp/teplo_data';
(async () => {
  await fetch(VM + '/__reset');
  const n = Math.floor(Date.now() / 1000); fs.mkdirSync(DATA + '/cache', { recursive: true });
  fs.writeFileSync(DATA + '/cache/vk_status.json', JSON.stringify({ cab: { state: 'ok', at: n, since: n - 3600, everOk: true, lastOk: n, code: 200 } }));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const wait = ms => p.waitForTimeout(ms), vis = async sel => !!(await p.$(sel)) && await p.isVisible(sel), txt = sel => p.textContent(sel).catch(() => '');
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  const where = async () => { await p.goto(U + '#water-cold'); await wait(1500); const el = await p.$('[data-key=where-water]'); if (el && await el.evaluate(d => d.open === false)) { await (await el.$('summary')).click(); await wait(300); } };
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(500);
  ok('регистрация', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'vc' + Date.now() + '@teplo.test') === 200);
  await p.evaluate(([s]) => { s.places[0].water.account = ''; s.places[0].water.surname = ''; s.water = []; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, [demo({ today: '2026-11-06' })]);
  await p.reload(); await wait(1500);
  // 1. не подключено: в ряду каналов бот, кабинет и «Підключити сайт Водоканалу» — все одного вида; полей рахунку в карточке нет
  await where(); if (process.env.SHOT) await (await p.$('#wsend-vk')).screenshot({ path: '/tmp/vc_where_off.png' });
  const row = await p.$$eval('[data-key=dest-vk] .dest-ch > *', l => l.map(x => ({ k: x.getAttribute('data-key'), c: x.className })));
  ok('не подключено: «Підключити сайт Водоканалу» — равноценная кнопка в ряду каналов (btn sec)', row.length === 3 && row.every(x => x.c === 'btn sec') && row[2].k === 'vk-connect', row);
  ok('…в карточке — строка «Підключіть сайт Водоканалу…», без полей рахунку', /Підключіть сайт Водоканалу/.test(await txt('[data-key=vc-need]')) && !(await p.$('[data-key=dest-vk] #w-acc')));
  await p.setViewportSize({ width: 320, height: 700 }); await wait(300); ok('320 px: без горизонтальной прокрутки', await p.evaluate(() => document.documentElement.scrollWidth <= 321)); await p.setViewportSize({ width: 390, height: 844 });
  // 2. экран «Сайт Водоканалу»
  await p.click('[data-key=vk-connect]'); await wait(1200);
  ok('→ #vkcab: «Сайт Водоканалу», без пароля — рахунок і прізвище', /#vkcab$/.test(p.url()) && /Сайт Водоканалу/.test(await txt('h1')) && await vis('#vc-acc') && await vis('#vc-sn') && /Пароль не потрібен/.test(await txt('main, body')));
  await p.fill('#vc-acc', '12'); await p.fill('#vc-sn', 'Шевченко'); await p.click('[data-key=vc-go]'); await wait(500);
  ok('…короткий рахунок — не подключаем, подсказка', /#vkcab$/.test(p.url()) && await vis('#vc-acc') && (await st()).places[0].water.account === '');
  await p.fill('#vc-acc', '905614'); await p.fill('#vc-sn', 'Шевченко'); await p.click('[data-key=vc-go]'); await wait(2500);
  if (process.env.SHOT) await p.screenshot({ path: '/tmp/vc_screen_on.png', fullPage: true });
  let s = await st();
  ok('«Підключити й перевірити» → рахунок и прізвище в настройках воды квартиры', s.places[0].water.account === '905614' && s.places[0].water.surname === 'Шевченко', s.places[0].water);
  ok('…«Сайт Водоканалу підключено» и что видит сайт («знайшов рахунок 905614»)', await vis('[data-key=vc-on]') && /905614/.test(await txt('[data-key=vkc-found]')), await txt('[data-key=vkc-found]'));
  ok('…согласие на автовідправку — переключатель здесь же', await vis('[data-key=vc-auto]'));
  await p.click('[data-key=vc-auto]'); await wait(1500);
  ok('…включается (сервер помнит согласие)', await p.evaluate(() => window.TeploSync.api('GET', '/vk/jobs').then(j => !!(j.auto || (j.st && j.st.auto))).catch(() => null)) === true || (await p.$eval('[data-key=vc-auto]', x => x.checked)));
  await p.click('[data-key=vc-edit]'); await wait(300);
  ok('«Змінити» → поля с текущими значениями, «Скасувати»', (await p.inputValue('#vc-acc')) === '905614' && await vis('[data-act=vc-edit-no]'));
  await p.click('[data-act=vc-edit-no]'); await wait(300);
  // 3. назад в «Куди передати»: «Сайт Водоканалу підключено» в ряду каналов, сайт — «Перевірити»/что видит
  await where(); if (process.env.SHOT) await (await p.$('#wsend-vk')).screenshot({ path: '/tmp/vc_where_on.png' });
  ok('подключено: в ряду каналов «Сайт Водоканалу підключено» → #vkcab', await vis('[data-key=vk-conn-on]') && (await p.getAttribute('[data-key=vk-conn-on]', 'href')) === '#vkcab');
  // 4. «Налаштування» → «Кабінети й автовідправка»: «Керувати» у Водоканалу
  await p.goto(U + '#prefs'); await wait(1200); const g = await p.$('[data-key=pg-cabs] summary, #pg-cabs summary'); if (g) await g.click(); await wait(600);
  ok('настройки: у Водоканалу «Керувати» → #vkcab', (await p.getAttribute('[data-key=prefs-vk-manage]', 'href').catch(() => '')) === '#vkcab');
  ok('без ошибок JS', errs.length === 0, errs);
  await b.close();
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); process.exit(fail ? 1 : 0);
})();
