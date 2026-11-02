// Полоса окна и маска светлого (как их видит разбор на ролики) → /tmp/strip_<фото>.png
// NODE_PATH=$(npm root -g) node tests/ocr-lab/strip.cjs h3.jpg   (IMG_DIR — своя папка)
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const ROOT = require('path').resolve(__dirname, '../..'), dir = process.env.IMG_DIR || ROOT + '/tests/ocr-lab/out', files = process.argv.slice(2);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.route('http://lab.test/**', r => { const u = new URL(r.request().url()); if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><script src="/web/ocr/engine.js"></script>' });
    const f = u.pathname.startsWith('/img/') ? path.join(dir, decodeURIComponent(u.pathname.slice(5))) : path.join(ROOT, decodeURIComponent(u.pathname)); if (!fs.existsSync(f)) return r.fulfill({status:404,body:'nf'});
    const ext = f.split('.').pop(); r.fulfill({ body: fs.readFileSync(f), contentType: {js:'text/javascript',mjs:'text/javascript',wasm:'application/wasm'}[ext] || 'application/octet-stream' }); });
  await p.goto('http://lab.test/'); await p.evaluate(() => TeploOCR.load('/web/ocr/'));
  for (const f of files) {
    const png = await p.evaluate(async (f) => { window.TEPLO_DRUM_LOG = true; window.TEPLO_HALF_IMG = []; const blob = await (await fetch('/img/' + f)).blob(); await TeploOCR._readDrums(blob);
      const ims = window.TEPLO_HALF_IMG; if (!ims.length) return null; const W = Math.max(...ims.map(i => i.w)), H = ims.reduce((a, i) => a + i.h * 2 + 4, 0);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d'); let y0 = 0;
      for (const im of ims) { const id = g.createImageData(im.w, im.h * 2); for (let i = 0; i < im.w * im.h; i++) { const v = im.L[i]; id.data[i*4]=id.data[i*4+1]=id.data[i*4+2]=v; id.data[i*4+3]=255; const j = i + im.w*im.h; const k = im.ink[i]; const lb = im.lab[i]; id.data[j*4]= k? (lb? 255: 120):0; id.data[j*4+1]= k? (lb? 255:120):0; id.data[j*4+2]= k? 80:0; id.data[j*4+3]=255; } g.putImageData(id, 0, y0); y0 += im.h * 2 + 4; }
      return cv.toDataURL(); }, f);
    if (png) { fs.writeFileSync('/tmp/strip_' + f.replace(/\W/g, '_') + '.png', Buffer.from(png.split(',')[1], 'base64')); console.log('wrote', f); }
  }
  await b.close(); })();
