// Світло й газ з фото (движок у браузері, синтетичні табло): T1/T2 → день/ніч, газ; фото — в записі; «лише для себе»; фото до запису.
// node e2e_elec_photo.cjs  (локальний сервер 127.0.0.1:8013)
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  // табло: темний екран зі світлими цифрами (як електронний лічильник) і газ — чорні ролики
  const shot = async (html, path) => { const q = await ctx.newPage(); await q.setContent('<body style="margin:0;background:#888">' + html + '</body>'); await q.locator('#t').screenshot({ path }); await q.close(); };
  const lcd = (z, v) => '<div id="t" style="display:inline-block;padding:40px 50px;background:#cfd9c0;font:700 96px/1 \'DejaVu Sans Mono\',monospace;color:#111"><span style="font-size:48px">' + z + '</span>&nbsp;' + v + ' <span style="font-size:40px">kWh</span></div>';
  await shot(lcd('T1', '010530.5'), '/tmp/elph/t1.png'); await shot(lcd('T2', '005290.1'), '/tmp/elph/t2.png');
  await shot('<div id="t" style="display:inline-block;padding:40px 50px;background:#fff;font:700 110px/1 \'DejaVu Sans Mono\',monospace;color:#111">01256 m³</div>', '/tmp/elph/g.png');
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')));
  await p.goto('http://127.0.0.1:8013/'); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo({ elec: 2, gas: true }));
  await p.goto('http://127.0.0.1:8013/#elec'); await p.reload(); await p.waitForTimeout(500);
  // 07.11.2026: «Розпізнати з фото» — лише на введенні показань, на сторінці лічильника його немає
  ok('сторінка світла: без «Розпізнати з фото»', !(await p.$('[data-key=elec-photo]')) && !(await p.$('#eq-files')));
  await p.click('[data-key=elec-add]'); await p.waitForSelector('#en-files', { state: 'attached' });
  await p.setInputFiles('#en-files', ['/tmp/elph/t1.png', '/tmp/elph/t2.png']);
  await p.waitForSelector('[data-key=en-photo-sum]', { timeout: 180000 });
  const day = await p.inputValue('#en-e1-day'), night = await p.inputValue('#en-e1-night');
  ok('T1 → день 10530, T2 → ніч 5290', day === '10530' && night === '5290', { day, night, sum: await p.textContent('[data-key=en-photo-sum]') });
  ok('попередження «перевірте»', !!(await p.$('[data-key=en-photo-check]')));
  await p.click('#own-chk'); await p.click('[data-key=en-save]'); await p.waitForTimeout(500);
  let s = await st(); const r = s.mrecs.filter(x => x.meter === 'e1' && !x.deleted).slice(-1)[0];
  ok('збережено: «лише для себе», 2 фото в записі', r.own === true && (r.photos || []).length === 2 && r.z.day === '10530', r);
  await p.goto('http://127.0.0.1:8013/#erec-' + r.id); await p.waitForTimeout(400);
  ok('картка запису: фото, «Додати фото показань», «для себе», без «Куди передати»', (await p.$$('[data-key=rec-photos] img')).length === 2 && !!(await p.$('[data-key=rec-photo-add]')) && !!(await p.$('[data-key=own-box].own-box.on')) && !(await p.$('[data-key=where-elec]')));
  await p.setInputFiles('#rp-input', '/tmp/elph/g.png'); await p.waitForTimeout(400); s = await st();
  ok('додали фото до збереженого запису → 3', (s.mrecs.find(x => x.id === r.id).photos || []).length === 3);
  await p.click('[data-key=own-unset]'); await p.waitForTimeout(300); s = await st();
  ok('«Буду передавати» → own знято, з’явилось «Куди передати»', !s.mrecs.find(x => x.id === r.id).own && !!(await p.$('[data-key=where-elec]')));
  // стартові — «передано»
  await p.goto('http://127.0.0.1:8013/#erec-m20260731'); await p.waitForTimeout(300);
  ok('стартові: «Стартові показання передано»', /передано/.test(await p.textContent('[data-key=base-sent-box]')));
  await p.click('[data-key=base-unsent]'); await p.waitForTimeout(300); s = await st();
  ok('«Не передавали» → sent.no', s.mrecs.find(x => x.id === 'm20260731').sent.no === true && !!(await p.$('[data-key=base-mark]')));
  // газ з фото
  await p.goto('http://127.0.0.1:8013/#gas'); await p.waitForTimeout(400);
  await p.click('[data-key=gas-add]'); await p.waitForSelector('#en-files', { state: 'attached' });
  await p.setInputFiles('#en-files', '/tmp/elph/g.png');
  await p.waitForSelector('[data-key=en-photo-sum]', { timeout: 180000 });
  const gv = await p.inputValue('#en-g1-all');
  ok('газ з фото → 1256', /^1256/.test(gv), { gv, sum: await p.textContent('[data-key=en-photo-sum]') });
  await p.screenshot({ path: '/tmp/shot_gnew_photo.png', fullPage: true });
  // електромеханічний з барабаном (як НІК 2102): написи кВт·год, 220 V, 50 Hz, imp/kWh — це світло, не вода (02.11.2026: «цифр барабана не знайшли»)
  await shot('<div id="t" style="display:inline-block;padding:30px 40px;background:#ddd;font:600 34px/1.4 \'DejaVu Sans\',sans-serif;color:#222">HIK 2102-02.M2<br><span style="display:inline-block;background:#111;color:#fff;font:700 96px/1 \'DejaVu Sans Mono\',monospace;padding:6px 14px;letter-spacing:8px">003474</span> kW·h<br>220V 5(60)A 50Hz<br>6400 imp/kW·h</div>', '/tmp/elph/nik.png');
  const mrecsNo = async (o) => { await p.goto('http://127.0.0.1:8013/'); await p.evaluate(s => { s.mrecs = []; localStorage.setItem('teplo.v1', JSON.stringify(s)); }, demo(o)); };
  await mrecsNo({ elec: 1 }); await p.goto('http://127.0.0.1:8013/#photo'); await p.reload(); await p.waitForTimeout(400);
  await p.setInputFiles('#ph-input', ['/tmp/elph/nik.png']); await p.waitForTimeout(200); await p.click('[data-act="ph-run"]');
  await p.waitForSelector('[data-key=en-photo-sum]', { timeout: 180000 }).catch(() => {});
  ok('«З фото» (тепло) з лічильником світла → введення світла, 3474', (await p.evaluate(() => location.hash)) === '#enew' && (await p.inputValue('#en-e1-all').catch(() => '')) === '3474', { h: await p.evaluate(() => location.hash) });
  await mrecsNo({}); await p.goto('http://127.0.0.1:8013/#photo'); await p.reload(); await p.waitForTimeout(400);
  await p.setInputFiles('#ph-input', ['/tmp/elph/nik.png']); await p.waitForTimeout(200); await p.click('[data-act="ph-run"]');
  await p.waitForFunction(() => /лічильник світла/.test(document.body.innerText), null, { timeout: 180000 }).catch(() => {});
  ok('лічильника світла немає → «Додайте його в квартиру: … «Світло»»', (await p.evaluate(() => location.hash)) === '#photo' && /Додайте його в квартиру/.test(await p.evaluate(() => document.body.innerText)));
  await mrecsNo({ elec: 1 }); await p.goto('http://127.0.0.1:8013/#wnew'); await p.reload(); await p.waitForTimeout(400);
  await p.setInputFiles('#wn-files', ['/tmp/elph/nik.png']);
  await p.waitForSelector('[data-key=wn-photo-sum]', { timeout: 180000 }).catch(() => {});
  ok('«Вода з фото» з лічильником світла → «це лічильник світла, не водомір — внести у «Світло»»', /лічильник світла, не водомір/.test(await p.textContent('[data-key=wn-photo-sum]').catch(() => '')) && (await p.getAttribute('[data-key=wn-other-0]', 'href')) === '#enew');
  ok('без помилок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
