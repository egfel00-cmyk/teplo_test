// Тесты слияния состояний между устройствами. Запуск: node web/tests/sync.test.js
'use strict';
const S = require('../web/src/sync.js');
let pass = 0, fail = 0; const t = (n, c) => { c ? pass++ : fail++; console.log((c ? '  OK  ' : ' FAIL ') + n); };
const r = (id, at, extra) => Object.assign({ id, createdAt: new Date(at).toISOString(), htm: { date: '2026-11-10' }, status: 'checked' }, extra || {});
const phone = { onboarded: true, meter: { modelId: 'sharky774' }, baseline: { date: '2026-10-20', energy: 13.245 }, readings: [r('a', 1000), r('b', 2000)], updatedAt: 2000 };
const laptop = { onboarded: true, meter: { modelId: 'sharky774' }, baseline: { date: '2026-10-20', energy: 13.245 }, readings: [r('a', 1000), r('c', 3000)], updatedAt: 3000 };
let m = S.merge(phone, laptop);
t('показания с двух устройств объединяются (a, b, c)', m.readings.map(x => x.id).join() === 'a,b,c');
t('updatedAt — максимум', m.updatedAt === 3000);
const accepted = Object.assign({}, r('b', 2000), { status: 'accepted', updatedAt: 5000 });
m = S.merge({ readings: [r('b', 2000)], updatedAt: 2000 }, { readings: [accepted], updatedAt: 5000 });
t('изменённое показание (принято) побеждает старое', m.readings[0].status === 'accepted');
m = S.merge({ baseline: { date: '2026-11-10', energy: 14.1 }, updatedAt: 1 }, { baseline: { date: '2026-10-20', energy: 13.2 }, updatedAt: 9 });
t('база — с более поздней датой, даже если состояние старее', m.baseline.date === '2026-11-10');
m = S.merge({ onboarded: true, meter: { modelId: 'x' }, baseline: { date: '2026-10-20' }, readings: [r('a', 1000)], updatedAt: 1000 }, { onboarded: false, meter: null, baseline: null, readings: [], wipedAt: 4000, updatedAt: 4000 });
t('«удалить всё» на другом устройстве побеждает', m.readings.length === 0 && !m.baseline && !m.onboarded && !m.meter);
m = S.merge({ readings: [r('n', 6000)], updatedAt: 6000, onboarded: true, meter: { modelId: 'x' } }, { readings: [], wipedAt: 4000, updatedAt: 4000 });
t('записи, созданные после удаления, сохраняются', m.readings.length === 1);
const del = Object.assign({}, r('b', 2000), { deleted: true, updatedAt: 7000 }), fixed = Object.assign({}, r('b', 2000), { htm: { date: '2026-11-03' }, updatedAt: 6000 });
m = S.merge({ readings: [fixed], updatedAt: 6000 }, { readings: [del], updatedAt: 7000 });
t('удаление показаний из истории доходит до другого устройства', m.readings.length === 1 && m.readings[0].deleted === true);
m = S.merge({ readings: [del], updatedAt: 7000 }, { readings: [Object.assign({}, fixed, { updatedAt: 8000 })], updatedAt: 8000 });
t('исправленная позже запись побеждает старую версию', m.readings[0].htm.date === '2026-11-03' && !m.readings[0].deleted);
t('тариф синхронизируется', S.payload({ tariff: 1600, readings: [] }).tariff === 1600);
t('payload не тащит локальные поля', !('demoToday' in S.payload({ demoToday: 'x', lang: 'ru', readings: [] })) && !('lang' in S.payload({ lang: 'ru' })));
t('подпись не зависит от updatedAt', S.sig({ a: 1, updatedAt: 1 }) === S.sig({ a: 1, updatedAt: 2 }));
{ const a = { updatedAt: 1, water: [{ id: 'w1', createdAt: '2026-11-01T10:00:00Z', updatedAt: 5, vals: { h1: '10' } }] }, b = { updatedAt: 2, water: [{ id: 'w1', createdAt: '2026-11-01T10:00:00Z', updatedAt: 9, vals: { h1: '11' } }, { id: 'w2', createdAt: '2026-11-02T10:00:00Z', vals: { h1: '12' } }] };
  const mm = S.merge(a, b); t('вода: сливается по id, побеждает свежая правка', mm.water.length === 2 && mm.water[0].vals.h1 === '11'); }

// восстановление версии из истории (/admin, StateHist::freshen на сервере): всем квартирам и записям — свежая метка, лишним — «надгробия»
{ const T = 1767000000000, R = T + 50000;
  const good = { updatedAt: T, places: [{ id: 'main', name: 'Победа', meter: { modelId: 'sharky774' }, water: { meters: [{ id: 'c1', kind: 'cold' }] }, updatedAt: T }], readings: [r('a', T - 9000)] };
  const bad = { updatedAt: T + 9000, places: [{ id: 'main', name: '', meter: null, water: { meters: [] }, updatedAt: T + 9000 }], readings: [r('a', T - 9000), r('junk', T + 8000, { updatedAt: T + 8000 })] };
  const restored = { updatedAt: R, restoredAt: R, places: [Object.assign({}, good.places[0], { updatedAt: R })], readings: [Object.assign({}, good.readings[0], { updatedAt: R }), Object.assign({}, bad.readings[1], { deleted: true, updatedAt: R })] };
  let mr = S.merge(bad, restored);
  t('восстановленная версия побеждает «плохую» копию в браузере: квартира целиком', mr.places[0].name === 'Победа' && mr.places[0].meter.modelId === 'sharky774' && mr.places[0].water.meters.length === 1);
  t('…и запись, появившаяся после неё, убирается (надгробие)', mr.readings.filter(x => !x.deleted).map(x => x.id).join() === 'a');
  t('…в обе стороны слияния', JSON.stringify(S.merge(restored, bad).places) === JSON.stringify(mr.places));
  const wipedLocal = { updatedAt: T + 9000, wipedAt: T + 9000, onboarded: false, places: [{ id: 'main', name: '', meter: null, updatedAt: 0 }], readings: [] };
  mr = S.merge(wipedLocal, restored);
  t('«стереть всё» до восстановления — отменено: записи и квартира вернулись', mr.readings.filter(x => !x.deleted).length === 1 && mr.places[0].name === 'Победа' && !mr.wipedAt && mr.restoredAt === R);
  mr = S.merge(Object.assign({}, wipedLocal, { wipedAt: R + 1000, updatedAt: R + 1000 }), restored);
  t('«стереть всё» после восстановления — работает как раньше', mr.readings.length === 0 && mr.wipedAt === R + 1000);
  t('restoredAt синхронизируется', S.payload({ restoredAt: R, readings: [] }).restoredAt === R); }
// 148-а (власник: «в „Победе“ ввожу Жилстрой — не сохраняется»): стара копія квартири з іншого пристрою, яку фоном торкнулись (новіший updatedAt),
// не затирає нового постачальника — prov[вид] зливається за власною ts
{ const mine = { places: [{ id: 'pob', address: 'Харків', gpv: '', updatedAt: 100, prov: { elec: { own: 1, name: 'Жилстрой', how: 'cash', ts: 100 } } }], updatedAt: 100 };
  const stale = { places: [{ id: 'pob', address: 'Харків', gpv: '3.1', updatedAt: 200, prov: { water: { ok: 1, ts: 50 } } }], updatedAt: 200 };
  let mp = S.merge(mine, stale).places[0];
  t('квартира — новіша копія (черга 3.1), але світло — «Жилстрой» з моєї зміни', mp.gpv === '3.1' && mp.prov.elec && mp.prov.elec.own === 1 && mp.prov.elec.name === 'Жилстрой' && mp.prov.water.ok === 1);
  mp = S.merge(stale, mine).places[0];
  t('порядок аргументів не важливий', mp.gpv === '3.1' && mp.prov.elec.name === 'Жилстрой');
  const back = { places: [{ id: 'pob', updatedAt: 300, prov: { elec: { own: 0, ts: 300 } } }], updatedAt: 300 };
  t('новіша зміна постачальника (повернули довідник) — теж виграє', S.merge(mine, back).places[0].prov.elec.own === 0);
  const old = { places: [{ id: 'pob', updatedAt: 400, prov: { elec: { ok: 1 } } }], updatedAt: 400 };
  t('стара копія без ts не затирає постачальника з ts', S.merge(mine, old).places[0].prov.elec.name === 'Жилстрой'); }
console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); process.exit(fail ? 1 : 0);
