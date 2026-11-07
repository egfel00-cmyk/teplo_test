// /admin → «Свет — пускает ли обленерго робота из Украины»: без пробы — команда и «Скопировать»; две пробы (Cloudflare / пускает) → итог словами.
const { chromium } = require('playwright'); const fs = require('fs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', DATA = '/tmp/teplo_data';
(async () => {
  fs.rmSync(DATA + '/cache/ua_probe', { recursive: true, force: true });
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' }); await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:8013' });
  const a = await ctx.newPage(); const errs = []; a.on('pageerror', e => errs.push(e.message));
  await a.goto(U); await a.evaluate(() => fetch('api/config'));
  const st = await a.evaluate(() => { const c = document.cookie.match(/ts_csrf=([^;]+)/)[1], h = { 'Content-Type': 'application/json', 'X-CSRF': decodeURIComponent(c) };
    return fetch('api/auth/register', { method: 'POST', headers: h, body: JSON.stringify({ email: 'boss@teplo.test', password: 'Boss-12345678' }) }).then(r => r.status === 200 ? 200 :
      fetch('api/auth/login', { method: 'POST', headers: h, body: JSON.stringify({ email: 'boss@teplo.test', password: 'Boss-12345678' }) }).then(r2 => r2.status)); });
  ok('админ вошёл', st === 200, st);
  await a.goto(U + 'admin'); await a.waitForSelector('[data-key=adm-uaprobe]', { timeout: 8000 }).catch(() => {});
  const t0 = await a.textContent('[data-key=adm-uaprobe]').catch(() => '');
  ok('без пробы: блок открыт, «ещё не запускали», шаги NAS и Mac', await a.$eval('[data-key=adm-uaprobe]', d => d.open).catch(() => false) && /ещё не запускали/.test(t0) && /Планировщик заданий/.test(t0) && /Терминал/.test(t0), t0.slice(0, 200));
  const cmd = await a.textContent('[data-key=ua-cmd]').catch(() => '');
  ok('команда — та же, что RelayProbe::command (адрес сайта, обе страницы)', /api\/relay\/probe\?t=\$t&via=nas/.test(cmd) && /pa\.oblenergo/.test(cmd) && /transmissionofmeterreadings/.test(cmd) && /^UA='/.test(cmd), cmd.slice(0, 120));
  await a.click('[data-copy=ua-cmd]'); await a.waitForTimeout(300);
  const clip = await a.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  ok('«Скопировать команду» → в буфере ровно команда, «Скопировано»', clip === cmd && /Скопировано/.test(await a.textContent('[data-key=ua-copied]')), [clip.length, cmd.length]);
  ok('390 px — не шире экрана', await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  // две пробы: кабинет — Cloudflare challenge, форма — 200 с формой, обе из UA
  const post = (t, body) => fetch(U + 'api/relay/probe?t=' + t + '&via=nas', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'CF-IPCountry': 'UA' }, body }).then(r => r.json());
  const cf = 'HTTP/1.1 403 Forbidden\r\nServer: cloudflare\r\ncf-mitigated: challenge\r\ncf-ray: 1\r\n\r\n<html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>\n#lichylnyky 403 0 0.4\n';
  const fm = 'HTTP/1.1 200 OK\r\nServer: nginx\r\n\r\n<html><head><title>Передача показників</title></head><body><form id="f" method="post" action="/uk/send"><input name="account" required><input name="value"><button>Надіслати</button></form></body></html>\n#lichylnyky 200 0 0.3\n';
  const r1 = await post('obl', cf), r2 = await post('form', fm);
  ok('сервер разобрал: кабинет — cloudflare, форма — ok, страна UA', r1.verdict === 'cloudflare' && r2.verdict === 'ok' && r1.cc === 'UA' && r2.cc === 'UA', [r1, r2]);
  await a.reload(); await a.waitForSelector('[data-key=adm-uaprobe]', { timeout: 8000 }).catch(() => {});
  const t1 = await a.textContent('[data-key=adm-uaprobe] > summary').catch(() => '') , body1 = await a.textContent('[data-key=adm-uaprobe]').catch(() => '');
  ok('есть итог: свёрнут, «проба: 2 из 2»', !(await a.$eval('[data-key=adm-uaprobe]', d => d.open)) && /проба: 2 из 2/.test(t1), t1);
  ok('…вывод «Ретранслятор на NAS реален — начать с онлайн-формы», строки «Cloudflare» и «пускает», «Украина»', /начать с онлайн-формы/.test(body1) && /Cloudflare/.test(body1) && /пускает/.test(body1) && /Украина/.test(body1), body1.slice(0, 300));
  ok('…команда спрятана в «Запустить ещё раз»', !(await a.isVisible('[data-key=ua-cmd]')) && /Запустить ещё раз/.test(body1));
  // обе закрыты → вручную
  await post('form', fm.replace('<form', '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script><form'));
  await a.reload(); await a.waitForSelector('[data-key=adm-uaprobe]', { timeout: 8000 }).catch(() => {});
  ok('кабинет Cloudflare + форма с Turnstile → «Свет остаётся вручную»', /Свет остаётся вручную/.test(await a.textContent('[data-key=adm-uaprobe]')));
  // не из Украины
  await fetch(U + 'api/relay/probe?t=obl&via=mac', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'CF-IPCountry': 'DE' }, body: fm.replace('name="account"', 'name="LoginForm[password]"') });
  await post('form', 'HTTP/1.1 502 Bad Gateway\r\n\r\n\n#lichylnyky 502 0 0.3\n');
  await a.reload(); await a.waitForSelector('[data-key=adm-uaprobe]', { timeout: 8000 }).catch(() => {});
  const t3 = await a.textContent('[data-key=adm-uaprobe]');
  ok('кабинет ok, но страна DE → «Запуск был не из Украины», DE видно', /не из Украины/.test(t3) && /DE/.test(t3) && !/реален/.test(t3), t3.slice(0, 300));
  ok('без ошибок JS', !errs.length, errs);
  fs.rmSync(DATA + '/cache/ua_probe', { recursive: true, force: true });
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
