// Постачальники й тарифи за адресою квартири (екран квартири): довідник app/data/providers.json через GET /api/providers.
// Мала Данилівка (адреса по-російськи, без «смт»): світло — Харківенергозбут 4,32 (звірити), газ — Нафтогаз 7,96 + доставка Газмережі
// Харківська філія 2,388, вода — КП «Малоданилівський комунальник» без тарифу → вписати з платіжки → вартість води рахується за ним.
// Харків без пункту в адресі — «вважаємо, що це Харків», вода 49,446 + 20,82. Нужен сайт 127.0.0.1:8013.
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
const U = 'http://127.0.0.1:8013/';
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 360, height: 800 }, locale: 'uk-UA' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const s = demo({ second: true, elec: 1, today: '2026-11-05' });
  s.places[0].address = 'пр. Перемоги 86А, кв. 61';
  s.places[1].name = 'Лозовеньки'; s.places[1].address = 'Малая Даниловка, ул.Академическая 10, кв.20';
  s.places[1].meters = [{ id: 'e2', kind: 'elec', name: '', zones: 1, serial: '', account: '' }, { id: 'g2', kind: 'gas', name: '', serial: '', account: '' }];
  await p.goto(U); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), s);
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')));
  await p.goto(U + '#place-p2'); await p.reload(); await p.waitForTimeout(900);
  const txt = async (k) => (await p.textContent('[data-key=' + k + ']')) || '';
  ok('екран квартири: «Постачальники й тарифи» для «Мала Данилівка» (Малоданилівська селищна громада)', /Для «Мала Данилівка» \(Малоданилівська селищна громада\)/.test(await txt('prov-lead')));
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
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.places[0].address = 'Пісочин, вул. Набережна 3'; localStorage.setItem('teplo.v1', JSON.stringify(s)); }); await p.reload(); await p.waitForTimeout(800);
  ok('незнайомий пункт → «довідника ще немає… впишіть з платіжок», без вигаданого Харкова', /довідника ще немає/.test(await txt('prov-lead')) && /Хто постачає — невідомо/.test(await txt('prov-water')));
  ok('без помилок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
