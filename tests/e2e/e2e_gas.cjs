// Газ (этап 3): додати лічильник, внести (літри, «менше»), «Куди передати» — готове SMS 4647 «рахунок пробіл 5 цифр», кабінет
// Газмереж, «Я передав(ла)», історія/статистика/економія, своя ціна, котел, мастер квартиры. Сервер 127.0.0.1:8013.
// Запуск: cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_gas.cjs
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, i) => { console.log((c ? '  OK  ' : ' FAIL ') + n + (!c && i !== undefined ? '  → ' + JSON.stringify(i) : '')); c ? pass++ : fail++; };
(async () => {
  const b = await chromium.launch(); const ctx = await require('./pvopen.cjs').ctx(b, { viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')));
  const hash = () => p.evaluate(() => location.hash);
  // настройки счётчика на его странице свёрнуты в блоке «прибора» — в тестах раскрываем
  const go = async (r) => { await p.goto('http://127.0.0.1:8013/#' + r); await p.waitForTimeout(350); await p.evaluate(() => document.querySelectorAll('details.mbox-set').forEach(d => { d.open = true; })); };
  const click = async (sel, w) => { await p.click(sel); await p.waitForTimeout(w || 300); };
  await p.goto('http://127.0.0.1:8013/'); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo({}));
  await p.reload(); await p.waitForTimeout(400);
  let s;
  await click('[data-key=card-place-set]'); await click('[data-key=pv-add-meter]'); await click('[data-key=am-gas]');
  ok('форма газу: без вибору зон, одне поле м³', (await hash()) === '#gadd' && !(await p.$('input[name=ea-z]')) && (await p.$$('[data-ea]')).length === 1);
  ok('форма газу: рахунків немає (114-а — їх просимо перед передачею), «№ лічильника, котел» згорнуто', !(await p.$('#ea-grm')) && !(await p.$('#ea-acc')) && !(await p.$('#ea-eic')) && !!(await p.$('details.ea-more:not([open])')));
  await p.fill('#ea-v-all', '1180,5'); await click('[data-key=ea-save]', 400);
  s = await st(); const m = s.places[0].meters.find(x => x.kind === 'gas');
  ok('лічильник газу без рахунків + стартові 1180.5', m && !m.account && !m.grm && s.mrecs.some(r => r.base && r.meter === m.id && r.z.all === '1180.5'), { m, r: s.mrecs });
  ok('після — налаштування квартири', (await hash()) === '#place-main');
  await go('gas');
  ok('сторінка газу з барабаном', !!(await p.$('[data-key=emeter-' + m.id + '] .gdrum')));
  await go('home'); ok('головна: карточка «Газ»', !!(await p.$('[data-key=card-gas]')));
  await click('[data-key=card-gas-add]', 400);
  ok('введення: «Зараз приймають: 1 листопада–5 листопада»', (await hash()) === '#gnew' && /1 листопада.*5 листопада/.test(await p.textContent('#main')));
  const f = '#en-' + m.id + '-all';
  await p.fill(f, '1170'); await p.waitForTimeout(200); await click('[data-key=en-save]', 250);
  ok('менше минулого — блок', /Менше, ніж минулого разу \(1180\)/.test(await p.textContent('#eh-' + m.id + '-all')) && !(await st()).mrecs.some(r => !r.base && r.kind === 'gas'));
  await p.fill(f, '1195,327'); await p.waitForTimeout(200);
  ok('літри — «передається без літрів: 1195»', /без літрів: 1195/.test(await p.textContent('#eh-' + m.id + '-all')));
  await click('[data-key=en-save]', 400);
  s = await st(); const r1 = s.mrecs.find(r => !r.base && r.kind === 'gas');
  ok('збережено 1195.327', r1 && r1.z.all === '1195.327', r1);
  ok('«Куди передати»: рахунків немає — поля Газмереж і Нафтогазу, «Знайти рахунок» і «Заповнити з monobank»', !!(await p.$('[data-key=gas-acc-ask] #esg-' + m.id)) && !!(await p.$('[data-key=gas-acc-ask] #esa-' + m.id))
    && !!(await p.$('[data-key=gas-acc-ask] [data-key=gd-find]')) && !!(await p.$('[data-key=mono-open-gas]')) && !(await p.$('[data-key=dest-grm-sms]')));
  await p.fill('#esa-' + m.id, '123456789'); await p.press('#esa-' + m.id, 'Tab'); await p.waitForTimeout(400);
  ok('вписали рахунок Нафтогазу — у лічильнику; поле Газмереж лишилось', (await st()).places[0].meters.find(x => x.id === m.id).account === '123456789' && !(await p.$('#esa-' + m.id)) && !!(await p.$('#esg-' + m.id)));
  const wp = await p.textContent('[data-key=where-gas]');
  // 07.11: готовий текст SMS — у самій кнопці (окремим рядком — дубль); «Куб» і кабінет — у згорнутих «Інші способи»
  ok('«Куди передати»: кнопка SMS з готовим текстом «123456789 01195», кабінет Газмереж — в «Інші способи»', /123456789%2001195|123456789 01195/.test(await p.getAttribute('[data-key=dest-grm-sms]', 'href')) && !!(await p.$('details.dest-more [data-key=dest-grm-cab]')), wp);
  ok('посилання SMS — sms:4647 з текстом', /^sms:4647\?&body=123456789%2001195$/.test(await p.getAttribute('[data-key=dest-grm-sms]', 'href')));
  await click('[data-key=esend-done]', 300); s = await st();
  ok('«Я передав(ла)» → sent.grm', s.mrecs.find(r => r.id === r1.id).sent.grm === '2026-11-02');
  await go('history'); await click('[data-key=kind-gas]', 300);
  ok('історія: +15 м³ ≈ 119 грн, «передано»', /\+15/.test(await p.textContent('[data-key=gas-history]')) && /119/.test(await p.textContent('[data-key=gas-history]')) && /передано/i.test(await p.textContent('[data-key=gas-history]')));
  // своя ціна — у «Постачальники й тарифи» квартири (UI — e2e_prov); тут — що історія перераховується
  s = await st(); s.places[0].gasPrice = 9.99; await p.evaluate(v => localStorage.setItem('teplo.v1', JSON.stringify(v)), s); await p.reload(); await p.waitForTimeout(400); await go('gas'); s = await st();
  ok('своя ціна газу — у квартири, історія перерахувалась (15 × 9,99 ≈ 150)', s.places[0].gasPrice === 9.99 && /150/.test(await p.textContent('[data-key=gas-history]')));
  await go('place-main'); await p.click('#g-heat'); await p.waitForTimeout(250); s = await st();
  ok('газовий котел — у квартири', s.places[0].gasHeat === true);
  await go('stats'); await click('[data-key=kind-gas]', 300); ok('статистика газу', !!(await p.$('[data-key=estats-kpi]')));
  await go('save'); await click('[data-key=kind-gas]', 300); ok('економія газу: поради', !!(await p.$('[data-key=gsave-tips]')) && /на газі/.test(await p.textContent('h1')));
  // без рахунку — підказка замість SMS
  await go('place-main'); await p.fill('#ema-' + m.id, ''); await p.press('#ema-' + m.id, 'Tab'); await p.waitForTimeout(300); await go('gas');
  ok('без рахунку — поле рахунку Нафтогазу перед передачею + gas.ua за EIC, без кнопки SMS', !!(await p.$('[data-key=gas-acc-ask] #esa-' + m.id)) && !(await p.$('[data-key=dest-grm-sms]'))
    && (await p.getAttribute('[data-key=gd-find]', 'href')) === 'https://gas.ua/uk/home/find-account');
  // два рахунки й EIC: 10 цифр у рахунку Нафтогазу — це Газмережі (переносимо), EIC — великими без пробілів
  const setF = async (sel, v) => { await go('place-main'); await p.fill(sel, v); await p.press(sel, 'Tab'); await p.waitForTimeout(350); };
  await setF('#ema-' + m.id, '1320012345'); s = await st(); let gm = s.places[0].meters.find(x => x.id === m.id);
  ok('10 цифр у «рахунку Нафтогазу» → рахунок Газмереж, тост', gm.grm === '1320012345' && gm.account === '' && /рахунок Газмереж/.test(await p.textContent('#toast-host')), gm);
  await go('place-main');
  ok('поля газу (налаштування — на екрані квартири): Газмережі, Нафтогаз, EIC — з «Копіювати»', (await p.$$('#emg-' + m.id + ', #ema-' + m.id + ', #eme-' + m.id)).length === 3 && !!(await p.$('[data-key=copy-emg-' + m.id + ']')) && !!(await p.$('[data-key=copy-eme-' + m.id + ']'))
    && (await p.inputValue('#emg-' + m.id)) === '1320012345');
  await go('gas');
  ok('сторінка газу: без рахунків під назвою, без «Змінити»; «Налаштування лічильника» з рахунками й ціною — акордеоном', !/Рахунок/.test(await p.textContent('[data-key=emeter-' + m.id + '] .mbox-h')) && !(await p.$('[data-key=emeter-' + m.id + '] [data-act=eedit]')) && !!(await p.$('[data-key=emeter-' + m.id + '] details.mbox-set #ea-grm, [data-key=emeter-' + m.id + '] details.mbox-set [data-ef=grm]')) && !!(await p.$('[data-key=emeter-' + m.id + '] details.mbox-set #g-price')));
  await setF('#ema-' + m.id, '12345678'); const w8 = await p.textContent('[data-key=ema-' + m.id + '-warn]'); await go('gas');
  ok('8 цифр — жовта підказка «9 цифр, а тут 8» і в «Куди передати» «а вписано 8»', /9 цифр, а тут 8/.test(w8) && /а вписано 8/.test(await p.textContent('[data-key=where-gas]')));
  await setF('#eme-' + m.id, ' 56xm19a2 05987456 '); s = await st(); gm = s.places[0].meters.find(x => x.id === m.id);
  ok('EIC — великими без пробілів', gm.eic === '56XM19A205987456', gm);
  await setF('#ema-' + m.id, '123456789'); await go('gas'); const wg = await p.textContent('[data-key=where-gas]');
  ok('«Куди передати»: рахунок Газмереж, Нафтогазу, EIC — кожен з «Копіювати», SMS знову є',
    /Рахунок Газмереж 1320012345/.test(wg) && /Рахунок Нафтогазу 123456789/.test(wg) && /EIC-код 56XM19A205987456/.test(wg) && !(await p.$('[data-key=gd-noacc]'))
    && (await p.getAttribute('[data-key=esend-gd_eic-' + m.id + '] [data-act=copy]', 'data-text')) === '56XM19A205987456'
    && (await p.getAttribute('[data-key=esend-gd_grm-' + m.id + '] [data-act=copy]', 'data-text')) === '1320012345', wg);
  await setF('#eme-' + m.id, '56XM19A2059874');
  ok('EIC 14 символів — «16 символів, а тут 14»', /16 символів, а тут 14/.test(await p.textContent('[data-key=eme-' + m.id + '-warn]')));
  // старі дані: 10 цифр в account без grm — переносяться при відкритті
  s = await st(); s.places[0].meters.forEach(x => { if (x.id === m.id) { x.account = '1310099999'; delete x.grm; } });
  await p.evaluate(v => localStorage.setItem('teplo.v1', JSON.stringify(v)), s); await p.reload(); await p.waitForTimeout(600);
  s = await st(); gm = s.places[0].meters.find(x => x.id === m.id);
  ok('старі дані: 10 цифр → Газмережі при відкритті', gm.grm === '1310099999' && gm.account === '', gm);
  await go('gas'); await p.click('[data-key=where-gas-sum]').catch(() => {}); await p.waitForTimeout(200);
  // 07.11: рядок «SMS на 4647 приймають до 27 листопада» прибрано (кнопка SMS сама зникає з 28.11), «Куб» — в «Інші способи»
  ok('«Куб»: посилання на застосунок і 0 800 303 104 — в «Інші способи»; без рядка про кінець SMS', (await p.getAttribute('details.dest-more [data-key=dest-grm-kub]', 'href')) === 'https://kub.energy/download' && /0 800 303 104/.test(await p.textContent('[data-key=where-gas]')) && !(await p.$('[data-key=gd-sms-end]')));
  s = await st(); s.demoToday = '2026-12-01'; s.mrecs.push({ id: 'gdec', place: s.places[0].id, meter: m.id, kind: 'gas', date: '2026-12-01', z: { all: '1300' }, sent: {}, createdAt: '2026-12-01T08:00:00Z', updatedAt: 1 });
  await p.evaluate(v => localStorage.setItem('teplo.v1', JSON.stringify(v)), s); await p.reload(); await p.waitForTimeout(500); await go('gas');
  ok('з 28.11 — без SMS 4647, «Куб» лишається', !(await p.$('[data-key=dest-grm-sms]')) && !(await p.$('[data-key=gd-sms-end]')) && !!(await p.$('[data-key=dest-grm-kub]')));
  // з 28.11 ніде немає «4647»: сторінка газу з налаштуваннями лічильника, екран квартири, «Куди передати» без показань, довідка
  const no4647 = async () => !/4647/.test(await p.evaluate(() => document.getElementById('main').textContent));
  const gPage = await no4647(); await go('place-main'); const gPlace = await no4647();
  s = await st(); s.mrecs = s.mrecs.filter(r => r.kind !== 'gas' || r.base); await p.evaluate(v => localStorage.setItem('teplo.v1', JSON.stringify(v)), s); await p.reload(); await p.waitForTimeout(400);
  // 07.11: підказку «приймають з 1 по 5 число» з «Куди передати» прибрано — строк і так у плашці («1 грудня – 5 грудня»)
  await go('gas'); const gLead = await no4647() && /грудня/.test(await p.textContent('[data-key=where-gas] .dest-h .pill'));
  await go('help'); const hg = await p.evaluate(() => document.getElementById('main').textContent);
  ok('з 28.11 — «4647» ніде: сторінка газу, квартира, «Куди передати» без показань; довідка — «Куб», 0 800 303 104 і «SMS не приймають»', gPage && gPlace && gLead && !/Найпростіше — SMS/.test(hg) && /SMS на 4647 з 28 листопада 2026 не приймають/.test(hg) && /«Куб»/.test(hg) && /0 800 303 104/.test(hg), { gPage, gPlace, gLead });
  s = await st(); s.demoToday = '2026-11-02'; s.mrecs = s.mrecs.filter(r => r.id !== 'gdec'); await p.evaluate(v => localStorage.setItem('teplo.v1', JSON.stringify(v)), s); await p.reload(); await p.waitForTimeout(400);
  // мастер: газ у черзі останнім з «простих», перед теплом
  await go('add-place'); await click('[data-key=aw-next]');
  await click('[data-key=aw-gas-inc]', 200); await click('[data-key=aw-heat-inc]', 200); await click('[data-key=aw-create]', 400);
  ok('мастер: газ 1 з 2 → …', (await hash()) === '#gadd' && /1\sз\s2/.test(await p.textContent('[data-key=aw-queue]')));
  await click('[data-key=ea-save]', 400);
  ok('… → теплолічильник 2 з 2', (await hash()) === '#meter' && /2\sз\s2/.test(await p.textContent('[data-key=aw-queue]')));
  ok('без ошибок JS', errs.length === 0, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
