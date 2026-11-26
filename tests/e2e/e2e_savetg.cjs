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
const rowOf = t => rows("SELECT st, code6 AS code, expires_at FROM tg_logins WHERE token_hash = '" + sha(t) + "'")[0] || {};
const tok = href => (/[?&]start=in_([A-Za-z0-9_-]{24})$/.exec(href || '') || [])[1] || '';
const IRA = { id: 990001, first_name: 'Ірина', username: 'ira_sv', language_code: 'uk' };
const say = (from, text, mid) => hook({ update_id: Date.now(), message: { message_id: mid || 1, chat: { id: from.id, type: 'private' }, from, text } });
const press = (from, data) => hook({ update_id: Date.now(), callback_query: { id: 'cq' + Date.now(), data, from, message: { message_id: 2, chat: { id: from.id } } } });

(async () => {
  execSync(`rm -rf ${DIR} && mkdir -p ${DIR}`);
  fs.writeFileSync(DIR + '/config.php', `<?php return ['db' => ['dsn' => 'sqlite:${DIR}/dev.sqlite'], 'cookie_secure' => false, 'bot_token' => '123456:TEST-token', 'bot_username' => '${BOT}', 'webhook_secret' => '${SECRET}',
  'app_url' => '${BASE}/', 'limits' => ['ip_all' => [2000, 60], 'tgin_ip' => [200, 3600], 'tgpre_ip' => [400, 3600], 'tgpoll_ip' => [5000, 3600], 'tgcode_u' => [10, 3600], 'tgcode_bad' => [300, 3600], 'telegram_ip' => [200, 300], 'state_user' => [600, 60]]];\n`);
  const srv = spawn('php', ['-S', '127.0.0.1:' + PORT, 'index.php'], { cwd: __dirname + '/../..', env: Object.assign({}, process.env, { SITE_BASE: '', SITE_DATA: DIR }), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 900));
  const b = await chromium.launch(); const errs = [];
  const newPage = async (w, h, ua) => {
    const ctx = await b.newContext(Object.assign({ viewport: { width: w || 390, height: h || 844 }, locale: 'uk-UA' }, ua ? { userAgent: ua } : {}));
    await ctx.route('https://t.me/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>Telegram</p>' }));   // посилання на бота відкривається само — тут заглушка
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error' && !/ERR_|40[13]|410|429|telegram\.org|Failed to launch 'tg:/.test(m.text())) errs.push(m.text()); });
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
    ok('натиснули — «Чекаємо підтвердження в Telegram», кроки «Старт» → «Так, увійти», код 6 цифр «482 913»; сервер — рядок new', /Чекаємо підтвердження/.test(await txt(p, '[data-key=tg-wait]'))
      && /@peredai_com_ua_bot/.test(await txt(p, '[data-key=tg-wait]')) && /Так, увійти/.test(await txt(p, '[data-key=tg-wait]')) && /^\d{3} \d{3}$/.test(code)
      && rowOf(t1).st === 'new' && rowOf(t1).code === code.replace(' ', ''), [code, rows('SELECT st, code FROM tg_logins')]);
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
    ok('вхід: та сама кнопка веде в бота з посиланням цього браузера, очікування з кодом', !!t3 && t3 !== t1 && /^\d{3} \d{3}$/.test((await txt(C.p, '[data-key=tg-code]')).trim()));
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
    // 8. 191-а/192-а: вбудований браузер Threads на iPhone (UA «Barcelona», без «Safari/»). Журнал 26.11 15:29: дотик → t.me відкрилась усередині Threads, «Старт» у боті
    // так і не настав. Тепер: посилання tg:// (сторінка лишається), запит «натиснули» може обірватись (pre вже є); Telegram не відкрився — код руками
    const UA_TH = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22A3354 Barcelona 352.0.0.20.86 (iPhone15,2; iOS 18_0; uk_UA)';
    const UA_SF = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const M = await newPage(390, 844, UA_TH);
    await M.p.route('**/api/auth/tg/start', r => { const b = JSON.parse(r.request().postData() || '{}'); return b.pre ? r.continue() : r.abort('aborted'); });
    await setup(M.p, ['cold']);
    await M.p.waitForSelector('[data-key=sv-tg]'); const hrefM = await M.p.getAttribute('[data-key=sv-tg]', 'href'), t5 = tok(hrefM); await M.p.waitForTimeout(500);
    ok('Threads/iPhone: до дотику — «pre»; посилання tg://resolve?domain=<бот>&start=in_<t> у тій самій вкладці', rowOf(t5).st === 'pre' && /^tg:\/\/resolve\?domain=peredai_com_ua_bot&start=in_[A-Za-z0-9_-]{24}$/.test(hrefM)
      && !(await M.p.getAttribute('[data-key=sv-tg]', 'target')), [hrefM, rowOf(t5)]);
    await M.p.click('[data-key=sv-tg]');
    await M.p.waitForSelector('[data-key=tg-nf].on', { timeout: 6000 }).catch(() => null);
    const code5 = (await txt(M.p, '[data-key=tg-code]')).trim();
    ok('Telegram не відкрився (сторінка лишилась на екрані 2,5 с) — плашка «цей браузер не пускає в інші застосунки», бот і код руками, «Скопіювати код»', M.p.url().startsWith(BASE)
      && /не пускає в інші застосунки/.test(await txt(M.p, '[data-key=tg-nf]')) && (await txt(M.p, '[data-key=tg-nf]')).includes('@peredai_com_ua_bot') && (await txt(M.p, '[data-key=tg-nf]')).includes(code5)
      && !!(await M.p.$('[data-key=tg-nf-copy]')), [M.p.url(), await txt(M.p, '[data-key=tg-wait]')]);
    await M.p.waitForTimeout(3500);
    ok('«натиснули» обірвався, але опит (лише після дотику) зробив рядок «new» — код руками приймається', rowOf(t5).st === 'new', rowOf(t5));
    await M.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    await M.p.click('[data-key=tg-nf-copy]'); await M.p.waitForTimeout(300);
    ok('«Скопіювати код» — у буфері 6 цифр без пробілу, тост «Скопійовано»', (await M.p.evaluate(() => navigator.clipboard.readText().catch(() => ''))) === code5.replace(' ', '') && /Скопійовано/.test(await txt(M.p, '#toast-host')));
    await say(IRA, '/start', 30); await say(IRA, code5, 31); await M.p.waitForTimeout(300);
    ok('людина сама відкрила Telegram і надіслала код — бот питає «Так, увійти» (рядок seen)', rowOf(t5).st === 'seen');
    const cb5 = 'ly:' + sha(t5).slice(0, 24); await press(IRA, cb5);
    await M.p.waitForFunction(() => window.TeploSync && window.TeploSync.account, null, { timeout: 9000 }).catch(() => null);
    ok('повернулись у Threads — вхід у цьому браузері (акаунт є), очікування зникло', await M.p.evaluate(() => !!(window.TeploSync && window.TeploSync.account)) && !(await M.p.$('[data-key=tg-wait]')));
    // 8б. той самий Threads, але Telegram відкрився (сторінка втратила фокус) — без плашки «не відкрився»; «Старт» з посиланням і «Так» — вхід
    const M2 = await newPage(390, 844, UA_TH);
    await setup(M2.p, ['gas']); await M2.p.waitForSelector('[data-key=sv-tg]'); const t5b = tok(await M2.p.getAttribute('[data-key=sv-tg]', 'href')); await M2.p.waitForTimeout(500);
    await M2.p.click('[data-key=sv-tg]'); await M2.p.evaluate(() => window.dispatchEvent(new Event('blur'))); await M2.p.waitForTimeout(3200);
    ok('Telegram відкрився — плашки «не відкрився» немає, тихий рядок про код є', !(await M2.p.$('[data-key=tg-nf].on')) && !!(await M2.p.$('[data-key=tg-nf]')));
    await say(IRA, '/start in_' + t5b, 32); await press(IRA, 'li:' + t5b);
    await M2.p.waitForFunction(() => window.TeploSync && window.TeploSync.account, null, { timeout: 9000 }).catch(() => null);
    ok('Threads, Telegram відкрився: «Так, увійти» → вхід', await M2.p.evaluate(() => !!(window.TeploSync && window.TeploSync.account)));
    // 9. Safari iPhone: реєстрація не вдалась (немає мережі до дотику) — дотик чекає реєстрацію і лише тоді веде на t.me; не вдалось — помилка на місці, без переходу
    const N = await newPage(390, 844, UA_SF);
    let block = true; await N.p.route('**/api/auth/tg/start', r => block ? r.abort('failed') : r.continue());
    await setup(N.p, ['cold']); await N.p.waitForSelector('[data-key=sv-tg]'); await N.p.waitForTimeout(400);
    ok('Safari iPhone: посилання https://t.me (універсальне — відкриває Telegram), та сама вкладка', /^https:\/\/t\.me\/peredai_com_ua_bot\?start=in_/.test(await N.p.getAttribute('[data-key=sv-tg]', 'href')) && !(await N.p.getAttribute('[data-key=sv-tg]', 'target')));
    await N.p.click('[data-key=sv-tg]'); await N.p.waitForTimeout(800);
    ok('реєстрація не вдалась — лишились на сайті, «Не вдалося почати» з повтором', !/t\.me/.test(N.p.url()) && !!(await N.p.$('[data-key=tg-wait-err]')) && !!(await N.p.$('[data-key=tg-retry]')));
    block = false; const t6 = tok(await N.p.getAttribute('[data-key=tg-retry]', 'href')); await N.p.waitForTimeout(600);
    await Promise.all([N.p.waitForURL(/t\.me/, { timeout: 5000 }).catch(() => null), N.p.click('[data-key=tg-retry]')]);
    ok('мережа є — повтор: зареєстровано й перейшли на t.me', /t\.me/.test(N.p.url()) && /^(pre|new)$/.test(rowOf(t6).st || ''), [N.p.url(), rowOf(t6)]);
    await N.p.goBack(); await N.p.waitForTimeout(1000);
    ok('повернулись з t.me «Назад» — знову очікування з тим самим кодом (bfcache чи перезавантаження)', !!(await N.p.$('[data-key=tg-wait]')) && tok(await N.p.getAttribute('[data-key=tg-again]', 'href')) === t6);
    await say(IRA, '/start in_' + t6, 33); await press(IRA, 'li:' + t6);
    await N.p.waitForFunction(() => window.TeploSync && window.TeploSync.account, null, { timeout: 9000 }).catch(() => null);
    ok('Safari: «Так, увійти» → вхід після повернення', await N.p.evaluate(() => !!(window.TeploSync && window.TeploSync.account)));
    // 9б. мережа «висить» (запит без відповіді) — через 8 с помилка з повтором, не вічна крутилка
    const H = await newPage(390, 844, UA_SF);
    await H.p.route('**/api/auth/tg/start', () => { /* без відповіді */ });
    await setup(H.p, ['cold']); await H.p.waitForSelector('[data-key=sv-tg]'); await H.p.click('[data-key=sv-tg]');
    await H.p.waitForSelector('[data-key=tg-wait-err]', { timeout: 11000 }).catch(() => null);
    ok('реєстрація «зависла» — за 8 с «Не вдалося почати» з повтором, сторінка на місці', !!(await H.p.$('[data-key=tg-wait-err]')) && H.p.url().startsWith(BASE));
    // 10. 191-в: вбудований браузер без cookie (Threads: «403:csrf») — вхід через бота без cookie, далі X-Session; 192-а: токен і в localStorage — після закриття вбудованого браузера
    const NC = await newPage(390, 844, UA_TH);
    await NC.p.context().route(BASE + '/**', async r => { const res = await r.fetch(); const h = Object.assign({}, res.headers()); delete h['set-cookie']; return r.fulfill({ response: res, headers: h }); });
    await NC.p.context().addInitScript(() => { Object.defineProperty(Document.prototype, 'cookie', { get() { return ''; }, set() {}, configurable: true }); });
    await setup(NC.p, ['cold']); await NC.p.waitForSelector('[data-key=sv-tg]');
    const t7 = tok(await NC.p.getAttribute('[data-key=sv-tg]', 'href')); await NC.p.waitForTimeout(700);
    ok('без cookie: посилання зареєстроване заздалегідь (не 403 csrf)', rowOf(t7).st === 'pre', rowOf(t7));
    await NC.p.click('[data-key=sv-tg]'); await NC.p.evaluate(() => window.dispatchEvent(new Event('blur')));
    await say(IRA, '/start in_' + t7, 41); await press(IRA, 'li:' + t7);
    await NC.p.waitForFunction(() => window.TeploSync && window.TeploSync.account, null, { timeout: 9000 }).catch(() => null);
    ok('без cookie: «Так, увійти» → вхід, сесія токеном (sessionStorage і localStorage teplo.tgs)', await NC.p.evaluate(() => !!(window.TeploSync && window.TeploSync.account) && !!sessionStorage.getItem('teplo.tgs') && localStorage.getItem('teplo.tgs') === sessionStorage.getItem('teplo.tgs')));
    await NC.p.reload(); await NC.p.waitForTimeout(1500);
    ok('без cookie: після перезавантаження — і далі з акаунтом', await NC.p.evaluate(() => !!(window.TeploSync && window.TeploSync.account)));
    const NC2 = await NC.ctx.newPage(); await NC2.goto(BASE + '/#home'); await NC2.waitForTimeout(1800);
    ok('без cookie: вбудований браузер закрили й відкрили знову (нова сторінка, sessionStorage порожній) — з акаунтом, картки «Збережіть дані» немає', await NC2.evaluate(() => !!(window.TeploSync && window.TeploSync.account)) && !(await NC2.$('[data-key=save-card]')));
    // 11. відповідь «ok» загубилась (iPhone щойно повернувся з Telegram — «network connection was lost»): сервер уже видав вхід — наступний опит за 2 хв отримує його знову
    const L = await newPage(390, 844, UA_SF);
    let lost = 0; await L.p.route('**/api/auth/tg/poll', async r => { const res = await r.fetch(); const j = await res.json().catch(() => ({})); if (j.state === 'ok' && !lost) { lost = 1; return r.abort('connectionreset'); } return r.fulfill({ response: res }); });
    await setup(L.p, ['elec']); const t8 = await tgSave(L.p, IRA, '[data-key=sv-tg]').catch(() => '');
    const t8b = t8 || tok(await L.p.getAttribute('[data-key=tg-again]', 'href'));
    await L.p.goBack().catch(() => null); await L.p.waitForTimeout(800);
    await say(IRA, '/start in_' + t8b, 51); await press(IRA, 'li:' + t8b);
    await L.p.waitForFunction(() => window.TeploSync && window.TeploSync.account, null, { timeout: 12000 }).catch(() => null);
    ok('перша відповідь «ok» обірвалась — вхід однаково є (повтор у межах 2 хв), без «посилання вже не діє»', lost === 1 && await L.p.evaluate(() => !!(window.TeploSync && window.TeploSync.account)) && !(await L.p.$('[data-key=tg-wait-exp]')), [lost, rowOf(t8b)]);
    // 12. посилання за браузером: звичайні — https://t.me (iPhone, Android — та сама вкладка; комп’ютер — нова), вбудовані застосунків — tg:// (та сама вкладка)
    const UAS = [
      ['Safari iPhone', UA_SF, 'https', ''], ['Chrome iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1', 'https', ''],
      ['Firefox iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15', 'https', ''],
      ['Chrome Android', 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36', 'https', ''],
      ['Samsung Internet', 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36', 'https', ''],
      ['Firefox Android', 'Mozilla/5.0 (Android 14; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0', 'https', ''],
      ['Instagram iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 360.0.0.30.109 (iPhone15,2; iOS 18_0; uk_UA)', 'tg', ''],
      ['Facebook iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/490.0.0.40.103;FBBV/1;FBDV/iPhone15,2]', 'tg', ''],
      ['Viber iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Viber/24.5.0', 'tg', ''],
      ['TikTok Android', 'Mozilla/5.0 (Linux; Android 14; SM-S918B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 musical_ly_2023709030 BytedanceWebview/d8a21c6', 'tg', ''],
      ['Instagram Android', 'Mozilla/5.0 (Linux; Android 14; SM-S918B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 Instagram 360.0.0.30.109 Android', 'tg', ''],
      ['Telegram iPhone (вбудований)', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', 'tg', ''],
      ['Chrome Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', 'https', '_blank'],
      ['Safari Mac', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'https', '_blank']];
    const bad = [];
    for (const [nm, ua, sch, tgt] of UAS) {
      const X = await newPage(390, 844, ua); await setup(X.p, ['cold']); await X.p.waitForSelector('[data-key=sv-tg]').catch(() => null);
      const h = await X.p.getAttribute('[data-key=sv-tg]', 'href').catch(() => ''), tg = (await X.p.getAttribute('[data-key=sv-tg]', 'target').catch(() => null)) || '';
      const want = sch === 'tg' ? /^tg:\/\/resolve\?domain=peredai_com_ua_bot&start=in_[A-Za-z0-9_-]{24}$/ : /^https:\/\/t\.me\/peredai_com_ua_bot\?start=in_[A-Za-z0-9_-]{24}$/;
      if (!want.test(h || '') || tg !== tgt) bad.push([nm, h, tg]);
      await X.p.waitForTimeout(300); if (rowOf(tok(h)).st !== 'pre') bad.push([nm, 'pre?', rowOf(tok(h))]);
      await X.ctx.close();
    }
    ok('посилання за браузером (14): Safari/Chrome/Firefox iPhone, Chrome/Samsung/Firefox Android — https://t.me у тій самій вкладці; Instagram/Facebook/Viber/Telegram iPhone, TikTok/Instagram Android — tg://; Windows/Mac — нова вкладка; у всіх — «pre»', !bad.length, bad);
    // 13. кнопка довго на екрані: реєстрація оновлюється раз на 4 хв (строк «pre» знову 15 хв) — дотик через пів години не впирається в «застаріло»
    const R = await newPage(390, 844, UA_SF);
    await R.ctx.clock.install(); await setup(R.p, ['cold']); await R.p.waitForSelector('[data-key=sv-tg]'); await R.p.waitForTimeout(600);
    const t9 = tok(await R.p.getAttribute('[data-key=sv-tg]', 'href')), e0 = +rowOf(t9).expires_at || 0;
    await R.ctx.clock.fastForward('05:00'); await R.p.waitForTimeout(400); await R.ctx.clock.fastForward('00:16'); await R.p.waitForTimeout(1200);
    const e1 = +rowOf(t9).expires_at || 0;
    ok('через 5 хв на екрані — реєстрацію оновлено (строк зсунувся), рядок «pre»', rowOf(t9).st === 'pre' && e1 > e0, [e0, e1, rowOf(t9)]);
    ok('журнал /api/health → tgin: є початі, підтверджені, «не я»', (h => h && h.n >= 9 && h.ok >= 8 && h.no === 1)((await (await fetch(BASE + '/api/health')).json()).tgin), (await (await fetch(BASE + '/api/health')).json()).tgin);
    ok('без помилок JS', !errs.length, errs);
  } catch (e) { fail++; console.log(' FAIL виняток', e && e.stack); }
  await b.close(); srv.kill();
  console.log(`\nИтог: ${pass} ok, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})();
