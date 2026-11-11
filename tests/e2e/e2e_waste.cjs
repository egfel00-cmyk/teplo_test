// Вивіз сміття (112-а, власник 11.11: «так, і нагадувати про оплату»): на екрані квартири — тихий рядок «Вивіз сміття» під постачальниками;
// «Додати» → довідник громади за адресою (Харків: КВПВ, 23,47 з людини), скільки людей → сума на місяць; своя ціна; нагадування; прибрати.
// node e2e_waste.cjs  (локальний сервер 127.0.0.1:8013) → /tmp/e2e_waste.png
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const s0 = demo({}); s0.places[0].address = 'м. Харків, вул. Сумська, 10';
  await p.goto(U); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), s0);
  const pid = s0.places[0].id;
  await p.goto(U + '#place-' + pid); await p.reload(); await p.waitForTimeout(800);
  const openG = () => p.evaluate(() => { const d = document.querySelector('#waste') && document.querySelector('#waste').closest('details'); if (d) d.open = true; });
  await openG(); await p.waitForTimeout(300);
  const add = await p.textContent('[data-key=prov-waste-add]').catch(() => '');
  ok('вимкнено — тихий рядок «Вивіз сміття» з підказкою від довідника (КВПВ, 23,47)', /Вивіз сміття/.test(add) && /23,47 грн з людини/.test(add) && /Комплекс/.test(add), add);
  await p.click('[data-key=ws-on]'); await p.waitForTimeout(500); await openG();
  let box = await p.textContent('[data-key=prov-waste]').catch(() => '');
  ok('увімкнули — організація й ціна з довідника, просимо кількість людей', /Комплекс з вивозу/.test(box) && /23,47 грн з людини на місяць/.test(box) && /Впишіть, скільки людей/.test(box), box);
  await p.fill('#ws-persons', '3'); await p.waitForTimeout(300);
  ok('3 людини → «≈ 70,41 грн на місяць (3 × 23,47 грн)»', /≈ 70,41 грн на місяць \(3 × 23,47 грн\)/.test(await p.textContent('#ws-sum')), await p.textContent('#ws-sum'));
  await p.fill('#ws-price', '30'); await p.dispatchEvent('#ws-price', 'change'); await p.waitForTimeout(500); await openG();
  box = await p.textContent('[data-key=prov-waste]').catch(() => '');
  ok('своя ціна 30 → «30,00 грн з людини … (з вашої платіжки)», сума 90,00', /30,00 грн з людини на місяць \(з вашої платіжки\)/.test(box) && /≈ 90,00 грн на місяць/.test(box), box);
  let st = await p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')).places[0].waste);
  ok('у стані квартири: on, persons 3, price 30', st && st.on === true && st.persons === 3 && st.price === 30, st);
  await p.screenshot({ path: '/tmp/e2e_waste.png', fullPage: true });
  const rmd = p.locator('[data-key=ws-remind]');
  if (await rmd.count()) { await p.evaluate(() => document.querySelector('[data-key=ws-remind]').click()); await p.waitForTimeout(200); st = await p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')).places[0].waste); ok('нагадування вимкнули — remindOff', st.remindOff === true, st); }
  else ok('галочка нагадування (лише з сервером) — є', false);
  await p.evaluate(() => document.querySelector('[data-key=ws-off]').click()); await p.waitForTimeout(400);
  st = await p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')).places[0].waste);
  ok('прибрали — on немає, дані лишились (повернути — як було)', st && !st.on && st.persons === 3 && !!(await p.$('[data-key=prov-waste-add]')), st);
  // нагадування з бота: ?go=waste&place=… → екран квартири, блок «Вивіз сміття»
  await p.goto(U + '?go=waste&place=' + pid); await p.waitForTimeout(900);
  ok('?go=waste — екран квартири', new RegExp('#place-' + pid).test(p.url()) && !!(await p.$('#waste')), p.url());
  ok('без помилок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
