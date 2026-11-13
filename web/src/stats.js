/*
 * Теплосервис — статистика по истории показаний (без DOM, проверяется в node).
 * intervals(): между соседними показаниями (по дате снятия) — сколько тепла, средний перепад, расход, доля часов с теплом.
 * coolant(): температура подачи в момент снятия против температурного графика при той уличной температуре.
 * Погода — карта {'YYYY-MM-DD': средняя за сутки °C} (Open-Meteo через /api/weather).
 */
(function (root) {
  'use strict';
  var T_IN = 18, T_DESIGN = -22;          // расчётные: внутри +18 °C, снаружи −22 °C (Харьков, ДСТУ-Н Б В.1.1-27)
  var SUP = 95, RET = 70;                 // внутридомовой график 95/70 (элеваторные узлы; ХТМ свой график не публикует)
  var HDD_BASE = 18;                      // градусо-сутки: сумма (18 − средняя за сутки), если на улице холоднее
  var OK_TOL = 3, LOW_TOL = 8;            // подача ниже графика: до 3 °C — норма, до 8 °C — ниже, больше — сильно ниже

  function num(v) { if (v === null || v === undefined || v === '') return null; var n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; }
  function days(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
  function addDay(d, k) { return new Date(Date.parse(d + 'T00:00:00Z') + k * 86400000).toISOString().slice(0, 10); }

  /** Норма по графику при уличной температуре t (качественное регулирование, показатель радиаторов 0.25). */
  function graph(t) {
    if (t === null || t === undefined) return null;
    var q = (T_IN - t) / (T_IN - T_DESIGN); if (q <= 0) return null; if (q > 1) q = 1;
    var mid = (SUP + RET) / 2 - T_IN, half = (SUP - RET) / 2;
    return { supply: +(T_IN + mid * Math.pow(q, 0.8) + half * q).toFixed(1), ret: +(T_IN + mid * Math.pow(q, 0.8) - half * q).toFixed(1) };
  }

  /** Точки истории: показания + последние принятые (если их даты нет среди показаний), по дате. */
  /** gaps — периоды без лічильника [{from, to, vFrom, vTo}]: точки «зняли» (stop) и «поставили» (start); через них розхід не рахується. */
  function points(readings, baseline, gaps) {
    var pts = (readings || []).filter(function (r) { return r && !r.deleted && r.htm && r.htm.date && num(r.htm.energy) !== null; })
      .map(function (r) { return { date: r.htm.date, h: r.htm, id: r.id }; });
    if (baseline && baseline.date && num(baseline.energy) !== null && !pts.some(function (p) { return p.date === baseline.date; })) pts.push({ date: baseline.date, h: baseline, id: 'baseline' });
    (gaps || []).forEach(function (g) {
      if (!g || g.deleted || !g.from) return;
      pts.push({ date: g.from, h: num(g.vFrom) !== null ? { energy: g.vFrom } : null, id: 'gap:' + g.id, stop: true });
      if (g.to) pts.push({ date: g.to, h: num(g.vTo) !== null ? { energy: g.vTo } : null, id: 'gap:' + g.id, start: true });
    });
    // в один день: «поставили» — раньше показаний, «зняли» — позже
    var ord = function (p) { return p.start ? 0 : p.stop ? 2 : 1; };
    pts.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : ord(a) - ord(b); });
    return pts;
  }

  function weatherStats(w, from, to) {
    if (!w) return null;
    var n = days(from, to), sum = 0, hdd = 0, have = 0;
    for (var k = 1; k <= n; k++) { var t = w[addDay(from, k)]; if (typeof t === 'number') { sum += t; have++; hdd += Math.max(0, HDD_BASE - t); } }
    if (!have || have < n * 0.8) return null;
    return { tOut: +(sum / have).toFixed(1), hdd: +(hdd * n / have).toFixed(0) };
  }

  /** Промежутки между соседними показаниями. */
  function intervals(readings, baseline, weather, tariff, gaps) {
    var pts = points(readings, baseline, gaps), out = [];
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i], d = days(a.date, b.date); if (d <= 0) continue;
      if (a.stop || b.start || !a.h || !b.h) continue;   // период без лічильника или показания неизвестны
      var dE = num(b.h.energy) - num(a.h.energy), dV = (num(b.h.volume) !== null && num(a.h.volume) !== null) ? num(b.h.volume) - num(a.h.volume) : null;
      var dH = (num(b.h.hours) !== null && num(a.h.hours) !== null) ? num(b.h.hours) - num(a.h.hours) : null;
      var it = { from: a.date, to: b.date, id: b.id, days: d, dE: +dE.toFixed(3), month: +(dE / d * 30).toFixed(3), cost: dE > 0 && tariff ? +(dE * tariff).toFixed(2) : 0,
        dV: dV === null ? null : +dV.toFixed(3), dH: dH,
        share: dH === null ? null : Math.max(0, Math.min(1, dH / (d * 24))),               // доля времени, когда счётчик считал (шёл теплоноситель)
        dT: dV > 0 && dE >= 0 ? +(dE / dV * 1000).toFixed(1) : null,                        // средний перепад: 1 м³ воды на 1 °C ≈ 0,001 Гкал
        flow: dV !== null && dH > 0 ? +(dV / dH).toFixed(3) : null };
      var ws = weatherStats(weather, a.date, b.date);
      if (ws) { it.tOut = ws.tOut; it.hdd = ws.hdd; it.perHdd = ws.hdd > 0 && dE > 0 ? +(dE / ws.hdd * 1000).toFixed(2) : null; }   // кГкал (Мкал) на градусо-сутки
      out.push(it);
    }
    return out;
  }

  /** Теплоноситель в момент снятия против графика. status: ok | low | bad | none (теплоносителя нет) | off (не отопительная погода / нет погоды). */
  function coolant(readings, baseline, weather) {
    return points(readings, baseline).filter(function (p) { return p.h && num(p.h.tSupply) !== null; }).map(function (p) {
      var ts = num(p.h.tSupply), tr = num(p.h.tReturn), fl = num(p.h.flow), tOut = weather && typeof weather[p.date] === 'number' ? weather[p.date] : null;
      var g = graph(tOut), st;
      if ((fl !== null && fl <= 0.001) || ts < 30) st = 'none';
      else if (!g) st = 'off';
      else if (ts >= g.supply - OK_TOL) st = 'ok';
      else if (ts >= g.supply - LOW_TOL) st = 'low';
      else st = 'bad';
      return { date: p.date, id: p.id, tSupply: ts, tReturn: tr, dT: tr !== null ? +(ts - tr).toFixed(2) : null, flow: fl, tOut: tOut,
        norm: g ? g.supply : null, normRet: g ? g.ret : null, diff: g ? +(ts - g.supply).toFixed(1) : null, status: st };
    });
  }

  /** Диапазон дат, для которого нужна погода. */
  function range(readings, baseline) { var p = points(readings, baseline); return p.length ? { from: p[0].date, to: p[p.length - 1].date } : null; }

  /*
   * Період без лічильника — скільки тепла й грошей (оцінка за правилами, а не за платіжкою).
   * Методика розподілу №315 (наказ Мінрегіону від 22.11.2018, ред. наказу №358 від 28.12.2021), розд. I п. 5: лічильник на повірці
   * з демонтажем — приміщення НЕ вважається без обліку, обсяг = середньодобове споживання за попередній опалювальний період ×
   * кількість діб. Вихід з ладу / заміна (п. 4 пп. 3) — показання не приймаються, рахують як приміщенню без обліку (частка
   * будинкового за площею, ks = 1); точна сума — лише в платіжці, тут — скільки вийшло б за звичним споживанням квартири.
   * Тариф той самий (грн/Гкал), змінюється лише спосіб визначити обсяг.
   * g: {from, to}; ivs — intervals(…, gaps); o: {today, tariff}. → {days, heatDays, avg (Гкал/добу опалення), perMonth, gcal, cost,
   *   basis: prev|recent|none, season: 2024 (= 2024/25), rows: [{ym, days, heatDays, gcal, cost}]} або null.
   */
  var HEAT_DAY = 0.003;   // Гкал на добу: менше — опалення не було (поза сезоном, вимкнені батареї)
  function perDayAt(ivs, d) { for (var i = 0; i < ivs.length; i++) { var it = ivs[i]; if (it.from < d && d <= it.to) return Math.max(0, it.dE) / it.days; } return null; }
  function seasonOf(d) { var y = +d.slice(0, 4), m = +d.slice(5, 7); return m >= 7 ? y : y - 1; }   // жовтень 2025 … квітень 2026 → 2025
  function seasonAvg(ivs, from, to) {   // Гкал і опалювальні доби на [from, to] з промежутків, де тепло йшло
    var e = 0, hd = 0;
    ivs.forEach(function (it) {
      var a = it.from > from ? it.from : from, b = it.to < to ? it.to : to, n = days(a, b), pd = Math.max(0, it.dE) / it.days;
      if (n > 0 && pd > HEAT_DAY) { e += pd * n; hd += n; }
    });
    return hd >= 14 ? { e: e, hd: hd, avg: e / hd } : null;
  }
  function gapHeat(g, ivs, o) {
    o = o || {}; if (!g || !g.from || !o.today) return null;
    var end = g.to && g.to < o.today ? g.to : o.today, n = Math.max(0, days(g.from, end)), tariff = o.tariff || 0;
    ivs = (ivs || []).filter(function (it) { return it.days > 0; });
    // попередній опалювальний період: знімали влітку — сезон, що щойно скінчився; у сезоні — минулорічний
    var m0 = +g.from.slice(5, 7), ps = m0 >= 5 && m0 <= 9 ? seasonOf(g.from) : seasonOf(g.from) - 1;
    var ref = seasonAvg(ivs, ps + '-09-30', (ps + 1) + '-04-30'), basis = 'prev';
    if (!ref) { ref = seasonAvg(ivs, addDay(g.from, -365), g.from); basis = 'recent'; }   // за рік до зняття
    if (!ref) { ref = seasonAvg(ivs, '2000-01-01', '2999-12-31'); basis = 'recent'; }   // хоч якісь показання з опаленням
    if (!ref) basis = 'none';
    var avg = ref ? ref.avg : 0, rows = [], byYm = {}, hdTot = 0;
    for (var k = 1; k <= n; k++) {
      var d = addDay(g.from, k), ym = d.slice(0, 7), ly = perDayAt(ivs, addDay(d, -365)), md = d.slice(5);
      // опалювальна доба: торік цього дня тепло йшло; немає даних — типовий сезон Харкова (з середини жовтня до середини квітня)
      var heat = ly !== null ? ly > HEAT_DAY : (md >= '10-15' || md <= '04-15');
      if (!byYm[ym]) { byYm[ym] = { ym: ym, days: 0, heatDays: 0, gcal: 0, cost: 0 }; rows.push(byYm[ym]); }
      byYm[ym].days++; if (heat) { byYm[ym].heatDays++; hdTot++; }
    }
    rows.forEach(function (r) { r.gcal = +(avg * r.heatDays).toFixed(3); r.cost = +(r.gcal * tariff).toFixed(2); });
    var gcal = +(avg * hdTot).toFixed(3);
    return { days: n, heatDays: hdTot, avg: +avg.toFixed(4), perMonth: +(avg * 30.44).toFixed(3), gcal: gcal, cost: +(gcal * tariff).toFixed(2), tariff: tariff,
      basis: basis, season: basis === 'prev' ? ps : null, open: !g.to || g.to > o.today, end: end, rows: rows };
  }

  /*
   * Отопительные сезоны из истории — система складывает их сама: промежуток между показаниями идёт в тот сезон, на который
   * приходится его середина (июль–декабрь — сезон этого года, январь–июнь — прошлого: майские показания закрывают зиму,
   * сентябрь—октябрь открывают новую). Внутри сезона — сколько тепла и денег, где тепло реально шло (≥ HEAT_DAY Гкал/сутки).
   * ivs — intervals(…); costFn(iv) — деньги за промежуток (с абонплатой и ЗБП, как в платіжці); today — «поточний сезон».
   * → [{season: 2025, label: '2025/26', gcal, cost, heatDays, from, to (промежутки с теплом), n, ids, perMonth, current}] — новые сверху.
   */
  function seasonKey(from, to) { return seasonOf(from && to > from ? addDay(from, Math.floor(days(from, to) / 2)) : to); }
  function seasons(ivs, costFn, today) {
    var by = {};
    (ivs || []).forEach(function (iv) {
      var k = seasonKey(iv.from, iv.to), s = by[k] || (by[k] = { season: k, gcal: 0, cost: 0, heatDays: 0, from: null, to: null, n: 0, ids: [] });
      s.n++; s.ids.push(iv.id); s.cost += costFn ? costFn(iv) : (iv.cost || 0);
      if (iv.dE > 0) s.gcal += iv.dE;
      if (iv.dE / iv.days >= HEAT_DAY) { s.heatDays += iv.days; if (!s.from || iv.from < s.from) s.from = iv.from; if (!s.to || iv.to > s.to) s.to = iv.to; }
    });
    var cur = today ? seasonOf(today) : null;
    return Object.keys(by).map(Number).sort(function (a, b) { return b - a; }).map(function (k) {
      var s = by[k]; s.gcal = +s.gcal.toFixed(3); s.cost = +s.cost.toFixed(2); s.label = k + '/' + String(k + 1).slice(2);
      s.perMonth = s.heatDays ? +(s.gcal / s.heatDays * 30.44).toFixed(3) : null; s.current = k === cur; return s;
    });
  }

  /*
   * 130-а (власник 13.11: «чому по лічильнику й у ХТМ різні суми»): проміжок через літо (від останніх показань сезону до перших наступного) —
   * тепло двох сезонів: кінець старого (після останніх показань — до відключення) і початок нового. ХТМ кінець сезону нараховує в березні–квітні
   * (тепло до показань кінця сезону), тож у підсумку сезону «лічильника» цю частину кладемо в старий сезон, решту — в новий.
   * iv: {from, to, dE, fromE}; o: {journal: [{date, energy}] — прийняті ХТМ показання між ними (точно), newFrom — з якої дати могло бути тепло
   * нового сезону (за нарахуваннями ХТМ), weather — {дата: °C}}. → {old, nu, sa, sb, by: 'journal'|'days'} | null (один сезон / не поділити).
   */
  var CLIM = { 1: -4.5, 2: -3.8, 3: 1.2, 4: 9.4, 5: 15.8, 6: 19.7, 7: 21.6, 8: 20.6, 9: 14.8, 10: 8.3, 11: 1.9, 12: -2.5 };   // Харків, норма °C по місяцях
  function splitSummer(iv, o) {
    o = o || {}; if (!iv || !iv.from || !iv.to || !(iv.dE > 0)) return null;
    var sa = seasonOf(iv.from), sb = seasonOf(iv.to); if (sa === sb) return null;
    var res = function (old, by) { old = Math.max(0, Math.min(iv.dE, old)); return { old: +old.toFixed(3), nu: +(iv.dE - old).toFixed(3), sa: sa, sb: sb, by: by }; };
    var fe = num(iv.fromE), jp = (o.journal || []).filter(function (p) { return p && p.date > iv.from && p.date < iv.to && seasonOf(p.date) === sa && num(p.energy) !== null; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; }).slice(-1)[0];
    if (jp && fe !== null && num(jp.energy) >= fe) return res(num(jp.energy) - fe, 'journal');
    var oldEnd = (sa + 1) + '-04-15', newFrom = o.newFrom && o.newFrom > sb + '-10-15' ? o.newFrom : sb + '-10-15';
    // вага доби — градусо-доба: погода, якщо дали, інакше середня Харкова за місяць (стабільно, не стрибає після завантаження погоди)
    var w = o.weather, wd = function (d) { var t = w && typeof w[d] === 'number' ? w[d] : CLIM[+d.slice(5, 7)]; return Math.max(0, HDD_BASE - t); };
    var win = function (a, b) { var out = []; for (var d = addDay(a, 1); d <= b; d = addDay(d, 1)) out.push(d); return out; };
    var dOld = win(iv.from, iv.to < oldEnd ? iv.to : oldEnd), dNew = newFrom <= iv.to ? win(addDay(newFrom, -1), iv.to) : [];
    if (!dOld.length && !dNew.length) return null;
    var sum = function (a) { return a.reduce(function (s, d) { return s + wd(d); }, 0); }, wo = sum(dOld), wn = sum(dNew);
    if (!(wo + wn > 0)) return null;
    return res(iv.dE * wo / (wo + wn), 'days');
  }

  /**
   * 138-а: скільки Гкал набігло по лічильнику в кожному календарному місяці — щоб порівняти з нарахуваннями ХТМ по місяцях.
   * Кожен проміжок між показаннями ділимо по добах (from, to] з вагою градусо-доби (погода, якщо дали, інакше норма Харкова за місяць):
   * у холодні місяці тепла йде більше. Тепла немає взагалі (літо) — рівно по добах. ivs — intervals(…); o: {weather}. → {'2026-01': Гкал, …}.
   */
  function monthly(ivs, o) {
    o = o || {}; var w = o.weather, out = {};
    var wd = function (d) { var t = w && typeof w[d] === 'number' ? w[d] : CLIM[+d.slice(5, 7)]; return Math.max(0, HDD_BASE - t); };
    (ivs || []).forEach(function (it) {
      if (!it || !it.from || !it.to || !(it.dE > 0) || it.days > 400) return;
      var ds = [], tot = 0; for (var d = addDay(it.from, 1); d <= it.to; d = addDay(d, 1)) { var x = wd(d); ds.push([d, x]); tot += x; }
      if (!ds.length) return;
      ds.forEach(function (p) { var ym = p[0].slice(0, 7); out[ym] = (out[ym] || 0) + it.dE * (tot > 0 ? p[1] / tot : 1 / ds.length); });
    });
    Object.keys(out).forEach(function (k) { out[k] = +out[k].toFixed(3); });
    return out;
  }

  var api = { monthly: monthly, graph: graph, points: points, intervals: intervals, coolant: coolant, range: range, gapHeat: gapHeat, seasons: seasons, seasonKey: seasonKey, seasonOf: seasonOf, splitSummer: splitSummer, OK_TOL: OK_TOL, LOW_TOL: LOW_TOL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TeploStats = api;
})(typeof window !== 'undefined' ? window : this);
