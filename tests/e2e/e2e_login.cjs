// Вхід (123-я, власник 12.11: «красиво, понятно и удобно»): Telegram першим, «або поштою», перемикач «Увійти / Створити акаунт»,
// «Показати» пароль, «Забули пароль?» → лист (локально пошти нема — зрозуміла відповідь), посилання #reset-… → новий пароль і вхід.
// Запуск: cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_login.cjs   (сайт 127.0.0.1:8013, SITE_DATA=/tmp/teplo_data — sqlite;
// для блоку Telegram у /tmp/teplo_data/config.php — 'bot_username' => 'peredai_com_ua_bot')
const { chromium } = require('playwright'); const crypto = require('crypto'); const { execFileSync } = require('child_process');
const BASE = 'http://127.0.0.1:8013/', DB = '/tmp/teplo_data/dev.sqlite';
let pass = 0, fail = 0; const ok = (n, c, i) => { console.log((c ? '  OK  ' : ' FAIL ') + n + (!c && i !== undefined ? '  → ' + JSON.stringify(i) : '')); c ? pass++ : fail++; };
const sql = q => execFileSync('python3', ['-c', 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); r=c.execute(sys.argv[2]).fetchall(); c.commit(); print(r)', DB, q]).toString().trim();
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/telegram\.org|ERR_|40[13]|410|422|503/.test(m.text())) errs.push(m.text()); });
  await p.goto(BASE + '#login'); await p.reload(); await p.waitForTimeout(900);
  const txt = s => p.textContent(s).catch(() => '');
  ok('Telegram першим: заголовок, бот у тексті, кнопка «Відкрити в Telegram» на t.me', /Через Telegram/.test(await txt('[data-key=login-telegram]')) && /@peredai_com_ua_bot/.test(await txt('[data-key=login-telegram]'))
    && (await p.getAttribute('[data-key=login-tg-open]', 'href')) === 'https://t.me/peredai_com_ua_bot');
  ok('пояснення про прив’язку — згорнуте («Вже є акаунт з email?»)', await p.$eval('[data-key=login-telegram] details.auth-more', d => !d.open));
  ok('«або поштою» між Telegram і формою', /або поштою/.test(await txt('.auth-or')));
  ok('перемикач: «Увійти» натиснуто, «Створити акаунт» — ні', (await p.getAttribute('[data-key=login-mode-in]', 'aria-pressed')) === 'true' && (await p.getAttribute('[data-key=login-toggle]', 'aria-pressed')) === 'false');
  ok('вхід: без підказки «8 символів» і без placeholder у email', !(await p.$('#a-pass-h')) && !(await p.getAttribute('#a-email', 'placeholder')));
  await p.fill('#a-pass', 'secret-12'); await p.click('[data-key=a-pass-eye]');
  ok('«Показати пароль»: видно введене, кнопка натиснута й каже «Сховати»', (await p.getAttribute('#a-pass', 'type')) === 'text' && (await p.getAttribute('[data-key=a-pass-eye]', 'aria-pressed')) === 'true' && /Сховати/.test(await p.getAttribute('[data-key=a-pass-eye]', 'aria-label')));
  await p.click('[data-key=a-pass-eye]'); ok('ще раз — знову крапки', (await p.getAttribute('#a-pass', 'type')) === 'password');
  ok('кнопка «Показати» — 48 px і більше', await p.$eval('[data-key=a-pass-eye]', el => el.getBoundingClientRect().height >= 48 && el.getBoundingClientRect().width >= 48));

  // реєстрація: email не губиться при перемиканні, підказка «8 символів» з’являється
  const email = 'login-' + Date.now() + '@gmail.com';
  await p.fill('#a-email', email); await p.click('[data-key=login-toggle]'); await p.waitForTimeout(300);
  ok('«Створити акаунт»: email лишився, підказка «Щонайменше 8 символів», кнопка «Створити акаунт»', (await p.inputValue('#a-email')) === email && /8 символів/.test(await txt('#a-pass-h')) && /Створити акаунт/.test(await txt('[data-key=login-submit]')));
  await p.fill('#a-pass', 'short'); await p.click('[data-key=login-submit]'); await p.waitForTimeout(600);
  ok('короткий пароль — помилка словами', /8 символів/.test(await txt('#login-err')), await txt('#login-err'));
  await p.fill('#a-pass', 'Old-password-1'); await p.click('[data-key=login-submit]'); await p.waitForTimeout(1200);
  const uid = +(sql(`SELECT id FROM users WHERE email = '${email}'`).match(/\d+/) || [0])[0];
  ok('акаунт створено, вхід виконано (сторінка пішла з #login)', uid > 0 && !/#login$/.test(p.url()), p.url());

  // «Забули пароль?» в іншому браузері (локально пошти нема → зрозуміло, що робити)
  const c2 = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); const q = await c2.newPage(); q.on('pageerror', e => errs.push(e.message));
  await q.goto(BASE + '#login'); await q.reload(); await q.waitForTimeout(800);
  await q.fill('#a-email', email); await q.click('[data-key=login-forgot]'); await q.waitForTimeout(400);
  ok('«Забули пароль?»: форма «Новий пароль поштою», email перенесено, Telegram-блок сховано', !!(await q.$('[data-key=forgot-form]')) && (await q.inputValue('#a-email')) === email && !(await q.$('[data-key=login-telegram]')));
  await q.click('[data-key=forgot-submit]'); await q.waitForTimeout(800);
  const fe = await q.textContent('#forgot-err').catch(() => '');
  ok('пошта сервісу не налаштована — «Відновлення поштою зараз недоступне — увійдіть через Telegram…»', /недоступне/.test(fe) || !!(await q.$('[data-key=login-sent]')), fe);
  await q.click('[data-key=login-back]'); await q.waitForTimeout(300);
  ok('«Повернутися до входу» — знову форма входу', !!(await q.$('[data-key=login-form]')) && (await q.getAttribute('[data-key=login-mode-in]', 'aria-pressed')) === 'true');

  // посилання з листа: токен прибирається з адреси, новий пароль → вхід
  const tok = crypto.randomBytes(24).toString('hex'), now = Math.floor(Date.now() / 1000);
  sql(`INSERT INTO pw_resets (token_hash, user_id, expires_at, created_at) VALUES ('${crypto.createHash('sha256').update(tok).digest('hex')}', ${uid}, ${now + 3600}, ${now})`);
  await q.goto(BASE + '#reset-' + tok); await q.waitForTimeout(800);
  ok('#reset-…: у адресі лишилось «#reset» (токен не в журналі й історії)', /#reset$/.test(q.url()) && !q.url().includes(tok), q.url());
  ok('екран «Новий пароль» з «Показати» і підказкою', /Новий пароль/.test(await q.textContent('h1')) && !!(await q.$('[data-key=r-pass-eye]')) && /8 символів/.test(await q.textContent('#r-pass-h')));
  await q.fill('#r-pass', 'New-password-2'); await q.click('[data-key=reset-submit]'); await q.waitForTimeout(1500);
  ok('«Зберегти й увійти» — увійшли, пішли з екрана', !/#reset$/.test(q.url()) && await q.evaluate(() => !!(window.TeploSync && TeploSync.account)), q.url());
  ok('у базі: посилання використане', /\d/.test(sql(`SELECT used_at FROM pw_resets WHERE user_id = ${uid}`)));
  const c4 = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); const z = await c4.newPage(); z.on('pageerror', e => errs.push(e.message));
  await z.goto(BASE + '#reset-' + tok); await z.waitForTimeout(800); await z.fill('#r-pass', 'Third-password-3'); await z.click('[data-key=reset-submit]'); await z.waitForTimeout(900);
  ok('те саме посилання вдруге (інший браузер) — «застаріло», кнопка «Надіслати нове посилання»', /застаріло/.test(await z.textContent('[data-key=reset-expired]').catch(() => '')) && !!(await z.$('[data-key=reset-new]')));
  await z.click('[data-key=reset-new]'); await z.waitForTimeout(600);
  ok('«Надіслати нове посилання» → форма «Новий пароль поштою»', !!(await z.$('[data-key=forgot-form]')), z.url());

  // російська — з мови браузера
  const c3 = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' }); const r = await c3.newPage();
  await r.goto(BASE + '#login'); await r.reload(); await r.waitForTimeout(800);
  ok('ru: «или по почте», «Забыли пароль?», «Открыть в Telegram»', /или по почте/.test(await r.textContent('#main')) && /Забыли пароль/.test(await r.textContent('#main')) && /Открыть в Telegram/.test(await r.textContent('#main')));
  ok('без помилок JS', !errs.length, errs);
  await b.close(); console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); process.exit(fail ? 1 : 0);
})();
