// Частка ЗБП без довідки ХТМ (66-я): квитанції ХТМ 2024–2026 — з лічильником ХТМ бере (своє + ЗБП) × 1539,50 + 29,40, ЗБП ≈ 0,00025 Гкал на м².
// Довідки немає — для всіх із теплом ХТМ і відомою площею частка ЗБП = 0,00025 × площа, лише в місяці з теплом і лише в опалювальні (жовтень–квітень).
// Тепло не від ХТМ (Львів) — без ЗБП; своє число з платіжки — головніше. В історії поруч — «до сплати» з квитанції ХТМ.
// Нужен сайт 8013 (SITE_DATA с config.php). Без входа: состояние — в localStorage.
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); const wait = ms => p.waitForTimeout(ms);
  const put = async f => { await p.goto(U); await p.evaluate(() => localStorage.clear()); const s = demo({ today: '2026-11-06' }); f(s); await p.evaluate(s => { s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, s); };
  const parts = async id => { await p.goto(U + '#rec-' + id); await p.reload(); await wait(1500); return (await p.textContent('[data-key=rec-used]').catch(() => '')).replace(/\s/g, ' '); };
  const sp = s => s.replace(/[  ]/g, ' ');

  // 1. площі немає — ЗБП не додаємо (лише тепло й абонплата): лютий 1,290 Гкал × 1539,50 = 1985,95 + 29,40 (різниця 1,28999… у плаваючій комі)
  await put(s => {});
  let t = sp(await parts('r1'));
  ok('без площі: тепло 1 985,95 + абонплата 29,40, частки ЗБП немає', /1 985,95 грн за тепло/.test(t) && !/ЗБП/.test(t) && /абонплата 29,40/.test(t), t);

  // 2. площа 54,3 м², довідки немає, адреси немає (Харків, ХТМ) — частка ЗБП 0,00025 × 54,3 = 0,013575 Гкал → 20,90 грн; разом 2 036,25
  await put(s => { s.places[0].area = 54.3; });
  t = sp(await parts('r1'));
  ok('площа 54,3: частка ЗБП 20,90 грн (0,013575 Гкал × 1539,50), разом ≈ 2 036,25', /1 985,95 грн за тепло/.test(t) && /ЗБП\) 20,90/.test(t) && /2 036,25/.test(t), t);
  // налаштування: поле порожнє, підказка — скільки рахуємо самі
  await p.goto(U + '#prefs'); await wait(800);
  await p.click('[data-key=pg-heat] summary, #pg-heat summary, details[data-g=heat] summary').catch(() => {});
  await wait(300);
  const fv = await p.evaluate(() => { const i = document.getElementById('p-mzk'), h = document.querySelector('[data-key=p-mzk-h]'); return i ? [i.value, i.placeholder, h ? h.textContent : ''] : null; });
  ok('поле «Ваша частка ЗБП»: порожнє, підказка 0,01358 і «0,00025 Гкал на м² × 54,3 м²»', fv && fv[0] === '' && fv[1] === '0,01358' && /0,01358 Гкал\/міс/.test(fv[2]) && /54,3 м²/.test(fv[2]), fv);

  // 3. проміжок через літо: 14.04 → 14.10, 0,2 Гкал, 6 місяців — ЗБП лише за жовтень (1 місяць), абонплата — за 6
  await put(s => { s.places[0].area = 54.3; s.readings.unshift({ id: 'q2', place: 'main', htm: { date: '2025-10-14', energy: '7.900' }, status: 'accepted', createdAt: '2025-10-14T10:00:00Z', updatedAt: 1, source: 'manual' },
    { id: 'q1', place: 'main', htm: { date: '2025-04-14', energy: '7.700' }, status: 'accepted', createdAt: '2025-04-14T10:00:00Z', updatedAt: 1, source: 'manual' }); });
  t = sp(await parts('q2'));
  ok('літо 14.04–14.10: тепло 307,90 + ЗБП 20,90 (лише жовтень) + абонплата 176,40 (6 міс.)', /307,90 грн за тепло/.test(t) && /ЗБП\) 20,90/.test(t) && /абонплата 176,40/.test(t), t);

  // 4. своє число з платіжки — головніше: 0,01262 → 19,43 грн; у полі — саме воно
  await put(s => { s.places[0].area = 54.3; s.places[0].bill = { mzk: 0.01262 }; });
  t = sp(await parts('r1'));
  ok('своя частка 0,01262 з платіжки: 19,43 грн', /ЗБП\) 19,43/.test(t), t);

  // 5. тепло не від ХТМ (Львів — Львівтеплоенерго): ЗБП ХТМ не додаємо
  await put(s => { s.places[0].area = 54.3; s.places[0].address = 'м. Львів, вул. Городоцька, 1, кв. 1'; });
  await p.goto(U + '#rec-r1'); await p.reload(); await wait(3000);
  t = sp((await p.textContent('[data-key=rec-used]').catch(() => '')).replace(/\s/g, ' '));
  ok('Львів (тепло не від ХТМ): частки ЗБП немає (0,00 або рядка немає)', /1 985,95 грн за тепло/.test(t) && (!/ЗБП/.test(t) || /ЗБП\) 0,00/.test(t)), t);

  // 6. історія: у записі є квитанція ХТМ — поруч «до сплати 1 234,56 грн»; з 11.2025 у рахунку тепло наперед — «з них наперед 225,79 грн» і пояснення в картці
  await put(s => { s.places[0].area = 54.3; s.readings.filter(r => r.id === 'r3')[0].bills = [{ id: 'd1', auto: 'htm', name: 'Квитанція ХТМ, квітень 2026', mime: 'text/html', pay: '1234.56', at: '2026-05-07T08:00:00Z', bytes: 4000 }];
    s.readings.filter(r => r.id === 'r2')[0].bills = [{ id: 'd2', auto: 'htm', name: 'Квитанція ХТМ, березень 2026', mime: 'text/html', pay: '3000.00', pre: '225.79', unpre: '-613.35', at: '2026-04-07T08:00:00Z', bytes: 4000 }]; });
  await p.goto(U + '#history'); await p.reload(); await wait(1500); await p.click('[data-key=kind-heat]').catch(() => {}); await wait(400);   // 147-а: перша вкладка — вода
  t = sp(await p.textContent('[data-key=reading-r3]').catch(() => ''));
  ok('історія: рядок квітня — «до сплати 1 234,56 грн» з квитанції', /до сплати 1 234,56 грн/.test(t) && !/наперед/.test(t), t);
  t = sp(await p.textContent('[data-key=reading-r2]').catch(() => ''));
  ok('…березня — «до сплати 3 000,00 грн, з них наперед 225,79 грн»', /до сплати 3 000,00 грн, з них наперед 225,79 грн/.test(t), t);
  // платіжки в картці — лише вошедшим (квитанції ХТМ приходять із сервера): входимо й кладемо той самий стан
  ok('регистрация', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'zb' + Date.now() + '@teplo.test') === 200);
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.readings.filter(r => r.id === 'r2')[0].bills = [{ id: 'd2', auto: 'htm', name: 'Квитанція ХТМ, березень 2026', mime: 'text/html', pay: '3000.00', pre: '225.79', unpre: '-613.35', at: '2026-04-07T08:00:00Z', bytes: 4000 }];
    s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.goto(U + '#rec-r2'); await p.reload(); await wait(2500);
  t = sp(await p.textContent('[data-key=hb-pre-why]').catch(() => ''));
  ok('картка березня: чому до сплати більше — наперед 225,79, знято 613,35, ГВ і борг', /225,79/.test(t) && /613,35/.test(t) && /донараховано до кінця поточного місяця/.test(t), t);

  ok('без ошибок JS', !errs.length, errs);
  await b.close(); console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); process.exit(fail ? 1 : 0);
})();
