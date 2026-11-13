// Історія світла, газу, води й вивозу — по роках, як сезони тепла (138-а, власник 13.11).
// node e2e_years.cjs  (локальний сервер 127.0.0.1:8013)
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
(async () => {
  const b = await chromium.launch();
  for (const dark of [false, true]) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: dark ? 'dark' : 'light' }); const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    const s0 = demo({ elec: 2, gas: true, waste: true });
    // світло: старт і перший запис — у 2025, далі 2026
    s0.mrecs.forEach(r => { if (r.meter === 'e1' && r.date === '2026-07-31') r.date = '2025-11-30'; if (r.meter === 'e1' && r.date === '2026-08-31') r.date = '2025-12-31'; });
    await p.goto('http://127.0.0.1:8013/'); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), s0);
    const view = async (k) => { await p.evaluate(k => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.view = k; localStorage.setItem('teplo.v1', JSON.stringify(s)); }, k); await p.goto('http://127.0.0.1:8013/#history'); await p.reload(); await p.waitForTimeout(500); };
    await view('elec');
    if (!dark) {
      const y26 = await p.$('[data-key=elec-history-y2026]'), y25 = await p.$('[data-key=elec-history-y2025]');
      const open26 = y26 && await y26.evaluate(e => e.open), open25 = y25 && await y25.evaluate(e => e.open);
      ok('світло: блоки 2026 (відкритий) і 2025 (згорнутий), новий рік — першим', !!y26 && !!y25 && open26 && !open25
        && await p.evaluate(() => { const a = document.querySelectorAll('.yh > .season'); return a[0].dataset.key.endsWith('2026') && a[1].dataset.key.endsWith('2025'); }), { open26, open25 });
      const s26 = await p.textContent('[data-key=elec-history-sum-2026]'), s25 = await p.textContent('[data-key=elec-history-sum-2025]');
      // 2025: 31.12 — +150 день +80 ніч = 230; 2026: 01.10 (+140 +70) і 31.10 (+130 +75) = 415 (по черзі, без подвійного рахунку)
      ok('світло: за рік — по черзі від попередніх (2025 +230, 2026 +415 кВт·год, ≈ грн)', /\+230\b/.test(s25) && /\+415\b/.test(s26) && /грн/.test(s26), { s25, s26 });
      ok('світло: рядки записів усередині років (4)', (await p.$$('.yh [data-key^=erec-]')).length === 4);
      await p.click('[data-key=elec-history-y2025] > summary'); await p.waitForTimeout(150);
      ok('світло: 2025 розгортається', await p.$eval('[data-key=elec-history-y2025]', e => e.open));
    }
    await p.screenshot({ path: '/tmp/shot_years_elec' + (dark ? '_dark' : '') + '.png', fullPage: true });
    await view('gas');
    if (!dark) ok('газ: блок 2026 з «+… м³»', !!(await p.$('[data-key=gas-history-y2026]')) && /м³/.test(await p.textContent('[data-key=gas-history-y2026] .ss-head')));
    await view('cold');
    if (!dark) ok('холодна вода: блок 2026, сума м³ і грн', /\+\d/.test(await p.textContent('[data-key=water-history-cold-sum-2026]')) && /грн/.test(await p.textContent('[data-key=water-history-cold-sum-2026]')));
    await view('waste');
    if (!dark) ok('вивіз: блок 2026 «Сплачено 180 грн» (60 + 120)', /Сплачено\s*180\s*грн/.test((await p.textContent('[data-key=waste-history-sum-2026]')).replace(/ /g, ' ')), await p.textContent('[data-key=waste-history-sum-2026]').catch(() => null));
    await p.screenshot({ path: '/tmp/shot_years_waste' + (dark ? '_dark' : '') + '.png', fullPage: true });
    ok('без помилок JS' + (dark ? ' (темна)' : ''), !errs.length, errs);
    await ctx.close();
  }
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
