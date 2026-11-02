// Период без лічильника: форма → сохранение → история/табло/статистика; тепло (новый → «останні прийняті»), вода (новый № ),
// ошибки формы, удаление. node e2e_gap.cjs (локальный сервер 127.0.0.1:8013)
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
const ok = [], bad = []; const check = (c, m) => (c ? ok : bad).push(m);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto('http://127.0.0.1:8013/'); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo({}));
  const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')));
  const setDate = async (id, v) => p.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);

  // 1. ошибка: без даты
  await p.goto('http://127.0.0.1:8013/#gap-new-heat'); await p.reload(); await p.waitForTimeout(400);
  await p.click('[data-key=gap-save]'); await p.waitForTimeout(200);
  check((await p.textContent('#gp-err')).length > 5, 'без даты — ошибка');
  // 2. тепло: сняли 20.04 при 12.950, поставили новый 05.05 с 0.010 → baseline = 0.010 на 05.05
  await setDate('gp-from', '2026-04-20'); await p.fill('#gp-vFrom', '12.950');
  await setDate('gp-to', '2026-05-05'); await p.fill('#gp-vTo', '0.010');
  await p.check('input[name=gp-reason][value=replace]'); await p.waitForTimeout(100);
  check(await p.isChecked('#gp-fresh'), '«Заміна» ставит «Новий лічильник»');
  await p.fill('#gp-amount', '1 300'); await p.click('[data-key=gap-save]'); await p.waitForTimeout(500);
  let s = await st(), g = (s.places[0].gaps || [])[0];
  check(g && g.what === 'heat' && g.fresh && g.vTo === '0.010' && g.amount === '1300', 'тепло: период сохранён ' + JSON.stringify(g));
  check(s.baseline && s.baseline.date === '2026-05-05' && s.baseline.energy === '0.010', 'тепло: «останні прийняті» = показания нового');
  check((await p.evaluate(() => location.hash)) === '#heat', 'после сохранения — страница тепла');
  // 3. пересечение
  await p.goto('http://127.0.0.1:8013/#gap-new-heat'); await p.waitForTimeout(300);
  await setDate('gp-from', '2026-04-25'); await p.click('[data-key=gap-save]'); await p.waitForTimeout(200);
  check(/перетина/.test(await p.textContent('#gp-err')), 'пересечение периодов — ошибка');
  // 4. вода: холодная c1 снята 20.10 при 437, новый с 3 на 25.10, № 999888
  await p.goto('http://127.0.0.1:8013/#gap-new-c1'); await p.waitForTimeout(300);
  await setDate('gp-from', '2026-10-20'); await p.fill('#gp-vFrom', '437'); await setDate('gp-to', '2026-10-25'); await p.fill('#gp-vTo', '3');
  await p.check('#gp-fresh'); await p.waitForTimeout(100);
  check(await p.isVisible('#gp-serial'), 'вода: поле № нового видно');
  await p.fill('#gp-serial', '999888'); await p.click('[data-key=gap-save]'); await p.waitForTimeout(500);
  s = await st(); const c1 = s.places[0].water.meters.find(m => m.id === 'c1');
  check(c1.serial === '999888', 'вода: № нового водомера записан');
  check((await p.evaluate(() => location.hash)) === '#water-cold', 'после сохранения — страница холодной');
  const drum = await p.getAttribute('[data-key=wmeter-c1] .wdrum', 'aria-label');
  check(drum === '3 м³', 'табло — показания нового (3 м³): ' + drum);
  // 5. ввод воды после замены: 7 м³ — без «менше, ніж минулого разу», +4 м³ от показаний после установки
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.water.push({ id: 'wnew1', place: 'main', date: '2026-10-30', vals: { c1: '7' }, createdAt: '2026-10-30T10:00:00Z', updatedAt: 2 }); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.goto('http://127.0.0.1:8013/#history'); await p.reload(); await p.waitForTimeout(300);
  await p.click('[data-act=view][data-v=cold]'); await p.waitForTimeout(300);
  const row = await p.textContent('[data-key=wrec-wnew1]');
  check(/\+4 м³/.test(row), 'история: +4 м³ от показаний нового: ' + row.replace(/\s+/g, ' '));
  check(await p.isVisible('[data-key=gap-' + s.places[0].gaps.find(x => x.what === 'c1').id + ']'), 'история: строка «Без лічильника»');
  // 6. удаление
  const gid = s.places[0].gaps.find(x => x.what === 'c1').id;
  await p.goto('http://127.0.0.1:8013/#gap-' + gid); await p.waitForTimeout(300);
  await p.click('[data-key=gap-del]'); await p.waitForTimeout(400);
  s = await st(); check(s.places[0].gaps.find(x => x.id === gid).deleted === true, 'удаление — «надгробие» deleted');
  // 7. открытый период → карточка «знято», баннер
  await p.goto('http://127.0.0.1:8013/#gap-new-h1'); await p.waitForTimeout(300);
  await setDate('gp-from', '2026-10-31'); await p.click('[data-key=gap-save]'); await p.waitForTimeout(400);
  check(await p.isVisible('[data-key=gap-open]'), 'открытый период — баннер на странице');
  await p.goto('http://127.0.0.1:8013/#home'); await p.waitForTimeout(300);
  check(/знято/.test(await p.textContent('[data-key=card-hot] .ucard-status')), 'карточка горячей — «Лічильник знято»');
  console.log(ok.map(x => ' OK  ' + x).join('\n'));
  if (bad.length) console.log(bad.map(x => 'FAIL ' + x).join('\n'));
  if (errs.length) console.log('pageerror: ' + errs.join('; '));
  console.log(`\n${ok.length}/${ok.length + bad.length}`); await b.close();
})();
