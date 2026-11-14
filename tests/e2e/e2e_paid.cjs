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
  // картка запису (власник 11.11, вдруге): головне — «Набігло з передачі 31 серпня»: +415 кВт·год ≈ 1 792,80 грн, проміжні — рядком
  await p.goto(U + '#erec-m20261031'); await p.waitForTimeout(500);
  const card = await p.textContent('[data-key=erec-used]').catch(() => '');
  ok('картка 31.10: період від передачі 31 серпня (143-я: без слів «Набігло…») +415 ≈ 1 792,80 грн', /з 31 серпня до 31 жовтня/.test(card) && !/Набігло/.test(card) && /\+415\s*кВт·год/.test(card) && /1\s?792,80/.test(card), card);
  ok('картка 31.10: цей запис +205 · проміжних показань: 1', /Цей запис: \+205 кВт·год за 30 дн\. · проміжних показань: 1/.test(card), card);
  // непереданий 01.10 («для себе») — теж від останньої передачі 31.08: +210
  await p.goto(U + '#erec-m20261001'); await p.waitForTimeout(500);
  const c01 = await p.textContent('[data-key=erec-used]').catch(() => '');
  ok('картка «для себе» 01.10 — період від передачі 31 серпня, +210', /з 31 серпня до 1 жовтня/.test(c01) && /\+210/.test(c01), c01);
  // статистика: місяці — між переданими (31.08 → 31.10 = +415 у жовтні), а не між усіма записами (210 + 205)
  await p.goto(U + '#stats'); await p.waitForTimeout(400); await p.click('[data-act=view][data-v=elec]'); await p.waitForTimeout(400);
  const tbl = await p.textContent('[data-key=stt-table]').catch(() => '');
  ok('статистика: жовтень +415 між переданими, без вересня 210', /415/.test(tbl) && !/\b210\b/.test(tbl), tbl);
  // останній запис не передано — у статистиці «Після передачі 31 серпня: +415 кВт·год ≈ 1 793 грн»
  s0.mrecs.find(r => r.id === 'm20261031').sent = {};
  await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), s0); await p.reload(); await p.waitForTimeout(500);
  await p.click('[data-act=view][data-v=elec]').catch(() => {}); await p.waitForTimeout(400);
  const kp = await p.textContent('[data-key=estats-kpi]').catch(() => '');
  ok('статистика: «Після передачі 31 серпня: +415 кВт·год ≈ 1 793 грн»', /Після передачі 31 серпня: \+415 кВт·год ≈ 1\s?793 грн/.test(kp), kp);
  ok('без помилок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
