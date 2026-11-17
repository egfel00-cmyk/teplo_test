// 169-а (власник 17.11: «товариш тестив одразу після оплати комуналки — так нічого й не знайшлось»; журнал: 5 платежів, у жодного немає рахунку).
// Платежі без рахунку у виписці — у списку «знайшли» з полем «Особовий рахунок з квитанції»: вписали — галочка сама, «Вписати» — у лічильник/квартиру.
// Рахунок, розбитий пробілами («о/р 12 345 678»), — знаходимо. Форма платежів без рахунку (без назв і цифр) — подією mono_g.
// Локальный сервер 127.0.0.1:8013. Запуск: cd tests/e2e && node e2e_mononeed.cjs
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, i) => { console.log((c ? '  OK  ' : ' FAIL ') + n + (!c && i !== undefined ? '  → ' + JSON.stringify(i) : '')); c ? pass++ : fail++; };
const TOK = 'uMonoSyntheticToken_0123456789abcdefABCDEF-xyz';
(async () => {
  const b = await chromium.launch(); const ctx = await require('./pvopen.cjs').ctx(b, { viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));   // журнал у тестах вимкнено (webdriver) — тут перевіряємо подію
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')));
  const ours = []; p.on('request', r => { if (r.url().startsWith('http://127.0.0.1:8013/')) ours.push(r.url() + ' ' + (r.postData() || '')); });
  const now = Math.floor(Date.now() / 1000);
  const it = (d, desc, comment, amt, name, edr, mcc, iban) => ({ id: 'x' + d, time: now - d * 86400, description: desc, comment, mcc: mcc || 4900, originalMcc: mcc || 4900, amount: -amt, operationAmount: -amt,
    currencyCode: 980, counterName: name, counterEdrpou: edr, counterIban: iban, hold: d < 2 });
  const items = [
    it(1, 'ТОВ «Харківенергозбут»', undefined, 61800, 'ТОВ «Харківенергозбут»', '42206328'),                       // щойно оплатив: hold, рахунку немає
    it(2, 'КП «Харківводоканал»', 'Шевченко Т.', 15600, 'КП «Харківводоканал»', '03361715', 4829, 'UA213223130000026007233566001'),   // лише прізвище
    it(3, 'КП «Харківські теплові мережі»', 'о/р 12 345 678', 41250, 'КП «Харківські теплові мережі»', '31557119')];  // рахунок з пробілами
  await ctx.route('https://api.monobank.ua/**', async (route) => {
    const u = route.request().url();
    const j = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
    if (route.request().headers()['x-token'] !== TOK) return j(403, { errorDescription: "Unknown 'X-Token'" });
    if (/client-info/.test(u)) return j(200, { clientId: 'c', name: 'Шевченко Тарас', accounts: [{ id: 'acc1', type: 'black', currencyCode: 980 }], jars: [] });
    const m = u.match(/statement\/([^/]+)\/(\d+)\/(\d+)/); return j(200, m ? items.filter(x => x.time >= +m[2] && x.time <= +m[3]) : []);
  });
  const s0 = demo({ elec: 1 }); s0.places[0].water.account = ''; s0.places[0].water.surname = ''; s0.places[0].meters.forEach(m => { m.account = ''; }); if (s0.places[0].meter) s0.places[0].meter.account = '';
  if (s0.meter) s0.meter.account = '';
  await p.goto('http://127.0.0.1:8013/'); await p.evaluate(s => { localStorage.setItem('teplo.v1', JSON.stringify(s)); localStorage.setItem('teplo.cc', JSON.stringify({ v: 1, a: 1, at: new Date().toISOString() })); }, s0); await p.reload(); await p.waitForTimeout(400);   // аналітику дозволено — події йдуть на сервер
  await p.goto('http://127.0.0.1:8013/#mono'); await p.waitForSelector('#mono-tok', { timeout: 15000 });
  await p.evaluate(() => { window.TeploMono.GAP = 300; });
  await p.fill('#mono-tok', TOK);
  await p.waitForSelector('[data-key=mono-list]', { timeout: 15000 });
  await p.waitForSelector('[data-key=mono-prog]', { state: 'detached', timeout: 20000 });
  const rows = await p.$$eval('.mono-g', es => es.map(e => ({ t: e.textContent, on: !!e.querySelector('input[data-mf=on]:checked'), dis: !!e.querySelector('input[data-mf=on][disabled]'),
    acc: !!e.querySelector('input[data-mf=acc]'), more: !!e.closest('[data-key=mono-more]') })));
  ok('3 платежі — усі у «знайшли» (не «Нового не знайшли»), кнопка «Вписати» є', rows.length === 3 && rows.every(r => !r.more) && !!(await p.$('[data-key=mono-apply]'))
    && !/Нового, що можна вписати, не знайшли/.test(await p.innerText('body')), rows.map(r => r.t.slice(0, 70)));
  const re = rows.findIndex(r => /Харківенергозбут/.test(r.t)), rw = rows.findIndex(r => /Водоканал/.test(r.t)), rh = rows.findIndex(r => /теплов/.test(r.t));
  ok('світло без рахунку: «monobank не передав номер… впишіть з квитанції», поле є, галочка не стоїть', re >= 0 && /не передав номер рахунку/.test(rows[re].t) && rows[re].acc && !rows[re].on && !rows[re].dis, rows[re]);
  ok('вода — лише прізвище в призначенні: теж поле рахунку', rw >= 0 && rows[rw].acc && !rows[rw].on, rows[rw]);
  ok('тепло: «о/р 12 345 678» — рахунок 12345678, позначено, поля немає', rh >= 0 && /Рахунок 12345678/.test(rows[rh].t) && rows[rh].on && !rows[rh].acc, rows[rh]);
  await p.click('#mono-' + rw); await p.waitForTimeout(300);   // скрин власника 18:50: галочку ставили без рахунку
  ok('галочка без рахунку не ставиться — фокус у полі рахунку, підказка', !(await p.isChecked('#mono-' + rw)) && await p.evaluate(i => document.activeElement && document.activeElement.getAttribute('data-key') === 'mono-acc-' + i, rw)
    && /Спершу впишіть особовий рахунок/.test(await p.textContent('#toast-host')) && !(await p.$('[data-key=mono-sn]')));
  const gap = await p.$eval('.mono-g', e => { const b = e.querySelector('.check-row b').getBoundingClientRect(), t = e.querySelector('.mono-to').getBoundingClientRect(); return Math.round(t.top - b.bottom); });
  ok('під назвою немає пустого рядка (≤ 8 px до тексту)', gap <= 8, gap);
  await p.fill('[data-key=mono-acc-' + re + ']', '0123456789'); await p.waitForTimeout(200);
  ok('вписали рахунок світла — галочка сама, фокус у полі', await p.isChecked('#mono-' + re) && await p.evaluate(i => document.activeElement && document.activeElement.getAttribute('data-key') === 'mono-acc-' + i, re));
  await p.click('[data-key=mono-apply]'); await p.waitForTimeout(600);
  const s = await st(), pl = s.places[0], e1 = (pl.meters || []).find(m => m.kind === 'elec') || {}, hm = s.meter || pl.meter || {};
  ok('«Вписати»: світло — з квитанції 0123456789, тепло — 12345678; вода порожня (рахунку не вписали)', e1.account === '0123456789' && hm.account === '12345678' && !pl.water.account, { e1, hm: hm.account, w: pl.water });
  await p.waitForTimeout(1500); await p.evaluate(() => { try { window.dispatchEvent(new Event('pagehide')); } catch (e) { /* */ } }); await p.waitForTimeout(800);
  const ev = (ours.filter(x => /mono_g/.test(x)).join(' ').match(/"n":"mono_g"[^}]*\}\}?/) || [''])[0];
  ok('подія mono_g: вид, MCC, поля, довжини цифр — без назв і цифр рахунку', /elec:4900:neh:d:m/.test(ev) && /water:4829:nie?c/.test(ev) && !/Харківенергозбут|Шевченко|0123456789/.test(ev), ev);
  ok('без JS-помилок', errs.length === 0, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
