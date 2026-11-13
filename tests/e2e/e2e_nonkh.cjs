// 142-а: квартира не в Харкові — тексти за її постачальниками. Буча (вода КП «Бучасервіс» 25–30, тепла в довіднику нема):
// «Нагадування» в Налаштуваннях — «вода — 26-го (до 30-го)», без «Водоканал до 20-го» і тепла; картка води на головній — строк Бучі (до 30-го), не «до 20-го»;
// «Контакти для ХТМ» — лише якщо є квартира з теплом ХТМ; «Коли водомір знято» — норми громади, харківські лише орієнтир.
// Харків (без адреси) — як було; дві квартири (Харків + Буча) — строки з назвами квартир. node e2e_nonkh.cjs  (сайт 127.0.0.1:8013)
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
const U = 'http://127.0.0.1:8013/';
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' })).newPage(); p.setDefaultTimeout(6000);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const txt = sel => p.textContent(sel).catch(() => '');
  const open = async (s, route) => {
    await p.goto(U); await p.evaluate(s => { localStorage.clear(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, s);
    await p.goto(U + '#' + route); await p.reload(); await p.waitForTimeout(1500);
  };
  const bucha = (today, extra) => { const s = demo(Object.assign({ today }, extra || {})); s.places[0].address = 'м. Буча, вул. Енергетиків, 1, кв. 1'; s.places[0].city = { n: 'Буча', r: 'kv' }; return s; };

  // Буча, 27.11: вікно 25–30 відкрите, води цього місяця нема
  await open(bucha('2026-11-27'), 'home');
  const cold = await txt('.ucard-cold');
  ok('Буча 27.11: картка холодної — «Передати до 30 листопада», не «20»', /Передати до 30 листопада/.test(cold) && !/20 листопада/.test(cold), cold);
  await open(bucha('2026-11-18'), 'home');
  const cold18 = await txt('.ucard-cold');
  ok('Буча 18.11 (Харків — «до 20-го»): вікно ще не відкрилося — строку на картці нема', !/20 листопада/.test(cold18) && !/Передати до/.test(cold18), cold18);
  await p.goto(U + '#prefs'); await p.waitForTimeout(800);
  await p.evaluate(() => { var d = document.getElementById('pg-remind'); if (d) d.open = true; var w = document.getElementById('pg-water'); if (w) w.open = true; }); await p.waitForTimeout(300);
  const rs = await txt('[data-key=prefs-remind-sub]');
  ok('Налаштування → нагадування (Буча): «вода — 26-го (до 30-го)», без «Водоканал до 20-го» і без тепла ХТМ', /вода — 26-го \(до 30-го\)/.test(rs) && !/Водоканал/.test(rs) && !/ХТМ/.test(rs) && !/тепло/.test(rs), rs);
  ok('«Контакти для ХТМ» — нема (тепло в Бучі не від ХТМ)', !(await p.$('#pg-contacts')));
  const nm = await txt('[data-key=prefs-nometer-w]');
  ok('«Коли водомір знято»: норми встановлює громада, харківські — лише орієнтир, «Бучасервіс»', /встановлює ваша громада/.test(nm) && /лише для орієнтиру/.test(nm) && /Бучасервіс/.test(nm), nm.slice(0, 500));

  // Харків (без адреси) — як було
  await open(demo({ today: '2026-11-18' }), 'prefs');
  await p.evaluate(() => { var d = document.getElementById('pg-remind'); if (d) d.open = true; }); await p.waitForTimeout(300);
  const rk = await txt('[data-key=prefs-remind-sub]');
  ok('Харків: «тепло — 21-го (ХТМ до 25-го), вода — 16-го (Водоканал до 20-го)»; «Контакти для ХТМ» є', /тепло — 21-го \(ХТМ до 25-го\)/.test(rk) && /вода — 16-го \(Водоканал до 20-го\)/.test(rk) && !!(await p.$('#pg-contacts')), rk);
  await p.goto(U + '#home'); await p.waitForTimeout(600);
  ok('Харків 18.11: картка холодної — «Передати до 20 листопада»', /Передати до 20 листопада/.test(await txt('.ucard-cold')), await txt('.ucard-cold'));

  // дві квартири: Харків + Буча (лише холодна)
  const two = demo({ today: '2026-11-18', second: true });
  two.places[1].name = 'Буча'; two.places[1].address = 'м. Буча, вул. Енергетиків, 1, кв. 5'; two.places[1].city = { n: 'Буча', r: 'kv' };
  await open(two, 'prefs');
  await p.evaluate(() => { var d = document.getElementById('pg-remind'); if (d) d.open = true; }); await p.waitForTimeout(300);
  const r2 = await txt('[data-key=prefs-remind-sub]');
  ok('дві квартири: «вода: «Моя квартира» — 16-го (Водоканал до 20-го), «Буча» — 26-го (до 30-го)»; тепло — один строк', /вода: «Моя квартира» — 16-го \(Водоканал до 20-го\), «Буча» — 26-го \(до 30-го\)/.test(r2) && /тепло — 21-го/.test(r2), r2);
  ok('дві квартири: «Контакти для ХТМ» є (перша — Харків)', !!(await p.$('#pg-contacts')));
  ok('без помилок JS', !errs.length, errs);
  await b.close();
  console.log(pass + ' OK, ' + fail + ' FAIL'); process.exit(fail ? 1 : 0);
})();
