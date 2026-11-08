// Несколько квартир, этап 1 (новая квартира — через мастер этапа 2, см. e2e_places2.cjs): вторая квартира только с водой, добавить/прибрати/повернути/замінити лічильник, шапка квартиры,
// рахунки по квартире, удаление квартиры. Локальный сервер 127.0.0.1:8013. Запуск: cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_places.cjs
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, i) => { console.log((c ? '  OK  ' : ' FAIL ') + n + (!c && i !== undefined ? '  → ' + JSON.stringify(i) : '')); c ? pass++ : fail++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')));
  // на главной при ≥ 2 квартирах — секции-аккордеон: ищем внутри секции текущей квартиры
  const inCur = async (sel) => { const s0 = JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1'))); return (s0.places || []).filter(x => !x.deleted).length > 1 ? '[data-key=home-pl-' + s0.placeId + '] ' + sel : sel; };
  const go = async (r) => { await p.goto('http://127.0.0.1:8013/#' + r); await p.waitForTimeout(350); };
  // «Додати лічильник» — на экране квартиры: главная → плитка «Налаштування квартири» → «Додати лічильник»
  const addMeter = async () => { await p.click(await inCur('[data-key=card-place-set]')); await p.waitForTimeout(300); await p.click('[data-key=pv-add-meter]'); await p.waitForTimeout(250); };
  await p.goto('http://127.0.0.1:8013/'); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), Object.assign(demo({}), { bill: { abon: 30, mzk: 0.0126 } }));
  // старое хранение: адрес в name → name пустое, адрес в address
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.places[0].name = 'Сумська 10, кв. 61'; delete s.places[0].v; localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await go('home');
  let s;
  ok('одна квартира — шапки нет, 3 карточки + «Налаштування квартири» (вместо «Додати лічильник»)', !(await p.$('[data-key=place-bar]')) && (await p.$$('.ucard')).length === 3 && !(await p.$('[data-key=card-add-meter]')) && (await p.getAttribute('[data-key=card-place-set]', 'href')) === '#place-main');

  // добавить квартиру: настройки → квартиры → «Додати квартиру» → экран новой квартиры
  // (этап 2: «Додати квартиру» — мастер; здесь — пустая квартира без названия: «Далі» → «Створити», дальше — её экран)
  await go('prefs'); await p.click('#pg-places summary'); await p.click('[data-key=prefs-place-add]'); await p.waitForTimeout(350);
  await p.click('[data-key=aw-next]'); await p.waitForTimeout(250); await p.click('[data-key=aw-create]'); await p.waitForTimeout(350);
  await go('place-' + (await st()).placeId);
  ok('новая квартира → её экран с подсказкой', /^#place-p/.test(await p.evaluate(() => location.hash)) && !!(await p.$('[data-key=pv-new]')));
  await p.click('[data-act=pv-chip][data-v="Батьків"]'); await p.waitForTimeout(200);
  await p.fill('#pv-street', 'Пушкінська 5, кв. 2'); await p.waitForTimeout(100);
  s = await st(); const p2 = s.places.find(x => x.id === s.placeId);
  ok('миграция: адрес из name → address', s.places[0].address === 'Сумська 10, кв. 61' && s.places[0].name === '' && s.places[0].v === 2, s.places[0]);
  ok('название кнопкой, адрес полем, цвет — не как у первой', p2.name === 'Батьків' && /(^|, )Пушкінська 5, кв\. 2$/.test(p2.address) && p2.color && p2.color !== 'teal', p2);
  ok('шапка квартиры не на экране квартиры, h1 = название', (await p.textContent('h1')).includes('Батьків'));
  // «Додати лічильник» → холодна → форма нового водомера
  await p.click('[data-key=pv-add-meter]'); await p.waitForTimeout(300);
  ok('выбор: світло и газ — можно (этап 3), «скоро» больше нет', (await p.$$('.am-soon')).length === 0 && !!(await p.$('[data-key=am-elec][data-act=am-pick]')) && !!(await p.$('[data-key=am-gas][data-act=am-pick]')));
  ok('на выборе — компактная шапка «Квартира: Батьків»', (await p.textContent('[data-key=place-bar]')).includes('Батьків'));
  await p.click('[data-key=am-cold]'); await p.waitForTimeout(300);
  ok('форма водомера: рахунку ще немає — поля рахунку', !!(await p.$('#wa-form #w-acc')));
  await p.fill('#wa-val', '215,5x'); await p.click('[data-key=wa-save]'); await p.waitForTimeout(200);
  ok('кривые цифры — ошибка, не сохраняем', (await p.textContent('#wa-err')).length > 5 && (await st()).places.find(x => x.id === p2.id).water.meters.length === 0);
  await p.fill('#wa-val', '215,5'); await p.fill('#wa-serial', '1100220'); await p.click('[data-key=wa-save]'); await p.waitForTimeout(400);
  s = await st(); let q = s.places.find(x => x.id === p2.id), cm = q.water.meters[0];
  ok('водомір додано + стартові показання 215.5', cm && cm.kind === 'cold' && cm.serial === '1100220' && s.water.some(r => r.place === p2.id && r.base && r.vals[cm.id] === '215.5'), { cm, w: s.water.filter(r => r.place === p2.id) });
  ok('назад — на экран квартиры', (await p.evaluate(() => location.hash)) === '#place-' + p2.id);
  await go('home');
  const sec2 = '[data-key=home-pl-' + p2.id + '] ';
  ok('главная: секция второй квартиры открыта — только «Холодна» + «Налаштування квартири»', (await p.$$(sec2 + '.ucard')).length === 1 && !!(await p.$(sec2 + '[data-key=card-cold]')) && !(await p.$(sec2 + '[data-key=card-heat]')) && !!(await p.$(sec2 + '[data-key=card-place-set]')) && !(await p.$(sec2 + '[data-key=home-pl-set-' + p2.id + ']')));
  await go('water-cold');
  ok('шапка: «Батьків», адрес, «Інша квартира»', /Батьків/.test(await p.textContent('[data-key=place-bar]')) && /Пушкінська/.test(await p.textContent('[data-key=place-bar]')) && !!(await p.$('[data-key=place-bar-all]')));
  await go('heat');
  ok('#heat в квартире без тепла → главная (и адрес #home)', (await p.evaluate(() => location.hash)) === '#home' && !!(await p.$('[data-key=card-cold]')));
  // второй холодный — нужна назва; первый можно назвать тут же
  await addMeter(); await p.click('[data-key=am-cold]'); await p.waitForTimeout(300);
  await p.click('[data-key=wa-save]'); await p.waitForTimeout(150);
  ok('второй холодный без назви — просим назвать', (await p.textContent('#wa-err')).length > 5);
  await p.fill('#wa-name', 'ванна'); await p.fill('#wa-name0', 'кухня'); await p.click('[data-key=wa-save]'); await p.waitForTimeout(400);
  s = await st(); q = s.places.find(x => x.id === p2.id);
  ok('два холодных: «кухня» и «ванна»', q.water.meters.map(m => m.name).join() === 'кухня,ванна', q.water.meters);
  ok('после добавления из налаштувань квартири — назад туда', (await p.evaluate(() => location.hash)) === '#place-' + p2.id);
  await go('water-cold');
  // ввод воды — тост с названием квартиры
  await p.click('[data-key=water-add]'); await p.waitForTimeout(300);
  const ids = q.water.meters.map(m => m.id);
  await p.fill('#wn-' + ids[0], '217'); await p.fill('#wn-' + ids[1], '3'); await p.click('[data-key=wn-save]'); await p.waitForTimeout(250);
  ok('после ввода — «Збережено… · Батьків»', /Батьків/.test(await p.textContent('#toast-host')));

  // прибрати «ванна» (без показань? есть одна запись) → в архив; история остаётся
  await go('place-' + p2.id);
  await p.click('[data-key=pv-remove-' + ids[1] + ']'); await p.waitForTimeout(300);
  s = await st(); q = s.places.find(x => x.id === p2.id);
  ok('прибрати з показаннями → removed (архив), не deleted', !!q.water.meters[1].removed && !q.water.meters[1].deleted);
  ok('на экране квартиры — «Прибрані раніше» и «Повернути»', !!(await p.$('[data-key=pv-restore-' + ids[1] + ']')));
  await go('wnew');
  ok('ввод: прибраного водоміра немає', !(await p.$('#wn-' + ids[1])) && !!(await p.$('#wn-' + ids[0])));
  await go('history');
  ok('история: запись с «ванна» осталась', /ванна 3|ванна&nbsp;3/.test(await p.innerHTML('[data-key=water-history-cold]')), await p.innerText('[data-key=water-history-cold]'));
  await go('place-' + p2.id); await p.click('[data-key=pv-restore-' + ids[1] + ']'); await p.waitForTimeout(250);
  s = await st(); ok('повернути — снова в квартире', !s.places.find(x => x.id === p2.id).water.meters[1].removed);
  // «Замінити» → форма «лічильник знімали» с заменой
  await p.click('[data-key=pv-replace-' + ids[0] + ']'); await p.waitForTimeout(300);
  ok('замінити → форма з причиною «заміна» і новим лічильником', (await p.evaluate(() => location.hash)) === '#gap-new-' + ids[0] && await p.isChecked('input[name=gp-reason][value=replace]') && await p.isChecked('#gp-fresh'));
  await go('home'); await go('gap-new-' + ids[0]);
  ok('обычный «лічильник знімали» — без заготовки', await p.isChecked('input[name=gp-reason][value=repair]'));

  // другая квартира: «Інша квартира» → список → первая
  await go('water-cold'); await p.click('[data-key=place-bar-all]'); await p.waitForTimeout(250);
  ok('«Усі квартири» → главная с двумя секциями', (await p.$$('details.pacc')).length === 2 && (await p.evaluate(() => location.hash)) === '#home');
  await p.click('[data-key=home-pl-sum-main]'); await p.waitForTimeout(200); await p.click('[data-key=home-pl-main] [data-key=card-heat] .ucard-main'); await p.waitForTimeout(300);
  ok('карточка в секции первой → её тепло: шапка с адресом', (await st()).placeId === 'main' && (await p.$$('[data-key=home-last]')).length === 1 && /Сумська 10/.test(await p.textContent('[data-key=place-bar]')));
  // рахунки — свои: в первой квартире правим абонплату, у второй — своя по умолчанию
  await go('place-main'); await p.fill('#p-abon', '45,5'); await p.waitForTimeout(150);
  s = await st();
  ok('абонплата пишется в квартиру', s.places.find(x => x.id === 'main').bill.abon === 45.5 && s.bill.abon === 30, { pb: s.places[0].bill, b: s.bill });
  // прибрати опалення (є показання) → главная без тепла, история тепла осталась
  await p.click('[data-key=pv-remove-heat]'); await p.waitForTimeout(300);
  s = await st();
  ok('опалення прибрано: meter.removed, показания на месте', !!s.places.find(x => x.id === 'main').meter.removed && s.readings.length === 4);
  await go('home');
  ok('главная без карточки тепла', !(await p.$(await inCur('[data-key=card-heat]'))) && (await p.$$(await inCur('.ucard'))).length === 2);
  await go('history');
  ok('история: вкладка «Опалення» осталась (есть показания)', !!(await p.$('[data-key=kind-heat]')));
  await go('home'); await addMeter(); await p.click('[data-key=am-restore-heat]'); await p.waitForTimeout(300);
  s = await st(); await go('home'); ok('повернули опалення из выбора', !s.places.find(x => x.id === 'main').meter.removed && !!(await p.$(await inCur('[data-key=card-heat]'))));

  // удалить вторую квартиру — с её названием в вопросе
  await go('place-' + p2.id); await p.click('[data-key=pv-del]'); await p.waitForTimeout(150);
  ok('вопрос с названием квартиры', /Батьків/.test(await p.textContent('#pl-del-confirm')));
  await p.click('[data-key=pv-del-yes]'); await p.waitForTimeout(350);
  s = await st();
  ok('удалена; осталась одна — шапки нет', s.places.find(x => x.id === p2.id).deleted && s.placeId === 'main' && !(await p.$('[data-key=place-bar]')));
  ok('после удаления текущая — первая с её теплом', !!s.meter && s.meter.modelId === 'sharky774');
  if (errs.length) ok('ошибок JS нет', false, errs);
  console.log(`\nИтог: ${pass} OK, ${fail} FAIL`); await b.close(); process.exit(fail ? 1 : 0);
})();
