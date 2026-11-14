// 145-а: картка фото в чаті для свого постачальника (Харків, але воду платять ОСББ): фото водоміра → застосунок з-під картки
// (?inbox=1&card=ID, справжнє розпізнавання) → картка без «Відправити» й без плану роботів, «куди» — ОСББ, «До сплати … грн — реквізити
// й призначення в застосунку»; запис води збережено. Потрібні: сайт 127.0.0.1:8013 (config.php: sqlite dev.sqlite);
// картинка: node tests/ocr-lab/water.cjs (→ tests/ocr-lab/out/w_cold.jpg, 137 м³).      node tests/e2e/e2e_cardown.cjs
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const { execFileSync } = require('child_process'); const path = require('path'); const fs = require('fs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', M = 'http://127.0.0.1:8096', SD = process.env.SITE_DATA || '/tmp/teplo_data', DB = SD + '/dev.sqlite';
const IMG = process.argv[2] || path.join(__dirname, '../ocr-lab/out/w_cold.jpg');
const sql = (q, args) => JSON.parse(execFileSync('php', ['-r', '$p = new PDO("sqlite:" . $argv[1]); $s = $p->prepare($argv[2]); $s->execute(json_decode($argv[3], true)); echo json_encode($s->fetchAll(PDO::FETCH_ASSOC));', DB, q, JSON.stringify(args || [])]).toString() || '[]');
const env = Object.assign({}, process.env, { SITE_DATA: SD });
const php = (...a) => JSON.parse(execFileSync('php', [path.join(__dirname, 'card_php.php'), ...a.map(String)], { env }).toString());
(async () => {
  sql('DELETE FROM rate_limits');
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(500);
  ok('реєстрація', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'co' + Date.now() + '@teplo.test') === 200);
  const uid = await p.evaluate(() => window.TeploSync.account.id);
  const s = demo({ today: '2026-11-12' });
  // Харків, але воду платять ОСББ — свій постачальник: ні Водоканалу, ні «Відправити» в картці
  s.places[0].prov = { water: { own: 1, name: 'ОСББ «Сад»', how: 'iban', iban: 'UA213223130000026007233566001', recip: 'ОСББ «Сад»', num: '12', due: 'none', supply: 30, at: '2026-11-12' } };
  s.water = [{ id: 'wb', place: 'main', date: '2026-10-12', base: true, vals: { h1: '170', c1: '130' }, createdAt: '2026-10-12T10:00:00Z', updatedAt: 1, sent: {} }];
  s.updatedAt = Date.now();
  await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), s); await p.reload(); await p.waitForTimeout(1500);
  const img = fs.readFileSync(IMG).toString('base64');
  const pid = await p.evaluate(async b64 => {
    const c = (document.cookie.match(/ts_csrf=([^;]*)/) || [])[1]; const bin = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
    return (await (await fetch('/api/recognize/upload', { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-CSRF': c }, body: new Blob([bin], { type: 'image/jpeg' }) })).json()).id;
  }, img);
  sql('INSERT INTO bot_inbox (photo_id, user_id, taken_at, created_at) VALUES (?, ?, ?, ?)', [pid, uid, Math.floor(Date.now() / 1000) - 60, new Date().toISOString()]);
  const now = new Date().toISOString();
  sql("INSERT INTO bot_cards (user_id, chat_id, message_id, lang, photos, plan, data, stage, created_at, updated_at) VALUES (?, 'e2e', 81, 'uk', ?, NULL, ?, 'new', ?, ?)", [uid, JSON.stringify([pid]), JSON.stringify({ v: 1, k: 'rd', l: 'uk', s: 'new', n: 1, r: [] }), now, now]);
  const cid = sql('SELECT MAX(id) id FROM bot_cards')[0].id;
  await p.goto(U + '?inbox=1&card=' + cid + '#home');
  let c = null; for (let i = 0; i < 240; i++) { c = sql('SELECT * FROM bot_cards WHERE id = ?', [cid])[0]; if (c.stage !== 'new') break; await p.waitForTimeout(500); }
  const d = JSON.parse(c.data), plan = JSON.parse(c.plan || '[]'), q = (d.r || [])[0] || {};
  ok('картка: 137 м³ → «ОСББ «Сад»», не Водоканал; «Відправити» немає', /137/.test(q.v) && q.w === 'ОСББ «Сад»' && !q.a && !(d.r || []).some(x => x.a), [c.stage, d]);
  ok('пояснення: «До сплати … грн — реквізити й призначення в застосунку»', /^До сплати [\d\s ,]+ грн — реквізити/.test(q.m || ''), q.m);
  ok('плану для роботів немає', plan.length === 1 && plan[0] === null, plan);
  const w = ((await st()).water || []).find(x => x.card === cid) || {};
  ok('запис води збережено з карткою', w.vals && /^137/.test(w.vals.c1), w);
  ok('без помилок', !errs.length, errs);
  await b.close(); console.log(`\ne2e_cardown: ${pass} ok, ${fail} fail`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
