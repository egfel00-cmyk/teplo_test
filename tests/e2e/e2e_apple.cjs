// 154-а: «Увійти через Apple» у застосунку iPhone (App Store 4.8). Застосунок (підставний webkit-міст) на {t:'apple'} віддає identityToken,
// підписаний нашим ключем; сервер перевіряє його ключами з apple_jwks_url (file://) — вхід, акаунт з type 'apple', рядок «Apple» в Налаштуваннях.
// cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_apple.cjs   (сайт 127.0.0.1:8013; скрипт сам допише apple_jwks_url у /tmp/teplo_data/config.php)
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const crypto = require('crypto'); const fs = require('fs'); const { execFileSync } = require('child_process');
const BASE = 'http://127.0.0.1:8013/', DB = '/tmp/teplo_data/dev.sqlite', CFG = '/tmp/teplo_data/config.php', JWKS = '/tmp/apple_jwks_e2e.json';
let pass = 0, fail = 0; const ok = (n, c, i) => { console.log((c ? '  OK  ' : ' FAIL ') + n + (!c && i !== undefined ? '  → ' + JSON.stringify(i).slice(0, 400) : '')); c ? pass++ : fail++; };
const sql = q => execFileSync('python3', ['-c', 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); r=c.execute(sys.argv[2]).fetchall(); c.commit(); print(r)', DB, q]).toString().trim();
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
(async () => {
  // ключ «Apple» і JWKS
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  fs.writeFileSync(JWKS, JSON.stringify({ keys: [{ kty: 'RSA', kid: 'E2E', use: 'sig', alg: 'RS256', n: jwk.n, e: jwk.e }] }));
  let cfg = fs.readFileSync(CFG, 'utf8'); if (!cfg.includes('apple_jwks_url')) { cfg = cfg.replace(/\];\s*$/, ", 'apple_jwks_url' => 'file://" + JWKS + "'];\n"); fs.writeFileSync(CFG, cfg); }
  try { fs.unlinkSync('/tmp/teplo_data/cache/apple_jwks.json'); } catch (e) { /* кешу ще немає */ }
  try { sql('DELETE FROM rate_limits'); } catch (e) { /* немає таблиці */ }
  const sub = '000777.e2e.' + Date.now(), nonce = 'n-' + Date.now();
  const tok = claims => { const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'E2E' })), c = b64u(JSON.stringify(claims)); return h + '.' + c + '.' + b64u(crypto.sign('RSA-SHA256', Buffer.from(h + '.' + c), privateKey)); };
  const now = Math.floor(Date.now() / 1000);
  const good = tok({ iss: 'https://appleid.apple.com', aud: 'ua.com.peredai.app', exp: now + 600, iat: now, sub, email: 'e2e@privaterelay.appleid.com', is_private_email: 'true', nonce: crypto.createHash('sha256').update(nonce).digest('hex') });

  const b = await chromium.launch(); const errs = [];
  const mk = async (ua, reply) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA', userAgent: ua });
    await ctx.addInitScript(r => { window.__msgs = []; window.webkit = { messageHandlers: { peredai: { postMessage: m => { window.__msgs.push(JSON.parse(JSON.stringify(m)));
      if (m.t === 'apple') setTimeout(() => window.TeploHost.apple(window.__appleReply || r), 50); } } } }; }, reply);
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); return p;
  };
  const APPUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 PeredaiApp/1.0';
  const p = await mk(APPUA, { token: good, nonce, name: 'Іван Тест' });
  await p.goto(BASE); await p.evaluate(s => { localStorage.clear(); localStorage.setItem('teplo.v1', JSON.stringify(s)); localStorage.setItem('teplo.cc', JSON.stringify({ v: 1, a: 0, at: new Date().toISOString(), id: 'x' })); }, demo({ elec: true }));
  await p.goto('about:blank'); await p.goto(BASE + '#login'); await p.waitForTimeout(1200);
  ok('застосунок: «Увійти через Apple» — першим, перед Telegram', /Увійти через Apple/.test(await p.textContent('[data-key=login-apple-btn]').catch(() => '')) &&
    await p.evaluate(() => { const a = document.querySelector('[data-key=login-apple]'), t = document.querySelector('[data-key=login-telegram]'); return !t || !!(a.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  // скасування — без помилки
  await p.evaluate(() => { window.__appleReply = { err: 'cancel' }; }); await p.click('[data-key=login-apple-btn]'); await p.waitForTimeout(500);
  ok('скасували вхід — тихо, без тексту помилки', (await p.textContent('#apple-err')) === '' && (await p.evaluate(() => window.__msgs.filter(m => m.t === 'apple').length)) === 1);
  await p.evaluate(() => { window.__appleReply = null; }); await p.click('[data-key=login-apple-btn]'); await p.waitForTimeout(2500);
  const uid = +(sql(`SELECT user_id FROM user_identities WHERE type = 'apple' AND external_id = '${sub}'`).match(/\d+/) || [0])[0];
  ok('вхід: акаунт з Apple-ідентичністю, ім’я з застосунку, сторінка пішла з #login', uid > 0 && /Іван Тест/.test(sql(`SELECT name FROM users WHERE id = ${uid}`)) && !/#login$/.test(p.url()), { uid, url: p.url() });
  await p.goto(BASE + '#prefs-acc'); await p.waitForTimeout(1500);
  ok('Налаштування: рядок «Apple» з прихованим e-mail, без кнопки «Підключити Apple»', /Apple/.test(await p.textContent('[data-key=prefs-sync]')) && /privaterelay/.test(await p.textContent('[data-key=prefs-sync]')) && !(await p.$('[data-key=prefs-apple-link]')));
  // підроблений токен (інший ключ) — відмова, людина бачить текст
  const q = await mk(APPUA, { token: good.replace(/\.[^.]+$/, '.' + b64u('підробка')), nonce, name: '' });
  await q.goto(BASE + '#login'); await q.waitForTimeout(1000); await q.click('[data-key=login-apple-btn]'); await q.waitForTimeout(1500);
  ok('підроблений підпис — вхід не відбувся, під кнопкою зрозумілий текст', /#login$/.test(q.url()) && (await q.textContent('#apple-err')).length > 5, await q.textContent('#apple-err'));
  // звичайний браузер — кнопки немає
  const w = await mk('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', null);
  await w.goto(BASE + '#login'); await w.waitForTimeout(1000);
  ok('браузер: «Увійти через Apple» немає', !(await w.$('[data-key=login-apple]')));
  ok('без помилок JS', !errs.length, errs);
  await b.close(); console.log(`\n${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})();
