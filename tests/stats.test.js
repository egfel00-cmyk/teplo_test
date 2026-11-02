// Статистика по истории (web/src/stats.js). Только синтетика. Запуск: node tests/stats.test.js
const S = require('../web/src/stats.js');
let pass = 0, fail = 0; const ok = (n, c, i) => { console.log((c ? '  OK  ' : ' FAIL ') + n + (!c && i !== undefined ? '  → ' + JSON.stringify(i) : '')); c ? pass++ : fail++; };
const g0 = S.graph(0); ok('график 95/70 при 0 °C ≈ 58/46 (как в опубликованных таблицах)', Math.abs(g0.supply - 57.7) < 0.2 && Math.abs(g0.ret - 46.4) < 0.2, g0);
ok('при −22 °C — ровно 95/70', S.graph(-22).supply === 95 && S.graph(-22).ret === 70);
ok('при +18 °C и теплее — нормы нет', S.graph(18) === null && S.graph(25) === null);
const R = [
  { id: 'a', htm: { date: '2025-01-01', energy: 10, volume: 1000, hours: 1000, tSupply: 58, tReturn: 50, flow: 0.5 } },
  { id: 'b', htm: { date: '2025-01-31', energy: 12, volume: 1400, hours: 1000 + 30 * 24 * 0.5, tSupply: 45, tReturn: 42, flow: 0.4 } },
  { id: 'c', htm: { date: '2025-02-10', energy: 13, volume: 1500, hours: 1360 + 240, tSupply: 20, tReturn: 19, flow: 0 } },
  { id: 'x', deleted: true, htm: { date: '2025-01-15', energy: 99 } }];
const w = {}; for (let d = Date.parse('2025-01-01'); d <= Date.parse('2025-02-10'); d += 864e5) w[new Date(d).toISOString().slice(0, 10)] = 0;
const iv = S.intervals(R, null, w, 1539.5);
ok('удалённые не учитываются, промежутков 2', iv.length === 2, iv.length);
ok('за 30 дней: +2 Гкал, стоимость по тарифу', iv[0].dE === 2 && iv[0].month === 2 && iv[0].cost === 3079, iv[0]);
ok('средний перепад = энергия/объём: 2 Гкал / 400 м³ = 5 °C', iv[0].dT === 5, iv[0].dT);
ok('доля часов с теплом: половина', Math.abs(iv[0].share - 0.5) < 1e-9, iv[0].share);
ok('погода: 0 °C → 18 градусо-суток в день', iv[0].tOut === 0 && iv[0].hdd === 30 * 18, iv[0]);
const cl = S.coolant(R, null, w), st = Object.fromEntries(cl.map(p => [p.id, p.status]));
ok('58 °C при 0 °C — норма; 45 — сильно ниже; расход 0 — теплоносителя нет', st.a === 'ok' && st.b === 'bad' && st.c === 'none', st);
ok('без погоды — без нормы', S.coolant(R, null, null).every(p => p.status === 'off' || p.status === 'none'));
// лічильник знімали з 05.01 по 20.01 (новий, з 0.5): до зняття — свій промежуток, через період — не рахуємо, після — від 0.5
{
  const RG = [{ id: 'a', htm: { date: '2025-01-01', energy: 10 } }, { id: 'b', htm: { date: '2025-01-31', energy: 1.5 } }];
  const iv2 = S.intervals(RG, null, null, 0, [{ id: 'g', from: '2025-01-05', to: '2025-01-20', vFrom: 10.4, vTo: 0.5 }]);
  ok('период без лічильника: 01.01→05.01 +0.4, 20.01→31.01 +1.0, через период — ничего', iv2.length === 2 && iv2[0].dE === 0.4 && iv2[0].to === '2025-01-05' && iv2[1].dE === 1 && iv2[1].from === '2025-01-20', iv2);
  const iv3 = S.intervals(RG, null, null, 0, [{ id: 'g', from: '2025-01-05', to: '' }]);
  ok('ещё без лічильника — ни одного промежутка через него', iv3.length === 0, iv3);
  ok('coolant не падает на точках периода', S.coolant(RG, null, null).length === 0);
}
// период без лічильника: оценка по правилам (Методика №315: повірка — среднесуточное прошлого отопительного периода × сутки)
{
  const RS = [{ id: 'a', htm: { date: '2024-10-15', energy: 0 } }, { id: 'b', htm: { date: '2025-04-15', energy: 6 } },
    { id: 'c', htm: { date: '2025-10-15', energy: 6 } }, { id: 'd', htm: { date: '2025-11-10', energy: 6.8 } }];
  const gp = { id: 'g', from: '2025-11-10', to: '2025-12-10', reason: 'verify' };
  const ivs = S.intervals(RS, null, null, 1539.5, [gp]);
  const e = S.gapHeat(gp, ivs, { today: '2026-01-20', tariff: 1539.5 });
  ok('среднее — за сезон 2024/25: 6 Гкал / 182 опалювальні доби', e.basis === 'prev' && e.season === 2024 && Math.abs(e.avg - 6 / 182) < 1e-4, e);
  ok('30 суток без лічильника, все опалювальні (торік тепло йшло)', e.days === 30 && e.heatDays === 30, e);
  ok('≈ 0,989 Гкал × 1539,50 ≈ 1522 грн', Math.abs(e.gcal - 0.989) < 0.002 && Math.abs(e.cost - e.gcal * 1539.5) < 0.01, e);
  ok('по месяцам: листопад 20 діб, грудень 10', e.rows.length === 2 && e.rows[0].ym === '2025-11' && e.rows[0].days === 20 && e.rows[1].days === 10, e.rows);
  ok('в среднем на месяц опалення ≈ 1 Гкал', Math.abs(e.perMonth - 6 / 182 * 30.44) < 0.002, e.perMonth);
  const su = S.gapHeat({ from: '2025-06-01', to: '2025-07-01' }, ivs, { today: '2026-01-20', tariff: 1539.5 });
  ok('літом опалення немає — 0 Гкал, 0 грн', su.heatDays === 0 && su.gcal === 0 && su.cost === 0, su);
  const op = S.gapHeat({ from: '2026-01-10', to: '' }, ivs, { today: '2026-01-20', tariff: 1539.5 });
  ok('ще без лічильника — до сьогодні (10 діб), середнє минулого сезону', op.open && op.days === 10 && op.basis === 'prev' && op.heatDays === 10, op);
  const no = S.gapHeat(gp, [], { today: '2026-01-20', tariff: 1539.5 });
  ok('немає показань з опаленням — basis none, 0 Гкал', no.basis === 'none' && no.gcal === 0, no);
  const rc = S.gapHeat({ from: '2025-11-20', to: '2025-12-01' }, S.intervals([{ id: 'x', htm: { date: '2025-10-20', energy: 1 } }, { id: 'y', htm: { date: '2025-11-20', energy: 2 } }], null, null, 0, []), { today: '2026-01-20', tariff: 1000 });
  ok('минулого сезону немає — середнє з показань за рік до зняття', rc.basis === 'recent' && Math.abs(rc.avg - 1 / 31) < 1e-4, rc);
}
console.log(`\nИтог: ${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
