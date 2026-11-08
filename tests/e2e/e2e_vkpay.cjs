// «Платіжка Водоканалу» (08.11): показань води за місяць немає — сервер (VkBills) кладе квитанцію окремим записом історії води {billOnly, ym};
// внесли показання за цей місяць — квитанція переїжджає до них (wnStore → wbillAdopt), а якщо запис прийшов синхронізацією — billAdoptAll.
// Нужны: сайт 8013 (config.php: sqlite, 'vk_cab_base' => 'http://127.0.0.1:8098'), стенд Водоканала php -S 127.0.0.1:8098 tests/vk-mock/router.php.
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const fs = require('fs'); const { execFileSync } = require('child_process'); const path = require('path');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', VM = 'http://127.0.0.1:8098', DATA = process.env.SITE_DATA || '/tmp/teplo_data';
const T = Date.UTC(2026, 10, 7, 8, 0, 0) / 1000;
const cron = (ts, reset) => JSON.parse(execFileSync('php', [path.join(__dirname, 'vkbills_cron.php'), String(ts)].concat(reset ? ['reset'] : []), { env: Object.assign({}, process.env, { SITE_DATA: DATA, SITE_BASE: '' }) }).toString().trim().split('\n').pop());
(async () => {
  await fetch(VM + '/__reset'); try { fs.unlinkSync('/tmp/vkm_bill.txt'); } catch (e) {}
  const n = Math.floor(Date.now() / 1000); fs.mkdirSync(DATA + '/cache', { recursive: true });
  fs.writeFileSync(DATA + '/cache/vk_status.json', JSON.stringify({ cab: { state: 'ok', at: n, since: n - 3600, everOk: true, lastOk: n, code: 200 } }));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const wait = ms => p.waitForTimeout(ms), st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  const srv = () => p.evaluate(() => window.TeploSync.api('GET', '/state').then(j => j.state));
  const pays = s => (s.water || []).filter(r => r.billOnly && !r.deleted);
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(500);
  ok('регистрация', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'vp' + Date.now() + '@teplo.test') === 200);
  // рахунок і прізвище є, а запису води за жовтень немає (останній — 16.09)
  const d0 = demo({ today: '2026-11-06' }); d0.water = d0.water.filter(r => r.id !== 'w20261015'); d0.places[0].water.account = '905616'; d0.places[0].water.surname = 'Шевченко'; d0.updatedAt = Date.now();
  await p.evaluate(s => localStorage.setItem('teplo.v1', JSON.stringify(s)), d0); await p.reload(); await wait(2500);
  const c1 = cron(T, true);
  ok('cron 7-го: запису води за жовтень немає → «Платіжка» (new)', c1.length === 1 && c1[0][1] === 'new', c1);
  const s1 = await srv(), po = pays(s1);
  ok('…на сервере: запис {billOnly, ym 2026-10, date 31.10, vals {}}, квитанція auto vk', po.length === 1 && po[0].ym === '2026-10' && po[0].date === '2026-10-31' && /^(\{\}|\[\])$/.test(JSON.stringify(po[0].vals)) && (po[0].bills || [])[0].auto === 'vk', po);
  await p.reload(); const toast = await p.waitForFunction(() => /Квитанцію Водоканалу за жовтень 2026 додано в історію води/.test(document.body.textContent), null, { timeout: 8000 }).then(() => true, () => false);
  ok('приложение: тост «… додано в історію води»', toast);
  await p.goto(U + '#water-cold'); await wait(1200);
  const mh = await p.textContent('[data-key=water-history-cold]').catch(() => '');
  ok('сторінка холодної води: в історії — «Платіжка Водоканалу · жовтень 2026 · показань за цей місяць немає»', /Платіжка Водоканалу/.test(mh) && /жовт/i.test(mh) && /показань за цей місяць немає/.test(mh), mh);
  await p.goto(U + '#water-hot'); await wait(900);
  const hh = await p.textContent('[data-key=water-history-hot]').catch(() => '');
  ok('…у гарячій — немає (квитанція Водоканалу — у холодній)', hh !== '' && !/Платіжка Водоканалу/.test(hh), hh);
  const pid = po[0].id; await p.goto(U + '#wrec-' + pid); await wait(1200);
  const v = await p.textContent('main, body');
  ok('екран «Платіжки»: заголовок з місяцем, пояснення, файл «з сайту Водоканалу», кнопка «Видалити»', /Платіжка Водоканалу · жовтень 2026/.test(v) && /внесете їх, квитанція перейде до них/.test(v) && /з сайту Водоканалу/.test(v)
    && await p.locator('[data-key=wrec-del]').count() === 1 && await p.locator('[data-key=wrec-edit]').count() === 0, v.slice(0, 300));
  let s = await st();
  // внесли показання за жовтень (20.10) — квитанція переїжджає до них
  await p.goto(U + '#wnew'); await wait(900);
  await p.fill('#wn-date', '2026-10-20'); await p.dispatchEvent('#wn-date', 'change'); await p.fill('[data-wn=h1]', '174'); await p.fill('[data-wn=c1]', '436'); await wait(300);
  await p.click('[data-key=wn-save]'); await wait(1500);
  s = await st(); const nr = (s.water || []).filter(r => !r.deleted && !r.billOnly && r.date === '2026-10-20')[0] || {};
  ok('внесли показання за 20.10 — квитанція тепер у них, «Платіжка» прибрана', (nr.bills || []).length === 1 && nr.bills[0].auto === 'vk' && pays(s).length === 0, [nr, pays(s)]);
  await wait(2500); const s2 = await srv();
  ok('…на сервері те саме; cron наступного дня не ходить (квитанцію за жовтень уже взяли)', pays(s2).length === 0 && ((s2.water || []).filter(r => r.date === '2026-10-20')[0].bills || []).length === 1 && JSON.stringify(cron(T + 21 * 3600)) === '[]');
  // запис показань прийшов синхронізацією (інший пристрій / автовідправка), а квитанція ще в «Платіжці» (на сервері) — переносимо при синхронізації
  const uid = await p.evaluate(() => window.TeploSync.api('GET', '/me').then(j => j.user.id));
  execFileSync('php', ['-r', `define('TEPLO',1); require 'app/core.php'; $r = Db::one('SELECT data FROM user_state WHERE user_id = ?', [${uid}]); $s = json_decode($r['data']); $now = (int)round(microtime(true) * 1000);
    foreach ($s->water as $w) if (($w->date ?? '') === '2026-10-20') { $s->water[] = (object)['id' => 'vbsync1', 'place' => $w->place, 'billOnly' => true, 'ym' => '2026-10', 'date' => '2026-10-31', 'vals' => new stdClass(), 'bills' => $w->bills, 'source' => 'vk', 'createdAt' => $now, 'updatedAt' => $now]; $w->bills = []; $w->updatedAt = $now; break; }
    Db::q('UPDATE user_state SET data = ?, version = version + 1 WHERE user_id = ?', [json_encode($s, JSON_UNESCAPED_UNICODE), ${uid}]);`], { env: Object.assign({}, process.env, { SITE_DATA: DATA, SITE_BASE: '' }), cwd: path.join(__dirname, '../..') });
  await p.reload(); await wait(3500); s = await st();
  const r20 = (s.water || []).filter(r => !r.deleted && !r.billOnly && r.date === '2026-10-20')[0] || {};
  ok('«Платіжка» прийшла синхронізацією поруч із показаннями того ж місяця — квитанція переїхала до показань', pays(s).length === 0 && (r20.bills || []).length === 1, [pays(s), r20.bills]);
  ok('без ошибок JS', !errs.length, errs);
  console.log('Итог: ' + pass + ' OK, ' + fail + ' FAIL'); await b.close(); process.exit(fail ? 1 : 0);
})();
