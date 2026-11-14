// 144-а: «Свій постачальник» (власник 14.11: гараж — кооперативу на рахунок з призначенням «який гараж і скільки набігло», свій тариф;
// будова — Житлобуду готівкою, без строку) і порожні екрани (історія світла в гаражі казала «показання води»).
// cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_myprov.cjs
const { chromium } = require('playwright');
const demo = require('./demo.cjs');
let pass = 0, fail = 0;
const ok = (name, c, extra) => { if (c) pass++; else fail++; console.log((c ? 'ok   ' : 'FAIL ') + name + (extra !== undefined && !c ? '  ' + JSON.stringify(extra).slice(0, 400) : '')); };
const B = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: B });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  const load = async (opts, route) => {
    await p.goto(B);
    // 145-а: стара сторінка ще може зберегти свій стан пізніше (таймери, довідник) і затерти підставлений — після підстановки запис у ній вимкнено
    await p.evaluate(s => { localStorage.clear(); localStorage.setItem('teplo.v1', JSON.stringify(s)); localStorage.setItem('teplo.cc', JSON.stringify({ v: 1, a: 0, at: new Date().toISOString(), id: 'x' }));
      Storage.prototype.setItem = Storage.prototype.removeItem = Storage.prototype.clear = function () {}; }, demo(opts));
    // 145-а: з тієї ж сторінки зміна хешу малювала маршрут зі старим станом у пам'яті (гараж → #home) — спершу порожня сторінка
    await p.goto('about:blank'); await p.goto(B + '#' + route); await p.waitForTimeout(700);
  };
  const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')));
  const txt = sel => p.$eval(sel, e => e.innerText.replace(/\s+/g, ' ').trim()).catch(() => '');
  const has = sel => p.$(sel).then(Boolean);
  const tap = async sel => {
    try { await p.waitForSelector(sel, { timeout: 8000, state: 'attached' }); }
    catch (e) { console.log('DBG', await p.evaluate(() => location.hash + ' | ' + document.querySelector('main').innerText.slice(0, 300).replace(/\s+/g, ' '))); throw e; }
    await p.click(sel); };   // 145-а: перемальовка після завантаження довідника — дочекатись вузла

  // 1. Порожні екрани: гараж без показань — історія й статистика світла, текст і кнопка одного виду
  await load({ garage: true, atGarage: true }, 'history');
  const eh = await txt('[data-key="es-hist-elec"]');
  ok('історія гаража: «Ще немає показань світла», не «води»', eh.includes('Ще немає показань світла') && !/вод/i.test(eh), eh);
  ok('історія гаража: кнопка «Внести показання світла» (enew)', await p.$eval('[data-key="es-hist-add"]', e => e.getAttribute('data-act') === 'enew' && /світла/.test(e.textContent)).catch(() => false));
  ok('історія гаража: начерк і значок виду', await has('[data-key="es-hist-elec"] .es-ghost .es-row') && await has('[data-key="es-hist-elec"] .es-ico.c-elec'));
  await p.goto(B + '#stats'); await p.waitForTimeout(500);
  const es = await txt('[data-key="es-stats-elec"]');
  ok('статистика гаража: «з’явиться після других показань», стовпці-начерк, кнопка', es.includes('після других показань') && await has('.es-bars i') && await has('[data-key="es-stats-add"]'), es);

  // 2. «Куди передати» Харківобленерго → «Платите комусь іншому? Свій постачальник» → «Кому платите» у налаштуваннях, фокус у «Назва»
  await load({ garage: true, atGarage: true }, 'elec');
  ok('гараж без свого: «Куди передати» є, під ним — «Свій постачальник»', await has('[data-key="where-elec"]') && await has('[data-key="my-link-elec"]'));
  await p.click('#wacc-where-elec > summary'); await p.waitForTimeout(400);
  await p.click('[data-key="my-link-elec"] button'); await p.waitForTimeout(500);
  let s = await st(); const gar = () => s.places.find(x => x.id === 'gar');
  ok('увімкнули свого: prov.elec.own = 1 (як платите — на рахунок, без строку)', gar().prov && gar().prov.elec.own === 1 && gar().prov.elec.how === 'iban' && gar().prov.elec.due === 'none', gar().prov);
  ok('налаштування розгорнуті на «Кому платите», «Свій постачальник» обрано', await p.$eval('#my-elec', f => !!f.closest('details[open]')) && await p.isChecked('[data-key="my-elec-1"]'));
  ok('фокус — у полі «Назва»', await p.evaluate(() => document.activeElement && document.activeElement.id === 'my-elec-name'));
  ok('«Куди передати» зник, замість нього — блок свого постачальника (ще без назви)', !(await has('[data-key="where-elec"]')) && !(await has('.wacc:not(.mypay)')) && await has('[data-key="mypay-elec"]'));
  await p.fill('#my-elec-name', 'ГК «Мотор»'); await p.press('#my-elec-name', 'Tab'); await p.waitForTimeout(400);
  await p.fill('#my-elec-iban', 'ua21 3223 1300 0002 6007 2335 6600 2'); await p.press('#my-elec-iban', 'Tab'); await p.waitForTimeout(400);
  ok('IBAN з опискою — жовта підказка про контрольні цифри', /контрольні цифри/.test(await txt('[data-key="my-iban-warn"]')));
  await p.fill('#my-elec-iban', 'UA213223130000026007233566001'); await p.press('#my-elec-iban', 'Tab'); await p.waitForTimeout(400);
  ok('правильний IBAN: без підказки, у полі — групами по 4', !(await has('[data-key="my-iban-warn"]')) && (await p.inputValue('#my-elec-iban')) === 'UA21 3223 1300 0002 6007 2335 6600 1');
  await p.fill('#my-elec-purpose', 'Гараж № 47: світло'); await p.click('[data-key="my-tok-q"]'); await p.waitForTimeout(150); await p.click('[data-key="my-tok-sum"]'); await p.waitForTimeout(300);
  const pv = await p.inputValue('#my-elec-purpose');
  ok('«Підставити»: {набігло} і {сума} — у курсор, з пробілом', pv === 'Гараж № 47: світло {набігло} {сума}', pv);
  s = await st();
  ok('шаблон збережено одразу', gar().prov.elec.purpose === 'Гараж № 47: світло {набігло} {сума}' && gar().prov.elec.name === 'ГК «Мотор»' && gar().prov.elec.iban === 'UA213223130000026007233566001', gar().prov.elec);
  // 145-а (власник: «не сохраняется кастомный провайдер в счётчике света»): на iPhone дотик кнопки не забирає фокус — `change` нема; набране має лишитись
  await p.evaluate(() => { const el = document.getElementById('my-elec-recip'); el.focus(); el.value = 'ГК «Мотор», голова'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.evaluate(() => { location.hash = '#home'; }); await p.waitForTimeout(400);
  s = await st();
  ok('без blur/change: набране в «Отримувач» збережено при переході на іншу сторінку', gar().prov.elec.recip === 'ГК «Мотор», голова', gar().prov.elec);
  await p.goto(B + '#elec'); await p.waitForTimeout(500);
  await p.evaluate(() => { const el = document.getElementById('my-elec-phone'); el.focus(); el.value = '0501234567'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForTimeout(700); s = await st();
  ok('без blur: за 0,4 с тиші поле збережено саме', gar().prov.elec.phone === '0501234567', gar().prov.elec);
  // 3. готівка й строк «до 25»
  await p.check('[data-key="my-elec-how-cash"]'); await p.waitForTimeout(400);
  ok('готівкою: поле «Кому й де», без IBAN і призначення', await has('#my-elec-cash') && !(await has('#my-elec-iban')) && !(await has('#my-elec-purpose')));
  await p.fill('#my-elec-cash', 'голові кооперативу'); await p.press('#my-elec-cash', 'Tab'); await p.waitForTimeout(300);
  await p.check('[data-key="my-elec-due-till"]'); await p.waitForTimeout(400);
  await p.fill('#my-elec-till', '25'); await p.press('#my-elec-till', 'Tab'); await p.waitForTimeout(500);
  s = await st();
  ok('строк «до 25» збережено', gar().prov.elec.due === 'till' && gar().prov.elec.till === 25 && gar().prov.elec.how === 'cash' && gar().prov.elec.cash === 'голові кооперативу', gar().prov.elec);
  await p.goto(B + '#home'); await p.waitForTimeout(600);
  ok('головна: на картці світла гаража — смужка строку (до 25)', await p.$eval('#hp-gar [data-key="card-elec"]', c => !!c.querySelector('.prd')).catch(() => false));
  await p.goto(B + '#elec'); await p.waitForTimeout(500);
  await p.check('[data-key="my-elec-due-none"]'); await p.waitForTimeout(400);
  await p.goto(B + '#home'); await p.waitForTimeout(600);
  ok('без строку — смужки немає', await p.$eval('#hp-gar [data-key="card-elec"]', c => !c.querySelector('.prd')).catch(() => false));
  // повернути довідник
  await p.goto(B + '#elec'); await p.waitForTimeout(500);
  const sumOpen = await p.$eval('[data-key="emeter-eg"] details.mbox-set', d => d.open).catch(() => false);
  if (!sumOpen) { await p.click('[data-key="emeter-eg"] details.mbox-set > summary'); await p.waitForTimeout(400); }
  await p.check('[data-key="my-elec-0"]'); await p.waitForTimeout(500);
  s = await st();
  ok('повернули довідник: own = 0, реквізити лишились', gar().prov.elec.own === 0 && gar().prov.elec.name === 'ГК «Мотор»' && await has('[data-key="where-elec"]'), gar().prov.elec);

  // 4. Гараж із показаннями й своїм постачальником: «Оплата» з сумою й готовим призначенням, «Оплачено»
  await load({ garage: 'own', atGarage: true }, 'elec');
  ok('свій: «Куди передати» немає', !(await has('[data-key="where-elec"]')));
  // 145-а: «Оплата» — розкривашка, як «Куди передати»: закрита, у шапці назва й сума
  ok('«Оплата» — акордеон wacc, закритий, у шапці «ГК «Мотор»» і 259,20 грн', await p.$eval('[data-key="mypay-eg"]', d => d.tagName === 'DETAILS' && d.classList.contains('wacc') && !d.open).catch(() => false) &&
    /ГК «Мотор».*259,20 грн/.test(await txt('[data-key="mypay-eg-sum"]')), await txt('[data-key="mypay-eg-sum"]'));
  await tap('[data-key="mypay-eg-sum"]'); await p.waitForTimeout(500);
  ok('відкрили: сума в шапці схована (є всередині), унизу «Згорнути»', await p.$eval('[data-key="mypay-eg"]', d => d.open && getComputedStyle(d.querySelector('.mypay-amt')).display === 'none' && !!d.querySelector('.acc-foot')).catch(() => false));
  const pay = await txt('[data-key="mypay-eg"]');
  ok('«Оплата»: назва, 259,20 грн, 60 кВт·год з 30 вересня', /ГК «Мотор»/.test(pay) && /259,20/.test(pay) && /60 кВт·год з 30 вересня/.test(pay), pay);
  const purp = await txt('[data-key="mypay-eg"] [data-key="my-r-purp"] .my-r-v');
  ok('призначення: «Гараж № 47: світло 1250–1310, 60 кВт·год, 259,20 грн, за жовтень 2026»', purp === 'Гараж № 47: світло 1250–1310, 60 кВт·год, 259,20 грн, за жовтень 2026', purp);
  await p.click('[data-key="mypay-eg"] [data-key="my-copy-all"]'); await p.waitForTimeout(300);
  const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  ok('«Скопіювати реквізити»: отримувач, IBAN без пробілів, ЄДРПОУ, призначення, сума', clip.split('\n').length === 5 && clip.includes('UA213223130000026007233566001') && clip.includes('ЄДРПОУ 12345678') && clip.endsWith('259,20 грн'), clip);
  ok('у історії — «Не оплачено»', /Не оплачено/.test(await txt('[data-key="st-gr20261031"]')));
  await p.click('[data-key="mypay-eg"] [data-key="my-paid"]'); await p.waitForTimeout(500);
  s = await st();
  ok('«Оплачено»: sent.obl у записі, суми й призначення вже немає, у історії — «Оплачено»', !!(s.mrecs.find(r => r.id === 'gr20261031').sent || {}).obl && !(await has('[data-key="mypay-eg"]')) && /Оплачено/.test(await txt('[data-key="st-gr20261031"]')));
  // 145-а (власник 06:36: «в счётчике блок куда платить — всегда, как у гос-провайдеров, с именем и раскрывашкой»)
  ok('оплачено — блок постачальника лишається: «ГК «Мотор»» і «Оплачено» в шапці, закритий', /ГК «Мотор».*Оплачено/.test(await txt('[data-key="mypay-elec-sum"]')) && !(await p.$eval('[data-key="mypay-elec"]', d => d.open)), await txt('[data-key="mypay-elec-sum"]'));
  await tap('[data-key="mypay-elec-sum"]'); await p.waitForTimeout(400);
  ok('відкрили: реквізити (IBAN), без суми й призначення', await has('[data-key="mypay-elec"] [data-key="my-r-iban"]') && !(await has('[data-key="mypay-elec"] [data-key="my-sum"]')) && !(await has('[data-key="mypay-elec"] [data-key="my-r-purp"]')));
  await p.goto(B + '#erec-gr20261031'); await p.waitForTimeout(500);
  // 145-а (власник 14.11, скрин: «в історії вже оплачено — блоку куди платити не має бути»)
  ok('оплачений запис: «Оплати» немає, у шапці — чип «Оплачено»', !(await has('[data-key="mypay-rec"]')) && !(await has('.wacc')) && /Оплачено/.test(await txt('[data-key="rec-h"]')), await txt('[data-key="rec-h"]'));
  await p.goto(B + '#erec-gr20261031'); await p.waitForTimeout(300);
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.mrecs.find(r => r.id === 'gr20261031').sent = {}; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.goto('about:blank'); await p.goto(B + '#erec-gr20261031'); await p.waitForTimeout(700);
  ok('неоплачений запис: «Оплата» є, закрита, у шапці сума', /259,20 грн/.test(await txt('[data-key="mypay-rec-sum"]')) && !(await p.$eval('[data-key="mypay-rec"]', d => d.open)));
  // екран квартири: рядок «свій» → «Налаштувати» веде у «Кому платите»
  await p.goto(B + '#place-gar'); await p.waitForTimeout(700);
  await p.click('summary:has-text("Постачальники")'); await p.waitForTimeout(500);
  const row = await txt('[data-key="prov-elec"]');
  ok('екран квартири: «Світло · свій», ГК «Мотор», IBAN, 4,32 грн за кВт·год', /свій/.test(row) && /ГК «Мотор»/.test(row) && /IBAN UA21/.test(row) && /4,32 грн за кВт·год/.test(row), row);
  await p.click('[data-key="prov-my-set-elec"]'); await p.waitForTimeout(700);
  ok('«Налаштувати» → сторінка світла, «Кому платите» розгорнуто', (await p.evaluate(() => location.hash)) === '#elec' && await p.$eval('#my-elec', f => !!f.closest('details[open]')).catch(() => false));

  // 5. Вода свого постачальника (Харків): без «Куди передати», у записі — «Оплата», нагадувань Водоканалу немає
  await load({ second: false }, 'water-cold');
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.places[0].prov = { water: { own: 1, name: 'ОСББ «Сад»', how: 'other', other: 'Касиру ОСББ', due: 'none' } }; s.places[0].updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await p.waitForTimeout(600);
  ok('вода свого: «Куди передати» немає', !(await has('[data-key="where-water"]')));
  await p.goto(B + '#wrec-w20261015'); await p.waitForTimeout(500);
  ok('запис води оплачено (sent.vk) — «Оплати» немає', !(await has('[data-key="mypay-rec"]')));
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.water.find(r => r.id === 'w20261015').sent = {}; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.goto('about:blank'); await p.goto(B + '#wrec-w20261015'); await p.waitForTimeout(700);
  await tap('[data-key="mypay-rec-sum"]'); await p.waitForTimeout(400);
  const wp = await txt('[data-key="mypay-rec"]');
  ok('запис води: «Оплата» ОСББ «Сад», «Інакше: Касиру ОСББ», сума', /ОСББ «Сад»/.test(wp) && /Касиру ОСББ/.test(wp) && /До сплати/.test(wp), wp);

  // 6. 145-а, скрин власника: одні показання, типовий шаблон, «141» у старій «Примітці» — без «…», номер рядком
  await load({ garage: 'own1', atGarage: true }, 'elec');
  await tap('[data-key="mypay-eg-sum"]'); await p.waitForTimeout(500);
  const p1 = await txt('[data-key="mypay-eg"] [data-key="my-r-purp"] .my-r-v');
  ok('перші показання: призначення без «…» — «Гараж № 141: показання 2263, за …»', /^Гараж № 141: показання 2263, за \S+ 2026$/.test(p1) && !p1.includes('…'), p1);
  ok('«Ваш номер 141» — рядком з «Копіювати», голого «141» немає', /Ваш номер 141/.test(await txt('[data-key="my-r-num"]')) && await has('[data-key="my-r-num-copy"]') && !(await has('[data-key="mypay-eg"] .my-note')));
  ok('замість суми — «перші показання, суму порахуємо з наступних»', /суму порахуємо з наступних/.test(await txt('[data-key="my-first"]')) && !(await has('[data-key="mypay-eg"] [data-key="my-sum"]')));
  // налаштування: поле «Ваш номер» з «141», шаблон-приклад і токен «номер»
  const so = await p.$eval('[data-key="emeter-eg"] details.mbox-set', d => d.open).catch(() => false);
  if (!so) { await p.click('[data-key="emeter-eg"] details.mbox-set > summary'); await p.waitForTimeout(400); }
  ok('налаштування: «Ваш номер» = 141, є «+ номер»', (await p.inputValue('#my-elec-num').catch(() => '')) === '141' && await has('[data-key="my-tok-num"]'));
  await p.fill('#my-elec-num', '47'); await p.press('#my-elec-num', 'Tab'); await p.waitForTimeout(400);
  s = await st();
  ok('номер переїхав у num, «Примітка» прибрана', gar().prov.elec.num === '47' && gar().prov.elec.note === undefined, gar().prov.elec);
  ok('«Вийде:» одразу з новим номером', /Гараж № 47: показання 2263/.test(await txt('[data-key="my-ex-elec"]')), await txt('[data-key="my-ex-elec"]'));

  ok('без помилок JS', !errs.length, errs);
  console.log(`\n${pass} ok, ${fail} fail`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
