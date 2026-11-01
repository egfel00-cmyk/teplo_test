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
  var DET_THRESH = 0.3, BOX_THRESH = 0.55, UNCLIP = 1.6, REC_H = 48;

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

  function toCanvas(file) {
    var p = typeof createImageBitmap === 'function'
      ? createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(file); })
      : new Promise(function (ok, bad) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = bad; i.src = URL.createObjectURL(file); });
    return p.then(function (img) {
      var k = Math.min(1, 2400 / Math.max(img.width, img.height));
      var c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c;
    });
  }

  /** Карта «здесь текст» → прямоугольники (с наклоном) в координатах исходного фото. */
  function detect(src) {
    var k = Math.min(1, DET_MAX / Math.max(src.width, src.height));
    var W = Math.max(32, Math.round(src.width * k / 32) * 32), H = Math.max(32, Math.round(src.height * k / 32) * 32);
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var g = c.getContext('2d'); g.drawImage(src, 0, 0, W, H);
    var px = g.getImageData(0, 0, W, H).data, N = W * H, t = new Float32Array(3 * N);
    var mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
    for (var i = 0; i < N; i++) for (var ch = 0; ch < 3; ch++) t[ch * N + i] = (px[i * 4 + ch] / 255 - mean[ch]) / std[ch];
    var feeds = {}; feeds[DET.inputNames[0]] = new ORT.Tensor('float32', t, [1, 3, H, W]);
    return DET.run(feeds).then(function (out) {
      var prob = out[DET.outputNames[0]].data, seen = new Uint8Array(N), boxes = [], sx = src.width / W, sy = src.height / H;
      var stack = new Int32Array(N);
      for (var s = 0; s < N; s++) {
        if (seen[s] || prob[s] <= DET_THRESH) continue;
        // связная область (4-соседи)
        var top = 0, cnt = 0, sum = 0, mx = 0, my = 0, pts = [];
        stack[top++] = s; seen[s] = 1;
        while (top) {
          var q = stack[--top], x = q % W, y = (q - x) / W;
          cnt++; sum += prob[q]; mx += x; my += y; pts.push(x, y);
          if (x > 0 && !seen[q - 1] && prob[q - 1] > DET_THRESH) { seen[q - 1] = 1; stack[top++] = q - 1; }
          if (x < W - 1 && !seen[q + 1] && prob[q + 1] > DET_THRESH) { seen[q + 1] = 1; stack[top++] = q + 1; }
          if (y > 0 && !seen[q - W] && prob[q - W] > DET_THRESH) { seen[q - W] = 1; stack[top++] = q - W; }
          if (y < H - 1 && !seen[q + W] && prob[q + W] > DET_THRESH) { seen[q + W] = 1; stack[top++] = q + W; }
        }
        if (cnt < 12 || sum / cnt < BOX_THRESH) continue;
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
    var px = g.getImageData(0, 0, w, REC_H).data, N = w * REC_H, t = new Float32Array(3 * N);
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

  function read(file) {
    var t0 = Date.now(), src;
    return toCanvas(file).then(function (c) { src = c; return detect(c); }).then(function (boxes) {
      boxes.sort(function (a, b) { return a.cy - b.cy || a.cx - b.cx; });
      var lines = [], chain = Promise.resolve();
      boxes.forEach(function (b) {
        if (b.h > b.w * 1.5) return;
        var line;
        chain = chain.then(function () { return recognize(src, b, 0); }).then(function (r) {
          line = { text: r.text, score: +r.score.toFixed(3), x: Math.round(b.cx - b.w / 2), y: Math.round(b.cy - b.h / 2), w: Math.round(b.w), h: Math.round(b.h), angle: +b.angle.toFixed(3) };
          // строки с цифрами (ЖК-экран) — ещё дважды с подавлением «теней» непогашенных сегментов: 1 не превращается в 8
          if (!/[0-9]|^E/.test(r.text)) return null;
          return recognize(src, b, 0.3).then(function (r1) { return recognize(src, b, 0.55).then(function (r2) { line.alts = [r1.text, r2.text]; }); });
        }).then(function () { if (line.text || (line.alts && line.alts[0])) lines.push(line); });
      });
      return chain.then(function () { return { lines: lines, w: src.width, h: src.height, ms: Date.now() - t0 }; });
    });
  }

  root.TeploOCR = { load: load, read: read, ready: function () { return !!REC; } };
})(typeof window !== 'undefined' ? window : this);
