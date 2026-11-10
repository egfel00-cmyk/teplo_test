// /admin → «Откуда и сколько» (89-я): люди из трёх областей, поставщики, расход и суммы; без e-mail и адресов. Нужен admin boss@teplo.test.
const { chromium } = require('playwright');
const U = 'http://127.0.0.1:8013/';
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const st = (city, street, extra) => Object.assign({ v: 1, onboarded: true, readings: [], places: [{ id: 'p1', name: '', address: (city.c === 'M' ? 'м. ' : 'с. ') + city.n + ', ' + street, city, street,
  meters: [{ id: 'e1', kind: 'elec', zones: 1 }], water: { meters: [{ id: 'c1', kind: 'cold' }] } }],
  water: [{ id: 'w0', place: 'p1', date: '2026-08-01', vals: { c1: '100' }, base: true }, { id: 'w1', place: 'p1', date: '2026-10-30', vals: { c1: '112' } }],
  mrecs: [{ id: 'm0', place: 'p1', meter: 'e1', kind: 'elec', date: '2026-09-30', z: { all: '1000' }, base: true }, { id: 'm1', place: 'p1', meter: 'e1', kind: 'elec', date: '2026-10-31', z: { all: '1180' } }] }, extra || {});
(async () => {
  const b = await chromium.launch();
  const mk = async (email, state) => {
    const c = await b.newContext(); const p = await c.newPage(); await p.goto(U + 'api/config');
    const api = (m, path, body) => p.evaluate(async ([m, path, body]) => { const c = (document.cookie.match(/ts_csrf=([^;]+)/) || [])[1] || ''; const r = await fetch('/api' + path, { method: m, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF': decodeURIComponent(c) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; }, [m, path, body]);
    let r = await api('POST', '/auth/register', { email, password: 'geo-test-pass-1' }); if (r.s !== 200) await api('POST', '/auth/login', { email, password: 'geo-test-pass-1' });
    const cur = await api('GET', '/state'); r = await api('PUT', '/state', { state, baseVersion: (cur.j && cur.j.version) || 0 }); if (r.s === 409) r = await api('PUT', '/state', { state, baseVersion: r.j.version }); await c.close(); return r.s;
  };
  const khk = { n: 'Харків', h: 'UA63120270000028556', r: 'kh', c: 'M' };
  const s1 = await mk('geo1@example.ua', st(khk, 'вул. Сумська, 1'));
  const s2 = await mk('geo2@example.ua', st({ n: 'Львів', h: 'UA46060250000025047', r: 'lv', c: 'M' }, 'вул. Городоцька, 5'));
  const s3 = await mk('geo3@example.ua', st({ n: 'Бровари', h: 'UA32060050000030591', r: 'kv', c: 'M' }, 'вул. Київська, 3', { places: [{ id: 'p1', name: 'Мамина', address: '', meters: [{ id: 'g1', kind: 'gas' }] }],
    mrecs: [{ id: 'g0', place: 'p1', meter: 'g1', kind: 'gas', date: '2026-10-01', z: { all: '10' }, base: true }, { id: 'g2', place: 'p1', meter: 'g1', kind: 'gas', date: '2026-11-01', z: { all: '40' } }], water: [] }));
  ok('три человека сохранены', [s1, s2, s3].every(x => x === 200), [s1, s2, s3]);
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU' }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(U + 'api/config');
  await p.evaluate(async () => { const c = (document.cookie.match(/ts_csrf=([^;]+)/) || [])[1] || ''; const go = (u) => fetch('/api/auth/' + u, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF': decodeURIComponent(c) }, body: JSON.stringify({ email: 'boss@teplo.test', password: 'boss-pass-123' }) });
    const r = await go('register'); if (r.status !== 200) await go('login'); });
  await p.goto(U + 'admin#geo'); await p.waitForTimeout(1200);
  const main = (await p.textContent('main')) || '';
  ok('вкладка открыта: «По областям», «По поставщикам», «По людям»', /По областям/.test(main) && /По поставщикам/.test(main) && /По людям/.test(main), main.slice(0, 200));
  ok('нет e-mail и улиц', !/@example/.test(main) && !/Сумська|Городоцька|Київська, 3|Мамина/.test(main));
  ok('области: Харківська, Львівська; Бровари не попали (у квартиры нет адреса)', /Харківська/.test(main) && /Львівська/.test(main) && /(своя|справочник|общая) 1/.test(main) && !/Бровари/.test(main));
  ok('поставщики: Харківводоканал и Львівводоканал, свет', /Харківводоканал/.test(main) && /Львівводоканал/.test(main) && /свет/.test(main));
  ok('люди: «адрес не указан» и газ 30 м³ за месяц × 7,96', /адрес не указан/.test(main) && /29,4 м³\/мес × 7,96/.test(main), main.match(/газ[^#]{0,160}/));
  await p.screenshot({ path: '/tmp/shots/geo_1280.png', fullPage: true });
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300); await p.screenshot({ path: '/tmp/shots/geo_390.png', fullPage: true });
  ok('без ошибок JS', !errs.length, errs);
  await b.close(); console.log(`\n${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})();
