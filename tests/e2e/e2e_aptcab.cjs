// 185-я (власник 23.11 18:06: «в одной квартире одни креды для ХТМ, для другой — другие; и так со всеми поставщиками — кабинеты и отправка внутри настроек квартиры»):
// екран постачальника квартири #pvp-<вид>-<квартира> — першим блок «Передача показань» саме цієї квартири; дві квартири — у кожної свій вхід ХТМ і свої рахунок і прізвище
// Водоканалу, «у фоні» Водоканалу — по квартирі; «Кабінети й надсилання» — квартири розділами; кілька водомірів виду — у кожного однаковий набір налаштувань.
// Потрібні: сайт 8013 і стенд ХТМ 8099 — bash tests/e2e/stand.sh up.
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const path = require('path'); const { execFileSync } = require('child_process');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 600) : '')); } };
const U = 'http://127.0.0.1:8013/', M = 'http://127.0.0.1:8099', DATA = process.env.SITE_DATA || '/tmp/teplo_data', ROOT = path.resolve(__dirname, '../..');
const stand = body => fetch(M + '/stand/admin', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
const php = code => execFileSync('php', ['-r', `define('TEPLO',1); foreach (['core','telegram','reminders','recognize','admin','vkcab','cabs','htmsvc','vksvc'] as $f) require '${ROOT}/app/'.$f.'.php'; ${code}`], { env: Object.assign({}, process.env, { SITE_DATA: DATA, SITE_BASE: '' }) }).toString();
const D = '2026-11-12';
(async () => {
  await stand('act=reset'); await stand('act=set&scenario=ok&today=' + D + '&robot_delay=99999&hot=');
  php("Db::q('DELETE FROM rate_limits');");
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await require('./askauto.cjs')(p);
  const wait = ms => p.waitForTimeout(ms), has = async sel => !!(await p.$(sel)), txt = sel => p.textContent(sel).catch(() => '');
  const api = (m, u, body) => p.evaluate(([m, u, body]) => window.TeploSync.api(m, u, body), [m, u, body]);
  const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')));
  const pl = async id => (await st()).places.filter(x => x.id === id)[0];
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(500);
  ok('реєстрація', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'apt' + Date.now() + '@teplo.test') === 200);
  const s0 = demo({ today: D, second: true });
  s0.places[0].name = 'Квартира А'; s0.places[1].name = 'Квартира Б';
  s0.places[0].water.meters.push({ id: 'c2', kind: 'cold', name: 'Ванна', serial: '3209999', vkId: '', verifiedUntil: '2030-01-01' });
  s0.places[0].water.meters.forEach(m => { if (m.id === 'c1') m.name = 'Кухня'; });
  s0.places[1].meter = { modelId: 'sharky774', unit: 'Gcal' }; s0.places[1].baseline = { date: '2025-12-10', energy: '5.001', volume: '900', hours: '20000' };
  await p.evaluate(s => { s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, s0); await p.reload(); await wait(1200);
  const go = async (h, ms) => { await p.goto(U + '#' + h); await wait(ms || 1800); };

  // 1. екран постачальника квартири Б — блок «Передача показань»: вхід ХТМ саме цієї квартири, без інших квартир
  await go('pvp-heat-p2');
  ok('1. #pvp-heat-p2: першим — «Передача показань», ХТМ, «Вхід ХТМ цієї квартири не підключено»', /Передача показань/.test(await txt('[data-key=pvp-send] .pvp-sh')) &&
    /ХТМ/.test(await txt('[data-key=pvp-send]')) && /Вхід ХТМ цієї квартири не підключено/.test(await txt('[data-key=cb-htm-off]')) && await has('[data-key=hp-pvp-p2]'), await txt('[data-key=pvp-send]'));
  const order = await p.evaluate(() => { const a = document.querySelector('[data-key=pvp-send]'), c = document.querySelector('[data-key=pvp-heat]'); return !!(a && c && (a.compareDocumentPosition(c) & 4)); });
  ok('1. …блок передачі — над даними постачальника (ціна, рахунок)', order);
  ok('1. …у блоці немає іншої квартири й «основного»/«вашого кабінету»', !/Квартира А|основн|вашому кабінеті|ваш кабінет/i.test(await txt('[data-key=pvp-send]')), await txt('[data-key=pvp-send]'));
  await p.click('[data-key=hp-pvp-p2]'); await wait(400);
  await p.fill('#hp-email', 'test@stand.local'); await p.fill('#hp-pass', 'stand-pass-123'); await p.check('#hp-consent'); await p.click('[data-key=hp-pvp-p2-save]'); await wait(4500);
  const s1 = await api('GET', '/cab/htm');
  ok('2. вхід квартири Б — на сервері places.p2, основного немає, квартири А — немає', s1.places && s1.places.p2 && !s1.places.main && s1.connected === false, s1);
  ok('2. …блок: «Вхід ХТМ цієї квартири: test@stand.local», плашка «Підключено»', /Вхід ХТМ цієї квартири: test@stand\.local/.test(await txt('[data-key=cb-hp-st-p2]')) && /Підключено/.test(await txt('[data-key=pvp-send] [data-key=cb-st]')), await txt('[data-key=pvp-send]'));
  await go('pvp-heat-main');
  ok('3. квартира А — свій блок: не підключено (вхід Б сюди не потрапив)', /не підключено/.test(await txt('[data-key=cb-htm-off]')) && await has('[data-key=hp-pvp-main]') && !/test@stand/.test(await txt('[data-key=pvp-send]')), await txt('[data-key=pvp-send]'));
  await p.click('[data-key=hp-pvp-main]'); await wait(400);
  await p.fill('#hp-email', 'test@stand.local'); await p.fill('#hp-pass', 'stand-pass-123'); await p.check('#hp-consent'); await p.click('[data-key=hp-pvp-main-save]'); await wait(4500);
  const s2 = await api('GET', '/cab/htm');
  const rows = php("echo json_encode(Db::q(\"SELECT prov, extra FROM cab_creds WHERE prov LIKE 'hp%' ORDER BY id\")->fetchAll());");
  ok('4. квартира А підключила свій — два окремі входи (hp…) з різними квартирами', s2.places.main && s2.places.p2 && (pr => pr.indexOf('main') >= 0 && pr.indexOf('p2') >= 0)(JSON.parse(rows).map(r => JSON.parse(r.extra || '{}').place)), rows);
  // відв'язати вхід Б — у А лишається
  await go('pvp-heat-p2');
  await p.click('[data-key=cb-hp-off-p2]'); await wait(2500);
  const s3 = await api('GET', '/cab/htm');
  ok('5. «Відв’язати» в квартирі Б — у Б входу немає, у А — є', s3.places && s3.places.main && !s3.places.p2 && await has('[data-key=hp-pvp-p2]'), s3.places);

  // 6. старий основний вхід (без квартири) з рахунком квартири А — показуємо як «Вхід ХТМ цієї квартири», «Змінити» створює свій вхід А, основний не чіпаємо
  await api('POST', '/cab/forget', { prov: 'htm', place: 'main' }); php("Db::q('DELETE FROM rate_limits');");
  const cn = await api('POST', '/cab/htm/connect', { email: 'test@stand.local', password: 'stand-pass-123', phone: '', consent: true });
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.places[0].meter.account = '1000000061'; if (s.meter) s.meter.account = '1000000061'; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await wait(1000); await go('pvp-heat-main');
  ok('6. основний вхід з рахунком квартири А — у неї «Вхід ХТМ цієї квартири: …», рахунок 1000000061, без слова «основний»', cn.connected && /Вхід ХТМ цієї квартири: test@stand\.local/.test(await txt('[data-key=cb-hp-st-main]')) &&
    /1000000061/.test(await txt('[data-key=pvp-send]')) && !/основн/i.test(await txt('[data-key=pvp-send]')), await txt('[data-key=pvp-send]'));
  await go('pvp-heat-p2');
  ok('6. …квартира Б (рахунку в основному немає) — «не підключено», основний її не підміняє', /не підключено/.test(await txt('[data-key=cb-htm-off]')), await txt('[data-key=pvp-send]'));
  await go('pvp-heat-main');
  await p.click('[data-key=cb-hp-edit-main]'); await wait(400);
  ok('7. «Змінити e-mail чи пароль» у квартирі — форма входу саме цієї квартири', await has('.hp-form[data-pid=main]'));
  await p.fill('#hp-email', 'test@stand.local'); await p.fill('#hp-pass', 'stand-pass-123'); await p.check('#hp-consent'); await p.click('[data-key=hp-pvp-main-save]'); await wait(4500);
  const s4 = await api('GET', '/cab/htm');
  ok('7. …збережено як вхід квартири А (places.main), основний лишився', s4.places && s4.places.main && s4.connected === true, { places: s4.places, connected: s4.connected });

  // 8. Водоканал: у кожної квартири свої рахунок і прізвище; ввід в одній не міняє іншу
  await go('pvp-water-p2');
  ok('8. #pvp-water-p2: блок Водоканалу з рахунком і прізвищем саме Б (654321)', await p.inputValue('[data-cbw=account][data-pid=p2]') === '654321' && !(await has('[data-cbw=account][data-pid=main]')), await txt('[data-key=pvp-send]'));
  await p.fill('[data-cbw=account][data-pid=p2]', '222222'); await p.press('[data-cbw=account][data-pid=p2]', 'Tab');
  await p.fill('[data-cbw=surname][data-pid=p2]', 'Петренко'); await p.press('[data-cbw=surname][data-pid=p2]', 'Tab'); await wait(600);
  const a2 = await pl('p2'), a1 = await pl('main');
  ok('8. …Б: 222222 / Петренко; А не змінилась (123456 / Шевченко)', ((a2.water.acc || {}).cold || a2.water.account) === '222222' && a2.water.surname === 'Петренко' &&
    ((a1.water.acc || {}).cold || a1.water.account) === '123456' && a1.water.surname === 'Шевченко', [a1.water.account, a1.water.surname, a2.water.account, a2.water.surname]);
  // «у фоні» Водоканалу — по квартирі
  php("Db::q('DELETE FROM rate_limits');");
  await p.click('[data-key=prefs-vk-auto][data-pid=p2]'); await wait(1800);
  await go('pvp-water-main');
  const autoA = await p.$eval('[data-key=prefs-vk-auto][data-pid=main]', x => x.checked).catch(() => null);
  await p.click('[data-key=prefs-vk-auto][data-pid=main]'); await wait(1800);
  const vj = await api('GET', '/vk/jobs');
  ok('9. «у фоні» Водоканалу: увімкнули в Б, вимкнули в А — згода є, off лише [main]', autoA === true && vj.auto === true && JSON.stringify(vj.off) === '["main"]', [autoA, vj.auto, vj.off]);
  await go('pvp-water-p2');
  ok('9. …у Б галочка лишилась', await p.$eval('[data-key=prefs-vk-auto][data-pid=p2]', x => x.checked).catch(() => null) === true);

  // 10. «Кабінети й надсилання» — квартири розділами, рядки → екран постачальника квартири, «Назад» — до списку
  await go('prefs-cabs');
  ok('10. «Кабінети й надсилання»: розділи «Квартира А» і «Квартира Б»', await has('[data-key=cb-sec-main]') && await has('[data-key=cb-sec-p2]') && /Квартира Б/.test(await txt('[data-key=cb-sec-p2] .ios-sh')), await txt('[data-key=cb-list]'));
  ok('10. …рядок «ХТМ — Опалення» Б веде на #pvp-heat-p2', (await p.getAttribute('[data-key=cb-row-heat-p2]', 'href')) === '#pvp-heat-p2');
  await p.click('[data-key=cb-row-heat-p2]'); await wait(1500);
  ok('10. …екран постачальника Б, «← Кабінети й надсилання»', /pvp-heat-p2$/.test(p.url()) && /Кабінети/.test(await txt('[data-key=pvp-back]')) && (await p.getAttribute('[data-key=pvp-back]', 'href')) === '#prefs-cabs');
  await p.click('[data-key=pvp-back]'); await wait(1200);
  ok('10. …«Назад» — до списку', /#prefs-cabs$/.test(p.url()));

  // 11. сторінка холодної з двома водомірами — однаковий набір налаштувань у кожного, спільне — окремим блоком
  await go('pvp-water-main', 1000); await go('water-cold');   // екран постачальника перемикає поточну квартиру — назад на А
  await p.evaluate(() => document.querySelectorAll('details.mbox-set').forEach(d => { d.open = true; })); await wait(500);
  const sets = await p.evaluate(() => Array.from(document.querySelectorAll('[data-key^="wmeter-"][data-key$="-set"]')).map(d => Array.from(d.querySelectorAll('label')).map(l => l.textContent.trim()).join('|')));
  ok('11. дві холодні: «Налаштування показань» обох — той самий набір полів, без «Кому платите» й рахунку', sets.length === 2 && sets[0] === sets[1] && !/Кому платите|Особовий рахунок/.test(sets[0]), sets);
  ok('11. …спільне — блоком «Постачальник, рахунок і ціна»: «Однакове для всіх лічильників: Кухня, Ванна», рахунок 123456', /Кухня, Ванна/.test(await txt('[data-key=kset-cold-s]')) && await p.inputValue('[data-key=kset-cold] #mw-acc') === '123456', await txt('[data-key=kset-cold]'));
  ok('11. …рядок «Передача» веде на екран постачальника квартири', /^#pvp-water-main$/.test(await p.getAttribute('[data-key=kset-cold] [data-key=cb-mgo-cold]', 'href') || ''));
  await p.setViewportSize({ width: 320, height: 700 }); await go('pvp-heat-main', 1500);
  ok('12. 320 px — екран постачальника без горизонтальної прокрутки', await p.evaluate(() => document.documentElement.scrollWidth <= 320), await p.evaluate(() => document.documentElement.scrollWidth));
  if (process.env.SHOT) await p.screenshot({ path: '/tmp/aptcab.png', fullPage: true });
  ok('без помилок JS', errs.length === 0, errs);
  await b.close();
  console.log(`\nИтог: ${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
