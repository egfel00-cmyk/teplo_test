// 190-я (власник 25.11: «после первой настройки — понятнее и явно: сохраниться через Telegram или свой аккаунт, чтобы не потерять данные
// и входить с других браузеров/устройств; сейчас не очевидно»): картка «Збережіть дані» на головній одразу після «Готово» (Telegram — головна кнопка,
// пошта — друга, «Пізніше» → рядок, що лишається; після перших показань — знову картка), «Зберегти через Telegram» — вхід У ЦЬОМУ браузері через бота:
// посилання t.me/<бот>?start=in_<t>, бот (вебхук) питає з кодом, «Так, увійти» → браузер у вході, лічильники браузера — в акаунті; «Ні, це не я» — без входу;
// інший браузер — «Увійти через Telegram» тим самим Telegram показує ті самі лічильники; гість з даними → Telegram, де вже є дані: відкрили дані акаунта, копія гостя — в браузері.
// Запуск: node tests/e2e/e2e_savetg.cjs (сервер піднімає сам, порт 8017; Telegram API з тестового токена відповідає помилкою — вебхук усе одно відпрацьовує).
const { chromium } = require('playwright'); const { spawn, execFileSync, execSync } = require('child_process'); const fs = require('fs');
const DIR = '/tmp/teplo_sv', PORT = 8017, BASE = `http://127.0.0.1:${PORT}`, BOT = 'peredai_com_ua_bot', SECRET = 'hook-secret-e2e';
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 500) : '')); } };
const hook = upd => fetch(BASE + '/api/bot/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': SECRET }, body: JSON.stringify(upd) }).then(r => r.status);
const rows = q => JSON.parse(execFileSync('php', ['-r', '$p = new PDO("sqlite:' + DIR + '/dev.sqlite"); echo json_encode($p->query($argv[1])->fetchAll(PDO::FETCH_ASSOC));', q]).toString() || '[]');
const sha = t => require('crypto').createHash('sha256').update(t).digest('hex');
const rowOf = t => rows("SELECT st, code FROM tg_logins WHERE token_hash = '" + sha(t) + "'")[0] || {};
const tok = href => (/\?start=in_([A-Za-z0-9_-]{24})$/.exec(href || '') || [])[1] || '';
const IRA = { id: 990001, first_name: 'Ірина', username: 'ira_sv', language_code: 'uk' };
const say = (from, text, mid) => hook({ update_id: Date.now(), message: { message_id: mid || 1, chat: { id: from.id, type: 'private' }, from, text } });
const press = (from, data) => hook({ update_id: Date.now(), callback_query: { id: 'cq' + Date.now(), data, from, message: { message_id: 2, chat: { id: from.id } } } });

(async () => {
  execSync(`rm -rf ${DIR} && mkdir -p ${DIR}`);
  fs.writeFileSync(DIR + '/config.php', `<?php return ['db' => ['dsn' => 'sqlite:${DIR}/dev.sqlite'], 'cookie_secure' => false, 'bot_token' => '123456:TEST-token', 'bot_username' => '${BOT}', 'webhook_secret' => '${SECRET}',
  'app_url' => '${BASE}/', 'limits' => ['ip_all' => [2000, 60], 'tgin_ip' => [200, 3600], 'tgpoll_ip' => [5000, 3600], 'telegram_ip' => [200, 300], 'state_user' => [600, 60]]];\n`);
  const srv = spawn('php', ['-S', '127.0.0.1:' + PORT, 'index.php'], { cwd: __dirname + '/../..', env: Object.assign({}, process.env, { SITE_BASE: '', SITE_DATA: DIR }), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 900));
  const b = await chromium.launch(); const errs = [];
  const newPage = async (w, h, ua) => {
    const ctx = await b.newContext(Object.assign({ viewport: { width: w || 390, height: h || 844 }, locale: 'uk-UA' }, ua ? { userAgent: ua } : {}));
    await ctx.route('https://t.me/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>Telegram</p>' }));   // посилання на бота відкривається само — тут заглушка
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error' && !/ERR_|40[13]|410|429|telegram\.org/.test(m.text())) errs.push(m.text()); });
    return { ctx, p };
  };
  const st = p => p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1') || '{}'));
  const txt = (p, s) => p.textContent(s).catch(() => '');
  const setup = async (p, kinds) => {   // перший вхід: #start → лічильники → «Готово»
    await p.goto(BASE + '/#start'); await p.waitForSelector('[data-key=aw-create]');
    for (const k of kinds) { await p.click('[data-key=aw-' + k + '-inc]'); await p.waitForTimeout(120); }
    await p.click('[data-key=aw-create]'); await p.waitForTimeout(700);
  };
  const tgSave = async (p, from, sel) => {   // «Зберегти через Telegram» → бот: «Старт» і «Так, увійти»
    await p.waitForSelector(sel); const t = tok(await p.getAttribute(sel, 'href'));
    const [pop] = await Promise.all([p.context().waitForEvent('page', { timeout: 3000 }).catch(() => null), p.click(sel)]); if (pop) await pop.close();
    await p.waitForSelector('[data-key=tg-code]', { timeout: 5000 }).catch(() => null);
    return t;
  };
  try {
    // 1. перший вхід: картка одразу після «Готово», вгорі головної
    const A = await newPage(); const p = A.p;
    await setup(p, ['cold', 'elec']);
    ok('після «Готово» — головна з карткою «Збережіть дані» над квартирою', /#home/.test(p.url()) && /Збережіть дані/.test(await txt(p, '[data-key=save-card] h2'))
      && await p.evaluate(() => { const c = document.querySelector('[data-key=save-card]'), u = document.querySelector('.ucard'); return !!(c && u && (c.compareDocumentPosition(u) & Node.DOCUMENT_POSITION_FOLLOWING)); }));
    ok('пояснення: дані лише в цьому браузері, можуть зникнути, збережіть — будуть на всіх пристроях', /лише в цьому браузері/.test(await txt(p, '[data-key=save-card]')) && /на всіх ваших пристроях/.test(await txt(p, '[data-key=save-card]')));
    const href = await p.getAttribute('[data-key=sv-tg]', 'href');
    ok('Telegram — головна кнопка (не sec), посилання t.me/<бот>?start=in_<24>; пошта — друга; «Пізніше»', /^https:\/\/t\.me\/peredai_com_ua_bot\?start=in_[A-Za-z0-9_-]{24}$/.test(href)
      && !/\bsec\b/.test(await p.getAttribute('[data-key=sv-tg]', 'class')) && /\bsec\b/.test(await p.getAttribute('[data-key=sv-mail]', 'class'))
      && /Зберегти через Telegram/.test(await txt(p, '[data-key=sv-tg]')) && /Зберегти через пошту/.test(await txt(p, '[data-key=sv-mail]')) && /Пізніше/.test(await txt(p, '[data-key=sv-later]')), href);
    ok('кнопки ≥ 48 px', await p.$$eval('[data-key=sv-tg], [data-key=sv-mail]', a => a.every(e => e.getBoundingClientRect().height >= 48)));
    ok('191-а: посилання зареєстроване заздалегідь — рядок «pre» ще до натискання (вбудовані браузери обривали запит після дотику)', await p.waitForFunction(t => !!t, tok(href)).then(() => p.waitForTimeout(400)).then(() => rowOf(tok(href)).st === 'pre'), rows('SELECT st FROM tg_logins'));
    // 2. «Пізніше» → рядок, що лишається; після перших показань — картка знову; на сторінці лічильника з показаннями — рядок
    await p.click('[data-key=sv-later]'); await p.waitForTimeout(300);
    ok('«Пізніше» → замість картки рядок «Дані лише в цьому браузері» з «Зберегти»', !(await p.$('[data-key=save-card]')) && /лише в цьому браузері/.test(await txt(p, '[data-key=save-strip]')) && !!(await p.$('[data-key=sv-open]')));
    await p.reload(); await p.waitForTimeout(800);
    ok('після перезавантаження — так само рядок', !(await p.$('[data-key=save-card]')) && !!(await p.$('[data-key=save-strip]')));
    await p.click('[data-key=sv-open]'); await p.waitForTimeout(300);
    ok('«Зберегти» в рядку розгортає картку', !!(await p.$('[data-key=save-card] [data-key=sv-tg]')));
    await p.click('[data-key=sv-later]'); await p.waitForTimeout(200);
    { const s = await st(p), cold = s.places[0].water.meters.find(m => m.kind === 'cold');
      s.water = [{ id: 'wsv1', place: s.placeId || s.places[0].id, date: new Date().toISOString().slice(0, 10), vals: { [cold.id]: '123' }, createdAt: new Date().toISOString(), updatedAt: Date.now(), sent: {} }];
      await p.evaluate(x => localStorage.setItem('teplo.v1', JSON.stringify(x)), s); await p.reload(); await p.waitForTimeout(800); }
    ok('з’явились перші показання (відклали до них) — знову картка', !!(await p.$('[data-key=save-card]')));
    await p.goto(BASE + '/#water-cold'); await p.waitForTimeout(600);
    ok('сторінка холодної води з показаннями — рядок «Дані лише в цьому браузері»', /лише в цьому браузері/.test(await txt(p, '[data-key=save-strip]')));
    await p.goto(BASE + '/#home'); await p.waitForTimeout(500);
    // 3. «Зберегти через Telegram»: очікування з кодом → бот питає → «Так, увійти» → вхід у цьому браузері, лічильники в акаунті
    const t1 = await tgSave(p, IRA, '[data-key=sv-tg]');
    const code = (await txt(p, '[data-key=tg-code]')).trim();
    ok('натиснули — «Чекаємо підтвердження в Telegram», кроки «Старт» → «Так, увійти», код 4 цифри; сервер — рядок new', /Чекаємо підтвердження/.test(await txt(p, '[data-key=tg-wait]'))
      && /@peredai_com_ua_bot/.test(await txt(p, '[data-key=tg-wait]')) && /Так, увійти/.test(await txt(p, '[data-key=tg-wait]')) && /^\d{4}$/.test(code)
      && rowOf(t1).st === 'new' && rowOf(t1).code === code, [code, rows('SELECT st, code FROM tg_logins')]);
    ok('«Відкрити Telegram ще раз» — те саме посилання; «Скасувати»', tok(await p.getAttribute('[data-key=tg-again]', 'href')) === t1 && !!(await p.$('[data-key=tg-cancel]')));
    ok('очікування переживає перезавантаження сторінки (повернулись з Telegram)', await (async () => { await p.reload(); await p.waitForTimeout(900); return (await txt(p, '[data-key=tg-code]')).trim() === code; })());
    await say(IRA, '/start in_' + t1); await p.waitForTimeout(400);
    ok('бот показав питання — сервер seen, вхід ще не дано', rowOf(t1).st === 'seen' && await p.evaluate(() => !window.TeploSync.account));
    await press(IRA, 'li:' + t1);
    await p.waitForFunction(() => window.TeploSync && window.TeploSync.account, null, { timeout: 8000 }).catch(() => null);
    await p.waitForTimeout(1500);
    const acc = await p.evaluate(() => window.TeploSync.account);
    ok('«Так, увійти» → браузер у вході тим Telegram, тост «Збережено», картки й рядка більше немає', acc && acc.telegram && String(acc.telegram.id) === '990001' && /Збережено/.test(await txt(p, '#toast-host'))
      && !(await p.$('[data-key=save-card]')) && !(await p.$('[data-key=save-strip]')), acc);
    const uid = acc && acc.id;
    await p.waitForTimeout(1500);
    const srvSt = JSON.parse((rows('SELECT data FROM user_state WHERE user_id = ' + (+uid || 0))[0] || {}).data || '{}');
    const coldId = ((((srvSt.places || [])[0] || {}).water || {}).meters || []).filter(m => m.kind === 'cold').map(m => m.id)[0];
    ok('лічильники й показання браузера — на сервері в акаунті', !!coldId && (srvSt.water || []).some(r => r.id === 'wsv1') && (srvSt.places[0].meters || []).some(m => m.kind === 'elec'), srvSt.places);
    await p.goto(BASE + '/#prefs-acc'); await p.waitForTimeout(500);
    ok('Налаштування → Акаунт: Telegram @ira_sv', /@ira_sv/.test(await txt(p, '[data-key=prefs-sync]')));
    // 4. інший браузер: «Увійти через Telegram» тим самим Telegram → ті самі лічильники
    const C = await newPage(1280, 900);
    await C.p.goto(BASE + '/#login'); await C.p.waitForTimeout(900);
    const t3 = await tgSave(C.p, IRA, '[data-key=login-tg-open]');
    ok('вхід: та сама кнопка веде в бота з посиланням цього браузера, очікування з кодом', !!t3 && t3 !== t1 && /^\d{4}$/.test((await txt(C.p, '[data-key=tg-code]')).trim()));
    await say(IRA, '/start in_' + t3); await press(IRA, 'li:' + t3);
    await C.p.waitForFunction(() => window.TeploSync && window.TeploSync.account, null, { timeout: 8000 }).catch(() => null); await C.p.waitForTimeout(1500);
    const sC = await st(C.p);
    ok('інший браузер: вхід, головна з тими самими лічильниками', /#home/.test(C.p.url()) && (((sC.places || [])[0] || {}).water || { meters: [] }).meters.some(m => m.id === coldId), [C.p.url(), sC.places]);
    // 5. «Ні, це не я» — без входу; «Скасувати» → знову кнопки
    const B = await newPage();
    await setup(B.p, ['gas']);
    const t2 = await tgSave(B.p, IRA, '[data-key=sv-tg]');
    await say({ id: 990002, first_name: 'Інший', language_code: 'uk' }, '/start in_' + t2); await press({ id: 990002, first_name: 'Інший', language_code: 'uk' }, 'lx:' + t2);
    await B.p.waitForSelector('[data-key=tg-wait-no]', { timeout: 8000 }).catch(() => null);
    ok('«Ні, це не я» → «Вхід не підтверджено», браузер без входу, акаунта 990002 немає', /не підтверджено/.test(await txt(B.p, '[data-key=tg-wait-no]')) && await B.p.evaluate(() => !window.TeploSync.account)
      && rows("SELECT COUNT(*) AS n FROM user_identities WHERE external_id = '990002'")[0].n === 0);
    await B.p.click('[data-key=tg-cancel]'); await B.p.waitForTimeout(300);
    ok('«Скасувати» → знову «Зберегти через Telegram» з новим посиланням', !!(await B.p.$('[data-key=sv-tg]')) && tok(await B.p.getAttribute('[data-key=sv-tg]', 'href')) !== t2);
    // 6. гість з даними → Telegram, де вже є дані: відкрили дані акаунта, внесене без входу — копією в браузері, тост
    const t4 = await tgSave(B.p, IRA, '[data-key=sv-tg]');
    await say(IRA, '/start in_' + t4); await press(IRA, 'li:' + t4);
    await B.p.waitForFunction(() => window.TeploSync && window.TeploSync.account, null, { timeout: 8000 }).catch(() => null); await B.p.waitForTimeout(1500);
    const sB = await st(B.p), bak = await B.p.evaluate(() => JSON.parse(localStorage.getItem('teplo.guestBak') || 'null'));
    ok('акаунт уже з даними: відкрили їх (холодна з першого браузера), тост «уже були дані», газ гостя — копією teplo.guestBak', /уже були дані/.test(await txt(B.p, '#toast-host'))
      && (((sB.places || [])[0] || {}).water || { meters: [] }).meters.some(m => m.id === coldId) && bak && bak.state && JSON.stringify(bak.state.places).includes('"gas"'), [sB.places, bak && bak.at]);
    // 7. на широкому — дві колонки (текст | кнопки), без горизонтальної прокрутки на 320
    const D = await newPage(1280, 900);
    await setup(D.p, ['hot']);
    const cols = await D.p.$eval('[data-key=save-card] .sv-g', g => getComputedStyle(g).gridTemplateColumns.split(' ').length);
    ok('1280: картка — дві колонки (текст ліворуч, кнопки праворуч)', cols === 2, cols);
    await D.p.setViewportSize({ width: 320, height: 700 }); await D.p.waitForTimeout(300);
    ok('320: картка в одну колонку, сторінка не ширша за екран', await D.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth) && await D.p.$eval('[data-key=save-card] .sv-g', g => getComputedStyle(g).gridTemplateColumns.split(' ').length) === 1);
    // 8. 191-а: вбудований браузер Threads на iPhone — дотик іде на t.me у тій самій вкладці, запит «натиснули» обривається; бот однаково питає, вхід удається
    const M = await newPage(390, 844, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Barcelona 334.0.0.0');
    await M.p.route('**/api/auth/tg/start', r => { const b = JSON.parse(r.request().postData() || '{}'); return b.pre ? r.continue() : r.abort('aborted'); });
    await setup(M.p, ['cold']);
    await M.p.waitForSelector('[data-key=sv-tg]'); const t5 = tok(await M.p.getAttribute('[data-key=sv-tg]', 'href')); await M.p.waitForTimeout(500);
    ok('Threads/iPhone: до дотику — «pre», посилання в тій самій вкладці (без target)', rowOf(t5).st === 'pre' && !(await M.p.getAttribute('[data-key=sv-tg]', 'target')));
    await Promise.all([M.p.waitForURL(/t\.me/, { timeout: 5000 }).catch(() => null), M.p.click('[data-key=sv-tg]')]);
    ok('дотик → t.me у тій самій вкладці; «натиснули» не долетів — рядок лишився «pre»', /t\.me\/peredai_com_ua_bot\?start=in_/.test(M.p.url()) && rowOf(t5).st === 'pre', [M.p.url(), rowOf(t5)]);
    await M.p.goBack(); await M.p.waitForTimeout(1200);
    await say(IRA, '/start in_' + t5, 31); await M.p.waitForTimeout(300);
    ok('бот на /start — питання «Так, увійти» (не «застаріло»), рядок seen', rowOf(t5).st === 'seen');
    await press(IRA, 'li:' + t5);
    await M.p.waitForFunction(() => window.TeploSync && window.TeploSync.account, null, { timeout: 9000 }).catch(() => null);
    ok('повернулись у Threads — вхід у цьому браузері (акаунт є)', await M.p.evaluate(() => !!(window.TeploSync && window.TeploSync.account)));
    // 9. реєстрація не вдалась (немає мережі до дотику) — дотик чекає реєстрацію і лише тоді веде на t.me; не вдалось — помилка на місці, без переходу
    const N = await newPage(390, 844, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Barcelona 334.0.0.0');
    let block = true; await N.p.route('**/api/auth/tg/start', r => block ? r.abort('failed') : r.continue());
    await setup(N.p, ['cold']); await N.p.waitForSelector('[data-key=sv-tg]'); await N.p.waitForTimeout(400);
    await N.p.click('[data-key=sv-tg]'); await N.p.waitForTimeout(800);
    ok('реєстрація не вдалась — лишились на сайті, «Не вдалося почати» з повтором', !/t\.me/.test(N.p.url()) && !!(await N.p.$('[data-key=tg-wait-err]')) && !!(await N.p.$('[data-key=tg-retry]')));
    block = false; const t6 = tok(await N.p.getAttribute('[data-key=tg-retry]', 'href')); await N.p.waitForTimeout(600);
    await Promise.all([N.p.waitForURL(/t\.me/, { timeout: 5000 }).catch(() => null), N.p.click('[data-key=tg-retry]')]);
    ok('мережа є — повтор: зареєстровано й перейшли на t.me', /t\.me/.test(N.p.url()) && /^(pre|new)$/.test(rowOf(t6).st || ''), [N.p.url(), rowOf(t6)]);
    // 10. 191-в: вбудований браузер Threads на iPhone не зберігає cookie (журнал 26.11: «403:csrf») — вхід через бота без cookie, далі X-Session
    const NC = await newPage(390, 844, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Barcelona 334.0.0.0');
    await NC.p.context().route(BASE + '/**', async r => { const res = await r.fetch(); const h = Object.assign({}, res.headers()); delete h['set-cookie']; return r.fulfill({ response: res, headers: h }); });
    await NC.p.addInitScript(() => { Object.defineProperty(Document.prototype, 'cookie', { get() { return ''; }, set() {}, configurable: true }); });
    await setup(NC.p, ['cold']); await NC.p.waitForSelector('[data-key=sv-tg]');
    const t7 = tok(await NC.p.getAttribute('[data-key=sv-tg]', 'href')); await NC.p.waitForTimeout(700);
    ok('без cookie: посилання зареєстроване заздалегідь (не 403 csrf)', rowOf(t7).st === 'pre', rowOf(t7));
    await Promise.all([NC.p.waitForURL(/t\.me/, { timeout: 5000 }).catch(() => null), NC.p.click('[data-key=sv-tg]')]);
    ok('без cookie: дотик → t.me', /t\.me\/peredai_com_ua_bot\?start=in_/.test(NC.p.url()), NC.p.url());
    await NC.p.goBack(); await NC.p.waitForTimeout(1000);
    await say(IRA, '/start in_' + t7, 41); await press(IRA, 'li:' + t7);
    await NC.p.waitForFunction(() => window.TeploSync && window.TeploSync.account, null, { timeout: 9000 }).catch(() => null);
    ok('без cookie: «Так, увійти» → вхід у цьому браузері, сесія токеном (sessionStorage teplo.tgs)', await NC.p.evaluate(() => !!(window.TeploSync && window.TeploSync.account) && !!sessionStorage.getItem('teplo.tgs')));
    await NC.p.reload(); await NC.p.waitForTimeout(1500);
    ok('без cookie: після перезавантаження — і далі з акаунтом', await NC.p.evaluate(() => !!(window.TeploSync && window.TeploSync.account)));
    ok('журнал /api/health → tgin: почали 7, підтвердили 5, «не я» 1', (h => h && h.n === 7 && h.ok === 5 && h.used === 5 && h.no === 1)((await (await fetch(BASE + '/api/health')).json()).tgin), (await (await fetch(BASE + '/api/health')).json()).tgin);
    ok('без помилок JS', !errs.length, errs);
  } catch (e) { fail++; console.log(' FAIL виняток', e && e.stack); }
  await b.close(); srv.kill();
  console.log(`\nИтог: ${pass} ok, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})();
