// Платёжки к записям истории: вошедший A прикрепляет фото + PDF к показаниям тепла, PDF к воде и к периоду «без лічильника»
// (несохранённые поля формы периода не теряются) → значок в строке истории → B тем же аккаунтом видит файлы → удаление.
// node e2e_bills.cjs  (локальный сервер 127.0.0.1:8013) → /tmp/e2e_bills_*.png
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:8013/', email = 'bill' + Date.now() + '@example.ua', pass = 'bills test 123';
const ok = [], bad = []; const check = (c, m) => (c ? ok : bad).push(m);
const login = (p, path) => p.evaluate(async ([path, email, pass]) => { const t = (document.cookie.match(/ts_csrf=([^;]*)/) || [])[1];
  return (await fetch('api/auth/' + path, { method: 'POST', body: JSON.stringify({ email, password: pass }), headers: { 'Content-Type': 'application/json', 'X-CSRF': t } })).status; }, [path, email, pass]);
const st = p => p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')));
const attach = async (p, files) => { const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-key=bill-add]')]); await fc.setFiles(files);
  await p.waitForFunction(() => !document.querySelector('.bills [role=status]'), null, { timeout: 30000 }); await p.waitForTimeout(300); };
(async () => {
  const img = '/tmp/bill_photo.jpg', pdf = '/tmp/bill_oct.pdf';
  if (!fs.existsSync(img) || !fs.existsSync(pdf)) throw new Error('нет ' + img + ' / ' + pdf);
  const b = await chromium.launch(), errs = [];
  const dev = async () => { const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); return p; };
  const A = await dev();
  await A.goto(BASE); await A.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), demo({ gaps: true }));
  await A.goto(BASE + '#rec-r1'); await A.reload(); await A.waitForTimeout(800);
  check(await A.$eval('[data-key=bills-h-r1]', e => /Увійти|Войти/.test(e.textContent)).catch(() => false), 'без входа — блок просит войти');
  check((await login(A, 'register')) === 200, 'регистрация A');
  await A.goto(BASE + '#rec-r1'); await A.reload(); await A.waitForTimeout(1200);
  const title = await A.$eval('[data-key=bills-h-r1] h2', e => e.textContent.trim()).catch(() => '');
  check(/^Платіжка за /.test(title), 'заголовок «Платіжка за <місяць>»: ' + title);
  await attach(A, [img, pdf]);
  let r1 = (await st(A)).readings.find(r => r.id === 'r1');
  check(r1.bills && r1.bills.length === 2 && r1.bills[1].mime === 'application/pdf' && r1.bills[1].name === 'bill_oct.pdf', 'к показаниям тепла — 2 файла (фото + PDF с именем)');
  check(await A.$eval('[data-key=bills-h-r1] img[data-gal]', i => i.complete && i.naturalWidth > 0).catch(() => false), 'миниатюра фото платёжки видна');
  await A.screenshot({ path: '/tmp/e2e_bills_rec.png', fullPage: true });
  await A.click('[data-key=bills-h-r1] img[data-gal]'); await A.waitForTimeout(700);
  check(!!(await A.$('.pv')), 'фото платёжки открывается на весь экран'); await A.keyboard.press('Escape');
  const pdfSt = await A.evaluate(async id => (await fetch('api/docs/file?id=' + id)).headers.get('content-type'), r1.bills[1].id);
  check(pdfSt === 'application/pdf', 'PDF отдаётся хозяину');
  const lk = await A.evaluate(async id => (await (await fetch('api/docs/link?id=' + id)).json()).url, r1.bills[1].id);
  // вода
  await A.goto(BASE + '#wrec-w20261015'); await A.waitForTimeout(800);
  await attach(A, [pdf]);
  const w = (await st(A)).water.find(x => x.id === 'w20261015');
  check(w.bills && w.bills.length === 1, 'к записи воды — PDF');
  // период «без лічильника»: несохранённая заметка не теряется
  await A.goto(BASE + '#gap-g1'); await A.waitForTimeout(800);
  await A.fill('#gp-note', 'не сохранено ещё'); await attach(A, [img]);
  check((await A.inputValue('#gp-note')) === 'не сохранено ещё', 'форма периода: поля не сбросились после загрузки');
  const g1 = (await st(A)).places[0].gaps.find(g => g.id === 'g1');
  check(g1.bills && g1.bills.length === 1, 'к периоду без лічильника — фото');
  // строка истории: значок
  await A.goto(BASE + '#history'); await A.waitForTimeout(900);
  check(await A.$eval('[data-key=reading-r1] .ph-n', e => e.textContent.trim() === '2').catch(() => false), 'в строке истории значок платёжки «2»');
  check(await A.$eval('[data-key=gap-g1] .ph-n', e => e.textContent.trim() === '1').catch(() => false), 'в строке «без лічильника» значок «1»');
  await A.screenshot({ path: '/tmp/e2e_bills_hist.png', fullPage: true });
  await A.waitForTimeout(4000);   // синхронизация
  // B
  const B = await dev(); await B.goto(BASE); check((await login(B, 'login')) === 200, 'вход B');
  await B.goto(BASE + '#home'); await B.reload(); await B.waitForTimeout(3000);
  await B.goto(BASE + '#rec-r1'); await B.waitForTimeout(1500);
  check(await B.$$eval('[data-key=bills-h-r1] .docs li', l => l.length).catch(() => 0) === 2, 'B видит обе платёжки');
  check(await B.$eval('[data-key=bills-h-r1] img[data-gal]', i => i.complete && i.naturalWidth > 0).catch(() => false), 'B: фото платёжки грузится');
  // ссылка без cookie
  const C = await dev(); const u = new URL('api/' + lk, BASE).href;
  const resp = await C.request.get(u); check(resp.status() === 200 && resp.headers()['content-type'] === 'application/pdf', 'подписанная ссылка открывает PDF без входа');
  check((await C.request.get(BASE + 'api/docs/file?id=' + r1.bills[1].id)).status() === 401, 'без входа обычная ссылка — 401');
  // удаление одного файла и записи целиком
  await A.goto(BASE + '#rec-r1'); await A.waitForTimeout(800);
  await A.click('[data-key=bills-h-r1] [data-act=bill-del]'); await A.waitForTimeout(800);
  r1 = (await st(A)).readings.find(r => r.id === 'r1');
  check(r1.bills.length === 1 && r1.bills[0].mime === 'application/pdf', 'удаление одного файла');
  const before = await A.evaluate(async () => (await (await fetch('api/docs')).json()).docs.length);
  await A.goto(BASE + '#wrec-w20261015'); await A.waitForTimeout(800); await A.click('[data-act=wdel]'); await A.waitForTimeout(1200);
  const after = await A.evaluate(async () => (await (await fetch('api/docs')).json()).docs.length);
  check(after === before - 1, 'удалили запись воды — её платёжка удалена с сервера (' + before + '→' + after + ')');
  // 10.11: фото паспорта / повірки — у налаштуваннях кожного лічильника на екрані квартири, документ знає свій лічильник
  await A.goto(BASE + '#place-main'); await A.waitForTimeout(900);
  await A.evaluate(() => { document.querySelector('#pg-pv-meters').open = true; }); await A.waitForTimeout(200);
  await A.evaluate(() => { document.querySelector('#mbs-c1').open = true; }); await A.waitForTimeout(300);
  { const [fc] = await Promise.all([A.waitForEvent('filechooser'), A.click('[data-key=mdoc-ver-c1]')]); await fc.setFiles(img); }
  await A.waitForFunction(() => !document.querySelector('.mdocs [role=status]'), null, { timeout: 30000 }); await A.waitForTimeout(1200);
  const md = await A.evaluate(async () => (await (await fetch('api/docs')).json()).docs.filter(d => d.meter === 'c1'));
  check(md.length === 1 && md[0].kind === 'verification' && !!(await A.$('[data-key=mdocs-c1] .docs li')) && !(await A.$('[data-key=mdocs-h1] .docs li')), 'фото повірки — до холодного водоміра, у його налаштуваннях (' + md.length + ')');
  await A.goto(BASE + '#prefs'); await A.waitForTimeout(800);
  console.log(ok.map(m => 'OK   ' + m).concat(bad.map(m => 'FAIL ' + m)).join('\n'));
  console.log(ok.length + '/' + (ok.length + bad.length), errs.length ? 'ERR ' + errs.join('; ') : '');
  await b.close();
})();
