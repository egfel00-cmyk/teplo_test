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
ok('isUtility: надходження — ні', !M.isUtility({ amount: 100, mcc: 4900 }));

console.log('План запитів і токен:');
const accs = M.cards({ accounts: [{ id: 'w', type: 'white', currencyCode: 980 }, { id: 'u', type: 'black', currencyCode: 840 }, { id: 'b', type: 'black', currencyCode: 980 }, { id: 'j', type: 'jar', currencyCode: 980 }] });
ok('картки: гривневі, без банок, чорна першою', accs.map(a => a.id).join() === 'b,w');
const now = T('2026-11-11'), q = M.plan(accs, now, 3);
ok('план: 3 місяці × 2 картки, спершу останні 31 доба кожної, вікно ≤ 31 доби', q.length === 6 && q[0].acc === 'b' && q[1].acc === 'w' && q[0].to === now && q.every(x => x.to - x.from <= M.WIN) && q[2].to === now - M.WIN);
ok('токен: base64url 30–64 — так; порожнє, з пробілом, коротке — ні', M.tokenOk('uAbcdEFGhijkLMNopqRSTuvwXYZ0123456789_-abcd') && !M.tokenOk('') && !M.tokenOk('abc def') && !M.tokenOk('short'));
console.log('Вивіз сміття (115-а): окремі платежі для історії:');
const wg = M.groups([{ id: 'w1', time: T('2026-10-14'), description: 'КП Еко-Сан вивіз ТПВ', comment: 'о/р 55667788', mcc: 4900, amount: -4200, counterEdrpou: '11223344', counterName: 'КП «Еко-Сан»' },
  { id: 'w2', time: T('2026-09-12'), description: 'КП Еко-Сан вивіз ТПВ', mcc: 4900, amount: -4200, counterEdrpou: '11223344', counterName: 'КП «Еко-Сан»' }]);
ok('сміття: один рядок, рахунок, два платежі (новіший першим)', wg.length === 1 && wg[0].kind === 'waste' && wg[0].acc === '55667788' && wg[0].pays.length === 2 && wg[0].pays[0].amount === 42, wg);
ok('payOf: дата за Києвом, сума, за минулий місяць', JSON.stringify(M.payOf({ time: T('2026-10-14'), amount: 42 })) === JSON.stringify({ date: '2026-10-14', ym: '2026-09', amount: 42 })
  && M.payOf({ time: Math.floor(Date.parse('2026-01-31T23:30:00Z') / 1000), amount: 1 }).date === '2026-02-01' && M.payOf({ time: T('2026-01-10'), amount: 1 }).ym === '2025-12');
// 117-а: ключ із вставленого — з підписом, пробілами, переносом, адресою сторінки; телефон і слово — ні
const KEY = 'uSynthKey_0123456789abcdefABCDEF-xyz012345';
ok('tokenFrom: чистий ключ, «Токен: …», переноси, з адресою; ні — порожньо', M.tokenFrom(KEY) === KEY && M.tokenFrom('Токен: ' + KEY + '\n') === KEY && M.tokenFrom('  ' + KEY + '  ') === KEY
  && M.tokenFrom('https://api.monobank.ua/index.html#/tokens/personal ' + KEY) === KEY && M.tokenFrom('380501234567') === '' && M.tokenFrom('Шевченко') === '' && M.tokenFrom('') === ''
  && M.tokenFrom('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') === '');
console.log('128-а: штрафи й податки, каталог без IBAN, 500 операцій, план глибше:');
const fine = { id: 'f1', time: T('2026-11-10'), description: 'ГУК Харків/м.Харків/21081100', comment: '*;101;3012345678;Штраф за порушення правил благоустрою, постанова № 123456', mcc: 4829, amount: -34000, counterIban: 'UA358999980314000544000020001', counterEdrpou: '37874947', counterName: 'ГУК у Харківській обл/тг м.Харків' };
const fine2 = { id: 'f2', time: T('2026-11-09'), description: 'Штрафи ПДР', mcc: 9222, amount: -51000 };
const tax = { id: 't1', time: T('2026-11-08'), description: 'Податок на нерухомість', comment: 'енергоефективність', mcc: 9311, amount: -120000, counterIban: 'UA078999980334139811000020001' };
const village = { id: 'v1', time: T('2026-10-20'), description: 'Малоданилівська селищна рада', comment: 'Оплата за водопостачання о/р 4512', mcc: 4829, amount: -21000, counterIban: 'UA128999980334199871000020545', counterEdrpou: '04396844', counterName: 'Малоданилівська селищна рада' };
ok('штраф (благоустрій, Казначейство), штраф ПДР (9222), податок — не комуналка', !M.isUtility(fine) && !M.isUtility(fine2) && !M.isUtility(tax) && M.isGov(fine) && M.isGov(fine2) && M.isGov(tax));
ok('вода сільраді на рахунок Казначейства — комуналка (назва прямо каже «водопостачання»)', M.isUtility(village) && M.groups([village])[0].kind === 'water' && M.groups([village])[0].acc === '4512', M.groups([village]));
const cat = { id: 'c1', time: T('2026-10-11'), description: 'Харківводоканал', mcc: 4829, amount: -15600 }, pers = { id: 'p1', time: T('2026-10-11'), description: 'Тепленко Іван', mcc: 4829, amount: -50000 };
ok('каталог «Платежі» без IBAN (MCC 4829, «Харківводоканал») — так; переказ «Тепленко» — ні', M.isUtility(cat) && !M.isUtility(pers));
ok('свіжий платіж ще hold — теж (для рахунку годиться)', M.isUtility({ amount: -100, mcc: 4900, hold: true, description: 'КП Харківводоканал' }));
ok('той самий платіж двічі (сторінки 500 перекриваються) — один', M.groups([items[0], items[0], items[1]])[0].n === 2);
const page = Array.from({ length: 500 }, (_, i) => ({ id: 'n' + i, time: T('2026-11-10') - i * 60, amount: -100, mcc: 5411 }));
const q0 = { acc: 'b', from: T('2026-10-10'), to: T('2026-11-11'), w: 0 }, nx = M.next(q0, page);
ok('500 операцій — ще сторінка того ж вікна: to = найстаріша, from той самий', nx && nx.acc === 'b' && nx.from === q0.from && nx.to === T('2026-11-10') - 499 * 60 && nx.page === 1, nx);
ok('499 — усе прочитано; найстаріша на межі from — без петлі', M.next(q0, page.slice(1)) === null && M.next({ acc: 'b', from: page[499].time, to: q0.to }, page) === null);
const qd = M.plan(accs, now, 3, 6);
ok('план: 3 місяці кожної картки + головна до 6 місяців', qd.length === 9 && qd.slice(6).every(x => x.acc === 'b') && qd[8].w === 5 && qd[8].to === now - 5 * M.WIN, qd.map(x => x.acc + x.w));
const st = M.stats([fine, fine2, items[0], items[0], items[2], items[6]]);
ok('stats: лише числа — операцій, держплатежів, комуналки, групи «вид+рахунок»', st.n === 5 && st.gov === 2 && st.ut === 2 && st.g === 'heat+ water+', st);
(async () => {
  const rt = await M.statement('tok', { acc: 'b', from: 1, to: 2 }, () => new Promise(() => {}), 50);
  ok('запит завис — за тайм-аутом «timeout», а не «шукаю…» без кінця', rt.error === 'timeout', rt);
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
