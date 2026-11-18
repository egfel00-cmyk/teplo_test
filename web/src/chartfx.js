/* Рух графіків «Статистики» (172-а, власник 18.11: «поищи красивые фреймворки — может, там анимации есть сразу, которые не будут тормозить нигде»).
 * Вибір — свій SVG без бібліотек (таблиця порівняння — docs/ПРОДОЛЖЕНИЕ.md, 172-а): Chart.js / ECharts / ApexCharts малюють canvas або
 * перемальовують увесь рисунок щокадру в головному потоці, важать 50–370 КБ gzip, кольори тем і підписи для читалок — лише своїм кодом поверх.
 *
 * Правила руху:
 *   • лише transform / opacity / stroke-dasharray|offset невеликих SVG; поява ≤ 300 мс, зміна місяця ≤ 200 мс;
 *   • один раз на графік (ключ data-fx: екран + вид + квартира + місяць), коли він у кадрі (IntersectionObserver); перемальовка того самого — без руху;
 *   • без руху зовсім: «Зменшити рух» у системі, легкий режим TeploAcc (пам'ять ≤ 2 ГБ, ≤ 2 ядер, старий Android, Save-Data, повільні кадри),
 *     немає Web Animations чи IntersectionObserver. Автотести на 2-ядерній машині — localStorage['teplo.fx'] = 'full'.
 * Поява: стовпчики ростуть від осі (scaleY від низу), кільце «промальовується» по колу від 12-ї години.
 * Зміна місяця в кільці (стрілки, свайп, тап по стовпчику): сектори переходять від старих кутів і довжин до нових, сума в центрі — лічильником. */
(function () {
  'use strict';
  var seen = {}, io = null, last = null, pend = [];
  var EASE = 'cubic-bezier(.2,.7,.2,1)';
  function calm() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function off() {
    var b = document.body;
    if (!b || !b.animate || !window.IntersectionObserver || calm()) return true;
    return window.TeploAcc ? window.TeploAcc.lite() : false;
  }
  function num(el, k) { return parseFloat(el.getAttribute(k)) || 0; }

  /** Стовпчики: кожен .fx-b росте від осі; хвиля зліва направо не довша за 140 мс. Підписи над ними (.vl) — проявляються наприкінці. */
  function grow(svg) {
    var bars = svg.querySelectorAll('.fx-b'), n = bars.length;
    Array.prototype.forEach.call(bars, function (b, i) {
      b.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 260, delay: n > 1 ? Math.round(i * 140 / (n - 1)) : 0, easing: EASE, fill: 'backwards' });
    });
    var ds = svg.querySelectorAll('.fx-d'), m = ds.length;   // точки (подача, зв'язок із погодою) — з'являються з центру
    Array.prototype.forEach.call(ds, function (d, i) {
      d.animate([{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 220, delay: m > 1 ? Math.round(i * 160 / (m - 1)) : 0, easing: EASE, fill: 'backwards' });
    });
    Array.prototype.forEach.call(svg.querySelectorAll('.vl'), function (t) { t.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay: 200, fill: 'backwards' }); });
  }
  /** Кільце: сектори по черзі «промальовуються» (stroke-dashoffset від довжини до 0) — разом 300 мс, швидкість однакова. */
  function sweep(ring) {
    var ss = ring.querySelectorAll('.mc-s'), tot = 0;
    Array.prototype.forEach.call(ss, function (s) { tot += num(s, 'data-l'); });
    var at = 0;
    Array.prototype.forEach.call(ss, function (s) {
      var l = num(s, 'data-l'), d = tot ? Math.max(40, 300 * l / tot) : 300;
      s.animate([{ strokeDashoffset: l + 'px' }, { strokeDashoffset: '0px' }], { duration: d, delay: at, easing: 'linear', fill: 'backwards' });
      at += tot ? 300 * l / tot : 0;
    });
    var c = ring.querySelector('.mc-c'); if (c) c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 80, fill: 'backwards' });
  }
  /** Знімок кільця перед перемальовкою (зміна місяця): кути й довжини секторів і сума. */
  function snap() {
    var ring = document.querySelector('.mc-ring'); if (!ring) { last = null; return; }
    var m = {}; Array.prototype.forEach.call(ring.querySelectorAll('.mc-s'), function (s) { m[s.getAttribute('data-k')] = { a: num(s, 'data-a'), l: num(s, 'data-l') }; });
    last = { at: Date.now(), m: m, sum: num(ring, 'data-sum'), c: num(ring.querySelector('.mc-s') || ring, 'data-c') };
  }
  function money0(n) { var ru = (document.documentElement.lang || '') === 'ru'; return Math.round(n).toLocaleString(ru ? 'ru-RU' : 'uk-UA'); }
  /** Новий місяць: від знімка до нових кутів і довжин за 180 мс; сектор, якого не було, — з нуля на своєму місці. */
  function tween(ring, p) {
    var C = num(ring.querySelector('.mc-s') || ring, 'data-c') || p.c;
    Array.prototype.forEach.call(ring.querySelectorAll('.mc-s'), function (s) {
      var k = s.getAttribute('data-k'), a = num(s, 'data-a'), l = num(s, 'data-l'), o = p.m[k] || { a: a, l: 0 };
      if (Math.abs(o.a - a) < 0.05 && Math.abs(o.l - l) < 0.05) return;
      s.animate([{ transform: 'rotate(' + o.a + 'deg)', strokeDasharray: o.l + 'px ' + C + 'px' }, { transform: 'rotate(' + a + 'deg)', strokeDasharray: l + 'px ' + C + 'px' }],
        { duration: 180, easing: 'cubic-bezier(.3,.6,.2,1)' });
    });
    var v = ring.querySelector('.mc-v'), to = num(ring, 'data-sum'), from = p.sum;
    if (!v || !window.requestAnimationFrame || Math.abs(to - from) < 1) return;
    var t0 = 0, txt = v.textContent;
    requestAnimationFrame(function f(ts) {
      if (!v.isConnected) return;
      if (!t0) t0 = ts; var q = Math.min(1, (ts - t0) / 180), e = 1 - Math.pow(1 - q, 3);
      v.textContent = q < 1 ? money0(from + (to - from) * e) : txt;
      if (q < 1) requestAnimationFrame(f);
    });
  }
  function start(el) {
    seen[el.getAttribute('data-fx')] = 1;   // «бачили» — лише коли рух почався: фонова перемальовка до входу в кадр (погода, синхронізація) не забирає появу
    el.classList.remove('fx-pre');
    if (el.classList.contains('mc-ring')) sweep(el); else grow(el);
  }
  /** Після кожної перемальовки: нові графіки чекають, поки з'являться в кадрі (до того стовпчики й сектори сховані класом fx-pre — без спалаху). */
  function scan(root) {
    root = root || document;
    var els = root.querySelectorAll('[data-fx]'), quiet = off(), p = last; last = null;
    pend = pend.filter(function (x) { if (x.isConnected) return true; if (io) io.unobserve(x); return false; });   // старі вузли після перемальовки
    if (!els.length) return;
    if (!io && !quiet) io = new IntersectionObserver(function (es) {
      es.forEach(function (en) { if (!en.isIntersecting) return; io.unobserve(en.target); if (en.target.isConnected) start(en.target); });
    }, { threshold: 0.2 });
    Array.prototype.forEach.call(els, function (el) {
      var k = el.getAttribute('data-fx');
      if (quiet) { seen[k] = 1; return; }
      if (p && Date.now() - p.at < 1500 && el.classList.contains('mc-ring')) { seen[k] = 1; tween(el, p); return; }   // інший місяць — перехід, навіть якщо цей уже бачили
      if (seen[k]) return;
      el.classList.add('fx-pre'); io.observe(el); pend.push(el);
    });
  }
  window.TeploFx = { scan: scan, snap: snap, off: off, reset: function () { seen = {}; } };
})();
