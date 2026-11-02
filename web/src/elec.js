/*
 * «Лічильники» — учёт электроэнергии (Харьков): зоны, проверка показаний, окно приёма, расход и стоимость.
 * Куда: АТ «Харківобленерго» (оператор системи розподілу) — застосунок «Харенерго», Viber-бот, кол-центр;
 *       рахунок виставляє ПрАТ «Харківенергозбут» (постачальник універсальних послуг), особовий рахунок — з його платіжки.
 * Коли: останні 2 дні місяця і перші 3 дні наступного (подані 1–3 числа зараховуються на 1-ше).
 * Що: лише цифри до коми; у дво- і тризонних — кожну зону окремо (не сумувати), загальний показник не передають.
 * Ціна (постанова КМУ № 483, дод. 3; продовжено до 30.04.2027): 4,32 грн/кВт·год з ПДВ;
 *   2 зони: ніч (23–07) ×0,5; 3 зони: пік (08–11, 20–22) ×1,5, напівпік ×1, ніч (23–07) ×0,4;
 *   електроопалення (якщо оформлено): 1.10–30.04 — 2,64 грн за перші 2000 кВт·год на місяць, далі 4,32.
 * Газ (той же фабрикою make): ГК «Нафтогаз України», тариф «Фіксований» 7,96 грн/м³ з ПДВ (1.05.2026–30.04.2027; інші
 *   постачальники 7,96–9,99 — своя ціна в квартири); доставка (розподіл) — окрема фіксована плата, від показань не залежить.
 *   Показання — з 1 по 5 число (станом на 1-ше; SMS 4647 приймає з 28-го): особистий кабінет Газмереж my.grmu.com.ua,
 *   застосунок Нафтогазу «Куб», SMS 4647 «9 цифр рахунку пробіл 5 цифр показань», кол-центр 066/098/093-300-28-88.
 * Без DOM: работает в браузере и в node (тесты).
 */
(function (root) {
  'use strict';
  var OBL_APP_IOS = 'https://apps.apple.com/ua/app/id1592629551';
  var OBL_APP_ANDROID = 'https://play.google.com/store/search?q=%D0%A5%D0%B0%D1%80%D0%B5%D0%BD%D0%B5%D1%80%D0%B3%D0%BE&c=apps';
  var ZBUT_SITE = 'https://zbutenergo.kharkov.ua';
  // кол-центр Харківобленерго — номер за оператором зв'язку
  var PHONES = [['+380573424413', '(057) 342-44-13', 'Укртелеком'], ['+380672340413', '(067) 234-04-13', 'Київстар'], ['+380500540413', '(050) 054-04-13', 'Vodafone'], ['+380630540413', '(063) 054-04-13', 'lifecell']];
  function make(C) {
  var PRICE = C.price;
  var HEAT = C.heat || null;
  // ключи зон по числу зон: 1 — одно число; 2 — день/ніч; 3 — пік/напівпік/ніч
  var ZONES = { 1: ['all'], 2: ['day', 'night'], 3: ['peak', 'half', 'night'] };
  var COEF = { 1: { all: 1 }, 2: { day: 1, night: 0.5 }, 3: { peak: 1.5, half: 1, night: 0.4 } };
  var JUMP = C.jump, JUMP_HEAT = C.jumpHeat;   // на місяць на всі зони — багато для квартири (з опаленням — більше)

  function num(v) { if (v === null || v === undefined || v === '') return null; var n = Number(String(v).replace(',', '.').replace(/\s/g, '')); return isFinite(n) ? n : null; }
  /** Ціле число кВт·год: «12345,6» → 12345 (цифри після коми не передають). */
  function whole(v) { var n = num(v); return n === null ? null : Math.floor(n + 1e-9); }
  /** Як зберігати: «12 345,6» → «12345.6»; не число / мінус / забагато знаків після коми → null. */
  var DEC = new RegExp('^\\d+(\\.\\d{0,' + (C.decimals || 2) + '})?$');
  function norm(v) {
    if (v === null || v === undefined) return null;
    var s = String(v).trim().replace(/\s/g, '').replace(',', '.'); if (!DEC.test(s)) return null;
    return s.replace(/\.$/, '').replace(/^0+(?=\d)/, '');
  }
  function zones(m) { if (C.oneZone) return 1; var z = Number(m && m.zones); return z === 2 || z === 3 ? z : 1; }
  function keys(m) { return ZONES[zones(m)]; }
  function coef(m, k) { return COEF[zones(m)][k] || 1; }
  function priceAt(date) { var p = PRICE[0].p; PRICE.forEach(function (x) { if (String(date || '') >= x.from) p = x.p; }); return p; }
  /** Пільгова ціна електроопалення діє 1 жовтня — 30 квітня. */
  function heatSeason(date) { if (!HEAT) return false; var m = Number(String(date || '').slice(5, 7)); return m >= 10 || m <= 4; }
  function lastDay(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function addMonth(ym, n) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + String(m + 1).padStart(2, '0'); }
  function pad(n) { return String(n).padStart(2, '0'); }

  /**
   * Вікно приймання на дату: показання за місяць ym — з (останній−1) числа ym по 3-тє число наступного.
   * → {open, ym (за який місяць), from, to (останній день), daysLeft, next (коли відкриється, якщо закрито)}
   */
  function win(today) {
    if (C.win) return C.win(today, { lastDay: lastDay, addMonth: addMonth, pad: pad });
    var ym = String(today).slice(0, 7), d = +String(today).slice(8, 10), L = lastDay(ym);
    if (d <= 3) { var pm = addMonth(ym, -1); return { open: true, ym: pm, from: pm + '-' + pad(lastDay(pm) - 1), to: ym + '-03', daysLeft: 3 - d }; }
    var nm = addMonth(ym, 1), from = ym + '-' + pad(L - 1);
    if (d >= L - 1) return { open: true, ym: ym, from: from, to: nm + '-03', daysLeft: L - d + 3 };
    return { open: false, ym: ym, from: from, to: nm + '-03', next: from, daysLeft: null };
  }
  /** За який місяць зараховується показання, зняте в дату d (1–3 число — за попередній). */
  function forMonth(d) { var ym = String(d).slice(0, 7); return +String(d).slice(8, 10) <= (C.lateDays || 3) ? addMonth(ym, -1) : ym; }

  function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 864e5); }
  /**
   * Перевірка нових показань лічильника m проти попередніх prev ({date, z}).
   * vals: {day: '1234', night: '567'} → [{code, level: block|warn|info, zone?, ...}]
   */
  function check(m, vals, prev, date, opts) {
    var out = [], ks = keys(m), pz = prev && prev.z || {}, days = prev ? Math.max(1, daysBetween(prev.date, date)) : null, sum = 0, any = false;
    ks.forEach(function (k) {
      var raw = vals[k];
      if (raw === null || raw === undefined || String(raw).trim() === '') { out.push({ code: 'empty', level: 'block', zone: k }); return; }
      if (norm(raw) === null) { out.push({ code: 'bad', level: 'block', zone: k }); return; }
      var v = num(raw), p = num(pz[k]);
      if (v !== Math.floor(v)) out.push({ code: 'fraction', level: 'info', zone: k, whole: Math.floor(v) });
      if (p === null) return;
      var dv = Math.floor(v) - Math.floor(p); any = true;
      if (dv < 0) out.push({ code: 'less', level: 'block', zone: k, prev: Math.floor(p) });
      else sum += dv;
      // у зону вписали загальний показник (суму зон): приріст неймовірний, а число — не менше суми зон минулого разу
      if (ks.length > 1 && dv > 0 && dv / (days || 1) * 30 > JUMP) {
        var tot = ks.reduce(function (s, x) { var q = num(pz[x]); return s + (q === null ? 0 : Math.floor(q)); }, 0);
        if (Math.floor(v) >= tot && tot > Math.floor(p)) out.push({ code: 'sum', level: 'warn', zone: k });
      }
    });
    if (any && days) {
      var per = sum / days * 30, lim = opts && opts.heating ? JUMP_HEAT : JUMP;
      if (per > lim) out.push({ code: 'jump', level: 'warn', perMonth: Math.round(per) });
      else if (sum === 0 && !out.some(function (x) { return x.level === 'block'; })) out.push({ code: 'same', level: 'info' });
    }
    return out;
  }
  function blocked(list) { return (list || []).some(function (x) { return x.level === 'block'; }); }

  /** Скільки коштує розхід dz ({day: 120, night: 80}) за лічильником m на дату date. opts.heating — оформлене електроопалення. */
  function cost(m, dz, date, opts) {
    var base = opts && opts.price > 0 ? opts.price : priceAt(date), total = 0, kwh = 0, parts = {};
    keys(m).forEach(function (k) { kwh += Math.max(0, dz[k] || 0); });
    // електроопалення в сезон: 2,64 за перші 2000 кВт·год, далі 4,32 — усереднена ціна на весь розхід місяця
    var p = base;
    if (HEAT && opts && opts.heating && heatSeason(date) && kwh > 0) p = (Math.min(kwh, HEAT.limit) * HEAT.p + Math.max(0, kwh - HEAT.limit) * base) / kwh;
    keys(m).forEach(function (k) { var c = Math.max(0, dz[k] || 0) * p * coef(m, k); parts[k] = c; total += c; });
    return { total: total, kwh: kwh, price: p, parts: parts };
  }

  /**
   * Ряд по лічильнику: записи (за датою) з розходом від попередньої. recs: [{id, meter, date, z, base}].
   * → [{rec, dz: {k: n} | null, kwh, days}]
   */
  function series(recs, m) {
    var list = (recs || []).filter(function (r) { return r && !r.deleted && r.meter === m.id; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.base ? -1 : 1; });
    var out = [], prev = null;
    list.forEach(function (r) {
      var row = { rec: r, dz: null, kwh: null, days: null };
      if (prev) {
        var dz = {}, ok = true, sum = 0;
        keys(m).forEach(function (k) { var a = whole(prev.z && prev.z[k]), b = whole(r.z && r.z[k]); if (a === null || b === null || b < a) ok = false; else { dz[k] = b - a; sum += b - a; } });
        if (ok) { row.dz = dz; row.kwh = sum; row.days = Math.max(1, daysBetween(prev.date, r.date)); }
      }
      out.push(row); prev = r;
    });
    return out;
  }
  /** По місяцях (місяць — за який зараховується показання: 1–3 число — попередній). → [{ym, kwh, dz, cost, days, from, to}] */
  function monthly(ser, m, opts) {
    var by = {};
    ser.forEach(function (x) {
      if (!x.dz) return; var ym = forMonth(x.rec.date), b = by[ym];
      if (!b) b = by[ym] = { ym: ym, kwh: 0, dz: {}, cost: 0, days: 0, from: null, to: x.rec.date };
      b.kwh += x.kwh; b.days += x.days; b.to = x.rec.date;
      var from = new Date(Date.parse(x.rec.date) - x.days * 864e5).toISOString().slice(0, 10); if (!b.from || from < b.from) b.from = from;
      keys(m).forEach(function (k) { b.dz[k] = (b.dz[k] || 0) + x.dz[k]; });
    });
    return Object.keys(by).sort().map(function (k) { var b = by[k]; b.cost = cost(m, b.dz, b.to, opts).total; b.perMonth = b.days ? b.kwh / b.days * 30 : b.kwh; return b; });
  }
  function summary(mo) {
    if (!mo.length) return null;
    var kwh = 0, uah = 0, days = 0; mo.forEach(function (b) { kwh += b.kwh; uah += b.cost; days += b.days; });
    return { months: mo.length, perMonth: days ? kwh / days * 30 : kwh, uahMonth: days ? uah / days * 30 : uah, last: mo[mo.length - 1] };
  }
  /** Скільки дала б ніч: частка нічного розходу і економія проти однозонного (для двозонних). */
  function nightShare(mo) { var n = 0, all = 0; mo.forEach(function (b) { n += b.dz.night || 0; all += b.kwh; }); return all ? n / all : null; }

  // ---- показання з фото: рядки тексту движка TeploOCR (електронне табло: «T1 010420.5 kWh», «1.8.2 5225») і вікно
  // барабана (газ, механічний електролічильник — значення вже розібране движком води). Зону визначаємо міткою на табло
  // (T1/T2/T3, 1.8.1…, 15.8.x; T0 / 1.8.0 — сума, для зон не годиться), а з прошлими — ще й близькістю до них.
  var ZRE = [/(?:^|[^0-9A-Za-zА-Яа-я])[TТ]\s?([0-4])(?![0-9])/, /(?:^|[^0-9])(?:15|1)\s?[.,]\s?8\s?[.,]\s?([0-4])(?![0-9])/];
  var URE = /k\s?W\s?[·.*]?\s?h|кВт\s?[·.]?\s?(?:год|ч)|m\s?[3³]|м\s?[3³]/gi;
  function ocrTxt(v) { return String(v || '').replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); }); }
  function zoneOf(s) {
    for (var i = 0; i < ZRE.length; i++) { var m = s.match(ZRE[i]); if (m) return +m[1]; }
    return /ДЕНЬ|DAY/i.test(s) ? 'day' : /НІЧ|НОЧЬ|NIGHT/i.test(s) ? 'night' : null;
  }
  /** Кандидати-числа з рядків одного фото: [{digits, frac, sep, zone, unit, y, score}]. */
  function ocrCands(shot) {
    var out = [], tags = [];
    ((shot && shot.lines) || []).forEach(function (l, i) {
      var y = l.y != null ? l.y : (l.box ? l.box[1] : i * 40), h = l.h || 30;
      [l.text].concat(l.alts || []).some(function (raw, ai) {
        var s = ocrTxt(raw), z = zoneOf(s), unit = URE.test(s); URE.lastIndex = 0;
        var rest = s.replace(/(?:^|[^0-9A-Za-zА-Яа-я])[TТ]\s?[0-4](?![0-9])/g, ' ').replace(/(?:15|1)\s?[.,]\s?8\s?[.,]\s?[0-4](?![0-9])/g, ' ').replace(URE, ' ');
        if (/[A-Za-zА-Яа-яІіЇїЄє]{2}/.test(rest)) { if (z !== null && !ai) tags.push({ z: z, y: y, h: h }); return false; }
        var c = rest.replace(/\s+/g, '').replace(/(\d)[Oo]|[Oo](\d)/g, function (x, a, b) { return (a || '') + '0' + (b || ''); }).replace(/[Il|]/g, '1');
        var m = c.match(/^(\d{1,8})(?:[.,](\d{1,3}))?$/);
        if (!m) { if (z !== null && !ai && !/\d{3}/.test(c)) tags.push({ z: z, y: y, h: h }); return false; }
        if (m[1].length < 3 || (!m[2] && m[1].length >= 8 && m[1].charAt(0) !== '0')) return false;   // «50», заводський №
        out.push({ digits: m[1], frac: m[2] || '', sep: !!m[2], zone: z, unit: unit, y: y, h: h, score: h * (l.score || 1) * (m[2] ? 1.3 : 1) * (unit ? 1.5 : 1) * (m[1].charAt(0) === '0' ? 1.2 : 1) * (ai ? 0.8 : 1) });
        return true;
      });
    });
    // мітка зони окремим рядком — числу в тому ж ряду (або трохи нижче)
    out.forEach(function (c) { if (c.zone !== null) return; var best = null; tags.forEach(function (tg) { var dy = Math.abs(tg.y - c.y); if (dy < Math.max(tg.h, c.h) * 1.6 && (!best || dy < best.dy)) best = { dy: dy, z: tg.z }; }); if (best) c.zone = best.z; });
    return out;
  }
  function candVals(c, pv) {
    if (c.sep || pv === null) return [Number(c.digits)];
    var d = c.digits, out = []; for (var k = Math.max(1, d.length - 3); k <= d.length; k++) out.push(Number(d.slice(0, k)));
    return out;
  }
  /**
   * shots: [{lines, drum: {value, frac, sure} | null} | null] — по фото; ms — лічильники; prevBy: {id: {zone: показання}}.
   * → {id: {zone: {v, frac, photo, why: 'tag'|'prev'|'drum'|'', guess}}}. Одне число — одній зоні; сума (T0) — лише однозонному.
   */
  function fromPhotos(shots, ms, prevBy) {
    var pool = [], used = {}, by = {}, lim = (JUMP_HEAT || JUMP) * 3;
    (shots || []).forEach(function (sh, i) {
      if (!sh) return;
      ocrCands(sh).forEach(function (c) { c.photo = i; pool.push(c); });
      if (sh.drum && sh.drum.value !== null && sh.drum.value !== undefined) pool.push({ digits: String(sh.drum.value), frac: String(sh.drum.frac || ''), sep: true, zone: null, drum: true, sure: !!sh.drum.sure, score: 1e4, photo: i, y: 0 });
    });
    (ms || []).forEach(function (m) {
      var ks = keys(m), prev = (prevBy && prevBy[m.id]) || {}, res = by[m.id] = {}, opts = [];
      ks.forEach(function (z) {
        var pv = num(prev[z]);
        pool.forEach(function (c, ci) {
          if (used[ci]) return;
          var tz = c.zone === null ? null : typeof c.zone === 'number' ? (c.zone === 0 ? (ks.length === 1 ? z : '-') : ks.length > 1 ? (ks[c.zone - 1] || '-') : z) : ks.length > 1 && ks.indexOf(c.zone) >= 0 ? c.zone : z;
          if (tz && tz !== z) return;
          var tagged = !!tz && ks.length > 1;
          if (pv !== null) candVals(c, pv).forEach(function (v) {
            var dv = v - Math.floor(pv); if (dv < 0 || dv > lim) return;
            opts.push({ z: z, ci: ci, v: v, frac: c.sep ? c.frac : '', cost: dv / lim - (tagged ? 1 : 0) - (c.drum ? 0.5 : 0) - c.score / 1e6, why: tagged ? 'tag' : c.drum ? 'drum' : 'prev', photo: c.photo });
          });
          else opts.push({ z: z, ci: ci, v: Number(c.digits), frac: c.frac, cost: -(tagged ? 1e5 : 0) - c.score + c.photo * 1e-3 + (c.y || 0) * 1e-6, why: tagged ? 'tag' : c.drum ? 'drum' : '', photo: c.photo, guess: !tagged && (ks.length > 1 || !c.drum || !c.sure) });
        });
      });
      opts.sort(function (a, b) { return a.cost - b.cost; });
      opts.forEach(function (o) { if (res[o.z] || used[o.ci]) return; res[o.z] = { v: o.v, frac: String(o.frac || '').slice(0, 3), photo: o.photo, why: o.why, guess: !!o.guess }; used[o.ci] = true; });
      // однозонний: на фото число менше прошлого (помилка в минулому записі чи інший лічильник) — не ховаємо «цифр не знайшли»,
      // а ставимо найкраще прочитане (від 5 цифр, як на барабані/табло, і саме менше — не «склеєне» з десятими) з позначкою:
      // перевірка скаже «менше, ніж минулого разу»
      if (ks.length === 1 && !res[ks[0]] && num(prev[ks[0]]) !== null) {
        var best = null;
        pool.forEach(function (c, ci) { if (used[ci] || c.digits.length < 5 || Number(c.digits) >= num(prev[ks[0]]) || (c.zone !== null && c.zone !== 0 && c.zone !== ks[0])) return; var cost = -c.score + c.photo * 1e-3; if (!best || cost < best.cost) best = { ci: ci, c: c, cost: cost }; });
        if (best) { res[ks[0]] = { v: Number(best.c.digits), frac: String(best.c.frac || '').slice(0, 3), photo: best.c.photo, why: 'less', guess: true }; used[best.ci] = true; }
      }
    });
    return by;
  }

  return { PRICE: PRICE, HEAT: HEAT, ZONES: ZONES, COEF: COEF, JUMP: JUMP, JUMP_HEAT: JUMP_HEAT, PHONES: C.phones || [], LINKS: C.links || {}, fromPhotos: fromPhotos, ocrCands: ocrCands,
    num: num, whole: whole, norm: norm, zones: zones, keys: keys, coef: coef, priceAt: priceAt, heatSeason: heatSeason, win: win, forMonth: forMonth, lastDay: lastDay, addMonth: addMonth,
    check: check, blocked: blocked, cost: cost, series: series, monthly: monthly, summary: summary, nightShare: nightShare,
    uid: function () { return (C.idp || 'e') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); } };
  }
  // світло — Харківобленерго / Харківенергозбут
  var elec = make({ price: [{ from: '2000-01-01', p: 4.32 }], heat: { p: 2.64, limit: 2000 }, jump: 1500, jumpHeat: 4000, decimals: 2, idp: 'e',
    phones: PHONES, links: { ios: OBL_APP_IOS, android: OBL_APP_ANDROID, zbut: ZBUT_SITE } });
  elec.OBL_APP_IOS = OBL_APP_IOS; elec.OBL_APP_ANDROID = OBL_APP_ANDROID; elec.ZBUT_SITE = ZBUT_SITE;
  // газ — показання 1–5 числа (станом на 1-ше; SMS 4647 — з 28-го); 1–5 число — за попередній місяць
  var gas = make({ price: [{ from: '2000-01-01', p: 7.96 }], jump: 150, jumpHeat: 800, decimals: 3, oneZone: true, lateDays: 5, idp: 'g',
    phones: [['+380663002888', '(066) 300-28-88', 'Vodafone'], ['+380983002888', '(098) 300-28-88', 'Київстар'], ['+380933002888', '(093) 300-28-88', 'lifecell']],
    links: { cabinet: 'https://my.grmu.com.ua/', sms: '4647' },
    win: function (today, h) {
      var ym = String(today).slice(0, 7), d = +String(today).slice(8, 10), pm = h.addMonth(ym, -1), nm = h.addMonth(ym, 1);
      if (d <= 5) return { open: true, ym: pm, from: ym + '-01', to: ym + '-05', daysLeft: 5 - d };
      return { open: false, ym: ym, from: nm + '-01', to: nm + '-05', next: nm + '-01', daysLeft: null };
    } });
  /** SMS для Нафтогазу: «123456789 01234» — 9 цифр рахунку, пробіл, 5 цифр показань (нулі попереду). */
  gas.smsText = function (acc, v) { var a = String(acc || '').replace(/\D/g, ''), n = gas.whole(v); if (a.length !== 9 || n === null || n > 99999) return null; return a + ' ' + String(n).padStart(5, '0'); };
  elec.make = make; elec.gas = gas;
  if (typeof module !== 'undefined' && module.exports) module.exports = elec; else { root.TeploElec = elec; root.TeploGas = gas; }
})(typeof window !== 'undefined' ? window : this);
