// Фото в карточке записи на другом устройстве: телефон A (вошёл) вносит воду по фото → фото уходит на сервер (kept=1)
// и id в записи меняется на серверный → телефон B входит тем же аккаунтом → карточка записи показывает то же фото.
// node e2e_two_devices.cjs <фото водомера> → /tmp/e2e_dev_{a,b}.png
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
const BASE = process.env.BASE || 'http://127.0.0.1:8013/', email = 'two' + Date.now() + '@example.ua', pass = 'two devices 123';
const login = (p, path) => p.evaluate(async ([path, email, pass]) => { const t = (document.cookie.match(/ts_csrf=([^;]*)/) || [])[1];
  return (await fetch('api/auth/' + path, { method: 'POST', body: JSON.stringify({ email, password: pass }), headers: { 'Content-Type': 'application/json', 'X-CSRF': t } })).status; }, [path, email, pass]);
(async () => {
  const b = await chromium.launch(), errs = [];
  const dev = async () => { const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); return p; };
  const A = await dev();
  await A.goto(BASE); const st = demo({}); st.places[0].water.meters.forEach(m => m.serial = '');
  await A.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), st);
  console.log('A register', await login(A, 'register'));
  await A.goto(BASE + '#wnew'); await A.reload(); await A.waitForTimeout(1500);
  await A.setInputFiles('#wn-files', [process.argv[2]]);
  await A.waitForFunction(() => !document.querySelector('#wn-prog'), null, { timeout: 240000 }); await A.waitForTimeout(300);
  await A.click('[data-key=wn-save]');
  // фото догружается на сервер, id «l:…» меняется на серверный, состояние синхронизируется
  await A.waitForFunction(() => { const w = JSON.parse(localStorage.getItem('teplo.v1')).water || []; const r = w[w.length - 1]; return r && r.photos && r.photos.length && r.photos.every(x => !/^l:/.test(x.id)); }, null, { timeout: 60000 });
  const rec = await A.evaluate(() => { const w = JSON.parse(localStorage.getItem('teplo.v1')).water; return w[w.length - 1]; });
  console.log('A record', rec.id, JSON.stringify(rec.vals), JSON.stringify(rec.photos));
  await A.waitForTimeout(4000);   // синхронизация
  await A.goto(BASE + '#wrec-' + rec.id); await A.waitForTimeout(1200); await A.screenshot({ path: '/tmp/e2e_dev_a.png', fullPage: true });
  const B = await dev();
  await B.goto(BASE); console.log('B login', await login(B, 'login'));
  await B.goto(BASE + '#home'); await B.reload(); await B.waitForTimeout(3000);
  const has = await B.evaluate(id => ((JSON.parse(localStorage.getItem('teplo.v1') || '{}').water) || []).some(r => r.id === id), rec.id);
  console.log('B has record', has);
  await B.goto(BASE + '#wrec-' + rec.id); await B.waitForTimeout(2500);
  const imgs = await B.evaluate(() => Array.from(document.querySelectorAll('img[data-gal]')).map(i => i.getAttribute('src').slice(0, 60) + ' ' + i.naturalWidth + 'x' + i.naturalHeight));
  console.log('B photos in card:', imgs.join(' | ') || 'нет');
  await B.screenshot({ path: '/tmp/e2e_dev_b.png', fullPage: true });
  if (imgs.length) { await B.click('img[data-gal]'); await B.waitForTimeout(800); await B.screenshot({ path: '/tmp/e2e_dev_b_zoom.png' }); }
  console.log(imgs.length && imgs.every(s => !/ 0x0$/.test(s)) && has ? 'OK' : 'FAIL', errs.join('; '));
  await b.close();
})();
