// «Скільки це коштувало» за період без лічильника + настройки «Коли лічильник знято». node e2e_gapcost.cjs (локальный сервер 127.0.0.1:8013)
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
const ok = [], bad = []; const check = (c, m) => (c ? ok : bad).push(m);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('http://127.0.0.1:8013/'); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo({}));
  const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')));
  const setDate = async (id, v) => p.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  const est = () => p.textContent('#gp-est');

  // тепло: повірка з 20.10 (ще не повернули) — середнє сезону 2025/26 × опалювальні доби
  await p.goto('http://127.0.0.1:8013/#gap-new-heat'); await p.reload(); await p.waitForTimeout(400);
  check(/дату зняття/.test(await est()), 'без даты — просит дату');
  await p.check('input[name=gp-reason][value=verify]'); await setDate('gp-from', '2026-10-20'); await p.waitForTimeout(150);
  check(await p.inputValue('#gp-pay') === 'avg', 'повірка → «за середнім»');
  let tx = await est();
  check(/2025\/26/.test(tx) && /Методикою розподілу/.test(tx), 'тепло: правило и сезон 2025/26 — ' + tx.slice(0, 160));
  const rows = await p.$$eval('[data-key=gap-est-tbl] tbody tr', r => r.map(x => x.textContent));
  check(rows.length === 3 && /жовтень/.test(rows[0]) && /листопад/.test(rows[1]), 'по месяцам: жовтень, листопад, разом — ' + JSON.stringify(rows));
  check(/0,420/.test(tx) && /646,/.test(tx), 'тепло: ≈0,420 Гкал ≈ 646 грн (13 діб × 3,909/121) — ' + (tx.match(/≈ [\d,]+ ?Гкал/) || [])[0]);
  check(/до сьогодні/.test(tx), 'открытый период — «до сьогодні»');
  // поломка → за площею; платіжка 1300 грн → сравнение
  await p.check('input[name=gp-reason][value=repair]'); await p.waitForTimeout(150);
  check(await p.inputValue('#gp-pay') === 'area', 'поломка → «за площею»');
  check(/площею/.test(await est()), 'правило «за площею»');
  await p.fill('#gp-amount', '1300'); await p.waitForTimeout(150);
  tx = await est(); check(/За вашими платіжками/.test(tx) && /Гкал на місяць/.test(tx), 'сумма из платёжки → сравнение и Гкал/міс');
  // вручную выбранный способ не перебивается причиной
  await p.selectOption('#gp-pay', 'avg'); await p.check('input[name=gp-reason][value=replace]'); await p.waitForTimeout(150);
  check(await p.inputValue('#gp-pay') === 'avg', 'выбранный вручную способ остаётся');
  await setDate('gp-to', '2026-10-30'); await p.click('[data-key=gap-save]'); await p.waitForTimeout(500);
  const hist = await p.textContent('[data-key^=gap-g]').catch(() => '');
  check(/1\s?300|1 300/.test(hist) || hist.length > 0, 'строка периода на странице тепла');

  // вода: поломка без числа прописанных → просит настройки
  await p.goto('http://127.0.0.1:8013/#gap-new-h1'); await p.waitForTimeout(300);
  await setDate('gp-from', '2026-10-01'); await setDate('gp-to', '2026-10-31'); await p.waitForTimeout(150);
  check(/зареєстровано/.test(await est()), 'норма без прописанных — просит указать');
  await p.click('[data-key=ge-to-prefs]'); await p.waitForTimeout(500);
  check(await p.isVisible('#p-persons'), 'переход к настройкам — поле «Зареєстровано осіб» видно');
  await p.fill('#p-persons', '2'); await p.waitForTimeout(100);
  await p.selectOption('#p-normrow', 'chw_bath10'); await p.waitForTimeout(300);
  await p.click('#pg-heat summary'); await p.waitForTimeout(150); await p.fill('#p-area', '52,4'); await p.waitForTimeout(100);
  let s = await st();
  check(s.places[0].water.persons === 2 && s.places[0].water.normRow === 'chw_bath10' && s.places[0].area === 52.4, 'настройки сохранены: ' + JSON.stringify([s.places[0].water.persons, s.places[0].water.normRow, s.places[0].area]));
  await p.goto('http://127.0.0.1:8013/#gap-new-h1'); await p.waitForTimeout(300);
  await setDate('gp-from', '2026-10-01'); await setDate('gp-to', '2026-10-31'); await p.waitForTimeout(150);
  tx = await est();
  check(/Норма 3,00/.test(tx) && /ХТМ \(гаряча\)/.test(tx), 'горячая по норме 3 × 2, раскладка Водоканал/ХТМ — ' + tx.slice(0, 200));
  // холодная: повірка → среднесуточное за 12 месяцев (записи демо 15.04 → 15.10: 410 → 437)
  await p.goto('http://127.0.0.1:8013/#gap-new-c1'); await p.waitForTimeout(300);
  await p.check('input[name=gp-reason][value=verify]'); await setDate('gp-from', '2026-10-16'); await setDate('gp-to', '2026-10-31'); await p.waitForTimeout(150);
  tx = await est(); check(/з ваших показань/.test(tx) && /0,148 м³ на добу/.test(tx), 'холодная: среднее 27 м³ / 183 сут — ' + (tx.match(/Середнє[^.]+/) || [])[0]);
  // на 360 px не ездит вбок
  await p.setViewportSize({ width: 360, height: 740 }); await p.waitForTimeout(200);
  check(await p.evaluate(() => document.documentElement.scrollWidth) <= 360, 'форма с оценкой влезает в 360 px');
  await p.screenshot({ path: '/tmp/gapcost_c1.png', fullPage: true });
  // русский — язык берётся из браузера
  const ctxR = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ru-RU' }); const pr = await ctxR.newPage(); pr.on('pageerror', e => errs.push(e.message));
  await pr.goto('http://127.0.0.1:8013/'); await pr.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), Object.assign(await st(), { lang: 'ru' }));
  await pr.reload(); await pr.waitForTimeout(300);
  await pr.goto('http://127.0.0.1:8013/#gap-new-heat'); await pr.waitForTimeout(300); await pr.check('input[name=gp-reason][value=verify]');
  await pr.evaluate(() => { const el = document.getElementById('gp-from'); el.value = '2026-10-31'; el.dispatchEvent(new Event('change', { bubbles: true })); }); await pr.waitForTimeout(150);
  tx = await pr.textContent('#gp-est'); check(/Сколько это стоило/.test(tx) && /суток отопления|отопительных суток/.test(tx), 'ru: тексты — ' + tx.slice(0, 260));
  await pr.goto('http://127.0.0.1:8013/#prefs'); await pr.waitForTimeout(300);
  await pr.click('#pg-heat summary'); await pr.waitForTimeout(150); await pr.screenshot({ path: '/tmp/gapcost_prefs_ru.png', fullPage: true });
  check(await pr.isVisible('#nometer-h'), 'ru: в настройках «Когда счётчик снят»');
  if (errs.length) bad.push('ошибки страницы: ' + errs.join('; '));
  console.log(ok.map(x => '  OK  ' + x).join('\n')); if (bad.length) console.log(bad.map(x => ' FAIL ' + x).join('\n'));
  console.log(`\n${ok.length}/${ok.length + bad.length}`); await b.close(); process.exit(bad.length ? 1 : 0);
})();
