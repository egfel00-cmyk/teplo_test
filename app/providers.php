<?php
declare(strict_types=1);

/** Постачальники й тарифи за адресою квартири — області з довідника (Харківська, Київська, м. Київ, Одеська, Львівська).
 *  Адреса (з описками, укр. чи рос., зі старою назвою) → населений пункт КАТОТТГ (app/data/<r>_katottg.json) → громада → по видах
 *  (світло, газ, вода, тепло) з довідника регіону: oblast (уся область) ← hromadas[«громада»] ← settlements[«громада/пункт»].
 *  kh — у app/data/providers.json (разом із national — загальнодержавне), решта — app/data/prov_<r>.json; поверх — правки з /admin
 *  (SITE_DATA/uploads/settings/prov_edit.json, ProvEdit). Область з адреси («Київська обл.», «Одесская область») звужує пошук.
 *  Неоднозначно (Миколаївка в кожній області) чи описка з кількома варіантами → candidates, людина уточнює (n + h).
 *  GET /api/providers?q=адреса[&n=назва пункту&h=код громади]. Адресу не зберігаємо. Як додати область — skills/oblast-providers/SKILL.md. */
final class Providers {
  /** Регіони довідника: код → назва (як у КАТОТТГ). Порядок — порядок у списку «Уточніть» серед однакових назв. */
  const REGIONS = ['kh' => 'Харківська', 'kv' => 'Київська', 'ky' => 'Київ', 'od' => 'Одеська', 'lv' => 'Львівська', 'km' => 'Хмельницька'];
  /** Область в адресі (укр./рос.): «Київська обл.», «Киевская область», «Одеська обл», «Львовская обл.», «Хмельницкая обл.». */
  const OBL_RE = ['kh' => '/харк[іи]вськ|харьковск/u', 'kv' => '/ки[їи]вськ|киевск/u', 'od' => '/одеськ|одесск/u', 'lv' => '/льв[іо]вськ|львовск/u', 'km' => '/хмельн[иі]цьк|хмельницк/u'];
  public static function file(): string { return (string)Cfg::get('providers_file', __DIR__ . '/data/providers.json'); }
  public static function katFile(string $r = 'kh'): string { return $r === 'kh' ? (string)Cfg::get('katottg_file', __DIR__ . '/data/kh_katottg.json') : __DIR__ . '/data/' . $r . '_katottg.json'; }
  public static function provFile(string $r): string { return $r === 'kh' ? self::file() : (string)Cfg::get('prov_dir', __DIR__ . '/data') . '/prov_' . $r . '.json'; }
  private static ?array $d = null; private static ?array $k = null; private static ?array $ix = null; private static array $rd = [];
  /** providers.json: national (загальнодержавне) і Харківська область (oblast, hromadas, settlements) — як було. */
  public static function data(): array {
    if (self::$d === null) { $j = json_decode((string)@file_get_contents(self::file()), true); self::$d = is_array($j) ? $j : ['national' => [], 'oblast' => [], 'hromadas' => []]; }
    return self::$d;
  }
  /** Довідник регіону з правками /admin: {oblast, hromadas, settlements, updated, note}. */
  public static function rdata(string $r): array {
    if (isset(self::$rd[$r])) return self::$rd[$r];
    return self::$rd[$r] = ProvEdit::apply($r, self::raw($r));
  }
  /** Довідник регіону як у репозиторії (без правок /admin). */
  public static function raw(string $r): array {
    $j = $r === 'kh' ? self::data() : json_decode((string)@file_get_contents(self::provFile($r)), true);
    $j = is_array($j) ? $j : [];
    return ['oblast' => (array)($j['oblast'] ?? []), 'hromadas' => (array)($j['hromadas'] ?? []), 'settlements' => (array)($j['settlements'] ?? []), 'updated' => $j['updated'] ?? null, 'note' => $j['note'] ?? null];
  }
  /** КАТОТТГ усіх регіонів одним списком: пункт знає свій регіон (r), громада — теж. Харківська — першою (номери пунктів як були). */
  public static function kat(): array {
    if (self::$k !== null) return self::$k;
    $o = ['districts' => [], 'hromadas' => [], 'settlements' => []];
    foreach (array_keys(self::REGIONS) as $r) {
      $j = json_decode((string)@file_get_contents(self::katFile($r)), true); if (!is_array($j) || empty($j['settlements'])) continue;
      foreach ((array)$j['districts'] as $id => $n) $o['districts'][(string)$id] = $n;
      foreach ((array)$j['hromadas'] as $id => $h) $o['hromadas'][(string)$id] = (array)$h + ['r' => $r];
      foreach ((array)$j['settlements'] as $st) { $st['r'] = $r; $o['settlements'][] = $st; }
    }
    return self::$k = $o;
  }
  public static function reset(): void { self::$d = null; self::$k = null; self::$ix = null; self::$rd = []; ProvEdit::reset(); }

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
  public static function nk(string $s, bool $ends = true): string {
    $s = mb_strtolower(trim($s));
    $s = str_replace(['ё', '’', 'ʼ', '`', '´', "'", '"', '«', '»'], ['е', '', '', '', '', '', '', '', ''], $s);
    $s = preg_replace(['/(?<!\p{L})алекс/u', '/(?<!\p{L})никол/u', '/(?<!\p{L})ольх/u', '/(?<!\p{L})ольш/u'], ['олекс', 'микол', 'вільх', 'вільш'], $s);
    $s = Gpv::skel((string)$s); if (!$ends) return trim($s);
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
    // райони й громади з однаковими назвами є в різних областях (Золочівський — і Львівщина, і старий харківський) — список кодів
    foreach ((array)$k['districts'] as $id => $nm) $d[self::nk((string)$nm)][(string)$id] = 1;
    $did = []; foreach ((array)$k['districts'] as $id => $nm) if (str_starts_with((string)$id, 'UA63')) $did[$nm] = (string)$id;
    foreach (self::OLD_DISTRICTS as $o => $n) if (isset($did[$n])) $d[self::nk($o)][$did[$n]] = 1;
    // громада — і нинішньою назвою, і старою (адреси ще пишуть «Чкаловська громада», «Красноградська»)
    foreach ((array)$k['hromadas'] as $id => $x) foreach (array_merge([self::hname((string)$id), (string)($x['n'] ?? '')], (array)($x['old'] ?? []), array_keys(self::H_NEW, self::hname((string)$id), true)) as $nm) { $key = self::nk($nm); if ($key !== '') $h[$key][(string)$id] = 1; }
    return self::$ix = ['by' => $by, 'd' => $d, 'h' => $h];
  }
  /** Перейменовані громади (у КАТОТТГ 2025 ще старі назви; Чкаловська — розпорядження КМУ № 1331-р від 26.11.2025, з 05.01.2026). */
  const H_NEW = ['Красноградська' => 'Берестинська', 'Первомайська' => 'Златопільська', 'Чкаловська' => 'Пролісненська'];
  /** Назва громади, як її пишуть зараз. */
  public static function hname(string $hid): string {
    $n = (string)(self::kat()['hromadas'][$hid]['n'] ?? ''); return self::H_NEW[$n] ?? $n;
  }
  /** Ключ громади в довіднику: назва, а для однакових назв в області — «Назва (центр)» чи «Назва (район р-н)» (КАТОТТГ, поле k). */
  public static function hkey(string $hid): string { return (string)(self::kat()['hromadas'][$hid]['k'] ?? self::hname($hid)); }
  /** Регіон громади (kh, kv, ky, od, lv). */
  public static function hreg(string $hid): string { return (string)(self::kat()['hromadas'][$hid]['r'] ?? 'kh'); }
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
    $c = []; $hd = []; $hh = []; $hr = []; $first = null; $firstStreet = false;
    foreach ($segs as $s) {
      // «Київська обл.», «Одесская область» — підказка регіону
      if (preg_match('/(^|\s)(обл|область|обл\.)(\.|\s|$)/u', $s)) { foreach (self::OBL_RE as $r => $re) if (preg_match($re, $s)) $hr[] = $r; continue; }
      if (preg_match('/^(україна|украина|ukraine)$/u', $s) || preg_match('/^\d{5}$/u', $s)) continue;
      // «р-н» можна впритул, а «р»/«район» — лише окремим словом: інакше Есхар, Іськів Яр, Сосновий Бір ставали «районом»
      if (preg_match('/^(.+?)(?:\s*(?:р-н|р-он|р\.\s*н)|\s+(?:район|р))\.?$/u', $s, $m) || preg_match('/^(?:р-н|район)\.?\s+(.+)$/u', $s, $m)) { $hd[] = self::nk($m[1]); continue; }
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
    return ['c' => $c, 'd' => $hd, 'h' => $hh, 'r' => $hr, 'firstStreet' => $firstStreet];
  }
  private static function cutStreet(string $s): string {
    $p = preg_split('/(?:^|\s)(?:' . self::STREET_KW . ')(?:\.|\s|$)/u', $s, 2); return trim((string)$p[0], " .\t-");
  }
  /** Пункт з індексу як відповідь: назва, тип, громада, район. */
  private static function sp(int $i): array {
    $s = self::kat()['settlements'][$i]; $hid = (string)$s['h'];
    return ['n' => (string)$s['n'], 'h' => $hid, 'c' => (string)$s['c'], 'hromada' => self::hname($hid), 'district' => (string)(self::kat()['districts'][$s['d']] ?? ''), 'i' => $i, 'r' => (string)($s['r'] ?? 'kh')];
  }
  /** Адреса → ['p' => пункт, 'how' => name|typo|old|default|settled, 'alts' => […]] або ['candidates' => […], 'reason' => ambiguous|typo] або null. */
  public static function match(string $addr, ?string $n = null, ?string $h = null): ?array {
    $k = self::kat(); $ix = self::ix();
    if ($n !== null && $h !== null && $n !== '' && $h !== '') {
      foreach ((array)$k['settlements'] as $i => $s) if ($s['n'] === $n && $s['h'] === $h) return ['p' => self::sp($i), 'how' => 'settled', 'alts' => []];
    }
    $pa = self::parse($addr);
    // підказки району й громади (з описками)
    $dIds = []; foreach ($pa['d'] as $x) { foreach ($ix['d'] as $dk => $ids) if ($x !== '' && self::lev($x, (string)$dk) <= 2) $dIds += $ids; }
    $hIds = []; foreach ($pa['h'] as $x) { foreach ($ix['h'] as $hk => $ids) if ($x !== '' && self::lev($x, (string)$hk) <= 2) $hIds += $ids; }
    $rIds = array_fill_keys($pa['r'], 1);
    $filter = function (array $is, string $t) use ($k, $dIds, $hIds, $rIds): array {
      foreach ([[$rIds, 'r'], [$hIds, 'h'], [$dIds, 'd']] as [$ids, $f]) if ($ids) { $x = array_values(array_filter($is, fn($i) => isset($ids[$k['settlements'][$i][$f] ?? '']))); if ($x) $is = $x; }
      if ($t !== '') { $x = array_values(array_filter($is, fn($i) => $k['settlements'][$i]['c'] === $t || ($t === 'X' && $k['settlements'][$i]['c'] === 'M'))); if ($x) $is = $x; }
      $seen = []; return array_values(array_filter($is, function ($i) use ($k, &$seen) { $key = $k['settlements'][$i]['n'] . '|' . $k['settlements'][$i]['h']; if (isset($seen[$key])) return false; return $seen[$key] = true; }));
    };
    $pick = function (array $is, string $how, string $t) use ($k, $rIds): array {
      $ps = array_map([self::class, 'sp'], $is);
      if (count($ps) === 1) return ['p' => $ps[0], 'how' => $how, 'alts' => []];
      // місто серед сіл з тією ж назвою (Лозова, Південне) чи селище серед 1–2 сіл (Пісочин) — воно, якщо не сказано «с.»; інші — «Не той?»
      $M = array_values(array_filter($ps, fn($p) => $p['c'] === 'M')); $X = array_values(array_filter($ps, fn($p) => $p['c'] === 'X'));
      // «смт/селище Золочів»: сказано «селище», а таке селище одне (Харківщина) — воно, не місто Золочів на Львівщині (фільтр типу пропускає й міста — «смт» пишуть і про малі міста)
      $big = $t === 'X' && count($X) === 1 ? $X[0] : (count($M) === 1 ? $M[0] : (!$M && count($X) === 1 && count($ps) <= 3 ? $X[0] : null));
      // однакова назва в кількох областях (Південне — Харківщина й Одещина), область в адресі не вказана: першою — Харківщина (звідси більшість людей),
      // якщо там назва однозначна; решта — у «Не той?»
      if (!$big && count(array_unique(array_column($ps, 'r'))) > 1 && !$rIds) {
        $kh = array_values(array_filter($ps, fn($p) => $p['r'] === 'kh')); $kM = array_values(array_filter($kh, fn($p) => $p['c'] === 'M')); $kX = array_values(array_filter($kh, fn($p) => $p['c'] === 'X'));
        $big = count($kh) === 1 && $kh[0]['c'] !== 'C' ? $kh[0] : (count($kM) === 1 ? $kM[0] : (!$kM && count($kX) === 1 && count($kh) <= 3 ? $kX[0] : null));
      }
      if ($big && $t !== 'C') return ['p' => $big, 'how' => $how, 'alts' => array_values(array_filter($ps, fn($p) => $p['i'] !== $big['i']))];
      // список «Уточніть»: міста й селища першими, далі за областю (порядок REGIONS), районом і громадою
      $rk = ['M' => 0, 'X' => 1, 'C' => 2]; $ro = array_flip(array_keys(self::REGIONS));
      usort($ps, fn($a, $b) => [$rk[$a['c']] ?? 3, $ro[$a['r']] ?? 9, $a['district'], $a['hromada']] <=> [$rk[$b['c']] ?? 3, $ro[$b['r']] ?? 9, $b['district'], $b['hromada']]);
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
        // нинішня назва важливіша за стару: «Петрівка» — це села Петрівка, а не селище Буялик (Петрівка до 2024, ВР № 3984-IX); перейменовані — в кінець «Не той?»/«Уточніть»
        $cur = array_values(array_filter($is, fn($i) => self::nk((string)$k['settlements'][$i]['n']) === $kk));
        if (!$cur) return $pick($is, 'old', $cd['t']);
        $res = $pick($cur, 'name', $cd['t']); $os = array_map([self::class, 'sp'], array_values(array_diff($is, $cur)));
        if ($os) { if (isset($res['alts'])) $res['alts'] = array_merge($res['alts'], $os); else $res['candidates'] = array_slice(array_merge($res['candidates'], $os), 0, 20); }
        return $res;
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
    $khD = 'UA63120000000091135';   // Харківський район
    if (!$strong && (!$dIds || isset($dIds[$khD])) && !$hIds && (!$rIds || isset($rIds['kh'])) && ($pa['firstStreet'] || !$pa['c'])) {
      foreach ($ix['by'][self::nk('Харків')] ?? [] as $i) if ($k['settlements'][$i]['c'] === 'M' && ($k['settlements'][$i]['r'] ?? 'kh') === 'kh') return ['p' => self::sp($i), 'how' => 'default', 'alts' => []];
    }
    return null;
  }
  /** Підказка населеного пункту під час набору (форма адреси квартири, 61-а сесія): «Льв» → Львів, «Мала Дан» → Мала Данилівка,
   *  рос. й з описками («Александровк», «Харьк», «Киев»). Порядок: точна назва → початок назви → описка; міста → селища → села;
   *  регіон $pref (де вже є квартира людини) — першим. До 8 штук. GET /api/places/suggest?q=…&r=kh. Нічого не зберігаємо. */
  public static function suggest(string $q, string $pref = ''): array {
    $q = mb_strtolower(trim(mb_substr($q, 0, 60)));
    $q = trim((string)preg_replace('/^(м|г|с|смт|пгт|сел|селище|село|с\s*-\s*ще|місто|город|пос|поселок)(?:\.\s*|\s+)/u', '', $q));
    $key = self::nk($q); $L = mb_strlen($key); if ($L < 2) return ['items' => []];
    // недописане слово: «Нов» — не «нів» (заміна закінчень nk лише для цілих слів) — початок без заміни
    $kp = self::nk($q, false); $Lp = mb_strlen($kp);
    $ix = self::ix(); $k = self::kat(); $hits = [];
    foreach ($ix['by'] as $kk => $is) {
      $kk = (string)$kk;
      if ($kk === $key) $sc = 0; elseif (str_starts_with($kk, $key) || ($Lp >= 2 && str_starts_with($kk, $kp))) $sc = 1;
      elseif ($L >= 4 && self::lev($key, mb_substr($kk, 0, $L)) <= ($L >= 7 ? 2 : 1)) $sc = 2;
      else continue;
      // збіг за старою назвою (перейменовані 2024) — після нинішніх з тим самим рівнем збігу
      foreach ($is as $i) $hits[$i] = min($hits[$i] ?? 99, $sc * 2 + (self::nk((string)$k['settlements'][$i]['n']) === $kk ? 0 : 1));
    }
    $rk = ['M' => 0, 'X' => 1, 'C' => 2]; $ro = array_flip(array_keys(self::REGIONS)); $S = $k['settlements'];
    $ids = array_keys($hits);
    usort($ids, fn($a, $b) => [$hits[$a], ($S[$a]['r'] ?? 'kh') === $pref ? 0 : 1, $rk[$S[$a]['c']] ?? 3, $ro[$S[$a]['r'] ?? 'kh'] ?? 9, (string)$S[$a]['n']]
      <=> [$hits[$b], ($S[$b]['r'] ?? 'kh') === $pref ? 0 : 1, $rk[$S[$b]['c']] ?? 3, $ro[$S[$b]['r'] ?? 'kh'] ?? 9, (string)$S[$b]['n']]);
    $out = []; $seen = [];
    foreach ($ids as $i) {
      $p = self::sp($i); $u = $p['n'] . '|' . $p['h']; if (isset($seen[$u])) continue; $seen[$u] = 1;
      $out[] = self::pub($p) + ['c' => $p['c']]; if (count($out) >= 8) break;
    }
    return ['items' => $out];
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
      if ((string)$s['from'] <= $today) { foreach (['supply', 'drain', 'price', 'abon', 'priv', 'from'] as $f) if (array_key_exists($f, $s)) $o[$f] = $s[$f]; }
      else $later[] = $s;
    }
    if ($later) $o['next'] = $later[0];
    return $o;
  }
  /** Довідник по видах для пункту: oblast ← громада ← пункт. Вода, тепло й вивіз сміття громади заміняють обласне «невідомо» цілком.
   *  waste (112-а, власник 11.11: «так, і нагадувати про оплату») — вивіз побутових відходів: org, price — грн з людини на місяць
   *  (багатоквартирні), priv — приватний сектор, якщо інша; from, src, pay, phones, site — як у інших видів. */
  const LOCAL = ['water', 'heat', 'waste'];
  public static function kinds(array $p): array {
    $d = self::rdata((string)($p['r'] ?? self::hreg((string)$p['h']))); $hk = self::hkey((string)$p['h']);
    $ob = (array)($d['oblast'] ?? []); $hr = (array)($d['hromadas'][$hk] ?? []);
    $st = (array)($d['settlements'][$hk . '/' . $p['n']] ?? []); $out = [];
    foreach (['elec', 'gas', 'water', 'heat', 'waste'] as $kd) {
      $o = (array)($ob[$kd] ?? []);
      if (in_array($kd, self::LOCAL, true) && (isset($hr[$kd]) || isset($st[$kd]))) $o = [];
      $hk = (array)($hr[$kd] ?? []); $sk = (array)($st[$kd] ?? []);
      // у пункті інший постачальник (Буди, Феськи, Есхар…) — від громади нічого не беремо: ні дати, ні «куди платити», ні телефонів
      if (in_array($kd, self::LOCAL, true) && array_key_exists('org', $sk) && ($sk['org'] ?? null) !== ($hk['org'] ?? null)) $hk = [];
      $o = array_merge($o, $hk, $sk);
      if (in_array($kd, self::LOCAL, true) && !array_key_exists('org', $o)) $o['org'] = null;
      $out[$kd] = self::dated($o);
    }
    return $out;
  }
  private static function pub(array $p): array {
    $r = (string)($p['r'] ?? 'kh');
    return ['id' => $p['n'] . '@' . $p['h'], 'n' => $p['n'], 'h' => $p['h'], 'name' => $p['n'], 'kind' => $p['c'], 'hromada' => $p['hromada'], 'district' => $r === 'ky' ? '' : $p['district'],
      'r' => $r, 'oblast' => self::REGIONS[$r] ?? ''];
  }
  /** Відповідь застосунку: пункт, по видах — хто, тариф (з джерелом), куди передати й платити; загальнодержавне для світла й газу. */
  public static function lookup(string $addr, ?string $n = null, ?string $h = null): array {
    $addr = trim(mb_substr($addr, 0, 160)); $d = self::data(); $nat = (array)($d['national'] ?? []);
    $base = ['national' => $nat, 'updated' => $d['updated'] ?? null];
    if ($addr === '') return ['found' => false, 'reason' => 'empty'] + $base;
    $m = self::match($addr, $n !== null ? mb_substr($n, 0, 60) : null, $h !== null ? mb_substr($h, 0, 30) : null);
    if (!$m) { ProvEdit::seen(null, []); return ['found' => false, 'reason' => 'place'] + $base; }
    if (isset($m['candidates'])) return ['found' => false, 'reason' => $m['reason'], 'candidates' => array_map([self::class, 'pub'], $m['candidates'])] + $base;
    $p = $m['p']; $kinds = self::kinds($p);
    ProvEdit::seen($p, $kinds);   // для /admin: які громади шукають люди і в яких немає води/тепла (без адрес)
    return ['found' => true, 'how' => $m['how'], 'place' => self::pub($p), 'alts' => array_map([self::class, 'pub'], array_slice($m['alts'], 0, 6)), 'kinds' => $kinds] + $base;
  }
}

/** Правки довідника з /admin поверх файлів репозиторію — щоб власник правив сам, без сесії: SITE_DATA/uploads/settings/prov_edit.json
 *  {r: {kh: {oblast: {вид: об'єкт|false}, hromadas: {ключ: {вид: …}}, settlements: {«ключ/пункт»: {вид: …}}}}, log: [...]}.
 *  Об'єкт — вид цілком замість репозиторію; false — прибрати вид на цьому рівні (тоді діє рівень вище). Журнал — хто, коли, що й попереднє (відкат).
 *  Сесія на старті забирає правки в репозиторій: /admin → «Справочник» → «Скачать правки» (GET /api/admin/prov/edits), /api/health → prov.edits. */
final class ProvEdit {
  const SCOPES = ['oblast', 'hromadas', 'settlements'];
  const KINDS = ['elec', 'gas', 'water', 'heat', 'waste'];
  const STR = ['org', 'net', 'grm', 'note', 'note_ru', 'src', 'src_ru', 'how', 'how_ru', 'pay', 'pay_ru', 'cab', 'bot', 'site', 'app', 'viber', 'sms', 'from', 'distFrom', 'distSrc', 'distSrc_ru', 'robot', 'robot_note', 'via'];
  const NUM = ['supply', 'drain', 'hot', 'price', 'abon', 'dist', 'priv', 'till'];   // till — до якого числа місяця передавати (31 — до кінця місяця; 126-а)
  const URLS = ['cab', 'bot', 'site', 'app', 'viber'];
  /** Чи можна подавати без людини: server — робот з нашого сервера; relay — лише з України (Cloudflare, ретранслятор); captcha — капча, вручну;
   *  bot — лише бот у Telegram/Viber; phone — лише телефон/SMS; none — ні кабінету, ні форми; '' — ще не перевіряли. */
  const ROBOT = ['', 'server', 'relay', 'captcha', 'bot', 'phone', 'none'];
  private static ?array $e = null;
  public static function file(): string { return Cfg::data() . '/uploads/settings/prov_edit.json'; }
  public static function all(): array { if (self::$e === null) { $j = json_decode((string)@file_get_contents(self::file()), true); self::$e = is_array($j) ? $j : []; } return self::$e; }
  public static function reset(): void { self::$e = null; }
  public static function apply(string $r, array $o): array {
    $e = (array)(self::all()['r'][$r] ?? []);
    foreach ((array)($e['oblast'] ?? []) as $kd => $v) { if ($v === false) unset($o['oblast'][$kd]); elseif (is_array($v)) $o['oblast'][$kd] = $v; }
    foreach (['hromadas', 'settlements'] as $sc) foreach ((array)($e[$sc] ?? []) as $key => $kinds) foreach ((array)$kinds as $kd => $v) {
      if ($v === false) { unset($o[$sc][$key][$kd]); if (empty($o[$sc][$key])) unset($o[$sc][$key]); }
      elseif (is_array($v)) $o[$sc][$key][$kd] = $v;
    }
    return $o;
  }
  /** Вид з форми /admin → чистий об'єкт довідника (лише відомі поля; числа — числа; пусте — немає; телефони — [[tel, як показати, підпис]]). */
  public static function clean(array $v): array {
    $o = [];
    foreach (self::STR as $f) if (isset($v[$f]) && is_scalar($v[$f]) && trim((string)$v[$f]) !== '') $o[$f] = mb_substr(trim((string)$v[$f]), 0, $f === 'note' || $f === 'note_ru' || str_starts_with($f, 'src') || str_starts_with($f, 'how') ? 1200 : 300);
    foreach (self::URLS as $f) if (isset($o[$f]) && !preg_match('~^https://[^\s"<>]+$~', $o[$f])) unset($o[$f]);
    if (isset($o['robot']) && !in_array($o['robot'], self::ROBOT, true)) unset($o['robot']);
    if (isset($o['via']) && !in_array($o['via'], ['hvk', 'htm'], true) && !(class_exists('LocalBot') && LocalBot::get((string)$o['via']))) unset($o['via']);   // + боти автоподачі (LocalBot::BOTS)
    foreach (['from', 'distFrom'] as $f) if (isset($o[$f]) && !preg_match('/^\d{4}-\d\d-\d\d$/', $o[$f])) unset($o[$f]);
    foreach (self::NUM as $f) if (array_key_exists($f, $v)) {
      $x = is_string($v[$f]) ? str_replace([' ', ','], ['', '.'], trim($v[$f])) : $v[$f];
      if ($x === '' || $x === null) { if (in_array($f, ['supply', 'drain', 'price'], true)) $o[$f] = null; continue; }   // невідомо — null: застосунок просить вписати з платіжки
      if (is_numeric($x) && (float)$x >= 0 && (float)$x < 100000) $o[$f] = round((float)$x, 4);
    }
    if (!empty($v['check'])) $o['check'] = true;
    if (array_key_exists('org', $v) && trim((string)$v['org']) === '' && !isset($o['org'])) $o['org'] = null;
    $ph = [];
    foreach ((array)($v['phones'] ?? []) as $p) {
      if (is_string($p)) { $q = array_map('trim', explode(';', $p)); $p = [$q[0] ?? '', $q[0] ?? '', $q[1] ?? '']; }
      if (!is_array($p) || count($p) < 2) continue;
      $show = mb_substr(trim((string)($p[1] ?: $p[0])), 0, 40); $tel = preg_replace('/[^\d+]/', '', (string)$p[0]);
      if (strlen($tel) === 10 && $tel[0] === '0') $tel = '+38' . $tel; elseif (strlen($tel) === 12 && str_starts_with($tel, '380')) $tel = '+' . $tel;
      if (strlen(preg_replace('/\D/', '', $tel)) >= 4) $ph[] = [$tel, $show, mb_substr(trim((string)($p[2] ?? '')), 0, 60)];
    }
    if ($ph) $o['phones'] = array_slice($ph, 0, 8);
    $nx = [];
    foreach ((isset($v['next']['from']) ? [$v['next']] : (array)($v['next'] ?? [])) as $n) {
      if (!is_array($n) || !preg_match('/^\d{4}-\d\d-\d\d$/', (string)($n['from'] ?? ''))) continue;
      $s = ['from' => (string)$n['from']]; foreach (['supply', 'drain', 'price', 'abon', 'hot', 'priv'] as $f) if (isset($n[$f]) && is_numeric(str_replace(',', '.', (string)$n[$f]))) $s[$f] = round((float)str_replace(',', '.', (string)$n[$f]), 4);
      if (count($s) > 1) $nx[] = $s;
    }
    if ($nx) $o['next'] = count($nx) === 1 ? $nx[0] : $nx;
    return $o;
  }
  /** Чи є такий ключ у регіоні: громада — ключ довідника (hkey), пункт — «ключ/назва» справжнього пункту цієї громади, область — ''. */
  public static function keyOk(string $r, string $scope, string $key): bool {
    if ($scope === 'oblast') return $key === '';
    $k = Providers::kat(); $hk = [];
    foreach ((array)$k['hromadas'] as $id => $h) if (($h['r'] ?? '') === $r) $hk[Providers::hkey((string)$id)] = (string)$id;
    if ($scope === 'hromadas') return isset($hk[$key]);
    [$h, $n] = array_pad(explode('/', $key, 2), 2, ''); if (!isset($hk[$h])) return false;
    foreach ((array)$k['settlements'] as $s) if ($s['h'] === $hk[$h] && $s['n'] === $n) return true;
    return false;
  }
  /** Зберегти вид (value — об'єкт форми; null — повернути як у репозиторії; false — прибрати вид на цьому рівні). */
  public static function save(string $r, string $scope, string $key, string $kind, $value, string $who): array {
    if (!isset(Providers::REGIONS[$r]) || !in_array($scope, self::SCOPES, true) || !in_array($kind, self::KINDS, true) || !self::keyOk($r, $scope, $key)) throw new HttpError(422, 'bad_key');
    $before = self::cur($r, $scope, $key, $kind);
    $f = self::file(); @mkdir(dirname($f), 0700, true); $h = fopen($f, 'c+'); if (!$h) throw new HttpError(500, 'save_failed');
    flock($h, LOCK_EX); $j = json_decode((string)stream_get_contents($h), true); $j = is_array($j) ? $j : [];
    $path = $scope === 'oblast' ? [$r, 'oblast'] : [$r, $scope, $key];
    $node = &$j['r']; foreach ($path as $p) { if (!isset($node[$p]) || !is_array($node[$p])) $node[$p] = []; $node = &$node[$p]; }
    if ($value === null) unset($node[$kind]); else $node[$kind] = $value === false ? false : self::clean((array)$value);
    unset($node);
    // пусті гілки прибираємо
    if ($scope !== 'oblast' && empty($j['r'][$r][$scope][$key])) unset($j['r'][$r][$scope][$key]);
    if (empty($j['r'][$r][$scope])) unset($j['r'][$r][$scope]);
    if (empty($j['r'][$r])) unset($j['r'][$r]);
    $j['log'] = array_slice(array_merge([['at' => gmdate('c'), 'who' => mb_substr($who, 0, 60), 'r' => $r, 'scope' => $scope, 'key' => $key, 'kind' => $kind,
      'op' => $value === null ? 'revert' : ($value === false ? 'off' : 'set'), 'prev' => $before]], (array)($j['log'] ?? [])), 0, 300);
    $j['at'] = gmdate('c');
    ftruncate($h, 0); rewind($h); fwrite($h, json_encode($j, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT)); fflush($h); flock($h, LOCK_UN); fclose($h); @chmod($f, 0600);
    Providers::reset();
    return ['ok' => true, 'value' => self::cur($r, $scope, $key, $kind)];
  }
  /** Що зараз діє на цьому рівні (з правками), без підстановки з рівня вище. */
  public static function cur(string $r, string $scope, string $key, string $kind) {
    $d = Providers::rdata($r); return $scope === 'oblast' ? ($d['oblast'][$kind] ?? null) : ($d[$scope][$key][$kind] ?? null);
  }
  /** Правки, які вже є в репозиторії (сесія перенесла їх у prov_<r>.json), прибираємо — цикл «власник править → сесія забирає в git» замикається сам.
   *  Порівнюємо з файлом репозиторію; журнал лишається. → скільки прибрали. */
  public static function prune(): int {
    $f = self::file(); if (!is_file($f)) return 0;
    $h = fopen($f, 'c+'); if (!$h) return 0; flock($h, LOCK_EX); $j = json_decode((string)stream_get_contents($h), true); $j = is_array($j) ? $j : []; $n = 0;
    // порівнюємо як збереже форма (clean) і без порядку ключів: у репозиторії бувають порожні поля й інший порядок
    $norm = function ($v) use (&$norm) { if (!is_array($v)) return $v; if (!array_is_list($v)) ksort($v); return array_map($norm, $v); };
    $same = fn($a, $b) => $b !== null && json_encode($norm($a), JSON_UNESCAPED_UNICODE) === json_encode($norm(self::clean((array)$b)), JSON_UNESCAPED_UNICODE);
    foreach ((array)($j['r'] ?? []) as $r => $x) {
      $raw = Providers::raw((string)$r);
      foreach ((array)($x['oblast'] ?? []) as $kd => $v) if ($v !== false && $same($v, $raw['oblast'][$kd] ?? null)) { unset($j['r'][$r]['oblast'][$kd]); $n++; }
      foreach (['hromadas', 'settlements'] as $sc) foreach ((array)($x[$sc] ?? []) as $key => $kinds) foreach ((array)$kinds as $kd => $v) {
        $b = $raw[$sc][$key][$kd] ?? null;
        if (($v === false && $b === null) || ($v !== false && $same($v, $b))) { unset($j['r'][$r][$sc][$key][$kd]); $n++; if (empty($j['r'][$r][$sc][$key])) unset($j['r'][$r][$sc][$key]); }
      }
      foreach (self::SCOPES as $sc) if (isset($j['r'][$r][$sc]) && empty($j['r'][$r][$sc])) unset($j['r'][$r][$sc]);
      if (empty($j['r'][$r])) unset($j['r'][$r]);
    }
    if ($n) { ftruncate($h, 0); rewind($h); fwrite($h, json_encode($j, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT)); fflush($h); }
    flock($h, LOCK_UN); fclose($h); if ($n) { self::reset(); Providers::reset(); }
    return $n;
  }
  /** Скільки правок і коли остання — для /api/health (сесія знає, що є що забрати в репозиторій). */
  public static function summary(): array {
    $j = self::all(); $n = 0; foreach ((array)($j['r'] ?? []) as $r) { $n += count((array)($r['oblast'] ?? [])); foreach (['hromadas', 'settlements'] as $sc) foreach ((array)($r[$sc] ?? []) as $x) $n += count((array)$x); }
    return ['edits' => $n, 'at' => $j['at'] ?? null];
  }

  // ---- які громади шукають люди (без адрес): для /admin «Что ищут» — звідки почати наповнювати довідник ----
  public static function seenFile(): string { return Cfg::data() . '/cache/prov_seen.json'; }
  public static ?bool $track = null;   // тести вимикають
  public static function seen(?array $p, array $kinds): void {
    if (self::$track === false || !is_dir(Cfg::data())) return;
    $f = self::seenFile(); @mkdir(dirname($f), 0700, true); $h = @fopen($f, 'c+'); if (!$h) return;
    flock($h, LOCK_EX); $j = json_decode((string)stream_get_contents($h), true); $j = is_array($j) ? $j : [];
    $day = gmdate('Y-m-d');
    if ($p === null) $j['_nf'] = ['n' => (int)($j['_nf']['n'] ?? 0) + 1, 'at' => $day];
    else {
      $k = ($p['r'] ?? 'kh') . '|' . $p['h']; $x = (array)($j[$k] ?? []);
      $x['n'] = (int)($x['n'] ?? 0) + 1; $x['at'] = $day; $x['p'] = mb_substr((string)$p['n'], 0, 60);
      $x['w'] = empty($kinds['water']['org']) ? 1 : 0; $x['h'] = empty($kinds['heat']['org']) ? 1 : 0;
      $x['wt'] = isset($kinds['water']['supply']) && $kinds['water']['supply'] !== null ? 1 : 0;
      $j[$k] = $x;
    }
    ftruncate($h, 0); rewind($h); fwrite($h, json_encode($j, JSON_UNESCAPED_UNICODE)); fflush($h); flock($h, LOCK_UN); fclose($h);
  }
  public static function seenAll(): array { $j = json_decode((string)@file_get_contents(self::seenFile()), true); return is_array($j) ? $j : []; }
}

/** Проба кабінетів і форм з довідника з нашого сервера: чи можна подавати показання без людини (як CabProbe для ХТМ/обленерго/Газмереж).
 *  Раз на хвилину одна адреса, кожна — раз на 7 днів; лише GET сторінки входу/форми, нічого не вводимо.
 *  verdict: login — форма з паролем, без капчі (робот з сервера можливий, потрібен пароль людини); form — форма без пароля (рахунок/прізвище);
 *  captcha — капча; cf — Cloudflare не пускає закордонний сервер (лише з України — ретранслятор); down — не відповідає; page — сторінка без форми. */
final class ProvProbe {
  const DAYS = 7, PV = 2;   // PV 2 (103-я): у пробі — будова кожної форми (fset); старіші проби — перепробувати
  public static function file(): string { return Cfg::data() . '/cache/prov_probe.json'; }
  public static function read(): array { $j = json_decode((string)@file_get_contents(self::file()), true); return is_array($j) ? $j : []; }
  /** Усі адреси кабінетів і сайтів довідника: url → [[r, рівень, ключ, вид, поле], …]. */
  public static function urls(): array {
    $u = [];
    foreach (array_keys(Providers::REGIONS) as $r) {
      $d = Providers::rdata($r); $add = function (string $sc, string $key, array $kinds) use (&$u, $r) {
        foreach ($kinds as $kd => $o) if (is_array($o)) foreach (['cab', 'site'] as $f) if (!empty($o[$f]) && str_starts_with((string)$o[$f], 'https://')) $u[(string)$o[$f]][] = [$r, $sc, $key, $kd, $f];
      };
      $add('oblast', '', (array)$d['oblast']);
      foreach (['hromadas', 'settlements'] as $sc) foreach ((array)$d[$sc] as $key => $kinds) $add($sc, (string)$key, (array)$kinds);
    }
    return $u;
  }
  public static function run(?int $now = null): ?string {
    $now = $now ?? time(); $have = self::read(); $old = null;
    foreach (array_keys(self::urls()) as $url) { $at = (int)($have[$url]['pv'] ?? 1) < self::PV ? 0 : (strtotime((string)($have[$url]['at'] ?? '')) ?: 0); if ($now - $at > self::DAYS * 86400 && ($old === null || $at < $old[1])) $old = [$url, $at]; }
    if (!$old) return null;
    self::store($old[0], self::one($old[0]));
    return $old[0];
  }
  public static function store(string $url, array $o): void {
    $f = self::file(); @mkdir(dirname($f), 0700, true); $h = @fopen($f, 'c+'); if (!$h) return;
    flock($h, LOCK_EX); $j = json_decode((string)stream_get_contents($h), true); $j = is_array($j) ? $j : [];
    $live = self::urls(); foreach (array_keys($j) as $k) if (!isset($live[$k]) && $k !== $url) unset($j[$k]);   // адреси, яких у довіднику вже немає
    $j[$url] = $o;
    ftruncate($h, 0); rewind($h); fwrite($h, json_encode($j, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)); fflush($h); flock($h, LOCK_UN); fclose($h);
  }
  public static function one(string $url): array {
    $host = (string)parse_url($url, PHP_URL_HOST); if ($host === '' || !str_starts_with($url, 'https://')) return ['verdict' => 'bad', 'at' => gmdate('c')];
    $w = new CabWeb('/^' . preg_quote($host, '/') . '$/i', 12.0); $t = microtime(true);
    $r = $w->req('GET', $url);
    $o = ['code' => (int)$r['code'], 'ms' => (int)round((microtime(true) - $t) * 1000), 'at' => gmdate('c')];
    if ($r['err']) $o['err'] = mb_substr((string)$r['err'], 0, 80);
    $b = (string)($r['body'] ?? '');
    if ($b !== '') {
      $o += CabWeb::captcha($b, (int)$r['code']); $o += CabWeb::cfKind($b, (int)$r['code'], $r['h'] ?? []);
      $o['pass'] = (bool)preg_match('/<input[^>]+type=["\']?password/i', $b);
      $o['forms'] = preg_match_all('/<form\b/i', $b);
      preg_match_all('/<input[^>]+name=["\']([^"\']{1,40})["\']/i', $b, $m);
      $o['fields'] = array_values(array_slice(array_unique(array_filter($m[1], fn($x) => !preg_match('/^(_token|_csrf|csrf|__|utf8|authenticity)/i', $x))), 0, 12));
      $o['spa'] = !$o['forms'] && (bool)preg_match('/<div id=["\'](app|root|__next|__nuxt)["\']|ng-version|data-page=/i', $b);
      if ($o['forms']) $o['fset'] = self::forms($b);
    }
    $o['verdict'] = self::verdict($o); $o['pv'] = self::PV;
    return $o;
  }
  /** Будова форм сторінки (для рішення «форма без входу / кабінет» без браузера): метод, адреса дії (шлях), поля «ім’я:тип» (до 6 форм × 16 полів). */
  public static function forms(string $html): array {
    $out = []; $x = CabWeb::dom($html);
    foreach ($x->query('//form') as $f) {
      if (!$f instanceof DOMElement || count($out) >= 6) continue;
      $fl = [];
      foreach ($x->query('.//input|.//select|.//textarea|.//button', $f) as $e) {
        if (!$e instanceof DOMElement || count($fl) >= 16) continue; $n = trim($e->getAttribute('name')); $t = strtolower($e->tagName === 'input' ? ($e->getAttribute('type') ?: 'text') : $e->tagName);
        if ($n === '' && $t !== 'submit' && $e->tagName !== 'button') continue;
        if (preg_match('/^(_token|_csrf|csrf|__|utf8|authenticity)/i', $n)) $t = 'token';
        $fl[] = mb_substr($n, 0, 40) . ':' . $t;
      }
      $a = trim($f->getAttribute('action')); $a = $a === '' ? '' : (string)(parse_url($a, PHP_URL_PATH) ?? '') . (parse_url($a, PHP_URL_QUERY) ? '?…' : '');
      $out[] = strtolower($f->getAttribute('method') ?: 'get') . ' ' . mb_substr($a, 0, 60) . ' [' . implode(',', $fl) . ']';
    }
    return $out;
  }
  public static function verdict(array $o): string {
    if (!empty($o['cf']) || isset($o['cfKind'])) return 'cf';
    if ((int)($o['code'] ?? 0) !== 200) return 'down';
    if (!empty($o['widget'])) return 'captcha';
    if (!empty($o['pass'])) return 'login';
    if (!empty($o['spa'])) return 'spa';
    if (!empty($o['forms']) && !empty($o['fields'])) return 'form';
    return 'page';
  }
  public static function summary(): array { $n = []; foreach (self::read() as $o) { $v = (string)($o['verdict'] ?? '?'); $n[$v] = ($n[$v] ?? 0) + 1; } return $n; }
  /** /api/health → prov.list: по каждому адресу справочника (сайты поставщиков, не людей) — вердикт, код, пароль/формы/поля, капча, Cloudflare;
   *  где в справочнике (регион:громада.вид.поле) и что там стоит в robot — чтобы проставить robot без /admin. */
  public static function brief(): array {
    $o = []; $urls = self::urls();
    foreach (self::read() as $url => $x) {
      $w = []; foreach ((array)($urls[$url] ?? []) as [$r, $sc, $key, $kd, $f]) {
        $d = Providers::rdata($r); $node = $sc === 'oblast' ? (array)($d['oblast'][$kd] ?? []) : (array)($d[$sc][$key][$kd] ?? []);
        $w[] = $r . ':' . ($sc === 'oblast' ? 'oblast' : $key) . '.' . $kd . '.' . $f . (isset($node['robot']) ? '=' . $node['robot'] : '');
      }
      $o[mb_substr(preg_replace('~^https://~', '', (string)$url), 0, 90)] = array_filter(['v' => $x['verdict'] ?? null, 'code' => $x['code'] ?? null, 'ms' => $x['ms'] ?? null, 'err' => $x['err'] ?? null,
        'pass' => !empty($x['pass']) ?: null, 'forms' => $x['forms'] ?? null, 'fields' => !empty($x['fields']) ? implode(',', (array)$x['fields']) : null,
        'cap' => !empty($x['widget']) ? 'widget' : (!empty($x['script']) ? 'script' : null), 'cf' => $x['cfKind'] ?? (!empty($x['cf']) ? 'cf' : null), 'spa' => !empty($x['spa']) ?: null,
        'fset' => !empty($x['fset']) ? mb_substr(implode(' | ', (array)$x['fset']), 0, 900) : null,
        'at' => isset($x['at']) ? substr((string)$x['at'], 0, 16) : null, 'in' => $w ?: null], fn($v) => $v !== null && $v !== 0 && $v !== '');
    }
    ksort($o); return $o;
  }
}

/** /admin → «Справочник»: обзор регионов, громады области, запись для правки, что ищут люди. Только чтение — пишет ProvEdit. */
final class ProvAdmin {
  private static function hmap(string $r): array {
    $k = Providers::kat(); $o = [];
    foreach ((array)$k['hromadas'] as $id => $h) if (($h['r'] ?? '') === $r) $o[(string)$id] = $h;
    return $o;
  }
  private static function short(?array $o, string $kd): ?array {
    if (!$o) return null;
    $x = ['org' => $o['org'] ?? null];
    foreach (['supply', 'drain', 'hot', 'price', 'abon', 'from', 'grm', 'dist', 'check', 'robot'] as $f) if (array_key_exists($f, $o)) $x[$f] = $o[$f];
    foreach (['cab', 'bot', 'site', 'app'] as $f) if (!empty($o[$f])) $x['ch'][] = $f;
    return $x;
  }
  public static function overview(): array {
    $regs = []; $seen = ProvEdit::seenAll(); $edits = (array)(ProvEdit::all()['r'] ?? []);
    foreach (Providers::REGIONS as $r => $name) {
      $hm = self::hmap($r); $d = Providers::rdata($r); $w = 0; $wt = 0; $h = 0;
      foreach ($hm as $id => $x) { $e = (array)($d['hromadas'][Providers::hkey((string)$id)] ?? []); if (!empty($e['water']['org'])) $w++; if (isset($e['water']['supply']) && $e['water']['supply'] !== null) $wt++; if (!empty($e['heat']['org'])) $h++; }
      $ne = 0; foreach ((array)($edits[$r] ?? []) as $sc => $x) $ne += $sc === 'oblast' ? count((array)$x) : array_sum(array_map(fn($y) => count((array)$y), (array)$x));
      $regs[] = ['r' => $r, 'name' => $name, 'hromadas' => count($hm), 'water' => $w, 'waterTariff' => $wt, 'heat' => $h, 'settlements' => count($d['settlements']), 'edits' => $ne, 'updated' => $d['updated'],
        'elec' => $d['oblast']['elec']['org'] ?? null, 'gas' => $d['oblast']['gas']['grm'] ?? null];
    }
    $top = [];
    foreach ($seen as $k => $x) {
      if ($k === '_nf' || !str_contains((string)$k, '|')) continue;
      [$r, $hid] = explode('|', (string)$k, 2); if (!isset(Providers::kat()['hromadas'][$hid])) continue;
      $top[] = ['r' => $r, 'hid' => $hid, 'key' => Providers::hkey($hid), 'name' => Providers::hname($hid), 'oblast' => Providers::REGIONS[$r] ?? '', 'n' => (int)($x['n'] ?? 0), 'at' => $x['at'] ?? null, 'p' => $x['p'] ?? null,
        'w' => (int)($x['w'] ?? 0), 'h' => (int)($x['h'] ?? 0), 'wt' => (int)($x['wt'] ?? 0)];
    }
    usort($top, fn($a, $b) => [($b['w'] || !$b['wt']) ? 1 : 0, $b['n']] <=> [($a['w'] || !$a['wt']) ? 1 : 0, $a['n']]);
    return ['regions' => $regs, 'seen' => array_slice($top, 0, 60), 'nf' => (int)($seen['_nf']['n'] ?? 0), 'probe' => ProvProbe::summary(),
      'log' => array_slice((array)(ProvEdit::all()['log'] ?? []), 0, 40), 'edits' => ProvEdit::summary()];
  }
  /** /api/health → prov: регіони (громад, з водою), правки /admin (скільки, коли — сесії забрати в репозиторій), проба кабінетів, скільки адрес не знайшли. Без адрес і людей. */
  public static function health(): array {
    $s = ProvEdit::seenAll(); $o = ['regions' => [], 'edits' => ProvEdit::summary(), 'probe' => (object)ProvProbe::summary(), 'list' => (object)ProvProbe::brief(), 'nf' => (int)($s['_nf']['n'] ?? 0), 'seen' => count($s) - (isset($s['_nf']) ? 1 : 0)];
    foreach (Providers::REGIONS as $r => $n) { $d = Providers::rdata($r); $o['regions'][$r] = ['h' => count(self::hmap($r)), 'w' => count(array_filter($d['hromadas'], fn($x) => !empty($x['water']['org']))), 'u' => $d['updated']]; }
    return $o;
  }
  public static function region(string $r): array {
    if (!isset(Providers::REGIONS[$r])) throw new HttpError(422, 'bad_region');
    $k = Providers::kat(); $d = Providers::rdata($r); $edits = (array)(ProvEdit::all()['r'][$r] ?? []); $seen = ProvEdit::seenAll();
    $cnt = []; $ctr = [];
    foreach ((array)$k['settlements'] as $st) if (($st['r'] ?? '') === $r) { $cnt[$st['h']] = ($cnt[$st['h']] ?? 0) + 1; if (!isset($ctr[$st['h']])) $ctr[$st['h']] = $st['n']; }
    $list = [];
    foreach (self::hmap($r) as $id => $h) {
      $key = Providers::hkey((string)$id); $e = (array)($d['hromadas'][$key] ?? []); $sv = (array)($seen[$r . '|' . $id] ?? []);
      $st = 0; foreach (array_keys($d['settlements']) as $sk) if (str_starts_with((string)$sk, $key . '/')) $st++;
      $list[] = ['id' => (string)$id, 'key' => $key, 'name' => Providers::hname((string)$id), 'district' => (string)($k['districts'][$h['d']] ?? ''), 'center' => $ctr[$id] ?? '', 'points' => $cnt[$id] ?? 0,
        'water' => self::short($e['water'] ?? null, 'water'), 'heat' => self::short($e['heat'] ?? null, 'heat'), 'other' => array_values(array_diff(array_keys($e), ['water', 'heat'])),
        'edited' => array_keys((array)($edits['hromadas'][$key] ?? [])), 'own' => $st, 'seen' => $sv ? ['n' => (int)$sv['n'], 'at' => $sv['at'] ?? null] : null];
    }
    usort($list, fn($a, $b) => [$a['district'], $a['name']] <=> [$b['district'], $b['name']]);
    $ob = []; foreach (ProvEdit::KINDS as $kd) $ob[$kd] = self::short($d['oblast'][$kd] ?? null, $kd);
    return ['r' => $r, 'name' => Providers::REGIONS[$r], 'oblast' => $ob, 'oblastEdited' => array_keys((array)($edits['oblast'] ?? [])), 'hromadas' => $list, 'updated' => $d['updated']];
  }
  /** Запис для правки: по видах — що діє (з правками), що в репозиторії, чи правлено; пункти громади (для «свій постачальник у пункті»); проба адрес. */
  public static function entry(string $r, string $scope, string $key): array {
    if (!isset(Providers::REGIONS[$r]) || !in_array($scope, ProvEdit::SCOPES, true) || !ProvEdit::keyOk($r, $scope, $key)) throw new HttpError(422, 'bad_key');
    $raw = Providers::raw($r); $edits = (array)(ProvEdit::all()['r'][$r] ?? []); $pr = ProvProbe::read(); $kinds = [];
    foreach (ProvEdit::KINDS as $kd) {
      $cur = ProvEdit::cur($r, $scope, $key, $kd);
      $base = $scope === 'oblast' ? ($raw['oblast'][$kd] ?? null) : ($raw[$scope][$key][$kd] ?? null);
      $ed = $scope === 'oblast' ? array_key_exists($kd, (array)($edits['oblast'] ?? [])) : array_key_exists($kd, (array)($edits[$scope][$key] ?? []));
      $pb = []; foreach (['cab', 'site'] as $f) if (!empty($cur[$f]) && isset($pr[$cur[$f]])) $pb[$f] = $pr[$cur[$f]];
      $kinds[$kd] = ['cur' => $cur, 'base' => $base, 'edited' => $ed, 'probe' => $pb ?: null];
    }
    $pts = [];
    if ($scope === 'hromadas') {
      $hid = ''; foreach (self::hmap($r) as $id => $h) if (Providers::hkey((string)$id) === $key) $hid = (string)$id;
      $d = Providers::rdata($r);
      foreach ((array)Providers::kat()['settlements'] as $st) if ($st['h'] === $hid) $pts[] = ['n' => $st['n'], 'c' => $st['c'], 'own' => isset($d['settlements'][$key . '/' . $st['n']])];
    }
    // що побачить людина (із підстановкою з області): для громади — по її центру, для пункту — по ньому
    $show = null;
    if ($scope !== 'oblast') {
      [$hk, $pn] = array_pad(explode('/', $key, 2), 2, '');
      foreach ((array)Providers::kat()['settlements'] as $st) if (($st['r'] ?? '') === $r && Providers::hkey((string)$st['h']) === $hk && ($pn === '' || $st['n'] === $pn)) {
        $show = Providers::kinds(['n' => $st['n'], 'h' => $st['h'], 'r' => $r]); break;
      }
    }
    return ['r' => $r, 'region' => Providers::REGIONS[$r], 'scope' => $scope, 'key' => $key, 'kinds' => $kinds, 'points' => $pts, 'show' => $show, 'robot' => ProvEdit::ROBOT];
  }
}
