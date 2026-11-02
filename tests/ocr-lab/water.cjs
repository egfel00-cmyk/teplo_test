// Рисует синтетические водомеры (water.html + water_cases.json) → tests/ocr-lab/out/<id>.jpg
const { chromium } = require('playwright'); const cases = require('./water_cases.json'); const fs = require('fs');
(async () => { fs.mkdirSync(__dirname + '/out', { recursive: true });
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 1600 } });
  await p.goto('file://' + __dirname + '/water.html');
  for (const c of cases) { await p.evaluate(c => window.setCase(c), c); await p.waitForTimeout(80); await p.screenshot({ path: __dirname + '/out/' + c.id + '.jpg', type: 'jpeg', quality: 72 }); }
  await b.close(); console.log('ok', cases.length); })();
