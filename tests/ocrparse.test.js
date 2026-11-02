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

console.log('\nСерый ЖК без подсветки (как Landis+Gyr T230), единица не прочиталась:');
const T230 = { w: 1512, h: 2016, lines: [{ text: 'T230', score: 0.99, x: 860, y: 582, w: 160, h: 59 }, { text: 'ULTRAHEAT', score: 0.98, x: 863, y: 638, w: 150, h: 34 },
  { text: '90°C', alts: ['90°C', '90°C'], score: 0.86, x: 564, y: 947, w: 80, h: 29 }, { text: 'LL-IL', score: 0.62, x: 829, y: 1010, w: 45, h: 25 },
  { text: '0046077', alts: ['*0046077', '0046077'], score: 0.98, x: 553, y: 992, w: 269, h: 99 }, { text: '68841529', alts: ['68 841 529', '68 841 529'], score: 0.99, x: 769, y: 1121, w: 207, h: 36 }] };
x = P.photo(T230, { models: M.MODELS }, 0);
ok('модель T230, главное число — энергия 46077 kWh, «90°C» с корпуса не прилипает', x.meter.modelId === 't230' && x.photo.readings.length === 1 && x.photo.readings[0].field === 'energy' && x.photo.readings[0].value === '46077' && x.photo.readings[0].unit === 'kWh', x.photo.readings);
ok('единица взята по модели — уверенность снижена, человек проверит', x.photo.readings[0].confidence < 0.75 && x.photo.note === 'unit_guess');
const V = require('../web/src/recognize.js');
ok('для «Останні прийняті» пересчёт в Гкал: 46077 kWh ≈ 39,6191', V.pick({ photos: [x.photo] }, M.TO_GCAL, 'Gcal').energy.value === '39.6191');

console.log('\nЭкраны Sharky 774 с фото (подписи семисегментным шрифтом):');
const L = (text, alts, x, y, w, h, score) => ({ text, alts, score: score || 0.95, x, y, w, h });
const sh = (lines) => P.photo({ w: 1512, h: 2016, lines: [L('IARKY', null, 560, 560, 260, 55), L('CE', null, 900, 560, 80, 67), L('M23', null, 1020, 560, 100, 53)].concat(lines) }, Object.assign({ models: M.MODELS, modelId: 'sharky774' }, sharky), 0);
const one = (r) => r.photo.readings.map(x => x.field + '=' + x.value).join(',');
ok('«0n 41704» → часы 41704', one(sh([L('06 41704', ['0n 4 1704', '0n 4 1704'], 392, 792, 329, 82)])) === 'hours=41704');
ok('«be» + «13:50» → подача 13.50', one(sh([L('be', null, 365, 795, 95, 75), L('13:50', ['1350', '1350'], 549, 788, 147, 82), L('c', null, 645, 886, 21, 24)])) === 'tSupply=13.50');
ok('«0000» + «kw» → мощность 0.000', one(sh([L('0000', ['0000', '0000'], 544, 739, 180, 92), L('kw', null, 730, 793, 50, 34)])) === 'power=0.000');
ok('«0000» + «m» → расход 0.000 (короткое число)', one(sh([L('0000', ['0000', '0000'], 635, 749, 180, 88), L('m', null, 868, 754, 33, 40)])) === 'flow=0.000');
ok('«de» + «002» — экран перепада, в форму не идёт', sh([L('de', null, 419, 779, 72, 83), L('002', ['002', '002'], 613, 772, 138, 85)]).photo.readings.length === 0);
ok('тест экрана «88888888» — пропущен', sh([L('88888888', ['88888888', '88888888'], 470, 760, 320, 80)]).photo.note === 'test_screen');
ok('тест экрана, прочитанный кусками «881» + «88», и «ct» под экраном — пропущен', (r => r.photo.note === 'test_screen' && !r.photo.readings.length)(sh([L('881', ['881', ''], 466, 771, 88, 64), L('88', ['86', '86'], 696, 774, 81, 60), L('ct', null, 538, 1021, 234, 112)])));
ok('«002» без подписи — экран dt, не «непонятное число»', sh([L('002', ['002', '002'], 608, 766, 135, 84)]).photo.note === 'dt_screen');
ok('тест экрана «881» + «86» (как читает iPhone) — пропущен', sh([L('881', ['881', '35'], 462, 765, 87, 82), L('86', ['186', '186'], 696, 774, 81, 64)]).photo.note === 'test_screen');
// подписи, найденные проходом по ЖК (engine v=12): «m³» читается «ni», «m'», «m)»; у Sharky «m³/h» — «mi» над «h»
ok('«32 17437» + «ni» (m³) → объём 3217.437, не энергия', one(sh([L('32 17437', ['32 17437', '32 17437'], 465, 713, 296, 90), L('ni', ["m'", 'ni'], 828, 724, 34, 34)])) === 'volume=3217.437');
ok('«0000» + «mi» (m³/h без «h») → расход 0.000', one(sh([L('0000', ['0000', '0000'], 629, 744, 174, 86), L('mi', null, 864, 748, 30, 34)])) === 'flow=0.000');
ok('«1067» + «m3» + «h» под ним → расход, не объём', one(sh([L('1067', ['1067', '1067'], 600, 744, 174, 86), L('m3', null, 830, 740, 34, 34), L('h', null, 832, 790, 30, 34)])) === 'flow=1.067');
ok('осколок «7» с кнопки под экраном не становится показанием', one(sh([L('0000', ['0000', '0000'], 629, 744, 174, 86), L('mi', null, 864, 748, 30, 34), L('7', ['7', ''], 586, 1035, 109, 65)])) === 'flow=0.000');
ok('«E---....» (рамка «E» и прочерков, склеенная движком) → E---', one(sh([L('e', null, 436, 762, 52, 67), L('E---....', ['E-------', 'E------'], 410, 755, 330, 70)])) === 'errCode=E---');
ok('знак «CE» на корпусе не становится обраткой', !/tReturn/.test(one(sh([L('0000', ['0000', '0000'], 544, 739, 180, 92), L('kw', null, 730, 793, 50, 34)]))));

console.log('\nЭкран кода ошибки «E-------» (Sharky: E и 7 прочерков — ошибок нет) и коды «E-3», «C-1»:');
const errWant = { err_e8_plain: 'E---', err_e8_rx: 'E---', err_e8_glare_e: 'E---', err_e8_far: 'E---', err_e8_hard: 'E---', err_e3_short: 'E-3', err_e9_blur: 'E-9', err_c1: 'C-1' };
const errName = { err_e8_plain: 'движок прочитал «ERR», варианты «E--»', err_e8_rx: '«88888888» и «Ｅ-—————-» — не тест экрана', err_e8_glare_e: 'блик: «ER» и осколок «一1» отдельно — «11» не показание',
  err_e8_far: 'издалека «8888» / «E---»', err_e8_hard: 'блик, размытие, наклон', err_e3_short: '«883» / «E-3» → E-3 (не «E3»)', err_e9_blur: 'E-9 — батарея', err_c1: '«c-1» → C-1' };
for (const k in errWant) { const { r, v } = read(k); ok(errName[k] + ' → ' + errWant[k], JSON.stringify(v) === JSON.stringify({ errCode: errWant[k] }) && r.photo.note !== 'test_screen', r.photo); }
x = P.photo(F.err_e8_nomodel, {}, 0); ok('без модели и без наклейки — тоже «нет ошибки»', x.photo.readings.length === 1 && x.photo.readings[0].value === 'E---', x.photo.readings);
ok('«E» отдельно, прочерки отдельно (кусками)', one(sh([L('E', ['E', 'E'], 400, 770, 40, 80), L('-------', null, 460, 790, 330, 40)])) === 'errCode=E---');
ok('прочерки без «E» («8» на месте E) — нет ошибки, но неуверенно', (r => r.photo.readings[0].value === 'E---' && r.photo.readings[0].confidence < 0.6)(sh([L('88888888', ['8-------', '-------'], 470, 760, 320, 80)])));
ok('тест экрана (все варианты — восьмёрки) по-прежнему тест', sh([L('88888888', ['88888888', '8888888'], 470, 760, 320, 80)]).photo.note === 'test_screen');
ok('«EH» + «153» — часы с ошибкой, а не код', one(sh([L('153', ['153', '153'], 600, 770, 150, 80), L('EH', ['EH', 'EH'], 400, 870, 60, 30)])) === 'errHours=153');
ok('«E 153» — не код ошибки', !/errCode/.test(one(sh([L('E 153', ['E 153', 'E 153'], 470, 760, 300, 80)]))));

console.log('\nПачка фото по порядку экранов (подписи не прочитались):');
{
  const ph = (i, t, readings, extra) => Object.assign({ index: i, time: t, readings: readings || [] }, extra || {});
  const c = { models: M.MODELS, modelId: 'sharky774', steps: sharky.steps };
  const b = P.batch([
    ph(0, 100, [], { note: 'test_screen', anchor: -1 }),
    ph(1, 200, [{ field: 'energy', value: '17.913', how: 'tag' }]),
    ph(2, 300, [{ field: 'energy', value: '3217.437', how: 'model' }], { cand: { digits: '3217437', dot: 3, score: 0.9 } }),
    ph(3, 400, [], { cand: { digits: '0000', dot: null, score: 0.9 } }),
    ph(4, 500, [{ field: 'power', value: '0.000', how: 'tag' }]),
    ph(5, 600, [{ field: 'tSupply', value: '13.50', how: 'tag' }]),
    ph(6, 700, [], { cand: { digits: '002', dot: null, score: 0.9 } }),
    ph(7, 800, [{ field: 'hours', value: '41704', how: 'tag' }])
  ], c);
  const got = b.map(p => p.readings.map(r => r.field + '=' + r.value).join(',')).join(' | ');
  ok('объём и расход — по месту между энергией и мощностью; «0.02» не стал обраткой', got === ' | energy=17.913 | volume=3217.437 | flow=0.000 | power=0.000 | tSupply=13.50 |  | hours=41704', got);
  const b2 = P.batch([ph(0, 900, [], { cand: { digits: '0000', dot: null, score: 0.9 } }), ph(1, 100, [{ field: 'flow', value: '1.2', how: 'tag' }])], c);
  ok('порядок — по времени съёмки, а не по порядку выбора файлов', b2[0].readings[0] && b2[0].readings[0].field === 'power');
}

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
