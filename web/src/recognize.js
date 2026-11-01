/*
 * Теплосервис — распознавание счётчика и показаний по пачке фото.
 * Прототип на claude.ai: возможность страницы `sample` с картинками (фото уходят Claude только по согласию человека).
 * На своём сервере — тот же промпт через серверный vision-API (см. design/07). Без распознавания всё работает вручную.
 */
(function (root) {
  'use strict';
  var FIELDS = ['energy', 'volume', 'flow', 'power', 'tSupply', 'tReturn', 'hours', 'errHours', 'errCode'];

  /** WebAssembly разрешён? (браузер умеет и политика безопасности страницы — CSP — не запрещает). */
  function canWasm() {
    try { return typeof WebAssembly === 'object' && !!new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); } catch (e) { return false; }
  }
  function cookie(name) { var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; }
  function fail(code) { var e = new Error(code); e.code = code; return e; }
  function httpCode(st) { return st === 401 ? 'not_signed_in' : st === 429 ? 'rate_limited' : st === 415 ? 'image_rejected' : st === 413 ? 'image_rejected' : st === 503 ? 'recognition_off' : st === 504 ? 'timeout' : 'upstream_error'; }

  var V = {
    available: false, limits: null, _sample: null, server: false,

    /** Свой сервер: кнопка «з фото» есть всегда (тестовый режим — фото сохраняются, даже если ключа ещё нет);
     *  распознаёт, если в config.php есть ключ (cfg.recognition); загрузка — только после входа. */
    /** Вошёл ли человек — спрашиваем синхронизацию каждый раз (флаг из initServer мог устареть: /me отвечает позже /config). */
    isIn: function () { return !!(this.loggedIn || (root.TeploSync && root.TeploSync.account)); },
    initServer: function (cfg, loggedIn) {
      this.server = !!root.TEPLO_API; this.loggedIn = !!loggedIn; this.engine = !!(cfg && cfg.recognition);
      // свой распознаватель в браузере (бесплатно, без ключа и без входа); нейросеть на сервере — только если владелец вставил ключ
      this.local = this.server && canWasm();
      this.available = this.server;
      if (this.server) this.limits = { images: { maxCount: 3, mediaTypes: ['image/jpeg', 'image/png', 'image/webp'] } };
    },
    /** Фото — сырым телом (multipart на сервере запрещён), потом пачки по 3 (лимит сервера — 30 с на запрос). */
    _serverRecognize: function (files, ctx, signal, onProgress) {
      var self = this, api = root.TEPLO_API, ids = []; self.lastIds = ids;
      if (!self.isIn()) return Promise.reject(fail('not_signed_in'));
      var post = function (path, body, type) {
        if (!cookie('ts_csrf')) return fetch(api + '/config', { credentials: 'same-origin' }).then(function () { return post(path, body, type); });
        return fetch(api + path, { method: 'POST', body: body, signal: signal, credentials: 'same-origin', headers: { 'Content-Type': type, 'X-CSRF': cookie('ts_csrf'), 'Accept': 'application/json' } })
          .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw fail(httpCode(r.status)); return j; }); });
      };
      var chain = Promise.resolve(), out = { meter: null, photos: [] };
      files.forEach(function (f) {
        chain = chain.then(function () { return self.prepare(f); }).then(function (b) { return post('/recognize/upload', b, b.type || 'image/jpeg'); }).then(function (j) { ids.push(j.id); });
      });
      var n = Math.ceil(files.length / 3);
      return chain.then(function () {
        out.ids = ids.slice();
        var c2 = Promise.resolve();
        for (var i = 0; i < ids.length; i += 3) (function (i) {
          c2 = c2.then(function () {
            if (onProgress) onProgress(i / 3 + 1, n);
            return post('/recognize/run', JSON.stringify({ ids: ids.slice(i, i + 3), offset: i, ctx: { expectedModel: ctx.modelId || '', apartment: ctx.apartment || '', prev: ctx.prev || null, lang: ctx.lang } }), 'application/json');
          }).then(function (j) {
            if (j.meter && (!out.meter || (j.meter.confidence || 0) > (out.meter.confidence || 0))) out.meter = j.meter;
            (j.photos || []).forEach(function (p, k) { if (p) { if (typeof p.index !== 'number') p.index = i + k; out.photos.push(p); } });
          });
        })(i);
        return c2;
      }).then(function () { return out; }, function (e) { if (signal && signal.aborted) throw fail('cancelled'); throw e; });
    },

    /** Подгрузить движок (web/ocr/engine.js + модели ~30 МБ, один раз — дальше из кэша браузера). */
    _engine: function (onPct) {
      var base = String(root.TEPLO_API).replace(/\/api\/?$/, '') + '/web/ocr/';
      var script = root.TeploOCR ? Promise.resolve() : (this._script = this._script || new Promise(function (ok, bad) {
        var s = document.createElement('script'); s.src = base + 'engine.js?v=1'; s.onload = ok; s.onerror = function () { bad(fail('engine_failed')); }; document.head.appendChild(s);
      }));
      return script.then(function () { return root.TeploOCR.load(base, onPct); }).catch(function (e) { if (e && e.code) throw e; throw fail('engine_failed'); });
    },
    /** Распознать в браузере: фото никуда не отправляются ради распознавания (на сервер — только копия для аналитики, если вошли). */
    _localRecognize: function (files, ctx, signal, onProgress) {
      var self = this, api = root.TEPLO_API, P = root.TeploOCRParse, ids = [], results = [];
      var out = { meter: null, photos: [], ids: ids, engine: 'local' };
      var post = function (path, body, type) {
        var go = function () { return fetch(api + path, { method: 'POST', body: body, credentials: 'same-origin', headers: { 'Content-Type': type, 'X-CSRF': cookie('ts_csrf'), 'Accept': 'application/json' } }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw fail(httpCode(r.status)); return j; }); }); };
        return cookie('ts_csrf') ? go() : fetch(api + '/config', { credentials: 'same-origin' }).then(go);
      };
      // копия фото — в аналитику (параллельно с загрузкой движка); ошибки загрузки не мешают распознаванию
      var uploads = Promise.resolve();
      if (self.isIn()) files.forEach(function (f) { uploads = uploads.then(function () { return self.prepare(f); }).then(function (b) { return post('/recognize/upload', b, b.type || 'image/jpeg'); }).then(function (j) { ids.push(j.id); }, function () { /* без копии */ }); });
      var cancelled = function () { if (signal && signal.aborted) throw fail('cancelled'); };
      return this._engine(function (p) { if (onProgress) onProgress(Math.round(p * 100), 100, 'load'); }).then(function () {
        var chain = Promise.resolve();
        files.forEach(function (f, i) {
          chain = chain.then(function () { cancelled(); if (onProgress) onProgress(i + 1, files.length, 'photo'); return root.TeploOCR.read(f); }).then(function (res) {
            var r = P.photo(res, ctx, i);
            out.photos.push(r.photo); results.push({ photo: r.photo, meter: r.meter, ms: res.ms, ocr: res.lines.slice(0, 80).map(function (l) { return { t: l.text.slice(0, 80), a: l.alts ? l.alts.map(function (x) { return x.slice(0, 40); }) : undefined, s: l.score, h: l.h }; }) });
            if (r.meter && (!out.meter || (r.meter.confidence || 0) > (out.meter.confidence || 0) || (!out.meter.energyUnit && r.meter.energyUnit))) out.meter = Object.assign({}, out.meter || {}, r.meter, { energyUnit: r.meter.energyUnit || (out.meter && out.meter.energyUnit) || null });
          });
        });
        return chain;
      }).then(function () {
        cancelled();
        if (self.isIn()) uploads.then(function () { if (ids.length) post('/recognize/local', JSON.stringify({ ids: ids, results: results }), 'application/json').catch(function () {}); });
        return out;
      }, function (e) { if (signal && signal.aborted) throw fail('cancelled'); throw e; });
    },

    /** Итог для аналитики: что не нашлось, где разные цифры, что человек исправил. Ошибки молча игнорируем. */
    report: function (data) {
      if (!this.server || !this.isIn() || !root.TEPLO_API) return;
      try {
        fetch(root.TEPLO_API + '/recognize/report', { method: 'POST', credentials: 'same-origin', body: JSON.stringify(data),
          headers: { 'Content-Type': 'application/json', 'X-CSRF': cookie('ts_csrf'), 'Accept': 'application/json' } }).catch(function () {});
      } catch (e) { /* нет */ }
    },

    init: function (onChange) {
      var self = this;
      if (!(root.claude && typeof root.claude.use === 'function')) return Promise.resolve(false);
      return root.claude.use('sample').then(function (s) {
        if (!s || typeof s.limits !== 'function') return false;
        self._sample = s;
        return s.limits().then(function (l) { self.limits = l; self.available = !!(l && l.images); if (onChange) onChange(); return self.available; });
      }).catch(function () { return false; });
    },

    /** Уменьшить фото до ~2000 px по длинной стороне (цифры экрана остаются читаемыми), JPEG. */
    prepare: function (file) {
      var max = 2000;
      var load = typeof createImageBitmap === 'function'
        ? createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(file); })
        : new Promise(function (ok, bad) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = bad; i.src = URL.createObjectURL(file); });
      return load.then(function (img) {
        var w = img.width, h = img.height, k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        return new Promise(function (ok) { c.toBlob(function (b) { ok(b || file); }, 'image/jpeg', 0.9); });
      }).catch(function () { return file; });
    },

    prompt: function (ctx, offset, count) {
      var catalog = ctx.models.map(function (m) { return m.id + ' — ' + (m.vendor && m.vendor !== '—' ? m.vendor + ' ' : '') + m.name; }).join('; ');
      var order = (ctx.steps || []).map(function (s, i) { return (i + 1) + ') ' + s.fields.join(' + ') + (s.lcd && s.lcd.tag ? ' [label ' + s.lcd.tag + (s.lcd.alt ? '/' + s.lcd.alt.tag : '') + ']' : ''); }).join('; ');
      return [
        'You read photos of an apartment heat meter in Kharkiv, Ukraine, to fill a form for the city heating company. Accuracy matters more than completeness.',
        'There are ' + count + ' photo(s), in the order given; report "index" counting from ' + offset + '.',
        'A photo may be: a close-up of the LCD screen (usually ONE value per photo, the person pressed the button between photos), the nameplate/label, or a wide shot of the meter (possibly with several meters).',
        'Known models (id — name): ' + catalog + '. Use "other" if it is a heat meter not in the list, null if you cannot tell.',
        ctx.expectedModel ? 'The person says their meter is: ' + ctx.expectedModel + '. If a photo shows several meters, read the one matching this model (or the apartment sticker ' + (ctx.apartment || '?') + ') and say so in "note".' : 'The model is not known yet — identify it from the nameplate or the look of the meter.',
        order ? 'For this model the screens usually come in this order: ' + order + '. Use it only to tell unlabeled screens apart.' : '',
        'Fields: energy = accumulated heat energy (unit Gcal / MWh / GJ / kWh as shown; Sharky shows "Gcal"); volume = accumulated water volume, m³ (Sharky: "m³" in the top right corner); flow = instantaneous flow, m³/h; power = instantaneous power, kW; tSupply = supply temperature °C (labels "ht", "T1", arrow up — the hotter one); tReturn = return temperature °C ("ct", "T2", arrow down); hours = operating hours ("On", "h"); errHours = hours with error ("Eh", "Err h"); errCode = error code ("E-" or "E---" with no digits means no error → "E---").',
        'Rules: copy the digits EXACTLY as displayed, with "." as the decimal separator and leading zeros removed ("00015.482" → "15.482"). Never invent, estimate or calculate a value, never copy it from anywhere but the photo. If a digit is unclear, give your best reading with confidence below 0.6 and explain in "note". Report every field you can see on each photo (a screen may show two values at once).',
        ctx.prev ? 'For sanity only (do NOT copy): the previous accepted values were ' + JSON.stringify(ctx.prev) + ' — accumulated values should be equal or higher.' : '',
        'Write "note" in ' + (ctx.lang === 'ru' ? 'Russian' : 'Ukrainian') + ', at most one short sentence, only when there is a problem.',
        'Reply with only JSON of this shape:',
        '{"meter":{"modelId":"sharky774"|null,"modelText":"as printed"|null,"serial":"…"|null,"apartment":"61"|null,"energyUnit":"Gcal"|"MWh"|"GJ"|"kWh"|null,"confidence":0.0},',
        ' "photos":[{"index":' + offset + ',"kind":"screen"|"nameplate"|"overview"|"other","readings":[{"field":"energy","value":"15.482","unit":"Gcal","label":"Gcal","confidence":0.95}],"quality":"ok"|"blurry"|"glare"|"too_far"|"cut_off"|"dark","note":""}]}'
      ].filter(Boolean).join('\n');
    },

    /** files: File[]; ctx: {models, steps, expectedModel, apartment, prev, lang}; signal: AbortSignal */
    recognize: function (files, ctx, signal, onProgress) {
      if (this.server && this.engine && this.isIn()) return this._serverRecognize(files, ctx, signal, onProgress);
      if (this.local) return this._localRecognize(files, ctx, signal, onProgress);
      if (this.server) return this._serverRecognize(files, ctx, signal, onProgress);
      var self = this, max = (this.limits && this.limits.images && this.limits.images.maxCount) || 10;
      var batches = []; for (var i = 0; i < files.length; i += max) batches.push(files.slice(i, i + max));
      var out = { meter: null, photos: [] }, offset = 0;
      var chain = Promise.resolve();
      batches.forEach(function (batch, bi) {
        var off = offset; offset += batch.length;
        chain = chain.then(function () {
          if (onProgress) onProgress(bi + 1, batches.length);
          return Promise.all(batch.map(function (f) { return self.prepare(f); }));
        }).then(function (blobs) {
          return self._sample.json(self.prompt(ctx, off, blobs.length), { images: blobs, modelTier: 'default', signal: signal });
        }).then(function (j) {
          if (!j || typeof j !== 'object') return;
          if (j.meter && (!out.meter || (j.meter.confidence || 0) > (out.meter.confidence || 0))) out.meter = j.meter;
          (j.photos || []).forEach(function (p, k) { if (p) { if (typeof p.index !== 'number') p.index = off + k; out.photos.push(p); } });
        });
      });
      return chain.then(function () { return out; });
    },

    /** Свести распознанное в поля: лучшее по уверенности, расхождения — флаг conflict. */
    pick: function (res, toGcal, meterUnit) {
      var best = {};
      (res.photos || []).forEach(function (p) {
        (p.readings || []).forEach(function (r) {
          if (!r || FIELDS.indexOf(r.field) < 0 || r.value == null || r.value === '') return;
          var v = String(r.value).trim().replace(',', '.');
          if (r.field === 'energy' && r.unit && meterUnit && toGcal[r.unit] && toGcal[meterUnit] && r.unit !== meterUnit) {
            var n = parseFloat(v); if (isFinite(n)) { v = String(+(n * toGcal[r.unit] / toGcal[meterUnit]).toFixed(4)); r.converted = r.unit + '→' + meterUnit; }
          }
          var c = typeof r.confidence === 'number' ? r.confidence : 0.5, cur = best[r.field];
          if (!cur) best[r.field] = { value: v, confidence: c, photo: p.index, unit: r.unit || '', converted: r.converted || '' };
          else {
            if (cur.value !== v) cur.conflict = true;
            if (c > cur.confidence) { var keep = cur.conflict; best[r.field] = { value: v, confidence: c, photo: p.index, unit: r.unit || '', converted: r.converted || '', conflict: keep }; }
          }
        });
      });
      if (best.errCode && /^E[-–—\s]*$/i.test(best.errCode.value)) best.errCode.value = 'E---';
      return best;
    }
  };
  V.FIELDS = FIELDS;
  if (typeof module !== 'undefined' && module.exports) module.exports = V; else root.TeploVision = V;
})(typeof window !== 'undefined' ? window : this);
