// Тесты движка проверок на журнале кв. 61 (Sharky 774) и типичных опечатках.
// Запуск: node web/tests/rules.test.js
'use strict';
const R = require('../web/src/rules.js');
let pass = 0, fail = 0;
function t(name, cond, info) { if (cond) { pass++; console.log('  OK  ' + name); } else { fail++; console.log(' FAIL ' + name + (info ? '  → ' + info : '')); } }
const codes = res => res.items.map(i => i.code);
const blocks = res => res.items.filter(i => i.level === 'block').map(i => i.code);

// Эталон: журнал OTOS кв. 61 (документ «счётчики и расчёт», §5)
const J = [
  { date: '2024-02-14', energy: 4.516,  volume: 566.054,  flow: 0.212, power: 2.617, tSupply: 50.47, tReturn: 39.58, hours: 19121, errHours: 0,   errCode: 'E---' },
  { date: '2024-11-20', energy: 6.661,  volume: 834.406,  flow: 0.774, power: 3.059, tSupply: 47.00, tReturn: 43.58, hours: 25852, errHours: 0,   errCode: 'E---' },
  { date: '2024-12-20', energy: 7.948,  volume: 1197.470, flow: 0.874, power: 4.052, tSupply: 47.33, tReturn: 43.33, hours: 26568, errHours: 0,   errCode: 'E---' },
  { date: '2025-01-20', energy: 9.003,  volume: 1542.859, flow: 0.000, power: 0.000, tSupply: 17.85, tReturn: 16.58, hours: 27314, errHours: 0,   errCode: 'E---' },
  { date: '2025-02-20', energy: 11.448, volume: 1972.145, flow: 0.553, power: 2.244, tSupply: 62.16, tReturn: 58.50, hours: 28056, errHours: 0,   errCode: 'E---' },
  { date: '2025-11-03', energy: 12.437, volume: 2228.875, flow: 0.617, power: 3.526, tSupply: 48.62, tReturn: 43.56, hours: 34183, errHours: 0,   errCode: 'E---' },
  { date: '2025-11-20', energy: 13.245, volume: 2292.676, flow: 0.063, power: 1.685, tSupply: 50.76, tReturn: 27.71, hours: 34598, errHours: 153, errCode: 'E---' },
  { date: '2026-02-20', energy: 15.482, volume: 2724.494, flow: 1.067, power: 6.790, tSupply: 56.57, tReturn: 51.11, hours: 35611, errHours: 153, errCode: 'E---' }
];
const meter = { hoursOnlyWithFlow: false, transitionalFlow: 0.015 };

console.log('Журнал кв. 61 — пары подряд:');
for (let i = 1; i < J.length; i++) {
  const res = R.validate({ reading: J[i], prev: J[i - 1], meter, today: J[i].date });
  const b = blocks(res);
  if (i === J.length - 1) {
    t(J[i].date + ': робот отклонит по часам (1013 ч за 92 дня — известная проблема журнала)', b.length === 1 && b[0] === 'R_HOURS_CALENDAR', b.join(','));
  } else {
    t(J[i].date + ': робот примет (нет ⛔)', b.length === 0, b.join(',') + ' dt=' + (res.derived.dtAvg || 0).toFixed(2));
  }
}
const r6 = R.validate({ reading: J[6], prev: J[5], meter, today: J[6].date });
t('20.11.25: предупреждение «часы с ошибкой выросли на 153»', codes(r6).includes('M_ERRHOURS_GREW'));
t('20.11.25: мощность сходится с формулой', !codes(r6).includes('P_POWER'));

console.log('\nОпечатки:');
const prev = J[6], base = Object.assign({}, J[6], { date: '2025-11-23', hours: 34598 + 72, energy: 13.40, volume: 2310.1 });
const ok = R.validate({ reading: base, prev, meter, today: '2025-11-23' });
t('база для опечаток проходит', ok.verdict !== 'block', blocks(ok).join(','));
t('пропущена точка 134.0 → R_ENERGY_JUMP', blocks(R.validate({ reading: Object.assign({}, base, { energy: 134.0 }), prev, meter, today: '2025-11-23' })).includes('R_ENERGY_JUMP'));
// 125-а (юзертестинг T330): «минулого разу 70751193 год» — не порівнюємо, попереджаємо; самі 70751193 — не години
{ const bad = Object.assign({}, prev, { hours: 70751193 });
  const r1 = R.validate({ reading: Object.assign({}, base, { hours: 17059 }), prev: bad, meter, today: '2025-11-23' });
  t('минулі години 70751193: без «менше за попередні» і календаря, є W_PREV_HOURS_BAD', !blocks(r1).includes('R_MONO_HOURS') && !blocks(r1).includes('R_HOURS_CALENDAR') && r1.items.some(x => x.code === 'W_PREV_HOURS_BAD'), JSON.stringify(r1.items.map(x => x.code)));
  t('…під полем: не «менше за попередні»', (c => !c || c.level !== 'block')(R.checkField('hours', '17059', bad)));
  const r2 = R.validate({ reading: Object.assign({}, base, { hours: 70751241 }), prev, meter, today: '2025-11-23' });
  t('введені години 70751241 — F_HOURS_HUGE («схоже на заводський номер»)', blocks(r2).includes('F_HOURS_HUGE') && R.checkField('hours', '70751241', prev).level === 'block'); }
// 125-а: кабінет і табло в ГДж — приріст і межа в ГДж, «на екрані» — в ГДж
{ const gm = Object.assign({}, meter, { cab: { k: 0.238846, uk: 'ГДж', ru: 'ГДж' }, screen: { k: 0.238846 } });
  const it = R.validate({ reading: Object.assign({}, base, { energy: 134.0 }), prev, meter: gm, today: '2025-11-23' }).items.filter(x => x.code === 'R_ENERGY_JUMP')[0];
  t('ГДж-кабінет: «Приріст … ГДж — робот приймає менше 62.802 ГДж (15 Гкал)», на екрані ймовірно 56.103', !!it && /ГДж — робот приймає менше 62\.802 ГДж \(15 Гкал\)/.test(it.msg.uk) && /ймовірно, 56\.103 або/.test(it.fix.uk), it && [it.msg.uk, it.fix.uk]); }
t('энергия меньше прошлой → R_MONO_ENERGY', blocks(R.validate({ reading: Object.assign({}, base, { energy: 13.1 }), prev, meter, today: '2025-11-23' })).includes('R_MONO_ENERGY'));
t('объём не изменился → R_ENERGY_WITHOUT_VOLUME', blocks(R.validate({ reading: Object.assign({}, base, { volume: prev.volume }), prev, meter, today: '2025-11-23' })).includes('R_ENERGY_WITHOUT_VOLUME'));
t('подача/обратка перепутаны → P_SUPPLY_LT_RETURN', codes(R.validate({ reading: Object.assign({}, base, { tSupply: 27.71, tReturn: 50.76 }), prev, meter, today: '2025-11-23' })).includes('P_SUPPLY_LT_RETURN'));
t('расход ×10 → мощность не сходится', codes(R.validate({ reading: Object.assign({}, base, { flow: 0.63 }), prev, meter, today: '2025-11-23' })).includes('P_POWER'));
t('температура 0 → R_TEMP_RANGE', blocks(R.validate({ reading: Object.assign({}, base, { tReturn: 0 }), prev, meter, today: '2025-11-23' })).includes('R_TEMP_RANGE'));
t('дата раньше прошлой → F_DATE_BEFORE_PREV', blocks(R.validate({ reading: Object.assign({}, base, { date: '2025-11-19' }), prev, meter, today: '2025-11-23' })).includes('F_DATE_BEFORE_PREV'));
t('чужой месяц → R_CURRENT_MONTH', blocks(R.validate({ reading: Object.assign({}, base, { date: '2025-10-30' }), prev: J[5], meter, today: '2025-11-02' })).includes('R_CURRENT_MONTH'));
t('пустое поле → F_MISSING', blocks(R.validate({ reading: Object.assign({}, base, { power: '' }), prev, meter, today: '2025-11-23' })).includes('F_MISSING'));
t('ΔT < 2.5 → R_DT_MIN', blocks(R.validate({ reading: Object.assign({}, base, { energy: 13.27, volume: 2312.6 }), prev, meter, today: '2025-11-23' })).includes('R_DT_MIN'));
t('ELF-подобный: часов меньше календаря — не ошибка', !blocks(R.validate({ reading: Object.assign({}, base, { hours: 34598 + 10 }), prev, meter: { hoursOnlyWithFlow: true }, today: '2025-11-23' })).includes('R_HOURS_CALENDAR'));
t('повирка просрочена → R_VERIFICATION', blocks(R.validate({ reading: base, prev, meter: { verifiedUntil: '2025-08-30' }, today: '2025-11-23' })).includes('R_VERIFICATION'));
t('запятая принимается как точка', R.num('13,245') === 13.245);
t('формат для ХТМ: точка и 3 знака', R.formatForHtm('energy', '13,2') === '13.200' && R.formatForHtm('date', '2025-11-23') === '23.11.2025' && R.formatForHtm('errCode', '') === 'E---');

console.log('\nОкно приёма:');
t('1-е → закрыто до 5-го', R.windowState('2026-11-01').state === 'closed_before');
t('10-е → открыто', R.windowState('2026-11-10').state === 'open');
t('24-е → поздно, но можно', R.windowState('2026-11-24').state === 'late');
t('25-е → последний день', R.windowState('2026-11-25').state === 'last_day');
t('26-е → закрыто на начисления', R.windowState('2026-11-26').state === 'closed_after');

console.log('\nОтвет робота:');
t('принято', R.decodeRobot('Статус: Показання успішно додані в базу даних.').code === 'ACCEPTED');
t('опечатка «принйяті» + демонтирован', R.decodeRobot('Статус: Показання не принйяті з причини: Прибор обліку 1 на 01.01.2026 є демонтованим').code === 'R_DISMOUNTED');
t('часы по календарю', R.decodeRobot('Показання не прийняті з причини: Період часу ... Різниця складає 72, а має бути не більше 24').code === 'R_HOURS_CALENDAR');

t('часы меньше («маєть бути більше»)', R.decodeRobot('Показання не принйяті з причини: Показання часу по приладу обліку 1 на 21.10.2020 23:00 = 635 але маєть бути більше 636.36').code === 'R_MONO_HOURS');

console.log('\nКод ошибки (экран «E-------», ввод с кириллической клавиатуры):');
const nc = [['E-------', 'E---'], ['E- - - - - - -', 'E---'], ['Е-------', 'E---'], ['е---', 'E---'], ['', 'E---'], ['0', 'E---'], ['немає', 'E---'], ['E—————', 'E---'], ['-------', 'E---'],
  ['E-3', 'E-3'], ['E 3', 'E-3'], ['е-9', 'E-9'], ['Е - 7', 'E-7'], ['С-1', 'C-1'], ['f4', 'F4'], ['E-b', 'E-B']];
const ncBad = nc.filter(([i, o]) => R.normCode(i) !== o);
t('нет ошибки → E---, код → «E-3» (кириллица, пробелы, тире)', !ncBad.length, ncBad.map(([i]) => i + '→' + R.normCode(i)));
t('«Е-------» кириллицей — не ошибка', !codes(R.validate({ reading: Object.assign({}, base, { errCode: 'Е-------' }), prev, meter, today: '2025-11-23' })).includes('M_ERROR_CODE'));
const e7 = R.validate({ reading: Object.assign({}, base, { errCode: 'е-7' }), prev, meter, today: '2025-11-23' }).items.filter(i => i.code === 'M_ERROR_CODE')[0];
t('E-7 — предупреждение с расшифровкой (повітря)', e7 && /E-7 — немає ультразвукового сигналу/.test(e7.msg.uk) && /Стравіть повітря/.test(e7.fix.uk), e7);
t('подсказка под полем: «E-------» — помилок немає, «E-9» — батарея', R.checkField('errCode', 'E-------').level === 'ok' && /батарея/.test(R.checkField('errCode', 'Е-9').msg.uk));
t('в форму ХТМ: «Е - 3» → E-3', R.formatForHtm('errCode', 'Е - 3') === 'E-3');

// 124-а: «не прийме» лише за порівнянням з попередніми — можна передати на свій ризик; порожні поля чи повірка — ні
console.log('\nПередати на свій ризик:');
{ const prev = J[J.length - 1], base = Object.assign({}, prev, { date: '2026-11-20', hours: prev.hours + 270 * 24 });
  let res = R.validate({ reading: Object.assign({}, base, { energy: 14.0, volume: 2800 }), prev, meter, today: '2026-11-20' });
  t('енергія менша за попередню → block і risky', res.verdict === 'block' && res.risky === true && blocks(res).includes('R_MONO_ENERGY'), JSON.stringify(blocks(res)));
  res = R.validate({ reading: Object.assign({}, base, { energy: 16, volume: 2800, errHours: null }), prev, meter, today: '2026-11-20' });
  t('порожній час простою → block без ризику (форма ХТМ не прийме)', res.verdict === 'block' && !res.risky && blocks(res).includes('F_MISSING'), JSON.stringify(blocks(res)));
  res = R.validate({ reading: Object.assign({}, base, { energy: 14.0, volume: 2800 }), prev, meter: Object.assign({}, meter, { verifiedUntil: '2026-01-01' }), today: '2026-11-20' });
  t('мінус енергії + минула повірка → без ризику', res.verdict === 'block' && !res.risky, JSON.stringify(blocks(res)));
  t('PREV_BASED — лише відомі коди', R.PREV_BASED.length === 13 && R.PREV_BASED.indexOf('F_MISSING') < 0); }

console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
