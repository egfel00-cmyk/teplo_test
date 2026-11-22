// 176-я (власник 22.11): «по 2 холодних і гарячих (ванна й кухня), у холодної й гарячої може бути різний особовий рахунок — зараз у всіх однаковий
// і заміняється, хоча платять різним постачальникам». Рахунок і постачальник води — по виду: p.water.acc {cold, hot} (старе account — холодна),
// «Кому платите» гарячої — place.prov.hot. Синтетика: квартира в Харкові, 2 холодних + 2 гарячих водоміри.
// cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_wacc.cjs
const { chromium } = require('playwright');
const demo = require('./demo.cjs');
let pass = 0, fail = 0;
const ok = (name, c, extra) => { if (c) pass++; else fail++; console.log((c ? 'ok   ' : 'FAIL ') + name + (extra !== undefined && !c ? '  ' + JSON.stringify(extra).slice(0, 500) : '')); };
const B = 'http://127.0.0.1:8013/';
const state = (o) => {
  const s = demo({});
  const w = s.places[0].water;
  w.meters.push({ id: 'h2', kind: 'hot', name: 'Кухня', serial: '20999', vkId: '556', verifiedUntil: '2029-01-01' }, { id: 'c2', kind: 'cold', name: 'Кухня', serial: '32999', vkId: '778', verifiedUntil: '2029-01-01' });
  w.account = '1111111'; delete w.acc;   // старий стан: один рахунок на квартиру
  s.water.forEach(r => { r.vals.h2 = '50'; r.vals.c2 = '90'; });
  s.water.push({ id: 'w20261102', place: 'main', date: '2026-11-02', vals: { h1: '176', c1: '439', h2: '52', c2: '93' }, createdAt: '2026-11-02T10:00:00Z', updatedAt: 1, sent: {} });
  return Object.assign(s, o || {});
};
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  const put = async (s) => { await p.goto(B); await p.evaluate(x => { localStorage.clear(); localStorage.setItem('teplo.v1', JSON.stringify(x)); localStorage.setItem('teplo.cc', JSON.stringify({ v: 1, a: 0, at: new Date().toISOString(), id: 'e2e' })); }, s); };
  const go = async (route) => { await p.goto('about:blank'); await p.goto(B + '#' + route); await p.waitForTimeout(700); };
  const st = () => p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')));
  const val = sel => p.$eval(sel, e => e.value).catch(() => null);
  const setv = (sel, v) => p.$eval(sel, (e, x) => { e.value = x; e.dispatchEvent(new Event('change', { bubbles: true })); }, v);
  const txt = sel => p.$eval(sel, e => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
  const has = sel => p.$(sel).then(Boolean);
  const W = s => s.places[0].water;

  // 1. старий стан (лише account) — це холодна; гаряча — порожньо, не копія
  await put(state());
  await go('water-cold');
  ok('1. холодна: рахунок Водоканалу зі старого account', await val('#mw-acc') === '1111111', await val('#mw-acc'));
  await go('water-hot');
  ok('1. гаряча: окреме поле «Особовий рахунок за гарячу воду», порожнє', await val('#mw-hacc') === '' && !(await has('#mw-acc')), { h: await val('#mw-hacc'), c: await has('#mw-acc') });

  // 2. гаряча — свій рахунок; холодна не змінюється
  await setv('#mw-hacc', '2222222'); await p.waitForTimeout(300);
  let s = await st();
  ok('2. гаряча → acc.hot, холодна (account) та сама', W(s).acc && W(s).acc.hot === '2222222' && W(s).account === '1111111' && !W(s).acc.cold, W(s));
  // 3. холодна — новий рахунок; гарячий не чіпаємо
  await go('water-cold'); await setv('#mw-acc', '3333333'); await p.waitForTimeout(300);
  s = await st();
  ok('3. холодна → acc.cold і дзеркало account, гаряча лишилась', W(s).acc.cold === '3333333' && W(s).account === '3333333' && W(s).acc.hot === '2222222', W(s));
  ok('3. рахунки — об\'єктом, не масивом', W(s).acc && !Array.isArray(W(s).acc) && typeof W(s).acc === 'object');

  // 4. після перезавантаження — те саме, кожен на своїй сторінці
  await go('water-hot');
  ok('4. після перезавантаження: гаряча 2222222', await val('#mw-hacc') === '2222222', await val('#mw-hacc'));
  await go('water-cold');
  ok('4. після перезавантаження: холодна 3333333', await val('#mw-acc') === '3333333', await val('#mw-acc'));

  // 5. «Куди передати»: команда боту Водоканалу — рахунок холодної, усі 4 водоміри; ХТМ (гаряча) — рахунок за гарячу
  const cmd = await txt('[data-key=wsend-cmd]');
  ok('5. команда Водоканалу — з рахунком холодної, без гарячого рахунку', cmd.includes('3333333') && !cmd.includes('2222222') && /556/.test(cmd) && /778/.test(cmd), cmd);
  await go('water-hot');
  ok('5. гаряча: «Інший постачальник» під «Куди передати» — гарячої (не всієї води)', await has('[data-key=my-link-hot]') && !(await has('[data-key=my-link-water]')));
  ok('5. гаряча: у блоці ХТМ — «Рахунок за гарячу» 2222222', /2222222/.test(await txt('[data-key=wsend-hacc]')), await txt('[data-key=wsend-hacc]'));

  // 6. екран квартири, «Постачальники, тарифи й рахунки»: гаряча — окремим рядком зі своїм рахунком
  await go('place-main');
  ok('6. квартира: рядок «Гаряча вода» — ХТМ, ціна, поле рахунку 2222222', await has('[data-key=prov-hot]') && /ХТМ/.test(await txt('[data-key=prov-hot]')) && await val('#ph-hacc') === '2222222', await txt('[data-key=prov-hot]'));
  ok('6. квартира: рахунок Водоканалу — 3333333', await val('#w-acc') === '3333333', await val('#w-acc'));
  await setv('#ph-hacc', '4444444'); await p.waitForTimeout(300);
  s = await st();
  ok('6. квартира: змінили гарячий — холодний той самий', W(s).acc.hot === '4444444' && W(s).acc.cold === '3333333', W(s).acc);

  // 7. «Кому платите» гарячої — свій постачальник; холодна лишається Водоканалом
  await go('water-hot');
  await p.$eval('input[data-my-pick="hot"][value="1"]', e => { e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(500);
  await setv('#my-hot-name', 'ТОВ «Гарячий дім»'); await p.waitForTimeout(600);
  s = await st();
  ok('7. гаряча → prov.hot свій, prov.water не свій', s.places[0].prov && s.places[0].prov.hot && s.places[0].prov.hot.own === 1 && s.places[0].prov.hot.name === 'ТОВ «Гарячий дім»' && !((s.places[0].prov.water || {}).own), s.places[0].prov);
  await go('water-hot');
  ok('7. сторінка гарячої — «Оплата» свого, без Водоканалу', await has('[data-key=mypay-hot]') && !(await has('[data-key=wsend-cmd]')), { pay: await has('[data-key=mypay-hot]') });
  // гаряча від жовтня: 176 − 175 + 52 − 50 = 3 м³ × 86,32 (тариф Харкова) = 258,96 — без холодної й водовідведення
  ok('7. «Оплата» гарячої — 3 м³ і 258,96 ₴ лише за гарячу', /258,96/.test(await txt('[data-key=mypay-hot]')) && /3 м³/.test(await txt('[data-key=mypay-hot]')), await txt('[data-key=mypay-hot]'));
  await go('water-cold');
  ok('7. сторінка холодної — як і була: Водоканал з командою', /3333333/.test(await txt('[data-key=wsend-cmd]')) && !(await has('[data-key=mypay-water]')), await txt('[data-key=wsend-cmd]'));
  // «Оплачено» гарячої — лише sent.htm (Водоканал холодної не позначаємо)
  await go('water-hot');
  await p.$eval('[data-key=mypay-hot] [data-key=my-paid]', e => e.click()); await p.waitForTimeout(400);
  s = await st();
  const r = s.water.find(x => x.id === 'w20261102');
  ok('7. «Оплачено» гарячої → sent.htm, sent.vk порожньо', r.sent && r.sent.htm && !r.sent.vk, r.sent);
  // 8. холодна — теж свій, інший; гаряча свого не змінює
  await go('water-cold');
  await p.$eval('input[data-my-pick="water"][value="1"]', e => { e.checked = true; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(500);
  await setv('#my-water-name', 'ОСББ «Холодок»'); await p.waitForTimeout(600);
  s = await st();
  ok('8. холодна → свій «Холодок», гаряча — «Гарячий дім»', s.places[0].prov.water.own === 1 && s.places[0].prov.water.name === 'ОСББ «Холодок»' && s.places[0].prov.hot.name === 'ТОВ «Гарячий дім»', s.places[0].prov);
  await go('place-main');
  ok('8. квартира: два рядки своїх — вода й гаряча', /Холодок/.test(await txt('[data-key=prov-water]')) && /Гарячий дім/.test(await txt('[data-key=prov-hot]')), { w: await txt('[data-key=prov-water]'), h: await txt('[data-key=prov-hot]') });

  // 9. старий «свій постачальник води» (без prov.hot) — гаряча успадковує, як і було
  const so = state(); so.places[0].prov = { water: { own: 1, name: 'ЖБК «Старий»', how: 'cash', at: '2026-11-01', ts: 1 } };
  await put(so); await go('water-hot');
  ok('9. без prov.hot — гаряча як холодна: «Оплата» свого «Старий»', /Старий/.test(await txt('[data-key=mypay-water]')), await txt('main'));
  // 10. рахунки прийшли масивом (сервер {} → []) — читаються й пишуться об'єктом
  const sa = state(); sa.places[0].water.acc = [];
  await put(sa); await go('water-hot'); await setv('#mw-hacc', '5555555'); await p.waitForTimeout(300);
  s = await st();
  ok('10. acc [] → об\'єкт з гарячим 5555555, холодний — account', W(s).acc && !Array.isArray(W(s).acc) && W(s).acc.hot === '5555555' && W(s).account === '1111111', W(s));
  // 11. синхронізація: стан іде на сервер JSON-ом — acc лишається об'єктом із обома рахунками
  const js = await p.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('teplo.v1')).places[0].water.acc));
  ok('11. у JSON для синхронізації — {"hot":"5555555"}', js === '{"hot":"5555555"}', js);

  ok('без помилок сторінки', !errs.length, errs);
  console.log(`\n${pass} ok, ${fail} fail`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
