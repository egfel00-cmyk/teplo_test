/*
 * Теплосервис — синхронизация данных между устройствами.
 * Локальная копия (localStorage) есть всегда: сайт работает и без сети/входа.
 * Бэкенды, по порядку:
 *   server — свой сервер (window.TEPLO_API, напр. '/api'): аккаунт через Telegram или email+пароль;
 *   claude — опубликованный прототип на claude.ai: личный документ data/users/<id>/teplo (возможности db + user);
 *   local  — только этот браузер.
 * Слияние: показания — объединение по id (новее по updatedAt), остальное — из более свежего состояния;
 * wipedAt — «удалить всё» побеждает старые записи; restoredAt — версия восстановлена из истории на сервере (/admin): отменяет
 *   более ранний wipedAt (иначе устройство, где «стёрли всё», выбросило бы восстановленные записи).
 */
(function (root) {
  'use strict';
  var SYNC_KEYS = ['v', 'onboarded', 'meter', 'baseline', 'contacts', 'readings', 'draft', 'updatedAt', 'wipedAt', 'tariff', 'bill', 'places', 'water', 'remind', 'wtariff', 'mrecs', 'restoredAt'];

  function payload(S) { var o = {}; SYNC_KEYS.forEach(function (k) { if (S[k] !== undefined) o[k] = S[k]; }); return o; }
  function sig(p) { var c = Object.assign({}, p); delete c.updatedAt; return JSON.stringify(c); }
  function ts(x) { var n = typeof x === 'number' ? x : Date.parse(x || 0); return isFinite(n) ? n : 0; }

  /** Слить два состояния (локальное a и удалённое b). Возвращает новое. */
  /** Есть ли в состоянии данные человека: счётчик в какой-нибудь квартире или запись (показания, вода, світло/газ). */
  function hasData(st) {
    if (!st) return false;
    var live = function (x) { return x && !x.deleted; };
    if ((st.readings || []).some(live) || (st.water || []).some(live) || (st.mrecs || []).some(live)) return true;
    if (st.meter && !st.meter.removed) return true;
    return (st.places || []).some(function (p) { return live(p) && ((p.meter && !p.meter.removed) || ((p.water || {}).meters || []).some(live) || (p.meters || []).some(live)); });
  }
  function merge(a, b) {
    a = a || {}; b = b || {};
    var aT = a.updatedAt || 0, bT = b.updatedAt || 0, newer = bT > aT ? b : a, older = newer === a ? b : a;
    var out = Object.assign({}, older, newer);
    var wiped = Math.max(a.wipedAt || 0, b.wipedAt || 0), restored = Math.max(a.restoredAt || 0, b.restoredAt || 0);
    if (wiped && restored > wiped) wiped = 0;   // «стереть всё» до восстановления версии из истории — отменено им
    var map = {};
    (older.readings || []).concat(newer.readings || []).forEach(function (r) {
      if (!r || !r.id) return;
      if (wiped && ts(r.createdAt) <= wiped) return;
      var o = map[r.id];
      if (!o || (r.updatedAt || ts(r.createdAt)) >= (o.updatedAt || ts(o.createdAt))) map[r.id] = r;
    });
    out.readings = Object.keys(map).map(function (k) { return map[k]; }).sort(function (x, y) { return ts(x.createdAt) - ts(y.createdAt); });
    // показания воды — так же по id с меткой времени (удалённые — «надгробие» deleted)
    var wm = {};
    (older.water || []).concat(newer.water || []).forEach(function (r) {
      if (!r || !r.id) return;
      if (wiped && ts(r.createdAt) <= wiped) return;
      var o = wm[r.id];
      if (!o || (r.updatedAt || ts(r.createdAt)) >= (o.updatedAt || ts(o.createdAt))) wm[r.id] = r;
    });
    out.water = Object.keys(wm).map(function (k) { return wm[k]; }).sort(function (x, y) { return ts(x.createdAt) - ts(y.createdAt); });
    // показания света (и дальше газа) — так же
    var mm = {};
    (older.mrecs || []).concat(newer.mrecs || []).forEach(function (r) {
      if (!r || !r.id) return;
      if (wiped && ts(r.createdAt) <= wiped) return;
      var o = mm[r.id];
      if (!o || (r.updatedAt || ts(r.createdAt)) >= (o.updatedAt || ts(o.createdAt))) mm[r.id] = r;
    });
    out.mrecs = Object.keys(mm).map(function (k) { return mm[k]; }).sort(function (x, y) { return ts(x.createdAt) - ts(y.createdAt); });
    var wipeWins = wiped && newer.wipedAt === wiped;
    out.onboarded = wipeWins ? !!newer.onboarded : !!(a.onboarded || b.onboarded);
    // база (последние принятые ХТМ) — с более поздней датой; при равенстве — из более свежего состояния
    var ba = a.baseline, bb = b.baseline;
    if (wipeWins) out.baseline = newer.baseline || null;
    else if (ba && bb) out.baseline = String(ba.date) === String(bb.date) ? newer.baseline : (String(ba.date) > String(bb.date) ? ba : bb);
    else out.baseline = ba || bb || null;
    out.meter = wipeWins ? (newer.meter || null) : (newer.meter || older.meter || null);
    // квартиры: по id, у каждой своя метка времени; удалённая квартира (deleted) тоже «надгробие»
    if (wipeWins) out.places = newer.places || [];
    else {
      var pm = {}, order = [];
      (older.places || []).concat(newer.places || []).forEach(function (p) { if (!p || !p.id) return; if (!pm[p.id]) order.push(p.id); if (!pm[p.id] || (p.updatedAt || 0) >= (pm[p.id].updatedAt || 0)) pm[p.id] = p; });
      if (order.length) out.places = order.map(function (k) { return pm[k]; });
    }
    if (wipeWins) { out.draft = newer.draft || null; out.contacts = newer.contacts || { phone: '', email: '' }; }
    out.updatedAt = Math.max(aT, bT); out.wipedAt = wiped || undefined; out.restoredAt = restored || undefined;
    return out;
  }

  // ---------------- бэкенд: свой сервер ----------------
  function cookie(name) { var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; }
  // Сесія вікна Telegram: токен із входу Mini App — на випадок, коли вікно Telegram (Mac) не зберігає cookie. Живе до закриття вікна.
  var SESS = (function () { try { return root.sessionStorage.getItem('teplo.tgs') || ''; } catch (e) { return ''; } })();
  function setSess(t) { SESS = t || ''; try { if (SESS) root.sessionStorage.setItem('teplo.tgs', SESS); else root.sessionStorage.removeItem('teplo.tgs'); } catch (e) { /* без sessionStorage — лише в пам'яті */ } }
  // CSRF-cookie (сервер выдаёт её со страницей и на любой запрос без неё): нет её — ОДИН общий запрос за ней на всех (08.11: параллельные
  // запросы без cookie получали каждый свою, и X-CSRF расходился с cookie → 403 у новых посетителей)
  var CSRF_P = null;
  function csrfReady() {
    if (cookie('ts_csrf') || SESS) return Promise.resolve();
    if (!CSRF_P) CSRF_P = fetch(root.TEPLO_API + '/config', { headers: { 'Accept': 'application/json' }, credentials: 'same-origin' }).then(function () {}, function () {}).then(function () { CSRF_P = null; });
    return CSRF_P;
  }
  function api(method, path, body, again) {
    // перед первым изменяющим запросом — cookie ts_csrf; один раз: если cookie не зберігаються (вікно Telegram), повторювати безкінечно не можна;
    // вхід Mini App і запити з X-Session сервер пускає без неї
    if (method !== 'GET' && !cookie('ts_csrf') && !SESS && !again && path !== '/auth/telegram/webapp') return csrfReady().then(function () { return api(method, path, body, true); });
    var h = { 'Accept': 'application/json' }, sent = '';
    if (method !== 'GET') { h['Content-Type'] = 'application/json'; sent = cookie('ts_csrf'); if (sent) h['X-CSRF'] = sent; }
    if (SESS) h['X-Session'] = SESS;
    return fetch(root.TEPLO_API + path, { method: method, headers: h, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (j) { j._status = res.status; return j; }); })
      .then(function (j) {
        // cookie сменилась, пока запрос летел (соседний ответ выдал новую) — повторить один раз с той, что теперь в браузере
        if (j._status === 403 && j.error === 'csrf' && again !== 2 && cookie('ts_csrf') && cookie('ts_csrf') !== sent) return api(method, path, body, 2);
        return j;
      });
  }
  // Усі запити застосунку до свого API (і прямі fetch з app.js / recognize.js) несуть X-Session, якщо вхід був через Telegram
  if (root.fetch && !root.fetch._teplo) {
    var of = root.fetch.bind(root);
    root.fetch = function (url, opts) {
      try {
        if (SESS && typeof url === 'string' && root.TEPLO_API && url.indexOf(root.TEPLO_API) === 0) {
          opts = Object.assign({}, opts || {}); var hh = new Headers(opts.headers || {}); hh.set('X-Session', SESS); opts.headers = hh;
        }
      } catch (e) { /* старий браузер — як є */ }
      return of(url, opts);
    };
    root.fetch._teplo = true;
  }
  /** Запит із межею часу: вікно Telegram інколи «висить» без відповіді — не чекати вічно. */
  function withTimeout(pr, ms) { return new Promise(function (ok, bad) { var t = setTimeout(function () { bad(new Error('timeout')); }, ms); pr.then(function (v) { clearTimeout(t); ok(v); }, function (e) { clearTimeout(t); bad(e); }); }); }

  var Sync = {
    api: api,
    mode: 'local',          // local | claude | server
    account: null,          // server: {id, email, telegram:{id, username, name}}
    serverReachable: false,
    status: 'idle',         // idle | syncing | ok | error | offline
    _get: null, _apply: null, _onChange: null, _lastSig: '', _writing: false, _again: false, _version: 0, _ref: null,

    /** getState() → текущее состояние; applyRemote(merged) — применить; onChange() — перерисовать статус. */
    init: function (getState, applyRemote, onChange) {
      this._get = getState; this._apply = applyRemote; this._onChange = onChange || function () {};
      var self = this;
      if (root.TEPLO_API) return this._initServer();
      if (root.claude && typeof root.claude.use === 'function') return this._initClaude().catch(function () { self._set('local', 'idle'); });
      return Promise.resolve();
    },
    _set: function (mode, status) { this.mode = mode; this.status = status; this._onChange(); },

    /** Сохранить изменения (вызывается после каждого save()). Пишем не чаще раза в 1,2 с и только при изменении. */
    push: function () {
      if (this.mode === 'local' || (this.mode === 'server' && !this.account)) return;
      var self = this; clearTimeout(this._t); this._t = setTimeout(function () { self._flush(); }, 1200);
    },
    _flush: function () {
      var p = payload(this._get()), s = sig(p);
      if (s === this._lastSig) return;
      if (this._writing) { this._again = true; return; }
      this._writing = true; this.status = 'syncing'; this._onChange();
      var self = this, done = function (ok) { self._writing = false; if (ok) self._lastSig = s; self.status = ok ? 'ok' : 'error'; self._onChange(); if (self._again) { self._again = false; self._flush(); } };
      if (this.mode === 'claude') this._ref.set({ state: p, updatedAt: p.updatedAt || Date.now() }).then(function () { done(true); }, function () { done(false); });
      else if (this.mode === 'server') api('PUT', '/state', { state: p, baseVersion: this._version }).then(function (j) {
        if (j._status === 200) { self._version = j.version; done(true); }
        else if (j._status === 409 && j.state) { self._version = j.version; self._apply(merge(self._get(), j.state)); self._writing = false; self._flush(); }
        else if (j._status === 401) { self.account = null; done(false); }
        else done(false);
      }, function () { self.status = 'offline'; self._writing = false; self._onChange(); });
    },

    // ---- claude.ai (прототип) ----
    _initClaude: function () {
      var self = this;
      return Promise.all([root.claude.use('db'), root.claude.use('user')]).then(function (r) {
        var db = r[0], user = r[1];
        if (!db || !user || typeof user.id !== 'function') return;
        return user.id().then(function (id) {
          if (!id) return;
          self._ref = db.doc('data/users/' + id + '/teplo');
          self._set('claude', 'syncing');
          var first = true, timer = setTimeout(function () { if (first) { self.status = 'offline'; self._onChange(); } }, 10000);
          self._ref.onSnapshot(function (snap) {
            if (snap.metadata && snap.metadata.hasPendingWrites) return;
            if (first) { first = false; clearTimeout(timer); }
            var d = snap.exists ? snap.data() : null;
            if (d && d.state) { var m = merge(self._get(), d.state); self._lastSig = sig(payload(d.state)); self._apply(m); }
            self.status = 'ok'; self._onChange(); self._flush();
          }, function () { clearTimeout(timer); self._set('local', 'error'); });
        });
      });
    },

    // ---- свой сервер ----
    _initServer: function () {
      var self = this;
      var tg = root.Telegram && root.Telegram.WebApp;
      var start = tg && tg.initData ? this.tgLogin() : this.refreshMe();
      return start.then(function () { self._startPolling(); }, function () { self._set('local', 'offline'); });
    },
    /** Вхід у вікні Telegram за підписаними initData. tg = {state: pending|ok|fail, code, err, ms} — застосунок показує «Входимо…»
     *  замість привітання, а при невдачі — причину й «Спробувати ще раз». */
    tg: null,
    tgLogin: function () {
      var self = this, tw = root.Telegram && root.Telegram.WebApp, t0 = Date.now();
      if (!tw || !tw.initData) return this.refreshMe();
      this.tg = { state: 'pending' }; this._onChange();
      return withTimeout(this.loginTelegramWebApp(tw.initData), 15000).then(function (j) {
        if (j && j._status === 200 && self.account) { self.tg = { state: 'ok', ms: Date.now() - t0 }; self._onChange(); return j; }
        var f = { state: 'fail', code: (j && j._status) || 0, err: (j && j.error) || '', ms: Date.now() - t0 };
        // підпис Telegram не прийняли — може, у вікні вже є вхід (cookie чи X-Session): перевіримо, перш ніж казати «не вдалося»
        return self.refreshMe().then(function () { self.tg = self.account ? { state: 'ok', ms: Date.now() - t0, via: 'session', code: f.code, err: f.err } : f; self._onChange(); return j; },
          function () { self.tg = f; self._onChange(); return j; });
      }, function (e) {
        self.tg = { state: 'fail', code: 0, err: String((e && e.message) || 'network').slice(0, 40), ms: Date.now() - t0 }; self._onChange();
        throw e;
      });
    },
    retryTg: function () { var self = this; return this.tgLogin().then(function () { self._set('server', self.status === 'ok' ? 'ok' : 'idle'); }, function () { self._set('local', 'offline'); }); },
    refreshMe: function () {
      var self = this;
      return api('GET', '/me').then(function (j) { self.serverReachable = true; self.account = j._status === 200 ? j.user : null; return self.account ? self.pull() : self._set('server', 'idle'); });
    },
    /** Чей аккаунт в этом браузере (id): пишется после синхронизации, стирается при выходе. Локальные данные без хозяина —
     *  созданы без входа: при входе в аккаунт, где уже есть данные, они НЕ сливаются с ним (иначе «Моя квартира» без входа с тем же
     *  id «main» и свежей меткой затирала квартиру аккаунта — 03.11.2026 у владельца пропали счётчики). */
    _owner: function () { try { return localStorage.getItem('teplo.acct') || ''; } catch (e) { return ''; } },
    _setOwner: function (id) { try { if (id) localStorage.setItem('teplo.acct', String(id)); else localStorage.removeItem('teplo.acct'); } catch (e) { /* без localStorage */ } },
    pull: function (login) {
      var self = this; this._set('server', 'syncing');
      return api('GET', '/state').then(function (j) {
        if (j._status !== 200) { if (j._status === 401) self.account = null; self._set('server', 'error'); return; }
        self._version = j.version || 0;
        var acc = self.account && self.account.id ? String(self.account.id) : '', same = !login || (acc && self._owner() === acc);
        if (j.state) {
          self._lastSig = sig(j.state);
          // вход в аккаунт, где уже есть данные, с чужими/«без входа» данными в браузере — данные аккаунта главнее, локальные не вливаем
          if (!same && hasData(j.state)) self._apply(j.state);
          else self._apply(merge(self._get(), j.state));
        }
        if (acc) self._setOwner(acc);
        self._set('server', 'ok'); self._flush();
      });
    },
    _startPolling: function () {
      var self = this;
      var tick = function () { if (self.mode === 'server' && self.account && document.visibilityState === 'visible' && !self._writing) api('GET', '/state?since=' + self._version).then(function (j) { if (j._status === 200 && j.version !== self._version && j.state) { self._version = j.version; self._lastSig = sig(j.state); self._apply(merge(self._get(), j.state)); } }, function () { /* сеть пропала (iPhone после фона: «Load failed») — следующий раз */ }); };
      document.addEventListener('visibilitychange', tick); setInterval(tick, 60000);
    },
    _after: function (j) { if (j._status === 200 && j.user) { this.account = j.user; return this.pull(true).then(function () { return j; }); } return Promise.resolve(j); },
    login: function (email, password) { var self = this; return api('POST', '/auth/login', { email: email, password: password }).then(function (j) { return self._after(j); }); },
    register: function (email, password) { var self = this; return api('POST', '/auth/register', { email: email, password: password }).then(function (j) { return self._after(j); }); },
    loginTelegramWebApp: function (initData) { var self = this; return api('POST', '/auth/telegram/webapp', { initData: initData }).then(function (j) { self.serverReachable = true; if (j._status === 200 && j.session) setSess(j.session); delete j.session; return self._after(j); }); },
    loginTelegramWidget: function (data) { var self = this; return api('POST', '/auth/telegram/widget', data).then(function (j) { return self._after(j); }); },
    linkTelegram: function (data) { var self = this; return api('POST', '/auth/link-telegram', data).then(function (j) { if (j._status === 200) self.account = j.user; self._onChange(); return j; }); },
    setPassword: function (email, password) { var self = this; return api('POST', '/auth/password', { email: email, password: password }).then(function (j) { if (j._status === 200) self.account = j.user; self._onChange(); return j; }); },
    logout: function () { var self = this; return api('POST', '/auth/logout').then(function () { setSess(''); self.account = null; self._lastSig = ''; self._setOwner(''); self._set('server', 'idle'); }); },
    hasSess: function () { return !!SESS; },
    config: function () { return api('GET', '/config'); }
  };

  Sync.merge = merge; Sync.payload = payload; Sync.sig = sig;
  if (typeof module !== 'undefined' && module.exports) module.exports = Sync; else root.TeploSync = Sync;
})(typeof window !== 'undefined' ? window : this);
