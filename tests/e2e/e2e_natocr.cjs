// 160-а: застосунок iPhone читає текст вбудованим Vision (apps/ios NativeOCR.swift) — сайт шле кадр у webkit.messageHandlers.peredaiOcr і розбирає рядки сам.
// Тут Vision підмінено: відповідь — рядки, як дав би NativeOCR (у пікселях надісланого кадру). Перевіряємо: тепло з фото — показання без рушія сайту
// (engine.js не вантажиться), «це не теплолічильник» — теж; Vision нічого не дав — рушій сайту (запасний шлях); кадр камери — Vision з fast.
// Нужен сайт 127.0.0.1:8013 (SITE_DATA=/tmp/teplo_data). NODE_PATH=$(npm root -g) node tests/e2e/e2e_natocr.cjs
const { chromium } = require('playwright'); const path = require('path'); const demo = require('./demo.cjs');
const U = 'http://127.0.0.1:8013/', IMG = path.resolve(__dirname, '../../apps/ios/ci/ocr-heat-synth.jpg');   // 769×1000
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const L = (text, x, y, w, h, score = 1) => ({ text, score, x, y, w, h, angle: 0 });
const HEAT = { lines: [L('SHARKY 774', 192, 234, 163, 24), L('00015.482', 234, 349, 305, 51), L('Gcal', 523, 423, 58, 27)], ms: 140 };
const WATER = { lines: [L('NOVATOR', 154, 200, 72, 30), L('00 50231', 154, 300, 82, 35), L('x0,0001', 154, 500, 72, 25), L('No 1234567', 154, 550, 103, 30)], ms: 120 };
(async () => {
  const b = await chromium.launch();
  const mk = async (reply) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' });
    await ctx.addInitScript(r => {
      window.PeredaiNative = { v: 4, ocr: 1 }; window.__ocr = [];
      window.webkit = { messageHandlers: { peredai: { postMessage: () => {} }, peredaiOcr: { postMessage: m => { window.__ocr.push({ fast: !!m.fast, jpeg: /^data:image\/jpeg;base64,/.test(m.img), len: m.img.length }); return Promise.resolve(JSON.stringify(window.__natReply || r)); } } } };
    }, reply);
    const p = await ctx.newPage(), errs = [], eng = []; p.on('pageerror', e => errs.push(e.message));
    p.on('request', q => { if (/\/web\/ocr\/(engine\.js|.*\.onnx|.*\.wasm)/.test(q.url())) eng.push(q.url().replace(/.*\/web\/ocr\//, '')); });
    await p.goto(U); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo({}));
    await p.goto(U + '#photo'); await p.reload(); await p.waitForTimeout(600);
    return { ctx, p, errs, eng };
  };
  const run = async (x) => { await x.p.setInputFiles('#ph-input', [IMG]); await x.p.waitForTimeout(300); await x.p.click('[data-act="ph-run"]'); };
  const vals = (p) => p.$$eval('[data-ph]', els => Object.fromEntries(els.map(e => [e.getAttribute('data-ph'), e.value])));

  // 1) Vision прочитав табло тепла → енергія в полі, рушій сайту не вантажився
  { const x = await mk(HEAT); await run(x); await x.p.waitForSelector('[data-ph]', { timeout: 30000 });
    const v = await vals(x.p), calls = await x.p.evaluate(() => window.__ocr);
    ok('Vision: енергія 15.482 з фото, без рушія сайту (engine.js не вантажився)', v.energy === '15.482' && !x.eng.length, { v, eng: x.eng });
    ok('…у застосунок пішов один кадр JPEG, не «швидкий»', calls.length === 1 && calls[0].jpeg && !calls[0].fast, calls);
    ok('…без помилок JS', !x.errs.length, x.errs); await x.ctx.close(); }

  // 2) Vision бачить водомір на екрані тепла → «це не теплолічильник», теж без рушія
  { const x = await mk(WATER); await run(x); await x.p.waitForTimeout(2500);
    const txt = await x.p.textContent('#main');
    ok('Vision: водомір на фото тепла → підказка «не теплолічильник», рушій сайту не потрібен', /вод/i.test(txt) && !x.eng.length, { eng: x.eng, txt: txt.slice(0, 300) });
    await x.ctx.close(); }

  // 3) Vision нічого не прочитав → запасний шлях: рушій сайту читає те саме фото
  { const x = await mk({ lines: [], ms: 90 }); await run(x); await x.p.waitForSelector('[data-ph]', { timeout: 240000 });
    const v = await vals(x.p);
    ok('Vision порожній → рушій сайту (engine.js) прочитав 15.482', x.eng.some(u => /^engine\.js/.test(u)) && v.energy === '15.482', { v, eng: x.eng.slice(0, 3) });
    ok('…без помилок JS', !x.errs.length, x.errs); await x.ctx.close(); }

  // 4) кадр камери: TeploCam читає через Vision (fast), рушій не вантажиться
  { const x = await mk(HEAT);
    const r = await x.p.evaluate(async () => { const c = document.createElement('canvas'); c.width = 640; c.height = 480; c.getContext('2d').fillRect(0, 0, 10, 10);
      const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.8)); const V = window.TeploVision;
      const res = await V.natRead(blob, { fast: true }); return { nat: V.nat(), eng: res.eng, n: res.lines.length, w: res.w, h: res.h, fast: window.__ocr[0] && window.__ocr[0].fast }; });
    ok('кадр камери → Vision з fast, рядки в пікселях кадру 640×480', r.nat && r.eng === 'vision' && r.n === 3 && r.w === 640 && r.h === 480 && r.fast && !x.eng.length, r);
    await x.ctx.close(); }

  // 5) звичайний браузер (без застосунку) — Vision немає, як раніше
  { const ctx = await b.newContext(); const p = await ctx.newPage(); await p.goto(U); const n = await p.evaluate(() => window.TeploVision.nat());
    ok('у браузері Vision немає (nat() = false)', n === false); await ctx.close(); }

  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
