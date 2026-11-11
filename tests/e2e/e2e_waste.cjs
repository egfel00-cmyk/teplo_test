// Вивіз сміття на рівні лічильників (115-а, власник 11.11): «Додати лічильник» → «Вивіз сміття» → своя сторінка (сума на місяць замість табло,
// налаштування: люди, своя ціна, рахунок, нагадування), картка на головній з «+» = записати оплату, оплата за кілька місяців, правка й видалення,
// історія й статистика (вкладка «Сміття»), рядок серед лічильників квартири, прибрати/повернути, ?go=waste, monobank на виду в постачальниках.
// node e2e_waste.cjs  (локальний сервер 127.0.0.1:8013) → /tmp/e2e_waste_*.png
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  const s0 = demo({}); s0.places[0].address = 'м. Харків, вул. Сумська, 10';   // сьогодні в демо — 2 листопада 2026
  await p.goto(U); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), s0);
  const pid = s0.places[0].id, st = () => p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')).places[0].waste);
  const txt = (sel) => p.textContent(sel).catch(() => '');

  // 1. додаємо, як лічильник
  await p.goto(U + '#place-' + pid); await p.reload(); await p.waitForTimeout(900);
  ok('у постачальниках — «Заповнити з monobank» на виду', await p.locator('[data-key=mono-open-place]').count() === 1);
  await p.evaluate(() => document.querySelector('[data-key=pv-add-meter]').click()); await p.waitForTimeout(500);
  const opt = await txt('[data-key=am-waste]');
  ok('«Додати лічильник» — є «Вивіз сміття» з вивізником і ціною за адресою', /Вивіз сміття/.test(opt) && /23,47 грн з людини/.test(opt), opt);
  await p.click('[data-key=am-waste]'); await p.waitForTimeout(600);
  ok('→ сторінка вивозу, налаштування відкриті', /#waste$/.test(p.url()) && await p.evaluate(() => !!document.querySelector('[data-key=wbox-set]') && document.querySelector('[data-key=wbox-set]').open), p.url());
  let w = await st(); ok('у стані: on, at', w && w.on === true && !!w.at, w);
  ok('без людей — «—» і «Впишіть, скільки людей»', /—/.test(await txt('[data-key=wplate-hero]')) && /Впишіть, скільки людей/.test(await txt('[data-key=wplate-hero]')), await txt('[data-key=wplate-hero]'));
  await p.fill('#ws-persons', '3'); await p.waitForTimeout(300);
  ok('3 людини → замість табло «70,41 грн» і «3 × 23,47 грн з людини» — на місці', /70,41/.test(await txt('[data-key=wplate-hero]')) && /3 × 23,47 грн з людини/.test(await txt('[data-key=wplate-hero]')), await txt('[data-key=wplate-hero]'));
  await p.fill('#ws-acc', '700123'); await p.dispatchEvent('#ws-acc', 'change'); await p.waitForTimeout(200);
  w = await st(); ok('люди й особовий рахунок збережено', w.persons === 3 && w.account === '700123', w);
  await p.reload(); await p.waitForTimeout(700);
  ok('«Куди платити» — вивізник і рахунок', /Комплекс з вивозу/.test(await txt('[data-key=wpay-where]')) && /700123/.test(await txt('[data-key=wpay-where]')), await txt('[data-key=wpay-where]'));
  await p.screenshot({ path: '/tmp/e2e_waste_page.png', fullPage: true });

  // 2. картка на головній
  await p.goto(U + '#home'); await p.waitForTimeout(600);
  const card = await txt('[data-key=card-waste]');
  ok('картка на головній серед лічильників: сума на місяць, «оплат ще не записано»', /Вивіз сміття/.test(card) && /70,41/.test(card) && /оплат ще не записано/.test(card), card);
  await p.screenshot({ path: '/tmp/e2e_waste_home.png', fullPage: true });

  // 3. «+» — записати оплату: за жовтень (минулий), сума за нарахуванням, дата — сьогодні
  await p.click('[data-key=card-waste-add]'); await p.waitForTimeout(500);
  ok('«+» → форма оплати: жовтень, 70,41, 2026-11-02', /#wpay$/.test(p.url()) && await p.inputValue('#wp-ym') === '2026-10' && await p.inputValue('#wp-amount') === '70,41' && await p.inputValue('#wp-date') === '2026-11-02',
    [p.url(), await p.inputValue('#wp-ym').catch(() => ''), await p.inputValue('#wp-amount').catch(() => '')]);
  await p.fill('#wp-amount', ''); await p.click('[data-key=wp-save]'); await p.waitForTimeout(300);
  ok('без суми — помилка, не зберегли', /Впишіть суму/.test(await txt('[data-key=wp-err]')) && !((await st()).pays || []).length);
  await p.fill('#wp-amount', '70,41'); await p.click('[data-key=wp-save]'); await p.waitForTimeout(600);
  w = await st(); ok('оплату записано: жовтень, 1 міс., 70,41', w.pays && w.pays.length === 1 && w.pays[0].ym === '2026-10' && w.pays[0].n === 1 && w.pays[0].amount === 70.41 && w.pays[0].date === '2026-11-02', w.pays);
  ok('назад — на головну; картка «Сплачено за жовтень — 2 листопада»', /#home$/.test(p.url()) && /Сплачено за жовтень — 2 листопада/.test(await txt('[data-key=card-waste]')), [p.url(), await txt('[data-key=card-waste]')]);

  // 4. оплата за кілька місяців: сума підлаштовується
  await p.goto(U + '#waste'); await p.waitForTimeout(500);
  await p.click('[data-key=waste-pay]'); await p.waitForTimeout(400);
  ok('наступна оплата — за листопад', await p.inputValue('#wp-ym') === '2026-11', await p.inputValue('#wp-ym'));
  await p.click('[data-key=wp-n-inc]'); await p.waitForTimeout(150); await p.click('[data-key=wp-n-inc]'); await p.waitForTimeout(200);
  ok('3 місяці → 211,23 і «Листопад 2026 — січень 2027»', await p.inputValue('#wp-amount') === '211,23' && /Листопад 2026 — січень 2027/.test(await txt('#wp-n-h')), [await p.inputValue('#wp-amount'), await txt('#wp-n-h')]);
  await p.click('[data-key=wp-save]'); await p.waitForTimeout(600);
  ok('назад — на сторінку вивозу; смужка місяців: жовтень і листопад сплачено', /#waste$/.test(p.url()) && await p.locator('.wstrip .ws-m.ok').count() >= 2, p.url());
  const hist = await txt('[data-key=waste-hist]');
  ok('історія на сторінці: місяці з «Сплачено», «211,23 грн за 3 міс.»', /Сплачено/.test(hist) && /211,23 грн за 3 міс/.test(hist), hist);

  // 5. правка й видалення
  const multi = (await st()).pays.filter(x => x.n === 3)[0];
  await p.goto(U + '#wpay-' + multi.id); await p.waitForTimeout(500);
  ok('правка: поля оплати', await p.inputValue('#wp-amount') === '211,23' && await txt('#wp-n') === '3');
  await p.click('[data-key=wp-del]'); await p.waitForTimeout(500);
  w = await st(); ok('видалили — позначка deleted, лишилась жовтнева', w.pays.filter(x => !x.deleted).length === 1 && w.pays.some(x => x.id === multi.id && x.deleted), w.pays);

  // 6. вкладки «Історія» й «Статистика»
  await p.goto(U + '#history'); await p.waitForTimeout(500);
  await p.click('[data-key=kind-waste]'); await p.waitForTimeout(500);
  const h2 = await txt('[data-key=waste-history]');
  ok('«Історія» → «Сміття»: листопад (поточний, ≈ 70,41) і жовтень (сплачено)', /Листопад 2026/.test(h2) && /Поточний місяць/.test(h2) && /Жовтень 2026/.test(h2) && /сплачено 2 листопада 2026/.test(h2), h2);
  await p.goto(U + '#stats'); await p.waitForTimeout(600);
  const kp = await txt('[data-key=wst-kpi]');
  ok('«Статистика» → «Сміття»: 70,41 грн на місяць, за 12 міс. сплачено 70,41', /70,41/.test(kp) && /грн на місяць/.test(kp) && /сплачено 70,41 грн \(1 опл\.\)/.test(kp), kp);
  await p.goto(U + '#save'); await p.waitForTimeout(400);
  ok('«Економія» — без «Сміття»', !(await p.$('[data-key=kind-waste]')));

  // 7. екран квартири: рядок серед лічильників, постачальник, прибрати й повернути
  await p.goto(U + '#place-' + pid); await p.waitForTimeout(700);
  ok('серед лічильників — «Вивіз сміття · 3 × 23,47 грн з людини»', /3 × 23,47 грн з людини/.test(await txt('[data-key=pv-m-waste]')), await txt('[data-key=pv-m-waste]'));
  ok('у постачальниках — вивізник і «Налаштування й оплати»', /Комплекс з вивозу/.test(await txt('[data-key=prov-waste]')) && !!(await p.$('[data-key=pv-waste-open]')));
  await p.evaluate(() => document.querySelector('[data-key=pv-remove-waste]').click()); await p.waitForTimeout(500);
  w = await st(); ok('прибрали — on немає, removed, оплати лишились', !w.on && !!w.removed && w.pays.length >= 1, w);
  ok('у «Прибрані раніше» — вивіз сміття', !!(await p.$('[data-key=pv-restore-waste]')));
  await p.goto(U + '#home'); await p.waitForTimeout(400); ok('з головної картка зникла', !(await p.$('[data-key=card-waste]')));
  await p.goto(U + '#place-' + pid); await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelector('[data-key=pv-restore-waste]').click()); await p.waitForTimeout(500);
  w = await st(); ok('повернули — як було (люди 3, рахунок)', w.on === true && !w.removed && w.persons === 3 && w.account === '700123', w);

  // 8. нагадування з бота й галочка нагадувань
  await p.goto(U + '?go=waste&place=' + pid); await p.waitForTimeout(900);
  ok('?go=waste — сторінка вивозу', /#waste$/.test(p.url()), p.url());
  await p.evaluate(() => { const d = document.querySelector('[data-key=wbox-set]'); if (d) d.open = true; });
  const rmd = p.locator('[data-key=ws-remind]');
  if (await rmd.count()) { await p.evaluate(() => document.querySelector('[data-key=ws-remind]').click()); await p.waitForTimeout(200); w = await st(); ok('нагадування вимкнули — remindOff', w.remindOff === true, w); }
  else ok('галочка нагадування (лише з сервером) — є', false);
  ok('без помилок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
