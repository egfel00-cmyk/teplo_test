// Доставка (розподіл) газу в обліку (123-я, власник 12.11: «у платіжці ще за транспортування — додати в облік»).
// Річна замовлена потужність ÷ 12 × тариф оператора ГРМ — щомісяця однаково; тариф — з довідника за адресою або свій.
// Запуск: cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_gasfee.cjs   (сайт 127.0.0.1:8013)
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, i) => { console.log((c ? '  OK  ' : ' FAIL ') + n + (!c && i !== undefined ? '  → ' + JSON.stringify(i) : '')); c ? pass++ : fail++; };
(async () => {
  const b = await chromium.launch(); const ctx = await require('./pvopen.cjs').ctx(b, { viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')));
  const go = async (r) => { await p.goto('http://127.0.0.1:8013/#' + r); await p.waitForTimeout(450); await p.evaluate(() => document.querySelectorAll('details.mbox-set').forEach(d => { d.open = true; })); };
  const setF = async (sel, v) => { await p.fill(sel, v); await p.press(sel, 'Tab'); await p.waitForTimeout(400); await p.evaluate(() => document.querySelectorAll('details.mbox-set').forEach(d => { d.open = true; })); };
  const txt = sel => p.textContent(sel).catch(() => '');
  await p.goto('http://127.0.0.1:8013/'); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo({ gas: true }));
  await p.reload(); await p.waitForTimeout(400);

  // 1. Без адреси: тарифу немає — просимо обидва числа з платіжки
  await go('gas');
  ok('«Ціна» газу: поля «Річна замовлена потужність» і «Доставка (розподіл) за м³»', !!(await p.$('#mp-gcap')) && !!(await p.$('#mp-gdist')));
  ok('без адреси — просимо потужність і тариф з платіжки', /впишіть з платіжки за доставку річну замовлену потужність і тариф/.test(await txt('[data-key=mp-gfee]')), await txt('[data-key=mp-gfee]'));
  await go('erec-n20261101');
  let used = await txt('[data-key=erec-used]');
  ok('запис без доставки: 30 × 7,96 = 238,80 і підказка, де вписати', /238,80/.test(used) && !/Доставка \(розподіл\) за місяць/.test(used) && /впишіть річну потужність і тариф доставки/.test(used), used);

  // 2. Вписали з платіжки: 1200 м³, 2,388 → 238,80 на місяць
  await go('gas'); await setF('#mp-gdist', '2,388'); await setF('#mp-gcap', '1200');
  let s = await st();
  ok('збережено в квартири: gasCap 1200, gasDist 2.388', s.places[0].gasCap === 1200 && s.places[0].gasDist === 2.388, { cap: s.places[0].gasCap, d: s.places[0].gasDist });
  ok('під полями: «1200 м³ на рік ÷ 12 × 2,388 грн = 238,80 грн щомісяця»', /1200 м³ на рік ÷ 12 × 2,388 грн = 238,80 грн щомісяця/.test(await txt('[data-key=mp-gfee]')), await txt('[data-key=mp-gfee]'));
  await go('erec-n20261101');
  used = await txt('[data-key=erec-used]');
  ok('запис: сума з доставкою ≈ 477,60 (газ 238,80 + доставка 238,80)', /477,60/.test(used), used);
  ok('запис: рядок «Доставка (розподіл) за місяць: 238,80 грн» і примітка як рахується', /Доставка \(розподіл\) за місяць: 238,80 грн/.test(used) && /1200 м³ на рік ÷ 12 × 2,388/.test(used), used);
  await go('stats'); await p.click('[data-key=kind-gas]'); await p.waitForTimeout(400);
  const tbl = await p.evaluate(() => Array.from(document.querySelectorAll('[data-key=stt-table] tbody tr')).map(r => Array.from(r.cells).map(c => c.textContent)));
  ok('статистика: вересень 15 м³ — 15 × 7,96 = 119,40 + доставка 238,80 = 358,20', tbl.some(r => r[2] === '15' && /358,20/.test(r[3])), tbl);
  ok('статистика: примітка — «газ … і доставка (розподіл) за річною потужністю»', /і доставка \(розподіл\) за річною потужністю/.test(await txt('#main')));

  // 3. Адреса в Харкові — тариф з довідника 0,516 (свій тариф прибрали)
  await go('gas'); await setF('#mp-gdist', '');
  s = await st(); s.places[0].address = 'Харків, вул. Сумська, 10, кв. 5'; delete s.places[0].gasDist; s.places[0].updatedAt = Date.now();
  await p.evaluate(v => localStorage.setItem('teplo.v1', JSON.stringify(v)), s); await p.reload(); await p.waitForTimeout(500);
  await go('gas'); await p.waitForTimeout(900); await go('gas');
  ok('Харків: тариф доставки з довідника 0,516 у полі', (await p.inputValue('#mp-gdist').catch(() => '')) === '0,516', await p.inputValue('#mp-gdist').catch(() => ''));
  ok('Харків: 1200 ÷ 12 × 0,516 = 51,60 грн щомісяця', /= 51,60 грн щомісяця/.test(await txt('[data-key=mp-gfee]')), await txt('[data-key=mp-gfee]'));
  s = await st(); ok('тариф з довідника не записали як свій', !('gasDist' in s.places[0]), s.places[0].gasDist);

  // 4. Потужності нема, але є показання за газовий рік (1.10.2024–30.09.2025 для 2026) — оцінка
  s = await st(); delete s.places[0].gasCap;
  s.mrecs = s.mrecs.concat([['2024-10-02', '400'], ['2025-09-29', '1010']].map(([d, v]) => ({ id: 'y' + d.replace(/-/g, ''), place: 'main', meter: 'g1', kind: 'gas', date: d, z: { all: v }, base: false, sent: { grm: d }, createdAt: d + 'T10:00:00Z', updatedAt: 1 })));
  await p.evaluate(v => localStorage.setItem('teplo.v1', JSON.stringify(v)), s); await p.reload(); await p.waitForTimeout(500); await go('gas'); await p.waitForTimeout(700); await go('gas');
  const ph = await p.getAttribute('#mp-gcap', 'placeholder').catch(() => '');
  ok('оцінка за показаннями: 610 м³ за 362 дні → «оцінка 615» у полі', /оцінка 615/.test(ph || ''), ph);
  ok('оцінка: «Потужність — оцінка за вашими показаннями (02.10.2024 – 29.09.2025)»', /оцінка за вашими показаннями/.test(await txt('[data-key=mp-gfee]')) && /615 м³ на рік/.test(await txt('[data-key=mp-gfee]')), await txt('[data-key=mp-gfee]'));

  ok('оцінка: період з роками (02.10.2024 – 29.09.2025)', /02\.10\.2024 – 29\.09\.2025/.test(await txt('[data-key=mp-gfee]')), await txt('[data-key=mp-gfee]'));
  // 5. Російська (мова — з браузера)
  s = await st(); const ctxR = await require('./pvopen.cjs').ctx(b, { viewport: { width: 390, height: 844 }, locale: 'ru-RU' }); const pr = await ctxR.newPage(); pr.on('pageerror', e => errs.push(e.message));
  await pr.goto('http://127.0.0.1:8013/'); await pr.evaluate(v => localStorage.setItem('teplo.v1', JSON.stringify(v)), s); await pr.goto('http://127.0.0.1:8013/#gas'); await pr.reload(); await pr.waitForTimeout(1200);
  await pr.evaluate(() => document.querySelectorAll('details.mbox-set').forEach(d => { d.open = true; }));
  const ru = await pr.textContent('[data-key=mp-gas]').catch(() => '');
  ok('ru: «Годовая заказанная мощность» и «ежемесячно»', /Годовая заказанная мощность/.test(ru) && /ежемесячно/.test(ru), ru);
  ok('без ошибок JS', !errs.length, errs);
  await b.close(); console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); process.exit(fail ? 1 : 0);
})();
