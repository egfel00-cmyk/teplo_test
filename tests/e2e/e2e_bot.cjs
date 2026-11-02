const { chromium } = require('playwright'); const { execSync } = require('child_process'); const fs = require('fs');
const demo = require('./demo.cjs');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://127.0.0.1:8013/');
  const st = demo({}); st.water = [{ id: 'wb', place: 'main', date: '2026-10-01', base: true, vals: { h1: '500', c1: '130' }, createdAt: '2026-10-01T10:00:00Z', updatedAt: 1, sent: {} }];
  await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), st);
  const img = fs.readFileSync(process.argv[2] || '/tmp/two_meters.jpg').toString('base64');
  const up = await p.evaluate(async (b64) => {
    await fetch('/api/config'); const c = document.cookie.match(/ts_csrf=([^;]*)/)[1];
    await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF': c }, body: JSON.stringify({ email: 'bot' + Date.now() + '@ex.ua', password: 'e2e pass 123' }) });
    const me = await (await fetch('/api/me')).json();
    const bin = Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
    const r = await fetch('/api/recognize/upload', { method: 'POST', headers: { 'Content-Type': 'image/jpeg', 'X-CSRF': c }, body: new Blob([bin], { type: 'image/jpeg' }) });
    return { uid: me.user.id, id: (await r.json()).id };
  }, img);
  console.log('uploaded', up);
  execSync(`php -r '$p=new PDO("sqlite:/tmp/teplo_data/dev.sqlite"); $p->prepare("INSERT INTO bot_inbox (photo_id, user_id, taken_at, created_at) VALUES (?,?,?,?)")->execute(["${up.id}", ${up.uid}, time()-60, gmdate("c")]);'`);
  await p.goto('http://127.0.0.1:8013/?inbox=1#home');
  await p.waitForFunction(() => location.hash === '#wnew' && !document.querySelector('#wn-prog') && document.querySelector('[data-key=wn-photo-sum]'), null, { timeout: 240000 });
  await p.waitForTimeout(400);
  console.log(await p.evaluate(() => Array.from(document.querySelectorAll('[data-wn]')).map(i => i.getAttribute('data-wn') + '=' + i.value).join(' ')));
  await p.screenshot({ path: '/tmp/e2e_bot.png' });
  await p.click('[data-key=wn-save]'); await p.waitForTimeout(2500);
  const r = await p.evaluate(async () => { const w = JSON.parse(localStorage.getItem('teplo.v1')).water; const ib = await (await fetch('/api/inbox')).json(); return { photos: w[w.length - 1].photos, inbox: ib.items.length }; });
  console.log(JSON.stringify(r));
  console.log(errs.join('\n')); await b.close();
})();
