// «Передача в кабінет ХТМ» (владелец 07.11): статус выбором прямо на странице — «На перевірці» / «Прийнято», страницу не покидаем;
// шапка — без переключателя темы (тема как в телефоне, принудительно — только в Налаштуваннях), рядом с «Лічильники» — «бета».
// node e2e_handover.cjs  (локальный сервер 127.0.0.1:8013)
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/';
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA', colorScheme: 'light' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')));
  const s0 = demo({});
  s0.theme = 'dark'; delete s0.themeV;   // так было у тех, кто нажимал кнопку темы в шапке
  s0.readings.push({ id: 'rnew', place: 'main', status: 'checked', htm: { date: '2026-11-06', energy: '13.100', volume: '2500', flow: '0.06', power: '1.6', tSupply: '50', tReturn: '30', hours: '36000', errHours: '153', errCode: 'E---' }, raw: {}, createdAt: '2026-11-06T10:00:00Z', updatedAt: 1 });
  s0.focusId = 'rnew';
  await p.goto(U); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), s0);
  await p.goto(U + '#home'); await p.reload(); await p.waitForTimeout(600);

  // шапка
  ok('в шапці немає перемикача теми', !(await p.$('[data-key=theme-toggle]')) && !(await p.$('.top .theme-btn')));
  ok('біля «Лічильники» — «бета»', /^Лічильники\s*бета$/.test((await p.textContent('[data-key=brand]')).trim()) && await p.isVisible('[data-key=beta]'));
  const th = await st();
  ok('примусова темна з шапки → один раз «як у телефоні» (auto), сторінка світла як телефон', th.theme === 'auto' && th.themeV === 2 && (await p.getAttribute('html', 'data-theme')) === 'light', [th.theme, th.themeV]);
  await p.goto(U + '#prefs'); await p.waitForTimeout(400);
  await p.click('[data-key=pg-look] > summary').catch(() => {}); await p.waitForTimeout(200);
  await p.click('[data-key=prefs-theme] [data-act=theme][data-v=dark]'); await p.waitForTimeout(300);
  await p.reload(); await p.waitForTimeout(500);
  ok('у Налаштуваннях «Темна» — тримається після перезавантаження', (await st()).theme === 'dark' && (await p.getAttribute('html', 'data-theme')) === 'dark');
  await p.click('[data-key=prefs-theme] [data-act=theme][data-v=auto]').catch(async () => { await p.click('[data-key=pg-look] > summary'); await p.click('[data-key=prefs-theme] [data-act=theme][data-v=auto]'); });
  await p.waitForTimeout(200);

  // передача
  await p.goto(U + '#handover'); await p.waitForTimeout(600);
  ok('«Передача в кабінет ХТМ»: блок «Що з показаннями…», кнопки «Я зберіг» більше немає', await p.isVisible('[data-key=ho-status]') && !(await p.$('[data-key=handover-done]')));
  ok('…нічого не обрано', (await p.getAttribute('[data-key=ho-st-handed]', 'aria-checked')) === 'false' && (await p.getAttribute('[data-key=ho-st-accepted]', 'aria-checked')) === 'false');
  await p.click('[data-key=ho-st-handed]'); await p.waitForTimeout(400);
  let r = (await st()).readings.find(x => x.id === 'rnew');
  ok('«На перевірці» → handed, лишаємось на сторінці передачі, позначено', /#handover$/.test(p.url()) && r.status === 'handed' && !!r.handedAt && (await p.getAttribute('[data-key=ho-st-handed]', 'aria-checked')) === 'true', [p.url(), r.status]);
  ok('…тост і посилання «Не прийняли? Розберемо причину»', /на перевірці/.test(await p.textContent('#toast-host')) && await p.isVisible('[data-key=ho-st-bad]'));
  ok('…значення для копіювання на місці', await p.isVisible('[data-key=handover-values]'));
  await p.click('[data-key=ho-st-accepted]'); await p.waitForTimeout(400);
  r = (await st()).readings.find(x => x.id === 'rnew');
  ok('«Прийнято» → accepted, сторінка та сама, зелена плашка «Прийнято ХТМ»', /#handover$/.test(p.url()) && r.status === 'accepted' && r.result && r.result.via === 'self' && await p.isVisible('[data-key=ho-accepted]'), [p.url(), r]);
  ok('…фокус на обраному варіанті', (await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-key'))) === 'ho-st-accepted');
  await p.reload(); await p.waitForTimeout(500);
  ok('після перезавантаження — та сама сторінка з «Прийнято»', /#handover$/.test(p.url()) && (await p.getAttribute('[data-key=ho-st-accepted]', 'aria-checked')) === 'true');
  await p.click('[data-key=ho-st-handed]'); await p.waitForTimeout(300);
  r = (await st()).readings.find(x => x.id === 'rnew');
  ok('передумали: «На перевірці» знову → handed, результат знято', r.status === 'handed' && !r.result);
  await p.click('[data-key=ho-st-bad]'); await p.waitForTimeout(400);
  ok('«Не прийняли?» → екран статусу з розбором причини', /#status$/.test(p.url()) && await p.isVisible('[data-key=status-bad]'));
  // узко: 320 px — варианты не шире экрана
  await p.setViewportSize({ width: 320, height: 700 }); await p.goto(U + '#handover'); await p.waitForTimeout(500);
  ok('320 px: без горизонтальної прокрутки', await p.evaluate(() => document.documentElement.scrollWidth <= 320));
  ok('без помилок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
