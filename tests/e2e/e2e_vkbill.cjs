// Квитанция Водоканала в фоне (владелец 07.11): при заходе сервер берёт PDF со страницы сайта (iframe …checkPDF.pdf) и мы прикрепляем его к записи воды
// прошлого месяца. Нужны: сайт 8013 (config.php: 'vk_cab_base' => 'http://127.0.0.1:8098'), стенд Водоканала php -S 127.0.0.1:8098 tests/vk-mock/router.php (рахунок 905616).
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const fs = require('fs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', VM = 'http://127.0.0.1:8098', DATA = process.env.SITE_DATA || '/tmp/teplo_data';
(async () => {
  await fetch(VM + '/__reset'); try { fs.unlinkSync('/tmp/vkm_bill.txt'); } catch (e) {}
  const n = Math.floor(Date.now() / 1000); fs.mkdirSync(DATA + '/cache', { recursive: true });
  fs.writeFileSync(DATA + '/cache/vk_status.json', JSON.stringify({ cab: { state: 'ok', at: n, since: n - 3600, everOk: true, lastOk: n, code: 200 } }));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); let calls = 0; p.on('request', r => { if (/\/api\/vk\/bill/.test(r.url())) calls++; });
  const wait = ms => p.waitForTimeout(ms), st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  const rec = s => (s.water || []).filter(r => r.id === 'w20261015')[0] || {};
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(500);
  ok('регистрация', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'vb' + Date.now() + '@teplo.test') === 200);
  // рахунок и прізвище для сайта Водоканала есть, запись воды 15.10 — без квитанции, сегодня 6.11
  await p.evaluate(([s]) => { s.places[0].water.account = '905616'; s.places[0].water.surname = 'Шевченко'; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, [demo({ today: '2026-11-06' })]);
  await p.reload(); const toast = await p.waitForFunction(() => /Квитанцію Водоканалу за жовтень 2026 додано/.test(document.body.textContent), null, { timeout: 8000 }).then(() => true, () => false); await wait(500);
  let s = await st(), bl = rec(s).bills || [];
  ok('при заході: квитанція скачана й прикріплена до запису 15.10', calls === 1 && bl.length === 1 && bl[0].auto === 'vk' && bl[0].mime === 'application/pdf' && /Квитанція Водоканалу, жовтень 2026/.test(bl[0].name), [calls, bl]);
  ok('…тост «Квитанцію Водоканалу за жовтень 2026 додано до запису»', toast);
  await p.goto(U + '#wrec-w20261015'); await wait(1200);
  ok('у записі — «Платіжка за жовтень 2026» з файлом', /Платіжка за жовтень 2026/.test(await p.textContent('[data-key=bills-w-w20261015]').catch(() => '')) && /Квитанція Водоканалу/.test(await p.textContent('[data-key=bills-w-w20261015]').catch(() => '')));
  await p.reload(); await wait(2500); s = await st();
  ok('повторний захід — сайт не питаємо, друга не з’являється', calls === 1 && (rec(s).bills || []).length === 1, [calls, rec(s).bills]);
  // наступного дня, а квитанція на сайті та сама (людина свою прибрала з запису, документ лишився) — нічого не додаємо
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.vkBill = {}; s.water.forEach(r => { if (r.id === 'w20261015') r.bills = []; }); s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await wait(3500); s = await st();
  ok('та сама квитанція (той самий відбиток) — не прикріплюємо вдруге', calls === 2 && !(rec(s).bills || []).length, [calls, rec(s).bills]);
  // після 25-го — не питаємо
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.vkBill = {}; s.demoToday = '2026-11-26'; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await wait(2500);
  ok('26-го — сайт не питаємо', calls === 2, calls);
  ok('без ошибок JS', !errs.length, errs);
  console.log('Итог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
