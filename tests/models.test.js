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
ok('SensoStar: витрата — на рівні 2, понад 4 с', (s => s.press === 'long' && s.hold === 4)(M.byId('sensostar').steps.find(s => s.fields.includes('flow'))));
ok('CF Echo II (128-а, брошура Itron): Loop 1 — енергія, обсяг; Loop 2 — витрата, потужність, температури, години; без вигаданих секунд у підписі',
  (function () { var st = M.byId('cfecho2').steps, f = st.map(s => s.fields.join('+')).join(' '), l2 = st.find(s => s.loop);
    return f === 'energy volume+errCode flow power tSupply+tReturn hours errHours' && /доки не зміниться/.test(l2.say.uk) && l2.fields[0] === 'flow'; })());
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

console.log(`\nИтог: ${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
