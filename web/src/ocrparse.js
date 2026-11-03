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
    electric: [/imp\s*\/?\s*\(?\s*k\s*W/i, /6205[23]/, /\b2[23]0\s*V\b/i, /\b50\s*Hz\b/i, /\d\(\d{2,3}\)\s*A/i, /ЕНЕРГО|ENERGOMERA|EHEPr|NIK\s*22|НІК\s*22|ГАММА|GAMA\s*100/i, /k\s*var/i,
      /\b[NHН][IІ1][KК]\s*-?\s*2[0-9]{3}/i],   // НІК 2102-02.М2 (движок читает «HIK2102»)
    water: [/[xх×]\s*0[.,]0{2,3}1/i, /\bMPa\b|МПа/i, /NOVATOR|НОВАТОР|ЛК-?\s?1|LK-?\s?1|SENSUS|ZENNER|APATOR\s*JS|POWOGAZ/i, /\bQ\s*[n3]\b|Q[n,]\s*\d/i, /\bR\s?(80|100|160)\b/],
    gas: [/\bG\s?(1[.,]6|2[.,]5|4|6|10)\b/, /Q\s*max|Q\s*min|P\s*max/i, /\bkPa\b|кПа/i, /BK-?\s?G|METRIX|ELSTER|GALLUS|САМГАЗ|SAMGAZ|ОКТАВА|OKTAVA|\bGAS\b|ГАЗ/i]
  };
  var HEAT = /G\s?cal|G\s?kal|Гкал|\bGJ\b|MWh|SHARKY|ULTRAHEAT|MULTICAL|SENSOSTAR|\bELF\b|TRUST|SONOMETER|тепл|ТЕПЛ|\bHT\b|\bCT\b/i;
  // «HT»/«CT» (подача/обратка на табло) — слабая примета: «ДСТУ» на корпусе электросчётчика движок читает «CT/», «CTY»
  var HEAT_STRONG = /G\s?cal|G\s?kal|Гкал|\bGJ\b|MWh|SHARKY|ULTRAHEAT|MULTICAL|SENSOSTAR|\bELF\b|TRUST|SONOMETER|тепл|ТЕПЛ/i;
  /** Теплосчётчик на фото: сильные приметы — всегда; одни «HT»/«CT» — только если примет света меньше трёх. */
  function isHeat(all) { if (HEAT_STRONG.test(all)) return true; if (!HEAT.test(all)) return false; return OTHER.electric.filter(function (re) { return re.test(all); }).length < 3; }

  // подписи на экране → поле
  var TAGS = [
    { re: /^(G\s?cal|G\s?kal|Gca1|Гкал)$/i, field: 'energy', unit: 'Gcal', w: 3 }, { re: /^MW\s?h$/i, field: 'energy', unit: 'MWh', w: 3 },
    { re: /^GJ$/i, field: 'energy', unit: 'GJ', w: 3 }, { re: /^kW\s?h$/i, field: 'energy', unit: 'kWh', w: 3 },
    { re: /^m\s?[3³]\s?\/\s?h$/i, field: 'flow', unit: 'm³/h', w: 3 }, { re: /^k\s?W$/i, field: 'power', unit: 'kW', w: 3 },
    // «m³» отдельно: объём, но у Sharky расход — «m³» столбиком над «h» (решается ниже по «h» рядом); «m)», «mi» — тот же значок
    { re: /^m\s?[3³]$/i, field: 'm', unit: 'm³', w: 3, cube: true },
    // подписи семисегментным шрифтом распознаются «похоже»: ht → be/bt/nt, ct → ce/cE, On → 0n/Dn, dt → de/BE (перепад — в форму не идёт)
    { re: /^(HT|T1|T\s?1|[hbn][tEe]|6e|b[e])$/, field: 'tSupply', unit: '°C', w: 4 }, { re: /^(HT|T1)$/i, field: 'tSupply', unit: '°C', w: 4 },
    { re: /^(CT|T2|T\s?2|c[tE]|C[t])$/, field: 'tReturn', unit: '°C', w: 4 }, { re: /^(CT|T2)$/i, field: 'tReturn', unit: '°C', w: 4 },
    { re: /^(dt|dE|de|BE|dT|d七)$/, field: 'dT', unit: '°C', w: 5 },
    { re: /^(ON|0N|On\s?h|0n|Dn|On)$/i, field: 'hours', unit: 'h', w: 4 }, { re: /^(EH|E\s?h|Err\s?h|ERR\s?H)$/i, field: 'errHours', unit: 'h', w: 4 },
    { re: /^(m\s?[)'’iIl|]?|n[iIl)'’])$/, field: 'm', unit: 'm³', w: 2 },
    { re: /^(°\s?C|℃|C|°)$/i, field: 'temp', unit: '°C', w: 1 }, { re: /^h$/i, field: 'hours', unit: 'h', w: 1 }
  ];
  var DEC = { energy: 3, volume: 3, flow: 3, power: 3, tSupply: 2, tReturn: 2, hours: 0, errHours: 0 };

  function digitsOf(s) { return String(s || '').replace(/[^0-9]/g, ''); }

  /**
   * Экран кода ошибки. Sharky: «E-------» (E и прочерки во всю строку) — ошибок нет; «E-3», «E - 9», «C-1» — код.
   * Движок (китайско-английская модель) пишет прочерки чем попало: «—», «－», «一», «_»; «E» — полноширинной «Ｅ»,
   * а без подавления «теней» сегментов прочерки становятся восьмёрками («E8888888», «883») — поэтому смотрим все варианты.
   * → { code: 'E---' | 'E-3' | 'C-1', sure } или null.
   */
  var DASH = /[\-‐‑‒–—―−─━一ー－﹣_~]/g;
  function errOf(tx) {
    var s = String(tx || ''); if (s.normalize) s = s.normalize('NFKC');
    s = s.replace(/\s+/g, '').replace(DASH, '-');
    var m;
    if (/^E-+$/i.test(s)) return { code: 'E---', sure: true };
    if (s === 'E') return { code: 'E---', sure: false };   // прочерки не прочитались
    if (/^[8B]?-{4,}$/.test(s)) return { code: 'E---', sure: false };   // «E» не прочиталась или стала восьмёркой
    if ((m = s.match(/^([EC])-*([0-9A-F])$/i)) && (s.indexOf('-') > 0 || /^E/i.test(s))) return { code: m[1].toUpperCase() + '-' + m[2].toUpperCase(), sure: s.indexOf('-') > 0 };
    if ((m = s.match(/^([EC])(-+[0-9A-F]-*|-*[0-9A-F]-+)$/i)) && s.length >= 5) return { code: m[1].toUpperCase() + '-' + m[2].replace(/-/g, '').toUpperCase(), sure: false };   // «E----3--»
    return null;
  }
  /** Код ошибки строки: сначала варианты без «теней» (alts), потом как есть; большинство среди вариантов. */
  function errLine(l) {
    var vars = (l.alts || []).concat([l.text]), got = vars.map(errOf), cnt = {}, best = null;
    got.forEach(function (e, i) { if (!e) return; var k = e.code; cnt[k] = (cnt[k] || 0) + (i < vars.length - 1 ? 2 : 1) + (e.sure ? 1 : 0); if (!best || cnt[k] > cnt[best.code]) best = e; });
    if (!best) return null;
    return { code: best.code, sure: got.some(function (e) { return e && e.code === best.code && e.sure; }) };
  }
  /** «00015 482» → «00015.482» по позиции точки; «0O1S.4B2» → цифры (похожие буквы — в цифры, только внутри числа) */
  // подпись в начале строки числа: «0n 41704», «ht 13.50» (семисегментные буквы)
  var LEAD = /^\s*([0ODo][nN]|[hbn][tEe]|6e|be|c[tE]|Ct|d[teE]|BE|E\s?h|HT|CT)\s+(?=[0-9OoIl])/;
  function cleanNum(s) {
    s = String(s || '').replace(LEAD, '').replace(/(\d)\s*:\s*(\d)/g, '$1.$2').replace(/,/g, '.').replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
    var m = s.match(/[0-9][0-9 .]*[0-9]|[0-9]/); if (!m) return null;
    var t = m[0].replace(/\s+/g, '').replace(/\.{2,}/g, '.');
    if ((t.match(/\./g) || []).length > 1) t = t.replace(/\.(?=.*\.)/g, '');
    return t;
  }
  function isNumLine(s) { var d = digitsOf(s).length, all = String(s).replace(/\s/g, '').length; return d >= 1 && d >= all * 0.6; }
  function stripZeros(v) { if (v.indexOf('.') >= 0) { v = v.replace(/^0+(?=\d)/, ''); return v; } return v.replace(/^0+(?=\d)/, ''); }

  /** Цифры — большинством среди вариантов (обычный и «без теней»); точка — где её увидел хоть один вариант с тем же числом цифр. */
  function bestValue(line) {
    var raw = [line.text].concat(line.alts || []), lead = null;
    raw.forEach(function (v) { var m = String(v || '').match(LEAD); if (m && !lead) lead = m[1].replace(/\s/g, ''); });
    var vars = raw.map(cleanNum).filter(Boolean);
    if (!vars.length) return null;
    var enh = (line.alts || []).map(cleanNum).filter(Boolean), pool = enh.length ? enh : vars, cnt = {};
    pool.forEach(function (v) { var d = digitsOf(v); cnt[d] = (cnt[d] || 0) + 1; });
    var digits = Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a] || b.length - a.length; })[0];
    var dot = null;
    vars.forEach(function (v) { if (dot === null && v.indexOf('.') > 0 && digitsOf(v).length === digits.length) dot = v.length - v.indexOf('.') - 1; });
    return { digits: digits, dot: dot, agree: cnt[digits] / pool.length, lead: lead };
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
    if (DEC[field] && digits.length > DEC[field]) return { v: placeDot(digits, DEC[field]), how: 'dec' };   // типичное число знаков для поля
    return { v: digits, how: 'none' };
  }

  function dist(a, b) {
    var ax = a.x + a.w / 2, ay = a.y + a.h / 2, bx = b.x + b.w / 2, by = b.y + b.h / 2;
    return Math.hypot((ax - bx) / Math.max(a.w, 1), (ay - by) / Math.max(a.h, 1));
  }

  /** Сколько примет каждого вида на фото: {heat: bool, electric: n, water: n, gas: n}. */
  function meterScores(all) {
    var o = { heat: isHeat(all) };
    Object.keys(OTHER).forEach(function (k) { o[k] = OTHER[k].filter(function (re) { return re.test(all); }).length; });
    return o;
  }
  function meterType(all) {
    if (isHeat(all)) return 'heat';
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
    // знаки поверки на корпусе («M23», «M 17») — не показания
    lines = lines.filter(function (l) { return !/^M\s?\d{2}$/.test(String(l.text).trim()); });
    var errs = lines.map(errLine), errAt = function (l) { var i = lines.indexOf(l); return i < 0 ? null : errs[i]; };   // строки не трогаем — они уходят в /admin
    var nums = lines.filter(function (l) { return isNumLine(l.text) || (l.alts || []).some(isNumLine) || errAt(l); });
    var maxH = Math.max.apply(null, nums.map(function (l) { return l.h; }).concat([0]));
    var mains = nums.filter(function (l) { return l.h >= maxH * 0.75 && l.h >= res.h * 0.012; });
    // экран кода ошибки: прочерки и «E» бывают разными строками, а осколки прочерков читаются цифрами («一1» → «11») —
    // если среди крупных строк есть уверенный код ошибки, остальные крупные строки — не показания
    var errMain = mains.filter(function (l) { return errAt(l) && errAt(l).sure; })[0];
    if (errMain) mains = mains.filter(function (l) { return errAt(l) || !(digitsOf(l.text).length <= 3 && Math.abs(l.y + l.h / 2 - errMain.y - errMain.h / 2) < errMain.h); });
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

    // тест экрана (горят все сегменты): строка «88888888» часто читается кусками «881», «88» — если все крупные числа из одних восьмёрок
    // («E-------» без подавления теней — тоже «88888888», но варианты видят прочерки: это не тест)
    var noErr = mains.filter(function (l) { return !errAt(l); });
    var all8 = noErr.map(function (l) { return digitsOf(l.text); }).join(''), n8 = (all8.match(/8/g) || []).length;
    var e8 = noErr.map(function (l) { return [l.text].concat(l.alts || []).map(function (x) { return digitsOf(x); }).filter(function (d) { return /^8{2,}1?$/.test(d); })[0] || ''; }).filter(Boolean);
    if ((e8.length >= 2 && e8.join('').length >= 5) || (noErr.length >= 2 && n8 >= 3 && all8.length >= 4 && n8 >= all8.length * 0.6)) { out.note = 'test_screen'; mains = []; out.anchor = -1; }
    // осколок с кнопки или рамки («7» под наклоном) рядом с настоящим числом экрана — не показание (тест экрана уже разобран)
    if (mains.some(function (l) { return digitsOf(l.text).length >= 3; })) mains = mains.filter(function (l) { return errAt(l) || digitsOf(l.text).length >= 3 || (l.alts || []).some(function (a) { return digitsOf(a).length >= 3; }); });
    var errDone = false;
    mains.forEach(function (l) {
      var er = errAt(l);
      if (er) {
        if (errDone) return; errDone = true;
        var none = er.code === 'E---';
        out.readings.push({ field: 'errCode', value: er.code, unit: '', label: none ? 'E-' : 'E', confidence: +((er.sure ? (none ? 0.85 : 0.75) : 0.55) * l.score).toFixed(2), how: er.sure ? 'tag' : 'guess' });
        return;
      }
      var bv = bestValue(l); if (!bv || !bv.digits) return;
      if (/^8{6,}$/.test(bv.digits)) { out.note = out.note || 'test_screen'; return; }   // тест экрана: горят все сегменты
      if (bv.lead) for (var tl = 0; tl < TAGS.length; tl++) if (TAGS[tl].re.test(bv.lead)) { tags.push({ line: l, tag: TAGS[tl], lead: true }); break; }
      // подпись рядом: специфичные (HT/CT/ON/EH) важнее общих (°C, h)
      // подпись «90°C» с самим числом (паспортные данные на корпусе) относится только к своей строке
      var near = tags.filter(function (t) { return t.line === l || (!t.same && dist(l, t.line) < 6); })
        .sort(function (a, b) { return b.tag.w - a.tag.w || dist(l, a.line) - dist(l, b.line); });
      var field = null, unit = '', label = '', how = 'tag', conf = l.score * (0.75 + 0.25 * bv.agree);
      if (near.length) {
        field = near[0].tag.field; unit = near[0].tag.unit; label = near[0].lead ? bv.lead : near[0].line.text;
        if (field === 'dT') { out.kind = 'screen'; out.note = out.note || 'dt_screen'; out.anchor = 4.5; return; }   // перепад температур — в форму ХТМ не идёт
        if (field === 'm') {   // «m³» отдельно от «/h»: «h» рядом — расход; иначе «m³» — объём, неясное «m» — по длине числа
          var hTag = lines.some(function (t) { return /^[hn]$/.test(String(t.text).trim()) && dist(l, t) < 6; });
          if (hTag || (!near[0].tag.cube && bv.digits.length <= 5)) { field = 'flow'; unit = 'm³/h'; } else { field = 'volume'; unit = 'm³'; }
        }
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
        // модель известна (с наклейки или выбрана человеком): главное число без подписи — обычно экран по умолчанию, т. е. энергия
        var mid = (meter && meter.modelId) || ctx.modelId, mdl = mid && ctx.models ? ctx.models.filter(function (m0) { return m0.id === mid; })[0] : null;
        if (!field && mdl && mains.length === 1 && bv.digits.length >= 4) {
          field = 'energy'; how = 'model'; label = '';
          unit = val === null && mdl.units.indexOf('kWh') >= 0 ? 'kWh' : mdl.unit;   // целое без точки — киловатт-часы (T230/T330 так показывают)
          if (unit === 'kWh' && val === null) val = bv.digits;
          meter = meter || { modelId: mid, modelText: null, serial: null, apartment: null, energyUnit: null, confidence: 0.4 }; meter.energyUnit = unit;
          out.note = out.note || 'unit_guess';
        }
        out.cand = out.cand || { digits: bv.digits, dot: bv.dot, score: l.score };   // для разбора всей пачки по порядку экранов
        if (!field) {
          if (val === null && bv.digits.length >= 4 && /[1-9]/.test(bv.digits)) { field = 'hours'; how = 'guess'; }
          else if (val && (val.split('.')[1] || '').length === 3) { field = 'energy'; how = 'guess'; }
          else if (val && (val.split('.')[1] || '').length === 2 && parseFloat(val) < 150) { field = null; }
        }
        // «0.02» без подписи (3 цифры с ведущим нулём) — экран разницы температур dt: ни одно поле формы так не выглядит
        if (!field && /^0\d{2}$/.test(bv.digits)) { out.kind = 'screen'; out.note = 'dt_screen'; out.anchor = 4.5; delete out.cand; return; }
        if (!field) { out.note = out.note || 'unlabeled'; return; }
      }
      if (DEC[field] === 0) val = bv.digits;   // часы — целые: «точка» на них — это тень сегмента
      if (val === null) { var inf = inferDot(bv.digits, field, ctx); val = inf.v; if ((inf.how === 'none' || inf.how === 'dec') && DEC[field]) { conf *= inf.how === 'dec' ? 0.75 : 0.6; out.note = out.note || 'no_dot'; } else if (inf.how !== 'int') conf *= 0.9; }
      if (how === 'prev') conf *= 0.8; if (how === 'guess') conf *= 0.5; if (how === 'model') conf *= 0.7;
      if (field === 'energy' && unit) { meter = meter || { modelId: null, modelText: null, serial: null, apartment: null, energyUnit: null, confidence: 0.3 }; meter.energyUnit = unit; }
      out.readings.push({ field: field, value: stripZeros(val), unit: unit, label: label, confidence: +Math.min(0.97, conf).toFixed(2), how: how });
    });
    if (out.readings.length) out.kind = 'screen';
    else if (meter && meter.modelId) out.kind = 'nameplate';
    if (!out.readings.length && !meter && !nums.length) out.quality = 'too_far';
    return { photo: out, meter: meter };
  }

  /**
   * Пачка фото одного счётчика, снятых по порядку нажатий кнопки: число без подписи (мелкие значки «m³», «m³/h», «Gcal»
   * на ЖК часто не читаются) получает поле по месту фото между уверенно распознанными экранами и по формату числа.
   * Такие значения помечаются how:'order' — человек сверяет их с фото.
   */
  var STEP = { energy: 0, volume: 1, flow: 2, power: 3, tSupply: 4, tReturn: 4.1, hours: 5, errHours: 5.1, errCode: 6 };
  function fits(field, d, dot) {
    var n = d.length, v;
    if (field === 'energy' || field === 'volume') return n >= 4 && (dot === null || dot === 3);
    if (field === 'flow' || field === 'power') return n >= 4 && n <= 5 && (dot === null || dot === 3);
    if (field === 'tSupply' || field === 'tReturn') { v = parseFloat(placeDot(d, 2)); return n >= 3 && n <= 4 && (dot === null || dot === 2) && v >= 5 && v < 150; }
    if (field === 'hours' || field === 'errHours') return dot === null && /[1-9]/.test(d);
    return false;
  }
  function batch(photos, ctx) {
    var order = ['energy', 'volume', 'flow', 'power', 'tSupply', 'tReturn', 'hours', 'errHours'];
    if (ctx && ctx.steps) { order = []; ctx.steps.forEach(function (st) { st.fields.forEach(function (f) { if (f !== 'errCode') order.push(f); }); }); }
    var mdl = ctx && ctx.models ? ctx.models.filter(function (m) { return m.id === ctx.modelId; })[0] : null, unitE = (mdl && mdl.unit) || 'Gcal';
    var sure = function (r) { return r.how !== 'guess' && r.how !== 'model'; };
    var anchorOf = function (p) { var a = typeof p.anchor === 'number' ? p.anchor : null; (p.readings || []).forEach(function (r) { if (sure(r) && STEP[r.field] !== undefined) a = a === null ? STEP[r.field] : Math.max(a, STEP[r.field]); }); return a; };
    var have = {}; photos.forEach(function (p) { (p.readings || []).forEach(function (r) { if (sure(r)) have[r.field] = 1; }); });
    var list = photos.map(function (p, i) { return { p: p, i: typeof p.index === 'number' ? p.index : i, t: p.time || 0, a: anchorOf(p) }; }).sort(function (x, y) { return (x.t && y.t && x.t !== y.t) ? x.t - y.t : x.i - y.i; });
    list.forEach(function (it, k) {
      var p = it.p; if (!p.cand || it.a !== null) return;
      var lo = -Infinity, hi = Infinity, j;
      for (j = k - 1; j >= 0; j--) if (list[j].a !== null) { lo = list[j].a; break; }
      for (j = k + 1; j < list.length; j++) if (list[j].a !== null) { hi = list[j].a; break; }
      var d = p.cand.digits, dot = p.cand.dot;
      var f = order.filter(function (x) { return !have[x] && STEP[x] > lo && STEP[x] < hi && fits(x, d, dot); })[0];
      if (!f) {   // «0.02» между температурами и часами — экран разницы температур (подпись «dt» не прочиталась)
        if (lo >= 4 && lo < 5 && /^0/.test(d) && d.length <= 4) { p.note = 'dt_screen'; p.kind = 'screen'; it.a = 4.5; }
        return;
      }
      var val = DEC[f] ? placeDot(d, dot !== null ? dot : DEC[f]) : d;
      p.readings = (p.readings || []).filter(sure);
      p.readings.push({ field: f, value: stripZeros(val), unit: { energy: unitE, volume: 'm³', flow: 'm³/h', power: 'kW', tSupply: '°C', tReturn: '°C', hours: 'h', errHours: 'h' }[f], label: '', confidence: +(0.55 * (p.cand.score || 1)).toFixed(2), how: 'order' });
      p.kind = 'screen'; p.note = 'by_order'; have[f] = 1; it.a = STEP[f];
    });
    return photos;
  }

  var api = { batch: batch, photo: photo, meterType: meterType, meterScores: meterScores, cleanNum: cleanNum, inferDot: inferDot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TeploOCRParse = api;
})(typeof window !== 'undefined' ? window : this);
