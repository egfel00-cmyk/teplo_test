// 151-а (план конкурентів п. 8, як у YASNO): джерело кожного показання — «з фото», «з фото в чаті», «вписали вручну», «з платіжки».
// Рядок історії — один значок праворуч (камера / бульбашка / картинка), підказка словами; у шапці запису — «з фото», «з фото в чаті»
// (власник 13.11: «введено вручну» не писати); правка цифр — «виправлено», джерело лишається.
// node e2e_src.cjs  (сайт 127.0.0.1:8013)
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
const U = 'http://127.0.0.1:8013/';
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' })).newPage(); p.setDefaultTimeout(6000);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const txt = sel => p.textContent(sel).catch(() => '');
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')));
  const s = demo({ today: '2026-11-02', elec: 1 });
  const ph = n => Array.from({ length: n }, (_, i) => ({ id: 'lp' + i, at: '2026-10-01T10:00:00Z' }));
  const M = id => s.mrecs.find(r => r.id === id);
  // світло: 31.08 — з фото (2 фото), 01.10 — з чату, частину вписали; 31.10 — вписали й потім додали 1 фото; стартові — нічого
  Object.assign(M('m20260831'), { via: 'photo', photos: ph(2) });
  Object.assign(M('m20261001'), { via: 'photo', viaFix: 1, card: 77 });
  Object.assign(M('m20261031'), { via: 'hand', photos: ph(1) });
  // вода: 15.10 — старий запис з фото без via (до 151-ї) → «з фото»; 16.09 — вписали без фото
  s.water.find(r => r.id === 'w20261015').photos = ph(1);
  // тепло: r3 — з фото (source 'photo', старий запис без via), r2 — автовнесення з вхідних бота (auto), r1 — вручну
  Object.assign(s.readings.find(r => r.id === 'r3'), { source: 'photo' });
  Object.assign(s.readings.find(r => r.id === 'r2'), { source: 'photo', auto: true });
  const put = () => p.evaluate(s => { localStorage.clear(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, s);
  const hist = async k => { await p.evaluate(k => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.view = k; localStorage.setItem('teplo.v1', JSON.stringify(s)); }, k); await p.goto('about:blank'); await p.goto(U + '#history'); await p.waitForTimeout(900); };
  await p.goto(U); await put(); await p.reload(); await p.waitForTimeout(300); await put();

  await hist('elec');
  const mark = async key => p.evaluate(k => { const e = document.querySelector('[data-key="' + k + '"] .ph-n'); return e ? { cls: e.className, tip: e.getAttribute('aria-label'), n: (e.querySelector('.num') || {}).textContent || '' } : null; }, key);
  let m = await mark('erec-m20260831');
  ok('рядок світла «з фото»: камера, 2, підказка «З фото · 2 фото»', m && /src-photo/.test(m.cls) && m.n === '2' && m.tip === 'З фото · 2 фото', m);
  m = await mark('erec-m20261001');
  ok('рядок світла з картки чату: бульбашка, «З фото в чаті, частину цифр вписали»', m && /src-chat/.test(m.cls) && /^З фото в чаті, частину цифр вписали$/.test(m.tip), m);
  m = await mark('erec-m20261031');
  ok('вписали, фото додали потім: картинка, «Вписали вручну · 1 фото»', m && /src-hand/.test(m.cls) && m.tip === 'Вписали вручну · 1 фото', m);
  ok('стартові без фото — значка немає', !(await mark('erec-m20260731')));

  // шапка запису: «з фото» — є; вписали — нічого (власник 13.11)
  await p.goto('about:blank'); await p.goto(U + '#erec-m20260831'); await p.waitForTimeout(700);
  ok('запис світла: «… · з фото» у підписі шапки', /· з фото$/.test((await txt('[data-key=rec-sub]')).trim()), await txt('[data-key=rec-sub]'));
  await p.goto('about:blank'); await p.goto(U + '#erec-m20261001'); await p.waitForTimeout(700);
  ok('запис з чату: «з фото в чаті, частину цифр вписали»', /з фото в чаті, частину цифр вписали/.test(await txt('[data-key=rec-sub]')), await txt('[data-key=rec-sub]'));
  await p.goto('about:blank'); await p.goto(U + '#erec-m20261031'); await p.waitForTimeout(700);
  ok('вписали вручну: у шапці про джерело нічого', !/вручну|з фото/.test(await txt('[data-key=rec-sub]')), await txt('[data-key=rec-sub]'));

  // правка цифр запису «з фото» → джерело лишається, у шапці «виправлено»
  await p.goto('about:blank'); await p.goto(U + '#erec-m20260831'); await p.waitForTimeout(700);
  await p.click('[data-key=erec-edit]'); await p.waitForTimeout(600);
  const inp = await p.$('[data-en^="e1|"]'); const v0 = await inp.inputValue(); await inp.fill(String(+v0 + 1));
  await p.click('[data-key=en-save]'); await p.waitForTimeout(800);
  let sv = await st(); const ed = sv.mrecs.find(r => r.id === 'm20260831');
  ok('правка: via лишився photo, editedAt є', ed.via === 'photo' && !!ed.editedAt, { via: ed.via, editedAt: ed.editedAt });
  await p.goto('about:blank'); await p.goto(U + '#erec-m20260831'); await p.waitForTimeout(700);
  ok('після правки: «з фото · виправлено»', /з фото · виправлено/.test(await txt('[data-key=rec-sub]')), await txt('[data-key=rec-sub]'));

  // нове показання вручну → via 'hand', у рядку значка немає
  await p.goto('about:blank'); await p.goto(U + '#enew-elec'); await p.waitForTimeout(800);
  const f1 = await p.$('[data-en^="e1|"]');
  if (f1) { await f1.fill('10600'); await p.click('[data-key=en-save]'); await p.waitForTimeout(800); }
  sv = await st(); const nw = sv.mrecs.filter(r => r.meter === 'e1' && !r.deleted && !r.base).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  ok('нове вручну: via hand', nw && nw.via === 'hand' && !nw.viaFix, nw && { id: nw.id, via: nw.via, z: nw.z });

  // вода: старий запис з фото без via → «з фото»; без фото — нічого
  await hist('cold');
  m = await mark('wrec-w20261015');
  ok('вода, старий запис з фото (до 151-ї): «З фото · 1 фото»', m && /src-photo/.test(m.cls) && m.tip === 'З фото · 1 фото', m);
  ok('вода, вписали без фото: значка немає', !(await mark('wrec-w20260916')));
  // «Додати фото» в «Виправити» до запису, вписаного вручну (тепло r1), — не робить його «з фото»
  await p.goto('about:blank'); await p.goto(U + '#rec-r1'); await p.waitForTimeout(700);
  await p.click('[data-key=rec-edit]'); await p.waitForTimeout(600);
  if (await p.$('#rp-input')) {
    await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 40; c.height = 40; return new Promise(ok => c.toBlob(b0 => { const f = new File([b0], 'a.png', { type: 'image/png' }); const dt = new DataTransfer(); dt.items.add(f); const i = document.getElementById('rp-input'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); ok(); })); });
    await p.waitForTimeout(500); sv = await st(); const hr = sv.readings.find(r => r.id === 'r1');
    ok('тепло: фото до вписаного — via hand, фото 1', hr.via === 'hand' && (hr.photos || []).length === 1, { via: hr.via, n: (hr.photos || []).length });
  } else ok('тепло: «Виправити» з полем фото', false);
  // тепло: старий з фото — камера; автовнесення з вхідних — бульбашка; вручну — нічого; у записі — «з фото»
  await hist('heat');
  m = await mark('reading-r3');
  ok('тепло: r3 «З фото», без числа (фото немає)', m && /src-photo/.test(m.cls) && m.n === '' && m.tip === 'З фото', m);
  m = await mark('reading-r2');
  ok('тепло: автовнесення з вхідних — «З фото в чаті»', m && /src-chat/.test(m.cls), m);
  m = await mark('reading-r1');
  ok('тепло: вписали, фото додали — картинка «Вписали вручну · 1 фото»', m && /src-hand/.test(m.cls) && m.tip === 'Вписали вручну · 1 фото', m);
  ok('тепло: вписали без фото (r0) — значка немає', !(await mark('reading-r0')));
  await p.goto('about:blank'); await p.goto(U + '#rec-r3'); await p.waitForTimeout(700);
  ok('тепло, запис r3: «з фото» у шапці', /з фото/.test(await txt('[data-key=rec-sub]')), await txt('[data-key=rec-sub]'));

  // російська (мова — за мовою браузера)
  const sr = await st(); const q = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' })).newPage();
  await q.goto(U); await q.evaluate(s => { localStorage.clear(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, sr); await q.goto('about:blank'); await q.goto(U + '#erec-m20261001'); await q.waitForTimeout(900);
  const rs = await q.textContent('[data-key=rec-sub]').catch(() => '');
  ok('ru: «с фото в чате, часть цифр вписали»', /с фото в чате, часть цифр вписали/.test(rs), rs);
  ok('без помилок JS', !errs.length, errs);
  await b.close(); console.log(`\n${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})();
