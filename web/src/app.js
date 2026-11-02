/*
 * Теплосервис — веб-приложение (бесплатная часть). Vanilla JS, без сборки и зависимостей.
 * Данные — в localStorage этого браузера (с запасным хранением в памяти).
 * Маршруты — #имя (welcome, home, meter, baseline, step-N, check, handover, status, history, help, prefs).
 * Экраны помечены data-screen (S00…S11 из design/04-NAV-MAP.md), элементы — data-key.
 */
(function () {
  'use strict';
  var R = window.TeploRules, M = window.TeploModels, I = window.TeploI18n;
  var HTM_URL = 'https://www.hts.kharkov.ua/cabinet/login';
  var BOT_URL = 'https://t.me/KPHTM_Bot';

  // ---------------- хранение ----------------
  var KEY = 'teplo.v1', memory = null;
  function defaults() { return { v: 1, lang: 'uk', onboarded: false, meter: null, baseline: null, contacts: { phone: '', email: '' }, readings: [], draft: null, demoToday: '', focusId: null }; }
  function load() {
    try { var s = window.localStorage.getItem(KEY); if (s) return Object.assign(defaults(), JSON.parse(s)); } catch (e) { /* нет хранилища */ }
    return memory || defaults();
  }
  // ---- квартиры: у каждой свой адрес, счётчик, последние принятые и история. S.meter/S.baseline — данные активной квартиры.
  function places() { return (S.places || []).filter(function (p) { return p && !p.deleted; }); }
  function place(id) { var k = id || S.placeId; return places().filter(function (p) { return p.id === k; })[0] || null; }
  function ensurePlaces() {
    if (!Array.isArray(S.places)) S.places = [];
    if (!places().length) S.places.push({ id: S.places.length ? 'p' + Date.now().toString(36) : 'main', name: '', meter: S.meter || null, baseline: S.baseline || null, updatedAt: 0 });
    if (!S.placeId || !place(S.placeId)) { var f = places()[0]; S.placeId = f.id; S.meter = f.meter || S.meter || null; S.baseline = f.baseline || S.baseline || null; }
  }
  /** Перенести текущие S.meter/S.baseline в запись активной квартиры (перед сохранением). */
  function syncPlace() {
    ensurePlaces(); var p = place();
    if (JSON.stringify(p.meter || null) !== JSON.stringify(S.meter || null) || JSON.stringify(p.baseline || null) !== JSON.stringify(S.baseline || null)) { p.meter = S.meter || null; p.baseline = S.baseline || null; p.updatedAt = Date.now(); }
  }
  function placeLabel(p) { return (p && p.name) || t('pl_unnamed', { n: places().indexOf(p) + 1 }); }
  /** Переключатель квартир (если их больше одной). */
  function placeSwitch() {
    var ps = places(); if (ps.length < 2) return '';
    return '<div class="place-sw" data-key="place-switch">' + ico('home', 18) + '<select id="place-sel" aria-label="' + esc(t('pl_switch')) + '">' + ps.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === S.placeId ? ' selected' : '') + '>' + esc(placeLabel(p)) + '</option>'; }).join('') + '</select></div>';
  }
  function switchPlace(id) {
    syncPlace(); var p = place(id); if (!p || id === S.placeId) return;
    S.placeId = id; S.meter = p.meter || null; S.baseline = p.baseline || null; S.draft = null; S.focusId = null; save();
  }
  function persist() { memory = S; try { window.localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* только память */ } }
  var lastSig = '', pendingRender = false;
  /** Сохранить: локально всегда; если изменились синхронизируемые данные — отметить время и отправить на другие устройства. */
  function save() {
    syncPlace();
    var Y = window.TeploSync;
    if (Y) { var sg = Y.sig(Y.payload(S)); if (sg !== lastSig) { lastSig = sg; S.updatedAt = Date.now(); persist(); Y.push(); return; } }
    persist();
  }
  /** Пришли данные с другого устройства (уже слитые с локальными). */
  function applyRemote(m) {
    var keep = { lang: S.lang, demoToday: S.demoToday, focusId: S.focusId, _pickModel: S._pickModel, syncPromptDismissed: S.syncPromptDismissed, placeId: S.placeId, theme: S.theme };
    S = Object.assign(defaults(), m, keep);
    ensurePlaces(); var ap = place(); if (ap && (ap.meter || ap.baseline || S.places.length > 1)) { S.meter = ap.meter || null; S.baseline = ap.baseline || null; }
    lastSig = window.TeploSync.sig(window.TeploSync.payload(S)); persist();
    safeRender();
  }
  function safeRender() {
    var a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { pendingRender = true; return; }
    render(true);
  }
  /** Язык интерфейса — по основному языку браузера: русский → ru, любой другой → uk. Переключателя нет. */
  function browserLang() {
    var tw = window.Telegram && window.Telegram.WebApp, tu = tw && tw.initDataUnsafe && tw.initDataUnsafe.user;
    var l = (tu && tu.language_code) || (navigator.languages && navigator.languages[0]) || navigator.language || '';
    return /^ru\b/i.test(l) ? 'ru' : 'uk';
  }
  var S = load(); ensurePlaces();
  // ---- тема: авто (как в системе / Telegram) · светлая · тёмная; выбор хранится на этом устройстве
  function resolvedTheme() {
    var th = S.theme || 'auto'; if (th !== 'auto') return th;
    var tw0 = window.Telegram && window.Telegram.WebApp; if (tw0 && tw0.initData && tw0.colorScheme) return tw0.colorScheme === 'dark' ? 'dark' : 'light';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyTheme() {
    var th = resolvedTheme(), bg = th === 'dark' ? '#0E1412' : '#E9EEEB';
    document.documentElement.setAttribute('data-theme', th);
    var mt = document.querySelector('meta[name="theme-color"]'); if (mt) mt.setAttribute('content', bg);
    var tw1 = window.Telegram && window.Telegram.WebApp; if (tw1 && tw1.initData) { try { tw1.setHeaderColor && tw1.setHeaderColor(bg); tw1.setBackgroundColor && tw1.setBackgroundColor(bg); } catch (e) { /* старый клиент */ } }
  }
  applyTheme();
  if (window.matchMedia) { var mq = window.matchMedia('(prefers-color-scheme: dark)'); var onMq = function () { if ((S.theme || 'auto') === 'auto') { applyTheme(); if (typeof render === 'function') safeRender(); } }; if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq); }
  var ADMIN = null, LINKWAIT = false;
  // Вкладка открыта давно (на телефоне вкладки живут днями) — после обновления сайта в ней старый код.
  // При возврате на вкладку и при запуске сверяем версию сборки и тихо перезагружаемся, если ничего не делается.
  function checkBuild() {
    if (!window.TEPLO_API || !window.TEPLO_BUILD || /^__/.test(window.TEPLO_BUILD)) return;
    fetch(window.TEPLO_API + '/config', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !j.build || j.build === window.TEPLO_BUILD) return;
      if (typeof PH !== 'undefined' && PH.status === 'working') return;
      var k = 'teplo.reload.' + j.build; try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1'); } catch (e) { /* без хранилища */ }
      location.reload();
    }, function () {});
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') checkBuild(); });
  window.addEventListener('pageshow', function (e) { if (e.persisted) checkBuild(); });
  setTimeout(checkBuild, 1500);
  // вернулся из бота после привязки — обновить аккаунт, чтобы сразу было видно «Telegram: @…»
  document.addEventListener('visibilitychange', function () {
    if (!LINKWAIT || document.visibilityState !== 'visible' || !window.TEPLO_API) return;
    fetch(window.TEPLO_API + '/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.user && window.TeploSync) { window.TeploSync.account = j.user; if (j.user.telegram) { LINKWAIT = false; toast(t('acct_link_done')); } safeRender(); }
    }, function () {});
  });   // владелец сервиса (по /api/admin/me) — видит «Статистику» (пока только ему)
  function checkAdmin() {
    if (ADMIN !== null || !window.TEPLO_API || !Y().account) return; ADMIN = false;
    fetch(window.TEPLO_API + '/admin/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); })
      .then(function (j) { ADMIN = !!(j && j.admin); if (ADMIN) safeRender(); }, function () { ADMIN = null; });
  }
  S.lang = browserLang();
  if (window.TeploSync) lastSig = window.TeploSync.sig(window.TeploSync.payload(S));
  var Y = function () { return window.TeploSync || { mode: 'local', account: null, status: 'idle' }; };
  var VIS = function () { return window.TeploVision || { available: false }; };

  // ---------------- утилиты ----------------
  function t(key, vars) {
    var s = (I.T[S.lang] && I.T[S.lang][key]) || I.T.uk[key] || key;
    if (vars) for (var k in vars) s = s.split('{' + k + '}').join(vars[k]);
    return s;
  }
  function L(o) { return o ? (o[S.lang] || o.uk || '') : ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function today() { return S.demoToday || R.ymd(new Date()); }
  function dateParts(ymd) { var p = ymd.split('-'); return { y: +p[0], m: +p[1], d: +p[2] }; }
  function fmtDate(ymd, withYear) { if (!ymd) return ''; var p = dateParts(ymd); return p.d + ' ' + I.MONTHS[S.lang][p.m - 1] + (withYear ? ' ' + p.y : ''); }
  function addDays(ymd, n) { var p = dateParts(ymd); var d = new Date(Date.UTC(p.y, p.m - 1, p.d + n)); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }
  function dayOfMonth(ymd, day) { var p = dateParts(ymd); return p.y + '-' + ('0' + p.m).slice(-2) + '-' + ('0' + day).slice(-2); }
  function nextMonthDay(ymd, day) { var p = dateParts(ymd); var d = new Date(Date.UTC(p.y, p.m, day)); return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2); }
  function ago(iso) {
    var m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (m < 1) return t('ago_now'); if (m < 60) return t('ago_min', { n: m });
    var h = Math.round(m / 60); if (h < 48) return t('ago_h', { n: h }); return t('ago_d', { n: Math.round(h / 24) });
  }
  function money(n) { return (Math.round(n * 100) / 100).toLocaleString(S.lang === 'ru' ? 'ru-RU' : 'uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function uid() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function model() { return S.meter ? M.byId(S.meter.modelId) : null; }
  function modelName(m) { return m ? (m.id === 'other' ? (S.lang === 'ru' ? 'Другая модель' : 'Інша модель') : (m.vendor && m.vendor !== '—' ? m.vendor + ' ' : '') + m.name) : ''; }
  var UNIT_LBL = { Gcal: { uk: 'Гкал', ru: 'Гкал' }, MWh: { uk: 'МВт·год', ru: 'МВт·ч' }, kWh: { uk: 'кВт·год', ru: 'кВт·ч' }, GJ: { uk: 'ГДж', ru: 'ГДж' } };
  function unitLbl(u) { return L(UNIT_LBL[u] || UNIT_LBL.Gcal); }
  function energyUnit() { return (S.meter && S.meter.unit) || 'Gcal'; }
  function field(key) { return R.FIELDS.filter(function (f) { return f.key === key; })[0]; }
  function fieldLabel(key) { var f = field(key); return f ? (S.lang === 'ru' ? f.ru : f.uk) : key; }
  function fieldUnit(key) {
    if (key === 'energy') return unitLbl(energyUnit());
    var u = (field(key) || {}).unit || '';
    if (S.lang === 'ru') u = u.replace('год', 'ч').replace('м³/год', 'м³/ч');
    return u;
  }

  // ---------------- иконки ----------------
  var ICONS = {
    home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    drop: '<path d="M12 3.5c3 4 6 7.2 6 10.5a6 6 0 0 1-12 0c0-3.3 3-6.5 6-10.5z"/>',
    flame: '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 1.6 1.2 2.6 2.5 3 0-3-.7-5.5 0-8z"/>',
    shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/>',
    history: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/>',
    prefs: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    back: '<path d="M15 5l-7 7 7 7"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', cross: '<path d="M7 7l10 10M17 7L7 17"/>',
    alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    thermo: '<path d="M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 10v6"/>',
    chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-5M12 16V8M16 16v-3"/>',
    leaf: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14"/><path d="M5 19l7-7"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    press: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'
  };
  function ico(name, size, cls) {
    return '<svg class="ico ' + (cls || '') + '" width="' + (size || 24) + '" height="' + (size || 24) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  }
  function logo() {
    return '<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" fill="none" stroke-width="3.2" stroke-linecap="round">' +
      '<path d="M5 7h12a5 5 0 0 1 5 5" style="stroke:var(--c-supply)"/><path d="M22 16a5 5 0 0 1-5 5H5" style="stroke:var(--c-return)"/><path d="M22 12v4" stroke="currentColor" stroke-width="2"/></svg>';
  }
  function levelIco(level, size) {
    return level === 'ok' ? ico('check', size, 'c-ok') : level === 'warn' ? ico('alert', size, 'c-warn') : level === 'block' ? ico('cross', size, 'c-bad') : ico('info', size, 'c-info');
  }

  // ---------------- семисегментный экран (подпись дизайна) ----------------
  var SEG = { '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
    '-': 'g', 'E': 'adefg', 'r': 'eg', 'h': 'cefg', 'o': 'cdeg', 'n': 'ceg', 'C': 'adef', 't': 'defg', 'H': 'bcefg', 'L': 'def', 'P': 'abefg', 'A': 'abcefg', 'U': 'bcdef', 'F': 'aefg', 'b': 'cdefg', 'd': 'bcdeg', ' ': '' };
  var POLY = { a: '4,2 6,0 16,0 18,2 16,4 6,4', g: '4,19 6,17 16,17 18,19 16,21 6,21', d: '4,36 6,34 16,34 18,36 16,38 6,38',
    f: '2,4 4,6 4,16 2,18 0,16 0,6', b: '20,4 22,6 22,16 20,18 18,16 18,6', e: '2,21 4,23 4,33 2,35 0,33 0,23', c: '20,21 22,23 22,33 20,35 18,33 18,23' };
  function segSvg(text, label) {
    var s = String(text == null ? '' : text).replace(',', '.');
    var x = 6, parts = [];
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === '.') { parts.push('<circle class="on" cx="' + (x - 3) + '" cy="36.5" r="2.4"/>'); x += 4; continue; }
      var map = SEG.hasOwnProperty(ch) ? SEG[ch] : (SEG.hasOwnProperty(ch.toUpperCase()) ? SEG[ch.toUpperCase()] : '');
      var g = '<g transform="translate(' + x + ',0)">';
      'abcdefg'.split('').forEach(function (k) { g += '<polygon class="' + (map.indexOf(k) >= 0 ? 'on' : 'off') + '" points="' + POLY[k] + '"/>'; });
      parts.push(g + '</g>'); x += 28;
    }
    var w = Math.max(x, 30);
    return '<svg class="seg" viewBox="0 -1 ' + w + ' 40" role="img" aria-label="' + esc(label || s) + '"><g transform="skewX(-6)">' + parts.join('') + '</g></svg>';
  }
  /** lines: [{id, text, tag, corner, sample}] */
  function lcd(lines, cls) {
    return '<div class="lcd ' + (cls || '') + '">' + lines.map(function (ln) {
      var tag = ln.tag ? '<span class="tag' + (ln.corner ? ' corner' : '') + '">' + esc(ln.tag) + '</span>' : '';
      return '<div class="line' + (ln.sample ? ' sample' : '') + '"' + (ln.id ? ' id="' + ln.id + '"' : '') + '>' + segSvg(ln.text, ln.label) + (ln.corner ? '' : tag) + '</div>' + (ln.corner ? tag : '');
    }).join('') + '</div>';
  }

  // ---------------- окно приёма ----------------
  function windowBanner() {
    var w = R.windowState(today()), td = today();
    var opens = w.state === 'closed_before' ? dayOfMonth(td, 5) : nextMonthDay(td, 5);
    var last = fmtDate(dayOfMonth(td, 25)), rec = fmtDate(dayOfMonth(td, 23));
    var map = {
      closed_before: ['warn', 'clock', t('win_closed_before', { date: fmtDate(opens) }), t('win_closed_before_sub')],
      open: ['info', 'info', t('win_open', { last: last, rec: rec }), t('win_open_sub')],
      soon_recommended: ['info', 'info', t('win_soon', { days: w.daysLeft, rec: rec }), t('win_open_sub')],
      late: ['warn', 'alert', t('win_late', { last: last }), t('win_open_sub')],
      last_day: ['warn', 'alert', t('win_last'), t('win_open_sub')],
      closed_after: ['warn', 'clock', t('win_closed_after', { date: fmtDate(opens) }), t('win_closed_after_sub')]
    }[w.state];
    return '<div class="banner ' + map[0] + '" data-key="window-banner" data-state="' + w.state + '" role="status">' + ico(map[1], 22) + '<div><p><b>' + esc(map[2]) + '</b></p><p>' + esc(map[3]) + '</p></div></div>';
  }
  function windowClosed() { var s = R.windowState(today()).state; return s === 'closed_before' || s === 'closed_after'; }

  // ---------------- мастер: шаги ----------------
  function steps() { var m = model(); return [{ kind: 'date' }].concat(m ? m.steps : []); }
  function prevForEntry() {
    if (!S.baseline) return null;
    var p = Object.assign({}, S.baseline), k = M.TO_GCAL[energyUnit()] || 1, e = R.num(p.energy);
    if (e !== null) p.energy = +(e / k).toFixed(6);
    return p;
  }
  function draftReadingGcal(d) {
    var v = Object.assign({ date: d.date }, d.values), k = M.TO_GCAL[energyUnit()] || 1, e = R.num(v.energy);
    if (e !== null) v.energy = +(e * k).toFixed(6);
    v.errCode = R.normCode(v.errCode);
    return v;
  }
  function meterInfo() {
    var m = model() || {};
    return { hoursOnlyWithFlow: !!m.hoursOnlyWithFlow, transitionalFlow: S.meter && R.num(S.meter.transitionalFlow), verifiedUntil: S.meter && S.meter.verifiedUntil || null };
  }
  function runCheck(d) {
    var res = R.validate({ reading: draftReadingGcal(d), prev: S.baseline, meter: meterInfo(), today: today() });
    if (windowClosed()) {
      res.items.unshift({ code: 'W_WINDOW', level: 'block', field: null, msg: { uk: I.T.uk.c_window_block, ru: I.T.ru.c_window_block }, fix: { uk: I.T.uk.c_window_fix, ru: I.T.ru.c_window_fix } });
      res.verdict = 'block';
    }
    var pc = d.photoConf || {};
    Object.keys(pc).forEach(function (k) {
      if (pc[k] < 0.75) { res.items.push({ code: 'V_LOW_CONF', level: 'warn', field: k, msg: { uk: I.T.uk.v_low_conf, ru: I.T.ru.v_low_conf }, fix: { uk: I.T.uk.v_low_conf_fix, ru: I.T.ru.v_low_conf_fix } }); if (res.verdict === 'ok') res.verdict = 'warn'; }
    });
    return res;
  }
  function stepOfField(key) { var st = steps(); for (var i = 0; i < st.length; i++) { if (st[i].kind === 'date' && key === 'date') return i; if (st[i].fields && st[i].fields.indexOf(key) >= 0) return i; } return 1; }
  function newDraft() { S.draft = { date: today(), values: {}, step: 0, startedAt: new Date().toISOString() }; save(); }

  // ---------------- оболочка ----------------
  /** Кнопка в шапке: светлая ↔ тёмная (запоминается на устройстве; «как в системе» — в Налаштуваннях). */
  function themeBtn() {
    var dark = resolvedTheme() === 'dark', lbl = dark ? t('th_to_light') : t('th_to_dark');
    return '<button type="button" class="theme-btn" data-act="theme-toggle" data-key="theme-toggle" aria-label="' + esc(lbl) + '" title="' + esc(lbl) + '">' + ico(dark ? 'sun' : 'moon', 22) + '</button>';
  }
  function shell(view) {
    var route = view.route, bare = view.bare;
    var navItems = [['home', 'home', 'nav_home'], ['history', 'history', 'nav_history'], ['stats', 'chart', 'nav_stats']].concat([['save', 'leaf', 'nav_save'], ['help', 'help', 'nav_help'], ['prefs', 'prefs', 'nav_prefs']]);
    var nav = bare ? '' : '<nav class="nav" style="--nav-n:' + navItems.length + '" aria-label="' + esc(t('brand')) + '">' + navItems.map(function (n) {
      return '<a href="#' + n[0] + '"' + (route === n[0] || (n[0] === 'home' && /^(heat|water-)/.test(route)) ? ' aria-current="page"' : '') + ' data-key="nav-' + n[0] + '">' + ico(n[1], 22) + '<span>' + esc(t(n[2])) + '</span></a>';
    }).join('') + '</nav>';
    var right = bare && view.closeTo
      ? '<a class="btn ghost" href="#' + view.closeTo + '" data-key="wiz-close" aria-label="' + esc(t('close')) + '">' + ico('close', 22) + '<span class="cl-txt">' + esc(t('close')) + '</span></a>'
      : '';
    return '<div class="app' + (bare ? ' bare-app' : '') + '">' +
      '<header class="top"><a class="brand" href="#home" data-key="brand">' + logo() + '<span>' + esc(t('brand')) + '</span></a>' + (window.TEPLO_API ? '<span class="beta" title="' + esc(t('beta_sub')) + '">' + esc(t('beta')) + '</span>' : '') + '<span class="spacer"></span>' + themeBtn() + right + '</header>' +
      nav + '<main class="main' + (bare ? ' bare' : '') + '" id="main" data-screen="' + view.screen + '" tabindex="-1">' + (['home', 'heat', 'water-hot', 'water-cold', 'history', 'stats', 'save'].indexOf(route) >= 0 ? placeSwitch() : '') + view.html + '</main></div>' +
      (window.TEPLO_API ? '<button class="fab' + (bare ? ' fab-bare' : '') + '" data-act="fb-open" data-key="feedback" aria-haspopup="dialog">' + ico('chat', 20) + '<span>' + esc(t('fb_btn')) + '</span></button>' + fbDialog() : '') +
      '<div id="toast-host" aria-live="polite"></div>';
  }


  // ---------------- отзыв (плавающая кнопка) ----------------
  var FB = { open: false, sending: false, text: '', contact: '', err: '' };
  function fbDialog() {
    if (!FB.open) return '';
    var acc = Y().account;
    return '<div class="fb-back" data-act="fb-close"></div><div class="fb" role="dialog" aria-modal="true" aria-labelledby="fb-h" data-key="feedback-dialog">' +
      '<h2 id="fb-h">' + esc(t('fb_title')) + '</h2><p class="small muted">' + esc(t('fb_sub')) + '</p>' +
      '<label class="lbl" for="fb-text">' + esc(t('fb_text')) + '</label><textarea id="fb-text" rows="5" maxlength="4000">' + esc(FB.text) + '</textarea>' +
      (acc ? '' : '<label class="lbl" for="fb-contact">' + esc(t('fb_contact')) + '</label><input id="fb-contact" type="text" maxlength="190" autocomplete="email" value="' + esc(FB.contact) + '">') +
      (FB.err ? '<p class="help bad" role="alert">' + esc(FB.err) + '</p>' : '') +
      '<div class="row-actions"><button class="btn sec" data-act="fb-close">' + esc(t('cancel')) + '</button><button class="btn" data-act="fb-send" data-key="feedback-send"' + (FB.sending ? ' disabled aria-busy="true"' : '') + '>' + esc(t('fb_send')) + '</button></div></div>';
  }
  function fbSend() {
    var te = document.getElementById('fb-text'), ce = document.getElementById('fb-contact');
    FB.text = te ? te.value : FB.text; FB.contact = ce ? ce.value : '';
    if (FB.text.trim().length < 2) { FB.err = t('fb_empty'); render(true); return; }
    var main = document.getElementById('main');
    var body = { text: FB.text, contact: FB.contact, page: '#' + (routeName() || 'home'), screen: main ? main.getAttribute('data-screen') : '', lang: S.lang };
    var api = window.TeploSync && window.TeploSync.api;
    FB.sending = true; FB.err = ''; render(true);
    (api ? api('POST', '/feedback', body) : Promise.reject()).then(function (j) {
      FB.sending = false;
      if (j && j._status === 200) { FB.open = false; FB.text = ''; FB.contact = ''; render(true); toast(t('fb_ok')); return; }
      FB.err = j && j._status === 429 ? t('fb_rate') : t('fb_fail'); render(true);
    }, function () { FB.sending = false; FB.err = t('fb_fail'); render(true); });
  }

  /** Только на тестовый период: обнулиться и пройти всё как при первом открытии (стирает и на сервере, вход остаётся). */
  function testReset() {
    return '<div class="panel test-reset" data-key="test-reset"><h2>' + esc(t('tr_title')) + '</h2><p class="small muted">' + esc(t('tr_sub')) + '</p>' +
      '<button class="btn danger" data-act="wipe-ask" data-test="1" data-key="test-reset-btn">' + esc(t('tr_btn')) + '</button><div id="wipe-confirm"></div></div>';
  }

  // ---------------- экраны ----------------
  var V = {};

  // ================= ВОДА: водомеры квартиры, показания, передача =================
  var Wt = window.TeploWater;
  function wcfg() { var p = place(); return (p && p.water) || { account: '', surname: '', meters: [] }; }
  function wsetCfg(fn) { ensurePlaces(); var p = place(); p.water = JSON.parse(JSON.stringify(wcfg())); fn(p.water); p.updatedAt = Date.now(); save(); }
  function wmeters(kind) { return (wcfg().meters || []).filter(function (m) { return m && !m.deleted && (!kind || m.kind === kind); }); }
  function wrecs() { return (S.water || []).filter(function (r) { return r && !r.deleted && r.place === S.placeId; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.base ? -1 : b.base ? 1 : 0; }); }
  /** Последние внесённые показания (стартовые при настройке — не в счёт: их не передают). */
  function wlast() { var a = wrecs().filter(function (r) { return !r.base; }); return a.length ? a[a.length - 1] : null; }
  function wprevFor(mid, beforeDate) { var a = wrecs().filter(function (r) { return r.vals && r.vals[mid] !== undefined && r.vals[mid] !== '' && (!beforeDate || r.date < beforeDate || (r.base && r.date === beforeDate)); }); return a.length ? a[a.length - 1] : null; }
  function wname(m) { return (m.kind === 'hot' ? t('wt_hot') : t('wt_cold')) + (m.name ? ' · ' + m.name : ''); }
  function wkindTitle(k) { return k === 'hot' ? t('wt_hot_t') : t('wt_cold_t'); }
  function thisMonth(d) { return String(d || '').slice(0, 7) === today().slice(0, 7); }
  function wsentVk(r) { return r && r.sent && r.sent.vk; }
  function wsentHtm(r) { return r && r.sent && r.sent.htm; }
  var WICO = { hot: 'drop', cold: 'drop' };

  /** Карточка на главной: последнее, срок, «+» — сразу к вводу. */
  function ucard(o) {
    return '<div class="ucard ucard-' + o.kind + '" data-key="card-' + o.kind + '">' +
      '<a class="ucard-main" href="#' + o.href + '">' +
        '<span class="ucard-top">' + ico(o.icon, 20) + '<span class="ucard-title">' + esc(o.title) + '</span></span>' +
        '<span class="ucard-val num">' + o.value + '</span>' +
        '<span class="ucard-sub">' + esc(o.sub || '') + '</span>' +
        (o.status ? '<span class="ucard-status ' + (o.tone || '') + '">' + esc(o.status) + '</span>' : '') +
      '</a>' +
      '<button type="button" class="ucard-add" data-act="' + o.addAct + '"' + (o.addKind ? ' data-kind="' + o.addKind + '"' : '') + ' data-key="card-' + o.kind + '-add" aria-label="' + esc(o.addLabel) + '" title="' + esc(o.addLabel) + '">' + ico('plus', 26) + '</button></div>';
  }
  function heatCard() {
    if (!S.meter) return ucard({ kind: 'heat', href: 'meter', icon: 'thermo', title: t('uc_heat'), value: '—', sub: t('uc_heat_setup'), addAct: 'setup-heat', addLabel: t('uc_heat_setup_btn') });
    var last = RD().filter(function (r) { return r.htm && r.htm.date; }).slice(-1)[0], base = S.baseline;
    var src = last && (!base || last.htm.date >= base.date) ? { date: last.htm.date, energy: last.htm.energy, own: true, status: last.status } : base ? { date: base.date, energy: base.energy } : null;
    var w = R.windowState(today()), st = '', tone = '';
    if (last && thisMonth(last.htm.date) && (last.status === 'handed' || last.status === 'accepted')) { st = last.status === 'accepted' ? t('uc_heat_ok') : t('uc_heat_handed'); tone = 'ok'; }
    else if (w.state === 'open' || w.state === 'soon_recommended') { st = t('uc_heat_due', { d: fmtDate(dayOfMonth(today(), 25)) }); tone = 'due'; }
    else if (w.state === 'late' || w.state === 'last_day') { st = t('uc_heat_late', { d: fmtDate(dayOfMonth(today(), 25)) }); tone = 'warn'; }
    else st = t('uc_heat_closed', { d: fmtDate(w.state === 'closed_before' ? dayOfMonth(today(), 5) : nextMonthDay(today(), 5)) });
    return ucard({ kind: 'heat', href: 'heat', icon: 'thermo', title: t('uc_heat'), value: src ? esc(R.formatForHtm('energy', src.energy)) + ' <small>Гкал</small>' : '—',
      sub: src ? (src.own ? t('uc_from_you', { d: fmtDate(src.date) }) : t('uc_from_htm', { d: fmtDate(src.date) })) : t('h_last_none'), status: st, tone: tone, addAct: 'read', addLabel: t('uc_add_heat') });
  }
  function waterCard(kind) {
    var ms = wmeters(kind), title = wkindTitle(kind);
    if (!ms.length) return ucard({ kind: kind, href: 'water-' + kind, icon: 'drop', title: title, value: '—', sub: t('uc_w_setup'), addAct: 'wsetup', addKind: kind, addLabel: t('uc_w_setup_btn') });
    var last = wlast(), vals = ms.map(function (m) { var r = wprevFor(m.id); return r ? Wt.whole(r.vals[m.id]) : null; });
    var value = ms.length === 1 ? (vals[0] === null ? '—' : vals[0] + ' <small>м³</small>') : ms.map(function (m, i) { return '<span class="ucard-multi">' + esc(m.name || String(i + 1)) + ' <b>' + (vals[i] === null ? '—' : vals[i]) + '</b></span>'; }).join('') + ' <small>м³</small>';
    var w = Wt.vkWindow(today()), st, tone = '';
    var done = last && thisMonth(last.date) && wsentVk(last) && (kind === 'cold' || wsentHtm(last));
    if (done) { st = t('uc_w_sent'); tone = 'ok'; }
    else if (last && thisMonth(last.date)) { st = t('uc_w_ready'); tone = 'due'; }
    else if (w.open) { st = t('uc_w_due', { d: fmtDate(w.deadline) }); tone = w.daysLeft <= 3 ? 'warn' : 'due'; }
    else st = t('uc_w_next', { d: fmtDate(nextMonthDay(today(), Wt.VK_DEADLINE)) });
    return ucard({ kind: kind, href: 'water-' + kind, icon: 'drop', title: title, value: value, sub: last ? t('uc_w_last', { d: fmtDate(last.date) }) : t('uc_w_nolast'), status: st, tone: tone, addAct: 'wnew', addKind: kind, addLabel: t('uc_add_w', { k: title.toLowerCase() }) });
  }

  V.home = function () {
    var html = '<h1 class="sr">' + esc(t('nav_home')) + (place() && place().name ? ' — ' + esc(place().name) : '') + '</h1>';
    if (Y().mode === 'server' && !Y().account && (RD().length || wrecs().length) && !S.syncPromptDismissed) {
      html += '<div class="banner" data-key="home-save-prompt">' + ico('info', 22) + '<div><p><b>' + esc(t('save_prompt')) + '</b></p><p><a href="#login">' + esc(t('login')) + '</a> &nbsp; <button class="linkbtn" data-act="dismiss-sync">' + esc(t('save_prompt_later')) + '</button></p></div></div>';
    }
    loadInbox();
    if (INBOX.items && INBOX.items.length) html += '<div class="banner" data-key="home-inbox">' + ico('camera', 22) + '<div><p><b>' + esc(t('ib_title', { n: INBOX.items.length })) + '</b></p><p>' + esc(t('ib_sub')) + '</p><p><button class="btn" data-act="inbox-run" data-key="home-inbox-run">' + esc(t('ib_run')) + '</button></p></div></div>';
    var draft = S.draft && (Object.keys(S.draft.values || {}).length || S.draft.step > 0);
    if (draft && S.meter) html += '<a class="btn big block" style="margin-bottom:16px" href="#step-' + (S.draft.step || 0) + '" data-key="home-continue">' + esc(t('h_continue', { i: (S.draft.step || 0) + 1, n: steps().length })) + '</a>';
    html += '<div class="ucards">' + heatCard() + waterCard('hot') + waterCard('cold') + '</div>';
    html += '<p class="small muted ucards-hint">' + esc(t('uc_hint')) + '</p>';
    if (window.TEPLO_API) html += testReset();
    return { screen: 'S01', route: 'home', html: html };
  };

  // ---------- экран вида воды: счётчики, «передать в этом месяце», история ----------
  function wsendPanel(rec, only) {
    if (!rec) return '';
    var cfg = wcfg(), ms = wmeters(), hot = wmeters('hot'), h = '';
    var cmd = Wt.vkCommand(cfg.account, cfg.surname, ms, rec.vals || {});
    var vals = '<ul class="wvals">' + ms.filter(function (m) { return rec.vals && rec.vals[m.id] !== undefined && rec.vals[m.id] !== ''; }).map(function (m) {
      var v = Wt.whole(rec.vals[m.id]); return '<li><span>' + esc(wname(m)) + (m.serial ? ' <span class="muted small">№ ' + esc(m.serial) + '</span>' : '') + '</span><b class="num">' + v + '</b><button class="linkbtn" data-act="copy" data-text="' + v + '">' + esc(t('copy')) + '</button></li>';
    }).join('') + '</ul>';
    // Водоканал: холодная и горячая
    if (only !== 'htm') {
      h += '<div class="panel wsend" id="wsend-vk" tabindex="-1" data-key="wsend-vk"><h2>' + esc(t('ws_vk_t')) + (wsentVk(rec) ? ' <span class="pill ok">' + ico('check', 14) + ' ' + esc(t('ws_sent')) + '</span>' : '') + '</h2>' +
        '<p class="small muted">' + esc(t('ws_vk_sub', { d: fmtDate(Wt.vkWindow(today()).deadline) })) + '</p>';
      if (cmd.noAccount) {
        h += '<p>' + esc(t('ws_need_acc')) + '</p>' + waccForm();
      } else if (cmd.missing.length) {
        h += '<ol class="wsteps"><li>' + esc(t('ws_ids_1')) + '<div class="cmd"><code>' + esc(cmd.info) + '</code><button class="btn sec" data-act="copy" data-text="' + esc(cmd.info) + '">' + ico('copy', 18) + '<span>' + esc(t('copy')) + '</span></button></div></li>' +
          '<li>' + esc(t('ws_ids_2')) + '</li></ol>' + wmeterIdForm();
      } else {
        h += '<p>' + esc(t('ws_cmd_lead')) + '</p><div class="cmd"><code data-key="wsend-cmd">' + esc(cmd.text) + '</code></div>' +
          '<div class="row-actions" style="margin-top:8px"><button class="btn" data-act="copy-open" data-text="' + esc(cmd.text) + '" data-url="' + Wt.VK_BOT + '" data-key="wsend-copy-open">' + ico('copy', 18) + '<span>' + esc(t('ws_copy_open')) + '</span></button></div>';
      }
      h += '<details class="tips-box" style="margin-top:12px"><summary>' + esc(t('ws_other_ways')) + '</summary>' + vals + '<p class="small">' + esc(t('ws_vk_other')) + ' <a href="' + Wt.VK_CABINET + '" target="_blank" rel="noopener">billing.vodokanal.kharkov.ua</a></p></details>' +
        '<p style="margin-top:12px">' + (wsentVk(rec) ? '<button class="linkbtn" data-act="wsent" data-to="vk" data-v="0" data-id="' + rec.id + '">' + esc(t('ws_unmark')) + '</button>' : '<button class="btn sec" data-act="wsent" data-to="vk" data-v="1" data-id="' + rec.id + '" data-key="wsend-vk-done">' + ico('check', 18) + '<span>' + esc(t('ws_mark')) + '</span></button>') + '</p></div>';
    }
    // ХТМ: горячая вода
    if (hot.length && only !== 'vk') {
      var hv = '<ul class="wvals">' + hot.filter(function (m) { return rec.vals && rec.vals[m.id] !== undefined && rec.vals[m.id] !== ''; }).map(function (m) { var v = Wt.whole(rec.vals[m.id]); return '<li><span>' + esc(wname(m)) + '</span><b class="num">' + v + '</b><button class="linkbtn" data-act="copy" data-text="' + v + '">' + esc(t('copy')) + '</button></li>'; }).join('') + '</ul>';
      h += '<div class="panel wsend" data-key="wsend-htm"><h2>' + esc(t('ws_htm_t')) + (wsentHtm(rec) ? ' <span class="pill ok">' + ico('check', 14) + ' ' + esc(t('ws_sent')) + '</span>' : '') + '</h2><p class="small muted">' + esc(t('ws_htm_sub')) + '</p>' + hv +
        '<div class="row-actions"><a class="btn sec" href="' + HTM_URL + '" target="_blank" rel="noopener">' + esc(t('ws_htm_cab')) + ' ' + ico('ext', 14) + '</a><a class="btn sec" href="' + BOT_URL + '" target="_blank" rel="noopener">@KPHTM_Bot ' + ico('ext', 14) + '</a></div>' +
        '<p style="margin-top:12px">' + (wsentHtm(rec) ? '<button class="linkbtn" data-act="wsent" data-to="htm" data-v="0" data-id="' + rec.id + '">' + esc(t('ws_unmark')) + '</button>' : '<button class="btn sec" data-act="wsent" data-to="htm" data-v="1" data-id="' + rec.id + '">' + ico('check', 18) + '<span>' + esc(t('ws_mark')) + '</span></button>') + '</p></div>';
    }
    return h;
  }
  function waccForm() {
    var c = wcfg();
    return '<div class="grid2"><div class="field"><label for="w-acc">' + esc(t('wa_acc')) + '</label><div class="ctl"><input id="w-acc" class="num" inputmode="numeric" autocomplete="off" data-wcfg="account" value="' + esc(c.account || '') + '"></div><div class="help">' + esc(t('wa_acc_h')) + '</div></div>' +
      '<div class="field"><label for="w-sn">' + esc(t('wa_sn')) + '</label><div class="ctl"><input id="w-sn" autocomplete="family-name" data-wcfg="surname" value="' + esc(c.surname || '') + '"></div><div class="help">' + esc(t('wa_sn_h')) + '</div></div></div>';
  }
  function wmeterIdForm() {
    return '<div class="grid2">' + wmeters().map(function (m) { return '<div class="field"><label for="wid-' + m.id + '">' + esc(t('wm_vkid_for', { m: wname(m) })) + '</label><div class="ctl"><input id="wid-' + m.id + '" class="num" inputmode="numeric" autocomplete="off" data-wm="' + m.id + '" data-wf="vkId" value="' + esc(m.vkId || '') + '"></div></div>'; }).join('') + '</div>' +
      '<p><button class="btn sec" data-act="wrefresh">' + esc(t('wm_ids_done')) + '</button></p>';
  }
  function wwater(kind) {
    var ms = wmeters(kind), title = wkindTitle(kind);
    if (!ms.length) return { screen: 'S30', route: 'water-' + kind, html: '<h1>' + esc(title) + '</h1><div class="panel"><p>' + esc(t('uc_w_empty')) + '</p><button class="btn big" data-act="wsetup" data-kind="' + kind + '" data-key="water-setup">' + esc(t('uc_w_setup_btn')) + '</button></div>' };
    var last = wlast(), ser = Wt.series(wrecs(), wmeters()), h = '<h1>' + esc(title) + '</h1>';
    // счётчики
    h += '<div class="wmeters">' + ms.map(function (m) {
      var r = wprevFor(m.id), v = r ? Wt.whole(r.vals[m.id]) : null, days = m.verifiedUntil ? R.daysBetween(today(), m.verifiedUntil) : null;
      return '<div class="panel wmeter"><div class="small muted">' + esc(wname(m)) + (m.serial ? ' · № ' + esc(m.serial) : '') + '</div><div class="num big">' + (v === null ? '—' : v + ' <small>м³</small>') + '</div><div class="small muted">' + (r ? esc(fmtDate(r.date, true)) : esc(t('uc_w_nolast'))) + '</div>' +
        (days !== null ? '<div class="small" style="margin-top:4px">' + (days < 0 ? '<span class="pill warn">' + esc(t('wm_ver_exp')) + '</span>' : days <= 60 ? '<span class="pill warn">' + esc(t('mv_soon', { n: days })) + '</span>' : '<span class="muted">' + esc(t('pl_ver', { d: R.toHtmDate(m.verifiedUntil) })) + '</span>') + '</div>' : '') + '</div>';
    }).join('') + '</div>';
    h += '<div class="row-actions" style="margin:0 0 16px"><button class="btn big" data-act="wnew" data-kind="' + kind + '" data-key="water-add">' + ico('plus', 22) + '<span>' + esc(t('wn_title')) + '</span></button><a class="btn sec" href="#prefs" data-act="to-water" data-key="water-meters">' + esc(t('wm_manage')) + '</a></div>';
    // передать в этом месяце
    if (last && thisMonth(last.date)) h += wsendPanel(last, kind === 'cold' ? 'vk' : null);
    else { var w = Wt.vkWindow(today()); h += '<div class="banner' + (w.open && w.daysLeft <= 3 ? ' warn' : '') + '">' + ico('clock', 22) + '<div><p><b>' + esc(w.open ? t('uc_w_due', { d: fmtDate(w.deadline) }) : t('uc_w_next', { d: fmtDate(nextMonthDay(today(), Wt.VK_DEADLINE)) })) + '</b></p><p>' + esc(kind === 'hot' ? t('wt_where_hot') : t('wt_where_cold')) + '</p></div></div>'; }
    // история
    var rows = ser.slice().reverse().filter(function (x) { return ms.some(function (m) { return x.rec.vals && x.rec.vals[m.id] !== undefined && x.rec.vals[m.id] !== ''; }); });
    if (rows.length) {
      h += '<h2 class="section-title">' + esc(t('wh_title')) + '</h2><ul class="list wh">' + rows.map(function (x) {
        var d = kind === 'hot' ? x.hot : x.cold, c = d === null ? null : (kind === 'hot' ? Wt.cost(0, d, x.rec.date, S.wtariff) : Wt.cost(d, 0, x.rec.date, S.wtariff)).total;
        var vs = ms.map(function (m) { var v = Wt.whole(x.rec.vals && x.rec.vals[m.id]); return v === null ? '' : (ms.length > 1 ? esc(m.name || '') + ' ' : '') + v; }).filter(Boolean).join(' · ');
        return '<li><div class="grow"><b>' + esc(fmtDate(x.rec.date, true)) + '</b> <span class="num">' + vs + '</span> <span class="small muted">м³</span>' +
          '<div class="small muted">' + (d === null ? esc(t('wh_first')) : '+' + d + ' м³ · ≈ ' + esc(money(c)) + ' грн · ' + x.days + ' ' + esc(t('days_short'))) + (wsentVk(x.rec) ? ' · ' + esc(t('wh_sent')) : '') + '</div></div>' +
          '<button class="linkbtn" data-act="wdel" data-id="' + x.rec.id + '" aria-label="' + esc(t('rec_del') + ': ' + fmtDate(x.rec.date)) + '">' + esc(t('rec_del')) + '</button></li>';
      }).join('') + '</ul>';
    }
    h += '<details class="tips-box" style="margin-top:16px"><summary>' + esc(t('wt_how_t')) + '</summary><ul>' + t(kind === 'hot' ? 'wt_how_hot' : 'wt_how_cold').split('|').map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></details>';
    return { screen: 'S30', route: 'water-' + kind, html: h };
  }
  V['water-hot'] = function () { return wwater('hot'); };
  V['water-cold'] = function () { return wwater('cold'); };

  // ---------- ввод показаний воды ----------
  var WN = { kind: 'hot', date: '', vals: {} };
  V.wnew = function () {
    var ms = wmeters(); if (!ms.length) return V.wsetup();
    var order = ms.slice().sort(function (a, b) { return (a.kind === WN.kind ? 0 : 1) - (b.kind === WN.kind ? 0 : 1); });
    var date = WN.date || today(), back = 'water-' + WN.kind;
    var prev = {}; ms.forEach(function (m) { var r = wprevFor(m.id, date); if (r) prev[m.id] = r; });
    var h = '<h1>' + esc(t('wn_title')) + '</h1><p class="small muted">' + esc(t('wn_lead')) + '</p>' +
      '<div class="field" style="max-width:280px"><label for="wn-date">' + esc(t('wn_date')) + '</label><div class="ctl"><input id="wn-date" type="date" value="' + esc(date) + '" max="' + today() + '"></div></div>' +
      '<form id="wn-form" novalidate>' + order.map(function (m) {
        var p = prev[m.id];
        return '<div class="field wfield" id="wf-' + m.id + '"><label for="wn-' + m.id + '">' + ico('drop', 16, m.kind === 'hot' ? 'c-hot' : 'c-cold') + ' ' + esc(wname(m)) + '</label>' +
          '<div class="ctl"><input id="wn-' + m.id + '" class="num" inputmode="numeric" autocomplete="off" data-wn="' + m.id + '" value="' + esc(WN.vals[m.id] || '') + '" placeholder="' + (p ? esc(String(Wt.whole(p.vals[m.id]))) : '') + '" aria-describedby="wh-' + m.id + '"><span class="unit">м³</span>' +
          '<label class="wcam" title="' + esc(t('wn_photo')) + '"><input type="file" accept="image/*" capture="environment" class="sr" data-wphoto="' + m.id + '" aria-label="' + esc(t('wn_photo') + ': ' + wname(m)) + '">' + ico('camera', 20) + '</label></div>' +
          '<div class="help" id="wh-' + m.id + '">' + (p ? esc(t('wn_prev', { v: Wt.whole(p.vals[m.id]), d: fmtDate(p.date) })) : esc(t('wn_first'))) + '</div></div>';
      }).join('') +
      '<p class="small muted">' + esc(t('wn_digits')) + '</p>' +
      '<div class="wiz-actions"><button class="btn" type="submit" data-key="wn-save">' + esc(t('wn_save')) + '</button></div></form>';
    return { screen: 'S31', route: 'wnew', bare: true, closeTo: back, html: h };
  };
  function wnRead() { Array.prototype.forEach.call(document.querySelectorAll('[data-wn]'), function (el) { WN.vals[el.getAttribute('data-wn')] = el.value.trim(); }); var d = document.getElementById('wn-date'); if (d && d.value) WN.date = d.value; }
  function wnCheck(show) {
    var ms = wmeters(), date = WN.date || today(), prev = {}, vals = {};
    ms.forEach(function (m) { var r = wprevFor(m.id, date); vals[m.id] = WN.vals[m.id]; prev[m.id] = r; });
    // проверяем по каждому счётчику против его последнего показания
    var issues = {};
    ms.forEach(function (m) { var p = prev[m.id]; var one = Wt.check([m], vals, p ? { date: p.date, vals: p.vals } : null, date); issues[m.id] = one[m.id] || []; });
    var both = Wt.check(ms, vals, (function () { var pv = {}, pd = null; ms.forEach(function (m) { if (prev[m.id]) { pv[m.id] = prev[m.id].vals[m.id]; pd = pd && pd > prev[m.id].date ? pd : prev[m.id].date; } }); return pd ? { date: pd, vals: pv } : null; })(), date);
    ms.forEach(function (m) { (both[m.id] || []).forEach(function (x) { if (x.code === 'hot_gt_cold') issues[m.id].push(x); }); });
    if (show) ms.forEach(function (m) {
      var el = document.getElementById('wh-' + m.id), fw = document.getElementById('wf-' + m.id); if (!el) return;
      var list = issues[m.id].filter(function (x) { return x.code !== 'empty' || show === 'submit'; }), p = prev[m.id];
      var txt = list.map(function (x) { return t('wi_' + x.code, { prev: p ? Wt.whole(p.vals[m.id]) : '', n: x.perMonth || '', w: x.whole }); }).join(' ');
      var lvl = list.some(function (x) { return x.level === 'block'; }) ? 'block' : list.some(function (x) { return x.level === 'warn'; }) ? 'warn' : list.length ? 'ok' : '';
      el.textContent = txt || (p ? t('wn_prev', { v: Wt.whole(p.vals[m.id]), d: fmtDate(p.date) }) : t('wn_first'));
      el.className = 'help' + (lvl ? ' ' + lvl : ''); if (fw) fw.className = 'field wfield' + (lvl === 'block' ? ' is-block' : lvl === 'warn' ? ' is-warn' : '');
    });
    return issues;
  }
  function wnSave() {
    wnRead(); var iss = wnCheck('submit');
    if (Wt.blocked(iss)) { var f = document.querySelector('.wfield.is-block input'); if (f) f.focus(); return; }
    var vals = {}; wmeters().forEach(function (m) { var v = Wt.whole(WN.vals[m.id]); if (v !== null) vals[m.id] = String(v); });
    var date = WN.date || today(), now = new Date().toISOString();
    S.water = S.water || [];
    // одна запись на квартиру и дату: повторный ввод в тот же день — правка
    var same = (S.water || []).filter(function (r) { return r && !r.deleted && !r.base && r.place === S.placeId && r.date === date; })[0];
    if (same) { same.vals = Object.assign({}, same.vals, vals); same.updatedAt = Date.now(); }
    else S.water.push({ id: Wt.uid(), place: S.placeId, date: date, vals: vals, createdAt: now, updatedAt: Date.now(), sent: {} });
    if (!S.onboarded) S.onboarded = true;
    var k = WN.kind; WN = { kind: k, date: '', vals: {} };
    save(); toast(t('wn_saved')); SCROLL_TO = 'wsend-vk'; go('water-' + k);
  }

  // ---------- первый вход: какие водомеры ----------
  var WS = { step: 0, preset: 'hc', vals: {}, kind: 'hot' };
  var WPRESETS = { hc: [['hot', ''], ['cold', '']], hc2: [['hot', 'кухня'], ['cold', 'кухня'], ['hot', 'ванна'], ['cold', 'ванна']], c: [['cold', '']], h: [['hot', '']] };
  V.wsetup = function () {
    var head = '<div class="wiz-top"><span class="count">' + esc(t('s_step', { i: WS.step + 1, n: 3 })) + '</span><span class="progress" aria-hidden="true"><i style="width:' + Math.round((WS.step + 1) / 3 * 100) + '%"></i></span></div>', h = '';
    if (WS.step === 0) {
      h = '<h1>' + esc(t('wz_t1')) + '</h1><p class="muted">' + esc(t('wz_l1')) + '</p><div class="wz-opts" role="radiogroup" aria-label="' + esc(t('wz_t1')) + '">' +
        [['hc', 'wz_hc', 'wz_hc_s'], ['hc2', 'wz_hc2', 'wz_hc2_s'], ['c', 'wz_c', 'wz_c_s'], ['h', 'wz_h', 'wz_h_s']].map(function (o) {
          return '<label class="wz-opt"><input type="radio" name="wz" value="' + o[0] + '"' + (WS.preset === o[0] ? ' checked' : '') + ' data-act="wz-preset"><span><b>' + esc(t(o[1])) + '</b><span class="small muted">' + esc(t(o[2])) + '</span></span></label>';
        }).join('') + '</div><p class="small muted">' + esc(t('wz_note1')) + '</p>' +
        '<div class="wiz-actions"><button class="btn" data-act="wz-next" data-key="wz-next">' + esc(t('next')) + '</button></div>';
    } else if (WS.step === 1) {
      var list = WPRESETS[WS.preset];
      h = '<h1>' + esc(t('wz_t2')) + '</h1><p class="muted">' + esc(t('wz_l2')) + '</p>' + list.map(function (x, i) {
        var nm = (x[0] === 'hot' ? t('wt_hot') : t('wt_cold')) + (x[1] ? ' · ' + x[1] : '');
        return '<div class="field"><label for="wz-' + i + '">' + ico('drop', 16, x[0] === 'hot' ? 'c-hot' : 'c-cold') + ' ' + esc(nm) + '</label><div class="ctl"><input id="wz-' + i + '" class="num" inputmode="numeric" autocomplete="off" data-wz="' + i + '" value="' + esc(WS.vals[i] || '') + '"><span class="unit">м³</span></div></div>';
      }).join('') + '<p class="small muted">' + esc(t('wn_digits')) + '</p>' +
        '<div class="wiz-actions"><button class="btn sec" data-act="wz-back">' + ico('back', 20) + '<span>' + esc(t('back')) + '</span></button><button class="btn" data-act="wz-next" data-key="wz-next">' + esc(t('next')) + '</button></div>';
    } else {
      h = '<h1>' + esc(t('wz_t3')) + '</h1><p class="muted">' + esc(t('wz_l3')) + '</p>' + waccForm() +
        '<div class="wiz-actions"><button class="btn sec" data-act="wz-back">' + ico('back', 20) + '<span>' + esc(t('back')) + '</span></button><button class="btn" data-act="wz-done" data-key="wz-done">' + esc(t('wz_done')) + '</button></div>' +
        '<p><button class="linkbtn" data-act="wz-done" data-skip="1">' + esc(t('wz_skip')) + '</button></p>';
    }
    return { screen: 'S32', route: 'wsetup', bare: true, closeTo: S.onboarded ? 'home' : 'start', html: head + h };
  };
  function wzRead() { Array.prototype.forEach.call(document.querySelectorAll('[data-wz]'), function (el) { WS.vals[el.getAttribute('data-wz')] = el.value.trim(); }); }
  function wzDone() {
    wzRead();
    var list = WPRESETS[WS.preset], ids = [];
    wsetCfg(function (c) {
      c.meters = (c.meters || []).filter(function (m) { return m && !m.deleted; });
      list.forEach(function (x) { var m = { id: Wt.uid(), kind: x[0], name: x[1] || '', serial: '', vkId: '', verifiedUntil: '' }; c.meters.push(m); ids.push(m.id); });
      var a = document.getElementById('w-acc'), sn = document.getElementById('w-sn'); if (a) c.account = a.value.trim(); if (sn) c.surname = sn.value.trim();
    });
    var vals = {}; ids.forEach(function (id, i) { var v = Wt.whole(WS.vals[i]); if (v !== null) vals[id] = String(v); });
    if (Object.keys(vals).length) { S.water = S.water || []; S.water.push({ id: Wt.uid(), place: S.placeId, date: today(), vals: vals, createdAt: new Date().toISOString(), updatedAt: Date.now(), sent: {}, base: true }); }
    S.onboarded = true; var k = list[0][0]; WS = { step: 0, preset: 'hc', vals: {}, kind: k };
    save(); toast(t('wz_saved')); go('water-' + k);
  }

  // ---------- старт: что будем вести ----------
  V.start = function () {
    return { screen: 'S02', route: 'start', bare: true, closeTo: 'welcome', html: '<h1>' + esc(t('st_t')) + '</h1><p class="muted">' + esc(t('st_l')) + '</p><div class="wz-opts">' +
      '<a class="wz-opt wz-link" href="#meter" data-key="start-heat">' + ico('thermo', 24) + '<span><b>' + esc(t('st_heat')) + '</b><span class="small muted">' + esc(t('st_heat_s')) + '</span></span>' + ico('chev', 20) + '</a>' +
      '<button class="wz-opt wz-link" data-act="wsetup" data-kind="hot" data-key="start-water">' + ico('drop', 24) + '<span><b>' + esc(t('st_water')) + '</b><span class="small muted">' + esc(t('st_water_s')) + '</span></span>' + ico('chev', 20) + '</button>' +
      '</div><p class="small muted">' + esc(t('st_both')) + '</p>' };
  };

  // ---------- настройки: водомеры ----------
  function waterPanel() {
    var ms = wmeters();
    var h = '<div class="panel" id="water-block" tabindex="-1" data-key="prefs-water"><h2>' + esc(t('wm_title')) + (place() && place().name ? ' <span class="muted small">· ' + esc(place().name) + '</span>' : '') + '</h2>';
    if (!ms.length) return h + '<p class="small muted">' + esc(t('uc_w_empty')) + '</p><button class="btn sec" data-act="wsetup" data-kind="hot">' + ico('plus', 18) + '<span>' + esc(t('uc_w_setup_btn')) + '</span></button></div>';
    h += '<p class="small muted">' + esc(t('wm_sub')) + '</p>' + ms.map(function (m) {
      return '<fieldset class="wm-row"><legend>' + ico('drop', 16, m.kind === 'hot' ? 'c-hot' : 'c-cold') + ' ' + esc(wname(m)) + '</legend><div class="grid2">' +
        '<div class="field"><label for="wmk-' + m.id + '">' + esc(t('wm_kind')) + '</label><div class="ctl"><select id="wmk-' + m.id + '" data-wm="' + m.id + '" data-wf="kind"><option value="hot"' + (m.kind === 'hot' ? ' selected' : '') + '>' + esc(t('wt_hot')) + '</option><option value="cold"' + (m.kind === 'cold' ? ' selected' : '') + '>' + esc(t('wt_cold')) + '</option></select></div></div>' +
        '<div class="field"><label for="wmn-' + m.id + '">' + esc(t('wm_name')) + '</label><div class="ctl"><input id="wmn-' + m.id + '" data-wm="' + m.id + '" data-wf="name" value="' + esc(m.name || '') + '" placeholder="' + esc(t('wm_name_ph')) + '"></div></div>' +
        '<div class="field"><label for="wms-' + m.id + '">' + esc(t('wm_serial')) + '</label><div class="ctl"><input id="wms-' + m.id + '" class="num" autocomplete="off" data-wm="' + m.id + '" data-wf="serial" value="' + esc(m.serial || '') + '"></div></div>' +
        '<div class="field"><label for="wmi-' + m.id + '">' + esc(t('wm_vkid')) + '</label><div class="ctl"><input id="wmi-' + m.id + '" class="num" inputmode="numeric" autocomplete="off" data-wm="' + m.id + '" data-wf="vkId" value="' + esc(m.vkId || '') + '"></div><div class="help">' + esc(t('wm_vkid_h')) + '</div></div>' +
        '<div class="field"><label for="wmv-' + m.id + '">' + esc(t('mv_date')) + '</label><div class="ctl"><input id="wmv-' + m.id + '" type="date" data-wm="' + m.id + '" data-wf="verifiedUntil" value="' + esc(m.verifiedUntil || '') + '"></div></div>' +
        '</div><button class="linkbtn" data-act="wm-del" data-id="' + m.id + '">' + esc(t('rec_del')) + '</button></fieldset>';
    }).join('') +
      '<div class="row-actions" style="margin-top:8px"><button class="btn sec" data-act="wm-add" data-kind="hot">' + ico('plus', 18) + '<span>' + esc(t('wm_add_hot')) + '</span></button><button class="btn sec" data-act="wm-add" data-kind="cold">' + ico('plus', 18) + '<span>' + esc(t('wm_add_cold')) + '</span></button></div>' +
      '<h3 style="margin-top:20px">' + esc(t('wm_acc_t')) + '</h3>' + waccForm() + '</div>';
    return h;
  }

  // действия воды
  function waterAct(act, el, e) {
    switch (act) {
      case 'wnew': WN = { kind: el.getAttribute('data-kind') || 'hot', date: '', vals: {} }; go(wmeters().length ? 'wnew' : 'wsetup'); return true;
      case 'wsetup': WS = { step: 0, preset: (el.getAttribute('data-kind') === 'cold' ? 'hc' : 'hc'), vals: {}, kind: el.getAttribute('data-kind') || 'hot' }; go('wsetup'); return true;
      case 'setup-heat': go('meter'); return true;
      case 'wz-preset': WS.preset = el.value; return true;
      case 'wz-next': e.preventDefault(); wzRead(); if (WS.step === 0) { var ch = document.querySelector('input[name="wz"]:checked'); if (ch) WS.preset = ch.value; } WS.step = Math.min(2, WS.step + 1); render(); return true;
      case 'wz-back': e.preventDefault(); wzRead(); WS.step = Math.max(0, WS.step - 1); render(); return true;
      case 'wz-done': e.preventDefault(); wzDone(); return true;
      case 'wsent': { var r = (S.water || []).filter(function (x) { return x.id === el.getAttribute('data-id'); })[0]; if (!r) return true; r.sent = Object.assign({}, r.sent || {}); r.sent[el.getAttribute('data-to')] = el.getAttribute('data-v') === '1' ? today() : ''; r.updatedAt = Date.now(); save(); render(true); return true; }
      case 'wdel': { if (!confirm(t('wh_del_q'))) return true; var r2 = (S.water || []).filter(function (x) { return x.id === el.getAttribute('data-id'); })[0]; if (r2) { r2.deleted = true; r2.updatedAt = Date.now(); save(); render(true); } return true; }
      case 'wm-add': wsetCfg(function (c) { c.meters = c.meters || []; c.meters.push({ id: Wt.uid(), kind: el.getAttribute('data-kind'), name: '', serial: '', vkId: '', verifiedUntil: '' }); }); render(true); return true;
      case 'wm-del': if (!confirm(t('wm_del_q'))) return true; wsetCfg(function (c) { (c.meters || []).forEach(function (m) { if (m.id === el.getAttribute('data-id')) m.deleted = true; }); }); render(true); return true;
      case 'wrefresh': render(true); return true;
      case 'to-water': e.preventDefault(); SCROLL_TO = 'water-block'; go('prefs'); return true;
      case 'copy-open': copyText(el.getAttribute('data-text'), el); setTimeout(function () { var tw = window.Telegram && window.Telegram.WebApp; if (tw && tw.openTelegramLink) tw.openTelegramLink(el.getAttribute('data-url')); else window.open(el.getAttribute('data-url'), '_blank', 'noopener'); }, 250); return true;
    }
    return false;
  }
  // поля: настройки водомеров, рахунок, ввод
  document.addEventListener('change', function (e) {
    var el = e.target; if (!el || !el.getAttribute) return;
    var k = el.getAttribute('data-wcfg');
    if (k) { wsetCfg(function (c) { c[k] = el.value.trim(); }); return; }
    var mid = el.getAttribute('data-wm');
    if (mid) { var f = el.getAttribute('data-wf'); wsetCfg(function (c) { (c.meters || []).forEach(function (m) { if (m.id === mid) m[f] = el.value.trim(); }); }); if (f === 'kind') render(true); return; }
    if (el.id === 'wn-date') { WN.date = el.value; wnCheck(true); return; }
    var ph = el.getAttribute('data-wphoto');
    if (ph && el.files && el.files[0]) wnPhoto(ph, el.files[0], el);
  });
  document.addEventListener('input', function (e) { var el = e.target; if (el && el.getAttribute && el.getAttribute('data-wn')) { WN.vals[el.getAttribute('data-wn')] = el.value.trim(); wnCheck(true); } });
  document.addEventListener('submit', function (e) { if (e.target && e.target.id === 'wn-form') { e.preventDefault(); wnSave(); } }, true);
  /** Фото одного водомера → цифры барабана (тот же бесплатный движок в браузере). */
  function wnPhoto(mid, file, el) {
    var help = document.getElementById('wh-' + mid), inp = document.getElementById('wn-' + mid), lab = el.closest && el.closest('.wcam');
    if (!VIS().local) { toast(t('ph_unavail')); return; }
    if (help) { help.innerHTML = SPIN + ' ' + esc(t('wn_reading')); help.className = 'help'; }
    if (lab) lab.setAttribute('aria-busy', 'true');
    VIS()._engine(function () {}).then(function () { return window.TeploOCR.read(file); }).then(function (res) {
      if (lab) lab.removeAttribute('aria-busy');
      var p = wprevFor(mid, WN.date || today()), r = Wt.fromOcr(res, p ? p.vals[mid] : null);
      if (!r) { if (help) { help.textContent = t('wn_photo_none'); help.className = 'help warn'; } return; }
      if (r.value === null) { if (help) { help.textContent = t('wn_photo_half', { p: r.partial }); help.className = 'help warn'; } if (inp) inp.focus(); return; }
      if (inp) { inp.value = String(r.value); WN.vals[mid] = String(r.value); }
      wnCheck(true); if (help && help.className.indexOf('block') < 0) { help.textContent = t(r.half ? 'wn_photo_check' : 'wn_photo_ok', { v: r.value }) + ' ' + help.textContent; }
    }, function () { if (lab) lab.removeAttribute('aria-busy'); if (help) { help.textContent = t('ph_err_engine'); help.className = 'help warn'; } });
  }

  V.welcome = function () {
    var acc = Y().mode === 'server' && Y().account;
    if (acc) {   // уже вошёл, но лічильник ещё не выбран (новый аккаунт или стёрли данные) — без рекламного экрана, сразу к делу
      var who = acc.email || (acc.telegram && (acc.telegram.username ? '@' + acc.telegram.username : acc.telegram.name)) || '';
      return { screen: 'S00', bare: true, html:
        '<div class="welcome"><div class="welcome-grid"><div class="welcome-lcd" aria-hidden="true">' + lcd([{ text: '13.245', tag: 'Gcal' }], 'hero') + '</div><div>' +
        '<h1>' + esc(t('wa_title')) + '</h1><p class="lead">' + esc(t('wa_lead')) + '</p>' +
        '<a class="btn big" href="#start" data-key="welcome-start">' + esc(t('wa_cta')) + '</a>' +
        '<p class="small muted" style="margin-top:16px">' + esc(t('wa_fine', { who: who })) + ' <button class="linkbtn" data-act="logout">' + esc(t('wa_other')) + '</button></p></div>' +
        '</div></div>' };
    }
    return { screen: 'S00', bare: true, html:
      '<div class="welcome"><div class="welcome-grid"><div class="welcome-lcd" aria-hidden="true">' + lcd([{ text: '13.245', tag: 'Gcal' }], 'hero boot') + '</div><div>' +
      '<h1>' + esc(t('w_title')) + '</h1><p class="lead">' + esc(t('w_lead')) + '</p>' +
      '<ul>' + ['w_b1', 'w_b2', 'w_b3'].map(function (k) { return '<li>' + ico('check', 22, 'c-ok') + '<span>' + esc(t(k)) + '</span></li>'; }).join('') + '</ul>' +
      '<a class="btn big" href="#start" data-key="welcome-start">' + esc(t('w_cta')) + '</a>' +
      (Y().mode === 'server' && !Y().account ? '<p style="margin-top:16px"><a href="#login" data-key="welcome-login">' + esc(t('w_login')) + '</a></p>' : '') +
      '<p class="small muted" style="margin-top:16px">' + esc(Y().mode === 'claude' ? t('sync_claude') : Y().mode === 'server' ? t('w_fine_site') : t('w_fine')) + '</p></div>' +
      '</div></div>' };
  };

  V.heat = function () {
    var m = model(), html = '<h1>' + esc(t('uc_heat')) + (place() && place().name ? ' — ' + esc(place().name) : '') + '</h1>' + windowBanner();
    var handed = RD().filter(function (r) { return r.status === 'handed'; }).slice(-1)[0];
    if (handed) {
      html += '<div class="banner" data-key="home-waiting">' + ico('clock', 22) + '<div><p><b>' + esc(t('h_waiting')) + '</b></p><p>' + esc(t('h_waiting_sub', { ago: ago(handed.handedAt) })) + '</p>' +
        '<p><a href="#status" data-act="focus" data-id="' + handed.id + '">' + esc(t('h_check_result')) + '</a></p></div></div>';
    }
    loadInbox();
    if (INBOX.items && INBOX.items.length) html += '<div class="banner" data-key="home-inbox">' + ico('camera', 22) + '<div><p><b>' + esc(t('ib_title', { n: INBOX.items.length })) + '</b></p><p>' + esc(t('ib_sub')) + '</p><p><button class="btn" data-act="inbox-run" data-key="home-inbox-run">' + esc(t('ib_run')) + '</button></p></div></div>';
    // экран с последними принятыми — главный визуальный якорь
    var left = '';
    if (S.baseline) {
      left += '<div class="panel" data-key="home-last"><h2>' + esc(t('h_last')) + '</h2>' +
        lcd([{ text: R.formatForHtm('energy', S.baseline.energy), tag: 'Gcal' }], 'hero') +
        '<p class="lcd-cap meta-row"><span>' + esc(fmtDate(S.baseline.date, true)) + '</span><a href="#baseline">' + esc(t('change')) + '</a></p></div>';
    } else {
      left += '<div class="panel" data-key="home-last-none"><h2>' + esc(t('h_last_none')) + '</h2><p class="muted">' + esc(t('h_last_none_sub')) + '</p><p><a href="' + HTM_URL + '" target="_blank" rel="noopener">' + esc(t('h_cab_link')) + ' ' + ico('ext', 14) + '</a></p>' +
        '<a class="btn sec" href="#baseline" data-key="home-add-base">' + esc(t('h_add_base')) + '</a></div>';
    }
    var right = '';
    var n = steps().length;
    if (S.draft && (Object.keys(S.draft.values || {}).length || S.draft.step > 0)) {
      right += '<a class="btn big block" href="#step-' + (S.draft.step || 0) + '" data-key="home-continue">' + esc(t('h_continue', { i: (S.draft.step || 0) + 1, n: n })) + '</a>' +
        '<button class="linkbtn" style="margin-top:8px" data-act="restart" data-key="home-restart">' + esc(t('h_read')) + ' — ' + (S.lang === 'ru' ? 'заново' : 'спочатку') + '</button>';
    } else {
      right += '<button class="btn big block" data-act="read" data-key="home-read">' + esc(t('h_read')) + '</button>';
      if (VIS().available) right += '<button class="btn sec block" style="margin-top:12px" data-act="photo" data-mode="reading" data-key="home-photo">' + ico('camera', 22) + '<span>' + esc(t('ph_entry')) + '</span></button>';
    }
    right += '<h2 class="section-title">' + esc(t('h_meter')) + '</h2><ul class="list"><li class="tap-row"><a class="row-link" href="#prefs" data-act="to-meter" data-key="home-meter"><div class="grow"><div><b>' + esc(modelName(m)) + '</b></div>' +
      '<div class="small muted">' + esc(m.status === 'verified' ? t('m_verified') : m.status === 'draft' ? t('m_draft') : L(m.note)) + (energyUnit() !== 'Gcal' ? ', ' + esc(unitLbl(energyUnit())) : '') + (S.meter && S.meter.verifiedUntil ? ' · ' + esc(t('pl_ver', { d: R.toHtmDate(S.meter.verifiedUntil) })) : '') + '</div></div>' +
      ico('chev', 20) + '</a></li></ul>';
    var recent = RD().slice(-3).reverse();
    if (recent.length) right += '<h2 class="section-title">' + esc(t('h_recent')) + '</h2>' + readingList(recent);
    right += '<p class="small muted" style="margin-top:16px">' + esc(t('h_hw')) + ': <a href="' + BOT_URL + '" target="_blank" rel="noopener">@KPHTM_Bot</a></p>';
    if (Y().mode === 'server' && !Y().account && RD().length && !S.syncPromptDismissed) {
      html = '<div class="banner" data-key="home-save-prompt">' + ico('info', 22) + '<div><p><b>' + esc(t('save_prompt')) + '</b></p><p><a href="#login">' + esc(t('login')) + '</a> &nbsp; <button class="linkbtn" data-act="dismiss-sync">' + esc(t('save_prompt_later')) + '</button></p></div></div>' + html;
    }
    html += '<div class="hero-grid"><div>' + left + '</div><div>' + right + '</div></div>';
    return { screen: 'S01h', route: 'heat', html: html };
  };

  /** Показания без удалённых (удалённые остаются «надгробием» с deleted, чтобы удаление синхронизировалось). */
  function RD() { var first = S.places && S.places[0] ? S.places[0].id : 'main'; return (S.readings || []).filter(function (r) { return r && !r.deleted && (r.place || first) === S.placeId; }); }
  function tariff() { var n = R.num(S.tariff); return n && n > 0 ? n : R.C.TARIFF; }
  /* Платіжка ХТМ: до сплати = (ваше тепло за лічильником + ваша частка ЗБП) × тариф + абонплата.
     ЗБП — загальнобудинкові потреби (сходи, підвал): частка пропорційна площі, у платіжці — стовпець «на ЗБП» у рядку вашого вузла. */
  function bill() { var b = S.bill || {}, ab = R.num(b.abon), mz = R.num(b.mzk); return { abon: ab !== null && ab >= 0 ? ab : R.C.ABON, mzk: mz !== null && mz >= 0 ? mz : 0 }; }
  var MONTH_DAYS = 365.25 / 12;
  function costOf(dE, days) {
    // ХТМ рахує ЗБП і абонплату помісячно: проміжок ~місяць — рівно один місяць
    var b = bill(), m = days >= 20 ? Math.max(1, Math.round(days / MONTH_DAYS)) : days > 0 ? days / MONTH_DAYS : 0, mz = b.mzk * m, heat = Math.max(0, dE) * tariff();
    return { heat: heat, mzk: mz * tariff(), abon: b.abon * m, total: heat + mz * tariff() + b.abon * m, gcal: Math.max(0, dE) + mz };
  }
  /** Сколько тепла набежало с прошлых показаний (по дате снятия) или с последних принятых ХТМ, и сколько это стоит. */
  function interval(r) {
    var d = r.htm && r.htm.date, e = R.num(r.htm && r.htm.energy); if (!d || e === null) return null;
    var prev = RD().filter(function (x) { return x !== r && x.htm && x.htm.date && x.htm.date < d && R.num(x.htm.energy) !== null; })
      .sort(function (a, b) { return a.htm.date < b.htm.date ? -1 : 1; }).slice(-1)[0];
    var from = prev ? prev.htm : (S.baseline && S.baseline.date && S.baseline.date < d && R.num(S.baseline.energy) !== null ? S.baseline : null);
    if (!from) return null;
    var dE = e - R.num(from.energy), days = R.daysBetween(from.date, d);
    var c = costOf(dE, days);
    return { dE: dE, days: days, cost: c.total, parts: c, from: from.date, fromBase: !prev };
  }
  /** Погода к показаниям: средняя/мин/макс на улице за промежуток (до 4 мес.) и в день снятия; ряд по дням — для мини-графика. */
  function wxFor(r) {
    if (!WX.days || !r.htm || !r.htm.date) return null;
    var iv = interval(r), d = WX.days, day = typeof d[r.htm.date] === 'number' ? d[r.htm.date] : null, ser = [];
    if (iv && iv.days > 0 && iv.days <= 120) for (var k = 1; k <= iv.days; k++) { var dd = new Date(Date.parse(iv.from + 'T00:00:00Z') + k * 86400000).toISOString().slice(0, 10); if (typeof d[dd] === 'number') ser.push(d[dd]); }
    if (!ser.length && day === null) return null;
    var avg = ser.length ? ser.reduce(function (a, b) { return a + b; }, 0) / ser.length : null;
    return { avg: avg, day: day, min: ser.length ? Math.min.apply(null, ser) : null, max: ser.length ? Math.max.apply(null, ser) : null, ser: ser, frost: ser.filter(function (v) { return v < 0; }).length };
  }
  function degTxt(v) { return (v > 0.05 ? '+' : v < -0.05 ? '−' : '') + Math.abs(v).toFixed(1).replace('.', ',') + '°'; }
  function wxTone(v) { return v <= -2 ? 'cold' : v >= 2 ? 'warm' : 'zero'; }
  /** Компактная плашка погоды в строке истории: термометр + средняя за промежуток (или в день снятия). */
  function wxChip(w) {
    if (!w) return '';
    var v = w.avg !== null ? w.avg : w.day, tip = w.avg !== null ? t('wx_tip_avg', { t: degTxt(w.avg), min: degTxt(w.min), max: degTxt(w.max) }) + (w.day !== null ? ' · ' + t('wx_tip_day', { t: degTxt(w.day) }) : '') : t('wx_tip_day', { t: degTxt(w.day) });
    var head = w.avg !== null ? t('wx_tip_h_avg', { t: degTxt(w.avg) }) : t('wx_tip_h_day', { t: degTxt(w.day) });
    return '<span class="wx wx-' + wxTone(v) + '" tabindex="0" role="note" aria-label="' + esc(tip) + '" data-tip="' + esc([head].concat(w.avg !== null ? [t('wx_tip_range', { min: degTxt(w.min), max: degTxt(w.max) }), t('wx_tip_frost', { n: w.frost, d: w.ser.length })] : []).concat(w.day !== null && w.avg !== null ? [t('wx_tip_day', { t: degTxt(w.day) })] : []).concat([t('wx_tip_src')]).join('\n')) + '">' + ico('thermo', 15) + '<span class="num">' + esc(degTxt(v)) + '</span></span>';
  }
  /** Мини-график температур по дням промежутка: столбики вверх/вниз от нуля. */
  function wxSpark(ser) {
    if (!ser || ser.length < 3) return '';
    var W = 600, H = 70, mx = Math.max(5, Math.max.apply(null, ser.map(Math.abs))), z = H / 2, bw = W / ser.length;
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="' + W + '" y1="' + z + '" y2="' + z + '" style="stroke:var(--spark-axis)"/>' +
      ser.map(function (v, i) { var h = Math.abs(v) / mx * (z - 2); return '<rect x="' + (i * bw + bw * 0.15).toFixed(1) + '" y="' + (v >= 0 ? z - h : z).toFixed(1) + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + Math.max(1, h).toFixed(1) + '" rx="1.5" style="fill:var(' + (v < 0 ? '--spark-cold' : '--spark-warm') + ')"/>'; }).join('') + '</svg>';
  }
  function intervalText(iv) {
    if (!iv) return '';
    if (iv.dE < 0) return t('hi_less', { de: Math.abs(iv.dE).toFixed(3) });
    return t('hi_used', { de: iv.dE.toFixed(3), days: iv.days, cost: money(iv.cost) });
  }

  function readingList(arr) {
    return '<ul class="list" data-key="reading-list">' + arr.map(function (r) {
      var cls = { accepted: 'ok', rejected: 'bad', handed: 'info', checked: 'neutral', intermediate: 'neutral' }[r.status] || 'neutral';
      var sub = intervalText(interval(r)), chip = wxChip(wxFor(r));
      var link = true;   // вся строка — в карточку показаний (там же правка, удаление, статус)
      var inner = '<div class="grow"><div><b>' + esc(fmtDate(r.htm.date, true)) + '</b> <span class="num">' + esc(R.formatForHtm('energy', r.htm.energy)) + '</span> <span class="small muted">Гкал</span></div>' +
        (sub ? '<div class="small muted">' + esc(sub) + '</div>' : '') + '</div>' + chip + '<span class="pill ' + cls + '">' + esc(t('status_' + r.status)) + '</span>';
      return '<li data-key="reading-' + r.id + '">' + (link ? '<a class="rowlink" href="#rec-' + r.id + '">' + inner + '</a>' : inner) + '</li>';
    }).join('') + '</ul>';
  }

  V.meter = function () {
    var cur = S.meter ? S.meter.modelId : '', sel = S._pickModel || cur;
    var list = M.MODELS.map(function (m) {
      var tag = m.status === 'verified' ? '<span class="pill ok">' + esc(t('m_verified')) + '</span>' : m.status === 'draft' ? '<span class="pill">' + esc(t('m_draft')) + '</span>' : '';
      var name = m.id === 'other' ? esc(t('m_other')) : esc(m.name);
      var sub = m.id === 'other' ? esc(t('m_other_sub')) : esc(m.vendor !== '—' ? m.vendor : '');
      return '<li><label><input type="radio" name="model" value="' + m.id + '"' + (sel === m.id ? ' checked' : '') + ' data-act="pick-model">' +
        meterGlyph() + '<span class="grow"><span class="name">' + name + '</span><br><span class="vendor">' + sub + '</span></span>' + tag + '</label></li>';
    }).join('');
    var pm = M.byId(sel), unitBlock = '';
    if (pm && pm.units.length > 1) {
      var u = (S._pickUnit && pm.units.indexOf(S._pickUnit) >= 0 && S._pickModel === sel ? S._pickUnit : null) || (S.meter && S.meter.modelId === sel && S.meter.unit) || pm.unit;
      unitBlock = '<div class="panel" data-key="meter-unit"><h3>' + esc(t('m_unit')) + '</h3><p class="small muted">' + esc(t('m_unit_sub')) + '</p><div class="choice">' +
        pm.units.map(function (x) { return '<label><input type="radio" name="unit" value="' + x + '"' + (u === x ? ' checked' : '') + '>' + esc(unitLbl(x)) + '</label>'; }).join('') + '</div></div>';
    }
    var note = pm && pm.id !== 'other' ? '<p class="small muted">' + esc(L(pm.note)) + '</p>' : '';
    return { screen: 'S02', route: 'meter', bare: !S.onboarded, closeTo: S.onboarded ? 'home' : 'welcome', html:
      '<h1>' + esc(t('m_title')) + '</h1><p class="muted">' + esc(t('m_lead')) + '</p>' +
      '<div class="field" style="max-width:520px"><label for="pl-name">' + esc(t('pl_addr')) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></label><div class="ctl"><input id="pl-name" autocomplete="street-address" placeholder="' + esc(t('pl_addr_ph')) + '" value="' + esc((place() || {}).name || '') + '"></div></div>' +
      '<details class="where" data-key="meter-where"><summary>' + esc(t('m_where')) + '</summary><p>' + esc(t('m_where_text')) + '</p></details>' +
      (VIS().available ? '<p><button class="btn sec" data-act="photo" data-mode="model" data-key="meter-photo">' + ico('camera', 20) + '<span>' + esc(t('ph_model_entry')) + '</span></button></p>' : '') +
      '<ul class="list models" data-key="meter-list">' + list + '</ul>' + (pm ? '<div style="margin-top:16px">' + note + unitBlock + '</div>' : '') +
      '<div class="row-actions">' + (S.onboarded ? '<a class="btn sec" href="#home">' + esc(t('back')) + '</a>' : '') +
      '<button class="btn" data-act="save-meter" data-key="meter-save"' + (pm ? '' : ' disabled') + '>' + esc(S.onboarded ? t('save') : t('next')) + '</button></div>' };
  };
  function meterGlyph() {
    return '<svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true"><rect x="4" y="4" width="32" height="32" rx="6" style="fill:var(--c-bezel-in);stroke:var(--c-bezel)"/>' +
      '<rect x="9" y="10" width="22" height="10" rx="2" style="fill:var(--c-lcd)"/><circle cx="20" cy="28" r="4" style="fill:var(--c-ink)"/></svg>';
  }

  V.baseline = function () {
    var b = Object.assign({}, S.baseline || {}, S._baseFill || {}), mt = S.meter || {};
    var keys = ['energy', 'volume', 'flow', 'power', 'tSupply', 'tReturn', 'hours', 'errHours'];
    var fields = '<div class="field"><label for="b-date">' + esc(fieldLabel('date')) + '</label><div class="ctl"><input id="b-date" type="date" data-b="date" value="' + esc(b.date || '') + '"></div></div>' +
      '<div class="grid2">' + keys.map(function (k) {
        var cls = k === 'tSupply' ? ' supply' : k === 'tReturn' ? ' return' : '';
        return '<div class="field"><label for="b-' + k + '">' + esc(fieldLabel(k)) + '</label><div class="ctl' + cls + '"><input id="b-' + k + '" class="num" inputmode="decimal" autocomplete="off" data-b="' + k + '" value="' + esc(b[k] == null ? '' : b[k]) + '"><span class="unit">' + esc(k === 'energy' ? 'Гкал' : fieldUnit(k)) + '</span></div></div>';
      }).join('') +
      '<div class="field"><label for="b-errCode">' + esc(fieldLabel('errCode')) + '</label><div class="ctl"><input id="b-errCode" class="num" autocomplete="off" data-b="errCode" value="' + esc(b.errCode || '') + '" placeholder="E---"></div></div></div>';
    var meterData = '<h2 class="section-title">' + esc(t('b_meter')) + '</h2><div class="grid2">' +
      '<div class="field"><label for="b-qt">' + esc(t('b_qt')) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></label><div class="ctl"><input id="b-qt" class="num" inputmode="decimal" data-m="transitionalFlow" value="' + esc(mt.transitionalFlow || '') + '"></div></div>' +
      '<div class="field"><label for="b-ver">' + esc(t('b_verified')) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></label><div class="ctl"><input id="b-ver" type="date" data-m="verifiedUntil" value="' + esc(mt.verifiedUntil || '') + '"></div></div></div>';
    return { screen: 'S03', route: 'baseline', bare: !S.onboarded, closeTo: 'home', html:
      '<h1>' + esc(t('b_title')) + '</h1><p>' + esc(t('b_lead')) + '</p>' +
      '<div class="banner">' + ico('info', 22) + '<div><p>' + esc(t('b_where')) + '</p></div></div>' +
      (VIS().available ? '<p><button type="button" class="btn sec" data-act="photo" data-mode="baseline" data-key="baseline-photo">' + ico('camera', 20) + '<span>' + esc(t('ph_base_entry')) + '</span></button></p>' : '') +
      (S._baseFill ? '<div class="banner" data-key="baseline-filled">' + ico('check', 22) + '<div><p>' + esc(t('ph_base_filled')) + '</p></div></div>' : '') +
      '<form id="baseline-form" data-key="baseline-form" novalidate><div class="panel">' + fields + '</div>' + meterData +
      '<p><button type="button" class="linkbtn" data-act="sample" data-key="baseline-sample">' + esc(t('b_sample')) + '</button></p>' +
      '<div class="row-actions"><button type="button" class="btn sec" data-act="skip-base" data-key="baseline-skip">' + esc(t('skip')) + '</button>' +
      '<button type="submit" class="btn" data-key="baseline-save">' + esc(t('save')) + '</button></div></form>' };
  };

  V.step = function (i) {
    var st = steps(), n = st.length; if (!S.draft) newDraft();
    i = Math.max(0, Math.min(n - 1, i)); S.draft.step = i; save();
    var s = st[i], m = model(), prev = prevForEntry();
    var head = '<div class="wiz-top" data-key="step-head"><span class="count">' + esc(t('s_step', { i: i + 1, n: n })) + '</span>' +
      (i > 0 && S.draft.date ? '<a class="date-chip" href="#step-0" data-key="step-date" title="' + esc(t('s_date_change')) + '">' + ico('calendar', 16) + '<span>' + esc(t('s_for_date', { d: R.toHtmDate(S.draft.date) })) + '</span></a>' : '') + '<span class="progress" aria-hidden="true"><i style="width:' + Math.round((i + 1) / n * 100) + '%"></i></span></div>';
    var left = '', right = '';
    if (s.kind === 'date') {
      left = '<h1>' + esc(t('s_date_title')) + '</h1><p>' + esc(t('s_date_lead')) + '</p>' + (windowClosed() ? windowBanner() : '') +
        (VIS().available ? '<p><button class="linkbtn" data-act="photo" data-mode="reading" data-key="step-photo">' + esc(t('ph_step_hint')) + '</button></p>' : '');
      right = '<div class="field"><label for="f-date">' + esc(t('s_date')) + '</label><div class="ctl"><input id="f-date" type="date" data-field="date" value="' + esc(S.draft.date || today()) + '" max="' + today() + '"></div><div class="help" id="h-date"></div></div>';
    } else {
      var press = s.press === null ? '<p class="press">' + ico('press', 26) + esc(t('s_first')) + '</p>'
        : s.count ? '<p class="press">' + ico('press', 26) + esc(t('s_press')) + ' <span class="times">' + esc(t('s_press_n', { n: s.count })) + '</span></p>'
        : '<p class="press">' + ico('press', 26) + esc(t('s_press_find')) + '</p>';
      var title = s.fields.length === 1 ? fieldLabel(s.fields[0]) : s.fields.indexOf('tSupply') >= 0 ? (S.lang === 'ru' ? 'Температуры подачи и обратки' : 'Температури подачі й обратки') : s.fields.indexOf('hours') >= 0 ? (S.lang === 'ru' ? 'Часы работы' : 'Години роботи') : s.fields.map(fieldLabel).join(', ');
      S._single = s.fields.length === 1;
      var lines = s.fields.map(function (k, idx) {
        var typed = S.draft.values[k];
        var sampleText = idx === 0 ? s.lcd.digits : (s.lcd.alt ? s.lcd.alt.digits : s.lcd.digits);
        var tag = idx === 0 ? s.lcd.tag : (s.lcd.alt ? s.lcd.alt.tag : s.lcd.tag);
        if (k === 'energy' && energyUnit() !== 'Gcal') tag = energyUnit();
        return { id: 'lcd-' + k, text: typed ? lcdText(k, typed) : sampleText, tag: tag, corner: !!s.lcd.corner, sample: !typed };
      });
      left = press + lcd(lines, 'step-lcd') + '<p class="lcd-cap" id="lcd-cap">' + esc(Object.keys(S.draft.values).some(function (k) { return s.fields.indexOf(k) >= 0 && S.draft.values[k]; }) ? t('s_on_screen') : (S.lang === 'ru' ? 'Пример — так выглядит экран' : 'Приклад — так виглядає екран')) + '</p>' +
        '<p class="hint">' + esc(L(s.hint)) + '</p>' +
        (m && m.sleepMin ? '<p class="sleep">' + ico('moon', 18) + '<span>' + esc(t('s_sleep', { m: m.sleepMin })) + '</span></p>' : '');
      right = '<h1>' + esc(title) + '</h1>' + s.fields.map(function (k) { return k === 'errCode' ? errCodeField() : numField(k, prev); }).join('');
    }
    var isLast = i === n - 1;
    var actions = '<div class="wiz-actions">' + (i > 0 ? '<a class="btn sec" href="#step-' + (i - 1) + '" data-act="step-back" data-i="' + (i - 1) + '" data-key="step-back">' + ico('back', 20) + '<span>' + esc(t('back')) + '</span></a>' : '') +
      '<button class="btn" data-act="step-next" data-i="' + i + '" data-key="step-next">' + esc(isLast ? t('s_to_check') : t('next')) + '</button></div>';
    return { screen: 'S05', route: 'step', bare: true, closeTo: 'home', html: head + '<div class="wiz"><div>' + left + '</div><div><form id="step-form" novalidate>' + right + actions + '</form></div></div>' };
  };
  function lcdText(k, v) { if (k === 'errCode') return R.normCode(v).replace(/-/g, '-'); var x = String(v).replace(',', '.'); return x; }
  function numField(k, prev) {
    var v = S.draft.values[k] == null ? '' : S.draft.values[k];
    var cls = k === 'tSupply' ? ' supply' : k === 'tReturn' ? ' return' : '';
    var help = '';
    if (prev && prev[k] != null && prev[k] !== '') {
      help = t('s_prev', { v: (k === 'energy' ? String(prev[k]) : prev[k]) + ' ' + fieldUnit(k) });
      var plain = help;
      if (k === 'hours' && !(model() || {}).hoursOnlyWithFlow && S.draft.date && prev.date) {
        var exp = R.num(prev.hours) + R.daysBetween(prev.date, S.draft.date) * 24;
        help += S.lang === 'ru' ? '. Ожидаем около ' + exp + ' (±24)' : '. Очікуємо близько ' + exp + ' (±24)';
      } else if (['energy', 'volume', 'errHours'].indexOf(k) >= 0) help += S.lang === 'ru' ? ', должно быть не меньше' : ', має бути не менше';
    }
    if (typeof plain === 'undefined') var plain = help;
    if (k === 'errHours' && !help) help = S.lang === 'ru' ? 'Нет часов с ошибкой — впишите 0.' : 'Немає годин з помилкою — впишіть 0.';
    return '<div class="field" id="fw-' + k + '"><label for="f-' + k + '"' + (S._single ? ' class="sr"' : '') + '>' + esc(fieldLabel(k)) + '</label><div class="ctl' + cls + '"><input id="f-' + k + '" class="num" inputmode="decimal" autocomplete="off" enterkeyhint="next" data-field="' + k + '" value="' + esc(v) + '" aria-describedby="h-' + k + '"><span class="unit">' + esc(fieldUnit(k)) + '</span></div>' +
      '<div class="help" id="h-' + k + '" data-base="' + esc(help) + '" data-plain="' + esc(plain) + '">' + esc(help) + '</div></div>';
  }
  function errCodeField() {
    var v = S.draft.values.errCode || '', none = !v || R.normCode(v) === 'E---';
    return '<div class="field" id="fw-errCode"><span class="lbl sr">' + esc(fieldLabel('errCode')) + '</span><div class="choice">' +
      '<label><input type="radio" name="ec" value="none" data-act="ec"' + (none ? ' checked' : '') + '>' + esc(t('s_err_none')) + '</label>' +
      '<label><input type="radio" name="ec" value="code" data-act="ec"' + (none ? '' : ' checked') + '>' + esc(t('s_err_code')) + '</label></div>' +
      '<div class="ctl" style="margin-top:12px' + (none ? ';display:none' : '') + '" id="ec-ctl"><input id="f-errCode" class="num" autocomplete="off" data-field="errCode" value="' + esc(none ? '' : v) + '" placeholder="E-3"></div><div class="help" id="h-errCode"></div></div>';
  }

  V.check = function () {
    if (!S.draft) return V.home();
    var res = runCheck(S.draft), r = draftReadingGcal(S.draft);
    S._lastCheck = res;
    var vText = { ok: t('c_ok'), warn: t('c_warn'), block: t('c_block') }[res.verdict];
    var order = { block: 0, warn: 1, info: 2, ok: 3 };
    var items = res.items.slice().sort(function (a, b) { return order[a.level] - order[b.level]; });
    var byField = {}; items.forEach(function (it) { if (it.field && (!byField[it.field] || order[it.level] < order[byField[it.field]])) byField[it.field] = it.level; });
    var issues = items.length ? '<ul class="issues" data-key="check-issues">' + items.map(function (it) {
      var fixLink = it.field && it.code !== 'W_WINDOW' ? '<div><button class="linkbtn" data-act="fix" data-field="' + it.field + '" data-key="fix-' + it.code + '">' + esc(t('c_fix')) + ': ' + esc(fieldLabel(it.field).toLowerCase()) + '</button></div>' : '';
      return '<li data-code="' + it.code + '" data-level="' + it.level + '"><span class="ic">' + levelIco(it.level, 22) + '</span><div class="msg">' + esc(L(it.msg)) + '</div>' +
        (it.fix ? '<div class="fix">' + esc(L(it.fix)) + '</div>' : '') + fixLink + '</li>';
    }).join('') + '</ul>' : '';
    var rows = R.FIELDS.map(function (f) {
      var lvl = byField[f.key]; var val = R.formatForHtm(f.key, r[f.key]);
      return '<tr class="' + (lvl === 'block' ? 'is-block' : lvl === 'warn' ? 'is-warn' : '') + '"><th scope="row">' + esc(fieldLabel(f.key)) + (f.key === 'energy' ? ', Гкал' : '') + '</th><td>' + esc(val || '—') + '</td></tr>';
    }).join('');
    var d = res.derived, period = '';
    if (res.verdict !== 'block' && d && d.dE != null && d.dE >= 0 && S.baseline && R.daysBetween(S.baseline.date, r.date) > 0) {
      period = '<p class="small muted" data-key="check-period">' + esc(t('c_period', { de: d.dE.toFixed(3), days: R.daysBetween(S.baseline.date, r.date), cost: money(d.cost || 0) })) + '</p>';
    }
    var canSend = res.verdict !== 'block';
    var actions = '<div class="row-actions">' +
      '<button class="btn sec" data-act="save-inter" data-key="check-save-inter">' + esc(t('c_save_inter')) + '</button>' +
      '<button class="btn" data-act="to-handover" data-key="check-send"' + (canSend ? '' : ' disabled') + '>' + esc(res.verdict === 'warn' ? t('c_send_anyway') : t('c_send')) + '</button></div>';
    return { screen: 'S06', route: 'check', bare: true, closeTo: 'home', html:
      '<div class="wiz-top"><a class="btn ghost" href="#step-' + (steps().length - 1) + '">' + ico('back', 20) + '<span>' + esc(t('back')) + '</span></a></div>' +
      '<h1>' + esc(t('c_title')) + '</h1>' +
      '<div class="verdict ' + res.verdict + '" data-key="check-verdict" data-verdict="' + res.verdict + '" role="status">' + levelIco(res.verdict, 28) + '<span>' + esc(vText) + '</span></div>' +
      '<div class="cols"><div>' + issues + period + '</div><div><h2 class="section-title" style="margin-top:0">' + esc(t('c_values')) + '</h2><table class="vals" data-key="check-values">' + rows + '</table></div></div>' + actions };
  };

  V.handover = function () {
    var r = RD().filter(function (x) { return x.id === S.focusId; })[0] || RD().filter(function (x) { return x.status === 'checked'; }).slice(-1)[0];
    if (!r) return V.home();
    var h = r.htm;
    var rows = R.FIELDS.map(function (f) {
      var val = R.formatForHtm(f.key, h[f.key]);
      return '<li><div><div class="k">' + esc(fieldLabel(f.key)) + (f.key === 'energy' ? ', Гкал' : '') + '</div><div class="v">' + esc(val) + '</div></div><span></span>' +
        '<button class="btn sec" data-act="copy" data-text="' + esc(val) + '" data-key="copy-' + f.key + '">' + ico('copy', 18) + '<span>' + esc(t('copy')) + '</span></button></li>';
    });
    var c = S.contacts || {};
    if (c.phone) rows.push('<li><div><div class="k">' + esc(t('ho_phone')) + '</div><div class="v">' + esc(c.phone) + '</div></div><span></span><button class="btn sec" data-act="copy" data-text="' + esc(c.phone) + '">' + ico('copy', 18) + '<span>' + esc(t('copy')) + '</span></button></li>');
    if (c.email) rows.push('<li><div><div class="k">' + esc(t('ho_email')) + '</div><div class="v" style="font-size:16px">' + esc(c.email) + '</div></div><span></span><button class="btn sec" data-act="copy" data-text="' + esc(c.email) + '">' + ico('copy', 18) + '<span>' + esc(t('copy')) + '</span></button></li>');
    var all = R.FIELDS.map(function (f) { return fieldLabel(f.key) + ': ' + R.formatForHtm(f.key, h[f.key]); }).join('\n') + (c.phone ? '\n' + t('ho_phone') + ': ' + c.phone : '') + (c.email ? '\n' + t('ho_email') + ': ' + c.email : '');
    return { screen: 'S07', route: 'handover', bare: true, closeTo: 'home', html:
      '<div class="wiz-top"><a class="btn ghost" href="#check">' + ico('back', 20) + '<span>' + esc(t('back')) + '</span></a></div>' +
      '<h1>' + esc(t('ho_title')) + '</h1><p>' + esc(t('ho_lead')) + '</p>' +
      '<div class="cols"><div class="ho-values"><ul class="copy-list" data-key="handover-values">' + rows.join('') + '</ul>' +
      '<div class="row-actions"><button class="btn sec" data-act="copy" data-text="' + esc(all) + '" data-key="copy-all">' + ico('copy', 20) + '<span>' + esc(t('ho_copy_all')) + '</span></button></div>' +
      (c.phone && c.email ? '' : '<div class="banner warn" style="margin-top:16px">' + ico('alert', 22) + '<div><p>' + esc(t('ho_contacts_none')) + ' <a href="#prefs">' + esc(t('nav_prefs')) + '</a></p></div></div>') + '</div>' +
      '<div class="ho-steps"><div class="panel"><h2>' + esc(t('ho_steps_title')) + '</h2><ol class="steps"><li>' + esc(t('ho_s1')) + '</li><li>' + esc(t('ho_s2')) + '</li><li>' + esc(t('ho_s3')) + '</li><li>' + esc(t('ho_s4')) + '</li></ol>' +
      '<a class="btn sec block" href="' + HTM_URL + '" target="_blank" rel="noopener" data-key="handover-open">' + ico('ext', 20) + '<span>' + esc(t('ho_open')) + '</span></a></div>' +
      '<div class="panel soon" data-key="handover-auto"><h3>' + esc(t('ho_auto')) + ' <span class="pill">' + (S.lang === 'ru' ? 'скоро' : 'незабаром') + '</span></h3><p class="small muted" style="margin:0">' + esc(t('ho_auto_sub')) + '</p></div></div></div>' +
      '<div class="row-actions"><button class="btn big" data-act="handed" data-id="' + r.id + '" data-key="handover-done">' + ico('check', 22) + '<span>' + esc(t('ho_saved')) + '</span></button></div>' };
  };

  V.status = function () {
    var r = RD().filter(function (x) { return x.id === S.focusId; })[0] || RD().filter(function (x) { return x.status === 'handed'; }).slice(-1)[0];
    if (!r) return { screen: 'S08', route: 'status', html: '<h1>' + esc(t('st_title')) + '</h1><p class="muted">' + esc(t('st_none')) + '</p><a class="btn" href="#home">' + esc(t('nav_home')) + '</a>' };
    var head = '<h1>' + esc(t('st_title')) + '</h1><p class="muted">' + esc(fmtDate(r.htm.date, true)) + ', <span class="num">' + esc(R.formatForHtm('energy', r.htm.energy)) + '</span> Гкал</p>';
    var body = '';
    if (r.status === 'accepted') {
      body = '<div class="verdict ok" data-key="status-accepted">' + levelIco('ok', 28) + '<span>' + esc(t('st_accepted')) + '</span></div><p>' + esc(t('st_accepted_sub')) + '</p>' +
        (interval(r) ? '<p class="muted">' + esc(intervalText(interval(r))) + '</p>' : '') +
        '<a class="btn" href="#home">' + esc(t('done')) + '</a>';
    } else if (r.status === 'rejected') {
      var dec = r.robot || {};
      body = '<div class="verdict block" data-key="status-rejected">' + levelIco('block', 28) + '<span>' + esc(t('st_rejected')) + '</span></div>' +
        (r.robot && r.robot.text ? '<p class="small muted">«' + esc(r.robot.text) + '»</p>' : '') +
        '<div class="banner ' + (dec.fix ? 'warn' : 'bad') + '">' + ico('info', 22) + '<div><p>' + esc(dec.fix ? L(dec.fix) : t('st_unknown')) + '</p></div></div>' +
        '<p class="small muted">' + esc(t('st_refix_sub')) + '</p>' +
        '<div class="row-actions"><button class="btn" data-act="refix" data-id="' + r.id + '" data-key="status-refix">' + esc(t('st_refix')) + '</button></div>';
    } else if (r.status === 'handed') {
      var mins = Math.round((Date.now() - Date.parse(r.handedAt)) / 60000);
      var at = new Date(Date.parse(r.handedAt) + 30 * 60000);
      body = '<div class="banner" data-key="status-waiting">' + ico('clock', 22) + '<div><p><b>' + esc(t('st_wait')) + '</b></p><p>' + esc(t('st_wait_ago', { ago: ago(r.handedAt) })) + '</p></div></div>' +
        '<p>' + esc(t('st_how')) + '</p>' + (mins < 15 ? '<p class="small muted">' + esc(t('st_early', { at: ('0' + at.getHours()).slice(-2) + ':' + ('0' + at.getMinutes()).slice(-2) })) + '</p>' : '') +
        '<div class="row-actions"><button class="btn" data-act="accepted" data-id="' + r.id + '" data-key="status-ok">' + ico('check', 22) + '<span>' + esc(t('st_ok_btn')) + '</span></button>' +
        '<button class="btn sec" data-act="show-reject" data-key="status-bad">' + ico('cross', 22) + '<span>' + esc(t('st_bad_btn')) + '</span></button></div>' +
        '<form id="reject-form" data-id="' + r.id + '" style="display:none;margin-top:24px" novalidate><div class="field"><label for="rej-text">' + esc(t('st_paste')) + '</label><div class="ctl"><textarea id="rej-text" placeholder="Статус: Показання не прийняті з причини: …"></textarea></div></div>' +
        '<button type="submit" class="btn" data-key="status-decode">' + esc(t('st_decode')) + '</button></form>' +
        '<p style="margin-top:24px"><a href="' + HTM_URL + '" target="_blank" rel="noopener">' + esc(t('ho_open')) + '</a></p>';
    } else {
      body = '<p><span class="pill">' + esc(t('status_' + r.status)) + '</span></p><a class="btn" href="#home">' + esc(t('nav_home')) + '</a>';
    }
    return { screen: 'S08', route: 'status', html: head + body };
  };

  V.history = function () {
    if (window.TeploStats) loadWeather();
    var arr = RD().slice().sort(function (a, b) { var x = (b.htm && b.htm.date) || '', y = (a.htm && a.htm.date) || ''; return x < y ? -1 : x > y ? 1 : 0; });
    return { screen: 'S09', route: 'history', html: '<h1>' + esc(t('hi_title')) + '</h1>' +
      (arr.length ? readingList(arr) : '<div class="panel"><p class="muted">' + esc(t('hi_empty')) + '</p><button class="btn" data-act="read">' + esc(t('hi_empty_cta')) + '</button></div>') };
  };

  /** Карточка показаний из истории: все 10 значений, сколько набежало и почём; правка и удаление. */
  function recView(id, edit) {
    var r = RD().filter(function (x) { return x.id === id; })[0];
    if (!r) return { screen: 'S09', route: 'history', html: '<h1>' + esc(t('hi_title')) + '</h1><p class="muted">' + esc(t('rec_gone')) + '</p><a class="btn" href="#history">' + esc(t('back')) + '</a>' };
    var h = r.htm || {}, iv = interval(r), cls = { accepted: 'ok', rejected: 'bad', handed: 'info' }[r.status] || 'neutral';
    var head = '<p><a href="#history">← ' + esc(t('hi_title')) + '</a></p><h1>' + esc(fmtDate(h.date, true)) + '</h1>' +
      '<p><span class="pill ' + cls + '">' + esc(t('status_' + r.status)) + '</span> <span class="small muted">' + esc(r.source === 'photo' ? t('rec_src_photo') : t('rec_src_manual')) + (r.editedAt ? ' · ' + t('rec_edited') : '') + '</span></p>';
    if (edit) {
      return { screen: 'S09', route: 'history', html: head + '<form id="rec-form" data-id="' + r.id + '" novalidate><div class="panel">' +
        '<div class="field" style="max-width:280px"><label for="re-date">' + esc(fieldLabel('date')) + '</label><div class="ctl"><input id="re-date" type="date" value="' + esc(h.date || '') + '" max="' + today() + '" required></div></div>' +
        R.FIELDS.filter(function (f) { return f.key !== 'date'; }).map(function (f) {
          var v = f.key === 'errCode' ? (h.errCode || '') : (R.num(h[f.key]) === null ? '' : R.formatForHtm(f.key, h[f.key]));
          return '<div class="field"><label for="re-' + f.key + '">' + esc(fieldLabel(f.key)) + (f.unit ? ', ' + esc(f.key === 'energy' ? 'Гкал' : fieldUnit(f.key)) : '') + '</label><div class="ctl"><input id="re-' + f.key + '" class="num" data-re="' + f.key + '" inputmode="' + (f.key === 'errCode' ? 'text' : 'decimal') + '" value="' + esc(v) + '"></div></div>';
        }).join('') + '<div class="help block" id="re-err"></div></div>' +
        '<div class="row-actions"><a class="btn sec" href="#rec-' + r.id + '">' + esc(t('cancel')) + '</a><button class="btn" type="submit" data-key="rec-save">' + esc(t('save')) + '</button></div></form>' };
    }
    var rows = R.FIELDS.filter(function (f) { return f.key !== 'date'; }).map(function (f) {
      var v = f.key === 'errCode' ? (h.errCode || '—') : (R.num(h[f.key]) === null ? '—' : R.formatForHtm(f.key, h[f.key]));
      return '<li><div class="grow small muted">' + esc(fieldLabel(f.key)) + '</div><b class="num">' + esc(v) + '</b>' + (f.unit && v !== '—' ? ' <span class="small muted">' + esc(f.key === 'energy' ? 'Гкал' : fieldUnit(f.key)) + '</span>' : '') + '</li>';
    }).join('');
    if (window.TeploStats) loadWeather();
    var wx = wxFor(r);
    var used = iv ? '<div class="panel" data-key="rec-used"><h2>' + esc(t('rec_used_title')) + '</h2>' + (iv.dE < 0 ? '<p class="small">' + esc(intervalText(iv)) + '</p>' :
      '<div class="cards2"><div><div class="num big">' + esc(iv.dE.toFixed(3)) + '</div><div class="small muted">' + esc(t('rec_gcal_for', { days: iv.days, from: fmtDate(iv.from, true) })) + '</div></div>' +
      '<div><div class="num big">≈ ' + esc(money(iv.cost)) + '</div><div class="small muted">' + esc(t('rec_uah', { tariff: money(tariff()) })) + '</div></div></div>' +
      '<p class="small muted">' + esc(t('rec_parts', { heat: money(iv.parts.heat), mzk: money(iv.parts.mzk), abon: money(iv.parts.abon) })) + '</p>' +
      (iv.days > 0 ? '<p class="small muted">' + esc(t('rec_per_month', { de: (iv.dE / iv.days * MONTH_DAYS).toFixed(3), cost: money(costOf(iv.dE / iv.days * MONTH_DAYS, MONTH_DAYS).total) })) + '</p>' : '')) + '</div>' : '';
    var st = (r.status === 'handed' || r.status === 'rejected' || r.status === 'accepted') ? '<a class="btn sec" href="#status" data-act="focus" data-id="' + r.id + '">' + esc(t('rec_status')) + '</a>' : '';
    var wxp = wx ? '<div class="panel wx-panel" data-key="rec-weather"><h2>' + ico('thermo', 20) + ' ' + esc(t('wx_title')) + '</h2><div class="wx-tiles">' +
      (wx.avg !== null ? '<div><div class="num big wx-t-' + wxTone(wx.avg) + '">' + esc(degTxt(wx.avg)) + '</div><div class="small muted">' + esc(t('wx_t_avg')) + '</div></div>' +
        '<div><div class="num mid">' + esc(degTxt(wx.min)) + ' … ' + esc(degTxt(wx.max)) + '</div><div class="small muted">' + esc(t('wx_t_range')) + '</div></div>' +
        '<div><div class="num mid">' + wx.frost + ' / ' + wx.ser.length + '</div><div class="small muted">' + esc(t('wx_t_frost')) + '</div></div>' : '') +
      (wx.day !== null ? '<div><div class="num mid">' + esc(degTxt(wx.day)) + '</div><div class="small muted">' + esc(t('wx_t_day')) + '</div></div>' : '') + '</div>' + wxSpark(wx.ser) + '</div>' : '';
    return { screen: 'S09', route: 'history', html: head + used + wxp + '<ul class="list" data-key="rec-values">' + rows + '</ul>' +
      '<div class="row-actions">' + st + '<a class="btn sec" href="#rec-' + r.id + '-edit" data-key="rec-edit">' + esc(t('rec_edit')) + '</a>' +
      '<button class="btn danger" data-act="rec-del-ask" data-key="rec-del">' + esc(t('rec_del')) + '</button></div><div id="rec-del-confirm"></div>' };
  }

  // ---------------- статистика (пока только владельцу) ----------------
  var WX = { key: '', days: null, loading: false, err: '' };   // погода Харькова по дням для диапазона истории
  function loadWeather() {
    if (!window.TEPLO_API) return;
    var rg = window.TeploStats && TeploStats.range(RD(), S.baseline); if (!rg) return;
    var key = rg.from + '_' + rg.to; if (WX.key === key && (WX.days || WX.loading)) return;
    WX = { key: key, days: null, loading: true, err: '' };
    fetch(window.TEPLO_API + '/weather?from=' + rg.from + '&to=' + rg.to, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); }).then(function (j) { WX.loading = false; if (j && j.days) WX.days = j.days; else WX.err = (j && (j.human || j.error)) || 'error'; if (/^(stats|history|rec-)/.test(routeName())) safeRender(); },
        function () { WX.loading = false; WX.err = 'network'; if (routeName() === 'stats') safeRender(); });
  }
  function shortDate(d) { var p = dateParts(d); return ('0' + p.d).slice(-2) + '.' + ('0' + p.m).slice(-2) + '.' + String(p.y).slice(2); }
  // цвета графиков — из CSS-токенов (светлая/тёмная тема); обновляются при каждой отрисовке
  var CH = {};
  function chColors() { var cs = getComputedStyle(document.documentElement), g = function (k) { return cs.getPropertyValue(k).trim(); };
    CH = { ink: g('--c-ink'), ink2: g('--c-ink-2'), grid: g('--ch-grid'), bar: g('--ch-bar'), barSoft: g('--ch-bar-soft'), ok: g('--ch-ok'), low: g('--ch-low'), bad: g('--ch-bad'), none: g('--ch-none'), off: g('--ch-off'), ring: g('--ch-dot-ring'), surface: g('--c-surface') }; }
  /** Ширина рисунка = реальной ширине на экране (на телефоне подписи не мельчают). */
  function chartW() { var w = Math.min(window.innerWidth || 640, 760) - 64; return Math.max(320, Math.min(640, w)); }
  function tipAttr(lines) { return ' tabindex="0" data-tip="' + esc(lines.filter(Boolean).join('\n')) + '"'; }
  function nTicks(max) { var n = max / Math.pow(10, Math.floor(Math.log10(max))); return (n === 2 || n === 1) ? 4 : 5; }
  function niceMax(v) { if (!(v > 0)) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
  function fmtN(v, d) { return (d === 0 ? String(Math.round(v)) : v.toFixed(d)).replace('.', ','); }
  /** Столбики. items: [{x, v, tip[], soft, color, top}] */
  function barChart(items, o) {
    var W = chartW(), H = 236, L = 46, R = 10, T = 16, B = items.some(function (x) { return x.x2; }) ? 40 : 30, iw = W - L - R, ih = H - T - B;
    var max = o.max || niceMax(Math.max.apply(null, items.map(function (x) { return x.v || 0; }).concat([o.ref ? o.ref.v : 0])) * 1.08);
    var y = function (v) { return T + ih - Math.max(0, v) / max * ih; }, slot = iw / Math.max(1, items.length), bw = Math.min(46, slot * 0.62);
    var g = '';
    var nt = nTicks(max), dec = o.dec !== undefined ? (max / nt < 1 ? (max / nt < 0.1 ? 2 : 1) : 0) : 1;
    for (var k = 0; k <= nt; k++) { var tv = max * k / nt, yy = y(tv); g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" stroke="' + CH.grid + '"/><text x="' + (L - 6) + '" y="' + (yy + 4) + '" text-anchor="end" class="ax">' + esc(fmtN(tv, dec)) + '</text>'; }
    var bars = items.map(function (it, i) {
      var cx = L + slot * (i + 0.5), x0 = cx - bw / 2, yt = y(it.v || 0), yb = T + ih, h = Math.max(0, yb - yt), r = Math.min(4, h);
      var path = h > 0 ? 'M' + x0 + ',' + yb + 'V' + (yt + r) + 'Q' + x0 + ',' + yt + ' ' + (x0 + r) + ',' + yt + 'H' + (x0 + bw - r) + 'Q' + (x0 + bw) + ',' + yt + ' ' + (x0 + bw) + ',' + (yt + r) + 'V' + yb + 'Z' : '';
      return '<g class="mk"' + tipAttr(it.tip) + '><rect x="' + (cx - slot / 2) + '" y="' + T + '" width="' + slot + '" height="' + (ih + B) + '" fill="transparent"/>' +
        (path ? '<path d="' + path + '" fill="' + (it.color || (it.soft ? CH.barSoft : CH.bar)) + '"/>' : '') +
        (it.top ? '<text x="' + cx + '" y="' + (yt - 5) + '" text-anchor="middle" class="vl">' + esc(it.top) + '</text>' : '') +
        (i % Math.ceil(52 / slot) === 0 ? '<text x="' + cx + '" y="' + (T + ih + 17) + '" text-anchor="middle" class="ax">' + esc(it.x) + '</text>' : '') +
        (it.x2 && i % Math.ceil(40 / slot) === 0 ? '<text x="' + cx + '" y="' + (T + ih + 31) + '" text-anchor="middle" class="ax x2">' + esc(it.x2) + '</text>' : '') + '</g>';
    }).join('');
    var ref = o.ref ? '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(o.ref.v) + '" y2="' + y(o.ref.v) + '" stroke="' + CH.ink2 + '" stroke-dasharray="4 4"/><text x="' + (W - R) + '" y="' + (y(o.ref.v) - 5) + '" text-anchor="end" class="ax">' + esc(o.ref.label) + '</text>' : '';
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.title) + '">' + g + '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + (T + ih) + '" y2="' + (T + ih) + '" stroke="' + CH.ink2 + '"/>' + bars + ref + '</svg>';
  }
  var ST_ICO = { ok: '✓', low: '↓', bad: '⚠', none: '✕', off: '–' };
  /** Подача: факт (точка цвета состояния) против нормы графика (кольцо), соединены линией. */
  function coolantChart(pts) {
    var W = chartW(), H = 250, L = 46, R = 10, T = 16, B = 34, iw = W - L - R, ih = H - T - B;
    var max = niceMax(Math.max.apply(null, pts.map(function (p) { return Math.max(p.tSupply, p.norm || 0); })) * 1.05), y = function (v) { return T + ih - v / max * ih; }, slot = iw / Math.max(1, pts.length);
    var g = '';
    var nt = nTicks(max);
    for (var k = 0; k <= nt; k++) { var tv = max * k / nt, yy = y(tv); g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" stroke="' + CH.grid + '"/><text x="' + (L - 6) + '" y="' + (yy + 4) + '" text-anchor="end" class="ax">' + Math.round(tv) + '°</text>'; }
    var marks = pts.map(function (p, i) {
      var cx = L + slot * (i + 0.5), ya = y(p.tSupply), yn = p.norm ? y(p.norm) : null;
      return '<g class="mk"' + tipAttr([p.status !== 'off' ? ST_ICO[p.status] + ' ' + t('stt_' + p.status) : t('stt_off'), shortDate(p.date) + (p.tOut !== null ? ' · ' + t('stt_out', { t: fmtN(p.tOut, 1) }) : ''),
          t('stt_sup', { v: fmtN(p.tSupply, 1) }) + (p.norm ? ' · ' + t('stt_norm', { v: fmtN(p.norm, 1) }) + ' (' + (p.diff >= 0 ? '+' : '') + fmtN(p.diff, 1) + ')' : ''),
          p.tReturn !== null ? t('stt_ret', { v: fmtN(p.tReturn, 1), d: fmtN(p.dT, 1) }) : '', p.flow !== null ? t('stt_flow', { v: fmtN(p.flow, 3) }) : '']) + '>' +
        '<rect x="' + (cx - slot / 2) + '" y="' + T + '" width="' + slot + '" height="' + (ih + B) + '" fill="transparent"/>' +
        (yn !== null ? '<line x1="' + cx + '" x2="' + cx + '" y1="' + yn + '" y2="' + ya + '" stroke="' + CH.grid + '" stroke-width="3"/><circle cx="' + cx + '" cy="' + yn + '" r="6" fill="' + CH.surface + '" stroke="' + CH.ink2 + '" stroke-width="2"/>' : '') +
        '<circle cx="' + cx + '" cy="' + ya + '" r="7" fill="' + CH[p.status] + '" stroke="' + CH.ring + '" stroke-width="2"/>' +
        '<text x="' + cx + '" y="' + (Math.min(ya, yn === null ? ya : yn) - 11) + '" text-anchor="middle" class="vl">' + ST_ICO[p.status] + '</text>' +
        (i % Math.ceil(52 / slot) === 0 ? '<text x="' + cx + '" y="' + (H - 12) + '" text-anchor="middle" class="ax">' + esc(shortDate(p.date)) + '</text>' : '') + '</g>';
    }).join('');
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(t('stc_title')) + '">' + g + '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + (T + ih) + '" y2="' + (T + ih) + '" stroke="' + CH.ink2 + '"/>' + marks + '</svg>';
  }
  /** Связь с погодой: x — на улице, y — подача; линия — график 95/70; точки — замеры (цвет — состояние). */
  function corrChart(pts) {
    var P = pts.filter(function (p) { return p.tOut !== null; }); if (P.length < 2) return '';
    var W = chartW(), H = 260, L = 46, R = 12, T = 14, B = 40, iw = W - L - R, ih = H - T - B;
    var xs = P.map(function (p) { return p.tOut; }), x0 = Math.min(-15, Math.floor(Math.min.apply(null, xs) / 5) * 5), x1 = Math.max(10, Math.ceil(Math.max.apply(null, xs) / 5) * 5);
    var ymax = 100, x = function (v) { return L + (v - x0) / (x1 - x0) * iw; }, y = function (v) { return T + ih - v / ymax * ih; };
    var g = '';
    for (var k = 0; k <= 4; k++) { var tv = ymax * k / 4; g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(tv) + '" y2="' + y(tv) + '" stroke="' + CH.grid + '"/><text x="' + (L - 6) + '" y="' + (y(tv) + 4) + '" text-anchor="end" class="ax">' + tv + '°</text>'; }
    for (var xv = x0; xv <= x1; xv += 5) g += '<text x="' + x(xv) + '" y="' + (T + ih + 16) + '" text-anchor="middle" class="ax">' + (xv > 0 ? '+' : '') + xv + '°</text>';
    g += '<text x="' + (L + iw / 2) + '" y="' + (H - 4) + '" text-anchor="middle" class="ax">' + esc(t('stx_axis')) + '</text>';
    var curve = [], curveR = [];
    for (var tv2 = x0; tv2 <= Math.min(x1, 17); tv2 += 0.5) { var gg = TeploStats.graph(tv2); if (gg) { curve.push(x(tv2).toFixed(1) + ',' + y(gg.supply).toFixed(1)); curveR.push(x(tv2).toFixed(1) + ',' + y(gg.ret).toFixed(1)); } }
    var lines = '<polyline points="' + curve.join(' ') + '" fill="none" stroke="' + CH.ink2 + '" stroke-width="2" stroke-dasharray="6 4"/>' +
      '<polyline points="' + curveR.join(' ') + '" fill="none" stroke="' + CH.off + '" stroke-width="1.5" stroke-dasharray="2 4"/>';
    var dots = P.map(function (p) {
      return '<g class="mk"' + tipAttr([ST_ICO[p.status] + ' ' + t('stt_' + p.status), shortDate(p.date) + ' · ' + t('stt_out', { t: fmtN(p.tOut, 1) }),
        t('stt_sup', { v: fmtN(p.tSupply, 1) }) + (p.norm ? ' · ' + t('stt_norm', { v: fmtN(p.norm, 1) }) : ''), p.tReturn !== null ? t('stt_ret', { v: fmtN(p.tReturn, 1), d: fmtN(p.dT, 1) }) : '']) + '>' +
        '<circle cx="' + x(p.tOut) + '" cy="' + y(p.tSupply) + '" r="14" fill="transparent"/><circle cx="' + x(p.tOut) + '" cy="' + y(p.tSupply) + '" r="7" fill="' + CH[p.status] + '" stroke="' + CH.ring + '" stroke-width="2"/>' +
        '</g>';
    }).join('');
    return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(t('stx_title')) + '">' + g + lines + dots + '</svg>' +
      '<div class="legend small"><span><i class="dash"></i>' + esc(t('stx_l_sup')) + '</span><span><i class="dash dot2"></i>' + esc(t('stx_l_ret')) + '</span><span>' + esc(t('stx_l_pts')) + '</span></div>';
  }
  V.stats = function () {
    chColors();   // тестовый период: статистика открыта всем
    var St = window.TeploStats; loadWeather();
    var w = WX.days, ivs = St.intervals(RD(), S.baseline, w, tariff()), cl = St.coolant(RD(), S.baseline, w);
    ivs.forEach(function (it) { it.cost = +costOf(it.dE, it.days).total.toFixed(2); });
    if (!ivs.length) return { screen: 'S15', route: 'stats', html: '<h1>' + esc(t('stt_title')) + '</h1><div class="panel"><p class="muted">' + esc(t('stt_empty')) + '</p></div>' };
    var summer = function (it) { return it.days > 100; };
    var lbl = function (it) { return shortDate(it.to); };
    var period = function (it) { return t('stt_period', { a: R.toHtmDate(it.from), b: R.toHtmDate(it.to), d: it.days }); };
    var wxNote = WX.loading ? '<p class="small muted" role="status">' + SPIN + ' ' + esc(t('stt_wx_loading')) + '</p>' : WX.err ? '<p class="small muted">' + esc(t('stt_wx_err')) + '</p>' : '';
    // сводка: последний отопительный сезон (с 1 октября)
    var last = ivs[ivs.length - 1], sy = +last.to.slice(0, 4) - (last.to.slice(5, 7) < '10' ? 1 : 0), sFrom = sy + '-10-01';
    var season = ivs.filter(function (it) { return it.to > sFrom; }), sE = season.reduce(function (a, it) { return a + Math.max(0, it.dE); }, 0);
    var okN = cl.filter(function (p) { return p.status === 'ok'; }).length, judged = cl.filter(function (p) { return p.status !== 'off'; }).length;
    var tiles = '<div class="cards2 stat-tiles"><div><div class="num big">' + esc(fmtN(sE, 3)) + '</div><div class="small muted">' + esc(t('stt_season_g', { s: sy + '/' + String(sy + 1).slice(2) })) + '</div></div>' +
      '<div><div class="num big">≈ ' + esc(money(season.reduce(function (a, it) { return a + it.cost; }, 0))) + '</div><div class="small muted">' + esc(t('stt_season_uah')) + '</div></div>' +
      (judged ? '<div><div class="num big">' + okN + ' / ' + judged + '</div><div class="small muted">' + esc(t('stt_ok_share')) + '</div></div>' : '') + '</div>';
    var c1 = barChart(ivs.map(function (it) { return { x: lbl(it), x2: it.tOut !== undefined ? (it.tOut > 0 ? '+' : '') + Math.round(it.tOut) + ' °C' : '', v: Math.max(0, it.month), soft: summer(it), top: fmtN(it.month, 2),
      tip: [fmtN(it.month, 3) + ' ' + t('stt_g30'), period(it), '+' + fmtN(it.dE, 3) + ' Гкал ≈ ' + money(it.cost) + ' грн', it.tOut !== undefined ? t('stt_tout', { t: fmtN(it.tOut, 1) }) : '', summer(it) ? t('stt_summer') : ''] }; }), { title: t('st1_title'), dec: 1 });
    var withW = ivs.filter(function (it) { return it.perHdd != null && !summer(it); });
    var c2 = withW.length ? barChart(withW.map(function (it) { return { x: lbl(it), v: it.perHdd, top: fmtN(it.perHdd, 2),
      tip: [fmtN(it.perHdd, 2) + ' ' + t('stt_mcal'), period(it), t('stt_tout', { t: fmtN(it.tOut, 1) }) + ' · ' + t('stt_hdd', { v: it.hdd })] }; }), { title: t('st2_title'), dec: 1 }) : '';
    var withS = ivs.filter(function (it) { return it.share != null && !summer(it); });
    var c3 = withS.length ? barChart(withS.map(function (it) { var pc = Math.round(it.share * 100); return { x: lbl(it), v: pc, top: pc + '%', color: pc >= 95 ? CH.bar : pc >= 80 ? CH.low : CH.bad,
      tip: [pc + '% ' + t('stt_share_tip'), period(it), t('stt_off_h', { h: Math.max(0, Math.round(it.days * 24 - it.dH)) })] }; }), { title: t('st3_title'), max: 100, dec: 0, ref: { v: 100, label: '100%' } }) : '';
    var withT = ivs.filter(function (it) { return it.dT != null && !summer(it); });
    var c4 = withT.length ? barChart(withT.map(function (it) { return { x: lbl(it), v: it.dT, top: fmtN(it.dT, 1) + '°', color: it.dT >= 3 ? CH.bar : CH.low,
      tip: [fmtN(it.dT, 1) + ' °C ' + t('stt_dt_tip'), period(it), it.flow != null ? t('stt_avgflow', { v: fmtN(it.flow, 3) }) : ''] }; }), { title: t('st4_title'), dec: 0, ref: { v: 3, label: t('stt_dt_ref') } }) : '';
    var legend = '<div class="legend small"><span><i class="dot" style="background:' + CH.ink + '"></i>' + esc(t('stl_fact')) + '</span><span><i class="ring"></i>' + esc(t('stl_norm')) + '</span>' +
      ['ok', 'low', 'bad', 'none'].map(function (k) { return '<span><i class="dot" style="background:' + CH[k] + '"></i>' + ST_ICO[k] + ' ' + esc(t('stt_' + k)) + '</span>'; }).join('') + '</div>';
    var panel = function (title, sub, chart, extra) { return chart ? '<section class="panel chart-panel"><h2>' + esc(title) + '</h2><p class="small muted">' + esc(sub) + '</p>' + chart + (extra || '') + '</section>' : ''; };
    var table = '<details class="panel"><summary>' + esc(t('stt_table')) + '</summary><div class="tbl-wrap"><table class="tbl"><thead><tr><th>' + esc(t('stt_th_period')) + '</th><th>Гкал</th><th>' + esc(t('stt_g30')) + '</th><th>грн</th><th>°C ' + esc(t('stt_th_out')) + '</th><th>' + esc(t('stt_th_hdd')) + '</th><th>ΔT</th><th>м³/год</th><th>' + esc(t('stt_th_share')) + '</th></tr></thead><tbody>' +
      ivs.map(function (it) { return '<tr><td>' + esc(R.toHtmDate(it.from) + ' – ' + R.toHtmDate(it.to)) + '</td><td class="num">' + fmtN(it.dE, 3) + '</td><td class="num">' + fmtN(it.month, 3) + '</td><td class="num">' + money(it.cost) + '</td><td class="num">' + (it.tOut !== undefined ? fmtN(it.tOut, 1) : '—') + '</td><td class="num">' + (it.perHdd != null ? fmtN(it.perHdd, 2) : '—') + '</td><td class="num">' + (it.dT != null ? fmtN(it.dT, 1) : '—') + '</td><td class="num">' + (it.flow != null ? fmtN(it.flow, 3) : '—') + '</td><td class="num">' + (it.share != null ? Math.round(it.share * 100) + '%' : '—') + '</td></tr>'; }).join('') +
      '</tbody></table></div></details>';
    return { screen: 'S15', route: 'stats', html: '<h1>' + esc(t('stt_title')) + '</h1><p class="muted">' + esc(t('stt_lead')) + '</p>' + wxNote + tiles +
      panel(t('stc_title'), t('stc_sub'), cl.length ? coolantChart(cl) : '', legend) +
      panel(t('stx_title'), t('stx_sub'), corrChart(cl)) +
      panel(t('st1_title'), t('st1_sub'), c1) + panel(t('st3_title'), t('st3_sub'), c3) + panel(t('st2_title'), t('st2_sub'), c2) + panel(t('st4_title'), t('st4_sub'), c4) + table +
      '<p class="small muted">' + esc(t('stt_method')) + '</p>' };
  };
  (function () {   // подсказки графиков: наведение и фокус; текст — через textContent
    var show = function (el, x, y) { var tp = document.getElementById('ctip');
      if (!tp) { tp = document.createElement('div'); tp.id = 'ctip'; tp.className = 'ctip'; tp.setAttribute('role', 'tooltip'); document.body.appendChild(tp); }
      tp.innerHTML = '';
      el.getAttribute('data-tip').split('\n').forEach(function (ln, i) { var d = document.createElement('div'); d.textContent = ln; if (i === 0) d.className = 'ctip-v'; tp.appendChild(d); });
      tp.hidden = false; var w = tp.offsetWidth, hh = tp.offsetHeight; tp.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)) + 'px'; tp.style.top = Math.max(8, y - hh - 14) + 'px'; };
    var hide = function () { var tp = document.getElementById('ctip'); if (tp) tp.hidden = true; };
    document.addEventListener('pointermove', function (e) { var el = e.target.closest && e.target.closest('[data-tip]'); if (el) show(el, e.clientX, e.clientY); else hide(); });
    document.addEventListener('focusout', function () { setTimeout(function () { var f = document.activeElement; if (!(f && f.matches && f.matches('[data-field]'))) document.documentElement.classList.remove('kb-open'); }, 60); });
  document.addEventListener('focusin', function (e) { var el = e.target.closest && e.target.closest('[data-tip]'); if (el) { var b = el.getBoundingClientRect(); show(el, b.left + b.width / 2, b.top); } });
    document.addEventListener('focusout', hide);
    window.addEventListener('hashchange', hide); window.addEventListener('scroll', hide, { passive: true });
  })();

  // ---------------- як заощадити тепло ----------------
  /** Поради з урахуванням реалій ХТМ: квартирний лічильник, робот ХТМ (мін. витрата), норми ДБН. Джерела — у кінці сторінки. */
  function tips() {
    var ru = S.lang === 'ru';
    return ru ? [
      ['Какую температуру ставить', 'Жилые комнаты — 20–21 °C, спальня — 18–19 °C, ночью и когда никого нет — на 2–3 °C ниже. Ниже 18 °C (в угловых комнатах 20 °C) — это уже меньше нормы ДБН. Каждый градус ниже — примерно 5–6 % тепла.'],
      ['Термоголовки на батареи', 'Автоматический терморегулятор сам держит заданную температуру и учитывает «бесплатное» тепло — солнце, плиту, людей. Производители оценивают экономию примерно в 20 % по сравнению с ручными кранами. Обычно отметка «3» ≈ 20 °C — точнее в паспорте головки.'],
      ['Не перекрывайте батареи полностью', 'Наша реалия: робот ХТМ не принимает показания, если средний расход меньше 0,3 × переходного, а ELF и TRUST считают часы только при расходе. Поэтому вместо «закрыть всё» — термоголовки на 16–18 °C, хотя бы одна батарея открыта. ХТМ советует держать разницу подачи и обратки больше 3 °C.'],
      ['Не прячьте батареи', 'Длинные шторы, мебель, декоративные экраны и бельё на радиаторе забирают до 20 % тепла — оно остаётся под подоконником. Термоголовке нужен свободный воздух, иначе она «думает», что уже тепло.'],
      ['Проветривайте коротко и настежь', '5–10 минут с широко открытым окном несколько раз в день, на это время прикрутите термоголовку. Окно на микропроветривании весь день остужает стены и съедает тепло.'],
      ['Ночью — убавить, а не выключить', 'Полностью выключать на ночь невыгодно: стены и пол остывают, утром на прогрев уходит больше. Достаточно −2–3 °C.'],
      ['Шторы и окна', 'На ночь закрывайте плотные шторы, днём на солнечной стороне — открывайте. Уплотнители, «зимний» режим фурнитуры, герметик на щелях; на внешней стене — фольгированный экран за батареей (утеплённые ниши — до 4 %).'],
      ['Воздух в батарее', 'Если верх батареи холодный, а низ горячий — спустите воздух краном Маевского. Батарея прогреется целиком, и комфорт будет при меньшей настройке.'],
      ['Сравнивайте месяцы в Истории', 'Смотрите «в среднем за 30 дней». Резкий рост при похожей погоде — ищите причину: открытое окно, сломанная термоголовка, разбалансировка стояка (вопрос к ОСББ/ЖЭК).'],
      ['Холодно — перерасчёта не будет', 'С квартирным счётчиком вы платите за фактически полученное тепло, перерасчёт «за холод» делают только без счётчиков. Если холодно при открытых батареях — это вопрос к ОСББ/ХТМ (балансировка, давление), а не к счёту.']
    ] : [
      ['Яку температуру ставити', 'Житлові кімнати — 20–21 °C, спальня — 18–19 °C, вночі й коли нікого немає — на 2–3 °C нижче. Нижче 18 °C (у кутових кімнатах 20 °C) — це вже менше за норму ДБН. Кожен градус нижче — приблизно 5–6 % тепла.'],
      ['Термоголовки на батареї', 'Автоматичний терморегулятор сам тримає задану температуру й враховує «безкоштовне» тепло — сонце, плиту, людей. Виробники оцінюють економію приблизно у 20 % порівняно з ручними кранами. Зазвичай позначка «3» ≈ 20 °C — точніше в паспорті головки.'],
      ['Не перекривайте батареї повністю', 'Наша реалія: робот ХТМ не приймає показання, якщо середня витрата менша за 0,3 × перехідної, а ELF і TRUST рахують години лише при витраті. Тож замість «закрити все» — термоголовки на 16–18 °C, хоча б одна батарея відкрита. ХТМ радить тримати різницю подачі й обратки більше 3 °C.'],
      ['Не ховайте батареї', 'Довгі штори, меблі, декоративні екрани й білизна на радіаторі забирають до 20 % тепла — воно лишається під підвіконням. Термоголовці потрібне вільне повітря, інакше вона «думає», що вже тепло.'],
      ['Провітрюйте коротко й навстіж', '5–10 хвилин із широко відчиненим вікном кілька разів на день, на цей час прикрутіть термоголовку. Вікно на мікропровітрюванні цілий день остуджує стіни й з’їдає тепло.'],
      ['Вночі — прикрутити, а не вимкнути', 'Повністю вимикати на ніч невигідно: стіни й підлога вистигають, уранці на прогрів іде більше. Досить −2–3 °C.'],
      ['Штори й вікна', 'На ніч закривайте щільні штори, вдень на сонячному боці — відчиняйте. Ущільнювачі, «зимовий» режим фурнітури, герметик на щілинах; на зовнішній стіні — фольгований екран за батареєю (утеплені ніші — до 4 %).'],
      ['Повітря в батареї', 'Якщо верх батареї холодний, а низ гарячий — спустіть повітря краном Маєвського. Батарея прогріється цілком, і комфорт буде при меншому налаштуванні.'],
      ['Порівнюйте місяці в Історії', 'Дивіться «у середньому за 30 днів». Різке зростання за схожої погоди — шукайте причину: відчинене вікно, зламана термоголовка, розбалансування стояка (питання до ОСББ/ЖЕК).'],
      ['Холодно — перерахунку не буде', 'З квартирним лічильником ви платите за фактично отримане тепло, перерахунок «за холод» роблять лише без лічильників. Якщо холодно при відкритих батареях — це питання до ОСББ/ХТМ (балансування, тиск), а не до рахунку.']
    ];
  }
  /** Ваші цифри: середнє за 30 днів з останнього проміжку і скільки дасть −1 °C (≈5 %). */
  function myMonth() {
    var last = RD().slice().sort(function (a, b) { return a.htm.date < b.htm.date ? -1 : 1; }).reverse();
    for (var i = 0; i < last.length; i++) { var iv = interval(last[i]); if (iv && iv.dE > 0 && iv.days >= 7) return { g: iv.dE / iv.days * 30, from: iv.from, to: last[i].htm.date }; }
    return null;
  }
  /** Справка/советы: группы-плашки с аккордеоном внутри (родной <details> — работает без скриптов и с экранными чтецами). */
  function accGroups(groups, key) {
    return '<div class="acc-groups" data-key="' + key + '">' + groups.map(function (g, gi) {
      return '<section class="acc-group"' + (g.id ? ' id="' + g.id + '"' : '') + '><h2>' + (g.icon ? ico(g.icon, 20) + ' ' : '') + esc(g.title) + '</h2>' +
        g.items.map(function (it, ii) { return '<details class="acc"' + (it.open ? ' open' : '') + '><summary><span>' + esc(it.title) + '</span>' + ico('chev', 18) + '</summary><div class="acc-body">' + it.html + '</div></details>'; }).join('') + '</section>';
    }).join('') + '</div>';
  }
  V.save = function () {
    var mm = myMonth(), list = tips();
    var mine = mm ? '<div class="panel" data-key="save-mine"><h2>' + esc(t('sv_mine')) + '</h2><div class="cards2"><div><div class="num big">' + esc(mm.g.toFixed(3)) + '</div><div class="small muted">' + esc(t('sv_month_g')) + '</div></div>' +
      '<div><div class="num big">≈ ' + esc(money(costOf(mm.g, MONTH_DAYS).total)) + '</div><div class="small muted">' + esc(t('sv_month_uah')) + '</div></div></div>' +
      '<p>' + esc(t('sv_one_deg', { g: (mm.g * 0.05).toFixed(3), uah: money(mm.g * 0.05 * tariff()) })) + '</p><p class="small muted">' + esc(t('sv_mine_from', { a: R.toHtmDate(mm.from), b: R.toHtmDate(mm.to) })) + '</p></div>'
      : '<div class="panel"><p class="muted">' + esc(t('sv_no_data')) + '</p></div>';
    return { screen: 'S14', route: 'save', html: '<h1>' + esc(t('sv_title')) + '</h1><p class="muted">' + esc(t('sv_lead')) + '</p>' + mine +
      accGroups([[t('sv_g1'), 'thermo', [0, 5, 4]], [t('sv_g2'), 'flame', [1, 2, 3, 7]], [t('sv_g3'), 'home', [6]], [t('sv_g4'), 'chart', [8, 9]]].map(function (g) {
        return { title: g[0], icon: g[1], items: g[2].map(function (k) { return { title: list[k][0], html: '<p>' + esc(list[k][1]) + '</p>' }; }) };
      }), 'save-tips') +
      '<p class="small muted">' + esc(t('sv_src')) + '</p>' };
  };

  /** Политика конфиденциальности и условия использования — с каждого языка, разделы-плашки. */
  function legalPage(kind) {
    var ru = S.lang === 'ru', sec = function (h, body) { return '<section class="panel legal"><h2>' + esc(h) + '</h2>' + body + '</section>'; };
    var P = function (x) { return '<p>' + x + '</p>'; }, UL = function (a) { return '<ul>' + a.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>'; };
    var upd = '<p class="small muted">' + esc(ru ? 'Редакция от 02.11.2026 · тестовая версия сервиса' : 'Редакція від 02.11.2026 · тестова версія сервісу') + '</p>';
    var fb = '<button class="linkbtn" data-act="fb-open">' + esc(ru ? '«Отзыв»' : '«Відгук»') + '</button>';
    if (kind === 'privacy') return '<h1>' + esc(t('lg_privacy')) + '</h1>' + upd + (ru ? [
      sec('Кратко', P('«Теплосервис» помогает снять показания квартирного теплосчётчика и подготовить их для КП «Харьковские тепловые сети» (ХТМ). Мы собираем минимум данных, не продаём их и не передаём для рекламы. Сервис не связан с ХТМ и не передаёт им ничего сам — показания вносите вы.')),
      sec('Какие данные', UL(['Без входа — показания, счётчик, адреса квартир и настройки хранятся только в вашем браузере.', 'После входа — e-mail (пароль хранится только в виде хеша) или ваш Telegram ID и имя, а также те же данные для синхронизации между устройствами.', 'Фото счётчика при распознавании: распознаются прямо в браузере; вошедшим копия фото и результат хранятся на сервере до 90 дней, чтобы улучшать распознавание (тестовая версия).', 'Документы счётчика (паспорт, поверка), если вы их загрузили, — до удаления вами.', 'Отзывы и контакт, который вы указали в отзыве.', 'Технические журналы сервера (IP-адрес, время запроса) — для безопасности, недолго.'])),
      sec('Зачем', UL(['чтобы сервис работал: проверка показаний, история, синхронизация, вход;', 'чтобы улучшать распознавание фото и исправлять ошибки;', 'чтобы ответить на ваш отзыв.'])),
      sec('Кто ещё получает данные', UL(['Хостинг: сервер Hetzner (Германия, ЕС) за Cloudflare (защита и доставка).', 'Telegram — если вы входите через Telegram.', 'Open-Meteo — получает только координаты Харькова для погоды, без ваших данных.', 'Anthropic (Claude) — только если владелец включит серверное распознавание: тогда фото вошедших отправляются на распознавание.'])),
      sec('Файлы cookie', P('Только необходимые: cookie сессии входа и защитный cookie от подделки запросов. Без рекламных и аналитических трекеров.')),
      sec('Ваши права', P('По Закону Украины «О защите персональных данных» вы можете узнать, какие данные о вас хранятся, исправить или удалить их. «Настройки» → «Удалить все данные» стирает данные с устройства и из аккаунта; фото и документы удаляются вместе с аккаунтом. Вопросы — через кнопку ' + fb + '.'))
    ] : [
      sec('Коротко', P('«Теплосервіс» допомагає зняти показання квартирного теплолічильника й підготувати їх для КП «Харківські теплові мережі» (ХТМ). Ми збираємо мінімум даних, не продаємо їх і не передаємо для реклами. Сервіс не пов’язаний з ХТМ і нічого їм сам не передає — показання вносите ви.')),
      sec('Які дані', UL(['Без входу — показання, лічильник, адреси квартир і налаштування зберігаються лише у вашому браузері.', 'Після входу — e-mail (пароль зберігається лише як геш) або ваш Telegram ID та ім’я, а також ті самі дані для синхронізації між пристроями.', 'Фото лічильника під час розпізнавання: розпізнаються просто в браузері; тим, хто увійшов, копія фото й результат зберігаються на сервері до 90 днів, щоб покращувати розпізнавання (тестова версія).', 'Документи лічильника (паспорт, повірка), якщо ви їх завантажили, — доки ви їх не видалите.', 'Відгуки й контакт, який ви вказали у відгуку.', 'Технічні журнали сервера (IP-адреса, час запиту) — для безпеки, недовго.'])),
      sec('Навіщо', UL(['щоб сервіс працював: перевірка показань, історія, синхронізація, вхід;', 'щоб покращувати розпізнавання фото й виправляти помилки;', 'щоб відповісти на ваш відгук.'])),
      sec('Хто ще отримує дані', UL(['Хостинг: сервер Hetzner (Німеччина, ЄС) за Cloudflare (захист і доставка).', 'Telegram — якщо ви входите через Telegram.', 'Open-Meteo — отримує лише координати Харкова для погоди, без ваших даних.', 'Anthropic (Claude) — лише якщо власник увімкне серверне розпізнавання: тоді фото тих, хто увійшов, надсилаються на розпізнавання.'])),
      sec('Файли cookie', P('Лише необхідні: cookie сесії входу й захисний cookie від підробки запитів. Без рекламних і аналітичних трекерів.')),
      sec('Ваші права', P('За Законом України «Про захист персональних даних» ви можете дізнатися, які дані про вас зберігаються, виправити чи видалити їх. «Налаштування» → «Видалити всі дані» стирає дані з пристрою та з акаунта; фото й документи видаляються разом з акаунтом. Питання — через кнопку ' + fb + '.'))
    ]).join('');
    return '<h1>' + esc(t('lg_terms')) + '</h1>' + upd + (ru ? [
      sec('Что это', P('«Теплосервис» — бесплатный помощник для жителей Харькова: подсказывает, что нажимать на счётчике, проверяет цифры по тем же правилам, что и ХТМ, и готовит их к вставке в кабинет ХТМ. Сейчас это тестовая версия.')),
      sec('Не официальный сервис ХТМ', P('Сервис не принадлежит КП «Харьковские тепловые сети» и не действует от их имени. Передаёте показания вы сами — в кабинете ХТМ, их боте или по телефону. Решение о приёме показаний и начислениях принимает только ХТМ.')),
      sec('Ваша ответственность', UL(['Сверяйте числа со счётчиком перед отправкой — распознавание фото и подсказки могут ошибаться.', 'Передавайте показания в сроки ХТМ (с 5 по 25 число).', 'Не загружайте чужие документы и фото, на которые у вас нет прав.'])),
      sec('Без гарантий', P('Сервис предоставляется «как есть». Расчёт стоимости — ориентировочный, итог — в платёжке ХТМ. Мы не отвечаем за отказ ХТМ в приёме показаний, перерасчёты и последствия ошибок ввода, но стараемся быстро исправлять найденные проблемы.')),
      sec('Изменения и связь', P('Условия и сервис могут меняться — актуальная редакция всегда здесь. Пользуясь сервисом, вы соглашаетесь с этими условиями и ' + '<a href="#privacy">' + esc(t('lg_privacy').toLowerCase()) + '</a>. Связь — кнопка ' + fb + '.'))
    ] : [
      sec('Що це', P('«Теплосервіс» — безкоштовний помічник для мешканців Харкова: підказує, що натискати на лічильнику, перевіряє цифри за тими самими правилами, що й ХТМ, і готує їх для вставлення в кабінет ХТМ. Зараз це тестова версія.')),
      sec('Не офіційний сервіс ХТМ', P('Сервіс не належить КП «Харківські теплові мережі» й не діє від їхнього імені. Передаєте показання ви самі — у кабінеті ХТМ, їхньому боті чи телефоном. Рішення про прийняття показань і нарахування ухвалює лише ХТМ.')),
      sec('Ваша відповідальність', UL(['Звіряйте числа з лічильником перед відправленням — розпізнавання фото й підказки можуть помилятися.', 'Передавайте показання в строки ХТМ (з 5 по 25 число).', 'Не завантажуйте чужі документи й фото, на які не маєте прав.'])),
      sec('Без гарантій', P('Сервіс надається «як є». Розрахунок вартості — орієнтовний, підсумок — у платіжці ХТМ. Ми не відповідаємо за відмову ХТМ у прийнятті показань, перерахунки й наслідки помилок введення, але намагаємося швидко виправляти знайдені проблеми.')),
      sec('Зміни й зв’язок', P('Умови й сервіс можуть змінюватися — чинна редакція завжди тут. Користуючись сервісом, ви погоджуєтеся з цими умовами та ' + '<a href="#privacy">' + esc(t('lg_privacy').toLowerCase()) + '</a>. Зв’язок — кнопка ' + fb + '.'))
    ]).join('');
  }
  V.privacy = function () { return { screen: 'S20', route: 'privacy', closeTo: 'prefs', html: legalPage('privacy') }; };
  V.terms = function () { return { screen: 'S21', route: 'terms', closeTo: 'prefs', html: legalPage('terms') }; };
  V.help = function () { return { screen: 'S10', route: 'help', html: helpHtml() }; };

  // ---- поверка и документы счётчика (документы — только вошедшим: хранятся на сервере)
  var DOCS = { list: null, loading: false, busy: '' };
  function loadDocs(force) {
    if (!window.TEPLO_API || !Y().account || DOCS.loading || (DOCS.list && !force)) return;
    DOCS.loading = true;
    fetch(window.TEPLO_API + '/docs', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); })
      .then(function (j) { DOCS.loading = false; DOCS.list = (j && j.docs) || []; if (routeName() === 'prefs') safeRender(); }, function () { DOCS.loading = false; });
  }
  function meterPanel() {
    if (!S.meter) return '';
    var v = S.meter.verifiedUntil || '', days = v ? R.daysBetween(today(), v) : null;
    var st = v ? (days < 0 ? '<span class="pill bad">' + esc(t('mv_expired')) + '</span>' : days <= 60 ? '<span class="pill warn">' + esc(t('mv_soon', { n: days })) + '</span>' : '<span class="pill ok">' + esc(t('mv_ok')) + '</span>') : '';
    var h = '<div class="panel" id="meter-block" tabindex="-1" data-key="prefs-meter-ver"><h2>' + esc(t('mv_block')) + (place() && place().name ? ' <span class="muted small">· ' + esc(place().name) + '</span>' : '') + '</h2>' +
      '<ul class="list" style="background:var(--c-housing);margin-bottom:16px"><li><div class="grow"><div class="small muted">' + esc(t('p_meter')) + '</div><b>' + esc(modelName(model())) + '</b></div><a href="#meter">' + esc(t('change')) + '</a></li>' +
      '<li><div class="grow"><div class="small muted">' + esc(t('p_base')) + '</div><b>' + (S.baseline ? esc(fmtDate(S.baseline.date, true)) + ', <span class="num">' + esc(R.formatForHtm('energy', S.baseline.energy)) + '</span> Гкал' : '—') + '</b></div><a href="#baseline">' + esc(t('change')) + '</a></li></ul>' +
      '<div class="field" style="max-width:280px"><label for="p-ver">' + esc(t('mv_date')) + '</label><div class="ctl"><input id="p-ver" type="date" value="' + esc(v) + '"></div><div class="help">' + st + ' ' + esc(t('mv_date_sub')) + '</div></div>';
    if (!window.TEPLO_API) return h + '</div>';
    if (!Y().account) return h + '<p class="small muted">' + esc(t('mv_docs_login')) + '</p></div>';
    loadDocs();
    var mine = (DOCS.list || []).filter(function (d) { return d.place === S.placeId || (!place(d.place) && S.placeId === (places()[0] || {}).id); });
    h += '<h3>' + esc(t('mv_docs')) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></h3><p class="small muted">' + esc(t('mv_docs_sub')) + '</p>';
    h += mine.length ? '<ul class="docs">' + mine.map(function (d) {
      var url = window.TEPLO_API + '/docs/file?id=' + d.id, img = d.mime !== 'application/pdf';
      return '<li><a href="' + esc(url) + '" target="_blank" rel="noopener" class="doc-th" aria-label="' + esc(t('mv_open') + ': ' + t('mv_kind_' + d.kind)) + '">' + (img ? '<img src="' + esc(url) + '" alt="" loading="lazy">' : '<span class="pdf">PDF</span>') + '</a>' +
        '<div class="grow"><b>' + esc(t('mv_kind_' + d.kind)) + '</b><div class="small muted">' + esc(R.toHtmDate(String(d.createdAt).slice(0, 10))) + ' · ' + Math.max(1, Math.round(d.bytes / 1024)) + ' КБ</div></div>' +
        '<button class="linkbtn" data-act="doc-del" data-id="' + esc(d.id) + '">' + esc(t('rec_del')) + '</button></li>';
    }).join('') + '</ul>' : (DOCS.list ? '<p class="small muted">' + esc(t('mv_docs_none')) + '</p>' : '');
    h += '<input type="file" id="doc-input" class="sr" aria-label="' + esc(t('mv_docs')) + '" tabindex="-1" accept="image/jpeg,image/png,image/webp,application/pdf">' +
      '<div class="row-actions" style="margin-top:8px"><button class="btn sec" data-act="doc-add" data-kind="passport"' + (DOCS.busy ? ' disabled' : '') + '>' + ico('camera', 18) + '<span>' + esc(t('mv_add_passport')) + '</span></button>' +
      '<button class="btn sec" data-act="doc-add" data-kind="verification"' + (DOCS.busy ? ' disabled' : '') + '>' + ico('camera', 18) + '<span>' + esc(t('mv_add_ver')) + '</span></button></div>' +
      (DOCS.busy ? '<p class="small muted" role="status">' + SPIN + ' ' + esc(t('mv_uploading')) + '</p>' : DOCS.loading && !DOCS.list ? '<p class="small muted" role="status">' + SPIN + '</p>' : '');
    return h + '</div>';
  }
  function placesPanel() {
    var ps = places(), first = S.places[0] && S.places[0].id;
    return '<div class="panel" data-key="prefs-places"><h2>' + esc(t('pl_title')) + '</h2><p class="small muted">' + esc(t('pl_sub')) + '</p><ul class="list" style="background:var(--c-housing)">' +
      ps.map(function (p) {
        var n = (S.readings || []).filter(function (r) { return r && !r.deleted && (r.place || first) === p.id; }).length, m = p.meter ? M.byId(p.meter.modelId) : null;
        return '<li><div class="grow"><input class="pl-in" data-plname="' + esc(p.id) + '" value="' + esc(p.name || '') + '" placeholder="' + esc(placeLabel(p)) + '" aria-label="' + esc(t('pl_addr')) + '">' +
          '<div class="small muted">' + esc((m ? modelName(m) : t('pl_no_meter')) + ' · ' + t('pl_n', { n: n })) + (p.meter && p.meter.verifiedUntil ? ' · ' + esc(t('pl_ver', { d: R.toHtmDate(p.meter.verifiedUntil) })) : '') + '</div></div>' +
          (p.id === S.placeId ? '<span class="pill ok">' + esc(t('pl_active')) + '</span>' : '<button class="btn sec" data-act="pl-use" data-id="' + esc(p.id) + '">' + esc(t('pl_use')) + '</button>') +
          (ps.length > 1 && !n ? '<button class="linkbtn" data-act="pl-del" data-id="' + esc(p.id) + '" style="margin-left:8px">' + esc(t('rec_del')) + '</button>' : '') + '</li>';
      }).join('') + '</ul><p style="margin:16px 0 0"><button class="btn sec" data-act="pl-add" data-key="prefs-place-add">' + ico('plus', 18) + '<span>' + esc(t('pl_add')) + '</span></button></p></div>';
  }
  V.prefs = function () {
    var m = model(), c = S.contacts || {};
    return { screen: 'S11', route: 'prefs', html: '<h1>' + esc(t('p_title')) + '</h1>' + syncPanel() +
      placesPanel() + meterPanel() + waterPanel() +
      '<div class="panel"><h2>' + esc(t('p_contacts')) + '</h2><p class="small muted">' + esc(t('p_contacts_sub')) + '</p><div class="grid2">' +
      '<div class="field"><label for="p-phone">' + esc(t('ho_phone')) + '</label><div class="ctl"><input id="p-phone" type="tel" autocomplete="tel" data-contact="phone" value="' + esc(c.phone || '') + '"></div></div>' +
      '<div class="field"><label for="p-email">' + esc(t('ho_email')) + '</label><div class="ctl"><input id="p-email" type="email" autocomplete="email" data-contact="email" value="' + esc(c.email || '') + '"></div></div></div></div>' +
      '<div class="panel" data-key="prefs-theme"><h2>' + esc(t('th_title')) + '</h2><div class="seg-ctl" role="group" aria-label="' + esc(t('th_title')) + '">' +
        ['auto', 'light', 'dark'].map(function (k) { return '<button type="button" data-act="theme" data-v="' + k + '" aria-pressed="' + ((S.theme || 'auto') === k) + '">' + esc(t('th_' + k)) + '</button>'; }).join('') + '</div>' +
        '<p class="small muted" style="margin-top:8px">' + esc(t('th_sub')) + '</p></div>' +
      '<div class="panel" data-key="prefs-bill"><h2>' + esc(t('p_tariff')) + '</h2><p class="small muted">' + esc(t('p_tariff_sub')) + '</p>' +
        '<div class="grid2"><div class="field"><label for="p-tariff">' + esc(t('p_tariff_l')) + '</label><div class="ctl"><input id="p-tariff" class="num" inputmode="decimal" data-key="prefs-tariff" value="' + esc(tariff().toFixed(2).replace('.', ',')) + '"></div></div>' +
        '<div class="field"><label for="p-abon">' + esc(t('p_abon_l')) + '</label><div class="ctl"><input id="p-abon" class="num" inputmode="decimal" value="' + esc(bill().abon.toFixed(2).replace('.', ',')) + '"></div></div>' +
        '<div class="field"><label for="p-mzk">' + esc(t('p_mzk_l')) + '</label><div class="ctl"><input id="p-mzk" class="num" inputmode="decimal" placeholder="0,01262" value="' + esc(bill().mzk ? String(bill().mzk).replace('.', ',') : '') + '"></div><div class="small muted">' + esc(t('p_mzk_h')) + '</div></div></div>' +
        '<details class="tips-box" style="margin-top:12px"><summary>' + esc(t('p_bill_how_t')) + '</summary><p class="small">' + esc(t('p_bill_how')) + '</p></details></div>' +
      '<div class="panel" data-key="prefs-data"><h2>' + esc(t('p_data')) + '</h2>' +
        (Y().account ? '<p class="small muted">' + esc(t('p_data_synced')) + '</p>' :
          '<p class="small muted">' + esc(t('p_data_sub')) + '</p><div class="row-actions" style="margin-top:0"><button class="btn sec" data-act="export" data-key="prefs-export">' + ico('copy', 20) + '<span>' + esc(t('p_export')) + '</span></button></div>' +
          '<details class="tips-box" style="margin-top:12px"><summary>' + esc(t('p_import')) + '</summary><form id="import-form" novalidate style="margin-top:8px"><div class="field"><label for="p-import">' + esc(t('p_import_l')) + '</label><div class="ctl"><textarea id="p-import" placeholder="' + esc(t('p_import_ph')) + '"></textarea></div></div><button class="btn sec" type="submit">' + esc(t('p_import_go')) + '</button></form></details>') +
        '<div style="margin-top:20px"><button class="btn danger" data-act="wipe-ask" data-key="prefs-wipe">' + esc(t('p_wipe')) + '</button><div id="wipe-confirm"></div></div></div>' +
      '<details class="tips-box" data-key="prefs-demo-box"' + (S.demoToday ? ' open' : '') + '><summary>' + esc(t('p_demo')) + '</summary><p class="small muted">' + esc(t('p_demo_sub')) + '</p><div class="field" style="max-width:260px"><label for="p-demo">' + esc(t('p_demo_l')) + '</label><div class="ctl"><input type="date" id="p-demo" data-key="prefs-demo" value="' + esc(S.demoToday || '') + '"></div></div></details>' +
      '<footer class="legal-foot" data-key="prefs-legal"><a href="#privacy">' + esc(t('lg_privacy')) + '</a><a href="#terms">' + esc(t('lg_terms')) + '</a></footer>' };
  };


  // ---------------- синхронизация и вход ----------------
  function syncStatusText() { var y = Y(); return y.status === 'syncing' ? t('sync_syncing') : y.status === 'error' ? t('sync_error') : y.status === 'offline' ? t('sync_offline') : t('sync_ok'); }
  function syncPanel() {
    var y = Y(), a = y.account, h = '<div class="panel" data-key="prefs-sync"><h2>' + esc(t('sync_title')) + '</h2>';
    if (y.mode === 'claude') h += '<p>' + esc(t('sync_claude')) + '</p><p class="small muted" id="sync-status">' + esc(syncStatusText()) + '</p>';
    else if (y.mode === 'server' && a) {
      h += '<p>' + esc(t('sync_server')) + '</p><ul class="list" style="margin:0 0 12px;background:var(--c-housing)">' +
        (a.email ? '<li><div class="grow"><div class="small muted">Email</div><b>' + esc(a.email) + '</b></div></li>' : '') +
        (a.telegram ? '<li><div class="grow"><div class="small muted">Telegram</div><b>' + esc(a.telegram.username ? '@' + a.telegram.username : t('acct_tg_linked_noname')) + '</b></div></li>' : '') + '</ul>' +
        '<p class="small muted" id="sync-status">' + esc(syncStatusText()) + '</p>';
      if (!a.telegram && Y()._cfg && Y()._cfg.botUsername) h += '<h3>' + esc(t('acct_link_tg')) + '</h3><p class="small muted">' + esc(t('acct_link_bot_sub')) + '</p>' +
        '<p><button class="btn" data-act="link-bot" data-key="prefs-link-bot">' + esc(t('acct_link_bot', { bot: Y()._cfg.botUsername })) + '</button></p><div id="tg-widget" data-onauth="TeploTgLink"></div>';
      if (!a.hasPassword) h += '<h3 style="margin-top:16px">' + esc(t('acct_set_pass')) + '</h3><form id="setpass-form" novalidate>' + authFields('new-password') + '<div class="help block" id="setpass-err"></div><button class="btn sec" type="submit">' + esc(t('acct_set_pass_btn')) + '</button></form>';
      h += '<div class="row-actions"><button class="btn sec" data-act="logout" data-key="prefs-logout">' + esc(t('logout')) + '</button></div><p class="small muted" style="margin-top:8px">' + esc(t('logout_sub')) + '</p>';
    } else if (y.mode === 'server') h += '<p>' + esc(t('sync_local')) + '</p><p>' + esc(t('sync_local_sub_site')) + '</p><a class="btn" href="#login" data-key="prefs-login">' + esc(t('login')) + '</a>';
    else h += '<p>' + esc(t('sync_local')) + '</p><p class="small muted">' + esc(t('sync_local_sub_noserver')) + '</p>';
    return h + '</div>';
  }
  function authFields(passAuto) {
    return '<div class="field"><label for="a-email">' + esc(t('login_email')) + '</label><div class="ctl"><input id="a-email" type="email" autocomplete="email" required></div></div>' +
      '<div class="field"><label for="a-pass">' + esc(t('login_pass')) + '</label><div class="ctl"><input id="a-pass" type="password" autocomplete="' + passAuto + '" minlength="8" required></div><div class="help">' + esc(t('login_pass_hint')) + '</div></div>';
  }
  var authMode = 'login';
  V.login = function () {
    var y = Y();
    if (y.account) return { screen: 'S13', route: 'login', bare: !S.onboarded, closeTo: S.onboarded ? 'home' : 'welcome', html: '<h1>' + esc(t('login_title')) + '</h1><p>' + esc(t('sync_server')) + '</p><a class="btn" href="#' + (S.meter ? 'home' : 'meter') + '">' + esc(t('next')) + '</a>' };
    if (y.mode !== 'server') return { screen: 'S13', route: 'login', bare: !S.onboarded, closeTo: S.onboarded ? 'home' : 'welcome', html: '<h1>' + esc(t('login_title')) + '</h1>' + syncPanel() };
    var reg = authMode === 'register';
    return { screen: 'S13', route: 'login', bare: !S.onboarded, closeTo: S.onboarded ? 'home' : 'welcome', html:
      '<h1>' + esc(t('login_title')) + '</h1><p>' + esc(t('login_lead')) + '</p>' +
      '<div class="cols"><div>' +
      (y._cfg && y._cfg.botUsername ? '<div class="panel" data-key="login-telegram"><h2>' + esc(t('login_tg')) + '</h2><p class="small muted">' + esc(t('login_tg_sub')) + '</p><div id="tg-widget" data-onauth="TeploTgAuth"></div>' +
        '<p style="margin-top:12px"><a class="btn sec" href="https://t.me/' + esc(y._cfg.botUsername) + '" target="_blank" rel="noopener">' + esc(t('login_tg_open', { bot: y._cfg.botUsername })) + '</a></p><p class="small muted">' + esc(t('login_tg_open_sub')) + '</p><p class="small muted">' + esc(t('login_tg_same')) + '</p></div>' : '') +
      '</div><div><form id="login-form" class="panel" data-mode="' + authMode + '" novalidate data-key="login-form"><h2>' + esc(reg ? t('register_btn') : t('login_email_title')) + '</h2>' + authFields(reg ? 'new-password' : 'current-password') +
      '<div class="help block" id="login-err" role="alert"></div><button class="btn block" type="submit" data-key="login-submit">' + esc(reg ? t('register_btn') : t('login_btn')) + '</button>' +
      '<p style="margin-top:12px"><button type="button" class="linkbtn" data-act="auth-mode" data-key="login-toggle">' + esc(reg ? t('login_have') : t('login_need')) + '</button></p></form></div></div>' +
      '<p><a href="#' + (S.onboarded ? 'home' : 'welcome') + '" data-key="login-skip">' + esc(t('login_skip')) + '</a></p>' };
  };
  function authError(j) {
    if (!j || !j._status) return t('err_network');
    var k = 'err_' + (j.error || ''); var txt = I.T[S.lang][k] || I.T.uk[k];
    if (j.error === 'rate_limited') return t('err_rate_limited', { m: Math.max(1, Math.ceil((j.retryAfter || 60) / 60)) });
    return txt || t('err_network');
  }
  function afterLogin(j, errEl) {
    if (j && j._status === 200) { toast(t('login_ok')); S.onboarded = S.onboarded || !!S.meter; save(); go(S.meter ? 'home' : 'meter'); return; }
    if (errEl) errEl.textContent = authError(j); else toast(authError(j));
  }
  function mountTelegramWidget() {
    var box = document.getElementById('tg-widget'), cfg = Y()._cfg;
    if (!box || !cfg || !cfg.botUsername || box.childNodes.length) return;
    var sc = document.createElement('script'); sc.async = true; sc.src = 'https://telegram.org/js/telegram-widget.js?22';
    sc.setAttribute('data-telegram-login', cfg.botUsername); sc.setAttribute('data-size', 'large'); sc.setAttribute('data-radius', '12');
    sc.setAttribute('data-onauth', box.getAttribute('data-onauth') + '(user)'); sc.setAttribute('data-request-access', 'write');
    box.appendChild(sc);
  }
  window.TeploTgAuth = function (user) { Y().loginTelegramWidget(user).then(function (j) { afterLogin(j); }, function () { toast(t('err_network')); }); };
  window.TeploTgLink = function (user) { Y().linkTelegram(user).then(function (j) { if (j._status === 200) { toast(t('login_ok')); render(true); } else toast(authError(j)); }); };

  // ---------------- распознавание по фото ----------------
  /* Фото, присланные боту в Telegram: лежат в аккаунте и ждут; распознаёт браузер, как обычные фото. */
  var INBOX = { items: null, loading: false, auto: /[?&]inbox=1/.test(location.search) };
  function api0(path, opts) {
    opts = opts || {}; var c = (document.cookie.match(/(?:^|; )ts_csrf=([^;]*)/) || [])[1] || '';
    return fetch(window.TEPLO_API + path, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF': c, Accept: 'application/json' } }, opts));
  }
  function loadInbox() {
    if (!window.TEPLO_API || !Y().account || INBOX.loading) return;
    INBOX.loading = true;
    api0('/inbox').then(function (r) { return r.json(); }).then(function (j) {
      INBOX.loading = false; INBOX.items = (j && j.items) || [];
      if (INBOX.auto) { try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* нет */ } }
      if (INBOX.auto && INBOX.items.length && PH.status !== 'working') { INBOX.auto = false; inboxRun(); return; }
      INBOX.auto = false;
      if (['home', ''].indexOf(routeName()) >= 0) safeRender();
    }, function () { INBOX.loading = false; });
  }
  function inboxRun() {
    var items = (INBOX.items || []).slice(); if (!items.length) return;
    phReset('reading'); PH.inbox = items.map(function (x) { return x.id; }); PH.status = 'working'; PH.progress = t('ib_loading'); PH.pct = 2;
    go('photo');
    Promise.all(items.map(function (x) {
      return fetch(window.TEPLO_API + '/inbox/file?id=' + encodeURIComponent(x.id), { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('file'); return r.blob(); }).then(function (b) {
        var f; try { f = new File([b], x.id + '.jpg', { type: b.type || 'image/jpeg', lastModified: x.takenAt * 1000 }); } catch (e) { f = b; f.lastModified = x.takenAt * 1000; }
        f._srv = x.id; return f;
      });
    })).then(function (files) {
      PH.files = files; PH.urls = files.map(function (f) { return URL.createObjectURL(f); }); PH.status = 'idle'; PHS.save(true); phRun();
    }, function () { PH.status = 'idle'; PH.error = t('err_network'); render(true); });
  }
  function inboxDone() {
    var ids = PH.inbox; if (!ids || !ids.length || !window.TEPLO_API) return;
    PH.inbox = null; INBOX.items = (INBOX.items || []).filter(function (x) { return ids.indexOf(x.id) < 0; });
    api0('/inbox/done', { method: 'POST', body: JSON.stringify({ ids: ids }) }).catch(function () {});
  }
  /** Кнопка «в работе»: крутится значок, повторно не нажать; возвращает «готово». */
  function busy(btn) { if (!btn) return function () {}; btn.setAttribute('aria-busy', 'true'); btn.disabled = true; return function () { btn.removeAttribute('aria-busy'); btn.disabled = false; }; }
  var SPIN = '<span class="spin" aria-hidden="true"></span>';
  var PH = { mode: 'reading', files: [], urls: [], status: 'idle', result: null, picked: null, error: '', ctl: null, progress: '' };
  function phReset(mode, keep) { if (!keep) PHS.clear(); PH.urls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { /* нет */ } }); PH = { mode: mode || 'reading', files: [], urls: [], status: 'idle', result: null, picked: null, error: '', ctl: null, progress: '', date: mode === 'baseline' ? ((S._baseFill && S._baseFill.date) || (S.baseline && S.baseline.date) || today()) : (S.draft && S.draft.date || today()) }; }
  /* Распознанное с фото переживает обновление страницы: состояние — в localStorage, сами фото — в IndexedDB.
     Стирается, только когда человек сам решил: «Внести в поля», начал заново или удалил фото. */
  var PHS = {
    key: 'teplo.ph',
    db: function () {
      return new Promise(function (ok, bad) {
        if (!window.indexedDB) return bad(new Error('no_idb'));
        var rq = indexedDB.open('teplo-ph', 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('files'); };
        rq.onsuccess = function () { ok(rq.result); }; rq.onerror = function () { bad(rq.error); };
      });
    },
    putFiles: function (files) {
      return PHS.db().then(function (db) { return new Promise(function (ok) {
        var tx = db.transaction('files', 'readwrite'), st = tx.objectStore('files'); st.clear();
        files.forEach(function (f, i) { st.put({ blob: f, name: f.name || ('photo' + i + '.jpg'), type: f.type, lastModified: f.lastModified || 0 }, i); });
        tx.oncomplete = tx.onerror = tx.onabort = function () { db.close(); ok(); };
      }); }).catch(function () {});
    },
    getFiles: function () {
      return PHS.db().then(function (db) { return new Promise(function (ok) {
        var out = [], rq = db.transaction('files').objectStore('files').openCursor();
        rq.onsuccess = function () { var c = rq.result; if (c) { var v = c.value; try { out[c.key] = new File([v.blob], v.name, { type: v.type, lastModified: v.lastModified }); } catch (e) { out[c.key] = v.blob; } c.continue(); } else { db.close(); ok(out.filter(Boolean)); } };
        rq.onerror = function () { db.close(); ok([]); };
      }); }).catch(function () { return []; });
    },
    save: function (withFiles) {
      if (PH.mode === 'model' || !PH.files.length) return;
      var st = { mode: PH.mode, date: PH.date, status: PH.status === 'done' ? 'done' : 'idle', result: PH.status === 'done' ? PH.result : null, picked: PH.status === 'done' ? PH.picked : null, vals: PH.vals || null, inbox: PH.inbox || null, n: PH.files.length, at: Date.now() };
      try { localStorage.setItem(PHS.key, JSON.stringify(st)); } catch (e) { /* переполнено — без сохранения */ }
      if (withFiles) PHS.putFiles(PH.files);
    },
    clear: function () { try { localStorage.removeItem(PHS.key); } catch (e) { /* нет */ } PHS.db().then(function (db) { var tx = db.transaction('files', 'readwrite'); tx.objectStore('files').clear(); tx.oncomplete = function () { db.close(); }; }).catch(function () {}); },
    restore: function () {
      var st; try { st = JSON.parse(localStorage.getItem(PHS.key) || 'null'); } catch (e) { st = null; }
      if (!st || Date.now() - (st.at || 0) > 7 * 864e5) return Promise.resolve(false);
      return PHS.getFiles().then(function (files) {
        if (!files.length) return false;
        PH.mode = st.mode || 'reading'; PH.date = st.date || PH.date; PH.files = files; PH.urls = files.map(function (f) { return URL.createObjectURL(f); });
        PH.result = st.result; PH.picked = st.picked; PH.vals = st.vals || null; PH.inbox = st.inbox || null; if (PH.inbox) files.forEach(function (f, k) { if (PH.inbox[k]) f._srv = PH.inbox[k]; }); PH.status = st.status === 'done' && st.picked ? 'done' : 'idle';
        return true;
      });
    }
  };
  function phErr(code) { return ({ not_signed_in: t('ph_err_login'), recognition_off: window.TEPLO_API ? t('ph_err_off') : t('ph_unavail'), timeout: t('ph_err_timeout'), not_granted: t('ph_err_not_granted'), sampling_disabled: t('ph_err_not_granted'), images_unavailable: t('ph_unavail'), rate_limited: t('ph_err_rate'), engine_failed: t('ph_err_engine'), image_rejected: t('ph_err_image'), nothing: t('ph_err_nothing') })[code] || t('ph_err_generic'); }
  function thumbs(withRemove) {
    return '<ul class="thumbs" data-key="photo-thumbs">' + PH.urls.map(function (u, i) {
      return '<li><img data-pv="' + i + '" src="' + u + '" alt="' + esc(t('ph_from', { n: i + 1 })) + '"><span class="n">' + (i + 1) + '</span>' + (withRemove ? '<button class="rm" data-act="ph-remove" data-i="' + i + '" aria-label="' + esc(t('ph_remove')) + '">' + ico('close', 16) + '</button>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  V.photo = function () {
    var model_ = PH.mode === 'model', base_ = PH.mode === 'baseline', back = model_ ? 'meter' : base_ ? 'baseline' : (S.onboarded ? 'home' : 'welcome');
    var head = '<h1>' + esc(model_ ? t('ph_model_title') : base_ ? t('ph_base_title') : t('ph_title')) + '</h1>';
    var shell_ = function (html) { return { screen: 'S12', route: 'photo', bare: true, closeTo: back, html: head + html }; };
    if (!VIS().available) return shell_('<div class="banner warn">' + ico('info', 22) + '<div><p>' + esc(t('ph_unavail')) + '</p></div></div><a class="btn" href="#' + back + '">' + esc(t('back')) + '</a>');
    var input = '<input type="file" id="ph-input" accept="' + esc(((VIS().limits && VIS().limits.images && VIS().limits.images.mediaTypes) || ['image/jpeg', 'image/png', 'image/webp']).join(',')) + '" multiple class="sr" data-key="photo-input">';
    if (PH.status === 'working') return shell_('<div class="banner" role="status">' + SPIN + '<div class="grow"><p><b>' + esc(t('ph_working', { n: PH.files.length })) + '</b></p>' + '<p id="ph-progress">' + esc(PH.progress || '') + '</p><div class="pbar" aria-hidden="true"><i id="ph-pbar" style="width:' + (PH.pct || 2) + '%"></i></div>' + '</div></div>' + thumbs(false) + '<div class="row-actions"><button class="btn sec" data-act="ph-stop">' + esc(t('ph_stop')) + '</button></div>');
    if (PH.status === 'done' && !model_) return shell_(photoResult());
    var lead = '<p>' + esc(model_ ? t('ph_model_lead') : base_ ? t('ph_base_lead') : t('ph_lead')) + '</p>';
    if (!model_) lead += '<details class="tips-box"' + (PH.files.length ? '' : ' open') + '><summary>' + ico('camera', 18) + ' ' + esc(t('ph_tips_t')) + '</summary><ul>' + t('ph_tips').split('|').map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></details>';
    var err = PH.error ? '<div class="banner bad" role="alert">' + ico('alert', 22) + '<div><p>' + esc(PH.error) + '</p></div></div>' : '';
    var date = model_ ? '' : '<div class="field" style="max-width:280px"><label for="ph-date">' + esc(t('ph_date')) + '</label><div class="ctl"><input id="ph-date" type="date" value="' + esc(PH.date || today()) + '" max="' + today() + '"></div></div>';
    var pick = '<label for="ph-input" class="btn ' + (PH.files.length ? 'sec' : 'big') + '" tabindex="0" data-key="photo-pick">' + ico('camera', 22) + '<span>' + esc(PH.files.length ? t('ph_add') : t('ph_pick')) + '</span></label>';
    var go_ = PH.files.length ? '<button class="btn big" data-act="ph-run" data-key="photo-run">' + esc(t('ph_go', { n: PH.files.length })) + '</button>' : '';
    return shell_(lead + err + input + (PH.files.length ? thumbs(true) : '') + date + '<div class="row-actions">' + pick + go_ + '</div>' + '<p class="small muted" style="margin-top:16px">' + esc(t('ph_privacy')) + '</p>');
  }
  function photoResult() {
    var p = PH.picked || {}, res = PH.result || {}, mt = res.meter || {}, h = '';
    var mm = mt.modelId ? M.byId(mt.modelId) : null;
    if (mm && (!S.meter || S.meter.modelId !== mm.id)) h += '<div class="banner" data-key="photo-meter">' + ico('info', 22) + '<div><p><b>' + esc(t('ph_meter_found', { m: modelName(mm) })) + '</b></p><p><button class="linkbtn" data-act="ph-use-model" data-id="' + mm.id + '" data-unit="' + esc(mt.energyUnit || '') + '">' + esc(t('ph_meter_use')) + '</button></p></div></div>';
    var noteTxt = function (x) { return x.note ? (t('pn_' + x.note) !== 'pn_' + x.note && t('pn_' + x.note) ? t('pn_' + x.note) : x.note) : ''; };
    var INFO = { test_screen: 1, dt_screen: 1 };   // служебные экраны — не ошибка, просто пояснение
    var info = (res.photos || []).filter(function (x) { return INFO[x.note] && !(x.readings || []).length; });
    var bad = (res.photos || []).filter(function (x) { return !INFO[x.note] && ((x.quality && x.quality !== 'ok') || (x.meterType && x.meterType !== 'heat') || (res.engine === 'local' && x.note)); });
    var miss = R.FIELDS.filter(function (f) { return f.key !== 'date' && f.key !== 'errHours' && f.key !== 'tReturn' && !p[f.key]; }).map(function (f) { return fieldLabel(f.key).toLowerCase(); });
    if (miss.length) h += '<div class="banner">' + ico('info', 22) + '<div><p>' + esc(t('ph_missing_screens', { list: miss.join(', ') })) + '</p></div></div>';
    if (info.length) h += '<p class="small muted">' + info.map(function (x) { return esc(t('ph_from', { n: x.index + 1 })) + ' — ' + esc(noteTxt(x)); }).join('<br>') + '</p>';
    if (bad.length) h += '<div class="banner warn">' + ico('alert', 22) + '<div>' + bad.map(function (x) {
      if (x.meterType && x.meterType !== 'heat') return '<p>' + esc(t('ph_from', { n: x.index + 1 })) + ': ' + esc(t('ph_not_heat_short_' + x.meterType)) + '</p>';
      var q = x.quality && x.quality !== 'ok' ? t('ph_quality', { n: x.index + 1, q: t('q_' + x.quality) || x.quality }) : t('ph_from', { n: x.index + 1 });
      return '<p>' + esc(q) + (x.note ? ' — ' + esc(noteTxt(x)) : '') + '</p>'; }).join('') + '</div></div>';
    h += '<p class="small muted" style="margin:0 0 6px">' + esc(t('ph_zoom_hint')) + '</p>' + thumbs(false);
    h += '<p class="muted">' + esc(t('ph_result_sub')) + '</p><div class="field" style="max-width:280px"><label for="ph-date">' + esc(t('ph_date')) + '</label><div class="ctl"><input id="ph-date" type="date" value="' + esc(PH.date || today()) + '" max="' + today() + '"></div></div>';
    h += '<ul class="list ph-fields" data-key="photo-fields">' + R.FIELDS.filter(function (f) { return f.key !== 'date'; }).map(function (f) {
      var r = p[f.key], v = PH.vals && PH.vals[f.key] !== undefined ? PH.vals[f.key] : r ? r.value : '', conf = r ? r.confidence : 0;
      var tag = !r ? '<span class="pill bad">' + esc(t('ph_missing')) + '</span>' : r.conflict ? '<span class="pill warn">' + esc(t('ph_conflict')) + '</span>' : conf < 0.75 ? '<span class="pill warn">' + esc(t('ph_low')) + '</span>' : '<span class="pill ok">' + ico('check', 14) + '</span>';
      var th = r && PH.urls[r.photo] ? '<span class="src-w"><img class="src" data-pv="' + r.photo + '" src="' + PH.urls[r.photo] + '" alt="' + esc(t('ph_from', { n: r.photo + 1 })) + '" title="' + esc(t('ph_from', { n: r.photo + 1 })) + '"></span>' : '<span class="src none"></span>';
      return '<li>' + th + '<div class="grow"><label for="phv-' + f.key + '" class="small muted">' + esc(fieldLabel(f.key)) + (f.key === 'energy' ? ', ' + esc(unitLbl(PH.mode === 'baseline' ? 'Gcal' : energyUnit())) : f.unit ? ', ' + esc(fieldUnit(f.key)) : '') + '</label>' +
        '<input id="phv-' + f.key + '" class="num ph-in" data-ph="' + f.key + '" inputmode="' + (f.key === 'errCode' ? 'text' : 'decimal') + '" value="' + esc(v) + '"' + (f.key === 'errCode' ? ' placeholder="E---"' : '') + '>' + (r && r.converted ? '<div class="small muted">' + esc(r.converted) + '</div>' : '') + '</div>' + tag + '</li>';
    }).join('') + '</ul>';
    return h + '<div class="row-actions"><button class="btn ghost" data-act="ph-new">' + esc(t('ph_new')) + '</button><button class="btn sec" data-act="ph-again">' + esc(t('ph_add')) + '</button><button class="btn" data-act="ph-apply" data-to="check" data-key="photo-check">' + esc(PH.mode === 'baseline' ? t('ph_to_base') : t('ph_to_check')) + '</button></div>';
  }
  /** Просмотр фото на весь экран: щипок / колесо / двойное касание — увеличить, тянуть — двигать, стрелки — соседние фото. */
  function photoViewer(start) {
    var urls = PH.urls.slice(); if (!urls.length) return;
    var i = Math.max(0, Math.min(urls.length - 1, start | 0)), prevFocus = document.activeElement;
    var ov = document.createElement('div'); ov.className = 'pv'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', t('ph_view'));
    ov.innerHTML = '<span class="spin pv-spin" role="status" aria-label="' + esc(t('loading')) + '"></span><img alt=""><div class="pv-bar"><span class="pv-n"></span><button class="pv-b" data-pv-act="prev" aria-label="' + esc(t('ph_prev')) + '">‹</button><button class="pv-b" data-pv-act="next" aria-label="' + esc(t('ph_next')) + '">›</button><button class="pv-b" data-pv-act="close" aria-label="' + esc(t('close')) + '">' + ico('close', 22) + '</button></div>';
    document.body.appendChild(ov);
    var img = ov.querySelector('img'), n = ov.querySelector('.pv-n'), sc = 1, fit = 1, tx = 0, ty = 0, pts = {}, last = null, tapAt = 0;
    var apply = function () { img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + sc + ')'; };
    var clamp = function () {
      var vw = ov.clientWidth, vh = ov.clientHeight, w = img.naturalWidth * sc, h = img.naturalHeight * sc;
      tx = w <= vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, tx)); ty = h <= vh ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, ty));
    };
    var zoomAt = function (ns, cx, cy) { ns = Math.max(fit, Math.min(fit * 10, ns)); tx = cx - (cx - tx) * ns / sc; ty = cy - (cy - ty) * ns / sc; sc = ns; clamp(); apply(); };
    var spin = ov.querySelector('.pv-spin');
    var show = function (k) { i = (k + urls.length) % urls.length; n.textContent = (i + 1) + ' / ' + urls.length; spin.hidden = false; img.style.visibility = 'hidden'; img.onerror = function () { spin.hidden = true; }; img.onload = function () { spin.hidden = true; img.style.visibility = ''; fit = Math.min(ov.clientWidth / img.naturalWidth, ov.clientHeight / img.naturalHeight); sc = fit; clamp(); apply(); }; img.src = urls[i]; };
    var key = function (e) { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') show(i + 1); else if (e.key === 'ArrowLeft') show(i - 1); else if (e.key === '+' || e.key === '=') zoomAt(sc * 1.5, ov.clientWidth / 2, ov.clientHeight / 2); else if (e.key === '-') zoomAt(sc / 1.5, ov.clientWidth / 2, ov.clientHeight / 2); };
    var close = function () { document.removeEventListener('keydown', key); ov.remove(); if (prevFocus && prevFocus.focus) prevFocus.focus(); };
    document.addEventListener('keydown', key);
    ov.addEventListener('click', function (e) { var b = e.target.closest('[data-pv-act]'); if (!b) return; var a = b.getAttribute('data-pv-act'); if (a === 'close') close(); else show(i + (a === 'next' ? 1 : -1)); });
    ov.addEventListener('wheel', function (e) { e.preventDefault(); zoomAt(sc * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY); }, { passive: false });
    ov.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.pv-bar')) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY }; try { ov.setPointerCapture(e.pointerId); } catch (x) { /* нет */ }
      if (Object.keys(pts).length === 1) { var now = Date.now(); if (now - tapAt < 320) { zoomAt(sc > fit * 1.1 ? fit : fit * 3, e.clientX, e.clientY); tapAt = 0; } else tapAt = now; }
      last = null;
    });
    ov.addEventListener('pointermove', function (e) {
      var p0 = pts[e.pointerId]; if (!p0) return; var ids = Object.keys(pts);
      if (ids.length === 1) { tx += e.clientX - p0.x; ty += e.clientY - p0.y; p0.x = e.clientX; p0.y = e.clientY; clamp(); apply(); return; }
      p0.x = e.clientX; p0.y = e.clientY;
      var a = pts[ids[0]], b = pts[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (last && last.d > 0) { tx += mx - last.mx; ty += my - last.my; zoomAt(sc * d / last.d, mx, my); }
      last = { d: d, mx: mx, my: my };
    });
    var up = function (e) { delete pts[e.pointerId]; last = null; };
    ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up);
    show(i); ov.querySelector('[data-pv-act="close"]').focus();
  }
  // нижние вкладки: переход сами, не полагаясь на смену адреса браузером (в некоторых встроенных браузерах, напр. Telegram на iPhone,
  // после pushState/replaceState нажатие на ссылку с «#…» не всегда вызывает hashchange — вкладки «не нажимаются»)
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.nav a[href^="#"]'); if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
    e.preventDefault(); var r = a.getAttribute('href').slice(1);
    if (routeName() === r) { render(); return; }
    try { history.pushState(null, '', '#' + r); } catch (x) { location.hash = r; return; }
    render();
  });
  document.addEventListener('click', function (e) { var im = e.target.closest && e.target.closest('img[data-pv]'); if (im && routeName() === 'photo') { e.preventDefault(); photoViewer(+im.getAttribute('data-pv')); } });

  function phRun() {
    var y = VIS(); if (!y.available || !PH.files.length) return;
    var di = document.getElementById('ph-date'); if (di) PH.date = di.value || today();
    PH.status = 'working'; PH.error = ''; PH.progress = ''; PH.pct = 2; PH.ctl = new AbortController(); render(true);
    var m = model(), ctx = { modelId: m ? m.id : '', models: M.MODELS, steps: m && m.status === 'verified' ? m.steps : null, expectedModel: m && m.id !== 'other' ? modelName(m) : '', prev: S.baseline ? { energy: S.baseline.energy, volume: S.baseline.volume, hours: S.baseline.hours } : null, lang: S.lang };
    y.recognize(PH.files, ctx, PH.ctl.signal, function (i, n, kind) {
      var msg = kind === 'load' ? t('ph_loading', { p: i }) : kind === 'photo' ? (n > 1 ? t('ph_reading', { i: i, n: n }) : '') : (n > 1 ? t('ph_batch', { i: i, n: n }) : '');
      // общий ход: загрузка движка — первые 15 %, дальше фото по очереди
      PH.pct = Math.max(PH.pct || 2, Math.round(kind === 'load' ? i * 0.15 : 15 + 85 * (i - 0.5) / Math.max(1, n)));
      var pb = document.getElementById('ph-pbar'); if (pb) pb.style.width = PH.pct + '%';
      if (msg === PH.progress) return; PH.progress = msg;
      var el = document.getElementById('ph-progress'); if (el) el.textContent = msg; else if (routeName() === 'photo') render(true);
    }).then(function (res) {
      PH.result = res;
      // счётчик воды / света / газа вместо тепла — сказать прямо, а не «не удалось распознать»
      var others = (res.photos || []).filter(function (x) { return x.meterType && x.meterType !== 'heat'; });
      var anyRead = (res.photos || []).some(function (x) { return x.readings && x.readings.length; });
      if (others.length && !anyRead && !(res.meter && res.meter.modelId)) { PH.status = 'idle'; PH.error = t('ph_not_heat_' + others[0].meterType); render(true); return; }
      if (PH.mode === 'model') {
        var id = res.meter && res.meter.modelId && M.byId(res.meter.modelId) ? res.meter.modelId : null;
        PH.status = 'idle';
        if (!id) { PH.error = t('ph_model_none'); render(true); return; }
        S._pickModel = id; if (res.meter.energyUnit) S._pickUnit = res.meter.energyUnit;
        toast(t('ph_meter_found', { m: modelName(M.byId(id)) })); go('meter'); return;
      }
      var unit = PH.mode === 'baseline' ? 'Gcal' : (res.meter && res.meter.energyUnit && !S.meter) ? res.meter.energyUnit : energyUnit();
      PH.picked = y.pick(res, M.TO_GCAL, unit);
      if (!Object.keys(PH.picked).length) { PH.status = 'idle'; PH.error = phErr('nothing'); render(true); return; }
      PH.status = 'done'; PH.vals = null; PHS.save(false); render(true);
    }, function (e) {
      PH.status = 'idle'; if (e && e.code === 'cancelled') { render(true); return; }
      PH.error = phErr(e && e.code); render(true);
    });
  }
  function phApply() {
    inboxDone();
    setTimeout(function () { PHS.clear(); }, 0);
    var vals = {}; Array.prototype.forEach.call(document.querySelectorAll('[data-ph]'), function (el) { vals[el.getAttribute('data-ph')] = el.value.trim(); });
    var di = document.getElementById('ph-date'); var date = (di && di.value) || PH.date || today();
    if (PH.mode === 'baseline') {   // последние принятые ХТМ — в поля экрана «Останні прийняті»; сохраняет человек сам
      var fill = Object.assign({}, S._baseFill || {}); Object.keys(vals).forEach(function (k) { if (vals[k] !== '') fill[k] = vals[k]; }); fill.date = date;
      S._baseFill = fill; phReport(vals); persist(); go('baseline'); return;
    }
    if (!S.meter) { var mt = PH.result && PH.result.meter, id = mt && mt.modelId && M.byId(mt.modelId) ? mt.modelId : 'other'; S.meter = { modelId: id, unit: (mt && mt.energyUnit) || M.byId(id).unit }; }
    var conf = {}; Object.keys(PH.picked || {}).forEach(function (k) { var r = PH.picked[k]; if (String(vals[k]) === String(r.value)) conf[k] = r.conflict ? 0.5 : r.confidence; });
    S.draft = { date: date, values: vals, step: steps().length - 1, source: 'photo', photoConf: conf, startedAt: new Date().toISOString() };
    phReport(vals);
    save(); go('check');
  }
  function phReport(vals) {
    if (VIS().report) {   // в аналитику: чего не нашлось на фото, где расхождения, что человек поправил руками
      var picked = PH.picked || {}, all = ['energy', 'volume', 'flow', 'power', 'tSupply', 'tReturn', 'hours', 'errHours', 'errCode'];
      VIS().report({ ids: (PH.result && PH.result.ids) || [], model: S.meter && S.meter.modelId,
        missing: all.filter(function (k) { return !picked[k]; }),
        conflicts: Object.keys(picked).filter(function (k) { return picked[k].conflict; }),
        corrections: Object.keys(picked).filter(function (k) { return String(vals[k]) !== String(picked[k].value); }).map(function (k) { return { field: k, recognized: String(picked[k].value), final: String(vals[k] || '') }; }) });
    }
  }

  // ---------------- справка ----------------
  function helpHtml() {
    var ru = S.lang === 'ru', m = model();
    var how = m && m.steps ? '<ol>' + m.steps.map(function (s) {
      var press = s.press === null ? (ru ? 'Экран по умолчанию' : 'Екран за замовчуванням') : s.count ? (ru ? 'Нажмите ×' : 'Натисніть ×') + s.count : (ru ? 'Ищите экран' : 'Шукайте екран');
      return '<li><b>' + esc(press) + '</b> — ' + esc(s.fields.map(fieldLabel).join(', ')) + '. ' + esc(L(s.hint)) + '</li>';
    }).join('') + '</ol>' : '';
    var secs = [
      ['h-window', ru ? 'Когда передавать' : 'Коли передавати', ru
        ? '<p>На сайте ХТМ показания тепла принимают <b>с 5 по 25 число</b>, рекомендуют — <b>до 23-го</b>. С 26-го до 5-го форма закрыта на начисления.</p><p>Не успели — снимите <b>новые</b> показания в следующем месяце: ХТМ принимает показания только текущего месяца. Пропущенный месяц начислят по домовому счётчику, после следующих принятых показаний будет перерасчёт.</p>'
        : '<p>На сайті ХТМ показання тепла приймають <b>з 5 по 25 число</b>, рекомендують — <b>до 23-го</b>. З 26-го до 5-го форма закрита на нарахування.</p><p>Не встигли — зніміть <b>нові</b> показання наступного місяця: ХТМ приймає показання лише поточного місяця. Пропущений місяць нарахують за будинковим лічильником, після наступних прийнятих показань буде перерахунок.</p>'],
      ['h-sameday', ru ? 'Снимайте и передавайте в один день' : 'Знімайте й передавайте в один день', ru
        ? '<p>Робот ХТМ сравнивает, сколько часов насчитал счётчик, с числом часов между датами записей. Разница больше 24 часов — отказ. Поэтому дата — это день, когда вы смотрели на экран, а не день передачи.</p>'
        : '<p>Робот ХТМ порівнює, скільки годин налічив лічильник, з кількістю годин між датами записів. Різниця понад 24 години — відмова. Тому дата — це день, коли ви дивилися на екран, а не день передачі.</p>'],
      ['h-how', (ru ? 'Как снимать: ' : 'Як знімати: ') + esc(modelName(m) || ''), (m && m.status !== 'verified' ? '<p class="muted">' + esc(t('m_draft')) + '. ' + esc(L(m.note)) + '</p>' : '') + how],
      ['h-robot', ru ? 'Почему робот ХТМ не принимает' : 'Чому робот ХТМ не приймає', ru
        ? '<ul><li>Энергия, объём, часы работы или часы с ошибкой <b>меньше прошлых</b> — накопительные значения не уменьшаются.</li><li>Энергия выросла, а <b>объём не изменился</b>.</li><li>Средняя разница температур за период <b>меньше 2,5 °C</b> (теплоноситель бежит слишком быстро) или <b>больше 50</b> (ошибка в цифрах).</li><li>Средний расход меньше 0,3 × переходного расхода прибора.</li><li>Температура <b>0</b> или вне 5–95 °C.</li><li>Часы работы не сходятся с календарём больше чем на 24 часа.</li><li>Прирост энергии <b>15 Гкал и больше</b> — обычно пропущена точка.</li><li>Истёк срок поверки; прибор не внесён в базу или снят с учёта.</li></ul><p>Всё, кроме последнего пункта, мы проверяем до передачи.</p>'
        : '<ul><li>Енергія, обсяг, години роботи чи години з помилкою <b>менші за попередні</b> — накопичувальні значення не зменшуються.</li><li>Енергія зросла, а <b>обсяг не змінився</b>.</li><li>Середня різниця температур за період <b>менша за 2,5 °C</b> (теплоносій біжить занадто швидко) або <b>більша за 50</b> (помилка в цифрах).</li><li>Середня витрата менша за 0,3 × перехідної витрати приладу.</li><li>Температура <b>0</b> або поза 5–95 °C.</li><li>Години роботи не збігаються з календарем більше ніж на 24 години.</li><li>Приріст енергії <b>15 Гкал і більше</b> — зазвичай пропущена крапка.</li><li>Минув строк повірки; прилад не внесено в базу або знято з обліку.</li></ul><p>Усе, крім останнього пункту, ми перевіряємо до передачі.</p>'],
      ['h-off', ru ? 'Если отопление отключают' : 'Якщо опалення відключають', ru
        ? '<p>Перед отключением снимите и передайте показания. Перед включением — снова снимите и передайте, потом включайте.</p>'
        : '<p>Перед відключенням зніміть і передайте показання. Перед увімкненням — знову зніміть і передайте, потім вмикайте.</p>'],
      ['h-hw', ru ? 'Вода: куда и когда' : 'Вода: куди й коли', ru
        ? '<ul><li><b>Холодная</b> — в КП «Харківводоканал» до 20 числа: бот <a href="https://t.me/hvk_user_bot" target="_blank" rel="noopener">@hvk_user_bot</a>, кабинет billing.vodokanal.kharkov.ua, телефон (057) 707-58-51.</li><li><b>Горячая — в два места</b>: в Водоканал до 20 числа (за водоотведение) и в ХТМ (за саму горячую воду): бот <a href="' + BOT_URL + '" target="_blank" rel="noopener">@KPHTM_Bot</a> или телефон (057) 341-41-40.</li><li>Не пользовались — всё равно передайте те же цифры, иначе начислят по норме.</li><li>Передают целые кубометры — чёрные цифры; красные (литры) не нужны.</li></ul><p>В Теплосервисе: карточки «Горячая вода» и «Холодная вода» на главной — плюс сразу открывает ввод, а после сохранения готово сообщение для бота Водоканала.</p>'
        : '<ul><li><b>Холодна</b> — у КП «Харківводоканал» до 20 числа: бот <a href="https://t.me/hvk_user_bot" target="_blank" rel="noopener">@hvk_user_bot</a>, кабінет billing.vodokanal.kharkov.ua, телефон (057) 707-58-51.</li><li><b>Гаряча — у два місця</b>: у Водоканал до 20 числа (за водовідведення) і в ХТМ (за саму гарячу воду): бот <a href="' + BOT_URL + '" target="_blank" rel="noopener">@KPHTM_Bot</a> або телефон (057) 341-41-40.</li><li>Не користувалися — однаково передайте ті самі цифри, інакше нарахують за нормою.</li><li>Передають цілі кубометри — чорні цифри; червоні (літри) не потрібні.</li></ul><p>У Теплосервісі: картки «Гаряча вода» й «Холодна вода» на головній — плюс одразу відкриває введення, а після збереження готове повідомлення для бота Водоканалу.</p>'],
      ['h-special', ru ? 'Счётчики ELF, TRUST, ЛТЭ, Ultrameter' : 'Лічильники ELF, TRUST, ЛТЕ, Ultrameter', ru
        ? '<p>Эти приборы считают часы работы только когда идёт теплоноситель. ХТМ советует держать расход выше переходного весь отопительный период и разницу температур больше 3 °C — иначе показания могут не принять, и тогда их подают на бумаге в районный филиал.</p>'
        : '<p>Ці прилади рахують години роботи лише коли йде теплоносій. ХТМ радить тримати витрату вищою за перехідну весь опалювальний період і різницю температур більше 3 °C — інакше показання можуть не прийняти, і тоді їх подають паперово в районну філію.</p>'],
      ['h-phones', ru ? 'Телефоны ХТМ' : 'Телефони ХТМ', ru
        ? '<ul><li>Колл-центр: (057) 341-41-40</li><li>Поверка, распломбирование, осмотр узла учёта: 050-670-13-45</li><li>Прибор отсутствует в базе: 067-370-87-75</li></ul>'
        : '<ul><li>Кол-центр: (057) 341-41-40</li><li>Повірка, розпломбування, огляд вузла обліку: 050-670-13-45</li><li>Прилад відсутній у базі: 067-370-87-75</li></ul>']
    ];
    var byId = {}; secs.forEach(function (x) { byId[x[0]] = { title: x[1], html: x[2] }; });
    var photoTips = '<ul>' + t('ph_tips').split('|').map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    var groups = [
      { id: 'hg-send', title: t('hg_send'), icon: 'calendar', items: [byId['h-window'], byId['h-sameday'], byId['h-how'], { title: t('ph_tips_t'), html: photoTips }] },
      { id: 'hg-reject', title: t('hg_reject'), icon: 'alert', items: [byId['h-robot'], byId['h-special'], byId['h-off']] },
      { id: 'hg-other', title: t('hg_other'), icon: 'info', items: [byId['h-hw'], byId['h-phones']] }
    ];
    groups[0].items[0].open = true;
    return '<div class="help-doc"><h1>' + esc(t('help_title')) + '</h1><nav class="toc" aria-label="' + esc(t('help_title')) + '">' + groups.map(function (g) { return '<button type="button" class="tocb" data-act="scroll" data-target="' + g.id + '">' + esc(g.title) + '</button>'; }).join('') + '</nav>' +
      accGroups(groups, 'help-groups') + '</div>';
  }

  // ---------------- маршрутизация ----------------
  function routeName() { return (location.hash || '').replace(/^#/, ''); }
  function render(keepScroll) {
    var r = routeName();
    if (S.onboarded && !S.meter && ['home', '', 'meter', 'help', 'prefs', 'login', 'photo', 'privacy', 'terms', 'start', 'wsetup', 'wnew', 'water-hot', 'water-cold'].indexOf(r) < 0) r = 'meter';
    pendingRender = false;
    if (!S.onboarded && ['welcome', 'start', 'wsetup', 'meter', 'baseline', 'help', 'login', 'photo', 'privacy', 'terms'].indexOf(r) < 0) r = S.meter ? 'baseline' : 'welcome';
    if (S.onboarded && (!r || r === 'welcome')) r = 'home';
    var view;
    var rm = r.match(/^rec-([\w-]+?)(-edit)?$/);
    if (rm) view = recView(rm[1], !!rm[2]);
    else if (/^step-\d+$/.test(r)) view = (S.meter ? V.step(+r.split('-')[1]) : V.meter());
    else view = (V[r] || V.home)();
    if (!view.route) view.route = r;
    if (FB.open) { var ft = document.getElementById('fb-text'), fc = document.getElementById('fb-contact'); if (ft) FB.text = ft.value; if (fc) FB.contact = fc.value; }
    document.getElementById('root').innerHTML = shell(view);
    document.documentElement.lang = S.lang;
    document.title = t('brand');
    if (keepScroll !== true) window.scrollTo(0, 0);
    afterRender(r);
  }
  function go(r) { if (routeName() === r) render(); else location.hash = r; }

  /** Даты — всегда «дд.мм.рррр», как в ХТМ, независимо от языка браузера. Настоящее поле type=date остаётся
   *  (скрытым) и хранит ISO-значение — весь остальной код читает его как раньше; кнопка-календарь открывает его выбор. */
  function enhanceDates(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('input[type=date]:not([data-dmy])'), function (nat) {
      nat.setAttribute('data-dmy', '1');
      var txt = document.createElement('input'); txt.type = 'text'; txt.className = 'num dmy'; txt.inputMode = 'numeric'; txt.autocomplete = 'off';
      txt.placeholder = S.lang === 'ru' ? 'дд.мм.гггг' : 'дд.мм.рррр'; txt.maxLength = 10;
      if (nat.id) { txt.id = nat.id + '-dmy'; var lb = document.querySelector('label[for="' + nat.id + '"]'); if (lb) lb.setAttribute('for', txt.id); }
      var toDmy = function (iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? m[3] + '.' + m[2] + '.' + m[1] : ''; };
      txt.value = toDmy(nat.value);
      var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'dmy-cal'; btn.setAttribute('aria-label', S.lang === 'ru' ? 'Календарь' : 'Календар'); btn.innerHTML = ico('calendar', 20);
      nat.classList.add('dmy-native'); nat.tabIndex = -1; nat.setAttribute('aria-hidden', 'true');
      nat.parentNode.insertBefore(txt, nat); nat.parentNode.insertBefore(btn, nat.nextSibling); nat.parentNode.classList.add('has-dmy');
      var push = function (iso) { if (nat.value === iso) return; nat.value = iso; nat.dispatchEvent(new Event('input', { bubbles: true })); nat.dispatchEvent(new Event('change', { bubbles: true })); };
      txt.addEventListener('input', function () {
        var d = txt.value.replace(/\D/g, '').slice(0, 8), out = d.slice(0, 2);
        if (d.length > 2) out += '.' + d.slice(2, 4); if (d.length > 4) out += '.' + d.slice(4);
        if (out !== txt.value) txt.value = out;
        if (!d) { push(''); return; }
        if (d.length === 8) {
          var iso = d.slice(4) + '-' + d.slice(2, 4) + '-' + d.slice(0, 2), ok = !isNaN(Date.parse(iso + 'T00:00:00Z')) && new Date(iso + 'T00:00:00Z').toISOString().slice(0, 10) === iso;
          txt.classList.toggle('bad', !ok); if (ok) push(iso);
        } else txt.classList.remove('bad');
      });
      nat.addEventListener('change', function () { var v = toDmy(nat.value); if (v !== txt.value && document.activeElement !== txt) txt.value = v; });
      btn.addEventListener('click', function () { try { if (nat.showPicker) { nat.showPicker(); return; } } catch (e) { /* старый браузер */ } nat.focus(); nat.click(); });
    });
  }

  var SCROLL_TO = null;
  function afterRender(r) {
    enhanceDates();
    if (SCROLL_TO) { var st0 = document.getElementById(SCROLL_TO); SCROLL_TO = null; if (st0) { st0.scrollIntoView({ block: 'start' }); try { st0.focus({ preventScroll: true }); } catch (e0) { /* старый браузер */ } st0.classList.add('flash'); setTimeout(function () { st0.classList.remove('flash'); }, 1600); } }
    if (Y().mode === 'server') mountTelegramWidget();
    var first = document.querySelector('[data-field]:not([type=radio])');
    if (first && /^step-/.test(r) && window.matchMedia('(min-width: 600px)').matches) first.focus({ preventScroll: true });
    var demo = document.getElementById('p-demo');
    if (demo) demo.addEventListener('change', function () { S.demoToday = demo.value; save(); toast(t('b_saved')); });
  }

  // ---------------- действия ----------------
  function toast(msg) {
    var host = document.getElementById('toast-host'); if (!host) return;
    host.innerHTML = '<div class="toast">' + esc(msg) + '</div>';
    clearTimeout(toast._t); toast._t = setTimeout(function () { host.innerHTML = ''; }, 2400);
  }
  function copyText(text, btn) {
    function ok() { if (btn) { btn.classList.add('done'); var sp = btn.querySelector('span'); if (sp) sp.textContent = t('copied'); } toast(t('copied')); }
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); var done = false; try { done = document.execCommand('copy'); } catch (e) { /* нет */ }
      document.body.removeChild(ta); if (done) ok(); else toast(text);
    }
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback); else fallback(); } catch (e) { fallback(); }
  }

  function readStepInputs() {
    var inputs = document.querySelectorAll('#step-form [data-field]');
    Array.prototype.forEach.call(inputs, function (el) { S.draft.values[el.getAttribute('data-field')] = el.value.trim(); if (el.getAttribute('data-field') === 'date') { S.draft.date = el.value; delete S.draft.values.date; } });
    var ecNone = document.querySelector('input[name="ec"][value="none"]');
    if (ecNone && ecNone.checked) S.draft.values.errCode = '';
    save();
  }
  function stepNext(i) {
    readStepInputs();
    var st = steps()[i], missing = [];
    if (st.kind === 'date') { if (!S.draft.date) missing.push('date'); }
    else st.fields.forEach(function (k) { if (k !== 'errCode' && (S.draft.values[k] == null || S.draft.values[k] === '')) missing.push(k); });
    if (missing.length) {
      missing.forEach(function (k) { var h = document.getElementById('h-' + k); var w = document.getElementById('fw-' + k); if (h) { h.textContent = t('s_need'); h.className = 'help block'; } if (w) w.className = 'field is-block'; });
      var el = document.querySelector('[data-field="' + missing[0] + '"]'); if (el) el.focus();
      return;
    }
    if (i >= steps().length - 1) go('check'); else goStep(i + 1);
  }
  /** Переход между шагами прямо в обработчике нажатия: так телефон разрешает сразу поставить курсор в новое поле —
   *  клавиатура не закрывается и не открывается заново, экран не прыгает (через смену адреса фокус был бы уже «не от пользователя»). */
  function goStep(n) {
    try { history.pushState(null, '', '#step-' + n); } catch (e) { location.hash = 'step-' + n; return; }
    render(document.documentElement.classList.contains('kb-open'));   // клавиатура открыта — не дёргать прокрутку в начало
    var f = document.querySelector('[data-field]:not([type=radio])');
    if (f && f.type !== 'date') { f.focus({ preventScroll: true }); fitStep(); }
  }
  /** Клавиатура открыта: прокрутить так, чтобы кнопки «Назад/Далі» стояли прямо над ней — сверху остаётся видна подсказка и пример экрана. */
  function fitStep() {
    var vv = window.visualViewport; if (!vv || !/^step-/.test(routeName())) return;
    var run = function () {
      // iOS: при клавиатуре innerHeight тоже уменьшается — сравниваем с высотой макета (она не меняется)
      var full = document.documentElement.clientHeight || window.screen.height;
      var f = document.activeElement, typing = f && f.matches && f.matches('[data-field]') && f.type !== 'date';
      var kb = typing && vv.height < full * 0.8; document.documentElement.classList.toggle('kb-open', kb);
      if (!kb) return;
      var top = document.querySelector('.wiz-top'), a = document.querySelector('.wiz-actions'); if (!top || !a) return;
      var visTop = vv.offsetTop, visBot = vv.offsetTop + vv.height;
      // сначала — шаг и «что нажать» у верхнего края; если кнопки не влезли — подвинуть так, чтобы влезли (поле при этом остаётся видно)
      var d = top.getBoundingClientRect().top - visTop - 4, over = a.getBoundingClientRect().bottom - d + 8 - visBot;
      if (over > 0) d += Math.min(over, f.getBoundingClientRect().top - d - visTop - 8);
      if (Math.abs(d) > 3) window.scrollBy(0, d);
    };
    requestAnimationFrame(run); setTimeout(run, 150); setTimeout(run, 450); setTimeout(run, 800);
  }
  if (window.visualViewport) window.visualViewport.addEventListener('resize', function () {
    var vv = window.visualViewport, full = document.documentElement.clientHeight || window.screen.height;
    if (vv.height >= full * 0.9 && document.documentElement.classList.contains('kb-open')) { document.documentElement.classList.remove('kb-open'); window.scrollTo(window.scrollX, window.scrollY); }
    fitStep();
  });
  document.addEventListener('focusin', function (e) { if (e.target && e.target.matches && e.target.matches('[data-field]') && /^step-/.test(routeName())) fitStep(); });
  // на компьютере: нажатие «Далі» не уводит фокус из поля (на телефоне фокус ставит goStep)
  document.addEventListener('mousedown', function (e) { if (e.target.closest && e.target.closest('[data-act="step-next"],[data-act="step-back"]') && document.activeElement && document.activeElement.matches && document.activeElement.matches('[data-field]')) e.preventDefault(); });
  function liveCheck(el) {
    var k = el.getAttribute('data-field'), v = el.value;
    if (k === 'date') { S.draft.date = v; save(); return; }
    S.draft.values[k] = v.trim(); save();
    var line = document.getElementById('lcd-' + k);
    if (line) { line.classList.toggle('sample', !v); var svg = line.querySelector('svg'); var tmp = document.createElement('div'); var st = steps()[S.draft.step] || {}; tmp.innerHTML = segSvg(v ? lcdText(k, v) : (st.lcd ? (st.fields[0] === k ? st.lcd.digits : (st.lcd.alt || st.lcd).digits) : '')); svg.parentNode.replaceChild(tmp.firstChild, svg); }
    var cap = document.getElementById('lcd-cap'); if (cap && v) cap.textContent = t('s_on_screen');
    var h = document.getElementById('h-' + k), w = document.getElementById('fw-' + k); if (!h) return;
    var res = R.checkField(k, v, prevForEntry());
    if (!res || !v) { h.textContent = h.getAttribute('data-base') || ''; h.className = 'help'; if (w) w.className = 'field'; return; }
    var msg = L(res.msg);
    var plainTxt = (h.getAttribute('data-plain') || '');
    h.textContent = res.level === 'ok' ? (msg ? msg + ' ' + fieldUnit(k) + (plainTxt ? (S.lang === 'ru' ? ' — в прошлый раз ' : ' — минулого разу ') + plainTxt.replace(/^[^0-9]+/, '') : '') : (h.getAttribute('data-base') || '')) : msg;
    h.className = 'help ' + (res.level === 'ok' ? (msg ? 'ok' : '') : res.level);
    if (w) w.className = 'field' + (res.level === 'block' ? ' is-block' : res.level === 'warn' ? ' is-warn' : '');
  }

  function saveReading(status) {
    var res = S._lastCheck || runCheck(S.draft), htm = draftReadingGcal(S.draft);
    var rd = { id: uid(), place: S.placeId, htm: htm, raw: Object.assign({}, S.draft.values), unit: energyUnit(), status: status, createdAt: new Date().toISOString(), updatedAt: Date.now(), source: S.draft.source || 'manual',
      verdict: res.verdict, codes: res.items.map(function (x) { return x.code; }),
      derived: Object.assign({}, res.derived, S.baseline ? { days: R.daysBetween(S.baseline.date, htm.date) } : {}) };
    S.readings.push(rd); S.draft = null; S.focusId = rd.id; save();
    return rd;
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var act = el.getAttribute('data-act');
    if (waterAct(act, el, e)) return;
    switch (act) {
      case 'start': break;
      case 'read': newDraft(); go('step-0'); break;
      case 'restart': newDraft(); go('step-0'); break;
      case 'pick-model': S._pickModel = el.value; render(true); break;
      case 'save-meter': {
        var id = S._pickModel || (S.meter && S.meter.modelId); var pm = M.byId(id); if (!pm) return;
        var u = document.querySelector('input[name="unit"]:checked');
        S.meter = Object.assign({}, S.meter || {}, { modelId: id, unit: u ? u.value : pm.unit });
        delete S._pickModel; save();
        go(S.onboarded && S.baseline ? 'home' : 'baseline'); break;
      }
      case 'skip-base': S.onboarded = true; delete S._baseFill; save(); go('home'); break;
      case 'sample': {
        var d = addDays(today(), -25), smp = { date: d, energy: '13.245', volume: '2292.676', flow: '0.063', power: '1.685', tSupply: '50.76', tReturn: '27.71', hours: '34598', errHours: '153', errCode: 'E---' };
        Object.keys(smp).forEach(function (k) { var f = document.querySelector('[data-b="' + k + '"]'); if (f) f.value = smp[k]; });
        break;
      }
      case 'step-next': e.preventDefault(); stepNext(+el.getAttribute('data-i')); break;
      case 'step-back': e.preventDefault(); readStepInputs(); goStep(+el.getAttribute('data-i')); break;
      case 'ec': { var ctl = document.getElementById('ec-ctl'); if (ctl) ctl.style.display = el.value === 'code' ? '' : 'none'; if (el.value === 'code') { var f2 = document.getElementById('f-errCode'); if (f2) f2.focus(); } break; }
      case 'fix': go('step-' + stepOfField(el.getAttribute('data-field'))); break;
      case 'save-inter': saveReading('intermediate'); toast(t('c_saved_inter')); go('home'); break;
      case 'to-handover': if (el.disabled) return; saveReading('checked'); go('handover'); break;
      case 'copy': copyText(el.getAttribute('data-text'), el); break;
      case 'handed': {
        var r = RD().filter(function (x) { return x.id === el.getAttribute('data-id'); })[0];
        if (r) { r.status = 'handed'; r.handedAt = new Date().toISOString(); r.updatedAt = Date.now(); S.focusId = r.id; save(); }
        go('status'); break;
      }
      case 'link-bot': {   // привязать Telegram через бота: одноразовая ссылка t.me/<бот>?start=link_…
        var w0 = window.open('about:blank', '_blank'), doneL = busy(el);
        fetch(window.TEPLO_API + '/auth/link-bot', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF': (document.cookie.match(/(?:^|; )ts_csrf=([^;]*)/) || [])[1] || '', Accept: 'application/json' }, body: '{}' })
          .then(function (r) { return r.json(); }).then(function (j) {
            doneL();
            if (!j || !j.url) { if (w0) w0.close(); toast(t('err_network')); return; }
            if (w0) w0.location.href = j.url; else location.href = j.url;
            toast(t('acct_link_bot_wait')); LINKWAIT = true;
          }, function () { doneL(); if (w0) w0.close(); toast(t('err_network')); });
        break;
      }
      case 'doc-add': { var fi = document.getElementById('doc-input'); if (fi) { fi.setAttribute('data-kind', el.getAttribute('data-kind')); fi.value = ''; fi.click(); } break; }
      case 'doc-del': {
        if (!confirm(t('mv_del_q'))) break;
        busy(el);
        fetch(window.TEPLO_API + '/docs/delete', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF': (document.cookie.match(/(?:^|; )ts_csrf=([^;]*)/) || [])[1] || '' }, body: JSON.stringify({ id: el.getAttribute('data-id') }) })
          .then(function () { loadDocs(true); }); break;
      }
      case 'theme-toggle': S.theme = resolvedTheme() === 'dark' ? 'light' : 'dark'; persist(); applyTheme(); render(true); { var tb = document.querySelector('[data-key=theme-toggle]'); if (tb) tb.focus(); } break;
      case 'theme': S.theme = el.getAttribute('data-v'); persist(); applyTheme(); render(true); break;
      case 'pl-use': switchPlace(el.getAttribute('data-id')); WX.key = ''; toast(t('pl_switched', { p: placeLabel(place()) })); go('home'); break;
      case 'pl-add': { syncPlace(); var np = { id: 'p' + Date.now().toString(36), name: '', meter: null, baseline: null, updatedAt: Date.now() }; S.places.push(np); switchPlace(np.id); go('meter'); break; }
      case 'pl-del': { var dp = place(el.getAttribute('data-id')); if (dp && places().length > 1) { dp.deleted = true; dp.updatedAt = Date.now(); if (dp.id === S.placeId) { S.placeId = null; ensurePlaces(); } save(); render(true); } break; }
      case 'focus': S.focusId = el.getAttribute('data-id'); save(); break;
      case 'rec-del-ask': { var bx = document.getElementById('rec-del-confirm'); if (bx) bx.innerHTML = '<div class="banner warn" style="margin-top:16px">' + ico('alert', 22) + '<div><p>' + esc(t('rec_del_q')) + '</p><div class="row-actions" style="margin-top:8px"><button class="btn danger" data-act="rec-del-yes">' + esc(t('rec_del')) + '</button></div></div></div>'; break; }
      case 'rec-del-yes': { var m2 = routeName().match(/^rec-([\w-]+)$/), rx = m2 && RD().filter(function (x) { return x.id === m2[1]; })[0];
        if (rx) { rx.deleted = true; rx.updatedAt = Date.now(); if (S.focusId === rx.id) S.focusId = null; save(); toast(t('rec_deleted')); } go('history'); break; }
      case 'accepted': {
        var ra = RD().filter(function (x) { return x.id === el.getAttribute('data-id'); })[0];
        if (ra) { ra.status = 'accepted'; ra.updatedAt = Date.now(); ra.result = { at: new Date().toISOString() }; S.baseline = Object.assign({}, ra.htm); save(); }
        render(); break;
      }
      case 'show-reject': { var f = document.getElementById('reject-form'); if (f) { f.style.display = ''; document.getElementById('rej-text').focus(); } break; }
      case 'refix': {
        var rr = RD().filter(function (x) { return x.id === el.getAttribute('data-id'); })[0];
        if (rr) { S.draft = { date: rr.htm.date, values: Object.assign({}, rr.raw), step: steps().length - 1, fixOf: rr.id }; save(); go('check'); }
        break;
      }
      case 'to-meter': { e.preventDefault(); SCROLL_TO = 'meter-block'; go('prefs'); break; }
      case 'scroll': { var tg = document.getElementById(el.getAttribute('data-target')); if (tg) tg.scrollIntoView({ behavior: 'smooth', block: 'start' }); break; }
      case 'export': copyText(JSON.stringify(S), el); break;
      case 'wipe-ask': document.getElementById('wipe-confirm').innerHTML = '<div class="confirm"><p>' + esc(t(el.getAttribute('data-test') || (Y().mode === 'server' && Y().account) ? 'tr_confirm' : 'p_wipe_confirm')) + '</p><div class="row-actions" style="margin-top:8px"><button class="btn sec" data-act="wipe-no">' + esc(t('cancel')) + '</button><button class="btn danger" data-act="wipe-yes" data-key="prefs-wipe-yes">' + esc(t('p_wipe_yes')) + '</button></div></div>'; break;
      case 'photo': {
        if (el.getAttribute('data-mode') === 'baseline') {   // не потерять уже введённое руками
          var typed = {}; Array.prototype.forEach.call(document.querySelectorAll('[data-b]'), function (x) { if (x.value.trim()) typed[x.getAttribute('data-b')] = x.value.trim(); });
          if (Object.keys(typed).length) { S._baseFill = Object.assign({}, S._baseFill || {}, typed); persist(); }
        }
        var wantMode = el.getAttribute('data-mode') || 'reading';
        if (!(PH.mode === wantMode && PH.files.length)) phReset(wantMode);   // незавершённое распознавание того же вида — продолжаем, не теряя фото
        go('photo'); break;
      }
      case 'ph-remove': { var ix = +el.getAttribute('data-i'); try { URL.revokeObjectURL(PH.urls[ix]); } catch (e2) { /* нет */ } PH.files.splice(ix, 1); PH.urls.splice(ix, 1); if (PH.files.length) PHS.save(true); else PHS.clear(); render(true); break; }
      case 'ph-run': phRun(); break;
      case 'fb-open': FB.open = true; FB.err = ''; render(true); setTimeout(function () { var x = document.getElementById('fb-text'); if (x) x.focus(); }, 0); break;
      case 'fb-close': { var tx = document.getElementById('fb-text'); if (tx) FB.text = tx.value; FB.open = false; render(true); break; }
      case 'fb-send': fbSend(); break;
      case 'ph-stop': if (PH.ctl) PH.ctl.abort(); break;
      case 'ph-again': PH.status = 'idle'; PHS.save(false); render(true); break;
      case 'ph-new': inboxDone(); phReset(PH.mode); render(true); break;
      case 'inbox-run': inboxRun(); break;
      case 'ph-apply': phApply(); break;
      case 'ph-use-model': { var um = M.byId(el.getAttribute('data-id')); S.meter = Object.assign({}, S.meter || {}, { modelId: um.id, unit: el.getAttribute('data-unit') || um.unit }); save(); toast(t('b_saved')); PH.picked = VIS().pick(PH.result, M.TO_GCAL, energyUnit()); render(true); break; }
      case 'auth-mode': authMode = authMode === 'login' ? 'register' : 'login'; render(true); break;
      case 'logout': ADMIN = null; busy(el); Y().logout().then(function () { S = defaults(); S.lang = browserLang(); ensurePlaces(); lastSig = window.TeploSync.sig(window.TeploSync.payload(S)); persist(); toast(t('logged_out')); go('welcome'); }); break;
      case 'dismiss-sync': S.syncPromptDismissed = true; persist(); render(true); break;
      case 'wipe-no': document.getElementById('wipe-confirm').innerHTML = ''; break;
      case 'wipe-yes': { var now = Date.now(); S = defaults(); S.lang = browserLang(); S.wipedAt = now; ensurePlaces(); phReset(); FB.open = false; save(); toast(t('p_wiped')); go('welcome'); break; }
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'p-ver' && S.meter) { S.meter = Object.assign({}, S.meter, { verifiedUntil: e.target.value || '' }); save(); render(true); return; }
    if (e.target && e.target.id === 'doc-input' && e.target.files && e.target.files[0]) {
      var f = e.target.files[0], kind = e.target.getAttribute('data-kind') || 'other';
      var prep = /^image\//.test(f.type) && window.TeploVision ? window.TeploVision.prepare(f) : Promise.resolve(f);
      DOCS.busy = kind; render(true);
      prep.then(function (b) {
        return fetch(window.TEPLO_API + '/docs/upload?place=' + encodeURIComponent(S.placeId) + '&kind=' + kind, { method: 'POST', credentials: 'same-origin', body: b,
          headers: { 'Content-Type': b.type || f.type || 'application/octet-stream', 'X-CSRF': (document.cookie.match(/(?:^|; )ts_csrf=([^;]*)/) || [])[1] || '', Accept: 'application/json' } });
      }).then(function (r) { DOCS.busy = ''; if (!r.ok) toast(r.status === 415 ? t('mv_bad_file') : r.status === 413 ? t('mv_too_big') : t('err_network')); else toast(t('mv_saved')); loadDocs(true); render(true); },
        function () { DOCS.busy = ''; toast(t('err_network')); render(true); });
      return;
    }
  });
  document.addEventListener('change', function (e) { if (e.target && e.target.id === 'place-sel') { switchPlace(e.target.value); WX.key = ''; render(); } });
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.matches('[data-field]') && S.draft) liveCheck(el);
    if (el.matches('[data-contact]')) { S.contacts = S.contacts || {}; S.contacts[el.getAttribute('data-contact')] = el.value.trim(); save(); }
    if (el.id === 'pl-name' || el.getAttribute && el.getAttribute('data-plname')) { var pp = place(el.getAttribute('data-plname') || S.placeId); if (pp) { pp.name = el.value.trim().slice(0, 120); pp.updatedAt = Date.now(); save(); } }
    if (el.id === 'p-tariff') { var tn = R.num(el.value.replace(',', '.')); if (tn && tn > 0 && tn < 100000) { S.tariff = tn; save(); } }
    if (el.id === 'p-abon' || el.id === 'p-mzk') {
      var bv = el.value.trim() === '' ? (el.id === 'p-mzk' ? 0 : R.C.ABON) : R.num(el.value.replace(',', '.'));
      if (bv !== null && bv >= 0 && bv < 10000) { S.bill = Object.assign({}, S.bill || {}); S.bill[el.id === 'p-abon' ? 'abon' : 'mzk'] = bv; save(); }
    }
  });
  document.addEventListener('change', function (e) {
    if (e.target.id === 'ph-input') {
      var max = 20, add = Array.prototype.slice.call(e.target.files || []).slice(0, Math.max(0, max - PH.files.length));
      add.forEach(function (f) { PH.files.push(f); PH.urls.push(URL.createObjectURL(f)); });
      if (PH.status !== 'done') PH.status = 'idle'; PHS.save(true);
      var di = document.getElementById('ph-date'); if (di) PH.date = di.value;
      PH.error = ''; render(true);
    }
  });
  document.addEventListener('input', function (e) {
    var k = e.target && e.target.getAttribute && e.target.getAttribute('data-ph');
    if (k && PH.status === 'done') { PH.vals = PH.vals || {}; PH.vals[k] = e.target.value; PHS.save(false); }
    else if (e.target && e.target.id === 'ph-date' && PH.files.length) { PH.date = e.target.value; PHS.save(false); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && FB.open) { var tx = document.getElementById('fb-text'); if (tx) FB.text = tx.value; FB.open = false; render(true); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('label[for="ph-input"]')) { e.preventDefault(); document.getElementById('ph-input').click(); return; }
    if (e.key === 'Enter' && e.target.matches('#step-form input[data-field]')) {
      e.preventDefault();
      var inputs = Array.prototype.slice.call(document.querySelectorAll('#step-form input[data-field]:not([type=radio])')).filter(function (x) { return x.offsetParent !== null; });
      var idx = inputs.indexOf(e.target);
      if (idx >= 0 && idx < inputs.length - 1) inputs[idx + 1].focus();
      else { var b = document.querySelector('[data-act="step-next"]'); if (b) b.click(); }
    }
  });
  document.addEventListener('submit', function (e) {
    if (e.target.id === 'rec-form') {   // правка показаний из истории
      e.preventDefault();
      var rf = RD().filter(function (x) { return x.id === e.target.getAttribute('data-id'); })[0]; if (!rf) return;
      var dt = document.getElementById('re-date').value, er = document.getElementById('re-err'), vals = {};
      Array.prototype.forEach.call(document.querySelectorAll('[data-re]'), function (el) { vals[el.getAttribute('data-re')] = el.value.trim().replace(',', '.'); });
      var badNums = Object.keys(vals).filter(function (k) { return k !== 'errCode' && vals[k] !== '' && R.num(vals[k]) === null; }).map(fieldLabel).join(', ');
      var bad = !/^\d{4}-\d{2}-\d{2}$/.test(dt) ? t('rec_bad_date') : dt > today() ? t('rec_future') : R.num(vals.energy) === null ? t('rec_need_energy') : badNums ? t('rec_bad_num', { f: badNums }) : '';
      if (bad) { er.textContent = bad; return; }
      var nh = Object.assign({}, rf.htm, { date: dt });
      Object.keys(vals).forEach(function (k) { nh[k] = k === 'errCode' ? R.normCode(vals[k]) : (vals[k] === '' ? null : R.num(vals[k])); });
      rf.htm = nh; rf.editedAt = new Date().toISOString(); rf.updatedAt = Date.now(); delete rf.derived;
      save(); toast(t('b_saved')); go('rec-' + rf.id); return;
    }
    e.preventDefault();
    var f = e.target;
    if (f.id === 'baseline-form') {
      var b = {}; Array.prototype.forEach.call(f.querySelectorAll('[data-b]'), function (el) { b[el.getAttribute('data-b')] = el.value.trim(); });
      var hasAny = Object.keys(b).some(function (k) { return k !== 'errCode' && b[k]; });
      if (hasAny) { b.errCode = R.normCode(b.errCode); ['energy', 'volume', 'flow', 'power', 'tSupply', 'tReturn', 'hours', 'errHours'].forEach(function (k) { var n = R.num(b[k]); b[k] = n === null ? '' : n; }); S.baseline = b; }
      S.meter = S.meter || {};
      Array.prototype.forEach.call(f.querySelectorAll('[data-m]'), function (el) { S.meter[el.getAttribute('data-m')] = el.value.trim(); });
      S.onboarded = true; delete S._baseFill; save(); toast(t('b_saved')); go('home');
    } else if (f.id === 'step-form') {
      var nb = document.querySelector('[data-act="step-next"]'); if (nb) nb.click();
    } else if (f.id === 'reject-form') {
      var r = RD().filter(function (x) { return x.id === f.getAttribute('data-id'); })[0];
      var text = document.getElementById('rej-text').value.trim();
      if (r) { var dec = R.decodeRobot(text); r.status = 'rejected'; r.updatedAt = Date.now(); r.robot = { text: text, code: dec.code, fix: dec.fix || null }; save(); }
      render();
    } else if (f.id === 'login-form') {
      var em = document.getElementById('a-email').value.trim(), pw = document.getElementById('a-pass').value, er = document.getElementById('login-err');
      er.textContent = '';
      var done = busy(f.querySelector('[type=submit]'));
      (f.getAttribute('data-mode') === 'register' ? Y().register(em, pw) : Y().login(em, pw)).then(function (j) { done(); afterLogin(j, er); }, function () { done(); er.textContent = t('err_network'); });
    } else if (f.id === 'setpass-form') {
      var em2 = document.getElementById('a-email').value.trim(), pw2 = document.getElementById('a-pass').value, er2 = document.getElementById('setpass-err');
      var done2 = busy(f.querySelector('[type=submit]'));
      Y().setPassword(em2, pw2).then(function (j) { done2(); if (j._status === 200) { toast(t('b_saved')); render(true); } else er2.textContent = authError(j); });
    } else if (f.id === 'import-form') {
      try { var data = JSON.parse(document.getElementById('p-import').value); if (!data || typeof data !== 'object' || !Array.isArray(data.readings)) throw new Error('bad'); S = Object.assign(defaults(), data); S.lang = browserLang(); save(); toast(t('p_import_ok')); render(); }
      catch (err) { toast(t('p_import_bad')); }
    }
  });
  window.addEventListener('hashchange', function () { render(); });
  var tw = window.Telegram && window.Telegram.WebApp;
  if (tw && tw.initData) { try { tw.ready(); tw.expand(); applyTheme(); if (tw.onEvent) tw.onEvent('themeChanged', function () { applyTheme(); safeRender(); }); } catch (e) { /* старый клиент */ } }
  if (window.TEPLO_API && window.TeploVision) window.TeploVision.initServer({}, false);
  render();
  PHS.restore().then(function (ok) { if (ok && routeName() === 'photo') safeRender(); });
  if (window.TeploSync) {
    var onSync = function () {
      var el = document.getElementById('sync-status'); if (el) el.textContent = syncStatusText();
      if (window.TEPLO_API && window.TeploVision && window.TeploSync._cfg) window.TeploVision.initServer(window.TeploSync._cfg, !!window.TeploSync.account);
      if (!window.TeploSync.account) ADMIN = null; else { checkAdmin(); if (INBOX.items === null || INBOX.auto) loadInbox(); }
      if (['prefs', 'login', 'welcome', 'home', 'meter', 'baseline'].indexOf(routeName() || 'welcome') >= 0 || /^step-/.test(routeName())) safeRender();
    };
    window.TeploSync.init(function () { return S; }, applyRemote, onSync);
    if (window.TEPLO_API) window.TeploSync.config().then(function (c) { window.TeploSync._cfg = c; onSync(); }, function () { /* сервер недоступен */ });
  }
  if (window.TeploVision) window.TeploVision.init(function () { if (['home', 'meter', 'photo', 'step-0', ''].indexOf(routeName()) >= 0) safeRender(); });
})();
