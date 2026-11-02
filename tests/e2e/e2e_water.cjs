// Вода по фото: пачка → раскладка. node e2e_water.cjs '<opts>' file1 [file2 ...] → /tmp/e2e_*.png
const { chromium } = require('playwright');
const demo = require('./demo.cjs');
(async () => {
  const opts = JSON.parse(process.argv[2] || '{}'), files = process.argv.slice(3);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto('http://127.0.0.1:8013/');
  const st = demo(opts);
  if (opts.base) { st.water = [{ id: 'wb', place: 'main', date: '2026-10-01', base: true, vals: opts.base, createdAt: '2026-10-01T10:00:00Z', updatedAt: 1, sent: {} }]; }
  if (opts.noSerial) st.places[0].water.meters.forEach(m => m.serial = '');
  await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), st);
  await p.goto('http://127.0.0.1:8013/#wnew'); await p.reload(); await p.waitForTimeout(800);
  await p.screenshot({ path: '/tmp/e2e_0.png' });
  await p.setInputFiles('#wn-files', files);
  const t0 = Date.now();
  await p.waitForFunction(() => !document.querySelector('#wn-prog'), null, { timeout: 240000 });
  console.log('recognized in', Date.now() - t0, 'ms');
  await p.waitForTimeout(300);
  const vals = await p.evaluate(() => Array.from(document.querySelectorAll('[data-wn]')).map(i => i.getAttribute('data-wn') + '=' + i.value + ' :: ' + document.getElementById('wh-' + i.getAttribute('data-wn')).textContent));
  console.log(vals.join('\n'));
  const sum = await p.evaluate(() => (document.querySelector('[data-key=wn-photo-sum]') || {}).innerText);
  console.log('summary:', sum);
  await p.screenshot({ path: '/tmp/e2e_1.png', fullPage: true });
  if (opts.save) {
    await p.click('[data-key=wn-save]'); await p.waitForTimeout(1500);
    const s = await p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')).water.map(r => [r.date, JSON.stringify(r.vals), JSON.stringify(r.photos || [])]));
    console.log('saved:', JSON.stringify(s));
    const id = await p.evaluate(() => { const w = JSON.parse(localStorage.getItem('teplo.v1')).water; return w[w.length - 1].id; });
    await p.goto('http://127.0.0.1:8013/#wrec-' + id); await p.waitForTimeout(1200);
    await p.screenshot({ path: '/tmp/e2e_2.png', fullPage: true });
    await p.goto('http://127.0.0.1:8013/#history'); await p.waitForTimeout(800);
    await p.screenshot({ path: '/tmp/e2e_3.png' });
  }
  if (errs.length) console.log(errs.join('\n'));
  await b.close();
})();
