/*
 * «Заповнити з monobank» (114-а, власник 11.11): постачальники й особові рахунки з виписки monobank — у браузері людини.
 * Токен (api.monobank.ua, лише читання) і виписка НЕ йдуть на наш сервер і не зберігаються: так за правилами monobank особистий
 * токен можна використовувати без корпоративного API («дані клієнта не проходять через вузли розробника»).
 * Обмеження API: виписка — не більше 31 доби + 1 год за запит, не частіше 1 разу на 60 с (і client-info — так само).
 * Без DOM: план запитів, розбір платежів за комуналку, рахунок із призначення. Тести — tests/mono.test.js (синтетика).
 */
(function (root) {
  'use strict';
  var API = 'https://api.monobank.ua', TOKEN_URL = 'https://api.monobank.ua/', WIN = 31 * 86400, GAP = 61000, MONTHS = 3, MAX_ACC = 3;
  // \w і \b у JS без прапорця u — лише латиниця: для кирилиці — свої класи (L — літера, E — «далі не літера»)
  var L = '[а-яёіїєґa-z]', E = '(?![а-яёіїєґa-z])';
  function re(src, fl) { return new RegExp(src.replace(/\{L\}/g, L).replace(/\{E\}/g, E), fl || 'i'); }
  // вид послуги за назвою отримувача й описом (укр./рос.). Порядок важливий: «Теплоенерго» — тепло, не світло; «Тепловодоенергія» — тепло.
  var KIND_RE = [
    ['waste', re('сміття|смiття|мусор|вивіз|вывоз|побутових відход|тпв{E}|екоресурс|эко-?ресурс|еко-?сан|благоустр')],
    ['heat', re('тепл|htm{E}|хтм{E}|опален|отоплен')],
    ['gas', re('газ|грм{E}|gaz')],
    ['elec', re('енерг|энерг|електр|электр|yasno|ясно{E}|цек{E}|дтек|світло|свет{E}|energ')],
    ['water', re('водоканал|водопост|водовідв|водоотв|водоснаб|вода|воды|vodokanal|voda')],
    ['house', re('осбб|осмд|жкс|жэк|жек{E}|житл|жилстр|жилкомсер|утриман|содержан|управител|управляюч|квартплат|домофон|ліфт|лифт|кооп')]
  ];
  // підпис рахунку перед цифрами: о/р, ос. рах., особовий рахунок, рахунок, л/с, лицевой счёт, абонент
  var ACC_RE = re('(?:о\\s*/\\s*р|о\\.\\s*р\\.?|ос\\.?\\s*рах(?:унок|\\.)?|особов{L}*\\s+рах{L}*|рахун{L}*|рах\\.|л\\s*/\\s*с|л\\.\\s*с\\.?|лиц\\.?\\s*сч(?:ет|\\.)?|лицев{L}*\\s+сч{L}*|абонент{L}*|аб\\.\\s*|account)\\s*(?:№|#|:|-)?\\s*(\\d[\\d\\-]{2,22}\\d)', 'gi');
  var EIC_RE = /\b(56[0-9A-Z]{14})\b/;
  // типи карток monobank, з яких платять (без банок і кредитних ліній)
  var CARD = { black: 1, white: 2, platinum: 3, iron: 4, yellow: 5, fop: 6, eAid: 7, madeInUkraine: 8 };

  function digits(x) { return String(x || '').replace(/\D/g, ''); }
  function text(it) { return [it.counterName, it.description, it.comment].filter(Boolean).join(' · '); }
  function kindOf(s) { s = String(s || ''); for (var i = 0; i < KIND_RE.length; i++) if (KIND_RE[i][1].test(s)) return KIND_RE[i][0]; return ''; }

  /** Рахунок із призначення/коментаря: {acc, guess} — з підписом («о/р 123456») або, якщо підпису немає, найдовша група з 6–14 цифр
   *  (не телефон 380…, не сума платежу, не дата). guess — без підпису: людина звірить. Нічого — null. */
  function accOf(s, amount) {
    s = String(s || ''); ACC_RE.lastIndex = 0;
    var m, best = null;
    while ((m = ACC_RE.exec(s))) { var d = digits(m[1]); if (d.length >= 4 && d.length <= 20 && (!best || d.length > best.length)) best = d; }
    if (best) return { acc: best, guess: false };
    var amt = amount ? String(Math.abs(Math.round(amount))) : '';
    var cand = (s.replace(/\b\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}\b/g, ' ').match(/\d[\d\-]{4,16}\d/g) || []).map(digits).filter(function (d) {
      if (d.length < 6 || d.length > 14) return false;
      if (/^380\d{9}$/.test(d) || /^0\d{9}$/.test(d)) return false;   // телефони
      return d !== amt;
    });
    if (!cand.length) return null;
    cand.sort(function (a, b) { return b.length - a.length; });
    return { acc: cand[0], guess: true };
  }
  function eicOf(s) { var m = String(s || '').toUpperCase().replace(/\s+/g, '').match(EIC_RE) || String(s || '').toUpperCase().match(EIC_RE); return m ? m[1] : ''; }

  /** Платіж за комуналку: вихідний (amount < 0) і або MCC 4900 (комунальні послуги), або переказ за реквізитами (IBAN / ЄДРПОУ отримувача)
   *  з назвою постачальника. Покупки в магазинах з «енерго» в назві (без IBAN, інший MCC) — ні. */
  function isUtility(it) {
    if (!it || !(it.amount < 0) || it.hold) return false;
    var k = kindOf(text(it));
    if (it.mcc === 4900 || it.originalMcc === 4900) return true;
    return !!k && !!(it.counterIban || it.counterEdrpou);
  }
  /** Згрупувати платежі: один постачальник + рахунок → рядок. Вид — за назвою, MCC 4900 без назви — «інше». */
  function groups(items) {
    var by = {}, out = [];
    (items || []).filter(isUtility).forEach(function (it) {
      var s = text(it), name = String(it.counterName || it.description || '').trim(), k = kindOf(s), a = accOf([it.description, it.comment].filter(Boolean).join(' · '), (it.amount || 0) / 100);
      var key = (digits(it.counterEdrpou) || name.toLowerCase().replace(/\s+/g, ' ')) + '|' + (a ? a.acc : '');
      var g = by[key];
      if (!g) { g = by[key] = { key: key, kind: k || 'other', name: name, edrpou: digits(it.counterEdrpou), iban: String(it.counterIban || ''), acc: a ? a.acc : '', guess: !!(a && a.guess), eic: eicOf(s), n: 0, total: 0, last: 0, lastAmt: 0, months: {} }; out.push(g); }
      if (a && !a.guess && g.guess) { g.acc = a.acc; g.guess = false; }
      if (!g.eic) g.eic = eicOf(s);
      g.n++; g.total += -it.amount / 100;
      var d = new Date(it.time * 1000), ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); g.months[ym] = 1;
      if (it.time > g.last) { g.last = it.time; g.lastAmt = -it.amount / 100; }
    });
    // той самий постачальник без рахунку, коли в іншому рядку він є, — злити в рядок із рахунком (один платіж призначення не мав)
    var withAcc = {}; out.forEach(function (g) { if (g.acc) withAcc[g.key.split('|')[0]] = g; });
    out = out.filter(function (g) {
      var w = !g.acc && withAcc[g.key.split('|')[0]]; if (!w) return true;
      w.n += g.n; w.total += g.total; Object.keys(g.months).forEach(function (m) { w.months[m] = 1; }); if (g.last > w.last) { w.last = g.last; w.lastAmt = g.lastAmt; } return false;
    });
    out.forEach(function (g) { g.total = Math.round(g.total * 100) / 100; g.nMonths = Object.keys(g.months).length; delete g.months; });
    var ord = { heat: 1, water: 2, elec: 3, gas: 4, waste: 5, house: 6, other: 7 };
    return out.sort(function (a, b) { return (ord[a.kind] - ord[b.kind]) || (b.acc ? 1 : 0) - (a.acc ? 1 : 0) || b.last - a.last; });
  }
  /** Газ: 10 цифр, що починаються з 1, — рахунок Газмереж (доставка, ГРМ); 9 цифр або «Нафтогаз»/«газопостач» у назві — рахунок постачальника. */
  function gasField(g) {
    var d = digits(g.acc), nm = String(g.name || '');
    if (re('газмереж|газорозпод|грм{E}|газ\\s*мереж').test(nm) || (d.length === 10 && /^1/.test(d))) return 'grm';
    return 'account';
  }
  /** Картки, з яких читати виписку: гривневі, не більше MAX_ACC, чорна першою. */
  function cards(info) {
    return ((info && info.accounts) || []).filter(function (a) { return a && a.currencyCode === 980 && CARD[a.type]; })
      .sort(function (a, b) { return CARD[a.type] - CARD[b.type]; }).slice(0, MAX_ACC);
  }
  /** План запитів: спершу останні 31 добу кожної картки, потім глибше (до MONTHS місяців). now — у секундах. */
  function plan(accs, now, months) {
    var n = Math.max(1, Math.min(6, months || MONTHS)), out = [];
    for (var w = 0; w < n; w++) accs.forEach(function (a) { var to = now - w * WIN; out.push({ acc: a.id, type: a.type, from: to - WIN + 60, to: to }); });
    return out;
  }
  /** Запит до API з токеном (у браузері — напряму, CORS у monobank відкритий). Повертає {ok, status, data, error}. */
  function req(path, token, fetchFn) {
    var f = fetchFn || (typeof fetch === 'function' ? fetch : null);
    if (!f) return Promise.resolve({ ok: false, status: 0, error: 'no_fetch' });
    return f(API + path, { headers: { 'X-Token': token }, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' }).then(function (r) {
      return r.text().then(function (txt) { var j = null; try { j = JSON.parse(txt); } catch (e) { /* не JSON */ }
        if (r.status === 200) return { ok: true, status: 200, data: j };
        return { ok: false, status: r.status, error: r.status === 403 || r.status === 401 ? 'token' : r.status === 429 ? 'rate' : 'http', text: j && j.errorDescription ? String(j.errorDescription).slice(0, 80) : '' };
      });
    }, function () { return { ok: false, status: 0, error: 'network' }; });
  }
  function clientInfo(token, f) { return req('/personal/client-info', token, f); }
  function statement(token, q, f) { return req('/personal/statement/' + encodeURIComponent(q.acc) + '/' + Math.floor(q.from) + '/' + Math.floor(q.to), token, f); }
  /** Схожий на токен monobank: 40–50 символів base64url. Порожнє й явно не те — відсіяти до запиту. */
  function tokenOk(s) { return /^[A-Za-z0-9_\-]{30,64}$/.test(String(s || '').trim()); }

  var api = { API: API, TOKEN_URL: TOKEN_URL, WIN: WIN, GAP: GAP, MONTHS: MONTHS, kindOf: kindOf, accOf: accOf, eicOf: eicOf, isUtility: isUtility, groups: groups, gasField: gasField,
    cards: cards, plan: plan, clientInfo: clientInfo, statement: statement, tokenOk: tokenOk };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TeploMono = api;
})(typeof window !== 'undefined' ? window : this);
