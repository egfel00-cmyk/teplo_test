// Світло (этап 3): новий електролічильник (зони, стартові), головна, введення (помилки, «сума зон», «менше»), «Куди передати»
// (Харківобленерго, цифри по зонах, «Я передав(ла)»), історія/статистика/економія, правка, прибрати/повернути, мастер квартиры.
// Локальный сервер 127.0.0.1:8013. Запуск: cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_elec.cjs
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, i) => { console.log((c ? '  OK  ' : ' FAIL ') + n + (!c && i !== undefined ? '  → ' + JSON.stringify(i) : '')); c ? pass++ : fail++; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')));
  const hash = () => p.evaluate(() => location.hash);
  // настройки счётчика на его странице свёрнуты в блоке «прибора» — в тестах раскрываем
  const go = async (r) => { await p.goto('http://127.0.0.1:8013/#' + r); await p.waitForTimeout(350); await p.evaluate(() => document.querySelectorAll('details.mbox-set').forEach(d => { d.open = true; })); };
  const click = async (sel, w) => { await p.click(sel); await p.waitForTimeout(w || 300); };
  await p.goto('http://127.0.0.1:8013/'); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo({}));
  await p.reload(); await p.waitForTimeout(400);
  let s;
  ok('без світла: карточки «Світло» нет', !(await p.$('[data-key=card-elec]')));
  await go('elec');
  ok('#elec без лічильника → головна', (await hash()) === '#home');

  // ---- додати: «Додати лічильник» → Світло → форма
  await click('[data-key=card-add-meter]'); 
  ok('у виборі «Світло» і «Газ» активні (не «скоро»)', !!(await p.$('[data-key=am-elec][data-act=am-pick]')) && !!(await p.$('[data-key=am-gas][data-act=am-pick]')) && !(await p.$('.am-soon')));
  await click('[data-key=am-elec]');
  ok('форма: 3 варіанти зон, однозонний — одне поле', (await hash()) === '#eadd' && (await p.$$('input[name=ea-z]')).length === 3 && (await p.$$('[data-ea]')).length === 1);
  await p.fill('#ea-v-all', '777'); await click('[data-key=ea-z2]');
  ok('двозонний — поля «день» і «ніч», введене не губиться при перемиканні', (await p.$$('[data-ea]')).length === 2 && !!(await p.$('#ea-v-day')));
  await p.fill('#ea-v-day', '10000'); await click('[data-key=ea-save]', 200);
  ok('лише одна зона — помилка «усі зони або жодної»', /усі зони/i.test(await p.textContent('#ea-err')));
  await p.fill('#ea-v-night', '5000'); await p.fill('#ea-acc', '9876543'); await click('[data-key=ea-save]', 400);
  s = await st(); const m = (s.places[0].meters || [])[0];
  ok('лічильник у квартирі: 2 зони, рахунок; стартові 10000/5000', m && m.kind === 'elec' && m.zones === 2 && m.account === '9876543' && (s.mrecs || []).some(r => r.base && r.meter === m.id && r.z.day === '10000' && r.z.night === '5000'), { m, r: s.mrecs });
  ok('після — сторінка світла з табло «день/ніч»', (await hash()) === '#elec' && /день/.test(await p.textContent('[data-key=emeter-' + m.id + ']')));
  await go('home');
  ok('головна: карточка «Світло» зі статусом', !!(await p.$('[data-key=card-elec]')) && /Передати|Наступне/.test(await p.textContent('[data-key=card-elec]')));

  // ---- введення (сьогодні в демо — 2.11: вікно за жовтень відкрите до 3.11)
  await click('[data-key=card-elec-add]', 400);
  ok('введення: «Зараз приймають: 30 жовтня–3 листопада»', (await hash()) === '#enew' && /30 жовтня.*3 листопада/.test(await p.textContent('#main')));
  const di = '#en-' + m.id + '-day', ni = '#en-' + m.id + '-night';
  await p.fill(di, '9990'); await p.fill(ni, '5040'); await click('[data-key=en-save]', 250);
  ok('день менше минулого — блок, не зберегли', /Менше, ніж минулого разу/.test(await p.textContent('#eh-' + m.id + '-day')) && !(await st()).mrecs.some(r => !r.base));
  await p.fill(di, '15100'); await p.press(di, 'Tab'); await p.waitForTimeout(200);
  ok('у «день» вписали суму зон — попередження', /загальний показник/.test(await p.textContent('#eh-' + m.id + '-day')));
  await p.fill(di, '10130'); await p.fill(ni, '5060,7'); await click('[data-key=en-save]', 400);
  s = await st(); const r1 = s.mrecs.find(r => !r.base);
  ok('збережено: день 10130, ніч 5060.7 (ціле — 5060)', r1 && r1.z.day === '10130' && r1.z.night === '5060.7' && r1.meter === m.id, r1);
  ok('після — сторінка світла, «Куди передати»: Харківобленерго, цифри по зонах, рахунок', (await hash()) === '#elec' && /Харківобленерго/.test(await p.textContent('[data-key=where-elec]')) && /10130/.test(await p.textContent('[data-key=esend-vals]')) && /5060/.test(await p.textContent('[data-key=esend-vals]')) && /9876543/.test(await p.textContent('[data-key=where-elec]')));
  ok('посилання на «Харенерго» і кол-центр', !!(await p.$('[data-key=dest-obl-ios]')) && /342-44-13/.test(await p.textContent('[data-key=where-elec]')));
  await click('[data-key=esend-done]', 300); s = await st();
  ok('«Я передав(ла)» → sent.obl', s.mrecs.find(r => r.id === r1.id).sent.obl === '2026-11-02');
  await go('home');
  ok('карточка: «Передано цього місяця»', /Передано/.test(await p.textContent('[data-key=card-elec]')));

  // ---- історія / статистика / економія
  await go('history'); await click('[data-key=kind-elec]', 300);
  const hi = await p.textContent('[data-key=elec-history]');
  ok('історія: +190 кВт·год (130 + 60), ≈ грн, «передано»', /\+190/.test(hi) && /грн/.test(hi) && /передано/.test(hi), hi);
  await click('[data-key=erec-' + r1.id + ']', 300);
  const rc = await p.textContent('#main');
  ok('картка запису: за жовтень, 130×4,32 + 60×2,16 = 691,20 грн', /за жовтень/i.test(rc) && /691,20/.test(rc), rc.slice(0, 300));
  await click('[data-key=erec-edit]', 300);
  ok('«Виправити» → введення з цифрами запису', (await hash()) === '#enew' && (await p.inputValue(di)) === '10130');
  await p.fill(di, '10140'); await click('[data-key=en-save]', 400); s = await st();
  ok('правка — той самий запис, не новий', s.mrecs.filter(r => !r.base).length === 1 && s.mrecs.find(r => r.id === r1.id).z.day === '10140');
  await go('stats'); await click('[data-key=kind-elec]', 300);
  ok('статистика: плитка кВт·год і графік', !!(await p.$('[data-key=estats-kpi]')) && (await p.$$('.chart-panel')).length === 2);
  await go('save'); await click('[data-key=kind-elec]', 300);
  ok('економія: «Ваше споживання» і поради', !!(await p.$('[data-key=esave-mine]')) && !!(await p.$('[data-key=esave-tips]')));

  // ---- електроопалення, прибрати/повернути
  await go('elec'); await p.click('#e-heat'); await p.waitForTimeout(250); s = await st();
  ok('галочка «електроопалення» — у квартири', s.places[0].elecHeat === true);
  await go('place-main');
  ok('екран квартири: рядок світла без «Замінити»', !!(await p.$('[data-key=pv-m-' + m.id + ']')) && !(await p.$('[data-key=pv-replace-' + m.id + ']')));
  await click('[data-key=pv-remove-' + m.id + ']', 300); s = await st();
  ok('прибрати (є показання) → removed, головна без світла, вкладка історії лишилась', !!s.places[0].meters[0].removed);
  await go('home'); ok('…головна без карточки світла', !(await p.$('[data-key=card-elec]')));
  await go('history'); ok('…у вкладках «Світло» є (є показання)', !!(await p.$('[data-key=kind-elec]')));
  await go('place-main'); await click('[data-key=pv-restore-' + m.id + ']', 300); s = await st();
  ok('повернули', !s.places[0].meters[0].removed);

  // ---- мастер нової квартири: світло в черзі після води
  await go('add-place'); await p.fill('#aw-name', 'Дача'); await click('[data-key=aw-next]');
  ok('мастер: «Світло» активне', !(await p.$('[data-key=aw-elec].am-soon')) && !!(await p.$('[data-key=aw-elec-inc]')));
  await click('[data-key=aw-cold-inc]', 200); await click('[data-key=aw-elec-inc]', 200); await click('[data-key=aw-next]'); await click('[data-key=aw-create]', 400);
  ok('черга: холодна 1 з 2 → …', (await hash()) === '#wadd' && /1\sз\s2/.test(await p.textContent('[data-key=aw-queue]')));
  await click('[data-key=wa-save]', 400);
  ok('… → світло 2 з 2 (вибір зон)', (await hash()) === '#eadd' && /2\sз\s2/.test(await p.textContent('[data-key=aw-queue]')));
  await click('[data-key=ea-save]', 400); s = await st(); const dacha = s.places.find(x => x.name === 'Дача');
  ok('у «Дачі» холодна і світло, головна квартири — дві карточки', dacha.meters.length === 1 && dacha.water.meters.length === 1 && (await hash()) === '#home' && !!(await p.$('[data-key=card-elec]')));
  await go('home');
  ok('головна-акордеон: у «Дачі» картка «Світло»', /Світло/.test(await p.textContent('[data-key=home-pl-' + dacha.id + ']')) && !!(await p.$('[data-key=home-pl-' + dacha.id + '] [data-key=card-elec]')));
  // «не та квартира»: у «Дачі» двозонний зі стартовими 100/50; вписали «день» 10150 — це схоже на першу квартиру (там 10140)
  await go('place-' + dacha.id);
  await p.evaluate((pid) => { const s = JSON.parse(localStorage.getItem('teplo.v1')); const q = s.places.find(x => x.id === pid), mid = q.meters[0].id; q.meters[0].zones = 2;
    s.mrecs.push({ id: 'zz', place: pid, meter: mid, kind: 'elec', date: '2026-10-31', z: { day: '100', night: '50' }, base: true, sent: {}, createdAt: '2026-10-31T10:00:00Z', updatedAt: 1 }); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, dacha.id);
  await p.reload(); await p.waitForTimeout(300); await go('enew');
  const dm = (await st()).places.find(x => x.id === dacha.id).meters[0].id;
  await p.fill('#en-' + dm + '-day', '10150'); await p.waitForTimeout(250);
  const oh = await p.textContent('#eh-' + dm + '-day');
  ok('«не та квартира»: «день» 10150 у «Дачі» (там 100) → «схоже на показання квартири «Моя квартира»»', /Схоже на показання квартири «Моя квартира»/.test(oh) && /Дача/.test(oh), oh);
  await p.fill('#en-' + dm + '-day', '160'); await p.waitForTimeout(250);
  ok('160 (звичайний розхід) — без попереджень', !/Схоже/.test(await p.textContent('#eh-' + dm + '-day')));
  ok('без ошибок JS', errs.length === 0, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
