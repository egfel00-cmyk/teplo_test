/*
 * Теплосервис — веб-приложение (бесплатная часть). Vanilla JS, без сборки и зависимостей.
 * Данные — в localStorage этого браузера (с запасным хранением в памяти).
 * Маршруты — #имя (welcome, home, meter, baseline, step-N, check, handover, status, history, help, prefs).
 * Экраны помечены data-screen (S00…S11 из design/04-NAV-MAP.md), элементы — data-key.
 */
(function () {
  'use strict';
  var R = window.TeploRules, M = window.TeploModels, I = window.TeploI18n;
  var SEO_TITLE = document.title;   // заголовок страницы от сервера (под поиск) — до первой отрисовки
  var APP_VER = '1.0';   // версия сборки (бейдж «Test beta» в шапке убран 06.11.2026 по просьбе владельца)
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
  var GASMV = false; // перенесли рахунок газу — зберегти (і на сервер) після запуску
  function ensurePlaces() {
    if (!Array.isArray(S.places)) S.places = [];
    if (!places().length) S.places.push({ id: S.places.length ? 'p' + Date.now().toString(36) : 'main', name: '', v: 2, meter: S.meter || null, baseline: S.baseline || null, updatedAt: 0 });
    // раньше в name писали адрес («Адреса квартири») — теперь name — название («Моя», «Батьків»), адрес — отдельно
    places().forEach(function (p) { if (!p.v) { if (p.name && !p.address) { p.address = p.name; p.name = ''; } p.v = 2; } });
    // газ: 10 цифр у «рахунку Нафтогазу» — це рахунок Газмереж (доставка; у Нафтогазу 9 цифр) — переносимо в його поле
    places().forEach(function (p) { (p.meters || []).forEach(function (m) { if (gasMove(m)) { p.updatedAt = Date.now(); GASMV = true; } }); });
    if (!S.placeId || !place(S.placeId)) { var f = places()[0]; S.placeId = f.id; S.meter = f.meter || S.meter || null; S.baseline = f.baseline || S.baseline || null; }
  }
  /** Перенести текущие S.meter/S.baseline в запись активной квартиры (перед сохранением). */
  function syncPlace() {
    ensurePlaces(); var p = place();
    if (JSON.stringify(p.meter || null) !== JSON.stringify(S.meter || null) || JSON.stringify(p.baseline || null) !== JSON.stringify(S.baseline || null)) { p.meter = S.meter || null; p.baseline = S.baseline || null; p.updatedAt = Date.now(); }
  }
  /** Имя квартиры: своё название («Моя», «Мамина»), иначе адрес, иначе «Квартира N». Адрес — второй строкой, если есть имя. */
  // без назви перша — «Моя квартира», інші — «Квартира N»; адреса — завжди окремим рядком
  function placeLabel(p) { var i = places().indexOf(p); return (p && p.name) || (i <= 0 ? t('pl_mine') : t('pl_unnamed', { n: i + 1 })); }
  function placeSub(p) { return (p && p.address) || ''; }
  // цвет-метка квартиры (вдобавок к названию, не вместо него): ключ в place.color, по умолчанию — по порядку
  var PCOLORS = ['teal', 'violet', 'amber', 'green', 'rose', 'slate'];
  function placeColor(p) { return p && PCOLORS.indexOf(p.color) >= 0 ? p.color : PCOLORS[Math.max(0, places().indexOf(p)) % PCOLORS.length]; }
  function nextColor() { var used = places().map(placeColor); return PCOLORS.filter(function (c) { return used.indexOf(c) < 0; })[0] || PCOLORS[places().length % PCOLORS.length]; }
  /** Где я: шапка квартиры (имя + адрес + цветная полоса) — когда квартир больше одной. compact — на экранах ввода, без перехода. */
  function placeBar(compact) {
    var ps = places(), p = place(); if (ps.length < 2 || !p) return '';
    var sub = placeSub(p);
    if (compact) return '<div class="place-bar compact" style="--pc:var(--pc-' + placeColor(p) + ')" data-key="place-bar"><span class="small muted">' + esc(t('pb_where')) + '</span><b>' + esc(placeLabel(p)) + '</b>' + (sub ? '<span class="small muted pb-sub">' + esc(sub) + '</span>' : '') + '</div>';
    return '<div class="place-bar" style="--pc:var(--pc-' + placeColor(p) + ')" data-key="place-bar"><a class="pb-name" href="#home" data-key="place-bar-name" title="' + esc(t('pv_back_all')) + '"><b>' + esc(placeLabel(p)) + '</b>' + (sub ? '<span class="small muted">' + esc(sub) + '</span>' : '') + '</a>' +
      '<a class="btn sec pb-all" href="#home" data-key="place-bar-all">' + ico('back', 18) + '<span>' + esc(t('pv_back_all')) + '</span></a></div>';
  }
  /** История, статистика, экономия при ≥ 2 квартирах: чья — видно сразу и меняется тут же (кнопки с названием и цветом, не список). */
  function placeSwitch() {
    var ps = places(), cur = place(); if (ps.length < 2 || !cur) return '';
    return '<div class="place-sw" role="group" aria-label="' + esc(t('pb_where')) + '" data-key="place-switch"><span class="small muted ps-lbl">' + esc(t('pb_where')) + '</span><div class="ps-btns">' + ps.map(function (p) {
      return '<button type="button" data-act="place-view" data-id="' + esc(p.id) + '" aria-pressed="' + (p.id === cur.id) + '" style="--pc:var(--pc-' + placeColor(p) + ')" data-key="place-sw-' + esc(p.id) + '"><span class="pdot" aria-hidden="true"></span><span>' + esc(placeLabel(p)) + '</span></button>';
    }).join('') + '</div></div>';
  }
  function switchPlace(id) {
    syncPlace(); var p = place(id); if (!p || id === S.placeId) return;
    S.placeId = id; S.meter = p.meter || null; S.baseline = p.baseline || null; S.draft = null; S.focusId = null; save();
  }
  /** Выполнить fn в контексте другой квартиры (статусы для списка квартир) — ничего не сохраняя и не переключая. */
  function withPlace(id, fn) {
    syncPlace(); var p = place(id); if (!p) return null;
    var keep = [S.placeId, S.meter, S.baseline];
    S.placeId = id; S.meter = p.meter || null; S.baseline = p.baseline || null;
    try { return fn(p); } finally { S.placeId = keep[0]; S.meter = keep[1]; S.baseline = keep[2]; }
  }
  /** «Не та квартира»: число v странное для своего счётчика вида kind ('heat' | 'hot' | 'cold'), но похоже на показания
   *  такого же счётчика другой квартиры (чуть больше её последних). → {p: название, v: её последние} или null. */
  function otherPlaceLike(kind, v, date, zone) {
    if (v === null || v === undefined || isNaN(v) || places().length < 2) return null;
    var best = null;
    places().forEach(function (p) {
      if (p.id === S.placeId) return;
      withPlace(p.id, function () {
        var cand = [];
        if (kind === 'heat') {
          if (!hasHeat()) return;
          var lr = RD().filter(function (r) { return r.htm && R.num(r.htm.energy) !== null; }).slice(-1)[0], bs = S.baseline;
          var src = lr && (!bs || lr.htm.date >= bs.date) ? { q: R.num(lr.htm.energy), d: lr.htm.date } : bs && R.num(bs.energy) !== null ? { q: R.num(bs.energy), d: bs.date } : null;
          if (src) cand.push({ q: src.q, days: Math.max(1, R.daysBetween(src.d, date)), max: 15, txt: R.formatForHtm('energy', src.q) });
        } else if (SK[kind]) smeters(kind).forEach(function (m) {
          var r = mrecs(m.id).filter(function (x) { return x.date <= date; }).slice(-1)[0], q = r ? El.whole(r.z && r.z[zone]) : null; if (q === null) return;
          cand.push({ q: q, days: Math.max(1, R.daysBetween(r.date, date)), perMonth: SK[kind].mod.JUMP, txt: String(q) });
        });
        else wmeters(kind).forEach(function (m) {
          var r = wprevFor(m.id, date), q = r ? Number(Wt.norm(r.vals[m.id])) : NaN; if (!r || isNaN(q)) return;
          cand.push({ q: q, days: Math.max(1, R.daysBetween(r.date, date)), perMonth: 25, txt: String(Wt.whole(r.vals[m.id])) });
        });
        cand.forEach(function (c) {
          var dv = v - c.q; if (dv < 0) return;
          if (c.max !== undefined ? dv > c.max : dv / c.days * 30 > c.perMonth) return;
          if (!best || dv < best.dv) best = { dv: dv, p: placeLabel(p), v: c.txt };
        });
      });
    });
    return best;
  }
  /** Главная: при двух и больше квартирах — список квартир (#places), иначе — счётчики квартиры (#home). */
  function homeRoute() { return 'home'; }
  function persist() { memory = S; try { window.localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* только память */ } }
  var lastSig = '', pendingRender = false;
  /** Сохранить: локально всегда; если изменились синхронизируемые данные — отметить время и отправить на другие устройства. */
  function save() {
    syncPlace(); visitBump(); jrSaved();
    // язык напоминаний бота — как в интерфейсе (сервер шлёт на нём)
    if (!S.remind || S.remind.lang !== S.lang) S.remind = Object.assign({}, S.remind || {}, { lang: S.lang });
    var Y = window.TeploSync;
    if (Y) { var sg = Y.sig(Y.payload(S)); if (sg !== lastSig) { lastSig = sg; S.updatedAt = Date.now(); persist(); Y.push(); return; } }
    persist();
  }
  /** Пришли данные с другого устройства (уже слитые с локальными). */
  function applyRemote(m) {
    var keep = { lang: S.lang, demoToday: S.demoToday, focusId: S.focusId, _pickModel: S._pickModel, syncPromptDismissed: S.syncPromptDismissed, placeId: S.placeId, theme: S.theme, view: S.view, homeOpen: S.homeOpen };
    S = Object.assign(defaults(), m, keep);
    ensurePlaces(); var ap = place(); if (ap && (ap.meter || ap.baseline || S.places.length > 1)) { S.meter = ap.meter || null; S.baseline = ap.baseline || null; }
    lastSig = window.TeploSync.sig(window.TeploSync.payload(S)); persist();
    // кнопка з нагадування відкрилась до входу — тепер квартири є: у потрібну квартиру й лічильник
    if (DEEP && S.onboarded) { var dp = DEEP; DEEP = null; deepLink(dp.g, dp.pid, dp.q); }
    safeRender();
    if (GASMV) { GASMV = false; save(); }
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
  if (GASMV) setTimeout(function () { GASMV = false; save(); }, 0);
  // S.meter/S.baseline — зеркало текущей квартиры: при запуске берём из неё (не из того, что лежало сверху)
  (function () { var ap = place(); if (ap && places().length > 1) { S.meter = ap.meter || null; S.baseline = ap.baseline || null; } })();
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
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>', arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
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
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    bill: '<path d="M6 3h12v18l-2.5-1.6L13 21l-2-1.6L9 21l-3-1.8z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
    edit: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    wrench: '<path d="M14.5 5.5a4 4 0 0 0 4.9 4.9l-8.9 8.9a2 2 0 0 1-2.8-2.8l8.9-8.9a4 4 0 0 0-2.1-2.1z"/><path d="M14.5 5.5L17 3l2.5 2.5"/>',
    phone: '<path d="M5 4h4l1.5 4.5-2.5 1.5a11 11 0 0 0 6 6l1.5-2.5L20 15v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
    send: '<path d="M21 3L3 10.5l7 2.5 2.5 7z"/><path d="M10 13l11-10"/>',
    bolt: '<path d="M13 3L5.5 13.5H11L10 21l7.5-10.5H12z"/>'
  };
  function ico(name, size, cls) {
    return '<svg class="ico ' + (cls || '') + '" width="' + (size || 24) + '" height="' + (size || 24) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  }
  function logo() {
    // крапля: ліва половина — гаряче (тепло, гаряча вода), права — холодне; стрілка — лічильник
    return '<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M14 3C11 7.5 6.5 12.5 6.5 17.5A7.5 7.5 0 0 0 14 25" style="stroke:var(--c-supply)"/><path d="M14 3c3 4.5 7.5 9.5 7.5 14.5A7.5 7.5 0 0 1 14 25" style="stroke:var(--c-return)"/>' +
      '<path d="M14 18l3.6-3.6" stroke="currentColor" stroke-width="2.2"/><circle cx="14" cy="18" r="1.6" fill="currentColor" stroke="none"/></svg>';
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

  /** Табло водоміра: циферблат з кільцем кольору виду, вікно з роликами — 5 чорних (цілі м³, нулі попереду) і 3 червоні
   *  (літри; не записані — порожні). v — показання (рядок/число) або null — тоді прочерки. cls: hero | card | sm. */
  function wdrum(v, kind, cls) {
    var s = v === null || v === undefined ? '' : String(v).replace(',', '.').replace(/\s/g, ''), m = s.match(/^(\d+)(?:\.(\d*))?$/);
    var ip = m ? m[1].replace(/^0+(?=\d)/, '') : '', fp = m ? (m[2] || '').slice(0, 3) : '';
    var black = ip ? (ip.length < 5 ? '00000'.slice(ip.length) + ip : ip).split('') : '-----'.split('');
    var aria = ip ? (+ip) + (fp && +fp ? ',' + fp : '') + ' м³' : '—';
    var win = '<span class="wd-win">' + black.map(function (d) { return '<span class="wd-c">' + d + '</span>'; }).join('') +
      [0, 1, 2].map(function (i) { return '<span class="wd-c r">' + (fp[i] || '') + '</span>'; }).join('') + '</span>';
    // газ — не круглий циферблат, а жовта прямокутна панель лічильника (G4, полум'я) з тим самим вікном роликів
    if (kind === 'gas') return '<div class="gdrum' + (cls ? ' ' + cls : '') + '" role="img" aria-label="' + esc(aria) + '"><span class="gd-side" aria-hidden="true">' + ico('flame', 18) + '<span class="gd-g">G4</span></span>' + win + '<span class="wd-u">м³</span></div>';
    return '<div class="wdrum ' + (kind === 'hot' ? 'hot' : 'cold') + (cls ? ' ' + cls : '') + '" role="img" aria-label="' + esc(aria) + '">' + win + '<span class="wd-u">м³</span></div>';
  }
  /** Табло електролічильника: темний електронний екран зі світлими сегментами (на відміну від зеленого ЖК тепла),
   *  угорі — мітка зони/«kWh» і червоний світлодіод імпульсів. lines: [{text, zone, label}] — по рядку на зону. */
  function elcd(lines, cls) {
    return '<div class="lcd elcd ' + (cls || '') + '"><div class="el-hd" aria-hidden="true"><span class="el-led"></span><span class="el-imp">imp</span><span class="el-u">kWh</span></div>' + lines.map(function (ln) {
      return '<div class="line">' + (ln.zone ? '<span class="el-z">' + esc(ln.zone) + '</span>' : '') + segSvg(ln.text, ln.label) + '</div>';
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
  /** Останні прийняті ХТМ: найпізніші серед «Останніх прийнятих» (S.baseline, з кабінету) і показань зі статусом «прийнято» в історії.
   *  Раніше бралось лише S.baseline — табло й перевірка «як робот ХТМ» відставали від історії (у власника: 20.11.2025 при прийнятих 23.03.2026). */
  function lastAccepted() {
    var b = S.baseline && S.baseline.date ? Object.assign({ src: 'base' }, S.baseline) : null;
    RD().forEach(function (r) { if (r.own || r.status !== 'accepted' || !r.htm || !r.htm.date) return; if (!b || r.htm.date > b.date) b = Object.assign({}, r.htm, { src: 'rec', id: r.id }); });
    return b;
  }
  function prevForEntry() {
    var la = lastAccepted(); if (!la) return null;
    var p = Object.assign({}, la), k = M.TO_GCAL[energyUnit()] || 1, e = R.num(p.energy); delete p.src; delete p.id;
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
    if (res.items.some(function (x) { return x.code === 'R_MONO_ENERGY' || x.code === 'R_ENERGY_JUMP'; })) {
      var oth = otherPlaceLike('heat', R.num(draftReadingGcal(d).energy), d.date || today());
      if (oth) {
        var fill = function (lg, k) { return I.T[lg][k].replace(/\{(\w+)\}/g, function (m0, n) { return { p: oth.p, v: oth.v, c: placeLabel(place()) }[n]; }); };
        res.items.unshift({ code: 'X_OTHER_PLACE', level: 'warn', field: 'energy', msg: { uk: fill('uk', 'c_other_place'), ru: fill('ru', 'c_other_place') }, fix: { uk: fill('uk', 'c_other_place_fix'), ru: fill('ru', 'c_other_place_fix') } });
        if (res.verdict === 'ok') res.verdict = 'warn';
      }
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
    var navItems = [[homeRoute(), 'home', 'nav_home'], ['history', 'history', 'nav_history'], ['stats', 'chart', 'nav_stats']].concat([['save', 'leaf', 'nav_save'], ['help', 'help', 'nav_help'], ['prefs', 'prefs', 'nav_prefs']]);
    var nav = bare ? '' : '<nav class="nav" style="--nav-n:' + navItems.length + '" aria-label="' + esc(t('brand')) + '">' + navItems.map(function (n) {
      return '<a href="#' + n[0] + '"' + (route === n[0] || (n[2] === 'nav_home' && /^(home|heat|water-|elec$|gas$|places|place$)/.test(route)) ? ' aria-current="page"' : '') + ' data-key="nav-' + (n[2] === 'nav_home' ? 'home' : n[0]) + '">' + ico(n[1], 22) + '<span>' + esc(t(n[2])) + '</span></a>';
    }).join('') + '</nav>';
    var right = bare && view.closeTo
      ? '<a class="btn ghost" href="#' + view.closeTo + '" data-key="wiz-close" aria-label="' + esc(t('close')) + '">' + ico('close', 22) + '<span class="cl-txt">' + esc(t('close')) + '</span></a>'
      : '';
    return '<div class="app' + (bare ? ' bare-app' : '') + '">' +
      '<header class="top' + (right ? ' has-close' : '') + '"><a class="brand" href="#' + homeRoute() + '" data-key="brand">' + logo() + '<span>' + esc(t('brand')) + '</span></a>' + '<span class="spacer"></span>' + themeBtn() + right + '</header>' +
      nav + '<main class="main' + (bare ? ' bare' : '') + (view.wide ? ' wide' : '') + '" id="main" data-screen="' + view.screen + '" tabindex="-1">' + (/^(history|stats|save)$/.test(route) ? placeSwitch() : /^(heat|water-hot|water-cold|elec|gas)$/.test(route) ? placeBar() : /^(wnew|wadd|enew|eadd|gnew|gadd|add-meter|step|step-\d+|check|handover|baseline|meter|photo)$/.test(route) ? placeBar(true) : '') + view.html + '</main></div>' +
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

  // ---------------- экраны ----------------
  var V = {};

  // ================= ВОДА: водомеры квартиры, показания, передача =================
  var Wt = window.TeploWater;
  function wcfg() { var p = place(); return (p && p.water) || { account: '', surname: '', meters: [] }; }
  function wsetCfg(fn) { ensurePlaces(); var p = place(); p.water = JSON.parse(JSON.stringify(wcfg())); fn(p.water); p.updatedAt = Date.now(); save(); }
  /** Водомеры квартиры. Прибранные (m.removed — дата) — только с all: их история остаётся в Історії/Статистиці. */
  function wmeters(kind, all) { return byKind((wcfg().meters || []).filter(function (m) { return m && !m.deleted && (all || !m.removed) && (!kind || m.kind === kind); })); }
  function wrecs() { return (S.water || []).filter(function (r) { return r && !r.deleted && r.place === S.placeId; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.base ? -1 : b.base ? 1 : 0; }); }
  /** Последние внесённые показания (стартовые при настройке — не в счёт: их не передают). */
  function wlast() { var a = wrecs().filter(function (r) { return !r.base && !r.own; }); return a.length ? a[a.length - 1] : null; }
  // «лише для себе» (r.own): показання для статистики — нікуди не передаються; оплата — між переданими показаннями.
  // Стартові (r.base) води/світла/газу вважаємо переданими (так найчастіше), поки людина не зніме позначку (sent.no).
  function baseSent(r) { return !!(r && r.base && !(r.sent && r.sent.no)); }
  function ownPill() { return '<span class="pill own" data-key="own-pill">' + esc(t('own_pill')) + '</span>'; }
  function basePill(r) { return baseSent(r) ? '<span class="pill ok">' + esc(t('wh_sent')) + '</span>' : ''; }
  /** Переданий запис після «для себе»: від якої передачі рахується оплата. list — записи за датою, has(r) — є значення. */
  function paidFrom(list, r, has) {
    var prev = null, own = 0;
    list.forEach(function (x) { if (x === r || x.date > r.date || (x.date === r.date && !x.base)) return; if (!has(x)) return; if (x.own) own++; else { prev = x; own = 0; } });
    return prev && own ? { date: prev.date, n: own } : null;
  }
  /** Перемикачі в картці запису: «лише для себе» (звичайні) і «передано» (стартові). src: w | m | h. */
  function ownBox(src, r) {
    if (r.base) return '<div class="own-box" data-key="base-sent-box"><p>' + (baseSent(r) ? '<span class="pill ok">' + ico('check', 14) + ' ' + esc(t('bs_sent')) + '</span> <button class="linkbtn" data-act="base-sent" data-src="' + src + '" data-id="' + esc(r.id) + '" data-v="0" data-key="base-unsent">' + esc(t('bs_unsent')) + '</button>'
      : '<button class="btn sec" data-act="base-sent" data-src="' + src + '" data-id="' + esc(r.id) + '" data-v="1" data-key="base-mark">' + ico('check', 18) + '<span>' + esc(t('bs_mark')) + '</span></button>') + '</p><p class="small muted">' + esc(t('bs_lead')) + '</p></div>';
    return '<div class="own-box' + (r.own ? ' on' : '') + '" data-key="own-box">' + (r.own ? '<p>' + ownPill() + ' ' + esc(t('own_on')) + '</p><p><button class="btn sec" data-act="own" data-src="' + src + '" data-id="' + esc(r.id) + '" data-v="0" data-key="own-unset">' + esc(t('own_unset')) + '</button></p>'
      : '<p><button class="linkbtn" data-act="own" data-src="' + src + '" data-id="' + esc(r.id) + '" data-v="1" data-key="own-set">' + esc(t('own_set')) + '</button></p>') + '</div>';
  }
  function ownField() {
    return '<label class="check-row own-chk"><input type="checkbox" id="own-chk" data-key="own-chk"><span><b>' + esc(t('own_chk')) + '</b><br><span class="small muted">' + esc(t('own_chk_s')) + '</span></span></label>';
  }
  function ownChecked() { var c = document.getElementById('own-chk'); return !!(c && c.checked); }
  /** Прошлое показание водомера (до даты). Знімали лічильник після нього: поставили й показання відомі — вони (запис-«замінник»
   *  з gap); новий лічильник без відомих показань — для перевірки null (порівнювати нема з чим), для табло — останнє старе. */
  function wprevFor(mid, beforeDate) {
    var a = wrecs().filter(function (r) { return r.vals && r.vals[mid] !== undefined && r.vals[mid] !== '' && (!beforeDate || r.date < beforeDate || (r.base && r.date === beforeDate)); }), r = a.length ? a[a.length - 1] : null;
    var g = gaps(mid).filter(function (x) { return (!r || x.from >= r.date) && (!beforeDate || x.from < beforeDate); }).slice(-1)[0];
    if (!g) return r;
    if (g.to && (!beforeDate || g.to <= beforeDate) && Wt.num(g.vTo) !== null) { var v = {}; v[mid] = g.vTo; return { id: 'gap-' + g.id, date: g.to, vals: v, gap: g }; }
    return g.fresh && beforeDate ? null : r;
  }
  /** Показание воды для показа: «458,87» (литры — если записаны). */
  function wfmt(v) { var n = Wt.norm(v); return n === null ? String(v == null ? '' : v) : n.replace('.', ','); }
  function wname(m) { return (m.kind === 'hot' ? t('wt_hot') : t('wt_cold')) + (m.name ? ' · ' + m.name : ''); }
  function wkindTitle(k) { return k === 'hot' ? t('wt_hot_t') : t('wt_cold_t'); }
  function thisMonth(d) { return String(d || '').slice(0, 7) === today().slice(0, 7); }
  function wsentVk(r) { return r && r.sent && r.sent.vk; }
  function wsentHtm(r) { return r && r.sent && r.sent.htm; }
  var WICO = { hot: 'drop', cold: 'drop' };

  // ================= виды счётчиков квартиры (реестр) =================
  // Хранение прежнее (старые клиенты и синхронизация): тепло — place.meter (S.meter), вода — place.water.meters.
  // Прибрать счётчик = пометка removed (дата): с главной и из ввода уходит, история остаётся; «Повернути» снимает пометку.
  // gas/elec — пока «скоро» (место в выборе есть, данных нет).
  var KINDS = {
    heat: { icon: 'thermo', cls: 'c-heat', t: 'kd_heat', s: 'kd_heat_s', max: 1 },
    hot: { icon: 'drop', cls: 'c-hot', t: 'kd_hot', s: 'kd_hot_s', max: 4 },
    cold: { icon: 'drop', cls: 'c-cold', t: 'kd_cold', s: 'kd_cold_s', max: 4 },
    gas: { icon: 'flame', cls: 'c-gas', t: 'kd_gas', s: 'kd_gas_s', max: 2 },
    elec: { icon: 'bolt', cls: 'c-elec', t: 'kd_elec', s: 'kd_elec_s', max: 2 }
  };
  // Один порядок видов везде и во всех квартирах (владелец 05.11): опалення, гаряча, холодна, світло, газ —
  // главная, экран квартиры (счётчики, «Постачальники й тарифи», рахунки, прибрані), вкладки, мастера.
  var KIND_ORDER = ['heat', 'hot', 'cold', 'elec', 'gas'];
  function kindRank(k) { var i = KIND_ORDER.indexOf(k === 'water' ? 'hot' : k); return i < 0 ? 99 : i; }
  /** Счётчики по порядку видов; внутри вида — как добавляли (сортируем копию, хранение не трогаем). */
  function byKind(a) { return a.map(function (m, i) { return [m, i]; }).sort(function (x, y) { return kindRank(x[0].kind) - kindRank(y[0].kind) || x[1] - y[1]; }).map(function (x) { return x[0]; }); }
  function hasHeat() { return !!(S.meter && !S.meter.removed); }
  /** Есть ли хоть один счётчик в любой квартире (вход на новом устройстве: уже настроен — сразу на главную). */
  function anyMeters() {
    var live = function (m) { return m && !m.deleted && !m.removed; };
    return hasHeat() || places().some(function (p) { return live(p.meter) || ((p.water || {}).meters || []).some(live) || (p.meters || []).some(live); });
  }
  function kindCount(k) { return k === 'heat' ? (hasHeat() ? 1 : 0) : KINDS[k].soon ? 0 : k === 'elec' || k === 'gas' ? pmeters(k).length : wmeters(k).length; }
  function meterTitle(what) { if (what === 'heat') return t('kd_heat'); var pm = pmeters(null, true).filter(function (x) { return x.id === what; })[0]; if (pm) return ename(pm); var m = wmeters(null, true).filter(function (x) { return x.id === what; })[0]; return m ? wname(m) : ''; }
  /** Есть ли у счётчика записи (тогда «прибрати» — в архив, иначе — удалить совсем). */
  function meterHasData(what) {
    if (what === 'heat') return RD().length > 0 || gaps('heat').length > 0;
    if (pmeters(null, true).some(function (x) { return x.id === what; })) return mrecs(what).length > 0;
    return wrecs().some(function (r) { return hasVal(r, what); }) || gaps(what).length > 0;
  }
  /** Прибрать счётчик из квартиры (what — 'heat' или id водомера). */
  function meterRemove(what) {
    var keep = meterHasData(what), d = today();
    if (what === 'heat') {
      if (keep) S.meter = Object.assign({}, S.meter, { removed: d }); else S.meter = null;
      S.draft = null; save(); return;
    }
    if (pmeters(null, true).some(function (x) { return x.id === what; })) { setPMeters(function (list) { list.forEach(function (m) { if (m.id === what) { if (keep) m.removed = d; else m.deleted = true; } }); }); return; }
    wsetCfg(function (c) { (c.meters || []).forEach(function (m) { if (m.id === what) { if (keep) m.removed = d; else m.deleted = true; } }); });
  }
  function meterRestore(what) {
    if (what === 'heat') { if (S.meter) { S.meter = Object.assign({}, S.meter); delete S.meter.removed; save(); } return; }
    if (pmeters(null, true).some(function (x) { return x.id === what; })) { setPMeters(function (list) { list.forEach(function (m) { if (m.id === what) delete m.removed; }); }); return; }
    wsetCfg(function (c) { (c.meters || []).forEach(function (m) { if (m.id === what) delete m.removed; }); });
  }
  /** Прибранные счётчики квартиры (для «Повернути»). */
  function removedMeters() {
    var a = []; if (S.meter && S.meter.removed) a.push({ what: 'heat', kind: 'heat', title: t('kd_heat'), at: S.meter.removed });
    wmeters(null, true).filter(function (m) { return m.removed; }).forEach(function (m) { a.push({ what: m.id, kind: m.kind, title: wname(m), at: m.removed }); });
    pmeters(null, true).filter(function (m) { return m.removed; }).forEach(function (m) { a.push({ what: m.id, kind: m.kind, title: ename(m), at: m.removed }); });
    return byKind(a);
  }

  // ================= лічильник знімали: ремонт, повірка, заміна (тепло й кожен водомір) =================
  // place.gaps = [{id, what: 'heat' | id водоміра, from, to ('' — ще без лічильника), reason: repair|verify|replace|other,
  //   vFrom / vTo — показання при знятті й після встановлення (необов'язкові), fresh — новий лічильник (лічба з нуля),
  //   pay: area|avg|norm|unknown — як рахували без лічильника, amount — грн на місяць, note, updatedAt, deleted}]
  // Через період без лічильника розхід не рахується: від показань після встановлення (невідомі — проміжок пропускаємо).
  function gaps(what) { var p = place(); return ((p && p.gaps) || []).filter(function (g) { return g && !g.deleted && g.from && (!what || g.what === what); }).sort(function (a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : 0; }); }
  function gapById(id) { var p = place(); return ((p && p.gaps) || []).filter(function (g) { return g && !g.deleted && g.id === id; })[0] || null; }
  function openGap(what) { return gaps(what).filter(function (g) { return !g.to || g.to > today(); }).slice(-1)[0] || null; }
  function setGaps(fn) { ensurePlaces(); var p = place(); p.gaps = JSON.parse(JSON.stringify(p.gaps || [])); fn(p.gaps); p.updatedAt = Date.now(); save(); }
  function gapKind(g) { if (g.what === 'heat') return 'heat'; var m = (wcfg().meters || []).filter(function (x) { return x.id === g.what; })[0]; return m ? m.kind : null; }
  function gapMeterName(g) { if (g.what === 'heat') return t('uc_heat'); var m = (wcfg().meters || []).filter(function (x) { return x.id === g.what; })[0]; return m ? wname(m) : '—'; }
  function gapUnit(g) { return g.what === 'heat' ? 'Гкал' : 'м³'; }
  function gapFmt(g, v) { var n = R.num(v); return n === null ? '' : g.what === 'heat' ? R.formatForHtm('energy', v) : String(Wt.whole(v)); }
  /** Скільки місяців без лічильника (для суми оплат): від дати зняття до встановлення або сьогодні. */
  function gapMonths(g) { var d = R.daysBetween(g.from, g.to && g.to < today() ? g.to : today()); return Math.max(0, d) / (365.25 / 12); }
  /** Як рахують без лічильника за правилами: повірка — за середнім; поломка/заміна/інше — як без обліку (тепло за площею, вода за нормою). */
  function gapPayDefault(g) { return g.reason === 'verify' ? 'avg' : g.what === 'heat' ? 'area' : 'norm'; }
  /** Оцінка тепла/води й грошей за період без лічильника (stats.gapHeat / water.gapWater). */
  function gapEst(g) {
    if (!g || !g.from) return null;
    if (g.what === 'heat') return window.TeploStats ? TeploStats.gapHeat(g, TeploStats.intervals(RD(), S.baseline, null, tariff(), gaps('heat').filter(function (x) { return x.id !== g.id; }).concat([g])), { today: today(), tariff: tariff() }) : null;
    var m = wmeters(null, true).filter(function (x) { return x.id === g.what; })[0], c = wcfg();
    return m ? Wt.gapWater(g, wrecs(), m, { today: today(), custom: wtar(), persons: c.persons, cfg: c }) : null;
  }
  function monthLabel(ym) { try { return new Date(ym + '-15T12:00:00Z').toLocaleDateString(S.lang === 'ru' ? 'ru-RU' : 'uk-UA', { month: 'long', year: 'numeric' }).replace(/\s*(р\.|г\.)$/, ''); } catch (e) { return ymLabel(ym); } }
  /** Блок «Скільки це коштувало» у формі періоду: правило, підсумок, по місяцях, порівняння з платіжкою. */
  function gapEstBox(g) {
    var e = gapEst(g), heat = g.what === 'heat', pay = g.pay || gapPayDefault(g), h = '<div class="panel" id="gp-est" data-key="gap-est" aria-live="polite"><h2>' + esc(t('ge_title')) + '</h2>';
    if (!e) return h + '<p class="small muted">' + esc(t('ge_need_from')) + '</p></div>';
    var kind = gapKind(g) || 'cold', unit = heat ? 'Гкал' : 'м³', amount = R.num(g.amount), mo = e.days / (365.25 / 12);
    h += '<p class="small">' + esc(t(heat ? 'ge_rule_' + (pay === 'avg' ? 'avg' : pay === 'area' ? 'area' : 'unk') + '_h' : 'ge_rule_' + (pay === 'avg' ? 'avg' : pay === 'norm' ? 'norm' : 'unk') + '_w')) + '</p>';
    var need = heat ? (e.basis === 'none' ? t('ge_need_heat') : '') : e.need === 'persons' ? t('ge_need_persons') : e.need === 'history' ? t('ge_need_hist') : '';
    if (need) return h + '<div class="banner warn">' + ico('info', 20) + '<div><p>' + esc(need) + '</p>' + (e.need === 'persons' ? '<p><a href="#prefs" data-act="to-nometer" data-key="ge-to-prefs">' + esc(t('ge_to_prefs')) + '</a></p>' : '') + '</div></div></div>';
    var q = heat ? e.gcal : e.m3;
    h += '<div class="cards2 stat-tiles"><div><div class="num big">≈ ' + esc(fmtN(q, heat ? 3 : 1)) + ' <span class="small">' + unit + '</span></div><div class="small muted">' + esc(heat ? t(e.heatDays === e.days ? 'ge_t_heat_all' : 'ge_t_heat', { d: e.heatDays, n: e.days }) : t('ge_t_water', { n: e.days })) + '</div></div>' +
      '<div><div class="num big">≈ ' + esc(money(e.cost)) + ' <span class="small">грн</span></div><div class="small muted">' + esc(heat ? t('ge_t_price_h', { p: money(e.tariff) }) : t(kind === 'hot' ? 'ge_t_price_hot' : 'ge_t_price_cold')) + '</div></div>' +
      '<div><div class="num big">' + esc(fmtN(e.perMonth, heat ? 3 : 1)) + ' <span class="small">' + unit + '/' + esc(t('ge_mo')) + '</span></div><div class="small muted">' + esc(heat ? t('ge_t_avg_h') : t('ge_t_avg_w')) + '</div></div></div>';
    if (heat) h += '<p class="small muted">' + esc(e.basis === 'prev' ? t('ge_basis_prev', { s: e.season + '/' + String(e.season + 1).slice(2), d: fmtN(e.avg, 4) }) : t('ge_basis_recent', { d: fmtN(e.avg, 4) })) + (e.heatDays ? '' : ' ' + esc(t('ge_noheat'))) + '</p>';
    else h += '<p class="small muted">' + esc(e.method === 'avg' ? t('ge_basis_w', { a: fmtDate(e.base.from, true), b: fmtDate(e.base.to, true), d: fmtN(e.perDay, 3) }) : t('ge_basis_norm', { n: fmtN(kind === 'hot' ? e.norm.hot : e.norm.cold, 2), p: e.persons })) + '</p>';
    h += '<div class="tbl-wrap"><table class="tbl" data-key="gap-est-tbl"><thead><tr><th>' + esc(t('ge_c_month')) + '</th><th class="num">' + esc(t('ge_c_days')) + '</th><th class="num">' + unit + '</th><th class="num">грн</th></tr></thead><tbody>' +
      e.rows.map(function (r) { return '<tr><td>' + esc(monthLabel(r.ym)) + '</td><td class="num">' + (heat ? r.days + (r.heatDays !== r.days ? ' <span class="muted">(' + r.heatDays + ')</span>' : '') : r.days) + '</td><td class="num">' + esc(fmtN(heat ? r.gcal : r.m3, heat ? 3 : 2)) + '</td><td class="num">' + esc(money(r.cost)) + '</td></tr>'; }).join('') +
      (e.rows.length > 1 ? '<tr><td><b>' + esc(t('ge_c_total')) + '</b></td><td class="num"><b>' + e.days + (heat && e.heatDays !== e.days ? ' <span class="muted">(' + e.heatDays + ')</span>' : '') + '</b></td><td class="num"><b>' + esc(fmtN(q, heat ? 3 : 2)) + '</b></td><td class="num"><b>' + esc(money(e.cost)) + '</b></td></tr>' : '') + '</tbody></table></div>';
    var notes = heat && e.rows.some(function (r) { return r.heatDays !== r.days; }) ? [t('ge_c_heatnote')] : [];
    notes.push(t('ge_months', { n: e.rows.length, m: e.rows.map(function (r) { return monthLabel(r.ym); }).join(', ') }));
    if (heat) notes.push(t('ge_abon', { a: money(bill().abon) }));
    if (!heat && kind === 'hot') notes.push(t('ge_split', { vk: money(e.vk), htm: money(e.htm) }));
    if (e.open) notes.push(t('ge_open'));
    if (amount !== null && amount > 0) {
      var paid = amount * mo;
      notes.push(t('ge_paid', { a: money(amount), n: fmtN(mo, 1), s: money(paid), d: (paid >= e.cost ? '+' : '−') + money(Math.abs(paid - e.cost)) }));
      if (heat) { var ar = R.num(place() && place().area); notes.push(t('ge_paid_h', { g: fmtN(amount / tariff(), 3), p: money(tariff()) }) + (ar ? ' ' + t('ge_paid_m2', { m: money(amount / ar), a: fmtN(ar, 1) }) : '')); }
    }
    if (heat && pay === 'area' && !(R.num(place() && place().area))) notes.push(t('ge_area_hint'));
    return h + notes.map(function (x) { return '<p class="small muted">' + esc(x) + '</p>'; }).join('') + '<p class="small muted">' + esc(t('ge_disclaimer')) + '</p></div>';
  }
  function gapPeriod(g) { return fmtDate(g.from, true) + ' — ' + (g.to ? fmtDate(g.to, true) : t('gp_now')); }
  /** Рядок історії: період без лічильника. */
  function gapItem(g, withName) {
    var e = gapEst(g), heat = g.what === 'heat', amt = R.num(g.amount), mo = gapMonths(g), qv = e ? (heat ? e.gcal : e.m3) : 0;
    var bits = [t('gp_row') + (withName ? ' · ' + gapMeterName(g) : '')];
    if (R.num(g.vFrom) !== null) bits.push(t('gp_at_off', { v: gapFmt(g, g.vFrom), u: gapUnit(g) }));
    if (g.to && R.num(g.vTo) !== null) bits.push(t(g.fresh ? 'gp_at_new' : 'gp_at_on', { v: gapFmt(g, g.vTo), u: gapUnit(g) }));
    else if (g.fresh) bits.push(t('gp_new'));
    var pt = t('gp_pay_' + (g.pay || 'unknown') + (heat ? '_h' : '_w')); bits.push(pt.charAt(0).toLowerCase() + pt.slice(1));
    bits.push(amt !== null ? t('gp_amount_sum', { a: money(amt), n: fmtN(mo, 1), s: money(amt * mo) }) : qv > 0 ? t('hr_est') : '');
    // крупно — сколько тепла/воды (оценка) и сколько денег: по платёжке, если записано, иначе оценка
    return histRow({ cls: 'gap-row', key: 'gap-' + g.id, href: '#gap-' + g.id, lead: '<span class="hr-ico">' + ico('wrench', 18, 'c-warn') + '</span>',
      q: qv > 0 ? '≈ ' + fmtN(qv, heat ? 3 : 1) : null, unit: gapUnit(g), money: amt !== null ? amt * mo : e && e.cost > 0 ? e.cost : null, none: t('gp_row'), date: gapPeriod(g), sub: bits,
      right: billMark(g.bills) + '<span class="pill ' + (g.to && g.to <= today() ? 'neutral' : 'warn') + '">' + esc(t('gp_r_' + (g.reason || 'other'))) + '</span>' });
  }

  /** Банер на сторінці лічильника: зараз без лічильника → «поставили назад». */
  function gapBanner(what) {
    var g = openGap(what); if (!g) return '';
    return '<div class="banner warn" data-key="gap-open">' + ico('wrench', 22) + '<div><p><b>' + esc(t('gp_open_t', { d: fmtDate(g.from, true), r: t('gp_r_' + (g.reason || 'other')).toLowerCase() })) + '</b></p><p>' + esc(t('gp_pay_' + (g.pay || 'unknown') + (what === 'heat' ? '_h' : '_w'))) + '. ' + esc(t('gp_open_sub')) + '</p>' +
      '<p><a class="btn sec" href="#gap-' + g.id + '" data-key="gap-close">' + esc(t('gp_back_btn')) + '</a></p></div></div>';
  }

  /** Статус тепла текущей квартиры: {st — текст, tone — ok|due|warn|'' , due — дата срока (ISO), если надо передать}. */
  function heatStatus() {
    var last = RD().filter(function (r) { return r.htm && r.htm.date; }).slice(-1)[0], w = R.windowState(today()), gap = openGap('heat'), d25 = dayOfMonth(today(), 25);
    if (gap) return { st: t('gp_card_off', { d: fmtDate(gap.from) }), tone: 'warn', off: true };
    if (last && thisMonth(last.htm.date) && (last.status === 'handed' || last.status === 'accepted')) return { st: last.status === 'accepted' ? t('uc_heat_ok') : t('uc_heat_handed'), tone: 'ok' };
    if (w.state === 'open' || w.state === 'soon_recommended') return { st: t('uc_heat_due', { d: fmtDate(d25) }), tone: 'due', due: d25 };
    if (w.state === 'late' || w.state === 'last_day') return { st: t('uc_heat_late', { d: fmtDate(d25) }), tone: 'warn', due: d25 };
    var hn = w.state === 'closed_before' ? dayOfMonth(today(), 5) : nextMonthDay(today(), 5); return { st: t('uc_heat_closed', { d: fmtDate(hn) }), tone: '', from: hn };
  }
  /** Статус воды вида kind ('hot' | 'cold') текущей квартиры — как heatStatus. */
  function waterStatus(kind) {
    var ms = wmeters(kind), last = wlast(), w = Wt.vkWindow(today()), gap = ms.map(function (m) { return openGap(m.id); }).filter(Boolean)[0];
    var done = last && thisMonth(last.date) && wsentVk(last) && (kind === 'cold' || wsentHtm(last));
    if (gap) return { st: t('gp_card_off', { d: fmtDate(gap.from) }), tone: 'warn', off: true };
    if (done) return { st: t('uc_w_sent'), tone: 'ok' };
    if (last && thisMonth(last.date)) return { st: t('uc_w_ready'), tone: 'due', due: w.open ? w.deadline : null, ready: true };
    if (w.open) return { st: t('uc_w_due', { d: fmtDate(w.deadline) }), tone: w.daysLeft <= 3 ? 'warn' : 'due', due: w.deadline };
    return { st: t('uc_w_next', { d: fmtDate(nextMonthDay(today(), Wt.VK_DEADLINE)) }), tone: '', until: nextMonthDay(today(), Wt.VK_DEADLINE) };
  }
  /** Карточка на главной: табло с последними показаниями, срок, «+» — сразу к вводу. */
  function ucard(o) {
    return '<div class="ucard ucard-' + o.kind + '" data-key="card-' + o.kind + '">' +
      '<a class="ucard-main" href="#' + o.href + '">' +
        '<span class="ucard-top">' + ico(o.icon, 20) + '<span class="ucard-title">' + esc(o.title) + '</span></span>' +
        (o.display ? '<div class="ucard-disp">' + o.display + '</div>' : '<span class="ucard-val num">' + o.value + '</span>') +
        '<span class="ucard-sub">' + esc(o.sub || '') + '</span>' +
        (o.status ? '<span class="ucard-status ' + (o.tone || '') + '">' + esc(o.status) + '</span>' : '') +
      '</a>' +
      '<button type="button" class="ucard-add' + (o.tone === 'warn' ? ' hot' : '') + '" data-act="' + o.addAct + '"' + (o.addKind ? ' data-kind="' + o.addKind + '"' : '') + ' data-key="card-' + o.kind + '-add" aria-label="' + esc(o.addLabel) + '" title="' + esc(o.addLabel) + '">' + ico('plus', 26) + '</button></div>';
  }
  /** Рядок статусу на картці головної: передано / знято — завжди; строк — лише за 4 дні до кінця; «наступна передача» — ні. */
  function cardSt(o) { if (!o) return ''; if (o.off || o.tone === 'ok') return o.st; return dueSoon(o) !== null ? o.st : ''; }
  /** Останні показання передано (владелец 05.11: «если переданы — только надпись, что переданы, без «внесено»»).
   *  Цього місяця — одна зелена «Передано 15 листопада» замість «внесено …» + «Передано цього місяця»; раніше — «передано 15 жовтня»
   *  тихим рядком (поруч може стояти строк нової передачі). o: { sub, status, tone }, d — дата переданих, lbl — свій текст (тепло: «Прийнято ХТМ»). */
  function cardSent(o, d, lbl) {
    if (!d || o.off) return o;
    if ((o.status && o.tone === 'ok') || (!o.status && thisMonth(d))) { o.sub = ''; o.status = t(lbl || 'uc_sent_d', { d: fmtDate(d) }); o.tone = 'ok'; }
    else o.sub = t((lbl || 'uc_sent_d') + '_s', { d: fmtDate(d) });
    return o;
  }
  function heatCard() {
    if (!S.meter) return ucard({ kind: 'heat', href: 'meter', icon: 'thermo', title: t('uc_heat'), display: lcd([{ text: '------', tag: 'Gcal', label: '—' }], 'card empty'), sub: t('uc_heat_setup'), addAct: 'setup-heat', addLabel: t('uc_heat_setup_btn') });
    var last = RD().filter(function (r) { return r.htm && r.htm.date; }).slice(-1)[0], base = S.baseline;
    var src = last && (!base || last.htm.date >= base.date) ? { date: last.htm.date, energy: last.htm.energy, own: true, status: last.status } : base ? { date: base.date, energy: base.energy } : null;
    var hs = heatStatus(), st = cardSt(hs), tone = st ? hs.tone : '';
    var val = src && R.num(src.energy) !== null ? R.formatForHtm('energy', src.energy) : '';
    var o = { sub: src ? (src.own ? t('uc_from_you', { d: fmtDate(src.date) }) : t('uc_from_htm', { d: fmtDate(src.date) })) : t('h_last_none'), status: st, tone: tone, off: hs.off };
    if (src && src.own && (src.status === 'handed' || src.status === 'accepted')) cardSent(o, src.date, src.status === 'accepted' ? 'uc_heat_ok_d' : 'uc_sent_d');
    return ucard({ kind: 'heat', href: 'heat', icon: 'thermo', title: t('uc_heat'),
      display: lcd([{ text: val || '------', tag: 'Gcal', label: val ? val + ' Гкал' : '—' }], 'card'),
      sub: o.sub, status: o.status, tone: o.tone, addAct: 'read', addLabel: t('uc_add_heat') });
  }
  function waterCard(kind) {
    var ms = wmeters(kind), title = wkindTitle(kind);
    if (!ms.length) return ucard({ kind: kind, href: 'water-' + kind, icon: 'drop', title: title, display: wdrum(null, kind, 'card empty'), sub: t('uc_w_setup'), addAct: 'wsetup', addKind: kind, addLabel: t('uc_w_setup_btn') });
    var last = wlast(), recs = ms.map(function (m) { return wprevFor(m.id); });
    // табло: один водомір — одне велике; кілька однакового виду — по одному з назвою
    var display = ms.length === 1 ? wdrum(recs[0] ? recs[0].vals[ms[0].id] : null, kind, 'card') : ms.map(function (m, i) {
      return '<div class="wd-multi"><span class="wd-name">' + esc(m.name || (t('wm_n') + ' ' + (i + 1))) + '</span>' + wdrum(recs[i] ? recs[i].vals[m.id] : null, kind, 'card sm') + '</div>';
    }).join('');
    var ws = waterStatus(kind), st = cardSt(ws), tone = st ? ws.tone : '';
    var lastK = recs.filter(Boolean).sort(function (a, b) { return a.date < b.date ? 1 : -1; })[0];
    var o = { sub: lastK && !lastK.base ? t('uc_w_last', { d: fmtDate(lastK.date) }) : lastK ? t('uc_w_start', { d: fmtDate(lastK.date) }) : t('uc_w_nolast'), status: st, tone: tone, off: ws.off };
    // передано — лише коли останні показання кожного водоміра цього виду передані (гаряча — і Водоканалу, і ХТМ)
    var wsent = function (r) { return r && !r.base && !r.gap && !r.own && wsentVk(r) && (kind === 'cold' || wsentHtm(r)); };
    if (lastK && recs.every(function (r) { return !r || wsent(r); }) && wsent(lastK)) cardSent(o, lastK.date);
    return ucard({ kind: kind, href: 'water-' + kind, icon: 'drop', title: title, display: display, sub: o.sub, status: o.status, tone: o.tone, addAct: 'wnew', addKind: kind, addLabel: t('uc_add_w', { k: title.toLowerCase() }) });
  }
  /** Плитка «Налаштування квартири» под счётчиками (владелец 05.11: вместо «Додати лічильник» — настройки квартиры, там же добавить
   *  и прибрать счётчик). Пустая квартира — по-прежнему крупное «Додати лічильник»: настраивать там ещё нечего. */
  function placeTile(p, empty) {
    if (empty) return addTile(true);
    return '<a class="ucard-addm ucard-pset" href="#place-' + esc(p.id) + '" data-key="card-place-set"><span class="am-plus">' + ico('prefs', 24) + '</span>' +
      '<span class="am-txt"><b>' + esc(t('hp_settings')) + '</b><span class="small muted">' + esc(t('hp_settings_s')) + '</span></span></a>';
  }
  /** Плитка «+ Додати лічильник» на главной; в пустой квартире — крупно, с пояснением. */
  function addTile(empty) {
    return '<button type="button" class="ucard-addm' + (empty ? ' big' : '') + '" data-act="add-meter" data-key="card-add-meter"><span class="am-plus">' + ico('plus', 26) + '</span>' +
      '<span class="am-txt"><b>' + esc(t(empty ? 'am_empty_t' : 'am_tile')) + '</b><span class="small muted">' + esc(t(empty ? 'am_empty_s' : 'am_tile_s')) + '</span></span>' +
      (empty ? '<span class="btn am-cta">' + esc(t('am_tile')) + '</span>' : '') + '</button>';
  }
  // ---- главная по квартирам: одна — шапка «Моя квартира» (адрес, «+ Квартира») и её счётчики; несколько — аккордеон,
  // в каждой секции — счётчики этой квартиры и «Додати лічильник». Кнопки внутри секции работают в её квартире (data-pl).
  var HP_EDIT = '';   // у какой квартиры открыта форма «Назва й адреса»
  function homeCards() {
    return (hasHeat() ? [heatCard()] : []).concat(['hot', 'cold'].filter(function (k) { return wmeters(k).length; }).map(waterCard)).concat(emeters().length ? [elecCard()] : []).concat(smeters('gas').length ? [sCard('gas')] : []);
  }
  function hpEditForm(p) {
    var id = esc(p.id), idx = places().indexOf(p);
    return '<form class="hp-edit" data-hp-form="' + id + '" novalidate data-key="hp-edit-form"><div class="grid2">' +
      '<div class="field"><label for="hpn-' + id + '">' + esc(t('hp_name')) + '</label><div class="ctl"><input id="hpn-' + id + '" maxlength="40" autocomplete="off" value="' + esc(p.name || '') + '" placeholder="' + esc(idx <= 0 ? t('pl_mine') : t('pl_unnamed', { n: idx + 1 })) + '"></div>' +
        '<div class="pv-chips">' + t('pv_chips').split('|').map(function (c) { return '<button type="button" class="chip" data-act="hp-chip" data-id="' + id + '" data-v="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div></div>' +
      '<div class="field"><label for="hpa-' + id + '">' + esc(t('hp_addr')) + '</label><div class="ctl"><input id="hpa-' + id + '" maxlength="120" autocomplete="street-address" value="' + esc(p.address || '') + '" placeholder="' + esc(t('hp_addr_ph')) + '"></div><p class="small muted hp-addr-gpv">' + esc(t('hp_addr_gpv')) + '</p></div></div>' +
      '<div class="row-actions"><button type="button" class="btn sec" data-act="hp-cancel">' + esc(t('cancel')) + '</button><button type="submit" class="btn" data-key="hp-save">' + esc(t('save')) + '</button></div></form>';
  }
  /** Шапка квартири в списку: рядок на кожен вид лічильників — значок, назва, що робити й до коли (спершу термінове).
   *  Без «Найближчий термін — …» і переліку через крапку: людина одразу бачить, ЩО і ДО КОЛИ передати. */
  /** Строк показуємо лише за 4 дні до кінця (владелец 05.11: інакше перевантаження). null — не показувати. */
  var DUE_SOON = 4;
  function dueSoon(r) { if (!r || r.off || r.tone === 'ok' || !r.due) return null; var n = R.daysBetween(today(), r.due); return n <= DUE_SOON ? n : null; }
  function pstRows(p) {
    var ps = placeStatus(p.id), td = today();
    var soon = ps.rows.filter(function (r) { return dueSoon(r) !== null; }).sort(function (a, b) { return String(a.due).localeCompare(String(b.due)); });
    if (!soon.length) return '';
    // тихо, одним-двома рядками під адресою: що й до коли — без переліку всіх лічильників
    return '<span class="pnote" data-key="pst-' + esc(p.id) + '">' + soon.map(function (r) {
      var n = R.daysBetween(td, r.due), when = n <= 0 ? t('pn_today') : n === 1 ? t('pn_tmr') : t('pn_until', { d: fmtDate(r.due), n: n });
      return '<span class="pn-row' + (n <= 1 ? ' hot' : '') + '" data-key="pst-' + esc(p.id) + '-' + r.kind + '">' + ico('clock', 16) + '<span>' + esc(t(r.ready ? 'pn_ready' : 'pn_send', { k: r.title, w: when })) + '</span></span>';
    }).join('') + '</span>';
  }
  function hpOpen(p) { var o = S.homeOpen || {}; return o[p.id] !== undefined ? !!o[p.id] : p.id === S.placeId; }
  function homePlaces() {
    var ps = places();
    if (ps.length < 2) {
      var p = ps[0]; if (!p) return '';
      return withPlace(p.id, function () {
        var cards = homeCards(), addr = p.address;
        return '<section class="hp one" id="hp-' + esc(p.id) + '" data-pl="' + esc(p.id) + '" data-key="home-place"><div class="hp-head">' + ico('home', 24, 'hp-ico') +
          '<div class="hp-id"><b class="hp-name" data-key="home-place-name">' + esc(placeLabel(p)) + '</b>' +
            (HP_EDIT === p.id ? '' : addr ? '<span class="hp-addr">' + esc(addr) + ' <button type="button" class="linkbtn" data-act="hp-edit" data-id="' + esc(p.id) + '" data-key="home-addr-edit">' + esc(t('change')) + '</button></span>'
              : '<button type="button" class="linkbtn hp-addr-add" data-act="hp-edit" data-id="' + esc(p.id) + '" data-key="home-addr-add">' + ico('plus', 16) + ' ' + esc(t('hp_addr_add')) + '</button>') + '</div></div>' +
          (HP_EDIT === p.id ? hpEditForm(p) : '') +
          '<div class="ucards">' + cards.join('') + placeTile(p, !cards.length) + '</div>' +
          '<p class="hp-more"><button type="button" class="btn sec" data-act="hp-add-place" data-key="home-add-place">' + ico('plus', 18) + '<span>' + esc(t('pl_add')) + '</span></button></p>' + (cards.length ? '<p class="small muted ucards-hint">' + esc(t('uc_hint')) + '</p>' : '') + '</section>';
      });
    }
    return '<div class="hp-list" data-key="home-places">' + ps.map(function (p) {
      var due = pstRows(p);
      var open = hpOpen(p);   // до withPlace: там S.placeId — эта квартира
      return withPlace(p.id, function () {
        var cards = homeCards();
        return '<details class="hp pacc" id="hp-' + esc(p.id) + '" data-pl="' + esc(p.id) + '" style="--pc:var(--pc-' + placeColor(p) + ')" data-key="home-pl-' + esc(p.id) + '"' + (open ? ' open' : '') + '>' +
          '<summary data-key="home-pl-sum-' + esc(p.id) + '"><span class="pacc-t"><b><i class="pdot" aria-hidden="true"></i>' + esc(placeLabel(p)) + '</b>' + (p.address ? '<span class="pacc-addr">' + esc(p.address) + '</span>' : '') + '</span>' +
            ico('chev', 22, 'pacc-chev') + due + '</summary><div class="pacc-body">' +
          (HP_EDIT === p.id ? hpEditForm(p) : '') +
          // назва, адреса, рахунки, постачальники, додати й прибрати лічильник — усе на екрані квартири; тут лише вхід туди, під лічильниками
          '<div class="ucards">' + cards.join('') + placeTile(p, !cards.length) + '</div>' +
          (cards.length ? '' : '<p class="hp-tools"><a class="btn ter sm" href="#place-' + esc(p.id) + '" data-key="home-pl-set-' + esc(p.id) + '">' + ico('prefs', 18) + '<span>' + esc(t('hp_settings')) + '</span></a></p>') + '</div></details>';
      });
    }).join('') + '<p class="hp-more"><button type="button" class="btn sec" data-act="hp-add-place" data-key="home-add-place">' + ico('plus', 18) + '<span>' + esc(t('pl_add')) + '</span></button></p>' +
      '<p class="small muted ucards-hint">' + esc(t('hp_hint')) + '</p></div>';
  }
  /** Новая квартира прямо с главной: сразу с холодной водой и світлом (чаще всего так), назва й адреса — тут же. */
  function hpAddPlace() {
    syncPlace();
    var np = { id: 'p' + Date.now().toString(36), name: '', address: '', v: 2, color: nextColor(), meter: null, baseline: null,
      water: { account: '', surname: '', meters: [{ id: Wt.uid(), kind: 'cold', name: '', serial: '', vkId: '', verifiedUntil: '' }] },
      meters: [{ id: El.uid(), kind: 'elec', name: '', zones: 1, serial: '', account: '', createdAt: today() }], updatedAt: Date.now() };
    S.places.push(np); switchPlace(np.id); WX.key = '';
    S.homeOpen = S.homeOpen || {}; S.homeOpen[np.id] = true; HP_EDIT = np.id; save();
    toast(t('hp_added', { p: placeLabel(place()) })); SCROLL_TO = 'hp-' + np.id;
    if (routeName() === 'home') render(true); else go('home');
  }
  function hpSave(id) {
    var p = place(id), n = document.getElementById('hpn-' + id), a = document.getElementById('hpa-' + id); if (!p) return;
    p.name = String(n ? n.value : p.name || '').trim().slice(0, 40); p.address = String(a ? a.value : p.address || '').trim().slice(0, 120); p.updatedAt = Date.now();
    HP_EDIT = ''; save(); toast(t('b_saved')); render(true);
  }

  // ---------- графіки відключень світла (ГПВ Харківобленерго) — лише у квартир з адресою ----------
  // Сервер раз на 10 хв забирає графік: GET /api/gpv → days[дата][черга] = {off, may} — проміжки в хвилинах від півночі за Києвом.
  // Черга квартири — p.gpv ('3.1'): людина обирає сама (поруч — офіційний пошук черги за адресою). Без адреси блоку немає.
  // Зранку бот надсилає графік на сьогодні (p.gpvTg !== false, потрібен Telegram) — app/gpv.php.
  var GPV = { data: null, at: 0, busy: false, err: false, pick: {}, addr: {} };
  var GPV_Q = ['1.1', '1.2', '2.1', '2.2', '3.1', '3.2', '4.1', '4.2', '5.1', '5.2', '6.1', '6.2'];
  var GPV_LOOKUP = 'https://oblenergo.kharkiv.ua/uk/gaoinfo', GPV_CHANNEL = 'https://t.me/kharkivenergy';
  function gpvLoad() {
    if (!window.TEPLO_API || GPV.busy || Date.now() - GPV.at < 600000) return; GPV.busy = true; GPV.at = Date.now();
    fetch(window.TEPLO_API + '/gpv', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (j) {
      GPV.busy = false; var ok = !!(j && j.days), was = JSON.stringify([GPV.data, GPV.err]);
      GPV.err = !ok; if (ok) GPV.data = j; if (was !== JSON.stringify([GPV.data, GPV.err])) safeRender();
    }, function () { GPV.busy = false; if (!GPV.err) { GPV.err = true; safeRender(); } });
  }
  // повернулися в застосунок через годину — графік міг змінитися
  document.addEventListener('visibilitychange', function () { if (!document.hidden && GPV.data && Date.now() - GPV.at > 600000) gpvLoad(); });
  /** Зараз за Києвом: {ymd, min} (демо: S.demoToday / S.demoMin). */
  function kyivNow() {
    var d = new Date(), o = {};
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).forEach(function (x) { o[x.type] = x.value; });
      o = { ymd: o.year + '-' + o.month + '-' + o.day, min: (+o.hour % 24) * 60 + +o.minute };
    } catch (e) { o = { ymd: R.ymd(d), min: d.getHours() * 60 + d.getMinutes() }; }
    if (S.demoToday) o.ymd = S.demoToday; if (typeof S.demoMin === 'number') o.min = S.demoMin;
    return o;
  }
  function gpvHas(p) { return !!(p && String(p.address || '').trim()); }
  /** Черга за адресою квартири (сервер шукає в переліку Харківобленерго): знайшли — підставляємо самі (p.gpvAuto), ні — варіанти. */
  function gpvAddr(p) {
    var a = String(p.address || '').trim(), c = GPV.addr[a]; if (!a || !window.TEPLO_API) return null;
    if (c) return c;
    GPV.addr[a] = { busy: true };
    fetch(window.TEPLO_API + '/gpv/addr?q=' + encodeURIComponent(a), { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (j) {
      GPV.addr[a] = j && typeof j.found === 'boolean' ? j : { err: true };
      var pp = place(p.id);
      if (j && j.found && pp && String(pp.address || '').trim() === a && (!pp.gpv || (pp.gpvAuto && (pp.gpvAuto.addr !== a || pp.gpv !== j.q)))) {
        pp.gpv = j.q; pp.gpvAuto = { addr: a, street: j.street || '', city: j.city || '' }; pp.updatedAt = Date.now(); save();
      } else if (j && j.found === false && j.ready !== false && pp && pp.gpvAuto && pp.gpvAuto.addr === a && String(pp.address || '').trim() === a) {
        // черга була «за адресою», а за новим довідником адреси там немає — не тримаємо стару (людина обере сама)
        pp.gpv = ''; delete pp.gpvAuto; pp.updatedAt = Date.now(); save();
      }
      safeRender();
    }, function () { GPV.addr[a] = { err: true }; safeRender(); });
    return GPV.addr[a];
  }
  function gpvHm(m) { return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + m % 60).slice(-2); }
  function gpvSpan(iv) { return gpvHm(iv[0]) + '–' + gpvHm(iv[1]); }
  function gpvDur(ivs) { var m = 0; ivs.forEach(function (i) { m += i[1] - i[0]; }); var h = Math.floor(m / 60), r = m % 60; return (h ? t('gpv_h', { n: h }) : '') + (r ? (h ? ' ' : '') + t('gpv_m', { n: r }) : ''); }
  function gpvDayOf(q, ymd) { var d = GPV.data && GPV.data.days && GPV.data.days[ymd]; return d && d[q] ? d[q] : null; }
  /** Що зараз: {off, until} — світла немає до until; {next} — вимкнуть о next; {} — сьогодні більше не вимикають. */
  function gpvNowState(day, min) {
    var off = (day && day.off) || [];
    for (var i = 0; i < off.length; i++) { if (min >= off[i][0] && min < off[i][1]) return { off: true, until: off[i][1] }; if (off[i][0] > min) return { next: off[i][0] }; }
    return {};
  }
  function gpvBar(off, may, nowMin) {
    function seg(iv, c) { return '<i class="' + c + '" style="left:' + (iv[0] / 14.4).toFixed(2) + '%;width:' + ((iv[1] - iv[0]) / 14.4).toFixed(2) + '%"></i>'; }
    return '<div class="gpv-bar" aria-hidden="true">' + may.map(function (x) { return seg(x, 'may'); }).join('') + off.map(function (x) { return seg(x, 'off'); }).join('') +
      (nowMin !== null ? '<b class="gpv-mark" style="left:' + (nowMin / 14.4).toFixed(2) + '%"></b>' : '') + '</div>' +
      '<div class="gpv-ticks" aria-hidden="true"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>';
  }
  function gpvDay(day, label, now) {
    var off = day.off || [], may = day.may || [], h = '<div class="gpv-day" data-key="gpv-day-' + (now ? 'today' : 'tomorrow') + '"><p class="gpv-dt"><b>' + esc(label) + '</b>';
    if (now) {
      var s = gpvNowState(day, now.min);
      h += '<span class="gpv-now ' + (s.off ? 'off' : 'on') + '" data-key="gpv-now">' + ico(s.off ? 'alert' : 'check', 16) + '<span>' + esc(s.off ? t('gpv_now_off', { t: gpvHm(s.until) }) : s.next !== undefined ? t('gpv_now_next', { t: gpvHm(s.next) }) : t(off.length ? 'gpv_now_rest' : 'gpv_now_free')) + '</span></span>';
    }
    h += '</p>' + gpvBar(off, may, now ? now.min : null);
    var ivs = function (l, c) { return '<span class="gpv-ivs">' + l.map(function (x) { return '<span class="gpv-iv' + (c || '') + '">' + gpvSpan(x) + '</span>'; }).join('<span class="sr">, </span>') + '<span class="sr">. </span></span>'; };
    h += off.length ? '<p class="gpv-list" data-key="gpv-off"><span class="gpv-lbl">' + esc(t('gpv_off')) + '</span>' + ivs(off) + '<span class="muted gpv-tot">' + esc(t('gpv_total', { d: gpvDur(off) })) + '</span></p>'
      : '<p class="gpv-list ok" data-key="gpv-free">' + esc(t('gpv_free')) + '</p>';
    if (may.length) h += '<p class="gpv-list"><span class="gpv-lbl">' + esc(t('gpv_may')) + '</span>' + ivs(may, ' may') + '</p>';
    return h + '</div>';
  }
  /** Погодинно: 24 клітинки (по 12 у рядку), кожна — дві половини години: світла немає / можливо / є. Поточна година — рамкою. */
  function gpvHours(day, nowMin) {
    var off = day.off || [], may = day.may || [];
    var st = function (a) { var m = a + 15, f = function (l) { return l.some(function (x) { return m >= x[0] && m < x[1]; }); }; return f(off) ? 'off' : f(may) ? 'may' : 'on'; };
    var h = '<div class="gpv-hrs" aria-hidden="true">';
    for (var i = 0; i < 24; i++) {
      var cur = nowMin !== null && Math.floor(nowMin / 60) === i;
      h += '<span class="gpv-hr' + (cur ? ' now' : '') + '"><span class="gpv-hc"><i class="' + st(i * 60) + '"></i><i class="' + st(i * 60 + 30) + '"></i></span><small>' + ('0' + i).slice(-2) + '</small></span>';
    }
    return h + '</div>';
  }
  /** Розширений графік у розгорнутому блоці: сьогодні й завтра погодинно, з легендою (кольори — лише вдобавок до списків годин вище). */
  function gpvWide(td, tm, now) {
    if (!td && !tm) return '';
    var row = function (d, l, nm) { return '<div class="gpv-wd"><p class="gpv-wl"><b>' + esc(l) + '</b></p>' + gpvHours(d, nm) + '</div>'; };
    return '<section class="gpv-wide" data-key="gpv-wide"><h3>' + esc(t('gpv_wide')) + '</h3>' +
      (td ? row(td, t('gpv_today', { d: fmtDate(now.ymd) }), now.min) : '') + (tm ? row(tm, t('gpv_tomorrow', { d: fmtDate(addDays(now.ymd, 1)) }), null) : '') +
      '<p class="gpv-leg small"><span><i class="off"></i>' + esc(t('gpv_leg_off')) + '</span><span><i class="may"></i>' + esc(t('gpv_leg_may')) + '</span><span><i class="on"></i>' + esc(t('gpv_leg_on')) + '</span></p></section>';
  }
  /** Блок «Графік відключень світла» квартири — акордеон (згорнутий): у шапці лише «Сьогодні без світла: 06:00–09:00, …»
   *  (або «Оберіть чергу відключень»); розгорнуто — вибір черги / сьогодні (зараз є/немає, шкала 24 год, години), завтра,
   *  погодинно, джерело, Telegram. На сторінці світла (`#elec`); квартира без електролічильника — на її екрані. */
  var GPV_OPEN = {};
  function gpvBox(p, where) {
    if (!gpvHas(p)) return '';
    var b = gpvBody(p), id = esc(p.id);
    return '<details class="panel gpv gacc" id="gpv-' + id + '" data-gpv="' + id + '" data-key="gpv-' + where + '"' + (GPV_OPEN[p.id] ? ' open' : '') + '>' +
      '<summary data-key="gpv-sum"><h2 class="gpv-t">' + ico('bolt', 20) + '<span>' + esc(t('gpv_title')) + '</span></h2>' +
      '<span class="gpv-brief' + (b.cls ? ' ' + b.cls : '') + '" data-key="gpv-brief">' + esc(b.brief) + '</span>' + ico('chev', 20, 'pacc-chev') + '</summary>' +
      '<div class="gpv-b">' + b.html + '</div></details>';
  }
  document.addEventListener('toggle', function (e) { var d = e.target; if (d && d.classList && d.classList.contains('gacc')) GPV_OPEN[d.getAttribute('data-gpv')] = d.open; }, true);
  /** Вміст блоку: {brief — рядок для згорнутого, cls, html — розгорнуте}. */
  function gpvBody(p) {
    gpvLoad();
    var id = esc(p.id), addr = String(p.address).trim(), q = GPV_Q.indexOf(p.gpv) >= 0 ? p.gpv : '', h = '';
    // черга визначається сама за адресою: ще не шукали / адресу змінили після автопідбору — шукаємо
    var auto = p.gpvAuto && p.gpvAuto.addr === addr, look = (!q || (p.gpvAuto && !auto)) && !GPV.pick[p.id] ? gpvAddr(p) : null;
    if (auto && q && !GPV.pick[p.id]) gpvAddr(p);   // черга «за адресою» — раз за сеанс звіряємо з довідником (його могли виправити)
    if (look && look.busy) return { brief: t('gpv_b_finding'), html: '<p class="small muted" data-key="gpv-finding">' + esc(t('gpv_finding', { a: addr })) + '</p>' };
    if (p.gpvAuto && !auto && look && look.found === false) q = '';   // нова адреса, а в переліку її немає — стара черга вже не про неї
    if (!q || GPV.pick[p.id]) {
      var opts = look && look.options && look.options.length ? look.options : null, list = opts && !GPV.pick[p.id] ? opts : GPV_Q;
      var lead = t('gpv_pick_lead', { a: addr });
      if (look && look.found === false && !GPV.pick[p.id] && look.ready !== false && !look.err)
        lead = opts ? t(look.reason === 'nohouse' ? 'gpv_many_nohouse' : look.reason === 'nostreet' ? 'gpv_many_nostreet' : look.reason === 'street' ? 'gpv_many_street' : 'gpv_many', { s: look.street || '', c: look.city || '' })
          : look.kharkiv ? t('gpv_kh_none') : t('gpv_notfound', { a: addr });
      return { brief: q ? t('gpv_q', { q: q }) : t('gpv_b_pick'), cls: q ? '' : 'need', html: '<p class="small" data-key="gpv-lead">' + esc(lead) + '</p>' +
        '<div class="gpv-qs' + (opts && list === opts ? ' few' : '') + '" role="group" aria-label="' + esc(t('gpv_pick_aria')) + '">' + list.map(function (x) {
          return '<button type="button" class="chip gpv-q" data-act="gpv-set" data-id="' + id + '" data-q="' + x + '" aria-pressed="' + (x === q) + '" data-key="gpv-q-' + x + '">' + x + '</button>'; }).join('') + '</div>' +
        (opts && list === opts ? '<p class="small"><button type="button" class="linkbtn" data-act="gpv-all" data-id="' + id + '" data-key="gpv-all">' + esc(t('gpv_all')) + '</button></p>' : '') +
        '<p class="small"><a href="' + GPV_LOOKUP + '" target="_blank" rel="noopener" data-key="gpv-lookup">' + esc(t('gpv_lookup')) + ' ' + ico('ext', 14) + '</a></p>' +
        '<p class="small muted">' + esc(t('gpv_lookup_hint')) + '</p>' +
        (q ? '<p><button type="button" class="linkbtn" data-act="gpv-cancel" data-id="' + id + '" data-key="gpv-cancel">' + esc(t('cancel')) + '</button></p>' : '') };
    }
    h += '<p class="gpv-sub small muted"><span data-key="gpv-q">' + esc(t('gpv_q', { q: q })) + '</span>' + (auto ? ' <span data-key="gpv-auto">' + esc(t('gpv_auto', { s: [p.gpvAuto.street, p.gpvAuto.city].filter(Boolean).join(', ') || addr })) + '</span>' : '') +
      ' · <button type="button" class="linkbtn" data-act="gpv-change" data-id="' + id + '" data-key="gpv-change">' + esc(t(auto ? 'gpv_wrong' : 'gpv_change')) + '</button></p>';
    var d = GPV.data;
    if (!d) return { brief: t(GPV.err ? 'gpv_err' : 'gpv_loading'), html: h + '<p class="small muted" data-key="gpv-wait">' + (GPV.err ? esc(t('gpv_err')) + ' <a href="' + GPV_LOOKUP + '" target="_blank" rel="noopener">' + esc(t('gpv_official')) + '</a>' : esc(t('gpv_loading'))) + '</p>' };
    var now = kyivNow(), td = gpvDayOf(q, now.ymd), tm = gpvDayOf(q, addDays(now.ymd, 1)), brief, cls = '';
    if (!td) brief = t('gpv_b_none');
    else if ((td.off || []).length) { brief = t('gpv_b_off', { l: td.off.map(gpvSpan).join(', ') }); cls = gpvNowState(td, now.min).off ? 'off' : 'due'; }
    else if ((td.may || []).length) brief = t('gpv_b_may', { l: td.may.map(gpvSpan).join(', ') });
    else { brief = t('gpv_b_free'); cls = 'ok'; }
    h += td ? gpvDay(td, t('gpv_today', { d: fmtDate(now.ymd) }), now) : '<p class="gpv-list" data-key="gpv-today-none">' + esc(t('gpv_today_none')) + '</p>';
    h += tm ? gpvDay(tm, t('gpv_tomorrow', { d: fmtDate(addDays(now.ymd, 1)) }), null) : '<p class="small muted" data-key="gpv-tmr-none">' + esc(t('gpv_tmr_none')) + '</p>';
    h += gpvWide(td, tm, now);
    h += '<p class="small muted gpv-src">' + esc(t('gpv_src', { d: d.update || '—' })) + (d.stale ? ' <b class="warn">' + esc(t('gpv_stale')) + '</b>' : '') +
      ' <a href="' + GPV_CHANNEL + '" target="_blank" rel="noopener" data-key="gpv-channel">' + esc(t('gpv_channel')) + '</a></p>';
    if (window.TEPLO_API) {
      var acc = Y().account, tg = acc && acc.telegram;
      h += tg ? '<label class="check-row gpv-tg"><input type="checkbox" data-gpvtg="' + id + '"' + (p.gpvTg === false ? '' : ' checked') + ' data-key="gpv-tg"><span>' + esc(t('gpv_tg')) + '</span></label>'
        : '<p class="small muted" data-key="gpv-tg-need">' + ico('info', 16) + ' ' + esc(t(acc ? 'gpv_tg_need' : 'gpv_tg_login')) + '</p>';
    }
    return { brief: brief, cls: cls, html: h };
  }
  document.addEventListener('change', function (e) {
    var el = e.target, id = el && el.getAttribute && el.getAttribute('data-gpvtg'), p = id && place(id); if (!p) return;
    if (el.checked) delete p.gpvTg; else p.gpvTg = false; p.updatedAt = Date.now(); save(); toast(t(el.checked ? 'gpv_tg_on' : 'gpv_tg_off'));
  });
  // секция квартиры на главной: нажатие внутри — действие в этой квартире (кнопки «+», карточки, «Додати лічильник»)
  document.addEventListener('click', function (e) {
    var sec = e.target.closest && e.target.closest('[data-pl]'); if (!sec || e.target.closest('summary')) return;
    var id = sec.getAttribute('data-pl'); if (id && id !== S.placeId && place(id)) { switchPlace(id); WX.key = ''; }
  }, true);
  document.addEventListener('toggle', function (e) {
    var d = e.target; if (!d || !d.classList || !d.classList.contains('pacc')) return;
    S.homeOpen = S.homeOpen || {}; S.homeOpen[d.getAttribute('data-pl')] = d.open; persist();
  }, true);
  document.addEventListener('submit', function (e) {
    var f = e.target; if (!f || !f.getAttribute || !f.getAttribute('data-hp-form')) return; e.preventDefault(); hpSave(f.getAttribute('data-hp-form'));
  });
  V.home = function () {
    var html = '<h1 class="sr">' + esc(t('nav_home')) + (place() && place().name ? ' — ' + esc(place().name) : '') + '</h1>';
    if (Y().mode === 'server' && !Y().account && (RD().length || wrecs().length) && !S.syncPromptDismissed) {
      html += '<div class="banner" data-key="home-save-prompt">' + ico('info', 22) + '<div><p><b>' + esc(t('save_prompt')) + '</b></p><p><a href="#login">' + esc(t('login')) + '</a> &nbsp; <button class="linkbtn" data-act="dismiss-sync">' + esc(t('save_prompt_later')) + '</button></p></div></div>';
    }
    loadInbox();
    if (INBOX.items && INBOX.items.length) html += '<div class="banner" data-key="home-inbox">' + ico('camera', 22) + '<div><p><b>' + esc(t('ib_title', { n: INBOX.items.length })) + '</b></p><p>' + esc(t('ib_sub')) + '</p><p><button class="btn" data-act="inbox-run" data-key="home-inbox-run">' + esc(t('ib_run')) + '</button></p></div></div>';
    var draft = S.draft && (Object.keys(S.draft.values || {}).length || S.draft.step > 0);
    if (draft && hasHeat()) html += '<div class="home-draft"><a class="btn big block" href="#step-' + (S.draft.step || 0) + '" data-key="home-continue">' + esc(t('h_continue', { i: (S.draft.step || 0) + 1, n: steps().length })) + '</a>' +
      '<button type="button" class="linkbtn" data-act="wiz-cancel" data-what="heat" data-key="home-draft-cancel">' + esc(t('wz_cancel_draft')) + '</button></div>';
    html += homePlaces();
    return { screen: 'S01', route: 'home', html: html };
  };

  /** Блок счётчика на его странице — как сам прибор: название и номер сверху, табло, дата последних, данные (повірка,
   *  рахунок, зони), настройки (свернуты) и ссылки. Один вид для тепла, воды, света и газа. */
  var MB_OPEN = {}, WH_OPEN = {};
  /** «Куди передати» на сторінці лічильника — акордеон: закритий, відкривається тапом (після внесення показань — відкритий). */
  function whereAcc(h, recId) {
    var m = /^<section class="panel where" data-key="([^"]+)"><h2>([\s\S]*?)<\/h2>([\s\S]*)<\/section>$/.exec(h); if (!m) return h;
    var id = recId ? 'wacr-' + recId + '--' + m[1] : 'wacc-' + m[1], open = (recId ? WR_OPEN : WH_OPEN)[id.slice(5)];
    return '<details class="panel where wacc" id="' + id + '" data-key="' + m[1] + '"' + (open ? ' open' : '') + '><summary data-key="' + m[1] + '-sum"><h2>' + m[2] + '</h2>' + ico('chev', 20, 'pacc-chev') + '</summary><div class="where-b">' + m[3] + '</div></details>';
  }
  var WR_OPEN = {};   // «Куди передати» в картці запису історії: відкривали — лишається відкритим до перезавантаження
  function waccStore(d) { return d.id.indexOf('wacr-') === 0 ? WR_OPEN : WH_OPEN; }
  document.addEventListener('toggle', function (e) { var d = e.target; if (d && d.classList && d.classList.contains('wacc')) waccStore(d)[d.id.slice(5)] = d.open; }, true);
  /** Підпис табло на сторінці лічильника — як статуси в історії: останні передані (стартові — «стартові»), а новіший запис, ще не
   *  переданий чи «лише для себе», — окремим рядком. list — записи лічильника за датою, isSent(r) — «передано» з історії. */
  function sentCap(list, isSent) {
    var s = null, l = list.length ? list[list.length - 1] : null;
    list.forEach(function (r) { if (!r.own && isSent(r)) s = r; });
    var cap = s ? (s.base ? t('wm_cap_base', { d: fmtDate(s.date, true) }) : t('mb_cap_sent', { d: fmtDate(s.date, true) })) : l ? t('mb_cap_none') : t('uc_w_nolast');
    var note = l && l !== s ? t(l.own ? 'mb_newer_own' : 'mb_newer', { d: fmtDate(l.date, true) }) : '';
    return { rec: s || l, cap: cap, note: note };
  }
  /** Кнопка «Копіювати» прямо в полі (рахунок, прізвище, №, код у боті): вставити в бот чи кабінет. Береться те, що в полі зараз. */
  function ctlCopy(id) { return '<button type="button" class="ctl-copy" data-act="copy-in" data-for="' + id + '" data-key="copy-' + id + '" aria-label="' + esc(t('copy')) + '" title="' + esc(t('copy')) + '">' + ico('copy', 20) + '</button>'; }
  /** Маленька кнопка «Копіювати» біля показання (у бот чи кабінет вставити цифри). */
  function copyIco(text, key) { return text === null || text === undefined || text === '' ? '' : '<button type="button" class="copy-ico" data-act="copy" data-text="' + esc(String(text)) + '"' + (key ? ' data-key="' + key + '"' : '') + ' aria-label="' + esc(t('copy_v', { v: text })) + '" title="' + esc(t('copy')) + '">' + ico('copy', 18) + '</button>'; }
  function mbox(o) {
    return '<section class="panel mbox mbox-' + o.kind + '" data-key="' + o.key + '">' +
      '<header class="mbox-h">' + ico(o.icon, 24, o.cls) + '<span class="mbox-t"><b>' + esc(o.name) + '</b>' + (o.sub && subSpans(o.sub) ? '<span class="small muted mbox-sub">' + subSpans(o.sub) + '</span>' : '') + '</span></header>' +
      '<div class="mbox-disp">' + o.display + '</div>' +
      '<p class="lcd-cap meta-row"><span>' + esc(o.cap) + '</span>' + (o.fix || '') + copyIco(o.copy, o.key + '-copy') + '</p>' + (o.body || '') +
      (o.meta && o.meta.length ? '<ul class="mbox-meta">' + o.meta.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' : '') +
      (o.set ? '<details class="mbox-set" id="mbs-' + esc(o.id || o.kind) + '"' + (MB_OPEN[o.id || o.kind] ? ' open' : '') + ' data-key="' + o.key + '-set"><summary>' + ico('prefs', 18) + '<span>' + esc(o.setTitle || t('mb_set')) + '</span>' + ico('chev', 18, 'pacc-chev') + '</summary><div class="mbox-set-b">' + o.set + '</div></details>' : '') +
      (o.links && o.links.length ? '<div class="mbox-links">' + o.links.join('') + '</div>' : '') + '</section>';
  }
  /** «Лічильник знімали на ремонт, повірку чи міняли?» — внизу «Налаштувань лічильника», не на виду. */
  function gapSetLink(what) { return '<p class="mbox-set-link">' + mlink('#gap-new-' + esc(what), 'wrench', t('gp_add'), ' data-key="gap-add-' + esc(what) + '"') + '</p>'; }
  function mlink(href, icon, txt, extra) { return '<a href="' + href + '"' + (extra || '') + '>' + ico(icon, 18) + '<span>' + esc(txt) + '</span></a>'; }
  document.addEventListener('toggle', function (e) { var d = e.target; if (d && d.classList && d.classList.contains('mbox-set')) MB_OPEN[d.id.slice(4)] = d.open; }, true);

  // ---------- экран вида воды: табло, «куди передати», история ----------
  /** Один адресат: кому, за що, строк; готові цифри (якщо є показання цього місяця); куди саме — кнопки; позначка «передано». */
  function destBox(o) {
    return '<div class="dest"' + (o.id ? ' id="' + o.id + '" tabindex="-1"' : '') + ' data-key="dest-' + o.key + '"><div class="dest-h"><div class="grow"><b>' + esc(o.org) + '</b><div class="small muted">' + esc(o.what) + '</div></div>' +
      (o.sent ? '<span class="pill ok">' + ico('check', 14) + ' ' + esc(t('ws_sent')) + '</span>' : o.due ? '<span class="pill ' + (o.dueTone || 'neutral') + '">' + esc(o.due) + '</span>' : '') + '</div>' +
      (o.body || '') +
      (o.chans && o.chans.length ? '<div class="dest-ch">' + o.chans.map(function (c) { return '<a class="btn sec" href="' + c[0] + '" target="_blank" rel="noopener" data-key="dest-' + o.key + '-' + c[3] + '"' + (c[4] || '') + '>' + ico(c[2], 18) + '<span>' + esc(c[1]) + '</span></a>'; }).join('') + '</div>' : '') +
      (o.more ? '<div class="dest-more" data-key="dest-more">' + o.more + '</div>' : '') + (o.mark || '') + '</div>';
  }
  function telLink(num, txt) { return '<a href="tel:' + num + '">' + esc(txt) + '</a>'; }
  /** «Куди передати» для води. kind: 'cold' — лише Водоканал; 'hot' або null (картка запису, є гаряча) — Водоканал і ХТМ.
   *  rec — показання цього місяця: тоді в кожного адресата готові цифри (команда для бота, значення) і «Я передав(ла)». */
  function wsendPanel(rec, kind) {
    var ms = wmeters(), hot = wmeters('hot'), withHtm = kind === 'hot' || (!kind && hot.length);
    var w = Wt.vkWindow(today()), vkDue = w.open ? t('wd_due', { d: fmtDate(w.deadline) }) : t('wd_due_next', { d: fmtDate(nextMonthDay(today(), Wt.VK_DEADLINE)) });
    var mark = function (to, sent) { return rec ? '<p class="dest-mark">' + (sent ? '<button class="linkbtn" data-act="wsent" data-to="' + to + '" data-v="0" data-id="' + rec.id + '">' + esc(t('ws_unmark')) + '</button>' : '<button class="btn sec" data-act="wsent" data-to="' + to + '" data-v="1" data-id="' + rec.id + '" data-key="wsend-' + to + '-done">' + ico('check', 18) + '<span>' + esc(t('ws_mark')) + '</span></button>') + '</p>' : ''; };
    var valList = function (list) { return '<ul class="wvals">' + list.filter(function (m) { return rec.vals && rec.vals[m.id] !== undefined && rec.vals[m.id] !== ''; }).map(function (m) {
      var v = Wt.whole(rec.vals[m.id]); return '<li><span>' + esc(wname(m)) + '</span><b class="num">' + v + '</b><button class="linkbtn" data-act="copy" data-text="' + v + '">' + esc(t('copy')) + '</button></li>'; }).join('') + '</ul>'; };
    // квартира не в Харкові (за довідником — інший постачальник води): контакти її водоканалу, без бота й кабінету Харківводоканалу
    var ld = prvOf('water');
    if (ld && ld.via !== 'hvk') return '<section class="panel where" data-key="where-water"><h2>' + ico('send', 20) + '<span>' + esc(t('wd_title')) + '</span></h2>' + wherePlaceLine() +
      localDest('water', ld, rec ? valList(ms) : '', rec ? mark('vk', wsentVk(rec)) : '', rec && wsentVk(rec)) + '</section>';
    // Водоканал: холодна (вода + відведення) і гаряча (лише відведення) — одна команда для бота на всі водоміри
    var vkBody = '', vkChans = [[Wt.VK_BOT, t('wd_bot', { b: '@hvk_user_bot' }), 'send', 'bot'], [Wt.VK_CABINET, t('wd_cab_vk'), 'ext', 'cab']];
    if (rec) {
      var cmd = Wt.vkCommand(wcfg().account, wcfg().surname, ms, rec.vals || {});
      if (cmd.noAccount) vkBody = '<p>' + esc(t('ws_need_acc')) + '</p>' + waccForm();

      // ID лічильників ще немає: бот покаже їх на /1= — відкриваємо його з готовою командою; переслана нам відповідь — номери кнопками
      else if (cmd.missing.length) vkBody = '<ol class="wsteps"><li>' + esc(t('vk_ids_1')) + '<div class="cmd"><code>' + esc(cmd.info) + '</code></div>' +
        '<div class="row-actions" style="margin-top:8px"><button class="btn" data-act="vk-open" data-text="' + esc(cmd.info) + '" data-key="vk-ids">' + ico('send', 18) + '<span>' + esc(t('vk_ids_btn')) + '</span></button></div></li>' +
        '<li>' + esc(t('ws_ids_2')) + ' ' + esc(t('vk_ids_fw', { b: '@' + ourBot() })) + '</li></ol>' + vkInfoBox() + wmeterIdForm();
      else {
        // «Відправити»: бот Водоканалу відкривається з набраною командою (t.me/…?text=), людині лишається «Надіслати»; повернулась — «Що відповів бот?»
        // уже передано — сверху підтвердження, команда й «Відправити ще раз» (якщо виправили цифри) — спокійніше, вторинною кнопкою
        var vSent = !!wsentVk(rec), vPend = !!rec.vkAt && !vSent;
        vkBody = (vSent ? vkReplyBox(rec) : '<p>' + esc(t('vk_lead')) + '</p>') + '<div class="cmd"><code data-key="wsend-cmd">' + esc(cmd.text) + '</code></div>' +
          '<div class="row-actions" style="margin-top:8px"><button class="btn' + (vSent ? ' sec' : '') + '" data-act="vk-send" data-id="' + esc(rec.id) + '" data-text="' + esc(cmd.text) + '" data-key="wsend-vk-send">' + ico('send', 18) + '<span>' + esc(t(vSent || vPend ? 'vk_send_again' : 'vk_send')) + '</span></button></div>' +
          (vPend ? vkAsk(rec) + vkReplyBox(rec) : '');
        vkChans = vkChans.slice(1);   // бот відкриває кнопка вище
      }
      // рахунок у 1–4 цифри — майже напевно не той (бот Водоканалу на неіснуючий мовчить): попередження й поля одразу зверху
      var accD = String(wcfg().account || '').replace(/\D/g, '');
      if (!cmd.noAccount && accD.length < 5) vkBody = '<div class="banner warn" data-key="vk-acc-short">' + ico('alert', 20) + '<div><p>' + esc(t('vk_acc_short', { a: accD })) + '</p></div></div>' + waccForm() + vkBody;
      // однакові ID у двох лічильників — так не буває: бот покаже справжні на /1=
      var ids = ms.map(function (m) { return String(m.vkId || '').replace(/\D/g, ''); }).filter(Boolean), dup = ids.filter(function (x, i) { return ids.indexOf(x) !== i; })[0];
      if (!cmd.noAccount && dup) vkBody = '<div class="banner warn" data-key="vk-id-dup">' + ico('alert', 20) + '<div><p>' + esc(t('vk_id_dup', { id: dup })) + '</p>' +
        '<p><button class="btn sec" data-act="vk-open" data-text="' + esc(cmd.info) + '" data-key="vk-dup-ids">' + ico('send', 18) + '<span>' + esc(t('vk_check_ids')) + '</span></button></p></div></div>' + wmeterIdForm() + vkBody;
      // сайт Водоканалу відкривається з нашого сервера — відправляємо через нього (без бота й без ID); бот — запасний шлях, у розгортці
      if (!cmd.noAccount && accD.length >= 5 && String(wcfg().surname || '').trim() && vkcOn()) {
        var botOpen = (!!rec.vkAt && !wsentVk(rec)) || !!VKERR[rec.id];
        vkBody = vkcBox(rec, ms) + '<details class="tips-box vk-alt"' + (botOpen ? ' open' : '') + ' data-key="vk-alt"><summary>' + esc(t('vkc_or_bot')) + '</summary>' + vkBody + '</details>';
        vkChans = [];
      } else if (!cmd.noAccount && vkcGate() === 'login') vkBody = vkcPre('login') + vkBody;   // не ввійшов — скажемо, що через сайт можна
      vkBody += '<details class="tips-box"><summary>' + esc(t('wd_vals')) + '</summary>' + valList(ms) + '</details>';
    } else {
      // кнопка «Відправити» — після показань цього місяця; сайт Водоканалу відкривається — шлях через нього видно одразу
      var vg = vkcGate();
      vkBody = vg ? vkcPre(vg, kind, ms) : '<p class="small" data-key="vk-need-rec">' + esc(t('vk_need_rec')) + '</p>';
      if (vg === 'ok') vkBody += '<details class="tips-box vk-alt" data-key="vk-alt"><summary>' + esc(t('vkc_or_bot')) + '</summary><p class="small">' + esc(t('vk_need_rec')) + '</p></details>';
    }
    var h = '<section class="panel where" data-key="where-water"><h2>' + ico('send', 20) + '<span>' + esc(t('wd_title')) + '</span></h2>' +
      // квартир несколько — за какую передаём (рахунок і цифри — цієї квартири)
      (places().length > 1 ? '<p class="dest-place" style="--pc:var(--pc-' + placeColor(place()) + ')" data-key="where-place"><b>' + esc(t('wd_for', { p: placeLabel(place()) })) + '</b>' + (placeSub(place()) ? '<span class="small muted"> · ' + esc(placeSub(place())) + '</span>' : '') + '</p>' : '') +
      (rec ? '' : '<p class="small muted">' + esc(t('wd_lead')) + '</p>');
    vkBody = vkStatusLine() + vkBody;
    h += destBox({ key: 'vk', id: 'wsend-vk', org: t('wd_vk_org'), what: kind === 'cold' ? t('wd_vk_cold') : kind === 'hot' ? t('wd_vk_hot') : t('wd_vk_both'),
      due: vkDue, dueTone: w.open && w.daysLeft <= 3 ? 'warn' : 'neutral', sent: rec && wsentVk(rec), body: vkBody, chans: vkChans,
      more: '<p class="dm-t">' + esc(t('wd_vk_call')) + '</p><ul class="dm-ph"><li>' + telLink('+380577075851', '(057) 707-58-51') + '<span class="muted">' + esc(t('wd_vk_24')) + '</span></li><li><b>(050) 355-12-12</b><span class="muted">Viber</span></li></ul>', mark: rec && rec.vkAt && !wsentVk(rec) ? '' : mark('vk', rec && wsentVk(rec)) });
    // ХТМ: сама гаряча вода — лише бот і кол-центр (у кабінеті ХТМ форми для гарячої води немає)
    if (withHtm) h += destBox({ key: 'htm', org: t('wd_htm_org'), what: t('wd_htm_what'), sent: rec && wsentHtm(rec),
      body: rec ? valList(hot) : '', chans: [[BOT_URL, t('wd_bot', { b: '@KPHTM_Bot' }), 'send', 'bot']],
      more: esc(t('wd_htm_more')) + ' ' + telLink('+380573414140', '(057) 341-41-40'), mark: mark('htm', rec && wsentHtm(rec)) });
    return h + '</section>';
  }
  // ---------- бот Водоканалу: відповіді, переслані нашому боту (/api/vk/replies) ----------
  var VKR = { list: null, at: 0, busy: false }, VKERR = {};
  function ourBot() { return (Y()._cfg && Y()._cfg.botUsername) || 'heatcount_bot'; }
  function vkWhen(sec) { var d = new Date(sec * 1000); return fmtDate(d.toISOString().slice(0, 10)) + ', ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  /** Відповідь бота після натискання «Відправити» цього запису (або та, що підтвердила). */
  function vkReplyFor(rec) {
    var l = VKR.list || [];
    if (rec.vkConf) return l.filter(function (r) { return r.id === rec.vkConf.id; })[0] || { id: rec.vkConf.id, kind: 'ok', text: rec.vkConf.text || '', at: rec.vkConf.at };
    if (!rec.vkAt) return null;
    return l.filter(function (r) { return r.at * 1000 >= rec.vkAt - 120000; })[0] || null;
  }
  function vkReplyBox(rec) {
    var r = vkReplyFor(rec); if (!r) return '';
    var ok = rec.vkConf || r.kind === 'ok', bad = !ok && r.kind === 'err';
    return '<div class="vk-reply' + (ok ? ' ok' : bad ? ' bad' : '') + '" data-key="vk-reply"><p class="small"><b>' + esc(ok ? t('vk_conf', { d: vkWhen(r.at) }) : t('vk_reply_t', { d: vkWhen(r.at) })) + '</b></p>' +
      (r.text ? '<p class="small vk-text">' + esc(String(r.text).slice(0, 600)) + '</p>' : '') + '</div>';
  }
  function vkAsk(rec) {
    var err = VKERR[rec.id] || (vkReplyFor(rec) || {}).kind === 'err';
    return '<div class="vk-ask" data-key="vk-ask"><p><b>' + esc(t('vk_ask')) + '</b></p><div class="row-actions">' +
      '<button class="btn" data-act="wsent" data-to="vk" data-v="1" data-id="' + esc(rec.id) + '" data-key="vk-ok">' + ico('check', 18) + '<span>' + esc(t('vk_ok')) + '</span></button>' +
      '<button class="btn sec" data-act="vk-err" data-why="silent" data-id="' + esc(rec.id) + '" data-key="vk-silent">' + esc(t('vk_silent_btn')) + '</button>' +
      '<button class="btn sec" data-act="vk-err" data-why="err" data-id="' + esc(rec.id) + '" data-key="vk-err">' + esc(t('vk_err')) + '</button></div>' +
      '<p class="small muted">' + esc(t('vk_fw', { b: '@' + ourBot() })) + '</p>' +
      (err ? '<div class="vk-tips" data-key="vk-tips"><ul class="small">' + t('vk_err_tips').split('|').map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' + waccForm() + wmeterIdForm() +
        '<p><button class="btn sec" data-act="vk-open" data-text="' + esc(Wt.vkCommand(wcfg().account, wcfg().surname, [], {}).info) + '" data-key="vk-check-ids">' + ico('send', 18) + '<span>' + esc(t('vk_check_ids')) + '</span></button></p></div>' : '') + '</div>';
  }
  /** Переслана відповідь на /1= (або будь-яка нова): текст і номери з неї кнопками — натиснув, і номер ліг у порожнє поле ID. */
  function vkInfoBox() {
    var r = (VKR.list || []).filter(function (x) { return x.kind !== 'ok'; })[0]; if (!r) return '';
    var acc = String(wcfg().account || '').replace(/\D/g, ''), seen = {}, nums = (String(r.text).match(/(^|[^\d.,])(\d{3,10})(?![\d.,]\d)/g) || []).map(function (x) { return x.replace(/\D/g, ''); })
      .filter(function (n) { if (n === acc || seen[n]) return false; seen[n] = 1; return true; }).slice(0, 8);
    return '<div class="vk-reply" data-key="vk-info"><p class="small"><b>' + esc(t('vk_reply_t', { d: vkWhen(r.at) })) + '</b></p><p class="small vk-text">' + esc(String(r.text).slice(0, 600)) + '</p>' +
      (nums.length ? '<p class="small muted">' + esc(t('vk_chips')) + '</p><div class="chips">' + nums.map(function (n) { return '<button type="button" class="chip" data-act="vk-id-chip" data-v="' + n + '">' + n + '</button>'; }).join('') + '</div>' : '') + '</div>';
  }
  /** Підтягнути відповіді бота; «прийнято» після натискання «Відправити» — позначаємо запис переданим (підтверджено Водоканалом). */
  function vkLoad(force) {
    if (!window.TEPLO_API || !Y().account || VKR.busy || (!force && Date.now() - VKR.at < 15000)) return;
    VKR.busy = true; VKR.at = Date.now();
    Y().api('GET', '/vk/replies').then(function (j) {
      VKR.busy = false; if (j._status !== 200) return;
      var before = JSON.stringify(VKR.list); VKR.list = j.replies || []; var changed = before !== JSON.stringify(VKR.list);
      if (vkApply() || changed) safeRender();
    }, function () { VKR.busy = false; });
  }
  function vkApply() {
    var oks = (VKR.list || []).filter(function (r) { return r.kind === 'ok'; }), hit = false;
    if (!oks.length) return false;
    var used = {}; (S.water || []).forEach(function (w) { if (w.vkConf) used[w.vkConf.id] = 1; });
    // свіжіші натискання — першими: відповідь належить останньому запису, відправленому до неї
    (S.water || []).filter(function (w) { return w && !w.deleted && w.vkAt && !wsentVk(w); }).sort(function (a, b) { return b.vkAt - a.vkAt; }).forEach(function (w) {
      var r = oks.filter(function (x) { return !used[x.id] && x.at * 1000 >= w.vkAt - 120000; }).sort(function (a, b) { return a.at - b.at; })[0]; if (!r) return;
      used[r.id] = 1; w.sent = Object.assign({}, w.sent || {}, { vk: today() }); w.vkConf = { id: r.id, at: r.at, text: String(r.text || '').slice(0, 300) }; w.updatedAt = Date.now(); hit = true;
    });
    if (hit) { save(); toast(t('vk_conf_toast')); }
    return hit;
  }
  /** Що люди роблять з ботом Водоканалу — для статусу «бот відповідає / не відповідає з …» (сервер, VkStatus). */
  function vkEvent(kind) { if (window.TEPLO_API && Y().account) Y().api('POST', '/vk/event', { kind: kind }).then(function (j) { if (j && j.status) { VKS.data = j.status; VKS.at = Date.now(); safeRender(); } }, function () {}); }
  var VKS = { data: null, at: 0, busy: false };
  function vksLoad() {
    if (!window.TEPLO_API || VKS.busy || Date.now() - VKS.at < 60000) return; VKS.busy = true; VKS.at = Date.now();
    fetch(window.TEPLO_API + '/vk/status', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (j) {
      VKS.busy = false; var was = JSON.stringify(VKS.data); VKS.data = j; if (was !== JSON.stringify(j)) safeRender();
    }, function () { VKS.busy = false; });
  }
  /** Рядок статусу бота (і кабінету) у блоці Водоканалу. */
  function vkStatusLine() {
    vksLoad(); var d = VKS.data; if (!d) return '';
    var b = d.bot || {}, c = d.cab || null, out = '';
    if (b.state === 'silent') out += '<p class="vk-st warn small" data-key="vk-bot-silent">' + ico('alert', 16) + ' ' + esc(t('vk_bot_silent', { d: vkWhen(b.since), n: b.users })) + '</p>';
    else if (b.state === 'ok' && b.lastOk) out += '<p class="vk-st ok small muted" data-key="vk-bot-ok">' + esc(t('vk_bot_ok', { d: vkWhen(b.lastOk) })) + '</p>';
    // кабінет — лише якщо наш сервер хоч раз його відкрив (інакше, може, сайт не пускає закордонні адреси — не лякаємо)
    if (c && c.everOk) out += '<p class="vk-st small ' + (c.state === 'ok' ? 'muted' : 'warn') + '" data-key="vk-cab-' + c.state + '">' + esc(t(c.state === 'ok' ? 'vk_cab_ok' : 'vk_cab_down', { d: vkWhen(c.state === 'ok' ? c.at : c.since) })) + '</p>';
    return out;
  }
  // ---------- кабінет Водоканалу «без реєстрації»: показання вносить наш сервер (VkCab, app/vkcab.php) ----------
  // Людина натискає «Перевірити на сайті Водоканалу» → бачить, що бачить сайт (лічильники, останні показання), → «Відправити на сайт
  // Водоканалу» → сервер вводить рахунок і прізвище, заповнює форму й надсилає; «прийнято» → передано (підтверджено). ID для бота не потрібні.
  var VKC = { key: '', busy: '', check: null, err: null, res: null, pick: {} };
  function vkcAvail() { var c = VKS.data && VKS.data.cab; return !!(window.TEPLO_API && c && c.everOk && c.state === 'ok' && c.send !== false); }
  function vkcOn() { return vkcAvail() && !!Y().account; }
  /** Чого бракує для шляху «через сайт»: '' — сайт не відкривається (лише бот), 'login', 'acc' (рахунок ≥ 5 цифр і прізвище), 'ok'. */
  function vkcGate() { if (!vkcAvail()) return ''; if (!Y().account) return 'login'; var c = wcfg(); return String(c.account || '').replace(/\D/g, '').length >= 5 && String(c.surname || '').trim() ? 'ok' : 'acc'; }
  function vkcHead() { return '<div class="vkc" data-key="vkc"><p class="vkc-t"><b>' + esc(t('vkc_t')) + '</b></p>'; }
  /** Показань цього місяця ще немає: шлях через сайт видно одразу — що потрібно (вхід, рахунок), «Перевірити» (що бачить сайт). */
  function vkcPre(g, kind, ms) {
    if (g === 'login') return vkcHead() + '<p class="small">' + esc(t('vkc_login')) + '</p><p><a class="btn sec" href="#login" data-key="vkc-login">' + esc(t('login')) + '</a></p></div>';
    if (g === 'acc') return vkcHead() + '<p class="small">' + esc(t('vkc_need_acc')) + '</p>' + waccForm() + '</div>';
    return vkcBox(null, ms) + '<p class="small" data-key="vk-need-rec">' + esc(t('vkc_need_rec')) + '</p>' +
      '<div class="row-actions"><button class="btn" data-act="wnew" data-kind="' + esc(kind || (wmeters('hot').length ? 'hot' : 'cold')) + '" data-key="vkc-add">' + ico('plus', 18) + '<span>' + esc(t('wn_title')) + '</span></button></div>';
  }
  function vkcKey() { var c = wcfg(); return (place() ? place().id : '') + '|' + String(c.account || '').replace(/\D/g, '') + '|' + String(c.surname || '').trim().toLowerCase(); }
  function vkcFresh() { if (VKC.key !== vkcKey()) { VKC.key = vkcKey(); VKC.check = null; VKC.err = null; VKC.res = null; VKC.pick = {}; } }
  function vkcDigits(s) { return String(s || '').replace(/\D/g, '').replace(/^0+/, ''); }
  /** Наші водоміри ↔ лічильники на сайті: збережений вибір, номер, вид (холодна/гаряча), останній з одним. → {mid: key|''} */
  function vkcMap(ms, cms) {
    var out = {}, used = {};
    ms.forEach(function (m) { if (m.cabKey !== undefined && (m.cabKey === '' || cms.some(function (c) { return c.key === m.cabKey; }))) { out[m.id] = m.cabKey; if (m.cabKey) used[m.cabKey] = 1; } });
    ms.forEach(function (m) { if (out[m.id] !== undefined || !vkcDigits(m.serial)) return; var c = cms.filter(function (c) { return !used[c.key] && vkcDigits(c.serial) && (vkcDigits(c.serial) === vkcDigits(m.serial) || vkcDigits(c.label).indexOf(vkcDigits(m.serial)) >= 0); })[0]; if (c) { out[m.id] = c.key; used[c.key] = 1; } });
    ['cold', 'hot'].forEach(function (k) {
      var mine = ms.filter(function (m) { return out[m.id] === undefined && m.kind === k; }), theirs = cms.filter(function (c) { return !used[c.key] && c.kind === k; });
      if (mine.length === 1 && theirs.length === 1) { out[mine[0].id] = theirs[0].key; used[theirs[0].key] = 1; }
    });
    var restM = ms.filter(function (m) { return out[m.id] === undefined; }), restC = cms.filter(function (c) { return !used[c.key]; });
    if (restM.length === 1 && restC.length === 1) out[restM[0].id] = restC[0].key;
    return out;
  }
  function vkcLabel(c) { return [c.serial ? '№ ' + c.serial : '', c.kind ? t(c.kind === 'hot' ? 'wt_hot' : 'wt_cold') : ''].filter(Boolean).join(' · ') || c.label; }
  function vkcPrev(c) { return c.prev !== null && c.prev !== undefined ? t('vkc_prev', { v: c.prev }) + (c.prevDate ? ' (' + c.prevDate + ')' : '') : ''; }
  /** Що підемо відправляти: [{m, c, v}] — наші показання цього запису з лічильником на сайті. */
  function vkcItems(rec, ms) {
    if (!VKC.check) return [];
    var map = vkcMap(ms, VKC.check.meters);
    return ms.filter(function (m) { return hasVal(rec, m.id) && map[m.id]; }).map(function (m) { return { m: m, c: VKC.check.meters.filter(function (c) { return c.key === map[m.id]; })[0], v: Wt.whole(rec.vals[m.id]) }; }).filter(function (x) { return x.c; });
  }
  function vkcBox(rec, ms) {
    vkcFresh(); var c = wcfg(), acc = String(c.account || '').replace(/\D/g, ''), sn = String(c.surname || '').trim();
    var h = vkcHead();
    if (rec && wsentVk(rec)) {   // уже передано: підтвердження (сайтом чи ботом) зверху, повтор — тихо; позначили самі — нічого не додаємо
      if (!rec.vkConf) return '';
      return h + vkReplyBox(rec) + '<p class="small"><button class="linkbtn" data-act="vkc-again" data-id="' + esc(rec.id) + '" data-key="vkc-again">' + esc(t('vkc_again')) + '</button></p></div>';
    }
    if (rec && VKC.res && VKC.res.recId === rec.id && VKC.res.result !== 'ok') h += '<div class="vk-reply bad" role="alert" data-key="vkc-res-' + VKC.res.result + '"><p class="small"><b>' + esc(t(VKC.res.result === 'err' ? 'vkc_err' : 'vkc_unknown')) + '</b></p>' + (VKC.res.text ? '<p class="small vk-text">' + esc(VKC.res.text) + '</p>' : '') + '</div>';
    if (VKC.err) h += '<div class="banner warn" role="alert" data-key="vkc-err-' + esc(VKC.err.error || 'x') + '">' + ico('alert', 20) + '<div><p>' + esc(VKC.err.human || t('vkc_fail')) + '</p>' + (VKC.err.site && VKC.err.site.length ? '<p class="small muted">' + esc(t('vkc_site_says')) + ' «' + esc(VKC.err.site.join(' ')) + '»</p>' : '') + '</div></div>';
    if (!VKC.check) {
      return h + '<p class="small muted">' + esc(t('vkc_lead', { a: acc, f: sn })) + '</p><div class="row-actions"><button class="btn" data-act="vkc-check" data-key="vkc-check"' + (VKC.busy ? ' disabled' : '') + '>' +
        (VKC.busy === 'check' ? SPIN + '<span>' + esc(t('vkc_checking')) + '</span>' : ico('check', 18) + '<span>' + esc(t(VKC.err ? 'vkc_retry' : 'vkc_check')) + '</span>') + '</button></div></div>';
    }
    // сайт знайшов рахунок: наші водоміри ↔ його лічильники, попередження, «Перевірте» і «Відправити»
    var cms = VKC.check.meters, map = vkcMap(ms, cms), withVal = ms.filter(function (m) { return hasVal(rec, m.id); });
    h += '<p class="small" data-key="vkc-found">' + ico('check', 16) + ' ' + esc(t('vkc_found', { a: acc })) + (VKC.check.addr ? ' · ' + esc(VKC.check.addr) : '') + '</p>';
    // показань ще немає — лише що бачить сайт: наші водоміри ↔ його лічильники з останніми показаннями (відправка — після внесення)
    if (!rec) {
      var rest = cms.filter(function (x) { return !ms.some(function (m) { return map[m.id] === x.key; }); });
      return h + '<ul class="vkc-list" data-key="vkc-site">' + ms.map(function (m) { var cm = cms.filter(function (x) { return x.key === map[m.id]; })[0];
          return '<li data-key="vkc-s-' + esc(m.id) + '"><div class="vkc-row"><span>' + esc(wname(m)) + (m.serial ? ' <span class="muted small">№ ' + esc(m.serial) + '</span>' : '') + '</span></div><p class="small muted">' +
            (cm ? esc(t('vkc_on_site', { m: vkcLabel(cm) })) + (vkcPrev(cm) ? ' · ' + esc(vkcPrev(cm)) : '') : esc(t('vkc_not_matched'))) + '</p></li>'; }).join('') +
        rest.map(function (x) { return '<li data-key="vkc-s-' + esc(x.key) + '"><p class="small muted">' + esc(t('vkc_site_only', { m: vkcLabel(x) })) + (vkcPrev(x) ? ' · ' + esc(vkcPrev(x)) : '') + '</p></li>'; }).join('') + '</ul></div>';
    }
    var unsure = withVal.some(function (m) { var c0 = cms.filter(function (x) { return x.key === map[m.id]; })[0]; return m.cabKey === undefined && c0 && !(vkcDigits(m.serial) && vkcDigits(c0.label).indexOf(vkcDigits(m.serial)) >= 0); }) && cms.length > 1;
    h += '<ul class="vkc-list">' + withVal.map(function (m) {
      var cur = map[m.id] || '', cm = cms.filter(function (x) { return x.key === cur; })[0], v = Wt.whole(rec.vals[m.id]);
      var less = cm && cm.prev !== null && cm.prev !== undefined && v < cm.prev;
      return '<li data-key="vkc-m-' + esc(m.id) + '"><div class="vkc-row"><span>' + esc(wname(m)) + (m.serial ? ' <span class="muted small">№ ' + esc(m.serial) + '</span>' : '') + '</span><b class="num">' + v + '</b></div>' +
        (!cm || VKC.pick[m.id] ? '<fieldset class="vkc-pick"><legend class="small">' + esc(t('vkc_which')) + '</legend>' + cms.map(function (x) {
          return '<label class="vkc-opt"><input type="radio" name="vkc-' + esc(m.id) + '" data-wm="' + esc(m.id) + '" data-wf="cabKey" value="' + esc(x.key) + '"' + (x.key === cur ? ' checked' : '') + '><span>' + esc(vkcLabel(x)) + (vkcPrev(x) ? ' <span class="muted">· ' + esc(vkcPrev(x)) + '</span>' : '') + '</span></label>'; }).join('') +
          '<label class="vkc-opt"><input type="radio" name="vkc-' + esc(m.id) + '" data-wm="' + esc(m.id) + '" data-wf="cabKey" value=""' + (!cur ? ' checked' : '') + '><span>' + esc(t('vkc_none')) + '</span></label></fieldset>'
        : '<p class="small muted">' + esc(t('vkc_on_site', { m: vkcLabel(cm) })) + (vkcPrev(cm) ? ' · ' + esc(vkcPrev(cm)) : '') +
          (cms.length > 1 ? ' <button class="linkbtn" data-act="vkc-pick" data-id="' + esc(m.id) + '" data-key="vkc-pick-' + esc(m.id) + '">' + esc(t('vkc_other')) + '</button>' : '') + '</p>') +
        (less ? '<p class="small warn-ink" data-key="vkc-less">' + ico('alert', 16) + ' ' + esc(t('vkc_less', { p: cm.prev })) + '</p>' : '') + '</li>';
    }).join('') + '</ul>';
    var items = vkcItems(rec, ms), keys = items.map(function (x) { return x.c.key; }), dup = keys.some(function (k, i) { return keys.indexOf(k) !== i; });
    if (dup) h += '<p class="small warn-ink" data-key="vkc-dup">' + ico('alert', 16) + ' ' + esc(t('vkc_dup')) + '</p>';
    else if (!items.length) h += '<p class="small warn-ink" data-key="vkc-nomap">' + esc(t('vkc_nomap')) + '</p>';
    else h += '<div class="vkc-sum" data-key="vkc-sum"><p class="small"><b>' + esc(t('vkc_check_t')) + '</b></p><p class="small">' + esc(t('vkc_acc_line', { a: acc, f: sn })) + '</p><ul class="small">' +
      items.map(function (x) { return '<li>' + esc(wname(x.m)) + ' → <b>' + x.v + '</b> <span class="muted">(' + esc(vkcLabel(x.c)) + ')</span></li>'; }).join('') + '</ul>' + (unsure ? '<p class="small muted">' + esc(t('vkc_unsure')) + '</p>' : '') + '</div>';
    h += '<div class="row-actions"><button class="btn" data-act="vkc-send" data-id="' + esc(rec.id) + '" data-key="vkc-send"' + (VKC.busy || dup || !items.length ? ' disabled' : '') + '>' +
      (VKC.busy === 'send' ? SPIN + '<span>' + esc(t('vkc_sending')) + '</span>' : ico('send', 18) + '<span>' + esc(t('vkc_send')) + '</span>') + '</button>' +
      '<button class="btn sec" data-act="vkc-cancel" data-key="vkc-cancel"' + (VKC.busy ? ' disabled' : '') + '>' + esc(t('cancel')) + '</button></div></div>';
    return h;
  }
  function vkcCheck() {
    var c = wcfg(); vkcFresh(); VKC.busy = 'check'; VKC.err = null; VKC.res = null; safeRender();
    Y().api('POST', '/vk/cab/check', { acc: c.account, fam: c.surname, lang: S.lang }).then(function (j) {
      VKC.busy = ''; if (j._status === 200 && j.meters) VKC.check = j; else VKC.err = { error: j.error, human: j.human || t('vkc_fail'), site: j.site || [] }; render(true);
    }, function () { VKC.busy = ''; VKC.err = { error: 'net', human: t('vkc_fail') }; render(true); });
  }
  function vkcSend(recId) {
    var rec = (S.water || []).filter(function (x) { return x.id === recId; })[0]; if (!rec || !VKC.check || VKC.busy) return;
    var c = wcfg(), items = vkcItems(rec, wmeters());
    if (!items.length) return;
    VKC.busy = 'send'; VKC.res = null; VKC.err = null; safeRender();
    Y().api('POST', '/vk/cab/send', { acc: c.account, fam: c.surname, lang: S.lang, items: items.map(function (x) { return { key: x.c.key, value: String(x.v), serial: x.c.serial || null, name: wname(x.m) }; }) }).then(function (j) {
      VKC.busy = '';
      if (j._status === 200 && j.ok) {
        // переданим вважаємо лише той запис, з якого відправили; ключ лічильника на сайті запам'ятовуємо
        wsetCfg(function (cf) { (cf.meters || []).forEach(function (m) { items.forEach(function (x) { if (x.m.id === m.id) m.cabKey = x.c.key; }); }); });
        rec.sent = Object.assign({}, rec.sent || {}, { vk: today() }); rec.vkConf = { id: j.id, at: j.at, text: String(j.text || '').slice(0, 300), via: 'cab' }; delete rec.vkAt; rec.updatedAt = Date.now();
        VKC.res = null; VKC.check = null; save(); toast(t('vkc_ok_toast'));
      } else if (j._status === 200) VKC.res = { recId: recId, result: j.result, text: j.text };
      else if (j._status === 409 && j.meters) { VKC.check = Object.assign({}, VKC.check, { meters: j.meters }); VKC.err = { error: j.error, human: j.human }; }
      else VKC.err = { error: j.error, human: j.human || t('vkc_fail'), site: j.site || [] };
      render(true);
    }, function () { VKC.busy = ''; VKC.err = { error: 'net', human: t('vkc_fail') }; render(true); });
  }
  function vkPending() { return (S.water || []).some(function (w) { return w && !w.deleted && w.vkAt && !wsentVk(w) && Date.now() - w.vkAt < 30 * 60000; }) || Date.now() - VKR.idsAt < 30 * 60000; }
  VKR.idsAt = 0;
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && (vkPending() || /^(water-|wrec-|wnew)/.test(routeName()))) { vkLoad(true); safeRender(); } });
  setInterval(function () { if (document.visibilityState === 'visible' && vkPending()) vkLoad(); }, 20000);
  function waccForm() {
    var c = wcfg();
    return waccFields('w', c);
  }
  /** Особовий рахунок Водоканалу і прізвище (одні на квартиру) — поля з копіюванням. pre — префікс id (на сторінці може бути двічі). */
  function waccFields(pre, c) {
    return '<div class="grid2"><div class="field"><label for="' + pre + '-acc">' + esc(t('wa_acc')) + '</label><div class="ctl"><input id="' + pre + '-acc" class="num" inputmode="numeric" autocomplete="off" data-wcfg="account" value="' + esc(c.account || '') + '">' + ctlCopy(pre + '-acc') + '</div><div class="help">' + esc(t('wa_acc_h')) + '</div></div>' +
      '<div class="field"><label for="' + pre + '-sn">' + esc(t('wa_sn')) + '</label><div class="ctl"><input id="' + pre + '-sn" autocomplete="family-name" data-wcfg="surname" value="' + esc(c.surname || '') + '">' + ctlCopy(pre + '-sn') + '</div><div class="help">' + esc(t('wa_sn_h')) + '</div></div></div>';
  }
  function wmeterIdForm() {
    return '<div class="grid2">' + wmeters().map(function (m) { return '<div class="field"><label for="wid-' + m.id + '">' + esc(t('wm_vkid_for', { m: wname(m) })) + '</label><div class="ctl"><input id="wid-' + m.id + '" class="num" inputmode="numeric" autocomplete="off" data-wm="' + m.id + '" data-wf="vkId" value="' + esc(m.vkId || '') + '"></div></div>'; }).join('') + '</div>' +
      '<p><button class="btn sec" data-act="wrefresh">' + esc(t('wm_ids_done')) + '</button></p>';
  }
  function wwater(kind) {
    var ms = wmeters(kind), title = wkindTitle(kind);
    if (!ms.length) return { screen: 'S30', route: 'water-' + kind, html: '<h1>' + esc(title) + '</h1><div class="panel"><p>' + esc(t('uc_w_empty')) + '</p><button class="btn big" data-act="wsetup" data-kind="' + kind + '" data-key="water-setup">' + esc(t('uc_w_setup_btn')) + '</button></div>' + wsendPanel(null, kind) };
    var last = wlast(), h = '<h1 class="sr">' + esc(title) + (place() && place().name ? ' — ' + esc(place().name) : '') + '</h1>';
    ms.forEach(function (m) { h += gapBanner(m.id); });
    // табло кожного водоміра — як екран тепла: останні показання, дата, повірка
    var left = ms.map(function (m, i0) {
      var r = wprevFor(m.id), days = m.verifiedUntil ? R.daysBetween(today(), m.verifiedUntil) : null, sc = null, cap;
      if (r && r.gap) cap = t('wm_cap_gap', { d: fmtDate(r.date, true) });
      else { sc = sentCap(wrecs().filter(function (x) { return hasVal(x, m.id); }), function (x) { return x.base ? baseSent(x) : wsentVk(x) && (kind === 'cold' || wsentHtm(x)); }); r = sc.rec; cap = sc.cap; }
      var ver = days === null ? '' : days < 0 ? '<span class="pill warn">' + esc(t('wm_ver_exp')) + '</span>' : days <= 60 ? '<span class="pill warn">' + esc(t('mv_soon', { n: days })) + '</span>' : esc(t('pl_ver', { d: R.toHtmDate(m.verifiedUntil) }));
      return mbox({ key: 'wmeter-' + m.id, id: m.id, kind: kind, icon: 'drop', cls: kind === 'hot' ? 'c-hot' : 'c-cold', name: ms.length > 1 ? wname(m) : title,
        display: wdrum(r ? r.vals[m.id] : null, kind, 'hero'), cap: cap, copy: r && r.vals && r.vals[m.id] !== undefined && r.vals[m.id] !== '' ? Wt.whole(r.vals[m.id]) : '', body: sc && sc.note ? '<p class="small muted mb-newer">' + esc(sc.note) + '</p>' : '',
        meta: [ver, m.vkId ? esc(t('mb_vkid', { v: m.vkId })) : ''].filter(Boolean),
        // «Налаштування показань» — акордеон: рахунок, №, ціна (владелец 05.11 21:35–21:40: «верни аккордеон… переназови»)
        set: wmeterFields(m, i0 === 0) + (i0 === 0 ? priceBlock(kind) : '') + gapSetLink(m.id) , setTitle: t('mb_set_read') });
    }).join('');
    var right = '<button class="btn big block" data-act="wnew" data-kind="' + kind + '" data-key="water-add">' + ico('plus', 22) + '<span>' + esc(t('wn_title')) + '</span></button>' +
      (VIS().local ? '<input type="file" id="wq-files" accept="image/*" multiple class="sr" data-kind="' + kind + '"><label for="wq-files" class="btn sec block wq-photo" tabindex="0" data-key="water-photo">' + ico('camera', 22) + '<span>' + esc(t('ph_entry')) + '</span></label>' : '');
    // куди передати: є показання цього місяця — з готовими цифрами, інакше — куди й до якого числа
    right += whereAcc(wsendPanel(last && thisMonth(last.date) ? last : null, kind));
    // історія: останні три (разом із періодами без лічильника), решта — у вкладці «Історія»
    var wr = wrows(kind, 3);
    if (wr.total) right += '<h2 class="section-title">' + esc(t('wh_title')) + '</h2>' + wr.html + (wr.total > 3 ? '<p><button class="btn sec" data-act="view-go" data-v="' + kind + '" data-to="history" data-key="water-all">' + esc(t('wh_all', { n: wr.total })) + '</button></p>' : '');
    right += '<details class="tips-box" style="margin-top:16px"><summary>' + esc(t('wt_how_t')) + '</summary><ul>' + t(kind === 'hot' ? 'wt_how_hot' : 'wt_how_cold').split('|').map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></details>';
    h += '<div class="hero-grid"><div class="wm-col">' + left + '</div><div>' + right + '</div></div>';
    return { screen: 'S30', route: 'water-' + kind, html: h };
  }
  V['water-hot'] = function () { return wwater('hot'); };
  V['water-cold'] = function () { return wwater('cold'); };

  // ================= фото к записям истории (тепло и вода) =================
  // rec.photos = [{id, meter?}]: id — фото на сервере (вошли: хранится, пока есть запись) или 'l:…' — только в этом браузере
  // (IndexedDB «teplo-hist»), пока человек не вошёл; после входа такие догружаются на сервер и id меняется.
  var HP = { urls: {}, flushing: false, missing: {}, failed: {} };
  var HIST = {
    db: function () {
      return new Promise(function (ok, bad) {
        if (!window.indexedDB) return bad(new Error('no_idb'));
        var rq = indexedDB.open('teplo-hist', 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('files'); };
        rq.onsuccess = function () { ok(rq.result); }; rq.onerror = function () { bad(rq.error); };
      });
    },
    tx: function (mode, fn) {
      return HIST.db().then(function (db) { return new Promise(function (ok) {
        var tx = db.transaction('files', mode), out = fn(tx.objectStore('files'));
        tx.oncomplete = function () { db.close(); ok(out && out.result !== undefined ? out.result : out); };
        tx.onerror = tx.onabort = function () { db.close(); ok(null); };
      }); }).catch(function () { return null; });
    },
    put: function (id, blob) { return HIST.tx('readwrite', function (st) { st.put({ blob: blob, type: blob.type || 'image/jpeg', at: Date.now() }, id); }); },
    get: function (id) { return HIST.tx('readonly', function (st) { return st.get(id); }).then(function (v) { return v && v.blob ? v.blob : null; }); },
    del: function (id) { return HIST.tx('readwrite', function (st) { st['delete'](id); }); },
    keys: function () { return HIST.tx('readonly', function (st) { return st.getAllKeys ? st.getAllKeys() : null; }).then(function (k) { return k || []; }); }
  };
  function lid() { return 'l:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function hpUrl(id) { return /^l:/.test(id) ? (HP.urls[id] || '') : (window.TEPLO_API ? window.TEPLO_API + '/photo?id=' + encodeURIComponent(id) : ''); }
  /** Фото к записи (сохранить сейчас): items — [{file, meter?, url?}]; File с _srv уже лежит на сервере. → [{id, meter?}] */
  function photoRefs(items) {
    var keep = [];
    var refs = (items || []).filter(function (it) { return it && it.file; }).map(function (it) {
      var f = it.file, id = f._srv || lid();
      if (f._srv) keep.push(id);
      else {
        if (it.url) HP.urls[id] = it.url; else { try { HP.urls[id] = URL.createObjectURL(f); } catch (e) { /* нет */ } }
        Promise.resolve(VIS().prepare ? VIS().prepare(f) : f).then(function (b) { return HIST.put(id, b || f); }).then(function () { histFlush(); });
      }
      return it.meter ? { id: id, meter: it.meter } : { id: id };
    });
    if (keep.length) photoKeep(keep.map(function (id) { return { id: id }; }), true);
    return refs;
  }
  /** Сервер: фото записи хранить, пока есть запись (on) / снова как обычные — удалятся через срок хранения (off). */
  function photoKeep(list, on) {
    var ids = (list || []).map(function (p) { return p && p.id; }).filter(Boolean);
    ids.filter(function (id) { return /^l:/.test(id); }).forEach(function (id) { if (!on) HIST.del(id); });
    var srv = ids.filter(function (id) { return !/^l:/.test(id); });
    if (srv.length && window.TEPLO_API && Y().account) api0('/photo/keep', { method: 'POST', body: JSON.stringify({ ids: srv, keep: !!on }) }).catch(function () {});
  }
  function allRecs() { return (S.readings || []).concat(S.water || [], S.mrecs || []).filter(function (r) { return r && !r.deleted; }); }
  /** Вошли — догрузить фото, которые пока только в этом браузере; заменить id во всех записях. Лишнее из IndexedDB — убрать. */
  function histFlush() {
    if (HP.flushing || !window.TEPLO_API || !Y().account) return;
    var pend = {}; allRecs().concat(S.draft ? [S.draft] : []).forEach(function (r) { (r.photos || []).forEach(function (p) { if (p && /^l:/.test(p.id)) pend[p.id] = 1; }); });
    // не получилось загрузить — повторим не раньше чем через 10 минут (не долбить сервер на каждой перерисовке)
    var ids = Object.keys(pend).filter(function (id) { return !(HP.failed[id] > Date.now() - 600000); }); if (!ids.length) return;
    HP.flushing = true;
    var chain = Promise.resolve();
    ids.forEach(function (lidv) {
      chain = chain.then(function () { return HIST.get(lidv); }).then(function (b) {
        if (!b) return null;
        var c = (document.cookie.match(/(?:^|; )ts_csrf=([^;]*)/) || [])[1] || '';
        return fetch(window.TEPLO_API + '/recognize/upload', { method: 'POST', body: b, credentials: 'same-origin', headers: { 'Content-Type': b.type || 'image/jpeg', 'X-CSRF': c, Accept: 'application/json' } })
          .then(function (r) { return r.ok ? r.json() : null; }, function () { return null; }).then(function (j) {
            if (!j || !j.id) { HP.failed[lidv] = Date.now(); return; }
            var sid = j.id;
            allRecs().concat(S.draft ? [S.draft] : []).forEach(function (r) { (r.photos || []).forEach(function (p) { if (p.id === lidv) { p.id = sid; if (r.updatedAt) r.updatedAt = Date.now(); } }); });
            if (HP.urls[lidv]) HP.urls[sid] = HP.urls[lidv];
            save(); photoKeep([{ id: sid }], true); return HIST.del(lidv);
          });
      });
    });
    chain.then(function () { HP.flushing = false; }, function () { HP.flushing = false; });
  }
  /** «Додати фото показань» к уже сохранённой записи (h:/w:/m: + id): фото — к записи, как при вводе. */
  document.addEventListener('change', function (e) {
    var fi = e.target; if (!fi || fi.id !== 'rp-input' || !fi.files || !fi.files.length) return;
    var ref = fi.getAttribute('data-ref') || '', k = ref.slice(0, 1), id = ref.slice(2), fs = Array.prototype.slice.call(fi.files, 0, 8); fi.value = '';
    var rec = ((k === 'h' ? S.readings : k === 'w' ? S.water : S.mrecs) || []).filter(function (x) { return x && !x.deleted && x.id === id; })[0]; if (!rec) return;
    rec.photos = (rec.photos || []).concat(photoRefs(fs.map(function (f) { return rec.meter ? { file: f, meter: rec.meter } : { file: f }; })));
    rec.updatedAt = Date.now(); save(); toast(t('rp_added')); render(true);
  });
  /** Миниатюры фото записи; нажатие — просмотр на весь экран. gal — имя набора для листания; ref — можно добавить фото. */
  function photoStrip(list, gal, ref) {
    list = (list || []).filter(function (p) { return p && p.id; }); if (!list.length && !ref) return '';
    var add = ref ? '<input type="file" id="rp-input" class="sr" tabindex="-1" accept="image/*" multiple data-ref="' + esc(ref) + '" aria-label="' + esc(t('rp_add')) + '">' +
      '<p><label for="rp-input" class="btn sec" tabindex="0" data-key="rec-photo-add">' + ico('camera', 18) + '<span>' + esc(t('rp_add')) + '</span></label></p>' : '';
    if (!list.length) return '<section class="hphotos" data-key="rec-photos"><h2 class="section-title">' + ico('camera', 18) + ' ' + esc(t('rp_title')) + '</h2>' + add + '</section>';
    return '<section class="hphotos" data-key="rec-photos"><h2 class="section-title">' + ico('camera', 18) + ' ' + esc(t('hp_title')) + '</h2><ul class="thumbs">' + list.map(function (p, i) {
      var u = hpUrl(p.id), m = p.meter ? wmeters().filter(function (x) { return x.id === p.meter; })[0] : null;
      var gone = HP.missing[p.id] || (!u && !/^l:/.test(p.id));
      return '<li' + (gone ? ' class="gone"' : '') + '><img data-gal="' + esc(gal) + '" data-i="' + i + '" data-hph="' + esc(p.id) + '"' + (u ? ' src="' + esc(u) + '"' : '') + ' alt="' + esc(t('ph_from', { n: i + 1 })) + '" loading="lazy">' +
        (m ? '<span class="n ' + (m.kind === 'hot' ? 'n-hot' : 'n-cold') + '">' + esc(m.name || t('kv_' + m.kind)) + '</span>' : '') + '<span class="gone-t">' + esc(t('hp_gone')) + '</span></li>';
    }).join('') + '</ul>' + add + '</section>';
  }
  /** После отрисовки: подставить фото из IndexedDB; нет на этом устройстве / удалено — подпись вместо картинки. */
  function photoFill() {
    Array.prototype.forEach.call(document.querySelectorAll('img[data-hph]:not([src])'), function (im) {
      var id = im.getAttribute('data-hph'); if (!/^l:/.test(id)) return;
      HIST.get(id).then(function (b) {
        if (!b) { HP.missing[id] = 1; if (im.parentNode) im.parentNode.classList.add('gone'); return; }
        HP.urls[id] = HP.urls[id] || URL.createObjectURL(b); im.src = HP.urls[id];
      });
    });
  }
  document.addEventListener('error', function (e) { var im = e.target; if (im && im.tagName === 'IMG' && im.hasAttribute('data-hph')) { HP.missing[im.getAttribute('data-hph')] = 1; if (im.parentNode) im.parentNode.classList.add('gone'); } }, true);
  document.addEventListener('click', function (e) {
    var im = e.target.closest && e.target.closest('img[data-gal]'); if (!im || !im.getAttribute('src')) return;
    e.preventDefault();
    var set = Array.prototype.filter.call(document.querySelectorAll('img[data-gal="' + im.getAttribute('data-gal') + '"]'), function (x) { return x.getAttribute('src'); });
    photoViewer(Math.max(0, set.indexOf(im)), set.map(function (x) { return x.getAttribute('src'); }));
  });

  // ================= общие вкладки «Історія / Статистика / Економія»: опалення, гаряча, холодна =================
  /** Что есть в квартире: теплосчётчик и/или водомеры каждого вида. */
  function kinds() {
    var k = []; if (hasHeat() || (S.meter && RD().length)) k.push('heat');
    ['hot', 'cold'].forEach(function (x) { if (wmeters(x).length || wmeters(x, true).some(function (m) { return meterHasData(m.id); })) k.push(x); });
    ['elec', 'gas'].forEach(function (x) { if (smeters(x).length || smeters(x, true).some(function (m) { return meterHasData(m.id); })) k.push(x); });
    return k;
  }
  /** Что смотрим во вкладках (S.view); выбранного вида нет — первый, что есть. */
  function curView() { var ks = kinds(); return ks.indexOf(S.view) >= 0 ? S.view : (ks[0] || 'heat'); }
  function kindSwitch() {
    var ks = kinds(), cv = curView(); if (ks.length < 2) return '';
    return '<div class="kind-sw' + (ks.length > 3 ? ' many' : '') + '" role="group" aria-label="' + esc(t('kv_label')) + '" data-key="kind-switch">' + ks.map(function (k) {
      return '<button type="button" data-act="view" data-v="' + k + '" aria-pressed="' + (k === cv) + '" data-key="kind-' + k + '">' + ico(KINDS[k].icon, 18, KINDS[k].cls) + '<span>' + esc(t('kv_' + k)) + '</span></button>';
    }).join('') + '</div>';
  }
  function hasVal(r, mid) { return !!(r && r.vals && r.vals[mid] !== undefined && r.vals[mid] !== '' && r.vals[mid] !== null); }
  function wcostOf(kind, d, date) { return (kind === 'hot' ? Wt.cost(0, d, date, wtar()) : Wt.cost(d, 0, date, wtar())).total; }
  /** Строки истории воды по виду (новые сверху): дата, показания, сколько набежало и почём, передано, фото → карточка записи. */
  function wrows(kind, limit) {
    var ms = wmeters(kind, true), ser = Wt.series(wrecs(), wmeters(null, true), gaps());
    // передані — від попередньої переданої (за це платите); «для себе» — від попереднього будь-якого
    var paid = {}; Wt.series(wrecs().filter(function (r) { return !r.own; }), wmeters(null, true), gaps()).forEach(function (x) { paid[x.rec.id] = x; });
    var hasK = function (r) { return ms.some(function (m) { return hasVal(r, m.id); }); }, all = wrecs();
    var rows = ser.slice().reverse().filter(function (x) { return ms.some(function (m) { return hasVal(x.rec, m.id); }); });
    // периоды без водоміра — вперемешку с записями (по дате снятия)
    var gl = gaps().filter(function (g) { return ms.some(function (m) { return m.id === g.what; }); });
    rows = rows.map(function (x) { return { d: x.rec.date, x: x }; }).concat(gl.map(function (g) { return { d: g.from, g: g }; }))
      .sort(function (a, b) { return a.d < b.d ? 1 : a.d > b.d ? -1 : a.g ? -1 : 1; });
    var total = rows.length;
    if (limit) rows = rows.slice(0, limit);
    if (!rows.length) return { total: 0, html: '' };
    return { total: total, html: '<ul class="list wh" data-key="water-history-' + kind + '">' + rows.map(function (y) {
      if (y.g) return gapItem(y.g, ms.length > 1);
      var x = y.x, own = !!x.rec.own, pf = own || x.rec.base ? null : paidFrom(all, x.rec, hasK);
      if (pf && paid[x.rec.id]) x = paid[x.rec.id];
      var d = kind === 'hot' ? x.hot : x.cold, days = kind === 'hot' ? x.daysHot : x.daysCold;
      var vs = ms.map(function (m) { var v = Wt.whole(x.rec.vals && x.rec.vals[m.id]); return v === null ? '' : (ms.length > 1 ? (m.name || '') + ' ' : '') + v; }).filter(Boolean).join(', ');
      var sent = wsentVk(x.rec) && (kind === 'cold' || wsentHtm(x.rec)), np = (x.rec.photos || []).length;
      var has = !x.rec.base && d !== null;
      return histRow({ key: 'wrec-' + x.rec.id, href: '#wrec-' + x.rec.id, q: has ? '+' + d : null, unit: 'м³', money: has ? wcostOf(kind, d, x.rec.date) : null,
        none: x.rec.base ? t('wh_base') : t('hr_first'),
        date: fmtDate(x.rec.date, true), sub: [t('hr_on_meter', { v: vs.replace(/<[^>]+>/g, ''), u: 'м³' }), has && days ? days + '\u00a0' + t('days_short') : '', pf ? t('own_paid', { d: fmtDate(pf.date) }) + ' · ' + t('own_between', { n: pf.n }) : ''],
        right: (np ? '<span class="ph-n" title="' + esc(t('hp_n', { n: np })) + '">' + ico('camera', 16) + '<span class="num">' + np + '</span></span>' : '') + billMark(x.rec.bills),
        st: stChip('w', x.rec, kind, x.rec.base ? (baseSent(x.rec) ? 'sent' : 'not') : own ? 'own' : sent ? 'sent' : 'not') });
    }).join('') + '</ul>' };
  }
  function whistory(kind) {
    var wr = wrows(kind), head = '<h1>' + esc(t('hi_title')) + '</h1>' + kindSwitch();
    if (!wr.total) return { screen: 'S09', route: 'history', html: head + '<div class="panel"><p class="muted">' + esc(t('wh_empty')) + '</p><button class="btn" data-act="wnew" data-kind="' + kind + '">' + esc(t('wn_title')) + '</button></div>' };
    return { screen: 'S09', route: 'history', html: head + wr.html + '<p class="small muted">' + esc(t('wh_hint')) + '</p>' + gapAddLink(kind) };
  }
  /** Статистика: какие периоды без лічильника не вошли в графики. */
  function gapNote(list) {
    if (!list.length) return '';
    return '<div class="banner" data-key="stats-gaps">' + ico('wrench', 22) + '<div><p><b>' + esc(t('gp_stats_t')) + '</b></p><ul class="plain">' + list.map(function (g) {
      return '<li><a href="#gap-' + g.id + '">' + esc(gapPeriod(g)) + '</a> · ' + esc(t('gp_r_' + (g.reason || 'other')).toLowerCase()) + (list.some(function (x) { return x.what !== list[0].what; }) ? ' · ' + esc(gapMeterName(g)) : '') +
        (R.num(g.amount) !== null ? ' · ' + esc(t('gp_amount_sum', { a: money(R.num(g.amount)), n: fmtN(gapMonths(g), 1), s: money(R.num(g.amount) * gapMonths(g)) })) : (function () { var ge = gapEst(g); return ge && ge.cost > 0 ? ' · ' + esc(t('ge_row', { s: money(ge.cost), q: g.what === 'heat' ? fmtN(ge.gcal, 3) + ' Гкал' : fmtN(ge.m3, 1) + ' м³' })) : ''; })()) + '</li>';
    }).join('') + '</ul></div></div>';
  }
  /** Ссылка «лічильник знімали» — в историю, на страницу счётчика. */
  function gapAddLink(kind) {
    var what = kind === 'heat' ? 'heat' : (wmeters(kind)[0] || {}).id; if (!what) return '';
    return '<p class="gap-add"><a href="#gap-new-' + esc(what) + '" data-key="gap-add-' + kind + '">' + ico('wrench', 18) + '<span>' + esc(t('gp_add')) + '</span></a></p>';
  }
  /** Карточка записи воды: показания всех водомеров, сколько набежало и почём, передача, фото; правка и удаление. */
  function wrecView(id) {
    var r = wrecs().filter(function (x) { return x.id === id; })[0], back = '<p><a href="#history">← ' + esc(t('hi_title')) + '</a></p>';
    if (!r) return { screen: 'S09', route: 'history', html: back + '<p class="muted">' + esc(t('rec_gone')) + '</p>' };
    var x = Wt.series(wrecs(), wmeters(null, true), gaps()).filter(function (s0) { return s0.rec.id === id; })[0] || { by: {}, hot: null, cold: null };
    var ms = wmeters(null, true).filter(function (m) { return hasVal(r, m.id); }), h = back + '<h1>' + esc(fmtDate(r.date, true)) + '</h1>';
    if (r.base) h += '<p class="small muted">' + esc(t('wh_base')) + '</p>';
    h += '<ul class="list" data-key="wrec-values">' + ms.map(function (m) {
      var d = x.by[m.id];
      return '<li><div class="grow">' + ico('drop', 16, m.kind === 'hot' ? 'c-hot' : 'c-cold') + ' ' + esc(wname(m)) + (d !== undefined ? '<div class="small muted">+' + d + ' м³</div>' : '') + '</div><b class="num">' + esc(wfmt(r.vals[m.id])) + '</b> <span class="small muted">м³</span>' + copyIco(Wt.whole(r.vals[m.id]), 'wrec-copy-' + m.id) + '</li>';
    }).join('') + '</ul>' + photoStrip(r.photos, 'w' + r.id, 'w:' + r.id) + (r.base ? '' : billsBox('w:' + r.id, r.bills, t('bl_title', { m: monthLabel(String(r.date).slice(0, 7)) })));
    if (x.hot !== null || x.cold !== null) {
      var c = Wt.cost(x.cold || 0, x.hot || 0, r.date, wtar());
      h += '<div class="panel" style="margin-top:16px" data-key="wrec-used"><h2>' + esc(t('rec_used_title')) + '</h2><div class="cards2">' +
        (x.hot !== null ? '<div><div class="num big c-hot">' + x.hot + ' <small>м³</small></div><div class="small muted">' + esc(t('wr_hot_for', { d: x.daysHot })) + '</div></div>' : '') +
        (x.cold !== null ? '<div><div class="num big c-cold">' + x.cold + ' <small>м³</small></div><div class="small muted">' + esc(t('wr_cold_for', { d: x.daysCold })) + '</div></div>' : '') +
        '<div><div class="num big">≈ ' + esc(money(c.total)) + '</div><div class="small muted">' + esc(t('wr_uah')) + '</div></div></div>' +
        '<p class="small muted">' + esc(t('wr_parts', { vk: money(c.vk), htm: money(c.htm) })) + '</p></div>';
    }
    if (r.base) h += ownBox('w', r);
    if (!r.base && !r.own) {
      if (thisMonth(r.date)) h += whereAcc(wsendPanel(r), r.id);
      else h += '<p>' + (wsentVk(r) ? '<span class="pill ok">' + ico('check', 14) + ' ' + esc(t('wr_vk')) + '</span> ' : '<span class="pill neutral">' + esc(t('wr_vk')) + ': ' + esc(t('wh_notsent')) + '</span> ') +
        (wmeters('hot').length ? (wsentHtm(r) ? '<span class="pill ok">' + ico('check', 14) + ' ' + esc(t('wr_htm')) + '</span>' : '<span class="pill neutral">' + esc(t('wr_htm')) + ': ' + esc(t('wh_notsent')) + '</span>') : '') + '</p>';
    }
    h += '<div class="row-actions">' + (r.base ? '' : '<button class="btn sec" data-act="wedit" data-id="' + r.id + '" data-key="wrec-edit">' + esc(t('rec_edit')) + '</button>') + '<button class="btn danger" data-act="wdel" data-id="' + r.id + '" data-key="wrec-del">' + esc(t('rec_del')) + '</button></div>';
    if (!r.base) h += ownBox('w', r);   // «Позначити «лише для себе»» — внизу екрана (владелец 05.11)
    return { screen: 'S09', route: 'history', html: h };
  }
  function ymLabel(ym) { return ym.slice(5, 7) + '.' + ym.slice(2, 4); }
  /** Статистика воды: м³ по месяцам (месяц — по дате снятия), среднее, стоимость по тарифам. */
  function wstats(kind) {
    chColors();
    var mo = Wt.monthly(Wt.series(wrecs(), wmeters(null, true), gaps()), kind, wtar()), sm = Wt.summary(mo), head = '<h1>' + esc(t('stt_title')) + '</h1>' + kindSwitch();
    if (!mo.length) return { screen: 'S15', route: 'stats', html: head + '<div class="panel"><p class="muted">' + esc(t('wst_empty')) + '</p></div>' };
    var per = function (b) { return t('stt_period', { a: R.toHtmDate(b.from), b: R.toHtmDate(b.to), d: b.days }); };
    var tiles = kpi({ key: 'wstats-kpi', tone: kind, q: fmtN(sm.perMonth, 1), unit: 'м³', money: sm.uahMonth, cap: t('kpi_w_avg', { n: sm.months }),
      chips: [chip(t('kpi_w_last', { m: monthLabel(sm.last.ym), v: sm.last.m3, uah: money0(sm.last.cost) }), 'clock')] });
    var color = kind === 'hot' ? CH.hot : CH.cold;
    var c1 = barChart(mo.map(function (b) { return { x: ymLabel(b.ym), v: b.m3, top: String(b.m3), color: color,
      tip: [b.m3 + ' м³', per(b), '≈ ' + money(b.cost) + ' грн', b.days < 25 || b.days > 37 ? t('wst_per30', { v: fmtN(b.perMonth, 1) }) : ''] }; }), { title: t('wst_m3'), dec: 0 });
    var c2 = barChart(mo.map(function (b) { return { x: ymLabel(b.ym), v: Math.round(b.cost), top: String(Math.round(b.cost)), color: CH.barSoft,
      tip: ['≈ ' + money(b.cost) + ' грн', per(b), b.m3 + ' м³'] }; }), { title: t('wst_uah'), dec: 0 });
    var tr = Wt.tariffAt(today(), wtar());
    var trTxt = kind === 'hot' ? t('wst_tariff_hot', { hot: money(tr.hot), drain: money(tr.drain) }) : t('wst_tariff_cold', { supply: money(tr.supply), drain: money(tr.drain) });
    var table = '<details class="panel wacc tbl-acc" data-key="stt-table"><summary><h2>' + esc(t('stt_table')) + '</h2>' + ico('chev', 20, 'pacc-chev') + '</summary><div class="tbl-wrap where-b"><table class="tbl"><thead><tr><th>' + esc(t('wst_th_month')) + '</th><th>' + esc(t('stt_th_period')) + '</th><th>м³</th><th>грн</th></tr></thead><tbody>' +
      mo.slice().reverse().map(function (b) { return '<tr><td>' + esc(ymLabel(b.ym)) + '</td><td>' + esc(R.toHtmDate(b.from) + ' – ' + R.toHtmDate(b.to)) + '</td><td class="num">' + b.m3 + '</td><td class="num">' + money(b.cost) + '</td></tr>'; }).join('') + '</tbody></table></div></details>';
    var panel = function (title, sub, chart) { return '<section class="panel chart-panel"><h2>' + esc(title) + '</h2><p class="small muted">' + esc(sub) + '</p>' + chart + '</section>'; };
    return { screen: 'S15', route: 'stats', html: head + '<p class="muted">' + esc(t('wst_lead')) + '</p>' + tiles + gapNote(gaps().filter(function (g) { return wmeters(kind, true).some(function (m) { return m.id === g.what; }); })) + panel(t('wst_m3'), t('wst_m3_sub'), c1) + panel(t('wst_uah'), trTxt, c2) + table + '<p class="small muted">' + esc(t('wst_method')) + '</p>' };
  }
  /** Советы по воде (Харьков: Водоканал — холодная и отведение, ХТМ — горячая). */
  function wtips() {
    var tr = Wt.tariffAt(today(), wtar()), hot = money(tr.hot + tr.drain), cold = money(tr.supply + tr.drain), ru = S.lang === 'ru';
    return ru ? [
      ['Проверьте, нет ли утечки', 'Закройте все краны и 10–15 минут не пользуйтесь водой. Если красные ролики или «звёздочка» на циферблате водомера крутятся — где-то течёт. Чаще всего виноват бачок унитаза или капающий кран.'],
      ['Бачок унитаза', 'Подтекающий бачок может незаметно тратить сотни литров в сутки. Проверка: несколько капель пищевого красителя в бачок — если через 15–20 минут цвет появился в чаше, меняйте клапан или грушу.'],
      ['Капающий кран', 'Капля в секунду — это больше 10 м³ за год. Обычно достаточно заменить прокладку или картридж.'],
      ['Аэраторы на краны', 'Насадка-аэратор смешивает воду с воздухом: струя на ощупь такая же, а воды уходит заметно меньше. Стоит недорого, ставится руками вместо обычной сетки.'],
      ['Душ вместо ванны', 'Полная ванна — примерно 150–200 литров, 5 минут под душем — обычно 40–60. Экономная лейка уменьшает расход ещё сильнее.'],
      ['Не лейте воду зря', 'Закрывайте кран, пока чистите зубы, намыливаете руки или посуду: открытый кран — это 6–12 литров каждую минуту.'],
      ['Посудомойка и стиральная машина', 'Запускайте полностью загруженными, в режиме «эко». Посудомойка тратит на цикл примерно 10–15 литров — меньше, чем мытьё той же посуды под проточной водой.'],
      ['Горячая — дороже', 'Кубометр горячей с водоотведением ≈ ' + hot + ' грн, холодной ≈ ' + cold + ' грн. Не смешивайте кипяток с холодной «до нужной» — настройте смеситель или термостат на комфортную температуру.'],
      ['Сравнивайте месяцы в Статистике', 'Резкий рост без видимой причины (гости, ремонт, стирка штор) — повод проверить утечку. Передавайте показания каждый месяц: так видно, когда что-то пошло не так.']
    ] : [
      ['Перевірте, чи немає витоку', 'Закрийте всі крани й 10–15 хвилин не користуйтеся водою. Якщо червоні барабани чи «зірочка» на циферблаті водоміра крутяться — десь тече. Найчастіше винен бачок унітаза або кран, що крапає.'],
      ['Бачок унітаза', 'Бачок, що підтікає, може непомітно витрачати сотні літрів на добу. Перевірка: кілька крапель харчового барвника в бачок — якщо за 15–20 хвилин колір з’явився в чаші, міняйте клапан чи грушу.'],
      ['Кран, що крапає', 'Крапля щосекунди — це понад 10 м³ за рік. Зазвичай досить замінити прокладку чи картридж.'],
      ['Аератори на крани', 'Насадка-аератор змішує воду з повітрям: струмінь на дотик такий самий, а води йде помітно менше. Коштує недорого, ставиться руками замість звичайної сітки.'],
      ['Душ замість ванни', 'Повна ванна — приблизно 150–200 літрів, 5 хвилин під душем — зазвичай 40–60. Ощадна лійка зменшує витрату ще більше.'],
      ['Не лийте воду даремно', 'Закривайте кран, поки чистите зуби, намилюєте руки чи посуд: відкритий кран — це 6–12 літрів щохвилини.'],
      ['Посудомийка й пральна машина', 'Запускайте повністю завантаженими, в режимі «еко». Посудомийка витрачає на цикл приблизно 10–15 літрів — менше, ніж миття того самого посуду під проточною водою.'],
      ['Гаряча — дорожча', 'Кубометр гарячої з водовідведенням ≈ ' + hot + ' грн, холодної ≈ ' + cold + ' грн. Не змішуйте окріп із холодною «до потрібної» — налаштуйте змішувач чи термостат на комфортну температуру.'],
      ['Порівнюйте місяці у Статистиці', 'Різке зростання без видимої причини (гості, ремонт, прання штор) — привід перевірити, чи немає витоку. Передавайте показання щомісяця: так видно, коли щось пішло не так.']
    ];
  }
  function wsave(kind) {
    var sm = Wt.summary(Wt.monthly(Wt.series(wrecs(), wmeters(null, true), gaps()), kind, wtar())), list = wtips();
    var mine = sm ? '<div class="panel" data-key="wsave-mine"><h2>' + esc(t('sv_mine')) + '</h2>' +
      kpi({ key: 'wsave-kpi', tone: kind, q: fmtN(sm.perMonth, 1), unit: 'м³', money: sm.uahMonth, cap: t('kpi_w_avg', { n: sm.months }) }) +
      tipLine('drop', t('kpi_w_ten', { m3: fmtN(sm.perMonth * 0.1, 1), uah: '<b>' + esc(money0(sm.uahMonth * 0.1)) + ' грн</b>', y: esc(money0(sm.uahMonth * 1.2)) })) + '</div>'
      : '<div class="panel"><p class="muted">' + esc(t('wsv_no_data')) + '</p></div>';
    var groups = [[t('wsv_g1'), 'alert', [0, 1, 2]], [t('wsv_g2'), 'drop', [3, 4, 5]], [t('wsv_g3'), 'home', [6]], [t('wsv_g4'), 'chart', kind === 'hot' ? [7, 8] : [8, 7]]];
    return { screen: 'S14', route: 'save', html: '<h1>' + esc(t('wsv_title')) + '</h1>' + kindSwitch() + '<p class="muted">' + esc(t('wsv_lead')) + '</p>' + mine +
      accGroups(groups.map(function (g) { return { title: g[0], icon: g[1], items: g[2].map(function (k) { return { title: list[k][0], html: '<p>' + esc(list[k][1]) + '</p>' }; }) }; }), 'wsave-tips') };
  }

  // ================= світло й газ: «прості» лічильники квартири (place.meters, kind 'elec' | 'gas'), показання — S.mrecs =================
  // Запис: {id, place, meter, kind, date, z: {all} | {day, night} | {peak, half, night}, base, sent: {obl | grm: дата}, createdAt, updatedAt, deleted}.
  // Світло — Харківобленерго (останні 2 дні місяця і 1–3 число); газ — Нафтогаз / Газмережі (1–5 число). Спільні екрани з параметром k.
  var El = window.TeploElec, Gs = window.TeploGas;
  function KWH() { return S.lang === 'ru' ? 'кВт·ч' : 'кВт·год'; }
  var SK = {
    elec: { mod: El, icon: 'bolt', cls: 'c-elec', page: 'elec', nw: 'enew', add: 'eadd', heat: 'elecHeat', sk: 'obl', unit: KWH, tag: 'kWh', dec: 0 },
    gas: { mod: Gs, icon: 'flame', cls: 'c-gas', page: 'gas', nw: 'gnew', add: 'gadd', heat: 'gasHeat', sk: 'grm', unit: function () { return 'м³'; }, tag: 'm³', dec: 0 }
  };
  function skOf(m) { return SK[(m && m.kind) === 'gas' ? 'gas' : 'elec']; }
  /** Текст для виду: у газу свої ключі (ed_ → gd_, ue_ → ug_, kpi_e_ → kpi_g_), немає — спільний. */
  function tk(k, key, v) {
    if (k === 'gas') {
      var g = key.replace(/^(ue_|kpi_e_|e)/, function (x) { return x === 'ue_' ? 'ug_' : x === 'kpi_e_' ? 'kpi_g_' : 'g'; });
      // SMS 4647 закрито з 28.11.2026 — тексти без SMS (ключ «…_ns»), якщо є
      if (today() > Gs.SMS_UNTIL && I.T.uk[g + '_ns'] !== undefined) g += '_ns';
      if (I.T.uk[g] !== undefined) return t(g, v);
    }
    return t(key, v);
  }
  // газ: два рахунки — Газмережі (доставка, 10 цифр, Харків 131…/132…) і Нафтогаз (сам газ, 9 цифр — для SMS 4647), і EIC-код точки (16 символів, 56…)
  function dgt(x) { return String(x || '').replace(/\D/g, ''); }
  function gasMove(m) { if (!m || m.kind !== 'gas' || m.grm || dgt(m.account).length !== 10) return false; m.grm = m.account; m.account = ''; return true; }
  function eicNorm(x) { return String(x || '').replace(/\s+/g, '').toUpperCase().slice(0, 20); }
  /** Номери лічильника світла/газу для показу й копіювання: [ключ підпису, значення]. Газ — Газмережі, Нафтогаз, EIC. */
  function saccList(k, m) { if (!m) return []; return (k === 'gas' ? [['gd_grm', m.grm], ['gd_naf', m.account], ['gd_eic', m.eic]] : [['ed_acc', m.account]]).filter(function (x) { return x[1]; }); }
  function pmeters(kind, all) { var p = place(); return byKind(((p && p.meters) || []).filter(function (m) { return m && !m.deleted && (all || !m.removed) && (!kind || m.kind === kind); })); }
  function setPMeters(fn) { ensurePlaces(); var p = place(); p.meters = JSON.parse(JSON.stringify(p.meters || [])); fn(p.meters); p.updatedAt = Date.now(); save(); }
  function smeters(k, all) { return pmeters(k, all); }
  function emeters(all) { return pmeters('elec', all); }
  function mrecs(mid) { return (S.mrecs || []).filter(function (r) { return r && !r.deleted && r.place === S.placeId && (!mid || r.meter === mid); }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.base ? -1 : b.base ? 1 : 0; }); }
  /** Останнє показання лічильника до дати (не включно; стартове того ж дня — так). */
  function eprev(mid, date, skipId) { var a = mrecs(mid).filter(function (r) { return r.id !== skipId && (!date || r.date < date || (r.base && r.date === date)); }); return a.length ? a[a.length - 1] : null; }
  function elastOf(mid) { var a = mrecs(mid); return a.length ? a[a.length - 1] : null; }
  function sopts(k) { var p = place() || {}; return { heating: !!p[SK[k].heat], price: k === 'gas' ? R.num(p.gasPrice) : R.num(((p.prov || {}).elec || {}).price) }; }
  function eopts() { return sopts('elec'); }
  function ename(m) { return t((m && m.kind) === 'gas' ? 'kd_gas' : 'kd_elec') + (m && m.name ? ' · ' + m.name : ''); }
  /** Назва зони: «День», «Ніч», «Пік», «Напівпік»; одна зона — «Показання». */
  function ezl(m, k) { var z = skOf(m).mod.zones(m); return t(z === 1 ? 'ez_all' : 'ez_' + k + (z === 3 && k === 'night' ? '3' : '')); }
  function etag(m, k) { var z = skOf(m).mod.zones(m); return z === 1 ? skOf(m).tag : t('ezt_' + k); }
  function ezonesTxt(m) { return (m && m.kind) === 'gas' ? '' : t('ez_n' + El.zones(m)); }
  /** Значення запису по зонах одним рядком: «день 10250 · ніч 5130». */
  function evals(m, r) { var md = skOf(m).mod; return md.keys(m).map(function (k) { var v = md.whole(r && r.z && r.z[k]); return (md.zones(m) > 1 ? ezl(m, k).toLowerCase() + ' ' : '') + (v === null ? '—' : v); }).join(' · '); }
  function edisplay(m, r, cls) {
    var md = skOf(m).mod, u = skOf(m).unit();
    // газ — жовта панель з роликами (чорні м³ + червоні літри), світло — темний електронний екран по зонах
    if (m.kind === 'gas') return wdrum(r && r.z ? r.z.all : null, 'gas', cls);
    return elcd(md.keys(m).map(function (k) { var v = md.whole(r && r.z && r.z[k]); return { text: v === null ? '------' : String(v), zone: md.zones(m) > 1 ? etag(m, k) : '', label: (md.zones(m) > 1 ? ezl(m, k) + ' ' : '') + (v === null ? '—' : v + ' ' + u) }; }), cls);
  }
  /** У вікні приймання є показання цього лічильника (не стартові)? → запис. */
  function einWin(mid, w) { return mrecs(mid).filter(function (r) { return !r.base && !r.own && r.date >= w.from && r.date <= w.to; }).slice(-1)[0] || null; }
  function ssent(k, r) { return !!(r && r.sent && r.sent[SK[k].sk]); }
  /** Статус світла/газу квартири для картки й списку квартир (як heatStatus/waterStatus). */
  function sStatus(k) {
    var ms = smeters(k), w = SK[k].mod.win(today()), recs = ms.map(function (m) { return einWin(m.id, w); });
    if (!w.open) return { st: t('ue_next', { a: fmtDate(w.next), b: fmtDate(w.to) }), tone: '', from: w.next };
    if (recs.every(function (r) { return ssent(k, r); })) return { st: t('uc_w_sent'), tone: 'ok' };
    if (recs.every(Boolean)) return { st: t('uc_w_ready'), tone: 'due', due: w.to, ready: true };
    return { st: t('ue_due', { a: fmtDate(w.from), b: fmtDate(w.to) }), tone: w.daysLeft <= 1 ? 'warn' : 'due', due: w.to };
  }
  function elecStatus() { return sStatus('elec'); }
  function sCard(k) {
    var ms = smeters(k), es = sStatus(k);
    var display = ms.length === 1 ? edisplay(ms[0], elastOf(ms[0].id), 'card') : ms.map(function (m) { return '<div class="wd-multi"><span class="wd-name">' + esc(m.name || ename(m)) + '</span>' + edisplay(m, elastOf(m.id), 'card' + (k === 'gas' ? ' sm' : '')) + '</div>'; }).join('');
    var lasts = ms.map(function (m) { return elastOf(m.id); }), last = lasts.filter(Boolean).sort(function (a, b) { return a.date < b.date ? 1 : -1; })[0];
    var o = { sub: last ? (last.base ? t('uc_w_start', { d: fmtDate(last.date) }) : t('uc_w_last', { d: fmtDate(last.date) })) : t('uc_w_nolast'), status: cardSt(es), tone: cardSt(es) ? es.tone : '' };
    var sent = function (r) { return r && !r.base && !r.own && ssent(k, r); };
    if (last && lasts.every(function (r) { return !r || sent(r); }) && sent(last)) cardSent(o, last.date);
    return ucard({ kind: k, href: SK[k].page, icon: SK[k].icon, title: t(KINDS[k].t), display: display, sub: o.sub,
      status: o.status, tone: o.tone, addAct: SK[k].nw, addLabel: tk(k, 'ue_add') });
  }
  function elecCard() { return sCard('elec'); }

  // ---------- боти світла (@Kooz2bot) і газу (@mygrmu_bot): відповіді, переслані нашому боту (/api/bot/replies?src=obl|grm) ----------
  // Як у води: людина подає в офіційному боті сама, пересилає його відповідь нам — і ми самі ставимо «передано» (підтверджено).
  var SBR = { obl: { list: null, at: 0, busy: false }, grm: { list: null, at: 0, busy: false } }, SBERR = {};
  function sbKindOf(r) { return r && r.kind === 'gas' ? 'gas' : 'elec'; }
  function smeterById(id) { var f = null; places().forEach(function (p) { ((p && p.meters) || []).forEach(function (m) { if (m && m.id === id) f = m; }); }); return f; }
  function dayOf(ms) { var d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function sbLoad(k, force) {
    var st = SBR[SK[k].sk];
    if (!window.TEPLO_API || !Y().account || st.busy || (!force && Date.now() - st.at < 15000)) return;
    st.busy = true; st.at = Date.now();
    Y().api('GET', '/bot/replies?src=' + SK[k].sk).then(function (j) {
      st.busy = false; if (j._status !== 200) return;
      var before = JSON.stringify(st.list); st.list = j.replies || []; var changed = before !== JSON.stringify(st.list);
      if (sbApply(k) || changed) safeRender();
    }, function () { st.busy = false; });
  }
  /** «Прийнято» від бота → «передано» з підтвердженням. Кому: тим, для кого натиснули кнопку бота до відповіді (одне натискання —
   *  усі лічильники панелі); не натискали (бот відкрили самі) — показанням до дня відповіді, не старшим 10 днів: у тексті є номер
   *  рахунку — лише цим лічильникам, інакше — лише якщо такі показання в одній квартирі. По одному (найсвіжішому) на лічильник. */
  function sbApply(k) {
    var src = SK[k].sk, oks = (SBR[src].list || []).filter(function (r) { return r.kind === 'ok'; }); if (!oks.length) return false;
    var used = {}; (S.mrecs || []).forEach(function (x) { if (x && x.botConf) used[x.botConf.id] = 1; });
    var open = function () { return (S.mrecs || []).filter(function (x) { return x && !x.deleted && !x.base && !x.own && sbKindOf(x) === k && !(x.sent && x.sent[src]); }); };
    var hit = 0;
    oks.slice().sort(function (a, b) { return a.at - b.at; }).forEach(function (r) {
      if (used[r.id]) return;
      var ms = r.at * 1000, rday = dayOf(ms), left = open(), grp;
      var pressed = left.filter(function (x) { return x.botAt && ms >= x.botAt - 120000 && ms - x.botAt < 3 * 86400000; });
      if (pressed.length) { var last = Math.max.apply(null, pressed.map(function (x) { return x.botAt; })); grp = pressed.filter(function (x) { return last - x.botAt < 60000; }); }
      else {
        var near = left.filter(function (x) { return x.date <= rday && R.daysBetween(x.date, rday) <= 10; });
        var digits = ' ' + String(r.text || '').replace(/\D+/g, ' ') + ' ';
        var byAcc = near.filter(function (x) { var sm = smeterById(x.meter) || {}; return [sm.account, sm.grm].some(function (y) { var a = dgt(y); return a.length >= 6 && digits.indexOf(' ' + a + ' ') >= 0; }); });
        var pl = {}; near.forEach(function (x) { pl[x.place] = 1; });
        grp = byAcc.length ? byAcc : Object.keys(pl).length === 1 ? near : [];
      }
      var per = {}; grp.forEach(function (x) { if (!per[x.meter] || per[x.meter].date < x.date) per[x.meter] = x; });
      var recs = Object.keys(per).map(function (m) { return per[m]; }); if (!recs.length) return;
      used[r.id] = 1;
      recs.forEach(function (x) { x.sent = Object.assign({}, x.sent || {}); x.sent[src] = today(); x.botConf = { id: r.id, at: r.at, text: String(r.text || '').slice(0, 300) }; x.updatedAt = Date.now(); hit++; });
    });
    if (hit) { save(); toast(tk(k, 'ed_conf_toast')); }
    return hit > 0;
  }
  function sbPending(k) { return (S.mrecs || []).some(function (x) { return x && !x.deleted && sbKindOf(x) === k && x.botAt && !(x.sent && x.sent[SK[k].sk]) && Date.now() - x.botAt < 30 * 60000; }); }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    ['elec', 'gas'].forEach(function (k) { if (sbPending(k) || new RegExp('^(' + SK[k].page + '|erec-|' + SK[k].nw + ')').test(routeName())) sbLoad(k, true); });
  });
  setInterval(function () { if (document.visibilityState === 'visible') ['elec', 'gas'].forEach(function (k) { if (sbPending(k)) sbLoad(k); }); }, 20000);
  /** Блок під кнопкою бота: підтверджено (текст відповіді) · або «Що відповів бот?» після натискання · або підказка, як подати. */
  function sbBox(k, recs) {
    var src = SK[k].sk, rs = recs.filter(Boolean), conf = rs.filter(function (x) { return x.botConf; })[0], ids = rs.map(function (x) { return x.id; }).join(',');
    var fw = esc(t('vk_fw', { b: '@' + ourBot() }));
    if (conf && rs.every(function (x) { return x.sent && x.sent[src]; })) return '<div class="vk-reply ok" data-key="' + k + '-conf"><p class="small"><b>' + esc(tk(k, 'ed_conf', { d: vkWhen(conf.botConf.at) })) + '</b></p>' +
      (conf.botConf.text ? '<p class="small vk-text">' + esc(String(conf.botConf.text).slice(0, 600)) + '</p>' : '') + '</div>';
    var at = Math.max.apply(null, [0].concat(rs.map(function (x) { return x.botAt || 0; })));
    if (!at || rs.every(function (x) { return x.sent && x.sent[src]; })) return '<div class="bot-how" data-key="ed-bot-how"><p class="dm-t">' + esc(t('bot_how_t')) + '</p><ol>' + tk(k, 'ed_bot_steps', { b: '@' + ourBot() }).split('|').map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol></div>';
    var r = (SBR[src].list || []).filter(function (y) { return y.at * 1000 >= at - 120000; })[0], err = SBERR[k] || (r && r.kind === 'err');
    return (r ? '<div class="vk-reply' + (r.kind === 'err' ? ' bad' : '') + '" data-key="' + k + '-reply"><p class="small"><b>' + esc(tk(k, 'ed_reply_t', { d: vkWhen(r.at) })) + '</b></p><p class="small vk-text">' + esc(String(r.text).slice(0, 600)) + '</p></div>' : '') +
      '<div class="vk-ask" data-key="' + k + '-ask"><p><b>' + esc(tk(k, 'ed_ask')) + '</b></p><div class="row-actions">' +
      '<button class="btn" data-act="esent" data-k="' + k + '" data-v="1" data-ids="' + esc(ids) + '" data-key="' + k + '-bot-ok">' + ico('check', 18) + '<span>' + esc(t('vk_ok')) + '</span></button>' +
      '<button class="btn sec" data-act="sb-err" data-k="' + k + '" data-key="' + k + '-bot-err">' + esc(t('vk_err')) + '</button></div>' +
      '<p class="small muted">' + fw + '</p>' +
      (err ? '<div class="vk-tips" data-key="' + k + '-tips"><ul class="small">' + tk(k, 'ed_err_tips').split('|').map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '') + '</div>';
  }
  /** «Куди передати»: світло — Харківобленерго (застосунок, Viber-бот, кол-центр); газ — кабінет Газмереж, SMS 4647, «Куб», кол-центр. */
  function ssendPanel(k, recs) {
    var md = SK[k].mod, w = md.win(today()), ms = smeters(k), have = recs && recs.filter(Boolean).length ? recs : null;
    var due = w.open ? t('ed_due', { d: fmtDate(w.to) }) : t('ed_due_next', { a: fmtDate(w.next), b: fmtDate(w.to) });
    var allSent = have && ms.every(function (m) { return ssent(k, have.filter(function (x) { return x && x.meter === m.id; })[0]); });
    var body = '', chans, ids = have ? have.filter(Boolean).map(function (r) { return r.id; }).join(',') : '';
    if (have) body = '<ul class="wvals" data-key="esend-vals">' + ms.map(function (m) {
      var r = have.filter(function (x) { return x && x.meter === m.id; })[0]; if (!r) return '';
      return md.keys(m).map(function (z) { var v = md.whole(r.z[z]); return '<li><span>' + esc((ms.length > 1 ? (m.name || ename(m)) + ' · ' : '') + ezl(m, z)) + '</span><b class="num">' + v + '</b><button class="linkbtn" data-act="copy" data-text="' + v + '">' + esc(t('copy')) + '</button></li>'; }).join('');
    }).join('') + '</ul>' + (k === 'elec' && El.zones(ms[0] || {}) > 1 ? '<p class="small muted">' + esc(t('ed_nosum')) + '</p>' : '');
    var acc = ms.map(function (m) { return saccList(k, m).map(function (x) { return '<p class="small" data-key="esend-' + x[0] + '-' + m.id + '">' + esc(tk(k, x[0], { a: x[1] })) + (ms.length > 1 ? ' · ' + esc(m.name || '') : '') + ' <button class="linkbtn" data-act="copy" data-text="' + esc(x[1]) + '">' + esc(t('copy')) + '</button></p>'; }).join(''); }).join('');
    // кол-центр — стовпчиком: номер і оператор у рядок, кожен номер окремо (зручно читати й натискати)
    var phones = '<ul class="dm-ph">' + md.PHONES.map(function (p) { return '<li>' + telLink(p[0], p[1]) + '<span class="muted">' + esc(p[2]) + '</span></li>'; }).join('') + '</ul>';
    // кнопка офіційного бота: є показання — запам'ятовуємо натискання (botAt), щоб пересланий нам «прийнято» ліг саме на них
    var one = have && have.filter(Boolean).length === 1 && md.zones(ms[0] || {}) <= 1 ? md.whole((have.filter(Boolean)[0].z || {}).all) : null;
    var botAttr = have ? ' data-act="sbot" data-k="' + k + '" data-ids="' + ids + '"' + (one !== null ? ' data-copy="' + one + '"' : '') : '';
    if (have) sbLoad(k);
    var asking = have && !allSent && have.some(function (x) { return x && x.botAt && !ssent(k, x); });
    var more;
    if (k === 'gas') {
      // SMS 4647: «9 цифр рахунку пробіл 5 цифр показань» — готовий текст, якщо є рахунок і показання
      var smsOn = today() <= Gs.SMS_UNTIL, sms = smsOn && have && ms.length === 1 ? Gs.smsText(ms[0].account, (have.filter(Boolean)[0].z || {}).all) : null;
      var nafN = ms.length === 1 ? dgt(ms[0].account).length : 9;
      if (smsOn && have && ms.length === 1 && !sms && nafN !== 9) body += '<p class="small" data-key="gd-noacc">' + esc(nafN ? t('gd_badacc', { n: nafN }) : t('gd_noacc')) + ' <a href="' + Gs.LINKS.find + '" target="_blank" rel="noopener" data-key="gd-find">' + esc(t('gd_find')) + ' ' + ico('ext', 14) + '</a></p>';
      if (sms) body += '<p class="small">' + esc(t('gd_sms_how', { s: sms })) + '</p>';
      if (smsOn) body += '<p class="small muted" data-key="gd-sms-end">' + esc(t('gd_sms_end', { d: fmtDate(Gs.SMS_UNTIL) })) + '</p>';
      chans = [[Gs.LINKS.bot, t('gd_bot'), 'send', 'bot', botAttr], [Gs.LINKS.kub, t('gd_kub'), 'ext', 'kub']].concat(sms ? [['sms:' + Gs.LINKS.sms + '?&body=' + encodeURIComponent(sms), t('gd_sms'), 'send', 'sms']] : []).concat([[Gs.LINKS.cabinet, t('gd_cab'), 'ext', 'cab']]);
      if (have) body += sbBox(k, have);
      // бот Газмереж питає філію: у Харкові — «Харківська міська», в області — «Харківська» (за довідником адреси)
      var gdp = prvOf('gas'); if (gdp && gdp.grm) body += '<p class="small muted" data-key="gd-fil">' + esc(t('gd_fil', { g: String(gdp.grm).replace(/^Газмережі,\s*/, '') })) + '</p>';
      more = '<p class="dm-t">' + esc(t('gd_kub_call')) + '</p><ul class="dm-ph"><li>' + telLink(Gs.KUB_TEL[0], Gs.KUB_TEL[1]) + '<span class="muted">' + esc(t('gd_kub_free')) + '</span></li></ul>' +
        '<p class="dm-t">' + esc(t('gd_call')) + '</p>' + phones;
    } else {
      // офіційні канали Харківобленерго: бот @Kooz2bot, онлайн-форма (з капчею — відкриваємо, людина проходить), SMS 4300
      var m0 = ms[0] || {}, acc1 = String(m0.account || '').replace(/\D/g, '');
      var esms = (have && ms.length === 1 && El.zones(m0) <= 1 && acc1.length === 12) ? El.smsText(acc1, (have.filter(Boolean)[0].z || {}).all) : null;
      chans = [[El.OBL_BOT, t('ed_bot'), 'send', 'bot', botAttr], [El.OBL_FORM, t('ed_form'), 'ext', 'form']].concat(esms ? [['sms:' + El.SMS + '?&body=' + encodeURIComponent(esms), t('ed_sms'), 'send', 'sms']] : []);
      if (have) body += sbBox(k, have);
      if (esms) body += '<p class="small">' + esc(t('ed_sms_how', { s: esms })) + '</p>';
      more = '<p class="dm-t">' + esc(t('ed_call')) + '</p>' + phones + '<p>' + esc(t('ed_viber')) + '</p>' +
        '<p class="dm-t">' + esc(t('ed_app_t')) + '</p><p class="dm-links"><a href="' + El.OBL_APP_ANDROID + '" target="_blank" rel="noopener">Android ' + ico('ext', 14) + '</a><a href="' + El.OBL_APP_IOS + '" target="_blank" rel="noopener">iPhone ' + ico('ext', 14) + '</a></p>' +
        '<p class="dm-t">' + esc(t('ed_acc_t')) + '</p><p>' + esc(t('ed_zbut2')) + ' <a href="' + El.ZBUT_SITE + '" target="_blank" rel="noopener">zbutenergo.kharkov.ua</a></p>';
    }
    var mark = have && !asking ? '<p class="dest-mark">' + (allSent ? '<button class="linkbtn" data-act="esent" data-k="' + k + '" data-v="0" data-ids="' + ids + '">' + esc(t('ws_unmark')) + '</button>'
      : '<button class="btn sec" data-act="esent" data-k="' + k + '" data-v="1" data-ids="' + ids + '" data-key="esend-done">' + ico('check', 18) + '<span>' + esc(t('ws_mark')) + '</span></button>') + '</p>' : '';
    return '<section class="panel where" data-key="where-' + k + '"><h2>' + ico('send', 20) + '<span>' + esc(t('wd_title')) + '</span></h2>' +
      (places().length > 1 ? '<p class="dest-place" style="--pc:var(--pc-' + placeColor(place()) + ')" data-key="where-place"><b>' + esc(t('wd_for', { p: placeLabel(place()) })) + '</b>' + (placeSub(place()) ? '<span class="small muted"> · ' + esc(placeSub(place())) + '</span>' : '') + '</p>' : '') +
      (have ? '' : '<p class="small muted">' + esc(tk(k, 'ed_lead')) + '</p>') +
      destBox({ key: k === 'gas' ? 'grm' : 'obl', id: 'esend', org: tk(k, 'ed_org'), what: tk(k, 'ed_what'), due: due, dueTone: w.open && w.daysLeft <= 1 ? 'warn' : 'neutral', sent: allSent, body: body + acc, chans: chans, more: more, mark: mark }) + '</section>';
  }
  /** Рядки історії (нові зверху): скільки набігло і почім, на лічильнику, передано. */
  function srows(k, limit) {
    var ms = smeters(k, true), md = SK[k].mod, u = SK[k].unit(), rows = [];
    ms.forEach(function (m) {
      var all = mrecs(m.id), paid = {}; md.series(all.filter(function (r) { return !r.own; }), m).forEach(function (x) { paid[x.rec.id] = x; });
      md.series(all, m).forEach(function (x) { var pf = x.rec.own || x.rec.base ? null : paidFrom(all, x.rec, function () { return true; }); rows.push({ m: m, x: pf && paid[x.rec.id] ? paid[x.rec.id] : x, pf: pf }); });
    });
    rows.sort(function (a, b) { return a.x.rec.date < b.x.rec.date ? 1 : a.x.rec.date > b.x.rec.date ? -1 : a.x.rec.base ? 1 : b.x.rec.base ? -1 : 0; });
    var total = rows.length; if (limit) rows = rows.slice(0, limit);
    if (!rows.length) return { total: 0, html: '' };
    return { total: total, html: '<ul class="list wh" data-key="' + k + '-history">' + rows.map(function (y) {
      var x = y.x, r = x.rec, has = !r.base && x.kwh !== null, c = has ? md.cost(y.m, x.dz, r.date, sopts(k)).total : null;
      return histRow({ key: 'erec-' + r.id, href: '#erec-' + r.id, q: has ? '+' + x.kwh : null, unit: u, money: c, none: r.base ? t('eh_base') : t('hr_first'), date: fmtDate(r.date, true),
        sub: [t('hr_on_meter', { v: (ms.length > 1 ? (y.m.name || '') + ' ' : '') + evals(y.m, r), u: u }), has && x.days ? x.days + ' ' + t('days_short') : '', y.pf ? t('own_paid', { d: fmtDate(y.pf.date) }) + ' · ' + t('own_between', { n: y.pf.n }) : ''],
        right: ((r.photos || []).length ? '<span class="ph-n">' + ico('camera', 16) + '<span class="num">' + r.photos.length + '</span></span>' : '') + billMark(r.bills),
        st: stChip('m', r, k, r.base ? (baseSent(r) ? 'sent' : 'not') : r.own ? 'own' : ssent(k, r) ? 'sent' : 'not') });
    }).join('') + '</ul>' };
  }
  /** Галочка «опалення» (світло: пільгова ціна 2,64; газ: котел — великий розхід взимку — норма) і ціна газу — у квартири. */
  function sheatRow(k, form) {
    var p = place() || {}, on = form && typeof EA.heat === 'boolean' ? EA.heat : !!p[SK[k].heat];
    return '<label class="check-row" style="margin-top:12px"><input type="checkbox" id="' + (k === 'gas' ? 'g' : 'e') + '-heat" ' + (form ? 'data-eaheat="1"' : 'data-heat="' + SK[k].heat + '"') + (on ? ' checked' : '') + ' data-key="' + k + '-heat"><span>' + esc(tk(k, 'eh_on')) + '</span></label><p class="small muted" style="margin:4px 0 0">' + esc(tk(k, 'eh_sub')) + '</p>' +
      '';
  }
  function eheatRow() { return sheatRow('elec'); }
  /** Поля лічильника світла/газу (назва, рахунок, №); зони — поки немає жодного показання (новий лічильник квартири). */
  /** Налаштування водоміра в блоці на його сторінці — як у світла/газу: назва, №, повірка, код у боті (ті ж data-wm, що в Налаштуваннях). */
  function wmeterFields(m, withAcc) {
    return (withAcc ? waccFields('mw', wcfg()) : '') + '<div class="grid2">' +
      '<div class="field"><label for="mbn-' + m.id + '">' + esc(t('wm_name')) + '</label><div class="ctl"><input id="mbn-' + m.id + '" data-wm="' + m.id + '" data-wf="name" maxlength="40" value="' + esc(m.name || '') + '" placeholder="' + esc(t('wm_name_ph')) + '"></div></div>' +
      '<div class="field"><label for="mbsn-' + m.id + '">' + esc(t('wm_serial')) + '</label><div class="ctl"><input id="mbsn-' + m.id + '" class="num" autocomplete="off" data-wm="' + m.id + '" data-wf="serial" value="' + esc(m.serial || '') + '">' + ctlCopy('mbsn-' + m.id) + '</div></div>' +
      '<div class="field"><label for="mbv-' + m.id + '">' + esc(t('mv_date')) + '</label><div class="ctl"><input id="mbv-' + m.id + '" type="date" data-wm="' + m.id + '" data-wf="verifiedUntil" value="' + esc(m.verifiedUntil || '') + '"></div></div>' +
      '<div class="field"><label for="mbi-' + m.id + '">' + esc(t('wm_vkid')) + '</label><div class="ctl"><input id="mbi-' + m.id + '" class="num" inputmode="numeric" autocomplete="off" data-wm="' + m.id + '" data-wf="vkId" value="' + esc(m.vkId || '') + '">' + ctlCopy('mbi-' + m.id) + '</div></div></div>';
  }
  /** Налаштування теплолічильника в блоці: модель (змінити — вибір моделі), повірка. */
  function heatMeterFields(m) {
    var hm = S.meter || {};
    return '<div class="grid2"><div class="field"><label for="p-hacc">' + esc(t('hm_acc')) + '</label><div class="ctl"><input id="p-hacc" class="num" inputmode="numeric" autocomplete="off" data-hm="account" value="' + esc(hm.account || '') + '">' + ctlCopy('p-hacc') + '</div><div class="help">' + esc(t('hm_acc_h')) + '</div></div>' +
      '<div class="field"><span class="lbl">' + esc(t('p_meter')) + '</span><p style="margin:0"><b>' + esc(modelName(m)) + '</b> · <a href="#meter" data-key="mb-heat-model">' + esc(t('change')) + '</a></p></div>' +
      '<div class="field"><label for="p-hser">' + esc(t('wm_serial')) + '</label><div class="ctl"><input id="p-hser" class="num" autocomplete="off" data-hm="serial" value="' + esc(hm.serial || '') + '">' + ctlCopy('p-hser') + '</div></div>' +
      '<div class="field"><label for="p-ver">' + esc(t('mv_date')) + '</label><div class="ctl"><input id="p-ver" type="date" value="' + esc(hm.verifiedUntil || '') + '"></div></div></div>';
  }
  /** «Ціна» в налаштуваннях кожного лічильника: відома — вже вписана (з довідника за адресою чи з платіжки), невідома — порожнє
   *  поле і прохання вписати з платіжки. k: heat | hot | cold | elec | gas. Пишемо в квартиру: p.prov[heat|water|elec].price…, p.gasPrice, p.bill.abon. */
  function priceBlock(k) {
    var p = place() || {}, a = String(p.address || '').trim(), j = a ? prvLoad(p) : null, reg = j && j.found && j.kinds ? j.kinds : null;
    var pk = k === 'hot' || k === 'cold' ? 'water' : k, my = (p.prov || {})[pk] || {}, d = reg && reg[pk], f = function (v) { return v === null || v === undefined || v === '' ? '' : money(v); };
    var fld = function (id, lbl, val, unit, ph) { return '<div class="field"><label for="' + id + '">' + esc(lbl) + '</label><div class="ctl"><input id="' + id + '" class="num" inputmode="decimal" autocomplete="off" data-mp="' + id + '" value="' + esc(val) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '><span class="unit">' + esc(unit) + '</span></div></div>'; };
    var h = '', own = false, unknown = false, src = '';
    if (k === 'heat') {
      own = R.num(my.price) > 0; unknown = !own && reg && d !== undefined && !(d && R.num(d.price) > 0) && !(R.num(S.tariff) > 0);
      h = fld('mp-heat', t('prv_heatp'), unknown ? '' : f(tariff()), 'грн') + fld('mp-abon', t('p_abon_l'), f(bill().abon), 'грн');
      src = d && d.org ? d.org : '';
    } else if (pk === 'water') {
      var tr = Wt.tariffAt(today(), wtar()); own = R.num(my.supply) > 0;
      unknown = !own && !!reg && !(d && R.num(d.supply) > 0) && !(S.wtariff && R.num(S.wtariff.supply) > 0);
      // водовідведення громади невідоме (Мерефа) — порожнє поле, а не харківське
      var drainUnk = !own && d && d.via !== 'hvk' && R.num(d.supply) > 0 && !(R.num(d.drain) > 0) && d.drain !== 0;
      h = fld('mp-ws', t('prv_supply'), unknown ? '' : f(tr.supply), 'грн') + fld('mp-wd', t('prv_drain'), unknown || drainUnk ? '' : f(tr.drain), 'грн') + (k === 'hot' ? fld('mp-wh', t('wtp_hot'), f(tr.hot), 'грн') : '');
      src = (d && d.org) || '';
    } else if (k === 'elec') {
      own = R.num(my.price) > 0; h = fld('mp-ep', t('mp_elec'), f(own ? R.num(my.price) : El.priceAt(today())), 'грн');
      src = (d && d.org) || '';
    } else if (k === 'gas') {
      own = R.num(p.gasPrice) > 0; h = fld('g-price', t('gh_price'), f(own ? R.num(p.gasPrice) : Gs.priceAt(today())), 'грн');
      src = (reg && reg.gas && reg.gas.grm) ? t('mp_gas_grm', { g: reg.gas.grm, p: String(reg.gas.dist).replace('.', ',') }) : '';
    }
    var note = own ? t('mp_own') : unknown ? t('mp_unknown', { c: (j.place && j.place.name) || a }) : !a ? t('mp_noaddr') : src ? t('mp_from', { s: src }) : '';
    return '<div class="mp" data-key="mp-' + k + '"><h4 class="mp-h">' + esc(t('mp_title')) + '</h4><div class="grid2">' + h + '</div>' +
      (note ? '<p class="small ' + (unknown ? 'warn-text' : 'muted') + '" data-key="mp-note-' + k + '">' + esc(note) + '</p>' : '') + '</div>';
  }
  document.addEventListener('change', function (e) {
    var el = e.target, id = el && el.getAttribute && el.getAttribute('data-mp'); if (!id || id === 'g-price') return;
    ensurePlaces(); var p = place(), v = R.num(String(el.value).replace(/\s/g, '')); p.prov = p.prov || {};
    var put = function (k, f, max) { var o = Object.assign({}, p.prov[k] || {}); if (v !== null && v >= 0 && v < max) o[f] = v; else delete o[f]; o.at = today(); p.prov[k] = o; };
    if (id === 'mp-heat') put('heat', 'price', 100000);
    else if (id === 'mp-abon') { if (v !== null && v >= 0 && v < 10000) p.bill = Object.assign({}, p.bill || {}, { abon: v }); }
    else if (id === 'mp-ws') put('water', 'supply', 1000);
    else if (id === 'mp-wd') { put('water', 'drain', 1000); if (v === 0) p.prov.water.drain = 0; }
    else if (id === 'mp-wh') put('water', 'hot', 1000);
    else if (id === 'mp-ep') put('elec', 'price', 100);
    p.updatedAt = Date.now(); WX.key = ''; save(); toast(t('b_saved')); render(true);
  });
  /** Одна й та сама ссилка в усіх лічильників: квартира — її лічильники (додати, замінити, прибрати) і рахунки. */
  function mbPlaceLink(key) { var p = place() || {}; return mlink('#place-' + esc(p.id || ''), 'home', t('mb_place'), ' data-key="' + (key || 'mb-place') + '"'); }
  /** Поле номера лічильника (рахунок, EIC) з «Копіювати»; warn — підказка жовтим (скільки цифр бракує). */
  function sfld(m, f, pre, lbl, attrs, help, warn) {
    var id = pre + m.id;
    return '<div class="field"><label for="' + id + '">' + esc(lbl) + '</label><div class="ctl"><input id="' + id + '" class="num" autocomplete="off" ' + attrs + ' data-em="' + m.id + '" data-ef="' + f + '" value="' + esc(m[f] || '') + '">' + ctlCopy(id) + '</div>' +
      (warn ? '<div class="help warn" data-key="' + id + '-warn">' + esc(warn) + '</div>' : '') + (help ? '<div class="help">' + esc(help) + '</div>' : '') + '</div>';
  }
  function smeterFields(k, m) {
    var zfree = k === 'elec' && !mrecs(m.id).length;
    return '<div class="grid2">' +
      '<div class="field"><label for="emn-' + m.id + '">' + esc(t('em_name')) + '</label><div class="ctl"><input id="emn-' + m.id + '" maxlength="40" data-em="' + m.id + '" data-ef="name" value="' + esc(m.name || '') + '" placeholder="' + esc(tk(k, 'em_name_ph')) + '"></div></div>' +
      (k === 'gas' ? sfld(m, 'grm', 'emg-', t('gm_grm'), 'inputmode="numeric"', t('gm_grm_h'), m.grm && dgt(m.grm).length !== 10 ? t('gm_e_grm', { n: dgt(m.grm).length }) : '') : '') +
      sfld(m, 'account', 'ema-', tk(k, 'em_acc'), 'inputmode="numeric"', tk(k, 'em_acc_h'), k === 'gas' && m.account && dgt(m.account).length !== 9 ? t('gm_e_acc', { n: dgt(m.account).length }) : '') +
      (k === 'gas' ? sfld(m, 'eic', 'eme-', t('gm_eic'), 'autocapitalize="characters" spellcheck="false" maxlength="20"', t('gm_eic_h'), !m.eic ? '' : m.eic.length !== 16 ? t('gm_e_eic', { n: m.eic.length }) : !/^56/.test(m.eic) ? t('gm_e_eic56') : '') : '') +
      '<div class="field"><label for="ems-' + m.id + '">' + esc(t('wm_serial')) + '</label><div class="ctl"><input id="ems-' + m.id + '" class="num" autocomplete="off" data-em="' + m.id + '" data-ef="serial" value="' + esc(m.serial || '') + '">' + ctlCopy('ems-' + m.id) + '</div></div></div>' +
      (zfree ? '<fieldset class="field"><legend class="lbl">' + esc(t('ea_zones')) + '</legend><div class="wz-opts" role="radiogroup">' + [1, 2, 3].map(function (n) {
        return '<label class="wz-opt"><input type="radio" name="emz-' + m.id + '" value="' + n + '"' + (El.zones(m) === n ? ' checked' : '') + ' data-em="' + m.id + '" data-ef="zones" data-key="em-z' + n + '"><span><b>' + esc(t('ez_n' + n)) + '</b><span class="small muted">' + esc(t('ea_z' + n + '_s')) + '</span></span></label>';
      }).join('') + '</div></fieldset>' : k === 'elec' ? '<p class="small muted">' + esc(t('em_zones_fix')) + '</p>' : '');
  }
  /** Сторінка виду: табло кожного лічильника, «Внести», «Куди передати», історія, налаштування лічильника. */
  function sPage(k) {
    var ms = smeters(k), p = place() || {}, h = '<h1 class="sr">' + esc(t(KINDS[k].t)) + (p.name ? ' — ' + esc(p.name) : '') + '</h1>';
    var left = ms.map(function (m, i) {
      var sc = sentCap(mrecs(m.id), function (x) { return x.base ? baseSent(x) : ssent(k, x); }), r = sc.rec, cap = sc.cap;
      return mbox({ key: 'emeter-' + m.id, id: m.id, kind: k, icon: SK[k].icon, cls: SK[k].cls, name: ms.length > 1 ? ename(m) : t(KINDS[k].t), sub: [ezonesTxt(m)],
        display: edisplay(m, r, 'hero'), cap: cap, copy: r && r.z && SK[k].mod.zones(m) <= 1 && SK[k].mod.whole(r.z.all) !== null ? SK[k].mod.whole(r.z.all) : '', body: sc.note ? '<p class="small muted mb-newer">' + esc(sc.note) + '</p>' : '',
        set: smeterFields(k, m) + (i === 0 ? priceBlock(k) + sheatRow(k) : '') , setTitle: t('mb_set_read') });
    }).join('');
    if (k === 'elec') left += gpvBox(p, 'elec');
    var w = SK[k].mod.win(today()), cur = w.open ? ms.map(function (m) { return einWin(m.id, w); }) : null;
    var right = '<button class="btn big block" data-act="' + SK[k].nw + '" data-key="' + k + '-add">' + ico('plus', 22) + '<span>' + esc(tk(k, 'en_title')) + '</span></button>' +
      (VIS().local ? '<input type="file" id="eq-files" accept="image/*" multiple class="sr" data-k="' + k + '"><label for="eq-files" class="btn sec block wq-photo" tabindex="0" data-key="' + k + '-photo">' + ico('camera', 22) + '<span>' + esc(t('ph_entry')) + '</span></label>' : '') + whereAcc(ssendPanel(k, cur));
    var er = srows(k, 3);
    if (er.total) right += '<h2 class="section-title">' + esc(t('wh_title')) + '</h2>' + er.html + (er.total > 3 ? '<p><button class="btn sec" data-act="view-go" data-v="' + k + '" data-to="history" data-key="' + k + '-all">' + esc(t('wh_all', { n: er.total })) + '</button></p>' : '');
    right += '<details class="tips-box" style="margin-top:16px" data-key="' + k + '-how"><summary>' + esc(tk(k, 'ehow_t')) + '</summary><ul>' + tk(k, 'ehow').split('|').map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></details>';
    h += '<div class="hero-grid"><div class="wm-col">' + left + '</div><div>' + right + '</div></div>';
    return { screen: k === 'gas' ? 'S55' : 'S50', route: k, html: h };
  }
  V.elec = function () { return sPage('elec'); };
  V.gas = function () { return sPage('gas'); };

  // ---------- ввод показань світла / газу ----------
  function enFresh(k) { return { k: k || 'elec', date: '', vals: {}, back: '', skip: '', photos: [], src: {}, auto: {}, busy: false }; }
  /** «Розпізнати з фото» на введенні світла/газу: фото → движок у браузері → цифри по лічильниках і зонах (EN.src). */
  function enPhotoBox(k) {
    if (!VIS().local) return '';
    var ph = EN.photos || [], ms = smeters(k), h = '<div class="panel wn-photo" data-key="en-photo"><input type="file" id="en-files" accept="image/*" multiple class="sr">';
    if (EN.busy) return h + '<div class="banner" role="status" style="margin:0">' + SPIN + '<div class="grow"><p id="en-prog">' + esc(EN.prog || t('enp_reading')) + '</p><div class="pbar" aria-hidden="true"><i id="en-pbar" style="width:' + (EN.pct || 2) + '%"></i></div>' +
      '<p style="margin:10px 0 0"><button class="btn sec" data-act="en-stop" data-key="en-stop">' + ico('close', 18) + '<span>' + esc(t('ph_stop')) + '</span></button></p></div></div></div>';
    h += '<label for="en-files" class="btn sec' + (ph.length ? '' : ' block') + '" tabindex="0" data-key="en-photo-pick">' + ico('camera', 22) + '<span>' + esc(t(ph.length ? 'enp_more' : 'enp_pick')) + '</span></label>' +
      (ph.length ? '' : '<p class="small muted" style="margin:8px 0 0">' + esc(t('enp_hint')) + '</p>');
    if (EN.err) h += '<p class="help warn">' + esc(EN.err) + '</p>';
    if (!ph.length) return h + '</div>';
    h += '<ul class="thumbs wn-thumbs">' + ph.map(function (p, i) { return '<li><img data-gal="en" data-i="' + i + '" src="' + p.url + '" alt="' + esc(t('ph_from', { n: i + 1 })) + '"><span class="n">' + (i + 1) + '</span><button class="rm" data-act="en-ph-rm" data-i="' + i + '" aria-label="' + esc(t('ph_remove')) + '">' + ico('close', 16) + '</button></li>'; }).join('') + '</ul>';
    var lines = ph.map(function (p, i) {
      if (!p.res) return '';
      var got = []; ms.forEach(function (m) { SK[k].mod.keys(m).forEach(function (z) { var x = EN.src[m.id + '|' + z]; if (x && x.photo === i) got.push(esc((ms.length > 1 ? (m.name || ename(m)) + ' · ' : '') + ezl(m, z).toLowerCase()) + ' <b class="num">' + (k === 'gas' ? Wt.withFrac(x.v, x.frac) : x.v) + '</b>'); }); });
      var nm = t('ph_from', { n: i + 1 }); return esc(nm.charAt(0).toUpperCase() + nm.slice(1)) + ' ' + (got.length ? got.join(', ') : esc(t(noMeterOnPhoto(p.res) ? 'enp_nometer' : 'enp_none')));
    }).filter(Boolean);
    if (lines.length) h += '<p class="small" data-key="en-photo-sum">' + lines.join('<br>') + '</p>';
    if (Object.keys(EN.src).some(function (q) { return EN.src[q].edge; })) h += '<p class="help warn" data-key="en-photo-edge">' + esc(t('enp_edge')) + '</p>';
    if (Object.keys(EN.src).some(function (q) { return EN.src[q].guess; }) || lines.length) h += '<p class="help warn" data-key="en-photo-check">' + esc(t('enp_guess')) + '</p>';
    return h + '</div>';
  }
  function enProg(pct, msg) {
    EN.pct = Math.max(EN.pct || 2, Math.round(pct)); EN.prog = msg;
    var pb = document.getElementById('en-pbar'), el = document.getElementById('en-prog'); if (pb) pb.style.width = EN.pct + '%'; if (el) el.textContent = msg;
  }
  function enRun(files) {
    if (document.getElementById('en-form')) enRead(); EN.err = '';
    files.forEach(function (f) { EN.photos.push({ file: f, url: URL.createObjectURL(f), res: null }); });
    var todo = EN.photos.filter(function (p) { return !p.res; }), n = todo.length; if (!n) return;
    var gen = EN.gen = (EN.gen || 0) + 1, w = EN, live = function () { return EN === w && EN.gen === gen; };
    var limit = function (pr) { return Promise.race([pr, new Promise(function (ok, bad) { setTimeout(function () { bad(new Error('timeout')); }, 90000); })]); };
    EN.busy = true; EN.pct = 2; EN.prog = t('enp_reading'); render(true);
    VIS()._engine(function (q) { if (live()) enProg(q * 15, t('ph_loading', { p: Math.round(q * 100) })); }).then(function () {
      var chain = Promise.resolve();
      todo.forEach(function (p, i) {
        chain = chain.then(function () { if (!live()) return null; enProg(15 + 85 * (i + 0.3) / n, n > 1 ? t('ph_reading', { i: i + 1, n: n }) : t('enp_reading')); p.t0 = Date.now(); return limit(ocrRead(p.file, { all: true })); })
          .then(function (res) { p.ms = Date.now() - (p.t0 || Date.now()); if (res) p.res = { lines: res.lines || [], drums: res.drums || [] }; }, function () { p.res = { lines: [], drums: [] }; });
      });
      return chain;
    }).then(function () { if (!live()) return; EN.busy = false; enAssign(); render(true); enCheck(true); enReport(); },
      function () { if (!live()) return; EN.busy = false; EN.err = t('ph_err_engine'); render(true); });
  }
  /** Аналитика (/admin): копии фото світла/газу и что по ним разложилось по зонам — у вошедших, как у воды и тепла. */
  function enReport() {
    if (!VIS().waterReport) return;
    var k = EN.k, ms = smeters(k);
    VIS().waterReport(EN.photos.filter(function (p) { return p.res && p.file; }).map(function (p) {
      var i = EN.photos.indexOf(p), rd = [];
      ms.forEach(function (m) { SK[k].mod.keys(m).forEach(function (z) { var x = EN.src[m.id + '|' + z]; if (x && x.photo === i) rd.push({ field: k + '_' + z, meter: m.id, value: x.v, frac: x.frac || '', guess: !!x.guess, why: x.why || '' }); }); });
      return { file: p.file, ms: p.ms || 0, res: p.res, photo: { index: i, kind: k, meterType: k === 'gas' ? 'gas' : 'electric', readings: rd, quality: 'ok' } };
    }));
  }
  /** Розкласти прочитане з усіх фото по лічильниках і зонах; поле, яке людина вже заповнила сама, не чіпаємо. */
  function enAssign() {
    var k = EN.k, md = SK[k].mod, ms = smeters(k), date = EN.date || today(), prevBy = {};
    ms.forEach(function (m) { var pr = eprev(m.id, date, EN.skip); prevBy[m.id] = pr ? pr.z : {}; });
    var one = ms.length === 1 && md.keys(ms[0]).length === 1 ? ms[0] : null;
    var shots = EN.photos.map(function (p) {
      if (!p.res) return null;
      // світло: свій розбір барабана (5–6 чорних + 1 червоний, перемички, звірка з рядком тексту); газ — як водомір (5 + 3 червоні)
      var dr = k === 'elec' ? El.drumPick(p.res.drums, p.res.lines) : (p.res.drums || []).length ? Wt.fromOcr({ lines: [], drums: p.res.drums }, one ? (prevBy[one.id] || {}).all : null) : null;
      return { lines: p.res.lines, drum: dr && dr.value !== null && dr.value !== undefined ? { value: dr.value, digits: dr.digits || '', frac: dr.frac || '', sure: !!dr.sure, edge: !!dr.edge, alts: dr.alts || [] } : null };
    });
    var by = md.fromPhotos(shots, ms, prevBy); EN.src = {};
    ms.forEach(function (m) { md.keys(m).forEach(function (z) {
      var x = by[m.id] && by[m.id][z], key = m.id + '|' + z; if (!x) return;
      EN.vals[m.id] = EN.vals[m.id] || {}; EN.src[key] = x;
      if (!EN.vals[m.id][z] || EN.auto[key]) { EN.vals[m.id][z] = k === 'gas' ? Wt.withFrac(x.v, x.frac) : String(x.v); EN.auto[key] = true; }
    }); });
  }
  var EN = enFresh();
  function sNew(k) {
    var ms = smeters(k), md = SK[k].mod, u = SK[k].unit(); if (!ms.length) { AM_BACK = 'home'; return V['add-meter'](); }
    if (EN.k !== k) EN = enFresh(k);
    var date = EN.date || today(), back = EN.back || SK[k].page, w = md.win(date);
    var h = '<h1>' + esc(tk(k, 'en_title')) + '</h1><p class="small muted">' + esc(tk(k, w.open ? 'en_lead_open' : 'en_lead_closed', { a: fmtDate(w.open ? w.from : w.next), b: fmtDate(w.to) })) + '</p>' +
      '<div class="field" style="max-width:280px"><label for="en-date">' + esc(t('wn_date')) + '</label><div class="ctl"><input id="en-date" type="date" value="' + esc(date) + '" max="' + today() + '"></div></div>' + enPhotoBox(k) + '<form id="en-form" novalidate>';
    ms.forEach(function (m) {
      var p = eprev(m.id, date, EN.skip), vs = EN.vals[m.id] || {};
      h += '<fieldset class="efield" data-key="en-' + m.id + '"><legend>' + ico(SK[k].icon, 18, SK[k].cls) + ' ' + esc(ename(m)) + (m.serial ? ' <span class="small muted">№ ' + esc(m.serial) + '</span>' : '') + '</legend>' +
        (md.zones(m) > 1 ? '<p class="small muted">' + esc(t('en_zones_' + md.zones(m))) + '</p>' : '') +
        md.keys(m).map(function (z) {
          var id = m.id + '-' + z, pv = p ? md.whole(p.z && p.z[z]) : null;
          return '<div class="field wfield" id="ef-' + id + '"><label for="en-' + id + '">' + esc(ezl(m, z)) + '</label><div class="ctl"><input id="en-' + id + '" class="num" inputmode="decimal" autocomplete="off" data-en="' + m.id + '|' + z + '" value="' + esc(vs[z] || '') + '" placeholder="' + (pv !== null ? pv : '') + '" aria-describedby="eh-' + id + '"><span class="unit">' + u + '</span></div>' +
            '<div class="help" id="eh-' + id + '">' + esc(pv !== null ? tk(k, 'en_prev', { v: pv, d: fmtDate(p.date) }) : t('wn_first')) + '</div></div>';
        }).join('') + '</fieldset>';
    });
    h += '<p class="small muted">' + esc(tk(k, 'en_digits')) + '</p><div class="wiz-actions"><button class="btn" type="submit" data-key="en-save">' + esc(t('wn_save')) + '</button></div></form>' + cancelLink(k) + ownField();
    return { screen: k === 'gas' ? 'S56' : 'S51', route: SK[k].nw, bare: true, closeTo: back, html: h };
  }
  V.enew = function () { return sNew('elec'); };
  V.gnew = function () { return sNew('gas'); };
  function enRead() { Array.prototype.forEach.call(document.querySelectorAll('[data-en]'), function (el) { var a = el.getAttribute('data-en').split('|'); EN.vals[a[0]] = EN.vals[a[0]] || {}; if (EN.auto && EN.auto[a[0] + '|' + a[1]] && EN.vals[a[0]][a[1]] !== el.value.trim()) delete EN.auto[a[0] + '|' + a[1]]; EN.vals[a[0]][a[1]] = el.value.trim(); }); var d = document.getElementById('en-date'); if (d && d.value) EN.date = d.value; }
  function enCheck(show) {
    var k = EN.k, md = SK[k].mod, date = EN.date || today(), all = {};
    smeters(k).forEach(function (m) {
      var p = eprev(m.id, date, EN.skip), list = md.check(m, EN.vals[m.id] || {}, p ? { date: p.date, z: p.z } : null, date, sopts(k));
      // меньше прошлого / слишком много — а у такого ж лічильника іншої квартири якраз підходить
      if (list.some(function (x) { return x.code === 'less' || x.code === 'jump'; })) md.keys(m).forEach(function (z) {
        var o = otherPlaceLike(k, md.num((EN.vals[m.id] || {})[z]), date, z);
        if (o) list.push({ code: 'other', level: 'warn', zone: z, args: { p: o.p, v: o.v, c: placeLabel(place()) } });
      });
      all[m.id] = list;
      if (!show) return;
      md.keys(m).forEach(function (z) {
        var id = m.id + '-' + z, el = document.getElementById('eh-' + id), fw = document.getElementById('ef-' + id); if (!el) return;
        var mine = list.filter(function (x) { return (x.zone === z || (!x.zone && z === md.keys(m).slice(-1)[0])) && (x.code !== 'empty' || show === 'submit'); }), pv = p ? md.whole(p.z && p.z[z]) : null;
        var txt = mine.map(function (x) { return tk(k, 'ei_' + x.code, Object.assign({ prev: x.prev !== undefined ? x.prev : pv, n: x.perMonth || '', w: x.whole }, x.args || {})); }).join(' ');
        var lvl = mine.some(function (x) { return x.level === 'block'; }) ? 'block' : mine.some(function (x) { return x.level === 'warn'; }) ? 'warn' : mine.length ? 'ok' : '';
        el.textContent = txt || (pv !== null ? tk(k, 'en_prev', { v: pv, d: fmtDate(p.date) }) : t('wn_first'));
        el.className = 'help' + (lvl ? ' ' + lvl : ''); if (fw) fw.className = 'field wfield' + (lvl === 'block' ? ' is-block' : lvl === 'warn' ? ' is-warn' : '');
      });
    });
    return all;
  }
  function enSave() {
    enRead(); var iss = enCheck('submit'), k = EN.k, md = SK[k].mod;
    if (Object.keys(iss).some(function (x) { return md.blocked(iss[x]); })) { var f = document.querySelector('.wfield.is-block input'); if (f) f.focus(); return; }
    var date = EN.date || today(), now = new Date().toISOString(), own = ownChecked(); S.mrecs = S.mrecs || [];
    var ms0 = smeters(k), refs = photoRefs((EN.photos || []).map(function (p, i) {
      var mid = ms0.filter(function (m) { return md.keys(m).some(function (z) { var x = EN.src[m.id + '|' + z]; return x && x.photo === i; }); })[0];
      return { file: p.file, url: p.url, meter: (mid || ms0[0] || {}).id };
    }));
    smeters(k).forEach(function (m) {
      var z = {}; md.keys(m).forEach(function (q) { z[q] = md.norm((EN.vals[m.id] || {})[q]); });
      var mine = refs.filter(function (r) { return r.meter === m.id; });
      // один запис на лічильник і дату: повторне введення того ж дня — правка
      var same = S.mrecs.filter(function (r) { return r && !r.deleted && !r.base && r.place === S.placeId && r.meter === m.id && (r.id === EN.skip || r.date === date); })[0];
      if (same) { same.z = z; same.date = date; if (own) same.own = true; if (mine.length) same.photos = (same.photos || []).concat(mine); same.updatedAt = Date.now(); }
      else S.mrecs.push(Object.assign({ id: md.uid(), place: S.placeId, meter: m.id, kind: k, date: date, z: z, sent: {}, createdAt: now, updatedAt: Date.now() }, own ? { own: true } : {}, mine.length ? { photos: mine } : {}));
    });
    if (!S.onboarded) S.onboarded = true;
    var back = EN.back; EN = enFresh(k); save(); toast(t('wn_saved') + inPlace());
    if (back) go(back); else { SCROLL_TO = 'esend'; go(SK[k].page); }
  }

  // ---------- новий лічильник світла / газу ----------
  var EA = { kind: 'elec', back: '', zones: 1, vals: {}, f: {} };
  /** Камера у поля «Показання зараз» при настройке нового счётчика (первый вход, новая квартира): фото → цифры в поле. */
  function startCam(target, label) {
    if (!VIS().local) return '';
    return '<label class="wcam" title="' + esc(t('wn_photo')) + '" data-key="cam-' + target + '"><input type="file" accept="image/*" capture="environment" class="sr" data-sphoto="' + target + '" aria-label="' + esc(t('wn_photo') + (label ? ': ' + label : '')) + '">' + ico('camera', 20) + '</label>';
  }
  /** Строка «что прочитали с фото» внутри поля (под подсказкой). */
  function phHelp(field, id) { return VIS().local ? field.replace(/<\/div>$/, '<div class="help sp-help" id="' + id + '-ph" aria-live="polite"></div></div>') : field; }
  /** Распознать «показання зараз» с фото: вода — барабан (м³ и литры), газ — барабан, світло — числа по зонам (T1/T2…).
   *  Поля не перерисовываем (форма #wadd не хранит введённое) — пишем прямо в input; человек проверяет. */
  function startPhoto(tg, file, el) {
    var water = tg === 'wa-val', k = water ? (WA.kind === 'hot' ? 'hot' : 'cold') : (EA.kind === 'gas' ? 'gas' : 'elec');
    var inp = document.getElementById(tg), help = document.getElementById(tg + '-ph'), lab = el.closest && el.closest('.wcam');
    var say = function (txt, warn) { if (help) { help.textContent = txt; help.className = 'help' + (warn ? ' warn' : ''); } };
    if (help) { help.innerHTML = SPIN + ' ' + esc(t('wn_reading')); help.className = 'help'; }
    if (lab) lab.setAttribute('aria-busy', 'true');
    VIS()._engine(function () {}).then(function () { return ocrRead(file, { all: true }); }).then(function (res) {
      if (lab) lab.removeAttribute('aria-busy'); res = res || {};
      var got = [];
      if (water) {
        var r = Wt.fromOcr(res, null);
        if (r && r.value !== null && r.value !== undefined) { var wv = Wt.withFrac(r.value, r.frac); if (inp) inp.value = wv; got.push(wfmt(wv)); }
        else if (r && r.partial) { say(t('sp_half', { p: r.partial }), true); if (inp) inp.focus(); return; }
      } else {
        // газ — ролики (окно барабана), світло — электронное табло: барабан ему не нужен (ложные «ролики» перебивают число)
        var md = SK[k].mod, pm = { id: 'new', kind: k, zones: k === 'gas' ? 1 : EA.zones || 1 }, ks = md.keys(pm), q0 = tg.replace(/^ea-v-/, '');
        var dr = (res.drums || []).length ? Wt.fromOcr({ lines: [], drums: res.drums }, null) : null;
        var drShot = dr && dr.value !== null && dr.value !== undefined ? { value: dr.value, frac: dr.frac || '', sure: !!dr.sure } : null;
        var shots = [{ lines: res.lines || [], drum: k === 'gas' ? drShot : null }];
        var by = md.fromPhotos(shots, [pm], { new: {} }).new || {}, put = {};
        // зона по метке на табло (T1/T2/1.8.1…); без метки — в то поле, у которого нажали камеру
        ks.forEach(function (q) { if (by[q] && (ks.length === 1 || by[q].why === 'tag')) put[q] = by[q]; });
        if (!Object.keys(put).length) { var one = (md.fromPhotos(shots, [{ id: 'new', kind: k, zones: 1 }], { new: {} }).new || {}).all; if (one) put[ks.indexOf(q0) >= 0 ? q0 : ks[0]] = one; }
        // механічний лічильник світла з барабаном (НІК 2102): цифр табло немає — беремо барабан (уверений, від 4 цифр); у електронних
        // табло барабан не беремо першим — хибні «ролики» перебивали число
        if (!Object.keys(put).length && k === 'elec' && drShot && dr.sure && String(dr.digits || dr.value).length >= 4) {
          var od = (md.fromPhotos([{ lines: [], drum: drShot }], [{ id: 'new', kind: k, zones: 1 }], { new: {} }).new || {}).all; if (od) put[ks.indexOf(q0) >= 0 ? q0 : ks[0]] = od; }
        ks.forEach(function (q) {
          var x = put[q]; if (!x) return;
          var v = k === 'gas' ? Wt.withFrac(x.v, x.frac) : String(x.v), fi = document.getElementById('ea-v-' + q);
          EA.vals[q] = v; if (fi) fi.value = v; got.push((ks.length > 1 ? ezl(pm, q).toLowerCase() + ' ' : '') + (k === 'gas' ? wfmt(v) : v));
        });
      }
      if (!got.length) { say(t('sp_none'), true); if (inp) inp.focus(); return; }
      say(t('sp_got', { v: got.join(', ') }), true);
      if (VIS().waterReport) VIS().waterReport([{ file: file, ms: res.ms || 0, res: res, photo: { index: 0, kind: water ? 'water' : k, meterType: water ? 'water' : k === 'gas' ? 'gas' : 'electric', where: 'setup', quality: 'ok',
        readings: water ? [{ field: 'water_' + k, unit: 'м³', value: inp ? Wt.norm(inp.value) : null }] : Object.keys(EA.vals).filter(function (q) { return EA.vals[q]; }).map(function (q) { return { field: k + '_' + q, value: EA.vals[q] }; }) } }]);
    }, function () { if (lab) lab.removeAttribute('aria-busy'); say(t('ph_err_engine'), true); });
  }
  document.addEventListener('change', function (e) {
    var el = e.target, tg = el && el.getAttribute && el.getAttribute('data-sphoto');
    if (!tg || !el.files || !el.files[0]) return; var f = el.files[0]; el.value = ''; startPhoto(tg, f, el);
  });
  function sAdd(k) {
    if (EA.kind !== k) EA = { kind: k, back: EA.back, zones: 1, vals: {}, f: {} };
    var same = smeters(k), z = k === 'gas' ? 1 : EA.zones || 1, back = EA.back || 'home', opt = ' <span class="muted small">(' + esc(t('b_opt')) + ')</span>', u = SK[k].unit();
    var fv = function (id) { return EA.f && EA.f[id] ? ' value="' + esc(EA.f[id]) + '"' : ''; };
    var fld = function (id, lbl, attrs, unit, help, optional, after) { return '<div class="field"><label for="' + id + '">' + esc(lbl) + (optional ? opt : '') + '</label><div class="ctl"><input id="' + id + '" ' + attrs + (/^ea-v-/.test(id) ? '' : fv(id)) + '>' + (unit ? '<span class="unit">' + unit + '</span>' : '') + (after || '') + '</div>' + (help ? '<div class="help">' + esc(help) + '</div>' : '') + '</div>'; };
    var mz = { kind: k, zones: z }, md = SK[k].mod, inQ = !!(PQ && PQ.place === S.placeId);
    // рахунки, № і опалення: у черзі налаштування — згорнуто (головне — зони й цифри; кнопка «Додати» ближче)
    var more = (k === 'gas' ? fld('ea-grm', t('gm_grm'), 'class="num" inputmode="numeric" autocomplete="off"', '', t('gm_grm_h'), true) : '') +
      fld('ea-acc', tk(k, 'em_acc'), 'class="num" inputmode="numeric" autocomplete="off"', '', tk(k, 'em_acc_h'), true) +
      (k === 'gas' ? fld('ea-eic', t('gm_eic'), 'class="num" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="20"', '', t('gm_eic_h'), true) : '') +
      fld('ea-serial', t('wm_serial'), 'class="num" autocomplete="off"', '', '', true) +
      (same.length ? '' : sheatRow(k, true));
    if (inQ) {
      var mOpen = EA.more || EA.heat === true || EA_F.some(function (id) { return id !== 'ea-name' && EA.f && EA.f[id]; });
      more = '<details class="mbox-set ea-more"' + (mOpen ? ' open' : '') + ' data-key="ea-more"><summary>' + ico('prefs', 18) + '<span>' + esc(tk(k, 'ea_more')) + opt + '</span>' + ico('chev', 18, 'pacc-chev') + '</summary><div class="mbox-set-b">' + more + '</div></details>';
    }
    var h = pqBanner() + '<h1>' + ico(SK[k].icon, 26, SK[k].cls) + ' ' + esc(tk(k, 'ea_title')) + '</h1><p class="muted">' + esc(tk(k, 'ea_lead')) + '</p><form id="ea-form" novalidate><div class="panel">' +
      (k === 'elec' ? '<fieldset class="field ea-zones"><legend class="lbl">' + esc(t('ea_zones')) + '</legend><div class="wz-opts" role="radiogroup">' + [1, 2, 3].map(function (n) {
        return '<label class="wz-opt"><input type="radio" name="ea-z" value="' + n + '"' + (z === n ? ' checked' : '') + ' data-act="ea-zones" data-key="ea-z' + n + '"><span><b>' + esc(t('ez_n' + n)) + '</b><span class="small muted">' + esc(t('ea_z' + n + '_s')) + '</span></span></label>';
      }).join('') + '</div></fieldset>' : '') +
      md.keys(mz).map(function (q) { return phHelp(fld('ea-v-' + q, t('ea_val') + (z > 1 ? ': ' + ezl(mz, q).toLowerCase() : ''), 'class="num" inputmode="decimal" autocomplete="off" data-ea="' + q + '" value="' + esc(EA.vals[q] || '') + '"', u, q === md.keys(mz).slice(-1)[0] ? t('ea_val_h') : '', true, startCam('ea-v-' + q, tk(k, 'ea_title'))), 'ea-v-' + q); }).join('') +
      (same.length ? fld('ea-name', t('em_name'), 'maxlength="40" autocomplete="off" placeholder="' + esc(tk(k, 'em_name_ph')) + '"', '', t('ea_name_need', { n: same.length }), false) : '') +
      more +
      '<div class="help block" id="ea-err" role="alert"></div></div>' +
      '<div class="wiz-actions"><a class="btn sec" href="#' + esc(back) + '">' + esc(t('cancel')) + '</a><button type="submit" class="btn" data-key="ea-save">' + esc(t('ea_add')) + '</button></div></form>';
    return { screen: k === 'gas' ? 'S57' : 'S52', route: SK[k].add, bare: true, closeTo: back, html: h };
  }
  V.eadd = function () { return sAdd('elec'); };
  V.gadd = function () { return sAdd('gas'); };
  // форма нового світла/газу: показання (EA.vals), рахунки й № (EA.f), «опалення» (EA.heat) — переживають перерисовку (зони)
  var EA_F = ['ea-name', 'ea-grm', 'ea-acc', 'ea-eic', 'ea-serial'];
  function eaRead() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-ea]'), function (el) { EA.vals[el.getAttribute('data-ea')] = el.value.trim(); });
    EA.f = EA.f || {}; EA_F.forEach(function (id) { var el = document.getElementById(id); if (el) EA.f[id] = el.value.trim(); });
    var hc = document.querySelector('#ea-form [data-eaheat]'); if (hc) EA.heat = hc.checked;
  }
  function eaSave() {
    eaRead();
    var v = function (id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
    var k = EA.kind === 'gas' ? 'gas' : 'elec', md = SK[k].mod, mz = { kind: k, zones: k === 'gas' ? 1 : EA.zones || 1 }, same = smeters(k), name = v('ea-name').slice(0, 40), err = '', bad = '', z = {}, filled = 0;
    md.keys(mz).forEach(function (q) { var raw = EA.vals[q] || ''; if (raw === '') return; filled++; var n = md.norm(raw); if (n === null && !err) { err = tk(k, 'ea_e_val'); bad = 'ea-v-' + q; } z[q] = n; });
    if (!err && filled && filled < md.keys(mz).length) { err = t('ea_e_all'); bad = 'ea-v-' + md.keys(mz).filter(function (q) { return !EA.vals[q]; })[0]; }
    if (!err && same.length && !name) { err = t('wa_e_name'); bad = 'ea-name'; }
    var box = document.getElementById('ea-err');
    if (err) { if (box) box.textContent = err; var bi = document.getElementById(bad); if (bi) bi.focus(); return; }
    var id = md.uid();
    setPMeters(function (list) { var nm = Object.assign({ id: id, kind: k, name: name, serial: v('ea-serial'), account: v('ea-acc'), createdAt: today() }, k === 'elec' ? { zones: mz.zones } : { grm: v('ea-grm'), eic: eicNorm(v('ea-eic')) }); gasMove(nm); list.push(nm); });
    if (!same.length && typeof EA.heat === 'boolean') { var hp = place(); if (EA.heat) hp[SK[k].heat] = true; else delete hp[SK[k].heat]; hp.updatedAt = Date.now(); }
    if (filled) { S.mrecs = S.mrecs || []; S.mrecs.push({ id: md.uid(), place: S.placeId, meter: id, kind: k, date: today(), z: z, base: true, sent: {}, createdAt: new Date().toISOString(), updatedAt: Date.now() }); }
    S.onboarded = true; S.view = k; save(); toast(tk(k, 'ea_added') + inPlace());
    var back = EA.back; EA = { kind: k, back: '', zones: 1, vals: {}, f: {} };
    if (PQ && PQ.place === S.placeId && PQ.i < PQ.list.length) { PQ.i++; pqNext(); return; }
    go(back && /^place-/.test(back) ? back : SK[k].page);
  }

  // ---------- картка запису, історія, статистика, економія ----------
  function erecView(id) {
    var r = mrecs().filter(function (x) { return x.id === id; })[0], back = '<p><a href="#history">← ' + esc(t('hi_title')) + '</a></p>';
    var m = r && pmeters(null, true).filter(function (x) { return x.id === r.meter; })[0];
    if (!r || !m) return { screen: 'S09', route: 'history', html: back + '<p class="muted">' + esc(t('rec_gone')) + '</p>' };
    var k = m.kind === 'gas' ? 'gas' : 'elec', md = SK[k].mod, u = SK[k].unit();
    var x = md.series(mrecs(m.id), m).filter(function (s0) { return s0.rec.id === id; })[0] || {};
    var h = back + '<h1>' + esc(fmtDate(r.date, true)) + '</h1>' + (r.base ? '<p class="small muted">' + esc(t('eh_base')) + '</p>' : '<p class="small muted">' + esc(t('er_for', { m: monthLabel(md.forMonth(r.date)) })) + '</p>');
    h += '<ul class="list" data-key="erec-values">' + md.keys(m).map(function (q) {
      return '<li><div class="grow">' + ico(SK[k].icon, 16, SK[k].cls) + ' ' + esc(ename(m) + (md.zones(m) > 1 ? ' · ' + ezl(m, q) : '')) + (x.dz ? '<div class="small muted">+' + x.dz[q] + ' ' + u + '</div>' : '') + '</div><b class="num">' + md.whole(r.z[q]) + '</b> <span class="small muted">' + u + '</span>' + copyIco(md.whole(r.z[q]), 'erec-copy-' + q) + '</li>';
    }).join('') + '</ul>';
    if (x.dz) {
      var c = md.cost(m, x.dz, r.date, sopts(k));
      h += '<div class="panel" style="margin-top:16px" data-key="erec-used"><h2>' + esc(t('rec_used_title')) + '</h2><div class="cards2"><div><div class="num big ' + SK[k].cls + '">' + x.kwh + ' <small>' + u + '</small></div><div class="small muted">' + esc(t('er_for_days', { d: x.days })) + '</div></div>' +
        '<div><div class="num big">≈ ' + esc(money(c.total)) + '</div><div class="small muted">' + esc(tk(k, 'er_price', { p: money(c.price) })) + '</div></div></div>' +
        (md.zones(m) > 1 ? '<p class="small muted">' + esc(md.keys(m).map(function (q) { return ezl(m, q) + ': ' + x.dz[q] + ' × ' + money(c.price * md.coef(m, q)) + ' = ' + money(c.parts[q]) + ' грн'; }).join(' · ')) + '</p>' : '') +
        (k === 'gas' ? '<p class="small muted">' + esc(t('gst_tariff', { p: money(c.price) })) + '</p>' : '') + '</div>';
    }
    if (r.base) h += ownBox('m', r);
    if (!r.base && !r.own) {
      var w = md.win(today());
      if (w.open && r.date >= w.from && r.date <= w.to) h += whereAcc(ssendPanel(k, smeters(k).map(function (mm) { return mm.id === m.id ? r : einWin(mm.id, w); })), r.id);
      else h += '<p>' + (ssent(k, r) ? '<span class="pill ok">' + ico('check', 14) + ' ' + esc(tk(k, 'ed_org')) + '</span>' : '<span class="pill neutral">' + esc(tk(k, 'ed_org')) + ': ' + esc(t('wh_notsent')) + '</span>') + '</p>';
    }
    h += photoStrip(r.photos, 'm' + r.id, 'm:' + r.id) + (r.base ? '' : billsBox('m:' + r.id, r.bills, t('bl_title', { m: monthLabel(md.forMonth(r.date)) })));
    h += '<div class="row-actions">' + (r.base ? '' : '<button class="btn sec" data-act="eedit" data-id="' + r.id + '" data-key="erec-edit">' + esc(t('rec_edit')) + '</button>') + '<button class="btn danger" data-act="edel" data-id="' + r.id + '" data-key="erec-del">' + esc(t('rec_del')) + '</button></div>';
    if (!r.base) h += ownBox('m', r);
    return { screen: 'S09', route: 'history', html: h };
  }
  function shistory(k) {
    var er = srows(k), head = '<h1>' + esc(t('hi_title')) + '</h1>' + kindSwitch();
    if (!er.total) return { screen: 'S09', route: 'history', html: head + '<div class="panel"><p class="muted">' + esc(t('wh_empty')) + '</p><button class="btn" data-act="' + SK[k].nw + '">' + esc(tk(k, 'en_title')) + '</button></div>' };
    return { screen: 'S09', route: 'history', html: head + er.html + '<p class="small muted">' + esc(tk(k, 'eh_hint')) + '</p>' };
  }
  function smonthly(k) {
    // кілька лічильників — складаємо по місяцях
    var by = {}, md = SK[k].mod;
    smeters(k, true).forEach(function (m) { md.monthly(md.series(mrecs(m.id), m), m, sopts(k)).forEach(function (b) {
      var o = by[b.ym] || (by[b.ym] = { ym: b.ym, kwh: 0, cost: 0, days: 0, night: 0, from: b.from, to: b.to });
      o.kwh += b.kwh; o.cost += b.cost; o.days = Math.max(o.days, b.days); o.night += b.dz.night || 0; if (b.from < o.from) o.from = b.from; if (b.to > o.to) o.to = b.to;
    }); });
    return Object.keys(by).sort().map(function (q) { var b = by[q]; b.perMonth = b.days ? b.kwh / b.days * 30 : b.kwh; return b; });
  }
  function sstats(k) {
    chColors();
    var md = SK[k].mod, u = SK[k].unit(), mo = smonthly(k), sm = md.summary(mo), head = '<h1>' + esc(t('stt_title')) + '</h1>' + kindSwitch();
    if (!mo.length) return { screen: 'S15', route: 'stats', html: head + '<div class="panel"><p class="muted">' + esc(t('est_empty')) + '</p></div>' };
    var per = function (b) { return t('stt_period', { a: R.toHtmDate(b.from), b: R.toHtmDate(b.to), d: b.days }); };
    var two = k === 'elec' && emeters(true).some(function (m) { return El.zones(m) > 1; }), nightKwh = mo.reduce(function (s0, b) { return s0 + b.night; }, 0), allKwh = mo.reduce(function (s0, b) { return s0 + b.kwh; }, 0);
    var tiles = kpi({ key: 'estats-kpi', tone: k, q: fmtN(sm.perMonth, 0), unit: u, money: sm.uahMonth, cap: t('kpi_w_avg', { n: sm.months }),
      chips: [chip(tk(k, 'kpi_e_last', { m: monthLabel(sm.last.ym), v: sm.last.kwh, uah: money0(sm.last.cost) }), 'clock')].concat(two && allKwh ? [chip(t('kpi_e_night', { p: Math.round(nightKwh / allKwh * 100) }), 'moon')] : []) });
    var c1 = barChart(mo.map(function (b) { return { x: ymLabel(b.ym), v: b.kwh, top: String(b.kwh), color: k === 'gas' ? CH.gas : CH.elec, tip: [b.kwh + ' ' + u, per(b), '≈ ' + money(b.cost) + ' грн'] }; }), { title: tk(k, 'est_kwh'), dec: 0 });
    var c2 = barChart(mo.map(function (b) { return { x: ymLabel(b.ym), v: Math.round(b.cost), top: String(Math.round(b.cost)), color: CH.barSoft, tip: ['≈ ' + money(b.cost) + ' грн', per(b), b.kwh + ' ' + u] }; }), { title: t('wst_uah'), dec: 0 });
    var table = '<details class="panel wacc tbl-acc" data-key="stt-table"><summary><h2>' + esc(t('stt_table')) + '</h2>' + ico('chev', 20, 'pacc-chev') + '</summary><div class="tbl-wrap where-b"><table class="tbl"><thead><tr><th>' + esc(t('wst_th_month')) + '</th><th>' + esc(t('stt_th_period')) + '</th><th>' + u + '</th><th>грн</th></tr></thead><tbody>' +
      mo.slice().reverse().map(function (b) { return '<tr><td>' + esc(ymLabel(b.ym)) + '</td><td>' + esc(R.toHtmDate(b.from) + ' – ' + R.toHtmDate(b.to)) + '</td><td class="num">' + b.kwh + '</td><td class="num">' + money(b.cost) + '</td></tr>'; }).join('') + '</tbody></table></div></details>';
    var panel = function (title, sub, chart) { return '<section class="panel chart-panel"><h2>' + esc(title) + '</h2><p class="small muted">' + esc(sub) + '</p>' + chart + '</section>'; };
    var price = k === 'gas' ? (sopts('gas').price || Gs.priceAt(today())) : El.priceAt(today());
    return { screen: 'S15', route: 'stats', html: head + '<p class="muted">' + esc(tk(k, 'est_lead')) + '</p>' + tiles + panel(tk(k, 'est_kwh'), t('est_kwh_sub'), c1) + panel(t('wst_uah'), tk(k, 'est_tariff', { p: money(price) }), c2) + table + '<p class="small muted">' + esc(tk(k, 'est_method')) + '</p>' };
  }
  function ssave(k) {
    var md = SK[k].mod, u = SK[k].unit(), mo = smonthly(k), sm = md.summary(mo), list = tk(k, 'esv_tips').split('||').map(function (x) { var a = x.split('|'); return [a[0], a[1]]; });
    var one = k === 'elec' && emeters().length && emeters().every(function (m) { return El.zones(m) === 1; }), p = El.priceAt(today());
    var mine = sm ? '<div class="panel" data-key="esave-mine"><h2>' + esc(t('sv_mine')) + '</h2>' +
      kpi({ key: 'esave-kpi', tone: k, q: fmtN(sm.perMonth, 0), unit: u, money: sm.uahMonth, cap: t('kpi_w_avg', { n: sm.months }) }) +
      tipLine(SK[k].icon, tk(k, 'kpi_e_ten', { k: fmtN(sm.perMonth * 0.1, 0), uah: '<b>' + esc(money0(sm.uahMonth * 0.1)) + ' грн</b>', y: esc(money0(sm.uahMonth * 1.2)) })) +
      (one ? tipLine('moon', t('kpi_e_two', { uah: '<b>' + esc(money0(sm.perMonth * 0.3 * p * 0.5)) + ' грн</b>' })) : '') + '</div>'
      : '<div class="panel"><p class="muted">' + esc(tk(k, 'esv_no_data')) + '</p></div>';
    var groups = k === 'gas' ? [[t('gsv_g1'), 'flame', [0, 1, 2]], [t('gsv_g2'), 'drop', [3, 4]], [t('gsv_g3'), 'thermo', [5, 6, 7]]] : [[t('esv_g1'), 'moon', [0, 1, 2]], [t('esv_g2'), 'home', [3, 4, 5]], [t('esv_g3'), 'bolt', [6, 7]]];
    return { screen: 'S14', route: 'save', html: '<h1>' + esc(tk(k, 'esv_title')) + '</h1>' + kindSwitch() + '<p class="muted">' + esc(tk(k, 'esv_lead')) + '</p>' + mine +
      accGroups(groups.map(function (g) { return { title: g[0], icon: g[1], items: g[2].map(function (q) { return { title: list[q][0], html: '<p>' + esc(list[q][1]) + '</p>' }; }) }; }), k === 'gas' ? 'gsave-tips' : 'esave-tips') };
  }
  function ehistory() { return shistory('elec'); }
  function estats() { return sstats('elec'); }
  function esave() { return ssave('elec'); }

  // ---------- ввод показаний воды ----------
  /** Кнопка «Скасувати» внизу ввода: бросить всё введённое этим разом и выйти. */
  function cancelLink(what) { return '<p class="wiz-cancel"><button type="button" class="btn ter sm" data-act="wiz-cancel" data-what="' + what + '" data-key="wiz-cancel">' + esc(t('wz_cancel')) + '</button></p>'; }
  function wnFresh(kind) { return { kind: kind || 'hot', date: '', vals: {}, photos: [], src: {}, auto: {}, unused: [], busy: false }; }
  var WN = wnFresh('hot');
  V.wnew = function () {
    var ms = wmeters(); if (!ms.length) return V.wsetup();
    var order = ms.slice().sort(function (a, b) { return (a.kind === WN.kind ? 0 : 1) - (b.kind === WN.kind ? 0 : 1); });
    var date = WN.date || today(), back = WN.back || 'water-' + WN.kind;
    var prev = {}; ms.forEach(function (m) { var r = wprevFor(m.id, date); if (r) prev[m.id] = r; });
    var h = '<h1>' + esc(t('wn_title')) + '</h1><p class="small muted">' + esc(t(VIS().local ? 'wnp_lead' : 'wn_lead')) + '</p>' + wnPhotoBox() +
      '<div class="field" style="max-width:280px"><label for="wn-date">' + esc(t('wn_date')) + '</label><div class="ctl"><input id="wn-date" type="date" value="' + esc(date) + '" max="' + today() + '"></div></div>' +
      '<form id="wn-form" novalidate>' + order.map(function (m) {
        var p = prev[m.id];
        return '<div class="field wfield" id="wf-' + m.id + '"><label for="wn-' + m.id + '">' + ico('drop', 16, m.kind === 'hot' ? 'c-hot' : 'c-cold') + ' ' + esc(wname(m)) + '</label>' +
          '<div class="ctl"><input id="wn-' + m.id + '" class="num" inputmode="decimal" autocomplete="off" data-wn="' + m.id + '" value="' + esc(WN.vals[m.id] || '') + '" placeholder="' + (p ? esc(wfmt(p.vals[m.id])) : '') + '" aria-describedby="wh-' + m.id + '"><span class="unit">м³</span>' +
          wnSrcThumb(m.id) + '<label class="wcam" title="' + esc(t('wn_photo')) + '"><input type="file" accept="image/*" capture="environment" class="sr" data-wphoto="' + m.id + '" aria-label="' + esc(t('wn_photo') + ': ' + wname(m)) + '">' + ico('camera', 20) + '</label></div>' +
          '<div class="help" id="wh-' + m.id + '">' + esc(wnSrcText(m.id)) + (p ? esc(t('wn_prev', { v: Wt.whole(p.vals[m.id]), d: fmtDate(p.date) })) : esc(t('wn_first'))) + '</div></div>';
      }).join('') +
      '<p class="small muted">' + esc(t('wn_digits')) + '</p>' +
      '<div class="wiz-actions"><button class="btn" type="submit" data-key="wn-save">' + esc(t('wn_save')) + '</button></div></form>' + cancelLink('water') + ownField();
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
    // меньше прошлого или слишком много — а у такого же водомера другой квартиры как раз подходит: «не та квартира?»
    ms.forEach(function (m) {
      if (!issues[m.id].some(function (x) { return x.code === 'less' || x.code === 'jump'; })) return;
      var o = otherPlaceLike(m.kind, Number(Wt.norm(vals[m.id])), date);
      if (o) issues[m.id].push({ code: 'other', level: 'warn', args: { p: o.p, v: o.v, c: placeLabel(place()) } });
    });
    if (show) ms.forEach(function (m) {
      var el = document.getElementById('wh-' + m.id), fw = document.getElementById('wf-' + m.id); if (!el) return;
      var list = issues[m.id].filter(function (x) { return x.code !== 'empty' || show === 'submit'; }), p = prev[m.id];
      var txt = list.map(function (x) { return t('wi_' + x.code, Object.assign({ prev: p ? Wt.whole(p.vals[m.id]) : '', n: x.perMonth || '', w: x.whole }, x.args || {})); }).join(' ');
      var lvl = list.some(function (x) { return x.level === 'block'; }) ? 'block' : list.some(function (x) { return x.level === 'warn'; }) ? 'warn' : list.length ? 'ok' : '';
      el.textContent = wnSrcText(m.id) + (txt || (p ? t('wn_prev', { v: Wt.whole(p.vals[m.id]), d: fmtDate(p.date) }) : t('wn_first')));
      el.className = 'help' + (lvl ? ' ' + lvl : ''); if (fw) fw.className = 'field wfield' + (lvl === 'block' ? ' is-block' : lvl === 'warn' ? ' is-warn' : '');
    });
    return issues;
  }
  function wnSave() {
    wnRead(); var iss = wnCheck('submit');
    if (Wt.blocked(iss)) { var f = document.querySelector('.wfield.is-block input'); if (f) f.focus(); return; }
    var vals = {}; wmeters().forEach(function (m) { var v = Wt.norm(WN.vals[m.id]); if (v !== null) vals[m.id] = v; });
    var date = WN.date || today(), now = new Date().toISOString();
    S.water = S.water || [];
    // одна запись на квартиру и дату: повторный ввод в тот же день — правка
    var same = (S.water || []).filter(function (r) { return r && !r.deleted && !r.base && r.place === S.placeId && r.date === date; })[0];
    // фото, с которых сняли, — к записи (видны в истории)
    var refs = photoRefs((WN.photos || []).map(function (p) { return { file: p.file, meter: p.meters && p.meters.length === 1 ? p.meters[0] : undefined }; }));
    var own = ownChecked();
    if (same) { same.vals = Object.assign({}, same.vals, vals); if (refs.length) same.photos = (same.photos || []).concat(refs); if (own) same.own = true; same.updatedAt = Date.now(); }
    else S.water.push(Object.assign({ id: Wt.uid(), place: S.placeId, date: date, vals: vals, createdAt: now, updatedAt: Date.now(), sent: {} }, refs.length ? { photos: refs } : {}, own ? { own: true } : {}));
    if (!S.onboarded) S.onboarded = true;
    if (WN.inbox && WN.inbox.length && window.TEPLO_API) { var ib = WN.inbox; INBOX.items = (INBOX.items || []).filter(function (x) { return ib.indexOf(x.id) < 0; }); api0('/inbox/done', { method: 'POST', body: JSON.stringify({ ids: ib }) }).catch(function () {}); }
    var k = WN.kind, back = WN.back; WN = wnFresh(k);
    save(); toast(t('wn_saved') + inPlace());
    if (back) go(back); else { SCROLL_TO = 'wsend-vk'; go('water-' + k); }
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
        return '<div class="field"><label for="wz-' + i + '">' + ico('drop', 16, x[0] === 'hot' ? 'c-hot' : 'c-cold') + ' ' + esc(nm) + '</label><div class="ctl"><input id="wz-' + i + '" class="num" inputmode="decimal" autocomplete="off" data-wz="' + i + '" value="' + esc(WS.vals[i] || '') + '"><span class="unit">м³</span></div></div>';
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
    var vals = {}; ids.forEach(function (id, i) { var v = Wt.norm(WS.vals[i]); if (v !== null) vals[id] = v; });
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
    var h = '<div class="panel" id="water-block" tabindex="-1" data-key="prefs-water"><h2>' + esc(t('wm_title')) + (places().length > 1 ? ' <span class="muted small">· ' + esc(placeLabel(place())) + '</span>' : '') + '</h2>';
    if (!ms.length) return h + '<p class="small muted">' + esc(t('uc_w_empty')) + '</p><button class="btn sec" data-act="wsetup" data-kind="hot">' + ico('plus', 18) + '<span>' + esc(t('uc_w_setup_btn')) + '</span></button></div>';
    h += '<p class="small muted">' + esc(t('wm_sub')) + '</p>' + ms.map(function (m) {
      return '<fieldset class="wm-row"><legend>' + ico('drop', 16, m.kind === 'hot' ? 'c-hot' : 'c-cold') + ' ' + esc(wname(m)) + '</legend><div class="grid2">' +
        '<div class="field"><label for="wmk-' + m.id + '">' + esc(t('wm_kind')) + '</label><div class="ctl"><select id="wmk-' + m.id + '" data-wm="' + m.id + '" data-wf="kind"><option value="hot"' + (m.kind === 'hot' ? ' selected' : '') + '>' + esc(t('wt_hot')) + '</option><option value="cold"' + (m.kind === 'cold' ? ' selected' : '') + '>' + esc(t('wt_cold')) + '</option></select></div></div>' +
        '<div class="field"><label for="wmn-' + m.id + '">' + esc(t('wm_name')) + '</label><div class="ctl"><input id="wmn-' + m.id + '" data-wm="' + m.id + '" data-wf="name" value="' + esc(m.name || '') + '" placeholder="' + esc(t('wm_name_ph')) + '"></div></div>' +
        '<div class="field"><label for="wms-' + m.id + '">' + esc(t('wm_serial')) + '</label><div class="ctl"><input id="wms-' + m.id + '" class="num" autocomplete="off" data-wm="' + m.id + '" data-wf="serial" value="' + esc(m.serial || '') + '"></div></div>' +
        '<div class="field"><label for="wmi-' + m.id + '">' + esc(t('wm_vkid')) + '</label><div class="ctl"><input id="wmi-' + m.id + '" class="num" inputmode="numeric" autocomplete="off" data-wm="' + m.id + '" data-wf="vkId" value="' + esc(m.vkId || '') + '"></div><div class="help">' + esc(t('wm_vkid_h')) + '</div></div>' +
        '<div class="field"><label for="wmv-' + m.id + '">' + esc(t('mv_date')) + '</label><div class="ctl"><input id="wmv-' + m.id + '" type="date" data-wm="' + m.id + '" data-wf="verifiedUntil" value="' + esc(m.verifiedUntil || '') + '"></div></div>' +
        '</div><div class="row-actions" style="margin-top:4px"><button class="linkbtn" data-act="m-replace" data-what="' + m.id + '">' + esc(t('mr_replace')) + '</button><button class="linkbtn" data-act="m-remove" data-what="' + m.id + '" data-key="wm-remove-' + m.id + '">' + esc(t('mr_remove')) + '</button></div></fieldset>';
    }).join('') +
      '<div class="row-actions" style="margin-top:8px"><button class="btn sec" data-act="wm-add" data-kind="hot">' + ico('plus', 18) + '<span>' + esc(t('wm_add_hot')) + '</span></button><button class="btn sec" data-act="wm-add" data-kind="cold">' + ico('plus', 18) + '<span>' + esc(t('wm_add_cold')) + '</span></button></div>' +
      '<h3 style="margin-top:20px">' + esc(t('wm_acc_t')) + '</h3>' + waccForm() + '</div>';
    return h;
  }

  // действия воды
  function waterAct(act, el, e) {
    switch (act) {
      case 'st-open': stOpen(el); return true;
      case 'st-set': stApply(el.getAttribute('data-src'), el.getAttribute('data-id'), el.getAttribute('data-k'), el.getAttribute('data-v')); return true;
      case 'own': case 'base-sent': {
        var osrc = el.getAttribute('data-src'), oid = el.getAttribute('data-id'), on = el.getAttribute('data-v') === '1';
        var orec = ((osrc === 'w' ? S.water : osrc === 'm' ? S.mrecs : S.readings) || []).filter(function (x) { return x && x.id === oid; })[0]; if (!orec) return true;
        if (act === 'own') { if (on) orec.own = true; else delete orec.own; }
        else { orec.sent = Object.assign({}, orec.sent || {}); if (on) delete orec.sent.no; else orec.sent.no = true; }
        orec.updatedAt = Date.now(); save(); toast(t('b_saved')); render(true); return true;
      }
      case 'en-stop': EN.gen = (EN.gen || 0) + 1; EN.busy = false; render(true); return true;
      case 'en-ph-rm': { enRead(); var ri = +el.getAttribute('data-i'); EN.photos.splice(ri, 1); Object.keys(EN.src).forEach(function (q) { var x = EN.src[q]; if (x.photo === ri) { if (EN.auto[q]) { var a0 = q.split('|'); if (EN.vals[a0[0]]) EN.vals[a0[0]][a0[1]] = ''; delete EN.auto[q]; } delete EN.src[q]; } else if (x.photo > ri) x.photo--; }); render(true); return true; }
      case 'enew': EN = enFresh('elec'); go('enew'); return true;
      case 'gnew': EN = enFresh('gas'); go('gnew'); return true;
      case 'esent': { var eids = (el.getAttribute('data-ids') || '').split(','), ev = el.getAttribute('data-v') === '1';
        var esk = SK[el.getAttribute('data-k')] ? SK[el.getAttribute('data-k')].sk : 'obl';
        (S.mrecs || []).forEach(function (x) { if (eids.indexOf(x.id) >= 0) { x.sent = Object.assign({}, x.sent || {}); x.sent[esk] = ev ? today() : ''; x.updatedAt = Date.now(); } }); save(); render(true); return true; }
      case 'edel': { if (!confirm(t('wh_del_q'))) return true; var ed = (S.mrecs || []).filter(function (x) { return x.id === el.getAttribute('data-id'); })[0]; if (ed) { ed.deleted = true; ed.updatedAt = Date.now(); photoKeep(ed.photos, false); billsDrop(ed.bills); save(); if (/^erec-/.test(routeName())) go('history'); else render(true); } return true; }
      case 'eedit': { var ee = mrecs().filter(function (x) { return x.id === el.getAttribute('data-id'); })[0]; if (!ee) return true;
        EN = enFresh(ee.kind === 'gas' ? 'gas' : 'elec'); EN.date = ee.date; EN.skip = ee.id; EN.vals[ee.meter] = {}; Object.keys(ee.z || {}).forEach(function (k) { EN.vals[ee.meter][k] = String(ee.z[k] || '').replace('.', ','); });
        mrecs().forEach(function (x) { if (x.date === ee.date && !x.base && x.meter !== ee.meter && x.kind === ee.kind) { EN.vals[x.meter] = {}; Object.keys(x.z || {}).forEach(function (k) { EN.vals[x.meter][k] = String(x.z[k] || '').replace('.', ','); }); } });
        EN.back = routeName(); go(SK[EN.k].nw); return true; }
      case 'ea-zones': eaRead(); EA.zones = Number(el.value) || 1; render(true); var ez = document.querySelector('[data-key=ea-z' + EA.zones + ']'); if (ez) ez.focus(); return true;
      case 'wnew': WN = wnFresh(el.getAttribute('data-kind') || 'hot'); go(wmeters().length ? 'wnew' : 'wsetup'); return true;
      case 'wsetup': WS = { step: 0, preset: (el.getAttribute('data-kind') === 'cold' ? 'hc' : 'hc'), vals: {}, kind: el.getAttribute('data-kind') || 'hot' }; go('wsetup'); return true;
      case 'setup-heat': go('meter'); return true;
      case 'wz-preset': WS.preset = el.value; return true;
      case 'wz-next': e.preventDefault(); wzRead(); if (WS.step === 0) { var ch = document.querySelector('input[name="wz"]:checked'); if (ch) WS.preset = ch.value; } WS.step = Math.min(2, WS.step + 1); render(); return true;
      case 'wz-back': e.preventDefault(); wzRead(); WS.step = Math.max(0, WS.step - 1); render(); return true;
      case 'wz-done': e.preventDefault(); wzDone(); return true;
      case 'wsent': { var r = (S.water || []).filter(function (x) { return x.id === el.getAttribute('data-id'); })[0]; if (!r) return true; if (el.getAttribute('data-key') === 'vk-ok') vkEvent('ok'); r.sent = Object.assign({}, r.sent || {}); r.sent[el.getAttribute('data-to')] = el.getAttribute('data-v') === '1' ? today() : ''; r.updatedAt = Date.now(); save(); render(true); return true; }
      case 'wdel': { if (!confirm(t('wh_del_q'))) return true; var r2 = (S.water || []).filter(function (x) { return x.id === el.getAttribute('data-id'); })[0]; if (r2) { r2.deleted = true; r2.updatedAt = Date.now(); photoKeep(r2.photos, false); billsDrop(r2.bills); save(); if (/^wrec-/.test(routeName())) go('history'); else render(true); } return true; }
      case 'wedit': { var r3 = wrecs().filter(function (x) { return x.id === el.getAttribute('data-id'); })[0]; if (!r3) return true;
        var k3 = wmeters('hot').some(function (m) { return hasVal(r3, m.id); }) ? 'hot' : 'cold', v3 = {};
        Object.keys(r3.vals || {}).forEach(function (k) { v3[k] = wfmt(r3.vals[k]); });
        WN = Object.assign(wnFresh(k3), { date: r3.date, vals: v3, back: 'wrec-' + r3.id }); go('wnew'); return true; }
      case 'view': S.view = el.getAttribute('data-v'); persist(); render(true); return true;
      case 'place-view': switchPlace(el.getAttribute('data-id')); render(true); return true;
      case 'wn-stop': { wnRead(); WN.gen = -1; WN.busy = false; WN.photos = WN.photos.filter(function (p) { return p.res; }); if (WN.photos.some(function (p) { return !p.fixed; })) wnAssign(); render(true); wnCheck(true); return true; }
      case 'wn-swap': { wnRead(); var a = el.getAttribute('data-a'), b = el.getAttribute('data-b'), va = WN.vals[a], sa = WN.src[a];
        WN.vals[a] = WN.vals[b]; WN.vals[b] = va; WN.src[a] = WN.src[b]; WN.src[b] = sa;
        [a, b].forEach(function (k) { if (WN.src[k]) WN.src[k] = Object.assign({}, WN.src[k], { guess: false, why: 'swap' }); });
        WN.photos.forEach(function (p) { p.meters = (p.meters || []).map(function (k) { return k === a ? b : k === b ? a : k; }); });
        render(true); wnCheck(true); return true; }
      case 'wn-ph-rm': { wnRead(); var i = +el.getAttribute('data-i'), gone = WN.photos[i]; if (!gone) return true;
        WN.photos.splice(i, 1);
        Object.keys(WN.src).forEach(function (k) { var x = WN.src[k]; if (x.photo === i) { if (WN.auto[k]) delete WN.vals[k]; delete WN.src[k]; } else if (x.photo > i) x.photo--; });
        if (WN.photos.some(function (p) { return !p.fixed; })) wnAssign();
        render(true); wnCheck(true); return true; }
      case 'view-go': S.view = el.getAttribute('data-v'); persist(); go(el.getAttribute('data-to')); return true;
      case 'gap-del': { var gd = gapById(el.getAttribute('data-id')); if (!gd || !confirm(t('gp_del_q'))) return true; var gk = gapKind(gd); billsDrop(gd.bills);
        setGaps(function (list) { list.forEach(function (x) { if (x && x.id === gd.id) { x.deleted = true; x.updatedAt = Date.now(); } }); }); toast(t('gp_deleted')); go(gk === 'heat' ? 'heat' : 'water-' + (gk || 'hot')); return true; }
      case 'wm-add': wsetCfg(function (c) { c.meters = c.meters || []; c.meters.push({ id: Wt.uid(), kind: el.getAttribute('data-kind'), name: '', serial: '', vkId: '', verifiedUntil: '' }); }); render(true); return true;
      case 'wm-del': if (!confirm(t('wm_del_q'))) return true; wsetCfg(function (c) { (c.meters || []).forEach(function (m) { if (m.id === el.getAttribute('data-id')) m.deleted = true; }); }); render(true); return true;
      case 'wrefresh': render(true); return true;
      // квартира и её счётчики
      case 'add-meter': e.preventDefault(); AM_BACK = el.getAttribute('data-back') || (/^(place-.+|water-hot|water-cold|heat)$/.test(routeName()) ? routeName() : 'home'); go('add-meter'); return true;
      case 'am-pick': { var ak = el.getAttribute('data-kind');
        if (ak === 'heat') { delete S._pickModel; go('meter'); return true; }
        if (SK[ak]) { EA = { kind: ak, back: AM_BACK, zones: 1, vals: {}, f: {} }; go(SK[ak].add); return true; }
        WA = { kind: ak, back: AM_BACK }; go('wadd'); return true; }
      case 'm-remove': { var mw = el.getAttribute('data-what'), mn = meterTitle(mw), mh = meterHasData(mw);
        if (!confirm(t(mh ? 'mr_q' : 'mr_q_empty', { m: mn, p: placeLabel(place()) }))) return true;
        meterRemove(mw); toast(t(mh ? 'mr_done' : 'mr_done_empty', { m: mn })); render(true); return true; }
      case 'm-restore': { var rw = el.getAttribute('data-what'), rn = meterTitle(rw); meterRestore(rw); toast(t('mr_restored', { m: rn })); if (el.getAttribute('data-back')) go(AM_BACK || 'home'); else render(true); return true; }
      case 'm-replace': { var pw = el.getAttribute('data-what'); GAP_PRESET = { what: pw }; go('gap-new-' + pw); return true; }
      case 'pl-go': switchPlace(el.getAttribute('data-id')); WX.key = ''; toast(t('pl_switched', { p: placeLabel(place()) })); go('home'); return true;
      case 'pv-chip': { ensurePlaces(); var pc = place(); pc.name = el.getAttribute('data-v'); pc.updatedAt = Date.now(); save(); render(true); return true; }
      case 'pl-del-ask': { var dq = place(el.getAttribute('data-id')), box = document.getElementById('pl-del-confirm'); if (!dq || !box) return true;
        var dn = (S.readings || []).filter(function (r) { return r && !r.deleted && r.place === dq.id; }).length + (S.water || []).filter(function (r) { return r && !r.deleted && !r.base && r.place === dq.id; }).length;
        box.innerHTML = '<div class="banner warn" style="margin-top:16px" role="alert">' + ico('alert', 22) + '<div><p><b>' + esc(t('pv_del_q', { p: placeLabel(dq), n: dn })) + '</b></p><div class="row-actions" style="margin-top:8px"><button class="btn sec" data-act="pl-del-no">' + esc(t('cancel')) + '</button><button class="btn danger solid" data-act="pl-del" data-id="' + esc(dq.id) + '" data-key="pv-del-yes">' + esc(t('pv_del_yes', { p: placeLabel(dq) })) + '</button></div></div></div>';
        var yes = box.querySelector('[data-act=pl-del]'); if (yes) yes.focus(); return true; }
      case 'pl-del-no': { var bx0 = document.getElementById('pl-del-confirm'); if (bx0) bx0.innerHTML = ''; return true; }
      case 'to-water': e.preventDefault(); SCROLL_TO = 'water-block'; go('prefs'); return true;
      case 'to-nometer': e.preventDefault(); SCROLL_TO = 'nometer-w'; go('prefs'); return true;
      case 'vk-send': case 'vk-open': {
        var vtx = el.getAttribute('data-text'), vurl = Wt.VK_BOT + '?text=' + encodeURIComponent(vtx);
        copyText(vtx, null);   // запасний шлях: вперше бот просить «Старт» — команду можна вставити
        if (act === 'vk-send') vkEvent('send');
        if (act === 'vk-send') { var vr = (S.water || []).filter(function (x) { return x.id === el.getAttribute('data-id'); })[0]; if (vr) { vr.vkAt = Date.now(); if (vr.sent && vr.sent.vk) { vr.sent = Object.assign({}, vr.sent, { vk: '' }); delete vr.vkConf; } vr.updatedAt = Date.now(); delete VKERR[vr.id]; save(); } }   // ще раз — нове підтвердження
        else VKR.idsAt = Date.now();
        setTimeout(function () { var tw = window.Telegram && window.Telegram.WebApp; if (tw && tw.openTelegramLink) tw.openTelegramLink(vurl); else window.open(vurl, '_blank', 'noopener'); render(true); }, 200);
        return true;
      }
      case 'sbot': {
        e.preventDefault();
        var sbk = el.getAttribute('data-k') === 'gas' ? 'gas' : 'elec', sbids = (el.getAttribute('data-ids') || '').split(','), sbn = Date.now(), sburl = el.getAttribute('href');
        (S.mrecs || []).forEach(function (x) { if (sbids.indexOf(x.id) >= 0 && !ssent(sbk, x)) { x.botAt = sbn; x.updatedAt = sbn; } });
        delete SBERR[sbk]; save();
        if (el.getAttribute('data-copy')) copyText(el.getAttribute('data-copy'), null);   // показання — у буфер: у боті лише вставити
        var sbtw = window.Telegram && window.Telegram.WebApp; if (sbtw && sbtw.openTelegramLink) sbtw.openTelegramLink(sburl); else window.open(sburl, '_blank', 'noopener');
        render(true); return true;
      }
      case 'sb-err': SBERR[el.getAttribute('data-k') === 'gas' ? 'gas' : 'elec'] = true; render(true); return true;
      case 'vkc-check': vkcCheck(); return true;
      case 'vkc-send': vkcSend(el.getAttribute('data-id')); return true;
      case 'vkc-pick': VKC.pick[el.getAttribute('data-id')] = true; render(true); return true;
      case 'vkc-cancel': VKC.check = null; VKC.res = null; VKC.err = null; render(true); return true;
      case 'vkc-again': { var va = (S.water || []).filter(function (x) { return x.id === el.getAttribute('data-id'); })[0]; if (va) { va.sent = Object.assign({}, va.sent || {}, { vk: '' }); delete va.vkConf; va.updatedAt = Date.now(); save(); } VKC.check = null; VKC.res = null; render(true); return true; }
      case 'vk-err': VKERR[el.getAttribute('data-id')] = true; vkEvent(el.getAttribute('data-why') === 'silent' ? 'silent' : 'err'); render(true); return true;
      case 'vk-id-chip': {
        var empty = Array.prototype.filter.call(document.querySelectorAll('input[data-wf="vkId"]'), function (x) { return !x.value; })[0];
        if (empty) { empty.value = el.getAttribute('data-v'); empty.dispatchEvent(new Event('change', { bubbles: true })); el.classList.add('done'); }
        return true;
      }
      case 'copy-open': copyText(el.getAttribute('data-text'), el); setTimeout(function () { var tw = window.Telegram && window.Telegram.WebApp; if (tw && tw.openTelegramLink) tw.openTelegramLink(el.getAttribute('data-url')); else window.open(el.getAttribute('data-url'), '_blank', 'noopener'); }, 250); return true;
    }
    return false;
  }
  // поля: настройки водомеров, рахунок, ввод
  document.addEventListener('change', function (e) {
    var el = e.target; if (!el || !el.getAttribute) return;
    var k = el.getAttribute('data-wcfg');
    if (k) { wsetCfg(function (c) { c[k] = el.value.trim(); }); if (document.querySelector('[data-key=where-water]')) safeRender(); return; }   // команда для бота — з новим рахунком
    var mid = el.getAttribute('data-wm');
    if (mid) { var f = el.getAttribute('data-wf'); wsetCfg(function (c) { (c.meters || []).forEach(function (m) { if (m.id === mid) m[f] = el.value.trim(); }); }); if (f === 'kind' || f === 'cabKey') render(true); return; }
    if (el.id === 'wn-date') { WN.date = el.value; wnCheck(true); return; }
    var ph = el.getAttribute('data-wphoto');
    if (ph && el.files && el.files[0]) wnPhoto(ph, el.files[0], el);
  });
  document.addEventListener('input', function (e) { var el = e.target; if (el && el.getAttribute && el.getAttribute('data-wn')) { WN.vals[el.getAttribute('data-wn')] = el.value.trim(); wnCheck(true); } });
  document.addEventListener('submit', function (e) { if (e.target && e.target.id === 'wn-form') { e.preventDefault(); wnSave(); } if (e.target && e.target.id === 'wa-form') { e.preventDefault(); waSave(); } if (e.target && e.target.id === 'en-form') { e.preventDefault(); enSave(); } if (e.target && e.target.id === 'ea-form') { e.preventDefault(); eaSave(); } }, true);
  /** Фото одного водомера (камера у поля) → цифры барабана; фото остаётся к записи. */
  function wnPhoto(mid, file, el) {
    var help = document.getElementById('wh-' + mid), lab = el.closest && el.closest('.wcam');
    if (!VIS().local) { toast(t('ph_unavail')); return; }
    if (help) { help.innerHTML = SPIN + ' ' + esc(t('wn_reading')); help.className = 'help'; }
    if (lab) lab.setAttribute('aria-busy', 'true');
    VIS()._engine(function () {}).then(function () { return ocrRead(file); }).then(function (res) {
      wnRead();
      var p = wprevFor(mid, WN.date || today()), r = Wt.fromOcr(res, p ? p.vals[mid] : null);
      WN.photos.forEach(function (x) { x.meters = (x.meters || []).filter(function (k) { return k !== mid; }); });
      WN.photos.push({ file: file, url: URL.createObjectURL(file), res: { lines: res.lines, drums: res.drums }, ms: res.ms, meters: [mid], fixed: mid });
      var pi = WN.photos.length - 1;
      var ok = photoKind(res);
      if (ok) WN.src[mid] = { photo: pi, value: null, none: true, other: ok };
      else if (!r) WN.src[mid] = { photo: pi, value: null, none: true };
      else {
        WN.src[mid] = { photo: pi, value: r.value, frac: r.value !== null ? (r.frac || '') : '', partial: r.partial || null, half: !!r.half, pair: r.pair || null, lead: !!r.lead && !r.sure, why: 'field' };
        if (r.value !== null) { WN.vals[mid] = Wt.withFrac(r.value, r.frac); WN.auto[mid] = true; }
      }
      render(true); wnCheck(true); wnReport();
      var inp = document.getElementById('wn-' + mid); if (inp && (!r || r.value === null)) inp.focus();
    }, function () { if (lab) lab.removeAttribute('aria-busy'); if (help) { help.textContent = t('ph_err_engine'); help.className = 'help warn'; } });
  }
  // ---------- вода «по фото, как отопление»: пачка фото → раскладка по водомерам ----------
  /** Подпись «откуда цифры» в подсказке поля. */
  function wnSrcText(mid) {
    var x = WN.src && WN.src[mid]; if (!x) return '';
    var n = x.photo + 1;
    if (x.other) return t('wnp_src_other_' + x.other, { n: n }) + ' ';
    if (x.none) return t('wnp_src_none', { n: n }) + ' ';
    if (x.value === null) return t('wnp_src_half', { n: n, p: x.partial || '' }) + ' ';
    return t('wnp_src', { n: n, v: Wt.withFrac(x.value, x.frac) }) + (x.why && x.why !== 'field' ? ' ' + t('wnp_why_' + x.why) : '') + '. ' + (x.guess || !x.why ? t('wnp_check') + ' ' : x.half ? halfHint(x.pair) + ' ' : '') + (x.lead ? t('wnp_glare') + ' ' : '');
  }
  /** Ролик между цифрами: «між 2 і 3 — взяли меншу» (пару узнал движок) или просто «між цифрами». */
  function halfHint(pair) {
    var pr = (pair || []).filter(Boolean), last = pr[pr.length - 1];
    return last ? t('wnp_half_pair', { a: last[0], b: last[1] }) : t('wnp_half');
  }
  function wnSrcThumb(mid) {
    var x = WN.src && WN.src[mid], p = x && WN.photos[x.photo]; if (!p) return '';
    return '<span class="wsrc"><img data-gal="wnf-' + esc(mid) + '" src="' + p.url + '" alt="' + esc(t('ph_from', { n: x.photo + 1 })) + '"></span>';
  }
  function wnPhotoBox() {
    if (!VIS().local) return '';
    var ph = WN.photos || [], ms = wmeters(), h = '<div class="panel wn-photo" data-key="wn-photo"><input type="file" id="wn-files" accept="image/*" multiple class="sr" data-key="wn-files">';
    if (WN.busy) h += '<div class="banner" role="status" style="margin:0">' + SPIN + '<div class="grow"><p id="wn-prog">' + esc(WN.prog || t('wn_reading')) + '</p><div class="pbar" aria-hidden="true"><i id="wn-pbar" style="width:' + (WN.pct || 2) + '%"></i></div>' +
      '<p style="margin:10px 0 0"><button class="btn sec" data-act="wn-stop" data-key="wn-stop">' + ico('close', 18) + '<span>' + esc(t('ph_stop')) + '</span></button></p></div></div>';
    else h += '<label for="wn-files" class="btn sec' + (ph.length ? '' : ' block') + '" tabindex="0" data-key="wn-photo-pick">' + ico('camera', 22) + '<span>' + esc(ph.length ? t('wnp_more') : t('wnp_pick')) + '</span></label>' +
      (ph.length ? '' : '<p class="small muted" style="margin:8px 0 0">' + esc(t('wnp_hint')) + '</p>');
    if (WN.err) h += '<p class="help warn">' + esc(WN.err) + '</p>';
    if (ph.length) {
      h += '<ul class="thumbs wn-thumbs">' + ph.map(function (p, i) {
        var mine = ms.filter(function (m) { return (p.meters || []).indexOf(m.id) >= 0; });
        return '<li><img data-gal="wn" data-i="' + i + '" src="' + p.url + '" alt="' + esc(t('ph_from', { n: i + 1 })) + '"><span class="n">' + (i + 1) + '</span>' +
          (WN.busy ? '' : '<button class="rm" data-act="wn-ph-rm" data-i="' + i + '" aria-label="' + esc(t('ph_remove')) + '">' + ico('close', 16) + '</button>') +
          (mine.length ? '<span class="wn-tags">' + mine.map(function (m) { return '<i class="' + (m.kind === 'hot' ? 'n-hot' : 'n-cold') + '">' + esc(m.name || t('kv_' + m.kind)) + '</i>'; }).join('') + '</span>' : '') + '</li>';
      }).join('') + '</ul>';
      if (!WN.busy) {
        var lines = ph.map(function (p, i) {
          var mine = ms.filter(function (m) { return (p.meters || []).indexOf(m.id) >= 0; });
          if (!p.res) return '';
          var nm = t('ph_from', { n: i + 1 }); nm = nm.charAt(0).toUpperCase() + nm.slice(1);
          if (p.other && !mine.length) return esc(nm) + ' — ' + esc(t('wnp_other_' + p.other)) + ' <a href="#' + (smeters(p.other).length ? SK[p.other].nw : SK[p.other].add) + '" data-key="wn-other-' + i + '">' + esc(t(smeters(p.other).length ? 'wnp_other_go_' + p.other : 'wnp_other_add_' + p.other)) + '</a>';
          return esc(nm) + ' — ' + (mine.length ? mine.map(function (m) { var x = WN.src[m.id] || {}; return esc(wname(m).toLowerCase()) + ' <b class="num">' + (x.value !== null && x.value !== undefined ? x.value : esc(x.partial || '?')) + '</b>'; }).join(', ') : esc(t('wnp_none')));
        }).filter(Boolean);
        if (lines.length) h += '<p class="small" data-key="wn-photo-sum">' + lines.join('<br>') + '</p>';
        var gs = ms.filter(function (m) { var x = WN.src[m.id]; return x && x.why !== 'field' && (x.guess || !x.why); });
        var hotG = gs.filter(function (m) { return m.kind === 'hot'; }), coldG = gs.filter(function (m) { return m.kind === 'cold'; });
        if (gs.length) h += '<div class="banner warn" style="margin:8px 0 0" data-key="wn-guess">' + ico('alert', 22) + '<div><p>' + esc(t('wnp_guess')) + '</p>' +
          (hotG.length === 1 && coldG.length === 1 ? '<p><button class="btn sec" data-act="wn-swap" data-a="' + hotG[0].id + '" data-b="' + coldG[0].id + '" data-key="wn-swap">' + esc(t('wnp_swap')) + '</button></p>' : '') + '</div></div>';
      }
    }
    return h + '</div>';
  }
  function wnProg(pct, msg) {
    WN.pct = Math.max(WN.pct || 2, Math.round(pct)); WN.prog = msg;
    var pb = document.getElementById('wn-pbar'), el = document.getElementById('wn-prog');
    if (pb) pb.style.width = WN.pct + '%'; if (el) el.textContent = msg;
  }
  /** Распознать новые фото пачки (движок в браузере) и разложить всё по водомерам. */
  function wnRun(files) {
    wnRead(); WN.err = '';
    files.forEach(function (f) { WN.photos.push({ file: f, url: URL.createObjectURL(f), res: null, meters: [] }); });
    var todo = WN.photos.filter(function (p) { return !p.res; }), n = todo.length; if (!n) return;
    var gen = WN.gen = (WN.gen > 0 ? WN.gen : 0) + 1, w = WN, live = function () { return WN === w && WN.gen === gen; };
    WN.busy = true; WN.pct = 2; WN.prog = t('wn_reading'); render(true);
    // фото не дольше 90 с: зависло — считаем «не прочитано» и идём дальше (кнопка «Зупинити» — сразу)
    var limit = function (pr) { return Promise.race([pr, new Promise(function (ok, bad) { setTimeout(function () { bad(new Error('timeout')); }, 90000); })]); };
    VIS()._engine(function (p) { if (live()) wnProg(p * 15, t('ph_loading', { p: Math.round(p * 100) })); }).then(function () {
      var chain = Promise.resolve();
      todo.forEach(function (p, i) {
        chain = chain.then(function () { if (!live()) return null; wnProg(15 + 85 * (i + 0.3) / n, n > 1 ? t('ph_reading', { i: i + 1, n: n }) : t('wn_reading')); return limit(ocrRead(p.file, { all: true })); })
          .then(function (res) { if (res) { p.res = { lines: res.lines, drums: res.drums }; p.ms = res.ms; } }, function () { p.res = { lines: [], drums: [] }; });
      });
      return chain;
    }).then(function () { if (!live()) return; WN.busy = false; wnAssign(); render(true); wnCheck(true); wnReport(); },
      function () { if (!live()) return; WN.busy = false; WN.err = t('ph_err_engine'); render(true); });
  }
  /** Аналитика (/admin): копии фото воды и что по ним разложилось — у вошедших, как у тепла. */
  function wnReport() {
    if (!VIS().waterReport) return;
    var ms = wmeters();
    VIS().waterReport(WN.photos.filter(function (p) { return p.res && p.file; }).map(function (p) {
      var i = WN.photos.indexOf(p);
      var rd = ms.filter(function (m) { return (p.meters || []).indexOf(m.id) >= 0; }).map(function (m) {
        var x = WN.src[m.id] || {};
        return { field: 'water_' + m.kind, meter: m.id, unit: 'м³', value: x.value === undefined ? null : x.value, frac: x.frac || '', partial: x.partial || null, half: !!x.half, guess: !!x.guess, lead: !!x.lead, why: x.why || '' };
      });
      return { file: p.file, ms: p.ms || 0, res: p.res, photo: { index: i, kind: 'water', meterType: 'water', readings: rd, quality: 'ok', note: rd.length ? '' : 'no_drum' } };
    }));
  }
  /** Раскладка: фото с камеры у поля — за своим водомером; остальные — Wt.assign (№, цвет кольца, близость к прошлым). */
  function wnAssign() {
    var ms = wmeters(), date = WN.date || today(), prev = {}, fixed = {};
    WN.photos.forEach(function (p) { if (p.fixed) fixed[p.fixed] = true; });
    var free = ms.filter(function (m) { return !fixed[m.id]; });
    free.forEach(function (m) { var r = wprevFor(m.id, date); if (r) prev[m.id] = r.vals[m.id]; if (WN.src[m.id] && WN.auto[m.id]) { delete WN.vals[m.id]; } delete WN.src[m.id]; });
    WN.photos.forEach(function (p) { p.meters = p.fixed ? [p.fixed] : []; });
    WN.photos.forEach(function (p) { p.other = p.res ? photoKind(p.res) : null; });
    var A = Wt.assign(WN.photos.map(function (p) { return p.fixed || p.other ? null : p.res; }), free, prev);
    Object.keys(A.by).forEach(function (mid) {
      var x = A.by[mid];
      WN.src[mid] = { photo: x.photo, value: x.value, frac: x.frac || '', partial: x.partial, half: x.half, pair: x.pair, lead: x.lead, why: x.why, guess: x.guess };
      WN.photos[x.photo].meters.push(mid);
      if (x.value !== null && (!WN.vals[mid] || WN.auto[mid])) { WN.vals[mid] = Wt.withFrac(x.value, x.frac); WN.auto[mid] = true; }
    });
    WN.unused = A.unused;
  }
  // світло/газ: «Розпізнати з фото» на сторінці виду — одразу до введення; на введенні — ще фото
  document.addEventListener('change', function (e) {
    var el = e.target; if (!el || (el.id !== 'eq-files' && el.id !== 'en-files') || !el.files || !el.files.length) return;
    var fs = Array.prototype.slice.call(el.files, 0, 8); el.value = '';
    if (el.id === 'eq-files') { var k = el.getAttribute('data-k') === 'gas' ? 'gas' : 'elec'; EN = enFresh(k); go(SK[k].nw); }
    enRun(fs);
  });
  // страница водомера: «Розпізнати з фото» — сразу к вводу, фото читаются и раскладываются по водомерам
  document.addEventListener('change', function (e) {
    var el = e.target; if (!el || el.id !== 'wq-files' || !el.files || !el.files.length) return;
    var fs = Array.prototype.slice.call(el.files, 0, 8), k = el.getAttribute('data-kind') || 'hot'; el.value = '';
    WN = wnFresh(k); go('wnew'); wnRun(fs);
  });
  document.addEventListener('change', function (e) {
    var el = e.target; if (!el || el.id !== 'wn-files' || !el.files) return;
    var fs = Array.prototype.slice.call(el.files, 0, 8); el.value = ''; wnRun(fs);
  });
  document.addEventListener('input', function (e) { var el = e.target; if (el && el.getAttribute && el.getAttribute('data-wn')) WN.auto[el.getAttribute('data-wn')] = false; }, true);

  /** Привітання: 4 табло — тепло (зелений ЖК), вода (циферблат), світло (темний екран), газ (жовта панель) — видно, що
   *  лічильники всі, і кожен впізнається на вигляд. Декор: aria-hidden, підписи — для зрячих. */
  function welcomeHero() {
    var cell = function (k, html, cap) { return '<figure class="whero-c whero-' + k + '">' + html + '<figcaption>' + ico(KINDS[k].icon, 16, KINDS[k].cls) + '<span>' + esc(cap) + '</span></figcaption></figure>'; };
    return '<div class="welcome-lcd whero" aria-hidden="true" data-key="welcome-hero">' + cell('heat', lcd([{ text: '13.245', tag: 'Gcal' }], 'boot'), t('kd_heat')) + cell('hot', wdrum('175.921', 'hot'), t('st_water')) +
      cell('elec', elcd([{ text: '10420' }]), t('kd_elec')) + cell('gas', wdrum('1225.4', 'gas'), t('kd_gas')) + '</div>';
  }
  // ---------- вхід у вікні Telegram (Mini App) ----------
  function tgPending() {
    var y = window.TeploSync, tw = window.Telegram && window.Telegram.WebApp;
    if (!y || !window.TEPLO_API || !tw || !tw.initData) return false;
    return !y.tg || y.tg.state === 'pending';   // ще не почався (перший кадр) або йде
  }
  V.tgwait = function () {
    return { screen: 'S00', route: 'tgwait', bare: true, html: '<div class="welcome tgwait" data-key="tg-wait"><div class="tgw-b" role="status" aria-live="polite">' +
      '<span class="spin" aria-hidden="true"></span><h1>' + esc(t('tg_wait_t')) + '</h1><p class="muted">' + esc(t('tg_wait')) + '</p></div></div>' };
  };
  /** Вхід через Telegram не вдався: чому (людською мовою) і що робити — замість мовчазного «як новому». */
  function tgFailBox() {
    var g = Y().tg; if (!g || g.state !== 'fail' || (Y().mode === 'server' && Y().account)) return '';
    var why = g.err === 'telegram_expired' ? t('tg_fail_old') : g.code === 0 ? t('tg_fail_net') : t('tg_fail_other', { c: g.code });
    return '<div class="banner warn" data-key="tg-fail" role="alert">' + ico('alert', 22) + '<div><p><b>' + esc(t('tg_fail_t')) + '</b></p><p>' + esc(why) + '</p>' +
      '<p class="row-actions"><button type="button" class="btn sec" data-act="tg-retry" data-key="tg-retry">' + esc(t('tg_retry')) + '</button>' +
      '<a href="#login" class="btn ter" data-key="tg-login">' + esc(t('tg_login_mail')) + '</a></p></div></div>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-act="tg-retry"]'); if (!b || !window.TeploSync || !window.TeploSync.retryTg) return;
    e.preventDefault(); window.TeploSync.retryTg(); safeRender();
  });
  // ---------- привітання-лендинг ----------
  /** Темна «сцена» з чотирма сяйвами (тепло, вода, світло, газ — кольори видів), телефон зі спрощеною головною і справжні табло
   *  на різній глибині. Паралакс — CSS scroll-timeline (де нема — JS нижче), нахил за курсором — лише миша; prefers-reduced-motion —
   *  усе статично. Графіка — декор (aria-hidden), зміст — у тексті. par: сяйва рухаються з прокруткою (лише в першому екрані). */
  function lpAuras(par) {
    return '<div class="lp-bg" aria-hidden="true"><span class="lp-grid"></span>' + [['heat', .3], ['water', .18], ['elec', .4], ['gas', .24]].map(function (a) {
      return '<span class="lp-ap' + (par ? ' lp-par' : '') + '" style="--k:' + a[1] + '"><span class="lp-aura a-' + a[0] + '"></span></span>'; }).join('') + '</div>';
  }
  function lpTiles() {
    var tile = function (k, html, cap, kp) {
      return '<div class="lp-tile t-' + k + ' lp-par" style="--k:' + kp + '"><div class="lp-bob"><figure class="whero-c lp-fig">' + html +
        '<figcaption>' + ico(KINDS[k].icon, 16, KINDS[k].cls) + '<span>' + esc(cap) + '</span></figcaption></figure></div></div>';
    };
    return tile('heat', lcd([{ text: '13.245', tag: 'Gcal' }], 'boot'), t('kd_heat'), -.16) + tile('hot', wdrum('175.921', 'hot'), t('st_water'), -.08) +
      tile('elec', elcd([{ text: '10420' }]), t('kd_elec'), -.22) + tile('gas', wdrum('1225.4', 'gas'), t('kd_gas'), -.12);
  }
  function lpPhone() {
    var card = function (k, name, disp, pill, tone) {
      return '<div class="lpp-card"><div class="lpp-h">' + ico(KINDS[k].icon, 13, KINDS[k].cls) + '<b>' + esc(name) + '</b></div>' + disp +
        '<span class="lpp-pill ' + tone + '">' + ico(tone === 'ok' ? 'check' : 'clock', 11) + '<span>' + esc(pill) + '</span></span></div>';
    };
    return '<div class="lp-phone lp-par" style="--k:-.04"><div class="lpp-screen"><span class="lpp-island"></span>' +
      '<div class="lpp-top"><span class="lpp-logo">' + logo() + '</span><span class="lpp-pl"><b>' + esc(t('pl_mine')) + '</b><i>' + esc(t('lp_ph_addr')) + '</i></span></div>' +
      card('heat', t('kd_heat'), '<div class="lpp-lcd"><span>13.245</span><i>Gcal</i></div>', t('lp_ph_due'), 'warn') +
      card('hot', t('kd_hot'), '<div class="lpp-drum"><span>00175</span><span class="r">921</span><i>м³</i></div>', t('lp_ph_sent'), 'ok') +
      card('elec', t('kd_elec'), '<div class="lpp-el"><span>10420</span><i>kWh</i></div>', t('lp_ph_soon'), 'info') +
      '<div class="lpp-nav">' + ['home', 'history', 'chart', 'prefs'].map(function (n, i) { return '<span' + (i ? '' : ' class="on"') + '>' + ico(n, 15) + '</span>'; }).join('') + '</div></div></div>';
  }
  function lpHero(o) {
    return '<section class="lp-hero" data-key="lp-hero">' + lpAuras(true) + '<div class="lp-in"><div class="lp-copy">' +
      (o.badge ? '<p class="lp-badge"><span class="lp-dot" aria-hidden="true"></span>' + esc(o.badge) + '</p>' : '') +
      '<h1 class="lp-h1">' + o.h1 + '</h1><p class="lp-lead">' + esc(o.lead) + '</p><div class="lp-ctas">' + o.cta + '</div>' + (o.after || '') + '</div>' +
      '<div class="lp-stage" aria-hidden="true" data-key="welcome-hero">' + lpPhone() + lpTiles() + '</div></div></section>';
  }
  /** Футер лендинга: о сервисе, документы (политика, соглашение), связь; «независимый сервис». */
  function lpFoot(login) {
    var col = function (h, items) { return '<div class="lpf-col"><h3>' + esc(h) + '</h3><ul>' + items.join('') + '</ul></div>'; };
    var a = function (href, txt, key) { return '<li><a href="' + href + '" data-key="' + key + '">' + esc(txt) + '</a></li>'; };
    var bot = (Y()._cfg && Y()._cfg.botUsername) || '';
    return '<footer class="lp-foot" data-key="lp-foot"><div class="lpf-in">' +
      '<div class="lpf-brand"><div class="lpf-logo">' + logo() + '<b>' + esc(t('brand')) + '</b></div><p>' + esc(t('lf_about')) + '</p></div>' +
      col(t('lf_service'), [a('#start', t('lp_cta'), 'lpf-start')].concat(login ? [a('#login', t('lf_login'), 'lpf-login')] : []).concat([a('#help', t('nav_help'), 'lpf-help')])) +
      col(t('lf_docs'), [a('#privacy', t('lg_privacy'), 'lpf-privacy'), a('#terms', t('lg_terms'), 'lpf-terms')]) +
      col(t('lf_contact'), ['<li><button class="linkbtn" data-act="fb-open" data-key="lpf-fb">' + esc(t('lf_write')) + '</button></li>'].concat(bot ? ['<li><a href="https://t.me/' + esc(bot) + '" target="_blank" rel="noopener" data-key="lpf-bot">' + esc(t('lf_bot')) + '</a></li>'] : [])) +
      '</div><div class="lpf-bot"><span>© ' + new Date().getFullYear() + ' ' + esc(t('brand')) + '</span><span>' + esc(t('lf_indep')) + '</span></div></footer>';
  }
  function lpCta(key, label) { return '<a class="lp-btn" href="#start" data-key="' + key + '"><span>' + esc(label) + '</span>' + ico('arrow', 22) + '</a>'; }
  function lpDest() {
    var ds = [['heat', 'ХТМ'], ['cold', t('lp_d_vk')], ['elec', t('lp_d_obl')], ['gas', t('lp_d_grm')], ['gas', t('lp_d_naf')]];
    return '<section class="lp-sec lp-dest lp-rv" data-key="lp-dest"><p class="lp-dest-t">' + esc(t('lp_dest_t')) + '</p><ul class="lp-chips">' +
      ds.map(function (d) { return '<li>' + ico(KINDS[d[0]].icon, 16, KINDS[d[0]].cls) + '<span>' + esc(d[1]) + '</span></li>'; }).join('') + '</ul></section>';
  }
  function lpSteps() {
    var arts = [
      '<div class="lp-art art-photo"><span class="vf tl"></span><span class="vf tr"></span><span class="vf bl"></span><span class="vf br"></span>' + lcd([{ text: '13.245', tag: 'Gcal' }]) + '<span class="scan"></span></div>',
      '<div class="lp-art art-check"><div class="lpa-field"><span class="lpa-v">13,245</span><span class="lpa-u">Гкал</span><span class="lpa-ok-i">' + ico('check', 18) + '</span></div>' +
        '<p class="lpa-l ok">' + ico('check', 16) + '<span>' + esc(t('lp_s2_ok')) + '</span></p><p class="lpa-l warn">' + ico('alert', 16) + '<span>' + esc(t('lp_s2_warn')) + '</span></p></div>',
      '<div class="lp-art art-send"><div class="lpa-dest">' + ico('send', 18) + '<span><b>' + esc(t('lp_s3_dest')) + '</b><i>' + esc(t('lp_s3_sub')) + '</i></span>' + ico('ext', 16) + '</div>' +
        '<div class="lpa-chip">' + ico('copy', 14) + '<span>' + esc(t('lp_s3_copied')) + '</span></div><div class="lpa-chip ok">' + ico('check', 14) + '<span>' + esc(t('lp_s3_done')) + '</span></div></div>'
    ];
    return '<section class="lp-sec" data-key="lp-steps"><h2 class="lp-h2 lp-rv">' + esc(t('lp_steps_t')) + '</h2><ol class="lp-steps">' + [1, 2, 3].map(function (n) {
      return '<li class="lp-step lp-rv" data-key="lp-step-' + n + '"><div class="lp-art-w" aria-hidden="true">' + arts[n - 1] + '</div><div class="lp-step-tx"><span class="lp-num" aria-hidden="true">' + n + '</span>' +
        '<h3>' + esc(t('lp_s' + n + '_t')) + '</h3><p>' + esc(t('lp_s' + n)) + '</p></div></li>';
    }).join('') + '</ol></section>';
  }
  /** Строки приймання на місяці (1–30): вікно кожного виду і день нагадування (за 4 дні до кінця), лінія «сьогодні». */
  function lpDue() {
    var td = Math.min(30, +String(today()).slice(8, 10) || 1);
    var rows = [['heat', 'kd_heat', 'ХТМ', [[5, 25]], 21], ['cold', 'st_water', t('lp_d_vk_s'), [[1, 20]], 16], ['elec', 'kd_elec', t('lp_d_obl_s'), [[1, 3], [29, 30]], 29], ['gas', 'kd_gas', t('lp_d_grm'), [[1, 5]], 1]];
    var cells = function (ws, bell) { var h = ''; for (var i = 1; i <= 30; i++) h += '<span class="' + (ws.some(function (w) { return i >= w[0] && i <= w[1]; }) ? 'on' : '') + (i === bell ? ' bell' : '') + '"></span>'; return h; };
    return '<div class="lp-due" aria-hidden="true" style="--td:' + td + '">' + rows.map(function (r) {
      return '<span class="lpd-l">' + ico(KINDS[r[0]].icon, 15, KINDS[r[0]].cls) + '<span><b>' + esc(t(r[1])) + '</b><i>' + esc(r[2]) + '</i></span></span><span class="lpd-track k-' + r[0] + '">' + cells(r[3], r[4]) + '</span>';
    }).join('') + '<span></span><span class="lpd-ax">' + [1, 5, 10, 15, 20, 25, 30].map(function (n) { return '<i style="--d:' + n + '">' + n + '</i>'; }).join('') + '</span>' +
      '<span class="lpd-leg"><span class="lpd-bell"></span>' + esc(t('lp_due_bell')) + '</span><span class="lpd-today"><i>' + esc(t('lp_today')) + '</i></span></div>';
  }
  function lpTg() {
    return '<div class="lp-tg" aria-hidden="true"><div class="lpt-head"><span class="lpt-av">' + logo() + '</span><span><b>' + esc(t('brand')) + '</b><i>@' + esc(ourBot()) + '</i></span></div>' +
      '<div class="lpt-msg">' + ico('bell', 15) + '<p>' + esc(t('lp_tg_msg')) + '</p><span class="lpt-time">10:17</span></div><div class="lpt-btn">' + esc(t('lp_tg_btn')) + '</div></div>';
  }
  function lpPlaces() {
    return '<div class="lp-pl" aria-hidden="true">' + [['teal', 1], ['violet', 2], ['amber', 3]].map(function (p) {
      return '<div class="lpl-c" style="--pc:var(--pc-' + p[0] + ');--i:' + (p[1] - 1) + '"><span class="lpl-dot"></span><span><b>' + esc(t('lp_pl' + p[1])) + '</b><i>' + esc(t('lp_pl' + p[1] + 's')) + '</i></span>' + ico('chev', 16) + '</div>';
    }).join('') + '</div>';
  }
  function lpCost() {
    var mon = t('lp_mon').split('|'), m = (+String(today()).slice(5, 7) || 1) - 1, v = [12, 9, 10, 14, 22, 33];
    return '<div class="lp-cost" aria-hidden="true"><div class="lpc-top"><b>≈ 263 грн</b><span>' + esc(t('lp_cost_cap')) + '</span></div><div class="lpc-bars">' + v.map(function (x, i) {
      return '<span class="lpc-b' + (i === v.length - 1 ? ' cur' : '') + '"><span style="--h:' + Math.round(x / 33 * 100) + '%"></span><i>' + esc(mon[(m - v.length + 1 + i + 12) % 12]) + '</i></span>';
    }).join('') + '</div></div>';
  }
  function lpGpv() {
    var off = [[8, 12], [16, 20]], h = '';
    for (var i = 0; i < 24; i++) h += '<span class="' + (off.some(function (o) { return i >= o[0] && i < o[1]; }) ? 'off' : 'on') + '"></span>';
    return '<div class="lp-gpv" aria-hidden="true"><div class="lpg-top"><span class="lpg-q">' + ico('bolt', 14) + esc(t('lp_gpv_q')) + '</span><span class="muted">' + esc(t('lp_gpv_day')) + '</span></div><div class="lpg-bar">' + h + '</div>' +
      '<div class="lpg-ax"><i>00</i><i>06</i><i>12</i><i>18</i><i>24</i></div><div class="lpg-leg"><span class="on"></span>' + esc(t('lp_gpv_on')) + '<span class="off"></span>' + esc(t('lp_gpv_off')) + '</div></div>';
  }
  function lpBento() {
    var cell = function (key, art) { return '<article class="lp-cell c-' + key + ' lp-rv" data-key="lp-' + key + '"><div class="lp-cell-tx"><h3>' + esc(t('lp_' + key + '_t')) + '</h3><p>' + esc(t('lp_' + key)) + '</p></div>' + art + '</article>'; };
    return '<section class="lp-sec" data-key="lp-bento"><h2 class="lp-h2 lp-rv">' + esc(t('lp_bento_t')) + '</h2><div class="lp-bento">' +
      cell('due', lpDue()) + cell('tg', lpTg()) + cell('pl', lpPlaces()) + cell('cost', lpCost()) + cell('gpv', lpGpv()) + '</div></section>';
  }
  V.welcome = function () {
    var acc = Y().mode === 'server' && Y().account;
    if (acc) {   // уже вошёл, но лічильник ещё не выбран (новый аккаунт или стёрли данные) — без рекламы, сразу к делу
      var who = acc.email || (acc.telegram && (acc.telegram.username ? '@' + acc.telegram.username : acc.telegram.name)) || '';
      return { screen: 'S00', bare: true, wide: true, html: '<div class="welcome lp">' + lpHero({ h1: esc(t('wl_title')), lead: t('wl_lead'),
        cta: '<a class="lp-btn" href="#start" data-key="welcome-start"><span>' + esc(t('wl_cta')) + '</span>' + ico('arrow', 22) + '</a>',
        after: '<p class="lp-who">' + esc(t('wl_fine', { who: who })) + ' <button class="linkbtn" data-act="logout">' + esc(t('wl_other')) + '</button></p>' }) + lpFoot(false) + '</div>' };
    }
    var login = Y().mode === 'server' && !Y().account, fine = Y().mode === 'claude' ? t('sync_claude') : Y().mode === 'server' ? t('w_fine_site') : t('w_fine');
    return { screen: 'S00', bare: true, wide: true, html: tgFailBox() + '<div class="welcome lp">' +
      lpHero({ badge: t('lp_badge'), h1: esc(t('lp_h1a')) + ' <span class="lp-grad">' + esc(t('lp_h1b')) + '</span>', lead: t('lp_lead'),
        cta: lpCta('welcome-start', t('lp_cta')) + (login ? '<a class="lp-link" href="#login" data-key="welcome-login">' + esc(t('w_login')) + '</a>' : ''),
        after: '<ul class="lp-trust">' + ['lp_tr1', 'lp_tr2', 'lp_tr3'].map(function (k) { return '<li>' + ico('check', 16) + '<span>' + esc(t(k)) + '</span></li>'; }).join('') + '</ul>' }) +
      lpDest() + lpSteps() + lpBento() +
      '<section class="lp-end lp-rv" data-key="lp-end">' + lpAuras(false) + '<h2>' + esc(t('lp_end_t')) + '</h2><p>' + esc(t('lp_end')) + '</p><div class="lp-ctas">' + lpCta('welcome-start-end', t('lp_cta')) + '</div></section>' +
      '<p class="lp-fine small muted">' + esc(fine) + '</p>' + lpFoot(login) + '</div>' };
  };
  // паралакс там, де нема CSS scroll-timeline (Firefox, старі Safari), і нахил сцени за курсором (лише миша); reduced-motion — нічого
  (function () {
    var mq = window.matchMedia ? function (q) { return window.matchMedia(q).matches; } : function () { return false; };
    var css = window.CSS && CSS.supports && CSS.supports('animation-timeline: scroll()'), tick = false;
    function frame() {
      tick = false; if (mq('(prefers-reduced-motion: reduce)')) return;
      var els = document.querySelectorAll('.lp-hero .lp-par'); if (!els.length) return;
      var y = Math.min(window.pageYOffset || 0, 700);
      for (var i = 0; i < els.length; i++) els[i].style.translate = '0 ' + (y * (parseFloat(els[i].style.getPropertyValue('--k')) || 0)).toFixed(1) + 'px';
    }
    if (!css) window.addEventListener('scroll', function () { if (!tick) { tick = true; requestAnimationFrame(frame); } }, { passive: true });
    if (mq('(hover: hover) and (pointer: fine)')) document.addEventListener('pointermove', function (e) {
      var h = e.target && e.target.closest && e.target.closest('.lp-hero'), st = h && h.querySelector('.lp-stage'); if (!st || mq('(prefers-reduced-motion: reduce)')) return;
      var r = h.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
      st.style.setProperty('--rx', (x * 10).toFixed(2) + 'deg'); st.style.setProperty('--ry', (-y * 7).toFixed(2) + 'deg');
    }, { passive: true });
  })();

  /** «Куди передати» для тепла: лише кабінет ХТМ, 5–25 числа; є перевірені показання — до покрокової передачі. */
  function heatWhere() {
    // тепло квартири постачає не ХТМ (інша громада) — контакти її постачальника з довідника
    var ld = prvOf('heat');
    if (ld && ld.via !== 'htm') return '<section class="panel where" data-key="where-heat"><h2>' + ico('send', 20) + '<span>' + esc(t('wd_title')) + '</span></h2>' + wherePlaceLine() + localDest('heat', ld, '', '', false) + '</section>';
    var ready = RD().filter(function (r) { return r.status === 'checked'; }).slice(-1)[0], w = R.windowState(today());
    var due = w.state === 'closed_before' ? t('wd_heat_from', { d: fmtDate(dayOfMonth(today(), 5)) }) : w.state === 'closed_after' ? t('wd_heat_from', { d: fmtDate(nextMonthDay(today(), 5)) }) : t('wd_due', { d: fmtDate(dayOfMonth(today(), 25)) });
    if (hcOn()) hcLoad();
    var on = hcOn() && hcConn();
    var body = (ready ? '<div class="row-actions" style="margin-top:8px"><a class="btn" href="#handover" data-act="focus" data-id="' + ready.id + '" data-key="where-heat-handover">' + ico(on ? 'send' : 'copy', 18) + '<span>' + esc(t(on ? 'hc_where_ready' : 'wd_heat_ready', { d: fmtDate(ready.htm.date) })) + '</span></a></div>' : '') +
      // кабінет ХТМ: підключено — робот внесе сам; ні — запросити підключити (лише тим, хто увійшов: пароль живе на сервері)
      (on ? '<p class="small" data-key="where-heat-cab-on">' + ico('check', 16) + ' ' + esc(t('hc_where_on')) + ' <a href="#htmcab">' + esc(t('hc_manage_s')) + '</a></p>'
        : hcOn() && HC.st ? '<p class="small" data-key="where-heat-cab-off"><a href="#htmcab">' + esc(t('hc_connect')) + '</a> — ' + esc(t('hc_where_off')) + '</p>' : '');
    return '<section class="panel where" data-key="where-heat"><h2>' + ico('send', 20) + '<span>' + esc(t('wd_title')) + '</span></h2>' +
      destBox({ key: 'htm-heat', org: t('wd_htm_org'), what: t('wd_heat_what'), due: due, dueTone: w.state === 'late' || w.state === 'last_day' ? 'warn' : 'neutral', body: body,
        chans: [[HTM_URL, t('ho_open'), 'ext', 'cab']], more: esc(t('wd_heat_more')) + ' ' + telLink('+380573414140', '(057) 341-41-40') }) + '</section>';
  }
  // ================= кабінет ХТМ: робот вносить показання за людину (сервер, app/htmsvc.php) =================
  // Пароль від кабінету — лише на сервері, зашифрований; тут — стан (підключено, рахунки, внесення й їх перевірка роботом ХТМ).
  // Внесення — лише натисканням «Внести» з повтором суті («Перевірте»). Підсумок перевірки ХТМ приходить із сервера (cron) → запис історії.
  // form — набране у формі підключення (пароль лише в пам'яті сторінки, не в стані й не в localStorage), щоб перемальовка після помилки його не стирала
  var HC = { acc: 0, st: null, at: 0, loading: false, busy: '', err: null, check: null, confirm: null, forget: false, showPass: false, form: null };
  function hcOn() { return !!(window.TEPLO_API && Y().mode === 'server' && Y().account); }
  function hcConn() { return !!(HC.st && HC.st.connected && HC.st.state !== 'bad_login'); }
  function hcLoad(force) {
    if (!hcOn() || HC.loading || (!force && Date.now() - HC.at < 15000)) return;
    HC.loading = true; HC.at = Date.now();
    Y().api('GET', '/cab/htm').then(function (j) {
      HC.loading = false; if (j._status !== 200) return;
      var before = JSON.stringify(HC.st); HC.st = j; var ch = hcApply();
      if (ch) save(); if (ch || before !== JSON.stringify(j)) safeRender();
    }, function () { HC.loading = false; });
  }
  function hcRec(id) { return (S.readings || []).filter(function (x) { return x && !x.deleted && x.id === id; })[0] || null; }
  /** Підсумки внесень → записи історії: прийнято / не прийнято (з порадою, як у ручному «вставте статус»). Позначене людиною вручну не чіпаємо. */
  function hcApply() {
    var ch = false;
    ((HC.st && HC.st.jobs) || []).forEach(function (j) {
      var r = j.rid && hcRec(j.rid); if (!r || !r.cab || r.cab.job !== j.id) return;
      var c = { job: j.id, at: j.at, status: j.status, nextAt: j.nextAt, why: j.why || null, text: String(j.text || '').slice(0, 400) };
      if (j.human) c.human = String(j.human).slice(0, 300);
      if (JSON.stringify(c) !== JSON.stringify(r.cab)) { r.cab = c; r.updatedAt = Date.now(); ch = true; }
      if (r.status !== 'handed') return;
      // автоподача: скасовано або робот не зміг внести — запис знову «перевірено»: виправити чи внести кнопкою
      if (j.status === 'failed' || j.status === 'cancelled') { r.status = 'checked'; delete r.handedAt; r.updatedAt = Date.now(); ch = true; return; }
      if (j.status === 'ok') {
        r.status = 'accepted'; r.result = { at: new Date((j.checkedAt || j.at || Date.now() / 1000) * 1000).toISOString(), via: 'cab' }; r.updatedAt = Date.now(); ch = true;
        var p = place(r.place) || place(); if (p && p.id === S.placeId) S.baseline = Object.assign({}, r.htm); else if (p) { p.baseline = Object.assign({}, r.htm); p.updatedAt = Date.now(); }
      } else if (j.status === 'rejected') {
        var txt = j.text || ('Показання не прийняті з причини: ' + (j.reason || '')), dec = R.decodeRobot(txt);
        r.status = 'rejected'; r.robot = { text: txt, code: dec.code, fix: dec.fix || null, via: 'cab' }; r.updatedAt = Date.now(); ch = true;
      }
    });
    return ch;
  }
  /** Рахунок ХТМ квартири запису: з налаштувань лічильника, якщо він є в кабінеті; один у кабінеті — він. */
  function hcAcc(r) {
    var accs = (HC.st && HC.st.accounts) || [], p = (r && place(r.place)) || place(), m = p && p.id === S.placeId ? S.meter : p && p.meter, my = String((m && m.account) || '').replace(/\D/g, '');
    var hit = accs.filter(function (a) { return a.acc === my; })[0]; if (hit) return hit;
    return accs.length === 1 ? accs[0] : null;
  }
  function hcAutoOn() { return !!(hcConn() && HC.st.auto); }
  function hcHM(sec) { var d = new Date(sec * 1000); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  /** Автоподача: поставити перевірений запис у чергу сервера (робот внесе сам через autoDelay, можна скасувати). */
  function hcQueue(r, acc) {
    var vals = {}; R.FIELDS.forEach(function (f) { vals[f.key] = R.formatForHtm(f.key, r.htm[f.key]); });
    var c = S.contacts || {};
    hcCall('send', '/cab/htm/send', { acc: acc ? acc.acc : '', rid: r.id, place: r.place || S.placeId, vals: vals, phone: c.phone || '', email: c.email || '', delay: true }, function (j) {
      var jb = j.job; if (HC.st) HC.st.jobs = [jb].concat((HC.st.jobs || []).filter(function (x) { return x.id !== jb.id; }));
      r.status = 'handed'; r.handedAt = new Date().toISOString(); r.cab = { job: jb.id, at: jb.at, status: jb.status, nextAt: jb.nextAt, auto: true }; r.updatedAt = Date.now();
      var p = place(r.place) || place(), m = p && p.id === S.placeId ? S.meter : p && p.meter; if (m && !m.account && acc) m.account = acc.acc;
      hcApply(); S.focusId = r.id; save(); toast(jb.status === 'queued' ? t('ha_toast', { at: hcHM(jb.nextAt) }) : t('hc_toast')); go('status');
    });
  }
  /** Перемикач автоподачі на екрані кабінету (окрема згода: вносити без «Так, внести» після фото в бот). */
  function hcAutoBox() {
    var on = !!HC.st.auto, m = Math.round((HC.st.autoDelay || 600) / 60);
    return '<div class="panel ha" data-key="ha-box"><h2>' + ico('camera', 20) + '<span>' + esc(t('ha_t')) + '</span></h2><p class="small">' + esc(t('ha_sub', { m: m })) + '</p>' +
      '<label class="hc-consent"><input type="checkbox" data-act="hc-auto" data-key="ha-toggle"' + (on ? ' checked' : '') + (HC.busy ? ' disabled' : '') + '> <span>' + esc(t('ha_consent', { m: m })) + '</span></label>' +
      (on ? '<p class="small ok-ink" data-key="ha-on">' + ico('check', 16) + ' ' + esc(t('ha_on_hint')) + '</p>' : '') + '</div>';
  }
  function hcErrBox(e) {
    if (!e) return '';
    return '<div class="banner bad" role="alert" data-key="hc-err" data-err="' + esc(e.error || '') + '">' + ico('alert', 22) + '<div><p>' + esc(e.human || t('hc_fail')) + '</p>' +
      (e.site ? '<p class="small muted">' + esc(t('hc_site')) + ' «' + esc(String(e.site).slice(0, 300)) + '»</p>' : '') + '</div></div>';
  }
  /** Вибір рахунку квартири, коли в кабінеті їх кілька (записуємо в налаштування теплолічильника цієї квартири). */
  function hcPickAcc() {
    var accs = (HC.st && HC.st.accounts) || [], cur = hcAcc();
    if (accs.length < 2) return '';
    return '<fieldset class="vkc-pick" data-key="hc-pick"><legend class="small">' + esc(t('hc_pick', { p: placeLabel(place()) })) + '</legend>' + accs.map(function (a) {
      return '<label class="vkc-opt"><input type="radio" name="hc-acc" data-act="hc-acc" value="' + esc(a.acc) + '"' + (cur && cur.acc === a.acc ? ' checked' : '') + '><span class="num">' + esc(a.acc) + '</span> <span class="muted">' + esc(a.sur) + '</span></label>'; }).join('') + '</fieldset>';
  }
  /** Панель на екрані «Передайте в ХТМ»: підключити кабінет / «Внести в кабінет ХТМ» з підтвердженням / вже внесено. */
  function hcPanel(r) {
    var h = '<div class="panel hc" data-key="handover-auto" id="hc-panel"><h2>' + ico('send', 20) + '<span>' + esc(t('hc_auto_t')) + '</span></h2>';
    if (!hcOn()) return h + '<p class="small">' + esc(t('hc_need_login')) + '</p><a class="btn sec" href="#login" data-key="hc-login">' + esc(t('login')) + '</a></div>';
    hcLoad();
    if (!HC.st) return h + '<p class="small muted">' + SPIN + ' ' + esc(t('hc_loading')) + '</p></div>';
    if (!hcConn()) return h + '<p class="small">' + esc(t(HC.st.state === 'bad_login' ? 'hc_relogin' : 'hc_pitch')) + '</p><a class="btn" href="#htmcab" data-key="hc-connect">' + ico('plus', 18) + '<span>' + esc(t('hc_connect')) + '</span></a></div>';
    if (r.cab && (r.cab.status === 'pending' || r.cab.status === 'ok')) return h + '<p class="small">' + esc(t(r.cab.status === 'ok' ? 'hc_done_ok' : 'hc_done_wait')) + '</p><a class="btn sec" href="#status" data-act="focus" data-id="' + esc(r.id) + '" data-key="hc-status">' + esc(t('rec_status')) + '</a></div>';
    var acc = hcAcc(r), c = S.contacts || {};
    h += '<p class="small">' + esc(t('hc_ready', { e: HC.st.login })) + '</p>';
    if (!acc) return h + hcPickAcc() + '</div>';
    if (HC.confirm === r.id) {
      h += '<div class="vkc-sum" data-key="hc-confirm" role="group" aria-label="' + esc(t('hc_check_t')) + '"><p class="small"><b>' + esc(t('hc_check_t')) + '</b></p><ul class="small">' +
        '<li>' + esc(t('hc_c_place', { p: placeLabel(place(r.place) || place()) })) + '</li><li>' + esc(t('hc_c_acc', { a: acc.acc, s: acc.sur })) + '</li>' +
        '<li>' + esc(t('hc_c_vals', { d: R.formatForHtm('date', r.htm.date), e: R.formatForHtm('energy', r.htm.energy) })) + '</li>' +
        '<li>' + esc(t('hc_c_contact', { p: c.phone || (HC.st.phone || '—'), m: c.email || HC.st.login })) + '</li></ul>' + hcErrBox(HC.err) +
        '<div class="row-actions"><button class="btn" data-act="hc-send" data-id="' + esc(r.id) + '" data-key="hc-send"' + (HC.busy ? ' disabled' : '') + '>' +
        (HC.busy === 'send' ? SPIN + '<span>' + esc(t('hc_sending')) + '</span>' : ico('send', 18) + '<span>' + esc(t('hc_send_yes')) + '</span>') + '</button>' +
        '<button class="btn sec" data-act="hc-cancel" data-key="hc-cancel"' + (HC.busy ? ' disabled' : '') + '>' + esc(t('cancel')) + '</button></div></div>';
    } else {
      h += hcErrBox(HC.err) + (!(c.phone || HC.st.phone) ? '<p class="small warn-ink" data-key="hc-nophone">' + ico('alert', 16) + ' ' + esc(t('hc_nophone')) + ' <a href="#prefs">' + esc(t('nav_prefs')) + '</a></p>' : '') +
        '<button class="btn big block" data-act="hc-ask" data-id="' + esc(r.id) + '" data-key="hc-ask">' + ico('send', 22) + '<span>' + esc(t('hc_send')) + '</span></button>';
    }
    return h + '<p class="small muted" style="margin-top:8px"><a href="#htmcab" data-key="hc-manage">' + esc(t('hc_manage')) + '</a></p></div>';
  }
  /** На «Статусі»: внесено роботом — чекаємо перевірки ХТМ; сервер сам перечитує журнал і пише в Telegram. */
  function hcWait(r) {
    hcLoad();
    var c = r.cab || {}, tg = Y().account && Y().account.telegram, at = c.nextAt ? new Date(c.nextAt * 1000) : null;
    if (c.status === 'queued' || c.status === 'sending') return '<div class="banner" data-key="status-cab-queued">' + ico('clock', 22) + '<div><p><b>' + esc(t(c.status === 'sending' ? 'ha_sending' : 'ha_q_t', { at: c.nextAt ? hcHM(c.nextAt) : '…' })) + '</b></p><p>' + esc(t('ha_q_sub')) + '</p>' +
      (c.status === 'queued' ? '<div class="row-actions" style="margin-top:8px"><button class="btn" data-act="hc-now" data-id="' + esc(String(c.job)) + '" data-key="status-cab-now"' + (HC.busy ? ' disabled' : '') + '>' + (HC.busy === 'now' ? SPIN + '<span>' + esc(t('hc_sending')) + '</span>' : ico('send', 18) + '<span>' + esc(t('ha_now')) + '</span>') + '</button>' +
        '<button class="btn sec" data-act="hc-unqueue" data-id="' + esc(String(c.job)) + '" data-key="status-cab-cancel"' + (HC.busy ? ' disabled' : '') + '>' + esc(t('ha_cancel')) + '</button></div>' : '') + hcErrBox(HC.err) + '</div></div>';
    if (c.status === 'unknown') return '<div class="banner warn" data-key="status-cab-unknown">' + ico('clock', 22) + '<div><p><b>' + esc(t(c.why === 'relogin' ? 'hc_u_relogin' : c.why === 'forgot' ? 'hc_u_forgot' : 'hc_u_slow')) + '</b></p><p>' + esc(t('hc_u_self')) + '</p></div></div>';
    return '<div class="banner" data-key="status-cab-wait">' + ico('clock', 22) + '<div><p><b>' + esc(t('hc_w_t')) + '</b></p><p>' + esc(t('hc_w_ago', { ago: ago(r.handedAt) })) + '</p>' +
      '<p>' + esc(t(tg ? 'hc_w_tg' : 'hc_w_here', { at: at ? ('0' + at.getHours()).slice(-2) + ':' + ('0' + at.getMinutes()).slice(-2) : '…' })) + '</p>' +
      '<p><button class="linkbtn" data-act="hc-refresh" data-key="status-cab-refresh">' + (HC.loading ? SPIN + ' ' : '') + esc(t('hc_refresh')) + '</button></p></div></div>';
  }
  function hcJobPill(j) { var k = { ok: 'ok', rejected: 'bad', pending: 'neutral', unknown: 'warn', queued: 'neutral', sending: 'neutral', failed: 'bad', cancelled: 'neutral' }[j.status] || 'neutral'; return '<span class="pill ' + k + '">' + esc(t('hc_j_' + j.status)) + '</span>'; }
  /** Що бачить кабінет (POST /cab/htm/check): прилад, останні прийняті, прийом показань, журнал, форма. */
  function hcCheckBox(c) {
    if (!c) return '';
    var b = c.base || {}, rows = [];
    if (c.meter) rows.push([t('hc_k_meter'), c.meter.model + ' № ' + c.meter.serial]);
    if (b.date) rows.push([t('hc_k_last'), b.date + ' · ' + (b.energy || '—') + ' Гкал']);
    rows.push([t('hc_k_open'), c.open ? t('hc_open_yes', { a: c.min || '', b: c.max || '' }) : (c.closed || t('hc_open_no'))]);
    var jr = (c.journal || []).slice(0, 4).map(function (x) { return '<li>' + esc(x.date) + ' · <span class="num">' + esc(x.energy) + '</span> ' + hcJobPill({ status: x.status === 'ok' ? 'ok' : x.status === 'rejected' ? 'rejected' : 'pending' }) + (x.reason ? '<div class="small muted">' + esc(x.reason) + '</div>' : '') + '</li>'; }).join('');
    var form = c.form || {};
    return '<div class="panel" data-key="hc-check"><h3>' + esc(t('hc_seen')) + '</h3><dl class="hc-kv">' + rows.map(function (x) { return '<dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd>'; }).join('') + '</dl>' +
      (jr ? '<p class="small" style="margin-top:12px"><b>' + esc(t('hc_k_journal')) + '</b></p><ul class="list small hc-jr">' + jr + '</ul>' : '') +
      (form.open ? '<p class="small ' + (form.match ? '' : 'warn-ink') + '" data-key="hc-form" data-match="' + (form.match ? 1 : 0) + '">' + ico(form.match ? 'check' : 'alert', 16) + ' ' + esc(t(form.match ? 'hc_form_ok' : 'hc_form_bad')) + '</p>' : '') + '</div>';
  }
  V.htmcab = function () {
    var h = '<div class="wiz-top"><a class="btn ghost" href="#heat">' + ico('back', 20) + '<span>' + esc(t('back')) + '</span></a></div><h1>' + esc(t('hc_title')) + '</h1>';
    if (!hcOn()) return { screen: 'S07c', route: 'htmcab', bare: true, closeTo: 'heat', html: h + '<p>' + esc(t('hc_pitch')) + '</p><p>' + esc(t('hc_need_login')) + '</p><a class="btn" href="#login">' + esc(t('login')) + '</a>' };
    hcLoad();
    if (!HC.st) return { screen: 'S07c', route: 'htmcab', bare: true, closeTo: 'heat', html: h + '<p class="muted">' + SPIN + ' ' + esc(t('hc_loading')) + '</p>' };
    if (!hcConn()) {
      var c = S.contacts || {}, fm = HC.form || {};
      h += (HC.st.state === 'bad_login' ? '<div class="banner warn">' + ico('alert', 22) + '<div><p>' + esc(t('hc_relogin')) + '</p></div></div>' : '') +
        '<p>' + esc(t('hc_lead')) + '</p><ul class="small hc-how"><li>' + esc(t('hc_how1')) + '</li><li>' + esc(t('hc_how2')) + '</li><li>' + esc(t('hc_how3')) + '</li></ul>' +
        '<form id="hc-form" class="panel" novalidate data-key="hc-form-connect">' +
        '<div class="field"><label for="hc-email">' + esc(t('hc_email')) + '</label><div class="ctl"><input id="hc-email" type="email" inputmode="email" autocomplete="username" spellcheck="false" value="' + esc(fm.email !== undefined ? fm.email : HC.st.login || c.email || '') + '"></div><div class="help">' + esc(t('hc_email_h')) + '</div></div>' +
        '<div class="field"><label for="hc-pass">' + esc(t('hc_pass')) + '</label><div class="ctl"><input id="hc-pass" type="' + (HC.showPass ? 'text' : 'password') + '" autocomplete="current-password" spellcheck="false" value="' + esc(fm.pass || '') + '"></div>' +
        '<label class="hc-show small"><input type="checkbox" data-act="hc-show"' + (HC.showPass ? ' checked' : '') + '> ' + esc(t('hc_show')) + '</label></div>' +
        '<div class="field"><label for="hc-phone">' + esc(t('hc_phone')) + '</label><div class="ctl"><input id="hc-phone" type="tel" inputmode="tel" autocomplete="tel" value="' + esc(fm.phone !== undefined ? fm.phone : c.phone || HC.st.phone || '') + '"></div><div class="help">' + esc(t('hc_phone_h')) + '</div></div>' +
        '<label class="hc-consent"><input type="checkbox" id="hc-consent"' + (fm.consent ? ' checked' : '') + '> <span>' + esc(t('hc_consent')) + '</span></label>' +
        '<p class="small muted">' + esc(t('hc_indep')) + ' <a href="#privacy">' + esc(t('hc_privacy')) + '</a></p>' + hcErrBox(HC.err) +
        '<div class="row-actions"><button type="submit" class="btn big" data-key="hc-connect-go"' + (HC.busy ? ' disabled' : '') + '>' + (HC.busy === 'connect' ? SPIN + '<span>' + esc(t('hc_connecting')) + '</span>' : esc(t('hc_connect_go'))) + '</button></div></form>';
      return { screen: 'S07c', route: 'htmcab', bare: true, closeTo: 'heat', html: h };
    }
    var st = HC.st, accs = st.accounts || [], acc = hcAcc();
    h += '<div class="verdict ok" data-key="hc-connected">' + levelIco('ok', 28) + '<span>' + esc(t('hc_on')) + '</span></div>' +
      '<p>' + esc(t('hc_on_sub', { e: st.login })) + '</p>' +
      (accs.length === 1 ? '<p class="small">' + esc(t('hc_acc1', { a: accs[0].acc, s: accs[0].sur })) + '</p>' : hcPickAcc()) +
      (acc && S.meter && String(S.meter.account || '').replace(/\D/g, '') !== acc.acc && accs.length === 1 && S.meter.account ? '<p class="small warn-ink">' + ico('alert', 16) + ' ' + esc(t('hc_acc_diff', { a: S.meter.account })) + '</p>' : '') +
      hcErrBox(HC.err) + hcCheckBox(HC.check) +
      '<div class="row-actions"><button class="btn' + (HC.check ? ' sec' : '') + '" data-act="hc-check" data-key="hc-check-go"' + (HC.busy ? ' disabled' : '') + '>' + (HC.busy === 'check' ? SPIN + '<span>' + esc(t('hc_checking')) + '</span>' : esc(t('hc_check'))) + '</button></div>' + hcAutoBox();
    var jobs = (st.jobs || []).slice(0, 6);
    if (jobs.length) h += '<h2 class="section-title">' + esc(t('hc_jobs')) + '</h2><ul class="list hc-jobs" data-key="hc-jobs">' + jobs.map(function (j) {
      return '<li><div><b>' + esc(j.date) + '</b> · <span class="num">' + esc(j.energy) + '</span> Гкал <span class="muted small">' + esc(t('hc_c_acc_s', { a: j.acc })) + '</span>' + (j.reason || j.human ? '<div class="small muted">' + esc(j.reason || j.human) + '</div>' : '') + '</div>' + hcJobPill(j) + '</li>'; }).join('') + '</ul>';
    h += '<div class="panel" style="margin-top:24px" data-key="hc-forget-box"><p class="small">' + esc(t('hc_forget_sub')) + '</p>' +
      (HC.forget ? '<div class="banner warn">' + ico('alert', 22) + '<div><p>' + esc(t('hc_forget_q')) + '</p><div class="row-actions" style="margin-top:8px"><button class="btn sec" data-act="hc-forget-no">' + esc(t('cancel')) + '</button><button class="btn danger solid" data-act="hc-forget-yes" data-key="hc-forget-yes"' + (HC.busy ? ' disabled' : '') + '>' + esc(t('hc_forget')) + '</button></div></div></div>'
        : '<button class="btn danger" data-act="hc-forget" data-key="hc-forget">' + esc(t('hc_forget')) + '</button>') + '</div>';
    return { screen: 'S07c', route: 'htmcab', bare: true, closeTo: 'heat', html: h };
  };
  function hcCall(kind, path, body, ok) {
    HC.busy = kind; HC.err = null; safeRender();
    Y().api('POST', path, Object.assign({ lang: S.lang }, body)).then(function (j) {
      HC.busy = '';
      if (j._status === 200) ok(j); else {
        HC.err = { error: j.error, human: j.human || (j.error === 'rate_limited' ? t('hc_busy') : t('hc_fail')), site: j.site, field: j.field }; if (j.accounts && HC.st) HC.st.accounts = j.accounts;
        if (j.error === 'cab_bad_login' && HC.form) HC.form.pass = '';   // невірний пароль — набрати заново, як на будь-якому вході
        if (j.error === 'cab_relogin') HC.at = 0;
        if (j.job && HC.st) { HC.st.jobs = [j.job].concat((HC.st.jobs || []).filter(function (x) { return x.id !== j.job.id; })); if (hcApply()) save(); }
      }
      render(true);
    }, function () { HC.busy = ''; HC.err = { error: 'net', human: t('hc_fail') }; render(true); });
  }
  function hcSend(id) {
    var r = hcRec(id), acc = r && hcAcc(r); if (!r || !acc || HC.busy) return;
    var vals = {}; R.FIELDS.forEach(function (f) { vals[f.key] = R.formatForHtm(f.key, r.htm[f.key]); });
    var c = S.contacts || {};
    hcCall('send', '/cab/htm/send', { acc: acc.acc, rid: r.id, place: r.place || S.placeId, vals: vals, phone: c.phone || '', email: c.email || '' }, function (j) {
      HC.confirm = null; var jb = j.job;
      if (HC.st) HC.st.jobs = [jb].concat((HC.st.jobs || []).filter(function (x) { return x.id !== jb.id; }));
      if (r.status !== 'handed' && r.status !== 'accepted') { r.status = 'handed'; r.handedAt = new Date().toISOString(); }
      r.cab = { job: jb.id, at: jb.at, status: 'pending' }; r.updatedAt = Date.now();
      // рахунок, яким внесли, — у налаштування теплолічильника квартири (наступного разу без вибору)
      var p = place(r.place) || place(), m = p && p.id === S.placeId ? S.meter : p && p.meter; if (m && !m.account) m.account = acc.acc;
      hcApply(); S.focusId = r.id; save(); toast(t(jb.status === 'ok' ? 'hc_toast_ok' : 'hc_toast')); go('status');
    });
  }
  setInterval(function () {
    if (document.visibilityState === 'visible' && hcOn() && (S.readings || []).some(function (r) { return r && !r.deleted && r.status === 'handed' && r.cab && /^(pending|queued|sending)$/.test(r.cab.status); })) hcLoad(true);
  }, 60000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && /^(heat|handover|status|htmcab|history)$/.test(routeName())) hcLoad(true); });
  document.addEventListener('submit', function (e) {
    if (!e.target || e.target.id !== 'hc-form') return; e.preventDefault(); if (HC.busy) return;
    var v = function (id) { var x = document.getElementById(id); return x ? x.value.trim() : ''; };
    var cons = document.getElementById('hc-consent'), email = v('hc-email'), pass = (document.getElementById('hc-pass') || {}).value || '', phone = v('hc-phone');
    HC.form = { email: email, pass: pass, phone: phone, consent: !!(cons && cons.checked) };
    if (!email || !pass) { HC.err = { human: t(!email ? 'hc_e_email' : 'hc_e_pass') }; render(true); return; }
    if (!cons || !cons.checked) { HC.err = { error: 'cab_consent', human: t('hc_e_consent') }; render(true); return; }
    if (phone && !(S.contacts || {}).phone) { S.contacts = Object.assign({}, S.contacts || {}, { phone: phone }); save(); }
    hcCall('connect', '/cab/htm/connect', { email: email, password: pass, phone: phone, consent: true }, function (j) {
      HC.st = j; HC.at = Date.now(); HC.showPass = false; HC.check = null; HC.form = null; toast(t('hc_on'));
      // з екрана «Передайте» прийшли — туди й повертаємось
      if (S.focusId && hcRec(S.focusId) && hcRec(S.focusId).status === 'checked') { go('handover'); return; }
      hcCall('check', '/cab/htm/check', { acc: (hcAcc() || {}).acc || '' }, function (c) { HC.check = c; });
    });
  });
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-act^="hc-"]'); if (!el) return;
    var a = el.getAttribute('data-act');
    if (a === 'hc-show') { var pw = document.getElementById('hc-pass'); HC.showPass = el.checked; if (pw) pw.type = el.checked ? 'text' : 'password'; return; }
    if (a === 'hc-acc') { if (S.meter) { S.meter.account = el.value; save(); } HC.err = null; render(true); return; }
    if (a === 'hc-auto') { var want = !!el.checked; hcCall('auto', '/cab/htm/auto', { on: want }, function (j) { HC.st = j; HC.at = Date.now(); if (hcApply()) save(); toast(t(want ? 'ha_on' : 'ha_off')); }); return; }
    e.preventDefault();
    if (a === 'hc-ask') { HC.confirm = el.getAttribute('data-id'); HC.err = null; render(true); var cf = document.querySelector('[data-key="hc-confirm"]'); if (cf && cf.scrollIntoView) cf.scrollIntoView({ block: 'center' }); }
    else if (a === 'hc-cancel') { HC.confirm = null; HC.err = null; render(true); }
    else if (a === 'hc-send') hcSend(el.getAttribute('data-id'));
    else if (a === 'hc-refresh') { hcLoad(true); render(true); }
    else if (a === 'hc-check') hcCall('check', '/cab/htm/check', { acc: (hcAcc() || {}).acc || '' }, function (c) { HC.check = c; hcLoad(true); });
    else if (a === 'hc-forget') { HC.forget = true; render(true); }
    else if (a === 'hc-now' || a === 'hc-unqueue') hcCall(a === 'hc-now' ? 'now' : 'unqueue', a === 'hc-now' ? '/cab/htm/now' : '/cab/htm/cancel', { job: +el.getAttribute('data-id') }, function (j) {
      var jb = j.job; if (HC.st) HC.st.jobs = [jb].concat((HC.st.jobs || []).filter(function (x) { return x.id !== jb.id; }));
      if (hcApply()) save(); toast(t(a === 'hc-now' ? (jb.status === 'failed' ? 'ha_failed_t' : 'hc_toast') : 'ha_cancelled_toast')); render(true);
    });
    else if (a === 'hc-forget-no') { HC.forget = false; render(true); }
    else if (a === 'hc-forget-yes') hcCall('forget', '/cab/forget', { prov: 'htm' }, function (j) { HC.st = j; HC.forget = false; HC.check = null; hcApply(); save(); toast(t('hc_forgot')); });
  });

  V.heat = function () {
    var m = model(), html = '<h1 class="sr">' + esc(t('uc_heat')) + (place() && place().name ? ' — ' + esc(place().name) : '') + '</h1>' + (openGap('heat') ? gapBanner('heat') : windowBanner());
    var handed = RD().filter(function (r) { return r.status === 'handed'; }).slice(-1)[0];
    if (handed) {
      html += '<div class="banner" data-key="home-waiting">' + ico('clock', 22) + '<div><p><b>' + esc(t('h_waiting')) + '</b></p><p>' + esc(t('h_waiting_sub', { ago: ago(handed.handedAt) })) + '</p>' +
        '<p><a href="#status" data-act="focus" data-id="' + handed.id + '">' + esc(t('h_check_result')) + '</a></p></div></div>';
    }
    loadInbox();
    if (INBOX.items && INBOX.items.length) html += '<div class="banner" data-key="home-inbox">' + ico('camera', 22) + '<div><p><b>' + esc(t('ib_title', { n: INBOX.items.length })) + '</b></p><p>' + esc(t('ib_sub')) + '</p><p><button class="btn" data-act="inbox-run" data-key="home-inbox-run">' + esc(t('ib_run')) + '</button></p></div></div>';
    // экран с последними принятыми — главный визуальный якорь
    var bs = lastAccepted(), newer = RD().filter(function (x) { return x.htm && x.htm.date && (!bs || x.htm.date > bs.date); }).sort(function (a, b) { return a.htm.date < b.htm.date ? -1 : 1; }).slice(-1)[0];
    // під назвою виду — модель; рахунок і № — лише в налаштуваннях і в «Куди передати» (владелец 05.11 20:45: «з лічильників прибрати номери рахунків»)
    var left = mbox({ key: bs ? 'home-last' : 'home-last-none', id: 'heat', kind: 'heat', icon: 'thermo', cls: 'c-heat', name: t('uc_heat'),
      sub: [modelName(m), energyUnit() !== 'Gcal' ? unitLbl(energyUnit()) : ''],
      display: lcd([{ text: bs ? R.formatForHtm('energy', bs.energy) : '------', tag: 'Gcal', label: bs ? R.formatForHtm('energy', bs.energy) + ' Гкал' : '—' }], 'hero'),
      copy: bs && R.num(bs.energy) !== null ? R.formatForHtm('energy', bs.energy) : '',
      cap: bs ? t('h_last_d', { d: fmtDate(bs.date, true) }) : t('h_last_none'),
      body: (newer ? '<p class="small muted mb-newer">' + esc(t(newer.own ? 'mb_newer_own' : 'mb_newer_heat', { d: fmtDate(newer.htm.date, true), s: t('status_' + newer.status).toLowerCase() })) + '</p>' : '') +
        (bs ? '' : '<p class="small muted">' + esc(t('h_last_none_sub')) + '</p><p><a class="btn sec" href="#baseline" data-key="home-add-base">' + esc(t('h_add_base')) + '</a></p>'),
      meta: S.meter && S.meter.verifiedUntil ? [esc(t('pl_ver', { d: R.toHtmDate(S.meter.verifiedUntil) }))] : [],
      set: heatMeterFields(m) + priceBlock('heat') + gapSetLink('heat') , setTitle: t('mb_set_read') });
    var right = '';
    var n = steps().length;
    if (S.draft && (Object.keys(S.draft.values || {}).length || S.draft.step > 0)) {
      right += '<a class="btn big block" href="#step-' + (S.draft.step || 0) + '" data-key="home-continue">' + esc(t('h_continue', { i: (S.draft.step || 0) + 1, n: n })) + '</a>' +
        '<button class="linkbtn" style="margin-top:8px" data-act="restart" data-key="home-restart">' + esc(t('h_read')) + ' — ' + (S.lang === 'ru' ? 'заново' : 'спочатку') + '</button>';
    } else {
      right += '<button class="btn big block" data-act="read" data-key="home-read">' + esc(t('h_read')) + '</button>';
      if (VIS().available) right += '<button class="btn sec block" style="margin-top:12px" data-act="photo" data-mode="reading" data-key="home-photo">' + ico('camera', 22) + '<span>' + esc(t('ph_entry')) + '</span></button>';
    }
    right += whereAcc(heatWhere());
    var recent = heatMixed(3);
    if (recent.length) right += '<h2 class="section-title">' + esc(t('h_recent')) + '</h2>' + readingList(recent) + (RD().length + gaps('heat').length > 3 ? '<p><button class="btn sec" data-act="view-go" data-v="heat" data-to="history">' + esc(t('wh_all', { n: RD().length + gaps('heat').length })) + '</button></p>' : '');
    if (Y().mode === 'server' && !Y().account && RD().length && !S.syncPromptDismissed) {
      html = '<div class="banner" data-key="home-save-prompt">' + ico('info', 22) + '<div><p><b>' + esc(t('save_prompt')) + '</b></p><p><a href="#login">' + esc(t('login')) + '</a> &nbsp; <button class="linkbtn" data-act="dismiss-sync">' + esc(t('save_prompt_later')) + '</button></p></div></div>' + html;
    }
    html += '<div class="hero-grid"><div>' + left + '</div><div>' + right + '</div></div>';
    return { screen: 'S01h', route: 'heat', html: html };
  };

  var GAP_PRESET = null;
  /** Форма «лічильник знімали»: новий період (what — 'heat' або id водоміра) чи правка наявного. */
  function gapView(id, newWhat) {
    var g = id ? gapById(id) : null;
    if (id && !g) return { screen: 'S31', route: 'history', html: '<h1>' + esc(t('gp_title')) + '</h1><p class="muted">' + esc(t('rec_gone')) + '</p><a class="btn" href="#home">' + esc(t('back')) + '</a>' };
    // «Замінити» со страницы квартиры — сразу «заміна, новий лічильник»
    var pre = !id && GAP_PRESET && GAP_PRESET.what === newWhat ? GAP_PRESET : null;
    g = g || { what: newWhat || 'heat', from: pre ? today() : '', to: '', reason: pre ? 'replace' : 'repair', vFrom: '', vTo: '', fresh: !!pre, pay: '', amount: '', note: '' };
    var kind = gapKind(g) || 'heat', back = kind === 'heat' ? 'heat' : 'water-' + kind, unit = gapUnit(g), heat = g.what === 'heat';
    var opts = (hasHeat() ? [['heat', t('uc_heat')]] : []).concat(wmeters().map(function (m) { return [m.id, wname(m) + (m.serial ? ' · № ' + m.serial : '')]; }));
    var sel = '<div class="field"><label for="gp-what">' + esc(t('gp_what')) + '</label><div class="ctl"><select id="gp-what" data-gp="what"' + (id ? ' disabled' : '') + '>' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === g.what ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div></div>';
    var reasons = ['repair', 'verify', 'replace', 'other'].map(function (r) { return '<label><input type="radio" name="gp-reason" value="' + r + '"' + ((g.reason || 'repair') === r ? ' checked' : '') + '>' + esc(t('gp_r_' + r)) + '</label>'; }).join('');
    var num = function (k, lbl, v) { return '<div class="field"><label for="gp-' + k + '">' + esc(lbl) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></label><div class="ctl"><input id="gp-' + k + '" class="num" inputmode="decimal" autocomplete="off" data-gp="' + k + '" value="' + esc(v == null ? '' : String(v)) + '"><span class="unit">' + esc(unit) + '</span></div></div>'; };
    var pays = (heat ? ['area', 'avg', 'unknown'] : ['norm', 'avg', 'unknown']).map(function (k) { return '<option value="' + k + '"' + ((g.pay || gapPayDefault(g)) === k ? ' selected' : '') + '>' + esc(t('gp_po_' + k + (heat ? '_h' : '_w'))) + '</option>'; }).join('');
    var m = heat ? null : (wcfg().meters || []).filter(function (x) { return x.id === g.what; })[0];
    var html = '<p><a href="#' + back + '">← ' + esc(heat ? t('uc_heat') : wkindTitle(kind)) + '</a></p><h1>' + esc(id ? t('gp_title_edit') : t('gp_title')) + '</h1><p class="muted">' + esc(t(heat ? 'gp_lead_h' : 'gp_lead_w')) + '</p>' +
      '<form id="gap-form" data-id="' + esc(id || '') + '" novalidate><div class="panel">' + sel +
      '<fieldset class="field"><legend class="lbl">' + esc(t('gp_reason')) + '</legend><div class="choice">' + reasons + '</div></fieldset>' +
      '<h2 class="section-title">' + esc(t('gp_off_t')) + '</h2><div class="grid2"><div class="field"><label for="gp-from">' + esc(t('gp_from')) + '</label><div class="ctl"><input id="gp-from" type="date" data-gp="from" max="' + today() + '" value="' + esc(g.from || '') + '" required></div></div>' +
        num('vFrom', t('gp_vfrom'), g.vFrom) + '</div>' +
      '<h2 class="section-title">' + esc(t('gp_on_t')) + '</h2><p class="small muted">' + esc(t('gp_on_sub')) + '</p><div class="grid2"><div class="field"><label for="gp-to">' + esc(t('gp_to')) + '</label><div class="ctl"><input id="gp-to" type="date" data-gp="to" value="' + esc(g.to || '') + '"></div></div>' +
        num('vTo', t('gp_vto'), g.vTo) + '</div>' +
      '<label class="check-row"><input type="checkbox" id="gp-fresh"' + (g.fresh ? ' checked' : '') + '><span><b>' + esc(t('gp_fresh')) + '</b><br><span class="small muted">' + esc(t(heat ? 'gp_fresh_h' : 'gp_fresh_w')) + '</span></span></label>' +
      (m ? '<div class="grid2" id="gp-newmeter"' + (g.fresh ? '' : ' hidden') + '><div class="field"><label for="gp-serial">' + esc(t('gp_serial')) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></label><div class="ctl"><input id="gp-serial" class="num" autocomplete="off" value="' + esc(g.serial || '') + '"></div></div>' +
        '<div class="field"><label for="gp-ver">' + esc(t('mv_date')) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></label><div class="ctl"><input id="gp-ver" type="date" value="' + esc(g.verifiedUntil || '') + '"></div></div></div>' : '') +
      (heat ? '<p class="small muted" id="gp-heat-note"' + (g.fresh ? '' : ' hidden') + '>' + esc(t('gp_fresh_h_note')) + ' <a href="#meter">' + esc(t('gp_model')) + '</a></p>' : '') +
      '<h2 class="section-title">' + esc(t('gp_pay_t')) + '</h2><div class="grid2"><div class="field"><label for="gp-pay">' + esc(t('gp_pay')) + '</label><div class="ctl"><select id="gp-pay" data-gp="pay"' + (g.pay ? ' data-touched="1"' : '') + '>' + pays + '</select></div></div>' +
        '<div class="field"><label for="gp-amount">' + esc(t('gp_amount')) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></label><div class="ctl"><input id="gp-amount" class="num" inputmode="decimal" autocomplete="off" data-gp="amount" value="' + esc(g.amount == null ? '' : String(g.amount)) + '"><span class="unit">грн</span></div></div></div>' +
      '<div class="field"><label for="gp-note">' + esc(t('gp_note')) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></label><div class="ctl"><input id="gp-note" maxlength="300" data-gp="note" value="' + esc(g.note || '') + '" placeholder="' + esc(t('gp_note_ph')) + '"></div></div>' +
      '<div class="help block" id="gp-err" role="alert"></div></div>' + gapEstBox(g) +
      '<div class="row-actions"><a class="btn sec" href="#' + back + '">' + esc(t('cancel')) + '</a>' + (id ? '<button type="button" class="btn danger" data-act="gap-del" data-id="' + esc(id) + '" data-key="gap-del">' + esc(t('rec_del')) + '</button>' : '') + '<button type="submit" class="btn" data-key="gap-save">' + esc(t('save')) + '</button></div></form>' + (id ? billsBox('g:' + id, g.bills, t('bl_title_gap')) : '');
    return { screen: 'S31', route: back, html: html };
  }
  /** Сохранить форму периода без лічильника. */
  function gapFromForm(form) {
    var id = form.getAttribute('data-id'), val = function (k) { var el = document.getElementById('gp-' + k); return el ? String(el.value || '').trim() : ''; };
    var reason = (document.querySelector('input[name="gp-reason"]:checked') || {}).value || 'repair';
    return { id: id || ('g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)), what: id ? (gapById(id) || {}).what : val('what'), from: val('from'), to: val('to'), reason: reason,
      vFrom: val('vFrom').replace(',', '.'), vTo: val('vTo').replace(',', '.'), fresh: !!(document.getElementById('gp-fresh') || {}).checked, pay: val('pay'), amount: val('amount').replace(',', '.').replace(/\s/g, ''), note: val('note'),
      serial: val('serial'), verifiedUntil: val('ver'), updatedAt: Date.now() };
  }
  function gapSave(form) {
    var val = function (k) { var el = document.getElementById('gp-' + k); return el ? String(el.value || '').trim() : ''; }, g = gapFromForm(form);
    var err = '', heat = g.what === 'heat';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.from)) err = t('gp_e_from');
    else if (g.from > today()) err = t('gp_e_future');
    else if (g.to && g.to < g.from) err = t('gp_e_order');
    else if ([g.vFrom, g.vTo, g.amount].some(function (v) { return v !== '' && (R.num(v) === null || R.num(v) < 0); })) err = t('gp_e_num');
    else if (!g.fresh && g.vFrom !== '' && g.vTo !== '' && R.num(g.vTo) < R.num(g.vFrom)) err = t('gp_e_less');
    else if (gaps(g.what).some(function (x) { return x.id !== g.id && x.from < (g.to || '9999') && (x.to || '9999') > g.from; })) err = t('gp_e_overlap');
    var box = document.getElementById('gp-err'); if (err) { if (box) box.textContent = err; return; }
    if (heat) { delete g.serial; delete g.verifiedUntil; }
    setGaps(function (list) { var i = list.map(function (x) { return x && x.id; }).indexOf(g.id); if (i >= 0) list[i] = Object.assign({}, list[i], g); else list.push(g); });
    var notes = [];
    // новий теплолічильник: його показання після встановлення — нові «останні прийняті» (з ними порівнює робот ХТМ)
    if (heat && g.fresh && g.to && R.num(g.vTo) !== null && (!S.baseline || !S.baseline.date || S.baseline.date < g.to)) { S.baseline = { date: g.to, energy: g.vTo }; save(); notes.push(t('gp_saved_base')); }
    // новий водомір: заводський № і повірка
    var sn = val('serial'), ver = val('ver');
    if (!heat && g.fresh && (sn || ver)) { wsetCfg(function (c) { c.meters.forEach(function (m) { if (m.id === g.what) { if (sn) m.serial = sn; if (ver) m.verifiedUntil = ver; } }); }); notes.push(t('gp_saved_meter')); }
    toast(t('gp_saved') + (notes.length ? ' ' + notes.join(' ') : ''));
    var k = gapKind(g); go(k === 'heat' ? 'heat' : 'water-' + k);
  }

  /** Показания без удалённых (удалённые остаются «надгробием» с deleted, чтобы удаление синхронизировалось). */
  function RD() { var first = S.places && S.places[0] ? S.places[0].id : 'main'; return (S.readings || []).filter(function (r) { return r && !r.deleted && (r.place || first) === S.placeId; }); }
  /** Тариф тепла, грн/Гкал: свій у квартири (place.prov.heat.price — з платіжки або з Налаштувань), далі старий спільний S.tariff, далі ХТМ. */
  function tariff() {
    var p = place() || {}, h = (p.prov || {}).heat || {}, pn = R.num(h.price); if (pn && pn > 0) return pn;
    var d = prvOf('heat'); if (d && d.via !== 'htm' && R.num(d.price) > 0) return R.num(d.price);   // тепло не від ХТМ — тариф із довідника громади
    var n = R.num(S.tariff); return n && n > 0 ? n : R.C.TARIFF;
  }
  function tariffSet(v) { var p = place(); if (!p) { S.tariff = v; return; } p.prov = p.prov || {}; p.prov.heat = Object.assign({}, p.prov.heat || {}, { price: v, at: today() }); p.updatedAt = Date.now(); }
  /* Платіжка ХТМ: до сплати = (ваше тепло за лічильником + ваша частка ЗБП) × тариф + абонплата.
     ЗБП — загальнобудинкові потреби (сходи, підвал): частка пропорційна площі, у платіжці — стовпець «на ЗБП» у рядку вашого вузла. */
  // абонплата и доля ЗБП — свои у каждой квартиры (place.bill); у первой — откат на прежние общие S.bill
  // своєї абонплати немає: тепло від ХТМ — абонплата ХТМ; тепло громади (Рогань) — її абонплата з довідника, а невідома — 0 (не харківська)
  function bill() {
    var p = place() || {}, first = (places()[0] || {}).id === p.id, b = Object.assign({}, first ? S.bill || {} : {}, p.bill || {}), ab = R.num(b.abon), mz = R.num(b.mzk), dflt = R.C.ABON;
    if (!(ab !== null && ab >= 0)) { var d = prvOf('heat'), da = d ? R.num(d.abon) : null; if (d && d.org && d.via !== 'htm') dflt = da !== null && da >= 0 ? da : 0; }
    return { abon: ab !== null && ab >= 0 ? ab : dflt, mzk: mz !== null && mz >= 0 ? mz : 0 };
  }
  var MONTH_DAYS = 365.25 / 12;
  function costOf(dE, days) {
    // ХТМ рахує ЗБП і абонплату помісячно: проміжок ~місяць — рівно один місяць
    var b = bill(), m = days >= 20 ? Math.max(1, Math.round(days / MONTH_DAYS)) : days > 0 ? days / MONTH_DAYS : 0, mz = b.mzk * m, heat = Math.max(0, dE) * tariff();
    return { heat: heat, mzk: mz * tariff(), abon: b.abon * m, total: heat + mz * tariff() + b.abon * m, gcal: Math.max(0, dE) + mz };
  }
  /** Сколько тепла набежало с прошлых показаний (по дате снятия) или с последних принятых ХТМ, и сколько это стоит. */
  function interval(r) {
    var d = r.htm && r.htm.date, e = R.num(r.htm && r.htm.energy); if (!d || e === null) return null;
    var prev = RD().filter(function (x) { return x !== r && (r.own || !x.own) && x.htm && x.htm.date && x.htm.date < d && R.num(x.htm.energy) !== null; })
      .sort(function (a, b) { return a.htm.date < b.htm.date ? -1 : 1; }).slice(-1)[0];
    var from = prev ? prev.htm : (S.baseline && S.baseline.date && S.baseline.date < d && R.num(S.baseline.energy) !== null ? S.baseline : null);
    if (!from) return null;
    // лічильник знімали між ними: від показань після встановлення; невідомі — не рахуємо
    var g = gaps('heat').filter(function (x) { return x.from >= from.date && x.from < d; }).slice(-1)[0];
    var off = 0;
    if (g) {
      if (!g.to || g.to > d) return null;
      if (R.num(g.vTo) !== null) from = { date: g.to, energy: g.vTo };
      else if (g.fresh) return null;
      else off = R.daysBetween(g.from, g.to);   // той самий лічильник не рахував, поки його не було
    }
    var dE = e - R.num(from.energy), days = Math.max(1, R.daysBetween(from.date, d) - off);
    var c = costOf(dE, days);
    return { dE: dE, days: days, cost: c.total, parts: c, from: from.date, fromBase: !prev && !g, fromGap: !!g, overGap: off > 0 };
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

  /** Показания тепла и периоды без лічильника вперемешку, новые сверху (у периода дата — когда сняли). */
  /** Деньги крупно — целыми гривнями (это и так оценка «≈»). */
  function money0(n) { return Math.round(n).toLocaleString(S.lang === 'ru' ? 'ru-RU' : 'uk-UA'); }
  /** Итог одним шаблоном (тепло и вода; статистика, економія): главное — сколько (Гкал/м³) и сколько стоит; подпись и детали — мелко.
   *  o: {key, q, unit, money, cap, chips: [html], tone: 'heat'|'hot'|'cold'} */
  function kpi(o) {
    return '<div class="kpi ' + (o.tone || 'heat') + '" data-key="' + esc(o.key || 'kpi') + '"><div class="kpi-row">' +
      (o.q !== null && o.q !== undefined ? '<div class="kpi-q"><b>' + esc(o.q) + '</b><span>' + esc(o.unit) + '</span></div>' : '') +
      (o.money !== null && o.money !== undefined ? '<div class="kpi-m"><b>≈ ' + esc(money0(o.money)) + '</b><span>грн</span></div>' : '') + '</div>' +
      (o.cap ? '<div class="kpi-cap">' + esc(o.cap) + '</div>' : '') + (o.chips && o.chips.length ? '<div class="kpi-chips">' + o.chips.join('') + '</div>' : '') + '</div>';
  }
  function chip(txt, icon) { return '<span class="kchip">' + (icon ? ico(icon, 16) : '') + '<span>' + esc(txt) + '</span></span>'; }
  /** Совет с цифрой («−1 °C → −0,1 Гкал ≈ 158 грн») — отдельной плашкой. */
  function tipLine(icon, html) { return '<div class="kpi-tip">' + ico(icon, 20) + '<p>' + html + '</p></div>'; }
  /** Строка истории одним шаблоном: крупно «+2,127 Гкал · ≈ 3 304 грн», ниже мелко дата · показання · дні; справа — значки.
   *  o: {key, href, q, unit, money, none, sub: [..], right} */
  /** Значок «есть платёжка» в строке истории. */
  function billMark(list) {
    var n = (list || []).filter(function (b) { return b && b.id; }).length; if (!n) return '';
    return '<span class="ph-n" title="' + esc(t('bl_n', { n: n })) + '">' + ico('bill', 16) + '<span class="num">' + n + '</span></span>';
  }
  /** Підпис з кількох шматків: кожен — окремим span, між ними проміжок (CSS gap), без «·» і «—». */
  function subSpans(a) { return (Array.isArray(a) ? a : [a]).filter(Boolean).map(function (x) { return '<span>' + esc(x) + '</span>'; }).join(''); }
  function histRow(o) {
    var hasQ = o.q !== null && o.q !== undefined, hasM = o.money !== null && o.money !== undefined;
    var main = '<div class="hr-main">' + (o.lead || '') + (hasQ || hasM
      ? (hasQ ? '<span class="hr-q">' + esc(o.q) + ' <small>' + esc(o.unit) + '</small></span>' : '') + (hasM ? '<span class="hr-m">≈ ' + esc(money0(o.money)) + ' <small>грн</small></span>' : '')
      : '<span class="hr-none">' + esc(o.none || '') + '</span>') + '</div>';
    // дата — сверху, отдельной строкой с отступом (тем же мелким шрифтом), ниже — сколько и почём.
    // Есть статус (o.st) — чипс рядом со ссылкой (на телефоне — строкой ниже): своя кнопка, выбор «передано / не передано / для себе»
    return '<li class="' + (o.st ? 'hli' : '') + (o.cls ? ' ' + o.cls : '') + '" data-key="' + esc(o.key) + '"><a class="rowlink hrow" href="' + esc(o.href) + '"><div class="grow">' +
      (o.date ? '<div class="hr-date">' + esc(o.date) + '</div>' : '') + main +
      '<div class="hr-sub">' + subSpans(o.sub) + '</div></div>' + (o.right || '') + '</a>' + (o.st || '') + '</li>';
  }
  /** Чипс статуса в истории — кнопка: нажал — меню «Передано · Не передано · Лише для себе» прямо под ним.
   *  src: w (вода) | m (світло, газ) | h (тепло); k — вид (hot/cold/elec/gas/heat); cur: sent | not | own; label — своя надпись
   *  (у тепла — «Прийнято», «На перевірці»…). Стартовые — только «передано / не передавали». */
  function stChip(src, r, k, cur, label) {
    var cls = cur === 'own' ? 'own' : cur === 'sent' ? 'ok' : 'neutral';
    var txt = label || '<span class="pill ' + cls + '">' + esc(cur === 'own' ? t('own_pill') : cur === 'sent' ? t('wh_sent') : r.base ? t('bs_unsent') : t('wh_notsent')) + '</span>';
    return '<button type="button" class="st-chip" data-act="st-open" data-src="' + src + '" data-id="' + esc(r.id) + '" data-k="' + k + '" data-cur="' + cur + '"' + (r.base ? ' data-base="1"' : '') +
      ' aria-haspopup="true" aria-expanded="false" aria-label="' + esc(t('st_aria', { s: String(txt).replace(/<[^>]+>/g, '') })) + '" data-key="st-' + esc(r.id) + '">' + String(txt).replace(/<\/span>$/, ico('chev', 14, 'st-dd') + '</span>') + '</button>';
  }
  function stClose() { Array.prototype.forEach.call(document.querySelectorAll('.st-menu'), function (m) { m.remove(); }); Array.prototype.forEach.call(document.querySelectorAll('.st-chip[aria-expanded="true"]'), function (b) { b.setAttribute('aria-expanded', 'false'); }); }
  function stOpen(el) {
    var was = el.getAttribute('aria-expanded') === 'true'; stClose(); if (was) return;
    var src = el.getAttribute('data-src'), k = el.getAttribute('data-k'), cur = el.getAttribute('data-cur'), base = el.getAttribute('data-base') === '1';
    var opts = base ? [['sent', 'st_sent', 'bs_lead_s'], ['not', 'st_base_not', '']] : [['sent', 'st_sent', 'st_sent_' + (k === 'hot' ? 'hot' : k)], ['not', 'st_not', ''], ['own', 'st_own', 'st_own_s']];
    var m = document.createElement('div'); m.className = 'st-menu'; m.setAttribute('role', 'menu'); m.setAttribute('data-key', 'st-menu');
    m.innerHTML = opts.map(function (o) {
      var on = o[0] === cur, sub = o[2] ? t(o[2]) : '';
      return '<button type="button" role="menuitemradio" aria-checked="' + on + '" class="st-opt' + (on ? ' on' : '') + '" data-act="st-set" data-v="' + o[0] + '" data-src="' + src + '" data-id="' + esc(el.getAttribute('data-id')) + '" data-k="' + k + '" data-key="st-set-' + o[0] + '">' +
        '<span class="st-mark">' + (on ? ico('check', 18) : '') + '</span><span><b>' + esc(t(o[1])) + '</b>' + (sub ? '<span class="small muted">' + esc(sub) + '</span>' : '') + '</span></button>';
    }).join('');
    var li = el.closest('li'); if (li) li.appendChild(m); else el.parentNode.insertBefore(m, el.nextSibling);
    el.setAttribute('aria-expanded', 'true');
    // под чипсом, но не за краем экрана
    if (li) { var lr = li.getBoundingClientRect(), cr = el.getBoundingClientRect(), vw = document.documentElement.clientWidth, mw = m.offsetWidth;
      var x = Math.min(Math.max(8, cr.right - mw), vw - 8 - mw); m.style.left = Math.round(x - lr.left) + 'px'; m.style.right = 'auto';
      // снизу не влезает (низ экрана, нижнее меню ~70 px) — над чипсом, если сверху места больше
      var mh = m.offsetHeight, vh = window.innerHeight || document.documentElement.clientHeight, below = vh - 76 - cr.bottom, up = below < mh + 8 && cr.top - 8 > below;
      m.style.top = Math.round(up ? cr.top - lr.top - mh - 6 : cr.bottom - lr.top + 6) + 'px'; m.classList.toggle('up', up); }
    var f = m.querySelector('.st-opt.on') || m.querySelector('.st-opt'); if (f) f.focus();
  }
  /** Применить статус из меню: вода — sent.vk (+ sent.htm у горячей), світло/газ — sent[obl|grm], тепло — status handed ↔ checked;
   *  «для себе» — r.own; стартовые — sent.no. Одна запись воды — общая для горячей и холодной: «не передано» у горячей снимает
   *  только ХТМ, у холодной — Водоканал. */
  function stApply(src, id, k, v) {
    var list = src === 'w' ? S.water : src === 'm' ? S.mrecs : S.readings, r = (list || []).filter(function (x) { return x && x.id === id; })[0];
    if (!r) return;
    var d = today();
    r.sent = Object.assign({}, r.sent || {});
    if (r.base) { if (v === 'sent') delete r.sent.no; else r.sent.no = true; }
    else if (v === 'own') r.own = true;
    else {
      delete r.own;
      if (src === 'w') {
        if (v === 'sent') { if (!r.sent.vk) r.sent.vk = d; if (k === 'hot' && !r.sent.htm) r.sent.htm = d; }
        else if (k === 'hot') r.sent.htm = ''; else r.sent.vk = '';
      } else if (src === 'm') { var sk = SK[k] ? SK[k].sk : 'obl'; r.sent[sk] = v === 'sent' ? (r.sent[sk] || d) : ''; }
      else {
        if (v === 'sent' && !/^(handed|accepted|rejected)$/.test(r.status)) { r.status = 'handed'; r.handedAt = new Date().toISOString(); }
        if (v === 'not' && /^(handed|accepted|rejected)$/.test(r.status)) { r.status = 'checked'; delete r.handedAt; }
      }
    }
    if (src === 'h' && !Object.keys(r.sent).length) delete r.sent;
    r.updatedAt = Date.now(); save();
    toast(t('st_done', { s: t(r.base ? (v === 'sent' ? 'st_sent' : 'st_base_not') : v === 'own' ? 'st_own' : v === 'sent' ? 'st_sent' : 'st_not').toLowerCase() }));
    render(true);
    var b = document.querySelector('[data-key="st-' + id + '"]'); if (b) try { b.focus({ preventScroll: true }); } catch (e0) { b.focus(); }
  }
  document.addEventListener('click', function (e) { if (!document.querySelector('.st-menu')) return; var x = e.target; if (x && x.closest && (x.closest('.st-menu') || x.closest('.st-chip'))) return; stClose(); }, true);
  document.addEventListener('keydown', function (e) {
    var m = document.querySelector('.st-menu'); if (!m) return;
    if (e.key === 'Escape') { var li = m.closest('li'), b = li && li.querySelector('.st-chip'); stClose(); if (b) b.focus(); e.preventDefault(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { var os = Array.prototype.slice.call(m.querySelectorAll('.st-opt')), i = os.indexOf(document.activeElement); i = (i + (e.key === 'ArrowDown' ? 1 : -1) + os.length) % os.length; os[i].focus(); e.preventDefault(); }
  });
  function heatMixed(limit) {
    var arr = RD().map(function (r) { return { d: (r.htm && r.htm.date) || '', r: r }; }).concat(gaps('heat').map(function (g) { return { d: g.from, g: g }; }));
    arr.sort(function (a, b) { return a.d < b.d ? 1 : a.d > b.d ? -1 : a.g ? -1 : 1; });
    return limit ? arr.slice(0, limit) : arr;
  }
  function readingList(arr) {
    return '<ul class="list" data-key="reading-list">' + arr.map(function (x) { return x.g ? gapItem(x.g) : readingItem(x.r || x); }).join('') + '</ul>';
  }
  function readingItem(r) {
    return [r].map(function (r) {
      var cls = { accepted: 'ok', rejected: 'bad', handed: 'info', checked: 'neutral', intermediate: 'neutral' }[r.status] || 'neutral';
      var iv = interval(r), ok = iv && iv.dE >= 0;
      // вся строка — в карточку показаний (там же правка, удаление, статус); главное — расход и деньги
      return histRow({ cls: 'hli-heat', key: 'reading-' + r.id, href: '#rec-' + r.id, q: ok ? '+' + fmtN(iv.dE, 3) : null, unit: 'Гкал', money: ok ? iv.cost : null,
        none: iv ? t('hi_less', { de: Math.abs(iv.dE).toFixed(3) }) : t(gaps('heat').some(function (g) { return g.from < r.htm.date; }) ? 'hr_nogap' : 'hr_first'),
        date: fmtDate(r.htm.date, true), sub: [t('hr_on_meter', { v: R.formatForHtm('energy', r.htm.energy), u: 'Гкал' }), iv ? iv.days + '\u00a0' + t('days_short') + (iv.overGap ? ' ' + t('hr_over_gap') : '') : ''],
        right: wxChip(wxFor(r)) + billMark(r.bills),
        st: stChip('h', r, 'heat', r.own ? 'own' : /^(handed|accepted|rejected)$/.test(r.status) ? 'sent' : 'not', r.own ? '' : '<span class="pill ' + cls + '">' + esc(t('status_' + r.status)) + '</span>') });
    })[0];
  }

  V.meter = function () {
    var cur = S.meter ? S.meter.modelId : '', sel = S._pickModel || cur;
    var list = M.MODELS.map(function (m) {
      var tag = m.status === 'verified' ? '<span class="pill ok">' + esc(t('m_verified')) + '</span>' : m.status === 'draft' ? '<span class="pill">' + esc(t('m_draft')) + '</span>' : '';
      var name = m.id === 'other' ? esc(t('m_other')) : esc(m.name);
      var sub = m.id === 'other' ? esc(t('m_other_sub')) : esc(m.vendor !== '—' ? m.vendor : '');
      return '<li><label><input type="radio" name="model" value="' + m.id + '"' + (sel === m.id ? ' checked' : '') + ' data-act="pick-model">' +
        meterGlyph() + '<span class="grow"><span class="name">' + name + '</span>' + (sub ? '<br><span class="vendor">' + sub + '</span>' : '') + (tag ? '<br>' + tag : '') + '</span></label></li>';
    }).join('');
    var pm = M.byId(sel), unitBlock = '';
    if (pm && pm.units.length > 1) {
      var u = (S._pickUnit && pm.units.indexOf(S._pickUnit) >= 0 && S._pickModel === sel ? S._pickUnit : null) || (S.meter && S.meter.modelId === sel && S.meter.unit) || pm.unit;
      unitBlock = '<div class="panel" data-key="meter-unit"><h3>' + esc(t('m_unit')) + '</h3><p class="small muted">' + esc(t('m_unit_sub')) + '</p><div class="choice">' +
        pm.units.map(function (x) { return '<label><input type="radio" name="unit" value="' + x + '"' + (u === x ? ' checked' : '') + '>' + esc(unitLbl(x)) + '</label>'; }).join('') + '</div></div>';
    }
    var note = pm && pm.id !== 'other' ? '<p class="small muted">' + esc(L(pm.note)) + '</p>' : '';
    return { screen: 'S02', route: 'meter', bare: !S.onboarded, closeTo: S.onboarded ? 'home' : 'start', html: pqBanner(true) +
      '<h1>' + esc(t('m_title')) + '</h1><p class="muted">' + esc(t('m_lead')) + '</p>' +
      (!(place() || {}).name ? '<div class="field" style="max-width:520px"><label for="pl-addr">' + esc(t('pl_addr')) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></label><div class="ctl"><input id="pl-addr" data-plf="address" autocomplete="street-address" placeholder="' + esc(t('pl_addr_ph')) + '" value="' + esc((place() || {}).address || '') + '"></div></div>' : '') +
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
      '<div class="banner" data-key="baseline-where">' + ico('info', 22) + '<div><p>' + esc(t('b_where')) + '</p><p><a href="' + HTM_URL + '" target="_blank" rel="noopener" data-key="baseline-cab">' + esc(t('h_cab_link')) + ' ' + ico('ext', 14) + '</a></p></div></div>' +
      (VIS().available ? '<p><button type="button" class="btn sec" data-act="photo" data-mode="baseline" data-key="baseline-photo">' + ico('camera', 20) + '<span>' + esc(t('ph_base_entry')) + '</span></button></p>' : '') +
      (S._baseFill ? '<div class="banner" data-key="baseline-filled">' + ico('check', 22) + '<div><p>' + esc(t('ph_base_filled')) + '</p></div></div>' : '') +
      '<form id="baseline-form" data-key="baseline-form" novalidate><div class="panel">' + fields + '</div>' + meterData +
      '<p><button type="button" class="linkbtn" data-act="sample" data-key="baseline-sample">' + esc(t('b_sample')) + '</button></p>' +
      '<div class="row-actions"><button type="button" class="btn sec" data-act="skip-base" data-key="baseline-skip">' + esc(t('skip')) + '</button>' +
      '<button type="submit" class="btn" data-key="baseline-save">' + esc(t('save')) + '</button></div></form>' };
  };

  V.step = function (i) {
    var st = steps(), n = st.length; if (!S.draft) newDraft();
    i = Math.max(0, Math.min(n - 1, +i || 0)); S.draft.step = i; save();
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
      left = press + lcd(lines, 'step-lcd') + '<p class="lcd-cap" id="lcd-cap">' + esc(Object.keys(S.draft.values).some(function (k) { return s.fields.indexOf(k) >= 0 && S.draft.values[k]; }) ? t('s_on_screen') : t('s_example')) + '</p>' +
        '<p class="hint">' + esc(L(s.hint)) + '</p>' +
        (m && m.sleepMin ? '<p class="sleep">' + ico('moon', 18) + '<span>' + esc(t('s_sleep', { m: m.sleepMin })) + '</span></p>' : '');
      right = '<h1>' + esc(title) + '</h1>' + s.fields.map(function (k) { return k === 'errCode' ? errCodeField() : numField(k, prev); }).join('');
    }
    var isLast = i === n - 1;
    var actions = '<div class="wiz-actions">' + (i > 0 ? '<a class="btn sec" href="#step-' + (i - 1) + '" data-act="step-back" data-i="' + (i - 1) + '" data-key="step-back">' + ico('back', 20) + '<span>' + esc(t('back')) + '</span></a>' : '') +
      '<button class="btn" data-act="step-next" data-i="' + i + '" data-key="step-next">' + esc(isLast ? t('s_to_check') : t('next')) + '</button></div>' + cancelLink('heat');
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
        (it.fix ? '<div class="fix">' + esc(L(it.fix)) + '</div>' : '') + fixLink +
        (it.code === 'I_NO_PREV' ? '<div class="fix"><a href="' + HTM_URL + '" target="_blank" rel="noopener" data-key="check-cab">' + esc(t('h_cab_link')) + ' ' + ico('ext', 14) + '</a> · <a href="#baseline">' + esc(t('h_add_base')) + '</a></div>' : '') + '</li>';
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
      '<div class="cols"><div>' + issues + period + '</div><div><h2 class="section-title" style="margin-top:0">' + esc(t('c_values')) + '</h2><table class="vals" data-key="check-values">' + rows + '</table></div></div>' + actions + cancelLink('heat') };
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
      // кабінет підключено — робот вносить сам, це головний шлях; вручну — нижче, запасний
      '<div class="ho-steps">' + (hcConn() ? hcPanel(r) : '') + '<div class="panel"><h2>' + esc(t(hcConn() ? 'ho_steps_self' : 'ho_steps_title')) + '</h2><ol class="steps"><li>' + esc(t('ho_s1')) + '</li><li>' + esc(t('ho_s2')) + '</li><li>' + esc(t('ho_s3')) + '</li><li>' + esc(t('ho_s4')) + '</li></ol>' +
      '<a class="btn sec block" href="' + HTM_URL + '" target="_blank" rel="noopener" data-key="handover-open">' + ico('ext', 20) + '<span>' + esc(t('ho_open')) + '</span></a></div>' +
      (hcConn() ? '' : hcPanel(r)) + '</div></div>' +
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
        '<p class="small muted">' + esc(t(r.robot && r.robot.via === 'cab' ? 'hc_refix_sub' : 'st_refix_sub')) + '</p>' +
        '<div class="row-actions"><button class="btn" data-act="refix" data-id="' + r.id + '" data-key="status-refix">' + esc(t('st_refix')) + '</button></div>';
    } else if (r.status === 'handed' && r.cab) {
      // вніс робот: сервер сам перечитує журнал ХТМ; «подивився сам» — запасне
      body = hcWait(r) + '<details class="tips-box" style="margin-top:16px" data-key="status-cab-self"><summary>' + esc(t('hc_self_t')) + '</summary><p class="small">' + esc(t('st_how')) + '</p>' +
        '<div class="row-actions"><button class="btn sec" data-act="accepted" data-id="' + r.id + '" data-key="status-ok">' + ico('check', 22) + '<span>' + esc(t('st_ok_btn')) + '</span></button>' +
        '<a class="btn sec" href="' + HTM_URL + '" target="_blank" rel="noopener">' + ico('ext', 18) + '<span>' + esc(t('ho_open')) + '</span></a></div></details>';
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
    } else if (r.status === 'checked' && r.cab && /^(failed|cancelled)$/.test(r.cab.status)) {
      // автоподача не внесла (скасовано або робот не зміг) — показання збережено: виправити або внести кнопкою
      var fl = r.cab.status === 'failed';
      body = '<div class="banner ' + (fl ? 'bad' : '') + '" data-key="status-cab-' + r.cab.status + '">' + ico(fl ? 'alert' : 'info', 22) + '<div><p><b>' + esc(t(fl ? 'ha_failed_t' : 'ha_cancelled')) + '</b></p>' +
        (fl && r.cab.human ? '<p>' + esc(r.cab.human) + '</p>' : '') + '<p class="small">' + esc(t('ha_failed_fix')) + '</p></div></div>' +
        '<div class="row-actions"><button class="btn" data-act="ha-handover" data-id="' + r.id + '" data-key="status-cab-handover">' + ico('send', 18) + '<span>' + esc(t('ha_go_send')) + '</span></button>' +
        '<button class="btn sec" data-act="refix" data-id="' + r.id + '" data-key="status-refix">' + esc(t('st_refix')) + '</button></div>';
    } else {
      body = '<p><span class="pill">' + esc(t('status_' + r.status)) + '</span></p><a class="btn" href="#home">' + esc(t('nav_home')) + '</a>';
    }
    return { screen: 'S08', route: 'status', html: head + body };
  };

  /** Вкладки без единого счётчика в квартире — пусто и «Додати лічильник». */
  function noMeters(route, title) {
    return { screen: 'S09', route: route, html: '<h1>' + esc(t(title)) + '</h1><div class="panel" data-key="no-meters"><p class="muted">' + esc(t('hi_nometers')) + '</p><button class="btn" data-act="add-meter" data-key="no-meters-add">' + ico('plus', 20) + '<span>' + esc(t('am_tile')) + '</span></button></div>' };
  }
  V.history = function () { if (!kinds().length) return noMeters('history', 'hi_title'); var k = curView(); return k === 'heat' ? heatHistory() : SK[k] ? shistory(k) : whistory(k); };
  V.stats = function () { if (!kinds().length) return noMeters('stats', 'stt_title'); var k = curView(); return k === 'heat' ? heatStats() : SK[k] ? sstats(k) : wstats(k); };
  V.save = function () { if (!kinds().length) return noMeters('save', 'wsv_title'); var k = curView(); return k === 'heat' ? heatSave() : SK[k] ? ssave(k) : wsave(k); };
  function heatHistory() {
    if (window.TeploStats) loadWeather();
    var arr = heatMixed();
    return { screen: 'S09', route: 'history', html: '<h1>' + esc(t('hi_title')) + '</h1>' + kindSwitch() +
      (arr.length ? seasonList(arr) : '<div class="panel"><p class="muted">' + esc(t('hi_empty')) + '</p><button class="btn" data-act="read">' + esc(t('hi_empty_cta')) + '</button></div>') + gapAddLink('heat') };
  }
  /** История тепла по отопительным сезонам — система складывает их сама (TeploStats.seasons): вся цепочка показаний (и «для себе»),
   *  промежуток — в сезон, на который приходится его середина. У сезона — Гкал и гривны (с абонплатой и ЗБП, как в платіжці),
   *  где шло тепло, в среднем за месяц опалення. Новый сезон (и текущий) раскрыт, старые — свёрнуты, итог видно и так. */
  function seasonList(arr) {
    if (!window.TeploStats) return readingList(arr);
    var TS = TeploStats, ss = TS.seasons(TS.intervals(RD(), S.baseline, null, tariff(), gaps('heat')), function (iv) { return costOf(iv.dE, iv.days).total; }, today());
    var of = {}, info = {}; ss.forEach(function (s) { info[s.season] = s; s.ids.forEach(function (id) { of[id] = s.season; }); });
    var groups = {};
    arr.forEach(function (x) {
      var k = x.g ? TS.seasonOf(x.g.from) : of[x.r.id] !== undefined ? of[x.r.id] : TS.seasonOf(x.r.htm.date);
      (groups[k] = groups[k] || []).push(x);
    });
    var keys = Object.keys(groups).map(Number).sort(function (a, b) { return b - a; }), td = today(), run = +td.slice(5, 7) >= 10 || +td.slice(5, 7) <= 4;
    // итог сезона — сумма тех же строк, что в нём видны: показания (и через ремонт — «без періоду ремонту») и період без лічильника
    // (оцінка або сума з платіжки). Раньше брали интервалы графика, где ремонт пропускается, — сумма не сходилась со строками.
    var sumOf = function (list) {
      var o = { gcal: 0, cost: 0, heatDays: 0, from: null, to: null, est: false, n: 0 };
      list.forEach(function (x) {
        if (x.g) {
          var e = gapEst(x.g), amt = R.num(x.g.amount), q = e && x.g.what === 'heat' ? e.gcal || 0 : 0, m = amt !== null ? amt * gapMonths(x.g) : e && e.cost > 0 ? e.cost : 0;
          if (q > 0 || m > 0) { o.gcal += q; o.cost += m; o.est = o.est || q > 0; o.n++; }
          if (e && e.heatDays) { o.heatDays += e.heatDays; if (!o.from || x.g.from < o.from) o.from = x.g.from; if (x.g.to && (!o.to || x.g.to > o.to)) o.to = x.g.to; }
          return;
        }
        var r = x.r || x, iv = interval(r); if (!iv || iv.dE < 0) return;
        o.gcal += iv.dE; o.cost += iv.cost; o.n++;
        if (iv.dE / iv.days >= 0.003) { o.heatDays += iv.days; if (!o.from || iv.from < o.from) o.from = iv.from; if (!o.to || r.htm.date > o.to) o.to = r.htm.date; }
      });
      o.perMonth = o.heatDays ? o.gcal / o.heatDays * 30.44 : null; return o;
    };
    return keys.map(function (k, i) {
      var s = sumOf(groups[k]), lbl = k + '/' + String(k + 1).slice(2), cur = k === TS.seasonOf(td);
      var q = s.gcal > 0 ? '<span class="ss-q">' + (s.est ? '≈ ' : '') + '<b>' + esc(fmtN(s.gcal, 3)) + '</b> Гкал</span><span class="ss-m">≈ <b>' + esc(money0(s.cost)) + '</b> грн</span>'
        : '<span class="ss-none">' + esc(t(s.n ? 'hs_noheat' : 'hs_none')) + '</span>';
      var sub = s.from ? [t('hs_period', { a: fmtDate(s.from, true), b: fmtDate(s.to, true) }), s.perMonth ? t('hs_month', { q: fmtN(s.perMonth, 2), m: money0(costOf(s.perMonth, 30).total) }) : ''] : null;
      return '<details class="season" data-key="season-' + k + '"' + (i === 0 || cur ? ' open' : '') + '><summary class="ss-head">' +
        '<span class="ss-top"><span class="ss-t">' + esc(t('hs_title', { s: lbl })) + '</span>' + (cur ? '<span class="ss-tag' + (run ? ' on' : '') + '">' + esc(t(run ? 'hs_run' : 'hs_cur')) + '</span>' : '') + '</span>' +
        '<span class="ss-sum">' + q + '</span>' + (sub ? '<span class="ss-sub">' + subSpans(sub) + '</span>' : '') + ico('chev', 18, 'ss-dd') + '</summary>' + readingList(groups[k]) + '</details>';
    }).join('') + '<p class="small muted" data-key="hs-hint">' + esc(t('hs_hint')) + '</p>';
  }

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
    return { screen: 'S09', route: 'history', html: head + used + wxp + '<ul class="list" data-key="rec-values">' + rows + '</ul>' + photoStrip(r.photos, 'h' + r.id, 'h:' + r.id) + billsBox('h:' + r.id, r.bills, t('bl_title', { m: monthLabel(String(h.date || '').slice(0, 7)) })) +
      '<div class="row-actions">' + st + '<a class="btn sec" href="#rec-' + r.id + '-edit" data-key="rec-edit">' + esc(t('rec_edit')) + '</a>' +
      '<button class="btn danger" data-act="rec-del-ask" data-key="rec-del">' + esc(t('rec_del')) + '</button></div><div id="rec-del-confirm"></div>' + ownBox('h', r) };
  }

  // ---------------- статистика (пока только владельцу) ----------------
  var WX = { key: '', days: null, loading: false, err: '' };   // погода Харькова по дням для диапазона истории
  function loadWeather() {
    if (!window.TEPLO_API) return;
    var rg = window.TeploStats && TeploStats.range(RD(), S.baseline); if (!rg) return;
    // ошибка — не повторять на каждой перерисовке (иначе ответ → перерисовка → запрос… по кругу); снова — через 5 минут
    var key = rg.from + '_' + rg.to; if (WX.key === key && (WX.days || WX.loading || (WX.err && Date.now() - WX.at < 300000))) return;
    WX = { key: key, days: null, loading: true, err: '', at: Date.now() };
    fetch(window.TEPLO_API + '/weather?from=' + rg.from + '&to=' + rg.to, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); }).then(function (j) { WX.loading = false; if (j && j.days) WX.days = j.days; else WX.err = (j && (j.human || j.error)) || 'error'; if (/^(stats|history|rec-)/.test(routeName())) safeRender(); },
        function () { WX.loading = false; WX.err = 'network'; if (routeName() === 'stats') safeRender(); });
  }
  function shortDate(d) { var p = dateParts(d); return ('0' + p.d).slice(-2) + '.' + ('0' + p.m).slice(-2) + '.' + String(p.y).slice(2); }
  // цвета графиков — из CSS-токенов (светлая/тёмная тема); обновляются при каждой отрисовке
  var CH = {};
  function chColors() { var cs = getComputedStyle(document.documentElement), g = function (k) { return cs.getPropertyValue(k).trim(); };
    CH = { ink: g('--c-ink'), ink2: g('--c-ink-2'), grid: g('--ch-grid'), bar: g('--ch-bar'), barSoft: g('--ch-bar-soft'), ok: g('--ch-ok'), low: g('--ch-low'), bad: g('--ch-bad'), none: g('--ch-none'), off: g('--ch-off'), ring: g('--ch-dot-ring'), surface: g('--c-surface'), hot: g('--c-supply'), cold: g('--c-return'), elec: g('--c-elec'), gas: g('--c-gas') }; }
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
    var nt = nTicks(max), stp = max / nt, dec = o.dec !== undefined ? (stp < 1 ? (stp < 0.1 ? 2 : 1) : (Math.abs(stp - Math.round(stp)) > 1e-9 ? 1 : 0)) : 1;
    for (var k = 0; k <= nt; k++) { var tv = max * k / nt, yy = y(tv); g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" stroke="' + CH.grid + '"/><text x="' + (L - 6) + '" y="' + (yy + 4) + '" text-anchor="end" class="ax">' + esc(fmtN(tv, dec)) + '</text>'; }
    // підписи над стовпцями — лише якщо вміщаються в слот (інакше «100%0%» злипаються); значення є в підказці
    var topW = Math.max.apply(null, items.map(function (x) { return String(x.top || '').length; }).concat([0])) * 7 + 6, showTop = topW <= slot;
    var bars = items.map(function (it, i) {
      var cx = L + slot * (i + 0.5), x0 = cx - bw / 2, yt = y(it.v || 0), yb = T + ih, h = Math.max(0, yb - yt), r = Math.min(4, h);
      var path = h > 0 ? 'M' + x0 + ',' + yb + 'V' + (yt + r) + 'Q' + x0 + ',' + yt + ' ' + (x0 + r) + ',' + yt + 'H' + (x0 + bw - r) + 'Q' + (x0 + bw) + ',' + yt + ' ' + (x0 + bw) + ',' + (yt + r) + 'V' + yb + 'Z' : '';
      return '<g class="mk"' + tipAttr(it.tip) + '><rect x="' + (cx - slot / 2) + '" y="' + T + '" width="' + slot + '" height="' + (ih + B) + '" fill="transparent"/>' +
        (path ? '<path d="' + path + '" fill="' + (it.color || (it.soft ? CH.barSoft : CH.bar)) + '"/>' : '') +
        (it.top && showTop ? '<text x="' + cx + '" y="' + Math.max(T + 10, yt - 5) + '" text-anchor="middle" class="vl">' + esc(it.top) + '</text>' : '') +
        (i % Math.ceil(52 / slot) === 0 ? '<text x="' + cx + '" y="' + (T + ih + 17) + '" text-anchor="middle" class="ax">' + esc(it.x) + '</text>' : '') +
        (it.x2 && i % Math.ceil(40 / slot) === 0 ? '<text x="' + cx + '" y="' + (T + ih + 31) + '" text-anchor="middle" class="ax x2">' + esc(it.x2) + '</text>' : '') + '</g>';
    }).join('');
    var ref = o.ref ? '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(o.ref.v) + '" y2="' + y(o.ref.v) + '" stroke="' + CH.ink2 + '" stroke-dasharray="4 4"/><text x="' + (W - R) + '" y="' + (y(o.ref.v) - 5) + '" text-anchor="end" class="ax ref-l">' + esc(o.ref.label) + '</text>' : '';
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
  function heatStats() {
    chColors();   // тестовый период: статистика открыта всем
    var St = window.TeploStats; loadWeather();
    var w = WX.days, ivs = St.intervals(RD(), S.baseline, w, tariff(), gaps('heat')), cl = St.coolant(RD(), S.baseline, w);
    ivs.forEach(function (it) { it.cost = +costOf(it.dE, it.days).total.toFixed(2); });
    if (!ivs.length) return { screen: 'S15', route: 'stats', html: '<h1>' + esc(t('stt_title')) + '</h1>' + kindSwitch() + '<div class="panel"><p class="muted">' + esc(t('stt_empty')) + '</p></div>' };
    var summer = function (it) { return it.days > 100; };
    var lbl = function (it) { return shortDate(it.to); };
    var period = function (it) { return t('stt_period', { a: R.toHtmDate(it.from), b: R.toHtmDate(it.to), d: it.days }); };
    var wxNote = WX.loading ? '<p class="small muted" role="status">' + SPIN + ' ' + esc(t('stt_wx_loading')) + '</p>' : WX.err ? '<p class="small muted">' + esc(t('stt_wx_err')) + '</p>' : '';
    // сводка: последний отопительный сезон (с 1 октября)
    var last = ivs[ivs.length - 1], sy = +last.to.slice(0, 4) - (last.to.slice(5, 7) < '10' ? 1 : 0), sFrom = sy + '-10-01';
    var season = ivs.filter(function (it) { return it.to > sFrom; }), sE = season.reduce(function (a, it) { return a + Math.max(0, it.dE); }, 0);
    var okN = cl.filter(function (p) { return p.status === 'ok'; }).length, judged = cl.filter(function (p) { return p.status !== 'off'; }).length;
    var sUah = season.reduce(function (a, it) { return a + it.cost; }, 0), sDays = season.reduce(function (a, it) { return a + (summer(it) ? 0 : it.days); }, 0);
    var tiles = kpi({ key: 'stats-kpi', q: fmtN(sE, 3), unit: 'Гкал', money: sUah, cap: t('kpi_season', { s: sy + '/' + String(sy + 1).slice(2) }),
      chips: [sDays >= 20 ? chip(t('kpi_per_month', { g: fmtN(sE / sDays * 30.44, 3), u: 'Гкал', m: money0(sUah / sDays * 30.44) }), 'chart') : '', judged ? chip(t('kpi_ok_share', { a: okN, b: judged }), okN === judged ? 'check' : 'thermo') : ''].filter(Boolean) });
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
    var table = '<details class="panel wacc tbl-acc" data-key="stt-table"><summary><h2>' + esc(t('stt_table')) + '</h2>' + ico('chev', 20, 'pacc-chev') + '</summary><div class="tbl-wrap where-b"><table class="tbl"><thead><tr><th>' + esc(t('stt_th_period')) + '</th><th>Гкал</th><th>' + esc(t('stt_g30')) + '</th><th>грн</th><th>°C ' + esc(t('stt_th_out')) + '</th><th>' + esc(t('stt_th_hdd')) + '</th><th>ΔT</th><th>м³/год</th><th>' + esc(t('stt_th_share')) + '</th></tr></thead><tbody>' +
      ivs.map(function (it) { return '<tr><td>' + esc(R.toHtmDate(it.from) + ' – ' + R.toHtmDate(it.to)) + '</td><td class="num">' + fmtN(it.dE, 3) + '</td><td class="num">' + fmtN(it.month, 3) + '</td><td class="num">' + money(it.cost) + '</td><td class="num">' + (it.tOut !== undefined ? fmtN(it.tOut, 1) : '—') + '</td><td class="num">' + (it.perHdd != null ? fmtN(it.perHdd, 2) : '—') + '</td><td class="num">' + (it.dT != null ? fmtN(it.dT, 1) : '—') + '</td><td class="num">' + (it.flow != null ? fmtN(it.flow, 3) : '—') + '</td><td class="num">' + (it.share != null ? Math.round(it.share * 100) + '%' : '—') + '</td></tr>'; }).join('') +
      '</tbody></table></div></details>';
    return { screen: 'S15', route: 'stats', html: '<h1>' + esc(t('stt_title')) + '</h1>' + kindSwitch() + '<p class="muted">' + esc(t('stt_lead')) + '</p>' + wxNote + tiles + gapNote(gaps('heat')) +
      panel(t('stc_title'), t('stc_sub'), cl.length ? coolantChart(cl) : '', legend) +
      panel(t('stx_title'), t('stx_sub'), corrChart(cl)) +
      panel(t('st1_title'), t('st1_sub'), c1) + panel(t('st3_title'), t('st3_sub'), c3) + panel(t('st2_title'), t('st2_sub'), c2) + panel(t('st4_title'), t('st4_sub'), c4) + table +
      '<p class="small muted">' + esc(t('stt_method')) + '</p>' };
  }
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
  function heatSave() {
    var mm = myMonth(), list = tips();
    var mine = mm ? '<div class="panel" data-key="save-mine"><h2>' + esc(t('sv_mine')) + '</h2>' +
      kpi({ key: 'save-kpi', q: fmtN(mm.g, 3), unit: 'Гкал', money: costOf(mm.g, MONTH_DAYS).total, cap: t('kpi_month_bill') }) +
      tipLine('thermo', t('kpi_one_deg', { g: fmtN(mm.g * 0.05, 3), uah: '<b>' + esc(money0(mm.g * 0.05 * tariff())) + ' грн</b>', y: esc(money0(mm.g * 0.05 * tariff() * 6)) })) +
      '<p class="small muted">' + esc(t('sv_mine_from', { a: R.toHtmDate(mm.from), b: R.toHtmDate(mm.to) })) + '</p></div>'
      : '<div class="panel"><p class="muted">' + esc(t('sv_no_data')) + '</p></div>';
    return { screen: 'S14', route: 'save', html: '<h1>' + esc(t('sv_title')) + '</h1>' + kindSwitch() + '<p class="muted">' + esc(t('sv_lead')) + '</p>' + mine +
      accGroups([[t('sv_g1'), 'thermo', [0, 5, 4]], [t('sv_g2'), 'flame', [1, 2, 3, 7]], [t('sv_g3'), 'home', [6]], [t('sv_g4'), 'chart', [8, 9]]].map(function (g) {
        return { title: g[0], icon: g[1], items: g[2].map(function (k) { return { title: list[k][0], html: '<p>' + esc(list[k][1]) + '</p>' }; }) };
      }), 'save-tips') +
      '<p class="small muted">' + esc(t('sv_src')) + '</p>' };
  }

  /** Политика конфиденциальности и условия использования — с каждого языка, разделы-плашки. */
  function legalPage(kind) {
    var ru = S.lang === 'ru', sec = function (h, body) { return '<section class="panel legal"><h2>' + esc(h) + '</h2>' + body + '</section>'; };
    var P = function (x) { return '<p>' + x + '</p>'; }, UL = function (a) { return '<ul>' + a.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>'; };
    var upd = '<p class="small muted">' + esc(ru ? 'Редакция от 06.11.2026' : 'Редакція від 06.11.2026') + '</p>';
    var fb = '<button class="linkbtn" data-act="fb-open">' + esc(ru ? '«Отзыв»' : '«Відгук»') + '</button>';
    if (kind === 'privacy') return '<h1>' + esc(t('lg_privacy')) + '</h1>' + upd + (ru ? [
      sec('Кратко', P('«Счётчики» помогают снять показания квартирных счётчиков тепла, воды, света и газа и подготовить их для КП «Харьковские тепловые сети» (ХТМ), КП «Харківводоканал», АО «Харьковоблэнерго», «Газсетей» и «Нафтогаза». Мы собираем минимум данных, не продаём их и не передаём для рекламы. Сервис не связан с этими поставщиками. Сам он передаёт показания только когда вы нажмёте «Отправить» или «Внести»: на сайт Водоканала и — если вы подключили свой кабинет ХТМ — в этот кабинет.')),
      sec('Какие данные', UL(['Без входа — показания, счётчик, адреса квартир и настройки хранятся только в вашем браузере.', 'После входа — e-mail (пароль хранится только в виде хеша) или ваш Telegram ID и имя, а также те же данные для синхронизации между устройствами.', 'Фото счётчика при распознавании: распознаются прямо в браузере; вошедшим копия фото и результат хранятся на сервере до 90 дней, чтобы улучшать распознавание (тестовая версия).', 'Документы счётчика (паспорт, поверка), если вы их загрузили, — до удаления вами.', 'Отзывы и контакт, который вы указали в отзыве.', 'Технические журналы сервера (IP-адрес, время запроса) — для безопасности, недолго.'])),
      sec('Кабинет ХТМ (если подключите)', UL(['E-mail и пароль от кабинета ХТМ — только если вы сами подключили кабинет и дали согласие. Пароль хранится на сервере зашифрованным (AES-256), ключ — отдельно от базы данных; в журналах сервера пароля нет.', 'Робот входит в кабинет только чтобы внести показания тепла по вашему нажатию «Внести» и потом проверить журнал ХТМ (несколько раз в течение 6 часов). Ничего другого в кабинете не меняет.', 'Телефон и e-mail вместе с показаниями получает ХТМ — этого требует их форма.', '«Забыть пароль» на экране «Кабинет ХТМ» и «Удалить все данные» удаляют пароль с сервера сразу.'])),
      sec('Зачем', UL(['чтобы сервис работал: проверка показаний, история, синхронизация, вход;', 'чтобы улучшать распознавание фото и исправлять ошибки;', 'чтобы ответить на ваш отзыв.'])),
      sec('Кто ещё получает данные', UL(['Хостинг: сервер Hetzner (Германия, ЕС) за Cloudflare (защита и доставка).', 'Telegram — если вы входите через Telegram.', 'Open-Meteo — получает только координаты Харькова для погоды, без ваших данных.', 'Anthropic (Claude) — только если владелец включит серверное распознавание: тогда фото вошедших отправляются на распознавание.'])),
      sec('Файлы cookie', P('Только необходимые: cookie сессии входа и защитный cookie от подделки запросов. Без рекламных и аналитических трекеров.')),
      sec('Ваши права', P('По Закону Украины «О защите персональных данных» вы можете узнать, какие данные о вас хранятся, исправить или удалить их. «Настройки» → «Удалить все данные» стирает данные с устройства и из аккаунта; фото и документы удаляются вместе с аккаунтом. Вопросы — через кнопку ' + fb + '.'))
    ] : [
      sec('Коротко', P('«Лічильники» допомагають зняти показання квартирних лічильників тепла, води, світла й газу та підготувати їх для КП «Харківські теплові мережі» (ХТМ), КП «Харківводоканал», АТ «Харківобленерго», «Газмереж» і «Нафтогазу». Ми збираємо мінімум даних, не продаємо їх і не передаємо для реклами. Сервіс не пов’язаний із цими постачальниками. Сам він передає показання лише тоді, коли ви натиснете «Відправити» чи «Внести»: на сайт Водоканалу і — якщо ви підключили свій кабінет ХТМ — у цей кабінет.')),
      sec('Які дані', UL(['Без входу — показання, лічильник, адреси квартир і налаштування зберігаються лише у вашому браузері.', 'Після входу — e-mail (пароль зберігається лише як геш) або ваш Telegram ID та ім’я, а також ті самі дані для синхронізації між пристроями.', 'Фото лічильника під час розпізнавання: розпізнаються просто в браузері; тим, хто увійшов, копія фото й результат зберігаються на сервері до 90 днів, щоб покращувати розпізнавання (тестова версія).', 'Документи лічильника (паспорт, повірка), якщо ви їх завантажили, — доки ви їх не видалите.', 'Відгуки й контакт, який ви вказали у відгуку.', 'Технічні журнали сервера (IP-адреса, час запиту) — для безпеки, недовго.'])),
      sec('Кабінет ХТМ (якщо підключите)', UL(['E-mail і пароль від кабінету ХТМ — лише якщо ви самі підключили кабінет і дали згоду. Пароль зберігається на сервері зашифрованим (AES-256), ключ — окремо від бази даних; у журналах сервера пароля немає.', 'Робот входить у кабінет лише щоб внести показання тепла за вашим натисканням «Внести» і потім перевірити журнал ХТМ (кілька разів протягом 6 годин). Нічого іншого в кабінеті не змінює.', 'Телефон і e-mail разом із показаннями отримує ХТМ — цього вимагає їхня форма.', '«Забути пароль» на екрані «Кабінет ХТМ» і «Видалити всі дані» видаляють пароль із сервера одразу.'])),
      sec('Навіщо', UL(['щоб сервіс працював: перевірка показань, історія, синхронізація, вхід;', 'щоб покращувати розпізнавання фото й виправляти помилки;', 'щоб відповісти на ваш відгук.'])),
      sec('Хто ще отримує дані', UL(['Хостинг: сервер Hetzner (Німеччина, ЄС) за Cloudflare (захист і доставка).', 'Telegram — якщо ви входите через Telegram.', 'Open-Meteo — отримує лише координати Харкова для погоди, без ваших даних.', 'Anthropic (Claude) — лише якщо власник увімкне серверне розпізнавання: тоді фото тих, хто увійшов, надсилаються на розпізнавання.'])),
      sec('Файли cookie', P('Лише необхідні: cookie сесії входу й захисний cookie від підробки запитів. Без рекламних і аналітичних трекерів.')),
      sec('Ваші права', P('За Законом України «Про захист персональних даних» ви можете дізнатися, які дані про вас зберігаються, виправити чи видалити їх. «Налаштування» → «Видалити всі дані» стирає дані з пристрою та з акаунта; фото й документи видаляються разом з акаунтом. Питання — через кнопку ' + fb + '.'))
    ]).join('');
    return '<h1>' + esc(t('lg_terms')) + '</h1>' + upd + (ru ? [
      sec('Что это', P('«Счётчики» — бесплатный помощник для жителей Харькова и области: тепло, горячая и холодная вода, свет и газ; подсказывает, что нажимать на теплосчётчике, читает водомеры по фото, проверяет цифры по тем же правилам, что и ХТМ, и подсказывает, куда и до какого числа их передать.')),
      sec('Не официальный сервис ХТМ', P('Сервис не принадлежит КП «Харьковские тепловые сети» и не действует от их имени. Передаёте показания вы сами — в кабинете ХТМ, их боте или по телефону. Решение о приёме показаний и начислениях принимает только ХТМ.')),
      sec('Ваша ответственность', UL(['Сверяйте числа со счётчиком перед отправкой — распознавание фото и подсказки могут ошибаться.', 'Передавайте показания в сроки ХТМ (с 5 по 25 число).', 'Не загружайте чужие документы и фото, на которые у вас нет прав.'])),
      sec('Без гарантий', P('Сервис предоставляется «как есть». Расчёт стоимости — ориентировочный, итог — в платёжке ХТМ. Мы не отвечаем за отказ ХТМ в приёме показаний, перерасчёты и последствия ошибок ввода, но стараемся быстро исправлять найденные проблемы.')),
      sec('Изменения и связь', P('Условия и сервис могут меняться — актуальная редакция всегда здесь. Пользуясь сервисом, вы соглашаетесь с этими условиями и ' + '<a href="#privacy">' + esc(t('lg_privacy').toLowerCase()) + '</a>. Связь — кнопка ' + fb + '.'))
    ] : [
      sec('Що це', P('«Лічильники» — безкоштовний помічник для мешканців Харкова й області: тепло, гаряча й холодна вода, світло й газ; підказує, що натискати на теплолічильнику, читає водоміри з фото, перевіряє цифри за тими самими правилами, що й ХТМ, і підказує, куди й до якого числа їх передати.')),
      sec('Не офіційний сервіс ХТМ', P('Сервіс не належить КП «Харківські теплові мережі» й не діє від їхнього імені. Передаєте показання ви самі — у кабінеті ХТМ, їхньому боті чи телефоном. Рішення про прийняття показань і нарахування ухвалює лише ХТМ.')),
      sec('Ваша відповідальність', UL(['Звіряйте числа з лічильником перед відправленням — розпізнавання фото й підказки можуть помилятися.', 'Передавайте показання в строки ХТМ (з 5 по 25 число).', 'Не завантажуйте чужі документи й фото, на які не маєте прав.'])),
      sec('Без гарантій', P('Сервіс надається «як є». Розрахунок вартості — орієнтовний, підсумок — у платіжці ХТМ. Ми не відповідаємо за відмову ХТМ у прийнятті показань, перерахунки й наслідки помилок введення, але намагаємося швидко виправляти знайдені проблеми.')),
      sec('Зміни й зв’язок', P('Умови й сервіс можуть змінюватися — чинна редакція завжди тут. Користуючись сервісом, ви погоджуєтеся з цими умовами та ' + '<a href="#privacy">' + esc(t('lg_privacy').toLowerCase()) + '</a>. Зв’язок — кнопка ' + fb + '.'))
    ]).join('');
  }
  V.privacy = function () { return { screen: 'S20', route: 'privacy', closeTo: 'prefs', html: legalPage('privacy') }; };
  V.terms = function () { return { screen: 'S21', route: 'terms', closeTo: 'prefs', html: legalPage('terms') }; };
  V.help = function () { return { screen: 'S10', route: 'help', html: helpHtml() }; };

  // ---- платёжки к записям истории (тепло h:, вода w:, период без лічильника g:) — фото или PDF, на сервере (Docs, kind=bill)
  var BILLS = { busy: '' };
  function billOwner(ref) {
    var k = ref.slice(0, 1), id = ref.slice(2), one = function (arr) { return (arr || []).filter(function (x) { return x && !x.deleted && x.id === id; })[0]; };
    var rec = k === 'h' ? one(S.readings) : k === 'w' ? one(S.water) : k === 'm' ? one(S.mrecs) : null;
    if (rec) return { list: function () { return (rec.bills || []).slice(); }, set: function (l) { rec.bills = l; rec.updatedAt = Date.now(); save(); } };
    if (k === 'g' && gapById(id)) return { list: function () { return ((gapById(id) || {}).bills || []).slice(); },
      set: function (l) { setGaps(function (gl) { gl.forEach(function (x) { if (x && x.id === id) { x.bills = l; x.updatedAt = Date.now(); } }); }); } };
    return null;
  }
  function billsBox(ref, list, title) {
    if (!window.TEPLO_API) return '';
    var key = 'bills-' + ref.replace(':', '-'), h = '<section class="panel bills" id="' + key + '" data-key="' + key + '" data-ref="' + esc(ref) + '" data-acc="' + (Y().account ? 1 : 0) + '" data-title="' + esc(title) + '"><h2>' + ico('bill', 20) + ' ' + esc(title) + '</h2>';
    if (!Y().account) return h + '<p class="small muted">' + esc(t('bl_login')) + ' <a href="#login">' + esc(t('bl_login_a')) + '</a></p></section>';
    list = (list || []).filter(function (b) { return b && b.id; });
    var busy = BILLS.busy === ref;
    h += '<p class="small muted">' + esc(t('bl_sub')) + '</p>';
    if (list.length) h += '<ul class="docs">' + list.map(function (b, i) {
      var url = window.TEPLO_API + '/docs/file?id=' + b.id, img = b.mime !== 'application/pdf';
      var th = img ? '<span class="doc-th"><img src="' + esc(url) + '" data-gal="b' + esc(ref) + '" alt="' + esc(t('bl_img', { n: i + 1 })) + '" loading="lazy"></span>'
        : '<a class="doc-th" href="' + esc(url) + '" target="_blank" rel="noopener" data-act="bill-open" data-id="' + esc(b.id) + '" aria-label="' + esc(t('mv_open') + ': ' + (b.name || 'PDF')) + '"><span class="pdf">PDF</span></a>';
      return '<li>' + th + '<div class="grow"><b class="bill-name">' + esc(b.name || (img ? t('bl_photo') : 'PDF')) + '</b><div class="small muted">' + esc(b.at ? fmtDate(String(b.at).slice(0, 10), true) + ' · ' : '') + Math.max(1, Math.round((b.bytes || 0) / 1024)) + ' КБ</div></div>' +
        '<button type="button" class="linkbtn" data-act="bill-del" data-ref="' + esc(ref) + '" data-id="' + esc(b.id) + '"' + (busy ? ' disabled' : '') + '>' + esc(t('rec_del')) + '</button></li>';
    }).join('') + '</ul>';
    return h + '<input type="file" id="bill-input" class="sr" tabindex="-1" multiple aria-label="' + esc(t('bl_add')) + '" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf">' +
      '<button type="button" class="btn sec" data-act="bill-add" data-ref="' + esc(ref) + '" data-key="bill-add"' + (busy ? ' disabled' : '') + '>' + ico('plus', 18) + '<span>' + esc(t(list.length ? 'bl_add_more' : 'bl_add')) + '</span></button>' +
      (busy ? '<p class="small muted" role="status">' + SPIN + ' ' + esc(t('mv_uploading')) + '</p>' : '') + '</section>';
  }
  /** Перерисовать только блок платёжек (в форме периода — чтобы не терять несохранённые поля). */
  function billsRefresh(ref) {
    var box = document.getElementById('bills-' + ref.replace(':', '-')), o = billOwner(ref); if (!box || !o) { render(true); return; }
    var tmp = document.createElement('div'); tmp.innerHTML = billsBox(ref, o.list(), box.getAttribute('data-title') || '');
    if (tmp.firstChild) box.parentNode.replaceChild(tmp.firstChild, box);
  }
  /** Запись удалили — её платёжки на сервере больше не нужны. */
  function billsDrop(list) {
    if (!window.TEPLO_API || !Y().account) return;
    (list || []).forEach(function (b) { if (b && b.id) api0('/docs/delete', { method: 'POST', body: JSON.stringify({ id: b.id }) }).catch(function () {}); });
  }
  function billUpload(ref, files) {
    var o = billOwner(ref); if (!o || !files.length) return;
    BILLS.busy = ref; billsRefresh(ref);
    var c = (document.cookie.match(/(?:^|; )ts_csrf=([^;]*)/) || [])[1] || '', done = 0, err = '', chain = Promise.resolve();
    files.slice(0, 8).forEach(function (f) {
      chain = chain.then(function () {
        if (err === 'many') return;
        var isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
        var prep = !isPdf && window.TeploVision ? window.TeploVision.prepare(f) : Promise.resolve(f);
        return prep.then(function (b) {
          var place0 = (Y().account && S.placeId) || 'main', name = String(f.name || '').slice(0, 120);
          return fetch(window.TEPLO_API + '/docs/upload?place=' + encodeURIComponent(place0) + '&kind=bill&name=' + encodeURIComponent(name), { method: 'POST', credentials: 'same-origin', body: b,
            headers: { 'Content-Type': isPdf ? 'application/pdf' : (b.type || f.type || 'application/octet-stream'), 'X-CSRF': c, Accept: 'application/json' } });
        }).then(function (r) {
          if (!r.ok) { err = r.status === 415 ? 'mv_bad_file' : r.status === 413 ? 'mv_too_big' : r.status === 429 ? 'many' : 'err_network'; return; }
          return r.json().then(function (j) {
            var d = j && j.doc, ow = billOwner(ref); if (!d || !ow) return;
            ow.set(ow.list().concat([{ id: d.id, mime: d.mime, name: d.name || '', bytes: d.bytes, at: d.createdAt }])); done++;
          });
        }, function () { err = 'err_network'; });
      });
    });
    chain.then(function () {
      BILLS.busy = ''; billsRefresh(ref);
      if (err) toast(t(err === 'many' ? 'bl_many' : err)); else toast(done > 1 ? t('bl_saved_n', { n: done }) : t('bl_saved'));
    });
  }
  function billAct(act, el, e) {
    var ref = el.getAttribute('data-ref');
    switch (act) {
      case 'bill-add': { var fi = document.getElementById('bill-input'); if (fi) { fi.setAttribute('data-ref', ref); fi.value = ''; fi.click(); } return true; }
      case 'bill-del': {
        if (!confirm(t('bl_del_q'))) return true;
        var o = billOwner(ref), id = el.getAttribute('data-id'); if (!o) return true;
        busy(el);
        api0('/docs/delete', { method: 'POST', body: JSON.stringify({ id: id }) }).then(function (r) {
          if (!r.ok && r.status !== 404) { toast(t('err_network')); billsRefresh(ref); return; }
          o.set(o.list().filter(function (b) { return b && b.id !== id; })); billsRefresh(ref); toast(t('bl_deleted'));
        }, function () { toast(t('err_network')); billsRefresh(ref); });
        return true;
      }
      case 'bill-open': {   // PDF: в Telegram — подписанная ссылка во внешний браузер (там нет нашей cookie); в браузере — как обычная ссылка
        var tw = window.Telegram && window.Telegram.WebApp; if (!tw || !tw.initData || !tw.openLink) return true;
        e.preventDefault();
        fetch(window.TEPLO_API + '/docs/link?id=' + encodeURIComponent(el.getAttribute('data-id')), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
          .then(function (r) { return r.json(); }).then(function (j) { if (j && j.url) tw.openLink(new URL(window.TEPLO_API + '/' + j.url, location.href).href); else toast(t('bl_open_err')); }, function () { toast(t('bl_open_err')); });
        return true;
      }
    }
    return false;
  }
  document.addEventListener('change', function (e) {
    var fi = e.target; if (!fi || fi.id !== 'bill-input' || !fi.files || !fi.files.length) return;
    billUpload(fi.getAttribute('data-ref') || '', Array.prototype.slice.call(fi.files));
  });

  // ---- поверка и документы счётчика (документы — только вошедшим: хранятся на сервере)
  var DOCS = { list: null, loading: false, busy: '' };
  function loadDocs(force) {
    if (!window.TEPLO_API || !Y().account || DOCS.loading || (DOCS.list && !force)) return;
    DOCS.loading = true;
    fetch(window.TEPLO_API + '/docs', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); })
      .then(function (j) { DOCS.loading = false; DOCS.list = (j && j.docs) || []; if (routeName() === 'prefs') safeRender(); }, function () { DOCS.loading = false; });
  }
  function meterPanel() {
    if (!hasHeat()) return '';
    var v = S.meter.verifiedUntil || '', days = v ? R.daysBetween(today(), v) : null;
    var st = v ? (days < 0 ? '<span class="pill bad">' + esc(t('mv_expired')) + '</span>' : days <= 60 ? '<span class="pill warn">' + esc(t('mv_soon', { n: days })) + '</span>' : '<span class="pill ok">' + esc(t('mv_ok')) + '</span>') : '';
    var h = '<div class="panel" id="meter-block" tabindex="-1" data-key="prefs-meter-ver"><h2>' + esc(t('mv_block')) + (places().length > 1 ? ' <span class="muted small">· ' + esc(placeLabel(place())) + '</span>' : '') + '</h2>' +
      '<ul class="list" style="background:var(--c-housing);margin-bottom:16px"><li><div class="grow"><div class="small muted">' + esc(t('p_meter')) + '</div><b>' + esc(modelName(model())) + '</b></div><a href="#meter">' + esc(t('change')) + '</a></li>' +
      '<li><div class="grow"><div class="small muted">' + esc(t('p_base')) + '</div><b>' + (S.baseline ? esc(fmtDate(S.baseline.date, true)) + ', <span class="num">' + esc(R.formatForHtm('energy', S.baseline.energy)) + '</span> Гкал' : '—') + '</b></div><a href="#baseline">' + esc(t('change')) + '</a></li></ul>' +
      '<div class="field" style="max-width:280px"><label for="p-ver">' + esc(t('mv_date')) + '</label><div class="ctl"><input id="p-ver" type="date" value="' + esc(v) + '"></div><div class="help">' + st + ' ' + esc(t('mv_date_sub')) + '</div></div>';
    if (!window.TEPLO_API) return h + '</div>';
    if (!Y().account) return h + '<p class="small muted">' + esc(t('mv_docs_login')) + '</p></div>';
    loadDocs();
    var mine = (DOCS.list || []).filter(function (d) { return d.kind !== 'bill'; }).filter(function (d) { return d.place === S.placeId || (!place(d.place) && S.placeId === (places()[0] || {}).id); });
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
  // ================= квартиры: список, экран квартиры, «додати лічильник», новый водомер =================
  /** Счётчики квартиры одной строкой: «Опалення · Гаряча · Холодна ×2» (без переключения квартиры). */
  function placeKinds(p) {
    var ks = [], wm = ((p.water && p.water.meters) || []).filter(function (m) { return m && !m.deleted && !m.removed; }), em = (p.meters || []).filter(function (m) { return m && !m.deleted && !m.removed && m.kind === 'elec'; }), gm = (p.meters || []).filter(function (m) { return m && !m.deleted && !m.removed && m.kind === 'gas'; });
    if (p.meter && !p.meter.removed) ks.push(t('kv_heat'));
    ['hot', 'cold'].forEach(function (k) { var n = wm.filter(function (m) { return m.kind === k; }).length; if (n) ks.push(t('kv_' + k) + (n > 1 ? ' ×' + n : '')); });
    if (em.length) ks.push(t('kv_elec') + (em.length > 1 ? ' ×' + em.length : ''));
    if (gm.length) ks.push(t('kv_gas') + (gm.length > 1 ? ' ×' + gm.length : ''));
    return ks.length ? ks.join(' · ') : t('pv_none_short');
  }
  /** Список квартир. mode 'go' — нажал → эта квартира и главная (плюс «Налаштувати»); 'prefs' — нажал → экран квартиры. */
  function placeList(mode) {
    return '<ul class="pl-list" data-key="pl-list-' + mode + '">' + places().map(function (p) {
      var cur = p.id === S.placeId && places().length > 1, sub = placeSub(p);
      var inner = '<span class="pl-t"><b>' + esc(placeLabel(p)) + '</b>' + (cur ? '<span class="pill ok">' + esc(t('pl_active')) + '</span>' : '') + '</span>' +
        (sub ? '<span class="small muted">' + esc(sub) + '</span>' : '') + '<span class="small pl-ks">' + esc(placeKinds(p)) + '</span>';
      var main = mode === 'go' ? '<button type="button" class="pl-main" data-act="pl-go" data-id="' + esc(p.id) + '" data-key="pl-go-' + esc(p.id) + '">' + inner + ico('chev', 20) + '</button>'
        : '<a class="pl-main" href="#place-' + esc(p.id) + '" data-key="pl-open-' + esc(p.id) + '">' + inner + ico('chev', 20) + '</a>';
      return '<li class="pl-card" style="--pc:var(--pc-' + placeColor(p) + ')">' + main + (mode === 'go' ? '<a class="pl-set" href="#place-' + esc(p.id) + '" data-key="pl-set-' + esc(p.id) + '">' + ico('prefs', 18) + '<span>' + esc(t('pv_settings')) + '</span></a>' : '') + '</li>';
    }).join('') + '</ul>';
  }
  function placesPanel() {
    return '<div class="panel" data-key="prefs-places"><h2>' + esc(t('pl_title')) + '</h2><p class="small muted">' + esc(t('pl_sub')) + '</p>' + placeList('prefs') +
      '<p style="margin:16px 0 0"><button class="btn sec" data-act="pl-add" data-key="prefs-place-add">' + ico('plus', 18) + '<span>' + esc(t('pl_add')) + '</span></button></p></div>';
  }
  /** Что с каждым счётчиком квартиры (без переключения квартиры): [{kind, title, st, tone, due}] и ближайший срок. */
  function placeStatus(id) {
    return withPlace(id, function () {
      var rows = [];
      if (hasHeat()) { var hs = heatStatus(); rows.push(Object.assign({ kind: 'heat', title: t('kd_heat') }, hs)); }
      ['hot', 'cold'].forEach(function (k) { var n = wmeters(k).length; if (n) rows.push(Object.assign({ kind: k, title: t(KINDS[k].t) + (n > 1 ? ' ×' + n : '') }, waterStatus(k))); });
      ['elec', 'gas'].forEach(function (k) { var n = smeters(k).length; if (n) rows.push(Object.assign({ kind: k, title: t(KINDS[k].t) + (n > 1 ? ' ×' + n : '') }, sStatus(k))); });
      var due = rows.filter(function (r) { return r.due && (r.tone === 'due' || r.tone === 'warn'); }).map(function (r) { return r.due; }).sort()[0] || null;
      return { rows: rows, due: due, allOk: rows.length > 0 && rows.every(function (r) { return r.tone === 'ok' || r.off; }) };
    }) || { rows: [], due: null, allOk: false };
  }
  /** Ближайший срок словами: «до 20.11 — залишилось 3 дн.», «сьогодні останній день». */
  function dueText(d) { var n = R.daysBetween(today(), d); return n <= 0 ? t('ov_due_today', { d: fmtDate(d) }) : t('ov_due', { d: fmtDate(d), n: n }); }
  /** Карточка квартиры на главной-списке: название, адрес, ближайший срок, строка на каждый счётчик со статусом. */
  function placeCard(p) {
    var ps = placeStatus(p.id), sub = placeSub(p), cur = p.id === S.placeId;
    var top = ps.due ? '<span class="ov-next ' + (R.daysBetween(today(), ps.due) <= 3 ? 'warn' : 'due') + '">' + ico('clock', 18) + '<span>' + esc(dueText(ps.due)) + '</span></span>'
      : ps.allOk ? '<span class="ov-next ok">' + ico('check', 18) + '<span>' + esc(t('ov_all_ok')) + '</span></span>' : '';
    var rows = ps.rows.length ? '<span class="ov-rows">' + ps.rows.map(function (r) {
      return '<span class="ov-row" data-key="ov-' + esc(p.id) + '-' + r.kind + '">' + ico(KINDS[r.kind].icon, 20, KINDS[r.kind].cls) + '<span class="ov-k">' + esc(r.title) + '</span><span class="ov-st ' + (r.tone || '') + '">' + esc(r.st) + '</span></span>';
    }).join('') + '</span>' : '<span class="small muted">' + esc(t('ov_none')) + '</span>';
    return '<li class="pl-card ov-card" style="--pc:var(--pc-' + placeColor(p) + ')" data-key="ov-' + esc(p.id) + '">' +
      '<button type="button" class="pl-main" data-act="pl-go" data-id="' + esc(p.id) + '" data-key="pl-go-' + esc(p.id) + '" aria-label="' + esc(t('ov_open', { p: placeLabel(p) })) + '">' +
        '<span class="pl-t"><b>' + esc(placeLabel(p)) + '</b>' + (cur ? '<span class="pill neutral">' + esc(t('ov_cur')) + '</span>' : '') + '</span>' +
        (sub ? '<span class="small muted">' + esc(sub) + '</span>' : '') + top + rows + ico('chev', 22) + '</button>' +
      '<a class="pl-set" href="#place-' + esc(p.id) + '" data-key="pl-set-' + esc(p.id) + '">' + ico('prefs', 18) + '<span>' + esc(t('pv_settings')) + '</span></a></li>';
  }
  /** Главная при двух и больше квартирах (и «Усі квартири»): список карточек квартир. */
  /** Старый адрес «Усі квартири» — теперь это главная (аккордеон квартир). */
  V.places = function () { return V.home(); };
  /** Строка счётчика на экране квартиры: открыть · замінити · прибрати. */
  function mrow(o) {
    return '<li class="mrow" data-key="pv-m-' + esc(o.what) + '"><a class="mrow-main" href="#' + o.href + '">' + ico(KINDS[o.kind].icon, 22, KINDS[o.kind].cls) + '<span class="grow"><b>' + esc(o.title) + '</b>' + (o.sub ? '<span class="small muted">' + esc(o.sub) + '</span>' : '') + '</span>' + ico('chev', 20) + '</a>' +
      '<div class="mrow-act">' + (o.noReplace ? '' : '<button type="button" class="btn ter sm" data-act="m-replace" data-what="' + esc(o.what) + '" data-key="pv-replace-' + esc(o.what) + '">' + ico('wrench', 18) + '<span>' + esc(t('mr_replace')) + '</span></button>') +
      '<button type="button" class="btn ter sm quiet-bad" data-act="m-remove" data-what="' + esc(o.what) + '" data-key="pv-remove-' + esc(o.what) + '">' + ico('close', 18) + '<span>' + esc(t('mr_remove')) + '</span></button></div>' +
      (o.set ? '<details class="mbox-set mrow-set" id="mbs-' + esc(o.what) + '"' + (MB_OPEN[o.what] ? ' open' : '') + ' data-key="pv-set-' + esc(o.what) + '"><summary>' + ico('prefs', 18) + '<span>' + esc(t('mb_set')) + '</span>' + ico('chev', 18, 'pacc-chev') + '</summary><div class="mbox-set-b">' + o.set + '</div></details>' : '') + '</li>';
  }
  function verTxt(v) { return v ? t('pl_ver', { d: R.toHtmDate(v) }) : ''; }
  // ---------- постачальники й тарифи за адресою квартири (GET /api/providers, довідник app/data/providers.json) ----------
  // p.prov[k] = { ok: 1 } — людина підтвердила, що так і є; { name, supply, drain, price, at } — її дані з платіжки (k: elec, gas, water, heat).
  var PRV = { addr: {}, edit: {} };
  /** Уточнений людиною пункт (Миколаївок у області 17) — лише для тієї адреси, при якій його обрали. */
  function prvSettle(p) { var a = String((p && p.address) || '').trim(), st = p && p.settle; return st && st.a === a && st.n && st.h ? st : null; }
  /** Довідник для квартири: адреса (+ уточнений пункт). a — адреса рядком (старий виклик) або квартира. */
  function prvLoad(pa) {
    var p = typeof pa === 'string' ? null : pa, a = String(p ? p.address || '' : pa || '').trim(); if (!a || !window.TEPLO_API) return null;
    var st = prvSettle(p), key = a + (st ? '|' + st.n + '|' + st.h : ''); if (PRV.addr[key]) return PRV.addr[key];
    PRV.addr[key] = { busy: true };
    fetch(window.TEPLO_API + '/providers?q=' + encodeURIComponent(a) + (st ? '&n=' + encodeURIComponent(st.n) + '&h=' + encodeURIComponent(st.h) : ''), { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); })
      .then(function (j) { PRV.addr[key] = j && typeof j.found === 'boolean' ? j : { err: true }; safeRender(); }, function () { PRV.addr[key] = { err: true }; safeRender(); });
    return PRV.addr[key];
  }
  /** Довідник поточної квартири по видах (або null): для «Куди передати», «Ціни». Без адреси — null (як і було: Харків за замовчуванням). */
  function prvKinds0(p) { p = p || place(); var j = p && String(p.address || '').trim() ? prvLoad(p) : null; return j && j.found && j.kinds ? j : null; }
  /** Текст довідника мовою інтерфейсу: note_ru / how_ru …, якщо є. */
  function ploc(d, f) { return d ? (S.lang === 'ru' && d[f + '_ru']) || d[f] || '' : ''; }
  function kindWord(c) { return t('pk_' + (c === 'M' ? 'm' : c === 'X' ? 'x' : 'c')); }
  function placeWhere(pl) { return t('prv_where', { k: kindWord(pl.kind), h: pl.hromada, d: pl.district }); }
  /** Постачальник виду (elec|gas|water|heat) поточної квартири з довідника; null — адреси немає (як і було — Харків) чи ще вантажиться. */
  function prvOf(k) { var j = prvKinds0(); return j ? Object.assign({ _place: j.place }, j.kinds[k] || {}) : null; }
  function wherePlaceLine() {
    return places().length > 1 ? '<p class="dest-place" style="--pc:var(--pc-' + placeColor(place()) + ')" data-key="where-place"><b>' + esc(t('wd_for', { p: placeLabel(place()) })) + '</b>' + (placeSub(place()) ? '<span class="small muted"> · ' + esc(placeSub(place())) + '</span>' : '') + '</p>' : '';
  }
  /** «Куди передати» для води чи тепла поза Харковом: хто (з довідника чи з платіжки людини), як і коли, сайт/бот/кабінет, телефони, куди платити.
   *  Постачальника не знайшли — чесно: «впишіть з платіжки» з переходом у «Постачальники й тарифи». */
  function localDest(k, d, vals, mark, sent) {
    var p = place() || {}, own = (p.prov || {})[k] || {}, org = own.name || d.org || '', pl = d._place || {};
    var how = ploc(d, 'how'), pay = ploc(d, 'pay'), phones = (d.phones || []).slice();
    if (own.phone) phones.unshift([String(own.phone).replace(/[^\d+]/g, ''), own.phone, t('ld_own_phone')]);
    var chans = [];
    if (d.cab) chans.push([d.cab, t('ld_cab'), 'ext', 'cab']);
    if (d.bot) chans.push([d.bot, t('wd_bot', { b: '@' + String(d.bot).replace(/^.*t\.me\//, '') }), 'send', 'bot']);
    if (d.site) chans.push([d.site, t('ld_site'), 'ext', 'site']);
    var body = vals || '';
    if (!org) body += '<p data-key="ld-unk">' + esc(t('ld_unk_' + k, { c: pl.name || '' })) + '</p><p><a class="btn sec" href="#place-' + esc(p.id || '') + '" data-act="prv-go" data-key="ld-fill">' + ico('edit', 18) + '<span>' + esc(t('prv_fill')) + '</span></a></p>';
    else body += '<p class="small" data-key="ld-how">' + esc(how || t('ld_how_unk')) + '</p>';
    var more = (phones.length ? '<p class="dm-t">' + esc(t('ld_call')) + '</p><ul class="dm-ph">' + phones.map(function (x) { return '<li>' + telLink(x[0], x[1]) + (x[2] ? '<span class="muted">' + esc(x[2]) + '</span>' : '') + '</li>'; }).join('') + '</ul>' : '') +
      (pay ? '<p class="dm-t">' + esc(t('ld_pay_t')) + '</p><p>' + esc(pay) + '</p>' : '');
    return destBox({ key: 'loc-' + k, org: org || t('ld_org_' + k), what: t('ld_what_' + k), sent: sent, body: body, chans: chans, more: more, mark: org ? mark : '' });
  }
  /** Тариф води квартири: свій з платіжки (p.prov.water) — главніше за загальний (wtar()). */
  function wtar() {
    var p = place() || {}, w = (p.prov && p.prov.water) || {}, d = prvOf('water'), base = S.wtariff;
    // квартира не в Харкові: тариф її водоканалу з довідника (якщо відомий) — замість харківського
    if (d && d.via !== 'hvk' && R.num(d.supply) > 0) base = Object.assign({}, S.wtariff || {}, { supply: R.num(d.supply) }, R.num(d.drain) > 0 ? { drain: R.num(d.drain) } : {});
    if (!(R.num(w.supply) > 0)) return R.num(w.hot) > 0 ? Object.assign({}, base || {}, { hot: R.num(w.hot) }) : base;
    return Object.assign({}, base || {}, { supply: R.num(w.supply), drain: R.num(w.drain) > 0 ? R.num(w.drain) : 0 }, R.num(w.hot) > 0 ? { hot: R.num(w.hot) } : {});
  }
  function prvKinds() { var k = []; if (hasHeat()) k.push('heat'); if (wmeters().length) k.push('water'); if (emeters().length) k.push('elec'); if (smeters('gas').length) k.push('gas'); return k; }
  var PRV_ICO = { elec: ['bolt', 'c-elec'], gas: ['flame', 'c-gas'], water: ['drop', 'c-cold'], heat: ['thermo', 'c-hot'] };
  function prvRow(p, k, d, nat) {
    var my = (p.prov || {})[k] || {}, own = !!(my.name || my.supply || my.price), ed = PRV.edit[k], org = my.name || (d && d.org) || '';
    var lines = [], price = '';
    if (k === 'heat') {
      // гроші за тепло застосунок рахує завжди: за тарифом квартири (з платіжки), а якщо його немає — за тарифом із довідника або ХТМ
      var hp = R.num(my.price), dp = d && R.num(d.price), used = tariff();
      if (hp || dp) price = t(bill().abon > 0 ? 'prv_p_heat' : 'prv_p_heat1', { p: money(used), a: money(bill().abon) }) + (hp ? ' ' + t('prv_from_bill') : '');
      else lines.push(t('prv_heat_calc', { p: money(used) }));
    }
    if (k === 'elec') { if (d && d.net) lines.push(t('prv_net', { n: d.net })); if (nat.elec) price = t('prv_p_elec', { p: money(nat.elec.price), d: fmtDate(nat.elec.to, true) }); }
    if (k === 'gas') {
      if (my.price) price = t('prv_p_own', { p: money(R.num(my.price)) });
      else if (nat.gas) price = t('prv_p_gas', { p: money(nat.gas.price), n: nat.gas.plan, d: fmtDate(nat.gas.to, true) });
      if (d && d.grm) lines.push(t('prv_grm', { g: d.grm, p: String(d.dist).replace('.', ',') }));
    }
    if (k === 'water') {
      var s = R.num(my.supply) || (d && d.supply), dr = my.supply ? R.num(my.drain) : d && d.drain;
      price = s ? (dr ? t('prv_p_water', { s: money(s), d: money(dr) }) : t('prv_p_water1', { s: money(s) })) + (my.supply ? ' ' + t('prv_from_bill') : d && d.from ? ' ' + t('prv_since', { d: fmtDate(d.from, true) }) : '') : '';
    }
    // наступний затверджений тариф (Харківводоканал з 01.01.2027): «З 01.01.2027 — 57,50 грн за м³ води і 27,99 грн водовідведення»
    var nx = d && d.next && String(d.next.from || '') > today() ? d.next : null, nxt = '';
    if (nx && k === 'water' && !my.supply && R.num(nx.supply) > 0) nxt = t(R.num(nx.drain) > 0 ? 'prv_next' : 'prv_next1', { d: fmtDate(nx.from, true), s: money(R.num(nx.supply)), dr: money(R.num(nx.drain)) });
    if (nx && k === 'heat' && !R.num(my.price) && R.num(nx.price) > 0) nxt = t('prv_next_heat', { d: fmtDate(nx.from, true), p: money(R.num(nx.price)) });
    var src = k === 'elec' ? ploc(nat.elec, 'src') : k === 'gas' ? [!my.price && nat.gas ? ploc(nat.gas, 'src') : '', ploc(d, 'distSrc')].filter(Boolean).join('. ') : ploc(d, 'src');
    var need = (d && d.check && !my.ok && !own) || !org || (k === 'water' && !price);
    var h = '<div class="prov-row' + (need ? ' need' : '') + '" data-key="prov-' + k + '"><span class="pst-ico ' + PRV_ICO[k][1] + '">' + ico(PRV_ICO[k][0], 20) + '</span><div class="prov-b">' +
      '<p class="prov-k"><b>' + esc(t('prv_k_' + k)) + '</b>' + (my.ok || own ? '<span class="prov-ok">' + ico('check', 16) + esc(t(own ? 'prv_own' : 'prv_ok')) + '</span>' : '') + '</p>' +
      '<p class="prov-org">' + (org ? esc(org) : '<span class="muted">' + esc(t('prv_org_none')) + '</span>') + '</p>' +
      lines.map(function (x) { return '<p class="small muted">' + esc(x) + '</p>'; }).join('') +
      '<p class="prov-price' + (price ? '' : ' none') + '">' + esc(price || t('prv_p_none')) + '</p>' +
      (nxt ? '<p class="small muted" data-key="prov-next-' + k + '">' + esc(nxt) + '</p>' : '') +
      (src && !own ? '<details class="prov-src"><summary>' + esc(t('prv_src')) + '</summary><p class="small muted">' + esc(src) + '</p></details>' : '') +
      ((need || !(my.ok || own)) && d && d.note && !ed ? '<p class="small prov-note">' + esc(ploc(d, 'note')) + '</p>' : '') +
      (d && ploc(d, 'pay') && !ed ? '<p class="small prov-pay" data-key="prov-pay-' + k + '"><b>' + esc(t('ld_pay_t')) + '</b> ' + esc(ploc(d, 'pay')) + '</p>' : '');
    if (ed) {
      h += '<div class="prov-form" data-key="prov-form-' + k + '"><div class="field"><label for="prv-n-' + k + '">' + esc(t('prv_name')) + '</label><div class="ctl"><input id="prv-n-' + k + '" maxlength="80" value="' + esc(my.name || (d && d.org) || '') + '"></div></div>' +
        // телефон постачальника з платіжки — для «Куди передати», коли в довіднику його немає
        (k === 'water' || k === 'heat' ? '<div class="field" style="max-width:320px"><label for="prv-p-' + k + '">' + esc(t('prv_phone')) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></label><div class="ctl"><input id="prv-p-' + k + '" inputmode="tel" autocomplete="off" maxlength="30" value="' + esc(my.phone || '') + '"></div></div>' : '') +
        (k === 'water' ? '<div class="grid2"><div class="field"><label for="prv-s">' + esc(t('prv_supply')) + '</label><div class="ctl"><input id="prv-s" class="num" inputmode="decimal" value="' + esc(my.supply ? String(my.supply).replace('.', ',') : '') + '"><span class="unit">грн</span></div></div>' +
          '<div class="field"><label for="prv-d">' + esc(t('prv_drain')) + '</label><div class="ctl"><input id="prv-d" class="num" inputmode="decimal" value="' + esc(my.drain ? String(my.drain).replace('.', ',') : '') + '"><span class="unit">грн</span></div></div></div>' : '') +
        (k === 'heat' ? '<div class="grid2"><div class="field"><label for="prv-h">' + esc(t('prv_heatp')) + '</label><div class="ctl"><input id="prv-h" class="num" inputmode="decimal" value="' + esc(money(tariff())) + '"><span class="unit">грн</span></div></div>' +
          '<div class="field"><label for="prv-a">' + esc(t('p_abon_l')) + '</label><div class="ctl"><input id="prv-a" class="num" inputmode="decimal" value="' + esc(money(bill().abon)) + '"><span class="unit">грн</span></div></div></div>' : '') +
        (k === 'gas' ? '<div class="field" style="max-width:260px"><label for="prv-g">' + esc(t('prv_gasp')) + '</label><div class="ctl"><input id="prv-g" class="num" inputmode="decimal" value="' + esc(my.price ? String(my.price).replace('.', ',') : '') + '" placeholder="' + esc(nat.gas ? money(nat.gas.price) : '') + '"><span class="unit">грн</span></div></div>' : '') +
        '<div class="row-actions"><button type="button" class="btn sec" data-act="prv-cancel" data-k="' + k + '">' + esc(t('cancel')) + '</button><button type="button" class="btn" data-act="prv-save" data-k="' + k + '" data-key="prov-save-' + k + '">' + esc(t('save')) + '</button></div></div>';
    } else if (need && org && !(k === 'water' && !price)) {
      h += '<p class="prov-act"><button type="button" class="btn sec sm" data-act="prv-yes" data-k="' + k + '" data-key="prov-yes-' + k + '">' + ico('check', 18) + '<span>' + esc(t('prv_yes')) + '</span></button>' +
        '<button type="button" class="btn ter sm" data-act="prv-other" data-k="' + k + '" data-key="prov-other-' + k + '">' + ico('edit', 18) + '<span>' + esc(t('prv_other')) + '</span></button></p>';
    } else {
      h += '<p class="prov-act"><button type="button" class="btn ' + (need ? 'sec' : 'ter') + ' sm" data-act="prv-other" data-k="' + k + '" data-key="prov-other-' + k + '">' + ico('edit', 18) + '<span>' + esc(t(need ? 'prv_fill' : 'prv_change')) + '</span></button></p>';
    }
    return h + '</div></div>';
  }
  /** Блок «Постачальники й тарифи» на екрані квартири — лише для видів, що є в квартирі. */
  function provPanel(p) {
    var ks = prvKinds(); if (!ks.length) return '';
    var a = String(p.address || '').trim(), h = '<section class="panel prov" id="prov" data-key="pv-prov"><h2>' + esc(t('prv_title')) + '</h2>';
    if (!a) return h + '<p class="small muted" data-key="prov-noaddr">' + esc(t('prv_noaddr')) + '</p></section>';
    var j = prvLoad(p);
    if (!j || j.busy) return h + '<p class="small muted" data-key="prov-loading">' + esc(t('prv_loading')) + '</p></section>';
    var nat = (j && j.national) || {}, pl = j.found ? j.place : null;
    var pick = function (x) { return '<li><button type="button" class="prv-pick" data-act="prv-settle" data-k="place" data-n="' + esc(x.n) + '" data-h="' + esc(x.h) + '" data-key="prov-pick-' + esc(x.h) + '">' +
      '<b>' + esc(x.name) + '</b><span class="small muted">' + esc(placeWhere(x)) + '</span></button></li>'; };
    if (j.candidates && j.candidates.length) {
      // кілька пунктів з такою назвою (чи схожих) — людина обирає свій: крупні рядки, без випадного списку
      h += '<p data-key="prov-lead"><b>' + esc(t(j.reason === 'typo' ? 'prv_ask_typo' : 'prv_ask', { a: a })) + '</b></p><ul class="prv-picks" data-key="prov-picks">' + j.candidates.map(pick).join('') + '</ul>' +
        '<p class="small muted">' + esc(t('prv_ask_none')) + '</p>';
      return h + ks.map(function (k) { return prvRow(p, k, null, nat); }).join('') + '</section>';
    }
    var lead = pl ? t('prv_lead', { c: pl.name, h: pl.hromada, d: pl.district }) + (j.how === 'default' ? ' ' + t('prv_kh_default') : '') : j.err ? t('prv_err') : t('prv_nf', { a: a });
    if (pl && j.how === 'typo') lead = t('prv_typo', { c: pl.name, w: placeWhere(pl) });
    h += '<p class="small muted" data-key="prov-lead">' + esc(lead) + '</p>';
    // уточнений пункт — можна змінити; знайшли місто, а є й села з такою назвою — «Не той?»
    if (pl && j.how === 'settled') h += '<p class="small"><button type="button" class="linkbtn" data-act="prv-unsettle" data-k="place" data-key="prov-unsettle">' + esc(t('prv_unsettle')) + '</button></p>';
    else if (pl && j.alts && j.alts.length) h += '<details class="prov-alts tips-box" data-key="prov-alts"><summary>' + esc(t('prv_alts', { c: pl.name })) + '</summary><ul class="prv-picks">' + j.alts.map(pick).join('') + '</ul></details>';
    return h + ks.map(function (k) { return prvRow(p, k, j.found ? j.kinds[k] : null, nat); }).join('') + '</section>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-act^="prv-"]'); if (!b) return;
    if (b.getAttribute('data-act') === 'prv-go') { SCROLL_TO = 'prov'; return; }   // посилання на екран квартири — далі за href
    var k = b.getAttribute('data-k'), p = place(), act = b.getAttribute('data-act'); if (!p || !k) return;
    p.prov = p.prov || {};
    if (act === 'prv-settle') { p.settle = { a: String(p.address || '').trim(), n: b.getAttribute('data-n'), h: b.getAttribute('data-h') }; p.updatedAt = Date.now(); WX.key = ''; save(); toast(t('prv_settled', { c: p.settle.n })); }
    else if (act === 'prv-unsettle') { delete p.settle; p.updatedAt = Date.now(); WX.key = ''; save(); }
    else if (act === 'prv-yes') { p.prov[k] = { ok: 1, at: today() }; p.updatedAt = Date.now(); save(); toast(t('prv_saved')); }
    else if (act === 'prv-other') PRV.edit[k] = true;
    else if (act === 'prv-cancel') delete PRV.edit[k];
    else if (act === 'prv-save') {
      var v = function (id) { var el = document.getElementById(id); return el ? String(el.value).trim() : ''; };
      var o = { name: v('prv-n-' + k).slice(0, 80), at: today() };
      if ((k === 'water' || k === 'heat') && /\d{5,}/.test(v('prv-p-' + k).replace(/\D/g, ''))) o.phone = v('prv-p-' + k).slice(0, 30);
      if (k === 'water') { var s = R.num(v('prv-s')), dr = R.num(v('prv-d')); if (s > 0 && s < 1000) o.supply = s; if (dr > 0 && dr < 1000) o.drain = dr; }
      if (k === 'gas') { var g = R.num(v('prv-g')); if (g > 0 && g < 100) { o.price = g; p.gasPrice = g; } }
      if (k === 'heat') { var hv = R.num(v('prv-h').replace(/\s/g, '')), av = R.num(v('prv-a').replace(/\s/g, ''));
        if (hv > 0 && hv < 100000) o.price = hv;
        if (av !== null && av >= 0 && av < 10000) p.bill = Object.assign({}, p.bill || {}, { abon: av }); }
      p.prov[k] = o; delete PRV.edit[k]; p.updatedAt = Date.now(); WX.key = ''; save(); toast(t('prv_saved'));
    } else return;
    SCROLL_TO = 'prov'; render(true);
  });
  /** Экран квартиры: её счётчики, название/адрес/цвет, свои рахунки; удалить. Открыть экран = перейти в эту квартиру. */
  function placeView(id) {
    var p = place(id);
    if (!p) return { screen: 'S42', route: 'places', html: '<h1>' + esc(t('pl_title')) + '</h1><p class="muted">' + esc(t('rec_gone')) + '</p><a class="btn" href="#places">' + esc(t('back')) + '</a>' };
    if (id !== S.placeId) { switchPlace(id); WX.key = ''; p = place(); }
    var many = places().length > 1, ms = wmeters(), sub = placeSub(p), fresh = !p.name && !p.address && !hasHeat() && !ms.length && !pmeters().length;
    // сюда приходят с главной (плитка «Налаштування квартири») — туда и назад
    var h = '<p><a href="#' + (many ? 'places' : 'home') + '" data-key="pv-back">← ' + esc(t(many ? 'pv_back_all' : 'nav_home')) + '</a></p>' +
      '<h1 class="pv-h" style="--pc:var(--pc-' + placeColor(p) + ')"><span class="pv-dot" aria-hidden="true"></span><span>' + esc(placeLabel(p)) + (sub ? '<span class="small muted pv-sub">' + esc(sub) + '</span>' : '') + '</span></h1>';
    if (fresh) h += '<div class="banner" data-key="pv-new">' + ico('info', 22) + '<div><p><b>' + esc(t('pv_new_t')) + '</b></p><p>' + esc(t('pv_new')) + '</p></div></div>';
    // лічильники
    var rows = [];
    if (hasHeat()) rows.push(mrow({ what: 'heat', kind: 'heat', title: t('kd_heat'), href: 'heat', sub: [modelName(model()), verTxt(S.meter.verifiedUntil)].filter(Boolean).join(' · '), set: heatMeterFields(model()) + gapSetLink('heat') }));
    ms.forEach(function (m) { rows.push(mrow({ what: m.id, kind: m.kind, title: wkindTitle(m.kind) + (m.name ? ' · ' + m.name : ''), href: 'water-' + m.kind, sub: verTxt(m.verifiedUntil), set: wmeterFields(m, false) + gapSetLink(m.id) })); });
    ['elec', 'gas'].forEach(function (k) { smeters(k).forEach(function (m) { rows.push(mrow({ what: m.id, kind: k, title: ename(m), href: SK[k].page, noReplace: true, sub: ezonesTxt(m), set: smeterFields(k, m) })); }); });
    h += '<section class="panel" data-key="pv-meters"><h2>' + esc(t('pv_meters')) + '</h2>' + (rows.length ? '<ul class="mlist">' + rows.join('') + '</ul>' : '<p class="muted">' + esc(t('pv_none')) + '</p>') +
      '<p style="margin:12px 0 0"><button class="btn' + (rows.length ? ' sec' : '') + '" data-act="add-meter" data-back="place-' + esc(p.id) + '" data-key="pv-add-meter">' + ico('plus', 20) + '<span>' + esc(t('am_tile')) + '</span></button></p>';
    var rm = removedMeters();
    if (rm.length) h += '<h3 style="margin-top:20px">' + esc(t('am_restore_t')) + '</h3><ul class="mlist removed">' + rm.map(function (x) {
      return '<li class="mrow" data-key="pv-rm-' + esc(x.what) + '"><div class="mrow-main">' + ico(KINDS[x.kind].icon, 22, KINDS[x.kind].cls) + '<span class="grow"><b>' + esc(x.title) + '</b><span class="small muted">' + esc(t('am_removed_on', { d: fmtDate(x.at, true) })) + '</span></span>' +
        '<button type="button" class="btn sec" data-act="m-restore" data-what="' + esc(x.what) + '" data-key="pv-restore-' + esc(x.what) + '">' + esc(t('am_restore')) + '</button></div></li>';
    }).join('') + '</ul>';
    h += '</section>';
    h += provPanel(p);
    // про квартиру
    var chips = t('pv_chips').split('|').map(function (c) { return '<button type="button" class="chip" data-act="pv-chip" data-v="' + esc(c) + '" aria-pressed="' + (p.name === c) + '">' + esc(c) + '</button>'; }).join('');
    var sw = PCOLORS.map(function (c) { return '<label class="swatch" style="--pc:var(--pc-' + c + ')"><input type="radio" name="pv-color" value="' + c + '"' + (placeColor(p) === c ? ' checked' : '') + '><span class="sw-dot" aria-hidden="true">' + ico('check', 20) + '</span><span class="sr">' + esc(t('pc_' + c)) + '</span></label>'; }).join('');
    h += '<section class="panel" data-key="pv-about"><h2>' + esc(t('pv_about')) + '</h2>' +
      '<div class="field"><label for="pv-name">' + esc(t('pv_name')) + '</label><div class="ctl"><input id="pv-name" data-plf="name" maxlength="40" autocomplete="off" value="' + esc(p.name || '') + '" placeholder="' + esc(t('pv_name_ph')) + '"></div><div class="chips" role="group" aria-label="' + esc(t('pv_name')) + '">' + chips + '</div></div>' +
      '<div class="field"><label for="pv-addr">' + esc(t('pl_addr')) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></label><div class="ctl"><input id="pv-addr" data-plf="address" maxlength="120" autocomplete="street-address" value="' + esc(p.address || '') + '" placeholder="' + esc(t('pl_addr_ph')) + '"></div></div>' +
      '<fieldset class="field"><legend class="lbl">' + esc(t('pv_color')) + '</legend><div class="swatches">' + sw + '</div><div class="small muted">' + esc(t('pv_color_h')) + '</div></fieldset></section>';
    // графік відключень — на сторінці світла; у квартири без електролічильника — тут
    if (!emeters().length) h += gpvBox(p, 'place');
    // свои рахунки
    var money = '';
    if (hasHeat()) money += '<h3>' + esc(t('pv_m_heat')) + '</h3><div class="grid2">' +
      '<div class="field"><label for="p-area">' + esc(t('nm_area')) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></label><div class="ctl"><input id="p-area" class="num" inputmode="decimal" autocomplete="off" value="' + esc(p.area ? String(p.area).replace('.', ',') : '') + '"><span class="unit">м²</span></div></div>' +
      '<div class="field"><label for="p-abon">' + esc(t('p_abon_l')) + '</label><div class="ctl"><input id="p-abon" class="num" inputmode="decimal" value="' + esc(bill().abon.toFixed(2).replace('.', ',')) + '"></div></div>' +
      '<div class="field"><label for="p-mzk">' + esc(t('p_mzk_l')) + '</label><div class="ctl"><input id="p-mzk" class="num" inputmode="decimal" placeholder="0,01262" value="' + esc(bill().mzk ? String(bill().mzk).replace('.', ',') : '') + '"></div><div class="small muted">' + esc(t('p_mzk_h')) + '</div></div></div>';
    if (ms.length) money += '<h3>' + esc(t('pv_m_water')) + '</h3>' + waccForm() +
      '<div class="field" style="max-width:260px"><label for="p-persons">' + esc(t('nm_persons')) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></label><div class="ctl"><input id="p-persons" class="num" inputmode="numeric" autocomplete="off" data-nm="persons" value="' + esc(wcfg().persons || '') + '"></div><div class="small muted">' + esc(t('pv_persons_h')) + '</div></div>';
    if (emeters().length) money += '<h3>' + esc(t('pv_m_elec')) + '</h3>' + eheatRow();
    if (smeters('gas').length) money += '<h3>' + esc(t('pv_m_gas')) + '</h3>' + sheatRow('gas');
    h += '<section class="panel" data-key="pv-money"><h2>' + esc(t('pv_money')) + '</h2><p class="small muted">' + esc(t('pv_money_s')) + '</p>' + (money || '<p class="muted">' + esc(t('pv_money_none')) + '</p>') + '</section>';
    if (many && window.TEPLO_API) h += '<section class="panel" data-key="pv-remind"><h2>' + esc(t('pv_remind')) + '</h2>' +
      '<label class="check-row"><input type="checkbox" id="pv-remind"' + (p.remindOff ? '' : ' checked') + (S.remind && S.remind.off ? ' disabled' : '') + '><span>' + esc(t('pv_remind_l')) + '</span></label>' +
      '<p class="small muted" style="margin-top:8px">' + esc(t(S.remind && S.remind.off ? 'pv_remind_all_off' : 'pv_remind_h')) + '</p></section>';
    if (many) h += '<section class="panel" data-key="pv-danger"><button class="btn danger" data-act="pl-del-ask" data-id="' + esc(p.id) + '" data-key="pv-del">' + esc(t('pv_del')) + '</button><div id="pl-del-confirm"></div></section>';
    return { screen: 'S42', route: 'place', html: h };
  }

  // ================= мастер «Додати квартиру»: 1) назва й адреса 2) які лічильники є 3) рахунок Водоканалу =================
  // Пенсионерам: шаги пронумерованы, крупные +/−, на последнем шаге — «Перевірте» с повтором сути. Потом — настройка каждого
  // счётчика по очереди (PQ): водомеры по одному (#wadd), теплосчётчик — последним (#meter, дальше обычный путь).
  // Первый вход (#start, PW.first) — тот же мастер для первой квартиры «Моя квартира», без шага названия:
  // 1) які лічильники є (табло-образцы, +/−) 2) рахунок Водоканалу — только если есть водомеры; назва й адреса — потом на главной.
  function pwFresh(back, first) { return { step: 0, first: !!first, name: '', address: '', n: { heat: 0, hot: 0, cold: 0, elec: 0, gas: 0 }, account: '', surname: '', back: back || 'places', err: '' }; }
  var PW = pwFresh(), PQ = null;
  function pwSteps() { var w = PW.n.hot + PW.n.cold > 0; return PW.first ? (w ? 2 : 1) : (w ? 3 : 2); }
  function pwKind(i) { return (PW.first ? ['kinds', 'acc'] : ['name', 'kinds', 'acc'])[i]; }
  function pwAny() { return KIND_ORDER.some(function (k) { return PW.n[k] > 0; }); }
  function pwRead() {
    var v = function (id) { var el = document.getElementById(id); return el ? String(el.value || '') : null; };
    var a = v('aw-name'), b = v('aw-addr'), c = v('aw-acc'), d = v('aw-sn');
    if (a !== null) PW.name = a.slice(0, 40); if (b !== null) PW.address = b.slice(0, 120); if (c !== null) PW.account = c.trim(); if (d !== null) PW.surname = d.trim();
  }
  function pwMetersText() {
    var a = KIND_ORDER.filter(function (k) { return PW.n[k]; }).map(function (k) { return t(KINDS[k].t) + (PW.n[k] > 1 ? ' ×' + PW.n[k] : ''); });
    return a.length ? a.join(' · ') : t('aw_sum_none');
  }
  /** «Перевірте» — повтор сути перед созданием. */
  function pwSummary() {
    var nm = PW.first ? placeLabel(place()) : PW.name.trim() || t('pl_unnamed', { n: places().length + 1 }), water = PW.n.hot + PW.n.cold > 0;
    var sub = PW.first ? t('fs_sum_hint') : PW.address.trim();
    return '<section class="panel aw-sum" style="--pc:var(--pc-' + (PW.first ? placeColor(place()) : nextColor()) + ')" data-key="aw-sum"><h2>' + esc(t(PW.first ? 'fs_sum' : 'aw_sum')) + '</h2><dl>' +
      '<dt>' + esc(t('aw_sum_name')) + '</dt><dd><b>' + esc(nm) + '</b>' + (sub ? '<span class="small muted"> · ' + esc(sub) + '</span>' : '') + '</dd>' +
      '<dt>' + esc(t('aw_sum_meters')) + '</dt><dd>' + esc(pwMetersText()) + '</dd>' +
      (water ? '<dt>' + esc(t('aw_sum_acc')) + '</dt><dd id="aw-sum-acc">' + esc(PW.account || t('aw_sum_noacc')) + '</dd>' : '') + '</dl></section>';
  }
  /** Табло-образец вида (узнать свой счётчик по виду): тепло — зелёный ЖК, вода — циферблат, світло — тёмный экран, газ — жёлтая панель. */
  function kindPreview(k) {
    if (k === 'heat') return lcd([{ text: '12.910', tag: 'Gcal' }]);
    if (k === 'elec') return elcd([{ text: '10420' }]);
    return wdrum(k === 'gas' ? '1225.4' : k === 'hot' ? '175' : '437', k);
  }
  /** Строки «какие счётчики есть»: образец табло, название, кому передавать, +/−. «+» тёмный, пока счётчика нет. */
  function awKinds() {
    return '<div class="aw-kinds" data-key="aw-kinds">' + KIND_ORDER.map(function (k) {
      var K = KINDS[k], c = PW.n[k] || 0, title = t(K.t), prev = '<span class="kprev" aria-hidden="true">' + kindPreview(k) + '</span>';
      if (K.soon) return '<div class="aw-kind kp am-soon" aria-disabled="true" data-key="aw-' + k + '">' + prev + '<span class="aw-kt"><b>' + ico(K.icon, 18, K.cls) + '<span>' + esc(title) + '</span></b><span class="small muted">' + esc(t(K.s)) + '</span></span><span class="pill">' + esc(t('kd_soon')) + '</span></div>';
      var max = k === 'heat' ? 1 : K.max;
      return '<div class="aw-kind kp' + (c ? ' on' : '') + '" data-key="aw-' + k + '">' + prev + '<span class="aw-kt"><b>' + ico(K.icon, 18, K.cls) + '<span>' + esc(title) + '</span></b><span class="small muted">' + esc(t(K.s)) + '</span></span>' +
        '<span class="stepper" role="group" aria-label="' + esc(title) + '"><button type="button" class="btn sec step-b" data-act="aw-n" data-kind="' + k + '" data-d="-1" data-key="aw-' + k + '-dec" aria-label="' + esc(t('aw_dec', { k: title })) + '"' + (c ? '' : ' disabled') + '>−</button>' +
        '<output class="step-n num" aria-live="polite" data-key="aw-' + k + '-n">' + (c ? c : '<span class="small muted">' + esc(t('aw_n0')) + '</span>') + '</output>' +
        '<button type="button" class="btn ' + (c ? 'sec ' : '') + 'step-b" data-act="aw-n" data-kind="' + k + '" data-d="1" data-key="aw-' + k + '-inc" aria-label="' + esc(t('aw_inc', { k: title })) + '"' + (c >= max ? ' disabled title="' + esc(t('aw_max')) + '"' : '') + '>+</button></span></div>';
    }).join('') + '</div>';
  }
  V['add-place'] = function () {
    var n = pwSteps(); if (PW.step > n - 1) PW.step = n - 1;
    var i = PW.step, last = i === n - 1, back = PW.back || 'places', h = '', kind = pwKind(i), first = PW.first;
    var head = n > 1 ? '<div class="wiz-top"><span class="count">' + esc(t('aw_step', { i: i + 1, n: n })) + '</span><span class="progress" aria-hidden="true"><i style="width:' + Math.round((i + 1) / n * 100) + '%"></i></span></div>' : '';
    var prevBtn = i > 0 ? '<button type="button" class="btn sec" data-act="aw-back" data-key="aw-back">' + ico('back', 20) + '<span>' + esc(t('back')) + '</span></button>' : '<a class="btn sec" href="#' + esc(back) + '" data-key="aw-cancel">' + esc(t(first ? 'back' : 'cancel')) + '</a>';
    var nextBtn = last ? '<button type="button" class="btn" data-act="aw-create" data-key="aw-create">' + (first ? '' : ico('check', 20)) + '<span>' + esc(t(first ? 'fs_go' : 'aw_create')) + '</span></button>' : '<button type="button" class="btn" data-act="aw-next" data-key="aw-next">' + esc(t('next')) + '</button>';
    if (kind === 'name') {
      var chips = t('pv_chips').split('|').map(function (c) { return '<button type="button" class="chip" data-act="aw-chip" data-v="' + esc(c) + '" aria-pressed="' + (PW.name === c) + '">' + esc(c) + '</button>'; }).join('');
      h = '<h1>' + esc(t('aw_t1')) + '</h1><p class="muted">' + esc(t('aw_l1')) + '</p><div class="panel">' +
        '<div class="field"><label for="aw-name">' + esc(t('pv_name')) + '</label><div class="ctl"><input id="aw-name" maxlength="40" autocomplete="off" value="' + esc(PW.name) + '" placeholder="' + esc(t('pv_name_ph')) + '"></div><div class="chips" role="group" aria-label="' + esc(t('pv_name')) + '">' + chips + '</div></div>' +
        '<div class="field"><label for="aw-addr">' + esc(t('pl_addr')) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></label><div class="ctl"><input id="aw-addr" maxlength="120" autocomplete="street-address" value="' + esc(PW.address) + '" placeholder="' + esc(t('pl_addr_ph')) + '"></div></div></div>';
    } else if (kind === 'kinds') {
      h = '<h1>' + esc(t(first ? 'fs_t1' : 'aw_t2')) + '</h1><p class="muted">' + esc(t(first ? 'fs_l1' : 'aw_l2')) + '</p>' + awKinds() +
        (PW.err ? '<div class="banner warn" role="alert" data-key="aw-err">' + ico('alert', 22) + '<div><p><b>' + esc(PW.err) + '</b></p></div></div>' : '') +
        (first ? '<p class="small muted fs-more" data-key="fs-more">' + ico('home', 18) + '<span>' + esc(t('fs_more')) + '</span></p>' : '');
    } else {
      h = '<h1>' + esc(t('aw_t3')) + '</h1><p class="muted">' + esc(t('aw_l3')) + '</p><div class="panel"><div class="grid2">' +
        '<div class="field"><label for="aw-acc">' + esc(t('wa_acc')) + '</label><div class="ctl"><input id="aw-acc" class="num" inputmode="numeric" autocomplete="off" value="' + esc(PW.account) + '"></div><div class="help">' + esc(t('wa_acc_h')) + '</div></div>' +
        '<div class="field"><label for="aw-sn">' + esc(t('wa_sn')) + '</label><div class="ctl"><input id="aw-sn" autocomplete="family-name" value="' + esc(PW.surname) + '"></div><div class="help">' + esc(t('wa_sn_h')) + '</div></div></div></div>';
    }
    if (last && (!first || kind === 'acc')) h += pwSummary();
    h += '<div class="wiz-actions">' + prevBtn + nextBtn + '</div>';
    if (last && kind === 'acc') h += '<p><button type="button" class="linkbtn" data-act="aw-create" data-skip="1" data-key="aw-skip">' + esc(t('aw_skip_acc')) + '</button></p>';
    if (last && first) h += '<p class="small muted fs-after" data-key="fs-after">' + esc(t('fs_after')) + '</p>';
    return { screen: first ? 'S02' : 'S44', route: first ? 'start' : 'add-place', bare: true, closeTo: back, html: '<p class="small muted aw-title">' + esc(t(first ? 'fs_title' : 'aw_title')) + '</p>' + head + h };
  };
  /** Первый вход: какие счётчики есть в квартире. Уже настроен — сюда не ведём (render отправит на главную). */
  V.start = function () {
    if (!PW.first) PW = pwFresh('welcome', true);
    return V['add-place']();
  };
  function pwGo() { go(PW.first ? 'start' : 'add-place'); }
  /** Создать квартиру из мастера (или, при первом входе, заполнить первую) и пойти настраивать её счётчики по очереди. */
  function pwCreate(skipAcc) {
    pwRead(); syncPlace();
    var water = PW.n.hot + PW.n.cold > 0, first = PW.first;
    if (first && !pwAny()) { PW.step = 0; PW.err = t('fs_err_none'); pwGo(); return; }
    var list = []; ['hot', 'cold', 'elec', 'gas'].forEach(function (k) { for (var j = 0; j < (PW.n[k] || 0); j++) list.push(k); });
    if (first) {   // первая квартира уже есть («Моя квартира») — пишем в неё только рахунок Водоканалу
      if (water && !skipAcc && (PW.account || PW.surname)) wsetCfg(function (c) { c.account = PW.account; c.surname = PW.surname; });
    } else {
      var np = { id: 'p' + Date.now().toString(36), name: PW.name.trim(), address: PW.address.trim(), v: 2, color: nextColor(), meter: null, baseline: null,
        water: { account: water && !skipAcc ? PW.account : '', surname: water && !skipAcc ? PW.surname : '', meters: [] }, updatedAt: Date.now() };
      S.places.push(np); switchPlace(np.id); WX.key = ''; save();
    }
    PQ = list.length || PW.n.heat ? { place: S.placeId, list: list, i: 0, heat: !!PW.n.heat, total: list.length + (PW.n.heat ? 1 : 0), first: first } : null;
    if (!first) { toast(t('aw_created', { p: placeLabel(place()) })); PW = pwFresh(); }   // первый вход: выбор держим — «Скасувати» вернёт к нему
    pqNext();
  }
  /** Следующий счётчик новой квартиры: водомер (#wadd) → … → теплосчётчик (#meter) → главная квартиры.
   *  «Скасувати» на первом входе, пока ничего не сохранено, — назад к выбору (#start), иначе — на главную. */
  function pqNext() {
    if (!PQ || PQ.place !== S.placeId) { PQ = null; go('home'); return; }
    var back = S.onboarded ? 'home' : 'start';
    if (PQ.i < PQ.list.length && SK[PQ.list[PQ.i]]) { var qk = PQ.list[PQ.i]; EA = { kind: qk, back: back, zones: 1, vals: {}, f: {} }; go(SK[qk].add); return; }
    if (PQ.i < PQ.list.length) { WA = { kind: PQ.list[PQ.i], back: back }; go('wadd'); return; }
    if (PQ.heat) { PQ.i = PQ.list.length; delete S._pickModel; go('meter'); return; }
    var fst = PQ.first; PQ = null; if (fst) toast(t('fs_done')); go('home');
  }
  /** Плашка «Нова квартира «Мамина»: лічильник 2 з 3» на экранах настройки счётчика из очереди. */
  function pqBanner(heat) {
    if (!PQ || PQ.place !== S.placeId) return '';
    var i = heat ? PQ.total : PQ.i + 1;
    return '<div class="banner aw-q" data-key="aw-queue">' + ico('home', 22) + '<div><p><b>' + esc(PQ.first ? t('fs_q', { i: i, n: PQ.total }) : t('aw_q', { p: placeLabel(place()), i: i, n: PQ.total })) + '</b></p>' +
      '<span class="progress" aria-hidden="true"><i style="width:' + Math.round(i / PQ.total * 100) + '%"></i></span>' +
      (heat ? '<p>' + esc(t('aw_q_heat')) + '</p>' : '<p><button type="button" class="linkbtn" data-act="pq-later" data-key="aw-q-later">' + esc(t('aw_q_later')) + '</button></p>') + '</div></div>';
  }

  /** Какой счётчик добавить: опалення · гаряча · холодна · газ (скоро) · електрика (скоро); прибранные — «Повернути». */
  var AM_BACK = 'home';
  V['add-meter'] = function () {
    var rows = KIND_ORDER.map(function (k) {
      var K = KINDS[k], n = kindCount(k), icon = ico(K.icon, 26, K.cls);
      if (K.soon) return '<div class="wz-opt am-opt am-soon" aria-disabled="true" data-key="am-' + k + '">' + icon + '<span><b>' + esc(t(K.t)) + '</b><span class="small muted">' + esc(t(K.s)) + '</span></span><span class="pill">' + esc(t('kd_soon')) + '</span></div>';
      if (n >= K.max) return '<a class="wz-opt am-opt am-have" href="#' + (k === 'heat' ? 'heat' : SK[k] ? SK[k].page : 'water-' + k) + '" data-key="am-' + k + '">' + icon + '<span><b>' + esc(t(K.t)) + '</b><span class="small muted">' + esc(t('kd_have_all')) + '</span></span><span class="pill ok">' + esc(t('kd_have')) + '</span></a>';
      return '<button type="button" class="wz-opt am-opt" data-act="am-pick" data-kind="' + k + '" data-key="am-' + k + '">' + icon + '<span><b>' + esc(t(K.t)) + '</b><span class="small muted">' + esc(n ? t('kd_have_n', { n: n }) : t(K.s)) + '</span></span>' + ico('chev', 20) + '</button>';
    }).join('');
    var rm = removedMeters(), back = AM_BACK || 'home';
    var restore = rm.length ? '<h2 class="section-title">' + esc(t('am_restore_t')) + '</h2><div class="wz-opts">' + rm.map(function (x) {
      return '<button type="button" class="wz-opt am-opt" data-act="m-restore" data-what="' + esc(x.what) + '" data-back="1" data-key="am-restore-' + esc(x.what) + '">' + ico(KINDS[x.kind].icon, 26, KINDS[x.kind].cls) + '<span><b>' + esc(t('am_restore') + ': ' + x.title) + '</b><span class="small muted">' + esc(t('am_removed_on', { d: fmtDate(x.at, true) })) + '</span></span></button>';
    }).join('') + '</div>' : '';
    return { screen: 'S40', route: 'add-meter', bare: true, closeTo: back, html: '<h1>' + esc(t('am_title')) + '</h1><p class="muted">' + esc(t('am_lead')) + '</p><div class="wz-opts am-list">' + rows + '</div>' + restore +
      '<div class="wiz-actions"><a class="btn sec" href="#' + esc(back) + '">' + esc(t('cancel')) + '</a></div>' };
  };

  /** Новый водомер одной страницей: где стоит, показания сейчас, № и повірка; рахунок Водоканалу — если ещё не указан. */
  var WA = { kind: 'cold', back: '' };
  V.wadd = function () {
    var k = WA.kind, same = wmeters(k), c = wcfg(), back = WA.back || 'home', opt = ' <span class="muted small">(' + esc(t('b_opt')) + ')</span>';
    var fld = function (id, lbl, attrs, unit, help, optional, after) { return '<div class="field"><label for="' + id + '">' + esc(lbl) + (optional ? opt : '') + '</label><div class="ctl"><input id="' + id + '" ' + attrs + '>' + (unit ? '<span class="unit">' + unit + '</span>' : '') + (after || '') + '</div>' + (help ? '<div class="help">' + esc(help) + '</div>' : '') + '</div>'; };
    var inQ = !!(PQ && PQ.place === S.placeId);
    var h = pqBanner() + '<h1>' + ico('drop', 26, KINDS[k].cls) + ' ' + esc(t('wa_title', { k: wkindTitle(k).toLowerCase() })) + '</h1><p class="muted">' + esc(t('wa_lead')) + '</p><form id="wa-form" novalidate><div class="panel">' +
      fld('wa-name', t('wa_name'), 'maxlength="40" autocomplete="off" placeholder="' + esc(t('wa_name_ph')) + '"', '', same.length ? t('wa_name_need', { n: same.length }) : t('wa_name_h'), !same.length) +
      (same.length === 1 && !same[0].name ? fld('wa-name0', t('wa_name0'), 'maxlength="40" autocomplete="off" placeholder="' + esc(t('wa_name0_ph')) + '"', '', '', true) : '') +
      phHelp(fld('wa-val', t('wa_val'), 'class="num" inputmode="decimal" autocomplete="off"', 'м³', t('wa_val_h'), true, startCam('wa-val', wkindTitle(k))), 'wa-val') +
      (function () {   // № і повірка: у черзі налаштування — згорнуто, як рахунки у світла/газу
        var g = '<div class="grid2">' + fld('wa-serial', t('wm_serial'), 'class="num" autocomplete="off"', '', '', true) + fld('wa-ver', t('mv_date'), 'type="date"', '', '', true) + '</div>';
        return inQ ? '<details class="mbox-set wa-more" data-key="wa-more"><summary>' + ico('prefs', 18) + '<span>' + esc(t('wa_more')) + opt + '</span>' + ico('chev', 18, 'pacc-chev') + '</summary><div class="mbox-set-b">' + g + '</div></details>' : g;
      })() +
      '<div class="help block" id="wa-err" role="alert"></div></div>' +
      (c.account || inQ ? '' : '<div class="panel"><h2>' + esc(t('wm_acc_t')) + opt + '</h2><p class="small muted">' + esc(t('wa_acc_s')) + '</p>' + waccForm() + '</div>') +
      '<div class="wiz-actions"><a class="btn sec" href="#' + esc(back) + '">' + esc(t('cancel')) + '</a><button type="submit" class="btn" data-key="wa-save">' + esc(t('wa_add')) + '</button></div></form>';
    return { screen: 'S43', route: 'wadd', bare: true, closeTo: back, html: h };
  };
  function waSave() {
    var v = function (id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; };
    var k = WA.kind, same = wmeters(k), name = v('wa-name').slice(0, 40), name0 = v('wa-name0').slice(0, 40), raw = v('wa-val'), val = raw === '' ? null : Wt.norm(raw), err = '', bad = '';
    if (same.length && !name) { err = t('wa_e_name'); bad = 'wa-name'; }
    else if (name && same.concat([{ name: name0 }]).some(function (m) { return (m.name || '').toLowerCase() === name.toLowerCase(); })) { err = t('wa_e_dup'); bad = 'wa-name'; }
    else if (raw !== '' && val === null) { err = t('wa_e_val'); bad = 'wa-val'; }
    var box = document.getElementById('wa-err');
    if (err) { if (box) box.textContent = err; var bi = document.getElementById(bad); if (bi) bi.focus(); return; }
    var id = Wt.uid(), ver = v('wa-ver'), serial = v('wa-serial');
    wsetCfg(function (c) {
      c.meters = c.meters || [];
      if (name0 && same.length === 1) c.meters.forEach(function (m) { if (m.id === same[0].id) m.name = name0; });
      c.meters.push({ id: id, kind: k, name: name, serial: serial, vkId: '', verifiedUntil: ver });
    });
    if (val !== null) {   // показания при установке — стартовые (их не передают; от них считается расход)
      S.water = S.water || [];
      var b0 = S.water.filter(function (r) { return r && !r.deleted && r.base && r.place === S.placeId && r.date === today(); })[0];
      if (b0) { b0.vals = Object.assign({}, b0.vals); b0.vals[id] = val; b0.updatedAt = Date.now(); }
      else S.water.push({ id: Wt.uid(), place: S.placeId, date: today(), vals: (function () { var o = {}; o[id] = val; return o; })(), createdAt: new Date().toISOString(), updatedAt: Date.now(), sent: {}, base: true });
    }
    S.onboarded = true; S.view = k; save(); toast(t('wa_added') + inPlace());
    var back = WA.back; WA = { kind: k, back: '' };
    if (PQ && PQ.place === S.placeId && PQ.i < PQ.list.length) { PQ.i++; pqNext(); return; }
    go(back && /^place-/.test(back) ? back : 'water-' + k);
  }
  /** « · Мамина» к подтверждениям, когда квартир несколько (не туда внести — частая ошибка). */
  function inPlace() { return places().length > 1 ? ' · ' + placeLabel(place()) : ''; }
  /** Напоминания ботом: вода 15/19, тепло 5/22 (если ещё не внесли); приходят в Telegram. */
  function remindPanel() {
    if (!window.TEPLO_API) return '';
    var on = !(S.remind && S.remind.off), acc = Y().account, tg = acc && acc.telegram;
    return '<div class="panel" data-key="prefs-remind"><h2>' + esc(t('rm_title')) + '</h2>' +
      '<label class="check-row"><input type="checkbox" id="p-remind" data-key="prefs-remind-on"' + (on ? ' checked' : '') + '><span>' + esc(t('rm_on')) + '</span></label>' +
      '<p class="small muted" style="margin-top:8px">' + esc(t('rm_sub')) + '</p>' +
      (tg ? '' : '<p class="small">' + ico('info', 16) + ' ' + esc(t(acc ? 'rm_need_tg' : 'rm_need_login')) + '</p>') + '</div>';
  }
  // світло: поля лічильника (назва, рахунок, №), електроопалення квартири; підказки під полями вводу
  document.addEventListener('change', function (e) {
    var el = e.target; if (!el || !el.getAttribute) return;
    var mid = el.getAttribute('data-em');
    if (mid) { var f = el.getAttribute('data-ef'), v = el.value.trim().slice(0, 40), moved = false; if (f === 'zones') v = Math.min(3, Math.max(1, +v || 1)); if (f === 'eic') v = eicNorm(v);
      setPMeters(function (list) { list.forEach(function (m) { if (m.id === mid) { m[f] = v; if (f === 'account') moved = gasMove(m); } }); }); toast(moved ? t('gm_moved') : t('b_saved')); if (f === 'zones') { MB_OPEN[mid] = true; render(true); } else if (f === 'account' || f === 'name' || f === 'grm' || f === 'eic') { MB_OPEN[mid] = true; safeRender(); } return; }
    var hk = el.getAttribute('data-heat');
    // ціна й пільга змінюють вартість у історії — перемалювати сторінку
    if (hk === 'elecHeat' || hk === 'gasHeat') { ensurePlaces(); var pp = place(); if (el.checked) pp[hk] = true; else delete pp[hk]; pp.updatedAt = Date.now(); save(); toast(t('b_saved')); render(true); return; }
    if (el.id === 'g-price') { ensurePlaces(); var pg = place(), gv = R.num(el.value); if (gv && gv > 0 && gv < 100) pg.gasPrice = gv; else delete pg.gasPrice; pg.updatedAt = Date.now(); save(); toast(t('b_saved')); render(true); return; }
    if (el.id === 'en-date') { enRead(); enCheck(true); }
  });
  // підказки під полями світла — одразу під час набору (як у води): після виходу з поля кнопка не «з'їжджає»
  document.addEventListener('input', function (e) { var el = e.target; if (el && el.getAttribute && el.getAttribute('data-en')) { enRead(); enCheck(true); } });
  // форма нового світла/газу: усе вписане — одразу в EA (перерисовка після синхронізації чи зміни зон нічого не стирає)
  ['input', 'change'].forEach(function (ev) { document.addEventListener(ev, function (e) { var el = e.target; if (el && el.closest && el.closest('#ea-form') && el.name !== 'ea-z') eaRead(); }); });
  // мастер квартиры: «Перевірте» сразу показывает введённый рахунок
  document.addEventListener('input', function (e) {
    var el = e.target; if (!el || el.id !== 'aw-acc') return; PW.account = el.value.trim();
    var dd = document.getElementById('aw-sum-acc'); if (dd) dd.textContent = PW.account || t('aw_sum_noacc');
  });
  document.addEventListener('change', function (e) {
    var el = e.target; if (!el || el.id !== 'pv-remind') return;
    ensurePlaces(); var pr = place(); if (!pr) return;
    if (el.checked) delete pr.remindOff; else pr.remindOff = true;
    pr.updatedAt = Date.now(); save(); toast(t(el.checked ? 'rm_saved_on' : 'rm_saved_off') + inPlace());
  });
  document.addEventListener('change', function (e) {
    var el = e.target; if (!el || el.id !== 'p-remind') return;
    S.remind = Object.assign({}, S.remind || {}, { off: !el.checked, lang: S.lang }); save(); toast(t(el.checked ? 'rm_saved_on' : 'rm_saved_off'));
  });
  /** Настройки — группы-аккордеоны по смыслу; открытые запоминаются (перерисовка их не сворачивает). */
  var PREF_OPEN = {};
  function prefGroup(id, icon, title, sub, html) {
    return '<details class="pgroup" id="pg-' + id + '" data-key="pg-' + id + '"' + (PREF_OPEN[id] ? ' open' : '') + '><summary>' + ico(icon, 22) + '<span class="pg-t"><b>' + esc(title) + '</b>' + (sub ? '<span class="small muted">' + esc(sub) + '</span>' : '') + '</span>' + ico('chev', 20, 'pacc-chev') + '</summary><div class="pg-body">' + html + '</div></details>';
  }
  document.addEventListener('toggle', function (e) { var d = e.target; if (d && d.classList && d.classList.contains('pgroup')) PREF_OPEN[d.id.slice(3)] = d.open; }, true);
  /** Тарифы воды: свои цифры поверх тарифов Харкова; как считается цена. */
  function wtariffPanel() {
    var c = S.wtariff || {}, d = Wt.tariffAt(today()), f = function (v) { return String(v).replace('.', ','); };
    var fld = function (k, lbl, def) { return '<div class="field"><label for="p-w' + k + '">' + esc(lbl) + '</label><div class="ctl"><input id="p-w' + k + '" class="num" inputmode="decimal" data-wt="' + k + '" placeholder="' + esc(f(def)) + '" value="' + esc(c[k] ? f(c[k]) : '') + '"><span class="unit">грн/м³</span></div></div>'; };
    return '<div class="panel" data-key="prefs-wtariff"><h2>' + esc(t('wtp_title')) + '</h2><p class="small muted">' + esc(t('wtp_sub', { d: fmtDate(today(), true) })) + '</p>' +
      '<div class="grid2">' + fld('supply', t('wtp_supply'), d.supply) + fld('drain', t('wtp_drain'), d.drain) + fld('hot', t('wtp_hot'), d.hot) + '</div>' +
      '<details class="tips-box" style="margin-top:12px" open><summary>' + esc(t('wtp_how_t')) + '</summary>' + t('wtp_how').split('|').map(function (x) { return '<p class="small">' + esc(x) + '</p>'; }).join('') + '</details></div>';
  }
  /** Коли лічильник знято: правила (тариф той самий, інший спосіб визначити обсяг) і що для оцінки потрібно знати. */
  function nometerHeatPanel() {
    var p = place() || {};
    return '<div class="panel" id="nometer-h" tabindex="-1" data-key="prefs-nometer-h"><h2>' + esc(t('nm_h_t')) + '</h2><p class="small muted">' + esc(t('nm_h_sub', { p: money(tariff()) })) + '</p>' +
      '<ul class="plain small nm-rules">' + t('nm_h_l').split('|').map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
      '<div class="field" style="max-width:260px"><label for="p-area">' + esc(t('nm_area')) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></label><div class="ctl"><input id="p-area" class="num" inputmode="decimal" autocomplete="off" value="' + esc(p.area ? String(p.area).replace('.', ',') : '') + '"><span class="unit">м²</span></div><div class="small muted">' + esc(t('nm_area_h')) + '</div></div></div>';
  }
  function nometerWaterPanel() {
    var c = wcfg(), nr = Wt.normOf(c), f = function (v) { return String(v).replace('.', ','); };
    var opts = Wt.NORMS.map(function (x) { return '<option value="' + x.id + '"' + (x.id === nr.id ? ' selected' : '') + '>' + esc(t('nr_' + x.id) + ' — ' + f(x.cold) + (x.hot ? ' + ' + f(x.hot) : '') + ' м³') + '</option>'; }).join('');
    var row = Wt.NORMS.filter(function (x) { return x.id === nr.id; })[0];
    var fld = function (k, lbl, ph, v) { return '<div class="field"><label for="p-' + k + '">' + esc(lbl) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></label><div class="ctl"><input id="p-' + k + '" class="num" inputmode="decimal" autocomplete="off" data-nm="' + k + '" placeholder="' + esc(ph) + '" value="' + esc(v == null || v === '' ? '' : f(v)) + '"><span class="unit">' + esc(t('nm_unit')) + '</span></div></div>'; };
    return '<div class="panel" id="nometer-w" tabindex="-1" data-key="prefs-nometer-w"><h2>' + esc(t('nm_w_t')) + '</h2><p class="small muted">' + esc(t('nm_w_sub')) + '</p>' +
      '<ul class="plain small nm-rules">' + t('nm_w_l').split('|').map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' +
      '<div class="grid2"><div class="field"><label for="p-persons">' + esc(t('nm_persons')) + '</label><div class="ctl"><input id="p-persons" class="num" inputmode="numeric" autocomplete="off" data-nm="persons" value="' + esc(c.persons || '') + '"></div></div>' +
      '<div class="field"><label for="p-normrow">' + esc(t('nm_row')) + '</label><div class="ctl"><select id="p-normrow" data-nm="normRow">' + opts + '</select></div></div>' +
      fld('normCold', t('nm_cold'), f(row.cold), c.normCold) + (row.hot || c.normHot ? fld('normHot', t('nm_hot'), f(row.hot), c.normHot) : '') + '</div>' +
      '<p class="small muted">' + esc(t('nm_src')) + '</p></div>';
  }
  V.prefs = function () {
    var m = model(), c = S.contacts || {}, ms = wmeters();
    var groups = [
      prefGroup('acc', 'shield', t('pg_acc'), t('pg_acc_s'), syncPanel()),
      prefGroup('places', 'home', t('pg_places'), t('pg_places_s'), placesPanel()),
      prefGroup('heat', 'thermo', t('pg_heat'), hasHeat() ? modelName(m) : t('pg_heat_none'), meterPanel() + '<div class="panel" data-key="prefs-bill"><h2>' + esc(t('p_tariff')) + (places().length > 1 ? ' <span class="muted small">· ' + esc(placeLabel(place())) + '</span>' : '') + '</h2><p class="small muted">' + esc(t('p_tariff_sub')) + '</p>' +
        '<div class="grid2"><div class="field"><label for="p-tariff">' + esc(t('p_tariff_l')) + '</label><div class="ctl"><input id="p-tariff" class="num" inputmode="decimal" data-key="prefs-tariff" value="' + esc(tariff().toFixed(2).replace('.', ',')) + '"></div></div>' +
        '<div class="field"><label for="p-abon">' + esc(t('p_abon_l')) + '</label><div class="ctl"><input id="p-abon" class="num" inputmode="decimal" value="' + esc(bill().abon.toFixed(2).replace('.', ',')) + '"></div></div>' +
        '<div class="field"><label for="p-mzk">' + esc(t('p_mzk_l')) + '</label><div class="ctl"><input id="p-mzk" class="num" inputmode="decimal" placeholder="0,01262" value="' + esc(bill().mzk ? String(bill().mzk).replace('.', ',') : '') + '"></div><div class="small muted">' + esc(t('p_mzk_h')) + '</div></div></div>' +
        '<details class="tips-box" style="margin-top:12px"><summary>' + esc(t('p_bill_how_t')) + '</summary><p class="small">' + esc(t('p_bill_how')) + '</p></details></div>' +
      (hasHeat() ? nometerHeatPanel() : '')),
      prefGroup('water', 'drop', t('pg_water'), ms.length ? t('pg_water_n', { n: ms.length }) : t('pg_heat_none'), waterPanel() + wtariffPanel() + (ms.length ? nometerWaterPanel() : '')),
      prefGroup('remind', 'clock', t('pg_remind'), t('pg_remind_s'), remindPanel()),
      prefGroup('contacts', 'chat', t('pg_contacts'), t('pg_contacts_s'), '<div class="panel"><h2>' + esc(t('p_contacts')) + '</h2><p class="small muted">' + esc(t('p_contacts_sub')) + '</p><div class="grid2">' +
      '<div class="field"><label for="p-phone">' + esc(t('ho_phone')) + '</label><div class="ctl"><input id="p-phone" type="tel" autocomplete="tel" data-contact="phone" value="' + esc(c.phone || '') + '"></div></div>' +
      '<div class="field"><label for="p-email">' + esc(t('ho_email')) + '</label><div class="ctl"><input id="p-email" type="email" autocomplete="email" data-contact="email" value="' + esc(c.email || '') + '"></div></div></div></div>' +
      ''),
      prefGroup('look', 'sun', t('pg_look'), t('th_' + (S.theme || 'auto')), '<div class="panel" data-key="prefs-theme"><h2>' + esc(t('th_title')) + '</h2><div class="seg-ctl" role="group" aria-label="' + esc(t('th_title')) + '">' +
        ['auto', 'light', 'dark'].map(function (k) { return '<button type="button" data-act="theme" data-v="' + k + '" aria-pressed="' + ((S.theme || 'auto') === k) + '">' + esc(t('th_' + k)) + '</button>'; }).join('') + '</div>' +
        '<p class="small muted" style="margin-top:8px">' + esc(t('th_sub')) + '</p></div>' +
      ''),
      prefGroup('data', 'copy', t('pg_data'), t('pg_data_s'), '<div class="panel" data-key="prefs-data"><h2>' + esc(t('p_data')) + '</h2>' +
        (Y().account ? '<p class="small muted">' + esc(t('p_data_synced')) + '</p>' :
          '<p class="small muted">' + esc(t('p_data_sub')) + '</p><div class="row-actions" style="margin-top:0"><button class="btn sec" data-act="export" data-key="prefs-export">' + ico('copy', 20) + '<span>' + esc(t('p_export')) + '</span></button></div>' +
          '<details class="tips-box" style="margin-top:12px"><summary>' + esc(t('p_import')) + '</summary><form id="import-form" novalidate style="margin-top:8px"><div class="field"><label for="p-import">' + esc(t('p_import_l')) + '</label><div class="ctl"><textarea id="p-import" placeholder="' + esc(t('p_import_ph')) + '"></textarea></div></div><button class="btn sec" type="submit">' + esc(t('p_import_go')) + '</button></form></details>') +
        // тестовый период: вместо «Видалити всі дані» — «Тестовий режим: почати спочатку» (то же стирание, вход остаётся); раньше блок был и на главной
        // «Видалити всі дані» (с входом — стирает и в аккаунте, вход остаётся); тестовый блок «почати спочатку» убран 06.11.2026
        '<div style="margin-top:20px"><button class="btn danger" data-act="wipe-ask" data-key="prefs-wipe">' + esc(t('p_wipe')) + '</button><div id="wipe-confirm"></div></div></div>' +
      (!S.demoToday ? '' : '<details class="tips-box" data-key="prefs-demo-box" open><summary>' + esc(t('p_demo')) + '</summary><p class="small muted">' + esc(t('p_demo_sub')) + '</p><div class="field" style="max-width:260px"><label for="p-demo">' + esc(t('p_demo_l')) + '</label><div class="ctl"><input type="date" id="p-demo" data-key="prefs-demo" value="' + esc(S.demoToday || '') + '"></div></div></details>') +
      '')
    ];
    return { screen: 'S11', route: 'prefs', html: '<h1>' + esc(t('p_title')) + '</h1><div class="pgroups">' + groups.join('') + '</div>' +
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
    if (j && j._status === 200) { toast(t('login_ok')); S.onboarded = S.onboarded || anyMeters(); save(); go(S.onboarded ? 'home' : 'start'); return; }
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
  /** Фото из бота. Главная зовёт это на каждой отрисовке — спрашиваем сервер не чаще раза в минуту и перерисовываем,
   *  только если список изменился (иначе ответ → перерисовка → запрос… и главная «мигает», нажатия теряются). */
  function loadInbox(force) {
    if (!window.TEPLO_API || !Y().account || INBOX.loading) return;
    if (!force && !INBOX.auto && INBOX.items !== null && Date.now() - (INBOX.at || 0) < 60000) return;
    INBOX.loading = true; INBOX.at = Date.now();
    var before = JSON.stringify((INBOX.items || []).map(function (x) { return x.id; }));
    api0('/inbox').then(function (r) { return r.json(); }).then(function (j) {
      INBOX.loading = false; INBOX.items = (j && j.items) || [];
      var changed = before !== JSON.stringify(INBOX.items.map(function (x) { return x.id; }));
      if (INBOX.auto) { try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* нет */ } }
      if (INBOX.auto && INBOX.items.length && PH.status !== 'working') { INBOX.auto = false; inboxRun(); return; }
      INBOX.auto = false;
      if (changed && ['home', ''].indexOf(routeName()) >= 0) safeRender();
    }, function () { INBOX.loading = false; });
  }
  function inboxRun() {
    var items = (INBOX.items || []).slice(); if (!items.length) return;
    phReset('reading'); PH.inbox = items.map(function (x) { return x.id; }); PH.status = 'working'; PH.progress = t('ib_loading'); PH.pct = 2;
    PH.inboxAt = Math.max.apply(null, items.map(function (x) { return +x.takenAt || 0; })); hcLoad(true);   // автоподача: дата зняття — коли сфотографовано
    var gen = ++PH_GEN; PH.gen = gen;
    go('photo');
    Promise.all(items.map(function (x) {
      return fetch(window.TEPLO_API + '/inbox/file?id=' + encodeURIComponent(x.id), { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw new Error('file'); return r.blob(); }).then(function (b) {
        var f; try { f = new File([b], x.id + '.jpg', { type: b.type || 'image/jpeg', lastModified: x.takenAt * 1000 }); } catch (e) { f = b; f.lastModified = x.takenAt * 1000; }
        f._srv = x.id; return f;
      });
    })).then(function (files) {
      if (PH.gen !== gen) return;
      PH.files = files; PH.urls = files.map(function (f) { return URL.createObjectURL(f); }); PH.status = 'idle'; PHS.save(true); phRun();
    }, function () { if (PH.gen !== gen) return; PH.status = 'idle'; PH.error = t('err_network'); render(true); });
  }
  function inboxDone() {
    var ids = PH.inbox; if (!ids || !ids.length || !window.TEPLO_API) return;
    PH.inbox = null; INBOX.items = (INBOX.items || []).filter(function (x) { return ids.indexOf(x.id) < 0; });
    api0('/inbox/done', { method: 'POST', body: JSON.stringify({ ids: ids }) }).catch(function () {});
  }
  /** Кнопка «в работе»: крутится значок, повторно не нажать; возвращает «готово». */
  function busy(btn) { if (!btn) return function () {}; btn.setAttribute('aria-busy', 'true'); btn.disabled = true; return function () { btn.removeAttribute('aria-busy'); btn.disabled = false; }; }
  var SPIN = '<span class="spin" aria-hidden="true"></span>';
  var PH = { mode: 'reading', files: [], urls: [], status: 'idle', result: null, picked: null, error: '', ctl: null, progress: '' }, PH_GEN = 0;
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
    var shell_ = function (html) { return { screen: 'S12', route: 'photo', bare: true, closeTo: back, html: head + html + (PH.mode === 'reading' ? cancelLink('heat') : '') }; };
    if (!VIS().available) return shell_('<div class="banner warn">' + ico('info', 22) + '<div><p>' + esc(t('ph_unavail')) + '</p></div></div><a class="btn" href="#' + back + '">' + esc(t('back')) + '</a>');
    var input = '<input type="file" id="ph-input" accept="' + esc(((VIS().limits && VIS().limits.images && VIS().limits.images.mediaTypes) || ['image/jpeg', 'image/png', 'image/webp']).join(',')) + '" multiple class="sr" data-key="photo-input">';
    if (PH.status === 'working') return shell_('<div class="banner" role="status">' + SPIN + '<div class="grow"><p><b>' + esc(t('ph_working', { n: PH.files.length })) + '</b></p>' + '<p id="ph-progress">' + esc(PH.progress || '') + '</p><div class="pbar" aria-hidden="true"><i id="ph-pbar" style="width:' + (PH.pct || 2) + '%"></i></div>' + '</div></div>' + thumbs(false) + '<div class="row-actions"><button class="btn sec" data-act="ph-stop" data-key="photo-stop">' + ico('close', 18) + '<span>' + esc(t('ph_stop')) + '</span></button></div>');
    if (PH.status === 'done' && !model_) return shell_(photoResult());
    var lead = '<p>' + esc(model_ ? t('ph_model_lead') : base_ ? t('ph_base_lead') : t('ph_lead')) + '</p>' + (base_ ? '<p><a href="' + HTM_URL + '" target="_blank" rel="noopener">' + esc(t('h_cab_link')) + ' ' + ico('ext', 14) + '</a></p>' : '');
    if (!model_) lead += '<details class="tips-box"' + (PH.files.length ? '' : ' open') + '><summary>' + ico('camera', 18) + ' ' + esc(t('ph_tips_t')) + '</summary><ul>' + t('ph_tips').split('|').map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></details>';
    var err = PH.error ? '<div class="banner bad" role="alert">' + ico('alert', 22) + '<div><p>' + esc(PH.error) + '</p></div></div>' : '';
    var date = model_ ? '' : '<div class="field" style="max-width:280px"><label for="ph-date">' + esc(t('ph_date')) + '</label><div class="ctl"><input id="ph-date" type="date" value="' + esc(PH.date || today()) + '" max="' + today() + '"></div></div>';
    var pick = '<label for="ph-input" class="btn ' + (PH.files.length ? 'sec' : 'big') + '" tabindex="0" data-key="photo-pick">' + ico('camera', 22) + '<span>' + esc(PH.files.length ? t('ph_add') : t('ph_pick')) + '</span></label>';
    var go_ = PH.files.length ? '<button class="btn big" data-act="ph-run" data-key="photo-run">' + esc(t('ph_go', { n: PH.files.length })) + '</button>' : '';
    return shell_(lead + err + input + (PH.files.length ? thumbs(true) : '') + date + '<div class="row-actions">' + pick + go_ + '</div>' + '<p class="small muted" style="margin-top:16px">' + esc(t('ph_privacy')) + '</p>');
  }
  function photoResult() {
    var p = PH.picked || {}, res = PH.result || {}, mt = res.meter || {}, h = phAutoBanner();
    var mm = mt.modelId ? M.byId(mt.modelId) : null;
    if (mm && (!S.meter || S.meter.modelId !== mm.id)) h += '<div class="banner" data-key="photo-meter">' + ico('info', 22) + '<div><p><b>' + esc(t('ph_meter_found', { m: modelName(mm) })) + '</b></p><p><button class="linkbtn" data-act="ph-use-model" data-id="' + mm.id + '" data-unit="' + esc(mt.energyUnit || '') + '">' + esc(t('ph_meter_use')) + '</button></p></div></div>';
    var noteTxt = function (x) { return x.note ? (t('pn_' + x.note) !== 'pn_' + x.note && t('pn_' + x.note) ? t('pn_' + x.note) : x.note) : ''; };
    var INFO = { test_screen: 1, dt_screen: 1 };   // служебные экраны — не ошибка, просто пояснение
    var info = (res.photos || []).filter(function (x) { return INFO[x.note] && !(x.readings || []).length; });
    var bad = (res.photos || []).filter(function (x) { return !(PH.waterIdx && PH.waterIdx.indexOf(x.index) >= 0 && wmeters().length) && !INFO[x.note] && ((x.quality && x.quality !== 'ok') || (x.meterType && x.meterType !== 'heat') || (res.engine === 'local' && x.note)); });
    if (PH.waterIdx && PH.waterIdx.length && wmeters().length) h += '<div class="banner" data-key="photo-water">' + ico('drop', 22, 'c-cold') + '<div><p><b>' + esc(t('wnp_mixed', { list: PH.waterIdx.map(function (i) { return i + 1; }).join(', ') })) + '</b></p><p><button class="btn sec" data-act="ph-water" data-key="photo-water-go">' + esc(t('wnp_mixed_go')) + '</button></p></div></div>';
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
  function photoViewer(start, list) {
    var urls = (list || PH.urls).slice(); if (!urls.length) return;
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
  // все ссылки «#…» внутри сервиса (вкладки, карточки, «назад»): слушаем на window — после обработчиков data-act;
  // если они сами не перешли (preventDefault), переходим сами
  window.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]'); if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || a.getAttribute('href').length < 2) return;
    e.preventDefault(); var r = a.getAttribute('href').slice(1);
    if (routeName() === r) { render(); return; }
    try { history.pushState(null, '', '#' + r); } catch (x) { location.hash = r; return; }
    render();
  });
  document.addEventListener('click', function (e) { var im = e.target.closest && e.target.closest('img[data-pv]'); if (im && routeName() === 'photo') { e.preventDefault(); photoViewer(+im.getAttribute('data-pv')); } });

  function phRun() {
    var y = VIS(); if (!y.available || !PH.files.length) return;
    var di = document.getElementById('ph-date'); if (di) PH.date = di.value || today();
    var gen = ++PH_GEN; PH.gen = gen;
    PH.status = 'working'; PH.error = ''; PH.progress = ''; PH.pct = 2; PH.ctl = new AbortController(); render(true);
    var m = model(), ctx = { modelId: m ? m.id : '', models: M.MODELS, steps: m && m.status === 'verified' ? m.steps : null, expectedModel: m && m.id !== 'other' ? modelName(m) : '', prev: S.baseline ? { energy: S.baseline.energy, volume: S.baseline.volume, hours: S.baseline.hours } : null, lang: S.lang };
    // не дольше ~минуты на фото (+ загрузка движка): иначе честно «не вышло», а не вечное «распознаю…»
    var budget = new Promise(function (ok, bad) { setTimeout(function () { var e = new Error('timeout'); e.code = 'timeout'; bad(e); }, 60000 + 60000 * PH.files.length); });
    Promise.race([y.recognize(PH.files, ctx, PH.ctl.signal, function (i, n, kind) {
      if (PH.gen !== gen) return;
      var msg = kind === 'load' ? t('ph_loading', { p: i }) : kind === 'photo' ? (n > 1 ? t('ph_reading', { i: i, n: n }) : '') : (n > 1 ? t('ph_batch', { i: i, n: n }) : '');
      // общий ход: загрузка движка — первые 15 %, дальше фото по очереди
      PH.pct = Math.max(PH.pct || 2, Math.round(kind === 'load' ? i * 0.15 : 15 + 85 * (i - 0.5) / Math.max(1, n)));
      var pb = document.getElementById('ph-pbar'); if (pb) pb.style.width = PH.pct + '%';
      if (msg === PH.progress) return; PH.progress = msg;
      var el = document.getElementById('ph-progress'); if (el) el.textContent = msg; else if (routeName() === 'photo') render(true);
    }), budget]).then(function (res) {
      if (PH.gen !== gen) return;   // отменили или начали заново — этот результат уже не нужен
      PH.result = res;
      // счётчик воды / света / газа вместо тепла — сказать прямо, а не «не удалось распознать»
      // водомеры (в т. ч. присланные боту) — в ввод воды, с уже прочитанными окнами барабанов
      PH.waterIdx = (res.photos || []).filter(phIsWater).map(function (x) { return x.index; });
      if (PH.waterIdx.length && PH.mode === 'reading' && wmeters().length) {
        var heatRead = (res.photos || []).some(function (x) { return PH.waterIdx.indexOf(x.index) < 0 && x.readings && x.readings.length; });
        if (!heatRead) { PH.status = 'idle'; phToWater(true); return; }
      }
      var anyRead = (res.photos || []).some(function (x) { return x.readings && x.readings.length; });
      // світло/газ (в т. ч. присланные боту) — в их ввод; счётчика такого вида нет — сказать, как добавить
      var simple = ['elec', 'gas'].map(function (k) { return { k: k, idx: (res.photos || []).filter(function (x) { return phSimpleKind(x) === k; }).map(function (x) { return x.index; }) }; }).filter(function (s) { return s.idx.length; })[0];
      if (simple && PH.mode === 'reading' && !anyRead) {
        if (smeters(simple.k).length) { PH.status = 'idle'; phToSimple(simple.k, simple.idx); return; }
        PH.status = 'idle'; PH.error = t('ph_add_' + simple.k); render(true); return;
      }
      var others = (res.photos || []).filter(function (x) { return x.meterType && x.meterType !== 'heat'; });
      if (others.length && !anyRead && !(res.meter && res.meter.modelId)) { PH.status = 'idle'; PH.error = t('ph_not_heat_' + others[0].meterType) + (others[0].meterType === 'water' && !wmeters().length ? ' ' + t('wnp_setup_first') : ''); render(true); return; }
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
      PH.status = 'done'; PH.vals = null; PH.autoWhy = null;
      if (PH.inbox && PH.mode === 'reading' && hcAutoOn() && phAuto()) return;
      PHS.save(false); render(true);
    }, function (e) {
      if (PH.gen !== gen) return;
      if (PH.ctl) try { PH.ctl.abort(); } catch (x) { /* нет */ }
      PH.status = 'idle'; if (e && e.code === 'cancelled') { render(true); return; }
      PH.error = phErr(e && e.code); render(true);
    });
  }
  /** «Скасувати»: бросить ввод целиком — черновик тепла, фото на распознавании, ввод воды — и выйти на главную. */
  function wizCancel(what) {
    if (!confirm(t(what === 'water' || what === 'elec' || what === 'gas' ? 'wz_cancel_q_w' : 'wz_cancel_q'))) return;
    if (what === 'water') { WN.gen = -1; WN = wnFresh(WN.kind); go('home'); return; }
    if (what === 'elec' || what === 'gas') { EN = enFresh(what); go('home'); return; }
    PH.gen = -1; if (PH.ctl) try { PH.ctl.abort(); } catch (e) { /* нет */ }
    phReset('reading'); S.draft = null; delete S._lastCheck; save(); toast(t('wz_cancelled')); go('home');
  }
  /** Фото водомера: распознаватель узнал водомер по надписям или нашёл уверенное окно барабана без экранов тепла.
   *  Электросчётчик с барабаном (НІК 2102) и газовый — не водомер: у них свой ввод. */
  function phIsWater(x) {
    if (!x || phSimpleKind(x)) return false;
    var drum = x.ocr && (x.ocr.drums || []).some(Wt.goodDrum);
    return x.meterType === 'water' || (drum && !(x.readings && x.readings.length) && x.meterType !== 'heat');
  }
  /** Світло чи газ на фото (за написами: кВт·год, imp/kWh, 220 V, 50 Hz, НІК…; газ — G4, Qmax, kPa, марка). Газ — лише за
   *  двома прикметами: Qmax/Qmin бувають і на водомірах. */
  function photoKind(res) {
    if (!res || !window.TeploOCRParse || !TeploOCRParse.meterScores) return null;
    var all = (res.lines || []).map(function (l) { return [l.text].concat(l.alts || []).join(' '); }).join('\n'), s = TeploOCRParse.meterScores(all);
    if (s.heat) return null;
    if (s.electric && s.electric >= s.water && s.electric >= s.gas) return 'elec';
    if (s.gas >= 2 && s.gas > s.water) return 'gas';
    return null;
  }
  /** На фото взагалі не лічильник (афіша, скрин, документ): жодної прикмети лічильника, ні барабана, ні числа від 4 цифр. */
  function noMeterOnPhoto(res) {
    if (!res || !window.TeploOCRParse || !TeploOCRParse.meterScores) return false;
    var all = (res.lines || []).map(function (l) { return [l.text].concat(l.alts || []).join(' '); }).join('\n'), s = TeploOCRParse.meterScores(all);
    return !s.heat && !s.electric && !s.water && !s.gas && !(res.drums || []).some(function (d) { return String(d.text || '').replace(/\D/g, '').length >= 4; }) && !/\d{4}/.test(all.replace(/\s+/g, ''));
  }
  function phSimpleKind(x) { return x && x.ocr ? photoKind(x.ocr) : x && x.meterType === 'electric' ? 'elec' : null; }
  /** Фото світла/газу з пачки (або з бота) → введення світла/газу: прочитане розкладаємо по зонах, як «Розпізнати з фото». */
  function phToSimple(k, idx) {
    var byIdx = {}; (PH.result && PH.result.photos || []).forEach(function (x) { byIdx[x.index] = x; });
    EN = enFresh(k); EN.date = PH.date && PH.date !== today() ? PH.date : '';
    idx.forEach(function (i) { var f = PH.files[i]; if (!f) return; var o = byIdx[i] && byIdx[i].ocr; EN.photos.push({ file: f, url: URL.createObjectURL(f), res: o ? { lines: o.lines || [], drums: o.drums || [] } : null }); });
    inboxDone(); phReset('reading');
    var need = EN.photos.some(function (p) { return !p.res; });
    go(SK[k].nw);
    if (need) enRun([]); else { enAssign(); render(true); enCheck(true); enReport(); }
  }
  /** Фото водомеров из пачки (или из бота) → ввод воды: окна барабанов уже прочитаны — раскладываем по водомерам. */
  function phToWater(all) {
    var idx = PH.waterIdx || [], byIdx = {};
    (PH.result && PH.result.photos || []).forEach(function (x) { byIdx[x.index] = x; });
    WN = wnFresh('hot'); WN.date = PH.date && PH.date !== today() ? PH.date : '';
    idx.forEach(function (i) { var f = PH.files[i]; if (!f) return; var o = byIdx[i] && byIdx[i].ocr; WN.photos.push({ file: f, url: URL.createObjectURL(f), res: o ? { lines: o.lines || [], drums: o.drums || [] } : null, meters: [] }); });
    WN.inbox = idx.map(function (i) { return PH.files[i] && PH.files[i]._srv; }).filter(function (id) { return id && PH.inbox && PH.inbox.indexOf(id) >= 0; });
    if (all) phReset('reading'); else WN.back = 'photo';
    var need = WN.photos.some(function (p) { return !p.res; });
    go('wnew');
    if (need) wnRun([]); else { wnAssign(); render(true); wnCheck(true); }
  }
  /** Автоподача (фото з бота, увімкнено на екрані кабінету ХТМ): чому НЕ вносимо самі — або null, якщо все гаразд.
   *  Вносимо лише те, що прочитано впевнено, повністю й без жодного зауваження перевірки — інакше звичайна перевірка людиною. */
  function phAutoWhy() {
    var p = PH.picked || {}, keys = R.FIELDS.filter(function (f) { return f.key !== 'date'; }).map(function (f) { return f.key; });
    if (PH.waterIdx && PH.waterIdx.length) return { k: 'mixed' };
    if (!S.meter || !model()) return { k: 'meter' };
    if (!S.baseline || !S.baseline.date) return { k: 'base' };
    var miss = keys.filter(function (k) { return !p[k] || String(p[k].value) === ''; });
    if (miss.length) return { k: 'missing', list: miss.map(function (k) { return fieldLabel(k).toLowerCase(); }).join(', ') };
    var unsure = keys.filter(function (k) { return p[k].conflict || !(p[k].confidence >= 0.85); });
    if (unsure.length) return { k: 'unsure', list: unsure.map(function (k) { return fieldLabel(k).toLowerCase(); }).join(', ') };
    if (windowClosed()) return { k: 'closed' };
    if (!hcConn()) return { k: 'cab' };
    var heatPl = places().filter(function (x) { var m = x.id === S.placeId ? S.meter : x.meter; return m && !m.removed; });
    var my = String((S.meter && S.meter.account) || '').replace(/\D/g, ''), acc = hcAcc();
    if (!acc) return { k: 'acc' };
    if (heatPl.length > 1 && acc.acc !== my) return { k: 'place' };   // кілька квартир з опаленням — лише з явно вписаним рахунком
    if (!((S.contacts || {}).phone || HC.st.phone)) return { k: 'phone' };
    var d = phAutoDraft(), res = runCheck(d);
    if (res.verdict !== 'ok') return { k: 'check', res: res };
    return null;
  }
  function phAutoDraft() {
    var p = PH.picked || {}, vals = {}, conf = {};
    R.FIELDS.forEach(function (f) { if (f.key !== 'date' && p[f.key]) { vals[f.key] = String(p[f.key].value); conf[f.key] = p[f.key].confidence; } });
    var d = PH.inboxAt ? R.ymd(new Date(PH.inboxAt * 1000)) : today(); if (d > today()) d = today();
    return { date: d, values: vals, step: steps().length - 1, source: 'photo', photoConf: conf, auto: true, startedAt: new Date().toISOString() };
  }
  /** Усе прочитано й перевірено → запис «перевірено» + черга внесення (робот внесе сам, можна скасувати). true — зроблено. */
  function phAuto() {
    var why = phAutoWhy(); if (why) { PH.autoWhy = why; return false; }
    var files = PH.files.slice(), inbox = PH.inbox;
    S.draft = phAutoDraft(); S._lastCheck = runCheck(S.draft); phReport(S.draft.values);
    var rd = saveReading('checked'); rd.auto = true; delete S._lastCheck;
    PH.inbox = inbox; inboxDone(); phReset('reading');
    Promise.race([VIS().pendingUploads || Promise.resolve(), new Promise(function (ok) { setTimeout(ok, 5000); })]).then(function () { rd.photos = photoRefs(files.map(function (f) { return { file: f }; })); rd.updatedAt = Date.now(); save(); });
    // спершу — «Передайте в ХТМ» цього запису: не вдасться поставити в чергу (мережа, ліміт) — там причина й кнопка «Внести»; вдалося — «Статус»
    S.focusId = rd.id; save(); go('handover'); hcQueue(rd, hcAcc(rd));
    return true;
  }
  function phAutoBanner() {
    var w = PH.autoWhy; if (!w) return '';
    return '<div class="banner warn" data-key="photo-auto-why" data-why="' + esc(w.k) + '">' + ico('info', 22) + '<div><p><b>' + esc(t('ha_why_t')) + '</b></p><p>' + esc(t('ha_why_' + w.k, { list: w.list || '' })) + '</p><p class="small">' + esc(t('ha_why_sub')) + '</p></div></div>';
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
    // фото — к будущей записи истории; копии на сервер ещё грузятся — подождём немного, чтобы не грузить второй раз
    var files = PH.files.filter(function (f, i) { return !(PH.waterIdx && PH.waterIdx.indexOf(i) >= 0); }), dr = S.draft;
    save(); go('check');
    Promise.race([VIS().pendingUploads || Promise.resolve(), new Promise(function (ok) { setTimeout(ok, 5000); })]).then(function () {
      var refs = photoRefs(files.map(function (f) { return { file: f }; }));
      if (S.draft === dr) dr.photos = refs;
      else {   // черновик уже сохранён в историю — фото к этой записи
        var rd = (S.readings || []).filter(function (r) { return r.source === 'photo' && !r.photos && r.htm && r.htm.date === dr.date; }).slice(-1)[0]; if (rd) { rd.photos = refs; rd.updatedAt = Date.now(); } }
      save();
    });
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
    var ru = S.lang === 'ru', m = model(), gSms = today() <= Gs.SMS_UNTIL;
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
        ? '<ul><li><b>Холодная</b> — в КП «Харківводоканал» до 20 числа: бот <a href="https://t.me/hvk_user_bot" target="_blank" rel="noopener">@hvk_user_bot</a>, кабинет billing.vodokanal.kharkov.ua, телефон (057) 707-58-51.</li><li><b>Горячая — в два места</b>: в Водоканал до 20 числа (за водоотведение) и в ХТМ (за саму горячую воду): бот <a href="' + BOT_URL + '" target="_blank" rel="noopener">@KPHTM_Bot</a> или телефон (057) 341-41-40.</li><li>Не пользовались — всё равно передайте те же цифры, иначе начислят по норме.</li><li>Передают целые кубометры — чёрные цифры; красные (литры) не нужны.</li></ul><p>Здесь: карточки «Горячая вода» и «Холодная вода» на главной — плюс сразу открывает ввод, а после сохранения готово сообщение для бота Водоканала.</p>'
        : '<ul><li><b>Холодна</b> — у КП «Харківводоканал» до 20 числа: бот <a href="https://t.me/hvk_user_bot" target="_blank" rel="noopener">@hvk_user_bot</a>, кабінет billing.vodokanal.kharkov.ua, телефон (057) 707-58-51.</li><li><b>Гаряча — у два місця</b>: у Водоканал до 20 числа (за водовідведення) і в ХТМ (за саму гарячу воду): бот <a href="' + BOT_URL + '" target="_blank" rel="noopener">@KPHTM_Bot</a> або телефон (057) 341-41-40.</li><li>Не користувалися — однаково передайте ті самі цифри, інакше нарахують за нормою.</li><li>Передають цілі кубометри — чорні цифри; червоні (літри) не потрібні.</li></ul><p>Тут: картки «Гаряча вода» й «Холодна вода» на головній — плюс одразу відкриває введення, а після збереження готове повідомлення для бота Водоканалу.</p>'],
      ['h-special', ru ? 'Счётчики ELF, TRUST, ЛТЭ, Ultrameter' : 'Лічильники ELF, TRUST, ЛТЕ, Ultrameter', ru
        ? '<p>Эти приборы считают часы работы только когда идёт теплоноситель. ХТМ советует держать расход выше переходного весь отопительный период и разницу температур больше 3 °C — иначе показания могут не принять, и тогда их подают на бумаге в районный филиал.</p>'
        : '<p>Ці прилади рахують години роботи лише коли йде теплоносій. ХТМ радить тримати витрату вищою за перехідну весь опалювальний період і різницю температур більше 3 °C — інакше показання можуть не прийняти, і тоді їх подають паперово в районну філію.</p>'],
      ['h-elec', ru ? 'Свет: когда и куда передавать' : 'Світло: коли й куди передавати', ru
        ? '<p>Показания света принимает <b>Харьковоблэнерго</b> в <b>последние 2 дня месяца и 1–3 числа</b> следующего (поданные 1–3 числа засчитываются на 1-е). Не передали — счёт посчитают «по среднему», потом пересчитают по факту.</p><p>Как: приложение «Харэнерго» (iPhone и Android), Viber-бот Харьковоблэнерго или колл-центр — (057) 342-44-13, (067) 234-04-13, (050) 054-04-13, (063) 054-04-13. Нужен лицевой счёт из платёжки Харьковэнергосбыта — впишите его у счётчика, и сервис подставит его для копирования.</p><p>Только цифры до запятой. У двухзонного счётчика табло само переключается: день — T1 (1.8.1), ночь — T2 (1.8.2); каждую зону — отдельно, не складывая. Общий показатель (1.8.0) не нужен.</p><p>Цена для населения — 4,32 грн за кВт·ч (продлено до 30.04.2027). Ночью (23:00–07:00) по двухзонному — ×0,5; трёхзонный: пик ×1,5, полупик ×1, ночь ×0,4. Дом с электроотоплением и оформленной льготой: 1 октября — 30 апреля 2,64 грн за первые 2000 кВт·ч в месяц — отметьте это у счётчика.</p>'
        : '<p>Показання світла приймає <b>Харківобленерго</b> в <b>останні 2 дні місяця і 1–3 числа</b> наступного (подані 1–3 числа зараховуються на 1-ше). Не передали — рахунок порахують «за середнім», потім перерахують за фактом.</p><p>Як: застосунок «Харенерго» (iPhone і Android), Viber-бот Харківобленерго або кол-центр — (057) 342-44-13, (067) 234-04-13, (050) 054-04-13, (063) 054-04-13. Потрібен особовий рахунок із платіжки Харківенергозбуту — впишіть його в лічильника, і сервіс підставить його для копіювання.</p><p>Лише цифри до коми. У двозонного лічильника табло саме перемикається: день — T1 (1.8.1), ніч — T2 (1.8.2); кожну зону — окремо, не додаючи. Загальний показник (1.8.0) не потрібен.</p><p>Ціна для населення — 4,32 грн за кВт·год (продовжено до 30.04.2027). Вночі (23:00–07:00) за двозонним — ×0,5; тризонний: пік ×1,5, напівпік ×1, ніч ×0,4. Будинок з електроопаленням і оформленою пільгою: 1 жовтня — 30 квітня 2,64 грн за перші 2000 кВт·год на місяць — позначте це в лічильника.</p>'],
      // SMS 4647 закрито з 28.11.2026 (Gs.SMS_UNTIL) — після цього в довідці «Куб» і 0 800 303 104 замість SMS
      ['h-gas', ru ? 'Газ: когда и куда передавать' : 'Газ: коли й куди передавати', ru
        ? '<p>Показания газа передают <b>с 1 по 5 число</b> — на 1-е' + (gSms ? ' (SMS принимают уже с 28-го)' : '') + '. Не передали — начислят по среднему.</p>' + (gSms
          ? '<p>Самое простое — <b>SMS на 4647</b>: 9 цифр лицевого счёта (из платёжки Нафтогаза), пробел, 5 цифр показаний. Впишите счёт у счётчика — сервис соберёт SMS сам, останется нажать «Отправить». SMS принимают до 27 ноября 2026, дальше — приложение «Куб» или 0 800 303 104. Ещё: бот Газсетей в Telegram @mygrmu_bot (его ответ «принято» перешлите нам — отметим «передано»), кабинет Газсетей my.grmu.com.ua, приложение Нафтогаза «Куб», колл-центр (066) 300-28-88, (098) 300-28-88, (093) 300-28-88.</p>'
          : '<p>Самое простое — <b>приложение Нафтогаза «Куб»</b> или бесплатный звонок на <b>0 800 303 104</b> (понадобится лицевой счёт Нафтогаза — 9 цифр из платёжки). SMS на 4647 с 28 ноября 2026 не принимают. Ещё: бот Газсетей в Telegram @mygrmu_bot (его ответ «принято» перешлите нам — отметим «передано»), кабинет Газсетей my.grmu.com.ua, колл-центр (066) 300-28-88, (098) 300-28-88, (093) 300-28-88.</p>') +
          '<p>Записывайте чёрные цифры — целые кубометры; красные (литры) не передают. Цена — Нафтогаз «Фиксированный» 7,96 грн/м³ до 30.04.2027; другой поставщик — впишите свою цену у счётчика. Доставка (распределение) — отдельная плата Газсетям, от показаний не зависит.</p>'
        : '<p>Показання газу передають <b>з 1 по 5 число</b> — станом на 1-ше' + (gSms ? ' (SMS приймають уже з 28-го)' : '') + '. Не передали — нарахують за середнім.</p>' + (gSms
          ? '<p>Найпростіше — <b>SMS на 4647</b>: 9 цифр особового рахунку (з платіжки Нафтогазу), пробіл, 5 цифр показань. Впишіть рахунок у лічильника — сервіс складе SMS сам, залишиться натиснути «Надіслати». SMS приймають до 27 листопада 2026, далі — застосунок «Куб» або 0 800 303 104. Ще: бот Газмереж у Telegram @mygrmu_bot (його відповідь «прийнято» перешліть нам — позначимо «передано»), кабінет Газмереж my.grmu.com.ua, застосунок Нафтогазу «Куб», кол-центр (066) 300-28-88, (098) 300-28-88, (093) 300-28-88.</p>'
          : '<p>Найпростіше — <b>застосунок Нафтогазу «Куб»</b> або безкоштовний дзвінок на <b>0 800 303 104</b> (знадобиться особовий рахунок Нафтогазу — 9 цифр із платіжки). SMS на 4647 з 28 листопада 2026 не приймають. Ще: бот Газмереж у Telegram @mygrmu_bot (його відповідь «прийнято» перешліть нам — позначимо «передано»), кабінет Газмереж my.grmu.com.ua, кол-центр (066) 300-28-88, (098) 300-28-88, (093) 300-28-88.</p>') +
          '<p>Записуйте чорні цифри — цілі кубометри; червоні (літри) не передають. Ціна — Нафтогаз «Фіксований» 7,96 грн/м³ до 30.04.2027; інший постачальник — впишіть свою ціну в лічильника. Доставка (розподіл) — окрема плата Газмережам, від показань не залежить.</p>'],
      ['h-places', ru ? 'Несколько квартир и свой набор счётчиков' : 'Кілька квартир і свій набір лічильників', ru
        ? '<p>Своя квартира, родителей, сдаёте — у каждой свои счётчики, показания, история и счета. Добавить: <b>Настройки → Квартиры → Добавить квартиру</b> или кнопка под списком квартир — три шага: название и адрес, какие счётчики есть (кнопки «+» и «−»), лицевой счёт Водоканала. Потом сервис по очереди предложит настроить каждый счётчик.</p><p>Когда квартир две и больше, <b>главная — список квартир</b>: у каждой видно, что с каждым счётчиком («Передать до 20.11», «Передано») и ближайший срок. Нажмите на квартиру — откроются её счётчики.</p><p>В квартире — только те счётчики, что в ней есть: <b>«Добавить счётчик»</b> (отопление, горячая или холодная вода; газ и свет — скоро). Счётчик можно <b>заменить</b> (новый после поверки или поломки — расход дальше считается от его показаний) или <b>убрать</b> — история останется, вернуть можно на странице квартиры.</p><p>Где вы сейчас — видно сверху: полоса цвета квартиры и её название; вернуться к списку — <b>«Все квартиры»</b>. Если введённое число похоже на показания счётчика другой квартиры, сервис предупредит.</p><p>Напоминания в Telegram приходят одним сообщением на все квартиры, с кнопкой в каждую. Про отдельную квартиру их можно выключить на её странице.</p>'
        : '<p>Своя квартира, батьків, здаєте — у кожної свої лічильники, показання, історія й рахунки. Додати: <b>Налаштування → Квартири → Додати квартиру</b> або кнопка під списком квартир — три кроки: назва й адреса, які лічильники є (кнопки «+» і «−»), особовий рахунок Водоканалу. Потім сервіс по черзі запропонує налаштувати кожен лічильник.</p><p>Коли квартир дві й більше, <b>головна — список квартир</b>: у кожної видно, що з кожним лічильником («Передати до 20.11», «Передано») і найближчий термін. Натисніть на квартиру — відкриються її лічильники.</p><p>У квартирі — лише ті лічильники, що в ній є: <b>«Додати лічильник»</b> (опалення, гаряча чи холодна вода; газ і світло — скоро). Лічильник можна <b>замінити</b> (новий після повірки чи поломки — розхід далі рахується від його показань) або <b>прибрати</b> — історія залишиться, повернути можна на сторінці квартири.</p><p>Де ви зараз — видно вгорі: смужка кольору квартири та її назва; повернутися до списку — <b>«Усі квартири»</b>. Якщо введене число схоже на показання лічильника іншої квартири, сервіс попередить.</p><p>Нагадування в Telegram приходять одним повідомленням на всі квартири, з кнопкою в кожну. Про окрему квартиру їх можна вимкнути на її сторінці.</p>'],
      ['h-gap', ru ? 'Счётчик сняли на ремонт, поверку или поменяли' : 'Лічильник зняли на ремонт, повірку чи поміняли', ru
        ? '<p>На странице счётчика нажмите «Счётчик снимали…» и укажите, когда сняли и поставили и какие были показания. Тарифы те же — меняется только то, как определяют объём. Поверка с демонтажем (Методика распределения №315, разд. I п. 5): квартира не считается без учёта — тепло по среднесуточному потреблению прошлого отопительного периода, вода — по среднесуточному за 12 месяцев до снятия. Поломка, замена, просроченная поверка: показания не принимают, считают как квартире без счётчика — тепло долей общедомового по отапливаемой площади, воду — по норме Харьковводоканала на каждого прописанного. В форме видно, сколько это примерно стоило: по месяцам, Гкал или м³ и грн; сколько платили в месяц, можно записать там же и сравнить.</p><p>Эти месяцы не попадут в статистику, а потребление дальше будет считаться от показаний после установки. Новый теплосчётчик: его показания после установки станут «последними принятыми».</p>'
        : '<p>На сторінці лічильника натисніть «Лічильник знімали…» і вкажіть, коли зняли й поставили та які були показання. Тарифи ті самі — змінюється лише те, як визначають обсяг. Повірка з демонтажем (Методика розподілу №315, розд. I п. 5): квартира не вважається без обліку — тепло за середньодобовим споживанням минулого опалювального періоду, вода — за середньодобовим за 12 місяців до зняття. Поломка, заміна, прострочена повірка: показання не приймають, рахують як квартирі без лічильника — тепло часткою загальнобудинкового за опалюваною площею, воду — за нормою Харківводоканалу на кожну зареєстровану особу. У формі видно, скільки це приблизно коштувало: по місяцях, Гкал чи м³ і грн; скільки платили на місяць, можна записати там само й порівняти.</p><p>Ці місяці не потраплять у статистику, а споживання далі рахуватиметься від показань після встановлення. Новий теплолічильник: його показання після встановлення стануть «останніми прийнятими».</p>'],
      ['h-phones', ru ? 'Телефоны ХТМ' : 'Телефони ХТМ', ru
        ? '<ul><li>Колл-центр: (057) 341-41-40</li><li>Поверка, распломбирование, осмотр узла учёта: 050-670-13-45</li><li>Прибор отсутствует в базе: 067-370-87-75</li></ul>'
        : '<ul><li>Кол-центр: (057) 341-41-40</li><li>Повірка, розпломбування, огляд вузла обліку: 050-670-13-45</li><li>Прилад відсутній у базі: 067-370-87-75</li></ul>']
    ];
    var byId = {}; secs.forEach(function (x) { byId[x[0]] = { title: x[1], html: x[2] }; });
    var photoTips = '<ul>' + t('ph_tips').split('|').map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    var groups = [
      { id: 'hg-send', title: t('hg_send'), icon: 'calendar', items: [byId['h-window'], byId['h-sameday'], byId['h-how'], { title: t('ph_tips_t'), html: photoTips }] },
      { id: 'hg-reject', title: t('hg_reject'), icon: 'alert', items: [byId['h-robot'], byId['h-special'], byId['h-off']] },
      { id: 'hg-other', title: t('hg_other'), icon: 'info', items: [byId['h-places'], byId['h-elec'], byId['h-gas'], byId['h-hw'], byId['h-gap'], byId['h-phones']] }
    ];
    groups[0].items[0].open = true;
    return '<div class="help-doc"><h1>' + esc(t('help_title')) + '</h1><nav class="toc" aria-label="' + esc(t('help_title')) + '">' + groups.map(function (g) { return '<button type="button" class="tocb" data-act="scroll" data-target="' + g.id + '">' + esc(g.title) + '</button>'; }).join('') + '</nav>' +
      accGroups(groups, 'help-groups') + '</div>';
  }

  // ---------------- маршрутизация ----------------
  // Telegram открывает Mini App с «#tgWebAppData=…» — это не экран, а данные входа: считаем главной (иначе журнал писал «tgWebAppDataquery_id…»)
  function routeName() { var h = (location.hash || '').replace(/^#/, ''); return /^tgWebApp/.test(h) ? '' : h; }
  function render(keepScroll) {
    if (JRS && JRS.scr !== (routeName() || 'home')) { JRS.scr = routeName() || 'home'; track('screen'); }
    lastHash = location.hash;
    var r = routeName();
    // в квартире нет теплосчётчика (или его прибрали) — экраны ввода тепла ведут на главную; вкладки показывают то, что есть
    if (S.onboarded && !hasHeat() && /^(heat|step-\d+|check|handover|status)$/.test(r)) { r = 'home'; try { history.replaceState(null, '', '#home'); } catch (e0) { /* старый браузер */ } }
    if (S.onboarded && !S.meter && r === 'baseline') r = 'meter';
    // світла в квартирі немає (або прибрали) — сторінка світла веде на головну
    if (S.onboarded && SK[r] && !smeters(r).length) { r = 'home'; try { history.replaceState(null, '', '#home'); } catch (e1) { /* старий браузер */ } }
    pendingRender = false;
    // вікно Telegram: даних тут ще немає, а вхід за підписом Telegram іде — не показуємо привітання «як новому» (воно лякає: «мої дані зникли»)
    if (!S.onboarded && tgPending() && ['help', 'privacy', 'terms', 'login'].indexOf(r) < 0) r = 'tgwait';
    else if (!S.onboarded && ['welcome', 'start', 'wsetup', 'wadd', 'eadd', 'gadd', 'meter', 'baseline', 'help', 'login', 'photo', 'privacy', 'terms'].indexOf(r) < 0) r = S.meter ? 'baseline' : 'welcome';
    if (S.onboarded && (!r || r === 'welcome' || r === 'start')) r = homeRoute();
    var view;
    var rm = r.match(/^rec-([\w-]+?)(-edit)?$/), wm = r.match(/^wrec-([\w-]+)$/), gn = r.match(/^gap-new-([\w-]+)$/), gm = !gn && r.match(/^gap-([\w-]+)$/), pm = r.match(/^place-([\w-]+)$/), em = r.match(/^erec-([\w-]+)$/);
    if (!gn) GAP_PRESET = null;
    if (PQ && !/^(wadd|eadd|gadd|meter|add-place)$/.test(r)) PQ = null;
    if (pm) view = placeView(pm[1]);
    else if (em) view = erecView(em[1]);
    else if (gn) view = gapView(null, gn[1]);
    else if (gm) view = gapView(gm[1]);
    else if (rm) view = recView(rm[1], !!rm[2]);
    else if (wm) view = wrecView(wm[1]);
    else if (/^step-\d+$/.test(r)) view = (S.meter ? V.step(+r.split('-')[1]) : V.meter());
    else view = (V[r] || V.home)();
    if (!view.route) view.route = r;
    if (FB.open) { var ft = document.getElementById('fb-text'), fc = document.getElementById('fb-contact'); if (ft) FB.text = ft.value; if (fc) FB.contact = fc.value; }
    document.getElementById('root').innerHTML = shell(view);
    document.documentElement.lang = S.lang;
    document.title = view.html.indexOf('lp-hero') >= 0 && SEO_TITLE ? SEO_TITLE : t('brand');   // на лендинге — заголовок для поиска (его ставит index.php)
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

  /** Довгі акордеони (налаштування лічильника, «Куди передати», графік, групи налаштувань, квартира на головній):
   *  унизу розгорнутого — «Згорнути», щоб не шукати шапку вгорі. Додаємо при відкритті — працює й після часткових перемальовувань. */
  var ACC_SEL = 'details.mbox-set, details.wacc, details.gacc, details.pgroup, details.pacc';
  function accFoot(d) {
    if (!d || !d.matches || !d.matches(ACC_SEL) || !d.open) return;
    var last = d.lastElementChild; if (last && last.classList.contains('acc-foot')) return;
    var f = document.createElement('div'); f.className = 'acc-foot';
    f.innerHTML = '<button type="button" class="btn ter sm" data-act="acc-close" data-key="acc-close">' + ico('chev', 18, 'acc-up') + '<span>' + esc(t('acc_close')) + '</span></button>';
    d.appendChild(f);
  }
  document.addEventListener('toggle', function (e) { accFoot(e.target); if (e.target.classList && e.target.classList.contains('ea-more')) EA.more = e.target.open; }, true);
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-act="acc-close"]'); if (!b) return;
    var d = b.closest('details'); if (!d) return; e.preventDefault(); e.stopPropagation(); d.open = false;
    var sm = d.querySelector('summary'); if (sm) { var r = sm.getBoundingClientRect(); if (r.top < 0 || r.top > innerHeight - 60) sm.scrollIntoView({ block: 'start' }); try { sm.focus({ preventScroll: true }); } catch (e1) { /* старий браузер */ } }
  }, true);
  /** «Відгук» (плаваюча кнопка) не закриває головну кнопку форми: коли ряд кнопок мастера/форми на екрані — ховаємо (стилі — лише на телефоні). */
  var FAB_IO = null;
  function fabWatch() {
    if (FAB_IO) { FAB_IO.disconnect(); FAB_IO = null; }
    document.body.classList.remove('fab-off');
    var acts = document.querySelectorAll('main .wiz-actions'); if (!acts.length || !('IntersectionObserver' in window)) return;
    FAB_IO = new IntersectionObserver(function (es) { es.forEach(function (e) { document.body.classList.toggle('fab-off', e.isIntersecting); }); });
    FAB_IO.observe(acts[acts.length - 1]);
  }
  var SCROLL_TO = null;
  function afterRender(r) {
    Array.prototype.forEach.call(document.querySelectorAll(ACC_SEL), accFoot);
    Array.prototype.forEach.call(document.querySelectorAll('details.tips-box > summary'), function (sm) { if (!sm.querySelector('.pacc-chev')) sm.insertAdjacentHTML('beforeend', ico('chev', 18, 'pacc-chev')); });
    enhanceDates(); photoFill(); toastKeep(); fabWatch(); if (Y().account) histFlush();
    // отклик: ушёл дальше привітання/головної — «клацав» (этап 1)
    if (typeof r === 'string' && r && !/^(welcome|home|places)$/.test(r) && VSTAGE < 1) { VSTAGE = 1; visitBump(); }
    if (SCROLL_TO) { var st0 = document.getElementById(SCROLL_TO); SCROLL_TO = null; if (st0) { var pg0 = st0.closest && st0.closest('details.pgroup'); if (pg0 && !pg0.open) { pg0.open = true; PREF_OPEN[pg0.id.slice(3)] = true; } var wa0 = st0.closest && st0.closest('details.wacc'); if (wa0 && !wa0.open) { wa0.open = true; waccStore(wa0)[wa0.id.slice(5)] = true; } st0.scrollIntoView({ block: 'start' }); try { st0.focus({ preventScroll: true }); } catch (e0) { /* старый браузер */ } st0.classList.add('flash'); setTimeout(function () { st0.classList.remove('flash'); }, 1600); } }
    if (Y().mode === 'server') mountTelegramWidget();
    var first = document.querySelector('[data-field]:not([type=radio])');
    if (first && /^step-/.test(r) && window.matchMedia('(min-width: 600px)').matches) first.focus({ preventScroll: true });
    var demo = document.getElementById('p-demo');
    if (demo) demo.addEventListener('change', function () { S.demoToday = demo.value; save(); toast(t('b_saved')); });
  }

  // ---------------- действия ----------------
  // тост переживает перерисовку: «Збережено» и сразу переход на другой экран — иначе новый экран его стирал
  var TOAST = { msg: '', until: 0 };
  function toast(msg) {
    track('toast', { m: String(msg == null ? '' : msg).slice(0, 120) });
    TOAST = { msg: msg, until: Date.now() + 2400 };
    var host = document.getElementById('toast-host'); if (!host) return;
    host.innerHTML = '<div class="toast">' + esc(msg) + '</div>';
    clearTimeout(toast._t); toast._t = setTimeout(function () { TOAST.until = 0; var h = document.getElementById('toast-host'); if (h) h.innerHTML = ''; }, 2400);
  }
  function toastKeep() { if (TOAST.until > Date.now()) { var h = document.getElementById('toast-host'); if (h && !h.innerHTML) h.innerHTML = '<div class="toast">' + esc(TOAST.msg) + '</div>'; } }
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
    if (S.draft.photos && S.draft.photos.length) rd.photos = S.draft.photos.slice();
    S.readings.push(rd); S.draft = null; S.focusId = rd.id; save();
    return rd;
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var act = el.getAttribute('data-act');
    if (waterAct(act, el, e)) return;
    if (billAct(act, el, e)) return;
    switch (act) {
      case 'start': break;
      case 'read': newDraft(); go('step-0'); break;
      case 'restart': newDraft(); go('step-0'); break;
      case 'pick-model': S._pickModel = el.value; render(true); break;
      case 'save-meter': {
        var id = S._pickModel || (S.meter && S.meter.modelId); var pm = M.byId(id); if (!pm) return;
        var u = document.querySelector('input[name="unit"]:checked');
        S.meter = Object.assign({}, S.meter || {}, { modelId: id, unit: u ? u.value : pm.unit }); delete S.meter.removed;   // выбрали заново — опалення снова в квартире
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
      case 'save-inter': saveReading('intermediate'); toast(t('c_saved_inter') + inPlace()); go('home'); break;
      case 'to-handover': if (el.disabled) return; saveReading('checked'); go('handover'); break;
      case 'copy': copyText(el.getAttribute('data-text'), el); break;
      case 'copy-in': { var ci = document.getElementById(el.getAttribute('data-for')), cv = ci ? String(ci.value || '').trim() : ''; if (cv) copyText(cv, el); else toast(t('copy_empty')); break; }
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
      case 'hp-add-place': hpAddPlace(); break;
      case 'hp-edit': HP_EDIT = el.getAttribute('data-id'); render(true); setTimeout(function () { var f = document.getElementById('hpa-' + HP_EDIT); if (f) f.focus(); }, 30); break;
      case 'hp-cancel': HP_EDIT = ''; render(true); break;
      case 'gpv-all': GPV.pick[el.getAttribute('data-id')] = true; GPV_OPEN[el.getAttribute('data-id')] = true; render(true); break;
      case 'gpv-set': { var gp = place(el.getAttribute('data-id')); if (gp) { gp.gpv = el.getAttribute('data-q'); delete gp.gpvAuto; gp.updatedAt = Date.now(); delete GPV.pick[gp.id]; save(); toast(t('gpv_saved', { q: gp.gpv })); SCROLL_TO = 'gpv-' + gp.id; render(true); } break; }
      case 'gpv-change': GPV.pick[el.getAttribute('data-id')] = true; GPV_OPEN[el.getAttribute('data-id')] = true; SCROLL_TO = 'gpv-' + el.getAttribute('data-id'); render(true); break;
      case 'gpv-cancel': delete GPV.pick[el.getAttribute('data-id')]; render(true); break;
      case 'hp-chip': { var hn = document.getElementById('hpn-' + el.getAttribute('data-id')); if (hn) { hn.value = el.getAttribute('data-v'); hn.focus(); } break; }
      case 'pl-add': PW = pwFresh(routeName() || homeRoute()); go('add-place'); break;
      case 'aw-next': pwRead();
        if (PW.first && pwKind(PW.step) === 'kinds' && !pwAny()) { PW.err = t('fs_err_none'); render(true); var awi = document.querySelector('[data-key=aw-' + KIND_ORDER[0] + '-inc]'); if (awi) awi.focus(); break; }
        PW.err = ''; PW.step++; pwGo(); break;
      case 'aw-back': pwRead(); PW.step = Math.max(0, PW.step - 1); pwGo(); break;
      case 'aw-chip': pwRead(); PW.name = el.getAttribute('data-v'); render(true); break;
      case 'aw-n': { var awk = el.getAttribute('data-kind'), awm = awk === 'heat' ? 1 : KINDS[awk].max; PW.n[awk] = Math.max(0, Math.min(awm, (PW.n[awk] || 0) + Number(el.getAttribute('data-d')))); if (pwAny()) PW.err = ''; render(true);
        var awf = document.querySelector('[data-key=aw-' + awk + '-' + (el.getAttribute('data-d') === '1' ? 'inc' : 'dec') + ']'); if (awf && !awf.disabled) awf.focus(); break; }
      case 'aw-create': pwCreate(el.getAttribute('data-skip') === '1'); break;
      case 'pq-later': {   // водомір є, а № і цифри — пізніше: додаємо без деталей
        if (PQ && PQ.place === S.placeId && PQ.i < PQ.list.length && SK[PQ.list[PQ.i]]) {   // світло/газ: одна зона, рахунок і № — потім у налаштуваннях
          var sk = PQ.list[PQ.i], ssame = smeters(sk), sid = SK[sk].mod.uid();
          setPMeters(function (list) { list.push(Object.assign({ id: sid, kind: sk, name: ssame.length ? String(ssame.length + 1) : '', serial: '', account: '', createdAt: today() }, sk === 'elec' ? { zones: 1 } : { grm: '', eic: '' })); });
          EA = { kind: sk, back: '', zones: 1, vals: {}, f: {} }; PQ.i++; S.onboarded = true; save();
        } else if (PQ && PQ.place === S.placeId && PQ.i < PQ.list.length) { var qk = PQ.list[PQ.i], qsame = wmeters(qk); wsetCfg(function (c) { c.meters = c.meters || []; c.meters.push({ id: Wt.uid(), kind: qk, name: qsame.length ? String(qsame.length + 1) : '', serial: '', vkId: '', verifiedUntil: '' }); }); PQ.i++; S.onboarded = true; save(); }
        pqNext(); break; }
      case 'pl-del': { var dp = place(el.getAttribute('data-id')); if (dp && places().length > 1) { var dl = placeLabel(dp); dp.deleted = true; dp.updatedAt = Date.now(); if (dp.id === S.placeId) { S.placeId = null; S.meter = null; S.baseline = null; S.draft = null; ensurePlaces(); } save(); toast(t('pv_deleted', { p: dl })); go(places().length > 1 ? 'places' : 'home'); } break; }
      case 'focus': S.focusId = el.getAttribute('data-id'); save(); break;
      case 'rec-del-ask': { var bx = document.getElementById('rec-del-confirm'); if (bx) bx.innerHTML = '<div class="banner warn" style="margin-top:16px">' + ico('alert', 22) + '<div><p>' + esc(t('rec_del_q')) + '</p><div class="row-actions" style="margin-top:8px"><button class="btn danger solid" data-act="rec-del-yes">' + esc(t('rec_del')) + '</button></div></div></div>'; break; }
      case 'rec-del-yes': { var m2 = routeName().match(/^rec-([\w-]+)$/), rx = m2 && RD().filter(function (x) { return x.id === m2[1]; })[0];
        if (rx) { rx.deleted = true; rx.updatedAt = Date.now(); photoKeep(rx.photos, false); billsDrop(rx.bills); if (S.focusId === rx.id) S.focusId = null; save(); toast(t('rec_deleted')); } go('history'); break; }
      case 'accepted': {
        var ra = RD().filter(function (x) { return x.id === el.getAttribute('data-id'); })[0];
        if (ra) { ra.status = 'accepted'; ra.updatedAt = Date.now(); ra.result = { at: new Date().toISOString() }; S.baseline = Object.assign({}, ra.htm); save(); }
        render(); break;
      }
      case 'show-reject': { var f = document.getElementById('reject-form'); if (f) { f.style.display = ''; document.getElementById('rej-text').focus(); } break; }
      case 'ha-handover': S.focusId = el.getAttribute('data-id'); HC.confirm = null; HC.err = null; save(); go('handover'); break;
      case 'refix': {
        var rr = RD().filter(function (x) { return x.id === el.getAttribute('data-id'); })[0];
        if (rr) { S.draft = { date: rr.htm.date, values: Object.assign({}, rr.raw), step: steps().length - 1, fixOf: rr.id }; save(); go('check'); }
        break;
      }
      case 'to-meter': { e.preventDefault(); SCROLL_TO = 'meter-block'; go('prefs'); break; }
      case 'scroll': { var tg = document.getElementById(el.getAttribute('data-target')); if (tg) tg.scrollIntoView({ behavior: 'smooth', block: 'start' }); break; }
      case 'export': copyText(JSON.stringify(S), el); break;
      case 'wipe-ask': document.getElementById('wipe-confirm').innerHTML = '<div class="confirm"><p>' + esc(t(el.getAttribute('data-test') || (Y().mode === 'server' && Y().account) ? 'tr_confirm' : 'p_wipe_confirm')) + '</p><div class="row-actions" style="margin-top:8px"><button class="btn sec" data-act="wipe-no">' + esc(t('cancel')) + '</button><button class="btn danger solid" data-act="wipe-yes" data-key="prefs-wipe-yes">' + esc(t('p_wipe_yes')) + '</button></div></div>'; break;
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
      case 'ph-stop': PH.gen = -1; if (PH.ctl) PH.ctl.abort(); PH.status = 'idle'; PH.progress = ''; PH.error = ''; render(true); break;
      case 'wiz-cancel': wizCancel(el.getAttribute('data-what') || 'heat'); break;
      case 'ph-water': phToWater(false); break;
      case 'ph-again': PH.status = 'idle'; PHS.save(false); render(true); break;
      case 'ph-new': inboxDone(); phReset(PH.mode); render(true); break;
      case 'inbox-run': inboxRun(); break;
      case 'ph-apply': phApply(); break;
      case 'ph-use-model': { var um = M.byId(el.getAttribute('data-id')); S.meter = Object.assign({}, S.meter || {}, { modelId: um.id, unit: el.getAttribute('data-unit') || um.unit }); save(); toast(t('b_saved')); PH.picked = VIS().pick(PH.result, M.TO_GCAL, energyUnit()); render(true); break; }
      case 'auth-mode': authMode = authMode === 'login' ? 'register' : 'login'; render(true); break;
      case 'logout': ADMIN = null; busy(el); Y().logout().then(function () { S = defaults(); S.lang = browserLang(); ensurePlaces(); lastSig = window.TeploSync.sig(window.TeploSync.payload(S)); persist(); toast(t('logged_out')); go('welcome'); }); break;
      case 'dismiss-sync': S.syncPromptDismissed = true; persist(); render(true); break;
      case 'wipe-no': document.getElementById('wipe-confirm').innerHTML = ''; break;
      case 'wipe-yes': { if (hcOn() && HC.st && HC.st.connected) { Y().api('POST', '/cab/forget', { prov: 'htm' }).catch(function () {}); HC.st = null; HC.at = 0; }   // «стерти все» — і пароль кабінету ХТМ
        var now = Date.now(); S = defaults(); S.lang = browserLang(); S.wipedAt = now; ensurePlaces(); phReset(); FB.open = false; save(); toast(t('p_wiped')); go('welcome'); break; }
    }
  });

  document.addEventListener('change', function (e) {
    var hmf = e.target && e.target.getAttribute && e.target.getAttribute('data-hm');
    if (hmf && S.meter) { var hv = String(e.target.value || '').trim().slice(0, 40), hp = {}; hp[hmf] = hv; S.meter = Object.assign({}, S.meter, hp); save(); toast(t('b_saved')); safeRender(); return; }
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
  document.addEventListener('change', function (e) { if (e.target && e.target.name === 'pv-color') { ensurePlaces(); var pc = place(); pc.color = e.target.value; pc.updatedAt = Date.now(); save(); render(true); var x = document.querySelector('input[name=pv-color]:checked'); if (x) x.focus(); } });
  document.addEventListener('change', function (e) { if (e.target && e.target.id === 'p-normrow') { var v = e.target.value; wsetCfg(function (c) { c.normRow = v; delete c.normCold; delete c.normHot; }); render(true); var x = document.getElementById('p-normrow'); if (x) x.focus(); } });
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.matches('[data-field]') && S.draft) liveCheck(el);
    if (el.matches('[data-contact]')) { S.contacts = S.contacts || {}; S.contacts[el.getAttribute('data-contact')] = el.value.trim(); save(); }
    if (el.getAttribute && el.getAttribute('data-plf')) { ensurePlaces(); var pf = place(), fk = el.getAttribute('data-plf'); if (pf) { pf[fk] = el.value.trim().slice(0, fk === 'name' ? 40 : 120); pf.updatedAt = Date.now(); save(); Array.prototype.forEach.call(document.querySelectorAll('[data-act=pv-chip]'), function (c) { c.setAttribute('aria-pressed', String(c.getAttribute('data-v') === pf.name)); }); } }
    if (el.id === 'pl-name' || el.getAttribute && el.getAttribute('data-plname')) { var pp = place(el.getAttribute('data-plname') || S.placeId); if (pp) { pp.name = el.value.trim().slice(0, 120); pp.updatedAt = Date.now(); save(); } }
    if (el.getAttribute && el.getAttribute('data-wt')) {
      var wk = el.getAttribute('data-wt'), wv = el.value.trim() === '' ? null : R.num(el.value.replace(',', '.'));
      S.wtariff = Object.assign({}, S.wtariff || {}); if (wv && wv > 0 && wv < 10000) S.wtariff[wk] = wv; else delete S.wtariff[wk]; save();
    }
    if (el.id === 'p-area') { var an = el.value.trim() === '' ? null : R.num(el.value.replace(',', '.')); ensurePlaces(); var pa = place(); if (pa && (an === null || (an > 0 && an < 10000))) { if (an === null) delete pa.area; else pa.area = an; pa.updatedAt = Date.now(); save(); } }
    if (el.getAttribute && el.getAttribute('data-nm') && el.tagName === 'INPUT') {
      var nk = el.getAttribute('data-nm'), nv = el.value.trim() === '' ? null : R.num(el.value.replace(',', '.'));
      if (nv === null || (nv > 0 && nv < (nk === 'persons' ? 50 : 100))) wsetCfg(function (c) { if (nv === null) delete c[nk]; else c[nk] = nk === 'persons' ? Math.round(nv) : nv; });
    }
    if (el.id === 'p-tariff') { var tn = R.num(el.value.replace(',', '.')); if (tn && tn > 0 && tn < 100000) { tariffSet(tn); save(); } }
    if (el.id === 'p-abon' || el.id === 'p-mzk') {
      var bv = el.value.trim() === '' ? (el.id === 'p-mzk' ? 0 : R.C.ABON) : R.num(el.value.replace(',', '.'));
      if (bv !== null && bv >= 0 && bv < 10000) { ensurePlaces(); var pb = place(); pb.bill = Object.assign({}, pb.bill || {}); pb.bill[el.id === 'p-abon' ? 'abon' : 'mzk'] = bv; pb.updatedAt = Date.now(); save(); }
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
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('label[for="ph-input"], label[for="wq-files"], label[for="wn-files"], label[for="rp-input"], label[for="en-files"], label[for="eq-files"]')) { e.preventDefault(); var fi = document.getElementById(e.target.getAttribute('for')); if (fi) fi.click(); return; }
    if (e.key === 'Enter' && e.target.matches('#step-form input[data-field]')) {
      e.preventDefault();
      var inputs = Array.prototype.slice.call(document.querySelectorAll('#step-form input[data-field]:not([type=radio])')).filter(function (x) { return x.offsetParent !== null; });
      var idx = inputs.indexOf(e.target);
      if (idx >= 0 && idx < inputs.length - 1) inputs[idx + 1].focus();
      else { var b = document.querySelector('[data-act="step-next"]'); if (b) b.click(); }
    }
  });
  // лічильник знімали: форма периода
  document.addEventListener('change', function (e) {
    var el = e.target; if (!el || !el.closest || !el.closest('#gap-form')) return;
    if (el.id === 'gp-what' && !document.getElementById('gap-form').getAttribute('data-id')) { location.hash = 'gap-new-' + el.value; return; }
    if (el.name === 'gp-reason' && el.value === 'replace') { var fr = document.getElementById('gp-fresh'); if (fr && !fr.checked) { fr.checked = true; el = fr; } }
    if (el.id === 'gp-fresh') ['gp-newmeter', 'gp-heat-note'].forEach(function (k) { var x = document.getElementById(k); if (x) x.hidden = !el.checked; });
    if (el.id === 'gp-pay') el.setAttribute('data-touched', '1');
    if (el.name === 'gp-reason') { var ps = document.getElementById('gp-pay'); if (ps && !ps.getAttribute('data-touched')) ps.value = gapPayDefault({ reason: el.value, what: gapFromForm(el.closest('#gap-form')).what }); }
    gapEstRefresh();
  });
  document.addEventListener('input', function (e) { if (e.target && e.target.closest && e.target.closest('#gap-form') && /^gp-(from|to|vFrom|amount)$/.test(e.target.id)) gapEstRefresh(); });
  /** Пересчитать «Скільки це коштувало» по полям формы (без перерисовки — фокус и клавиатура остаются). */
  function gapEstRefresh() {
    var f = document.getElementById('gap-form'), box = document.getElementById('gp-est'); if (!f || !box) return;
    var g = gapFromForm(f); if (!g.pay) g.pay = gapPayDefault(g);
    var tmp = document.createElement('div'); tmp.innerHTML = gapEstBox(g); if (tmp.firstChild) box.parentNode.replaceChild(tmp.firstChild, box);
  }
  // Mini App: ссылки на t.me — внутри Telegram, остальные внешние — во внешнем браузере (иначе WebView открывает их поверх приложения)
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[target="_blank"][href^="https://"]'), tw = window.Telegram && window.Telegram.WebApp;
    if (!a || !tw || !tw.initData) return;
    var u = a.getAttribute('href');
    if (/^https:\/\/t\.me\//.test(u) && tw.openTelegramLink) { e.preventDefault(); tw.openTelegramLink(u); }
    else if (tw.openLink) { e.preventDefault(); tw.openLink(u); }
  });
  document.addEventListener('submit', function (e) {
    if (e.target.id === 'gap-form') { e.preventDefault(); gapSave(e.target); return; }
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
  // назад/вперёд: после pushState браузер шлёт popstate, а hashchange — не всегда; рисуем один раз на каждый адрес
  var lastHash = null;
  var onNav = function () { if (location.hash === lastHash) return; render(); };
  window.addEventListener('hashchange', onNav); window.addEventListener('popstate', onNav);
  var tw = window.Telegram && window.Telegram.WebApp;
  // аналитика: с чего открыли (телефон / планшет / компьютер, система, Telegram, «Домой») — раз на загрузку; id браузера случайный
  // ---------- журнал действий (/admin → «Журнал», app/journal.php): что человек делал — экраны, нажатия, поля (заполнено/пусто,
  // без значений), сообщения и ошибки, что сохранилось, распознавание фото. Пачками раз в ~4 с и при уходе со страницы. ----------
  var JRS = null;   // {vid, sid, at, q, tm, scr, prev}
  function jrId() { return (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)).replace(/[^a-z0-9]/g, '').slice(0, 16); }
  function track(n, p) {
    if (!JRS) return;
    try {
      var now = Date.now(); if (now - JRS.at > 1800000) JRS.sid = jrId(); JRS.at = now;   // 30 мин тиші — новий сеанс
      try { sessionStorage.setItem('teplo.sid', JSON.stringify({ id: JRS.sid, at: now })); } catch (e) { /* приватний режим */ }
      JRS.q.push({ t: now, n: n, s: routeName() || 'home', p: p });
      if (JRS.q.length > 200) JRS.q.splice(0, JRS.q.length - 200);
      clearTimeout(JRS.tm); JRS.tm = setTimeout(jrFlush, JRS.q.length >= 20 ? 0 : 4000);
    } catch (e) { /* журнал не має ламати застосунок */ }
  }
  function jrFlush() {
    if (!JRS || !JRS.q.length) return;
    // cookie немає (вікно Telegram, що їх не зберігає) — однаково шлемо: сервер приймає журнал без CSRF, інакше такі сеанси зникали б безслідно
    var m = document.cookie.match(/(?:^|; )ts_csrf=([^;]*)/), jh = { 'Content-Type': 'application/json' }; if (m) jh['X-CSRF'] = decodeURIComponent(m[1]);
    while (JRS.q.length) {
      var ev = JRS.q.splice(0, 40);
      try { fetch(window.TEPLO_API + '/events', { method: 'POST', keepalive: true, credentials: 'same-origin', headers: jh,
        body: JSON.stringify({ vid: JRS.vid, sid: JRS.sid, now: Date.now(), ev: ev }) }).catch(function () {}); } catch (e) { /* старий браузер */ }
    }
  }
  /** Що додалося після збереження: квартири (p), лічильники (m), показання (r); li — увійшов (дані йдуть на сервер). */
  function jrCounts() { var a = visitAct(); return { p: (S.places || []).filter(function (x) { return x && !x.deleted; }).length, m: a.meters, r: a.recs }; }
  function jrSaved() {
    if (!JRS) return; var c = jrCounts(), o = JRS.prev, d = {}, any = false; JRS.prev = c; if (!o) return;
    ['p', 'm', 'r'].forEach(function (k) { if (c[k] !== o[k]) { d[k] = c[k] - o[k]; any = true; } });
    if (any) { d.li = window.TeploSync && window.TeploSync.mode === 'server' ? 1 : 0; track('saved', d); }
  }
  /** Розпізнавання фото з записом у журнал: скільки рядків/барабанів знайшов рушій, час, помилка. */
  function ocrRead(file, opts) {
    var t0 = Date.now();
    return window.TeploOCR.read(file, opts).then(function (res) {
      var r = res || {}; track('ocr', { ok: (r.lines && r.lines.length) || (r.drums && r.drums.length) ? 1 : 0, lines: (r.lines || []).length, drums: (r.drums || []).length, ms: Date.now() - t0, w: (file && file.size) ? Math.round(file.size / 1024) : undefined });
      return res;
    }, function (e) { track('ocr', { ok: 0, ms: Date.now() - t0, err: String((e && e.message) || e).slice(0, 100) }); throw e; });
  }
  /** Отклик (для /admin, без личных данных): этап 0 открыл · 1 клацал по экранам · 2 есть счётчик · 3 есть показания; сколько их. */
  var VSTAGE = 0, VACT = { at: 0, key: '' }, VPING = null;
  function visitAct() {
    var live = function (x) { return x && !x.deleted && !x.removed; }, n = 0, rc = 0;
    (S.places || []).forEach(function (p) { if (p && !p.deleted) { if (live(p.meter)) n++; n += ((p.water || {}).meters || []).filter(live).length + (p.meters || []).filter(live).length; } });
    rc = (S.readings || []).filter(function (x) { return x && !x.deleted; }).length + (S.water || []).concat(S.mrecs || []).filter(function (x) { return x && !x.deleted; }).length;   // і стартові: людина вписала цифри
    return { stage: Math.max(VSTAGE, n ? 2 : 0, rc ? 3 : 0), meters: n, recs: rc };
  }
  /** Сделал что-то новое (перешёл на экран, добавил счётчик, внёс показания) — дослать в отклик; не чаще раза в минуту. */
  function visitBump() {
    if (!VPING) return; var a = visitAct(), k = a.stage + '/' + a.meters + '/' + a.recs; if (k === VACT.key) return;
    var wait = Math.max(0, 60000 - (Date.now() - VACT.at)); clearTimeout(VACT.tm);
    VACT.tm = setTimeout(function () { var b = visitAct(), k2 = b.stage + '/' + b.meters + '/' + b.recs; if (k2 === VACT.key) return; VACT.key = k2; VACT.at = Date.now(); VPING(Object.assign({ act: 1 }, b)); }, wait || 1500);
  }
  (function journal() {
    if (!window.TEPLO_API || navigator.webdriver) return;   // проверки сесій (Playwright) — не люди
    try {
      var vid = localStorage.getItem('teplo.vid'); if (!vid) { vid = (Date.now().toString(36) + Math.random().toString(36).slice(2, 12)).replace(/[^a-z0-9]/g, ''); localStorage.setItem('teplo.vid', vid); }
      var o = null; try { o = JSON.parse(sessionStorage.getItem('teplo.sid') || 'null'); } catch (e) { o = null; }
      JRS = { vid: vid, sid: o && o.id && Date.now() - o.at < 1800000 ? o.id : jrId(), at: Date.now(), q: [], tm: null, scr: '', prev: null };
      JRS.prev = jrCounts();
    } catch (e) { JRS = null; return; }
    var tg1 = window.Telegram && window.Telegram.WebApp;
    track('open', { tg: tg1 && tg1.initData ? 1 : 0, w: Math.round(window.innerWidth || 0), lang: S.lang, li: window.TeploSync && window.TeploSync.mode === 'server' ? 1 : 0, places: JRS.prev.p, meters: JRS.prev.m, recs: JRS.prev.r });
    JRS.scr = routeName() || 'home'; track('screen');
    // нажатия: data-act / data-key / підпис кнопки (до 40 знаків)
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest && e.target.closest('[data-act],[data-key],button,a[href],[role=button],label'); if (!el) return;
      var tx = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      track('tap', { a: el.getAttribute('data-act') || undefined, k: el.getAttribute('data-key') || undefined, h: el.tagName === 'A' ? (el.getAttribute('href') || '').slice(0, 60) : undefined, x: tx || undefined });
    }, true);
    // поля: заповнено чи ні, валідне чи ні (значень не пишемо); файли — скільки обрано
    document.addEventListener('change', function (e) {
      var el = e.target; if (!el || !el.tagName || !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) || el.type === 'password') return;
      var chk = el.type === 'checkbox' || el.type === 'radio';
      track('field', { f: (el.id || el.name || el.getAttribute('data-key') || '').slice(0, 40), t: el.type || el.tagName.toLowerCase(), v: chk ? (el.checked ? 1 : 0) : (String(el.value || '').trim() ? 1 : 0),
        ok: el.validity && !chk ? (el.validity.valid ? 1 : 0) : undefined, files: el.type === 'file' ? (el.files || []).length : undefined });
    }, true);
    // помилки JS
    // «Script error.» без файла — чужой скрипт (Telegram, Cloudflare): подробностей браузер не дает, в журнале только шум
    window.addEventListener('error', function (e) { if (/^Script error\.?$/.test(String(e.message || '')) && !e.filename) return; track('js_error', { m: String(e.message || 'error').slice(0, 120), at: String((e.filename || '').split('/').pop() + ':' + (e.lineno || 0) + ':' + (e.colno || 0)).slice(0, 60) }); });
    window.addEventListener('unhandledrejection', function (e) { var r = e.reason; track('js_error', { m: String((r && r.message) || r || 'rejection').slice(0, 120), at: 'promise' }); });
    // повідомлення на сторінці — що людині сказали «не так»: помилки й попередження (role=alert, банери, підказки під полем).
    // Статуси термінів («Передати 1–5 листопада», «сьогодні», графік світла) — не повідомлення: раніше кожна перемальовка
    // писала їх знову (за 05.11 — 90 рядків «alert» на одному екрані). Те саме повідомлення на тому ж екрані — один раз.
    var seen = typeof WeakMap === 'function' ? new WeakMap() : null, said = {}, mt = null;
    if (seen && window.MutationObserver) new MutationObserver(function () {
      clearTimeout(mt); mt = setTimeout(function () {
        [].forEach.call(document.querySelectorAll('[role=alert], .banner.warn, .banner.bad, .help.warn, .help.bad, .warn-ink'), function (el) {
          var tx = (el.textContent || '').replace(/\s+/g, ' ').trim(); if (!tx || seen.get(el) === tx || el.offsetParent === null) return;
          seen.set(el, tx); var sk = routeName() + '|' + tx; if (said[sk]) return; said[sk] = 1;
          track('alert', { m: tx.slice(0, 120), k: el.getAttribute('data-key') || undefined });
        });
      }, 400);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    // помилки сервера (4xx/5xx) у запитах застосунку
    var Y0 = window.TeploSync;
    if (Y0 && Y0.api && !Y0.api._jr) {
      var oa = Y0.api;
      Y0.api = function (m, path, body) {
        return oa(m, path, body).then(function (j) { if (j && j._status >= 400 && path !== '/events') track('api_error', { p: String(path || '').split('?')[0].slice(0, 50), c: j._status, e: String(j.error || '').slice(0, 40) || undefined }); return j; },
          function (err) { track('api_error', { p: String(path || '').split('?')[0].slice(0, 50), c: 0, e: 'network' }); throw err; });
      };
      Y0.api._jr = 1;
    }
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') jrFlush(); });
    window.addEventListener('pagehide', jrFlush);
  })();
  (function visit() {
    var ap = window.TeploSync && window.TeploSync.api; if (!ap || !window.TEPLO_API) return;
    if (navigator.webdriver) return;   // проверки сессий (Playwright, «Linux 1440 px») — не люди, в «С чего работают» не считаем
    try {
      var vid = localStorage.getItem('teplo.vid'); if (!vid) { vid = (Date.now().toString(36) + Math.random().toString(36).slice(2, 12)).replace(/[^a-z0-9]/g, ''); localStorage.setItem('teplo.vid', vid); }
      var ua = navigator.userAgent || '', ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
      var tablet = ipad || (/Android/.test(ua) && !/Mobile/.test(ua)) || /Tablet|PlayBook|Silk|Kindle/.test(ua), mobile = !tablet && /Mobi|iPhone|iPod|Android|Windows Phone/.test(ua);
      var os = /iPhone|iPod/.test(ua) || ipad ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux|CrOS/.test(ua) ? 'Linux' : 'other';
      var tg0 = window.Telegram && window.Telegram.WebApp, pwa = !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
      var base = { vid: vid, device: tablet ? 'tablet' : mobile ? 'mobile' : 'desktop', os: os, tg: !!(tg0 && tg0.initData), pwa: pwa, sw: Math.round(screen.width || 0) };
      VPING = function (extra) { ap('POST', '/visit', Object.assign({}, base, extra || {})).catch(function () {}); };
      setTimeout(function () { var a = visitAct(); VACT.key = a.stage + '/' + a.meters + '/' + a.recs; VACT.at = Date.now(); VPING(a); }, 1500);
    } catch (e) { /* без localStorage — не считаем */ }
  })();
  if (tw && tw.initData) { try { tw.ready(); tw.expand(); applyTheme(); if (tw.onEvent) tw.onEvent('themeChanged', function () { applyTheme(); safeRender(); }); } catch (e) { /* старый клиент */ } }
  if (window.TEPLO_API && window.TeploVision) window.TeploVision.initServer({}, false);
  // кнопка из напоминания бота: ?go=wnew — ввод воды, ?go=heat — тепло
  function deepLink(g, pid, q) {
    // напоминание про конкретную квартиру — сразу в неё
    if (pid && place(pid)) { switchPlace(pid); WX.key = ''; }
    // графік відключень з ранкового повідомлення: сторінка світла квартири з розгорнутим блоком (без електролічильника — екран квартири)
    if (g === 'gpv') { var gpl = (pid && place(pid)) || places().filter(function (x) { return gpvHas(x) && x.gpv; })[0] || place(); g = 'home';
      if (gpl) { if (gpl.id !== S.placeId) { switchPlace(gpl.id); WX.key = ''; } GPV_OPEN[gpl.id] = true; SCROLL_TO = 'gpv-' + gpl.id; g = smeters('elec').length ? 'elec' : 'place-' + gpl.id; } }
    try { history.replaceState(null, '', location.pathname + q + '#' + g); } catch (e) { location.hash = g; }
    if (g === 'wnew') WN = wnFresh(wmeters('hot').length ? 'hot' : 'cold');
    if (g === 'enew' || g === 'gnew') EN = enFresh(g === 'gnew' ? 'gas' : 'elec');
  }
  var DEEP = null, TGS = '';
  (function () {
    var g = (location.search.match(/[?&]go=(wnew|heat|enew|elec|gnew|gas|home|places|water-cold|water-hot|gpv)(?=&|$)/) || [])[1]; if (!g) return;
    var pid = (location.search.match(/[?&]place=([\w-]+)(?=&|$)/) || [])[1];
    var q = location.search.replace(/([?&])(go|place)=[\w-]+(?=&|$)/g, '$1').replace(/&{2,}/g, '&').replace(/\?&/, '?').replace(/[?&]$/, '');
    deepLink(g, pid, q);
    // у цьому вікні ще немає квартир (вхід через Telegram триває) — повторимо, коли дані прийдуть із сервера
    var tw2 = window.Telegram && window.Telegram.WebApp;
    if (!S.onboarded || (pid && !place(pid))) if (tw2 && tw2.initData) DEEP = { g: g, pid: pid, q: q };
  })();
  render();
  PHS.restore().then(function (ok) { if (ok && routeName() === 'photo') safeRender(); });
  if (window.TeploSync) {
    var onSync = function () {
      var el = document.getElementById('sync-status'); if (el) el.textContent = syncStatusText();
      if (window.TEPLO_API && window.TeploVision && window.TeploSync._cfg) window.TeploVision.initServer(window.TeploSync._cfg, !!window.TeploSync.account);
      if (!window.TeploSync.account) ADMIN = null; else { checkAdmin(); if (INBOX.items === null || INBOX.auto) loadInbox(); histFlush(); }
      // вхід з’явився/змінився — стан кабінету ХТМ іншого акаунта не показуємо; екрани тепла перемалювати (вони залежать від входу)
      var accId = window.TeploSync.account ? window.TeploSync.account.id : 0;
      if (accId !== HC.acc) { HC.acc = accId; HC.st = null; HC.at = 0; HC.check = null; HC.err = null; HC.form = null; if (/^(heat|handover|status|htmcab)$/.test(routeName())) safeRender(); }
      var tgs = window.TeploSync.tg ? window.TeploSync.tg.state : '';
      if (tgs !== TGS) {
        TGS = tgs; var g = window.TeploSync.tg || {}, tw3 = window.Telegram && window.Telegram.WebApp;
        if (tgs === 'ok' || tgs === 'fail') track('tg_login', { ok: tgs === 'ok' ? 1 : 0, c: g.code || undefined, e: g.err || undefined, ms: g.ms, via: g.via, pf: tw3 && tw3.platform, v: tw3 && tw3.version, ck: /(?:^|; )ts_csrf=/.test(document.cookie) ? 1 : 0 });
        safeRender();
      } else if (['prefs', 'login', 'welcome', 'home', 'meter', 'baseline', 'tgwait'].indexOf(routeName() || 'welcome') >= 0 || /^step-/.test(routeName())) safeRender();
      // карточка записи: вход/выход меняет блок платёжек — перерисовать только его (и только при смене входа: иначе открытый выбор файла потеряется)
      var bx = document.querySelector('section.bills[data-ref]'); if (bx && (bx.getAttribute('data-acc') === '1') !== !!window.TeploSync.account) billsRefresh(bx.getAttribute('data-ref'));
    };
    window.TeploSync.init(function () { return S; }, applyRemote, onSync);
    if (window.TEPLO_API) window.TeploSync.config().then(function (c) { window.TeploSync._cfg = c; onSync(); }, function () { /* сервер недоступен */ });
  }
  if (window.TeploVision) window.TeploVision.init(function () { if (['home', 'meter', 'photo', 'step-0', ''].indexOf(routeName()) >= 0) safeRender(); });
})();
