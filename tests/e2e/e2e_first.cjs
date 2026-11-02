// Первый вход (#welcome → #start → очередь настройки): квартира «Моя квартира», 5 видов с образцами табло, «з фото» у
// «Показання зараз», «Скасувати» возвращает к выбору, вход на новом устройстве, вошедший без счётчиков.
// node e2e_first.cjs  (локальный сервер 127.0.0.1:8013)
const { chromium } = require('playwright');
const fs = require('fs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 360, height: 800 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  const hash = () => p.evaluate(() => location.hash);
  const fresh = async () => { await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.goto(U + '#'); await p.reload(); await p.waitForTimeout(500); };
  // синтетика для «з фото»: водомер (чёрные ролики) и электронное табло
  fs.mkdirSync('/tmp/fsph', { recursive: true });
  const shot = async (html, path) => { const q = await ctx.newPage(); await q.setContent('<body style="margin:0;background:#888">' + html + '</body>'); await q.locator('#t').screenshot({ path }); await q.close(); };
  await shot('<div id="t" style="display:inline-block;padding:40px 50px;background:#fff;font:700 110px/1 \'DejaVu Sans Mono\',monospace;color:#111">00175 m³</div>', '/tmp/fsph/w.png');
  await shot('<div id="t" style="display:inline-block;padding:40px 50px;background:#cfd9c0;font:700 96px/1 \'DejaVu Sans Mono\',monospace;color:#111"><span style="font-size:48px">T1</span>&nbsp;010530.5 <span style="font-size:40px">kWh</span></div>', '/tmp/fsph/t1.png');

  // 1. привітання
  await fresh();
  ok('привітання: 4 табло (тепло, вода, світло, газ) і 4 пункти', (await p.$$('[data-key=welcome-hero] figure')).length === 4 && !!(await p.$('[data-key=welcome-hero] .lcd:not(.elcd)')) && !!(await p.$('[data-key=welcome-hero] .wdrum')) && !!(await p.$('[data-key=welcome-hero] .elcd')) && !!(await p.$('[data-key=welcome-hero] .gdrum')) && (await p.$$('.welcome li')).length === 4);
  const wtxt = await p.textContent('.welcome');
  ok('у тексті — світло й газ, «з фото», кілька квартир, «лише для себе»', /світло й газ/.test(wtxt) && /З фото/.test(wtxt) && /Кілька квартир/.test(wtxt) && /лише для себе/.test(wtxt));
  await p.click('[data-key=welcome-start]'); await p.waitForTimeout(400);
  ok('«Почати» → #start: 5 видів з образцями табло', (await hash()) === '#start' && (await p.$$('.aw-kind .kprev')).length === 5 && /Які лічильники є у вашій квартирі/.test(await p.textContent('h1')));
  ok('підказка про інші квартири («+ Квартира»)', /\+ Квартира/.test(await p.textContent('[data-key=fs-more]')));
  ok('без води — один крок, без «Крок 1 з …»', !(await p.$('.wiz-top')) && /Почати налаштування/.test(await p.textContent('[data-key=aw-create]')));
  await p.click('[data-key=aw-create]'); await p.waitForTimeout(300);
  ok('нічого не позначили → попередження, лишаємось', (await hash()) === '#start' && /хоча б один/.test(await p.textContent('[data-key=aw-err]')));
  // 2. вибір: тепло, гаряча ×1, холодна ×1, світло
  for (const k of ['heat', 'hot', 'cold', 'elec']) { await p.click('[data-key=aw-' + k + '-inc]'); await p.waitForTimeout(120); }
  ok('попередження зникло, тепла більше 1 не буває', !(await p.$('[data-key=aw-err]')) && await p.$eval('[data-key=aw-heat-inc]', e => e.disabled));
  ok('з водою — «Крок 1 з 2» і «Далі»', /Крок 1 з 2/.test(await p.textContent('.wiz-top')) && !!(await p.$('[data-key=aw-next]')));
  await p.click('[data-key=aw-next]'); await p.waitForTimeout(300);
  ok('крок 2: рахунок Водоканалу і «Перевірте» з «Моя квартира» та лічильниками', !!(await p.$('#aw-acc')) && /Моя квартира/.test(await p.textContent('[data-key=aw-sum]')) && /Опалення · Гаряча вода · Холодна вода · Світло/.test(await p.textContent('[data-key=aw-sum]')));
  await p.fill('#aw-acc', '1234567'); await p.fill('#aw-sn', 'Іваненко');
  await p.click('[data-key=aw-create]'); await p.waitForTimeout(400);
  let s = await st();
  ok('рахунок — у першій квартирі, нової квартири не з’явилось', s.places.length === 1 && s.places[0].water.account === '1234567' && s.places[0].water.surname === 'Іваненко', s.places);
  ok('черга: #wadd гарячої, «Налаштування: лічильник 1 з 4», камера у «Показання зараз»', (await hash()) === '#wadd' && /лічильник 1 з 4/.test(await p.textContent('[data-key=aw-queue]')) && !!(await p.$('[data-key=cam-wa-val]')));
  // «Скасувати», поки нічого не збережено, — назад до вибору, вибір цілий
  await p.click('#wa-form a.btn.sec'); await p.waitForTimeout(300);
  ok('«Скасувати» → назад до «Перевірте», вибір і рахунок цілі', (await hash()) === '#start' && /Опалення · Гаряча вода · Холодна вода · Світло/.test(await p.textContent('[data-key=aw-sum]')) && (await p.inputValue('#aw-acc')) === '1234567');
  await p.click('[data-key=aw-back]'); await p.waitForTimeout(200);
  ok('«Назад» → вибір, позначене на місці', /1/.test(await p.textContent('[data-key=aw-hot-n]')) && /1/.test(await p.textContent('[data-key=aw-heat-n]')));
  await p.click('[data-key=aw-next]'); await p.waitForTimeout(200); await p.click('[data-key=aw-create]'); await p.waitForTimeout(400);
  // з фото: водомір 175
  await p.setInputFiles('[data-sphoto=wa-val]', '/tmp/fsph/w.png');
  await p.waitForFunction(() => { const h = document.getElementById('wa-val-ph'); return h && !h.querySelector('.spin') && h.textContent.trim(); }, null, { timeout: 180000 });
  const wv = await p.inputValue('#wa-val');
  ok('з фото: у «Показання зараз» 175 і «звірте з лічильником»', /^175/.test(wv) && /звірте/.test(await p.textContent('#wa-val-ph')), { wv, help: await p.textContent('#wa-val-ph') });
  await p.click('[data-key=wa-save]'); await p.waitForTimeout(400); s = await st();
  ok('гарячу додано зі стартовими 175, onboarded', s.onboarded === true && s.places[0].water.meters.filter(m => m.kind === 'hot').length === 1 && (s.water || []).some(r => r.base && Object.values(r.vals).some(v => /^175/.test(v))));
  ok('далі холодна: «2 з 4», «Скасувати» тепер на головну', (await hash()) === '#wadd' && /2 з 4/.test(await p.textContent('[data-key=aw-queue]')) && (await p.getAttribute('#wa-form a.btn.sec', 'href')) === '#home');
  await p.click('[data-key=aw-q-later]'); await p.waitForTimeout(400); s = await st();
  ok('«Налаштую пізніше» → холодна без деталей, далі світло «3 з 4» з камерою', s.places[0].water.meters.filter(m => m.kind === 'cold').length === 1 && (await hash()) === '#eadd' && /3 з 4/.test(await p.textContent('[data-key=aw-queue]')) && !!(await p.$('[data-key=cam-ea-v-all]')));
  await p.click('[data-key=ea-z2]'); await p.waitForTimeout(300);
  await p.setInputFiles('[data-sphoto=ea-v-day]', '/tmp/fsph/t1.png');
  await p.waitForFunction(() => { const h = document.getElementById('ea-v-day-ph'); return h && !h.querySelector('.spin') && h.textContent.trim(); }, null, { timeout: 180000 });
  ok('світло з фото: T1 → день 10530', (await p.inputValue('#ea-v-day')) === '10530', { day: await p.inputValue('#ea-v-day'), help: await p.textContent('#ea-v-day-ph') });
  await p.fill('#ea-v-night', '5290'); await p.click('[data-key=ea-save]'); await p.waitForTimeout(400); s = await st();
  ok('світло двозонне зі стартовими день/ніч', (s.places[0].meters || []).some(m => m.kind === 'elec' && m.zones === 2) && (s.mrecs || []).some(r => r.base && r.z.day === '10530' && r.z.night === '5290'));
  ok('останній — теплолічильник: #meter, «4 з 4»', (await hash()) === '#meter' && /4 з 4/.test(await p.textContent('[data-key=aw-queue]')));
  await p.click('input[name=model] >> nth=0'); await p.waitForTimeout(300);
  await p.click('[data-key=meter-save]'); await p.waitForTimeout(400);
  ok('модель обрано → «Останні прийняті» (#baseline)', (await hash()) === '#baseline', await hash());
  await p.click('[data-act=skip-base]'); await p.waitForTimeout(400);
  s = await st();
  ok('після тепла — головна з 4 картками', (await hash()) === '#home' && !!(await p.$('[data-key=card-heat]')) && !!(await p.$('[data-key=card-hot]')) && !!(await p.$('[data-key=card-cold]')) && !!(await p.$('[data-key=card-elec]')), await hash());
  ok('на головній — «Моя квартира» і «+ Квартира»', /Моя квартира/.test(await p.textContent('[data-key=home-place-name]')) && !!(await p.$('[data-key=home-add-place]')));
  await p.goto(U + '#start'); await p.waitForTimeout(300);
  ok('#start після налаштування → головна', (await hash()) === '#home' || /home/.test(await p.getAttribute('main', 'data-screen') || '') || !(await p.$('.aw-kinds')));

  // 3. лише газ: один екран, після нього — головна і «Готово!»
  await fresh(); await p.goto(U + '#start'); await p.waitForTimeout(300);
  await p.click('[data-key=aw-gas-inc]'); await p.click('[data-key=aw-create]'); await p.waitForTimeout(400);
  ok('лише газ → #gadd «1 з 1»', (await hash()) === '#gadd' && /1 з 1/.test(await p.textContent('[data-key=aw-queue]')));
  await p.fill('#ea-v-all', '1225,4'); await p.click('[data-key=ea-save]'); await p.waitForTimeout(500); s = await st();
  ok('газ додано → головна з карткою газу, тост «Готово!»', (await hash()) === '#home' && !!(await p.$('[data-key=card-gas]')) && /Готово/.test(await p.textContent('#toast-host')), await p.textContent('#toast-host'));

  // 4. «Налаштую пізніше» на першому ж водомірі — теж вважається налаштуванням
  await fresh(); await p.goto(U + '#start'); await p.waitForTimeout(300);
  await p.click('[data-key=aw-cold-inc]'); await p.click('[data-key=aw-next]'); await p.waitForTimeout(200); await p.click('[data-key=aw-skip]'); await p.waitForTimeout(400);
  await p.click('[data-key=aw-q-later]'); await p.waitForTimeout(500); s = await st();
  ok('холодна «пізніше» → головна, а не привітання', s.onboarded === true && (await hash()) === '#home' && !!(await p.$('[data-key=card-cold]')));

  // 5. рос. мова
  const pr = await (await b.newContext({ viewport: { width: 360, height: 800 }, locale: 'ru-RU' })).newPage();
  await pr.goto(U); await pr.evaluate(() => localStorage.clear()); await pr.reload(); await pr.waitForTimeout(500);
  ok('ru: «Все счётчики квартиры — в одном месте»', /Все счётчики квартиры/.test(await pr.textContent('h1')));
  await pr.goto(U + '#start'); await pr.waitForTimeout(300);
  ok('ru: «Какие счётчики есть в вашей квартире?»', /Какие счётчики есть/.test(await pr.textContent('h1')));

  // 6. вхід: новий акаунт без лічильників → «Ви увійшли — налаштуймо…» → вибір (раніше вів на модель теплолічильника)
  const pl = await (await b.newContext({ viewport: { width: 360, height: 800 }, locale: 'uk-UA' })).newPage();
  const email = 'first' + Date.now() + '@example.ua', pwd = 'first test 123';
  await pl.goto(U); await pl.evaluate(() => localStorage.clear()); await pl.reload(); await pl.waitForTimeout(500);
  await pl.click('[data-key=welcome-login]'); await pl.waitForTimeout(300);
  await pl.click('[data-key=login-toggle]'); await pl.waitForTimeout(200);
  await pl.fill('#a-email', email); await pl.fill('#a-pass', pwd); await pl.click('[data-key=login-submit]'); await pl.waitForTimeout(1200);
  ok('реєстрація без лічильників → вибір лічильників (#start)', (await pl.evaluate(() => location.hash)) === '#start' && !!(await pl.$('.aw-kinds')), await pl.evaluate(() => location.hash));
  await pl.goto(U + '#welcome'); await pl.reload(); await pl.waitForTimeout(800);
  ok('вошедший без лічильників: «Ви увійшли — налаштуймо ваші лічильники» (не «Новий водомір»)', /налаштуймо ваші лічильники/.test(await pl.textContent('h1')) && /Обрати лічильники/.test(await pl.textContent('[data-key=welcome-start]')), await pl.textContent('h1'));

  ok('без помилок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
