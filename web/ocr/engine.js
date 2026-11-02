/*
 * Теплосервис — распознавание текста на фото прямо в браузере, без сервера и без платных API.
 * Модели PaddleOCR PP-OCRv4 (Apache-2.0): det — где на фото текст, rec — что написано; движок onnxruntime-web (MIT, WASM).
 * Файлы лежат рядом (web/ocr/), грузятся один раз (~30 МБ, потом из кэша браузера).
 * API: TeploOCR.load(base, onProgress(0..1)) → Promise; TeploOCR.read(fileOrBlob, {all}) → Promise<{lines, drums, w, h, ms}>
 *   all: true — читать все найденные окна барабанов (на фото может быть несколько водомеров), иначе — до первого уверенного.
 *   lines: [{ text, score, x, y, w, h, angle, lcd? }] — координаты в пикселях исходного фото (после поворота по EXIF);
 *          lcd: 1 — найдено проходом по ЖК (приближение экрана: прочерки «E-------», значки «m³», «m³/h», «kW»).
 *   drums: [{ text, red, score, votes, alts, x, y, w, h, angle, flipped, tint }] — окно барабана водомера, найденное по цвету:
 *          text — цифры чёрных роликов (м³), red — красных (дроби), tint — цвет кольца ('red' горячая / 'blue' холодная),
 *          lead — сколько ведущих роликов не видно (блик стекла; text без них — обычно это нули),
 *          half — ролики между двумя цифрами (полуповорот): [{ i, d, sc, margin, rank }] — i — место в text, d — меньшая цифра
 *          пары (d, d+1) или null (не узнали — тогда этой цифры нет в text), rank — цифры по убыванию сходства;
 *          shifted — ролики, чуть сдвинутые с места (цифра видна ≥ 75 %, сверху/снизу хвост соседней): [{ i, d }] — d прочитана
 *          отдельно и стоит в text как обычная цифра.
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
  function readBoxes(cv, boxes, ox, oy, sc, lines, allAlts) {
    boxes.sort(function (a, b) { return a.cy - b.cy || a.cx - b.cx; });
    var chain = Promise.resolve();
    boxes.forEach(function (b) {
      if (b.h > b.w * 1.5) return;
      var line;
      chain = chain.then(function () { return recognize(cv, b, 0); }).then(function (r) {
        line = { text: r.text, score: +r.score.toFixed(3), x: Math.round(ox + (b.cx - b.w / 2) / sc), y: Math.round(oy + (b.cy - b.h / 2) / sc), w: Math.round(b.w / sc), h: Math.round(b.h / sc), angle: +b.angle.toFixed(3) };
        // строки с цифрами (ЖК-экран) — ещё дважды с подавлением «теней» непогашенных сегментов: 1 не превращается в 8
        if (!allAlts && !/[0-9]|^E/.test(r.text)) return null;   // allAlts — мелкие подписи ЖК («m³» → «ni», «m)»): все варианты
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

  // подписи у числа на ЖК: единицы (m³ читается «m)», «mi»; m³/h стоят столбиком «m» над «h») и метки экранов (ht, ct, On, dt, EH)
  var UNIT_RE = /^(m\s?[3³)'’iIl|]?(\s?\/\s?h)?|[hn]|k\s?W(\s?h)?|G\s?[ck]a[l1]|MW\s?h|GJ|°\s?C|℃|HT|CT|T\s?[12]|[hbn][tEe]|6e|c[tE]|d[tTeE]|BE|[0OD][nN]|E\s?h)$/i;
  var IN_LINE = /^\s*[A-Za-z]{1,3}\s+[0-9]|[0-9][\s.]*(m|k\s?W|G\s?[ck]a|MW|GJ|°|℃)/;   // «0n 41704», «ht 13.50», «1.067 m3/h»
  /**
   * Проход по ЖК-экрану. Главное число экрана (или «E» экрана кода ошибки) нашлось, а подписи рядом нет: прочерки «E-------»,
   * значки «m³», «m³/h» в полном кадре мельче, чем видит детектор. Приближаем сам экран (цифра ≈ 130 px) и ищем текст ещё
   * раз — как есть и с локальным контрастом. Новое — добавляем; рамку, что шире строки «E» в 1,5 раза и больше, — вместо неё.
   */
  function lcdPass(src, lines) {
    var H = src.height, W = src.width, isE = function (t) { return /^[EeЕеＥ][^0-9A-Za-zА-Яа-я]{0,2}$/.test(t); };
    var cand = lines.filter(function (l) {
      var t = String(l.text).trim(), d = digits(t);
      return l.h >= H * 0.012 && Math.abs(l.angle) < 0.2 && (isE(t) || (d >= 3 && d >= t.replace(/\s/g, '').length * 0.6));
    });
    if (!cand.length) return Promise.resolve();
    var main = cand.sort(function (a, b) { return b.h - a.h; })[0], t = String(main.text).trim(), e = isE(t), h = main.h;
    if (!e) {
      if (IN_LINE.test(t) || /^8{6,}$/.test(t.replace(/[^0-9]/g, ''))) return Promise.resolve();   // подпись в строке; тест экрана
      var labeled = lines.some(function (l) {
        return l !== main && UNIT_RE.test(String(l.text).trim()) && l.x + l.w > main.x - 2 * h && l.x < main.x + main.w + 3 * h && l.y + l.h > main.y - h && l.y < main.y + 2 * h;
      });
      if (labeled) return Promise.resolve();
    }
    var x0 = Math.max(0, main.x - 0.6 * h), x1 = Math.min(W, main.x + main.w + (e ? 7 : 2.2) * h), y0 = Math.max(0, main.y - 0.9 * h), y1 = Math.min(H, main.y + 1.9 * h);
    var cw = x1 - x0, chh = y1 - y0, sc = Math.min(4, Math.max(1.5, 200 / h), 1700 / Math.max(cw, chh));
    var cv = document.createElement('canvas'); cv.width = Math.round(cw * sc); cv.height = Math.round(chh * sc);
    var g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, x0, y0, cw, chh, 0, 0, cv.width, cv.height);
    var mx = Math.max(cv.width, cv.height), boxes = [];
    var area = function (b) { return { x: x0 + (b.cx - b.w / 2) / sc, y: y0 + (b.cy - b.h / 2) / sc, w: b.w / sc, h: b.h / sc }; };
    var over = function (o, b) { var ix = Math.max(0, Math.min(o.x + o.w, b.x + b.w) - Math.max(o.x, b.x)), iy = Math.max(0, Math.min(o.y + o.h, b.y + b.h) - Math.max(o.y, b.y)); return ix * iy > 0.5 * Math.min(o.w * o.h, b.w * b.h); };
    var add = function (bs) { bs.forEach(function (b) { var a = area(b); if (!boxes.some(function (o) { return over(area(o), a); })) boxes.push(b); }); };
    var LOG = root.TEPLO_LCD_LOG;
    return detect(cv, { max: mx }).then(add).then(function () { return detect(cv, { max: mx, local: Math.max(6, Math.round(0.09 * h * sc)) }); }).then(add).then(function () {
      var fresh = [], replace = null;
      if (e) {   // экран кода: «E» и прочерки детектор режет на куски — склеиваем ряд в одну рамку и читаем целиком
        var m0 = { x: (main.x - x0) * sc, y: (main.y - y0) * sc, w: main.w * sc, h: main.h * sc }, cy0 = m0.y + m0.h / 2;
        var row = boxes.filter(function (b) { return Math.abs(b.cy - cy0) < m0.h * 0.6 && b.cx + b.w / 2 > m0.x - m0.h && b.h < m0.h * 1.6; });
        if (row.length) {
          var l0 = Math.min(m0.x, Math.min.apply(null, row.map(function (b) { return b.cx - b.w / 2; }))), r0 = Math.max(m0.x + m0.w, Math.max.apply(null, row.map(function (b) { return b.cx + b.w / 2; })));
          var hh = Math.max(m0.h, Math.max.apply(null, row.map(function (b) { return b.h; })));
          boxes = boxes.filter(function (b) { return row.indexOf(b) < 0; });
          boxes.push({ cx: (l0 + r0) / 2 + hh * 0.1, cy: cy0, w: r0 - l0 + hh * 0.2, h: hh, angle: 0, score: 1 });
        }
      }
      if (LOG) console.log('LCD main=' + t + ' e=' + e + ' sc=' + sc.toFixed(2) + ' cv=' + cv.width + 'x' + cv.height + ' boxes=' + JSON.stringify(boxes.map(function (b) { var a = area(b); return [Math.round(a.x), Math.round(a.y), Math.round(a.w), Math.round(a.h)]; })));
      boxes.forEach(function (b) {
        var a = area(b), hit = lines.filter(function (l) { return over(l, a); });
        if (!hit.length) fresh.push(b);
        else if (e && hit.length === 1 && hit[0] === main && a.w >= main.w * 1.5) { fresh.push(b); replace = b; }
      });
      if (!fresh.length) return null;
      var got = [];
      return readBoxes(cv, fresh, x0, y0, sc, got, true).then(function () {
        got.forEach(function (l) { l.lcd = 1; });
        if (replace && got.some(function (l) { return l.w >= main.w * 1.5 && /^[EeЕеＥ]/.test(l.text); })) lines.splice(lines.indexOf(main), 1);
        Array.prototype.push.apply(lines, got);
      });
    }).then(function () { free(cv); }, function (er) { free(cv); throw er; });
  }
  /** Окно прочитано уверенно: 4+ цифр, совпали в двух обработках, ведущий ноль или высокая уверенность;
   *  или 3 цифры, а ведущие ролики закрыл блик (lead). */
  function goodDrum(x) { return x.votes >= 2 && (x.text.length >= 4 ? (/^0/.test(x.text) || x.score > 0.92) : !!x.lead && x.score > 0.9); }

  /* ───── Барабан водомера ─────
   * Окно счётного механизма: тёмные ролики с белыми цифрами (м³) и рядом красные (дроби — литры).
   * Ищем по цвету, а не по тексту: тёмные «ячейки» одной высоты в ряд (или слитая полоса) + красное у одного из концов.
   * Красное всегда справа — так узнаём и границу «м³ | дроби», и что фото перевёрнуто. */
  function findDrums(src) {
    var A = 1280, k = Math.min(1, A / Math.max(src.width, src.height)), W = Math.max(8, Math.round(src.width * k)), H = Math.max(8, Math.round(src.height * k));
    var c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(src, 0, 0, W, H);
    var px = c.getContext('2d').getImageData(0, 0, W, H).data; free(c);
    var N = W * H, L = new Float32Array(N), red = new Uint8Array(N), I = new Float64Array((W + 1) * (H + 1));
    for (var y = 0; y < H; y++) { var row = 0; for (var x = 0; x < W; x++) {
      var q = y * W + x, r = px[q * 4], g = px[q * 4 + 1], b = px[q * 4 + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      L[q] = 0.299 * r + 0.587 * g + 0.114 * b; row += L[q]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row;
      // красный: оттенок у красного, насыщенный (тёплый свет и тень — допускаем бурый)
      if (r === mx && r > 55 && (mx - mn) > 0.33 * mx && r - g > 28 && (g - b) < 0.6 * (r - b) + 8) red[q] = 1;
    } }
    var R0 = Math.max(10, Math.round(0.035 * Math.max(W, H))), MEAN = new Float32Array(N);
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      var ya = Math.max(0, y - R0), yb = Math.min(H, y + R0 + 1), xa = Math.max(0, x - R0), xb = Math.min(W, x + R0 + 1);
      MEAN[y * W + x] = (I[yb * (W + 1) + xb] - I[ya * (W + 1) + xb] - I[yb * (W + 1) + xa] + I[ya * (W + 1) + xa]) / ((yb - ya) * (xb - xa));
    }
    var cands = [];
    // Белые цифры часто во всю высоту окна — тёмный фон рвётся на кусочки между ними. «Стираем» тонкие светлые штрихи
    // минимумом по соседям (радиус 0, 2, 4 px) — окно становится сплошной тёмной полосой; берём лучшее со всех масштабов.
    [0, 2, 4].forEach(function (rad) {
      var Lm = rad ? minFilter(L, rad) : L, dark = new Uint8Array(N);
      for (var q0 = 0; q0 < N; q0++) if (!red[q0] && Lm[q0] < 110 && Lm[q0] < 0.62 * MEAN[q0]) dark[q0] = 1;
      scan(dark, rad).forEach(function (c0) {
        if (!cands.some(function (o) { return Math.hypot(o.cx - c0.cx, o.cy - c0.cy) < Math.max(o.h, c0.h) && o.score >= c0.score; })) {
          cands = cands.filter(function (o) { return !(Math.hypot(o.cx - c0.cx, o.cy - c0.cy) < Math.max(o.h, c0.h)); }); cands.push(c0);
        }
      });
    });
    function minFilter(src0, r0) {
      var t1 = new Float32Array(N), t2 = new Float32Array(N), xx, yy, m0, j0;
      for (yy = 0; yy < H; yy++) for (xx = 0; xx < W; xx++) { m0 = 255; for (j0 = Math.max(0, xx - r0); j0 <= Math.min(W - 1, xx + r0); j0++) if (src0[yy * W + j0] < m0) m0 = src0[yy * W + j0]; t1[yy * W + xx] = m0; }
      for (yy = 0; yy < H; yy++) for (xx = 0; xx < W; xx++) { m0 = 255; for (j0 = Math.max(0, yy - r0); j0 <= Math.min(H - 1, yy + r0); j0++) if (t1[j0 * W + xx] < m0) m0 = t1[j0 * W + xx]; t2[yy * W + xx] = m0; }
      return t2;
    }
    function scan(dark, rad) {
    // связные тёмные области → прямоугольники вдоль главной оси
    var seen = new Uint8Array(N), stack = new Int32Array(N), blocks = [];
    for (var s = 0; s < N; s++) {
      if (!dark[s] || seen[s]) continue;
      var top = 0, pts = [], border = false, q, x, y; stack[top++] = s; seen[s] = 1;
      while (top) {
        q = stack[--top]; x = q % W; y = (q - x) / W; pts.push(x, y);
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) border = true;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          var xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          var qq = yy * W + xx; if (dark[qq] && !seen[qq]) { seen[qq] = 1; stack[top++] = qq; }
        }
      }
      var n = pts.length / 2; if (n < 25 || border || n > N * 0.08) continue;
      var o = orient(pts); o.U -= 2 * rad; o.V -= 2 * rad; if (o.V < 5) continue;   // минимум раздул область на rad с каждой стороны
      o.n = n; o.fill = n / ((o.U + 2 * rad) * (o.V + 2 * rad));
      var ar = o.U / o.V;
      if (ar >= 1.9 && ar <= 12 && o.fill > 0.38) blocks.push({ cx: o.cx, cy: o.cy, a: o.a, U: o.U, V: o.V, cells: 0 });
      else if (ar >= 1.12 && ar < 2.8 && o.fill > 0.45) blocks.push({ cx: o.cx, cy: o.cy, a: o.a + Math.PI / 2, U: o.V, V: o.U, cells: 1 });   // одна ячейка: ряд идёт поперёк её длинной оси
    }
    if (blocks.length > 400) blocks = blocks.sort(function (p, q2) { return q2.U * q2.V - p.U * p.V; }).slice(0, 400);
    // склеить блоки одной толщины на одной прямой
    var par = blocks.map(function (_, i) { return i; }), fd = function (i) { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
    for (var i = 0; i < blocks.length; i++) for (var j = i + 1; j < blocks.length; j++) {
      var p = blocks[i], q3 = blocks[j], tv = (p.V + q3.V) / 2;
      if (Math.max(p.V, q3.V) > 1.35 * Math.min(p.V, q3.V)) continue;
      var da = Math.abs(((p.a - q3.a) % Math.PI + Math.PI * 1.5) % Math.PI - Math.PI / 2); if (da > 0.22) continue;
      var ux = Math.cos(p.a), uy = Math.sin(p.a), ddx = q3.cx - p.cx, ddy = q3.cy - p.cy, along = Math.abs(ddx * ux + ddy * uy), perp = Math.abs(-ddx * uy + ddy * ux);
      if (perp > 0.3 * tv) continue;
      if (along - (p.U + q3.U) / 2 > 0.75 * tv) continue;
      par[fd(i)] = fd(j);
    }
    var groups = {}; blocks.forEach(function (b0, i2) { (groups[fd(i2)] = groups[fd(i2)] || []).push(b0); });
    var dbg = root.TEPLO_DRUM_DBG && rad === (root.TEPLO_DRUM_DBG.rad || 0) ? root.TEPLO_DRUM_DBG : null; if (dbg) { dbg.W = W; dbg.H = H; dbg.dark = Array.from(dark); dbg.red = Array.from(red); dbg.blocks = blocks; dbg.rej = []; }
    // зерно (кусок окна) → проходим вдоль оси в обе стороны, перепрыгивая блики; окно — пока поперёк «тёмное или красное»,
    // а сразу за толщиной — нет (иначе это труба или тень, а не окно)
    var seeds = Object.keys(groups).map(function (gk) {
      var gs = groups[gk], a = gs[0].a, ux = Math.cos(a), uy = Math.sin(a), V = 0, cx = 0, cy = 0, wsum = 0;
      gs.forEach(function (b1) { var w1 = b1.U * b1.V; cx += b1.cx * w1; cy += b1.cy * w1; V += b1.V * w1; wsum += w1; });
      cx /= wsum; cy /= wsum; V /= wsum;
      var u0 = 1e9, u1 = -1e9; gs.forEach(function (b1) { var t0 = (b1.cx - cx) * ux + (b1.cy - cy) * uy; u0 = Math.min(u0, t0 - b1.U / 2); u1 = Math.max(u1, t0 + b1.U / 2); });
      return { cx: cx + (u0 + u1) / 2 * ux, cy: cy + (u0 + u1) / 2 * uy, a: a, U: u1 - u0, V: V, n: gs.length, area: (u1 - u0) * V };
    }).sort(function (p0, q0) { return q0.area - p0.area; }).slice(0, 40);
    var out = [];
    seeds.forEach(function (sd) {
      var a = sd.a, ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux, V = sd.V, hv = V * 0.38;
      var at = function (t, v) { var X = Math.round(sd.cx + ux * t + vx * v), Y = Math.round(sd.cy + uy * t + vy * v); return X < 0 || Y < 0 || X >= W || Y >= H ? -1 : Y * W + X; };
      var good = function (t) {
        var n0 = 0, g0 = 0, no = 0, go = 0, v, q8;
        for (v = -hv; v <= hv; v += 1) { q8 = at(t, v); if (q8 < 0) return 0; n0++; if (dark[q8] || red[q8]) g0++; }
        for (v = V * 0.75; v <= V * 1.05; v += 1) { q8 = at(t, v); if (q8 >= 0) { no++; if (dark[q8]) go++; } q8 = at(t, -v); if (q8 >= 0) { no++; if (dark[q8]) go++; } }
        return g0 / n0 >= 0.5 && (!no || go / no < 0.6);
      };
      var walk = function (dir) { var t = dir * sd.U / 2, last = t, gap = 0, lim = sd.U / 2 + 14 * V; while (Math.abs(t) < lim) { t += dir; if (good(t)) { last = t; gap = 0; } else if (++gap > V * 0.9) break; } return last; };
      var t1 = walk(1), t0 = walk(-1), U = t1 - t0;
      if (U / V < 2.1 || U / V > 14) { if (dbg) dbg.rej.push(['ar', rad, sd.cx, sd.cy, U, V, sd.n]); return; }
      var cx = sd.cx + ux * (t0 + t1) / 2, cy = sd.cy + uy * (t0 + t1) / 2;
      if (out.some(function (o) { return Math.abs((o.cxa - cx) * vx + (o.cya - cy) * vy) < V * 0.5 && Math.abs((o.cxa - cx) * ux + (o.cya - cy) * uy) < (o.U + U) / 2; })) return;
      var st = sampleRect(cx, cy, a, U * 0.95, V * 0.8);
      if (st.bright < 0.05 || st.bright > 0.72) { if (dbg) dbg.rej.push(['bright', rad, cx, cy, U, V, st.bright]); return; }
      // красноватость поперёк окна по длине: где кончаются чёрные ролики и начинаются красные
      var prof = [], tt;
      for (tt = t0; tt <= t1; tt += 1) {
        var nr0 = 0, nn0 = 0; for (var v1 = -hv; v1 <= hv; v1 += 1) { var q9 = at(tt, v1); if (q9 < 0) continue; nn0++; var r9 = px[q9 * 4], g9 = px[q9 * 4 + 1], b9 = px[q9 * 4 + 2]; if (red[q9] || (r9 > 35 && r9 - Math.max(g9, b9) > 14 && r9 > 1.3 * Math.max(g9, b9))) nr0++; }
        prof.push(nn0 ? nr0 / nn0 : 0);
      }
      var cum = [0]; prof.forEach(function (f0, i9) { cum.push(cum[i9] + f0); });
      var best = null, minSeg = Math.max(3, V * 0.55);
      for (var sp = Math.round(minSeg); sp <= prof.length - minSeg; sp++) {
        // как у Оцу: разница средних с весом долей — не «отрезает» самый яркий красный ролик, а берёт все красные
        var mL = cum[sp] / sp, mR = (cum[prof.length] - cum[sp]) / (prof.length - sp), dlt = mR - mL, wv = sp / prof.length * (1 - sp / prof.length) * dlt * dlt;
        if (!best || wv > best.v) best = { sp: sp, d: dlt, v: wv };
      }
      var redSide = best && Math.abs(best.d) > 0.22 ? (best.d > 0 ? 1 : -1) : 0;   // 1 — красные в конце по оси, −1 — в начале, 0 — не видно
      // без красного внутри — посмотреть за концами (красные ролики иногда отдельным окном)
      var e1 = sampleRect(cx + ux * (U / 2 + U * 0.25), cy + uy * (U / 2 + U * 0.25), a, U * 0.4, V * 0.7), e2 = sampleRect(cx - ux * (U / 2 + U * 0.25), cy - uy * (U / 2 + U * 0.25), a, U * 0.4, V * 0.7);
      if (!redSide && Math.max(e1.red, e2.red) > 0.15 && Math.abs(e1.red - e2.red) > 0.1) redSide = e1.red > e2.red ? 2 : -2;
      // чёрная часть [b0, b1] вдоль оси (от начала окна), красная — остальное
      var bt0 = t0, bt1 = t1, rt0 = null, rt1 = null;
      if (redSide === 1) { bt1 = t0 + best.sp; rt0 = bt1; rt1 = t1; } else if (redSide === -1) { bt0 = t0 + best.sp; rt0 = t0; rt1 = bt0; }
      var bcx = sd.cx + ux * (bt0 + bt1) / 2, bcy = sd.cy + uy * (bt0 + bt1) / 2, bU = bt1 - bt0;
      if (bU / V < 1.6) return;
      var dirA = redSide > 0 ? a : redSide < 0 ? a + Math.PI : (Math.cos(a) < 0 ? a + Math.PI : a);
      var rf = redSide ? 1 : Math.max(e1.red, e2.red);
      var score = (0.5 + (redSide ? 0.6 : 0)) * Math.min(1, U / V / 4) * Math.min(1, V / 12) * (st.bright > 0.08 && st.bright < 0.45 ? 1 : 0.6);
      var o9 = { cx: bcx / k, cy: bcy / k, w: bU / k, h: V / k, angle: dirA, sure: !!redSide, red: +rf.toFixed(3), bright: +st.bright.toFixed(3), cells: sd.n, score: +score.toFixed(3), tint: tint(cx, cy, U) || faceTint(cx, cy, ux, uy, U, V), rad: rad, U: U, cxa: cx, cya: cy };
      if (rt0 !== null) { var rcx = sd.cx + ux * (rt0 + rt1) / 2, rcy = sd.cy + uy * (rt0 + rt1) / 2; o9.redBox = { cx: rcx / k, cy: rcy / k, w: (rt1 - rt0) / k, h: V / k, angle: dirA }; }
      out.push(o9);
    });
    return out;
    }
    return cands.sort(function (p, q4) { return q4.score - p.score; }).slice(0, 5);

    function orient(pts) {
      var n2 = pts.length / 2, mx2 = 0, my2 = 0, cxx = 0, cyy = 0, cxy = 0, j2;
      for (j2 = 0; j2 < pts.length; j2 += 2) { mx2 += pts[j2]; my2 += pts[j2 + 1]; } mx2 /= n2; my2 /= n2;
      for (j2 = 0; j2 < pts.length; j2 += 2) { var ex = pts[j2] - mx2, ey = pts[j2 + 1] - my2; cxx += ex * ex; cyy += ey * ey; cxy += ex * ey; }
      var a2 = 0.5 * Math.atan2(2 * cxy, cxx - cyy), ca = Math.cos(a2), sa = Math.sin(a2), u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
      for (j2 = 0; j2 < pts.length; j2 += 2) { var du = (pts[j2] - mx2) * ca + (pts[j2 + 1] - my2) * sa, dv = -(pts[j2] - mx2) * sa + (pts[j2 + 1] - my2) * ca; if (du < u0) u0 = du; if (du > u1) u1 = du; if (dv < v0) v0 = dv; if (dv > v1) v1 = dv; }
      var cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      return { cx: mx2 + cu * ca - cv * sa, cy: my2 + cu * sa + cv * ca, a: a2, U: u1 - u0 + 1, V: v1 - v0 + 1 };
    }
    /** Доли красного и «светлого на тёмном» (цифры) в повёрнутом прямоугольнике. */
    function sampleRect(scx, scy, a3, sw, sh) {
      var ca = Math.cos(a3), sa = Math.sin(a3), nr = 0, nb = 0, nt = 0, ld = [], step = Math.max(1, Math.min(sw, sh) / 14);
      for (var v = -sh / 2; v <= sh / 2; v += step) for (var u = -sw / 2; u <= sw / 2; u += step) {
        var X = Math.round(scx + u * ca - v * sa), Y = Math.round(scy + u * sa + v * ca); if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        var q5 = Y * W + X; nt++; if (red[q5]) nr++; ld.push(L[q5]);
      }
      if (!nt) return { red: 0, bright: 0 };
      ld.sort(function (p2, q6) { return p2 - q6; }); var lo = ld[Math.floor(ld.length * 0.1)], thr = lo + Math.max(45, (ld[ld.length - 1] - lo) * 0.45);
      ld.forEach(function (l2) { if (l2 > thr) nb++; });
      return { red: nr / nt, bright: nb / nt };
    }
    /** Цвет кольца вокруг окна: красное — горячая, синее — холодная. */
    /** Цвет печати на циферблате над и под окном (КСМ — красная, MASTER — синяя): кольца у многих водомеров нет.
     *  Само окно (там красные дробные ролики) не смотрим. */
    function faceTint(fcx, fcy, fux, fuy, U, V) {
      var nr3 = 0, nb3 = 0, fvx = -fuy, fvy = fux, st3 = Math.max(1, V / 8);
      for (var fu = -U / 2; fu <= U / 2; fu += st3) for (var sg = -1; sg <= 1; sg += 2) for (var fv = 0.8 * V; fv <= 3.2 * V; fv += st3) {
        var X3 = Math.round(fcx + fux * fu + fvx * fv * sg), Y3 = Math.round(fcy + fuy * fu + fvy * fv * sg); if (X3 < 0 || Y3 < 0 || X3 >= W || Y3 >= H) continue;
        var q8 = (Y3 * W + X3) * 4, r3 = px[q8], g3 = px[q8 + 1], b3 = px[q8 + 2], m3 = Math.max(r3, g3, b3), n4 = Math.min(r3, g3, b3);
        if (m3 - n4 < 0.3 * m3 || m3 < 60) continue;
        if (r3 === m3 && r3 - g3 > 45 && r3 - b3 > 35) nr3++; else if (b3 === m3 && b3 - r3 > 40) nb3++;
      }
      return nr3 > 2.5 * nb3 && nr3 >= 12 ? 'red' : nb3 > 2.5 * nr3 && nb3 >= 12 ? 'blue' : null;
    }
    function tint(tcx, tcy, U) {
      var nr2 = 0, nbl = 0, R1 = U * 0.9, R2 = U * 1.25;
      for (var t = 0; t < 360; t += 3) for (var rr = R1; rr <= R2; rr += Math.max(1, (R2 - R1) / 6)) {
        var X = Math.round(tcx + Math.cos(t * Math.PI / 180) * rr), Y = Math.round(tcy + Math.sin(t * Math.PI / 180) * rr); if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        var q7 = (Y * W + X) * 4, r2 = px[q7], g2 = px[q7 + 1], b2 = px[q7 + 2], m2 = Math.max(r2, g2, b2), n3 = Math.min(r2, g2, b2);
        if (m2 - n3 < 0.35 * m2 || m2 < 50) continue;
        if (r2 === m2 && r2 - g2 > 40) nr2++; else if (b2 === m2 && b2 - r2 > 40) nbl++;
      }
      return nr2 > 2 * nbl && nr2 > 20 ? 'red' : nbl > 2 * nr2 && nbl > 20 ? 'blue' : null;
    }
  }

  /** Вырезать полосу барабана в строку высотой REC_H: светлые цифры на тёмном → тёмные на светлом, промежутки между роликами — в фон. */
  function drumTensor(src, b, mode) {
    var w = Math.max(16, Math.round(REC_H * b.w / b.h)); if (w > 1200) w = 1200;
    var c = document.createElement('canvas'); c.width = w; c.height = REC_H;
    var g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, w, REC_H);
    g.translate(w / 2, REC_H / 2); g.scale(w / b.w, REC_H / b.h); g.rotate(-b.angle); g.translate(-b.cx, -b.cy); g.drawImage(src, 0, 0);
    var px = g.getImageData(0, 0, w, REC_H).data, N = w * REC_H, Lm = new Float32Array(N), hist = new Uint32Array(256); free(c);
    for (var i = 0; i < N; i++) { var l = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]; Lm[i] = l; hist[l | 0]++; }
    var pct = function (q) { var need = N * q, acc = 0; for (var v = 0; v < 256; v++) { acc += hist[v]; if (acc >= need) return v; } return 255; };
    var lo = pct(0.05), hi = pct(mode === 'red' ? 0.97 : 0.985), t = new Float32Array(3 * N), thr = (lo + hi) / 2;
    // столбцы, светлые почти по всей высоте, — промежутки между роликами (или блик): уводим в фон
    var gapCol = new Uint8Array(w);
    if (mode !== 'plain') for (var x = 0; x < w; x++) { var nb = 0, nn = 0; for (var y = Math.round(REC_H * 0.12); y < REC_H * 0.88; y++) { nn++; if (Lm[y * w + x] > thr) nb++; } if (nb > nn * 0.8) gapCol[x] = 1; }
    for (i = 0; i < N; i++) {
      var v0 = (Lm[i] - lo) / Math.max(24, hi - lo); v0 = v0 < 0 ? 0 : v0 > 1 ? 1 : v0;
      var inv = mode === 'plain' ? v0 : gapCol[i % w] ? 1 : 1 - v0;     // 1 = фон (белый), 0 = чернила
      if (mode === 'bin') inv = inv > 0.5 ? 1 : 0;
      var nv = (inv - 0.5) / 0.5; t[i] = nv; t[N + i] = nv; t[2 * N + i] = nv;
    }
    return { t: t, w: w };
  }
  function recTensor(x) {
    var feeds = {}; feeds[REC.inputNames[0]] = new ORT.Tensor('float32', x.t, [1, 3, REC_H, x.w]);
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
  /* ───── Ролик между цифрами (полуповорот) ─────
   * Последний чёрный ролик часто застаёт фото на переходе: сверху низ цифры d, снизу верх d+1, посередине пустая полоса
   * (у настоящего счётчика так стоит ролик, пока красные идут от 9 к 0). Текст такой ролик пропускает («0023») или читает
   * чужой цифрой (низ «2» + верх «3» → «7»). Разбираем окно на ролики по светлому (цифрам): у ролика на переходе светлое —
   * два куска с пустой полосой между ними. Пару (d, d+1) узнаём по шаблонам: цифры соседних роликов того же окна
   * (их значение известно из текста — тот же шрифт) и цифры шрифта браузера. Низ куска сверху совпадает с низом цифры d,
   * верх куска снизу — с верхом d+1; у краёв окна цифры сжаты (ролик — цилиндр), поэтому пробуем и сжатие по высоте.
   * По правилам снятия показаний берём меньшую цифру d. */
  function drumGray(src, b, SH) {
    var w = Math.max(16, Math.round(SH * b.w / b.h)); if (w > 1600) w = 1600;
    var c = document.createElement('canvas'); c.width = w; c.height = SH;
    var g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, w, SH);
    g.translate(w / 2, SH / 2); g.scale(w / b.w, SH / b.h); g.rotate(-b.angle); g.translate(-b.cx, -b.cy); g.drawImage(src, 0, 0);
    var px = g.getImageData(0, 0, w, SH).data, L = new Float32Array(w * SH); free(c);
    for (var i = 0; i < w * SH; i++) L[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    return { L: L, w: w, h: SH };
  }
  function otsu(L) {
    var hist = new Float64Array(256), n = L.length, i, sum = 0, wB = 0, sB = 0, best = -1, thr = 128;
    for (i = 0; i < n; i++) hist[L[i] | 0]++;
    for (i = 0; i < 256; i++) sum += i * hist[i];
    for (i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; var wF = n - wB; if (!wF) break; sB += i * hist[i]; var mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; thr = i; } }
    return thr;
  }
  /** Ролики окна слева направо: { x0, x1, y0, y1, ids, runs: [{y0, y1}], half } — светлое (цифры) по связным кускам. */
  function drumCells(g) {
    var w = g.w, h = g.h, L = g.L, thr = otsu(L), N = w * h, ink = new Uint8Array(N), x, y, i;
    // полоса окна по высоте: строки, где много тёмного (фон роликов); светлая рамка и промежутки выше/ниже — не окно
    var fd = [], y0w = 0, y1w = h - 1, bestLen = 0, st = -1;
    for (y = 0; y < h; y++) { var nd = 0; for (x = 0; x < w; x++) if (L[y * w + x] < thr) nd++; fd.push(nd / w); }
    for (y = 0; y <= h; y++) { var on = y < h && fd[y] >= 0.3; if (on && st < 0) st = y; if (!on && st >= 0) { if (y - st > bestLen) { bestLen = y - st; y0w = st; y1w = y - 1; } st = -1; } }
    if (bestLen < h * 0.35) { y0w = 0; y1w = h - 1; }
    // светлое = ярче окрестности (тень сверху окна, блик сбоку — порог свой в каждом месте) и заметно ярче фона
    var vals = []; for (y = y0w; y <= y1w; y += 2) for (x = 0; x < w; x += 2) vals.push(L[y * w + x]); vals.sort(function (p, q) { return p - q; });
    var p10 = vals[Math.floor(vals.length * 0.1)] || 0, p97 = vals[Math.floor(vals.length * 0.97)] || 255, rg = Math.max(30, p97 - p10);
    var I = new Float64Array((w + 1) * (h + 1)), R = Math.max(4, Math.round(h * 0.2));
    for (y = 0; y < h; y++) { var row = 0; for (x = 0; x < w; x++) { row += L[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
    for (y = y0w; y <= y1w; y++) for (x = 0; x < w; x++) {
      var ya = Math.max(0, y - R), yb = Math.min(h, y + R + 1), xa = Math.max(0, x - R), xb = Math.min(w, x + R + 1);
      var mean = (I[yb * (w + 1) + xb] - I[ya * (w + 1) + xb] - I[yb * (w + 1) + xa] + I[ya * (w + 1) + xa]) / ((yb - ya) * (xb - xa)), l = L[y * w + x];
      if (l > mean + Math.max(10, 0.12 * rg) && l > p10 + 0.15 * rg) ink[y * w + x] = 1;
    }
    // столбцы почти без тёмного — промежуток между роликами или блик; строки светлые во всю ширину — кромка рамки
    for (x = 0; x < w; x++) { var nk = 0; for (y = y0w; y <= y1w; y++) if (L[y * w + x] < thr) nk++; if (nk < (y1w - y0w + 1) * 0.15) for (y = 0; y < h; y++) ink[y * w + x] = 0; }
    for (y = 0; y < h; y++) { var nr = 0; for (x = 0; x < w; x++) nr += ink[y * w + x]; if (nr > w * 0.6) for (x = 0; x < w; x++) ink[y * w + x] = 0; }
    // тонкие линии (кромки промежутков между роликами при наклоне, 1–2 px) — прочь: размыкание 3×3; штрихи цифр толще
    var er = new Uint8Array(N);
    for (y = 1; y < h - 1; y++) for (x = 1; x < w - 1; x++) { i = y * w + x; er[i] = ink[i] & ink[i - 1] & ink[i + 1] & ink[i - w] & ink[i + w] & ink[i - w - 1] & ink[i - w + 1] & ink[i + w - 1] & ink[i + w + 1]; }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) { i = y * w + x; var on2 = 0; for (var ey = Math.max(0, y - 1); ey <= Math.min(h - 1, y + 1) && !on2; ey++) for (var ex = Math.max(0, x - 1); ex <= Math.min(w - 1, x + 1); ex++) if (er[ey * w + ex]) { on2 = 1; break; } ink[i] = on2; }
    var lab = new Int32Array(N), comps = [null], stack = new Int32Array(N);
    for (i = 0; i < N; i++) {
      if (!ink[i] || lab[i]) continue;
      var id = comps.length, top = 0, c = { id: id, x0: w, x1: -1, y0: h, y1: -1, n: 0 }; stack[top++] = i; lab[i] = id;
      while (top) {
        var q = stack[--top], qx = q % w, qy = (q - qx) / w; c.n++;
        if (qx < c.x0) c.x0 = qx; if (qx > c.x1) c.x1 = qx; if (qy < c.y0) c.y0 = qy; if (qy > c.y1) c.y1 = qy;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { var xx = qx + dx, yy = qy + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; var qq = yy * w + xx; if (ink[qq] && !lab[qq]) { lab[qq] = id; stack[top++] = qq; } }
      }
      comps.push(c);
    }
    // мелочь (шум, кромки рамки) и куски у боковых краёв полосы (соседний красный ролик, подпись «м³») — не цифры
    // и полоски у верхнего/нижнего края окна — кромка рамки, когда окно в полосе чуть наклонено
    var tw0 = comps.slice(1).filter(function (c) { return c.y1 - c.y0 + 1 >= h * 0.3; }).map(function (c) { return c.x1 - c.x0 + 1; }).sort(function (a, b) { return a - b; });
    var Wc = tw0.length ? tw0[Math.floor(tw0.length / 2)] : h;
    var cs = comps.slice(1).filter(function (c) { var ch = c.y1 - c.y0 + 1, cw2 = c.x1 - c.x0 + 1;
      if (ch <= h * 0.15 && cw2 >= 2.5 * ch && cw2 >= 1.1 * Wc && (c.y0 <= y0w + 2 || c.y1 >= y1w - 2)) return false;
      return c.n >= h * h * 0.002 && c.y1 - c.y0 >= 2 && c.x1 - c.x0 >= 2 && c.x0 > 0 && c.x1 < w - 1; }).sort(function (a, b) { return a.x0 - b.x0; });
    var cells = [];
    cs.forEach(function (c) {
      var last = cells[cells.length - 1];
      if (last && Math.min(last.x1, c.x1) - Math.max(last.x0, c.x0) >= 0.3 * Math.min(last.x1 - last.x0 + 1, c.x1 - c.x0 + 1)) {
        last.ids[c.id] = 1; last.x0 = Math.min(last.x0, c.x0); last.x1 = Math.max(last.x1, c.x1); last.y0 = Math.min(last.y0, c.y0); last.y1 = Math.max(last.y1, c.y1); last.n += c.n;
      } else { var o = { x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, n: c.n, ids: {} }; o.ids[c.id] = 1; cells.push(o); }
    });
    // ячейки-соринки (меньше трети средней по площади) — не ролики
    var nmed = cells.map(function (c) { return c.n; }).sort(function (a, b) { return a - b; })[Math.floor(cells.length / 2)] || 0;
    cells = cells.filter(function (c) { return c.n >= nmed * 0.25; });
    var mg = Math.max(1, Math.round(h * 0.02));
    cells.forEach(function (c) {
      var runs = [], cur = null;
      for (y = 0; y < h; y++) {
        var on = false; for (x = c.x0; x <= c.x1 && !on; x++) if (c.ids[lab[y * w + x]]) on = true;
        if (on) { if (cur && y - cur.y1 - 1 <= mg) cur.y1 = y; else { cur = { y0: y, y1: y }; runs.push(cur); } }
      }
      c.runs = runs;
    });
    // рост цифры — медиана самого высокого куска ролика; середина — по целым цифрам
    var rh = function (r) { return r.y1 - r.y0 + 1; }, tall = function (c) { return c.runs.reduce(function (a, r) { return rh(r) > rh(a) ? r : a; }, c.runs[0]); };
    var hs = cells.filter(function (c) { return c.runs.length; }).map(function (c) { return rh(tall(c)); }).sort(function (a, b) { return a - b; });
    var Hg = hs.length ? hs[Math.floor(hs.length / 2)] : 0;
    var mid = cells.filter(function (c) { return c.runs.length && rh(tall(c)) >= 0.85 * Hg; }).map(function (c) { var r = tall(c); return (r.y0 + r.y1) / 2; }).sort(function (a, b) { return a - b; });
    var Cg = mid.length ? mid[Math.floor(mid.length / 2)] : h / 2;
    // в ролике есть целая цифра на своём месте — остальное в нём (кромка рамки, соринки) не считаем
    if (Hg) cells.forEach(function (c) {
      if (c.runs.length < 2) return;
      var r = tall(c); if (Math.abs(rh(r) - Hg) <= 0.15 * Hg && Math.abs((r.y0 + r.y1) / 2 - Cg) <= 0.15 * Hg) { c.runs = [r]; c.y0 = r.y0; c.y1 = r.y1; }
    });
    if (Hg) cells.forEach(function (c) {
      if (c.runs.length === 1) {
        // один кусок, заметно ниже цифры и сдвинут к краю окна: видна только часть цифры на переходе (вторую закрыла тень
        // или она уже ушла за край). Снизу — верх входящей цифры, сверху — низ уходящей. Узнаём, но только если текст
        // этот ролик пропустил (иначе верим тексту).
        var r0 = c.runs[0], hr = r0.y1 - r0.y0 + 1, off = (r0.y0 + r0.y1) / 2 - Cg;
        if (hr >= 0.3 * Hg && hr <= 0.8 * Hg && Math.abs(off) >= 0.25 * Hg) { c.part = true; c.A = off < 0 ? r0 : null; c.B = off > 0 ? r0 : null; }
        return;
      }
      if (c.runs.length < 2) return;
      var A = c.runs[0], B = c.runs[c.runs.length - 1], hA = A.y1 - A.y0 + 1, hB = B.y1 - B.y0 + 1, gap = B.y0 - A.y1 - 1;
      // два куска с пустой полосой (промежуток между цифрами на ролике), оба заметные, вместе выше одной цифры —
      // не цифра, рассыпавшаяся на куски (у той промежуток мал и всё вместе — в рост цифры)
      if (gap >= Math.max(2, 0.12 * Hg) && hA >= 0.08 * Hg && hB >= 0.08 * Hg && hA + hB >= 0.3 * Hg && Math.max(hA, hB) <= 1.05 * Hg && B.y1 - A.y0 + 1 >= 1.1 * Hg) { c.half = true; c.A = A; c.B = B; }
    });
    if (root.TEPLO_DRUM_LOG) (root.TEPLO_HALF_IMG = root.TEPLO_HALF_IMG || []).push({ w: w, h: h, L: Array.from(L), ink: Array.from(ink), lab: Array.from(lab) });
    return { cells: cells, lab: lab, w: w, h: h, Hg: Hg, Cg: Cg, win: [y0w, y1w] };
  }
  var TPL = null;
  /** Цифры шрифтов браузера (жирные без засечек: узкий, обычный, «табличный») — маски по рамке цифры; [цифра] → [шаблоны]. */
  var TPL_FONTS = ['"DejaVu Sans Condensed", "Roboto Condensed", sans-serif-condensed, "Arial Narrow", "Helvetica Neue", sans-serif', 'Arial, Helvetica, "Liberation Sans", Roboto, sans-serif', '"DIN Alternate", Bahnschrift, "Roboto Mono", "Liberation Mono", monospace'];
  function fontTpl() {
    var fonts = root.TEPLO_TPL_FONTS || TPL_FONTS, key = fonts.join('|');
    if (TPL && TPL.key === key) return TPL.out;
    var S = 96, cw = Math.round(S * 1.2), chh = Math.round(S * 1.5), c = document.createElement('canvas'); c.width = cw; c.height = chh; var g = c.getContext('2d'), out = [];
    for (var k = 0; k < 10; k++) out.push([]);
    fonts.forEach(function (fam) {
      for (var k = 0; k < 10; k++) {
        g.fillStyle = '#000'; g.fillRect(0, 0, cw, chh); g.fillStyle = '#fff'; g.font = 'bold ' + S + 'px ' + fam;
        g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(k), cw / 2, chh / 2);
        var px = g.getImageData(0, 0, cw, chh).data, x0 = cw, x1 = -1, y0 = chh, y1 = -1, x, y;
        for (y = 0; y < chh; y++) for (x = 0; x < cw; x++) if (px[(y * cw + x) * 4] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        if (x1 < 0) continue;
        var tw = x1 - x0 + 1, th = y1 - y0 + 1, m = new Uint8Array(tw * th), sig = '';
        for (y = 0; y < th; y++) for (x = 0; x < tw; x++) m[y * tw + x] = px[((y + y0) * cw + x + x0) * 4] > 127 ? 1 : 0;
        for (y = 0; y < th; y += 7) for (x = 0; x < tw; x += 7) sig += m[y * tw + x];
        // тот же шрифт под другим именем (подставился запасной) — второй раз не берём
        if (!out[k].some(function (o) { return o.w === tw && o.h === th && o.sig === sig; })) out[k].push({ w: tw, h: th, m: m, sig: sig });
      }
    });
    free(c); TPL = { key: key, out: out }; return out;
  }
  /** Шаблон в размер цифры окна: маска Ht×Wt. */
  function sizeTpl(T, Ht, Wt) {
    var m = new Uint8Array(Ht * Wt);
    for (var y = 0; y < Ht; y++) for (var x = 0; x < Wt; x++) m[y * Wt + x] = T.m[Math.floor(y * T.h / Ht) * T.w + Math.floor(x * T.w / Wt)];
    return { m: m, Ht: Ht, Wt: Wt };
  }
  /** Маска ролика окна как шаблон (его цифра известна из текста). */
  function cellTpl(cl, c) {
    var tw = c.x1 - c.x0 + 1, th = c.y1 - c.y0 + 1, m = new Uint8Array(tw * th);
    for (var y = 0; y < th; y++) for (var x = 0; x < tw; x++) m[y * tw + x] = c.ids[cl.lab[(y + c.y0) * cl.w + x + c.x0]] ? 1 : 0;
    return { m: m, Ht: th, Wt: tw };
  }
  /** Сходство куска ролика R с шаблоном T (Ht×Wt на полосе), центр по x — cx; низ куска = низ цифры (bottom) или верх
   *  куска = верх цифры; s — сжатие по высоте у края окна. Dice по светлому в полосе куска (строгое сравнение надёжнее
   *  «с допуском»: на чужом шрифте реже уверенно ошибается). */
  function fragScore(cl, F, R, T, cx, bottom, s, X0, X1) {
    var inter = 0, nf = 0, nt = 0, w = cl.w, Ht = T.Ht, Wt = T.Wt, ox = Math.round(cx - Wt / 2);
    for (var y = R.y0; y <= R.y1; y++) {
      var ty = Math.floor(bottom ? Ht - 1 - (R.y1 - y) / s : (y - R.y0) / s), row = ty >= 0 && ty < Ht ? ty * Wt : -1;
      for (var x = X0; x <= X1; x++) {
        var f = F[y * w + x], tx = x - ox, t = row >= 0 && tx >= 0 && tx < Wt ? T.m[row + tx] : 0;
        nf += f; nt += t; if (f && t) inter++;
      }
    }
    return nf + nt ? 2 * inter / (nf + nt) : 0;
  }
  /** Какая пара (d, d+1) на ролике c: { d, sc, margin, rank }. */
  function halfPair(cl, c, known) {
    var Hg = cl.Hg, full = cl.cells.filter(function (o) { return !o.half && !o.part && o.runs.length === 1; });
    var ws = full.filter(function (o) { return known.get(o) !== 1; }).map(function (o) { return o.x1 - o.x0 + 1; }).sort(function (a, b) { return a - b; });
    var Wg = ws.length ? ws[Math.floor(ws.length / 2)] : Hg * 0.6;
    // шаблоны шрифтов — в рост цифр окна, по ширине — как «0» шрифта к средней ширине цифр окна (узкий/широкий шрифт)
    var Fn = fontTpl(), tpl = [], k;
    for (k = 0; k < 10; k++) tpl[k] = [];
    Fn[0].forEach(function (f0, fi) {
      var sc = Hg / f0.h, fx = Wg / (f0.w * sc);
      for (var k2 = 0; k2 < 10; k2++) { var T = Fn[k2][Math.min(fi, Fn[k2].length - 1)]; if (T) tpl[k2].push(sizeTpl(T, Math.max(2, Math.round(T.h * sc)), Math.max(2, Math.round(T.w * sc * fx)))); }
    });
    var nb = 0;
    full.forEach(function (o) { var dk = known.get(o); if (dk !== undefined && nb < 6 && !tpl[dk].own) { tpl[dk].push(cellTpl(cl, o)); tpl[dk].own = true; nb++; } });
    // светлое этого ролика на всей полосе
    var N = cl.w * cl.h, F = new Uint8Array(N); for (var q = 0; q < N; q++) F[q] = c.ids[cl.lab[q]] ? 1 : 0;
    var cx0 = (c.x0 + c.x1) / 2, X0 = Math.max(0, Math.round(cx0 - Wg)), X1 = Math.min(cl.w - 1, Math.round(cx0 + Wg));
    var hA = c.A ? c.A.y1 - c.A.y0 + 1 : 0, hB = c.B ? c.B.y1 - c.B.y0 + 1 : 0, wA = hA / (hA + hB), step = Math.max(1, Wg / 16), S = [];
    var best = function (R, k3, cx, bottom) { var m = 0; tpl[k3].forEach(function (T) { [1, 0.85, 0.7].forEach(function (s2) { var v = fragScore(cl, F, R, T, cx, bottom, s2, X0, X1); if (v > m) m = v; }); }); return m; };
    for (k = 0; k < 10; k++) {
      var top = 0;
      for (var cx = cx0 - Wg * 0.3; cx <= cx0 + Wg * 0.3; cx += step) { var v = (c.A ? wA * best(c.A, k, cx, true) : 0) + (c.B ? (1 - wA) * best(c.B, (k + 1) % 10, cx, false) : 0); if (v > top) top = v; }
      S.push({ k: k, v: top });
    }
    S.sort(function (a, b) { return b.v - a.v; });
    return { d: S[0].k, sc: +S[0].v.toFixed(3), margin: +(S[0].v - S[1].v).toFixed(3), rank: S.map(function (x) { return x.k; }) };
  }
  /** Наклон ряда цифр в полосе (окно найдено с ошибкой в угол): середины целых цифр по x → наклон прямой. */
  function cellSkew(cl) {
    var pts = cl.cells.filter(function (c) { return c.runs.length === 1 && Math.abs(c.y1 - c.y0 + 1 - cl.Hg) <= 0.15 * cl.Hg; }).map(function (c) { return [(c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2]; });
    if (pts.length < 2 || pts[pts.length - 1][0] - pts[0][0] < 1.2 * cl.Hg) return 0;
    var mx = 0, my = 0; pts.forEach(function (p) { mx += p[0]; my += p[1]; }); mx /= pts.length; my /= pts.length;
    var sxy = 0, sxx = 0; pts.forEach(function (p) { sxy += (p[0] - mx) * (p[1] - my); sxx += (p[0] - mx) * (p[0] - mx); });
    return sxx ? sxy / sxx : 0;
  }
  function halfFix(src, d, win) {
    var bx = { cx: d.cx, cy: d.cy, w: d.w + d.h * 0.1, h: d.h * 1.1, angle: win.ang }, cl = drumCells(drumGray(src, bx, 96));
    // ряд цифр в полосе наклонён (перспектива, окно нашлось чуть криво) — поворачиваем полосу и разбираем заново
    var sk = cellSkew(cl);
    if (Math.abs(sk) > 0.02 && Math.abs(sk) < 0.2) { bx.angle += Math.atan(sk); cl = drumCells(drumGray(src, bx, 96)); }
    var cells = cl.cells, t = win.best.d, Hg = cl.Hg, Cg = cl.Cg;
    // по краям окна бывает не цифра (подпись «м³», кусок рамки, соседний красный ролик) — такие ролики по краям отбрасываем
    var junk = function (c) { if (c.half || c.part) return false; return c.runs.length !== 1 || Math.abs(c.y1 - c.y0 + 1 - Hg) > 0.2 * Hg || Math.abs((c.y0 + c.y1) / 2 - Cg) > 0.2 * Hg; };
    while (cells.length && junk(cells[0])) cells = cells.slice(1);
    while (cells.length && junk(cells[cells.length - 1])) cells = cells.slice(0, -1);
    cl.cells = cells; var n = cells.length;
    var nh = cells.filter(function (c) { return c.half; }).length, np = cells.filter(function (c) { return c.part; }).length;
    if (root.TEPLO_DRUM_LOG) console.log('DBG cells', t, 'skew', sk.toFixed(3), 'Hg', cl.Hg, 'win', cl.win, JSON.stringify(cells.map(function (c) { return [c.x0, c.x1, c.runs.map(function (r) { return r.y0 + '-' + r.y1; }).join(','), c.half ? 'H' : c.part ? 'P' : '']; })));
    if (!cl.Hg || !(nh + np) || nh + np > 2) return null;
    // место каждого ролика в тексте: текст видит все ролики (переход прочитан чужой цифрой — меняем на узнанную пару)
    // или пропустил ролики на переходе
    var pos = [], j = 0, use;
    if (t.length === n) { cells.forEach(function (c, i) { pos.push(i); }); use = function (c) { return c.half || c.part; }; }
    else if (t.length === n - nh - np) { cells.forEach(function (c) { pos.push(c.half || c.part ? -1 : j++); }); use = function (c) { return c.half || c.part; }; }
    else if (t.length === n - nh && np) { cells.forEach(function (c) { pos.push(c.half ? -1 : j++); }); use = function (c) { return c.half; }; }
    else return null;
    var known = { get: function (o) { var i = cells.indexOf(o); return pos[i] >= 0 && !o.half && !o.part ? +t.charAt(pos[i]) : undefined; } };
    var out = '', hv = [];
    // полоса → фото: середина и размер куска ролика в координатах исходного снимка
    var toSrc = function (x0, x1, y0, y1) {
      var ux = Math.cos(bx.angle), uy = Math.sin(bx.angle), kx = bx.w / cl.w, ky = bx.h / cl.h;
      var u = ((x0 + x1 + 1) / 2 - cl.w / 2) * kx, v = ((y0 + y1 + 1) / 2 - cl.h / 2) * ky;
      return { cx: bx.cx + u * ux - v * uy, cy: bx.cy + u * uy + v * ux, w: (x1 - x0 + 1) * kx, h: (y1 - y0 + 1) * ky, angle: bx.angle };
    };
    cells.forEach(function (c, i) {
      if (!use(c)) { out += t.charAt(pos[i]); return; }
      var r = halfPair(cl, c, known), ok = r.sc >= 0.5 && r.margin >= 0.03;
      // один кусок почти в рост цифры (≥ 75 %) — ролик не на переходе, а чуть сдвинут (люфт: «5» опущена, сверху хвост «4»);
      // такую цифру видно — её прочитает распознаватель (readDrum), шаблонная пара тут только запасная
      var P = c.half ? ((c.B.y1 - c.B.y0) >= (c.A.y1 - c.A.y0) ? c.B : c.A) : null, sh = null;
      if (P && P.y1 - P.y0 + 1 >= 0.75 * Hg) { var pw = 0.3 * Hg, ph = 0.2 * Hg; sh = { big: P === c.B ? 'low' : 'high', tplD: ok ? r.d : null, box: toSrc(c.x0 - pw, c.x1 + pw, P.y0 - ph, P.y1 + ph) }; }
      hv.push({ i: out.length, d: ok && !sh ? r.d : null, sc: r.sc, margin: r.margin, rank: r.rank, part: c.part ? (c.A ? 'low' : 'high') : undefined, shift: sh || undefined });
      if (ok && !sh) out += r.d;
    });
    // голоса заново: обработка согласна, если совпала на всех роликах, кроме переходных (там у каждой своё или пусто)
    var hp = {}; hv.forEach(function (x) { hp[x.i] = 1; });
    var core = out.split('').filter(function (ch, i) { return !hp[i]; }).join(''), votes = 0;
    (win.alts || []).forEach(function (a) {
      var dg = String(a).replace(/[Oo]/g, '0').replace(/[^0-9]/g, '');
      if (dg.length === out.length ? dg.split('').filter(function (ch, i) { return !hp[i]; }).join('') === core : dg === core) votes++;
    });
    if (root.TEPLO_DRUM_LOG) console.log('DBG half', t, '→', out, 'votes', votes, JSON.stringify(hv));
    return { text: out, half: hv, votes: votes };
  }

  /** Одна цифра ролика (вырезанный кусок): три обработки, нужна одна и та же цифра в двух. → цифра | null */
  function readCell(src, b) {
    var got = {};
    return ['inv', 'bin', 'plain'].reduce(function (ch, m) { return ch.then(function () { return recTensor(drumTensor(src, b, m)); }).then(function (r) {
      var dg = r.text.replace(/[Oo]/g, '0').replace(/[^0-9]/g, ''); if (dg.length !== 1) return;
      var g = got[dg] = got[dg] || { n: 0, s: 0 }; g.n++; g.s = Math.max(g.s, r.score);
    }); }, Promise.resolve()).then(function () {
      var k = Object.keys(got).sort(function (a, b) { return got[b].n - got[a].n || got[b].s - got[a].s; })[0];
      return k !== undefined && got[k].n >= 2 && got[k].s >= 0.6 ? +k : null;
    });
  }
  /** Прочитать найденное окно: чёрные ролики (три обработки, голосование) и красные. Ориентация не ясна — читаем в обе стороны. */
  function readDrum(src, d) {
    var tries = [d.angle, d.angle + Math.PI], res = [];   // и в обратную сторону: красная рамка или текст у края путают ориентацию
    var chain = Promise.resolve();
    tries.forEach(function (ang) {
      var blk = { cx: d.cx, cy: d.cy, w: d.w + d.h * 0.1, h: d.h * 1.1, angle: ang }, outs = [];
      ['inv', 'bin', 'plain'].forEach(function (m) { chain = chain.then(function () { return recTensor(drumTensor(src, blk, m)); }).then(function (r) { r.mode = m; outs.push(r); }); });
      chain = chain.then(function () {
        var tally = {};
        // буквы в прочитанном («L0SOO») — цифры вверх ногами: «5» → «S», «9» → «6»; такое чтение весит меньше
        outs.forEach(function (r) { var dg = r.text.replace(/[Oo]/g, '0').replace(/[^0-9]/g, ''); if (dg.length < 3) return; var t2 = tally[dg] = tally[dg] || { n: 0, s: 0, j: 0 }; t2.n++; t2.s = Math.max(t2.s, r.score); if (/[^0-9Oo\s.,:;'"`·\-]/.test(r.text)) t2.j++; });
        var bestK = null, dgs = outs.map(function (r) { return r.text.replace(/[Oo]/g, '0').replace(/[^0-9]/g, ''); });
        // ролик между цифрами: в этой стороне его видно в начале ряда — так не бывает (переход идёт с младшего ролика),
        // значит, читаем вверх ногами; в конце ряда — как и должно быть
        var hc = 0; try { var cl0 = drumCells(drumGray(src, blk, 96)), cc = cl0.cells.filter(function (c) { return c.runs.length; }); if (cc.length >= 3) { if (cc[0].half || cc[0].part) hc = -0.6; else if (cc[cc.length - 1].half || cc[cc.length - 1].part) hc = 0.4; } } catch (e) { hc = 0; }
        Object.keys(tally).forEach(function (kk) {
          // обработки, согласные во всём, кроме последней цифры (на переходе у каждой своя), — полголоса
          var head = kk.slice(0, -1), np = kk.length >= 4 ? dgs.filter(function (x) { return x.length >= head.length && x.length <= kk.length + 1 && x.slice(0, head.length) === head; }).length : 0;
          var v = tally[kk], ne = v.n + 0.5 * Math.max(0, np - v.n), sc = ne + v.s + (kk.length >= 4 && kk.length <= 8 ? 0.5 : 0) + (/^0/.test(kk) ? 0.6 : 0) + (/^00/.test(kk) ? 0.3 : 0) + (ang === d.angle && d.sure ? 0.3 : 0) - 0.7 * v.j / v.n + hc;
          if (!bestK || sc > bestK.sc) bestK = { d: kk, sc: sc, n: v.n, s: v.s };
        });
        res.push({ ang: ang, best: bestK, alts: outs.map(function (r) { return r.text; }) });
      });
    });
    var reds = [], lead = 0;
    // Блик стекла на ведущих роликах («00» не видно): прочитали 3 цифры без ведущего нуля — окно короче настоящего.
    // Дотягиваем его к началу на 2 ролика и читаем ещё раз: нули проступили — берём, нет — отмечаем lead (начала не видно).
    chain = chain.then(function () {
      res.sort(function (p, q) { return (q.best ? q.best.sc : -1) - (p.best ? p.best.sc : -1); });
      var win = res[0]; if (!win.best || win.best.d.length !== 3 || /^0/.test(win.best.d) || win.best.n < 2) return null;
      var ext = d.w / 3 * 2, ux = Math.cos(win.ang), uy = Math.sin(win.ang), eb = { cx: d.cx - ux * ext / 2, cy: d.cy - uy * ext / 2, w: d.w + ext + d.h * 0.1, h: d.h * 1.1, angle: win.ang }, got = {};
      return ['inv', 'bin', 'plain'].reduce(function (ch3, m) { return ch3.then(function () { return recTensor(drumTensor(src, eb, m)); }).then(function (r) {
        var dg = r.text.replace(/[Oo]/g, '0').replace(/[^0-9]/g, '');
        if (dg.length === 5 && /^0/.test(dg) && dg.slice(2) === win.best.d) { (got[dg] = got[dg] || { n: 0, s: 0 }).n++; got[dg].s = Math.max(got[dg].s, r.score); }
      }); }, Promise.resolve()).then(function () {
        var k5 = Object.keys(got).sort(function (a, b) { return got[b].n - got[a].n; })[0];
        if (k5) { win.best = { d: k5, sc: win.best.sc, n: Math.max(win.best.n, got[k5].n), s: Math.min(win.best.s, got[k5].s) }; win.ext = ext; }
        else lead = 2;
      });
    });
    // ролик между цифрами: текст его пропускает или читает чужой цифрой — разбираем окно на ролики и узнаём пару
    var half = null, shifted = [];
    chain = chain.then(function () {
      var win = res[0]; if (!win.best || win.ext || lead) return;
      try { half = halfFix(src, d, win); } catch (e) { half = null; }
    });
    // сдвинутый ролик: читаем его отдельно; цифра есть — это обычный ролик, нет — пара по шаблонам или «?»
    chain = chain.then(function () {
      var sh = half ? half.half.filter(function (x) { return x.shift; }) : [];
      if (!sh.length) return null;
      return sh.reduce(function (ch, x) { return ch.then(function () { return readCell(src, x.shift.box); }).then(function (D) { x.shift.rec = D; }); }, Promise.resolve()).then(function () {
        var tx = half.text, off = 0, keep = [];
        half.half.forEach(function (x) {
          x.i += off;
          if (x.shift && x.shift.rec !== null) { tx = tx.slice(0, x.i) + x.shift.rec + tx.slice(x.i); off++; shifted.push({ i: x.i, d: x.shift.rec, big: x.shift.big }); return; }
          if (x.shift && x.shift.tplD !== null) { tx = tx.slice(0, x.i) + x.shift.tplD + tx.slice(x.i); off++; x.d = x.shift.tplD; }
          delete x.shift; keep.push(x);
        });
        half.text = tx; half.half = keep;
        if (root.TEPLO_DRUM_LOG) console.log('DBG shift', tx, JSON.stringify(shifted));
      });
    });
    chain = chain.then(function () {
      var win = res[0]; if (!win.best) return null;
      var rb = d.redBox;
      if (!rb) { var ux = Math.cos(win.ang), uy = Math.sin(win.ang), rl = d.w * 0.6; rb = { cx: d.cx + ux * (d.w / 2 + rl / 2 + d.h * 0.04), cy: d.cy + uy * (d.w / 2 + rl / 2 + d.h * 0.04), w: rl, h: d.h }; }
      rb = { cx: rb.cx, cy: rb.cy, w: rb.w, h: rb.h * 1.05, angle: win.ang };
      return ['red', 'plain'].reduce(function (ch2, m) { return ch2.then(function () { return recTensor(drumTensor(src, rb, m)); }).then(function (r) { reds.push(r); }); }, Promise.resolve());
    });
    return chain.then(function () {
      var win = res[0], b0 = win.best;
      var rd = reds.map(function (r) { return { d: r.text.replace(/[Oo]/g, '0').replace(/[^0-9]/g, ''), s: r.score }; }).filter(function (r) { return r.d.length >= 1 && r.d.length <= 4; }).sort(function (p, q) { return q.s - p.s; })[0];
      return { text: half ? half.text : b0 ? b0.d : '', red: rd ? rd.d : '', half: half && half.half.length ? half.half : undefined, shifted: shifted.length ? shifted : undefined, score: b0 ? +b0.s.toFixed(3) : 0, votes: b0 ? Math.max(b0.n, half ? half.votes : 0) : 0, alts: win.alts,
        x: Math.round(d.cx - d.w / 2), y: Math.round(d.cy - d.h / 2), w: Math.round(d.w), h: Math.round(d.h), angle: +win.ang.toFixed(3),
        flipped: Math.cos(win.ang) < -0.5, sure: d.sure, tint: d.tint, find: d.score, cells: Math.max(3, Math.round((d.w + (win.ext || 0)) / d.h / 0.68)), lead: lead || undefined, _res: root.TEPLO_DRUM_LOG ? res : undefined };
    });
  }

  function read(file, opts) {
    var t0 = Date.now(), src, lines = [], all = !!(opts && opts.all);
    var drums = [];
    return toCanvas(file).then(function (c) { src = c; return detect(c); }).then(function (boxes) {
      return readBoxes(src, boxes, 0, 0, 1, lines).then(function () {
        // окно барабана водомера (по цвету) — до пяти кандидатов, пока не прочитаем 4+ цифры
        var cands = []; try { cands = findDrums(src); } catch (e) { cands = []; }
        var ch = Promise.resolve();
        cands.forEach(function (d) { ch = ch.then(function () { if (all ? drums.filter(goodDrum).length >= 4 : drums.some(goodDrum)) return null; return readDrum(src, d).then(function (r) { if (r.text) drums.push(r); }); }); });
        return ch;
      }).then(function () {
        if (drums.some(goodDrum)) return null;   // водомер прочитан — приближать нечего
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
      }).then(function () {
        if (drums.some(goodDrum)) return null;
        return lcdPass(src, lines).catch(function () { return null; });   // не вышло — остаётся первый проход
      });
    }).then(function () { var w = src.width, h = src.height; free(src); return { lines: lines, drums: drums, w: w, h: h, ms: Date.now() - t0 }; });
  }

  function _det(file, o) { var src; return toCanvas(file).then(function (c) { src = c; return detect(c, o); }).then(function (b) {
    var ch = Promise.resolve(), out = []; b.forEach(function (x) { if (x.h > x.w * 1.5) return; ch = ch.then(function () { return recognize(src, x, 0.3); }).then(function (r) { out.push(r.text + '@' + Math.round(x.cy) + ':' + x.score.toFixed(2)); }); });
    return ch.then(function () { return out.join(' | '); }); }); }
  function _rec(file, b) { return toCanvas(file).then(function (c) { return Promise.all([recognize(c, b, 0), recognize(c, b, 0.3), recognize(c, b, 0.55)]); }).then(function (r) { return r.map(function (x) { return x.text + '(' + x.score.toFixed(2) + ')'; }).join(' | '); }); }
  function _readDrums(file) { var src, out = []; return toCanvas(file).then(function (c) { src = c; var ch = Promise.resolve(); findDrums(c).slice(0, 2).forEach(function (d) { ch = ch.then(function () { return readDrum(src, d); }).then(function (r) { out.push(r); }); }); return ch; }).then(function () { free(src); return out; }); }
  root.TeploOCR = { _det: _det, _rec: _rec, _readDrums: _readDrums, _drums: function (file) { return toCanvas(file).then(function (c) { var r = findDrums(c); free(c); return r; }); }, load: load, read: read, ready: function () { return !!REC; } };
})(typeof window !== 'undefined' ? window : this);
