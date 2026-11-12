/* Камера з підказками (121-а, просьба власника 12.11.2026).
 * Живий кадр з задньої камери, рамка, підказки великим текстом (темно, відблиск, рухається, нечітко, далеко) — по зменшеному кадру
 * рамки кожні 300 мс; той самий рушій, що й для фото (web/ocr/engine.js), читає кадр щойно звільниться: «Теплолічильник · бачу 15,482 Гкал».
 * Одне й те саме в двох кадрах поспіль — цей кадр і знято (вже прочитаний); кнопка «Зняти» — завжди. «Готово» — знімки йдуть у той самий
 * <input type=file>, що й «Обрати фото»: далі весь звичний шлях (копія в /admin, розбір, раскладка по лічильниках).
 * Чисті функції (mapRect, stats, hint, digitH) — без DOM, тест tests/camera.test.js; open() — інтерфейс (e2e tests/e2e/e2e_camera.cjs). */
(function (root) {
  'use strict';
  var A_W = 240;   // ширина кадру рамки для підказок (вирізаємо рамку з повного кадру — так розмиття ще видно)
  // blur — різкість відносно контрасту (дисперсія лапласіана / дисперсія яскравості): різке табло ≥ 0,13, сильно розмите < 0,05
  var TH = { dark: 48, glareLum: 250, glare: 0.03, move: 12, blur: 0.05, flat: 14, far: 0.025 };
  // рамка на екрані — у частках видимої картинки (див. .cam-fr у styles.css: 8 % з боків, 24 % згори, висота 32 %, ширина до 640 px)

  /** Прямокутник на екрані (r, px відносно елемента ew×eh з object-fit: cover) → пікселі кадру камери vw×vh. Без r — уся видима частина. */
  function mapRect(vw, vh, ew, eh, r) {
    if (!(vw > 0 && vh > 0 && ew > 0 && eh > 0)) return { x: 0, y: 0, w: vw || 0, h: vh || 0 };
    var s = Math.max(ew / vw, eh / vh), ox = (vw * s - ew) / 2, oy = (vh * s - eh) / 2;
    r = r || { x: 0, y: 0, w: ew, h: eh };
    var x = Math.max(0, (r.x + ox) / s), y = Math.max(0, (r.y + oy) / s);
    var w = Math.min(vw - x, r.w / s), h = Math.min(vh - y, r.h / s);
    return { x: Math.round(x), y: Math.round(y), w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
  }

  /** Кадр рамки (RGBA w×h) → {lum: середня яскравість 0–255, glare: частка пересвіту, sharp: дисперсія лапласіана (різкість),
   *  flat: розкид яскравості (є що фокусувати), move: середня зміна від prev (сірий попереднього кадру) або null, gray}. */
  function stats(px, w, h, prev) {
    var n = w * h, g = new Uint8Array(n), i;
    for (i = 0; i < n; i++) g[i] = (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8;
    var s = 0, s2 = 0, hi = 0, l1 = 0, l2 = 0, c = 0;
    for (i = 0; i < n; i++) { var v = g[i]; s += v; s2 += v * v; if (v >= TH.glareLum) hi++; }
    for (var y = 1; y < h - 1; y++) for (var x = 1; x < w - 1; x++) {
      var q = y * w + x, lap = 4 * g[q] - g[q - 1] - g[q + 1] - g[q - w] - g[q + w]; l1 += lap; l2 += lap * lap; c++;
    }
    var mean = n ? s / n : 0, lm = c ? l1 / c : 0, mv = null;
    if (prev && prev.length === n) { var d = 0; for (i = 0; i < n; i += 2) d += Math.abs(g[i] - prev[i]); mv = d / Math.ceil(n / 2); }
    return { lum: mean, glare: n ? hi / n : 0, sharp: c ? l2 / c - lm * lm : 0, flat: Math.sqrt(Math.max(0, (n ? s2 / n : 0) - mean * mean)), move: mv, gray: g };
  }

  /** Висота найбільшого рядка з цифрами (від 3) у частках меншої сторони кадру; рядків з цифрами нема — 0. */
  function digitH(res) {
    var m = 0, side = Math.min((res && res.w) || 0, (res && res.h) || 0);
    if (!side) return 0;
    ((res && res.lines) || []).forEach(function (l) { if (String(l.text || '').replace(/\D/g, '').length >= 3 && l.h > m) m = l.h; });
    return m / side;
  }

  /** Яку підказку показати: st — stats(); o: {torch: є ліхтарик, torchOn, ocr: {lines, digitH, found, age (мс)}} → код ('' — усе гаразд). */
  function hint(st, o) {
    o = o || {};
    if (!st) return '';
    if (st.lum < TH.dark) return o.torch && !o.torchOn ? 'dark_t' : 'dark';
    if (st.move !== null && st.move !== undefined && st.move > TH.move) return 'move';
    if (st.glare > TH.glare) return 'glare';
    var oc = o.ocr, fresh = !!(oc && oc.found && oc.age < 4000);
    if (!fresh && st.flat > TH.flat && st.sharp / (st.flat * st.flat) < TH.blur) return 'blur';
    if (oc && !fresh && oc.age < 6000) {
      if (oc.digitH > 0 && oc.digitH < TH.far) return 'far';
      if (!oc.lines) return 'aim';
    }
    return '';
  }

  function supported() {
    var nav = root.navigator, md = nav && nav.mediaDevices;
    return !!(md && typeof md.getUserMedia === 'function' && root.isSecureContext !== false);
  }

  /**
   * Відкрити камеру поверх сторінки. o: {
   *   t(key, vars) — текст, ico(name, size) — значок, kind: 'heat'|'water'|'elec'|'gas', max — скільки знімків,
   *   engine(onPct) → Promise — рушій розпізнавання, read(blob) → Promise<res>, parse(res) → {key, seen, meter, other} | null,
   *   done(files) — знімки (File[]), pick() — «Обрати фото» замість камери, track(name, props) — журнал, tg — відкрито в Telegram }.
   */
  function open(o) {
    var doc = document, t = o.t, max = o.max || 8, kind = o.kind || 'heat';
    var st = { shots: [], keys: {}, last: '', seen: null, seenAt: 0, ocr: null, eng: 0, pct: 0, busy: false, closed: false, prev: null,
      code: '', pend: '', pendN: 0, frames: 0, auto: 0, t0: Date.now(), torch: false, torchOn: false, msg: '', msgUntil: 0, stream: null, track: null, err: '', rms: 0, rmax: 0 };
    var prevFocus = doc.activeElement, ov = doc.createElement('div');
    ov.className = 'cam'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', t('cam_btn'));
    ov.innerHTML = '<video class="cam-v" playsinline muted autoplay></video>' +
      '<div class="cam-fr" aria-hidden="true"><b class="k1"></b><b class="k2"></b><b class="k3"></b><b class="k4"></b></div>' +
      '<div class="cam-flash" aria-hidden="true"></div>' +
      '<div class="cam-top"><button type="button" class="cam-b" data-cam="close" aria-label="' + t('cam_close') + '">' + o.ico('close', 24) + '</button>' +
      '<button type="button" class="cam-b cam-torch" data-cam="torch" aria-pressed="false" hidden>' + o.ico('torch', 22) + '<span>' + t('cam_torch') + '</span></button></div>' +
      '<div class="cam-bot"><p class="cam-seen" aria-live="polite"></p><p class="cam-hint" role="status" aria-live="polite">' + t('cam_start') + '</p>' +
      '<div class="cam-row"><span class="cam-th" aria-hidden="true"></span>' +
      '<button type="button" class="cam-shot" data-cam="shot" aria-label="' + t('cam_shot') + '"><i></i></button>' +
      '<button type="button" class="cam-done" data-cam="done" disabled>' + t('cam_done') + '</button></div></div>';
    doc.body.appendChild(ov);
    var html = doc.documentElement, ovf = html.style.overflow; html.style.overflow = 'hidden';
    var v = ov.querySelector('video'), fr = ov.querySelector('.cam-fr'), hintEl = ov.querySelector('.cam-hint'), seenEl = ov.querySelector('.cam-seen');
    var thEl = ov.querySelector('.cam-th'), doneEl = ov.querySelector('.cam-done'), torchEl = ov.querySelector('.cam-torch'), flashEl = ov.querySelector('.cam-flash');
    var ac = doc.createElement('canvas'), ag = ac.getContext('2d', { willReadFrequently: true }), tick = null, tm = null, thUrl = '';
    ov.querySelector('.cam-shot').focus();

    var ready = function () { return !st.closed && v.readyState >= 2 && v.videoWidth > 0; };
    var setText = function (el, s) { if (el.textContent !== s) el.textContent = s; };
    var say = function (key, vars, ms) { st.msg = t(key, vars); st.msgUntil = Date.now() + (ms || 3500); show(); };
    var frameRect = function () {
      var e = v.getBoundingClientRect(), f = fr.getBoundingClientRect();
      return mapRect(v.videoWidth, v.videoHeight, e.width, e.height, { x: f.left - e.left, y: f.top - e.top, w: f.width, h: f.height });
    };
    // видима частина кадру (що людина бачить) у повній роздільності → JPEG; її ж читаємо і її ж зберігаємо
    var grab = function (q) {
      var e = v.getBoundingClientRect(), b = mapRect(v.videoWidth, v.videoHeight, e.width, e.height), k = Math.min(1, 2400 / Math.max(b.w, b.h));
      var c = doc.createElement('canvas'); c.width = Math.round(b.w * k); c.height = Math.round(b.h * k);
      c.getContext('2d').drawImage(v, b.x, b.y, b.w, b.h, 0, 0, c.width, c.height);
      return new Promise(function (ok, bad) {
        var fin = function (bl) { c.width = 0; c.height = 0; if (bl) ok(bl); else bad(new Error('blob')); };
        if (c.toBlob) c.toBlob(fin, 'image/jpeg', q);
        else { try { var u = c.toDataURL('image/jpeg', q), bin = atob(u.split(',')[1]), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); fin(new Blob([a], { type: 'image/jpeg' })); } catch (x) { fin(null); } }
      });
    };

    function show() {
      if (st.closed) return;
      var now = Date.now(), s;
      if (st.msg && now < st.msgUntil) s = st.msg;
      else if (st.code) s = t('cam_' + st.code);
      else if (st.eng === 0 && ready()) s = t('cam_load', { p: st.pct });
      else if (st.eng < 0) s = t('cam_noocr');
      else if (st.seen && st.seen.key && now - st.seenAt < 4000) s = st.keys[st.seen.key] ? t(kind === 'heat' ? 'cam_same_heat' : 'cam_same') : t('cam_hold');
      else s = ready() ? t('cam_aim_' + kind) : t('cam_start');
      setText(hintEl, s);
      var sn = '', fresh = st.seen && now - st.seenAt < 5000;
      if (fresh && st.seen.other) sn = t('cam_other', { x: t('cam_k_' + st.seen.other) });
      else if (fresh && st.seen.seen) { var w = t('cam_seen', { v: st.seen.seen }); sn = st.seen.meter ? st.seen.meter + ' · ' + w : w.charAt(0).toUpperCase() + w.slice(1); }
      setText(seenEl, sn);
      fr.classList.toggle('ok', !!(fresh && st.seen.key));
    }

    function look() {
      if (!ready()) { show(); return; }
      try {
        var r = frameRect(), aw = Math.max(16, Math.min(A_W, r.w)), ah = Math.max(16, Math.round(r.h * aw / r.w));
        if (ac.width !== aw || ac.height !== ah) { ac.width = aw; ac.height = ah; st.prev = null; }
        ag.drawImage(v, r.x, r.y, r.w, r.h, 0, 0, aw, ah);
        var s = stats(ag.getImageData(0, 0, aw, ah).data, aw, ah, st.prev); st.prev = s.gray; st.stat = s;
        var code = hint(s, { torch: st.torch, torchOn: st.torchOn, ocr: st.ocr ? { lines: st.ocr.lines, digitH: st.ocr.digitH, found: st.ocr.found, age: Date.now() - st.ocr.at } : null });
        // нова підказка — з другого такту поспіль (не блимати)
        if (code === st.code) st.pendN = 0;
        else if (code === st.pend) { if (++st.pendN >= 2) { st.code = code; st.pendN = 0; } }
        else { st.pend = code; st.pendN = 1; }
      } catch (e) { /* кадр ще не готовий */ }
      show();
    }

    function add(blob, p, auto) {
      if (st.shots.length >= max) { say('cam_max', { n: max }); return; }
      var n = st.shots.length + 1, name = 'camera-' + new Date().toISOString().replace(/\D/g, '').slice(0, 14) + '-' + n + '.jpg', f;
      try { f = new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() }); } catch (e) { f = blob; try { f.name = name; f.lastModified = Date.now(); } catch (e2) { /* без імені */ } }
      st.shots.push(f); if (auto) st.auto++;
      if (p && p.key) st.keys[p.key] = 1;
      if (thUrl) URL.revokeObjectURL(thUrl); thUrl = URL.createObjectURL(blob);
      thEl.style.backgroundImage = 'url("' + thUrl + '")'; thEl.innerHTML = '<b>' + st.shots.length + '</b>'; thEl.classList.add('on');
      doneEl.disabled = false; doneEl.textContent = t('cam_done_n', { n: st.shots.length }); doneEl.setAttribute('aria-label', t('cam_done') + '. ' + t('cam_n', { n: st.shots.length }));
      flashEl.classList.add('on'); setTimeout(function () { flashEl.classList.remove('on'); }, 60);
      try { if (navigator.vibrate) navigator.vibrate(30); } catch (e) { /* без вібро */ }
      say(st.shots.length >= max ? 'cam_max' : kind === 'heat' ? 'cam_got_heat' : kind === 'water' ? 'cam_got_water' : 'cam_got', { n: max }, 4000);
    }

    function read() {
      if (st.closed) return;
      var s = st.stat, wait = st.eng !== 1 || st.busy || !ready() || !s || s.lum < 25 || (s.move !== null && s.move > TH.move);
      if (wait) { tm = setTimeout(read, 400); return; }
      st.busy = true;
      var r0 = Date.now();
      grab(0.9).then(function (blob) {
        return o.read(blob).then(function (res) {
          if (st.closed) return;
          st.frames++; var dt = Date.now() - r0; st.rms += dt; if (dt > st.rmax) st.rmax = dt;
          var p = null; try { p = o.parse(res || {}); } catch (e) { p = null; }
          st.ocr = { at: Date.now(), lines: ((res && res.lines) || []).length, digitH: digitH(res), found: !!(p && (p.key || p.other)) };
          if (p && (p.key || p.other)) { st.seen = p; st.seenAt = Date.now(); }
          if (p && p.key && p.key === st.last && !st.keys[p.key]) add(blob, p, true);
          st.last = (p && p.key) || '';
          show();
        });
      }).catch(function () { /* кадр не прочитався — наступний */ }).then(function () {
        // повільний телефон: читаємо не більше половини часу — відео й кнопки лишаються живими (123-я)
        st.busy = false; if (!st.closed) tm = setTimeout(read, Math.min(4000, Math.max(500, Date.now() - r0)));
      });
    }

    function shoot() {
      if (!ready()) return;
      var p = st.seen && Date.now() - st.seenAt < 2500 && st.seen.key ? st.seen : null;
      grab(0.92).then(function (b) { if (!st.closed) add(b, p, false); }, function () { /* не вийшло — ще раз */ });
    }

    function stop() { if (st.stream) st.stream.getTracks().forEach(function (k) { try { k.stop(); } catch (e) { /* уже */ } }); st.stream = null; }
    function finish(deliver) {
      if (st.closed) return; st.closed = true;
      clearInterval(tick); clearTimeout(tm); stop();
      doc.removeEventListener('keydown', onKey, true); root.removeEventListener('popstate', onPop); doc.removeEventListener('visibilitychange', onVis);
      if (thUrl) URL.revokeObjectURL(thUrl);
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      html.style.overflow = ovf;
      if (o.track) o.track('cam', { k: kind, n: st.shots.length, auto: st.auto, fr: st.frames, s: Math.round((Date.now() - st.t0) / 1000), e: st.err || undefined,
        ms: st.frames ? Math.round(st.rms / st.frames) : undefined, mx: st.rmax || undefined, eng: st.eng === 1 ? undefined : st.eng < 0 ? 'err' : st.pct + '%', tf: st.torchFail || undefined });
      if (deliver && st.shots.length) o.done(st.shots.slice());
      else if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* зник */ }
    }
    function fail(e) {
      var nm = (e && e.name) || '', code = /NotAllowed|Security|Permission/.test(nm) ? 'denied' : /NotFound|Overconstrained|DevicesNotFound/.test(nm) ? 'none' : /NotReadable|TrackStart|Abort/.test(nm) ? 'busy' : 'other';
      st.err = code; clearInterval(tick); clearTimeout(tm); stop();
      var nv = root.navigator || {}, ios = /iP(hone|ad|od)/.test(nv.userAgent || '') || (/Mac/.test(nv.platform || '') && nv.maxTouchPoints > 1);
      var msg = o.tg && (code === 'denied' || code === 'other') ? t('cam_err_tg') : code === 'denied' && ios ? t('cam_err_denied_ios') : t(code === 'other' ? 'cam_err' : 'cam_err_' + code);
      ov.classList.add('err');
      ov.querySelector('.cam-bot').innerHTML = '<p class="cam-hint" role="alert">' + msg + '</p><div class="cam-acts">' +
        '<button type="button" class="cam-done" data-cam="pick">' + t('cam_pick') + '</button>' +
        '<button type="button" class="cam-b" data-cam="close">' + t('close') + '</button></div>';
      var pk = ov.querySelector('[data-cam="pick"]'); if (pk) pk.focus();
    }

    var onKey = function (e) {
      if (e.key === 'Escape') { e.preventDefault(); finish(true); return; }
      if (e.key === 'Tab') {   // фокус — лише всередині камери
        var bs = Array.prototype.filter.call(ov.querySelectorAll('button'), function (b) { return !b.hidden && !b.disabled; }); if (!bs.length) return;
        var i = bs.indexOf(doc.activeElement); if (e.shiftKey ? i <= 0 : i === bs.length - 1) { e.preventDefault(); bs[e.shiftKey ? bs.length - 1 : 0].focus(); }
      }
    };
    var onPop = function () { finish(true); };
    var onVis = function () { if (doc.visibilityState === 'hidden') finish(true); };
    doc.addEventListener('keydown', onKey, true); root.addEventListener('popstate', onPop); doc.addEventListener('visibilitychange', onVis);
    ov.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-cam]'); if (!b) return;
      var a = b.getAttribute('data-cam');
      if (a === 'close' || a === 'done') finish(true);
      else if (a === 'shot') shoot();
      else if (a === 'pick') { finish(false); if (o.pick) o.pick(); }
      else if (a === 'torch' && st.track) {
        var on = !st.torchOn;
        // Safari і камери ноутбуків кажуть «є ліхтарик», а ввімкнути не дають — тоді прибрати кнопку й сказати (журнал 12.11: 7 дотиків без толку)
        var no = function () { st.torch = false; st.torchOn = false; st.torchFail = 1; torchEl.hidden = true; say('cam_torch_no', {}, 4000); };
        st.track.applyConstraints({ advanced: [{ torch: on }] }).then(function () {
          var got = null; try { var cs = st.track.getSettings ? st.track.getSettings() : null; if (cs && 'torch' in cs) got = !!cs.torch; } catch (e) { /* без налаштувань */ }
          if (got !== null && got !== on) { no(); return; }
          st.torchOn = on; torchEl.setAttribute('aria-pressed', on ? 'true' : 'false'); look();
        }, no);
      }
    });

    if (!supported()) { setTimeout(function () { fail({ name: 'NotSupported' }); }, 0); return { close: finish }; }
    navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } }).then(function (s) {
      if (st.closed) { s.getTracks().forEach(function (k) { k.stop(); }); return; }
      st.stream = s; st.track = s.getVideoTracks()[0] || null;
      v.srcObject = s; var pl = v.play(); if (pl && pl.catch) pl.catch(function () { /* autoplay — muted, має грати */ });
      try {
        var cp = st.track && st.track.getCapabilities ? st.track.getCapabilities() : {};
        if (cp.torch) { st.torch = true; torchEl.hidden = false; }
        if (cp.focusMode && cp.focusMode.indexOf('continuous') >= 0) st.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () {});
      } catch (e) { /* без можливостей */ }
      tick = setInterval(look, 300); read();
      o.engine(function (q) { st.pct = Math.round(Math.max(0, Math.min(1, q)) * 100); }).then(function () { st.eng = 1; show(); }, function () { st.eng = -1; show(); });
    }, fail);
    return { close: finish };
  }

  var api = { mapRect: mapRect, stats: stats, hint: hint, digitH: digitH, supported: supported, open: open, TH: TH };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TeploCam = api;
})(typeof window !== 'undefined' ? window : this);
