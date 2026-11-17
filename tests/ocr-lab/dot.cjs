// Точка ЖК (lcdDot, 17.11.2026): движок по картинкам, строки из одних цифр — l.dot и отладка TeploOCR._dot. node dot.cjs <папка> a.jpg …
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const ROOT = '/home/claude/teplo_test', dir = process.argv[2], files = process.argv.slice(3);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('console', m => { if (m.type() === 'error') console.log('[page]', m.text().slice(0, 300)); });
  await p.route('http://lab.test/**', r => { const u = new URL(r.request().url()); if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><script src="/web/ocr/engine.js"></script><script src="/web/src/elec.js"></script><script src="/web/src/water.js"></script>' });
    const f = u.pathname.startsWith('/img/') ? path.join(dir, u.pathname.slice(5)) : path.join(ROOT, u.pathname); const ty = { js: 'text/javascript', mjs: 'text/javascript', wasm: 'application/wasm', png: 'image/png' }[f.split('.').pop()] || 'image/jpeg'; if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' }); r.fulfill({ body: fs.readFileSync(f), contentType: ty }); });
  await p.goto('http://lab.test/'); await p.evaluate(() => TeploOCR.load('/web/ocr/'));
  for (const f of files) {
    const out = await p.evaluate(async (f) => { const blob = await (await fetch('/img/' + f)).blob(); const rd = await TeploOCR.read(blob);
      const dl = rd.lines.filter(l => /^\d{4,9}$/.test(String(l.text).replace(/\s+/g, '')));
      const dbg = []; for (const l of dl) dbg.push([l.text, l.dot || 0, [l.x, l.y, l.w, l.h, l.angle], await TeploOCR._dot(blob, l)]);
      const E = window.TeploElec || window.TeploEl; let el = null;
      return { ms: rd.ms, lines: rd.lines.map(l => l.text + (l.dot ? '[dot' + l.dot + ']' : '')).join(' | ').slice(0, 300), drums: rd.drums.map(d => d.text + ',' + d.red), dbg };
    }, f);
    console.log(f, JSON.stringify(out));
  }
  await b.close();
})();
