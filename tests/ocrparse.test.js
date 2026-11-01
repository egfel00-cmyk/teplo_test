// Разбор распознанного текста в поля (web/src/ocrparse.js). Только синтетика: строки, которые движок
// прочитал с нарисованных экранов (tools — ~/ocrlab), и выдуманные строки других счётчиков. Запуск: node tests/ocrparse.test.js
const P = require('../web/src/ocrparse.js'), M = require('../web/src/models.js'), F = require('./fixtures/ocr_synth.json');
let pass = 0, fail = 0;
const ok = (n, c, info) => { console.log((c ? '  OK  ' : ' FAIL ') + n + (!c && info !== undefined ? '  → ' + JSON.stringify(info) : '')); c ? pass++ : fail++; };
const sharky = { steps: M.byId('sharky774').steps };
const read = (k, ctx) => { const r = P.photo(F[k], ctx || sharky, 0); return { r, v: Object.fromEntries(r.photo.readings.map(x => [x.field, x.value])) }; };

console.log('Экраны Sharky 774 (ЖК, «тени» сегментов):');
const want = { s774_energy: { energy: '15.482' }, s774_volume: { volume: '2724.494' }, s774_flow: { flow: '1.067' }, s774_power: { power: '6.790' },
  s774_ht: { tSupply: '56.57' }, s774_ct: { tReturn: '51.11' }, s774_on: { hours: '35611' }, s774_eh: { errHours: '153' }, s774_err: { errCode: 'E---' } };
for (const k in want) { const { v } = read(k); ok(k + ' → ' + JSON.stringify(want[k]), JSON.stringify(v) === JSON.stringify(want[k]), v); }

console.log('\nДругие модели и единицы:');
let x = read('t330_mwh', {}); ok('ULTRAHEAT T330: 12.345 MWh, модель t330', x.v.energy === '12.345' && x.r.meter.modelId === 't330' && x.r.meter.energyUnit === 'MWh', x);
x = read('mc_gj', {}); ok('MULTICAL 302: 64.582 GJ', x.v.energy === '64.582' && x.r.meter.modelId === 'multical302' && x.r.meter.energyUnit === 'GJ', x.v);
x = read('plate'); ok('наклейка: модель, серийный номер, энергия', x.r.meter.modelId === 'sharky774' && x.r.meter.serial === '64123987' && x.v.energy === '15.482', x.r.meter);
x = read('nounit_energy', Object.assign({ prev: { energy: '15.482', volume: '2724.494' } }, sharky));
ok('без подписи — по прошлым принятым это энергия, уверенность снижена', x.v.energy === '16.120' && x.r.photo.readings[0].confidence < 0.75, x.r.photo.readings);
x = read('nounit_energy', {}); ok('без подписи и без прошлых — не выдумывать с высокой уверенностью', !x.r.photo.readings.length || x.r.photo.readings[0].confidence < 0.6, x.r.photo.readings);

console.log('\nНе теплосчётчик:');
for (const [k, t] of [['syn_water', 'water'], ['syn_electric', 'electric'], ['syn_gas', 'gas']]) {
  x = read(k, {}); ok(k + ' → ' + t + ', показания не берём', x.r.photo.meterType === t && !x.r.photo.readings.length, x.r.photo);
}
x = read('plate'); ok('наклейка теплосчётчика с «m3/h» и DN15 — это тепло', x.r.photo.meterType === 'heat', x.r.photo.meterType);

console.log('\nМелочи:');
ok('«0O1S.4B2» → 0015.482', P.cleanNum('0O1S.4B2') === '0015.482', P.cleanNum('0O1S.4B2'));
ok('точка по формату экрана модели', P.inferDot('00015482', 'energy', sharky).v === '00015.482');
ok('точка по прошлым принятым', P.inferDot('16120', 'energy', { prev: { energy: '15.482' } }).v === '16.120');
ok('пустое фото → «знято здалеку/розмите», без показаний', P.photo({ lines: [], w: 100, h: 100 }, {}, 0).photo.readings.length === 0);

console.log(`\nИтог: ${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
