// 168-а (власник 17.11 11:33: «кабинеты и отправку надо разделять по провайдерам, и в настройках должны быть все данные, нужные для входа и проверки
// работоспособности»): «Налаштування → Кабінети й надсилання» — блок на кожного постачальника, в якого є лічильник (усі квартири, порядок — світло, вода,
// газ, тепло): Харківобленерго (передаєте самі, рахунок), свій постачальник гаража, Водоканал (рахунок і прізвище кожної квартири, «Перевірити»),
// місцевий КП Кам’янця (LocalBot mtve: підключити → перевірити → «Відправляти у фоні» окремо → відв’язати), Газмережі, кабінет ХТМ (e-mail і пароль,
// «Перевірити», автоподача, відв’язати).
// Потрібні: сайт 127.0.0.1:8013 (config.php: 'htm_cab_base' => 'http://127.0.0.1:8099', 'vk_cab_base' => 'http://127.0.0.1:8098', 'lb_base_mtve' => 'http://127.0.0.1:8096/'),
//   стенд ХТМ: bash tests/htm-mock/start.sh · Водоканал: php -S 127.0.0.1:8098 tests/vk-mock/router.php · LocalBot: php -S 127.0.0.1:8096 tests/lb-mock/router.php
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', M = 'http://127.0.0.1:8099', VM = 'http://127.0.0.1:8098', LM = 'http://127.0.0.1:8096', DATA = process.env.SITE_DATA || '/tmp/teplo_data', ROOT = path.resolve(__dirname, '../..');
const stand = body => fetch(M + '/stand/admin', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
const php = code => execFileSync('php', ['-r', `define('TEPLO',1); foreach (['core','telegram','reminders','recognize','admin','vkcab','cabs','htmsvc','vksvc'] as $f) require '${ROOT}/app/'.$f.'.php'; ${code}`], { env: Object.assign({}, process.env, { SITE_DATA: DATA }) }).toString();
(async () => {
  await stand('act=reset'); await stand('act=set&scenario=ok&today=2026-11-17&robot_delay=99999'); await fetch(VM + '/__reset'); await fetch(LM + '/__reset');
  const n = Math.floor(Date.now() / 1000); fs.mkdirSync(DATA + '/cache', { recursive: true });
  fs.writeFileSync(DATA + '/cache/vk_status.json', JSON.stringify({ cab: { state: 'ok', at: n, since: n - 3600, everOk: true, lastOk: n, code: 200 } }));
  php("Db::q('DELETE FROM rate_limits');");
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); const p = await ctx.newPage(); p.setDefaultTimeout(6000);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  const wait = ms => p.waitForTimeout(ms), vis = async sel => !!(await p.$(sel)) && await p.isVisible(sel), txt = sel => p.textContent(sel).catch(() => '');
  const cabs = async () => { await p.goto(U + '#prefs'); await wait(300); await p.goto(U + '#prefs-cabs'); await wait(2500); };
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(500);
  ok('реєстрація', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'cb' + Date.now() + '@teplo.test') === 200);
  const s0 = demo({ today: '2026-11-17', second: true, garage: 'own', elec: 1, gas: true });
  s0.places[0].water.account = '905614'; s0.contacts = { phone: '050 111 22 33' };
  s0.places.push({ id: 'km', v: 2, name: 'Кам’янець', address: 'м. Кам’янець-Подільський, вул. Соборна 1, кв. 2', color: 'green', meter: null, baseline: null, updatedAt: 1,
    water: { account: '', surname: '', meters: [{ id: 'kc', kind: 'cold', name: '', serial: '1234567' }, { id: 'kh', kind: 'hot', name: '', serial: '7654321' }] } });
  s0.water.push({ id: 'wk1', place: 'km', date: '2026-11-17', vals: { kh: '178', kc: '441' }, createdAt: '2026-11-17T10:00:00Z', updatedAt: Date.now(), sent: {} });
  s0.updatedAt = Date.now();
  await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), s0); await p.reload(); await wait(1200);

  // 1. список постачальників — порядок видів, кожен один раз, квартири всередині
  await p.goto(U + '#prefs'); await wait(1500);
  ok('«Налаштування»: рядок «Кабінети й надсилання»', /Кабінети й надсилання/.test(await txt('[data-key=pgr-cabs]')), await txt('[data-key=pgr-cabs]'));
  await cabs();
  const keys = await p.$$eval('.pg-one section.panel.cb', l => l.map(x => x.getAttribute('data-key')));
  ok('блоки по постачальниках у порядку видів: світло (обленерго, свій гаража) → вода (Водоканал, КП Кам’янця) → газ → тепло (ХТМ)',
    JSON.stringify(keys) === JSON.stringify(['cb-self-elec', 'cb-own-elec', 'prefs-cab-vk', 'cb-lb-mtve', 'cb-self-gas', 'prefs-cab-htm']), keys);
  ok('Водоканал — один блок на дві квартири (Моя, Мамина), у кожної свої рахунок і прізвище', /Моя квартира, Мамина/.test(await txt('[data-key=prefs-cab-vk] .cb-meta'))
    && await p.inputValue('#cb-vacc-main') === '905614' && await p.inputValue('#cb-vacc-p2') === '654321' && await p.inputValue('#cb-vsn-p2') === 'Шевченко', await txt('[data-key=prefs-cab-vk] .cb-meta'));
  ok('Харківобленерго: «Передаєте самі», чому (перевірка «я не робот»), особовий рахунок з налаштувань лічильника', /Передаєте самі/.test(await txt('[data-key=cb-self-elec] [data-key=cb-st]'))
    && /я не робот/.test(await txt('[data-key=cb-self-elec]')) && /9876543/.test(await txt('[data-key=cb-self-elec]')) && !(await p.$('[data-key=cb-self-elec] button:not(.copy-ico)')), await txt('[data-key=cb-self-elec]'));
  ok('свій постачальник гаража (ГК «Мотор») — «Передаєте самі», без кнопок підключення', /ГК «Мотор»/.test(await txt('[data-key=cb-own-elec] h2')) && /Передаєте самі/.test(await txt('[data-key=cb-own-elec]')) && !(await p.$('[data-key=cb-own-elec] .btn')));
  ok('газ: Газмережі, «Передаєте самі», рахунок Нафтогазу', /Газмереж/.test(await txt('[data-key=cb-self-gas]')) && /123456789/.test(await txt('[data-key=cb-self-gas]')));
  ok('ХТМ не підключено: «Не підключено», кнопка «Підключити кабінет», «Хто ми…»', /Не підключено/.test(await txt('[data-key=prefs-cab-htm] [data-key=cb-st]')) && await vis('[data-key=prefs-cab-htm-connect]') && !!(await p.$('[data-key=trust-prefs-htm]')));
  if (process.env.SHOT) await p.screenshot({ path: '/tmp/cabs_all.png', fullPage: true });

  // 2. Водоканал: правка рахунку — у налаштування води тієї квартири; «Перевірити» — що бачить сайт, коли перевіряли
  await p.fill('#cb-vacc-p2', '7777001'); await p.press('#cb-vacc-p2', 'Tab'); await wait(400);
  ok('рахунок Маминої — у p2.water.account (ті самі поля, що в налаштуваннях води)', (await st()).places.find(x => x.id === 'p2').water.account === '7777001');
  await p.click('[data-key=cb-vk-check-p2]'); await wait(2500);
  ok('«Перевірити» з чужим рахунком — помилка словами в блоці квартири, стан «Помилка»', /не прийняв рахунок 7777001/.test(await txt('[data-key=cb-vk-chk-p2]')) && /Помилка/.test(await txt('[data-key=prefs-cab-vk] [data-key=cb-st]')),
    [await txt('[data-key=cb-vk-chk-p2]'), await txt('[data-key=prefs-cab-vk] [data-key=cb-st]')]);
  await p.click('[data-key=cb-vk-check-main]'); await wait(2500);
  ok('«Перевірити» Моєї (905614, Шевченко) — «Сайт Водоканалу відкрився… лічильників у формі — 2»; час перевірки збережено в даних', /відкрився/.test(await txt('[data-key=cb-vk-chk-main]')) && /2/.test(await txt('[data-key=cb-vk-chk-main]'))
    && ((await st()).places.find(x => x.id === 'main').water.chk || {}).ok === 1, await txt('[data-key=cb-vk-chk-main]'));
  ok('на стенд Водоканалу нічого не надіслано', !JSON.stringify(await (await fetch(VM + '/__store')).json()).includes('"sent'), await (await fetch(VM + '/__store')).text());
  ok('Водоканал: автовідправка після фото й «Квитанції самі» — у блоці; на сервері нічого не зберігаємо — без «Відв’язати»', await vis('[data-key=prefs-vk-auto]') && await vis('[data-key=prefs-vk-bills]') && await vis('[data-key=cb-vk-none]') && !(await p.$('[data-key=prefs-vk-off]')));
  await p.click('[data-key=prefs-vk-auto]'); await wait(1500);
  ok('згода на автовідправку → «Відв’язати» з’являється', await p.evaluate(() => window.TeploSync.api('GET', '/vk/jobs').then(j => j.auto)) === true && await vis('[data-key=prefs-vk-off]'));
  await p.click('[data-key=prefs-vk-off]'); await wait(1500);
  ok('«Відв’язати» Водоканал → згоду відкликано', await p.evaluate(() => window.TeploSync.api('GET', '/vk/jobs').then(j => j.auto)) === false && await vis('[data-key=cb-vk-none]'));

  // 3. Місцевий КП (Кам’янець, LocalBot mtve — форма на сайті без входу): підключити = перевірити, нічого не надсилаючи
  ok('КП Кам’янця: «Не підключено», чого просить бот (особовий рахунок)', /Не підключено/.test(await txt('[data-key=cb-lb-mtve] [data-key=cb-st]')) && /особовий рахунок/.test(await txt('[data-key=cb-lb-mtve]')), await txt('[data-key=cb-lb-mtve]'));
  await p.click('[data-key=cb-lb-open-km]'); await wait(400);
  const ia = '#cb-lb-mtve-km-acc';
  ok('форма: особовий рахунок з підказкою 74-108-61, згода', await vis(ia) && (await p.getAttribute(ia, 'placeholder')) === '74-108-61' && !!(await p.$('[data-key=cb-lb-form-km] [name=lb-consent]')));
  await p.fill(ia, '74-108-61'); await p.click('[data-key=cb-lb-check-km]'); await wait(1000);
  ok('без згоди — пояснення в блоці цієї квартири', /згода/i.test(await txt('[data-key=cb-lb-err-km]')), await txt('[data-key=cb-lb-mtve]'));
  await p.check('[data-key=cb-lb-form-km] [name=lb-consent]'); await p.fill(ia, '74-108-62'); await p.click('[data-key=cb-lb-check-km]'); await wait(1800);
  ok('чужий рахунок — «Сайт не знайшов такий особовий рахунок», введене лишилось', /не знайшов/.test(await txt('[data-key=cb-lb-err-km]')) && await p.inputValue(ia) === '74-108-62', await txt('[data-key=cb-lb-err-km]'));
  await p.fill(ia, '74-108-61'); await p.click('[data-key=cb-lb-check-km]'); await wait(2000);
  ok('підключено: «Підключено», «Перевірено …», сайт знайшов 2 лічильники; на стенд нічого не надіслано', /Підключено/.test(await txt('[data-key=cb-lb-mtve] [data-key=cb-st]')) && /Перевірено/.test(await txt('[data-key=cb-lb-chk-km]'))
    && /2/.test(await txt('[data-key=cb-lb-chk-km]')) && (await (await fetch(LM + '/__last')).json()) === null, [await txt('[data-key=cb-lb-mtve] [data-key=cb-st]'), await txt('[data-key=cb-lb-chk-km]')]);
  ok('дані входу видно й можна правити: рахунок 74-108-61 у полі, кнопка тепер «Перевірити»', await p.inputValue(ia) === '74-108-61' && /Перевірити/.test(await txt('[data-key=cb-lb-check-km]')));
  ok('«Відправляти у фоні» — увімкнено, «Відв’язати», «Ще нічого не надсилали»', await p.isChecked('[data-key=cb-lb-bg-km]') && await vis('[data-key=cb-lb-off-km]') && /нічого не надсилали/.test(await txt('[data-key=cb-lb-last-km]')));
  if (process.env.SHOT) await (await p.$('[data-key=cb-lb-mtve]')).screenshot({ path: '/tmp/cabs_lb.png' });
  await p.click('[data-key=cb-lb-bg-km]'); await wait(1500);
  ok('«Відправляти у фоні» вимкнули — сервер: bg false, дані входу лишились', await p.evaluate(() => window.TeploSync.api('GET', '/lb?bot=mtve&place=km').then(j => j.conn && j.conn.bg === false && j.conn.acc === '74-108-61')) === true);
  ok('…черга сервера не приймає', await p.evaluate(() => window.TeploSync.api('POST', '/lb/queue', { bot: 'mtve', place: 'km', rid: 'wk1', items: [{ value: '441', serial: '1234567', kind: 'cold' }] }).then(j => j._status + ':' + j.error)) === '409:lb_bg_off');
  // сторінка води Кам’янця: «Відправити у фоні» немає, замість неї — де ввімкнути
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.placeId = 'km'; s.meter = null; s.baseline = null; localStorage.setItem('teplo.v1', JSON.stringify(s)); }); await p.reload(); await wait(1200);
  await p.goto(U + '#water-cold'); await wait(2500); { const el = await p.$('[data-key=where-water]'); if (el && await el.evaluate(d => d.open === false)) { await (await el.$('summary')).click(); await wait(400); } }
  ok('сторінка води: «Надсилання у фоні … вимкнено» з посиланням на «Кабінети й надсилання», кнопки «Відправити у фоні» немає', /вимкнено/.test(await txt('[data-key=lb-bgoff]')) && !(await p.$('[data-key=lb-bg]'))
    && (await p.getAttribute('[data-key=lb-bgoff-go]', 'href')) === '#prefs-cabs', await txt('[data-key=where-water]'));
  await p.click('[data-key=lb-bgoff-go]'); await wait(2500);
  await p.click('[data-key=cb-lb-bg-km]'); await wait(1500);
  ok('увімкнули знову → на сторінці води знову «Відправити у фоні»', await p.evaluate(() => window.TeploSync.api('GET', '/lb?bot=mtve&place=km').then(j => j.conn.bg)) === true);
  await p.goto(U + '#water-cold'); await wait(2500); { const el = await p.$('[data-key=where-water]'); if (el && await el.evaluate(d => d.open === false)) { await (await el.$('summary')).click(); await wait(400); } }
  ok('…кнопка «Відправити у фоні» на місці', await vis('[data-key=lb-bg]'));
  await cabs();
  await p.click('[data-key=cb-lb-check-km]'); await wait(2000);
  ok('«Перевірити» ще раз (рахунок у полі, нічого не міняли) — перевірено, «у фоні» лишилось увімкненим', /Перевірено/.test(await txt('[data-key=cb-lb-chk-km]')) && await p.isChecked('[data-key=cb-lb-bg-km]') && (await (await fetch(LM + '/__last')).json()) === null);
  await p.click('[data-key=cb-lb-off-km]'); await wait(1500);
  ok('«Відв’язати» → знову «Підключити», на сервері даних немає', await vis('[data-key=cb-lb-open-km]') && await p.evaluate(() => window.TeploSync.api('GET', '/lb?bot=mtve&place=km').then(j => j.conn)) === null);

  // 4. Кабінет ХТМ: e-mail, пароль, телефон — тут же; «Перевірити»; автоподача; відв’язати
  await p.click('[data-key=prefs-cab-htm-connect]'); await wait(400);
  ok('форма ХТМ у налаштуваннях: e-mail, пароль, телефон (з контактів), згода', await vis('#hc-email') && await vis('#hc-pass') && await p.inputValue('#hc-phone') === '050 111 22 33' && !!(await p.$('#hc-consent')));
  await p.fill('#hc-email', 'test@stand.local'); await p.fill('#hc-pass', 'stand-pass-123'); await p.check('#hc-consent'); await p.click('[data-key=cb-htm-save]'); await wait(5000);
  ok('підключено й перевірено: лишились у «Налаштуваннях», «Підключено», логін, пароль «збережено зашифровано», телефон', /#prefs-cabs$/.test(p.url()) && /Підключено/.test(await txt('[data-key=prefs-cab-htm] [data-key=cb-st]'))
    && /test@stand\.local/.test(await txt('[data-key=cb-htm-login]')) && /зашифровано/.test(await txt('[data-key=cb-htm-pw]')) && /050 111 22 33/.test(await txt('[data-key=cb-htm-phone]')), [p.url(), await txt('[data-key=prefs-cab-htm]')]);
  ok('…що бачить кабінет (після підключення — одразу перевірка): «Кабінет відкрився…», «Перевірено …»', /Кабінет відкрився/.test(await txt('[data-key=cb-htm-chk]')) && /Перевірено/.test(await txt('[data-key=cb-htm-checked]')), [await txt('[data-key=cb-htm-chk]'), await txt('[data-key=cb-htm-checked]')]);
  ok('…рахунок ХТМ квартири з кабінету', /\d{4,}/.test(await txt('[data-key=cb-hacc-main]')), await txt('[data-key=prefs-cab-htm]'));
  await p.click('[data-key=cb-htm-check]'); await wait(4000);
  ok('«Перевірити» ще раз — нічого не внесено на стенд', /Кабінет відкрився/.test(await txt('[data-key=cb-htm-chk]')) && await p.evaluate(() => window.TeploSync.api('GET', '/cab/htm').then(j => j.jobs.length)) === 0);
  await p.click('[data-key=prefs-htm-auto]'); await wait(1500);
  ok('автоподача ХТМ — окремо, вмикається тут', await p.evaluate(() => window.TeploSync.api('GET', '/cab/htm').then(j => j.auto)) === true);
  if (process.env.SHOT) await (await p.$('[data-key=prefs-cab-htm]')).screenshot({ path: '/tmp/cabs_htm.png' });
  await p.click('[data-key=cb-htm-edit]'); await wait(300);
  ok('«Змінити e-mail чи пароль» — форма з e-mail, згода вже стоїть; «Скасувати» повертає', await p.inputValue('#hc-email') === 'test@stand.local' && await p.isChecked('#hc-consent') && await vis('[data-key=cb-htm-edit-no]'));
  await p.click('[data-key=cb-htm-edit-no]'); await wait(300);
  await p.goto(U + '#prefs'); await wait(800);
  ok('рядок у «Налаштуваннях»: «2 підключено» (ХТМ і Водоканал з рахунком)', /2 підключено/.test(await txt('[data-key=pgr-cabs]')), await txt('[data-key=pgr-cabs]'));
  await cabs();
  await p.click('[data-key=prefs-cab-htm-off]'); await p.waitForTimeout(300); await p.click('[data-key=ask-yes]'); await wait(1500);
  ok('«Відв’язати» ХТМ (з підтвердженням) → не підключено', await p.evaluate(() => window.TeploSync.api('GET', '/cab/htm').then(j => j.connected)) === false && await vis('[data-key=prefs-cab-htm-connect]'));

  await p.setViewportSize({ width: 320, height: 700 }); await wait(400);
  ok('320 px: без горизонтальної прокрутки', await p.evaluate(() => document.documentElement.scrollWidth <= 321), await p.evaluate(() => document.documentElement.scrollWidth));
  // 5. без входу: дані Водоканалу правляться (вони в даних людини), решта — «Увійдіть»
  const p2 = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' })).newPage(); p2.on('pageerror', e => errs.push(e.message));
  await p2.goto(U); await p2.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo({ today: '2026-11-17' })); await p2.reload(); await p2.waitForTimeout(800); await p2.goto(U + '#prefs-cabs'); await p2.waitForTimeout(2000);
  ok('без входу: блоки Водоканалу й ХТМ, «Увійти»; поля Водоканалу є, «Перевірити» немає', !!(await p2.$('[data-key=prefs-cab-vk] #cb-vacc-main')) && !(await p2.$('[data-key=cb-vk-check-main]')) && !!(await p2.$('[data-key=prefs-cab-htm] [data-key=cb-login]')) && /Не підключено/.test(await p2.textContent('[data-key=prefs-cab-vk] [data-key=cb-st]')));
  ok('без помилок на сторінці', !errs.length, errs);
  await b.close(); console.log(`\nИтог: ${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})();
