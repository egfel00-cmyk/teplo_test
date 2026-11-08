// /admin → «Справочник»: обзор областей, громады Киевщины, правка воды громады (поверх репозитория) → люди видят сразу, откат.
// Нужен сайт 127.0.0.1:8013 и в config.php: 'admins' => ['emails' => ['pvadmin@example.ua']].
const { chromium } = require('playwright');
const U = 'http://127.0.0.1:8013/';
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 860 }, locale: 'ru-RU' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(U);
  const api = (m, path, body) => p.evaluate(async ([m, path, body]) => { const c = (document.cookie.match(/ts_csrf=([^;]+)/) || [])[1] || ''; const r = await fetch('/api' + path, { method: m, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF': decodeURIComponent(c) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json().catch(() => ({})) }; }, [m, path, body]);
  await api('GET', '/config');
  let r = await api('POST', '/auth/register', { email: 'pvadmin@example.ua', password: 'pv-admin-test-1' });
  if (r.s !== 200) r = await api('POST', '/auth/login', { email: 'pvadmin@example.ua', password: 'pv-admin-test-1' });
  await api('POST', '/admin/prov/save', { r: 'kv', scope: 'hromadas', key: 'Ржищівська', kind: 'water', value: null });   // чистый старт
  await p.goto(U + 'admin#prov'); await p.waitForTimeout(900);
  const main = async () => (await p.textContent('main')) || '';
  ok('вкладка «Справочник»: 5 регионов, «Что ищут люди», «Можно ли подавать без человека»', /Справочник поставщиков/.test(await main()) && (await p.$$('main .cards .card')).length === 5 && /Что ищут люди/.test(await main()) && /без человека/.test(await main()), (await main()).slice(0, 200));
  await p.fill('#pvq', 'Бровари, вул. Київська 1'); await p.click('#pvf button'); await p.waitForTimeout(600);
  ok('поиск адреса → Бровари, Броварська громада, Київська, кнопка «Открыть громаду»', /Бровари/.test(await main()) && /Броварська громада/.test(await main()) && !!(await p.$('a[href*="prov/kv/hromadas/"]')));
  await p.goto(U + 'admin#prov/kv'); await p.waitForTimeout(900);
  ok('Київська: таблица громад (69), «Вся область» — Київська обласна енергопостачальна, Газмережі Київська філія', (await p.$$('main tr.click')).length === 69 && /Київська обласна/.test(await main()) && /Київська філія/.test(await main()), (await p.$$('main tr.click')).length);
  await p.fill('#pvq2', 'Обухів'); await p.waitForTimeout(300);
  ok('фильтр «Обухів» → первой Обухівська, ниже — громады Обухівського району', /^Обухівська/.test(((await p.textContent('main tr.click')) || '').trim()) && (await p.$$('main tr.click')).length > 1, ((await p.textContent('main tr.click')) || '').slice(0, 40));
  // у Обухівської з 59-ї сесії вже є вода в репозиторії — правимо громаду того ж району без води (Ржищівська, Кагарлицька з 61-ї — з водою)
  await p.click('main tr.click:has-text("Ржищівська")'); await p.waitForTimeout(900);
  ok('громада: 4 вида, вода свёрнута («нет на этом уровне — люди видят…»), пункты громады', (await p.$$('details[data-pvk]')).length === 4 && /нет на этом уровне/.test(await main()) && /Пункты громады/.test(await main()));
  await p.click('details[data-pvk=water] summary'); await p.waitForTimeout(200);
  await p.fill('details[data-pvk=water] [data-pvf=org]', 'КП «Ржищівводоканал» (тест)'); await p.fill('details[data-pvk=water] [data-pvf=supply]', '41,2'); await p.fill('details[data-pvk=water] [data-pvf=drain]', '30');
  await p.fill('details[data-pvk=water] [data-pvf=phones]', '(04594) 5-00-00; диспетчер'); await p.fill('details[data-pvk=water] [data-pvf=src]', 'тест e2e');
  await p.click('details[data-pvk=water] [data-pvsave=form]'); await p.waitForTimeout(700);
  ok('сохранить → «Сохранено», пометка «правка», в шапке вида — 41,2 / 30', /Сохранено/.test(await p.textContent('details[data-pvk=water]')) && /правка/.test(await p.textContent('details[data-pvk=water] summary')) && /41,2 \/ 30/.test(await p.textContent('details[data-pvk=water] summary')));
  const pub = await api('GET', '/providers?q=' + encodeURIComponent('Ржищів, вул. Шевченка 1'));
  ok('люди сразу видят: /api/providers Ржищів — вода КП, 41,2 и 30, телефон', pub.j.kinds.water.org === 'КП «Ржищівводоканал» (тест)' && pub.j.kinds.water.supply === 41.2 && pub.j.kinds.water.drain === 30 && pub.j.kinds.water.phones[0][2] === 'диспетчер', pub.j.kinds && pub.j.kinds.water);
  p.on('dialog', d => d.accept());
  await p.click('details[data-pvk=water] [data-pvsave=revert]'); await p.waitForTimeout(700);
  const pub2 = await api('GET', '/providers?q=' + encodeURIComponent('Ржищів, вул. Шевченка 1'));
  ok('«Вернуть как в репозитории» → вода снова неизвестна', pub2.j.kinds.water.org === null, pub2.j.kinds.water);
  await p.goto(U + 'admin#prov'); await p.waitForTimeout(800);
  ok('журнал правок: две записи (изменено, как в репозитории) с «Откатить»', (await p.$$('[data-pvundo]')).length >= 2 && /как в репозитории/.test(await main()));
  await p.screenshot({ path: '/tmp/shot_provadmin.png', fullPage: false });
  ok('без ошибок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
