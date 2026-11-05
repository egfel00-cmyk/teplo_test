// Вода → Водоканал через бот (03.11.2026): «Відправити у Водоканал» открывает @hvk_user_bot с готовой командой (t.me/…?text=),
// по возвращении — «Що відповів бот?», переслана нашому боту відповідь «прийнято» — запис сам позначається «передано» (підтверджено);
// «Помилка» — підказки й поля; ID лічильників — кнопка з /1=, номери з пересланої відповіді — кнопками.
// node e2e_vk.cjs  (локальный сервер 127.0.0.1:8013; ответы бота кладём прямо в /tmp/teplo_data/dev.sqlite — вебхук проверяет tests/server.php)
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const { execFileSync } = require('child_process');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', DB = process.env.DB || '/tmp/teplo_data/dev.sqlite';
const reply = (uid, kind, text, at) => execFileSync('php', ['-r', '$p=new PDO("sqlite:' + DB + '"); $s=$p->prepare("INSERT INTO vk_replies (user_id, kind, text, msg_at, created_at) VALUES (?,?,?,?,?)"); $s->execute([' + uid + ',$argv[1],$argv[2],' + at + ',gmdate("c")]);', kind, text]);
(async () => {
  require('fs').rmSync((process.env.SITE_DATA || '/tmp/teplo_data') + '/cache/vk_status.json', { force: true });   // кабинет «не проверяли» — сценарий бота (кабинет — e2e_vkcab)
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  const wait = ms => p.waitForTimeout(ms);
  const today = new Date().toISOString().slice(0, 10);
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(500);
  ok('регистрация', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'vk' + Date.now() + '@teplo.test') === 200);
  const uid = await p.evaluate(() => fetch('api/me').then(r => r.json()).then(j => j.user.id));
  await p.evaluate(([s, d]) => { delete s.demoToday; s.water.push({ id: 'wnow', place: 'main', date: d, vals: { h1: '176', c1: '440' }, createdAt: d + 'T09:00:00Z', updatedAt: Date.now(), sent: {} }); s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, [demo({}), today]);
  await p.reload(); await wait(2000);
  await p.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return null; }; });
  await p.goto(U + '#wrec-wnow'); await wait(500); await p.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return null; }; });
  ok('картка запису: «Куди передати» згорнуто (акордеон), «лише для себе» — внизу', !(await p.$eval('details.wacc', d => d.open)) && (await p.evaluate(() => { const a = document.querySelector('[data-key=own-box]'), b = document.querySelector('[data-key=wrec-del]'); return !!(a && b && (b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)); })));
  await p.click('[data-key=where-water-sum]'); await wait(200);
  const cmd = await p.textContent('[data-key=wsend-cmd]');
  ok('готова команда для бота: /2=рахунок:Прізвище|ID-показання', cmd === '/2=123456:Шевченко|555-176,777-440', cmd);
  ok('кнопка «Відправити у Водоканал»', /Відправити у Водоканал/.test(await p.textContent('[data-key=wsend-vk-send]')));
  await p.click('[data-key=wsend-vk-send]'); await wait(600);
  const opened = await p.evaluate(() => window.__opened);
  ok('відкривається бот із набраною командою (t.me/hvk_user_bot?text=…)', opened[0] === 'https://t.me/hvk_user_bot?text=' + encodeURIComponent(cmd), opened);
  let s = await st(); const w = s.water.find(x => x.id === 'wnow');
  ok('у записі — час натискання (vkAt), ще не «передано»', w.vkAt > Date.now() - 60000 && !(w.sent || {}).vk);
  ok('«Що відповів бот Водоканалу?» — «Прийняв» і «Помилка», підказка переслати нашому боту', !!(await p.$('[data-key=vk-ask]')) && !!(await p.$('[data-key=vk-ok]')) && /@heatcount_bot|@\w+bot/.test(await p.textContent('[data-key=vk-ask]')));
  await p.click('[data-key=vk-silent]'); await wait(800);
  ok('«Не відповідає» → у блоці «Бот Водоканалу не відповідає з …», телефон і «напишемо в Telegram»', /не відповідає з .*707-58-51.*напишемо/.test(await p.textContent('[data-key=vk-bot-silent]').catch(() => '')));
  ok('…і підказки', !!(await p.$('[data-key=vk-tips]')));
  await p.click('[data-key=vk-err]'); await wait(300);
  ok('«Відповів помилкою» → підказки, поля рахунку й ID, кнопка «Дізнатися ID у боті»', !!(await p.$('[data-key=vk-tips] #w-acc')) && !!(await p.$('[data-key=vk-tips] [data-wf=vkId]')) && !!(await p.$('[data-key=vk-check-ids]')));
  await p.locator('[data-key=where-water]').screenshot({ path: '/tmp/shot_vk_ask.png' });
  // переслана відповідь «прийнято» → запис сам «передано», підтверджено
  reply(uid, 'ok', 'Показання прийнято. Дякуємо!', Math.floor(Date.now() / 1000));
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await wait(1500);
  s = await st(); const w2 = s.water.find(x => x.id === 'wnow');
  ok('переслане «прийнято» → передано сьогодні, підтверджено Водоканалом', (w2.sent || {}).vk === today && w2.vkConf && /прийнято/.test(w2.vkConf.text), w2);
  ok('на екрані: «Підтверджено Водоканалом» і текст відповіді, питання зникло', /Підтверджено Водоканалом/.test(await p.textContent('[data-key=vk-reply]').catch(() => '')) && !(await p.$('[data-key=vk-ask]')));
  await p.locator('[data-key=where-water]').screenshot({ path: '/tmp/shot_vk_conf.png' });
  // кнопка «Прийняв» вручну (без пересилання) — для наступного запису
  await p.evaluate(d => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.water.push({ id: 'wnow2', place: 'main', date: d, vals: { h1: '177', c1: '441' }, createdAt: d + 'T10:00:00Z', updatedAt: Date.now(), sent: {}, vkAt: Date.now() }); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, today);
  await p.reload(); await wait(1500); await p.goto(U + '#wrec-wnow2'); await wait(500); await p.click('[data-key=where-water-sum]'); await wait(200);
  ok('стара відповідь не підтверджує новий запис (вона раніша за натискання)', !(((await st()).water.find(x => x.id === 'wnow2').sent || {}).vk));
  await p.click('[data-key=vk-ok]'); await wait(300);
  ok('«Прийняв — позначити передано» → передано', ((await st()).water.find(x => x.id === 'wnow2').sent || {}).vk === today);
  // ID лічильників: немає — кнопка з /1=, переслана відповідь — номери кнопками
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('teplo.v1')); s.places[0].water.meters.forEach(m => { m.vkId = ''; }); s.places[0].updatedAt = Date.now(); s.water.find(x => x.id === 'wnow2').sent = {}; s.water.find(x => x.id === 'wnow2').updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); });
  await p.reload(); await wait(1500); await p.goto(U + '#wrec-wnow2'); await wait(500); await p.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return null; }; });
  await p.click('[data-key=where-water-sum]'); await wait(200);
  await p.click('[data-key=vk-ids]'); await wait(500);
  ok('немає ID → «Відкрити бот із командою» /1=рахунок:Прізвище', (await p.evaluate(() => window.__opened))[0] === 'https://t.me/hvk_user_bot?text=' + encodeURIComponent('/1=123456:Шевченко'));
  reply(uid, 'info', 'Особовий рахунок 123456. Борг 0,00 грн.\nЛічильник ID 70012 (холодна), ID 70013 (гаряча)', Math.floor(Date.now() / 1000) + 1);
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await wait(1500);
  const chips = await p.$$eval('[data-act=vk-id-chip]', a => a.map(x => x.textContent));
  ok('переслана відповідь на /1= → номери кнопками (без рахунку й сум)', chips.join() === '70012,70013', chips);
  await p.click('[data-act=vk-id-chip][data-v="70012"]'); await wait(300);
  s = await st(); const ms = s.places[0].water.meters;
  ok('натиснув номер → ліг у перше порожнє поле ID', ms.some(m => m.vkId === '70012'), ms.map(m => m.vkId));
  await p.locator('[data-key=where-water]').screenshot({ path: '/tmp/shot_vk_ids.png' });
  // ?go=water-cold — кнопка з відповіді нашого бота
  await p.goto(U + '?go=water-cold'); await wait(800);
  ok('?go=water-cold → сторінка холодної води', (await p.evaluate(() => location.hash)) === '#water-cold');
  ok('без помилок JS', !errs.length, errs);
  console.log('\nИтог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
