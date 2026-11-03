// Статус прямо на чипсе в истории: «Передано · Не передано · Лише для себе» (вода, світло, газ, тепло), стартовые — 2 варианта,
// меню закрывается Esc и кликом мимо, строка по-прежнему ведёт в карточку записи.
// node e2e_status.cjs  (локальный сервер 127.0.0.1:8013)
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 360, height: 800 }, locale: 'uk-UA' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')));
  const view = async (v) => { await p.goto(U + '#history'); await p.waitForTimeout(250); await p.click('[data-act=view][data-v=' + v + ']'); await p.waitForTimeout(300); };
  const chip = (id) => p.textContent('[data-key="st-' + id + '"]');
  const pick = async (id, v) => { await p.click('[data-key="st-' + id + '"]'); await p.waitForTimeout(150); await p.click('[data-key=st-menu] [data-key=st-set-' + v + ']'); await p.waitForTimeout(300); };
  await p.goto(U); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo({ elec: true, gas: true }));
  await p.goto(U + '#history'); await p.reload(); await p.waitForTimeout(500);

  // вода, гаряча
  await view('hot');
  ok('гаряча: чипс-кнопка «передано»', /передано/.test(await chip('w20261015')) && (await p.getAttribute('[data-key="st-w20261015"]', 'aria-haspopup')) === 'true');
  await p.click('[data-key="st-w20261015"]'); await p.waitForTimeout(200);
  const opts = await p.$$eval('[data-key=st-menu] .st-opt', a => a.map(x => x.textContent));
  ok('меню: 3 варіанти, «Передано» відмічено, підказка «у Водоканал і ХТМ»', opts.length === 3 && /Передано/.test(opts[0]) && /Водоканал і ХТМ/.test(opts[0]) && (await p.getAttribute('[data-key=st-set-sent]', 'aria-checked')) === 'true', opts);
  const inView = await p.$eval('[data-key=st-menu]', m => { const r = m.getBoundingClientRect(); return r.left >= 0 && r.right <= document.documentElement.clientWidth; });
  ok('меню не за краєм екрана', inView);
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  ok('Esc закриває меню, фокус на чипсі', !(await p.$('[data-key=st-menu]')) && (await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-key'))) === 'st-w20261015');
  await p.click('[data-key="st-w20261015"]'); await p.waitForTimeout(100); await p.click('h1'); await p.waitForTimeout(100);
  ok('клік повз — меню закрилось', !(await p.$('[data-key=st-menu]')));
  await pick('w20261015', 'not'); let s = await st(); let r = s.water.find(x => x.id === 'w20261015');
  ok('гаряча «Не передано» → знято лише ХТМ (Водоканал лишився), чипс «не передано»', !r.sent.htm && !!r.sent.vk && /не передано/.test(await chip('w20261015')), r.sent);
  ok('тост «Позначено: не передано»', /Позначено: не передано/.test(await p.textContent('#toast-host')));
  await view('cold');
  ok('та сама запис у холодній — досі «передано» (Водоканал)', /^\s*передано/.test(await chip('w20261015')));
  await view('hot');
  await pick('w20261015', 'own'); s = await st(); r = s.water.find(x => x.id === 'w20261015');
  ok('«Лише для себе» → own, чипс «для себе»', r.own === true && /для себе/.test(await chip('w20261015')));
  await pick('w20261015', 'sent'); s = await st(); r = s.water.find(x => x.id === 'w20261015');
  ok('«Передано» → own знято, Водоканал і ХТМ', !r.own && !!r.sent.vk && !!r.sent.htm && /передано/.test(await chip('w20261015')));
  await view('cold');
  await pick('w20260916', 'not'); s = await st(); r = s.water.find(x => x.id === 'w20260916');
  ok('холодна «Не передано» → знято Водоканал', !r.sent.vk, r.sent);
  // стартові
  await p.click('[data-key="st-w20260415"]'); await p.waitForTimeout(150);
  const bopts = await p.$$eval('[data-key=st-menu] .st-opt', a => a.map(x => x.textContent));
  ok('стартові: 2 варіанти («Передано», «Не передавали»)', bopts.length === 2 && /Не передавали/.test(bopts[1]), bopts);
  await p.click('[data-key=st-menu] [data-key=st-set-not]'); await p.waitForTimeout(300); s = await st();
  ok('стартові «Не передавали» → sent.no', s.water.find(x => x.id === 'w20260415').sent.no === true && /Не передавали/.test(await chip('w20260415')));

  // світло
  await view('elec');
  ok('світло 31.10: «не передано»', /не передано/.test(await chip('m20261031')));
  await pick('m20261031', 'sent'); s = await st(); r = s.mrecs.find(x => x.id === 'm20261031');
  ok('світло «Передано» → sent.obl', !!r.sent.obl && /передано/.test(await chip('m20261031')), r.sent);
  // газ
  await view('gas');
  await pick('n20261001', 'own'); s = await st(); r = s.mrecs.find(x => x.id === 'n20261001');
  ok('газ «Лише для себе» → own', r.own === true && /для себе/.test(await chip('n20261001')));

  // тепло
  await view('heat');
  ok('тепло: чипс з «Прийнято»', /Прийнято/.test(await chip('r3')));
  await pick('r3', 'not'); s = await st(); r = s.readings.find(x => x.id === 'r3');
  ok('тепло «Не передано» → status checked, «Підготовлено»', r.status === 'checked' && /Підготовлено/.test(await chip('r3')), r.status);
  await pick('r3', 'sent'); s = await st(); r = s.readings.find(x => x.id === 'r3');
  ok('тепло «Передано» → handed, «На перевірці»', r.status === 'handed' && !!r.handedAt && /На перевірці/.test(await chip('r3')), r.status);
  await pick('r3', 'own'); s = await st(); r = s.readings.find(x => x.id === 'r3');
  ok('тепло «Лише для себе» → own', r.own === true && /для себе/.test(await chip('r3')));

  // рядок — як і раніше посилання в картку
  await p.click('[data-key=reading-r2] a.hrow'); await p.waitForTimeout(300);
  ok('клік по рядку → картка запису', (await p.evaluate(() => location.hash)) === '#rec-r2');
  // на сторінці води (останні 3) — той самий чипс
  await p.goto(U + '#water-hot'); await p.waitForTimeout(400);
  ok('сторінка гарячої: чипси в останніх записах', (await p.$$('[data-key=water-history-hot] .st-chip')).length >= 1);

  // телефон (360 px): у води, як у тепла, статус — у правому верхньому куті картки, на рядку дати
  await view('hot');
  const pos = await p.evaluate(() => { const li = document.querySelector('[data-key="st-w20261015"]').closest('li'), c = li.querySelector('.st-chip').getBoundingClientRect(), d = li.querySelector('.hr-date').getBoundingClientRect(), r = li.getBoundingClientRect(); return { top: Math.abs(c.top - d.top) < 14, right: r.right - c.right < 20 }; });
  ok('вода на телефоні: статус у правому верхньому куті', pos.top && pos.right, pos);
  ok('без помилок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
