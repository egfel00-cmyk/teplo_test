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
  php("Db::q('DELETE FROM rate_limits');");
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
  ok('0. …«у фоні — коли ввійдете», без «Підключити» й без кнопки фону; «Передати самі» відкрито', await has('[data-key=gw-guest]') && !(await has('[data-key=gw-conn-htm]')) && !(await has('[data-key=gw-bg]'))
    && await p.$eval('[data-key=gw-self]', d => d.open));

  // 1. увійшов, нічого не підключено: «Не передано» + «Підключити ›» і який вхід — у кожного свій
  ok('реєстрація', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'hw' + Date.now() + '@teplo.test') === 200);
  await p.evaluate(([s]) => { s.places[0].water.account = ''; s.places[0].water.surname = ''; s.contacts = { phone: '050 111 22 33' }; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, [demo({ today: D })]);
  await put({ h1: '176', c1: '440' }, 'wnow'); await p.reload(); await wait(1200);
  await hot();
  ok('1. не підключено: ХТМ — «Підключити ›» на екран ХТМ, вхід «e-mail і пароль кабінету ХТМ»', (await p.getAttribute('[data-key=gw-conn-htm]', 'href')) === '#prefs-cabs-htm' && /e-mail і пароль кабінету ХТМ/.test(await txt('[data-key=gw-htm]')), await txt('[data-key=gw-htm]'));
  ok('1. …Водоканал — «Підключити ›» на екран Водоканалу, вхід «особовий рахунок і прізвище»', (await p.getAttribute('[data-key=gw-conn-vk]', 'href')) === '#prefs-cabs-vk' && /особовий рахунок і прізвище/.test(await txt('[data-key=gw-vk]')), await txt('[data-key=gw-vk]'));
  ok('1. …кнопки «Відправити у фоні» немає (нікому), «Передати самі» згорнуто', !(await has('[data-key=gw-bg]')) && !(await p.$eval('[data-key=gw-self]', d => d.open)));
  ok('1. …тексту мало: блок «Куди передати» ≤ 420 знаків без «Передати самі»', await p.$eval('[data-key=where-water]', el => { const c = el.cloneNode(true); c.querySelectorAll('[data-key=gw-self],.trust,.my-link').forEach(x => x.remove()); return c.textContent.replace(/\s+/g, ' ').length; }) <= 420,
    await p.$eval('[data-key=where-water]', el => el.textContent.replace(/\s+/g, ' ').length));
  await p.click('[data-key=gw-conn-htm]'); await wait(1500);
  ok('1. «Підключити ›» ХТМ → екран ХТМ: «Вносимо показання тепла й гарячої води»', /#prefs-cabs-htm$/.test(p.url()) && /тепла й гарячої води/.test(await txt('[data-key=prefs-cab-htm]')), [p.url(), await txt('[data-key=prefs-cab-htm]')]);

  // 2. підключили обидва (як із їхніх екранів): ХТМ — e-mail і пароль; Водоканал — рахунок і прізвище
  ok('2. підключити ХТМ', await p.evaluate(() => window.TeploSync.api('POST', '/cab/htm/connect', { email: 'test@stand.local', password: 'stand-pass-123', phone: '0501112233', consent: true }).then(j => j._status)) === 200);
  ok('2. …сервер одразу знає: у кабінеті є розділ гарячої (1 водомір)', await p.evaluate(() => window.TeploSync.api('GET', '/cab/htm').then(j => { const h = Object.values(j.hot || {})[0]; return !!(h && h.found && h.open && h.n === 1); })));
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.places[0].water.account = '905614'; s.places[0].water.surname = 'Шевченко'; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await wait(1200); await hot(); await wait(800);
  ok('2. обидва підключено: «Не передано», «Підключити» зникло', /Не передано/.test(await txt('[data-key=gw-st-htm]')) && /Не передано/.test(await txt('[data-key=gw-st-vk]')) && !(await has('[data-key=gw-conn-htm]')) && !(await has('[data-key=gw-conn-vk]')),
    [await txt('[data-key=gw-htm]'), await txt('[data-key=gw-vk]')]);
  ok('2. …одна «Відправити у фоні» і що піде: «ХТМ — гаряча 176; Водоканалу — гаряча 176, холодна 440 м³»', await has('[data-key=gw-bg]') && /ХТМ — гаряча 176; Водоканалу — гаряча 176, холодна 440 м³/.test(await txt('[data-key=gw-bg-note]')), await txt('[data-key=gw-bg-note]'));
  if (process.env.SHOT) await (await p.$('[data-key=where-water]')).screenshot({ path: '/tmp/hw_ready.png' });
  await p.setViewportSize({ width: 320, height: 700 }); await wait(300);
  ok('2. 320 px: без горизонтальної прокрутки', await p.evaluate(() => document.documentElement.scrollWidth <= 321));
  await p.setViewportSize({ width: 390, height: 844 }); await wait(300);

  // 3. «Відправити у фоні» → обидва «Надсилаємо…»; на сервері: ХТМ — лише гаряча (№ і цифри), Водоканал — гаряча й холодна однією чергою
  await p.click('[data-key=gw-bg]'); await wait(2500);
  ok('3. після натискання: обидва «Надсилаємо…», кнопки немає', /Надсилаємо/.test(await txt('[data-key=gw-st-htm]')) && /Надсилаємо/.test(await txt('[data-key=gw-st-vk]')) && !(await has('[data-key=gw-bg]')), [await txt('[data-key=gw-st-htm]'), await txt('[data-key=gw-st-vk]')]);
  const hj = await p.evaluate(() => window.TeploSync.api('GET', '/cab/htm').then(j => j.jobs[0]));
  ok('3. ХТМ: черга svc=hot, дата 12.11.2026, лише гаряча — № 20123456 = 176', hj && hj.svc === 'hot' && hj.status === 'queued' && hj.date === '12.11.2026' && JSON.stringify(hj.items.map(x => [x.sn, x.value])) === JSON.stringify([['20123456', '176']]), hj);
  const vj = await p.evaluate(() => window.TeploSync.api('GET', '/vk/jobs').then(j => j.jobs[0]));
  ok('3. Водоканал: одна черга — гаряча й холодна разом', vj && vj.status === 'queued' && vj.rid === 'wnow', vj);
  ok('3. …ще раз натиснути не можна; та сама черга, якщо надіслати з іншого пристрою', await p.evaluate(() => window.TeploSync.api('POST', '/cab/htm/hot', { rid: 'wnow', place: 'main', date: '2026-11-12', items: [{ sn: '20123456', value: '176' }] }).then(j => !!j.dup)));

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
  ok('5. Водоканал уже передано — фон шле лише ХТМ: «ХТМ — гаряча 170»', /^Надішлемо: ХТМ — гаряча 170 м³\.$/.test((await txt('[data-key=gw-bg-note]')).trim()), await txt('[data-key=gw-bg-note]'));
  await p.click('[data-key=gw-bg]'); await wait(2000); cron(); await p.reload(); await wait(1500); await hot(); await wait(2500);
  ok('5. ХТМ — «Не прийнято» і причина «Поточні показання менші за попередні»', /Не прийнято/.test(await txt('[data-key=gw-st-htm]')) && /менші за попередні/.test(await txt('[data-key=gw-why-htm]')), [await txt('[data-key=gw-st-htm]'), await txt('[data-key=gw-why-htm]')]);
  ok('5. …кнопка «Відправити ще раз»', /Відправити ще раз/.test(await txt('[data-key=gw-bg]')), await txt('[data-key=gw-bg]'));

  // 6. «ХТМ перевіряє»: сайт поставив «очікують перевірки» — статус словами, потім cron перечитав журнал → «Прийнято»
  await stand('act=set&scenario=ok&today=' + D + '&robot_delay=99999&hot=pending');
  await put({ h1: '177', c1: '442' }, 'wpend'); await p.reload(); await wait(1200);
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.water.find(x => x.id === 'wpend').sent = { vk: '2026-11-12' }; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await wait(1200); await hot(); await wait(800);
  await p.click('[data-key=gw-bg]'); await wait(2000); cron(); await p.reload(); await wait(1500); await hot(); await wait(2500);
  ok('6. «ХТМ перевіряє»', /ХТМ перевіряє/.test(await txt('[data-key=gw-st-htm]')), await txt('[data-key=gw-st-htm]'));
  await stand('act=robot'); const c6 = cron(3 * 3600); await p.reload(); await wait(1500); await hot(); await wait(2500);
  ok('6. робот ХТМ прийняв → cron перечитав журнал гарячої → «Прийнято»', /Прийнято/.test(await txt('[data-key=gw-st-htm]')) && (await rec('wpend')).sent.htm, [c6, await txt('[data-key=gw-st-htm]')]);

  // 7. у кабінеті розділу гарячої немає (рахунок без гарячої): «Лише ботом», фон — лише Водоканал
  await stand('act=set&scenario=ok&today=' + D + '&robot_delay=99999&hot=off');
  ok('7. «Перевірити» кабінет — розділу гарячої немає', await p.evaluate(() => window.TeploSync.api('POST', '/cab/htm/check', {}).then(j => j.hot && j.hot.found === false)));
  await put({ h1: '178', c1: '443' }, 'woff'); await p.reload(); await wait(1500); await hot(); await wait(800);
  ok('7. ХТМ — «Не передано» і чому («розділу гарячої немає — ботом»); фон — лише Водоканалу', /Не передано/.test(await txt('[data-key=gw-st-htm]')) && /розділу гарячої води немає/.test(await txt('[data-key=gw-nohot]')) && /^Надішлемо: Водоканалу — гаряча 178, холодна 443 м³\.$/.test((await txt('[data-key=gw-bg-note]')).trim()),
    [await txt('[data-key=gw-htm]'), await txt('[data-key=gw-bg-note]')]);
  await p.goto(U + '#prefs-cabs-htm'); await wait(1500);
  ok('7. екран ХТМ: «Гаряча вода: у кабінеті розділу немає — … ботом»', /розділу немає/.test(await txt('[data-key=cb-htm-hot]')), await txt('[data-key=cb-htm-hot]'));

  // 8. «Кабінети й надсилання»: ХТМ — у фоні, «Гаряча вода, Опалення», значок — термометр; холодна сторінка — як була (лише Водоканал)
  await p.goto(U + '#prefs-cabs'); await wait(1500);
  ok('8. ХТМ серед «у фоні»: «Гаряча вода, Опалення»; серед «самі» ХТМ немає', /Гаряча вода, Опалення/.test(await txt('[data-key=cb-row-htm]')) && !/теплові мережі/.test(await txt('[data-key=cb-sec-self]')), await txt('[data-key=cb-row-htm]'));
  await p.goto(U + '#water-cold'); await wait(1500);
  ok('8. сторінка холодної — лише Водоканал (рядків ХТМ немає)', !(await has('[data-key=gw-htm]')) && await has('[data-key=dest-vk]'));

  // 9. ru
  const cr = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' }), pr = await cr.newPage();
  await pr.goto(U); await pr.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(Object.assign(s, { lang: 'ru' }))), demo({ today: D })); await pr.goto(U + '#water-hot'); await pr.reload(); await pr.waitForTimeout(1500);
  const dr = await pr.$('details[data-key=where-water]'); if (dr && !(await dr.evaluate(x => x.open))) { await (await dr.$('summary')).click(); await pr.waitForTimeout(300); }
  const tr = sel => pr.textContent(sel).catch(() => '');
  ok('9. ru: «Горячую воду передаём двоим», «только горячая вода», «холодная и горячая вместе»', /Горячую воду передаём двоим/.test(await tr('[data-key=gw-lead]')) && /только горячая вода/.test(await tr('[data-key=gw-htm]')) && /холодная и горячая вместе/.test(await tr('[data-key=gw-vk]')), await tr('[data-key=where-water]'));

  ok('без помилок сторінки', !errs.length, errs);
  await b.close();
  console.log(`\nИтог: ${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
