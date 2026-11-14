// 143-я (власник 14.11, скрини запису історії): «← Історія» — над квартирами; чип статусу (той самий, з меню) — праворуч від дати;
// «Зараховується за <місяць>» — у тепла, води, світла (як було в світла); «Скільки набігло» / «Набігло з передачі …» — без слів, період лишається;
// коментар — поле при правці, у записі — після платіжки й лише якщо є; «Ціна» над полем ціни — прибрано, «від {d}» не вилазить.
// node e2e_recview.cjs  (сайт 127.0.0.1:8013)
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
const U = 'http://127.0.0.1:8013/';
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' })).newPage(); p.setDefaultTimeout(6000);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const txt = sel => p.textContent(sel).catch(() => '');
  const s = demo({ today: '2026-11-02', elec: 1, second: true });
  s.mrecs.find(r => r.id === 'm20261031').note = 'Знімав сусід';
  await p.goto(U); const put = () => p.evaluate(s => { localStorage.clear(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, s); await put(); await p.reload(); await p.waitForTimeout(300); await put();
  await p.goto(U + '#erec-m20261031'); await p.reload(); await p.waitForTimeout(1200);

  // 146-а (власник 14.11: «відкриваю показання лічильника — а в ньому пілюлі інших квартир»): у записі перемикача квартир немає
  ok('світло: у записі — «← Історія», перемикача квартир немає', !!(await p.$('#main [data-key=rec-back]')) && !(await p.$('#main [data-key=place-switch]')));
  // 146-а (власник: «фото немає — блоку „Додайте фото“ не показувати, фото додати через „Виправити“; порожнього блоку — і в історії»)
  ok('світло: фото немає — блоку фото немає', !(await p.$('[data-key=rec-photos]')) && !(await p.$('.rec-ph')));
  ok('світло: у шапці запису — дата й чип статусу праворуч (той самий st-chip)', !!(await p.$('.rec-h h1')) && !!(await p.$('.rec-h .st-chip')));
  ok('світло: «Зараховується за жовтень 2026»', /Зараховується за жовтень 2026/.test(await txt('[data-key=rec-sub]')), await txt('[data-key=rec-sub]'));
  const used = await txt('[data-key=erec-used]');
  ok('світло: блок «набігло» — без слів «Набігло…», період є', !/Набігло/.test(used) && /з \d+ \S+ до 31 жовтня/.test(used), used.slice(0, 120));
  const nOrder = await p.evaluate(() => { const n = document.querySelector('[data-key=rec-note]'), bl = document.querySelector('section.bills'); return n ? (bl ? !!(bl.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) : 'nobills') : null; });
  ok('світло: коментар «Знімав сусід» є й стоїть після платіжки', /Знімав сусід/.test(await txt('[data-key=rec-note]')) && (nOrder === true || nOrder === 'nobills'), nOrder);

  // правка: поле коментаря заповнене; стерли — у записі блоку немає
  await p.click('[data-key=erec-edit]'); await p.waitForTimeout(600);
  ok('правка світла: поле «Коментар» з текстом запису', (await p.inputValue('#en-note').catch(() => '')) === 'Знімав сусід');
  await p.fill('#en-note', ''); await p.click('[data-key=en-save]'); await p.waitForTimeout(800);
  await p.goto(U + '#erec-m20261031'); await p.waitForTimeout(800);
  ok('стерли коментар — у записі блоку «Коментар» немає', !(await p.$('[data-key=rec-note]')));

  // вода: чипи двох видів праворуч від дати, «Зараховується за жовтень»
  await p.goto(U + '#wrec-w20261015'); await p.waitForTimeout(800);
  // 146-а (власник: «один шаблон лейауту» з іншими записами): гаряча й холодна в одному стані — один чип праворуч від дати, як у світла
  ok('вода: обидва види передано — один чип «Передано» у шапці', (await p.$$('.rec-h .st-chip')).length === 1 && /Передано/.test(await txt('.rec-h .st-chip')), await txt('.rec-h'));
  ok('вода: «набігло» — одне число й гроші двома рядками, як у світла', (await p.$$('[data-key=wrec-used] .ru-q')).length === 1 &&
    await p.$eval('[data-key=wrec-used] .ru-big', e => getComputedStyle(e).flexDirection === 'column'));
  await p.click('.rec-h .st-chip'); await p.waitForTimeout(200); await p.click('[data-key=st-menu] [data-key=st-set-not]'); await p.waitForTimeout(500);
  const wsn = await p.evaluate(() => (JSON.parse(localStorage.getItem('teplo.v1')).water.find(x => x.id === 'w20261015') || {}).sent || {});
  ok('один чип «Не передано» знімає і Водоканал, і ХТМ', !wsn.vk && !wsn.htm && /Не передано/.test(await txt('.rec-h .st-chip')), wsn);
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.water.find(x => x.id === 'w20261015').sent = { vk: '2026-10-15' }; s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.goto('about:blank'); await p.goto(U + '#wrec-w20261015'); await p.waitForTimeout(800);
  ok('вода: холодну передано, гарячу ні — два чипи з назвою виду', (await p.$$('.rec-h .st-chip')).length === 2 && /Гаряча/.test(await txt('.rec-h')), (await p.$$('.rec-h .st-chip')).length);
  ok('вода: «Зараховується за жовтень 2026»', /Зараховується за жовтень 2026/.test(await txt('[data-key=rec-sub]')), await txt('[data-key=rec-sub]'));
  ok('вода: без коментаря блоку немає', !(await p.$('[data-key=rec-note]')));
  ok('вода: перемикача квартир у записі немає (квартир дві)', !(await p.$('#main [data-key=place-switch]')));
  ok('вода: фото немає — блоку фото немає', !(await p.$('[data-key=rec-photos]')));

  // тепло: чип праворуч від дати, місяць
  await p.goto(U + '#rec-r3'); await p.waitForTimeout(800);
  ok('тепло: чип «Прийнято» у шапці праворуч від дати', /Прийнято/.test(await txt('.rec-h .st-chip')), await txt('.rec-h'));
  ok('тепло: «Зараховується за квітень 2026»', /Зараховується за квітень 2026/.test(await txt('[data-key=rec-sub]')), await txt('[data-key=rec-sub]'));
  ok('тепло: «Скільки набігло» — без заголовка', !/Скільки набігло/.test(await txt('#main')));
  ok('тепло: фото немає — ні блоку, ні «Додайте фото»', !(await p.$('[data-key=rec-photos]')) && !(await p.$('[data-key=rec-photo-add]')));
  // «Виправити»: тут фото можна додати; додане посеред правки не стирає набраного
  await p.click('[data-key=rec-edit]'); await p.waitForTimeout(700);
  ok('тепло, «Виправити»: перемикача немає, є «Додайте фото лічильника»', !(await p.$('#main [data-key=place-switch]')) && /Додайте фото/.test(await txt('[data-key=rec-photo-add]')));
  await p.fill('#re-note', 'Перезняв'); await p.fill('#re-volume', '2295');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await p.setInputFiles('#rp-input', { name: 'm.png', mimeType: 'image/png', buffer: png }); await p.waitForTimeout(900);
  ok('фото додано на правці: у блоці фото є картинка, набране (коментар, обʼєм) на місці', (await p.$$('[data-key=rec-photos] img')).length === 1 &&
    (await p.inputValue('#re-note')) === 'Перезняв' && (await p.inputValue('#re-volume')) === '2295', [await p.inputValue('#re-note').catch(() => ''), await p.inputValue('#re-volume').catch(() => '')]);
  await p.goto(U + '#rec-r3'); await p.waitForTimeout(700);
  ok('у записі тепер блок фото з картинкою', (await p.$$('[data-key=rec-photos] img')).length === 1);

  // ціна світла в налаштуваннях: без «Ціна» над полем і без «{d}»
  await p.goto(U + '#elec'); await p.waitForTimeout(800);
  const mp = await txt('[data-key=mp-elec]');
  ok('ціна світла: без заголовка «Ціна» над полем і без «{d}»', !!mp && !/\{d\}/.test(mp) && !(await p.$('[data-key=mp-elec] .mp-h')), mp.slice(0, 200));
  // перемикач квартир в «Історії»: лише квартири, де є лічильник цього виду (світло — лише в першій, холодна — в обох); «Куди передати» — назвою постачальника
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.view = 'elec'; localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.goto(U + '#history'); await p.reload(); await p.waitForTimeout(1000);
  ok('історія світла: у перемикачі лише квартира зі світлом', (await p.$$('[data-key=place-switch] button')).length === 1, (await p.$$('[data-key=place-switch] button')).length);
  await p.click('[data-key=kind-cold]'); await p.waitForTimeout(600);
  ok('історія холодної: обидві квартири', (await p.$$('[data-key=place-switch] button')).length === 2);
  await p.goto(U + '#elec'); await p.waitForTimeout(800);
  ok('«Куди передати» світла — назвою постачальника (Харківобленерго)', /Харківобленерго/.test(await txt('[data-key=where-elec-sum]')) && !/Куди передати/.test(await txt('[data-key=where-elec-sum]')), await txt('[data-key=where-elec-sum]'));
  ok('без помилок JS', !errs.length, errs);
  await b.close();
  console.log(pass + ' OK, ' + fail + ' FAIL'); process.exit(fail ? 1 : 0);
})();
