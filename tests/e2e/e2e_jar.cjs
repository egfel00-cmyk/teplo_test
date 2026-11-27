// 196-я: банка monobank «на каву» (власник 27.11: «на десктопі — зліва під кнопками меню ще одним пунктом; на мобілці — у Налаштуваннях одразу під акаунтом;
// «Банка на каву та сказати дякую» всіма мовами»). Посилання — /api/config → jar (за замовчуванням банка «передай», /admin → «Настройки» — інша).
// Нужен сайт 127.0.0.1:8013 (SITE_DATA=/tmp/teplo_data). node tests/e2e/e2e_jar.cjs [скрины в /tmp/jar-*.png]
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', JAR = /^https:\/\/send\.monobank\.ua\/jar\/[A-Za-z0-9]{6,24}$/;
(async () => {
  const b = await chromium.launch(); const errs = [];
  const open = async (w, lang, route, scheme) => {
    const ctx = await b.newContext({ viewport: { width: w, height: 860 }, locale: lang === 'ru' ? 'ru-RU' : 'uk-UA', colorScheme: scheme || 'dark' }); const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(U + 'api/health'); await p.evaluate(x => localStorage.setItem('teplo.v1', JSON.stringify(x)), demo({ lang }));
    await p.goto(U + '#' + route); await p.waitForTimeout(1800); return p;
  };
  const cfg = await (await open(390, 'uk', 'home')).evaluate(() => fetch('/api/config').then(r => r.json()));
  ok('/api/config → jar — посилання на банку monobank', JAR.test(cfg.jar || ''), cfg.jar);

  // комп'ютер: пункт під меню, за лінією; на ньому значок і текст; веде на банку в новій вкладці
  let p = await open(1280, 'uk', 'home');
  const nav = await p.evaluate(() => { const a = document.querySelector('.nav [data-key="nav-jar"]'), n = [...document.querySelectorAll('.nav a')];
    if (!a) return null; const r = a.getBoundingClientRect(), prev = n[n.indexOf(a) - 1].getBoundingClientRect();
    return { href: a.getAttribute('href'), tgt: a.target, txt: a.textContent.trim(), vis: getComputedStyle(a).display !== 'none', last: n[n.length - 1] === a, below: r.top >= prev.bottom + 8, svg: !!a.querySelector('svg'), w: r.width }; });
  ok('1280: «Банка на каву та сказати дякую» — останнім пунктом бічного меню, нижче за лінією, зі значком', nav && nav.vis && nav.last && nav.below && nav.svg && nav.txt === 'Банка на каву та сказати дякую', nav);
  ok('…посилання на банку в новій вкладці', nav && JAR.test(nav.href) && nav.tgt === '_blank', nav);
  ok('…рядка в Налаштуваннях на комп’ютері немає (не дублюємо)', await p.goto(U + '#prefs').then(() => p.waitForTimeout(1000)).then(() => p.evaluate(() => { const r = document.querySelector('[data-key="pgr-jar"]'); return !r || r.getBoundingClientRect().height === 0; })));
  await p.goto(U + '#home'); await p.waitForTimeout(800); await p.screenshot({ path: '/tmp/jar-1280.png' });
  const pl = await open(1280, 'uk', 'home', 'light'); await pl.screenshot({ path: '/tmp/jar-1280-light.png' });

  // телефон: у нижньому меню пункту немає; у Налаштуваннях — другим рядком групи «Акаунт», одразу під «Акаунт і синхронізація»
  p = await open(390, 'uk', 'home');
  ok('390: у нижньому меню банки немає', await p.evaluate(() => { const a = document.querySelector('.nav [data-key="nav-jar"]'); return !a || getComputedStyle(a).display === 'none'; }));
  await p.goto(U + '#prefs'); await p.waitForTimeout(1000);
  const pr = await p.evaluate(() => { const r = document.querySelector('[data-key="pgr-jar"]'); if (!r) return null; const ul = r.closest('ul'), li = [...ul.children];
    return { sec: r.closest('section').getAttribute('data-key'), i: li.indexOf(r.parentElement), prev: li[0].querySelector('a,button').getAttribute('data-key'), txt: r.textContent.replace(/\s+/g, ' ').trim(), href: r.getAttribute('href'), tgt: r.target, h: r.getBoundingClientRect().height }; });
  ok('390: Налаштування — рядок банки одразу під «Акаунтом» (та сама група)', pr && pr.sec === 'pgs-acc' && pr.i === 1 && pr.prev === 'pgr-acc' && pr.h > 40, pr);
  ok('…текст «Банка на каву та сказати дякую» і «monobank — підтримати «передай»», посилання на банку в новій вкладці', pr && /^Банка на каву та сказати дякую/.test(pr.txt) && /monobank — підтримати «передай»/.test(pr.txt) && JAR.test(pr.href) && pr.tgt === '_blank', pr);
  await p.screenshot({ path: '/tmp/jar-390-prefs.png' });

  // російська
  p = await open(390, 'ru', 'prefs');
  ok('ru: «Банка на кофе и сказать спасибо»', /Банка на кофе и сказать спасибо/.test(await p.textContent('[data-key="pgr-jar"]').catch(() => '')));
  p = await open(1280, 'ru', 'home');
  ok('ru 1280: пункт меню по-русски', /Банка на кофе и сказать спасибо/.test(await p.textContent('.nav [data-key="nav-jar"]').catch(() => '')));

  // застосунок iOS (UA PeredaiApp/ + міст) — не показуємо
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 PeredaiApp/1.0' });
  await ctx.addInitScript(() => { window.webkit = { messageHandlers: { peredai: { postMessage() {} } } }; });
  p = await ctx.newPage(); await p.goto(U + 'api/health'); await p.evaluate(x => localStorage.setItem('teplo.v1', JSON.stringify(x)), demo({}));
  await p.goto(U + '#prefs'); await p.waitForTimeout(1500);
  ok('застосунок iPhone: банки немає ні в меню, ні в Налаштуваннях (App Store 3.1.1)', !(await p.$('[data-key="pgr-jar"]')) && !(await p.$('[data-key="nav-jar"]')));
  ok('без помилок JS', !errs.length, errs);
  await b.close(); console.log(`\n${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})();
