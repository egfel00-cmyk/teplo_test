// Картка-нагадування (Bot API 10.4, app/widget.php): малюється з chat_data, «Оплатив» → request('paid:0') → «✓ Оплачено», «Нагадати завтра»,
// фоновий 'st' при показі, помилка — текстом. Справжнього Telegram немає: window.TelegramWidget — підміна.
// php -r 'define("TEPLO",1); require "app/core.php"; require "app/telegram.php"; require "app/reminders.php"; require "app/widget.php"; file_put_contents("/tmp/w.html", BotWidget::HTML);'
// node e2e_widget.cjs /tmp/w.html  → /tmp/e2e_widget.png
const { chromium } = require('playwright'); const fs = require('fs');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('  OK  ' + n); } else { fail++; console.log(' FAIL ' + n + (x !== undefined ? ' → ' + JSON.stringify(x) : '')); } };
const html = fs.readFileSync(process.argv[2] || '/tmp/w.html', 'utf8');
const D = { v: 1, k: 'waste10', ym: '2026-11', l: 'uk', t: 'Вивіз сміття за листопад', s: 'Зазвичай платять до 20.12', b: '2026-12-01', e: '2099-12-20',
  p: [{ id: 'main', n: 'Моя квартира', v: '≈ 70,41 грн', a: 70.41, d: 0 }, { id: 'p2', n: 'Мамина', v: '', a: null, d: 0 }] };
const STUB = '<script>window.__q=[];window.__fail=false;window.TelegramWidget={chatData:' + JSON.stringify(JSON.stringify(D)) + ',viewer:{id:1},chatType:"private",'
  + 'HapticFeedback:{notificationOccurred(){}},_h:{},onEvent(n,f){this._h[n]=f},request(q){window.__q.push(q);var s=JSON.parse(this.chatData);'
  + 'if(window.__fail)return Promise.reject({name:"WidgetRequestError",code:"FAILED"});if(q==="paid:0"){s.p[0].d=1;s.p[0].x="Оплачено 12.11"}'
  + 'if(q==="later")s.z="13.11 о 10:00";this.chatData=JSON.stringify(s);return Promise.resolve({result:this.chatData})}};</script>';
const CSS = '<style>:root{--tg-theme-button-color:#2481cc;--tg-theme-button-text-color:#fff;--tg-theme-hint-color:#8a8a8a;--tg-theme-text-color:#000;'
  + '--tg-theme-secondary-bg-color:#eef1f4;--tg-theme-link-color:#2481cc;--tg-theme-section-separator-color:#e3e3e3;--tg-theme-destructive-text-color:#d14}</style>';
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 360, height: 360 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.setContent('<html><head>' + CSS + '</head><body>' + STUB + html + '</body></html>');
  await p.waitForTimeout(200);
  const t0 = await p.textContent('#w');
  ok('картка: заголовок, строк, дві квартири, сума', t0.includes('Вивіз сміття за листопад') && t0.includes('Залишилось') && t0.includes('Мамина') && t0.includes('≈ 70,41 грн'), t0);
  ok('при показі — один фоновий запит «st»', JSON.stringify(await p.evaluate(() => window.__q)) === '["st"]');
  ok('«Оплатив» — лише там, де відома сума (1 кнопка)', await p.locator('button[data-q^=paid]').count() === 1);
  await p.screenshot({ path: '/tmp/e2e_widget_0.png' });
  await p.click('button[data-q="paid:0"]'); await p.waitForTimeout(100);
  const t1 = await p.textContent('#w');
  ok('«Оплатив» → «✓ Оплачено 12.11», кнопки більше немає', t1.includes('✓ Оплачено 12.11') && await p.locator('button[data-q^=paid]').count() === 0, t1);
  await p.click('button[data-q=later]'); await p.waitForTimeout(100);
  ok('«Нагадати завтра» → «Нагадаю 13.11 о 10:00»', (await p.textContent('#w')).includes('Нагадаю 13.11 о 10:00'));
  await p.evaluate(() => { window.__fail = true; const s = JSON.parse(TelegramWidget.chatData); delete s.z; TelegramWidget.chatData = JSON.stringify(s); TelegramWidget._h.chatDataChanged(); });
  await p.click('button[data-q=later]'); await p.waitForTimeout(100);
  ok('бот не відповів — «Не вийшло — спробуйте ще раз»', (await p.textContent('#w')).includes('Не вийшло'));
  await p.evaluate(() => { const s = JSON.parse(TelegramWidget.chatData); s.p.forEach(x => x.d = 1); s.l = 'ru'; TelegramWidget.chatData = JSON.stringify(s); TelegramWidget._h.chatDataChanged(); });
  const t3 = await p.textContent('#w');
  ok('усе зроблено — «Всё сделано» (ru), без смужки й кнопок', t3.includes('Всё сделано') && !t3.includes('Осталось') && await p.locator('button').count() === 0, t3);
  await p.screenshot({ path: '/tmp/e2e_widget.png' });
  ok('без помилок JS', errs.length === 0, errs);
  console.log(`\nИтог: ${pass} OK, ${fail} FAIL`); await b.close(); process.exit(fail ? 1 : 0);
})();
