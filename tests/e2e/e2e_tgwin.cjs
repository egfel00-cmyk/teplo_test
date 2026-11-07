// Вікно Telegram (Mini App), у якому cookie не зберігаються (Telegram на Mac, 05.11.2026): вхід за initData, токен у X-Session,
// «Входимо через Telegram…» замість привітання, кнопка з нагадування ?go=…&place=… — у потрібну квартиру після входу,
// невдалий вхід — причина й «Спробувати ще раз», журнал пише tg_login. Сервер: SITE_DATA=/tmp/teplo_tg (config з bot_token), порт 8014.
// Запуск: node tests/e2e/e2e_tgwin.cjs (сервер піднімає сам).
const { chromium } = require('playwright'); const { spawn, execSync } = require('child_process'); const crypto = require('crypto'); const fs = require('fs');
const demo = require('./demo.cjs');
const DIR = '/tmp/teplo_tg', PORT = 8014, BASE = `http://127.0.0.1:${PORT}`, TOKEN = '123456:TEST-token';
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('✓', n); } else { fail++; console.log('✗', n, x === undefined ? '' : JSON.stringify(x).slice(0, 400)); } };
function initData(user, age, bad) {
  const p = { auth_date: String(Math.floor(Date.now() / 1000) - (age || 0)), query_id: 'AAE' + Date.now(), user: JSON.stringify(user) };
  const dcs = Object.keys(p).sort().map(k => k + '=' + p[k]).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.hash = bad ? 'f'.repeat(64) : crypto.createHmac('sha256', secret).update(dcs).digest('hex');
  return Object.keys(p).map(k => k + '=' + encodeURIComponent(p[k])).join('&');
}
const stub = (id, user) => `window.Telegram={WebApp:{initData:${JSON.stringify(id)},initDataUnsafe:{user:${JSON.stringify(user)}},platform:'macos',version:'8.0',colorScheme:'light',
  ready(){},expand(){},onEvent(){},setHeaderColor(){},setBackgroundColor(){},openLink(u){},openTelegramLink(u){}}};`;
async function page(b, id, user, url) {
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); localStorage.setItem('teplo.cc', JSON.stringify({ v: 1, a: 1, at: new Date().toISOString(), id: 'e2econsent01' })); });   // журнал — лише зі згодою (банер cookie)   // журнал мовчить під автотестом — тут він потрібен
  await p.route('https://telegram.org/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: r.request().url().includes('telegram-web-app') ? stub(id, user) : '' }));
  // вікно, що не зберігає cookie: прибираємо Set-Cookie з усіх відповідей сервера
  await p.route(BASE + '/**', async r => { const res = await r.fetch(); const h = Object.assign({}, res.headers()); delete h['set-cookie']; await r.fulfill({ response: res, headers: h }); });
  await p.goto(BASE + url); return { ctx, p, errs };
}
(async () => {
  execSync(`rm -rf ${DIR} && mkdir -p ${DIR}`);
  fs.writeFileSync(DIR + '/config.php', `<?php return ['db' => ['dsn' => 'sqlite:${DIR}/dev.sqlite'], 'cookie_secure' => false, 'bot_token' => '${TOKEN}', 'bot_username' => 'heatcount_bot'];\n`);
  const srv = spawn('php', ['-S', '127.0.0.1:' + PORT, 'index.php'], { cwd: __dirname + '/../..', env: Object.assign({}, process.env, { SITE_BASE: '', SITE_DATA: DIR }), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const user = { id: 777001, first_name: 'Тест', username: 'tgtest', language_code: 'uk' };
  try {
    // аккаунт з двома квартирами — через той самий вхід Mini App і X-Session (без cookie й без CSRF)
    const lr = await fetch(BASE + '/api/auth/telegram/webapp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initData: initData(user) }) });
    const lj = await lr.json();
    ok('сервер: вхід Mini App без CSRF-cookie → 200 і токен сесії у відповіді', lr.status === 200 && /^[a-f0-9]{64}$/.test(lj.session || ''), [lr.status, lj]);
    const st = demo({ second: true }); st.demoToday = undefined;
    const pr = await fetch(BASE + '/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Session': lj.session }, body: JSON.stringify({ state: st, baseVersion: 0 }) });
    ok('сервер: PUT /api/state з X-Session (без cookie) → 200', pr.status === 200, [pr.status, await pr.text()]);
    const nr = await fetch(BASE + '/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: st, baseVersion: 0 }) });
    ok('сервер: без X-Session і без CSRF зміни не приймаються (403)', nr.status === 403, nr.status);

    const b = await chromium.launch();
    // 1) кнопка з нагадування про другу квартиру: порожнє вікно, cookie не зберігаються
    { const { ctx, p, errs } = await page(b, initData(user), user, '/?go=water-cold&place=p2');
      const early = await p.evaluate(() => ({ wait: !!document.querySelector('[data-key=tg-wait]'), welcome: !!document.querySelector('[data-key=welcome-start]') }));
      await p.waitForFunction(() => location.hash === '#water-cold' && document.querySelector('[data-key=where-water]') && !document.querySelector('[data-key=tg-wait]'), null, { timeout: 15000 }).catch(() => {});
      const r = await p.evaluate(() => ({ hash: location.hash, place: JSON.parse(localStorage.getItem('teplo.v1') || '{}').placeId, welcome: !!document.querySelector('[data-key=welcome-start]'),
        h1: (document.querySelector('h1') || {}).textContent, sess: sessionStorage.getItem('teplo.tgs'), ck: document.cookie }));
      ok('перший кадр — «Входимо через Telegram…», не привітання', early.wait && !early.welcome, early);
      ok('після входу — холодна вода квартири «Мамина» (p2), без привітання; сесія в sessionStorage, cookie немає', r.hash === '#water-cold' && r.place === 'p2' && !r.welcome && /^[a-f0-9]{64}$/.test(r.sess || '') && !/ts_sid/.test(r.ck), r);
      await p.waitForTimeout(4600);
      const ev = execSync(`php -r '$p=new PDO("sqlite:${DIR}/dev.sqlite"); foreach ($p->query("SELECT name, props FROM events ORDER BY id") as $x) echo $x["name"], " ", $x["props"], "\\n";'`).toString();
      ok('журнал дійшов без cookie: open і tg_login ok=1 (платформа, версія)', /open /.test(ev) && /tg_login .*"ok":1/.test(ev) && /"pf":"macos"/.test(ev), ev.split('\n').slice(0, 6));
      ok('без помилок JS', !errs.length, errs);
      await p.screenshot({ path: '/tmp/e2e_tgwin_1.png' }); await ctx.close(); }
    // 2) меню «Відкрити» без go: головна (дві квартири — список)
    { const { ctx, p, errs } = await page(b, initData(user), user, '/');
      await p.waitForFunction(() => document.querySelector('[data-key=places-list], .plist, [data-key^="pcard-"]') || location.hash === '#places', null, { timeout: 15000 }).catch(() => {});
      const r = await p.evaluate(() => ({ hash: location.hash, welcome: !!document.querySelector('[data-key=welcome-start]'), wait: !!document.querySelector('[data-key=tg-wait]'), h1: (document.querySelector('h1') || {}).textContent }));
      ok('«Відкрити» з меню — головна з квартирами, не привітання', !r.welcome && !r.wait, r);
      ok('без помилок JS (меню)', !errs.length, errs); await ctx.close(); }
    // 3) підпис не прийняли — привітання з причиною й «Спробувати ще раз», журнал tg_login ok=0
    { const { ctx, p, errs } = await page(b, initData(user, 0, true), user, '/?go=heat&place=main');
      await p.waitForSelector('[data-key=tg-fail]', { timeout: 15000 }).catch(() => {});
      const r = await p.evaluate(() => ({ fail: (document.querySelector('[data-key=tg-fail]') || {}).textContent || '', retry: !!document.querySelector('[data-key=tg-retry]'), welcome: !!document.querySelector('[data-key=welcome-start]') }));
      ok('невдалий вхід: банер «Не вдалося увійти через Telegram», «Спробувати ще раз», «Увійти поштою»', /Не вдалося увійти/.test(r.fail) && r.retry && r.welcome, r);
      ok('без помилок JS (невдалий вхід)', !errs.length, errs); await ctx.close(); }
    // 4) вікно відкрите понад добу — «закрийте й відкрийте ще раз»
    { const { ctx, p } = await page(b, initData(user, 90000), user, '/');
      await p.waitForSelector('[data-key=tg-fail]', { timeout: 15000 }).catch(() => {});
      const txt = await p.evaluate(() => (document.querySelector('[data-key=tg-fail]') || {}).textContent || '');
      ok('initData старша за добу → «Вікно відкрите надто давно…»', /надто давно/.test(txt), txt); await ctx.close(); }
    await b.close();
  } finally { srv.kill(); }
  console.log(`\n${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})();
