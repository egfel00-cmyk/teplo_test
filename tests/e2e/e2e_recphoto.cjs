// Запис історії з фото (89-а, власник 10.11): показання — табло свого виду (газ — жовта панель з роликами, вода — барабан, тепло — ЖК), фото — у тій самій
// картці під табло, вікно табло на превʼю — рівно по центру (навіть коли на фото воно низько). Фото з сервера підміняється синтетикою (/tmp/gas_low.jpg).
// 90-а: стара рамка лише по чорних роликах (газ 7633 — червоні з'їжджали за край) перераховується у фоні разом із червоними: синтетичний водомір
// tests/ocr-lab/out/w_novator.jpg (чорні 5 + червоні 3; немає — малюється water.cjs).
// node e2e_recphoto.cjs  (локальний сервер 127.0.0.1:8013)
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const fs = require('fs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', path = require('path'), LAB = path.join(__dirname, '../ocr-lab'), NOV = path.join(LAB, 'out/w_novator.jpg');
if (!fs.existsSync(NOV)) { const j = path.join(LAB, 'rp.local.json'); fs.writeFileSync(j, JSON.stringify(require(path.join(LAB, 'water_cases.json')).filter(c => c.id === 'w_novator')));
  try { require('child_process').execFileSync('node', [path.join(LAB, 'water.cjs'), 'rp.local.json'], { stdio: 'inherit' }); } finally { fs.unlinkSync(j); } }
(async () => {
  const b = await chromium.launch();
  for (const vw of [390, 1280]) {
    const p = await (await require('./pvopen.cjs').ctx(b, { viewport: { width: vw, height: 900 }, locale: 'uk-UA' })).newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.route('**/api/photo?id=*', r => r.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync(/id=srv-old/.test(r.request().url()) ? NOV : '/tmp/gas_low.jpg') }));
    const st = demo({ elec: true, gas: true });
    const g = st.mrecs.find(x => x.id === 'n20261101'); g.photos = [{ id: 'srv-gas-1', f: [0.5, 0.78, 0.36, 0.08, 2] }];
    const w = st.water.find(x => x.id === 'w20261015'); w.photos = [{ id: 'srv-gas-1', f: [0.5, 0.78, 0.36, 0.08, 2] }];
    // старий запис: рамка лише по чорних роликах (центр 0,454 — червоні праворуч до 0,683)
    const g0 = st.mrecs.filter(x => x.kind === 'gas' && x.id !== 'n20261101' && !x.base)[0] || st.mrecs.find(x => x.kind === 'gas' && x.id !== 'n20261101'); if (g0) g0.photos = [{ id: 'srv-old-1', f: [0.454, 0.447, 0.212, 0.044] }];
    await p.goto(U); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), st);
    await p.goto(U + '#gas'); await p.reload(); await p.waitForTimeout(300); await p.goto(U + '#erec-n20261101'); await p.waitForTimeout(1200);
    const geo = () => p.evaluate(() => {
      const im = document.querySelector('[data-key=rec-photos] img'), box = im && im.parentNode; if (!im || !box) return null;
      const bi = im.getBoundingClientRect(), bb = box.getBoundingClientRect(), f = im.getAttribute('data-f').split(',').map(Number);
      return { dx: Math.round(bi.left + f[0] * bi.width - (bb.left + bb.width / 2)), dy: Math.round(bi.top + f[1] * bi.height - (bb.top + bb.height / 2)), w: Math.round(f[2] * bi.width), bw: Math.round(bb.width), fx: im.classList.contains('fx') };
    });
    const g1 = await geo();
    ok(vw + ': газ — вікно роликів на превʼю рівно по центру (±2 px), не ширше картки', g1 && g1.fx && Math.abs(g1.dx) <= 2 && Math.abs(g1.dy) <= 2 && g1.w <= g1.bw, g1);
    ok(vw + ': газ — табло (жовта панель з роликами) і фото в одній картці, «← Назад» на сторінку газу', await p.evaluate(() => { const h = document.querySelector('[data-key=erec-values]'); return !!(h && h.querySelector('.gdrum.hero') && h.querySelector('[data-key=rec-photos]')); })
      && (await p.getAttribute('[data-key=rec-back]', 'href')) === '#gas');
    await p.screenshot({ path: '/tmp/shots/rec_gas_' + vw + '.png', fullPage: vw === 390 });
    await p.goto(U + '#wrec-w20261015'); await p.waitForTimeout(1200);
    ok(vw + ': вода з двома водомірами — два барабани, копіювання 175 і 437, фото — після обох', await p.evaluate(() => document.querySelectorAll('[data-key=wrec-values] .wdrum.hero').length === 2 && !document.querySelector('[data-key=wrec-values] [data-key=rec-photos]'))
      && (await p.getAttribute('[data-key=wrec-copy-h1]', 'data-text')) === '175' && (await p.getAttribute('[data-key=wrec-copy-c1]', 'data-text')) === '437');
    const g2 = await geo(); ok(vw + ': вода — фото теж по центру', g2 && Math.abs(g2.dx) <= 2 && Math.abs(g2.dy) <= 2, g2);
    await p.goto(U + '#erec-' + st.mrecs.filter(x => x.kind === 'elec' && !x.base).slice(-1)[0].id); await p.waitForTimeout(600);
    ok(vw + ': світло — електронне табло й копіювання по зонах', await p.evaluate(() => !!document.querySelector('[data-key=erec-values] .elcd.hero')) && !!(await p.$('[data-key=erec-copy-day], [data-key=erec-copy-all]')));
    await p.goto(U + '#rec-r3'); await p.waitForTimeout(600);
    ok(vw + ': тепло — ЖК-табло з Гкал над списком полів', await p.evaluate(() => { const h = document.querySelector('[data-key=rec-hero] .lcd.hero'), l = document.querySelector('[data-key=rec-values]'); return !!(h && l && (h.compareDocumentPosition(l) & 4)); }));
    if (vw === 390) await p.screenshot({ path: '/tmp/shots/rec_heat_390.png', fullPage: true });
    // стара рамка (лише чорні ролики) → у фоні знайдено вікно разом із червоними, центр — посередині обох, у запис — 5 чисел
    const gid = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); const r = s.mrecs.find(x => (x.photos || []).some(f => f.id === 'srv-old-1')); return r && r.id; });
    ok(vw + ': є запис газу зі старою рамкою', !!gid, gid);
    await p.goto(U + '#erec-' + gid); await p.waitForFunction(() => { const im = document.querySelector('[data-key=rec-photos] img[data-hph=srv-old-1]'); return im && !im.hasAttribute('data-fq'); }, null, { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(300);
    const g3 = await geo(), f3 = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); for (const r of s.mrecs) for (const f of (r.photos || [])) if (f.id === 'srv-old-1') return f.f; });
    ok(vw + ': стара рамка → разом із червоними роликами (центр ≈ 0,516, ширина ≈ 0,33), у запис — з позначкою', f3 && f3.length === 5 && Math.abs(f3[0] - 0.516) < 0.02 && f3[2] > 0.3, f3);
    ok(vw + ': і по центру картки', g3 && Math.abs(g3.dx) <= 2 && Math.abs(g3.dy) <= 2, g3);
    ok(vw + ': без помилок JS', !errs.length, errs);
    await p.context().close();
  }
  await b.close(); console.log(`\n${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})();
