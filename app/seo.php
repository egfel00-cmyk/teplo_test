<?php
// 149-я (план конкурентов, п. 1, docs/конкуренты.md): сторінки для пошуку — «Як зняти показання <модель>», сервером, без скриптів, uk + ru.
//   /yak-znyaty-pokaznannya            — усі моделі (uk)     /ru/kak-snyat-pokazaniya            — (ru)
//   /yak-znyaty-pokaznannya/<модель>   — кроки моделі (uk)   /ru/kak-snyat-pokazaniya/<модель>   — (ru)
//   /kudy-peredaty                      — громади за областями /ru/kuda-peredat
//   /kudy-peredaty/<громада>            — постачальники, тарифи, строки й канали громади з довідника (Providers::kinds, живцем — правки /admin одразу)
// Дані — app/data/seo/models.json (node tools_seo.cjs з web/src/models.js). Адреси — у sitemap.xml з hreflang; посилання з лендингу.
declare(strict_types=1);
defined('TEPLO') || exit;

final class Seo {
  public const UK = '/yak-znyaty-pokaznannya', RU = '/ru/kak-snyat-pokazaniya', HUK = '/kudy-peredaty', HRU = '/ru/kuda-peredat';
  // 152-а (план конкурентів, п. 7): сторінки постачальників під запити «<постачальник> передати показання»
  public const PUK = '/postachalnyky', PRU = '/ru/postavshchiki';
  // 170-а (розбір конкурентів, п. 8 «пошук „комуналка Харків“»): «Комуналка в Харкові: куди передати показники» — шпаргалка міста
  public const KUK = '/komunalka', KRU = '/ru/kommunalka';
  // 177-а: + Київ, Одеса, Львів, Хмельницький — сторінка з довідника (komAny): хто приймає, вікно, як передати, тарифи з підставою, питання
  // [назва, місцевий, назва ru, місцевий ru, прийменник uk, прийменник ru] — «у Львові», «во Львове»
  private const KOM = ['kharkiv' => ['Харків', 'Харкові', 'Харьков', 'Харькове'], 'kyiv' => ['Київ', 'Києві', 'Киев', 'Киеве'], 'odesa' => ['Одеса', 'Одесі', 'Одесса', 'Одессе'],
    'lviv' => ['Львів', 'Львові', 'Львов', 'Львове', 'у', 'во'], 'khmelnytskyi' => ['Хмельницький', 'Хмельницькому', 'Хмельницкий', 'Хмельницком']];
  /** «в Харкові» / «у Львові» (ru — «во Львове»). */
  private static function komIn(string $slug, bool $ru): string { $c = self::KOM[$slug] ?? null; return $c ? ($c[$ru ? 5 : 4] ?? 'в') . ' ' . $c[$ru ? 3 : 1] : ''; }
  private static ?array $data = null;
  /** Параметри запиту для калькуляторів (index.php: $_GET). */
  public static array $q = [];

  public static function data(): array {
    if (self::$data === null) { $j = json_decode((string)@file_get_contents(__DIR__ . '/data/seo/models.json'), true); self::$data = is_array($j) ? $j : ['models' => []]; }
    return self::$data;
  }
  /** Адреса → [lang, slug|'', 'm'|'h'|'p'] або null. */
  public static function match(string $path): ?array {
    $p = rtrim($path, '/');
    if (class_exists('Calc')) foreach (['uk' => Calc::UK, 'ru' => Calc::RU] as $l => $pre) {
      if ($p === $pre) return [$l, '', 'c'];
      if (preg_match('~^' . preg_quote($pre, '~') . '/([a-z]{2,20})$~', $p, $m) && Calc::id($l, $m[1]) !== null) return [$l, $m[1], 'c'];
    }
    foreach (['uk' => self::KUK, 'ru' => self::KRU] as $l => $pre)
      if (preg_match('~^' . preg_quote($pre, '~') . '/([a-z0-9-]{2,40})$~', $p, $m) && isset(self::KOM[$m[1]])) return [$l, $m[1], 'k'];
    foreach (['uk' => self::PUK, 'ru' => self::PRU] as $l => $pre) {
      if ($p === $pre) return [$l, '', 'p'];
      if (preg_match('~^' . preg_quote($pre, '~') . '/([a-z0-9-]{2,70})$~', $p, $m)) return [$l, $m[1], 'p'];
    }
    foreach (['uk' => self::HUK, 'ru' => self::HRU] as $l => $pre) {
      if ($p === $pre) return [$l, '', 'h'];
      if (preg_match('~^' . preg_quote($pre, '~') . '/([a-z0-9-]{2,60})$~', $p, $m)) return [$l, $m[1], 'h'];
    }
    foreach (['uk' => self::UK, 'ru' => self::RU] as $l => $pre) {
      if ($p === $pre) return [$l, '', 'm'];
      if (preg_match('~^' . preg_quote($pre, '~') . '/([a-z0-9-]{2,40})$~', $p, $m)) return [$l, $m[1], 'm'];
    }
    return null;
  }
  public static function model(string $slug): ?array { foreach (self::data()['models'] ?? [] as $m) if ($m['slug'] === $slug) return $m; return null; }
  public static function url(string $lang, string $slug = ''): string { return ($lang === 'ru' ? self::RU : self::UK) . ($slug !== '' ? '/' . $slug : ''); }

  /** Для sitemap.xml: [[uk-адреса, ru-адреса]] (без адреси сайту). */
  public static function pairs(): array {
    $o = [[self::url('uk'), self::url('ru')]];
    foreach (self::data()['models'] ?? [] as $m) $o[] = [self::url('uk', $m['slug']), self::url('ru', $m['slug'])];
    if (class_exists('Providers')) {
      foreach (array_keys(self::KOM) as $sl) $o[] = [self::KUK . '/' . $sl, self::KRU . '/' . $sl];
      if (class_exists('Calc')) foreach (Calc::pairs() as $x) $o[] = $x;
      $o[] = [self::HUK, self::HRU]; foreach (self::hroms() as $sl => $x) $o[] = [self::HUK . '/' . $sl, self::HRU . '/' . $sl];
      $o[] = [self::PUK, self::PRU]; foreach (self::provs() as $sl => $x) $o[] = [self::PUK . '/' . $sl, self::PRU . '/' . $sl];
    }
    return $o;
  }

  // ---------------- громади: «Куди передати показання — <центр громади>» ----------------
  public const RG = ['kh' => ['Харківська обл.', 'Харьковская обл.'], 'kv' => ['Київська обл.', 'Киевская обл.'], 'ky' => ['м. Київ', 'г. Киев'], 'od' => ['Одеська обл.', 'Одесская обл.'],
    'lv' => ['Львівська обл.', 'Львовская обл.'], 'km' => ['Хмельницька обл.', 'Хмельницкая обл.']];
  private const KN = ['elec' => ['Світло', 'Свет'], 'water' => ['Вода', 'Вода'], 'gas' => ['Газ', 'Газ'], 'heat' => ['Тепло', 'Тепло'], 'waste' => ['Вивіз сміття', 'Вывоз мусора']];
  private static ?array $hr = null;
  /** Латиниця за постановою КМУ № 55 (2010), для адрес сторінок громад. */
  public static function translit(string $s): string {
    $s = mb_strtolower(str_replace(['’', "'", 'ʼ', '`'], '', $s));
    $first = ['є' => 'ye', 'ї' => 'yi', 'й' => 'y', 'ю' => 'yu', 'я' => 'ya'];
    $map = ['а' => 'a', 'б' => 'b', 'в' => 'v', 'г' => 'h', 'ґ' => 'g', 'д' => 'd', 'е' => 'e', 'є' => 'ie', 'ж' => 'zh', 'з' => 'z', 'и' => 'y', 'і' => 'i', 'ї' => 'i', 'й' => 'i',
      'к' => 'k', 'л' => 'l', 'м' => 'm', 'н' => 'n', 'о' => 'o', 'п' => 'p', 'р' => 'r', 'с' => 's', 'т' => 't', 'у' => 'u', 'ф' => 'f', 'х' => 'kh', 'ц' => 'ts', 'ч' => 'ch',
      'ш' => 'sh', 'щ' => 'shch', 'ь' => '', 'ю' => 'iu', 'я' => 'ia', 'ы' => 'y', 'э' => 'e', 'ё' => 'io', 'ъ' => ''];
    $out = ''; $prev = ' ';
    foreach (preg_split('//u', str_replace('зг', 'zgh', $s), -1, PREG_SPLIT_NO_EMPTY) as $ch) {
      $start = !preg_match('/\p{L}/u', $prev); $out .= $start && isset($first[$ch]) ? $first[$ch] : ($map[$ch] ?? $ch); $prev = $ch;
    }
    return trim(preg_replace('/[^a-z0-9]+/', '-', $out), '-');
  }
  /** slug → [hid, r, center, hromada]; центр — місто громади (M), інакше перший пункт. Однакові назви центрів — з кодом області. */
  public static function hroms(): array {
    if (self::$hr !== null) return self::$hr;
    $k = Providers::kat(); $ctr = [];
    foreach ($k['settlements'] as $st) { $h = (string)$st['h']; if (!isset($ctr[$h]) || ($st['c'] === 'M' && $ctr[$h]['c'] !== 'M')) $ctr[$h] = $st; }
    $raw = [];
    foreach ($k['hromadas'] as $hid => $hm) { $c = $ctr[(string)$hid] ?? null; if (!$c) continue; $raw[] = [(string)$hid, (string)($hm['r'] ?? 'kh'), (string)$c['n'], (string)($hm['n'] ?? '')]; }
    $cnt = array_count_values(array_map(fn($x) => self::translit($x[2]), $raw)); $out = [];
    foreach ($raw as $x) { $sl = self::translit($x[2]); if ($cnt[$sl] > 1) $sl .= '-' . $x[1]; if (isset($out[$sl])) $sl .= '-' . (self::translit($x[3]) ?: substr(md5($x[0]), 0, 4)); $out[$sl] = $x; }
    uksort($out, fn($a, $b) => strcmp($a, $b));
    return self::$hr = $out;
  }
  /** Вікно прийому: [a, b] → «з 25 по 30 число» (b < a — через кінець місяця, -1/-2 — останній/передостанній робочий день, 31 — до кінця місяця). */
  private static function win(?array $w, ?int $till, bool $ru): string {
    if ($w && count($w) === 2 && $w[0] !== null && $w[1] !== null) {
      [$a, $b] = [(int)$w[0], (int)$w[1]];
      $bt = $b === -1 ? ($ru ? 'последний рабочий день месяца' : 'останній робочий день місяця') : ($b === -2 ? ($ru ? 'предпоследний рабочий день' : 'передостанній робочий день') : ($b >= 31 ? ($ru ? 'конец месяца' : 'кінець місяця') : $b . ($ru ? ' число' : ' число')));
      if ($b < 0 || $b >= 31) return ($ru ? 'с ' : 'з ') . $a . ($ru ? ' числа по ' : ' числа по ') . $bt;
      return $b < $a ? ($ru ? "с $a числа по $b число следующего месяца" : "з $a числа по $b число наступного місяця") : ($ru ? "с $a по $b число" : "з $a по $b число");
    }
    return $till ? ($ru ? "до $till числа" : "до $till числа") : '';
  }
  public static function money($v): string { return number_format((float)$v, 2, ',', ' '); }
  /** Нотатка довідника без вказівок до кнопок застосунку («натисніть…», «впишіть свій…») — на сторінці вони не до речі. */
  private static function clean(string $t): string {
    $parts = preg_split('/(?<=[.!?])\s+/u', trim($t)) ?: [];
    return implode(' ', array_filter($parts, fn($x) => !preg_match('/натисн|нажм|впиш|застосунк|приложени|«У мене|«У меня/ui', $x)));
  }
  /** 152-а: «як передати», коли в довіднику тексту немає, а застосунок знає канали з коду (Харківобленерго — web/src/elec.js, i18n ed_*, довідка h-elec;
   *  газ Нафтогазу — «Куб», 0 800 303 104, SMS 4647 до Gs.SMS_UNTIL; Газмережі — бот і кабінет, довідка h-gas). Дані довідника — головніші ($o + def). */
  public const GAS_SMS_UNTIL = '2026-11-27';
  private static function defHow(string $k, array $o): array {
    if (!empty($o['how'])) return [];
    if ($k === 'elec' && trim((string)($o['net'] ?? '')) === 'АТ «Харківобленерго»') return [
      'how' => 'Показання світла приймає Харківобленерго в останні 2 дні місяця і з 1 по 3 число наступного (подані 1–3 числа зараховуються на 1-ше): ХарківОбленергоБот у Telegram, онлайн-форма на сайті Харківобленерго, SMS на 4300, застосунок «Харенерго» (iPhone і Android), Viber-бот або кол-центр Харківобленерго. Потрібен особовий рахунок (ЄР, 12 цифр) із платіжки Харківенергозбуту; у дво- й тризонних лічильників — кожну зону окремо, не суму.',
      'how_ru' => 'Показания света принимает Харьковоблэнерго в последние 2 дня месяца и с 1 по 3 число следующего (поданные 1–3 числа засчитываются на 1-е): ХарьковОблэнергоБот в Telegram, онлайн-форма на сайте Харьковоблэнерго, SMS на 4300, приложение «Харэнерго» (iPhone и Android), Viber-бот или колл-центр Харьковоблэнерго. Нужен лицевой счёт (ЕР, 12 цифр) из платёжки Харьковэнергосбыта; у двух- и трёхзонных счётчиков — каждую зону отдельно, не сумму.',
      'site' => 'https://oblenergo.kharkiv.ua/uk/transmissionofmeterreadings', 'bot' => 'https://t.me/Kooz2bot',
      'phones' => [['+380573424413', '(057) 342-44-13'], ['+380672340413', '(067) 234-04-13'], ['+380500540413', '(050) 054-04-13']]];
    if ($k === 'gas' && str_contains((string)($o['org'] ?? ''), 'Нафтогаз')) {
      $sms = date('Y-m-d') <= self::GAS_SMS_UNTIL; $gm = str_starts_with(trim((string)($o['grm'] ?? '')), 'Газмережі');
      return ['how' => 'Показання газу — станом на 1-ше число: застосунок Нафтогазу «Куб» або безкоштовний дзвінок на 0 800 303 104 (особовий рахунок Нафтогазу — 9 цифр із платіжки)' .
          ($sms ? '; SMS на 4647 («рахунок пробіл показання») — до 27 листопада 2026' : '') . ($gm ? '; бот Газмереж у Telegram @mygrmu_bot, кабінет Газмереж my.grmu.com.ua' : '') . '. Записують чорні цифри — цілі кубометри.',
        'how_ru' => 'Показания газа — на 1-е число: приложение Нафтогаза «Куб» или бесплатный звонок на 0 800 303 104 (лицевой счёт Нафтогаза — 9 цифр из платёжки)' .
          ($sms ? '; SMS на 4647 («счёт пробел показания») — до 27 ноября 2026' : '') . ($gm ? '; бот Газсетей в Telegram @mygrmu_bot, кабинет Газсетей my.grmu.com.ua' : '') . '. Записывают чёрные цифры — целые кубометры.'] +
        ($gm ? ['cab' => 'https://my.grmu.com.ua/', 'bot' => 'https://t.me/mygrmu_bot'] : []) + ['phones' => [['0800303104', '0 800 303 104']]];
    }
    return [];
  }
  /** Сортування за українською абеткою (і, ї, є, ґ — на своїх місцях). */
  public static function ukKey(string $s): string {
    static $ab = null; $ab ??= array_flip(preg_split('//u', 'абвгґдеєжзиіїйклмнопрстуфхцчшщьюя', -1, PREG_SPLIT_NO_EMPTY));
    $o = ''; foreach (preg_split('//u', mb_strtolower($s), -1, PREG_SPLIT_NO_EMPTY) as $c) $o .= isset($ab[$c]) ? chr(65 + $ab[$c]) : ($c === ' ' || $c === '-' ? ' ' : (preg_match('/[a-z0-9]/', $c) ? $c : ''));
    return $o;
  }
  /** $base — SITE_BASE для посилань на сторінки постачальників (null — без посилань), $self — назва постачальника цієї сторінки (на себе не посилаємось). */
  private static function kindCard(string $k, array $o, string $hid, bool $ru, ?string $base = null, string $self = ''): string {
    $e = [self::class, 'e']; $L = fn($f) => (string)($ru && !empty($o[$f . '_ru']) ? $o[$f . '_ru'] : ($o[$f] ?? ''));
    $org = trim((string)($o['org'] ?? '')); if ($org === '') return '';
    $a = fn(string $n) => $base === null || $n === $self ? $e($n) : self::plink($n, $ru, $base);
    $rows = [];
    if ($k === 'elec' && !empty($o['net'])) $rows[] = $e($ru ? 'Оператор сети: ' : 'Оператор мережі: ') . $a((string)$o['net']);
    if ($k === 'gas' && !empty($o['grm'])) $rows[] = $e($ru ? 'Доставка (оператор сети): ' : 'Доставка (оператор мережі): ') . $a((string)$o['grm']) . $e((!empty($o['dist']) ? ' — ' . self::money($o['dist']) . ($ru ? ' ₴ за 1 м³ годовой мощности' : ' ₴ за 1 м³ річної потужності') . (!empty($o['distFrom']) ? ($ru ? ' с ' : ' з ') . date('d.m.Y', strtotime((string)$o['distFrom'])) : '') : ''));
    $from = !empty($o['from']) ? ($ru ? ', с ' : ', з ') . date('d.m.Y', strtotime((string)$o['from'])) : '';
    $tx = [];
    if ($k === 'water' && !empty($o['supply'])) $tx[] = ($ru ? 'Тариф: вода ' : 'Тариф: вода ') . self::money($o['supply']) . (!empty($o['drain']) ? ($ru ? ', стоки ' : ', водовідведення ') . self::money($o['drain']) : '') . ($ru ? ' ₴ за м³' : ' ₴ за м³') . $from;
    if ($k === 'heat' && !empty($o['price'])) $tx[] = ($ru ? 'Тариф: ' : 'Тариф: ') . self::money($o['price']) . ($ru ? ' ₴ за Гкал' : ' ₴ за Гкал') . $from;
    // 170-а: підстава ціни (рішення/наказ, № і дата) — коли ціна в картці є
    $dc = trim((string)($ru && !empty($o['doc_ru']) ? $o['doc_ru'] : ($o['doc'] ?? '')));
    $hasP = ($k === 'water' && !empty($o['supply'])) || (in_array($k, ['heat', 'waste'], true) && !empty($o['price']));
    if ($k === 'waste' && !empty($o['price'])) $tx[] = ($ru ? 'Плата: ' : 'Плата: ') . self::money($o['price']) . ($ru ? ' ₴ в месяц' : ' ₴ на місяць') . (!empty($o['priv']) ? ($ru ? ' (частный сектор — ' : ' (приватний сектор — ') . self::money($o['priv']) . ')' : '') . $from;
    $via = (string)($o['via'] ?? '');
    $w = self::win(isset($o['win']) && is_array($o['win']) ? $o['win'] : ($via === 'htm' ? [5, 25] : ($via === 'hvk' ? [1, 20] : ($k === 'gas' && empty($o['how']) ? [1, 5] : null))), isset($o['till']) ? (int)$o['till'] : null, $ru);
    if ($w !== '' && $k !== 'waste') $tx[] = ($ru ? 'Показания: ' : 'Показання: ') . $w;
    if ($dc !== '' && $hasP) array_splice($tx, 1, 0, [($ru ? 'Основание: ' : 'Підстава: ') . mb_strtolower(mb_substr($dc, 0, 1)) . mb_substr($dc, 1)]);
    foreach ($tx as $t) $rows[] = $e($t);
    $o += self::defHow($k, $o); $L = fn($f) => (string)($ru && !empty($o[$f . '_ru']) ? $o[$f . '_ru'] : ($o[$f] ?? ''));
    $h = '<section class="card kc"><h2>' . $e(self::KN[$k][$ru ? 1 : 0]) . '</h2><p class="org">' . $a($org) . '</p>' . implode('', array_map(fn($r) => '<p class="row">' . $r . '</p>', $rows));
    if ($via !== '') $h .= '<p><span class="pill verified">' . ($ru ? 'передай отправит показания сам — с вашего согласия' : 'передай відправить показання сам — з вашої згоди') . '</span></p>';
    foreach (['how', 'pay'] as $f) { $tx = $L($f); if ($tx !== '') $h .= '<p>' . $e($tx) . '</p>'; }
    $nt = self::clean($L('note')); if ($nt !== '' && $k !== 'elec') $h .= '<p class="muted">' . $e($nt) . '</p>';
    $lk = [];
    foreach (['site' => ['Сайт', 'Сайт'], 'cab' => ['Кабінет', 'Кабинет'], 'bot' => ['Бот', 'Бот']] as $f => $nm) {
      $u = (string)($o[$f] ?? ''); if (preg_match('~^https?://~', $u)) $lk[] = '<a href="' . $e($u) . '" rel="nofollow noopener" target="_blank">' . $nm[$ru ? 1 : 0] . '</a>';
    }
    foreach (array_slice((array)($o['phones'] ?? []), 0, 3) as $ph) if (is_array($ph) && !empty($ph[0])) $lk[] = '<a href="tel:' . $e((string)$ph[0]) . '">' . $e((string)($ph[1] ?? $ph[0])) . '</a>';
    if ($lk) $h .= '<p class="links">' . implode(' · ', $lk) . '</p>';
    $src = $L('src'); if ($src !== '') $h .= '<details class="src"><summary>' . ($ru ? 'Источник' : 'Джерело') . '</summary><p class="muted">' . $e($src) . '</p></details>';
    return $h . '</section>';
  }
  private static function renderHrom(string $lang, string $slug, string $base, string $site): ?string {
    $ru = $lang === 'ru'; $e = [self::class, 'e']; $hs = self::hroms(); $x = $slug !== '' ? ($hs[$slug] ?? null) : null;
    if ($slug !== '' && !$x) return null;
    $abs = fn(string $l) => rtrim($site, '/') . ($l === 'ru' ? self::HRU : self::HUK) . ($slug !== '' ? '/' . $slug : '');
    if ($x) {
      [$hid, $r, $cn, $hn] = $x; $rg = self::RG[$r][$ru ? 1 : 0] ?? '';
      $kd = Providers::kinds(['n' => $cn, 'h' => $hid, 'r' => $r]);
      $orgs = []; foreach (['elec', 'water', 'gas', 'heat'] as $k) if (!empty($kd[$k]['org'])) $orgs[] = preg_replace('/\s+[А-ЯІЇЄҐ][а-яіїєґ’]+ської (міської|селищної|сільської) ради$/u', '', (string)$kd[$k]['org']);
      // 170-а: «комуналка» й «передати показники» — як шукають (розбір конкурентів, п. 8); Київ — без «(м. Київ)»
      $cr = $r === 'ky' ? '' : " ($rg)";
      $title = ($ru ? "Коммуналка $cn$cr: куда передать показания — свет, вода, газ, тепло" : "Комуналка $cn$cr: куди передати показники — світло, вода, газ, тепло");
      $desc = ($ru ? "Куда и до какого числа передать показания счётчиков в $cn: поставщики, тарифы на коммуналку и сроки" : "Куди й до якого числа передати показники лічильників у $cn: постачальники, тарифи на комуналку й строки") . ' — ' . implode(', ', array_slice($orgs, 0, 4)) . '.';
      $h1 = ($ru ? 'Куда передать показания — ' : 'Куди передати показання — ') . $cn;
    } else {
      $title = $ru ? 'Куда передать показания счётчиков — коммуналка 350 громад, 6 областей' : 'Куди передати показники лічильників — комуналка 350 громад, 6 областей';
      $desc = $ru ? 'Коммуналка по адресу: поставщики света, воды, газа, тепла и вывоза мусора, тарифы и сроки подачи показаний по громадам Харьковской, Киевской, Одесской, Львовской, Хмельницкой областей и Киева.'
        : 'Комуналка за адресою: постачальники світла, води, газу, тепла й вивозу сміття, тарифи та строки подачі показників за громадами Харківської, Київської, Одеської, Львівської, Хмельницької областей і Києва.';
      $h1 = $ru ? 'Куда передать показания счётчиков' : 'Куди передати показання лічильників';
    }
    $other = $ru ? 'uk' : 'ru';
    $h = '<!DOCTYPE html><html lang="' . $lang . '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' .
      '<title>' . $e($title) . '</title><meta name="description" content="' . $e($desc) . '"><meta name="robots" content="index, follow">' .
      '<link rel="canonical" href="' . $e($abs($lang)) . '"><link rel="alternate" hreflang="uk" href="' . $e($abs('uk')) . '"><link rel="alternate" hreflang="ru" href="' . $e($abs('ru')) . '">' .
      '<link rel="alternate" hreflang="x-default" href="' . $e($abs('uk')) . '"><link rel="icon" href="' . $e($base) . '/web/icon/favicon.svg" type="image/svg+xml">' .
      '<meta property="og:type" content="article"><meta property="og:title" content="' . $e($title) . '"><meta property="og:description" content="' . $e($desc) . '"><meta property="og:url" content="' . $e($abs($lang)) . '">' .
      '<meta property="og:image" content="' . $e($site . 'web/og-' . $lang . '-5.jpg') . '"><meta property="og:locale" content="' . ($ru ? 'ru_UA' : 'uk_UA') . '">' .
      '<link rel="stylesheet" href="' . $e($base) . '/web/fonts/fonts.css"><style>' . self::CSS . '.kc h2{margin-bottom:2px}.org{font-weight:600;margin:0 0 6px}.row{margin:2px 0}.links{font-size:15px}details.src summary{cursor:pointer;color:var(--ink2);font-size:15px}</style></head><body>' .
      '<header><div class="w"><a class="home" href="' . $e($base) . '/"><img src="' . $e($base) . '/web/icon/favicon.svg" alt="">' . self::wordmark() . '</a>' .
      '<a class="lng" href="' . $e($base . ($other === 'ru' ? self::HRU : self::HUK) . ($slug !== '' ? '/' . $slug : '')) . '" hreflang="' . $other . '" lang="' . $other . '">' . ($ru ? 'Українською' : 'Русский') . '</a></div></header><main class="w">';
    $idx = $base . ($ru ? self::HRU : self::HUK);
    $cta = '<section class="cta"><h2>' . ($ru ? 'Сроки и тарифы — сами, по адресу' : 'Строки й тарифи — самі, за адресою') . '</h2><p>' .
      ($ru ? 'Добавьте адрес квартиры в «передай»: поставщики, тарифы и окна подачи подставятся сами, напомним за 4 дня до конца срока, а где можно — отправим показания за вас. Бесплатно.'
        : 'Додайте адресу квартири в «передай»: постачальники, тарифи й вікна подачі підставляться самі, нагадаємо за 4 дні до кінця строку, а де можна — відправимо показання за вас. Безкоштовно.') .
      '</p><a class="btn" href="' . $e($base) . '/">' . ($ru ? 'Добавить адрес' : 'Додати адресу') . '</a></section>';
    if ($x) {
      $h .= '<nav class="bc"><a href="' . $e($base) . '/">передай</a> › <a href="' . $e($idx . '#' . $r) . '">' . ($ru ? 'Куда передать' : 'Куди передати') . '</a></nav><h1>' . $e($h1) . '</h1>' .
        '<p class="sub">' . $e(($hn !== '' ? $hn . ($ru ? ' громада' : ' громада') . ', ' : '') . $rg) . '</p>' .
        '<p>' . ($ru ? 'Для адресов громады. В отдельных сёлах поставщик бывает другой — сверьте с платёжкой.' : 'Для адрес громади. В окремих селах постачальник буває інший — звірте з платіжкою.') . '</p>';
      foreach (['elec', 'water', 'gas', 'heat', 'waste'] as $k) if (!empty($kd[$k]) && is_array($kd[$k])) $h .= self::kindCard($k, $kd[$k], $hid, $ru, $base);
      if (isset(self::KOM[$slug])) $h .= '<p><a href="' . $e($base . ($ru ? self::KRU : self::KUK) . '/' . $slug) . '">' . $e(($ru ? 'Коммуналка ' : 'Комуналка ') . self::komIn($slug, $ru) . ($ru ? ': шпаргалка на месяц и вопросы' : ': шпаргалка на місяць і питання')) . '</a></p>';
      if (!empty($kd['heat']['org'])) $h .= '<p><a href="' . $e($base . self::url($lang)) . '">' . ($ru ? 'Как снять показания теплосчётчика — по моделям' : 'Як зняти показання теплолічильника — за моделями') . '</a></p>';
      $h .= $cta . '<p class="muted"><a href="' . $e($idx . '#' . $r) . '">' . ($ru ? 'Другие громады — ' : 'Інші громади — ') . $e($rg) . '</a> · <a href="' . $e($base . ($ru ? self::PRU : self::PUK)) . '">' . ($ru ? 'Все поставщики' : 'Усі постачальники') . '</a></p>';
    } else {
      $h .= '<nav class="bc"><a href="' . $e($base) . '/">передай</a></nav><h1>' . $e($h1) . '</h1><p class="sub">' . $e($desc) . '</p>' .
        '<p class="links">' . implode(' · ', array_map(fn($sl) => '<a href="' . $e($base . ($ru ? self::KRU : self::KUK) . '/' . $sl) . '">' . $e(($ru ? 'Коммуналка ' : 'Комуналка ') . self::komIn($sl, $ru)) . '</a>', array_keys(self::KOM))) . '</p>';
      $by = []; foreach ($hs as $sl => $y) $by[$y[1]][$sl] = $y;
      foreach (array_keys(self::RG) as $r) {
        if (empty($by[$r])) continue; $l = $by[$r]; uasort($l, fn($a, $b) => strcmp(mb_strtolower($a[2]), mb_strtolower($b[2])));
        $h .= '<section id="' . $r . '"><h2>' . $e(self::RG[$r][$ru ? 1 : 0]) . '</h2><ul class="ml">' . implode('', array_map(fn($sl, $y) => '<li><a href="' . $e($idx . '/' . $sl) . '">' . $e($y[2]) . '</a><span>' . $e($y[3] !== '' ? $y[3] . ' громада' : '') . '</span></li>', array_keys($l), $l)) . '</ul></section>';
      }
      $h .= $cta . '<p class="muted"><a href="' . $e($base . ($ru ? self::PRU : self::PUK)) . '">' . ($ru ? 'Поставщики — как передать показания' : 'Постачальники — як передати показання') . '</a></p>';
    }
    return $h . '</main><footer><div class="w">' . self::wordmark() . '<p>' . ($ru ? 'Данные — из решений местных советов, сайтов и договоров поставщиков; у каждой строки — источник. Нашли ошибку — напишите через «Отзыв» в приложении.'
      : 'Дані — з рішень місцевих рад, сайтів і договорів постачальників; у кожного рядка — джерело. Знайшли помилку — напишіть через «Відгук» у застосунку.') . '</p></div></footer></body></html>';
  }

  // ---------------- постачальники: «<постачальник> — як передати показання» (152-а) ----------------
  // Одна сторінка — одна організація з довідника всіх областей (постачальники світла, газу, води, тепла, вивозу сміття) та оператори мереж
  // (обленерго — net, газорозподільні — grm): де працює (громади з посиланнями), як і коли передати показання, тарифи, сайт і телефони —
  // ті самі картки, що на сторінках громад; різні умови в різних громадах (Нафтогаз — свої ГРМ і тарифи доставки) — окремими картками.
  private static ?array $pv = null; private static array $pvn = [];
  private const PR = ['elec' => ['Постачальник світла', 'Поставщик света'], 'net' => ['Оператор системи розподілу — світло', 'Оператор системы распределения — свет'],
    'gas' => ['Постачальник газу', 'Поставщик газа'], 'grm' => ['Оператор газорозподільної мережі', 'Оператор газораспределительной сети'],
    'water' => ['Водопостачання', 'Водоснабжение'], 'heat' => ['Теплопостачання', 'Теплоснабжение'], 'waste' => ['Вивіз сміття', 'Вывоз мусора']];
  private const PG = ['elec' => ['світла', 'света'], 'net' => ['світла', 'света'], 'gas' => ['газу', 'газа'], 'grm' => ['газу', 'газа'], 'water' => ['води', 'воды'], 'heat' => ['тепла', 'тепла']];
  private const PORD = ['elec', 'net', 'water', 'gas', 'grm', 'heat', 'waste'];
  /** Ядро назви для адреси: «ПрАТ «АК «Київводоканал»» → Київводоканал, «YASNO (ТОВ …)» → YASNO, «Барвінківське КП «Благоустрій»» → Благоустрій. */
  private static function pcore(string $o): string {
    $s = trim((string)preg_replace('/\s*\([^()]*\)\s*$/u', '', $o));
    if (preg_match('/«(.+)»/u', $s, $m)) $s = $m[1];
    $s = (string)preg_replace('/^[А-ЯІЇЄҐA-Z]{1,5}\s+«/u', '', trim($s));
    $s = (string)preg_replace('/^(?:ГК|КП|КНП|ТОВ|ТзОВ|ПрАТ|ПАТ|АТ|ДП|ОКП|МКП|ПП|КУ|КК)\s+/u', '', trim($s));
    return trim($s) !== '' ? $s : $o;
  }
  private static function pcut(string $s): string { if (strlen($s) <= 60) return $s; $c = substr($s, 0, 60); $p = strrpos($c, '-'); return rtrim($p > 20 ? substr($c, 0, $p) : $c, '-'); }
  /** slug → ['n' => назва, 'roles' => [elec|net|water|gas|grm|heat|waste], 'locs' => [[вид, пункт, hid, r, slug громади|null, назва громади]]] */
  public static function provs(): array {
    if (self::$pv !== null) return self::$pv;
    $kat = Providers::kat(); $hs = self::hroms(); $ent = [];
    $add = function (string $name, string $role, string $kind, array $loc) use (&$ent) {
      $name = trim($name); if ($name === '') return;
      $ent[$name] ??= ['n' => $name, 'roles' => [], 'locs' => []];
      if (!in_array($role, $ent[$name]['roles'], true)) $ent[$name]['roles'][] = $role;
      $ent[$name]['locs'][] = array_merge([$kind], $loc);
    };
    $one = function (array $kd, array $only, array $loc) use ($add) {
      foreach ($only as $k) {
        $o = (array)($kd[$k] ?? []); $org = trim((string)($o['org'] ?? '')); if ($org === '') continue;
        $add($org, $k, $k, $loc);
        if ($k === 'elec' && !empty($o['net'])) $add((string)$o['net'], 'net', 'elec', $loc);
        if ($k === 'gas' && !empty($o['grm'])) $add((string)$o['grm'], 'grm', 'gas', $loc);
      }
    };
    foreach ($hs as $sl => [$hid, $r, $cn, $hn]) $one(Providers::kinds(['n' => $cn, 'h' => $hid, 'r' => $r]), Providers::CAT_KINDS, [$cn, $hid, $r, $sl, $hn]);
    // пункти з окремим постачальником (Буди, Феськи…): на сторінці громади його немає — місто без посилання
    $hidOf = []; foreach ($kat['hromadas'] as $id => $hm) $hidOf[($hm['r'] ?? 'kh') . '|' . (string)($hm['k'] ?? $hm['n'])] ??= (string)$id;
    foreach (array_keys(Providers::REGIONS) as $r) foreach ((array)(Providers::rdata($r)['settlements'] ?? []) as $sk => $so) {
      if (!is_array($so)) continue; [$hk, $n] = array_pad(explode('/', (string)$sk, 2), 2, '');
      $hid = $hidOf[$r . '|' . $hk] ?? null; if ($hid === null || $n === '') continue;
      $ks = array_values(array_intersect(Providers::CAT_KINDS, array_keys($so))); if (!$ks) continue;
      $one(Providers::kinds(['n' => $n, 'h' => $hid, 'r' => $r]), $ks, [$n, $hid, $r, null, (string)($kat['hromadas'][$hid]['n'] ?? '')]);
    }
    ksort($ent, SORT_STRING);
    $base = []; foreach ($ent as $nm => $x) $base[$nm] = self::pcut(self::translit(self::pcore($nm)) ?: substr(md5($nm), 0, 8));
    $cnt = array_count_values($base); $out = []; self::$pvn = [];
    foreach ($ent as $nm => $x) {
      $sl = $base[$nm];
      if ($cnt[$sl] > 1) $sl = self::pcut($sl . '-' . (self::translit((string)$x['locs'][0][1]) ?: $x['locs'][0][3]));
      if (isset($out[$sl])) $sl = self::pcut($sl . '-' . $x['locs'][0][3]);
      if (isset($out[$sl])) $sl = substr($sl, 0, 54) . '-' . substr(md5($nm), 0, 5);
      $out[$sl] = $x; self::$pvn[$nm] = $sl;
    }
    ksort($out, SORT_STRING);
    return self::$pv = $out;
  }
  /** Назва → посилання на її сторінку (немає сторінки — просто текст). */
  private static function plink(string $n, bool $ru, string $base): string {
    self::provs(); $sl = self::$pvn[trim($n)] ?? null;
    return $sl === null ? self::e($n) : '<a href="' . self::e($base . ($ru ? self::PRU : self::PUK) . '/' . $sl) . '">' . self::e($n) . '</a>';
  }
  /** «Харків, Люботин, Мерефа і ще 12» — без посилань (для списку й опису). */
  /** Місця: обласні центри першими, далі за абеткою. */
  private static function psort(array $locs): array {
    $big = ['Харків' => 1, 'Київ' => 1, 'Одеса' => 1, 'Львів' => 1, 'Хмельницький' => 1];
    usort($locs, fn($a, $b) => (isset($big[$b[1]]) <=> isset($big[$a[1]])) ?: strcmp(self::ukKey($a[1]), self::ukKey($b[1]))); return $locs;
  }
  private static function ptowns(array $locs, int $max, bool $ru): string {
    $t = array_values(array_unique(array_map(fn($l) => (string)$l[1], self::psort($locs)))); $n = count($t);
    return implode(', ', array_slice($t, 0, $max)) . ($n > $max ? ($ru ? ' и ещё ' : ' і ще ') . ($n - $max) : '');
  }
  private static function pregs(array $locs, bool $ru): string {
    $r = array_values(array_unique(array_map(fn($l) => (string)$l[3], $locs)));
    $ro = array_flip(array_keys(self::RG)); usort($r, fn($a, $b) => ($ro[$a] ?? 9) <=> ($ro[$b] ?? 9));
    return implode(', ', array_map(fn($x) => self::RG[$x][$ru ? 1 : 0] ?? $x, $r));
  }
  private static function renderProv(string $lang, string $slug, string $base, string $site): ?string {
    $ru = $lang === 'ru'; $e = [self::class, 'e']; $ps = self::provs(); $x = $slug !== '' ? ($ps[$slug] ?? null) : null;
    if ($slug !== '' && !$x) return null;
    $abs = fn(string $l) => rtrim($site, '/') . ($l === 'ru' ? self::PRU : self::PUK) . ($slug !== '' ? '/' . $slug : '');
    $idx = $base . ($ru ? self::PRU : self::PUK); $i = $ru ? 1 : 0;
    if ($x) {
      $roles = array_values(array_filter(self::PORD, fn($r) => in_array($r, $x['roles'], true)));
      $gen = array_values(array_unique(array_filter(array_map(fn($r) => self::PG[$r][$i] ?? '', $roles))));
      $gl = count($gen) > 1 ? implode(', ', array_slice($gen, 0, -1)) . ($ru ? ' и ' : ' і ') . end($gen) : ($gen[0] ?? '');
      $title = $x['n'] . ($gl !== '' ? ($ru ? ' — как передать показания ' : ' — як передати показання ') . $gl : ($ru ? ' — вывоз мусора: плата и контакты' : ' — вивіз сміття: плата й контакти'));
      $desc = implode(', ', array_map(fn($r) => self::PR[$r][$i], $roles)) . ': ' . self::ptowns($x['locs'], 3, $ru) . ' (' . self::pregs($x['locs'], $ru) . '). ' .
        ($gl !== '' ? ($ru ? 'Куда и до какого числа передать показания счётчиков, тарифы на коммуналку, сайт и телефоны.' : 'Куди й до якого числа передати показники лічильників, тарифи на комуналку, сайт і телефони.') : ($ru ? 'Плата за вывоз мусора, куда платить, телефоны.' : 'Плата за вивіз сміття, куди платити, телефони.'));
      $h1 = $x['n'];
    } else {
      $title = $ru ? 'Поставщики: как передать показания — свет, вода, газ, тепло' : 'Постачальники: як передати показання — світло, вода, газ, тепло';
      $desc = $ru ? count($ps) . ' поставщиков и операторов сетей в Харьковской, Киевской, Одесской, Львовской, Хмельницкой областях и Киеве: куда и до какого числа передать показания, тарифы, сайты и телефоны.'
        : count($ps) . ' постачальників і операторів мереж у Харківській, Київській, Одеській, Львівській, Хмельницькій областях і Києві: куди й до якого числа передати показання, тарифи, сайти й телефони.';
      $h1 = $ru ? 'Поставщики — как передать показания' : 'Постачальники — як передати показання';
    }
    $other = $ru ? 'uk' : 'ru';
    $h = '<!DOCTYPE html><html lang="' . $lang . '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' .
      '<title>' . $e($title) . '</title><meta name="description" content="' . $e($desc) . '"><meta name="robots" content="index, follow">' .
      '<link rel="canonical" href="' . $e($abs($lang)) . '"><link rel="alternate" hreflang="uk" href="' . $e($abs('uk')) . '"><link rel="alternate" hreflang="ru" href="' . $e($abs('ru')) . '">' .
      '<link rel="alternate" hreflang="x-default" href="' . $e($abs('uk')) . '"><link rel="icon" href="' . $e($base) . '/web/icon/favicon.svg" type="image/svg+xml">' .
      '<meta property="og:type" content="article"><meta property="og:title" content="' . $e($title) . '"><meta property="og:description" content="' . $e($desc) . '"><meta property="og:url" content="' . $e($abs($lang)) . '">' .
      '<meta property="og:image" content="' . $e($site . 'web/og-' . $lang . '-5.jpg') . '"><meta property="og:locale" content="' . ($ru ? 'ru_UA' : 'uk_UA') . '">' .
      '<link rel="stylesheet" href="' . $e($base) . '/web/fonts/fonts.css"><style>' . self::CSS . '.kc h2{margin-bottom:2px}.org{font-weight:600;margin:0 0 6px}.row{margin:2px 0}.links{font-size:15px}' .
      'details.src summary,details.more summary{cursor:pointer;color:var(--ink2);font-size:15px}.pl{margin:10px 0 0;padding-top:10px;border-top:1px solid var(--line);font-size:15px}.pl b{font-weight:600}h3{font-size:17px;margin:18px 0 6px}</style></head><body>' .
      '<header><div class="w"><a class="home" href="' . $e($base) . '/"><img src="' . $e($base) . '/web/icon/favicon.svg" alt="">' . self::wordmark() . '</a>' .
      '<a class="lng" href="' . $e($base . ($other === 'ru' ? self::PRU : self::PUK) . ($slug !== '' ? '/' . $slug : '')) . '" hreflang="' . $other . '" lang="' . $other . '">' . ($ru ? 'Українською' : 'Русский') . '</a></div></header><main class="w">';
    $cta = '<section class="cta"><h2>' . ($ru ? 'Сроки и тарифы — сами, по адресу' : 'Строки й тарифи — самі, за адресою') . '</h2><p>' .
      ($ru ? 'Добавьте адрес квартиры в «передай»: поставщики, тарифы и окна подачи подставятся сами, напомним за 4 дня до конца срока, а где можно — отправим показания за вас. Бесплатно.'
        : 'Додайте адресу квартири в «передай»: постачальники, тарифи й вікна подачі підставляться самі, нагадаємо за 4 дні до кінця строку, а де можна — відправимо показання за вас. Безкоштовно.') .
      '</p><a class="btn" href="' . $e($base) . '/">' . ($ru ? 'Добавить адрес' : 'Додати адресу') . '</a></section>';
    $hidx = $base . ($ru ? self::HRU : self::HUK);
    if ($x) {
      $h .= '<nav class="bc"><a href="' . $e($base) . '/">передай</a> › <a href="' . $e($idx) . '">' . ($ru ? 'Поставщики' : 'Постачальники') . '</a></nav><h1>' . $e($h1) . '</h1>' .
        '<p class="sub">' . $e(implode(' · ', array_map(fn($r) => self::PR[$r][$i], $roles)) . ' · ' . self::pregs($x['locs'], $ru)) . '</p>';
      // хто з ким: оператор мережі ↔ постачальник (з довідника, без вигадок)
      $pair = function (string $field, string $role) use ($x) { $o = []; foreach ($x['locs'] as $l) if ($l[0] === ($role === 'net' || $role === 'elec' ? 'elec' : 'gas')) {
        $kd = Providers::kinds(['n' => $l[1], 'h' => $l[2], 'r' => $l[3]]); $v = trim((string)($kd[$l[0]][$field] ?? '')); if ($v !== '' && !in_array($v, $o, true)) $o[] = $v; } return $o; };
      $lk = fn(array $ns) => implode(', ', array_map(fn($n) => self::plink($n, $ru, $base), $ns));
      if (in_array('net', $roles, true) && ($o = $pair('org', 'net'))) $h .= '<p>' . ($ru ? 'Оператор системы распределения электроэнергии: сети, счётчики, отключения. Счета за свет выставляет поставщик — ' : 'Оператор системи розподілу електроенергії: мережі, лічильники, відключення. Рахунки за світло виставляє постачальник — ') . $lk($o) . '.</p>';
      if (in_array('elec', $roles, true) && ($o = $pair('net', 'elec'))) $h .= '<p>' . ($ru ? 'Поставщик электроэнергии — выставляет счета за свет. Оператор сети — ' : 'Постачальник електроенергії — виставляє рахунки за світло. Оператор мережі — ') . $lk($o) . '.</p>';
      if (in_array('grm', $roles, true) && ($o = $pair('org', 'grm'))) $h .= '<p>' . ($ru ? 'Оператор газораспределительной сети — доставка газа, отдельная плата за годовую мощность. Газ поставляет ' : 'Оператор газорозподільної мережі — доставка газу, окрема плата за річну потужність. Газ постачає ') . $lk($o) . '.</p>';
      // картки: ті самі, що на сторінках громад; однакові — разом, з переліком місць
      $ks = []; foreach ($x['locs'] as $l) $ks[$l[0]] = true;
      foreach (['elec', 'water', 'gas', 'heat', 'waste'] as $k) {
        if (empty($ks[$k])) continue; $var = [];
        foreach ($x['locs'] as $l) { if ($l[0] !== $k) continue;
          $c = self::kindCard($k, (array)(Providers::kinds(['n' => $l[1], 'h' => $l[2], 'r' => $l[3]])[$k] ?? []), $l[2], $ru, $base, $x['n']); if ($c === '') continue;
          $var[$c][] = $l; }
        $ro = array_flip(array_keys(self::RG)); $bg = fn($ls) => (int)(bool)array_filter($ls, fn($l) => in_array($l[1], ['Харків', 'Київ', 'Одеса', 'Львів', 'Хмельницький'], true));
        uasort($var, fn($a, $b) => ($bg($b) <=> $bg($a)) ?: (($ro[$a[0][3]] ?? 9) <=> ($ro[$b[0][3]] ?? 9)) ?: count($b) <=> count($a));
        foreach ($var as $c => $ls) {
          $seen = []; $pl = []; $ls = self::psort($ls);
          foreach ($ls as $l) { if (isset($seen[$l[1]])) continue; $seen[$l[1]] = 1;
            $pl[] = $l[4] !== null ? '<a href="' . $e($hidx . '/' . $l[4]) . '">' . $e($l[1]) . '</a>' : $e($l[1]) . ($l[5] !== '' ? ' <span class="muted">(' . $e($l[5]) . ($ru ? ' громада' : ' громада') . ')</span>' : ''); }
          $where = '<p class="pl"><b>' . ($ru ? 'Где: ' : 'Де: ') . '</b>' . implode(', ', array_slice($pl, 0, 30)) .
            (count($pl) > 30 ? '<details class="more"><summary>' . ($ru ? 'ещё ' : 'ще ') . (count($pl) - 30) . '</summary>' . implode(', ', array_slice($pl, 30)) . '</details>' : '') . '</p>';
          $h .= substr($c, 0, -strlen('</section>')) . $where . '</section>';
        }
      }
      $h .= $cta . '<p class="muted"><a href="' . $e($idx . '#' . (in_array('net', $roles, true) ? 'elec' : (in_array('grm', $roles, true) ? 'gas' : $roles[0]))) . '">' . ($ru ? 'Другие поставщики' : 'Інші постачальники') . '</a> · <a href="' . $e($hidx) . '">' . ($ru ? 'Куда передать — по громадам' : 'Куди передати — за громадами') . '</a></p>';
    } else {
      $h .= '<nav class="bc"><a href="' . $e($base) . '/">передай</a></nav><h1>' . $e($h1) . '</h1><p class="sub">' . $e($desc) . '</p>' .
        '<p class="links">' . implode(' · ', array_map(fn($x) => '<a href="#' . $x[0] . '">' . $e($x[1][$i]) . '</a>', [['elec', ['Світло', 'Свет']], ['water', ['Вода', 'Вода']], ['gas', ['Газ', 'Газ']], ['heat', ['Тепло', 'Тепло']], ['waste', ['Вивіз сміття', 'Вывоз мусора']]])) . '</p>';
      $li = fn($sl, $y) => '<li><a href="' . $e($idx . '/' . $sl) . '">' . $e($y['n']) . '</a><span>' . $e(self::ptowns($y['locs'], 3, $ru)) . '</span></li>';
      $sec = [['elec', ['elec', 'net'], ['Світло', 'Свет']], ['water', ['water'], ['Вода', 'Вода']], ['gas', ['gas', 'grm'], ['Газ', 'Газ']], ['heat', ['heat'], ['Тепло', 'Тепло']], ['waste', ['waste'], ['Вивіз сміття', 'Вывоз мусора']]];
      foreach ($sec as [$id, $rs, $nm]) {
        $l = array_filter($ps, fn($y) => (bool)array_intersect($rs, $y['roles'])); if (!$l) continue;
        uasort($l, fn($a, $b) => strcmp(self::ukKey(self::pcore($a['n'])), self::ukKey(self::pcore($b['n']))));
        $h .= '<section id="' . $id . '"><h2>' . $e($nm[$i]) . '</h2>';
        if (count($l) <= 40) $h .= '<ul class="ml">' . implode('', array_map($li, array_keys($l), $l)) . '</ul>';
        else foreach (array_keys(self::RG) as $r) {
          $lr = array_filter($l, fn($y) => ($y['locs'][0][3] ?? '') === $r); if (!$lr) continue;
          $h .= '<h3>' . $e(self::RG[$r][$i]) . '</h3><ul class="ml">' . implode('', array_map($li, array_keys($lr), $lr)) . '</ul>';
        }
        $h .= '</section>';
      }
      $h .= $cta . '<p class="muted"><a href="' . $e($hidx) . '">' . ($ru ? 'Куда передать — по громадам' : 'Куди передати — за громадами') . '</a> · <a href="' . $e($base . self::url($lang)) . '">' . ($ru ? 'Как снять показания теплосчётчика' : 'Як зняти показання теплолічильника') . '</a></p>';
    }
    return $h . '</main><footer><div class="w">' . self::wordmark() . '<p>' . ($ru ? 'Данные — из решений местных советов, сайтов и договоров поставщиков; у каждой строки — источник. Сервис независимый, не связан с поставщиками. Нашли ошибку — напишите через «Отзыв» в приложении.'
      : 'Дані — з рішень місцевих рад, сайтів і договорів постачальників; у кожного рядка — джерело. Сервіс незалежний, не пов’язаний з постачальниками. Знайшли помилку — напишіть через «Відгук» у застосунку.') . '</p></div></footer></body></html>';
  }

  // ---------------- «Комуналка в Харкові: куди передати показники» (170-а) ----------------
  // Шпаргалка міста: кому платити й куди до якого числа передати показання кожного виду, що «передай» робить сам, тарифи (ті самі картки,
  // що на сторінці громади, з підставою ціни), питання й відповіді (FAQPage). Організації й тарифи — живцем з довідника (Providers::kinds),
  // строки й канали — правила застосунку (defHow, «Довідка»: Водоканал 1–20, ХТМ 5–25, обленерго — останні 2 дні й 1–3, газ 1–5).
  private static function renderKom(string $lang, string $slug, string $base, string $site): ?string {
    $c = self::KOM[$slug] ?? null; $x = self::hroms()[$slug] ?? null; if (!$c || !$x) return null;
    if ($slug !== 'kharkiv') return self::komAny($lang, $slug, $base, $site, $c, $x);
    $ru = $lang === 'ru'; $e = [self::class, 'e']; $T = fn(string $uk, string $r) => $ru ? $r : $uk;
    [$hid, $r, $cn] = $x; $kd = Providers::kinds(['n' => $cn, 'h' => $hid, 'r' => $r]);
    $in = $ru ? $c[3] : $c[1]; $nm = $ru ? $c[2] : $c[0];
    $abs = fn(string $l) => rtrim($site, '/') . ($l === 'ru' ? self::KRU : self::KUK) . '/' . $slug;
    $o = fn(string $k) => (array)($kd[$k] ?? []) + self::defHow($k, (array)($kd[$k] ?? []));
    $L = fn(array $a, string $f) => (string)($ru && !empty($a[$f . '_ru']) ? $a[$f . '_ru'] : ($a[$f] ?? ''));
    $ln = fn($n) => trim((string)$n) !== '' ? self::plink(trim((string)$n), $ru, $base) : '';
    $el = $o('elec'); $wa = $o('water'); $ga = $o('gas'); $he = $o('heat'); $ws = $o('waste');
    $wp = !empty($wa['supply']) ? self::money($wa['supply']) . ($ru ? ' ₴ за м³ воды' : ' ₴ за м³ води') . (!empty($wa['drain']) ? ($ru ? ' и ' : ' і ') . self::money($wa['drain']) . ($ru ? ' ₴ водоотведения' : ' ₴ водовідведення') : '') : '';
    $wdoc = trim($L($wa, 'doc')); $wnx = is_array($wa['next'] ?? null) && !empty($wa['next']['supply']) ? $wa['next'] : null;
    $title = $T("Комуналка в $in: куди передати показники — світло, вода, газ, тепло", "Коммуналка в $in: куда передать показания — свет, вода, газ, тепло");
    $desc = $T("Куди й до якого числа передати показання в $in: світло — Харківобленерго (останні 2 дні місяця й 1–3 число), вода — Водоканал з 1 по 20, тепло — ХТМ з 5 по 25, газ — з 1 по 5. Тарифи з рішеннями.",
      "Куда и до какого числа передать показания в $in: свет — Харьковоблэнерго (последние 2 дня месяца и 1–3 число), вода — Водоканал с 1 по 20, тепло — ХТС с 5 по 25, газ — с 1 по 5. Тарифы с решениями.");
    $h1 = $T("Комуналка в $in: куди передати показники", "Коммуналка в $in: куда передать показания");
    // шпаргалка: вид — хто приймає — коли — як
    $rows = [
      [$T('Світло', 'Свет'), $ln($el['net'] ?? '') . (!empty($el['org']) ? $T(' (рахунки — ', ' (счета — ') . $ln($el['org']) . ')' : ''), $T('останні 2 дні місяця і з 1 по 3 число наступного', 'последние 2 дня месяца и с 1 по 3 число следующего'),
        $T('ХарківОбленергоБот у Telegram, сайт Харківобленерго, застосунок «Харенерго», SMS на 4300, кол-центр', 'ХарьковОблэнергоБот в Telegram, сайт Харьковоблэнерго, приложение «Харэнерго», SMS на 4300, колл-центр')],
      [$T('Вода (холодна й гаряча)', 'Вода (холодная и горячая)'), $ln($wa['org'] ?? ''), $T('з 1 по 20 число', 'с 1 по 20 число'),
        $T('бот @hvk_user_bot, кабінет billing.vodokanal.kharkov.ua, цілодобово (057) 707-58-51. Гарячу — ще й ХТМ (за саму воду): бот @KPHTM_Bot або (057) 341-41-40', 'бот @hvk_user_bot, кабинет billing.vodokanal.kharkov.ua, круглосуточно (057) 707-58-51. Горячую — ещё и ХТС (за саму воду): бот @KPHTM_Bot или (057) 341-41-40')],
      [$T('Тепло (квартирний теплолічильник)', 'Тепло (квартирный теплосчётчик)'), $ln($he['org'] ?? ''), $T('з 5 по 25 число (радять — до 23-го)', 'с 5 по 25 число (советуют — до 23-го)'),
        $T('лише особистий кабінет на сайті ХТМ, розділ «Приймання показань по теплу»', 'только личный кабинет на сайте ХТС, раздел «Приймання показань по теплу»')],
      [$T('Газ', 'Газ'), $ln($ga['org'] ?? '') . (!empty($ga['grm']) ? $T(' і ', ' и ') . $ln($ga['grm']) . $T(' (доставка)', ' (доставка)') : ''), $T('з 1 по 5 число — станом на 1-ше', 'с 1 по 5 число — на 1-е'),
        $T('застосунок «Куб», 0 800 303 104, бот @mygrmu_bot, кабінет my.grmu.com.ua', 'приложение «Куб», 0 800 303 104, бот @mygrmu_bot, кабинет my.grmu.com.ua') . (date('Y-m-d') <= self::GAS_SMS_UNTIL ? $T('; SMS на 4647 — до 27 листопада 2026', '; SMS на 4647 — до 27 ноября 2026') : '')],
      [$T('Вивіз сміття', 'Вывоз мусора'), $ln($ws['org'] ?? ''), $T('лічильника немає', 'счётчика нет'), $T('платите з людини на місяць', 'платите с человека в месяц') . (!empty($ws['price']) ? ' — ' . self::money($ws['price']) . ' ₴' : '')],
    ];
    $sum = '<section class="card"><h2>' . $T('Шпаргалка на місяць', 'Шпаргалка на месяц') . '</h2><ul class="sm">' . implode('', array_map(fn($x) => '<li><b>' . $e($x[0]) . '</b> — ' . $x[1] .
      '<span class="when">' . $e($x[2]) . '</span><span class="how">' . $e($x[3]) . '</span></li>', $rows)) . '</ul></section>';
    // що «передай» робить сам (з коду: робот кабінету ХТМ, робот кабінету Водоканалу, нагадування за 4 дні, розпізнавання з фото в телефоні)
    $self = '<section class="card"><h2>' . $T('Що «передай» зробить за вас', 'Что «передай» сделает за вас') . '</h2><ul class="sm">' .
      '<li>' . $T('<b>Тепло ХТМ</b> — внесе показання у ваш кабінет ХТМ сам і забере квитанції (з вашого входу, пароль зберігаємо зашифрованим).', '<b>Тепло ХТС</b> — внесёт показания в ваш кабинет ХТС сам и заберёт квитанции (с вашего входа, пароль храним зашифрованным).') . '</li>' .
      '<li>' . $T('<b>Вода</b> — передасть показання водомірів Харківводоканалу за особовим рахунком і прізвищем.', '<b>Вода</b> — передаст показания водомеров Харьковводоканалу по лицевому счёту и фамилии.') . '</li>' .
      '<li>' . $T('<b>Світло й газ</b> — підготує цифри й особовий рахунок для бота чи кабінету, нагадає про строк.', '<b>Свет и газ</b> — подготовит цифры и лицевой счёт для бота или кабинета, напомнит о сроке.') . '</li>' .
      '<li>' . $T('Розпізнає цифри з фото прямо в телефоні, звірить з минулими показаннями, нагадає за 4 дні до кінця кожного строку. Безкоштовно.', 'Распознает цифры с фото прямо в телефоне, сверит с прошлыми показаниями, напомнит за 4 дня до конца каждого срока. Бесплатно.') . '</li></ul></section>';
    // питання й відповіді — ті самі тексти видно на сторінці і в FAQPage (schema.org)
    $qa = [
      [$T("До якого числа передавати показання води в $in?", "До какого числа передавать показания воды в $in?"),
        $T('Харківводоканалу — з 1 по 20 число: бот @hvk_user_bot, особистий кабінет billing.vodokanal.kharkov.ua або цілодобово (057) 707-58-51. Передають цілі кубометри — чорні цифри, червоні (літри) не потрібні. Гарячу воду передають ще й у ХТМ — за саму воду: бот @KPHTM_Bot або (057) 341-41-40.',
          'Харьковводоканалу — с 1 по 20 число: бот @hvk_user_bot, личный кабинет billing.vodokanal.kharkov.ua или круглосуточно (057) 707-58-51. Передают целые кубометры — чёрные цифры, красные (литры) не нужны. Горячую воду передают ещё и в ХТС — за саму воду: бот @KPHTM_Bot или (057) 341-41-40.')],
      [$T('Коли ХТМ приймає показання теплолічильника?', 'Когда ХТС принимает показания теплосчётчика?'),
        $T('З 5 по 25 число, лише в особистому кабінеті на сайті ХТМ; радять — до 23-го. Не встигли — зніміть нові показання наступного місяця: пропущений місяць нарахують за будинковим лічильником, після наступних прийнятих показань буде перерахунок.',
          'С 5 по 25 число, только в личном кабинете на сайте ХТС; советуют — до 23-го. Не успели — снимите новые показания в следующем месяце: пропущенный месяц начислят по домовому счётчику, после следующих принятых показаний будет перерасчёт.')],
    ];
    if ($wp !== '') $qa[] = [$T("Скільки коштує вода в $in?", "Сколько стоит вода в $in?"),
      (!empty($wa['from']) ? $T('З ', 'С ') . date('d.m.Y', strtotime((string)$wa['from'])) . ' — ' : '') . $wp . $T(' з ПДВ', ' с НДС') . ($wdoc !== '' ? ' (' . mb_strtolower(mb_substr($wdoc, 0, 1)) . mb_substr($wdoc, 1) . ')' : '') .
      ($wnx ? $T('; з ', '; с ') . date('d.m.Y', strtotime((string)$wnx['from'])) . ' — ' . self::money($wnx['supply']) . (!empty($wnx['drain']) ? $T(' і ', ' и ') . self::money($wnx['drain']) : '') . $T(' ₴', ' ₴') : '') . '.' .
      $T(' Холодна вода — вода й водовідведення; гаряча — тариф ХТМ за воду плюс водовідведення того ж кубометра.', ' Холодная вода — вода и водоотведение; горячая — тариф ХТС за воду плюс водоотведение того же кубометра.')];
    if (($t = $L($el, 'how')) !== '') $qa[] = [$T("Куди передати показання світла в $in?", "Куда передать показания света в $in?"), $t];
    if (($t = $L($ga, 'how')) !== '') $qa[] = [$T("Як передати показання газу в $in?", "Как передать показания газа в $in?"), $t];
    $qa[] = [$T('Чи можна передавати все в одному місці?', 'Можно ли передавать всё в одном месте?'),
      $T('Так: у «передай» додайте адресу квартири — постачальники, тарифи й строки підставляться самі. Тепло ХТМ і воду Водоканалу сервіс може відправити сам, світло й газ — підготує цифри для бота чи кабінету. Безкоштовно, без реклами.',
        'Да: в «передай» добавьте адрес квартиры — поставщики, тарифы и сроки подставятся сами. Тепло ХТС и воду Водоканала сервис может отправить сам, свет и газ — подготовит цифры для бота или кабинета. Бесплатно, без рекламы.')];
    $ld = ['@context' => 'https://schema.org', '@type' => 'FAQPage', 'inLanguage' => $lang,
      'mainEntity' => array_map(fn($q) => ['@type' => 'Question', 'name' => $q[0], 'acceptedAnswer' => ['@type' => 'Answer', 'text' => $q[1]]], $qa)];
    $faq = '<section class="card"><h2>' . $T('Питання', 'Вопросы') . '</h2>' . implode('', array_map(fn($q) => '<h3>' . $e($q[0]) . '</h3><p>' . $e($q[1]) . '</p>', $qa)) . '</section>';
    $cards = ''; foreach (['elec', 'water', 'gas', 'heat', 'waste'] as $k) if (!empty($kd[$k]) && is_array($kd[$k])) $cards .= self::kindCard($k, $kd[$k], $hid, $ru, $base);
    return self::komShell($lang, $slug, $base, $site, $r, $nm, $title, $desc, $h1, $ld, $sum . $self, $cards, $faq);
  }

  /** 177-а: «Комуналка в …» не Харкова — лише з довідника громади (Providers::kinds): хто приймає (орг., оператор мережі), вікно (`win`/`till` → self::win),
   *  як передати (`how`, газ Нафтогазу — defHow), тарифи з підставою (`doc`), гаряча вода (`hotOrg`, `hot`), що «передай» відправить сам (`via` — робот LocalBot). */
  private static function komAny(string $lang, string $slug, string $base, string $site, array $c, array $x): ?string {
    $ru = $lang === 'ru'; $e = [self::class, 'e']; $T = fn(string $uk, string $r) => $ru ? $r : $uk;
    [$hid, $r, $cn] = $x; $kd = Providers::kinds(['n' => $cn, 'h' => $hid, 'r' => $r]);
    $in = self::komIn($slug, $ru); $nm = $ru ? $c[2] : $c[0];   // «у Львові» — з прийменником
    $o = fn(string $k) => (array)($kd[$k] ?? []) + self::defHow($k, (array)($kd[$k] ?? []));
    $L = fn(array $a, string $f) => trim((string)($ru && !empty($a[$f . '_ru']) ? $a[$f . '_ru'] : ($a[$f] ?? '')));
    $ln = fn($n) => trim((string)$n) !== '' ? self::plink(trim((string)$n), $ru, $base) : '';
    $dt = fn($d) => date('d.m.Y', strtotime((string)$d));
    $m3 = function ($v): string { $x = number_format((float)$v, 3, ',', ' '); return str_ends_with($x, '0') ? substr($x, 0, -1) : $x; };   // тариф як у рішенні: 36,708, а не 36,71
    $sp = fn(string $t) => str_replace(["\u{00a0}", "\u{202f}", "\u{2009}"], ' ', $t);
    $lc = fn(string $t) => mb_strtolower(mb_substr($t, 0, 1)) . mb_substr($t, 1);
    $uc = fn(string $t) => mb_strtoupper(mb_substr($t, 0, 1)) . mb_substr($t, 1);
    $K = ['elec' => $o('elec'), 'water' => $o('water'), 'gas' => $o('gas'), 'heat' => $o('heat'), 'waste' => $o('waste')];
    $when = fn(array $a) => self::win(isset($a['win']) && is_array($a['win']) ? $a['win'] : null, isset($a['till']) ? (int)$a['till'] : null, $ru);
    // «як» без вступу про строк, коли строк уже окремим рядком: «Показання водомірів — з 1 по 4 число: кабінет…» → «Кабінет…»
    $how = function (array $a, bool $cut) use ($L, $uc): string { $t = $L($a, 'how');   // «як» — канали постачальника (застосунки теж), clean лише для нотаток
      if ($cut && preg_match('/^[^:]{0,180}?\d[^:]{0,120}:\s*(.+)$/us', $t, $m)) $t = $uc($m[1]); return $t; };
    $rows = [];
    foreach (['elec', 'water', 'gas', 'heat', 'waste'] as $k) {
      $a = $K[$k]; $org = trim((string)($a['org'] ?? '')); if ($org === '' && $L($a, 'how') === '') continue;
      $who = $k === 'elec' ? ($ln($a['net'] ?? '') !== '' ? $ln($a['net']) . ($org !== '' ? $T(' (рахунки — ', ' (счета — ') . $ln($org) . ')' : '') : $ln($org))
        : ($k === 'gas' ? $ln($org) . (!empty($a['grm']) ? $T(' і ', ' и ') . $ln($a['grm']) . $T(' (доставка)', ' (доставка)') : '') : $ln($org));
      if ($k === 'water' && !empty($a['hotOrg'])) $who .= $T('; гаряча вода — ', '; горячая вода — ') . $ln($a['hotOrg']);
      $w = $k === 'waste' ? $T('лічильника немає', 'счётчика нет') : $when($a);
      $hw = $k === 'waste' ? $L($a, 'pay') : $how($a, $w !== '');
      $rows[] = [self::KN[$k][$ru ? 1 : 0], $who, $w, $hw];
    }
    if (!$rows) return null;
    $sum = '<section class="card"><h2>' . $T('Шпаргалка на місяць', 'Шпаргалка на месяц') . '</h2><ul class="sm">' . implode('', array_map(fn($y) => '<li><b>' . $e($y[0]) . '</b> — ' . $y[1] .
      ($y[2] !== '' ? '<span class="when">' . $e($y[2]) . '</span>' : '') . ($y[3] !== '' ? '<span class="how">' . $e($y[3]) . '</span>' : '') . '</li>', $rows)) . '</ul></section>';
    // що «передай» зробить сам — лише де в довіднику є робот (`via`, LocalBot): лист на e-mail постачальника, форма сайту, кабінет
    $bg = []; $kw = ['elec' => ['Світло', 'Свет'], 'water' => ['Вода', 'Вода'], 'gas' => ['Газ', 'Газ'], 'heat' => ['Тепло', 'Тепло']];
    foreach (['elec', 'water', 'gas', 'heat'] as $k) {
      $v = (string)($K[$k]['via'] ?? ''); if ($v === '' || $v === 'hvk' || $v === 'htm') continue;
      $b = class_exists('LocalBot') ? LocalBot::get($v) : null; $tt = (string)($b['t'] ?? '');
      $how1 = $tt === 'mail' ? $T('листом на e-mail постачальника', 'письмом на e-mail поставщика') : ($tt === 'form' ? $T('через форму на сайті постачальника', 'через форму на сайте поставщика') : $T('через ваш особистий кабінет', 'через ваш личный кабинет'));
      $to = trim((string)($b['org'] ?? '')) ?: trim((string)($K[$k]['org'] ?? ''));   // кому йде лист чи форма (Львів, світло — Львівобленерго, не енергозбут)
      $bg[] = '<li><b>' . $e($kw[$k][$ru ? 1 : 0]) . '</b> — ' . $e($T('передасть показання', 'передаст показания') . ' ' . $to . ' ' . $T('сам', 'сам') . ', ' . $how1 . $T(' — з вашої згоди.', ' — с вашего согласия.')) . '</li>';
    }
    $self = '<section class="card"><h2>' . $T('Що «передай» зробить за вас', 'Что «передай» сделает за вас') . '</h2><ul class="sm">' . implode('', $bg) .
      '<li>' . ($bg ? $T('<b>Решта</b> — підготує цифри й особовий рахунок для бота чи кабінету постачальника.', '<b>Остальное</b> — подготовит цифры и лицевой счёт для бота или кабинета поставщика.')
        : $T('<b>Світло, вода, газ і тепло</b> — підготує цифри й особовий рахунок для бота чи кабінету постачальника.', '<b>Свет, вода, газ и тепло</b> — подготовит цифры и лицевой счёт для бота или кабинета поставщика.')) . '</li>' .
      '<li>' . $T('Розпізнає цифри з фото прямо в телефоні, звірить з минулими показаннями, нагадає за 4 дні до кінця строку, де він відомий. Безкоштовно.', 'Распознает цифры с фото прямо в телефоне, сверит с прошлыми показаниями, напомнит за 4 дня до конца срока, где он известен. Бесплатно.') . '</li></ul></section>';
    // питання — ті самі тексти на сторінці й у FAQPage
    $qa = []; $El = $K['elec']; $Wa = $K['water']; $Ga = $K['gas']; $He = $K['heat'];
    if (($t = $L($El, 'how')) !== '') $qa[] = [$T("Куди передати показання світла $in?", "Куда передать показания света $in?"), $t];
    if (($t = $L($Wa, 'how')) !== '') $qa[] = [$when($Wa) !== '' ? $T("До якого числа передавати показання води $in?", "До какого числа передавать показания воды $in?") : $T("Куди передати показання води $in?", "Куда передать показания воды $in?"), $t];
    if (!empty($Wa['supply'])) {
      $wd = $L($Wa, 'doc'); $nx = is_array($Wa['next'] ?? null) && !empty($Wa['next']['supply']) ? $Wa['next'] : null;
      $qa[] = [$T("Скільки коштує вода $in?", "Сколько стоит вода $in?"),
        (!empty($Wa['from']) ? $T('З ', 'С ') . $dt($Wa['from']) . ' — ' : '') . $m3($Wa['supply']) . $T(' ₴ за м³ води', ' ₴ за м³ воды') . (!empty($Wa['drain']) ? $T(' і ', ' и ') . $m3($Wa['drain']) . $T(' ₴ водовідведення', ' ₴ водоотведения') : '') .
        ($wd !== '' ? ' (' . $lc($wd) . ')' : '') . ($nx ? $T('; з ', '; с ') . $dt($nx['from']) . ' — ' . $m3($nx['supply']) . (!empty($nx['drain']) ? $T(' і ', ' и ') . $m3($nx['drain']) : '') . ' ₴' : '') . '.' .
        (!empty($Wa['hot']) && !empty($Wa['hotOrg']) ? $T(' Гаряча вода — ', ' Горячая вода — ') . $m3($Wa['hot']) . $T(' ₴ за м³ (', ' ₴ за м³ (') . trim((string)$Wa['hotOrg']) . ').' : '')];
    }
    if (($t = $L($Ga, 'how')) !== '') $qa[] = [$T("Як передати показання газу $in?", "Как передать показания газа $in?"), $t];
    if (($t = $L($He, 'how')) !== '') $qa[] = [$T("Як передати показання тепла $in?", "Как передать показания тепла $in?"), $t];
    if (!empty($He['price'])) { $hd = $L($He, 'doc'); $hn = self::clean($L($He, 'note')); $pm = self::money($He['price']);
      // нотатка довідника вже називає ціну — не повторюємо її окремим реченням; підстава — наприкінці
      $qa[] = [$T("Скільки коштує тепло $in?", "Сколько стоит тепло $in?"), ($hn !== '' && str_contains($sp($hn), $pm) ? $hn : $pm . $T(' ₴ за Гкал.', ' ₴ за Гкал.') . ($hn !== '' ? ' ' . $hn : '')) .
        ($hd !== '' ? $T(' Підстава: ', ' Основание: ') . $lc($hd) . '.' : '')]; }
    $qa[] = [$T('Чи можна передавати все в одному місці?', 'Можно ли передавать всё в одном месте?'),
      $T('Так: у «передай» додайте адресу квартири — постачальники, тарифи й строки підставляться самі. ', 'Да: в «передай» добавьте адрес квартиры — поставщики, тарифы и сроки подставятся сами. ') .
      ($bg ? $T('Де постачальник приймає показання листом, формою чи в кабінеті без капчі, сервіс відправить їх сам за вашою згодою, решту — підготує цифри для бота чи кабінету. ', 'Где поставщик принимает показания письмом, формой или в кабинете без капчи, сервис отправит их сам с вашего согласия, остальное — подготовит цифры для бота или кабинета. ')
        : $T('Сервіс підготує цифри й особовий рахунок для бота чи кабінету кожного постачальника. ', 'Сервис подготовит цифры и лицевой счёт для бота или кабинета каждого поставщика. ')) . $T('Безкоштовно, без реклами.', 'Бесплатно, без рекламы.')];
    $ld = ['@context' => 'https://schema.org', '@type' => 'FAQPage', 'inLanguage' => $lang,
      'mainEntity' => array_map(fn($q) => ['@type' => 'Question', 'name' => $q[0], 'acceptedAnswer' => ['@type' => 'Answer', 'text' => $q[1]]], $qa)];
    $faq = '<section class="card"><h2>' . $T('Питання', 'Вопросы') . '</h2>' . implode('', array_map(fn($q) => '<h3>' . $e($q[0]) . '</h3><p>' . $e($q[1]) . '</p>', $qa)) . '</section>';
    // опис — хто приймає показання, назви ядром («Київводоканал», «YASNO»)
    $who = []; foreach ([['elec', 'світло', 'свет'], ['water', 'вода', 'вода'], ['gas', 'газ', 'газ'], ['heat', 'тепло', 'тепло']] as [$k, $u, $rr]) {
      $n = trim((string)($k === 'elec' ? ($K[$k]['net'] ?? '') ?: ($K[$k]['org'] ?? '') : ($k === 'gas' ? ($K[$k]['grm'] ?? '') ?: ($K[$k]['org'] ?? '') : ($K[$k]['org'] ?? ''))));
      if ($n !== '') $who[] = ($ru ? $rr : $u) . ' — ' . preg_replace('/,\s*[^,]*філія$/u', '', self::pcore($n)); }   // «Газмережі, Львівська філія» → «Газмережі»
    $title = $T("Комуналка $in: куди передати показники — світло, вода, газ, тепло", "Коммуналка $in: куда передать показания — свет, вода, газ, тепло");
    $desc = $T("Куди й до якого числа передати показання $in: ", "Куда и до какого числа передать показания $in: ") . implode(', ', $who) . $T('. Тарифи з підставою, питання й відповіді.', '. Тарифы с основанием, вопросы и ответы.');
    $h1 = $T("Комуналка $in: куди передати показники", "Коммуналка $in: куда передать показания");
    $has = array_values(array_filter(['elec', 'water', 'gas', 'heat', 'waste'], fn($k) => trim((string)($K[$k]['org'] ?? '')) !== ''));
    $sub = $T('Світло, вода, газ, тепло', 'Свет, вода, газ, тепло') . (in_array('waste', $has, true) ? $T(' й вивіз сміття', ' и вывоз мусора') : '') . $T(' — кому платити, куди й до якого числа передати показання лічильників.', ' — кому платить, куда и до какого числа передать показания счётчиков.');
    $cards = ''; foreach (['elec', 'water', 'gas', 'heat', 'waste'] as $k) if (!empty($kd[$k]) && is_array($kd[$k])) $cards .= self::kindCard($k, $kd[$k], $hid, $ru, $base);
    return self::komShell($lang, $slug, $base, $site, $r, $nm, $title, $desc, $h1, $ld, $sum . $self, $cards, $faq, $sub);
  }

  /** Сторінка «Комуналка в …»: голова, шапка, хлібні крихти, h1, шпаргалка й «що зробимо» ($top), картки постачальників ($cards), питання ($faq), заклик, підвал. */
  private static function komShell(string $lang, string $slug, string $base, string $site, string $r, string $nm, string $title, string $desc, string $h1, array $ld, string $top, string $cards, string $faq, ?string $sub = null): string {
    $ru = $lang === 'ru'; $e = [self::class, 'e']; $T = fn(string $uk, string $rr) => $ru ? $rr : $uk;
    $abs = fn(string $l) => rtrim($site, '/') . ($l === 'ru' ? self::KRU : self::KUK) . '/' . $slug;
    $hidx = $base . ($ru ? self::HRU : self::HUK); $other = $ru ? 'uk' : 'ru';
    $h = '<!DOCTYPE html><html lang="' . $lang . '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' .
      '<title>' . $e($title) . '</title><meta name="description" content="' . $e($desc) . '"><meta name="robots" content="index, follow">' .
      '<link rel="canonical" href="' . $e($abs($lang)) . '"><link rel="alternate" hreflang="uk" href="' . $e($abs('uk')) . '"><link rel="alternate" hreflang="ru" href="' . $e($abs('ru')) . '">' .
      '<link rel="alternate" hreflang="x-default" href="' . $e($abs('uk')) . '"><link rel="icon" href="' . $e($base) . '/web/icon/favicon.svg" type="image/svg+xml">' .
      '<meta property="og:type" content="article"><meta property="og:title" content="' . $e($title) . '"><meta property="og:description" content="' . $e($desc) . '"><meta property="og:url" content="' . $e($abs($lang)) . '">' .
      '<meta property="og:image" content="' . $e($site . 'web/og-' . $lang . '-5.jpg') . '"><meta property="og:locale" content="' . ($ru ? 'ru_UA' : 'uk_UA') . '">' .
      '<link rel="stylesheet" href="' . $e($base) . '/web/fonts/fonts.css"><style>' . self::CSS . '.kc h2{margin-bottom:2px}.org{font-weight:600;margin:0 0 6px}.row{margin:2px 0}.links{font-size:15px}details.src summary{cursor:pointer;color:var(--ink2);font-size:15px}' .
      'ul.sm{list-style:none;margin:0;padding:0}ul.sm>li{padding:10px 0;border-top:1px solid var(--line)}ul.sm>li:first-child{border-top:0;padding-top:0}ul.sm .when{display:block;font-weight:600}ul.sm .how{display:block;font-size:15px;color:var(--ink2)}h3{font-size:17px;margin:16px 0 4px}</style>' .
      '<script type="application/ld+json">' . json_encode($ld, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) . '</script></head><body>' .
      '<header><div class="w"><a class="home" href="' . $e($base) . '/"><img src="' . $e($base) . '/web/icon/favicon.svg" alt="">' . self::wordmark() . '</a>' .
      '<a class="lng" href="' . $e($base . ($other === 'ru' ? self::KRU : self::KUK) . '/' . $slug) . '" hreflang="' . $other . '" lang="' . $other . '">' . ($ru ? 'Українською' : 'Русский') . '</a></div></header><main class="w">' .
      '<nav class="bc"><a href="' . $e($base) . '/">передай</a> › <a href="' . $e($hidx . '#' . $r) . '">' . $T('Куди передати', 'Куда передать') . '</a></nav><h1>' . $e($h1) . '</h1>' .
      '<p class="sub">' . ($sub ?? $T('Світло, вода, газ, тепло й вивіз сміття — кому платити, куди й до якого числа передати показання лічильників.', 'Свет, вода, газ, тепло и вывоз мусора — кому платить, куда и до какого числа передать показания счётчиков.')) . '</p>' .
      $top . '<h2>' . $T('Постачальники й тарифи', 'Поставщики и тарифы') . '</h2>' . $cards;
    $h .= $faq . '<section class="cta"><h2>' . $T('Строки й тарифи — самі, за адресою', 'Сроки и тарифы — сами, по адресу') . '</h2><p>' .
      $T('Додайте адресу квартири в «передай»: постачальники, тарифи й вікна подачі підставляться самі, нагадаємо за 4 дні до кінця строку, а де можна — відправимо показання за вас. Безкоштовно.',
        'Добавьте адрес квартиры в «передай»: поставщики, тарифы и окна подачи подставятся сами, напомним за 4 дня до конца срока, а где можно — отправим показания за вас. Бесплатно.') .
      '</p><a class="btn" href="' . $e($base) . '/">' . $T('Додати адресу', 'Добавить адрес') . '</a></section>' .
      '<p class="muted"><a href="' . $e($hidx . '/' . $slug) . '">' . $e($T("Громада: $nm", "Громада: $nm")) . '</a>' . (class_exists('Calc') ? ' · <a href="' . $e($base . Calc::url($lang)) . '">' . $T('Калькулятори: вода, світло, газ', 'Калькуляторы: вода, свет, газ') . '</a>' : '') . ' · <a href="' . $e($base . self::url($lang)) . '">' . $T('Як зняти показання теплолічильника', 'Как снять показания теплосчётчика') . '</a> · <a href="' . $e($base . ($ru ? self::PRU : self::PUK)) . '">' . $T('Усі постачальники', 'Все поставщики') . '</a></p>';
    return $h . '</main><footer><div class="w">' . self::wordmark() . '<p>' . $T('Дані — з рішень місцевих рад, сайтів і договорів постачальників; у кожного рядка — джерело. Сервіс незалежний, не пов’язаний з постачальниками. Знайшли помилку — напишіть через «Відгук» у застосунку.',
      'Данные — из решений местных советов, сайтов и договоров поставщиков; у каждой строки — источник. Сервис независимый, не связан с поставщиками. Нашли ошибку — напишите через «Отзыв» в приложении.') . '</p></div></footer></body></html>';
  }

  /** 170-а (розбір конкурентів: «llms.txt + публічний „Що нового“»): /llms.txt за llmstxt.org — що це за сервіс і де які розділи, для
   *  ШІ-пошуку й асистентів. Лише публічні сторінки (лендинг, довідники сервером); числа — живцем з довідника й моделей. $site — з / в кінці. */
  public static function llms(string $site): string {
    $s = rtrim($site, '/'); $nh = count(self::hroms()); $np = count(self::provs()); $nm = count(self::data()['models'] ?? []);
    $L = fn(string $u, string $t, string $d = '') => '- [' . $t . '](' . $s . $u . ')' . ($d !== '' ? ': ' . $d : '') . "\n";
    $o = "# передай (" . (string)parse_url($site, PHP_URL_HOST) . ")\n\n" .
      "> Безкоштовний сервіс для показань лічильників в Україні: світло, вода, газ, тепло (квартирні теплолічильники) і вивіз сміття. Фото лічильника → цифри розпізнаються прямо в телефоні → сервіс підказує, куди й до якого числа передати показання, нагадує про строки, а де є відкритий канал (кабінет ХТМ, кабінет Харківводоканалу, e-mail чи форма місцевого КП) — відправляє показання сам за згодою людини.\n\n" .
      "Мови: українська й російська. Працює в браузері (веб-застосунок), у Telegram-боті й (готується) на iPhone. Довідник постачальників, тарифів і вікон подачі — $nh громад Харківської, Київської, Одеської, Львівської, Хмельницької областей і Києва; у кожного тарифу — джерело (рішення ради, № і дата). Сервіс незалежний, не пов’язаний з постачальниками, без реклами.\n\n" .
      "## Головне\n" . $L('/', 'Застосунок «передай»', 'внести показання, історія, статистика, нагадування; без реєстрації дані зберігаються в браузері') .
      "\n## Довідники (сторінки сервером, без JavaScript, uk + ru)\n" .
      $L(self::HUK, 'Куди передати показання — за громадами', "$nh громад: постачальники світла, води, газу, тепла й вивозу сміття, тарифи з підставою, вікна прийому показань, канали") .
      $L(self::KUK . '/kharkiv', 'Комуналка в Харкові: куди передати показники', 'шпаргалка на місяць (Харківобленерго, Харківводоканал, ХТМ, газ, вивіз сміття), тарифи, питання й відповіді') .
      implode('', array_map(fn($sl) => $L(self::KUK . '/' . $sl, 'Комуналка ' . self::komIn($sl, false) . ': куди передати показники', 'хто приймає, вікна подачі, як передати й тарифи з підставою — з довідника'), array_diff(array_keys(self::KOM), ['kharkiv']))) .
      $L(self::PUK, 'Постачальники — як передати показання', "$np постачальників і операторів мереж: де працюють, строки, тарифи, сайти й телефони") .
      $L(self::UK, 'Як зняти показання теплолічильника', "$nm моделей покроково: які кнопки натискати й що записати (енергія, обсяг, температури, години роботи)") .
      (class_exists('Calc') ? "\n## Калькулятори (форма без JavaScript, результат — сервером)\n" .
        $L(Calc::url('uk', 'voda'), 'Калькулятор води', 'холодна, гаряча й водовідведення за весь обсяг (КМУ № 690) — тарифи громади з довідника') .
        $L(Calc::url('uk', 'svitlo'), 'Калькулятор світла', 'одна зона, день/ніч (ніч ×0,5), три зони (пік ×1,5, напівпік ×1, ніч ×0,4) за ціною для населення') .
        $L(Calc::url('uk', 'gaz'), 'Калькулятор газу', 'газ за ціною Нафтогазу + доставка: річна потужність ÷ 12 × тариф оператора мережі громади') : '') .
      "\n## Російською\n" .
      $L(self::HRU, 'Куда передать показания — по громадам') . $L(self::KRU . '/kharkiv', 'Коммуналка в Харькове: куда передать показания') .
      implode('', array_map(fn($sl) => $L(self::KRU . '/' . $sl, 'Коммуналка ' . self::komIn($sl, true) . ': куда передать показания'), array_diff(array_keys(self::KOM), ['kharkiv']))) .
      $L(self::PRU, 'Поставщики — как передать показания') . $L(self::RU, 'Как снять показания теплосчётчика') . (class_exists('Calc') ? $L(Calc::RU, 'Калькуляторы коммуналки: вода, свет, газ') : '') .
      "\n## Optional\n" . $L('/sitemap.xml', 'Карта сайту', 'усі сторінки громад, постачальників і моделей парами uk/ru') .
      $L('/#privacy', 'Політика конфіденційності') . $L('/#terms', 'Умови використання');
    return $o;
  }

  public static function e(string $s): string { return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
  public static function wordmark(): string {
    $w = self::data()['wm'] ?? null; if (!$w) return '<b>передай</b>';
    return '<svg class="wm" viewBox="' . self::e((string)$w['vb']) . '" role="img" aria-label="передай"><defs><linearGradient id="wmg" gradientUnits="userSpaceOnUse" x1="' . (float)$w['g'][0] . '" y1="0" x2="' . (float)$w['g'][1] . '" y2="0">' .
      '<stop offset="0" stop-color="#FF6A1F"/><stop offset=".5" stop-color="#B44DFF"/><stop offset="1" stop-color="#2E86FF"/></linearGradient></defs>' .
      '<path fill="currentColor" d="' . self::e((string)$w['d']) . '"/><path fill="none" stroke="url(#wmg)" stroke-width="' . (float)$w['bw'] . '" stroke-linecap="round" d="' . self::e((string)$w['b']) . '"/></svg>';
  }
  public const CSS = <<<'CSS'
:root{--bg:#E9EEEB;--card:#fff;--ink:#17211E;--ink2:#4A5652;--line:#CFD7D3;--lcd:#BCC8A2;--lcd-ink:#1C2618;--ok:#18693F;--ok-s:#DFF1E7;--warn:#8F5600;--warn-s:#FBEFD5;--info:#173A61;--info-s:#E2ECF8;--btn:#17211E;--on-btn:#fff;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#101614;--card:#18201D;--ink:#E8EEEB;--ink2:#A9B5B0;--line:#2E3935;--lcd:#9FAE80;--ok:#7FD3A2;--ok-s:#173126;--warn:#F2C26B;--warn-s:#33280F;--info:#A9C8F0;--info-s:#172638;--btn:#E8EEEB;--on-btn:#101614;color-scheme:dark}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.55 "IBM Plex Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:inherit;text-underline-offset:3px}.w{max-width:760px;margin:0 auto;padding:0 20px}
header{padding:18px 0}header .w{display:flex;align-items:center;justify-content:space-between;gap:12px}.home{display:flex;align-items:center;gap:10px;text-decoration:none}.home img{width:30px;height:30px;border-radius:8px}
.wm{height:22px;width:auto;display:block}.lng{font-size:15px;color:var(--ink2)}
nav.bc{font-size:15px;color:var(--ink2);margin:8px 0 4px}nav.bc a{color:var(--ink2)}
h1{font-size:30px;line-height:1.2;margin:6px 0 8px;letter-spacing:-.01em}h2{font-size:21px;line-height:1.3;margin:0 0 10px}
.sub{color:var(--ink2);margin:0 0 14px}.pill{display:inline-block;font-size:14px;font-weight:600;padding:3px 12px;border-radius:999px;background:var(--info-s);color:var(--info)}
.pill.verified{background:var(--ok-s);color:var(--ok)}.pill.draft{background:var(--warn-s);color:var(--warn)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin:16px 0}
ol.steps{list-style:none;counter-reset:s;margin:0;padding:0}ol.steps>li{counter-increment:s;display:grid;grid-template-columns:34px 1fr;gap:4px 12px;padding:14px 0;border-top:1px solid var(--line)}
ol.steps>li:first-child{border-top:0;padding-top:2px}ol.steps>li::before{content:counter(s);grid-row:span 4;width:34px;height:34px;border-radius:50%;background:var(--ink);color:var(--card);display:grid;place-items:center;font-weight:600;font-size:16px}
.act{font-weight:600;margin:4px 0 0}.lcdrow{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 2px}
.lcd{font:500 20px/1 "IBM Plex Mono",ui-monospace,monospace;background:var(--lcd);color:var(--lcd-ink);border-radius:10px;padding:9px 12px;letter-spacing:.04em;display:inline-flex;align-items:baseline;gap:8px}
.lcd small{font-size:13px;letter-spacing:0}.ex{align-self:center;font-size:13px;color:var(--ink2)}.fl{margin:2px 0 0;color:var(--ink2);font-size:15px}.fl b{color:var(--ink);font-weight:600}.hint{margin:4px 0 0}
.o3{font-size:14px;color:var(--warn)}.cta{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 16px;margin:24px 0}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 20px;border-radius:12px;background:var(--btn);color:var(--on-btn);font-weight:600;text-decoration:none;margin-top:6px}
ul.ml{list-style:none;padding:0;margin:0;columns:2 260px;column-gap:24px}ul.ml li{break-inside:avoid;padding:7px 0;border-top:1px solid var(--line)}ul.ml li span{display:block;font-size:14px;color:var(--ink2)}
.muted{color:var(--ink2);font-size:15px}footer{padding:24px 0 40px;color:var(--ink2);font-size:15px}footer .wm{height:18px;margin-bottom:8px}
@media (max-width:520px){h1{font-size:25px}ul.ml{columns:1}}
CSS;

  /** Сторінка: html або null (немає такої моделі). $base — SITE_BASE, $site — абсолютна адреса сайту з / в кінці. */
  public static function render(string $lang, string $slug, string $base, string $site, string $kind = 'm'): ?string {
    if ($kind === 'c') return class_exists('Calc') && class_exists('Providers') ? Calc::render($lang, $slug, $base, $site, self::$q) : null;
    if ($kind === 'h' || $kind === 'p' || $kind === 'k') {
      if (!class_exists('Providers')) return null;
      $x = $kind === 'h' ? self::renderHrom($lang, $slug, $base, $site) : ($kind === 'k' ? self::renderKom($lang, $slug, $base, $site) : self::renderProv($lang, $slug, $base, $site));
      return $x === null ? null : self::crumbs($x);
    }
    $ru = $lang === 'ru'; $e = [self::class, 'e'];
    $m = $slug !== '' ? self::model($slug) : null; if ($slug !== '' && !$m) return null;
    $abs = fn(string $l, string $s = '') => rtrim($site, '/') . self::url($l, $s);
    if ($m) { $P = $m[$lang]; $title = $P['title']; $desc = $P['desc']; }
    else {
      $n = count(self::data()['models'] ?? []);
      $title = $ru ? "Как снять показания теплосчётчика — $n моделей по шагам" : "Як зняти показання теплолічильника — $n моделей покроково";
      $desc = $ru ? "Найдите свой теплосчётчик по надписи на вычислителе: Sharky, ULTRAHEAT T330, Multical, SENSOSTAR, QALCOSONIC и другие — какие кнопки нажимать и где нужные цифры."
        : "Знайдіть свій теплолічильник за написом на обчислювачі: Sharky, ULTRAHEAT T330, Multical, SENSOSTAR, QALCOSONIC та інші — які кнопки натискати й де потрібні цифри.";
    }
    $other = $ru ? 'uk' : 'ru';
    $h = '<!DOCTYPE html><html lang="' . $lang . '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' .
      '<title>' . $e($title) . '</title><meta name="description" content="' . $e($desc) . '"><meta name="robots" content="index, follow">' .
      '<link rel="canonical" href="' . $e($abs($lang, $slug)) . '"><link rel="alternate" hreflang="uk" href="' . $e($abs('uk', $slug)) . '"><link rel="alternate" hreflang="ru" href="' . $e($abs('ru', $slug)) . '">' .
      '<link rel="alternate" hreflang="x-default" href="' . $e($abs('uk', $slug)) . '"><link rel="icon" href="' . $e($base) . '/web/icon/favicon.svg" type="image/svg+xml">' .
      '<meta property="og:type" content="article"><meta property="og:title" content="' . $e($title) . '"><meta property="og:description" content="' . $e($desc) . '"><meta property="og:url" content="' . $e($abs($lang, $slug)) . '">' .
      '<meta property="og:image" content="' . $e($site . 'web/og-' . $lang . '-5.jpg') . '"><meta property="og:locale" content="' . ($ru ? 'ru_UA' : 'uk_UA') . '">' .
      '<link rel="stylesheet" href="' . $e($base) . '/web/fonts/fonts.css"><style>' . self::CSS . '</style>';
    if ($m) {
      $ld = ['@context' => 'https://schema.org', '@type' => 'HowTo', 'name' => $P['h1'], 'description' => $desc, 'inLanguage' => $lang,
        'step' => array_values(array_map(fn($s, $i) => ['@type' => 'HowToStep', 'position' => $i + 1, 'name' => $s['a'], 'text' => trim(($s['f'] ? implode(', ', $s['f']) . '. ' : '') . $s['h'])], $P['steps'], array_keys($P['steps'])))];
      $h .= '<script type="application/ld+json">' . json_encode($ld, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) . '</script>';
    }
    $h .= '</head><body><header><div class="w"><a class="home" href="' . $e($base) . '/"><img src="' . $e($base) . '/web/icon/favicon.svg" alt="">' . self::wordmark() . '</a>' .
      '<a class="lng" href="' . $e($base . self::url($other, $slug)) . '" hreflang="' . $other . '" lang="' . $other . '">' . ($ru ? 'Українською' : 'Русский') . '</a></div></header><main class="w">';
    $idx = $base . self::url($lang);
    if ($m) {
      $h .= '<nav class="bc" aria-label="' . ($ru ? 'Навигация' : 'Навігація') . '"><a href="' . $e($base) . '/">передай</a> › <a href="' . $e($idx) . '">' . ($ru ? 'Как снять показания' : 'Як зняти показання') . '</a></nav>' .
        '<h1>' . $e($P['h1']) . '</h1>' . ($P['sub'] !== '' ? '<p class="sub">' . $e($P['sub']) . '</p>' : '') .
        ($P['status'] !== '' ? '<p><span class="pill ' . $e($m['status']) . '">' . $e($P['status']) . '</span></p>' : '');
      if ($P['where'] !== '') $h .= '<p><b>' . ($ru ? 'Как узнать модель. ' : 'Як упізнати модель. ') . '</b>' . $e($P['where']) . '</p>';
      $h .= '<p class="muted">' . ($ru ? 'Энергия на табло — в ' : 'Енергія на табло — в ') . $e($P['units']) . ($P['units'] === 'Гкал' ? '.' : ($ru ? '. ХТМ принимает Гкал — приложение пересчитает само.' : '. ХТМ приймає Гкал — застосунок перерахує сам.')) . '</p>';
      $h .= '<section class="card"><h2>' . ($ru ? 'По шагам' : 'Покроково') . '</h2><ol class="steps">';
      foreach ($P['steps'] as $s) {
        $lcd = ''; if ($s['d'] && $s['d']['v'] !== '') {
          $one = fn($d) => '<span class="lcd" aria-hidden="true">' . $e($d['v']) . ($d['u'] !== '' ? '<small>' . $e($d['u']) . '</small>' : '') . '</span>';
          $lcd = '<div class="lcdrow">' . $one($s['d']) . ($s['d']['alt'] ? $one($s['d']['alt']) : '') . '<span class="ex">' . ($ru ? 'пример экрана' : 'приклад екрана') . '</span></div>';
        }
        $h .= '<li><p class="act">' . $e($s['a']) . '</p>' . $lcd .
          ($s['f'] ? '<p class="fl">' . ($ru ? 'Записать: ' : 'Записати: ') . '<b>' . $e(implode(', ', $s['f'])) . '</b></p>' : '') .
          ($s['h'] !== '' ? '<p class="hint">' . $e($s['h']) . '</p>' : '') .
          ($s['only3'] ? '<p class="o3">' . ($ru ? 'Только если в кабинете ХТМ три колонки времени (Bd, Fd, Pd).' : 'Лише якщо в кабінеті ХТМ три колонки часу (Bd, Fd, Pd).') . '</p>' : '') . '</li>';
      }
      $h .= '</ol></section>';
      if ($P['loops'] !== '') $h .= '<section class="card"><h2>' . ($ru ? 'Не видите нужного экрана?' : 'Не бачите потрібного екрана?') . '</h2><p>' . $e($P['loops']) . '</p></section>';
      if ($P['note'] !== '') $h .= '<p class="muted"><b>' . ($ru ? 'Откуда инструкция. ' : 'Звідки інструкція. ') . '</b>' . $e($P['note']) . '</p>';
    } else {
      $h .= '<nav class="bc"><a href="' . $e($base) . '/">передай</a></nav><h1>' . ($ru ? 'Как снять показания теплосчётчика' : 'Як зняти показання теплолічильника') . '</h1>' .
        '<p class="sub">' . ($ru ? 'Найдите модель по надписи на вычислителе (корпус с экраном и кнопкой). Для каждой — какую кнопку и сколько раз нажимать и что записать: энергию, объём, температуры, часы работы. Список — типы, которые принимают ХТМ и другие поставщики тепла.'
          : 'Знайдіть модель за написом на обчислювачі (корпус з екраном і кнопкою). Для кожної — яку кнопку й скільки разів натискати і що записати: енергію, обсяг, температури, години роботи. Список — типи, які приймають ХТМ та інші постачальники тепла.') . '</p>';
    }
    $cta = '<section class="cta"><h2>' . ($ru ? 'Проще — в приложении «передай»' : 'Простіше — у застосунку «передай»') . '</h2><p>' .
      ($ru ? 'Проведёт по этим шагам с картинкой табло, распознает цифры с фото прямо в телефоне, сверит с прошлыми показаниями и подскажет, куда и до какого числа передать. Бесплатно.'
        : 'Проведе цими кроками з картинкою табло, розпізнає цифри з фото прямо в телефоні, звірить з минулими показаннями й підкаже, куди й до якого числа передати. Безкоштовно.') .
      '</p><a class="btn" href="' . $e($base) . '/">' . ($ru ? 'Внести показания' : 'Внести показання') . '</a></section>';
    if ($m) $h .= $cta;
    $h .= '<section><h2>' . ($m ? ($ru ? 'Другие модели' : 'Інші моделі') : ($ru ? 'Модели' : 'Моделі')) . '</h2><ul class="ml">';
    foreach (self::data()['models'] ?? [] as $x) {
      if ($m && $x['slug'] === $m['slug']) continue;
      $h .= '<li><a href="' . $e($base . self::url($lang, $x['slug'])) . '">' . $e($x['name']) . '</a><span>' . $e(trim($x['vendor'] . ($x['status'] !== 'verified' && !$m ? ' · ' . $x[$lang]['status'] : ''), ' ·')) . '</span></li>';
    }
    $h .= '</ul></section>' . ($m ? '' : $cta) . '</main><footer><div class="w">' . self::wordmark() . '<p>' . ($ru ? 'Показания света, воды, газа и тепла — бесплатно, без рекламы. Сервис независимый, не связан с поставщиками.'
      : 'Показання світла, води, газу й тепла — безкоштовно, без реклами. Сервіс незалежний, не пов’язаний з постачальниками.') . '</p></div></footer></body></html>';
    return self::crumbs($h);
  }

  /** 154-а: хлібні крихти для пошуку (schema.org BreadcrumbList) — з видимих `nav.bc` і h1 сторінки; адреси абсолютні, від canonical, без #якорів.
   *  Google показує їх у видачі замість голої адреси. */
  public static function crumbs(string $h): string {
    if (strpos($h, 'BreadcrumbList') !== false) return $h;
    if (!preg_match('~<link rel="canonical" href="([^"]+)"~', $h, $cm) || !preg_match('~<nav class="bc"[^>]*>(.*?)</nav>~s', $h, $nm)) return $h;
    $canon = html_entity_decode($cm[1], ENT_QUOTES, 'UTF-8'); $u0 = parse_url($canon);
    if (empty($u0['scheme']) || empty($u0['host'])) return $h;
    $origin = $u0['scheme'] . '://' . $u0['host'] . (isset($u0['port']) ? ':' . $u0['port'] : '');
    $txt = fn(string $x) => trim(preg_replace('~\s+~u', ' ', html_entity_decode(strip_tags($x), ENT_QUOTES, 'UTF-8')));
    $items = [];
    preg_match_all('~<a href="([^"]*)"[^>]*>(.*?)</a>~s', $nm[1], $am, PREG_SET_ORDER);
    foreach ($am as $a) {
      $u = preg_replace('~#.*$~', '', html_entity_decode($a[1], ENT_QUOTES, 'UTF-8'));
      $abs = preg_match('~^https?://~', $u) ? $u : $origin . '/' . ltrim($u, '/');
      if ($txt($a[2]) !== '') $items[] = [$txt($a[2]), $abs];
    }
    if (preg_match('~<h1[^>]*>(.*?)</h1>~s', $h, $hm) && $txt($hm[1]) !== '') $items[] = [$txt($hm[1]), $canon];
    if (count($items) < 2) return $h;
    $ld = ['@context' => 'https://schema.org', '@type' => 'BreadcrumbList',
      'itemListElement' => array_map(fn($x, $i) => ['@type' => 'ListItem', 'position' => $i + 1, 'name' => $x[0], 'item' => $x[1]], $items, array_keys($items))];
    $s = '<script type="application/ld+json">' . json_encode($ld, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) . '</script>';
    $i = strpos($h, '</head>');
    return $i === false ? $h : substr($h, 0, $i) . $s . substr($h, $i);
  }

  /** index.php: віддати сторінку з заголовками. */
  public static function send(string $html, bool $form = false): void {
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: ' . ($form && self::$q ? 'private, max-age=0' : 'public, max-age=3600'));   // 170-а: калькулятор з параметрами — не кешувати спільно
    header("Content-Security-Policy: default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action " . ($form ? "'self'" : "'none'"));
    echo $html;
  }
}
