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
// отопительные сезоны из истории: середина промежутка → сезон; майские показания закрывают зиму, сентябрь—октябрь открывают новую
{
  const H = [['2024-10-01', 0], ['2024-11-01', 0.9], ['2025-01-01', 2.9], ['2025-04-20', 6.0], ['2025-05-15', 6.05], ['2025-09-20', 6.05],
    ['2025-10-25', 6.4], ['2025-12-01', 7.6]].map(([d, e], i) => ({ id: 'h' + i, htm: { date: d, energy: e } }));
  const ivs = S.intervals(H, null, null, 1000, []);
  const ss = S.seasons(ivs, iv => Math.max(0, iv.dE) * 1000 + 100, '2025-12-10');
  ok('два сезона, новый сверху: 2025/26 и 2024/25', ss.length === 2 && ss[0].label === '2025/26' && ss[1].label === '2024/25', ss.map(s => s.label));
  const a = ss[1], b = ss[0];
  ok('2024/25: тепло до 15 мая (май закрывает зиму) — 6,05 Гкал', Math.abs(a.gcal - 6.05) < 1e-9 && a.ids.includes('h4'), a);
  ok('лето (15.05→20.09, середина в июле) — в новом сезоне, но без тепла; сезон 2025/26 — 1,55 Гкал', Math.abs(b.gcal - 1.55) < 1e-9 && b.ids.includes('h5'), b);
  ok('где шло тепло: 2025/26 — с 20.09 по 01.12, летний промежуток не в счёт', b.from === '2025-09-20' && b.to === '2025-12-01' && b.heatDays === 35 + 37, b);
  ok('деньги — из costFn по каждому промежутку (с абонплатой и летом)', Math.abs(b.cost - (1.55 * 1000 + 3 * 100)) < 0.01, b.cost);
  ok('в среднем на месяц опалення и «поточний»', b.current && !a.current && Math.abs(b.perMonth - 1.55 / 72 * 30.44) < 0.002, b);
  ok('сезон по дате: 15.05 → 2024, 20.09 → 2025; без начала — по дате показаний', S.seasonKey('2025-04-20', '2025-05-15') === 2024 && S.seasonKey('2025-09-01', '2025-09-20') === 2025 && S.seasonKey(null, '2026-02-01') === 2025);
  ok('нет промежутков — нет сезонов', S.seasons([], null, '2025-12-10').length === 0);
}
{ // 130-а: проміжок через літо — кінець старого сезону й початок нового
  const a = S.splitSummer({ from: '2026-03-23', to: '2026-11-05', dE: 0.305, fromE: 17.609 }, { newFrom: '2026-12-01' });
  ok('літо: нового тепла до показань не було (ХТМ — лише абонплата) — усе в старий сезон', a && a.old === 0.305 && a.nu === 0 && a.sa === 2025 && a.sb === 2026, a);
  const b = S.splitSummer({ from: '2025-03-20', to: '2025-11-20', dE: 0.9, fromE: 12.3 }, { journal: [{ date: '2025-04-08', energy: 12.7 }, { date: '2025-11-02', energy: 12.75 }] });
  ok('є прийняті ХТМ показання кінця сезону — ділимо точно по них', b && b.by === 'journal' && Math.abs(b.old - 0.4) < 1e-9 && Math.abs(b.nu - 0.5) < 1e-9, b);
  const c = S.splitSummer({ from: '2025-03-20', to: '2025-11-20', dE: 0.9, fromE: 12.3 }, {});
  ok('без журналу — за градусо-добами (кінець березня–квітень проти 15.10–20.11)', c && c.by === 'days' && c.old > 0.2 && c.old < 0.6 && Math.abs(c.old + c.nu - 0.9) < 1e-9, c);
  ok('один сезон чи травень → вересень без тепла — не ділимо', S.splitSummer({ from: '2026-01-10', to: '2026-02-10', dE: 2, fromE: 1 }) === null && S.splitSummer({ from: '2025-05-12', to: '2025-09-15', dE: 0.01, fromE: 1 }) === null);
}
console.log(`\nИтог: ${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);// 138-а: лічильник по місяцях — проміжок ділимо градусо-добами (зимою більше), сума зберігається; літо без опалення — рівно
{ const m = S.monthly([{ from: '2025-12-20', to: '2026-01-20', dE: 1.0, days: 31 }, { from: '2026-04-01', to: '2026-06-30', dE: 0.2, days: 90 }]);
  const sum = Object.values(m).reduce((a, b) => a + b, 0);
  ok('monthly: 20.12–20.01 → грудень ≈ 0,334, січень ≈ 0,666; квітень > травень; сума 1,2', Math.abs(m['2025-12'] - 0.334) < 0.01 && Math.abs(m['2026-01'] - 0.666) < 0.01 && m['2026-04'] > m['2026-05'] && Math.abs(sum - 1.2) < 0.002, m); }

