// окна барабана на фото: кандидаты findDrums + рамки на картинке → /tmp/win_<f>.png
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const ROOT = '/home/claude/teplo_test', dir = process.argv[2], files = process.argv.slice(3);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('console', m => { if (/^DBG/.test(m.text())) console.log('[page]', m.text().slice(0, 400)); });
  await p.route('http://lab.test/**', r => { const u = new URL(r.request().url()); if (u.pathname === '/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><script src="/web/ocr/engine.js"></script>' });
    const f = u.pathname.startsWith('/img/') ? path.join(dir, u.pathname.slice(5)) : path.join(ROOT, u.pathname); const ty = { js: 'text/javascript', mjs: 'text/javascript', wasm: 'application/wasm', png: 'image/png' }[f.split('.').pop()] || 'image/jpeg'; if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: 'nf' }); r.fulfill({ body: fs.readFileSync(f), contentType: ty }); });
  await p.goto('http://lab.test/'); await p.evaluate(() => TeploOCR.load('/web/ocr/'));
  for (const f of files) {
    const out = await p.evaluate(async ([f, prof, process_hint]) => { window.TEPLO_PROF = prof; window.TEPLO_DRUM_DBG = { rad: 0 }; const blob = await (await fetch('/img/' + f)).blob(); const rr = await TeploOCR.read(blob); let sx = 0, sy = 0, n = 0;
      rr.lines.forEach(l => { if (l.score < 0.85 || l.lcd || !/[A-Za-zА-Яа-яІіЇїЄє]{2}/.test(l.text) || l.w < l.h * 1.5) return; sx += Math.cos(2 * (l.angle || 0)); sy += Math.sin(2 * (l.angle || 0)); n++; });
      const hint = n >= 2 && Math.hypot(sx, sy) >= 0.8 * n ? Math.atan2(sy, sx) / 2 : null; window.TEPLO_DRUM_DBG = { rad: 0 };
      const c = await TeploOCR._drums(blob, process_hint === 'off' ? null : hint); window._hint = [hint, rr.lines.filter(l => l.score >= 0.85 && /[A-Za-zА-Яа-яІіЇїЄє]{2}/.test(l.text)).map(l => l.text + '@' + (l.angle || 0).toFixed(3))];
      const bm = await createImageBitmap(blob); const cv = document.createElement('canvas'); cv.width = bm.width; cv.height = bm.height; const g = cv.getContext('2d'); g.drawImage(bm, 0, 0); g.lineWidth = 3;
      c.forEach((d, i) => { g.save(); g.translate(d.cx, d.cy); g.rotate(d.angle); g.strokeStyle = ['#0f0', '#ff0', '#0ff', '#f0f', '#fff'][i]; g.strokeRect(-d.w / 2, -d.h / 2, d.w, d.h); g.restore(); });
      return { png: cv.toDataURL(), cands: c.map(d => ({ cx: Math.round(d.cx), cy: Math.round(d.cy), w: Math.round(d.w), h: Math.round(d.h), a: +d.angle.toFixed(3), sc: d.score, rad: d.rad, n: d.cells, sure: d.sure })), rej: window.TEPLO_DRUM_DBG.rej.filter(r => r[0] === 'tilt'), hint: window._hint }; }, [f, !!process.env.PROF, process.env.HINT || '']);
    fs.writeFileSync('/tmp/win_' + f.replace(/\W/g, '_') + '.png', Buffer.from(out.png.split(',')[1], 'base64'));
    console.log(f, JSON.stringify(out.cands), '\n tilt', JSON.stringify(out.rej), '\n hint', JSON.stringify(out.hint));
  }
  await b.close(); })();
