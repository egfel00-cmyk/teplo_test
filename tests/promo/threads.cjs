// Промо-картинка для Threads (1080×1350, укр., тёмная): мало тексту й крупно — читається з телефона
// (у стрічці картинка ~390 px завширшки, тож текст ≥ 40 px на 1080). Що це, мета, громади з місцевими цінами, області, адреса.
// Цифри — з довідника (app/data), телефон із плашками — stage.cjs.
//   SITE_BASE= SITE_DATA=/tmp/teplo_data php -S 127.0.0.1:8013 index.php
//   NODE_PATH=$(npm root -g) node stage.cjs /tmp/poster_stage.png
//   NODE_PATH=$(npm root -g) node threads.cjs /tmp/poster_stage.png out.png
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const [stagePng, out] = process.argv.slice(2);
const ROOT = path.resolve(__dirname, '../..');

// ---- цифри з довідника ----
const FILES = { kh: 'providers.json', kv: 'prov_kv.json', ky: 'prov_ky.json', od: 'prov_od.json', lv: 'prov_lv.json' };
const num = v => typeof v === 'number' && v > 0;
const hasPrice = o => o && ['water', 'heat'].some(k => o[k] && ['supply', 'drain', 'price', 'gcal', 'tariff'].some(f => num(o[k][f])));
const len = x => Array.isArray(x) ? x.length : Object.keys(x || {}).length;
let H = 0, P = 0;
for (const [r, f] of Object.entries(FILES)) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/data', f)));
  const kat = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/data', r + '_katottg.json')));
  const withP = new Set(Object.keys(d.hromadas || {}).filter(k => hasPrice(d.hromadas[k])));
  for (const [k, x] of Object.entries(d.settlements || {})) if (hasPrice(x)) withP.add(k.split('/')[0]);
  H += len(kat.hromadas); P += withP.size;
}
console.log(JSON.stringify({ H, P }));

const LOGO = `<svg width="64" height="64" viewBox="0 0 28 28" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3C11 7.5 6.5 12.5 6.5 17.5A7.5 7.5 0 0 0 14 25" stroke="#F06A3A"/><path d="M14 3c3 4.5 7.5 9.5 7.5 14.5A7.5 7.5 0 0 1 14 25" stroke="#5B93DA"/><path d="M14 18l3.6-3.6" stroke="#F3F8F5" stroke-width="2.2"/><circle cx="14" cy="18" r="1.6" fill="#F3F8F5"/></svg>`;
const NOISE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .05 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;
const REG = ['Харківщина', 'Київщина', 'Київ', 'Одещина', 'Львівщина'];

const html = `<!doctype html><html lang="uk"><head><meta charset="utf-8">
<link rel="stylesheet" href="file://${ROOT}/web/fonts/fonts.css">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;height:1350px;overflow:hidden}
body{position:relative;font-family:"IBM Plex Sans",system-ui,sans-serif;color:#F3F8F5;-webkit-font-smoothing:antialiased;
  background-color:#18221E;background-image:${NOISE},radial-gradient(90% 55% at 20% 0%,rgba(255,255,255,.08) 0%,rgba(255,255,255,0) 60%),linear-gradient(180deg,#283832 0%,#1A2621 50%,#0E1512 100%)}
body::before{content:'';position:absolute;inset:18px;border-radius:44px;box-shadow:inset 0 0 0 2px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.07)}
.sc{position:absolute;width:24px;height:24px;border-radius:50%;background:radial-gradient(circle at 34% 30%,#B3BEB8 0%,#76817C 52%,#4A5450 100%);
  box-shadow:inset 0 -1px 1px rgba(0,0,0,.45),0 0 0 2px rgba(0,0,0,.38)}
.sc::before,.sc::after{content:'';position:absolute;left:50%;top:50%;width:12px;height:3px;margin:-1.5px 0 0 -6px;border-radius:1px;background:#29312E;transform:rotate(var(--r))}
.sc::after{transform:rotate(calc(var(--r) + 90deg))}
.s1{top:40px;left:40px;--r:17deg}.s2{top:40px;right:40px;--r:-34deg}.s3{bottom:40px;left:40px;--r:62deg}.s4{bottom:40px;right:40px;--r:4deg}
.top{position:absolute;left:84px;right:84px;top:84px;display:flex;align-items:center;justify-content:space-between}
.brand{display:flex;align-items:center;gap:16px;font-size:52px;font-weight:600;letter-spacing:-.015em}
.free{font-size:36px;font-weight:500;border:2px solid rgba(255,255,255,.28);border-radius:999px;padding:6px 26px 10px}
h1{position:absolute;left:84px;top:196px;width:540px;font-size:88px;line-height:1.0;letter-spacing:-.035em;font-weight:600}
.stage{position:absolute;right:34px;top:176px;width:452px}
.goal{position:absolute;left:84px;right:84px;top:636px;font-size:54px;line-height:1.16;font-weight:600;letter-spacing:-.02em;color:#F3F8F5}
.goal span{color:#BCC8A2}
.stat{position:absolute;left:84px;right:84px;top:796px;display:flex;align-items:center;gap:28px}
.lcd{background:#BCC8A2;color:#1C2618;border-radius:18px;padding:4px 26px 8px;box-shadow:inset 0 0 0 4px #0B110E,inset 0 6px 14px rgba(0,0,0,.18);
  font-family:"IBM Plex Mono",monospace;font-size:100px;font-weight:500;line-height:1.1;letter-spacing:-.04em}
.stat p{font-size:44px;line-height:1.18;font-weight:500;color:rgba(243,248,245,.88)}
.reg{position:absolute;left:84px;right:84px;top:962px;display:flex;flex-wrap:wrap;gap:14px 14px;list-style:none}
.reg li{font-size:42px;font-weight:600;background:rgba(255,255,255,.08);border:2px solid rgba(255,255,255,.20);border-radius:16px;padding:6px 24px 10px}
.cta{position:absolute;left:84px;right:84px;bottom:74px;height:108px;border-radius:24px;background:#F3F8F5;color:#17211E;display:flex;align-items:center;justify-content:center;
  font-size:64px;font-weight:600;letter-spacing:-.02em}
</style></head><body>
<span class="sc s1"></span><span class="sc s2"></span><span class="sc s3"></span><span class="sc s4"></span>
<div class="top"><span class="brand">${LOGO}Лічильники</span><span class="free">безкоштовно</span></div>
<h1>Показання лічильників за&nbsp;хвилину</h1>
<img class="stage" src="file://${path.resolve(stagePng)}">
<p class="goal">Ввели адресу — <span>постачальники й ціни</span> вже на місці</p>
<div class="stat"><span class="lcd">${P}</span><p>громад із місцевими<br>тарифами</p></div>
<ul class="reg">${REG.map(r => `<li>${r}</li>`).join('')}</ul>
<div class="cta">peredai.com.ua</div>
</body></html>`;
fs.writeFileSync('/tmp/threads_poster.html', html);

(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 })).newPage();
  await p.goto('file:///tmp/threads_poster.html'); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
  await p.screenshot({ path: out || 'threads.png' });
  await b.close();
})();
