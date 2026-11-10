// Автоподача місцевим КП (LocalBot, 102-а): квартира в Кам’янці-Подільському → «Куди передати» воду → «Підключити автовідправку»
// (особовий рахунок 74-108-61, згода) → сервер доходить до форми показань на стенді (нічого не надсилає) → «Відправити у фоні» → черга →
// прогін cron → стенд отримав холодну й гарячу в свої поля → «Сайт прийняв показання», запис позначено переданим.
// Потрібні: сайт 127.0.0.1:8013 (config.php: 'lb_base_mtve' => 'http://127.0.0.1:8096/'), стенд: php -S 127.0.0.1:8096 tests/lb-mock/router.php
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const { execSync } = require('child_process'); const path = require('path');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', M = 'http://127.0.0.1:8096', DATA = process.env.SITE_DATA || '/tmp/teplo_data';
(async () => {
  await fetch(M + '/__reset');
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: process.env.LANG_RU ? 'ru-RU' : 'uk-UA' }); const p = await ctx.newPage(); p.setDefaultTimeout(6000);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const wait = ms => p.waitForTimeout(ms), txt = sel => p.textContent(sel).catch(() => '');
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(500);
  ok('реєстрація', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'lb' + Date.now() + '@teplo.test') === 200);
  const s = demo({ today: '2026-11-10' });
  s.places[0].address = 'м. Кам’янець-Подільський, вул. Соборна 1, кв. 2';
  s.places[0].water.meters[0].serial = '7654321'; s.places[0].water.meters[1].serial = '1234567';
  s.water.push({ id: 'w20261110', place: 'main', date: '2026-11-10', vals: { h1: '178', c1: '441' }, createdAt: '2026-11-10T10:00:00Z', updatedAt: Date.now(), sent: {} });
  s.updatedAt = Date.now();
  await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), s); await p.reload(); await wait(1500);
  const where = async () => { await p.goto(U + '#water-cold'); await wait(2500); const el = await p.$('[data-key=where-water]'); if (el && await el.evaluate(d => d.open === false)) { await (await el.$('summary')).click(); await wait(400); } };
  await where();
  ok('«Куди передати» — місцевий водоканал (Міськтепловоденергія) і пропозиція надсилати самим', /Міськтепловоденергія/.test(await txt('[data-key=where-water]')) && !!(await p.$('[data-key=lb-open]')), (await txt('[data-key=where-water]')).slice(0, 300));
  if (process.env.SHOT) await (await p.$('[data-key=where-water]')).screenshot({ path: '/tmp/lb_off.png' });
  await p.click('[data-key=lb-open]'); await wait(300);
  ok('форма: особовий рахунок з підказкою 74-108-61, згода', !!(await p.$('#lb-acc')) && (await p.getAttribute('#lb-acc', 'placeholder')) === '74-108-61' && !!(await p.$('[data-key=lb-consent]')));
  await p.fill('#lb-acc', '74-108-61'); await p.click('[data-key=lb-save]'); await wait(800);
  ok('без згоди — пояснення, не підключено', /згода|согласие/i.test(await txt('[data-key=lb-err]')) && !(await p.$('[data-key=lb-on]')));
  await p.check('[data-key=lb-consent]'); await p.fill('#lb-acc', '74-108-62'); await p.click('[data-key=lb-save]'); await wait(1500);
  ok('чужий рахунок — «Сайт не знайшов такий особовий рахунок»', /не знайшов|не нашёл/.test(await txt('[data-key=lb-err]')), await txt('[data-key=lb-err]'));
  await p.fill('#lb-acc', '74-108-61'); await p.click('[data-key=lb-save]'); await wait(1800);
  ok('підключено: «Автовідправку підключено · Рахунок 74-108-61», сайт знайшов 2 лічильники; на стенд нічого не надіслано', /74-108-61/.test(await txt('[data-key=lb-on]')) && /2/.test(await txt('[data-key=lb-chk]'))
    && (await (await fetch(M + '/__last')).json()) === null, [await txt('[data-key=lb-on]'), await txt('[data-key=lb-chk]'), await txt('[data-key=lb-err]'), await txt('[data-key=lb]')]);
  ok('«Відправити у фоні» і що піде (обидва водоміри)', !!(await p.$('[data-key=lb-bg]')) && /178/.test(await txt('[data-key=lb-bg-note]')) && /441/.test(await txt('[data-key=lb-bg-note]')), await txt('[data-key=lb-bg-note]'));
  if (process.env.SHOT) await (await p.$('[data-key=where-water]')).screenshot({ path: '/tmp/lb_on.png' });
  await p.click('[data-key=lb-bg]'); await wait(1200);
  ok('у черзі: «Надішлемо …», «Скасувати»', /Надішлемо|Отправим/.test(await txt('[data-key=lb-q]')) && !!(await p.$('[data-key=lb-cancel]')), await txt('[data-key=lb-q]'));
  const out = execSync('php ' + path.join(__dirname, '../lb-mock/cron1.php'), { env: Object.assign({}, process.env, { SITE_DATA: DATA }) }).toString();
  const last = await (await fetch(M + '/__last')).json();
  ok('cron: стенд отримав холодну 441 → ind[1] (№ 1234567) і гарячу 178 → ind[2] (№ 7654321)', last && last.ind && last.ind['1'] === '441' && last.ind['2'] === '178', [out, last]);
  await p.reload(); await wait(2500); await where();
  ok('«Сайт прийняв показання» + «перевірить оператор»; запис позначено переданим', /прийняв|принял/.test(await txt('[data-key=lb-done]')) && /оператор/.test(await txt('[data-key=lb-done]'))
    && ((await st()).water.find(w => w.id === 'w20261110').sent || {}).vk, await txt('[data-key=lb-done]'));
  if (process.env.SHOT) await (await p.$('[data-key=where-water]')).screenshot({ path: '/tmp/lb_done.png' });
  await p.setViewportSize({ width: 320, height: 700 }); await wait(300); ok('320 px: без горизонтальної прокрутки', await p.evaluate(() => document.documentElement.scrollWidth <= 321));
  await p.click('[data-key=lb-off]'); await wait(1000);
  ok('«Вимкнути автовідправку» → знову «Підключити»', !!(await p.$('[data-key=lb-open]')));
  // Львівщина, світло: Львівобленерго — лист «код показник» (бот loe); пошта сервісу налаштована (config.php smtp_*), код — з налаштувань лічильника
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.places[0].address = 'м. Львів, вул. Городоцька 1, кв. 3';
    s.places[0].meters = [{ id: 'e1', kind: 'elec', name: '', zones: 1, serial: '0123456', account: '0000011111' }]; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await wait(1500); await p.goto(U + '#elec'); await wait(2500);
  { const el = await p.$('[data-key=where-elec]'); if (el && await el.evaluate(d => d.open === false)) { await (await el.$('summary')).click(); await wait(400); } }
  ok('світло Львова: «Львівобленерго приймає показники на e-mail… потрібен лише код абонента»', /e-mail/.test(await txt('[data-key=lb-lead]')) && !!(await p.$('[data-key=lb-open]')), await txt('[data-key=where-elec]'));
  await p.click('[data-key=lb-open]'); await wait(300);
  ok('форма: «Код абонента (з платіжки)», підставлено код із налаштувань лічильника 0000011111', /Код абонента/.test(await txt('label[for=lb-acc]')) && await p.inputValue('#lb-acc') === '0000011111');
  await p.check('[data-key=lb-consent]'); await p.click('[data-key=lb-save]'); await wait(1200);
  ok('підключено (без заходу на сайт — це e-mail)', /0000011111/.test(await txt('[data-key=lb-on]')), [await txt('[data-key=lb-on]'), await txt('[data-key=lb-err]')]);
  if (process.env.SHOT) await (await p.$('[data-key=where-elec]')).screenshot({ path: '/tmp/lb_elec.png' });
  // Львів, вода (103-я): Львівводоканал — лист у відділ збуту району (бот lvk): вибір району, рахунок, адреса; номери водомірів — з налаштувань
  await where();
  ok('вода Львова: «…на e-mail відділу збуту вашого району»', /відділу збуту|отдела сбыта/.test(await txt('[data-key=lb-lead]')) && !!(await p.$('[data-key=lb-open]')), await txt('[data-key=where-water]'));
  await p.click('[data-key=lb-open]'); await wait(300);
  ok('форма: вибір району (7 відділів збуту + «Оберіть район»), рахунок, адреса', (await p.$$eval('#lb-dist option', o => o.length)) === 8 && !!(await p.$('#lb-acc')) && !!(await p.$('#lb-addr')) && !(await p.$('#lb-phone')));
  await p.fill('#lb-acc', '1234567'); await p.fill('#lb-addr', 'вул. Городоцька, 1, кв. 3'); await p.check('[data-key=lb-consent]'); await p.click('[data-key=lb-save]'); await wait(1000);
  ok('без району — «Оберіть район», введене не стерлося', /район/i.test(await txt('[data-key=lb-err]')) && await p.inputValue('#lb-acc') === '1234567', await txt('[data-key=lb-err]'));
  await p.selectOption('#lb-dist', 'gal'); await p.click('[data-key=lb-save]'); await wait(1200);
  ok('підключено: рахунок 1234567; «Відправити у фоні» — обидва водоміри з номерами', /1234567/.test(await txt('[data-key=lb-on]')) && !!(await p.$('[data-key=lb-bg]:not([disabled])')) && /441/.test(await txt('[data-key=lb-bg-note]')),
    [await txt('[data-key=lb-on]'), await txt('[data-key=lb-err]'), await txt('[data-key=lb]')]);
  if (process.env.SHOT) await (await p.$('[data-key=where-water]')).screenshot({ path: '/tmp/lb_lvk.png' });
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.places[0].water.meters[0].serial = ''; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await wait(1500); await where();
  ok('водомір без номера — «Впишіть номер кожного лічильника…», кнопка неактивна', /номер/.test(await txt('[data-key=lb-serial]')) && !!(await p.$('[data-key=lb-bg][disabled]')), await txt('[data-key=lb]'));
  ok('без помилок JS', !errs.length, errs);
  await b.close(); console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); process.exit(fail ? 1 : 0);
})();
