// 154-а: міст сайту із застосунком iPhone (apps/ios): WKWebView з UA «PeredaiApp/» і window.webkit.messageHandlers.peredai.
// Перевіряє: вкладка для маршруту, екран вводу (bare), строки для нагадувань / Live Activity, копія стану, вібровідгук,
// нижні вкладки сайту сховані, TeploHost.restore (новий телефон — копія з iCloud; є дані — злиття).
// cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_appbridge.cjs
const { chromium } = require('playwright');
const demo = require('./demo.cjs');
let pass = 0, fail = 0;
const ok = (name, c, extra) => { if (c) pass++; else fail++; console.log((c ? 'ok   ' : 'FAIL ') + name + (extra !== undefined && !c ? '  ' + JSON.stringify(extra).slice(0, 500) : '')); };
const B = 'http://127.0.0.1:8013/';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 PeredaiApp/1.0';
(async () => {
  const b = await chromium.launch();
  const mk = async (ua) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 800 }, locale: 'uk-UA', userAgent: ua });
    await ctx.addInitScript(() => { window.__msgs = []; window.webkit = { messageHandlers: { peredai: { postMessage: m => window.__msgs.push(JSON.parse(JSON.stringify(m))) } } }; });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); return { ctx, p, errs };
  };
  const seed = async (p, st, route) => {
    await p.goto(B);
    await p.evaluate(s => { localStorage.clear(); if (s) localStorage.setItem('teplo.v1', JSON.stringify(s)); localStorage.setItem('teplo.cc', JSON.stringify({ v: 1, a: 0, at: new Date().toISOString(), id: 'x' })); }, st);
    await p.goto('about:blank'); await p.goto(B + '#' + route); await p.waitForTimeout(1500);
  };
  const msgs = (p, t) => p.evaluate(t => window.__msgs.filter(m => m.t === t), t);

  // 1. Застосунок, демо-квартира з водою, світлом і газом (сьогодні 02.11)
  const A = await mk(UA);
  await seed(A.p, demo({ elec: true, gas: true, second: true }), 'home');
  ok('in-app: клас на <html>', await A.p.evaluate(() => document.documentElement.classList.contains('in-app')));
  ok('in-app: нижні вкладки сайту сховані', await A.p.$eval('.nav', e => getComputedStyle(e).display === 'none').catch(() => true));
  let r = await msgs(A.p, 'route');
  ok('route: home → вкладка home, не екран вводу', r.length && r[r.length - 1].tab === 'home' && r[r.length - 1].bare === false && r[r.length - 1].on === true, r);
  await A.p.waitForTimeout(900);
  let sc = await msgs(A.p, 'sched'); const s1 = sc[sc.length - 1] || {};
  ok('sched: строки з видами й датами (світло до 03.11, газ до 05.11, вода до 20.11)', s1.items && s1.items.filter(x => !x.done).every(x => /^\d{4}-\d\d-\d\d$/.test(x.due) && x.k && x.pn && x.kt) &&
    ['elec:2026-11-03', 'gas:2026-11-05', 'cold:2026-11-20'].every(k => s1.items.some(x => x.p === 'main' && x.k + ':' + x.due === k)), s1.items);
  ok('sched: «Мамина» — вода вже передана (done), щоб застосунок прибрав нагадування', s1.items.some(x => x.p === 'p2' && x.k === 'cold' && x.done && x.pn === 'Мамина'), s1.items.filter(x => x.p === 'p2'));
  ok('sched: тексти з сайту (uk), DUE_SOON = 4, сьогодні — демо-дата', s1.txt && s1.txt.title === 'Час передати показання' && /\{k\}/.test(s1.txt.body) && s1.soon === 4 && s1.today === '2026-11-02', s1);
  ok('sched: маршрут виду для кнопки (вода — water-cold/hot)', s1.items.every(x => x.k === 'hot' || x.k === 'cold' ? x.go === 'water-' + x.k : x.go === x.k), s1.items.map(x => x.go));
  const n1 = sc.length;
  await A.p.goto(B + '#history'); await A.p.waitForTimeout(1200);
  r = await msgs(A.p, 'route');
  ok('route: історія → вкладка history', r[r.length - 1].tab === 'history' && r[r.length - 1].r === 'history', r[r.length - 1]);
  ok('sched: без змін — повторно не шлеться', (await msgs(A.p, 'sched')).length === n1);
  await A.p.goto(B + '#prefs'); await A.p.waitForTimeout(600);
  r = await msgs(A.p, 'route'); ok('route: налаштування → prefs', r[r.length - 1].tab === 'prefs', r[r.length - 1]);
  await A.p.goto(B + '#enew'); await A.p.waitForTimeout(800);
  r = await msgs(A.p, 'route'); ok('route: внесення світла — екран вводу (bare), вкладку не міняти', r[r.length - 1].bare === true && r[r.length - 1].tab === '', r[r.length - 1]);
  // збереження → копія стану (state) і вібровідгук на тост
  await A.p.evaluate(() => { window.__msgs.length = 0; });
  await A.p.goto(B + '#prefs'); await A.p.waitForTimeout(500);
  await A.p.evaluate(() => window.TeploHost.go('stats')); await A.p.waitForTimeout(600);
  ok('TeploHost.go: маршрут з застосунку', await A.p.evaluate(() => location.hash) === '#stats');
  await A.p.evaluate(() => { const st = JSON.parse(localStorage.getItem('teplo.v1')); return st; });
  // змінимо стан через save-шлях: тема в налаштуваннях — будь-який persist()
  await A.p.evaluate(() => { localStorage.setItem('teplo.v1', localStorage.getItem('teplo.v1')); });
  await A.p.evaluate(() => window.TeploHost.sched()); await A.p.waitForTimeout(300);
  ok('TeploHost.sched(): шле строки повторно', (await msgs(A.p, 'sched')).length >= 1);

  // 2. Новий телефон: порожній застосунок → restore(копія з iCloud) → квартири й показання на місці, копія state — назад у застосунок
  const C = await mk(UA);
  await seed(C.p, null, 'start');
  const backup = JSON.stringify(demo({ elec: true }));
  const res = await C.p.evaluate(js => window.TeploHost.restore(js), backup); await C.p.waitForTimeout(1800);
  const st = await C.p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1') || 'null'));
  ok('restore: порожній — «restored», квартира й записи світла з копії', res === 'restored' && st && st.onboarded && st.places.some(x => x.id === 'main') && (st.mrecs || []).length === 4, { res, n: st && (st.mrecs || []).length });
  ok('restore: після нього — копія state у застосунок', (await msgs(C.p, 'state')).some(m => m.s && m.s.indexOf('"mrecs"') > 0));
  // є свої дані + копія з іншого пристрою з ще одним записом → злиття, нічого не втрачено
  const other = demo({ elec: true }); other.mrecs.push({ id: 'mX', place: 'main', meter: 'e1', kind: 'elec', date: '2026-11-01', z: { day: '10430', night: '5230' }, base: false, sent: {}, createdAt: '2026-11-01T10:00:00Z', updatedAt: Date.now() });
  const res2 = await C.p.evaluate(js => window.TeploHost.restore(js), JSON.stringify(other)); await C.p.waitForTimeout(800);
  const st2 = await C.p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')));
  ok('restore: є дані — «merged», новий запис з іншого пристрою додано', res2 === 'merged' && st2.mrecs.some(x => x.id === 'mX') && st2.mrecs.length === 5, { res2, n: st2.mrecs.length });
  ok('restore: сміття — «bad»/«err», стан цілий', ['bad', 'err'].includes(await C.p.evaluate(() => window.TeploHost.restore('null'))) && (await C.p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')).mrecs.length)) === 5);
  ok('вібровідгук: тост шле haptic', (await msgs(C.p, 'haptic')).length >= 1);

  // 3. Звичайний браузер (Safari) з тим самим webkit-обʼєктом, але без UA застосунку — моста немає, вкладки сайту на місці
  const W = await mk('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
  await seed(W.p, demo({ elec: true }), 'home');
  ok('браузер: без in-app, вкладки видно, повідомлень немає', !(await W.p.evaluate(() => document.documentElement.classList.contains('in-app'))) &&
    await W.p.$eval('.nav', e => getComputedStyle(e).display !== 'none') && (await W.p.evaluate(() => window.__msgs.length)) === 0);
  // 155-а (розбір навігації iOS): назва екрана й «Назад» — рідною панеллю; логотип сайту й «Відгук» у застосунку сховані; перший запуск — без лендингу
  const N = await mk(UA);
  await seed(N.p, demo({ elec: true }), 'home');
  ok('in-app: шапки сайту (логотип) і плаваючого «Відгук» не видно', await N.p.evaluate(() => [...document.querySelectorAll('header.top, .fab')].every(e => getComputedStyle(e).display === 'none')));
  let rt = await msgs(N.p, 'route'), lr = rt[rt.length - 1];
  ok('route home: корінь вкладки — без назви й без «Назад»', lr.r === 'home' && lr.title === '' && lr.up === '', lr);
  await N.p.goto(B + '#elec'); await N.p.waitForTimeout(900); rt = await msgs(N.p, 'route'); lr = rt[rt.length - 1];
  ok('route elec: назва — h1 сторінки, «Назад» → home', lr.r === 'elec' && lr.title && lr.title === (await N.p.textContent('#main h1')).replace(/\s+/g, ' ').trim() && lr.up === 'home' && lr.back === 'Назад', lr);
  await N.p.evaluate(() => window.TeploHost.back()); await N.p.waitForTimeout(700);
  ok('TeploHost.back() зі світла → головна', (await N.p.evaluate(() => location.hash)) === '#home');
  await N.p.goto(B + '#enew'); await N.p.waitForTimeout(900); rt = await msgs(N.p, 'route'); lr = rt[rt.length - 1];
  ok('route enew (екран вводу): bare, «Скасувати», куди — closeTo', lr.bare === true && lr.cancel === 'Скасувати' && !!lr.up && lr.up !== '<', lr);
  await N.p.goto(B + '#prefs'); await N.p.waitForTimeout(700); rt = await msgs(N.p, 'route'); lr = rt[rt.length - 1];
  ok('корінь «Налаштувань»: назва на панелі, h1 сторінки схований (не дублюється), «Назад» немає', lr.r === 'prefs' && lr.up === '' && !!lr.title &&
    await N.p.$eval('#main h1', e => getComputedStyle(e).display === 'none'), lr);
  await N.p.evaluate(() => window.TeploHost.feedback()); await N.p.waitForTimeout(400);
  ok('TeploHost.feedback() відкриває вікно відгуку', !!(await N.p.$('[data-key=feedback-dialog]')));
  const F = await mk(UA);
  await seed(F.p, null, ''); await F.p.waitForTimeout(400); rt = await msgs(F.p, 'route'); lr = rt[rt.length - 1] || {};
  ok('перший запуск у застосунку: одразу «Які лічильники є?», «Вже маю акаунт» замість «Назад», без «Скасувати»', (await F.p.evaluate(() => location.hash)) !== '#welcome' &&
    !!(await F.p.$('.aw-kinds')) && /Вже маю акаунт/.test(await F.p.textContent('[data-key=aw-login]')) && lr.up === '', [await F.p.evaluate(() => location.hash), lr]);
  await F.p.click('[data-key=aw-login]'); await F.p.waitForTimeout(500);
  ok('«Вже маю акаунт» → вхід', (await F.p.evaluate(() => location.hash)) === '#login');
  // 156-а (крок 3 плану навігації iOS): застосунок v3 — ввід показань листом, квартира в заголовку, запис історії — без зміни вкладки
  const mk3 = async () => { const x = await mk(UA); await x.ctx.addInitScript(() => { window.PeredaiNative = { v: 3, sheet: 1, pmenu: 1 }; }); return x; };
  const V3 = await mk3(); const last = async (p) => { const a = await msgs(p, 'route'); return a[a.length - 1] || {}; };
  await seed(V3.p, demo({ elec: true, gas: true, second: true, garage: 'own1' }), 'home');
  ok('v3: клас app-v3; головна — не лист, без меню квартир', await V3.p.evaluate(() => document.documentElement.classList.contains('app-v3')) && (await last(V3.p)).sheet === false && !(await last(V3.p)).pl.length, await last(V3.p));
  await V3.p.goto(B + '#elec'); await V3.p.waitForTimeout(900); lr = await last(V3.p);
  ok('v3 світло: меню квартир зі світлом (основна ✓, «Гараж»; «Мамина» без світла — ні), назва квартири під заголовком, тексти меню',
    lr.pl.length === 2 && lr.pl.some(x => x.id === 'main' && x.on) && lr.pl.some(x => x.id === 'gar' && !x.on) && !lr.pl.some(x => x.id === 'p2') && !!lr.sub && lr.pm.all === 'Усі квартири' && lr.pm.add === 'Додати квартиру', lr);
  ok('v3 світло: плашки квартири на сторінці немає (вона в заголовку)', await V3.p.$$eval('.place-bar', a => a.every(e => getComputedStyle(e).display === 'none')));
  await V3.p.evaluate(() => window.TeploHost.place('gar')); await V3.p.waitForTimeout(700); lr = await last(V3.p);
  ok('v3 TeploHost.place: «Гараж» — та сама сторінка світла, квартира в заголовку змінилась', (await V3.p.evaluate(() => location.hash)) === '#elec' && lr.r === 'elec' && lr.pl.some(x => x.id === 'gar' && x.on), lr);
  await V3.p.evaluate(() => window.TeploHost.place('main')); await V3.p.waitForTimeout(500);
  await V3.p.goto(B + '#water-cold'); await V3.p.waitForTimeout(800); lr = await last(V3.p);
  ok('v3 холодна вода: у меню обидві квартири з холодною', lr.pl.length === 2 && lr.pl.some(x => x.id === 'p2'), lr);
  await V3.p.evaluate(() => window.TeploHost.place('p2')); await V3.p.waitForTimeout(600);
  ok('v3: «Мамина» — та сама сторінка води', (await V3.p.evaluate(() => location.hash)) === '#water-cold' && (await last(V3.p)).pl.some(x => x.id === 'p2' && x.on));
  await V3.p.evaluate(() => window.TeploHost.place('main')); await V3.p.waitForTimeout(500);
  // ввід світла — лист: «Скасувати» зліва, «Зберегти» справа (копія на сторінці схована, Enter працює), «Скасувати й вийти» схована
  await V3.p.goto(B + '#elec'); await V3.p.waitForTimeout(500); await V3.p.goto(B + '#enew'); await V3.p.waitForTimeout(900); lr = await last(V3.p);
  ok('v3 enew: лист, зліва «Скасувати», справа головна кнопка сторінки, не «брудний»', lr.sheet === true && lr.title === 'Світло' && lr.lb === 'cancel' && lr.rbk === 'act' && lr.rb === 'Зберегти' && lr.dirty === false && lr.tab === '', lr);
  ok('v3 enew: клас in-sheet; копія головної кнопки й «Скасувати й вийти» сховані, плашка квартири — теж',
    await V3.p.evaluate(() => { const h = document.documentElement.classList.contains('in-sheet'), w = document.querySelector('.wiz-actions.app-mirror'), c = document.querySelector('.wiz-cancel');
      return h && w && w.getBoundingClientRect().width <= 1 && (!c || getComputedStyle(c).display === 'none') && [...document.querySelectorAll('.place-bar')].every(e => getComputedStyle(e).display === 'none'); }));
  await V3.p.evaluate(() => { window.__msgs.length = 0; });
  const inp = await V3.p.$('#main input[inputmode], #main input[type=text], #main input[type=number]');
  if (inp) await inp.type('1'); await V3.p.waitForTimeout(300);
  ok('v3 enew: людина друкує — «dirty» застосунку (свайп униз уже питає)', (await msgs(V3.p, 'dirty')).some(m => m.on === true));
  let asked = 0; V3.p.once('dialog', d => { asked++; d.dismiss(); });
  await V3.p.evaluate(() => window.TeploHost.cancel()); await V3.p.waitForTimeout(500);
  ok('v3 «Скасувати» з цифрами: питання (світло — не «води»); «ні» — лишаємось у листі', asked === 1 && (await V3.p.evaluate(() => location.hash)) === '#enew');
  let qtext = ''; V3.p.once('dialog', d => { qtext = d.message(); d.accept(); });
  await V3.p.evaluate(() => window.TeploHost.cancel()); await V3.p.waitForTimeout(700); lr = await last(V3.p);
  ok('v3 «Скасувати» → «так»: лист закрито (маршрут не лист)', !/води/.test(qtext) && /показань/.test(qtext) && lr.sheet === false && (await V3.p.evaluate(() => location.hash)) !== '#enew', [qtext, lr]);
  await V3.p.goto(B + '#enew'); await V3.p.waitForTimeout(700);
  await V3.p.evaluate(() => window.TeploHost.cancel()); await V3.p.waitForTimeout(600);
  ok('v3 «Скасувати» без цифр — без питання, назад', (await V3.p.evaluate(() => location.hash)) !== '#enew' && (await last(V3.p)).sheet === false);
  // майстер тепла: крок 1 — «Скасувати» і «Далі»; крок 2 — «‹» (TeploHost.back → крок назад)
  await V3.p.goto(B + '#step-0'); await V3.p.waitForTimeout(800); lr = await last(V3.p);
  ok('v3 тепло крок 1: лист, «Скасувати», справа «Далі»', lr.sheet === true && lr.lb === 'cancel' && lr.rb === 'Далі', lr);
  await V3.p.evaluate(() => window.TeploHost.act()); await V3.p.waitForTimeout(800); lr = await last(V3.p);
  ok('v3 TeploHost.act() → крок 2; зліва «‹» (крок назад), up = ^', (await V3.p.evaluate(() => location.hash)) === '#step-1' && lr.sheet === true && lr.lb === 'back' && lr.up === '^', lr);
  await V3.p.evaluate(() => window.TeploHost.back()); await V3.p.waitForTimeout(700);
  ok('v3 TeploHost.back() на кроці 2 → крок 1, лист той самий', (await V3.p.evaluate(() => location.hash)) === '#step-0' && (await last(V3.p)).sheet === true);
  // запис історії — у тій вкладці, де натиснули (раніше перекидало в «Історію»)
  await V3.p.goto(B + '#erec-m20261101'); await V3.p.waitForTimeout(700); lr = await last(V3.p);
  ok('v3 запис історії: вкладку не міняти (tab = \'\'), «‹» — звідки прийшли', lr.tab === '' && lr.up === '<', lr);
  // 157-а (крок 4 плану навігації iOS): v4 — налаштування списком, «+» на панелі, меню видів (> 4), контекстне меню й свайп рядка історії
  const ctx4 = await b.newContext({ viewport: { width: 390, height: 800 }, locale: 'uk-UA', userAgent: UA, hasTouch: true, isMobile: true });
  await ctx4.addInitScript(() => { window.__msgs = []; window.webkit = { messageHandlers: { peredai: { postMessage: m => window.__msgs.push(JSON.parse(JSON.stringify(m))) } } }; window.PeredaiNative = { v: 4 }; });
  const P4 = await ctx4.newPage(); const e4 = []; P4.on('pageerror', e => e4.push(e.message));
  await seed(P4, demo({ elec: true, gas: true, second: true, garage: 'own1' }), 'prefs'); lr = await last(P4);
  ok('v4 налаштування: клас app-v4, розділи з рядками «›» замість розкривашок', await P4.evaluate(() => document.documentElement.classList.contains('app-v4')) &&
    (await P4.$$('.ios-row')).length >= 8 && !(await P4.$('details.pgroup')) && lr.r === 'prefs' && lr.up === '', lr);
  // 164-а (власник 13:25): «Квартири» — лише рядки квартир, під назвою — її лічильники одним рядком
  const pl = await P4.$$eval('[data-key=pgs-places] .ps-head', es => es.map(e => e.textContent));
  const kk0 = await P4.$eval('[data-key^=ps-kk-]', e => e.getAttribute('aria-label')).catch(() => '');
  ok('v4 «Квартири»: рядок на кожну квартиру, лічильники — значками (180-я), текст — для читалки', pl.length === 3 && /Світло/.test(kk0) && /Газ/.test(kk0) && !(await P4.$('.ps-m')), [pl, kk0]);
  await P4.click('[data-key=pgr-look]'); await P4.waitForTimeout(700); lr = await last(P4);
  ok('v4 рядок «Вигляд» → екран групи: #prefs-look, назва — h1 групи, «‹» → prefs, вкладка prefs', (await P4.evaluate(() => location.hash)) === '#prefs-look' &&
    lr.r === 'prefs-look' && lr.tab === 'prefs' && lr.up === 'prefs' && lr.title === (await P4.textContent('#main h1')).trim() && !!(await P4.$('.pg-one [data-key=prefs-theme]')), lr);
  await P4.evaluate(() => window.TeploHost.back()); await P4.waitForTimeout(600);
  ok('v4 TeploHost.back() з групи → список налаштувань', (await P4.evaluate(() => location.hash)) === '#prefs' && !!(await P4.$('.ios-groups')));
  await P4.evaluate(() => { const a = document.createElement('a'); a.href = '#prefs'; a.setAttribute('data-act', 'to-water'); a.id = 'tw'; a.textContent = 'x'; document.getElementById('main').appendChild(a); });
  await P4.click('#tw'); await P4.waitForTimeout(700);
  ok('v4 «до поля в налаштуваннях» (to-water) → налаштування водоміра на екрані квартири', (await P4.evaluate(() => location.hash)) === '#place-main' && await P4.$eval('#mbs-h1', e => e.open), await P4.evaluate(() => location.hash));
  await P4.goto(B + '#prefs'); await P4.waitForTimeout(600); await P4.click('[data-key=pl-open-main]'); await P4.waitForTimeout(800); lr = await last(P4);
  ok('v4 рядок квартири → екран квартири, «‹» — назад (у «Налаштування»), вкладка не змінюється', (await P4.evaluate(() => location.hash)) === '#place-main' && lr.up === '<' && lr.tab === '', lr);
  await P4.goto(B + '#elec'); await P4.waitForTimeout(900); lr = await last(P4);
  ok('v4 світло: «+» на панелі (підпис — кнопки сторінки), сама кнопка на сторінці схована', !!lr.add && /Внести/.test(lr.add) &&
    await P4.$eval('#main .app-add', e => getComputedStyle(e).display === 'none' && getComputedStyle(e.closest('.hg-act')).display === 'none'), lr);
  await P4.evaluate(() => window.TeploHost.add()); await P4.waitForTimeout(800);
  ok('v4 TeploHost.add() → внесення світла (лист)', (await P4.evaluate(() => location.hash)) === '#enew' && (await last(P4)).sheet === true);
  await P4.goto(B + '#history'); await P4.waitForTimeout(900); lr = await last(P4);
  ok('v4 історія: 5 видів — меню на панелі (поточний ✓), сегменти на сторінці сховані', lr.km.length === 5 && lr.km.filter(x => x.on).length === 1 && lr.km[0].k === 'elec' && lr.kml &&
    await P4.$eval('.kind-sw', e => getComputedStyle(e).display === 'none'), lr.km);
  await P4.evaluate(() => window.TeploHost.view('gas')); await P4.waitForTimeout(700); lr = await last(P4);
  ok('v4 TeploHost.view(gas) → історія газу, у меню ✓ на «Газ»', lr.km.some(x => x.k === 'gas' && x.on) && !!(await P4.$('a.hrow[href^="#erec-n"]')), lr.km);
  await P4.evaluate(() => window.TeploHost.view('elec')); await P4.waitForTimeout(600);
  const menu = JSON.parse(await P4.evaluate(() => window.TeploHost.rowMenu('https://peredai.com.ua/#erec-m20261031')) || 'null');
  ok('v4 rowMenu: дата рядка й статуси чипа (поточний «не передано» ✓)', menu && menu.title && menu.items.map(x => x.id).join() === 'st:sent,st:not,st:own' && menu.items.find(x => x.id === 'st:not').on === true, menu);
  ok('v4 rowMenu: рядок без статусу (немає такого) — порожньо', (await P4.evaluate(() => window.TeploHost.rowMenu('#erec-nope'))) === '');
  await P4.evaluate(() => window.TeploHost.rowAct('#erec-m20261031', 'st:sent')); await P4.waitForTimeout(700);
  ok('v4 rowAct → статус запису «передано», чип оновився', await P4.$eval('[data-key="st-m20261031"]', e => e.getAttribute('data-cur') === 'sent'));
  // свайп ліворуч по рядку (CDP-дотики): до половини — кнопка лишається; повний — статус одразу
  const cdp = await ctx4.newCDPSession(P4);
  const swipe = async (sel, dx) => { const bx = await (await P4.$(sel)).boundingBox(); const y = bx.y + 20, x0 = bx.x + bx.width - 40;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
    for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - dx * i / 8, y }] }); await P4.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await P4.waitForTimeout(400); };
  await swipe('[data-key="erec-m20261031"], li:has(> a[href="#erec-m20261031"])', 90);
  ok('v4 свайп 90 px: рядок відкрито, кнопка «Не передано» (бо вже передано)', await P4.evaluate(() => { const li = document.querySelector('a[href="#erec-m20261031"]').closest('li'), b = li.querySelector('.hsw-act');
    return li.classList.contains('hsw-on') && b && b.getAttribute('data-v') === 'not' && b.getBoundingClientRect().width > 80; }));
  await P4.tap('a[href="#erec-m20261031"] .hr-sub').catch(() => {}); await P4.waitForTimeout(400);
  ok('v4 дотик до відкритого рядка — закрити кнопку, не переходити в запис', (await P4.evaluate(() => location.hash)) === '#history' && await P4.evaluate(() => !document.querySelector('.hsw-act')));
  await swipe('li:has(> a[href="#erec-m20261031"])', 300); await P4.waitForTimeout(500);
  ok('v4 повний свайп → «не передано» одразу', await P4.$eval('[data-key="st-m20261031"]', e => e.getAttribute('data-cur') === 'not'));
  await P4.goto(B + '#stats'); await P4.waitForTimeout(800); lr = await last(P4);
  ok('v4 статистика: те саме меню видів', lr.km.length === 5, lr);
  // браузер (164-а): налаштування — той самий список; старий #prefs-heat — налаштування теплолічильника на екрані квартири
  await W.p.goto(B + '#prefs'); await W.p.waitForTimeout(700);
  ok('браузер #prefs: список рядків, без розкривашок', (await W.p.$$('.ios-row')).length >= 8 && !(await W.p.$('details.pgroup')));
  await W.p.click('[data-key=pl-open-main]'); await W.p.waitForTimeout(800);
  ok('браузер: квартира з «Налаштувань» — «← Налаштування», підсвічена вкладка «Налаштування»', (await W.p.getAttribute('[data-key=pv-back]', 'href')) === '#prefs' &&
    !!(await W.p.$('nav [data-key=nav-prefs][aria-current=page]')), await W.p.getAttribute('[data-key=pv-back]', 'href'));
  await W.p.click('[data-key=pv-back]'); await W.p.waitForTimeout(600);
  ok('браузер: «Назад» з квартири → «Налаштування»', (await W.p.evaluate(() => location.hash)) === '#prefs');
  await W.p.goto(B + '#home'); await W.p.waitForTimeout(600); await W.p.goto(B + '#place-main'); await W.p.waitForTimeout(800);
  ok('браузер: квартира з головної — «Назад» на «Квартири»', /^#(home|places)$/.test(await W.p.getAttribute('[data-key=pv-back]', 'href')) && !!(await W.p.$('nav [data-key=nav-home][aria-current=page]')));
  await W.p.goto(B + '#prefs-heat'); await W.p.waitForTimeout(900);
  ok('браузер #prefs-heat → #place-…, «Лічильники» й налаштування тепла розгорнуті', /^#place-/.test(await W.p.evaluate(() => location.hash)) && await W.p.$eval('#pg-pv-meters', e => e.open) && await W.p.$eval('#mbs-heat', e => e.open));
  // Dynamic Type: множник від застосунку — сторінка вужча й масштабована (meta viewport), 1 — як було
  const vp0 = await P4.$eval('meta[name=viewport]', m => m.content);
  await P4.evaluate(() => window.TeploHost.textZoom(1.2));
  const vp1 = await P4.$eval('meta[name=viewport]', m => m.content);
  await P4.evaluate(() => window.TeploHost.textZoom(1));
  ok('v4 textZoom(1.2): width = 390 ÷ 1,2, initial-scale 1.2; textZoom(1) — початковий', vp1 === 'width=325, initial-scale=1.2, viewport-fit=cover' && (await P4.$eval('meta[name=viewport]', m => m.content)) === vp0, [vp0, vp1]);
  ok('v4 без помилок JS', !e4.length, e4);
  // стара збірка застосунку (без PeredaiNative) — як у 155-й: листа немає
  await N.p.goto(B + '#enew'); await N.p.waitForTimeout(700); rt = await msgs(N.p, 'route'); lr = rt[rt.length - 1];
  ok('стара збірка: enew — без листа (sheet немає), без in-sheet', lr.sheet === undefined && !(await N.p.evaluate(() => document.documentElement.classList.contains('in-sheet'))), lr);
  // 186-я (iOS етап 2): токен пушів від застосунку — без входу чекає (і переживає перезавантаження), після входу — на сервер; вихід — токени геть
  const PU = await mk(UA); await seed(PU.p, demo({}), 'home');
  const puReq = []; PU.p.on('request', q => { if (/\/api\/push\//.test(q.url())) puReq.push([q.url().replace(/^.*\/api/, ''), q.postData()]); });
  await PU.p.evaluate(() => { window.TeploHost.pushToken('AB'.repeat(32), 'apns', 'sandbox'); window.TeploHost.pushToken('cd'.repeat(40), 'las', 'prod'); window.TeploHost.pushToken('zz', 'apns', 'prod'); });
  await PU.p.waitForTimeout(400);
  ok('push: без входу на сервер нічого; збережено в teplo.push (hex у нижньому регістрі), поганий токен відкинуто', !puReq.length && await PU.p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.push') || '{}'); return s.apns.tok === 'ab'.repeat(32) && s.apns.env === 'sandbox' && s.las.env === 'prod'; }), puReq);
  const pem = `push${Date.now()}@example.ua`;
  await PU.p.evaluate(async e => { const t = (document.cookie.match(/ts_csrf=([^;]*)/) || [])[1]; if (!t) await fetch('api/config'); const c = (document.cookie.match(/ts_csrf=([^;]*)/) || [])[1];
    await fetch('api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF': c || '' }, body: JSON.stringify({ email: e, password: 'Boss-12345678' }) }); }, pem);
  await PU.p.reload(); await PU.p.waitForTimeout(2500);
  const sent = puReq.filter(x => x[0] === '/push/token').map(x => JSON.parse(x[1] || '{}'));
  ok('push: після входу (і перезавантаження) обидва токени — на сервер', sent.length === 2 && sent.some(x => x.kind === 'apns' && x.token === 'ab'.repeat(32) && x.env === 'sandbox') && sent.some(x => x.kind === 'las' && x.env === 'prod'), sent);
  const hp = await PU.p.evaluate(async () => (await (await fetch('api/health')).json()).push);
  ok('push: /api/health → push — ключа немає (ready false), токени пораховано', hp && hp.ready === false && (hp.tokens['apns sandbox'] || {}).n >= 1 && (hp.tokens['las prod'] || {}).n >= 1, hp);
  await PU.p.evaluate(() => window.TeploSync.logout()); await PU.p.waitForTimeout(500);
  ok('push: вихід — спершу /push/off', puReq.some(x => x[0] === '/push/off'), puReq.map(x => x[0]));
  ok('без помилок JS', !A.errs.length && !C.errs.length && !W.errs.length && !N.errs.length && !F.errs.length && !V3.errs.length && !PU.errs.length, A.errs.concat(C.errs, W.errs, N.errs, F.errs, V3.errs, PU.errs));
  await b.close();
  console.log(`\n${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})();
