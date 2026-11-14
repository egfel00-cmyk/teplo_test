// Розкривашки плавно всюди (139-а, власник 13.11): «Куди передати», «Налаштування показань», сезон історії, /admin.
// Повний режим (teplo.fx = full) — висота йде кадрами, вміст проявляється; згортання — <details> відкритий до кінця руху;
// легкий (teplo.fx = lite — як на слабкому Android) — висота одразу, вміст лише проявляється, згортання одразу; «Зменшити рух» — без анімації.
// cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_accanim.cjs
const { chromium } = require('playwright');
const demo = require('./demo.cjs');
let pass = 0, fail = 0;
const ok = (name, c, extra) => { if (c) pass++; else fail++; console.log((c ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
const B = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const page = async (fx, rm) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: rm ? 'reduce' : 'no-preference' });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(B); const s = demo({ elec: 2, seasons: true, today: '2026-11-13' }); s.places[0].address = 'м. Харків, вул. Сумська, 10'; s.places[0].city = { n: 'Харків', r: 'kh' };
    await p.evaluate(([s, fx]) => { localStorage.setItem('teplo.v1', JSON.stringify(s)); localStorage.setItem('teplo.cc', JSON.stringify({ v: 1, a: 0, at: new Date().toISOString(), id: 'x' })); if (fx) localStorage.setItem('teplo.fx', fx); }, [s, fx]);
    return p;
  };
  // кадри висоти й open після кліку по шапці
  const run = async (p, sel) => {
    await p.evaluate(sel => { window.__h = []; const t0 = performance.now(); const f = () => { const d = document.querySelector(sel); window.__h.push([Math.round(performance.now() - t0), d ? Math.round(d.getBoundingClientRect().height) : -1, d ? d.open : null, d ? d.className : '']); if (performance.now() - t0 < 600) requestAnimationFrame(f); }; requestAnimationFrame(f); }, sel);
    await p.click(sel + ' > summary'); await p.waitForTimeout(700);
    return p.evaluate(() => window.__h);
  };
  const mids = h => { const a = h[0][1], z = h[h.length - 1][1]; return new Set(h.filter(x => Math.min(a, z) + 2 < x[1] && x[1] < Math.max(a, z) - 2).map(x => x[1])).size; };
  const mono = h => { let dir = 0, n = 0; for (let k = 1; k < h.length; k++) { const s = Math.sign(h[k][1] - h[k - 1][1]); if (s && dir && s !== dir) n++; if (s) dir = s; } return n === 0; };

  // 1. повний режим — «Куди передати» на сторінці світла
  let p = await page('full');
  await p.goto(B + '#elec'); await p.reload(); await p.waitForTimeout(900);
  const W = 'details.wacc';
  let h = await run(p, W);
  ok('«Куди передати»: розкривається кадрами', mids(h) >= 3, 'проміжних ' + mids(h) + ', ' + h[0][1] + '→' + h[h.length - 1][1]);
  ok('…без ривків назад', mono(h));
  ok('…вміст проявляється (acc-in)', h.some(x => /acc-in/.test(x[3])));
  ok('…у кінці відкрита, «Згорнути» внизу', await p.$eval(W, d => d.open && !!d.querySelector(':scope > .acc-foot')));
  ok('…після руху без службових класів', await p.$eval(W, d => !/acc-anim|shut/.test(d.className) && d.getAnimations().length === 0));
  h = await run(p, W);
  const k = h.findIndex((x, j) => j && x[1] < h[0][1] - 2);
  ok('згортання кадрами', mids(h) >= 3, 'проміжних ' + mids(h));
  ok('…посеред руху ще open (вміст видно)', k > 0 && h[k][2] === true);
  ok('…стрілка «закрито» одразу (shut)', k > 0 && /shut/.test(h[k][3]));
  ok('…у кінці закрита', await p.$eval(W, d => !d.open));
  // перемальовка одразу після тапу «згорнути» — стан уже «закрита»
  await p.click(W + ' > summary'); await p.waitForTimeout(500);
  await p.click(W + ' > summary'); await p.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange'))); await p.waitForTimeout(500);
  ok('перемальовка посеред згортання — лишається закритою', await p.$eval(W, d => !d.open));
  // клавіатура
  await p.focus(W + ' > summary'); await p.keyboard.press('Enter'); await p.waitForTimeout(450);
  ok('Enter на шапці — відкрилась', await p.$eval(W, d => d.open));
  // «Згорнути» внизу — плавно
  await p.evaluate(() => { window.__h2 = []; const d = document.querySelector('details.wacc'); const t0 = performance.now(); const f = () => { window.__h2.push(Math.round(d.getBoundingClientRect().height)); if (performance.now() - t0 < 500) requestAnimationFrame(f); }; requestAnimationFrame(f); });
  await p.click(W + ' > .acc-foot button'); await p.waitForTimeout(600);
  const h2 = await p.evaluate(() => window.__h2);
  ok('«Згорнути» внизу — плавно й закрита', new Set(h2).size >= 4 && await p.$eval(W, d => !d.open), 'кадрів ' + new Set(h2).size);
  // «Налаштування показань»
  h = await run(p, 'details.mbox-set');
  ok('«Налаштування показань» — кадрами', mids(h) >= 3 && h[h.length - 1][2] === true, 'проміжних ' + mids(h));
  // сезон тепла в історії
  await p.goto(B + '#history'); await p.waitForTimeout(800); await p.click('[data-key=kind-heat]').catch(() => {}); await p.waitForTimeout(400);   // 147-а: перша вкладка — за порядком видів
  const sz = await p.$$eval('details.season', a => a.map(d => d.open));
  const si = sz.indexOf(false);
  if (si >= 0) {
    const sel = 'details.season >> nth=' + si;
    await p.evaluate(i => { const d = document.querySelectorAll('details.season')[i]; d.id = d.id || 'acc-t-season'; }, si);
    const sid = await p.evaluate(i => document.querySelectorAll('details.season')[i].id, si);
    h = await run(p, '#' + sid);
    ok('сезон історії — кадрами', mids(h) >= 3 && h[h.length - 1][2] === true, 'проміжних ' + mids(h));
  } else ok('сезон історії — є закритий', false, JSON.stringify(sz));
  await p.context().close();

  // 2. легкий режим (слабкий Android): висота одразу, вміст проявляється; згортання одразу
  p = await page('lite');
  await p.goto(B + '#elec'); await p.reload(); await p.waitForTimeout(900);
  h = await run(p, W);
  ok('легкий: розкрилась без кадрів висоти', mids(h) === 0 && h[h.length - 1][2] === true, 'проміжних ' + mids(h));
  ok('легкий: вміст проявляється', h.some(x => /acc-in/.test(x[3])));
  ok('легкий: без Web Animations на висоті', await p.$eval(W, d => d.getAnimations().length === 0));
  h = await run(p, W);
  ok('легкий: згорнулась одразу', mids(h) === 0 && h[h.length - 1][2] === false);
  await p.context().close();

  // 3. «Зменшити рух»
  p = await page('full', true);
  await p.goto(B + '#elec'); await p.reload(); await p.waitForTimeout(900);
  h = await run(p, W);
  ok('«Зменшити рух»: без анімації', mids(h) === 0 && !h.some(x => /acc-in|acc-anim/.test(x[3])) && h[h.length - 1][2] === true);
  h = await run(p, W);
  ok('«Зменшити рух»: закрилась одразу', mids(h) === 0 && h[h.length - 1][2] === false);
  await p.context().close();

  // 4. /admin — той самий модуль
  const ad = await (await fetch(B + 'admin')).text();
  ok('/admin: розкривашки з тим самим модулем', ad.indexOf('window.TeploAcc') > 0 && ad.indexOf('</script>\n</head>') > 0);

  ok('без помилок сторінки', errs.length === 0, errs.join(' | '));
  console.log('\n' + pass + ' OK, ' + fail + ' FAIL');
  await b.close(); process.exit(fail ? 1 : 0);
})();
