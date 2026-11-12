/*
 * Теплосервис — движок проверок показаний «как робот ХТМ».
 * Один файл для браузера (window.TeploRules) и Node (module.exports).
 * Коды R_* совпадают с документом «кабинет ХТМ (снятие 01.11.2026)», §7.
 * Уровни: ok · info · warn (похоже на ошибку, можно подтвердить) · block (робот ХТМ отклонит).
 */
(function (root) {
  'use strict';

  var C = {
    GCAL_KW_FACTOR: 1.163,     // кВт = 1.163 · м³/ч · ΔT
    DT_MIN: 2.5, DT_MAX: 50,   // средняя ΔT за период (робот ХТМ)
    DT_WARN: 3.0,              // близко к порогу
    TEMP_MIN: 5, TEMP_MAX: 95,
    HOURS_TOL: 24,             // |Δчасов − календарь| ≤ 24
    HOURS_MAX: 263000,         // понад 30 років роботи (125-а: «минулого разу 70751193 год» — заводський номер L+G потрапив у години)
    ENERGY_JUMP: 15,           // Гкал за период
    PREV_ENERGY_X: 10,         // минула енергія ≥ 10 × поточної — «Останні прийняті» з помилкою (126-а), не порівнюємо
    FLOW_K: 0.3,               // средний расход ≥ 0.3 × переходного
    POWER_TOL: 0.10, POWER_ABS: 0.3,
    DT_NO_FLOW: 15,
    TARIFF: 1539.50,
    ABON: 29.40,               // абонплата за індивідуальний договір на теплопостачання, грн/міс (платіжка ХТМ, 2025)           // грн/Гкал с НДС (КП «ХТМ», население; мораторий — так и в сезоне 2026/27)
    // частка ЗБП (загальнобудинкові потреби) квартири з лічильником, Гкал на м² за місяць опалення: 14 квитанцій ХТМ 2024–2026 —
    // 0,005–0,018 Гкал на 54,3 м² (= ЗБП будинку × S_кв / S_буд). Більше ZBP_MAX_M2 «частка будинку» не буває: такі місяці ХТМ рахував за середнім.
    ZBP_M2: 0.00025, ZBP_MAX_M2: 0.0006,
    WINDOW_FROM: 5, WINDOW_RECOMMENDED: 23, WINDOW_TO: 25
  };

  // Поля журнала ХТМ в порядке формы. decimals — как требует форма (разделитель — точка).
  var FIELDS = [
    { key: 'date',     htm: 'LastDtPok',    uk: 'Дата зняття',                 ru: 'Дата снятия',                 unit: '',     dec: null },
    { key: 'energy',   htm: 'LastValuePok', uk: 'Накопичена енергія',          ru: 'Накопленная энергия',         unit: 'Гкал', dec: 3 },
    { key: 'volume',   htm: 'LastRashPok',  uk: 'Обсяг теплоносія',            ru: 'Объём теплоносителя',         unit: 'м³',   dec: 3 },
    { key: 'flow',     htm: 'HeatRash',     uk: 'Миттєва витрата',             ru: 'Мгновенный расход',           unit: 'м³/год', dec: 3 },
    { key: 'power',    htm: 'HeatPower',    uk: 'Миттєва потужність',          ru: 'Мгновенная мощность',         unit: 'кВт',  dec: 3 },
    { key: 'tSupply',  htm: 'TempPod',      uk: 'Температура подачі',          ru: 'Температура подачи',          unit: '°C',   dec: 2 },
    { key: 'tReturn',  htm: 'TempO',        uk: 'Температура повернення',      ru: 'Температура обратки',         unit: '°C',   dec: 2 },
    { key: 'hours',    htm: 'LastTimePok',  uk: 'Час роботи',                  ru: 'Время работы',                unit: 'год',  dec: 0 },
    { key: 'errHours', htm: 'ErrorTime',    uk: 'Час роботи з помилкою',       ru: 'Время работы с ошибкой',      unit: 'год',  dec: 0 },
    { key: 'errCode',  htm: 'ErrorKod',     uk: 'Код помилки',                 ru: 'Код ошибки',                  unit: '',     dec: null }
  ];

  function num(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).replace(/[\s ]/g, '').replace(',', '.');
    if (s === '' || !/^-?\d*\.?\d+$/.test(s)) return null;
    return parseFloat(s);
  }

  function parseDate(s) {
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) || null;
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
    if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
    return null;
  }
  function daysBetween(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }
  function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function toHtmDate(s) { var t = parseDate(s); if (t === null) return ''; var d = new Date(t); return ('0' + d.getUTCDate()).slice(-2) + '.' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '.' + d.getUTCFullYear(); }

  /** Формат «как в форме ХТМ»: точка, фиксированное число знаков. */
  // Третій час — лише в кабінетах ХТМ з колонками Bd/Fd/Pd (прилади Landis+Gyr тощо; скрин власника 12.11.2026, 11 колонок):
  // «Час напрацювання (Bd)» = hours, «Час простою (Fd)» = errHours, «Час роботи з витратою (Pd)» = flowHours. Назва поля форми ще невідома.
  var FIELD_PD = { key: 'flowHours', htm: null, uk: 'Час роботи з витратою (Pd)', ru: 'Время работы с расходом (Pd)', unit: 'год', dec: 0 };
  var HOUR_KEYS = ['hours', 'errHours', 'flowHours'];
  /** Години лічильника, які бувають: ціле, не більше ~30 років роботи. */
  function saneHours(n) { n = num(n); return n === null || (n >= 0 && n <= C.HOURS_MAX); }
  function fieldOf(key) { return FIELDS.filter(function (x) { return x.key === key; })[0] || (key === 'flowHours' ? FIELD_PD : { uk: key, ru: key }); }
  function formatForHtm(key, v) {
    var f = FIELDS.filter(function (x) { return x.key === key; })[0] || (key === 'flowHours' ? FIELD_PD : null);
    if (!f) return String(v == null ? '' : v);
    if (key === 'date') return toHtmDate(v);
    if (key === 'errCode') return normCode(v);
    var n = num(v); if (n === null) return '';
    return f.dec === 0 ? String(Math.round(n)) : n.toFixed(f.dec);
  }
  /**
   * Код ошибки как его ждёт ХТМ. Нет ошибки — «E---» (что бы ни было на экране: «E-------» у Sharky, «E- - -», пусто, «0»,
   * «немає»). Код — «E-3», «C-1», «F0». С клавиатуры приходит кириллица («Е-3»), пробелы и длинные тире — приводим.
   */
  var CYR = { 'Е': 'E', 'е': 'E', 'С': 'C', 'с': 'C', 'А': 'A', 'а': 'A', 'В': 'B', 'в': 'B', 'О': '0', 'о': '0', 'Н': 'H', 'н': 'H', 'Р': 'P', 'р': 'P', 'Т': 'T', 'т': 'T', 'Х': 'X', 'х': 'X', 'К': 'K', 'к': 'K', 'М': 'M', 'м': 'M' };
  function normCode(v) {
    var raw = String(v == null ? '' : v).trim(); if (raw.normalize) raw = raw.normalize('NFKC');
    if (/^(нет|немає|нема|ні|no|none|ok|ок|-)$/i.test(raw)) return 'E---';
    var s = raw.replace(/\s+/g, '').replace(/[‐‑‒–—―−─━一ー﹣_~]/g, '-').replace(/[ЕеСсАаВвОоНнРрТтХхКкМм]/g, function (c) { return CYR[c]; }).toUpperCase();
    if (s === '' || s === '0' || /^E?-*$/.test(s)) return 'E---';
    var m = s.match(/^([EC])-*([0-9A-F])$/);   // «E3», «E - 3», «е-3» → «E-3»
    if (m) return m[1] + '-' + m[2];
    return s;
  }
  function noError(code) { return normCode(code) === 'E---'; }

  /** Расшифровка кодов (инструкции Diehl SHARKY 774/775 и Landis+Gyr ULTRAHEAT T230/T330; коды семейств не пересекаются). */
  var INST = ['Викличте установника (OTOS чи інший, хто ставив лічильник).', 'Вызовите установщика (OTOS или другой, кто ставил счётчик).'];
  var ERR_CODES = {
    'C-1': ['збій пам’яті лічильника, його треба замінити', 'сбой памяти счётчика, его нужно заменить'].concat(INST),
    'E-1': ['помилка датчика температури: обрив, замикання або температура поза межами', 'ошибка датчика температуры: обрыв, замыкание или температура вне пределов'].concat(INST),
    'E-3': ['датчики подачі й обратки переплутані місцями', 'датчики подачи и обратки перепутаны местами', 'Буває й без помилки монтажу, коли опалення стоїть. Не зникає — викличте установника.', 'Бывает и без ошибки монтажа, когда отопление стоит. Не уходит — вызовите установщика.'],
    'E-4': ['апаратна помилка ультразвукового вимірювання', 'аппаратная ошибка ультразвукового измерения'].concat(INST),
    'E-5': ['лічильник надто часто опитують по M-Bus', 'счётчик слишком часто опрашивают по M-Bus', 'Минає сама за кілька хвилин.', 'Проходит сама через несколько минут.'],
    'E-6': ['неправильний напрямок потоку', 'неправильное направление потока', 'Буває й без помилки монтажу, коли опалення стоїть. Не зникає — викличте установника.', 'Бывает и без ошибки монтажа, когда отопление стоит. Не уходит — вызовите установщика.'],
    'E-7': ['немає ультразвукового сигналу — повітря в трубі', 'нет ультразвукового сигнала — воздух в трубе', 'Стравіть повітря з системи (ОСББ, сантехнік); не допомогло — установник.', 'Стравите воздух из системы (ОСББ, сантехник); не помогло — установщик.'],
    'E-8': ['немає основного живлення, працює від резервної батареї', 'нет основного питания, работает от резервной батареи'].concat(INST),
    'E-9': ['сідає батарея', 'садится батарея', 'Потрібна заміна батареї — часто разом із повіркою.', 'Нужна замена батареи — часто вместе с поверкой.'],
    'E-A': ['виявлено пробій труби', 'обнаружен прорыв трубы'].concat(INST), 'E-B': ['виявлено витік', 'обнаружена утечка'].concat(INST),
    'E-C': ['витік на імпульсному вході 1', 'утечка на импульсном входе 1'].concat(INST), 'E-D': ['витік на імпульсному вході 2', 'утечка на импульсном входе 2'].concat(INST),
    F0: ['немає витрати — найчастіше повітря в трубі', 'нет расхода — чаще всего воздух в трубе', 'Стравіть повітря з системи (ОСББ, сантехнік); не допомогло — установник.', 'Стравите воздух из системы (ОСББ, сантехник); не помогло — установщик.'],
    F1: ['обрив датчика подачі', 'обрыв датчика подачи'].concat(INST), F2: ['обрив датчика обратки', 'обрыв датчика обратки'].concat(INST),
    F3: ['помилка електроніки вимірювання температур', 'ошибка электроники измерения температур'].concat(INST),
    F4: ['батарея розряджена', 'батарея разряжена', 'Потрібна заміна батареї.', 'Нужна замена батареи.'],
    F5: ['замикання датчика подачі', 'замыкание датчика подачи'].concat(INST), F6: ['замикання датчика обратки', 'замыкание датчика обратки'].concat(INST),
    F7: ['помилка внутрішньої пам’яті', 'ошибка внутренней памяти'].concat(INST),
    F8: ['помилка F1–F6 триває понад 8 годин або було втручання', 'ошибка F1–F6 длится больше 8 часов или было вмешательство', 'Скинути може лише сервіс.', 'Сбросить может только сервис.'],
    F9: ['помилка електроніки', 'ошибка электроники'].concat(INST)
  };

  /** Состояние окна приёма на дату (локальная дата). */
  function windowState(today) {
    var d = today ? new Date(parseDate(today)) : new Date();
    var day = today ? d.getUTCDate() : d.getDate();
    if (day < C.WINDOW_FROM) return { state: 'closed_before', day: day, opensOn: C.WINDOW_FROM };
    if (day <= C.WINDOW_RECOMMENDED - 2) return { state: 'open', day: day, daysLeft: C.WINDOW_RECOMMENDED - day };
    if (day < C.WINDOW_RECOMMENDED) return { state: 'soon_recommended', day: day, daysLeft: C.WINDOW_RECOMMENDED - day };
    if (day < C.WINDOW_TO) return { state: 'late', day: day, daysLeft: C.WINDOW_TO - day };
    if (day === C.WINDOW_TO) return { state: 'last_day', day: day };
    return { state: 'closed_after', day: day, opensOn: C.WINDOW_FROM };
  }

  function item(code, level, field, uk, ru, fixUk, fixRu, extra) {
    var o = { code: code, level: level, field: field, msg: { uk: uk, ru: ru } };
    if (fixUk) o.fix = { uk: fixUk, ru: fixRu || fixUk };
    if (extra) for (var k in extra) o[k] = extra[k];
    return o;
  }
  function f3(n) { return (Math.round(n * 1000) / 1000).toString(); }
  function f1(n) { return (Math.round(n * 10) / 10).toString(); }

  /**
   * Проверка одного показания.
   * @param {object} p  { reading, prev, meter, today }
   *   reading/prev: { date:'YYYY-MM-DD', energy, volume, flow, power, tSupply, tReturn, hours, errHours, errCode }
   *   prev — последнее ПРИНЯТОЕ ХТМ показание (строка журнала), может быть null.
   *   meter: { hoursOnlyWithFlow:bool, transitionalFlow:number|null, verifiedUntil:'YYYY-MM-DD'|null, times3:bool (кабінет з Bd/Fd/Pd — є flowHours),
   *            cab: {k, uk, ru} — одиниця енергії кабінету (k — у Гкал) для підказок, screen: {k} — одиниця табло,
   *            lite: bool — тепло не від ХТМ (126-а): потрібні лише дата й енергія, без правил робота ХТМ }
   *   today: 'YYYY-MM-DD' (по умолчанию — сегодня)
   * @returns {{verdict:string, items:Array, derived:object}}
   */
  function validate(p) {
    var r = p.reading || {}, prev = p.prev || null, meter = p.meter || {};
    var today = p.today || ymd(new Date());
    var items = [], d = {};
    var v = {}; FIELDS.forEach(function (f) { if (f.key !== 'date' && f.key !== 'errCode') v[f.key] = num(r[f.key]); });
    var pv = {}; if (prev) FIELDS.forEach(function (f) { if (f.key !== 'date' && f.key !== 'errCode') pv[f.key] = num(prev[f.key]); });
    if (meter.times3) { v.flowHours = num(r.flowHours); pv.flowHours = prev ? num(prev.flowHours) : null; }
    // 126-а: тепло не від ХТМ (Київтеплоенерго, Львівтеплоенерго…) — постачальнику потрібне одне число, енергія; решту не просимо й не перевіряємо
    var lite = !!meter.lite;
    if (lite) Object.keys(v).forEach(function (k) { if (k !== 'energy') { v[k] = null; pv[k] = null; } });
    // минулі години, яких не буває (> 30 років): з ними не порівнюємо — підказуємо виправити «Останні прийняті»
    var badPrev = HOUR_KEYS.filter(function (k) { return pv[k] != null && !saneHours(pv[k]); });
    HOUR_KEYS.forEach(function (k) {
      if (v[k] != null && !saneHours(v[k])) items.push(item('F_HOURS_HUGE', 'block', k, fieldOf(k).uk + ' ' + v[k] + ' — стільки годин не буває (понад 30 років).', fieldOf(k).ru + ' ' + v[k] + ' — столько часов не бывает (больше 30 лет).',
        'Схоже, це заводський номер. Години — на екрані з «h» (у Landis+Gyr — з підписом Bd, Fd або Pd).', 'Похоже, это заводской номер. Часы — на экране с «h» (у Landis+Gyr — с подписью Bd, Fd или Pd).'));
    });
    badPrev.forEach(function (k) { pv[k] = null; });
    // 126-а (dev.voronin): у «Останніх прийнятих» енергія 5892 Гкал при 51 на табло — у десятки разів більша за поточну так не буває
    // (накопичувальна): туди потрапило інше число чи інша одиниця. Не «менше за попередні», а підказка виправити «Останні прийняті»; з ними не порівнюємо.
    var badPrevE = v.energy !== null && pv.energy !== null && v.energy > 0.5 && pv.energy >= v.energy * C.PREV_ENERGY_X;
    if (badPrevE) pv.energy = null;

    // --- A. Заполнено ли всё (форма ХТМ требует все 10 значений)
    var missing = FIELDS.filter(function (f) {
      if (f.key === 'date') return !parseDate(r.date);
      if (lite && f.key !== 'energy') return false;
      if (f.key === 'errCode') return false; // пусто = E--- (нет ошибки)
      return v[f.key] === null;
    });
    if (meter.times3 && v.flowHours === null) missing.push(FIELD_PD);
    missing.forEach(function (f) {
      items.push(item('F_MISSING', 'block', f.key,
        'Не заповнено: ' + f.uk + '.', 'Не заполнено: ' + f.ru + '.',
        lite ? 'Постачальнику потрібна енергія — одне число з головного екрана лічильника.' : 'Кабінет ХТМ приймає лише всі 10 значень.',
        lite ? 'Поставщику нужна энергия — одно число с главного экрана счётчика.' : 'Кабинет ХТМ принимает только все 10 значений.'));
    });

    badPrev.forEach(function (k) {
      var f = fieldOf(k), x = String(num(prev[k]));
      items.push(item('W_PREV_HOURS_BAD', 'warn', k,
        'Минулого разу записано «' + f.uk + '» ' + x + ' год — так не буває (понад 30 років). Схоже, туди потрапив заводський номер лічильника.',
        'В прошлый раз записано «' + f.ru + '» ' + x + ' ч — так не бывает (больше 30 лет). Похоже, туда попал заводской номер счётчика.',
        'Перевірте «Останні прийняті» (головна → налаштування тепла) — з цим числом не порівнюємо.', 'Проверьте «Последние принятые» (главная → настройки тепла) — с этим числом не сравниваем.'));
    });
    if (badPrevE) items.push(item('W_PREV_ENERGY_BAD', 'warn', 'energy',
      'Минулого разу записано енергію ' + f3(num(prev.energy)) + ' Гкал — у ' + Math.round(num(prev.energy) / v.energy) + ' разів більше, ніж зараз. Енергія накопичується й не зменшується — схоже, там інше число або інша одиниця.',
      'В прошлый раз записана энергия ' + f3(num(prev.energy)) + ' Гкал — в ' + Math.round(num(prev.energy) / v.energy) + ' раз больше, чем сейчас. Энергия накапливается и не уменьшается — похоже, там другое число или другая единица.',
      lite ? 'Перевірте минулі показання (налаштування тепла) — з цим числом не порівнюємо. Лічильник замінили — позначте «Лічильник знімали».' : 'Перепишіть «Останні прийняті» з кабінету ХТМ (головна → налаштування тепла) — з цим числом не порівнюємо. Лічильник замінили — позначте «Лічильник знімали».',
      lite ? 'Проверьте прошлые показания (настройки тепла) — с этим числом не сравниваем. Счётчик заменили — отметьте «Счётчик снимали».' : 'Перепишите «Последние принятые» из кабинета ХТМ (главная → настройки тепла) — с этим числом не сравниваем. Счётчик заменили — отметьте «Счётчик снимали».'));
    // --- Дата
    if (parseDate(r.date)) {
      var dToday = daysBetween(r.date, today);
      if (dToday < 0) items.push(item('F_DATE_FUTURE', 'block', 'date', 'Дата в майбутньому.', 'Дата в будущем.', 'Вкажіть день, коли знімали показання.', 'Укажите день, когда снимали показания.'));
      else if (r.date.slice(0, 7) !== today.slice(0, 7)) items.push(item('R_CURRENT_MONTH', 'block', 'date',
        lite ? 'Передають показання поточного місяця.' : 'ХТМ приймає показання лише поточного місяця.', lite ? 'Передают показания текущего месяца.' : 'ХТМ принимает показания только текущего месяца.',
        'Зніміть нові показання цього місяця.', 'Снимите новые показания в этом месяце.'));
      else if (dToday > 2 && !lite) items.push(item('F_DATE_OLD', 'warn', 'date',
        'Показання зняті ' + dToday + ' дн. тому.', 'Показания сняты ' + dToday + ' дн. назад.',
        'Це нормально, якщо дата справжня: робот рахує години саме від дати зняття.', 'Это нормально, если дата настоящая: робот считает часы именно от даты снятия.'));
      if (prev && parseDate(prev.date)) {
        var dd = daysBetween(prev.date, r.date);
        if (dd < 0) items.push(item('F_DATE_BEFORE_PREV', 'block', 'date', 'Дата раніше за попередні прийняті показання.', 'Дата раньше предыдущих принятых показаний.', 'Перевірте дату.', 'Проверьте дату.'));
        else if (dd === 0) items.push(item('R_ONE_PER_DATE', 'warn', 'date', lite ? 'На цю дату вже є запис.' : 'На цю дату вже є запис — ХТМ дозволяє один запис на дату.', lite ? 'На эту дату уже есть запись.' : 'На эту дату уже есть запись — ХТМ разрешает одну запись на дату.', 'Нове значення замінить попереднє (редагування останнього запису).', 'Новое значение заменит прежнее (редактирование последней записи).'));
      }
    }

    // --- Температуры
    ['tSupply', 'tReturn'].forEach(function (k) {
      var t = v[k]; if (t === null) return;
      if (t === 0 || t < C.TEMP_MIN || t > C.TEMP_MAX) items.push(item('R_TEMP_RANGE', 'block', k,
        'Температура ' + f1(t) + ' °C — робот приймає від 5 до 95 і не 0.', 'Температура ' + f1(t) + ' °C — робот принимает от 5 до 95 и не 0.',
        'Навіть при вимкненому опаленні температура не 0. Якщо лічильник показує 0 або нічого — він несправний.',
        'Даже при выключенном отоплении температура не 0. Если счётчик показывает 0 или ничего — он неисправен.'));
    });

    // --- C. Физика текущих мгновенных значений (наша проверка)
    if (v.flow !== null && v.tSupply !== null && v.tReturn !== null) {
      var dtNow = v.tSupply - v.tReturn; d.dtNow = dtNow;
      if (v.flow > 0 && dtNow < 0) items.push(item('P_SUPPLY_LT_RETURN', 'warn', 'tReturn',
        'Обратка гарячіша за подачу — схоже, температури переплутані.', 'Обратка горячее подачи — похоже, температуры перепутаны.',
        'Подача (ht) — перша з двох, що чергуються.', 'Подача (ht) — первая из двух чередующихся.'));
      if (v.power !== null && dtNow >= 0) {
        var expected = C.GCAL_KW_FACTOR * v.flow * dtNow; d.powerExpected = expected;
        if (v.flow === 0 && v.power > C.POWER_ABS) items.push(item('P_POWER_NO_FLOW', 'warn', 'power', 'Витрата 0, а потужність ' + f3(v.power) + ' кВт.', 'Расход 0, а мощность ' + f3(v.power) + ' кВт.', 'Перевірте потужність і витрату.', 'Проверьте мощность и расход.'));
        else if (v.flow > 0 && Math.abs(v.power - expected) > Math.max(C.POWER_ABS, Math.abs(expected) * C.POWER_TOL)) items.push(item('P_POWER', 'warn', 'power',
          'Потужність не сходиться: має бути ≈ ' + f3(expected) + ' кВт (1,163 × витрата × різниця температур).', 'Мощность не сходится: должно быть ≈ ' + f3(expected) + ' кВт (1,163 × расход × разница температур).',
          'Перевірте потужність, витрату і обидві температури — одна з цифр, ймовірно, переписана з помилкою.', 'Проверьте мощность, расход и обе температуры — одна из цифр, вероятно, переписана с ошибкой.', { expected: expected }));
      }
    }
    if (!lite && !noError(r.errCode)) {
      var ec = normCode(r.errCode), ex = ERR_CODES[ec];
      items.push(item('M_ERROR_CODE', 'warn', 'errCode',
        'Лічильник показує код помилки ' + ec + (ex ? ' — ' + ex[0] : '') + '.', 'Счётчик показывает код ошибки ' + ec + (ex ? ' — ' + ex[1] : '') + '.',
        (ex ? ex[2] + ' ' : '') + 'Поки є помилка, енергія може не рахуватися. Якщо на екрані «E» і лише прочерки — помилки немає, виберіть «Помилок немає».',
        (ex ? ex[3] + ' ' : '') + 'Пока есть ошибка, энергия может не считаться. Если на экране «E» и только прочерки — ошибки нет, выберите «Ошибок нет».'));
    }

    // --- B. Сравнение с прошлым принятым (правила робота)
    if (!prev) {
      if (lite) items.push(item('I_NO_PREV', 'info', null,
        'Попередніх показань ще немає — наступного разу порівняємо з цими.', 'Предыдущих показаний ещё нет — в следующий раз сравним с этими.'));
      else items.push(item('I_NO_PREV', 'info', null,
        'Немає попередніх прийнятих показань — перевіримо лише формат і фізику.', 'Нет предыдущих принятых показаний — проверим только формат и физику.',
        'Внесіть «останні прийняті» з кабінету ХТМ, щоб перевіряти як робот.', 'Внесите «последние принятые» из кабинета ХТМ, чтобы проверять как робот.'));
    } else {
      var mono = [['energy', 'R_MONO_ENERGY'], ['volume', 'R_MONO_VOLUME'], ['hours', 'R_MONO_HOURS'], ['errHours', 'R_MONO_ERRHOURS']].concat(meter.times3 ? [['flowHours', 'R_MONO_FLOWHOURS']] : []);
      mono.forEach(function (m) {
        var k = m[0], a = v[k], b = pv[k]; if (a === null || b === null) return;
        var bad = k === 'errHours' ? a < b : a < b;
        if (bad) {
          var f = FIELDS.filter(function (x) { return x.key === k; })[0] || FIELD_PD;
          items.push(item(m[1], 'block', k,
            f.uk + ' ' + a + ' менше за попередні ' + b + '.', f.ru + ' ' + a + ' меньше предыдущих ' + b + '.',
            'Зніміть показання ще раз — накопичувальні значення не зменшуються. Часто це пропущена цифра або крапка.',
            'Снимите показания ещё раз — накопительные значения не уменьшаются. Часто это пропущенная цифра или точка.', { expected: { min: b } }));
        }
      });
      var dE = (v.energy !== null && pv.energy !== null) ? v.energy - pv.energy : null;
      var dV = (v.volume !== null && pv.volume !== null) ? v.volume - pv.volume : null;
      var dH = (v.hours !== null && pv.hours !== null) ? v.hours - pv.hours : null;
      d.dE = dE; d.dV = dV; d.dH = dH;

      // 125-а: приріст і межа — в одиниці кабінету (meter.cab: {k — у Гкал, uk/ru — підпис}), «на екрані» — в одиниці табло (meter.screen)
      var cb = meter.cab || { k: 1, uk: 'Гкал', ru: 'Гкал' }, sc = meter.screen || { k: 1 };
      var lim = function (lg) { return cb.k === 1 ? '15 ' + cb[lg] : f3(15 / cb.k) + ' ' + cb[lg] + ' (15 Гкал)'; };
      // не ХТМ: межі робота немає, але 15 Гкал за місяць на квартиру — майже напевно пропущена крапка (лише попередження)
      if (lite && dE !== null && dE >= C.ENERGY_JUMP) items.push(item('R_ENERGY_JUMP', 'warn', 'energy',
        'Приріст ' + f3(dE / cb.k) + ' ' + cb.uk + ' — для квартири забагато.', 'Прирост ' + f3(dE / cb.k) + ' ' + cb.ru + ' — для квартиры слишком много.',
        'Схоже, пропущена крапка: на екрані, ймовірно, ' + f3(v.energy / sc.k / 10) + ' або ' + f3(v.energy / sc.k / 1000) + '.', 'Похоже, пропущена точка: на экране, вероятно, ' + f3(v.energy / sc.k / 10) + ' или ' + f3(v.energy / sc.k / 1000) + '.'));
      else if (dE !== null && dE >= C.ENERGY_JUMP) items.push(item('R_ENERGY_JUMP', 'block', 'energy',
        'Приріст ' + f3(dE / cb.k) + ' ' + cb.uk + ' — робот приймає менше ' + lim('uk') + ' за період.', 'Прирост ' + f3(dE / cb.k) + ' ' + cb.ru + ' — робот принимает меньше ' + lim('ru') + ' за период.',
        'Схоже, пропущена крапка: на екрані, ймовірно, ' + f3(v.energy / sc.k / 10) + ' або ' + f3(v.energy / sc.k / 1000) + '.', 'Похоже, пропущена точка: на экране, вероятно, ' + f3(v.energy / sc.k / 10) + ' или ' + f3(v.energy / sc.k / 1000) + '.'));

      if (dE !== null && dV !== null && dE > 0 && dV === 0) items.push(item('R_ENERGY_WITHOUT_VOLUME', 'block', 'volume',
        'Енергія зросла, а обсяг теплоносія не змінився.', 'Энергия выросла, а объём теплоносителя не изменился.',
        'Перевірте обсяг (м³) — він має рости разом з енергією.', 'Проверьте объём (м³) — он должен расти вместе с энергией.'));

      if (dE !== null && dV !== null && dV > 0 && dE > 0) {
        var dtAvg = dE * 1000 / dV; d.dtAvg = dtAvg;
        if (dtAvg < C.DT_MIN) items.push(item('R_DT_MIN', 'block', 'energy',
          'Середня різниця температур за період ' + f1(dtAvg) + ' °C — робот вимагає не менше 2,5.', 'Средняя разница температур за период ' + f1(dtAvg) + ' °C — робот требует не меньше 2,5.',
          'Якщо цифри вірні — теплоносій біжить занадто швидко: зменшіть витрату (1–1,5 л на м²) і передайте нові показання наступного місяця.',
          'Если цифры верны — теплоноситель бежит слишком быстро: уменьшите расход (1–1,5 л на м²) и передайте новые показания в следующем месяце.'));
        else if (dtAvg > C.DT_MAX) items.push(item('R_DT_MAX', 'block', 'energy',
          'Середня різниця температур за період ' + f1(dtAvg) + ' °C — робот приймає не більше 50.', 'Средняя разница температур за период ' + f1(dtAvg) + ' °C — робот принимает не больше 50.',
          'Найчастіше — помилка в енергії або обсязі. Перевірте обидва.', 'Чаще всего — ошибка в энергии или объёме. Проверьте оба.'));
        else if (dtAvg < C.DT_WARN) items.push(item('W_DT_LOW', 'warn', 'energy',
          'Середня різниця температур ' + f1(dtAvg) + ' °C — близько до межі робота (2,5).', 'Средняя разница температур ' + f1(dtAvg) + ' °C — близко к границе робота (2,5).',
          'Показання, ймовірно, приймуть, але варто зменшити витрату.', 'Показания, вероятно, примут, но стоит уменьшить расход.'));
      }

      if (v.tSupply !== null && v.tReturn !== null && dV === 0 && (v.tSupply - v.tReturn) > C.DT_NO_FLOW) items.push(item('R_DT_NO_FLOW', 'block', 'volume',
        'Різниця температур більше 15 °C, а обсяг не змінився.', 'Разница температур больше 15 °C, а объём не изменился.',
        'Якщо опалення працює — лічильник, ймовірно, несправний. Якщо вимкнене — зніміть показання ще раз.', 'Если отопление работает — счётчик, вероятно, неисправен. Если выключено — снимите показания ещё раз.'));

      if (dH !== null && parseDate(prev.date) && parseDate(r.date)) {
        var days = daysBetween(prev.date, r.date), cal = days * 24; d.calHours = cal;
        var diff = dH - cal;
        if (meter.hoursOnlyWithFlow) {
          if (diff > C.HOURS_TOL) items.push(item('R_HOURS_CALENDAR', 'block', 'hours',
            'Годин роботи додалося ' + dH + ', а між датами лише ' + cal + '.', 'Часов работы прибавилось ' + dH + ', а между датами только ' + cal + '.',
            'Перевірте дату зняття і години.', 'Проверьте дату снятия и часы.'));
        } else if (Math.abs(diff) > C.HOURS_TOL) {
          items.push(item('R_HOURS_CALENDAR', 'block', 'hours',
            'Між датами ' + cal + ' год, а лічильник додав ' + dH + ' год. Різниця ' + Math.abs(diff) + ' — робот допускає 24.',
            'Между датами ' + cal + ' ч, а счётчик прибавил ' + dH + ' ч. Разница ' + Math.abs(diff) + ' — робот допускает 24.',
            'Найчастіше показання зняли в один день, а дату вказали іншу. Вкажіть справжню дату зняття або зніміть ще раз сьогодні.',
            'Чаще всего показания сняли в один день, а дату указали другую. Укажите настоящую дату снятия или снимите ещё раз сегодня.', { expected: { min: cal - C.HOURS_TOL, max: cal + C.HOURS_TOL } }));
        }
        if (dV !== null && dH > 0) {
          var avgFlow = dV / dH; d.avgFlow = avgFlow;
          var qt = num(meter.transitionalFlow);
          if (qt && avgFlow < C.FLOW_K * qt) items.push(item('R_FLOW_MIN', 'block', 'volume',
            'Середня витрата ' + f3(avgFlow) + ' м³/год менша за 0,3 × перехідної (' + f3(C.FLOW_K * qt) + ').', 'Средний расход ' + f3(avgFlow) + ' м³/ч меньше 0,3 × переходного (' + f3(C.FLOW_K * qt) + ').',
            'Налаштуйте систему так, щоб витрата була більшою за перехідну. Перехідна витрата — у кабінеті ХТМ, паспорті чи акті.',
            'Настройте систему так, чтобы расход был больше переходного. Переходный расход — в кабинете ХТМ, паспорте или акте.'));
        }
      }
      if (v.errHours !== null && pv.errHours !== null && v.errHours > pv.errHours) items.push(item('M_ERRHOURS_GREW', 'warn', 'errHours',
        'Години з помилкою зросли на ' + (v.errHours - pv.errHours) + ' — стільки часу лічильник не рахував тепло.', 'Часы с ошибкой выросли на ' + (v.errHours - pv.errHours) + ' — столько времени счётчик не считал тепло.',
        'Їх треба передати як є. Якщо ростуть далі — зверніться до сервісу лічильника.', 'Их нужно передать как есть. Если растут дальше — обратитесь в сервис счётчика.'));
      if (dE !== null && dE >= 0) { d.cost = dE * C.TARIFF; if (d.dH > 0) d.perDay = dE / (d.dH / 24); }
    }

    // --- Повирка
    if (meter.verifiedUntil && parseDate(meter.verifiedUntil) && daysBetween(meter.verifiedUntil, today) > 0) items.push(lite
      ? item('R_VERIFICATION', 'block', null,
        'Термін повірки минув ' + toHtmDate(meter.verifiedUntil) + ' — показання неповіреного лічильника постачальник не враховує.', 'Срок поверки истёк ' + toHtmDate(meter.verifiedUntil) + ' — показания неповеренного счётчика поставщик не учитывает.',
        'Потрібна повірка (раз на 4 роки) і документ про неї постачальнику.', 'Нужна поверка (раз в 4 года) и документ о ней поставщику.')
      : item('R_VERIFICATION', 'block', null,
      'Термін повірки минув ' + toHtmDate(meter.verifiedUntil) + ' — робот не приймає показання неповіреного лічильника.', 'Срок поверки истёк ' + toHtmDate(meter.verifiedUntil) + ' — робот не принимает показания неповеренного счётчика.',
      'Потрібна повірка (ХТМ: 050-670-13-45).', 'Нужна поверка (ХТМ: 050-670-13-45).'));

    var verdict = items.some(function (i) { return i.level === 'block'; }) ? 'block'
      : items.some(function (i) { return i.level === 'warn'; }) ? 'warn' : 'ok';
    // risky — усі «не прийме» лише з порівняння з попередніми показаннями (наші дані можуть бути застарілі, лічильник замінили…):
    // людина може передати на свій ризик (власник 12.11.2026). Порожні поля, дата, температура поза 5–95, повірка — ні.
    var blocks = items.filter(function (i) { return i.level === 'block'; });
    var risky = blocks.length > 0 && blocks.every(function (i) { return PREV_BASED.indexOf(i.code) >= 0; });
    return { verdict: verdict, items: items, derived: d, risky: risky };
  }

  /** Быстрая проверка одного поля на лету (для подсказки под полем). */
  function checkField(key, value, prev) {
    if (key === 'errCode') {   // подсказка прямо под полем кода: нет ошибки / что значит код
      if (String(value || '').trim() === '') return null;
      var ec = normCode(value), ex = ERR_CODES[ec];
      if (ec === 'E---') return { level: 'ok', msg: { uk: '«E» і прочерки — помилок немає (у ХТМ піде E---).', ru: '«E» и прочерки — ошибок нет (в ХТМ уйдёт E---).' } };
      return { level: 'warn', msg: ex ? { uk: ec + ' — ' + ex[0] + '. ' + ex[2], ru: ec + ' — ' + ex[1] + '. ' + ex[3] } : { uk: 'У ХТМ піде код ' + ec + '.', ru: 'В ХТМ уйдёт код ' + ec + '.' } };
    }
    var n = num(value);
    if (key !== 'errCode' && key !== 'date' && String(value || '').trim() !== '' && n === null) return { level: 'warn', msg: { uk: 'Лише цифри та крапка.', ru: 'Только цифры и точка.' } };
    if (HOUR_KEYS.indexOf(key) >= 0 && n !== null && !saneHours(n)) return { level: 'block', msg: { uk: 'Стільки годин не буває (понад 30 років) — схоже на заводський номер. Години — на екрані з «h».', ru: 'Столько часов не бывает (больше 30 лет) — похоже на заводской номер. Часы — на экране с «h».' } };
    if (n === null || !prev) return null;
    var b = num(prev[key]); if (HOUR_KEYS.indexOf(key) >= 0 && !saneHours(b)) b = null;   // минулі години, яких не буває, — не порівнюємо
    if (['energy', 'volume', 'hours', 'errHours'].indexOf(key) >= 0 && b !== null && n < b) return { level: 'block', msg: { uk: 'Менше за попередні (' + b + ').', ru: 'Меньше предыдущих (' + b + ').' } };
    if (key === 'energy' && b !== null && n - b >= C.ENERGY_JUMP) return { level: 'block', msg: { uk: 'Завеликий приріст — перевірте крапку.', ru: 'Слишком большой прирост — проверьте точку.' } };
    if ((key === 'tSupply' || key === 'tReturn') && (n === 0 || n < C.TEMP_MIN || n > C.TEMP_MAX)) return { level: 'block', msg: { uk: 'Від 5 до 95 °C.', ru: 'От 5 до 95 °C.' } };
    var cum = ['energy', 'volume', 'hours', 'errHours'].indexOf(key) >= 0 && b !== null && n >= b;
    return { level: 'ok', delta: cum ? n - b : null, msg: { uk: cum ? '+' + f3(n - b) : '', ru: cum ? '+' + f3(n - b) : '' } };
  }

  /** Расшифровка ответа робота ХТМ (строка «Статус: …» журнала) → код + совет. */
  function decodeRobot(text) {
    var s = String(text || '');
    if (/успішно\s+додані/i.test(s)) return { code: 'ACCEPTED' };
    var map = [
      [/відсутній в базі/i, 'R_NOT_IN_DB', 'Прилад не внесено в базу ХТМ або вузол не прийнято на облік. Уточніть: 067-370-87-75.', 'Прибор не внесён в базу ХТМ или узел не принят на учёт. Уточните: 067-370-87-75.'],
      [/демонтован|демонтирован/i, 'R_DISMOUNTED', 'Прилад розпломбований (знятий з обліку). Уточніть: 050-670-13-45.', 'Прибор распломбирован (снят с учёта). Уточните: 050-670-13-45.'],
      [/повірку/i, 'R_VERIFICATION', 'Минув строк повірки — потрібна повірка.', 'Истёк срок поверки — нужна поверка.'],
      [/пропущені останні показання/i, 'R_SEASON_GAP', 'Не вистачає показань кінця минулого сезону — їх подають письмово в абонвідділ.', 'Не хватает показаний конца прошлого сезона — их подают письменно в абонотдел.'],
      [/Різниця складає .*має бути не більше 24/i, 'R_HOURS_CALENDAR', 'Години роботи не збігаються з календарем: перевірте дату зняття.', 'Часы работы не совпадают с календарём: проверьте дату снятия.'],
      [/меньше 15 ГКал|менше 15 ГКал/i, 'R_ENERGY_JUMP', 'Завеликий приріст енергії — ймовірно, пропущена крапка.', 'Слишком большой прирост энергии — вероятно, пропущена точка.'],
      [/не меньшою 2\.5|не меншою 2\.5/i, 'R_DT_MIN', 'Теплоносій біжить занадто швидко (ΔT < 2,5). Зменшіть витрату.', 'Теплоноситель бежит слишком быстро (ΔT < 2,5). Уменьшите расход.'],
      [/не більше 50/i, 'R_DT_MAX', 'Помилка в енергії або обсязі (ΔT > 50).', 'Ошибка в энергии или объёме (ΔT > 50).'],
      [/Переходної витрати/i, 'R_FLOW_MIN', 'Витрата менша за перехідну — налаштуйте систему.', 'Расход меньше переходного — настройте систему.'],
      [/від 5 до 95/i, 'R_TEMP_RANGE', 'Температура 0 або поза 5–95 °C.', 'Температура 0 или вне 5–95 °C.'],
      [/більше 15 градусів/i, 'R_DT_NO_FLOW', 'ΔT > 15 °C без руху теплоносія — можлива несправність.', 'ΔT > 15 °C без движения теплоносителя — возможна неисправность.'],
      [/витрати теплоносія.*не змінились/i, 'R_ENERGY_WITHOUT_VOLUME', 'Енергія росла, а обсяг ні — перевірте обсяг.', 'Энергия росла, а объём нет — проверьте объём.'],
      [/теплоенергії.*мають бути більше/i, 'R_MONO_ENERGY', 'Енергія менша за попередню.', 'Энергия меньше предыдущей.'],
      [/об'єму.*мають бути більше|об’єму.*мають бути більше/i, 'R_MONO_VOLUME', 'Обсяг менший за попередній.', 'Объём меньше предыдущего.'],
      [/часу.*ма[єю]ть? бути більше/i, 'R_MONO_HOURS', 'Години менші за попередні.', 'Часы меньше предыдущих.']
    ];
    for (var i = 0; i < map.length; i++) if (map[i][0].test(s)) return { code: map[i][1], fix: { uk: map[i][2], ru: map[i][3] } };
    if (/не\s+при[йн]{1,2}яті/i.test(s)) return { code: 'REJECTED_OTHER', fix: { uk: 'Причину вказано в журналі ХТМ.', ru: 'Причина указана в журнале ХТМ.' } };
    return { code: 'UNKNOWN' };
  }

  /** Правила «не прийме», що спираються лише на попередні показання (не на форму ХТМ чи фізику самого запису). */
  var PREV_BASED = ['F_DATE_BEFORE_PREV', 'R_MONO_ENERGY', 'R_MONO_VOLUME', 'R_MONO_HOURS', 'R_MONO_ERRHOURS', 'R_MONO_FLOWHOURS', 'R_ENERGY_JUMP', 'R_ENERGY_WITHOUT_VOLUME',
    'R_DT_MIN', 'R_DT_MAX', 'R_DT_NO_FLOW', 'R_HOURS_CALENDAR', 'R_FLOW_MIN'];
  var api = { C: C, FIELDS: FIELDS, FIELD_PD: FIELD_PD, PREV_BASED: PREV_BASED, num: num, validate: validate, checkField: checkField, decodeRobot: decodeRobot,
    windowState: windowState, formatForHtm: formatForHtm, saneHours: saneHours, toHtmDate: toHtmDate, daysBetween: daysBetween, normCode: normCode, ERR_CODES: ERR_CODES, ymd: ymd };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TeploRules = api;
})(typeof window !== 'undefined' ? window : this);
