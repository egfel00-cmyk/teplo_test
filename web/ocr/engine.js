/*
 * Теплосервис — распознавание текста на фото прямо в браузере, без сервера и без платных API.
 * Модели PaddleOCR PP-OCRv4 (Apache-2.0): det — где на фото текст, rec — что написано; движок onnxruntime-web (MIT, WASM).
 * Файлы лежат рядом (web/ocr/), грузятся один раз (~30 МБ, потом из кэша браузера).
 * API: TeploOCR.load(base, onProgress(0..1)) → Promise; TeploOCR.read(fileOrBlob) → Promise<{lines, w, h, ms}>
 *   lines: [{ text, score, x, y, w, h, angle }] — координаты в пикселях исходного фото (после поворота по EXIF).
 */
(function (root) {
  'use strict';
  var ORT = null, DET = null, REC = null, KEYS = null, loading = null;
  var DET_MAX = 1280;           // длинная сторона для поиска текста: мелкие подписи «Gcal», «m³» на экране остаются видны
  // второй проход: приближаем до ~2600 px, но ищем текст кусками ≤1408 px — иначе iPhone упирается в память WASM
  // и перезагружает вкладку (одна сетка 2600×2600 съедала ~1 ГБ)
  var ZOOM_PX = 2600, TILE = 1408; var DET_THRESH = 0.3, BOX_THRESH = 0.55, UNCLIP = 1.6, REC_H = 48;

  function fetchBuf(url, onBytes) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('ocr_asset ' + r.status + ' ' + url);
      if (!r.body || !r.body.getReader) return r.arrayBuffer().then(function (b) { onBytes(b.byteLength); return b; });
      var reader = r.body.getReader(), chunks = [], n = 0;
      function pump() {
        return reader.read().then(function (x) {
          if (x.done) { var out = new Uint8Array(n), o = 0; chunks.forEach(function (c) { out.set(c, o); o += c.length; }); return out.buffer; }
          chunks.push(x.value); n += x.value.length; onBytes(x.value.length); return pump();
        });
      }
      return pump();
    });
  }

  function load(base, onProgress) {
    if (loading) return loading;
    base = base.replace(/\/?$/, '/');
    var total = 4.75e6 + 10.83e6 + 14.85e6, got = 0;
    var tick = function (n) { got += n; if (onProgress) onProgress(Math.min(1, got / total)); };
    loading = import(base + 'ort.wasm.min.mjs').then(function (ort) {
      ORT = ort.default && ort.default.InferenceSession ? ort.default : ort;
      ORT.env.wasm.wasmPaths = base; ORT.env.wasm.numThreads = 1; ORT.env.wasm.proxy = false;
      // wasm считаем в прогрессе отдельным запросом (браузер потом возьмёт его из кэша)
      return Promise.all([fetchBuf(base + 'ch_PP-OCRv4_det_infer.onnx', tick), fetchBuf(base + 'ch_PP-OCRv4_rec_infer.onnx', tick),
        fetch(base + 'ppocr_keys_v1.txt').then(function (r) { return r.text(); }), fetchBuf(base + 'ort-wasm-simd-threaded.wasm', tick)]);
    }).then(function (x) {
      KEYS = x[2].replace(/\r/g, '').split('\n'); if (KEYS[KEYS.length - 1] === '') KEYS.pop(); KEYS.push(' ');
      var opt = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
      return Promise.all([ORT.InferenceSession.create(x[0], opt), ORT.InferenceSession.create(x[1], opt)]);
    }).then(function (s) { DET = s[0]; REC = s[1]; if (onProgress) onProgress(1); return true; },
      function (e) { loading = null; throw e; });
    return loading;
  }

  /** Отдать память холста сразу (iOS считает общий лимит памяти холстов и не ждёт сборщика мусора). */
  function free(c) { if (c) { c.width = 0; c.height = 0; } }

  function toCanvas(file) {
    var p = typeof createImageBitmap === 'function'
      ? createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(file); })
      : new Promise(function (ok, bad) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = bad; i.src = URL.createObjectURL(file); });
    return p.then(function (img) {
      var k = Math.min(1, 2400 / Math.max(img.width, img.height));
      var c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); if (img.close) img.close(); else if (img.src) URL.revokeObjectURL(img.src); return c;
    });
  }

  /** Карта «здесь текст» → прямоугольники (с наклоном) в координатах исходного фото. */
  function detect(src, o) {
    o = o || {}; var dmax = o.max || DET_MAX, DT = o.thresh || DET_THRESH, BT = o.box || BOX_THRESH;
    var k = Math.min(1, dmax / Math.max(src.width, src.height));
    var W = Math.max(32, Math.round(src.width * k / 32) * 32), H = Math.max(32, Math.round(src.height * k / 32) * 32);
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d'); g.drawImage(src, 0, 0, W, H);
    var px = g.getImageData(0, 0, W, H).data, N = W * H, t = new Float32Array(3 * N); free(c);
    var mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
    if (o.stretch) {   // растянуть контраст (серый ЖК без подсветки): 2-й и 98-й перцентиль яркости → 0…255
      var hist = new Uint32Array(256); for (var q0 = 0; q0 < N; q0++) hist[(px[q0 * 4] * 0.299 + px[q0 * 4 + 1] * 0.587 + px[q0 * 4 + 2] * 0.114) | 0]++;
      var pc = function (f) { var need = N * f, acc = 0; for (var v = 0; v < 256; v++) { acc += hist[v]; if (acc >= need) return v; } return 255; }, lo = pc(0.02), hi = pc(0.98), sc = 255 / Math.max(16, hi - lo);
      for (q0 = 0; q0 < N * 4; q0++) if ((q0 & 3) !== 3) px[q0] = Math.max(0, Math.min(255, (px[q0] - lo) * sc));
    }
    if (o.local) {   // локальный контраст: (яркость − среднее в окне) / разброс в окне — серый ЖК без подсветки «проявляется»
      var Lm = new Float64Array(N), I1 = new Float64Array((W + 1) * (H + 1)), I2 = new Float64Array((W + 1) * (H + 1)), R0 = o.local;
      for (var y0 = 0; y0 < H; y0++) { var r1 = 0, r2 = 0; for (var x0 = 0; x0 < W; x0++) { var q1 = y0 * W + x0, l = px[q1 * 4] * 0.299 + px[q1 * 4 + 1] * 0.587 + px[q1 * 4 + 2] * 0.114; Lm[q1] = l; r1 += l; r2 += l * l; I1[(y0 + 1) * (W + 1) + x0 + 1] = I1[y0 * (W + 1) + x0 + 1] + r1; I2[(y0 + 1) * (W + 1) + x0 + 1] = I2[y0 * (W + 1) + x0 + 1] + r2; } }
      for (y0 = 0; y0 < H; y0++) for (x0 = 0; x0 < W; x0++) {
        var ya = Math.max(0, y0 - R0), yb = Math.min(H, y0 + R0 + 1), xa = Math.max(0, x0 - R0), xb = Math.min(W, x0 + R0 + 1), n0 = (yb - ya) * (xb - xa);
        var s1 = I1[yb * (W + 1) + xb] - I1[ya * (W + 1) + xb] - I1[yb * (W + 1) + xa] + I1[ya * (W + 1) + xa], s2 = I2[yb * (W + 1) + xb] - I2[ya * (W + 1) + xb] - I2[yb * (W + 1) + xa] + I2[ya * (W + 1) + xa];
        var mu = s1 / n0, sd = Math.sqrt(Math.max(1, s2 / n0 - mu * mu)), v0 = Math.max(0, Math.min(255, 128 + (Lm[y0 * W + x0] - mu) / Math.max(sd, 6) * 48)), q2 = (y0 * W + x0) * 4;
        px[q2] = px[q2 + 1] = px[q2 + 2] = v0;
      }
    }
    for (var i = 0; i < N; i++) for (var ch = 0; ch < 3; ch++) t[ch * N + i] = (px[i * 4 + ch] / 255 - mean[ch]) / std[ch];
    var feeds = {}; feeds[DET.inputNames[0]] = new ORT.Tensor('float32', t, [1, 3, H, W]);
    return DET.run(feeds).then(function (out) {
      var prob = out[DET.outputNames[0]].data, seen = new Uint8Array(N), boxes = [], sx = src.width / W, sy = src.height / H;
      var stack = new Int32Array(N);
      for (var s = 0; s < N; s++) {
        if (seen[s] || prob[s] <= DT) continue;
        // связная область (4-соседи)
        var top = 0, cnt = 0, sum = 0, mx = 0, my = 0, pts = [];
        stack[top++] = s; seen[s] = 1;
        while (top) {
          var q = stack[--top], x = q % W, y = (q - x) / W;
          cnt++; sum += prob[q]; mx += x; my += y; pts.push(x, y);
          if (x > 0 && !seen[q - 1] && prob[q - 1] > DT) { seen[q - 1] = 1; stack[top++] = q - 1; }
          if (x < W - 1 && !seen[q + 1] && prob[q + 1] > DT) { seen[q + 1] = 1; stack[top++] = q + 1; }
          if (y > 0 && !seen[q - W] && prob[q - W] > DT) { seen[q - W] = 1; stack[top++] = q - W; }
          if (y < H - 1 && !seen[q + W] && prob[q + W] > DT) { seen[q + W] = 1; stack[top++] = q + W; }
        }
        if (cnt < 12 || sum / cnt < BT) continue;
        // наклон области — по главной оси (PCA), прямоугольник вдоль неё
        mx /= cnt; my /= cnt; var cxx = 0, cyy = 0, cxy = 0;
        for (var j = 0; j < pts.length; j += 2) { var dx = pts[j] - mx, dy = pts[j + 1] - my; cxx += dx * dx; cyy += dy * dy; cxy += dx * dy; }
        var a = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
        if (Math.abs(a) > Math.PI / 4) a = 0;          // вертикальные строки не читаем — пусть будет прямо
        var ca = Math.cos(a), sa = Math.sin(a), u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
        for (j = 0; j < pts.length; j += 2) {
          var du = (pts[j] - mx) * ca + (pts[j + 1] - my) * sa, dv = -(pts[j] - mx) * sa + (pts[j + 1] - my) * ca;
          if (du < u0) u0 = du; if (du > u1) u1 = du; if (dv < v0) v0 = dv; if (dv > v1) v1 = dv;
        }
        var bw = u1 - u0 + 1, bh = v1 - v0 + 1;
        if (Math.min(bw, bh) < 3) continue;
        var d = bw * bh * UNCLIP / (2 * (bw + bh));     // «разжать» рамку, как в PaddleOCR (unclip)
        var cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
        var cx = mx + cu * ca - cv * sa, cy = my + cu * sa + cv * ca;
        boxes.push({ cx: cx * sx, cy: cy * sy, w: (bw + 2 * d) * sx, h: (bh + 2 * d) * sy, angle: a, score: sum / cnt });
      }
      return boxes;
    });
  }

  /** Прочитать строку в рамке. */
  function recognize(src, b, enhance) {
    var w = Math.max(8, Math.round(REC_H * b.w / b.h)); if (w > 1600) w = 1600;
    var c = document.createElement('canvas'); c.width = w; c.height = REC_H;
    var g = c.getContext('2d');
    g.fillStyle = '#808080'; g.fillRect(0, 0, w, REC_H);
    g.translate(w / 2, REC_H / 2); g.scale(w / b.w, REC_H / b.h); g.rotate(-b.angle); g.translate(-b.cx, -b.cy);
    g.drawImage(src, 0, 0);
    var px = g.getImageData(0, 0, w, REC_H).data, N = w * REC_H, t = new Float32Array(3 * N); free(c);
    if (enhance) {
      // ЖК-экран: «тени» непогашенных сегментов чуть темнее фона — уводим их в белый, оставляя только настоящие цифры
      var L = new Float32Array(N), hist = new Uint32Array(256);
      for (var i0 = 0; i0 < N; i0++) { var l = 0.299 * px[i0 * 4] + 0.587 * px[i0 * 4 + 1] + 0.114 * px[i0 * 4 + 2]; L[i0] = l; hist[l | 0]++; }
      var pct = function (q) { var need = N * q, acc = 0; for (var v = 0; v < 256; v++) { acc += hist[v]; if (acc >= need) return v; } return 255; };
      var ink = pct(0.04), bg = pct(0.7), cut = bg - (bg - ink) * enhance;
      for (i0 = 0; i0 < N; i0++) { var y = (L[i0] - ink) / Math.max(8, cut - ink); y = y < 0 ? 0 : y > 1 ? 1 : y; var nv = (y - 0.5) / 0.5; t[i0] = nv; t[N + i0] = nv; t[2 * N + i0] = nv; }
    } else
    for (var i = 0; i < N; i++) for (var ch = 0; ch < 3; ch++) t[ch * N + i] = (px[i * 4 + ch] / 255 - 0.5) / 0.5;
    var feeds = {}; feeds[REC.inputNames[0]] = new ORT.Tensor('float32', t, [1, 3, REC_H, w]);
    return REC.run(feeds).then(function (out) {
      var o = out[REC.outputNames[0]], T = o.dims[1], C = o.dims[2], d = o.data, text = '', ps = [], prev = -1;
      for (var s = 0; s < T; s++) {
        var best = 0, bp = -1e9; for (var k = 0; k < C; k++) { var v = d[s * C + k]; if (v > bp) { bp = v; best = k; } }
        if (best !== 0 && best !== prev) { text += KEYS[best - 1] || ''; ps.push(bp); }
        prev = best;
      }
      return { text: text.trim(), score: ps.length ? ps.reduce(function (a, b) { return a + b; }, 0) / ps.length : 0 };
    });
  }

  /** Прочитать рамки на холсте; координаты пересчитать в исходное фото (map: x → ox + x / sc). */
  function readBoxes(cv, boxes, ox, oy, sc, lines) {
    boxes.sort(function (a, b) { return a.cy - b.cy || a.cx - b.cx; });
    var chain = Promise.resolve();
    boxes.forEach(function (b) {
      if (b.h > b.w * 1.5) return;
      var line;
      chain = chain.then(function () { return recognize(cv, b, 0); }).then(function (r) {
        line = { text: r.text, score: +r.score.toFixed(3), x: Math.round(ox + (b.cx - b.w / 2) / sc), y: Math.round(oy + (b.cy - b.h / 2) / sc), w: Math.round(b.w / sc), h: Math.round(b.h / sc), angle: +b.angle.toFixed(3) };
        // строки с цифрами (ЖК-экран) — ещё дважды с подавлением «теней» непогашенных сегментов: 1 не превращается в 8
        if (!/[0-9]|^E/.test(r.text)) return null;
        return recognize(cv, b, 0.3).then(function (r1) { return recognize(cv, b, 0.55).then(function (r2) { line.alts = [r1.text, r2.text]; }); });
      }).then(function () { if (line.text || (line.alts && line.alts[0])) lines.push(line); });
    });
    return chain;
  }
  /** Поиск текста по кускам с перекрытием: память — как у одного куска, детали — как у всего большого холста. */
  function detectTiled(cv) {
    var W = cv.width, H = cv.height;
    // куски равномерно, перекрытие ≥ четверти куска
    var at = function (L) { if (L <= TILE) return [0]; var n = Math.ceil((L - TILE) / (TILE * 0.75)) + 1, r = []; for (var i = 0; i < n; i++) r.push(Math.round(i * (L - TILE) / (n - 1))); return r; };
    var xs = at(W), ys = at(H);
    var all = [], chain = Promise.resolve();
    ys.forEach(function (ty) { xs.forEach(function (tx) {
      chain = chain.then(function () {
        var tw = Math.min(TILE, W - tx), th = Math.min(TILE, H - ty), t = document.createElement('canvas'); t.width = tw; t.height = th;
        t.getContext('2d').drawImage(cv, tx, ty, tw, th, 0, 0, tw, th);
        return detect(t, { max: TILE }).then(function (bs) {
          free(t);
          bs.forEach(function (b) {
            // рамка у края куска (кроме края холста) — обрезана; её целиком найдёт соседний кусок
            var l = b.cx - b.w / 2, r = b.cx + b.w / 2, u = b.cy - b.h / 2, d = b.cy + b.h / 2, m = 6;
            if ((l < m && tx > 0) || (r > tw - m && tx + tw < W) || (u < m && ty > 0) || (d > th - m && ty + th < H)) return;
            b.cx += tx; b.cy += ty; all.push(b);
          });
        });
      });
    }); });
    return chain.then(function () {
      var out = [];
      all.sort(function (a, b) { return b.w * b.h - a.w * a.h; }).forEach(function (b) {
        var dup = out.some(function (o) { var ix = Math.max(0, Math.min(o.cx + o.w / 2, b.cx + b.w / 2) - Math.max(o.cx - o.w / 2, b.cx - b.w / 2)), iy = Math.max(0, Math.min(o.cy + o.h / 2, b.cy + b.h / 2) - Math.max(o.cy - o.h / 2, b.cy - b.h / 2)); return ix * iy > 0.5 * b.w * b.h; });
        if (!dup) out.push(b);
      });
      return out;
    });
  }
  function digits(t) { return String(t || '').replace(/[^0-9]/g, '').length; }

  function read(file) {
    var t0 = Date.now(), src, lines = [];
    return toCanvas(file).then(function (c) { src = c; return detect(c); }).then(function (boxes) {
      return readBoxes(src, boxes, 0, 0, 1, lines).then(function () {
        // Нет крупной строки цифр? Цифры экрана мелкие в кадре (снято издалека, серый ЖК без подсветки) —
        // приближаем область, где нашёлся текст счётчика, примерно до 1800 px и ищем ещё раз.
        var big = lines.some(function (l) { return digits(l.text) >= 4 && l.h >= src.height * 0.03 && !/[A-Za-zА-Яа-я]{3}/.test(l.text); });
        if (big || !boxes.length) return null;
        var good = boxes.filter(function (b) { return b.score > 0.7; }); if (!good.length) good = boxes;
        var x0 = Math.min.apply(null, good.map(function (b) { return b.cx - b.w / 2; })), x1 = Math.max.apply(null, good.map(function (b) { return b.cx + b.w / 2; }));
        var y0 = Math.min.apply(null, good.map(function (b) { return b.cy - b.h / 2; })), y1 = Math.max.apply(null, good.map(function (b) { return b.cy + b.h / 2; }));
        var pw = (x1 - x0) * 0.15 + 20, ph = (y1 - y0) * 0.15 + 20;
        x0 = Math.max(0, x0 - pw); y0 = Math.max(0, y0 - ph); x1 = Math.min(src.width, x1 + pw); y1 = Math.min(src.height, y1 + ph);
        var cw = x1 - x0, chh = y1 - y0, sc = Math.min(3, ZOOM_PX / Math.max(cw, chh));
        if (sc < 1.25) return null;   // приближать некуда — текст уже на весь кадр
        var cv = document.createElement('canvas'); cv.width = Math.round(cw * sc); cv.height = Math.round(chh * sc);
        var g2 = cv.getContext('2d'); g2.imageSmoothingQuality = 'high'; g2.drawImage(src, x0, y0, cw, chh, 0, 0, cv.width, cv.height);
        return detectTiled(cv).then(function (b2) {
          var seenBox = lines.map(function (l) { return { x: l.x, y: l.y, w: l.w, h: l.h }; });
          var fresh = b2.filter(function (b) {   // только то, чего не было в первом проходе
            var bx = x0 + (b.cx - b.w / 2) / sc, by = y0 + (b.cy - b.h / 2) / sc, bw = b.w / sc, bh = b.h / sc;
            return !seenBox.some(function (o) { var ix = Math.max(0, Math.min(o.x + o.w, bx + bw) - Math.max(o.x, bx)), iy = Math.max(0, Math.min(o.y + o.h, by + bh) - Math.max(o.y, by)); return ix * iy > 0.5 * Math.min(o.w * o.h, bw * bh); });
          });
          return readBoxes(cv, fresh, x0, y0, sc, lines).then(function () { free(cv); });
        });
      });
    }).then(function () { var w = src.width, h = src.height; free(src); return { lines: lines, w: w, h: h, ms: Date.now() - t0 }; });
  }

  function _det(file, o) { var src; return toCanvas(file).then(function (c) { src = c; return detect(c, o); }).then(function (b) {
    var ch = Promise.resolve(), out = []; b.forEach(function (x) { if (x.h > x.w * 1.5) return; ch = ch.then(function () { return recognize(src, x, 0.3); }).then(function (r) { out.push(r.text + '@' + Math.round(x.cy) + ':' + x.score.toFixed(2)); }); });
    return ch.then(function () { return out.join(' | '); }); }); }
  function _rec(file, b) { return toCanvas(file).then(function (c) { return Promise.all([recognize(c, b, 0), recognize(c, b, 0.3), recognize(c, b, 0.55)]); }).then(function (r) { return r.map(function (x) { return x.text + '(' + x.score.toFixed(2) + ')'; }).join(' | '); }); }
  root.TeploOCR = { _det: _det, _rec: _rec, load: load, read: read, ready: function () { return !!REC; } };
})(typeof window !== 'undefined' ? window : this);
