// 150-а (план конкурентів п. 7): платіжний QR НБУ з «Оплати» свого постачальника. Гараж «ГК «Мотор»» (IBAN, ЄДРПОУ, шаблон призначення),
// неоплачені показання 31.10 → «Оплата» → «QR-код для оплати» → код читається (jsQR) → https://bank.gov.ua/qr/<Base64URL> → рядки формату 002:
// BCD / 002 / 1 / UCT / — / отримувач / IBAN / UAH<сума> / код / — / — / призначення (те саме, що в рядку «Призначення») / —.
// Без ЄДРПОУ — пояснення замість коду; оплачено — QR немає.
// cd tests/e2e && NODE_PATH=$(npm root -g) JSQR=/tmp/npmref/jsqr/package/dist/jsQR.js node e2e_qr.cjs   (сайт 127.0.0.1:8013)
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const fs = require('fs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 400) : '')); } };
const U = 'http://127.0.0.1:8013/', JSQR = process.env.JSQR || '/tmp/npmref/jsqr/package/dist/jsQR.js';
(async () => {
  const b = await chromium.launch();
  for (const dark of [false, true]) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA', colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: 2 }); const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    const load = async (s, route) => {
      await p.goto(U); await p.evaluate(x => { localStorage.clear(); localStorage.setItem('teplo.v1', JSON.stringify(x)); localStorage.setItem('teplo.cc', JSON.stringify({ v: 1, a: 0, at: new Date().toISOString(), id: 'x' }));
        Storage.prototype.setItem = Storage.prototype.removeItem = Storage.prototype.clear = function () {}; }, s);   // стара сторінка не перепише підставлене (як у e2e_myprov)
      await p.goto('about:blank'); await p.goto(U + '#' + route); await p.waitForTimeout(1500);
    };
    const s = demo({ garage: 'own', atGarage: true, today: '2026-11-14' });
    await load(s, 'elec');
    await p.evaluate(() => { const d = document.querySelector('details[data-key="mypay-eg"]'); if (d) d.open = true; }); await p.waitForTimeout(300);
    ok((dark ? 'темна' : 'світла') + ': у «Оплаті» — «QR-код для оплати», згорнуто; бібліотеку ще не вантажили', !!(await p.$('[data-key="mypay-eg"] [data-key=my-qr]')) && !(await p.evaluate(() => !!window.qrcode)));
    await p.click('[data-key="mypay-eg"] [data-key=my-qr-sum]'); await p.waitForTimeout(1200);
    const img = await p.$('[data-key=my-qr-img] svg');
    ok('розгорнули — QR намальовано (svg, білий фон)', !!img && await p.evaluate(() => !!document.querySelector('[data-key=my-qr-img] svg rect[fill="#fff"]')));
    // прочитати код з картинки: скрин елемента → jsQR у сторінці
    const png = await (await p.$('[data-key=my-qr-img]')).screenshot();
    await p.addScriptTag({ content: fs.readFileSync(JSQR, 'utf8') });
    const url = await p.evaluate(async b64 => {
      const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height); const r = window.jsQR(d.data, c.width, c.height); return r ? r.data : null;
    }, png.toString('base64'));
    ok('код читається сканером: https://bank.gov.ua/qr/…', !!url && url.indexOf('https://bank.gov.ua/qr/') === 0, url);
    if (url) {
      const raw = Buffer.from(url.slice('https://bank.gov.ua/qr/'.length).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'), L = raw.split('\n');
      const purp = await p.$eval('[data-key="mypay-eg"] [data-key=my-r-purp] .my-r-v', e => e.textContent.trim()).catch(() => '');
      ok('формат 002: BCD / 002 / 1 / UCT / порожньо, 13 рядків, без «=» у посиланні', L.length === 13 && L[0] === 'BCD' && L[1] === '002' && L[2] === '1' && L[3] === 'UCT' && L[4] === '' && !/=/.test(url), L);
      ok('отримувач, IBAN, код ЄДРПОУ — як у рядках «Оплати»', L[5] === 'ГК «Мотор»' && L[6] === 'UA213223130000026007233566001' && L[8] === '12345678', L);
      ok('сума — найкоротше: UAH259.2 (60 кВт·год × 4,32)', L[7] === 'UAH259.2', L[7]);
      ok('призначення — те саме, що в рядку «Призначення»', !!purp && L[11] === purp.replace(/\s+/g, ' ') && L[9] === '' && L[10] === '' && L[12] === '', [L[11], purp]);
      ok('≤ 331 байт', Buffer.byteLength(raw, 'utf8') <= 331, Buffer.byteLength(raw, 'utf8'));
    }
    if (process.env.SHOT) await (await p.$('[data-key="mypay-eg"]')).screenshot({ path: '/tmp/qr_pay_' + (dark ? 'dark' : 'light') + '.png' });
    if (!dark) {
      // без ЄДРПОУ — пояснення замість коду
      const s2 = demo({ garage: 'own', atGarage: true, today: '2026-11-14' }); s2.places.find(x => x.id === 'gar').prov.elec.code = '';
      await load(s2, 'elec'); await p.evaluate(() => { const d = document.querySelector('details[data-key="mypay-eg"]'); if (d) d.open = true; });
      ok('без ЄДРПОУ — «впишіть код ЄДРПОУ…», коду немає', /ЄДРПОУ/.test(await p.textContent('[data-key="mypay-eg"] [data-key=my-qr-no]').catch(() => '')) && !(await p.$('[data-key="mypay-eg"] [data-key=my-qr]')));
      // оплачено — QR немає
      const s3 = demo({ garage: 'own', atGarage: true, today: '2026-11-14' }); s3.mrecs.filter(r => r.place === 'gar').forEach(r => { r.sent = { obl: '2026-11-14' }; });
      await load(s3, 'elec');
      ok('оплачено — QR-коду немає', !(await p.$('[data-key=my-qr]')));
    }
    ok('без помилок JS', !errs.length, errs);
    await ctx.close();
  }
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
