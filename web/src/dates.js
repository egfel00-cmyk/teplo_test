/*
 * Дата, введена руками в любом виде (141-я, владелец 13.11: «поля ввода дат должны понимать ввод дат вручную любого формата и вида»).
 * Без DOM: строка → ISO «рррр-мм-дд». Понимает:
 *   13.11.2026 · 1.3.26 · 13/11/2026 · 13-11-2026 · 13,11,2026 · 13 11 2026 · 2026-11-13 · 2026.11.13 · 2026-11-13T10:00 · 13112026 · 131126 · 1311 · 5112026
 *   13 листопада 2026 р. · 13 ноября · 5 бер · листопад 13 · Nov 13, 2026 · 13.XI.2026 · сьогодні / вчора / позавчора (и по-русски, today, yesterday)
 *   11/13/2026 — день больше 12 только вторым числом → месяц/день (американская запись).
 * Без года — ближайшая прошедшая: этот год, а если дата позже `max` (сегодня у показаний) — прошлый. Две цифры года — 20рр.
 * parse(s, { today, max }) → { iso, full } или null; full — год написан полностью (или «сьогодні», или 8 цифр подряд): такую дату можно принять,
 * не дожидаясь, пока человек уйдёт из поля. Тесты — tests/dates.test.js (синтетика).
 */
(function (root) {
  'use strict';
  // месяцы — по началу слова (uk, ru, en); порядок важен: «мар» раньше «ма»
  var MONTHS = [
    [1, ['січ', 'янв', 'jan']], [2, ['лют', 'фев', 'feb']], [3, ['бер', 'мар', 'mar']], [4, ['квіт', 'квит', 'апр', 'apr', 'кві']],
    [5, ['трав', 'мая', 'май', 'may']], [6, ['черв', 'июн', 'jun']], [7, ['лип', 'июл', 'jul']], [8, ['серп', 'авг', 'aug']],
    [9, ['вер', 'сен', 'sep']], [10, ['жовт', 'окт', 'oct']], [11, ['лист', 'ноя', 'nov']], [12, ['груд', 'дек', 'dec']]
  ];
  var ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
  var REL = [[0, /^(сьогодні|сьогодня|сегодня|сёгодня|today|зараз|сейчас)$/], [-1, /^(вчора|вчера|учора|yesterday)$/], [-2, /^(позавчора|позавчера)$/]];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoOf(y, m, d) {
    if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? y + '-' + pad(m) + '-' + pad(d) : '';
  }
  function todayIso() { var n = new Date(); return n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate()); }
  function addDays(iso, k) { var p = iso.split('-'), dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + k)); return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate()); }
  function month(w) {
    if (ROMAN[w]) return ROMAN[w];
    for (var i = 0; i < MONTHS.length; i++) for (var j = 0; j < MONTHS[i][1].length; j++) if (w.indexOf(MONTHS[i][1][j]) === 0) return MONTHS[i][0];
    return 0;
  }
  function year2(s, ty) { if (s.length === 4) return +s; if (s.length !== 2) return 0; var y = 2000 + +s; return y > ty + 30 ? y - 100 : y; }

  /** день-месяц без года: этот год, позже max — прошлый */
  function noYear(m, d, o) {
    var ty = +o.today.slice(0, 4), iso = isoOf(ty, m, d);
    if (!iso && m === 2 && d === 29) iso = isoOf(ty - 1, m, d) || isoOf(ty - 2, m, d) || isoOf(ty - 3, m, d);
    if (iso && o.max && iso > o.max) iso = isoOf(+iso.slice(0, 4) - 1, m, d) || iso;
    return iso;
  }
  /** a, b — день и месяц (или месяц и день, если день > 12 только вторым) */
  function dm(a, b) { if (a >= 1 && a <= 31 && b >= 1 && b <= 12) return [b, a]; if (a >= 1 && a <= 12 && b > 12 && b <= 31) return [a, b]; return null; }

  /** цифры подряд без разделителей: 8 — ддммрррр (или ррррммдд), 6 — ддммрр, 4 — ддмм, 3/5/7 — день или месяц одной цифрой, если иначе не выходит */
  function digits(s, o, ty) {
    var L = s.length, res = [], add = function (iso) { if (iso && res.indexOf(iso) < 0) res.push(iso); };
    if (L === 8) {
      var a = isoOf(+s.slice(4), +s.slice(2, 4), +s.slice(0, 2)); if (a) return { iso: a, full: true };
      var b = isoOf(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6)); return b ? { iso: b, full: true } : null;
    }
    if (L === 6) { var c = isoOf(year2(s.slice(4), ty), +s.slice(2, 4), +s.slice(0, 2)); return c ? { iso: c, full: false } : null; }
    if (L === 4) { var e = +s.slice(0, 2) <= 31 && +s.slice(2) <= 12 ? noYear(+s.slice(2), +s.slice(0, 2), o) : ''; return e ? { iso: e, full: false } : null; }
    if (L === 3 || L === 5 || L === 7) {
      var yS = s.slice(3);   // первые три цифры — день и месяц, одно из них одной цифрой
      [1, 2].forEach(function (k) {
        var d = +s.slice(0, k), m = +s.slice(k, 3);
        add(L === 3 ? noYear(m, d, o) : isoOf(year2(yS, ty), m, d));
      });
      return res.length === 1 ? { iso: res[0], full: false } : null;   // 7 цифр — ещё могут допечатать восьмую
    }
    return null;
  }

  function parse(s, o) {
    o = o || {}; o = { today: o.today || todayIso(), max: o.max || '' };
    var t = String(s == null ? '' : s).toLowerCase().replace(/[’'`ʼ]/g, '').replace(/ё/g, 'е').trim();
    if (!t) return null;
    if (/^[\d.]+$/.test(t) && mask(t) !== null) return digits(t.replace(/\./g, ''), o, +o.today.slice(0, 4));   // «13.11.26» из маски — по цифрам
    var w0 = t.replace(/[^a-zа-яіїєґ]/g, '');
    for (var r = 0; r < REL.length; r++) if (REL[r][1].test(w0)) return { iso: addDays(o.today, REL[r][0]), full: true };
    t = t.replace(/(\d)t(\d)/, '$1 $2')
      .replace(/(^|\s)\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(z|[+-]\d{2}:?\d{2})?(?=\s|$)/g, ' ');   // время — прочь
    var tok = t.match(/\d+|[a-zа-яіїєґ]+/g) || [], nums = [], mon = 0, ty = +o.today.slice(0, 4);
    tok.forEach(function (x) {
      if (/^\d/.test(x)) { nums.push(x); return; }
      var rx = x.replace(/х/g, 'x').replace(/і/g, 'i');   // «ХІ» кириллицей — тоже римское
      var m = /^[ivx]+$/.test(rx) ? (ROMAN[rx] || 0) : month(x);
      if (m && !mon) mon = m;
    });
    if (!nums.length) return null;
    var iso = '', full = false;
    if (mon) {
      var four = nums.filter(function (n) { return n.length === 4; })[0], small = nums.filter(function (n) { return n.length <= 2; });
      var d = +small[0], y = four ? +four : small.length > 1 ? year2(small[1], ty) : 0;
      if (!small.length) return null;
      iso = y ? isoOf(y, mon, d) : noYear(mon, d, o); full = !!four;
      return iso ? { iso: iso, full: full } : null;
    }
    if (nums.length === 1) return digits(nums[0], o, ty);
    var A = nums[0], B = nums[1], C = nums[2];
    if (A.length === 4) {   // рррр-мм-дд
      iso = C ? isoOf(+A, +B, +C) : ''; return iso ? { iso: iso, full: true } : null;
    }
    if (A.length > 2 || B.length > 2) return null;
    var p = dm(+A, +B); if (!p) return null;
    if (C) { var yy = year2(C, ty); iso = yy ? isoOf(yy, p[0], p[1]) : ''; full = C.length === 4; }
    else iso = noYear(p[0], p[1], o);
    return iso ? { iso: iso, full: full } : null;
  }

  /** ISO → «дд.мм.рррр» */
  function dmy(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? m[3] + '.' + m[2] + '.' + m[1] : ''; }

  /** Ввод одними цифрами (цифровая клавиатура телефона): точки после дня и месяца ставим сами. Человек поставил разделитель
   *  сам не там («1.3.26», «5/11») или пишет буквы — не трогаем, пусть пишет как привык (null). */
  function mask(v) {
    v = String(v || '');
    if (!/^[\d.]*$/.test(v)) return null;
    for (var i = 0; i < v.length; i++) if (v.charAt(i) === '.' && i !== 2 && i !== 5) return null;
    var d = v.replace(/\D/g, ''); if (d.length > 8) return null;
    var out = d.slice(0, 2); if (d.length > 2) out += '.' + d.slice(2, 4); if (d.length > 4) out += '.' + d.slice(4);
    if (/\.$/.test(v) && (d.length === 2 || d.length === 4)) out += '.';
    return out;
  }

  var api = { parse: parse, dmy: dmy, mask: mask, isoOf: isoOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TeploDate = api;
})(typeof window !== 'undefined' ? window : this);
