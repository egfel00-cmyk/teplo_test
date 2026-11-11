// «Рахунки з monobank» (114-а, власник 11.11): перед передачею — поле рахунку й «Заповнити з monobank»; токен → client-info → виписка (api.monobank.ua
// підмінено page.route, синтетика) → платежі за комуналку → «Вписати вибране»: рахунки тепла, Водоканалу (+ прізвище власника картки), світла,
// Газмереж і Нафтогазу. Токен і виписка не йдуть на наш сервер і не лягають у localStorage. Помилки: не токен, 403.
// Локальный сервер 127.0.0.1:8013. Запуск: cd tests/e2e && node e2e_mono.cjs
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, i) => { console.log((c ? '  OK  ' : ' FAIL ') + n + (!c && i !== undefined ? '  → ' + JSON.stringify(i) : '')); c ? pass++ : fail++; };
const TOK = 'uMonoSyntheticToken_0123456789abcdefABCDEF-xyz', BAD = 'uRevokedSyntheticToken_0123456789abcdefABCDEF';
(async () => {
  const b = await chromium.launch(); const ctx = await require('./pvopen.cjs').ctx(b, { viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:8013' }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')));
  const hash = () => p.evaluate(() => location.hash);
  // «Куди передати» на сторінці виду згорнуте (wacc) — у тестах розгортаємо
  const go = async (r) => { await p.goto('http://127.0.0.1:8013/#' + r); await p.waitForTimeout(400); await p.evaluate(() => document.querySelectorAll('details.wacc').forEach(d => { d.open = true; })); };
  const click = async (sel, w) => { await p.click(sel); await p.waitForTimeout(w || 300); };
  // наш сервер: усе, що пішло, — без токена
  const ours = []; p.on('request', r => { if (r.url().startsWith('http://127.0.0.1:8013/')) ours.push(r.url() + ' ' + (r.postData() || '')); });
  // monobank: client-info і виписка (платежі — лише в останньому вікні, щоб не множились)
  const now = Math.floor(Date.now() / 1000), calls = [];
  const it = (d, desc, comment, amt, name, edr, mcc) => ({ id: 'x' + d, time: now - d * 86400, description: desc, comment, mcc: mcc || 4900, originalMcc: mcc || 4900, amount: -amt, operationAmount: -amt, currencyCode: 980, counterName: name, counterEdrpou: edr, counterIban: 'UA' + edr });
  const items = [it(3, 'КП «Харківські теплові мережі»', 'о/р 1234567', 41250, 'КП «Харківські теплові мережі»', '31557119'),
    it(4, 'КП «Харківводоканал»', 'Особовий рахунок 7654321', 15600, 'КП «Харківводоканал»', '03361715', 4829),
    it(5, 'ТОВ «Харківенергозбут»', 'о/р 123456789012', 61800, 'ТОВ «Харківенергозбут»', '42206328'),
    it(6, 'АТ «Газмережі»', 'о/р 1320012345', 9000, 'АТ «Газмережі»', '03359500'),
    it(40, 'ТОВ «Нафтогаз України»', 'рахунок 987654321', 23900, 'ТОВ «Газопостачальна компанія «Нафтогаз України»', '40121452'),
    it(8, 'Вивіз ТПВ', 'о/р 700123', 7041, 'КП «Комплекс з вивозу побутових відходів»', '03358222'),   // 115-а: вивіз сміття — рахунок і оплата в історію
    { id: 'cafe', time: now - 2 * 86400, description: 'Кав’ярня', mcc: 5814, amount: -6000, currencyCode: 980 }];
  await ctx.route('https://api.monobank.ua/**', async (route) => {
    const r = route.request(), tok = r.headers()['x-token'], u = r.url(); calls.push(u.replace('https://api.monobank.ua', ''));
    const j = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
    if (tok !== TOK) return j(403, { errorDescription: "Unknown 'X-Token'" });
    if (/client-info/.test(u)) return j(200, { clientId: 'c', name: 'Шевченко Тарас', permissions: 'psfj', accounts: [{ id: 'acc1', type: 'black', currencyCode: 980 }, { id: 'usd', type: 'black', currencyCode: 840 }], jars: [] });
    const m = u.match(/statement\/([^/]+)\/(\d+)\/(\d+)/); return j(200, m ? items.filter(x => x.time >= +m[2] && x.time <= +m[3]) : []);
  });
  // квартира без рахунків: тепло, вода, світло, газ — і по показанню, яке ще не передано
  const s0 = demo({ elec: 1, gas: true, gasAcc: false }); s0.places[0].water.account = ''; s0.places[0].water.surname = ''; s0.places[0].meters.forEach(m => { m.account = ''; });
  await p.goto('http://127.0.0.1:8013/'); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), s0); await p.reload(); await p.waitForTimeout(400);

  await go('elec');
  ok('світло: «Куди передати» — поле рахунку й «Заповнити з monobank»', !!(await p.$('[data-key=elec-acc-ask] #esa-e1')) && !!(await p.$('[data-key=mono-open-elec]')));
  await go('gas');
  ok('газ: поля Газмереж і Нафтогазу, «Заповнити з monobank»', !!(await p.$('[data-key=gas-acc-ask] #esg-g1')) && !!(await p.$('[data-key=gas-acc-ask] #esa-g1')) && !!(await p.$('[data-key=mono-open-gas]')));
  await click('[data-key=mono-open-gas]', 400);
  // 117-а: дві дії — «Відкрити monobank» (поточна) і «Вставити ключ»; без слова «токен», приватність — рядком і «Докладніше»
  const stepCls = () => p.$$eval('[data-key=mono-intro] > li', ls => ls.map(l => l.className));
  ok('#mono: 2 кроки, «Відкрити monobank» → api.monobank.ua — основна, ключ — password, про приватність', (await hash()) === '#mono' && (await p.getAttribute('[data-key=mono-api]', 'href')) === 'https://api.monobank.ua/'
    && /Відкрити monobank/.test(await p.textContent('[data-key=mono-api]')) && !/\bsec\b/.test(await p.getAttribute('[data-key=mono-api]', 'class')) && JSON.stringify(await stepCls()) === '["now",""]'
    && (await p.getAttribute('#mono-tok', 'type')) === 'password' && /не потрапляють на наш сервер/.test(await p.textContent('[data-key=mono-priv]'))
    && !/[Тт]окен/.test(await p.innerText('body')) && !(await p.$('[data-key=mono-go]')),
    { cls: await p.getAttribute('[data-key=mono-api]', 'class'), steps: await stepCls(), tok: (await p.innerText('body')).match(/.{0,40}[Тт]окен.{0,40}/) });
  const [pop] = await Promise.all([ctx.waitForEvent('page'), p.click('[data-key=mono-api]')]); await pop.close(); await p.waitForTimeout(500);
  calls.length = 0;   // вкладка monobank — не наш запит до API
  ok('після «Відкрити monobank» основна — «Вставити ключ»', JSON.stringify(await stepCls()) === '["done","now"]' && !/\bsec\b/.test(await p.getAttribute('[data-key=mono-paste]', 'class')), await stepCls());
  await p.fill('#mono-tok', 'abc'); await p.press('#mono-tok', 'Enter'); await p.waitForTimeout(300);
  ok('не ключ (Enter) — підказка, запитів у monobank немає', /не схоже на ключ/.test(await p.textContent('[data-key=mono-err]')) && calls.length === 0);
  await p.evaluate(() => navigator.clipboard.writeText('Шевченко Тарас')); await click('[data-key=mono-paste]', 400);
  ok('«Вставити ключ», а в буфері не ключ — «У скопійованому немає ключа»', /немає ключа monobank/.test(await p.textContent('[data-key=mono-err]')) && calls.length === 0);
  await p.fill('#mono-tok', BAD); await p.waitForTimeout(800);
  ok('вставили відкликаний ключ — пошук сам (без кнопки), 403 — «monobank не прийняв ключ»', /не прийняв ключ/.test(await p.textContent('[data-key=mono-err]')) && calls.length === 1, calls);
  await p.evaluate(() => { window.TeploMono.GAP = 600; });   // у житті — 61 с між запитами виписки
  await p.evaluate(t => navigator.clipboard.writeText('Токен: ' + t + '\n'), TOK); await click('[data-key=mono-paste]', 100);
  await p.waitForSelector('[data-key=mono-list]', { timeout: 15000 });
  const st0 = calls.filter(c => /statement\//.test(c)).length, rows0 = await p.$$eval('.mono-g', es => es.length), bg0 = !!(await p.$('[data-key=mono-bg]'));
  ok('«Вставити ключ» з «Токен: …» у буфері: список — після першого вікна (1 запит виписки), фоном читаємо далі', st0 === 1 && rows0 === 5 && bg0, { st0, rows0, bg0, calls });
  await p.waitForSelector('[data-key=mono-bg]', { state: 'detached', timeout: 15000 });
  const st1 = calls.filter(c => /statement\/acc1\//.test(c)).length;
  ok('client-info + 3 вікна виписки лише гривневої картки', calls.filter(c => /client-info/.test(c)).length === 2 && st1 === 3 && !calls.some(c => /statement\/usd/.test(c)), calls);
  const rows = await p.$$eval('.mono-g', es => es.map(e => ({ t: e.textContent, on: !!e.querySelector('input[data-mf=on]:checked'), dis: !!e.querySelector('input[data-mf=on][disabled]') })));
  ok('фоном додався Нафтогаз (40 днів тому): 6 постачальників (кав’ярні немає), усі позначені', rows.length === 6 && rows.every(r => r.on) && !rows.some(r => /Кав/.test(r.t)), rows.map(r => r.t.slice(0, 60)));
  ok('рядок тепла: рахунок 1234567, «Впишемо: особовий рахунок за тепло», платіж 412,50', /1234567/.test(rows[0].t) && /особовий рахунок за тепло/.test(rows[0].t) && /412,50/.test(rows[0].t));
  ok('газ: 10 цифр з 1… — «рахунок Газмереж», 9 цифр — «рахунок постачальника газу»', rows.some(r => /1320012345/.test(r.t) && /Газмереж \(доставка/.test(r.t)) && rows.some(r => /987654321/.test(r.t) && /постачальника газу/.test(r.t)));
  ok('прізвище для Водоканалу — «Шевченко» з monobank', /Шевченко/.test(await p.textContent('[data-key=mono-sn]')) && await p.isChecked('#mono-sn'));
  // зняли галочку з Нафтогазу — його не впишемо
  const nafI = rows.findIndex(r => /987654321/.test(r.t)); await click('#mono-' + nafI);
  await click('[data-key=mono-apply]', 500);
  const s = await st(), pl = s.places[0], e1 = pl.meters.find(m => m.id === 'e1'), g1 = pl.meters.find(m => m.id === 'g1');
  ok('вписано: тепло, Водоканал + прізвище, світло, Газмережі; Нафтогаз — ні (зняли)', (pl.meter || {}).account === '1234567' && pl.water.account === '7654321' && pl.water.surname === 'Шевченко'
    && e1.account === '123456789012' && g1.grm === '1320012345' && !g1.account, { meter: pl.meter, water: pl.water, e1, g1 });
  const ws = pl.waste || {};
  ok('вивіз сміття: увімкнено, вивізник, рахунок 700123, оплата 70,41 «з monobank» за минулий місяць', ws.on === true && /Комплекс/.test(ws.org || '') && ws.account === '700123' && (ws.pays || []).length === 1 && ws.pays[0].amount === 70.41 && ws.pays[0].src === 'mono' && /^\d{4}-\d{2}$/.test(ws.pays[0].ym), ws);
  ok('назад — на газ, тост «Вписано: 5»', (await hash()) === '#gas' && /Вписано: 5/.test(await p.textContent('#toast-host')));
  ok('газ: поле Газмереж зникло, рахунок Газмереж — для копіювання; Нафтогазу — ще просимо', !(await p.$('#esg-g1')) && !!(await p.$('#esa-g1')) && /1320012345/.test(await p.textContent('[data-key=where-gas]')));
  const ls = await p.evaluate(() => JSON.stringify(localStorage));
  ok('токена й виписки немає ні в localStorage, ні в запитах до нашого сервера', !ls.includes(TOK) && !ls.includes('Кав’ярня') && !ours.some(x => x.includes(TOK) || x.includes('monobank')), ours.filter(x => x.includes(TOK)));
  // ще раз: усе вже вписано — галочки не стоять, «уже вписано»
  await go('mono'); await p.evaluate(() => { window.TeploMono.GAP = 600; }); await p.fill('#mono-tok', TOK);
  await p.waitForSelector('[data-key=mono-list]', { timeout: 15000 });
  ok('повторно, перше вікно: нового немає — «Нового… не знайшли», «Вписати» немає, вписане — розгорнуте «Інші оплати (5)»', /Нового, що можна вписати, не знайшли/.test(await p.innerText('body'))
    && !(await p.$('[data-key=mono-apply]')) && /Інші оплати — вписувати нічого \(5\)/.test(await p.textContent('[data-key=mono-more] > summary')) && await p.$eval('[data-key=mono-more]', d => d.open));
  await p.waitForSelector('[data-key=mono-apply]', { timeout: 15000 });
  const rows2 = await p.$$eval('.mono-g', es => es.map(e => ({ t: e.textContent, on: !!e.querySelector('input[data-mf=on]:checked'), more: !!e.closest('[data-key=mono-more]') })));
  ok('повторно: вписане — «уже вписано» у згорнутому, не позначено; фоном — Нафтогаз позначено, на виду', rows2.filter(r => /уже вписано/.test(r.t) && r.more).length === 5 && rows2.filter(r => r.on).length === 1 && rows2.find(r => r.on && !r.more && /987654321/.test(r.t)), rows2.map(r => [r.on, r.more, r.t.slice(0, 50)]));
  // 116-а (власник 11.11): «Заповнити з monobank» — і в «Налаштуваннях показань» кожного лічильника; «Закрити» — назад до лічильника
  const setLink = async (r, key) => { await go(r); await p.evaluate(() => document.querySelectorAll('details.mbox-set').forEach(d => { d.open = true; })); return p.$$('[data-key=' + key + ']'); };
  const sl = { heat: (await setLink('heat', 'mono-open-heat-set')).length, cold: (await setLink('water-cold', 'mono-open-cold-set')).length, hot: (await setLink('water-hot', 'mono-open-hot-set')).length,
    elec: (await setLink('elec', 'mono-open-elec-set')).length, gas: (await setLink('gas', 'mono-open-gas-set')).length };
  ok('«Налаштування показань»: «Заповнити з monobank» у тепла, холодної, гарячої, світла й газу', Object.values(sl).every(n => n === 1), sl);
  await setLink('heat', 'mono-open-heat-set'); await click('[data-key=mono-open-heat-set]', 400);
  const atMono = (await hash()) === '#mono'; await click('[data-key=wiz-close]', 400);
  ok('з налаштувань тепла → #mono → «Закрити» → знову тепло', atMono && (await hash()) === '#heat', await hash());
  // рос. мова — за мовою браузера
  const pr =await (await require('./pvopen.cjs').ctx(b, { viewport: { width: 360, height: 800 }, locale: 'ru-RU' })).newPage();
  await pr.goto('http://127.0.0.1:8013/'); await pr.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(Object.assign(s, { lang: 'ru' }))), s0); await pr.reload(); await pr.goto('http://127.0.0.1:8013/#mono'); await pr.waitForTimeout(400);
  ok('ru: «Счета из monobank», «Открыть monobank», «Вставить ключ»', /Счета из monobank/.test(await pr.textContent('h1')) && /Открыть monobank/.test(await pr.textContent('[data-key=mono-api]')) && /Вставить ключ/.test(await pr.textContent('[data-key=mono-paste]')));
  ok('без JS-помилок', errs.length === 0, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
