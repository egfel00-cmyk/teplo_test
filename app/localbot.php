<?php
// Автоподача до місцевих постачальників (області) — загальний робот замість окремого коду під кожне КП.
// Владелец 10.11.2026: «даю да на все автоотправки всех коммунальных провайдеров во всех громадах, что уже добавлены — и на новые сразу,
// если есть возможность отправлять данные в фоне». Как подключать новых — skills/oblast-providers/SKILL.md, раздел «Автоподача».
//
//  t form — показання приймає форма на сайті без входу: особовий рахунок → сторінка абонента → форма показань (Кам’янець, mtve.kp.km.ua);
//  t cab  — кабінет із паролем людини: звичайна HTML-форма входу без капчі → форма показань;
//  t mail — постачальник приймає показання на e-mail: лист зі скриньки сервісу (лише коли пошта налаштована, Mail::on()).
//
// Правила (як у Водоканалу й ХТМ): капчу й антибот-перевірки не обходимо — побачили, стоп і «подайте самі»; лише за згодою людини;
// підключення = «Перевірити»: дійти до форми показань і НЕ надіслати; подаємо тільки те, що однозначно лягає в поля (номер лічильника в підписі
// або одне поле на один лічильник), інакше стоп — каркас сторінки без цифр іде в /admin (/api/health → lbot.last), щоб наступна сесія доналаштувала.
declare(strict_types=1);
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class LocalBot {
  /** Боти за `via` у довіднику (app/data/prov_*.json). Ключ ≤ 7 символів (cab_creds.prov = 'L' + ключ, VARCHAR(8)). */
  const BOTS = [
    // Кам’янець-Подільський: «Переглянути стан оплати послуг. Передати поточні показники» — код абонента (74-108-61) у три поля p1–p3 → сторінка
    // абонента → «Передати поточні покази водолічильника» → поля лічильників (1–5) → «Зберегти»; показання перевіряє оператор КП (на сайті — пізніше).
    'mtve' => ['t' => 'form', 'kinds' => ['water'], 'org' => 'КП «Міськтепловоденергія»', 'site' => 'mtve.kp.km.ua',
      'start' => 'https://mtve.kp.km.ua/', 'host' => '~(^|\.)mtve\.kp\.km\.ua$~i', 'need' => ['acc'], 'acc' => ['fields' => ['p1', 'p2', 'p3'], 'hint' => '74-108-61'],
      'win' => [1, 28], 'later' => true,
      // 10.11.2026 (102-а): на живому сайті код абонента перевіряє скрипт сторінки (AJAX, під полями — «Помилковий код абонента»), звичайний GET ?p1&p2&p3
      // повертає головну без сторінки абонента (проба v2: page/no_form). Ендпоінт скрипта не розбираємо — бота вимкнено, доки не з’явиться звичайний шлях.
      'off' => 'script'],
    // Чорноморськ: показання холодної води з 25 числа до кінця місяця — у т.ч. на e-mail водоканалу (сайт cvk.od.ua, 10.11.2026)
    // Львівщина, світло: Львівобленерго приймає показники на pokaz@loe.lviv.ua — лист «10-значний код пробіл показник» (приклад «0000011111 2222»;
    // golossokal.com.ua 03.2026, zaxid.net). Вікно — з 28 числа до 3-го наступного. Лише однозонний: формату для зон не знайшли.
    'loe' => ['t' => 'mail', 'kinds' => ['elec'], 'org' => 'Львівобленерго', 'site' => 'loe.lviv.ua', 'to' => 'pokaz@loe.lviv.ua', 'fmt' => 'code',
      'need' => ['acc'], 'acc' => ['digits' => 10, 'hint' => '0000011111'], 'win' => [28, 3], 'one' => true],
    'cvk' => ['t' => 'mail', 'kinds' => ['water'], 'org' => 'КП «Чорноморськводоканал»', 'site' => 'cvk.od.ua',
      'to' => 'chornomorskvodokanal@gmail.com', 'need' => ['acc', 'name', 'addr', 'phone'], 'win' => [25, 31]],
    // Львів, вода (103-я): ЛМКП «Львівводоканал» приймає показання холодної (і гарячої — для водовідведення) води на e-mail відділу збуту свого району
    // (zaxid.net 27.04.2020 і 28.10.2021 — адреси всіх районів; sykhiv.media 2025 — sih_r@ діє). Лист «номер особового рахунку, адреса, номер лічильника-кінцевий показник»
    // — без номера лічильника не надсилаємо (`serial`). Строк — з 10 числа до передостаннього робочого дня місяця; беремо до 25-го (у лютому передостанній робочий буває 25-го).
    'lvk' => ['t' => 'mail', 'kinds' => ['water'], 'org' => 'ЛМКП «Львівводоканал»', 'site' => 'lvk.lviv.ua', 'fmt' => 'line', 'serial' => true,
      'need' => ['dist', 'acc', 'addr'], 'win' => [10, 25],
      'to' => ['gal' => 'gal_r@lvk.lviv.ua', 'fra' => 'fra_r@lvk.lviv.ua', 'lych' => 'lych_r@lvk.lviv.ua', 'sih' => 'sih_r@lvk.lviv.ua',
        'zal' => 'zal_r@lvk.lviv.ua', 'she' => 'she_r@lvk.lviv.ua', 'pozam' => 'pozam_r@lvk.lviv.ua'],
      'dists' => ['gal' => ['Галицький', 'Галицкий'], 'fra' => ['Франківський', 'Франковский'], 'lych' => ['Личаківський', 'Лычаковский'],
        'sih' => ['Сихівський', 'Сиховский'], 'zal' => ['Залізничний', 'Железнодорожный'], 'she' => ['Шевченківський', 'Шевченковский'],
        'pozam' => ['Поза містом: Винники, Брюховичі, Рудне, села громади', 'За городом: Винники, Брюховичи, Рудно, сёла громады']]],
    // Київщина (104-а): кабінети водоканалів зі звичайною HTML-формою входу без капчі (проба PV 2 — /api/health → prov.list.fset; Chrome 11.11.2026).
    // Що всередині після входу, не бачили: перше підключення людини дійде до форми показань (нічого не надсилаючи) або покладе каркас сторінки
    // без цифр у /admin (/api/health → lbot.<бот>.last) — наступна сесія доналаштує. Пробу «вигаданий вхід» не робимо: чужий рахунок могли б заблокувати.
    // Березань: вхід особовим рахунком + паролем (functions.php); «Передати показник» без входу веде скрипт сторінки (CheckNoOsMeter) — не розбираємо.
    'brz' => ['t' => 'cab', 'kinds' => ['water'], 'org' => 'КП «Міськводоканал» (Березань)', 'site' => 'voda-berezan.telsys.net.ua',
      'start' => 'https://voda-berezan.telsys.net.ua/', 'host' => '~^voda-berezan\.telsys\.net\.ua$~i', 'need' => ['login', 'pass'], 'lk' => 'acc'],
    // Васильків: КП «ККП м. Василькова», кабінет my.kpkkp.info (Yii: _csrf + LoginForm[email] + LoginForm[password])
    'vkkp' => ['t' => 'cab', 'kinds' => ['water'], 'org' => 'КП «ККП м. Василькова»', 'site' => 'my.kpkkp.info',
      'start' => 'https://my.kpkkp.info/user/login', 'host' => '~^my\.kpkkp\.info$~i', 'need' => ['login', 'pass']],
    // Буча: КП «Бучасервіс», кабінет абонента voda.buchaservice.com/cabinet (e-mail + пароль, POST /cabinet/login)
    'bucha' => ['t' => 'cab', 'kinds' => ['water'], 'org' => 'КП «Бучасервіс»', 'site' => 'voda.buchaservice.com',
      'start' => 'https://voda.buchaservice.com/cabinet', 'host' => '~^voda\.buchaservice\.com$~i', 'need' => ['login', 'pass']],
    // Вишневе (104-а): КП «УМГ» — центр розрахунків «Вишнівськводоканалу», кабінет umg.in.ua/account (особовий рахунок + пароль, без капчі); показники — з 28 до 1 числа
    'umg' => ['t' => 'cab', 'kinds' => ['water'], 'org' => 'КП «УМГ» (Вишневе)', 'site' => 'umg.in.ua',
      'start' => 'https://umg.in.ua/account/', 'host' => '~^umg\.in\.ua$~i', 'need' => ['login', 'pass'], 'lk' => 'acc', 'win' => [28, 1]],
    // Платформа AbonentInfo.com (104-а): один кабінет для кількох КП — у наших областях КП ВКГ «Бориспільводоканал» (my.borispol-voda.com.ua веде сюди) і ПЖКГ Моршина;
    // вхід e-mail + пароль (identity, password), без капчі; «занесення поточних показників»
    'abinf' => ['t' => 'cab', 'kinds' => ['water'], 'org' => 'AbonentInfo.com', 'site' => 'abonentinfo.com',
      'start' => 'https://www.abonentinfo.com/', 'host' => '~^(www\.)?abonentinfo\.com$~i', 'need' => ['login', 'pass']],
    // Львівщина (104-а). Дрогобич: «Комірка споживача» drohobych-vodokanal.com (Django: особовий рахунок + пароль, без капчі), показники з 10 до кінця місяця;
    // є й e-mail pokazvodu@meta.ua «рахунок номер_лічильника показник» (з 10 до 28) — кабінет обрали, бо він відповідає «прийнято».
    'dvk' => ['t' => 'cab', 'kinds' => ['water'], 'org' => 'КП «Дрогобичводоканал»', 'site' => 'drohobych-vodokanal.com',
      'start' => 'https://drohobych-vodokanal.com/authorization', 'host' => '~^(www\.)?drohobych-vodokanal\.com$~i', 'need' => ['login', 'pass'], 'lk' => 'acc', 'win' => [10, 31]],
    // Трускавець: персональний кабінет abonents.vodokanaltr.com.ua (Drupal: e-mail + пароль, без капчі — на відміну від Шептицького), з 15 до 27 числа
    'tvk' => ['t' => 'cab', 'kinds' => ['water'], 'org' => 'ТОВ «Трускавецький водоканал»', 'site' => 'abonents.vodokanaltr.com.ua',
      'start' => 'https://abonents.vodokanaltr.com.ua/user/login', 'host' => '~^abonents\.vodokanaltr\.com\.ua$~i', 'need' => ['login', 'pass'], 'win' => [15, 27]],
    // Бровари (105-а): «Кабінет споживача» КП «Броваритепловодоенергія» debt.crewingcrm.com/brovk — ASP.NET WebForms без входу й капчі: населений пункт → вулиця
    // → будинок → квартира (списки; вибір — postback) → особовий рахунок → «Пошук» (Chrome 11.11.2026: вигаданий рахунок — «Особовий рахунок не знайдено!»).
    // Далі — показники: так ту саму платформу описував Біляївський водоканал («населений пункт, вулицю, номер, особовий рахунок і далі показники»; нині він,
    // як і Ізмаїл, перейшов на JS-кабінет communal.in.ua). Що саме на сторінці показань, не бачили — перше підключення людини дійде до неї (нічого не надіславши)
    // або покладе каркас у /admin (/api/health → lbot.brovk.last). Адресу (як у квитанції) зіставляємо зі списками сайту — LbAddr. Строк — з 15 до 25 числа.
    'brovk' => ['t' => 'form', 'flow' => 'aspx', 'kinds' => ['water'], 'org' => 'КП «Броваритепловодоенергія»', 'site' => 'debt.crewingcrm.com',
      'start' => 'https://debt.crewingcrm.com/brovk/', 'host' => '~^debt\.crewingcrm\.com$~i', 'need' => ['addr', 'acc'], 'win' => [15, 25]],
    // Стрий: e-mail відділу збуту zbut_voda@ukr.net — «обов’язково вкажіть особовий рахунок або адресу» (stryivodokanal.com.ua, «Порядок передачі показників», 27.10.2026); з 1 до 5 числа
    'svk' => ['t' => 'mail', 'kinds' => ['water'], 'org' => 'КП «Стрийводоканал»', 'site' => 'stryivodokanal.com.ua', 'to' => 'zbut_voda@ukr.net',
      'need' => ['acc', 'addr'], 'win' => [1, 5]],
    // Ірпінь: e-mail абонентського відділу irpenvodok.abonviddil@gmail.com (vodokanal-irpen.com.ua, «Подати показники лічильника»); з 20 до 25 числа
    'ivk' => ['t' => 'mail', 'kinds' => ['water'], 'org' => 'КП «Ірпіньводоканал»', 'site' => 'vodokanal-irpen.com.ua', 'to' => 'irpenvodok.abonviddil@gmail.com',
      'need' => ['acc', 'name', 'addr', 'phone'], 'win' => [20, 25]],
    // 106-а (Chrome 11.11.2026). Київщина: та сама платформа «Особистий кабінет абонента», що й у Василькова (Yii: _csrf + LoginForm[email] + LoginForm[password],
    // без капчі; реєстрація «за платежем» чи «за кодом активації»). Фастів — показання з 25 числа до останнього робочого дня (fastiv-rada.gov.ua);
    // Вишгород — з 25 числа до передостаннього робочого дня (vyshhorodvodokanal.com.ua «Надати показники лічильників»).
    'fvk' => ['t' => 'cab', 'kinds' => ['water'], 'org' => 'КП ФМР «Фастівводоканал»', 'site' => 'my.fastivvoda.com.ua',
      'start' => 'https://my.fastivvoda.com.ua/user/login', 'host' => '~^my\.fastivvoda\.com\.ua$~i', 'need' => ['login', 'pass'], 'win' => [25, 28]],
    'vyvk' => ['t' => 'cab', 'kinds' => ['water'], 'org' => 'Вишгородське МКП «Водоканал»', 'site' => 'my.vyshhorodvodokanal.com.ua',
      'start' => 'https://my.vyshhorodvodokanal.com.ua/user/login', 'host' => '~^my\.vyshhorodvodokanal\.com\.ua$~i', 'need' => ['login', 'pass'], 'win' => [25, 27]],
    // Славутич: «Особистий кабінет» vodaslav.com.ua/kab — звичайна форма POST auth.php без капчі й токенів: особовий рахунок (ls, 10 цифр; сайт складає його й з адреси
    // «квартал + будинок + квартира + 0») і «один з номерів вашого лічильника» (pas) замість пароля. Номер лічильника зберігаємо як пароль (`pk: serial`).
    'svod' => ['t' => 'form', 'kinds' => ['water'], 'org' => 'КП «Славутич-Водоканал»', 'site' => 'vodaslav.com.ua',
      'start' => 'https://vodaslav.com.ua/kab/kabinet.html', 'host' => '~^(www\.)?vodaslav\.com\.ua$~i', 'need' => ['acc', 'pass'], 'pk' => 'serial',
      'acc' => ['fields' => ['ls'], 'digits' => 10, 'hint' => '1110010010', 'pass' => 'pas']],
    // Львівщина: МКП «Золочівводоканал» — «Персональний кабінет користувача» zlvoda.com.ua/rk (e-mail + пароль, POST login.php без капчі); показання — до кінця місяця,
    // з 20 числа (zolochivvodokanal.wordpress.com)
    'zvk' => ['t' => 'cab', 'kinds' => ['water'], 'org' => 'МКП «Золочівводоканал»', 'site' => 'zlvoda.com.ua',
      'start' => 'https://zlvoda.com.ua/rk/login.php', 'host' => '~^(www\.)?zlvoda\.com\.ua$~i', 'need' => ['login', 'pass'], 'win' => [20, 31]],
    // Платформа info-gkh.com.ua («Електронний кабінет споживача», <код>.info-gkh.com.ua/cabinet): POST /cabinet/login — cmd=login, account (особовий рахунок), password; без капчі.
    // У наших областях — Подільськ, Богодухів, Сахновщина, Усатове (КП «Міжлиманське»).
    'podv' => ['t' => 'cab', 'kinds' => ['water'], 'org' => 'КВЕП «Подільськводоканал»', 'site' => 'podilskvoda.info-gkh.com.ua',
      'start' => 'https://podilskvoda.info-gkh.com.ua/cabinet/login', 'host' => '~^podilskvoda\.info-gkh\.com\.ua$~i', 'need' => ['login', 'pass'], 'lk' => 'acc'],
    'bgdv' => ['t' => 'cab', 'kinds' => ['water'], 'org' => 'КП «Богодухіввода»', 'site' => 'bogodukhivvoda.info-gkh.com.ua',
      'start' => 'https://bogodukhivvoda.info-gkh.com.ua/cabinet/login', 'host' => '~^bogodukhivvoda\.info-gkh\.com\.ua$~i', 'need' => ['login', 'pass'], 'lk' => 'acc'],
    'sahv' => ['t' => 'cab', 'kinds' => ['water'], 'org' => 'Сахновщинське КВКП', 'site' => 'svodokanal.info-gkh.com.ua',
      'start' => 'https://svodokanal.info-gkh.com.ua/cabinet/login', 'host' => '~^svodokanal\.info-gkh\.com\.ua$~i', 'need' => ['login', 'pass'], 'lk' => 'acc'],
    'mizh' => ['t' => 'cab', 'kinds' => ['water'], 'org' => 'КП «Міжлиманське»', 'site' => 'kp-mizhlimanske.info-gkh.com.ua',
      'start' => 'https://kp-mizhlimanske.info-gkh.com.ua/cabinet/login', 'host' => '~^kp-mizhlimanske\.info-gkh\.com\.ua$~i', 'need' => ['login', 'pass'], 'lk' => 'acc'],
    // 107-а. Ще info-gkh: Вороньків (Київщина, ЖКК «Вороньків» — вода, показники з 24 до останнього дня; voronkiv.info-gkh.com.ua), Дачне (Одещина, КП «Дачненський
    // сількомунгосп»), Любашівка (Одещина, КП «Джерело-Комунсервіс», dzerelo.info-gkh.com.ua).
    'vork' => ['t' => 'cab', 'kinds' => ['water'], 'org' => 'ЖКК «Вороньків»', 'site' => 'voronkiv.info-gkh.com.ua',
      'start' => 'https://voronkiv.info-gkh.com.ua/cabinet/login', 'host' => '~^voronkiv\.info-gkh\.com\.ua$~i', 'need' => ['login', 'pass'], 'lk' => 'acc', 'win' => [24, 31]],
    'dach' => ['t' => 'cab', 'kinds' => ['water'], 'org' => 'КП «Дачненський сількомунгосп»', 'site' => 'kp-dachne.info-gkh.com.ua',
      'start' => 'https://kp-dachne.info-gkh.com.ua/cabinet/login', 'host' => '~^kp-dachne\.info-gkh\.com\.ua$~i', 'need' => ['login', 'pass'], 'lk' => 'acc'],
    'lubk' => ['t' => 'cab', 'kinds' => ['water'], 'org' => 'КП «Джерело-Комунсервіс»', 'site' => 'dzerelo.info-gkh.com.ua',
      'start' => 'https://dzerelo.info-gkh.com.ua/cabinet/login', 'host' => '~^dzerelo\.info-gkh\.com\.ua$~i', 'need' => ['login', 'pass'], 'lk' => 'acc'],
    // 107-а. Ще Yii «Особистий кабінет абонента» (billingsoft): Богуслав (my.boguslavvodokanal.biz.ua), Рені (my.renivodokanal.od.ua; показники з 1 по 5 число),
    // Петрівська громада (Нові Петрівці, novopetrovskiy.billingsoft.com.ua; до останнього числа). Ставище (my.stavjkp.kyiv.ua) 11.11.2026 не відповідав — не підключали.
    'bgsv' => ['t' => 'cab', 'kinds' => ['water'], 'org' => 'КП БМР «Богуславське ЖКП»', 'site' => 'my.boguslavvodokanal.biz.ua',
      'start' => 'https://my.boguslavvodokanal.biz.ua/user/login', 'host' => '~^my\.boguslavvodokanal\.biz\.ua$~i', 'need' => ['login', 'pass']],
    'renv' => ['t' => 'cab', 'kinds' => ['water'], 'org' => 'КП «Водоканал» Ренійської МР', 'site' => 'my.renivodokanal.od.ua',
      'start' => 'https://my.renivodokanal.od.ua/user/login', 'host' => '~^my\.renivodokanal\.od\.ua$~i', 'need' => ['login', 'pass'], 'win' => [1, 5]],
    'ptkp' => ['t' => 'cab', 'kinds' => ['water'], 'org' => 'КП «Петрівський ККП»', 'site' => 'novopetrovskiy.billingsoft.com.ua',
      'start' => 'https://novopetrovskiy.billingsoft.com.ua/user/login', 'host' => '~^novopetrovskiy\.billingsoft\.com\.ua$~i', 'need' => ['login', 'pass']],
    // Харківщина: КП «Водоканал» Мереф’янської МР — показання з 20 по 27 число, зокрема на e-mail vodokanal_merefa@ukr.net (merefaotg.gov.ua «Про підприємство», 11.11.2026)
    'mvk' => ['t' => 'mail', 'kinds' => ['water'], 'org' => 'КП «Водоканал» Мереф’янської МР', 'site' => 'merefaotg.gov.ua', 'to' => 'vodokanal_merefa@ukr.net',
      'need' => ['acc', 'name', 'addr', 'phone'], 'win' => [20, 27]],
  ];
  const NEED = ['dist', 'acc', 'name', 'addr', 'phone', 'login', 'pass'];
  /** Адреса листа: одна на бота або за районом людини (`dist`). */
  public static function to(array $b, array $c = []): string { $t = $b['to'] ?? ''; return is_array($t) ? (string)($t[$c['dist'] ?? ''] ?? '') : (string)$t; }
  public static function get(string $id): ?array { return isset(self::BOTS[$id]) ? self::BOTS[$id] + ['id' => $id] : null; }
  public static function prov(string $id): string { return 'L' . $id; }
  /** Тести: вимкнені (`off`) боти — увімкнути (на стенді вмикає й `lb_base_<бот>` у config.php). */
  public static bool $forceOn = false;
  public static function ready(string $id): bool {
    $b = self::get($id); if (!$b || Cfg::get('lb_off_' . $id) === true) return false;
    if (!empty($b['off']) && !self::$forceOn && !Cfg::get('lb_base_' . $id)) return false;
    return $b['t'] === 'mail' ? Mail::on() : class_exists('DOMDocument');
  }
  /** Лендинг (106-а, власник 11.11): у кого зараз працює «Відправити у фоні» — кабінет ХТМ (htm), Харківводоканал (vk) і готові боти.
   *  /api/config → auto; лендинг показує стрічку лише цих (e-mail-боти — щойно власник налаштує пошту). */
  public static function autoIds(): array {
    $a = ['htm']; if (class_exists('VkCab') && VkCab::ready()) $a[] = 'vk';
    foreach (array_keys(self::BOTS) as $id) if (self::ready($id)) $a[] = $id;
    return $a;
  }
  /** Що бачить застосунок про бота (без секретів). */
  public static function pub(string $id): array {
    $b = self::get($id);
    return ['id' => $id, 't' => $b['t'], 'org' => $b['org'], 'site' => $b['site'] ?? null, 'kinds' => $b['kinds'], 'need' => $b['need'], 'hint' => $b['acc']['hint'] ?? null,
      'win' => $b['win'] ?? null, 'later' => !empty($b['later']), 'to' => is_string($b['to'] ?? null) ? $b['to'] : null, 'fmt' => $b['fmt'] ?? null, 'one' => !empty($b['one']),
      'serial' => !empty($b['serial']), 'lk' => $b['lk'] ?? null, 'pk' => $b['pk'] ?? null, 'flow' => $b['flow'] ?? null, 'ready' => self::ready($id)] + (isset($b['dists']) ? ['dists' => array_map(fn($k, $v) => [$k, $v[0], $v[1]], array_keys($b['dists']), $b['dists'])] : []);
  }

  // ---------- вікно подачі: поза ним «Відправити у фоні» ставить у чергу на відкриття (9:00 за Києвом) ----------
  public static function kyiv(int $ts): DateTimeImmutable { return (new DateTimeImmutable('@' . $ts))->setTimezone(new DateTimeZone('Europe/Kyiv')); }
  /** → час, коли можна надсилати: зараз (у вікні) або початок найближчого вікна. */
  public static function openAt(?array $win, int $now): int {
    if (!$win) return $now;
    [$a, $b] = $win; $d = self::kyiv($now); $day = (int)$d->format('j'); $last = (int)$d->format('t');
    if ($a > $b) {   // вікно через межу місяця (28-го … 3-го): поза ним — 28-ше цього місяця
      if ($day >= min($a, $last) || $day <= $b) return $now;
      return max($now, $d->setDate((int)$d->format('Y'), (int)$d->format('n'), min($a, $last))->setTime(9, 0)->getTimestamp());
    }
    if ($day >= $a && $day <= min($b, $last)) return $now;
    $m = $day > min($b, $last) ? $d->modify('first day of next month') : $d;
    $start = $m->setDate((int)$m->format('Y'), (int)$m->format('n'), min($a, (int)$m->format('t')))->setTime(9, 0);
    return max($now, $start->getTimestamp());
  }

  // ---------- облікові дані людини: cab_creds (user_id, 'L'+бот) — extra: {місце: {acc, consentAt, lang, chk}}, secret: зашифроване {місце: {name, addr, phone, login, pass}} ----------
  private static function js(?string $s): array { $j = json_decode((string)$s, true); return is_array($j) ? $j : []; }
  private static function row(int $uid, string $id): ?array { return Db::one('SELECT * FROM cab_creds WHERE user_id = ? AND prov = ?', [$uid, self::prov($id)]); }
  /** Дані підключення для місця (з розшифрованими полями) або null. */
  public static function creds(int $uid, string $id, string $place): ?array {
    $r = self::row($uid, $id); if (!$r) return null;
    $ex = self::js($r['extra']); if (!isset($ex[$place])) return null;
    $sec = self::js((string)CabVault::dec((string)$r['secret']));
    return $ex[$place] + (array)($sec[$place] ?? []);
  }
  private static function save(int $uid, string $id, string $place, ?array $pub, ?array $sec): void {
    $r = self::row($uid, $id); $ex = $r ? self::js($r['extra']) : []; $s = $r ? self::js((string)CabVault::dec((string)$r['secret'])) : [];
    if ($pub === null) unset($ex[$place], $s[$place]); else { $ex[$place] = $pub; $s[$place] = $sec ?? []; }
    if (!$ex) { Db::q('DELETE FROM cab_creds WHERE user_id = ? AND prov = ?', [$uid, self::prov($id)]); return; }
    $e = json_encode($ex, JSON_UNESCAPED_UNICODE); $se = CabVault::enc(json_encode($s, JSON_UNESCAPED_UNICODE));
    if ($r) Db::q('UPDATE cab_creds SET extra = ?, secret = ?, checked_at = ? WHERE user_id = ? AND prov = ?', [$e, $se, Http::iso(), $uid, self::prov($id)]);
    else Db::q("INSERT INTO cab_creds (user_id, prov, login, secret, extra, state, info, created_at, checked_at) VALUES (?, ?, '', ?, ?, 'ok', NULL, ?, ?)", [$uid, self::prov($id), $se, $e, Http::iso(), Http::iso()]);
  }
  private static function botOr404(array $in): array {
    $id = (string)($in['bot'] ?? ''); $b = self::get($id);
    if (!$b) throw new HttpError(404, 'lb_unknown');
    return [$id, $b];
  }
  private static function placeId(array $in): string { return substr(preg_replace('/[^\w\-]/', '', (string)($in['place'] ?? '')), 0, 40) ?: 'p0'; }
  private static string $lang = 'uk';
  public static function h(string $k, array $v = []): string {
    $ru = self::$lang === 'ru';
    $s = [
      'consent' => $ru ? 'Чтобы отправлять показания самим, нужно ваше согласие — отметьте галочку.' : 'Щоб надсилати показання самим, потрібна ваша згода — поставте позначку.',
      'acc' => $ru ? 'Впишите лицевой счёт так, как на квитанции или в абонентской книжке: {hint}.' : 'Впишіть особовий рахунок так, як на квитанції чи в абонентській книжці: {hint}.',
      'acc0' => $ru ? 'Впишите лицевой счёт (цифры с квитанции).' : 'Впишіть особовий рахунок (цифри з квитанції).',
      'name' => $ru ? 'Впишите фамилию, имя и отчество владельца счёта.' : 'Впишіть прізвище, ім’я та по батькові власника рахунку.',
      'addr' => $ru ? 'Впишите адрес: улица, дом, квартира.' : 'Впишіть адресу: вулиця, будинок, квартира.',
      'phone' => $ru ? 'Впишите телефон — по нему с вами свяжется абонотдел, если что-то не так.' : 'Впишіть телефон — за ним з вами зв’яжеться абонвідділ, якщо щось не так.',
      'login' => $ru ? 'Впишите логин (e-mail) от кабинета.' : 'Впишіть логін (e-mail) від кабінету.',
      'login_acc' => $ru ? 'Впишите лицевой счёт — он же логин кабинета.' : 'Впишіть особовий рахунок — він же логін кабінету.',
      'pass' => $ru ? 'Впишите пароль от кабинета.' : 'Впишіть пароль від кабінету.',
      'pass_serial' => $ru ? 'Впишите номер любого вашего счётчика — он есть в квитанции.' : 'Впишіть номер будь-якого вашого лічильника — він є у квитанції.',
      'off' => $ru ? 'Сейчас этот способ не работает — отправьте сами (кнопки ниже).' : 'Зараз цей спосіб не працює — надішліть самі (кнопки нижче).',
      'conn' => $ru ? 'Сначала подключите автоотправку.' : 'Спершу підключіть автовідправку.',
      'items' => $ru ? 'Нечего отправлять: нет показаний.' : 'Нічого надсилати: немає показань.',
      'no_job' => $ru ? 'Эта отправка уже не в очереди.' : 'Це надсилання вже не в черзі.',
      'down' => $ru ? 'Сайт не отвечал несколько раз подряд.' : 'Сайт не відповідав кілька разів поспіль.',
      'captcha' => $ru ? 'Сайт показал проверку «я не робот» — её мы не проходим. Отправьте сами.' : 'Сайт показав перевірку «я не робот» — її ми не проходимо. Надішліть самі.',
      'notfound' => $ru ? 'Сайт не нашёл такой лицевой счёт — проверьте цифры.' : 'Сайт не знайшов такий особовий рахунок — перевірте цифри.',
      'notfound_serial' => $ru ? 'Сайт не принял лицевой счёт и номер счётчика — проверьте оба по квитанции.' : 'Сайт не прийняв особовий рахунок і номер лічильника — перевірте обидва за квитанцією.',
      'login_bad' => $ru ? 'Кабинет не пустил с этим логином и паролем.' : 'Кабінет не пустив із цим логіном і паролем.',
      'page' => $ru ? 'Страница сайта не такая, как мы ждали, — ничего не отправили. Отправьте сами; мы разберёмся.' : 'Сторінка сайту не така, як ми чекали, — нічого не надіслали. Надішліть самі; ми розберемося.',
      'fields' => $ru ? 'Не поняли, в какое поле какой счётчик, — ничего не отправили. Впишите номера счётчиков в их настройках или отправьте сами.' : 'Не зрозуміли, у яке поле який лічильник, — нічого не надіслали. Впишіть номери лічильників у їхніх налаштуваннях або надішліть самі.',
      'mail' => $ru ? 'Почта сервиса сейчас не работает.' : 'Пошта сервісу зараз не працює.',
      'one' => $ru ? 'Так можно передать только однозонный счётчик (одно число). Двухзонный передайте сами — кнопки ниже.' : 'Так можна передати лише однозонний лічильник (одне число). Двозонний передайте самі — кнопки нижче.',
      'dist' => $ru ? 'Выберите район — письмо уйдёт в отдел сбыта вашего района.' : 'Оберіть район — лист піде у відділ збуту вашого району.',
      'serial' => $ru ? 'Впишите номер счётчика в его настройках — {org} принимает показания только с номером счётчика.' : 'Впишіть номер лічильника в його налаштуваннях — {org} приймає показання лише з номером лічильника.',
      // адреса зі списками сайту (flow aspx, 105-а)
      'addr_settle' => $ru ? 'Сайт ищет счёт по адресу. Допишите в начале адреса населённый пункт — на сайте есть: {list}.' : 'Сайт шукає рахунок за адресою. Допишіть на початку адреси населений пункт — на сайті є: {list}.',
      'addr_street' => $ru ? 'Не нашли улицу «{s}» в списке сайта. Напишите её, как в квитанции (по-украински).' : 'Не знайшли вулицю «{s}» у списку сайту. Напишіть її, як у квитанції.',
      'addr_street_s' => $ru ? 'Не нашли улицу «{s}» в списке сайта. Похожие там: {list} — напишите, как в квитанции.' : 'Не знайшли вулицю «{s}» у списку сайту. Схожі там: {list} — напишіть, як у квитанції.',
      'addr_street0' => $ru ? 'Впишите улицу, дом и квартиру — сайт ищет счёт по адресу.' : 'Впишіть вулицю, будинок і квартиру — сайт шукає рахунок за адресою.',
      'addr_street2' => $ru ? 'Улиц с таким названием на сайте несколько: {list}. Напишите полностью, как в квитанции.' : 'Вулиць із такою назвою на сайті кілька: {list}. Напишіть повністю, як у квитанції.',
      'addr_house0' => $ru ? 'Допишите номер дома.' : 'Допишіть номер будинку.',
      'addr_house' => $ru ? 'На сайте нет дома «{h}» на улице {s}. Проверьте номер — как в квитанции (11-А, 16/2).' : 'На сайті немає будинку «{h}» на вулиці {s}. Перевірте номер — як у квитанції (11-А, 16/2).',
      'addr_flat0' => $ru ? 'Допишите номер квартиры (кв. 12).' : 'Допишіть номер квартири (кв. 12).',
      'addr_flat' => $ru ? 'На сайте нет квартиры «{f}» в этом доме. Проверьте номер.' : 'На сайті немає квартири «{f}» у цьому будинку. Перевірте номер.',
    ][$k];
    foreach ($v as $a => $b) $s = str_replace('{' . $a . '}', (string)$b, $s);
    return $s;
  }
  private static function err(string $k, int $code = 422, array $v = []): HttpError { return new HttpError($code, 'lb_' . $k, ['human' => self::h($k, $v)]); }

  /** Рахунок у поля форми: «74-108-61» → [74, 108, 61] (стільки частин, скільки полів); одне поле — лише цифри. */
  public static function accParts(array $b, string $acc): ?array {
    $n = count($b['acc']['fields'] ?? []) ?: 1; $acc = trim($acc);
    if ($n === 1) { $d = preg_replace('/\D/', '', $acc); $need = (int)($b['acc']['digits'] ?? 0); return ($need ? strlen($d) === $need : strlen($d) >= 3 && strlen($d) <= 20) ? [$d] : null; }
    $p = preg_split('/\D+/', $acc, -1, PREG_SPLIT_NO_EMPTY);
    return count($p) === $n && max(array_map('strlen', $p)) <= 10 ? $p : null;
  }
  /** Перевірка полів людини → [pub (рахунок), sec (решта)]. */
  private static function input(array $b, array $in): array {
    $pub = []; $sec = [];
    foreach ($b['need'] as $f) {
      $v = trim(preg_replace('/\s+/u', ' ', (string)($in[$f] ?? '')));
      $ok = match ($f) {
        'dist' => isset($b['dists'][$v]),
        'acc' => self::accParts($b, $v) !== null,
        'name' => mb_strlen($v) >= 3 && mb_strlen($v) <= 80 && (bool)preg_match("/^[\p{L}'’ʼ.\- ]+$/u", $v),
        'addr' => mb_strlen($v) >= 5 && mb_strlen($v) <= 160,
        'phone' => (bool)preg_match('/^\+?[\d\s()\-]{9,18}$/', $v) && strlen(preg_replace('/\D/', '', $v)) >= 9,
        'login' => ($b['lk'] ?? '') === 'acc' ? (bool)preg_match('/^[\d\-\/ ]{3,32}$/', $v) : mb_strlen($v) >= 3 && mb_strlen($v) <= 120,
        'pass' => ($b['pk'] ?? '') === 'serial' ? (bool)preg_match('/^[\p{L}\d\-\/ ]{3,20}$/u', $v) : ($v = (string)($in[$f] ?? '')) !== '' && strlen($v) <= 120,
        default => false,
      };
      if (!$ok) throw self::err($f === 'acc' && !empty($b['acc']['hint']) ? 'acc' : ($f === 'acc' ? 'acc0' : ($f === 'login' && ($b['lk'] ?? '') === 'acc' ? 'login_acc' : ($f === 'pass' && ($b['pk'] ?? '') === 'serial' ? 'pass_serial' : $f))), 422, ['hint' => $b['acc']['hint'] ?? '']);
      if ($f === 'acc' || $f === 'dist') $pub[$f] = $v; else $sec[$f] = $v;
    }
    return [$pub, $sec];
  }

  // ---------- API ----------
  /** GET /api/lb?bot=&place= — бот, підключення цього місця (свої дані — для заповнення форми; пароль — ніколи), черга. */
  public static function status(int $uid, array $q): array {
    [$id] = self::botOr404($q); $place = self::placeId($q); $c = self::creds($uid, $id, $place);
    $conn = $c ? array_filter(['dist' => $c['dist'] ?? null, 'acc' => $c['acc'] ?? null, 'name' => $c['name'] ?? null, 'addr' => $c['addr'] ?? null, 'phone' => $c['phone'] ?? null, 'login' => $c['login'] ?? null,
      'pass' => isset($c['pass']) ? true : null, 'at' => $c['consentAt'] ?? null, 'chk' => $c['chk'] ?? null], fn($v) => $v !== null) : null;
    $jobs = Db::q('SELECT * FROM cab_jobs WHERE user_id = ? AND prov = ? ORDER BY id DESC LIMIT 12', [$uid, self::prov($id)])->fetchAll();
    $pb = self::pub($id); if ($c && $pb['to'] === null && self::to(self::get($id), $c) !== '') $pb['to'] = self::to(self::get($id), $c);   // адреса району
    return ['bot' => $pb, 'conn' => $conn, 'jobs' => array_values(array_filter(array_map([self::class, 'pubJob'], $jobs), fn($j) => ($j['place'] ?? '') === $place))];
  }
  /** POST /api/lb/connect {bot, place, consent, acc?, name?, addr?, phone?, login?, pass?, lang} — зберегти й перевірити (дійти до форми, нічого не надіслати). */
  public static function connect(int $uid, array $in): array {
    self::$lang = ($in['lang'] ?? '') === 'ru' ? 'ru' : 'uk';
    [$id, $b] = self::botOr404($in); $place = self::placeId($in);
    if (!self::ready($id)) throw self::err($b['t'] === 'mail' ? 'mail' : 'off', 409);
    if (($in['consent'] ?? false) !== true) throw self::err('consent');
    $old = self::creds($uid, $id, $place) ?? [];
    if (in_array('pass', $b['need'], true) && (string)($in['pass'] ?? '') === '' && isset($old['pass'])) $in['pass'] = $old['pass'];   // пароль не міняли
    [$pub, $sec] = self::input($b, $in);
    self::limit($uid);
    $chk = ['at' => time(), 'ok' => true];
    if ($b['t'] !== 'mail') {
      try { $r = LbWalk::run($b, $pub + $sec, [], false); $chk += ['meters' => $r['meters'] ?? null]; }
      catch (HttpError $e) {
        $why = preg_replace('/^lb_/', '', $e->err);
        if (in_array($why, ['notfound', 'login_bad', 'captcha'], true) || str_starts_with($why, 'addr_')) { Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, 'lb_conn_' . $id . '_' . $why, null, Http::iso()]); throw $e; }
        $chk = ['at' => time(), 'ok' => false, 'why' => $why];   // сайт не відповів або незнайома сторінка — підключення зберігаємо, спробуємо при надсиланні
      }
    }
    self::save($uid, $id, $place, $pub + ['consentAt' => gmdate('c'), 'lang' => self::$lang, 'chk' => $chk], $sec);
    Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, 'lb_conn_' . $id, null, Http::iso()]);
    return ['ok' => true] + self::status($uid, ['bot' => $id, 'place' => $place]);
  }
  /** POST /api/lb/forget {bot, place} — забути дані й згоду, скасувати чергу цього місця. */
  public static function forget(int $uid, array $in): array {
    [$id] = self::botOr404($in); $place = self::placeId($in);
    self::save($uid, $id, $place, null, null);
    foreach (Db::q("SELECT * FROM cab_jobs WHERE user_id = ? AND prov = ? AND status = 'queued'", [$uid, self::prov($id)])->fetchAll() as $j)
      if ((self::js($j['payload'])['place'] ?? '') === $place) self::finish((int)$j['id'], 'cancelled', ['why' => 'forgot']);
    Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, 'lb_forget_' . $id, null, Http::iso()]);
    return ['ok' => true] + self::status($uid, ['bot' => $id, 'place' => $place]);
  }
  public static function items(array $raw): array {
    $out = [];
    foreach (array_slice($raw, 0, 6) as $it) {
      if (!is_array($it)) continue; $v = str_replace(',', '.', trim((string)($it['value'] ?? '')));
      if (!preg_match('/^\d{1,7}(?:\.\d{1,3})?$/', $v)) continue;
      $out[] = ['value' => $v, 'serial' => isset($it['serial']) && trim((string)$it['serial']) !== '' ? mb_substr(trim((string)$it['serial']), 0, 30) : null, 'name' => mb_substr(trim((string)($it['name'] ?? '')), 0, 40),
        'kind' => in_array($it['kind'] ?? null, ['cold', 'hot', 'elec', 'gas', 'heat'], true) ? $it['kind'] : null];
    }
    return $out;
  }
  /** POST /api/lb/queue {bot, place, rid, items, lang} — «Відправити у фоні»: зараз (cron за хвилину) або на відкриття вікна подачі. Те саме ще раз — не дублюємо. */
  public static function queue(int $uid, array $in): array {
    self::$lang = ($in['lang'] ?? '') === 'ru' ? 'ru' : 'uk';
    [$id, $b] = self::botOr404($in); $place = self::placeId($in);
    if (!self::ready($id)) throw self::err($b['t'] === 'mail' ? 'mail' : 'off', 409);
    $c = self::creds($uid, $id, $place); if (!$c) throw self::err('conn', 409);
    $items = self::items((array)($in['items'] ?? [])); if (!$items) throw self::err('items');
    if (!empty($b['one']) && count($items) !== 1) throw self::err('one');
    if (!empty($b['serial'])) foreach ($items as $x) if (($x['serial'] ?? null) === null) throw self::err('serial', 422, ['org' => $b['org']]);
    $rid = substr(preg_replace('/[^\w\-]/', '', (string)($in['rid'] ?? '')), 0, 40);
    $sig = fn(array $l) => implode('|', array_map(fn($x) => ($x['serial'] ?? '') . '=' . $x['value'], $l));
    foreach (Db::q("SELECT * FROM cab_jobs WHERE user_id = ? AND prov = ? AND status IN ('queued', 'sending', 'ok', 'sent') ORDER BY id DESC LIMIT 12", [$uid, self::prov($id)])->fetchAll() as $j) {
      $p = self::js($j['payload']); if (($p['place'] ?? '') === $place && $sig((array)($p['items'] ?? [])) === $sig($items)) return ['ok' => true, 'dup' => true, 'job' => self::pubJob($j)];
    }
    self::limit($uid);
    // з того ж місця раніше поставлене й ще не надіслане — замінюємо новими цифрами
    foreach (Db::q("SELECT * FROM cab_jobs WHERE user_id = ? AND prov = ? AND status = 'queued'", [$uid, self::prov($id)])->fetchAll() as $j) if ((self::js($j['payload'])['place'] ?? '') === $place) self::finish((int)$j['id'], 'cancelled', ['why' => 'replaced']);
    $at = self::openAt($b['win'] ?? null, time());
    Db::q("INSERT INTO cab_jobs (user_id, prov, acc, payload, status, result, tries, next_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', NULL, 0, ?, ?, ?)",
      [$uid, self::prov($id), mb_substr((string)($c['acc'] ?? ''), 0, 40), json_encode(['rid' => $rid, 'place' => $place, 'items' => $items, 'lang' => self::$lang], JSON_UNESCAPED_UNICODE), $at, Http::iso(), Http::iso()]);
    $job = self::pubJob(Db::one('SELECT * FROM cab_jobs WHERE id = ?', [Db::id()]));
    Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, 'lb_queue_' . $id, null, Http::iso()]);
    if ($at > time() + 120) self::notify($uid, $id, $job);   // «надішлемо 25-го о 9:00»
    return ['ok' => true, 'job' => $job];
  }
  private static function mine(int $uid, array $in): array {
    $j = Db::one("SELECT * FROM cab_jobs WHERE id = ? AND user_id = ? AND prov LIKE 'L%'", [(int)($in['job'] ?? 0), $uid]);
    if (!$j || $j['status'] !== 'queued') throw new HttpError(409, 'lb_no_job', ['human' => self::h('no_job')] + ($j ? ['job' => self::pubJob($j)] : []));
    return $j;
  }
  /** POST /api/lb/cancel {job} */
  public static function cancel(int $uid, array $in): array { self::$lang = ($in['lang'] ?? '') === 'ru' ? 'ru' : 'uk'; $j = self::mine($uid, $in); self::finish((int)$j['id'], 'cancelled', ['why' => 'user']); return ['ok' => true, 'job' => self::pubJob(Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$j['id']]))]; }
  /** POST /api/lb/now {job} — у вікні подачі надіслати зараз, не чекаючи cron. */
  public static function now(int $uid, array $in): array {
    self::$lang = ($in['lang'] ?? '') === 'ru' ? 'ru' : 'uk'; $j = self::mine($uid, $in);
    $b = self::get(substr((string)$j['prov'], 1)); if ($b && self::openAt($b['win'] ?? null, time()) > time()) return ['ok' => true, 'job' => self::pubJob($j)];
    self::limit($uid); return ['ok' => true, 'job' => self::run($j)];
  }
  public static function limit(int $uid): void {
    try { RateLimit::hit('lb_user', (string)$uid); RateLimit::hit('lb_all', 'all'); }
    catch (HttpError $e) { throw new HttpError(429, 'rate_limited', ['human' => self::$lang === 'ru' ? 'Слишком часто — попробуйте через несколько минут.' : 'Занадто часто — спробуйте за кілька хвилин.'] + $e->extra); }
  }

  public static function pubJob(array $j): array {
    $p = self::js($j['payload']); $r = self::js($j['result']);
    return ['id' => (int)$j['id'], 'bot' => substr((string)$j['prov'], 1), 'rid' => $p['rid'] ?? null, 'place' => $p['place'] ?? null,
      'items' => array_map(fn($x) => ['name' => $x['name'], 'value' => $x['value'], 'kind' => $x['kind'] ?? null], (array)($p['items'] ?? [])),
      'status' => $j['status'], 'text' => $r['text'] ?? '', 'why' => $r['why'] ?? null, 'human' => $r['human'] ?? null,
      'at' => strtotime((string)$j['created_at']) ?: null, 'doneAt' => $r['doneAt'] ?? null, 'nextAt' => in_array($j['status'], ['queued', 'sending'], true) ? (int)$j['next_at'] : null];
  }
  private static function finish(int $id, string $st, array $res): void {
    Db::q('UPDATE cab_jobs SET status = ?, result = ?, next_at = 0, updated_at = ? WHERE id = ?', [$st, json_encode($res + ['doneAt' => time()], JSON_UNESCAPED_UNICODE), Http::iso(), $id]);
  }
  /** Надіслати одне з черги. Статуси: ok (сайт сказав «прийнято»), sent (лист пішов — підтвердження e-mail не дає), rejected, unknown, failed. */
  private static function run(array $j): array {
    $uid = (int)$j['user_id']; $id = substr((string)$j['prov'], 1); $b = self::get($id); $p = self::js($j['payload']);
    self::$lang = ($p['lang'] ?? '') === 'ru' ? 'ru' : 'uk';
    if (Db::q("UPDATE cab_jobs SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'queued'", [Http::iso(), $j['id']])->rowCount() !== 1) return self::pubJob(Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$j['id']]));
    $c = $b ? self::creds($uid, $id, (string)($p['place'] ?? '')) : null;
    if (!$b || !$c) self::finish((int)$j['id'], 'failed', ['why' => 'conn', 'human' => self::h('conn')]);
    elseif (!self::ready($id)) self::finish((int)$j['id'], 'failed', ['why' => 'off', 'human' => self::h($b['t'] === 'mail' ? 'mail' : 'off')]);
    else try {
      if ($b['t'] === 'mail') { $r = self::mail($uid, $b, $c, (array)$p['items']); self::finish((int)$j['id'], 'sent', ['text' => $r['text']]); }
      else {
        $r = LbWalk::run($b, $c, (array)$p['items'], true);
        self::finish((int)$j['id'], ['ok' => 'ok', 'err' => 'rejected'][$r['result']] ?? 'unknown', ['text' => $r['text'] ?? '']);
        self::last($id, ['at' => time(), 'res' => $r['result']]);
      }
    } catch (Throwable $e) {
      $why = $e instanceof HttpError ? preg_replace('/^lb_/', '', $e->err) : 'down';
      if ($e instanceof HttpError && isset($e->extra['skel'])) self::last($id, ['at' => time(), 'res' => $why, 'skel' => $e->extra['skel'], 'plan' => $e->extra['plan'] ?? null]);
      if ($why === 'down' && (int)$j['tries'] + 1 < 3) {
        Db::q("UPDATE cab_jobs SET status = 'queued', tries = tries + 1, next_at = ?, updated_at = ? WHERE id = ?", [time() + 900, Http::iso(), $j['id']]);
        return self::pubJob(Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$j['id']]));
      }
      $human = $e instanceof HttpError ? (string)($e->extra['human'] ?? '') : '';
      self::finish((int)$j['id'], 'failed', ['why' => $why, 'human' => mb_substr($human !== '' ? $human : self::h('down'), 0, 400)]);
    }
    $job = self::pubJob(Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$j['id']]));
    self::notify($uid, $id, $job);
    return $job;
  }
  /** Лист постачальнику: хто, рахунок, адреса, показання; Reply-To — e-mail людини (якщо є), щоб абонвідділ відповідав їй. */
  private static function mail(int $uid, array $b, array $c, array $items): array {
    $u = Db::one('SELECT email FROM users WHERE id = ?', [$uid]); $email = (string)($u['email'] ?? '');
    $to = self::to($b, $c); if ($to === '') throw self::err('dist');
    if (($b['fmt'] ?? '') === 'code') {   // лист читає програма постачальника: лише «код показник», без зайвого тексту
      $code = (string)(self::accParts($b, (string)($c['acc'] ?? ''))[0] ?? ''); $v = (string)preg_replace('/\..*$/', '', (string)$items[0]['value']);
      Mail::send(['to' => $to, 'subject' => $code . ' ' . $v, 'text' => $code . ' ' . $v, 'replyTo' => Mail::deliverable($email) ? $email : '', 'kind' => 'submit', 'user' => $uid]);
      return ['text' => 'e-mail → ' . $to];
    }
    $d = self::kyiv(time())->format('d.m.Y');
    if (($b['fmt'] ?? '') === 'line') {   // взірець постачальника: «номер особового рахунку, адреса, номер лічильника-кінцевий показник» — рядок на лічильник
      $acc = trim((string)($c['acc'] ?? '')); $addr = trim((string)($c['addr'] ?? ''));
      $rows = implode("\n", array_map(fn($x) => $acc . ', ' . $addr . ', ' . $x['serial'] . '-' . preg_replace('/\..*$/', '', (string)$x['value']), $items));
      $text = "Доброго дня!\n\nПоказання лічильників води станом на $d:\n\n" . $rows .
        "\n\nЛист надіслано на прохання абонента сервісом «Лічильники» (" . Cfg::appUrl() . ")." . (Mail::deliverable($email) ? " Відповідь — на адресу абонента: $email." : '');
      Mail::send(['to' => $to, 'subject' => 'Показання лічильників води — о/р ' . $acc, 'text' => $text, 'replyTo' => Mail::deliverable($email) ? $email : '', 'kind' => 'submit', 'user' => $uid]);
      return ['text' => 'e-mail → ' . $to];
    }
    $lines = implode("\n", array_map(fn($x) => '— ' . ($x['name'] ?: 'лічильник') . ($x['serial'] ? ' № ' . $x['serial'] : '') . ': ' . $x['value'] . ' м³', $items));
    $who = []; foreach (['Особовий рахунок' => 'acc', 'Абонент' => 'name', 'Адреса' => 'addr', 'Телефон' => 'phone'] as $l => $k) if (trim((string)($c[$k] ?? '')) !== '') $who[] = $l . ': ' . trim((string)$c[$k]);   // лише те, що просить постачальник
    $who = implode("\n", $who);
    $text = "Доброго дня!\n\nПередаю показання лічильників води станом на $d.\n\n" . $who . "\n\n" . $lines .
      "\n\nЛист надіслано на прохання абонента сервісом «Лічильники» (" . Cfg::appUrl() . ")." . (Mail::deliverable($email) ? " Відповідь — на адресу абонента: $email." : ' Питання — за телефоном абонента.');
    Mail::send(['to' => $to, 'subject' => 'Показання лічильників води — о/р ' . ($c['acc'] ?? ''), 'text' => $text, 'replyTo' => Mail::deliverable($email) ? $email : '', 'kind' => 'submit', 'user' => $uid]);
    return ['text' => 'e-mail → ' . $to];
  }
  /** cron: строк черги настав — надсилаємо (не більше 2 за хвилину: кожне — свій захід на сайт). */
  public static function cron(?int $now = null): array {
    $out = [];
    try { $rows = Db::q("SELECT * FROM cab_jobs WHERE prov LIKE 'L%' AND status = 'queued' AND next_at <= ? ORDER BY next_at LIMIT 2", [$now ?? time()])->fetchAll(); } catch (Throwable $e) { return []; }
    foreach ($rows as $j) { $r = self::run($j); $out[] = [(int)$j['id'], $r['status']]; }
    return $out;
  }
  /** Telegram: «📝 надішлемо …», «✅ прийнято», «📨 лист надіслано», «❌ / ⚠️ / ⏳». */
  public static function notify(int $uid, string $id, array $job): void {
    $tg = Db::one("SELECT external_id FROM user_identities WHERE user_id = ? AND type = 'telegram'", [$uid]); if (!$tg || !Cfg::get('bot_token')) return;
    $b = self::get($id); $ru = self::$lang === 'ru'; $org = $b['org'] ?? '';
    $lines = implode("\n", array_map(fn($x) => '• ' . ($x['name'] ?: ($ru ? 'счётчик' : 'лічильник')) . ' — ' . $x['value'], $job['items']));
    $tail = $job['text'] !== '' && $job['status'] !== 'sent' ? "\n\n" . ($ru ? 'Ответ сайта: ' : 'Відповідь сайту: ') . '«' . mb_substr($job['text'], 0, 300) . '»' : '';
    switch ($job['status']) {
      case 'queued':
        $when = self::kyiv((int)$job['nextAt'])->format('d.m H:i');
        $txt = ($ru ? "📝 Показания поставлены в очередь — $org примет их с начала срока подачи. Отправим $when:\n" : "📝 Показання в черзі — $org приймає їх із початку строку подачі. Надішлемо $when:\n") . $lines .
          ($ru ? "\n\nПередумали — «Отменить» в «Счётчиках»." : "\n\nПередумали — «Скасувати» в «Лічильниках»."); break;
      case 'ok': $txt = ($ru ? "✅ $org — сайт принял показания:\n" : "✅ $org — сайт прийняв показання:\n") . $lines . $tail . (!empty($b['later']) ? ($ru ? "\n\nИх проверит оператор — на сайте появятся позже." : "\n\nЇх перевірить оператор — на сайті з’являться пізніше.") : ''); break;
      case 'sent': $to = preg_replace('/^e-mail → /u', '', (string)$job['text']); $txt = ($ru ? "📨 Отправили показания письмом в $org ($to):\n" : "📨 Надіслали показання листом у $org ($to):\n") . $lines . ($ru ? "\n\nПодтверждения по e-mail поставщик обычно не присылает — сверяйте с квитанцией." : "\n\nПідтвердження на e-mail постачальник зазвичай не надсилає — звіряйте з квитанцією."); break;
      case 'rejected': $txt = ($ru ? "❌ $org — сайт не принял показания:\n" : "❌ $org — сайт не прийняв показання:\n") . $lines . $tail . ($ru ? "\n\nОткройте «Счётчики» — исправьте и отправьте снова." : "\n\nВідкрийте «Лічильники» — виправте й надішліть знову."); break;
      case 'unknown': $txt = ($ru ? "⏳ Отправили в $org, но сайт не сказал, принял ли:\n" : "⏳ Надіслали в $org, але сайт не сказав, чи прийняв:\n") . $lines . $tail; break;
      case 'failed': $txt = ($ru ? "⚠️ Не отправили показания в $org.\n" : "⚠️ Не надіслали показання в $org.\n") . ($job['human'] ?: '') . ($ru ? "\n\nОткройте «Счётчики» — там все способы отправить самому." : "\n\nВідкрийте «Лічильники» — там усі способи надіслати самому."); break;
      default: return;
    }
    $p = ['chat_id' => $tg['external_id'], 'text' => $txt];
    if (Cfg::appUrlKnown()) $p['reply_markup'] = ['inline_keyboard' => [[['text' => $ru ? 'Открыть «Счётчики»' : 'Відкрити «Лічильники»', 'web_app' => ['url' => Cfg::appUrl() . '?go=' . (in_array('elec', (array)($b['kinds'] ?? []), true) ? 'elec' : 'water-cold') . ($job['place'] ? '&place=' . rawurlencode((string)$job['place']) : '')]]]]];
    try { Telegram::call('sendMessage', $p); } catch (Throwable $e) { /* не дійшло — статус видно в застосунку */ }
  }
  // ---------- проба «не знайдено» (як у Водоканалу): вигаданий рахунок, лише читання — чи веде нас живий сайт тим шляхом, що й стенд ----------
  // Раз на PROBE_V для кожного form-бота (cron, хвилина % 10 === 9). Підсумок — /api/health → lbot.<бот>.probe: notfound — шлях працює
  // (сайт прийняв рахунок формою й відповів «не знайдено»); page/acc_again — форму веде скрипт сторінки, треба дивитися (каркас — без тексту й цифр).
  // Бровари (105-а): вигаданий рахунок на справжній адресі без квартир (вул. Київська, 6 — у Chrome 11.11.2026 сайт відповів «Особовий рахунок не знайдено!») —
  // так перевіряємо весь шлях postback (пункт → вулиця → будинок → пошук) з нашого сервера, не чекаючи першої людини.
  // svod (106-а): вигаданий рахунок 9990000000 (кварталу 999 немає) і номер 0000000 — що сайт відповідає з нашого сервера на «не той рахунок».
  // v3 (107-а): v2 дала page/no_form — сторінка «Помилка входу» (auth-error) без форми; тепер це notfound, а проба зберігає й текст (txt, цифри — #).
  const PROBE_V = 3, PROBE_ACC = ['mtve' => '0-0-0', 'brovk' => ['acc' => '899999999', 'addr' => 'м. Бровари, вул. Київська, 6'], 'svod' => ['acc' => '9990000000', 'pass' => '0000000']];
  public static function probe(): ?array {
    $j = json_decode((string)@file_get_contents(self::lastFile()), true); $j = is_array($j) ? $j : [];
    foreach (self::BOTS as $id => $b) {
      if ($b['t'] !== 'form' || !isset(self::PROBE_ACC[$id]) || (int)($j[$id]['probe']['v'] ?? 0) === self::PROBE_V) continue;
      $res = ['v' => self::PROBE_V, 'at' => time()];
      LbWalk::$probe = true;
      try { $r = LbWalk::run(self::get($id), is_array(self::PROBE_ACC[$id]) ? self::PROBE_ACC[$id] : ['acc' => self::PROBE_ACC[$id]], [], false); $res['res'] = 'form'; $res['meters'] = $r['meters'] ?? null; }
      catch (HttpError $e) { $res['res'] = preg_replace('/^lb_/', '', $e->err); foreach (['why', 'txt'] as $k) if (isset($e->extra[$k])) $res[$k] = $e->extra[$k]; if (isset($e->extra['skel'])) $res['skel'] = mb_substr((string)$e->extra['skel'], 0, 3000); }
      catch (Throwable $e) { $res['res'] = 'error'; $res['err'] = mb_substr(get_class($e) . ': ' . preg_replace('/\d/', '#', $e->getMessage()), 0, 160); }
      finally { LbWalk::$probe = false; }
      $j = json_decode((string)@file_get_contents(self::lastFile()), true); $j = is_array($j) ? $j : [];
      $j[$id] = array_merge((array)($j[$id] ?? []), ['probe' => $res]); @file_put_contents(self::lastFile(), json_encode($j, JSON_UNESCAPED_UNICODE), LOCK_EX);
      return [$id, $res['res']];
    }
    return null;
  }
  // ---------- для /admin і /api/health: останні заходи роботів (без рахунків і цифр) ----------
  public static function lastFile(): string { return Cfg::data() . '/cache/lbot_last.json'; }
  public static function last(string $id, array $x): void { $j = json_decode((string)@file_get_contents(self::lastFile()), true); $j = is_array($j) ? $j : []; $j[$id] = $x + (isset($j[$id]['probe']) ? ['probe' => $j[$id]['probe']] : []); @file_put_contents(self::lastFile(), json_encode($j, JSON_UNESCAPED_UNICODE), LOCK_EX); }
  public static function summary(): array {
    $jobs = []; $conn = [];
    try {
      foreach (Db::q("SELECT prov, status, COUNT(*) AS c FROM cab_jobs WHERE prov LIKE 'L%' GROUP BY prov, status")->fetchAll() as $x) $jobs[substr($x['prov'], 1)][$x['status']] = (int)$x['c'];
      foreach (Db::q("SELECT prov, COUNT(*) AS c FROM cab_creds WHERE prov LIKE 'L%' GROUP BY prov")->fetchAll() as $x) $conn[substr($x['prov'], 1)] = (int)$x['c'];
    } catch (Throwable $e) {}
    $last = json_decode((string)@file_get_contents(self::lastFile()), true);
    $bots = []; foreach (self::BOTS as $id => $b) $bots[$id] = ['t' => $b['t'], 'ready' => self::ready($id)] + (!empty($b['off']) ? ['off' => $b['off']] : []) + [ 'conn' => $conn[$id] ?? 0, 'jobs' => (object)($jobs[$id] ?? [])] + (is_array($last) && isset($last[$id]) ? (array_diff_key($last[$id], ['skel' => 1, 'probe' => 1]) ? ['last' => array_diff_key($last[$id], ['skel' => 1, 'probe' => 1])] : []) + (isset($last[$id]['probe']) ? ['probe' => $last[$id]['probe']] : []) : []);   // лише проба — без порожнього last
    return $bots;
  }
}

/** Прохід сайту: [вхід або рахунок] → [посилання «передати показання»] → форма показань → (надіслати). Розбір полів — RelayForm (роль за назвою й підписом). */
final class LbWalk {
  const LINK_RE = '/передат\S*\s+(?:поточн\S*\s+)?показ|внести\s+показ|подат\S*\s+показ|передать\s+показ|показ\S*\s+(?:водо)?лічильн|показания\s+счетчик'
    // пункт меню кабінету одним словом («Показники», «Мої лічильники», «Счётчики») — лише весь текст посилання (104-а)
    . '|^(?:мої\s+|мои\s+)?(?:показ\S*|(?:водо)?лічильник\S*|сч[её]тчик\S*)(?:\s+(?:води|воды|лічильників|счетчиков|сч[её]тчиков))?$/u';
  /** → ['result' => ready|ok|err|unknown, 'meters' => n, 'text'?]. $send=false — лише дійти до форми показань. Не вийшло — HttpError lb_* (нічого не надіслано). */
  public static function run(array $b, array $c, array $items, bool $send): array {
    // локальний стенд (tests/lb-mock): config.php 'lb_base_<бот>' => 'http://127.0.0.1:8096/'
    $base = isset($b['id']) ? (string)(Cfg::get('lb_base_' . $b['id']) ?: '') : '';
    if ($base !== '') { $b['start'] = $base; $b['host'] = '~^' . preg_quote((string)parse_url($base, PHP_URL_HOST), '~') . '$~'; }
    $w = new CabWeb($b['host'], 25.0);
    $r = self::get($w, $b['start']);
    if ($b['t'] === 'cab') $r = self::login($w, $b, $c, $r);
    elseif (($b['flow'] ?? '') === 'aspx') $r = self::aspx($w, $b, $c, $r);
    else $r = self::account($w, $b, $c, $r);
    for ($hop = 0; $hop < 3; $hop++) {
      $f = self::readForm($r['body']);
      if ($f) break;
      $link = self::link($r['body'], $r['url'], $w);
      if (!$link) throw self::page('no_form', $r['body']);
      $r = self::get($w, $link);
    }
    if (empty($f)) throw self::page('no_form', $r['body']);
    [$form, $fields, $read] = $f;
    if (!$send) return ['result' => 'ready', 'meters' => count($read)];
    $pairs = self::submit(self::fill($fields, $read, $items, $r['body']), $fields, $r['body']);
    $act = trim((string)$form->getAttribute('action')); $action = CabWeb::abs($act !== '' ? $act : $r['url'], $r['url']);
    if (!$w->sameSite($action)) throw self::page('offsite', $r['body']);
    $post = strtolower($form->getAttribute('method') ?: 'get') === 'post';
    $s = $post ? $w->req('POST', $action, $w->encode($pairs), ['Content-Type: application/x-www-form-urlencoded', 'Referer: ' . $r['url']])
      : $w->req('GET', $action . (str_contains($action, '?') ? '&' : '?') . $w->encode($pairs));
    if ((int)$s['code'] === 0 || (int)$s['code'] >= 500) return ['result' => 'unknown', 'text' => ''];   // POST не повторюємо — могли й зберегти
    $v = RelayForm::verdict($s);
    return ['result' => match ($v['kind']) { 'ok' => 'ok', 'err' => 'err', default => 'unknown' }, 'text' => (string)($v['msg'] ?? ''), 'meters' => count($read)];
  }
  private static function get(CabWeb $w, string $url): array {
    $r = $w->req('GET', $url);
    if ((int)$r['code'] === 0 || (int)$r['code'] >= 500) throw new HttpError(502, 'lb_down');
    self::guard($r);
    return $r;
  }
  /** Капча / перевірка Cloudflare — стоп: не обходимо. */
  private static function guard(array $r): void {
    $cp = CabWeb::captcha((string)$r['body'], (int)$r['code']);
    if ($cp['widget'] || $cp['cf'] || CabWeb::cfKind((string)$r['body'], (int)$r['code'], (array)($r['h'] ?? []))) throw new HttpError(409, 'lb_captcha', ['human' => self::hum('captcha')]);
    if ((int)$r['code'] >= 400) throw new HttpError(502, 'lb_down');
  }
  private static function hum(string $k): string { return LocalBot::h($k); }
  /** Незнайома сторінка: каркас без тексту й цифр — у /admin (LocalBot::last). */
  /** Проба (лише вигадані дані): у каркас ще й текст сторінки, цифри — # (107-а: каркас Славутича без тексту не відрізняв «не той рахунок» від «не всі поля»). */
  public static bool $probe = false;
  private static function page(string $why, string $html, array $plan = []): HttpError {
    return new HttpError(422, 'lb_page', ['human' => self::hum('page'), 'why' => $why, 'skel' => RelayForm::skel($html), 'plan' => $plan ?: null]
      + (self::$probe ? ['txt' => mb_substr(preg_replace('/\d/u', '#', CabWeb::sp(html_entity_decode(preg_replace('~<[^>]*>~', ' ', preg_replace('~<(script|style|title)\b.*?</\1>~is', ' ', $html)), ENT_QUOTES | ENT_HTML5, 'UTF-8'))), 0, 300)] : []));
  }
  /** Форма з полями рахунку (за назвами з налаштувань бота) → надіслати рахунок. */
  private static function account(CabWeb $w, array $b, array $c, array $r): array {
    $names = (array)($b['acc']['fields'] ?? []); $parts = LocalBot::accParts($b, (string)($c['acc'] ?? ''));
    if (!$names || !$parts) throw new HttpError(422, 'lb_acc0', ['human' => self::hum('notfound')]);
    $x = CabWeb::dom($r['body']); $form = null;
    foreach ($x->query('//form') as $f) { if (!$f instanceof DOMElement) continue; $have = array_column(RelayForm::fields($x, $f), 'n'); if (!array_diff($names, $have)) { $form = $f; break; } }
    if (!$form) throw self::page('no_acc_form', $r['body']);
    $pairs = []; $vals = array_combine($names, $parts);
    if (!empty($b['acc']['pass'])) $vals[(string)$b['acc']['pass']] = (string)($c['pass'] ?? '');   // Славутич: «номер лічильника» замість пароля (106-а)
    foreach (RelayForm::fields($x, $form) as $o) {
      if ($o['n'] === '') continue;
      if (isset($vals[$o['n']])) { $pairs[] = [$o['n'], $vals[$o['n']]]; continue; }
      if (str_starts_with($o['type'], 'submit')) { if ($o['type'] === 'submit:submit') $pairs[] = [$o['n'], $o['v']]; continue; }
      if (in_array($o['type'], ['checkbox', 'radio'], true)) { if (!empty($o['checked'])) $pairs[] = [$o['n'], $o['v'] !== '' ? $o['v'] : 'on']; continue; }
      if ($o['type'] === 'password') throw self::page('acc_pass', $r['body']);
      $pairs[] = [$o['n'], $o['v']];
    }
    $act = trim((string)$form->getAttribute('action')); $action = CabWeb::abs($act !== '' ? $act : $r['url'], $r['url']);
    $post = strtolower($form->getAttribute('method') ?: 'get') === 'post';
    $base = preg_replace('/[?#].*$/', '', $action);
    $s = $post ? $w->req('POST', $action, $w->encode($pairs), ['Content-Type: application/x-www-form-urlencoded', 'Referer: ' . $r['url']]) : $w->req('GET', $base . '?' . $w->encode($pairs));
    if ((int)$s['code'] === 0 || (int)$s['code'] >= 500) throw new HttpError(502, 'lb_down');
    self::guard($s);
    $nf = self::hum(!empty($b['acc']['pass']) ? 'notfound_serial' : 'notfound');
    if (self::notFound($s['body']) && !self::readForm($s['body'])) throw new HttpError(422, 'lb_notfound', ['human' => $nf]);
    // сторінка «Помилка входу» без жодної форми (Славутич, 107-а: <div class="auth-error"><h1>…</h1><p>…</p><a href="kabinet.html">) — сайт не прийняв рахунок;
    // «ви ввели не всю інформацію» — наша помилка (не те поле), не «не знайдено»
    if (!preg_match('/<form\b/i', (string)$s['body']) && ($le = self::loginErr((string)$s['body'])) !== '') {
      if ($le === 'empty') throw self::page('acc_empty', $s['body']);
      throw new HttpError(422, 'lb_notfound', ['human' => $nf]);
    }
    // та сама форма рахунку знову і нічого більше — сайт рахунок не прийняв (або форму веде скрипт сторінки)
    $x2 = CabWeb::dom($s['body']); $again = false;
    foreach ($x2->query('//form') as $f) if ($f instanceof DOMElement && !array_diff($names, array_column(RelayForm::fields($x2, $f), 'n'))) $again = true;
    if ($again && !self::readForm($s['body']) && !self::link($s['body'], $s['url'], $w)) throw self::page('acc_again', $s['body']);
    return $s;
  }
  /** ASP.NET WebForms без входу (debt.crewingcrm.com, 105-а): списки «населений пункт → вулиця → будинок» (вибір — postback через __EVENTTARGET),
   *  квартира, особовий рахунок → «Пошук». Адресу людини зіставляємо зі списками (LbAddr): не знайшли — зрозуміла помилка, нічого не надіслано.
   *  Сайт сам звіряє рахунок з адресою, тож помилка в адресі дає «не знайдено», а не чужу квартиру. */
  private static function aspx(CabWeb $w, array $b, array $c, array $r): array {
    $acc = (string)(LocalBot::accParts($b, (string)($c['acc'] ?? ''))[0] ?? '');
    if ($acc === '') throw new HttpError(422, 'lb_acc0', ['human' => self::hum('notfound')]);
    $A = LbAddr::parse((string)($c['addr'] ?? '')); $used = []; $set = []; $street = '';
    foreach (['settle', 'street', 'house', 'flat'] as $role) {
      $st = self::aspxForm($r['body']); if (!$st) throw self::page('no_acc_form', $r['body']);
      $sel = $st['sel'][$role] ?? null; if (!$sel) continue;
      $opts = array_values(array_filter($sel['opts'], fn($o) => trim((string)$o[0]) !== '' && trim((string)$o[1]) !== ''));
      $v = match ($role) { 'settle' => LbAddr::settle($A, $opts, $used), 'street' => LbAddr::street($A, $opts, $used), 'house' => LbAddr::house($A, $opts, $used, $street), 'flat' => LbAddr::flat($A, $opts, $used) };
      if (is_array($v)) { $street = $v[1]; $v = $v[0]; }
      if ($v === null) continue;
      $set[$sel['n']] = $v;
      if ($sel['auto'] && (string)$sel['v'] !== (string)$v) $r = self::aspxPost($w, $r, $st, $set, $sel['n'], null);
    }
    $st = self::aspxForm($r['body']); if (!$st || !$st['acc']) throw self::page('no_acc_form', $r['body']);
    $set[$st['acc']] = $acc;
    $s = self::aspxPost($w, $r, $st, $set, null, $st['btn']);
    if (self::readForm($s['body'])) return $s;
    if (self::notFound($s['body'])) throw new HttpError(422, 'lb_notfound', ['human' => self::hum('notfound')]);
    // «Передати показання» — кнопка чи посилання-postback (LinkButton) на тій самій формі
    $hop = self::aspxHop($s['body']); $st2 = $hop ? self::aspxForm($s['body']) : null;
    if ($hop && $st2) return self::aspxPost($w, $s, $st2, [], $hop[0], $hop[1]);
    if (self::link($s['body'], $s['url'], $w)) return $s;
    $again = self::aspxForm($s['body']);
    if ($again && $again['acc'] && !empty($again['sel'])) throw self::page('acc_again', $s['body']);
    return $s;
  }
  /** Форма ASP.NET: поля, списки за роллю (пункт, вулиця, будинок, квартира; автопостбек), поле рахунку, кнопка пошуку. */
  private static function aspxForm(string $html): ?array {
    if (!preg_match('/<form\b/i', $html)) return null;
    $x = CabWeb::dom($html); $form = null;
    foreach ($x->query('//form') as $f) if ($f instanceof DOMElement && ($form === null || $x->query(".//input[@name='__VIEWSTATE']", $f)->length)) { $form = $f; if ($x->query(".//input[@name='__VIEWSTATE']", $f)->length) break; }
    if (!$form) return null;
    $fields = RelayForm::fields($x, $form); $sel = []; $rest = [];
    $re = ['settle' => '/RAYON|RAION|NASP|PUNKT|CITY|TOWN|SETTL|MISTO|NASEL/i', 'street' => '/ULIC|ULITS|STREET|VULY|VUL$/i', 'house' => '/DOM$|DOMA?\b|BUD|HOUSE|BUILD/i', 'flat' => '/KVART|FLAT|APART|KV$/i'];
    foreach ($x->query('.//select', $form) as $e) {
      if (!$e instanceof DOMElement || $e->hasAttribute('disabled')) continue;
      $n = (string)$e->getAttribute('name'); if ($n === '') continue;
      $o = array_values(array_filter($fields, fn($q) => $q['n'] === $n))[0] ?? null; if (!$o) continue;
      $s = ['n' => $n, 'v' => $o['v'], 'opts' => $o['opts'] ?? [], 'auto' => (bool)preg_match('/__doPostBack/', (string)$e->getAttribute('onchange'))];
      $k = preg_replace('/^.*[\$:_]/', '', $n); $role = null;
      foreach ($re as $rr => $rx) if (!isset($sel[$rr]) && preg_match($rx, $k)) { $role = $rr; break; }
      if ($role) $sel[$role] = $s; else $rest[] = $s;
    }
    foreach (['settle', 'street', 'house', 'flat'] as $rr) if (!isset($sel[$rr]) && $rest) $sel[$rr] = array_shift($rest);   // за порядком на сторінці
    $acc = null; $btn = null; $subs = [];
    foreach ($fields as $o) {
      if ($acc === null && in_array($o['type'], ['text', 'number', 'tel'], true) && ($o['role'] === 'acc' || preg_match('/(?:^|[\$_])(?:TextBox)?(?:LS|ACC|RAHUN|OSOB)\w*$/i', $o['n']))) $acc = $o['n'];
      if (($o['type'] === 'submit' || $o['type'] === 'submit:submit') && $o['n'] !== '') $subs[] = [$o['n'], $o['v']];
    }
    foreach ($subs as $s2) if (preg_match('/пошук|знайти|шукати|search|далі|продовж|^ок$|^ok$|увійти/iu', $s2[1])) { $btn = $s2; break; }
    $btn = $btn ?? ($subs[0] ?? null);
    return ['form' => $form, 'fields' => $fields, 'sel' => $sel, 'acc' => $acc, 'btn' => $btn];
  }
  /** Postback: усі поля форми як є (+ обране у списках), __EVENTTARGET — список, що змінили, або кнопка (name=value). */
  private static function aspxPost(CabWeb $w, array $r, array $st, array $set, ?string $target, ?array $btn): array {
    $pairs = []; $et = false;
    foreach ($st['fields'] as $o) {
      $n = $o['n']; $t = $o['type']; if ($n === '') continue;
      if (str_starts_with($t, 'submit') || in_array($t, ['button', 'reset', 'image'], true)) continue;
      if (in_array($t, ['checkbox', 'radio'], true)) { if (!empty($o['checked'])) $pairs[] = [$n, $o['v'] !== '' ? $o['v'] : 'on']; continue; }
      if ($n === '__EVENTTARGET') { $pairs[] = [$n, (string)$target]; $et = true; continue; }
      if ($n === '__EVENTARGUMENT') { $pairs[] = [$n, '']; continue; }
      $pairs[] = [$n, array_key_exists($n, $set) ? (string)$set[$n] : $o['v']];
    }
    if ($target !== null && !$et) { array_unshift($pairs, ['__EVENTARGUMENT', '']); array_unshift($pairs, ['__EVENTTARGET', $target]); }
    if ($btn) $pairs[] = $btn;
    $act = trim((string)$st['form']->getAttribute('action')); $action = CabWeb::abs($act !== '' ? $act : $r['url'], $r['url']);
    if (!$w->sameSite($action)) throw self::page('offsite', $r['body']);
    $s = $w->req('POST', $action, $w->encode($pairs), ['Content-Type: application/x-www-form-urlencoded', 'Referer: ' . $r['url']]);
    if ((int)$s['code'] === 0 || (int)$s['code'] >= 500) throw new HttpError(502, 'lb_down');
    self::guard($s);
    return $s;
  }
  /** Кнопка або посилання-postback «Передати показання» → [__EVENTTARGET|null, [кнопка]|null]. */
  private static function aspxHop(string $html): ?array {
    $x = CabWeb::dom($html);
    foreach ($x->query('//a[@href]') as $a) {
      if (!$a instanceof DOMElement || !preg_match("/__doPostBack\\(\\s*'([^']+)'/", (string)$a->getAttribute('href'), $m)) continue;
      if (preg_match(self::LINK_RE, mb_strtolower(CabWeb::sp($a->textContent)))) return [$m[1], null];
    }
    foreach ($x->query('//form//input[@type="submit"]|//form//button') as $e)
      if ($e instanceof DOMElement && $e->getAttribute('name') !== '' && preg_match(self::LINK_RE, mb_strtolower(CabWeb::sp($e->getAttribute('value') . ' ' . $e->textContent)))) return [null, [(string)$e->getAttribute('name'), (string)$e->getAttribute('value')]];
    return null;
  }
  /** Кнопка надсилання показань: браузер шле ім’я натиснутої кнопки. <input type=submit> (fill() її не бере) — за написом «Зберегти / Передати…», не «Пошук»;
   *  ASP.NET LinkButton (javascript:__doPostBack) — через __EVENTTARGET. Іменована <button> уже є в парах — нічого не міняємо. */
  public static function submit(array $pairs, array $fields, string $html): array {
    $names = array_column($pairs, 0);
    foreach ($fields as $o) if ($o['type'] === 'submit:submit' && $o['n'] !== '' && in_array($o['n'], $names, true)) return $pairs;
    $save = '/зберег|збереж|передат|надісл|надіс|відправ|внест|внесит|подат|сохран|отправ|передать|подтверд|підтверд|save|submit|send/iu';
    $not = '/пошук|знайти|шукати|search|вихід|вийти|назад|скасув|очист|отмен|выход|logout/iu';
    $subs = array_values(array_filter($fields, fn($o) => $o['type'] === 'submit' && $o['n'] !== '' && !preg_match($not, $o['v'])));
    $pick = array_values(array_filter($subs, fn($o) => (bool)preg_match($save, $o['v'])));
    $s = $pick[0] ?? (count($subs) === 1 ? $subs[0] : null);
    if ($s) { $pairs[] = [$s['n'], $s['v']]; return $pairs; }
    $et = array_search('__EVENTTARGET', $names, true);
    if ($et !== false) {
      $x = CabWeb::dom($html);
      foreach ($x->query('//a[@href]') as $a)
        if ($a instanceof DOMElement && preg_match("/__doPostBack\\(\\s*'([^']+)'/", (string)$a->getAttribute('href'), $m) && preg_match($save, CabWeb::sp($a->textContent)) && !preg_match($not, CabWeb::sp($a->textContent))) { $pairs[$et][1] = $m[1]; break; }
    }
    return $pairs;
  }
  /** Звичайна HTML-форма входу (логін + пароль) → увійти. */
  private static function login(CabWeb $w, array $b, array $c, array $r): array {
    if (!empty($b['login'])) $r = self::get($w, $b['login']);
    $x = CabWeb::dom($r['body']); $form = null;
    foreach ($x->query('//form') as $f) if ($f instanceof DOMElement && in_array('password', array_column(RelayForm::fields($x, $f), 'type'), true)) { $form = $f; break; }
    if (!$form) throw self::page('no_login', $r['body']);
    // поле капчі у формі входу (Drupal captcha_response, «символи з малюнка») — стоп, не обходимо
    foreach (RelayForm::fields($x, $form) as $o) if (preg_match('/captcha|xcap|kcaptcha/i', $o['n'])) throw new HttpError(409, 'lb_captcha', ['human' => self::hum('captcha')]);
    $pairs = []; $fs = RelayForm::fields($x, $form);
    // поле логіна (106-а): info-gkh.com.ua має першим текстове поле cmd=login — беремо за назвою (login, email, account…), далі перше порожнє текстове, далі перше текстове
    $txt = array_values(array_filter($fs, fn($o) => $o['n'] !== '' && in_array($o['type'], ['text', 'email', 'tel'], true)));
    $byName = array_values(array_filter($txt, fn($o) => (bool)preg_match('/login|user|mail|account|acc|ident|phone|^ls$|rah|osob|LoginForm/i', $o['n']) && (string)$o['v'] === ''));
    $empty = array_values(array_filter($txt, fn($o) => (string)$o['v'] === ''));
    $user = ($byName[0] ?? $empty[0] ?? $txt[0] ?? ['n' => ''])['n'];
    foreach ($fs as $o) {
      if ($o['n'] === '') continue; $t = $o['type'];
      if ($t === 'password') { $pairs[] = [$o['n'], (string)($c['pass'] ?? '')]; continue; }
      if ($o['n'] === $user) { $pairs[] = [$o['n'], (string)($c['login'] ?? '')]; continue; }
      if (str_starts_with($t, 'submit')) { if ($t === 'submit:submit') $pairs[] = [$o['n'], $o['v']]; continue; }
      if (in_array($t, ['checkbox', 'radio'], true)) { if (!empty($o['checked'])) $pairs[] = [$o['n'], $o['v'] !== '' ? $o['v'] : 'on']; continue; }
      $pairs[] = [$o['n'], $o['v']];
    }
    $act = trim((string)$form->getAttribute('action')); $action = CabWeb::abs($act !== '' ? $act : $r['url'], $r['url']);
    $s = $w->req('POST', $action, $w->encode($pairs), ['Content-Type: application/x-www-form-urlencoded', 'Referer: ' . $r['url']]);
    if ((int)$s['code'] === 0 || (int)$s['code'] >= 500) throw new HttpError(502, 'lb_down');
    self::guard($s);
    // не пустило: та сама форма входу (ті ж імена логіна й пароля) або «невірний пароль»; інші форми з паролем на сторінці (реєстрація) — не ознака
    if (!self::readForm($s['body']) && (self::sameLogin($s['body'], array_column($pairs, 0)) || self::badPass($s['body']))) throw new HttpError(422, 'lb_login_bad', ['human' => self::hum('login_bad')]);
    return $s;
  }
  private static function sameLogin(string $html, array $names): bool {
    $x = CabWeb::dom($html);
    foreach ($x->query('//form') as $f) {
      if (!$f instanceof DOMElement) continue; $fs = RelayForm::fields($x, $f);
      $pw = array_column(array_filter($fs, fn($o) => $o['type'] === 'password'), 'n');
      if (count($pw) === 1 && in_array($pw[0], $names, true) && count(array_intersect(array_column($fs, 'n'), $names)) >= 2) return true;
    }
    return false;
  }
  private static function badPass(string $html): bool {
    $t = mb_strtolower(CabWeb::sp(strip_tags(preg_replace('~<(script|style)\b.*?</\1>~is', ' ', $html))));
    return (bool)preg_match('/невірн\S*\s+(?:логін|пароль|e-?mail|дан)|неправильн\S*\s+(?:логін|пароль|e-?mail|дан)|неверн\S*\s+(?:логин|пароль|e-?mail|дан)|incorrect\s+(?:username|email|password)|invalid\s+(?:login|password|credentials)/u', $t);
  }
  private static function notFound(string $html): bool {
    $t = self::text($html);
    // «Невірний особовий рахунок», «рахунок введено невірно», «неправильний номер лічильника» (107-а: між «невірний» і «рахунок» буває «особовий»)
    return (bool)preg_match('/не\s+знайден|не\s+знайдено|не\s+найден|(?:невірн|неправильн|не\s+вірн|неверн|неправильн)\S*\s+(?:(?:особов|лицев|абонентськ|абонентск)\S*\s+)?(?:код|рахун|сч[её]т|номер)'
      . '|(?:рахун|сч[её]т|номер)\S*(?:\s+\S+){0,3}?\s+(?:введен\S*\s+)?(?:невірн|неправильн|неверн|не\s+вірн)|абонент\S*\s+не\s+(?:існу|знайд|найд|сущест)|немає\s+такого|нет\s+такого/u', $t);
  }
  private static function text(string $html): string { return mb_strtolower(CabWeb::sp(strip_tags(preg_replace('~<(script|style)\b.*?</\1>~is', ' ', $html)))); }
  /** Сторінка помилки входу після форми рахунку: '' — не вона; 'empty' — сайт каже «заповніть усі поля» (ми не те надіслали); 'bad' — дані не прийняв. */
  private static function loginErr(string $html): string {
    $head = ''; if (preg_match('~<title\b[^>]*>(.*?)</title>~is', $html, $m)) $head .= ' ' . $m[1]; if (preg_match('~<h[12]\b[^>]*>(.*?)</h[12]>~is', $html, $m)) $head .= ' ' . $m[1];
    $isErr = preg_match('/помилк\S*\s+(?:входу|авторизац)|ошибк\S*\s+(?:входа|авторизац)|доступ\s+заборонено|доступ\s+запрещ/u', mb_strtolower(strip_tags($head)))
      || preg_match('~class=["\'][^"\']*\b(?:auth|login)[-_]error\b~i', $html);
    if (!$isErr) return '';
    return preg_match('/не\s+всю\s+інформац|не\s+всю\s+информац|заповніть\s+(?:усі|всі)\s+поля|заполните\s+все\s+поля|порожн\S*\s+пол|пуст\S*\s+пол/u', self::text($html)) ? 'empty' : 'bad';
  }
  /** Форма з полями показань → [DOMElement форма, поля, поля показань]. Форма входу (пароль) — не наша. */
  public static function readForm(string $html): ?array {
    if (!preg_match('/<form\b/i', $html)) return null;
    $x = CabWeb::dom($html); $best = null;
    foreach ($x->query('//form') as $f) {
      if (!$f instanceof DOMElement) continue; $fs = RelayForm::fields($x, $f);
      if (in_array('password', array_column($fs, 'type'), true)) continue;
      // поле без підпису в рядку таблиці («Лічильник № … | [  ]») — роль за текстом рядка
      foreach ($fs as $i => $o) if ($o['role'] === null && $o['n'] !== '' && in_array($o['type'], ['text', 'number', 'tel'], true)) {
        $rr = RelayForm::role($o['n'], mb_strtolower(self::around($html, $o['n'], true))); if (in_array($rr, ['all', 'day', 'night', 'peak', 'half'], true)) $fs[$i]['role'] = $rr;
      }
      $read = array_values(array_filter($fs, fn($o) => in_array($o['role'], ['all', 'day', 'night', 'peak', 'half'], true) && in_array($o['type'], ['text', 'number', 'tel'], true) && $o['n'] !== ''));
      if ($read && (!$best || count($read) > count($best[2]))) $best = [$f, $fs, $read];
    }
    return $best;
  }
  /** Посилання «Передати показання» на тому ж сайті. */
  private static function link(string $html, string $url, CabWeb $w): ?string {
    $x = CabWeb::dom($html);
    foreach ($x->query('//a[@href]') as $a) {
      if (!$a instanceof DOMElement) continue; $t = mb_strtolower(CabWeb::sp($a->textContent . ' ' . $a->getAttribute('title')));
      $h = trim((string)$a->getAttribute('href')); if ($h === '' || str_starts_with($h, '#') || preg_match('/^(javascript|mailto|tel):/i', $h)) continue;
      if (preg_match(self::LINK_RE, $t)) { $u = CabWeb::abs($h, $url); if ($w->sameSite($u)) return $u; }
    }
    return null;
  }
  /** Текст навколо поля (підпис, рядок таблиці) — щоб знайти номер лічильника. $head — ще й заголовок стовпця таблиці («Поточні показники»: ASP.NET GridView, 105-а) —
   *  лише для ролі поля, не для пошуку номера (у заголовку бувають дати). */
  public static function around(string $html, string $name, bool $head = false): string {
    $x = CabWeb::dom($html);
    foreach ($x->query("//*[@name='" . str_replace("'", '', $name) . "']") as $e) {
      $t = ''; $id = $e instanceof DOMElement ? (string)$e->getAttribute('id') : ''; $cell = null;
      if ($id !== '') foreach ($x->query("//label[@for='" . str_replace("'", '', $id) . "']") as $l) $t .= ' ' . $l->textContent;
      for ($p = $e->parentNode, $i = 0; $p instanceof DOMElement && $i < 4; $p = $p->parentNode, $i++) {
        if ($cell === null && in_array(strtolower($p->nodeName), ['td', 'th'], true)) $cell = $p;
        $s = CabWeb::sp($p->textContent); if (mb_strlen($s) > 300) break; $t .= ' ' . $s;
        if (in_array(strtolower($p->nodeName), ['tr', 'li', 'fieldset'], true)) break;
      }
      if ($head && $cell instanceof DOMElement && $cell->parentNode instanceof DOMElement) {
        $col = 0; for ($q = $cell->previousSibling; $q; $q = $q->previousSibling) if ($q instanceof DOMElement && in_array(strtolower($q->nodeName), ['td', 'th'], true)) $col += max(1, (int)$q->getAttribute('colspan'));
        for ($tb = $cell->parentNode->parentNode; $tb instanceof DOMElement && strtolower($tb->nodeName) !== 'table'; $tb = $tb->parentNode);
        if ($tb instanceof DOMElement) foreach ($x->query('.//tr[th]', $tb) as $hr) {
          $k = 0; foreach ($hr->childNodes as $hc) if ($hc instanceof DOMElement && in_array(strtolower($hc->nodeName), ['td', 'th'], true)) { if ($k === $col) { $t .= ' ' . CabWeb::sp($hc->textContent); break; } $k += max(1, (int)$hc->getAttribute('colspan')); }
          break;
        }
      }
      return $t . ' ' . $name;
    }
    return $name;
  }
  /** Показання → поля. Один лічильник і одне поле — просто; кілька — за номером лічильника в підписі/рядку, потім за видом (холодна/гаряча). Неоднозначно — стоп. */
  public static function fill(array $fields, array $read, array $items, string $html): array {
    if (!$items) throw new HttpError(422, 'lb_items');
    $map = [];   // ім'я поля → значення
    if (count($read) === 1 && count($items) === 1) $map[$read[0]['n']] = $items[0]['value'];
    else {
      $ctx = []; foreach ($read as $o) $ctx[$o['n']] = mb_strtolower(self::around($html, $o['n']));
      $left = $items;
      foreach ($left as $k => $it) {
        $sd = preg_replace('/\D/', '', (string)($it['serial'] ?? '')); if (strlen($sd) < 4) continue;
        $hit = array_keys(array_filter($ctx, fn($t, $n) => !isset($map[$n]) && str_contains(preg_replace('/\D/', '', $t), $sd), ARRAY_FILTER_USE_BOTH));
        if (count($hit) === 1) { $map[$hit[0]] = $it['value']; unset($left[$k]); }
      }
      foreach (['cold' => '/холодн/u', 'hot' => '/гаряч|горяч/u'] as $kind => $re) {
        $its = array_filter($left, fn($it) => ($it['kind'] ?? null) === $kind);
        $fs = array_keys(array_filter($ctx, fn($t, $n) => !isset($map[$n]) && preg_match($re, $t), ARRAY_FILTER_USE_BOTH));
        if (count($its) === 1 && count($fs) === 1) { $map[$fs[0]] = reset($its)['value']; unset($left[array_key_first($its)]); }
      }
      if ($left) throw new HttpError(422, 'lb_fields', ['human' => self::hum('fields'), 'skel' => RelayForm::skel($html)]);
    }
    $pairs = [];
    foreach ($fields as $o) {
      $n = $o['n']; $t = $o['type']; if ($n === '') continue;
      if (isset($map[$n])) { $pairs[] = [$n, $map[$n]]; continue; }
      if (str_starts_with($t, 'submit')) { if ($t === 'submit:submit') $pairs[] = [$n, $o['v']]; continue; }
      if (in_array($t, ['checkbox', 'radio'], true)) { if (!empty($o['checked']) || $o['role'] === 'consent') $pairs[] = [$n, $o['v'] !== '' ? $o['v'] : 'on']; continue; }
      // поле показань, яке нам не дісталося (лічильник, якого в людини немає в застосунку) — обов'язкове: стоп; ні — лишаємо, як є
      if (in_array($o['role'], ['all', 'day', 'night', 'peak', 'half'], true) && $o['req']) throw new HttpError(422, 'lb_fields', ['human' => self::hum('fields'), 'skel' => RelayForm::skel($html)]);
      $pairs[] = [$n, $o['v']];
    }
    return $pairs;
  }
}

/** Адреса людини ↔ списки сайту (населений пункт, вулиця, будинок, квартира) — для форм, де рахунок шукають за адресою (flow aspx, 105-а).
 *  Порівнюємо слова без типів («вул.», «просп.») і в будь-якому порядку («Степана Бандери» = «БАНДЕРИ СТЕПАНА»); латинські двійники й апострофи — як на сайті.
 *  Не знайшли або кілька однаково схожих — зрозуміла помилка з варіантами сайту; вгадувати не беремося. */
final class LbAddr {
  const TYPE = ['ВУЛ', 'ВУЛИЦЯ', 'ВУЛИЦА', 'УЛ', 'УЛИЦА', 'ПРОСП', 'ПРОСПЕКТ', 'ПР', 'ПРТ', 'БУЛЬВ', 'БУЛЬВАР', 'БУЛ', 'ПЛ', 'ПЛОЩА', 'ПЛОЩАДЬ', 'ШОСЕ', 'ШОССЕ', 'ТУП', 'ТУПИК',
    'ПРОЇЗД', 'ПРОЕЗД', 'УЗВІЗ', 'НАБ', 'НАБЕРЕЖНА', 'М', 'МІСТО', 'Г', 'ГОРОД', 'С', 'СЕЛО', 'СМТ', 'СЕЛИЩЕ', 'ПОС', 'ОБЛ', 'ОБЛАСТЬ', 'Р', 'РН', 'РАЙОН', 'МКР', 'МІКРОРАЙОН', 'УКРАЇНА', 'УКРАИНА'];
  const LANE = ['ПРОВ', 'ПРОВУЛОК', 'ПЕРЕУЛОК', 'ПЕР'];
  const HOUSE = ['БУД', 'БУДИНОК', 'Д', 'ДОМ'];
  const FLAT = ['КВ', 'КВАРТИРА', 'КВАРТ'];
  /** Великі літери; латинські двійники → кирилиця (на сайті «АВIАЦIЙНА» з латинською I); без апострофів. */
  public static function up(string $s): string {
    return strtr(mb_strtoupper($s), ['I' => 'І', 'A' => 'А', 'O' => 'О', 'E' => 'Е', 'C' => 'С', 'P' => 'Р', 'H' => 'Н', 'K' => 'К', 'M' => 'М', 'T' => 'Т', 'X' => 'Х', 'B' => 'В',
      'Ё' => 'Е', '’' => '', "'" => '', 'ʼ' => '', '`' => '', '‘' => '']);
  }
  /** Слова назви: без типів вулиць і номерних позначок; «пров.» → маркер #L (провулок і вулиця з тією ж назвою — різні). */
  public static function words(string $s): array {
    $out = [];
    foreach (preg_split('/\s+/u', trim((string)preg_replace('/[.,;:()«»"№#\-\/]+/u', ' ', self::up($s))), -1, PREG_SPLIT_NO_EMPTY) as $t) {
      if (in_array($t, self::LANE, true)) { $out[] = '#L'; continue; }
      if (!in_array($t, self::TYPE, true) && !in_array($t, self::HOUSE, true) && !in_array($t, self::FLAT, true)) $out[] = $t;
    }
    return $out;
  }
  /** Токени адреси з номерами як є («11-А», «16/2»); «кв12», «буд.6» → «КВ 12», «БУД 6». */
  public static function toks(string $s): array {
    $s = (string)preg_replace('/[.,;:()«»"№#]+/u', ' ', self::up($s));
    $s = (string)preg_replace('/(\d)\s*-\s*(КВ|КВАРТИРА)(?!\p{L})/u', '$1 $2', $s);   // «6-кв.4»
    $s = (string)preg_replace('/(?<!\p{L})(КВ|КВАРТИРА|БУД|Д)(?=\d)/u', '$1 ', $s);
    return preg_split('/\s+/u', trim($s), -1, PREG_SPLIT_NO_EMPTY);
  }
  public static function parse(string $addr): array { return ['w' => self::words($addr), 'tok' => self::toks($addr)]; }
  public static function title(string $s): string { return mb_convert_case(mb_strtolower(trim($s)), MB_CASE_TITLE); }
  private static function err(string $k, array $v = []): HttpError { return new HttpError(422, 'lb_' . $k, ['human' => LocalBot::h($k, $v)]); }
  /** Слова адреси без уже використаних (кожне — один раз). */
  private static function minus(array $w, array $used): array { foreach ($used as $u) { $i = array_search($u, $w, true); if ($i !== false) unset($w[$i]); } return array_values($w); }
  private static function isNum(string $x): bool { return (bool)preg_match('/^\d/u', $x); }
  /** Населений пункт: назва зі списку є серед слів адреси; один у списку — він. */
  public static function settle(array $A, array $opts, array &$used): ?string {
    if (!$opts) return null;
    $best = null; $bw = [];
    foreach ($opts as [$v, $t]) { $ow = self::words((string)$t); if ($ow && !array_diff($ow, $A['w']) && count($ow) > count($bw)) { $best = (string)$v; $bw = $ow; } }
    if ($best === null && count($opts) === 1) return (string)$opts[0][0];
    if ($best === null) throw self::err('addr_settle', ['list' => implode(', ', array_map(fn($o) => self::title((string)$o[1]), array_slice($opts, 0, 12)))]);
    $used = array_merge($used, $bw); return $best;
  }
  /** Вулиця → [значення, назва на сайті]. Спершу всі слова назви сайту є в адресі (найдовша), потім — лише перше слово (прізвище); провулок — лише з «пров.». */
  public static function street(array $A, array $opts, array &$used): array {
    $aw = self::minus($A['w'], $used); $named = array_values(array_filter($aw, fn($x) => $x !== '#L' && !self::isNum($x)));
    if (!$named) throw self::err('addr_street0');
    $lane = in_array('#L', $aw, true); $full = []; $part = [];
    foreach ($opts as [$v, $t]) {
      $ow = self::words((string)$t); $core = array_values(array_filter($ow, fn($x) => $x !== '#L'));
      if (!array_filter($core, fn($x) => !self::isNum($x))) continue;   // «ВУЛ 999,» — службовий рядок
      $o = [(string)$v, (string)$t, count($core), in_array('#L', $ow, true), $core];
      if (!array_diff($core, $aw)) $full[] = $o;
      elseif (!self::isNum($core[0]) && in_array($core[0], $aw, true)) { $o[2] = 1; $o[4] = [$core[0]]; $part[] = $o; }
    }
    foreach ([$full, $part] as $set) {
      if (!$set) continue;
      $pref = array_values(array_filter($set, fn($o) => $o[3] === $lane)); if ($pref) $set = $pref;
      usort($set, fn($a, $b) => $b[2] <=> $a[2]);
      $top = array_values(array_filter($set, fn($o) => $o[2] === $set[0][2]));
      if (count($top) > 1) throw self::err('addr_street2', ['list' => implode(', ', array_map(fn($o) => self::title($o[1]), array_slice($top, 0, 5)))]);
      $used = array_merge($used, $top[0][4]); return [$top[0][0], $top[0][1]];
    }
    $sug = [];
    foreach ($opts as [, $t]) foreach (self::words((string)$t) as $x) foreach ($named as $y)
      if (mb_strlen($x) >= 4 && mb_strlen($y) >= 4 && mb_substr($x, 0, 4) === mb_substr($y, 0, 4)) { $sug[(string)$t] = self::title((string)$t); continue 3; }
    $s = self::title(implode(' ', $named));
    throw $sug ? self::err('addr_street_s', ['s' => $s, 'list' => implode(', ', array_slice(array_values($sug), 0, 4))]) : self::err('addr_street', ['s' => $s]);
  }
  /** «11-А» = «11А» = «11 а»: без пробілів і дефісів. */
  public static function hn(string $s): string { return (string)preg_replace('/[\s\-]+/u', '', self::up($s)); }
  /** Номери будинку й квартири: за позначками «буд.», «кв.» або перші два числа після назв пункту й вулиці. → [будинок|null, квартира|null] */
  public static function nums(array $A, array $used): array {
    $tok = $A['tok']; $u = $used; $h = null; $f = null; $free = [];
    $take = function (int $i) use ($tok): array { $n = $tok[$i] ?? null; if ($n !== null && isset($tok[$i + 1]) && preg_match('/^\p{L}$/u', $tok[$i + 1]) && !in_array($tok[$i + 1], array_merge(self::FLAT, self::HOUSE, self::TYPE), true)) return [$n . $tok[$i + 1], 2]; return [$n, 1]; };
    for ($i = 0, $n = count($tok); $i < $n; $i++) {
      $t = $tok[$i];
      if (in_array($t, self::FLAT, true)) { [$f, $k] = $take($i + 1); $i += $k; continue; }
      if (in_array($t, self::HOUSE, true)) { [$h, $k] = $take($i + 1); $i += $k; continue; }
      $parts = array_values(array_filter(preg_split('/[\-\/]/u', $t), fn($p) => $p !== ''));
      $left = $u; $all = (bool)$parts;
      foreach ($parts as $p) { $j = array_search($p, $left, true); if ($j === false) { $all = false; break; } unset($left[$j]); }
      if ($all) { $u = $left; continue; }   // слово пункту чи вулиці (і «136» з «136 БАТАЛЬЙОНУ»)
      if (self::isNum($t)) { [$x, $k] = $take($i); $free[] = $x; $i += $k - 1; }
    }
    if ($h === null) $h = array_shift($free);
    if ($f === null) $f = $free[0] ?? null;
    return [$h, $f];
  }
  public static function house(array $A, array $opts, array $used, string $street): ?string {
    if (!$opts) return null;
    [$h] = self::nums($A, $used); if ($h === null) throw self::err('addr_house0');
    foreach ($opts as [$v, $t]) if (self::hn((string)$t) === self::hn($h)) return (string)$v;
    throw self::err('addr_house', ['h' => $h, 's' => self::title($street)]);
  }
  /** Квартира: у будинку без квартир (приватний) список порожній — пропускаємо. */
  public static function flat(array $A, array $opts, array $used): ?string {
    if (!$opts) return null;
    [, $f] = self::nums($A, $used); if ($f === null) throw self::err('addr_flat0');
    foreach ($opts as [$v, $t]) if (self::hn((string)$t) === self::hn($f)) return (string)$v;
    throw self::err('addr_flat', ['f' => $f]);
  }
}
