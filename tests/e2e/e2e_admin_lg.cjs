// /admin → пользователь: свет и газ — отдельными таблицами (владелец 17.11: «почему объединены»), порядок свет, вода, газ, тепло.
// Нужен сайт 127.0.0.1:8013 и в config.php: 'admins' => ['emails' => ['pvadmin@example.ua']] (как e2e_provadmin).
const { chromium } = require('playwright'); const U = 'http://127.0.0.1:8013/';
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
(async () => {
  const b = await chromium.launch();
  const mk = async () => { const ctx = await require('./pvopen.cjs').ctx(b, { viewport: { width: 1280, height: 900 }, locale: 'ru-RU' }); const p = await ctx.newPage(); await p.goto(U);
    p.api = (m, path, body) => p.evaluate(async ([m, path, body]) => { const c = (document.cookie.match(/ts_csrf=([^;]+)/) || [])[1] || ''; const r = await fetch('/api' + path, { method: m, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF': c }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => null) }; }, [m, path, body]); return p; };
  const u = await mk(); await u.api('GET', '/config');
  let r = await u.api('POST', '/auth/register', { email: 'lg17@example.ua', password: 'lg-test-pass-17' }); if (r.s !== 200) r = await u.api('POST', '/auth/login', { email: 'lg17@example.ua', password: 'lg-test-pass-17' });
  const me = await u.api('GET', '/state'); const ver = (me.j && (me.j.version || 0)) || 0;
  const state = { readings: [], water: [], onboarded: true, places: [{ id: 'main', name: '91', meters: [{ id: 'e1', kind: 'elec', zones: 1 }, { id: 'g1', kind: 'gas' }] }],
    mrecs: [{ id: 'r1', place: 'main', meter: 'e1', kind: 'elec', date: '2026-11-17', z: { all: '8039' }, own: true }, { id: 'r2', place: 'main', meter: 'g1', kind: 'gas', date: '2026-11-16', z: { all: '1225.4' } }, { id: 'r3', place: 'main', meter: 'e1', kind: 'elec', date: '2026-10-17', z: { all: '7900' } }] };
  r = await u.api('PUT', '/state', { state, baseVersion: ver }); ok('state сохранён', r.s === 200, r);
  const a = await mk(); await a.api('GET', '/config');
  r = await a.api('POST', '/auth/register', { email: 'pvadmin@example.ua', password: 'pv-admin-test-1' }); if (r.s !== 200) r = await a.api('POST', '/auth/login', { email: 'pvadmin@example.ua', password: 'pv-admin-test-1' });
  const us = await a.api('GET', '/admin/users?q=lg17'); const id = us.j.users[0].id;
  await a.goto(U + 'admin#user-' + id); await a.waitForTimeout(1200);
  const hs = await a.$$eval('main h2', x => x.map(e => e.textContent.trim()));
  ok('нет «Свет и газ»', !hs.some(h => /Свет и газ/.test(h)), hs);
  const iE = hs.findIndex(h => /^Свет — показания \(2\)/.test(h)), iW = hs.findIndex(h => /^Вода — показания/.test(h)), iG = hs.findIndex(h => /^Газ — показания \(1\)/.test(h)), iH = hs.findIndex(h => /^Тепло — показания/.test(h));
  ok('свет (2), вода, газ (1), тепло — по порядку', iE >= 0 && iE < iW && iW < iG && iG < iH, hs);
  const gt = await a.evaluate(() => { const h = [...document.querySelectorAll('main h2')].find(e => /^Газ/.test(e.textContent)); return h.parentElement.textContent; });
  ok('в таблице газа — м³ и нет кВт·ч', /1225\.4 м³/.test(gt) && !/кВт/.test(gt), gt.slice(0, 200));
  await b.close(); console.log(`\nadmin_lg: ${pass} ok, ${fail} fail`); process.exit(fail ? 1 : 0);
})();
