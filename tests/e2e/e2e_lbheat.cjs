// 140-а: перший робот для тепла — Ізяслав (izt, лист на iz_teplo@ukr.net). Квартира в Ізяславі, лічильник QALCOSONIC E3 (MWh) →
// майстер (дата, енергія) → «Передача постачальнику тепла» → «Підключити» (рахунок, ПІБ, адреса з квартири, згода) → «Відправити у фоні» (одне число
// в МВт·год) → у черзі до 25-го (вікно 25–30) → лист пішов (статус у базі) → запис тепла «Передано», банер «Лист надіслано».
// Потрібні: сайт 127.0.0.1:8013, SQLite /tmp/teplo_data/dev.sqlite, у config.php пошта: 'smtp_host' => '127.0.0.1', 'smtp_from' => 'robot@peredai.com.ua' (лист не шлемо — статус ставимо в базі).
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const { execFileSync } = require('child_process');
const U = 'http://127.0.0.1:8013/', DB = (process.env.SITE_DATA || '/tmp/teplo_data') + '/dev.sqlite';
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const sql = (q, a) => execFileSync('php', ['-r', '$p=new PDO("sqlite:' + DB + '"); $s=$p->prepare($argv[1]); $s->execute(json_decode($argv[2], true)); echo json_encode($s->fetchAll(PDO::FETCH_ASSOC));', q, JSON.stringify(a || [])]).toString();
(async () => {
  try { sql("DELETE FROM rate_limits WHERE k LIKE 'register%' OR k LIKE 'lb_%'"); } catch (e) {}
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' })).newPage(); p.setDefaultTimeout(6000);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const wait = ms => p.waitForTimeout(ms), txt = sel => p.textContent(sel).catch(() => '');
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(500);
  ok('реєстрація', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'lbh' + Date.now() + '@teplo.test') === 200);
  const s = demo({ today: '2026-11-26' });
  s.places[0].address = 'м. Ізяслав, вул. Шевченка, 7, кв. 4'; s.places[0].city = { n: 'Ізяслав', r: 'km' };
  s.meter = s.places[0].meter = { modelId: 'qalcosonic_e3', unit: 'MWh' }; s.updatedAt = Date.now();
  await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), s);
  await p.goto(U + '#home'); await p.reload(); await wait(1200);
  await p.evaluate(() => document.querySelector('[data-act=read]').click()); await wait(500);
  await p.click('[data-act=step-next]'); await wait(400);
  await p.fill('#f-energy', '12.500'); await p.click('[data-act=step-next]'); await wait(700);
  await p.click('[data-key=check-send]'); await wait(2500);
  const wh = await txt('[data-key=where-heat-lite]');
  ok('«Куди передати»: КП «Ізяславтепломережа», з 25 по 30, і пропозиція надсилати листом самим', /Ізяславтепломережа/.test(wh) && /з 25 по 30/.test(wh) && /e-mail/.test(await txt('[data-key=lb-lead]')) && !!(await p.$('[data-key=lb-open]')), wh.slice(0, 300));
  await p.click('[data-key=lb-open]'); await wait(300);
  ok('форма: рахунок, ПІБ, адреса квартири вже підставлена, згода', !!(await p.$('#lb-acc')) && !!(await p.$('#lb-name')) && /Ізяслав/.test(await p.inputValue('#lb-addr').catch(() => '')) && !!(await p.$('[data-key=lb-consent]')));
  await p.fill('#lb-acc', '3021'); await p.fill('#lb-name', 'Петренко Іван'); await p.check('[data-key=lb-consent]'); await p.click('[data-key=lb-save]'); await wait(1500);
  ok('підключено: рахунок 3021', /3021/.test(await txt('[data-key=lb-on]')), [await txt('[data-key=lb-on]'), await txt('[data-key=lb-err]')]);
  ok('«Відправити у фоні» — що піде: «Енергія, МВт·год — 12.500»', !!(await p.$('[data-key=lb-bg]')) && /МВт·год — 12\.500/.test(await txt('[data-key=lb-bg-note]')), await txt('[data-key=lb-bg-note]'));
  await p.click('[data-key=lb-bg]'); await wait(1200);
  const job = JSON.parse(sql("SELECT id, status, payload FROM cab_jobs WHERE prov = 'Lizt' ORDER BY id DESC LIMIT 1"))[0] || {}, pl = JSON.parse(job.payload || '{}');
  ok('черга: одне число 12.500, одиниця MWh, вид heat; «Надішлемо …» і «Скасувати» (до 25-го)', job.status === 'queued' && (pl.items || []).length === 1 && pl.items[0].value === '12.500' && pl.items[0].unit === 'MWh' && pl.items[0].kind === 'heat'
    && (new Date().getDate() >= 25 && new Date().getDate() <= 30 || (/Надішлемо/.test(await txt('[data-key=lb-q]')) && !!(await p.$('[data-key=lb-cancel]')))), [job.status, pl.items, await txt('[data-key=lb-q]')]);
  let r = (await st()).readings.slice(-1)[0];
  ok('запис тепла ще не «Передано», у ньому — номер черги', r.status !== 'accepted' && r.lbJob && r.lbJob.job === +job.id, [r.status, r.lbJob]);
  sql("UPDATE cab_jobs SET status = 'sent', result = ? WHERE id = ?", [JSON.stringify({ text: 'e-mail → iz_teplo@ukr.net' }), +job.id]);
  await p.reload(); await wait(3000);
  r = (await st()).readings.slice(-1)[0];
  ok('лист пішов → запис «Передано» (прийнятий, база наступного місяця), банер «Передано — показання на …» і «Лист надіслано»', r.status === 'accepted' && !!(await p.$('[data-key=hl-sent]')) && /iz_teplo@ukr\.net/.test(await txt('[data-key=lb-done]')),
    [r.status, await txt('[data-key=lb-done]'), await txt('[data-key=ho-status]')]);
  if (process.env.SHOT) await (await p.$('[data-key=where-heat-lite]')).screenshot({ path: '/tmp/lb_heat.png' });
  ok('без помилок JS', !errs.length, errs);
  await b.close(); console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); process.exit(fail ? 1 : 0);
})();
