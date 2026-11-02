// Экраны теплосчётчика: нарисовать (gen.html, шрифты DSEG рядом) → движок web/ocr/engine.js → разбор web/src/ocrparse.js.
// node tests/ocr-lab/heat.cjs [heat_err.json] [id-фильтр]   (NOMAKE=1 — не перерисовывать; IMG_DIR=… — свои фото, case.file)
// Итог «N/M», строки движка → /tmp/ocr_heat.json (из них — фикстуры tests/fixtures/ocr_synth.json).
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..'), OUT = path.join(__dirname, 'out');
const casesFile = process.argv[2] || 'heat_err.json', only = process.argv[3];
const cases = require('./' + casesFile).filter(c => !only || c.id.includes(only));
const types = { js: 'text/javascript', mjs: 'text/javascript', wasm: 'application/wasm', onnx: 'application/octet-stream', txt: 'text/plain', jpg: 'image/jpeg', png: 'image/png' };
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  if (!process.env.NOMAKE && !process.env.IMG_DIR) {   // нарисовать экраны
    const g = await b.newPage({ viewport: { width: 1000, height: 1300 } });
    await g.goto('file://' + __dirname + '/gen.html'); await g.evaluate(() => document.fonts.ready);
    for (const c of cases.filter(c => !c.file)) { await g.evaluate(c => window.setCase(c), c); await g.waitForTimeout(120); await g.screenshot({ path: path.join(OUT, c.id + '.jpg'), type: 'jpeg', quality: 80 }); }
    await g.close();
  }
  const p = await b.newPage();
  p.on('console', m => { if (m.type() === 'error') console.log('[page]', m.text()); });
  await p.route('http://lab.test/**', r => {
    const u = new URL(r.request().url()); let f;
    if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset=utf-8>' + ['/web/ocr/engine.js', '/web/src/models.js', '/web/src/ocrparse.js'].map(s => '<script src="' + s + '"></script>').join('') });
    if (u.pathname.startsWith('/img/')) f = path.resolve(process.env.IMG_DIR || OUT, decodeURIComponent(u.pathname.slice(5)));
    else f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: 'nf' });
    r.fulfill({ contentType: types[f.split('.').pop()] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await p.goto('http://lab.test/');
  await p.evaluate(() => TeploOCR.load('/web/ocr/'));
  const all = {}; let good = 0;
  for (const c of cases) {
    const res = await p.evaluate(async ([img, prev, model]) => {
      const blob = await (await fetch('/img/' + img)).blob(); const r = await TeploOCR.read(blob);
      const M = TeploModels, ctx = { models: M.MODELS, prev: prev || null };
      if (model) { ctx.modelId = model; ctx.steps = M.byId(model).steps; }
      return { r, p: TeploOCRParse.photo(r, ctx, 0) };
    }, [c.file || c.id + '.jpg', c.prev, c.model === undefined ? 'sharky774' : c.model]);
    all[c.id] = { w: res.r.w, h: res.r.h, lines: res.r.lines };
    const got = {}; res.p.photo.readings.forEach(x => { got[x.field] = x.value; });
    const mt = res.p.meter || {}; if ('serial' in c.truth) got.serial = mt.serial; if ('model' in c.truth) got.model = mt.modelId;
    const okk = Object.keys(c.truth).every(k => got[k] === c.truth[k]) && (c.only === false || Object.keys(got).every(k => k in c.truth));
    if (okk) good++;
    const ln = res.r.lines.map(l => l.text + (l.alts ? '[' + l.alts.join(',') + ']' : '')).join(' | ');
    console.log((okk ? ' OK ' : 'FAIL') + ' ' + c.id.padEnd(16) + ' truth=' + JSON.stringify(c.truth) + ' got=' + JSON.stringify(got) + (res.p.photo.note ? ' note=' + res.p.photo.note : '') + '  lines: ' + ln.slice(0, 160));
  }
  fs.writeFileSync('/tmp/ocr_heat.json', JSON.stringify(all));
  console.log(`\n${good}/${cases.length}`); await b.close();
})();
