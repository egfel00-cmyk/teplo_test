/* «Живий» телефон лендинга (175-а; власник 18.11: «як на смартфоні відкривається квартира, лічильник і додається показання через фото; щоб не гальмувало ніде»).
 * Цикл 12 с: Telegram → квартира розгортається → «+» на воді → сторінка лічильника → камера, сканування, «Розпізнано» → аркуш «Зберегти» → ролики
 * докручуються → «Відправити у фоні» → «Сайт прийняв» → головна → квартира згортається. Шари — app.js lpPhone(), тут — лише рух.
 * Правила: тільки transform/opacity (Web Animations, композитор); пауза поза кадром; без руху — «Зменшити рух», TeploAcc.lite(), webdriver, повільні кадри
 * (> 50 мс — teplo.lpd = off). Автотести руху — teplo.fx = full. Замір і сценарій — tests/e2e/e2e_lpdemo.cjs, docs/ПРОДОЛЖЕНИЕ.md (175-а). */
(function () {
  'use strict';
  var D = 12000, EASE = 'cubic-bezier(.22,1,.36,1)', IN = 'cubic-bezier(.4,0,.6,1)', LIN = 'linear';
  var cur = null, io = null, lastT = 0;

  function calm() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function stored(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function off() {
    var b = document.body;
    if (!b || !b.animate || !window.IntersectionObserver || calm()) return true;
    if (stored('teplo.fx') === 'full') return false;   // автотести руху на 2-ядерній машині
    if (navigator.webdriver || stored('teplo.lpd') === 'off') return true;
    return window.TeploAcc ? window.TeploAcc.lite() : false;
  }
  function ext(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }
  /** tl: [[мс, {властивості}, крива до наступної?], …] → ключові кадри на весь цикл; до першої точки й після останньої — тримаємо значення. */
  function frames(tl) {
    var out = [], i;
    if (tl[0][0] > 0) out.push(ext(tl[0][1], { offset: 0, easing: LIN }));
    for (i = 0; i < tl.length; i++) out.push(ext(tl[i][1], { offset: Math.min(1, tl[i][0] / D), easing: tl[i][2] || EASE }));
    if (tl[tl.length - 1][0] < D) out.push(ext(tl[tl.length - 1][1], { offset: 1 }));
    return out;
  }
  /** Позиція центру елемента в координатах екрана телефона (375 px), без урахування transform (offsetLeft/Top). */
  function at(el, vp) {
    var x = el.offsetWidth / 2, y = el.offsetHeight / 2, n = el;
    while (n && n !== vp) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return [Math.round(x), Math.round(y)];
  }
  var O = function (v) { return { opacity: v }; };
  var T = function (v) { return { transform: v }; };
  var TO = function (tr, op) { return { transform: tr, opacity: op }; };

  function build(vp) {
    var q = function (s) { return vp.querySelector(s); }, qa = function (s) { return vp.querySelectorAll(s); };
    var list = [], add = function (el, tl) { if (el) list.push([el, tl]); };
    var home = q('.s-home'), meter = q('.s-meter'), cam = q('.s-cam'), sheet = q('.s-sheet'), cards = q('.lpd-cards'), a2 = q('.a2');
    if (!home || !meter || !cam || !sheet || !cards || !a2) return null;
    var H = cards.offsetHeight + 8;   // наскільки підтягується друга квартира, коли перша згорнута
    // 0–2.4 с: нагадування в Telegram
    add(q('.lpd-tg'), [[0, TO('translateY(-150%)', 0)], [300, TO('translateY(-150%)', 0)], [700, TO('none', 1), LIN], [2000, TO('none', 1), IN], [2350, TO('translateY(-150%)', 0)]]);
    // 2.4–2.9 с: квартира розгортається (картки проявляються згори вниз, друга квартира з'їжджає); 11.45–11.8 с — згортається назад
    Array.prototype.forEach.call(cards.children, function (c, i) {
      var d = i * 60;
      add(c, [[0, TO('translateY(-12px)', 0)], [2450 + d, TO('translateY(-12px)', 0)], [2850 + d, TO('none', 1), LIN], [11450, TO('none', 1)], [11750, TO('translateY(-12px)', 0)]]);
    });
    add(a2, [[0, T('translateY(-' + H + 'px)')], [2450, T('translateY(-' + H + 'px)')], [2900, T('none'), LIN], [11450, T('none')], [11800, T('translateY(-' + H + 'px)')]]);
    add(q('.a1 .lpd-chev'), [[0, T('rotate(90deg)')], [2450, T('rotate(90deg)')], [2800, T('rotate(-90deg)'), LIN], [11450, T('rotate(-90deg)')], [11750, T('rotate(90deg)')]]);
    // 3.65–4.05 с: сторінка лічильника заходить справа; 11.05–11.45 — назад
    add(home, [[0, TO('none', 1)], [3650, TO('none', 1)], [4050, TO('translateX(-28%)', .55), LIN], [11050, TO('translateX(-28%)', .55)], [11450, TO('none', 1)]]);
    add(meter, [[0, T('translateX(100%)')], [3650, T('translateX(100%)')], [4050, T('none'), LIN], [11050, T('none')], [11450, T('translateX(100%)')]]);
    // вода на головній: «Передати до 20-го» → «Передано» (поки головну закрито), назад — коли квартира вже згорнута
    add(q('.lpd-w0'), [[0, O(1)], [11000, O(1)], [11200, O(0), LIN], [11800, O(0)], [11900, O(1)]]);
    add(q('.lpd-w1'), [[0, O(0)], [11000, O(0)], [11200, O(1), LIN], [11800, O(1)], [11900, O(0)]]);
    // 4.85–5.25 с: камера знизу; 5.3–6.3 — сканування; 6.3 — знайдено вікно роликів; 6.4 — результат
    add(cam, [[0, T('translateY(100%)')], [4850, T('translateY(100%)')], [5250, T('none'), LIN], [8750, T('none'), IN], [9100, T('translateY(100%)')]]);
    add(q('.lpd-scan'), [[0, TO('translateY(0)', 0)], [5350, TO('translateY(0)', 0)], [5450, TO('translateY(0)', 1), 'cubic-bezier(.45,0,.55,1)'], [6250, TO('translateY(340px)', 1)], [6350, TO('translateY(340px)', 0)]]);
    add(q('.lpd-box'), [[0, TO('rotate(-4deg) scale(1.08)', 0)], [6250, TO('rotate(-4deg) scale(1.08)', 0)], [6450, TO('rotate(-4deg)', 1), LIN], [9100, TO('rotate(-4deg)', 1)], [9200, TO('rotate(-4deg) scale(1.08)', 0)]]);
    add(q('.lpd-res'), [[0, TO('translateY(16px)', 0)], [6400, TO('translateY(16px)', 0)], [6700, TO('none', 1), LIN], [9100, TO('none', 1)], [9200, TO('translateY(16px)', 0)]]);
    // 6.95–7.35 с: аркуш «Зберегти» знизу, під ним — притемнення
    add(q('.lpd-dim'), [[0, O(0)], [6950, O(0)], [7300, O(.45), LIN], [8650, O(.45)], [9000, O(0)]]);
    add(sheet, [[0, T('translateY(105%)')], [6950, T('translateY(105%)')], [7350, T('none'), LIN], [8650, T('none'), IN], [9000, T('translateY(105%)')]]);
    add(q('.lpd-used'), [[0, TO('translateY(6px)', 0)], [7500, TO('translateY(6px)', 0)], [7750, TO('none', 1), LIN], [9000, TO('none', 1)], [9050, TO('translateY(6px)', 0)]]);
    // 9.15–9.9 с: на табло ролики докручуються до нових цифр (праві — пізніше, як у справжнього лічильника)
    Array.prototype.forEach.call(qa('.s-meter .lpd-r'), function (r, i) {
      var d = i * 90;
      add(r, [[0, T('translateY(0)')], [9150 + d, T('translateY(0)')], [9650 + d, T('translateY(-50%)'), LIN], [11450, T('translateY(-50%)')], [11500, T('translateY(0)')]]);
    });
    // картка води на головній — нові цифри, поки її закриває сторінка лічильника
    Array.prototype.forEach.call(qa('.lpd-cards .lpd-r'), function (r) {
      add(r, [[0, T('translateY(0)')], [10950, T('translateY(0)')], [11000, T('translateY(-50%)'), LIN], [11800, T('translateY(-50%)')], [11900, T('translateY(0)')]]);
    });
    // підпис під табло: «Передано {місяць тому}» → «Внесено сьогодні, ще не передано» → «Передано сьогодні»
    add(q('.m0'), [[0, O(1)], [9100, O(1)], [9300, O(0), LIN], [11450, O(0)], [11500, O(1)]]);
    add(q('.m1'), [[0, O(0)], [9200, O(0)], [9400, O(1), LIN], [10050, O(1)], [10250, O(0)]]);
    add(q('.m2'), [[0, O(0)], [10100, O(0)], [10300, O(1), LIN], [11450, O(1)], [11500, O(0)]]);
    // 9.9 с: «Відправити у фоні» → «Сайт прийняв показання»
    add(q('.lpd-btn.send'), [[0, O(1)], [10000, O(1)], [10150, O(0), LIN], [11450, O(0)], [11500, O(1)]]);
    add(q('.lpd-ok'), [[0, TO('scale(.96)', 0)], [10050, TO('scale(.96)', 0)], [10300, TO('none', 1), LIN], [11450, TO('none', 1)], [11500, TO('scale(.96)', 0)]]);
    // дотики: сіре коло там, куди натискаємо, і сама кнопка трохи вдавлюється
    var taps = [[2300, 'apt'], [3500, 'card'], [4700, 'photo'], [6850, 'use'], [8550, 'save'], [9850, 'send']], ring = [], first = null;
    taps.forEach(function (tp) {
      var el = q('[data-tap="' + tp[1] + '"]'); if (!el) return;
      var p = at(el, vp), tr = function (s) { return 'translate(' + p[0] + 'px,' + p[1] + 'px) scale(' + s + ')'; }, T0 = tp[0];
      if (!first) first = tr(.5);
      ring.push([T0 - 160, TO(tr(.5), 0)], [T0, TO(tr(.9), .9), LIN], [T0 + 360, TO(tr(1.35), 0)]);
      add(el, [[0, T('none')], [T0, T('none')], [T0 + 90, T('scale(.96)'), LIN], [T0 + 220, T('none')]]);
    });
    if (ring.length) add(q('.lpd-tap'), [[0, TO(first, 0)]].concat(ring));
    return list;
  }

  function stop() {
    if (!cur) return;
    try { lastT = cur.anims.length ? (cur.anims[0].currentTime || 0) % D : 0; } catch (e) { lastT = 0; }
    cur.anims.forEach(function (a) { try { a.cancel(); } catch (e) { /* уже знято */ } });
    if (io) { io.disconnect(); io = null; }
    if (cur.vp) cur.vp.classList.remove('run');
    cur = null;
  }
  function setPlay(on) {
    if (!cur) return;
    var t = cur.anims.length ? cur.anims[0].currentTime : 0;
    cur.anims.forEach(function (a) { a.currentTime = t; if (on) a.play(); else a.pause(); });
    if (on && !cur.probed) probe();
  }
  /** Живий пристрій: перші ~2 с руху — середній кадр головного потоку; > 50 мс (менше 20 кадрів/с) — нерухома головна й більше не пробуємо. */
  function probe() {
    cur.probed = true;
    var n = 0, t0 = 0, prev = 0, sum = 0, me = cur;
    var f = function (ts) {
      if (cur !== me) return;
      if (!t0) { t0 = prev = ts; return requestAnimationFrame(f); }
      sum += ts - prev; prev = ts; n++;
      if (ts - t0 < 2000) return requestAnimationFrame(f);
      if (sum / n > 50) { try { localStorage.setItem('teplo.lpd', 'off'); } catch (e) { /* приватний режим */ } stop(); }
    };
    setTimeout(function () { if (cur === me) requestAnimationFrame(f); }, 600);
  }

  /** Після кожної відмальовки лендинга: знайти телефон і (пере)запустити рух з того ж моменту циклу. */
  function mount(root) {
    var vp = root && root.querySelector && root.querySelector('.lpd');
    if (!vp) { stop(); return; }
    if (cur && cur.vp === vp) return;
    var keep = cur ? null : lastT;
    stop();
    if (off()) return;
    var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    ready.then(function () {
      if (!vp.isConnected || (cur && cur.vp === vp)) return;
      var list = build(vp); if (!list) return;
      // «прогрів»: сцени один раз малюються на своїх місцях під головною (z-index), поки нічого не рухається, — інакше перша поява кожної
      // (сторінка лічильника, камера, аркуш) малюється в головному потоці посеред руху (замір CPU ×6: задачі 50–80 мс)
      vp.classList.add('run', 'warm');
      requestAnimationFrame(function () { requestAnimationFrame(function () {
        vp.classList.remove('warm');
        if (!vp.isConnected || (cur && cur.vp === vp)) return;
        var anims = list.map(function (x) { return x[0].animate(frames(x[1]), { duration: D, iterations: Infinity }); });
        cur = { vp: vp, anims: anims, probed: false };
        var t = keep !== null ? keep : lastT;
        anims.forEach(function (a) { a.pause(); a.currentTime = t; });
        io = new IntersectionObserver(function (es) { es.forEach(function (e) { setPlay(e.isIntersecting); }); }, { threshold: .2 });
        io.observe(vp.closest('.lp-phone') || vp);
      }); });
    });
  }
  /** Для перевірок і скринів: зупинити цикл на моменті ms (усі шари — як у цю мить). */
  function seek(ms) { if (!cur) return false; cur.anims.forEach(function (a) { a.pause(); a.currentTime = ms % D; }); return true; }

  /** Інший нескінченний рух лендинга — лише поки в кадрі: стрічки постачальників, фото табло в кроці 1 (лінія сканування, рамки — анімує top/clip-path/filter,
   *  тобто головний потік щокадру), світлодіоди «imp», прилади SMIL у фінальній панелі. Поза кадром — пауза: не будять головний потік і не змушують
   *  щокадру перераховувати шари живого телефона (замір 175-ї: 60 перерахунків стилю й шарів за секунду навіть коли телефон стоїть). */
  var io2 = null;
  function idle(root) {
    if (io2) { io2.disconnect(); io2 = null; }
    var els = root && root.querySelectorAll ? root.querySelectorAll('.lp-marq, .lpb-marq, .art-photo, .lp-tile, svg.lpm') : [];
    if (!els.length || !window.IntersectionObserver) return;
    io2 = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        var el = e.target;
        if (el.pauseAnimations) { if (!calm() && !navigator.webdriver) { if (e.isIntersecting) el.unpauseAnimations(); else el.pauseAnimations(); } }
        else el.classList.toggle('lp-idle', !e.isIntersecting);
      });
    });
    Array.prototype.forEach.call(els, function (el) { io2.observe(el); });
  }

  window.TeploLpDemo = { mount: function (root) { mount(root); idle(root); }, stop: stop, seek: seek, D: D, running: function () { return !!cur; } };
})();
