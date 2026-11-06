// Автоподача ХТМ після фото в бот (07.11.2026): переключатель на «Кабінет ХТМ» → фото з бота розпізнано (тут — підмінений розпізнавач) →
// усе прочитано впевнено й перевірки пройдено → запис «перевірено» + черга сервера «Внесемо о HH:MM» → «Скасувати» / «Внести зараз».
// Не впевнено прочитано — нічого не ставимо в чергу, екран фото з причиною.
// Нужны: сайт 127.0.0.1:8013 (SITE_DATA=/tmp/teplo_data, config.php: 'htm_cab_base' => 'http://127.0.0.1:8099', sqlite dev.sqlite) и стенд кабинета ХТМ:
//   cp -r tests/htm-mock /tmp && cd /tmp/htm-mock && php -S 127.0.0.1:8099 -t public public/router.php      node tests/e2e/e2e_htmauto.cjs
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const { execFileSync } = require('child_process');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', M = 'http://127.0.0.1:8099', DB = (process.env.SITE_DATA || '/tmp/teplo_data') + '/dev.sqlite';
const stand = body => fetch(M + '/stand/admin', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
const sql = (q, args) => execFileSync('php', ['-r', '$p = new PDO("sqlite:" . $argv[1]); $s = $p->prepare($argv[2]); $s->execute(json_decode($argv[3], true)); echo json_encode($s->fetchAll(PDO::FETCH_ASSOC));', DB, q, JSON.stringify(args || [])]).toString();
// 16.11.2026 12:00 по Києву — коли «сфотографовано» (дата зняття береться з фото)
const TAKEN = Math.floor(Date.parse('2026-11-16T10:00:00Z') / 1000);
const V = { energy: '14.445', volume: '2332.676', flow: '0.063', power: '1.445', tSupply: '50.12', tReturn: '30.4', hours: '35246', errHours: '153', errCode: 'E---' };
const fake = (vals, conf) => ({ meter: { modelId: 'sharky774', energyUnit: 'Gcal', confidence: 0.9 }, engine: 'local',
  photos: [{ index: 0, kind: 'screen', meterType: 'heat', quality: 'ok', readings: Object.keys(vals).map(k => ({ field: k, value: vals[k], unit: k === 'energy' ? 'Gcal' : '', confidence: (conf || {})[k] || 0.95 })) }] });
(async () => {
  await stand('act=reset'); await stand('act=set&scenario=ok&today=2026-11-16&robot_delay=99999');
  sql('DELETE FROM rate_limits');
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' });
  // распознаватель подменяем до загрузки страницы: ждёт window.__FAKE (результат «движка») и отдаёт его
  await ctx.addInitScript(() => {
    Object.defineProperty(window, 'TeploVision', { configurable: true, get() { return undefined; }, set(v) {
      Object.defineProperty(v, 'available', { configurable: true, get() { return true; }, set() {} });
      v.recognize = () => new Promise(ok => { const t = setInterval(() => { if (window.__FAKE) { clearInterval(t); const r = window.__FAKE; window.__FAKE = null; ok(JSON.parse(JSON.stringify(r))); } }, 100); });
      Object.defineProperty(window, 'TeploVision', { value: v, writable: true, configurable: true });
    } });
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  const wait = ms => p.waitForTimeout(ms), vis = async sel => !!(await p.$(sel)) && await p.isVisible(sel), txt = sel => p.textContent(sel).catch(() => '');
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(500);
  ok('регистрация', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'ha' + Date.now() + '@teplo.test') === 200);
  const uid = await p.evaluate(() => window.TeploSync.account.id);
  // останні прийняті — як на стенді (20.10, 13.245)
  const base = { date: '2026-10-20', energy: '13.245', volume: '2292.676', flow: '0.063', power: '1.685', tSupply: '50.76', tReturn: '27.71', hours: '34598', errHours: '153', errCode: 'E---' };
  await p.evaluate(([s, base]) => { s.baseline = base; s.places[0].baseline = base; s.readings = []; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, [demo({ today: '2026-11-16' }), base]);
  await p.reload(); await wait(1200);
  const con = await p.evaluate(() => window.TeploSync.api('POST', '/cab/htm/connect', { email: 'test@stand.local', password: 'stand-pass-123', phone: '050 111 22 33', consent: true, lang: 'uk' }).then(j => j._status));
  ok('кабінет підключено', con === 200);

  await p.goto(U + '#htmcab'); await wait(1200);
  ok('«Кабінет ХТМ»: блок «Автоподача після фото в бот», вимкнено', await vis('[data-key=ha-box]') && !(await p.isChecked('[data-key=ha-toggle]')), await txt('[data-key=ha-box]'));
  ok('…пояснення: «Розпізнати й внести», за 10 хв, можна скасувати', /Розпізнати й внести/.test(await txt('[data-key=ha-box]')) && /10 хв/.test(await txt('[data-key=ha-box]')) && /скасувати/.test(await txt('[data-key=ha-box]')));
  await p.check('[data-key=ha-toggle]'); await p.waitForSelector('[data-key=ha-on]', { timeout: 8000 }).catch(() => {});
  if (process.env.SHOT) await p.screenshot({ path: '/tmp/ha_cab.png', fullPage: true });
  ok('увімкнули → «Увімкнено», на сервері auto', await vis('[data-key=ha-on]') && (await p.evaluate(() => window.TeploSync.api('GET', '/cab/htm').then(j => j.auto))) === true);

  // фото «з бота» → вхідні
  const putPhoto = async () => {
    const id = await p.evaluate(async () => {
      const c = (document.cookie.match(/ts_csrf=([^;]*)/) || [])[1];
      const cv = document.createElement('canvas'); cv.width = 40; cv.height = 30; const bl = await new Promise(ok => cv.toBlob(ok, 'image/jpeg'));
      const r = await fetch('/api/recognize/upload', { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-CSRF': c }, body: bl }); return (await r.json()).id;
    });
    sql('INSERT INTO bot_inbox (photo_id, user_id, taken_at, created_at) VALUES (?, ?, ?, ?)', [id, uid, TAKEN, new Date().toISOString()]);
    return id;
  };
  // как кнопка бота «Розпізнати й внести»: ?inbox=1 — приложение само берёт фото из входящих и распознаёт
  const runInbox = async (res) => { await p.goto(U + '?inbox=1&auto=1#home'); await p.evaluate(r => { window.__FAKE = r; }, res); };

  // 1. усе впевнено → черга
  await putPhoto(); await runInbox(fake(V));
  await p.waitForSelector('[data-key=status-cab-queued]', { timeout: 15000 }).catch(() => {});
  let s = await st(), r = (s.readings || []).slice(-1)[0] || {};
  ok('фото з бота → одразу «Внесемо в кабінет ХТМ о HH:MM»', /#status$/.test(p.url()) && /Внесемо в кабінет ХТМ о \d{2}:\d{2}/.test(await txt('[data-key=status-cab-queued]')), [p.url(), await txt('main')]);
  ok('…запис: дата з фото 16.11, перевірено й «передано» з чергою, auto', r.htm && r.htm.date === '2026-11-16' && r.status === 'handed' && r.auto === true && r.cab && r.cab.status === 'queued' && r.cab.job > 0, r);
  ok('…на сервері внесення в черзі (ще не внесено на стенді)', JSON.parse(sql("SELECT status FROM cab_jobs WHERE id = ?", [r.cab && r.cab.job]))[0].status === 'queued' && !JSON.stringify(await (await fetch(M + '/stand/state')).json()).includes('2332.676'));
  ok('…вхідні з бота розібрані', (await p.evaluate(() => fetch('/api/inbox').then(x => x.json()))).items.length === 0);
  if (process.env.SHOT) await p.screenshot({ path: '/tmp/ha_queued.png' });
  ok('…кнопки «Внести зараз» і «Скасувати»', await vis('[data-key=status-cab-now]') && await vis('[data-key=status-cab-cancel]'));
  await p.setViewportSize({ width: 320, height: 700 }); await wait(200);
  ok('320 px — екран черги не ширший за екран', await p.evaluate(() => document.documentElement.scrollWidth <= 320));
  await p.setViewportSize({ width: 390, height: 844 });
  await p.click('[data-key=status-cab-cancel]'); await p.waitForSelector('[data-key=status-cab-cancelled]', { timeout: 8000 }).catch(() => {});
  s = await st(); r = s.readings.slice(-1)[0];
  ok('«Скасувати» → «Внесення скасовано», запис знову «перевірено»', await vis('[data-key=status-cab-cancelled]') && r.status === 'checked' && r.cab.status === 'cancelled', r);
  await p.click('[data-key=status-cab-handover]'); await wait(800);
  ok('«Перейти до внесення» → «Передайте в ХТМ» з «Внести в кабінет ХТМ»', /#handover$/.test(p.url()) && await vis('[data-key=handover-auto] [data-key=hc-ask]'), await txt('[data-key=handover-auto]'));

  // 2. ще раз (інша енергія) → «Внести зараз»
  sql('DELETE FROM rate_limits');
  await putPhoto(); await runInbox(fake(Object.assign({}, V, { energy: '14.455' })));
  await p.waitForSelector('[data-key=status-cab-now]', { timeout: 15000 }).catch(() => {});
  await p.click('[data-key=status-cab-now]'); await p.waitForSelector('[data-key=status-cab-wait]', { timeout: 20000 }).catch(() => {});
  s = await st(); r = s.readings.slice(-1)[0];
  ok('«Внести зараз» → внесено, «чекаємо перевірки робота ХТМ»', await vis('[data-key=status-cab-wait]') && r.cab.status === 'pending' && r.status === 'handed', r);
  ok('…на стенді — запис 16.11.2026 з нашими цифрами', JSON.stringify(await (await fetch(M + '/stand/state')).json()).includes('14.455'));

  // 3. частину цифр прочитано не впевнено → не вносимо, екран фото з причиною
  sql('DELETE FROM rate_limits');
  const nJobs = JSON.parse(sql('SELECT COUNT(*) AS c FROM cab_jobs WHERE user_id = ?', [uid]))[0].c;
  await putPhoto(); await runInbox(fake(Object.assign({}, V, { energy: '14.465' }), { hours: 0.6 }));
  await p.waitForSelector('[data-key=photo-auto-why]', { timeout: 15000 }).catch(() => {});
  ok('не впевнено → «Самі не вносили», причина з полем', /#photo$/.test(p.url()) && (await p.getAttribute('[data-key=photo-auto-why]', 'data-why').catch(() => '')) === 'unsure' && /час роботи/i.test(await txt('[data-key=photo-auto-why]')), await txt('main'));
  if (process.env.SHOT) await p.screenshot({ path: '/tmp/ha_why.png' });
  ok('…у черзі сервера нічого нового', JSON.parse(sql('SELECT COUNT(*) AS c FROM cab_jobs WHERE user_id = ?', [uid]))[0].c === nJobs);
  ok('…значення на екрані фото — звірити й «Перевірити»', await vis('[data-key=photo-fields]') && await vis('[data-key=photo-check]'));

  // 4. автоподачу вимкнено → звичайне розпізнавання, без черги
  await p.goto(U + '#htmcab'); await wait(1000); await p.uncheck('[data-key=ha-toggle]'); await wait(1500);
  ok('вимкнули автоподачу', (await p.evaluate(() => window.TeploSync.api('GET', '/cab/htm').then(j => j.auto))) === false);
  await p.evaluate(() => { localStorage.removeItem('teplo.ph'); });
  await putPhoto(); await runInbox(fake(Object.assign({}, V, { energy: '14.475' })));
  await p.waitForSelector('[data-key=photo-fields]', { timeout: 15000 }).catch(() => {});
  ok('без автоподачі — екран фото без черги й без банера', await vis('[data-key=photo-fields]') && !(await p.$('[data-key=photo-auto-why]')) && JSON.parse(sql('SELECT COUNT(*) AS c FROM cab_jobs WHERE user_id = ?', [uid]))[0].c === nJobs);
  ok('без помилок JS', !errs.length, errs);
  await b.close();
  await stand('act=reset'); await stand('act=set&scenario=ok');
  console.log(`\nИтог: ${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})();
