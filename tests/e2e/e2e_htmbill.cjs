// Квитанция ХТМ в фоне, без участия человека (владелец 07.11: «платёжки ХТМ тоже автоматом скачивались в запись об оплате в истории»): сервер сам
// (HtmBills) входит в подключённый кабинет ХТМ, берёт рахунок («Сформувати рахунок» — HTML, как живой 07.11) и кладёт к показаниям того же месяца, а нет их —
// отдельной «Платіжкою ХТМ» в историю тепла; приложение лишь
// видит её по синхронизации (тост, «з кабінету ХТМ»). Нужны: сайт 8013 (config.php: sqlite, 'htm_cab_base' => 'http://127.0.0.1:8099'), стенд ХТМ
// (cd tests/htm-mock && php -S 127.0.0.1:8099 -t public public/router.php). cron — tests/e2e/htmbills_cron.php с тем же SITE_DATA.
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const { execFileSync } = require('child_process'); const path = require('path');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', HM = 'http://127.0.0.1:8099', DATA = process.env.SITE_DATA || '/tmp/teplo_data';
const T = Date.UTC(2026, 10, 7, 8, 0, 0) / 1000;   // 7 листопада, 10:00 по Киеву → квитанция за жовтень
const cron = (ts, reset) => JSON.parse(execFileSync('php', [path.join(__dirname, 'htmbills_cron.php'), String(ts)].concat(reset ? ['reset'] : []), { env: Object.assign({}, process.env, { SITE_DATA: DATA, SITE_BASE: '' }) }).toString().trim().split('\n').pop());
const stand = b => fetch(HM + '/stand/admin', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: b });
(async () => {
  await stand('act=reset'); await stand('act=set&scenario=ok&today=2026-11-07&robot_delay=99999&bill_ym=2026-10&bill_pay=1234.56');
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const wait = ms => p.waitForTimeout(ms), st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  const rec = s => (s.readings || []).filter(r => r.id === 'r10')[0] || {};
  const srv = () => p.evaluate(() => window.TeploSync.api('GET', '/state').then(j => j.state));
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(500);
  ok('регистрация', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'hb' + Date.now() + '@teplo.test') === 200);
  // теплосчётчик с рахунком кабинета, запись тепла 20.10 — без квитанции
  await p.evaluate(([s]) => {
    s.meter.account = '1000000061'; s.places[0].meter = s.meter;
    s.readings.push({ id: 'r10', place: 'main', htm: { date: '2026-10-20', energy: '13.500', volume: '2330', hours: '34900', errHours: '153', errCode: 'E---' }, status: 'accepted', createdAt: '2026-10-20T10:00:00Z', updatedAt: 1, source: 'manual' });
    s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s));
  }, [demo({ today: '2026-11-06' })]);
  await p.reload(); await wait(2500);
  const cn = await p.evaluate(() => window.TeploSync.api('POST', '/cab/htm/connect', { email: 'test@stand.local', password: 'stand-pass-123', consent: true, lang: 'uk' }));
  const s0 = await srv();
  ok('кабинет ХТМ подключён; на сервере рахунок счётчика и запись 20.10', cn && cn.connected === true && s0 && s0.places[0].meter.account === '1000000061' && (s0.readings || []).some(r => r.id === 'r10'), [cn, s0 && s0.places[0].meter]);
  ok('cron: в 23:00 — не ходим', JSON.stringify(cron(Date.UTC(2026, 10, 7, 21) / 1000, true)) === '[]');
  const c1 = cron(T, true);
  ok('cron 7-го в 10:00 — вход в кабинет, рахунок за жовтень → к показаниям 20.10 (got)', c1.length === 1 && c1[0][1] === 'got', c1);
  const s1 = await srv(), bs = rec(s1).bills || [];
  ok('…на сервере у записи 20.10 — квитанція (auto htm, копия страницы рахунку, «жовтень 2026», до сплати), без участия человека', bs.length === 1 && bs[0].auto === 'htm' && bs[0].mime === 'text/html' && bs[0].pay === '1234.56' && /Квитанція ХТМ, жовтень 2026/.test(bs[0].name), bs);
  await p.reload(); const toast = await p.waitForFunction(() => /Квитанцію ХТМ за жовтень 2026 додано/.test(document.body.textContent), null, { timeout: 8000 }).then(() => true, () => false); await wait(500);
  let s = await st(), bl = rec(s).bills || [];
  ok('приложение: квитанция пришла синхронизацией, тост «Квитанцію ХТМ … додано»', toast && bl.length === 1 && bl[0].auto === 'htm', [toast, bl]);
  await p.goto(U + '#rec-r10'); await wait(1200);
  const box = await p.textContent('[data-key=bills-h-r10]').catch(() => '');
  ok('у записі тепла — «Платіжка за жовтень 2026», файл и пометка «з кабінету ХТМ»', /Платіжка за жовтень 2026/.test(box) && /Квитанція ХТМ/.test(box) && /з кабінету ХТМ/.test(box), box);
  ok('…в платёжке — «ХТМ» и до сплати', /до сплати 1\s?234,56 грн/.test(box) && /ХТМ/.test(await p.textContent('[data-key=bills-h-r10] .doc-th').catch(() => '')), box);
  const fr = await p.evaluate(id => fetch(window.TEPLO_API + '/docs/file?id=' + id, { credentials: 'same-origin' }).then(r => r.text().then(t => ({ csp: r.headers.get('content-security-policy') || '', ct: r.headers.get('content-type') || '', t }))), bl[0].id);
  ok('…файл квитанции: страница рахунку под CSP sandbox, без скриптов', /sandbox/.test(fr.csp) && /text\/html/.test(fr.ct) && /Рахунок за послуги за жовтень 2026/.test(fr.t) && !/<script/i.test(fr.t), [fr.csp, fr.ct]);
  ok('cron через минуту — квартиру уже смотрели, в кабинет не идём', JSON.stringify(cron(T + 60)) === '[]');
  // в кабинете уже рахунок за листопад, а показаний за листопад нет → «Платіжка ХТМ» в истории тепла
  await stand('act=set&scenario=ok&today=2026-12-07&robot_delay=99999&bill_ym=2026-11&bill_pay=980.10');
  const c2 = cron(T + 21 * 3600); ok('cron через сутки: рахунок за листопад без показань → new', c2.length === 1 && c2[0][1] === 'new', c2);
  await p.reload(); const toast2 = await p.waitForFunction(() => /Квитанцію ХТМ за листопад 2026 додано в історію тепла/.test(document.body.textContent), null, { timeout: 8000 }).then(() => true, () => false);
  await p.goto(U + '#history'); await wait(1200); const hrow = await p.textContent('[data-key^=hbill-]').catch(() => '');
  ok('история тепла: тост и строка «Платіжка ХТМ · листопад 2026 · до сплати 980,10 грн»', toast2 && /Платіжка ХТМ/.test(hrow) && /листопад 2026/.test(hrow) && /980,10/.test(hrow), [toast2, hrow]);
  await p.click('[data-key^=hbill-] a'); await wait(900); const hv = await p.textContent('main').catch(() => '');
  ok('…открыл — квитанция «Платіжка за листопад 2026», сумма, «Видалити»', /Платіжка за листопад 2026/.test(hv) && /980,10/.test(hv) && await p.locator('[data-key=rec-del]').count() === 1, hv.slice(0, 300));

  // «Кабінети й автовідправка» → блок ХТМ → «Квитанції самі»
  await p.goto(U + '#prefs'); await wait(800); await p.click('[data-key=pg-cabs] summary'); await wait(1500);
  const cb = p.locator('[data-key=prefs-htm-bills]');
  ok('настройки: в блоке ХТМ «Квитанції самі» — включено', await cb.isChecked().catch(() => false) && /Квитанції самі/.test(await p.textContent('[data-key=prefs-cab-htm]')));
  await cb.click(); await wait(2500); const s2 = await srv();
  ok('…выключили → meter.billAuto false на сервере', s2.places[0].meter.billAuto === false && /Квитанції ХТМ більше не беремо/.test(await p.textContent('body')), s2.places[0].meter);
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.readings.forEach(r => { if (r.id === 'r10') { r.bills = []; r.updatedAt = Date.now(); } }); s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await wait(2500);
  ok('…cron не ходит в выключенную квартиру', JSON.stringify(cron(T + 120, true)) === '[]');
  ok('без ошибок JS', !errs.length, errs);
  console.log('Итог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
