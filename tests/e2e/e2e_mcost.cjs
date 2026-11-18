// «Комуналка за місяць» — кільце над графіками «Статистики» (172-а, власник 18.11): один стан місяця на екран (стрілки, свайп, тап по стовпчику),
// суми = стовпчики «₴» видів до гривні, тап по легенді — вид нижче, крайні місяці, без грошей — плашки немає; рух графіків (chartfx.js).
// Запуск: cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_mcost.cjs   (сайт 127.0.0.1:8013)
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, i) => { console.log((c ? '  OK  ' : ' FAIL ') + n + (!c && i !== undefined ? '  → ' + JSON.stringify(i) : '')); c ? pass++ : fail++; };
const U = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const open = async (st, o) => {
    o = o || {};
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: o.locale || 'uk-UA', reducedMotion: o.calm ? 'reduce' : 'no-preference', hasTouch: !!o.touch });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
    await p.goto(U); await p.evaluate(([s, fx]) => { localStorage.setItem('teplo.v1', JSON.stringify(s)); if (fx) localStorage.setItem('teplo.fx', fx); }, [st, o.fx || '']);
    await p.goto(U + '#stats'); await p.reload(); await p.waitForTimeout(700); return p;
  };
  const info = p => p.evaluate(() => {
    const q = s => document.querySelector(s), num = s => +String(s || '').replace(/[^\d]/g, '');
    const rows = Array.from(document.querySelectorAll('.mc-row')).map(r => ({ k: r.getAttribute('data-k'), v: num(r.querySelector('.mc-a').textContent), p: num(r.querySelector('.mc-p').textContent), on: r.classList.contains('on') }));
    return { m: (q('[data-key=mc-month]') || {}).textContent || '', sum: num((q('[data-key=mc-sum]') || {}).textContent), rows, segs: document.querySelectorAll('.mc-s').length,
      prev: !!(q('[data-key=mc-prev]') || {}).disabled, next: !!(q('[data-key=mc-next]') || {}).disabled, miss: (q('[data-key=mc-miss]') || {}).textContent || '',
      aria: (q('[data-key=mc-ring]') || { getAttribute: () => '' }).getAttribute('aria-label') || '' };
  });
  // стовпчик місяця, підсвічений у графіку (g.mk.on): число над ним
  const selBar = (p, sel) => p.evaluate(s => { const g = document.querySelector(s + ' g.mk.on'); const v = g && g.querySelector('.vl'); return g ? { ym: g.getAttribute('data-ym'), v: v ? +v.textContent.replace(/[^\d]/g, '') : null } : null; }, sel);
  const uahSel = 'svg.chart[aria-label="Вартість по місяцях"]';

  // 1. Демо: світло, газ, вода, тепло, вивіз; сьогодні 02.11.2026
  let p = await open(demo({ elec: true, gas: true, waste: true }));
  let s = await info(p);
  ok('плашка «Комуналка за місяць» між заголовком і перемикачем видів', await p.evaluate(() => { const m = document.querySelector('[data-key=mc-panel]'), h = document.querySelector('#main h1'), k = document.querySelector('[data-key=kind-switch]');
    return !!(m && h && k && (h.compareDocumentPosition(m) & 4) && (m.compareDocumentPosition(k) & 4)); }));
  ok('за замовчуванням — останній місяць з грошима: жовтень 2026', s.m === 'Жовтень 2026', s.m);
  ok('жовтень: гаряча і холодна вода, сума в центрі = сума рядків', s.rows.map(r => r.k).join() === 'hot,cold' && s.sum === s.rows.reduce((a, r) => a + r.v, 0), s);
  ok('«наступний» — неактивна (останній місяць), «попередній» — активна', s.next && !s.prev, s);
  ok('сірий рядок: світло, газ, опалення без даних, вивіз — не сплачено', /Без даних за жовтень: світло, газ, опалення, вивіз сміття — не сплачено/.test(s.miss), s.miss);
  ok('частки в сумі 100 %', s.rows.reduce((a, r) => a + r.p, 0) === 100, s.rows);
  ok('сектор на кожен вид з грошима', s.segs === s.rows.length, s.segs);

  // 2. Стрілка «‹» — вересень: 5 видів; світло = стовпчик «Вартість по місяцях» світла, підсвічений той самий місяць
  await p.click('[data-key=mc-prev]'); await p.waitForTimeout(300); s = await info(p);
  ok('«‹» — вересень 2026, 5 видів у порядку світло, гаряча, холодна, газ, вивіз', s.m === 'Вересень 2026' && s.rows.map(r => r.k).join() === 'elec,hot,cold,gas,waste', s);
  ok('aria-label кільця: місяць, сума й види словами', /^За вересень 2026 — 1\s248 ₴: світло 756, гаряча вода 190/.test(s.aria), s.aria);
  let bar = await selBar(p, uahSel);
  ok('світло: у графіку «₴» підсвічено 09.26, число = рядок кільця (756)', bar && bar.ym === '2026-09' && bar.v === s.rows.find(r => r.k === 'elec').v, { bar, rows: s.rows });
  ok('рядок поточного виду (світло) виділено', s.rows.find(r => r.k === 'elec').on);

  // 3. Тап по стовпчику 08.26 — серпень у кільці, смуга переїхала
  await p.click(uahSel + ' g.mk[data-ym="2026-08"]'); await p.waitForTimeout(300); s = await info(p); bar = await selBar(p, uahSel);
  ok('тап по стовпчику 08.26 → «Серпень 2026» у кільці, смуга на 08.26', s.m === 'Серпень 2026' && bar && bar.ym === '2026-08', { m: s.m, bar });
  ok('серпень: світло 821 = стовпчик', s.rows.find(r => r.k === 'elec').v === 821 && bar.v === 821, s.rows);

  // 4. Тап по рядку легенди «Холодна вода» — той самий вид у перемикачі, графіки води, прокрутка до них
  await p.click('[data-key=mc-row-cold]'); await p.waitForTimeout(700);
  const kv = await p.evaluate(() => ({ view: JSON.parse(localStorage.getItem('teplo.v1')).view, pressed: (document.querySelector('[data-key=kind-switch] [aria-pressed=true]') || {}).getAttribute && document.querySelector('[data-key=kind-switch] [aria-pressed=true]').getAttribute('data-v'),
    top: Math.round(document.querySelector('[data-key=kind-switch]').getBoundingClientRect().top) }));
  ok('легенда «Холодна вода» → вид cold у перемикачі', kv.view === 'cold' && kv.pressed === 'cold', kv);
  ok('прокрутили до перемикача видів (вгорі екрана)', kv.top >= 0 && kv.top < 120, kv.top);
  s = await info(p); bar = await selBar(p, uahSel);
  ok('місяць той самий (серпень) — вода: стовпчик «₴» 08.26 = рядок холодної', s.m === 'Серпень 2026' && bar && bar.ym === '2026-08' && bar.v === s.rows.find(r => r.k === 'cold').v, { m: s.m, bar, rows: s.rows });
  bar = await selBar(p, 'svg.chart[aria-label="Кубометри по місяцях"]');
  ok('графік м³ теж підсвічує серпень', bar && bar.ym === '2026-08', bar);

  // 5. Вивіз: оплачене = стовпчик «Сплачено по місяцях»
  await p.evaluate(() => window.scrollTo(0, 0)); await p.click('[data-key=mc-row-waste]'); await p.waitForTimeout(500);
  bar = await p.evaluate(() => { const g = document.querySelector('svg.chart g.mk.on'); return g ? { ym: g.getAttribute('data-ym'), v: +(g.querySelector('.vl') || {}).textContent } : null; }); s = await info(p);
  ok('вивіз: стовпчик серпня = рядок кільця (60)', bar && bar.ym === '2026-08' && bar.v === 60 && s.rows.find(r => r.k === 'waste').v === 60, { bar, rows: s.rows });

  // 6. Тепло: березень — «Вартість по місяцях» тепла = кільце; крайній лівий місяць — «‹» неактивна
  for (let i = 0; i < 5; i++) { await p.click('[data-key=mc-prev]'); await p.waitForTimeout(200); }
  s = await info(p);
  ok('березень 2026: лише опалення, 100 %', s.m === 'Березень 2026' && s.rows.length === 1 && s.rows[0].k === 'heat' && s.rows[0].p === 100, s);
  await p.click('[data-key=mc-row-heat]'); await p.waitForTimeout(800);
  bar = await selBar(p, '[data-key=hst-uah]');
  ok('тепло: «Вартість по місяцях» (Гкал × тариф + абонплата) 03.26 = кільце', bar && bar.ym === '2026-03' && bar.v === (await info(p)).rows[0].v, { bar, s: (await info(p)).rows });
  await p.evaluate(() => window.scrollTo(0, 0));
  while (!(await info(p)).prev) { await p.click('[data-key=mc-prev]'); await p.waitForTimeout(150); }
  s = await info(p); ok('перший місяць — «‹» неактивна (грудень 2025)', s.prev && s.m === 'Грудень 2025', s.m);

  // 7. Свайп по кільцю вліво — наступний місяць; тап після свайпу сектор не вибирає
  const box = await p.$eval('[data-key=mc-ring]', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await p.mouse.move(box.x + 60, box.y); await p.mouse.down(); await p.mouse.move(box.x - 40, box.y, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(300);
  s = await info(p); ok('свайп вліво по кільцю → січень 2026', s.m === 'Січень 2026', s.m);
  await p.close();

  // 8. Мова ru
  p = await open(demo({ elec: true, gas: true, waste: true }), { locale: 'ru-RU' }); s = await info(p);
  ok('ru: «Коммуналка за месяц», «Октябрь 2026», «₴ за октябрь»', /Коммуналка за месяц/.test(await p.textContent('[data-key=mc-panel]')) && s.m === 'Октябрь 2026' && /₴ за октябрь/.test(await p.textContent('[data-key=mc-ring]')), s.m);
  await p.close();

  // 9. Грошей немає (лічильники без показань) — плашки немає
  const st0 = demo({ noHeat: true }); st0.water = [];
  p = await open(st0);
  ok('без показань — плашки «Комуналка за місяць» немає', !(await p.$('[data-key=mc-panel]')));
  await p.close();

  // 10. Рух: повний режим — кільце й стовпчики чекають кадру (fx-pre), потім знімається; «Зменшити рух» — без fx-pre
  p = await open(demo({ elec: true, gas: true, waste: true }), { fx: 'full' });
  ok('рух: кільце в кадрі — fx-pre знято, анімація була', await p.evaluate(() => !document.querySelector('.mc-ring.fx-pre') && document.querySelector('.mc-s').getAnimations().length >= 0));
  ok('рух: графік нижче екрана — ще fx-pre (стовпчики сховані до кадру)', await p.evaluate(() => { const c = Array.from(document.querySelectorAll('svg.chart[data-fx]')).filter(x => x.getBoundingClientRect().top > innerHeight); return c.length > 0 && c.every(x => x.classList.contains('fx-pre')); }));
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(500);
  ok('рух: прокрутили — fx-pre знято з усіх графіків', await p.evaluate(() => !document.querySelector('.fx-pre')));
  await p.evaluate(() => window.scrollTo(0, 0)); await p.click('[data-key=mc-prev]'); await p.waitForTimeout(60);
  ok('рух: зміна місяця — сектори переходять (Web Animations ≤ 200 мс)', await p.evaluate(() => Array.from(document.querySelectorAll('.mc-s')).some(s => s.getAnimations().some(a => a.effect.getTiming().duration <= 200))));
  await p.close();
  p = await open(demo({ elec: true, gas: true, waste: true }), { fx: 'full', calm: true });
  ok('«Зменшити рух»: жодного fx-pre і жодної анімації', await p.evaluate(() => !document.querySelector('.fx-pre') && !document.querySelector('.mc-s').getAnimations().length));
  await p.close();

  ok('без помилок сторінки', !errs.length, errs);
  console.log(`\n${pass}/${pass + fail}`); await b.close(); process.exit(fail ? 1 : 0);
})();
