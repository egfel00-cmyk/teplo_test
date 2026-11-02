// Главная по квартирам: одна — «Моя квартира», адрес тут же, «+ Квартира» → новая сразу с холодной и світлом, аккордеон.
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 360, height: 800 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')));
  await p.goto('http://127.0.0.1:8013/'); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo({}));
  await p.goto('http://127.0.0.1:8013/#home'); await p.reload(); await p.waitForTimeout(500);
  ok('одна квартира: «Моя квартира», «Додати адресу», «+ Квартира», без аккордеона', /Моя квартира/.test(await p.textContent('[data-key=home-place-name]')) && !!(await p.$('[data-key=home-addr-add]')) && !!(await p.$('[data-key=home-add-place]')) && !(await p.$('details.pacc')));
  await p.click('[data-key=home-addr-add]'); await p.waitForTimeout(200);
  await p.fill('#hpa-main', 'вул. Сумська, 10, кв. 61'); await p.click('[data-key=hp-save]'); await p.waitForTimeout(300);
  let s = await st();
  ok('адресу збережено, назва лишилась за замовчуванням', s.places[0].address === 'вул. Сумська, 10, кв. 61' && !s.places[0].name && /Сумська/.test(await p.textContent('[data-key=home-place]')) && /Моя квартира/.test(await p.textContent('[data-key=home-place-name]')));
  await p.click('[data-key=home-add-place]'); await p.waitForTimeout(400); s = await st();
  const np = s.places[1];
  ok('«+ Квартира» → друга квартира з холодною і світлом, вона поточна', s.places.length === 2 && np.water.meters.length === 1 && np.water.meters[0].kind === 'cold' && np.meters.length === 1 && np.meters[0].kind === 'elec' && s.placeId === np.id, np);
  ok('аккордеон: дві секції, нова відкрита з формою назви й адреси та картками «Холодна» і «Світло»', (await p.$$('details.pacc')).length === 2 && await p.$eval('[data-key=home-pl-' + np.id + ']', e => e.open) && !!(await p.$('#hpa-' + np.id)) && !!(await p.$('[data-key=home-pl-' + np.id + '] [data-key=card-cold]')) && !!(await p.$('[data-key=home-pl-' + np.id + '] [data-key=card-elec]')));
  await p.click('[data-key=home-pl-' + np.id + '] .chip >> nth=1'); await p.fill('#hpa-' + np.id, 'Пушкінська 5'); await p.click('[data-key=hp-save]'); await p.waitForTimeout(300); s = await st();
  ok('назва кнопкою «Батьків» і адреса', s.places[1].name === 'Батьків' && s.places[1].address === 'Пушкінська 5' && /Батьків/.test(await p.textContent('[data-key=home-pl-sum-' + np.id + ']')));
  ok('перша секція — «Моя квартира» з адресою', /Моя квартира/.test(await p.textContent('[data-key=home-pl-sum-main]')) && /Сумська/.test(await p.textContent('[data-key=home-pl-sum-main]')));
  // «+» світла в секції «Батьків» — введення світла саме цієї квартири
  await p.click('[data-key=home-pl-' + np.id + '] [data-key=card-elec-add]'); await p.waitForTimeout(400); s = await st();
  ok('«+» у секції → введення світла цієї квартири', (await p.evaluate(() => location.hash)) === '#enew' && s.placeId === np.id && /Батьків/.test(await p.textContent('[data-key=place-bar]')));
  await p.goto('http://127.0.0.1:8013/#home'); await p.waitForTimeout(300);
  await p.click('[data-key=home-pl-sum-main]'); await p.waitForTimeout(200);
  await p.click('[data-key=home-pl-main] [data-key=card-hot] .ucard-main'); await p.waitForTimeout(400); s = await st();
  ok('картка гарячої в секції першої → її сторінка й квартира', (await p.evaluate(() => location.hash)) === '#water-hot' && s.placeId === 'main');
  ok('без помилок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
