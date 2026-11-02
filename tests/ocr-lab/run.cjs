// Прогон движка web/ocr/engine.js по картинкам в Chromium (Playwright), без сервера: файлы подаются через page.route.
// node tests/ocr-lab/run.cjs [water_cases.json] [id-фильтр]  → печать итогов, полные строки — /tmp/ocr_water.json
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..'), casesFile = process.argv[2] || 'water_cases.json', only = process.argv[3];
const cases = require('./' + casesFile).filter(c => !only || c.id.includes(only));
const types = { js: 'text/javascript', mjs: 'text/javascript', wasm: 'application/wasm', onnx: 'application/octet-stream', txt: 'text/plain', jpg: 'image/jpeg', png: 'image/png', html: 'text/html' };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('console', m => { if (m.type() === 'error' || /^DBG/.test(m.text())) console.log('[page]', m.text()); });
  await p.route('http://lab.test/**', r => {
    const u = new URL(r.request().url()); let f;
    if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset=utf-8><script src="/web/ocr/engine.js"></script><script src="/web/src/water.js"></script>' });
    if (u.pathname.startsWith('/img/')) f = path.resolve(process.env.IMG_DIR || path.join(__dirname, 'out'), decodeURIComponent(u.pathname.slice(5)));
    else f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: 'nf' });
    r.fulfill({ contentType: types[f.split('.').pop()] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await p.goto('http://lab.test/');
  await p.evaluate(() => TeploOCR.load('/web/ocr/'));
  // шаблоны цифр для ролика между цифрами — как на телефоне, где нет шрифта лаборатории: TPL_FONTS='["Arial, sans-serif"]'
  if (process.env.TPL_FONTS) await p.evaluate(f => { window.TEPLO_TPL_FONTS = JSON.parse(f); }, process.env.TPL_FONTS);
  const all = {}; let good = 0;
  for (const c of cases) {
    const img = c.file || (c.id + '.jpg');
    if (c.meters) {   // несколько водомеров в кадре: читаем все окна и раскладываем, как экран «З фото»
      const res = await p.evaluate(async ([img, meters, prevs]) => {
        const blob = await (await fetch('/img/' + img)).blob(); const r = await TeploOCR.read(blob, { all: true });
        return { r, a: TeploWater.assign([r], meters, prevs || {}) };
      }, [img, c.meters, c.prevs || null]);
      all[c.id] = res.r;
      const got = {}; Object.keys(c.truth).forEach(k => { const x = res.a.by[k]; got[k] = x ? (x.value ?? x.partial) : null; });
      const okk = Object.keys(c.truth).every(k => got[k] === c.truth[k]); if (okk) good++;
      const dr = (res.r.drums || []).map(d => d.text + (d.red ? ',' + d.red : '') + (d.hidden ? '+' + d.hidden + 'скрыто' : '') + '(' + (d.score || 0).toFixed(2) + (d.tint ? ' ' + d.tint : '') + ')').join(' ');
      console.log((okk ? ' OK ' : 'FAIL') + ' ' + c.id.padEnd(14) + ' truth=' + JSON.stringify(c.truth) + ' got=' + JSON.stringify(got) + '  ' + res.r.ms + 'ms  drums: ' + dr);
      continue;
    }
    const res = await p.evaluate(async ([img, prev]) => {
      const blob = await (await fetch('/img/' + img)).blob(); const r = await TeploOCR.read(blob);
      return { r, w: TeploWater.fromOcr(r, prev) };
    }, [img, c.prev ?? null]);
    all[c.id] = res.r;
    const truth = [].concat(c.truth), got = res.w && res.w.value, okk = truth.includes(got);
    // литры: что ушло бы в поле (frac) — должно быть началом настоящих красных (c.red), иначе ошибка
    if (res.w && res.w.frac) { const fr = String(c.red || ''); all['_frac_' + c.id] = res.w.frac; if (fr.indexOf(res.w.frac) !== 0 && !c.halfs && !(c.half)) console.log('  ЛИТРЫ мимо: ' + c.id + ' frac=' + res.w.frac + ' red=' + fr); }
    if (okk) good++;
    const dr = (res.r.drums || []).map(d => d.text + (d.red ? ',' + d.red : '') + (d.redSure ? '/' + d.redSure : '') + '(' + (d.score || 0).toFixed(2) + ')').join(' ');
    console.log((okk ? ' OK ' : 'FAIL') + ' ' + c.id.padEnd(14) + ' truth=' + truth.join('/') + ' got=' + got + '  ' + res.r.ms + 'ms  drums: ' + dr + '  lines: ' + res.r.lines.map(l => l.text).join(' | ').slice(0, 140));
  }
  fs.writeFileSync('/tmp/ocr_water.json', JSON.stringify(all));
  console.log(`\n${good}/${cases.length}`); await b.close();
})();
