// 179-я: спільна квартира в браузері — два телефони, дві людини (власник житла й орендар / мама й син).
// Власник запрошує (посилання, QR), орендар приєднується → показання орендаря бачить власник з підписом «хто вніс», прибрати, вийти;
// людина без акаунта — «Приєднатися поштою» (лист → посилання → вхід без пароля), ru, 320 px.
// Запуск: cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_shareplace.cjs (сервер і поштовий стенд піднімає сам: 8016, SMTP 2526). Скріни — /tmp/shp_*.png
const { chromium } = require('playwright'); const { spawn, execSync } = require('child_process'); const fs = require('fs');
const demo = require('./demo.cjs');
const DIR = '/tmp/teplo_shp', PORT = 8016, BASE = `http://127.0.0.1:${PORT}/`, EML = DIR + '/mail.eml';
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('✓', n); } else { fail++; console.log('✗', n, x === undefined ? '' : JSON.stringify(x).slice(0, 500)); } };
const api = (p, m, path, body) => p.evaluate(async ([m, path, body]) => { const t = (document.cookie.match(/ts_csrf=([^;]*)/) || [])[1];
  const r = await fetch('api' + path, { method: m, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json', 'X-CSRF': t || '' } }); return Object.assign(await r.json().catch(() => ({})), { _s: r.status }); }, [m, path, body]);
const st = p => p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1') || '{}'));
const poll = p => p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
const wide = p => p.evaluate(() => document.documentElement.scrollWidth);
const openG = async p => { await p.waitForSelector('[data-key=pg-pv-people]'); if (!(await p.$eval('[data-key=pg-pv-people]', d => d.open))) await p.click('[data-key=pg-pv-people] summary'); await p.waitForTimeout(250); };
async function dev(b, o) {
  const ctx = await b.newContext(Object.assign({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'uk-UA' }, o || {})); const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(e.message));
  await p.addInitScript(() => localStorage.setItem('teplo.cc', JSON.stringify({ v: 1, a: 0, at: new Date().toISOString(), id: 'e2econsent02' })));
  await p.route('https://telegram.org/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await p.goto(BASE); return p;
}
const mailLink = () => { const d = fs.existsSync(EML) ? fs.readFileSync(EML, 'utf8') : ''; let last = ''; d.split(/\r?\n/).forEach(l => { const x = Buffer.from(l.trim(), 'base64').toString('utf8'); const m = x.match(/#join-[A-Za-z0-9_-]{24}/g); if (m) last = m[m.length - 1]; }); return last; };
(async () => {
  execSync(`rm -rf ${DIR} && mkdir -p ${DIR}`);
  fs.writeFileSync(DIR + '/config.php', `<?php return ['db' => ['dsn' => 'sqlite:${DIR}/dev.sqlite'], 'cookie_secure' => false, 'app_url' => '${BASE}', 'bot_username' => 'TeploTestBot',
    'smtp_host' => '127.0.0.1', 'smtp_port' => '2526', 'smtp_user' => 'u', 'smtp_pass' => 'p', 'smtp_from' => 'noreply@peredai.com.ua'];\n`);
  const root = __dirname + '/../..';
  const srv = spawn('php', ['-S', '127.0.0.1:' + PORT, 'index.php'], { cwd: root, env: Object.assign({}, process.env, { SITE_BASE: '', SITE_DATA: DIR }), stdio: 'ignore' });
  let smtp = null;   // поштовий стенд чекає з’єднання 20 с — піднімаємо перед листом
  await new Promise(r => setTimeout(r, 900));
  const b = await chromium.launch();
  try {
    // ---------- власник: квартира з теплом і водою, акаунт
    const A = await dev(b), ts = Date.now(), emA = `olga${ts}@example.ua`, emB = `ivan${ts}@example.ua`;
    const s0 = demo({}); s0.places[0].name = 'Мамина'; s0.places[0].address = 'Харків, вул. Сумська, 10';
    await A.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), s0);
    ok('А: реєстрація', (await api(A, 'POST', '/auth/register', { email: emA, password: 'password-123' }))._s === 200);
    await A.reload(); await A.waitForTimeout(2600);
    await A.goto(BASE + '#place-main'); await A.waitForTimeout(500);
    const sub0 = await A.textContent('[data-key=pg-pv-people] summary');
    ok('екран квартири: група «Спільний доступ» — «Лише ви», згорнута', /Спільний доступ/.test(sub0) && /Лише ви/.test(sub0) && !(await A.$eval('[data-key=pg-pv-people]', d => d.open)), sub0);
    await A.click('[data-key=pg-pv-people] summary'); await A.waitForTimeout(200);
    ok('пояснення: що побачить людина, що лишиться вашим', /вноситиме показання/.test(await A.textContent('[data-key=pg-pv-people]')) && /паролі кабінетів/.test(await A.textContent('[data-key=pg-pv-people]')));
    await A.click('[data-key=shp-inv]'); await A.waitForSelector('[data-key=shp-send]', { timeout: 8000 });
    ok('«Запросити людину» → способи: надіслати, Telegram, QR, копіювати, лист', !!(await A.$('[data-key=shp-tg]')) && !!(await A.$('[data-key=shp-qr]')) && !!(await A.$('[data-key=shp-copy]')) && !!(await A.$('#shp-email')));
    await A.click('[data-key=shp-qr]'); await A.waitForSelector('.shp-qr svg', { timeout: 8000 }).catch(() => {});
    ok('QR-код посилання намальовано', !!(await A.$('.shp-qr svg path')));
    await A.screenshot({ path: '/tmp/shp_owner_invite.png', fullPage: true });
    ok('список: «Посилання · чекає · діє до …»', /Посилання/.test(await A.textContent('[data-key=shp-list]')) && /діє до/.test(await A.textContent('[data-key=shp-list]')));
    const sh = await api(A, 'GET', '/share'); const url = (sh.shares[0].invites[0] || {}).url || '';
    ok('посилання — #join-…', /#join-[A-Za-z0-9_-]{24}$/.test(url), url);
    ok('квартира власника позначена (sh.role owner)', ((await st(A)).places[0].sh || {}).role === 'owner');

    // ---------- орендар з акаунтом відкриває посилання
    const B = await dev(b);
    ok('Б: реєстрація (новий, без квартир)', (await api(B, 'POST', '/auth/register', { email: emB, password: 'password-123' }))._s === 200);
    await B.goto(url.replace(/^https?:\/\/[^/]+\//, BASE)); await B.reload(); await B.waitForSelector('[data-key=jn-card]', { timeout: 10000 });
    const jc = await B.textContent('[data-key=jn-card]');
    ok('екран запрошення: хто кличе, квартира, адреса, що буде', jc.includes('olga' + ts) && /Мамина/.test(jc) && /Сумська/.test(jc) && /вносите показання/.test(jc) && /вийти можна будь-коли/.test(jc), jc);
    ok('токен прибрано з адреси (#join)', (await B.evaluate(() => location.hash)) === '#join');
    await B.screenshot({ path: '/tmp/shp_join.png', fullPage: true });
    await B.click('[data-key=jn-go]'); await B.waitForFunction(() => location.hash === '#home', null, { timeout: 10000 }).catch(() => {});
    await B.waitForTimeout(800);
    const sB = await st(B), pB = (sB.places || []).filter(p => !p.deleted);
    ok('Б: приєднався — одна квартира (спільна) з тими ж лічильниками, на головній', pB.length === 1 && /^sh\d+$/.test(pB[0].id) && (pB[0].water.meters || []).length === 2 && !!pB[0].meter, pB.map(p => p.id));
    ok('Б: показання власника — у нього', (sB.water || []).filter(r => r.place === pB[0].id).length >= 7 && (sB.readings || []).filter(r => r.place === pB[0].id).length === 4);
    ok('Б: біля назви — позначка «спільна, 2»', /2/.test((await B.textContent('[data-key=sh-tag]').catch(() => '')) || ''));
    await B.screenshot({ path: '/tmp/shp_member_home.png', fullPage: true });

    // ---------- орендар вносить воду → власник бачить, з підписом «хто вніс»
    await B.goto(BASE + '#wnew'); await B.waitForTimeout(500);
    const inp = await B.$$eval('input[id^="wn-"]', xs => xs.filter(x => /^wn-[hc]1$/.test(x.id)).map(x => x.id));
    for (const id of inp) await B.fill('#' + id, id === 'wn-h1' ? '180' : '446');
    await B.click('[data-key=wn-save]'); await B.waitForTimeout(3200);
    const nb = (await st(B)).water.filter(r => r.place === pB[0].id && r.date >= '2026-11-01' && !r.base).slice(-1)[0] || {};
    ok('Б: запис має «хто вніс» (by)', !!nb.by, nb);
    await poll(A); await A.waitForTimeout(1500);
    const na = (await st(A)).water.filter(r => r.id === nb.id)[0];
    ok('А: показання орендаря прийшли в її квартиру (place main)', na && na.place === 'main' && JSON.stringify(na.vals) === JSON.stringify(nb.vals), na);
    await A.goto(BASE + '#history'); await A.waitForTimeout(400);
    if (await A.$('[data-v=hot]')) { await A.click('[data-v=hot]'); await A.waitForTimeout(400); }
    const by = await A.$$eval('.by-tag', xs => xs.map(x => x.textContent));
    ok('А: в історії біля запису — ім’я орендаря', by.some(x => x.startsWith('ivan')), by);
    await A.screenshot({ path: '/tmp/shp_owner_history.png', fullPage: true });

    // ---------- власник змінює назву квартири — у орендаря своя; власник змінює абонплату — у орендаря та сама
    await A.goto(BASE + '#place-main'); await A.waitForTimeout(400);
    await openG(A);
    const ppl = await A.textContent('[data-key=shp-list]');
    ok('А: у списку — Іван (пошта, з дати), кнопка «Прибрати»', ppl.includes('ivan' + ts) && /пошта/.test(ppl) && !!(await A.$('[data-act=shp-rm]')), ppl);
    ok('А: підзаголовок групи — «Ви й ivan…»', (await A.textContent('[data-key=pg-pv-people] summary')).includes('Ви й ivan'));
    // 180-я: власник дозволяє «у фоні через мої кабінети»; назва — спільна
    ok('А: галочка «Надсилати у фоні через мої кабінети» (вимкнена)', !!(await A.$('[data-key=shp-bg] input')) && !(await A.$eval('[data-key=shp-bg] input', x => x.checked)));
    await A.click('[data-key=shp-bg] input'); await A.waitForTimeout(1200);
    ok('А: увімкнув — на сервері bg', ((await api(A, 'GET', '/share')).shares[0] || {}).bg === true);
    ok('Б: назва квартири та сама, що в власника («Мамина»)', ((await st(B)).places || []).filter(p => p.id === pB[0].id)[0].name === 'Мамина');

    // ---------- Б: екран квартири — учасник, «Вийти», без запрошень
    await poll(B); await B.waitForTimeout(1500);
    await B.goto(BASE + '#place-' + pB[0].id); await B.waitForTimeout(500); await openG(B);
    const gB = await B.textContent('[data-key=pg-pv-people]');
    ok('Б: «Веде olga… · ви учасник», «Вийти з квартири», запрошувати не може', gB.includes('Веде olga') && !!(await B.$('[data-key=shp-leave]')) && !(await B.$('[data-key=shp-inv]')), gB.slice(0, 300));
    ok('Б: «Надсилання у фоні — через кабінети olga…» (галочки в учасника немає)', /через кабінети olga/.test(await B.textContent('[data-key=shp-bg-mem]').catch(() => '')) && !(await B.$('[data-key=shp-bg]')), await B.textContent('[data-key=shp-bg-mem]').catch(() => ''));
    await B.screenshot({ path: '/tmp/shp_member_place.png', fullPage: true });
    ok('Б: 320 px — екран квартири не ширший', (await (async () => { await B.setViewportSize({ width: 320, height: 700 }); await B.waitForTimeout(200); return wide(B); })()) <= 320);
    await B.setViewportSize({ width: 390, height: 844 });

    // ---------- власник прибирає орендаря
    await A.click('[data-act=shp-rm]'); await A.waitForSelector('[data-key=ask-yes]', { timeout: 4000 });
    ok('питання «Прибрати … з квартири «Мамина»?»', /Прибрати ivan.* з квартири «Мамина»/.test(await A.textContent('[data-key=ask]')));
    await A.click('[data-key=ask-yes]'); await A.waitForTimeout(1500);
    ok('А: лишилась сама — «Лише ви»', /Лише ви/.test(await A.textContent('[data-key=pg-pv-people] summary')));
    await poll(B); await B.waitForTimeout(1500);
    ok('Б: квартира зникла', !((await st(B)).places || []).some(p => p.id === pB[0].id && !p.deleted));

    // ---------- людина без акаунта: «Приєднатися поштою» → лист → посилання → вхід без пароля
    await A.goto(BASE + '#place-main'); await A.waitForTimeout(400); await openG(A);
    ok('використане посилання зникло — знову «Запросити людину»', !!(await A.$('[data-key=shp-inv]')) && !(await A.$('[data-key=shp-send]')));
    await A.click('[data-key=shp-inv]'); await A.waitForSelector('[data-key=shp-send]', { timeout: 8000 });
    const url2 = ((await api(A, 'GET', '/share')).shares[0].invites[0] || {}).url || '';
    ok('нове посилання — інше', url2 && url2 !== url, [url, url2]);
    const C = await dev(b, { locale: 'ru-RU' });
    await C.goto(url2.replace(/^https?:\/\/[^/]+\//, BASE)); await C.reload(); await C.waitForSelector('[data-key=jn-card]', { timeout: 10000 });
    const cc = await C.textContent('[data-key=jn-card]');
    ok('ru, без акаунта: «Присоединиться через Telegram», почтой, «Уже есть аккаунт?»', /Присоединиться через Telegram/.test(cc) && /Отправить письмо для входа/.test(cc) && /Уже есть аккаунт/.test(cc), cc);
    await C.screenshot({ path: '/tmp/shp_join_noacc_ru.png', fullPage: true });
    ok('320 px — экран приглашения не шире', (await (async () => { await C.setViewportSize({ width: 320, height: 700 }); await C.waitForTimeout(200); return wide(C); })()) <= 320);
    await C.setViewportSize({ width: 390, height: 844 });
    const emC = `mama${ts}@example.ua`;
    smtp = spawn('php', [root + '/tests/smtp_fake.php', '2526', EML, '3'], { stdio: 'ignore' }); await new Promise(r => setTimeout(r, 600));
    await C.fill('#a-email', emC); await C.click('[data-key=jn-mail-go]'); await C.waitForSelector('[data-key=jn-sent]', { timeout: 10000 }).catch(() => {});
    ok('«Проверьте почту» с адресом', /ma•••@example\.ua/.test(await C.textContent('[data-key=jn-sent]').catch(() => '')));
    await C.waitForTimeout(500); const ml = mailLink();
    ok('письмо пришло, в нём #join-…', /^#join-/.test(ml), ml);
    const D = await dev(b, { locale: 'ru-RU' });
    await D.goto(BASE + ml); await D.reload(); await D.waitForSelector('[data-key=jn-go]', { timeout: 10000 });
    ok('по ссылке из письма — «Пароль не нужен», одна кнопка', /Пароль не нужен/.test(await D.textContent('[data-key=jn-card]')));
    await D.click('[data-key=jn-go]'); await D.waitForFunction(() => location.hash === '#home', null, { timeout: 10000 }).catch(() => {}); await D.waitForTimeout(1200);
    const me = await api(D, 'GET', '/me');
    ok('вошла без пароля (аккаунт с этой почтой), квартира у неё', me._s === 200 && me.user.email === emC && ((await st(D)).places || []).some(p => /^sh/.test(p.id) && !p.deleted), me);

    // ---------- учасниця виходить сама
    const pD = ((await st(D)).places || []).filter(p => /^sh/.test(p.id) && !p.deleted)[0];
    await D.goto(BASE + '#place-' + pD.id); await D.waitForTimeout(500); await openG(D);
    await D.click('[data-key=shp-leave]'); await D.waitForSelector('[data-key=ask-yes]', { timeout: 4000 }); await D.click('[data-key=ask-yes]'); await D.waitForTimeout(2000);
    ok('вышла: квартиры у неё нет, у владельца всё на месте', !((await st(D)).places || []).some(p => p.id === pD.id && !p.deleted) && ((await st(A)).water || []).filter(r => r.place === 'main').length >= 8);

    // ---------- светлая и тёмная — скрины группы и приглашения для глаз
    for (const scheme of ['light', 'dark']) {
      const L = await dev(b, { colorScheme: scheme }); await api(L, 'POST', '/auth/login', { email: emA, password: 'password-123' });
      await L.goto(BASE + '#place-main'); await L.reload(); await L.waitForTimeout(1800); await openG(L);
      await L.click('[data-key=shp-inv]').catch(() => {}); await L.waitForTimeout(800);
      const el = await L.$('[data-key=pg-pv-people]'); if (el) await el.screenshot({ path: `/tmp/shp_group_${scheme}.png` });
      ok(`${scheme}: без ошибок JS`, !L.errs.length, L.errs);
    }
    ok('без ошибок JS у всех', ![A, B, C, D].some(p => p.errs.length), [A, B, C, D].map(p => p.errs));
  } catch (e) { ok('без исключений', false, String(e && e.stack || e)); }
  await b.close(); srv.kill(); if (smtp) smtp.kill();
  console.log(`\n${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);
})();
