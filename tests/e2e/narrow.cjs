// Узкие телефоны 320/360/390 px, uk и ru: страница не должна ездить вбок (scrollWidth, элементы за краем); скриншоты 320 → /tmp/n320_*.png
// ROUTES=home,login,step-1 node narrow.cjs   ·   первый вход (пустое состояние): FRESH=1 ROUTES=welcome,start,wadd,eadd,gadd node narrow.cjs
const { chromium } = require('playwright'); const demo = require('./demo.cjs');
(async () => {
  const b = await chromium.launch(); const out = [];
  for (const [w, h] of [[320, 568], [360, 640], [390, 844]]) for (const lang of ['uk', 'ru']) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }); const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://127.0.0.1:8013/'); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), process.env.FRESH ? { lang } : demo(Object.assign({ lang, photos: [] }, JSON.parse(process.env.DEMO || '{}'))));
    for (const r of (process.env.ROUTES || 'home,history,stats,save,water-hot,water-cold,wnew,wrec-w20261015,prefs,heat').split(',')) {
      await p.goto('http://127.0.0.1:8013/#' + r); await p.reload(); await p.waitForTimeout(500);
      const o = await p.evaluate((W) => { const de = document.documentElement, bad = [];
        document.querySelectorAll('body *').forEach(el => { const rc = el.getBoundingClientRect(); if (rc.width && (rc.right > W + 1 || rc.left < -1) && getComputedStyle(el).position !== 'fixed') { const cs = el.closest('[style*="overflow"], .scroll, .tbl-wrap'); if (!cs) bad.push(el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0] + ' ' + Math.round(rc.left) + '..' + Math.round(rc.right)); } });
        return { sw: de.scrollWidth, bad: bad.slice(0, 4) }; }, w);
      if (o.sw > w || o.bad.length) out.push(`${w} ${lang} #${r}: scrollWidth=${o.sw} ${o.bad.join(' | ')}`);
      if (w === 320 && lang === 'uk' && ['history', 'stats', 'save', 'home', 'welcome', 'start'].includes(r)) await p.screenshot({ path: `/tmp/n320_${r}.png`, fullPage: r === 'start' || r === 'welcome' });
      if (w === 320 && lang === 'ru' && r === 'history') { await p.click('[data-act=view][data-v=cold]').catch(() => {}); await p.waitForTimeout(300); await p.screenshot({ path: '/tmp/n320_ru_hist_cold.png' }); }
    }
    if (errs.length) out.push(`${w} ${lang} errors: ${errs.join('; ')}`);
    await ctx.close();
  }
  console.log(out.join('\n') || 'нет переполнений'); await b.close();
})();
