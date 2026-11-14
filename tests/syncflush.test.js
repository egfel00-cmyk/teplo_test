// 149-а: зміна «Кому платите» не має губитись, якщо Telegram згорнули раніше, ніж минуло 1,2 с (flushNow), і злите після опитування сервера
// своє новіше (prov за ts) має одразу піти на сервер. Запуск: node tests/syncflush.test.js
'use strict';
let pass = 0, fail = 0; const t = (n, c) => { c ? pass++ : fail++; console.log((c ? '  OK  ' : ' FAIL ') + n); };
const calls = [];
let serverState = null, serverVer = 5;
global.window = global;
global.TEPLO_API = '/api';
global.document = { cookie: 'ts_csrf=tok', visibilityState: 'visible', listeners: {}, addEventListener(n, f) { (this.listeners[n] = this.listeners[n] || []).push(f); } };
global.fetch = (url, o) => {
  o = o || {}; calls.push({ url, method: o.method || 'GET', keepalive: !!o.keepalive, body: o.body ? JSON.parse(o.body) : null });
  let j = {};
  if (url.indexOf('/api/state?since=') === 0) j = { state: serverState, version: serverVer };
  else if (url === '/api/state' && o.method === 'PUT') { serverState = JSON.parse(o.body).state; serverVer++; j = { version: serverVer }; }
  return Promise.resolve({ status: 200, json: () => Promise.resolve(j) });
};
const realSetInterval = global.setInterval; global.setInterval = () => 0;   // опитування — вручну
const Y = require('../web/src/sync.js');
global.setInterval = realSetInterval;
const tick = () => new Promise(r => setTimeout(r, 20));

(async () => {
  let st = { readings: [], updatedAt: 1, places: [{ id: 'main', name: 'Победа', updatedAt: 100, prov: { elec: { own: 1, name: 'Жилстрой', ts: 900 } } }] };
  const applied = [];
  Y._get = () => st; Y._apply = (m) => { applied.push(Y.via); st = m; }; Y._onChange = () => {};
  Y.mode = 'server'; Y.account = { id: 1 }; Y._version = 5;

  // 1. save() → push(): таймер 1,2 с; згорнули одразу — flushNow шле зараз і keepalive
  Y.push(); t('до flushNow нічого не пішло', calls.length === 0);
  Y.flushNow(); await tick();
  const put = calls.find(c => c.method === 'PUT');
  t('flushNow: PUT /state одразу', !!put);
  t('…з keepalive (запит переживе згорнуту сторінку)', put && put.keepalive);
  t('…зі своїм постачальником', put && put.body.state.places[0].prov.elec.name === 'Жилстрой');
  calls.length = 0; Y.flushNow(); await tick();
  t('flushNow без змін — нічого не шле', calls.length === 0);

  // 2. інший пристрій (стара копія, торкнута фоном — квартира новіша) переписав сервер; опитування зливає — наш постачальник новіший за ts
  serverState = { readings: [], updatedAt: 2, places: [{ id: 'main', name: 'Победа', updatedAt: 500, gpv: 3, prov: { elec: { own: 0, ts: 10 } } }] }; serverVer = 9;
  Y._startPolling(); const vis = document.listeners.visibilitychange || []; vis.forEach(f => f()); await tick(); await tick();
  t('опитування: застосовано з позначкою poll', applied.indexOf('poll') >= 0);
  t('…свій постачальник лишився (ts новіший)', st.places[0].prov.elec.own === 1 && st.places[0].prov.elec.name === 'Жилстрой');
  t('…а нове з іншого пристрою (gpv) теж прийшло', st.places[0].gpv === 3);
  const put2 = calls.filter(c => c.method === 'PUT').pop();
  t('…і злите одразу пішло на сервер (без чекання save())', !!put2 && serverState.places[0].prov.elec.name === 'Жилстрой');

  console.log(`\n${pass} ok, ${fail} fail`); process.exit(fail ? 1 : 0);
})();
