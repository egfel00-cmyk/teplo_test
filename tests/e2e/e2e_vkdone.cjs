// Сайт Водоканалу: показания периода уже приняты (живой «Перевірити» владельца 07.11.2026 — полей ввода нет, блоки «Передані показання за
// листопад 2026 … ПРИЙНЯТІ»). Раньше — «сторінка, яку ми не впізнали»; теперь — что уже на сайте, повірка, «Позначити передано» при тех же цифрах.
// Нужны: сайт 127.0.0.1:8013 (config.php: 'vk_cab_base' => 'http://127.0.0.1:8098'), кабинет: php -S 127.0.0.1:8098 tests/vk-mock/router.php (рахунок 905616)
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const fs = require('fs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', VM = 'http://127.0.0.1:8098', DATA = process.env.SITE_DATA || '/tmp/teplo_data';
(async () => {
  await fetch(VM + '/__reset');
  const n = Math.floor(Date.now() / 1000); fs.mkdirSync(DATA + '/cache', { recursive: true });
  fs.writeFileSync(DATA + '/cache/vk_status.json', JSON.stringify({ cab: { state: 'ok', at: n, since: n - 3600, everOk: true, lastOk: n, code: 200 } }));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const wait = ms => p.waitForTimeout(ms), txt = sel => p.textContent(sel).catch(() => '');
  // страница записи: «Куди передати» раскрыть, «Перевірити» (что видит сайт)
  const rec = async () => { await p.goto(U + '#wrec-w20261106'); await wait(1500); const el = await p.$('[data-key=where-water]'); if (el && await el.evaluate(d => d.open === false)) { await (await el.$('summary')).click(); await wait(300); }
    if (!(await p.$('[data-key=vkc-done]'))) { const c = await p.$('[data-key=vkc-check]'); if (c) { await c.click(); await wait(2500); } } };
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(500);
  ok('регистрация', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'vd' + Date.now() + '@teplo.test') === 200);
  // квартира подключена к сайту: рахунок с принятыми за листопад показаниями; записей воды за ноябрь пока нет
  await p.evaluate(([s]) => { s.places[0].water.account = '905616'; s.places[0].water.surname = 'Шевченко'; s.water = s.water.filter(r => r.date < '2026-11-01'); s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, [demo({ today: '2026-11-06' })]);
  await p.reload(); await wait(1200);
  await p.goto(U + '#vkcab'); await wait(1200);
  await p.click('[data-key=vkc-check]'); await wait(2500);
  const box = await txt('[data-key=vkc-done]');
  ok('«Перевірити»: не «незнайома сторінка», а «вже прийняв показання за листопад 2026»', !!box && /вже прийняв показання за листопад 2026/.test(box) && !(await p.$('[data-key^=vkc-err]')), box || await txt('main'));
  ok('…оба лічильника сайта: вид, №, цифры, «прийнято»', /Гаряча № 8221019 — 132 м³ · прийнято/.test(box) && /Холодна № 8254605 — 179 м³ · прийнято/.test(box), box);
  ok('…повірка: гаряча — срок прошёл (warn), холодна — «до 7 листопада 2026»', /термін повірки — 7 лютого 2026/.test(await txt('[data-key=vkc-d-8221019]')) && !!(await p.$('[data-key=vkc-d-8221019] [data-key=vkc-ver-over]'))
    && /повірка — до 7 листопада 2026/.test(await txt('[data-key=vkc-d-8254605]')), [await txt('[data-key=vkc-d-8221019]'), await txt('[data-key=vkc-d-8254605]')]);
  ok('…адрес с сайта рядом с «знайшов рахунок»', /пр\. Перемоги 1, кв\. 2/.test(await txt('[data-key=vkc-found]')), await txt('[data-key=vkc-found]'));
  await p.setViewportSize({ width: 320, height: 700 }); await wait(300); ok('320 px: без горизонтальной прокрутки', await p.evaluate(() => document.documentElement.scrollWidth <= 321)); await p.setViewportSize({ width: 390, height: 844 });
  if (process.env.SHOT) await (await p.$('[data-key=vkc]')).screenshot({ path: '/tmp/vk_done.png' });
  // запись за ноябрь с теми же цифрами → «Позначити «Передано»» на странице воды
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.water.push({ id: 'w20261106', place: 'main', date: '2026-11-06', vals: { h1: '132', c1: '179' }, createdAt: '2026-11-06T10:00:00Z', updatedAt: Date.now() }); s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await wait(1000); await rec();
  ok('запись с теми же цифрами: «ті самі цифри — вже передано» и кнопка «Позначити «Передано»»', /ті самі цифри/.test(await txt('[data-key=vkc-done-same]')) && !!(await p.$('[data-key=vkc-done-mark]')), await txt('[data-key=vkc]'));
  if (await p.$('[data-key=vkc-done-mark]')) { await p.click('[data-key=vkc-done-mark]'); await wait(600); }
  const r = ((await st()).water || []).find(x => x.id === 'w20261106');
  ok('…нажали → запись «передано» Водоканалу', !!(r && r.sent && r.sent.vk), r && r.sent);
  // другие цифры → предупреждение, отправки нет
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); const w = s.water.find(x => x.id === 'w20261106'); w.vals = { h1: '140', c1: '179' }; w.sent = {}; w.updatedAt = Date.now(); s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await wait(1000); await rec();
  ok('другие цифры → «у вас інші цифри (ваші / на сайті)», без «Відправити»', /140 \/ 132/.test(await txt('[data-key=vkc-done-diff]')) && !(await p.$('[data-key=vkc-send]')), await txt('[data-key=vkc]'));
  const sent = await (await fetch(VM + '/__store')).json(); ok('на сайт ничего не отправляли', !Object.values(sent).some(x => x && x.sent), sent);
  ok('без ошибок JS', !errs.length, errs);
  await b.close(); console.log(`\nИтог: ${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})();
