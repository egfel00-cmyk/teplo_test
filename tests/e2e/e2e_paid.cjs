// Історія: скільки набігло й сума — між показаннями зі статусом «передано» (власник 11.11.2026: «це має значення — скільки сплачено за періоди»).
// Проміжні («не передано», «для себе») — не опора: передане після них рахується від попереднього переданого, з підписом «від передачі … · проміжних показань: N».
// node e2e_paid.cjs  (локальний сервер 127.0.0.1:8013)
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const row = (id) => p.textContent('[data-key="erec-' + id + '"]').catch(() => '');
  const s0 = demo({ elec: 1 });   // однозонний: 31.07 старт 15000, 31.08 15230 (передано), 01.10 15440 (передано), 31.10 15645 (не передано)
  // 01.10 — не передали, 31.10 — передали: за 31.10 платять від 31.08 (+415), а не від 01.10 (+205)
  s0.mrecs.find(r => r.id === 'm20261001').sent = {}; s0.mrecs.find(r => r.id === 'm20261031').sent = { obl: '2026-10-31' };
  await p.goto(U); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), s0);
  await p.goto(U + '#history'); await p.reload(); await p.waitForTimeout(500);
  await p.click('[data-act=view][data-v=elec]'); await p.waitForTimeout(400);
  let r31 = await row('m20261031'), r01 = await row('m20261001');
  ok('передане 31.10 після непереданого — від передачі 31.08: +415, «проміжних показань: 1»', /\+415/.test(r31) && /від передачі 31 серпня/.test(r31) && /проміжних показань: 1/.test(r31), r31);
  ok('сума 31.10 — за 415 кВт·год (415 × 4,32 ≈ 1 793 грн)', /1\s?793 грн/.test(r31), r31);
  ok('непередане 01.10 — від переданого 31.08 як і було: +210, без підпису', /\+210/.test(r01) && !/від передачі/.test(r01), r01);
  // 31.10 теж не передано: показуємо, скільки набігло з останньої передачі (31.08) — стільки й заплатите, коли передасте
  s0.mrecs.find(r => r.id === 'm20261031').sent = {};
  await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), s0); await p.reload(); await p.waitForTimeout(500);
  await p.click('[data-act=view][data-v=elec]'); await p.waitForTimeout(400);
  r31 = await row('m20261031');
  ok('непередане після непереданого — теж від передачі 31.08 (+415)', /\+415/.test(r31) && /від передачі 31 серпня/.test(r31), r31);
  // «для себе» між переданими — як раніше: передане рахується від переданого
  s0.mrecs.find(r => r.id === 'm20261001').own = true; s0.mrecs.find(r => r.id === 'm20261031').sent = { obl: '2026-10-31' };
  await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), s0); await p.reload(); await p.waitForTimeout(500);
  await p.click('[data-act=view][data-v=elec]'); await p.waitForTimeout(400);
  r31 = await row('m20261031'); r01 = await row('m20261001');
  ok('«для себе» 01.10 — розхід від попереднього (+210), передане 31.10 — від 31.08 (+415)', /\+210/.test(r01) && /\+415/.test(r31) && /проміжних показань: 1/.test(r31), [r01, r31]);
  // картка запису: «За це платите: +415 кВт·год · 1 792,80 грн від передачі 31.08»
  await p.goto(U + '#erec-m20261031'); await p.waitForTimeout(500);
  const card = await p.textContent('[data-key=erec-used]').catch(() => '');
  ok('картка 31.10: «За це платите: +415 кВт·год · 1 792,80 грн від передачі 31.08»', /За це платите: \+415 кВт·год · 1\s?792,80 грн від передачі 31 серпня/.test(card), card);
  ok('без помилок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
