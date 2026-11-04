// Графік відключень світла (ГПВ Харківобленерго): лише у квартир з адресою, вибір черги, сьогодні/завтра, «зараз», сторінка світла,
// шапка в списку квартир, ?go=gpv з ранкового повідомлення. Кеш графіка — синтетичний (SITE_DATA/cache/gpv.json), дати — сьогодні за Києвом.
// Нужен сайт 127.0.0.1:8013 (SITE_DATA=/tmp/teplo_data).
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
      : /Науки/.test(q) ? { ready: true, found: false, reason: 'nohouse', street: 'просп. Науки', city: 'м. Харків', options: ['4.1', '4.2'] } : { ready: true, found: false, reason: 'street' };
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) }); });
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')));
  const seed = async (s) => { await p.goto(U); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), s); await p.goto(U + '#home'); await p.reload(); await p.waitForTimeout(600); };
  const base = demo({ elec: 1, today }); base.demoMin = 400;   // 06:40 — у черги 1.1 зараз відключення до 09:00
  await seed(base);
  ok('без адреси — графіка немає ні на головній, ні на сторінці світла', !(await p.$('[data-key=gpv-home]')));
  await p.goto(U + '#elec'); await p.waitForTimeout(400); ok('…сторінка світла теж без графіка', !(await p.$('[data-key=gpv-elec]')));
  await p.goto(U + '#home'); await p.waitForTimeout(300);
  await p.click('[data-key=home-addr-add]'); await p.waitForTimeout(200);
  ok('у полі адреси — підказка «За адресою покажемо графік відключень світла»', /графік відключень/.test(await p.textContent('.hp-addr-gpv')));
  await p.fill('#hpa-main', 'вул. Сумська, 10, кв. 61'); await p.click('[data-key=hp-save]'); await p.waitForTimeout(700);
  let s = await st();
  ok('є адреса → черга визначилась сама (3.1 «— за адресою (вул. Сумська, м. Харків)»), без вибору', s.places[0].gpv === '3.1' && s.places[0].gpvAuto && s.places[0].gpvAuto.addr === 'вул. Сумська, 10, кв. 61'
    && /за адресою \(вул\. Сумська, м\. Харків\)/.test(await p.textContent('[data-key=gpv-auto]')) && !(await p.$('[data-key=gpv-home] .gpv-q')), s.places[0]);
  await p.click('[data-key=gpv-change]'); await p.waitForTimeout(200);
  ok('«Не та черга?» → 12 кнопок і посилання на офіційний пошук', (await p.$$('[data-key=gpv-home] .gpv-q')).length === 12 && /getinfoingao/.test(await p.getAttribute('[data-key=gpv-lookup]', 'href')));
  await p.click('[data-key=gpv-q-1\\.1]'); await p.waitForTimeout(400); s = await st();
  ok('обрали 1.1 вручну → збережено, автопідбір знято (адресу не перевизначаємо)', s.places[0].gpv === '1.1' && !s.places[0].gpvAuto && /Черга 1\.1/.test(await p.textContent('[data-key=gpv-q]')) && !(await p.$('[data-key=gpv-auto]')));
  const box = await p.textContent('[data-key=gpv-home]');
  ok('сьогодні: «зараз світла немає — до 09:00», години й разом', /зараз світла немає — до 09:00/.test(await p.textContent('[data-key=gpv-now]')) && /06:00–09:00, 12:30–19:30, 23:00–24:00/.test(box) && /разом 11 год/.test(box), box);
  ok('…шкала 24 год: 3 відрізки «без світла» і позначка «зараз»', (await p.$$('[data-key=gpv-day-today] .gpv-bar i.off')).length === 3 && !!(await p.$('[data-key=gpv-day-today] .gpv-mark')));
  ok('завтра: окремо, 00:00–02:00, без позначки «зараз»', /00:00–02:00/.test(await p.textContent('[data-key=gpv-day-tomorrow]')) && !(await p.$('[data-key=gpv-day-tomorrow] .gpv-mark')));
  ok('не ввійшли — «Увійдіть через Telegram — графік приходитиме щоранку»; джерело й час оновлення', /Увійдіть через Telegram/.test(await p.textContent('[data-key=gpv-tg-need]')) && /оновлено 04\.11\.2026 07:05/.test(box));
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.demoMin = 600; localStorage.setItem('teplo.v1', JSON.stringify(s)); }); await p.reload(); await p.waitForTimeout(500);
  ok('10:00 — «зараз світло є — вимкнуть о 12:30»', /зараз світло є — вимкнуть о 12:30/.test(await p.textContent('[data-key=gpv-now]')));
  await p.click('[data-key=gpv-change]'); await p.waitForTimeout(200);
  ok('«Змінити чергу» → знову кнопки, поточна натиснута, «Скасувати»', await p.getAttribute('[data-key=gpv-q-1\\.1]', 'aria-pressed') === 'true' && !!(await p.$('[data-key=gpv-cancel]')));
  await p.click('[data-key=gpv-q-3\\.1]'); await p.waitForTimeout(300);
  ok('черга 3.1 — «Відключень за графіком немає», «світло є»', /Відключень за графіком немає/.test(await p.textContent('[data-key=gpv-day-today]')) && /світло є/.test(await p.textContent('[data-key=gpv-now]')));
  await p.click('[data-key=gpv-change]'); await p.click('[data-key=gpv-q-1\\.1]'); await p.waitForTimeout(300);
  await p.goto(U + '#elec'); await p.waitForTimeout(400);
  ok('сторінка світла: той самий графік квартири', !!(await p.$('[data-key=gpv-elec]')) && /12:30–19:30/.test(await p.textContent('[data-key=gpv-elec]')));
  ok('360 px — блок не ширший за екран', await p.evaluate(() => { const e = document.querySelector('[data-key=gpv-elec]'); return e.scrollWidth <= e.clientWidth + 1 && document.documentElement.scrollWidth <= 361; }));
  // дві квартири: у шапці — коротко «світло вимкнуть о 12:30»; друга без адреси — без графіка
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.places.push({ id: 'p2', v: 2, name: 'Мамина', address: '', color: 'violet', meter: null, baseline: null, updatedAt: 1, water: { meters: [{ id: 'c9', kind: 'cold', name: '' }] } }); s.homeOpen = { main: false, p2: true }; localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.goto(U + '#home'); await p.reload(); await p.waitForTimeout(500);
  ok('дві квартири: у шапці першої — «світло вимкнуть о 12:30», друга (без адреси) — без графіка', /світло вимкнуть о 12:30/.test(await p.textContent('[data-key=home-pl-sum-main]')) && !(await p.$('[data-key=home-pl-p2] [data-key=gpv-home]')));
  await p.click('[data-key=home-pl-p2] [data-key=home-pl-edit-p2]'); await p.waitForTimeout(200); await p.fill('#hpa-p2', 'просп. Науки'); await p.click('[data-key=hp-save]'); await p.waitForTimeout(700);
  ok('вулиця в кількох чергах без номера будинку → лише її черги (4.1, 4.2) і «Допишіть номер будинку…», «Показати всі черги»', (await p.$$('[data-key=home-pl-p2] .gpv-q')).length === 2
    && /кількох чергах/.test(await p.textContent('[data-key=home-pl-p2] [data-key=gpv-lead]')) && !!(await p.$('[data-key=home-pl-p2] [data-key=gpv-all]')));
  await p.click('[data-key=home-pl-p2] [data-key=home-pl-edit-p2]'); await p.waitForTimeout(200); await p.fill('#hpa-p2', 'вул. Вигадана, 1'); await p.click('[data-key=hp-save]'); await p.waitForTimeout(700);
  ok('адреси немає в переліку → «Не знайшли адресу… Оберіть чергу» і всі 12', /Не знайшли адресу «вул\. Вигадана, 1»/.test(await p.textContent('[data-key=home-pl-p2] [data-key=gpv-lead]')) && (await p.$$('[data-key=home-pl-p2] .gpv-q')).length === 12);
  // кнопка з ранкового повідомлення: ?go=gpv&place=main → головна, квартира розгорнута, блок графіка
  await p.goto(U + '?go=gpv&place=main'); await p.waitForTimeout(600);
  ok('?go=gpv&place=main → головна, перша квартира розгорнута з графіком', (await p.evaluate(() => location.hash)) === '#home' && await p.$eval('[data-key=home-pl-main]', e => e.open) && !!(await p.$('[data-key=home-pl-main] [data-key=gpv-home]')));
  // графіка на сьогодні не публікували
  cache({ [tomorrow]: day2 }); await p.goto(U + '#elec'); await p.reload(); await p.waitForTimeout(500);
  ok('на сьогодні графіка немає → «Харківобленерго його не публікувало», завтра — показуємо', /не публікувало/.test(await p.textContent('[data-key=gpv-today-none]')) && !!(await p.$('[data-key=gpv-day-tomorrow]')));
  ok('без помилок JS', !errs.length, errs);
  fs.unlinkSync(DATA + '/cache/gpv.json');
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
