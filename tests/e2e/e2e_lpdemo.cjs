// 175-я: «живий» телефон лендинга — рух лише transform/opacity, лише в кадрі, пауза поза кадром, без руху на слабких/«Зменшити рух»/автотестах,
// плавність на повільному телефоні (CPU ×6), перемальовка не скидає цикл на початок.
// Сайт: SITE_BASE= SITE_DATA=/tmp/teplo_data php -S 127.0.0.1:8013 index.php · cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_lpdemo.cjs
const { chromium } = require('playwright');
const U = 'http://127.0.0.1:8013/';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else fail++; console.log((c ? '  OK  ' : ' FAIL ') + n + (c || x === undefined ? '' : '  → ' + JSON.stringify(x))); };
(async () => {
  const b = await chromium.launch();
  const DA0 = () => { window.DA = () => document.querySelector('.lpd').getAnimations({ subtree: true }).filter(a => a.effect.getTiming().duration === 12000); };
  const mk = async (o = {}) => {
    const ctx = await b.newContext(Object.assign({ viewport: { width: 390, height: 844 }, locale: 'uk-UA', colorScheme: 'dark', hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, o.ctx || {}));
    if (!o.bot) await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(U);
    await p.evaluate(o => { localStorage.setItem('teplo.v1', JSON.stringify({ theme: o.th || 'dark', themeV: 3 })); localStorage.setItem('teplo.cc', JSON.stringify({ v: 1, a: 0, at: new Date().toISOString(), id: 'x' }));
      if (o.fx) localStorage.setItem('teplo.fx', o.fx); else localStorage.removeItem('teplo.fx'); }, o);
    await p.reload(); await p.waitForTimeout(1200); await p.evaluate(DA0);
    return { ctx, p, errs };
  };
  // 1. рух іде, лише transform/opacity
  let { ctx, p, errs } = await mk({ fx: 'full' });
  const info = await p.evaluate(() => {
    const vp = document.querySelector('.lpd'), an = vp.getAnimations({ subtree: true }).filter(a => a.effect.getTiming().duration === TeploLpDemo.D);
    const props = new Set(); an.forEach(a => a.effect.getKeyframes().forEach(k => Object.keys(k).forEach(x => { if (!['offset', 'easing', 'composite', 'computedOffset'].includes(x)) props.add(x); })));
    return { run: TeploLpDemo.running(), n: an.length, props: [...props], dur: an.every(a => a.effect.getTiming().iterations === Infinity) };
  });
  ok('рух запущено: ' + info.n + ' анімацій, цикл ' + 12000 + ' мс, нескінченно', info.run && info.n > 30 && info.dur, info);
  ok('лише transform і opacity (композитор)', info.props.every(x => x === 'transform' || x === 'opacity'), info.props);
  // 2. пауза поза кадром
  const st = await p.evaluate(() => DA()[0].playState);
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(500);
  const away = await p.evaluate(() => { const a = DA(); return { ps: a[0].playState, t: a[0].currentTime }; });
  await p.waitForTimeout(600);
  const away2 = await p.evaluate(() => DA()[0].currentTime);
  ok('телефон у кадрі — грає; прокрутили далі — пауза, час стоїть', st === 'running' && away.ps === 'paused' && away.t === away2, { st, away, away2 });
  const marq = await p.evaluate(() => [...document.querySelectorAll('.lp-marq, .art-photo, .lp-tile')].filter(r => r.getBoundingClientRect().bottom < 0).map(r => r.classList.contains('lp-idle') && getComputedStyle(r.querySelector('*') || r).animationPlayState));
  ok('поза кадром — стрічки, фото кроку 1, плашки героя на паузі (lp-idle)', marq.length >= 3 && marq.every(x => x === 'paused'), marq);
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(500);
  const back = await p.evaluate(() => DA().map(a => a.playState));
  ok('повернулись — грає далі, усі разом', back.every(x => x === 'running'), [...new Set(back)]);
  // 3. перемальовка екрана не скидає цикл
  await p.evaluate(() => TeploLpDemo.seek(7000));
  await p.evaluate(() => { window.dispatchEvent(new Event('online')); });
  const t0 = await p.evaluate(() => { const a = DA()[0]; return a.currentTime; });
  ok('seek: кадр 7 с (аркуш «Зберегти»)', Math.abs(t0 - 7000) < 50, t0);
  // 4. сцени в потрібні моменти (прозорість шарів)
  const at = async ms => p.evaluate(ms => { TeploLpDemo.seek(ms); const o = s => +getComputedStyle(document.querySelector(s)).opacity, tr = s => getComputedStyle(document.querySelector(s)).transform;
    return { tg: tr('.lpd-tg'), meter: tr('.s-meter'), cam: tr('.s-cam'), sheet: tr('.s-sheet'), res: o('.lpd-res'), ok: o('.lpd-ok'), w1: o('.lpd-w1'), m2: o('.m2') }; }, ms);
  const f1 = await at(1000), f2 = await at(4500), f3 = await at(6800), f4 = await at(8000), f5 = await at(10600);
  const none = v => v === 'none' || v === 'matrix(1, 0, 0, 1, 0, 0)';
  ok('1 с: банер Telegram на екрані', none(f1.tg), f1);
  ok('4,5 с: сторінка лічильника (push справа)', none(f2.meter) && !none(f2.cam), f2);
  ok('6,8 с: камера, знайдено — «Розпізнано в телефоні»', none(f3.cam) && f3.res > .9, f3);
  ok('8 с: аркуш «Зберегти»', none(f4.sheet), f4);
  ok('10,6 с: «Сайт прийняв показання», «Передано сьогодні»', f5.ok > .9 && f5.m2 > .9 && !none(f5.cam), f5);
  ok('без помилок JS', !errs.length, errs);
  // 5. плавність на повільному телефоні: CPU ×6, рух іде — кадри головного потоку й довгі задачі
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await p.evaluate(() => { const a = DA(); a.forEach(x => { x.currentTime = 2000; x.play(); }); });
  const fr = await p.evaluate(() => new Promise(res => {
    const ft = [], lt = []; let prev = 0, t0 = performance.now();
    try { new PerformanceObserver(l => l.getEntries().forEach(e => lt.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: false }); } catch (e) { /* немає */ }
    const f = ts => { if (prev) ft.push(ts - prev); prev = ts; if (ts - t0 < 9000) requestAnimationFrame(f); else { ft.sort((a, b) => a - b); res({ n: ft.length, med: Math.round(ft[ft.length >> 1]), p90: Math.round(ft[Math.floor(ft.length * .9)]), max: Math.round(ft[ft.length - 1]), long: lt }); } };
    requestAnimationFrame(f);
  }));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  ok('CPU ×6, 9 с руху (квартира → камера → аркуш → табло): кадр медіана ≤ 20 мс, p90 ≤ 34 мс, довгих задач немає', fr.med <= 20 && fr.p90 <= 34 && !fr.long.length, fr);
  const still = await p.evaluate(() => TeploLpDemo.running());
  ok('після замірів рух не вимкнувся сам (кадри в нормі)', still);
  await ctx.close();
  // 6. без руху: «Зменшити рух», автотест, легкий режим
  ({ ctx, p, errs } = await mk({ ctx: { reducedMotion: 'reduce' } }));
  const rm = await p.evaluate(() => ({ run: TeploLpDemo.running(), cls: document.querySelector('.lpd').classList.contains('run'), n: DA().length,
    meter: getComputedStyle(document.querySelector('.s-meter')).visibility, sent: +getComputedStyle(document.querySelector('.lpd-w1')).opacity, cards: +getComputedStyle(document.querySelector('.lpd-cards .ucard')).opacity }));
  ok('«Зменшити рух»: нерухома головна — квартира розгорнута, вода «Передано», інших сцен не видно', !rm.run && !rm.cls && rm.n === 0 && rm.meter === 'hidden' && rm.sent === 1 && rm.cards === 1, rm);
  await ctx.close();
  ({ ctx, p, errs } = await mk({ bot: true }));
  ok('автотест (webdriver): без руху', !(await p.evaluate(() => TeploLpDemo.running())));
  await ctx.close();
  ({ ctx, p, errs } = await mk({ fx: 'lite' }));
  ok('легкий режим TeploAcc (слабкий телефон): без руху', !(await p.evaluate(() => TeploLpDemo.running())));
  await ctx.close();
  // 7. ru
  ({ ctx, p, errs } = await mk({ fx: 'full', ctx: { locale: 'ru-RU' } }));
  const ru = await p.evaluate(() => [document.querySelector('.lpd-hint').textContent, document.querySelector('.lpd-res i').textContent, document.querySelector('.lp-lead').textContent]);
  ok('ru: «Наведите на табло счётчика», «Распознано в телефоне», подзаголовок', /Наведите/.test(ru[0]) && /Распознано/.test(ru[1]) && /счётчик/.test(ru[2]), ru);
  await ctx.close();
  // 8. ушёл с лендинга — рух знято
  ({ ctx, p, errs } = await mk({ fx: 'full' }));
  await p.click('[data-key=welcome-start]'); await p.waitForTimeout(600);
  ok('перейшли до «Почати» — рух лендинга знято', !(await p.evaluate(() => TeploLpDemo.running())));
  await ctx.close();
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
