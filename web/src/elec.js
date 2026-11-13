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
 *   офіційний Telegram-бот Газмереж @mygrmu_bot (з 10.2025: номер телефону → філія → особовий рахунок → показання),
 *   застосунок Нафтогазу «Куб», SMS 4647 «9 цифр рахунку пробіл 5 цифр показань», кол-центр 066/098/093-300-28-88.
 *   Боти Нафтогазу GASUA у Viber/Telegram показання більше не приймають (замінив «Куб»).
 * Без DOM: работает в браузере и в node (тесты).
 */
(function (root) {
  'use strict';
  var OBL_APP_IOS = 'https://apps.apple.com/ua/app/id1592629551';
  var OBL_APP_ANDROID = 'https://play.google.com/store/search?q=%D0%A5%D0%B0%D1%80%D0%B5%D0%BD%D0%B5%D1%80%D0%B3%D0%BE&c=apps';
  var ZBUT_SITE = 'https://zbutenergo.kharkov.ua';
  var OBL_BOT = 'https://t.me/Kooz2bot', OBL_FORM = 'https://oblenergo.kharkiv.ua/uk/transmissionofmeterreadings', ELEC_SMS = '4300';
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
  /** По місяцях (місяць — за який зараховується показання: 1–3 число — попередній). → [{ym, kwh, dz, cost, days, from, to}]
   *  opts.fee — фіксована плата на місяць (газ: доставка/розподіл, 123-я): додається до cost кожного місяця, окремо — b.fee. */
  function monthly(ser, m, opts) {
    var by = {};
    ser.forEach(function (x) {
      if (!x.dz) return; var ym = forMonth(x.rec.date), b = by[ym];
      if (!b) b = by[ym] = { ym: ym, kwh: 0, dz: {}, cost: 0, days: 0, from: null, to: x.rec.date };
      b.kwh += x.kwh; b.days += x.days; b.to = x.rec.date;
      var from = new Date(Date.parse(x.rec.date) - x.days * 864e5).toISOString().slice(0, 10); if (!b.from || from < b.from) b.from = from;
      keys(m).forEach(function (k) { b.dz[k] = (b.dz[k] || 0) + x.dz[k]; });
    });
    var fee = opts && opts.fee > 0 ? opts.fee : 0;
    return Object.keys(by).sort().map(function (k) { var b = by[k]; b.cost = cost(m, b.dz, b.to, opts).total + fee; if (fee) b.fee = fee; b.perMonth = b.days ? b.kwh / b.days * 30 : b.kwh; return b; });
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
    var out = [], tags = [], frags = [];
    ((shot && shot.lines) || []).forEach(function (l, i) {
      var y = l.y != null ? l.y : (l.box ? l.box[1] : i * 40), h = l.h || 30;
      // шматок числа (лише цифри, можна з десятими) — для склейки ряду нижче
      var fm = ocrTxt(l.text).replace(/\s+/g, '').match(/^(\d{1,7})(?:[.,](\d{1,3}))?$/); if (fm && l.x != null && l.w) frags.push({ d: fm[1], f: fm[2] || '', x: l.x, w: l.w, y: y, h: h, s: l.score || 1 });
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
    // барабан НІК 2102, прочитаний шматками (власник 11.11: «352» і «9.4» / «94» в одному ряду, а показання — 3529,4): склеюємо сусідні
    // числа ряду зліва направо в одного кандидата (слабшого за цілий рядок — з прошлими його відбере правдоподібність, без прошлих — ні)
    frags.sort(function (a, b) { return a.x - b.x; });
    frags.forEach(function (a, i) {
      if (a.f) return; var dg = a.d, fr = '', sep = false, last = a, n = 1, sc = a.s * a.h, top = a.y, bot = a.y + a.h;
      for (var j = i + 1; j < frags.length && !sep; j++) {
        var b = frags[j], hh = Math.max(last.h, b.h), cy = (b.y + b.h / 2) - (last.y + last.h / 2);
        if (Math.abs(cy) > hh * 0.6 || b.x < last.x + last.w * 0.5 || b.x > last.x + last.w + hh * 1.5) continue;
        dg += b.d; if (b.f) { fr = b.f; sep = true; } last = b; n++; sc = Math.min(sc, b.s * b.h); top = Math.min(top, b.y); bot = Math.max(bot, b.y + b.h);
      }
      if (n < 2 || dg.length < 4 || dg.length > 8) return;
      out.push({ digits: dg, frac: fr, sep: sep, zone: null, unit: false, y: top, h: bot - top, score: sc * 0.6, merged: true });
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
   * opt: {days: {id: днів від прошлого}, heating} — скільки могло набігти: без днів — до 3 «місячних норм з опаленням», з днями —
   * три місячні норми на ці дні (не менше половини норми). НІК 2102 владельця 11.11: з прошлими ≈3500 за кілька днів підставили 5149.
   * → {id: {zone: {v, frac, photo, why: 'tag'|'prev'|'drum'|'', guess}}}. Одне число — одній зоні; сума (T0) — лише однозонному.
   */
  function fromPhotos(shots, ms, prevBy, opt) {
    var pool = [], used = {}, by = {}, lim0 = (JUMP_HEAT || JUMP) * 3;
    (shots || []).forEach(function (sh, i) {
      if (!sh) return;
      ocrCands(sh).forEach(function (c) { c.photo = i; pool.push(c); });
      // цифри барабана — з нулями попереду (003477 — шість роликів, не «4 цифри»)
      if (sh.drum && sh.drum.value !== null && sh.drum.value !== undefined) [sh.drum].concat(sh.drum.alts || []).forEach(function (d, j) {
        pool.push({ digits: String(d.digits || d.value), frac: String(d.frac || ''), sep: true, zone: null, drum: true, sure: !!d.sure, edge: !!d.edge, score: 1e4 - j * 10, photo: i, y: j });
      });
    });
    (ms || []).forEach(function (m) {
      var ks = keys(m), prev = (prevBy && prevBy[m.id]) || {}, res = by[m.id] = {}, opts = [], dd = opt && opt.days ? Number(opt.days[m.id]) : NaN, per = opt && opt.heating ? (JUMP_HEAT || JUMP) : JUMP;
      var lim = dd > 0 ? Math.max(per / 2, per * dd / 30 * 3) : lim0;
      ks.forEach(function (z) {
        var pv = num(prev[z]);
        pool.forEach(function (c, ci) {
          if (used[ci]) return;
          var tz = c.zone === null ? null : typeof c.zone === 'number' ? (c.zone === 0 ? (ks.length === 1 ? z : '-') : ks.length > 1 ? (ks[c.zone - 1] || '-') : z) : ks.length > 1 && ks.indexOf(c.zone) >= 0 ? c.zone : z;
          if (tz && tz !== z) return;
          var tagged = !!tz && ks.length > 1;
          if (pv !== null) candVals(c, pv).forEach(function (v) {
            var dv = v - Math.floor(pv); if (dv < 0 || dv > lim) return;
            opts.push({ z: z, ci: ci, v: v, frac: c.sep ? c.frac : '', cost: dv / lim - (tagged ? 1 : 0) - (c.drum ? 0.5 : 0) - c.score / 1e6, why: tagged ? 'tag' : c.drum ? 'drum' : 'prev', photo: c.photo, guess: !!c.edge, edge: !!c.edge });
          });
          else opts.push({ z: z, ci: ci, v: Number(c.digits), frac: c.frac, cost: -(tagged ? 1e5 : 0) - c.score + c.photo * 1e-3 + (c.y || 0) * 1e-6, why: tagged ? 'tag' : c.drum ? 'drum' : '', photo: c.photo, guess: !tagged && (ks.length > 1 || !c.drum || !c.sure) });
        });
      });
      opts.sort(function (a, b) { return a.cost - b.cost; });
      opts.forEach(function (o) { if (res[o.z] || used[o.ci]) return; res[o.z] = { v: o.v, frac: String(o.frac || '').slice(0, 3), photo: o.photo, why: o.why, guess: !!o.guess, edge: !!(o.edge || (pool[o.ci] && pool[o.ci].edge)) }; used[o.ci] = true; });
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
  // 129-а (власник 13.11, платіжка за світло): показання 11 листопада (проміжок 11.10–11.11) — «за жовтень». Місяць — той, на який припадає більша частина
  // місячного проміжку: показання до 15-го включно — за попередній місяць (раніше — лише 1–3 число)
  var elec = make({ price: [{ from: '2000-01-01', p: 4.32 }], heat: { p: 2.64, limit: 2000 }, jump: 1500, jumpHeat: 4000, decimals: 2, idp: 'e', lateDays: 15,
    phones: PHONES, links: { ios: OBL_APP_IOS, android: OBL_APP_ANDROID, zbut: ZBUT_SITE } });
  elec.OBL_APP_IOS = OBL_APP_IOS; elec.OBL_APP_ANDROID = OBL_APP_ANDROID; elec.ZBUT_SITE = ZBUT_SITE;
  elec.OBL_BOT = OBL_BOT; elec.OBL_FORM = OBL_FORM; elec.SMS = ELEC_SMS;
  // SMS Харківобленерго (4300): «12 цифр ЄР пробіл показання» (однозонний). → текст або null
  elec.smsText = function (acc, v) { var a = String(acc || '').replace(/\D/g, ''), n = elec.whole(v); if (a.length !== 12 || n === null) return null; return a + ' ' + n; };
  // газ — показання 1–5 числа (станом на 1-ше; SMS 4647 — з 28-го); 1–5 число — за попередній місяць
  var gas = make({ price: [{ from: '2000-01-01', p: 7.96 }], jump: 150, jumpHeat: 800, decimals: 3, oneZone: true, lateDays: 5, idp: 'g',
    phones: [['+380663002888', '(066) 300-28-88', 'Vodafone'], ['+380983002888', '(098) 300-28-88', 'Київстар'], ['+380933002888', '(093) 300-28-88', 'lifecell']],
    links: { cabinet: 'https://my.grmu.com.ua/', sms: '4647', bot: 'https://t.me/mygrmu_bot', find: 'https://gas.ua/uk/home/find-account', kub: 'https://kub.energy/download' },
    win: function (today, h) {
      var ym = String(today).slice(0, 7), d = +String(today).slice(8, 10), pm = h.addMonth(ym, -1), nm = h.addMonth(ym, 1);
      if (d <= 5) return { open: true, ym: pm, from: ym + '-01', to: ym + '-05', daysLeft: 5 - d };
      return { open: false, ym: ym, from: nm + '-01', to: nm + '-05', next: nm + '-01', daysLeft: null };
    } });
  /** SMS для Нафтогазу: «123456789 01234» — 9 цифр рахунку, пробіл, 5 цифр показань (нулі попереду). */
  // SMS 4647 вимикають з 28.11.2026 (відповідь 4647: «передавайте в застосунку Куб або 0800303104») — останній день SMS
  gas.SMS_UNTIL = '2026-11-27'; gas.KUB_TEL = ['+380800303104', '0 800 303 104'];
  gas.smsText = function (acc, v) { var a = String(acc || '').replace(/\D/g, ''), n = gas.whole(v); if (a.length !== 9 || n === null || n > 99999) return null; return a + ' ' + String(n).padStart(5, '0'); };
  /** Барабан індукційного лічильника світла (НІК 2102, СО-505…): 5–6 чорних роликів + 1 червоний (десяті кВт·год).
   *  Кандидати — з барабанів движка і з рядків тексту («0034846» = 003484 + червона 6). Перемичку між роликами движок
   *  інколи читає «1» («0013474» на 6 роликах) — пробуємо прибрати по одній «1». Голосуємо: однакове число з двох джерел —
   *  впевнено. Червона 7–9 чи 0 — останній чорний ролик може бути між цифрами: показання — «перевірте останню цифру».
   *  → { value, digits, frac, sure, edge, votes } або null. */
  elec.drumPick = function (drums, lines) {
    var c = [];
    var add = function (dg, red, w, src) {
      dg = String(dg || ''); red = String(red || '').replace(/\D/g, '').slice(0, 1);
      if (dg.length < 4 || dg.length > 7) return;
      if (dg.length === 7 && /^0/.test(dg) && !red) { red = dg.slice(6); dg = dg.slice(0, 6); }
      // зайва «1» — кромка рамки спереди (НІК 4.11: «1003491» → 003491) або перемичка між роликами всередині ряду
      if (dg.length === 7) { for (var i = 0; i < 7; i++) if (dg[i] === '1') add(dg.slice(0, i) + dg.slice(i + 1), red, w * (i === 0 ? 0.9 : 0.8), src + '-1'); return; }
      c.push({ dg: dg, v: Number(dg), red: red, w: w + (/^0/.test(dg) ? 1 : 0) + (dg.length >= 5 ? 0.3 : 0) + (red ? 0.4 : 0), src: src });
    };
    (drums || []).forEach(function (d) { if (d && d.text) add(String(d.text).replace(/\D/g, ''), d.red, 1 + (d.find || d.score || 0) + (d.sure ? 0.3 : 0), 'drum'); });
    (lines || []).forEach(function (l) {
      var tx = String((l && (l.text || l.t)) || l || '').replace(/\s+/g, ''), m = tx.match(/(^|\D)(0{1,3}\d{3,5})(\d?)(?=\D|$)/g);
      (m || []).forEach(function (x) { var d = x.replace(/\D/g, ''); if (d.length >= 6 && d.length <= 7 && /^0/.test(d)) add(d.length === 7 ? d.slice(0, 6) : d, d.length === 7 ? d.slice(6) : '', 1.6, 'line'); });
    });
    if (!c.length) return null;
    var by = {};
    c.forEach(function (x) { var b = by[x.v] = by[x.v] || { v: x.v, w: 0, n: 0, src: {}, red: '', dg: x.dg }; b.w = Math.max(b.w, x.w); if (!b.src[x.src.split('-')[0] + x.dg.length]) { b.n++; b.src[x.src.split('-')[0] + x.dg.length] = 1; } if (!b.red && x.red) b.red = x.red; if (x.dg.length > b.dg.length) b.dg = x.dg; });
    var all = Object.keys(by).map(function (k) { return by[k]; }).filter(function (b) { return b.v > 0 || /^0+$/.test(b.dg); });
    if (!all.length) return null;
    all.sort(function (a, b) { return b.n - a.n || b.w - a.w; });
    var top = all[0], edge = /^[7890]$/.test(top.red);
    var mk = function (b) { var e = /^[7890]$/.test(b.red); return { value: b.v, digits: b.dg, frac: b.red, sure: b.n >= 2 && !e, edge: e, votes: b.n }; };
    var out = mk(top); out.alts = all.slice(1, 3).map(mk); return out;
  };
  // ---- доставка (розподіл) газу (123-я, власник 12.11: «у платіжці ще за транспортування — що це, звідки, одна ціна чи ні, додати в облік») ----
  // Окрема плата оператору газорозподільної мережі (Газмережі — філія області; Київгаз, Одесагаз, Шепетівкагаз…), не постачальнику газу.
  // Щомісяця однаково, від показань не залежить: річна замовлена потужність (м³ — спожите за попередній газовий рік 1.10–30.09) ÷ 12 × тариф
  // оператора (грн за м³, з ПДВ). Перераховують з 1 січня. Мінімум для побуту — 39 м³ на рік (лише плита; з колонкою 126, з котлом 314).
  // Тарифи для населення не змінюються до кінця воєнного стану й різні в операторів: Харків-місто 0,516, Харківська обл. 2,388 — у довіднику (gas.dist).
  gas.DIST_MIN = 39;
  /** Плата за доставку на місяць: cap м³ на рік, tariff грн за м³ → грн (до копійки) або null. */
  gas.distMonth = function (cap, tariff) { var c = gas.num(cap), p = gas.num(tariff); if (!(c > 0) || !(p > 0)) return null; return Math.round(c / 12 * p * 100) / 100; };
  /** Газовий рік, за який рахують потужність на календарний рік year: 1.10 (year−2) – 30.09 (year−1). */
  gas.gasYear = function (year) { return { from: (year - 2) + '-10-01', to: (year - 1) + '-09-30' }; };
  /** Оцінка річної потужності за показаннями: є записи біля обох меж газового року (±20 днів) — спожите, приведене до 365 днів, не менше 39.
   *  recs — записи одного лічильника ({date, z: {all}}); → {m3, from, to, raw} або null. */
  gas.capFromRecs = function (recs, year) {
    var gy = gas.gasYear(year), list = (recs || []).filter(function (r) { return r && !r.deleted && r.z && gas.whole(r.z.all) !== null; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var near = function (d) { var best = null; list.forEach(function (r) { var x = Math.abs(daysBetween(d, r.date)); if (x <= 20 && (!best || x < best.x)) best = { r: r, x: x }; }); return best && best.r; };
    var a = near(gy.from), b = near(gy.to); if (!a || !b || a === b) return null;
    var q = gas.whole(b.z.all) - gas.whole(a.z.all), days = daysBetween(a.date, b.date); if (q < 0 || days < 300) return null;
    return { m3: Math.max(gas.DIST_MIN, Math.round(q * 365 / days)), raw: q, from: a.date, to: b.date };
  };
  function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 864e5); }
  elec.make = make; elec.gas = gas;
  if (typeof module !== 'undefined' && module.exports) module.exports = elec; else { root.TeploElec = elec; root.TeploGas = gas; }
})(typeof window !== 'undefined' ? window : this);
