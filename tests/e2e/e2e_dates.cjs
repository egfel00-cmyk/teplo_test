// Дата руками в будь-якому вигляді (141-а, власник 13.11: «поля ввода дат должны понимать ввод дат в ручную любого формата и вида»).
// node e2e_dates.cjs  (локальний сервер 127.0.0.1:8013)
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(U); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo({}));
  await p.goto(U + '#wnew'); await p.reload(); await p.waitForTimeout(700);
  const T = '#wn-date-dmy', N = '#wn-date';
  const val = () => p.inputValue(T), nat = () => p.inputValue(N);
  const typeIn = async (s) => { await p.click(T, { clickCount: 3 }); await p.keyboard.press('Backspace'); await p.keyboard.type(s, { delay: 15 }); };
  ok('текстове поле дати є, «дд.мм.рррр», клавіатура з розділювачем (decimal)', await val() === '02.11.2026' && await p.getAttribute(T, 'inputmode') === 'decimal', await val());

  await typeIn('1.3.26');
  ok('«1.3.26» друкується як є (раніше цифри перемішувались у «13.26»)', await val() === '1.3.26', await val());
  ok('…до виходу з поля значення не чіпаємо (можуть дописувати)', await nat() === '2026-11-02', await nat());
  await p.keyboard.press('Tab'); await p.waitForTimeout(100);
  ok('вийшли з поля — 01.03.2026 і в даті 2026-03-01', await val() === '01.03.2026' && await nat() === '2026-03-01', [await val(), await nat()]);

  await typeIn('13102026');
  ok('одними цифрами — крапки ставимо самі, повний рік — одразу', await val() === '13.10.2026' && await nat() === '2026-10-13', [await val(), await nat()]);

  await typeIn('5 жовтня');
  await p.click('[data-wn=c1]');
  ok('«5 жовтня» → 05.10.2026', await val() === '05.10.2026' && await nat() === '2026-10-05', [await val(), await nat()]);

  await typeIn('вчора'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
  if (!/#wnew$/.test(p.url())) { await p.goto(U + '#wnew'); await p.waitForTimeout(500); }
  await typeIn('2026-10-20');
  ok('«2026-10-20» — одразу', await nat() === '2026-10-20', await nat());
  await p.keyboard.press('Tab'); ok('…і показуємо як 20.10.2026', await val() === '20.10.2026', await val());

  await typeIn('20/10/2026'); await p.keyboard.press('Tab');
  ok('«20/10/2026»', await nat() === '2026-10-20' && await val() === '20.10.2026', [await val(), await nat()]);
  await typeIn('Oct 7, 2026'); await p.keyboard.press('Tab');
  ok('«Oct 7, 2026»', await nat() === '2026-10-07', await nat());
  await typeIn('28.12'); await p.keyboard.press('Tab');
  ok('«28.12» без року — минулий рік (пізніше за сьогодні не буває)', await nat() === '2025-12-28', await nat());

  await typeIn('абв'); await p.keyboard.press('Tab'); await p.waitForTimeout(200);
  const toastTxt = await p.evaluate(() => (document.querySelector('.toast') || {}).textContent || '');
  ok('незрозуміле — червоне, тост з прикладом, дата лишилась', await p.$eval(T, e => e.classList.contains('bad') && e.getAttribute('aria-invalid') === 'true') && /Не розумію дату/.test(toastTxt) && await nat() === '2025-12-28', { toastTxt, n: await nat() });
  await typeIn('3'); ok('почали друкувати — вже не червоне', !(await p.$eval(T, e => e.classList.contains('bad'))));

  // кнопка «Зберегти» одразу після «10.10.26», не виходячи з поля (на iPhone поле може не втратити фокус)
  await p.fill('[data-wn=h1]', '176'); await p.fill('[data-wn=c1]', '438');
  await typeIn('10.10.26');
  await p.evaluate(() => document.querySelector('[data-key=wn-save]').click());   // фокус лишається в полі дати
  await p.waitForTimeout(500);
  const rec = await p.evaluate(() => (JSON.parse(localStorage.getItem('teplo.v1')).water || []).filter(w => w.vals && w.vals.h1 === '176')[0] || null);
  ok('«Зберегти» з фокусом у полі — запис з датою 2026-10-10', rec && rec.date === '2026-10-10', rec && rec.date);

  // повірка теплолічильника «до» — поле, після якого екран перемальовується (render) — дата в майбутньому, без max
  await p.goto(U + '#heat'); await p.waitForTimeout(800);
  await p.evaluate(() => document.querySelectorAll('details').forEach(d => { if (d.querySelector('#p-ver')) d.open = true; }));
  await p.click('#p-ver-dmy', { clickCount: 3 }); await p.keyboard.press('Backspace');
  ok('стерли повірку — екран не перемальовується на ходу (фокус лишився в полі)', await p.evaluate(() => document.activeElement && document.activeElement.id === 'p-ver-dmy'));
  await p.keyboard.type('31.12.29', { delay: 15 }); await p.keyboard.press('Tab'); await p.waitForTimeout(400);
  const vu = await p.evaluate(() => (JSON.parse(localStorage.getItem('teplo.v1')).meter || {}).verifiedUntil);
  ok('повірка «31.12.29» → 2029-12-31, після перемальовування — 31.12.2029', vu === '2029-12-31' && await p.inputValue('#p-ver-dmy') === '31.12.2029', [vu, await p.inputValue('#p-ver-dmy')]);

  ok('без помилок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
