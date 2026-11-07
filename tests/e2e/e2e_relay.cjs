// /admin → «Свет — ретранслятор на NAS»: включить (ключ и сценарий), «Скопировать сценарий», проверка без отправки и подача в очередь,
// ошибки ввода словами, пауза → «Продолжить», «Выключить». Нужен admin boss@teplo.test (как e2e_uaprobe). NAS здесь не запускаем —
// сквозной путь с настоящим sh-сценарием: php tests/relay_nas.php.
const { chromium } = require('playwright'); const fs = require('fs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', DATA = '/tmp/teplo_data';
(async () => {
  fs.rmSync(DATA + '/uploads/settings/relay.json', { force: true });
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' }); await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:8013' });
  const a = await ctx.newPage(); const errs = []; a.on('pageerror', e => errs.push(e.message)); a.on('dialog', d => d.accept());
  await a.goto(U); await a.evaluate(() => fetch('api/config'));
  const st = await a.evaluate(() => { const c = document.cookie.match(/ts_csrf=([^;]+)/)[1], h = { 'Content-Type': 'application/json', 'X-CSRF': decodeURIComponent(c) };
    return fetch('api/auth/register', { method: 'POST', headers: h, body: JSON.stringify({ email: 'boss@teplo.test', password: 'Boss-12345678' }) }).then(r => r.status === 200 ? 200 :
      fetch('api/auth/login', { method: 'POST', headers: h, body: JSON.stringify({ email: 'boss@teplo.test', password: 'Boss-12345678' }) }).then(r2 => r2.status)); });
  ok('админ вошёл', st === 200, st);
  await a.goto(U + 'admin'); await a.waitForSelector('[data-key=adm-relay]', { timeout: 8000 }).catch(() => {});
  ok('выключен: блок открыт, «выключен», кнопка «Включить»', await a.$eval('[data-key=adm-relay]', d => d.open).catch(() => false) && /выключен/.test(await a.textContent('[data-key=adm-relay] > summary')) && await a.isVisible('[data-relay=token]'));
  await a.click('[data-relay=token]'); await a.waitForSelector('[data-key=relay-script]', { state: 'attached', timeout: 8000 }).catch(() => {});
  const sum = await a.textContent('[data-key=adm-relay] > summary').catch(() => '');
  ok('включён: «NAS ещё не выходил на связь», сценарий и шаги DSM открыты', /ещё не выходил/.test(sum) && await a.isVisible('[data-key=relay-script]') && /Планировщик заданий/.test(await a.textContent('[data-key=adm-relay]')), sum);
  const sc = await a.textContent('[data-key=relay-script]');
  ok('сценарий: ключ, адрес сайта, белый список', /K='[0-9a-f]{40}'/.test(sc) && /S='http:\/\/127\.0\.0\.1:8013'/.test(sc) && /X-Relay-Key/.test(sc), sc.slice(0, 200));
  await a.click('[data-copy=relay-script]'); await a.waitForTimeout(300);
  const clip = await a.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  ok('«Скопировать сценарий» → в буфере сценарий, «Скопировано» рядом', clip === sc && /Скопировано/.test(await a.textContent('[data-key=adm-relay] [data-copied]')));
  ok('в очереди — проба страниц, «ждёт NAS»', /проба страниц/.test(await a.textContent('[data-key=adm-relay] table')) && /ждёт NAS/.test(await a.textContent('[data-key=adm-relay] table')));
  // ошибки ввода — словами
  await a.fill('[data-ra]', '12'); await a.fill('[data-rz=all]', '100'); await a.click('[data-relay=dry]'); await a.waitForTimeout(500);
  ok('короткий рахунок → «рахунок — 5–20 цифр»', /5–20 цифр/.test(await a.textContent('[data-key=relay-msg]')));
  await a.fill('[data-ra]', '1234567'); await a.fill('[data-rz=all]', ''); await a.fill('[data-rz=day]', '100'); await a.click('[data-relay=dry]'); await a.waitForTimeout(500);
  ok('только «день» → про зоны', /день \+ ночь/.test(await a.textContent('[data-key=relay-msg]')));
  await a.fill('[data-rz=day]', ''); await a.fill('[data-rz=all]', '10420'); await a.click('[data-relay=dry]'); await a.waitForTimeout(900);
  ok('проверка без отправки — в очереди с рахунком и цифрой', /проверка без отправки · 1234567 · 10420/.test(await a.textContent('[data-key=adm-relay] table')));
  const win = await a.evaluate(() => fetch('api/health').then(r => r.json()).then(j => j.relay.win));
  if (!win) { await a.fill('[data-ra]', '1234567'); await a.fill('[data-rz=all]', '10420'); await a.click('[data-relay=send]'); await a.waitForTimeout(500);
    ok('подача вне окна → «окно приёма закрыто»', /окно приёма закрыто/.test(await a.textContent('[data-key=relay-msg]'))); }
  await a.fill('[data-ra]', '1234567'); await a.fill('[data-rz=all]', '10420'); await a.check('[data-rforce]'); await a.click('[data-relay=send]'); await a.waitForTimeout(900);
  ok('подача (вне окна — с галочкой) — в очереди', /подача · 1234567 · 10420/.test(await a.textContent('[data-key=adm-relay] table')));
  // пауза (как после отказа сайта) → баннер и «Продолжить»
  const cf = JSON.parse(fs.readFileSync(DATA + '/uploads/settings/relay.json', 'utf8')); cf.paused = { at: Math.floor(Date.now() / 1000), why: 'cloudflare', job: 1 }; fs.writeFileSync(DATA + '/uploads/settings/relay.json', JSON.stringify(cf));
  await a.reload(); await a.waitForSelector('[data-key=adm-relay]', { timeout: 8000 }).catch(() => {});
  ok('пауза: «Cloudflare не пустил», кнопка «Продолжить», блок открыт', /Пауза/.test(await a.textContent('[data-key=adm-relay]')) && /Cloudflare не пустил/.test(await a.textContent('[data-key=adm-relay]')) && await a.$eval('[data-key=adm-relay]', d => d.open));
  await a.click('[data-relay=resume]'); await a.waitForTimeout(900);
  ok('«Продолжить» — паузы нет', !/Пауза — подачи/.test(await a.textContent('[data-key=adm-relay]')));
  ok('390 px — не шире экрана', await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await a.screenshot({ path: '/tmp/shot_admin_relay.png', fullPage: true });
  await a.click('[data-relay=off]'); await a.waitForTimeout(900);
  ok('«Выключить» — снова «выключен»', /выключен/.test(await a.textContent('[data-key=adm-relay] > summary')));
  ok('без ошибок JS', !errs.length, errs);
  console.log('Итог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
