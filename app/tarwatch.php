<?php
// 194-я (владелец 27.11): слежение за тарифами без нейросети и без токенов — сервер сам, по кругу.
// Источники: 1) сводные таблицы index.minfin.com.ua (вода — с датой «з …», доставка газа — «з 1.11.2026», тепло — без дат);
// 2) страницы КП из справочника — поле `tar` («Тарифи», «Повідомлення про намір»), иначе `site`: новые ссылки про тарифы и числа «₴/м³», «₴/Гкал».
// Изменение → tar_changes (было → стало, с какой даты, документ и ссылка, где увидели), владельцу — Telegram сразу и строка в письме-сводке;
// /admin → «Тарифы»: «Принять в справочник» (ProvEdit: next {from, …, doc, url} — людям плашка и бот за 45 дней со ссылкой на решение) / «Игнорировать».
// Честно: PDF-сканы и сайты за Cloudflare без нейросети не прочитать — для них сигнал «появилось / изменилось», цифры вписывает владелец или сессия.
declare(strict_types=1);
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class TarWatch {
  const MINFIN = 'https://index.minfin.com.ua';
  const MF_EVERY = 12 * 3600, MF_RETRY = 3 * 3600, KP_DAYS = 3, KP_RETRY = 86400;
  const KP_KINDS = ['water', 'heat', 'waste'];
  /** Посилання «про тарифи»: тариф, намір змінити, вартість послуг (uk/ru). */
  const LINK_RE = '/тариф|намір\P{L}{1,3}\p{L}*\s*(змін|встановл|перегляд|коригув)|вартост[іи]\s+(послуг|1\s*м)|намерени[ея]\s*\p{L}*\s*(измен|установ)/iu';
  /** Слова, що не розрізняють постачальників («КП», «ТОВ», «м.», «міської ради»…). «міська» лишається: «Харківська міська філія» ≠ «Харківська філія». */
  const STOP = ['кп', 'кпп', 'тов', 'пат', 'прат', 'ат', 'дп', 'вкп', 'вкг', 'квп', 'кву', 'лмкп', 'мкп', 'лкп', 'бмр', 'ак', 'комунальне', 'комунальна', 'підприємство', 'підприємства', 'товариство',
    'з', 'обмеженою', 'відповідальністю', 'акціонерне', 'акціонерна', 'компанія', 'приватне', 'концерн', 'м', 'місто', 'міста', 'міської', 'ради', 'рада', 'обласної', 'селищної', 'сільської', 'зор'];
  /** Загальні назви: одне таке слово — не підстава вважати постачальників тими самими. */
  const GENERIC = ['водоканал', 'водоканалу', 'тепломережа', 'тепломережі', 'теплоенерго', 'теплокомуненерго', 'водопостачання', 'комунальник', 'житлокомунсервіс'];
  public static ?int $now = null;   // тести

  private static function now(): int { return self::$now ?? time(); }
  private static function today(): string { return (new DateTimeImmutable('@' . self::now()))->setTimezone(new DateTimeZone('Europe/Kyiv'))->format('Y-m-d'); }
  public static function file(): string { return Cfg::data() . '/cache/tar_watch.json'; }
  private static function state(): array { $j = json_decode((string)@file_get_contents(self::file()), true); return is_array($j) ? $j : []; }
  private static function stateSet(array $add): void { $j = array_merge(self::state(), $add); @mkdir(dirname(self::file()), 0700, true); @file_put_contents(self::file(), json_encode($j, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX); }

  public static function table(): void {
    static $done = null; $pdo = Db::pdo(); if ($done === spl_object_id($pdo)) return; $done = spl_object_id($pdo);
    $my = Db::driver() !== 'sqlite';
    $ai = $my ? 'INT UNSIGNED AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'; $txt = $my ? 'MEDIUMTEXT' : 'TEXT'; $tail = $my ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';
    // джерело: id = sha1(url); type mf (minfin) | kp (сторінка КП); snap — останній знімок (рядки таблиці / посилання й числа), seen — усі колись бачені посилання про тарифи
    $pdo->exec("CREATE TABLE IF NOT EXISTS tar_src (id CHAR(40) PRIMARY KEY, url VARCHAR(600) NOT NULL, type VARCHAR(4) NOT NULL, at INT NOT NULL DEFAULT 0, ok_at INT NOT NULL DEFAULT 0, first_at INT NOT NULL DEFAULT 0,
      code INT NOT NULL DEFAULT 0, err VARCHAR(120) NULL, hash CHAR(40) NULL, snap $txt NULL, seen $txt NULL, n_ok INT NOT NULL DEFAULT 0, n_fail INT NOT NULL DEFAULT 0)$tail");
    // зміна: src mf | mfs (minfin проти свого минулого знімка) | kp (нове посилання) | kpn (числа на сторінці тарифів); places — [[r, scope, key, kind], …] записи довідника;
    // was / val — {supply, drain, price, dist} або {nums}; status new | accepted | ignored | stale (новіша зміна того ж постачальника)
    $pdo->exec("CREATE TABLE IF NOT EXISTS tar_changes (id $ai, at INT NOT NULL, src VARCHAR(4) NOT NULL, sig CHAR(40) NOT NULL UNIQUE, r VARCHAR(4) NOT NULL, kind VARCHAR(8) NOT NULL, org VARCHAR(255) NULL,
      places TEXT NOT NULL, was TEXT NULL, val TEXT NULL, pct DOUBLE NULL, dfrom CHAR(10) NULL, doc VARCHAR(300) NULL, url VARCHAR(600) NULL, page VARCHAR(600) NULL,
      status VARCHAR(8) NOT NULL DEFAULT 'new', done_at INT NULL, done_by VARCHAR(80) NULL, acc TEXT NULL, tg TINYINT NOT NULL DEFAULT 0)$tail");
  }

  // ---------- джерела ----------
  /** Сторінки minfin: url → [вид, чи порівнювати з довідником]. Тепло — таблиця на 01.02.2021 (мораторій): лише зміни проти минулого знімка. Наступний рік води — з вересня. */
  public static function minfin(): array {
    $o = [self::MINFIN . '/ua/tariff/water/' => ['water', true], self::MINFIN . '/ua/tariff/gas/distrib/' => ['gas', true], self::MINFIN . '/ua/tariff/heating/' => ['heat', false]];
    $d = new DateTimeImmutable('@' . self::now());
    if ((int)$d->format('n') >= 9) $o[self::MINFIN . '/ua/tariff/water/' . ((int)$d->format('Y') + 1) . '/'] = ['water', true];
    return $o;
  }
  /** Усі записи довідника (з правками /admin): [[r, scope, key, kind, obj], …] — без підстановки з рівня вище. */
  public static function entries(): array {
    $o = [];
    foreach (array_keys(Providers::REGIONS) as $r) {
      $d = Providers::rdata($r);
      foreach ((array)$d['oblast'] as $kd => $x) if (is_array($x)) $o[] = [$r, 'oblast', '', (string)$kd, $x];
      foreach (['hromadas', 'settlements'] as $sc) foreach ((array)$d[$sc] as $key => $kinds) foreach ((array)$kinds as $kd => $x) if (is_array($x) && in_array($kd, ProvEdit::KINDS, true)) $o[] = [$r, $sc, (string)$key, (string)$kd, $x];
    }
    return $o;
  }
  /** Сторінки КП: url → [[r, scope, key, kind, org], …] — `tar` (сторінка тарифів), інакше `site` (вода, тепло, вивіз). */
  public static function pages(): array {
    $u = [];
    foreach (self::entries() as [$r, $sc, $key, $kd, $x]) {
      if (!in_array($kd, self::KP_KINDS, true) || empty($x['org'])) continue;
      $url = (string)($x['tar'] ?? '') ?: (string)($x['site'] ?? '');
      if (!preg_match('~^https://[^\s"<>]+$~', $url)) continue;
      $u[$url][] = [$r, $sc, $key, $kd, (string)$x['org']];
    }
    return $u;
  }
  public static function srcAll(): array { self::table(); $o = []; foreach (Db::q('SELECT * FROM tar_src')->fetchAll() as $x) $o[$x['id']] = $x; return $o; }

  /** Один крок cron: minfin (раз на 12 год) — першим, далі найдавніше перевірена сторінка КП (раз на 3 дні). → що перевірили або null. */
  public static function run(?int $now = null): ?array {
    if ($now !== null) self::$now = $now; $now = self::now();
    $rows = self::srcAll();
    foreach (self::minfin() as $url => [$kd, $cmp]) {
      $s = $rows[sha1($url)] ?? null; $wait = $s && (int)$s['code'] !== 200 ? self::MF_RETRY : self::MF_EVERY;
      if (!$s || $now - (int)$s['at'] >= $wait) return self::check($url);
    }
    $best = null;
    foreach (array_keys(self::pages()) as $url) {
      $s = $rows[sha1($url)] ?? null; $at = (int)($s['at'] ?? 0);
      $wait = $s && (int)$s['code'] !== 200 && (int)$s['n_ok'] === 0 && (int)$s['n_fail'] >= 3 ? 7 * 86400 : ($s && (int)$s['code'] !== 200 ? self::KP_RETRY : self::KP_DAYS * 86400);
      if ($now - $at >= $wait && ($best === null || $at < $best[1])) $best = [$url, $at];
    }
    return $best ? self::check($best[0]) : null;
  }
  /** Перевірити одне джерело зараз (cron або «Проверить сейчас» у /admin). → {url, type, code, changes}. */
  public static function check(string $url): array {
    self::table(); $mf = self::minfin(); $isMf = isset($mf[$url]) || str_starts_with($url, self::MINFIN . '/');
    $r = self::fetch($url); $now = self::now(); $id = sha1($url);
    $old = Db::one('SELECT * FROM tar_src WHERE id = ?', [$id]);
    $base = ['id' => $id, 'url' => mb_substr($url, 0, 600), 'type' => $isMf ? 'mf' : 'kp', 'at' => $now, 'code' => $r['code'], 'err' => $r['err'] ? mb_substr((string)$r['err'], 0, 120) : null];
    $n = 0; $snap = null;
    if ($r['code'] === 200 && $r['body'] !== '') {
      if ($isMf) { $kd = $mf[$url][0] ?? (str_contains($url, '/gas/') ? 'gas' : (str_contains($url, '/heating/') ? 'heat' : 'water')); $cmp = $mf[$url][1] ?? true;
        $rows = self::mfParse($r['body']); $seen = null;
        if (!$rows) $base['err'] = 'no_table';   // сторінку переробили — старий знімок лишаємо (інакше наступна перевірка вважала б усі рядки новими)
        else { $snap = ['rows' => $rows]; $prevRows = $old && $old['snap'] ? (array)(json_decode((string)$old['snap'], true)['rows'] ?? []) : null; $n = self::mfChanges($url, $kd, $cmp, $rows, $prevRows ?: null, $snap); }
      } else {
        $snap = self::kpParse($r['body'], $r['url']); $prev = $old ? (array)json_decode((string)$old['snap'], true) : null;
        $seen = $old ? (array)json_decode((string)$old['seen'], true) : [];
        $n = self::kpChanges($url, $snap, $prev, $seen);
        $seen = array_slice(array_values(array_unique(array_merge(array_keys((array)$snap['links']), $seen))), 0, 500);
      }
      $base['ok_at'] = $now;
      if ($snap !== null) $base += ['hash' => sha1(json_encode($snap, JSON_UNESCAPED_UNICODE)), 'snap' => json_encode($snap, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 'seen' => $seen === null ? null : json_encode($seen, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)];
    }
    if ($old) {
      $set = $base; unset($set['id']);
      $set['n_ok'] = (int)$old['n_ok'] + ($r['code'] === 200 ? 1 : 0); $set['n_fail'] = (int)$old['n_fail'] + ($r['code'] === 200 ? 0 : 1);
      Db::q('UPDATE tar_src SET ' . implode(', ', array_map(fn($k) => "$k = ?", array_keys($set))) . ' WHERE id = ?', [...array_values($set), $id]);
    } else {
      $base += ['first_at' => $now, 'n_ok' => $r['code'] === 200 ? 1 : 0, 'n_fail' => $r['code'] === 200 ? 0 : 1];
      Db::q('INSERT INTO tar_src (' . implode(', ', array_keys($base)) . ') VALUES (' . implode(', ', array_fill(0, count($base), '?')) . ')', array_values($base));
    }
    self::stateSet(['last' => ['at' => $now, 'host' => (string)parse_url($url, PHP_URL_HOST), 'code' => $r['code'], 'n' => $n]]);
    return ['url' => $url, 'type' => $base['type'], 'code' => $r['code'], 'changes' => $n] + ($base['err'] ? ['err' => $base['err']] : []);
  }
  public static function fetch(string $url): array {
    $host = preg_replace('/^www\./i', '', (string)parse_url($url, PHP_URL_HOST));
    if ($host === '' || !str_starts_with($url, 'https://')) return ['code' => 0, 'body' => '', 'err' => 'bad_url', 'url' => $url];
    $w = new CabWeb('/^(www\.)?' . preg_quote($host, '/') . '$/i', 20.0);
    $r = $w->req('GET', $url);
    $b = (string)($r['body'] ?? '');
    if ($b !== '' && !str_starts_with($b, '%PDF-') && !mb_check_encoding($b, 'UTF-8')) $b = (string)mb_convert_encoding($b, 'UTF-8', 'Windows-1251');
    if (str_starts_with($b, '%PDF-')) $b = '';   // PDF без нейросети не читаємо — лише «сторінка є»
    return ['code' => (int)$r['code'], 'body' => $b, 'err' => $r['err'] ?? null, 'url' => (string)($r['url'] ?? $url)];
  }

  // ---------- minfin ----------
  private static function txt(string $s): string { return trim(preg_replace('/\s+/u', ' ', str_replace(["\u{AD}", "\u{A0}"], ['', ' '], $s))); }
  private static function date(string $s): ?string { return preg_match('/з\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/u', $s, $m) ? sprintf('%04d-%02d-%02d', $m[3], $m[2], $m[1]) : null; }
  /** Таблиці minfin (class grid / grid2) → [{reg, org, n: [числа], from, two}]: область — рядок th.region; «двоставковий» тариф — two (частини нижче — пропускаємо). */
  public static function mfParse(string $html): array {
    $x = CabWeb::dom($html); $out = [];
    foreach ($x->query('//table[contains(@class, "grid")]') as $t) {
      $cap = $x->query('./caption', $t)->item(0); $capFrom = $cap ? self::date(self::txt($cap->textContent)) : null; $reg = '';
      foreach ($x->query('.//tr', $t) as $tr) {
        $ths = $x->query('./th', $tr); $tds = $x->query('./td', $tr);
        if ($ths->length === 1 && $tds->length === 0) { $th = $ths->item(0); if ($th instanceof DOMElement && str_contains($th->getAttribute('class'), 'region')) $reg = self::txt($th->textContent); continue; }
        if ($tds->length < 2) continue;
        $cells = []; foreach ($tds as $td) $cells[] = self::txt($td->textContent);
        $name = $cells[0]; if ($name === '' || preg_match('/^(умовно|разом|–|-)/iu', $name)) continue;
        $nums = []; $from = null; $two = false;
        foreach (array_slice($cells, 1) as $c) {
          if (preg_match('/^\d[\d ]*,\d+$/u', $c)) $nums[] = (float)str_replace([' ', ','], ['', '.'], $c);
          elseif (($d = self::date($c)) !== null) $from = $d;
          elseif (preg_match('/двоставк/iu', $c)) $two = true;
        }
        if (!$nums && !$two) continue;
        $out[] = ['reg' => $reg, 'org' => mb_substr($name, 0, 200), 'n' => $nums, 'from' => $from ?? $capFrom, 'two' => $two];
      }
    }
    return $out;
  }
  /** «Харківська обл.» → коди регіонів довідника (Київська обл. на minfin — і Київ: «Київводоканал», «Київгаз»). */
  public static function mfRegion(string $s): array {
    $s = mb_strtolower($s);
    foreach (['харків' => ['kh'], 'київськ' => ['kv', 'ky'], 'київ' => ['ky'], 'одес' => ['od'], 'львів' => ['lv'], 'хмельниц' => ['km'], 'запоріз' => ['zp']] as $k => $r) if (str_contains($s, $k)) return $r;
    return [];
  }
  /** Назва постачальника → значущі слова (без «КП», лапок, «м.», «міської ради»). */
  public static function words(string $s): array {
    $s = mb_strtolower(str_replace(["\u{AD}", 'ʼ', '’', "'", '`'], '', $s));
    $w = preg_split('/[^\p{L}\p{N}]+/u', $s, -1, PREG_SPLIT_NO_EMPTY) ?: [];
    $w = array_values(array_unique(array_filter($w, fn($x) => !in_array($x, self::STOP, true))));
    sort($w); return $w;
  }
  /** Чи той самий постачальник: однакові слова; або менший набір усередині більшого — коли в ньому ≥ 2 слів чи одне довге не загальне. Газ — лише однакові (міська й обласна філії). */
  public static function same(string $a, string $b, bool $exact = false): bool {
    $x = self::words($a); $y = self::words($b); if (!$x || !$y) return false;
    if ($x === $y) return true; if ($exact) return false;
    [$s, $l] = count($x) <= count($y) ? [$x, $y] : [$y, $x];
    if (array_diff($s, $l)) return false;
    return count($s) >= 2 || (mb_strlen($s[0]) >= 8 && !in_array($s[0], self::GENERIC, true));
  }
  /** Значення рядка minfin за видом. */
  private static function mfVal(string $kd, array $row): ?array {
    $n = (array)$row['n'];
    if ($kd === 'water') return count($n) >= 2 ? ['supply' => $n[0], 'drain' => $n[1]] : null;
    if ($kd === 'heat') return !empty($row['two']) || !$n ? null : ['price' => $n[0]];
    if ($kd === 'gas') return $n ? ['dist' => $n[0]] : null;
    return null;
  }
  private static function eq(array $a, array $b): bool { foreach ($a as $k => $v) { if (!isset($b[$k]) || $b[$k] === null || abs((float)$b[$k] - (float)$v) >= 0.006) return false; } return true; }
  /** Відсоток зміни: вода — разом вода й стоки, тепло — ціна, газ — доставка. */
  public static function pct(?array $was, ?array $val): ?float {
    if (!$was || !$val) return null; $a = 0.0; $b = 0.0;
    foreach (['supply', 'drain', 'price', 'dist'] as $f) if (isset($val[$f])) { if (!isset($was[$f]) || $was[$f] === null || (float)$was[$f] <= 0) return null; $a += (float)$was[$f]; $b += (float)$val[$f]; }
    return $a > 0 ? round(($b / $a - 1) * 100, 1) : null;
  }
  /** Записи довідника цього постачальника (того ж виду, в регіонах рядка). Газ — за оператором ГРМ (grm), решта — за org. */
  private static function mfPlaces(string $kd, array $row, array $regs): array {
    $out = [];
    foreach (self::entries() as [$r, $sc, $key, $k, $x]) {
      if ($k !== $kd || !in_array($r, $regs, true)) continue;
      $nm = $kd === 'gas' ? (string)($x['grm'] ?? '') : (string)($x['org'] ?? ''); if ($nm === '') continue;
      if (self::same($nm, (string)$row['org'], $kd === 'gas')) $out[] = [$r, $sc, $key, $k, $x];
    }
    return $out;
  }
  /** Зміни з однієї таблиці minfin. $cmp — порівнювати з довідником (вода, газ); інакше й для рядків без запису — проти минулого знімка. → скільки нових змін. */
  private static function mfChanges(string $url, string $kd, bool $cmp, array $rows, ?array $prev, array &$snap): int {
    $n = 0; $pv = []; foreach ((array)$prev as $p) $pv[$p['reg'] . '|' . $p['org']] = $p; $hits = []; $today = self::today();
    foreach ($rows as $row) {
      $regs = self::mfRegion((string)$row['reg']); if (!$regs) continue;
      $val = self::mfVal($kd, $row); if (!$val) continue;
      $pl = self::mfPlaces($kd, $row, $regs); foreach ($pl as $p) $hits[] = $p[0] . '|' . $p[1] . '|' . $p[2] . '|' . $kd;
      $from = $row['from'] ?? null;
      if ($cmp && $pl) {
        // довідник: чинне (dated) і наступні кроки; minfin старіший за довідник — пропускаємо (довідник уже знає новіше)
        $diff = []; $was = null;
        foreach ($pl as [$r, $sc, $key, $k, $x]) {
          $eff = Providers::dated($x, $today); $effFrom = (string)($kd === 'gas' ? ($eff['distFrom'] ?? '') : ($eff['from'] ?? ''));
          $cur = array_intersect_key($eff, $val); if (self::eq($val, $cur)) continue;
          $steps = isset($x['next']) ? (array_is_list((array)$x['next']) ? (array)$x['next'] : [$x['next']]) : []; $inNext = false;
          foreach ($steps as $s) if (is_array($s) && self::eq($val, $s)) $inNext = true;
          if ($inNext || ($from !== null && $effFrom !== '' && $from < $effFrom)) continue;
          $diff[] = [$r, $sc, $key, $k]; $was = $was ?? array_map(fn($f) => isset($eff[$f]) ? (float)$eff[$f] : null, array_combine(array_keys($val), array_keys($val)));
        }
        if ($diff) $n += self::add('mf', $kd, (string)$row['org'], $diff, $was, $val, $from, null, null, $url, $regs[0]);
        continue;
      }
      // без порівняння з довідником (тепло, чи постачальника в довіднику немає): лише якщо рядок змінився проти минулого знімка
      if ($prev === null) continue;
      $p = $pv[$row['reg'] . '|' . $row['org']] ?? null; $pval = $p ? self::mfVal($kd, $p) : null;
      if ($pval && self::eq($val, $pval) && ($p['from'] ?? null) === $from) continue;
      $places = array_map(fn($x) => [$x[0], $x[1], $x[2], $x[3]], $pl);
      $n += self::add('mfs', $kd, (string)$row['org'], $places, $pval, $val, $from, $p ? null : 'Новий рядок у таблиці minfin', null, $url, $regs[0]);
    }
    $snap['hits'] = array_values(array_unique($hits));
    return $n;
  }

  // ---------- сторінки КП ----------
  /** Сторінка КП → {links: {url: текст}, nums: ['41.688 м³', …], title}: посилання про тарифи й числа «грн/₴ за м³ / Гкал / особу» з тексту. */
  public static function kpParse(string $html, string $base): array {
    $x = CabWeb::dom($html); $links = [];
    foreach ($x->query('//script|//style|//noscript') as $n) $n->parentNode?->removeChild($n);
    foreach ($x->query('//a[@href]') as $a) {
      if (!$a instanceof DOMElement) continue;
      $h = trim($a->getAttribute('href')); if ($h === '' || $h[0] === '#' || preg_match('/^(javascript|mailto|tel|viber|tg):/i', $h)) continue;
      $t = self::txt($a->textContent . ' ' . $a->getAttribute('title'));
      if (!preg_match(self::LINK_RE, $t) && !preg_match('/tarif|taryf/i', $h)) continue;
      $u = preg_replace('/#.*$/', '', CabWeb::abs($h, $base)); if (!preg_match('~^https?://[^\s"<>]+$~', $u)) continue;
      if (!isset($links[$u])) $links[$u] = mb_substr($t !== '' ? $t : basename((string)parse_url($u, PHP_URL_PATH)), 0, 240);
      if (count($links) >= 80) break;
    }
    $body = $x->query('//body')->item(0); $text = self::txt($body ? $body->textContent : '');
    $nums = [];
    if (preg_match_all('/(\d{1,3}(?: \d{3})*(?:[,.]\d{1,3})?)\s*(?:грн\.?|₴|гривень|гривні)\s*(?:\/|за|з|на|в|у|без|з ПДВ|\(з ПДВ\))?\s*(?:ПДВ\)?\s*)?(?:за\s*)?(?:1\s*)?(м³|м3|м\.куб|куб|гкал|особ|люд|мешканц)/iu', $text, $m, PREG_SET_ORDER))
      foreach ($m as $g) { $v = (float)str_replace([' ', ','], ['', '.'], $g[1]); if ($v <= 0 || $v >= 100000) continue;
        $u = mb_strtolower($g[2]); $u = str_starts_with($u, 'гкал') ? 'Гкал' : (preg_match('/^(особ|люд|меш)/u', $u) ? 'особа' : 'м³'); $nums[] = rtrim(rtrim(sprintf('%.3f', $v), '0'), '.') . ' ' . $u; }
    $nums = array_slice(array_values(array_unique($nums)), 0, 40); sort($nums);
    $tt = $x->query('//title')->item(0);
    return ['links' => $links, 'nums' => $nums, 'title' => $tt ? mb_substr(self::txt($tt->textContent), 0, 160) : ''];
  }
  /** Нові посилання про тарифи (яких ще не бачили) і зміна чисел на сторінці тарифів (`tar`). Перший знімок — точка відліку, без сигналів. */
  private static function kpChanges(string $url, array $snap, ?array $prev, array $seen): int {
    if ($prev === null) return 0;
    $who = self::pages()[$url] ?? []; if (!$who) return 0;
    $places = array_map(fn($x) => [$x[0], $x[1], $x[2], $x[3]], $who); $org = (string)$who[0][4]; $kd = (string)$who[0][3]; $r = (string)$who[0][0];
    $isTar = false; foreach (self::entries() as [$rr, $sc, $key, $k, $x]) if (($x['tar'] ?? '') === $url) { $isTar = true; break; }
    $new = array_diff_key((array)$snap['links'], array_flip($seen), (array)($prev['links'] ?? []));
    $n = 0;
    if (count($new) > 5) $n += self::add('kp', $kd, $org, $places, null, null, null, 'На сторінці ' . count($new) . ' нових посилань про тарифи (сайт оновили?) — перегляньте', $url, $url, $r);
    else foreach ($new as $u => $t) $n += self::add('kp', $kd, $org, $places, null, null, self::dateIn($t), $t, $u, $url, $r);
    $a = (array)($prev['nums'] ?? []); $b = (array)$snap['nums'];
    if ($isTar && $b && $a !== $b) $n += self::add('kpn', $kd, $org, $places, ['nums' => $a], ['nums' => $b], null, 'Змінились суми на сторінці тарифів', $url, $url, $r);
    return $n;
  }
  /** Дата в тексті посилання («з 01.01.2027», «від 23.09.2026») — підказка для форми, не більше. */
  private static function dateIn(string $t): ?string { return preg_match('/з\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/u', $t, $m) ? sprintf('%04d-%02d-%02d', $m[3], $m[2], $m[1]) : null; }

  // ---------- зміни ----------
  /** Записати зміну (те саме — один раз за sig). Попередня нова зміна того ж постачальника з того ж джерела — stale. → 1 | 0. */
  private static function add(string $src, string $kd, string $org, array $places, ?array $was, ?array $val, ?string $from, ?string $doc, ?string $link, string $page, string $r): int {
    $sig = sha1(implode('|', [$src, $kd, $org, json_encode($val), (string)$from, $src === 'kp' ? (string)$link : '', $src === 'kpn' ? $page : '']));
    if (Db::one('SELECT 1 AS x FROM tar_changes WHERE sig = ?', [$sig])) return 0;
    if (in_array($src, ['mf', 'mfs'], true)) Db::q("UPDATE tar_changes SET status = 'stale' WHERE status = 'new' AND src = ? AND kind = ? AND org = ?", [$src, $kd, $org]);
    if ($src === 'kpn') Db::q("UPDATE tar_changes SET status = 'stale' WHERE status = 'new' AND src = 'kpn' AND page = ?", [$page]);
    Db::q('INSERT INTO tar_changes (at, src, sig, r, kind, org, places, was, val, pct, dfrom, doc, url, page, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      self::now(), $src, $sig, $r, $kd, mb_substr($org, 0, 255), json_encode(array_values($places), JSON_UNESCAPED_UNICODE),
      $was === null ? null : json_encode($was, JSON_UNESCAPED_UNICODE), $val === null ? null : json_encode($val, JSON_UNESCAPED_UNICODE),
      self::pct($was, $val), $from, $doc === null ? null : mb_substr($doc, 0, 300), $link === null ? null : mb_substr($link, 0, 600), mb_substr($page, 0, 600), 'new']);
    return 1;
  }
  public static function row(array $x): array {
    $pl = (array)json_decode((string)$x['places'], true);
    return ['id' => (int)$x['id'], 'at' => gmdate('c', (int)$x['at']), 'src' => $x['src'], 'r' => $x['r'], 'region' => Providers::REGIONS[$x['r']] ?? $x['r'], 'kind' => $x['kind'], 'org' => $x['org'],
      'places' => array_map(fn($p) => ['r' => $p[0], 'scope' => $p[1], 'key' => $p[2], 'kind' => $p[3] ?? $x['kind']], $pl),
      'was' => $x['was'] === null ? null : json_decode((string)$x['was'], true), 'val' => $x['val'] === null ? null : json_decode((string)$x['val'], true),
      'pct' => $x['pct'] === null ? null : (float)$x['pct'], 'from' => $x['dfrom'], 'doc' => $x['doc'], 'url' => $x['url'], 'page' => $x['page'], 'status' => $x['status'],
      'doneAt' => $x['done_at'] ? gmdate('c', (int)$x['done_at']) : null, 'doneBy' => $x['done_by'], 'acc' => $x['acc'] ? json_decode((string)$x['acc'], true) : null];
  }
  /** Прийняти в довідник: next {from, значення, doc, url} кожному вибраному запису (газ — доставка з датою). → {ok, saved}. */
  public static function accept(array $in, string $who): array {
    self::table(); $c = Db::one('SELECT * FROM tar_changes WHERE id = ?', [(int)($in['id'] ?? 0)]); if (!$c) throw new HttpError(404, 'not_found');
    $from = trim((string)($in['from'] ?? '')); if (!preg_match('/^\d{4}-\d\d-\d\d$/', $from) || !strtotime($from)) throw new HttpError(422, 'bad_from');
    $vals = [];
    foreach (['supply', 'drain', 'price', 'abon', 'dist'] as $f) if (isset($in[$f]) && trim((string)$in[$f]) !== '') {
      $v = str_replace([' ', "\u{A0}", ','], ['', '', '.'], trim((string)$in[$f])); if (!is_numeric($v) || (float)$v < 0 || (float)$v >= 100000) throw new HttpError(422, 'bad_' . $f);
      $vals[$f] = round((float)$v, 4);
    }
    if (!$vals) throw new HttpError(422, 'no_values');
    $doc = mb_substr(trim((string)($in['doc'] ?? '')), 0, 240); $docRu = mb_substr(trim((string)($in['doc_ru'] ?? '')), 0, 240);
    $url = trim((string)($in['url'] ?? '')); if ($url !== '' && !preg_match('~^https://[^\s"<>]+$~', $url)) throw new HttpError(422, 'bad_url');
    $all = (array)json_decode((string)$c['places'], true); $pick = isset($in['places']) && is_array($in['places']) ? array_map('intval', $in['places']) : array_keys($all);
    $saved = [];
    foreach ($pick as $i) {
      $p = $all[$i] ?? null; if (!is_array($p)) continue; [$r, $sc, $key] = $p; $kd = (string)($p[3] ?? $c['kind']);
      $cur = ProvEdit::cur($r, $sc, $key, $kd); if (!is_array($cur)) continue;
      $v = array_intersect_key($vals, array_flip($kd === 'water' ? ['supply', 'drain'] : ($kd === 'gas' ? ['dist'] : ['price', 'abon'])));
      if (!$v) continue;
      ProvEdit::save($r, $sc, $key, $kd, self::withStep($cur, $kd, $from, $v, $doc, $docRu, $url), $who . ' · тариф');
      $saved[] = [$r, $sc, $key, $kd];
    }
    if (!$saved) throw new HttpError(422, 'nothing_saved');
    Db::q("UPDATE tar_changes SET status = 'accepted', done_at = ?, done_by = ?, acc = ? WHERE id = ?", [self::now(), mb_substr($who, 0, 80),
      json_encode(['from' => $from, 'vals' => $vals, 'doc' => $doc, 'url' => $url, 'places' => $saved], JSON_UNESCAPED_UNICODE), (int)$c['id']]);
    return ['ok' => true, 'saved' => count($saved)];
  }
  /** Крок тарифу в запис довідника: next з тією ж датою — замінити; кроки за датою. Вже настала дата — dated() сам зробить його чинним. */
  public static function withStep(array $o, string $kd, string $from, array $v, string $doc, string $docRu, string $url): array {
    $steps = isset($o['next']) ? (array_is_list((array)$o['next']) ? (array)$o['next'] : [$o['next']]) : [];
    $steps = array_values(array_filter($steps, fn($s) => is_array($s) && (string)($s['from'] ?? '') !== $from));
    $s = ['from' => $from] + $v;
    if ($doc !== '') $s['doc'] = $doc; if ($docRu !== '') $s['doc_ru'] = $docRu; if ($url !== '') $s['url'] = $url;
    $steps[] = $s; usort($steps, fn($a, $b) => strcmp((string)$a['from'], (string)$b['from']));
    $o['next'] = count($steps) === 1 ? $steps[0] : $steps;
    return $o;
  }
  public static function ignore(int $id, string $who): array {
    self::table(); if (!Db::one('SELECT 1 AS x FROM tar_changes WHERE id = ?', [$id])) throw new HttpError(404, 'not_found');
    Db::q("UPDATE tar_changes SET status = 'ignored', done_at = ?, done_by = ? WHERE id = ?", [self::now(), mb_substr($who, 0, 80), $id]);
    return ['ok' => true];
  }

  // ---------- повідомлення власнику ----------
  /** Telegram-чати власника (адміни з Telegram). */
  public static function chats(): array {
    $o = [];
    foreach (Db::q("SELECT u.id, u.email, i.external_id FROM users u JOIN user_identities i ON i.user_id = u.id AND i.type = 'telegram'")->fetchAll() as $x)
      if (Admin::is(['id' => (int)$x['id'], 'email' => $x['email']])) $o[] = (string)$x['external_id'];
    return array_values(array_unique($o));
  }
  private static function money(float $v): string { $s = rtrim(rtrim(number_format($v, 3, ',', ' '), '0'), ','); return $s; }
  private static function fdate(?string $d): string { return $d && preg_match('/^(\d{4})-(\d\d)-(\d\d)$/', $d, $m) ? "$m[3].$m[2].$m[1]" : ''; }
  /** Текст однієї зміни (власнику, по-російськи — як /admin). */
  public static function text(array $c): string {
    $K = ['water' => 'вода и водоотведение', 'heat' => 'тепло', 'gas' => 'доставка газа', 'waste' => 'вывоз мусора'];
    $U = ['supply' => ['вода', '₴/м³'], 'drain' => ['стоки', '₴/м³'], 'price' => ['', $c['kind'] === 'waste' ? '₴/чел.' : '₴/Гкал'], 'dist' => ['', '₴/м³']];
    $where = []; foreach ((array)$c['places'] as $p) $where[] = $p['scope'] === 'oblast' ? 'вся область' : str_replace('/', ' · ', (string)$p['key']);
    $t = (str_starts_with((string)$c['src'], 'mf') ? '📈 ' : '📰 ') . 'Тариф: ' . ($K[$c['kind']] ?? $c['kind']) . ' — ' . $c['org'] . "\n" . $c['region'] . ($c['r'] === 'ky' ? '' : ' обл.') . ($where ? ': ' . implode(', ', array_slice(array_unique($where), 0, 6)) . (count($where) > 6 ? ' и ещё ' . (count($where) - 6) : '') : ' (в справочнике нет)');
    if (is_array($c['val']) && !isset($c['val']['nums'])) {
      $ln = []; foreach ($c['val'] as $f => $v) { $o = $c['was'][$f] ?? null; $ln[] = trim(($U[$f][0] ?? $f) . ' ' . ($o !== null ? self::money((float)$o) . ' → ' : '') . self::money((float)$v) . ' ' . ($U[$f][1] ?? '')); }
      $t .= "\n" . implode('; ', $ln) . ($c['pct'] !== null ? ' (' . ($c['pct'] > 0 ? '+' : '') . str_replace('.', ',', (string)$c['pct']) . ' %)' : '') . ($c['from'] ? ' с ' . self::fdate($c['from']) : '');
    } elseif (isset($c['val']['nums'])) $t .= "\nБыло: " . implode(', ', array_slice((array)($c['was']['nums'] ?? []), 0, 6)) . "\nСтало: " . implode(', ', array_slice((array)$c['val']['nums'], 0, 6));
    if ($c['doc']) $t .= "\n" . $c['doc'];
    if ($c['url'] && $c['url'] !== $c['page']) $t .= "\nДокумент: " . $c['url'];
    $t .= "\nГде увидели: " . $c['page'];
    return $t;
  }
  /** Нові зміни, про які ще не писали, — у Telegram власнику (до 5 окремими, решта — одним рядком). → скільки повідомлень. */
  public static function notify(): int {
    self::table(); if (!Cfg::get('bot_token')) return 0;
    $rows = Db::q("SELECT * FROM tar_changes WHERE status = 'new' AND tg = 0 ORDER BY id LIMIT 40")->fetchAll(); if (!$rows) return 0;
    $chats = self::chats(); if (!$chats) return 0;
    $adm = Cfg::appUrlKnown() ? Cfg::appUrl() . 'admin#tar' : '';
    $kb = $adm !== '' ? ['reply_markup' => ['inline_keyboard' => [[['text' => 'Разобрать в /admin', 'url' => $adm]]]]] : [];
    $msgs = array_map(fn($x) => self::text(self::row($x)), array_slice($rows, 0, 5));
    if (count($rows) > 5) $msgs[] = 'И ещё ' . (count($rows) - 5) . ' изменений тарифов — в /admin → «Тарифы».';
    $n = 0;
    foreach ($chats as $ch) foreach ($msgs as $i => $m) {
      try { Telegram::call('sendMessage', ['chat_id' => $ch, 'text' => $m, 'disable_web_page_preview' => true] + ($i === count($msgs) - 1 ? $kb : [])); $n++; } catch (Throwable $e) { error_log('teplo tarwatch tg: ' . $e->getMessage()); }
    }
    Db::q('UPDATE tar_changes SET tg = 1 WHERE id IN (' . implode(',', array_map(fn($x) => (int)$x['id'], $rows)) . ')');
    return $n;
  }
  /** Нагадування раз на тиждень (понеділок, з 9:00 Києва): є нерозібрані зміни. → true, якщо написали. */
  public static function remind(?int $now = null): bool {
    self::table(); $now = $now ?? self::now(); $d = (new DateTimeImmutable('@' . $now))->setTimezone(new DateTimeZone('Europe/Kyiv'));
    if ($d->format('N') !== '1' || (int)$d->format('G') < 9 || !Cfg::get('bot_token')) return false;
    $wk = $d->format('o-W'); if ((self::state()['remindWk'] ?? '') === $wk) return false;
    $n = (int)(Db::one("SELECT COUNT(*) n FROM tar_changes WHERE status = 'new'")['n'] ?? 0);
    self::stateSet(['remindWk' => $wk]); if (!$n) return false;
    foreach (self::chats() as $ch) try { Telegram::call('sendMessage', ['chat_id' => $ch, 'text' => "Не разобрано изменений тарифов: $n. Принять в справочник или игнорировать — /admin → «Тарифы»." . (Cfg::appUrlKnown() ? "\n" . Cfg::appUrl() . 'admin#tar' : '')]); } catch (Throwable $e) {}
    return true;
  }
  /** Для письма-сводки: зміни за період (рядки — коротко). */
  public static function digest(int $since): array {
    self::table(); $rows = Db::q('SELECT * FROM tar_changes WHERE at >= ? ORDER BY id DESC LIMIT 6', [$since])->fetchAll();
    $n = (int)(Db::one('SELECT COUNT(*) n FROM tar_changes WHERE at >= ?', [$since])['n'] ?? 0); $open = (int)(Db::one("SELECT COUNT(*) n FROM tar_changes WHERE status = 'new'")['n'] ?? 0);
    return ['n' => $n, 'open' => $open, 'lines' => array_map(fn($x) => str_replace("\n", ' · ', self::text(self::row($x))), $rows)];
  }

  // ---------- /admin і /api/health ----------
  /** Громади з даними (вода/тепло/вивіз) і чим ми їх стежимо: сторінка КП чи рядок minfin; коли перевіряли. */
  public static function coverage(): array {
    $src = self::srcAll(); $hc = [];
    foreach (self::entries() as [$r, $sc, $key, $kd, $x]) {
      if ($sc === 'oblast' || !in_array($kd, self::KP_KINDS, true) || empty($x['org'])) continue;
      $h = $r . '|' . explode('/', $key)[0]; $hc[$h] = $hc[$h] ?? ['r' => $r, 'key' => explode('/', $key)[0], 'org' => (string)$x['org'], 'at' => 0, 'src' => []];
    }
    foreach (self::pages() as $url => $who) { $s = $src[sha1($url)] ?? null; foreach ($who as $w) { $h = $w[0] . '|' . explode('/', $w[2])[0]; if (!isset($hc[$h])) continue; $hc[$h]['src']['kp'] = 1; if ($s && (int)$s['code'] === 200) $hc[$h]['at'] = max($hc[$h]['at'], (int)$s['at']); } }
    foreach ($src as $s) if ($s['type'] === 'mf' && $s['snap']) foreach ((array)(json_decode((string)$s['snap'], true)['hits'] ?? []) as $hit) {
      [$r, $sc, $key] = explode('|', (string)$hit); $h = $r . '|' . explode('/', $key)[0]; if (!isset($hc[$h])) continue; $hc[$h]['src']['mf'] = 1; $hc[$h]['at'] = max($hc[$h]['at'], (int)$s['at']);
    }
    return $hc;
  }
  public static function stats(): array {
    self::table(); $now = self::now();
    $m = [];
    foreach (Db::q('SELECT at, status, pct FROM tar_changes')->fetchAll() as $x) {
      $k = gmdate('Y-m', (int)$x['at']); $m[$k] = $m[$k] ?? ['ym' => $k, 'n' => 0, 'accepted' => 0, 'ignored' => 0, 'pcts' => []];
      $m[$k]['n']++; if ($x['status'] === 'accepted') $m[$k]['accepted']++; if ($x['status'] === 'ignored') $m[$k]['ignored']++; if ($x['pct'] !== null) $m[$k]['pcts'][] = (float)$x['pct'];
    }
    krsort($m); $months = array_map(fn($x) => ['ym' => $x['ym'], 'n' => $x['n'], 'accepted' => $x['accepted'], 'ignored' => $x['ignored'], 'avgPct' => $x['pcts'] ? round(array_sum($x['pcts']) / count($x['pcts']), 1) : null], array_values($m));
    $src = []; $pages = self::pages(); $mf = self::minfin(); $all = self::srcAll();
    foreach (array_merge(array_map(fn($u) => [$u, 'mf', []], array_keys($mf)), array_map(fn($u, $w) => [$u, 'kp', $w], array_keys($pages), $pages)) as [$u, $type, $w]) {
      $s = $all[sha1($u)] ?? null; $snap = $s && $s['snap'] ? (array)json_decode((string)$s['snap'], true) : [];
      $src[] = ['url' => $u, 'type' => $type, 'at' => $s ? gmdate('c', (int)$s['at']) : null, 'okAt' => $s && (int)$s['ok_at'] ? gmdate('c', (int)$s['ok_at']) : null, 'code' => $s ? (int)$s['code'] : null, 'err' => $s['err'] ?? null,
        'links' => count((array)($snap['links'] ?? [])), 'nums' => count((array)($snap['nums'] ?? [])), 'rows' => count((array)($snap['rows'] ?? [])), 'hits' => count((array)($snap['hits'] ?? [])),
        'orgs' => array_values(array_unique(array_map(fn($x) => $x[4], $w))), 'where' => array_values(array_unique(array_map(fn($x) => $x[0] . ':' . explode('/', $x[2] ?: 'область')[0], $w)))];
    }
    $cov = self::coverage(); $none = []; $fresh = 0;
    foreach ($cov as $h) { if (!$h['src']) $none[] = ['r' => $h['r'], 'key' => $h['key'], 'org' => $h['org']]; if ($h['at'] >= $now - self::KP_DAYS * 86400 - 3600) $fresh++; }
    $c = fn(string $st) => (int)(Db::one('SELECT COUNT(*) n FROM tar_changes WHERE status = ?', [$st])['n'] ?? 0);
    return ['months' => $months, 'sources' => $src, 'hromadas' => ['all' => count($cov), 'watched' => count($cov) - count($none), 'fresh' => $fresh, 'none' => array_slice($none, 0, 80), 'noneN' => count($none)],
      'counts' => ['new' => $c('new'), 'accepted' => $c('accepted'), 'ignored' => $c('ignored'), 'stale' => $c('stale')], 'last' => self::state()['last'] ?? null, 'every' => ['mf' => self::MF_EVERY, 'kp' => self::KP_DAYS * 86400]];
  }
  public static function admin(): array {
    self::table();
    $l = fn(string $w) => array_map([self::class, 'row'], Db::q("SELECT * FROM tar_changes WHERE $w ORDER BY id DESC LIMIT 60")->fetchAll());
    return ['new' => $l("status = 'new'"), 'done' => $l("status <> 'new'"), 'stats' => self::stats()];
  }
  public static function newCount(): int { try { self::table(); return (int)(Db::one("SELECT COUNT(*) n FROM tar_changes WHERE status = 'new'")['n'] ?? 0); } catch (Throwable $e) { return 0; } }
  /** /api/health → tar: джерела (скільки, відповідають), зміни за станами, громади під наглядом; minfin — код і скільки рядків/збігів (чи пускає наш сервер). Без людей. */
  public static function health(): array {
    $s = self::stats(); $ty = ['mf' => ['n' => 0, 'ok' => 0, 'fail' => 0, 'never' => 0], 'kp' => ['n' => 0, 'ok' => 0, 'fail' => 0, 'never' => 0]]; $mf = [];
    foreach ($s['sources'] as $x) { $t = &$ty[$x['type']]; $t['n']++; if ($x['code'] === null) $t['never']++; elseif ($x['code'] === 200) $t['ok']++; else $t['fail']++; unset($t);
      if ($x['type'] === 'mf') $mf[preg_replace('~^https://index\.minfin\.com\.ua/ua/tariff/~', '', $x['url'])] = array_filter(['code' => $x['code'], 'rows' => $x['rows'], 'hits' => $x['hits'], 'err' => $x['err'], 'at' => $x['at'] ? substr($x['at'], 0, 16) : null], fn($v) => $v !== null); }
    return ['src' => $ty, 'minfin' => (object)$mf, 'changes' => $s['counts'], 'hromadas' => ['all' => $s['hromadas']['all'], 'watched' => $s['hromadas']['watched'], 'fresh' => $s['hromadas']['fresh']], 'last' => $s['last']];
  }
}
