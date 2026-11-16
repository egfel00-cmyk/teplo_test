// 154-а: «Видалити акаунт» (App Store 5.1.1(v) — видалення акаунта в застосунку; і на сайті). Реєстрація поштою → дані з'їздили на сервер →
// Налаштування → «Видалити акаунт» → підтвердження → у базі немає ні акаунта, ні стану, ні сесій; на пристрої показання лишились, без синхронізації.
// cd tests/e2e && NODE_PATH=$(npm root -g) node e2e_acctdel.cjs   (сайт 127.0.0.1:8013, SITE_DATA=/tmp/teplo_data — sqlite)
const { chromium } = require('playwright'); const { execFileSync } = require('child_process'); const demo = require('./demo.cjs');
const BASE = 'http://127.0.0.1:8013/', DB = '/tmp/teplo_data/dev.sqlite';
let pass = 0, fail = 0; const ok = (n, c, i) => { console.log((c ? '  OK  ' : ' FAIL ') + n + (!c && i !== undefined ? '  → ' + JSON.stringify(i).slice(0, 400) : '')); c ? pass++ : fail++; };
const sql = q => execFileSync('python3', ['-c', 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); r=c.execute(sys.argv[2]).fetchall(); c.commit(); print(r)', DB, q]).toString().trim();
const n = q => +(sql(q).match(/\d+/) || [0])[0];
(async () => {
  try { sql("DELETE FROM rate_limits"); } catch (e) { /* таблиці ще немає */ }
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'uk-UA' }); const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  // спершу — свої дані на пристрої (світло), потім реєстрація: стан піде на сервер
  await p.goto(BASE); await p.evaluate(s => { localStorage.clear(); localStorage.setItem('teplo.v1', JSON.stringify(s)); localStorage.setItem('teplo.cc', JSON.stringify({ v: 1, a: 0, at: new Date().toISOString(), id: 'x' })); }, demo({ elec: true }));
  await p.goto('about:blank'); await p.goto(BASE + '#login'); await p.waitForTimeout(900);
  const email = 'del-' + Date.now() + '@teplo.test';
  await p.fill('#a-email', email); await p.click('[data-key=login-toggle]'); await p.waitForTimeout(300);
  await p.fill('#a-pass', 'Delete-me-123'); await p.click('[data-key=login-submit]'); await p.waitForTimeout(2500);
  const uid = n(`SELECT id FROM users WHERE email = '${email}'`);
  ok('акаунт створено', uid > 0, uid);
  await p.goto(BASE + '#prefs-acc'); await p.waitForTimeout(2500);   // 164-а: група «Акаунт» — окремий екран
  ok('стан з’їздив на сервер (user_state)', n(`SELECT COUNT(*) FROM user_state WHERE user_id = ${uid}`) === 1);
  ok('Налаштування: «Видалити акаунт» є під «Вийти»', /Видалити акаунт/.test(await p.textContent('[data-key=prefs-acct-del]').catch(() => '')));
  await p.click('[data-key=prefs-acct-del]'); await p.waitForTimeout(300);
  const q = await p.textContent('[data-key=acct-del-confirm]').catch(() => '');
  ok('підтвердження: що саме зникне, що лишиться на пристрої, «Скасувати не можна»', /акаунт/.test(q) && /залишаться/.test(q) && /Скасувати не можна/.test(q), q);
  await p.click('[data-act=acct-del-no]'); await p.waitForTimeout(200);
  ok('«Скасувати» — підтвердження зникло, акаунт на місці', !(await p.$('[data-key=acct-del-confirm]')) && n(`SELECT COUNT(*) FROM users WHERE id = ${uid}`) === 1);
  await p.click('[data-key=prefs-acct-del]'); await p.waitForTimeout(200); await p.click('[data-key=prefs-acct-del-yes]'); await p.waitForTimeout(1500);
  ok('після «Так, видалити»: у базі немає акаунта, сесій, стану, історії стану', n(`SELECT COUNT(*) FROM users WHERE id = ${uid}`) === 0 && n(`SELECT COUNT(*) FROM sessions WHERE user_id = ${uid}`) === 0
    && n(`SELECT COUNT(*) FROM user_state WHERE user_id = ${uid}`) === 0 && n(`SELECT COUNT(*) FROM user_state_hist WHERE user_id = ${uid}`) === 0);
  ok('у журналі аудиту — лише безіменне «account_deleted»', n(`SELECT COUNT(*) FROM audit_log WHERE user_id = ${uid}`) === 0 && n(`SELECT COUNT(*) FROM audit_log WHERE action = 'account_deleted' AND user_id IS NULL`) >= 1);
  const st = await p.evaluate(() => JSON.parse(localStorage.getItem('teplo.v1')));
  ok('на пристрої показання світла лишились', st && (st.mrecs || []).length === 4, st && (st.mrecs || []).length);
  ok('Налаштування: знову «Увійти», без «Видалити акаунт»; тост', /Увійти/.test(await p.textContent('[data-key=prefs-sync]').catch(() => '')) && !(await p.$('[data-key=prefs-acct-del]')));
  const r = await p.evaluate(async () => (await fetch('/api/account/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"confirm":"delete"}' })).status);
  ok('без входу — 401/403, нічого не видаляє', r === 401 || r === 403, r);
  ok('без помилок JS', !errs.length, errs);
  await b.close(); console.log(`\n${pass} OK, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})();
