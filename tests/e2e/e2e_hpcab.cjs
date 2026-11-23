// 182-а (власник 23.11: «разные квартиры — разные подключения к сайтам, где можно в фоне; дадут креды к квартире — введу их для неё»):
// свій вхід ХТМ окремої квартири — «Кабінети й надсилання» → ХТМ → рядок квартири «Свій вхід ХТМ для цієї квартири» → e-mail, пароль, згода →
// сервер: окремий рядок cab_creds 'hp<N>' (extra.place), основний кабінет не чіпаємо; рядок квартири — її вхід, рахунок, «Перевірити», автоподача, «Відв’язати».
// Потрібні: сайт 127.0.0.1:8013 (config.php: 'htm_cab_base' => 'http://127.0.0.1:8099'), стенд ХТМ: cp -r tests/htm-mock /tmp && cd /tmp/htm-mock && php -S 127.0.0.1:8099 -t public public/router.php
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const path = require('path'); const { execFileSync } = require('child_process');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', M = 'http://127.0.0.1:8099', DATA = process.env.SITE_DATA || '/tmp/teplo_data', ROOT = path.resolve(__dirname, '../..');
const stand = body => fetch(M + '/stand/admin', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
const php = code => execFileSync('php', ['-r', `define('TEPLO',1); foreach (['core','telegram','reminders','recognize','admin','vkcab','cabs','htmsvc','vksvc'] as $f) require '${ROOT}/app/'.$f.'.php'; ${code}`], { env: Object.assign({}, process.env, { SITE_DATA: DATA }) }).toString();
const D = '2026-11-12';
(async () => {
  await stand('act=reset'); await stand('act=set&scenario=ok&today=' + D + '&robot_delay=99999&hot=');
  php("Db::q('DELETE FROM rate_limits');");
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await require('./askauto.cjs')(p);
  const wait = ms => p.waitForTimeout(ms), has = async sel => !!(await p.$(sel)), txt = sel => p.textContent(sel).catch(() => '');
  const api = (m, u, body) => p.evaluate(([m, u, body]) => window.TeploSync.api(m, u, body), [m, u, body]);
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(500);
  ok('реєстрація', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'hp' + Date.now() + '@teplo.test') === 200);
  const s0 = demo({ today: D }); const m2 = { modelId: 'sharky774', unit: 'Gcal' };
  s0.places.push({ id: 'p2', v: 2, name: 'Мамина', address: 'вул. Сумська, 10, кв. 5', color: 'violet', meter: m2, baseline: { date: '2025-12-10', energy: '5.001', volume: '900', hours: '20000' }, updatedAt: 1 });
  s0.contacts = { phone: '050 111 22 33', email: '' };
  await p.evaluate(s => { s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, s0); await p.reload(); await wait(1200);
  const cabs = async () => { await p.goto(U + '#prefs-cabs-htm'); await wait(1600); };
  await cabs();

  // 1. основний кабінет не підключено — у кожної квартири «Свій вхід ХТМ для цієї квартири»
  ok('1. ХТМ не підключено: у рядку «Мамина» — «Свій вхід ХТМ для цієї квартири»', /Свій вхід ХТМ для цієї квартири/.test(await txt('[data-key=hp-cb-p2]')) && await has('[data-key=prefs-cab-htm-connect]'), await txt('[data-key=prefs-cab-htm]'));
  await p.click('[data-key=hp-cb-p2]'); await wait(400);
  ok('1. …форма: e-mail порожній (не підставляємо чужу пошту), пароль, згода; назва квартири в підказці', await has('.hp-form[data-pid=p2] #hp-email') && (await p.inputValue('#hp-email')) === '' && /«Мамина»/.test(await txt('.hp-form[data-pid=p2]')));
  await p.click('[data-key=hp-cb-p2-save]'); await wait(300);
  ok('1. …порожньо — підказка в цій же формі', /Впишіть e-mail/.test(await txt('.hp-form[data-pid=p2]')), await txt('.hp-form[data-pid=p2]'));
  await p.fill('#hp-email', 'test@stand.local'); await p.fill('#hp-pass', 'wrong-pass'); await p.check('#hp-consent'); await p.click('[data-key=hp-cb-p2-save]'); await wait(2500);
  ok('1. …невірний пароль — помилка сайту ХТМ у формі квартири (не вгорі блоку), нічого не збережено', /не пустив/.test(await txt('.hp-form[data-pid=p2]')) && !(await api('GET', '/cab/htm')).places, await txt('.hp-form[data-pid=p2]'));
  await p.fill('#hp-pass', 'stand-pass-123'); await p.click('[data-key=hp-cb-p2-save]'); await wait(4500);
  const s1 = await api('GET', '/cab/htm');
  ok('2. правильний пароль — вхід квартири на сервері (places.p2), основний — не підключено', s1.places && s1.places.p2 && s1.places.p2.login === 'test@stand.local' && s1.connected === false, s1);
  ok('2. …рядок квартири: «Свій вхід ХТМ цієї квартири: test@stand.local», рахунок кабінету 1000000061', /Свій вхід ХТМ цієї квартири: test@stand\.local/.test(await txt('[data-key=cb-hp-st-p2]')) && /1000000061/.test(await txt('[data-key=cb-pl-htm-p2]')), await txt('[data-key=cb-pl-htm-p2]'));
  ok('2. …одразу «Перевірити» цим входом: прилад і вікно — у рядку квартири', /Кабінет відповідає|№ 70000061|70000061/.test(await txt('[data-key=cb-pl-htm-p2]')), await txt('[data-key=cb-pl-htm-p2]'));
  ok('2. …плашка блоку «Підключено» (квартира має свій вхід), «Підключити» основного лишилось', /Підключено/.test(await txt('[data-key=prefs-cab-htm] [data-key=cb-st]')) && await has('[data-key=prefs-cab-htm-connect]'), await txt('[data-key=prefs-cab-htm] [data-key=cb-st]'));
  ok('2. …у «Головної» квартири свого входу немає (кнопка лишилась)', await has('[data-key=hp-cb-main]'));
  // автоподача — лише цього входу
  await p.click('[data-key=cb-hp-auto-p2]'); await wait(1500);
  const s2 = await api('GET', '/cab/htm');
  ok('3. автоподача квартири — у її вході (places.p2.auto), основного не стало', s2.places.p2.auto === true && !s2.connected && await p.$eval('[data-key=cb-hp-auto-p2]', x => x.checked));
  // змінити вхід — та сама форма з e-mail входу
  await p.click('[data-key=cb-hp-edit-p2]'); await wait(400);
  ok('4. «Змінити e-mail чи пароль» — форма квартири з її e-mail', (await p.inputValue('#hp-email')) === 'test@stand.local');
  await p.click('[data-key=hp-cb-p2-no]'); await wait(300);
  ok('4. …«Скасувати» — знову рядок входу', await has('[data-key=cb-hp-st-p2]') && !(await has('.hp-form')));
  // вузький екран — без горизонтальної прокрутки
  await p.setViewportSize({ width: 320, height: 700 }); await wait(400);
  ok('5. 320 px — рядок квартири вміщається', await p.evaluate(() => document.documentElement.scrollWidth <= 320), await p.evaluate(() => document.documentElement.scrollWidth));
  if (process.env.SHOT) await (await p.$('[data-key=prefs-cab-htm]')).screenshot({ path: '/tmp/hp_cabs.png' });
  await p.setViewportSize({ width: 390, height: 844 }); await wait(300);
  // відв'язати — лише квартиру
  await p.click('[data-key=cb-hp-off-p2]'); await wait(2000);
  const s3 = await api('GET', '/cab/htm');
  ok('6. «Відв’язати» квартиру — її входу немає, знову кнопка «Свій вхід…»', !s3.places && await has('[data-key=hp-cb-p2]') && !(await has('[data-key=cb-hp-st-p2]')), s3);
  // 182-а: екран квартири — підпис групи «Лічильники» значками (як у «Квартирах»), а не текстом
  await p.goto(U + '#place-p2'); await wait(1500);
  ok('7. екран квартири: «Лічильники» — значками видів, текст лише для читалки', await has('[data-key=pg-pv-meters] .pg-kk .ps-kk .ps-k') && !(await has('[data-key=pg-pv-meters] summary .pg-t .small.muted'))
    && /Опалення|Тепло/i.test(await p.getAttribute('[data-key=pg-pv-meters] .ps-kk', 'aria-label')), await p.$eval('[data-key=pg-pv-meters] summary', x => x.innerHTML).catch(() => ''));
  ok('без помилок JS', errs.length === 0, errs);
  await b.close();
  console.log(`\nИтог: ${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
