<?php
// 170-а (розбір конкурентів, «Взять» п. 2: калькулятори сторінками): «Калькулятор води / світла / газу» — сервером, без скриптів (як app/seo.php).
//   /kalkulyator            — список (uk)        /ru/kalkulyator            — (ru)
//   /kalkulyator/voda       — вода громади: холодна (вода + водовідведення), гаряча (тариф гарячої + водовідведення того ж кубометра) — правила КМУ № 690
//   /kalkulyator/svitlo     — світло: одна зона, день/ніч (ніч ×0,5), три зони (пік ×1,5, напівпік ×1, ніч ×0,4) за ціною для населення (ru — /svet)
//   /kalkulyator/gaz        — газ за ціною Нафтогазу + доставка (розподіл): річна замовлена потужність ÷ 12 × тариф оператора ГРМ громади
// Форма — GET на ту саму сторінку (CSP form-action 'self'); з параметрами — noindex (canonical — без них). Тарифи — живцем з довідника
// (Providers::kinds громади, national — світло й газ), підстава ціни — як у картках громад (doc).
declare(strict_types=1);
defined('TEPLO') || exit;

final class Calc {
  public const UK = '/kalkulyator', RU = '/ru/kalkulyator';
  /** id (= uk-адреса) → [uk-адреса, ru-адреса] */
  public const PAGES = ['voda' => ['voda', 'voda'], 'svitlo' => ['svitlo', 'svet'], 'gaz' => ['gaz', 'gaz']];
  /** коефіцієнти зон світла (як El.COEF у web/src/elec.js) */
  public const ZONES = [1 => ['all' => 1], 2 => ['day' => 1, 'night' => 0.5], 3 => ['peak' => 1.5, 'half' => 1, 'night' => 0.4]];

  /** Адреса без мови → id або null. */
  public static function id(string $lang, string $slug): ?string {
    if ($slug === '') return '';
    foreach (self::PAGES as $id => $p) if ($p[$lang === 'ru' ? 1 : 0] === $slug) return $id;
    return null;
  }
  public static function url(string $lang, string $id = ''): string { return ($lang === 'ru' ? self::RU : self::UK) . ($id !== '' ? '/' . self::PAGES[$id][$lang === 'ru' ? 1 : 0] : ''); }
  /** Для sitemap.xml: [[uk, ru]]. */
  public static function pairs(): array { $o = [[self::UK, self::RU]]; foreach (array_keys(self::PAGES) as $id) $o[] = [self::url('uk', $id), self::url('ru', $id)]; return $o; }

  /** Число з поля: «5,5» → 5.5; порожнє чи поза межами — null. */
  public static function num($v, float $max = 100000): ?float {
    if (!is_scalar($v)) return null; $s = str_replace([' ', "\u{00A0}", ','], ['', '', '.'], trim((string)$v));
    if ($s === '' || !is_numeric($s)) return null; $n = (float)$s; return $n >= 0 && $n <= $max ? $n : null;
  }
  private static function m(float $v): string { return number_format(round($v + 1e-9, 2), 2, ',', ' '); }
  private static function q(float $v): string { $s = rtrim(rtrim(number_format($v, 3, ',', ' '), '0'), ','); return $s === '' ? '0' : $s; }
  private static function lc(string $s): string { return mb_strtolower(mb_substr($s, 0, 1)) . mb_substr($s, 1); }

  /** Вода: c, g — м³ холодної й гарячої; ціни — з довідника, свої (s, d, t) — главніші. → рядки й разом. */
  public static function water(?float $c, ?float $g, array $w, array $own = []): array {
    $s = $own['s'] ?? (isset($w['supply']) && $w['supply'] > 0 ? (float)$w['supply'] : null);
    $d = $own['d'] ?? (array_key_exists('drain', $w) && $w['drain'] !== null ? (float)$w['drain'] : null);
    $t = $own['t'] ?? (isset($w['hot']) && $w['hot'] > 0 ? (float)$w['hot'] : null);
    $c = $c ?? 0.0; $g = $g ?? 0.0; $rows = []; $need = [];
    if ($c > 0) { if ($s !== null) $rows[] = ['cold', $c, $s, $c * $s]; else $need[] = 's'; }
    if ($g > 0) { if ($t !== null) $rows[] = ['hot', $g, $t, $g * $t]; else $need[] = 't'; }
    // КМУ № 690: обсяг водовідведення — уся вода квартири, холодна й гаряча (централізоване ГВП)
    if ($c + $g > 0) { if ($d !== null) { if ($d > 0) $rows[] = ['drain', $c + $g, $d, ($c + $g) * $d]; } else $need[] = 'd'; }
    return ['rows' => $rows, 'total' => array_sum(array_column($rows, 3)), 'need' => $need, 'p' => ['s' => $s, 'd' => $d, 't' => $t]];
  }
  /** Світло: z — зони, v — кВт·год по зонах, p — ціна за кВт·год. */
  public static function elec(int $z, array $v, float $p): array {
    $rows = []; foreach (self::ZONES[$z] ?? [] as $k => $k0) { $q = (float)($v[$k] ?? 0); if ($q > 0) $rows[] = [$k, $q, $p * $k0, $q * $p * $k0, $k0]; }
    return ['rows' => $rows, 'total' => array_sum(array_column($rows, 3))];
  }
  /** Газ: m — м³ за місяць, p — ціна; доставка — річна потужність cap ÷ 12 × тариф dist (щомісяця однаково). */
  public static function gas(?float $m, float $p, ?float $cap, ?float $dist): array {
    $rows = []; if ($m !== null && $m > 0) $rows[] = ['gas', $m, $p, $m * $p];
    $dm = $cap !== null && $cap > 0 && $dist !== null && $dist > 0 ? round($cap / 12 * $dist, 2) : null;
    if ($dm !== null) $rows[] = ['dist', $cap, $dist, $dm];
    return ['rows' => $rows, 'total' => array_sum(array_column($rows, 3)), 'distMonth' => $dm];
  }

  /** Громади для вибору: slug → [назва, область], за областями й абеткою. */
  private static function hsel(string $sel, bool $ru): string {
    $by = []; foreach (Seo::hroms() as $sl => $y) $by[$y[1]][$sl] = $y;
    $h = '<select id="h" name="h">';
    foreach (array_keys(Seo::RG) as $r) {
      if (empty($by[$r])) continue; $l = $by[$r]; uasort($l, fn($a, $b) => strcmp(Seo::ukKey($a[2]), Seo::ukKey($b[2])));
      $h .= '<optgroup label="' . Seo::e(Seo::RG[$r][$ru ? 1 : 0]) . '">';
      foreach ($l as $sl => $y) $h .= '<option value="' . Seo::e($sl) . '"' . ($sl === $sel ? ' selected' : '') . '>' . Seo::e($y[2]) . '</option>';
      $h .= '</optgroup>';
    }
    return $h . '</select>';
  }
  private static function fld(string $id, string $label, ?float $v, string $unit, string $hint = '', string $name = ''): string {
    return '<p class="f"><label for="' . $id . '">' . Seo::e($label) . ($hint !== '' ? ' <span class="muted">' . Seo::e($hint) . '</span>' : '') . '</label><span class="ctl"><input id="' . $id . '" name="' . ($name !== '' ? $name : $id) .
      '" inputmode="decimal" autocomplete="off" value="' . ($v !== null ? Seo::e(self::q($v)) : '') . '"><span class="u">' . Seo::e($unit) . '</span></span></p>';
  }
  private static function kinds(string $slug): array {
    $x = Seo::hroms()[$slug] ?? null; if (!$x) return [];
    return Providers::kinds(['n' => $x[2], 'h' => $x[0], 'r' => $x[1]]);
  }

  /** Сторінка: html або null. $q — параметри запиту ($_GET). */
  public static function render(string $lang, string $slug, string $base, string $site, array $q = []): ?string {
    $id = self::id($lang, $slug); if ($id === null) return null;
    $ru = $lang === 'ru'; $e = [Seo::class, 'e']; $T = fn(string $uk, string $r) => $ru ? $r : $uk;
    $abs = fn(string $l) => rtrim($site, '/') . self::url($l, $id);
    $nat = (array)(Providers::data()['national'] ?? []); $res = ''; $form = ''; $note = ''; $asked = false;
    $line = fn(string $what, string $calc, float $sum) => '<li><span>' . $e($what) . '<small>' . $e($calc) . '</small></span><b>' . self::m($sum) . ' грн</b></li>';
    if ($id === '') {
      $title = $T('Калькулятори комуналки: вода, світло, газ — скільки платити за місяць', 'Калькуляторы коммуналки: вода, свет, газ — сколько платить за месяц');
      $desc = $T('Порахуйте платіжку за воду за тарифами своєї громади, світло за одно-, дво- й тризонним лічильником і газ разом із доставкою (розподілом). Безкоштовно, без реєстрації.',
        'Посчитайте платёжку за воду по тарифам своей громады, свет по одно-, двух- и трёхзонному счётчику и газ вместе с доставкой (распределением). Бесплатно, без регистрации.');
      $h1 = $T('Калькулятори комуналки', 'Калькуляторы коммуналки');
      $body = '<ul class="ml">' . implode('', array_map(fn($x) => '<li><a href="' . $e($base . self::url($lang, $x[0])) . '">' . $e($x[1]) . '</a><span>' . $e($x[2]) . '</span></li>', [
        ['voda', $T('Калькулятор води', 'Калькулятор воды'), $T('холодна, гаряча й водовідведення — тарифи 350 громад', 'холодная, горячая и водоотведение — тарифы 350 громад')],
        ['svitlo', $T('Калькулятор світла', 'Калькулятор света'), $T('одна зона, день/ніч, три зони', 'одна зона, день/ночь, три зоны')],
        ['gaz', $T('Калькулятор газу', 'Калькулятор газа'), $T('газ і доставка (розподіл) за потужністю', 'газ и доставка (распределение) по мощности')]])) . '</ul>';
    } elseif ($id === 'voda') {
      $hs = isset($q['h']) && is_string($q['h']) && isset(Seo::hroms()[$q['h']]) ? $q['h'] : 'kharkiv'; $kd = self::kinds($hs); $w = (array)($kd['water'] ?? []);
      $c = self::num($q['c'] ?? null, 10000); $g = self::num($q['g'] ?? null, 10000);
      $own = array_filter(['s' => self::num($q['s'] ?? null, 1000), 'd' => self::num($q['d'] ?? null, 1000), 't' => self::num($q['t'] ?? null, 1000)], fn($v) => $v !== null && $v > 0);
      $asked = $c !== null || $g !== null; $hn = Seo::hroms()[$hs][2] ?? '';
      $title = $T('Калькулятор води: скільки платити за холодну й гарячу воду — тарифи громад', 'Калькулятор воды: сколько платить за холодную и горячую воду — тарифы громад');
      $desc = $T('Порахуйте платіжку за воду: холодна (вода й водовідведення), гаряча й водовідведення за весь обсяг — за тарифами вашої громади з довідника «передай» (350 громад, у кожного тарифу — рішення).',
        'Посчитайте платёжку за воду: холодная (вода и водоотведение), горячая и водоотведение за весь объём — по тарифам вашей громады из справочника «передай» (350 громад, у каждого тарифа — решение).');
      $h1 = $T('Калькулятор води', 'Калькулятор воды');
      if ($asked) {
        $r = self::water($c, $g, $w, $own); $p = $r['p'];
        $nm = ['cold' => $T('Холодна вода', 'Холодная вода'), 'hot' => $T('Гаряча вода', 'Горячая вода'), 'drain' => $T('Водовідведення', 'Водоотведение')];
        $res = '<section class="card res" id="res"><h2>' . $e($T('Разом за місяць: ', 'Итого за месяц: ') . self::m($r['total']) . ' грн') . '</h2><p class="sub">' . $e($hn . ' — ' . ($w['org'] ?? $T('водоканал громади', 'водоканал громады'))) . '</p><ul class="rl">' .
          implode('', array_map(fn($x) => $line($nm[$x[0]], self::q($x[1]) . ' м³ × ' . self::m($x[2]) . ' грн', $x[3]), $r['rows'])) . '</ul>';
        if (in_array('d', $r['need'], true) || in_array('s', $r['need'], true) || in_array('t', $r['need'], true))
          $res .= '<p class="warn">' . $e($T('Не знаємо ціни ', 'Не знаем цены ') . implode(', ', array_map(fn($k) => ['s' => $T('води', 'воды'), 'd' => $T('водовідведення', 'водоотведения'), 't' => $T('гарячої води', 'горячей воды')][$k], $r['need'])) . $T(' для цієї громади — впишіть її з платіжки нижче й порахуйте ще раз.', ' для этой громады — впишите её из платёжки ниже и посчитайте ещё раз.')) . '</p>';
        if ($r['rows'] && in_array('drain', array_column($r['rows'], 0), true) && $g !== null && $g > 0)
          $res .= '<p class="muted">' . $e($T('Водовідведення рахують за весь обсяг води квартири — холодної й гарячої (Правила, затверджені постановою КМУ № 690).', 'Водоотведение считают за весь объём воды квартиры — холодной и горячей (Правила, утверждённые постановлением КМУ № 690).')) . '</p>';
        $dc = trim((string)($ru && !empty($w['doc_ru']) ? $w['doc_ru'] : ($w['doc'] ?? '')));
        if ($dc !== '' && empty($own['s'])) $res .= '<p class="muted">' . $e($T('Підстава: ', 'Основание: ') . self::lc($dc) . (!empty($w['from']) ? $T(', діє з ', ', действует с ') . date('d.m.Y', strtotime((string)$w['from'])) : '')) . '</p>';
        $nx = is_array($w['next'] ?? null) && !empty($w['next']['supply']) && empty($own['s']) ? $w['next'] : null;
        if ($nx) { $r2 = self::water($c, $g, ['supply' => $nx['supply'], 'drain' => $nx['drain'] ?? ($w['drain'] ?? null), 'hot' => $w['hot'] ?? null], $own);
          if (!$r2['need']) $res .= '<p>' . $e($T('З ', 'С ') . date('d.m.Y', strtotime((string)$nx['from'])) . $T(' — новий тариф: та сама вода коштуватиме ', ' — новый тариф: та же вода будет стоить ') . self::m($r2['total']) . ' грн.') . '</p>'; }
        $res .= '<p class="muted">' . $e($T('Абонентська плата й інші рядки платіжки сюди не входять.', 'Абонентская плата и другие строки платёжки сюда не входят.')) . '</p></section>';
      }
      $pf = fn($v) => $v !== null && $v > 0 ? self::m((float)$v) . ' грн' : $T('невідомо', 'неизвестно');
      $form = '<form class="card" method="get" action="#res"><p class="f"><label for="h">' . $T('Громада', 'Громада') . '</label>' . self::hsel($hs, $ru) . '</p>' .
        '<p class="muted">' . $e($T('За довідником для «' . $hn . '»: вода ', 'По справочнику для «' . $hn . '»: вода ') . $pf($w['supply'] ?? null) . $T(', водовідведення ', ', водоотведение ') . (array_key_exists('drain', $w) && $w['drain'] === 0 ? $T('немає', 'нет') : $pf($w['drain'] ?? null)) . $T(', гаряча ', ', горячая ') . $pf($w['hot'] ?? null) . $T(' за м³. Змінили громаду — натисніть «Порахувати».', ' за м³. Сменили громаду — нажмите «Посчитать».')) . '</p>' .
        '<div class="grid">' . self::fld('c', $T('Холодна вода', 'Холодная вода'), $c, 'м³', $T('за місяць', 'за месяц')) . self::fld('g', $T('Гаряча вода', 'Горячая вода'), $g, 'м³', $T('за місяць', 'за месяц')) . '</div>' .
        '<details' . ($own ? ' open' : '') . '><summary>' . $T('У платіжці інша ціна', 'В платёжке другая цена') . '</summary><div class="grid3">' .
        self::fld('s', $T('Вода', 'Вода'), $own['s'] ?? null, 'грн/м³') . self::fld('d', $T('Водовідведення', 'Водоотведение'), $own['d'] ?? null, 'грн/м³') . self::fld('t', $T('Гаряча вода', 'Горячая вода'), $own['t'] ?? null, 'грн/м³') . '</div></details>' .
        '<button class="btn" type="submit">' . $T('Порахувати', 'Посчитать') . '</button></form>';
      $note = '<section class="card"><h2>' . $T('Як рахується', 'Как считается') . '</h2><ul class="sm"><li>' .
        $T('Холодна: кожен кубометр — водопостачання плюс водовідведення.', 'Холодная: каждый кубометр — водоснабжение плюс водоотведение.') . '</li><li>' .
        $T('Гаряча: кубометр за тарифом гарячої води плюс водовідведення того ж кубометра.', 'Горячая: кубометр по тарифу горячей воды плюс водоотведение того же кубометра.') . '</li><li>' .
        $T('Споживання = нові показання − минулі, цілими кубометрами (чорні цифри водоміра).', 'Потребление = новые показания − прошлые, целыми кубометрами (чёрные цифры водомера).') . '</li></ul></section>';
    } elseif ($id === 'svitlo') {
      $ne = (array)($nat['elec'] ?? []); $p0 = (float)($ne['price'] ?? 4.32);
      $z = (int)($q['z'] ?? 0); $z = isset(self::ZONES[$z]) ? $z : 0; $p = self::num($q['p'] ?? null, 100) ?: $p0;
      $v = []; foreach (['all', 'day', 'night', 'peak', 'half'] as $k) $v[$k] = self::num($q[$k] ?? null, 100000);
      $asked = $z > 0 && array_filter(array_intersect_key($v, self::ZONES[$z]), fn($x) => $x !== null);
      $title = $T('Калькулятор світла: ' . self::m($p0) . ' грн за кВт·год, день/ніч і три зони', 'Калькулятор света: ' . self::m($p0) . ' грн за кВт·ч, день/ночь и три зоны');
      $desc = $T('Порахуйте платіжку за світло: однозонний лічильник, двозонний (ніч ×0,5) і тризонний (пік ×1,5, напівпік ×1, ніч ×0,4) за ціною для населення ' . self::m($p0) . ' грн за кВт·год.',
        'Посчитайте платёжку за свет: однозонный счётчик, двухзонный (ночь ×0,5) и трёхзонный (пик ×1,5, полупик ×1, ночь ×0,4) по цене для населения ' . self::m($p0) . ' грн за кВт·ч.');
      $h1 = $T('Калькулятор світла', 'Калькулятор света');
      $zn = ['all' => $T('Усього', 'Всего'), 'day' => $T('День', 'День'), 'night' => $T('Ніч', 'Ночь'), 'peak' => $T('Пік', 'Пик'), 'half' => $T('Напівпік', 'Полупик')];
      if ($asked) {
        $r = self::elec($z, $v, $p);
        $res = '<section class="card res" id="res"><h2>' . $e($T('Разом за місяць: ', 'Итого за месяц: ') . self::m($r['total']) . ' грн') . '</h2><ul class="rl">' .
          implode('', array_map(fn($x) => $line($zn[$x[0]], self::q($x[1]) . ($ru ? ' кВт·ч × ' : ' кВт·год × ') . self::m($x[2]) . ' грн' . ($x[4] != 1 ? ' (' . self::m($p) . ' × ' . str_replace('.', ',', (string)$x[4]) . ')' : ''), $x[3]), $r['rows'])) . '</ul>' .
          '<p class="muted">' . $e($T('Ціна для населення — ' . self::m($p0) . ' грн за кВт·год', 'Цена для населения — ' . self::m($p0) . ' грн за кВт·ч') . (!empty($ne['to']) ? $T(' до ', ' до ') . date('d.m.Y', strtotime((string)$ne['to'])) : '') . ' (' . self::lc((string)($ru && !empty($ne['src_ru']) ? $ne['src_ru'] : ($ne['src'] ?? ''))) . ').') . '</p></section>';
      }
      $f = fn(int $zz, string $ttl, array $ks) => '<form class="card" method="get" action="#res"><h2>' . $e($ttl) . '</h2><input type="hidden" name="z" value="' . $zz . '"><div class="grid' . (count($ks) > 2 ? '3' : '') . '">' .
        implode('', array_map(fn($k) => self::fld('z' . $zz . '-' . $k, $zn[$k], $z === $zz ? $v[$k] : null, $ru ? 'кВт·ч' : 'кВт·год', '', $k), $ks)) . '</div>' .
        '<button class="btn" type="submit">' . $T('Порахувати', 'Посчитать') . '</button></form>';
      $form = $f(1, $T('Однозонний лічильник', 'Однозонный счётчик'), ['all']) . $f(2, $T('Двозонний: день і ніч (23:00–07:00)', 'Двухзонный: день и ночь (23:00–07:00)'), ['day', 'night']) .
        $f(3, $T('Тризонний: пік, напівпік, ніч', 'Трёхзонный: пик, полупик, ночь'), ['peak', 'half', 'night']);
      $note = '<section class="card"><h2>' . $T('Як рахується', 'Как считается') . '</h2><ul class="sm"><li>' .
        $T('Споживання зони = нові показання − минулі (лише цифри до коми), кожну зону окремо, не суму (1.8.0).', 'Потребление зоны = новые показания − прошлые (только цифры до запятой), каждую зону отдельно, не сумму (1.8.0).') . '</li><li>' .
        $T('Двозонний: день за повною ціною, ніч (23:00–07:00) — ×0,5. Тризонний: пік ×1,5, напівпік ×1, ніч ×0,4.', 'Двухзонный: день по полной цене, ночь (23:00–07:00) — ×0,5. Трёхзонный: пик ×1,5, полупик ×1, ночь ×0,4.') . '</li><li>' .
        $T('Пільгу для будинків з електроопаленням тут не враховано.', 'Льготу для домов с электроотоплением здесь не учитываем.') . '</li></ul></section>';
    } else {   // gaz
      $ng = (array)($nat['gas'] ?? []); $p0 = (float)($ng['price'] ?? 7.96);
      $hs = isset($q['h']) && is_string($q['h']) && isset(Seo::hroms()[$q['h']]) ? $q['h'] : 'kharkiv'; $kg = (array)(self::kinds($hs)['gas'] ?? []); $hn = Seo::hroms()[$hs][2] ?? '';
      $m = self::num($q['m'] ?? null, 10000); $cap = self::num($q['cap'] ?? null, 100000); $p = self::num($q['p'] ?? null, 100) ?: $p0;
      $dist = self::num($q['dt'] ?? null, 100) ?: (isset($kg['dist']) && $kg['dist'] > 0 ? (float)$kg['dist'] : null);
      $asked = $m !== null || $cap !== null;
      $title = $T('Калькулятор газу: газ і доставка (розподіл) за місяць', 'Калькулятор газа: газ и доставка (распределение) за месяц');
      $desc = $T('Порахуйте платіжки за газ: кубометри за ціною Нафтогазу ' . self::m($p0) . ' грн і доставку оператору мережі — річна замовлена потужність ÷ 12 × тариф вашої громади.',
        'Посчитайте платёжки за газ: кубометры по цене Нафтогаза ' . self::m($p0) . ' грн и доставку оператору сети — годовая заказанная мощность ÷ 12 × тариф вашей громады.');
      $h1 = $T('Калькулятор газу', 'Калькулятор газа');
      if ($asked) {
        $r = self::gas($m, $p, $cap, $dist);
        $res = '<section class="card res" id="res"><h2>' . $e($T('Разом за місяць: ', 'Итого за месяц: ') . self::m($r['total']) . ' грн') . '</h2><ul class="rl">' .
          implode('', array_map(fn($x) => $x[0] === 'gas' ? $line($T('Газ — ', 'Газ — ') . ($ng['supplier'] ?? 'Нафтогаз'), self::q($x[1]) . ' м³ × ' . self::m($x[2]) . ' грн', $x[3])
            : $line($T('Доставка — ', 'Доставка — ') . ($kg['grm'] ?? $T('оператор мережі', 'оператор сети')), self::q($x[1]) . ' м³ ÷ 12 × ' . str_replace('.', ',', (string)$x[2]) . ' грн', $x[3]), $r['rows'])) . '</ul>';
        if ($r['distMonth'] === null) $res .= '<p class="warn">' . $e($cap === null ? $T('Доставку не пораховано: впишіть річну замовлену потужність з платіжки оператора мережі (Газмережі, Київгаз…).', 'Доставку не посчитали: впишите годовую заказанную мощность из платёжки оператора сети (Газсети, Киевгаз…).')
          : $T('Доставку не пораховано: тариф оператора мережі для цієї громади невідомий — впишіть його з платіжки.', 'Доставку не посчитали: тариф оператора сети для этой громады неизвестен — впишите его из платёжки.')) . '</p>';
        $res .= '<p class="muted">' . $e($T('Газ і доставку оплачують двома платіжками: Нафтогазу — за кубометри, оператору мережі — за потужність, однаково щомісяця (перерахунок з 1 січня).', 'Газ и доставку оплачивают двумя платёжками: Нафтогазу — за кубометры, оператору сети — за мощность, одинаково каждый месяц (перерасчёт с 1 января).')) . '</p></section>';
      }
      $form = '<form class="card" method="get" action="#res"><p class="f"><label for="h">' . $T('Громада', 'Громада') . '</label>' . self::hsel($hs, $ru) . '</p>' .
        '<p class="muted">' . $e($T('Для «' . $hn . '»: доставка — ', 'Для «' . $hn . '»: доставка — ') . ($kg['grm'] ?? $T('оператор невідомий', 'оператор неизвестен')) . (!empty($kg['dist']) ? ', ' . str_replace('.', ',', (string)$kg['dist']) . $T(' грн за 1 м³ річної потужності', ' грн за 1 м³ годовой мощности') : '') . $T('; газ — ', '; газ — ') . self::m($p0) . $T(' грн за м³ (', ' грн за м³ (') . ($ng['plan'] ?? '') . ').') . '</p>' .
        '<div class="grid">' . self::fld('m', $T('Газ за місяць', 'Газ за месяц'), $m, 'м³') . self::fld('cap', $T('Річна замовлена потужність', 'Годовая заказанная мощность'), $cap, 'м³', $T('з платіжки за доставку', 'из платёжки за доставку')) . '</div>' .
        '<details' . (self::num($q['p'] ?? null, 100) || self::num($q['dt'] ?? null, 100) ? ' open' : '') . '><summary>' . $T('У платіжці інша ціна', 'В платёжке другая цена') . '</summary><div class="grid">' .
        self::fld('p', $T('Газ', 'Газ'), self::num($q['p'] ?? null, 100), 'грн/м³') . self::fld('dt', $T('Доставка', 'Доставка'), self::num($q['dt'] ?? null, 100), $T('грн за м³ потужності', 'грн за м³ мощности')) . '</div></details>' .
        '<button class="btn" type="submit">' . $T('Порахувати', 'Посчитать') . '</button></form>';
      $note = '<section class="card"><h2>' . $T('Як рахується', 'Как считается') . '</h2><ul class="sm"><li>' .
        $T('Газ: кубометри за місяць (чорні цифри лічильника) × ціна постачальника.', 'Газ: кубометры за месяц (чёрные цифры счётчика) × цена поставщика.') . '</li><li>' .
        $T('Доставка (розподіл): річна замовлена потужність ÷ 12 × тариф оператора мережі — однаково щомісяця, навіть коли газом не користуєтесь.', 'Доставка (распределение): годовая заказанная мощность ÷ 12 × тариф оператора сети — одинаково каждый месяц, даже когда газом не пользуетесь.') . '</li></ul></section>';
    }
    $other = $ru ? 'uk' : 'ru'; $qs = $asked ? '?' . http_build_query(array_intersect_key($q, array_flip(['h', 'c', 'g', 's', 'd', 't', 'z', 'all', 'day', 'night', 'peak', 'half', 'p', 'm', 'cap', 'dt']))) : '';
    $h = '<!DOCTYPE html><html lang="' . $lang . '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' .
      '<title>' . $e($title) . '</title><meta name="description" content="' . $e($desc) . '"><meta name="robots" content="' . ($asked ? 'noindex, follow' : 'index, follow') . '">' .
      '<link rel="canonical" href="' . $e($abs($lang)) . '"><link rel="alternate" hreflang="uk" href="' . $e($abs('uk')) . '"><link rel="alternate" hreflang="ru" href="' . $e($abs('ru')) . '">' .
      '<link rel="alternate" hreflang="x-default" href="' . $e($abs('uk')) . '"><link rel="icon" href="' . $e($base) . '/web/icon/favicon.svg" type="image/svg+xml">' .
      '<meta property="og:type" content="website"><meta property="og:title" content="' . $e($title) . '"><meta property="og:description" content="' . $e($desc) . '"><meta property="og:url" content="' . $e($abs($lang)) . '">' .
      '<meta property="og:image" content="' . $e($site . 'web/og-' . $lang . '-5.jpg') . '"><meta property="og:locale" content="' . ($ru ? 'ru_UA' : 'uk_UA') . '">' .
      '<link rel="stylesheet" href="' . $e($base) . '/web/fonts/fonts.css"><style>' . Seo::CSS . self::CSS . '</style></head><body>' .
      '<header><div class="w"><a class="home" href="' . $e($base) . '/"><img src="' . $e($base) . '/web/icon/favicon.svg" alt="">' . Seo::wordmark() . '</a>' .
      '<a class="lng" href="' . $e($base . self::url($other, $id) . $qs) . '" hreflang="' . $other . '" lang="' . $other . '">' . ($ru ? 'Українською' : 'Русский') . '</a></div></header><main class="w">' .
      '<nav class="bc"><a href="' . $e($base) . '/">передай</a>' . ($id !== '' ? ' › <a href="' . $e($base . self::url($lang)) . '">' . $T('Калькулятори', 'Калькуляторы') . '</a>' : '') . '</nav><h1>' . $e($h1) . '</h1>' .
      ($id !== '' ? '<p class="sub">' . $e($desc) . '</p>' : '<p class="sub">' . $e($desc) . '</p>') . $res . $form . $note .
      '<section class="cta"><h2>' . $T('Порахує саме — з ваших показань', 'Посчитает само — из ваших показаний') . '</h2><p>' .
      $T('У «передай» внесіть показання з фото — сервіс сам порахує споживання й суму за тарифами вашої адреси, підкаже, куди й до якого числа передати, і нагадає про строк. Безкоштовно.',
        'В «передай» внесите показания с фото — сервис сам посчитает потребление и сумму по тарифам вашего адреса, подскажет, куда и до какого числа передать, и напомнит о сроке. Бесплатно.') .
      '</p><a class="btn" href="' . $e($base) . '/">' . $T('Внести показання', 'Внести показания') . '</a></section>' .
      '<p class="muted">' . implode(' · ', array_filter([$id !== 'voda' ? '<a href="' . $e($base . self::url($lang, 'voda')) . '">' . $T('Калькулятор води', 'Калькулятор воды') . '</a>' : '',
        $id !== 'svitlo' ? '<a href="' . $e($base . self::url($lang, 'svitlo')) . '">' . $T('Калькулятор світла', 'Калькулятор света') . '</a>' : '',
        $id !== 'gaz' ? '<a href="' . $e($base . self::url($lang, 'gaz')) . '">' . $T('Калькулятор газу', 'Калькулятор газа') . '</a>' : '',
        '<a href="' . $e($base . ($ru ? Seo::HRU : Seo::HUK)) . '">' . $T('Куди передати показання', 'Куда передать показания') . '</a>'])) . '</p>' .
      '</main><footer><div class="w">' . Seo::wordmark() . '<p>' . $T('Тарифи — з рішень місцевих рад і постанов уряду; у кожного — джерело. Сервіс незалежний, не пов’язаний з постачальниками. Розрахунок орієнтовний — звіряйте з платіжкою.',
        'Тарифы — из решений местных советов и постановлений правительства; у каждого — источник. Сервис независимый, не связан с поставщиками. Расчёт ориентировочный — сверяйте с платёжкой.') . '</p></div></footer></body></html>';
    return Seo::crumbs($h);
  }
  private const CSS = '.f{margin:10px 0}.f label{display:block;font-weight:600;margin:0 0 4px}.f label .muted{font-weight:400}.ctl{display:flex;align-items:center;gap:8px}' .
    '.ctl input,select{font:inherit;width:100%;min-height:48px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink)}.ctl input{font-variant-numeric:tabular-nums}' .
    '.u{color:var(--ink2);font-size:15px;white-space:nowrap}.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 14px}' .
    'button.btn{border:0;font:inherit;font-weight:600;cursor:pointer;margin-top:10px}details{margin:8px 0}details summary{cursor:pointer;color:var(--ink2);font-size:15px;min-height:32px}' .
    'ul.rl{list-style:none;margin:0;padding:0}ul.rl li{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--line)}ul.rl li:first-child{border-top:0}' .
    'ul.rl small{display:block;color:var(--ink2);font-size:15px}ul.rl b{white-space:nowrap;font-variant-numeric:tabular-nums}.res h2{font-size:24px}.warn{color:var(--warn)}' .
    'ul.sm{margin:0;padding-left:20px}ul.sm li{margin:4px 0}@media (max-width:520px){.grid3{grid-template-columns:1fr}.grid{grid-template-columns:1fr}}';
}
