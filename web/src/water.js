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

  /** Записи квартиры по дате; потребление между соседними записями по каждому счётчику и вместе по видам. */
  function series(records, meters) {
    var rs = records.filter(function (r) { return r && !r.deleted; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.base ? -1 : b.base ? 1 : (a.createdAt || '') < (b.createdAt || '') ? -1 : 1); });
    return rs.map(function (r, i) {
      var p = i ? rs[i - 1] : null, by = {}, hot = 0, cold = 0, any = false;
      meters.forEach(function (m) {
        var v = whole(r.vals && r.vals[m.id]), pv = p ? whole(p.vals && p.vals[m.id]) : null;
        if (v !== null && pv !== null && v >= pv) { by[m.id] = v - pv; any = true; if (m.kind === 'hot') hot += v - pv; else cold += v - pv; }
      });
      return { rec: r, prev: p, by: by, hot: any ? hot : null, cold: any ? cold : null, days: p ? Math.max(1, Math.round((Date.parse(r.date) - Date.parse(p.date)) / 864e5)) : null };
    });
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

  function uid() { return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  var api = { VK_BOT: VK_BOT, VK_CABINET: VK_CABINET, VK_DEADLINE: VK_DEADLINE, TARIFFS: TARIFFS, HOT: HOT,
    num: num, whole: whole, tariffAt: tariffAt, cost: cost, check: check, blocked: blocked, vkCommand: vkCommand, vkWindow: vkWindow, series: series, fromOcr: fromOcr, fromDrum: fromDrum, uid: uid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TeploWater = api;
})(typeof window !== 'undefined' ? window : this);
