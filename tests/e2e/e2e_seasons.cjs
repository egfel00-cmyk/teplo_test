// История тепла по отопительным сезонам (система складывает сама): блоки сезонов с Гкал и гривнами, где шло тепло,
// новый раскрыт, старые свёрнуты, май — в прошлой зиме, сентябрь — в новой, «триває» у текущего.
// node e2e_seasons.cjs  (локальный сервер 127.0.0.1:8013)
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const page = async (opts, locale) => { const p = await (await b.newContext({ viewport: { width: 360, height: 800 }, locale: locale || 'uk-UA' })).newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(U); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo(Object.assign({ view: 'heat' }, opts))); await p.goto(U + '#history'); await p.reload(); await p.waitForTimeout(500); return p; };
  let p = await page({ seasons: true });
  const blocks = await p.$$eval('details.season', a => a.map(d => ({ k: d.getAttribute('data-key'), open: d.open, t: d.querySelector('summary').textContent })));
  ok('два сезона: 2025/26 раскрыт, 2024/25 свёрнут', blocks.length === 2 && blocks[0].k === 'season-2025' && blocks[0].open && blocks[1].k === 'season-2024' && !blocks[1].open, blocks);
  ok('итоги: 2025/26 — 5,150 Гкал, 2024/25 — 5,760 Гкал, у обоих гривни', /5,150\s*Гкал/.test(blocks[0].t) && /5,760\s*Гкал/.test(blocks[1].t) && /грн/.test(blocks[0].t) && /грн/.test(blocks[1].t), blocks.map(x => x.t));
  // 07.11.2026: без «тепло за показаннями» и «на місяць опалення» — даты и «/ міс» понятны сами
  ok('где шло тепло и в среднем за месяц', /10 жовтня 2024 – 14 квітня 2025/.test(blocks[1].t) && /грн \/ міс/.test(blocks[1].t) && !/тепло за показаннями|на місяць опалення/.test(blocks[1].t), blocks[1].t);
  ok('май (12.05.2025) — в зиме 2024/25, сентябрь (15.09.2025) — в 2025/26', !!(await p.$('[data-key=season-2024] [data-key=reading-s7]')) && !!(await p.$('[data-key=season-2025] [data-key=reading-s8]')));
  ok('строки сезона — внутри него, новые сверху', (await p.$$eval('[data-key=season-2025] .list > li', a => a.map(x => x.getAttribute('data-key'))))[0] === 'reading-r3');
  await p.click('[data-key=season-2024] summary'); await p.waitForTimeout(200);
  ok('нажал на свёрнутый — раскрылся, строки видны', await p.$eval('[data-key=season-2024]', d => d.open) && await p.isVisible('[data-key=reading-s0]'));
  ok('подсказка: сезоны система складывает сама', /система складає сама/.test(await p.textContent('[data-key=hs-hint]')));
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  ok('не шире экрана', sw <= 360, sw);
  // текущий сезон в январе — «триває»
  p = await page({ seasons: true, today: '2026-01-20' });
  ok('20.01.2026: у сезона 2025/26 — «триває»', /триває/.test(await p.textContent('[data-key=season-2025] summary')));
  // только показания одного сезона — один блок
  p = await page({});
  ok('без прошлых сезонов — один блок 2025/26', (await p.$$('details.season')).length === 1 && /Сезон 2025\/26/.test(await p.textContent('details.season summary')));
  // рус.
  p = await page({ seasons: true }, 'ru-RU');
  ok('ru: даты и «/ мес» (без «тепло по показаниям», «в месяц отопления» — 07.11)', /грн \/ мес/.test(await p.textContent('[data-key=season-2024] summary')) && !/тепло по показаниям|в месяц отопления/.test(await p.textContent('[data-key=season-2024] summary')));
  // итог сезона = сумма его строк, в т. ч. период без лічильника (≈) — раньше ремонт выпадал из суммы (скрин владельца 02.11)
  p = await page({ seasons: true, gaps: true }, 'uk-UA');
  const sm = await p.evaluate(() => { const d = document.querySelector('[data-key=season-2025]'), n = s => parseFloat(String(s).replace(/[^0-9,.-]/g, '').replace(',', '.')) || 0;
    const rows = [...d.querySelectorAll('.list > li .hr-q')].map(e => n(e.textContent)); return { head: n(d.querySelector('.ss-q b').textContent), sum: rows.reduce((a, b) => a + b, 0), est: /≈/.test(d.querySelector('.ss-q').textContent), n: rows.length }; });
  ok('итог сезона 2025/26 = сумма строк (с ремонтом, «≈»)', Math.abs(sm.head - sm.sum) < 0.002 && sm.est && sm.n >= 5, sm);
  const pos = await p.evaluate(() => { const li = document.querySelector('[data-key=season-2025] li.hli-heat'), c = li.querySelector('.st-chip').getBoundingClientRect(), d = li.querySelector('.hr-date').getBoundingClientRect(), r = li.getBoundingClientRect();
    return { top: Math.abs(c.top - d.top) < 14, right: r.right - c.right < 20 }; });
  ok('телефон: статус тепла — в правом верхнем углу карточки, на строке даты', pos.top && pos.right, pos);
  // меню статуса у последней карточки сезона не обрезается рамкой сезона (было overflow:hidden)
  { const li = await p.$$('[data-key=season-2025] li.hli'), lc = li[li.length - 1]; await lc.scrollIntoViewIfNeeded(); await (await lc.$('.st-chip')).click(); await p.waitForTimeout(250);
    const v = await p.evaluate(() => { const m = document.querySelector('.st-menu'), r = m.getBoundingClientRect(); return [[r.left + 20, r.bottom - 8], [r.left + 20, r.top + 8]].every(([x, y]) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest('.st-menu')); }); });
    ok('последняя карточка сезона: меню статуса видно целиком', v); await p.keyboard.press('Escape'); }
  ok('без ошибок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
