/*
 * Теплосервис — синхронизация данных между устройствами.
 * Локальная копия (localStorage) есть всегда: сайт работает и без сети/входа.
 * Бэкенды, по порядку:
 *   server — свой сервер (window.TEPLO_API, напр. '/api'): аккаунт через Telegram или email+пароль;
 *   claude — опубликованный прототип на claude.ai: личный документ data/users/<id>/teplo (возможности db + user);
 *   local  — только этот браузер.
 * Слияние: показания — объединение по id (новее по updatedAt), остальное — из более свежего состояния;
 * wipedAt — «удалить всё» побеждает старые записи.
 */
(function (root) {
  'use strict';
  var SYNC_KEYS = ['v', 'onboarded', 'meter', 'baseline', 'contacts', 'readings', 'draft', 'updatedAt', 'wipedAt'];

  function payload(S) { var o = {}; SYNC_KEYS.forEach(function (k) { if (S[k] !== undefined) o[k] = S[k]; }); return o; }
  function sig(p) { var c = Object.assign({}, p); delete c.updatedAt; return JSON.stringify(c); }
  function ts(x) { var n = typeof x === 'number' ? x : Date.parse(x || 0); return isFinite(n) ? n : 0; }

  /** Слить два состояния (локальное a и удалённое b). Возвращает новое. */
  function merge(a, b) {
    a = a || {}; b = b || {};
    var aT = a.updatedAt || 0, bT = b.updatedAt || 0, newer = bT > aT ? b : a, older = newer === a ? b : a;
    var out = Object.assign({}, older, newer);
    var wiped = Math.max(a.wipedAt || 0, b.wipedAt || 0);
    var map = {};
    (older.readings || []).concat(newer.readings || []).forEach(function (r) {
      if (!r || !r.id) return;
      if (wiped && ts(r.createdAt) <= wiped) return;
      var o = map[r.id];
      if (!o || (r.updatedAt || ts(r.createdAt)) >= (o.updatedAt || ts(o.createdAt))) map[r.id] = r;
    });
    out.readings = Object.keys(map).map(function (k) { return map[k]; }).sort(function (x, y) { return ts(x.createdAt) - ts(y.createdAt); });
    var wipeWins = wiped && newer.wipedAt === wiped;
    out.onboarded = wipeWins ? !!newer.onboarded : !!(a.onboarded || b.onboarded);
    // база (последние принятые ХТМ) — с более поздней датой; при равенстве — из более свежего состояния
    var ba = a.baseline, bb = b.baseline;
    if (wipeWins) out.baseline = newer.baseline || null;
    else if (ba && bb) out.baseline = String(ba.date) === String(bb.date) ? newer.baseline : (String(ba.date) > String(bb.date) ? ba : bb);
    else out.baseline = ba || bb || null;
    out.meter = wipeWins ? (newer.meter || null) : (newer.meter || older.meter || null);
    if (wipeWins) { out.draft = newer.draft || null; out.contacts = newer.contacts || { phone: '', email: '' }; }
    out.updatedAt = Math.max(aT, bT); out.wipedAt = wiped || undefined;
    return out;
  }

  // ---------------- бэкенд: свой сервер ----------------
  function cookie(name) { var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; }
  function api(method, path, body) {
    // CSRF: перед первым изменяющим запросом получить cookie ts_csrf (сервер выдаёт её на любой GET)
    if (method !== 'GET' && !cookie('ts_csrf')) return api('GET', '/config').then(function () { return api(method, path, body); });
    var h = { 'Accept': 'application/json' };
    if (method !== 'GET') { h['Content-Type'] = 'application/json'; h['X-CSRF'] = cookie('ts_csrf'); }
    return fetch(root.TEPLO_API + path, { method: method, headers: h, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (j) { j._status = res.status; return j; }); });
  }

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
      var start = tg && tg.initData ? this.loginTelegramWebApp(tg.initData) : this.refreshMe();
      return start.then(function () { self._startPolling(); }, function () { self._set('local', 'offline'); });
    },
    refreshMe: function () {
      var self = this;
      return api('GET', '/me').then(function (j) { self.serverReachable = true; self.account = j._status === 200 ? j.user : null; return self.account ? self.pull() : self._set('server', 'idle'); });
    },
    pull: function () {
      var self = this; this._set('server', 'syncing');
      return api('GET', '/state').then(function (j) {
        if (j._status !== 200) { if (j._status === 401) self.account = null; self._set('server', 'error'); return; }
        self._version = j.version || 0;
        if (j.state) { self._lastSig = sig(j.state); self._apply(merge(self._get(), j.state)); }
        self._set('server', 'ok'); self._flush();
      });
    },
    _startPolling: function () {
      var self = this;
      var tick = function () { if (self.mode === 'server' && self.account && document.visibilityState === 'visible' && !self._writing) api('GET', '/state?since=' + self._version).then(function (j) { if (j._status === 200 && j.version !== self._version && j.state) { self._version = j.version; self._lastSig = sig(j.state); self._apply(merge(self._get(), j.state)); } }); };
      document.addEventListener('visibilitychange', tick); setInterval(tick, 60000);
    },
    _after: function (j) { if (j._status === 200 && j.user) { this.account = j.user; return this.pull().then(function () { return j; }); } return Promise.resolve(j); },
    login: function (email, password) { var self = this; return api('POST', '/auth/login', { email: email, password: password }).then(function (j) { return self._after(j); }); },
    register: function (email, password) { var self = this; return api('POST', '/auth/register', { email: email, password: password }).then(function (j) { return self._after(j); }); },
    loginTelegramWebApp: function (initData) { var self = this; return api('POST', '/auth/telegram/webapp', { initData: initData }).then(function (j) { self.serverReachable = true; return self._after(j); }); },
    loginTelegramWidget: function (data) { var self = this; return api('POST', '/auth/telegram/widget', data).then(function (j) { return self._after(j); }); },
    linkTelegram: function (data) { var self = this; return api('POST', '/auth/link-telegram', data).then(function (j) { if (j._status === 200) self.account = j.user; self._onChange(); return j; }); },
    setPassword: function (email, password) { var self = this; return api('POST', '/auth/password', { email: email, password: password }).then(function (j) { if (j._status === 200) self.account = j.user; self._onChange(); return j; }); },
    logout: function () { var self = this; return api('POST', '/auth/logout').then(function () { self.account = null; self._lastSig = ''; self._set('server', 'idle'); }); },
    config: function () { return api('GET', '/config'); }
  };

  Sync.merge = merge; Sync.payload = payload; Sync.sig = sig;
  if (typeof module !== 'undefined' && module.exports) module.exports = Sync; else root.TeploSync = Sync;
})(typeof window !== 'undefined' ? window : this);
