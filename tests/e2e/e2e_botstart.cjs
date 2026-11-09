// Плашка «Бот змінився — натисніть «Старт»» (80-та сесія): бот сменён 07.11.2026, новый не может писать тем, кто его не запускал
// (Telegram «chat not found» → reminders_sent.status no_chat). Сервер ставит user.botStart, головна показывает плашку:
// в Mini App нынешнего бота — requestWriteAccess → POST /api/bot/write-ok → плашка уходит; старый клиент — ссылка на бота; «Пізніше» — на 3 дня.
// Запуск: node tests/e2e/e2e_botstart.cjs (сервер піднімає сам, порт 8015).
const { chromium } = require('playwright'); const { spawn, execSync } = require('child_process'); const crypto = require('crypto'); const fs = require('fs');
const demo = require('./demo.cjs');
const DIR = '/tmp/teplo_bs', PORT = 8015, BASE = `http://127.0.0.1:${PORT}`, TOKEN = '123456:TEST-token', BOT = 'peredai_com_ua_bot';
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('✓', n); } else { fail++; console.log('✗', n, x === undefined ? '' : JSON.stringify(x).slice(0, 400)); } };
function initData(user) {
  const p = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAE' + Date.now(), user: JSON.stringify(user) };
  const dcs = Object.keys(p).sort().map(k => k + '=' + p[k]).join('\n');
  p.hash = crypto.createHmac('sha256', crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest()).update(dcs).digest('hex');
  return Object.keys(p).map(k => k + '=' + encodeURIComponent(p[k])).join('&');
}
// заглушка Telegram.WebApp: версия, ответ на requestWriteAccess; что открывали — в window.__tg
const stub = (id, user, ver, grant) => `window.__tg=[];window.Telegram={WebApp:{initData:${JSON.stringify(id)},initDataUnsafe:{user:${JSON.stringify(user)}},platform:'android',version:'${ver}',colorScheme:'light',
  isVersionAtLeast(v){return parseFloat('${ver}')>=parseFloat(v)},requestWriteAccess(cb){window.__tg.push('write');setTimeout(function(){cb(${grant})},50)},
  ready(){},expand(){},onEvent(){},setHeaderColor(){},setBackgroundColor(){},openLink(u){window.__tg.push(u)},openTelegramLink(u){window.__tg.push(u)}}};`;
async function page(b, user, ver, grant) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => localStorage.setItem('teplo.cc', JSON.stringify({ v: 1, a: 0, at: new Date().toISOString(), id: 'e2econsent02' })));
  await p.route('https://telegram.org/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: r.request().url().includes('telegram-web-app') ? stub(initData(user), user, ver, grant) : '' }));
  await p.goto(BASE + '/'); return { ctx, p, errs };
}
const sql = q => execSync(`php -r '$p=new PDO("sqlite:${DIR}/dev.sqlite"); $p->exec(${JSON.stringify(q).replace(/'/g, "'\\''")});'`);
const banner = p => p.waitForSelector('[data-key=home-bot-start]', { timeout: 15000 }).then(() => true, () => false);
(async () => {
  execSync(`rm -rf ${DIR} && mkdir -p ${DIR}`);
  fs.writeFileSync(DIR + '/config.php', `<?php return ['db' => ['dsn' => 'sqlite:${DIR}/dev.sqlite'], 'cookie_secure' => false, 'bot_token' => '${TOKEN}', 'bot_username' => '${BOT}'];\n`);
  const srv = spawn('php', ['-S', '127.0.0.1:' + PORT, 'index.php'], { cwd: __dirname + '/../..', env: Object.assign({}, process.env, { SITE_BASE: '', SITE_DATA: DIR }), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const users = [{ id: 880001, first_name: 'Дозвіл', language_code: 'uk' }, { id: 880002, first_name: 'Старий', language_code: 'ru' }];
  try {
    for (const u of users) {   // аккаунт с квартирой и «не дошло» — как у людей после смены бота
      const lj = await (await fetch(BASE + '/api/auth/telegram/webapp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: initData(u) }) })).json();
      await fetch(BASE + '/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Session': lj.session }, body: JSON.stringify({ state: demo({}), baseVersion: 0 }) });
      sql(`INSERT INTO reminders_sent (user_id, kind, ym, sent_at, status) VALUES (${lj.user.id}, 'gpv-09', '2026-11', '${new Date(Date.now() - 3600e3).toISOString().slice(0, 19)}+00:00', 'no_chat')`);
      ok(`сервер: ${u.first_name} — вход ок, user.botStart сначала нет`, lj.user && lj.user.botStart === null && lj.tgBot === 'cur', lj);
    }
    const b = await chromium.launch();
    // 1) Mini App нынешнего бота (8.0): плашка → «Відкрити @…» → requestWriteAccess → write-ok → плашки нет, тост
    { const { ctx, p, errs } = await page(b, users[0], '8.0', true);
      const has = await banner(p);
      const txt = await p.evaluate(() => (document.querySelector('[data-key=home-bot-start]') || {}).textContent || '');
      ok('плашка на головній: «Нагадування не доходять», @бот, кнопка й «Пізніше»', has && /Нагадування не доходять/.test(txt) && txt.includes('@peredai_com_ua_bot') && /Пізніше/.test(txt), txt);
      await p.screenshot({ path: '/tmp/e2e_botstart_1.png' });
      await p.click('[data-key=home-bot-start-go]');
      await p.waitForFunction(() => !document.querySelector('[data-key=home-bot-start]'), null, { timeout: 8000 }).catch(() => {});
      const r = await p.evaluate(() => ({ tg: window.__tg, gone: !document.querySelector('[data-key=home-bot-start]'), toast: (document.getElementById('toast-host') || {}).textContent || '' }));
      ok('нажал — requestWriteAccess, ссылку не открывали; плашка ушла, тост «Готово»', r.tg.join() === 'write' && r.gone && /Готово/.test(r.toast), r);
      const ok2 = execSync(`php -r '$p=new PDO("sqlite:${DIR}/dev.sqlite"); echo $p->query("SELECT bot_ok FROM user_identities WHERE external_id = 880001")->fetchColumn();'`).toString();
      ok('сервер записал bot_ok', /^\d{4}-\d\d-\d\dT/.test(ok2), ok2);
      ok('без помилок JS (1)', !errs.length, errs); await ctx.close(); }
    // 2) старый клиент Telegram (6.0, без requestWriteAccess) по-русски: ссылка t.me/<бот>?start=remind; «Позже» прячет
    { const { ctx, p, errs } = await page(b, users[1], '6.0', false);
      const has = await banner(p);
      const txt = await p.evaluate(() => (document.querySelector('[data-key=home-bot-start]') || {}).textContent || '');
      ok('по-русски: «Напоминания не доходят», «Открыть @…»', has && /Напоминания не доходят/.test(txt) && /Открыть @peredai_com_ua_bot/.test(txt), txt);
      await p.click('[data-key=home-bot-start-go]'); await p.waitForTimeout(300);
      const tg = await p.evaluate(() => window.__tg);
      ok('старый клиент — openTelegramLink на бота с ?start=remind', tg.join() === 'https://t.me/peredai_com_ua_bot?start=remind', tg);
      await p.click('[data-key=home-bot-start-later]'); await p.waitForTimeout(300);
      const r = await p.evaluate(() => ({ gone: !document.querySelector('[data-key=home-bot-start]'), later: JSON.parse(localStorage.getItem('teplo.v1') || '{}').botStartLater }));
      ok('«Позже» — плашки нет, botStartLater сохранён', r.gone && r.later > 0, r);
      ok('без помилок JS (2)', !errs.length, errs); await ctx.close(); }
    await b.close();
  } finally { srv.kill(); }
  console.log(`\n${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})();
