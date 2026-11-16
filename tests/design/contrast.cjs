// 162-а: контраст тексту на екранах (WCAG: < 4.5:1, крупний ≥ 24 px або ≥ 18.6 px 600 — < 3:1) і капс < 13 px. Матеріали табло/лендингу пропускає.
// cd tests/design && NODE_PATH=$(npm root -g) node contrast.cjs http://127.0.0.1:8013 <тёмная 0|1> route ...   (DEMO='{...}' | none — лендинг)
const { chromium } = require('playwright');
const demo = require('../e2e/demo.cjs');
(async () => {
  const [base, dark, ...routes] = process.argv.slice(2);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: dark === '1' ? 'dark' : 'light', locale: 'uk-UA' });
  await ctx.addInitScript(() => { try { localStorage.setItem('teplo.cc', JSON.stringify({ v: 1, a: false, at: Date.now(), id: 'x' })); } catch (e) {} });
  const p = await ctx.newPage();
  await p.goto(base + '/');
  const dj = process.env.DEMO || '{"elec":true,"gas":true,"second":true,"garage":"own1"}';
  if (dj !== 'none') await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo(JSON.parse(dj)));
  for (const r of routes) {
    await p.goto(base + '/#' + r); await p.reload(); await p.waitForTimeout(900);
    await p.evaluate(() => document.querySelectorAll('details').forEach(d => { d.setAttribute('data-noanim', ''); d.open = true; }));
    await p.waitForTimeout(300);
    const res = await p.evaluate(() => {
      const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
      const lum = ([r, g, b]) => { const f = x => { x /= 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
        const txt = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();
        if (!txt || txt.length < 2) continue;
        const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || +cs.opacity === 0) continue;
        if (el.closest('svg, .lcd, .drum, .mbox-disp, [aria-hidden="true"], .lp-plate, .lp-art, .lp-phone, .ph, canvas')) continue;
        let fg = parse(cs.color); if (!fg) continue;
        let bg = null, e = el, img = false;
        while (e) { const s = getComputedStyle(e); if (s.backgroundImage !== 'none' && !/linear-gradient\(180deg, rgba\(255, 255, 255, 0\.0/.test(s.backgroundImage) && !/sheen|rgba\(255, 255, 255, 0\.1/.test(s.backgroundImage)) { img = s.backgroundImage; } const c = parse(s.backgroundColor); if (c && c[3] > .5) { bg = c; break; } e = e.parentElement; }
        if (!bg) bg = [255, 255, 255, 1];
        if (fg[3] < 1) fg = [fg[0] * fg[3] + bg[0] * (1 - fg[3]), fg[1] * fg[3] + bg[1] * (1 - fg[3]), fg[2] * fg[3] + bg[2] * (1 - fg[3])];
        const L1 = lum(fg), L2 = lum(bg), cr = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
        const fs = parseFloat(cs.fontSize), fw = +cs.fontWeight, large = fs >= 24 || (fs >= 18.6 && fw >= 600);
        const opa = +cs.opacity < 1 ? ' op' + cs.opacity : '';
        if (cr < (large ? 3 : 4.5)) out.push(cr.toFixed(2) + ' ' + fs + 'px ' + (el.className && el.className.baseVal === undefined ? '.' + String(el.className).split(' ')[0] : el.tagName) + opa + ' «' + txt.slice(0, 40) + '»');
        if (cs.textTransform === 'uppercase' && fs < 13) out.push('CAPS<13 ' + fs + 'px «' + txt.slice(0, 30) + '»');
      }
      return [...new Set(out)];
    });
    console.log('== ' + r + (dark === '1' ? ' dark' : '') + ' (' + res.length + ')'); res.slice(0, 25).forEach(x => console.log('  ' + x));
  }
  await b.close();
})();
