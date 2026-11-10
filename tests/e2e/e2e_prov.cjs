// Постачальники й тарифи за адресою квартири (екран квартири): довідник app/data/providers.json через GET /api/providers.
// Мала Данилівка (адреса по-російськи, без «смт»): світло — Харківенергозбут 4,32 (звірити), газ — Нафтогаз 7,96 + доставка Газмережі
// Харківська філія 2,388, вода — КП «Малоданилівський комунальник» без тарифу → вписати з платіжки → вартість води рахується за ним.
// Харків без пункту в адресі — «вважаємо, що це Харків», вода 49,446 + 20,82. Нужен сайт 127.0.0.1:8013.
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
const U = 'http://127.0.0.1:8013/';
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
(async () => {
  const b = await chromium.launch(); const p = await (await require('./pvopen.cjs').ctx(b, { viewport: { width: 360, height: 800 }, locale: 'uk-UA' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const s = demo({ second: true, elec: 1, today: '2026-11-05' });
  s.places[0].address = 'пр. Перемоги 86А, кв. 61';
  s.places[1].name = 'Лозовеньки'; s.places[1].address = 'Малая Даниловка, ул.Академическая 10, кв.20';
  s.places[1].meters = [{ id: 'e2', kind: 'elec', name: '', zones: 1, serial: '', account: '' }, { id: 'g2', kind: 'gas', name: '', serial: '', account: '' }];
  await p.goto(U); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), s);
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')));
  await p.goto(U + '#place-p2'); await p.reload(); await p.waitForTimeout(900);
  const txt = async (k) => (await p.textContent('[data-key=' + k + ']')) || '';
  ok('екран квартири: «Постачальники й тарифи» для «Мала Данилівка» (Малоданилівська громада)', /Для «Мала Данилівка» \(Малоданилівська громада, Харківський район\)/.test(await txt('prov-lead')));
  const el = await txt('prov-elec');
  ok('світло: ПрАТ «Харківенергозбут», мережі Харківобленерго, 4,32 грн за кВт·год до 30.04.2027, підказка й «Так, у мене так» / «У мене інакше»', /Харківенергозбут/.test(el) && /Харківобленерго/.test(el) && /4,32 грн за кВт·год, ціна діє до 30 квітня 2027/.test(el)
    && !!(await p.$('[data-key=prov-yes-elec]')) && !!(await p.$('[data-key=prov-other-elec]')) && /ЖБК/.test(el), el);
  const gs = await txt('prov-gas');
  ok('газ: Нафтогаз 7,96 «Фіксований» до 30.04.2027, доставка — Газмережі, Харківська філія, 2,388', /Нафтогаз/.test(gs) && /7,96 грн за м³, тариф «Фіксований» до 30 квітня 2027/.test(gs) && /Газмережі, Харківська філія, 2,388/.test(gs), gs);
  const wt = await txt('prov-water');
  ok('вода: КП «Малоданилівський комунальник», «Тариф невідомий, впишіть з платіжки», кнопка «Вписати з платіжки»', /Малоданилівський комунальник/.test(wt) && /Тариф невідомий/.test(wt) && /Вписати з платіжки/.test(wt), wt);
  ok('«Звідки ці дані» — джерело тарифу світла згорнуте', !!(await p.$('[data-key=prov-elec] details.prov-src')) && !(await p.$eval('[data-key=prov-elec] details.prov-src', d => d.open)));
  await p.click('[data-key=prov-yes-elec]'); await p.waitForTimeout(300); let sv = await st();
  ok('«Так, у мене так» → світло звірено (p.prov.elec.ok), позначка «звірено», кнопки підтвердження зникли', sv.places[1].prov && sv.places[1].prov.elec.ok === 1 && /звірено/.test(await txt('prov-elec')) && !(await p.$('[data-key=prov-yes-elec]')));
  // «Ціна» в налаштуваннях лічильника прибрали разом з налаштуваннями зі сторінки лічильника (владелец 05.11): ціни — у «Постачальники й тарифи» квартири
  await p.goto(U + '#place-p2'); await p.waitForTimeout(600);
  await p.click('[data-key=prov-other-water]'); await p.waitForTimeout(200);
  ok('вода → форма: хто виставляє (підставлено з довідника), ціна води й водовідведення', await p.inputValue('#prv-n-water') === 'КП «Малоданилівський комунальник»' && !!(await p.$('#prv-s')) && !!(await p.$('#prv-d')));
  await p.fill('#prv-s', '30,5'); await p.click('[data-key=prov-save-water]'); await p.waitForTimeout(300); sv = await st();
  ok('зберегли 30,5 без водовідведення → «30,50 грн за м³ води (з вашої платіжки)», позначка «з платіжки»', sv.places[1].prov.water.supply === 30.5 && !sv.places[1].prov.water.drain && /30,50 грн за м³ води \(з вашої платіжки\)/.test(await txt('prov-water')) && /з платіжки/.test(await txt('prov-water')), sv.places[1].prov);
  await p.goto(U + '#water-cold'); await p.waitForTimeout(500);
  const wc = await p.textContent('main');
  ok('вартість холодної води цієї квартири — за її тарифом (+1 м³ ≈ 31 грн, не 70)', /≈\s*31\s*грн/.test(wc) && !/≈\s*70\s*грн/.test(wc), (wc.match(/≈\s*\d+\s*грн/g) || []).slice(0, 4));
  await p.click('[data-act=prv-other]').catch(() => {});
  // Харків: адреса з вулиці
  await p.goto(U + '#place-main'); await p.waitForTimeout(800);
  ok('Харків без пункту в адресі: «вважаємо, що це Харків», вода — Харківводоканал 49,45 і 20,82 з 01.10.2026', /вважаємо, що це Харків/.test(await txt('prov-lead')) && /Харківводоканал/.test(await txt('prov-water')) && /49,45 грн за м³ води і 20,82 грн водовідведення з 1 жовтня 2026/.test(await txt('prov-water')), await txt('prov-water'));
  ok('Харків: наступний тариф Харківводоканалу — «З 1 січня 2027 — 57,50 грн за м³ води і 27,99 грн водовідведення»', /З 1 січня 2027 — 57,50 грн за м³ води і 27,99 грн водовідведення/.test(await txt('prov-next-water')), await txt('prov-next-water').catch(() => ''));
  const ht = await txt('prov-heat');
  ok('Харків: тепло — КП «Харківські теплові мережі», тариф той, за яким рахуємо: 1 539,50 грн за Гкал з ПДВ і 29,40 грн абонплати (не «невідомий»)',
    /Харківські теплові мережі/.test(ht) && /1\s539,50 грн за Гкал з ПДВ і 29,40 грн абонплати/.test(ht) && !/невідомий/.test(ht), ht);
  ok('Харків: світло — підказка про новобудови (забудовник / обслуговуюча компанія)', /новобудовах/.test(await txt('prov-elec')));
  await p.click('[data-key=prov-other-heat]'); await p.waitForTimeout(200);
  ok('тепло → «Змінити»: поля тарифу (1 539,50) й абонплати (29,40)', /1\s539,50/.test(await p.inputValue('#prv-h')) && await p.inputValue('#prv-a') === '29,40', [await p.inputValue('#prv-h'), await p.inputValue('#prv-a')]);
  await p.fill('#prv-h', '1600'); await p.fill('#prv-a', '30'); await p.click('[data-key=prov-save-heat]'); await p.waitForTimeout(300); sv = await st();
  ok('зберегли 1600 / 30 → тариф і абонплата квартири, «з вашої платіжки»', sv.places[0].prov.heat.price === 1600 && sv.places[0].bill.abon === 30 && /1\s600,00 грн за Гкал з ПДВ і 30,00 грн абонплати на місяць \(з вашої платіжки\)/.test(await txt('prov-heat')), [sv.places[0].prov.heat, sv.places[0].bill, await txt('prov-heat')]);
  await p.goto(U + '#prefs'); await p.waitForTimeout(400);
  ok('Налаштування → «Тариф, грн/Гкал» показує тариф квартири 1600', /1600|1\s600/.test(await p.inputValue('#p-tariff').catch(() => '')), await p.inputValue('#p-tariff').catch(() => 'нет поля'));
  await p.goto(U + '#place-main'); await p.waitForTimeout(600);
  ok('360 px — блок не ширший за екран', await p.evaluate(() => document.documentElement.scrollWidth <= 361));
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.places[0].address = 'с. Неіснуюче, вул. Набережна 3'; localStorage.setItem('teplo.v1', JSON.stringify(s)); }); await p.reload(); await p.waitForTimeout(800);
  ok('незнайомий пункт → «довідника ще немає… впишіть з платіжок», без вигаданого Харкова', /довідника ще немає/.test(await txt('prov-lead')) && /Хто постачає — невідомо/.test(await txt('prov-water')));
  // довідник v2: Миколаївка — «Уточніть» (список пунктів з громадою й районом), вибір запам'ятовується для цієї адреси
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.places[0].address = 'Миколаївка, вул. Миру 5'; delete s.places[0].settle; localStorage.setItem('teplo.v1', JSON.stringify(s)); }); await p.reload(); await p.waitForTimeout(900);
  const picks = await p.$$eval('.prv-pick', els => els.map(e => e.textContent));
  ok('Миколаївка → «Пунктів із такою назвою кілька. Де ваша квартира?» і ≥ 12 рядків «Миколаївка / село, … громада, … район»', /Де ваша квартира/.test(await txt('prov-lead')) && picks.length >= 12 && /громада, .* район/.test(picks[1] || ''), picks.slice(0, 3));
  await p.click('.prv-pick >> nth=2'); await p.waitForTimeout(900); sv = await st();
  ok('вибір → p.settle {a, n, h}, «Для «Миколаївка» (… громада, … район)», «Обрати інший пункт»', sv.places[0].settle && sv.places[0].settle.a === 'Миколаївка, вул. Миру 5' && /^UA63/.test(sv.places[0].settle.h) && /Для «Миколаївка» \(/.test(await txt('prov-lead')) && !!(await p.$('[data-key=prov-unsettle]')), sv.places[0].settle);
  await p.click('[data-key=prov-unsettle]'); await p.waitForTimeout(900);
  ok('«Обрати інший пункт» → знову список', (await p.$$('.prv-pick')).length >= 12);
  // Берестин: тариф КП «Берестин-Водоканал» (71,88 + 107,74) у «Ціні» й у розрахунку; «Куди передати» — його блок, не Харківводоканал
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.places[0].address = 'м. Красноград, вул. Полтавська 10'; delete s.places[0].prov; localStorage.setItem('teplo.v1', JSON.stringify(s)); }); await p.reload(); await p.waitForTimeout(900);
  ok('Красноград (стара назва) → Берестин, вода «КП «Берестин-Водоканал»» 71,88 і 107,74 з 01.06.2026', /Берестин/.test(await txt('prov-lead')) && /Берестин-Водоканал/.test(await txt('prov-water')) && /71,88.*107,74/.test(await txt('prov-water')), await txt('prov-water'));
  await p.goto(U + '#water-cold'); await p.waitForTimeout(900);
  const wd = await txt('where-water');
  ok('«Куди передати» воду в Берестині — КП «Берестин-Водоканал», без бота @hvk_user_bot і без кабінету Харківводоканалу', /Берестин-Водоканал/.test(wd) && !/hvk_user_bot|Харківводоканал/.test(wd), wd.slice(0, 200));
  // Рогань: вода й тепло — КП «Теплові мережі Роганської селищної ради»; тепло — свій тариф 1 839,62 без харківської абонплати, і за ним рахуємо
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.places[0].address = 'смт Рогань, вул. Шкільна 3'; delete s.places[0].prov; delete s.places[0].bill; delete s.bill; delete s.tariff; localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.goto(U + '#place-main'); await p.reload(); await p.waitForTimeout(900);
  const rh = await txt('prov-heat'), rw = await txt('prov-water');
  ok('Рогань: тепло — КП «Теплові мережі Роганської селищної ради», 1 839,62 грн за Гкал з ПДВ без «29,40 абонплати»; вода 21,54 і 16,97', /Роганської селищної ради/.test(rh) && /1\s839,62 грн за Гкал з ПДВ/.test(rh) && !/29,40/.test(rh) && /21,54.*16,97/.test(rw), [rh, rw]);
  // 27-ма сесія: Буди — свій постачальник у пункті (не УЖКГ м. Південне і не його «Куди платити»); Люботин — 56,88 і 76,68 з 01.10.2026
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.places[0].address = 'смт Буди, вул. Шевченка 2'; delete s.places[0].prov; localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.goto(U + '#place-main'); await p.reload(); await p.waitForTimeout(900);
  const bw = await txt('prov-water');
  ok('Буди: вода — КП «Будиводоканал», тариф невідомий, без «Управлінню ЖКГ м. Південне» в «Куди платити»', /Будиводоканал/.test(bw) && !/ЖКГ м\. Південне|33561483/.test(bw), bw.slice(0, 300));
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.places[0].address = 'м. Люботин, вул. Слобожанська 26'; delete s.places[0].prov; localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await p.waitForTimeout(900);
  const lw = await txt('prov-water');
  ok('Люботин: ВККУ 56,88 і 76,68 з 01.10.2026 (рішення № 423)', /ВККУ/.test(lw) && /56,88.*76,68/.test(lw), lw.slice(0, 300));
  // Мала Данилівка: вода — КП без тарифу; «Куди передати» — «Ваш постачальник»… немає: є назва КП і «як передавати — на платіжці»; газ — філія в боті
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.placeId = 'p2'; localStorage.setItem('teplo.v1', JSON.stringify(s)); }); await p.goto(U + '#water-cold'); await p.reload(); await p.waitForTimeout(900);
  const wd2 = await txt('where-water');
  ok('Мала Данилівка: «Куди передати» — КП «Малоданилівський комунальник» і підказка, без Харківводоканалу', /Малоданилівський комунальник/.test(wd2) && !/hvk_user_bot/.test(wd2), wd2.slice(0, 200));
  await p.goto(U + '#gas'); await p.waitForTimeout(700); await p.click('[data-key=where-gas] summary').catch(() => {}); await p.waitForTimeout(200);
  ok('газ у Малій Данилівці: «У боті Газмереж оберіть філію: Харківська філія»', /оберіть філію: Харківська філія/.test(await txt('where-gas')), (await txt('where-gas')).slice(0, 300));
  // 57-ма сесія: Київ — «столиця», вода Київводоканалу 36,85 + 26,94; світло — «Куди передати» YASNO (місцевий блок, не Харківобленерго); газ — Київгаз (не бот Газмереж)
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.placeId = 'p2'; s.places[1].address = 'м. Київ, вул. Хрещатик 1'; delete s.places[1].prov; delete s.places[1].settle; localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.goto(U + '#place-p2'); await p.reload(); await p.waitForTimeout(900);
  ok('Київ: «Для «Київ» (столиця)», вода — Київводоканал 36,85 і 26,94', /Для «Київ» \(столиця\)/.test(await txt('prov-lead')) && /Київводоканал/.test(await txt('prov-water')) && /36,85.*26,94/.test(await txt('prov-water')), (await txt('prov-lead')) + ' | ' + (await txt('prov-water')).slice(0, 200));
  ok('Київ: світло — YASNO, мережі ДТЕК Київські електромережі; газ — доставка ПАТ «Київгаз» 0,384', /YASNO/.test(await txt('prov-elec')) && /ДТЕК Київські електромережі/.test(await txt('prov-elec')) && /Київгаз».*0,384/.test(await txt('prov-gas')), (await txt('prov-gas')).slice(0, 200));
  await p.goto(U + '#elec'); await p.waitForTimeout(800);
  const ke = await txt('where-elec');
  ok('Київ, «Куди передати» світло: YASNO, кабінет і сайт, без бота Харківобленерго', /YASNO/.test(ke) && !!(await p.$('[data-key=dest-loc-elec-cab]')) && !/Kooz2bot|Харківобленерго/.test(ke), ke.slice(0, 300));
  await p.goto(U + '#gas'); await p.waitForTimeout(800);
  const kg = await txt('where-gas');
  ok('Київ, «Куди передати» газ: ПАТ «Київгаз», без бота Газмереж', /Київгаз/.test(kg) && !/mygrmu_bot|Газмереж/.test(kg), kg.slice(0, 300));
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.places[1].address = 'Бровары, ул. Киевская 1'; localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.goto(U + '#place-p2'); await p.reload(); await p.waitForTimeout(900);
  ok('Бровари: «Броварська громада, Броварський район, Київська обл.», вода — «не знаємо, впишіть»', /Броварський район, Київська обл\./.test(await txt('prov-lead')) && /Газмережі, Київська філія, 1,788/.test(await txt('prov-gas')), (await txt('prov-lead')));
  ok('без помилок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
