// «Передача за місяць» (183-я; з розбору конкурентів — «Передати постачальникам: передано N з M»): тихий рядок під назвою квартири на головній
// (значки видів, передані — кольором) → екран #month-<квартира>: «1 з 4», смужка, рядок на вид (статус, куди, дотик — сторінка лічильника), «Не цього місяця».
// Нужен сайт 127.0.0.1:8013 (SITE_DATA=/tmp/teplo_data). node tests/e2e/e2e_month.cjs
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const txt = sel => p.textContent(sel).then(s => String(s || '').replace(/\s+/g, ' ').trim()).catch(() => '');
  // стан кладемо зі сторінки без застосунку (/api/health — той самий origin): інакше відкрита сторінка перемалює маршрут старим станом з пам'яті
  const put = async (s, route) => { await p.goto(U + 'api/health'); await p.evaluate(x => localStorage.setItem('teplo.v1', JSON.stringify(x)), s); await p.goto(U + '#' + route); await p.waitForTimeout(900); };
  // 2.11: світло (31.10 внесено, вікно 30.10–3.11), гаряча й холодна (до 20-го), газ (1.11 внесено, вікно 1–5), тепло — вікно з 5-го
  const s0 = demo({ elec: true, gas: true });
  await put(s0, 'home');
  ok('головна: рядок «Передано 0 з 4 за листопад», значки 4 видів, жоден не кольором', /Передано 0 з 4 за листопад/.test(await txt('[data-key=mo-main]')) && (await p.$$('[data-key=mo-main] .mo-k')).length === 4 && !(await p.$('[data-key=mo-main] .mo-k.on')), await txt('[data-key=mo-main]'));
  ok('…рядок — над картками лічильників', await p.evaluate(() => { const a = document.querySelector('[data-key=mo-main]'), c = document.querySelector('.ucards'); return !!(a && c && (a.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING)); }));
  // холодну передано 2.11 (Водоканал), гаряча — лише Водоканалу (ХТМ ще ні) → 1 з 4
  const s1 = JSON.parse(JSON.stringify(s0)); s1.water.push({ id: 'wnov', place: 'main', date: '2026-11-02', vals: { h1: '176', c1: '440' }, createdAt: '2026-11-02T09:00:00Z', updatedAt: 2, sent: { vk: '2026-11-02' } });
  await put(s1, 'home');
  ok('холодна передана → «Передано 1 з 4», кольором — один значок (холодна)', /Передано 1 з 4/.test(await txt('[data-key=mo-main]')) && (await p.$$('[data-key=mo-main] .mo-k.on')).length === 1 && !!(await p.$('[data-key=mo-main] .mo-k.on .c-cold')), await txt('[data-key=mo-main]'));
  await p.click('[data-key=mo-main]'); await p.waitForTimeout(700);
  ok('дотик → екран #month-main «Передача за листопад»', /#month-main$/.test(p.url()) && (await txt('h1')) === 'Передача за листопад', [p.url(), await txt('h1')]);
  ok('…«1 з 4 передано», смужка: 4 частини, заповнена одна', (await txt('[data-key=mo-n]')) === '1 з 4' && (await p.$$('.mo-bar i')).length === 4 && (await p.$$('.mo-bar i.on')).length === 1, await txt('[data-key=mo-sum]'));
  const rows = await p.$$eval('[data-key=mo-list] .mo-row', l => l.map(a => a.getAttribute('data-key')));
  ok('…рядки цього місяця в порядку видів: світло, гаряча, холодна, газ', JSON.stringify(rows) === JSON.stringify(['mo-row-elec', 'mo-row-hot', 'mo-row-cold', 'mo-row-gas']), rows);
  ok('…холодна — «Передано цього місяця» зеленим і галочка', (await p.$eval('[data-key=mo-row-cold]', a => a.classList.contains('done') && !!a.querySelector('.mo-done'))) && /Передано цього місяця/.test(await txt('[data-key=mo-st-cold]')) && (await p.$eval('[data-key=mo-st-cold]', e => e.classList.contains('ok'))), await txt('[data-key=mo-st-cold]'));
  ok('…гаряча — одному передано, іншому ні (Водоканал прийняв · ХТМ — ще ні)', /ХТМ/.test(await txt('[data-key=mo-st-hot]')) && !(await p.$eval('[data-key=mo-row-hot]', a => a.classList.contains('done'))), await txt('[data-key=mo-st-hot]'));
  ok('…«Не цього місяця»: опалення з датою відкриття вікна', /Не цього місяця/.test(await txt('.mo-gs')) && /5 листопада/.test(await txt('[data-key=mo-later] [data-key=mo-st-heat]')), await txt('[data-key=mo-later]'));
  await p.setViewportSize({ width: 320, height: 700 }); await p.waitForTimeout(300);
  ok('320 px: без горизонтальної прокрутки', await p.evaluate(() => document.documentElement.scrollWidth <= 321));
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(200);
  await p.click('[data-key=mo-row-cold]'); await p.waitForTimeout(700);
  ok('дотик по рядку → сторінка холодної води', /#water-cold$/.test(p.url()), p.url());
  await p.goto(U + '#month-main'); await p.waitForTimeout(600); await p.click('[data-key=mo-back]'); await p.waitForTimeout(600);
  ok('«← Квартири» → головна', /#home$/.test(p.url()), p.url());
  // усе передано
  const s2 = JSON.parse(JSON.stringify(s1)); s2.water.find(w => w.id === 'wnov').sent.htm = '2026-11-02';
  s2.mrecs.forEach(r => { if (!r.base && !(r.sent && Object.keys(r.sent).length)) r.sent = r.kind === 'gas' ? { grm: r.date } : { obl: r.date }; });
  await put(s2, 'home');
  ok('усе передано → «Усе передано за листопад» (зеленим), усі значки кольором', /Усе передано за листопад/.test(await txt('[data-key=mo-main]')) && (await p.$eval('[data-key=mo-main]', a => a.classList.contains('all'))) && (await p.$$('[data-key=mo-main] .mo-k.on')).length === 4, await txt('[data-key=mo-main]'));
  await p.goto(U + '#month-main'); await p.waitForTimeout(600);
  ok('…екран: «4 з 4 усе передано»', (await txt('[data-key=mo-n]')) === '4 з 4' && /усе передано/.test(await txt('[data-key=mo-sum]')), await txt('[data-key=mo-sum]'));
  // ru
  { // мова — за мовою браузера (перемикача немає)
    const c2 = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' }), q = await c2.newPage(); q.on('pageerror', e => errs.push(e.message));
    const tq = sel => q.textContent(sel).then(s => String(s || '').replace(/\s+/g, ' ').trim()).catch(() => '');
    const s3 = JSON.parse(JSON.stringify(s1)); s3.lang = 'ru';
    await q.goto(U + 'api/health'); await q.evaluate(x => localStorage.setItem('teplo.v1', JSON.stringify(x)), s3); await q.goto(U + '#home'); await q.waitForTimeout(900);
    ok('ru: «Передано 1 из 4 за ноябрь»', /Передано 1 из 4 за ноябрь/.test(await tq('[data-key=mo-main]')), await tq('[data-key=mo-main]'));
    await q.goto(U + '#month-main'); await q.waitForTimeout(600);
    ok('ru: «Передача за ноябрь», «Не в этом месяце»', (await tq('h1')) === 'Передача за ноябрь' && /Не в этом месяце/.test(await tq('.mo-gs')), await tq('h1'));
    await c2.close();
  }
  // дві квартири: у другої (лише холодна) — один вид, рядка немає; у першої — у тілі розкривашки
  const s4 = demo({ elec: true, gas: true, second: true }); s4.homeOpen = { main: true, p2: true }; await put(s4, 'home');
  ok('дві квартири: рядок першої — у розкривашці, у другої (один вид) — немає', !!(await p.$('.pacc-body > [data-key=mo-main]')) && !(await p.$('[data-key=mo-p2]')));
  await p.goto(U + '#month-p2'); await p.waitForTimeout(700);
  ok('#month-p2 — друга квартира: назва під заголовком, один рядок (холодна)', /^Мамина · /.test(await txt('[data-key=mo-place]')) && (await p.$$('[data-key=mo-list] .mo-row')).length === 1, [await txt('[data-key=mo-place]'), await txt('[data-key=mo-list]')]);
  ok('без помилок JS', !errs.length, errs);
  await b.close(); console.log(`\ne2e_month: ${pass} ok, ${fail} fail`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
