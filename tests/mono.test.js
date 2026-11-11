// «Рахунки з monobank» (114-а): розбір виписки — платежі за комуналку, вид, рахунок із призначення, план запитів. Лише синтетика.
const M = require('../web/src/mono.js');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const T = (d) => Math.floor(new Date(d + 'T10:00:00Z').getTime() / 1000);

console.log('Вид послуги за назвою:');
ok('тепло: «Харківські теплові мережі», «Теплоенерго», «Тепловодоенергія»', ['КП «Харківські теплові мережі»', 'КП Теплоенерго', 'КП Броваритепловодоенергія'].every(s => M.kindOf(s) === 'heat'));
ok('вода, світло, газ, сміття, ОСББ', M.kindOf('КП Харківводоканал') === 'water' && M.kindOf('ТОВ Харківенергозбут') === 'elec' && M.kindOf('АТ Газмережі') === 'gas' && M.kindOf('ТОВ Нафтогаз України') === 'gas'
  && M.kindOf('КП Еко-Сан вивіз ТПВ') === 'waste' && M.kindOf('ОСББ «Сонячний»') === 'house');
ok('кирилиця без \\b: «ГРМ» у кінці, «ЯСНО» окремим словом', M.kindOf('Оплата ГРМ') === 'gas' && M.kindOf('YASNO') === 'elec' && M.kindOf('ЯСНО') === 'elec' && M.kindOf('ясновидець') === '');
ok('кава й кіно — нічого', M.kindOf('Кав’ярня «Зерно»') === '' && M.kindOf('Кінотеатр') === '');

console.log('Рахунок із призначення:');
ok('«о/р 1234567»', (M.accOf('Оплата за опалення о/р 1234567, Іваненко') || {}).acc === '1234567');
ok('«Особовий рахунок: 98765432», «ос. рах. 112233», «Лицевой счет 556677», «рахунок № 4455667»', (M.accOf('Особовий рахунок: 98765432') || {}).acc === '98765432' && (M.accOf('ос. рах. 112233 за жовтень') || {}).acc === '112233'
  && (M.accOf('Лицевой счет 556677') || {}).acc === '556677' && (M.accOf('рахунок № 4455667') || {}).acc === '4455667');
ok('рік після рахунку не приклеюється: «о/р 1234567 10.2026»', (M.accOf('о/р 1234567 10.2026') || {}).acc === '1234567', M.accOf('о/р 1234567 10.2026'));
ok('без підпису — найдовша група цифр, guess', (() => { const a = M.accOf('Оплата 1311234567 газ'); return a && a.acc === '1311234567' && a.guess; })());
ok('телефон і сума — не рахунок', M.accOf('Оплата 0971234567') === null && M.accOf('Сплата 380971234567') === null && M.accOf('за 412 грн 412') === null);
ok('EIC з призначення', M.eicOf('EIC 56XS0000000000AB, газ') === '56XS0000000000AB');

console.log('Платежі за комуналку:');
const items = [
  { id: '1', time: T('2026-10-12'), description: 'КП «Харківські теплові мережі»', comment: 'о/р 1234567', mcc: 4900, amount: -41250, counterIban: 'UA00', counterEdrpou: '31557119', counterName: 'КП «Харківські теплові мережі»' },
  { id: '2', time: T('2026-09-12'), description: 'КП «Харківські теплові мережі»', mcc: 4900, amount: -38000, counterEdrpou: '31557119', counterName: 'КП «Харківські теплові мережі»' },
  { id: '3', time: T('2026-10-15'), description: 'Харківводоканал', comment: 'Особовий рахунок 7654321', mcc: 4829, amount: -15600, counterIban: 'UA11', counterEdrpou: '03361715', counterName: 'КП «Харківводоканал»' },
  { id: '4', time: T('2026-10-16'), description: 'Енергомаркет', mcc: 5732, amount: -120000 },                       // магазин — ні
  { id: '5', time: T('2026-10-17'), description: 'Від: Іван', mcc: 4829, amount: 50000 },                              // надходження — ні
  { id: '6', time: T('2026-10-18'), description: 'АТ «Газмережі»', comment: 'о/р 1311234567', mcc: 4900, amount: -9000, counterEdrpou: '03359500', counterName: 'АТ «Газмережі»' },
  { id: '7', time: T('2026-10-19'), description: 'Кава', mcc: 5814, amount: -6000 },
  { id: '8', time: T('2026-10-20'), description: 'Оплата послуг', mcc: 4900, amount: -3000 }                            // MCC 4900 без назви — «інше»
];
const g = M.groups(items);
ok('3 постачальники + «інше»; магазин, надходження й кава — ні', g.length === 4 && g.map(x => x.kind).join() === 'heat,water,gas,other', g.map(x => [x.kind, x.name]));
const heat = g[0];
ok('тепло: два платежі злиті в рядок з рахунком (у вересневому призначення немає)', heat.acc === '1234567' && heat.n === 2 && heat.nMonths === 2 && heat.lastAmt === 412.5 && !heat.guess, heat);
ok('вода: рахунок з коментаря, ЄДРПОУ', g[1].acc === '7654321' && g[1].edrpou === '03361715');
ok('газ: 10 цифр з 1… — рахунок Газмереж', M.gasField(g[2]) === 'grm' && M.gasField({ acc: '123456789', name: 'Нафтогаз' }) === 'account');
ok('isUtility: надходження й холд — ні', !M.isUtility({ amount: 100, mcc: 4900 }) && !M.isUtility({ amount: -100, mcc: 4900, hold: true }));

console.log('План запитів і токен:');
const accs = M.cards({ accounts: [{ id: 'w', type: 'white', currencyCode: 980 }, { id: 'u', type: 'black', currencyCode: 840 }, { id: 'b', type: 'black', currencyCode: 980 }, { id: 'j', type: 'jar', currencyCode: 980 }] });
ok('картки: гривневі, без банок, чорна першою', accs.map(a => a.id).join() === 'b,w');
const now = T('2026-11-11'), q = M.plan(accs, now, 3);
ok('план: 3 місяці × 2 картки, спершу останні 31 доба кожної, вікно ≤ 31 доби', q.length === 6 && q[0].acc === 'b' && q[1].acc === 'w' && q[0].to === now && q.every(x => x.to - x.from <= M.WIN) && q[2].to === now - M.WIN);
ok('токен: base64url 30–64 — так; порожнє, з пробілом, коротке — ні', M.tokenOk('uAbcdEFGhijkLMNopqRSTuvwXYZ0123456789_-abcd') && !M.tokenOk('') && !M.tokenOk('abc def') && !M.tokenOk('short'));
(async () => {
  let seen = null;
  const f = (url, o) => { seen = { url, o }; return Promise.resolve({ status: 403, text: () => Promise.resolve('{"errorDescription":"Unknown \'X-Token\'"}') }); };
  const r = await M.clientInfo('tok', f);
  ok('clientInfo: адреса, заголовок, credentials omit; 403 → token', seen.url === 'https://api.monobank.ua/personal/client-info' && seen.o.headers['X-Token'] === 'tok' && seen.o.credentials === 'omit' && seen.o.referrerPolicy === 'no-referrer' && r.error === 'token', [seen, r]);
  const r2 = await M.statement('tok', { acc: 'b', from: 1, to: 2 }, () => Promise.resolve({ status: 429, text: () => Promise.resolve('{}') }));
  ok('statement 429 → rate', r2.error === 'rate');
  const r3 = await M.statement('tok', { acc: 'b', from: 1, to: 2 }, () => Promise.reject(new Error('x')));
  ok('мережа → network', r3.error === 'network');
  console.log(`\n${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})();
