// «✕» і «Назад» — туди, звідки прийшли (89-а, власник 10.11): ввод з головної/квартири → назад на головну; зі сторінки виду → на сторінку;
// запис історії, відкритий зі сторінки виду, — «← Назад» туди; з історії — «← Історія показань»; явне WN.back (правка запису) — головніше.
// node e2e_navback.cjs  (локальний сервер 127.0.0.1:8013)
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch(); const p = await (await require('./pvopen.cjs').ctx(b, { viewport: { width: 390, height: 844 }, locale: 'uk-UA' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(U); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo({ elec: true, gas: true }));
  await p.goto(U + '#home'); await p.reload(); await p.waitForTimeout(600);
  const close = () => p.evaluate(() => (document.querySelector('[data-key=wiz-close]') || {}).getAttribute && document.querySelector('[data-key=wiz-close]').getAttribute('href'));
  await p.click('[data-key=card-cold-add]'); await p.waitForTimeout(400);
  ok('головна → «+» холодна → ввод, «✕» веде на головну', /#wnew$/.test(p.url()) && await close() === '#home', [p.url(), await close()]);
  await p.click('[data-key=wiz-close]'); await p.waitForTimeout(400);
  ok('«✕» → головна', /#home$/.test(p.url()), p.url());
  await p.goto(U + '#water-cold'); await p.waitForTimeout(400);
  await p.click('[data-key=water-add]'); await p.waitForTimeout(400);
  ok('сторінка холодної → ввод, «✕» — на сторінку холодної', await close() === '#water-cold', await close());
  await p.goto(U + '#home'); await p.waitForTimeout(300);
  await p.click('[data-key=card-elec-add]'); await p.waitForTimeout(400);
  ok('головна → «+» світло → ввод світла, «✕» — на головну', /#enew$/.test(p.url()) && await close() === '#home', [p.url(), await close()]);
  await p.goto(U + '#heat'); await p.waitForTimeout(300);
  await p.click('[data-key=card-heat-add], [data-act=read]'); await p.waitForTimeout(400);
  ok('сторінка тепла → внести → крок, «✕» — на сторінку тепла', /#step-0$/.test(p.url()) && await close() === '#heat', [p.url(), await close()]);
  // запис історії: з історії — «← Історія показань», зі сторінки виду — «← Назад» на неї
  await p.goto(U + '#history'); await p.waitForTimeout(300); await p.goto(U + '#wrec-w20261015'); await p.waitForTimeout(300);
  const rb = () => p.evaluate(() => { const a = document.querySelector('[data-key=rec-back]'); return a ? [a.getAttribute('href'), a.textContent] : null; });
  ok('запис з історії → «← Історія»', JSON.stringify(await rb()) === JSON.stringify(['#history', '← Історія']), await rb());
  await p.goto(U + '#water-cold'); await p.waitForTimeout(300); await p.goto(U + '#wrec-w20261015'); await p.waitForTimeout(300);
  ok('запис зі сторінки холодної → «← Назад» на неї', JSON.stringify(await rb()) === JSON.stringify(['#water-cold', '← Назад']), await rb());
  ok('без помилок JS', !errs.length, errs);
  await b.close(); console.log(`\n${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})();
