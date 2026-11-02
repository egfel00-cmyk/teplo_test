// Учёт воды: проверки, команда для бота Водоканала, стоимость, разбор фото барабана. Только синтетика.
const W = require('../web/src/water.js');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const M = [{ id: 'h1', kind: 'hot', vkId: '555555' }, { id: 'c1', kind: 'cold', vkId: '777777' }];

console.log('Проверка показаний:');
let r = W.check(M, { h1: '120', c1: '300' }, { date: '2026-10-15', vals: { h1: '118', c1: '296' } }, '2026-11-15');
ok('обычный месяц — без замечаний', !W.blocked(r) && r.h1.length === 0 && r.c1.length === 0, r);
r = W.check(M, { h1: '110', c1: '300' }, { date: '2026-10-15', vals: { h1: '118', c1: '296' } }, '2026-11-15');
ok('меньше прошлого — блок', W.blocked(r) && r.h1[0].code === 'less');
r = W.check(M, { h1: '118', c1: '296' }, { date: '2026-10-15', vals: { h1: '118', c1: '296' } }, '2026-11-15');
ok('не изменилось — можно (пустая квартира, бойлер), с пояснением', !W.blocked(r) && r.h1[0].code === 'same');
r = W.check(M, { h1: '160', c1: '300' }, { date: '2026-10-15', vals: { h1: '118', c1: '296' } }, '2026-11-15');
ok('скачок > 25 м³/мес — предупреждение', r.h1.some(x => x.code === 'jump') && !W.blocked(r));
r = W.check(M, { h1: '130', c1: '298' }, { date: '2026-10-15', vals: { h1: '118', c1: '296' } }, '2026-11-15');
ok('горячей намного больше холодной — «не перепутаны ли счётчики»', r.h1.some(x => x.code === 'hot_gt_cold'));
r = W.check(M, { h1: '120,456', c1: '300' }, { date: '2026-10-15', vals: { h1: '118', c1: '296' } }, '2026-11-15');
ok('дробь — подсказка «передают целые кубометры»', r.h1.some(x => x.code === 'fraction' && x.whole === 120));
ok('пустое поле — блок', W.blocked(W.check(M, { h1: '', c1: '1' }, null, '2026-11-15')));

console.log('\nКоманда для бота Водоканала:');
let c = W.vkCommand('905614', ' Іваненко ', M, { h1: '63', c1: '42,7' });
ok('формат /2=рахунок:Прізвище|ID-показання,…', c.ok && c.text === '/2=905614:Іваненко|555555-63,777777-42', c.text);
ok('команда «узнать ID»', c.info === '/1=905614:Іваненко');
c = W.vkCommand('905614', 'Іваненко', [{ id: 'h1', kind: 'hot' }, M[1]], { h1: '63', c1: '42' });
ok('счётчик без ID — в missing, команда не готова', !c.ok && c.missing[0] === 'h1');
ok('без рахунку — noAccount', W.vkCommand('', 'X', M, { h1: '1', c1: '2' }).noAccount);

console.log('\nСтоимость и сроки:');
const p = W.cost(3, 2, '2026-11-02');
ok('холодная 3 м³ + горячая 2 м³ по тарифам с 1.10.2026', Math.abs(p.total - (3 * (49.446 + 20.82) + 2 * (86.32 + 20.82))) < 1e-6, p.total);
ok('с 2027 — новый тариф', W.tariffAt('2027-02-01').supply === 57.504);
ok('до 20 числа окно открыто', W.vkWindow('2026-11-18').open && W.vkWindow('2026-11-18').daysLeft === 2 && !W.vkWindow('2026-11-21').open);

console.log('\nИстория:');
const S = W.series([{ id: 'a', date: '2026-09-15', vals: { h1: '100', c1: '250' } }, { id: 'b', date: '2026-10-15', vals: { h1: '103', c1: '256' } }, { id: 'x', date: '2026-10-01', deleted: true, vals: { h1: '1' } }], M);
ok('потребление между соседними, удалённые не считаются', S.length === 2 && S[1].hot === 3 && S[1].cold === 6 && S[0].hot === null);

console.log('\nФото барабана:');
const L = (text, h) => ({ text, h, score: 0.95 });
ok('8 цифр (5 чёрных + 3 красных) → целые м³', W.fromOcr({ lines: [L('NK-15r', 30), L('00123456', 80), L('2013', 30)] }).value === 123);
ok('с прошлым показанием выбирается целая часть, ближайшая не меньше', W.fromOcr({ lines: [L('0012345', 80)] }, 120).value === 123);
ok('заводской номер с буквами не берётся', W.fromOcr({ lines: [L('AB12345678', 90), L('00321', 70)] }).value === 321);
ok('заводской № рядом с «No», год и «x 0,0001» не берутся — null', W.fromOcr({ lines: [Object.assign(L('No', 77), { y: 1118 }), Object.assign(L('3204434', 65), { y: 1142 }), L('2013', 59), L('x0,0001', 60)] }, 450) === null);
ok('барабан с ведущими нулями важнее заводского №', W.fromOcr({ lines: [L('3204434', 65), L('0050231', 50)] }).value === 502);
ok('нет цифр — null', W.fromOcr({ lines: [L('Heat', 40)] }) === null);

console.log('\nОкно барабана (найдено по цвету):');
const D = (text, o) => Object.assign({ text, votes: 3, score: 0.98, cells: 5 }, o || {});
ok('уверенное окно главнее строк текста', W.fromOcr({ drums: [D('00175', { red: '927', tint: 'red' })], lines: [L('796991', 60)] }).value === 175);
ok('окно отделяет м³ от дробей: 6 чёрных роликов', W.fromOcr({ drums: [D('000815', { red: '33', cells: 6 })] }).value === 815);
ok('показание ≥ 1000 м³ (не путать с заводским №)', W.fromOcr({ drums: [D('01023')] }).value === 1023);
ok('неуверенное окно не перебивает строку цифр', W.fromOcr({ drums: [D('515050', { votes: 1, score: 0.56 })], lines: [L('00064512', 80)] }).value === 64);
ok('строка «0137052» начинается с окна «00137» — берём окно', W.fromOcr({ drums: [D('00137', { votes: 1 })], lines: [L('0137052', 80)] }).value === 137);
let h = W.fromOcr({ drums: [D('0023')] });
ok('полуповорот без прошлого — не выдумываем, просим ввести (0023?)', h.value === null && h.partial === '0023?');
h = W.fromOcr({ drums: [D('0023')] }, 237);
ok('полуповорот с прошлым — наименьшее не меньше прошлого, «проверьте»', h.value === 237 && h.half && !h.sure);
ok('полноширинные цифры из распознавателя', W.fromOcr({ lines: [L('０0502347', 80)] }).value === 502);

console.log('\nИстория по видам и месяцы:');
const S2 = W.series([
  { id: 'a', date: '2026-09-15', vals: { h1: '100', c1: '250' } },
  { id: 'b', date: '2026-10-01', vals: { c1: '254' } },                 // только холодная
  { id: 'c', date: '2026-10-15', vals: { h1: '103', c1: '256' } }], M);
ok('запись только по холодной — горячая считается от своего прошлого', S2[1].hot === null && S2[1].cold === 4 && S2[2].hot === 3 && S2[2].daysHot === 30 && S2[2].cold === 2 && S2[2].daysCold === 14, S2.map(x => [x.hot, x.cold, x.daysHot, x.daysCold]));
const MO = W.monthly(S2, 'cold');
ok('холодная по месяцам: две записи октября складываются', MO.length === 1 && MO[0].ym === '2026-10' && MO[0].m3 === 6 && MO[0].days === 30 && MO[0].cost > 0, MO);
ok('сводка: среднее м³ в месяц', Math.abs(W.summary(MO).perMonth - 6 * 30.44 / 30) < 0.01);

console.log('\nРаскладка фото по водомерам:');
const DR = (text, o) => Object.assign({ text, votes: 3, score: 0.95, cells: 5, x: 0, y: 0, w: 300, h: 60 }, o || {});
let A = W.assign([{ drums: [DR('00437', { tint: 'blue' })], lines: [] }, { drums: [DR('00175', { tint: 'red' })], lines: [] }], M, {});
ok('два фото: по цвету кольца — красное к горячей, синее к холодной', A.by.h1.value === 175 && A.by.c1.value === 437 && A.by.h1.photo === 1 && A.by.h1.why === 'tint' && !A.unused.length, A);
A = W.assign([{ drums: [DR('00175', { tint: 'red', x: 0 }), DR('00437', { tint: 'blue', x: 900 })], lines: [] }], M, {});
ok('одно фото с двумя водомерами — оба окна', A.by.h1.value === 175 && A.by.c1.value === 437 && A.by.c1.photo === 0, A);
const MS = [{ id: 'h1', kind: 'hot', serial: '20123456' }, { id: 'c1', kind: 'cold', serial: '3204434' }];
A = W.assign([{ drums: [DR('00437')], lines: [{ text: '3204434', x: 0, y: 100, w: 200, h: 30 }] }], MS, {});
ok('заводской № на фото главнее всего', A.by.c1 && A.by.c1.value === 437 && A.by.c1.why === 'serial' && !A.by.h1, A);
A = W.assign([{ drums: [DR('00172')], lines: [] }, { drums: [DR('00433')], lines: [] }], M, { h1: '170', c1: '430' });
ok('без цвета и номера — по близости к прошлым показаниям', A.by.h1.value === 172 && A.by.c1.value === 433 && A.by.h1.why === 'prev', A);
A = W.assign([{ drums: [DR('00175')], lines: [] }, { drums: [DR('00437')], lines: [] }], M, {});
ok('подсказок нет — обе раскладки «наугад», просим проверить', A.by.h1.guess && A.by.c1.guess && A.by.h1.why === '', A);
A = W.assign([{ drums: [DR('00175', { tint: 'red' })], lines: [] }, { drums: [DR('00175', { tint: 'red' })], lines: [] }, { drums: [], lines: [{ text: 'Heat' }] }], M, {});
ok('второе фото того же водомера и фото без барабана — не использованы', A.by.h1.value === 175 && !A.by.c1 && A.unused.join() === '1,2', A);

console.log(`\nИтог: ${pass} OK, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
