// Несколько квартир: слияние списка квартир между устройствами (sync.js). Запуск: node tests/places.test.js
const S = require('../web/src/sync.js');
let pass = 0, fail = 0; const ok = (n, c, i) => { console.log((c ? '  OK  ' : ' FAIL ') + n + (!c && i !== undefined ? '  → ' + JSON.stringify(i) : '')); c ? pass++ : fail++; };
const a = { updatedAt: 100, places: [{ id: 'main', name: 'Сумська 10', meter: { modelId: 'sharky774' }, updatedAt: 100 }] };
const b = { updatedAt: 200, places: [{ id: 'main', name: 'Сумська 10, кв. 61', meter: { modelId: 'sharky774' }, updatedAt: 200 }, { id: 'p2', name: 'Пушкінська 5', updatedAt: 150 }] };
let m = S.merge(a, b);
ok('квартиры с разных устройств объединяются', m.places.length === 2 && m.places[0].name === 'Сумська 10, кв. 61' && m.places[1].id === 'p2', m.places);
m = S.merge({ updatedAt: 300, places: [{ id: 'p2', deleted: true, updatedAt: 300 }] }, b);
ok('удалённая квартира остаётся удалённой', m.places.find(p => p.id === 'p2').deleted === true);
ok('квартиры синхронизируются', !!S.payload({ places: [{ id: 'x' }] }).places);
console.log(`\nИтог: ${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
