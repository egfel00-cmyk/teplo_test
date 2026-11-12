// Картка фото в чаті (121-а), повний шлях на стенді ХТМ: фото з чату → застосунок з-під картки (?inbox=1&card=ID; розпізнавач підмінено —
// усе впевнено) → картка «готово» з планом для робота ХТМ (автоподача вимкнена) → «Відправити» (дотик картки) → черга одразу → cron робота
// вносить на стенд → картка «відправлено/прийнято» → застосунок пов'язав свій запис із задачею (handed/accepted).
// Нужны: сайт 127.0.0.1:8013 (SITE_DATA=/tmp/teplo_data, config.php: 'htm_cab_base' => 'http://127.0.0.1:8099', sqlite dev.sqlite) и стенд ХТМ:
//   cp -r tests/htm-mock /tmp && cd /tmp/htm-mock && php -S 127.0.0.1:8099 -t public public/router.php      node tests/e2e/e2e_cardsend.cjs
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const { execFileSync } = require('child_process'); const path = require('path');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', M = 'http://127.0.0.1:8099', SD = process.env.SITE_DATA || '/tmp/teplo_data', DB = SD + '/dev.sqlite';
const stand = body => fetch(M + '/stand/admin', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
const sql = (q, args) => JSON.parse(execFileSync('php', ['-r', '$p = new PDO("sqlite:" . $argv[1]); $s = $p->prepare($argv[2]); $s->execute(json_decode($argv[3], true)); echo json_encode($s->fetchAll(PDO::FETCH_ASSOC));', DB, q, JSON.stringify(args || [])]).toString() || '[]');
const php = (...a) => JSON.parse(execFileSync('php', [path.join(__dirname, 'card_php.php'), ...a.map(String)], { env: Object.assign({}, process.env, { SITE_DATA: SD }) }).toString());
const TAKEN = Math.floor(Date.parse('2026-11-16T10:00:00Z') / 1000);
const V = { energy: '14.445', volume: '2332.676', flow: '0.063', power: '1.445', tSupply: '50.12', tReturn: '30.4', hours: '35246', errHours: '153', errCode: 'E---' };
const fake = vals => ({ meter: { modelId: 'sharky774', energyUnit: 'Gcal', confidence: 0.9 }, engine: 'local',
  photos: [{ index: 0, kind: 'screen', meterType: 'heat', quality: 'ok', readings: Object.keys(vals).map(k => ({ field: k, value: vals[k], unit: k === 'energy' ? 'Gcal' : '', confidence: 0.95 })) }] });
(async () => {
  await stand('act=reset'); await stand('act=set&scenario=ok&today=2026-11-16&robot_delay=99999');
  sql('DELETE FROM rate_limits');
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
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(500);
  ok('реєстрація', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'cs' + Date.now() + '@teplo.test') === 200);
  const uid = await p.evaluate(() => window.TeploSync.account.id);
  const base = { date: '2026-10-20', energy: '13.245', volume: '2292.676', flow: '0.063', power: '1.685', tSupply: '50.76', tReturn: '27.71', hours: '34598', errHours: '153', errCode: 'E---' };
  await p.evaluate(([s, base]) => { s.baseline = base; s.places[0].baseline = base; s.readings = []; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, [demo({ today: '2026-11-16' }), base]);
  await p.reload(); await p.waitForTimeout(1200);
  ok('кабінет ХТМ підключено (автоподачу НЕ вмикали)', await p.evaluate(() => window.TeploSync.api('POST', '/cab/htm/connect', { email: 'test@stand.local', password: 'stand-pass-123', phone: '050 111 22 33', consent: true, lang: 'uk' }).then(j => j._status)) === 200);
  const pid = await p.evaluate(async () => {
    const c = (document.cookie.match(/ts_csrf=([^;]*)/) || [])[1]; const cv = document.createElement('canvas'); cv.width = 40; cv.height = 30; const bl = await new Promise(ok => cv.toBlob(ok, 'image/jpeg'));
    return (await (await fetch('/api/recognize/upload', { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-CSRF': c }, body: bl })).json()).id;
  });
  sql('INSERT INTO bot_inbox (photo_id, user_id, taken_at, created_at) VALUES (?, ?, ?, ?)', [pid, uid, TAKEN, new Date().toISOString()]);
  const now = new Date().toISOString();
  sql("INSERT INTO bot_cards (user_id, chat_id, message_id, lang, photos, plan, data, stage, created_at, updated_at) VALUES (?, 'e2e', 77, 'uk', ?, NULL, ?, 'new', ?, ?)", [uid, JSON.stringify([pid]), JSON.stringify({ v: 1, k: 'rd', l: 'uk', s: 'new', n: 1, r: [] }), now, now]);
  const cid = sql('SELECT MAX(id) id FROM bot_cards')[0].id;
  await p.goto(U + '?inbox=1&card=' + cid + '#home'); await p.evaluate(r => { window.__FAKE = r; }, fake(V));
  let c = null; for (let i = 0; i < 40; i++) { c = sql('SELECT * FROM bot_cards WHERE id = ?', [cid])[0]; if (c.stage !== 'new') break; await p.waitForTimeout(500); }
  const d = JSON.parse(c.data), plan = JSON.parse(c.plan || '[]'), q = (d.r || [])[0] || {};
  ok('застосунок віддав картці: «готово», 14,445 Гкал → ХТМ, «Відправити» доступне', c.stage === 'ready' && q.v === '14,445 Гкал' && q.w === 'ХТМ' && q.a === 1, d);
  ok('план для робота ХТМ: рахунок, дата дд.мм.рррр, енергія, телефон', plan[0] && plan[0].svc === 'htm' && plan[0].in.vals.date === '16.11.2026' && plan[0].in.vals.energy === '14.445' && !!plan[0].in.rid, plan);
  let s = await st(), rd = (s.readings || []).slice(-1)[0] || {};
  ok('запис тепла «перевірено», у черзі ще нічого (чекає «Відправити» в картці)', rd.status === 'checked' && String(rd.htm.energy) === '14.445' && rd.card === cid && !rd.cab && !sql("SELECT id FROM cab_jobs WHERE user_id = ? AND prov = 'htm'", [uid]).length, rd);
  ok('застосунок — на головній', /#home$/.test(p.url()), p.url());
  let r = php('query', cid, uid, 'send');
  ok('«Відправити» в картці → «в черзі», задача ХТМ одразу (з карткою)', r.data && r.data.s === 'sent' && r.data.r[0].s === 'q' && sql("SELECT status FROM cab_jobs WHERE user_id = ? AND prov = 'htm'", [uid])[0].status === 'queued', r);
  r = php('cron');
  const j = sql("SELECT status, payload FROM cab_jobs WHERE user_id = ? AND prov = 'htm'", [uid])[0];
  c = sql('SELECT * FROM bot_cards WHERE id = ?', [cid])[0]; const d2 = JSON.parse(c.data);
  ok('cron: робот вніс на стенд, картку оновлено в тій самій картці (editMessageWidgetData), окремих повідомлень нема', ['pending', 'ok'].includes(j.status) && ['sd', 'ok'].includes(d2.r[0].s) && r.tg.includes('editMessageWidgetData') && !r.tg.includes('sendMessage'), [j.status, d2, r]);
  await p.goto(U + '#home'); await p.reload(); await p.waitForTimeout(3500);
  s = await st(); rd = (s.readings || []).find(x => x.id === plan[0].in.rid) || {};
  ok('застосунок пов\'язав запис із задачею з картки: «передано»', ['handed', 'accepted'].includes(rd.status) && rd.cab && rd.cab.job > 0, [rd.status, rd.cab]);
  ok('без помилок', !errs.length, errs);
  await b.close(); console.log(`\ne2e_cardsend: ${pass} ok, ${fail} fail`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
