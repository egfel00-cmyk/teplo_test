// 155-а: черга першого налаштування переживає перезавантаження вкладки (журнал: після «Почати налаштування» сторінка
// перезавантажилась на #wadd — черга лічильників пропадала, людина бачила окремий «Новий водомір» і йшла).
// node e2e_pqreload.cjs  (локальний сервер 127.0.0.1:8013)
const { chromium } = require('playwright');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch(); const ctx = await require('./pvopen.cjs').ctx(b, { viewport: { width: 390, height: 800 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const hash = () => p.evaluate(() => location.hash);
  await p.goto(U); await p.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await p.goto(U + '#start'); await p.reload(); await p.waitForTimeout(600);
  await p.click('[data-key=aw-elec] .aw-kt'); await p.click('[data-key=aw-cold-inc]'); await p.click('[data-key=aw-gas] .aw-kt'); await p.waitForTimeout(150);
  await p.click('[data-key=aw-create]'); await p.waitForTimeout(500);
  ok('черга: світло, «1 з 3»', (await hash()) === '#eadd' && /1\sз\s3/.test(await p.textContent('[data-key=aw-queue]')));
  await p.reload(); await p.waitForTimeout(700);
  ok('після перезавантаження — та сама черга «1 з 3» на #eadd', (await hash()) === '#eadd' && !!(await p.$('[data-key=aw-queue]')) && /1\sз\s3/.test(await p.textContent('[data-key=aw-queue]')));
  await p.click('[data-key=aw-q-later]'); await p.waitForTimeout(500);
  ok('«пізніше» → холодна, «2 з 3»', (await hash()) === '#wadd' && /2\sз\s3/.test(await p.textContent('[data-key=aw-queue]')));
  await p.reload(); await p.waitForTimeout(700);
  ok('перезавантаження на #wadd — «2 з 3», той самий вид (холодна)', (await hash()) === '#wadd' && /2\sз\s3/.test(await p.textContent('[data-key=aw-queue]')) && /холодн/i.test(await p.textContent('main')));
  await p.click('[data-key=aw-q-later]'); await p.waitForTimeout(500); await p.click('[data-key=aw-q-later]'); await p.waitForTimeout(600);
  ok('черга закінчилась — головна, у sessionStorage черги немає', !/^#(eadd|wadd|gadd)$/.test(await hash()) && (await p.evaluate(() => sessionStorage.getItem('teplo.pq'))) === null);
  // картки без показань — кнопка «Внести перші показання» (і рядка «ще не вносили» немає)
  await p.goto(U + '#home'); await p.waitForTimeout(600);
  const firsts = await p.$$eval('.ucard-first', a => a.map(x => x.getAttribute('data-key')));
  ok('головна: «Внести перші показання» на світлі, холодній і газі', ['card-elec-first', 'card-cold-first', 'card-gas-first'].every(k => firsts.includes(k)) && /Внести перші показання/.test(await p.textContent('[data-key=card-elec-first]')), firsts);
  await p.click('[data-key=card-cold-first]'); await p.waitForTimeout(500);
  ok('«Внести перші» холодної → внесення води', /^#(wnew|water-cold|wread)/.test(await hash()) || !!(await p.$('[data-key^=wn-]')), await hash());
  await p.goto(U + '#wadd'); await p.waitForTimeout(600);
  ok('#wadd без черги — без плашки «з 3»', !(await p.$('[data-key=aw-queue]')));
  ok('без помилок JS', errs.length === 0, errs);
  await b.close(); console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); process.exit(fail ? 1 : 0);
})();
