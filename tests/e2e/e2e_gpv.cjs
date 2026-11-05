// Графік відключень світла (ГПВ Харківобленерго): лише у квартир з адресою і лише на сторінці світла — згорнутим акордеоном
// (у шапці «Сьогодні без світла: …»), розгорнуто — вибір черги, сьогодні/завтра, «зараз», погодинно; квартира без світла — на її екрані;
// на головній графіка немає; ?go=gpv з ранкового повідомлення → сторінка світла з розгорнутим блоком.
// Кеш графіка — синтетичний (SITE_DATA/cache/gpv.json), дати — сьогодні за Києвом. Нужен сайт 127.0.0.1:8013 (SITE_DATA=/tmp/teplo_data).
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const fs = require('fs');
const U = 'http://127.0.0.1:8013/', DATA = process.env.SITE_DATA || '/tmp/teplo_data';
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const kyiv = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const today = kyiv(new Date()), tomorrow = kyiv(new Date(Date.now() + 86400000));
const none = {}; ['1.1', '1.2', '2.1', '2.2', '3.1', '3.2', '4.1', '4.2', '5.1', '5.2', '6.1', '6.2'].forEach(q => { none[q] = { off: [], may: [] }; });
const day1 = JSON.parse(JSON.stringify(none)); day1['1.1'] = { off: [[360, 540], [750, 1170], [1380, 1440]], may: [] }; day1['2.1'] = { off: [[600, 720]], may: [[900, 960]] };
const day2 = JSON.parse(JSON.stringify(none)); day2['1.1'] = { off: [[0, 120]], may: [] };
const cache = (days) => { fs.mkdirSync(DATA + '/cache', { recursive: true }); fs.writeFileSync(DATA + '/cache/gpv.json', JSON.stringify({ at: Math.floor(Date.now() / 1000), update: '04.11.2026 07:05', days, err: null })); };
(async () => {
  cache({ [today]: day1, [tomorrow]: day2 });
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 360, height: 800 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  // пошук черги за адресою — як відповідає сервер (довідник з переліку Харківобленерго тут не потрібен)
  await p.route('**/api/gpv/addr*', r => { const q = new URL(r.request().url()).searchParams.get('q') || '';
    const j = /Сумська, 10/.test(q) ? { ready: true, found: true, q: '3.1', street: 'вул. Сумська', city: 'м. Харків', how: 'house' }
      : /Науки/.test(q) ? { ready: true, found: false, reason: 'nohouse', street: 'просп. Науки', city: 'Харків', options: ['4.1', '4.2'] }
      : /Чугуїв/.test(q) ? { ready: true, found: false, reason: 'street', kharkiv: false, city: 'Чугуїв', options: ['4.1', '5.2'] }
      : /Пушкінська/.test(q) ? { ready: true, found: false, reason: 'street', kharkiv: true, city: 'Харків' } : { ready: true, found: false, reason: 'city', kharkiv: false };
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) }); });
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')));
  const seed = async (s) => { await p.goto(U); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), s); await p.goto(U + '#home'); await p.reload(); await p.waitForTimeout(600); };
  const isOpen = (k) => p.$eval('[data-key=' + k + ']', e => e.open);
  const brief = (k) => p.textContent('[data-key=' + k + '] [data-key=gpv-brief]');
  const fits = (k) => p.evaluate((k) => { const e = document.querySelector('[data-key=' + k + ']'); return !!e && e.scrollWidth <= e.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1; }, k);
  const base = demo({ elec: 1, today }); base.demoMin = 400;   // 06:40 — у черги 1.1 зараз відключення до 09:00
  await seed(base);
  ok('без адреси — графіка немає ні на головній, ні на сторінці світла', !(await p.$('.gpv')));
  await p.goto(U + '#elec'); await p.waitForTimeout(400); ok('…сторінка світла теж без графіка', !(await p.$('[data-key=gpv-elec]')));
  await p.goto(U + '#home'); await p.waitForTimeout(300);
  await p.click('[data-key=home-addr-add]'); await p.waitForTimeout(200);
  ok('у полі адреси — підказка «…графік відключень світла — на сторінці «Світло»»', /графік відключень світла — на сторінці «Світло»/.test(await p.textContent('.hp-addr-gpv')));
  await p.fill('#hpa-main', 'вул. Сумська, 10, кв. 61'); await p.click('[data-key=hp-save]'); await p.waitForTimeout(700);
  ok('головна з адресою — графіка немає (лише на сторінці світла)', !(await p.$('.gpv')) && !(await p.$('[data-key=gpv-home]')));
  await p.goto(U + '#elec'); await p.waitForTimeout(800);
  let s = await st();
  ok('сторінка світла: черга визначилась сама за адресою (3.1, gpvAuto)', s.places[0].gpv === '3.1' && s.places[0].gpvAuto && s.places[0].gpvAuto.addr === 'вул. Сумська, 10, кв. 61', s.places[0]);
  ok('блок згорнутий, у шапці лише «Сьогодні відключень немає»', !(await isOpen('gpv-elec')) && (await brief('gpv-elec')).trim() === 'Сьогодні відключень немає' && !(await p.isVisible('[data-key=gpv-elec] [data-key=gpv-q]')));
  await p.click('[data-key=gpv-elec] [data-key=gpv-sum]'); await p.waitForTimeout(200);
  ok('розгорнули → «Черга 3.1 — за адресою (вул. Сумська, м. Харків)», без кнопок вибору', await isOpen('gpv-elec') && /за адресою \(вул\. Сумська, м\. Харків\)/.test(await p.textContent('[data-key=gpv-auto]')) && !(await p.$('[data-key=gpv-elec] .gpv-q')));
  await p.click('[data-key=gpv-change]'); await p.waitForTimeout(200);
  ok('«Не та черга?» → 12 кнопок і посилання на офіційний пошук, блок лишився розгорнутим', await isOpen('gpv-elec') && (await p.$$('[data-key=gpv-elec] .gpv-q')).length === 12 && /oblenergo\.kharkiv\.ua\/uk\/gaoinfo/.test(await p.getAttribute('[data-key=gpv-lookup]', 'href')));
  await p.click('[data-key=gpv-q-1\\.1]'); await p.waitForTimeout(400); s = await st();
  ok('обрали 1.1 вручну → збережено, автопідбір знято, блок розгорнутий', s.places[0].gpv === '1.1' && !s.places[0].gpvAuto && await isOpen('gpv-elec') && /Черга 1\.1/.test(await p.textContent('[data-key=gpv-q]')) && !(await p.$('[data-key=gpv-auto]')));
  ok('шапка: «Сьогодні без світла: 06:00–09:00, 12:30–19:30, 23:00–24:00» (зараз немає — колір попередження)', (await brief('gpv-elec')).trim() === 'Сьогодні без світла: 06:00–09:00, 12:30–19:30, 23:00–24:00' && await p.$eval('[data-key=gpv-elec] [data-key=gpv-brief]', e => e.classList.contains('off')));
  const box = await p.textContent('[data-key=gpv-elec]');
  ok('сьогодні: «зараз світла немає — до 09:00», години й разом', /зараз світла немає — до 09:00/.test(await p.textContent('[data-key=gpv-now]')) && /разом 11 год/.test(box), box);
  ok('…шкала 24 год: 3 відрізки «без світла» і позначка «зараз»', (await p.$$('[data-key=gpv-day-today] .gpv-bar i.off')).length === 3 && !!(await p.$('[data-key=gpv-day-today] .gpv-mark')));
  ok('завтра: окремо, 00:00–02:00, без позначки «зараз»', /00:00–02:00/.test(await p.textContent('[data-key=gpv-day-tomorrow]')) && !(await p.$('[data-key=gpv-day-tomorrow] .gpv-mark')));
  const hrs = await p.$$eval('[data-key=gpv-wide] .gpv-hrs', ds => ds.map(d => Array.from(d.querySelectorAll('.gpv-hr')).map(h => Array.from(h.querySelectorAll('i')).map(i => ({ off: 'x', may: 'm', on: '.' })[i.className]).join('') + (h.classList.contains('now') ? '*' : ''))));
  ok('погодинно: сьогодні 24 години по півгодини (06 — «зараз», 12 — з 12:30, 19 — до 19:30, 23 — немає); завтра 00–01 немає', hrs.length === 2 && hrs[0].length === 24
    && hrs[0][5] === '..' && hrs[0][6] === 'xx*' && hrs[0][8] === 'xx' && hrs[0][9] === '..' && hrs[0][12] === '.x' && hrs[0][19] === 'x.' && hrs[0][23] === 'xx'
    && hrs[1][0] === 'xx' && hrs[1][1] === 'xx' && hrs[1][2] === '..' && !hrs[1].some(x => /\*/.test(x)), hrs);
  ok('…легенда «світла немає / можливо / світло є»', /світла немає/.test(await p.textContent('[data-key=gpv-wide] .gpv-leg')) && /можливо/.test(await p.textContent('[data-key=gpv-wide] .gpv-leg')));
  ok('не ввійшли — «Увійдіть через Telegram — графік приходитиме щоранку»; джерело й час оновлення', /Увійдіть через Telegram/.test(await p.textContent('[data-key=gpv-tg-need]')) && /оновлено 04\.11\.2026 07:05/.test(box));
  ok('360 px, розгорнутий — не ширший за екран', await fits('gpv-elec'));
  await p.reload(); await p.waitForTimeout(500);
  ok('перезавантажили → знову згорнутий, шапка з годинами', !(await isOpen('gpv-elec')) && /^Сьогодні без світла: 06:00–09:00/.test((await brief('gpv-elec')).trim()));
  ok('360 px, згорнутий — не ширший за екран', await fits('gpv-elec'));
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.demoMin = 600; localStorage.setItem('teplo.v1', JSON.stringify(s)); }); await p.reload(); await p.waitForTimeout(500);
  await p.click('[data-key=gpv-elec] [data-key=gpv-sum]'); await p.waitForTimeout(200);
  ok('10:00 — «зараз світло є — вимкнуть о 12:30», у шапці не «попередження»', /зараз світло є — вимкнуть о 12:30/.test(await p.textContent('[data-key=gpv-now]')) && !(await p.$eval('[data-key=gpv-elec] [data-key=gpv-brief]', e => e.classList.contains('off'))));
  await p.click('[data-key=gpv-change]'); await p.waitForTimeout(200);
  ok('«Змінити чергу» → знову кнопки, поточна натиснута, «Скасувати»', await p.getAttribute('[data-key=gpv-q-1\\.1]', 'aria-pressed') === 'true' && !!(await p.$('[data-key=gpv-cancel]')));
  await p.click('[data-key=gpv-q-2\\.1]'); await p.waitForTimeout(300);
  ok('черга 2.1 — «можливі» штрихом погодинно (15:00–16:00), у списку «Можливі відключення»', /Можливі відключення/.test(await p.textContent('[data-key=gpv-day-today]'))
    && (await p.$$eval('[data-key=gpv-wide] .gpv-hrs >> nth=0', ds => ds.length ? Array.from(ds[0].querySelectorAll('.gpv-hr'))[15].querySelectorAll('i.may').length : 0)) === 2);
  await p.click('[data-key=gpv-change]'); await p.click('[data-key=gpv-q-3\\.1]'); await p.waitForTimeout(300);
  ok('черга 3.1 — «Відключень за графіком немає», шапка «Сьогодні відключень немає» зеленим', /Відключень за графіком немає/.test(await p.textContent('[data-key=gpv-day-today]')) && (await brief('gpv-elec')).trim() === 'Сьогодні відключень немає' && await p.$eval('[data-key=gpv-elec] [data-key=gpv-brief]', e => e.classList.contains('ok')));
  await p.click('[data-key=gpv-change]'); await p.click('[data-key=gpv-q-1\\.1]'); await p.waitForTimeout(300);
  // дві квартири: на головній — ні графіка, ні короткого «світло вимкнуть» у шапці; друга (лише холодна) — графік на її екрані
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.places.push({ id: 'p2', v: 2, name: 'Мамина', address: '', color: 'violet', meter: null, baseline: null, updatedAt: 1, water: { meters: [{ id: 'c9', kind: 'cold', name: '' }] } }); s.homeOpen = { main: true, p2: true }; localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.goto(U + '#home'); await p.reload(); await p.waitForTimeout(500);
  ok('дві квартири: на головній графіка немає, у шапці квартири — без «світло вимкнуть»', !(await p.$('.gpv')) && !/вимкнуть|без світла/.test(await p.textContent('[data-key=home-pl-sum-main]')));
  await p.goto(U + '#place-p2'); await p.waitForTimeout(300);
  ok('екран квартири без світла й без адреси — графіка немає', !(await p.$('[data-key=gpv-place]')));
  await p.fill('#pv-addr', 'просп. Науки'); await p.dispatchEvent('#pv-addr', 'change'); await p.goto(U + '#place-p2'); await p.reload(); await p.waitForTimeout(800);
  ok('квартира без електролічильника, з адресою → графік на її екрані, згорнутий: «Оберіть чергу відключень»', !!(await p.$('[data-key=gpv-place]')) && !(await isOpen('gpv-place')) && (await brief('gpv-place')).trim() === 'Оберіть чергу відключень');
  await p.click('[data-key=gpv-place] [data-key=gpv-sum]'); await p.waitForTimeout(200);
  ok('вулиця в кількох чергах без номера будинку → лише її черги (4.1, 4.2) і «Допишіть номер будинку…», «Показати всі черги»', (await p.$$('[data-key=gpv-place] .gpv-q')).length === 2
    && /кількох чергах/.test(await p.textContent('[data-key=gpv-place] [data-key=gpv-lead]')) && !!(await p.$('[data-key=gpv-place] [data-key=gpv-all]')));
  const setAddr = async (a) => { await p.fill('#pv-addr', a); await p.dispatchEvent('#pv-addr', 'change'); await p.reload(); await p.waitForTimeout(800); await p.click('[data-key=gpv-place] [data-key=gpv-sum]'); await p.waitForTimeout(200); };
  await setAddr('вул. Вигадана, 1');
  ok('адреси немає в переліку → «Не знайшли адресу… Оберіть чергу» і всі 12', /Не знайшли адресу «вул\. Вигадана, 1»/.test(await p.textContent('[data-key=gpv-place] [data-key=gpv-lead]')) && (await p.$$('[data-key=gpv-place] .gpv-q')).length === 12);
  await setAddr('м. Чугуїв, вул. Вигадана, 3');
  ok('вулиці немає в переліку пункту, а пункт у кількох чергах → лише його черги (4.1, 5.2) і «Вашої вулиці немає … для «Чугуїв»»', (await p.$$('[data-key=gpv-place] .gpv-q')).length === 2
    && /Вашої вулиці немає в переліку Харківобленерго для «Чугуїв»/.test(await p.textContent('[data-key=gpv-place] [data-key=gpv-lead]')) && !/«»/.test(await p.textContent('[data-key=gpv-place] [data-key=gpv-lead]')));
  await setAddr('вул. Пушкінська, 5');
  ok('харківська адреса, якої немає в переліку → «Для міста Харкова … лише пошук на своєму сайті», 12 черг', /Для міста Харкова/.test(await p.textContent('[data-key=gpv-place] [data-key=gpv-lead]')) && (await p.$$('[data-key=gpv-place] .gpv-q')).length === 12);
  // черга «за адресою» від старого довідника, а за новим адреси немає (Харків) → стару не тримаємо, просимо обрати
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); const q = s.places.find(x => x.id === 'p2'); q.gpv = '6.1'; q.gpvAuto = { addr: 'вул. Пушкінська, 5', street: '', city: 'Харків' }; localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await p.waitForTimeout(900);
  { const s2 = await st(), q2 = s2.places.find(x => x.id === 'p2');
    ok('черга «за адресою», якої вже немає в довіднику, знімається сама → «Оберіть чергу», всередині «Для міста Харкова…»', !q2.gpv && !q2.gpvAuto && (await brief('gpv-place')).trim() === 'Оберіть чергу відключень' && /Для міста Харкова/.test(await p.textContent('[data-key=gpv-place] [data-key=gpv-lead]')), q2); }
  // кнопка з ранкового повідомлення: ?go=gpv&place=main → сторінка світла першої квартири, блок розгорнутий
  await p.goto(U + '?go=gpv&place=main'); await p.waitForTimeout(700); s = await st();
  ok('?go=gpv&place=main → #elec першої квартири, графік розгорнутий', (await p.evaluate(() => location.hash)) === '#elec' && s.placeId === 'main' && await isOpen('gpv-elec'));
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.places.find(x => x.id === 'p2').gpv = '1.1'; localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.goto(U + '?go=gpv&place=p2'); await p.waitForTimeout(700); s = await st();
  ok('?go=gpv&place=p2 (без електролічильника) → екран квартири з розгорнутим графіком', (await p.evaluate(() => location.hash)) === '#place-p2' && s.placeId === 'p2' && await isOpen('gpv-place'));
  // графіка на сьогодні не публікували
  cache({ [tomorrow]: day2 }); await p.goto(U + '?go=elec&place=main'); await p.waitForTimeout(600);
  ok('на сьогодні графіка немає → шапка «Графіка на сьогодні ще немає»', (await brief('gpv-elec')).trim() === 'Графіка на сьогодні ще немає');
  await p.click('[data-key=gpv-elec] [data-key=gpv-sum]'); await p.waitForTimeout(200);
  ok('…розгорнуто: «Харківобленерго його не публікувало», завтра — показуємо (і погодинно)', /не публікувало/.test(await p.textContent('[data-key=gpv-today-none]')) && !!(await p.$('[data-key=gpv-day-tomorrow]')) && (await p.$$('[data-key=gpv-wide] .gpv-hrs')).length === 1);
  // російська
  { cache({ [today]: day1 }); const sv = await st(); sv.lang = 'ru'; const r = await (await b.newContext({ viewport: { width: 320, height: 700 }, locale: 'ru-RU' })).newPage(); r.on('pageerror', e => errs.push(e.message));
    await r.goto(U); await r.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), sv); await r.goto(U + '?go=gpv&place=main'); await r.waitForTimeout(700);
    ok('ru, 320 px: «Сегодня без света: 06:00–09:00, …», развёрнут, не шире экрана', /^Сегодня без света: 06:00–09:00/.test((await r.textContent('[data-key=gpv-elec] [data-key=gpv-brief]')).trim()) && /По часам/.test(await r.textContent('[data-key=gpv-wide]'))
      && await r.evaluate(() => document.documentElement.scrollWidth <= 321));
    await r.screenshot({ path: '/tmp/shot_gpv_ru320.png', fullPage: true }); }
  ok('без помилок JS', !errs.length, errs);
  fs.unlinkSync(DATA + '/cache/gpv.json');
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
