/*
 * Вивіз сміття як «лічильник без табло» (115-а, власник 11.11: «додається на рівні лічильників, свої налаштування, замість табло —
 * інше, своя історія — і це теж враховувати»). Без DOM: місяці нарахувань (люди × ціна з людини), оплати, статус для картки,
 * борг, підсумки за рік. Тести — tests/waste.test.js (синтетика).
 * Стан квартири: place.waste = { on, at, removed, persons, price, priv, org, account, remindOff,
 *   pays: [{ id, ym — за який місяць, n — скільки місяців покриває (1–12), date — коли сплатили, amount — грн, src: 'mono' | '', updatedAt, deleted }] }.
 */
(function (root) {
  'use strict';
  var DUE_DAY = 20;   // за місяць платять до 20-го наступного (так у платіжках і офертах КП; точний строк — у платіжці)
  var YM = /^\d{4}-(0[1-9]|1[0-2])$/;

  function ymOf(d) { return String(d || '').slice(0, 7); }
  function addYm(ym, n) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y + '-' + (m < 9 ? '0' : '') + (m + 1);
  }
  function num(x) { var v = typeof x === 'number' ? x : parseFloat(String(x === null || x === undefined ? '' : x).replace(/\s/g, '').replace(',', '.')); return isFinite(v) ? v : null; }
  function round2(v) { return Math.round(v * 100) / 100; }
  /** Оплати, що діють (не видалені, з місяцем). */
  function pays(w) { return ((w && w.pays) || []).filter(function (p) { return p && !p.deleted && YM.test(p.ym || ''); }); }
  /** Скільки місяців покриває оплата: 1–12. */
  function span(p) { var n = Math.round(num(p && p.n) || 1); return Math.max(1, Math.min(12, n)); }
  function lastYm(p) { return addYm(p.ym, span(p) - 1); }
  function covers(p, ym) { return ym >= p.ym && ym <= lastYm(p); }
  /** Частка оплати на один місяць (сплатили за квартал однією сумою — ділимо порівну). */
  function perMonth(p) { var a = num(p && p.amount); return a === null ? null : round2(a / span(p)); }
  /** Перший місяць обліку: місяць перед додаванням (платять за минулий) або найраніша оплата. */
  function start(w, today) {
    var s = addYm(ymOf((w && w.at) || today), -1);
    pays(w).forEach(function (p) { if (p.ym < s) s = p.ym; });
    return s;
  }
  /** Останній місяць обліку: поточний; прибрали — місяць прибирання (оплати наперед — до кінця оплаченого). */
  function end(w, today) {
    var e = w && !w.on && w.removed ? ymOf(w.removed) : ymOf(today);
    pays(w).forEach(function (p) { var l = lastYm(p); if (l > e) e = l; });
    return e;
  }
  function byNew(a, b) { return String(b.date || '') < String(a.date || '') ? -1 : String(b.date || '') > String(a.date || '') ? 1 : 0; }

  /** Місяці обліку, новіші зверху: { ym, sum — нараховано (грн, null — невідомо), pay — оплата, що його покриває, paid — грн на цей місяць,
   *  st: paid | cur (поточний, ще не платять) | ahead (наперед) | due (до строку) | late (строк минув), due — 'YYYY-MM-20' наступного місяця }. */
  function months(w, today, sum, max) {
    var cur = ymOf(today), s = start(w, today), e = end(w, today), ps = pays(w), out = [];
    sum = num(sum) > 0 ? round2(num(sum)) : null;
    for (var ym = e; ym >= s && out.length < (max || 240); ym = addYm(ym, -1)) {
      var cov = ps.filter(function (p) { return covers(p, ym); }).sort(byNew), pay = cov[0] || null, due = addYm(ym, 1) + '-' + DUE_DAY;
      var st = pay ? 'paid' : ym > cur ? 'ahead' : ym === cur ? 'cur' : today <= due ? 'due' : 'late';
      out.push({ ym: ym, sum: sum, pay: pay, paid: pay ? perMonth(pay) : null, st: st, due: due });
    }
    return out;
  }

  /** Стан для картки й квартири: за минулий місяць сплачено (ok) / до 20-го (due) / строк минув (warn); debt — неоплачених минулих місяців
   *  (не більше 12 останніх), debtSum — їхня сума (якщо нарахування відоме). */
  function status(w, today, sum) {
    var ms = months(w, today, sum, 24).filter(function (m) { return m.st !== 'cur' && m.st !== 'ahead'; }), last = ms[0];
    var unpaid = ms.slice(0, 12).filter(function (m) { return m.st !== 'paid'; }), s = num(sum) > 0 ? num(sum) : null;
    var o = { debt: unpaid.length, debtSum: s && unpaid.length ? round2(unpaid.length * s) : null, unpaid: unpaid.map(function (m) { return m.ym; }) };
    if (!last) return Object.assign(o, { tone: '', st: 'none' });
    if (last.st === 'paid') return Object.assign(o, { tone: 'ok', st: 'paid', ym: last.ym, pay: last.pay });
    return Object.assign(o, { tone: last.st === 'late' ? 'warn' : 'due', st: last.st, ym: last.ym, due: last.due });
  }

  /** За який місяць пропонувати нову оплату: найдавніший неоплачений із 12 останніх минулих; усе сплачено — поточний (чи наступний за оплаченим наперед). */
  function nextYm(w, today) {
    var ms = months(w, today, null, 24), past = ms.filter(function (m) { return m.st === 'due' || m.st === 'late'; }).slice(0, 12);
    if (past.length) return past[past.length - 1].ym;
    var cur = ymOf(today), free = cur;
    while (pays(w).some(function (p) { return covers(p, free); }) && free < addYm(cur, 12)) free = addYm(free, 1);
    return free;
  }

  /** Підсумки за 12 місяців до сьогодні: сплачено (за датою оплати), скільки оплат, середнє на місяць за покриті місяці. */
  function year(w, today) {
    var from = addYm(ymOf(today), -11) + '-01', total = 0, n = 0, covered = 0;
    pays(w).forEach(function (p) { var a = num(p.amount); if (a === null || String(p.date || '') < from || String(p.date || '') > today) return; total += a; n++; covered += span(p); });
    return { total: round2(total), n: n, months: covered, perMonth: covered ? round2(total / covered) : null };
  }

  /** Нова оплата з полів форми: перевірка (місяць, 1–12 місяців, сума > 0 і < 100 000, дата не в майбутньому). → { ok, pay } | { ok: false, err }. */
  function make(f, today) {
    var ym = String(f.ym || ''), n = Math.round(num(f.n) || 1), a = num(f.amount), d = String(f.date || '');
    if (!YM.test(ym)) return { ok: false, err: 'ym' };
    if (n < 1 || n > 12) return { ok: false, err: 'n' };
    if (a === null || !(a > 0) || a >= 100000) return { ok: false, err: 'amount' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { ok: false, err: 'date' };
    if (d > today) return { ok: false, err: 'future' };
    return { ok: true, pay: { ym: ym, n: n, amount: round2(a), date: d } };
  }

  /** Оплата вже є (той самий день і сума — з monobank чи двічі натиснули)? */
  function dup(w, date, amount) { var a = num(amount); return pays(w).some(function (p) { return p.date === date && num(p.amount) === a; }); }

  var api = { DUE_DAY: DUE_DAY, ymOf: ymOf, addYm: addYm, pays: pays, span: span, covers: covers, perMonth: perMonth, start: start, months: months,
    status: status, nextYm: nextYm, year: year, make: make, dup: dup };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TeploWaste = api;
})(typeof window !== 'undefined' ? window : this);
