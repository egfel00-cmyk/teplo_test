// «Відправити у фоні» (06.11.2026, просьба владельца): кабинет — равноценная кнопка в ряду каналов «Куди передати»; подключён — выделенная
// «Відправити у фоні» с припиской, что уйдёт; та же кнопка на «Перевірці» и на экране распознанного фото; «Налаштування» → «Кабінети й
// автовідправка» (ХТМ: автовідправка / відключити; Водоканал: згода на автовідправку води); вода — «у фоні» через очередь сервера (VkSvc).
// Нужны: сайт 127.0.0.1:8013 (config.php: 'htm_cab_base' => 'http://127.0.0.1:8099', 'vk_cab_base' => 'http://127.0.0.1:8098'),
//   стенд ХТМ: cp -r tests/htm-mock /tmp && cd /tmp/htm-mock && php -S 127.0.0.1:8099 -t public public/router.php
//   кабинет Водоканала: php -S 127.0.0.1:8098 tests/vk-mock/router.php            node tests/e2e/e2e_cabbg.cjs
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', M = 'http://127.0.0.1:8099', VM = 'http://127.0.0.1:8098', DATA = process.env.SITE_DATA || '/tmp/teplo_data', ROOT = path.resolve(__dirname, '../..');
const stand = body => fetch(M + '/stand/admin', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
const php = code => execFileSync('php', ['-r', `define('TEPLO',1); foreach (['core','telegram','reminders','recognize','admin','vkcab','cabs','htmsvc','vksvc'] as $f) require '${ROOT}/app/'.$f.'.php'; ${code}`], { env: Object.assign({}, process.env, { SITE_DATA: DATA }) }).toString();
(async () => {
  await stand('act=reset'); await stand('act=set&scenario=ok&today=2026-11-10&robot_delay=99999'); await fetch(VM + '/__reset');
  const n = Math.floor(Date.now() / 1000); fs.mkdirSync(DATA + '/cache', { recursive: true });
  fs.writeFileSync(DATA + '/cache/vk_status.json', JSON.stringify({ cab: { state: 'ok', at: n, since: n - 3600, everOk: true, lastOk: n, code: 200 } }));
  php("Db::q('DELETE FROM rate_limits');");
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  const wait = ms => p.waitForTimeout(ms), vis = async sel => !!(await p.$(sel)) && await p.isVisible(sel), txt = sel => p.textContent(sel).catch(() => '');
  const today = new Date().toISOString().slice(0, 10);
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(500);
  ok('регистрация', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'bg' + Date.now() + '@teplo.test') === 200);
  const H = { date: '2026-11-10', energy: '14.445', volume: '2332.676', flow: '0.063', power: '1.5', tSupply: '50.12', tReturn: '30.4', hours: '35078', errHours: '153', errCode: 'E---' };
  await p.evaluate(([s, h, d]) => {
    s.readings.push({ id: 'rnow', place: 'main', htm: h, raw: {}, unit: 'Gcal', status: 'checked', createdAt: '2026-11-10T09:00:00Z', updatedAt: Date.now(), source: 'manual' });
    s.vkBill = { main: { at: Date.now() } }; s.places[0].water.account = '905614'; s.places[0].water.surname = 'Шевченко'; s.contacts = { phone: '050 111 22 33' };
    s.water.push({ id: 'wnow', place: 'main', date: d, vals: { h1: '176', c1: '440' }, createdAt: d + 'T09:00:00Z', updatedAt: Date.now(), sent: {} });
    s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s));
  }, [demo({ today: '2026-11-10' }), H, today]);
  await p.reload(); await wait(1500);
  // 1. не подключено: «Підключити кабінет» — такая же кнопка, как «Відкрити кабінет ХТМ»
  await p.goto(U + '#heat'); await wait(1200); const sm = await p.$('[data-key=where-heat-sum]'); if (sm) await sm.click(); await wait(300);
  const row = await p.$$eval('[data-key=dest-htm-heat] .dest-ch > *', l => l.map(x => ({ k: x.getAttribute('data-key'), c: x.className })));
  ok('не подключено: в ряду каналов «Відкрити кабінет ХТМ» и «Підключити кабінет» — обе одного вида (btn sec)', row.length === 2 && row.every(x => x.c === 'btn sec') && row[1].k === 'cab-connect-where', row);
  // 2. подключить (как с экрана кабинета) → выделенная «Відправити у фоні» + что уйдёт
  ok('подключить кабинет', await p.evaluate(() => window.TeploSync.api('POST', '/cab/htm/connect', { email: 'test@stand.local', password: 'stand-pass-123', phone: '0501112233', consent: true }).then(j => j._status)) === 200);
  await p.reload(); await wait(1200); await p.goto(U + '#heat'); await wait(1800); const sm2 = await p.$('[data-key=where-heat-sum]'); if (sm2 && !(await p.$eval('[data-key=where-heat]', d => d.open))) await sm2.click(); await wait(300);
  const bgc = await p.$eval('[data-key=cab-bg-where]', x => x.className).catch(() => '');
  ok('подключено: «Відправити у фоні» выделена (btn dest-bg), рядом «Відкрити кабінет ХТМ»', bgc === 'btn dest-bg' && await vis('[data-key=dest-htm-heat-cab]'), bgc);
  ok('…приписка: будут отправлены последние собранные показания — дата и энергия', /останні зібрані показання: від 10\.11\.2026 — 14\.445 Гкал/.test(await txt('[data-key=cab-bg-note-where]')), await txt('[data-key=cab-bg-note-where]'));
  ok('…ручного «Передати показання від…» больше нет на виду', !(await p.$('[data-key=where-heat-handover]'))); if (process.env.SHOT) { const el = await p.$('[data-key=where-heat]'); if (el) await el.screenshot({ path: '/tmp/bg_heat.png' }); }
  await p.setViewportSize({ width: 320, height: 700 }); await wait(300);
  ok('320 px: без горизонтальной прокрутки', await p.evaluate(() => document.documentElement.scrollWidth <= 321));
  await p.setViewportSize({ width: 390, height: 844 }); await wait(200);
  await p.click('[data-key=cab-bg-where]'); await p.waitForFunction(() => location.hash === '#status', null, { timeout: 15000 }).catch(() => {}); await wait(500);
  let s = await st(); let r = s.readings.find(x => x.id === 'rnow');
  ok('…запись handed, cab pending', r.status === 'handed' && r.cab && r.cab.status === 'pending' && /status/.test(p.url()), r.cab);
  // 3. «Перевірка»: подключён кабинет — «Відправити у фоні», ручная — вторичная «Або внести самим»
  await p.evaluate(h => { const s = JSON.parse(localStorage.getItem('teplo.v1')); const bs = s.baseline, dd = Math.round((Date.parse('2026-11-10') - Date.parse(bs.date)) / 864e5); s.draft = { date: '2026-11-10', values: Object.assign({}, h, { energy: (Number(bs.energy) + 0.4).toFixed(3), volume: (Number(bs.volume) + 40).toFixed(3), hours: String(Number(bs.hours) + dd * 24), errHours: String(bs.errHours || 0), errCode: 'E---' }), step: 9, source: 'manual', startedAt: new Date().toISOString() }; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, H);
  await p.reload(); await wait(1200); await p.goto(U + '#check'); await wait(1000);
  if (process.env.SHOT) await p.screenshot({ path: '/tmp/bg_check.png', fullPage: true });
  ok('«Перевірка»: «Відправити у фоні» + приписка; «Або внести самим» — вторичная', await vis('[data-key=check-bg]') && /останні зібрані показання/.test(await txt('[data-key=check-bg-note]')) && (await p.$eval('[data-key=check-send]', x => x.className)) === 'btn sec');
  // 4. «Налаштування» → «Кабінети й автовідправка»
  await p.goto(U + '#prefs'); await wait(1200); const g = await p.$('[data-key=pg-cabs] summary, #pg-cabs summary'); if (g) await g.click(); await wait(500);
  if (process.env.SHOT) { const el = await p.$('[data-key=prefs-cab-htm]'); if (el) { await el.evaluate(x => x.parentElement.scrollIntoView()); await p.screenshot({ path: '/tmp/bg_prefs.png' }); } }
  ok('настройки: кабинет ХТМ подключён (e-mail), про хранение доступа и согласие', /test@stand\.local/.test(await txt('[data-key=prefs-cab-htm]')) && /згода зберігаються/.test(await txt('[data-key=prefs-cab-htm]')), await txt('[data-key=prefs-cab-htm]'));
  await p.click('[data-key=prefs-htm-auto]'); await wait(1500);
  ok('…автовідправка ХТМ включается переключателем', await p.evaluate(() => window.TeploSync.api('GET', '/cab/htm').then(j => j.auto)) === true);
  await p.click('[data-key=prefs-htm-auto]'); await wait(1500);
  ok('…и отвязывается им же', await p.evaluate(() => window.TeploSync.api('GET', '/cab/htm').then(j => j.auto)) === false);
  await p.click('[data-key=prefs-vk-auto]'); await wait(1500);
  ok('Водоканал: галочка = согласие → автовідправка води включена', await p.evaluate(() => window.TeploSync.api('GET', '/vk/jobs').then(j => j.auto)) === true && await vis('[data-key=prefs-vk-off]'));
  await p.click('[data-key=prefs-vk-off]'); await wait(1500);
  ok('…«Відкликати згоду» — выключено', await p.evaluate(() => window.TeploSync.api('GET', '/vk/jobs').then(j => j.auto)) === false);
  p.once('dialog', d => d.accept()); await p.click('[data-key=prefs-cab-htm-off]'); await wait(1500);
  ok('«Відключити кабінет» ХТМ (с подтверждением) → не подключён', await p.evaluate(() => window.TeploSync.api('GET', '/cab/htm').then(j => j.connected)) === false && await vis('[data-key=prefs-cab-htm-connect]'));
  // 5. вода: «Відправити у фоні» → очередь сервера → cron → «передано» (підтверджено сайтом)
  await p.goto(U + '#wrec-wnow'); await wait(1500); await p.click('[data-key=where-water-sum]'); await wait(300);
  ok('вода: «Відправити у фоні» выделена, приписка с цифрами', (await p.$eval('[data-key=vk-bg]', x => x.className).catch(() => '')) === 'btn dest-bg' && /Холодна.*440/.test(await txt('[data-key=vk-bg-note]')), await txt('[data-key=vk-bg-note]'));
  if (process.env.SHOT) { const el = await p.$('[data-key=dest-vk]'); if (el) await el.screenshot({ path: '/tmp/bg_water.png' }); }
  await p.click('[data-key=vk-bg]'); await wait(1500);
  s = await st(); let w = s.water.find(x => x.id === 'wnow');
  ok('…в очереди сервера: «Надсилаємо у фоні»', w.vkJob && w.vkJob.status === 'queued' && await vis('[data-key=vk-bg-q]'), w.vkJob);
  const cr = php("echo json_encode(VkSvc::cron());");
  ok('cron: отправлено на сайт Водоканалу → ok', /"ok"/.test(cr), cr);
  await p.evaluate(() => window.dispatchEvent(new Event('hashchange'))); await p.goto(U + '#home'); await wait(300); await p.goto(U + '#wrec-wnow'); await p.waitForFunction(() => { const w = JSON.parse(localStorage.getItem('teplo.v1')).water.find(x => x.id === 'wnow'); return w && w.sent && w.sent.vk; }, null, { timeout: 30000 }).catch(() => {});
  s = await st(); w = s.water.find(x => x.id === 'wnow'); const vs = await (await fetch(VM + '/__store')).json();
  ok('…запись «передано» (підтверджено сайтом, via cab); на сайт ушли 440 и 176', (w.sent || {}).vk && w.vkConf && w.vkConf.via === 'cab' && JSON.stringify(vs._lastPost.post.DynamicModel.newIndication) === JSON.stringify({ 1282444: '440', 1282445: '176' }), [w, vs._lastPost && vs._lastPost.post]);
  // 6. политика: доступы и согласие
  await p.goto(U + '#privacy'); await wait(600);
  ok('политика: «Кабінети постачальників: доступи й згода», Водоканал «у фоні»', /доступи й згода/.test(await txt('main')) && /Відправити у фоні/.test(await txt('main')));
  ok('без ошибок JS', errs.length === 0, errs);
  await b.close(); console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); process.exit(fail ? 1 : 0);
})();
