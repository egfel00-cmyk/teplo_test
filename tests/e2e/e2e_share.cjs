// 150-а (план конкурентів п. 6, ніша MÖRK — оренда): «Надіслати власнику» — з екрана квартири → готове повідомлення з останніми показаннями
// всіх лічильників (світло, вода, газ, тепло — у цьому порядку), «набігло» з останнього «оплачено/передано» і суми; «Разом»; без сум — без грн;
// «Скопіювати» кладе той самий текст; «Надіслати…» — меню телефона (navigator.share), без нього — копіює.
// cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_share.cjs   (сайт 127.0.0.1:8013)
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 500) : '')); } };
const U = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: U });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const load = async (s, route) => {
    await p.goto(U); await p.evaluate(x => { localStorage.clear(); localStorage.setItem('teplo.v1', JSON.stringify(x)); localStorage.setItem('teplo.cc', JSON.stringify({ v: 1, a: 0, at: new Date().toISOString(), id: 'x' }));
      Storage.prototype.setItem = Storage.prototype.removeItem = Storage.prototype.clear = function () {}; }, s);
    await p.goto('about:blank'); await p.goto(U + '#' + route); await p.waitForTimeout(1500);
  };
  // 1. основна квартира: тепло + гаряча/холодна вода + світло
  const s = demo({ today: '2026-11-14', elec: 1 }); s.places[0].name = 'Победа'; s.places[0].v = 2;
  await load(s, 'place-main');
  ok('екран квартири: «Надіслати власнику» — «Скласти повідомлення»', !!(await p.$('[data-key=pv-share] [data-key=pv-share-go]')));
  await p.click('[data-key=pv-share-go]'); await p.waitForTimeout(800);
  const txt = await p.$eval('[data-key=sh-preview] .sh-bubble', e => e.textContent).catch(() => '');
  const L = txt.split('\n');
  ok('#share: шапка «Показання лічильників — Победа»', /^Показання лічильників — Победа/.test(L[0]), L[0]);
  const iE = L.findIndex(x => /^Світло/.test(x)), iW = L.findIndex(x => /^Вода/.test(x)), iH = L.findIndex(x => /^Опалення/.test(x));
  ok('порядок: світло → вода → опалення', iE > 0 && iW > iE && iH > iW, L);
  ok('світло: дата, показання, «+… кВт·год з …», «≈ … грн»', /^Світло \(\d\d\.\d\d\): \d+ кВт·год — \+\d+ кВт·год з \d\d\.\d\d, ≈ [\d\s ]+,\d\d грн$/.test(L[iE]), L[iE]);
  ok('вода: гаряча й холодна одним рядком, м³', /Гаряча \d+, Холодна \d+ м³/.test(L[iW]), L[iW]);
  ok('«Разом ≈ … грн» останнім рядком', /^Разом ≈ [\d\s ]+,\d\d грн$/.test(L[L.length - 1]), L[L.length - 1]);
  if (process.env.SHOT) await p.screenshot({ path: '/tmp/share.png', fullPage: true });
  await p.click('[data-key=sh-copy]'); await p.waitForTimeout(300);
  ok('«Скопіювати» — той самий текст', (await p.evaluate(() => navigator.clipboard.readText())) === txt);
  await p.uncheck('[data-key=sh-sum]'); await p.waitForTimeout(500);
  const t2 = await p.$eval('[data-key=sh-preview] .sh-bubble', e => e.textContent);
  ok('без сум — ні «грн», ні «Разом»; «набігло» лишається', !/грн/.test(t2) && !/Разом/.test(t2) && /\+\d+ кВт·год/.test(t2), t2);
  // «Надіслати…»: є navigator.share — віддаємо текст у меню телефона
  await p.evaluate(() => { window.__sh = null; navigator.share = d => { window.__sh = d; return Promise.resolve(); }; });
  await p.click('[data-key=sh-send]'); await p.waitForTimeout(300);
  ok('«Надіслати…» — navigator.share з тим самим текстом', (await p.evaluate(() => window.__sh && window.__sh.text)) === t2);
  // 2. гараж зі своїм постачальником — сума з тарифу свого
  await load(demo({ garage: 'own', atGarage: true, today: '2026-11-14' }), 'share');
  const g = await p.$eval('[data-key=sh-preview] .sh-bubble', e => e.textContent).catch(() => '');
  ok('гараж: «Світло (31.10): 1310 кВт·год — +60 кВт·год з 30.09, ≈ 259,20 грн»', /Світло \(31\.10\): 1310 кВт·год — \+60 кВт·год з 30\.09, ≈ 259,20 грн/.test(g), g);
  ok('один лічильник — без «Разом»', !/Разом/.test(g));
  ok('без помилок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
