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
  /* Phosphor Icons — MIT License
     
     Copyright (c) 2023 Phosphor Icons
     
     Permission is hereby granted, free of charge, to any person obtaining a copy
     of this software and associated documentation files (the "Software"), to deal
     in the Software without restriction, including without limitation the rights
     to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
     copies of the Software, and to permit persons to whom the Software is
     furnished to do so, subject to the following conditions:
     
     The above copyright notice and this permission notice shall be included in all
     copies or substantial portions of the Software.
     
     THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
     IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
     FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
     AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
     LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
     OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
     SOFTWARE. */
  /** Значки квартир (власник 10.11: «залиті, щоб розрізняти й за значком»; необов'язково) — Phosphor Icons, Fill, MIT © 2023 Phosphor Icons (phosphoricons.com); viewBox 0 0 256 256. */
  var PICONS = {
    'house': '<path d="M224,120v96a8,8,0,0,1-8,8H160a8,8,0,0,1-8-8V164a4,4,0,0,0-4-4H108a4,4,0,0,0-4,4v52a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V120a16,16,0,0,1,4.69-11.31l80-80a16,16,0,0,1,22.62,0l80,80A16,16,0,0,1,224,120Z"/>',
    'building-apartment': '<path d="M240,208h-8V72a8,8,0,0,0-8-8H184V40a8,8,0,0,0-8-8H80a8,8,0,0,0-8,8V96H32a8,8,0,0,0-8,8V208H16a8,8,0,0,0,0,16H240a8,8,0,0,0,0-16ZM80,176H64a8,8,0,0,1,0-16H80a8,8,0,0,1,0,16Zm0-32H64a8,8,0,0,1,0-16H80a8,8,0,0,1,0,16Zm64,64H112V168h32Zm-8-64H120a8,8,0,0,1,0-16h16a8,8,0,0,1,0,16Zm0-32H120a8,8,0,0,1,0-16h16a8,8,0,0,1,0,16Zm0-32H120a8,8,0,0,1,0-16h16a8,8,0,0,1,0,16Zm56,96H176a8,8,0,0,1,0-16h16a8,8,0,0,1,0,16Zm0-32H176a8,8,0,0,1,0-16h16a8,8,0,0,1,0,16Zm0-32H176a8,8,0,0,1,0-16h16a8,8,0,0,1,0,16Z"/>',
    'buildings': '<path d="M239.73,208H224V96a16,16,0,0,0-16-16H164a4,4,0,0,0-4,4V208H144V32.41a16.43,16.43,0,0,0-6.16-13,16,16,0,0,0-18.72-.69L39.12,72A16,16,0,0,0,32,85.34V208H16.27A8.18,8.18,0,0,0,8,215.47,8,8,0,0,0,16,224H240a8,8,0,0,0,8-8.53A8.18,8.18,0,0,0,239.73,208ZM76,184a8,8,0,0,1-8.53,8A8.18,8.18,0,0,1,60,183.72V168.27A8.19,8.19,0,0,1,67.47,160,8,8,0,0,1,76,168Zm0-56a8,8,0,0,1-8.53,8A8.19,8.19,0,0,1,60,127.72V112.27A8.19,8.19,0,0,1,67.47,104,8,8,0,0,1,76,112Zm40,56a8,8,0,0,1-8.53,8,8.18,8.18,0,0,1-7.47-8.26V168.27a8.19,8.19,0,0,1,7.47-8.26,8,8,0,0,1,8.53,8Zm0-56a8,8,0,0,1-8.53,8,8.19,8.19,0,0,1-7.47-8.26V112.27a8.19,8.19,0,0,1,7.47-8.26,8,8,0,0,1,8.53,8Z"/>',
    'barn': '<path d="M240,192h-8V130.57l1.49,2.08a8,8,0,1,0,13-9.3l-40-56a8,8,0,0,0-2-1.94L137,18.77l-.1-.07a16,16,0,0,0-17.76,0l-.1.07L51.45,65.42a8,8,0,0,0-2,1.94l-40,56a8,8,0,1,0,13,9.3L24,130.57V192H16a8,8,0,0,0,0,16H240a8,8,0,0,0,0-16ZM112,80h32a8,8,0,1,1,0,16H112a8,8,0,1,1,0-16Zm52.64,40L128,146.17,91.36,120ZM72,125.83,114.24,156,72,186.17ZM91.36,192,128,165.83,164.64,192ZM184,186.17,141.76,156,184,125.83Z"/>',
    'tree-evergreen': '<path d="M231.19,195.51A8,8,0,0,1,224,200H136v40a8,8,0,0,1-16,0V200H32a8,8,0,0,1-6.31-12.91l46-59.09H48a8,8,0,0,1-6.34-12.88l80-104a8,8,0,0,1,12.68,0l80,104A8,8,0,0,1,208,128H184.36l45.95,59.09A8,8,0,0,1,231.19,195.51Z"/>',
    'flower-tulip': '<path d="M208,48a87.48,87.48,0,0,0-35.36,7.43c-15.1-25.37-39.92-38-41.06-38.59a8,8,0,0,0-7.16,0c-1.14.58-26,13.22-41.06,38.59A87.48,87.48,0,0,0,48,48a8,8,0,0,0-8,8V96a88.11,88.11,0,0,0,80,87.63v35.43L83.58,200.84a8,8,0,1,0-7.16,14.32l48,24a8,8,0,0,0,7.16,0l48-24a8,8,0,0,0-7.16-14.32L136,219.06V183.63A88.11,88.11,0,0,0,216,96V56A8,8,0,0,0,208,48ZM56,96V64.44A72.1,72.1,0,0,1,120,136v31.56A72.1,72.1,0,0,1,56,96Zm144,0a72.1,72.1,0,0,1-64,71.56V136a72.1,72.1,0,0,1,64-71.56Z"/>',
    'plant': '<path d="M205.41,159.07a60.9,60.9,0,0,1-31.83,8.86,71.71,71.71,0,0,1-27.36-5.66A55.55,55.55,0,0,0,136,194.51V224a8,8,0,0,1-8.53,8,8.18,8.18,0,0,1-7.47-8.25V211.31L81.38,172.69A52.5,52.5,0,0,1,63.44,176a45.82,45.82,0,0,1-23.92-6.67C17.73,156.09,6,125.62,8.27,87.79a8,8,0,0,1,7.52-7.52c37.83-2.23,68.3,9.46,81.5,31.25A46,46,0,0,1,103.74,140a4,4,0,0,1-6.89,2.43l-19.2-20.1a8,8,0,0,0-11.31,11.31l53.88,55.25c.06-.78.13-1.56.21-2.33a68.56,68.56,0,0,1,18.64-39.46l50.59-53.46a8,8,0,0,0-11.31-11.32l-49,51.82a4,4,0,0,1-6.78-1.74c-4.74-17.48-2.65-34.88,6.4-49.82,17.86-29.48,59.42-45.26,111.18-42.22a8,8,0,0,1,7.52,7.52C250.67,99.65,234.89,141.21,205.41,159.07Z"/>',
    'heart': '<path d="M240,102c0,70-103.79,126.66-108.21,129a8,8,0,0,1-7.58,0C119.79,228.66,16,172,16,102A62.07,62.07,0,0,1,78,40c20.65,0,38.73,8.88,50,23.89C139.27,48.88,157.35,40,178,40A62.07,62.07,0,0,1,240,102Z"/>',
    'star': '<path d="M234.29,114.85l-45,38.83L203,211.75a16.4,16.4,0,0,1-24.5,17.82L128,198.49,77.47,229.57A16.4,16.4,0,0,1,53,211.75l13.76-58.07-45-38.83A16.46,16.46,0,0,1,31.08,86l59-4.76,22.76-55.08a16.36,16.36,0,0,1,30.27,0l22.75,55.08,59,4.76a16.46,16.46,0,0,1,9.37,28.86Z"/>',
    'sun': '<path d="M120,40V16a8,8,0,0,1,16,0V40a8,8,0,0,1-16,0Zm8,24a64,64,0,1,0,64,64A64.07,64.07,0,0,0,128,64ZM58.34,69.66A8,8,0,0,0,69.66,58.34l-16-16A8,8,0,0,0,42.34,53.66Zm0,116.68-16,16a8,8,0,0,0,11.32,11.32l16-16a8,8,0,0,0-11.32-11.32ZM192,72a8,8,0,0,0,5.66-2.34l16-16a8,8,0,0,0-11.32-11.32l-16,16A8,8,0,0,0,192,72Zm5.66,114.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32-11.32ZM48,128a8,8,0,0,0-8-8H16a8,8,0,0,0,0,16H40A8,8,0,0,0,48,128Zm80,80a8,8,0,0,0-8,8v24a8,8,0,0,0,16,0V216A8,8,0,0,0,128,208Zm112-88H216a8,8,0,0,0,0,16h24a8,8,0,0,0,0-16Z"/>',
    'moon': '<path d="M235.54,150.21a104.84,104.84,0,0,1-37,52.91A104,104,0,0,1,32,120,103.09,103.09,0,0,1,52.88,57.48a104.84,104.84,0,0,1,52.91-37,8,8,0,0,1,10,10,88.08,88.08,0,0,0,109.8,109.8,8,8,0,0,1,10,10Z"/>',
    'mountains': '<path d="M254.88,195.92l-54.56-92.08A15.87,15.87,0,0,0,186.55,96h0a15.85,15.85,0,0,0-13.76,7.84l-15.64,26.39a4,4,0,0,0,0,4.07l26.8,45.47a8.13,8.13,0,0,1-1.89,10.55,8,8,0,0,1-11.8-2.26L101.79,71.88a16,16,0,0,0-27.58,0L1.11,195.94a8,8,0,0,0,1,9.52A8.23,8.23,0,0,0,8.23,208H247.77a8.29,8.29,0,0,0,6.09-2.55A8,8,0,0,0,254.88,195.92ZM64.43,120,88,80l23.57,40ZM140,52a24,24,0,1,1,24,24A24,24,0,0,1,140,52Z"/>',
    'sailboat': '<path d="M160,140V72.85a4,4,0,0,1,7-2.69l55,60.46a8,8,0,0,1,.43,10.26,8.24,8.24,0,0,1-6.58,3.12H164A4,4,0,0,1,160,140Zm87.21,32.53A8,8,0,0,0,240,168H144V8a8,8,0,0,0-14.21-5l-104,128A8,8,0,0,0,32,144h96v24H16a8,8,0,0,0-6.25,13l29.6,37a15.93,15.93,0,0,0,12.49,6H204.16a15.93,15.93,0,0,0,12.49-6l29.6-37A8,8,0,0,0,247.21,172.53Z"/>',
    'key': '<path d="M216.57,39.43A80,80,0,0,0,83.91,120.78L28.69,176A15.86,15.86,0,0,0,24,187.31V216a16,16,0,0,0,16,16H72a8,8,0,0,0,8-8V208H96a8,8,0,0,0,8-8V184h16a8,8,0,0,0,5.66-2.34l9.56-9.57A79.73,79.73,0,0,0,160,176h.1A80,80,0,0,0,216.57,39.43ZM180,92a16,16,0,1,1,16-16A16,16,0,0,1,180,92Z"/>',
    'briefcase': '<path d="M152,112a8,8,0,0,1-8,8H112a8,8,0,0,1,0-16h32A8,8,0,0,1,152,112Zm80-40V200a16,16,0,0,1-16,16H40a16,16,0,0,1-16-16V72A16,16,0,0,1,40,56H80V48a24,24,0,0,1,24-24h48a24,24,0,0,1,24,24v8h40A16,16,0,0,1,232,72ZM96,56h64V48a8,8,0,0,0-8-8H104a8,8,0,0,0-8,8Zm120,57.61V72H40v41.61A184,184,0,0,0,128,136,184,184,0,0,0,216,113.61Z"/>',
    'dog': '<path d="M239.71,125l-16.42-88a16,16,0,0,0-19.61-12.58l-.31.09L150.85,40h-45.7L52.63,24.56l-.31-.09A16,16,0,0,0,32.71,37.05L16.29,125a15.77,15.77,0,0,0,9.12,17.52A16.26,16.26,0,0,0,32.12,144,15.48,15.48,0,0,0,40,141.84V184a40,40,0,0,0,40,40h96a40,40,0,0,0,40-40V141.85a15.5,15.5,0,0,0,7.87,2.16,16.31,16.31,0,0,0,6.72-1.47A15.77,15.77,0,0,0,239.71,125ZM176,208H136V195.31l13.66-13.65a8,8,0,0,0-11.32-11.32L128,180.69l-10.34-10.35a8,8,0,0,0-11.32,11.32L120,195.31V208H80a24,24,0,0,1-24-24V123.11L107.93,56h40.14L200,123.11V184A24,24,0,0,1,176,208Zm-72-68a12,12,0,1,1-12-12A12,12,0,0,1,104,140Zm72,0a12,12,0,1,1-12-12A12,12,0,0,1,176,140Z"/>',
    'cat': '<path d="M222.83,33.54a16,16,0,0,0-18.14,3.15c-.14.14-.26.27-.38.41L187.05,57A111.28,111.28,0,0,0,69,57L51.69,37.1c-.12-.14-.24-.27-.38-.41a16,16,0,0,0-18.14-3.15A16.4,16.4,0,0,0,24,48.46V136c0,49,40.06,89.63,91.56,95.32a4,4,0,0,0,4.44-4v-32l-13.42-13.43a8.22,8.22,0,0,1-.41-11.37,8,8,0,0,1,11.49-.18L128,180.68l10.34-10.35a8,8,0,0,1,11.49.18,8.22,8.22,0,0,1-.41,11.37L136,195.31v32a4,4,0,0,0,4.44,4C191.94,225.62,232,185,232,136V48.46A16.4,16.4,0,0,0,222.83,33.54ZM84,152a12,12,0,1,1,12-12A12,12,0,0,1,84,152Zm20-64a8,8,0,1,1-16,0V69a8,8,0,0,1,16,0Zm32,0a8,8,0,1,1-16,0V64a8,8,0,0,1,16,0Zm16,0V69a8,8,0,0,1,16,0V88a8,8,0,1,1-16,0Zm20,64a12,12,0,1,1,12-12A12,12,0,0,1,172,152Z"/>',
    'graduation-cap': '<path d="M176,207.24a119,119,0,0,0,16-7.73V240a8,8,0,0,1-16,0Zm11.76-88.43-56-29.87a8,8,0,0,0-7.52,14.12L171,128l17-9.06Zm64-29.87-120-64a8,8,0,0,0-7.52,0l-120,64a8,8,0,0,0,0,14.12L32,117.87v48.42a15.91,15.91,0,0,0,4.06,10.65C49.16,191.53,78.51,216,128,216a130,130,0,0,0,48-8.76V130.67L171,128l-43,22.93L43.83,106l0,0L25,96,128,41.07,231,96l-18.78,10-.06,0L188,118.94a8,8,0,0,1,4,6.93v73.64a115.63,115.63,0,0,0,27.94-22.57A15.91,15.91,0,0,0,224,166.29V117.87l27.76-14.81a8,8,0,0,0,0-14.12Z"/>'
  };
  function picon(p, size, cls) { var k = p && p.icon; if (!k || !PICONS[k]) return ''; return '<svg class="picon' + (cls ? ' ' + cls : '') + '" viewBox="0 0 256 256" width="' + size + '" height="' + size + '" fill="currentColor" aria-hidden="true" focusable="false">' + PICONS[k] + '</svg>'; }
  /** Мітка квартири: значок (якщо обрано) або кольорова крапка. */
  function pmark(p, size, dotCls) { return picon(p, size) || '<span class="' + (dotCls || 'pdot') + '" aria-hidden="true"></span>'; }
  function nextColor() { var used = places().map(placeColor); return PCOLORS.filter(function (c) { return used.indexOf(c) < 0; })[0] || PCOLORS[places().length % PCOLORS.length]; }
  /** Где я: шапка квартиры (имя + адрес + цветная полоса) — когда квартир больше одной. compact — на экранах ввода, без перехода. */
  function placeBar(compact) {
    var ps = places(), p = place(); if (ps.length < 2 || !p) return '';
    var sub = placeSub(p);
    var ic = picon(p, compact ? 20 : 28, 'pb-ic');
    if (compact) return '<div class="place-bar compact' + (ic ? ' has-ic' : '') + '" style="--pc:var(--pc-' + placeColor(p) + ')" data-key="place-bar"><span class="small muted">' + esc(t('pb_where')) + '</span><b>' + ic + esc(placeLabel(p)) + '</b>' + (sub ? '<span class="small muted pb-sub">' + esc(sub) + '</span>' : '') + '</div>';
    return '<div class="place-bar' + (ic ? ' has-ic' : '') + '" style="--pc:var(--pc-' + placeColor(p) + ')" data-key="place-bar"><a class="pb-name" href="#home" data-key="place-bar-name" title="' + esc(t('pv_back_all')) + '"><b>' + ic + esc(placeLabel(p)) + '</b>' + (sub ? '<span class="small muted">' + esc(sub) + '</span>' : '') + '</a>' +
      '<a class="btn sec pb-all" href="#home" data-key="place-bar-all">' + ico('back', 18) + '<span>' + esc(t('pv_back_all')) + '</span></a></div>';
  }
  /** История, статистика, экономия при ≥ 2 квартирах: чья — видно сразу и меняется тут же (кнопки с названием и цветом, не список). */
  function placeSwitch() {
    var ps = places(), cur = place(); if (ps.length < 2 || !cur) return '';
    return '<div class="place-sw" role="group" aria-label="' + esc(t('pb_where')) + '" data-key="place-switch"><span class="small muted ps-lbl">' + esc(t('pb_where')) + '</span><div class="ps-btns">' + ps.map(function (p) {
      return '<button type="button" data-act="place-view" data-id="' + esc(p.id) + '" aria-pressed="' + (p.id === cur.id) + '" style="--pc:var(--pc-' + placeColor(p) + ')" data-key="place-sw-' + esc(p.id) + '">' + pmark(p, 18) + '<span>' + esc(placeLabel(p)) + '</span></button>';
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
    var vkb0 = vkbIds(S);
    var keep = { lang: S.lang, demoToday: S.demoToday, focusId: S.focusId, _pickModel: S._pickModel, syncPromptDismissed: S.syncPromptDismissed, placeId: S.placeId, theme: S.theme, themeV: S.themeV, view: S.view, homeOpen: S.homeOpen };
    S = Object.assign(defaults(), m, keep);
    ensurePlaces(); var ap = place(); if (ap && (ap.meter || ap.baseline || S.places.length > 1)) { S.meter = ap.meter || null; S.baseline = ap.baseline || null; }
    lastSig = window.TeploSync.sig(window.TeploSync.payload(S)); persist();
    // кнопка з нагадування відкрилась до входу — тепер квартири є: у потрібну квартиру й лічильник
    if (DEEP && S.onboarded) { var dp = DEEP; DEEP = null; deepLink(dp.g, dp.pid, dp.q); }
    safeRender();
    if (GASMV) { GASMV = false; save(); }
    if (window.TEPLO_API) vkbToast(vkb0);
    if (billAdoptAll()) save();
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
  // ---- тема: авто (как в системе / Telegram) · светлая · тёмная; выбор хранится на этом устройстве, меняется только в Налаштуваннях.
  // 07.11: перемикач у шапці прибрано — хто перемкнув його раніше, один раз повертаємо «як у телефоні»
  if (S.themeV !== 2) { S.theme = 'auto'; S.themeV = 2; persist(); }
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
  // ---- згода на cookie (07.11.2026). Необхідні — завжди (вхід ts_sid, захист ts_csrf, ваші дані в цьому браузері, Cloudflare).
  // Аналітика — журнал дій і позначка «відкрили сайт» з випадковим id браузера (teplo.vid) — лише після згоди; до відповіді події
  // тримаються лише в пам'яті сторінки (погодились — дошлемо, відмовились — стерли). Вибір — у localStorage 'teplo.cc' {v, a, at, id};
  // кожен вибір записується на сервері (POST /api/consent, без IP) — підтвердження згоди. Змінити/відкликати — Налаштування → «Файли cookie»,
  // низ сторінки, «Політика конфіденційності». v — версія категорій: зміниться склад — банер спитає знову; згода діє 12 місяців.
  var CC_V = 1, CC_KEY = 'teplo.cc', CC_DAYS = 365, CCMEM = null;
  var CCU = { open: false, a: false };   // відкрито «Налаштування cookie»; стан перемикача «Аналітика» в ньому
  function ccGet() {
    var c = CCMEM; try { var x = localStorage.getItem(CC_KEY); if (x) c = JSON.parse(x); } catch (e) { /* без сховища — лише пам'ять */ }
    return c && c.v === CC_V && Date.now() - Date.parse(c.at) < CC_DAYS * 86400000 ? c : null;
  }
  function ccOn() { var c = ccGet(); return !!(c && c.a); }
  /** Питати є про що, лише коли сайт працює із сервером (там аналітика) і це не автотест (у них аналітика й так вимкнена). */
  function ccAsk() { return !!window.TEPLO_API && !navigator.webdriver && !ccGet(); }
  function ccSet(a, how) {
    var old = ccGet(), c = { v: CC_V, a: a ? 1 : 0, at: new Date().toISOString(), id: (old && old.id) || jrId() };
    CCMEM = c; try { localStorage.setItem(CC_KEY, JSON.stringify(c)); } catch (e) { /* приватний режим — до кінця сеансу */ }
    var api = window.TeploSync && window.TeploSync.api; if (api && window.TEPLO_API) api('POST', '/consent', { id: c.id, v: CC_V, a: c.a, how: how }).catch(function () {});
    if (a) ccStart(); else ccStop();
  }
  /** Банер при першому відвідуванні: не модальний, внизу; «Прийняти все» і «Відхилити» — однакові кнопки, «Налаштувати» — центр вибору. */
  function ccBanner() {
    if (CCU.open) return ccCenter();
    if (!ccAsk()) return '';
    return '<section class="cc" role="region" aria-labelledby="cc-h" data-key="cc-banner"><h2 id="cc-h">' + ico('info', 20) + '<span>' + esc(t('cc_t')) + '</span></h2>' +
      '<p>' + esc(t('cc_p')) + ' <a href="#privacy" data-key="cc-more">' + esc(t('cc_more')) + '</a></p>' +
      '<div class="cc-acts"><button type="button" class="btn sec" data-act="cc-all" data-key="cc-accept">' + esc(t('cc_accept')) + '</button>' +
      '<button type="button" class="btn sec" data-act="cc-none" data-key="cc-reject">' + esc(t('cc_reject')) + '</button></div>' +
      '<button type="button" class="linkbtn cc-cust" data-act="cc-open" data-key="cc-customize">' + ico('prefs', 18) + '<span>' + esc(t('cc_custom')) + '</span></button></section>';
  }
  /** «Налаштування cookie» (Cookie Preference Center): необхідні — завжди, аналітика — перемикач; зберегти / прийняти все / відхилити все. */
  function ccCenter() {
    var c = ccGet();
    return '<div class="fb-back" data-act="cc-close"></div><div class="fb cc-dlg" role="dialog" aria-modal="true" aria-labelledby="cc-dh" data-key="cc-dialog">' +
      '<h2 id="cc-dh">' + esc(t('cc_set_t')) + '</h2><p class="small muted">' + esc(t('cc_set_p')) + '</p>' +
      '<div class="cc-cat" data-key="cc-cat-need"><div class="cc-row"><b>' + esc(t('cc_need')) + '</b><span class="pill ok">' + esc(t('cc_always')) + '</span></div><p class="small">' + esc(t('cc_need_p')) + '</p></div>' +
      '<div class="cc-cat" data-key="cc-cat-an"><label class="cc-row" for="cc-an"><b>' + esc(t('cc_an')) + '</b><input type="checkbox" role="switch" class="cc-sw" id="cc-an" data-key="cc-analytics"' + (CCU.a ? ' checked' : '') + '></label>' +
      '<p class="small">' + esc(t('cc_an_p')) + '</p></div>' +
      (c ? '<p class="small muted" data-key="cc-now">' + esc(t(c.a ? 'cc_now_yes' : 'cc_now_no', { d: fmtDate(String(c.at).slice(0, 10), true) })) + '</p>' : '') +
      '<div class="cc-dacts"><button type="button" class="btn" data-act="cc-save" data-key="cc-save">' + esc(t('cc_save')) + '</button>' +
      '<button type="button" class="btn sec" data-act="cc-all" data-key="cc-accept-all">' + esc(t('cc_accept')) + '</button>' +
      '<button type="button" class="btn sec" data-act="cc-none" data-key="cc-reject-all">' + esc(t('cc_reject_all')) + '</button></div>' +
      '<p class="small muted">' + esc(t('cc_change')) + ' <a href="#privacy" data-act="cc-close" data-key="cc-policy">' + esc(t('lg_privacy')) + '</a></p></div>';
  }
  function ccOpen() { CCU.open = true; CCU.a = ccOn(); render(true); setTimeout(function () { var x = document.getElementById('cc-an'); if (x) x.focus(); }, 0); }
  /** Відповів у банері чи в налаштуваннях: закрити, коротко підтвердити; фокус — на головне (банер зник). */
  function ccDone(a, how) {
    ccSet(a, how); CCU.open = false; render(true); toast(t(a ? 'cc_ok_yes' : 'cc_ok_no'));
    var m = document.getElementById('main'); if (m && document.activeElement === document.body) try { m.focus({ preventScroll: true }); } catch (e) { /* старий браузер */ }
  }
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
  function field(key) { return R.FIELDS.filter(function (f) { return f.key === key; })[0] || (key === 'flowHours' ? R.FIELD_PD : undefined); }
  function fieldLabel(key) { if (times3() && (key === 'hours' || key === 'errHours')) return t(key === 'hours' ? 'f_bd' : 'f_fd'); var f = field(key); return f ? (S.lang === 'ru' ? f.ru : f.uk) : key; }
  // Форма ХТМ залежить від приладу (скрини власника 12.11.2026): енергія в ГКал або ГДж, часу — 2 колонки або 3 (Bd, Fd, Pd).
  // Усередині застосунку енергія — в Гкал (правила, статистика); назовні (перевірка, «Як передати», «Останні прийняті») — в одиниці кабінету.
  function htmUnit() { var m = S.meter || {}; return m.htmUnit || (energyUnit() === 'GJ' ? 'GJ' : 'Gcal'); }
  function htmAsk() { return energyUnit() !== 'Gcal' && !(S.meter && S.meter.htmUnit); }   // одиницю кабінету не підтверджено — спитати
  function times3() { return !!(S.meter && S.meter.htmTimes === 3); }
  function htmFields() { var f = R.FIELDS.slice(); if (times3()) f.splice(f.map(function (x) { return x.key; }).indexOf('errHours') + 1, 0, R.FIELD_PD); return f; }
  /** Значення для кабінету ХТМ: енергія — в одиниці кабінету (з табло без перерахунку, якщо одиниці збігаються), решта — як formatForHtm. */
  function htmVal(key, h, raw) {
    if (key !== 'energy') return R.formatForHtm(key, h[key]);
    var rn = raw ? R.num(raw.energy) : null; if (rn !== null && htmUnit() === energyUnit()) return rn.toFixed(3);
    var n = R.num(h.energy); return n === null ? '' : (n / (M.TO_GCAL[htmUnit()] || 1)).toFixed(3);
  }
  /** Значення для робота ХТМ (125-а): усі колонки форми кабінету (третій час — якщо він є), енергія — в одиниці кабінету + eunit (сервер перерахує, якщо кабінет в іншій). */
  function htmRobotVals(r) {
    var vals = {}; htmFields().forEach(function (f) { vals[f.key] = htmVal(f.key, r.htm || {}, r.raw); });
    vals.eunit = htmUnit(); return vals;
  }
  /** Форма кабінету ХТМ за рахунком (125-а: сервер бачить заголовки сторінки — GET /api/cab/htm → forms) → «Як у вашому кабінеті ХТМ» лічильника: одиниця й третій час. */
  function hcForms() {
    var fm = (HC.st && HC.st.forms) || {}, accs = Object.keys(fm), ch = false; if (!accs.length) return false;
    var heatPl = places().filter(function (x) { var mm = x.id === S.placeId ? S.meter : x.meter; return mm && !mm.removed; });
    heatPl.forEach(function (p) {
      var cur = p.id === S.placeId, m = cur ? S.meter : p.meter, acc = String(m.account || '').replace(/\D/g, '');
      if (!acc && accs.length === 1 && heatPl.length === 1) acc = accs[0];
      var f = fm[acc]; if (!f) return;
      var upd = {};
      if (f.u && M.TO_GCAL[f.u] && m.htmUnit !== f.u) upd.htmUnit = f.u;
      if (typeof f.t3 === 'boolean' && (m.htmTimes === 3) !== f.t3) upd.htmTimes = f.t3 ? 3 : 2;
      if (!Object.keys(upd).length) return;
      Object.assign(m, upd); if (!cur) p.updatedAt = Date.now(); ch = true;
    });
    return ch;
  }
  /** Блок «Як у вашому кабінеті ХТМ»: одиниця енергії й колонки часу (open — розгорнутий, коли одиницю ще не підтверджено). */
  function htmFormBox(open) {
    var u = htmUnit(), us = ['Gcal', 'GJ', 'MWh', 'kWh'];
    return '<details class="where htm-form" data-key="htm-form"' + (open ? ' open' : '') + '><summary>' + esc(t('hf_title')) + '</summary>' +
      '<p class="small muted">' + esc(t('hf_lead')) + '</p><p><b>' + esc(t('hf_unit')) + '</b></p><div class="choice">' +
      us.map(function (x) { return '<label><input type="radio" name="hf-unit" data-act="hf-unit" value="' + x + '"' + (u === x && !htmAsk() ? ' checked' : '') + '>' + esc(unitLbl(x)) + '</label>'; }).join('') + '</div>' +
      '<p><b>' + esc(t('hf_times')) + '</b></p><div class="choice">' +
      [2, 3].map(function (n) { return '<label><input type="radio" name="hf-times" data-act="hf-times" value="' + n + '"' + ((times3() ? 3 : 2) === n ? ' checked' : '') + '>' + esc(t('hf_t' + n)) + '</label>'; }).join('') + '</div></details>';
  }
  function fieldUnit(key) {
    if (key === 'energy') return unitLbl(energyUnit());
    var u = (field(key) || {}).unit || '';
    if (S.lang === 'ru') u = u.replace('год', 'ч').replace('м³/год', 'м³/ч');
    return u;
  }

  // ---------------- иконки ----------------
  var ICONS = {
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M9.9 5.2A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-2.7 3.6"/><path d="M6.6 6.6C3.9 8.3 2 12 2 12s3.6 7 10 7a9.9 9.9 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
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
    torch: '<path d="M8 3h8v4l-2 3v11h-4V10L8 7z"/><path d="M8 7h8M12 13v2"/>',
    viewfinder: '<path d="M4 9V5h4M16 5h4v4M20 15v4h-4M8 19H4v-4"/><path d="M8.5 10h1.5l1-1.5h2l1 1.5h1.5v5h-7z"/>',
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
    image: '<rect x="3" y="4.5" width="18" height="15" rx="3.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16.5l-5.2-5.2L7 20"/>',
    images: '<rect x="7.5" y="7.5" width="13.5" height="12" rx="2.5"/><path d="M4 15.5V6.5A2.5 2.5 0 0 1 6.5 4H16"/><path d="M21 16.5l-4-4-6.3 6.5"/><circle cx="12" cy="11.5" r="1.2"/>',
    download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
    bill: '<path d="M6 3h12v18l-2.5-1.6L13 21l-2-1.6L9 21l-3-1.8z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
    edit: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
    wrench: '<path d="M14.5 5.5a4 4 0 0 0 4.9 4.9l-8.9 8.9a2 2 0 0 1-2.8-2.8l8.9-8.9a4 4 0 0 0-2.1-2.1z"/><path d="M14.5 5.5L17 3l2.5 2.5"/>',
    trash: '<path d="M4 7h16"/><path d="M18 7v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    swap: '<path d="M16 3l4 4-4 4"/><path d="M20 7H5"/><path d="M8 21l-4-4 4-4"/><path d="M4 17h15"/>',
    phone: '<path d="M5 4h4l1.5 4.5-2.5 1.5a11 11 0 0 0 6 6l1.5-2.5L20 15v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
    send: '<path d="M21 3L3 10.5l7 2.5 2.5 7z"/><path d="M10 13l11-10"/>',
    bolt: '<path d="M13 3L5.5 13.5H11L10 21l7.5-10.5H12z"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
    doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M9.5 12h5M9.5 15.5h5"/>'
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
      return '<div class="line' + (ln.sample ? ' sample' : '') + '"' + (ln.id ? ' id="' + ln.id + '"' : '') + ' data-v="' + esc(String(ln.text == null ? '' : ln.text)) + '">' + segSvg(ln.text, ln.label) + (ln.corner ? '' : tag) + '</div>' + (ln.corner ? tag : '');
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
      return '<div class="line" data-v="' + esc(String(ln.text == null ? '' : ln.text)) + '">' + (ln.zone ? '<span class="el-z">' + esc(ln.zone) + '</span>' : '') + segSvg(ln.text, ln.label) + '</div>';
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
  function steps() {
    var m = model(), st = m ? m.steps : [];
    // кабінет з Bd/Fd/Pd — третій час додаємо до кроку годин (у T330 це «час з витратою» з LOOP 1)
    if (times3() && !st.some(function (s) { return s.fields.indexOf('flowHours') >= 0; })) st = st.map(function (s) { return s.fields.indexOf('errHours') >= 0 ? Object.assign({}, s, { fields: s.fields.concat('flowHours') }) : s; });
    return [{ kind: 'date' }].concat(st);
  }
  /** Підпис дії на кроці (екранований): своя (say) → «Затисніть кнопку й тримайте понад N с, потім коротко ×K» → «Натисніть ×K» → «Шукайте екран». */
  function pressText(s) {
    if (s.say) return esc(L(s.say));
    if (s.press === 'long') return esc(t('s_hold', { s: s.hold || 3 })) + (s.count ? ' <span class="times">' + esc(t('s_hold_then', { n: s.count })) + '</span>' : '');
    if (s.press === null) return esc(t('s_first'));
    return s.count ? esc(t('s_press')) + ' <span class="times">' + esc(t('s_press_n', { n: s.count })) + '</span>' : esc(t('s_press_find'));
  }
  /** Петлі моделі (LOOP 0/1, групи, рівні) — {tip, short}; немає — загальна підказка «затисніть на 3–5 с». */
  function loopsOf(m) { return (m && m.loops) || { tip: M.LOOP_ANY }; }
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
    var cu = htmUnit(), ul = UNIT_LBL[cu] || UNIT_LBL.Gcal;
    return { hoursOnlyWithFlow: !!m.hoursOnlyWithFlow, transitionalFlow: S.meter && R.num(S.meter.transitionalFlow), verifiedUntil: S.meter && S.meter.verifiedUntil || null, times3: times3(),
      cab: { k: M.TO_GCAL[cu] || 1, uk: ul.uk, ru: ul.ru }, screen: { k: M.TO_GCAL[energyUnit()] || 1 } };
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
  function shell(view) {
    var route = view.route, bare = view.bare;
    // 90-а (власник): на комп'ютері й на екранах вводу (майстри, ввід показань, кабінети) — бічне меню розділів; на телефоні їх там немає, як і було
    var side = bare && S.onboarded && !!view.closeTo && route !== 'start';
    var navItems = [[homeRoute(), 'home', 'nav_home'], ['history', 'history', 'nav_history'], ['stats', 'chart', 'nav_stats']].concat([['save', 'leaf', 'nav_save'], ['help', 'help', 'nav_help'], ['prefs', 'prefs', 'nav_prefs']]);
    var nav = bare && !side ? '' : '<nav class="nav' + (side ? ' nav-side' : '') + '" style="--nav-n:' + navItems.length + '" aria-label="' + esc(t('brand')) + '">' + navItems.map(function (n) {
      return '<a href="#' + n[0] + '"' + (route === n[0] || (n[2] === 'nav_home' && /^(home|heat|water-|elec$|gas$|places|place$)/.test(route)) ? ' aria-current="page"' : '') + ' data-key="nav-' + (n[2] === 'nav_home' ? 'home' : n[0]) + '">' + ico(n[1], 22) + '<span>' + esc(t(n[2])) + '</span></a>';
    }).join('') + '</nav>';
    var right = bare && view.closeTo
      ? '<a class="btn ghost" href="#' + view.closeTo + '" data-key="wiz-close" aria-label="' + esc(t('close')) + '">' + ico('close', 22) + '<span class="cl-txt">' + esc(t('close')) + '</span></a>'
      : '';
    return '<div class="app' + (bare ? ' bare-app' : '') + (side ? ' with-side' : '') + '">' +
      '<header class="top' + (right ? ' has-close' : '') + '"><a class="brand" href="#' + homeRoute() + '" data-key="brand">' + logo() + '<span>' + esc(t('brand')) + '</span><span class="beta-tag" data-key="beta">' + esc(t('beta_tag')) + '</span></a>' + '<span class="spacer"></span>' + right + '</header>' +
      nav + '<main class="main' + (bare ? ' bare' : '') + (view.wide ? ' wide' : '') + enterCls(route) + '" id="main" data-screen="' + view.screen + '" tabindex="-1">' + (/^(history|stats|save)$/.test(route) ? placeSwitch() : /^(heat|water-hot|water-cold|elec|gas)$/.test(route) ? placeBar() : /^(wnew|wadd|enew|eadd|gnew|gadd|add-meter|step|step-\d+|check|handover|baseline|meter|photo)$/.test(route) ? placeBar(true) : '') + view.html + '</main>' + (S.onboarded && view.screen !== 'S00' && (!bare || side) ? appFoot() : '') + '</div>' +
      (window.TEPLO_API && !ccAsk() ? '<button class="fab' + (bare ? ' fab-bare' : '') + '" data-act="fb-open" data-key="feedback" aria-haspopup="dialog">' + ico('chat', 20) + '<span>' + esc(t('fb_btn')) + '</span></button>' + fbDialog() : '') +
      (bare ? ccBanner().replace('class="cc"', 'class="cc cc-bare"') : ccBanner()) +
      '<div id="toast-host" aria-live="polite"></div>';
  }


  /** Вхід на головну чи список квартир — картки з’являються м’яко по черзі (раз на вхід, не на кожну перемальовку; «Зменшити рух» і автотести — без). */
  var ENTER_LAST = '';
  function enterCls(route) { var was = ENTER_LAST; ENTER_LAST = route; return route !== was && /^(home|places)$/.test(route) && !navigator.webdriver && !calmMotion() ? ' enter' : ''; }

  // ---------------- отзыв (плавающая кнопка) ----------------
  var FB = { open: false, sending: false, text: '', contact: '', name: null, email: null, tg: null, err: '' };   // 90-а: ім'я, e-mail, Telegram — щоб відповісти (необов'язково)
  function fbDialog() {
    if (!FB.open) return '';
    var acc = Y().account;
    return '<div class="fb-back" data-act="fb-close"></div><div class="fb" role="dialog" aria-modal="true" aria-labelledby="fb-h" data-key="feedback-dialog">' +
      '<h2 id="fb-h">' + esc(t('fb_title')) + '</h2><p class="small muted">' + esc(t('fb_sub')) + '</p>' +
      '<label class="lbl" for="fb-text">' + esc(t('fb_text')) + '</label><textarea id="fb-text" rows="5" maxlength="4000">' + esc(FB.text) + '</textarea>' +
      // як відповісти (власник 10.11): ім'я, e-mail, Telegram — необов'язково; у вошедших підставляємо з акаунта
      (function () { var tg = acc && acc.telegram, v = function (k, d) { return FB[k] !== null ? FB[k] : (d || ''); };
        var f = function (id, k, lbl, type, ac, ph, d, max) { return '<div class="fb-f"><label class="lbl" for="' + id + '">' + esc(t(lbl)) + '</label><input id="' + id + '" type="' + type + '" maxlength="' + max + '" autocomplete="' + ac + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + ' value="' + esc(v(k, d)) + '"></div>'; };
        return '<fieldset class="fb-back-to"><legend class="lbl">' + esc(t('fb_reply')) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></legend><div class="fb-fs">' +
          f('fb-name', 'name', 'fb_name', 'text', 'name', '', (acc && acc.name) || (tg && tg.name) || '', 60) +
          f('fb-tg', 'tg', 'fb_tg', 'text', 'off', '@username', tg && tg.username ? '@' + tg.username : '', 40) +
          f('fb-email', 'email', 'fb_email', 'email', 'email', 'name@example.com', (acc && acc.email) || '', 90) + '</div></fieldset>'; })() +
      (FB.err ? '<p class="help bad" role="alert">' + esc(FB.err) + '</p>' : '') +
      '<div class="row-actions"><button class="btn sec" data-act="fb-close">' + esc(t('cancel')) + '</button><button class="btn" data-act="fb-send" data-key="feedback-send"' + (FB.sending ? ' disabled aria-busy="true"' : '') + '>' + esc(t('fb_send')) + '</button></div></div>';
  }
  function fbSend() {
    var te = document.getElementById('fb-text'), gv = function (id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; };
    FB.text = te ? te.value : FB.text; FB.name = gv('fb-name'); FB.email = gv('fb-email'); FB.tg = gv('fb-tg');
    if (FB.text.trim().length < 2) { FB.err = t('fb_empty'); render(true); return; }
    var main = document.getElementById('main');
    var body = { text: FB.text, name: FB.name, email: FB.email, tg: FB.tg, page: '#' + (routeName() || 'home'), screen: main ? main.getAttribute('data-screen') : '', lang: S.lang };
    var api = window.TeploSync && window.TeploSync.api;
    FB.sending = true; FB.err = ''; render(true);
    (api ? api('POST', '/feedback', body) : Promise.reject()).then(function (j) {
      FB.sending = false;
      if (j && j._status === 200) { FB.open = false; FB.text = ''; FB.name = FB.email = FB.tg = null; render(true); toast(t('fb_ok')); return; }
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
  function wrecs() { return (S.water || []).filter(function (r) { return r && !r.deleted && !r.billOnly && r.place === S.placeId; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.base ? -1 : b.base ? 1 : 0; }); }
  /** Последние внесённые показания (стартовые при настройке — не в счёт: их не передают). */
  function wlast() { var a = wrecs().filter(function (r) { return !r.base && !r.own; }); return a.length ? a[a.length - 1] : null; }
  // «лише для себе» (r.own): показання для статистики — нікуди не передаються; оплата — між переданими показаннями.
  // Стартові (r.base) води/світла/газу вважаємо переданими (так найчастіше), поки людина не зніме позначку (sent.no).
  function baseSent(r) { return !!(r && r.base && !(r.sent && r.sent.no)); }
  /** Перша літера велика — окремі пілюлі й мітки (sentence case); ті самі слова всередині речення лишаються з малої. */
  function ucf(x) { x = String(x || ''); return x.charAt(0).toUpperCase() + x.slice(1); }
  function ownPill() { return '<span class="pill own" data-key="own-pill">' + esc(ucf(t('own_pill'))) + '</span>'; }
  function basePill(r) { return baseSent(r) ? '<span class="pill ok">' + esc(ucf(t('wh_sent'))) + '</span>' : ''; }
  /** Від якої передачі рахується оплата (власник 11.11: «скільки накручено й сума — між показаннями зі статусом "передано"»).
   *  list — записи за датою, has(r) — є значення цього виду, sent(r) — передано. Опора — останнє передане до r (стартові — якщо
   *  позначені переданими); переданих раніше немає — останнє не «для себе». → {rec, date, n} (n — скільки проміжних пропущено) або null,
   *  якщо опора — просто попередній запис (рахуємо як завжди). */
  function paidFrom(list, r, has, sent) { var a = paidAnchor(list, r, has, sent); return a && a.n ? a : null; }
  /** Те саме, але й коли опора — просто попередній запис (n = 0): «Набігло з останньої оплати» в картці запису (власник 11.11, вдруге:
   *  «набігло й затрати — від минулого статусу "передано", а не від останнього запису історії»). → {rec, date, n, sent} або null. */
  function paidAnchor(list, r, has, sent) {
    var before = list.filter(function (x) { return x !== r && !x.deleted && has(x) && (x.date < r.date || (x.date === r.date && x.base && !r.base)); }), at = -1, i, ok = true;
    for (i = before.length - 1; i >= 0 && at < 0; i--) if (!before[i].own && (!sent || sent(before[i]))) at = i;
    if (at < 0 && sent) { ok = false; for (i = before.length - 1; i >= 0 && at < 0; i--) if (!before[i].own) at = i; }
    if (at < 0) return null;
    return { rec: before[at], date: before[at].date, n: before.length - 1 - at, sent: ok && !!sent };
  }
  /** Записи для статистики (власник 11.11): місяці й гроші — між переданими показаннями, як рахує постачальник; проміжні й «для себе»
   *  не ділять місяць. Переданих менше двох (людина не позначає) — як було, всі записи. */
  function paidOnly(list, sent) { var s = list.filter(function (y) { return !y.deleted && (y.base ? baseSent(y) : !y.own && sent(y)); }); return s.length >= 2 ? s : list; }
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
    elec: { icon: 'bolt', cls: 'c-elec', t: 'kd_elec', s: 'kd_elec_s', max: 2 },
    // вивіз сміття (115-а, власник 11.11): на рівні лічильників, але без табло — платять з людини; місце табло — сума на місяць
    waste: { icon: 'trash', cls: 'c-waste', t: 'kd_waste', s: 'kd_waste_s', max: 1, nometer: true }
  };
  // Один порядок видов везде и во всех квартирах (владелец 05.11): опалення, гаряча, холодна, світло, газ, вивіз сміття —
  // главная, экран квартиры (счётчики, «Постачальники й тарифи», рахунки, прибрані), вкладки, мастера.
  var KIND_ORDER = ['heat', 'hot', 'cold', 'elec', 'gas', 'waste'];
  function kindRank(k) { var i = KIND_ORDER.indexOf(k === 'water' ? 'hot' : k); return i < 0 ? 99 : i; }
  /** Счётчики по порядку видов; внутри вида — как добавляли (сортируем копию, хранение не трогаем). */
  function byKind(a) { return a.map(function (m, i) { return [m, i]; }).sort(function (x, y) { return kindRank(x[0].kind) - kindRank(y[0].kind) || x[1] - y[1]; }).map(function (x) { return x[0]; }); }
  function hasHeat() { return !!(S.meter && !S.meter.removed); }
  /** Есть ли хоть один счётчик в любой квартире (вход на новом устройстве: уже настроен — сразу на главную). */
  function anyMeters() {
    var live = function (m) { return m && !m.deleted && !m.removed; };
    return hasHeat() || places().some(function (p) { return live(p.meter) || ((p.water || {}).meters || []).some(live) || (p.meters || []).some(live) || !!(p.waste && p.waste.on); });
  }
  function kindCount(k) { return k === 'heat' ? (hasHeat() ? 1 : 0) : k === 'waste' ? (wasteOn() ? 1 : 0) : KINDS[k].soon ? 0 : k === 'elec' || k === 'gas' ? pmeters(k).length : wmeters(k).length; }
  function meterTitle(what) { if (what === 'heat') return t('kd_heat'); if (what === 'waste') return t('kd_waste'); var pm = pmeters(null, true).filter(function (x) { return x.id === what; })[0]; if (pm) return ename(pm); var m = wmeters(null, true).filter(function (x) { return x.id === what; })[0]; return m ? wname(m) : ''; }
  /** Есть ли у счётчика записи (тогда «прибрати» — в архив, иначе — удалить совсем). */
  function meterHasData(what) {
    if (what === 'heat') return RD().length > 0 || gaps('heat').length > 0;
    if (what === 'waste') return Ws.pays(wcur()).length > 0;
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
    // вивіз сміття: дані (люди, ціна, оплати) лишаються — «Повернути» віддає все як було
    if (what === 'waste') { wasteSet(function (w) { delete w.on; if (keep) w.removed = d; else delete w.removed; }); return; }
    if (pmeters(null, true).some(function (x) { return x.id === what; })) { setPMeters(function (list) { list.forEach(function (m) { if (m.id === what) { if (keep) m.removed = d; else m.deleted = true; } }); }); return; }
    wsetCfg(function (c) { (c.meters || []).forEach(function (m) { if (m.id === what) { if (keep) m.removed = d; else m.deleted = true; } }); });
  }
  function meterRestore(what) {
    if (what === 'heat') { if (S.meter) { S.meter = Object.assign({}, S.meter); delete S.meter.removed; save(); } return; }
    if (what === 'waste') { wasteSet(function (w) { w.on = true; w.at = w.at || today(); delete w.removed; }); return; }
    if (pmeters(null, true).some(function (x) { return x.id === what; })) { setPMeters(function (list) { list.forEach(function (m) { if (m.id === what) delete m.removed; }); }); return; }
    wsetCfg(function (c) { (c.meters || []).forEach(function (m) { if (m.id === what) delete m.removed; }); });
  }
  /** Прибранные счётчики квартиры (для «Повернути»). */
  function removedMeters() {
    var a = []; if (S.meter && S.meter.removed) a.push({ what: 'heat', kind: 'heat', title: t('kd_heat'), at: S.meter.removed });
    wmeters(null, true).filter(function (m) { return m.removed; }).forEach(function (m) { a.push({ what: m.id, kind: m.kind, title: wname(m), at: m.removed }); });
    pmeters(null, true).filter(function (m) { return m.removed; }).forEach(function (m) { a.push({ what: m.id, kind: m.kind, title: ename(m), at: m.removed }); });
    var ww = wcur(); if (!ww.on && ww.removed) a.push({ what: 'waste', kind: 'waste', title: t('kd_waste'), at: ww.removed });
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
      // «Ремонт / Повірка / Заміна» — там само, де «Прийнято» в інших записах: праворуч на рядку дати (владелец 07.11), не внизу
      right: billMark(g.bills), st: '<span class="st-chip st-static" data-key="gap-st-' + g.id + '"><span class="pill ' + (g.to && g.to <= today() ? 'neutral' : 'warn') + '">' + esc(t('gp_r_' + (g.reason || 'other'))) + '</span></span>' });
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
    return (hasHeat() ? [heatCard()] : []).concat(['hot', 'cold'].filter(function (k) { return wmeters(k).length; }).map(waterCard)).concat(emeters().length ? [elecCard()] : []).concat(smeters('gas').length ? [sCard('gas')] : [])
      .concat(wasteOn() ? [wasteCard()] : []);
  }
  function hpEditForm(p) {
    var id = esc(p.id), idx = places().indexOf(p);
    return '<form class="hp-edit" data-hp-form="' + id + '" novalidate data-key="hp-edit-form"><div class="hp-name">' +
      '<div class="field"><label for="hpn-' + id + '">' + esc(t('hp_name')) + '</label><div class="ctl"><input id="hpn-' + id + '" maxlength="40" autocomplete="off" value="' + esc(p.name || '') + '" placeholder="' + esc(idx <= 0 ? t('pl_mine') : t('pl_unnamed', { n: idx + 1 })) + '"></div>' +
        '<div class="pv-chips">' + t('pv_chips').split('|').map(function (c) { return '<button type="button" class="chip" data-act="hp-chip" data-id="' + id + '" data-v="' + esc(c) + '">' + esc(c) + '</button>'; }).join('') + '</div></div>' +
      '</div>' + addrFieldsFor('hpa-' + id, p, false) + (GPV_ON && afKh(p) ? '<p class="small muted hp-addr-gpv">' + esc(t('hp_addr_gpv')) + '</p>' : '') +
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
      // вивіз сміття — «сплатити за жовтень», строк минув — «не сплачено за жовтень»
      var txt = r.pay ? (n < 0 ? t('pn_pay_late', { k: r.title, m: monthLabel(r.ym) }) : t('pn_pay', { k: r.title, m: monthLabel(r.ym), w: when })) : t(r.ready ? 'pn_ready' : 'pn_send', { k: r.title, w: when });
      return '<span class="pn-row k-' + r.kind + (n <= 1 ? ' hot' : '') + '" data-key="pst-' + esc(p.id) + '-' + r.kind + '">' + ico(KINDS[r.kind].icon, 16, KINDS[r.kind].cls) + '<span>' + esc(txt) + '</span></span>';
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
          '<summary data-key="home-pl-sum-' + esc(p.id) + '"' + (p.icon && PICONS[p.icon] ? ' class="has-ic"><span class="pacc-ic">' + picon(p, 40) + '</span>' : '>') + '<span class="pacc-t"><b>' + (p.icon && PICONS[p.icon] ? '' : '<i class="pdot" aria-hidden="true"></i>') + esc(placeLabel(p)) + '</b>' + (p.address ? '<span class="pacc-addr">' + esc(p.address) + '</span>' : '') + '</span>' +
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
    var dc = cityDefault(); if (dc) addrApply(np, { city: dc.city, typed: '', street: '' });   // пункт — як у першої квартири (владелец 08.11)
    S.places.push(np); switchPlace(np.id); WX.key = '';
    S.homeOpen = S.homeOpen || {}; S.homeOpen[np.id] = true; HP_EDIT = np.id; save();
    toast(t('hp_added', { p: placeLabel(place()) })); SCROLL_TO = 'hp-' + np.id;
    if (routeName() === 'home') render(true); else go('home');
  }
  function hpSave(id) {
    var p = place(id), n = document.getElementById('hpn-' + id); if (!p) return;
    p.name = String(n ? n.value : p.name || '').trim().slice(0, 40); addrApply(p, addrRead('hpa-' + id)); p.updatedAt = Date.now();
    HP_EDIT = ''; save(); toast(t('b_saved')); render(true);
  }

  // ---------- графіки відключень світла (ГПВ Харківобленерго) — лише у квартир з адресою ----------
  // Сервер раз на 10 хв забирає графік: GET /api/gpv → days[дата][черга] = {off, may} — проміжки в хвилинах від півночі за Києвом.
  // Черга квартири — p.gpv ('3.1'): людина обирає сама (поруч — офіційний пошук черги за адресою). Без адреси блоку немає.
  // Зранку бот надсилає графік на сьогодні (p.gpvTg !== false, потрібен Telegram) — app/gpv.php.
  // Графіки відключень на сайті вимкнено (владелец 10.11: «закоммить, чтобы их не было на фронте»): блоки, підказка під адресою й картка лендингу
  // не показуються, /api/gpv не запитується. Сервер і ранкові повідомлення бота — без змін. Увімкнути — GPV_ON = true.
  var GPV_ON = false;
  var GPV = { data: null, at: 0, busy: false, err: false, pick: {}, addr: {} };
  var GPV_Q = ['1.1', '1.2', '2.1', '2.2', '3.1', '3.2', '4.1', '4.2', '5.1', '5.2', '6.1', '6.2'];
  var GPV_LOOKUP = 'https://oblenergo.kharkiv.ua/uk/gaoinfo', GPV_CHANNEL = 'https://t.me/kharkivenergy';
  function gpvLoad() {
    if (!GPV_ON || !window.TEPLO_API || GPV.busy || Date.now() - GPV.at < 600000) return; GPV.busy = true; GPV.at = Date.now();
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
  /** Графік Харківобленерго — лише для Харківщини: пункт не обрано (стара адреса рядком) чи обрано на Харківщині й є вулиця. */
  function afKh(p) { return !(p && p.city && p.city.n) || p.city.r === 'kh'; }
  function gpvHas(p) { return !!(GPV_ON && p && String(p.address || '').trim() && afKh(p) && (!(p.city && p.city.n) || String(p.street || '').trim())); }
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
  /** Бот сменился (07.11.2026), а новый ещё не может писать человеку (Telegram: «chat not found» / 403) — нагадування й графіки не доходять.
   *  Сервер решает (user.botStart), «Пізніше» прячет на 3 дня. В Mini App нынешнего бота — одна кнопка «Дозволити» (requestWriteAccess),
   *  иначе — ссылка на бота, там «Старт». */
  function botStartBanner() {
    var a = Y().account, b = a && a.botStart; if (!b || !b.bot) return '';
    if (S.botStartLater && Date.now() - S.botStartLater < 3 * 86400000) return '';
    return '<div class="banner warn" role="status" data-key="home-bot-start" data-why="' + esc(b.why || '') + '">' + ico('bell', 22) + '<div><p><b>' + esc(t('bs_title')) + '</b></p><p>' + esc(t('bs_sub', { b: b.bot })) + '</p>' +
      '<div class="row-actions" style="margin-top:8px"><button class="btn" data-act="bot-start" data-key="home-bot-start-go">' + esc(t('bs_go', { b: b.bot })) + '</button>' +
      '<button type="button" class="linkbtn" data-act="bot-start-later" data-key="home-bot-start-later">' + esc(t('save_prompt_later')) + '</button></div></div></div>';
  }
  function botStartGo() {
    var y = Y(), b = y.account && y.account.botStart; if (!b) return;
    var url = 'https://t.me/' + encodeURIComponent(b.bot) + '?start=remind', tw = window.Telegram && window.Telegram.WebApp;
    if (tw && tw.initData && y.tgBot === 'cur' && tw.requestWriteAccess && tw.isVersionAtLeast && tw.isVersionAtLeast('6.9')) {
      try { tw.requestWriteAccess(function (ok) { if (ok) y.botOk().then(function () { toast(t('bs_done')); render(true); }); }); return; } catch (e) { /* старый клиент — ссылкой */ }
    }
    if (tw && tw.initData && tw.openTelegramLink) tw.openTelegramLink(url); else window.open(url, '_blank', 'noopener');
  }
  // вернулся из бота после «Старт» — проверить, ушла ли плашка
  document.addEventListener('visibilitychange', function () {
    var y = Y(); if (document.visibilityState !== 'visible' || !y.account || !y.account.botStart) return;
    y.refreshMe().then(function () { if (/^(home)?$/.test(routeName())) safeRender(); }, function () { /* сеть — потом */ });
  });
  V.home = function () {
    var html = '<h1 class="sr">' + esc(t('nav_home')) + (place() && place().name ? ' — ' + esc(place().name) : '') + '</h1>';
    if (Y().mode === 'server' && !Y().account && (RD().length || wrecs().length) && !S.syncPromptDismissed) {
      html += '<div class="banner" data-key="home-save-prompt">' + ico('info', 22) + '<div><p><b>' + esc(t('save_prompt')) + '</b></p><p><a href="#login">' + esc(t('login')) + '</a> &nbsp; <button class="linkbtn" data-act="dismiss-sync">' + esc(t('save_prompt_later')) + '</button></p></div></div>';
    }
    html += botStartBanner();
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
    return '<details class="panel where wacc' + (recId ? '' : ' wacc-btn') + '" id="' + id + '" data-key="' + m[1] + '"' + (open ? ' open' : '') + '><summary data-key="' + m[1] + '-sum"><h2>' + m[2] + '</h2>' + ico('chev', 20, 'pacc-chev') + '</summary><div class="where-b">' + m[3] + '</div></details>';
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
  /** Історія на сторінці лічильника — окремим блоком (владелец 07.11: «показать более явно, обособленно»): заголовок з кількістю,
   *  останні 3 записи, «Уся історія (N)» — лише коли записів більше. */
  function histPanel(rows, total, allBtn, k) {
    return '<section class="panel mhist" data-key="' + k + '-hist"><h2 class="mhist-h">' + ico('history', 18, 'bt-ico') + '<span>' + esc(t('wh_title')) + '</span>' + (total > 3 ? '<span class="mhist-n">' + total + '</span>' : '') + '</h2>' +
      rows + (total > 3 ? '<div class="mhist-all">' + allBtn + '</div>' : '') + '</section>';
  }
  /** Екран лічильника: «Внести показання» — над табло (владелец 10.11); на широкому — праворуч угорі, табло ліворуч на всю висоту. */
  function heroGrid(meter, act, side) { return '<div class="hero-grid hg3"><div class="hg-act">' + act + '</div><div class="wm-col">' + meter + '</div><div class="hg-side">' + side + '</div></div>'; }
  function mbox(o) {
    return '<section class="panel mbox mbox-' + o.kind + '" data-key="' + o.key + '">' +
      '<header class="mbox-h">' + ico(o.icon, 24, o.cls) + '<span class="mbox-t"><b>' + esc(o.name) + '</b>' + (o.sub && subSpans(o.sub) ? '<span class="small muted mbox-sub">' + subSpans(o.sub) + '</span>' : '') + '</span></header>' +
      '<div class="mbox-disp">' + o.display + '</div>' +
      '<p class="lcd-cap meta-row"><span>' + esc(o.cap) + '</span>' + (o.fix || '') + copyIco(o.copy, o.key + '-copy') + '</p>' + (o.body || '') +
      (o.meta && o.meta.length ? '<ul class="mbox-meta">' + o.meta.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' : '') +
      (o.set ? '<details class="mbox-set" id="mbs-' + esc(o.id || o.kind) + '"' + (MB_OPEN[o.id || o.kind] ? ' open' : '') + ' data-key="' + o.key + '-set"><summary>' + ico('prefs', 18, 'bt-ico') + '<span>' + esc(o.setTitle || t('mb_set')) + '</span>' + ico('chev', 18, 'pacc-chev') + '</summary><div class="mbox-set-b">' + o.set + '</div></details>' : '') +
      (o.links && o.links.length ? '<div class="mbox-links">' + o.links.join('') + '</div>' : '') + '</section>';
  }
  /** «Лічильник знімали на ремонт, повірку чи міняли?» — внизу «Налаштувань лічильника», не на виду. */
  function gapSetLink(what) { return '<p class="mbox-set-link">' + mlink('#gap-new-' + esc(what), 'wrench', t('gp_add'), ' data-key="gap-add-' + esc(what) + '"') + '</p>'; }
  function mlink(href, icon, txt, extra) { return '<a href="' + href + '"' + (extra || '') + '>' + ico(icon, 18) + '<span>' + esc(txt) + '</span></a>'; }
  document.addEventListener('toggle', function (e) { var d = e.target; if (d && d.classList && d.classList.contains('mbox-set')) MB_OPEN[d.id.slice(4)] = d.open; }, true);

  // ---------- экран вида воды: табло, «куди передати», история ----------
  /** Один адресат: кому, за що, строк; готові цифри (якщо є показання цього місяця); куди саме — кнопки; позначка «передано». */
  function destBox(o) {
    return '<div class="dest"' + (o.id ? ' id="' + o.id + '" tabindex="-1"' : '') + ' data-key="dest-' + o.key + '"><div class="dest-h"><div class="grow"><b>' + esc(o.org) + '</b>' + (o.what ? '<div class="small muted">' + esc(o.what) + '</div>' : '') + '</div>' +
      (o.sent ? '<span class="pill ok">' + ico('check', 14) + ' ' + esc(t('ws_sent')) + '</span>' : o.due ? '<span class="pill ' + (o.dueTone || 'neutral') + '">' + esc(o.due) + '</span>' : '') + '</div>' +
      (o.body || '') +
      ((o.chans && o.chans.length) || o.chx ? '<div class="dest-ch">' + (o.chans || []).map(function (c) { return '<a class="btn sec" href="' + c[0] + '" target="_blank" rel="noopener" data-key="dest-' + o.key + '-' + c[3] + '"' + (c[4] || '') + '>' + ico(c[2], 18) + '<span>' + esc(c[1]) + '</span></a>'; }).join('') + (o.chx || '') + '</div>' : '') + (o.note || '') +
      // телефоны, приложения, запасные каналы — свёрнуто «Інші способи» (владелец 07.11: «много лишней и дублирующейся информации»)
      (o.more ? '<details class="dest-more" data-key="dest-more"><summary>' + esc(t('dest_more')) + ico('chev', 16, 'pacc-chev') + '</summary><div class="dest-more-b">' + o.more + '</div></details>' : '') + (o.mark || '') + '</div>';
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
    if (ld && ld.via !== 'hvk') return '<section class="panel where" data-key="where-water"><h2>' + ico('send', 18, 'bt-ico') + '<span>' + esc(t('wd_title')) + '</span></h2>' + wherePlaceLine() +
      localDest('water', ld, rec ? valList(ms) : '', rec ? mark('vk', wsentVk(rec)) : '', rec && wsentVk(rec), lbBox(ld, [rec], rec ? lbItems(rec) : [])) + '</section>';
    // Водоканал: холодна (вода + відведення) і гаряча (лише відведення) — одна команда для бота на всі водоміри
    var vkBody = '', vkChans = [[Wt.VK_BOT, t('wd_bot', { b: '@hvk_user_bot' }), 'send', 'bot'], [Wt.VK_CABINET, t('wd_cab_vk'), 'ext', 'cab']];
    if (rec) {
      var cmd = Wt.vkCommand(wcfg().account, wcfg().surname, ms, rec.vals || {});
      // рахунку немає — тут, перед передачею, і просимо (при налаштуванні не питаємо, 114-а); «Заповнити з monobank» — під полями
      if (cmd.noAccount) vkBody = (vkcOn() ? '<p class="small" data-key="vc-need">' + esc(t('vc_need')) + '</p>' : '<p>' + esc(t('ws_need_acc')) + '</p>' + waccForm()) + monoLink('water');

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
        vkBody = (wsentVk(rec) || !hcOn() ? '' : vjBox(rec)) + vkcBox(rec, ms) + '<details class="tips-box vk-alt"' + (botOpen ? ' open' : '') + ' data-key="vk-alt"><summary>' + esc(t('vkc_or_bot')) + '</summary>' + vkBody + '</details>';
        vkChans = [];
      } else if (!cmd.noAccount && vkcGate() === 'login') vkBody = vkcPre('login') + vkBody;   // не ввійшов — скажемо, що через сайт можна
      vkBody += '<details class="tips-box"><summary>' + esc(t('wd_vals')) + '</summary>' + valList(ms) + '</details>';
    } else {
      // кнопка «Відправити» — після показань цього місяця; сайт Водоканалу відкривається — шлях через нього видно одразу
      var vg = vkcGate();
      // бот Водоканалу тут — лише кнопкою в ряду каналів (07.11: була ще розгортка «Або через бот…» — дубль)
      vkBody = vg ? vkcPre(vg, kind, ms) : '<p class="small" data-key="vk-need-rec">' + esc(t('vk_need_rec')) + '</p>';
    }
    var h = '<section class="panel where" data-key="where-water"><h2>' + ico('send', 18, 'bt-ico') + '<span>' + esc(t('wd_title')) + '</span></h2>' +
      // квартир несколько — за какую передаём (рахунок і цифри — цієї квартири)
      (places().length > 1 ? '<p class="dest-place" style="--pc:var(--pc-' + placeColor(place()) + ')" data-key="where-place"><b>' + esc(t('wd_for', { p: placeLabel(place()) })) + '</b>' + (placeSub(place()) ? '<span class="small muted"> · ' + esc(placeSub(place())) + '</span>' : '') + '</p>' : '') +
      '';
    vkBody = vkStatusLine() + vkBody;
    // сайт Водоканалу — равноценная кнопка в ряду каналов, как «Підключити кабінет» у тепла (просьба владельца 06.11): не подключён — «Підключити сайт Водоканалу»;
    // подключён, а показаний ещё нет — «Сайт Водоканалу підключено» (туда же); есть показания — выделенная «Відправити у фоні» (vjBox) вместо этого ряда
    var vg2 = vkcGate(), vkChx = '';
    if (vg2 === 'acc') vkChx = '<a class="btn sec" href="#vkcab" data-key="vk-connect">' + ico('plus', 18) + '<span>' + esc(t('vc_conn_btn')) + '</span></a>';
    else if (vg2 === 'ok' && !rec) vkChx = '<a class="btn sec" href="#vkcab" data-key="vk-conn-on">' + ico('check', 18) + '<span>' + esc(t('vc_conn_ok')) + '</span></a>';
    h += destBox({ key: 'vk', id: 'wsend-vk', org: t('wd_vk_org'), what: kind === 'cold' ? '' : kind === 'hot' ? t('wd_vk_hot') : t('wd_vk_both'),
      due: vkDue, dueTone: w.open && w.daysLeft <= 3 ? 'warn' : 'neutral', sent: rec && wsentVk(rec), body: vkBody, chans: vkChans, chx: vkChans.length || !rec ? vkChx : '',
      more: '<p class="dm-t">' + esc(t('wd_vk_call')) + '</p><ul class="dm-ph"><li>' + telLink('+380577075851', '(057) 707-58-51') + '<span class="muted">' + esc(t('wd_vk_24')) + '</span></li><li><b>(050) 355-12-12</b><span class="muted">Viber</span></li></ul>', mark: rec && rec.vkAt && !wsentVk(rec) ? '' : mark('vk', rec && wsentVk(rec)) });
    // ХТМ: сама гаряча вода — лише бот і кол-центр (у кабінеті ХТМ форми для гарячої води немає)
    if (withHtm) h += destBox({ key: 'htm', org: t('wd_htm_org'), what: t('wd_htm_what'), sent: rec && wsentHtm(rec),
      body: rec ? valList(hot) : '', chans: [[BOT_URL, t('wd_bot', { b: '@KPHTM_Bot' }), 'send', 'bot']],
      more: '<p class="dm-t">' + esc(t('wd_htm_more')) + '</p><ul class="dm-ph"><li>' + telLink('+380573414140', '(057) 341-41-40') + '</li></ul>', mark: mark('htm', rec && wsentHtm(rec)) });
    return h + '</section>';
  }
  // ---------- бот Водоканалу: відповіді, переслані нашому боту (/api/vk/replies) ----------
  var VKR = { list: null, at: 0, busy: false }, VKERR = {};
  function ourBot() { return (Y()._cfg && Y()._cfg.botUsername) || 'peredai_com_ua_bot'; }   // 07.11 бот переїхав; на бою — з /api/config
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
    // «бот/кабінет працює (перевірено …)» не показуємо — лише коли щось не так (владелец 07.11: лишнее)
    // кабінет — лише якщо наш сервер хоч раз його відкрив (інакше, може, сайт не пускає закордонні адреси — не лякаємо)
    if (c && c.everOk && c.state !== 'ok') out += '<p class="vk-st small warn" data-key="vk-cab-' + c.state + '">' + esc(t('vk_cab_down', { d: vkWhen(c.since) })) + '</p>';
    return out;
  }
  // ---------- кабінет Водоканалу «без реєстрації»: показання вносить наш сервер (VkCab, app/vkcab.php) ----------
  // Людина натискає «Перевірити на сайті Водоканалу» → бачить, що бачить сайт (лічильники, останні показання), → «Відправити на сайт
  // Водоканалу» → сервер вводить рахунок і прізвище, заповнює форму й надсилає; «прийнято» → передано (підтверджено). ID для бота не потрібні.
  var VKC = { key: '', busy: '', check: null, err: null, res: null, pick: {} };
  function vkcAvail() { var c = VKS.data && VKS.data.cab; return !!(window.TEPLO_API && c && c.everOk && c.state === 'ok' && c.send !== false); }
  function vkcOn() { return vkcAvail() && !!Y().account; }
  /** Квитанція Водоканалу у фоні (владелец 07.11: «скачивать и добавлять в фоне автоматом без участия юзера»): бере сервер сам, без людини
   *  (cron, VkBills: з 1-го по 25-те, раз на добу до нової, лише читає сайт) і кладе до запису води за минулий місяць прямо в дані людини —
   *  сюди вона приходить синхронізацією. Тут — лише тост, коли нова квитанція з’явилась (за останні 3 доби). Вимкнути — «Квитанції самі» в «Кабінети й автовідправка». */
  // Квитанції ХТМ — так само (HtmBills: кабінет ХТМ підключено → раз на добу, 7–22, лише читає) до запису тепла за минулий місяць; auto: 'htm'.
  function vkbIds(st) {
    var o = {};
    ((st && st.water) || []).forEach(function (r) { ((r && r.bills) || []).forEach(function (b) { if (b && b.auto === 'vk' && b.id) o[b.id] = { r: r, at: b.at, k: 'vk', d: b.ym ? b.ym + '-01' : r.date }; }); });
    ((st && st.readings) || []).forEach(function (r) { ((r && r.bills) || []).forEach(function (b) { if (b && b.auto === 'htm' && b.id) o[b.id] = { r: r, at: b.at, k: 'htm', d: b.ym ? b.ym + '-01' : r.htm && r.htm.date }; }); });
    return o;
  }
  function vkbToast(before) {
    var now = vkbIds(S), id = Object.keys(now).filter(function (k) { return !before[k] && Date.now() - (Date.parse(now[k].at) || 0) < 3 * 864e5; })[0]; if (!id) return;
    var x = now[id], r = x.r; toast(t(x.k === 'htm' ? (r.billOnly ? 'hcb_new' : 'hcb_added') : (r.billOnly ? 'vkb_new' : 'vkb_added'), { m: monthLabel(String(x.d || '').slice(0, 7)), p: placeLabel(place(r.place) || place()) })); track(x.k === 'htm' ? 'htm_bill_seen' : 'vk_bill_seen');
  }
  /** «Квитанції самі» ХТМ — у квартирах з теплолічильником (за замовчуванням увімкнено; вимкнено — meter.billAuto === false). */
  function hcbPlaces() { return places().filter(function (p) { var m = p.id === S.placeId ? S.meter : p.meter; return !!(m && !m.removed); }); }
  function hcbOn() { var ps = hcbPlaces(); return !ps.length || ps.some(function (p) { var m = p.id === S.placeId ? S.meter : p.meter; return m.billAuto !== false; }); }
  /** «Квитанції самі» — у квартирах з рахунком і прізвищем для сайту Водоканалу (за замовчуванням увімкнено). */
  function vkbAcc(p) { var w = (p && p.water) || {}; return String(w.account || '').replace(/\D/g, '').length >= 5 && !!String(w.surname || '').trim(); }
  function vkbOn() { var ps = places().filter(vkbAcc); return !ps.length || ps.some(function (p) { return p.water.billAuto !== false; }); }
  /** Чого бракує для шляху «через сайт»: '' — сайт не відкривається (лише бот), 'login', 'acc' (рахунок ≥ 5 цифр і прізвище), 'ok'. */
  function vkcGate() { if (!vkcAvail()) return ''; if (!Y().account) return 'login'; var c = wcfg(); return String(c.account || '').replace(/\D/g, '').length >= 5 && String(c.surname || '').trim() ? 'ok' : 'acc'; }
  function vkcHead() { return '<div class="vkc" data-key="vkc"><p class="vkc-t"><b>' + esc(t('vkc_t')) + '</b></p>'; }
  /** Показань цього місяця ще немає: шлях через сайт видно одразу — що потрібно (вхід, рахунок), «Перевірити» (що бачить сайт). */
  function vkcPre(g, kind, ms) {
    if (g === 'login') return vkcHead() + '<p class="small">' + esc(t('vkc_login')) + '</p><p><a class="btn sec" href="#login" data-key="vkc-login">' + esc(t('login')) + '</a></p></div>';
    if (g === 'acc') return vkcHead() + '<p class="small" data-key="vc-need">' + esc(t('vc_need')) + '</p></div>';
    // «Внести показання води» тут не дублюємо — велика кнопка вже над «Куди передати» (07.11); сайт уже прийняв цей період — підказка «з’явиться кнопка» зайва
    var box = vkcBox(null, ms), dn = VKC.check && (VKC.check.done || []).length && !(VKC.check.meters || []).length;
    return box + (dn ? '' : '<p class="small" data-key="vk-need-rec">' + esc(t('vkc_need_rec')) + '</p>');
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
      return h + '<p class="small muted">' + esc(t('vkc_lead', { a: acc, f: sn })) + '</p><div class="row-actions"><button class="btn' + (rec && hcOn() && !wsentVk(rec) ? ' sec' : '') + '" data-act="vkc-check" data-key="vkc-check"' + (VKC.busy ? ' disabled' : '') + '>' +
        (VKC.busy === 'check' ? SPIN + '<span>' + esc(t('vkc_checking')) + '</span>' : ico('check', 18) + '<span>' + esc(t(VKC.err ? 'vkc_retry' : 'vkc_check')) + '</span>') + '</button></div></div>';
    }
    // сайт знайшов рахунок: наші водоміри ↔ його лічильники, попередження, «Перевірте» і «Відправити»
    var cms = VKC.check.meters, map = vkcMap(ms, cms), withVal = ms.filter(function (m) { return hasVal(rec, m.id); });
    h += '<p class="small" data-key="vkc-found">' + ico('check', 16) + ' ' + esc(t('vkc_found', { a: acc })) + (VKC.check.addr ? ' · ' + esc(VKC.check.addr) : '') + '</p>';
    // показання цього періоду на сайті вже прийняті (полів вводу немає): що саме, повірка; наш запис з тими ж цифрами — «Позначити передано»
    var dn = VKC.check.done || [];
    if (dn.length && !cms.length) return h + vkcDone(dn, rec, ms) + '</div>';
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
  var VKC_MN = { uk: ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'],
    ru: ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'] };
  /** Сайт Водоканалу вже прийняв показання періоду: лічильники сайту (вид, №, цифри, «прийнято», повірка) і що з нашим записом. */
  function vkcDone(dn, rec, ms) {
    var p = dn[0].period, pl = p ? (VKC_MN[S.lang] || VKC_MN.uk)[+p.slice(5, 7) - 1] + ' ' + p.slice(0, 4) : '';
    var num = function (v) { return v === null || v === undefined ? '?' : String(Math.round(v * 1000) / 1000); };
    var h = '<div class="vk-reply ok" data-key="vkc-done"><p class="small"><b>' + esc(t(dn.every(function (d) { return d.accepted; }) ? 'vkc_done_t' : 'vkc_done_t2', { p: pl })) + '</b></p><ul class="small vkc-done">' +
      dn.map(function (d) {
        var ver = d.verify ? (d.verify <= today() ? '<span class="warn-ink" data-key="vkc-ver-over">' + esc(t('vkc_ver_over', { d: fmtDate(d.verify, true) })) + '</span>' : '<span class="muted">' + esc(t('vkc_ver', { d: fmtDate(d.verify, true) })) + '</span>') : '';
        return '<li data-key="vkc-d-' + esc(d.serial || d.kind) + '">' + esc(t(d.kind === 'hot' ? 'wt_hot' : 'wt_cold')) + (d.serial ? ' № ' + esc(d.serial) : '') + ' — <b class="num">' + num(d.value) + '</b> м³' +
          (d.accepted ? ' · ' + esc(t('vkc_done_ok')) : '') + (ver ? '<br>' + ver : '') + '</li>';
      }).join('') + '</ul><p class="small muted">' + esc(t('vkc_done_note')) + '</p></div>';
    if (!rec || wsentVk(rec)) return h;
    // наші водоміри з показаннями ↔ лічильники сайту: за номером, інакше за видом (якщо один)
    var pick = function (m) { var sd = vkcDigits(m.serial); return dn.filter(function (d) { return sd && vkcDigits(d.serial) && (vkcDigits(d.serial).indexOf(sd) >= 0 || sd.indexOf(vkcDigits(d.serial)) >= 0); })[0] ||
      (dn.filter(function (d) { return d.kind === m.kind; }).length === 1 ? dn.filter(function (d) { return d.kind === m.kind; })[0] : null); };
    var mine = ms.filter(function (m) { return hasVal(rec, m.id); }), diff = mine.filter(function (m) { var d = pick(m); return !d || d.value === null || Math.abs(d.value - Wt.whole(rec.vals[m.id])) > 0.0005; });
    if (mine.length && !diff.length && dn.every(function (d) { return d.accepted; }))
      return h + '<p class="small" data-key="vkc-done-same">' + esc(t('vkc_done_same')) + '</p><div class="row-actions"><button class="btn" data-act="wsent" data-to="vk" data-v="1" data-id="' + esc(rec.id) + '" data-key="vkc-done-mark">' + ico('check', 18) + '<span>' + esc(t('vkc_done_mark')) + '</span></button></div>';
    return h + (diff.length ? '<p class="small warn-ink" data-key="vkc-done-diff">' + ico('alert', 16) + ' ' + esc(t('vkc_done_diff', { l: diff.map(function (m) { var d = pick(m); return wname(m) + ': ' + Wt.whole(rec.vals[m.id]) + ' / ' + (d ? num(d.value) : '—'); }).join('; ') })) + '</p>' : '');
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
  // ---------- вода «у фоні» й автовідправка після фото в бот (сервер, VkSvc, app/vksvc.php) ----------
  // «Відправити у фоні» — черга сервера: cron за хвилину входить на сайт Водоканалу рахунком і прізвищем, надсилає й пише в Telegram.
  // Автовідправка (окрема згода в «Налаштуваннях») — те саме після фото холодного водоміра в бот, якщо все прочитано впевнено, через 10 хв.
  var VJ = { st: null, at: 0, loading: false, busy: '', err: null, errFor: null };
  function vjLoad(force) {
    if (!hcOn() || VJ.loading || (!force && Date.now() - VJ.at < 15000)) return;
    VJ.loading = true; VJ.at = Date.now();
    Y().api('GET', '/vk/jobs').then(function (j) {
      VJ.loading = false; if (j._status !== 200) return;
      var before = JSON.stringify(VJ.st); VJ.st = j; var ch = vjApply();
      if (ch) save(); if (ch || before !== JSON.stringify(j)) safeRender();
    }, function () { VJ.loading = false; });
  }
  function vjAutoOn() { return !!(VJ.st && VJ.st.auto); }
  function vjRec(id) { return (S.water || []).filter(function (w) { return w && !w.deleted && w.id === id; })[0] || null; }
  /** Підсумки черги → записи води: «прийнято» — передано (підтверджено сайтом); решта — статус у блоці Водоканалу. */
  function vjApply() {
    var ch = false;
    ((VJ.st && VJ.st.jobs) || []).forEach(function (j) {
      var w = j.rid && vjRec(j.rid); if (!w) return;
      if (!w.vkJob && j.card && w.card === j.card) { w.vkJob = { job: j.id }; ch = true; }   // «Відправити» в картці чату (121-а)
      if (!w.vkJob || w.vkJob.job !== j.id) return;
      var c = { job: j.id, at: j.at, status: j.status, nextAt: j.nextAt || null, auto: !!j.auto, text: String(j.text || '').slice(0, 300), human: j.human ? String(j.human).slice(0, 300) : null };
      if (JSON.stringify(c) !== JSON.stringify(w.vkJob)) { w.vkJob = c; w.updatedAt = Date.now(); ch = true; }
      if (j.status === 'ok' && !wsentVk(w)) { w.sent = Object.assign({}, w.sent || {}, { vk: today() }); w.vkConf = { id: 'job-' + j.id, at: j.doneAt || j.at, text: String(j.text || '').slice(0, 300), via: 'cab' }; delete w.vkAt; w.updatedAt = Date.now(); ch = true; toast(t('vkc_ok_toast')); }
    });
    return ch;
  }
  function vjItems(rec) { return wmeters().filter(function (m) { return hasVal(rec, m.id); }).map(function (m) { return { key: m.cabKey || null, value: String(Wt.whole(rec.vals[m.id])), serial: m.serial || null, kind: m.kind, name: wname(m) }; }); }
  function vjQueue(rec, auto) {
    var c = wcfg(), items = vjItems(rec); if (!rec || !items.length || VJ.busy) return;
    VJ.busy = 'q'; VJ.err = null; VJ.errFor = rec.id; safeRender();
    Y().api('POST', '/vk/queue', { acc: c.account, fam: c.surname, rid: rec.id, place: rec.place || S.placeId, items: items, auto: !!auto, lang: S.lang }).then(function (j) {
      VJ.busy = '';
      if (j._status === 200 && j.job) {
        var jb = j.job; if (VJ.st) VJ.st.jobs = [jb].concat((VJ.st.jobs || []).filter(function (x) { return x.id !== jb.id; }));
        rec.vkJob = { job: jb.id, at: jb.at, status: jb.status, nextAt: jb.nextAt || null, auto: !!jb.auto }; rec.updatedAt = Date.now(); vjApply(); save(); toast(t(auto ? 'vk_bg_q' : 'vk_bg_toast'));
        cardJob('vk', jb, { k: 'water', t: t('bc_water'), w: t('bc_vk'), v: items.map(function (x) { return camNum(x.value); }).join(' · ') + ' м³' });
      } else VJ.err = { error: j.error, human: j.human || t('vkc_fail') };
      render(true);
    }, function () { VJ.busy = ''; VJ.err = { error: 'net', human: t('vkc_fail') }; render(true); });
  }
  function vjCall(path, body, ok) {
    VJ.busy = 'c'; VJ.err = null; VJ.errFor = null; safeRender();
    Y().api('POST', path, Object.assign({ lang: S.lang }, body)).then(function (j) { VJ.busy = ''; if (j._status === 200) ok(j); else VJ.err = { error: j.error, human: j.human || t('vkc_fail') }; render(true); },
      function () { VJ.busy = ''; VJ.err = { error: 'net', human: t('vkc_fail') }; render(true); });
  }
  function vjJob(j) { var jb = j.job; if (!jb) return; if (VJ.st) VJ.st.jobs = [jb].concat((VJ.st.jobs || []).filter(function (x) { return x.id !== jb.id; })); if (vjApply()) save(); }
  /** У блоці Водоканалу: виділена «Відправити у фоні» з припискою, що піде; у черзі — коли надішлемо (автовідправка — «Скасувати» / «Надіслати зараз»); не вийшло — чому. */
  function vjBox(rec) {
    vjLoad(!!(rec.vkJob && /^(queued|sending)$/.test(rec.vkJob.status) && Date.now() - VJ.at > 4000)); var j = rec.vkJob, h = '', list = vjItems(rec).map(function (x) { return x.name + ' — ' + x.value; }).join('; ');
    if (j && (j.status === 'queued' || j.status === 'sending')) return '<div class="banner" data-key="vk-bg-q">' + ico('clock', 22) + '<div><p><b>' + esc(j.auto && j.status === 'queued' && j.nextAt ? t('vk_bg_q_at', { at: hcHM(j.nextAt) }) : t('vk_bg_q')) + '</b></p><p class="small">' + esc(list) + '</p>' +
      (j.status === 'queued' && j.auto ? '<div class="row-actions" style="margin-top:8px"><button class="btn" data-act="vj-now" data-id="' + j.job + '" data-key="vk-bg-now"' + (VJ.busy ? ' disabled' : '') + '>' + esc(t('vk_bg_now')) + '</button><button class="btn sec" data-act="vj-cancel" data-id="' + j.job + '" data-key="vk-bg-cancel"' + (VJ.busy ? ' disabled' : '') + '>' + esc(t('vk_bg_cancel')) + '</button></div>' : '') + '</div></div>';
    if (j && /^(failed|rejected|unknown)$/.test(j.status)) h += '<div class="banner ' + (j.status === 'unknown' ? 'warn' : 'bad') + '" role="alert" data-key="vk-bg-' + j.status + '">' + ico('alert', 22) + '<div><p><b>' + esc(t(j.status === 'failed' ? 'vk_bg_failed' : j.status === 'rejected' ? 'vk_bg_rej' : 'vk_bg_unk')) + '</b></p>' + (j.human || j.text ? '<p class="small">' + esc(j.human || j.text) + '</p>' : '') + '</div></div>';
    if (VJ.err && VJ.errFor === rec.id) h += '<div class="banner bad" role="alert" data-key="vk-bg-err">' + ico('alert', 22) + '<div><p>' + esc(VJ.err.human) + '</p></div></div>';
    return h + '<div class="dest-ch"><button class="btn dest-bg" data-act="vj-bg" data-id="' + esc(rec.id) + '" data-key="vk-bg"' + (VJ.busy ? ' disabled' : '') + '>' + (VJ.busy === 'q' ? SPIN : ico('send', 18)) + '<span>' + esc(t('cab_bg')) + '</span></button></div>' +
      '<p class="small dest-note" data-key="vk-bg-note">' + esc(t('cab_bg_note', { what: list })) + '</p>';
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-act^="vj-"],[data-act="vkb-auto"],[data-act="hcb-auto"]'); if (!el) return;
    var a = el.getAttribute('data-act'), id = el.getAttribute('data-id');
    if (a === 'hcb-auto') {
      var hon = !!el.checked;
      hcbPlaces().forEach(function (p) { [p.meter, p.id === S.placeId ? S.meter : null].forEach(function (m) { if (!m) return; if (hon) delete m.billAuto; else m.billAuto = false; }); p.updatedAt = Date.now(); });
      save(); toast(t(hon ? 'pc_hcb_on' : 'pc_hcb_off')); return;
    }
    if (a === 'vkb-auto') { var on = !!el.checked; places().filter(vkbAcc).forEach(function (p) { if (on) delete p.water.billAuto; else p.water.billAuto = false; p.updatedAt = Date.now(); }); save(); toast(t(on ? 'pc_vkb_on' : 'pc_vkb_off')); return; }
    if (a === 'vj-auto') { var want = !!el.checked; vjCall('/vk/auto', { on: want, consent: want }, function (j) { VJ.st = j; VJ.at = Date.now(); toast(t(want ? 'pc_vk_on' : 'pc_vk_offd')); }); return; }
    e.preventDefault();
    if (a === 'vj-bg') vjQueue(vjRec(id), false);
    else if (a === 'vj-now') vjCall('/vk/job/now', { job: +id }, function (j) { vjJob(j); });
    else if (a === 'vj-cancel') vjCall('/vk/job/cancel', { job: +id }, function (j) { vjJob(j); toast(t('vk_bg_cancelled')); });
    else if (a === 'vj-off') vjCall('/cab/forget', { prov: 'vk' }, function (j) { VJ.st = j; VJ.at = Date.now(); toast(t('pc_vk_offd')); });
  });
  function vjPending() { return (S.water || []).some(function (w) { return w && !w.deleted && w.vkJob && /^(queued|sending)$/.test(w.vkJob.status); }); }
  setInterval(function () { if (document.visibilityState === 'visible' && vjPending()) vjLoad(true); }, 20000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && vjPending()) vjLoad(true); });
  /** «Налаштування» → «Кабінети й автовідправка»: кабінет ХТМ (підключено, автовідправка, відключити) і сайт Водоканалу (згода на автовідправку води). */
  function cabsPanel() {
    if (!hcOn()) return '<div class="panel" data-key="prefs-cabs"><p class="small">' + esc(t('pc_login')) + '</p><a class="btn sec" href="#login">' + esc(t('login')) + '</a></div>';
    hcLoad(); vjLoad();
    var h = '<div class="panel" data-key="prefs-cab-htm"><h2>' + ico('thermo', 20) + '<span>' + esc(t('pc_htm_t')) + '</span></h2>';
    if (!HC.st) h += '<p class="small muted">' + SPIN + ' ' + esc(t('hc_loading')) + '</p>';
    else if (!hcConn()) h += '<p class="small">' + esc(t(HC.st.state === 'bad_login' ? 'hc_relogin' : 'pc_htm_off')) + '</p><a class="btn sec" href="#htmcab" data-key="prefs-cab-htm-connect">' + ico('plus', 18) + '<span>' + esc(t('cab_conn_btn')) + '</span></a>';
    else h += '<p class="small">' + esc(t('pc_htm_on', { e: HC.st.login })) + '</p>' +
      '<label class="hc-consent"><input type="checkbox" data-act="hc-auto" data-key="prefs-htm-auto"' + (HC.st.auto ? ' checked' : '') + (HC.busy ? ' disabled' : '') + '> <span><b>' + esc(t('ha_t')) + '.</b> ' + esc(t('ha_consent', { m: Math.round((HC.st.autoDelay || 600) / 60) })) + '</span></label>' +
      '<label class="hc-consent"><input type="checkbox" data-act="hcb-auto" data-key="prefs-htm-bills"' + (hcbOn() ? ' checked' : '') + (hcbPlaces().length ? '' : ' disabled') + '> <span><b>' + esc(t('pc_vkb_t')) + '.</b> ' + esc(t('pc_hcb_sub')) + '</span></label>' + hcErrBox(HC.errFor ? null : HC.err) +
      '<div class="row-actions"><a class="btn sec" href="#htmcab" data-key="prefs-cab-htm-manage">' + esc(t('pc_manage')) + '</a><button class="btn danger" data-act="hc-pref-off" data-key="prefs-cab-htm-off"' + (HC.busy ? ' disabled' : '') + '>' + esc(t('pc_off_btn')) + '</button></div>';
    h += '</div>';
    var c = wcfg(), accOk = String(c.account || '').replace(/\D/g, '').length >= 5 && String(c.surname || '').trim(), on = vjAutoOn(), m = Math.round(((VJ.st && VJ.st.autoDelay) || 600) / 60);
    h += '<div class="panel" data-key="prefs-cab-vk"><h2>' + ico('drop', 20, 'c-cold') + '<span>' + esc(t('pc_vk_t')) + '</span></h2><p class="small muted">' + esc(t('pc_vk_sub')) + '</p>' +
      (accOk ? '' : '<p class="small warn-ink" data-key="prefs-vk-need">' + ico('alert', 16) + ' ' + esc(t('pc_vk_need')) + '</p><p><a class="btn sec" href="#vkcab" data-key="prefs-vk-connect">' + ico('plus', 18) + '<span>' + esc(t('vc_conn_btn')) + '</span></a></p>') +
      '<label class="hc-consent"><input type="checkbox" data-act="vj-auto" data-key="prefs-vk-auto"' + (on ? ' checked' : '') + (VJ.busy || !VJ.st ? ' disabled' : '') + '> <span>' + esc(t('pc_vk_auto', { m: m })) + '</span></label>' +
      '<label class="hc-consent"><input type="checkbox" data-act="vkb-auto" data-key="prefs-vk-bills"' + (vkbOn() ? ' checked' : '') + (places().some(vkbAcc) ? '' : ' disabled') + '> <span><b>' + esc(t('pc_vkb_t')) + '.</b> ' + esc(t('pc_vkb_sub')) + '</span></label>' +
      (VJ.err && !VJ.errFor ? '<div class="banner bad" role="alert">' + ico('alert', 22) + '<div><p>' + esc(VJ.err.human) + '</p></div></div>' : '') +
      '<div class="row-actions">' + (accOk ? '<a class="btn sec" href="#vkcab" data-key="prefs-vk-manage">' + esc(t('pc_manage')) + '</a>' : '') + (on ? '<button class="btn danger" data-act="vj-off" data-key="prefs-vk-off"' + (VJ.busy ? ' disabled' : '') + '>' + esc(t('pc_vk_off_btn')) + '</button>' : '') + '</div></div>';
    return h;
  }
  // ================= «Сайт Водоканалу» (#vkcab): як «Кабінет ХТМ» для тепла =================
  // Пароля немає: сайт Водоканалу пускає за особовим рахунком і прізвищем (як у квитанції). Вони — у налаштуваннях води квартири (wcfg),
  // на сервер ідуть лише разом із надсиланням. «Підключити» = вписати їх і перевірити на сайті; там же — згода на автовідправку.
  var VCE = { edit: false };
  V.vkcab = function () {
    var back = backTo(wmeters('cold').length ? 'water-cold' : wmeters('hot').length ? 'water-hot' : 'home');
    var h = '<div class="wiz-top"><a class="btn ghost" href="#' + back + '">' + ico('back', 20) + '<span>' + esc(t('back')) + '</span></a></div><h1>' + esc(t('vc_title')) + '</h1>' + wherePlaceLine();
    var out = function (x) { return { screen: 'S30v', route: 'vkcab', bare: true, closeTo: back, html: h + x }; };
    if (!hcOn()) return out('<p>' + esc(t('vc_pitch')) + '</p><p>' + esc(t('vkc_login')) + '</p><a class="btn" href="#login" data-key="vc-login">' + esc(t('login')) + '</a>');
    vksLoad(); vjLoad();
    if (!VKS.data) return out('<p class="muted">' + SPIN + ' ' + esc(t('hc_loading')) + '</p>');
    if (!vkcAvail()) return out('<div class="banner warn" data-key="vc-down">' + ico('alert', 22) + '<div><p>' + esc(t('vc_down')) + '</p></div></div>');
    var c = wcfg(), ms = wmeters();
    if (vkcGate() !== 'ok' || VCE.edit) {
      return out('<p>' + esc(t('vc_pitch')) + '</p><form id="vc-form" class="panel" novalidate data-key="vc-form">' + waccFields('vc', c, true) +
        '<p class="small muted">' + esc(t('pc_vk_sub')) + ' <a href="#privacy">' + esc(t('hc_privacy')) + '</a></p>' +
        '<div class="row-actions"><button type="submit" class="btn big" data-key="vc-go">' + esc(t('vc_go')) + '</button>' +
        (VCE.edit && vkcGate() === 'ok' ? '<button type="button" class="btn sec" data-act="vc-edit-no">' + esc(t('cancel')) + '</button>' : '') + '</div></form>');
    }
    var acc = String(c.account || '').replace(/\D/g, ''), m = Math.round(((VJ.st && VJ.st.autoDelay) || 600) / 60);
    return out('<div class="verdict ok" data-key="vc-on">' + levelIco('ok', 28) + '<span>' + esc(t('vc_conn_ok')) + '</span></div>' +
      '<p>' + esc(t('vc_on_sub')) + '</p><p class="small">' + esc(t('vkc_acc_line', { a: acc, f: String(c.surname || '').trim() })) + ' <button class="linkbtn" data-act="vc-edit" data-key="vc-edit">' + esc(t('vc_edit')) + '</button></p>' +
      vkcBox(null, ms) +
      '<div class="panel hc ha" data-key="vc-auto-box"><h2>' + ico('camera', 20) + '<span>' + esc(t('vc_auto_t')) + '</span></h2><label class="hc-consent"><input type="checkbox" data-act="vj-auto" data-key="vc-auto"' + (vjAutoOn() ? ' checked' : '') + (VJ.busy || !VJ.st ? ' disabled' : '') + '> <span>' + esc(t('pc_vk_auto', { m: m })) + '</span></label>' +
      (vjAutoOn() ? '<p class="small ok-ink" data-key="vc-auto-on">' + ico('check', 16) + ' ' + esc(t('vc_auto_on')) + '</p>' : '') +
      (VJ.err && !VJ.errFor ? '<div class="banner bad" role="alert">' + ico('alert', 22) + '<div><p>' + esc(VJ.err.human) + '</p></div></div>' : '') + '</div>' +
      '<p class="small muted">' + esc(t('pc_vk_sub')) + '</p>');
  };
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-act="vc-edit"], [data-act="vc-edit-no"]'); if (!el) return;
    e.preventDefault(); VCE.edit = el.getAttribute('data-act') === 'vc-edit'; render(true);
  });
  // «Підключити й перевірити»: рахунок і прізвище — у налаштування води квартири, потім «Перевірити на сайті Водоканалу» (що бачить сайт — нижче)
  document.addEventListener('submit', function (e) {
    if (!e.target || e.target.id !== 'vc-form') return; e.preventDefault();
    var a = (document.getElementById('vc-acc') || {}).value || '', sn = (document.getElementById('vc-sn') || {}).value || '';
    a = String(a).trim(); sn = String(sn).trim();
    if (a.replace(/\D/g, '').length < 5 || !sn) { toast(t('vc_bad')); return; }
    wsetCfg(function (cf) { cf.account = a; cf.surname = sn; });
    VCE.edit = false; vkcCheck();
  }, true);
  function cabsSub() { var n = (hcOn() && hcConn() ? 1 : 0) + (vjAutoOn() ? 1 : 0); return n ? t('pc_sub_on', { n: n }) : t('pg_cabs_s'); }
  /** Фото водомірів із бота при автовідправці: чому НЕ надсилаємо самі — або null. Лише холодна, усе прочитано впевнено, без зауважень перевірки. */
  function wnAutoWhy(loc) {
    if (!loc) { var g = vkcGate(); if (g !== 'ok') return g === '' ? 'site' : 'acc'; if (!Wt.vkWindow(today()).open) return 'closed'; }   // loc — місцевий КП (LocalBot): своє вікно, свої водоміри
    if ((WN.unused || []).length) return 'unused';
    var mids = Object.keys(WN.src).filter(function (k) { return WN.src[k] && WN.src[k].value !== null && WN.src[k].value !== undefined; });
    if (!mids.length) return 'none';
    var byId = {}; wmeters().forEach(function (m) { byId[m.id] = m; });
    if (mids.some(function (k) { return !byId[k] || (!loc && byId[k].kind !== 'cold'); })) return 'hot';
    if (Object.keys(WN.src).some(function (k) { var x = WN.src[k]; return !x.sure || x.half || x.guess || x.lead || x.partial || x.value === null; })) return 'unsure';
    var iss = wnCheck(false);
    if (mids.some(function (k) { return (iss[k] || []).some(function (x) { return x.level === 'block' || x.level === 'warn'; }); })) return 'check';
    return null;
  }
  /** Автовідправка залежить від стану з сервера (згода — /vk/jobs, сайт відкривається — /vk/status): дочекатися їх (до ~5 с), потім вирішити. */
  function wnAutoSoon(w, n) {
    if (WN !== w || routeName() !== 'wnew') return;
    if ((!VJ.st || !VKS.data) && n < 25) { vjLoad(); vksLoad(); setTimeout(function () { wnAutoSoon(w, n + 1); }, 200); return; }
    if (vjAutoOn()) wnAuto();
  }
  /** Усе гаразд — зберегти запис води й поставити в чергу автовідправки (надішлемо через 10 хв, можна скасувати); ні — банер із причиною. */
  function wnAuto() {
    var why = wnAutoWhy(); if (why) { WN.autoWhy = why; render(true); return false; }
    // сохраняем только прочитанное с фото (гарячу, якої на фото немає, не вимагаємо) — і в чергу
    var vals = {}; Object.keys(WN.src).forEach(function (mid) { var v = Wt.norm(WN.vals[mid]); if (v !== null) vals[mid] = v; });
    WN.kind = 'cold'; WN.back = ''; var rec = wnStore(vals, false);
    if (rec) vjQueue(rec, true);
    return !!rec;
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
  function waccFields(pre, c, onSubmit) {
    // onSubmit — поля формы (экран «Сайт Водоканалу»): сохраняем только по кнопке, а не каждое изменение
    var a = onSubmit ? '' : ' data-wcfg="account"', f = onSubmit ? '' : ' data-wcfg="surname"';
    return '<div class="grid2"><div class="field"><label for="' + pre + '-acc">' + esc(t('wa_acc')) + '</label><div class="ctl"><input id="' + pre + '-acc" class="num" inputmode="numeric" autocomplete="off"' + a + ' value="' + esc(c.account || '') + '">' + ctlCopy(pre + '-acc') + '</div><div class="help">' + esc(t('wa_acc_h')) + '</div></div>' +
      '<div class="field"><label for="' + pre + '-sn">' + esc(t('wa_sn')) + '</label><div class="ctl"><input id="' + pre + '-sn" autocomplete="family-name"' + f + ' value="' + esc(c.surname || '') + '">' + ctlCopy(pre + '-sn') + '</div><div class="help">' + esc(t(onSubmit ? 'vc_sn_h' : 'wa_sn_h')) + '</div></div></div>';
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
      var r = wprevFor(m.id), sc = null, cap;
      if (r && r.gap) cap = t('wm_cap_gap', { d: fmtDate(r.date, true) });
      else { sc = sentCap(wrecs().filter(function (x) { return hasVal(x, m.id); }), function (x) { return x.base ? baseSent(x) : wsentVk(x) && (kind === 'cold' || wsentHtm(x)); }); r = sc.rec; cap = sc.cap; }
      var ver = verWarn(m.verifiedUntil);
      return mbox({ key: 'wmeter-' + m.id, id: m.id, kind: kind, icon: 'drop', cls: kind === 'hot' ? 'c-hot' : 'c-cold', name: ms.length > 1 ? wname(m) : title,
        display: wdrum(r ? r.vals[m.id] : null, kind, 'hero'), cap: cap, copy: r && r.vals && r.vals[m.id] !== undefined && r.vals[m.id] !== '' ? Wt.whole(r.vals[m.id]) : '', body: sc && sc.note ? '<p class="small muted mb-newer">' + esc(sc.note) + '</p>' : '',
        meta: [ver, m.vkId ? esc(t('mb_vkid', { v: m.vkId })) : ''].filter(Boolean),
        // «Налаштування показань» — акордеон: рахунок, №, ціна (владелец 05.11 21:35–21:40: «верни аккордеон… переназови»);
        // «Заповнити з monobank» — у налаштуваннях показань кожного лічильника (116-а, власник 11.11)
        set: wmeterFields(m, i0 === 0) + (i0 === 0 ? monoLink(kind + '-set') + priceBlock(kind) : '') + gapSetLink(m.id) , setTitle: t('mb_set_read') });
    }).join('');
    // «Розпізнати з фото» — лише на введенні показань (владелец 07.11); тут на її місці — «Куди передати» в рамці
    var act = '<button class="btn big block" data-act="wnew" data-kind="' + kind + '" data-key="water-add">' + ico('plus', 22) + '<span>' + esc(t('wn_title')) + '</span></button>';
    // куди передати: є показання цього місяця — з готовими цифрами, інакше — куди й до якого числа
    var right = whereAcc(wsendPanel(last && thisMonth(last.date) ? last : null, kind));
    // історія: останні три (разом із періодами без лічильника), решта — у вкладці «Історія»
    var wr = wrows(kind, 3);
    if (wr.total) right += histPanel(wr.html, wr.total, '<button class="btn sec block" data-act="view-go" data-v="' + kind + '" data-to="history" data-key="water-all">' + esc(t('wh_all', { n: wr.total })) + '</button>', 'water');
    // «Як знімати й куди передавати» на екрані лічильника прибрано (владелец 07.11) — це є в «Довідці» й у «Куди передати»
    h += heroGrid(left, act, right);
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
      // де на фото табло (рушій знайшов при розпізнаванні) — превью кадрується по ньому
      var fc = f._focus, ref = it.meter ? { id: id, meter: it.meter } : { id: id };
      if (fc && fc.w > 0) ref.f = [fc.x, fc.y, fc.w, fc.h].concat(fc.v ? [fc.v] : []);   // 5-й елемент — рамка вже з червоними роликами
      return ref;
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
  /** Фото записи — тим самим блоком, що й на введенні (09.11): порожній — «Додайте фото лічильника» + «Зняти чи вибрати фото»; є фото — на всю картку,
   *  кілька — гортати («1 / 2»), × прибирає фото із запису (з «Повернути»); нажатие — просмотр на весь экран. gal — имя набора для листания; ref — можно добавить/прибрать.
   *  Без capture: телефон показує своє меню — камера, галерея, файли. */
  var RPU = null;   // останнє прибране фото: { ref, p, i } — «Повернути»
  function photoStrip(list, gal, ref) {
    list = (list || []).filter(function (p) { return p && p.id; }); if (!list.length && !ref) return '';
    var h = '<section class="hphotos" data-key="rec-photos"><h2 class="section-title">' + ico('camera', 18) + ' ' + esc(t(list.length ? 'hp_title' : 'rp_title')) + '</h2>' +
      (ref ? '<input type="file" id="rp-input" class="sr" tabindex="-1" accept="image/*" multiple data-ref="' + esc(ref) + '" aria-label="' + esc(t('rp_add')) + '">' : '');
    h += '<div class="phd' + (list.length ? ' has fit' : '') + (list.length > 1 ? ' many' : '') + '" data-key="rec-phd">';
    if (!list.length) h += '<label for="rp-input" class="phd-empty" tabindex="0" data-key="rec-photo-add">' + ico('image', 52, 'phd-ico') +
      '<span class="phd-t">' + esc(t('phd_add')) + '</span><span class="phd-pill">' + ico('images', 22) + '<span>' + esc(t('phd_pick')) + '</span></span></label>';
    else h += '<div class="phd-strip">' + list.map(function (p, i) {
      var u = hpUrl(p.id), m = p.meter ? wmeters().filter(function (x) { return x.id === p.meter; })[0] : null;
      var gone = HP.missing[p.id] || (!u && !/^l:/.test(p.id));
      return '<div class="phd-slide' + (gone ? ' gone' : '') + '"><img data-gal="' + esc(gal) + '" data-i="' + i + '" data-hph="' + esc(p.id) + '"' + (u ? ' src="' + esc(u) + '"' : '') + phFocusAttr(p, gal) + ' alt="' + esc(t('ph_from', { n: i + 1 })) + '" loading="lazy">' +
        '<span class="gone-t">' + esc(t('hp_gone')) + '</span>' + (list.length > 1 ? '<span class="phd-n">' + (i + 1) + ' / ' + list.length + '</span>' : '') +
        (ref ? '<button type="button" class="phd-x" data-act="rp-rm" data-ref="' + esc(ref) + '" data-id="' + esc(p.id) + '" aria-label="' + esc(t('ph_remove')) + '">' + ico('close', 22) + '</button>' : '') +
        (m ? '<span class="wn-tags"><i class="' + (m.kind === 'hot' ? 'n-hot' : 'n-cold') + '">' + esc(m.name || t('kv_' + m.kind)) + '</i></span>' : '') + '</div>';
    }).join('') + '</div>';
    h += '</div>';
    if (ref && RPU && RPU.ref === ref) h += '<p class="small phd-undo" role="status" data-key="rec-photo-undo">' + esc(t('rp_removed')) + ' <button type="button" class="linkbtn" data-act="rp-undo" data-key="rec-photo-undo-btn">' + esc(t('rp_undo')) + '</button></p>';
    if (ref && list.length) h += '<label for="rp-input" class="phd-more" tabindex="0" data-key="rec-photo-add">' + ico('plus', 18) + '<span>' + esc(t('enp_more')) + '</span></label>';
    return h + '</section>';
  }
  /** Запис за ref (h:/w:/m: + id). */
  function recByRef(ref) { var k = ref.slice(0, 1), id = ref.slice(2); return ((k === 'h' ? S.readings : k === 'w' ? S.water : S.mrecs) || []).filter(function (x) { return x && !x.deleted && x.id === id; })[0] || null; }
  function rpRemove(ref, pid) {
    var rec = recByRef(ref); if (!rec) return; var i = (rec.photos || []).map(function (p) { return p && p.id; }).indexOf(pid); if (i < 0) return;
    RPU = { ref: ref, p: rec.photos[i], i: i }; rec.photos.splice(i, 1); rec.updatedAt = Date.now(); save(); render(true);
    var mine = RPU; setTimeout(function () { if (RPU === mine) { RPU = null; safeRender(); } }, 15000);
  }
  function rpUndo() {
    if (!RPU) return; var rec = recByRef(RPU.ref); if (rec) { rec.photos = rec.photos || []; rec.photos.splice(Math.min(RPU.i, rec.photos.length), 0, RPU.p); rec.updatedAt = Date.now(); save(); }
    RPU = null; render(true);
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
  /** Превью фото — нижче й по табло з показаннями (власник 09.11): p.f = [x, y, w, h] — де на фото табло, частки (рушій при розпізнаванні, VIS().focusOf).
   *  Фото без f (старі, додані в картці запису) у водоміра, світла, газу — вікно барабана шукає швидкий пошук рушія (TeploOCR._drums: за кольором, без моделей;
   *  скрипт ~90 КБ), береться лише впевнене. Тепло (ЖК) без розпізнавання — центр фото. */
  var FOC = { done: {}, busy: false, js: null };
  /** p.f = [x, y, w, h(, v)] — v (90-а): рамку перевірено разом із червоними роликами. Старі [x, y, w, h] у водоміра/світла/газу — лише чорні ролики
   *  (червоні дроби з'їжджали за край превью, газ 7633): показуємо як є й у фоні шукаємо вікно заново (data-fq); не знайшлося — лишаємо старе з позначкою. */
  function phFocusAttr(p, gal) {
    var f = p.f || (FOC.done[p.id] || null), drum = /^[wm]/.test(gal || '') && FOC.done[p.id] === undefined;
    if (f && f.length >= 4 && f[2] > 0) return ' data-f="' + f.slice(0, 4).join(',') + '"' + (drum && f.length < 5 ? ' data-fq="1"' : '');
    return drum ? ' data-fq="1"' : '';
  }
  /** Вікно барабана з TeploOCR._drums (c — чорні ролики, c.redBox — червоні) → рамка навколо обох, частки фото. */
  function drumFocus(c, iw, ih) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, a = +c.angle || 0;
    [c, c.redBox].forEach(function (b) { if (!b || !(b.w > 0)) return;
      var ew = Math.abs(b.w * Math.cos(a)) + Math.abs(b.h * Math.sin(a)), eh = Math.abs(b.w * Math.sin(a)) + Math.abs(b.h * Math.cos(a));
      x0 = Math.min(x0, b.cx - ew / 2); x1 = Math.max(x1, b.cx + ew / 2); y0 = Math.min(y0, b.cy - eh / 2); y1 = Math.max(y1, b.cy + eh / 2); });
    var r3 = function (v) { return Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000; };
    return [r3((x0 + x1) / 2 / iw), r3((y0 + y1) / 2 / ih), r3((x1 - x0) / iw), r3((y1 - y0) / ih), 2];
  }
  /** Кадр превью: табло — рівно в центрі картки (власник 10.11: «чітко по центру табло»). Масштаб — табло на ~60 % ширини й не вище половини картки,
   *  не дрібніше, ніж «на всю картку», і не більше ×3; якщо табло біля краю фото — збільшуємо, щоб і по центру, і без порожнечі (до 90 % ширини, ×3,5),
   *  а коли й так не виходить — по центру з темним полем збоку (фон картки), а не зсунуте до краю. */
  function phFocus(im) {
    var f = String(im.getAttribute('data-f') || '').split(',').map(Number), box = im.parentNode; if (f.length < 4 || !(f[2] > 0) || !box) return;
    var W = box.clientWidth, H = box.clientHeight, iw = im.naturalWidth, ih = im.naturalHeight; if (!W || !H || !iw || !ih) return;
    var fx = Math.max(0, Math.min(1, f[0])), fy = Math.max(0, Math.min(1, f[1])), fw = f[2] * iw, fh = Math.max(1e-6, f[3] * ih);
    var s0 = Math.max(W / iw, H / ih), s = Math.max(s0, Math.min(0.6 * W / fw, 0.5 * H / fh, s0 * 3));
    // без порожнечі по краях: половина картки має вміститися з кожного боку від центру табло
    var sc = Math.max(W / (2 * Math.max(1e-3, Math.min(fx, 1 - fx)) * iw), H / (2 * Math.max(1e-3, Math.min(fy, 1 - fy)) * ih));
    if (sc > s && sc <= Math.min(0.9 * W / fw, 0.8 * H / fh, s0 * 3.5)) s = sc;
    var sw = iw * s, sh = ih * s, l = W / 2 - fx * sw, tp = H / 2 - fy * sh;
    im.style.cssText = 'position:absolute;max-width:none;width:' + sw.toFixed(1) + 'px;height:' + sh.toFixed(1) + 'px;left:' + l.toFixed(1) + 'px;top:' + tp.toFixed(1) + 'px;object-fit:fill';
    im.classList.add('fx');
  }
  function phFocusAll() {
    Array.prototype.forEach.call(document.querySelectorAll('img[data-f]'), function (im) { if (im.complete && im.naturalWidth) phFocus(im); });
    phFocusFind();
  }
  /** Старі фото водоміра/світла/газу: де вікно барабана — по одному, у фоні; знайдене — у запис (p.f, без updatedAt: це лише підказка показу). */
  function phFocusFind() {
    if (FOC.busy) return;
    var im = Array.prototype.filter.call(document.querySelectorAll('img[data-fq]'), function (x) { return x.complete && x.naturalWidth && FOC.done[x.getAttribute('data-hph')] === undefined; })[0];
    if (!im || !window.TEPLO_API) return;
    var id = im.getAttribute('data-hph'); FOC.busy = true;
    var js = window.TeploOCR ? Promise.resolve() : (FOC.js = FOC.js || new Promise(function (ok, bad) {
      var sc = document.createElement('script'); sc.src = String(window.TEPLO_API).replace(/\/api\/?$/, '') + '/web/ocr/engine.js?v=20'; sc.onload = ok; sc.onerror = bad; document.head.appendChild(sc);
    }));
    js.then(function () { return window.TeploOCR._drums(im); }).then(function (cs) {
      var c = (cs || [])[0], iw = im.naturalWidth, ih = im.naturalHeight, k = Math.min(1, 2400 / Math.max(iw, ih));
      var f = c && c.sure && c.score >= 0.9 && c.w > 0 ? drumFocus(c, iw * k, ih * k) : null;
      FOC.done[id] = f || 0;
      // знайдене — у запис (і замість старої рамки лише по чорних); не знайшлося, а стара є — позначити перевіреною, щоб не шукати щоразу
      var upd = false;
      allRecs().forEach(function (r) { (r.photos || []).forEach(function (p) { if (!p || p.id !== id) return;
        if (f && (!p.f || p.f.length < 5)) { p.f = f; upd = true; } else if (!f && p.f && p.f.length === 4) { p.f = p.f.concat([1]); upd = true; } }); });
      if (upd) persist();
      Array.prototype.forEach.call(document.querySelectorAll('img[data-fq]'), function (x) { if (x.getAttribute('data-hph') !== id) return; x.removeAttribute('data-fq');
        if (f) { x.setAttribute('data-f', f.slice(0, 4).join(',')); phFocus(x); } });
    }).catch(function () { FOC.done[id] = 0; }).then(function () { FOC.busy = false; phFocusFind(); });
  }
  document.addEventListener('load', function (e) { var im = e.target; if (!im || im.tagName !== 'IMG') return; if (im.hasAttribute('data-f')) phFocus(im); if (im.hasAttribute('data-fq')) phFocusFind(); }, true);
  var FOC_T = 0; window.addEventListener('resize', function () { clearTimeout(FOC_T); FOC_T = setTimeout(phFocusAll, 150); });
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
    // вивіз сміття — в «Історії» й «Статистиці» (оплати по місяцях); «Економія» — про розхід лічильників, вивозу там немає
    if ((wasteOn() || meterHasData('waste')) && routeName() !== 'save') k.push('waste');
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
  /** «Платіжки Водоканалу» поточної квартири: квитанція з сайту Водоканалу за місяць, показань води за який немає (сервер, VkBills, 08.11). */
  function WRB() { return (S.water || []).filter(function (r) { return r && !r.deleted && r.billOnly && r.ym && r.place === S.placeId; }); }
  function wbKind() { return wmeters('cold', true).length || !wmeters('hot', true).length ? 'cold' : 'hot'; }
  function vbillItem(r) {
    return histRow({ cls: 'hli-bill', key: 'vbill-' + r.id, href: '#wrec-' + r.id, lead: '<span class="hr-bill">' + ico('bill', 16) + esc(t('vb_title')) + '</span>',
      none: t('vb_none'), date: monthLabel(r.ym), sub: [t('hb_sub')], right: billMark(r.bills) });
  }
  /** «Платіжка Водоканалу» без показань: квитанція (PDF з сайту Водоканалу); прибрати запис. */
  function vbillView(r) {
    var m = monthLabel(r.ym);
    return { screen: 'S09', route: 'history', html: recBack() + '<h1>' + esc(t('vb_title')) + ' · ' + esc(m) + '</h1>' +
      '<p class="small muted" data-key="vb-sub">' + esc(t('vb_view_sub')) + '</p>' + billsBox('w:' + r.id, r.bills, t('bl_title', { m: m })) +
      '<div class="row-actions"><button class="btn danger" data-act="wdel" data-id="' + r.id + '" data-key="wrec-del">' + esc(t('rec_del')) + '</button></div>' };
  }
  /** Внесли показання води за місяць, на який уже є «Платіжка Водоканалу», — квитанція переїжджає до них, «Платіжка» зникає. */
  function wbillAdopt(rec) {
    var ym = String((rec && rec.date) || '').slice(0, 7), n = 0; if (!ym || rec.base || rec.billOnly) return 0;
    (S.water || []).forEach(function (b) { if (!b || b.deleted || !b.billOnly || b.ym !== ym || b.place !== rec.place) return; rec.bills = (rec.bills || []).concat(b.bills || []); rec.updatedAt = Date.now(); b.bills = []; b.deleted = true; b.updatedAt = Date.now(); n++; });
    return n;
  }
  /** Після синхронізації: показання за місяць є (внесли з іншого пристрою чи сервер — автовідправка), а квитанція ще в «Платіжці» — переносимо (тепло й вода). */
  function billAdoptAll() {
    var n = 0, first = S.places && S.places[0] ? S.places[0].id : 'main';
    (S.water || []).forEach(function (r) { if (r && !r.deleted && !r.base && !r.billOnly && r.date && (S.water || []).some(function (b) { return b && !b.deleted && b.billOnly && b.ym === r.date.slice(0, 7) && b.place === r.place; })) n += wbillAdopt(r); });
    (S.readings || []).forEach(function (r) {
      if (!r || r.deleted || r.billOnly || !r.htm || !r.htm.date) return; var ym = r.htm.date.slice(0, 7), pl = r.place || first;
      (S.readings || []).forEach(function (b) { if (!b || b.deleted || !b.billOnly || b.ym !== ym || (b.place || first) !== pl) return; r.bills = (r.bills || []).concat(b.bills || []); r.updatedAt = Date.now(); b.bills = []; b.deleted = true; b.updatedAt = Date.now(); n++; });
    });
    return n;
  }
  function wrows(kind, limit) {
    var ms = wmeters(kind, true), ser = Wt.series(wrecs(), wmeters(null, true), gaps());
    // за це платите: від попередньої переданої (статус «передано»; власник 11.11); «для себе» — від попереднього будь-якого
    var sentW = function (r) { return r.base ? baseSent(r) : !!(wsentVk(r) && (kind === 'cold' || wsentHtm(r))); };
    var hasK = function (r) { return ms.some(function (m) { return hasVal(r, m.id); }); }, all = wrecs();
    var rows = ser.slice().reverse().filter(function (x) { return ms.some(function (m) { return hasVal(x.rec, m.id); }); });
    // периоды без водоміра — вперемешку с записями (по дате снятия)
    var gl = gaps().filter(function (g) { return ms.some(function (m) { return m.id === g.what; }); });
    // «Платіжка Водоканалу» (квитанція з сайту без показань за місяць) — у холодній воді (немає холодних водомірів — у гарячій)
    rows = rows.map(function (x) { return { d: x.rec.date, x: x }; }).concat(gl.map(function (g) { return { d: g.from, g: g }; }))
      .concat(kind === wbKind() ? WRB().map(function (b) { return { d: b.date || b.ym + '-28', b: b }; }) : [])
      .sort(function (a, b) { return a.d < b.d ? 1 : a.d > b.d ? -1 : a.g ? -1 : 1; });
    var total = rows.length;
    if (limit) rows = rows.slice(0, limit);
    if (!rows.length) return { total: 0, html: '' };
    return { total: total, html: '<ul class="list wh" data-key="water-history-' + kind + '">' + rows.map(function (y) {
      if (y.g) return gapItem(y.g, ms.length > 1);
      if (y.b) return vbillItem(y.b);
      var x = y.x, own = !!x.rec.own, pf = own || x.rec.base ? null : paidFrom(all, x.rec, hasK, sentW);
      if (pf) { var px = Wt.series([pf.rec, x.rec], wmeters(null, true), gaps())[1]; if (px) x = px; }
      var d = kind === 'hot' ? x.hot : x.cold, days = kind === 'hot' ? x.daysHot : x.daysCold;
      var vs = ms.map(function (m) { var v = Wt.whole(x.rec.vals && x.rec.vals[m.id]); return v === null ? '' : (ms.length > 1 ? (m.name || '') + ' ' : '') + v; }).filter(Boolean).join(', ');
      var sent = wsentVk(x.rec) && (kind === 'cold' || wsentHtm(x.rec)), np = (x.rec.photos || []).length;
      var has = !x.rec.base && d !== null;
      return histRow({ key: 'wrec-' + x.rec.id, href: '#wrec-' + x.rec.id, q: has ? '+' + d : null, unit: 'м³', money: has ? wcostOf(kind, d, x.rec.date) : null,
        none: x.rec.base ? t('wh_base') : t('hr_first'),
        date: fmtDate(x.rec.date, true), sub: [t('hr_on_meter', { v: vs.replace(/<[^>]+>/g, ''), u: 'м³' }), has && days ? days + '\u00a0' + t('days_short') : '', pf ? t('own_paid', { d: fmtDate(pf.date) }) + ' · ' + t('paid_skip', { n: pf.n }) : ''],
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
  /** Картка запису води: між цим і попереднім переданим були проміжні — скільки за це платите від передачі (власник 11.11). */
  function wrecPaid(r) {
    if (r.own || r.base) return '';
    var out = [];
    ['cold', 'hot'].forEach(function (kind) {
      var ms = wmeters(kind, true); if (!ms.some(function (m) { return hasVal(r, m.id); })) return;
      var pf = paidFrom(wrecs(), r, function (y) { return ms.some(function (m) { return hasVal(y, m.id); }); }, function (y) { return y.base ? baseSent(y) : !!(wsentVk(y) && (kind === 'cold' || wsentHtm(y))); });
      var px = pf ? Wt.series([pf.rec, r], wmeters(null, true), gaps())[1] : null, q = px ? px[kind] : null;
      if (q !== null && q !== undefined) out.push(t('own_paid_t', { q: (wmeters(null).length > 1 ? (kind === 'hot' ? t('ru_hot') : t('ru_cold')).toLowerCase() + ' ' : '') + '+' + q + ' м³ · ' + money(wcostOf(kind, q, r.date)) + ' грн', d: fmtDate(pf.date) }));
    });
    return out.join(' · ');
  }
  /** Карточка записи воды: показания всех водомеров, сколько набежало и почём, передача, фото; правка и удаление. */
  function wrecView(id) {
    var vb = WRB().filter(function (x) { return x.id === id; })[0]; if (vb) return vbillView(vb);
    var r = wrecs().filter(function (x) { return x.id === id; })[0], back = recBack();
    if (!r) return { screen: 'S09', route: 'history', html: back + '<p class="muted">' + esc(t('rec_gone')) + '</p>' };
    var x = Wt.series(wrecs(), wmeters(null, true), gaps()).filter(function (s0) { return s0.rec.id === id; })[0] || { by: {}, hot: null, cold: null };
    var ms = wmeters(null, true).filter(function (m) { return hasVal(r, m.id); }), h = back + '<h1>' + esc(fmtDate(r.date, true)) + '</h1>';
    if (r.base) h += '<p class="small muted">' + esc(t('wh_base')) + '</p>';
    // 1) скільки набігло за місяць (місяць — за датою зняття, як у Водоканалу) і скільки коштувало; 2) фото; 3) показання водомірів списком (без барабанів — власник 10.11)
    var vals = usedVals('wrec-values', ms.map(function (m) { var v = r.vals[m.id], d = x.by[m.id]; return { n: wname(m), sub: d !== undefined ? '+' + d + ' м³' : '', v: wfmt(v), u: 'м³', copy: Wt.whole(v), ck: 'wrec-copy-' + m.id, k: m.kind }; }));
    // від останнього «Передано» кожного виду (власник 11.11): набігло з минулої оплати й гроші; проміжні — рядком
    var wpa = {}, wq = {}, wpx = {};
    ['hot', 'cold'].forEach(function (kd) {
      var km = wmeters(kd, true); if (r.base || !km.some(function (m) { return hasVal(r, m.id); })) return;
      var a = paidAnchor(wrecs(), r, function (y) { return km.some(function (m) { return hasVal(y, m.id); }); }, function (y) { return y.base ? baseSent(y) : !!(wsentVk(y) && (kd === 'cold' || wsentHtm(y))); });
      var s1 = a ? Wt.series([a.rec, r], wmeters(null, true), gaps())[1] : null;
      if (s1 && s1[kd] !== null && s1[kd] !== undefined) { wpa[kd] = a; wq[kd] = s1[kd]; wpx[kd] = s1; }
    });
    if (wpa.hot || wpa.cold) {
      var pqh = wpa.hot ? wq.hot : null, pqc = wpa.cold ? wq.cold : null, pboth = pqh !== null && pqc !== null, pcw = Wt.cost(pqc || 0, pqh || 0, r.date, wtar()), ptr = Wt.tariffAt(r.date, wtar());
      var pas = [wpa.hot, wpa.cold].filter(Boolean), pA = pas.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })[0], pSent = pas.every(function (a) { return a.sent; });
      var pdays = Math.max(wpa.hot ? wpx.hot.daysHot || 0 : 0, wpa.cold ? wpx.cold.daysCold || 0 : 0), pn = Math.max(wpa.hot ? wpa.hot.n : 0, wpa.cold ? wpa.cold.n : 0);
      h += usedBox({ kind: pboth ? 'water' : pqh !== null ? 'hot' : 'cold', key: 'wrec-used', title: t(pSent ? 'ru_title_paid' : 'ru_title_h', { d: fmtDate(pA.date) }), per: t('ru_per', { a: fmtDate(pA.date), b: fmtDate(r.date), d: pdays }),
        qs: [pqh !== null ? { v: '+' + pqh, u: 'м³', l: pboth ? t('ru_hot') : '', k: 'hot' } : null, pqc !== null ? { v: '+' + pqc, u: 'м³', l: pboth ? t('ru_cold') : '', k: 'cold' } : null].filter(Boolean), money: pcw.total, vals: vals,
        lines: [pqc !== null ? t('ru_w_c', { q: pqc, a: money(ptr.supply), b: money(ptr.drain), s: money(pcw.coldSupply + pcw.coldDrain) }) : '', pqh !== null ? t('ru_w_h', { q: pqh, a: money(ptr.hot), b: money(ptr.drain), s: money(pcw.hot + pcw.hotDrain) }) : '',
          pboth && wpa.hot.date !== wpa.cold.date ? t('ru_w_from', { h: fmtDate(wpa.hot.date), c: fmtDate(wpa.cold.date) }) : '',
          pn && (x.hot !== null || x.cold !== null) ? t('ru_this', { q: (x.hot || 0) + (x.cold || 0), u: 'м³', d: x.days || pdays }) + ' · ' + t('paid_skip', { n: pn }) : ''],
        proj: usedProj((pqh || 0) + (pqc || 0), pdays, pcw.total, 'м³'), note: pboth || pqh !== null ? t('wr_parts', { vk: money(pcw.vk), htm: money(pcw.htm) }) : '' });
    } else if (x.hot !== null || x.cold !== null) {
      var ym = String(r.date).slice(0, 7), wser = Wt.series(wrecs(), wmeters(null, true), gaps());
      var bm = function (kd) { return Wt.monthly(wser, kd, wtar()).filter(function (b0) { return b0.ym === ym; })[0] || null; }, hb = x.hot !== null ? bm('hot') : null, cb = x.cold !== null ? bm('cold') : null;
      var qh = hb ? hb.m3 : x.hot, qc = cb ? cb.m3 : x.cold, c = Wt.cost(qc || 0, qh || 0, r.date, wtar()), tr = Wt.tariffAt(r.date, wtar());
      var from = [hb && hb.from, cb && cb.from, x.fromHot, x.fromCold].filter(Boolean).sort()[0], days = Math.max(hb ? hb.days : 0, cb ? cb.days : 0, x.daysHot || 0, x.daysCold || 0), both = qh !== null && qc !== null;
      var self = (qh !== null && qh !== x.hot) || (qc !== null && qc !== x.cold);
      h += usedBox({ kind: both ? 'water' : qh !== null ? 'hot' : 'cold', key: 'wrec-used', title: t('ru_title', { m: monthLabel(ym) }), per: from ? t('ru_per', { a: fmtDate(from), b: fmtDate(r.date), d: days }) : '',
        qs: [qh !== null ? { v: '+' + qh, u: 'м³', l: both ? t('ru_hot') : '', k: 'hot' } : null, qc !== null ? { v: '+' + qc, u: 'м³', l: both ? t('ru_cold') : '', k: 'cold' } : null].filter(Boolean), money: c.total, vals: vals,
        lines: [qc !== null ? t('ru_w_c', { q: qc, a: money(tr.supply), b: money(tr.drain), s: money(c.coldSupply + c.coldDrain) }) : '', qh !== null ? t('ru_w_h', { q: qh, a: money(tr.hot), b: money(tr.drain), s: money(c.hot + c.hotDrain) }) : '',
          self ? t('ru_this', { q: (x.hot || 0) + (x.cold || 0), u: 'м³', d: x.days || days }) : '', wrecPaid(r)],
        proj: usedProj((qh || 0) + (qc || 0), days, c.total, 'м³'), note: both || qh !== null ? t('wr_parts', { vk: money(c.vk), htm: money(c.htm) }) : '' });
    } else if (r.base) h += usedBase('wrec-used', vals, ms.length === 1 ? ms[0].kind : 'water');
    else h += usedOnly(ms.length === 1 ? ms[0].kind : 'water', 'wrec-used', vals);
    h += recPhotos(r.photos, 'w' + r.id, 'w:' + r.id);
    h += (r.base ? '' : billsBox('w:' + r.id, r.bills, t('bl_title', { m: monthLabel(String(r.date).slice(0, 7)) })));
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
    // місяці й гроші — між переданими показаннями цього виду (власник 11.11), а не між будь-якими записами
    var sentK = function (y) { return !!(wsentVk(y) && (kind === 'cold' || wsentHtm(y))); }, km = wmeters(kind, true), hasK = function (y) { return km.some(function (m) { return hasVal(y, m.id); }); };
    var mo = Wt.monthly(Wt.series(paidOnly(wrecs().filter(hasK), sentK), wmeters(null, true), gaps()), kind, wtar()), sm = Wt.summary(mo), head = '<h1>' + esc(t('stt_title')) + '</h1>' + kindSwitch();
    if (!mo.length) return { screen: 'S15', route: 'stats', html: head + '<div class="panel"><p class="muted">' + esc(t('wst_empty')) + '</p></div>' };
    var per = function (b) { return t('stt_period', { a: R.toHtmDate(b.from), b: R.toHtmDate(b.to), d: b.days }); };
    // набігло після останнього «Передано» й ще не передане
    var wl = wrecs().filter(hasK), wlast = wl[wl.length - 1], wsn = null;
    if (wlast && !wlast.base && (wlast.own || !sentK(wlast))) {
      var wa = paidAnchor(wl, wlast, hasK, function (y) { return y.base ? baseSent(y) : sentK(y); }), ws1 = wa && wa.sent ? Wt.series([wa.rec, wlast], wmeters(null, true), gaps())[1] : null;
      if (ws1 && ws1[kind] !== null && ws1[kind] !== undefined) wsn = { d: wa.date, q: ws1[kind], cost: wcostOf(kind, ws1[kind], wlast.date) };
    }
    var tiles = kpi({ key: 'wstats-kpi', tone: kind, q: fmtN(sm.perMonth, 1), unit: 'м³', money: sm.uahMonth, cap: t('kpi_w_avg', { n: sm.months }),
      chips: [chip(t('kpi_w_last', { m: monthLabel(sm.last.ym), v: sm.last.m3, uah: money0(sm.last.cost) }), 'clock')].concat(wsn ? [chip(t('kpi_since', { d: fmtDate(wsn.d), v: fmtN(wsn.q, 1), u: 'м³', uah: money0(wsn.cost) }), 'clock')] : []) });
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
  function sopts(k) { var p = place() || {}, o = { heating: !!p[SK[k].heat], price: k === 'gas' ? R.num(p.gasPrice) : R.num(((p.prov || {}).elec || {}).price) };
    if (k === 'gas') { var g = gdist(p); if (g.month) o.fee = g.month; }
    return o; }
  /**
   * Доставка (розподіл) газу поточної квартири (123-я, власник 12.11: «у платіжці ще за транспортування»): окрема щомісячна плата оператору ГРМ
   * (Газмережі, Київгаз…), однакова щомісяця = річна замовлена потужність ÷ 12 × тариф. Потужність — своя з платіжки (p.gasCap) або оцінка за
   * показаннями газового року (Gs.capFromRecs); тариф — свій (p.gasDist) або з довідника за адресою (gas.dist).
   * → {cap, capSrc: 'own'|'est'|null, est, tariff, trSrc: 'own'|'dir'|null, org, month (грн або null)}
   */
  function gdist(p) {
    p = p || place() || {}; var d = null; try { var j = prvKinds0(p); d = j && j.kinds && j.kinds.gas; } catch (e) { d = null; }
    var own = R.num(p.gasDist), dir = d ? R.num(d.dist) : null, tr = own > 0 ? own : dir > 0 ? dir : null;
    var cap = R.num(p.gasCap), est = null, ms = p === place() ? pmeters('gas', true) : [];
    if (!(cap > 0)) for (var i = 0; i < ms.length && !est; i++) est = Gs.capFromRecs(mrecs(ms[i].id), +today().slice(0, 4));
    var c = cap > 0 ? cap : est ? est.m3 : null;
    return { cap: c, capSrc: cap > 0 ? 'own' : est ? 'est' : null, est: est, tariff: tr, trSrc: own > 0 ? 'own' : dir > 0 ? 'dir' : null,
      org: (d && d.grm) || '', month: Gs.distMonth(c, tr) };
  }
  /** Скільки місяців нарахування між двома датами показань (місяць, за який зараховується), не менше 1. */
  function feeMonths(md, a, b) { var x = md.forMonth(a), y = md.forMonth(b); return Math.max(1, (+y.slice(0, 4) * 12 + +y.slice(5, 7)) - (+x.slice(0, 4) * 12 + +x.slice(5, 7))); }
  /** Примітка під сумою газу: ціна газу і як рахується доставка (або що вписати, щоб рахувалась). */
  function gasNote(price) {
    var g = gdist(), o = g.org || t('gd_org_def');
    if (g.month) return t('gst_tariff_fee', { p: money(price), c: fmtN(g.cap, 0), t: String(g.tariff).replace('.', ','), f: money(g.month), o: o }) + (g.capSrc === 'est' ? ' ' + t('gd_est_s') : '');
    return t('gst_tariff', { p: money(price) }) + ' ' + t(g.tariff ? 'gd_need_cap_s' : 'gd_need_tar_s');
  }
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
    if (!at || rs.every(function (x) { return x.sent && x.sent[src]; })) return '<details class="bot-how" data-key="ed-bot-how"><summary>' + esc(t('bot_how_t')) + ico('chev', 16, 'pacc-chev') + '</summary><ol>' + tk(k, 'ed_bot_steps', { b: '@' + ourBot() }).split('|').map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol></details>';
    var r = (SBR[src].list || []).filter(function (y) { return y.at * 1000 >= at - 120000; })[0], err = SBERR[k] || (r && r.kind === 'err');
    return (r ? '<div class="vk-reply' + (r.kind === 'err' ? ' bad' : '') + '" data-key="' + k + '-reply"><p class="small"><b>' + esc(tk(k, 'ed_reply_t', { d: vkWhen(r.at) })) + '</b></p><p class="small vk-text">' + esc(String(r.text).slice(0, 600)) + '</p></div>' : '') +
      '<div class="vk-ask" data-key="' + k + '-ask"><p><b>' + esc(tk(k, 'ed_ask')) + '</b></p><div class="row-actions">' +
      '<button class="btn" data-act="esent" data-k="' + k + '" data-v="1" data-ids="' + esc(ids) + '" data-key="' + k + '-bot-ok">' + ico('check', 18) + '<span>' + esc(t('vk_ok')) + '</span></button>' +
      '<button class="btn sec" data-act="sb-err" data-k="' + k + '" data-key="' + k + '-bot-err">' + esc(t('vk_err')) + '</button></div>' +
      '<p class="small muted">' + fw + '</p>' +
      (err ? '<div class="vk-tips" data-key="' + k + '-tips"><ul class="small">' + tk(k, 'ed_err_tips').split('|').map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>' : '') + '</div>';
  }
  /** «Перед передачею» (власник 11.11, 114-а): рахунків при налаштуванні не питаємо — тут, коли вже є що передавати, поля для тих, яких немає.
   *  Світло — особовий рахунок; газ — рахунок Газмереж (бот, кабінет) і Нафтогазу (SMS 4647). Зберігаються одразу (data-em, як у налаштуваннях). */
  function saccAsk(k, ms) {
    var need = ms.filter(function (m) { return k === 'gas' ? !dgt(m.grm) || !dgt(m.account) : !dgt(m.account); });
    if (!need.length) return '';
    return '<div class="acc-ask" data-key="' + k + '-acc-ask"><p class="small"><b>' + esc(tk(k, 'eacc_ask_t')) + '</b> <span class="muted">' + esc(tk(k, 'eacc_ask_s')) + '</span></p>' + need.map(function (m) {
      return (ms.length > 1 ? '<p class="small muted acc-ask-m">' + esc(ename(m)) + '</p>' : '') + '<div class="grid2">' +
        (k === 'gas' && !dgt(m.grm) ? sfld(m, 'grm', 'esg-', t('gm_grm'), 'inputmode="numeric"', t('gm_grm_h')) : '') +
        (!dgt(m.account) ? sfld(m, 'account', 'esa-', tk(k, 'em_acc'), 'inputmode="numeric"', tk(k, 'em_acc_h')) : '') + '</div>' +
        (k === 'gas' && !dgt(m.account) ? '<p class="small"><a href="' + Gs.LINKS.find + '" target="_blank" rel="noopener" data-key="gd-find">' + esc(t('gd_find')) + ' ' + ico('ext', 14) + '</a></p>' : '');
    }).join('') + monoLink(k) + '</div>';
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
    var acc = ms.map(function (m) { return saccList(k, m).map(function (x) { return '<p class="small" data-key="esend-' + x[0] + '-' + m.id + '">' + esc(tk(k, x[0], { a: x[1] })) + (ms.length > 1 ? ' · ' + esc(m.name || '') : '') + ' <button class="linkbtn" data-act="copy" data-text="' + esc(x[1]) + '">' + esc(t('copy')) + '</button></p>'; }).join(''); }).join('') +
      (have ? saccAsk(k, ms) : '');
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
      if (smsOn && have && ms.length === 1 && !sms && nafN && nafN !== 9) body += '<p class="small" data-key="gd-noacc">' + esc(nafN ? t('gd_badacc', { n: nafN }) : t('gd_noacc')) + ' <a href="' + Gs.LINKS.find + '" target="_blank" rel="noopener" data-key="gd-find">' + esc(t('gd_find')) + ' ' + ico('ext', 14) + '</a></p>';
      // готовий текст SMS — уже в кнопці «SMS на 4647» (відкриває SMS з набраним текстом); окремим рядком — дубль
      chans = [[Gs.LINKS.bot, t('gd_bot'), 'send', 'bot', botAttr]].concat(sms ? [['sms:' + Gs.LINKS.sms + '?&body=' + encodeURIComponent(sms), t('gd_sms'), 'send', 'sms']] : []);
      // бот Газмереж питає філію: у Харкові — «Харківська міська», в області — «Харківська» (за довідником адреси)
      var gdp = prvOf('gas'); if (gdp && gdp.grm && /^Газмережі/.test(gdp.grm)) body += '<p class="small muted" data-key="gd-fil">' + esc(t('gd_fil', { g: String(gdp.grm).replace(/^Газмережі,\s*/, '') })) + '</p>';
      more = '<p class="dm-links"><a href="' + Gs.LINKS.kub + '" target="_blank" rel="noopener" data-key="dest-grm-kub">' + esc(t('gd_kub')) + ' ' + ico('ext', 14) + '</a><a href="' + Gs.LINKS.cabinet + '" target="_blank" rel="noopener" data-key="dest-grm-cab">' + esc(t('gd_cab')) + ' ' + ico('ext', 14) + '</a></p>' +
        '<p class="dm-t">' + esc(t('gd_kub_call')) + '</p><ul class="dm-ph"><li>' + telLink(Gs.KUB_TEL[0], Gs.KUB_TEL[1]) + '<span class="muted">' + esc(t('gd_kub_free')) + '</span></li></ul>' +
        '<p class="dm-t">' + esc(t('gd_call')) + '</p>' + phones;
    } else {
      // офіційні канали Харківобленерго: бот @Kooz2bot, онлайн-форма (з капчею — відкриваємо, людина проходить), SMS 4300
      var m0 = ms[0] || {}, acc1 = String(m0.account || '').replace(/\D/g, '');
      var esms = (have && ms.length === 1 && El.zones(m0) <= 1 && acc1.length === 12) ? El.smsText(acc1, (have.filter(Boolean)[0].z || {}).all) : null;
      chans = [[El.OBL_BOT, t('ed_bot'), 'send', 'bot', botAttr], [El.OBL_FORM, t('ed_form'), 'ext', 'form']].concat(esms ? [['sms:' + El.SMS + '?&body=' + encodeURIComponent(esms), t('ed_sms'), 'send', 'sms']] : []);
      more = '<p class="dm-t">' + esc(t('ed_call')) + '</p>' + phones +
        '<p class="dm-t">' + esc(t('ed_app_t')) + '</p><p class="dm-links"><a href="' + El.OBL_APP_ANDROID + '" target="_blank" rel="noopener">Android ' + ico('ext', 14) + '</a><a href="' + El.OBL_APP_IOS + '" target="_blank" rel="noopener">iPhone ' + ico('ext', 14) + '</a></p>' +
        (ms.some(function (m) { return !dgt(m.account); }) ? '<p class="dm-t">' + esc(t('ed_acc_t')) + '</p><p>' + esc(t('ed_zbut2')) + ' <a href="' + El.ZBUT_SITE + '" target="_blank" rel="noopener">zbutenergo.kharkov.ua</a></p>' : '');
    }
    var mark = have && !asking ? '<p class="dest-mark">' + (allSent ? '<button class="linkbtn" data-act="esent" data-k="' + k + '" data-v="0" data-ids="' + ids + '">' + esc(t('ws_unmark')) + '</button>'
      : '<button class="btn sec" data-act="esent" data-k="' + k + '" data-v="1" data-ids="' + ids + '" data-key="esend-done">' + ico('check', 18) + '<span>' + esc(t('ws_mark')) + '</span></button>') + '</p>' : '';
    // квартира поза Харківщиною: не Харківобленерго / не бот Газмереж, а місцевий постачальник із довідника (як і коли, кабінет, бот, телефони)
    var loc = prvLocal(k);
    if (loc) return '<section class="panel where" data-key="where-' + k + '"><h2>' + ico('send', 18, 'bt-ico') + '<span>' + esc(t('wd_title')) + '</span></h2>' + wherePlaceLine() +
      localDest(k, loc, body + acc, have ? '<p class="dest-mark">' + (allSent ? '<button class="linkbtn" data-act="esent" data-k="' + k + '" data-v="0" data-ids="' + ids + '">' + esc(t('ws_unmark')) + '</button>'
        : '<button class="btn sec" data-act="esent" data-k="' + k + '" data-v="1" data-ids="' + ids + '" data-key="esend-done">' + ico('check', 18) + '<span>' + esc(t('ws_mark')) + '</span></button>') + '</p>' : '', allSent,
        lbBox(loc, have || [], lbItemsS(k, ms, have), ms.length === 1 && dgt(ms[0].account) ? { acc: dgt(ms[0].account) } : null)) + '</section>';
    return '<section class="panel where" data-key="where-' + k + '"><h2>' + ico('send', 18, 'bt-ico') + '<span>' + esc(t('wd_title')) + '</span></h2>' +
      (places().length > 1 ? '<p class="dest-place" style="--pc:var(--pc-' + placeColor(place()) + ')" data-key="where-place"><b>' + esc(t('wd_for', { p: placeLabel(place()) })) + '</b>' + (placeSub(place()) ? '<span class="small muted"> · ' + esc(placeSub(place())) + '</span>' : '') + '</p>' : '') +
      destBox({ key: k === 'gas' ? 'grm' : 'obl', id: 'esend', org: tk(k, 'ed_org'), what: '', due: due, dueTone: w.open && w.daysLeft <= 1 ? 'warn' : 'neutral', sent: allSent, body: body + acc, chans: chans, note: have ? sbBox(k, have) : '', more: more, mark: mark }) + '</section>';   // цифри → рахунок → кнопки → «Як це в боті» / відповідь бота
  }
  /** Рядки історії (нові зверху): скільки набігло і почім, на лічильнику, передано. */
  function srows(k, limit) {
    var ms = smeters(k, true), md = SK[k].mod, u = SK[k].unit(), rows = [];
    ms.forEach(function (m) {
      // за це платите: від попередньої переданої (статус «передано»; власник 11.11); «для себе» — від попереднього будь-якого
      var all = mrecs(m.id), sentS = function (r) { return r.base ? baseSent(r) : ssent(k, r); };
      md.series(all, m).forEach(function (x) { var pf = x.rec.own || x.rec.base ? null : paidFrom(all, x.rec, function () { return true; }, sentS); rows.push({ m: m, x: pf ? md.series([pf.rec, x.rec], m)[1] || x : x, pf: pf }); });
    });
    rows.sort(function (a, b) { return a.x.rec.date < b.x.rec.date ? 1 : a.x.rec.date > b.x.rec.date ? -1 : a.x.rec.base ? 1 : b.x.rec.base ? -1 : 0; });
    var total = rows.length; if (limit) rows = rows.slice(0, limit);
    if (!rows.length) return { total: 0, html: '' };
    return { total: total, html: '<ul class="list wh" data-key="' + k + '-history">' + rows.map(function (y) {
      var x = y.x, r = x.rec, has = !r.base && x.kwh !== null, c = has ? md.cost(y.m, x.dz, r.date, sopts(k)).total : null;
      return histRow({ key: 'erec-' + r.id, href: '#erec-' + r.id, q: has ? '+' + x.kwh : null, unit: u, money: c, none: r.base ? t('eh_base') : t('hr_first'), date: fmtDate(r.date, true),
        sub: [t('hr_on_meter', { v: (ms.length > 1 ? (y.m.name || '') + ' ' : '') + evals(y.m, r), u: u }), has && x.days ? x.days + ' ' + t('days_short') : '', y.pf ? t('own_paid', { d: fmtDate(y.pf.date) }) + ' · ' + t('paid_skip', { n: y.pf.n }) : ''],
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
  function wmeterFields(m, withAcc, onlyMeter) {
    return (withAcc ? waccFields('mw', wcfg()) : '') + '<div class="grid2">' +
      '<div class="field"><label for="mbn-' + m.id + '">' + esc(t('wm_name')) + '</label><div class="ctl"><input id="mbn-' + m.id + '" data-wm="' + m.id + '" data-wf="name" maxlength="40" value="' + esc(m.name || '') + '" placeholder="' + esc(t('wm_name_ph')) + '"></div></div>' +
      '<div class="field"><label for="mbsn-' + m.id + '">' + esc(t('wm_serial')) + '</label><div class="ctl"><input id="mbsn-' + m.id + '" class="num" autocomplete="off" data-wm="' + m.id + '" data-wf="serial" value="' + esc(m.serial || '') + '">' + ctlCopy('mbsn-' + m.id) + '</div></div>' +
      '<div class="field"><label for="mbv-' + m.id + '">' + esc(t('mv_date')) + '</label><div class="ctl"><input id="mbv-' + m.id + '" type="date" data-wm="' + m.id + '" data-wf="verifiedUntil" value="' + esc(m.verifiedUntil || '') + '"></div></div>' +
      (onlyMeter ? '' : wvkField(m, t('wm_vkid'))) + '</div>';
  }
  /** Код водоміра в боті Водоканалу — номер у постачальника (на екрані квартири — у «Постачальники, тарифи й рахунки»). */
  function wvkField(m, lbl) { return '<div class="field"><label for="mbi-' + m.id + '">' + esc(lbl) + '</label><div class="ctl"><input id="mbi-' + m.id + '" class="num" inputmode="numeric" autocomplete="off" data-wm="' + m.id + '" data-wf="vkId" value="' + esc(m.vkId || '') + '">' + ctlCopy('mbi-' + m.id) + '</div></div>'; }
  /** Налаштування теплолічильника в блоці: модель (змінити — вибір моделі), повірка. */
  function heatMeterFields(m, onlyMeter) {
    var hm = S.meter || {};
    return '<div class="grid2">' + (onlyMeter ? '' : hmAccField()) +
      '<div class="field"><span class="lbl">' + esc(t('p_meter')) + '</span><p style="margin:0"><b>' + esc(modelName(m)) + '</b> · <a href="#meter" data-key="mb-heat-model">' + esc(t('change')) + '</a></p></div>' +
      '<div class="field"><label for="p-hser">' + esc(t('wm_serial')) + '</label><div class="ctl"><input id="p-hser" class="num" autocomplete="off" data-hm="serial" value="' + esc(hm.serial || '') + '">' + ctlCopy('p-hser') + '</div></div>' +
      '<div class="field"><label for="p-ver">' + esc(t('mv_date')) + '</label><div class="ctl"><input id="p-ver" type="date" value="' + esc(hm.verifiedUntil || '') + '"></div></div></div>';
  }
  function hmAccField() { var hm = S.meter || {}; return '<div class="field"><label for="p-hacc">' + esc(t('hm_acc')) + '</label><div class="ctl"><input id="p-hacc" class="num" inputmode="numeric" autocomplete="off" data-hm="account" value="' + esc(hm.account || '') + '">' + ctlCopy('p-hacc') + '</div><div class="help">' + esc(t('hm_acc_h')) + '</div></div>'; }
  /** «Ціна» в налаштуваннях кожного лічильника: відома — вже вписана (з довідника за адресою чи з платіжки), невідома — порожнє
   *  поле і прохання вписати з платіжки. k: heat | hot | cold | elec | gas. Пишемо в квартиру: p.prov[heat|water|elec].price…, p.gasPrice, p.bill.abon. */
  function priceBlock(k) {
    var p = place() || {}, a = String(p.address || '').trim(), j = a ? prvLoad(p) : null, reg = j && j.found && j.kinds ? j.kinds : null;
    var pk = k === 'hot' || k === 'cold' ? 'water' : k, my = (p.prov || {})[pk] || {}, d = reg && reg[pk], f = function (v) { return v === null || v === undefined || v === '' ? '' : money(v); };
    var fld = function (id, lbl, val, unit, ph) { return '<div class="field"><label for="' + id + '">' + esc(lbl) + '</label><div class="ctl"><input id="' + id + '" class="num" inputmode="decimal" autocomplete="off" data-mp="' + id + '" value="' + esc(val) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '><span class="unit">' + esc(unit) + '</span></div></div>'; };
    var h = '', own = false, unknown = false, src = '', gfee = '';
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
      // доставка (розподіл, 123-я): річна потужність з платіжки Газмереж і тариф (довідник або свій)
      var gd = gdist(p);
      h += fld('mp-gcap', t('gd_cap'), R.num(p.gasCap) > 0 ? fmtN(R.num(p.gasCap), 0) : '', 'м³', gd.est ? t('gd_cap_ph', { n: gd.est.m3 }) : '') +
        fld('mp-gdist', t('gd_tar'), gd.tariff ? String(gd.tariff).replace('.', ',') : '', 'грн');
      gfee = gd.month ? t('gd_fee', { c: fmtN(gd.cap, 0), p: String(gd.tariff).replace('.', ','), f: money(gd.month) }) + (gd.capSrc === 'est' ? ' ' + t('gd_est', { a: R.toHtmDate(gd.est.from), b: R.toHtmDate(gd.est.to) }) : '')
        : gd.tariff ? t('gd_need_cap') : t('gd_need_tar');
    }
    var note = own ? t('mp_own') : unknown ? t('mp_unknown', { c: (j.place && j.place.name) || a }) : !a ? t('mp_noaddr') : src ? t('mp_from', { s: src }) : '';
    return '<div class="mp" data-key="mp-' + k + '"><h4 class="mp-h">' + esc(t('mp_title')) + '</h4><div class="grid2">' + h + '</div>' +
      (note ? '<p class="small ' + (unknown ? 'warn-text' : 'muted') + '" data-key="mp-note-' + k + '">' + esc(note) + '</p>' : '') +
      (gfee ? '<p class="small muted" data-key="mp-gfee">' + esc(gfee) + '</p>' : '') + '</div>';
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
    else if (id === 'mp-gcap') { if (v > 0 && v < 100000) p.gasCap = Math.round(v); else delete p.gasCap; }   // річна замовлена потужність, м³
    else if (id === 'mp-gdist') { var gd0 = gdist(p); if (v > 0 && v < 100 && !(gd0.trSrc === 'dir' && Math.abs(v - gd0.tariff) < 0.0005 && !(R.num(p.gasDist) > 0))) p.gasDist = v; else if (!(v > 0)) delete p.gasDist; }
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
  function smeterFields(k, m, onlyMeter) {
    var zfree = k === 'elec' && !mrecs(m.id).length;
    return '<div class="grid2">' +
      '<div class="field"><label for="emn-' + m.id + '">' + esc(t('em_name')) + '</label><div class="ctl"><input id="emn-' + m.id + '" maxlength="40" data-em="' + m.id + '" data-ef="name" value="' + esc(m.name || '') + '" placeholder="' + esc(tk(k, 'em_name_ph')) + '"></div></div>' +
      (onlyMeter ? '' : sprovFields(k, m)) +
      '<div class="field"><label for="ems-' + m.id + '">' + esc(t('wm_serial')) + '</label><div class="ctl"><input id="ems-' + m.id + '" class="num" autocomplete="off" data-em="' + m.id + '" data-ef="serial" value="' + esc(m.serial || '') + '">' + ctlCopy('ems-' + m.id) + '</div></div>' +
      '<div class="field"><label for="emv-' + m.id + '">' + esc(t('mv_date')) + '</label><div class="ctl"><input id="emv-' + m.id + '" type="date" data-em="' + m.id + '" data-ef="verifiedUntil" value="' + esc(m.verifiedUntil || '') + '"></div></div></div>' +
      (zfree ? '<fieldset class="field"><legend class="lbl">' + esc(t('ea_zones')) + '</legend><div class="wz-opts" role="radiogroup">' + [1, 2, 3].map(function (n) {
        return '<label class="wz-opt"><input type="radio" name="emz-' + m.id + '" value="' + n + '"' + (El.zones(m) === n ? ' checked' : '') + ' data-em="' + m.id + '" data-ef="zones" data-key="em-z' + n + '"><span><b>' + esc(t('ez_n' + n)) + '</b><span class="small muted">' + esc(t('ea_z' + n + '_s')) + '</span></span></label>';
      }).join('') + '</div></fieldset>' : k === 'elec' ? '<p class="small muted">' + esc(t('em_zones_fix')) + '</p>' : '');
  }
  /** Номери лічильника в постачальника: ГРМ (газ), особовий рахунок, EIC (газ). На екрані квартири — у «Постачальники, тарифи й рахунки». */
  function sprovFields(k, m) {
    return '' +
      (k === 'gas' ? sfld(m, 'grm', 'emg-', t('gm_grm'), 'inputmode="numeric"', t('gm_grm_h'), m.grm && dgt(m.grm).length !== 10 ? t('gm_e_grm', { n: dgt(m.grm).length }) : '') : '') +
      sfld(m, 'account', 'ema-', tk(k, 'em_acc'), 'inputmode="numeric"', tk(k, 'em_acc_h'), k === 'gas' && m.account && dgt(m.account).length !== 9 ? t('gm_e_acc', { n: dgt(m.account).length }) : '') +
      (k === 'gas' ? sfld(m, 'eic', 'eme-', t('gm_eic'), 'autocapitalize="characters" spellcheck="false" maxlength="20"', t('gm_eic_h'), !m.eic ? '' : m.eic.length !== 16 ? t('gm_e_eic', { n: m.eic.length }) : !/^56/.test(m.eic) ? t('gm_e_eic56') : '') : '');
  }
  /** Сторінка виду: табло кожного лічильника, «Внести», «Куди передати», історія, налаштування лічильника. */
  function sPage(k) {
    var ms = smeters(k), p = place() || {}, h = '<h1 class="sr">' + esc(t(KINDS[k].t)) + (p.name ? ' — ' + esc(p.name) : '') + '</h1>';
    var left = ms.map(function (m, i) {
      var sc = sentCap(mrecs(m.id), function (x) { return x.base ? baseSent(x) : ssent(k, x); }), r = sc.rec, cap = sc.cap;
      return mbox({ key: 'emeter-' + m.id, id: m.id, kind: k, icon: SK[k].icon, cls: SK[k].cls, name: ms.length > 1 ? ename(m) : t(KINDS[k].t), sub: [ezonesTxt(m)],
        display: edisplay(m, r, 'hero'), cap: cap, copy: r && r.z && SK[k].mod.zones(m) <= 1 && SK[k].mod.whole(r.z.all) !== null ? SK[k].mod.whole(r.z.all) : '', body: sc.note ? '<p class="small muted mb-newer">' + esc(sc.note) + '</p>' : '',
        meta: [verWarn(m.verifiedUntil)].filter(Boolean),
        set: smeterFields(k, m) + monoLink(k + '-set') + (i === 0 ? priceBlock(k) + sheatRow(k) : '') , setTitle: t('mb_set_read') });
    }).join('');
    if (k === 'elec') left += gpvBox(p, 'elec');
    var w = SK[k].mod.win(today()), cur = w.open ? ms.map(function (m) { return einWin(m.id, w); }) : null;
    var act = '<button class="btn big block" data-act="' + SK[k].nw + '" data-key="' + k + '-add">' + ico('plus', 22) + '<span>' + esc(tk(k, 'en_title')) + '</span></button>', right = whereAcc(ssendPanel(k, cur));
    var er = srows(k, 3);
    if (er.total) right += histPanel(er.html, er.total, '<button class="btn sec block" data-act="view-go" data-v="' + k + '" data-to="history" data-key="' + k + '-all">' + esc(t('wh_all', { n: er.total })) + '</button>', k);
    // «Як знімати й куди передавати» прибрано (владелец 07.11)
    h += heroGrid(left, act, right);
    return { screen: k === 'gas' ? 'S55' : 'S50', route: k, html: h };
  }
  V.elec = function () { return sPage('elec'); };
  V.gas = function () { return sPage('gas'); };

  // ---------- ввод показань світла / газу ----------
  /** Блок фото на введенні показань (вода, світло, газ), як у дизайні 09.11: порожній — картка «Додайте фото лічильника» і пігулка «Зняти чи вибрати фото»;
   *  з фото — фото на всю картку з × (кілька — гортати вбік); розпізнавання — сканер поверх фото; перше завантаження модуля (~30 МБ) — кільце з відсотками.
   *  o: {p: 'en'|'wn' (id: p-files, p-phd, p-prog, p-pbar, p-ring), photos, busy, stage: load|read, q (0–1 модуля), pct, prog, stop, rm, tags(i), hint, more}. */
  var PHD_C = 125.66;   // довжина кола кільця (r = 20)
  function phCard(o) {
    var p = o.p, ph = o.photos || [], st = o.busy ? (o.stage || 'read') : '';
    var h = '<div class="phd' + (ph.length ? ' has' : '') + (ph.length > 1 ? ' many' : '') + (ph.length && !o.busy ? ' fit' : '') + '" id="' + p + '-phd" data-stage="' + st + '" data-key="' + p + '-phd">';
    if (!ph.length) h += '<label for="' + p + '-files" class="phd-empty" tabindex="0" data-key="' + p + '-photo-pick">' + ico('image', 40, 'phd-ico') +
      '<span class="phd-t">' + esc(o.title || t('phd_add')) + '</span><span class="phd-pill">' + ico('images', 22) + '<span>' + esc(t('phd_pick')) + '</span></span></label>';
    else h += '<div class="phd-strip">' + ph.map(function (x, i) {
      var fc = !o.busy && x.file && x.file._focus;
      return '<div class="phd-slide"><img data-gal="' + p + '" data-i="' + i + '" src="' + x.url + '"' + (fc && fc.w > 0 ? ' data-f="' + [fc.x, fc.y, fc.w, fc.h].join(',') + '"' : '') + ' alt="' + esc(t('ph_from', { n: i + 1 })) + '">' +
        (ph.length > 1 ? '<span class="phd-n">' + (i + 1) + ' / ' + ph.length + '</span>' : '') +
        (o.busy ? '' : '<button type="button" class="phd-x" data-act="' + o.rm + '" data-i="' + i + '" aria-label="' + esc(t('ph_remove')) + '">' + ico('close', 22) + '</button>') +
        (o.tags ? o.tags(i) : '') + '</div>';
    }).join('') + '</div>';
    if (o.busy) h += '<div class="phd-over" role="status" aria-live="polite">' +
      '<div class="phd-load" aria-hidden="true"><svg class="phd-ring" viewBox="0 0 48 48"><circle class="bg" cx="24" cy="24" r="20"/><circle class="fg" id="' + p + '-ring" cx="24" cy="24" r="20" style="stroke-dasharray:' + PHD_C + ';stroke-dashoffset:' + (PHD_C * (1 - Math.max(0, Math.min(1, o.q || 0)))).toFixed(1) + '"/></svg>' + ico('download', 18) + '<b class="phd-pct" id="' + p + '-lpct">' + Math.round((o.q || 0) * 100) + '%</b></div>' +
      '<div class="phd-scan" aria-hidden="true"><i class="phd-beam"></i><b class="k1"></b><b class="k2"></b><b class="k3"></b><b class="k4"></b></div>' +
      '<div class="phd-st"><p class="phd-msg" id="' + p + '-prog">' + esc(o.prog || '') + '</p>' +
      '<div class="phd-bar" aria-hidden="true"><i id="' + p + '-pbar" style="width:' + (o.pct || 2) + '%"></i></div>' +
      '<button type="button" class="phd-stop" data-act="' + o.stop + '" data-key="' + o.stop + '">' + ico('close', 16) + '<span>' + esc(t('ph_stop')) + '</span></button></div></div>';
    // камера з підказками (121-а) — у тій самій плашці, під «Зняти чи вибрати фото»
    if (!ph.length && o.cam) h += '<div class="phd-camrow">' + camBtn(o.cam, 'phd-cam') + '</div>';
    h += '</div>';
    if (ph.length && !o.busy) h += '<div class="phd-acts"><label for="' + p + '-files" class="phd-more" tabindex="0" data-key="' + p + '-photo-pick">' + ico('plus', 18) + '<span>' + esc(o.more) + '</span></label>' + (o.cam ? camBtn(o.cam, 'phd-cam sm') : '') + '</div>';
    // «Як фотографувати» — заголовок-розкривашка над текстом, порада не висить постійно (владелец 10.11)
    if (!ph.length) h += '<details class="phd-tips" data-key="' + p + '-tips"><summary>' + esc(t('ph_tips_t')) + ico('chev', 18, 'pacc-chev') + '</summary>' +
      '<p class="small phd-hint">' + esc(o.hint) + '</p><ul>' + t('phd_tips').split('|').map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></details>';
    return h;
  }
  /* ---------- Картка фото в чаті бота (121-а): ?inbox=1&card=ID — розпізнати фото з чату тут (безкоштовно, на телефоні) й віддати
   *  картці цифри та план відправки; «Відправити» людина натискає в самій картці, статус — там же. Не все гаразд — лишаємось тут виправити. ---------- */
  var CARD = { id: ((location.search.match(/[?&]card=(\d{1,10})(?:&|$)/) || [])[1]) || '', posted: false };
  function cardPost(items, close) {
    if (!CARD.id || CARD.posted || !window.TEPLO_API) return; CARD.posted = true;
    Y().api('POST', '/bot/card', { card: +CARD.id, items: items, lang: S.lang }).then(function (j) {
      if (!close || !j || j._status !== 200) return;
      toast(t('bc_back'));
      var tg = window.Telegram && Telegram.WebApp; if (tg && tg.initData && tg.close) setTimeout(function () { try { tg.close(); } catch (e) { /* лишаємось */ } }, 1200);
    }, function () { CARD.posted = false; });
  }
  /** Людина виправила й поставила в чергу тут, у застосунку — картка в чаті показуватиме статус цієї задачі. */
  function cardJob(svc, job, row) {
    if (!CARD.id || !job || !job.id || CARD.job === job.id || !window.TEPLO_API) return; CARD.job = job.id; CARD.posted = true;
    Y().api('POST', '/bot/card', { card: +CARD.id, items: [Object.assign({ ok: 1, job: { svc: svc, id: job.id } }, row)], lang: S.lang }).catch(function () {});
  }
  /** Не все прочитано чи перевірка з зауваженнями — картці: «перевірте в застосунку»; людина вже тут. */
  function cardFix(msg, row) { if (!CARD.posted) CARD.fix = 1; cardPost([Object.assign({ k: 'photo', t: t('bc_photo'), v: '', w: '', ok: 0 }, row || {}, { m: msg || t('bc_none') })], false); }
  /** Після «перевірте» людина виправила й зберегла тут, не відправляючи (122-а): картка в чаті — збережені цифри й, якщо можна, «Відправити». */
  function cardSaved(k, rec) {
    if (!CARD.id || !CARD.fix || CARD.job || !rec || !window.TEPLO_API) return;
    CARD.fix = 0; rec.card = +CARD.id;
    var it = k === 'heat' ? cardHeatRow(rec) : cardWaterRow(rec);
    Y().api('POST', '/bot/card', { card: +CARD.id, items: [it], lang: S.lang }).catch(function () { CARD.fix = 1; });
  }
  /** Тепло, збережене після виправлення: «перевірено» без зауважень і кабінет ХТМ готовий — план для робота; ні — чому (передати в застосунку). */
  function cardHeatRow(rd) {
    var row = { k: 'heat', t: t('bc_heat'), v: rd.htm && rd.htm.energy ? camNum(rd.htm.energy) + ' ' + unitLbl(energyUnit()) : '', w: 'ХТМ', ok: 1 };
    var acc = hcAcc(rd), c = S.contacts || {}, phone = c.phone || (HC.st && HC.st.phone) || '', p = place(rd.place) || place(), m = p && p.id === S.placeId ? S.meter : p && p.meter;
    var heatPl = places().filter(function (x) { var mm = x.id === S.placeId ? S.meter : x.meter; return mm && !mm.removed; });
    var why = rd.status !== 'checked' || rd.verdict === 'block' ? 'bc_saved' :   // зауваження людина бачила й зберегла «перевірено» — як «Передати однаково» windowClosed() ? 'ha_why_closed' : !hcConn() ? 'bc_why_cab' :
      !acc || (heatPl.length > 1 && acc.acc !== String((m && m.account) || '').replace(/\D/g, '')) ? 'bc_why_acc' : !phone ? 'bc_why_phone' : '';
    if (why) return Object.assign(row, { m: t(why) });
    var vals = htmRobotVals(rd);
    return Object.assign(row, { m: '', plan: { svc: 'htm', in: { acc: acc.acc, rid: rd.id, place: rd.place || S.placeId, vals: vals, phone: phone, email: c.email || '' } } });
  }
  /** Вода, збережена після виправлення: Харківводоканал (холодна, рахунок, вікно) чи місцевий КП з ботом — план; ні — чому. */
  function cardWaterRow(rec) {
    var ms = wmeters().filter(function (m) { return hasVal(rec, m.id); }), lb = cardLb();
    var row = { k: 'water', t: t('bc_water'), w: lb ? lb.d.org || '' : t('bc_vk'), ok: 1, m: '',
      v: ms.map(function (m) { return (ms.length > 1 ? wname(m).toLowerCase() + ' ' : '') + camNum(Wt.whole(rec.vals[m.id])); }).join(' · ') + (ms.length ? ' м³' : '') };
    if (!ms.length) return Object.assign(row, { ok: 0, m: t('bc_none') });
    if (lb) { var lp = cardLbPlan(lb, rec); return Object.assign(row, { m: lp.m || '', plan: lp.plan || null }); }
    var g = vkcGate();
    if (g !== 'ok') return Object.assign(row, { m: t(g === '' ? 'bc_why_w_site' : 'bc_why_w_acc') });
    if (!Wt.vkWindow(today()).open || ms.some(function (m) { return m.kind !== 'cold'; })) return Object.assign(row, { m: t('bc_manual') });
    var c = wcfg();
    return Object.assign(row, { plan: { svc: 'vk', in: { acc: c.account || '', fam: c.surname || '', rid: rec.id, place: rec.place || S.placeId, items: vjItems(rec) } } });
  }
  function cardHeatSoon(n) {
    if (HC.loading && n < 25) { setTimeout(function () { cardHeatSoon(n + 1); }, 200); return; }
    if (!cardHeat()) { PHS.save(false); render(true); }
  }
  /** Тепло: усе прочитано й перевірено — запис «перевірено» (як автоподача) + план для робота ХТМ; внесе після «Відправити» в картці. */
  function cardHeat() {
    var p = PH.picked || {}, row = { k: 'heat', t: t('bc_heat'), v: p.energy ? camNum(p.energy.value) + ' ' + unitLbl(energyUnit()) : '', w: 'ХТМ' };
    var why = phAutoWhy(), soft = !!(why && /^(cab|acc|phone)$/.test(why.k));
    if (why && !soft) { PH.autoWhy = why; cardFix(t('ha_why_' + why.k, { list: why.list || '' }), row); return false; }
    var d = phAutoDraft(), chk = runCheck(d);
    if (chk.verdict !== 'ok') { cardFix(t('ha_why_check'), row); return false; }
    var files = PH.files.slice(), inbox = PH.inbox;
    S.draft = d; S._lastCheck = chk; phReport(d.values);
    var rd = saveReading('checked'); rd.auto = true; rd.card = +CARD.id; delete S._lastCheck;
    PH.inbox = inbox; inboxDone(); phReset('reading');
    Promise.race([VIS().pendingUploads || Promise.resolve(), new Promise(function (ok) { setTimeout(ok, 5000); })]).then(function () { rd.photos = photoRefs(files.map(function (f) { return { file: f }; })); rd.updatedAt = Date.now(); save(); });
    S.focusId = rd.id; save();
    var acc = hcAcc(rd), c = S.contacts || {}, vals = htmRobotVals(rd);
    cardPost([Object.assign(row, { ok: 1, m: soft ? t('bc_why_' + why.k) : '',
      plan: soft ? null : { svc: 'htm', in: { acc: acc ? acc.acc : '', rid: rd.id, place: rd.place || S.placeId, vals: vals, phone: c.phone || (HC.st && HC.st.phone) || '', email: c.email || '' } } })], true);
    go('home'); return true;
  }
  /** Вода квартири не в Харкові — місцевий КП з ботом (LocalBot, via у довіднику): {d, bot, pl, st} або null. */
  function cardLb() {
    var ld = prvOf('water'); if (!ld || !ld.via || ld.via === 'hvk' || ld.via === 'htm') return null;
    var pl = (place() || {}).id || S.placeId || '';
    return { d: ld, bot: ld.via, pl: pl, st: LB.st[lbKey(ld.via, pl)] };
  }
  /** План картки для місцевого КП: підключено й бот готовий → {plan}; ні — {m: що зробити в застосунку}. */
  function cardLbPlan(lb, rec) {
    var st = lb.st, org = lb.d.org || '', items = lbItems(rec);
    if (!hcOn() || !st || st.none || !st.bot || !st.bot.ready) return { m: t('bc_manual') };
    if (!st.conn) return { m: t('bc_why_lb', { org: org }) };
    if ((st.bot.serial && items.some(function (x) { return !x.serial; })) || (st.bot.one && items.length !== 1)) return { m: t('bc_manual') };
    return { plan: { svc: 'lb', in: { bot: lb.bot, place: lb.pl, rid: rec.id, items: items } } };
  }
  function cardWaterSoon(w, n) {
    if (WN !== w || CARD.posted) return;
    var p = place(), pj = p && String(p.address || '').trim() ? prvLoad(p) : null, lb = pj && !pj.busy ? cardLb() : null;
    if (lb && hcOn()) lbLoad(lb.bot, lb.pl);
    var wait = (pj && pj.busy) || (lb ? hcOn() && !lb.st : !VJ.st || !VKS.data);
    if (wait && n < 25) { if (!lb) { vjLoad(); vksLoad(); } setTimeout(function () { cardWaterSoon(w, n + 1); }, 200); return; }
    cardWater(lb);
  }
  /** Вода: прочитано впевнено й без зауважень — запис + план для робота Водоканалу (холодна, як автовідправка); ні — «перевірте». */
  function cardWater(lb) {
    var byId = {}; wmeters().forEach(function (m) { byId[m.id] = m; });
    var mids = Object.keys(WN.src).filter(function (k) { return byId[k] && WN.src[k] && WN.src[k].value !== null && WN.src[k].value !== undefined; });
    var row = { k: 'water', t: t('bc_water'), w: lb ? lb.d.org || '' : t('bc_vk'), v: mids.map(function (k) { return (mids.length > 1 ? wname(byId[k]).toLowerCase() + ' ' : '') + camNum(WN.vals[k] || ''); }).join(' · ') + (mids.length ? ' м³' : '') };
    if (!mids.length) { cardFix(t('bc_none'), row); return; }
    var why = wnAutoWhy(!!lb), soft = why === 'site' || why === 'acc';
    if (why && !soft) { cardFix(t('bc_fix'), row); return; }
    var vals = {}; mids.forEach(function (k) { var x = Wt.norm(WN.vals[k]); if (x !== null) vals[k] = x; });
    WN.kind = 'cold'; WN.back = 'home'; var rec = wnStore(vals, false); if (!rec) return;
    rec.card = +CARD.id; save();
    if (lb) { var lp = cardLbPlan(lb, rec); cardPost([Object.assign(row, { ok: 1, m: lp.m || '', plan: lp.plan || null })], true); return; }   // місцевий КП (122-а)
    var c = wcfg();
    cardPost([Object.assign(row, { ok: 1, m: soft ? t('bc_why_w_' + why) : '', plan: soft ? null : { svc: 'vk', in: { acc: c.account || '', fam: c.surname || '', rid: rec.id, place: rec.place || S.placeId, items: vjItems(rec) } } })], true);
  }
  /** Світло/газ: робота немає (обленерго за перевіркою Cloudflare) — цифри в картку, передати тут. */
  function cardSimple(k) {
    var ms = smeters(k), got = [];
    ms.forEach(function (m) { SK[k].mod.keys(m).forEach(function (z) { var x = EN.src[m.id + '|' + z]; if (x) got.push((ms.length > 1 || SK[k].mod.keys(m).length > 1 ? ezl(m, z).toLowerCase() + ' ' : '') + camNum(k === 'gas' ? Wt.withFrac(x.v, x.frac) : x.v)); }); });
    cardPost([{ k: k, t: t(k === 'gas' ? 'kd_gas' : 'kd_elec'), v: got.length ? got.join(' · ') + ' ' + SK[k].unit() : '', w: '', ok: got.length ? 1 : 0, m: got.length ? t('bc_manual') : t('bc_none') }], false);
  }
  /* ---------- Камера з підказками (121-а, власник 12.11): web/src/camera.js; тут — що читати на кадрі й куди віддати знімки ---------- */
  function camOk() { return !!(window.TeploCam && TeploCam.supported() && VIS().local); }
  /** Кнопка «Камера з підказками» поруч із «Обрати фото»: c = {in: id поля з фото, kind: heat|water|elec|gas}. Камери сторінці не дають — кнопки нема. */
  function camBtn(c, cls) {
    if (!c || !camOk()) return '';
    return '<button type="button" class="' + (cls || 'btn sec') + '" data-act="cam" data-in="' + esc(c.in) + '" data-kind="' + esc(c.kind) + '" data-key="cam-' + esc(c.kind) + '">' + ico('viewfinder', 22) + '<span>' + esc(t('cam_btn')) + '</span></button>';
  }
  function camCap(x) { x = String(x || ''); return x.charAt(0).toUpperCase() + x.slice(1); }
  function camNum(v) { return String(v).replace('.', ','); }
  /** Що видно на кадрі → {key — однакове в двох кадрах поспіль = знімаю, seen — «енергія 15,482 Гкал», meter, other — інший лічильник} або null. */
  function camParse(kind) {
    var P = window.TeploOCRParse, txt = function (res) { return (res.lines || []).map(function (l) { return [l.text].concat(l.alts || []).join(' '); }).join('\n'); };
    if (kind === 'heat') {
      var m = model(), ctx = { modelId: m ? m.id : '', models: M.MODELS, steps: m && m.status === 'verified' ? m.steps : null, expectedModel: m && m.id !== 'other' ? modelName(m) : '', prev: S.baseline ? { energy: S.baseline.energy, volume: S.baseline.volume, hours: S.baseline.hours } : null, lang: S.lang };
      var ord = R.FIELDS.map(function (f) { return f.key; });
      return function (res) {
        var r = P.photo(res, ctx, 0), ph = r.photo || {};
        if (ph.meterType && ph.meterType !== 'heat') return { other: ph.meterType };
        var rd = (ph.readings || []).filter(function (x) { return x && x.value !== null && x.value !== undefined && String(x.value) !== '' && ord.indexOf(x.field) >= 0; });
        if (!rd.length) return !ph.meterType && (res.drums || []).some(Wt.goodDrum) ? { other: 'water' } : null;
        rd.sort(function (a, b) { return ord.indexOf(a.field) - ord.indexOf(b.field); });
        var top = rd[0], mm = r.meter && r.meter.modelId ? M.byId(r.meter.modelId) : null, u = fieldUnit(top.field);
        return { key: rd.map(function (x) { return x.field + '=' + x.value; }).join('|'), seen: fieldLabel(top.field).toLowerCase() + ' ' + camNum(top.value) + (u ? ' ' + u : ''), meter: mm && mm.id !== 'other' ? modelName(mm) : camCap(t('cam_k_heat')) };
      };
    }
    if (kind === 'water') return function (res) {
      var pk = photoKind(res); if (pk) return { other: pk === 'elec' ? 'electric' : 'gas' };
      if (P.meterType(txt(res)) === 'heat') return { other: 'heat' };
      var w = Wt.fromOcr(res, null); if (!w || w.value === null || w.value === undefined) return null;
      return { key: 'w' + w.value, seen: camNum(Wt.withFrac(w.value, w.frac)) + ' м³', meter: camCap(t('cam_k_water')) };
    };
    var k = kind === 'gas' ? 'gas' : 'elec';
    return function (res) {
      var mt = P.meterType(txt(res)), pk = photoKind(res);
      if (mt === 'heat') return { other: 'heat' };
      if (pk && pk !== k) return { other: pk === 'elec' ? 'electric' : 'gas' };
      if (!pk && mt === 'water') return { other: 'water' };
      var md = SK[k].mod, ms = smeters(k), date = today(), prevBy = {}, days = {}, got = [];
      if (!ms.length) return null;
      ms.forEach(function (m) { var pr = eprev(m.id, date); prevBy[m.id] = pr ? pr.z : {}; if (pr && pr.date) days[m.id] = Math.max(1, R.daysBetween(pr.date, date)); });
      var one = ms.length === 1 && md.keys(ms[0]).length === 1 ? ms[0] : null;
      var dr = k === 'elec' ? El.drumPick(res.drums, res.lines) : (res.drums || []).length ? Wt.fromOcr({ lines: [], drums: res.drums }, one ? (prevBy[one.id] || {}).all : null) : null;
      var shot = { lines: res.lines || [], drum: dr && dr.value !== null && dr.value !== undefined ? { value: dr.value, digits: dr.digits || '', frac: dr.frac || '', sure: !!dr.sure, edge: !!dr.edge, alts: dr.alts || [] } : null };
      var by = md.fromPhotos([shot], ms, prevBy, { days: days, heating: !!sopts(k).heating });
      ms.forEach(function (m) { md.keys(m).forEach(function (z) { var x = by[m.id] && by[m.id][z]; if (x) got.push({ m: m, z: z, v: k === 'gas' ? Wt.withFrac(x.v, x.frac) : String(x.v) }); }); });
      if (!got.length) return null;
      var g = got[0], multi = md.keys(g.m).length > 1 || ms.length > 1;
      return { key: got.map(function (x) { return x.m.id + '|' + x.z + '=' + x.v; }).join(';'), seen: (multi ? ezl(g.m, g.z).toLowerCase() + ' ' : '') + camNum(g.v) + ' ' + SK[k].unit(), meter: camCap(t(k === 'gas' ? 'cam_k_gas' : 'cam_k_electric')) };
    };
  }
  /** Знімки камери → у те саме поле, що й «Обрати фото» (DataTransfer; без нього — властивість files на час події): далі звичний шлях. */
  function camDeliver(id, files) {
    var el = document.getElementById(id); if (!el || !files.length) return false;
    var ok = false, own = false;
    try { var dt = new DataTransfer(); files.forEach(function (f) { dt.items.add(f); }); el.files = dt.files; ok = !!(el.files && el.files.length === files.length); } catch (e) { ok = false; }
    if (!ok) try { Object.defineProperty(el, 'files', { value: files, configurable: true }); own = true; } catch (e) { return false; }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (own) try { delete el.files; } catch (e) { /* лишиться до перемальовування */ }
    return true;
  }
  function camOpen(id, kind) {
    if (!window.TeploCam) return;
    var tg = window.Telegram && Telegram.WebApp && Telegram.WebApp.initData;
    TeploCam.open({ t: t, ico: ico, kind: kind, tg: !!tg, max: kind === 'heat' ? 12 : 8, track: track,
      engine: function (onPct) { return VIS()._engine(onPct); },
      read: function (blob) { return window.TeploOCR.read(blob, { fast: true, drums: kind !== 'heat' }); },
      parse: camParse(kind),
      pick: function () { var el = document.getElementById(id); if (el) el.click(); },
      done: function (files) {
        if (!camDeliver(id, files)) return;
        // тепло: знімки вже прочитані на кадрі — одразу розпізнати пачку, без ще одного натискання
        if (id === 'ph-input' && PH.files.length && PH.status !== 'working') phRun();
      } });
  }
  /** Етап і кільце модуля — без перемальовування (прогрес ллється часто). */
  function phdStage(p, stage, q) {
    var c = document.getElementById(p + '-phd'); if (c && stage) c.setAttribute('data-stage', stage);
    if (q === undefined || q === null) return; q = Math.max(0, Math.min(1, q));
    var r = document.getElementById(p + '-ring'), n = document.getElementById(p + '-lpct'); if (r) r.style.strokeDashoffset = (PHD_C * (1 - q)).toFixed(1); if (n) n.textContent = Math.round(q * 100) + '%';
  }
  function enFresh(k) { return { k: k || 'elec', date: '', vals: {}, back: '', skip: '', photos: [], src: {}, auto: {}, busy: false }; }
  /** «Розпізнати з фото» на введенні світла/газу: фото → движок у браузері → цифри по лічильниках і зонах (EN.src). */
  function enPhotoBox(k) {
    if (!VIS().local) return '';
    var ph = EN.photos || [], ms = smeters(k), h = '<div class="panel wn-photo" data-key="en-photo"><input type="file" id="en-files" accept="image/*" multiple class="sr">';
    h += phCard({ p: 'en', photos: ph, busy: EN.busy, stage: EN.stage, q: EN.q, pct: EN.pct, prog: EN.prog || t('enp_reading'), stop: 'en-stop', rm: 'en-ph-rm', title: t('phd_add_ocr'), hint: t('enp_hint'), more: t('enp_more'), cam: { in: 'en-files', kind: k } });
    if (EN.busy) return h + '</div>';
    if (EN.err) h += '<p class="help warn">' + esc(EN.err) + '</p>';
    if (!ph.length) return h + '</div>';
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
  function enProg(pct, msg, stage, q) {
    EN.pct = Math.max(EN.pct || 2, Math.round(pct)); EN.prog = msg; if (stage) EN.stage = stage; if (q !== undefined) EN.q = q; phdStage('en', stage, q);
    var pb = document.getElementById('en-pbar'), el = document.getElementById('en-prog'); if (pb) pb.style.width = EN.pct + '%'; if (el) el.textContent = msg;
  }
  function enRun(files) {
    if (document.getElementById('en-form')) enRead(); EN.err = '';
    files.forEach(function (f) { EN.photos.push({ file: f, url: URL.createObjectURL(f), res: null }); });
    var todo = EN.photos.filter(function (p) { return !p.res; }), n = todo.length; if (!n) return;
    var gen = EN.gen = (EN.gen || 0) + 1, w = EN, live = function () { return EN === w && EN.gen === gen; };
    var limit = function (pr) { return Promise.race([pr, new Promise(function (ok, bad) { setTimeout(function () { bad(new Error('timeout')); }, 90000); })]); };
    EN.busy = true; EN.pct = 2; EN.prog = t('enp_reading'); EN.stage = 'read'; EN.q = 0; render(true);
    VIS()._engine(function (q) { if (live()) enProg(q * 15, t('phd_load'), q < 1 ? 'load' : 'read', q); }).then(function () {
      var chain = Promise.resolve();
      todo.forEach(function (p, i) {
        chain = chain.then(function () { if (!live()) return null; enProg(15 + 85 * (i + 0.3) / n, n > 1 ? t('ph_reading', { i: i + 1, n: n }) : t('enp_reading'), 'read'); p.t0 = Date.now(); return limit(ocrRead(p.file, { all: true })); })
          .then(function (res) { p.ms = Date.now() - (p.t0 || Date.now()); if (res) p.res = { lines: res.lines || [], drums: res.drums || [] }; }, function () { p.res = { lines: [], drums: [] }; });
      });
      return chain;
    }).then(function () { if (!live()) return; EN.busy = false; enAssign(); render(true); enCheck(true); enReport(); if (CARD.id && !CARD.posted) cardSimple(EN.k); },
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
    var days = {}; ms.forEach(function (m) { var pr = eprev(m.id, date, EN.skip); prevBy[m.id] = pr ? pr.z : {}; if (pr && pr.date) days[m.id] = Math.max(1, R.daysBetween(pr.date, date)); });
    var one = ms.length === 1 && md.keys(ms[0]).length === 1 ? ms[0] : null;
    var shots = EN.photos.map(function (p) {
      if (!p.res) return null;
      // світло: свій розбір барабана (5–6 чорних + 1 червоний, перемички, звірка з рядком тексту); газ — як водомір (5 + 3 червоні)
      var dr = k === 'elec' ? El.drumPick(p.res.drums, p.res.lines) : (p.res.drums || []).length ? Wt.fromOcr({ lines: [], drums: p.res.drums }, one ? (prevBy[one.id] || {}).all : null) : null;
      return { lines: p.res.lines, drum: dr && dr.value !== null && dr.value !== undefined ? { value: dr.value, digits: dr.digits || '', frac: dr.frac || '', sure: !!dr.sure, edge: !!dr.edge, alts: dr.alts || [] } : null };
    });
    var by = md.fromPhotos(shots, ms, prevBy, { days: days, heating: !!sopts(k).heating }); EN.src = {};
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
    var date = EN.date || today(), back = EN.back || backTo(SK[k].page), w = md.win(date);
    var h = '<h1>' + esc(tk(k, 'en_title')) + '</h1><p class="small muted">' + esc(tk(k, w.open ? 'en_lead_open' : 'en_lead_closed', { a: fmtDate(w.open ? w.from : w.next), b: fmtDate(w.to) })) + '</p>' +
      enPhotoBox(k) + '<div class="field f-date"><label for="en-date">' + esc(t('wn_date')) + '</label><div class="ctl"><input id="en-date" type="date" value="' + esc(date) + '" max="' + today() + '"></div></div>' + '<form id="en-form" novalidate><div class="rd-box" data-key="en-box">';
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
    h += '<p class="small rd-hint">' + esc(tk(k, 'en_digits')) + '</p></div><div class="wiz-actions"><button class="btn" type="submit" data-key="en-save">' + esc(t('wn_save')) + '</button></div></form>' + cancelLink(k) + ownField();
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
  /** «Менше, ніж минулого разу» — лише наша перевірка за попередніми записами (власник 12.11.2026): друге «Зберегти» з тими ж
   *  цифрами зберігає на ризик людини. Інші блоки (порожньо, не цифри) — ні. st — EN або WN, iss — {meterId: [зауваження]}. */
  function riskSecond(st, iss) {
    var only = Object.keys(iss).every(function (x) { return (iss[x] || []).every(function (i) { return i.level !== 'block' || i.code === 'less'; }); });
    var sig = JSON.stringify(st.vals || {});
    if (only && st.risk === sig) { delete st.risk; return true; }
    st.risk = only ? sig : null; return false;
  }
  function enSave() {
    enRead(); var iss = enCheck('submit'), k = EN.k, md = SK[k].mod;
    if (Object.keys(iss).some(function (x) { return md.blocked(iss[x]); }) && !riskSecond(EN, iss)) { var f = document.querySelector('.wfield.is-block input'); if (f) f.focus(); return; }
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
    return '<label class="wcam" title="' + esc(t('wn_photo')) + '" data-key="cam-' + target + '"><input type="file" accept="image/*" class="sr" data-sphoto="' + target + '" aria-label="' + esc(t('wn_photo') + (label ? ': ' + label : '')) + '">' + ico('camera', 20) + '</label>';
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
    var same = smeters(k), z = k === 'gas' ? 1 : EA.zones || 1, back = EA.back || backTo('home'), opt = ' <span class="muted small">(' + esc(t('b_opt')) + ')</span>', u = SK[k].unit();
    var fv = function (id) { return EA.f && EA.f[id] ? ' value="' + esc(EA.f[id]) + '"' : ''; };
    var fld = function (id, lbl, attrs, unit, help, optional, after) { return '<div class="field"><label for="' + id + '">' + esc(lbl) + (optional ? opt : '') + '</label><div class="ctl"><input id="' + id + '" ' + attrs + (/^ea-v-/.test(id) ? '' : fv(id)) + '>' + (unit ? '<span class="unit">' + unit + '</span>' : '') + (after || '') + '</div>' + (help ? '<div class="help">' + esc(help) + '</div>' : '') + '</div>'; };
    var mz = { kind: k, zones: z }, md = SK[k].mod;
    // № і опалення — згорнуто (головне — зони й цифри; кнопка «Додати» ближче). Рахунки (особовий, ГРМ, EIC) тут не питаємо (власник 11.11, 114-а):
    // вибрав лічильник — вносить показання; рахунок — перед передачею (ssendPanel → saccAsk)
    var more = fld('ea-serial', t('wm_serial'), 'class="num" autocomplete="off"', '', '', true) + (same.length ? '' : sheatRow(k, true));
    var mOpen = EA.more || EA.heat === true || EA_F.some(function (id) { return id !== 'ea-name' && EA.f && EA.f[id]; });
    more = '<details class="mbox-set ea-more"' + (mOpen ? ' open' : '') + ' data-key="ea-more"><summary>' + ico('prefs', 18, 'bt-ico') + '<span>' + esc(tk(k, 'ea_more')) + opt + '</span>' + ico('chev', 18, 'pacc-chev') + '</summary><div class="mbox-set-b">' + more + '</div></details>';
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
  var EA_F = ['ea-name', 'ea-serial'];
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
  /** Запис історії (власник 10.11): першим — «Набігло за місяць» і скільки це коштувало, під ним фото, далі показання списком (без табло) і решта.
   *  o: {kind, key, title, per, qs: [{v, u, l}], money, lines: [], proj, note}. */
  function usedBox(o) {
    return '<section class="panel ru ru-' + o.kind + '" data-key="' + o.key + '"><h2 class="ru-t">' + esc(o.title) + '</h2>' + (o.per ? '<p class="ru-per">' + esc(o.per) + '</p>' : '') +
      '<div class="ru-big">' + o.qs.map(function (q) { return '<div class="ru-q"' + (q.k ? ' data-k="' + q.k + '"' : '') + '>' + (q.l ? '<i>' + esc(ucf(q.l)) + '</i>' : '') + '<b class="num">' + esc(q.v) + '</b><span>' + esc(q.u) + '</span></div>'; }).join('') +
      (o.money !== null && o.money !== undefined ? '<div class="ru-m">' + (o.qs.some(function (q) { return q.l; }) ? '<i>' + esc(ucf(t('ru_sum'))) + '</i>' : '') + '<b class="num">≈ ' + esc(money(o.money)) + '</b><span>грн</span></div>' : '') + '</div>' +
      (o.vals || '') +
      ((o.lines || []).filter(Boolean).length ? '<div class="ru-ls">' + o.lines.filter(Boolean).map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') + '</div>' : '') +
      (o.proj ? '<p class="ru-proj">' + esc(o.proj) + '</p>' : '') + (o.note ? '<p class="ru-note">' + esc(o.note) + '</p>' : '') + '</section>';
  }
  function usedBase(key, vals, kind) { return '<section class="panel ru ru-base' + (kind ? ' ru-' + kind : '') + '" data-key="' + key + '"><p class="ru-per">' + esc(t('ru_base')) + '</p>' + (vals || '') + '</section>'; }
  /** Показання запису з копіюванням — у тому ж блоці, що й «Набігло» та гроші (власник 11.11: «один шаблон для всіх лічильників»).
   *  key — data-key списку; rows: [{n, sub, v, u, copy, ck, k}] (copy — що копіювати; немає — без кнопки). */
  function usedVals(key, rows) {
    rows = (rows || []).filter(Boolean); if (!rows.length) return '';
    return '<ul class="ru-vals" data-key="' + key + '">' + rows.map(function (x) {
      var cp = copyIco(x.copy, x.ck);
      return '<li' + (x.k ? ' data-k="' + x.k + '"' : '') + (x.minor ? ' class="minor"' : '') + '><span class="grow">' + esc(x.n) + (x.sub ? ' <span class="muted">· ' + esc(x.sub) + '</span>' : '') + '</span><b class="num">' + esc(x.v) + '</b>' + (x.u ? '<span class="u">' + esc(x.u) + '</span>' : '') + (cp || '<span class="copy-sp" aria-hidden="true"></span>') + '</li>';
    }).join('') + '</ul>';
  }
  /** Запис без «Набігло» (перший, розхід не порахувати) — той самий блок, лише показання. */
  function usedOnly(kind, key, vals, per) { return vals ? '<section class="panel ru ru-only ru-' + kind + '" data-key="' + key + '"><h2 class="ru-t">' + esc(t('ru_vals')) + '</h2>' + (per ? '<p class="ru-per">' + esc(per) + '</p>' : '') + vals + '</section>' : ''; }
  /** Місяць ще не весь (до 25 днів) — «якщо так і далі»: розхід і гроші в перерахунку на 30,4 дня за тією ж ціною. */
  function usedProj(q, days, cost, u, dec) {
    if (!(days > 0) || days >= 25 || !(q > 0)) return '';
    var k = MONTH_DAYS / days; return t('ru_proj', { q: fmtN(q * k, dec || 0), u: u, s: money0(cost * k) });
  }
  /** Фото запису — окремим блоком під «Набігло». */
  function recPhotos(list, gal, ref) { var ps = photoStrip(list, gal, ref); return ps ? '<div class="panel rec-ph">' + ps + '</div>' : ''; }
  /** Картка запису: між цим і попереднім переданим були проміжні — «За це платите: +N кВт·год · S грн від передачі D» (власник 11.11). */
  function erecPaid(k, m, r) {
    if (r.own || r.base) return '';
    var md = SK[k].mod, pf = paidFrom(mrecs(m.id), r, function () { return true; }, function (y) { return y.base ? baseSent(y) : ssent(k, y); }), px = pf ? md.series([pf.rec, r], m)[1] : null;
    return px && px.dz ? t('own_paid_t', { q: '+' + px.kwh + ' ' + SK[k].unit() + ' · ' + money(md.cost(m, px.dz, r.date, sopts(k)).total) + ' грн', d: fmtDate(pf.date) }) : '';
  }
  function erecView(id) {
    var r = mrecs().filter(function (x) { return x.id === id; })[0], back = recBack();
    var m = r && pmeters(null, true).filter(function (x) { return x.id === r.meter; })[0];
    if (!r || !m) return { screen: 'S09', route: 'history', html: back + '<p class="muted">' + esc(t('rec_gone')) + '</p>' };
    var k = m.kind === 'gas' ? 'gas' : 'elec', md = SK[k].mod, u = SK[k].unit();
    var x = md.series(mrecs(m.id), m).filter(function (s0) { return s0.rec.id === id; })[0] || {};
    var h = back + '<h1>' + esc(fmtDate(r.date, true)) + '</h1>' + (r.base ? '<p class="small muted">' + esc(t('eh_base')) + '</p>' : '<p class="small muted">' + esc(t('er_for', { m: monthLabel(md.forMonth(r.date)) })) + '</p>');
    // 1) скільки набігло за місяць, на який зараховується, і скільки це коштувало; 2) фото; 3) показання списком (без табло — власник 10.11)
    var vals = usedVals('erec-values', md.keys(m).map(function (q) { var v = md.whole(r.z[q]); return { n: ename(m), sub: md.zones(m) > 1 ? ezl(m, q) : '', v: v === null ? '—' : v, u: u, copy: v, ck: md.zones(m) > 1 ? 'erec-copy-' + q : 'erec-copy-all' }; }));
    // від останнього «Передано» (власник 11.11): скільки набігло з минулої оплати й скільки це коштує; проміжні — рядком нижче
    var pa = r.base ? null : paidAnchor(mrecs(m.id), r, function () { return true; }, function (y) { return y.base ? baseSent(y) : ssent(k, y); }), px = pa ? md.series([pa.rec, r], m)[1] : null;
    if (px && px.dz) {
      var pc = md.cost(m, px.dz, r.date, sopts(k)), p1 = md.zones(m) === 1, pcur = md.whole(r.z.all), pa0 = md.whole(pa.rec.z && pa.rec.z.all);
      // газ: доставка (розподіл) — за кожен місяць від «Передано» до цього запису (123-я)
      var pfee = k === 'gas' ? sopts(k).fee || 0 : 0, pfn = pfee ? feeMonths(md, pa.date, r.date) : 0;
      h += usedBox({ kind: k, key: 'erec-used', title: t(pa.sent ? 'ru_title_paid' : 'ru_title_h', { d: fmtDate(pa.date) }), per: t('ru_per', { a: fmtDate(pa.date), b: fmtDate(r.date), d: px.days }),
        qs: [{ v: '+' + px.kwh, u: u }], money: pc.total + pfee * pfn, vals: vals,
        lines: (p1 ? [t('ru_calc', { q: px.kwh, u: u, p: money(pc.price), s: money(pc.total) })] : md.keys(m).map(function (q) { return t('ru_zone', { z: ezl(m, q), q: px.dz[q], p: money(pc.price * md.coef(m, q)), s: money(pc.parts[q]) }); }))
          .concat([pfee ? (pfn > 1 ? t('ru_fee_n', { n: pfn, f: money(pfee), s: money(pfee * pfn) }) : t('ru_fee1', { f: money(pfee) })) : '',
            pa.n && x.dz ? t('ru_this', { q: x.kwh, u: u, d: x.days }) + ' · ' + t('paid_skip', { n: pa.n }) : '', p1 && pcur !== null && pa0 !== null ? t('ru_meter', { a: pa0, b: pcur, u: u }) : '']),
        proj: usedProj(px.kwh, px.days, pc.total, u), note: k === 'gas' ? gasNote(pc.price) : '' });
    } else if (x.dz) {
      var ym = md.forMonth(r.date), b = md.monthly(md.series(mrecs(m.id), m), m, sopts(k)).filter(function (b0) { return b0.ym === ym; })[0] || { kwh: x.kwh, dz: x.dz, days: x.days, from: null, to: r.date };
      var c = md.cost(m, b.dz, b.to, sopts(k)), one = md.zones(m) === 1, cur = md.whole(r.z.all), mfee = k === 'gas' ? sopts(k).fee || 0 : 0;
      h += usedBox({ kind: k, key: 'erec-used', title: t('ru_title', { m: monthLabel(ym) }), per: b.from ? t('ru_per', { a: fmtDate(b.from), b: fmtDate(b.to), d: b.days }) : '',
        qs: [{ v: '+' + b.kwh, u: u }], money: c.total + mfee, vals: vals,
        lines: (one ? [t('ru_calc', { q: b.kwh, u: u, p: money(c.price), s: money(c.total) })] : md.keys(m).map(function (q) { return t('ru_zone', { z: ezl(m, q), q: b.dz[q], p: money(c.price * md.coef(m, q)), s: money(c.parts[q]) }); }))
          .concat([mfee ? t('ru_fee1', { f: money(mfee) }) : '', b.kwh !== x.kwh ? t('ru_this', { q: x.kwh, u: u, d: x.days }) : '', one && cur !== null ? t('ru_meter', { a: cur - x.dz.all, b: cur, u: u }) : '', erecPaid(k, m, r)]),
        proj: usedProj(b.kwh, b.days, c.total, u), note: k === 'gas' ? gasNote(c.price) : '' });
    } else if (r.base) h += usedBase('erec-used', vals, k);
    else h += usedOnly(k, 'erec-used', vals);
    h += recPhotos(r.photos, 'm' + r.id, 'm:' + r.id);
    if (r.base) h += ownBox('m', r);
    if (!r.base && !r.own) {
      var w = md.win(today());
      if (w.open && r.date >= w.from && r.date <= w.to) h += whereAcc(ssendPanel(k, smeters(k).map(function (mm) { return mm.id === m.id ? r : einWin(mm.id, w); })), r.id);
      else h += '<p>' + (ssent(k, r) ? '<span class="pill ok">' + ico('check', 14) + ' ' + esc(tk(k, 'ed_org')) + '</span>' : '<span class="pill neutral">' + esc(tk(k, 'ed_org')) + ': ' + esc(t('wh_notsent')) + '</span>') + '</p>';
    }
    h += (r.base ? '' : billsBox('m:' + r.id, r.bills, t('bl_title', { m: monthLabel(md.forMonth(r.date)) })));
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
    // газ: доставка — раз на місяць на квартиру, не на кожен лічильник (123-я)
    var by = {}, md = SK[k].mod, so = sopts(k), fee = so.fee || 0, so0 = Object.assign({}, so, { fee: 0 });
    smeters(k, true).forEach(function (m) { md.monthly(md.series(paidOnly(mrecs(m.id), function (y) { return ssent(k, y); }), m), m, so0).forEach(function (b) {
      var o = by[b.ym] || (by[b.ym] = { ym: b.ym, kwh: 0, cost: fee, fee: fee, days: 0, night: 0, from: b.from, to: b.to });
      o.kwh += b.kwh; o.cost += b.cost; o.days = Math.max(o.days, b.days); o.night += b.dz.night || 0; if (b.from < o.from) o.from = b.from; if (b.to > o.to) o.to = b.to;
    }); });
    return Object.keys(by).sort().map(function (q) { var b = by[q]; b.perMonth = b.days ? b.kwh / b.days * 30 : b.kwh; return b; });
  }
  /** Набігло після останнього «Передано» й ще не передане (останній запис — проміжний чи «для себе»): {q, cost, d} по всіх лічильниках виду або null. */
  function ssince(k) {
    var md = SK[k].mod, q = 0, c = 0, d = null, to = null, sentS = function (y) { return y.base ? baseSent(y) : ssent(k, y); };
    smeters(k).forEach(function (m) {
      var all = mrecs(m.id), last = all[all.length - 1]; if (!last || last.base || (!last.own && ssent(k, last))) return;
      var pa = paidAnchor(all, last, function () { return true; }, sentS), px = pa && pa.sent ? md.series([pa.rec, last], m)[1] : null; if (!px || !px.dz) return;
      q += px.kwh; c += md.cost(m, px.dz, last.date, sopts(k)).total; if (!d || pa.date < d) d = pa.date; if (!to || last.date > to) to = last.date;
    });
    var fee = d && k === 'gas' ? sopts(k).fee || 0 : 0; if (fee) c += fee * feeMonths(md, d, to);   // газ: доставка за місяці від «Передано» (123-я)
    return d ? { q: q, cost: c, d: d } : null;
  }
  function sstats(k) {
    chColors();
    var md = SK[k].mod, u = SK[k].unit(), mo = smonthly(k), sm = md.summary(mo), head = '<h1>' + esc(t('stt_title')) + '</h1>' + kindSwitch();
    if (!mo.length) return { screen: 'S15', route: 'stats', html: head + '<div class="panel"><p class="muted">' + esc(t('est_empty')) + '</p></div>' };
    var per = function (b) { return t('stt_period', { a: R.toHtmDate(b.from), b: R.toHtmDate(b.to), d: b.days }); };
    var two = k === 'elec' && emeters(true).some(function (m) { return El.zones(m) > 1; }), nightKwh = mo.reduce(function (s0, b) { return s0 + b.night; }, 0), allKwh = mo.reduce(function (s0, b) { return s0 + b.kwh; }, 0), since = ssince(k);
    var tiles = kpi({ key: 'estats-kpi', tone: k, q: fmtN(sm.perMonth, 0), unit: u, money: sm.uahMonth, cap: t('kpi_w_avg', { n: sm.months }),
      chips: [chip(tk(k, 'kpi_e_last', { m: monthLabel(sm.last.ym), v: sm.last.kwh, uah: money0(sm.last.cost) }), 'clock')]
        .concat(since ? [chip(t('kpi_since', { d: fmtDate(since.d), v: since.q, u: u, uah: money0(since.cost) }), 'clock')] : [])
        .concat(two && allKwh ? [chip(t('kpi_e_night', { p: Math.round(nightKwh / allKwh * 100) }), 'moon')] : []) });
    var c1 = barChart(mo.map(function (b) { return { x: ymLabel(b.ym), v: b.kwh, top: String(b.kwh), color: k === 'gas' ? CH.gas : CH.elec, tip: [b.kwh + ' ' + u, per(b), '≈ ' + money(b.cost) + ' грн'] }; }), { title: tk(k, 'est_kwh'), dec: 0 });
    var c2 = barChart(mo.map(function (b) { return { x: ymLabel(b.ym), v: Math.round(b.cost), top: String(Math.round(b.cost)), color: CH.barSoft, tip: ['≈ ' + money(b.cost) + ' грн', per(b), b.kwh + ' ' + u] }; }), { title: t('wst_uah'), dec: 0 });
    var table = '<details class="panel wacc tbl-acc" data-key="stt-table"><summary><h2>' + esc(t('stt_table')) + '</h2>' + ico('chev', 20, 'pacc-chev') + '</summary><div class="tbl-wrap where-b"><table class="tbl"><thead><tr><th>' + esc(t('wst_th_month')) + '</th><th>' + esc(t('stt_th_period')) + '</th><th>' + u + '</th><th>грн</th></tr></thead><tbody>' +
      mo.slice().reverse().map(function (b) { return '<tr><td>' + esc(ymLabel(b.ym)) + '</td><td>' + esc(R.toHtmDate(b.from) + ' – ' + R.toHtmDate(b.to)) + '</td><td class="num">' + b.kwh + '</td><td class="num">' + money(b.cost) + '</td></tr>'; }).join('') + '</tbody></table></div></details>';
    var panel = function (title, sub, chart) { return '<section class="panel chart-panel"><h2>' + esc(title) + '</h2><p class="small muted">' + esc(sub) + '</p>' + chart + '</section>'; };
    var price = k === 'gas' ? (sopts('gas').price || Gs.priceAt(today())) : El.priceAt(today()), gfee = k === 'gas' && !!sopts('gas').fee;
    return { screen: 'S15', route: 'stats', html: head + '<p class="muted">' + esc(tk(k, 'est_lead')) + '</p>' + tiles + panel(tk(k, 'est_kwh'), t('est_kwh_sub'), c1) + panel(t('wst_uah'), k === 'gas' ? gasNote(price) : tk(k, 'est_tariff', { p: money(price) }), c2) + table + '<p class="small muted">' + esc(gfee ? t('gst_method_fee') : tk(k, 'est_method')) + '</p>' };
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
  /** «Скасувати й вийти» — кнопка з рамкою на всю ширину під головною (владелец 07.11: сірий текст «не зчитується як кнопка»). */
  function cancelLink(what) { return '<p class="wiz-cancel"><button type="button" class="btn sec block" data-act="wiz-cancel" data-what="' + what + '" data-key="wiz-cancel">' + ico('cross', 18) + '<span>' + esc(t('wz_cancel')) + '</span></button></p>'; }
  function wnFresh(kind) { return { kind: kind || 'hot', date: '', vals: {}, photos: [], src: {}, auto: {}, unused: [], busy: false }; }
  var WN = wnFresh('hot');
  V.wnew = function () {
    var ms = wmeters(); if (!ms.length) return V.wsetup();
    var order = ms.slice().sort(function (a, b) { return (a.kind === WN.kind ? 0 : 1) - (b.kind === WN.kind ? 0 : 1); });
    var date = WN.date || today(), back = WN.back || backTo('water-' + WN.kind);
    var prev = {}; ms.forEach(function (m) { var r = wprevFor(m.id, date); if (r) prev[m.id] = r; });
    var h = '<h1>' + esc(t('wn_title')) + '</h1>' + (WN.autoWhy ? '<div class="banner warn" data-key="wn-auto-why" data-why="' + esc(WN.autoWhy) + '">' + ico('info', 22) + '<div><p><b>' + esc(t('wa_why_t')) + '</b></p><p>' + esc(t('wa_why_' + WN.autoWhy)) + '</p></div></div>' : '') +
      wnPhotoBox() +
      '<div class="field f-date"><label for="wn-date">' + esc(t('wn_date')) + '</label><div class="ctl"><input id="wn-date" type="date" value="' + esc(date) + '" max="' + today() + '"></div></div>' +
      '<form id="wn-form" novalidate><div class="rd-box" data-key="wn-box">' + order.map(function (m) {
        var p = prev[m.id];
        return '<div class="field wfield" id="wf-' + m.id + '"><label for="wn-' + m.id + '">' + ico('drop', 16, m.kind === 'hot' ? 'c-hot' : 'c-cold') + ' ' + esc(wname(m)) + '</label>' +
          '<div class="ctl"><input id="wn-' + m.id + '" class="num" inputmode="decimal" autocomplete="off" data-wn="' + m.id + '" value="' + esc(WN.vals[m.id] || '') + '" placeholder="' + (p ? esc(wfmt(p.vals[m.id])) : '') + '" aria-describedby="wh-' + m.id + '"><span class="unit">м³</span>' +
          wnSrcThumb(m.id) + '</div>' +
          '<div class="help" id="wh-' + m.id + '">' + esc(wnSrcText(m.id)) + (p ? esc(t('wn_prev', { v: Wt.whole(p.vals[m.id]), d: fmtDate(p.date) })) : esc(t('wn_first'))) + '</div></div>';
      }).join('') +
      '<p class="small rd-hint">' + esc(t('wn_digits')) + '</p></div>' +
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
    if (Wt.blocked(iss) && !riskSecond(WN, iss)) { var f = document.querySelector('.wfield.is-block input'); if (f) f.focus(); return; }
    var vals = {}; wmeters().forEach(function (m) { var v = Wt.norm(WN.vals[m.id]); if (v !== null) vals[m.id] = v; });
    wnStore(vals, ownChecked());
  }
  /** Зберегти показання введення води (одна запис на квартиру й дату), фото — до запису, вхідні з бота — розібрані; на сторінку виду. → запис. */
  function wnStore(vals, own) {
    var date = WN.date || today(), now = new Date().toISOString();
    S.water = S.water || [];
    // одна запись на квартиру и дату: повторный ввод в тот же день — правка
    var same = (S.water || []).filter(function (r) { return r && !r.deleted && !r.base && !r.billOnly && r.place === S.placeId && r.date === date; })[0];
    // фото, с которых сняли, — к записи (видны в истории)
    var refs = photoRefs((WN.photos || []).map(function (p) { return { file: p.file, meter: p.meters && p.meters.length === 1 ? p.meters[0] : undefined }; }));
    var rec = same;
    if (same) { same.vals = Object.assign({}, same.vals, vals); if (refs.length) same.photos = (same.photos || []).concat(refs); if (own) same.own = true; same.updatedAt = Date.now(); }
    else S.water.push(rec = Object.assign({ id: Wt.uid(), place: S.placeId, date: date, vals: vals, createdAt: now, updatedAt: Date.now(), sent: {} }, refs.length ? { photos: refs } : {}, own ? { own: true } : {}));
    wbillAdopt(rec); cardSaved('water', rec);   // після «перевірте» з картки в чаті (122-а)
    if (!S.onboarded) S.onboarded = true;
    if (WN.inbox && WN.inbox.length && window.TEPLO_API) { var ib = WN.inbox; INBOX.items = (INBOX.items || []).filter(function (x) { return ib.indexOf(x.id) < 0; }); api0('/inbox/done', { method: 'POST', body: JSON.stringify({ ids: ib }) }).catch(function () {}); }
    var k = WN.kind, back = WN.back; WN = wnFresh(k);
    save(); toast(t('wn_saved') + inPlace());
    if (back) go(back); else { SCROLL_TO = 'wsend-vk'; go('water-' + k); }
    return rec;
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
        if (ak === 'waste') { wasteAdd(); MB_OPEN.waste = true; toast(t('wsp_added')); go('waste'); return true; }
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
    var wtags = function (i) {
      var mine = ms.filter(function (m) { return (ph[i].meters || []).indexOf(m.id) >= 0; });
      return mine.length ? '<span class="wn-tags">' + mine.map(function (m) { return '<i class="' + (m.kind === 'hot' ? 'n-hot' : 'n-cold') + '">' + esc(m.name || t('kv_' + m.kind)) + '</i>'; }).join('') + '</span>' : '';
    };
    h += phCard({ p: 'wn', photos: ph, busy: WN.busy, stage: WN.stage, q: WN.q, pct: WN.pct, prog: WN.prog || t('wn_reading'), stop: 'wn-stop', rm: 'wn-ph-rm', tags: wtags, title: t('phd_add_ocr'), hint: t('wnp_hint'), more: t('wnp_more'), cam: { in: 'wn-files', kind: 'water' } });
    if (WN.err) h += '<p class="help warn">' + esc(WN.err) + '</p>';
    if (ph.length) {
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
  function wnProg(pct, msg, stage, q) {
    WN.pct = Math.max(WN.pct || 2, Math.round(pct)); WN.prog = msg; if (stage) WN.stage = stage; if (q !== undefined) WN.q = q; phdStage('wn', stage, q);
    var pb = document.getElementById('wn-pbar'), el = document.getElementById('wn-prog');
    if (pb) pb.style.width = WN.pct + '%'; if (el) el.textContent = msg;
  }
  /** Распознать новые фото пачки (движок в браузере) и разложить всё по водомерам. */
  function wnRun(files) {
    wnRead(); WN.err = '';
    files.forEach(function (f) { WN.photos.push({ file: f, url: URL.createObjectURL(f), res: null, meters: [] }); });
    var todo = WN.photos.filter(function (p) { return !p.res; }), n = todo.length; if (!n) return;
    var gen = WN.gen = (WN.gen > 0 ? WN.gen : 0) + 1, w = WN, live = function () { return WN === w && WN.gen === gen; };
    WN.busy = true; WN.pct = 2; WN.prog = t('wn_reading'); WN.stage = 'read'; WN.q = 0; render(true);
    // фото не дольше 90 с: зависло — считаем «не прочитано» и идём дальше (кнопка «Зупинити» — сразу)
    var limit = function (pr) { return Promise.race([pr, new Promise(function (ok, bad) { setTimeout(function () { bad(new Error('timeout')); }, 90000); })]); };
    VIS()._engine(function (p) { if (live()) wnProg(p * 15, t('phd_load'), p < 1 ? 'load' : 'read', p); }).then(function () {
      var chain = Promise.resolve();
      todo.forEach(function (p, i) {
        chain = chain.then(function () { if (!live()) return null; wnProg(15 + 85 * (i + 0.3) / n, n > 1 ? t('ph_reading', { i: i + 1, n: n }) : t('wn_reading'), 'read'); return limit(ocrRead(p.file, { all: true })); })
          .then(function (res) { if (res) { p.res = { lines: res.lines, drums: res.drums }; p.ms = res.ms; } }, function () { p.res = { lines: [], drums: [] }; });
      });
      return chain;
    }).then(function () { if (!live()) return; WN.busy = false; wnAssign(); render(true); wnCheck(true); wnReport(); if (CARD.id && WN.inbox && WN.inbox.length) cardWaterSoon(WN, 0); },
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
      WN.src[mid] = { photo: x.photo, value: x.value, frac: x.frac || '', partial: x.partial, half: x.half, pair: x.pair, lead: x.lead, why: x.why, guess: x.guess, sure: !!x.sure };
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
  /** Темна «сцена»: телефон зі спрощеною головною і справжні табло (тепло, вода, світло, газ)
   *  поруч (83-я, unslop: без сяйв, сітки, паралаксу, нахилу й «дихання» — нерухома сцена). Графіка — декор (aria-hidden), зміст — у тексті. */
  function lpTiles() {
    var tile = function (k, html, cap, kp) {
      return '<div class="lp-tile t-' + k + '"><div><figure class="whero-c lp-fig">' + html +
        '<figcaption>' + ico(KINDS[k].icon, 16, KINDS[k].cls) + '<span>' + esc(cap) + '</span></figcaption></figure></div></div>';
    };
    return tile('heat', lcd([{ text: '13.245', tag: 'Gcal' }], 'boot'), t('kd_heat'), -.16) + tile('hot', wdrum('175.921', 'hot'), t('st_water'), -.08) +
      tile('elec', elcd([{ text: '10420' }]), t('kd_elec'), -.22) + tile('gas', wdrum('1225.4', 'gas'), t('kd_gas'), -.12);
  }
  /** Телефон на сцені лендинга (92-а, власник: «місце під ще один лічильник, інтерфейс детальніше й ближче до справжнього»):
   *  справжня головна в мініатюрі — екран 375 px (як у iPhone), зменшений під макет (--k у CSS): статус-бар, шапка «Лічильники · бета»,
   *  «Моя квартира», чотири картки .ucard з тими самими табло (ЖК тепла, ролики води, екран світла, жовта панель газу), круглі «+»
   *  (термінове — темне, як у застосунку), нижня панель шести розділів. Нічого не натискається: div/span замість посилань і кнопок. */
  function lpPhone() {
    var card = function (k, icon, title, disp, st, tone) {
      return '<div class="ucard ucard-' + k + '"><div class="ucard-main"><span class="ucard-top">' + ico(icon, 20, KINDS[k].cls) + '<span class="ucard-title">' + esc(title) + '</span></span>' +
        '<div class="ucard-disp">' + disp + '</div><span class="ucard-status ' + tone + '">' + esc(st) + '</span></div><span class="ucard-add' + (tone === 'warn' ? ' hot' : '') + '">' + ico('plus', 26) + '</span></div>';
    };
    var sb = '<svg class="lpp-sbi" viewBox="0 0 70 14" aria-hidden="true" focusable="false"><g fill="currentColor"><rect x="0" y="9" width="3.4" height="4" rx="1"/><rect x="5" y="6.5" width="3.4" height="6.5" rx="1"/>' +
      '<rect x="10" y="4" width="3.4" height="9" rx="1"/><rect x="15" y="1.5" width="3.4" height="11.5" rx="1"/>' +
      '<path d="M31 13.2l2.6-3a3.6 3.6 0 0 0-5.2 0zM26.6 8.2a6.3 6.3 0 0 1 8.8 0l1.5-1.7a8.6 8.6 0 0 0-11.8 0zM23.8 5a10.3 10.3 0 0 1 14.4 0l1.5-1.7a12.6 12.6 0 0 0-17.4 0z"/>' +
      '<rect x="44.5" y=".8" width="22" height="12" rx="3.6" fill="none" stroke="currentColor" stroke-opacity=".4" stroke-width="1.2"/><rect x="46.6" y="2.9" width="15" height="7.8" rx="2"/><path d="M67.8 4.8v4a2 2 0 0 0 0-4z" opacity=".45"/></g></svg>';
    var tabs = [['home', 'nav_home'], ['history', 'nav_history'], ['chart', 'nav_stats'], ['leaf', 'nav_save'], ['help', 'nav_help'], ['prefs', 'nav_prefs']];
    return '<div class="lp-phone"><div class="lpp-screen"><div class="lpp-vp">' +
      '<div class="lpp-sb"><b>9:41</b><span class="lpp-island"></span>' + sb + '</div>' +
      '<div class="lpp-app"><div class="lpp-bar">' + logo() + '<b>' + esc(t('brand')) + '</b><span class="lpp-beta">' + esc(t('beta_tag')) + '</span></div>' +
      '<div class="lpp-hp">' + ico('home', 24) + '<span><b>' + esc(t('pl_mine')) + '</b><i>' + esc(t('lp_ph_addr')) + '</i></span></div>' +
      '<div class="ucards">' +
      card('heat', 'thermo', t('uc_heat'), lcd([{ text: '13.245', tag: 'Gcal' }], 'card'), t('lp_ph_due'), 'warn') +
      card('hot', 'drop', t('kd_hot'), wdrum('175.921', 'hot', 'card'), t('lp_ph_sent'), 'ok') +
      card('elec', KINDS.elec.icon, t('kd_elec'), elcd([{ text: '10420' }], 'card'), t('lp_ph_soon'), 'due') +
      card('gas', KINDS.gas.icon, t('kd_gas'), wdrum('1225.4', 'gas', 'card'), t('lp_ph_gas'), 'due') + '</div></div>' +
      '<div class="lpp-tab">' + tabs.map(function (n, i) { return '<span' + (i ? '' : ' class="on"') + '>' + ico(n[0], 22) + '<i>' + esc(t(n[1])) + '</i></span>'; }).join('') + '<span class="lpp-hi"></span></div>' +
      '</div></div></div>';
  }
  /** 91-а (власник 10.11): у нижній панелі лендинга — цілі прилади, що плавно перетікають один в один: корпус міняє форму й колір
   *  (теплолічильник → водомір → електролічильник → газовий), труби, кабелі, табло й підпис змінюються разом. SMIL — бо форму (rx, розмір)
   *  CSS у Safari не анімує; «Зменшити рух» і автотести — стоїть теплолічильник (afterRender → pauseAnimations). Малюнок декоративний. */
  function lpMeters() {
    var D = 16, HOLD = 2.9, N = 4, E = '.22 1 .36 1', L = '0 0 1 1';
    var kt = function (s) { return +(s / D).toFixed(4); };
    var anim = function (attr, vals, times, spl) { return '<animate attributeName="' + attr + '" dur="' + D + 's" repeatCount="indefinite" calcMode="spline" keyTimes="' + times.join(';') + '" keySplines="' + spl.join(';') + '" values="' + vals.join(';') + '"/>'; };
    // корпус кожного приладу: x, y, ширина, висота, радіус кута, колір пластику / металу / кільця водоміра
    var B = [[70, 40, 180, 150, 26, '#ECEFEA'], [78, 46, 164, 164, 82, '#3A73B2'], [86, 18, 148, 252, 16, '#E2E6E2'], [62, 74, 196, 176, 14, '#C3C8C3']];
    var morph = function (attr, a) { var v = [], tm = [], sp = []; for (var j = 0; j < N; j++) { v.push(a[j], a[j]); tm.push(kt(4 * j), kt(4 * j + HOLD)); sp.push(L, E); } v.push(a[0]); tm.push(1); return anim(attr, v, tm, sp); };
    // 92-а (власник: «більше деталей і об'єму, світлотінь»): корпус + тінь, блик, фаска — прямокутники з тим самим перетіканням, зсунуті на d
    var shape = function (d, attrs) {
      var g = function (i, dv) { return B.map(function (b) { return Math.max(0, b[i] + dv); }); };
      var X = g(0, d[0]), Y = g(1, d[1]), W = g(2, d[2]), H = g(3, d[3]), R = g(4, d[4]);
      return '<rect x="' + X[0] + '" y="' + Y[0] + '" width="' + W[0] + '" height="' + H[0] + '" rx="' + R[0] + '" ' + attrs + '>' +
        morph('x', X) + morph('y', Y) + morph('width', W) + morph('height', H) + morph('rx', R) + morph('ry', R) + (/fill="#/.test(attrs) ? '' : '') + '</rect>';
    };
    // шар видно в станах vis: старі деталі гаснуть на початку перетікання, нові проявляються в кінці; спільні (труба тепла й води) — лишаються
    var layer = function (vis, html) {
      var v = [], tm = [], sp = [], on = function (j) { return vis.indexOf(j % N) >= 0 ? 1 : 0; };
      for (var j = 0; j < N; j++) { var both = on(j) && on(j + 1) ? 1 : 0; v.push(on(j), on(j), both, both); tm.push(kt(4 * j), kt(4 * j + HOLD), kt(4 * j + HOLD + .35), kt(4 * j + HOLD + .5)); sp.push(L, E, L, E); }
      v.push(on(0)); tm.push(1);
      return '<g opacity="' + on(0) + '">' + anim('opacity', v, tm, sp) + html + '</g>';
    };
    var seg = function (str, x, y, h, fill) {
      var k = h / 40, cx = 0, out = '';
      String(str).split('').forEach(function (ch) {
        if (ch === '.') { out += '<circle cx="' + (cx - 3) + '" cy="36.5" r="2.6"/>'; cx += 4; return; }
        var map = SEG[ch] || '';
        'abcdefg'.split('').forEach(function (q) { out += '<polygon points="' + POLY[q] + '"' + (map.indexOf(q) >= 0 ? '' : ' opacity=".09"') + ' transform="translate(' + cx + ',0)"/>'; });
        cx += 28;
      });
      return '<g fill="' + fill + '" transform="translate(' + x + ',' + y + ') scale(' + k + ') skewX(-6)">' + out + '</g>';
    };
    var r = function (x, y, w, h, rx, a) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"' + (rx ? ' rx="' + rx + '"' : '') + ' ' + a + '/>'; };
    // ролики: рамка вікна, комірки, поверх — барабан (темніє догори й донизу) і відблиск скла
    var drums = function (blk, red, x, y, cw, ch, fs) {
      var n = blk.length + red.length, w = n * cw + (n - 1) + 4, out = r(x - 1.5, y - 1.5, w + 3, ch + 7, 5.5, 'fill="#0B0F0E"') + r(x, y, w, ch + 4, 4, 'fill="#151B19"');
      (blk + red).split('').forEach(function (d, i) {
        var cx = x + 2 + i * (cw + 1), rd = i >= blk.length;
        out += r(cx, y + 2, cw, ch, 1.5, 'fill="' + (rd ? '#B5161F' : '#2C3330') + '"') +
          '<text x="' + (cx + cw / 2) + '" y="' + (y + 2 + ch * .74) + '" text-anchor="middle" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="' + fs + '" font-weight="600" fill="#F4F5F2">' + d + '</text>';
      });
      return out + r(x + 2, y + 2, w - 4, ch, 1.5, 'fill="url(#lpmDrum)"') + r(x + 1, y + 1, w - 2, ch * .42, 3, 'fill="#fff" opacity=".09"') + r(x, y, w, ch + 4, 4, 'fill="none" stroke="url(#lpmInset)" stroke-width="1.6"');
    };
    var txt = function (s, x, y, size, fill, anchor, wt) { return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + fill + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + (wt ? ' font-weight="' + wt + '"' : '') + '>' + esc(s) + '</text>'; };
    // гвинт зі шліцом, гайка з гранями, тінь під дрібною деталлю
    var screw = function (x, y, rr, a) { return '<circle cx="' + (x + .6) + '" cy="' + (y + 1) + '" r="' + (rr + .6) + '" fill="#000" opacity=".22"/><circle cx="' + x + '" cy="' + y + '" r="' + rr + '" fill="url(#lpmScrew)"/>' +
      '<path d="M' + (x - rr * .62 * Math.cos(a)).toFixed(2) + ' ' + (y - rr * .62 * Math.sin(a)).toFixed(2) + 'L' + (x + rr * .62 * Math.cos(a)).toFixed(2) + ' ' + (y + rr * .62 * Math.sin(a)).toFixed(2) + '" stroke="#4E5651" stroke-width="' + (rr * .32).toFixed(2) + '" stroke-linecap="round"/>'; };
    var nut = function (x, y, w, h, grad, dark) { return r(x, y, w, h, 3, 'fill="url(#' + grad + ')" stroke="' + dark + '" stroke-width="1.2"') + r(x + 1, y + 1, w - 2, 2.5, 1, 'fill="#fff" opacity=".35"') + r(x + 1, y + h - 3.5, w - 2, 2.5, 1, 'fill="#000" opacity=".22"'); };
    var lcdGlass = function (clip, x, y, w, h) { return r(x, y, w, h, 0, 'fill="url(#lpmLcdIn)" clip-path="url(#' + clip + ')"') + '<g clip-path="url(#' + clip + ')" fill="#fff"><path d="M' + x + ' ' + y + 'h' + (w * .5) + 'l-' + (w * .3) + ' ' + h + 'H' + x + 'z" opacity=".13"/><path d="M' + (x + w * .62) + ' ' + y + 'h' + (w * .1) + 'l-' + (w * .3) + ' ' + h + 'h-' + (w * .1) + 'z" opacity=".07"/></g>'; };
    var bars = function (x, y, h) { var o = '', cx = x; [1, 2, 1, 1, 3, 1, 2, 1, 1, 2, 3, 1, 1, 2, 1, 1, 3, 1, 2, 1].forEach(function (w, i) { if (i % 2 === 0) o += r(cx, y, w * .7, h, 0, 'fill="#3B4340"'); cx += w * .7 + .7; }); return o; };
    var qr = function (x, y, c) {
      var bits = '1011001110100101101100101011011001010111001011010110', o = r(x - 1.5, y - 1.5, 9 * c + 3, 9 * c + 3, 1, 'fill="#F7F8F6"'), k = 0;
      for (var i = 0; i < 9; i++) for (var j = 0; j < 9; j++) {
        var fnd = (i < 3 && j < 3) || (i < 3 && j > 5) || (i > 5 && j < 3);
        var on = fnd ? !(i % 6 === 1 && j % 6 === 1) || true : bits[k++ % bits.length] === '1';
        if (fnd && ((i % 6 === 1 && j % 6 === 1) === false) && ((i % 6) === 1 || (j % 6) === 1) && !((i % 6 === 1) && (j % 6 === 1))) on = false;
        if (on) o += r(x + j * c, y + i * c, c, c, 0, 'fill="#26302C"');
      }
      return o;
    };
    var defs = '<defs>' +
      '<linearGradient id="lpmShade" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset=".38" stop-color="#fff" stop-opacity="0"/><stop offset=".62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient>' +
      '<radialGradient id="lpmSpec" cx=".26" cy=".14" r=".7"><stop offset="0" stop-color="#fff" stop-opacity=".4"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
      '<linearGradient id="lpmRim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".38"/></linearGradient>' +
      '<linearGradient id="lpmInset" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset=".35" stop-color="#000" stop-opacity="0"/><stop offset=".7" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".5"/></linearGradient>' +
      '<linearGradient id="lpmLcdIn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".26"/><stop offset=".22" stop-color="#000" stop-opacity="0"/><stop offset=".85" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".14"/></linearGradient>' +
      '<linearGradient id="lpmBrass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5E4522"/><stop offset=".12" stop-color="#B8904E"/><stop offset=".3" stop-color="#F2D89C"/><stop offset=".5" stop-color="#C9A15C"/><stop offset=".8" stop-color="#9E7A40"/><stop offset="1" stop-color="#5A4220"/></linearGradient>' +
      '<linearGradient id="lpmNut" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7A5C2E"/><stop offset=".22" stop-color="#8E6C38"/><stop offset=".22" stop-color="#EBCD8F"/><stop offset=".5" stop-color="#CFA862"/><stop offset=".78" stop-color="#A9843F"/><stop offset=".78" stop-color="#6E5229"/><stop offset="1" stop-color="#5E4522"/></linearGradient>' +
      '<linearGradient id="lpmYel" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8C6A0E"/><stop offset=".22" stop-color="#D9AE2E"/><stop offset=".38" stop-color="#FBE39A"/><stop offset=".56" stop-color="#E2B635"/><stop offset=".86" stop-color="#A9820F"/><stop offset="1" stop-color="#7A5C08"/></linearGradient>' +
      '<linearGradient id="lpmYelNut" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8C6A0E"/><stop offset=".22" stop-color="#A57E12"/><stop offset=".22" stop-color="#F6D671"/><stop offset=".5" stop-color="#DDB136"/><stop offset=".78" stop-color="#B98F17"/><stop offset=".78" stop-color="#86650C"/><stop offset="1" stop-color="#6E5208"/></linearGradient>' +
      '<linearGradient id="lpmDrum" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".62"/><stop offset=".3" stop-color="#000" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".12"/><stop offset=".7" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".62"/></linearGradient>' +
      '<radialGradient id="lpmKnob" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".45" stop-color="#E2E6E1"/><stop offset="1" stop-color="#A2AAA4"/></radialGradient>' +
      '<radialGradient id="lpmScrew" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="#F6F7F5"/><stop offset=".55" stop-color="#B7BEB8"/><stop offset="1" stop-color="#737B75"/></radialGradient>' +
      '<radialGradient id="lpmFace" cx=".42" cy=".32" r=".8"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".6" stop-color="#F0F1ED"/><stop offset="1" stop-color="#D3D7D0"/></radialGradient>' +
      '<radialGradient id="lpmLed" cx=".38" cy=".34" r=".7"><stop offset="0" stop-color="#FF9C8C"/><stop offset=".5" stop-color="#D3402F"/><stop offset="1" stop-color="#7E170E"/></radialGradient>' +
      '<linearGradient id="lpmDome" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="lpmPlate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F6D35E"/><stop offset=".55" stop-color="#E3BC3F"/><stop offset="1" stop-color="#C99D22"/></linearGradient>' +
      '<linearGradient id="lpmCover" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E6EAE6"/><stop offset="1" stop-color="#C6CDC8"/></linearGradient>' +
      '<linearGradient id="lpmTag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D1D5CF"/><stop offset="1" stop-color="#B3B9B3"/></linearGradient>' +
      '<filter id="lpmBlur" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="7"/></filter>' +
      '<filter id="lpmBlur2" x="-30%" y="-200%" width="160%" height="500%"><feGaussianBlur stdDeviation="4"/></filter>' +
      '<filter id="lpmSoft" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.4"/></filter>' +
      '<clipPath id="lpmClH"><rect x="97" y="67" width="126" height="50" rx="7"/></clipPath><clipPath id="lpmClE"><rect x="108" y="50" width="104" height="46" rx="6"/></clipPath>' +
      '<clipPath id="lpmClF"><circle cx="160" cy="128" r="68"/></clipPath><clipPath id="lpmClC"><rect x="86" y="18" width="148" height="174" rx="16"/></clipPath>' +
      '</defs>';
    var brassShade = function (x, y, w, h, rx) { return r(x, y, w, h, rx, 'fill="url(#lpmShade)"'); };
    var cable = function (d, col, hi) { return '<path d="' + d + '" fill="none" stroke="#000" stroke-opacity=".25" stroke-width="6" stroke-linecap="round" transform="translate(1 2)" filter="url(#lpmSoft)"/>' +
      '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="5" stroke-linecap="round"/><path d="' + d + '" fill="none" stroke="' + hi + '" stroke-width="1.5" stroke-linecap="round" opacity=".75" transform="translate(-.6 -1.3)"/>'; };
    var back =
      // труба з гайками — під теплолічильником і водоміром: латунний циліндр, торці, грані гайок
      layer([0, 1], r(14, 188, 292, 30, 4, 'fill="url(#lpmBrass)"') + '<ellipse cx="15" cy="203" rx="2.6" ry="14" fill="#6E532B"/><ellipse cx="305" cy="203" rx="2.6" ry="14" fill="#4E3A1C"/>' +
        [70, 74, 78, 242, 246, 250].map(function (x) { return r(x, 189, 1.2, 28, 0, 'fill="#5E4522" opacity=".35"'); }).join('') +
        nut(38, 178, 28, 50, 'lpmNut', '#6E5229') + nut(254, 178, 28, 50, 'lpmNut', '#6E5229')) +
      // тепло: витратомір на трубі (литво, стрілка напрямку) й датчики подачі (червоний) та обратки (синій)
      layer([0], r(116, 182, 88, 42, 7, 'fill="#A6814A"') + brassShade(116, 182, 88, 42, 7) + r(116.5, 182.5, 87, 41, 6.5, 'fill="none" stroke="url(#lpmRim)" stroke-width="1.2"') +
        '<path d="M140 213h40m-6-4l6 4-6 4" fill="none" stroke="#E2C389" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 1)"/><path d="M140 213h40m-6-4l6 4-6 4" fill="none" stroke="#5E4522" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        cable('M72 140C40 140 24 152 24 168', '#C2462A', '#F08A6C') + cable('M248 140C280 140 296 152 296 168', '#3A72B5', '#8FB8EC') +
        r(20, 158, 8, 4, 1, 'fill="#8E2A16"') + r(292, 158, 8, 4, 1, 'fill="#1F4A80"') +
        nut(16, 168, 16, 22, 'lpmNut', '#6E5229') + '<circle cx="24" cy="169" r="5" fill="#3B4340"/><circle cx="22.8" cy="167.6" r="1.6" fill="#fff" opacity=".35"/>' +
        nut(288, 168, 16, 22, 'lpmNut', '#6E5229') + '<circle cx="296" cy="169" r="5" fill="#3B4340"/><circle cx="294.8" cy="167.6" r="1.6" fill="#fff" opacity=".35"/>') +
      // вода: латунний корпус під кільцем
      layer([1], r(100, 176, 120, 48, 8, 'fill="#B08A4D"') + brassShade(100, 176, 120, 48, 8) + r(100.5, 176.5, 119, 47, 7.5, 'fill="none" stroke="url(#lpmRim)" stroke-width="1.2"') +
        '<path d="M144 217h32m-5-3.5l5 3.5-5 3.5" fill="none" stroke="#5E4522" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>') +
      // світло: вушко кріплення згори, дроти знизу
      layer([2], r(146, 4, 28, 22, 6, 'fill="#D5DAD5"') + r(146, 4, 28, 22, 6, 'fill="url(#lpmShade)"') + '<circle cx="160" cy="12" r="3.6" fill="#2B3330"/><circle cx="160" cy="12.8" r="3.6" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width=".8"/>' +
        [[128, '#5B4636', '#9C8270'], [160, '#2E5E9E', '#7FA6DA'], [192, '#5B4636', '#9C8270']].map(function (w) { return cable('M' + w[0] + ' 262V290', w[1], w[2]); }).join('')) +
      // газ: жовті труби згори з гайками
      layer([3], r(92, 0, 20, 84, 0, 'fill="url(#lpmYel)"') + r(208, 0, 20, 84, 0, 'fill="url(#lpmYel)"') +
        [30, 34, 38].map(function (y) { return r(92, y, 20, 1.2, 0, 'fill="#6E5208" opacity=".35"') + r(208, y, 20, 1.2, 0, 'fill="#6E5208" opacity=".35"'); }).join('') +
        nut(86, 52, 32, 26, 'lpmYelNut', '#7A5C08') + nut(202, 52, 32, 26, 'lpmYelNut', '#7A5C08'));
    var shell = shape([5, 11, 0, 0, 0], 'fill="#000" opacity=".5" filter="url(#lpmBlur)"') +
      '<rect x="' + B[0][0] + '" y="' + B[0][1] + '" width="' + B[0][2] + '" height="' + B[0][3] + '" rx="' + B[0][4] + '" fill="' + B[0][5] + '" stroke="#0E1412" stroke-opacity=".3" stroke-width="1.5">' +
        morph('x', B.map(function (b) { return b[0]; })) + morph('y', B.map(function (b) { return b[1]; })) + morph('width', B.map(function (b) { return b[2]; })) + morph('height', B.map(function (b) { return b[3]; })) +
        morph('rx', B.map(function (b) { return b[4]; })) + morph('ry', B.map(function (b) { return b[4]; })) + morph('fill', B.map(function (b) { return b[5]; })) + '</rect>' +
      shape([0, 0, 0, 0, 0], 'fill="url(#lpmShade)"') + shape([0, 0, 0, 0, 0], 'fill="url(#lpmSpec)"') + shape([1.6, 1.6, -3.2, -3.2, -1.6], 'fill="none" stroke="url(#lpmRim)" stroke-width="2"');
    var dial = function (c) {
      var a = c[2] * Math.PI / 180, s = Math.sin(a), co = Math.cos(a), tip = [c[0] + 6.4 * s, c[1] - 6.4 * co], bl = [c[0] - 1.7 * co - 1.6 * s, c[1] - 1.7 * s + 1.6 * co], br = [c[0] + 1.7 * co - 1.6 * s, c[1] + 1.7 * s + 1.6 * co];
      return '<circle cx="' + (c[0] + .7) + '" cy="' + (c[1] + 1.3) + '" r="8.6" fill="#000" opacity=".16"/><circle cx="' + c[0] + '" cy="' + c[1] + '" r="8" fill="url(#lpmFace)" stroke="#BFC5BE" stroke-width="1.2"/>' +
        '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="8" fill="none" stroke="url(#lpmInset)" stroke-width="1.2"/>' +
        '<path d="M' + tip.map(function (v) { return v.toFixed(2); }).join(' ') + 'L' + bl.map(function (v) { return v.toFixed(2); }).join(' ') + 'L' + br.map(function (v) { return v.toFixed(2); }).join(' ') + 'z" fill="#C21F26"/>' +
        '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="1.7" fill="#7E170E"/>';
    };
    var star = function (x, y) { var p = []; for (var i = 0; i < 12; i++) { var a = i * Math.PI / 6, rr = i % 2 ? 2.6 : 6.6; p.push((x + rr * Math.sin(a)).toFixed(2) + ',' + (y - rr * Math.cos(a)).toFixed(2)); } return '<polygon points="' + p.join(' ') + '" fill="#26302C"/><circle cx="' + x + '" cy="' + y + '" r="1.4" fill="#F3F4F0"/>'; };
    var knurl = ''; for (var q = 0; q < 60; q++) { var qa = q * Math.PI / 30; knurl += 'M' + (160 + 74 * Math.cos(qa)).toFixed(1) + ' ' + (128 + 74 * Math.sin(qa)).toFixed(1) + 'L' + (160 + 79.5 * Math.cos(qa)).toFixed(1) + ' ' + (128 + 79.5 * Math.sin(qa)).toFixed(1); }
    var front =
      layer([0], r(88, 58, 144, 68, 13, 'fill="#000" opacity=".16" filter="url(#lpmSoft)" transform="translate(0 1.5)"') + r(90, 60, 140, 64, 12, 'fill="#26302C"') + r(90.6, 60.6, 138.8, 62.8, 11.4, 'fill="none" stroke="url(#lpmRim)" stroke-width="1.2" opacity=".6"') +
        r(97, 67, 126, 50, 7, 'fill="#B5C3A2"') + seg('13.245', 104, 74, 26, '#1F2A22') + txt('Gcal', 216, 112, 10, '#2E3A31', 'end') +
        r(101, 70.5, 9, 4.5, 1, 'fill="none" stroke="#1F2A22" stroke-width=".9" opacity=".75"') + r(102.2, 71.7, 5, 2.1, 0, 'fill="#1F2A22" opacity=".75"') + r(110, 71.6, 1, 2.3, 0, 'fill="#1F2A22" opacity=".75"') +
        lcdGlass('lpmClH', 97, 67, 126, 50) +
        '<circle cx="160.8" cy="153.6" r="15" fill="#000" opacity=".14" filter="url(#lpmSoft)"/><circle cx="160" cy="152" r="14" fill="#CDD3CC"/><circle cx="160" cy="152" r="12" fill="url(#lpmKnob)"/><path d="M157.5 148.5l5 3.5-5 3.5z" fill="#7C857F"/>' +
        txt('Qp 1,5 m³/h', 86, 148, 7, '#6E7872') + txt('PN16  DN15', 86, 158, 7, '#6E7872') + txt('№ 21047093', 234, 148, 7, '#6E7872', 'end') + bars(197, 151.5, 7) +
        screw(84, 176, 3.6, .7) + screw(236, 176, 3.6, -.4) + r(64, 134, 9, 12, 2.5, 'fill="#3B4340"') + r(247, 134, 9, 12, 2.5, 'fill="#3B4340"') +
        '<path d="M236 176c7 4 9 9 10 16" fill="none" stroke="#8A918C" stroke-width="1"/><circle cx="246.5" cy="195" r="4.2" fill="url(#lpmScrew)"/>') +
      layer([1], '<path d="' + knurl + '" stroke="#fff" stroke-opacity=".22" stroke-width="1.1"/>' + '<circle cx="160" cy="128" r="69.5" fill="#1D3E66" opacity=".55"/>' +
        '<circle cx="160" cy="128" r="68" fill="url(#lpmFace)"/><circle cx="160" cy="128" r="66.6" fill="none" stroke="url(#lpmInset)" stroke-width="3"/><circle cx="160" cy="128" r="61" fill="none" stroke="#DADDD7" stroke-width="1.2"/>' +
        txt('Q3 2,5 m³/h', 160, 90, 7, '#6E7872', 'middle') + drums('00437', '921', 106, 100, 12, 22, 15) + txt('m³', 160, 144, 11, '#5A625E', 'middle') +
        txt('R160', 122, 148, 6.5, '#8A938D', 'middle') + txt('C', 198, 148, 7, '#8A938D', 'middle', 600) +
        [[124, 163, 40], [145, 172, 160], [175, 172, 250], [196, 163, 310]].map(dial).join('') + star(160, 188) +
        '<g clip-path="url(#lpmClF)"><ellipse cx="128" cy="84" rx="74" ry="32" transform="rotate(-28 128 84)" fill="url(#lpmDome)" opacity=".7"/>' +
        '<path d="M206 166a64 64 0 0 1-30 25" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2.4" stroke-linecap="round"/></g>' +
        '<ellipse cx="121" cy="80" rx="11" ry="4.6" transform="rotate(-38 121 80)" fill="#fff" opacity=".6"/>') +
      layer([2], '<g clip-path="url(#lpmClC)"><path d="M86 18h70L86 132z" fill="#fff" opacity=".12"/><path d="M178 18h14L100 190H86z" fill="#fff" opacity=".07"/></g>' +
        r(100, 42, 120, 62, 11, 'fill="#000" opacity=".14" filter="url(#lpmSoft)" transform="translate(0 1.5)"') + r(102, 44, 116, 58, 10, 'fill="#26302C"') + r(102.6, 44.6, 114.8, 56.8, 9.4, 'fill="none" stroke="url(#lpmRim)" stroke-width="1.2" opacity=".6"') +
        r(108, 50, 104, 46, 6, 'fill="#C2CEBF"') + seg('10420', 113, 56, 24, '#1F2A22') + txt('kWh', 206, 91, 10, '#2E3A31', 'end') + txt('T1', 113, 91, 8, '#2E3A31', '', 600) + lcdGlass('lpmClE', 108, 50, 104, 46) +
        '<circle cx="118" cy="124" r="5.6" fill="#8C9590"/><circle cx="118" cy="124" r="5" fill="url(#lpmLed)"><animate attributeName="opacity" values="1;.25;1" dur="1.6s" repeatCount="indefinite"/></circle><circle cx="116.6" cy="122.5" r="1.3" fill="#fff" opacity=".8"/>' +
        txt('imp', 128, 128, 10, '#66706B') + r(176.6, 118.4, 30, 14, 7, 'fill="#000" opacity=".18" filter="url(#lpmSoft)"') + r(176, 117, 30, 14, 7, 'fill="url(#lpmKnob)" stroke="#AEB6B0"') +
        txt('220 V  50 Hz', 104, 152, 7.5, '#59625D') + txt('5(60) A   кл. 1', 104, 163, 7.5, '#59625D') + txt('1000 imp/kWh', 104, 174, 7.5, '#59625D') + qr(192, 147, 2.4) +
        r(86, 190.5, 148, 1.6, 0, 'fill="#8E978F"') + r(86, 192.4, 148, 1, 0, 'fill="#fff" opacity=".7"') +
        r(95, 203, 130, 58, 10, 'fill="#000" opacity=".18" filter="url(#lpmSoft)" transform="translate(1 2)"') + r(96, 202, 128, 56, 10, 'fill="url(#lpmCover)" stroke="#AEB6B0" stroke-width="1.2"') + r(97, 203, 126, 54, 9, 'fill="none" stroke="url(#lpmRim)" stroke-width="1.4"') +
        screw(112, 230, 5, .8) + screw(208, 230, 5, -.5) + '<path d="M112 230C126 251 194 251 208 230" fill="none" stroke="#7F8781" stroke-width="1"/><circle cx="160.6" cy="247" r="5.4" fill="#000" opacity=".2"/><circle cx="160" cy="246" r="5" fill="url(#lpmScrew)"/>' +
        '<path d="M157.5 246h5" stroke="#6E7670" stroke-width=".9"/>') +
      layer([3], r(74, 86, 172, 14, 7, 'fill="#ADB3AD"') + r(74, 86, 172, 14, 7, 'fill="none" stroke="url(#lpmInset)" stroke-width="1.4"') +
        '<path d="M142 94h36m-7-5l7 5-7 5" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M142 93h36m-7-5l7 5-7 5" fill="none" stroke="#6F766F" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        r(80, 111, 160, 66, 9, 'fill="#000" opacity=".2" filter="url(#lpmSoft)" transform="translate(1 2)"') + r(82, 112, 156, 62, 8, 'fill="url(#lpmPlate)" stroke="#B88F1C" stroke-width="2"') + r(83.5, 113.5, 153, 59, 7, 'fill="none" stroke="url(#lpmRim)" stroke-width="1.4"') +
        drums('07633', '512', 92, 124, 15, 26, 17) + txt('m³', 160, 168, 11, '#2E2508', 'middle') + screw(89, 167, 2.4, .5) + screw(231, 167, 2.4, -.6) +
        r(62, 178, 196, 7, 0, 'fill="#A9AFA9"') + r(62, 178, 196, 1.4, 0, 'fill="#fff" opacity=".55"') + r(62, 185, 196, 1.4, 0, 'fill="#000" opacity=".22"') +
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(function (i) { return '<circle cx="' + (70 + i * 12.9).toFixed(1) + '" cy="181.5" r="1.3" fill="#80877F"/>'; }).join('') +
        r(96, 192, 128, 46, 6, 'fill="url(#lpmTag)"') + r(96, 192, 128, 46, 6, 'fill="none" stroke="url(#lpmInset)" stroke-width="1.4"') +
        txt('G4', 106, 220, 16, '#3B4340', '', 700) + txt('Qmax 6 m³/h', 138, 207, 7, '#4E5651') + txt('Pmax 50 kPa', 138, 217, 7, '#4E5651') + txt('V 1,2 dm³', 138, 227, 7, '#4E5651') +
        screw(101, 197, 1.8, 0) + screw(219, 197, 1.8, 0) + screw(101, 233, 1.8, 0) + screw(219, 233, 1.8, 0)) +
      ['lp_m_heat', 'lp_m_water', 'lp_m_elec', 'lp_m_gas'].map(function (k, j) { return layer([j], txt(t(k), 160, 318, 20, 'rgba(243, 248, 245, .82)', 'middle')); }).join('');
    return '<div class="lpe-art" aria-hidden="true"><svg class="lpm" viewBox="0 0 320 328" focusable="false" font-family="IBM Plex Sans, system-ui, sans-serif">' + defs +
      '<ellipse cx="160" cy="240" rx="136" ry="9" fill="#000" opacity=".42" filter="url(#lpmBlur2)">' + morph('cy', [240, 240, 286, 266]) + morph('rx', [136, 136, 84, 110]) + '</ellipse>' + back + shell + front + '</svg></div>';
  }
  /** Лицьова панель приладу (89-а): чотири гвинти по кутах — декор, читачам екрана не видно. */
  function lpScrews() { return '<span class="lp-screw s1" aria-hidden="true"></span><span class="lp-screw s2" aria-hidden="true"></span><span class="lp-screw s3" aria-hidden="true"></span><span class="lp-screw s4" aria-hidden="true"></span>'; }
  function lpHero(o) {
    return '<section class="lp-hero lp-plate" data-key="lp-hero">' + lpScrews() + '<div class="lp-in"><div class="lp-copy">' +
      (o.badge ? '<p class="lp-badge">' + esc(o.badge) + '</p>' : '') +
      '<h1 class="lp-h1">' + o.h1 + '</h1><p class="lp-lead">' + esc(o.lead) + '</p><div class="lp-ctas">' + o.cta + '</div>' + (o.after || '') + '</div>' +
      // сцену принимают за кнопку (журнал 06.11: 5 нажатий подряд) — ведёт туда же, куда «Почати»; с клавиатуры — только сама кнопка
      '<a class="lp-stage" href="#start" tabindex="-1" aria-hidden="true" data-key="welcome-hero">' + lpPhone() + lpTiles() + '</a></div></section>';
  }
  /** Футер лендинга: о сервисе, документы (политика, соглашение), связь; «независимый сервис». */
  function lpFoot(login) {
    var col = function (h, items) { return '<div class="lpf-col"><h3>' + esc(h) + '</h3><ul>' + items.join('') + '</ul></div>'; };
    var a = function (href, txt, key) { return '<li><a href="' + href + '" data-key="' + key + '">' + esc(txt) + '</a></li>'; };
    var bot = (Y()._cfg && Y()._cfg.botUsername) || '';
    return '<footer class="lp-foot" data-key="lp-foot"><div class="lpf-in">' +
      '<div class="lpf-brand"><div class="lpf-logo">' + logo() + '<b>' + esc(t('brand')) + '</b></div><p>' + esc(t('lf_about')) + '</p></div>' +
      col(t('lf_service'), [a('#start', t('lp_cta'), 'lpf-start')].concat(login ? [a('#login', t('lf_login'), 'lpf-login')] : []).concat([a('#help', t('nav_help'), 'lpf-help')])) +
      col(t('lf_docs'), [a('#privacy', t('lg_privacy'), 'lpf-privacy'), a('#terms', t('lg_terms'), 'lpf-terms')].concat(window.TEPLO_API ? ['<li><button type="button" class="linkbtn" data-act="cc-open" data-key="lpf-cookie">' + esc(t('cc_link')) + '</button></li>'] : [])) +
      col(t('lf_contact'), ['<li><button class="linkbtn" data-act="fb-open" data-key="lpf-fb">' + esc(t('lf_write')) + '</button></li>'].concat(bot ? ['<li><a href="https://t.me/' + esc(bot) + '" target="_blank" rel="noopener" data-key="lpf-bot">' + esc(t('lf_bot')) + '</a></li>'] : [])) +
      '</div><div class="lpf-bot"><span>© ' + new Date().getFullYear() + ' ' + esc(t('brand')) + '</span><span>' + esc(t('lf_indep')) + '</span></div></footer>';
  }
  /** Подвал застосунку — лише на комп'ютері (≥ 960), притиснутий до низу сторінки (рядок сітки .app після main; коротка сторінка — внизу вікна).
   *  91-а (власник): посилання — тільки «Політика конфіденційності», «Умови використання» й «Налаштування cookie»;
   *  92-а (власник): під ними — рік і «Незалежний сервіс — не є офіційним…», як на лендингу. */
  function appFoot() {
    return '<footer class="app-foot" data-key="app-foot"><a href="#privacy" data-key="lpf-privacy">' + esc(t('lg_privacy')) + '</a><a href="#terms" data-key="lpf-terms">' + esc(t('lg_terms')) + '</a>' +
      (window.TEPLO_API ? '<button type="button" class="linkbtn" data-act="cc-open" data-key="lpf-cookie">' + esc(t('cc_link')) + '</button>' : '') +
      '<p class="af-note" data-key="app-foot-note"><span>© ' + new Date().getFullYear() + ' ' + esc(t('brand')) + '</span><span>' + esc(t('lf_indep')) + '</span></p></footer>';
  }
  function lpCta(key, label) { return '<a class="lp-btn" href="#start" data-key="' + key + '"><span>' + esc(label) + '</span></a>'; }
  /** Картинки лендинга приймають за кнопки (журнал 11.11, 111-а: «Нагадування в Telegram» — 6 натискань, з них 4 повтори; стрічка постачальників — 5, 4 повтори) —
   *  уся картка веде туди ж, куди «Почати»; «Нагадування в Telegram» — у бота (у самому Telegram — «Почати»). З клавіатури й читачам екрана — лише справжні кнопки. */
  function lpGo(key) {
    var tw = window.Telegram && window.Telegram.WebApp, bot = key === 'tg' && !(tw && tw.initData);
    return '<a class="lp-go" href="' + (bot ? 'https://t.me/' + esc(ourBot()) + '?start=remind" target="_blank" rel="noopener' : '#start') + '" tabindex="-1" aria-hidden="true" data-key="lp-' + key + '-go"></a>';
  }
  /** «Куди передати»: основні постачальники всіх областей довідника — дві стрічки, пливуть справа наліво (владелец 10.11);
   *  друга копія кожного ряду — для безшовного кола, читачам екрана — один список; prefers-reduced-motion — стоять. */
  var LP_ORGS = [
    [['heat', 'ХТМ'], ['cold', 'Київводоканал'], ['elec', 'YASNO'], ['gas', 'Газмережі'], ['heat', 'Львівтеплоенерго'], ['cold', 'Інфоксводоканал'],
      ['elec', 'Харківенергозбут'], ['gas', 'Київгаз'], ['heat', 'Теплопостачання міста Одеси'], ['elec', 'Львівобленерго'], ['gas', 'Нафтогаз']],
    [['cold', 'Харківводоканал'], ['heat', 'Київтеплоенерго'], ['elec', 'ДТЕК Київські електромережі'], ['gas', 'Одесагаз'], ['cold', 'Львівводоканал'],
      ['elec', 'Харківобленерго'], ['heat', 'Броваритепловодоенергія'], ['elec', 'ДТЕК Одеські електромережі'], ['cold', 'Білоцерківвода'], ['elec', 'Львівенергозбут']]
  ];
  function lpDest() {
    var chip = function (d) { return '<li>' + ico(KINDS[d[0]].icon, 16, KINDS[d[0]].cls) + '<span>' + esc(d[1]) + '</span></li>'; };
    return '<section class="lp-sec lp-dest" data-key="lp-dest"><p class="lp-dest-t">' + esc(t('lp_dest_t')) + '</p><div class="lp-marq" data-key="lp-marq">' +
      LP_ORGS.map(function (row, i) { var li = row.map(chip).join(''); return '<div class="lpm-row' + (i ? ' r2' : '') + '"><ul class="lp-chips lpm-track">' + li + '</ul><ul class="lp-chips lpm-track" aria-hidden="true">' + li + '</ul></div>'; }).join('') +
      '</div>' + lpGo('dest') + '</section>';
  }
  /** «Ціни саме вашої громади» (власник 10.11): скільки громад у довіднику по областях і в скількох знайдено ціну води; як підтягуються постачальники й ціни громади —
   *  з рішень рад і виконкомів, постанов НКРЕКП і сайтів постачальників, з датою й джерелом; немає документа — «впишіть з платіжки». Числа — під час збирання (web/build.py). */
  var LP_PROV = null/*LP_PROV*/;
  var LP_PHOTO = ''/*LP_PHOTO*/;
  function lpPrices() {
    var regs = (LP_PROV || []).filter(function (x) { return x && x.h > 1; }), all = (LP_PROV || []).reduce(function (a, x) { return a + (x.h || 0); }, 0);
    return '<div class="lp-prv" aria-hidden="true">' + regs.map(function (x) { return '<span class="lpv-r"><i>' + esc(t('lp_pr_o_' + x.r)) + '</i><b>' + x.h + '</b></span>'; }).join('') +
      (all ? '<span class="lpv-tot">' + esc(t('lp_pr_tot', { h: all })) + '</span>' : '') + '</div>';
  }
  function lpSteps() {
    var arts = [
      // 92-а (власник): справжнє фото табло з сервера → лінія сканує → рамка навколо цифр і «17,913 Gcal» → шторка зліва направо
      // перетворює фото на табло з тими самими цифрами → пауза → знову фото (CSS lpPh*, 9 с; «Зменшити рух» — фото з рамкою й підписом)
      '<div class="lp-art art-photo"><div class="aph"><img class="aph-img" src="' + LP_PHOTO + '" alt="" width="720" height="411" decoding="async">' +
        '<span class="aph-box b1"></span><span class="aph-box b2"></span><span class="aph-chip">17,913 Gcal</span><span class="scan"></span>' +
        '<div class="aph-lcd">' + lcd([{ text: '17.913', tag: 'Gcal' }]) + '</div><span class="aph-cap">Heat meter</span><span class="aph-wipe"></span></div>' +
        '<span class="vf tl"></span><span class="vf tr"></span><span class="vf bl"></span><span class="vf br"></span></div>',
      '<div class="lp-art art-check"><div class="lpa-field"><span class="lpa-v">13,245</span><span class="lpa-u">Гкал</span><span class="lpa-ok-i">' + ico('check', 18) + '</span></div>' +
        '<p class="lpa-l ok">' + ico('check', 16) + '<span>' + esc(t('lp_s2_ok')) + '</span></p><p class="lpa-l warn">' + ico('alert', 16) + '<span>' + esc(t('lp_s2_warn')) + '</span></p></div>',
      '<div class="lp-art art-send"><div class="lpa-dest">' + ico('send', 18) + '<span><b>' + esc(t('lp_s3_dest')) + '</b><i>' + esc(t('lp_s3_sub')) + '</i></span>' + ico('ext', 16) + '</div>' +
        '<div class="lpa-chip">' + ico('copy', 14) + '<span>' + esc(t('lp_s3_copied')) + '</span></div><div class="lpa-chip ok">' + ico('check', 14) + '<span>' + esc(t('lp_s3_done')) + '</span></div></div>'
    ];
    return '<section class="lp-sec" data-key="lp-steps"><h2 class="lp-h2">' + esc(t('lp_steps_t')) + '</h2><ol class="lp-steps">' + [1, 2, 3].map(function (n) {
      return '<li class="lp-step" data-key="lp-step-' + n + '"><div class="lp-art-w" aria-hidden="true">' + arts[n - 1] + '</div><div class="lp-step-tx"><span class="lp-num" aria-hidden="true">' + n + '</span>' +
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
  /** «Передати у фоні — одним дотиком» (власник 11.11, 106-а): у кого з постачальників уже працює «Відправити у фоні» — ще одна клітинка «Що ще вміють»,
   *  не окремий блок. Стрічка тиха (одна, повільна, як «Куди передати»); показуємо лише тих, кого сервер зараз підтримує (/api/config → auto:
   *  кабінет ХТМ, Харківводоканал, готові боти LocalBot; e-mail-боти — коли налаштована пошта). Без сервера — усі, крім e-mail.
   *  [вид, постачальник, місто uk, місто ru, id, e-mail?]. Новий бот у LocalBot::BOTS — додати сюди (тест server.php звіряє). */
  var LP_AUTO = [
    ['heat', 'Харківські теплові мережі', 'Харків', 'Харьков', 'htm'], ['cold', 'Харківводоканал', 'Харків', 'Харьков', 'vk'],
    ['cold', 'Броваритепловодоенергія', 'Бровари', 'Бровары', 'brovk'], ['cold', 'Бориспільводоканал', 'Бориспіль', 'Борисполь', 'abinf'],
    ['cold', 'Бучасервіс', 'Буча', 'Буча', 'bucha'], ['cold', 'ККП Василькова', 'Васильків', 'Васильков', 'vkkp'],
    ['cold', 'Вишнівськводоканал', 'Вишневе', 'Вишнёвое', 'umg'], ['cold', 'Міськводоканал', 'Березань', 'Березань', 'brz'],
    ['cold', 'Дрогобичводоканал', 'Дрогобич', 'Дрогобыч', 'dvk'], ['cold', 'Трускавецький водоканал', 'Трускавець', 'Трускавец', 'tvk'],
    ['cold', 'ПЖКГ Моршина', 'Моршин', 'Моршин', 'abinf'],
    ['cold', 'Фастівводоканал', 'Фастів', 'Фастов', 'fvk'], ['cold', 'Вишгородський водоканал', 'Вишгород', 'Вышгород', 'vyvk'],
    ['cold', 'Славутич-Водоканал', 'Славутич', 'Славутич', 'svod'], ['cold', 'Золочівводоканал', 'Золочів', 'Золочев', 'zvk'],
    ['cold', 'Подільськводоканал', 'Подільськ', 'Подольск', 'podv'], ['cold', 'Богодухіввода', 'Богодухів', 'Богодухов', 'bgdv'],
    ['cold', 'Сахновщинське КВКП', 'Сахновщина', 'Сахновщина', 'sahv'], ['cold', 'КП «Міжлиманське»', 'Усатове', 'Усатово', 'mizh'],
    ['cold', 'ЖКК «Вороньків»', 'Вороньків', 'Вороньков', 'vork'], ['cold', 'Богуславське ЖКП', 'Богуслав', 'Богуслав', 'bgsv'],
    ['cold', 'Петрівський ККП', 'Нові Петрівці', 'Новые Петровцы', 'ptkp'], ['cold', 'Ренійський водоканал', 'Рені', 'Рени', 'renv'],
    ['cold', 'Ставищенське ЖКП', 'Ставище', 'Ставище', 'stav'], ['cold', 'Яготинський водоканал', 'Яготин', 'Яготин', 'yagv'],
    ['cold', 'Дачненський сількомунгосп', 'Дачне', 'Дачное', 'dach'], ['cold', 'Джерело-Комунсервіс', 'Любашівка', 'Любашёвка', 'lubk'],
    ['cold', 'Водоканал Мерефи', 'Мерефа', 'Мерефа', 'mvk', 1],
    ['elec', 'Львівобленерго', 'Львівщина', 'Львовщина', 'loe', 1], ['cold', 'Львівводоканал', 'Львів', 'Львов', 'lvk', 1],
    ['cold', 'Чорноморськводоканал', 'Чорноморськ', 'Черноморск', 'cvk', 1], ['cold', 'Стрийводоканал', 'Стрий', 'Стрый', 'svk', 1],
    ['cold', 'Ірпіньводоканал', 'Ірпінь', 'Ирпень', 'ivk', 1],
    ['cold', 'Міськтепловоденергія', 'Кам’янець-Подільський', 'Каменец-Подольский', 'mtve']
  ];
  function lpAutoList() {
    var on = Y()._cfg && Y()._cfg.auto;
    return LP_AUTO.filter(function (x) { return on ? on.indexOf(x[4]) >= 0 : !x[5] && x[4] !== 'mtve'; });
  }
  function lpAuto() {
    var list = lpAutoList(), ru = S.lang === 'ru';
    var chip = function (d) { return '<li>' + ico(KINDS[d[0]].icon, 16, KINDS[d[0]].cls) + '<span>' + esc(d[1]) + '</span><i>' + esc(ru ? d[3] : d[2]) + '</i></li>'; };
    var li = list.map(chip).join('');
    // справжній вигляд «Куди передати» в застосунку: постачальник, строк, виділена «Відправити у фоні», що саме піде, і відповідь сайту постачальника
    var demo = '<div class="lpb-demo" aria-hidden="true"><div class="lpb-h">' + ico('drop', 18, KINDS.cold.cls) + '<span><b>' + esc(t('lp_d_vk')) + '</b><i>' + esc(t('lp_bg_due')) + '</i></span></div>' +
      '<div class="lpb-btn">' + ico('send', 18) + '<span>' + esc(t('cab_bg')) + '</span></div>' +
      '<p class="lpb-note">' + esc(t('cab_bg_note', { what: t('lp_bg_what', { d: fmtDate(today()) }) })) + '</p>' +
      '<div class="lpa-chip ok">' + ico('check', 14) + '<span>' + esc(t('lb_ok')) + '</span></div></div>';
    return '<article class="lp-cell c-bg" data-key="lp-bg"><div class="lp-cell-tx"><h3>' + esc(t('lp_bg_t')) + '</h3><p>' + esc(t('lp_bg')) + '</p></div>' + demo +
      (list.length ? '<div class="lpb-list"><p class="lpb-on">' + esc(t('lp_bg_on', { n: list.length })) + '</p>' +
        '<div class="lpb-marq" data-key="lp-bg-marq"><div class="lpm-row"><ul class="lp-chips lpm-track lpb-chips">' + li + '</ul><ul class="lp-chips lpm-track lpb-chips" aria-hidden="true">' + li + '</ul></div></div>' +
        '<p class="lpb-rest">' + esc(t('lp_bg_rest')) + '</p></div>' : '') + lpGo('bg') + '</article>';
  }
  function lpBento() {
    var cell = function (key, art) { return '<article class="lp-cell c-' + key + '" data-key="lp-' + key + '"><div class="lp-cell-tx"><h3>' + esc(t('lp_' + key + '_t')) + '</h3><p>' + esc(t('lp_' + key)) + '</p></div>' + art + lpGo(key) + '</article>'; };
    return '<section class="lp-sec" data-key="lp-bento"><h2 class="lp-h2">' + esc(t('lp_bento_t')) + '</h2><div class="lp-bento' + (GPV_ON ? ' with-gpv' : '') + '">' +
      cell('due', lpDue()) + cell('tg', lpTg()) + cell('pl', lpPlaces()) + cell('cost', lpCost()) + cell('pr', lpPrices()) + lpAuto() + (GPV_ON ? cell('gpv', lpGpv()) : '') + '</div></section>';
  }
  V.welcome = function () {
    var acc = Y().mode === 'server' && Y().account;
    if (acc) {   // уже вошёл, но лічильник ещё не выбран (новый аккаунт или стёрли данные) — без рекламы, сразу к делу
      var who = acc.email || (acc.telegram && (acc.telegram.username ? '@' + acc.telegram.username : acc.telegram.name)) || '';
      return { screen: 'S00', bare: true, wide: true, html: '<div class="welcome lp">' + lpHero({ h1: esc(t('wl_title')), lead: t('wl_lead'),
        cta: lpCta('welcome-start', t('wl_cta')),
        after: '<p class="lp-who">' + esc(t('wl_fine', { who: who })) + ' <button class="linkbtn" data-act="logout">' + esc(t('wl_other')) + '</button></p>' }) + lpFoot(false) + '</div>' };
    }
    var login = Y().mode === 'server' && !Y().account, fine = Y().mode === 'claude' ? t('sync_claude') : Y().mode === 'server' ? t('w_fine_site') : t('w_fine');
    return { screen: 'S00', bare: true, wide: true, html: tgFailBox() + '<div class="welcome lp">' +
      lpHero({ badge: t('lp_badge'), h1: esc(t('lp_h1a')) + ' ' + esc(t('lp_h1b')), lead: t('lp_lead'),
        cta: lpCta('welcome-start', t('lp_cta')) + (login ? '<a class="lp-link" href="#login" data-key="welcome-login">' + esc(t('w_login')) + '</a>' : ''),
        after: '<ul class="lp-trust">' + ['lp_tr1', 'lp_tr2', 'lp_tr3'].map(function (k) { return '<li>' + ico('check', 16) + '<span>' + esc(t(k)) + '</span></li>'; }).join('') + '</ul>' }) +
      lpDest() + lpSteps() + lpBento() +
      '<section class="lp-end lp-plate" data-key="lp-end">' + lpScrews() + '<div class="lpe-in"><div class="lpe-copy"><h2>' + esc(t('lp_end_t')) + '</h2><p>' + esc(t('lp_end')) + '</p><div class="lp-ctas">' + lpCta('welcome-start-end', t('lp_cta')) + '</div></div>' + lpMeters() + '</div></section>' +
      '<p class="lp-fine small muted">' + esc(fine) + '</p>' + lpFoot(login) + '</div>' };
  };
  /** «Куди передати» для тепла: лише кабінет ХТМ, 5–25 числа; є перевірені показання — до покрокової передачі. */
  function heatWhere() {
    // тепло квартири постачає не ХТМ (інша громада) — контакти її постачальника з довідника
    var ld = prvOf('heat');
    if (ld && ld.via !== 'htm') return '<section class="panel where" data-key="where-heat"><h2>' + ico('send', 18, 'bt-ico') + '<span>' + esc(t('wd_title')) + '</span></h2>' + wherePlaceLine() + localDest('heat', ld, '', '', false) + '</section>';
    var ready = RD().filter(function (r) { return r.status === 'checked'; }).slice(-1)[0], w = R.windowState(today());
    var due = w.state === 'closed_before' ? t('wd_heat_from', { d: fmtDate(dayOfMonth(today(), 5)) }) : w.state === 'closed_after' ? t('wd_heat_from', { d: fmtDate(nextMonthDay(today(), 5)) }) : t('wd_due', { d: fmtDate(dayOfMonth(today(), 25)) });
    if (hcOn()) hcLoad();
    var on = hcOn() && hcConn();
    // вручну (скопіювати й вставити в кабінет) — коли кабінет не підключено; підключено — головне «Відправити у фоні» в ряду каналів
    var body = ready && !on ? '<div class="row-actions" style="margin-top:8px"><a class="btn" href="#handover" data-act="focus" data-id="' + ready.id + '" data-key="where-heat-handover">' + ico('copy', 18) + '<span>' + esc(t('wd_heat_ready', { d: fmtDate(ready.htm.date) })) + '</span></a></div>' : '';
    var bg = cabBgHeat(ready, 'where');
    return '<section class="panel where" data-key="where-heat"><h2>' + ico('send', 18, 'bt-ico') + '<span>' + esc(t('wd_title')) + '</span></h2>' +
      destBox({ key: 'htm-heat', org: t('wd_htm_org'), what: '', due: due, dueTone: w.state === 'late' || w.state === 'last_day' ? 'warn' : 'neutral', body: body,
        chans: [[HTM_URL, t('ho_open'), 'ext', 'cab']], chx: bg.btn, note: bg.note, more: '<p class="dm-t">' + esc(t('wd_heat_more')) + '</p><ul class="dm-ph"><li>' + telLink('+380573414140', '(057) 341-41-40') + '</li></ul>' }) + '</section>';
  }
  /** Кабінет ХТМ у ряду каналів «Куди передати» (і на екранах перевірки та фото): не підключено — «Підключити кабінет», рівноцінна кнопка;
   *  підключено й є зібрані показання — виділена «Відправити у фоні» з припискою, що саме піде; надсилає людина сама натисканням. */
  function cabBgHeat(r, where) {
    if (!hcOn()) return { btn: '<a class="btn sec" href="#htmcab" data-key="cab-connect-' + where + '">' + ico('plus', 18) + '<span>' + esc(t('cab_conn_btn')) + '</span></a>', note: '' };
    hcLoad();
    if (!HC.st) return { btn: '', note: '' };
    if (!hcConn()) return { btn: '<a class="btn sec" href="#htmcab" data-key="cab-connect-' + where + '">' + ico('plus', 18) + '<span>' + esc(t('cab_conn_btn')) + '</span></a>',
      note: '<p class="small muted dest-note" data-key="cab-off-' + where + '">' + esc(t(HC.st.state === 'bad_login' ? 'hc_relogin' : 'cab_bg_off')) + '</p>' };
    if (!r) return { btn: '<a class="btn sec" href="#htmcab" data-key="cab-on-' + where + '">' + ico('check', 18) + '<span>' + esc(t('cab_conn_ok')) + '</span></a>', note: '<p class="small muted dest-note">' + esc(t('cab_bg_none')) + '</p>' };
    var acc = hcAcc(r), what = t('cab_bg_heat', { d: R.formatForHtm('date', r.htm.date), e: R.formatForHtm('energy', r.htm.energy), a: acc ? t('cab_bg_acc', { a: acc.acc }) : '' });
    return { btn: '<button class="btn dest-bg" data-act="hc-bg" data-id="' + esc(r.id) + '" data-key="cab-bg-' + where + '"' + (HC.busy ? ' disabled' : '') + '>' + (HC.busy === 'send' ? SPIN + '<span>' + esc(t('hc_sending')) + '</span>' : ico('send', 18) + '<span>' + esc(t('cab_bg')) + '</span>') + '</button>',
      note: '<p class="small dest-note" data-key="cab-bg-note-' + where + '">' + esc(t('cab_bg_note', { what: what })) + '</p>' + (HC.errFor === r.id ? hcErrBox(HC.err) : '') };
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
    var ch = hcForms();
    ((HC.st && HC.st.jobs) || []).forEach(function (j) {
      var r = j.rid && hcRec(j.rid); if (!r) return;
      if (!r.cab && j.card && r.card === j.card && r.status === 'checked') { r.cab = { job: j.id }; r.status = 'handed'; r.handedAt = new Date((j.at || Date.now() / 1000) * 1000).toISOString(); ch = true; }   // «Відправити» в картці чату (121-а)
      if (!r.cab || r.cab.job !== j.id) return;
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
    var vals = htmRobotVals(r);
    var c = S.contacts || {};
    hcCall('send', '/cab/htm/send', { acc: acc ? acc.acc : '', rid: r.id, place: r.place || S.placeId, vals: vals, phone: c.phone || '', email: c.email || '', delay: true }, function (j) {
      var jb = j.job; if (HC.st) HC.st.jobs = [jb].concat((HC.st.jobs || []).filter(function (x) { return x.id !== jb.id; }));
      r.status = 'handed'; r.handedAt = new Date().toISOString(); r.cab = { job: jb.id, at: jb.at, status: jb.status, nextAt: jb.nextAt, auto: true }; r.updatedAt = Date.now();
      cardJob('htm', jb, { k: 'heat', t: t('bc_heat'), v: r.htm && r.htm.energy ? camNum(r.htm.energy) + ' ' + unitLbl(energyUnit()) : '', w: 'ХТМ' });
      var p = place(r.place) || place(), m = p && p.id === S.placeId ? S.meter : p && p.meter; if (m && !m.account && acc) m.account = acc.acc;
      hcApply(); S.focusId = r.id; save(); toast(jb.status === 'queued' ? t('ha_toast', { at: hcHM(jb.nextAt) }) : t('hc_toast')); go('status');
    });
  }
  /** Перемикач автоподачі на екрані кабінету (окрема згода: вносити без «Так, внести» після фото в бот). */
  function hcAutoBox() {
    var on = !!HC.st.auto, m = Math.round((HC.st.autoDelay || 600) / 60);
    return '<div class="panel hc ha" data-key="ha-box"><h2>' + ico('camera', 20) + '<span>' + esc(t('ha_t')) + '</span></h2><p class="small">' + esc(t('ha_sub', { m: m })) + '</p>' +
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
        '<li>' + esc(t('hc_c_vals', { d: R.formatForHtm('date', r.htm.date), e: htmVal('energy', r.htm, r.raw), u: unitLbl(htmUnit()) })) + '</li>' +
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
    var h = '<div class="wiz-top"><a class="btn ghost" href="#' + backTo('heat') + '">' + ico('back', 20) + '<span>' + esc(t('back')) + '</span></a></div><h1>' + esc(t('hc_title')) + '</h1>';
    if (!hcOn()) return { screen: 'S07c', route: 'htmcab', bare: true, closeTo: backTo('heat'), html: h + '<p>' + esc(t('hc_pitch')) + '</p><p>' + esc(t('hc_need_login')) + '</p><a class="btn" href="#login">' + esc(t('login')) + '</a>' };
    hcLoad();
    if (!HC.st) return { screen: 'S07c', route: 'htmcab', bare: true, closeTo: backTo('heat'), html: h + '<p class="muted">' + SPIN + ' ' + esc(t('hc_loading')) + '</p>' };
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
      return { screen: 'S07c', route: 'htmcab', bare: true, closeTo: backTo('heat'), html: h };
    }
    var st = HC.st, accs = st.accounts || [], acc = hcAcc();
    h += '<div class="verdict ok" data-key="hc-connected">' + levelIco('ok', 28) + '<span>' + esc(t('hc_on')) + '</span></div>' +
      '<p>' + esc(t(st.auto ? 'hc_on_sub_auto' : 'hc_on_sub', { e: st.login })) + '</p>' +
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
    return { screen: 'S07c', route: 'htmcab', bare: true, closeTo: backTo('heat'), html: h };
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
  function hcBg(id) {
    var r = hcRec(id); if (!r || HC.busy) return;
    HC.errFor = id; HC.err = null;
    if (!hcAcc(r)) { S.focusId = id; save(); go('handover'); return; }
    hcSend(id);
  }
  /** «Перевірити» відповів: що бачить кабінет + яка там форма (одиниця, третій час) — одразу в налаштування лічильника. */
  function hcChecked(c) { HC.check = c; if (c && c.forms && HC.st) { HC.st.forms = c.forms; if (hcForms()) save(); } }
  function hcSend(id) {
    var r = hcRec(id), acc = r && hcAcc(r); if (!r || !acc || HC.busy) return;
    var vals = htmRobotVals(r);
    var c = S.contacts || {};
    hcCall('send', '/cab/htm/send', { acc: acc.acc, rid: r.id, place: r.place || S.placeId, vals: vals, phone: c.phone || '', email: c.email || '' }, function (j) {
      HC.confirm = null; var jb = j.job;
      if (HC.st) HC.st.jobs = [jb].concat((HC.st.jobs || []).filter(function (x) { return x.id !== jb.id; }));
      if (r.status !== 'handed' && r.status !== 'accepted') { r.status = 'handed'; r.handedAt = new Date().toISOString(); }
      r.cab = { job: jb.id, at: jb.at, status: 'pending' }; r.updatedAt = Date.now();
      cardJob('htm', jb, { k: 'heat', t: t('bc_heat'), v: camNum(r.htm.energy || '') + ' ' + unitLbl(energyUnit()), w: 'ХТМ' });   // відкрито з картки в чаті — статус і там
      // рахунок, яким внесли, — у налаштування теплолічильника квартири (наступного разу без вибору)
      var p = place(r.place) || place(), m = p && p.id === S.placeId ? S.meter : p && p.meter; if (m && !m.account) m.account = acc.acc;
      hcApply(); S.focusId = r.id; save(); toast(t(jb.status === 'ok' ? 'hc_toast_ok' : 'hc_toast')); go('status');
    });
  }
  setInterval(function () {
    if (document.visibilityState === 'visible' && hcOn() && (S.readings || []).some(function (r) { return r && !r.deleted && r.status === 'handed' && r.cab && /^(pending|queued|sending)$/.test(r.cab.status); })) hcLoad(true);
  }, 60000);
  // «Відправити» натиснули в картці чату (121-а): запис ще не знає своєї задачі — підтягнути стан роботів одразу після відкриття
  setTimeout(function () {
    if (!hcOn()) return; var fresh = function (x) { return x && !x.deleted && x.card && Date.now() - (x.updatedAt || 0) < 3 * 864e5; };
    if ((S.readings || []).some(function (r) { return fresh(r) && !r.cab && r.status === 'checked'; })) hcLoad(true);
    if ((S.water || []).some(function (w) { return fresh(w) && !w.vkJob; })) vjLoad(true);
  }, 1500);
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
      HC.st = j; HC.at = Date.now(); HC.showPass = false; HC.check = null; HC.form = null; if (hcForms()) save(); toast(t('hc_on'));   // форма кабінету (ГДж, Pd) — одразу в лічильник
      // з екрана «Передайте» прийшли — туди й повертаємось
      if (S.focusId && hcRec(S.focusId) && hcRec(S.focusId).status === 'checked') { go('handover'); return; }
      hcCall('check', '/cab/htm/check', { acc: (hcAcc() || {}).acc || '' }, hcChecked);
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
    else if (a === 'hc-bg') hcBg(el.getAttribute('data-id'));
    else if (a === 'hc-pref-off') { if (confirm(t('pc_off_q'))) hcCall('forget', '/cab/forget', { prov: 'htm' }, function (j) { HC.st = j; HC.check = null; hcApply(); save(); toast(t('hc_forgot')); }); }
    else if (a === 'hc-refresh') { hcLoad(true); render(true); }
    else if (a === 'hc-check') hcCall('check', '/cab/htm/check', { acc: (hcAcc() || {}).acc || '' }, function (c) { hcChecked(c); hcLoad(true); });
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
      meta: [verWarn(S.meter && S.meter.verifiedUntil)].filter(Boolean),
      set: heatMeterFields(m) + htmFormBox(htmAsk()) + monoLink('heat-set') + priceBlock('heat') + gapSetLink('heat') , setTitle: t('mb_set_read') });
    var act = '', right = '';
    var n = steps().length;
    if (S.draft && (Object.keys(S.draft.values || {}).length || S.draft.step > 0)) {
      act += '<a class="btn big block" href="#step-' + (S.draft.step || 0) + '" data-key="home-continue">' + esc(t('h_continue', { i: (S.draft.step || 0) + 1, n: n })) + '</a>' +
        '<button class="linkbtn" style="margin-top:8px" data-act="restart" data-key="home-restart">' + esc(t('h_read')) + ' — ' + (S.lang === 'ru' ? 'заново' : 'спочатку') + '</button>';
    } else {
      act += '<button class="btn big block" data-act="read" data-key="home-read">' + esc(t('h_read')) + '</button>';   // фото — на кроках введення («з фото»)
    }
    right += whereAcc(heatWhere());
    var recent = heatMixed(3);
    if (recent.length) right += histPanel(readingList(recent), RD().length + gaps('heat').length, '<button class="btn sec block" data-act="view-go" data-v="heat" data-to="history" data-key="heat-all">' + esc(t('wh_all', { n: RD().length + gaps('heat').length })) + '</button>', 'heat');
    if (Y().mode === 'server' && !Y().account && RD().length && !S.syncPromptDismissed) {
      html = '<div class="banner" data-key="home-save-prompt">' + ico('info', 22) + '<div><p><b>' + esc(t('save_prompt')) + '</b></p><p><a href="#login">' + esc(t('login')) + '</a> &nbsp; <button class="linkbtn" data-act="dismiss-sync">' + esc(t('save_prompt_later')) + '</button></p></div></div>' + html;
    }
    html += heroGrid(left, act, right);
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
  function RD() { var first = S.places && S.places[0] ? S.places[0].id : 'main'; return (S.readings || []).filter(function (r) { return r && !r.deleted && !r.billOnly && (r.place || first) === S.placeId; }); }
  /** «Платіжка ХТМ» — квитанція з кабінету ХТМ за місяць, коли показань за нього немає (HtmBills на сервері; billOnly, ym). Не показання: лише в історії. */
  function RDB() { var first = S.places && S.places[0] ? S.places[0].id : 'main'; return (S.readings || []).filter(function (r) { return r && !r.deleted && r.billOnly && r.ym && (r.place || first) === S.placeId; }); }
  /** Тариф тепла, грн/Гкал: свій у квартири (place.prov.heat.price — з платіжки або з Налаштувань), далі старий спільний S.tariff, далі ХТМ. */
  function tariff() {
    var hc = hsprCalib(); if (hc && hc.tariff) return hc.tariff;   // скільки ХТМ справді нараховує за Гкал (із довідки кабінету)
    var p = place() || {}, h = (p.prov || {}).heat || {}, pn = R.num(h.price); if (pn && pn > 0) return pn;
    var d = prvOf('heat'); if (d && d.via !== 'htm' && R.num(d.price) > 0) return R.num(d.price);   // тепло не від ХТМ — тариф із довідника громади
    var n = R.num(S.tariff); return n && n > 0 ? n : R.C.TARIFF;
  }
  // ---- нарахування ХТМ по місяцях («Довідка по теплу» кабінету ХТМ; сервер бере разом із квитанцією — HtmSpr, GET /api/htm/spr) ----
  // З них: офіційна сума місяця в історії й картці показань, а розрахунок підлаштовується — тариф (нараховано / витрата), частка теплових втрат
  // будинку (витрата по квартирі − різниця показань) і абонплата. Владелец 08.11: «цены в платежках больше — дополни расчёты, чтобы совпадало».
  var HSPR = { at: 0, places: null, busy: false };
  function hsprLoad() {
    if (!window.TEPLO_API || HSPR.busy || !Y().account || (HSPR.places && Date.now() - HSPR.at < 600000)) return;
    HSPR.busy = true;
    window.TeploSync.api('GET', '/htm/spr').then(function (j) {
      HSPR.busy = false; HSPR.at = Date.now(); var had = HSPR.places ? JSON.stringify(HSPR.places) : ''; HSPR.places = (j && j.places) || [];
      if (JSON.stringify(HSPR.places) !== had && /^(history|stats|rec-|heat|home|place-|prefs|$)/.test(routeName())) safeRender();
    }, function () { HSPR.busy = false; HSPR.at = Date.now(); HSPR.places = HSPR.places || []; });
  }
  function hspr() { var x = (HSPR.places || []).filter(function (p) { return p.place === S.placeId; })[0]; return (x && x.rows) || []; }
  /** Журнал свого лічильника для довідки з будинковим лічильником: з кабінету ХТМ (сервер, «Всі записи»), а немає — власні показання в застосунку. */
  function hsprOwnList() {
    var x = (HSPR.places || []).filter(function (p) { return p.place === S.placeId; })[0], own = (x && x.own) || [];
    if (own.length >= 2) return own;
    return RD().filter(function (r) { return !r.own && r.htm && r.htm.date && R.num(r.htm.energy) !== null; }).map(function (r) { return { date: r.htm.date.slice(0, 10), energy: R.num(r.htm.energy), status: 'ok' }; });
  }
  function ymAdd(m, k) { var y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1 + k; y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12; return y + '-' + (mo < 9 ? '0' : '') + (mo + 1); }
  /** Кінці місяців свого лічильника {ym: Гкал} (як HtmSpr::ownEnds): same — останні показання цього місяця, next — наступного, interp — лінійно на 1-ше. */
  function hsprOwnEnds(own, al) {
    var p = own.filter(function (r) { return r.status !== 'rejected' && r.date && typeof r.energy === 'number'; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (p.length < 2) return {};
    var day = function (d) { return Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5; }, end = {};
    if (al === 'interp') {
      for (var m = p[0].date.slice(0, 7), last = p[p.length - 1].date.slice(0, 7); m <= last; m = ymAdd(m, 1)) {
        var b = day(ymAdd(m, 1) + '-01'), lo = null, hi = null;
        p.forEach(function (r) { if (day(r.date) <= b) lo = r; else if (!hi) hi = r; });
        if (lo && hi && day(hi.date) > day(lo.date) && day(hi.date) - day(lo.date) <= 75) end[m] = lo.energy + (hi.energy - lo.energy) * (b - day(lo.date)) / (day(hi.date) - day(lo.date));
      }
    } else p.forEach(function (r) { var mm = r.date.slice(0, 7); end[al === 'next' ? ymAdd(mm, -1) : mm] = r.energy; });
    return end;
  }
  /** Тепло свого лічильника по сусідніх місяцях (для картки місяця). */
  function hsprOwnMonths(own, al) {
    var end = hsprOwnEnds(own, al), out = {};
    Object.keys(end).forEach(function (mm) { var pm = ymAdd(mm, -1); if (end[pm] !== undefined && end[mm] >= end[pm]) out[mm] = end[mm] - end[pm]; });
    return out;
  }
  /** Проміжки між показаннями свого лічильника — і через пропущені місяці (до 4), як HtmSpr::ownIntervals: [{e, v, sf, n}] лише з місяців, що є в довідці. */
  function hsprOwnIntervals(rows, own, al) {
    var by = {}; rows.forEach(function (x) { if (typeof x.flat === 'number') by[x.ym] = x; });
    var end = hsprOwnEnds(own, al), ks = Object.keys(end).sort(), out = [];
    for (var i = 1; i < ks.length; i++) {
      var de = end[ks[i]] - end[ks[i - 1]], ms = [];
      if (de < 0) continue;
      for (var m = ymAdd(ks[i - 1], 1); m <= ks[i] && ms.length <= 4; m = ymAdd(m, 1)) ms.push(m);
      if (ms.length > 4 || ms.some(function (mm) { return !by[mm]; })) continue;
      var iv = { e: de, v: 0, sf: null, n: ms.length };
      ms.forEach(function (mm) { iv.v += by[mm].flat; if (by[mm].sFlat > 0) iv.sf = by[mm].sFlat; });
      if (iv.v > 0) out.push(iv);
    }
    return out;
  }
  /** Довідка з будинковим лічильником: частка будинку понад свій лічильник (витрата ХТМ − своє). Основа частки — та, що краще передбачає витрату ХТМ
   *  перевіркою «без себе» по проміжках між показаннями (як /api/health → htmSpr.check.own.model): own — частка від свого тепла (k), area — Гкал на м² за місяць (a).
   *  Живий кабінет 08.11: «своє × (1 + k)» помилялось на ~80 %, «на м²» — ~35 %. → {e: {ym: Гкал}, basis, k, a, sf, n, al, err} | null */
  var HOF = { key: null, v: null };
  function hsprOwnFit() {
    var key = HSPR.at + '|' + S.placeId + '|' + (S.readings || []).length + '|' + (S.updatedAt || 0); if (HOF.key === key) return HOF.v;
    HOF.key = key; HOF.v = null;
    var rows = hspr().filter(function (x) { return hsprBld(x); }), own = hsprOwnList(); if (!rows.length || own.length < 2) return null;
    var med = function (a) { a = a.slice().sort(function (x, y) { return x - y; }); return a[Math.floor(a.length / 2)]; };
    var B = { own: function (i) { return i.e; }, area: function (i) { return i.sf > 0 ? i.sf * i.n : 0; } }, best = null;
    ['same', 'interp', 'next'].forEach(function (al) {
      var iv = hsprOwnIntervals(rows, own, al), em = hsprOwnMonths(own, al);
      if (!iv.length || iv.reduce(function (s, i) { return s + i.n; }, 0) < 2) return;
      Object.keys(B).forEach(function (bs) {
        var f = B[bs], ok = iv.filter(function (i) { return f(i) > 0; }); if (!ok.length) return;
        var sx = 0, sb = 0; ok.forEach(function (i) { sx += i.v - i.e; sb += f(i); });
        // перевірка без себе (≥ 2 проміжки), інакше — як є
        var er = med(ok.map(function (i) { var x = sx, b = sb; if (ok.length >= 2) { x -= i.v - i.e; b -= f(i); } return b > 0 ? Math.abs(i.e + x / b * f(i) - i.v) / i.v : 1; }));
        var c = { e: em, basis: bs, c: Math.max(0, sx / sb), n: ok.length, al: al, err: er + (ok.length >= 2 ? 0 : 1) };
        if (!best || c.err < best.err) best = c;
      });
    });
    if (best) { var sf = rows.filter(function (x) { return x.sFlat > 0; }).slice(-1)[0]; best.k = best.basis === 'own' ? best.c : 0; best.a = best.basis === 'area' ? best.c : 0; best.sf = sf ? sf.sFlat : null; if (best.basis === 'area' && !best.sf) best = null; }
    return (HOF.v = best);
  }
  /** Рядок довідки ХТМ для запису показань: за поточними показаннями (Гкал або як на лічильнику), інакше — за місяцем зняття. */
  function hsprFor(r) {
    var rows = hspr(); if (!rows.length || !r || !r.htm || !r.htm.date) return null;
    var vs = [R.num(r.htm.energy), R.num(r.raw && r.raw.energy)].filter(function (v) { return v !== null; });
    return rows.filter(function (x) { return !hsprBld(x) && x.cur !== null && x.cur !== undefined && vs.some(function (v) { return Math.abs(x.cur - v) < 0.0015; }); })[0]
      || rows.filter(function (x) { return x.ym === r.htm.date.slice(0, 7); })[0] || null;
  }
  /** Показання в довідці — будинкового лічильника, а не квартири: різниця втричі й більше за витрату квартири. */
  function hsprBld(x) { return !!(x && x.diff !== null && x.diff !== undefined && x.flat > 0 && x.diff > x.flat * 3); }
  /** Офіційно за місяць: нараховано за тепло + абонплата − пільга. */
  function hsprSum(x) { return (x.cost || 0) + (x.abon || 0) - (x.lgota > 0 ? x.lgota : 0); }
  /** Підлаштування розрахунку під нарахування ХТМ: тариф (медіана нараховано/витрата), частка втрат будинку відносно власного тепла, абонплата. */
  function hsprCalib() {
    var rows = hspr(); if (!rows.length) return null;
    var tr = rows.filter(function (x) { return x.flat > 0 && x.cost > 0; }).map(function (x) { return x.cost / x.flat; }).filter(function (v) { return v > 300 && v < 10000; }).sort(function (a, b) { return a - b; });
    var hr = rows.filter(function (x) { return x.diff > 0 && x.flat !== null && x.flat >= x.diff && !hsprBld(x); }).slice(-8), sd = 0, sl = 0;
    hr.forEach(function (x) { sd += x.diff; sl += x.flat - x.diff; });
    var ab = rows.filter(function (x) { return x.abon > 0; }).slice(-1)[0], k = sd > 0 && hr.length >= 2 ? sl / sd : null, n = hr.length;
    // у довідці будинковий лічильник (живий кабінет 08.11) — частка будинку відносно свого лічильника квартири (журнал ХТМ або власні показання)
    // основа «площа»: частка будинку — Гкал за місяць (a × площа квартири), лише в місяці з теплом
    var mzk = null;
    // 65-я, квитанції власника за 2024–2026: з лічильником ХТМ бере (своє + ЗБП) × тариф, ЗБП — 0,005–0,018 Гкал/міс. «Частка будинку» з довідки більша —
    // це місяці за середнім (показання відхилені, лічильник знімали) або проміжок через літо: таку не беремо, лише ЗБП на м² (раніше завищувало історію вдвічі)
    if (k === null) {
      var of = hsprOwnFit(), sfl = rows.filter(function (x) { return x.sFlat > 0; }).slice(-1)[0], ar = sfl ? sfl.sFlat : R.num((place() || {}).area);
      if (of && (of.basis === 'area' ? of.a <= R.C.ZBP_MAX_M2 : of.k <= 0.05)) { k = of.k; n = of.n; if (of.basis === 'area') mzk = of.a * of.sf; }
      else if (rows.some(hsprBld) && ar > 0) { k = 0; mzk = R.C.ZBP_M2 * ar; }
    }
    return { tariff: tr.length ? Math.round(tr[Math.floor(tr.length / 2)] * 100) / 100 : null, k: k, abon: ab ? ab.abon : null, n: n, mzk: mzk };
  }
  function tariffSet(v) { var p = place(); if (!p) { S.tariff = v; return; } p.prov = p.prov || {}; p.prov.heat = Object.assign({}, p.prov.heat || {}, { price: v, at: today() }); p.updatedAt = Date.now(); }
  /* Платіжка ХТМ: до сплати = (ваше тепло за лічильником + ваша частка ЗБП) × тариф + абонплата.
     ЗБП — загальнобудинкові потреби (сходи, підвал): частка пропорційна площі, у платіжці — стовпець «на ЗБП» у рядку вашого вузла. */
  // абонплата и доля ЗБП — свои у каждой квартиры (place.bill); у первой — откат на прежние общие S.bill
  // своєї абонплати немає: тепло від ХТМ — абонплата ХТМ; тепло громади (Рогань) — її абонплата з довідника, а невідома — 0 (не харківська)
  function bill() {
    var p = place() || {}, first = (places()[0] || {}).id === p.id, b = Object.assign({}, first ? S.bill || {} : {}, p.bill || {}), ab = R.num(b.abon), mz = R.num(b.mzk), dflt = R.C.ABON;
    if (!(ab !== null && ab >= 0)) { var d = prvOf('heat'), da = d ? R.num(d.abon) : null; if (d && d.org && d.via !== 'htm') dflt = da !== null && da >= 0 ? da : 0; }
    // своєї частки ЗБП не вписали — частка теплових втрат будинку з нарахувань ХТМ (відносно власного тепла); абонплата — як нараховує ХТМ
    // 66-я: довідки ХТМ немає (чи з неї частку не вивели) — для всіх із теплом ХТМ і відомою площею частка ЗБП = ZBP_M2 × площа (квитанції 2024–2026)
    var hc = hsprCalib(), own = mz !== null && mz > 0, am = hc && hc.mzk > 0 ? hc.mzk : !own && (!hc || hc.k === null) ? zbpDefault() : 0;
    return { abon: ab !== null && ab >= 0 ? ab : (hc && hc.abon !== null ? hc.abon : dflt), mzk: own ? mz : am, heatOnly: !own && am > 0, auto: !own && am > 0 ? am : 0, own: own ? mz : null,
      k: !own && hc && hc.k !== null ? hc.k : 0 };
  }
  /** Поле «Ваша частка ЗБП»: значення — лише вписане людиною; порожнє — підказка, скільки рахуємо самі (з довідки ХТМ чи 0,00025 Гкал на м²). */
  function mzkField() {
    var b = bill(), a = R.num((place() || {}).area), f = function (v) { return String(+v.toFixed(5)).replace('.', ','); };
    var h = b.own !== null ? t('p_mzk_h') : b.auto > 0 ? t('p_mzk_auto', { v: f(b.auto) }) + ' ' + (hsprCalib() && hsprCalib().mzk > 0 ? t('p_mzk_spr') : t('p_mzk_m2', { a: String(a).replace('.', ',') })) : heatHtm() ? t('p_mzk_noarea') : t('p_mzk_h');
    return '<div class="field"><label for="p-mzk">' + esc(t('p_mzk_l')) + '</label><div class="ctl"><input id="p-mzk" class="num" inputmode="decimal" placeholder="' + esc(b.auto > 0 ? f(b.auto) : '0,01262') + '" value="' + esc(b.own !== null ? f(b.own) : '') + '"></div><div class="small muted" data-key="p-mzk-h">' + esc(h) + '</div></div>';
  }
  /** Тепло від ХТМ: адреси немає (Харків за замовчуванням) або постачальник тепла в довіднику — ХТМ. */
  function heatHtm() { var d = prvOf('heat'); return !d || d.via === 'htm'; }
  /** Частка ЗБП за замовчуванням, Гкал/міс: тепло ХТМ і площа квартири відома — R.C.ZBP_M2 × площа, інакше 0. */
  function zbpDefault() { var a = R.num((place() || {}).area); return heatHtm() && a > 0 && a < 1000 ? R.C.ZBP_M2 * a : 0; }
  /** Скільки з m місяців проміжку, що закінчується датою to, — опалювальні (жовтень–квітень): ЗБП ХТМ нараховує лише в них. */
  function heatMonths(m, to) {
    if (!to || !(m >= 1)) return m;
    var n = 0, ym = String(to).slice(0, 7); for (var i = 0; i < Math.round(m); i++) { var mo = +ymAdd(ym, -i).slice(5, 7); if (mo >= 10 || mo <= 4) n++; }
    return n;
  }
  var MONTH_DAYS = 365.25 / 12;
  function costOf(dE, days, to) {
    // ХТМ рахує ЗБП і абонплату помісячно: проміжок ~місяць — рівно один місяць; ЗБП «лише з теплом» — і лише в опалювальні місяці проміжку (to — дата кінця)
    var b = bill(), m = days >= 20 ? Math.max(1, Math.round(days / MONTH_DAYS)) : days > 0 ? days / MONTH_DAYS : 0, mz = b.mzk > 0 ? (b.heatOnly && !(dE > 0) ? 0 : b.mzk * (b.heatOnly ? heatMonths(m, to) : m)) : Math.max(0, dE) * b.k, heat = Math.max(0, dE) * tariff();
    return { heat: heat, mzk: mz * tariff(), abon: b.abon * m, total: heat + mz * tariff() + b.abon * m, gcal: Math.max(0, dE) + mz };
  }
  /** Сколько тепла набежало с прошлых показаний (по дате снятия) или с последних принятых ХТМ, и сколько это стоит. */
  /** paid — для історії: від останнього переданого (статус «передано»/«прийнято»; власник 11.11 — за це й платять), skip — скільки проміжних між ними. */
  function interval(r, paid) {
    var d = r.htm && r.htm.date, e = R.num(r.htm && r.htm.energy); if (!d || e === null) return null;
    var cand = RD().filter(function (x) { return x !== r && (r.own || !x.own) && x.htm && x.htm.date && x.htm.date < d && R.num(x.htm.energy) !== null; })
      .sort(function (a, b) { return a.htm.date < b.htm.date ? -1 : 1; }), prev = cand.slice(-1)[0], skip = 0;
    if (paid && !r.own) { var ps = cand.filter(function (x) { return /^(handed|accepted)$/.test(x.status); }).slice(-1)[0]; if (ps && ps !== prev) { skip = cand.length - 1 - cand.indexOf(ps); prev = ps; } }
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
    var c = costOf(dE, days, d);
    return { dE: dE, days: days, cost: c.total, parts: c, from: from.date, fromBase: !prev && !g, fromGap: !!g, overGap: off > 0, skip: g ? 0 : skip };
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
      ? (hasQ ? '<span class="hr-q">' + esc(o.q) + ' <small>' + esc(o.unit) + '</small></span>' : '') + (hasM ? '<span class="hr-m">' + (o.moneyExact ? '' : '≈ ') + esc(money0(o.money)) + ' <small>грн</small></span>' : '')
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
    var txt = label || '<span class="pill ' + cls + '">' + esc(ucf(cur === 'own' ? t('own_pill') : cur === 'sent' ? t('wh_sent') : r.base ? t('bs_unsent') : t('wh_notsent'))) + '</span>';
    return '<button type="button" class="st-chip" data-act="st-open" data-src="' + src + '" data-id="' + esc(r.id) + '" data-k="' + k + '" data-cur="' + cur + '"' + (r.base ? ' data-base="1"' : '') +
      ' aria-haspopup="true" aria-expanded="false" aria-label="' + esc(t('st_aria', { s: String(txt).replace(/<[^>]+>/g, '') })) + '" data-key="st-' + esc(r.id) + '">' + String(txt).replace(/<\/span>$/, ico('chev', 14, 'st-dd') + '</span>') + '</button>';
  }
  function stClose() { Array.prototype.forEach.call(document.querySelectorAll('.st-menu'), function (m) { m.remove(); }); Array.prototype.forEach.call(document.querySelectorAll('.st-chip[aria-expanded="true"]'), function (b) { b.setAttribute('aria-expanded', 'false'); }); }
  function stOpen(el) {
    var was = el.getAttribute('aria-expanded') === 'true'; stClose(); if (was) return;
    var src = el.getAttribute('data-src'), k = el.getAttribute('data-k'), cur = el.getAttribute('data-cur'), base = el.getAttribute('data-base') === '1';
    var opts = base ? [['sent', 'st_sent', 'bs_lead_s'], ['not', 'st_base_not', '']]
      : src === 'h' ? [['accepted', 'st_acc', 'st_acc_s'], ['handed', 'st_rev', 'st_rev_s']].concat(cur === 'rejected' ? [['rejected', 'st_rej', 'st_rej_s']] : [], [['not', 'st_not', ''], ['own', 'st_own', 'st_own_s']])
      : [['sent', 'st_sent', 'st_sent_' + (k === 'hot' ? 'hot' : k)], ['not', 'st_not', ''], ['own', 'st_own', 'st_own_s']];
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
  /** Статус показань тепла вручну (меню статусу в історії, екран «Передача в кабінет ХТМ»): accepted — ХТМ прийняв (рядок у журналі зелений),
   *  handed — збережено в кабінеті, ХТМ перевіряє, checked — не передано. «Останні прийняті» беруться з найпізнішого прийнятого (lastAccepted). */
  function heatSetStatus(r, v) {
    if (!r) return; var now = new Date().toISOString(); delete r.own;
    if (v === 'accepted') {
      r.status = 'accepted'; if (!r.handedAt) r.handedAt = now;
      r.result = Object.assign({}, r.result || {}, { at: now, via: (r.result && r.result.via) || 'self' });
      if (r.htm && r.htm.date && (!S.baseline || !S.baseline.date || r.htm.date >= S.baseline.date)) S.baseline = Object.assign({}, r.htm);
    } else if (v === 'handed') { r.status = 'handed'; if (!r.handedAt) r.handedAt = now; delete r.result; }
    else { r.status = 'checked'; delete r.handedAt; delete r.result; }
    r.updatedAt = Date.now();
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
      else if (v === 'accepted' || v === 'handed') { if (r.status !== v) heatSetStatus(r, v); }
      else if (v === 'rejected') { /* «Не прийнято» — лише показуємо поточний; розбір причини — на екрані статусу */ }
      else {
        if (v === 'sent' && !/^(handed|accepted|rejected)$/.test(r.status)) { r.status = 'handed'; r.handedAt = new Date().toISOString(); }
        if (v === 'not' && /^(handed|accepted|rejected)$/.test(r.status)) heatSetStatus(r, 'not');
      }
    }
    if (src === 'h' && !Object.keys(r.sent).length) delete r.sent;
    r.updatedAt = Date.now(); save();
    toast(t('st_done', { s: t(r.base ? (v === 'sent' ? 'st_sent' : 'st_base_not') : v === 'own' ? 'st_own' : v === 'accepted' ? 'st_acc' : v === 'handed' ? 'st_rev' : v === 'rejected' ? 'st_rej' : v === 'sent' ? 'st_sent' : 'st_not').toLowerCase() }));
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
    var arr = RD().map(function (r) { return { d: (r.htm && r.htm.date) || '', r: r }; }).concat(gaps('heat').map(function (g) { return { d: g.from, g: g }; }), RDB().map(function (r) { return { d: (r.htm && r.htm.date) || r.ym + '-28', b: r }; }),
      hnarMissing().map(function (n) { return { d: n.ym + '-28', n: n }; }));
    arr.sort(function (a, b) { return a.d < b.d ? 1 : a.d > b.d ? -1 : a.g ? -1 : 1; });
    return limit ? arr.slice(0, limit) : arr;
  }
  function readingList(arr) {
    return '<ul class="list" data-key="reading-list">' + arr.map(function (x) { return x.g ? gapItem(x.g) : x.b ? hbillItem(x.b) : x.n ? hnarItem(x.n) : readingItem(x.r || x); }).join('') + '</ul>';
  }
  /** Сума «до сплати» з квитанції ХТМ (сервер узяв зі сторінки рахунку), якщо є. */
  function hbillPay(r) { var b = ((r && r.bills) || []).filter(function (x) { return x && x.auto === 'htm' && R.num(x.pay) !== null; })[0]; return b ? R.num(b.pay) : null; }
  /** «до сплати … грн» з квитанції ХТМ, а є тепло наперед до кінця місяця — «…, з них наперед … грн». */
  function hbillPayTxt(r) {
    var b = ((r && r.bills) || []).filter(function (x) { return x && x.auto === 'htm' && R.num(x.pay) !== null; })[0]; if (!b) return '';
    return t('hb_pay', { s: money(R.num(b.pay)) }) + (R.num(b.pre) > 0 ? ', ' + t('hb_pre', { s: money(R.num(b.pre)) }) : '');
  }
  function hbillItem(r) {
    var pay = hbillPay(r);
    return histRow({ cls: 'hli-heat hli-bill', key: 'hbill-' + r.id, href: '#rec-' + r.id, lead: '<span class="hr-bill">' + ico('bill', 16) + esc(t('hb_title')) + '</span>',
      none: pay !== null ? hbillPayTxt(r) : t('hb_none'), date: monthLabel(r.ym), sub: [pay !== null ? t('hb_none') : '', t('hb_sub')], right: billMark(r.bills) });
  }
  function readingItem(r) {
    return [r].map(function (r) {
      var cls = { accepted: 'ok', rejected: 'bad', handed: 'info', checked: 'neutral', intermediate: 'neutral' }[r.status] || 'neutral';
      var iv = interval(r, true), ok = iv && iv.dE >= 0, hx = r.own ? null : hsprFor(r), hm = !hx && !r.own && r.htm && r.htm.date ? htmMonth(r.htm.date.slice(0, 7)) : null, mv = r.own ? null : hspMovedTo(r);
      if (hm && hm.money === null) hm = null;
      // вся строка — в карточку показаний (там же правка, удаление, статус); главное — расход и деньги; є нарахування ХТМ за місяць — його сума
      // нарахування ХТМ за місяць: з довідки по теплу (hx) чи з «Довідки щодо нарахувань» (hm, усі місяці)
      return histRow({ cls: 'hli-heat', key: 'reading-' + r.id, href: '#rec-' + r.id, q: ok ? '+' + fmtN(iv.dE, 3) : null, unit: 'Гкал', money: hx && hx.cost !== null ? hsprSum(hx) : hm ? hm.money : ok ? iv.cost : null, moneyExact: !!(hx && hx.cost !== null) || !!hm,
        none: iv ? t('hi_less', { de: Math.abs(iv.dE).toFixed(3) }) : t(gaps('heat').some(function (g) { return g.from < r.htm.date; }) ? 'hr_nogap' : 'hr_first'),
        date: fmtDate(r.htm.date, true), sub: [t('hr_on_meter', { v: R.formatForHtm('energy', r.htm.energy), u: 'Гкал' }), iv ? iv.days + '\u00a0' + t('days_short') + (iv.overGap ? ' ' + t('hr_over_gap') : '') : '',
          iv && iv.skip ? t('own_paid', { d: fmtDate(iv.from) }) + ' · ' + t('paid_skip', { n: iv.skip }) : '',
          hx && hx.flat !== null ? t('hsp_row', { g: fmtN(hx.flat, 3) }) : hm && hm.g > 0 ? t('hsp_row', { g: fmtN(hm.g, 3) }) : '', mv ? t('hsw_row_moved', { m: monthLabel(mv) }) : '', hbillPayTxt(r)],
        right: wxChip(wxFor(r)) + billMark(r.bills),
        st: stChip('h', r, 'heat', r.own ? 'own' : /^(handed|accepted|rejected)$/.test(r.status) ? r.status : 'not', r.own ? '' : '<span class="pill ' + cls + '">' + esc(t('status_' + r.status)) + '</span>') });
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
    var keys = ['energy', 'volume', 'flow', 'power', 'tSupply', 'tReturn', 'hours', 'errHours'].concat(times3() ? ['flowHours'] : []);
    // «Останні прийняті» — як у кабінеті ХТМ: енергія в одиниці кабінету (усередині — Гкал)
    if (R.num(b.energy) !== null && htmUnit() !== 'Gcal') b.energy = htmVal('energy', b, null);
    var fields = '<div class="field"><label for="b-date">' + esc(fieldLabel('date')) + '</label><div class="ctl"><input id="b-date" type="date" data-b="date" value="' + esc(b.date || '') + '"></div></div>' +
      '<div class="grid2">' + keys.map(function (k) {
        var cls = k === 'tSupply' ? ' supply' : k === 'tReturn' ? ' return' : '';
        return '<div class="field"><label for="b-' + k + '">' + esc(fieldLabel(k)) + '</label><div class="ctl' + cls + '"><input id="b-' + k + '" class="num" inputmode="decimal" autocomplete="off" data-b="' + k + '" value="' + esc(b[k] == null ? '' : b[k]) + '"><span class="unit">' + esc(k === 'energy' ? unitLbl(htmUnit()) : fieldUnit(k)) + '</span></div></div>';
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
      htmFormBox(htmAsk()) +
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
      var press = '<p class="press' + (s.press === 'long' ? ' hold' : '') + '">' + ico('press', 26) + pressText(s) + '</p>';
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
        (m && m.sleepMin ? '<p class="sleep">' + ico('moon', 18) + '<span>' + esc(t('s_sleep', { m: m.sleepMin })) + '</span></p>' : '') +
        // петлі (LOOP 0/1, групи, рівні): людина не знаходить екран, бо він в іншій петлі — скарги 12.11.2026 (124-а)
        '<details class="where loop-tip" data-key="step-loops"><summary>' + esc(t('s_loops')) + '</summary><p>' + esc(L(loopsOf(m).tip)) + '</p></details>';
      right = '<h1>' + esc(title) + '</h1>' + s.fields.map(function (k) { return k === 'errCode' ? errCodeField() : numField(k, prev); }).join('');
    }
    var isLast = i === n - 1;
    var actions = '<div class="wiz-actions">' + (i > 0 ? '<a class="btn sec" href="#step-' + (i - 1) + '" data-act="step-back" data-i="' + (i - 1) + '" data-key="step-back">' + ico('back', 20) + '<span>' + esc(t('back')) + '</span></a>' : '') +
      '<button class="btn" data-act="step-next" data-i="' + i + '" data-key="step-next">' + esc(isLast ? t('s_to_check') : t('next')) + '</button></div>' + cancelLink('heat');
    return { screen: 'S05', route: 'step', bare: true, closeTo: backTo('home'), html: head + '<div class="wiz"><div>' + left + '</div><div><form id="step-form" novalidate>' + right + actions + '</form></div></div>' };
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
    // час простою (124-а, власник: «у лічильників є час простою — його теж треба вводити»): пояснюємо завжди, не лише без минулих
    // data-plain лишаємо як є (лише «минулого разу N»): з нього при вводі береться число після першої цифри
    if (k === 'errHours') help = t('s_err_hours') + (help ? ' ' + help + '.' : '');
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
    if (hcOn()) hcLoad();
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
    var rows = htmFields().map(function (f) {
      var lvl = byField[f.key]; var val = htmVal(f.key, r, S.draft.values);
      return '<tr class="' + (lvl === 'block' ? 'is-block' : lvl === 'warn' ? 'is-warn' : '') + '"><th scope="row">' + esc(fieldLabel(f.key)) + (f.key === 'energy' ? ', ' + esc(unitLbl(htmUnit())) : '') + '</th><td>' + esc(val || '—') + '</td></tr>';
    }).join('');
    var d = res.derived, period = '';
    if (res.verdict !== 'block' && d && d.dE != null && d.dE >= 0 && S.baseline && R.daysBetween(S.baseline.date, r.date) > 0) {
      period = '<p class="small muted" data-key="check-period">' + esc(t('c_period', { de: d.dE.toFixed(3), days: R.daysBetween(S.baseline.date, r.date), cost: money(d.cost || 0) })) + '</p>';
    }
    // «не прийме» лише за порівнянням з попередніми — людина може передати сама, на свій ризик (робот у фоні — ні)
    // робот у фоні знає лише форму «ГКал + 2 часи» (поля LastValuePok … ErrorTime) — інші форми людина вносить сама
    var risk = res.verdict === 'block' && res.risky, canSend = res.verdict !== 'block' || risk, cab = res.verdict !== 'block' && hcOn() && hcConn();
    var actions = '<div class="row-actions">' +
      '<button class="btn sec" data-act="save-inter" data-key="check-save-inter">' + esc(t('c_save_inter')) + '</button>' +
      '<button class="btn' + (cab ? ' sec' : '') + '" data-act="to-handover" data-key="check-send"' + (canSend ? '' : ' disabled') + '>' + esc(cab ? t('cab_self') : risk ? t('c_send_risk') : res.verdict === 'warn' ? t('c_send_anyway') : t('c_send')) + '</button>' +
      (cab ? '<button class="btn dest-bg" data-act="chk-bg" data-key="check-bg"' + (HC.busy ? ' disabled' : '') + '>' + ico('send', 18) + '<span>' + esc(t('cab_bg')) + '</span></button>' : '') + '</div>' +
      (cab ? '<p class="small dest-note" data-key="check-bg-note">' + esc(t('cab_bg_note', { what: t('cab_bg_heat', { d: R.formatForHtm('date', r.date), e: R.formatForHtm('energy', r.energy), a: hcAcc() ? t('cab_bg_acc', { a: hcAcc().acc }) : '' }) })) + '</p>' : '');
    return { screen: 'S06', route: 'check', bare: true, closeTo: backTo('home'), html:
      '<div class="wiz-top"><a class="btn ghost" href="#step-' + (steps().length - 1) + '">' + ico('back', 20) + '<span>' + esc(t('back')) + '</span></a></div>' +
      '<h1>' + esc(t('c_title')) + '</h1>' +
      '<div class="verdict ' + res.verdict + '" data-key="check-verdict" data-verdict="' + res.verdict + '" role="status">' + levelIco(res.verdict, 28) + '<span>' + esc(vText) + '</span></div>' +
      // зауваження — лише наша перевірка всередині сервісу (власник 12.11.2026): ввічливо, без «ви помилились»
      (res.verdict !== 'ok' ? '<p class="small muted" data-key="check-disclaimer">' + esc(t(risk ? 'c_disclaimer_risk' : 'c_disclaimer')) + '</p>' : '') +
      '<div class="cols"><div>' + issues + period + '</div><div><h2 class="section-title" style="margin-top:0">' + esc(t('c_values')) + '</h2><table class="vals" data-key="check-values">' + rows + '</table>' + htmFormBox(htmAsk()) + '</div></div>' + actions + cancelLink('heat') };
  };

  V.handover = function () {
    var r = RD().filter(function (x) { return x.id === S.focusId; })[0] || RD().filter(function (x) { return x.status === 'checked'; }).slice(-1)[0];
    if (!r) return V.home();
    var h = r.htm;
    var rows = htmFields().map(function (f) {
      var val = htmVal(f.key, h, r.raw);
      return '<li><div><div class="k">' + esc(fieldLabel(f.key)) + (f.key === 'energy' ? ', ' + esc(unitLbl(htmUnit())) : '') + '</div><div class="v">' + esc(val) + '</div></div><span></span>' +
        '<button class="btn sec" data-act="copy" data-text="' + esc(val) + '" data-key="copy-' + f.key + '">' + ico('copy', 18) + '<span>' + esc(t('copy')) + '</span></button></li>';
    });
    var c = S.contacts || {};
    if (c.phone) rows.push('<li><div><div class="k">' + esc(t('ho_phone')) + '</div><div class="v">' + esc(c.phone) + '</div></div><span></span><button class="btn sec" data-act="copy" data-text="' + esc(c.phone) + '">' + ico('copy', 18) + '<span>' + esc(t('copy')) + '</span></button></li>');
    if (c.email) rows.push('<li><div><div class="k">' + esc(t('ho_email')) + '</div><div class="v" style="font-size:16px">' + esc(c.email) + '</div></div><span></span><button class="btn sec" data-act="copy" data-text="' + esc(c.email) + '">' + ico('copy', 18) + '<span>' + esc(t('copy')) + '</span></button></li>');
    var all = htmFields().map(function (f) { return fieldLabel(f.key) + (f.key === 'energy' ? ', ' + unitLbl(htmUnit()) : '') + ': ' + htmVal(f.key, h, r.raw); }).join('\n') + (c.phone ? '\n' + t('ho_phone') + ': ' + c.phone : '') + (c.email ? '\n' + t('ho_email') + ': ' + c.email : '');
    return { screen: 'S07', route: 'handover', bare: true, closeTo: backTo('home'), html:
      '<div class="wiz-top"><a class="btn ghost" href="#check">' + ico('back', 20) + '<span>' + esc(t('back')) + '</span></a></div>' +
      '<h1>' + esc(t('ho_title')) + '</h1><p>' + esc(t('ho_lead')) + '</p>' +
      '<div class="cols"><div class="ho-values"><ul class="copy-list" data-key="handover-values">' + rows.join('') + '</ul>' +
      '<div class="row-actions"><button class="btn sec" data-act="copy" data-text="' + esc(all) + '" data-key="copy-all">' + ico('copy', 20) + '<span>' + esc(t('ho_copy_all')) + '</span></button></div>' +
      htmFormBox(htmAsk()) +
      (c.phone && c.email ? '' : '<div class="banner warn" style="margin-top:16px">' + ico('alert', 22) + '<div><p>' + esc(t('ho_contacts_none')) + ' <a href="#prefs">' + esc(t('nav_prefs')) + '</a></p></div></div>') + '</div>' +
      // кабінет підключено — робот вносить сам, це головний шлях; вручну — нижче, запасний
      '<div class="ho-steps">' + (hcConn() ? hcPanel(r) : '') + '<div class="panel"><h2>' + esc(t(hcConn() ? 'ho_steps_self' : 'ho_steps_title')) + '</h2><ol class="steps"><li>' + esc(t('ho_s1')) + '</li><li>' + esc(t('ho_s2')) + '</li><li>' + esc(t('ho_s3')) + '</li><li>' + esc(t('ho_s4')) + '</li></ol>' +
      '<a class="btn sec block" href="' + HTM_URL + '" target="_blank" rel="noopener" data-key="handover-open">' + ico('ext', 20) + '<span>' + esc(t('ho_open')) + '</span></a></div>' +
      (hcConn() ? '' : hcPanel(r)) + '</div></div>' +
      hoStatus(r) };
  };
  /** Що з показаннями в кабінеті: «На перевірці» / «Прийнято» — вибір тут же, людина лишається на сторінці передачі (владелец 07.11).
   *  «Не прийнято» з поясненням причини — окремим посиланням на екран статусу. */
  var HO_POP = '';
  function hoStatus(r) {
    var cur = /^(handed|accepted|rejected)$/.test(r.status) && !r.own ? r.status : '';
    var pop = HO_POP; HO_POP = '';
    var opt = function (v, title, sub) { var on = cur === v;
      return '<button type="button" role="radio" aria-checked="' + on + '" class="ho-opt' + (on ? ' on' : '') + (on && pop === v ? ' pop' : '') + '" data-act="ho-st" data-v="' + v + '" data-id="' + esc(r.id) + '" data-key="ho-st-' + v + '">' +
        '<span class="ho-mark">' + (on ? ico('check', 22) : '') + '</span><span><b>' + esc(title) + '</b><span class="small muted">' + esc(sub) + '</span></span></button>'; };
    return '<section class="panel ho-st" data-key="ho-status"><h2 id="ho-st-h">' + esc(t('ho_st_t')) + '</h2><p class="small muted">' + esc(t('ho_st_sub')) + '</p>' +
      '<div class="ho-opts" role="radiogroup" aria-labelledby="ho-st-h">' + opt('handed', t('st_rev'), t('st_rev_s')) + opt('accepted', t('st_acc'), t('st_acc_s')) + '</div>' +
      (cur === 'accepted' ? '<div class="banner ok" data-key="ho-accepted" role="status">' + levelIco('ok', 22) + '<div><p><b>' + esc(t('st_accepted')) + '</b></p><p>' + esc(t('st_accepted_sub')) + '</p></div></div>' : '') +
      (cur === 'rejected' ? '<div class="banner warn" data-key="ho-rejected">' + ico('alert', 22) + '<div><p><b>' + esc(t('st_rejected')) + '</b></p><p><a href="#status" data-act="focus" data-id="' + esc(r.id) + '">' + esc(t('ho_st_why')) + '</a></p></div></div>'
        : cur === 'handed' ? '<p class="small ho-bad"><a href="#status" data-act="focus" data-id="' + esc(r.id) + '" data-key="ho-st-bad">' + esc(t('ho_st_bad')) + '</a></p>' : '') + '</section>';
  }

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
    } else if (r.status === 'handed' && r.cab && /^(queued|sending)$/.test(r.cab.status)) {
      body = hcWait(r);   // автоподача: ще в черзі — у кабінеті поки нічого дивитись
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

  // ---- нарахування ХТМ по всіх місяцях (82-а): «Довідка щодо нарахувань та оплати» кабінету — сервер кладе в nar (GET /api/htm/spr) ----
  // Архіву рахунків у кабінеті немає (лише останній), а ця довідка — помісячно з 2021 р.: Гкал, нараховано (з абонплатою), пільга, перерахунок, надходження, сальдо.
  function hnarAll() { var x = (HSPR.places || []).filter(function (p) { return p.place === S.placeId; })[0]; return (x && x.nar && x.nar.rows) || []; }
  function hnarHeat(ym) { var n = hnarAll().filter(function (r) { return r.ym === ym; })[0]; return n && n.heat ? n.heat : null; }
  /** Опалювана площа, за якою рахує ХТМ (84-а; у владельца в застосунку 59, у рахунку 54,30): останній місяць «Довідки щодо нарахувань» з площею,
   *  інакше «Довідка по теплу». → число | null */
  function htmArea() {
    var best = null; hnarAll().forEach(function (r) { if (r.heat && r.heat.area > 0 && r.heat.area < 10000 && (!best || r.ym > best.ym)) best = { ym: r.ym, a: r.heat.area }; });
    if (best) return best.a;
    var x = hspr().filter(function (r) { return r.sFlat > 0 && r.sFlat < 10000; }).slice(-1)[0]; return x ? x.sFlat : null;
  }
  /** Під полем площі: ХТМ знає іншу (чи площі ще немає) — показати й дати взяти одним дотиком. */
  function areaHint() {
    if (!heatHtm()) return ''; hsprLoad();
    var a = htmArea(), my = R.num((place() || {}).area); if (!a || (my && Math.abs(my - a) < 0.05)) return '';
    return '<div class="area-htm" data-key="area-htm"><p class="small muted">' + esc(t(my ? 'area_htm_diff' : 'area_htm', { a: fmtN(a, 2) })) + '</p>' +
      '<button type="button" class="btn sec" data-act="area-htm" data-a="' + a + '">' + esc(t('area_htm_btn', { a: fmtN(a, 2) })) + '</button></div>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-act="area-htm"]'); if (!b) return;
    ensurePlaces(); var a = R.num(b.getAttribute('data-a')), p = place(); if (!p || !(a > 0 && a < 10000)) return;
    p.area = a; p.updatedAt = Date.now(); save(); toast(t('area_htm_ok', { a: fmtN(a, 2) })); safeRender();
  });
  /** ХТМ за місяць: Гкал і гроші — з «Довідки по теплу» (поточний сезон, докладно) або з нарахувань (усі місяці). → {g, money, x, n, area} | null */
  function htmMonth(ym) {
    var x = hspr().filter(function (r) { return r.ym === ym && !(r.flat === null || r.flat === undefined); })[0] || null, n = hnarHeat(ym);
    var g = x ? x.flat : n && typeof n.gcal === 'number' ? n.gcal : n && typeof n.cost === 'number' ? 0 : null;
    var mo = x && x.cost !== null && x.cost !== undefined ? hsprSum(x) : n && typeof n.cost === 'number' ? n.cost - (n.lgota > 0 ? n.lgota : 0) : null;
    if (g === null && mo === null) return null;
    return { g: g, money: mo, x: x, n: n, area: (n && n.area) || (x && x.sFlat) || R.num((place() || {}).area) };
  }
  /** Своє тепло по місяцях за записами застосунку (місяць — за датою зняття): {ym: {e, recs}}. */
  var OBM = { key: null, v: null };
  function ownByMonth() {
    var key = S.placeId + '|' + (S.readings || []).length + '|' + (S.updatedAt || 0); if (OBM.key === key) return OBM.v;
    var o = {}; RD().forEach(function (r) { var iv = interval(r); if (!r.htm || !r.htm.date || !iv || !(iv.dE >= 0)) return; var m = r.htm.date.slice(0, 7); o[m] = o[m] || { e: 0, recs: [] }; o[m].e += iv.dE; o[m].recs.push(r); });
    OBM.key = key; OBM.v = o; return o;
  }
  /** Чому ХТМ нарахував за місяць інакше, ніж показав ваш лічильник (власник 09.11, березень 2026: наш 2,127 + ЗБП, ХТМ 2,437).
   *  zbp — збігається (лічильник + частка ЗБП); tail — ХТМ додав тепло з показань наступного місяця, за який сам не нараховує (кінець сезону);
   *  head — те саме з попереднього (початок сезону); avg — показань цього місяця в журналі ХТМ немає (за середнім); more/less — інше (наперед, перенесення).
   *  → {k, g, own, zbp, d, add?, recs?, ym2?, rej?} | null */
  function hspWhy(ym) {
    var h = htmMonth(ym); if (!h || !(h.g > 0)) return null;
    var om = ownByMonth(), o = om[ym]; if (!o) return null;
    var zbp = h.area > 0 && h.area < 1000 ? R.C.ZBP_M2 * h.area : 0, d = h.g - o.e, tol = Math.max(0.012, 0.02 * h.g), tol2 = Math.max(0.015, 0.03 * h.g);
    var base = { g: h.g, own: o.e, zbp: zbp, d: d };
    if (Math.abs(d - zbp) <= tol) return Object.assign({ k: 'zbp' }, base);
    var side = [[1, 'tail'], [-1, 'head']], jl = hsprOwnList(), je = jl.length >= 2 ? hsprOwnEnds(jl, 'same') : {};
    // показань сусіднього місяця в застосунку немає — з журналу ХТМ (прийняті): тепло між кінцями місяців
    var jm = function (m2) { var a = side0(m2); return a; }, side0 = function (m2) {
      var pm = ymAdd(m2, -1); if (je[m2] === undefined || je[pm] === undefined || !(je[m2] >= je[pm])) return null;
      var last = jl.filter(function (x) { return x.date && x.date.slice(0, 7) === m2 && x.status !== 'rejected'; }).slice(-1)[0];
      return { e: je[m2] - je[pm], recs: [], date: last ? last.date : null };
    };
    for (var i = 0; i < side.length; i++) {
      var m2 = ymAdd(ym, side[i][0]), h2 = htmMonth(m2), o2 = om[m2] || jm(m2);
      if (o2 && o2.e > 0.001 && !(h2 && h2.g > 0.001) && Math.abs(d - o2.e - zbp) <= tol2) return Object.assign({ k: side[i][1], add: o2.e, recs: o2.recs, ym2: m2, date: o2.date || null }, base);
    }
    var ol = hsprOwnList(), inM = ol.filter(function (x) { return x.date && x.date.slice(0, 7) === ym; });
    if (ol.length >= 2 && !inM.some(function (x) { return x.status !== 'rejected'; })) return Object.assign({ k: 'avg', rej: inM.filter(function (x) { return x.status === 'rejected'; })[0] }, base);
    return Object.assign({ k: d > zbp ? 'more' : 'less' }, base);
  }
  /** Запис, тепло якого ХТМ поклав у сусідній місяць (кінець/початок сезону): → місяць ХТМ | null. */
  function hspMovedTo(r) {
    if (!r || !r.htm || !r.htm.date) return null; var ym = r.htm.date.slice(0, 7);
    for (var k = -1; k <= 1; k += 2) { var w = hspWhy(ymAdd(ym, k)); if (w && (w.k === 'tail' || w.k === 'head') && w.recs.indexOf(r) >= 0) return ymAdd(ym, k); }
    return null;
  }
  /** Пояснення різниці — блок у картці місяця (і на екрані нарахування без показань). */
  function hspWhyHtml(ym, iv) {
    var w = hspWhy(ym); if (!w) return '';
    var f3 = function (v) { return fmtN(v, 3); }, ml = monthLabel(ym), d0 = w.recs && w.recs.length ? fmtDate(w.recs[w.recs.length - 1].htm.date, true) : w.date ? fmtDate(w.date, true) : monthLabel(w.ym2 || ym);
    var txt = w.k === 'zbp' ? t('hsw_zbp', { o: f3(w.own), z: f3(w.zbp), g: f3(w.g) })
      : w.k === 'tail' || w.k === 'head' ? t('hsw_' + w.k, { m: ml, a: f3(w.add), d: d0, o: f3(w.own), z: f3(w.zbp), g: f3(w.g) })
      : w.k === 'avg' ? t('hsp_avg') + (w.rej ? ' ' + t('hsp_avg_rej', { d: fmtDate(w.rej.date), v: fmtN(w.rej.energy, 3) }) : '')
      : t('hsw_' + w.k, { x: f3(Math.abs(w.d - w.zbp)), s: money(Math.abs(w.d - w.zbp) * tariff()), o: f3(w.own) });
    var nx = hnarHeat(ymAdd(ym, 1)), rc = nx && nx.recalc ? t('hsw_rc', { m: monthLabel(ymAdd(ym, 1)), s: (nx.recalc > 0 ? '+' : '−') + money(Math.abs(nx.recalc)) }) : '';
    return '<div class="hsw hsw-' + w.k + '" data-key="hsp-why" data-why="' + w.k + '"><b>' + esc(t(w.k === 'zbp' ? 'hsw_t_ok' : 'hsw_t')) + '</b><p>' + esc(txt) + '</p>' + (rc && w.k !== 'zbp' ? '<p class="small">' + esc(rc) + '</p>' : '') + '</div>';
  }
  /** Картка показань: як нарахував ХТМ за цей місяць (довідка кабінету) — різниця показань, частка втрат будинку, тариф, абонплата, пільга, разом; і наш розрахунок поруч. */
  var HSP_OPEN = {};
  document.addEventListener('toggle', function (e) { var d = e.target; if (d && d.classList && d.classList.contains('hacc')) HSP_OPEN[d.id.slice(5)] = d.open; }, true);
  function hsprPanel(r, iv, ymArg) {
    hsprLoad(); var ym = ymArg || (r && r.htm && r.htm.date ? r.htm.date.slice(0, 7) : null), x = ymArg ? null : (r.own ? null : hsprFor(r)), n = ym ? hnarHeat(ym) : null;
    if (x) ym = x.ym, n = hnarHeat(ym);
    var moved = !ymArg && !x ? hspMovedTo(r) : null;
    if (!x && !n && !moved) return '';
    var li = function (k, v, b) { return '<li><div class="grow small' + (b ? '' : ' muted') + '">' + esc(k) + '</div>' + (b ? '<b class="num">' + esc(v) + '</b>' : '<span class="num">' + esc(v) + '</span>') + '</li>'; };
    var sg = function (v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + money(Math.abs(v)); };
    var hm = htmMonth(ym), why = hspWhy(ym);
    if (!x) {   // лише нарахування (усі місяці): Гкал, нараховано, перерахунок, оплати, сальдо
      var nl = n ? (typeof n.gcal === 'number' ? li(t('hsp_n_gcal'), fmtN(n.gcal, 3) + ' Гкал', true) : '') + (typeof n.cost === 'number' ? li(t('hsp_n_cost'), money(n.cost) + ' грн', true) : '') +
        (n.lgota ? li(t('hsp_lgota'), '−' + money(Math.abs(n.lgota)) + ' грн') : '') + (n.recalc ? li(t('hsp_n_recalc'), sg(n.recalc) + ' грн') : '') + (typeof n.paid === 'number' ? li(t('hsp_n_paid'), money(n.paid) + ' грн') : '') +
        (typeof n.saldo === 'number' ? li(t(n.saldo < 0 ? 'hsp_n_over' : 'hsp_n_debt'), money(Math.abs(n.saldo)) + ' грн') : '') : '';
      var brief0 = hm ? (hm.g > 0 ? fmtN(hm.g, 3) + ' Гкал · ' : '') + (hm.money !== null ? money(hm.money) + ' грн' : '') : '';
      return '<details class="panel hacc" id="hacc-' + esc(r ? r.id : 'n' + ym) + '" data-key="rec-htm"' + (HSP_OPEN[r ? r.id : 'n' + ym] || ymArg ? ' open' : '') + '><summary data-key="rec-htm-sum"><h2><span class="grow">' + esc(t('hsp_title', { m: monthLabel(ym) })) +
        '<span class="hacc-brief small muted">' + esc(brief0) + (moved ? ' · ' + esc(t('hsw_b_moved', { m: monthLabel(moved) })) : why && why.k !== 'zbp' ? ' · ' + esc(t('hsw_b_' + why.k)) : '') + '</span></span>' + ico('chev', 20, 'pacc-chev') + '</h2></summary><div class="hacc-b">' +
        (moved ? '<div class="hsw hsw-moved" data-key="hsp-moved"><p>' + esc(t('hsw_moved', { m: monthLabel(moved) })) + '</p></div>' : hspWhyHtml(ym, iv)) +
        (nl ? '<ul class="list">' + nl + '</ul>' : '') + (iv && iv.dE >= 0 && !ymArg ? '<p class="small muted">' + esc(t('hsp_ours', { s: money(iv.cost) })) + '</p>' : '') + '<p class="small muted">' + esc(t('hsp_n_src')) + '</p></div></details>';
    }
    var tar = x.flat > 0 && x.cost != null ? x.cost / x.flat : null, bld = hsprBld(x), sh = !bld && x.flat != null && x.diff != null ? x.flat - x.diff : null;
    var of = bld ? hsprOwnFit() : null, oe = of && of.e[x.ym] > 0 && x.flat >= of.e[x.ym] ? of.e[x.ym] : null;
    // місяць за середнім: у журналі ХТМ немає прийнятих показань свого лічильника за цей місяць, або ХТМ нарахував помітно більше за «своє + ЗБП»;
    // 82-а: якщо різницю пояснено (показання наступного місяця в кінці сезону тощо) — не «за середнім»
    var ol = bld ? hsprOwnList() : [], inM = function (st) { return ol.filter(function (o) { return o.date && o.date.slice(0, 7) === x.ym && (st ? o.status === st : o.status !== 'rejected'); }); };
    var rej = inM('rejected')[0], avg = bld && ol.length >= 2 && x.flat > 0 && (!inM().length || (oe !== null && x.flat - oe > Math.max(0.03, R.C.ZBP_MAX_M2 * (x.sFlat || 60))));
    if (why && why.k !== 'avg') avg = false;
    // акордеон (власник 09.11): багато рядків заважали — згорнуто лише підсумок «Гкал · грн», розгорнуто — розрахунок; стоїть перед платіжкою
    var brief = (x.flat != null ? fmtN(x.flat, 3) + ' Гкал · ' : '') + money(hsprSum(x)) + ' грн';
    return '<details class="panel hacc" id="hacc-' + esc(r.id) + '" data-key="rec-htm"' + (HSP_OPEN[r.id] ? ' open' : '') + '><summary data-key="rec-htm-sum"><h2><span class="grow">' + esc(t('hsp_title', { m: monthLabel(x.ym) })) +
      '<span class="hacc-brief small muted">' + esc(brief) + (avg ? ' · ' + esc(t('hsp_avg_b')) : why && why.k !== 'zbp' && why.k !== 'avg' ? ' · ' + esc(t('hsw_b_' + why.k)) : '') + '</span></span>' + ico('chev', 20, 'pacc-chev') + '</h2></summary><div class="hacc-b">' +
      (why && !avg ? hspWhyHtml(x.ym, iv) : '') + '<ul class="list">' +
      // у довідці показання будинкового лічильника (живий кабінет 08.11: різниця в десятки разів більша за витрату квартири) — показуємо будинок окремо, без «частки»
      (bld ? li(t('hsp_bdiff'), fmtN(x.diff, 3) + ' Гкал') + (x.loss != null ? li(t('hsp_loss'), fmtN(x.loss, 3) + ' Гкал') : '') + (x.house != null ? li(t('hsp_house'), fmtN(x.house, 3) + ' Гкал') : '')
        + (x.sFlat && x.sHouse ? li(t('hsp_area'), fmtN(x.sFlat, 1) + ' / ' + fmtN(x.sHouse, 1) + ' м²') + (x.sHouse < 3 * x.sFlat ? '<li class="small muted" data-key="hsp-area-odd">' + esc(t('hsp_area_odd')) + '</li>' : '') : '') : '') +
      (!bld && x.diff != null ? li(t('hsp_diff'), fmtN(x.diff, 3) + ' Гкал') : '') +
      (sh !== null ? li(t('hsp_share') + (x.loss != null && x.sFlat && x.sHouse ? ' (' + fmtN(x.loss, 1) + ' × ' + fmtN(x.sFlat, 1) + ' / ' + fmtN(x.sHouse, 1) + ' м²)' : ''), fmtN(sh, 3) + ' Гкал') : '') +
      // свій лічильник за місяць (журнал ХТМ) і частка будинку понад нього — як ХТМ рахує квартиру з лічильником (Методика № 315)
      (oe !== null ? li(t('hsp_own'), fmtN(oe, 3) + ' Гкал') + li(t('hsp_over'), fmtN(x.flat - oe, 3) + ' Гкал') : '') +
      (x.flat != null ? li(t('hsp_flat'), fmtN(x.flat, 3) + ' Гкал', true) : '') +
      (tar !== null ? li(t('hsp_tariff'), money(tar) + ' грн/Гкал') : '') +
      (x.cost != null ? li(t('hsp_cost'), money(x.cost) + ' грн') : '') + (x.abon != null ? li(t('hsp_abon'), money(x.abon) + ' грн') : '') +
      (x.lgota > 0 ? li(t('hsp_lgota'), '−' + money(x.lgota) + ' грн') : '') + li(t('hsp_total'), money(hsprSum(x)) + ' грн', true) +
      // у рахунку того місяця (з «Довідки щодо нарахувань») — як нарахували тоді: з теплом наперед до кінця місяця; довідка по теплу — уже уточнене (бій 09.11: −7…+65 %)
      (n && typeof n.gcal === 'number' && x.flat > 0 && Math.abs(n.gcal - x.flat) > Math.max(0.002, x.flat * 0.005) ? li(t('hsp_n_bill'), fmtN(n.gcal, 3) + ' Гкал · ' + money(n.cost) + ' грн') +
        '<li class="small muted" data-key="hsp-billdiff">' + esc(t('hsp_n_billdiff')) + '</li>' : '') +
      (n && n.recalc ? li(t('hsp_n_recalc'), sg(n.recalc) + ' грн') : '') + (n && typeof n.paid === 'number' ? li(t('hsp_n_paid'), money(n.paid) + ' грн') : '') +
      (n && typeof n.saldo === 'number' ? li(t(n.saldo < 0 ? 'hsp_n_over' : 'hsp_n_debt'), money(Math.abs(n.saldo)) + ' грн') : '') +
      (avg ? '<li class="small muted" data-key="hsp-avg">' + esc(t('hsp_avg') + (rej ? ' ' + t('hsp_avg_rej', { d: fmtDate(rej.date), v: fmtN(rej.energy, 3) }) : '')) + '</li>' : '') + '</ul>' +
      (iv && iv.dE >= 0 ? '<p class="small muted">' + esc(t('hsp_ours', { s: money(iv.cost) })) + '</p>' : '') + '<p class="small muted">' + esc(t('hsp_src')) + '</p></div></details>';
  }
  /** Нарахування ХТМ за місяць без показань у застосунку (з «Довідки щодо нарахувань»): екран #hnar-рррр-мм. */
  function hnarView(ym) {
    hsprLoad(); var h = htmMonth(ym);
    return { screen: 'S09', route: 'history', html: recBack() + '<h1>' + esc(t('hn_title')) + ' · ' + esc(monthLabel(ym)) + '</h1>' +
      '<p class="small muted" data-key="hn-sub">' + esc(t('hn_sub')) + '</p>' + (h && h.money !== null ? '<p data-key="hn-sum"><b class="num big">' + esc(money(h.money)) + '</b> <span class="small muted">грн' + (h.g > 0 ? ' · ' + esc(fmtN(h.g, 3)) + ' Гкал' : '') + '</span></p>' : '') +
      hsprPanel(null, null, ym) };
  }
  /** Місяці з нарахуванням ХТМ (тепло чи перерахунок), але без показань і без «Платіжки ХТМ» у застосунку — рядками в історії тепла. */
  function hnarMissing() {
    var have = {}; RD().forEach(function (r) { if (r.htm && r.htm.date) have[r.htm.date.slice(0, 7)] = 1; }); RDB().forEach(function (r) { have[r.ym] = 1; });
    // місяці до перших показань у застосунку теж показуємо — це і є «усі місяці» з кабінету
    return hnarAll().filter(function (r) { var h = r.heat || {}; return !have[r.ym] && (h.gcal > 0 || (h.recalc && Math.abs(h.recalc) >= 0.01)); });
  }
  function hnarItem(n) {
    var h = n.heat || {}, mo = typeof h.cost === 'number' ? h.cost - (h.lgota > 0 ? h.lgota : 0) : null;
    return histRow({ cls: 'hli-heat hli-bill hli-nar', key: 'hnar-' + n.ym, href: '#hnar-' + n.ym, lead: '<span class="hr-bill">' + ico('bill', 16) + esc(t('hn_title')) + '</span>',
      q: h.gcal > 0 ? fmtN(h.gcal, 3) : null, unit: 'Гкал', money: mo, moneyExact: true, none: t('hn_none'), date: monthLabel(n.ym),
      sub: [h.recalc ? t('hn_recalc', { s: (h.recalc > 0 ? '+' : '−') + money(Math.abs(h.recalc)) }) : '', t('hn_row_sub')] });
  }
  /** Вкладки без единого счётчика в квартире — пусто и «Додати лічильник». */
  function noMeters(route, title) {
    return { screen: 'S09', route: route, html: '<h1>' + esc(t(title)) + '</h1><div class="panel" data-key="no-meters"><p class="muted">' + esc(t('hi_nometers')) + '</p><button class="btn" data-act="add-meter" data-key="no-meters-add">' + ico('plus', 20) + '<span>' + esc(t('am_tile')) + '</span></button></div>' };
  }
  V.history = function () { if (!kinds().length) return noMeters('history', 'hi_title'); var k = curView(); return k === 'heat' ? heatHistory() : k === 'waste' ? wasteHistory() : SK[k] ? shistory(k) : whistory(k); };
  V.stats = function () { if (!kinds().length) return noMeters('stats', 'stt_title'); var k = curView(); return k === 'heat' ? heatStats() : k === 'waste' ? wasteStats() : SK[k] ? sstats(k) : wstats(k); };
  V.save = function () { if (!kinds().length) return noMeters('save', 'wsv_title'); var k = curView(); return k === 'heat' ? heatSave() : SK[k] ? ssave(k) : wsave(k); };
  function heatHistory() {
    if (window.TeploStats) loadWeather(); hsprLoad();
    var arr = heatMixed();
    return { screen: 'S09', route: 'history', html: '<h1>' + esc(t('hi_title')) + '</h1>' + kindSwitch() +
      (arr.length ? seasonList(arr) : '<div class="panel"><p class="muted">' + esc(t('hi_empty')) + '</p><button class="btn" data-act="read">' + esc(t('hi_empty_cta')) + '</button></div>') + gapAddLink('heat') };
  }
  /** История тепла по отопительным сезонам — система складывает их сама (TeploStats.seasons): вся цепочка показаний (и «для себе»),
   *  промежуток — в сезон, на который приходится его середина. У сезона — Гкал и гривны (с абонплатой и ЗБП, как в платіжці),
   *  где шло тепло, в среднем за месяц опалення. Новый сезон (и текущий) раскрыт, старые — свёрнуты, итог видно и так. */
  function seasonList(arr) {
    if (!window.TeploStats) return readingList(arr);
    var TS = TeploStats, ss = TS.seasons(TS.intervals(RD(), S.baseline, null, tariff(), gaps('heat')), function (iv) { return costOf(iv.dE, iv.days, iv.to).total; }, today());
    var of = {}, info = {}; ss.forEach(function (s) { info[s.season] = s; s.ids.forEach(function (id) { of[id] = s.season; }); });
    var groups = {};
    arr.forEach(function (x) {
      var k = x.g ? TS.seasonOf(x.g.from) : x.b || x.n ? TS.seasonOf(x.d) : of[x.r.id] !== undefined ? of[x.r.id] : TS.seasonOf(x.r.htm.date);
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
        if (x.b || x.n) return;   // «Платіжка ХТМ» і нарахування ХТМ без показань — не показання
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
        '<span class="ss-sum">' + q + '</span>' + (sub ? '<span class="ss-sub">' + subSpans(sub) + '</span>' : '') + ico('chev', 18, 'pacc-chev ss-dd') + '</summary>' + readingList(groups[k]) + '</details>';
    }).join('') + '<p class="small muted" data-key="hs-hint">' + esc(t('hs_hint')) + '</p>';
  }

  /** Карточка показаний из истории: все 10 значений, сколько набежало и почём; правка и удаление. */
  function recView(id, edit) {
    var r = RD().filter(function (x) { return x.id === id; })[0];
    if (!r) { var hb = RDB().filter(function (x) { return x.id === id; })[0]; if (hb) return hbillView(hb); }
    if (!r) return { screen: 'S09', route: 'history', html: '<h1>' + esc(t('hi_title')) + '</h1><p class="muted">' + esc(t('rec_gone')) + '</p><a class="btn" href="#history">' + esc(t('back')) + '</a>' };
    // від останнього «передано/прийнято» (власник 11.11: набігло — з минулої оплати), проміжні — рядком; «для себе» — від попереднього
    var h = r.htm || {}, iv = interval(r, true), cls = { accepted: 'ok', rejected: 'bad', handed: 'info' }[r.status] || 'neutral';
    var head = recBack() + '<h1>' + esc(fmtDate(h.date, true)) + '</h1>' +
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
    var vals = usedVals('rec-values', R.FIELDS.filter(function (f) { return f.key !== 'date'; }).map(function (f) {
      var v = f.key === 'errCode' ? (h.errCode || '—') : (R.num(h[f.key]) === null ? '—' : R.formatForHtm(f.key, h[f.key]));
      return { n: fieldLabel(f.key), v: v, u: f.unit && v !== '—' ? (f.key === 'energy' ? 'Гкал' : fieldUnit(f.key)) : '', copy: f.key === 'energy' && v !== '—' ? v : null, ck: 'rec-copy-energy', k: f.key === 'energy' ? 'energy' : '', minor: f.key !== 'energy' };
    }));
    if (window.TeploStats) loadWeather();
    var wx = wxFor(r);
    // 1) скільки набігло з минулого показання і скільки коштувало (власник 10.11 — першим блоком); 2) фото; 3) поля показань списком (без ЖК-табло)
    var used = iv ? (iv.dE < 0 ? '<section class="panel ru ru-heat" data-key="rec-used"><h2 class="ru-t">' + esc(t('rec_used_title')) + '</h2><p class="ru-per">' + esc(intervalText(iv)) + '</p>' + vals + '</section>' :
      usedBox({ kind: 'heat', key: 'rec-used', title: iv.skip ? t('ru_title_paid', { d: fmtDate(iv.from) }) : t('rec_used_title'), per: t('ru_per', { a: fmtDate(iv.from, String(iv.from).slice(0, 4) !== String(h.date).slice(0, 4)), b: fmtDate(h.date, true), d: iv.days }),
        qs: [{ v: '+' + fmtN(iv.dE, 3), u: 'Гкал' }], money: iv.cost, vals: vals,
        lines: [t('ru_h_calc', { q: fmtN(iv.dE, 3), p: money(tariff()), s: money(iv.parts.heat) }), [iv.parts.mzk > 0.004 ? t('ru_h_mzk', { s: money(iv.parts.mzk) }) : '', iv.parts.abon > 0.004 ? t('ru_h_abon', { s: money(iv.parts.abon) }) : ''].filter(Boolean).reduce(function (a0, x0, i0, all) { return i0 === all.length - 1 ? t('ru_h_plus', { x: all.join(t('ru_and')) }) : a0; }, ''), iv.skip ? t('paid_skip', { n: iv.skip }) : ''],
        proj: iv.days >= 25 && iv.days <= 37 ? '' : t('rec_per_month', { de: fmtN(iv.dE / iv.days * MONTH_DAYS, 3), cost: money(costOf(iv.dE / iv.days * MONTH_DAYS, MONTH_DAYS).total) }) })) : usedOnly('heat', 'rec-used', vals);
    var st = (r.status === 'handed' || r.status === 'rejected' || r.status === 'accepted') ? '<a class="btn sec" href="#status" data-act="focus" data-id="' + r.id + '">' + esc(t('rec_status')) + '</a>' : '';
    var wxp = wx ? '<div class="panel wx-panel" data-key="rec-weather"><h2>' + ico('thermo', 20) + ' ' + esc(t('wx_title')) + '</h2><div class="wx-tiles">' +
      (wx.avg !== null ? '<div><div class="num big wx-t-' + wxTone(wx.avg) + '">' + esc(degTxt(wx.avg)) + '</div><div class="small muted">' + esc(t('wx_t_avg')) + '</div></div>' +
        '<div><div class="num mid">' + esc(degTxt(wx.min)) + ' … ' + esc(degTxt(wx.max)) + '</div><div class="small muted">' + esc(t('wx_t_range')) + '</div></div>' +
        '<div><div class="num mid">' + wx.frost + ' / ' + wx.ser.length + '</div><div class="small muted">' + esc(t('wx_t_frost')) + '</div></div>' : '') +
      (wx.day !== null ? '<div><div class="num mid">' + esc(degTxt(wx.day)) + '</div><div class="small muted">' + esc(t('wx_t_day')) + '</div></div>' : '') + '</div>' + wxSpark(wx.ser) + '</div>' : '';
    return { screen: 'S09', route: 'history', html: head + used + recPhotos(r.photos, 'h' + r.id, 'h:' + r.id) + wxp + hsprPanel(r, iv) + billsBox('h:' + r.id, r.bills, t('bl_title', { m: monthLabel(String(h.date || '').slice(0, 7)) })) +
      '<div class="row-actions">' + st + '<a class="btn sec" href="#rec-' + r.id + '-edit" data-key="rec-edit">' + esc(t('rec_edit')) + '</a>' +
      '<button class="btn danger" data-act="rec-del-ask" data-key="rec-del">' + esc(t('rec_del')) + '</button></div><div id="rec-del-confirm"></div>' + ownBox('h', r) };
  }

  /** «Платіжка ХТМ» без показань: квитанція (копія сторінки рахунку з кабінету ХТМ), сума до сплати; прибрати запис. */
  function hbillView(r) {
    var pay = hbillPay(r), m = monthLabel(r.ym);
    return { screen: 'S09', route: 'history', html: recBack() + '<h1>' + esc(t('hb_title')) + ' · ' + esc(m) + '</h1>' +
      '<p class="small muted" data-key="hb-sub">' + esc(t('hb_view_sub')) + '</p>' + (pay !== null ? '<p data-key="hb-pay"><b class="num big">' + esc(money(pay)) + '</b> <span class="small muted">грн · ' + esc(t('hb_pay_lbl')) + '</span></p>' : '') +
      billsBox('h:' + r.id, r.bills, t('bl_title', { m: m })) +
      '<div class="row-actions"><button class="btn danger" data-act="rec-del-ask" data-key="rec-del">' + esc(t('rec_del')) + '</button></div><div id="rec-del-confirm"></div>' };
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
    var St = window.TeploStats; loadWeather(); hsprLoad();
    var w = WX.days, ivs = St.intervals(RD(), S.baseline, w, tariff(), gaps('heat')), cl = St.coolant(RD(), S.baseline, w);
    ivs.forEach(function (it) { it.cost = +costOf(it.dE, it.days, it.to).total.toFixed(2); });
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
    var upd = '<p class="small muted">' + esc(ru ? 'Редакция от 07.11.2026' : 'Редакція від 07.11.2026') + '</p>';
    var ccBtn = window.TEPLO_API ? '<p><button type="button" class="btn sec" data-act="cc-open" data-key="privacy-cookie">' + ico('prefs', 18) + '<span>' + esc(t('cc_link')) + '</span></button></p>' : '';
    var fb = '<button class="linkbtn" data-act="fb-open">' + esc(ru ? '«Отзыв»' : '«Відгук»') + '</button>';
    if (kind === 'privacy') return '<h1>' + esc(t('lg_privacy')) + '</h1>' + upd + (ru ? [
      sec('Кратко', P('«Счётчики» помогают снять показания квартирных счётчиков тепла, воды, света и газа и подготовить их для КП «Харьковские тепловые сети» (ХТМ), КП «Харківводоканал», АО «Харьковоблэнерго», «Газсетей» и «Нафтогаза». Мы собираем минимум данных, не продаём их и не передаём для рекламы. Сервис не связан с этими поставщиками. Сам он передаёт показания, когда вы нажмёте «Отправить», «Отправить в фоне» или «Внести» (на сайт Водоканала и — если вы подключили свой кабинет ХТМ — в этот кабинет), или после фото в бот — только если вы сами включили автоотправку.')),
      sec('Какие данные', UL(['Без входа — показания, счётчик, адреса квартир и настройки хранятся только в вашем браузере.', 'После входа — e-mail (пароль хранится только в виде хеша) или ваш Telegram ID и имя, а также те же данные для синхронизации между устройствами.', 'Фото счётчика при распознавании: распознаются прямо в браузере; копия фото и результат хранятся на сервере до 90 дней, чтобы улучшать распознавание (тестовая версия), — у вошедших, а без входа — только если вы разрешили аналитику.', 'Документы счётчика (паспорт, поверка), если вы их загрузили, — до удаления вами.', 'Отзывы и контакт, который вы указали в отзыве.', 'Технические журналы сервера (IP-адрес, время запроса) — для безопасности, недолго.', 'Только с вашего согласия (баннер «Файлы cookie»): обезличенная статистика — случайный номер браузера, какие экраны открывали и что нажимали (без значений полей, показаний и паролей), ошибки, тип устройства и ширина экрана.'])),
      sec('Кабинеты поставщиков: доступы и согласие (если подключите)', UL(['Храним доступ к кабинету ХТМ — e-mail и пароль — и запись о вашем согласии на обработку персональных данных (дата и текст согласия) — только если вы сами подключили кабинет, и пока вы его не отключите. Пароль хранится на сервере зашифрованным (AES-256), ключ — отдельно от базы данных; в журналах сервера пароля нет.', 'Робот входит в кабинет только чтобы внести показания тепла по вашему нажатию «Внести», потом проверить журнал ХТМ (несколько раз в течение 6 часов) и взять квитанцию (см. ниже). Ничего другого в кабинете не меняет.', 'Квитанции ХТМ (если кабинет подключён и в квартире есть запись тепла за прошлый месяц): раз в сутки, с 7 до 22, сервер сам входит в кабинет — только чтобы взять квитанцию, ничего не вносит, — и прикрепляет её к записи тепла за тот месяц. Выключить — «Настройки» → «Кабинеты и автоотправка» → «Квитанции сами» в блоке ХТМ.', 'Автоподача (только если вы сами включили её на экране «Кабинет ХТМ»): после фото экранов в наш бот и кнопки «Распознать и внести» робот вносит показания сам — только когда все значения прочитаны уверенно и проверки пройдены; за 10 минут до внесения пишем вам в Telegram, и внесение можно отменить. Выключить можно в любой момент.', 'Телефон и e-mail вместе с показаниями получает ХТМ — этого требует их форма.', 'Сайт Водоканала: лицевой счёт и фамилию берём из ваших настроек воды. Для «Отправить в фоне» и автоотправки они лежат на сервере (фамилия — зашифрованной) только до конца отправки, потом стираются. Согласие на автоотправку воды (с датой) храним, пока вы его не отзовёте.', 'Квитанции Водоканала (если в квартире вписаны лицевой счёт и фамилия): каждый месяц с 1-го по 25-е сервер сам входит на сайт Водоканала с ними — только чтобы взять квитанцию, ничего не вносит, — и прикрепляет её к записи воды за прошлый месяц. Выключить — «Настройки» → «Кабинеты и автоотправка» → «Квитанции сами».', 'Отключить кабинет, выключить автоотправку или отозвать согласие — «Настройки» → «Кабинеты и автоотправка»; «Забыть пароль» на экране «Кабинет ХТМ» и «Удалить все данные» удаляют пароль и согласие с сервера сразу.'])),
      sec('Зачем', UL(['чтобы сервис работал: проверка показаний, история, синхронизация, вход;', 'чтобы улучшать распознавание фото и исправлять ошибки;', 'с вашего согласия — чтобы видеть, где интерфейс неудобен и где возникают ошибки;', 'чтобы ответить на ваш отзыв.'])),
      sec('Кто ещё получает данные', UL(['Хостинг: сервер Hetzner (Германия, ЕС) за Cloudflare (защита и доставка).', 'Telegram — если вы входите через Telegram.', 'Open-Meteo — получает только координаты Харькова для погоды, без ваших данных.', 'Anthropic (Claude) — только если владелец включит серверное распознавание: тогда фото вошедших отправляются на распознавание.'])),
      sec('Файлы cookie', UL(['<b>Необходимые</b> (всегда): ts_sid — сессия входа, 30 дней; ts_csrf — защита от подделки запросов, 1 год; данные приложения в памяти браузера (localStorage) — показания и настройки, пока вы их не удалите; служебные cookie Cloudflare — защита от атак.', '<b>Аналитика</b> (только если вы разрешили): teplo.vid — случайный номер браузера в localStorage; журнал действий хранится на сервере 60 дней, отметки «открыли сайт» (устройство, система, ширина экрана) — 12 месяцев. Видит только команда сервиса, не передаём никому.', 'Рекламы и чужих трекеров нет.', 'При первом визите сайт спрашивает: «Принять все», «Отклонить» или «Настроить». Пока вы не ответили, аналитика не пишется. Ваш выбор (без IP) записываем на сервере — так видно, что согласие было. Изменить или отозвать — в любой момент: кнопка ниже, «Настройки» внизу страницы или «Настройки cookie» в подвале сайта.']) + ccBtn),
      sec('Ваши права', P('По Закону Украины «О защите персональных данных» вы можете узнать, какие данные о вас хранятся, исправить или удалить их. «Настройки» → «Удалить все данные» стирает данные с устройства и из аккаунта; фото и документы удаляются вместе с аккаунтом. Вопросы — через кнопку ' + fb + '.'))
    ] : [
      sec('Коротко', P('«Лічильники» допомагають зняти показання квартирних лічильників тепла, води, світла й газу та підготувати їх для КП «Харківські теплові мережі» (ХТМ), КП «Харківводоканал», АТ «Харківобленерго», «Газмереж» і «Нафтогазу». Ми збираємо мінімум даних, не продаємо їх і не передаємо для реклами. Сервіс не пов’язаний із цими постачальниками. Сам він передає показання, коли ви натиснете «Відправити», «Відправити у фоні» чи «Внести» (на сайт Водоканалу і — якщо ви підключили свій кабінет ХТМ — у цей кабінет), або після фото в бот — лише якщо ви самі ввімкнули автовідправку.')),
      sec('Які дані', UL(['Без входу — показання, лічильник, адреси квартир і налаштування зберігаються лише у вашому браузері.', 'Після входу — e-mail (пароль зберігається лише як геш) або ваш Telegram ID та ім’я, а також ті самі дані для синхронізації між пристроями.', 'Фото лічильника під час розпізнавання: розпізнаються просто в браузері; копія фото й результат зберігаються на сервері до 90 днів, щоб покращувати розпізнавання (тестова версія), — у тих, хто увійшов, а без входу — лише якщо ви дозволили аналітику.', 'Документи лічильника (паспорт, повірка), якщо ви їх завантажили, — доки ви їх не видалите.', 'Відгуки й контакт, який ви вказали у відгуку.', 'Технічні журнали сервера (IP-адреса, час запиту) — для безпеки, недовго.', 'Лише з вашої згоди (банер «Файли cookie»): знеособлена статистика — випадковий номер браузера, які екрани відкривали й що натискали (без значень полів, показань і паролів), помилки, тип пристрою й ширина екрана.'])),
      sec('Кабінети постачальників: доступи й згода (якщо підключите)', UL(['Зберігаємо доступ до кабінету ХТМ — e-mail і пароль — та запис про вашу згоду на обробку персональних даних (дата й текст згоди) — лише якщо ви самі підключили кабінет, і доки ви його не відключите. Пароль зберігається на сервері зашифрованим (AES-256), ключ — окремо від бази даних; у журналах сервера пароля немає.', 'Робот входить у кабінет лише щоб внести показання тепла за вашим натисканням «Внести», потім перевірити журнал ХТМ (кілька разів протягом 6 годин) і взяти квитанцію (див. нижче). Нічого іншого в кабінеті не змінює.', 'Квитанції ХТМ (якщо кабінет підключено і в квартирі є запис тепла за минулий місяць): раз на добу, з 7 до 22, сервер сам заходить у кабінет — лише щоб узяти квитанцію, нічого не вносить, — і прикріплює її до запису тепла за той місяць. Вимкнути — «Налаштування» → «Кабінети й автовідправка» → «Квитанції самі» в блоці ХТМ.', 'Автоподача (лише якщо ви її самі ввімкнули на екрані «Кабінет ХТМ»): після фото екранів у наш бот і кнопки «Розпізнати й внести» робот вносить показання сам — лише коли всі значення прочитано впевнено й перевірки пройдено; за 10 хвилин до внесення пишемо вам у Telegram, і внесення можна скасувати. Вимкнути можна будь-коли.', 'Телефон і e-mail разом із показаннями отримує ХТМ — цього вимагає їхня форма.', 'Сайт Водоканалу: особовий рахунок і прізвище беремо з ваших налаштувань води. Для «Відправити у фоні» й автовідправки вони лежать на сервері (прізвище — зашифрованим) лише до кінця надсилання, потім стираються. Згоду на автовідправку води (з датою) зберігаємо, доки ви її не відкличете.', 'Квитанції Водоканалу (якщо в квартирі вписано особовий рахунок і прізвище): щомісяця з 1-го по 25-те сервер сам заходить з ними на сайт Водоканалу — лише щоб узяти квитанцію, нічого не вносить, — і прикріплює її до запису води за минулий місяць. Вимкнути — «Налаштування» → «Кабінети й автовідправка» → «Квитанції самі».', 'Відключити кабінет, вимкнути автовідправку чи відкликати згоду — «Налаштування» → «Кабінети й автовідправка»; «Забути пароль» на екрані «Кабінет ХТМ» і «Видалити всі дані» видаляють пароль і згоду з сервера одразу.'])),
      sec('Навіщо', UL(['щоб сервіс працював: перевірка показань, історія, синхронізація, вхід;', 'щоб покращувати розпізнавання фото й виправляти помилки;', 'з вашої згоди — щоб бачити, де інтерфейс незручний і де виникають помилки;', 'щоб відповісти на ваш відгук.'])),
      sec('Хто ще отримує дані', UL(['Хостинг: сервер Hetzner (Німеччина, ЄС) за Cloudflare (захист і доставка).', 'Telegram — якщо ви входите через Telegram.', 'Open-Meteo — отримує лише координати Харкова для погоди, без ваших даних.', 'Anthropic (Claude) — лише якщо власник увімкне серверне розпізнавання: тоді фото тих, хто увійшов, надсилаються на розпізнавання.'])),
      sec('Файли cookie', UL(['<b>Необхідні</b> (завжди): ts_sid — сесія входу, 30 днів; ts_csrf — захист від підробки запитів, 1 рік; дані застосунку в пам’яті браузера (localStorage) — показання й налаштування, доки ви їх не видалите; службові cookie Cloudflare — захист від атак.', '<b>Аналітика</b> (лише якщо ви дозволили): teplo.vid — випадковий номер браузера в localStorage; журнал дій зберігається на сервері 60 днів, позначки «відкрили сайт» (пристрій, система, ширина екрана) — 12 місяців. Бачить лише команда сервісу, нікому не передаємо.', 'Реклами й чужих трекерів немає.', 'Під час першого візиту сайт питає: «Прийняти все», «Відхилити» чи «Налаштувати». Доки ви не відповіли, аналітика не пишеться. Ваш вибір (без IP) записуємо на сервері — так видно, що згода була. Змінити чи відкликати — будь-коли: кнопка нижче, «Налаштування» внизу сторінки чи «Налаштування cookie» в підвалі сайту.']) + ccBtn),
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
    // опис — про свій вид (владелец 10.11: у газу було «тепло й вода окремо»)
    var bk = ref.charAt(0) === 'h' ? 'heat' : ref.charAt(0) === 'w' ? 'water' : '', bm = ref.charAt(0) === 'm' ? ((S.mrecs || []).filter(function (x) { return x && x.id === ref.slice(2); })[0] || {}).meter : null;
    if (bm) bk = (smeterById(bm) || {}).kind || '';
    h += '<p class="small muted" data-key="bl-sub">' + esc(t('bl_sub', { k: bk === 'heat' || bk === 'water' || bk === 'elec' || bk === 'gas' ? t('bl_for_' + bk) : '' })) + '</p>';
    if (list.length) h += '<ul class="docs bcards">' + list.map(function (b, i) { return billCard(ref, b, i, busy); }).join('') + '</ul>';
    // квитанція ХТМ (з 11.2025): тепло наперед до кінця місяця і зняте за попередній — чому «до сплати» не дорівнює теплу за показаннями
    var hp = list.filter(function (b) { return b.auto === 'htm' && R.num(b.pre) > 0; })[0];
    if (hp) h += '<p class="small muted" data-key="hb-pre-why">' + esc(t('hb_pre_why', { p: money(R.num(hp.pre)), u: money(Math.abs(R.num(hp.unpre) || 0)) })) + '</p>';
    return h + '<input type="file" id="bill-input" class="sr" tabindex="-1" multiple aria-label="' + esc(t('bl_add')) + '" accept="image/jpeg,image/png,image/webp,image/heic,application/pdf">' +
      '<button type="button" class="btn sec" data-act="bill-add" data-ref="' + esc(ref) + '" data-key="bill-add"' + (busy ? ' disabled' : '') + '>' + ico('plus', 18) + '<span>' + esc(t(list.length ? 'bl_add_more' : 'bl_add')) + '</span></button>' +
      (busy ? '<p class="small muted up-busy" role="status">' + SPIN + '<span>' + esc(t('mv_uploading')) + '</span></p>' : '') + '</section>';
  }
  /** Превью платіжки (власник 09.11: «оформи красиво, найважливіше — одразу на превью»). Квитанція з кабінету (ХТМ, Водоканал): «До сплати» великим,
   *  під ним — з чого складається (тепло й гаряча вода за місяць, тепло наперед, зняте за попередній), відкрити — вся квитанція. Фото — аркуш-мініатюра
   *  (торкнутися — на весь екран), PDF — аркуш із загнутим кутом; підпис — місяць, звідки, дата, розмір. */
  function billCard(ref, b, i, busy) {
    var url = window.TEPLO_API + '/docs/file?id=' + b.id, page = b.mime === 'text/html', img = b.mime !== 'application/pdf' && !page, n = function (k) { return R.num(b[k]); };
    var src = b.auto === 'vk' ? t('bl_auto_vk') : b.auto === 'htm' ? t('bl_auto_htm') : '', when = b.at ? fmtDate(String(b.at).slice(0, 10), true) : '';
    var del = '<button type="button" class="linkbtn bc-del" data-act="bill-del" data-ref="' + esc(ref) + '" data-id="' + esc(b.id) + '"' + (busy ? ' disabled' : '') + '>' + esc(t('rec_del')) + '</button>';
    var open = function (cls, inner, lbl) { return '<a class="' + cls + '" href="' + esc(url) + '" target="_blank" rel="noopener" data-act="bill-open" data-id="' + esc(b.id) + '" aria-label="' + esc(t('mv_open') + ': ' + lbl) + '">' + inner + '</a>'; };
    var title = b.auto && b.ym ? t(b.auto === 'vk' ? 'bc_vk' : 'bc_htm') : img ? t('bl_photo') : (b.name || 'PDF'), sub = [b.auto && b.ym ? monthLabel(b.ym) : '', src].filter(Boolean).join(' · ');
    var pay = n('pay');
    if (b.auto && (pay !== null || page)) {
      var rows = [['heatM', 'bc_heat'], ['hotM', 'bc_hot'], ['pre', 'bc_pre'], ['unpre', 'bc_unpre']].filter(function (x) { return n(x[0]) !== null && Math.abs(n(x[0])) >= 0.005; })
        .map(function (x) { return '<div class="bc-row"><span>' + esc(t(x[1])) + '</span><b class="num">' + (x[0] === 'unpre' ? '−' : '') + esc(money(x[0] === 'unpre' ? Math.abs(n(x[0])) : n(x[0]))) + '</b></div>'; }).join('');
      return '<li class="bcard bc-auto" data-key="bill-' + esc(b.id) + '">' + open('bc-head', '<span class="bc-badge' + (b.auto === 'vk' ? ' vk' : '') + '" aria-hidden="true">' + (b.auto === 'vk' ? 'ВК' : 'ХТМ') + '</span><span class="bc-t"><b class="bill-name">' + esc(title) + '</b><span class="small muted">' + esc(sub) + '</span></span>' + ico('chev', 20, 'bc-go'), title) +
        (pay !== null ? '<div class="bc-pay"><span class="small">' + esc(t('bc_pay')) + '</span><b class="num">' + esc(money(pay)) + ' <small>грн</small></b></div>' : '') +
        (rows ? '<div class="bc-rows">' + rows + '</div>' : '') + '<div class="bc-foot small muted"><span>' + esc(when) + '</span>' + del + '</div></li>';
    }
    var th = img ? '<span class="bc-paper"><img src="' + esc(url) + '" data-gal="b' + esc(ref) + '" alt="' + esc(t('bl_img', { n: i + 1 })) + '" loading="lazy"></span>'
      : open('bc-paper pdf', '<span class="bc-fold" aria-hidden="true"></span><span class="bc-lines" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="pdf">' + (page ? 'ХТМ' : 'PDF') + '</span>', b.name || 'PDF');
    return '<li class="bcard" data-key="bill-' + esc(b.id) + '">' + th + '<div class="grow bc-meta"><b class="bill-name">' + esc(title) + '</b>' + (sub ? '<span class="small muted">' + esc(sub) + '</span>' : '') +
      (pay !== null ? '<span class="bc-pay-s">' + esc(t('hb_pay', { s: money(pay) })) + '</span>' : '') +
      '<span class="small muted">' + esc([when, Math.max(1, Math.round((b.bytes || 0) / 1024)) + ' КБ'].filter(Boolean).join(' · ')) + '</span>' + del + '</div></li>';
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
      .then(function (j) { DOCS.loading = false; DOCS.list = (j && j.docs) || []; if (routeName() === 'prefs' || /^place-/.test(routeName())) safeRender(); }, function () { DOCS.loading = false; });
  }
  /** Документи квартири до лічильника mid (heat | id водоміра, світла, газу); старі — без лічильника — до теплолічильника. */
  function docsOf(mid) {
    return (DOCS.list || []).filter(function (d) { return d.kind !== 'bill' && (d.meter ? d.meter === mid : mid === 'heat'); })
      .filter(function (d) { return d.place === S.placeId || (!place(d.place) && S.placeId === (places()[0] || {}).id); });
  }
  /** «Фото документів» у налаштуваннях лічильника на екрані квартири (владелец 10.11: «доки можно было прикреплять»): паспорт, повірка — до кожного лічильника. */
  function mdocs(mid) {
    if (!window.TEPLO_API) return '';
    var h = '<div class="mdocs" data-key="mdocs-' + esc(mid) + '"><h4 class="mp-h">' + esc(t('mv_docs')) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></h4>';
    if (!Y().account) return h + '<p class="small muted">' + esc(t('mv_docs_login')) + '</p></div>';
    loadDocs();
    var mine = docsOf(mid);
    h += '<p class="small muted">' + esc(t('mv_docs_sub')) + '</p>' + (mine.length ? '<ul class="docs">' + mine.map(function (d) {
      var url = window.TEPLO_API + '/docs/file?id=' + d.id, img = d.mime !== 'application/pdf';
      return '<li><a href="' + esc(url) + '" target="_blank" rel="noopener" class="doc-th" aria-label="' + esc(t('mv_open') + ': ' + t('mv_kind_' + d.kind)) + '">' + (img ? '<img src="' + esc(url) + '" alt="" loading="lazy">' : '<span class="pdf">PDF</span>') + '</a>' +
        '<div class="grow"><b>' + esc(t('mv_kind_' + d.kind)) + '</b><div class="small muted">' + esc(R.toHtmDate(String(d.createdAt).slice(0, 10))) + '</div></div>' +
        '<button class="linkbtn" data-act="doc-del" data-id="' + esc(d.id) + '">' + esc(t('rec_del')) + '</button></li>';
    }).join('') + '</ul>' : '');
    var busyHere = DOCS.busy && DOCS.meter === mid;
    return h + '<div class="row-actions mdocs-act"><button class="btn sec sm" data-act="doc-add" data-kind="passport" data-meter="' + esc(mid) + '"' + (DOCS.busy ? ' disabled' : '') + ' data-key="mdoc-pass-' + esc(mid) + '">' + ico('camera', 18) + '<span>' + esc(t('mv_add_passport')) + '</span></button>' +
      '<button class="btn sec sm" data-act="doc-add" data-kind="verification" data-meter="' + esc(mid) + '"' + (DOCS.busy ? ' disabled' : '') + ' data-key="mdoc-ver-' + esc(mid) + '">' + ico('camera', 18) + '<span>' + esc(t('mv_add_ver')) + '</span></button></div>' +
      (busyHere ? '<p class="small muted up-busy" role="status">' + SPIN + '<span>' + esc(t('mv_uploading')) + '</span></p>' : '') + '</div>';
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
    var mine = docsOf('heat');
    h += '<h3>' + esc(t('mv_docs')) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></h3><p class="small muted">' + esc(t('mv_docs_sub')) + '</p>';
    h += mine.length ? '<ul class="docs">' + mine.map(function (d) {
      var url = window.TEPLO_API + '/docs/file?id=' + d.id, img = d.mime !== 'application/pdf';
      return '<li><a href="' + esc(url) + '" target="_blank" rel="noopener" class="doc-th" aria-label="' + esc(t('mv_open') + ': ' + t('mv_kind_' + d.kind)) + '">' + (img ? '<img src="' + esc(url) + '" alt="" loading="lazy">' : '<span class="pdf">PDF</span>') + '</a>' +
        '<div class="grow"><b>' + esc(t('mv_kind_' + d.kind)) + '</b><div class="small muted">' + esc(R.toHtmDate(String(d.createdAt).slice(0, 10))) + ' · ' + Math.max(1, Math.round(d.bytes / 1024)) + ' КБ</div></div>' +
        '<button class="linkbtn" data-act="doc-del" data-id="' + esc(d.id) + '">' + esc(t('rec_del')) + '</button></li>';
    }).join('') + '</ul>' : (DOCS.list ? '<p class="small muted">' + esc(t('mv_docs_none')) + '</p>' : '');
    h += '<input type="file" id="doc-input" class="sr" aria-label="' + esc(t('mv_docs')) + '" tabindex="-1" accept="image/jpeg,image/png,image/webp,application/pdf">' +
      '<div class="row-actions" style="margin-top:8px"><button class="btn sec" data-act="doc-add" data-kind="passport" data-meter="heat"' + (DOCS.busy ? ' disabled' : '') + '>' + ico('camera', 18) + '<span>' + esc(t('mv_add_passport')) + '</span></button>' +
      '<button class="btn sec" data-act="doc-add" data-kind="verification" data-meter="heat"' + (DOCS.busy ? ' disabled' : '') + '>' + ico('camera', 18) + '<span>' + esc(t('mv_add_ver')) + '</span></button></div>' +
      (DOCS.busy ? '<p class="small muted up-busy" role="status">' + SPIN + '<span>' + esc(t('mv_uploading')) + '</span></p>' : DOCS.loading && !DOCS.list ? '<p class="small muted up-busy" role="status">' + SPIN + '</p>' : '');
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
    if (p.waste && p.waste.on) ks.push(t('kv_waste'));
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
      if (wasteOn()) rows.push(Object.assign({ kind: 'waste', title: t('kd_waste'), pay: true }, wasteStatus()));
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
  /** Картка лічильника на екрані квартири (владелец 10.11: «заменить и удалить яснее»): шапка — відкрити лічильник; «Налаштування лічильника» —
   *  лише сам лічильник (назва, №, повірка, модель, зони); внизу дві рівні кнопки з рамкою: «Замінити» і «Прибрати» (червона). */
  function mrow(o) {
    return '<li class="mrow mk-' + o.kind + '" data-key="pv-m-' + esc(o.what) + '"><a class="mrow-main" href="#' + o.href + '">' + ico(KINDS[o.kind].icon, 22, KINDS[o.kind].cls) + '<span class="grow"><b>' + esc(o.title) + '</b>' + (o.sub ? '<span class="small muted">' + esc(o.sub) + '</span>' : '') + '</span>' + ico('chev', 20) + '</a>' +
      (o.set ? '<details class="mbox-set mrow-set" id="mbs-' + esc(o.what) + '"' + (MB_OPEN[o.what] ? ' open' : '') + ' data-key="pv-set-' + esc(o.what) + '"><summary>' + ico('prefs', 18, 'bt-ico') + '<span>' + esc(o.setTitle || t('mb_set')) + '</span>' + ico('chev', 18, 'pacc-chev') + '</summary><div class="mbox-set-b">' + o.set + '</div></details>' : '') +
      '<div class="mrow-act' + (o.noReplace ? ' one' : '') + '">' + (o.noReplace ? '' : '<button type="button" class="btn sec sm" data-act="m-replace" data-what="' + esc(o.what) + '" data-key="pv-replace-' + esc(o.what) + '">' + ico('swap', 18) + '<span>' + esc(t('mr_replace')) + '</span></button>') +
      '<button type="button" class="btn danger sm" data-act="m-remove" data-what="' + esc(o.what) + '" data-key="pv-remove-' + esc(o.what) + '">' + ico('trash', 18) + '<span>' + esc(t('mr_remove')) + '</span></button></div></li>';
  }
  function verTxt(v) { return v ? t('pl_ver', { d: R.toHtmDate(v) }) : ''; }
  /** Під табло лічильника — без дати повірки (владелец 09.11: «убери даты поверки из карточек»), лише попередження: прострочена або ≤ 60 днів. Дата — у налаштуваннях. */
  function verWarn(v) {
    var days = v ? R.daysBetween(today(), v) : null; if (days === null || days > 60) return '';
    return '<span class="pill warn" data-key="mb-ver-warn">' + esc(days < 0 ? t('wm_ver_exp') : t('mb_ver_soon', { n: days })) + '</span>';
  }
  // ---------- адреса квартири: населений пункт з підказкою + вулиця, будинок, квартира (61-а сесія, владелец 08.11) ----------
  // p.city = {n, h, r, c, hromada, district, oblast} — обраний зі списку пункт (КАТОТТГ: Харківщина, Київщина, Київ, Одещина, Львівщина);
  // p.street — «вул. Сумська, 10, кв. 61»; p.address — разом, як і було («м. Харків, вул. Сумська, 10, кв. 61»): графік відключень, довідник,
  // підпис квартири; p.settle — точний пункт для довідника (без «Уточніть»). Нова квартира — з пунктом першої (Харків → Харків, Львів → Львів).
  var AF = {}, SUG = {};
  function afPre(c) { return c === 'M' ? 'м. ' : c === 'X' ? 'селище ' : c === 'C' ? 'с. ' : ''; }
  function afCity(x) { return x && x.n && x.h ? { n: String(x.n), h: String(x.h), r: String(x.r || 'kh'), c: String(x.c || x.kind || ''), hromada: String(x.hromada || ''), district: String(x.district || ''), oblast: String(x.oblast || '') } : null; }
  function afWhere(c) { return c.r === 'ky' ? t('af_where_ky') : t('af_where', { k: kindWord(c.c), h: c.hromada, d: c.district, o: c.oblast }); }
  /** Скелет назви для грубого порівняння (укр./рос.): Харків = Харьков, Львів = Львов. */
  function afSk(s) { return String(s || '').toLowerCase().replace(/[’ʼ'`"«»]/g, '').replace(/ё/g, 'е').replace(/[іїйиы]/g, 'и').replace(/[єэ]/g, 'е').replace(/ґ/g, 'г').replace(/ь/g, '').replace(/^(м|г|с|смт|селище|село|місто|город|пгт|с-ще)\.?\s+/, '').replace(/(ов|ев|ив)$/, 'ив').trim(); }
  /** Пункт квартири: обраний (p.city) або знайдений довідником за старою адресою одним рядком. */
  function cityOf(p) {
    if (!p) return null; if (p.city && p.city.n) return afCity(p.city);
    if (!String(p.address || '').trim()) return null;
    var j = prvLoad(p); return j && j.found && j.place ? afCity(j.place) : null;
  }
  /** Вулиця квартири: p.street або стара адреса без назви пункту, області, району й громади. */
  function streetOf(p, c) {
    if (!p) return ''; if (p.city && p.city.n) return String(p.street || '');
    var parts = String(p.address || '').split(','), sk = c ? afSk(c.n) : '';
    return parts.filter(function (x) {
      var s = x.trim(), k = afSk(s); if (!s) return false;
      if (/(^|\s)(обл|область|р-н|район|громада|тг|україна|украина)(\.|\s|$)/i.test(s) || /^\d{5}$/.test(s)) return false;
      return !(sk && k && (k === sk || (k.length >= 4 && sk.indexOf(k.slice(0, 4)) === 0 && Math.abs(k.length - sk.length) <= 3)));
    }).map(function (x) { return x.trim(); }).join(', ');
  }
  /** Пункт за замовчуванням для нової квартири — з першої квартири, де він відомий. */
  function cityDefault() { var ps = places(); for (var i = 0; i < ps.length; i++) { var c = cityOf(ps[i]); if (c) return { city: c, from: ps[i] }; } return null; }
  function afCompose(c, typed, street) {
    var head = c ? afPre(c.c) + c.n : String(typed || '').trim(); street = String(street || '').trim();
    return (head && street ? head + ', ' + street : head || street).slice(0, 120);
  }
  /** Поля адреси. pfx — префікс id; o = {city, typed, street, live (зберігати одразу в поточну квартиру), hint (рядок під пунктом)}. */
  function addrFields(pfx, o) {
    var c = afCity(o.city); AF[pfx] = { city: c, items: [], act: -1, q: '', live: !!o.live, busy: false, r0: c ? c.r : '' };
    var val = c ? c.n : String(o.typed || '');
    return '<div class="addr-f" data-af="' + pfx + '" data-key="af-' + pfx + '">' +
      '<div class="field af-city"><label for="' + pfx + '-city">' + esc(t('af_city')) + '</label><div class="ctl"><input id="' + pfx + '-city" data-acity="' + pfx + '" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="' + pfx + '-cl" aria-describedby="' + pfx + '-where" autocomplete="off" autocapitalize="words" spellcheck="false" maxlength="60" value="' + esc(val) + '" placeholder="' + esc(t('af_city_ph')) + '"></div>' +
      '<ul class="af-list" id="' + pfx + '-cl" role="listbox" aria-label="' + esc(t('af_list')) + '" hidden></ul>' +
      '<p class="small af-where' + (c ? ' ok' : '') + '" id="' + pfx + '-where" aria-live="polite">' + (c ? ico('check', 16) + '<span>' + esc(afWhere(c)) + '</span>' : esc(val ? t('af_pick') : '')) + '</p>' + (o.hint ? '<p class="small muted af-hint">' + esc(o.hint) + '</p>' : '') + '</div>' +
      '<div class="field"><label for="' + pfx + '-street">' + esc(t('af_street')) + '</label><div class="ctl"><input id="' + pfx + '-street" data-astreet="' + pfx + '" maxlength="100" autocomplete="street-address" value="' + esc(o.street || '') + '" placeholder="' + esc(t('af_street_ph')) + '"></div></div></div>';
  }
  /** Поля квартири p (екран квартири, «Назва й адреса» на головній). */
  function addrFieldsFor(pfx, p, live) {
    var c = cityOf(p), d = !c && !String((p && p.address) || '').trim() ? cityDefault() : null;
    return addrFields(pfx, { city: c || (d && d.city), typed: c ? '' : '', street: streetOf(p, c), live: live, hint: d && d.from !== p ? t('af_default', { p: placeLabel(d.from) }) : '' });
  }
  /** Що в полях: {city|null, typed, street}. Набрали назву без вибору — беремо точний збіг зі списку, якщо він один. */
  function addrRead(pfx) {
    var st = AF[pfx], ci = document.getElementById(pfx + '-city'), si = document.getElementById(pfx + '-street'); if (!st || !ci) return null;
    var typed = String(ci.value || '').trim(), c = st.city && afSk(st.city.n) === afSk(typed) ? st.city : null;
    if (!c && typed) { var ex = st.items.filter(function (x) { return afSk(x.n) === afSk(typed); }); if (ex.length === 1 || (ex.length > 1 && ex[0].c === 'M' && ex[1].c !== 'M')) c = afCity(ex[0]); }
    return { city: c, typed: c ? '' : typed, street: si ? String(si.value || '').trim().slice(0, 100) : '' };
  }
  /** Записати адресу в квартиру: пункт, вулиця, рядок адреси й точний пункт для довідника. */
  function addrApply(p, a) {
    if (!p || !a) return false;
    var addr = afCompose(a.city, a.typed, a.street), was = [p.address || '', JSON.stringify(p.city || null), p.street || ''].join('|');
    if (a.city) { p.city = a.city; p.street = a.street; p.settle = { a: addr, n: a.city.n, h: a.city.h }; }
    else { delete p.city; delete p.street; if (!p.settle || p.settle.a !== addr) delete p.settle; }
    p.address = addr;
    if (was === [p.address, JSON.stringify(p.city || null), p.street || ''].join('|')) return false;
    p.updatedAt = Date.now(); return true;
  }
  function afPaint(pfx) {
    var st = AF[pfx], ul = document.getElementById(pfx + '-cl'), ci = document.getElementById(pfx + '-city'), w = document.getElementById(pfx + '-where'); if (!st || !ul || !ci) return;
    var open = document.activeElement === ci && st.items.length > 0 && !(st.city && afSk(st.city.n) === afSk(ci.value));
    ul.innerHTML = st.items.map(function (x, i) {
      var c = afCity(x);
      return '<li role="option" id="' + pfx + '-o' + i + '" class="af-opt' + (i === st.act ? ' act' : '') + '" aria-selected="' + (i === st.act) + '" data-aopt="' + pfx + '" data-i="' + i + '"><b>' + esc(afPre(c.c) + c.n) + '</b><span class="small muted">' + esc(afWhere(c)) + '</span></li>';
    }).join('');
    ul.hidden = !open; ci.setAttribute('aria-expanded', String(open));
    if (open && st.act >= 0) ci.setAttribute('aria-activedescendant', pfx + '-o' + st.act); else ci.removeAttribute('aria-activedescendant');
    if (w) {
      var v = String(ci.value || '').trim(), c0 = st.city && afSk(st.city.n) === afSk(v) ? st.city : null;
      w.className = 'small af-where' + (c0 ? ' ok' : v && !st.busy && !st.items.length && st.q === v ? ' bad' : '');
      w.innerHTML = c0 ? ico('check', 16) + '<span>' + esc(afWhere(c0)) + '</span>' : esc(!v ? '' : st.busy ? t('af_busy') : st.q === v && !st.items.length ? t('af_none') : t('af_pick'));
    }
  }
  var AF_T = 0;
  function afSuggest(pfx) {
    var st = AF[pfx], ci = document.getElementById(pfx + '-city'); if (!st || !ci) return;
    var q = String(ci.value || '').trim(); clearTimeout(AF_T);
    if (q.length < 2 || !window.TEPLO_API) { st.items = []; st.act = -1; st.q = q; st.busy = false; afPaint(pfx); return; }
    var d = st.r0 ? null : cityDefault(), r = st.r0 || (d ? d.city.r : '') || 'kh', sk = q + '|' + r;   // свій регіон — першим; невідомо — Харківщина (звідси більшість)
    if (SUG[sk]) { st.items = SUG[sk]; st.q = q; st.act = -1; st.busy = false; afPaint(pfx); return; }
    st.busy = true; afPaint(pfx);
    AF_T = setTimeout(function () {
      fetch(window.TEPLO_API + '/places/suggest?q=' + encodeURIComponent(q) + '&r=' + r, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (x) { return x.json(); })
        .then(function (j) { SUG[sk] = (j && j.items) || []; if (AF[pfx] !== st) return; var cur = document.getElementById(pfx + '-city'); if (cur && String(cur.value).trim() === q) { st.items = SUG[sk]; st.q = q; st.act = -1; st.busy = false; afPaint(pfx); } },
          function () { st.busy = false; st.q = q; afPaint(pfx); });
    }, 200);
  }
  function afPick(pfx, i) {
    var st = AF[pfx], x = st && st.items[i], ci = document.getElementById(pfx + '-city'); if (!x || !ci) return;
    st.city = afCity(x); st.act = -1; ci.value = st.city.n; afPaint(pfx);
    var si = document.getElementById(pfx + '-street');
    if (st.live) { ensurePlaces(); if (addrApply(place(), addrRead(pfx))) { save(); render(true); si = document.getElementById(pfx + '-street'); } }
    if (si) si.focus();
  }
  document.addEventListener('input', function (e) {
    var el = e.target, pfx = el && el.getAttribute && (el.getAttribute('data-acity') || el.getAttribute('data-astreet')); if (!pfx || !AF[pfx]) return;
    if (el.getAttribute('data-acity')) { var st0 = AF[pfx]; if (st0.city && afSk(st0.city.n) !== afSk(el.value)) st0.city = null; afSuggest(pfx); }
    if (AF[pfx].live) { ensurePlaces(); if (addrApply(place(), addrRead(pfx))) save(); }
  });
  document.addEventListener('keydown', function (e) {
    var el = e.target, pfx = el && el.getAttribute && el.getAttribute('data-acity'), st = pfx && AF[pfx]; if (!st) return;
    var ul = document.getElementById(pfx + '-cl'), open = ul && !ul.hidden, n = st.items.length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); if (!open) { afPaint(pfx); } st.act = (st.act + 1) % n; afPaint(pfx); }
    else if (e.key === 'ArrowUp' && n && open) { e.preventDefault(); st.act = st.act <= 0 ? n - 1 : st.act - 1; afPaint(pfx); }
    else if (e.key === 'Enter' && open) { e.preventDefault(); afPick(pfx, st.act >= 0 ? st.act : 0); }
    else if (e.key === 'Escape' && open) { e.preventDefault(); st.act = -1; ul.hidden = true; el.setAttribute('aria-expanded', 'false'); }
  });
  // вибір мишею/пальцем: mousedown — щоб поле не втратило фокус до вибору
  document.addEventListener('mousedown', function (e) { var o = e.target.closest && e.target.closest('[data-aopt]'); if (o) e.preventDefault(); });
  document.addEventListener('click', function (e) { var o = e.target.closest && e.target.closest('[data-aopt]'); if (o) afPick(o.getAttribute('data-aopt'), +o.getAttribute('data-i')); });
  document.addEventListener('focusin', function (e) { var pfx = e.target && e.target.getAttribute && e.target.getAttribute('data-acity'); if (pfx && AF[pfx] && AF[pfx].items.length) afPaint(pfx); });
  // «жива» форма (екран квартири): пішли з адреси не в інше поле — показати відкладене (довідник для нового пункту)
  document.addEventListener('focusout', function (e) {
    var pfx = e.target && e.target.getAttribute && (e.target.getAttribute('data-acity') || e.target.getAttribute('data-astreet'));
    var rt = e.relatedTarget; if (!pfx || !AF[pfx] || !AF[pfx].live || (rt && /^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY|LABEL)$/.test(rt.tagName))) return;
    setTimeout(function () { var a = document.activeElement; if (pendingRender && !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) render(true); }, 220);
  });
  document.addEventListener('focusout', function (e) {
    var pfx = e.target && e.target.getAttribute && e.target.getAttribute('data-acity'); if (!pfx || !AF[pfx]) return;
    setTimeout(function () {
      var st = AF[pfx]; if (!st) return; var a = addrRead(pfx);
      if (a && a.city && !st.city) { st.city = a.city; var ci = document.getElementById(pfx + '-city'); if (ci) ci.value = a.city.n; if (st.live) { ensurePlaces(); if (addrApply(place(), a)) save(); } }
      afPaint(pfx);
    }, 150);
  });

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
  /** «місто, Броварська громада, Броварський район, Київська обл.» — область лише поза Харківщиною; Київ — «столиця». */
  function placeWhere(pl) {
    if (pl.r === 'ky') return t('prv_where_ky');
    var w = t('prv_where', { k: kindWord(pl.kind), h: pl.hromada, d: pl.district });
    return pl.r && pl.r !== 'kh' && pl.oblast ? w + ', ' + t('prv_obl', { o: pl.oblast }) : w;
  }
  /** Квартира поза Харківщиною: світло (і газ не від Газмереж) — блок місцевого постачальника замість харківських каналів. */
  function prvLocal(k) {
    var d = prvOf(k), r = d && d._place && d._place.r; if (!d || !r || r === 'kh') return null;
    if (k === 'elec') return d;
    if (k === 'gas' && d.grm && !/^Газмережі/.test(d.grm)) return Object.assign({}, d, { org: d.grm });
    return null;
  }
  /** Постачальник виду (elec|gas|water|heat) поточної квартири з довідника; null — адреси немає (як і було — Харків) чи ще вантажиться. */
  function prvOf(k) { var j = prvKinds0(); return j ? Object.assign({ _place: j.place }, j.kinds[k] || {}) : null; }
  function wherePlaceLine() {
    return places().length > 1 ? '<p class="dest-place" style="--pc:var(--pc-' + placeColor(place()) + ')" data-key="where-place"><b>' + esc(t('wd_for', { p: placeLabel(place()) })) + '</b>' + (placeSub(place()) ? '<span class="small muted"> · ' + esc(placeSub(place())) + '</span>' : '') + '</p>' : '';
  }
  /** «Куди передати» для води чи тепла поза Харковом: хто (з довідника чи з платіжки людини), як і коли, сайт/бот/кабінет, телефони, куди платити.
   *  Постачальника не знайшли — чесно: «впишіть з платіжки» з переходом у «Постачальники й тарифи». */
  // ---------- автоподача місцевим КП (LocalBot, 102-а): форма на сайті без входу, кабінет із паролем, e-mail ----------
  // У довіднику постачальник має via = id бота (mtve, cvk…); сервер каже, чи працює бот і що потрібно від людини (GET /api/lb).
  var LB = { st: {}, at: {}, busy: '', err: null, open: {}, draft: {}, items: {} };   // draft — введене у формі підключення (перемальовка після помилки не стирає)
  function lbKey(bot, pl) { return bot + '@' + (pl || ''); }
  function lbLoad(bot, pl, force) {
    var k = lbKey(bot, pl); if (!hcOn() || LB.at[k] === -1 || (!force && LB.at[k] && Date.now() - LB.at[k] < 30000)) return;
    LB.at[k] = -1;
    Y().api('GET', '/lb?bot=' + encodeURIComponent(bot) + '&place=' + encodeURIComponent(pl || '')).then(function (j) {
      LB.at[k] = Date.now(); if (j._status !== 200) { LB.st[k] = { none: true }; return; }
      var before = JSON.stringify(LB.st[k]); LB.st[k] = j; var ch = lbApply(j);
      if (ch) save(); if (ch || before !== JSON.stringify(j)) safeRender();
    }, function () { LB.at[k] = Date.now(); });
  }
  /** Записи (вода й світло/газ) за id — одне надсилання може нести кілька записів (кілька лічильників світла). */
  function lbRecs(ids) { return (S.water || []).concat(S.mrecs || []).filter(function (w) { return w && !w.deleted && ids.indexOf(w.id) >= 0; }); }
  function lbSentKey(w) { return w.meter ? (SK[w.kind === 'gas' ? 'gas' : 'elec'] || {}).sk || 'obl' : 'vk'; }
  /** Підсумки черги → записи: «прийнято» / «лист надіслано» — передано (вода — sent.vk, світло — sent.obl, газ — sent.grm). */
  function lbApply(st) {
    var ch = false, all = (S.water || []).concat(S.mrecs || []);
    ((st && st.jobs) || []).forEach(function (j) {
      if (j.card) all.forEach(function (w) { if (w && !w.deleted && !w.lbJob && w.card === j.card && w.id === j.rid) { w.lbJob = { job: j.id }; ch = true; } });   // «Відправити» в картці чату (122-а)
      all.filter(function (w) { return w && !w.deleted && w.lbJob && w.lbJob.job === j.id; }).forEach(function (w) {
        var c = { job: j.id, bot: j.bot, at: j.at, status: j.status, nextAt: j.nextAt || null, text: String(j.text || '').slice(0, 300), human: j.human ? String(j.human).slice(0, 300) : null };
        if (JSON.stringify(c) !== JSON.stringify(w.lbJob)) { w.lbJob = c; w.updatedAt = Date.now(); ch = true; }
        var sk = lbSentKey(w);
        if ((j.status === 'ok' || j.status === 'sent') && !(w.sent && w.sent[sk])) { w.sent = Object.assign({}, w.sent || {}); w.sent[sk] = today(); w.updatedAt = Date.now(); ch = true; toast(t('lb_t_ok')); }
      });
    });
    return ch;
  }
  function lbWhen(sec) { var d = new Date(sec * 1000), n = new Date(); return (d.toDateString() === n.toDateString() ? '' : fmtDate(d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2)) + ', ') + hcHM(sec); }
  function lbCall(path, body, ok) {
    LB.busy = path; LB.err = null; safeRender();
    Y().api('POST', path, Object.assign({ lang: S.lang }, body)).then(function (j) { LB.busy = ''; if (j._status === 200) ok(j); else LB.err = { error: j.error, human: j.human || t('lb_fail') }; render(true); },
      function () { LB.busy = ''; LB.err = { error: 'net', human: t('lb_fail') }; render(true); });
  }
  /** Блок у «Куди передати» місцевого постачальника: підключити (поля + згода) → «Відправити у фоні» → статус черги. */
  function lbBox(d, recs, items, pre) {
    recs = (recs || []).filter(Boolean); var rec = recs[0] || null;
    var bot = d && d.via; if (!bot || bot === 'hvk' || bot === 'htm') return '';
    var org = d.org || '';
    if (!hcOn()) return '<p class="small" data-key="lb-login">' + esc(t('lb_login', { org: org })) + ' <a href="#login">' + esc(t('login')) + '</a></p>';
    var pl = (place() || {}).id || S.placeId || '', k = lbKey(bot, pl), st = LB.st[k];
    lbLoad(bot, pl, !!(rec && rec.lbJob && /^(queued|sending)$/.test(rec.lbJob.status) && Date.now() - (LB.at[k] || 0) > 5000));
    if (!st || st.none || !st.bot || !st.bot.ready) return '';
    var b = st.bot, c = st.conn, busy = !!LB.busy, err = LB.err ? '<div class="banner bad" role="alert" data-key="lb-err">' + ico('alert', 22) + '<div><p>' + esc(LB.err.human) + '</p></div></div>' : '';
    var win = b.win ? '<p class="small muted" data-key="lb-win">' + esc(t('lb_win', { a: b.win[0], b: b.win[1] })) + '</p>' : '';
    if (!c) {
      var lead = '<p data-key="lb-lead">' + esc(t('lb_lead_' + b.t + (b.flow === 'aspx' ? '2' : b.t === 'mail' && b.need.indexOf('dist') >= 0 ? '2' : b.t === 'mail' && b.need.length === 1 ? '1' : b.t === 'mail' && b.need.join() === 'acc,addr' ? '3' : b.t === 'cab' && b.lk === 'acc' ? '1' : b.pk === 'serial' ? '3' : ''), { org: org })) + '</p>';
      if (!LB.open[k]) return '<div class="lb" data-key="lb">' + lead + err + '<div class="dest-ch"><button class="btn sec" data-act="lb-open" data-k="' + esc(k) + '" data-key="lb-open">' + ico('plus', 18) + '<span>' + esc(t('lb_conn_btn')) + '</span></button></div></div>';
      // адреса квартири вже є — підставляємо (поштові боти й форма за адресою, 105-а); людина може виправити «як у квитанції»
      var pa = String((place() || {}).address || '').trim(), dr = LB.draft[k] || Object.assign(b.need.indexOf('addr') >= 0 && pa ? { addr: pa } : {}, pre || {});
      // Славутич (106-а): замість пароля — номер будь-якого лічильника; є в налаштуваннях водоміра — підставляємо
      if (b.pk === 'serial' && !dr.pass) { var ms = wmeters().filter(function (m) { return m.serial; })[0]; if (ms) dr = Object.assign({}, dr, { pass: ms.serial }); }
      var fld = function (f) {
        if (f === 'dist') return '<div class="field"><label for="lb-dist">' + esc(t('lb_f_dist')) + '</label><div class="ctl"><select id="lb-dist" name="lb-dist" data-key="lb-f-dist"><option value="">' + esc(t('lb_f_dist0')) + '</option>' +
          (b.dists || []).map(function (o) { return '<option value="' + esc(o[0]) + '"' + (dr.dist === o[0] ? ' selected' : '') + '>' + esc(S.lang === 'ru' ? o[2] : o[1]) + '</option>'; }).join('') + '</select></div></div>';
        var lka = f === 'login' && b.lk === 'acc';   // логін кабінету — особовий рахунок (Березань)
        var pser = f === 'pass' && b.pk === 'serial';   // «пароль» — номер лічильника (Славутич)
        var type = f === 'pass' && !pser ? 'password' : f === 'phone' ? 'tel' : f === 'login' && !lka ? 'email' : 'text', ac = pser ? 'off' : { name: 'name', addr: 'street-address', phone: 'tel', login: 'username', pass: 'current-password' }[f] || 'off';
        var ax = f === 'addr' && b.flow === 'aspx';   // сайт шукає рахунок за адресою зі своїх списків
        return '<div class="field"><label for="lb-' + f + '">' + esc(t(f === 'acc' && b.fmt === 'code' ? 'lb_f_code' : lka ? 'lb_f_login_acc' : ax ? 'lb_f_addr2' : pser ? 'lb_f_mser' : 'lb_f_' + f)) + '</label><div class="ctl"><input id="lb-' + f + '" type="' + type + '" name="lb-' + f + '" autocomplete="' + ac + '"' + (f === 'acc' || lka ? ' class="num" inputmode="numeric"' : '') +
          (f === 'acc' && b.hint ? ' placeholder="' + esc(b.hint) + '"' : '') + (dr[f] ? ' value="' + esc(dr[f]) + '"' : '') + ' data-key="lb-f-' + f + '"></div>' + (f === 'acc' && b.hint ? '<p class="small muted">' + esc(t('lb_hint', { h: b.hint })) + '</p>' : '') + (ax ? '<p class="small muted" data-key="lb-addr-hint">' + esc(t('lb_addr_hint')) + '</p>' : '') + '</div>';
      };
      return '<form class="lb lb-form" data-act="lb-conn" data-bot="' + esc(bot) + '" data-pl="' + esc(pl) + '" data-key="lb-form">' + lead + b.need.map(fld).join('') + win +
        '<label class="hc-consent"><input type="checkbox" name="lb-consent" data-key="lb-consent"' + (dr.consent ? ' checked' : '') + '> <span>' + esc(t('lb_consent', { org: org })) + '</span></label>' + err +
        '<div class="row-actions"><button class="btn" type="submit" data-key="lb-save"' + (busy ? ' disabled' : '') + '>' + (LB.busy === '/lb/connect' ? SPIN : ico('check', 18)) + '<span>' + esc(t('lb_save')) + '</span></button></div></form>';
    }
    var chk = c.chk || {}, head = '<p class="small ok-ink" data-key="lb-on">' + ico('check', 16) + ' ' + esc(t('lb_on')) + (c.acc || (b.lk === 'acc' && c.login) ? ' · ' + esc(t('lb_on_acc', { a: '' })) + '<span class="num" style="white-space:nowrap">' + esc(c.acc || c.login) + '</span>' : '') + '</p>' +
      (chk.ok === false ? '<p class="small muted" data-key="lb-chk-warn">' + esc(t('lb_chk_warn')) + '</p>' : chk.meters ? '<p class="small muted" data-key="lb-chk">' + esc(t('lb_on_meters', { n: chk.meters })) + '</p>' : '');
    var off = '<p class="small"><button class="linkbtn" data-act="lb-off" data-bot="' + esc(bot) + '" data-pl="' + esc(pl) + '" data-key="lb-off"' + (busy ? ' disabled' : '') + '>' + esc(t('lb_off')) + '</button></p>';
    if (!rec) return '<div class="lb" data-key="lb">' + head + '<p class="small" data-key="lb-need-rec">' + esc(t('lb_need_rec')) + '</p>' + win + off + '</div>';
    items = items || []; LB.items[rec.id] = { ids: recs.map(function (x) { return x.id; }), items: items };
    var list = items.map(function (x) { return (x.name || '') + ' — ' + x.value; }).join('; '), j = rec.lbJob && rec.lbJob.bot === bot ? rec.lbJob : null, h = '';
    if (j && (j.status === 'queued' || j.status === 'sending')) return '<div class="lb" data-key="lb">' + head + '<div class="banner" data-key="lb-q">' + ico('clock', 22) + '<div><p><b>' + esc(j.status === 'queued' && j.nextAt ? t('lb_q_at', { at: lbWhen(j.nextAt) }) : t('lb_q')) + '</b></p><p class="small">' + esc(list) + '</p>' +
      (j.status === 'queued' ? '<div class="row-actions" style="margin-top:8px"><button class="btn sec" data-act="lb-cancel" data-id="' + j.job + '" data-key="lb-cancel"' + (busy ? ' disabled' : '') + '>' + esc(t('lb_cancel')) + '</button></div>' : '') + '</div></div>' + err + '</div>';
    if (j && (j.status === 'ok' || j.status === 'sent')) h += '<div class="banner ok" data-key="lb-done">' + ico('check', 22) + '<div><p><b>' + esc(j.status === 'sent' ? t('lb_sent', { to: b.to || '' }) : t('lb_ok')) + '</b></p>' + (j.status === 'ok' && b.later ? '<p class="small">' + esc(t('lb_later')) + '</p>' : '') + '</div></div>';
    if (j && /^(failed|rejected|unknown)$/.test(j.status)) h += '<div class="banner ' + (j.status === 'unknown' ? 'warn' : 'bad') + '" role="alert" data-key="lb-' + j.status + '">' + ico('alert', 22) + '<div><p><b>' + esc(t(j.status === 'failed' ? 'lb_failed' : j.status === 'rejected' ? 'lb_rej' : 'lb_unk')) + '</b></p>' + (j.human || j.text ? '<p class="small">' + esc(j.human || j.text) + '</p>' : '') + '</div></div>';
    var done = j && (j.status === 'ok' || j.status === 'sent'), noSer = b.serial && items.some(function (x) { return !x.serial; });
    if (noSer) h += '<p class="small" data-key="lb-serial">' + esc(t('lb_serial', { org: org })) + '</p>';
    return '<div class="lb" data-key="lb">' + head + h + err + '<div class="dest-ch"><button class="btn' + (done ? ' sec' : '') + ' dest-bg" data-act="lb-bg" data-bot="' + esc(bot) + '" data-pl="' + esc(pl) + '" data-id="' + esc(rec.id) + '" data-key="lb-bg"' + (busy || noSer ? ' disabled' : '') + '>' +
      (LB.busy === '/lb/queue' ? SPIN : ico('send', 18)) + '<span>' + esc(t('cab_bg')) + '</span></button></div><p class="small dest-note" data-key="lb-bg-note">' + esc(t('cab_bg_note', { what: list })) + '</p>' + win + off + '</div>';
  }
  /** Світло/газ: по числу на кожну зону кожного лічильника (двозонний — два числа; бот «лише однозонний» тоді відмовить зрозуміло). */
  function lbItemsS(k, ms, have) {
    var md = SK[k].mod, out = [];
    ms.forEach(function (m) { var r = (have || []).filter(function (x) { return x && x.meter === m.id; })[0]; if (!r || !r.z) return;
      md.keys(m).forEach(function (z) { var v = md.whole(r.z[z]); if (v !== null && v !== undefined && v !== '') out.push({ value: String(v), serial: m.serial || null, kind: k, name: (m.name || ename(m)) + (md.keys(m).length > 1 ? ' · ' + ezl(m, z) : '') }); }); });
    return out;
  }
  function lbItems(rec) { return wmeters().filter(function (m) { return hasVal(rec, m.id); }).map(function (m) { return { value: String(Wt.whole(rec.vals[m.id])), serial: m.serial || null, kind: m.kind, name: wname(m) }; }); }
  function lbSet(bot, pl, j) { var k = lbKey(bot, pl); LB.st[k] = j; LB.at[k] = Date.now(); if (lbApply(j)) save(); }
  ['input', 'change'].forEach(function (ev) { document.addEventListener(ev, function (e) {
    var el = e.target, f = el && el.form; if (!f || f.getAttribute('data-act') !== 'lb-conn' || !/^lb-/.test(el.name || '')) return;
    var k = lbKey(f.getAttribute('data-bot'), f.getAttribute('data-pl')), d = LB.draft[k] = LB.draft[k] || {}; d[el.name.slice(3)] = el.type === 'checkbox' ? el.checked : el.value;
  }); });
  document.addEventListener('submit', function (e) {
    var f = e.target; if (!f || f.getAttribute('data-act') !== 'lb-conn') return; e.preventDefault();
    var bot = f.getAttribute('data-bot'), pl = f.getAttribute('data-pl'), body = { bot: bot, place: pl, consent: !!(f.elements['lb-consent'] && f.elements['lb-consent'].checked) };
    ['dist', 'acc', 'name', 'addr', 'phone', 'login', 'pass'].forEach(function (x) { if (f.elements['lb-' + x]) body[x] = f.elements['lb-' + x].value; });
    lbCall('/lb/connect', body, function (j) { lbSet(bot, pl, j); delete LB.open[lbKey(bot, pl)]; delete LB.draft[lbKey(bot, pl)]; toast(t('lb_t_on')); });
  });
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-act^="lb-"]'); if (!el || el.tagName === 'FORM') return;
    var a = el.getAttribute('data-act'), bot = el.getAttribute('data-bot'), pl = el.getAttribute('data-pl');
    if (a === 'lb-open') { e.preventDefault(); LB.open[el.getAttribute('data-k')] = true; LB.err = null; render(true); return; }
    if (a === 'lb-off') { e.preventDefault(); lbCall('/lb/forget', { bot: bot, place: pl }, function (j) { lbSet(bot, pl, j); toast(t('lb_t_off')); }); return; }
    if (a === 'lb-bg') {
      e.preventDefault(); var pk = LB.items[el.getAttribute('data-id')], items = pk ? pk.items : []; if (!items.length) return;
      lbCall('/lb/queue', { bot: bot, place: pl, rid: el.getAttribute('data-id'), items: items }, function (j) {
        var jb = j.job; if (!jb) return; lbRecs(pk.ids).forEach(function (r) { r.lbJob = { job: jb.id, bot: jb.bot, at: jb.at, status: jb.status, nextAt: jb.nextAt || null }; r.updatedAt = Date.now(); }); save(); toast(t('lb_t_q'));
        var k = lbKey(bot, pl); if (LB.st[k]) LB.st[k].jobs = [jb].concat((LB.st[k].jobs || []).filter(function (x) { return x.id !== jb.id; })); LB.at[k] = 0;
      }); return;
    }
    if (a === 'lb-cancel') { e.preventDefault(); lbCall('/lb/cancel', { job: +el.getAttribute('data-id') }, function (j) { var jb = j.job; if (jb) { (S.water || []).concat(S.mrecs || []).forEach(function (w) { if (w && w.lbJob && w.lbJob.job === jb.id) { w.lbJob.status = jb.status; w.updatedAt = Date.now(); } }); save(); } toast(t('lb_t_cancel')); }); }
  });
  function lbPending() { return (S.water || []).concat(S.mrecs || []).some(function (w) { return w && !w.deleted && w.lbJob && /^(queued|sending)$/.test(w.lbJob.status); }); }
  setInterval(function () { if (document.visibilityState === 'visible' && lbPending()) safeRender(); }, 30000);
  function localDest(k, d, vals, mark, sent, extra) {
    var p = place() || {}, own = (p.prov || {})[k] || {}, org = own.name || d.org || '', pl = d._place || {};
    var how = ploc(d, 'how'), pay = ploc(d, 'pay'), phones = (d.phones || []).slice();
    if (own.phone) phones.unshift([String(own.phone).replace(/[^\d+]/g, ''), own.phone, t('ld_own_phone')]);
    var chans = [];
    if (d.cab) chans.push([d.cab, t('ld_cab'), 'ext', 'cab']);
    if (d.bot) chans.push([d.bot, t('wd_bot', { b: '@' + String(d.bot).replace(/^.*t\.me\//, '') }), 'send', 'bot']);
    if (d.site) chans.push([d.site, t('ld_site'), 'ext', 'site']);
    if (d.app) chans.push([d.app, t('ld_app'), 'ext', 'app']);
    if (d.viber) chans.push([d.viber, 'Viber', 'send', 'viber']);
    var body = vals || '';
    if (!org) body += '<p data-key="ld-unk">' + esc(t('ld_unk_' + k, { c: pl.name || '' })) + '</p><p><a class="btn sec" href="#place-' + esc(p.id || '') + '" data-act="prv-go" data-key="ld-fill">' + ico('edit', 18) + '<span>' + esc(t('prv_fill')) + '</span></a></p>';
    else body += '<p class="small" data-key="ld-how">' + esc(how || t('ld_how_unk')) + '</p>';
    if (extra) body += extra;   // автовідправка (LocalBot) — після «як передати», перед кнопками каналів
    var more = (phones.length ? '<p class="dm-t">' + esc(t('ld_call')) + '</p><ul class="dm-ph">' + phones.map(function (x) { return '<li>' + telLink(x[0], x[1]) + (x[2] ? '<span class="muted">' + esc(x[2]) + '</span>' : '') + '</li>'; }).join('') + '</ul>' : '') +
      (pay ? '<p class="dm-t">' + esc(t('ld_pay_t')) + '</p><p>' + esc(pay) + '</p>' : '');
    return destBox({ key: 'loc-' + k, org: org || t('ld_org_' + k), what: t('ld_what_' + k), sent: sent, body: body, chans: chans, more: more, mark: org ? mark : '' });
  }
  /** Тариф води квартири: свій з платіжки (p.prov.water) — главніше за загальний (wtar()). */
  function wtar() {
    var p = place() || {}, w = (p.prov && p.prov.water) || {}, d = prvOf('water'), base = S.wtariff;
    // квартира не в Харкові: тариф її водоканалу з довідника (якщо відомий) — замість харківського
    if (d && d.via !== 'hvk' && R.num(d.supply) > 0) base = Object.assign({}, S.wtariff || {}, { supply: R.num(d.supply) }, R.num(d.drain) > 0 ? { drain: R.num(d.drain) } : {});
    if (d && d.via !== 'hvk' && R.num(d.hot) > 0) base = Object.assign({}, base || S.wtariff || {}, { hot: R.num(d.hot) });   // гаряча вода міста (Київтеплоенерго 97,89)
    if (!(R.num(w.supply) > 0)) return R.num(w.hot) > 0 ? Object.assign({}, base || {}, { hot: R.num(w.hot) }) : base;
    return Object.assign({}, base || {}, { supply: R.num(w.supply), drain: R.num(w.drain) > 0 ? R.num(w.drain) : 0 }, R.num(w.hot) > 0 ? { hot: R.num(w.hot) } : {});
  }
  function prvKinds() { var k = []; if (hasHeat()) k.push('heat'); if (wmeters().length) k.push('water'); if (emeters().length) k.push('elec'); if (smeters('gas').length) k.push('gas'); return k; }
  var PRV_ICO = { elec: ['bolt', 'c-elec'], gas: ['flame', 'c-gas'], water: ['drop', 'c-cold'], heat: ['thermo', 'c-hot'] };
  function prvRow(p, k, d, nat, extra) {
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
    return h + (extra || '') + '</div></div>';
  }
  /** Блок «Постачальники й тарифи» на екрані квартири — лише для видів, що є в квартирі. */
  /** «Постачальники, тарифи й рахунки» на екрані квартири (владелец 10.11: «счета совмести с поставщиками и тарифами»): для кожного виду, що є
   *  в квартирі, — постачальник і ціна, під ними ex(k) — номери й дані з платіжки (особовий рахунок, код Водоканалу, EIC, площа, абонплата…). */
  function provPanel(p, ex) {
    ex = ex || function () { return ''; };
    var ks = prvKinds(); if (!ks.length) return '';
    var a = String(p.address || '').trim(), h = '<div class="prov" id="prov" data-key="pv-prov">';
    var bare = function (msg, key) { return h + '<p class="small muted" data-key="' + key + '">' + esc(msg) + '</p>' + ks.map(function (k) { return prvBare(k, ex(k)); }).join('') + '</div>'; };
    if (!a) return bare(t('prv_noaddr'), 'prov-noaddr');
    var j = prvLoad(p);
    if (!j || j.busy) return bare(t('prv_loading'), 'prov-loading');
    var nat = (j && j.national) || {}, pl = j.found ? j.place : null;
    var pick = function (x) { return '<li><button type="button" class="prv-pick" data-act="prv-settle" data-k="place" data-n="' + esc(x.n) + '" data-h="' + esc(x.h) + '" data-key="prov-pick-' + esc(x.h) + '">' +
      '<b>' + esc(x.name) + '</b><span class="small muted">' + esc(placeWhere(x)) + '</span></button></li>'; };
    if (j.candidates && j.candidates.length) {
      // кілька пунктів з такою назвою (чи схожих) — людина обирає свій: крупні рядки, без випадного списку
      h += '<p data-key="prov-lead"><b>' + esc(t(j.reason === 'typo' ? 'prv_ask_typo' : 'prv_ask', { a: a })) + '</b></p><ul class="prv-picks" data-key="prov-picks">' + j.candidates.map(pick).join('') + '</ul>' +
        '<p class="small muted">' + esc(t('prv_ask_none')) + '</p>';
      return h + ks.map(function (k) { return prvRow(p, k, null, nat, ex(k)); }).join('') + '</div>';
    }
    var lead = pl ? (pl.r && pl.r !== 'kh' ? t('prv_lead2', { c: pl.name, w: placeWhere(pl) }) : t('prv_lead', { c: pl.name, h: pl.hromada, d: pl.district })) + (j.how === 'default' ? ' ' + t('prv_kh_default') : '') : j.err ? t('prv_err') : t('prv_nf', { a: a });
    if (pl && j.how === 'typo') lead = t('prv_typo', { c: pl.name, w: placeWhere(pl) });
    h += '<p class="small muted" data-key="prov-lead">' + esc(lead) + '</p>';
    // уточнений пункт — можна змінити; знайшли місто, а є й села з такою назвою — «Не той?»
    if (pl && j.how === 'settled') h += '<p class="small"><button type="button" class="linkbtn" data-act="prv-unsettle" data-k="place" data-key="prov-unsettle">' + esc(t('prv_unsettle')) + '</button></p>';
    else if (pl && j.alts && j.alts.length) h += '<details class="prov-alts tips-box" data-key="prov-alts"><summary>' + esc(t('prv_alts', { c: pl.name })) + '</summary><ul class="prv-picks">' + j.alts.map(pick).join('') + '</ul></details>';
    return h + ks.map(function (k) { return prvRow(p, k, j.found ? j.kinds[k] : null, nat, ex(k)); }).join('') + '</div>';
  }
  /** Вид без довідника (немає адреси, вантажиться) — лише назва виду й дані з платіжки. */
  function prvBare(k, extra) {
    return '<div class="prov-row" data-key="prov-bare-' + k + '"><span class="pst-ico ' + PRV_ICO[k][1] + '">' + ico(PRV_ICO[k][0], 20) + '</span><div class="prov-b"><p class="prov-k"><b>' + esc(t('prv_k_' + k)) + '</b></p>' + extra + '</div></div>';
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
  // ---------- вивіз сміття (112-а; 115-а, власник 11.11: «на рівні лічильників, свої налаштування, замість табло — інше, своя історія») ----------
  // Без лічильника: ціна з людини × скільки людей. Картка на головній (місце табло — сума на місяць), своя сторінка #waste (налаштування,
  // «Куди платити», оплати), «+» — записати оплату (#wpay), історія й статистика — місяці: нараховано / сплачено. Логіка — web/src/waste.js.
  var Ws = window.TeploWaste;
  function wcur(p) { p = p === undefined ? place() : p; return (p && p.waste) || {}; }
  function wasteOn(p) { return !!wcur(p).on; }
  /** Довідник вивозу сміття для квартири (громада за адресою) або null. */
  function wasteDir(p) { var j = p && String(p.address || '').trim() ? prvLoad(p) : null; return j && j.found && j.kinds && j.kinds.waste && (j.kinds.waste.org || j.kinds.waste.price != null) ? j.kinds.waste : null; }
  function wastePersons(p) { var w = (p && p.waste) || {}; return R.num(w.persons) > 0 ? Math.round(R.num(w.persons)) : (p && p.water && R.num(p.water.persons) > 0 ? Math.round(R.num(p.water.persons)) : null); }
  /** Ціна з людини: своя з платіжки → довідник (приватний сектор — priv, якщо є). → {p, own} або null. */
  function wastePrice(p, d) { var w = (p && p.waste) || {}; if (R.num(w.price) > 0) return { p: R.num(w.price), own: true }; if (!d) return null; var v = w.priv && R.num(d.priv) > 0 ? R.num(d.priv) : R.num(d.price); return v > 0 ? { p: v, own: false } : null; }
  /** Абонплата за особовий рахунок на місяць (116-а: Балаклія — 10,01 грн окремо від «з людини»); з довідника, до суми додається один раз. */
  function wasteAbon(p, d) { return d && R.num(d.abon) > 0 ? R.num(d.abon) : 0; }
  function wasteSum(p, d) { var n = wastePersons(p), pr = wastePrice(p, d); return n && pr ? Math.round((n * pr.p + wasteAbon(p, d)) * 100) / 100 : null; }
  /** «3 × 23,47 грн з людини» або «1 × 33,23 грн + 10,01 абонплата». */
  function wasteCalcTxt(p, d) { var n = wastePersons(p), pr = wastePrice(p, d), a = wasteAbon(p, d); return a ? t('wp_calc_a', { n: n, p: money(pr.p), a: money(a) }) : t('wp_calc', { n: n, p: money(pr.p) }); }
  function wastePriceTxt(p, d) { var a = wasteAbon(p, d); return wastePriceTxt0(p, d) + (a && wastePrice(p, d) ? ' ' + t('ws_abon', { a: money(a) }) : ''); }
  function wastePriceTxt0(p, d) { var pr = wastePrice(p, d); return pr ? t('ws_price', { p: money(pr.p) }) + (pr.own ? ' ' + t('prv_from_bill') : d && d.from ? ' ' + t('prv_since', { d: fmtDate(d.from, true) }) : '') : t('ws_price_none'); }
  function wasteSumTxt(p, d) { var n = wastePersons(p), pr = wastePrice(p, d), a = wasteAbon(p, d); return n && pr ? t(a ? 'ws_sum_a' : 'ws_sum', { s: money(wasteSum(p, d)), n: n, p: money(pr.p), a: money(a) }) : t(pr ? 'ws_sum_np' : 'ws_sum_none'); }
  function wasteOrg(p, d) { return wcur(p).org || (d && ploc(d, 'org')) || ''; }
  /** «жовтень» (цей рік) / «грудень 2025». */
  function wsMon(ym) { var s = monthLabel(ym); return ym.slice(0, 4) === today().slice(0, 4) ? s.replace(/\s*\d{4}\s*$/, '') : s; }
  function wsPays(p) { return Ws.pays(wcur(p)).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; }); }
  /** Статус для картки й квартири (як heatStatus): за минулий місяць сплачено / до 20-го / строк минув (тихо, без строку — не нагадує щодня). */
  function wasteStatus() {
    var p = place(), d = wasteDir(p), s = Ws.status(wcur(p), today(), wasteSum(p, d));
    if (s.st === 'paid') return { st: t('wsc_paid', { m: wsMon(s.ym) }), tone: 'ok', ym: s.ym, pay: s.pay, debt: s.debt };
    if (s.st === 'due') return { st: t('wsc_due', { m: wsMon(s.ym), d: fmtDate(s.due) }), tone: 'due', due: s.due, ym: s.ym, debt: s.debt };
    if (s.st === 'late') return { st: t('wsc_late', { m: wsMon(s.ym) }), tone: '', late: true, ym: s.ym, debt: s.debt };
    return { st: '', tone: '' };
  }
  /** Замість табло: сума на місяць крупно, під нею «3 × 23,47 грн з людини»; не знаємо людей чи ціну — «—» і що вписати. */
  function wplate(p, d, cls) {
    var pr = wastePrice(p, d), s = wasteSum(p, d);
    return '<div class="wplate' + (cls ? ' ' + cls : '') + (s === null ? ' empty' : '') + '" data-key="wplate' + (cls ? '-' + cls.split(' ')[0] : '') + '">' +
      '<span class="wp-l">' + esc(t('wp_month')) + '</span>' +
      '<span class="wp-v"><b class="wp-sum" data-wsl="sum">' + (s === null ? '—' : esc(money(s))) + '</b><span class="wp-u">грн</span></span>' +
      '<span class="wp-calc" data-wsl="calc">' + esc(s === null ? t(pr ? 'wp_need_n' : 'wp_need') : wasteCalcTxt(p, d)) + '</span></div>';
  }
  /** Смужка останніх місяців (старіші ліворуч): ✓ сплачено, ! не сплачено, · поточний. Колір — разом зі значком і словом у підказці. */
  function wstrip(ms) {
    var a = ms.slice(0, 6).reverse(); if (a.length < 2) return '';
    return '<ul class="wstrip" data-key="wstrip" aria-label="' + esc(t('wst_strip')) + '">' + a.map(function (m) {
      var k = m.st === 'paid' ? 'ok' : m.st === 'late' || m.st === 'due' ? 'not' : 'cur', lbl = t('wsx_' + k);
      return '<li class="ws-m ' + k + '" title="' + esc(monthLabel(m.ym) + ' — ' + lbl) + '"><span class="ws-mn">' + esc(I.MONTHS_SHORT[S.lang][+m.ym.slice(5) - 1]) + '</span>' +
        ico(k === 'ok' ? 'check' : k === 'not' ? 'alert' : 'clock', 16) + '<span class="sr">' + esc(lbl) + '</span></li>';
    }).join('') + '</ul>';
  }
  function wasteCard() {
    var p = place(), d = wasteDir(p), ws = wasteStatus(), st = cardSt(ws), last = wsPays(p)[0], sum = wasteSum(p, d);
    var o = { sub: !sum ? t('wsc_setup') : last ? t('wsc_last', { d: fmtDate(last.date), s: money(last.amount) }) : t('wsc_none'), status: st, tone: st ? ws.tone : '' };
    if (ws.tone === 'ok' && last && thisMonth(last.date)) { o.sub = ''; o.status = t('wsc_paid_d', { m: wsMon(ws.ym), d: fmtDate(last.date) }); }
    else if (ws.late && sum) o.sub = t('wsc_late', { m: wsMon(ws.ym) });
    return ucard({ kind: 'waste', href: 'waste', icon: 'trash', title: t('kd_waste'), display: wplate(p, d, 'card'), sub: o.sub, status: o.status, tone: o.tone, addAct: 'ws-pay', addLabel: t('wsp_add') });
  }
  /** Поля налаштувань вивозу (сторінка вивозу й екран квартири): скільки людей, своя ціна, приватний будинок, хто вивозить, особовий рахунок, нагадування. */
  function wasteFields(p, d) {
    var w = wcur(p), n = wastePersons(p), opt = ' <span class="muted small">(' + esc(t('b_opt')) + ')</span>';
    return '<p class="prov-price small' + (wastePrice(p, d) ? '' : ' none') + '" data-wsl="price">' + esc(wastePriceTxt(p, d)) + '</p>' +
      (d && d.check && !(R.num(w.price) > 0) && ploc(d, 'note') ? '<p class="small prov-note">' + esc(ploc(d, 'note')) + '</p>' : '') +
      '<div class="grid2 ws-f">' +
        '<div class="field"><label for="ws-persons">' + esc(t('ws_persons')) + '</label><div class="ctl"><input id="ws-persons" class="num" inputmode="numeric" autocomplete="off" data-wsf="persons" maxlength="2" value="' + esc(n || '') + '"></div><div class="small muted">' + esc(t('ws_persons_h')) + '</div></div>' +
        '<div class="field"><label for="ws-price">' + esc(t('ws_price_l')) + opt + '</label><div class="ctl"><input id="ws-price" class="num" inputmode="decimal" autocomplete="off" data-wsf="price" value="' + esc(R.num(w.price) > 0 ? money(R.num(w.price)) : '') + '" placeholder="' + esc(d && R.num(d.price) > 0 ? money(w.priv && R.num(d.priv) > 0 ? R.num(d.priv) : R.num(d.price)) : '') + '"><span class="unit">грн</span></div></div>' +
        '<div class="field"><label for="ws-org">' + esc(t('ws_org_l')) + opt + '</label><div class="ctl"><input id="ws-org" autocomplete="off" maxlength="80" data-wsf="org" value="' + esc(w.org || '') + '" placeholder="' + esc(d ? ploc(d, 'org') : '') + '"></div></div>' +
        '<div class="field"><label for="ws-acc">' + esc(t('ws_acc')) + opt + '</label><div class="ctl"><input id="ws-acc" class="num" inputmode="numeric" autocomplete="off" maxlength="20" data-wsf="account" value="' + esc(w.account || '') + '">' + ctlCopy('ws-acc') + '</div></div>' +
      '</div>' +
      (d && R.num(d.priv) > 0 && R.num(d.priv) !== R.num(d.price) ? '<label class="check-row"><input type="checkbox" data-wsf="priv" data-key="ws-priv"' + (w.priv ? ' checked' : '') + '><span>' + esc(t('ws_priv', { p: money(R.num(d.priv)) })) + '</span></label>' : '') +
      '<p class="ws-sum" id="ws-sum" data-key="ws-sum" data-wsl="sumtxt">' + esc(wasteSumTxt(p, d)) + '</p>' +
      (window.TEPLO_API ? '<label class="check-row" style="margin-top:8px"><input type="checkbox" data-wsf="remind" data-key="ws-remind"' + (w.remindOff ? '' : ' checked') + (S.remind && S.remind.off ? ' disabled' : '') + '><span>' + esc(t('ws_remind')) + '</span></label>' +
        '<p class="small muted" style="margin:4px 0 0">' + esc(t(S.remind && S.remind.off ? 'pv_remind_all_off' : 'ws_remind_h')) + '</p>' : '');
  }
  /** «Куди платити»: хто вивозить, особовий рахунок (копіювати), куди й до коли, телефони, сайт; «Заповнити з monobank» — рахунок і оплати з виписки. */
  function wherePay(p, d) {
    var w = wcur(p), org = wasteOrg(p, d), phones = (d && d.phones) || [], acc = String(w.account || '').trim();
    var b = (org ? '<p><b>' + esc(org) + '</b></p>' : '<p class="muted">' + esc(t('ws_org_none')) + '</p>') +
      (acc ? '<p class="small">' + esc(t('ws_acc')) + ': <span class="num">' + esc(acc) + '</span> ' + copyIco(acc, 'ws-acc-copy') + '</p>' : '') +
      (d && ploc(d, 'pay') ? '<p class="small prov-pay">' + esc(ploc(d, 'pay')) + '</p>' : '<p class="small muted">' + esc(t('wsp_pay_gen')) + '</p>') +
      (phones.length ? '<p class="small ws-ph">' + phones.map(function (x) { return telLink(x[0], x[1]) + (x[2] && x[2] !== org ? ' <span class="muted">' + esc(x[2]) + '</span>' : ''); }).join(' · ') + '</p>' : '') +
      (d && d.site ? '<p class="small"><a href="' + esc(d.site) + '" target="_blank" rel="noopener">' + esc(t('ws_site')) + '</a></p>' : '') +
      (d && ploc(d, 'src') && !(R.num(w.price) > 0) ? '<details class="prov-src"><summary>' + esc(t('prv_src')) + '</summary><p class="small muted">' + esc(ploc(d, 'src')) + '</p></details>' : '') +
      monoLink('waste');
    return '<section class="panel where" data-key="wpay-where"><h2>' + ico('bill', 20) + '<span>' + esc(t('wsp_where')) + '</span></h2>' + b + '</section>';
  }
  /** У «Постачальники, тарифи й рахунки»: хто вивозить і почому — як інші постачальники; налаштування й оплати — на сторінці вивозу. */
  function wasteProv(p) {
    if (!wasteOn(p)) return '';
    var d = wasteDir(p), org = wasteOrg(p, d), pr = wastePrice(p, d), phones = (d && d.phones) || [];
    return '<div class="prov waste" id="waste" data-key="pv-waste"><div class="prov-row' + (pr && org ? '' : ' need') + '" data-key="prov-waste"><span class="pst-ico c-waste">' + ico('trash', 20) + '</span><div class="prov-b">' +
      '<p class="prov-k"><b>' + esc(t('ws_k')) + '</b> <span class="muted small">' + esc(t('ws_nometer')) + '</span></p>' +
      '<p class="prov-org">' + (org ? esc(org) : '<span class="muted">' + esc(t('ws_org_none')) + '</span>') + '</p>' +
      '<p class="prov-price' + (pr ? '' : ' none') + '">' + esc(wastePriceTxt(p, d)) + '</p>' +
      (d && ploc(d, 'pay') ? '<p class="small prov-pay"><b>' + esc(t('ld_pay_t')) + '</b> ' + esc(ploc(d, 'pay')) + '</p>' : '') +
      (phones.length ? '<p class="small ws-ph">' + phones.map(function (x) { return telLink(x[0], x[1]); }).join(' · ') + '</p>' : '') +
      '<p class="prov-act">' + mlink('#waste', 'prefs', t('wsp_open'), ' data-key="pv-waste-open"') + '</p></div></div></div>';
  }
  /** Місяці в історії (новіші зверху): сплачено — сума й дата; ні — нараховано «≈ люди × ціна»; праворуч — статус. Тап — оплата (нова за цей місяць чи правка). */
  function wrowsW(limit) {
    var p = place(), d = wasteDir(p), sum = wasteSum(p, d), all = Ws.months(wcur(p), today(), sum), rows = limit ? all.slice(0, limit) : all;
    if (!all.length) return { total: 0, html: '' };
    return { total: all.length, html: '<ul class="list wh" data-key="waste-history">' + rows.map(function (m) {
      var pd = m.pay, multi = pd && Ws.span(pd) > 1;
      var pill = m.st === 'paid' ? ['ok', t('wsx_ok')] : m.st === 'late' ? ['warn', t('wsx_not')] : m.st === 'due' ? [R.daysBetween(today(), m.due) <= DUE_SOON ? 'warn' : 'neutral', t('wsx_due', { d: fmtDate(m.due) })] : ['neutral', t('wsx_cur')];
      return histRow({ key: 'wsm-' + m.ym, href: pd ? '#wpay-' + pd.id : '#wpay-' + m.ym, q: pd ? money(m.paid) : sum ? '≈ ' + money(sum) : null, unit: 'грн', none: t('wsh_none'), date: ucf(monthLabel(m.ym)),
        sub: [pd ? t('wsh_paid', { d: fmtDate(pd.date, true) }) : sum ? t('wsh_acc') : '', multi ? t('wsh_multi', { s: money(pd.amount), n: Ws.span(pd) }) : '', pd && pd.src === 'mono' ? t('wsh_mono') : ''],
        st: '<span class="st-chip st-static" data-key="wsm-st-' + m.ym + '"><span class="pill ' + pill[0] + '">' + esc(ucf(pill[1])) + '</span></span>' });
    }).join('') + '</ul>' };
  }
  V.waste = function () {
    var p = place() || {}, d = wasteDir(p), w = wcur(p), sum = wasteSum(p, d), st = Ws.status(w, today(), sum), ms = Ws.months(w, today(), sum, 6), org = wasteOrg(p, d);
    var h = '<h1 class="sr">' + esc(t('kd_waste')) + (p.name ? ' — ' + esc(p.name) : '') + '</h1>';
    var cap = st.st === 'paid' ? t('wsp_cap_paid', { m: wsMon(st.ym), d: fmtDate(st.pay.date, true) }) : st.ym ? t('wsp_cap_not', { m: wsMon(st.ym) }) : t('wsc_none');
    var debt = st.debt > 1 ? '<p class="small warn-text" data-key="wsp-debt">' + esc(st.debtSum ? t('wsp_debt_s', { n: st.debt, s: money(st.debtSum) }) : t('wsp_debt', { n: st.debt })) + '</p>' : '';
    if (!w.on) debt += '<p class="small muted">' + esc(t('wsp_removed', { d: fmtDate(w.removed || today(), true) })) + '</p>';
    var left = mbox({ key: 'wbox', id: 'waste', kind: 'waste', icon: 'trash', cls: 'c-waste', name: t('kd_waste'), sub: [org || t('ws_nometer')],
      display: wplate(p, d, 'hero') + wstrip(ms), cap: cap, body: debt, set: wasteFields(p, d), setTitle: t('wsp_set'), links: [mbPlaceLink('wsp-place')] });
    var act = '<button class="btn big block" data-act="ws-pay" data-key="waste-pay">' + ico('plus', 22) + '<span>' + esc(t('wsp_add')) + '</span></button>';
    var right = whereAcc(wherePay(p, d)), wr = wrowsW(3);
    if (wr.total) right += histPanel(wr.html, wr.total, '<button class="btn sec block" data-act="view-go" data-v="waste" data-to="history" data-key="waste-all">' + esc(t('wh_all', { n: wr.total })) + '</button>', 'waste');
    h += heroGrid(left, act, right);
    return { screen: 'S60', route: 'waste', html: h };
  };
  function wasteHistory() {
    var r = wrowsW(), head = '<h1>' + esc(t('hi_title')) + '</h1>' + kindSwitch();
    var add = '<p><button class="btn" data-act="ws-pay" data-key="wh-pay">' + ico('plus', 20) + '<span>' + esc(t('wsp_add')) + '</span></button></p>';
    return { screen: 'S09', route: 'history', html: head + (r.total ? r.html : '<div class="panel"><p class="muted">' + esc(t('wsh_empty')) + '</p></div>') + add + '<p class="small muted">' + esc(t('wsh_hint')) + '</p>' };
  }
  function wasteStats() {
    chColors();
    var p = place(), d = wasteDir(p), w = wcur(p), sum = wasteSum(p, d), y = Ws.year(w, today()), st = Ws.status(w, today(), sum), head = '<h1>' + esc(t('stt_title')) + '</h1>' + kindSwitch();
    var ms = Ws.months(w, today(), sum, 12).filter(function (m) { return m.st !== 'ahead' || m.pay; }).reverse();
    var tiles = kpi({ key: 'wst-kpi', tone: 'waste', q: sum ? money(sum) : '—', unit: t('wst_unit'), cap: sum ? wasteCalcTxt(p, d) : t('ws_sum_none'),
      chips: [chip(y.n ? t('wst_year', { s: money(y.total), n: y.n }) : t('wst_year0'), 'clock')].concat(st.debt ? [chip(st.debtSum ? t('wsp_debt_s', { n: st.debt, s: money(st.debtSum) }) : t('wsp_debt', { n: st.debt }), 'alert')] : []) });
    var c = ms.length > 1 ? barChart(ms.map(function (m) { var v = m.paid || 0; return { x: ymLabel(m.ym), v: Math.round(v), top: v ? String(Math.round(v)) : '', color: CH.barSoft, tip: [monthLabel(m.ym), v ? t('wst_tip_paid', { s: money(v) }) : t('wsx_' + (m.st === 'cur' ? 'cur' : 'not')), sum ? t('wst_tip_acc', { s: money(sum) }) : ''] }; }), { title: t('wst_paid_t'), dec: 0, ref: sum ? { v: sum, label: t('wst_ref') } : null }) : '';
    var table = '<details class="panel wacc tbl-acc" data-key="wst-table"><summary><h2>' + esc(t('stt_table')) + '</h2>' + ico('chev', 20, 'pacc-chev') + '</summary><div class="tbl-wrap where-b"><table class="tbl"><thead><tr><th>' + esc(t('wst_th_month')) + '</th><th>' + esc(t('wst_th_acc')) + '</th><th>' + esc(t('wst_th_paid')) + '</th></tr></thead><tbody>' +
      ms.slice().reverse().map(function (m) { return '<tr><td>' + esc(ymLabel(m.ym)) + '</td><td class="num">' + (sum ? money(sum) : '—') + '</td><td class="num">' + (m.paid ? money(m.paid) : '<span class="muted">—</span>') + '</td></tr>'; }).join('') + '</tbody></table></div></details>';
    return { screen: 'S15', route: 'stats', html: head + '<p class="muted">' + esc(t('wsst_lead')) + '</p>' + tiles + (c ? '<section class="panel chart-panel"><h2>' + esc(t('wst_paid_t')) + '</h2><p class="small muted">' + esc(t('wst_paid_s')) + '</p>' + c + '</section>' : '') + table };
  }

  // ---- «Записати оплату»: за який місяць, скільки місяців, сума, коли сплатили; правка й видалення ----
  var WP = { id: '', ym: '', n: 1, amount: '', date: '', err: '' };
  function wpFresh(ym) { var p = place(), d = wasteDir(p), sum = wasteSum(p, d), y = ym || Ws.nextYm(wcur(p), today()); WP = { id: '', ym: y, n: 1, amount: sum ? money(sum) : '', date: today(), err: '', auto: !!sum }; }
  function wpView(arg) {
    var p = place(), d = wasteDir(p), sum = wasteSum(p, d), edit = null, back = backTo('waste');
    if (arg && !/^\d{4}-\d{2}$/.test(arg)) { edit = wsPays(p).filter(function (x) { return x.id === arg; })[0] || null; if (!edit) return { screen: 'S61', route: 'wpay', bare: true, closeTo: back, html: '<h1>' + esc(t('wsp_add')) + '</h1><p class="muted">' + esc(t('rec_gone')) + '</p><a class="btn" href="#' + back + '">' + esc(t('back')) + '</a>' }; }
    if (edit && WP.id !== edit.id) WP = { id: edit.id, ym: edit.ym, n: Ws.span(edit), amount: money(edit.amount), date: edit.date, err: '' };
    else if (!edit && (WP.id || !WP.ym || (arg && WP.ym !== arg))) wpFresh(arg);
    // місяці у виборі: від 24 місяців тому до 6 наперед; уже сплачені — з позначкою
    var cur = today().slice(0, 7), opts = [], paid = {};
    Ws.pays(wcur(p)).forEach(function (x) { if (x.id === WP.id) return; for (var i = 0; i < Ws.span(x); i++) paid[Ws.addYm(x.ym, i)] = 1; });
    for (var ym = Ws.addYm(cur, 6); ym >= Ws.addYm(cur, -24); ym = Ws.addYm(ym, -1)) opts.push(ym);
    if (opts.indexOf(WP.ym) < 0) opts.push(WP.ym);
    var opt = ' <span class="muted small">(' + esc(t('b_opt')) + ')</span>';
    var h = '<h1>' + ico('trash', 26, 'c-waste') + ' ' + esc(t(edit ? 'wsp_edit_t' : 'wsp_add')) + '</h1>' + (wasteOrg(p, d) ? '<p class="muted">' + esc(wasteOrg(p, d)) + (places().length > 1 ? ' · ' + esc(placeLabel(p)) : '') + '</p>' : '') +
      '<form id="wp-form" novalidate data-key="wp-form"><div class="panel">' +
      '<div class="field"><label for="wp-ym">' + esc(t('wsp_ym')) + '</label><div class="ctl"><select id="wp-ym" data-key="wp-ym">' + opts.map(function (y) { return '<option value="' + y + '"' + (y === WP.ym ? ' selected' : '') + '>' + esc(ucf(monthLabel(y))) + (paid[y] ? ' — ' + esc(t('wsx_ok').toLowerCase()) : '') + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="field"><span class="lbl" id="wp-n-l">' + esc(t('wsp_n')) + '</span><span class="stepper" role="group" aria-labelledby="wp-n-l"><button type="button" class="btn sec step-b" data-act="wp-n" data-d="-1" data-key="wp-n-dec" aria-label="' + esc(t('wsp_n_dec')) + '"' + (WP.n > 1 ? '' : ' disabled') + '>−</button>' +
        '<output class="step-n num" id="wp-n" aria-live="polite" data-key="wp-n">' + WP.n + '</output><button type="button" class="btn sec step-b" data-act="wp-n" data-d="1" data-key="wp-n-inc" aria-label="' + esc(t('wsp_n_inc')) + '"' + (WP.n < 12 ? '' : ' disabled') + '>+</button></span>' +
        '<div class="small muted" id="wp-n-h">' + esc(WP.n > 1 ? t('wsp_n_span', { a: ucf(monthLabel(WP.ym)), b: monthLabel(Ws.addYm(WP.ym, WP.n - 1)) }) : t('wsp_n_h')) + '</div></div>' +
      '<div class="field"><label for="wp-amount">' + esc(t('wsp_amount')) + '</label><div class="ctl"><input id="wp-amount" class="num" inputmode="decimal" autocomplete="off" value="' + esc(WP.amount) + '" data-key="wp-amount"><span class="unit">грн</span></div>' +
        '<div class="small muted">' + esc(sum ? t('wsp_amount_h', { s: money(sum * WP.n), n: WP.n }) : t('wsp_amount_h0')) + '</div></div>' +
      '<div class="field"><label for="wp-date">' + esc(t('wsp_date')) + '</label><div class="ctl"><input id="wp-date" type="date" max="' + today() + '" value="' + esc(WP.date) + '" data-key="wp-date"></div></div>' +
      (WP.err ? '<div class="help bad" role="alert" data-key="wp-err">' + esc(t('wsp_e_' + WP.err)) + '</div>' : '') + '</div>' +
      '<div class="wiz-actions"><a class="btn sec" href="#' + esc(back) + '" data-key="wp-cancel">' + esc(t('cancel')) + '</a><button type="submit" class="btn" data-key="wp-save">' + ico('check', 20) + '<span>' + esc(t(edit ? 'save' : 'wsp_save')) + '</span></button></div>' +
      (edit ? '<p style="margin-top:24px"><button type="button" class="btn danger" data-act="wp-del" data-key="wp-del">' + ico('trash', 18) + '<span>' + esc(t('wsp_del')) + '</span></button></p>' : '') + '</form>';
    return { screen: 'S61', route: 'wpay', bare: true, closeTo: back, html: h };
  }
  V.wpay = function () { return wpView(''); };
  function wpRead() { var g = function (id) { var el = document.getElementById(id); return el ? String(el.value || '') : null; }; var y = g('wp-ym'), a = g('wp-amount'), dt = g('wp-date'); if (y !== null) WP.ym = y; if (a !== null) WP.amount = a; if (dt !== null) WP.date = dt; }
  function wpSave() {
    wpRead(); var r = Ws.make({ ym: WP.ym, n: WP.n, amount: WP.amount, date: WP.date }, today());
    if (!r.ok) { WP.err = r.err; render(true); var f = document.getElementById(r.err === 'ym' ? 'wp-ym' : r.err === 'amount' ? 'wp-amount' : 'wp-date'); if (f) f.focus(); return; }
    var id = WP.id || 'wp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    wasteSet(function (w) { w.pays = (w.pays || []).filter(function (x) { return x && x.id !== id; }); w.pays.push(Object.assign({ id: id, updatedAt: Date.now() }, r.pay)); });
    track('waste_pay', { n: r.pay.n, edit: WP.id ? 1 : 0 }); toast(t(WP.id ? 'wsp_saved_e' : 'wsp_saved', { m: wsMon(r.pay.ym) }));
    var back = backTo('waste'); WP = { id: '', ym: '', n: 1, amount: '', date: '', err: '' }; go(back);
  }
  document.addEventListener('submit', function (e) { if (e.target && e.target.id === 'wp-form') { e.preventDefault(); wpSave(); } });
  document.addEventListener('change', function (e) {
    var el = e.target; if (!el || el.id !== 'wp-ym') return;
    wpRead(); render(true);
  });
  document.addEventListener('input', function (e) { if (e.target && e.target.id === 'wp-amount') WP.auto = false; });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-act="ws-pay"],[data-act="wp-n"],[data-act="wp-del"]'); if (!b) return;
    var a = b.getAttribute('data-act');
    if (a === 'ws-pay') { e.preventDefault(); WP = { id: '', ym: '', n: 1 }; go('wpay'); return; }
    if (a === 'wp-n') {
      wpRead(); var p = place(), sum = wasteSum(p, wasteDir(p)), was = WP.n; WP.n = Math.max(1, Math.min(12, WP.n + Number(b.getAttribute('data-d'))));
      // сума підлаштовується, доки людина її не правила
      var a0 = R.num(String(WP.amount).replace(/\s/g, '').replace(',', '.'));
      if (sum && (WP.auto || a0 === null || Math.abs(a0 - sum * was) < 0.01)) { WP.amount = money(sum * WP.n); WP.auto = true; }
      render(true); return;
    }
    if (a === 'wp-del') {
      if (!confirm(t('wsp_del_q'))) return;
      var id = WP.id; wasteSet(function (w) { (w.pays || []).forEach(function (x) { if (x && x.id === id) { x.deleted = true; x.updatedAt = Date.now(); } }); });
      toast(t('wsp_deleted')); WP = { id: '', ym: '', n: 1 }; go(backTo('waste'));
    }
  });
  function wasteSet(fn) { ensurePlaces(); var p = place(); if (!p) return null; p.waste = JSON.parse(JSON.stringify(p.waste || {})); fn(p.waste); p.updatedAt = Date.now(); save(); return p; }
  /** Увімкнути вивіз сміття в поточній квартирі (з «Додати лічильник» чи майстра): дані, що були, лишаються. */
  function wasteAdd() { wasteSet(function (w) { w.on = true; w.at = w.at || today(); delete w.removed; }); track('waste', { on: 1 }); }
  ['input', 'change'].forEach(function (ev) { document.addEventListener(ev, function (e) {
    var el = e.target, f = el && el.getAttribute && el.getAttribute('data-wsf'); if (!f) return;
    if (el.type === 'checkbox') { if (ev !== 'change') return; wasteSet(function (w) { if (f === 'remind') { if (el.checked) delete w.remindOff; else w.remindOff = true; } else if (el.checked) w[f] = true; else delete w[f]; }); }
    else if (f === 'org') wasteSet(function (w) { var v = el.value.trim().slice(0, 80); if (v) w.org = v; else delete w.org; });
    else if (f === 'account') wasteSet(function (w) { var v = el.value.replace(/[^\d\-\/]/g, '').slice(0, 20); if (v) w.account = v; else delete w.account; });
    else { var v = el.value.trim() === '' ? null : R.num(el.value.replace(/\s/g, '').replace(',', '.')); if (v !== null && !(v > 0 && v < (f === 'persons' ? 50 : 1000))) return;
      wasteSet(function (w) { if (v === null) delete w[f]; else w[f] = f === 'persons' ? Math.round(v) : v; }); }
    // сума, ціна й «табло» — на місці, без перемальовування (фокус у полі лишається)
    var p = place(), d = p && wasteDir(p), pr = p && wastePrice(p, d), s = p ? wasteSum(p, d) : null;
    var set = function (k, txt) { Array.prototype.forEach.call(document.querySelectorAll('[data-wsl="' + k + '"]'), function (x) { x.textContent = txt; }); };
    if (!p) return;
    set('sumtxt', wasteSumTxt(p, d)); set('price', wastePriceTxt(p, d)); set('sum', s === null ? '—' : money(s));
    set('calc', s === null ? t(pr ? 'wp_need_n' : 'wp_need') : wasteCalcTxt(p, d));
    Array.prototype.forEach.call(document.querySelectorAll('.wplate'), function (x) { x.classList.toggle('empty', s === null); });
  }); });
  /** Экран квартиры: её счётчики, название/адрес/цвет, свои рахунки; удалить. Открыть экран = перейти в эту квартиру. */
  function placeView(id) {
    var p = place(id);
    if (!p) return { screen: 'S42', route: 'places', html: '<h1>' + esc(t('pl_title')) + '</h1><p class="muted">' + esc(t('rec_gone')) + '</p><a class="btn" href="#places">' + esc(t('back')) + '</a>' };
    if (id !== S.placeId) { switchPlace(id); WX.key = ''; p = place(); }
    var many = places().length > 1, ms = wmeters(), sub = placeSub(p), fresh = !p.name && !String((p.city && p.city.n ? p.street : p.address) || '').trim() && !hasHeat() && !ms.length && !pmeters().length;
    // сюда приходят с главной (плитка «Налаштування квартири») — туда и назад
    var h = '<p><a href="#' + (many ? 'places' : 'home') + '" data-key="pv-back">← ' + esc(t(many ? 'pv_back_all' : 'nav_home')) + '</a></p>' +
      '<h1 class="pv-h" style="--pc:var(--pc-' + placeColor(p) + ')">' + pmark(p, 30, 'pv-dot') + '<span>' + esc(placeLabel(p)) + (sub ? '<span class="small muted pv-sub">' + esc(sub) + '</span>' : '') + '</span></h1>';
    if (fresh) h += '<div class="banner" data-key="pv-new">' + ico('info', 22) + '<div><p><b>' + esc(t('pv_new_t')) + '</b></p><p>' + esc(t('pv_new')) + '</p></div></div>';
    // три розкривашки (владелец 10.11): про квартиру · лічильники · постачальники, тарифи й рахунки; у налаштуваннях лічильника — лише сам лічильник
    var rows = [];
    if (hasHeat()) rows.push(mrow({ what: 'heat', kind: 'heat', title: t('kd_heat'), href: 'heat', sub: [modelName(model()), verTxt(S.meter.verifiedUntil)].filter(Boolean).join(' · '), set: heatMeterFields(model(), true) + mdocs('heat') + gapSetLink('heat') }));
    ms.forEach(function (m) { rows.push(mrow({ what: m.id, kind: m.kind, title: wkindTitle(m.kind) + (m.name ? ' · ' + m.name : ''), href: 'water-' + m.kind, sub: verTxt(m.verifiedUntil), set: wmeterFields(m, false, true) + mdocs(m.id) + gapSetLink(m.id) })); });
    ['elec', 'gas'].forEach(function (k) { smeters(k).forEach(function (m) { rows.push(mrow({ what: m.id, kind: k, title: ename(m), href: SK[k].page, noReplace: true, sub: [ezonesTxt(m), verTxt(m.verifiedUntil)].filter(Boolean).join(' · '), set: smeterFields(k, m, true) + mdocs(m.id) })); }); });
    // вивіз сміття — рядком серед лічильників (115-а): відкрити, налаштування (люди, ціна, рахунок), прибрати
    if (wasteOn(p)) { var wd = wasteDir(p), wn = wastePersons(p), wpr = wastePrice(p, wd);
      rows.push(mrow({ what: 'waste', kind: 'waste', title: t('kd_waste'), href: 'waste', noReplace: true, setTitle: t('wsp_set'), sub: wn && wpr ? wasteCalcTxt(p, wd) : t('ws_nometer'), set: wasteFields(p, wd) })); }
    var meters = (rows.length ? '<ul class="mlist">' + rows.join('') + '</ul>' : '<p class="muted">' + esc(t('pv_none')) + '</p>') +
      '<p class="pv-add"><button class="btn' + (rows.length ? ' sec' : '') + '" data-act="add-meter" data-back="place-' + esc(p.id) + '" data-key="pv-add-meter">' + ico('plus', 20) + '<span>' + esc(t('am_tile')) + '</span></button></p>';
    var rm = removedMeters();
    if (rm.length) meters += '<h3 style="margin-top:20px">' + esc(t('am_restore_t')) + '</h3><ul class="mlist removed">' + rm.map(function (x) {
      return '<li class="mrow" data-key="pv-rm-' + esc(x.what) + '"><div class="mrow-main">' + ico(KINDS[x.kind].icon, 22, KINDS[x.kind].cls) + '<span class="grow"><b>' + esc(x.title) + '</b><span class="small muted">' + esc(t('am_removed_on', { d: fmtDate(x.at, true) })) + '</span></span>' +
        '<button type="button" class="btn sec" data-act="m-restore" data-what="' + esc(x.what) + '" data-key="pv-restore-' + esc(x.what) + '">' + esc(t('am_restore')) + '</button></div></li>';
    }).join('') + '</ul>';
    // дані з платіжки кожного виду — під його постачальником
    var fld = function (id, lbl, attrs, val, unit, help) { return '<div class="field"><label for="' + id + '">' + lbl + '</label><div class="ctl"><input id="' + id + '" class="num" autocomplete="off" ' + attrs + ' value="' + esc(val) + '">' + (unit ? '<span class="unit">' + unit + '</span>' : '') + '</div>' + (help || '') + '</div>'; };
    var optl = function (x) { return esc(x) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span>'; };
    var bills = function (k) {
      var b = '';
      if (k === 'heat') b = '<div class="grid2">' + hmAccField() +
        fld('p-area', optl(t('nm_area')), 'inputmode="decimal"', p.area ? String(p.area).replace('.', ',') : '', 'м²', areaHint()) +
        fld('p-abon', esc(t('p_abon_l')), 'inputmode="decimal"', bill().abon.toFixed(2).replace('.', ','), '', '') + mzkField() + '</div>';
      if (k === 'water') b = waccForm() + '<div class="grid2">' + ms.map(function (m) { return wvkField(m, ms.length > 1 ? t('wm_vkid_for', { m: wname(m) }) : t('wm_vkid')); }).join('') +
        '<div class="field"><label for="p-persons">' + optl(t('nm_persons')) + '</label><div class="ctl"><input id="p-persons" class="num" inputmode="numeric" autocomplete="off" data-nm="persons" value="' + esc(wcfg().persons || '') + '"></div><div class="small muted">' + esc(t('pv_persons_h')) + '</div></div></div>';
      if (k === 'elec' || k === 'gas') { var sm = smeters(k); b = sm.map(function (m) { return (sm.length > 1 ? '<p class="small muted pv-mname">' + esc(ename(m)) + '</p>' : '') + '<div class="grid2">' + sprovFields(k, m) + '</div>'; }).join('') + sheatRow(k); }
      return b ? '<div class="prov-bills" data-key="pv-bills-' + k + '"><p class="prov-bills-t">' + esc(t('pv_bills_t')) + '</p>' + b + '</div>' : '';
    };
    // monobank — на виду (власник 11.11: «не побачив, де monobank»): усі рахунки квартири з платежів одним заходом
    var prov = monoLink('place') + (provPanel(p, bills) || '<p class="muted">' + esc(t('pv_money_none')) + '</p>') + wasteProv(p);   // вивіз сміття — постачальник (налаштування — серед лічильників)
    // про квартиру
    var chips = t('pv_chips').split('|').map(function (c) { return '<button type="button" class="chip" data-act="pv-chip" data-v="' + esc(c) + '" aria-pressed="' + (p.name === c) + '">' + esc(c) + '</button>'; }).join('');
    var sw = PCOLORS.map(function (c) { return '<label class="swatch" style="--pc:var(--pc-' + c + ')"><input type="radio" name="pv-color" value="' + c + '"' + (placeColor(p) === c ? ' checked' : '') + '><span class="sw-dot" aria-hidden="true">' + ico('check', 20) + '</span><span class="sr">' + esc(t('pc_' + c)) + '</span></label>'; }).join('');
    var about = '<div data-key="pv-about">' +
      '<div class="field"><label for="pv-name">' + esc(t('pv_name')) + '</label><div class="ctl"><input id="pv-name" data-plf="name" maxlength="40" autocomplete="off" value="' + esc(p.name || '') + '" placeholder="' + esc(t('pv_name_ph')) + '"></div><div class="chips" role="group" aria-label="' + esc(t('pv_name')) + '">' + chips + '</div></div>' +
      '<h3 class="pv-addr-t">' + esc(t('pl_addr')) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></h3>' + addrFieldsFor('pv', p, true) +
      '<fieldset class="field"><legend class="lbl">' + esc(t('pv_color')) + '</legend><div class="swatches">' + sw + '</div><div class="small muted">' + esc(t('pv_color_h')) + '</div></fieldset>' +
      // значок — необов'язково (власник 10.11): залиті, кольором квартири; «Без значка» — як було, крапка кольору
      '<fieldset class="field pv-icons" style="--pc:var(--pc-' + placeColor(p) + ')" data-key="pv-icons"><legend class="lbl">' + esc(t('pv_icon')) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></legend><div class="picks">' +
        [''].concat(Object.keys(PICONS)).map(function (k) { var on = (p.icon && PICONS[p.icon] ? p.icon : '') === k;
          return '<label class="pick" title="' + esc(k ? t('pi_' + k.replace(/-/g, '_')) : t('pv_icon_none')) + '"><input type="radio" name="pv-icon" value="' + k + '"' + (on ? ' checked' : '') + '><span class="pk-b" aria-hidden="true">' + (k ? picon({ icon: k }, 28) : '<span class="pdot"></span>') + '</span><span class="sr">' + esc(k ? t('pi_' + k.replace(/-/g, '_')) : t('pv_icon_none')) + '</span></label>'; }).join('') +
      '</div><div class="small muted">' + esc(t('pv_icon_h')) + '</div></fieldset></div>';
    // порядок (владелец 10.11): про квартиру · лічильники · постачальники, тарифи й рахунки
    if (window.TEPLO_API && Y().account) h += '<input type="file" id="doc-input" class="sr" aria-label="' + esc(t('mv_docs')) + '" tabindex="-1" accept="image/jpeg,image/png,image/webp,application/pdf">';
    h += '<div class="pgroups pv-groups">' +
      prefGroup('pv-about', 'home', t('pv_about'), sub || t('pv_about_s'), about, fresh) +
      prefGroup('pv-meters', 'clock', t('pv_meters'), rows.length ? placeKinds(p) : t('pv_none_short'), meters, fresh) +
      prefGroup('pv-prov', 'bill', t('pv_prov_t'), t('pv_prov_s'), prov) + '</div>';
    // графік відключень — на сторінці світла; у квартири без електролічильника — тут
    if (!emeters().length) h += gpvBox(p, 'place');
    if (many && window.TEPLO_API) h += '<section class="panel" data-key="pv-remind"><h2>' + esc(t('pv_remind')) + '</h2>' +
      '<label class="check-row"><input type="checkbox" id="pv-remind"' + (p.remindOff ? '' : ' checked') + (S.remind && S.remind.off ? ' disabled' : '') + '><span>' + esc(t('pv_remind_l')) + '</span></label>' +
      '<p class="small muted" style="margin-top:8px">' + esc(t(S.remind && S.remind.off ? 'pv_remind_all_off' : 'pv_remind_h')) + '</p></section>';
    if (many) h += '<section class="panel" data-key="pv-danger"><button class="btn danger" data-act="pl-del-ask" data-id="' + esc(p.id) + '" data-key="pv-del">' + esc(t('pv_del')) + '</button><div id="pl-del-confirm"></div></section>';
    return { screen: 'S42', route: 'place', html: h };
  }

  // ================= мастер «Додати квартиру»: 1) назва й адреса 2) які лічильники є 3) рахунок Водоканалу =================
  // Пенсионерам: шаги пронумерованы, крупные +/−, на последнем шаге — «Перевірте» с повтором сути. Потом — настройка каждого
  // счётчика по очереди (PQ): водомеры по одному (#wadd), теплосчётчик — последним (#meter, дальше обычный путь).
  // Первый вход (#start, PW.first) — тот же мастер для первой квартиры «Моя квартира», без шага названия: один шаг — які лічильники є
  // (табло-образцы, +/−); назва й адреса — потом на главной. Рахунки (Водоканал, світло, газ) при настройке не спрашиваем (власник 11.11, 114-я):
  // выбрал счётчик — вносит показания; рахунок просим перед передачей («Куди передати»).
  function pwFresh(back, first) { return { step: 0, first: !!first, name: '', city: undefined, cityTyped: '', street: '', n: { heat: 0, hot: 0, cold: 0, elec: 0, gas: 0, waste: 0 }, account: '', surname: '', back: back || 'places', err: '' }; }
  var PW = pwFresh(), PQ = null;
  function pwSteps() { return PW.first ? 1 : 2; }
  function pwKind(i) { return (PW.first ? ['kinds'] : ['name', 'kinds'])[i]; }
  function pwAny() { return KIND_ORDER.some(function (k) { return PW.n[k] > 0; }); }
  function pwRead() {
    var v = function (id) { var el = document.getElementById(id); return el ? String(el.value || '') : null; };
    var a = v('aw-name'), c = v('aw-acc'), d = v('aw-sn'), ad = addrRead('aw');
    if (a !== null) PW.name = a.slice(0, 40); if (ad) { PW.city = ad.city; PW.cityTyped = ad.typed; PW.street = ad.street; } if (c !== null) PW.account = c.trim(); if (d !== null) PW.surname = d.trim();
  }
  function pwMetersText() {
    var a = KIND_ORDER.filter(function (k) { return PW.n[k]; }).map(function (k) { return t(KINDS[k].t) + (PW.n[k] > 1 ? ' ×' + PW.n[k] : ''); });
    return a.length ? a.join(' · ') : t('aw_sum_none');
  }
  /** «Перевірте» — повтор сути перед созданием. */
  function pwSummary() {
    var nm = PW.first ? placeLabel(place()) : PW.name.trim() || t('pl_unnamed', { n: places().length + 1 });
    var sub = PW.first ? t('fs_sum_hint') : afCompose(PW.city, PW.cityTyped, PW.street);
    return '<section class="panel aw-sum" style="--pc:var(--pc-' + (PW.first ? placeColor(place()) : nextColor()) + ')" data-key="aw-sum"><h2>' + esc(t(PW.first ? 'fs_sum' : 'aw_sum')) + '</h2><dl>' +
      '<dt>' + esc(t('aw_sum_name')) + '</dt><dd><b>' + esc(nm) + '</b>' + (sub ? '<span class="small muted"> · ' + esc(sub) + '</span>' : '') + '</dd>' +
      '<dt>' + esc(t('aw_sum_meters')) + '</dt><dd>' + esc(pwMetersText()) + '</dd></dl></section>';
  }
  /** Табло-образец вида (узнать свой счётчик по виду): тепло — зелёный ЖК, вода — циферблат, світло — тёмный экран, газ — жёлтая панель. */
  function kindPreview(k) {
    if (k === 'heat') return lcd([{ text: '12.910', tag: 'Gcal' }]);
    if (k === 'elec') return elcd([{ text: '10420' }]);
    if (k === 'waste') return '<span class="wplate kp-w"><span class="wp-v"><b class="wp-sum">70,41</b><span class="wp-u">грн</span></span></span>';   // без табло — сума на місяць
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
  /** Адреса в мастері: пункт — як у першої квартири, доки людина не змінить. */
  function awAddr() {
    var d = null; if (PW.city === undefined) { d = cityDefault(); PW.city = d ? d.city : null; }
    return addrFields('aw', { city: PW.city, typed: PW.cityTyped, street: PW.street, hint: d ? t('af_default', { p: placeLabel(d.from) }) : '' });
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
        '<h2 class="aw-addr-t">' + esc(t('pl_addr')) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></h2>' + awAddr() + '</div>';
    } else if (kind === 'kinds') {
      h = '<h1>' + esc(t(first ? 'fs_t1' : 'aw_t2')) + '</h1><p class="muted">' + esc(t(first ? 'fs_l1' : 'aw_l2')) + '</p>' + awKinds() +
        (PW.err ? '<div class="banner warn" role="alert" data-key="aw-err">' + ico('alert', 22) + '<div><p><b>' + esc(PW.err) + '</b></p></div></div>' : '') +
        (first ? '<p class="small muted fs-more" data-key="fs-more">' + ico('home', 18) + '<span>' + esc(t('fs_more')) + '</span></p>' : '');
    }
    if (last && !first) h += pwSummary();
    h += '<div class="wiz-actions">' + prevBtn + nextBtn + '</div>';
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
  function pwCreate() {
    pwRead(); syncPlace();
    var first = PW.first;
    if (first && !pwAny()) { PW.step = 0; PW.err = t('fs_err_none'); pwGo(); return; }
    var list = []; ['hot', 'cold', 'elec', 'gas'].forEach(function (k) { for (var j = 0; j < (PW.n[k] || 0); j++) list.push(k); });
    if (!first) {   // первая квартира уже есть («Моя квартира»)
      var np = { id: 'p' + Date.now().toString(36), name: PW.name.trim(), address: '', v: 2, color: nextColor(), meter: null, baseline: null,
        water: { account: '', surname: '', meters: [] }, updatedAt: Date.now() };
      addrApply(np, { city: PW.city || null, typed: PW.cityTyped || '', street: PW.street || '' });
      S.places.push(np); switchPlace(np.id); WX.key = ''; save();
    }
    if (PW.n.waste) wasteAdd();   // вивіз сміття — без налаштування в черзі: люди й ціна — на його сторінці
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

  // ---------- «Рахунки з monobank» (114-а, власник 11.11): усе для передачі, крім показань, — з платежів за комуналку ----------
  // Токен і виписка — лише в пам’яті цієї сторінки (не в S, не в localStorage, не на сервер); журнал бачить тільки «поле заповнене».
  var Mn = window.TeploMono, MO = monoFresh();
  function monoFresh(back) { return { tok: '', st: '', err: '', q: [], i: 0, items: [], name: '', next: 0, timer: null, groups: [], sel: {}, sn: true, back: back || '', opened: false, bg: false }; }
  function monoLink(k) {
    if (!Mn) return '';
    return '<p class="mono-link"><a class="btn sec" href="#mono" data-act="mono-open" data-key="mono-open' + (k ? '-' + k : '') + '">' + ico('download', 18) + '<span>' + esc(t('mono_link')) + '</span></a>' +
      (k === 'prefs' ? '' : '<span class="small muted">' + esc(t('mono_link_s')) + '</span>') + '</p>';
  }
  /** Куди вписати рахунок групи: {f: поле для підпису, cur: що вписано зараз, ok: є куди} — вода/тепло на квартиру, світло/газ — у лічильник. */
  function monoTarget(g, kind, pid) {
    var p = place(pid) || {}, d = dgt(g.acc);
    // вивіз сміття (115-а): особовий рахунок і оплати — в історію вивозу (рахунку в призначенні може й не бути)
    if (kind === 'waste') { var ww = p.waste || {}, np = (g.pays || []).filter(function (x) { var o = Mn.payOf(x); return !Ws.dup(ww, o.date, o.amount); }).length;
      return { ok: true, f: 'mono_f_waste', cur: dgt(ww.account), waste: true, n: np, accNew: !!d && !dgt(ww.account) }; }
    if (!d) return { ok: false };
    if (kind === 'water') return { ok: true, f: 'mono_f_water', cur: dgt((p.water || {}).account) };
    if (kind === 'heat') { var hm = pid === S.placeId ? S.meter : p.meter; return hm ? { ok: true, f: 'mono_f_heat', cur: dgt(hm.account) } : { ok: false, why: 'mono_no_meter' }; }
    if (kind === 'elec' || kind === 'gas') {
      var ms = ((p.meters || []).filter(function (m) { return m && !m.deleted && !m.removed && m.kind === kind; }));
      if (!ms.length) return { ok: false, why: 'mono_no_meter' };
      var fld = kind === 'gas' ? Mn.gasField(g) : 'account', m = ms.filter(function (x) { return dgt(x[fld]) === d; })[0] || ms.filter(function (x) { return !dgt(x[fld]); })[0] || ms[0];
      return { ok: true, f: kind === 'gas' ? 'mono_f_' + fld : 'mono_f_elec', cur: dgt(m[fld]), meter: m.id, fld: fld };
    }
    return { ok: false, why: 'mono_no_kind' };
  }
  function monoErr(r) { return r.error === 'token' ? 'mono_e_403' : r.error === 'rate' ? 'mono_e_rate' : 'mono_e_net'; }
  function monoTick() {
    var el = document.getElementById('mono-wait'); if (!el) return;
    var s = Math.max(0, Math.ceil((MO.next - Date.now()) / 1000)); el.textContent = s > 0 ? t('mono_wait', { s: s }) : '';
  }
  /** Що позначити самим: є куди вписати, поле порожнє, рахунок із підписом (не «звірте»); вивіз — нові оплати чи рахунок. */
  function monoSelDef(g) {
    var tg = monoTarget(g, g.kind, S.placeId);
    return { on: !!(tg.ok && (tg.waste ? tg.n > 0 || tg.accNew : tg.cur !== dgt(g.acc) && !tg.cur && !g.guess)), kind: g.kind, place: S.placeId };
  }
  /** Ключ вставили (117-а: без кнопки «Знайти» — пошук іде сам, щойно в полі чи буфері є щось схоже на ключ). */
  function monoStart(tok) {
    if (tok === undefined) { var inp = document.getElementById('mono-tok'); tok = Mn.tokenFrom(inp ? inp.value : ''); }
    if (!Mn.tokenOk(tok)) { MO.err = 'mono_e_tok'; MO.opened = true; render(true); var i2 = document.getElementById('mono-tok'); if (i2) i2.focus(); return; }
    if (MO.tok === tok && (MO.st === 'run' || MO.bg)) return;   // input і paste приходять разом
    clearTimeout(MO.timer);
    MO = Object.assign(monoFresh(MO.back), { tok: tok, st: 'run', opened: true }); render(true);
    Mn.clientInfo(tok).then(function (r) {
      if (MO.tok !== tok) return;
      if (!r.ok) { MO = Object.assign(monoFresh(MO.back), { err: monoErr(r), opened: true }); render(true); return; }
      var accs = Mn.cards(r.data);
      if (!accs.length) { MO = Object.assign(monoFresh(MO.back), { err: 'mono_e_nocard', opened: true }); render(true); return; }
      MO.name = String((r.data && r.data.name) || ''); MO.q = Mn.plan(accs, Math.floor(Date.now() / 1000), Mn.MONTHS); MO.i = 0; monoStep();
    });
  }
  /** Виписка — по вікну на хвилину (правило monobank). Перше вікно (головна картка, останні 31 доба) — і одразу показуємо знайдене;
   *  старші місяці й інші картки дочитуємо фоном, нове додається в список (117-а: раніше людина чекала до 9 хвилин). */
  function monoStep() {
    if (!MO.tok) return;
    if (MO.i >= MO.q.length) { monoFinish(); return; }
    var tok = MO.tok;
    Mn.statement(tok, MO.q[MO.i]).then(function (r) {
      if (MO.tok !== tok) return;
      if (r.ok) { MO.items = MO.items.concat(Array.isArray(r.data) ? r.data : []); MO.i++; }
      else if (r.error !== 'rate') { if (MO.st === 'done' || MO.items.length) { monoFinish(); return; } MO = Object.assign(monoFresh(MO.back), { err: monoErr(r), opened: true }); render(true); return; }
      if (MO.i >= MO.q.length) { monoFinish(); return; }
      if (r.ok && MO.st === 'run') monoShow(); else if (MO.bg) monoMore();
      MO.next = Date.now() + Mn.GAP; if (MO.st === 'run' && routeName() === 'mono') render(true);
      MO.timer = setTimeout(monoStep, Mn.GAP);
    });
  }
  function monoShow() {
    MO.st = 'done'; MO.bg = true; MO.groups = Mn.groups(MO.items); MO.sel = {};
    MO.groups.forEach(function (g) { MO.sel[g.key] = monoSelDef(g); });
    if (routeName() === 'mono') render(true);
  }
  /** Фоном знайшли ще — нові рядки з тими ж правилами позначення; вибір людини в старих рядках не чіпаємо. */
  function monoMore() {
    var n0 = MO.groups.length; MO.groups = Mn.groups(MO.items);
    MO.groups.forEach(function (g) { if (!MO.sel[g.key]) MO.sel[g.key] = monoSelDef(g); });
    if (MO.groups.length !== n0 && routeName() === 'mono') render(true);
  }
  /** Прочитали все (чи людина сказала «досить»): ключ забуваємо, платежі — у групи. */
  function monoFinish() {
    clearTimeout(MO.timer); MO.tok = '';
    var n0 = MO.groups.length, first = MO.st !== 'done';
    MO.groups = Mn.groups(MO.items); MO.items = []; MO.bg = false; MO.st = 'done';
    if (first) MO.sel = {};
    MO.groups.forEach(function (g) { if (!MO.sel[g.key]) MO.sel[g.key] = monoSelDef(g); });
    if (routeName() !== 'mono') return;
    if (first || MO.groups.length !== n0) { render(true); return; }
    var bl = document.getElementById('mono-bg'); if (bl) bl.remove();
  }
  /** «Вставити ключ»: буфер обміну → ключ → пошук. Не дали прочитати буфер (Telegram, старий Safari) — фокус у поле, підказка. */
  function monoPaste() {
    var cb = navigator.clipboard;
    if (!cb || !cb.readText) { monoPasteNo(); return; }
    cb.readText().then(function (txt) {
      var tok = Mn.tokenFrom(txt);
      if (tok) monoStart(tok); else { MO.err = 'mono_e_clip'; MO.opened = true; render(true); }
    }, monoPasteNo);
  }
  function monoPasteNo() { MO.err = 'mono_e_clipno'; MO.opened = true; render(true); var i = document.getElementById('mono-tok'); if (i) i.focus(); }
  function monoApply() {
    clearTimeout(MO.timer); MO.tok = ''; MO.bg = false;
    var n = 0, sn = MO.sn && MO.name ? String(MO.name).trim().split(/\s+/)[0] : '';
    MO.groups.forEach(function (g) {
      var s = MO.sel[g.key]; if (!s || !s.on) return;
      var tg = monoTarget(g, s.kind, s.place), p = place(s.place), d = dgt(g.acc); if (!tg.ok || !p) return;
      if (s.kind === 'water') { p.water = JSON.parse(JSON.stringify(p.water || { account: '', surname: '', meters: [] })); p.water.account = d; if (sn && !String(p.water.surname || '').trim()) p.water.surname = sn; }
      else if (s.kind === 'waste') {
        p.waste = JSON.parse(JSON.stringify(p.waste || {})); var w = p.waste; w.on = true; w.at = w.at || today(); delete w.removed; w.pays = w.pays || [];
        if (d && !dgt(w.account) && !g.guess) w.account = d;
        if (!w.org && g.name) w.org = String(g.name).slice(0, 80);
        (g.pays || []).forEach(function (x, i) { var o = Mn.payOf(x); if (Ws.dup(w, o.date, o.amount)) return; w.pays.push({ id: 'wm' + x.time.toString(36) + i, ym: o.ym, n: 1, date: o.date, amount: o.amount, src: 'mono', updatedAt: Date.now() }); });
      }
      else if (s.kind === 'heat') { if (s.place === S.placeId && S.meter) { S.meter = Object.assign({}, S.meter, { account: d }); syncPlace(); } else if (p.meter) p.meter = Object.assign({}, p.meter, { account: d }); }
      else { p.meters = JSON.parse(JSON.stringify(p.meters || [])); p.meters.forEach(function (m) { if (m.id === tg.meter) { m[tg.fld] = d; if (s.kind === 'gas' && g.eic && !m.eic) m.eic = g.eic; } }); }
      p.updatedAt = Date.now(); n++;
    });
    if (!n) { toast(t('mono_nothing')); return; }
    save(); toast(t('mono_done', { n: n })); var back = MO.back || 'home'; MO = monoFresh(); go(back);
  }
  V.mono = function () {
    var back = MO.back || backTo('home'), h = '<h1>' + esc(t('mono_t')) + '</h1>';
    if (!Mn) return { screen: 'S45', route: 'mono', bare: true, closeTo: back, html: h };
    var kinds = ['heat', 'water', 'elec', 'gas', 'waste', 'house', 'other'];
    if (MO.st === 'run') {
      h += '<div class="panel mono-run" role="status" aria-live="polite" data-key="mono-run"><p><span class="spin" aria-hidden="true"></span> <b>' + esc(t('mono_run')) + '</b></p>' +
        '<p class="small muted" id="mono-wait"></p></div>' +
        '<div class="wiz-actions"><a class="btn sec" href="#' + esc(back) + '" data-act="mono-cancel">' + esc(t('cancel')) + '</a></div>';
      return { screen: 'S45', route: 'mono', bare: true, closeTo: back, html: h };
    }
    if (MO.st === 'done') {
      var bgLine = MO.bg ? '<p class="small muted mono-bg" id="mono-bg" role="status" data-key="mono-bg"><span class="spin" aria-hidden="true"></span> ' + esc(t('mono_bg')) + '</p>' : '';
      if (!MO.groups.length) return { screen: 'S45', route: 'mono', bare: true, closeTo: back, html: h + bgLine + (MO.bg ? '' : '<div class="panel" data-key="mono-none"><p>' + esc(t('mono_none')) + '</p></div>') + '<div class="wiz-actions"><a class="btn" href="#' + esc(back) + '" data-act="mono-cancel">' + esc(t('back')) + '</a></div>' };
      var many = places().length > 1, anyWater = false, main = [], rest = [];
      MO.groups.forEach(function (g, gi) {
        var s = MO.sel[g.key] || { kind: g.kind, place: S.placeId }, tg = monoTarget(g, s.kind, s.place), d = dgt(g.acc), same = tg.ok && (tg.waste ? !tg.n && (!d || tg.cur === d) : tg.cur === d);
        if (s.on && s.kind === 'water') anyWater = true;
        var can = tg.ok && !same, id = 'mono-' + gi;
        var to = tg.waste ? (same ? t('mono_same') : t('mono_to_waste', { n: tg.n }) + (tg.accNew && !g.guess ? ' · ' + t('mono_to_wacc') : '')) : !d ? t('mono_noacc') : same ? t('mono_same') : tg.ok ? t('mono_to', { f: t(tg.f) }) + (tg.cur ? ' · ' + t('mono_to_set', { a: tg.cur }) : '') : t(tg.why || 'mono_no_kind');
        var last = g.last ? fmtDate(new Date(g.last * 1000).toISOString().slice(0, 10)) : '';
        var known = /^(heat|water|elec|gas|waste)$/.test(g.kind), selK = '<select id="' + id + '-k" data-mono="' + gi + '" data-mf="kind" aria-label="' + esc(t('mono_kind')) + '">' +
          kinds.map(function (k) { return '<option value="' + k + '"' + (s.kind === k ? ' selected' : '') + '>' + esc(t('mono_k_' + k)) + '</option>'; }).join('') + '</select>';
        var selP = many ? '<select id="' + id + '-p" data-mono="' + gi + '" data-mf="place" aria-label="' + esc(t('mono_place')) + '">' +
          places().map(function (pp) { return '<option value="' + esc(pp.id) + '"' + (s.place === pp.id ? ' selected' : '') + '>' + esc(placeLabel(pp)) + '</option>'; }).join('') + '</select>' : '';
        // вид і квартира: відомий вид — у згорнутому «Не те?», невідомий (ОСББ, «інше») — одразу
        var sel = !d && !tg.waste && g.kind !== 'waste' ? '' : known && !many ? '<details class="mono-chg" data-key="mono-chg-' + gi + '"><summary class="small">' + esc(t('mono_chg')) + '</summary><div class="mono-sel">' + selK + '</div></details>'
          : '<div class="mono-sel">' + selK + selP + '</div>';
        (can ? main : rest).push('<div class="mono-g' + (can ? '' : ' off') + '" data-key="mono-g-' + gi + '">' +
          '<label class="check-row"><input type="checkbox" id="' + id + '" data-mono="' + gi + '" data-mf="on"' + (s.on && can ? ' checked' : '') + (can ? '' : ' disabled') + '><span><b>' + esc(g.name || t('mono_k_other')) + '</b>' +
          (d ? '<span class="mono-acc">' + esc(t('mono_acc', { a: d })) + '</span>' + (g.guess ? '<span class="small warn-ink mono-guess">' + esc(t('mono_guess')) + '</span>' : '') : '') + '</span></label>' +
          '<p class="small mono-to">' + esc(to) + '</p>' +
          '<p class="small muted">' + esc(t('mono_pays', { n: g.n, d: last, s: money(g.lastAmt) })) + '</p>' + sel + '</div>');
      });
      // 117-а: на виду — лише те, що можна вписати; решта (уже вписане, без рахунку, ОСББ) — згорнуто
      h += '<p class="muted">' + esc(t(main.length ? 'mono_pick' : 'mono_nonew')) + '</p>' + bgLine + '<div class="mono-list" data-key="mono-list">' + main.join('') +
        (rest.length ? '<details class="mono-more" data-key="mono-more"' + (main.length ? '' : ' open') + '><summary>' + esc(t('mono_more', { n: rest.length })) + '</summary>' + rest.join('') + '</details>' : '') + '</div>';
      var sn = MO.name ? String(MO.name).trim().split(/\s+/)[0] : '';
      if (sn && anyWater) h += '<label class="check-row mono-sn" data-key="mono-sn"><input type="checkbox" id="mono-sn" data-mono="sn" data-mf="sn"' + (MO.sn ? ' checked' : '') + '><span>' + esc(t('mono_sn', { s: sn })) + '<span class="small muted"> · ' + esc(t('mono_sn_h')) + '</span></span></label>';
      h += '<div class="wiz-actions"><a class="btn sec" href="#' + esc(back) + '" data-act="mono-cancel">' + esc(t(main.length ? 'cancel' : 'back')) + '</a>' +
        (main.length ? '<button type="button" class="btn" data-act="mono-apply" data-key="mono-apply">' + ico('check', 20) + '<span>' + esc(t('mono_apply')) + '</span></button>' : '') + '</div>' +
        '<p class="mono-again"><button type="button" class="linkbtn small" data-act="mono-again" data-key="mono-again">' + esc(t('mono_again')) + '</button></p>';
      return { screen: 'S45', route: 'mono', bare: true, closeTo: back, html: h };
    }
    // 117-а (власник: «люди не зрозуміють, що це й навіщо — щоб в одну кнопку»): дві дії — «Відкрити monobank» і «Вставити ключ».
    // Справжньої «однієї кнопки» (згода в застосунку без ключа) monobank дає лише сервісам відкритого банкінгу за вимогами НБУ.
    var phone = !!((window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '')), op = !!MO.opened;
    var err = MO.err ? '<div class="help bad" role="alert" data-key="mono-err">' + esc(t(MO.err)) + '</div>' : '';
    h += '<p class="muted mono-lead">' + esc(t('mono_l')) + '</p><ol class="mono-steps" data-key="mono-intro">' +
      '<li class="' + (op ? 'done' : 'now') + '"><b>' + esc(t('mono_s1')) + '</b><p class="small muted">' + esc(t(phone ? 'mono_s1p' : 'mono_s1d')) + '</p>' +
        '<a class="btn' + (op ? ' sec' : '') + '" href="' + Mn.TOKEN_URL + '" target="_blank" rel="noopener noreferrer" data-act="mono-ext" data-key="mono-api">' + ico('ext', 18) + '<span>' + esc(t('mono_open')) + '</span></a></li>' +
      '<li class="' + (op ? 'now' : '') + '"><b>' + esc(t('mono_s2')) + '</b><p class="small muted">' + esc(t('mono_s2h')) + '</p>' +
        '<button type="button" class="btn' + (op ? '' : ' sec') + '" data-act="mono-paste" data-key="mono-paste">' + ico('copy', 18) + '<span>' + esc(t('mono_paste')) + '</span></button>' +
        '<div class="field mono-tokf"><label for="mono-tok" class="small">' + esc(t('mono_tok')) + '</label><div class="ctl"><input id="mono-tok" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" data-key="mono-tok"></div></div>' + err + '</li></ol>' +
      '<div class="small muted mono-priv" data-key="mono-priv"><p>' + ico('shield', 16) + ' ' + esc(t('mono_priv_s')) + '</p><details><summary>' + esc(t('mono_priv_more')) + '</summary><p>' + esc(t('mono_priv')) + '</p></details></div>' +
      '<div class="wiz-actions"><a class="btn sec" href="#' + esc(back) + '" data-act="mono-cancel">' + esc(t('cancel')) + '</a></div>';
    return { screen: 'S45', route: 'mono', bare: true, closeTo: back, html: h };
  };
  setInterval(function () { if (MO.st === 'run') monoTick(); }, 1000);
  // ключ у полі: щойно схоже на ключ — шукаємо (без кнопки); Enter — те саме, з підказкою, якщо не схоже
  document.addEventListener('input', function (e) { if (Mn && e.target && e.target.id === 'mono-tok') { var tk = Mn.tokenFrom(e.target.value); if (tk) monoStart(tk); } });
  document.addEventListener('keydown', function (e) { if (Mn && e.key === 'Enter' && e.target && e.target.id === 'mono-tok') { e.preventDefault(); monoStart(); } });
  // вибір у списку: галочка, вид, квартира — без перемальовки всієї сторінки, крім виду/квартири (міняють «Впишемо: …»)
  document.addEventListener('change', function (e) {
    var el = e.target, gi = el && el.getAttribute && el.getAttribute('data-mono'); if (gi === null || gi === undefined || gi === '') return;
    var f = el.getAttribute('data-mf');
    if (gi === 'sn') { MO.sn = el.checked; return; }
    var g = MO.groups[+gi]; if (!g) return; var s = MO.sel[g.key] = MO.sel[g.key] || { kind: g.kind, place: S.placeId };
    if (f === 'on') { s.on = el.checked; if (s.kind === 'water') render(true); return; }
    s[f] = el.value; var tg = monoTarget(g, s.kind, s.place); s.on = !!(tg.ok && tg.cur !== dgt(g.acc)); render(true);
  });
  /** Какой счётчик добавить: опалення · гаряча · холодна · газ (скоро) · електрика (скоро); прибранные — «Повернути». */
  var AM_BACK = 'home';
  V['add-meter'] = function () {
    var rows = KIND_ORDER.map(function (k) {
      var K = KINDS[k], n = kindCount(k), icon = ico(K.icon, 26, K.cls);
      if (K.soon) return '<div class="wz-opt am-opt am-soon" aria-disabled="true" data-key="am-' + k + '">' + icon + '<span><b>' + esc(t(K.t)) + '</b><span class="small muted">' + esc(t(K.s)) + '</span></span><span class="pill">' + esc(t('kd_soon')) + '</span></div>';
      if (n >= K.max) return '<a class="wz-opt am-opt am-have" href="#' + (k === 'heat' ? 'heat' : k === 'waste' ? 'waste' : SK[k] ? SK[k].page : 'water-' + k) + '" data-key="am-' + k + '">' + icon + '<span><b>' + esc(t(K.t)) + '</b><span class="small muted">' + esc(t('kd_have_all')) + '</span></span><span class="pill ok">' + esc(t('kd_have')) + '</span></a>';
      // вивіз сміття: за адресою вже знаємо, хто вивозить і почому — одразу в підписі
      var ks = k === 'waste' && wasteDir(place()) && wasteDir(place()).org && R.num(wasteDir(place()).price) > 0 ? t('ws_add_dir', { org: ploc(wasteDir(place()), 'org'), p: money(R.num(wasteDir(place()).price)) }) : t(K.s);
      return '<button type="button" class="wz-opt am-opt" data-act="am-pick" data-kind="' + k + '" data-key="am-' + k + '">' + icon + '<span><b>' + esc(t(K.t)) + '</b><span class="small muted">' + esc(n ? t('kd_have_n', { n: n }) : ks) + '</span></span>' + ico('chev', 20) + '</button>';
    }).join('');
    var rm = removedMeters(), back = AM_BACK || 'home';
    var restore = rm.length ? '<h2 class="section-title">' + esc(t('am_restore_t')) + '</h2><div class="wz-opts">' + rm.map(function (x) {
      return '<button type="button" class="wz-opt am-opt" data-act="m-restore" data-what="' + esc(x.what) + '" data-back="1" data-key="am-restore-' + esc(x.what) + '">' + ico(KINDS[x.kind].icon, 26, KINDS[x.kind].cls) + '<span><b>' + esc(t('am_restore') + ': ' + x.title) + '</b><span class="small muted">' + esc(t('am_removed_on', { d: fmtDate(x.at, true) })) + '</span></span></button>';
    }).join('') + '</div>' : '';
    return { screen: 'S40', route: 'add-meter', bare: true, closeTo: back, html: '<h1>' + esc(t('am_title')) + '</h1><p class="muted">' + esc(t('am_lead')) + '</p><div class="wz-opts am-list">' + rows + '</div>' + restore +
      '<div class="wiz-actions"><a class="btn sec" href="#' + esc(back) + '">' + esc(t('cancel')) + '</a></div>' };
  };

  /** Новый водомер одной страницей: где стоит, показания сейчас; № и повірка — свёрнуто. Рахунок Водоканалу здесь не спрашиваем (114-я) — перед передачей. */
  var WA = { kind: 'cold', back: '' };
  V.wadd = function () {
    var k = WA.kind, same = wmeters(k), back = WA.back || backTo('home'), opt = ' <span class="muted small">(' + esc(t('b_opt')) + ')</span>';
    var fld = function (id, lbl, attrs, unit, help, optional, after) { return '<div class="field"><label for="' + id + '">' + esc(lbl) + (optional ? opt : '') + '</label><div class="ctl"><input id="' + id + '" ' + attrs + '>' + (unit ? '<span class="unit">' + unit + '</span>' : '') + (after || '') + '</div>' + (help ? '<div class="help">' + esc(help) + '</div>' : '') + '</div>'; };
    var h = pqBanner() + '<h1>' + ico('drop', 26, KINDS[k].cls) + ' ' + esc(t('wa_title', { k: wkindTitle(k).toLowerCase() })) + '</h1><p class="muted">' + esc(t('wa_lead')) + '</p><form id="wa-form" novalidate><div class="panel">' +
      fld('wa-name', t('wa_name'), 'maxlength="40" autocomplete="off" placeholder="' + esc(t('wa_name_ph')) + '"', '', same.length ? t('wa_name_need', { n: same.length }) : t('wa_name_h'), !same.length) +
      (same.length === 1 && !same[0].name ? fld('wa-name0', t('wa_name0'), 'maxlength="40" autocomplete="off" placeholder="' + esc(t('wa_name0_ph')) + '"', '', '', true) : '') +
      phHelp(fld('wa-val', t('wa_val'), 'class="num" inputmode="decimal" autocomplete="off"', 'м³', t('wa_val_h'), true, startCam('wa-val', wkindTitle(k))), 'wa-val') +
      (function () {   // № і повірка — згорнуто (власник 11.11: при налаштуванні — лише показання)
        var g = '<div class="grid2">' + fld('wa-serial', t('wm_serial'), 'class="num" autocomplete="off"', '', '', true) + fld('wa-ver', t('mv_date'), 'type="date"', '', '', true) + '</div>';
        return '<details class="mbox-set wa-more" data-key="wa-more"><summary>' + ico('prefs', 18, 'bt-ico') + '<span>' + esc(t('wa_more')) + opt + '</span>' + ico('chev', 18, 'pacc-chev') + '</summary><div class="mbox-set-b">' + g + '</div></details>';
      })() +
      '<div class="help block" id="wa-err" role="alert"></div></div>' +
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
      setPMeters(function (list) { list.forEach(function (m) { if (m.id === mid) { m[f] = v; if (f === 'account') moved = gasMove(m); } }); }); toast(moved ? t('gm_moved') : t('b_saved')); if (f === 'zones') { MB_OPEN[mid] = true; render(true); } else if (f === 'account' || f === 'name' || f === 'grm' || f === 'eic' || f === 'verifiedUntil') { MB_OPEN[mid] = true; safeRender(); } return; }
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
  function prefGroup(id, icon, title, sub, html, dflt) {
    return '<details class="pgroup" id="pg-' + id + '" data-key="pg-' + id + '"' + ((PREF_OPEN[id] !== undefined ? PREF_OPEN[id] : dflt) ? ' open' : '') + '><summary>' + ico(icon, 22) + '<span class="pg-t"><b>' + esc(title) + '</b>' + (sub ? '<span class="small muted">' + esc(sub) + '</span>' : '') + '</span>' + ico('chev', 20, 'pacc-chev') + '</summary><div class="pg-body">' + html + '</div></details>';
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
      '<div class="field" style="max-width:260px"><label for="p-area">' + esc(t('nm_area')) + ' <span class="muted small">(' + esc(t('b_opt')) + ')</span></label><div class="ctl"><input id="p-area" class="num" inputmode="decimal" autocomplete="off" value="' + esc(p.area ? String(p.area).replace('.', ',') : '') + '"><span class="unit">м²</span></div><div class="small muted">' + esc(t('nm_area_h')) + '</div>' + areaHint() + '</div></div>';
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
      // monobank — окремим пунктом (власник 11.11: «не побачив, де monobank»): рахунки всіх квартир і оплати вивозу сміття з виписки
      Mn ? prefGroup('mono', 'download', t('mono_t'), t('mono_link_s'), '<div class="panel" data-key="prefs-mono"><p>' + esc(t('mono_l')) + '</p><p class="small muted">' + esc(t('mono_pg_h')) + '</p>' + monoLink('prefs') + '</div>') : '',
      prefGroup('heat', 'thermo', t('pg_heat'), hasHeat() ? modelName(m) : t('pg_heat_none'), meterPanel() + '<div class="panel" data-key="prefs-bill"><h2>' + esc(t('p_tariff')) + (places().length > 1 ? ' <span class="muted small">· ' + esc(placeLabel(place())) + '</span>' : '') + '</h2><p class="small muted">' + esc(t('p_tariff_sub')) + '</p>' +
        '<div class="grid2"><div class="field"><label for="p-tariff">' + esc(t('p_tariff_l')) + '</label><div class="ctl"><input id="p-tariff" class="num" inputmode="decimal" data-key="prefs-tariff" value="' + esc(tariff().toFixed(2).replace('.', ',')) + '"></div></div>' +
        '<div class="field"><label for="p-abon">' + esc(t('p_abon_l')) + '</label><div class="ctl"><input id="p-abon" class="num" inputmode="decimal" value="' + esc(bill().abon.toFixed(2).replace('.', ',')) + '"></div></div>' +
        mzkField() + '</div>' +
        '<details class="tips-box" style="margin-top:12px"><summary>' + esc(t('p_bill_how_t')) + '</summary><p class="small">' + esc(t('p_bill_how')) + '</p></details></div>' +
      (hasHeat() ? nometerHeatPanel() : '')),
      prefGroup('water', 'drop', t('pg_water'), ms.length ? t('pg_water_n', { n: ms.length }) : t('pg_heat_none'), waterPanel() + wtariffPanel() + (ms.length ? nometerWaterPanel() : '')),
      prefGroup('cabs', 'send', t('pg_cabs'), cabsSub(), cabsPanel()),
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
      '<footer class="legal-foot" data-key="prefs-legal"><a href="#privacy">' + esc(t('lg_privacy')) + '</a><a href="#terms">' + esc(t('lg_terms')) + '</a>' + (window.TEPLO_API ? '<button type="button" class="linkbtn" data-act="cc-open" data-key="prefs-cookie">' + esc(t('cc_link')) + '</button>' : '') + '</footer>' };
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
  /** Поле пароля з кнопкою «Показати» (людям 45+ легше перевірити, що ввели); підказка про 8 символів — лише для нового пароля. */
  function passField(id, lbl, auto) {
    return '<div class="field"><label for="' + id + '">' + esc(lbl) + '</label><div class="ctl"><input id="' + id + '" type="password" autocomplete="' + auto + '" minlength="8" required' + (auto === 'new-password' ? ' aria-describedby="' + id + '-h"' : '') + '>' +
      '<button type="button" class="ctl-copy ctl-eye" data-act="pass-eye" data-for="' + id + '" aria-pressed="false" aria-label="' + esc(t('pass_show')) + '" title="' + esc(t('pass_show')) + '" data-key="' + id + '-eye">' + ico('eye', 20) + '</button></div>' +
      (auto === 'new-password' ? '<div class="help" id="' + id + '-h">' + esc(t('login_pass_hint')) + '</div>' : '') + '</div>';
  }
  function emailField(val) {
    return '<div class="field"><label for="a-email">' + esc(t('login_email')) + '</label><div class="ctl"><input id="a-email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" required' + (val ? ' value="' + esc(val) + '"' : '') + '></div></div>';
  }
  function authFields(passAuto) { return emailField('') + passField('a-pass', t('login_pass'), passAuto); }
  // Вхід (123-я, власник 12.11: «красиво, понятно и удобно»): одна колонка — Telegram першим (без пароля), «або поштою», одна форма з перемикачем
  // «Увійти / Створити акаунт», «Показати» пароль, «Забули пароль?» → лист із посиланням (#reset-…). authMode: login | register | forgot | sent.
  // RESET_TOK може бути вже взятий з адреси (routeName кличуть під час запуску, раніше за цей рядок) — не затирати
  var authMode = 'login', FG_EMAIL = '', RESET_TOK = RESET_TOK || '', RS_EXPIRED = RS_EXPIRED || false;
  V.login = function () {
    var y = Y(), base = { screen: 'S13', route: 'login', bare: !S.onboarded, closeTo: S.onboarded ? 'home' : 'welcome' };
    if (y.account) return Object.assign(base, { html: '<h1>' + esc(t('login_title')) + '</h1><p>' + esc(t('sync_server')) + '</p><a class="btn" href="#' + (S.meter ? 'home' : 'meter') + '">' + esc(t('next')) + '</a>' });
    if (y.mode !== 'server') return Object.assign(base, { html: '<h1>' + esc(t('login_title')) + '</h1>' + syncPanel() });
    var m = authMode, reg = m === 'register', bot = y._cfg && y._cfg.botUsername, skip = '<p class="auth-skip"><a href="#' + (S.onboarded ? 'home' : 'welcome') + '" data-key="login-skip">' + esc(t('login_skip')) + '</a></p>';
    if (m === 'sent') return Object.assign(base, { html: '<h1>' + esc(t('login_title')) + '</h1><div class="auth"><section class="panel auth-sent" data-key="login-sent" role="status">' +
      '<h2 class="auth-h">' + ico('mail', 22) + esc(t('fg_sent_t')) + '</h2><p>' + esc(t('fg_sent', { e: FG_EMAIL })) + '</p><p class="small muted">' + esc(t('fg_spam')) + '</p>' +
      '<div class="auth-acts"><button type="button" class="btn sec block" data-act="auth-mode" data-m="forgot" data-key="login-again">' + esc(t('fg_again')) + '</button>' +
      '<button type="button" class="linkbtn" data-act="auth-mode" data-m="login" data-key="login-back">' + esc(t('fg_back')) + '</button></div></section></div>' });
    if (m === 'forgot') return Object.assign(base, { html: '<h1>' + esc(t('login_title')) + '</h1><div class="auth">' +
      '<form id="forgot-form" class="panel" novalidate data-key="forgot-form"><h2 class="auth-h">' + ico('mail', 22) + esc(t('fg_title')) + '</h2><p class="small muted">' + esc(t('fg_lead')) + '</p>' + emailField(FG_EMAIL) +
      '<div class="help block" id="forgot-err" role="alert"></div><button class="btn block" type="submit" data-key="forgot-submit">' + esc(t('fg_btn')) + '</button>' +
      '<div class="auth-acts"><button type="button" class="linkbtn" data-act="auth-mode" data-m="login" data-key="login-back">' + esc(t('fg_back')) + '</button></div>' +
      (bot ? '<p class="small muted auth-note">' + esc(t('fg_tg')) + '</p>' : '') + '</form></div>' });
    var tg = bot ? '<section class="panel auth-tg" data-key="login-telegram"><h2 class="auth-h">' + ico('send', 22) + esc(t('login_tg')) + '</h2><p class="small muted">' + esc(t('login_tg_sub2', { bot: bot })) + '</p>' +
      '<div id="tg-widget" class="auth-widget" data-onauth="TeploTgAuth"></div>' +
      '<a class="btn sec block" href="https://t.me/' + esc(bot) + '" target="_blank" rel="noopener" data-key="login-tg-open">' + ico('send', 20) + '<span>' + esc(t('login_tg_btn', { bot: bot })) + '</span></a>' +
      '<details class="auth-more"><summary>' + esc(t('login_tg_more')) + ico('chev', 16, 'auth-chev') + '</summary><p class="small muted">' + esc(t('login_tg_same')) + '</p></details></section>' +
      '<p class="auth-or" aria-hidden="true"><span>' + esc(t('login_or')) + '</span></p>' : '';
    return Object.assign(base, { html: '<h1>' + esc(t('login_title')) + '</h1><p class="auth-lead">' + esc(t('login_lead2')) + '</p><div class="auth">' + tg +
      '<form id="login-form" class="panel" data-mode="' + m + '" novalidate data-key="login-form">' +
      '<div class="kind-sw auth-sw" role="group" aria-label="' + esc(t('login_sw')) + '">' +
      '<button type="button" data-act="auth-mode" data-m="login" aria-pressed="' + !reg + '" data-key="login-mode-in">' + esc(t('login_btn')) + '</button>' +
      '<button type="button" data-act="auth-mode" data-m="register" aria-pressed="' + reg + '" data-key="login-toggle">' + esc(t('register_btn')) + '</button></div>' +
      authFields(reg ? 'new-password' : 'current-password') +
      '<div class="help block" id="login-err" role="alert"></div><button class="btn block" type="submit" data-key="login-submit">' + esc(reg ? t('register_btn') : t('login_btn')) + '</button>' +
      (reg ? '<p class="small muted auth-note">' + esc(t('login_reg_note')) + '</p>' : '<div class="auth-acts"><button type="button" class="linkbtn" data-act="auth-mode" data-m="forgot" data-key="login-forgot">' + esc(t('login_forgot')) + '</button></div>') +
      '</form>' + skip + '</div>' });
  };
  /** Новий пароль за посиланням із листа: токен уже прибрано з адреси (routeName), щоб не потрапив у журнал. */
  V.reset = function () {
    var base = { screen: 'S13r', route: 'reset', bare: !S.onboarded, closeTo: S.onboarded ? 'home' : 'welcome' };
    if (RS_EXPIRED || !RESET_TOK) return Object.assign(base, { html: '<h1>' + esc(t('rs_title')) + '</h1><div class="auth"><section class="panel" data-key="reset-expired" role="alert"><p>' + esc(t('err_reset_expired')) + '</p>' +
      '<div class="auth-acts"><a class="btn block" href="#login" data-act="auth-mode" data-m="forgot" data-key="reset-new">' + esc(t('rs_new')) + '</a></div></section></div>' });
    // режим синхронізації на свіжому завантаженні ще не відомий — форма не чекає на нього (сервер недоступний — скаже помилка запиту)
    return Object.assign(base, { html: '<h1>' + esc(t('rs_title')) + '</h1><div class="auth"><form id="reset-form" class="panel" novalidate data-key="reset-form"><p class="small muted">' + esc(t('rs_lead')) + '</p>' +
      passField('r-pass', t('rs_pass'), 'new-password') + '<div class="help block" id="reset-err" role="alert"></div><button class="btn block" type="submit" data-key="reset-submit">' + esc(t('rs_btn')) + '</button></form></div>' });
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
    PH.inboxAt = Math.max.apply(null, items.map(function (x) { return +x.takenAt || 0; })); hcLoad(true); vjLoad(true); vksLoad();   // автоподача: дата зняття — коли сфотографовано
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
    var model_ = PH.mode === 'model', base_ = PH.mode === 'baseline', back = model_ ? 'meter' : base_ ? 'baseline' : (S.onboarded ? backTo('home') : 'welcome');
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
    return shell_(lead + err + input + (PH.files.length ? thumbs(true) : '') + date + '<div class="row-actions">' + pick + camBtn({ in: 'ph-input', kind: 'heat' }, 'btn sec' + (PH.files.length ? '' : ' big')) + go_ + '</div>' + '<p class="small muted" style="margin-top:16px">' + esc(t('ph_privacy')) + '</p>');
  }
  function photoResult() {
    if (hcOn() && PH.mode === 'reading') hcLoad();
    var p = PH.picked || {}, res = PH.result || {}, mt = res.meter || {}, h = phAutoBanner();
    var mm = mt.modelId ? M.byId(mt.modelId) : null;
    if (mm && (!S.meter || S.meter.modelId !== mm.id)) h += '<div class="banner" data-key="photo-meter">' + ico('info', 22) + '<div><p><b>' + esc(t('ph_meter_found', { m: modelName(mm) })) + '</b></p><p><button class="linkbtn" data-act="ph-use-model" data-id="' + mm.id + '" data-unit="' + esc(mt.energyUnit || '') + '">' + esc(t('ph_meter_use')) + '</button></p></div></div>';
    var noteTxt = function (x) { return x.note ? (t('pn_' + x.note) !== 'pn_' + x.note && t('pn_' + x.note) ? t('pn_' + x.note) : x.note) : ''; };
    var INFO = { test_screen: 1, dt_screen: 1, loop_screen: 1, archive_screen: 1 };   // служебные экраны — не ошибка, просто пояснение
    var info = (res.photos || []).filter(function (x) { return INFO[x.note] && !(x.readings || []).length; });
    var bad = (res.photos || []).filter(function (x) { return !(PH.waterIdx && PH.waterIdx.indexOf(x.index) >= 0 && wmeters().length) && !INFO[x.note] && ((x.quality && x.quality !== 'ok') || (x.meterType && x.meterType !== 'heat') || (res.engine === 'local' && x.note)); });
    if (PH.waterIdx && PH.waterIdx.length && wmeters().length) h += '<div class="banner" data-key="photo-water">' + ico('drop', 22, 'c-cold') + '<div><p><b>' + esc(t('wnp_mixed', { list: PH.waterIdx.map(function (i) { return i + 1; }).join(', ') })) + '</b></p><p><button class="btn sec" data-act="ph-water" data-key="photo-water-go">' + esc(t('wnp_mixed_go')) + '</button></p></div></div>';
    var miss = R.FIELDS.filter(function (f) { return f.key !== 'date' && f.key !== 'tReturn' && !p[f.key]; }).map(function (f) { return fieldLabel(f.key).toLowerCase(); });
    // екрани в іншій петлі (T330 — LOOP 1, ELF — група 1, Kamstrup — TECH…): одразу кажемо, як туди потрапити
    var lsh = miss.length ? L((loopsOf(mm || model()).short) || null) : '';
    if (miss.length) h += '<div class="banner">' + ico('info', 22) + '<div><p>' + esc(t('ph_missing_screens', { list: miss.join(', ') })) + '</p><p>' + esc(lsh ? t('ph_missing_loop', { tip: lsh }) : t('ph_missing_any')) + '</p></div></div>';
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
    var bg = PH.mode === 'reading' && hcOn() && hcConn() && !(PH.waterIdx && PH.waterIdx.length && wmeters().length);
    return h + '<div class="row-actions"><button class="btn ghost" data-act="ph-new">' + esc(t('ph_new')) + '</button><button class="btn sec" data-act="ph-again">' + esc(t('ph_add')) + '</button><button class="btn' + (bg ? ' sec' : '') + '" data-act="ph-apply" data-to="check" data-key="photo-check">' + esc(PH.mode === 'baseline' ? t('ph_to_base') : t('ph_to_check')) + '</button>' +
      (bg ? '<button class="btn dest-bg" data-act="ph-bg" data-key="photo-bg"' + (HC.busy ? ' disabled' : '') + '>' + ico('send', 18) + '<span>' + esc(t('cab_bg')) + '</span></button>' : '') + '</div>' +
      (bg ? '<p class="small dest-note" data-key="photo-bg-note">' + esc(t('ph_bg_note')) + '</p>' : '');
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
        PH.status = 'idle'; PH.error = t('ph_add_' + simple.k); cardFix(PH.error); render(true); return;
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
      if (!Object.keys(PH.picked).length) { PH.status = 'idle'; PH.error = phErr('nothing'); cardFix(PH.error); render(true); return; }
      PH.status = 'done'; PH.vals = null; PH.autoWhy = null;
      if (CARD.id && PH.inbox && PH.mode === 'reading' && !CARD.posted) { cardHeatSoon(0); return; }
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
    if (need) enRun([]); else { enAssign(); render(true); enCheck(true); enReport(); if (CARD.id) cardSimple(k); }
  }
  /** Фото водомеров из пачки (или из бота) → ввод воды: окна барабанов уже прочитаны — раскладываем по водомерам. */
  function phToWater(all) {
    var idx = PH.waterIdx || [], byIdx = {};
    (PH.result && PH.result.photos || []).forEach(function (x) { byIdx[x.index] = x; });
    WN = wnFresh('hot'); WN.date = PH.date && PH.date !== today() ? PH.date : '';
    idx.forEach(function (i) { var f = PH.files[i]; if (!f) return; var o = byIdx[i] && byIdx[i].ocr; WN.photos.push({ file: f, url: URL.createObjectURL(f), res: o ? { lines: o.lines || [], drums: o.drums || [] } : null, meters: [] }); });
    WN.inbox = idx.map(function (i) { return PH.files[i] && PH.files[i]._srv; }).filter(function (id) { return id && PH.inbox && PH.inbox.indexOf(id) >= 0; });
    if (all) phReset('reading'); else WN.back = 'photo';
    var need = WN.photos.some(function (p) { return !p.res; }), auto = all && WN.inbox.length && hcOn();
    go('wnew');
    if (need) wnRun([]); else { wnAssign(); render(true); wnCheck(true); if (CARD.id && all) cardWaterSoon(WN, 0); else if (auto) wnAutoSoon(WN, 0); }
  }
  /** Автоподача (фото з бота, увімкнено на екрані кабінету ХТМ): чому НЕ вносимо самі — або null, якщо все гаразд.
   *  Вносимо лише те, що прочитано впевнено, повністю й без жодного зауваження перевірки — інакше звичайна перевірка людиною. */
  function phAutoWhy() {
    var p = PH.picked || {}, keys = htmFields().filter(function (f) { return f.key !== 'date'; }).map(function (f) { return f.key; });   // кабінет з Pd — і третій час
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
    htmFields().forEach(function (f) { if (f.key !== 'date' && p[f.key]) { vals[f.key] = String(p[f.key].value); conf[f.key] = p[f.key].confidence; } });
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
  function phApply(bg) {
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
    // «Відправити у фоні»: перевірка без замечаний-блоков — сразу запис «перевірено» і в кабінет; блок — на екран перевірки (нічого не шлемо)
    var chk = bg ? runCheck(dr) : null;
    if (chk && chk.verdict !== 'block') { S._lastCheck = chk; var rb = saveReading('checked'); delete S._lastCheck; S.focusId = rb.id; save(); go('handover'); hcBg(rb.id); }
    else { save(); go('check'); }
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
      return '<li><b>' + pressText(s) + '</b> — ' + esc(s.fields.map(fieldLabel).join(', ')) + '. ' + esc(L(s.hint)) + '</li>';
    }).join('') + '</ol><p><b>' + esc(t('s_loops')) + '</b> ' + esc(L(loopsOf(m).tip)) + '</p>' : '';
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
  // iOS 26 Safari: після клавіатури visualViewport.offsetTop не скидається — нижні вкладки й «Відгук» «пливуть» угору посеред екрана (WebKit 297779,
  // Apple forums 800154; владелец 10.11). Поправка: клавіатура закрита, без масштабу, низ видимої області нижче низу макета на > 40 px — зсуваємо їх униз (--nav-shift).
  (function () {
    var vv = window.visualViewport; if (!vv) return;
    var last = 0, logged = 0;
    var fix = function () {
      var a = document.activeElement, kb = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName), gap = vv.offsetTop + vv.height - window.innerHeight;
      // 123-я: потягнув сторінку вниз (оновити) — прокрутка вище за верх, offsetTop іде за нею (журнал 12.11, iPhone власника: sy = ot = −70…−189) —
      // це не застряглий шар, вкладки не чіпаємо
      var over = (window.scrollY || 0) < 0;
      var sh = !kb && !over && vv.scale < 1.01 && Math.abs(gap) > 40 ? Math.round(gap) : 0;
      document.documentElement.style.setProperty('--nav-shift', sh + 'px');
      // у журнал (/api/health → errs.navShift): чи спрацьовує поправка на справжніх iPhone і з якими висотами — перевірка без телефона власника (89-а)
      // 106-а: видно < 40 % сторінки без зсуву — людина згортає чи закриває застосунок (журнал 11.11: 461 → 50 → 0 px за секунду) — не пишемо
      // 111-а: у журналі сеанс на 346 nav_shift за хвилину (лендинг, iPhone, ot росте з прокруткою до 6000) — пишемо не більше 8 за завантаження,
      // з прокруткою сторінки (sy) і висотою документа (dh): ot ≈ прокрутка при sy ≈ 0 — шар фіксованих справді «застряг» угорі, поправка вірна
      if (sh && sh !== last && logged < 8 && !(vv.height < window.innerHeight * .4 && vv.offsetTop < 1)) try { logged++; track('nav_shift', { g: sh, ih: Math.round(window.innerHeight), vh: Math.round(vv.height), ot: Math.round(vv.offsetTop), sy: Math.round(window.scrollY || 0), dh: Math.round(document.documentElement.scrollHeight || 0) }); } catch (e) { /* журнал ще не готовий */ }
      last = sh;
    };
    vv.addEventListener('resize', fix); vv.addEventListener('scroll', fix); window.addEventListener('scroll', fix, { passive: true });
    document.addEventListener('focusout', function () { setTimeout(fix, 400); });
  })();
  function routeName() {
    var h = (location.hash || '').replace(/^#/, ''), rt = h.match(/^reset-([a-f0-9]{48})$/);
    // посилання з листа «новий пароль» (123-я): токен — у змінну, з адреси геть (інакше потрапив би в журнал, історію й скріни)
    if (rt) { RESET_TOK = rt[1]; RS_EXPIRED = false; try { history.replaceState(null, '', location.pathname + location.search + '#reset'); } catch (e) { /* старий браузер */ } return 'reset'; }
    return /^tgWebApp/.test(h) ? '' : h;
  }
  // «✕» і «Назад» — туди, звідки прийшли (89-а, власник 10.11: відкрив ввод показань з екрана квартири — закриття веде на квартиру, а не на сторінку виду).
  // Потік — введення, майстри, кабінети, записи історії; NAV.from — останній звичайний екран (з вкладками) перед потоком; вийшли з потоку — скидається.
  // Явне «куди» (WN.back, EN.back — правка запису, «з фото») — головніше.
  var NAV = { cur: '', from: '' }, FLOW_RE = /^(wnew|enew|gnew|wadd|eadd|gadd|wsetup|add-meter|add-place|step-\d+|check|handover|photo|vkcab|htmcab|rec-|wrec-|erec-|hnar-|gap-|wpay)/;
  function navNote(r) {
    var prev = NAV.cur; NAV.cur = r; if (!prev || prev === r) return;
    if (FLOW_RE.test(r)) { if (!FLOW_RE.test(prev)) NAV.from = prev; } else NAV.from = '';
  }
  /** «← Історія показань» над записом; відкрили запис з іншого екрана (сторінка виду, квартира) — «← Назад» туди. */
  function recBack() { var b = backTo('history'); return '<p><a href="#' + b + '" data-key="rec-back">← ' + esc(b === 'history' ? t('hi_title') : t('back')) + '</a></p>'; }
  /** Кнопка «Назад» у шапці Telegram (Mini App 6.1+): веде туди ж, куди «✕» чи «← Назад» на екрані; на головній — схована. */
  var TGB = { to: '', on: false };
  function tgBack(to) {
    var tb = window.Telegram && window.Telegram.WebApp, bb = tb && tb.initData && tb.BackButton; if (!bb) return;
    try {
      if (tb.isVersionAtLeast && !tb.isVersionAtLeast('6.1')) return;
      if (!TGB.on) { TGB.on = true; bb.onClick(function () { if (TGB.to) go(TGB.to); }); }
      TGB.to = to; if (to) bb.show(); else bb.hide();
    } catch (e) { /* старий Telegram */ }
  }
  function backTo(dflt) { return NAV.from && NAV.from !== NAV.cur && !FLOW_RE.test(NAV.from) ? NAV.from : dflt; }
  function render(keepScroll) {
    if (JRS && JRS.scr !== (routeName() || 'home')) { JRS.scr = routeName() || 'home'; track('screen'); }
    lastHash = location.hash;
    var r = routeName();
    // в квартире нет теплосчётчика (или его прибрали) — экраны ввода тепла ведут на главную; вкладки показывают то, что есть
    if (S.onboarded && !hasHeat() && /^(heat|step-\d+|check|handover|status)$/.test(r)) { r = 'home'; try { history.replaceState(null, '', '#home'); } catch (e0) { /* старый браузер */ } }
    if (S.onboarded && !S.meter && r === 'baseline') r = 'meter';
    // світла в квартирі немає (або прибрали) — сторінка світла веде на головну
    if (S.onboarded && SK[r] && !smeters(r).length) { r = 'home'; try { history.replaceState(null, '', '#home'); } catch (e1) { /* старий браузер */ } }
    // вивозу сміття в квартирі немає й оплат не було — його сторінка веде на головну
    if (S.onboarded && /^(waste|wpay)/.test(r) && !wasteOn() && !meterHasData('waste')) { r = 'home'; try { history.replaceState(null, '', '#home'); } catch (e2) { /* старий браузер */ } }
    pendingRender = false;
    // вікно Telegram: даних тут ще немає, а вхід за підписом Telegram іде — не показуємо привітання «як новому» (воно лякає: «мої дані зникли»)
    if (!S.onboarded && tgPending() && ['help', 'privacy', 'terms', 'login', 'reset'].indexOf(r) < 0) r = 'tgwait';
    else if (!S.onboarded && ['welcome', 'start', 'wsetup', 'wadd', 'eadd', 'gadd', 'meter', 'baseline', 'help', 'login', 'reset', 'photo', 'privacy', 'terms'].indexOf(r) < 0) r = S.meter ? 'baseline' : 'welcome';
    if (S.onboarded && (!r || r === 'welcome' || r === 'start')) r = homeRoute();
    if (S.onboarded) navNote(r);
    var view;
    var rm = r.match(/^rec-([\w-]+?)(-edit)?$/), wm = r.match(/^wrec-([\w-]+)$/), gn = r.match(/^gap-new-([\w-]+)$/), gm = !gn && r.match(/^gap-([\w-]+)$/), pm = r.match(/^place-([\w-]+)$/), em = r.match(/^erec-([\w-]+)$/);
    if (!gn) GAP_PRESET = null;
    if (PQ && !/^(wadd|eadd|gadd|meter|add-place)$/.test(r)) PQ = null;
    if (pm) view = placeView(pm[1]);
    else if (em) view = erecView(em[1]);
    else if (gn) view = gapView(null, gn[1]);
    else if (gm) view = gapView(gm[1]);
    else if (rm) view = recView(rm[1], !!rm[2]);
    else if (/^hnar-20\d\d-(0[1-9]|1[0-2])$/.test(r)) view = hnarView(r.slice(5));
    else if (wm) view = wrecView(wm[1]);
    else if (/^wpay-[\w-]+$/.test(r)) view = wpView(r.slice(5));
    else if (/^step-\d+$/.test(r)) view = (S.meter ? V.step(+r.split('-')[1]) : V.meter());
    else view = (V[r] || V.home)();
    if (!view.route) view.route = r;
    tgBack(S.onboarded ? (view.bare ? view.closeTo : FLOW_RE.test(r) ? backTo('history') : r !== homeRoute() ? backTo(homeRoute()) : '') || '' : '');
    if (FB.open) { var ft = document.getElementById('fb-text'); if (ft) FB.text = ft.value; ['name', 'email', 'tg'].forEach(function (k) { var e = document.getElementById('fb-' + k); if (e) FB[k] = e.value; }); }
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
  var ACC_SEL = 'details.mbox-set, details.wacc, details.gacc, details.pgroup, details.pacc, details.hacc, details.season';   // 90-а: і «Нараховано ХТМ», і сезони — за шаблоном
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
    var d = b.closest('details'); if (!d) return; e.preventDefault(); e.stopPropagation();
    var sm = d.querySelector('summary'); if (sm) { var r = sm.getBoundingClientRect(); if (r.top < 0 || r.top > innerHeight - 60) sm.scrollIntoView({ block: 'start' }); try { sm.focus({ preventScroll: true }); } catch (e1) { /* старий браузер */ } }
    if (d.matches('details.pacc')) paccAnim(d, false); else d.open = false;
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
  // ---- «живі» цифри (владелец 07.11): відкрили екран лічильника — ролики води й газу докручуються до своїх цифр (праві, літри, — довше, як у
  // справжнього лічильника), табло тепла й світла коротко «дораховує» до показань. Лише при вході на екран; «Зменшити рух» у системі — без анімації.
  function calmMotion() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  // екран часто перемальовується одразу після входу (статус Водоканалу, синхронізація) — анімація продовжується з того ж місця (el — скільки мс минуло)
  var LIVE = { r: '', t0: 0 }, LIVE_MS = 1700;
  function liveDigits(root, el) {
    if (!root || calmMotion() || navigator.webdriver) return;   // автотести читають цифри одразу — їм анімація лише заважає
    el = el || 0;
    Array.prototype.forEach.call(root.querySelectorAll('.wd-win'), function (win) {
      Array.prototype.forEach.call(win.querySelectorAll('.wd-c'), function (c, i) {
        var d = c.textContent, dur = 520 + i * 70; if (!/^\d$/.test(d) || el >= dur) return;
        var k = 3 + i * 2, seq = []; for (var j = k; j >= 0; j--) seq.push((+d - j + 100) % 10);
        c.classList.add('rolling'); c.innerHTML = '<span class="wd-roll" style="--k:' + k + ';--dur:' + dur + 'ms;animation-delay:-' + Math.round(el) + 'ms" aria-hidden="true">' + seq.map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</span>';
        var done = function () { if (c.classList.contains('rolling')) { c.classList.remove('rolling'); c.textContent = d; } };
        c.firstChild.addEventListener('animationend', done); setTimeout(done, dur - el + 200);
      });
    });
    Array.prototype.forEach.call(root.querySelectorAll('.lcd .line[data-v]:not(.sample)'), function (ln) {
      var v = ln.getAttribute('data-v'), m = /^(\d+)(?:[.,](\d+))?$/.exec(v), svg = ln.querySelector('svg.seg'); if (!m || !svg) return;
      var dec = (m[2] || '').length, to = parseFloat(v.replace(',', '.')), from = to * 0.82, orig = svg.outerHTML, lbl = svg.getAttribute('aria-label') || v, t0 = 0, dur = 750;
      if (!(to > 0) || el >= dur) return;
      var step = function (now) {
        if (!ln.isConnected) return; if (!t0) t0 = now - el;
        var q = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - q, 3), sv = ln.querySelector('svg.seg'); if (!sv) return;
        if (q >= 1) { sv.outerHTML = orig; return; }
        var txt = (from + (to - from) * e).toFixed(dec); while (txt.length < v.length) txt = ' ' + txt;
        sv.outerHTML = segSvg(txt, lbl); requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }
  // ---- картки квартир (details.pacc) розкриваються й згортаються плавно: <details> сам не анімується — ведемо висоту (Web Animations).
  // Владелец 07.11 (iPhone): «треба тапнути двічі, картка мелькає». Тому: намір (відкрита/закрита) — одразу в S.homeOpen і на стрілці
  // (перемальовка посеред руху не повертає стару; тап видно миттєво); закриття — fill forwards і скасування після open=false (без кадру
  // повної висоти в кінці, WebKit); запасний таймер, якщо finish не прийде; другий click без нового дотику за 350 мс — дубль, не розвертаємо.
  function paccWant(d) { return d._an ? d._dir === 'open' : d.open; }
  function paccDone(d) {
    var an = d._an; if (!an) return; d._an = null; clearTimeout(d._tm);
    if (d._dir === 'close') { d.open = false; d.classList.remove('shut'); }   // закрита — лише в кінці, щоб вміст було видно під час руху
    try { an.cancel(); } catch (e) { /* */ }   // fill forwards знято — висота знову своя (уже закрита / вже відкрита)
  }
  function paccAnim(d, open) {
    var h0 = d.getBoundingClientRect().height;   // до скасування: натиснули ще раз посеред руху — їдемо від поточної висоти
    var was = d._an ? d._dir : '';
    if (d._an) { var a0 = d._an; d._an = null; clearTimeout(d._tm); try { a0.cancel(); } catch (e) { /* */ } }
    var id = d.getAttribute('data-pl'); if (id) { S.homeOpen = S.homeOpen || {}; S.homeOpen[id] = open; persist(); }
    d.classList.toggle('shut', !open);
    if (!d.animate || calmMotion()) { d.classList.remove('shut'); d.open = open; return; }
    var sum = d.querySelector(':scope > summary'); d._dir = open ? 'open' : 'close';
    if (open) { d.open = true; accFoot(d); }   // «Згорнути» внизу — до заміру висоти (інакше в кінці ривок на її висоту)
    var h1 = open ? d.offsetHeight : (sum ? sum.offsetHeight : 0) + (d.offsetHeight - d.clientHeight);
    if (Math.abs(h1 - h0) < 2) { d.classList.remove('shut'); d.open = open; return; }
    var body = d.querySelector(':scope > .pacc-body'), dur = open ? 280 : 220;
    var an = d._an = d.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: dur, easing: open ? 'cubic-bezier(.2,.7,.2,1)' : 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
    // вміст проявляється лише при відкритті з закритої (посеред згортання він і так видно — без блимання)
    if (body && open && was !== 'close') body.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'ease-out' });
    an.onfinish = function () { if (d._an === an) paccDone(d); };
    d._tm = setTimeout(function () { if (d._an === an) paccDone(d); }, dur + 150);
  }
  // дотик/натискання на шапку — справжня дія; click без нього впритул до попереднього — дубль (WebView)
  document.addEventListener('pointerdown', function (e) {
    var sm = e.target.closest && e.target.closest('details.pacc > summary'); if (sm) sm.parentElement._pd = Date.now();
  }, true);
  document.addEventListener('click', function (e) {
    var sm = e.target.closest && e.target.closest('summary'), d = sm && sm.parentElement;
    if (!d || !d.matches || !d.matches('details.pacc') || sm !== d.querySelector(':scope > summary')) return;
    e.preventDefault();
    var now = Date.now();
    if (d._ck && now - d._ck < 350 && !(d._pd > d._ck)) return;   // дубль того ж тапу — не розвертаємо анімацію назад
    d._ck = now;
    paccAnim(d, !paccWant(d));   // посеред руху — у протилежний бік від поточного наміру
  });
  function afterRender(r) {
    // табло докручуються при вході: сторінки лічильників і сцена лендинга (89-а — один рух на лендингу, при reduced-motion — ні)
    if (r !== LIVE.r) { LIVE.r = r; LIVE.t0 = /^(heat|water-hot|water-cold|elec|gas|welcome)$/.test(r) ? Date.now() : 0; }
    if (LIVE.t0 && Date.now() - LIVE.t0 < LIVE_MS) liveDigits(document.getElementById('main'), Date.now() - LIVE.t0);
    Array.prototype.forEach.call(document.querySelectorAll(ACC_SEL), accFoot);
    Array.prototype.forEach.call(document.querySelectorAll('details.tips-box > summary'), function (sm) { if (!sm.querySelector('.pacc-chev')) sm.insertAdjacentHTML('beforeend', ico('chev', 18, 'pacc-chev')); });
    enhanceDates(); photoFill(); phFocusAll(); toastKeep(); fabWatch(); if (Y().account) histFlush();
    // прилади в нижній панелі лендинга перетікають по колу — при «Зменшити рух» і в автотестах стоїть перший (теплолічильник)
    if (calmMotion() || navigator.webdriver) Array.prototype.forEach.call(document.querySelectorAll('svg.lpm'), function (s) { if (s.pauseAnimations) { s.pauseAnimations(); s.setCurrentTime(0); } });
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

  /** Внесли показання за місяць, на який уже є «Платіжка ХТМ» (квитанція без показань), — квитанція переїжджає до них, «Платіжка» зникає. */
  function hbillAdopt(rd) {
    var ym = String((rd.htm && rd.htm.date) || '').slice(0, 7); if (!ym) return;
    RDB().forEach(function (b) { if (b.ym !== ym || (b.place || S.placeId) !== (rd.place || S.placeId)) return; rd.bills = (rd.bills || []).concat(b.bills || []); b.bills = []; b.deleted = true; b.updatedAt = Date.now(); });
  }
  function saveReading(status) {
    var res = S._lastCheck || runCheck(S.draft), htm = draftReadingGcal(S.draft);
    var rd = { id: uid(), place: S.placeId, htm: htm, raw: Object.assign({}, S.draft.values), unit: energyUnit(), status: status, createdAt: new Date().toISOString(), updatedAt: Date.now(), source: S.draft.source || 'manual',
      verdict: res.verdict, codes: res.items.map(function (x) { return x.code; }),
      derived: Object.assign({}, res.derived, S.baseline ? { days: R.daysBetween(S.baseline.date, htm.date) } : {}) };
    if (S.draft.photos && S.draft.photos.length) rd.photos = S.draft.photos.slice();
    S.readings.push(rd); hbillAdopt(rd); S.draft = null; S.focusId = rd.id;
    cardSaved('heat', rd);   // відкрито з картки в чаті й там «перевірте» — картці збережене (122-а)
    save(); return rd;
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]'); if (!el) return;
    var act = el.getAttribute('data-act');
    if (waterAct(act, el, e)) return;
    if (billAct(act, el, e)) return;
    switch (act) {
      case 'start': break;
      case 'cam': camOpen(el.getAttribute('data-in'), el.getAttribute('data-kind')); break;
      case 'read': newDraft(); go('step-0'); break;
      case 'restart': newDraft(); go('step-0'); break;
      case 'pick-model': S._pickModel = el.value; render(true); break;
      // як у кабінеті ХТМ: одиниця енергії й колонки часу (124-а) — у налаштуваннях лічильника цієї квартири
      case 'hf-unit': if (S.meter) { S.meter = Object.assign({}, S.meter, { htmUnit: el.value }); save(); render(true); toast(t('hf_saved')); } break;
      case 'hf-times': if (S.meter) { S.meter = Object.assign({}, S.meter, { htmTimes: +el.value === 3 ? 3 : 2 }); save(); render(true); toast(t('hf_saved')); } break;
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
      // «Відправити у фоні» з перевірки: запис «перевірено» → кабінет ХТМ (помилка — на «Передайте», там і кнопка, і причина)
      case 'chk-bg': { if (el.disabled || HC.busy) return; var rb = saveReading('checked'); S.focusId = rb.id; save(); go('handover'); hcBg(rb.id); break; }
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
      case 'doc-add': { var fi = document.getElementById('doc-input'); if (fi) { fi.setAttribute('data-kind', el.getAttribute('data-kind')); fi.setAttribute('data-meter', el.getAttribute('data-meter') || ''); fi.value = ''; fi.click(); } break; }
      case 'doc-del': {
        if (!confirm(t('mv_del_q'))) break;
        busy(el);
        fetch(window.TEPLO_API + '/docs/delete', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF': (document.cookie.match(/(?:^|; )ts_csrf=([^;]*)/) || [])[1] || '' }, body: JSON.stringify({ id: el.getAttribute('data-id') }) })
          .then(function () { loadDocs(true); }); break;
      }
      case 'theme': S.theme = el.getAttribute('data-v'); persist(); applyTheme(); render(true); break;
      case 'pl-use': switchPlace(el.getAttribute('data-id')); WX.key = ''; toast(t('pl_switched', { p: placeLabel(place()) })); go('home'); break;
      case 'hp-add-place': hpAddPlace(); break;
      case 'hp-edit': HP_EDIT = el.getAttribute('data-id'); render(true); setTimeout(function () { var f = document.getElementById('hpa-' + HP_EDIT + '-' + (cityOf(place(HP_EDIT)) ? 'street' : 'city')); if (f) f.focus(); }, 30); break;
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
      case 'aw-create': pwCreate(); break;
      case 'mono-open': MO = monoFresh(routeName() || backTo('home')); break;
      case 'mono-go': monoStart(); break;
      case 'mono-paste': monoPaste(); break;
      case 'mono-ext': MO.opened = true; MO.err = ''; setTimeout(function () { if (routeName() === 'mono' && !MO.st) render(true); }, 300); break;
      case 'mono-stop': monoFinish(); break;
      case 'mono-cancel': clearTimeout(MO.timer); MO = monoFresh(); break;
      case 'mono-again': clearTimeout(MO.timer); MO = Object.assign(monoFresh(MO.back), { opened: true }); render(true); break;
      case 'mono-apply': monoApply(); break;
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
      case 'rec-del-yes': { var m2 = routeName().match(/^rec-([\w-]+)$/), rx = m2 && RD().concat(RDB()).filter(function (x) { return x.id === m2[1]; })[0];
        if (rx) { rx.deleted = true; rx.updatedAt = Date.now(); photoKeep(rx.photos, false); billsDrop(rx.bills); if (S.focusId === rx.id) S.focusId = null; save(); toast(t('rec_deleted')); } go('history'); break; }
      case 'accepted': {
        var ra = RD().filter(function (x) { return x.id === el.getAttribute('data-id'); })[0];
        if (ra) { heatSetStatus(ra, 'accepted'); save(); }
        render(); break;
      }
      case 'ho-st': {   // «Передача в кабінет ХТМ»: На перевірці / Прийнято — лишаємось на цій сторінці
        var hr = RD().filter(function (x) { return x.id === el.getAttribute('data-id'); })[0], hv = el.getAttribute('data-v');
        if (hr && (hr.status !== hv || hr.own)) { heatSetStatus(hr, hv); S.focusId = hr.id; HO_POP = hv; save(); toast(t('st_done', { s: t(hv === 'accepted' ? 'st_acc' : 'st_rev').toLowerCase() })); }
        render(true); { var hf = document.querySelector('[data-key=ho-st-' + hv + ']'); if (hf) hf.focus(); } break;
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
      case 'cc-all': ccDone(true, 'accept'); break;
      case 'cc-none': ccDone(false, 'reject'); break;
      case 'cc-save': { var cx = document.getElementById('cc-an'); ccDone(!!(cx && cx.checked), 'save'); break; }
      case 'cc-open': ccOpen(); break;
      case 'cc-close': { var wasCc = CCU.open; CCU.open = false; if (wasCc) render(true); break; }   // і посилання «Політика» в діалозі — закрити й перейти
      case 'fb-close': { var tx = document.getElementById('fb-text'); if (tx) FB.text = tx.value; FB.open = false; render(true); break; }
      case 'fb-send': fbSend(); break;
      case 'ph-stop': PH.gen = -1; if (PH.ctl) PH.ctl.abort(); PH.status = 'idle'; PH.progress = ''; PH.error = ''; render(true); break;
      case 'wiz-cancel': wizCancel(el.getAttribute('data-what') || 'heat'); break;
      case 'ph-water': phToWater(false); break;
      case 'ph-again': PH.status = 'idle'; PHS.save(false); render(true); break;
      case 'ph-new': inboxDone(); phReset(PH.mode); render(true); break;
      case 'inbox-run': inboxRun(); break;
      case 'ph-apply': phApply(); break;
      case 'ph-bg': if (!HC.busy) phApply(true); break;
      case 'ph-use-model': { var um = M.byId(el.getAttribute('data-id')); S.meter = Object.assign({}, S.meter || {}, { modelId: um.id, unit: el.getAttribute('data-unit') || um.unit }); save(); toast(t('b_saved')); PH.picked = VIS().pick(PH.result, M.TO_GCAL, energyUnit()); render(true); break; }
      case 'auth-mode': {
        var am = el.getAttribute('data-m') || (authMode === 'login' ? 'register' : 'login'), aem = document.getElementById('a-email');
        if (aem && aem.value.trim()) FG_EMAIL = aem.value.trim();   // email не губиться між «Увійти», «Створити» і «Забули пароль?»
        authMode = am; RS_EXPIRED = false; if (routeName() !== 'login') { go('login'); break; }
        render(true); var fe = document.getElementById('a-email'); if (fe && FG_EMAIL && !fe.value) fe.value = FG_EMAIL; if (fe && am !== 'sent') try { fe.focus({ preventScroll: true }); } catch (e3) { /* старий браузер */ }
        break; }
      case 'pass-eye': {
        var pin = document.getElementById(el.getAttribute('data-for')); if (!pin) break;
        var shown = pin.type === 'password'; pin.type = shown ? 'text' : 'password';
        el.setAttribute('aria-pressed', String(shown)); el.setAttribute('aria-label', t(shown ? 'pass_hide' : 'pass_show')); el.setAttribute('title', t(shown ? 'pass_hide' : 'pass_show'));
        el.innerHTML = ico(shown ? 'eyeoff' : 'eye', 20); break; }
      case 'logout': ADMIN = null; busy(el); Y().logout().then(function () { S = defaults(); S.lang = browserLang(); ensurePlaces(); lastSig = window.TeploSync.sig(window.TeploSync.payload(S)); persist(); toast(t('logged_out')); go('welcome'); }); break;
      case 'dismiss-sync': S.syncPromptDismissed = true; persist(); render(true); break;
      case 'rp-rm': rpRemove(el.getAttribute('data-ref') || '', el.getAttribute('data-id') || ''); break;
      case 'rp-undo': rpUndo(); break;
      case 'bot-start': botStartGo(); break;
      case 'bot-start-later': S.botStartLater = Date.now(); persist(); render(true); break;
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
      var f = e.target.files[0], kind = e.target.getAttribute('data-kind') || 'other', dm = e.target.getAttribute('data-meter') || '';
      var prep = /^image\//.test(f.type) && window.TeploVision ? window.TeploVision.prepare(f) : Promise.resolve(f);
      DOCS.busy = kind; DOCS.meter = dm; if (dm) MB_OPEN[dm] = true; render(true);
      prep.then(function (b) {
        return fetch(window.TEPLO_API + '/docs/upload?place=' + encodeURIComponent(S.placeId) + '&kind=' + kind + (dm ? '&meter=' + encodeURIComponent(dm) : ''), { method: 'POST', credentials: 'same-origin', body: b,
          headers: { 'Content-Type': b.type || f.type || 'application/octet-stream', 'X-CSRF': (document.cookie.match(/(?:^|; )ts_csrf=([^;]*)/) || [])[1] || '', Accept: 'application/json' } });
      }).then(function (r) { DOCS.busy = ''; if (!r.ok) toast(r.status === 415 ? t('mv_bad_file') : r.status === 413 ? t('mv_too_big') : t('err_network')); else toast(t('mv_saved')); loadDocs(true); render(true); },
        function () { DOCS.busy = ''; toast(t('err_network')); render(true); });
      return;
    }
  });
  document.addEventListener('change', function (e) { if (e.target && e.target.name === 'pv-icon') { ensurePlaces(); var pi = place(), v = e.target.value; if (v && PICONS[v]) pi.icon = v; else delete pi.icon; pi.updatedAt = Date.now(); save(); render(true); var y = document.querySelector('input[name=pv-icon]:checked'); if (y) y.focus(); } });
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
    if (e.key === 'Escape' && CCU.open) { CCU.open = false; render(true); return; }
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
      if (hasAny) { b.errCode = R.normCode(b.errCode); ['energy', 'volume', 'flow', 'power', 'tSupply', 'tReturn', 'hours', 'errHours', 'flowHours'].forEach(function (k) { var n = R.num(b[k]); b[k] = n === null ? '' : n; });
        if (b.energy !== '' && htmUnit() !== 'Gcal') b.energy = +(b.energy * (M.TO_GCAL[htmUnit()] || 1)).toFixed(6);   // з одиниці кабінету — в Гкал
        S.baseline = b; }
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
    } else if (f.id === 'forgot-form') {
      var fem = document.getElementById('a-email').value.trim(), fer = document.getElementById('forgot-err'); fer.textContent = '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fem)) { fer.textContent = t('err_bad_email'); return; }
      var fdone = busy(f.querySelector('[type=submit]'));
      Y().forgot(fem, S.lang).then(function (j) { fdone(); if (j && j._status === 200) { FG_EMAIL = fem; authMode = 'sent'; render(true); } else fer.textContent = authError(j); }, function () { fdone(); fer.textContent = t('err_network'); });
    } else if (f.id === 'reset-form') {
      var rpw = document.getElementById('r-pass').value, rer = document.getElementById('reset-err'); rer.textContent = '';
      if (rpw.length < 8) { rer.textContent = t('err_weak_password'); return; }
      var rdone = busy(f.querySelector('[type=submit]'));
      Y().resetPassword(RESET_TOK, rpw).then(function (j) {
        rdone();
        if (j && j._status === 200) { RESET_TOK = ''; authMode = 'login'; toast(t('rs_ok')); S.onboarded = S.onboarded || anyMeters(); save(); go(S.onboarded ? 'home' : 'start'); return; }
        if (j && j.error === 'reset_expired') { RS_EXPIRED = true; render(true); return; }
        rer.textContent = authError(j);
      }, function () { rdone(); rer.textContent = t('err_network'); });
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
      var on = ccOn(); if (!on && ccGet()) return;   // від аналітики відмовились — нічого не збираємо
      var now = Date.now(); if (now - JRS.at > 1800000) JRS.sid = jrId(); JRS.at = now;   // 30 мин тиші — новий сеанс
      if (on) try { sessionStorage.setItem('teplo.sid', JSON.stringify({ id: JRS.sid, at: now })); } catch (e) { /* приватний режим */ }
      JRS.q.push({ t: now, n: n, s: routeName() || 'home', p: p });
      if (JRS.q.length > 200) JRS.q.splice(0, JRS.q.length - 200);
      if (!on) return;   // на банер ще не відповіли — лише в пам'яті цієї сторінки; «Прийняти» — дошлемо (ccStart)
      clearTimeout(JRS.tm); JRS.tm = setTimeout(jrFlush, JRS.q.length >= 20 ? 0 : 4000);
    } catch (e) { /* журнал не має ламати застосунок */ }
  }
  /** Випадковий id браузера для аналітики (localStorage) — створюємо лише після згоди. */
  function jrVid() {
    try { var v = localStorage.getItem('teplo.vid'); if (!v) { v = (Date.now().toString(36) + Math.random().toString(36).slice(2, 12)).replace(/[^a-z0-9]/g, ''); localStorage.setItem('teplo.vid', v); } return v; }
    catch (e) { return ''; }
  }
  /** Згода є: id браузера, дослати накопичене з відкриття сторінки й першу позначку «відкрили сайт». */
  function ccStart() {
    if (JRS) { if (!JRS.vid) JRS.vid = jrVid(); jrFlush(); }
    if (VPEND && VPING) { VPEND = false; var a = visitAct(); VACT.key = a.stage + '/' + a.meters + '/' + a.recs; VACT.at = Date.now(); VPING(a); }
  }
  /** Відмовились або відкликали: стерти накопичене й id браузера; на сервері вже прийняте лишається до свого строку (журнал — 60 днів). */
  function ccStop() {
    if (JRS) { JRS.q = []; JRS.vid = ''; clearTimeout(JRS.tm); } VPEND = false;
    try { localStorage.removeItem('teplo.vid'); } catch (e) { /* немає */ } try { sessionStorage.removeItem('teplo.sid'); } catch (e) { /* немає */ }
  }
  function jrFlush() {
    if (!JRS || !JRS.q.length || !ccOn()) return;
    if (!JRS.vid) JRS.vid = jrVid(); if (!JRS.vid) return;
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
    // li — дані підуть у акаунт (увійшов); без входу TeploSync теж буває 'server' (сервер доступний), але нічого не надсилає — це «лише на пристрої»
    if (any) { d.li = jrAcc() ? 1 : 0; track('saved', d); }
  }
  function jrAcc() { var y = window.TeploSync; return y && y.mode === 'server' && y.account ? y.account : null; }
  /** Пішов із сайту (сховав вкладку, закрив, згорнув Telegram): що в нього лишилось — для журналу «словами» в /admin (120-а). */
  function jrLeave() {
    if (!JRS || JRS.left) return; JRS.left = true;
    var c = jrCounts(), a = jrAcc(), y = window.TeploSync || {};
    track('leave', { p: c.p, m: c.m, r: c.r, li: a ? 1 : 0, tg: a && a.telegram ? 1 : 0, em: a && a.email ? 1 : 0, st: String(y.status || '') });
    clearTimeout(JRS.tm); jrFlush();
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') jrLeave(); else if (JRS) JRS.left = false; });
  window.addEventListener('pagehide', jrLeave);
  /** Розпізнавання фото з записом у журнал: скільки рядків/барабанів знайшов рушій, час, помилка. */
  function ocrRead(file, opts) {
    var t0 = Date.now();
    return window.TeploOCR.read(file, opts).then(function (res) {
      var r = res || {};
      try { if (file && VIS().focusOf) file._focus = VIS().focusOf(r); } catch (e0) { /* без табло — центр фото */ } track('ocr', { ok: (r.lines && r.lines.length) || (r.drums && r.drums.length) ? 1 : 0, lines: (r.lines || []).length, drums: (r.drums || []).length, ms: Date.now() - t0, w: (file && file.size) ? Math.round(file.size / 1024) : undefined });
      return res;
    }, function (e) { track('ocr', { ok: 0, ms: Date.now() - t0, err: String((e && e.message) || e).slice(0, 100) }); throw e; });
  }
  /** Отклик (для /admin, без личных данных): этап 0 открыл · 1 клацал по экранам · 2 есть счётчик · 3 есть показания; сколько их. */
  var VSTAGE = 0, VACT = { at: 0, key: '' }, VPING = null, VPEND = false;   // VPEND — перша позначка чекає згоди на банері
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
      var on0 = ccOn(), o = null; if (on0) try { o = JSON.parse(sessionStorage.getItem('teplo.sid') || 'null'); } catch (e) { o = null; }
      JRS = { vid: on0 ? jrVid() : '', sid: o && o.id && Date.now() - o.at < 1800000 ? o.id : jrId(), at: Date.now(), q: [], tm: null, scr: '', prev: null };
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
          // 111-а: «/visit network» — фонова позначка візиту обірвалась (iPhone перезавантажив сторінку чи згорнули застосунок; журнал 11.11, 5 з 5) — людина нічого не бачила, не помилка
          function (err) { if (path !== '/visit') track('api_error', { p: String(path || '').split('?')[0].slice(0, 50), c: 0, e: 'network' }); throw err; });
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
      var ua = navigator.userAgent || '', ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
      var tablet = ipad || (/Android/.test(ua) && !/Mobile/.test(ua)) || /Tablet|PlayBook|Silk|Kindle/.test(ua), mobile = !tablet && /Mobi|iPhone|iPod|Android|Windows Phone/.test(ua);
      var os = /iPhone|iPod/.test(ua) || ipad ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux|CrOS/.test(ua) ? 'Linux' : 'other';
      var tg0 = window.Telegram && window.Telegram.WebApp, pwa = !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
      var base = { device: tablet ? 'tablet' : mobile ? 'mobile' : 'desktop', os: os, tg: !!(tg0 && tg0.initData), pwa: pwa, sw: Math.round(screen.width || 0) };
      // лише зі згодою на аналітику (банер cookie): id браузера — у localStorage
      VPING = function (extra) { if (!ccOn()) return; var vid = jrVid(); if (!vid) return; ap('POST', '/visit', Object.assign({ vid: vid }, base, extra || {})).catch(function () {}); };
      setTimeout(function () { if (!ccOn()) { VPEND = !ccGet(); return; } var a = visitAct(); VACT.key = a.stage + '/' + a.meters + '/' + a.recs; VACT.at = Date.now(); VPING(a); }, 1500);
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
    // вивіз сміття (нагадування 10-го): сторінка вивозу квартири (115-а; вимкнений — екран квартири)
    if (g === 'waste') { var wpl = (pid && place(pid)) || place(); if (wpl && wpl.id !== S.placeId) { switchPlace(wpl.id); WX.key = ''; } g = wpl && wpl.waste && wpl.waste.on ? 'waste' : wpl ? 'place-' + wpl.id : 'home'; }
    try { history.replaceState(null, '', location.pathname + q + '#' + g); } catch (e) { location.hash = g; }
    if (g === 'wnew') WN = wnFresh(wmeters('hot').length ? 'hot' : 'cold');
    if (g === 'enew' || g === 'gnew') EN = enFresh(g === 'gnew' ? 'gas' : 'elec');
  }
  var DEEP = null, TGS = '';
  (function () {
    if (/[?&]fb=1(?=&|$)/.test(location.search)) setTimeout(function () { FB.open = true; render(true); }, 300);   // «Написати ще» під карткою відповіді на відгук (121-а)
    var g = (location.search.match(/[?&]go=(wnew|heat|enew|elec|gnew|gas|home|places|water-cold|water-hot|gpv|waste)(?=&|$)/) || [])[1]; if (!g) return;
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
