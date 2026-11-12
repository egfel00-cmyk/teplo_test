// Картка фото в чаті + місцевий КП (122-а): квартира в Кам'янці-Подільському (вода — бот mtve), автовідправку підключено →
// фото водоміра з чату → застосунок з-під картки (?inbox=1&card=ID, справжнє розпізнавання) → картка «готово» з планом для бота КП
// (а не Харківводоканалу) → «Відправити» (дотик картки) → черга з карткою → cron бота → стенд отримав холодну → картка «прийнято» →
// застосунок пов'язав свій запис із задачею й позначив переданим.
// Потрібні: сайт 127.0.0.1:8013 (config.php: sqlite dev.sqlite, 'lb_base_mtve' => 'http://127.0.0.1:8096/'), стенд: php -S 127.0.0.1:8096 tests/lb-mock/router.php;
// картинка: node tests/ocr-lab/water.cjs (→ tests/ocr-lab/out/w_cold.jpg, 137 м³, синє кільце).      node tests/e2e/e2e_cardlb.cjs
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const { execFileSync } = require('child_process'); const path = require('path'); const fs = require('fs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', M = 'http://127.0.0.1:8096', SD = process.env.SITE_DATA || '/tmp/teplo_data', DB = SD + '/dev.sqlite';
const IMG = process.argv[2] || path.join(__dirname, '../ocr-lab/out/w_cold.jpg');
const sql = (q, args) => JSON.parse(execFileSync('php', ['-r', '$p = new PDO("sqlite:" . $argv[1]); $s = $p->prepare($argv[2]); $s->execute(json_decode($argv[3], true)); echo json_encode($s->fetchAll(PDO::FETCH_ASSOC));', DB, q, JSON.stringify(args || [])]).toString() || '[]');
const env = Object.assign({}, process.env, { SITE_DATA: SD });
const php = (...a) => JSON.parse(execFileSync('php', [path.join(__dirname, 'card_php.php'), ...a.map(String)], { env }).toString());
(async () => {
  await fetch(M + '/__reset'); sql('DELETE FROM rate_limits');
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(500);
  ok('реєстрація', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'cl' + Date.now() + '@teplo.test') === 200);
  const uid = await p.evaluate(() => window.TeploSync.account.id);
  const s = demo({ today: '2026-11-12' });
  s.places[0].address = 'м. Кам’янець-Подільський, вул. Соборна 1, кв. 2';
  s.places[0].water.meters[0].serial = '7654321'; s.places[0].water.meters[1].serial = '1234567';
  s.water = [{ id: 'wb', place: 'main', date: '2026-10-12', base: true, vals: { h1: '170', c1: '130' }, createdAt: '2026-10-12T10:00:00Z', updatedAt: 1, sent: {} }];
  s.updatedAt = Date.now();
  await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), s); await p.reload(); await p.waitForTimeout(1500);
  const cn = await p.evaluate(() => window.TeploSync.api('POST', '/lb/connect', { bot: 'mtve', place: 'main', acc: '74-108-61', consent: true, lang: 'uk' }).then(j => [j._status, j.conn && j.conn.chk]));
  ok('автовідправку в КП «Міськтепловоденергія» підключено (на стенді — 2 лічильники)', cn[0] === 200 && cn[1] && cn[1].ok, cn);
  const img = fs.readFileSync(IMG).toString('base64');
  const pid = await p.evaluate(async b64 => {
    const c = (document.cookie.match(/ts_csrf=([^;]*)/) || [])[1]; const bin = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
    return (await (await fetch('/api/recognize/upload', { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-CSRF': c }, body: new Blob([bin], { type: 'image/jpeg' }) })).json()).id;
  }, img);
  sql('INSERT INTO bot_inbox (photo_id, user_id, taken_at, created_at) VALUES (?, ?, ?, ?)', [pid, uid, Math.floor(Date.now() / 1000) - 60, new Date().toISOString()]);
  const now = new Date().toISOString();
  sql("INSERT INTO bot_cards (user_id, chat_id, message_id, lang, photos, plan, data, stage, created_at, updated_at) VALUES (?, 'e2e', 79, 'uk', ?, NULL, ?, 'new', ?, ?)", [uid, JSON.stringify([pid]), JSON.stringify({ v: 1, k: 'rd', l: 'uk', s: 'new', n: 1, r: [] }), now, now]);
  const cid = sql('SELECT MAX(id) id FROM bot_cards')[0].id;
  await p.goto(U + '?inbox=1&card=' + cid + '#home');
  let c = null; for (let i = 0; i < 240; i++) { c = sql('SELECT * FROM bot_cards WHERE id = ?', [cid])[0]; if (c.stage !== 'new') break; await p.waitForTimeout(500); }
  const d = JSON.parse(c.data), plan = JSON.parse(c.plan || '[]'), q = (d.r || [])[0] || {};
  ok('картка «готово»: 137 м³ → місцевий КП (не Водоканал Харкова), «Відправити» доступне', c.stage === 'ready' && /137/.test(q.v) && /Міськтепловоденергія/.test(q.w) && q.a === 1, [c.stage, d]);
  ok('план для бота КП: mtve, квартира, лічильник № 1234567 = 137', plan[0] && plan[0].svc === 'lb' && plan[0].in.bot === 'mtve' && plan[0].in.place === 'main'
    && (plan[0].in.items || []).length === 1 && plan[0].in.items[0].serial === '1234567' && plan[0].in.items[0].value === '137', plan);
  let w = ((await st()).water || []).find(x => x.card === cid) || {};
  ok('запис води з карткою, ще не передано', w.vals && /^137/.test(w.vals.c1) && !(w.sent || {}).vk && !w.lbJob, w);
  let r = php('query', cid, uid, 'send');
  const j = sql("SELECT * FROM cab_jobs WHERE user_id = ? AND prov = 'Lmtve' ORDER BY id DESC LIMIT 1", [uid])[0] || {};
  ok('«Відправити» в картці → черга бота КП з карткою, окремих повідомлень нема', r.data && r.data.s === 'sent' && ['q', 'go'].includes(r.data.r[0].s) && JSON.parse(j.payload || '{}').card === cid && !r.tg.includes('sendMessage'), [r, j.status]);
  if (j.status === 'queued' && +j.next_at > Date.now() / 1000 + 60) sql('UPDATE cab_jobs SET next_at = ? WHERE id = ?', [Math.floor(Date.now() / 1000) - 1, j.id]);   // вікно подачі ще не відкрилось — для тесту зараз
  const out = execFileSync('php', [path.join(__dirname, '../lb-mock/cron1.php')], { env }).toString();
  const last = await (await fetch(M + '/__last')).json();
  ok('cron бота: стенд отримав холодну 137 → ind[1] (№ 1234567)', last && last.ind && last.ind['1'] === '137', [out, last]);
  r = php('cron'); c = sql('SELECT * FROM bot_cards WHERE id = ?', [cid])[0]; const d2 = JSON.parse(c.data);
  ok('cron карток: «прийнято» в тій самій картці', r.cards.includes(cid) && d2.r[0].s === 'ok' && r.tg.includes('editMessageWidgetData'), [r, d2]);
  await p.goto(U + '#water-cold'); await p.reload(); await p.waitForTimeout(3500);
  w = ((await st()).water || []).find(x => x.card === cid) || {};
  ok('застосунок пов\'язав запис із задачею з картки: передано', w.lbJob && w.lbJob.job === +j.id && (w.sent || {}).vk, [w.lbJob, w.sent]);
  ok('без помилок', !errs.length, errs);
  await b.close(); console.log(`\ne2e_cardlb: ${pass} ok, ${fail} fail`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
