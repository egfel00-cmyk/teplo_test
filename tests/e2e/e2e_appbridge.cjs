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
  ok('без помилок JS', !A.errs.length && !C.errs.length && !W.errs.length && !N.errs.length && !F.errs.length, A.errs.concat(C.errs, W.errs, N.errs, F.errs));
  await b.close();
  console.log(`\n${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})();
