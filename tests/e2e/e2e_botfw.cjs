// Світло і газ → офіційні боти (04.11.2026): кнопка ХарківОбленергоБота (@Kooz2bot) / бота Газмереж (@mygrmu_bot) запам'ятовує
// натискання (botAt), копіює показання, відкриває бот; повернувся — «Що відповів бот?»; переслана нам відповідь «прийнято» —
// запис сам позначається «передано» (botConf, «Підтверджено …»). Без натискання — за номером рахунку в тексті відповіді.
// node e2e_botfw.cjs  (локальный сервер 127.0.0.1:8013; ответы ботов кладём прямо в vk_replies /tmp/teplo_data/dev.sqlite с src)
const { chromium } = require('playwright'); const demo = require('./demo.cjs'); const { execFileSync } = require('child_process');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const U = 'http://127.0.0.1:8013/', DB = process.env.DB || '/tmp/teplo_data/dev.sqlite';
const reply = (uid, src, kind, text, at) => execFileSync('php', ['-r', '$p=new PDO("sqlite:' + DB + '"); $s=$p->prepare("INSERT INTO vk_replies (user_id, kind, text, msg_at, created_at, src) VALUES (?,?,?,?,?,?)"); $s->execute([' + uid + ',$argv[1],$argv[2],' + at + ',gmdate("c"),$argv[3]]);', kind, text, src]);
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const st = async () => JSON.parse(await p.evaluate(() => localStorage.getItem('teplo.v1')) || '{}');
  const rec = async id => (await st()).mrecs.filter(x => x.id === id)[0];
  const wait = ms => p.waitForTimeout(ms);
  const now = () => Math.floor(Date.now() / 1000);
  const stubOpen = () => p.evaluate(() => { window.__opened = []; window.open = u => { window.__opened.push(u); return null; }; });
  const openWhere = () => p.evaluate(() => document.querySelectorAll('details.wacc').forEach(d => { d.open = true; }));
  const back = async () => { await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await wait(1500); };
  await p.goto(U); await p.evaluate(() => localStorage.clear()); await p.reload(); await wait(500);
  ok('регистрация', await p.evaluate(e => window.TeploSync.register(e, 'Pass-12345678').then(j => j._status), 'fw' + Date.now() + '@teplo.test') === 200);
  const uid = await p.evaluate(() => fetch('api/me').then(r => r.json()).then(j => j.user.id));
  // однозонне світло (31.10 — не передано, вікно 30.10–3.11) і газ (1.11 — не передано, вікно 1–5), «сьогодні» 2.11
  await p.evaluate(s => { s.updatedAt = Date.now(); localStorage.setItem('teplo.v1', JSON.stringify(s)); }, demo({ elec: 1, gas: true, today: '2026-11-02' }));
  await p.reload(); await wait(2000);

  // ---- світло: натиснули бот → питаємо; «Помилка» → підказки; переслане «прийнято» → передано
  await p.goto(U + '#elec'); await wait(500); await openWhere(); await stubOpen();
  const how = await p.textContent('[data-key=ed-bot-how]').catch(() => '');
  ok('світло: підказка — перешліть відповідь бота нам (@…bot), позначимо самі', /перешліть/i.test(how) && /@\w+bot/i.test(how), how);
  ok('світло: кнопка бота знає записи й показання для буфера', await p.getAttribute('[data-key=dest-obl-bot]', 'data-act') === 'sbot' && await p.getAttribute('[data-key=dest-obl-bot]', 'data-copy') === '15645');
  ok('…і поки не натиснули — звичайне «Я передав(ла)»', !!(await p.$('[data-key=esend-done]')));
  await p.click('[data-key=dest-obl-bot]'); await wait(500);
  const opened = await p.evaluate(() => window.__opened);
  const r1 = await rec('m20261031');
  ok('натиснули — відкрито t.me/Kooz2bot, у записі botAt', opened[0] === 'https://t.me/Kooz2bot' && r1.botAt > Date.now() - 60000, [opened, r1.botAt]);
  await openWhere();
  ok('«Що відповів ХарківОбленергоБот?» з «Прийняв» і «Помилка»; «Я передав(ла)» сховано', /ХарківОбленергоБот/.test(await p.textContent('[data-key=elec-ask]')) && !!(await p.$('[data-key=elec-bot-ok]')) && !(await p.$('[data-key=esend-done]')));
  await p.click('[data-key=elec-bot-err]'); await wait(300);
  ok('«Відповів помилкою» → підказки (ЄР — 12 цифр…)', /ЄР — 12 цифр/.test(await p.textContent('[data-key=elec-tips]').catch(() => '')));
  reply(uid, 'obl', 'info', 'Напишіть мені номер ЄР', now()); await back(); await openWhere();
  ok('нова відповідь бота (не «прийнято») — видно текст, запис ще не передано', /номер ЄР/.test(await p.textContent('[data-key=elec-reply]').catch(() => '')) && !((await rec('m20261031')).sent || {}).obl);
  reply(uid, 'obl', 'ok', 'Дякуємо! Ваші показники успішно передано.', now() + 1); await back(); await openWhere();
  const r2 = await rec('m20261031');
  ok('переслане «прийнято» → передано (sent.obl), botConf з текстом', r2.sent.obl === '2026-11-02' && /передано/.test(r2.botConf.text), r2);
  ok('«Підтверджено Харківобленерго» з текстом відповіді, пілюля «Передано»', /Підтверджено Харківобленерго/.test(await p.textContent('[data-key=elec-conf]').catch(() => '')) && /передано/i.test(await p.textContent('[data-key=dest-obl]')));
  ok('старі записи світла не чіпали (10.01 — як було)', (await rec('m20261001')).sent.obl === '2026-10-01' && !(await rec('m20261001')).botConf);

  // ---- газ: бот Газмереж першим; не натискали — «прийнято» з номером рахунку лягає на цей лічильник
  await p.goto(U + '#gas'); await wait(500); await openWhere();
  const chans = await p.$$eval('[data-key=dest-grm] .dest-ch a', a => a.map(x => x.getAttribute('href')));
  // 07.11: кнопками — лише бот і SMS (до 27.11); «Куб» і кабінет — у згорнутих «Інші способи»
  ok('газ: перший канал — бот Газмереж t.me/mygrmu_bot, далі SMS 4647 (до 27.11); «Куб» і кабінет — в «Інші способи»', chans[0] === 'https://t.me/mygrmu_bot' && /^sms:4647/.test(chans[1] || '') && chans.length === 2
    && !!(await p.$('details.dest-more [data-key=dest-grm-kub]')) && !!(await p.$('details.dest-more [data-key=dest-grm-cab]')), chans);
  ok('газ: підказка — «Поділитись номером», філія, перешліть відповідь', /Поділитись номером/.test(await p.textContent('[data-key=ed-bot-how]')) && /перешліть/i.test(await p.textContent('[data-key=ed-bot-how]')));
  reply(uid, 'grm', 'ok', 'Показання по особовому рахунку 123456789 прийнято', now() + 2); await back(); await openWhere();
  const g = await rec('n20261101');
  ok('газ без натискання: «прийнято» з рахунком 123456789 → передано (sent.grm), botConf', g.sent.grm === '2026-11-02' && !!g.botConf, g);
  ok('«Підтверджено Газмережами»; світло не зачепило', /Підтверджено Газмережами/.test(await p.textContent('[data-key=gas-conf]').catch(() => '')) && (await rec('m20261031')).botConf.id !== g.botConf.id);

  // ---- синхронізація: позначки «передано» доїхали на сервер (друге устройство їх побачить)
  await wait(2500);
  const srv = await p.evaluate(() => fetch('api/state').then(r => r.json()));
  const sm = ((srv.state || srv.data || {}).mrecs || []).filter(x => x.id === 'm20261031')[0] || {};
  ok('на сервері запис світла з sent.obl і botConf', (sm.sent || {}).obl === '2026-11-02' && !!sm.botConf, Object.keys(srv));
  ok('без ошибок JS', errs.length === 0, errs);
  console.log(`\nИтог: ${pass} OK, ${fail} FAIL`); await b.close(); process.exit(fail ? 1 : 0);
})();
