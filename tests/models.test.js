// Каталог моделей теплолічильників (web/src/models.js): кожна модель веде людину по всіх 10 значеннях форми ХТМ,
// довге натискання (петлі LOOP, групи, рівні) описане там, де без нього екран не знайти (124-а, скарги 12.11.2026).
// Запуск: node tests/models.test.js
'use strict';
const M = require('../web/src/models.js');
let pass = 0, fail = 0;
const ok = (n, c, info) => { console.log((c ? '  OK  ' : ' FAIL ') + n + (!c && info !== undefined ? '  → ' + JSON.stringify(info) : '')); c ? pass++ : fail++; };
const NEED = ['energy', 'volume', 'flow', 'power', 'tSupply', 'tReturn', 'hours', 'errHours', 'errCode'];
const both = (o) => !!(o && o.uk && o.ru);

for (const m of M.MODELS) {
  const f = [].concat(...m.steps.filter(s => !s.only3).map(s => s.fields));   // крок Pd (only3) — лише для кабінету з трьома колонками часу
  ok(m.id + ': усі 9 полів (і дата окремо) — кожне рівно раз', NEED.every(k => f.filter(x => x === k).length === 1) && f.length === NEED.length, f);
  ok(m.id + ': дія на кожному кроці зрозуміла (коротко ×N / шукати / затиснути N с / свій підпис)',
    m.steps.every(s => s.say ? both(s.say) : s.press === null || s.press === 'short' || (s.press === 'long' && s.hold > 0)), m.steps.map(s => s.press));
  ok(m.id + ': підказки й примітка — українською й російською', m.steps.every(s => both(s.hint)) && both(m.note));
  const eh = m.steps.find(s => s.fields.includes('errHours'));
  ok(m.id + ': на кроці годин з помилкою сказано про час простою', /простою/.test(eh.hint.uk) && /простоя/.test(eh.hint.ru), eh.hint.uk);
  if (m.loops) ok(m.id + ': підказка про петлі — обома мовами', both(m.loops.tip) && (!m.loops.short || both(m.loops.short)));
}
ok('загальна підказка «затисніть на 3–5 с» є', both(M.LOOP_ANY) && /3–5/.test(M.LOOP_ANY.uk));
for (const id of ['t330', 't230']) {
  const fl = M.byId(id).steps.find(s => s.fields.includes('flow'));
  ok(id + ': витрата — у LOOP 1, через довге натискання понад 3 с', fl.press === 'long' && fl.hold === 3 && /LOOP 1/.test(fl.hint.uk), fl);
}
for (const id of ['t330', 't230']) {   // 125-а, юзертестинг T330: години — три окремі екрани Bd/Fd/Pd, температури чергуються на одному
  const st = M.byId(id).steps, h = st.find(s => s.fields.includes('hours')), e = st.find(s => s.fields.includes('errHours')), p = st.find(s => s.fields.includes('flowHours'));
  ok(id + ': години Bd, простій Fd, з витратою Pd — окремі кроки; Pd — лише для кабінету з трьома колонками',
    h.fields.length === 1 && e.fields.length === 1 && !!p && p.only3 && /Bd/.test(h.hint.uk) && /Fd/.test(e.hint.uk) && /Pd/.test(p.hint.uk), [h, e, p]);
  // порядок — як екрани LOOP 1 (руководство L+G): витрата → (різниця температур) → потужність → години роботи → температури → простій → з витратою
  ok(id + ': кроки LOOP 1 — у порядку екранів лічильника', st.map(s => s.fields[0]).join(',') === 'energy,volume,flow,power,hours,tSupply,errHours,flowHours,errCode', st.map(s => s.fields[0]));
  ok(id + ': температури — один екран, значення чергуються (swap)', st.find(s => s.fields.includes('tSupply')).lcd.swap === true);
}
ok('SensoStar (S3): рівень 2 — понад 4 с, перший екран — потужність; годин на екрані немає — дні × 24', (st => st.find(s => s.fields.includes('power')).press === 'long' && st.find(s => s.fields.includes('power')).hold === 4 &&
  /× 24/.test(st.find(s => s.fields.includes('hours')).hint.uk) && /H80/.test(st.find(s => s.fields.includes('errCode')).hint.uk))(M.byId('sensostar').steps));
ok('CF Echo II (135-а, інструкція Itron): рівень 1 — енергія, обсяг; рівень 2 — затиснути на 2 с: витрата, потужність, температури, години, години збою, коди A0/A1; екран гасне за 4 хв',
  (function () { var m = M.byId('cfecho2'), st = m.steps, f = st.map(s => s.fields.join('+')).join(' '), l2 = st.find(s => s.loop);
    return f === 'energy volume flow power tSupply+tReturn hours errHours errCode' && l2.fields[0] === 'flow' && l2.press === 'long' && l2.hold === 2 && /2 с/.test(l2.say.uk) &&
      /A0/.test(st[7].hint.uk) && /A1/.test(st[7].hint.ru) && m.status === 'manual' && m.sleepMin === 4 && /2 секунди/.test(m.loops.tip.uk); })());
ok('MULTICAL 403/603 (127-а): години з помилкою — друга кнопка на екрані годин, порядок USER: енергія → обсяг → години → T → витрата → потужність → INFO',
  (function () { var st = M.byId('multical403').steps, f = st.map(s => s.fields.join('+')).join(' '); var eh = st.find(s => s.fields.includes('errHours'));
    return f === 'energy volume hours errHours tSupply+tReturn flow power errCode' && /Друга кнопка/.test(eh.say.uk) && !eh.loop && M.byId('multical403').units[0] === 'GJ'; })());
ok('MULTICAL 302: години з помилкою — у петлі TECH', /TECH/.test(M.byId('multical302').steps.find(s => s.fields.includes('errHours')).hint.uk));
ok('НІК 7071: години — в інформативному меню, не довше 3 с', /MENU/.test(M.byId('nik7071').steps.find(s => s.fields.includes('hours')).hint.uk) && /понад 3 с повертає/.test(M.byId('nik7071').steps.find(s => s.fields.includes('hours')).hint.uk));
ok('ELF: група 1 — затиснути на 2 с', /---- 01/.test(M.byId('elf').loops.tip.uk) && /2 секунди/.test(M.byId('elf').loops.tip.uk));
ok('Sharky 774 (перевірено) — кроки OTOS без змін: 7 кроків, години ×2', M.byId('sharky774').steps.length === 7 && M.byId('sharky774').steps[5].count === 2);

// 126-а: квартирні лічильники інших громад — порядок кроків як у екранів (посібники Axioma, Danfoss, ZENNER, ista, L+G T550)
const order = (id) => M.byId(id).steps.map(s => s.fields[0]).join(',');
for (const id of ['qalcosonic_e3', 'sonometer30']) {
  const st = M.byId(id).steps, pw = st.find(s => s.fields.includes('power'));
  ok(id + ': енергія, обсяг, код помилки — INT; потужність → витрата → температури → години — INF (довге натискання)', order(id) === 'energy,volume,errCode,power,flow,tSupply,hours' && pw.press === 'long' && /INF/.test(pw.hint.uk), order(id));
  ok(id + ': час простою = час роботи батареї − години без помилки', /відніміть/.test(st.find(s => s.fields.includes('errHours')).hint.uk));
}
ok('SonoMeter 30: код помилки — екран 1.1 перед енергією, енергія — 1.2', /1\.1/.test(M.byId('sonometer30').steps[2].say.uk) && /1\.2/.test(M.byId('sonometer30').steps[0].hint.uk));
ok('zelsius C5: обсяг → витрата → температури → потужність коротко; помилки й години — рівень 3', order('zelsius_c5') === 'energy,volume,flow,tSupply,power,errCode,hours' && /рівні 3/.test(M.byId('zelsius_c5').steps[5].hint.uk));
ok('sensonic II: години = дні × 24, петля 2 — довге натискання', /× 24/.test(M.byId('sensonic2').steps[2].hint.uk) && M.byId('sensonic2').steps[2].press === 'long');
ok('T550/UH50: дві кнопки, LOOP 1 — кнопка ▼; години → з витратою (Pd) → простій', M.byId('t550').buttons === 2 && order('t550') === 'energy,volume,errCode,flow,power,tSupply,hours,flowHours,errHours' && /▼/.test(M.byId('t550').steps[3].say.uk));
const P = require('../web/src/ocrparse.js');
const mid = (txt) => { const r = P.photo({ lines: [{ text: txt, score: 0.9, x: 0, y: 0, w: 100, h: 20 }] }, {}, 0); return r.meter && r.meter.modelId; };
ok('фото наклейки: QALCOSONIC E3, SonoMeter 30 (не 1100), UH50 → T550, zelsius C5-IUF, sensonic',
  mid('QALCOSONIC E3') === 'qalcosonic_e3' && mid('SonoMeter 30') === 'sonometer30' && mid('SONOMETER 1100') === 'sharky775' && mid('ULTRAHEAT UH50') === 't550' && mid('zelsius C5-IUF') === 'zelsius_c5' && mid('ista sensonic II') === 'sensonic2' && mid('ULTRAHEAT T230') === 't230',
  ['QALCOSONIC E3', 'SonoMeter 30', 'SONOMETER 1100', 'ULTRAHEAT UH50', 'zelsius C5-IUF', 'ista sensonic II', 'ULTRAHEAT T230'].map(mid));

// 131-а: LQM-III, HYDROCAL-M3, SonoSafe/SonoSelect 10, Techem compact V — за посібниками; LQM-III — не ELF (інше меню)
ok('LQM-III: основний режим коротко; години — група FLo (~8 с), простій — FL2 з «A», години лише при витраті',
  order('lqm3') === 'energy,volume,tSupply,flow,power,errCode,hours,errHours' && /FLo/.test(M.byId('lqm3').steps[6].say.uk) && M.byId('lqm3').steps[6].hold === 8 &&
  /FL2/.test(M.byId('lqm3').steps[7].say.uk) && /«A»/.test(M.byId('lqm3').steps[7].hint.uk) && M.byId('lqm3').hoursOnlyWithFlow === true, order('lqm3'));
ok('HYDROCAL-M3: дві кнопки — T1 рівні, T2 екрани; рівень 2, години — рівень 5 (5.1, не 5.2), простій і «Err» — рівень 6',
  (st => M.byId('hydrocal_m3').buttons === 2 && order('hydrocal_m3') === 'energy,volume,power,flow,tSupply,hours,errHours,errCode' && /T1/.test(st[2].say.uk) && /5\.1/.test(st[5].hint.uk) && /5\.2/.test(st[5].hint.uk) && /рівень 6/.test(st[6].hint.uk))(M.byId('hydrocal_m3').steps));
ok('SonoSafe 10: головна петля — енергія, обсяг, години; температури (чергуються), потужність, витрата — інша петля, без вигаданих секунд; простою на екрані немає',
  (st => order('sonosafe10') === 'energy,volume,hours,errCode,tSupply,power,flow,errHours' && st[4].press === 'long' && !st[4].hold && /доки не зміниться/.test(st[4].say.uk) && st[4].lcd.swap && /На екрані немає/.test(st[7].say.uk) && M.byId('sonosafe10').status === 'draft')(M.byId('sonosafe10').steps));
ok('Techem compact V: рівень 2 — понад 3 с; годин на екрані немає; F-5/F-9 — міряє правильно, C-1 — несправний',
  (st => st[1].press === 'long' && st[1].hold === 3 && st[6].fields.join() === 'hours,errHours' && /На екрані немає/.test(st[6].say.uk) && /F-9/.test(st[5].hint.uk) && /C-1/.test(st[5].hint.uk) && M.byId('techem_cv').sleepMin === 2)(M.byId('techem_cv').steps));
ok('статуси: перевірено — лише Sharky 774; «уточнюється» — SonoSafe 10, TRUST, ULTRAMETER, LTE-1, Supercal; решта — за посібником виробника',
  M.MODELS.filter(m => m.status === 'verified').map(m => m.id).join() === 'sharky774' && M.MODELS.filter(m => m.status === 'draft').map(m => m.id).join() === 'sonosafe10,trust,ultrameter,lte1,supercal,hydrosonis,maxx2,ultracal201,heat1u,uhm,eemc' &&
  M.MODELS.every(m => ['verified', 'manual', 'draft', 'universal'].includes(m.status)), M.MODELS.map(m => m.id + ':' + m.status));
ok('фото наклейки: LQM-III і CQM-III-K → lqm3 (не ELF), ELF → elf, HYDROCAL-M3, SonoSafe/SonoSelect, techem compact V',
  mid('LQM-III') === 'lqm3' && mid('CQM-III-K') === 'lqm3' && mid('Apator ELF') === 'elf' && mid('HYDROCAL-M3') === 'hydrocal_m3' && mid('Danfoss SonoSafe 10') === 'sonosafe10' && mid('SonoSelect 10') === 'sonosafe10' && mid('techem compact V') === 'techem_cv',
  ['LQM-III', 'CQM-III-K', 'Apator ELF', 'HYDROCAL-M3', 'Danfoss SonoSafe 10', 'SonoSelect 10', 'techem compact V'].map(mid));

// 132-а: харківські з пам’ятки ХТМ (години лише при витраті) — TRUST (інструкції установників), ULTRAMETER (паспорт: рівні А1–А4), LTE-1 / LTE-1U (лише перелік екранів)
ok('TRUST: «HEAT/SUM Gcal» першим; потужність — після kWh і COOL/SUM (пропустити); обсяг → витрата → температури → «T» → години (h чи d × 24); простій — інша петля ~3 с',
  (st => order('trust') === 'energy,power,volume,flow,tSupply,hours,errHours,errCode' && /HEAT\/SUM/.test(st[0].hint.uk) && /COOL\/SUM/.test(st[1].hint.uk) && st[1].count === null &&
    st[5].count === 2 && /× 24|на 24/.test(st[5].hint.uk) && /3 секунди/.test(st[6].hint.uk) && M.byId('trust').hoursOnlyWithFlow)(M.byId('trust').steps), order('trust'));
ok('ULTRAMETER: А1 коротко (< 2 с) — енергія, обсяг, температури, [різниця], витрата, потужність, години; простій — архів А2 (понад 2 с); сон за 10 хв',
  (st => order('ultrameter') === 'energy,volume,tSupply,flow,power,hours,errHours,errCode' && st[3].count === 2 && st[6].press === 'long' && st[6].hold === 2 && /А2/.test(st[6].hint.uk) &&
    /А4/.test(M.byId('ultrameter').loops.tip.uk) && M.byId('ultrameter').sleepMin === 10 && M.byId('ultrameter').units[0] === 'Gcal')(M.byId('ultrameter').steps), order('ultrameter'));
ok('LTE-1 / LTE-1U: Гкал (ГДж — другим екраном), години лише при витраті, «уточнюється»', M.byId('lte1').units.join() === 'Gcal,GJ' && M.byId('lte1').hoursOnlyWithFlow && /ГДж/.test(M.byId('lte1').steps[0].hint.uk));
const kind = (txt) => P.photo({ lines: [{ text: txt, score: 0.9, x: 0, y: 0, w: 100, h: 20 }] }, {}, 0).photo.meterType;
ok('фото: TRUST і «HEAT/SUM» → trust, ULTRAMETER UM-15 / UltraMeter-M → ultrameter, LTE-1U і ЛТЕ-1 → lte1; електролічильник «Меридіан ЛТЕ-1.03» — не тепло',
  mid('TRUST') === 'trust' && mid('HEAT/SUM 0001.234 Gcal') === 'trust' && mid('ULTRAMETER UM-15') === 'ultrameter' && mid('UltraMeter-M') === 'ultrameter' && mid('LTE-1U') === 'lte1' && mid('ЛТЕ-1 Ду-15') === 'lte1' &&
    mid('Меридіан ЛТЕ-1.03/2Т') !== 'lte1' && kind('Меридіан ЛТЕ-1.03/2Т 220 V 50 Hz') === 'electric' && kind('ULTRAMETER 0001.234') === 'heat',
  ['TRUST', 'HEAT/SUM 0001.234 Gcal', 'ULTRAMETER UM-15', 'UltraMeter-M', 'LTE-1U', 'ЛТЕ-1 Ду-15', 'Меридіан ЛТЕ-1.03/2Т'].map(mid).concat([kind('Меридіан ЛТЕ-1.03/2Т 220 V 50 Hz')]));

// 133-я: зі списку ХТМ (бланки журналів) — за посібниками виробників
ok('MULTICAL 402: верхня кнопка — енергія → обсяг → години → T → [різниця] → витрата (l/h ÷ 1000) → потужність → INFO; простою на екрані немає; ГДж',
  (st => order('multical402') === 'energy,volume,hours,tSupply,flow,power,errCode,errHours' && st[4].count === 2 && /1000/.test(st[4].hint.uk) && /INFO/.test(st[6].hint.uk) &&
    /Окремого/.test(st[7].say.uk) && M.byId('multical402').units[0] === 'GJ' && M.byId('multical402').buttons === 2)(M.byId('multical402').steps), order('multical402'));
ok('SENSOSTAR 2: рівень 1 — енергія, [тест, розрах. день] обсяг, потужність, витрата, [дата] помилка; рівень 2 (понад 4 с) — [максимуми] температури, [різниця] дні × 24',
  (st => order('sensostar2') === 'energy,volume,power,flow,errCode,tSupply,hours,errHours' && st[1].count === 3 && st[5].press === 'long' && st[5].hold === 4 && st[5].count === 2 &&
    /× 24/.test(st[6].hint.uk) && M.byId('sensostar2').sleepMin === 1)(M.byId('sensostar2').steps), order('sensostar2'));
ok('PolluCom E / EX: червона кнопка — меню користувача; «Err» — першим; дні роботи й години збою — меню L4 (8 с, потім 2 с)',
  (st => order('pollucom') === 'energy,volume,flow,power,tSupply,errCode,hours,errHours' && st[6].press === 'long' && st[6].hold === 8 && /L4/.test(st[6].say.uk) && /× 24/.test(st[6].hint.uk) &&
    /збою/.test(st[7].hint.uk) && /Err 1010/.test(st[5].hint.uk))(M.byId('pollucom').steps), order('pollucom'));
ok('ULTRAHEAT 2WR6 (T350): петля користувача — енергія, обсяг, [тест] F; сервісна — 10 с: витрата, потужність, температури одним рядком, [дата] Bh, Fh',
  (st => order('uh2wr6') === 'energy,volume,errCode,flow,power,tSupply,hours,errHours' && st[3].press === 'long' && st[3].hold === 10 && /Bh/.test(st[6].hint.uk) && /Fh/.test(st[7].hint.uk) &&
    /3 с/.test(st[7].hint.uk))(M.byId('uh2wr6').steps), order('uh2wr6'));
ok('Supercal 539 / 739: «Енергія» → «Обсяг»; «Err» першим; меню «Сервіс» (понад 2 с) — години, температури, витрата, потужність; простою немає; «уточнюється»',
  (st => order('supercal') === 'energy,volume,errCode,hours,tSupply,flow,power,errHours' && st[3].press === 'long' && st[3].hold === 2 && /Сервіс/.test(st[3].say.uk) &&
    /Err 1/.test(st[2].hint.uk) && M.byId('supercal').status === 'draft' && M.byId('supercal').sleepMin === 3)(M.byId('supercal').steps), order('supercal'));
ok('CF-UltraMaXX: 1.1 енергія, 1.2 обсяг; рівень 3 (двічі понад 2 с) — 3.1 витрата … 3.6 час у помилці, 3.7 роки й дні → години, 3.9 код',
  (st => order('ultramaxx') === 'energy,volume,flow,power,tSupply,errHours,hours,errCode' && st[2].press === 'long' && st[2].hold === 2 && /двічі/.test(st[2].say.uk) &&
    /3\.6/.test(st[5].hint.uk) && /365/.test(st[6].hint.uk) && /35 592/.test(st[6].hint.uk) && /3\.9/.test(st[7].hint.uk))(M.byId('ultramaxx').steps), order('ultramaxx'));
ok('арифметика підказок: 1484 дні × 24 = 35 616 год, (4 × 365 + 23) × 24 = 35 592 год', 1484 * 24 === 35616 && (4 * 365 + 23) * 24 === 35592);
ok('фото: MULTICAL 402, SENSOSTAR 2 / MSH, SensoStar E, PolluCom EX, ULTRAHEAT 2WR6 / T350 (не T330), Supercal 739, CF-UltraMaXX / Integral-MK UltraMaXX',
  mid('MULTICAL 402') === 'multical402' && mid('Kamstrup MULTICAL 302') === 'multical302' && mid('SENSOSTAR 2') === 'sensostar2' && mid('SENSOSTAR®2+') === 'sensostar2' && mid('MSH-SStar') === 'sensostar2' &&
    mid('SensoStar E') === 'sensostar' && mid('Sensus PolluCom EX') === 'pollucom' && mid('ULTRAHEAT 2WR6') === 'uh2wr6' && mid('ULTRAHEAT T350') === 'uh2wr6' && mid('ULTRAHEAT T330') === 't330' &&
    mid('Supercal 739') === 'supercal' && mid('CF-UltraMaXX') === 'ultramaxx' && mid('Integral-MK UltraMaXX') === 'ultramaxx' && mid('ULTRAMETER UM-15') === 'ultrameter',
  ['MULTICAL 402', 'Kamstrup MULTICAL 302', 'SENSOSTAR 2', 'SENSOSTAR®2+', 'MSH-SStar', 'SensoStar E', 'Sensus PolluCom EX', 'ULTRAHEAT 2WR6', 'ULTRAHEAT T350', 'ULTRAHEAT T330', 'Supercal 739', 'CF-UltraMaXX', 'Integral-MK UltraMaXX', 'ULTRAMETER UM-15'].map(mid));
ok('фото: PolluCom з «Sensus» (виробник водомірів) — тепло, не вода', kind('Sensus PolluCom E 0012.345') === 'heat' && kind('Supercal 739 012345') === 'heat');

ok('назви з наклейки (TRUST, ULTRAMETER, ЛТЕ): підпис у списку й «Інша модель» у «Екран не той?» — справжня модель невідома',
  ['trust', 'ultrameter', 'lte1'].every(id => { const m = M.byId(id); return m.sticker && both(m.sub) && /невідом|не знайшли|немає/.test(m.sub.uk) && /Інша модель/.test(m.loops.tip.uk) && /Другая модель/.test(m.loops.tip.ru); }) &&
    M.MODELS.filter(m => m.sticker).map(m => m.id).join() === 'trust,ultrameter,lte1,uhm');

// 134-я: остаток списка ХТМ (бланки журналів) — колонки бланка = набір значень і одиниці
ok('QALCOSONIC HEAT 1 / SKS-3K: INT — помилка 1.1 перед енергією 1.2, обсяг 1.6, години без помилки 1.10; INF — 3.1 потужність … 3.22 час роботи батареї (простій = 3.22 − 3.21)',
  (st => order('qalcosonic_heat') === 'energy,volume,errCode,power,flow,tSupply,hours' && st[6].fields.join() === 'hours,errHours' && /1\.2/.test(st[0].hint.uk) && /1\.6/.test(st[1].hint.uk) && /1\.1\b/.test(st[2].say.uk) &&
    st[3].press === 'long' && /INF/.test(st[3].say.uk) && /3\.22/.test(st[6].hint.uk) && /3\.21/.test(st[6].hint.uk) && M.byId('qalcosonic_heat').units.join() === 'MWh,Gcal,GJ,kWh' &&
    /SKS-3/.test(M.byId('qalcosonic_heat').note.uk))(M.byId('qalcosonic_heat').steps), order('qalcosonic_heat'));
ok('HYDROSONIS-UC: схема QALCOSONIC E1 (бланк: 3.21 і 3.22), «уточнюється»; на екрані «LOOP» — це ULC: обрати T330',
  order('hydrosonis') === order('qalcosonic_heat') && M.byId('hydrosonis').status === 'draft' && /T330/.test(M.byId('hydrosonis').loops.tip.uk) && /T330/.test(M.byId('hydrosonis').loops.tip.ru) && /3\.21/.test(M.byId('hydrosonis').note.uk));
ok('Q heat 5.5 US: платформа L+G T330 — LOOP 0 і LOOP 1 (понад 3 с), Bd/Fd/Pd; kWh',
  order('qheat55us') === order('t330') && M.byId('qheat55us').steps[2].press === 'long' && M.byId('qheat55us').steps[2].hold === 3 && M.byId('qheat55us').unit === 'kWh' && /kWh/.test(M.byId('qheat55us').steps[0].hint.uk));
ok('microCLIMA: як SENSOSTAR 2 (рівень 2 — понад 4 с, дні × 24), обсяг — гортати до «m³», простій — про microCLIMA',
  (st => order('microclima') === order('sensostar2') && st[1].count === null && st[5].hold === 4 && /× 24/.test(st[6].hint.uk) && /microCLIMA/.test(st[7].hint.uk) && !/SENSOSTAR/.test(st[7].hint.uk) &&
    M.byId('microclima').sleepMin === 1)(M.byId('microclima').steps), order('microclima'));
ok('Integral-MK MaXX: рівні UltraMaXX, витрата в l/h ÷ 1000, роки й дні → години',
  (st => order('maxx2') === order('ultramaxx') && /l\/h/.test(st[2].lcd.tag) && /1000/.test(st[2].hint.uk) && /1000/.test(st[2].hint.ru) && /365/.test(st[6].hint.uk))(M.byId('maxx2').steps), order('maxx2'));
ok('за бланком ХТМ: Ultracal 201 — Гкал, потужність → обсяг → витрата → T → години → Err; HEAT+1U — потужність у Гкал/год × 1163 = кВт, є години з помилкою; UHM — наклейка; EEM-C — ГДж, l/h ÷ 1000, «HRS»',
  order('ultracal201') === 'energy,power,volume,flow,tSupply,hours,errCode,errHours' && M.byId('ultracal201').units[0] === 'Gcal' &&
  order('heat1u') === 'energy,power,volume,flow,tSupply,hours,errHours,errCode' && /1163/.test(M.byId('heat1u').steps[1].hint.uk) && M.byId('heat1u').steps[1].lcd.tag === 'Gcal/h' && M.byId('eemc').steps[4].lcd.tag === 'l/h' && 0.002 * 1163 > 2.3 && 0.002 * 1163 < 2.35 &&
  M.byId('heat1u').steps[6].press === 'short' && /колонка 9/.test(M.byId('heat1u').steps[6].hint.uk) &&
  order('uhm') === 'energy,power,volume,flow,tSupply,hours,errCode,errHours' && /активної/.test(M.byId('uhm').steps[5].hint.uk) &&
  order('eemc') === 'energy,volume,tSupply,power,flow,hours,errCode,errHours' && M.byId('eemc').unit === 'GJ' && /1000/.test(M.byId('eemc').steps[4].hint.uk) && /HRS/.test(M.byId('eemc').steps[5].hint.uk) &&
  ['ultracal201', 'uhm', 'eemc'].every(id => /На екрані немає/.test(M.byId(id).steps[7].say.uk)), ['ultracal201', 'heat1u', 'uhm', 'eemc'].map(order));
ok('усі 32 типи з бланків ХТМ мають свою модель (крім «Інша модель»)',
  ['cfecho2', 'ultramaxx', 'maxx2', 'eemc', 'hydrocal_m3', 'hydrosonis', 'lqm3', 'lte1', 'microclima', 'multical402', 'pollucom', 'qalcosonic_heat', 'qheat55us', 'sensostar2', 'sensostar',
    'sharky774', 'sharky775', 'supercal', 'trust', 'ultracal201', 'uh2wr6', 't230', 't330', 'ultrameter', 'zelsius_c5', 'heat1u', 'uhm'].every(id => !!M.byId(id)));
ok('фото: QALCOSONIC HEAT 1 / SKS-3K / СКС-3 (не E3), HYDROSONIS (не HYDROCAL), Q heat 5.5 US, microCLIMA, Integral-MK MaXX (не UltraMaXX), Ultracal 201 / ZIMMERSTEC, Heat+1U, UHM, EEM-C',
  mid('QALCOSONIC HEAT 1') === 'qalcosonic_heat' && mid('SKS-3K') === 'qalcosonic_heat' && mid('СКС-3') === 'qalcosonic_heat' && mid('QALCOSONIC E3') === 'qalcosonic_e3' &&
    mid('HYDROSONIS UC') === 'hydrosonis' && mid('HYDROCAL-M3') === 'hydrocal_m3' && mid('QUNDIS Q heat 5.5 US') === 'qheat55us' && mid('microCLIMA') === 'microclima' &&
    mid('Integral-MK MaXX') === 'maxx2' && mid('Integral-MK UltraMaXX') === 'ultramaxx' && mid('Ultracal 201') === 'ultracal201' && mid('ZIMMERSTEC') === 'ultracal201' && mid('Supercal 739') === 'supercal' &&
    mid('Heat+1U') === 'heat1u' && mid('UHM DN15') === 'uhm' && mid('Ultrasonic Heat Meter') === 'uhm' && mid('Danfoss EEM-C') === 'eemc' && mid('ULTRAHEAT T330') === 't330' &&
    ['QALCOSONIC HEAT 1 0001.234', 'microCLIMA 0012.345', 'Heat+1U 0001.234', 'UHM 0001.234', 'Q heat 5.5 US 012345'].every(x => kind(x) === 'heat'),
  ['QALCOSONIC HEAT 1', 'SKS-3K', 'СКС-3', 'QALCOSONIC E3', 'HYDROSONIS UC', 'QUNDIS Q heat 5.5 US', 'microCLIMA', 'Integral-MK MaXX', 'Ultracal 201', 'ZIMMERSTEC', 'Heat+1U', 'UHM DN15', 'Ultrasonic Heat Meter', 'Danfoss EEM-C'].map(mid));

console.log(`\nИтог: ${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
