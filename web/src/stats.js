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

  var api = { graph: graph, points: points, intervals: intervals, coolant: coolant, range: range, OK_TOL: OK_TOL, LOW_TOL: LOW_TOL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TeploStats = api;
})(typeof window !== 'undefined' ? window : this);
