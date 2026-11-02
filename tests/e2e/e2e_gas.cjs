// Газ (этап 3): додати лічильник, внести (літри, «менше»), «Куди передати» — готове SMS 4647 «рахунок пробіл 5 цифр», кабінет
// Газмереж, «Я передав(ла)», історія/статистика/економія, своя ціна, котел, мастер квартиры. Сервер 127.0.0.1:8013.
// Запуск: cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_gas.cjs
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, i) => { console.log((c ? '  OK  ' : ' FAIL ') + n + (!c && i !== undefined ? '  → ' + JSON.stringify(i) : '')); c ? pass++ : fail++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')));
  const hash = () => p.evaluate(() => location.hash);
  // настройки счётчика на его странице свёрнуты в блоке «прибора» — в тестах раскрываем
  const go = async (r) => { await p.goto('http://127.0.0.1:8013/#' + r); await p.waitForTimeout(350); await p.evaluate(() => document.querySelectorAll('details.mbox-set').forEach(d => { d.open = true; })); };
  const click = async (sel, w) => { await p.click(sel); await p.waitForTimeout(w || 300); };
  await p.goto('http://127.0.0.1:8013/'); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo({}));
  await p.reload(); await p.waitForTimeout(400);
  let s;
  await click('[data-key=card-add-meter]'); await click('[data-key=am-gas]');
  ok('форма газу: без вибору зон, одне поле м³', (await hash()) === '#gadd' && !(await p.$('input[name=ea-z]')) && (await p.$$('[data-ea]')).length === 1);
  await p.fill('#ea-v-all', '1180,5'); await p.fill('#ea-acc', '123456789'); await click('[data-key=ea-save]', 400);
  s = await st(); const m = s.places[0].meters.find(x => x.kind === 'gas');
  ok('лічильник газу + стартові 1180.5', m && m.account === '123456789' && s.mrecs.some(r => r.base && r.meter === m.id && r.z.all === '1180.5'), { m, r: s.mrecs });
  ok('сторінка газу з барабаном', (await hash()) === '#gas' && !!(await p.$('[data-key=emeter-' + m.id + '] .gdrum')));
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
  const wp = await p.textContent('[data-key=where-gas]');
  ok('«Куди передати»: готове SMS «123456789 01195», кнопка SMS і кабінет Газмереж', /123456789 01195/.test(wp) && !!(await p.$('[data-key=dest-grm-sms]')) && !!(await p.$('[data-key=dest-grm-cab]')), wp);
  ok('посилання SMS — sms:4647 з текстом', /^sms:4647\?&body=123456789%2001195$/.test(await p.getAttribute('[data-key=dest-grm-sms]', 'href')));
  await click('[data-key=esend-done]', 300); s = await st();
  ok('«Я передав(ла)» → sent.grm', s.mrecs.find(r => r.id === r1.id).sent.grm === '2026-11-02');
  await go('history'); await click('[data-key=kind-gas]', 300);
  ok('історія: +15 м³ ≈ 119 грн, «передано»', /\+15/.test(await p.textContent('[data-key=gas-history]')) && /119/.test(await p.textContent('[data-key=gas-history]')) && /передано/.test(await p.textContent('[data-key=gas-history]')));
  await go('gas'); await p.fill('#g-price', '9,99'); await p.press('#g-price', 'Tab'); await p.waitForTimeout(300); s = await st();
  ok('своя ціна газу — у квартири, історія перерахувалась (15 × 9,99 ≈ 150)', s.places[0].gasPrice === 9.99 && /150/.test(await p.textContent('[data-key=gas-history]')));
  await p.click('#g-heat'); await p.waitForTimeout(250); s = await st();
  ok('газовий котел — у квартири', s.places[0].gasHeat === true);
  await go('stats'); await click('[data-key=kind-gas]', 300); ok('статистика газу', !!(await p.$('[data-key=estats-kpi]')));
  await go('save'); await click('[data-key=kind-gas]', 300); ok('економія газу: поради', !!(await p.$('[data-key=gsave-tips]')) && /на газі/.test(await p.textContent('h1')));
  // без рахунку — підказка замість SMS
  await go('gas'); await p.fill('#ema-' + m.id, ''); await p.press('#ema-' + m.id, 'Tab'); await p.waitForTimeout(300); await p.reload(); await p.waitForTimeout(400);
  ok('без рахунку — «впишіть особовий рахунок», без кнопки SMS', /Впишіть особовий рахунок/.test(await p.textContent('[data-key=where-gas]')) && !(await p.$('[data-key=dest-grm-sms]')));
  // мастер: газ у черзі останнім з «простих», перед теплом
  await go('add-place'); await click('[data-key=aw-next]');
  await click('[data-key=aw-gas-inc]', 200); await click('[data-key=aw-heat-inc]', 200); await click('[data-key=aw-create]', 400);
  ok('мастер: газ 1 з 2 → …', (await hash()) === '#gadd' && /1\sз\s2/.test(await p.textContent('[data-key=aw-queue]')));
  await click('[data-key=ea-save]', 400);
  ok('… → теплолічильник 2 з 2', (await hash()) === '#meter' && /2\sз\s2/.test(await p.textContent('[data-key=aw-queue]')));
  ok('без ошибок JS', errs.length === 0, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
