// Камера з підказками (121-а): підроблена камера Chromium (--use-file-for-fake-video-capture) з кадром теплолічильника.
// cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_camera.cjs   (сайт 127.0.0.1:8013; кадри — /tmp/cam/*.y4m, див. нижче)
// Кадри: node ../ocr-lab/make.cjs (→ out/s774_energy.jpg), далі
//   ffmpeg -loop 1 -i ../ocr-lab/out/s774_energy.jpg -t 2 -r 5 -vf scale=1000:1300 -pix_fmt yuv420p /tmp/cam/heat.y4m
//   ffmpeg -f lavfi -i color=c=0x101010:s=640x480:r=5 -t 2 -pix_fmt yuv420p /tmp/cam/dark.y4m
// Перевіряє: кнопка біля «Обрати фото» (тепло, вода, світло); видошукач і підказки; «бачу 15,482 Гкал»; знімок сам після двох однакових
// кадрів; «Готово» → те саме поле фото → розпізнавання пачки → енергія 15.482; вода — «Зняти» вручну → фото в пачці води;
// темно → «Темно»; без дозволу → зрозуміле повідомлення і «Обрати фото» відкриває вибір файлу; Escape закриває, камера гасне.
const { chromium } = require('playwright');
const demo = require('./demo.cjs');
const BASE = 'http://127.0.0.1:8013/';
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const launch = file => chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'].concat(file ? ['--use-file-for-fake-video-capture=' + file] : []) });
async function page(b, route, opts) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }); const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|ERR_NAME|401|telegram\.org/.test(m.text())) p.errs.push('console: ' + m.text()); });
  await p.goto(BASE); await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo(opts || {}));
  await p.goto(BASE + '#' + route); await p.reload(); await p.waitForTimeout(700); return p;
}
const live = p => p.evaluate(() => { const v = document.querySelector('.cam-v'); return !!(v && v.srcObject && v.srcObject.getTracks().some(t => t.readyState === 'live')); });
(async () => {
  // 1. Тепло: видошукач → читає кадр → знімає сам → «Готово» → розпізнана пачка
  let b = await launch('/tmp/cam/heat.y4m');
  let p = await page(b, 'photo');
  ok('тепло: «Камера з підказками» поруч із «Обрати фото»', await p.$eval('.row-actions', el => !!el.querySelector('label[for="ph-input"]') && !!el.querySelector('[data-act="cam"][data-kind="heat"]')));
  await p.click('[data-act="cam"][data-kind="heat"]');
  await p.waitForSelector('.cam .cam-v');
  await p.waitForFunction(() => { const v = document.querySelector('.cam-v'); return v && v.videoWidth > 0; }, null, { timeout: 15000 });
  ok('видошукач: відео з камери грає, рамка й кнопка «Зняти» на місці', await live(p) && !!(await p.$('.cam-fr')) && !!(await p.$('.cam-shot')));
  ok('«Готово» неактивне, поки нічого не знято', await p.$eval('.cam-done', b => b.disabled));
  ok('«Ліхтарик» не видно — у камери його нема (123-я: display перебивав hidden)', await p.$eval('.cam-torch', el => el.hidden && getComputedStyle(el).display === 'none'));
  const h0 = await p.textContent('.cam-hint');
  ok('підказка великим текстом є одразу (вмикаю / завантажую / наведіть / перевіряю)', /камер|Завантажую|Наведіть|перевіряю/.test(h0), h0);
  await p.waitForFunction(() => /15,482/.test(document.querySelector('.cam-seen').textContent), null, { timeout: 240000 });
  const seen = await p.textContent('.cam-seen');
  ok('на кадрі: «… · бачу енергія 15,482 Гкал»', /бачу .*15,482 Гкал/.test(seen) && /·/.test(seen), seen);
  await p.waitForFunction(() => document.querySelector('.cam-th.on'), null, { timeout: 120000 });
  ok('знято само (два однакові кадри поспіль): мініатюра з лічильником 1, «Готово · 1»', (await p.textContent('.cam-th b')) === '1' && /Готово · 1/.test(await p.textContent('.cam-done')));
  ok('рамка зелена, коли цифри видно', await p.$eval('.cam-fr', el => el.classList.contains('ok')));
  const h1 = await p.textContent('.cam-hint');
  ok('після знімка — «Знято. Перемкніть екран…» або «уже знято»', /Знято|уже знято/.test(h1), h1);
  await p.waitForTimeout(4500);
  ok('той самий екран вдруге не знімає', (await p.textContent('.cam-th b')) === '1');
  await p.click('.cam-done');
  ok('«Готово» — камера закрилась і погасла', !(await p.$('.cam')));
  await p.waitForSelector('[data-ph="energy"]', { timeout: 240000 });
  ok('знімок пішов у те саме поле фото і пачка розпізналась сама: енергія 15.482', (await p.inputValue('[data-ph="energy"]')) === '15.482', await p.inputValue('[data-ph="energy"]'));
  ok('тепло: без помилок на сторінці', !p.errs.length, p.errs);
  await p.context().close();

  // 2. Вода: «Зняти» вручну → фото в пачці води (той самий шлях, що «Обрати фото»)
  p = await page(b, 'wnew');
  ok('вода: кнопка камери в порожній плашці фото', !!(await p.$('.phd-camrow [data-act="cam"][data-kind="water"]')));
  await p.click('[data-act="cam"][data-kind="water"]');
  await p.waitForFunction(() => { const v = document.querySelector('.cam-v'); return v && v.videoWidth > 0; }, null, { timeout: 15000 });
  await p.click('.cam-shot'); await p.waitForSelector('.cam-th.on');
  ok('вода: «Зняти» — мініатюра 1', (await p.textContent('.cam-th b')) === '1');
  await p.click('.cam-done');
  await p.waitForFunction(() => document.querySelectorAll('#wn-phd .phd-slide').length === 1, null, { timeout: 30000 });
  ok('вода: знімок у пачці фото водомірів', true);
  await p.waitForFunction(() => !document.querySelector('#wn-phd .phd-over'), null, { timeout: 240000 });
  ok('вода: після розпізнавання — «Додати ще фото» і камера поруч', !!(await p.$('.phd-acts label.phd-more')) && !!(await p.$('.phd-acts [data-act="cam"]')));
  ok('вода: без помилок', !p.errs.length, p.errs);
  await p.context().close();

  // 3. Світло: кнопка у введенні; Escape закриває й гасить камеру
  p = await page(b, 'enew', { elec: 1 });
  ok('світло: кнопка камери в плашці фото', !!(await p.$('[data-act="cam"][data-kind="elec"]')));
  await p.click('[data-act="cam"][data-kind="elec"]');
  await p.waitForFunction(() => { const v = document.querySelector('.cam-v'); return v && v.videoWidth > 0; }, null, { timeout: 15000 });
  const tracks = await p.evaluateHandle(() => document.querySelector('.cam-v').srcObject);
  await p.keyboard.press('Escape');
  ok('Escape — камера закрилась, нічого не додано', !(await p.$('.cam')) && !(await p.$('#en-phd .phd-slide')));
  ok('камера погашена (доріжки ended)', await tracks.evaluate(s => s.getTracks().every(t => t.readyState === 'ended')));
  ok('світло: без помилок', !p.errs.length, p.errs);
  await b.close();

  // 4. Темно → «Темно — додайте світла»
  b = await launch('/tmp/cam/dark.y4m');
  p = await page(b, 'photo');
  await p.click('[data-act="cam"][data-kind="heat"]');
  await p.waitForFunction(() => /Темно/.test(document.querySelector('.cam-hint').textContent), null, { timeout: 15000 }).catch(() => {});
  ok('темний кадр — «Темно…»', /Темно/.test(await p.textContent('.cam-hint')), await p.textContent('.cam-hint'));
  await b.close();

  // 5. Без дозволу на камеру — зрозуміле повідомлення, «Обрати фото» відкриває вибір файлу
  // (headless Chromium без підробленого запиту дає NotSupportedError — відмову людини підставляємо самі)
  b = await launch('/tmp/cam/heat.y4m');
  p = await page(b, 'photo');
  await p.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); });
  await p.click('[data-act="cam"][data-kind="heat"]');
  await p.waitForSelector('.cam.err', { timeout: 15000 }).catch(() => {});
  const em = await p.textContent('.cam-hint').catch(() => '');
  ok('без дозволу — «Немає дозволу на камеру…» і кнопка «Обрати фото»', /дозволу/.test(em) && !!(await p.$('.cam [data-cam="pick"]')), em);
  const fc = p.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
  await p.click('.cam [data-cam="pick"]');
  ok('«Обрати фото» — камера закрилась і відкрився вибір файлу', !!(await fc) && !(await p.$('.cam')));
  ok('без дозволу: без помилок на сторінці', !p.errs.length, p.errs);
  await b.close();

  console.log(`\ne2e_camera: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('ERROR', e); process.exit(1); });
