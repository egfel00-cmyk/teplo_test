// Отладка поиска окна барабана: маска тёмного (серым), красного (красным), блоки (зелёные рамки) → /tmp/dbg_<id>.png
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '../..'), dir = process.argv[2], files = process.argv.slice(3);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.route('http://lab.test/**', r => { const u = new URL(r.request().url()); if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><script src="/web/ocr/engine.js"></script>' });
    const f = u.pathname.startsWith('/img/') ? path.join(dir, u.pathname.slice(5)) : path.join(ROOT, u.pathname); r.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.js') ? 'text/javascript' : 'image/jpeg' }); });
  await p.goto('http://lab.test/');
  for (const f of files) {
    const out = await p.evaluate(async ([f, RAD]) => { window.TEPLO_DRUM_DBG = { rad: RAD }; const blob = await (await fetch('/img/' + f)).blob(); const c = await TeploOCR._drums(blob); const d = window.TEPLO_DRUM_DBG;
      const cv = document.createElement('canvas'); cv.width = d.W; cv.height = d.H; const g = cv.getContext('2d'); const id = g.createImageData(d.W, d.H);
      for (let i = 0; i < d.W * d.H; i++) { id.data[i * 4 + 3] = 255; if (d.red[i]) { id.data[i * 4] = 230; } else if (d.dark[i]) { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 90; } else { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 235; } }
      g.putImageData(id, 0, 0); g.lineWidth = 1.5;
      d.blocks.forEach(bl => { g.save(); g.translate(bl.cx, bl.cy); g.rotate(bl.a); g.strokeStyle = bl.cells ? '#0a0' : '#00f'; g.strokeRect(-bl.U / 2, -bl.V / 2, bl.U, bl.V); g.restore(); });
      return { png: cv.toDataURL(), cands: c, rej: d.rej.slice(0, 12), nb: d.blocks.length }; }, [f, +(process.env.RAD||0)]);
    fs.writeFileSync('/tmp/dbg_' + f.replace(/\W/g, '_') + '.png', Buffer.from(out.png.split(',')[1], 'base64'));
    console.log(f, 'blocks', out.nb, 'cands', JSON.stringify(out.cands), '\n rej', JSON.stringify(out.rej.map(r => r.map(x => typeof x === 'number' ? +x.toFixed(2) : x))));
  }
  await b.close(); })();
