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

  const order = await p.evaluate(() => { const m = document.getElementById('main'), a = m.querySelector('[data-key=rec-back]'), sw = m.querySelector('[data-key=place-switch]'); return a && sw ? !!(a.compareDocumentPosition(sw) & Node.DOCUMENT_POSITION_FOLLOWING) : null; });
  ok('світло: «← Історія» стоїть над перемикачем квартир', order === true, order);
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
  ok('вода: два чипи (гаряча / холодна) у шапці запису', (await p.$$('.rec-h .st-chip')).length === 2, (await p.$$('.rec-h .st-chip')).length);
  ok('вода: «Зараховується за жовтень 2026»', /Зараховується за жовтень 2026/.test(await txt('[data-key=rec-sub]')), await txt('[data-key=rec-sub]'));
  ok('вода: без коментаря блоку немає', !(await p.$('[data-key=rec-note]')));

  // тепло: чип праворуч від дати, місяць
  await p.goto(U + '#rec-r3'); await p.waitForTimeout(800);
  ok('тепло: чип «Прийнято» у шапці праворуч від дати', /Прийнято/.test(await txt('.rec-h .st-chip')), await txt('.rec-h'));
  ok('тепло: «Зараховується за квітень 2026»', /Зараховується за квітень 2026/.test(await txt('[data-key=rec-sub]')), await txt('[data-key=rec-sub]'));
  ok('тепло: «Скільки набігло» — без заголовка', !/Скільки набігло/.test(await txt('#main')));

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
