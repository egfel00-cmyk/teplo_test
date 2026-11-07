// Вода → Водоканал через сайт (кабинет «без реєстрації», 04.11.2026): «Перевірити на сайті Водоканалу» → что видит сайт (лічильники,
// останні показання) → наші водоміри ↔ лічильники сайту → «Перевірте» → «Відправити на сайт Водоканалу» → «прийнято» → передано
// (підтверджено). Помилка сайту (менше за попередні) — його слова; чужий рахунок — пояснення; кабінет не відкривається — лише бот.
// Нужны: сайт 127.0.0.1:8013 (config.php: 'vk_cab_base' => 'http://127.0.0.1:8098'; 8099 — стенд ХТМ) и синтетический кабинет:
//   php -S 127.0.0.1:8098 tests/vk-mock/router.php        node e2e_vkcab.cjs
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const fs = require('fs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', M = process.env.VK_MOCK || 'http://127.0.0.1:8098', DATA = process.env.SITE_DATA || '/tmp/teplo_data';
const cab = (state) => { const n = Math.floor(Date.now() / 1000); fs.mkdirSync(DATA + '/cache', { recursive: true });
  fs.writeFileSync(DATA + '/cache/vk_status.json', JSON.stringify({ cab: { state, at: n, since: n - 3600, everOk: true, lastOk: state === 'ok' ? n : n - 7200, code: state === 'ok' ? 200 : 0 } })); };
(async () => {
  await fetch(M + '/__reset'); cab('ok');
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  const wait = ms => p.waitForTimeout(ms), vis = async sel => !!(await p.$(sel)) && await p.isVisible(sel);
  const today = new Date().toISOString().slice(0, 10);
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(500);
  ok('регистрация', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'vkc' + Date.now() + '@teplo.test') === 200);
  await p.evaluate(([s, d]) => { delete s.demoToday; s.places[0].water.account = '905614'; s.places[0].water.surname = 'Шевченко';
    s.water.push({ id: 'wnow', place: 'main', date: d, vals: { h1: '176', c1: '440' }, createdAt: d + 'T09:00:00Z', updatedAt: Date.now(), sent: {} }); s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, [demo({}), today]);
  await p.reload(); await wait(1500);
  await p.goto(U + '#wrec-wnow'); await wait(1200); await p.click('[data-key=where-water-sum]'); await wait(300);
  ok('кабинет открывается → в «Куди передати» сверху «Через сайт Водоканалу» с рахунком і прізвищем', await vis('[data-key=vkc]') && /905614/.test(await p.textContent('[data-key=vkc]')) && /Шевченко/.test(await p.textContent('[data-key=vkc]')));
  ok('…бот — запасной, в свёрнутой «Або через бот Водоканалу»', !!(await p.$('[data-key=vk-alt]')) && !(await p.$eval('[data-key=vk-alt]', d => d.open)) && !(await vis('[data-key=wsend-cmd]')));
  ok('до проверки на сайт ничего не уходило', !(await (await fetch(M + '/__store')).json())._last);
  await p.click('[data-key=vkc-check]'); await p.waitForSelector('[data-key=vkc-found]', { timeout: 8000 }).catch(() => {});
  ok('«Перевірити» → «Сайт Водоканалу знайшов рахунок 905614» + адрес', /знайшов рахунок 905614/.test(await p.textContent('[data-key=vkc-found]').catch(() => '')) && /Сумська/.test(await p.textContent('[data-key=vkc-found]').catch(() => '')));
  const mc = await p.textContent('[data-key=vkc-m-c1]'), mh = await p.textContent('[data-key=vkc-m-h1]');
  ok('наші водоміри ↔ лічильники сайту за видом, одним рядком: «На сайті: № 0123456 · Холодна · останні на сайті: 430 (01.10.2026)»', /На сайті: № 0123456 · Холодна · останні на сайті: 430 \(01\.10\.2026\)/.test(mc) && /На сайті: № 0654321 · Гаряча/.test(mh) && !(await p.$('input[name=vkc-c1]')), [mc, mh]);
  ok('…підібрали за видом — підказка «Інший лічильник?»', /за видом/.test(await p.textContent('[data-key=vkc-sum]')));
  await p.click('[data-key=vkc-pick-c1]'); await wait(300);
  const pick = await p.evaluate(() => ({ c1: (document.querySelector('input[name=vkc-c1]:checked') || {}).value, n: document.querySelectorAll('input[name=vkc-c1]').length }));
  ok('«Інший лічильник?» → варіанти з сайту + «Не передавати», вибрано холодну 1282444', pick.c1 === 'DynamicModel[newIndication][1282444]' && pick.n === 3, pick);
  const sum = await p.textContent('[data-key=vkc-sum]');
  ok('«Перевірте перед відправкою»: рахунок, прізвище, обидва показання', /Рахунок 905614 · Шевченко/.test(sum) && /440/.test(sum) && /176/.test(sum), sum);
  await p.click('[data-key=vkc-send]'); await p.waitForSelector('[data-key=vkc-again]', { timeout: 8000 }).catch(() => {});
  let s = await st(); let w = s.water.find(x => x.id === 'wnow'); const store = await (await fetch(M + '/__store')).json();
  ok('«Відправити на сайт Водоканалу» → сайт прийняв → запис «передано» з підтвердженням (via cab)', (w.sent || {}).vk === today && w.vkConf && w.vkConf.via === 'cab' && /прийнято/.test(w.vkConf.text), w);
  ok('…на сайт ушли наши цифры: холодна 440, гаряча 176', JSON.stringify(store._lastPost.post.DynamicModel.newIndication) === JSON.stringify({ 1282444: '440', 1282445: '176' }), store._lastPost);
  ok('…«Підтверджено Водоканалом» і текст сайту, пілюля «передано»', /Підтверджено Водоканалом/.test(await p.textContent('[data-key=vkc]')) && /прийнято/.test(await p.textContent('[data-key=vkc]')) && /передано/i.test(await p.textContent('#wsend-vk .dest-h')));
  ok('…вибір лічильника на сайті запам’ятали (cabKey)', s.places[0].water.meters.find(m => m.id === 'c1').cabKey === 'DynamicModel[newIndication][1282444]');
  // ошибка сайта: меньше прошлых
  await p.evaluate(([d]) => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.water.push({ id: 'wbad', place: 'main', date: d, vals: { c1: '420' }, createdAt: d + 'T10:00:00Z', updatedAt: Date.now(), sent: {} }); s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, [today]);
  await p.reload(); await wait(1200); await p.goto(U + '#wrec-wbad'); await wait(800); await p.click('[data-key=where-water-sum]'); await wait(300);
  await p.click('[data-key=vkc-check]'); await p.waitForSelector('[data-key=vkc-found]', { timeout: 8000 }).catch(() => {});
  ok('показання менше за останні на сайті → попередження до відправки', await vis('[data-key=vkc-less]') && /440/.test(await p.textContent('[data-key=vkc-less]')));
  ok('…у «Перевірте» — лише холодна (гарячої в записі немає)', /420/.test(await p.textContent('[data-key=vkc-sum]')) && !/176/.test(await p.textContent('[data-key=vkc-sum]')));
  await p.click('[data-key=vkc-send]'); await p.waitForSelector('[data-key=vkc-res-err]', { timeout: 8000 }).catch(() => {});
  s = await st(); w = s.water.find(x => x.id === 'wbad');
  ok('сайт не прийняв → його слова, запис не «передано»', await vis('[data-key=vkc-res-err]') && /меншими/.test(await p.textContent('[data-key=vkc-res-err]')) && !(w.sent || {}).vk);
  // чужой рахунок
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.places[0].water.account = '905615'; s.places[0].updatedAt = Date.now(); s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await wait(1200); await p.goto(U + '#wrec-wbad'); await wait(800); await p.click('[data-key=where-water-sum]'); await wait(300);
  ok('рахунок змінився → перевірка заново (нічого не показуємо зі старого)', await vis('[data-key=vkc-check]') && !(await p.$('[data-key=vkc-found]')));
  await p.click('[data-key=vkc-check]'); await p.waitForSelector('[data-key=vkc-err-cab_not_found]', { timeout: 8000 }).catch(() => {});
  ok('чужий рахунок → «не прийняв рахунок 905615 з прізвищем…» і слова сайту «Не коректні дані…»', await vis('[data-key=vkc-err-cab_not_found]') && /905615/.test(await p.textContent('[data-key=vkc-err-cab_not_found]')) && /Не коректні дані/.test(await p.textContent('[data-key=vkc-err-cab_not_found]')));
  // узкий экран
  await p.setViewportSize({ width: 360, height: 780 }); await wait(300);
  ok('360 px — блок не шире экрана', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await p.screenshot({ path: '/tmp/shot_vkc.png', fullPage: false });
  // кабинет не открывается → только бот, как раньше
  cab('down');
  const p2 = await ctx.newPage(); p2.on('pageerror', e => errs.push(e.message)); await p2.goto(U + '#wrec-wnow'); await p2.waitForTimeout(1500); await p2.click('[data-key=where-water-sum]'); await p2.waitForTimeout(300);
  await p2.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); const w = s.water.find(x => x.id === 'wnow'); w.sent = {}; delete w.vkConf; w.updatedAt = Date.now(); s.places[0].water.account = '905614'; localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p2.reload(); await p2.waitForTimeout(1500); await p2.click('[data-key=where-water-sum]'); await p2.waitForTimeout(300);
  ok('кабинет не открывается → блока сайта нет, команда для бота на виду', !(await p2.$('[data-key=vkc]')) && await p2.isVisible('[data-key=wsend-cmd]'));
  cab('ok'); await p2.close();
  // 04.11 (20-я сессия): показаний этого месяца ещё нет — путь «через сайт» виден сразу (раньше был только текст про бота)
  const noRec = async (fn) => { await p.evaluate((src) => { const s = JSON.parse(localStorage.getItem('teplo.v1')); const m = new Date().toISOString().slice(0, 7);
    s.water.forEach(x => { if (String(x.date).slice(0, 7) === m && !x.deleted) { x.deleted = true; x.updatedAt = Date.now(); } }); s.places[0].water.account = '905614'; s.places[0].water.surname = 'Шевченко'; (new Function('s', src))(s);
    s.places[0].updatedAt = Date.now(); s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, fn || ''); await p.reload(); await wait(1200); await p.goto(U + '#water-cold'); await wait(900);
    if (!(await p.$eval('#wacc-where-water', d => d.open).catch(() => true))) { await p.click('[data-key=where-water-sum]'); await wait(300); }
    await p.waitForSelector('[data-key=vk-cab-ok]', { timeout: 6000 }).catch(() => {}); await wait(200); };
  await p.setViewportSize({ width: 390, height: 844 }); await noRec();
  const pre = await p.textContent('#wsend-vk').catch(() => '');
  ok('нет показаний месяца → «Через сайт Водоканалу» с «Перевірити» и «тут з’явиться «Відправити на сайт Водоканалу»»', await vis('[data-key=vkc-check]') && /Відправити на сайт Водоканалу/.test(await p.textContent('[data-key=vk-need-rec]')), pre);
  ok('…без дублів (07.11): «Внести показання води» внутри нет (есть над «Куди передати»), бот — одной кнопкой, без «Або через бот»',
    !(await p.$('#wsend-vk [data-act=wnew]')) && await vis('[data-key=water-add]') && !(await p.$('#wsend-vk [data-key=vk-alt]')) && (pre.match(/hvk_user_bot/g) || []).length === 1, pre);
  await p.click('[data-key=vkc-check]'); await p.waitForSelector('[data-key=vkc-site]', { timeout: 8000 }).catch(() => {});
  const site = await p.textContent('[data-key=vkc-site]').catch(() => '');
  ok('…«Перевірити» без показань → что видит сайт: рахунок, лічильники с последними показаниями, без «Відправити»', /знайшов рахунок 905614/.test(await p.textContent('[data-key=vkc-found]').catch(() => '')) && /№ 0123456 · Холодна · останні на сайті: \d+/.test(site) && !(await p.$('[data-key=vkc-send]')), site);
  await (await p.$('#wsend-vk')).screenshot({ path: '/tmp/shot_vkc_pre.png' }).catch(() => {});
  await p.click('[data-key=water-add]'); await wait(500);
  ok('…«Внести показання» → ввод воды', /wnew/.test(p.url()) || !!(await p.$('[data-key=wn-save], .wiz')), p.url());
  await noRec("s.places[0].water.account = '';");
  // с 06.11 (просьба владельца): полей в блоке нет — «Підключіть сайт Водоканалу…» и равноценная кнопка «Підключити сайт Водоканалу» → #vkcab
  ok('нет рахунку → «Підключіть сайт Водоканалу» и кнопка «Підключити сайт Водоканалу» в ряду каналов', !(await p.$('[data-key=vkc] #w-acc')) && /особовий рахунок і прізвище/.test(await p.textContent('[data-key=vkc]')) && await vis('[data-key=vk-connect]'));
  await p.evaluate(() => window.TeploSync.logout()); await noRec();
  ok('не вошёл → «Увійдіть — і сервіс сам внесе показання на сайті Водоканалу» с кнопкой входа', await vis('[data-key=vkc-login]') && /Увійдіть/.test(await p.textContent('[data-key=vkc]')));
  ok('без ошибок JS', errs.length === 0, errs);
  await b.close();
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); process.exit(fail ? 1 : 0);
})();
