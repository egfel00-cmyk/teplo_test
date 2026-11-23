// 178-а (власник 22.11: «гарячу треба подавати і в ХТМ, і у Водоканал, і туди, і туди можна у фоні; холодну — лише у Водоканал; плутанина, який логін куди,
// дуже багато тексту, статус прийнято / не прийнято незрозумілий — спростити першу настройку й відправку у фоні; гарячу в ХТМ — окремо, у Водоканал — разом із холодною»).
// Сторінка гарячої в Харкові: «Куди передати» — два рядки (ХТМ: лише гаряча; Водоканал: холодна й гаряча разом), у кожного один статус; «Підключити ›» з тим, який вхід;
// одна «Відправити у фоні» — обом; «Передати самі» (бот, телефон, цифри) згорнуто. ХТМ — HtmSvc::hotQueue → cron → робот шукає розділ гарячої в кабінеті (стенд: /cabinet/hw).
// Потрібні: сайт 127.0.0.1:8013 (config.php: 'htm_cab_base' => 'http://127.0.0.1:8099', 'vk_cab_base' => 'http://127.0.0.1:8098'),
//   стенд ХТМ: cp -r tests/htm-mock /tmp && cd /tmp/htm-mock && php -S 127.0.0.1:8099 -t public public/router.php · Водоканал: php -S 127.0.0.1:8098 tests/vk-mock/router.php
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', M = 'http://127.0.0.1:8099', VM = 'http://127.0.0.1:8098', DATA = process.env.SITE_DATA || '/tmp/teplo_data', ROOT = path.resolve(__dirname, '../..');
const stand = body => fetch(M + '/stand/admin', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
const php = code => execFileSync('php', ['-r', `define('TEPLO',1); foreach (['core','telegram','reminders','recognize','admin','vkcab','cabs','htmsvc','vksvc'] as $f) require '${ROOT}/app/'.$f.'.php'; ${code}`], { env: Object.assign({}, process.env, { SITE_DATA: DATA }) }).toString();
const cron = (dt) => php(`echo json_encode([HtmSvc::cron(time() + ${dt || 0}), VkSvc::cron()]);`);
const D = '2026-11-12';
(async () => {
  await stand('act=reset'); await stand('act=set&scenario=ok&today=' + D + '&robot_delay=99999&hot='); await fetch(VM + '/__reset');
  const n = Math.floor(Date.now() / 1000); fs.mkdirSync(DATA + '/cache', { recursive: true });
  fs.writeFileSync(DATA + '/cache/vk_status.json', JSON.stringify({ cab: { state: 'ok', at: n, since: n - 3600, everOk: true, lastOk: n, code: 200 } }));
  php("Db::q('DELETE FROM rate_limits'); Db::q('DELETE FROM cab_jobs');");
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const wait = ms => p.waitForTimeout(ms), has = async sel => !!(await p.$(sel)), txt = sel => p.textContent(sel).catch(() => '');
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  const rec = async id => ((await st()).water || []).find(x => x.id === id) || {};
  const hot = async () => { await p.goto(U + '#water-hot'); await wait(1800); const d = await p.$('details[data-key=where-water]'); if (d && !(await d.evaluate(x => x.open))) { await (await d.$('summary')).click(); await wait(300); } };
  const put = async (vals, id) => p.evaluate(([v, d, i]) => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.water = s.water.filter(x => x.date !== d); s.water.push({ id: i, place: 'main', date: d, vals: v, createdAt: d + 'T09:00:00Z', updatedAt: Date.now(), sent: {} }); s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, [vals, D, id]);

  // 0. гість (без входу): два рядки, статуси «Не передано», «Надсилати у фоні можна, коли ввійдете», «Передати самі» відкрито
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(500);
  await p.evaluate(([s]) => { s.places[0].water.account = '905614'; s.places[0].water.surname = 'Шевченко'; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, [demo({ today: D })]);
  await put({ h1: '176', c1: '440' }, 'wnow'); await p.reload(); await wait(800);
  await hot();
  ok('0. гість: ХТМ (лише гаряча) і Водоканал (холодна й гаряча разом) — по рядку, «Не передано»', /ХТМ/.test(await txt('[data-key=gw-htm]')) && /лише гаряча/.test(await txt('[data-key=gw-htm]')) && /холодна й гаряча разом/.test(await txt('[data-key=gw-vk]'))
    && /Не передано/.test(await txt('[data-key=gw-st-htm]')) && /Не передано/.test(await txt('[data-key=gw-st-vk]')), [await txt('[data-key=gw-htm]'), await txt('[data-key=gw-vk]')]);
  ok('0. …«у фоні — коли ввійдете», без «Підключити» й без кнопок; «Передати самі» відкрито', await has('[data-key=gw-guest]') && !(await has('[data-key=gw-conn-htm]')) && !(await has('[data-key^=gw-bg]'))
    && await p.$eval('[data-key=gw-self]', d => d.open));

  // 1. увійшов, нічого не підключено: «Не передано» + «Підключити ›» і який вхід — у кожного свій
  ok('реєстрація', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'hw' + Date.now() + '@teplo.test') === 200);
  await p.evaluate(([s]) => { s.places[0].water.account = ''; s.places[0].water.surname = ''; s.contacts = { phone: '050 111 22 33' }; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, [demo({ today: D })]);
  await put({ h1: '176', c1: '440' }, 'wnow'); await p.reload(); await wait(1200);
  await hot();
  ok('1. не підключено: ХТМ — «Підключити ›» на екран ХТМ, вхід «e-mail і пароль кабінету ХТМ»', (await p.getAttribute('[data-key=gw-conn-htm]', 'href')) === '#pvp-hot-main' && /e-mail і пароль кабінету ХТМ/.test(await txt('[data-key=gw-htm]')), await txt('[data-key=gw-htm]'));
  ok('1. …Водоканал — «Підключити ›» на екран Водоканалу, вхід «особовий рахунок і прізвище»', (await p.getAttribute('[data-key=gw-conn-vk]', 'href')) === '#pvp-water-main' && /особовий рахунок і прізвище/.test(await txt('[data-key=gw-vk]')), await txt('[data-key=gw-vk]'));
  ok('1. …кнопок «Надіслати» немає (нікому), «Передати самі» згорнуто', !(await has('[data-key^=gw-bg]')) && !(await p.$eval('[data-key=gw-self]', d => d.open)));
  ok('1. …тексту мало: блок «Куди передати» ≤ 420 знаків без «Передати самі»', await p.$eval('[data-key=where-water]', el => { const c = el.cloneNode(true); c.querySelectorAll('[data-key=gw-self],.trust,.my-link').forEach(x => x.remove()); return c.textContent.replace(/\s+/g, ' ').length; }) <= 420,
    await p.$eval('[data-key=where-water]', el => el.textContent.replace(/\s+/g, ' ').length));
  await p.click('[data-key=gw-conn-htm]'); await wait(1500);
  ok('1. «Підключити ›» ХТМ → екран постачальника гарячої квартири (185-я): «Вносимо показання тепла й гарячої води»', /#pvp-hot-main$/.test(p.url()) && /тепла й гарячої води/.test(await txt('[data-key=prefs-cab-htm]')), [p.url(), await txt('[data-key=prefs-cab-htm]')]);

  // 2. підключили обидва (як із їхніх екранів): ХТМ — e-mail і пароль; Водоканал — рахунок і прізвище
  ok('2. підключити ХТМ', await p.evaluate(() => window.TeploSync.api('POST', '/cab/htm/connect', { email: 'test@stand.local', password: 'stand-pass-123', phone: '0501112233', consent: true }).then(j => j._status)) === 200);
  ok('2. …сервер одразу знає: у кабінеті є розділ гарячої (1 водомір)', await p.evaluate(() => window.TeploSync.api('GET', '/cab/htm').then(j => { const h = Object.values(j.hot || {})[0]; return !!(h && h.found && h.open && h.n === 1); })));
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.places[0].water.account = '905614'; s.places[0].water.surname = 'Шевченко'; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await wait(1200); await hot(); await wait(800);
  ok('2. обидва підключено: «Не передано», «Підключити» зникло', /Не передано/.test(await txt('[data-key=gw-st-htm]')) && /Не передано/.test(await txt('[data-key=gw-st-vk]')) && !(await has('[data-key=gw-conn-htm]')) && !(await has('[data-key=gw-conn-vk]')),
    [await txt('[data-key=gw-htm]'), await txt('[data-key=gw-vk]')]);
  ok('2. 180-я: у кожного своя кнопка — «Надіслати в ХТМ» і «Надіслати у Водоканал»', /Надіслати в ХТМ/.test(await txt('[data-key=gw-bg-htm]')) && /Надіслати у Водоканал/.test(await txt('[data-key=gw-bg-vk]')) && !(await has('[data-key=gw-bg]')));
  ok('2. …у рядку — що піде: ХТМ «гаряча 176 м³», Водоканал «гаряча 176; холодна 440 м³»', /^Надішлемо: гаряча 176 м³\.$/.test((await txt('[data-key=gw-what-htm]')).trim()) && /^Надішлемо: гаряча 176; холодна 440 м³\.$/.test((await txt('[data-key=gw-what-vk]')).trim()), [await txt('[data-key=gw-what-htm]'), await txt('[data-key=gw-what-vk]')]);
  if (process.env.SHOT) await (await p.$('[data-key=where-water]')).screenshot({ path: '/tmp/hw_ready.png' });
  await p.setViewportSize({ width: 320, height: 700 }); await wait(300);
  ok('2. 320 px: без горизонтальної прокрутки', await p.evaluate(() => document.documentElement.scrollWidth <= 321));
  await p.setViewportSize({ width: 390, height: 844 }); await wait(300);

  // 3. «Відправити у фоні» → обидва «Надсилаємо…»; на сервері: ХТМ — лише гаряча (№ і цифри), Водоканал — гаряча й холодна однією чергою
  await p.click('[data-key=gw-bg-htm]'); await wait(2500);
  ok('3. «Надіслати в ХТМ» — лише ХТМ «Надсилаємо…»; Водоканал окремо: «Не передано» і своя кнопка', /Надсилаємо/.test(await txt('[data-key=gw-st-htm]')) && /Не передано/.test(await txt('[data-key=gw-st-vk]')) && !(await has('[data-key=gw-bg-htm]')) && await has('[data-key=gw-bg-vk]'), [await txt('[data-key=gw-st-htm]'), await txt('[data-key=gw-st-vk]')]);
  await p.click('[data-key=gw-bg-vk]'); await wait(2500);
  ok('3. «Надіслати у Водоканал» — тепер і він «Надсилаємо…»', /Надсилаємо/.test(await txt('[data-key=gw-st-vk]')) && !(await has('[data-key=gw-bg-vk]')), await txt('[data-key=gw-st-vk]'));
  const hj = await p.evaluate(() => window.TeploSync.api('GET', '/cab/htm').then(j => j.jobs[0]));
  ok('3. ХТМ: черга svc=hot, дата 12.11.2026, лише гаряча — № 20123456 = 176', hj && hj.svc === 'hot' && hj.status === 'queued' && hj.date === '12.11.2026' && JSON.stringify(hj.items.map(x => [x.sn, x.value])) === JSON.stringify([['20123456', '176']]), hj);
  const vj = await p.evaluate(() => window.TeploSync.api('GET', '/vk/jobs').then(j => j.jobs[0]));
  ok('3. Водоканал: одна черга — гаряча й холодна разом', vj && vj.status === 'queued' && vj.rid === 'wnow', vj);
  ok('3. …ще раз натиснути не можна; та сама черга, якщо надіслати з іншого пристрою', await p.evaluate(a => window.TeploSync.api('POST', '/cab/htm/hot', { acc: a, rid: 'wnow', place: 'main', date: '2026-11-12', items: [{ sn: '20123456', value: '176' }] }).then(j => !!j.dup), hj.acc));
  ok('3. 180-я: без рахунку ХТМ гарячу не беремо («єдиний у кабінеті» може бути від іншої квартири)', await p.evaluate(() => window.TeploSync.api('POST', '/cab/htm/hot', { rid: 'wnow', place: 'main', date: '2026-11-12', items: [{ sn: '20123456', value: '176' }] }).then(j => j.error)) === 'cab_hot_acc');

  // 4. cron (за хвилину): робот увійшов, знайшов розділ гарячої, вніс; Водоканал — теж → «Прийнято 12 листопада» в обох, запис — передано
  const c1 = cron(); ok('4. cron: ХТМ «auto ok», Водоканал ok', /auto ok/.test(c1) && /"ok"/.test(c1), c1);
  await p.reload(); await wait(1500); await hot(); await wait(2500);
  ok('4. обидва — «Прийнято 12 листопада»', /Прийнято 12 листопада/.test(await txt('[data-key=gw-st-htm]')) && /Прийнято 12 листопада/.test(await txt('[data-key=gw-st-vk]')), [await txt('[data-key=gw-st-htm]'), await txt('[data-key=gw-st-vk]')]);
  let r = await rec('wnow');
  ok('4. запис: sent.htm і sent.vk, htmConf (кабінет), htmJob ok', r.sent && r.sent.htm && r.sent.vk && r.htmConf && r.htmConf.via === 'cab' && r.htmJob && r.htmJob.status === 'ok', r);
  const sj = await (await fetch(M + '/stand/state')).json();
  ok('4. стенд ХТМ: у журналі гарячої — 12.11, 176, «прийнято»', sj.hot_journal.length === 1 && sj.hot_journal[0].vals[0] === '176' && sj.hot_journal[0].status === 'ok', sj.hot_journal);
  ok('4. історія гарячої: запис «Передано» (обом)', /Передано/.test(await txt('[data-key=water-history-hot]')), await txt('[data-key=water-history-hot]'));

  // 5. ХТМ не прийняв (менше за попередні): «Не прийнято» + причина словами сайту, «Відправити ще раз»
  await stand('act=set&scenario=ok&today=' + D + '&robot_delay=99999&hot=reject');
  await put({ h1: '170', c1: '441' }, 'wbad'); await p.reload(); await wait(1200);
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); const w = s.water.find(x => x.id === 'wbad'); w.sent = { vk: '2026-11-12' }; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await wait(1200); await hot(); await wait(800);
  ok('5. Водоканал уже передано — кнопка лише в ХТМ: «гаряча 170»', /^Надішлемо: гаряча 170 м³\.$/.test((await txt('[data-key=gw-what-htm]')).trim()) && !(await has('[data-key=gw-bg-vk]')), await txt('[data-key=gw-what-htm]'));
  await p.click('[data-key=gw-bg-htm]'); await wait(2000); cron(); await p.reload(); await wait(1500); await hot(); await wait(2500);
  ok('5. ХТМ — «Не прийнято» і причина «Поточні показання менші за попередні»', /Не прийнято/.test(await txt('[data-key=gw-st-htm]')) && /менші за попередні/.test(await txt('[data-key=gw-why-htm]')), [await txt('[data-key=gw-st-htm]'), await txt('[data-key=gw-why-htm]')]);
  ok('5. …кнопка «Відправити ще раз» у рядку ХТМ', /Відправити ще раз/.test(await txt('[data-key=gw-bg-htm]')), await txt('[data-key=gw-bg-htm]'));

  // 6. «ХТМ перевіряє»: сайт поставив «очікують перевірки» — статус словами, потім cron перечитав журнал → «Прийнято»
  await stand('act=set&scenario=ok&today=' + D + '&robot_delay=99999&hot=pending');
  await put({ h1: '177', c1: '442' }, 'wpend'); await p.reload(); await wait(1200);
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.water.find(x => x.id === 'wpend').sent = { vk: '2026-11-12' }; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await wait(1200); await hot(); await wait(800);
  await p.click('[data-key=gw-bg-htm]'); await wait(2000); cron(); await p.reload(); await wait(1500); await hot(); await wait(2500);
  ok('6. «ХТМ перевіряє»', /ХТМ перевіряє/.test(await txt('[data-key=gw-st-htm]')), await txt('[data-key=gw-st-htm]'));
  await stand('act=robot'); const c6 = cron(3 * 3600); await p.reload(); await wait(1500); await hot(); await wait(2500);
  ok('6. робот ХТМ прийняв → cron перечитав журнал гарячої → «Прийнято»', /Прийнято/.test(await txt('[data-key=gw-st-htm]')) && (await rec('wpend')).sent.htm, [c6, await txt('[data-key=gw-st-htm]')]);

  // 7. у кабінеті розділу гарячої немає (рахунок без гарячої): «Лише ботом», фон — лише Водоканал
  await stand('act=set&scenario=ok&today=' + D + '&robot_delay=99999&hot=off');
  ok('7. «Перевірити» кабінет — розділу гарячої немає', await p.evaluate(() => window.TeploSync.api('POST', '/cab/htm/check', {}).then(j => j.hot && j.hot.found === false)));
  await put({ h1: '178', c1: '443' }, 'woff'); await p.reload(); await wait(1500); await hot(); await wait(800);
  ok('7. ХТМ — «Лише ботом», одна причина (без повтору) і тут же бот, телефон, «Я передав(ла)»; кнопки ХТМ немає', /Лише ботом/.test(await txt('[data-key=gw-st-htm]')) && /розділу гарячої води немає/.test(await txt('[data-key=gw-why-htm]'))
    && (await p.$$('[data-key=gw-htm] .gw-why')).length === 1 && await has('[data-key=gw-nohot-bot]') && await has('[data-key=gw-nohot-tel]') && await has('[data-key=gw-nohot-mark]') && !(await has('[data-key=gw-bg-htm]')), await txt('[data-key=gw-htm]'));
  ok('7. …Водоканал — своєю кнопкою: «гаряча 178; холодна 443 м³»', /^Надішлемо: гаряча 178; холодна 443 м³\.$/.test((await txt('[data-key=gw-what-vk]')).trim()), await txt('[data-key=gw-what-vk]'));
  // 7б. 180-я: рахунок гарячої — не з цього кабінету (спільна квартира учасника): що не так і поле рахунку тут же, рахунки кабінету — кнопками
  await stand('act=set&scenario=ok&today=' + D + '&robot_delay=99999&hot=');
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.places[0].water.acc = Object.assign({}, s.places[0].water.acc || {}, { hot: '999999' }); s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await wait(1500); await hot(); await wait(1500);
  ok('7б. рахунок 999999 не в кабінеті: «немає у вашому кабінеті ХТМ», поле рахунку й рахунок кабінету кнопкою; кнопки ХТМ немає', /Рахунку 999999 немає в кабінеті ХТМ цієї квартири/.test(await txt('[data-key=gw-why-htm]')) && await has('#gw-hacc') && (await p.$$('[data-act=gw-acc-pick]')).length >= 1 && !(await has('[data-key=gw-bg-htm]')), await txt('[data-key=gw-htm]'));
  if (process.env.SHOT) await (await p.$('[data-key=where-water]')).screenshot({ path: '/tmp/hw_foreign.png' });
  await (await p.$('[data-act=gw-acc-pick]')).click(); await wait(800);
  ok('7б. натиснув рахунок кабінету — збережено, «немає у вашому кабінеті» зникло (далі — як є в кабінеті: тут розділу гарячої немає → бот)', !/немає в кабінеті ХТМ цієї квартири/.test(await txt('[data-key=gw-htm]')) && /^\d{5,}$/.test(((await st()).places[0].water.acc || {}).hot || '') && (await has('[data-key=gw-bg-htm]') || await has('[data-key=gw-nohot-bot]')), [((await st()).places[0].water.acc || {}), await txt('[data-key=gw-htm]')]);
  // 7в. Водоканал: «який лічильник який» — вибір прямо в рядку (лічильники сайту прийшли з невдалої черги)
  const uid = await p.evaluate(() => window.TeploSync.api('GET', '/me').then(j => (j.user || {}).id));
  php(`Db::q("INSERT INTO cab_jobs (user_id, prov, acc, payload, status, result, tries, next_at, created_at, updated_at) VALUES (${uid}, 'vk', '905614', ?, 'failed', ?, 0, 0, ?, ?)", [json_encode(['rid' => 'woff', 'place' => 'main', 'items' => []]), json_encode(['why' => 'which', 'human' => 'x', 'meters' => [['key' => 'k1', 'label' => '№ 111 гаряча', 'kind' => 'hot', 'serial' => '111', 'prev' => 170], ['key' => 'k2', 'label' => '№ 222 холодна', 'kind' => 'cold', 'serial' => '222', 'prev' => 430]]]), Http::iso(), Http::iso()]); echo Db::id();`);
  const jid = +php(`echo Db::one("SELECT MAX(id) AS m FROM cab_jobs WHERE prov = 'vk'")['m'];`);
  await p.evaluate(j => { const s = JSON.parse(localStorage.getItem('teplo.v1')); const w = s.water.find(x => x.id === 'woff'); w.vkJob = { job: j, status: 'failed' }; w.sent = {}; s.places[0].water.meters.forEach(m => { delete m.cabKey; }); s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, jid);
  await p.reload(); await wait(1500); await hot(); await wait(2500);
  ok('7в. Водоканал «Не надіслано»: підібрано самі — «Підібрали… перевірте», лічильники сайту одним рядком і по випадному списку на свій водомір (180-я, друга правка)', /Підібрали, який лічильник сайту який/.test(await txt('[data-key=gw-why-vk]')) && /лічильників з полем: 2 \(гаряча: № 111; холодна: № 222\)/.test(await txt('[data-key=gw-pick]')) && (await p.$$('[data-key=gw-pick] select')).length === 2 && !(await p.$('[data-key=gw-pick] input[type=radio]')), await txt('[data-key=gw-vk]'));
  if (process.env.SHOT) await (await p.$('[data-key=where-water]')).screenshot({ path: '/tmp/hw_pick.png' });
  const hid = await p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')).places[0].water.meters.find(m => m.kind === 'hot').id);
  ok('7в. у гарячої — лише гарячий лічильник сайту й «Не надсилати»', JSON.stringify(await p.$$eval(`[data-key=gw-pick-${hid}] option`, o => o.map(x => x.value))) === JSON.stringify(['k1', '']));
  await p.selectOption(`[data-key=gw-pick-${hid}] select`, ''); await wait(700);
  const cid = await p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')).places[0].water.meters.find(m => m.kind === 'cold').id);
  ok('7в. гарячу «Не надсилати» — збережено; у «Надішлемо» Водоканалу лишилась лише холодна', ((await st()).places[0].water.meters.find(m => m.id === hid) || {}).cabKey === '' && /^Надішлемо: холодна 443 м³\.$/.test((await txt('[data-key=gw-what-vk]')).trim()), await txt('[data-key=gw-vk]'));
  await p.selectOption(`[data-key=gw-pick-${hid}] select`, 'k1'); await wait(700);
  ok('7в. вибрав правильний — збережено як ключ сайту водоміра, попередження немає; «Відправити ще раз» у рядку Водоканалу', ((await st()).places[0].water.meters.find(m => m.id === hid) || {}).cabKey === 'k1' && !(await has('[data-key=gw-pick-dup]')) && /Відправити ще раз/.test(await txt('[data-key=gw-bg-vk]')), await txt('[data-key=gw-vk]'));
  // 7г. 181-я (власник 23.11, скріни): 4 водоміри, на сайті 3 з полем (кімната в номері: Хкух, Гс/у, Гкух) + холодна ванна вже прийнята (без поля);
  // у «Холодна · Кухня» номер 796991 — а на сайті це Гкух. Підбір сам: за кімнатою й видом; прийнятий — рядком «уже прийняв», не надсилаємо; номер іншого виду — попередження
  const L = (k, n, v) => (k === 'hot' ? 'Гаряча' : 'Холодна') + ' вода (№ ' + n + ') · дата наступної повірки - 12 грудня 2027 р. · ' + v + ' Передані показання за жовтень 2026 , м3: · Вкажіть нові показання за листопад 2026, м3 * :';
  php(`Db::q("INSERT INTO cab_jobs (user_id, prov, acc, payload, status, result, tries, next_at, created_at, updated_at) VALUES (${uid}, 'vk', '905614', ?, 'failed', ?, 0, 0, ?, ?)", [json_encode(['rid' => 'w4', 'place' => 'main', 'items' => []]), json_encode(['why' => 'which', 'human' => 'x', 'meters' => [
    ['key' => 'kc', 'label' => '${L('cold', 'Хкух 847046', '459.123')}', 'kind' => 'cold', 'serial' => '847046', 'room' => 'kitchen', 'prev' => 459.123],
    ['key' => 'khb', 'label' => '${L('hot', 'Гс/у 79109406', '0.412')}', 'kind' => 'hot', 'serial' => '79109406', 'room' => 'bath', 'prev' => 0.412],
    ['key' => 'khk', 'label' => '${L('hot', 'Гкух 796991', '175.880')}', 'kind' => 'hot', 'serial' => '796991'],
  ], 'done' => [['kind' => 'cold', 'serial' => '79539995', 'value' => 201.0, 'period' => '2026-11', 'accepted' => true, 'verify' => null]]]), Http::iso(), Http::iso()]);`);
  const j4 = +php(`echo Db::one("SELECT MAX(id) AS m FROM cab_jobs WHERE prov = 'vk'")['m'];`);
  await p.evaluate(j => { const s = JSON.parse(localStorage.getItem('teplo.v1')); const w = s.places[0].water;
    w.meters = [{ id: 'h1', kind: 'hot', name: 'Кухня', cabKey: 'kc' }, { id: 'h2', kind: 'hot', name: 'Ванна', serial: '79109406' }, { id: 'c1', kind: 'cold', name: 'Кухня', serial: '796991', cabKey: 'kc' }, { id: 'c2', kind: 'cold', name: 'Ванна', serial: '79539995', cabKey: 'kc' }];
    s.water = s.water.filter(x => x.id !== 'w4'); s.water.push({ id: 'w4', place: 'main', date: '2026-11-12', vals: { h1: 176, h2: 0, c1: 459, c2: 201 }, vkJob: { job: j, status: 'failed' }, sent: {}, createdAt: '2026-11-12T09:00:00Z', updatedAt: Date.now() });
    s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, j4);
  await p.reload(); await wait(1500); await hot(); await wait(2500);
  const sel = id => p.$eval(`[data-key=gw-pick-${id}] select`, x => x.value).catch(() => null);
  ok('7г. підбір: гаряча кухня → Гкух (старий ключ холодної відкинуто), ванна → Гс/у, холодна кухня → Хкух; дубля немає', await sel('h1') === 'khk' && await sel('h2') === 'khb' && await sel('c1') === 'kc' && !(await has('[data-key=gw-pick-dup]')), [await sel('h1'), await sel('h2'), await sel('c1'), await txt('[data-key=gw-pick]')]);
  ok('7г. холодна ванна — «Сайт уже прийняв … № 79539995 — 201 м³», без вибору', /Сайт уже прийняв за цей місяць: № 79539995 — 201 м³/.test(await txt('[data-key=gw-pick-done-c2]')) && !(await has('[data-key=gw-pick-c2] select')), await txt('[data-key=gw-pick-c2]'));
  ok('7г. «Холодна · Кухня № 796991» — на сайті це гаряча · кухня: попередження', /№ 796991 на сайті Водоканалу — гаряча · кухня/.test(await txt('[data-key=gw-pick-sn-c1]')), await txt('[data-key=gw-pick-c1]'));
  ok('7г. у списку — кімната й «було»: «№ 847046 · кухня · було 459 м³»; зверху — з кімнатами', JSON.stringify(await p.$$eval('[data-key=gw-pick-c1] option', o => o.map(x => x.textContent))).includes('№ 847046 · кухня · було 459 м³') && /гаряча: № 79109406 · санвузол, № 796991 · кухня; холодна: № 847046 · кухня/.test(await txt('[data-key=gw-pick]')), await txt('[data-key=gw-pick]'));
  ok('7г. «Надішлемо» — три, без прийнятої ванни', /^Надішлемо: гаряча Кухня 176 · Ванна 0; холодна 459 м³\.$/.test((await txt('[data-key=gw-what-vk]')).trim()), await txt('[data-key=gw-what-vk]'));
  if (process.env.SHOT) await (await p.$('[data-key=gw-vk]')).screenshot({ path: '/tmp/hw_pick4.png' });
  await p.click('[data-key=gw-bg-vk]'); await wait(1500);
  const pj = JSON.parse(php(`echo Db::one("SELECT payload FROM cab_jobs WHERE prov = 'vk' ORDER BY id DESC LIMIT 1")['payload'];`));
  const keys = (await st()).places[0].water.meters.reduce((a, m) => (a[m.id] = m.cabKey, a), {});
  ok('7г. «Відправити ще раз»: у черзі три (без прийнятої); підбір збережено у водомірах (наступного місяця у фоні — так само)', JSON.stringify((pj.items || []).map(x => x.name)) === JSON.stringify(['Гаряча · Кухня', 'Гаряча · Ванна', 'Холодна · Кухня']) && keys.h1 === 'khk' && keys.h2 === 'khb' && keys.c1 === 'kc' && keys.c2 === 'kc', [pj.items, keys]);
  // 7д. 182-а: налаштування водоміра — «На сайті Водоканалу»: який лічильник сайту (№, кімната, було), змінити чи «Підберемо самі» (скинути cabKey)
  await p.goto(U + '#water-hot'); await p.reload(); await wait(1800);
  const wcs = await p.$$('[data-key^=wcab-] select');
  const wc0 = wcs[0] ? await wcs[0].evaluate(s => ({ id: s.getAttribute('data-wm'), v: s.value, n: s.options.length, t: [...s.options].map(o => o.text) })) : null;
  ok('7д. налаштування водоміра: «На сайті Водоканалу» — лічильники сайту з № і кімнатою, підібране вже вибране', !!wc0 && wc0.n >= 3 && wc0.t.some(x => /№ \d/.test(x)) && wc0.v !== '*' && wc0.v !== '', wc0);
  await wcs[0].evaluate(s => { for (let d = s.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true; }); await wait(400);
  await (await p.$(`#wcab-${wc0.id}`)).selectOption('*'); await wait(600);
  const cab0 = await p.evaluate(id => { const s = JSON.parse(localStorage.getItem('teplo.v1')); return s.places[0].water.meters.find(m => m.id === id); }, wc0 && wc0.id);
  ok('7д. …«Підберемо самі» — вибір скинуто (cabKey немає, а не «Не надсилати»)', cab0 && !('cabKey' in cab0), cab0);
  await p.goto(U + '#prefs-cabs-htm'); await wait(1500);
  ok('7. екран ХТМ: «Гаряча вода: у кабінеті розділу немає — … ботом»', /розділу немає/.test(await txt('[data-key=cb-htm-hot]')), await txt('[data-key=cb-htm-hot]'));

  // 8. «Кабінети й надсилання»: ХТМ — у фоні, «Гаряча вода, Опалення», значок — термометр; холодна сторінка — як була (лише Водоканал)
  await p.goto(U + '#prefs-cabs'); await wait(1500);
  ok('8. 185-я: гаряча й тепло квартири — ХТМ, «у фоні»', /теплові мережі/.test(await txt('[data-key=cb-row-hot-main]')) && /теплові мережі/.test(await txt('[data-key=cb-row-heat-main]')) && /у фоні/.test(await txt('[data-key=cb-row-hot-main]')), await txt('[data-key=cb-sec-main]'));
  await p.goto(U + '#water-cold'); await wait(1500);
  ok('8. сторінка холодної — лише Водоканал (рядків ХТМ немає)', !(await has('[data-key=gw-htm]')) && await has('[data-key=dest-vk]'));

  // 9. ru
  const cr = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' }), pr = await cr.newPage();
  await pr.goto(U); await pr.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(Object.assign(s, { lang: 'ru' }))), demo({ today: D })); await pr.goto(U + '#water-hot'); await pr.reload(); await pr.waitForTimeout(1500);
  const dr = await pr.$('details[data-key=where-water]'); if (dr && !(await dr.evaluate(x => x.open))) { await (await dr.$('summary')).click(); await pr.waitForTimeout(300); }
  const tr = sel => pr.textContent(sel).catch(() => '');
  ok('9. ru: «Горячую воду принимают двое», «только горячая вода», «холодная и горячая вместе»', /Горячую воду принимают двое/.test(await tr('[data-key=gw-lead]')) && /только горячая вода/.test(await tr('[data-key=gw-htm]')) && /холодная и горячая вместе/.test(await tr('[data-key=gw-vk]')), await tr('[data-key=where-water]'));

  // 9б. 181-я: Водоканал прийняв, ХТМ — ні: під табло гарячої — по адресатах, коротко
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); const w = s.water.find(x => x.id === 'w4'); w.sent = { vk: '2026-11-12' }; w.vkConf = { at: 1, via: 'cab' }; w.updatedAt = Date.now(); s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.goto(U + '#water-hot'); await p.reload(); await wait(1500);
  ok('9б. гаряча: «Водоканал прийняв 12 листопада · ХТМ — ще ні» під табло', /Водоканал прийняв 12 листопада · ХТМ — ще ні/.test(await txt('[data-key=wmeter-h1]')), await txt('[data-key=wmeter-h1]'));

  // 9в. 182-а: запис історії гарячої — ті самі окремі рядки ХТМ і Водоканалу (не старий блок «Куди передати»)
  await p.goto(U + '#wrec-w4'); await p.reload(); await wait(1800);
  ok('9в. запис історії: рядки ХТМ і Водоканалу, як на сторінці гарячої; статус Водоканалу «Прийнято»', await has('[data-key=gw-htm]') && await has('[data-key=gw-vk]') && /Прийнято/.test(await txt('[data-key=gw-st-vk]')) && !(await has('[data-key=dest-vk]')),
    [await txt('[data-key=gw-htm]'), await txt('[data-key=gw-vk]')]);

  // 10. 181-я (власник 23.11, скрін: «это не моя квартира, не мой лицевой счёт, не мои креды — зачем мне тут видеть свой аккаунт»): спільна квартира учасника —
  // свій кабінет ХТМ не пропонуємо (ні пошти, ні рахунків кнопками, ні «Підключити»); власник не дозволив — «попросіть» і «Передати самі»
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); const pl = s.places[0]; pl.sh = { sid: 9, role: 'member', me: 1, n: 2, own: 'Олена Коваль', ownId: 77, ppl: [], at: 1, bg: false };
    pl.water.acc = {}; if (pl.meter) pl.meter.account = ''; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await wait(1500); await hot(); await wait(1800);
  const gh = await txt('[data-key=gw-htm]');
  // 183-я (власник 23.11, скрін: «даже не упоминай меня тут — у каждой квартиры свой вход для всех поставщиков»): без імен людей і без старої невдачі чужим кабінетом
  ok('10. учасник: у рядку ХТМ — «Вхід ХТМ цієї квартири не підключено» і кнопка входу квартири; ні імен, ні «у вашому кабінеті немає гарячої», ні своєї пошти й рахунків', /Вхід ХТМ цієї квартири не підключено/.test(gh) && !/Олена|може дозволити|немає розділу/.test(gh) && !/@/.test(gh) && !(await has('[data-act=gw-acc-pick]')) && !(await has('#gw-hacc')) && !(await has('[data-key=gw-conn-htm]')) && !(await has('[data-key=gw-bg-htm]')), gh);
  if (process.env.SHOT) await (await p.$('[data-key=gw-htm]')).screenshot({ path: '/tmp/hw_member.png' });
  await p.goto(U + '#prefs-cabs-htm'); await wait(1500);
  const pid0 = await p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')).places[0].id);
  ok('10. екран ХТМ у «Кабінетах»: квартира учасника — «Вхід ХТМ цієї квартири не підключено», без імен і без вибору моїх рахунків', /Вхід ХТМ цієї квартири не підключено/.test(await txt(`[data-key=cb-pl-htm-${pid0}]`)) && !/Олена/.test(await txt(`[data-key=cb-pl-htm-${pid0}]`)) && !(await has(`[data-key=cb-hacc-${pid0}] select, select[data-key=cb-hacc-${pid0}]`)), await txt(`[data-key=cb-pl-htm-${pid0}]`));

  // 10б. 182-а: учасник вписав свій вхід ХТМ саме цієї квартири — у рядку ХТМ «Надсилаємо входом цієї квартири», не «Олена може дозволити»
  await p.goto(U + '#water-hot'); await p.reload(); await wait(1500); await hot(); await wait(1500);
  ok('10б. учасник без входу: у рядку ХТМ — кнопка «Підключити вхід ХТМ цієї квартири»', /Підключити вхід ХТМ цієї квартири/.test(await txt(`[data-key=hp-gw-${pid0}]`)), await txt('[data-key=gw-htm]'));
  ok('10б. …вхід квартири підключено (той самий стенд)', await p.evaluate(pid => window.TeploSync.api('POST', '/cab/htm/connect', { email: 'test@stand.local', password: 'stand-pass-123', consent: true, place: pid }).then(j => j._status), pid0) === 200);
  await p.reload(); await wait(1500); await hot(); await wait(1800);
  const gh2 = await txt('[data-key=gw-htm]');
  ok('10б. …рядок ХТМ — входом квартири (test@stand.local), без імен', !/Олена/.test(gh2) && /test@stand\.local/.test(gh2), gh2);
  await p.evaluate(pid => window.TeploSync.api('POST', '/cab/forget', { prov: 'htm', place: pid }), pid0);

  ok('без помилок сторінки', !errs.length, errs);
  await b.close();
  console.log(`\nИтог: ${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
