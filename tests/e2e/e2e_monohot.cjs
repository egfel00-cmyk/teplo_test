// 176-я: monobank і вода по виду — Київ (холодна — Київводоканал, гаряча — Київтеплоенерго, рахунки різні). Платіж «гаряче водопостачання» → рахунок гарячої,
// водоканал → холодної; не вгадали (вода, а постачальник незрозумілий) — питаємо «холодна чи гаряча», галочки немає. Потім «Куди передати» гарячої — Київтеплоенерго з рахунком.
// Локальний сервер 127.0.0.1:8013. Запуск: cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_monohot.cjs
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, i) => { console.log((c ? '  OK  ' : ' FAIL ') + n + (!c && i !== undefined ? '  → ' + JSON.stringify(i).slice(0, 400) : '')); c ? pass++ : fail++; };
const TOK = 'uMonoSyntheticToken_0123456789abcdefABCDEF-xyz';
(async () => {
  const b = await chromium.launch(); const ctx = await require('./pvopen.cjs').ctx(b, { viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')));
  const now = Math.floor(Date.now() / 1000);
  const it = (d, desc, amt, name, edr) => ({ id: 'x' + d, time: now - d * 86400, description: desc, mcc: 4900, originalMcc: 4900, amount: -amt, operationAmount: -amt, currencyCode: 980, counterName: name, counterEdrpou: edr, hold: false });
  const items = [
    it(3, 'Оплата за воду, о/р 1234567', 31200, 'ПрАТ «АК «Київводоканал»', '03327664'),
    it(4, 'Гаряче водопостачання, о/р 7654321', 52000, 'КП «Київтеплоенерго»', '40538421'),
    it(5, 'Вода, о/р 5550001', 9900, 'ТОВ «Вода Плюс»', '11112222')];
  await ctx.route('https://api.monobank.ua/**', async (route) => {
    const u = route.request().url();
    const j = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
    if (route.request().headers()['x-token'] !== TOK) return j(403, { errorDescription: "Unknown 'X-Token'" });
    if (/client-info/.test(u)) return j(200, { clientId: 'c', name: 'Шевченко Тарас', accounts: [{ id: 'acc1', type: 'black', currencyCode: 980 }], jars: [] });
    const m = u.match(/statement\/([^/]+)\/(\d+)\/(\d+)/); return j(200, m ? items.filter(x => x.time >= +m[2] && x.time <= +m[3]) : []);
  });
  const s0 = demo({ noHeat: true }); const pl0 = s0.places[0];
  pl0.address = 'м. Київ, вул. Хрещатик, 1, кв. 1'; pl0.city = { n: 'Київ', r: 'ky' }; pl0.water.account = ''; delete pl0.water.acc;
  await p.goto('http://127.0.0.1:8013/'); await p.evaluate(s => { localStorage.setItem('teplo.v1', JSON.stringify(s)); localStorage.setItem('teplo.cc', JSON.stringify({ v: 1, a: 1, at: new Date().toISOString() })); }, s0);
  await p.reload(); await p.waitForTimeout(1500);   // довідник Києва — до пошуку
  await p.goto('http://127.0.0.1:8013/#mono'); await p.waitForSelector('#mono-tok', { timeout: 15000 });
  await p.evaluate(() => { window.TeploMono.GAP = 300; });
  await p.fill('#mono-tok', TOK);
  await p.waitForSelector('[data-key=mono-list]', { timeout: 15000 });
  await p.waitForSelector('[data-key=mono-prog]', { state: 'detached', timeout: 20000 });
  const rows = await p.$$eval('.mono-g', es => es.map(e => ({ t: e.textContent, on: !!e.querySelector('input[data-mf=on]:checked'), k: (e.querySelector('select[data-mf=kind]') || {}).value || '', ask: !!e.querySelector('.mono-wq') })));
  const rv = rows.findIndex(r => /Київводоканал/.test(r.t)), rh = rows.findIndex(r => /Київтеплоенерго/.test(r.t)), rq = rows.findIndex(r => /Вода Плюс/.test(r.t));
  ok('водоканал → рахунок холодної (Водоканалу), позначено', rv >= 0 && rows[rv].on && /Водоканалу/.test(rows[rv].t), rows[rv]);
  ok('«гаряче водопостачання» Київтеплоенерго → «рахунок за гарячу воду», позначено', rh >= 0 && rows[rh].on && rows[rh].k === 'hot' && /гарячу воду/.test(rows[rh].t), rows[rh]);
  ok('незрозуміло, холодна чи гаряча, — питаємо, галочки немає', rq >= 0 && rows[rq].ask && !rows[rq].on && /холодну чи гарячу/.test(rows[rq].t), rows[rq]);
  await p.selectOption('#mono-' + rq + '-k', 'hot'); await p.waitForTimeout(300);
  ok('обрали «Гаряча вода» — питання зникло', !(await p.$('[data-key=mono-wq-' + rq + ']')));
  await p.$eval('#mono-' + rq, e => { if (e.checked) e.click(); }); await p.waitForTimeout(200);   // цей не вписуємо
  await p.click('[data-key=mono-apply]'); await p.waitForTimeout(600);
  const s = await st(), w = s.places[0].water;
  ok('«Вписати»: холодна 1234567 (і account), гаряча 7654321 — окремо', w.acc && w.acc.cold === '1234567' && w.account === '1234567' && w.acc.hot === '7654321', w);
  await p.goto('http://127.0.0.1:8013/#water-hot'); await p.reload(); await p.waitForTimeout(1500);
  const main = await p.innerText('main');
  ok('гаряча Києва: «Куди передати» — Київтеплоенерго з рахунком за гарячу 7654321', /Київтеплоенерго/.test(main) && /7654321/.test(await p.textContent('[data-key=wsend-hacc]').catch(() => '')), main.slice(0, 400));
  await p.goto('http://127.0.0.1:8013/#water-cold'); await p.reload(); await p.waitForTimeout(1200);
  const mc = await p.innerText('main');
  ok('холодна Києва: Київводоканал, рахунок 1234567, без Київтеплоенерго', /Київводоканал/.test(mc) && /1234567/.test(await p.textContent('[data-key=wsend-acc]').catch(() => '')) && !/Київтеплоенерго/.test(mc), mc.slice(0, 400));
  ok('без JS-помилок', errs.length === 0, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
