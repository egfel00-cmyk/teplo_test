// Тепло по фото без входа (распознавание в браузере): #photo → выбрать картинки → «Розпізнати» → экран результата.
// cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_heat_photo.cjs ../ocr-lab/out/s774_energy.jpg ../ocr-lab/out/e8_rx.jpg
// Печатает значения полей результата (#phv-<поле>), скриншот → /tmp/shot_heat_photo.png. Картинки: node ../ocr-lab/heat.cjs
const { chromium } = require('playwright'); const path = require('path');
const demo = require('./demo.cjs');
(async () => {
  const files = process.argv.slice(2).map(f => path.resolve(f)); const want = process.env.WANT ? JSON.parse(process.env.WANT) : null;
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|ERR_NAME|401/.test(m.text())) errs.push('console: ' + m.text()); });   // внешние сайты и 401 без входа — шум стенда
  await p.goto('http://127.0.0.1:8013/');
  await p.evaluate(s => { localStorage.setItem('teplo.v1', JSON.stringify(s)); }, demo({}));
  await p.goto('http://127.0.0.1:8013/#photo'); await p.reload(); await p.waitForTimeout(600);
  await p.setInputFiles('#ph-input', files); await p.waitForTimeout(300);
  await p.click('[data-act="ph-run"]');
  await p.waitForSelector('[data-ph]', { timeout: 240000 });
  const vals = await p.$$eval('[data-ph]', els => Object.fromEntries(els.map(e => [e.getAttribute('data-ph'), e.value])));
  const notes = await p.$$eval('.banner, .small.muted', els => els.map(e => e.textContent.trim()).filter(Boolean).slice(0, 6));
  await p.screenshot({ path: '/tmp/shot_heat_photo.png', fullPage: true });
  console.log(JSON.stringify(vals)); console.log(notes.join('\n'));
  let ok = true; if (want) for (const k in want) if (vals[k] !== want[k]) { ok = false; console.log('FAIL ' + k + ': ' + vals[k] + ' ≠ ' + want[k]); }
  if (errs.length) { ok = false; console.log(errs.join('\n')); }
  console.log(ok ? 'OK' : 'FAIL'); await b.close(); process.exit(ok ? 0 : 1);
})();
