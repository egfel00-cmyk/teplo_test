// Замечания владельца 05.11 (32-я сессия): «передано» без «внесено» на карточках, плитка «Налаштування квартири» вместо
// «Додати лічильник», под названием счётчика — особовий рахунок (№ — только в настройках), «Копіювати» в полях и у показаний,
// в карточке записи «Куди передати» свёрнут, «лише для себе» — внизу экрана. Запуск: cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_cards.cjs
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch(); const ctx = await require('./pvopen.cjs').ctx(b, { viewport: { width: 390, height: 844 }, locale: 'uk-UA' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: U.slice(0, -1) });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')));
  const txt = async (sel) => (await p.textContent(sel).catch(() => '')) || '';
  const go = async (r) => { await p.goto(U + '#' + r); await p.waitForTimeout(400); };
  const load = async (s) => { await p.goto(U); await p.evaluate(x => localStorage.setItem('teplo.v1', JSON.stringify(x)), s); await p.goto(U + '#home'); await p.reload(); await p.waitForTimeout(500); };
  const after = async (a, bsel) => p.evaluate(([a, bs]) => { const x = document.querySelector(a), y = document.querySelector(bs); return !!(x && y && (y.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING)); }, [a, bsel]);

  // ---- 1. карточки: передано цього місяця — одна зелена «Передано 1 листопада», без «внесено»
  const s0 = demo({ elec: true });   // сьогодні в демо — 2.11
  s0.water.push({ id: 'wnov', place: 'main', date: '2026-11-01', vals: { h1: '176', c1: '440' }, createdAt: '2026-11-01T10:00:00Z', updatedAt: 1, sent: { vk: '2026-11-01', htm: '2026-11-01' } });
  s0.mrecs.forEach(r => { if (r.date === '2026-10-31') r.sent = { obl: '2026-11-01' }; });
  s0.readings.push({ id: 'rnov', place: 'main', status: 'handed', htm: { date: '2026-11-01', energy: '13.100', volume: '2500', flow: '0.06', power: '1.6', tSupply: '50', tReturn: '30', hours: '36000', errHours: '153', errCode: 'E---' }, createdAt: '2026-11-01T10:00:00Z', updatedAt: 1 });
  await load(s0);
  const hot = await txt('[data-key=card-hot]'), cold = await txt('[data-key=card-cold]'), el = await txt('[data-key=card-elec]'), heat = await txt('[data-key=card-heat]');
  ok('гаряча: «Передано 1 листопада», без «внесено» і без «Передано цього місяця»', /Передано 1 листопада/.test(hot) && !/внесено/i.test(hot) && !/цього місяця/.test(hot), hot);
  ok('холодна: «Передано 1 листопада» зеленим (статус ok), підпис порожній', /Передано 1 листопада/.test(cold) && !!(await p.$('[data-key=card-cold] .ucard-status.ok')) && !(await txt('[data-key=card-cold] .ucard-sub')).trim(), cold);
  ok('світло: передано 31 жовтня (вікно ще відкрите) — «Передано 31 жовтня», без «внесено»', /Передано 31 жовтня/.test(el) && !/внесено/i.test(el), el);
  ok('опалення: передано в ХТМ 1 листопада — «Передано 1 листопада»', /Передано 1 листопада/.test(heat) && !/ваші від/.test(heat), heat);
  // минулого місяця передано — тихим рядком «передано 15 жовтня»
  await load(demo({}));
  ok('передано минулого місяця — «передано 15 жовтня» тихим рядком (не «внесено»)', /передано 15 жовтня/.test(await txt('[data-key=card-hot] .ucard-sub')) && !/внесено/.test(await txt('[data-key=card-hot]')));

  // ---- 2. «Налаштування квартири» замість «Додати лічильник»
  ok('плитка «Налаштування квартири» → #place-main, «Додати лічильник» на головній немає', (await p.getAttribute('[data-key=card-place-set]', 'href')) === '#place-main' && !(await p.$('[data-key=card-add-meter]')) && /прибрати лічильник/.test(await txt('[data-key=card-place-set]')));
  await p.click('[data-key=card-place-set]'); await p.waitForTimeout(400);
  ok('екран квартири: «Додати лічильник», «Прибрати», назад — «Головна»', !!(await p.$('[data-key=pv-add-meter]')) && !!(await p.$('[data-key=pv-remove-h1]')) && (await p.getAttribute('[data-key=pv-back]', 'href')) === '#home');
  ok('екран квартири: у рядках водомірів без №', !/№/.test(await txt('#pg-pv-meters')), await txt('#pg-pv-meters'));

  // ---- 3. сторінка лічильника — без рахунків під назвою, без «Змінити» і без налаштувань (владелец 05.11 20:45–20:46): усе — на екрані квартири
  await go('water-hot');
  const hh = await txt('[data-key=wmeter-h1] .mbox-h');
  ok('гаряча вода: під назвою без рахунку, прізвища й №; без «Змінити»; «Налаштування лічильника» — акордеоном', !/123456|Шевченко|№/.test(hh) && !(await p.$('[data-key=wmeter-h1] [data-act=wedit]')) && !!(await p.$('[data-key=wmeter-h1-set]')), hh);
  ok('біля «Передано 15 жовтня» — «Копіювати» 175', (await p.getAttribute('[data-key=wmeter-h1-copy]', 'data-text')) === '175');
  await go('place-main'); await p.click('[data-key=pv-set-h1] summary'); await p.waitForTimeout(200);
  ok('екран квартири: налаштування водоміра (№, код у боті — з «Копіювати») і рахунок/прізвище Водоканалу', !!(await p.$('[data-key=copy-w-acc]')) && !!(await p.$('[data-key=copy-w-sn]')) && !!(await p.$('[data-key=copy-mbsn-h1]')) && !!(await p.$('[data-key=copy-mbi-h1]')));
  await p.click('[data-key=copy-mbsn-h1]'); await p.waitForTimeout(300);
  ok('«Копіювати» № → у буфері 20123456', (await p.evaluate(() => navigator.clipboard.readText())) === '20123456');
  await p.click('[data-key=copy-w-acc]'); await p.waitForTimeout(300);
  ok('«Копіювати» особовий рахунок → у буфері 123456, тост «Скопійовано»', (await p.evaluate(() => navigator.clipboard.readText())) === '123456' && /Скопійовано/i.test(await txt('#toast-host')));
  // тепло: особовий рахунок ХТМ — у налаштуваннях лічильника на екрані квартири
  await go('heat');
  ok('опалення: заголовок «Опалення», під ним модель, без «Змінити»; налаштування — акордеоном', /Опалення/.test(await txt('[data-key=home-last] .mbox-t b')) && /SHARKY/.test(await txt('[data-key=home-last] .mbox-sub')) && !!(await p.$('[data-key=home-last-set]')));
  await go('place-main'); await p.click('[data-key=pv-set-heat] summary'); await p.waitForTimeout(200);
  await p.fill('#p-hacc', '12345678'); await p.press('#p-hacc', 'Tab'); await p.waitForTimeout(500);
  let s = await st();
  ok('опалення: рахунок ХТМ збережено в квартирі; під назвою на сторінці — не показуємо', s.places[0].meter.account === '12345678', s.places[0].meter);
  if (!(await p.isVisible('[data-key=copy-p-hacc]'))) { await p.click('[data-key=pv-set-heat] summary'); await p.waitForTimeout(200); }
  await p.click('[data-key=copy-p-hacc]'); await p.waitForTimeout(300);
  ok('«Копіювати» рахунок ХТМ → 12345678', (await p.evaluate(() => navigator.clipboard.readText())) === '12345678');
  await go('heat'); ok('сторінка опалення: рахунку під назвою немає', !/12345678/.test(await txt('[data-key=home-last] .mbox-h')));

  // ---- 4. картка запису: «Куди передати» згорнуто, «лише для себе» — внизу, «Копіювати» у кожного показання
  await load(demo({ elec: true }));
  await go('erec-m20261031');
  ok('запис світла: «Куди передати» згорнуто', (await p.$eval('[data-key=where-elec]', d => d.tagName === 'DETAILS' && !d.open)));
  ok('запис світла: «Позначити «лише для себе»» — під «Виправити / Видалити»', await after('[data-key=own-box]', '[data-key=erec-del]'));
  ok('запис світла: «Копіювати» день і ніч', (await p.getAttribute('[data-key=erec-copy-day]', 'data-text')) === '10420' && (await p.getAttribute('[data-key=erec-copy-night]', 'data-text')) === '5225');
  await p.click('[data-key=where-elec-sum]'); await p.waitForTimeout(200);
  ok('відкрили «Куди передати» — видно цифри й бот', await p.isVisible('[data-key=esend-vals]'));
  await go('history'); await go('erec-m20261031');
  ok('повернулись у той самий запис — лишилось відкритим', await p.$eval('[data-key=where-elec]', d => d.open));
  await go('wrec-w20261015');
  ok('запис води: «лише для себе» — внизу, «Копіювати» 175 і 437, без №', await after('[data-key=own-box]', '[data-key=wrec-del]') && (await p.getAttribute('[data-key=wrec-copy-h1]', 'data-text')) === '175' && (await p.getAttribute('[data-key=wrec-copy-c1]', 'data-text')) === '437' && !/№/.test(await txt('[data-key=wrec-values]')));

  // ---- 5. ввід: «Лише для себе — не передавати» — під кнопками, працює
  await go('wnew');
  ok('ввід води: «Лише для себе» — під «Зберегти» і «Скасувати»', await after('#own-chk', '[data-key=wn-save]') && await after('#own-chk', '[data-key=wiz-cancel]'));
  await p.fill('[data-wn=h1]', '178'); await p.fill('[data-wn=c1]', '441'); await p.check('#own-chk'); await p.click('[data-key=wn-save]'); await p.waitForTimeout(500);
  s = await st();
  ok('збережено з позначкою «лише для себе»', s.water.some(r => r.date === '2026-11-02' && r.own && r.vals.h1 === '178'), s.water.slice(-1));
  await go('enew');
  ok('ввід світла: «Лише для себе» — під «Зберегти»', await after('#own-chk', '[data-key=en-save]'));

  // ---- 6. ru и 320 px
  const ru = await require('./pvopen.cjs').ctx(b, { viewport: { width: 320, height: 700 }, locale: 'ru-RU' }); const q = await ru.newPage();
  await q.goto(U); await q.evaluate(x => localStorage.setItem('teplo.v1', JSON.stringify(x)), demo({ elec: true, gas: true, second: true })); await q.goto(U + '#home'); await q.reload(); await q.waitForTimeout(500);
  ok('ru: плитка «Настройки квартиры», 320 px без переполнения', /Настройки квартиры/.test(await q.textContent('[data-key=card-place-set]')) && await q.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await q.goto(U + '#elec'); await q.waitForTimeout(400);
  ok('ru: свет — без счёта под названием, без горизонтальной прокрутки', !/9876543/.test(await q.textContent('[data-key=emeter-e1] .mbox-h')) && await q.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  ok('без помилок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
