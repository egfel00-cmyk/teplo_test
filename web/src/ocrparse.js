/*
 * Теплосервис — из распознанного текста (TeploOCR, в браузере) в поля формы ХТМ.
 * Вход: строки с фото [{text, alts?, score, x, y, w, h}] + контекст {modelId, steps, prev}.
 * Выход в формате, который понимает остальной код (как ответ нейросети):
 *   photo: {index, kind, readings:[{field, value, unit, label, confidence}], quality, note, meterType}
 *   meter: {modelId, modelText, serial, energyUnit, confidence}
 * Чего не знаем — не выдумываем: поле без подписи на экране получает низкую уверенность (человек проверит).
 */
(function (root) {
  'use strict';

  var MODELS = [
    ['sharky774', /SHARKY\s*7\s*7\s*4|SHARKY774/i], ['sharky775', /SHARKY\s*7\s*7\s*5|SONOMETER/i],
    ['t330', /T\s?3\s?3\s?0|UH\s?30|ULTRAHEAT\s*T?3/i], ['t230', /T\s?2\s?3\s?0|UH\s?50/i], ['t330', /ULTRAHEAT/i],
    ['multical302', /MULTICAL|KAMSTRUP/i], ['elf', /\bELF\b|LQM/i], ['sensostar', /SENSO\s*STAR/i],
    ['nik7071', /7\s?0\s?7\s?1|НІК|HIK\s*7/i], ['trust', /\bTRUST\b/i], ['sharky774', /SHARKY/i]
  ];
  // не тепло: сильные признаки других счётчиков
  var OTHER = {
    electric: [/imp\s*\/?\s*\(?\s*k\s*W/i, /6205[23]/, /\b2[23]0\s*V\b/i, /\b50\s*Hz\b/i, /\d\(\d{2,3}\)\s*A/i, /ЕНЕРГО|ENERGOMERA|EHEPr|NIK\s*22|НІК\s*22|ГАММА|GAMA\s*100/i, /k\s*var/i],
    water: [/[xх×]\s*0[.,]0{2,3}1/i, /\bMPa\b|МПа/i, /NOVATOR|НОВАТОР|ЛК-?\s?1|LK-?\s?1|SENSUS|ZENNER|APATOR\s*JS|POWOGAZ/i, /\bQ\s*[n3]\b|Q[n,]\s*\d/i, /\bR\s?(80|100|160)\b/],
    gas: [/\bG\s?(1[.,]6|2[.,]5|4|6|10)\b/, /Q\s*max|Q\s*min|P\s*max/i, /\bkPa\b|кПа/i, /BK-?\s?G|METRIX|ELSTER|GALLUS|САМГАЗ|SAMGAZ|ОКТАВА|OKTAVA|\bGAS\b|ГАЗ/i]
  };
  var HEAT = /G\s?cal|G\s?kal|Гкал|\bGJ\b|MWh|SHARKY|ULTRAHEAT|MULTICAL|SENSOSTAR|\bELF\b|TRUST|SONOMETER|тепл|ТЕПЛ|\bHT\b|\bCT\b/i;

  // подписи на экране → поле
  var TAGS = [
    { re: /^(G\s?cal|G\s?kal|Gca1|Гкал)$/i, field: 'energy', unit: 'Gcal', w: 3 }, { re: /^MW\s?h$/i, field: 'energy', unit: 'MWh', w: 3 },
    { re: /^GJ$/i, field: 'energy', unit: 'GJ', w: 3 }, { re: /^kW\s?h$/i, field: 'energy', unit: 'kWh', w: 3 },
    { re: /^m\s?[3³]\s?\/\s?h$/i, field: 'flow', unit: 'm³/h', w: 3 }, { re: /^k\s?W$/i, field: 'power', unit: 'kW', w: 3 },
    { re: /^m\s?[3³]$/i, field: 'volume', unit: 'm³', w: 3 },
    { re: /^(HT|T1|T\s?1)$/i, field: 'tSupply', unit: '°C', w: 4 }, { re: /^(CT|T2|T\s?2)$/i, field: 'tReturn', unit: '°C', w: 4 },
    { re: /^(ON|0N|On\s?h)$/i, field: 'hours', unit: 'h', w: 4 }, { re: /^(EH|E\s?h|Err\s?h|ERR\s?H)$/i, field: 'errHours', unit: 'h', w: 4 },
    { re: /^(°\s?C|℃|C|°)$/i, field: 'temp', unit: '°C', w: 1 }, { re: /^h$/i, field: 'hours', unit: 'h', w: 1 }
  ];
  var DEC = { energy: 3, volume: 3, flow: 3, power: 3, tSupply: 2, tReturn: 2, hours: 0, errHours: 0 };

  function digitsOf(s) { return String(s || '').replace(/[^0-9]/g, ''); }
  /** «00015 482» → «00015.482» по позиции точки; «0O1S.4B2» → цифры (похожие буквы — в цифры, только внутри числа) */
  function cleanNum(s) {
    s = String(s || '').replace(/,/g, '.').replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
    var m = s.match(/[0-9][0-9 .]*[0-9]|[0-9]/); if (!m) return null;
    var t = m[0].replace(/\s+/g, '').replace(/\.{2,}/g, '.');
    if ((t.match(/\./g) || []).length > 1) t = t.replace(/\.(?=.*\.)/g, '');
    return t;
  }
  function isNumLine(s) { var d = digitsOf(s).length, all = String(s).replace(/\s/g, '').length; return d >= 1 && d >= all * 0.6; }
  function stripZeros(v) { if (v.indexOf('.') >= 0) { v = v.replace(/^0+(?=\d)/, ''); return v; } return v.replace(/^0+(?=\d)/, ''); }

  /** Цифры — большинством среди вариантов (обычный и «без теней»); точка — где её увидел хоть один вариант с тем же числом цифр. */
  function bestValue(line) {
    var vars = [line.text].concat(line.alts || []).map(cleanNum).filter(Boolean);
    if (!vars.length) return null;
    var enh = (line.alts || []).map(cleanNum).filter(Boolean), pool = enh.length ? enh : vars, cnt = {};
    pool.forEach(function (v) { var d = digitsOf(v); cnt[d] = (cnt[d] || 0) + 1; });
    var digits = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a] || b.length - a.length; })[0];
    var dot = null;
    vars.forEach(function (v) { if (dot === null && v.indexOf('.') > 0 && digitsOf(v).length === digits.length) dot = v.length - v.indexOf('.') - 1; });
    return { digits: digits, dot: dot, agree: cnt[digits] / pool.length };
  }

  function placeDot(digits, n) { if (!n || n >= digits.length) return digits; return digits.slice(0, digits.length - n) + '.' + digits.slice(digits.length - n); }

  /** Десятичная точка, если её не видно: по формату экрана модели, иначе — чтобы число было рядом с прошлым принятым. */
  function inferDot(digits, field, ctx) {
    var st = (ctx.steps || []).filter(function (s) { return s.fields.indexOf(field) >= 0; })[0], fmt = st && st.lcd ? (field === st.fields[1] && st.lcd.alt ? st.lcd.alt.digits : st.lcd.digits) : '';
    if (fmt && /^[0-9.]+$/.test(fmt)) { var n = fmt.indexOf('.') < 0 ? 0 : fmt.length - fmt.indexOf('.') - 1; return { v: placeDot(digits, n), how: 'model' }; }
    var prev = ctx.prev && parseFloat(ctx.prev[field]);
    if (prev > 0) {
      var best = null;
      for (var k = 0; k <= 4; k++) { var x = parseFloat(placeDot(digits, k)); var r = x / prev; if (r >= 0.98 && r < 3 && (!best || Math.abs(r - 1) < best.d)) best = { k: k, d: Math.abs(r - 1) }; }
      if (best) return { v: placeDot(digits, best.k), how: 'prev' };
    }
    if (DEC[field] === 0) return { v: digits, how: 'int' };
    return { v: digits, how: 'none' };
  }

  function dist(a, b) {
    var ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
    return Math.hypot((ax - bx) / Math.max(a.w, 1), (ay - by) / Math.max(a.h, 1));
  }

  function meterType(all) {
    if (HEAT.test(all)) return 'heat';
    var best = null, bestN = 0;
    Object.keys(OTHER).forEach(function (k) { var n = OTHER[k].filter(function (re) { return re.test(all); }).length; if (n > bestN) { bestN = n; best = k; } });
    return bestN ? best : null;
  }

  /** Одно фото. */
  function photo(res, ctx, index) {
    ctx = ctx || {};
    var lines = (res && res.lines) || [], all = lines.map(function (l) { return [l.text].concat(l.alts || []).join(' '); }).join('\n');
    var out = { index: index, kind: 'other', readings: [], quality: 'ok', note: '', meterType: meterType(all) }, meter = null;
    if (!lines.length) { out.quality = 'blurry'; return { photo: out, meter: null }; }

    // модель и номер с наклейки
    for (var i = 0; i < MODELS.length; i++) {
      var mm = all.match(MODELS[i][1]);
      if (mm) { meter = { modelId: MODELS[i][0], modelText: mm[0], serial: null, apartment: null, energyUnit: null, confidence: 0.8 }; break; }
    }
    var sn = all.match(/(?:S\/?N|SN|Ser\.?\s?No|Serial|N[o°º]|№|Nr)\.?[:\s]*([0-9]{6,12})/i);
    if (sn) { meter = meter || { modelId: null, modelText: null, serial: null, apartment: null, energyUnit: null, confidence: 0.4 }; meter.serial = sn[1]; }
    var kv = all.match(/(?:кв|kv)\.?\s*([0-9]{1,4})\b/i); if (kv && meter) meter.apartment = kv[1];

    if (out.meterType && out.meterType !== 'heat') { out.kind = 'other'; return { photo: out, meter: null }; }

    // главное число экрана — самая высокая строка из цифр (код ошибки «E- - -» — тоже)
    var nums = lines.filter(function (l) { return isNumLine(l.text) || (l.alts || []).some(isNumLine) || /^E[\s\-–—_0-9]*$/i.test(l.text); });
    var maxH = Math.max.apply(null, nums.map(function (l) { return l.h; }).concat([0]));
    var mains = nums.filter(function (l) { return l.h >= maxH * 0.75 && l.h >= res.h * 0.012; });
    var tags = [];
    lines.forEach(function (l) {
      [l.text].concat(l.alts || []).some(function (tx) {
        tx = String(tx).trim();
        for (var j = 0; j < TAGS.length; j++) if (TAGS[j].re.test(tx)) { tags.push({ line: l, tag: TAGS[j] }); return true; }
        // «56.57 °C», «1.067 m3/h» в одной строке
        var tail = tx.replace(/^[0-9 .,]+/, '').trim();
        if (tail && tail !== tx) for (j = 0; j < TAGS.length; j++) if (TAGS[j].re.test(tail)) { tags.push({ line: l, tag: TAGS[j], same: true }); return true; }
        return false;
      });
    });

    mains.forEach(function (l) {
      var txt = (l.alts && l.alts.length ? l.alts[0] : l.text).replace(/\s/g, '');
      if (/^E[\-–—_]*$/i.test(txt) || /^E[\-–—_]+$/i.test(l.text.replace(/\s/g, ''))) {
        out.readings.push({ field: 'errCode', value: 'E---', unit: '', label: 'E-', confidence: +(0.85 * l.score).toFixed(2) }); return;
      }
      var mE = txt.match(/^E[\-–—_]?(\d{1,4})$/i);
      if (mE) { out.readings.push({ field: 'errCode', value: 'E' + mE[1], unit: '', label: 'E', confidence: +(0.7 * l.score).toFixed(2) }); return; }
      var bv = bestValue(l); if (!bv || !bv.digits) return;
      // подпись рядом: специфичные (HT/CT/ON/EH) важнее общих (°C, h)
      var near = tags.filter(function (t) { return t.line === l || dist(l, t.line) < 6; })
        .sort(function (a, b) { return b.tag.w - a.tag.w || dist(l, a.line) - dist(l, b.line); });
      var field = null, unit = '', label = '', how = 'tag', conf = l.score * (0.75 + 0.25 * bv.agree);
      if (near.length) {
        field = near[0].tag.field; unit = near[0].tag.unit; label = near[0].line.text;
        if (field === 'temp') {
          var spec = near.filter(function (t) { return t.tag.field === 'tSupply' || t.tag.field === 'tReturn'; })[0];
          field = spec ? spec.tag.field : null;
        }
      }
      var val = bv.dot !== null ? placeDot(bv.digits, bv.dot) : null;
      if (!field) {
        // подписи нет: сравнить с прошлыми принятыми (накопленные значения растут)
        var p = ctx.prev || {}, cand = ['energy', 'volume', 'hours'].filter(function (f) { return parseFloat(p[f]) > 0; });
        for (var c = 0; c < cand.length && !field; c++) {
          var guess = val || inferDot(bv.digits, cand[c], ctx).v, x = parseFloat(guess), pv = parseFloat(p[cand[c]]);
          if (x >= pv * 0.999 && x <= pv * 1.6 + 50) { field = cand[c]; val = guess; how = 'prev'; }
        }
        if (!field) {
          if (val === null && bv.digits.length >= 4) { field = 'hours'; how = 'guess'; }
          else if (val && (val.split('.')[1] || '').length === 3) { field = 'energy'; how = 'guess'; }
          else if (val && (val.split('.')[1] || '').length === 2 && parseFloat(val) < 150) { field = null; }
        }
        if (!field) { out.note = out.note || 'unlabeled'; return; }
      }
      if (DEC[field] === 0) val = bv.digits;   // часы — целые: «точка» на них — это тень сегмента
      if (val === null) { var inf = inferDot(bv.digits, field, ctx); val = inf.v; if (inf.how === 'none' && DEC[field]) { conf *= 0.6; out.note = out.note || 'no_dot'; } else if (inf.how !== 'int') conf *= 0.9; }
      if (how === 'prev') conf *= 0.8; if (how === 'guess') conf *= 0.5;
      if (field === 'energy' && unit) { meter = meter || { modelId: null, modelText: null, serial: null, apartment: null, energyUnit: null, confidence: 0.3 }; meter.energyUnit = unit; }
      out.readings.push({ field: field, value: stripZeros(val), unit: unit, label: label, confidence: +Math.min(0.97, conf).toFixed(2) });
    });
    if (out.readings.length) out.kind = 'screen';
    else if (meter && meter.modelId) out.kind = 'nameplate';
    if (!out.readings.length && !meter && !nums.length) out.quality = 'too_far';
    return { photo: out, meter: meter };
  }

  var api = { photo: photo, meterType: meterType, cleanNum: cleanNum, inferDot: inferDot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TeploOCRParse = api;
})(typeof window !== 'undefined' ? window : this);
