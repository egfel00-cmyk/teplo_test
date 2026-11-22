// 174-я (власник 22.11: «лічильник, встановлений за замовчуванням, не видаляється — кнопка натискається, нічого не відбувається»):
// «Прибрати» на сторінці квартири — своїм вікном (не window.confirm: у Telegram та інших вбудованих браузерах він мовчки «ні»);
// тепло, позначене при першому вході («Налаштувати опалення», без моделі), — теж рядком і теж прибирається.
// node e2e_mremove.cjs  (локальний сервер 127.0.0.1:8013)
const { chromium } = require('playwright');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' })).newPage();
  const errs = [], native = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => { native.push(d.message()); d.dismiss(); });
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.goto(U + '#start'); await p.waitForTimeout(700);
  for (const k of ['heat', 'cold', 'elec']) { await p.click('[data-key=aw-' + k + '-inc]'); await p.waitForTimeout(120); }
  await p.click('[data-key=aw-create]'); await p.waitForTimeout(800);
  const cards = () => p.evaluate(() => [...document.querySelectorAll('.ucard')].map(e => e.dataset.key).sort().join(','));
  ok('перший вхід: світло, холодна, «Налаштувати опалення»', (await cards()) === 'card-cold,card-elec,card-heat', await cards());
  const pid = (await p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')))).places[0].id;
  await p.goto(U + '#place-' + pid); await p.waitForTimeout(800);
  const rm = await p.evaluate(() => [...document.querySelectorAll('[data-act=m-remove]')].map(e => e.dataset.what));
  ok('на сторінці квартири — 3 рядки з «Прибрати», серед них тепло без моделі', rm.length === 3 && rm.includes('heat'), rm);
  await p.$eval('[data-act=m-remove][data-what="heat"]', e => e.click()); await p.waitForTimeout(300);
  ok('«Прибрати» — своє вікно з питанням, не системне', !!(await p.$('.ask-ov [role=alertdialog]')) && /Прибрати «Опалення»/.test(await p.textContent('.ask')) && !native.length, native);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok('Esc — вікно закрилось, нічого не прибрано', !(await p.$('.ask-ov')) && (await p.$$('[data-act=m-remove]')).length === 3);
  for (const w of rm) { await p.$eval('[data-act=m-remove][data-what="' + w + '"]', e => e.click()); await p.waitForTimeout(250); await p.click('[data-key=ask-yes]'); await p.waitForTimeout(400); }
  ok('«Прибрати» тричі — рядків не лишилось', (await p.$$('[data-act=m-remove]')).length === 0);
  const s = await p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')));
  ok('у даних: лічильники видалені, позначки тепла (heatAsk) немає', !s.places[0].heatAsk && (s.places[0].meters || []).every(m => m.deleted || m.removed) && (s.places[0].water.meters || []).every(m => m.deleted || m.removed));
  await p.goto(U + '#home'); await p.waitForTimeout(600);
  ok('на головній карток лічильників немає', (await cards()) === '', await cards());
  ok('без помилок JS і системних діалогів', !errs.length && !native.length, [errs, native]);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
