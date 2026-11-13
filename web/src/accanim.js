/* Розкривашки (<details>) розкриваються й згортаються плавно — на сайті й в /admin (139-а, власник 13.11: «анимации раскрывания и скрывания
 * аккордеонов внеси везде в системе, но так, чтобы на мобильных не тормозило, особенно на старых Android»).
 *
 * Повний режим: висота — Web Animations лише на час руху (240 / 200 мс), вміст — прозорість і зсув CSS-анімацією (композитор).
 * Легкий режим (висота стрибає одразу, вміст лише проявляється — без перерахунку сторінки на кожен кадр):
 *   слабкий пристрій (пам'ять ≤ 2 ГБ, ядер ≤ 2, Android WebView / Chrome < 80, «Економія трафіку»), немає Web Animations,
 *   дуже довгий вміст (> 3 екранів) або телефон уже двічі поспіль не встигав (середній кадр > 30 мс) — тоді запам'ятовуємо на пристрої.
 * «Зменшити рух» у системі — без анімації. Розкривашка з data-noanim — як була (рідний <details>).
 *
 * Намір (відкрита / закрита) — одразу: стрілка повертається з першого дотику (клас shut), стан у застосунку записується на початку
 * згортання (подія toggle з open = false), щоб перемальовка посеред руху не повернула стару. Дубль click без нового дотику (WebView) — пропускаємо.
 * Хуки: TeploAcc.hooks.before(d) — до заміру висоти при відкритті (застосунок додає «Згорнути» внизу), .intent(d, open) — свій стан. */
(function () {
  'use strict';
  var LS = 'teplo.fx', OPEN_MS = 240, CLOSE_MS = 200;
  var hooks = { before: null, intent: null };
  var css = '' +
    'details.acc-anim{overflow:hidden}' +
    'details.acc-measure>:not(summary){display:none!important}' +
    'details.shut[open]>summary .pacc-chev{transform:rotate(90deg)!important;transition:none!important}' +
    'details.acc-in>:not(summary){-webkit-animation:accIn .22s ease-out both;animation:accIn .22s ease-out both}' +
    'details.acc-out>:not(summary){-webkit-animation:accOut .18s ease-in both;animation:accOut .18s ease-in both}' +
    '@-webkit-keyframes accIn{from{opacity:0;-webkit-transform:translateY(-6px)}to{opacity:1;-webkit-transform:none}}' +
    '@keyframes accIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}' +
    '@-webkit-keyframes accOut{from{opacity:1}to{opacity:0}}@keyframes accOut{from{opacity:1}to{opacity:0}}' +
    '@media (prefers-reduced-motion: reduce){details.acc-in>:not(summary),details.acc-out>:not(summary){-webkit-animation:none;animation:none}}';
  function addCss() { if (document.getElementById('acc-anim-css')) return; var s = document.createElement('style'); s.id = 'acc-anim-css'; s.textContent = css; (document.head || document.documentElement).appendChild(s); }
  if (document.head) addCss(); else document.addEventListener('DOMContentLoaded', addCss);

  function calm() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function store(v) { try { if (v == null) localStorage.removeItem(LS); else localStorage.setItem(LS, v); } catch (e) { /* приватний режим */ } }
  function stored() { try { return localStorage.getItem(LS) || ''; } catch (e) { return ''; } }
  /** Слабкий пристрій — висоту не ведемо (кожен кадр — перерахунок сторінки). */
  var WEAK = (function () {
    var n = navigator, ua = n.userAgent || '', m = /Android/.test(ua) && ua.match(/Chrome\/(\d+)/);
    return !!((n.deviceMemory && n.deviceMemory <= 2) || (n.hardwareConcurrency && n.hardwareConcurrency <= 2) || (m && +m[1] < 80) ||
      (n.connection && n.connection.saveData));
  })();
  function lite() { var v = stored(); return v === 'full' ? !document.body.animate : WEAK || v === 'lite' || !document.body.animate; }   // 'full' — примусово (автотести на 2-ядерній машині)
  var SLOW = 0;
  /** Середній кадр під час руху: двічі поспіль > 30 мс — далі на цьому пристрої легкий режим; швидкий рух скидає лічильник. */
  function watch(ms) {
    if (!window.requestAnimationFrame) return;
    var t0 = 0, last = 0, n = 0, sum = 0;
    requestAnimationFrame(function f(ts) {
      if (!t0) t0 = last = ts; else { sum += ts - last; last = ts; n++; }
      if (ts - t0 < ms) { requestAnimationFrame(f); return; }
      if (n < 3) return;
      if (sum / n > 30) { if (++SLOW >= 2) store('lite'); } else SLOW = 0;
    });
  }

  function sumOf(d) { var c = d.firstElementChild; for (; c; c = c.nextElementSibling) if (c.tagName === 'SUMMARY') return c; return null; }
  function want(d) { return d._an ? d._dir === 'open' : d.open; }
  /** Згортаємо: стан застосунку — одразу (toggle з open = false), сам <details> закривається в кінці руху (вміст видно під час руху). */
  function intentClose(d) {
    try { Object.defineProperty(d, 'open', { configurable: true, get: function () { return false; } }); d.dispatchEvent(new Event('toggle')); } catch (e) { /* старий браузер */ }
    try { delete d.open; } catch (e2) { /* */ }
  }
  function cls(d, c, on) { if (d.classList) d.classList[on ? 'add' : 'remove'](c); }
  function fadeIn(d) {
    cls(d, 'acc-out', false); cls(d, 'acc-in', false); void d.offsetWidth; cls(d, 'acc-in', true);
    clearTimeout(d._ft); d._ft = setTimeout(function () { cls(d, 'acc-in', false); }, 300);
  }
  function done(d) {
    var an = d._an; if (!an) return; d._an = null; clearTimeout(d._tm);
    if (d._dir === 'close') { d.open = false; cls(d, 'shut', false); cls(d, 'acc-out', false); }
    cls(d, 'acc-anim', false);
    try { an.cancel(); } catch (e) { /* fill forwards знято — висота знову своя */ }
  }
  /** Висота закритої: вміст ховаємо класом на мить заміру (без зміни open — без зайвих toggle). */
  function closedH(d) { cls(d, 'acc-measure', true); var h = d.offsetHeight; cls(d, 'acc-measure', false); return h; }

  function anim(d, open) {
    if (hooks.intent) try { hooks.intent(d, open); } catch (e) { /* */ }
    var h0 = d.getBoundingClientRect().height, was = d._an ? d._dir : '';
    if (d._an) { var a0 = d._an; d._an = null; clearTimeout(d._tm); try { a0.cancel(); } catch (e1) { /* */ } }
    cls(d, 'shut', !open);
    if (calm()) { cls(d, 'shut', false); cls(d, 'acc-anim', false); d.open = open; if (open && hooks.before) hooks.before(d); return; }
    if (open) { d.open = true; if (hooks.before) hooks.before(d); } else intentClose(d);
    var h1 = open ? d.offsetHeight : closedH(d), big = Math.abs(h1 - h0) > 3 * (window.innerHeight || 700);   // дуже довгий вміст (таблиці /admin) — лише проявлення
    if (lite() || big || Math.abs(h1 - h0) < 2) {
      cls(d, 'shut', false); cls(d, 'acc-anim', false);
      if (open) { if (was !== 'close') fadeIn(d); } else d.open = false;
      return;
    }
    d._dir = open ? 'open' : 'close';
    cls(d, 'acc-anim', true);
    var ms = open ? OPEN_MS : CLOSE_MS;
    var an = d._an = d.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: ms, easing: open ? 'cubic-bezier(.2,.7,.2,1)' : 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
    // вміст проявляється лише при відкритті з закритої (посеред згортання він і так видно — без блимання); при згортанні — тихо гасне
    if (open) { if (was !== 'close') fadeIn(d); else cls(d, 'acc-out', false); } else { cls(d, 'acc-in', false); cls(d, 'acc-out', true); }
    an.onfinish = function () { if (d._an === an) done(d); };
    d._tm = setTimeout(function () { if (d._an === an) done(d); }, ms + 150);   // finish не прийшов (вкладку сховали)
    watch(ms);
  }

  // дотик / натискання на шапку — справжня дія; click без нього впритул до попереднього — дубль (WebView)
  document.addEventListener('pointerdown', function (e) {
    var sm = e.target.closest && e.target.closest('summary'); if (sm && sm.parentElement && sm.parentElement.tagName === 'DETAILS') sm.parentElement._pd = Date.now();
  }, true);
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented) return;
    var sm = e.target.closest && e.target.closest('summary'), d = sm && sm.parentElement;
    if (!d || d.tagName !== 'DETAILS' || sumOf(d) !== sm || d.hasAttribute('data-noanim')) return;
    var it = e.target.closest('a[href], button, input, select, textarea, label'); if (it && it !== sm && sm.contains(it)) return;
    e.preventDefault();
    var now = Date.now();
    if (d._ck && now - d._ck < 350 && !(d._pd > d._ck)) return;   // дубль того ж тапу — не розвертаємо рух назад
    d._ck = now;
    anim(d, !want(d));   // посеред руху — у протилежний бік від поточного наміру
  });

  window.TeploAcc = { anim: anim, want: want, hooks: hooks, lite: lite, reset: function () { store(null); SLOW = 0; } };
})();
