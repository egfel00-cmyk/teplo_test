// 136-а: місяць крапками — вікно прийому показань і «сьогодні» на картках головної, у «Куди передати» й у постачальників квартири.
// Сайт: SITE_BASE= SITE_DATA=/tmp/teplo_data php -S 127.0.0.1:8013 index.php
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8013/');
  const load = async (opts, route, edit) => {
    const s = demo(Object.assign({ elec: true, gas: true }, opts)); if (edit) edit(s);
    await p.evaluate(x => localStorage.setItem('teplo.v1', JSON.stringify(x)), s);
    await p.goto('http://127.0.0.1:8013/#' + (route || 'home')); await p.reload(); await p.waitForTimeout(700);
  };
  // крапка на день: w — дні прийому, p — минулі, t — сьогодні; win — [перший, останній] день прийому, now — номер сьогоднішнього, x — його центр
  const strip = k => p.$eval('[data-key=card-' + k + '] .prd', e => { const d = [...e.querySelectorAll('.prd-d i')], w = d.map((x, i) => x.classList.contains('w') ? i + 1 : 0).filter(Boolean), t = d.findIndex(x => x.classList.contains('t'));
    return { cls: e.className, lab: e.querySelector('.prd-l').textContent, n: d.length, win: w.length ? [w[0], w[w.length - 1], w.length] : null, now: t + 1, past: d.filter(x => x.classList.contains('p')).length,
      tip: e.getAttribute('data-tip'), x: (r => r.left + r.width / 2)(d[t].getBoundingClientRect()) }; }).catch(() => null);
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  await load({ today: '2026-11-13' });
  const h = await strip('heat'), hw = await strip('hot'), cw = await strip('cold'), el = await strip('elec'), gs = await strip('gas');
  ok('13.11: смужка на всіх п’яти картках', !!(h && hw && cw && el && gs));
  ok('тепло ХТМ: 30 крапок, дні прийому 5–25, вікно відкрите, сьогодні — 13-та в кільці, 12 минулих', h && h.lab === '5–25' && /st-open/.test(h.cls) && h.n === 30 && eq(h.win, [5, 25, 21]) && h.now === 13 && h.past === 12, h);
  ok('вода: 1–20, відкрите (гаряча — кольором подачі, холодна — обратки)', hw && cw && hw.lab === '1–20' && /st-open/.test(cw.cls) && eq(cw.win, [1, 20, 20]), [hw, cw]);
  ok('світло: 29–3 — вікно відкривається наприкінці місяця й іде в наступний', el && el.lab === '29–3' && /st-before/.test(el.cls) && /cut-r/.test(el.cls) && eq(el.win, [29, 30, 2]) && /закінчується в наступному/.test(el.tip), el);
  ok('газ: 1–5 позаду (вікно цього місяця минуло)', gs && gs.lab === '1–5' && /st-after/.test(gs.cls), gs);
  ok('крапки «сьогодні» всіх карток — в одну вертикаль (колонка підпису однакової ширини)', [h, hw, cw, el, gs].every(x => x && Math.abs(x.x - h.x) < 1), [h, hw, cw, el, gs].map(x => x && x.x));
  ok('підказка: числа, сьогодні; для читача екрана — role=img з тим самим текстом', /з 5 по 25 число/.test(h.tip) && /Сьогодні 13 листопада/.test(h.tip) && await p.$eval('[data-key=card-heat] .prd', e => e.getAttribute('role') === 'img' && /Сьогодні/.test(e.getAttribute('aria-label'))));
  ok('строк текстом — як і раніше лише за 4 дні: 13.11 рядка «Передати до…» немає', !(await p.$('[data-key=card-heat] .ucard-status')));

  await load({ today: '2026-11-02' });
  const el2 = await strip('elec');
  ok('2.11: світло — хвіст вікна 30–3 з минулого місяця (жовтень — 31 день), відкрите', el2 && el2.lab === '30–3' && /st-open/.test(el2.cls) && /cut-l/.test(el2.cls) && eq(el2.win, [1, 3, 3]) && el2.now === 2 && /почалося минулого/.test(el2.tip), el2);
  ok('2.11: тепло ще не відкрите (з 5-го)', /st-before/.test((await strip('heat')).cls));

  await load({ today: '2026-10-17' });
  const cw3 = await strip('cold'), h3 = await strip('heat');
  ok('17.10: воду передано 15.10 — смуга «передано», у підказці теж', /done/.test(cw3.cls) && /вже передано/.test(cw3.tip) && !/done/.test(h3.cls), [cw3.cls, h3.cls]);

  await load({ today: '2026-11-24' });
  const h4 = await strip('heat');
  ok('24.11: тепло — останні дні, смуга попередження (warn) разом із текстом строку', /warn/.test(h4.cls) && !!(await p.$('[data-key=card-heat] .ucard-status.warn')), h4.cls);

  await load({ today: '2026-11-13' }, 'heat');
  ok('сторінка тепла: «Куди передати» → блок ХТМ зі смужкою 5–25', await p.$eval('[data-key=dest-htm-heat] .prd', e => e.querySelector('.prd-l').textContent === '5–25' && /in-dest/.test(e.className)).catch(() => false));
  await load({ today: '2026-11-13' }, 'elec');
  ok('сторінка світла: блок обленерго зі смужкою 29–3', await p.$eval('[data-key=dest-obl] .prd-l', e => e.textContent === '29–3').catch(() => false));

  // довідник: місцевий водоканал із вікном (`win`) — Мерефа 20–27; Київ (Київводоканал без вікна) — смужки немає, не вигадуємо
  await load({ today: '2026-11-13' }, 'home', s => { s.places[0].address = 'м. Мерефа, вул. Дніпровська, 1'; s.places[0].city = { n: 'Мерефа', r: 'kh' }; });
  await p.waitForTimeout(1200); await p.reload(); await p.waitForTimeout(900);
  const mc = await strip('cold');
  ok('Мерефа: холодна — вікно місцевого КП 20–27 з довідника, ще попереду', mc && mc.lab === '20–27' && /st-before/.test(mc.cls), mc);
  await load({ today: '2026-11-13' }, 'place-main', s => { s.places[0].address = 'м. Мерефа, вул. Дніпровська, 1'; s.places[0].city = { n: 'Мерефа', r: 'kh' }; });
  await p.waitForTimeout(1200); await p.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true)); await p.waitForTimeout(600);
  ok('постачальники квартири: у води — смужка 20–27', await p.$eval('[data-key=prov-water] .prd-l', e => e.textContent === '20–27').catch(() => false));
  await load({ today: '2026-11-13' }, 'home', s => { s.places[0].address = 'м. Київ, вул. Хрещатик, 1, кв. 1'; s.places[0].city = { n: 'Київ', r: 'ky' }; });
  await p.waitForTimeout(1200); await p.reload(); await p.waitForTimeout(900);
  ok('Київ: вікна водоканалу в довіднику немає — на картці води смужки немає', !(await strip('cold')) && !!(await p.$('[data-key=card-cold]')));

  ok('без помилок JS', !errs.length, errs);
  console.log(`\n${pass} OK, ${fail} FAIL`); await b.close(); process.exit(fail ? 1 : 0);
})();
