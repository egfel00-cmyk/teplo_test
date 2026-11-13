// 90-а (власник 10.11): значок квартири (необов'язково, залиті Phosphor) — вибір у «Про квартиру», у шапці квартири на головній ліворуч на висоту
// назви й адреси, у перемикачі й шапці «де я»; «Згорнути» внизу розкривашки — на всю ширину; на комп'ютері екран вводу — з бічним меню (на телефоні — без);
// значки блоків екрана лічильника — контуром у рамці кольором тексту, без заливки; «Нараховано ХТМ» — стрілка праворуч, шапка не скаче.
// node e2e_picon.cjs  (локальний сервер 127.0.0.1:8013)
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch();
  for (const vw of [390, 1280]) {
    const p = await (await require('./pvopen.cjs').ctx(b, { viewport: { width: vw, height: 900 }, locale: 'uk-UA' })).newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    const st = demo({ second: true, elec: true, gas: true });
    await p.goto(U); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), st);
    const pid = st.places[0].id;
    await p.goto(U + '#place-' + pid); await p.reload(); await p.waitForTimeout(700);
    const n = await p.evaluate(() => document.querySelectorAll('[data-key=pv-icons] input[name=pv-icon]').length);
    ok(vw + ': «Про квартиру» — вибір значка: «Без значка» + 18 залитих', n === 19, n);
    await p.click('[data-key=pv-icons] input[value=house] + .pk-b'); await p.waitForTimeout(400);
    const saved = await p.evaluate(id => JSON.parse(localStorage.getItem('teplo.v1')).places.find(x => x.id === id).icon, pid);
    ok(vw + ': значок збережено в квартиру (house)', saved === 'house', saved);
    ok(vw + ': шапка екрана квартири — значок замість крапки', await p.evaluate(() => !!document.querySelector('.pv-h svg.picon') && !document.querySelector('.pv-h span.pv-dot')));
    await p.goto(U + '#home'); await p.waitForTimeout(600);
    const g = await p.evaluate(id => { const s = document.querySelector('#hp-' + id + ' > summary'), ic = s && s.querySelector('.pacc-ic svg'), tt = s && s.querySelector('.pacc-t'), ch = s && s.querySelector('.pacc-chev');
      if (!ic || !tt) return null; const a = ic.getBoundingClientRect(), b0 = tt.getBoundingClientRect(), c = ch.getBoundingClientRect();
      return { h: Math.round(a.height), left: a.right <= b0.left + 1, chevRight: c.left >= b0.right - 1, dot: !!s.querySelector('.pdot'), mid: Math.round(Math.abs((a.top + a.bottom) / 2 - (b0.top + b0.bottom) / 2)) }; }, pid);
    ok(vw + ': головна — значок ліворуч від назви й адреси, ~2 рядки заввишки, по центру, стрілка праворуч, без крапки', g && g.h >= 36 && g.left && g.chevRight && !g.dot && g.mid <= 4, g);
    // «Згорнути» на всю ширину
    const hp = '#hp-' + pid;
    if (!(await p.evaluate(s => document.querySelector(s).open, hp))) { await p.click(hp + ' > summary'); await p.waitForTimeout(600); }
    const fw = await p.evaluate(s => { const d = document.querySelector(s), f = d && d.querySelector(':scope > .acc-foot .btn'); if (!f) return null; const a = f.getBoundingClientRect(), r = d.getBoundingClientRect(); return { w: Math.round(a.width), dw: Math.round(r.width) }; }, hp);
    ok(vw + ': «Згорнути» у квартирі — на всю ширину (мінус поля)', fw && fw.w >= fw.dw - 40, fw);
    // значки блоків екрана лічильника — без заливки, з рамкою кольору тексту
    await p.goto(U + '#gas'); await p.waitForTimeout(600);
    const bi = await p.evaluate(() => [...document.querySelectorAll('.ico.bt-ico')].map(i => { const c = getComputedStyle(i); return { bg: c.backgroundColor, bw: c.borderTopWidth, bc: c.borderTopColor, col: c.color }; }));
    ok(vw + ': значки «Історія» / «Налаштування» / «Куди передати» — прозорі, рамка кольору тексту', bi.length >= 3 && bi.every(x => /rgba\(0, 0, 0, 0\)|transparent/.test(x.bg) && parseFloat(x.bw) >= 1 && x.bc === x.col), bi);
    // бічне меню на екрані вводу: на комп'ютері є, на телефоні — немає
    await p.goto(U + '#wnew'); await p.waitForTimeout(600);
    const nv = await p.evaluate(() => { const n0 = document.querySelector('nav.nav'); return n0 ? getComputedStyle(n0).display : 'none'; });
    ok(vw + ': ввід води — бічне меню ' + (vw >= 960 ? 'видно' : 'сховано'), vw >= 960 ? nv !== 'none' : nv === 'none', nv);
    if (vw >= 960) await p.screenshot({ path: '/tmp/shots/wnew_side_1280.png' });
    await p.goto(U + '#home'); await p.waitForTimeout(400);
    await p.screenshot({ path: '/tmp/shots/home_picon_' + vw + '.png' });
    // подвал на всіх екранах — лише на комп'ютері
    const ft = await p.evaluate(() => { const f = document.querySelector('[data-key=app-foot]'); return f ? getComputedStyle(f).display : 'none'; });
    ok(vw + ': головна — подвал ' + (vw >= 960 ? 'є' : 'сховано'), vw >= 960 ? ft !== 'none' : ft === 'none', ft);
    // 91-а (власник): на комп'ютері подвал завжди внизу сторінки (коротка сторінка — внизу вікна) і в ньому лише три посилання
    if (vw >= 960) for (const r of ['#help', '#rec-r1', '#home']) {
      await p.goto(U + r); await p.waitForTimeout(500);
      const fp = await p.evaluate(() => { const f = document.querySelector('[data-key=app-foot]'); if (!f) return null; const de = document.documentElement, rb = f.getBoundingClientRect().bottom + scrollY;
        return { gap: Math.round(Math.max(de.scrollHeight, innerHeight) - rb), keys: [...f.querySelectorAll('a,button')].map(x => x.dataset.key), inMain: !!f.closest('main'), note: (f.querySelector('.af-note') || {}).textContent || '', wm: (f.querySelector('.af-note svg.wm') || { getAttribute: () => '' }).getAttribute('aria-label') }; });
      ok(vw + ': ' + r + ' — подвал притиснутий до низу сторінки: політика, умови, cookie, рік, слово «передай.com.ua» (127-а) і «не є офіційним»', fp && fp.gap <= 1 && !fp.inMain && fp.keys.join() === 'lpf-privacy,lpf-terms,lpf-cookie' && /© 20\d\d/.test(fp.note) && fp.wm === 'передай.com.ua' && /не є офіційним/.test(fp.note), fp);
    }
    if (vw >= 960) { await p.goto(U + '#help'); await p.waitForTimeout(400); await p.screenshot({ path: '/tmp/shots/foot_help_1280.png' });
      // 93-я (власник): на широкому рядок «© … · Незалежний сервіс…» — одним рядком; «Відгук» не налазить на подвал
      const fn = await p.evaluate(() => { const f = document.querySelector('[data-key=app-foot]'), n = f.querySelector('.af-note'), fab = document.querySelector('.fab'), cs = getComputedStyle(f);
        return { lines: Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight)), gap: fab ? Math.round(fab.getBoundingClientRect().left - (f.getBoundingClientRect().right - parseFloat(cs.paddingRight))) : 99 }; });
      ok(vw + ': подвал — «не є офіційним» одним рядком, «Відгук» праворуч не налазить', fn.lines === 1 && fn.gap >= 16, fn);
      await p.goto(U + '#home'); await p.waitForTimeout(400); }
    // «Нараховано ХТМ»: стрілка праворуч, висота шапки не змінюється при відкритті
    await p.goto(U + '#rec-r1'); await p.waitForTimeout(800);
    const hz = await p.evaluate(async () => { const d = document.querySelector('details.hacc'); if (!d) return null; const s = d.querySelector('summary'), ch = s.querySelector('.pacc-chev');
      const h0 = s.getBoundingClientRect().height, cr = ch.getBoundingClientRect(), sr = s.getBoundingClientRect(); d.open = !d.open; await new Promise(r => setTimeout(r, 200)); const h1 = s.getBoundingClientRect().height;
      return { h0: Math.round(h0), h1: Math.round(h1), right: Math.round(sr.right - cr.right) }; });
    ok(vw + ': «Нараховано ХТМ» — стрілка біля правого краю (16 px), шапка не скаче', hz === null || (Math.abs(hz.h0 - hz.h1) <= 1 && hz.right <= 18), hz);
    // лендинг: коротка клітинка «Ціни вашої громади» з громадами довідника по областях
    const lp = await (await p.context().browser().newContext({ viewport: { width: vw, height: 900 }, locale: 'uk-UA' })).newPage();
    await lp.goto(U); await lp.waitForTimeout(900);
    // 93-я: на телефоні плашки героя всередині картки й закривають край телефона (≤ 40 px) — його головну з 4 лічильниками видно
    const tl = await lp.evaluate(() => { const h = document.querySelector('.lp-hero').getBoundingClientRect(), s = document.querySelector('.lpp-screen').getBoundingClientRect();
      return [...document.querySelectorAll('.lp-tile')].map(t => { const r = t.getBoundingClientRect(), left = t.classList.contains('t-heat') || t.classList.contains('t-elec');
        return { inHero: r.left >= h.left && r.right <= h.right, cover: Math.round(left ? r.right - s.left : s.right - r.left) }; }); });
    ok(vw + ': лендинг — 4 плашки героя в картці' + (vw < 600 ? ', на телефоні закривають ≤ 40 px екрана' : ''), tl.length === 4 && tl.every(x => x.inHero && (vw >= 600 || x.cover <= 40)), tl);
    const pr = await lp.evaluate(() => { const c = document.querySelector('[data-key=lp-pr]'); return c ? { rows: c.querySelectorAll('.lpv-r').length, tot: (c.querySelector('.lpv-tot') || {}).textContent || '', h: c.querySelector('h3').textContent } : null; });
    ok(vw + ': лендинг — клітинка «Ціни вашої громади»: області (≥ 4) з числами громад і підсумок', pr && pr.h === 'Ціни вашої громади' && pr.rows >= 4 && /\d+ громад у довіднику/.test(pr.tot), pr);
    // 91-а (власник): у нижній панелі — цілі прилади, що перетікають один в один (корпус анімується SMIL), підписи 4 видів; в автотестах стоїть теплолічильник
    const mt = await lp.evaluate(() => { const s = document.querySelector('[data-key=lp-end] svg.lpm'); if (!s) return null;
      return { anim: s.querySelectorAll('rect > animate[attributeName=rx], rect > animate[attributeName=width]').length, caps: [...s.querySelectorAll('text')].map(x => x.textContent).filter(x => /лічильник|Водомір/.test(x)), paused: s.animationsPaused(), t: s.getCurrentTime() }; });
    ok(vw + ': лендинг — нижня панель: прилади перетікають (корпус, тінь, блик, фаска — rx/ширина), 4 підписи, в автотесті на паузі', mt && mt.anim === 10 && mt.caps.length === 4 && mt.paused && mt.t === 0, mt);
    await lp.context().close();
    ok(vw + ': без помилок JS', !errs.length, errs);
    await p.context().close();
  }
  await b.close(); console.log(`\n${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})();
