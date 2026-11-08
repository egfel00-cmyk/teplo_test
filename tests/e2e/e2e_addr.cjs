// Форма адреси квартири (61-а сесія): населений пункт з підказкою (GET /api/places/suggest — Харківщина, Київщина, Київ, Одещина, Львівщина)
// + «Вулиця, будинок, квартира»; нова квартира — з пунктом першої; стара адреса рядком розкладається на пункт і вулицю; графік відключень —
// лише Харківщина. Нужен сайт 127.0.0.1:8013.
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
const U = 'http://127.0.0.1:8013/';
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 360, height: 800 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const s = demo({ second: true, elec: 1, today: '2026-11-05' });
  s.places[0].address = 'пр. Перемоги 86А, кв. 61';
  s.places[1].name = 'Лозовеньки'; s.places[1].address = 'Малая Даниловка, ул.Академическая 10, кв.20';
  await p.goto(U); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), s);
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')));
  const pl = async (id) => (await st()).places.filter(x => x.id === id)[0];
  await p.goto(U + '#place-p2'); await p.reload(); await p.waitForTimeout(1000);
  ok('стара адреса рядком → пункт «Мала Данилівка» (✓ громада й область), вулиця окремо', await p.inputValue('#pv-city') === 'Мала Данилівка'
    && /Малоданилівська громада, Харківський район, Харківська обл\./.test(await p.textContent('#pv-where')) && await p.inputValue('#pv-street') === 'ул.Академическая 10, кв.20',
    [await p.inputValue('#pv-city'), await p.textContent('#pv-where'), await p.inputValue('#pv-street')]);
  // набір → список → вибір пальцем
  await p.fill('#pv-city', ''); await p.type('#pv-city', 'Льв', { delay: 40 }); await p.waitForTimeout(700);
  const opts = await p.$$eval('#pv-cl [role=option]', els => els.map(e => e.textContent));
  ok('«Льв» → у списку «м. Львів · Львівська громада, Львівський район, Львівська обл.», список видно, aria-expanded', opts.length >= 1 && /м\. Львів/.test(opts[0]) && /Львівська обл\./.test(opts[0])
    && !(await p.$eval('#pv-cl', u => u.hidden)) && await p.getAttribute('#pv-city', 'aria-expanded') === 'true', opts);
  await p.click('#pv-cl [role=option] >> nth=0'); await p.waitForTimeout(900);
  let q = await pl('p2');
  ok('вибрали Львів → p.city (lv), p.street, адреса «м. Львів, ул.Академическая 10, кв.20», точний пункт для довідника', q.city && q.city.r === 'lv' && q.city.n === 'Львів'
    && q.address === 'м. Львів, ул.Академическая 10, кв.20' && q.settle && q.settle.n === 'Львів' && q.settle.a === q.address, q);
  ok('після вибору — фокус у «Вулиця, будинок, квартира», ✓ Львівська громада', await p.evaluate(() => document.activeElement && document.activeElement.id) === 'pv-street' && /Львівська громада/.test(await p.textContent('#pv-where')));
  await p.click('h1'); await p.waitForTimeout(1200);
  ok('довідник квартири — Львів (не Мала Данилівка)', /Львів/.test(await p.textContent('[data-key=prov-lead]').catch(() => '')), await p.textContent('[data-key=prov-lead]').catch(() => 'нет'));
  ok('Львів — без графіка відключень Харківобленерго', !(await p.$('[data-gpv=p2]')));
  // клавіатура: Бровар → ↓ → Enter
  await p.fill('#pv-city', ''); await p.type('#pv-city', 'Бровар', { delay: 30 }); await p.waitForTimeout(700);
  await p.keyboard.press('ArrowDown'); ok('↓ — перший пункт активний (aria-activedescendant)', (await p.getAttribute('#pv-city', 'aria-activedescendant')) === 'pv-o0');
  await p.keyboard.press('Enter'); await p.waitForTimeout(800); q = await pl('p2');
  ok('Enter → Бровари (Київщина), вулиця збереглася', q.city && q.city.n === 'Бровари' && q.city.r === 'kv' && q.street === 'ул.Академическая 10, кв.20', q.city);
  // написали точно й пішли з поля — підставили самі (одна точна назва)
  await p.fill('#pv-city', ''); await p.type('#pv-city', 'Одеса', { delay: 30 }); await p.waitForTimeout(700); await p.click('#pv-street'); await p.waitForTimeout(400); q = await pl('p2');
  ok('«Одеса» без вибору, пішли з поля → Одеса (od) сама', q.city && q.city.n === 'Одеса' && q.city.r === 'od' && /^м\. Одеса, /.test(q.address), q.city);
  // описка й рос.
  await p.fill('#pv-city', ''); await p.type('#pv-city', 'Харьков', { delay: 30 }); await p.waitForTimeout(700);
  ok('«Харьков» (рос.) → першим «м. Харків»', /м\. Харків/.test((await p.$$eval('#pv-cl [role=option]', els => els.map(e => e.textContent)))[0] || ''));
  await p.keyboard.press('Enter'); await p.waitForTimeout(800); q = await pl('p2');
  ok('Харків → є графік відключень (вулиця вказана)', q.city.r === 'kh' && !!(await p.$('[data-gpv=p2]')), q.city);
  await p.fill('#pv-city', ''); await p.type('#pv-city', 'Ыхфыва', { delay: 20 }); await p.waitForTimeout(800);
  ok('незнайома назва → «Такого населеного пункту не знайшли»', /не знайшли/.test(await p.textContent('#pv-where')), await p.textContent('#pv-where'));
  await p.fill('#pv-city', ''); await p.type('#pv-city', 'Харків', { delay: 20 }); await p.waitForTimeout(700); await p.keyboard.press('Enter'); await p.waitForTimeout(600);
  // головна: «+ Квартира» — пункт першої квартири
  await p.goto(U + '#home'); await p.waitForTimeout(700);
  await p.click('[data-key=home-add-place]'); await p.waitForTimeout(800);
  let sv = await st(), np = sv.places[sv.places.length - 1];
  const hid = np.id;
  ok('«+ Квартира» на головній → нова квартира вже з Харковом (як перша, адреса «пр. Перемоги…» = Харків)', np.city && np.city.n === 'Харків' && np.address === 'м. Харків', np);
  ok('форма «Назва й адреса» нової: пункт «Харків» ✓, вулиця порожня', await p.inputValue('#hpa-' + hid + '-city') === 'Харків' && await p.inputValue('#hpa-' + hid + '-street') === '');
  ok('нова квартира без вулиці — графіка відключень ще немає', !(await p.$('[data-gpv=' + hid + ']')));
  await p.fill('#hpa-' + hid + '-street', 'вул. Пушкінська, 5, кв. 3'); await p.fill('#hpn-' + hid, 'Здаю'); await p.click('[data-key=hp-save]'); await p.waitForTimeout(500);
  np = await pl(hid);
  ok('«Зберегти» → «м. Харків, вул. Пушкінська, 5, кв. 3», назва «Здаю»', np.address === 'м. Харків, вул. Пушкінська, 5, кв. 3' && np.name === 'Здаю' && np.street === 'вул. Пушкінська, 5, кв. 3', np);
  // майстер «Додати квартиру»: пункт першої + підказка, змінили на Київ
  await p.goto(U + '#places'); await p.waitForTimeout(400); await p.click('[data-act=pl-add]').catch(async () => { await p.goto(U + '#add-place'); }); await p.waitForTimeout(600);
  ok('майстер: пункт «Харків» і «Як у квартири «Моя квартира» — можна змінити»', await p.inputValue('#aw-city') === 'Харків' && /Як у квартири «Моя квартира»/.test(await p.textContent('[data-key=af-aw]')), [await p.inputValue('#aw-city').catch(() => ''), await p.textContent('[data-key=af-aw]').catch(() => '')]);
  await p.fill('#aw-city', ''); await p.type('#aw-city', 'Київ', { delay: 30 }); await p.waitForTimeout(700); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  await p.fill('#aw-street', 'вул. Хрещатик, 1, кв. 1'); await p.click('[data-act=aw-chip] >> nth=1'); await p.waitForTimeout(300);
  ok('кнопка назви перемальовує — пункт і вулиця лишаються', await p.inputValue('#aw-city') === 'Київ' && await p.inputValue('#aw-street') === 'вул. Хрещатик, 1, кв. 1');
  await p.click('[data-key=aw-next]'); await p.waitForTimeout(300);
  await p.click('[data-key=aw-cold-inc]'); await p.click('[data-key=aw-next]'); await p.waitForTimeout(300);
  ok('«Перевірте» — «м. Київ, вул. Хрещатик, 1, кв. 1»', /м\. Київ, вул\. Хрещатик, 1, кв\. 1/.test(await p.textContent('[data-key=aw-sum]')), await p.textContent('[data-key=aw-sum]').catch(() => ''));
  await p.click('[data-key=aw-skip]'); await p.waitForTimeout(600);
  sv = await st(); np = sv.places[sv.places.length - 1];
  ok('створено: Київ (ky), вулиця, точний пункт', np.city && np.city.r === 'ky' && np.address === 'м. Київ, вул. Хрещатик, 1, кв. 1' && np.settle && np.settle.n === 'Київ', np);
  // рос. інтерфейс
  const pr = await (await b.newContext({ viewport: { width: 320, height: 700 }, locale: 'ru-RU' })).newPage();
  await pr.goto(U); await pr.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(Object.assign(s, { lang: 'ru' }))), s); await pr.goto(U + '#place-p2'); await pr.reload(); await pr.waitForTimeout(900);
  ok('ru: «Населённый пункт», «Улица, дом, квартира»', /Населённый пункт/.test(await pr.textContent('label[for=pv-city]')) && /Улица, дом, квартира/.test(await pr.textContent('label[for=pv-street]')));
  await pr.fill('#pv-city', ''); await pr.type('#pv-city', 'Чугуев', { delay: 30 }); await pr.waitForTimeout(700);
  ok('ru «Чугуев» → «м. Чугуїв · город · Чугуївська громада…»', /Чугуїв/.test((await pr.$$eval('#pv-cl [role=option]', els => els.map(e => e.textContent)))[0] || '') && /город/.test((await pr.$$eval('#pv-cl [role=option]', els => els.map(e => e.textContent)))[0] || ''));
  ok('320 px — не ширше екрана зі списком', await pr.evaluate(() => document.documentElement.scrollWidth <= 321));
  ok('без помилок JS', errs.length === 0, errs);
  console.log(`\n${pass}/${pass + fail}`); await b.close(); process.exit(fail ? 1 : 0);
})();
