// Тепло → кабінет ХТМ роботом сервера (HtmSvc, 06.11.2026): «Передайте в ХТМ» → «Підключити кабінет ХТМ» (e-mail, пароль, телефон, згода) →
// назад до «Передайте» → «Внести в кабінет ХТМ» → «Перевірте ще раз» → «Так, внести» → статус «чекаємо перевірки робота ХТМ» →
// сервер (cron) перечитує журнал → «Прийнято». Кабінет: «Перевірити, що бачить кабінет», «Забути пароль».
// Нужны: сайт 127.0.0.1:8013 (SITE_DATA=/tmp/teplo_data, config.php: 'htm_cab_base' => 'http://127.0.0.1:8099') и стенд кабинета ХТМ:
//   cp -r tests/htm-mock /tmp && cd /tmp/htm-mock && php -S 127.0.0.1:8099 -t public public/router.php      node tests/e2e/e2e_htmcab.cjs
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const { execFileSync } = require('child_process'); const path = require('path');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', M = 'http://127.0.0.1:8099', DATA = process.env.SITE_DATA || '/tmp/teplo_data', ROOT = path.resolve(__dirname, '../..');
const stand = body => fetch(M + '/stand/admin', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
// cron сервера «через 25 минут»: перечитать журнал ХТМ
const cron = mins => execFileSync('php', ['-r', `define('TEPLO',1); foreach (['core','telegram','reminders','recognize','admin','vkcab','cabs','htmsvc'] as $f) require '${ROOT}/app/'.$f.'.php'; echo json_encode(HtmSvc::cron(time() + ${mins} * 60));`], { env: Object.assign({}, process.env, { SITE_DATA: DATA }) }).toString();
(async () => {
  await stand('act=reset'); await stand('act=set&scenario=ok&today=2026-11-10&robot_delay=99999');
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  const wait = ms => p.waitForTimeout(ms), vis = async sel => !!(await p.$(sel)) && await p.isVisible(sel), txt = sel => p.textContent(sel).catch(() => '');
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(500);
  ok('регистрация', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'hc' + Date.now() + '@teplo.test') === 200);
  await p.evaluate(s => {
    s.readings.push({ id: 'rnow', place: 'main', htm: { date: '2026-11-10', energy: '14.445', volume: '2332.676', flow: '0.063', power: '1.5', tSupply: '50.12', tReturn: '30.4', hours: '35078', errHours: '153', errCode: 'E---' },
      raw: {}, unit: 'Gcal', status: 'checked', createdAt: '2026-11-10T09:00:00Z', updatedAt: Date.now(), source: 'manual' });
    s.focusId = 'rnow'; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s));
  }, demo({ today: '2026-11-10' }));
  await p.reload(); await wait(1500);
  await p.goto(U + '#heat'); await wait(1200);
  const wh = await p.$('[data-key=where-heat]'); if (wh) { const sm = await p.$('[data-key=where-heat] summary, [data-key=where-heat] [data-act=where-toggle]'); if (sm) await sm.click().catch(() => {}); }
  await wait(300);
  ok("«Куди передати» тепла: «Підключити кабінет» — кнопка в ряду каналів", !!(await p.$("[data-key=dest-htm-heat] .dest-ch a[href=\"#htmcab\"][data-key=cab-connect-where]")) && !!(await p.$("[data-key=cab-off-where]")));
  await p.goto(U + '#handover'); await wait(1000);
  ok('«Передайте в ХТМ»: панель «Внести за мене в кабінет ХТМ» з «Підключити кабінет ХТМ»', await vis('[data-key=handover-auto] [data-key=hc-connect]'), await txt('[data-key=handover-auto]'));
  await p.click('[data-key=hc-connect]'); await wait(700);
  ok('екран «Кабінет ХТМ»: e-mail, пароль, телефон, згода, «незалежний сервіс»', await vis('#hc-email') && await vis('#hc-pass') && await vis('#hc-phone') && await vis('#hc-consent') && /незалежний сервіс/.test(await txt('#hc-form')));
  await p.fill('#hc-email', 'test@stand.local'); await p.fill('#hc-pass', 'stand-pass-123'); await p.click('[data-key=hc-connect-go]'); await wait(400);
  ok('без згоди — не підключаємо, пояснення', /позначку згоди/.test(await txt('[data-key=hc-err]')));
  await p.fill('#hc-pass', 'wrong-pass'); await p.check('#hc-consent'); await p.click('[data-key=hc-connect-go]'); await p.waitForSelector('[data-key=hc-err][data-err=cab_bad_login]', { timeout: 10000 }).catch(() => {});
  ok('невірний пароль → «Кабінет ХТМ не пустив» і слова сайту', /не пустив/.test(await txt('[data-key=hc-err]')) && /Невірний логін/.test(await txt('[data-key=hc-err]')), await txt('[data-key=hc-err]'));
  await p.fill('#hc-pass', 'stand-pass-123'); await p.fill('#hc-phone', '050 111 22 33'); if (!(await p.isChecked('#hc-consent'))) await p.check('#hc-consent');
  await p.click('[data-key=hc-connect-go]'); await p.waitForURL(/#handover$/, { timeout: 10000 }).catch(() => {}); await wait(800);
  ok('підключили → назад на «Передайте», робот — першим', /#handover$/.test(p.url()) && await vis('.ho-steps > [data-key=handover-auto] [data-key=hc-ask]'), p.url());
  ok('…вручну — запасне «Або внесіть самі»', /Або внесіть самі/.test(await txt('.ho-steps')));
  ok('…телефон запам’ятали в контактах', (await st()).contacts.phone === '050 111 22 33');
  await p.click('[data-key=hc-ask]'); await wait(300);
  const cf = await txt('[data-key=hc-confirm]');
  ok('«Перевірте ще раз»: квартира, рахунок 1000000061, дата 10.11.2026, 14.445 Гкал, телефон', /1000000061/.test(cf) && /10\.11\.2026/.test(cf) && /14\.445/.test(cf) && /050 111 22 33/.test(cf), cf);
  await p.click('[data-key=hc-send]'); await p.waitForURL(/#status$/, { timeout: 15000 }).catch(() => {}); await wait(600);
  let s = await st(), r = s.readings.find(x => x.id === 'rnow');
  ok('«Так, внести» → статус «чекаємо перевірки робота ХТМ»', /#status$/.test(p.url()) && await vis('[data-key=status-cab-wait]'), await txt('main'));
  ok('…запис «передано» з номером внесення', r.status === 'handed' && r.cab && r.cab.job > 0 && r.cab.status === 'pending', r);
  ok('…рахунок квартири запам’ятали в налаштуваннях лічильника', s.places[0].meter.account === '1000000061' || s.meter.account === '1000000061');
  const store = await (await fetch(M + '/stand/state')).json().catch(() => ({}));
  ok('…на стенді — запис 10.11.2026 з нашими цифрами', JSON.stringify(store).includes('14.445') && JSON.stringify(store).includes('2332.676'));
  await stand('act=robot'); const c1 = cron(25);
  ok('cron через 25 хв: журнал «прийнято»', /"ok"/.test(c1), c1);
  await p.click('[data-key=status-cab-refresh]'); await p.waitForSelector('[data-key=status-accepted]', { timeout: 8000 }).catch(() => {});
  s = await st(); r = s.readings.find(x => x.id === 'rnow');
  ok('«Оновити статус» → «Прийнято» (via cab), база = ці показання', await vis('[data-key=status-accepted]') && r.status === 'accepted' && r.result.via === 'cab' && (s.baseline || {}).energy === '14.445', r);
  await p.goto(U + '#htmcab'); await wait(800);
  ok('«Кабінет ХТМ»: підключено, вхід test@stand.local, рахунок', await vis('[data-key=hc-connected]') && /test@stand\.local/.test(await txt('main')) && /1000000061/.test(await txt('main')));
  ok('…«Внесені роботом»: 10.11.2026 — прийнято', /10\.11\.2026/.test(await txt('[data-key=hc-jobs]')) && /прийнято/.test(await txt('[data-key=hc-jobs]')));
  await p.click('[data-key=hc-check-go]'); await p.waitForSelector('[data-key=hc-check]', { timeout: 10000 }).catch(() => {});
  const ck = await txt('[data-key=hc-check]');
  ok('«Перевірити, що бачить кабінет»: прилад Sharky 774, прийом відкритий, форма як знає робот', /Sharky 774/.test(ck) && /відкритий/.test(ck) && (await p.getAttribute('[data-key=hc-form]', 'data-match')) === '1', ck);
  await p.setViewportSize({ width: 320, height: 700 }); await wait(300);
  ok('320 px — екран кабінету не ширший за екран', await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await p.setViewportSize({ width: 390, height: 844 });
  const h0 = await (await fetch(U + 'api/health')).json();
  await p.click('[data-key=hc-forget]'); await wait(200); await p.click('[data-key=hc-forget-yes]'); await wait(1200);
  ok('«Забути пароль» → знову форма підключення', await vis('#hc-email') && !(await p.$('[data-key=hc-connected]')));
  const h = await (await fetch(U + 'api/health')).json();
  ok('/api/health → htmcab: форма без значень, підключених на одного менше', h.htmcab && h.htmcab.connected === h0.htmcab.connected - 1 && h.htmcab.form && h.htmcab.form.match === true && !JSON.stringify(h).includes('stand-pass'), h.htmcab);
  ok('без помилок JS', !errs.length, errs);
  await b.close(); await stand('act=reset'); await stand('act=set&scenario=ok');
  console.log(`\nИтог: ${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})();
