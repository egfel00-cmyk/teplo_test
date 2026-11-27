// 194-я: /admin → «Тарифы» — изменения тарифов (minfin подставлен tarseed.php): карточка «было → стало», «Принять в справочник» с основанием и ссылкой →
// люди видят next со ссылкой (/api/providers), «Игнорировать», статистика по месяцам, источники, громады без источника; поле «Страница тарифов КП» в справочнике.
// Нужен сайт 127.0.0.1:8013 (stand.sh up) и в config.php: 'admins' => ['emails' => ['pvadmin@example.ua']].
const { chromium } = require('playwright'); const { execFileSync } = require('child_process'); const path = require('path');
const U = 'http://127.0.0.1:8013/';
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
(async () => {
  const seed = JSON.parse(execFileSync('php', [path.join(__dirname, 'tarseed.php')], { env: Object.assign({}, process.env, { SITE_DATA: process.env.SITE_DATA || '/tmp/teplo_data' }) }).toString().trim().split('\n').pop());
  ok('засев: minfin — вода Запоріжжя и доставка газа Хмельниччины изменились', seed.water === 1 && seed.gas === 1, seed);
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(U);
  const api = (m, pth, body) => p.evaluate(async ([m, pth, body]) => { const c = (document.cookie.match(/ts_csrf=([^;]+)/) || [])[1] || ''; const r = await fetch('/api' + pth, { method: m, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF': decodeURIComponent(c) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; }, [m, pth, body]);
  await api('GET', '/config');
  let r = await api('POST', '/auth/register', { email: 'pvadmin@example.ua', password: 'pv-admin-test-1' });
  if (r.s !== 200) r = await api('POST', '/auth/login', { email: 'pvadmin@example.ua', password: 'pv-admin-test-1' });
  await api('POST', '/admin/prov/save', { r: 'zp', scope: 'hromadas', key: 'Запорізька', kind: 'water', value: null });   // чистый старт
  await p.goto(U + 'admin#tar'); await p.waitForTimeout(900);
  const main = async () => (await p.textContent('main')) || '';
  ok('вкладка «Тарифы» с числом не разобранных (2)', /Тарифы\s*2/.test((await p.textContent('nav button[data-tab=tar]')) || ''), await p.textContent('nav button[data-tab=tar]'));
  const card = 'details[data-tarc]:has-text("Запоріжжя")';
  ok('карточка: вода Запоріжжя 41,688 → 45,13, +12,5 %, с 01.01.27, где в справочнике — Запорізька, «где увидели» — minfin',
    /41,688/.test(await p.textContent(card)) && /45,13/.test(await p.textContent(card)) && /\+12,5 %/.test(await p.textContent(card)) && /с 01\.01\.27/.test(await p.textContent(card))
    && !!(await p.$(card + ' a[href*="prov/zp/hromadas/"]')) && !!(await p.$(card + ' a[href="https://index.minfin.com.ua/ua/tariff/water/"]')), (await p.textContent(card)).slice(0, 300));
  ok('форма подставлена: дата 2027-01-01, вода 45,13, стоки 32,89', await p.inputValue(card + ' [data-pvf=from]') === '2027-01-01' && await p.inputValue(card + ' [data-pvf=supply]') === '45,13' && await p.inputValue(card + ' [data-pvf=drain]') === '32,89');
  ok('статистика: месяц, источники minfin (200, «наших» строк), громады без источника — ссылками в справочник',
    /Статистика по месяцам/.test(await main()) && /строк 1, наших 1/.test(await main()) && /Громады без источника/.test(await main()) && (await p.$$('main a[href^="#prov/"]')).length > 5);
  await p.fill(card + ' [data-pvf=url]', 'http://x'); await p.click(card + ' [data-taracc]'); await p.waitForTimeout(500);
  ok('ссылка не https → «Не сохранено: ссылка — https://…»', /ссылка — https/.test(await p.textContent(card + ' [data-tarmsg]')), await p.textContent(card + ' [data-tarmsg]'));
  await p.fill(card + ' [data-pvf=doc]', 'Рішення виконкому Запорізької МР № 999 від 01.12.2026'); await p.fill(card + ' [data-pvf=url]', 'https://zp.gov.ua/docs/999');
  await p.click(card + ' [data-taracc]'); await p.waitForTimeout(900);
  ok('принято → карточки нет, «Разобрано» — «в справочнике» с документом', !(await p.$(card)) && /в справочнике/.test(await main()) && !!(await p.$('main a[href="https://zp.gov.ua/docs/999"]')));
  const pub = await api('GET', '/providers?q=' + encodeURIComponent('Запоріжжя, вул. Соборна 1'));
  const nx = pub.j.kinds && pub.j.kinds.water && pub.j.kinds.water.next;
  ok('люди видят: /api/providers Запоріжжя — сейчас 41,688, next с 01.01.2027 45,13 / 32,89 с основанием и ссылкой', pub.j.kinds.water.supply === 41.688 && nx && nx.from === '2027-01-01' && nx.supply === 45.13 && nx.drain === 32.89 && nx.url === 'https://zp.gov.ua/docs/999' && /№ 999/.test(nx.doc), pub.j.kinds && pub.j.kinds.water);
  const gc = 'details[data-tarc]:has-text("Хмельницька")';
  ok('доставка газа: 1,848 → 1,99, поле «Доставка», вся область', /1,848/.test(await p.textContent(gc)) && /1,99/.test(await p.textContent(gc)) && !!(await p.$(gc + ' [data-pvf=dist]')) && /вся область/.test(await p.textContent(gc)));
  await p.click(gc + ' [data-tarign]'); await p.waitForTimeout(900);
  ok('«Игнорировать» → нового нет, в «Разобрано» — «игнор»; вкладка без числа', /Нового нет/.test(await main()) && /игнор/.test(await main()) && !/Тарифы\s*\d/.test((await p.textContent('nav button[data-tab=tar]')) || ''));
  await p.goto(U + 'admin#prov/zp/hromadas/' + encodeURIComponent('Запорізька')); await p.waitForTimeout(900);
  ok('справочник: у воды — поле «Страница тарифов КП», в JSON — next с url', !!(await p.$('details[data-pvk=water] [data-pvf=tar]')) && /docs\/999/.test(await p.inputValue('details[data-pvk=water] [data-pjson]')));
  await p.screenshot({ path: '/tmp/shot_taradmin.png', fullPage: false });
  await api('POST', '/admin/prov/save', { r: 'zp', scope: 'hromadas', key: 'Запорізька', kind: 'water', value: null });
  await api('POST', '/admin/prov/save', { r: 'km', scope: 'oblast', key: '', kind: 'gas', value: null });
  ok('без ошибок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
