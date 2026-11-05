// Журнал действий: приложение шлёт события (open, screen, tap, field, saved, alert/toast), /admin → «Журнал» рисует сеансы и ленту словами.
// Нужен сайт 127.0.0.1:8013 (SITE_DATA=/tmp/teplo_data). navigator.webdriver подменяем — иначе журнал (как и визиты) молчит.
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
const U = 'http://127.0.0.1:8013/';
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 600) : '')); } };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const sent = []; await p.route('**/api/events', async r => { try { sent.push(JSON.parse(r.request().postData() || '{}')); } catch (e) { /* */ } await r.continue(); });
  await p.goto(U); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo({ today: new Date().toISOString().slice(0, 10) })); await p.reload(); await p.waitForTimeout(800);
  await p.click('[data-key=nav-history], a[href="#history"]').catch(() => {}); await p.waitForTimeout(300);
  await p.goto(U + '#home'); await p.waitForTimeout(300);
  await p.evaluate(() => { const el = document.createElement('div'); el.setAttribute('role', 'alert'); el.textContent = 'Перевірте цифри'; document.querySelector('main, body').appendChild(el); });
  await p.waitForTimeout(700);
  await p.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(800);
  const ev = sent.flatMap(x => x.ev || []), names = ev.map(e => e.n), vids = [...new Set(sent.map(x => x.vid))];
  ok('приложение шлёт события: open, screen, tap; один браузер (vid) и сеанс (sid)', names.includes('open') && names.includes('screen') && names.includes('tap') && vids.length === 1 && sent.every(x => x.sid && x.sid === sent[0].sid), names);
  ok('сообщение на экране (role=alert) попало в журнал', ev.some(e => e.n === 'alert' && /Перевірте цифри/.test((e.p || {}).m || '')), ev.filter(e => e.n === 'alert'));
  ok('у нажатия — подпись кнопки или data-act/data-key, без значений полей', ev.filter(e => e.n === 'tap').every(e => e.p && (e.p.x || e.p.a || e.p.k || e.p.h)), ev.filter(e => e.n === 'tap').slice(0, 3));
  // /admin → Журнал (ответы API подменены: проверяем, как вкладка рисует данные)
  const a = await ctx.newPage(); a.on('pageerror', e => errs.push('admin: ' + e.message));
  await a.route('**/api/admin/**', r => { const u = r.request().url();
    const j = /admin\/me/.test(u) ? { admin: true, email: 'boss@example.ua' } : /overview/.test(u) ? { me: 'boss@example.ua', cronAgo: 10, telegram: true }
      : /journal\/session/.test(u) ? { vid: 'abc12345phone', sid: 'sessA1', label: 'Гость B681', tag: null, events: [
          { at: '2026-11-05T06:00:00+00:00', n: 'open', s: 'home', p: { tg: 1, w: 390, li: 0, places: 1, meters: 0, recs: 0 } }, { at: '2026-11-05T06:00:05+00:00', n: 'tap', s: 'home', p: { a: 'wadd', x: 'Додати лічильник' } },
          { at: '2026-11-05T06:00:09+00:00', n: 'field', s: 'wnew', p: { f: 'wn-c1', v: 1, ok: 0 } }, { at: '2026-11-05T06:00:12+00:00', n: 'saved', s: 'wnew', p: { m: 1, li: 0 } },
          { at: '2026-11-05T06:00:20+00:00', n: 'ocr', s: 'wnew', p: { ok: 0, ms: 2100 } }, { at: '2026-11-05T06:00:25+00:00', n: 'api_error', s: 'wnew', p: { p: '/vk/cab/check', c: 422, e: 'bad_acc' } }] }
      : /journal/.test(u) ? { days: 7, hidden: 2, funnel: { opened: 3, tapped: 3, meter: 2, reading: 1, photo: 1, photoFail: 1, errors: 1, login: 0 }, sessions: [{ vid: 'abc12345phone', sid: 'sessA1', label: 'Гость B681', tag: null, from: '2026-11-05T06:00:00+00:00', to: '2026-11-05T06:03:00+00:00', n: 6, errs: 1, toasts: 0, saves: 1, user: null, dev: { device: 'mobile', os: 'iOS', tgapp: 1 }, path: ['home', 'wnew'] }] }
      : {};
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) }); });
  await a.goto(U + 'admin#journal'); await a.waitForTimeout(700);
  const jt = await a.textContent('main').catch(() => '');
  ok('/admin «Журнал»: шаги (добавили счётчик 2, фото не распознано 1), сеанс «Гость B681», «свои и тестовые скрыты — 2»', /Журнал действий/.test(jt) && /Гость B681/.test(jt) && /скрыты — 2/.test(jt) && /Добавили счётчик\s*2/.test(jt) && /ошибок 1/.test(jt), jt.slice(0, 400));
  await a.click('tr[data-js]', { timeout: 5000 }).catch(() => {}); await a.waitForTimeout(600);
  const st = await a.textContent('main').catch(() => '');
  ok('лента сеанса словами: «Нажал «Додати лічильник»», «Поле wn-c1: заполнено — НЕВЕРНО», «Сохранено: +1 счётч. (без входа…)», «Фото: цифр не нашли», «Ошибка сервера 422»',
    /Нажал «Додати лічильник»/.test(st) && /Поле wn-c1: заполнено — НЕВЕРНО/.test(st) && /Сохранено: \+1 счётч\. \(без входа/.test(st) && /Фото: цифр не нашли/.test(st) && /Ошибка сервера 422 «bad_acc»/.test(st) && /Это я/.test(st), st.slice(0, 500));
  ok('без ошибок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
