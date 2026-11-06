// Вода → автовідправка на сайт Водоканалу після фото в бот (VkSvc, 06.11.2026): згода в «Налаштуваннях» → фото холодного водоміра
// «з бота» (?inbox=1&auto=1) → розпізнано впевнено, перевірки без зауважень → запис збережено й у черзі сервера на 10 хв («Надішлемо о HH:MM»,
// «Скасувати» / «Надіслати зараз»); невпевнено — банер «Самі не надсилали» з причиною і звичайне введення.
// Нужны: сайт 127.0.0.1:8013 (config.php: 'vk_cab_base' => 'http://127.0.0.1:8098'), кабинет Водоканала: php -S 127.0.0.1:8098 tests/vk-mock/router.php
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const fs = require('fs'); const { execFileSync } = require('child_process');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', VM = 'http://127.0.0.1:8098', DATA = process.env.SITE_DATA || '/tmp/teplo_data', DB = DATA + '/dev.sqlite';
const sql = (q, args) => execFileSync('php', ['-r', '$p = new PDO("sqlite:" . $argv[1]); $s = $p->prepare($argv[2]); $s->execute(json_decode($argv[3], true)); echo json_encode($s->fetchAll(PDO::FETCH_ASSOC));', DB, q, JSON.stringify(args || [])]).toString();
const D = (text, o) => Object.assign({ text, votes: 3, score: 0.98, cells: 5, sure: true, red: '123' }, o || {});
const fake = drum => ({ engine: 'local', meter: null, photos: [{ index: 0, kind: 'water', meterType: 'water', quality: 'ok', readings: [], ocr: { lines: [], drums: [drum] } }] });
(async () => {
  await fetch(VM + '/__reset'); sql('DELETE FROM rate_limits');
  const n = Math.floor(Date.now() / 1000); fs.mkdirSync(DATA + '/cache', { recursive: true });
  fs.writeFileSync(DATA + '/cache/vk_status.json', JSON.stringify({ cab: { state: 'ok', at: n, since: n - 3600, everOk: true, lastOk: n, code: 200 } }));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' });
  await ctx.addInitScript(() => {
    Object.defineProperty(window, 'TeploVision', { configurable: true, get() { return undefined; }, set(v) {
      Object.defineProperty(v, 'available', { configurable: true, get() { return true; }, set() {} });
      v.recognize = () => new Promise(ok => { const t = setInterval(() => { if (window.__FAKE) { clearInterval(t); const r = window.__FAKE; window.__FAKE = null; ok(JSON.parse(JSON.stringify(r))); } }, 100); });
      Object.defineProperty(window, 'TeploVision', { value: v, writable: true, configurable: true });
    } });
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  const wait = ms => p.waitForTimeout(ms), vis = async sel => !!(await p.$(sel)) && await p.isVisible(sel), txt = sel => p.textContent(sel).catch(() => '');
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(500);
  ok('регистрация', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'va' + Date.now() + '@teplo.test') === 200);
  const uid = await p.evaluate(() => window.TeploSync.account.id);
  await p.evaluate(s => { delete s.demoToday; s.places[0].water.account = '905614'; s.places[0].water.surname = 'Шевченко'; s.water = s.water.filter(w => w.base || w.date < '2026-11-01'); s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, demo({}));
  await p.reload(); await wait(1200);
  ok('згода на автовідправку води', await p.evaluate(() => window.TeploSync.api('POST', '/vk/auto', { on: true, consent: true }).then(j => j.auto)) === true);
  const putPhoto = async () => {
    const id = await p.evaluate(async () => {
      const c = (document.cookie.match(/ts_csrf=([^;]*)/) || [])[1];
      const cv = document.createElement('canvas'); cv.width = 40; cv.height = 30; const bl = await new Promise(ok => cv.toBlob(ok, 'image/jpeg'));
      const r = await fetch('/api/recognize/upload', { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-CSRF': c }, body: bl }); return (await r.json()).id;
    });
    sql('INSERT INTO bot_inbox (photo_id, user_id, taken_at, created_at) VALUES (?, ?, ?, ?)', [id, uid, n, new Date().toISOString()]);
  };
  const runInbox = async res => { await p.goto(U + '?inbox=1&auto=1#home'); await p.evaluate(r => { window.__FAKE = r; }, res); };
  // 1. уверенно, холодная 452 (прошлый раз 437) → в очереди на 10 мин
  await putPhoto(); await runInbox(fake(D('00452')));
  await p.waitForSelector('[data-key=vk-bg-q]', { timeout: 15000 }).catch(() => {});
  let s = await st(), w = (s.water || []).filter(x => !x.base).slice(-1)[0] || {};
  ok('фото з бота → запис збережено, у черзі «Надішлемо о HH:MM»', w.vals && Object.values(w.vals).includes(452) || JSON.stringify(w.vals || {}).includes('452') ? /Надішлемо на сайт Водоканалу о \d{2}:\d{2}/.test(await txt('[data-key=vk-bg-q]')) && w.vkJob && w.vkJob.auto && w.vkJob.status === 'queued' : false, [w, await txt('main')]);
  const job = JSON.parse(sql("SELECT status, next_at, acc FROM cab_jobs WHERE prov = 'vk' ORDER BY id DESC LIMIT 1"))[0] || {};
  ok('…на сервері: queued, через ~10 хв, рахунок', job.status === 'queued' && +job.next_at > n + 500 && job.acc === '905614', job);
  ok('…на сайт ще нічого не пішло', !(await (await fetch(VM + '/__store')).json())._lastPost);
  await p.click('[data-key=vk-bg-cancel]'); await wait(1200);
  s = await st(); w = (s.water || []).filter(x => !x.base).slice(-1)[0] || {};
  ok('«Скасувати» → скасовано, знову кнопка «Відправити у фоні»', w.vkJob && w.vkJob.status === 'cancelled' && await vis('[data-key=vk-bg]'), w.vkJob);
  // 2. неуверенно (окно прочитано не всеми голосами) → не надсилаємо, банер з причиною
  await putPhoto(); await runInbox(fake(D('00460', { votes: 1, score: 0.6, sure: false })));
  await p.waitForSelector('[data-key=wn-auto-why]', { timeout: 15000 }).catch(() => {});
  ok('невпевнено → «Самі не надсилали — потрібен ваш погляд» і звичайне введення', /#wnew/.test(p.url()) && await vis('[data-key=wn-auto-why]'), [p.url(), await txt('main')]);
  ok('…черга не поповнилась', JSON.parse(sql("SELECT COUNT(*) AS c FROM cab_jobs WHERE prov = 'vk' AND status = 'queued'"))[0].c == 0);
  ok('без ошибок JS', errs.length === 0, errs);
  await b.close(); console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); process.exit(fail ? 1 : 0);
})();
