// Первый вход (#welcome → #start → «Готово»): квартира «Моя квартира», 5 видов с образцами табло; 155-а — лічильники одразу, без анкет:
// головна з «Внести перші показання», зони світла — при перших показаннях, тепло — карткою «Налаштувати опалення»; черга анкет — лише в
// майстрі «+ Квартира»; вход на новом устройстве, вошедший без счётчиков.
// node e2e_first.cjs  (локальный сервер 127.0.0.1:8013)
const { chromium } = require('playwright');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch(); const ctx = await require('./pvopen.cjs').ctx(b, { viewport: { width: 360, height: 800 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  const hash = () => p.evaluate(() => location.hash);
  const fresh = async () => { await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.goto(U + '#'); await p.reload(); await p.waitForTimeout(500); };
  // 1. привітання
  await fresh();
  ok('привітання-лендинг: 4 табло на сцені, 3 кроки, 6 карток можливостей (графіки вимкнено, «Ціни вашої громади» — 90-а, «Передати у фоні» — 106-а), панель приладу з гвинтами, заклик угорі й унизу', (await p.$$('[data-key=welcome-hero] figure')).length === 4 && !!(await p.$('[data-key=welcome-hero] .lcd:not(.elcd)')) && !!(await p.$('[data-key=welcome-hero] .wdrum')) && !!(await p.$('[data-key=welcome-hero] .elcd')) && !!(await p.$('[data-key=welcome-hero] .gdrum')) && (await p.$$('.lp-step')).length === 3 && (await p.$$('.lp-cell')).length === 6 && (await p.$$('[data-key=lp-hero] .lp-screw')).length === 4 && (await p.$$('[data-key=welcome-start], [data-key=welcome-start-end]')).length === 2);
  // 106-а (власник 11.11): «Передати у фоні — одним дотиком» — кнопка з «Куди передати» і стрічка постачальників (сервер: лише готові — /api/config → auto; без пошти e-mail-ботів немає)
  { const bg = await p.$eval('[data-key=lp-bg]', c => ({ btn: !!c.querySelector('.lpb-btn'), chips: [...c.querySelectorAll('.lpb-chips:not([aria-hidden]) li span')].map(x => x.textContent), on: (c.querySelector('.lpb-on') || {}).textContent || '' }));
    const auto = (await p.evaluate(() => fetch('/api/config').then(r => r.json()))).auto || [];
    ok('«Передати у фоні»: кнопка «Відправити у фоні», ХТМ і Бровари в стрічці; Львівобленерго — лише коли сервер його підтримує (пошта), «Уже працює з N»', bg.btn && bg.chips.includes('Харківські теплові мережі') && bg.chips.includes('Броваритепловодоенергія')
      && bg.chips.includes('Львівобленерго') === auto.includes('loe') && bg.chips.includes('Міськтепловоденергія') === auto.includes('mtve') && new RegExp('Уже працює з ' + bg.chips.length + ' ').test(bg.on), [bg, auto]); }
  ok('сцена-картинка — ссылка на #start, не в порядке Tab', await p.$eval('[data-key=welcome-hero]', a => a.tagName === 'A' && a.getAttribute('href') === '#start' && a.tabIndex === -1));
  await p.click('[data-key=welcome-hero] .lp-phone', { force: true }); await p.waitForTimeout(400);
  ok('нажатие на картинку → #start', (await hash()) === '#start');
  await fresh();
  // 111-а: картки й стрічку постачальників приймали за кнопки — уся площа веде на «Почати», «Нагадування в Telegram» — у бота; не в порядку Tab
  const go = await p.$$eval('.lp-go', a => a.map(x => [x.getAttribute('data-key'), x.getAttribute('href'), x.tabIndex, x.getAttribute('aria-hidden')]));
  ok('лендинг: «.lp-go» на 6 картках і стрічці, «Нагадування в Telegram» → t.me/…?start=remind, решта → #start, tabindex -1', go.length === 7 && go.every(g => g[2] === -1 && g[3] === 'true') &&
    go.find(g => g[0] === 'lp-tg-go')[1].startsWith('https://t.me/') && go.filter(g => g[0] !== 'lp-tg-go').every(g => g[1] === '#start'), go);
  await p.click('[data-key=lp-dest] .lp-chips li', { force: true }); await p.waitForTimeout(400);
  ok('натискання на стрічку постачальників → #start', (await hash()) === '#start');
  await fresh();
  await p.click('[data-key=lp-due] .lp-due', { force: true }); await p.waitForTimeout(400);
  ok('натискання на картку «Строки» → #start', (await hash()) === '#start');
  await fresh();
  const wtxt = await p.textContent('.welcome');
  ok('у тексті — світло й газ, «з фото», кілька квартир, «лише для себе»', /Світло,/.test(wtxt) && /газ/.test(wtxt) && /З фото/.test(wtxt) && /Кілька квартир/.test(wtxt) && /лише для себе/.test(wtxt));
  await p.click('[data-key=welcome-start]'); await p.waitForTimeout(400);
  ok('«Почати» → #start: 5 видів з образцями табло + вивіз сміття (115-а)', (await hash()) === '#start' && (await p.$$('.aw-kind .kprev')).length === 6 && /Які лічильники є у вашій квартирі/.test(await p.textContent('h1')));
  ok('підказка про інші квартири («+ Квартира»)', /\+ Квартира/.test(await p.textContent('[data-key=fs-more]')));
  ok('без води — один крок, без «Крок 1 з …»', !(await p.$('.wiz-top')) && /^Готово$/.test((await p.textContent('[data-key=aw-create]')).trim()));
  await p.click('[data-key=aw-create]'); await p.waitForTimeout(300);
  ok('нічого не позначили → попередження, лишаємось', (await hash()) === '#start' && /хоча б один/.test(await p.textContent('[data-key=aw-err]')));
  // 2. вибір: тепло, гаряча ×1, холодна ×1, світло
  // 155-а: торкнулися самої картки (не «+») — лічильник позначено (1), повторний дотик не прибирає й не додає
  await p.click('[data-key=aw-gas] .aw-kt'); await p.waitForTimeout(150); await p.click('[data-key=aw-gas] .aw-kt'); await p.waitForTimeout(150);
  ok('дотик до картки газу → 1, попередження зникло; ще дотик — так само 1', (await p.textContent('[data-key=aw-gas-n]')).trim() === '1' && !(await p.$('[data-key=aw-err]')));
  await p.click('[data-key=aw-gas-dec]'); await p.waitForTimeout(150);
  ok('«−» → «немає», «−» тепер неактивний', /немає/.test(await p.textContent('[data-key=aw-gas-n]')) && await p.$eval('[data-key=aw-gas-dec]', e => e.disabled));
  for (const k of ['heat', 'hot', 'cold', 'elec']) { await p.click('[data-key=aw-' + k + '-inc]'); await p.waitForTimeout(120); }
  // 160-а (журнал 15.11: обрав 3 лічильники й пішов — «Готово» було двома екранами нижче): ряд кнопок прилипає до низу екрана
  { const g = await p.evaluate(() => { const r = document.querySelector('[data-key=aw-create]').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight, sw: document.documentElement.scrollWidth, vw: innerWidth, y: scrollY }; });
    ok('«Готово» видно без прокрутки вниз (wiz-stick), сторінка не ширша за екран', g.top >= 0 && g.bottom <= g.vh && g.sw <= g.vw, g); }
  ok('попередження зникло, тепла більше 1 не буває',!(await p.$('[data-key=aw-err]')) && await p.$eval('[data-key=aw-heat-inc]', e => e.disabled));
  // 114-а (власник 11.11): при першому вході рахунків не питаємо — вибрав лічильники й одразу вносить показання; рахунок — перед передачею
  ok('з водою — теж один крок: без «Крок 1 з …», «Готово», поля рахунку Водоканалу немає', !(await p.$('.wiz-top')) && !(await p.$('[data-key=aw-next]')) && !(await p.$('#aw-acc')) && /^Готово$/.test((await p.textContent('[data-key=aw-create]')).trim()));
  await p.click('[data-key=aw-create]'); await p.waitForTimeout(400);
  let s = await st();
  ok('квартира одна, рахунок Водоканалу порожній', s.places.length === 1 && !((s.places[0].water || {}).account), s.places);
  // 155-а (журнал: на першій анкеті черги йшла майже половина): «Готово» — лічильники створено одразу, без анкет; головна з картками
  ok('«Готово» → одразу головна, тост «Лічильники налаштовано», черги немає', (await hash()) === '#home' && /Лічильники налаштовано/.test(await p.textContent('#toast-host')) &&
    !(await p.$('[data-key=aw-queue]')) && (await p.evaluate(() => sessionStorage.getItem('teplo.pq'))) === null, await hash());
  const pm0 = s.places[0];
  ok('створено: світло (1 зона, зони спитаємо при перших показаннях), гаряча, холодна; onboarded; тепло — позначено (heatAsk), моделі ще немає',
    s.onboarded === true && (pm0.meters || []).filter(m => m.kind === 'elec' && m.zones === 1 && m.zAsk).length === 1 && pm0.water.meters.filter(m => m.kind === 'hot').length === 1 &&
    pm0.water.meters.filter(m => m.kind === 'cold').length === 1 && pm0.heatAsk === 1 && !pm0.meter && !(s.mrecs || []).length && !(s.water || []).length, pm0);
  const firsts = await p.$$eval('.ucard-first', a => a.map(x => x.getAttribute('data-key')));
  ok('на кожній картці — «Внести перші показання», у тепла — «Налаштувати опалення»', ['card-elec-first', 'card-hot-first', 'card-cold-first', 'card-heat-first'].every(k => firsts.includes(k)) &&
    /Налаштувати опалення/.test(await p.textContent('[data-key=card-heat-first]')) && /Внести перші показання/.test(await p.textContent('[data-key=card-hot-first]')), firsts);
  // перші показання світла: скільки зон — тут
  await p.click('[data-key=card-elec-first]'); await p.waitForTimeout(500);
  const eid = pm0.meters.find(m => m.kind === 'elec').id;
  ok('«Внести перші» світла → #enew з питанням «Скільки зон на табло?» (Одна — обрано)', (await hash()) === '#enew' && /Скільки зон/.test(await p.textContent('[data-key=en-zask-' + eid + ']')) &&
    await p.$eval('[data-key=en-z1-' + eid + ']', e => e.checked), await hash());
  await p.fill('[data-en="' + eid + '|all"]', '777'); await p.click('[data-key=en-z2-' + eid + ']'); await p.waitForTimeout(300);
  ok('«День і ніч» → поля День і Ніч, вписане до зміни зон не переноситься', !!(await p.$('[data-en="' + eid + '|day"]')) && !!(await p.$('[data-en="' + eid + '|night"]')) &&
    (await p.inputValue('[data-en="' + eid + '|day"]')) === '' && (await st()).places[0].meters.find(m => m.id === eid).zones === 2);
  await p.fill('[data-en="' + eid + '|day"]', '10530'); await p.fill('[data-en="' + eid + '|night"]', '5290'); await p.click('[data-key=en-save]'); await p.waitForTimeout(500); s = await st();
  ok('збережено день/ніч, питання про зони більше не з’являється', (s.mrecs || []).some(r => r.meter === eid && !r.base && r.z.day === '10530' && r.z.night === '5290') &&
    !s.places[0].meters.find(m => m.id === eid).zAsk, s.places[0].meters);
  await p.goto(U + '#enew'); await p.waitForTimeout(400);
  ok('наступне внесення світла — без питання про зони, з підказкою «Зони йдуть по черзі»', !(await p.$('.en-zask')) && /Зони йдуть по черзі/.test(await p.textContent('[data-key=en-' + eid + ']')));
  // тепло з картки: вибір моделі, «Опалення немає» — прибирає картку
  await p.goto(U + '#home'); await p.waitForTimeout(400); await p.click('[data-key=card-heat-first]'); await p.waitForTimeout(400);
  ok('«Налаштувати опалення» → #meter, є «Опалення немає — прибрати з головної»', (await hash()) === '#meter' && !!(await p.$('[data-key=meter-noheat]')));
  await p.click('input[name=model] >> nth=0'); await p.waitForTimeout(300);
  await p.click('[data-key=meter-save]'); await p.waitForTimeout(400);
  ok('модель обрано → «Останні прийняті» (#baseline)', (await hash()) === '#baseline', await hash());
  await p.click('[data-act=skip-base]'); await p.waitForTimeout(400); s = await st();
  ok('після тепла — головна з 4 картками, heatAsk знято', (await hash()) === '#home' && !!(await p.$('[data-key=card-heat]')) && !!(await p.$('[data-key=card-hot]')) && !!(await p.$('[data-key=card-cold]')) &&
    !!(await p.$('[data-key=card-elec]')) && !s.places[0].heatAsk && !!s.places[0].meter, await hash());
  ok('на головній — «Моя квартира» і «+ Квартира»', /Моя квартира/.test(await p.textContent('[data-key=home-place-name]')) && !!(await p.$('[data-key=home-add-place]')));
  await p.goto(U + '#start'); await p.waitForTimeout(300);
  ok('#start після налаштування → головна', (await hash()) === '#home' || /home/.test(await p.getAttribute('main', 'data-screen') || '') || !(await p.$('.aw-kinds')));

  // 3. лише газ — одразу головна з карткою газу
  await fresh(); await p.goto(U + '#start'); await p.waitForTimeout(300);
  await p.click('[data-key=aw-gas-inc]'); await p.click('[data-key=aw-create]'); await p.waitForTimeout(500); s = await st();
  ok('лише газ → головна з карткою газу і «Внести перші показання», тост «Лічильники налаштовано»', (await hash()) === '#home' && !!(await p.$('[data-key=card-gas-first]')) &&
    /Лічильники налаштовано/.test(await p.textContent('#toast-host')) && (s.places[0].meters || []).filter(m => m.kind === 'gas').length === 1, await p.textContent('#toast-host'));

  // 4. два водоміри гарячої — «1» і «2»; лише тепло — як і було, одразу вибір моделі
  await fresh(); await p.goto(U + '#start'); await p.waitForTimeout(300);
  await p.click('[data-key=aw-hot-inc]'); await p.click('[data-key=aw-hot-inc]'); await p.click('[data-key=aw-create]'); await p.waitForTimeout(500); s = await st();
  ok('гаряча ×2 → водоміри «1» і «2», головна', s.onboarded === true && (await hash()) === '#home' && s.places[0].water.meters.map(m => m.name).join(',') === '1,2');
  await fresh(); await p.goto(U + '#start'); await p.waitForTimeout(300);
  await p.click('[data-key=aw-heat-inc]'); await p.click('[data-key=aw-create]'); await p.waitForTimeout(500);
  ok('лише тепло → #meter «1 з 1», без «Опалення немає» (тут не картка)', (await hash()) === '#meter' && /1\sз\s1/.test(await p.textContent('[data-key=aw-queue]')) && !(await p.$('[data-key=meter-noheat]')));
  // тепло позначено разом зі світлом, а насправді немає — «Опалення немає» прибирає картку
  await fresh(); await p.goto(U + '#start'); await p.waitForTimeout(300);
  await p.click('[data-key=aw-elec-inc]'); await p.click('[data-key=aw-heat-inc]'); await p.click('[data-key=aw-create]'); await p.waitForTimeout(500);
  await p.click('[data-key=card-heat-add]'); await p.waitForTimeout(400); await p.click('[data-key=meter-noheat]'); await p.waitForTimeout(400); s = await st();
  ok('«Опалення немає» → головна без картки тепла, heatAsk знято', (await hash()) === '#home' && !(await p.$('[data-key=card-heat]')) && !!(await p.$('[data-key=card-elec]')) && !s.places[0].heatAsk);

  // 4б. черга анкет лишилась у майстрі «+ Квартира» (не перший вхід), як у гостей 14EK/1EII (iPhone 440 px): «Налаштую пізніше», № свёрнуто, кнопка без прокрутки
  const pq = await (await require('./pvopen.cjs').ctx(b, { viewport: { width: 440, height: 956 }, locale: 'uk-UA' })).newPage(); pq.on('pageerror', e => errs.push(e.message));
  const pst = async () => JSON.parse(await pq.evaluate(() => localStorage.getItem('teplo.v1')) || '{}'), ph = () => pq.evaluate(() => location.hash);
  await pq.goto(U); await pq.evaluate(() => localStorage.clear()); await pq.goto(U + '#start'); await pq.waitForTimeout(500);
  await pq.click('[data-key=aw-cold-inc]'); await pq.click('[data-key=aw-create]'); await pq.waitForTimeout(500);
  await pq.goto(U + '#add-place'); await pq.waitForTimeout(400); await pq.fill('#aw-name', 'Мамина'); await pq.click('[data-key=aw-next]'); await pq.waitForTimeout(300);
  await pq.click('[data-key=aw-elec-inc]'); await pq.click('[data-key=aw-gas-inc]'); await pq.click('[data-key=aw-cold-inc]');
  await pq.click('[data-key=aw-create]'); await pq.waitForTimeout(400);
  // 147-а: черга в порядку видів — світло, холодна, газ
  ok('нова квартира, світло в черзі: «Налаштую пізніше», № згорнуто, рахунку немає (114-а — перед передачею)', (await ph()) === '#eadd' && !!(await pq.$('[data-key=aw-q-later]')) && !!(await pq.$('details.ea-more:not([open])')) && !(await pq.$('#ea-acc')));
  await pq.evaluate(() => document.querySelector('[data-key=ea-save]').scrollIntoView({ block: 'end' })); await pq.waitForTimeout(400);
  ok('«Відгук» сховано, поки кнопки форми на екрані', await pq.evaluate(() => getComputedStyle(document.querySelector('[data-key=feedback]')).visibility === 'hidden'));
  await pq.click('[data-key=ea-more] summary'); await pq.fill('#ea-serial', 'НІК-77'); await pq.click('[data-key=ea-z2]'); await pq.waitForTimeout(300);
  ok('зміна зон: розгорнуте лишається, № на місці', !!(await pq.$('details.ea-more[open]')) && (await pq.inputValue('#ea-serial')) === 'НІК-77');
  await pq.click('[data-key=aw-q-later]'); await pq.waitForTimeout(400); s = await pst();
  const mam = s.places.find(x => x.name === 'Мамина'), qel = (mam.meters || []).find(m => m.kind === 'elec');
  ok('водомір у черзі (після світла): № і повірка згорнуті', (await ph()) === '#wadd' && !!(await pq.$('details.wa-more:not([open]) #wa-serial')));
  await pq.click('[data-key=wa-save]'); await pq.waitForTimeout(400);
  ok('«пізніше» у світла: лічильник з 1 зоною без рахунку → газ «3 з 3» (теж згорнуто)', qel && qel.zones === 1 && !qel.account && (await ph()) === '#gadd' && /3\sз\s3/.test(await pq.textContent('[data-key=aw-queue]')) && !!(await pq.$('details.ea-more:not([open]) #ea-serial')));
  await pq.click('[data-key=aw-q-later]'); await pq.waitForTimeout(500); s = await pst();
  ok('«пізніше» у газу → головна «Мамина» з 3 картками', (await ph()) === '#home' && !!(await pq.$('[data-key=card-gas]')) && !!(await pq.$('[data-key=card-elec]')) && !!(await pq.$('[data-key=card-cold]')));
  await pq.goto(U + '#place-main'); await pq.waitForTimeout(400); await pq.click('[data-key=pv-add-meter]'); await pq.waitForTimeout(300); await pq.click('[data-key=am-elec]'); await pq.waitForTimeout(300);
  ok('світло не з черги: теж лише показання, № — згорнуто, рахунку немає, без «пізніше»', (await ph()) === '#eadd' && !!(await pq.$('details.ea-more:not([open])')) && !(await pq.$('#ea-acc')) && !(await pq.$('[data-key=aw-q-later]')));

  // 5. рос. мова
  const pr = await (await require('./pvopen.cjs').ctx(b, { viewport: { width: 360, height: 800 }, locale: 'ru-RU' })).newPage();
  await pr.goto(U); await pr.evaluate(() => localStorage.clear()); await pr.reload(); await pr.waitForTimeout(500);
  ok('ru: «Показания счётчиков — за минуту»', /Показания счётчиков — за минуту/.test(await pr.textContent('h1')));
  await pr.goto(U + '#start'); await pr.waitForTimeout(300);
  ok('ru: «Какие счётчики есть в вашей квартире?»', /Какие счётчики есть/.test(await pr.textContent('h1')));

  // 6. вхід: новий акаунт без лічильників → «Ви увійшли — налаштуймо…» → вибір (раніше вів на модель теплолічильника)
  const pl = await (await require('./pvopen.cjs').ctx(b, { viewport: { width: 360, height: 800 }, locale: 'uk-UA' })).newPage();
  const email = 'first' + Date.now() + '@example.ua', pwd = 'first test 123';
  await pl.goto(U); await pl.evaluate(() => localStorage.clear()); await pl.reload(); await pl.waitForTimeout(500);
  await pl.click('[data-key=welcome-login]'); await pl.waitForTimeout(300);
  await pl.click('[data-key=login-toggle]'); await pl.waitForTimeout(200);
  await pl.fill('#a-email', email); await pl.fill('#a-pass', pwd); await pl.click('[data-key=login-submit]'); await pl.waitForTimeout(1200);
  ok('реєстрація без лічильників → вибір лічильників (#start)', (await pl.evaluate(() => location.hash)) === '#start' && !!(await pl.$('.aw-kinds')), await pl.evaluate(() => location.hash));
  await pl.goto(U + '#welcome'); await pl.reload(); await pl.waitForTimeout(800);
  ok('вошедший без лічильників: «Ви увійшли — налаштуймо ваші лічильники» (не «Новий водомір»)', /налаштуймо ваші лічильники/.test(await pl.textContent('h1')) && /Обрати лічильники/.test(await pl.textContent('[data-key=welcome-start]')), await pl.textContent('h1'));

  ok('без помилок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
