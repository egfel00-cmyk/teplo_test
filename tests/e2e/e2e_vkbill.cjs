// Квитанция Водоканала в фоне, без участия человека (владелец 07.11: «скачивать и добавлять в фоне автоматом без участия юзера»): сервер сам (cron,
// VkBills) берёт PDF со страницы сайта (iframe …checkPDF.pdf) и прикрепляет к записи воды прошлого месяца в данных человека; приложение лишь видит её после
// синхронизации (тост, «з сайту Водоканалу»). Нужны: сайт 8013 (config.php: sqlite, 'vk_cab_base' => 'http://127.0.0.1:8098'), стенд Водоканала
// php -S 127.0.0.1:8098 tests/vk-mock/router.php (рахунок 905616). cron — tests/e2e/vkbills_cron.php с тем же SITE_DATA.
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const fs = require('fs'); const { execFileSync } = require('child_process'); const path = require('path');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', VM = 'http://127.0.0.1:8098', DATA = process.env.SITE_DATA || '/tmp/teplo_data';
const T = Date.UTC(2026, 10, 7, 8, 0, 0) / 1000;   // 7 листопада, 10:00 по Киеву → квитанция за жовтень
const cron = (ts, reset) => JSON.parse(execFileSync('php', [path.join(__dirname, 'vkbills_cron.php'), String(ts)].concat(reset ? ['reset'] : []), { env: Object.assign({}, process.env, { SITE_DATA: DATA, SITE_BASE: '' }) }).toString().trim().split('\n').pop());
(async () => {
  await fetch(VM + '/__reset'); try { fs.unlinkSync('/tmp/vkm_bill.txt'); } catch (e) {}
  const n = Math.floor(Date.now() / 1000); fs.mkdirSync(DATA + '/cache', { recursive: true });
  fs.writeFileSync(DATA + '/cache/vk_status.json', JSON.stringify({ cab: { state: 'ok', at: n, since: n - 3600, everOk: true, lastOk: n, code: 200 } }));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); let calls = 0; p.on('request', r => { if (/\/api\/vk\/bill/.test(r.url())) calls++; });
  const wait = ms => p.waitForTimeout(ms), st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  const rec = s => (s.water || []).filter(r => r.id === 'w20261015')[0] || {};
  const srv = () => p.evaluate(() => window.TeploSync.api('GET', '/state').then(j => j.state));
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(500);
  ok('регистрация', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'vb' + Date.now() + '@teplo.test') === 200);
  // рахунок и прізвище для сайта Водоканала есть, запись воды 15.10 — без квитанции
  await p.evaluate(([s]) => { s.places[0].water.account = '905616'; s.places[0].water.surname = 'Шевченко'; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, [demo({ today: '2026-11-06' })]);
  await p.reload(); await wait(2500);
  const s0 = await srv();
  ok('данные на сервере (рахунок, запись 15.10); приложение само сайт Водоканалу не спрашивает', calls === 0 && s0 && s0.places[0].water.account === '905616' && (s0.water || []).some(r => r.id === 'w20261015'), [calls]);
  ok('cron: 26-го и в 23:00 — не ходим', JSON.stringify(cron(Date.UTC(2026, 10, 26, 8) / 1000, true)) === '[]' && JSON.stringify(cron(Date.UTC(2026, 10, 7, 21) / 1000, true)) === '[]');
  const c1 = cron(T, true);
  ok('cron 7-го в 10:00 — вход на сайт, квитанция → got', c1.length === 1 && c1[0][1] === 'got', c1);
  const s1 = await srv(), bs = rec(s1).bills || [];
  ok('…на сервере у записи 15.10 — квитанція (auto vk, PDF, «жовтень 2026»), без участия человека', bs.length === 1 && bs[0].auto === 'vk' && bs[0].mime === 'application/pdf' && /Квитанція Водоканалу, жовтень 2026/.test(bs[0].name), bs);
  // приложение: при заходе (синхронизация) — квитанция в записи и тост
  await p.reload(); const toast = await p.waitForFunction(() => /Квитанцію Водоканалу за жовтень 2026 додано/.test(document.body.textContent), null, { timeout: 8000 }).then(() => true, () => false); await wait(500);
  let s = await st(), bl = rec(s).bills || [];
  ok('приложение: квитанция пришла синхронизацией, тост «… додано до запису»', toast && bl.length === 1 && bl[0].auto === 'vk', [toast, bl]);
  await p.goto(U + '#wrec-w20261015'); await wait(1200);
  const box = await p.textContent('[data-key=bills-w-w20261015]').catch(() => '');
  ok('у записі — «Платіжка за жовтень 2026», файл и пометка «з сайту Водоканалу»', /Платіжка за жовтень 2026/.test(box) && /Квитанція Водоканалу/.test(box) && /з сайту Водоканалу/.test(box), box);
  ok('cron через минуту — уже прикрепили, на сайт не идём', JSON.stringify(cron(T + 60)) === '[]');
  await p.reload(); await wait(2500); s = await st();
  ok('повторный заход — второй не появилось, тоста нет', (rec(s).bills || []).length === 1 && calls === 0);
  // «Кабінети й автовідправка» → «Квитанції самі»
  await p.goto(U + '#prefs'); await wait(800); await p.click('[data-key=pg-cabs] summary'); await wait(800);
  const cb = p.locator('[data-key=prefs-vk-bills]');
  ok('настройки: «Квитанції самі» — включено', await cb.isChecked().catch(() => false) && /Квитанції самі/.test(await p.textContent('[data-key=prefs-cab-vk]')));
  await cb.click(); await wait(2500); const s2 = await srv();
  ok('…выключили → billAuto false на сервере', s2.places[0].water.billAuto === false && /більше не беремо/.test(await p.textContent('body')), s2.places[0].water);
  // новая запись за жовтень без квитанции у выключенной квартиры — cron не идёт
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.water.forEach(r => { if (r.id === 'w20261015') r.bills = []; r.updatedAt = Date.now(); }); s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await wait(2500);
  ok('…cron не ходит в выключенную квартиру', JSON.stringify(cron(T + 120, true)) === '[]');
  ok('без ошибок JS', !errs.length, errs);
  console.log('Итог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
