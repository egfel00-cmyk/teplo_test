// Карточки квартир на главной (две квартиры) — тап по шапке (владелец 07.11, iPhone: «треба тапнути двічі, картка мелькає»).
// Телефон с касанием, «живой» профиль (не автотест: анимация входа включена), согласие cookie дано.
// Сценарии: один тап — переключилось (обе карточки, туда и обратно), высота без рывков назад; стрелка «закрито» сразу при сворачивании;
// дубль click без нового касания — не разворачивает; второй настоящий тап посреди сворачивания — обратно открыта, без «проявления» заново;
// перерисовка экрана посреди сворачивания — карточка остаётся закрытой; «Згорнути» внизу; клавиатура (Enter); после перезагрузки — то же состояние.
// cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_pacc_tap.cjs [ios|android]
const { chromium, devices } = require('playwright');
const demo = require('./demo.cjs');
let pass = 0, fail = 0;
const ok = (name, c, extra) => { if (c) pass++; else fail++; console.log((c ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
(async () => {
  const dev = process.argv[2] === 'android' ? devices['Pixel 7'] : devices['iPhone 13'];
  const b = await chromium.launch();
  const ctx = await b.newContext(Object.assign({}, dev));
  await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto('http://127.0.0.1:8013/');
  await p.evaluate(s => { localStorage.setItem('teplo.v1', JSON.stringify(s)); localStorage.setItem('teplo.cc', JSON.stringify({ v: 1, a: 0, at: new Date().toISOString(), id: 'x' })); localStorage.setItem('teplo.fx', 'full'); }, demo({ second: true }));
  await p.goto('http://127.0.0.1:8013/#home'); await p.reload(); await p.waitForTimeout(1200);
  await p.evaluate(() => { location.hash = '#history'; }); await p.waitForTimeout(500);
  ok('анимация входа включена (как на телефоне)', await p.evaluate(() => new Promise(r => { location.hash = '#home'; requestAnimationFrame(() => r(document.getElementById('main').classList.contains('enter'))); })));
  await p.waitForTimeout(900);
  ok('анимация входа не висит на карточке после окончания', await p.$eval('#hp-main', d => d.getAnimations().length === 0), await p.$eval('#hp-main', d => getComputedStyle(d).animationFillMode));
  const cdp = await ctx.newCDPSession(p);
  const touch = async (sel, hold = 110, quick) => {
    if (!quick) { await p.locator(sel).scrollIntoViewIfNeeded(); await p.waitForTimeout(120); }
    const bb = await p.locator(sel).boundingBox(), x = bb.x + 40, y = bb.y + Math.min(bb.height / 2, 30);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await p.waitForTimeout(hold);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const track = id => p.evaluate(id => { window.__h = []; const t0 = performance.now(); const f = () => { const d = document.getElementById(id); window.__h.push([Math.round(performance.now() - t0), d ? Math.round(d.getBoundingClientRect().height) : -1, d ? d.open : null, d ? getComputedStyle(d.querySelector('.pacc-chev')).transform : '']); if (performance.now() - t0 < 900) requestAnimationFrame(f); }; requestAnimationFrame(f); }, id);
  const flips = h => { let n = 0, dir = 0; for (let k = 1; k < h.length; k++) { const s = Math.sign(h[k][1] - h[k - 1][1]); if (s && dir && s !== dir) n++; if (s) dir = s; } return n; };
  const isOpen = id => p.$eval('#' + id, d => d.open);

  // 1. один тап — переключилось, без рывков назад; при сворачивании стрелка «закрито» уже в первом кадре после тапа
  for (const id of ['hp-main', 'hp-p2']) {
    for (let i = 0; i < 2; i++) {
      const before = await isOpen(id);
      await track(id); await touch('#' + id + ' > summary'); await p.waitForTimeout(950);
      const h = await p.evaluate(() => window.__h), after = await isOpen(id);
      ok(id + ' тап ' + (i + 1) + ': ' + (before ? 'свернулась' : 'развернулась') + ' с одного тапа', after === !before);
      ok(id + ' тап ' + (i + 1) + ': высота без рывков назад', flips(h) === 0, 'flips ' + flips(h));
      if (before) {   // сворачивали: найти первый кадр, где высота пошла вниз, — стрелка в нём уже повёрнута как «закрито»
        const k = h.findIndex((x, j) => j && x[1] < h[0][1]);
        ok(id + ' тап ' + (i + 1) + ': стрелка поворачивается к «закрито» сразу, ещё во время движения', k > 0 && h[k][2] === true && h[k][3] !== h[0][3], k > 0 ? h[0][3] + ' → ' + h[k][3] : 'нет движения');
        ok(id + ' тап ' + (i + 1) + ': в конце нет кадра полной высоты', !h.slice(k + 1).some((x, j, a) => j && x[1] > a[j - 1][1] + 2));
      }
      ok(id + ' тап ' + (i + 1) + ': состояние запомнено', await p.evaluate(([id, o]) => JSON.parse(localStorage.getItem('teplo.v1')).homeOpen[id.slice(3)] === o, [id, after]));
    }
  }
  // 2. дубль click того же тапа (без нового касания) — не разворачивает назад
  {
    const before = await isOpen('hp-p2');
    await touch('#hp-p2 > summary'); await p.waitForTimeout(40);
    await p.$eval('#hp-p2 > summary', s => s.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })));
    await p.waitForTimeout(900);
    ok('дубль click без касания не отменяет тап', (await isOpen('hp-p2')) === !before);
  }
  // 3. второй настоящий тап посреди сворачивания — снова открыта, вещь видна (без повторного «проявления»)
  {
    if (!(await isOpen('hp-p2'))) { await touch('#hp-p2 > summary'); await p.waitForTimeout(900); }
    await touch('#hp-p2 > summary', 40); await p.waitForTimeout(70);
    const mid = await p.$eval('#hp-p2', d => Math.round(d.getBoundingClientRect().height));
    await touch('#hp-p2 > summary', 40, true);
    ok('второй тап пришёл посреди сворачивания', mid > 100 && mid < 470, 'h ' + mid);
    const op = await p.$eval('#hp-p2 > .pacc-body', b => getComputedStyle(b).opacity);
    await p.waitForTimeout(900);
    ok('тап посреди сворачивания — снова открыта', await isOpen('hp-p2'));
    ok('…и содержимое не мигает прозрачным', +op > 0.95, 'opacity ' + op);
    ok('…запомнено «открыта»', await p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')).homeOpen.p2 === true));
  }
  // 4. перерисовка экрана посреди сворачивания (опрос сервера, синхронизация) — карточка остаётся закрытой
  {
    await touch('#hp-p2 > summary'); await p.waitForTimeout(60);
    await p.evaluate(() => { location.hash = '#home?r=' + Date.now(); });   // любой маршрут → V.home: полная перерисовка
    await p.waitForTimeout(700);
    ok('перерисовка посреди сворачивания — закрыта', (await isOpen('hp-p2')) === false);
    await p.evaluate(() => { location.hash = '#home'; }); await p.waitForTimeout(600);
  }
  // 5. «Згорнути» внизу открытой карточки
  {
    if (!(await isOpen('hp-main'))) { await touch('#hp-main > summary'); await p.waitForTimeout(900); }
    await touch('#hp-main [data-act="acc-close"]'); await p.waitForTimeout(900);
    ok('«Згорнути» внизу — закрыта', (await isOpen('hp-main')) === false);
  }
  // 6. клавиатура: Enter на шапке
  {
    await p.focus('#hp-main > summary'); await p.keyboard.press('Enter'); await p.waitForTimeout(900);
    ok('Enter на шапке — открыта', await isOpen('hp-main'));
  }
  // 7. после перезагрузки — то же состояние
  {
    const st = { main: await isOpen('hp-main'), p2: await isOpen('hp-p2') };
    await p.reload(); await p.waitForTimeout(1200);
    ok('после перезагрузки — то же', (await isOpen('hp-main')) === st.main && (await isOpen('hp-p2')) === st.p2, JSON.stringify(st));
  }
  ok('без ошибок страницы', !errs.length, errs.join(' | '));
  console.log(`\n${pass}/${pass + fail}`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
