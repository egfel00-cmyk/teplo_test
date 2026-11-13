// 126-а: тепло не від ХТМ (Київ — Київтеплоенерго): постачальнику одне число — енергія. Майстер — дата й енергія, перевірка без форми й правил ХТМ,
// «Передача постачальнику тепла» з «Куди передати» з довідника й кнопкою «Передано» (стає базою наступного місяця), картка тепла — «Передано».
// Харків — як і було (повний майстер ХТМ). node e2e_heatlite.cjs  (сайт 127.0.0.1:8013)
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
const U = 'http://127.0.0.1:8013/';
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
(async () => {
  const b = await chromium.launch(); const p = await (await require('./pvopen.cjs').ctx(b, { viewport: { width: 390, height: 844 }, locale: 'uk-UA' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const s = demo({ today: '2026-11-20' });
  s.places[0].address = 'м. Київ, вул. Хрещатик, 1, кв. 1'; s.places[0].city = { n: 'Київ', r: 'ky' };
  s.meter = s.places[0].meter = { modelId: 'qalcosonic_e3', unit: 'MWh' };
  await p.goto(U); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), s);
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')));
  await p.goto(U + '#meter'); await p.reload(); await p.waitForTimeout(1200);
  const ml = await p.textContent('[data-key=meter-lite]').catch(() => '');
  ok('вибір лічильника: «КП «Київтеплоенерго» приймає одне число — енергію», будь-який повірений лічильник на обліку', /Київтеплоенерго» приймає від квартири одне число/.test(ml) && /повіркою/.test(ml), ml);
  ok('серед моделей — QALCOSONIC E3, SonoMeter 30, zelsius C5, sensonic II, T550', await p.evaluate(() => ['qalcosonic_e3', 'sonometer30', 'zelsius_c5', 'sensonic2', 't550'].every(id => !!document.querySelector('[data-key=meter-list] input[value=' + id + ']'))));

  await p.goto(U + '#home'); await p.waitForTimeout(500);
  await p.click('[data-act=read][data-key]').catch(async () => { await p.evaluate(() => document.querySelector('[data-act=read]').click()); });
  await p.waitForTimeout(500);
  ok('майстер: крок 0 — дата', /#step-0$/.test(p.url()), p.url());
  await p.click('[data-act=step-next]'); await p.waitForTimeout(400);
  ok('крок 1 — енергія з підказкою «потрібне лише це число», екран INT 1.1', /#step-1$/.test(p.url()) && !!(await p.$('#f-energy')) && /лише це число/.test(await p.textContent('[data-key=step-lite]')) && /1\.1/.test(await p.textContent('main')), p.url());
  ok('на кроці енергії — лише одне поле', (await p.$$('main input[id^=f-]')).length === 1, (await p.$$eval('main input[id^=f-]', els => els.map(e => e.id))));
  await p.fill('#f-energy', '12.500'); await p.click('[data-act=step-next]'); await p.waitForTimeout(600);
  ok('після енергії — одразу перевірка', /#check$/.test(p.url()), p.url());
  const chk = await p.textContent('main');
  ok('перевірка: усе гаразд, у таблиці дата й енергія в MWh, без форми ХТМ і «10 значень»', (await p.getAttribute('[data-key=check-verdict]', 'data-verdict')) === 'ok' && (await p.$$('[data-key=check-values] tr')).length === 2
    && /МВт·год/.test(await p.textContent('[data-key=check-values]')) && !(await p.$('[data-key=htm-form]')) && !/10 значень|кабінет ХТМ/.test(chk), chk.slice(0, 400));
  ok('кнопка — «Як передати постачальнику»', /Як передати постачальнику/.test(await p.textContent('[data-key=check-send]')));
  await p.click('[data-key=check-send]'); await p.waitForTimeout(800);
  const ho = await p.textContent('main');
  ok('«Передача постачальнику тепла»: енергія 12.500 МВт·год і те саме в Гкал (10.748)', /Передача постачальнику тепла/.test(ho) && /12\.500/.test(ho) && /10\.748/.test(ho) && (await p.$$('[data-key=handover-values] li')).length === 2, ho.slice(0, 300));
  const wh = await p.textContent('[data-key=where-heat-lite]');
  ok('«Куди передати»: КП «Київтеплоенерго», одне число з 5 до кінця місяця, кабінет', /Київтеплоенерго/.test(wh) && /одне число/.test(wh) && /до кінця місяця/.test(wh) && !!(await p.$('[data-key=where-heat-lite] a[href^="https://kte.kmda.gov.ua"]')), wh.slice(0, 300));
  ok('без кабінету ХТМ і робота', !/ХТМ/.test(ho) && !(await p.$('[data-key=handover-open]')), (ho.match(/.{30}ХТМ.{30}/) || [])[0]);
  await p.click('[data-key=hl-done]'); await p.waitForTimeout(500);
  let sv = await st(), r = sv.readings[sv.readings.length - 1];
  ok('«Передано» → запис прийнятий, стає базою (енергія в Гкал), банер «Передано — показання на 20 листопада»', r.status === 'accepted' && Math.abs(+sv.baseline.energy - 10.748) < 0.01 && /Передано — показання на 20 листопада/.test(await p.textContent('[data-key=hl-sent]')), [r.status, sv.baseline]);
  await p.goto(U + '#home'); await p.waitForTimeout(600);
  const card = await p.textContent('.ucard[data-kind=heat], [data-key=uc-heat]').catch(() => p.textContent('main'));
  ok('головна: тепло — «Передано», без «ХТМ»', /Передано/.test(card) && !/ХТМ/.test(card), card.slice(0, 200));
  // наступний місяць: менше за попередні — як і було, «на свій ризик»; дата не в межах 5–25 — не заважає (вікно — правило ХТМ)
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.demoToday = '2026-12-28'; s.draft = { date: '2026-12-28', values: { energy: '12.000' }, step: 1 }; localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.goto(U + '#check'); await p.reload(); await p.waitForTimeout(700);
  ok('28 грудня (поза 5–25 ХТМ): лише «менше за попередні» — на свій ризик, без «вікно закрите»', (await p.getAttribute('[data-key=check-verdict]', 'data-verdict')) === 'block' && !!(await p.$('[data-code=R_MONO_ENERGY]')) && !(await p.$('[data-code=W_WINDOW]'))
    && /ризик/.test(await p.textContent('[data-key=check-send]')), await p.$$eval('[data-code]', els => els.map(e => e.getAttribute('data-code'))));
  // 127-а: довідка «Коли передавати» — з довідника громади (Київ: з 5 до кінця місяця), без вікна ХТМ 5–25, без «Чому робот ХТМ не приймає» і телефонів ХТМ
  await p.goto(U + '#help'); await p.waitForTimeout(600);
  const hl = await p.textContent('main');
  ok('довідка (Київ): строк із довідника, без вікна ХТМ і робота ХТМ', /з 5 числа до кінця місяця/.test(hl) && /до кінця місяця/.test(hl) && !/з 5 по 25 число/.test(hl) && !/робот ХТМ/.test(hl) && !/Телефони ХТМ/.test(hl), hl.slice(0, 300));
  // 141-а: сторінки тепла, історія, статистика, налаштування квартири (Київ) — без «ХТМ»: «Передано …», «за тарифом постачальника», «Зазвичай радять > 3 °C»
  const noHtm = {};
  for (const r of ['heat', 'history', 'stats', 'place-main']) {
    await p.goto(U + '#' + r); await p.waitForTimeout(900);
    await p.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true)); await p.waitForTimeout(250);
    const tx = await p.evaluate(() => document.getElementById('main').innerText);
    noHtm[r] = (tx.match(/[^\n]*ХТМ[^\n]*/g) || []).filter(l => !/квитанції Водоканалу/.test(l)).slice(0, 3);
  }
  ok('Київ: тепло, історія, статистика, квартира — без «ХТМ» (форма кабінету ХТМ, «Прийнято ХТМ», «за тарифом ХТМ», «ХТМ радить»)', Object.values(noHtm).every(a => !a.length), noHtm);
  await p.goto(U + '#history'); await p.waitForTimeout(800);
  ok('Київ: історія — «1 Гкал = 1 654 грн за тарифом постачальника»', /1\s654 грн за тарифом постачальника/.test((await p.textContent('[data-key=hs-unit]')).replace(/\u00a0|\u202f/g, ' ')), await p.textContent('[data-key=hs-unit]').catch(() => ''));
  await p.goto(U + '#prefs'); await p.waitForTimeout(900); await p.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true)); await p.waitForTimeout(250);
  const wtp = (await p.textContent('[data-key=prefs-wtariff]').catch(() => '')).replace(/\u00a0|\u202f/g, ' ');
  ok('Київ: Налаштування → «Тарифи на воду» — Київводоканал 36,85 і 26,94, гаряча 97,89, без «Тарифи Харкова»', /Київводоканал/.test(wtp) && /36,85/.test(wtp) && /26,94/.test(wtp) && /97,89/.test(wtp) && !/Харк/.test(wtp) && !!(await p.$('[data-key=prefs-wtariff-place]')), wtp.slice(0, 300));
  // Харків — повний майстер ХТМ
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.places[0].address = 'пр. Перемоги 86А, кв. 61'; delete s.places[0].city; s.demoToday = '2026-11-20'; s.draft = null; localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.goto(U + '#meter'); await p.reload(); await p.waitForTimeout(1200);
  ok('Харків: на виборі лічильника підказки «одне число» немає', !(await p.$('[data-key=meter-lite]')));
  await p.goto(U + '#home'); await p.waitForTimeout(400); await p.evaluate(() => document.querySelector('[data-act=read]').click()); await p.waitForTimeout(400);
  await p.click('[data-act=step-next]'); await p.waitForTimeout(400);
  ok('Харків: крок 1 майстра — без «лише це число», далі є ще кроки (обсяг…)', !(await p.$('[data-key=step-lite]')) && /#step-1$/.test(p.url()));
  await p.goto(U + '#prefs'); await p.waitForTimeout(900); await p.evaluate(() => document.querySelectorAll('details').forEach(d => d.open = true)); await p.waitForTimeout(250);
  ok('Харків: «Тарифи на воду» — як було (поля й тарифи Харкова)', !!(await p.$('#p-wsupply')) && /Харкова/.test(await p.textContent('[data-key=prefs-wtariff]')));
  ok('без помилок JS', !errs.length, errs);
  console.log(`\n${pass} OK, ${fail} FAIL`); await b.close(); process.exit(fail ? 1 : 0);
})();
