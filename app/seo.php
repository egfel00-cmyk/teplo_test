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
  private static ?array $data = null;

  public static function data(): array {
    if (self::$data === null) { $j = json_decode((string)@file_get_contents(__DIR__ . '/data/seo/models.json'), true); self::$data = is_array($j) ? $j : ['models' => []]; }
    return self::$data;
  }
  /** Адреса → [lang, slug|'', 'm'|'h'] або null. */
  public static function match(string $path): ?array {
    $p = rtrim($path, '/');
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
    if (class_exists('Providers')) { $o[] = [self::HUK, self::HRU]; foreach (self::hroms() as $sl => $x) $o[] = [self::HUK . '/' . $sl, self::HRU . '/' . $sl]; }
    return $o;
  }

  // ---------------- громади: «Куди передати показання — <центр громади>» ----------------
  private const RG = ['kh' => ['Харківська обл.', 'Харьковская обл.'], 'kv' => ['Київська обл.', 'Киевская обл.'], 'ky' => ['м. Київ', 'г. Киев'], 'od' => ['Одеська обл.', 'Одесская обл.'],
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
  private static function money($v): string { return number_format((float)$v, 2, ',', ' '); }
  /** Нотатка довідника без вказівок до кнопок застосунку («натисніть…», «впишіть свій…») — на сторінці вони не до речі. */
  private static function clean(string $t): string {
    $parts = preg_split('/(?<=[.!?])\s+/u', trim($t)) ?: [];
    return implode(' ', array_filter($parts, fn($x) => !preg_match('/натисн|нажм|впиш|застосунк|приложени|«У мене|«У меня/ui', $x)));
  }
  private static function kindCard(string $k, array $o, string $hid, bool $ru): string {
    $e = [self::class, 'e']; $L = fn($f) => (string)($ru && !empty($o[$f . '_ru']) ? $o[$f . '_ru'] : ($o[$f] ?? ''));
    $org = trim((string)($o['org'] ?? '')); if ($org === '') return '';
    $rows = [];
    if ($k === 'elec' && !empty($o['net'])) $rows[] = ($ru ? 'Оператор сети: ' : 'Оператор мережі: ') . $o['net'];
    if ($k === 'gas' && !empty($o['grm'])) $rows[] = ($ru ? 'Доставка (оператор сети): ' : 'Доставка (оператор мережі): ') . $o['grm'] . (!empty($o['dist']) ? ' — ' . self::money($o['dist']) . ($ru ? ' грн за 1 м³ годовой мощности' : ' грн за 1 м³ річної потужності') . (!empty($o['distFrom']) ? ($ru ? ' с ' : ' з ') . date('d.m.Y', strtotime((string)$o['distFrom'])) : '') : '');
    $from = !empty($o['from']) ? ($ru ? ', с ' : ', з ') . date('d.m.Y', strtotime((string)$o['from'])) : '';
    if ($k === 'water' && !empty($o['supply'])) $rows[] = ($ru ? 'Тариф: вода ' : 'Тариф: вода ') . self::money($o['supply']) . (!empty($o['drain']) ? ($ru ? ', стоки ' : ', водовідведення ') . self::money($o['drain']) : '') . ($ru ? ' грн за м³' : ' грн за м³') . $from;
    if ($k === 'heat' && !empty($o['price'])) $rows[] = ($ru ? 'Тариф: ' : 'Тариф: ') . self::money($o['price']) . ($ru ? ' грн за Гкал' : ' грн за Гкал') . $from;
    if ($k === 'waste' && !empty($o['price'])) $rows[] = ($ru ? 'Плата: ' : 'Плата: ') . self::money($o['price']) . ($ru ? ' грн в месяц' : ' грн на місяць') . (!empty($o['priv']) ? ($ru ? ' (частный сектор — ' : ' (приватний сектор — ') . self::money($o['priv']) . ')' : '') . $from;
    $via = (string)($o['via'] ?? '');
    $w = self::win(isset($o['win']) && is_array($o['win']) ? $o['win'] : ($via === 'htm' ? [5, 25] : ($via === 'hvk' ? [1, 20] : ($k === 'gas' && empty($o['how']) ? [1, 5] : null))), isset($o['till']) ? (int)$o['till'] : null, $ru);
    if ($w !== '' && $k !== 'waste') $rows[] = ($ru ? 'Показания: ' : 'Показання: ') . $w;
    $h = '<section class="card kc"><h2>' . $e(self::KN[$k][$ru ? 1 : 0]) . '</h2><p class="org">' . $e($org) . '</p>' . implode('', array_map(fn($r) => '<p class="row">' . $e($r) . '</p>', $rows));
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
      $title = ($ru ? "Куда передать показания — $cn ($rg): свет, вода, газ, тепло" : "Куди передати показання — $cn ($rg): світло, вода, газ, тепло");
      $desc = ($ru ? "Поставщики, тарифы и сроки подачи показаний в $cn" : "Постачальники, тарифи й строки подачі показань у $cn") . ': ' . implode(', ', array_slice($orgs, 0, 4)) . '.';
      $h1 = ($ru ? 'Куда передать показания — ' : 'Куди передати показання — ') . $cn;
    } else {
      $title = $ru ? 'Куда передать показания счётчиков — 350 громад, 6 областей' : 'Куди передати показання лічильників — 350 громад, 6 областей';
      $desc = $ru ? 'Поставщики света, воды, газа, тепла и вывоза мусора, тарифы и сроки подачи показаний по громадам Харьковской, Киевской, Одесской, Львовской, Хмельницкой областей и Киева.'
        : 'Постачальники світла, води, газу, тепла й вивозу сміття, тарифи та строки подачі показань за громадами Харківської, Київської, Одеської, Львівської, Хмельницької областей і Києва.';
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
      foreach (['elec', 'water', 'gas', 'heat', 'waste'] as $k) if (!empty($kd[$k]) && is_array($kd[$k])) $h .= self::kindCard($k, $kd[$k], $hid, $ru);
      if (!empty($kd['heat']['org'])) $h .= '<p><a href="' . $e($base . self::url($lang)) . '">' . ($ru ? 'Как снять показания теплосчётчика — по моделям' : 'Як зняти показання теплолічильника — за моделями') . '</a></p>';
      $h .= $cta . '<p class="muted"><a href="' . $e($idx . '#' . $r) . '">' . ($ru ? 'Другие громады — ' : 'Інші громади — ') . $e($rg) . '</a></p>';
    } else {
      $h .= '<nav class="bc"><a href="' . $e($base) . '/">передай</a></nav><h1>' . $e($h1) . '</h1><p class="sub">' . $e($desc) . '</p>';
      $by = []; foreach ($hs as $sl => $y) $by[$y[1]][$sl] = $y;
      foreach (array_keys(self::RG) as $r) {
        if (empty($by[$r])) continue; $l = $by[$r]; uasort($l, fn($a, $b) => strcmp(mb_strtolower($a[2]), mb_strtolower($b[2])));
        $h .= '<section id="' . $r . '"><h2>' . $e(self::RG[$r][$ru ? 1 : 0]) . '</h2><ul class="ml">' . implode('', array_map(fn($sl, $y) => '<li><a href="' . $e($idx . '/' . $sl) . '">' . $e($y[2]) . '</a><span>' . $e($y[3] !== '' ? $y[3] . ' громада' : '') . '</span></li>', array_keys($l), $l)) . '</ul></section>';
      }
      $h .= $cta;
    }
    return $h . '</main><footer><div class="w">' . self::wordmark() . '<p>' . ($ru ? 'Данные — из решений местных советов, сайтов и договоров поставщиков; у каждой строки — источник. Нашли ошибку — напишите через «Отзыв» в приложении.'
      : 'Дані — з рішень місцевих рад, сайтів і договорів постачальників; у кожного рядка — джерело. Знайшли помилку — напишіть через «Відгук» у застосунку.') . '</p></div></footer></body></html>';
  }

  private static function e(string $s): string { return htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
  private static function wordmark(): string {
    $w = self::data()['wm'] ?? null; if (!$w) return '<b>передай</b>';
    return '<svg class="wm" viewBox="' . self::e((string)$w['vb']) . '" role="img" aria-label="передай"><defs><linearGradient id="wmg" gradientUnits="userSpaceOnUse" x1="' . (float)$w['g'][0] . '" y1="0" x2="' . (float)$w['g'][1] . '" y2="0">' .
      '<stop offset="0" stop-color="#FF6A1F"/><stop offset=".5" stop-color="#B44DFF"/><stop offset="1" stop-color="#2E86FF"/></linearGradient></defs>' .
      '<path fill="currentColor" d="' . self::e((string)$w['d']) . '"/><path fill="none" stroke="url(#wmg)" stroke-width="' . (float)$w['bw'] . '" stroke-linecap="round" d="' . self::e((string)$w['b']) . '"/></svg>';
  }
  private const CSS = <<<'CSS'
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
    if ($kind === 'h') return class_exists('Providers') ? self::renderHrom($lang, $slug, $base, $site) : null;
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
    return $h;
  }

  /** index.php: віддати сторінку з заголовками. */
  public static function send(string $html): void {
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: public, max-age=3600');
    header("Content-Security-Policy: default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'");
    echo $html;
  }
}
