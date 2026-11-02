/*
 * Теплосервис — каталог моделей и шаги снятия (read_steps).
 * Шаг: { press:'short'|'long'|null, count, fields:[ключи], lcd:{digits, tag, alt}, hint:{uk,ru} }
 * status: 'verified' — шаги подтверждены инструкцией; 'draft' — известна часть, остальное «шукайте».
 * hoursOnlyWithFlow — прибор считает часы только при расходе (памятка ХТМ): правило часов смягчается.
 */
(function (root) {
  'use strict';
  var L = function (uk, ru) { return { uk: uk, ru: ru }; };

  var SHARKY_774 = [
    { press: 'short', count: 1, fields: ['energy'], lcd: { digits: '00015.482', tag: 'Gcal' },
      hint: L('Перший екран після натискання — накопичена енергія.', 'Первый экран после нажатия — накопленная энергия.') },
    { press: 'short', count: 1, fields: ['volume'], lcd: { digits: '02724.494', tag: 'm³', corner: true },
      hint: L('«m³» у правому верхньому куті — це обсяг теплоносія.', '«m³» в правом верхнем углу — это объём теплоносителя.') },
    { press: 'short', count: 1, fields: ['flow'], lcd: { digits: '1.067', tag: 'm³/h' },
      hint: L('Миттєва витрата, м³/год.', 'Мгновенный расход, м³/ч.') },
    { press: 'short', count: 1, fields: ['power'], lcd: { digits: '6.790', tag: 'kW' },
      hint: L('Миттєва потужність, кВт.', 'Мгновенная мощность, кВт.') },
    { press: 'short', count: 1, fields: ['tSupply', 'tReturn'], lcd: { digits: '56.57', tag: 'ht', alt: { digits: '51.11', tag: 'ct' } },
      hint: L('Екран сам чергує «ht» (подача) і «ct» (обратка) — дочекайтеся обох.', 'Экран сам чередует «ht» (подача) и «ct» (обратка) — дождитесь обоих.') },
    { press: 'short', count: 2, fields: ['hours', 'errHours'], lcd: { digits: '35611', tag: 'On', alt: { digits: '153', tag: 'Eh' } },
      hint: L('Ще 2 натискання. Чергуються «On» (години роботи) і «Eh» (години з помилкою).', 'Ещё 2 нажатия. Чередуются «On» (часы работы) и «Eh» (часы с ошибкой).') },
    { press: 'short', count: 1, fields: ['errCode'], lcd: { digits: 'E-------', tag: '' },
      hint: L('«E» і лише прочерки («E-------») — помилок немає. Цифра чи буква після «E-» («E-9», «C-1») — код помилки; «Err» біля значень — теж є помилка.', '«E» и только прочерки («E-------») — ошибок нет. Цифра или буква после «E-» («E-9», «C-1») — код ошибки; «Err» рядом со значениями — тоже есть ошибка.') }
  ];

  /** Шаги для моделей без проверенной инструкции: что искать, без точного числа нажатий. */
  function genericSteps(intro) {
    return [
      { press: null, count: 0, fields: ['energy'], lcd: { digits: '00000.000', tag: 'Gcal' },
        hint: intro || L('Енергія зазвичай на екрані за замовчуванням (або після першого натискання).', 'Энергия обычно на экране по умолчанию (или после первого нажатия).') },
      { press: 'short', count: null, fields: ['volume'], lcd: { digits: '0000.000', tag: 'm³' },
        hint: L('Короткими натисканнями шукайте екран з «m³».', 'Короткими нажатиями ищите экран с «m³».') },
      { press: 'short', count: null, fields: ['flow'], lcd: { digits: '0.000', tag: 'm³/h' },
        hint: L('Шукайте «m³/h» — миттєва витрата. Буває в іншій «петлі» (довге натискання).', 'Ищите «m³/h» — мгновенный расход. Бывает в другой «петле» (длинное нажатие).') },
      { press: 'short', count: null, fields: ['power'], lcd: { digits: '0.000', tag: 'kW' },
        hint: L('Шукайте «kW» — потужність.', 'Ищите «kW» — мощность.') },
      { press: 'short', count: null, fields: ['tSupply', 'tReturn'], lcd: { digits: '00.00', tag: '°C' },
        hint: L('Дві температури: подача (вища) і обратка (нижча). Підписи бувають T1/T2, ht/ct, ↑/↓.', 'Две температуры: подача (выше) и обратка (ниже). Подписи бывают T1/T2, ht/ct, ↑/↓.') },
      { press: 'short', count: null, fields: ['hours', 'errHours'], lcd: { digits: '00000', tag: 'h' },
        hint: L('Години роботи і години з помилкою (часто «h», «On», «Eh», «Err h»). Немає годин з помилкою — впишіть 0.', 'Часы работы и часы с ошибкой (часто «h», «On», «Eh», «Err h»). Нет часов с ошибкой — впишите 0.') },
      { press: 'short', count: null, fields: ['errCode'], lcd: { digits: '- - - -', tag: '' },
        hint: L('Код помилки або інформаційний екран. «E» і лише прочерки або коду немає — помилок немає.', 'Код ошибки или информационный экран. «E» и только прочерки или кода нет — ошибок нет.') }
    ];
  }

  var MODELS = [
    { id: 'sharky774', vendor: 'Diehl', name: 'SHARKY 774', status: 'verified', unit: 'Gcal', units: ['Gcal'], sleepMin: 4, buttons: 1,
      where: L('Наклейка на корпусі; у кабінеті ХТМ — «ПУ Sharky 774».', 'Наклейка на корпусе; в кабинете ХТМ — «ПУ Sharky 774».'),
      note: L('Інструкція OTOS. Засинає через 4 хв — натисніть кнопку знову й долистайте.', 'Инструкция OTOS. Засыпает через 4 мин — нажмите кнопку снова и долистайте.'),
      steps: SHARKY_774 },
    { id: 'sharky775', vendor: 'Diehl', name: 'SHARKY 775 / SONOMETER 1100', status: 'draft', unit: 'Gcal', units: ['Gcal', 'MWh', 'GJ', 'kWh'], sleepMin: 4,
      where: L('Наклейка на корпусі.', 'Наклейка на корпусе.'),
      note: L('Порядок: енергія → обсяг → витрата → потужність → температури → дні → код.', 'Порядок: энергия → объём → расход → мощность → температуры → дни → код.'),
      steps: genericSteps() },
    { id: 't330', vendor: 'Landis+Gyr', name: 'ULTRAHEAT T330', status: 'draft', unit: 'MWh', units: ['MWh', 'kWh', 'GJ', 'Gcal'], sleepMin: 0.5,
      where: L('Наклейка «ULTRAHEAT», «T330», «UH30».', 'Наклейка «ULTRAHEAT», «T330», «UH30».'),
      note: L('Коротке натискання (< 2 с) — наступний рядок, довге (> 3 с) — наступна «петля». Поточні значення — у петлі 1.', 'Короткое нажатие (< 2 с) — следующая строка, длинное (> 3 с) — следующая «петля». Текущие значения — в петле 1.'),
      steps: genericSteps(L('Петля 0: тест екрана → енергія. Одиниця — та, що на екрані (часто MWh).', 'Петля 0: тест экрана → энергия. Единица — та, что на экране (часто MWh).')) },
    { id: 't230', vendor: 'Landis+Gyr', name: 'ULTRAHEAT T230', status: 'draft', unit: 'MWh', units: ['MWh', 'kWh', 'GJ'], sleepMin: 0.5,
      where: L('Наклейка «ULTRAHEAT T230».', 'Наклейка «ULTRAHEAT T230».'), note: L('Як T330.', 'Как T330.'), steps: genericSteps() },
    { id: 'multical302', vendor: 'Kamstrup', name: 'MULTICAL 302', status: 'draft', unit: 'GJ', units: ['GJ', 'MWh', 'kWh'], sleepMin: 4,
      where: L('Напис «MULTICAL» на кришці.', 'Надпись «MULTICAL» на крышке.'),
      note: L('Порядок: енергія → обсяг → години → T1 → T2 → ΔT → витрата → потужність. Гкал немає — перерахуємо.', 'Порядок: энергия → объём → часы → T1 → T2 → ΔT → расход → мощность. Гкал нет — пересчитаем.'),
      steps: genericSteps() },
    { id: 'elf', vendor: 'Apator', name: 'ELF / LQM-III ELF', status: 'draft', unit: 'Gcal', units: ['Gcal', 'GJ', 'kWh'], sleepMin: 3, hoursOnlyWithFlow: true,
      where: L('Напис «ELF» або «LQM-III».', 'Надпись «ELF» или «LQM-III».'),
      note: L('Символ одиниці на екрані не показується — оберіть одиницю з паспорта. Години рахує лише при витраті.', 'Символ единицы на экране не показывается — выберите единицу из паспорта. Часы считает только при расходе.'),
      steps: genericSteps() },
    { id: 'sensostar', vendor: 'Engelmann', name: 'SensoStar', status: 'draft', unit: 'MWh', units: ['MWh', 'kWh', 'GJ', 'Gcal'], sleepMin: 2,
      where: L('Напис «SensoStar».', 'Надпись «SensoStar».'), note: L('Довге натискання (> 4 с) — наступний рівень меню.', 'Длинное нажатие (> 4 с) — следующий уровень меню.'), steps: genericSteps() },
    { id: 'nik7071', vendor: 'НІК', name: 'НІК 7071', status: 'draft', unit: 'Gcal', units: ['Gcal', 'kWh'], sleepMin: 5,
      where: L('Напис «НІК».', 'Надпись «НІК».'), note: L('Порядок: ENER → POW → VOL → FLOW → T → dT → Stat.', 'Порядок: ENER → POW → VOL → FLOW → T → dT → Stat.'), steps: genericSteps() },
    { id: 'trust', vendor: '—', name: 'TRUST', status: 'draft', unit: 'Gcal', units: ['Gcal', 'GJ', 'kWh', 'MWh'], sleepMin: 0, hoursOnlyWithFlow: true,
      where: L('Наклейка «Теплолічильник TRUST».', 'Наклейка «Теплолічильник TRUST».'),
      note: L('Інструкції ще немає. Години рахує лише при витраті (памятка ХТМ).', 'Инструкции ещё нет. Часы считает только при расходе (памятка ХТМ).'), steps: genericSteps() },
    { id: 'other', vendor: '', name: '', status: 'universal', unit: 'Gcal', units: ['Gcal', 'MWh', 'GJ', 'kWh'], sleepMin: 0,
      where: L('', ''), note: L('Універсальний режим: 10 полів у порядку журналу ХТМ.', 'Универсальный режим: 10 полей в порядке журнала ХТМ.'), steps: genericSteps() }
  ];

  // Пересчёт энергии в Гкал (форма ХТМ — в Гкал)
  var TO_GCAL = { Gcal: 1, MWh: 0.859845, kWh: 0.000859845, GJ: 0.238846 };

  var api = { MODELS: MODELS, TO_GCAL: TO_GCAL, byId: function (id) { return MODELS.filter(function (m) { return m.id === id; })[0] || null; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TeploModels = api;
})(typeof window !== 'undefined' ? window : this);
