// Картка фото в чаті (121-а): застосунок відкрито з-під картки (?inbox=1&card=ID) — розпізнає фото з чату й віддає картці цифри.
// cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_card.cjs   (сайт 127.0.0.1:8013, SQLite /tmp/teplo_data/dev.sqlite; кадри — node ../ocr-lab/make.cjs)
// 1) тепло, усі 9 екранів (синтетика читається «не впевнено») → картка «перевірте» з 15,482 Гкал → ХТМ і причиною, застосунок — на результаті;
// 2) лише екран енергії → картка «перевірте» (бракує значень), застосунок лишається на результаті розпізнавання.
const { chromium } = require('playwright'); const { execSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const demo = require('./demo.cjs');
const OUT = path.resolve(__dirname, '../ocr-lab/out'), DB = '/tmp/teplo_data/dev.sqlite';
const sql = (q, a) => JSON.parse(execSync(`php -r '$p=new PDO("sqlite:${DB}"); $s=$p->prepare($argv[1]); $s->execute(json_decode($argv[2], true)); echo json_encode($s->fetchAll(PDO::FETCH_ASSOC));' ${JSON.stringify(q)} '${JSON.stringify(a || [])}'`).toString() || '[]');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
let CTX = null;
async function run(b, shots) {
  // той самий акаунт (cookie), але чистий браузер: незавершене розпізнавання минулого прогону живе в IndexedDB
  const ctx = CTX = CTX ? await b.newContext({ viewport: { width: 390, height: 844 }, storageState: { cookies: await CTX.cookies(), origins: [] } }) : await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); if (process.env.DBG) p.on('console', m => { if (!/ERR_TUNNEL|401/.test(m.text())) console.log('[c]', m.text().slice(0, 300)); });
  await p.goto('http://127.0.0.1:8013/');
  await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo({ today: '2026-11-12' }));
  const imgs = shots.map(f => fs.readFileSync(path.join(OUT, f + '.jpg')).toString('base64'));
  const up = await p.evaluate(async (list) => {
    await fetch('/api/config'); const c = document.cookie.match(/ts_csrf=([^;]*)/)[1];
    if (!(await (await fetch('/api/me')).json()).user) await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF': c }, body: JSON.stringify({ email: 'card' + Date.now() + Math.random() + '@ex.ua', password: 'e2e pass 123' }) });
    const me = await (await fetch('/api/me')).json(), ids = [];
    for (const b64 of list) { const bin = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0)); const r = await fetch('/api/recognize/upload', { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-CSRF': c }, body: new Blob([bin], { type: 'image/jpeg' }) }); ids.push((await r.json()).id); }
    return { uid: me.user.id, ids };
  }, imgs);
  sql('UPDATE bot_inbox SET done = 1 WHERE user_id = ?', [up.uid]);   // фото минулого прогону (лишились на перевірку) — не змішувати
  up.ids.forEach((id, i) => sql('INSERT INTO bot_inbox (photo_id, user_id, taken_at, created_at) VALUES (?, ?, ?, ?)', [id, up.uid, Math.floor(Date.now() / 1000) - 600 + i, new Date().toISOString()]));
  sql("INSERT INTO bot_cards (user_id, chat_id, message_id, lang, photos, plan, data, stage, created_at, updated_at) VALUES (?, 'e2e', NULL, 'uk', ?, NULL, ?, 'new', ?, ?)",
    [up.uid, JSON.stringify(up.ids), JSON.stringify({ v: 1, k: 'rd', l: 'uk', s: 'new', n: up.ids.length, r: [] }), new Date().toISOString(), new Date().toISOString()]);
  const cid = sql('SELECT MAX(id) id FROM bot_cards')[0].id;
  await p.goto('http://127.0.0.1:8013/?inbox=1&card=' + cid + '#home');
  for (let i = 0; i < 420; i++) { if (sql('SELECT stage FROM bot_cards WHERE id = ?', [cid])[0].stage !== 'new') break; await p.waitForTimeout(1000); }
  const c = sql('SELECT * FROM bot_cards WHERE id = ?', [cid])[0];
  return { p, ctx, errs, c: Object.assign(c, { d: JSON.parse(c.data), plan: JSON.parse(c.plan || 'null') }) };
}
(async () => {
  const b = await chromium.launch();
  let r = await run(b, ['s774_energy', 's774_volume', 's774_flow', 's774_power', 's774_ht', 's774_ct', 's774_on', 's774_eh', 's774_err']);
  const q = (r.c.d.r || [])[0] || {};
  // синтетичні екрани S774 рушій читає «не впевнено» (тіні сегментів) — картка чесно просить перевірити, а не відправляє
  ok('тепло, 9 екранів: у картці 15,482 Гкал → ХТМ', q.v === '15,482 Гкал' && q.w === 'ХТМ', r.c.d);
  ok('прочитано не впевнено — «перевірте» з причиною, без «Відправити»; застосунок лишився на результаті', r.c.stage === 'fix' && q.a === 0 && /не впевнено/.test(q.m || '') && /#photo$/.test(r.p.url()), [r.c.stage, q, r.p.url()]);
  ok('без помилок', !r.errs.length, r.errs); await r.p.close();
  r = await run(b, ['s774_energy']);
  const q2 = (r.c.d.r || [])[0] || {};
  ok('лише екран енергії: картка «перевірте» з причиною, застосунок лишився на результаті', r.c.stage === 'fix' && /Не всі значення/.test(q2.m || '') && /#photo$/.test(r.p.url()) && !!(await r.p.$('[data-key="photo-auto-why"]')), [r.c.d, r.p.url()]);
  ok('без помилок', !r.errs.length, r.errs); await r.p.close();
  await b.close();
  console.log(`\ne2e_card: ${pass} ok, ${fail} fail`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
