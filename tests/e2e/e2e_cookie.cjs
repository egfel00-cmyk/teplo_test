// Баннер согласия на cookie (07.11.2026): при первом визите — «Прийняти все» / «Відхилити» / «Налаштувати»; до ответа аналитика не уходит
// (журнал /api/events и «открыли сайт» /api/visit — ни одного запроса, teplo.vid не создаётся); выбор записывается на сервере (/api/consent,
// таблица consents); изменить/отозвать — Налаштування (низ страницы), политика, подвал лендинга.
// node e2e_cookie.cjs  (локальный сервер 127.0.0.1:8013, SITE_DATA=/tmp/teplo_data)
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
const { execFileSync } = require('child_process');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/';
const sql = (q) => execFileSync('php', ['-r', '$d=new PDO("sqlite:/tmp/teplo_data/dev.sqlite"); echo json_encode($d->query(' + JSON.stringify(q) + ')->fetchAll(PDO::FETCH_ASSOC));']).toString();
(async () => {
  try { execFileSync('php', ['-r', '$d=new PDO("sqlite:/tmp/teplo_data/dev.sqlite"); @$d->exec("DELETE FROM rate_limits");']); } catch (e) { /* свежая база */ }
  const b = await chromium.launch();
  const mk = async (vp, scheme) => {
    const ctx = await b.newContext({ viewport: vp || { width: 390, height: 844 }, locale: 'uk-UA', colorScheme: scheme || 'light' });
    await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));   // иначе аналитика молчит и баннер не нужен
    const p = await ctx.newPage(); const net = []; const errs = [];
    p.on('request', r => { const u = r.url(); if (/\/api\/(events|visit|consent)$/.test(u)) net.push({ u: u.replace(/^.*\/api\//, ''), body: r.postData() }); });
    p.on('pageerror', e => errs.push(e.message));
    return { ctx, p, net, errs };
  };
  const ls = (p, k) => p.evaluate(k => localStorage.getItem(k), k);

  // 1. первый визит: баннер, до ответа — ничего
  let { ctx, p, net, errs } = await mk();
  await p.goto(U); await p.waitForTimeout(800);
  ok('перший візит: банер «Файли cookie»', await p.isVisible('[data-key=cc-banner]') && /Файли cookie/.test(await p.textContent('[data-key=cc-banner]')));
  const bA = await p.$eval('[data-key=cc-accept]', e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), getComputedStyle(e).backgroundColor, getComputedStyle(e).color]; });
  const bR = await p.$eval('[data-key=cc-reject]', e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), getComputedStyle(e).backgroundColor, getComputedStyle(e).color]; });
  ok('«Прийняти все» і «Відхилити» — однакові за розміром і виглядом', JSON.stringify(bA) === JSON.stringify(bR), [bA, bR]);
  ok('…є «Налаштувати» і «Докладніше» → політика', await p.isVisible('[data-key=cc-customize]') && (await p.getAttribute('[data-key=cc-more]', 'href')) === '#privacy');
  ok('«Відгук» сховано, поки банер на екрані', !(await p.$('[data-key=feedback]')));
  await p.click('[data-key=lp-cta]').catch(() => {}); await p.waitForTimeout(400); await p.goto(U + '#help'); await p.waitForTimeout(2600);
  ok('до відповіді: жодного запиту журналу й «відкрили сайт», teplo.vid немає', !net.some(x => x.u !== 'consent') && !(await ls(p, 'teplo.vid')), net.map(x => x.u));
  ok('банер лишається на інших екранах, доки не відповіли', await p.isVisible('[data-key=cc-banner]'));

  // 2. «Налаштувати» → выключено → «Зберегти вибір»
  await p.click('[data-key=cc-customize]'); await p.waitForTimeout(300);
  ok('«Налаштування cookie»: необхідні — «Завжди ввімкнені», аналітика вимкнена', await p.isVisible('[data-key=cc-dialog]') && /Завжди ввімкнені/.test(await p.textContent('[data-key=cc-cat-need]')) && !(await p.isChecked('[data-key=cc-analytics]')));
  ok('…фокус на перемикачі аналітики', (await p.evaluate(() => document.activeElement && document.activeElement.id)) === 'cc-an');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok('Esc закриває діалог, банер лишається', !(await p.$('[data-key=cc-dialog]')) && await p.isVisible('[data-key=cc-banner]'));
  await p.click('[data-key=cc-customize]'); await p.waitForTimeout(200);
  await p.click('[data-key=cc-save]'); await p.waitForTimeout(600);
  let c = JSON.parse(await ls(p, 'teplo.cc') || 'null');
  ok('«Зберегти вибір» без аналітики → teplo.cc a=0, банер зник, тост', c && c.a === 0 && c.v === 1 && !(await p.$('[data-key=cc-banner]')) && /лише необхідні/.test(await p.textContent('#toast-host')), c);
  const cr = net.filter(x => x.u === 'consent');
  ok('…вибір записано на сервері (POST /api/consent, how save, a 0)', cr.length === 1 && JSON.parse(cr[0].body).how === 'save' && JSON.parse(cr[0].body).a === 0, cr);
  ok('«Відгук» повернувся', await p.isVisible('[data-key=feedback]'));
  await p.goto(U + '#help'); await p.click('h1'); await p.goto(U + '#privacy'); await p.click('h1'); await p.waitForTimeout(4600);
  ok('відмовились: клацання не пишуться, teplo.vid немає', !net.some(x => x.u === 'events' || x.u === 'visit') && !(await ls(p, 'teplo.vid')), net.map(x => x.u));
  await p.reload(); await p.waitForTimeout(600);
  ok('після перезавантаження банера немає', !(await p.$('[data-key=cc-banner]')));

  // 3. изменить в Налаштуваннях: включить аналитику (Налаштування — у того, кто уже завёл счётчик)
  await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo({}));
  await p.goto(U + '#prefs'); await p.reload(); await p.waitForTimeout(600);
  ok('Налаштування: внизу «Налаштування cookie»', await p.isVisible('[data-key=prefs-cookie]'));
  await p.click('[data-key=prefs-cookie]'); await p.waitForTimeout(300);
  ok('…діалог показує поточний вибір «Зараз: лише необхідні»', /Зараз: лише необхідні/.test(await p.textContent('[data-key=cc-now]')));
  await p.click('label[for=cc-an]'); await p.click('[data-key=cc-save]'); await p.waitForTimeout(400);
  c = JSON.parse(await ls(p, 'teplo.cc'));
  ok('увімкнули аналітику → a=1, той самий id згоди, teplo.vid з’явився', c.a === 1 && c.id === JSON.parse(cr[0].body).id && !!(await ls(p, 'teplo.vid')), c);
  await p.click('[data-key=nav-history]'); await p.waitForTimeout(4800);
  ok('…журнал пішов на сервер', net.some(x => x.u === 'events'), net.map(x => x.u));

  // 4. отозвать: политика → «Налаштування cookie» → «Відхилити все»
  await p.goto(U + '#privacy'); await p.waitForTimeout(500);
  const pol = await p.textContent('main');
  ok('політика: розділ cookie — необхідні й аналітика, строки, без «без аналітичних трекерів»', /ts_sid/.test(pol) && /teplo\.vid/.test(pol) && /60 днів/.test(pol) && !/Без рекламних і аналітичних трекерів/.test(pol) && /07\.11\.2026/.test(pol));
  await p.click('[data-key=privacy-cookie]'); await p.waitForTimeout(300);
  await p.click('[data-key=cc-reject-all]'); await p.waitForTimeout(400);
  const n0 = net.filter(x => x.u === 'events').length;
  ok('відкликали → a=0, teplo.vid стерто', JSON.parse(await ls(p, 'teplo.cc')).a === 0 && !(await ls(p, 'teplo.vid')));
  await p.click('[data-key=nav-history]'); await p.click('[data-key=nav-prefs]'); await p.waitForTimeout(4800);
  ok('…після відкликання журнал більше не йде', net.filter(x => x.u === 'events').length === n0);
  const rows = JSON.parse(sql("SELECT cid, v, analytics, how, user_id FROM consents WHERE cid = '" + c.id + "' ORDER BY id"));
  ok('сервер: три записи згоди цього браузера (save 0 → save 1 → reject 0), без IP', rows.length === 3 && rows.map(r => r.how + r.analytics).join(',') === 'save0,save1,reject0' && !('ip' in rows[0]), rows);
  ok('без помилок JS (1)', !errs.length, errs);
  await ctx.close();

  // 5. «Прийняти все» на первом визите — досылаем накопленное с открытия страницы и отметку «открыли сайт»
  ({ ctx, p, net, errs } = await mk());
  await p.goto(U); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo({}));
  await p.goto(U + '#history'); await p.reload(); await p.waitForTimeout(2500);
  ok('з даними (показання): банер теж є, запитів аналітики немає', await p.isVisible('[data-key=cc-banner]') && !net.some(x => x.u !== 'consent'));
  await p.click('[data-key=cc-accept]'); await p.waitForTimeout(1200);
  const ev = net.filter(x => x.u === 'events').map(x => JSON.parse(x.body));
  ok('«Прийняти все» → одразу дослано накопичене з відкриття сторінки (open, screen)', ev.length >= 1 && ev[0].ev.some(e => e.n === 'open') && !!ev[0].vid, ev.map(e => e.ev.map(x => x.n)));
  ok('…і позначка «відкрили сайт»', net.some(x => x.u === 'visit' && JSON.parse(x.body).vid === ev[0].vid));
  ok('…тост «Аналітику ввімкнено», консент how accept', /Аналітику ввімкнено/.test(await p.textContent('#toast-host')) && JSON.parse(net.find(x => x.u === 'consent').body).how === 'accept');
  ok('без помилок JS (2)', !errs.length, errs);
  await ctx.close();

  // 6. «Відхилити» сразу; русский; лендинг: ссылка в подвале
  ({ ctx, p, net, errs } = await mk({ width: 320, height: 640 }, 'dark'));
  await p.goto(U); await p.waitForTimeout(700);
  ok('320 px: банер не ширший за екран, кнопки видно', await p.evaluate(() => { const r = document.querySelector('[data-key=cc-banner]').getBoundingClientRect(); return r.left >= 0 && r.right <= 320; }) && await p.isVisible('[data-key=cc-reject]'));
  await p.click('[data-key=cc-reject]'); await p.waitForTimeout(400);
  ok('«Відхилити» → a=0, how reject', JSON.parse(await ls(p, 'teplo.cc')).a === 0 && JSON.parse(net.find(x => x.u === 'consent').body).how === 'reject');
  const foot = await p.$('[data-key=lpf-cookie]');
  if (foot) { await foot.scrollIntoViewIfNeeded(); await foot.click(); await p.waitForTimeout(300); ok('лендинг: «Налаштування cookie» в підвалі відкриває діалог', await p.isVisible('[data-key=cc-dialog]')); await p.keyboard.press('Escape'); }
  else ok('лендинг: «Налаштування cookie» в підвалі', false, await p.evaluate(() => location.hash));
  ok('без помилок JS (3)', !errs.length, errs);
  await ctx.close();
  const ru = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' }); await ru.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => false }));
  const pr = await ru.newPage(); await pr.goto(U); await pr.waitForTimeout(700);
  ok('русский: «Файлы cookie», «Принять все» / «Отклонить» / «Настроить»', /Файлы cookie/.test(await pr.textContent('[data-key=cc-banner]')) && (await pr.textContent('[data-key=cc-accept]')) === 'Принять все' && (await pr.textContent('[data-key=cc-reject]')) === 'Отклонить');
  await ru.close();

  // 7. автотест (navigator.webdriver) — аналитика и так выключена, баннера нет
  const ctx7 = await b.newContext(); const p7 = await ctx7.newPage(); await p7.goto(U); await p7.waitForTimeout(600);
  ok('під автотестом банера немає (аналітика й так вимкнена)', !(await p7.$('[data-key=cc-banner]')));
  await ctx7.close();
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
