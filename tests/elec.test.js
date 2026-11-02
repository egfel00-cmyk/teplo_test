// Учёт света: зоны, окно приёма, проверки, расход и стоимость. Только синтетика.
const E = require('../web/src/elec.js');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const M1 = { id: 'e1', kind: 'elec', zones: 1 }, M2 = { id: 'e2', kind: 'elec', zones: 2 }, M3 = { id: 'e3', kind: 'elec', zones: 3 };

console.log('Окно приёма (останні 2 дні місяця + 1–3 число):');
let w = E.win('2026-11-02');
ok('2 листопада — відкрито за жовтень, до 3.11, лишилось 1 день', w.open && w.ym === '2026-10' && w.to === '2026-11-03' && w.from === '2026-10-30' && w.daysLeft === 1, w);
w = E.win('2026-11-15');
ok('15 листопада — закрито, відкриється 29.11 (у листопаді 30 днів)', !w.open && w.next === '2026-11-29' && w.to === '2026-12-03', w);
w = E.win('2026-11-29');
ok('29 листопада — відкрито за листопад, до 3.12', w.open && w.ym === '2026-11' && w.to === '2026-12-03' && w.daysLeft === 4, w);
ok('31 грудня — за грудень, до 3.01.2027', E.win('2026-12-31').to === '2027-01-03' && E.win('2026-12-31').ym === '2026-12');
ok('лютий 2027: відкривається 27-го', E.win('2027-02-26').next === '2027-02-27' && E.win('2027-02-27').open);
ok('показання 2.11 — за жовтень, 30.11 — за листопад', E.forMonth('2026-11-02') === '2026-10' && E.forMonth('2026-11-30') === '2026-11');

console.log('Цифри:');
ok('«12 345,6» → 12345.6, ціле — 12345', E.norm('12 345,6') === '12345.6' && E.whole('12345,6') === 12345);
ok('«12a», «-5», «1,234» — не число', E.norm('12a') === null && E.norm('-5') === null && E.norm('1,234') === null);
ok('зони: 1 → all; 2 → день/ніч; 3 → пік/напівпік/ніч', E.keys(M1).join() === 'all' && E.keys(M2).join() === 'day,night' && E.keys(M3).join() === 'peak,half,night');

console.log('Перевірка показань:');
let r = E.check(M2, { day: '10250', night: '5120' }, { date: '2026-10-31', z: { day: '10100', night: '5050' } }, '2026-11-30');
ok('звичайний місяць (150 + 70) — без зауважень', r.length === 0, r);
r = E.check(M2, { day: '10050', night: '5120' }, { date: '2026-10-31', z: { day: '10100', night: '5050' } }, '2026-11-30');
ok('день менше минулого — блок', E.blocked(r) && r[0].code === 'less' && r[0].zone === 'day' && r[0].prev === 10100, r);
r = E.check(M2, { day: '15300', night: '5120' }, { date: '2026-10-31', z: { day: '10100', night: '5050' } }, '2026-11-30');
ok('у «день» вписали загальний (≈ сума зон) — попередження «sum»', r.some(x => x.code === 'sum' && x.zone === 'day'), r);
r = E.check(M2, { day: '160', night: '70' }, { date: '2026-10-31', z: { day: '100', night: '50' } }, '2026-11-30');
ok('новий лічильник 100/50 → день 160: не «сума» (приріст звичайний)', !r.some(x => x.code === 'sum'), r);
r = E.check(M1, { all: '9000' }, { date: '2026-10-31', z: { all: '7000' } }, '2026-11-30');
ok('2000 кВт·год за місяць у квартирі — «багато»', r.some(x => x.code === 'jump' && x.perMonth === 2000), r);
ok('з електроопаленням 2000 — нормально', !E.check(M1, { all: '9000' }, { date: '2026-10-31', z: { all: '7000' } }, '2026-11-30', { heating: true }).some(x => x.code === 'jump'));
r = E.check(M2, { day: '10100', night: '' }, { date: '2026-10-31', z: { day: '10100', night: '5050' } }, '2026-11-30');
ok('порожня зона — блок', E.blocked(r) && r.some(x => x.code === 'empty' && x.zone === 'night'), r);
r = E.check(M1, { all: '7000,8' }, { date: '2026-10-31', z: { all: '7000' } }, '2026-11-30');
ok('з десятими — інформація «передається 7000», без змін — «same»', r.some(x => x.code === 'fraction' && x.whole === 7000) && r.some(x => x.code === 'same'), r);
ok('перші показання — без порівняння', E.check(M3, { peak: '1', half: '2', night: '3' }, null, '2026-11-30').length === 0);

console.log('Вартість (4,32 грн; ніч ×0,5; 3 зони — ×1,5 / ×1 / ×0,4; електроопалення 2,64 до 2000):');
let c = E.cost(M1, { all: 100 }, '2026-11-30');
ok('однозонний 100 кВт·год = 432 грн', Math.abs(c.total - 432) < 1e-9, c);
c = E.cost(M2, { day: 100, night: 100 }, '2026-11-30');
ok('двозонний 100 день + 100 ніч = 432 + 216 = 648', Math.abs(c.total - 648) < 1e-9, c);
c = E.cost(M3, { peak: 10, half: 10, night: 10 }, '2026-11-30');
ok('тризонний 10/10/10 = 64,8 + 43,2 + 17,28 = 125,28', Math.abs(c.total - 125.28) < 1e-9, c);
c = E.cost(M1, { all: 2500 }, '2026-12-31', { heating: true });
ok('електроопалення в грудні: 2000×2,64 + 500×4,32 = 7440', Math.abs(c.total - 7440) < 1e-6, c);
ok('електроопалення влітку — звичайна ціна', Math.abs(E.cost(M1, { all: 100 }, '2026-07-31', { heating: true }).total - 432) < 1e-9);

console.log('Ряд і місяці:');
const recs = [
  { id: 'a', meter: 'e2', date: '2026-08-31', z: { day: '10000', night: '5000' }, base: true },
  { id: 'b', meter: 'e2', date: '2026-10-01', z: { day: '10120', night: '5060' } },
  { id: 'c', meter: 'e2', date: '2026-10-31', z: { day: '10250', night: '5130' } },
  { id: 'x', meter: 'e9', date: '2026-10-31', z: { all: '1' } },
  { id: 'd', meter: 'e2', date: '2026-11-02', z: { day: '10260', night: '5135' }, deleted: true }
];
const ser = E.series(recs, M2);
ok('ряд лише цього лічильника, без видалених; перший без розходу', ser.length === 3 && ser[0].dz === null && ser[1].kwh === 180 && ser[2].dz.day === 130 && ser[2].dz.night === 70, ser.map(x => x.kwh));
const mo = E.monthly(ser, M2);
ok('місяці: 1.10 → вересень (180), 31.10 → жовтень (200)', mo.length === 2 && mo[0].ym === '2026-09' && mo[0].kwh === 180 && mo[1].ym === '2026-10' && mo[1].kwh === 200, mo);
ok('вартість жовтня: 130×4,32 + 70×2,16 = 712,8', Math.abs(mo[1].cost - 712.8) < 1e-6, mo[1].cost);
const sm = E.summary(mo);
ok('у середньому за місяць ≈ 190 кВт·год, частка ночі ≈ 0,34', Math.abs(sm.perMonth - 380 / 61 * 30) < 1e-6 && Math.abs(E.nightShare(mo) - 130 / 380) < 1e-9, sm);

console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); process.exit(fail ? 1 : 0);
