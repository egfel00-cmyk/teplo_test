// Електролічильник з ЖК-табло (НІК 2100 тощо): рушій + TeploElec.fromPhotos, як екран «З фото» світла.
// IMG_DIR=/шлях node tests/ocr-lab/lcd.cjs my.local.json [фільтр]   ([{id, file, truth: {all|day|night}, zones?, prev?}], *.local.json — не в git)
// Друкує рядки рушія (lcd — з проходу по табло), кандидатів і що лягло в поля. Справжні фото людей у репозиторій не класти.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..'), casesFile = process.argv[2], only = process.argv[3];
const cases = JSON.parse(fs.readFileSync(path.resolve(casesFile), 'utf8')).filter(c => !only || c.id.includes(only));
const types = { js: 'text/javascript', mjs: 'text/javascript', wasm: 'application/wasm', onnx: 'application/octet-stream', txt: 'text/plain', jpg: 'image/jpeg', png: 'image/png' };
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('console', m => { if (m.type() === 'error' || /^(DBG|LCD)/.test(m.text())) console.log('[page]', m.text()); });
  await p.route('http://lab.test/**', r => {
    const u = new URL(r.request().url()); let f;
    if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset=utf-8><script src="/web/ocr/engine.js"></script><script src="/web/src/elec.js"></script>' });
    if (u.pathname.startsWith('/img/')) f = path.resolve(process.env.IMG_DIR || path.join(__dirname, 'out'), decodeURIComponent(u.pathname.slice(5)));
    else f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: 'nf' });
    r.fulfill({ contentType: types[f.split('.').pop()] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  await p.goto('http://lab.test/');
  if (process.env.LCD_LOG) await p.evaluate(() => { window.TEPLO_LCD_LOG = 1; });
  await p.evaluate(() => TeploOCR.load('/web/ocr/'));
  let good = 0; const all = {};
  for (const c of cases) {
    const res = await p.evaluate(async ([img, zones, prev]) => {
      const blob = await (await fetch('/img/' + img)).blob(); const r = await TeploOCR.read(blob);
      const El = TeploElec.make ? TeploElec : null, m = { id: 'm1', zones: zones || 1 };
      const by = TeploElec.fromPhotos([{ lines: r.lines, drum: null }], [m], prev ? { m1: prev } : {}, {});
      return { r, by: by.m1, cands: TeploElec.ocrCands({ lines: r.lines }) };
    }, [c.file || c.id + '.jpg', c.zones || 1, c.prev || null]);
    all[c.id] = res.r;
    const got = {}; Object.keys(c.truth).forEach(k => { const x = res.by[k]; got[k] = x ? +(x.v + (x.frac ? '.' + x.frac : '')) : null; });
    // ціле кВт·год (у постачальника — ціле): дробову частину не вимагаємо
    const okk = Object.keys(c.truth).every(k => got[k] !== null && Math.floor(got[k]) === Math.floor(c.truth[k])) && Object.keys(res.by).every(k => k in c.truth); if (okk) good++;
    console.log((okk ? ' OK ' : 'FAIL') + ' ' + c.id.padEnd(10) + ' truth=' + JSON.stringify(c.truth) + ' got=' + JSON.stringify(got) + ' ' + JSON.stringify(res.by) + '  ' + res.r.ms + 'ms');
    if (process.env.V) {
      console.log('  lines: ' + res.r.lines.map(l => l.text + (l.lcd ? '[lcd]' : '') + (l.dot ? '[.' + l.dot + ']' : '') + '@' + Math.round(l.x) + ',' + Math.round(l.y) + ' h' + Math.round(l.h)).join(' | '));
      console.log('  cands: ' + res.cands.map(x => x.digits + (x.frac ? '.' + x.frac : '') + (x.zone != null ? ' z' + x.zone : '') + ' s' + Math.round(x.score)).join(' | '));
    }
  }
  fs.writeFileSync('/tmp/ocr_lcd.json', JSON.stringify(all));
  console.log(`\n${good}/${cases.length}`); await b.close();
})();
