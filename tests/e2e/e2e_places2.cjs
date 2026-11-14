// Несколько квартир, этап 2: главная-список квартир со статусами, мастер «Додати квартиру» (3 шага, +/−, «Перевірте»),
// настройка счётчиков новой квартиры по очереди, «Усі квартири», выключатель напоминаний у квартиры, ?go=…&place=…,
// «схоже на показання квартири X». Локальный сервер 127.0.0.1:8013. Запуск: cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_places2.cjs
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, i) => { console.log((c ? '  OK  ' : ' FAIL ') + n + (!c && i !== undefined ? '  → ' + JSON.stringify(i) : '')); c ? pass++ : fail++; };
(async () => {
  const b = await chromium.launch(); const ctx = await require('./pvopen.cjs').ctx(b, { viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')));
  const hash = () => p.evaluate(() => location.hash);
  const go = async (r) => { await p.goto('http://127.0.0.1:8013/#' + r); await p.waitForTimeout(350); };
  const click = async (sel, w) => { await p.click(sel); await p.waitForTimeout(w || 300); };
  await p.goto('http://127.0.0.1:8013/'); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo({}));
  await p.reload(); await p.waitForTimeout(400);
  let s;
  ok('одна квартира: старт — счётчики (#home), «Головна» → #home', !!(await p.$('.ucard')) && (await p.getAttribute('[data-key=nav-home]', 'href')) === '#home');

  // ---- мастер: из настроек → 3 шага
  await go('prefs'); await click('#pg-places summary', 200); await click('[data-key=prefs-place-add]');
  ok('«Додати квартиру» → мастер, крок 1 з 2', (await hash()) === '#add-place' && /1/.test(await p.textContent('.wiz-top .count')) && /2/.test(await p.textContent('.wiz-top .count')));
  await click('[data-act=aw-chip][data-v="Батьків"]', 200);
  ok('кнопка назви вписує назву', (await p.inputValue('#aw-name')) === 'Батьків');
  await p.fill('#aw-street', 'Пушкінська 5, кв. 2'); await click('[data-key=aw-next]');
  ok('крок 2: світло й газ — з кнопками «+»/«−», «скоро» немає', (await p.$$('.aw-kind.am-soon')).length === 0 && !!(await p.$('[data-key=aw-elec-inc]')) && !!(await p.$('[data-key=aw-gas-inc]')));
  ok('крок 2 (без води) — останній: «Перевірте» і «Створити»', !!(await p.$('[data-key=aw-sum]')) && !!(await p.$('[data-key=aw-create]')));
  ok('«−» вимкнено на нулі', await p.$eval('[data-key=aw-hot-dec]', e => e.disabled));
  await click('[data-key=aw-cold-inc]', 200); await click('[data-key=aw-cold-inc]', 200); await click('[data-key=aw-hot-inc]', 200);
  // 114-а (власник 11.11): рахунку Водоканалу в мастері немає — і з водою лише 2 кроки; «Перевірте» — на кроці вибору
  ok('з водою — так само 2 кроки, «Перевірте» з лічильниками й «Створити»', /2/.test(await p.textContent('.wiz-top .count')) && !(await p.$('.wiz-top .count').then(e => e.textContent()).then(x => /3/.test(x))) && !!(await p.$('[data-key=aw-sum]')) && !(await p.$('#aw-acc')) && !(await p.$('[data-key=aw-skip]')));
  ok('кількість на екрані: гаряча 1, холодна 2', (await p.textContent('[data-key=aw-hot-n]')).trim() === '1' && (await p.textContent('[data-key=aw-cold-n]')).trim() === '2');
  await click('[data-key=aw-heat-inc]', 200);
  ok('опалення: максимум 1 — «+» вимкнено', await p.$eval('[data-key=aw-heat-inc]', e => e.disabled));
  await click('[data-key=aw-back]', 200);
  ok('назад на крок 1 — назва й адреса на місці', (await p.inputValue('#aw-name')) === 'Батьків' && (await p.inputValue('#aw-street')) === 'Пушкінська 5, кв. 2');
  await click('[data-key=aw-next]', 200);
  const sum = await p.textContent('[data-key=aw-sum]');
  ok('«Перевірте» повторює суть: назва, адреса, лічильники; рядка рахунку немає', /Батьків/.test(sum) && /Пушкінська/.test(sum) && /Опалення/.test(sum) && /Холодна вода ×2/.test(sum) && !/рахунок/i.test(sum), sum);
  await click('[data-key=aw-create]', 400);
  s = await st(); const np = s.places.find(x => x.name === 'Батьків');
  ok('квартиру створено: назва, адреса, без рахунку, відкрита саме вона', np && /(^|, )Пушкінська 5, кв\. 2$/.test(np.address) && !np.water.account && s.placeId === np.id, np);
  ok('далі — водомір 1 з 4 (гаряча), плашка з назвою квартири', (await hash()) === '#wadd' && /1\sз\s4/.test(await p.textContent('[data-key=aw-queue]')) && /Батьків/.test(await p.textContent('[data-key=aw-queue]')) && /гаряч/i.test(await p.textContent('h1')));
  ok('рахунок у водомірі не питаємо (114-а — перед передачею)', !(await p.$('#wa-form #w-acc')));
  await p.fill('#wa-val', '12'); await click('[data-key=wa-save]', 400);
  ok('→ водомір 2 з 4 (холодна)', (await hash()) === '#wadd' && /2\sз\s4/.test(await p.textContent('[data-key=aw-queue]')) && /холодн/i.test(await p.textContent('h1')));
  await click('[data-key=aw-q-later]', 400);
  ok('«Налаштую пізніше» → 3 з 4 (друга холодна, просимо назву)', /3\sз\s4/.test(await p.textContent('[data-key=aw-queue]')) && !!(await p.$('#wa-name')));
  await click('[data-key=wa-save]', 200);
  ok('друга холодна без назви — помилка', (await p.textContent('#wa-err')).length > 5);
  await p.fill('#wa-name', 'ванна'); if (await p.$('#wa-name0')) await p.fill('#wa-name0', 'кухня'); await click('[data-key=wa-save]', 400);
  ok('→ теплолічильник 4 з 4: вибір моделі', (await hash()) === '#meter' && /4\sз\s4/.test(await p.textContent('[data-key=aw-queue]')));
  s = await st(); let q = s.places.find(x => x.id === np.id);
  ok('водоміри: гаряча (12 на старті), 2 холодних', q.water.meters.length === 3 && q.water.meters.filter(m => m.kind === 'cold').length === 2 && s.water.some(r => r.place === np.id && r.base && Object.values(r.vals).includes('12')), q.water.meters);
  await go('home');
  ok('пішли з налаштування — черга скинута, головна квартири без тепла', !(await p.$('[data-key=home-pl-' + np.id + '] [data-key=card-heat]')) && !!(await p.$('[data-key=home-pl-' + np.id + '] [data-key=card-cold]')) && !!(await p.$('[data-key=home-pl-' + np.id + '] [data-key=card-hot]')));

  // ---- главная: аккордеон квартир (≥ 2)
  ok('дві квартири: «Головна» і логотип → #home', (await p.getAttribute('[data-key=nav-home]', 'href')) === '#home' && (await p.getAttribute('[data-key=brand]', 'href')) === '#home');
  await go('water-cold');
  ok('шапка квартири: «Усі квартири» → #home', (await p.getAttribute('[data-key=place-bar-all]', 'href')) === '#home' && /Усі квартири/.test(await p.textContent('[data-key=place-bar-all]')));
  // історія / статистика / економія: чия — видно кнопками з назвами квартир, перемикається тут же
  await go('history');
  const psw = async () => p.$$eval('[data-key=place-switch] button', bs => bs.map(b => [b.textContent.trim(), b.getAttribute('aria-pressed')]));
  const h0 = await psw();
  ok('історія: «Квартира:» і обидві квартири кнопками, натиснута поточна (Батьків), без «Усі квартири»', h0.length === 2 && h0.some(x => /Батьків/.test(x[0]) && x[1] === 'true') && h0.some(x => /Моя квартира/.test(x[0]) && x[1] === 'false') && !(await p.$('[data-key=place-bar]')), h0);
  await p.click('[data-key=place-sw-' + s.places[0].id + ']'); await p.waitForTimeout(300);
  ok('натиснули «Моя квартира» — історія її (є опалення), квартира перемкнулась', (await st()).placeId === s.places[0].id && (await hash()) === '#history' && (await psw()).some(x => /Моя квартира/.test(x[0]) && x[1] === 'true'));
  await go('stats'); const h1 = await psw();
  ok('статистика — той самий перемикач, вибрана «Моя квартира»', h1.length === 2 && h1.some(x => /Моя квартира/.test(x[0]) && x[1] === 'true'), h1);
  await p.click('[data-key=place-sw-' + np.id + ']'); await p.waitForTimeout(300);
  await p.goto('http://127.0.0.1:8013/'); await p.waitForTimeout(500);
  ok('відкрили застосунок без адреси — головна з двома квартирами', (await p.$$('details.pacc')).length === 2 && !!(await p.$('[data-screen=S01]')));
  const c1 = await p.textContent('[data-key=home-pl-' + s.places[0].id + '] summary'), c2 = await p.textContent('[data-key=home-pl-' + np.id + '] summary');
  ok('секція першої: «Моя квартира», без переліку лічильників (строки — лише за 4 дні до кінця)', /Моя квартира/.test(c1) && !/Опалення|Гаряча/.test(c1), c1);
  ok('секція «Батьків»: адреса; до 20-го ще далеко — строку не показуємо', /Пушкінська/.test(c2) && !/Холодна вода/.test(c2), c2);
  { const s0 = JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1'))), back = s0.demoToday; s0.demoToday = '2026-11-17'; await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), s0); await p.reload(); await p.waitForTimeout(500);
    const c3 = await p.textContent('[data-key=home-pl-sum-' + s0.places[1].id + ']');
    ok('за 3 дні до 20-го — тихий рядок «Холодна вода ×2: передати до 20 листопада, ще 3 дн.»', /Холодна вода ×2: передати до 20 листопада, ще 3 дн\./.test(c3), c3);
    s0.demoToday = back; await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), s0); await p.reload(); await p.waitForTimeout(400); }
  ok('відкрита секція поточної квартири, у ній її картки', await p.$eval('[data-key=home-pl-' + np.id + ']', e => e.open) && !!(await p.$('[data-key=home-pl-' + np.id + '] [data-key=card-cold]')));
  await p.click('[data-key=home-pl-sum-' + s.places[0].id + ']'); await p.waitForTimeout(200);
  ok('розгорнули першу — там тепло; стан запам’ятовано', !!(await p.$('[data-key=home-pl-' + s.places[0].id + '] [data-key=card-heat]')) && (await st()).homeOpen[s.places[0].id] === true);
  await click('[data-key=home-pl-' + s.places[0].id + '] [data-key=card-heat-add]', 400);
  s = await st();
  ok('«+» у секції першої → її квартира, введення тепла', s.placeId === s.places[0].id && /#step-0/.test(await hash()));
  ok('nav «Головна» підсвічена на головній', await (async () => { await go('home'); return (await p.getAttribute('[data-key=nav-home]', 'aria-current')) === 'page'; })());

  // ---- напоминания: выключатель у квартиры
  await go('place-' + np.id);
  ok('на екрані квартири — «Нагадувати про цю квартиру» (увімкнено)', await p.$eval('#pv-remind', e => e.checked));
  await p.click('#pv-remind'); await p.waitForTimeout(300); s = await st();
  ok('вимкнули — place.remindOff = true', s.places.find(x => x.id === np.id).remindOff === true);
  await p.click('#pv-remind'); await p.waitForTimeout(300); s = await st();
  ok('увімкнули — remindOff прибрано', !s.places.find(x => x.id === np.id).remindOff);

  // ---- кнопка из бота: ?go=wnew&place=<id>
  await go('place-' + s.places[0].id);
  await p.goto('http://127.0.0.1:8013/?go=wnew&place=' + np.id); await p.waitForTimeout(600); s = await st();
  ok('?go=wnew&place=… → відкрита та квартира і введення води', s.placeId === np.id && (await hash()) === '#wnew' && /Батьків/.test(await p.textContent('[data-key=place-bar]')));
  ok('параметри прибрано з адреси', !/go=|place=/.test(await p.evaluate(() => location.search)));

  // ---- «схоже на показання квартири X»: в «Батьків» вписали число гарячого водоміра першої квартири (175 → 176)
  const hotId = s.places.find(x => x.id === np.id).water.meters.find(m => m.kind === 'hot').id;
  await p.fill('#wn-' + hotId, '176'); await p.press('#wn-' + hotId, 'Tab'); await p.waitForTimeout(250);
  const wh = await p.textContent('#wh-' + hotId);
  ok('гаряча 176 у «Батьків» (там 12) → «схоже на квартиру «Моя квартира»»', /Схоже на показання квартири/.test(wh) && /Моя квартира/.test(wh), wh);
  await p.fill('#wn-' + hotId, '13'); await p.press('#wn-' + hotId, 'Tab'); await p.waitForTimeout(250);
  ok('13 (звичайний розхід) — без попередження', !/Схоже на показання/.test(await p.textContent('#wh-' + hotId)));

  // тепло: у «Батьків» теплолічильник (останні прийняті 20,000), а вписали 13,2 — це схоже на першу квартиру (12,910)
  await p.evaluate((pid) => { const s = JSON.parse(localStorage.getItem('teplo.v1')); const q = s.places.find(x => x.id === pid);
    q.meter = Object.assign({}, s.places[0].meter); q.baseline = { date: '2026-10-10', energy: '20.000' }; s.placeId = pid; s.meter = q.meter; s.baseline = q.baseline;
    s.draft = { date: s.demoToday || new Date().toISOString().slice(0, 10), values: { energy: '13.2' }, step: 3 }; localStorage.setItem('teplo.v1', JSON.stringify(s)); }, np.id);
  await p.reload(); await p.waitForTimeout(300); await go('check');
  const ck = await p.textContent('#main');
  ok('тепло 13,2 у «Батьків» (там 20) → перевірка: «схоже на теплолічильник квартири «Моя квартира»»', /Схоже на показання теплолічильника квартири «Моя квартира»/.test(ck) && /Батьків/.test(ck), ck.slice(0, 400));

  // ---- один порядок видів у всіх квартирах (147-а, власник 14.11: світло, вода, газ, тепло): у «Здаю» холодну й газ додали раніше за гарячу й світло
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1'));
    s.places.push({ id: 'pz', v: 2, name: 'Здаю', address: 'Харків, вул. Сумська, 10, кв. 5', color: 'rose', meter: { modelId: 'sharky774', unit: 'Gcal' }, baseline: { date: '2026-10-01', energy: '1.000' }, updatedAt: 1,
      water: { account: '', surname: '', meters: [{ id: 'zc', kind: 'cold', name: '', serial: '' }, { id: 'zh', kind: 'hot', name: '', serial: '' }] },
      meters: [{ id: 'zg', kind: 'gas', name: '', serial: '' }, { id: 'ze', kind: 'elec', name: '', zones: 1, serial: '' }] });
    localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await p.waitForTimeout(300); await go('home');
  await p.evaluate(() => document.querySelectorAll('details.hp').forEach(d => { d.open = true; })); await p.waitForTimeout(150);
  const zk = await p.$$eval('#hp-pz .ucard', es => es.map(e => e.getAttribute('data-key').replace('card-', '')));
  const ord = ['elec', 'hot', 'cold', 'gas', 'heat'], sorted = a => a.every((x, i) => !i || ord.indexOf(a[i - 1]) <= ord.indexOf(x));
  ok('головна «Здаю»: світло, гаряча, холодна, газ, опалення — як в інших квартирах', JSON.stringify(zk) === JSON.stringify(ord), zk);
  await go('place-pz'); await p.waitForTimeout(900);
  const zm = await p.$$eval('#pg-pv-meters .mrow-main b', es => es.map(e => e.textContent));
  ok('екран квартири: лічильники в тому ж порядку', /Світло/.test(zm[0]) && /Гаряча/.test(zm[1]) && /Холодна/.test(zm[2]) && /Газ/.test(zm[3]) && /Опалення/.test(zm[4]), zm);
  const zp = await p.$$eval('.prov-row', es => es.map(e => e.getAttribute('data-key').replace('prov-', '')));
  ok('«Постачальники й тарифи»: світло, вода, газ, опалення (вивіз сміття — серед лічильників, 115-а)', JSON.stringify(zp.filter(x => x !== 'waste')) === JSON.stringify(['elec', 'water', 'gas', 'heat']), zp);
  ok('дані з платіжки — під своїм постачальником: світло, вода, газ, опалення', JSON.stringify(await p.$$eval('#pg-pv-prov [data-key^=pv-bills-]', es => es.map(e => e.getAttribute('data-key').slice(9)))) === JSON.stringify(['elec', 'water', 'gas', 'heat']));
  await go('history'); await p.click('[data-act=place-view][data-id=pz]').catch(() => {}); await p.waitForTimeout(300);
  const zs = await p.$$eval('[data-key=kind-switch] button', es => es.map(e => e.getAttribute('data-v')));
  ok('історія: перемикач видів у тому ж порядку', sorted(zs) && zs.length >= 2, zs);

  ok('без ошибок JS', errs.length === 0, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
