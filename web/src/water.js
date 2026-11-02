/*
 * Теплосервис — учёт воды (Харьков): водомеры квартиры, проверка показаний, стоимость, подготовка передачи.
 * Куда: холодная и горячая — КП «Харківводоканал» до 20 числа (горячая — для водоотведения);
 *       горячая — ещё и КП «ХТМ» (за саму горячую воду).
 * Бот Водоканала @hvk_user_bot принимает: /2=РАХУНОК:Прізвище|ID1-показання,ID2-показання (ID — из ответа на /1=…).
 * Без DOM: работает в браузере и в node (тесты).
 */
(function (root) {
  'use strict';
  var VK_BOT = 'https://t.me/hvk_user_bot', VK_CABINET = 'https://billing.vodokanal.kharkov.ua', VK_DEADLINE = 20;
  // грн/м³ с НДС; меняется с даты (анонс тарифов, hts.kharkov.ua, 07.08.2026); горячая вода — тариф ХТМ из платёжки
  var TARIFFS = [
    { from: '2000-01-01', supply: 16.032, drain: 8.484 },
    { from: '2026-10-01', supply: 49.446, drain: 20.820 },
    { from: '2027-01-01', supply: 57.504, drain: 27.992 }
  ];
  var HOT = 86.32;

  function num(v) { if (v === null || v === undefined || v === '') return null; var n = Number(String(v).replace(',', '.').replace(/\s/g, '')); return isFinite(n) ? n : null; }
  function tariffAt(date, custom) {
    var t = TARIFFS[0]; TARIFFS.forEach(function (x) { if (String(date || '') >= x.from) t = x; });
    var c = custom || {};
    return { supply: num(c.supply) || t.supply, drain: num(c.drain) || t.drain, hot: num(c.hot) || HOT };
  }
  /** Стоимость за объём: холодная = водоснабжение + отведение; горячая = тариф ХТМ + отведение Водоканала. */
  function cost(dCold, dHot, date, custom) {
    var t = tariffAt(date, custom), c = Math.max(0, dCold || 0), h = Math.max(0, dHot || 0);
    var parts = { coldSupply: c * t.supply, coldDrain: c * t.drain, hot: h * t.hot, hotDrain: h * t.drain };
    parts.vk = parts.coldSupply + parts.coldDrain + parts.hotDrain; parts.htm = parts.hot; parts.total = parts.vk + parts.htm;
    return parts;
  }

  /** Целые кубометры: красные цифры (литры) не передают — «1234,567» → 1234. */
  function whole(v) { var n = num(v); return n === null ? null : Math.floor(n + 1e-9); }

  /**
   * Проверка новых показаний против прошлых.
   * meters: [{id, kind}], vals: {id: '123'}, prev: {date, vals}. → {id: [{code, level:'block'|'warn'|'info', ...}]}
   */
  function check(meters, vals, prev, date) {
    var out = {}, days = prev && prev.date && date ? Math.max(1, Math.round((Date.parse(date) - Date.parse(prev.date)) / 864e5)) : null;
    var d = {};
    meters.forEach(function (m) {
      var list = [], v = num(vals[m.id]), p = prev && prev.vals ? num(prev.vals[m.id]) : null;
      if (v === null) { out[m.id] = [{ code: 'empty', level: 'block' }]; return; }
      if (v < 0) list.push({ code: 'neg', level: 'block' });
      if (v !== Math.floor(v)) list.push({ code: 'fraction', level: 'info', whole: Math.floor(v) });
      if (p !== null) {
        var dv = whole(v) - whole(p); d[m.id] = dv;
        if (dv < 0) list.push({ code: 'less', level: 'block', prev: p });
        else if (dv === 0) list.push({ code: 'same', level: 'info' });
        else if (days && dv / days * 30 > 25) list.push({ code: 'jump', level: 'warn', perMonth: Math.round(dv / days * 30) });   // > 25 м³ в месяц на один счётчик — редкость для квартиры
      }
      out[m.id] = list;
    });
    // горячей вдвое больше холодной — чаще всего перепутаны счётчики
    var hot = 0, cold = 0, hasHot = false, hasCold = false;
    meters.forEach(function (m) { if (d[m.id] === undefined) return; if (m.kind === 'hot') { hot += d[m.id]; hasHot = true; } else { cold += d[m.id]; hasCold = true; } });
    if (hasHot && hasCold && hot >= 3 && hot > cold * 2) meters.forEach(function (m) { if (m.kind === 'hot' && out[m.id]) out[m.id].push({ code: 'hot_gt_cold', level: 'warn' }); });
    return out;
  }
  function blocked(issues) { return Object.keys(issues).some(function (k) { return issues[k].some(function (x) { return x.level === 'block'; }); }); }

  /** Команда для бота Водоканала. Счётчики без ID — в missing (их ID человек узнаёт командой /1=). */
  function vkCommand(account, surname, meters, vals) {
    var acc = String(account || '').replace(/\D/g, ''), sn = String(surname || '').trim(), parts = [], missing = [];
    meters.forEach(function (m) { var v = whole(vals[m.id]); if (v === null) return; if (!m.vkId) { missing.push(m.id); return; } parts.push(String(m.vkId).replace(/\D/g, '') + '-' + v); });
    return { ok: !!acc && !!sn && parts.length > 0 && !missing.length, text: '/2=' + acc + ':' + sn + '|' + parts.join(','), info: '/1=' + acc + ':' + sn, missing: missing, noAccount: !acc || !sn };
  }

  /** Окно передачи в Водоканал: до 20 числа текущего месяца. */
  function vkWindow(today) {
    var day = Number(String(today).slice(8, 10)), left = VK_DEADLINE - day;
    return { open: day <= VK_DEADLINE, daysLeft: left, deadline: String(today).slice(0, 8) + VK_DEADLINE };
  }

  function daysBetween(a, b) { return Math.max(1, Math.round((Date.parse(b) - Date.parse(a)) / 864e5)); }
  /**
   * Записи квартиры по дате; потребление по каждому счётчику — от его прошлого показания (запись может быть только
   * по горячей или только по холодной), вместе по видам. hot/cold = null, если по этому виду сравнить не с чем.
   * days — от прошлой записи; daysHot/daysCold и fromHot/fromCold — от прошлых показаний этого вида.
   */
  function series(records, meters) {
    var rs = records.filter(function (r) { return r && !r.deleted; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.base ? -1 : b.base ? 1 : (a.createdAt || '') < (b.createdAt || '') ? -1 : 1); });
    var last = {};
    return rs.map(function (r, i) {
      var p = i ? rs[i - 1] : null, by = {}, sum = { hot: 0, cold: 0 }, any = { hot: false, cold: false }, from = { hot: '', cold: '' };
      meters.forEach(function (m) {
        var v = whole(r.vals && r.vals[m.id]), k = m.kind === 'hot' ? 'hot' : 'cold', l = last[m.id];
        if (v === null) return;
        if (l && v >= l.v) { by[m.id] = v - l.v; sum[k] += v - l.v; any[k] = true; if (l.date > from[k]) from[k] = l.date; }
        last[m.id] = { v: v, date: r.date };
      });
      return { rec: r, prev: p, by: by, hot: any.hot ? sum.hot : null, cold: any.cold ? sum.cold : null,
        days: p ? daysBetween(p.date, r.date) : null,
        fromHot: from.hot || null, fromCold: from.cold || null,
        daysHot: from.hot ? daysBetween(from.hot, r.date) : null, daysCold: from.cold ? daysBetween(from.cold, r.date) : null };
    });
  }

  /**
   * Потребление по месяцам для статистики: месяц — по дате снятия (так считают и Водоканал, и квитанция),
   * несколько записей за месяц складываются. kind: 'hot'|'cold'. → [{ym, m3, days, cost, perMonth, from, to}]
   */
  function monthly(ser, kind, custom) {
    var by = {}, hot = kind === 'hot';
    ser.forEach(function (x) {
      var d = hot ? x.hot : x.cold, days = hot ? x.daysHot : x.daysCold, from = hot ? x.fromHot : x.fromCold;
      if (d === null || d === undefined || !days) return;
      var ym = String(x.rec.date).slice(0, 7), b = by[ym] || (by[ym] = { ym: ym, m3: 0, days: 0, cost: 0, from: from, to: x.rec.date });
      b.m3 += d; b.days += days; if (from < b.from) b.from = from; if (x.rec.date > b.to) b.to = x.rec.date;
      b.cost += (hot ? cost(0, d, x.rec.date, custom) : cost(d, 0, x.rec.date, custom)).total;
    });
    return Object.keys(by).sort().map(function (k) { var b = by[k]; b.perMonth = b.days ? b.m3 / b.days * 30.44 : null; return b; });
  }
  /** Сводка для статистики и советов: среднее м³ и грн в месяц за последние до 12 месяцев с данными. */
  function summary(months) {
    var ms = months.slice(-12), m3 = 0, days = 0, uah = 0;
    ms.forEach(function (b) { m3 += b.m3; days += b.days; uah += b.cost; });
    if (!days) return null;
    return { months: ms.length, m3: m3, uah: uah, perMonth: m3 / days * 30.44, uahMonth: uah / days * 30.44, last: ms[ms.length - 1] };
  }

  /**
   * Показание водомера по тексту с фото (барабаны). Берём самую крупную строку из 4–9 цифр без букв (не заводской номер);
   * 8 цифр подряд = 5 чёрных (м³) + 3 красных (литры) — отбрасываем литры; с прошлым показанием выбираем длину целой части,
   * при которой значение не меньше прошлого и ближе всего к нему.
   */
  // Барабан водоміра: 5 чорних цифр (м³) + червоні (дроби). Заводський № (поруч «№»/«No»), рік випуску й цифри
  // на циферблаті — не показання. Не впевнені — повертаємо null: краще попросити ввести, ніж підставити чуже число.
  function fromOcr(res, prevVal) {
    // окно барабана (по цвету) главнее строк текста, только если прочитано уверенно; иначе — сверяем со строкой цифр
    var dr = fromDrum(res, prevVal), ln = fromLines(res, prevVal);
    if (dr && dr.value !== null && dr.strong) return dr;
    if (ln && dr && dr.value === ln.value) { ln.sure = true; ln.drum = true; ln.red = dr.red; ln.tint = dr.tint; return ln; }
    // строка «0137052» начинается с цифр окна «00137» — окно отделило м³ от дробей, ему и верим
    if (ln && dr && dr.value !== null && dr.digits.length >= 4 && ln.digits.replace(/^0+/, '').indexOf(String(dr.value)) === 0) { dr.sure = !dr.half; return dr; }
    if (ln) return ln;
    if (dr) { dr.sure = false; return dr; }
    return null;
  }
  function fromLines(res, prevVal) {
    var lines = (res && res.lines) || [], best = null, p = num(prevVal);
    var serialY = lines.filter(function (l) { return /^(N[oо0º]|№)\.?$/i.test(String(l.text || '').trim()); }).map(function (l) { return l.y != null ? l.y : (l.box ? l.box[1] : null); });
    lines.forEach(function (l) {
      // «No796991» / «№ 796991» — заводской № одной строкой: не показание, и её варианты распознавания (без «No») — тоже
      if (/^\s*(N[oо0º°]|№)\s*\.?\s*\d/i.test(String(l.text || ''))) return;
      var ly = l.y != null ? l.y : (l.box ? l.box[1] : null);
      var nearSerial = ly != null && serialY.some(function (y) { return y != null && Math.abs(y - ly) < (l.h || 40) * 1.5; });
      [l.text].concat(l.alts || []).forEach(function (tx) {
        var s = String(tx || '').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }).replace(/[Oo]/g, '0').replace(/[Il|]/g, '1');
        if (/[A-Za-zА-Яа-яІіЇїЄє]{2}/.test(s) || /[,.]\d{3,}/.test(s)) return;   // подписи, «x 0,0001»
        var dg = s.replace(/\D/g, '');
        if (dg.length < 4 || dg.length > 9) return;
        if (/^(19|20)\d\d$/.test(dg)) return;                       // рік випуску
        var lead0 = dg.charAt(0) === '0';
        if (nearSerial || (dg.length === 7 && !lead0) || (dg.length >= 8 && !lead0)) return;   // заводський №
        var score = (l.h || 1) * (l.score || 1) * (lead0 ? 1.5 : 1) * (dg.length >= 5 ? 1.2 : 1);
        if (!best || score > best.score) best = { digits: dg, score: score };
      });
    });
    if (!best) return null;
    var d = best.digits, value;
    if (p !== null) {
      var cands = [];
      for (var k = Math.max(1, d.length - 4); k <= d.length; k++) { var v = Number(d.slice(0, k)); if (v >= Math.floor(p) && v - p < 500) cands.push(v); }
      if (!cands.length) return null;
      value = Math.min.apply(null, cands);
    } else value = Number(d.length >= 8 ? d.slice(0, d.length - 3) : d.slice(0, Math.min(5, d.length)));
    return { value: value, digits: d, sure: p !== null };
  }

  /**
   * Окно барабана, найденное движком по цвету (res.drums): text — цифры чёрных роликов, red — красных.
   * Число роликов оцениваем по пропорциям окна (cells): прочитано меньше — один ролик между цифрами (полуповорот);
   * тогда по правилу берём меньшую цифру, а с прошлым показанием — наименьшее значение не меньше прошлого.
   * → {value, digits, red, sure, half, tint, partial} | null (окна нет — разбираем строки текста как раньше)
   */
  function fromDrum(res, prevVal) {
    var ds = ((res && res.drums) || []).filter(function (d) { return d && String(d.text || '').length >= 3; });
    if (!ds.length) return null;
    var q = function (d) { var t = String(d.text); return (d.votes || 0) + (d.score || 0) + (/^0/.test(t) ? 1 : 0) + (t.length >= 4 && t.length <= 6 ? 0.5 : 0); };
    ds.sort(function (a, b) { return q(b) - q(a); });
    var d = ds[0], dg = String(d.text).replace(/\D/g, ''), p = num(prevVal), red = String(d.red || '').replace(/\D/g, '');
    if (dg.length >= 7) { red = red || dg.slice(dg.length - 3); dg = dg.slice(0, dg.length - 3); }   // захватили и красные
    // меньше цифр, чем роликов, и начало окна видно (ведущий ноль) — последний ролик между цифрами
    var exp = d.cells || 5, half = /^0/.test(dg) && dg.length < Math.min(exp, 5);
    var strong = dg.length >= 4 && (d.votes || 0) >= 2 && (d.score || 0) >= 0.9 && /^0/.test(dg);
    var out = { value: Number(dg), digits: dg, red: red, sure: strong && !half, strong: strong, half: half, tint: d.tint || null, drum: true };
    if (p !== null) {
      var pf = Math.floor(p + 1e-9);
      if (half || out.value < pf) {
        // недочитанный последний ролик: дописываем цифру — наименьшее значение не меньше прошлого
        for (var k = 0; k <= 9; k++) { var v = Number(dg + k); if (v >= pf && v - pf < 100) { out.value = v; out.half = true; out.sure = false; return out; } }
        if (out.value < pf) { out.sure = false; out.less = true; }
      } else if (out.value - pf > 500) out.sure = false;
      else if ((d.votes || 0) >= 2) out.sure = true;
      return out;
    }
    if (half) return { value: null, partial: dg + '?', digits: dg, red: red, half: true, tint: out.tint, drum: true, strong: strong };
    return out;
  }

  /** Окну барабана можно верить при раскладке (а не случайному тёмному пятну). */
  function goodDrum(d) { var t = String((d && d.text) || '').replace(/\D/g, ''); return t.length >= 4 && ((d.votes || 0) >= 2 || (d.score || 0) >= 0.9); }
  function center(o) { return { x: (o.x || 0) + (o.w || 0) / 2, y: (o.y || 0) + (o.h || 0) / 2 }; }
  /**
   * Пачка фото → показания по водомерам. photos: [{lines, drums}] (TeploOCR.read с {all:true}); meters: [{id, kind, serial}];
   * prev: {meterId: прошлое показание}. На одном фото может быть несколько водомеров (каждое уверенное окно — отдельно).
   * Чьё окно: заводской № на фото (на фото с несколькими окнами — ближайшему окну) → цвет кольца (красное — горячая,
   * синее — холодная) → близость к прошлому (не меньше и ненамного больше).
   * → { by: {meterId: {value, partial, photo, sure, half, why: 'serial'|'tint'|'prev'|'', guess}}, unused: [индексы фото] }
   *   guess — другой водомер подходил так же хорошо (могли перепутать), why '' — подсказок не было вовсе.
   */
  function assign(photos, meters, prev) {
    prev = prev || {};
    var serials = meters.map(function (m) { return { m: m, s: String(m.serial || '').replace(/\D/g, '') }; }).filter(function (x) { return x.s.length >= 5; });
    var cands = [];
    (photos || []).forEach(function (ph, i) {
      if (!ph) return;
      var ds = (ph.drums || []).filter(function (d) { return String(d.text || '').replace(/\D/g, '').length >= 3; }), good = ds.filter(goodDrum), seen = [];
      (ph.lines || []).forEach(function (l) {
        var dg = [l.text].concat(l.alts || []).join(' ').replace(/[OoОо]/g, '0').replace(/\D/g, '');
        serials.forEach(function (x) { if (dg.indexOf(x.s) >= 0) seen.push({ m: x.m, at: center(l) }); });
      });
      if (good.length >= 2) good.forEach(function (d) { cands.push({ photo: i, res: { drums: [d], lines: [] }, drum: d, seen: seen, multi: good }); });
      else cands.push({ photo: i, res: ph, drum: good[0] || ds[0] || null, seen: seen, multi: null });
    });
    var pairs = [];
    cands.forEach(function (c, ci) {
      meters.forEach(function (m) {
        var p = prev[m.id] !== undefined && prev[m.id] !== '' ? prev[m.id] : null, r = fromOcr(c.res, p);
        if (!r) return;
        var sc = r.value !== null ? 10 : 3, why = '', veto = false;
        c.seen.forEach(function (x) {
          // на фото с несколькими окнами номер относится к ближайшему окну
          var mine = !c.multi || c.multi.every(function (o) { if (o === c.drum) return true; var a = center(c.drum), b = center(o); return Math.hypot(a.x - x.at.x, a.y - x.at.y) <= Math.hypot(b.x - x.at.x, b.y - x.at.y); });
          if (!mine) return;
          if (x.m.id === m.id) { sc += 100; why = 'serial'; } else { sc -= 100; veto = true; }
        });
        var tint = (c.drum && c.drum.tint) || r.tint;
        if (tint === 'red' || tint === 'blue') { if ((tint === 'red') === (m.kind === 'hot')) { sc += 20; why = why || 'tint'; } else { sc -= 20; veto = true; } }
        if (p !== null && r.value !== null) {
          var dv = r.value - Math.floor(num(p) + 1e-9);
          if (dv < 0) sc -= 40; else if (dv <= 60) { sc += 15 - Math.min(10, dv / 4); why = why || 'prev'; } else if (dv > 300) sc -= 30;
        }
        if (r.sure) sc += 3;
        pairs.push({ c: ci, m: m, r: r, sc: sc, why: why, veto: veto });
      });
    });
    pairs.sort(function (a, b) { return b.sc - a.sc || a.c - b.c; });
    var by = {}, usedC = {}, usedP = {};
    var take = function (x) {
      var guess = pairs.some(function (y) { return y.c === x.c && y.m !== x.m && y.sc > x.sc - 5; });
      by[x.m.id] = { value: x.r.value, partial: x.r.partial || null, photo: cands[x.c].photo, sure: !!x.r.sure && !guess, half: !!x.r.half, why: x.why, guess: guess, less: !!x.r.less };
      usedC[x.c] = true; usedP[cands[x.c].photo] = true;
    };
    pairs.forEach(function (x) { if (!by[x.m.id] && !usedC[x.c] && x.sc >= -5) take(x); });
    // прочитанное не выбрасываем: меньше прошлого (или прошлое введено с ошибкой) — всё равно в поле, проверка покажет;
    // только не против явных подсказок (чужой заводской №, цвет другого вида)
    pairs.forEach(function (x) { if (!by[x.m.id] && !usedC[x.c] && !x.veto) take(x); });
    var unused = []; (photos || []).forEach(function (ph, i) { if (!usedP[i]) unused.push(i); });
    return { by: by, unused: unused };
  }

  function uid() { return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  var api = { VK_BOT: VK_BOT, VK_CABINET: VK_CABINET, VK_DEADLINE: VK_DEADLINE, TARIFFS: TARIFFS, HOT: HOT,
    num: num, whole: whole, tariffAt: tariffAt, cost: cost, check: check, blocked: blocked, vkCommand: vkCommand, vkWindow: vkWindow, series: series, monthly: monthly, summary: summary, fromOcr: fromOcr, assign: assign, goodDrum: goodDrum, fromDrum: fromDrum, uid: uid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TeploWater = api;
})(typeof window !== 'undefined' ? window : this);
