<?php
declare(strict_types=1);

/** Постачальники й тарифи за адресою квартири — уся Харківська область.
 *  Адреса (з описками, укр. чи рос., зі старою назвою) → населений пункт КАТОТТГ (app/data/kh_katottg.json) → громада → по видах
 *  (світло, газ, вода, тепло) з довідника app/data/providers.json: oblast (уся область) ← hromadas[«громада»] ← settlements[«громада/пункт»].
 *  Неоднозначно (Миколаївка ×17) чи описка з кількома варіантами → candidates, людина уточнює (n + h).
 *  GET /api/providers?q=адреса[&n=назва пункту&h=код громади]. Адресу не зберігаємо. */
final class Providers {
  public static function file(): string { return (string)Cfg::get('providers_file', __DIR__ . '/data/providers.json'); }
  public static function katFile(): string { return (string)Cfg::get('katottg_file', __DIR__ . '/data/kh_katottg.json'); }
  private static ?array $d = null; private static ?array $k = null; private static ?array $ix = null;
  public static function data(): array {
    if (self::$d === null) { $j = json_decode((string)@file_get_contents(self::file()), true); self::$d = is_array($j) ? $j : ['national' => [], 'oblast' => [], 'hromadas' => []]; }
    return self::$d;
  }
  public static function kat(): array {
    if (self::$k === null) { $j = json_decode((string)@file_get_contents(self::katFile()), true); self::$k = is_array($j) && !empty($j['settlements']) ? $j : ['districts' => [], 'hromadas' => [], 'settlements' => []]; }
    return self::$k;
  }
  public static function reset(): void { self::$d = null; self::$k = null; self::$ix = null; }

  const STREET = '/\d|(^|\s)(вул|вулиця|ул|улица|пр|просп|проспект|пров|провулок|пер|переулок|пл|площа|площадь|бул|бульвар|узвіз|шосе|шоссе|майдан|тупик|набережна|набережная|мкр|мікрорайон|микрорайон|квартал|кв-л|спуск|проїзд|проезд|в\'їзд|въезд)(\.|\s|$)/u';
  const STREET_KW = 'вул|вулиця|ул|улица|пр|просп|проспект|пр-т|пров|провулок|пер|переулок|пл|площа|площадь|бул|бульвар|узвіз|шосе|шоссе|майдан|тупик|набережна|набережная|мкр|мікрорайон|микрорайон|квартал|кв-л|спуск|проїзд|проезд';
  /** Старі райони (до 2020) → нинішні: адреси досі пишуть «Дергачівський р-н». */
  const OLD_DISTRICTS = ['Балаклійський' => 'Ізюмський', 'Барвінківський' => 'Ізюмський', 'Близнюківський' => 'Лозівський', 'Борівський' => 'Ізюмський',
    'Валківський' => 'Богодухівський', 'Великобурлуцький' => 'Куп’янський', 'Вовчанський' => 'Чугуївський', 'Дворічанський' => 'Куп’янський',
    'Дергачівський' => 'Харківський', 'Зачепилівський' => 'Берестинський', 'Зміївський' => 'Чугуївський', 'Золочівський' => 'Богодухівський',
    'Кегичівський' => 'Берестинський', 'Коломацький' => 'Богодухівський', 'Красноградський' => 'Берестинський', 'Краснокутський' => 'Богодухівський',
    'Нововодолазький' => 'Харківський', 'Первомайський' => 'Лозівський', 'Печенізький' => 'Чугуївський', 'Сахновщинський' => 'Берестинський',
    'Шевченківський' => 'Куп’янський'];

  /** Скелет назви пункту без укр./рос. різниці й дрібниць: «Малая Даниловка» = «Мала Данилівка», «Чугуев» = «Чугуїв»,
   *  «Александровка» = «Олександрівка», «Балаклея» = «Балаклія», «Шевченково» = «Шевченкове», «Слатино» = «Слатине». */
  public static function nk(string $s): string {
    $s = mb_strtolower(trim($s));
    $s = str_replace(['ё', '’', 'ʼ', '`', '´', "'", '"', '«', '»'], ['е', '', '', '', '', '', '', '', ''], $s);
    $s = preg_replace(['/(?<!\p{L})алекс/u', '/(?<!\p{L})никол/u', '/(?<!\p{L})ольх/u', '/(?<!\p{L})ольш/u'], ['олекс', 'микол', 'вільх', 'вільш'], $s);
    $s = Gpv::skel((string)$s);
    $w = array_map(fn($x) => (string)preg_replace(['/[ое]вка$/u', '/[ое]в$/u', '/[ое]во$/u', '/ино$/u', '/ея$/u', '/ие$/u', '/([жчшщ])я$/u'],
      ['ивка', 'ив', 'ове', 'ине', 'ия', 'и', '$1а'], $x), explode(' ', $s));
    return trim(implode(' ', array_filter($w, fn($x) => $x !== '')));
  }
  public static function lev(string $a, string $b): int {
    if ($a === $b) return 0;
    $A = preg_split('//u', $a, -1, PREG_SPLIT_NO_EMPTY); $B = preg_split('//u', $b, -1, PREG_SPLIT_NO_EMPTY);
    $n = count($A); $m = count($B); if (abs($n - $m) > 3) return 99; $p = range(0, $m);
    for ($i = 1; $i <= $n; $i++) { $c = [$i]; for ($j = 1; $j <= $m; $j++) $c[$j] = min($p[$j] + 1, $c[$j - 1] + 1, $p[$j - 1] + ($A[$i - 1] === $B[$j - 1] ? 0 : 1)); $p = $c; }
    return $p[$m];
  }
  /** Скільки описок дозволяємо: auto — беремо сам (одна літера в 5–7, дві від 8); ask — лише пропонуємо уточнити. */
  private static function tol(string $k, bool $ask): int { $l = mb_strlen(str_replace(' ', '', $k)); return $l >= 8 ? ($ask ? 3 : 2) : ($l >= 5 ? ($ask ? 2 : 1) : ($ask && $l >= 4 ? 1 : 0)); }

  /** Індекс: скелет назви (і старих назв) → номери пунктів; скелети районів (нинішні й старі) і громад. */
  private static function ix(): array {
    if (self::$ix !== null) return self::$ix;
    $k = self::kat(); $by = []; $d = []; $h = [];
    foreach ((array)$k['settlements'] as $i => $s) foreach (array_merge([(string)$s['n']], (array)($s['old'] ?? [])) as $nm) { $key = self::nk($nm); if ($key !== '') $by[$key][] = $i; }
    foreach ((array)$k['districts'] as $id => $nm) $d[self::nk((string)$nm)] = (string)$id;
    $did = array_flip((array)$k['districts']);
    foreach (self::OLD_DISTRICTS as $o => $n) if (isset($did[$n])) $d[self::nk($o)] = (string)$did[$n];
    foreach ((array)$k['hromadas'] as $id => $x) $h[self::nk(self::hname((string)$id))] = (string)$id;
    return self::$ix = ['by' => $by, 'd' => $d, 'h' => $h];
  }
  /** Назва громади, як її пишуть зараз (у КАТОТТГ 2025 ще старі: Красноградська → Берестинська, Первомайська → Златопільська). */
  public static function hname(string $hid): string {
    $n = (string)(self::kat()['hromadas'][$hid]['n'] ?? ''); return ['Красноградська' => 'Берестинська', 'Первомайська' => 'Златопільська'][$n] ?? $n;
  }
  private static function typeOf(string $p): string {
    $p = preg_replace('/\s+/u', '', $p);
    if (in_array($p, ['м', 'г', 'місто', 'город'], true)) return 'M';
    if (in_array($p, ['смт', 'пгт', 'с-ще', 'селище', 'сел', 'поселок', 'пос', 'п'], true)) return 'X';
    return in_array($p, ['с', 'село'], true) ? 'C' : '';
  }
  /** Шматки адреси → кандидати назви пункту (strong — з «м.», «с.», «смт»), підказки району й громади. */
  public static function parse(string $addr): array {
    $a = mb_strtolower(str_replace(["\n", "\r", '№', "\t"], [',', ',', ' ', ' '], $addr));
    $segs = array_values(array_filter(array_map(fn($x) => trim($x, " .\t"), preg_split('/[,;]/u', $a)), fn($x) => $x !== ''));
    $c = []; $hd = []; $hh = []; $first = null; $firstStreet = false;
    foreach ($segs as $s) {
      if (preg_match('/^(україна|украина|ukraine)$/u', $s) || preg_match('/^\d{5}$/u', $s) || preg_match('/(^|\s)(обл|область|обл\.)(\.|\s|$)/u', $s)) continue;
      if (preg_match('/^(.+?)\s*(?:р-н|р-он|район|р\.\s*н|р)\.?$/u', $s, $m) || preg_match('/^(?:р-н|район)\.?\s+(.+)$/u', $s, $m)) { $hd[] = self::nk($m[1]); continue; }
      if (preg_match('/^(.+?)\s+(?:(?:міська|селищна|сільська|городская|поселковая|сельская)\s+)?(?:(?:територіальна|территориальная)\s+)?(?:громада|тг|отг|рада|сільрада|сельсовет|община)$/u', $s, $m)) { $hh[] = self::nk($m[1]); continue; }
      $isFirst = $first === null; if ($isFirst) $first = $s;
      if (preg_match('/^(м|г|місто|город|смт|пгт|с\s*-\s*ще|селище|сел|поселок|пос|п|с|село)(?:\.\s*|\s+)(.+)$/u', $s, $m)) {
        $nm = self::cutStreet($m[2]); if ($nm !== '' && !preg_match('/\d/u', $nm)) $c[] = ['n' => $nm, 't' => self::typeOf($m[1]), 'strong' => true, 'fuzzy' => true];
        continue;
      }
      if (preg_match(self::STREET, $s)) {
        if ($isFirst) $firstStreet = true;
        // «Мала Данилівка вул. Академічна 5» — назва пункту перед вулицею без коми (лише точний збіг)
        if (preg_match('/^(\p{L}[\p{L}\s\'’ʼ\-]*?)\s+(?:' . self::STREET_KW . ')(?:\.|\s)/u', $s, $m) && !preg_match('/^(' . self::STREET_KW . ')$/u', trim($m[1]))) $c[] = ['n' => trim($m[1]), 't' => '', 'strong' => false, 'fuzzy' => false];
        continue;
      }
      $c[] = ['n' => $s, 't' => '', 'strong' => false, 'fuzzy' => $isFirst];
    }
    return ['c' => $c, 'd' => $hd, 'h' => $hh, 'firstStreet' => $firstStreet];
  }
  private static function cutStreet(string $s): string {
    $p = preg_split('/(?:^|\s)(?:' . self::STREET_KW . ')(?:\.|\s|$)/u', $s, 2); return trim((string)$p[0], " .\t-");
  }
  /** Пункт з індексу як відповідь: назва, тип, громада, район. */
  private static function sp(int $i): array {
    $s = self::kat()['settlements'][$i]; $hid = (string)$s['h'];
    return ['n' => (string)$s['n'], 'h' => $hid, 'c' => (string)$s['c'], 'hromada' => self::hname($hid), 'district' => (string)(self::kat()['districts'][$s['d']] ?? ''), 'i' => $i];
  }
  /** Адреса → ['p' => пункт, 'how' => name|typo|old|default|settled, 'alts' => […]] або ['candidates' => […], 'reason' => ambiguous|typo] або null. */
  public static function match(string $addr, ?string $n = null, ?string $h = null): ?array {
    $k = self::kat(); $ix = self::ix();
    if ($n !== null && $h !== null && $n !== '' && $h !== '') {
      foreach ((array)$k['settlements'] as $i => $s) if ($s['n'] === $n && $s['h'] === $h) return ['p' => self::sp($i), 'how' => 'settled', 'alts' => []];
    }
    $pa = self::parse($addr);
    // підказки району й громади (з описками)
    $dIds = []; foreach ($pa['d'] as $x) { foreach ($ix['d'] as $dk => $id) if ($x !== '' && self::lev($x, $dk) <= 2) $dIds[$id] = 1; }
    $hIds = []; foreach ($pa['h'] as $x) { foreach ($ix['h'] as $hk => $id) if ($x !== '' && self::lev($x, $hk) <= 2) $hIds[$id] = 1; }
    $filter = function (array $is, string $t) use ($k, $dIds, $hIds): array {
      foreach ([[$hIds, 'h'], [$dIds, 'd']] as [$ids, $f]) if ($ids) { $x = array_values(array_filter($is, fn($i) => isset($ids[$k['settlements'][$i][$f]]))); if ($x) $is = $x; }
      if ($t !== '') { $x = array_values(array_filter($is, fn($i) => $k['settlements'][$i]['c'] === $t || ($t === 'X' && $k['settlements'][$i]['c'] === 'M'))); if ($x) $is = $x; }
      $seen = []; return array_values(array_filter($is, function ($i) use ($k, &$seen) { $key = $k['settlements'][$i]['n'] . '|' . $k['settlements'][$i]['h']; if (isset($seen[$key])) return false; return $seen[$key] = true; }));
    };
    $pick = function (array $is, string $how, string $t) use ($k): array {
      $ps = array_map([self::class, 'sp'], $is);
      if (count($ps) === 1) return ['p' => $ps[0], 'how' => $how, 'alts' => []];
      // місто серед сіл з тією ж назвою (Лозова, Південне) чи селище серед 1–2 сіл (Пісочин) — воно, якщо не сказано «с.»; інші — «Не той?»
      $M = array_values(array_filter($ps, fn($p) => $p['c'] === 'M')); $X = array_values(array_filter($ps, fn($p) => $p['c'] === 'X'));
      $big = count($M) === 1 ? $M[0] : (!$M && count($X) === 1 && count($ps) <= 3 ? $X[0] : null);
      if ($big && $t !== 'C') return ['p' => $big, 'how' => $how, 'alts' => array_values(array_filter($ps, fn($p) => $p['i'] !== $big['i']))];
      // список «Уточніть»: міста й селища першими, далі за районом і громадою
      $rk = ['M' => 0, 'X' => 1, 'C' => 2];
      usort($ps, fn($a, $b) => [$rk[$a['c']] ?? 3, $a['district'], $a['hromada']] <=> [$rk[$b['c']] ?? 3, $b['district'], $b['hromada']]);
      return ['candidates' => array_slice($ps, 0, 20), 'reason' => $how === 'typo' ? 'typo' : 'ambiguous'];
    };
    // 1) точна назва (чи стара назва) — у порядку шматків адреси
    foreach ($pa['c'] as $cd) {
      $key = self::nk(preg_replace('/^(м|г|с|смт|сел|селище|село|с-ще)\.?\s+/u', '', $cd['n']));
      $words = explode(' ', $key);
      // «Мала Данилівка Академічна» без коми: найдовший початок з 1–3 слів, що є назвою
      for ($len = min(3, count($words)); $len >= 1; $len--) {
        $kk = implode(' ', array_slice($words, 0, $len)); if (!isset($ix['by'][$kk])) continue;
        if ($len < count($words) && !$cd['strong'] && $cd['fuzzy']) { /* перший шматок «Харків Сумська» — теж ок */ }
        $is = $filter($ix['by'][$kk], $cd['t']);
        $old = true; foreach ($is as $i) if (self::nk((string)$k['settlements'][$i]['n']) === $kk) $old = false;
        return $pick($is, $old ? 'old' : 'name', $cd['t']);
      }
    }
    // 2) описка — лише для назв із «м.», «с.», «смт» і першого шматка адреси
    foreach ($pa['c'] as $cd) {
      if (!$cd['fuzzy']) continue;
      $key = self::nk(preg_replace('/^(м|г|с|смт|сел|селище|село|с-ще)\.?\s+/u', '', $cd['n'])); if (mb_strlen($key) < 4) continue;
      $best = []; $bd = 99;
      foreach ($ix['by'] as $kk => $is) {
        $kk = (string)$kk; if (abs(mb_strlen($kk) - mb_strlen($key)) > 3) continue;
        $dd = self::lev($key, $kk); if ($dd > self::tol($kk, true)) continue;
        foreach ($is as $i) $best[] = [$dd, $i, $dd <= self::tol($kk, false)];
        $bd = min($bd, $dd);
      }
      if (!$best) continue;
      usort($best, fn($a, $b) => $a[0] <=> $b[0]);
      $auto = array_values(array_filter($best, fn($x) => $x[0] === $bd && $x[2]));
      if ($auto) {
        $r = $pick($filter(array_map(fn($x) => $x[1], $auto), $cd['t']), 'typo', $cd['t']);
        if (isset($r['p'])) return $r;
      }
      $is = $filter(array_slice(array_map(fn($x) => $x[1], $best), 0, 12), $cd['t']);
      return ['candidates' => array_slice(array_map([self::class, 'sp'], $is), 0, 8), 'reason' => 'typo'];
    }
    // 3) пункту в адресі немає, а починається вона з вулиці (так пишуть харків'яни) — це Харків; інший район/пункт — ні
    $strong = array_filter($pa['c'], fn($x) => $x['strong']);
    $khD = $ix['d'][self::nk('Харківський')] ?? '';
    if (!$strong && (!$dIds || isset($dIds[$khD])) && !$hIds && ($pa['firstStreet'] || !$pa['c'])) {
      foreach ($ix['by'][self::nk('Харків')] ?? [] as $i) if ($k['settlements'][$i]['c'] === 'M') return ['p' => self::sp($i), 'how' => 'default', 'alts' => []];
    }
    return null;
  }
  /** Сьогоднішня дата для датованих тарифів (тести підставляють свою). */
  public static ?string $today = null;
  /** Наступний затверджений тариф (next: {from, supply, drain, price} або їх список): з дати from він і є чинним, раніше — лишається
   *  в відповіді як «з … буде …». Харківводоканал: 49,446 / 20,82 з 01.10.2026 → 57,504 / 27,992 з 01.01.2027. */
  public static function dated(array $o, ?string $today = null): array {
    if (empty($o['next']) || !is_array($o['next'])) return $o;
    $today = $today ?? self::$today ?? date('Y-m-d');
    $steps = array_is_list($o['next']) ? $o['next'] : [$o['next']];
    usort($steps, fn($a, $b) => strcmp((string)($a['from'] ?? ''), (string)($b['from'] ?? '')));
    unset($o['next']); $later = [];
    foreach ($steps as $s) {
      if (!is_array($s) || empty($s['from'])) continue;
      if ((string)$s['from'] <= $today) { foreach (['supply', 'drain', 'price', 'abon', 'from'] as $f) if (array_key_exists($f, $s)) $o[$f] = $s[$f]; }
      else $later[] = $s;
    }
    if ($later) $o['next'] = $later[0];
    return $o;
  }
  /** Довідник по видах для пункту: oblast ← громада ← пункт. Вода й тепло громади заміняють обласне «невідомо» цілком. */
  public static function kinds(array $p): array {
    $d = self::data(); $ob = (array)($d['oblast'] ?? []); $hr = (array)($d['hromadas'][$p['hromada']] ?? []);
    $st = (array)($d['settlements'][$p['hromada'] . '/' . $p['n']] ?? []); $out = [];
    foreach (['elec', 'gas', 'water', 'heat'] as $kd) {
      $o = (array)($ob[$kd] ?? []);
      if (in_array($kd, ['water', 'heat'], true) && (isset($hr[$kd]) || isset($st[$kd]))) $o = [];
      $o = array_merge($o, (array)($hr[$kd] ?? []), (array)($st[$kd] ?? []));
      if (in_array($kd, ['water', 'heat'], true) && !array_key_exists('org', $o)) $o['org'] = null;
      $out[$kd] = self::dated($o);
    }
    return $out;
  }
  private static function pub(array $p): array { return ['id' => $p['n'] . '@' . $p['h'], 'n' => $p['n'], 'h' => $p['h'], 'name' => $p['n'], 'kind' => $p['c'], 'hromada' => $p['hromada'], 'district' => $p['district']]; }
  /** Відповідь застосунку: пункт, по видах — хто, тариф (з джерелом), куди передати й платити; загальнодержавне для світла й газу. */
  public static function lookup(string $addr, ?string $n = null, ?string $h = null): array {
    $addr = trim(mb_substr($addr, 0, 160)); $d = self::data(); $nat = (array)($d['national'] ?? []);
    $base = ['national' => $nat, 'updated' => $d['updated'] ?? null];
    if ($addr === '') return ['found' => false, 'reason' => 'empty'] + $base;
    $m = self::match($addr, $n !== null ? mb_substr($n, 0, 60) : null, $h !== null ? mb_substr($h, 0, 30) : null);
    if (!$m) return ['found' => false, 'reason' => 'place'] + $base;
    if (isset($m['candidates'])) return ['found' => false, 'reason' => $m['reason'], 'candidates' => array_map([self::class, 'pub'], $m['candidates'])] + $base;
    $p = $m['p'];
    return ['found' => true, 'how' => $m['how'], 'place' => self::pub($p), 'alts' => array_map([self::class, 'pub'], array_slice($m['alts'], 0, 6)), 'kinds' => self::kinds($p)] + $base;
  }
}
