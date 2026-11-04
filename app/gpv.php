<?php
// Графіки погодинних відключень світла (ГПВ) Харківобленерго: 12 підчерг 1.1–6.2, години без світла на сьогодні й завтра.
// Джерело — відкритий набір OE_OUTAGE_DATA (github.com/yaroslav2901/OE_OUTAGE_DATA, data/Kharkivoblenerho.json): парсер
// офіційних даних Харківобленерго раз на 5 хв. Формат: fact.data[ts початку доби, Europe/Kyiv][GPVx.y][1..24] = yes | no |
// first (немає перші 30 хв) | second (другі 30 хв) | maybe | mfirst | msecond (можливе); fact.update — «04.11.2026 07:05» (Київ).
// Коли графіків не застосовують, файл не оновлюється — дня «сьогодні» в ньому просто немає.
// cron раз на 10 хв (хвилина % 10 = 5) → SITE_DATA/cache/gpv.json; GET /api/gpv — без входу (особистих даних немає).
// Черга квартири — place.gpv ('3.1'), показуємо лише квартирам з адресою. Зранку (7:00–12:00 за Києвом) — одне повідомлення
// в Telegram на людину: квартири з адресою й чергою, якщо сьогодні за графіком є відключення; вимкнути — place.gpvTg = false.
// Позначка «вже надіслали сьогодні» — reminders_sent (kind gpv-DD, ym) — видно в /admin → «Нагадування».
declare(strict_types=1);
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class Gpv {
  const SRC = 'https://raw.githubusercontent.com/yaroslav2901/OE_OUTAGE_DATA/main/data/Kharkivoblenerho.json';
  const TZ = 'Europe/Kyiv';
  const QUEUES = ['1.1', '1.2', '2.1', '2.2', '3.1', '3.2', '4.1', '4.2', '5.1', '5.2', '6.1', '6.2'];
  /** Офіційно: черга за адресою (населений пункт → вулиця → будинок) і канал з графіками. */
  const LOOKUP = 'https://www.oblenergo.kharkov.ua/getinfoingao';
  const CHANNEL = 'https://t.me/kharkivenergy';
  /** У тестах: fn(string $url): ['code' => int, 'body' => string, 'err' => ?string] */
  public static $http = null;
  public static function file(): string { return Cfg::data() . '/cache/gpv.json'; }
  public static function read(): array { $j = json_decode((string)@file_get_contents(self::file()), true); return is_array($j) ? $j : []; }
  private static function write(array $j): void { @mkdir(dirname(self::file()), 0700, true); @file_put_contents(self::file(), json_encode($j, JSON_UNESCAPED_UNICODE), LOCK_EX); }
  private static function src(): string { return (string)Cfg::get('gpv_src', self::SRC); }
  private static function get(string $url): array {
    if (self::$http) return (self::$http)($url) + ['err' => null];
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 6, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3,
      CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; Lichylnyky/1.0; +' . Cfg::appUrl() . ')', CURLOPT_ENCODING => '', CURLOPT_MAXFILESIZE => 2 * 1024 * 1024]);
    $b = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = $b === false ? curl_error($ch) : null; curl_close($ch);
    return ['code' => $code, 'body' => is_string($b) ? $b : '', 'err' => $err];
  }
  public static function kyiv(int $ts): DateTimeImmutable { return (new DateTimeImmutable('@' . $ts))->setTimezone(new DateTimeZone(self::TZ)); }

  /** Години доби → проміжки в хвилинах від півночі: off — світла немає, may — можливе відключення. Сусідні зливаємо. */
  public static function intervals(array $hrs): array {
    $out = ['off' => [], 'may' => []];
    $add = function (string $k, int $a, int $b) use (&$out) { $l = count($out[$k]); if ($l && $out[$k][$l - 1][1] === $a) $out[$k][$l - 1][1] = $b; else $out[$k][] = [$a, $b]; };
    for ($h = 1; $h <= 24; $h++) {
      $v = strtolower((string)($hrs[$h] ?? $hrs[(string)$h] ?? 'yes')); $s = ($h - 1) * 60;
      if ($v === 'no') $add('off', $s, $s + 60); elseif ($v === 'first') $add('off', $s, $s + 30); elseif ($v === 'second') $add('off', $s + 30, $s + 60);
      elseif ($v === 'maybe') $add('may', $s, $s + 60); elseif ($v === 'mfirst') $add('may', $s, $s + 30); elseif ($v === 'msecond') $add('may', $s + 30, $s + 60);
    }
    return $out;
  }
  /** Файл OE_OUTAGE_DATA → ['update' => '04.11.2026 07:05', 'days' => ['2026-11-04' => ['1.1' => ['off' => [[360, 540], …], 'may' => []], …]]] або null. */
  public static function parse(string $body): ?array {
    $j = json_decode($body, true); $data = is_array($j) ? ($j['fact']['data'] ?? null) : null;
    if (!is_array($data)) return null;
    $days = [];
    foreach ($data as $ts => $groups) {
      if (!is_numeric($ts) || !is_array($groups)) continue;
      $date = self::kyiv((int)$ts)->format('Y-m-d'); $q = [];
      foreach ($groups as $g => $hrs) if (is_array($hrs) && preg_match('/^GPV([1-6])\.([12])$/', (string)$g, $m)) $q[$m[1] . '.' . $m[2]] = self::intervals($hrs);
      if ($q) { ksort($q); $days[$date] = $q; }
    }
    if (!$days) return null;
    ksort($days);
    return ['update' => mb_substr((string)($j['fact']['update'] ?? ''), 0, 20), 'days' => $days];
  }
  /** Забрати свіжий графік (cron). Не вдалося — лишаємо попередній, пишемо помилку. */
  public static function refresh(?int $now = null): array {
    $now = $now ?? time(); $old = self::read();
    $r = self::get(self::src()); $p = (int)$r['code'] === 200 ? self::parse((string)$r['body']) : null;
    if (!$p) {
      $old['err'] = $r['err'] ? mb_substr((string)$r['err'], 0, 100) : ((int)$r['code'] === 200 ? 'bad format' : 'HTTP ' . (int)$r['code']); $old['errAt'] = $now;
      self::write($old); return ['ok' => false, 'err' => $old['err']];
    }
    // старі дні (раніше вчора) не тримаємо
    $from = self::kyiv($now)->modify('-1 day')->format('Y-m-d');
    $days = array_filter($p['days'], fn($d) => $d >= $from, ARRAY_FILTER_USE_KEY);
    self::write(['at' => $now, 'update' => $p['update'], 'days' => $days, 'err' => null]);
    return ['ok' => true, 'update' => $p['update'], 'days' => array_keys($days)];
  }
  /** GET /api/gpv — графіки з сьогоднішнього дня (Київ): сьогодні, завтра (якщо вже опублікували). */
  public static function api(?int $now = null): array {
    $now = $now ?? time(); $j = self::read(); $today = self::kyiv($now)->format('Y-m-d');
    $days = array_filter((array)($j['days'] ?? []), fn($d) => $d >= $today, ARRAY_FILTER_USE_KEY);
    return ['ok' => !empty($j['at']), 'at' => $j['at'] ?? null, 'update' => $j['update'] ?? null, 'today' => $today, 'days' => (object)$days,
      'stale' => empty($j['at']) || $now - (int)$j['at'] > 3 * 3600, 'queues' => self::QUEUES, 'lookup' => self::LOOKUP, 'channel' => self::CHANNEL];
  }

  // ---------- розвідка офіційної форми «черга за адресою» (lookup): як вона влаштована — щоб визначати чергу за адресою квартири ----------
  // Сервер раз на SITE_V (cron) відкриває сторінку форми (лише GET, нічого не надсилає) і зберігає її будову: форми й поля, перші варіанти
  // списків, підключені скрипти й шматки коду, де вантажаться вулиці/будинки. Публічно — GET /api/gpv/site (особистих даних там немає).
  const SITE_V = 1;
  public static function siteFile(): string { return Cfg::data() . '/cache/gpv_site.json'; }
  public static function site(): array { $j = json_decode((string)@file_get_contents(self::siteFile()), true); return is_array($j) ? $j : []; }
  public static function probeSite(?int $now = null): ?array {
    $old = self::site(); $same = (int)($old['v'] ?? 0) === self::SITE_V; if ($same && empty($old['retry'])) return null;
    $now = $now ?? time(); $out = ['v' => self::SITE_V, 'at' => $now, 'tries' => $same ? (int)($old['tries'] ?? 0) + 1 : 1, 'pages' => []];
    foreach ([self::LOOKUP, 'https://www.oblenergo.kharkov.ua/uk/gaoinfo'] as $url) {
      $r = self::get($url); $pg = ['url' => $url, 'code' => (int)$r['code'], 'err' => $r['err'] ? mb_substr((string)$r['err'], 0, 120) : null, 'bytes' => strlen((string)$r['body'])];
      $html = (string)$r['body'];
      if ($html !== '' && class_exists('DOMDocument')) {
        $d = new DOMDocument(); $prev = libxml_use_internal_errors(true); $d->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING); libxml_clear_errors(); libxml_use_internal_errors($prev);
        $x = new DOMXPath($d);
        $pg['title'] = mb_substr(trim((string)($x->query('//title')->item(0)?->textContent ?? '')), 0, 120);
        $pg['forms'] = [];
        foreach ($x->query('//form') as $f) { /** @var DOMElement $f */
          $fl = [];
          foreach ($x->query('.//input|.//select|.//textarea|.//button', $f) as $e) { /** @var DOMElement $e */
            $it = ['tag' => strtolower($e->nodeName), 'name' => $e->getAttribute('name'), 'id' => $e->getAttribute('id'), 'type' => $e->getAttribute('type'), 'cls' => mb_substr($e->getAttribute('class'), 0, 80)];
            if ($it['tag'] === 'input' && $it['type'] === 'hidden') $it['value'] = mb_substr($e->getAttribute('value'), 0, 80);
            if ($it['tag'] === 'select') { $os = $x->query('.//option', $e); $it['n'] = $os->length; $it['opts'] = []; foreach ($os as $i => $o) { if ($i >= 25) break; $it['opts'][] = [$o->getAttribute('value'), mb_substr(trim($o->textContent), 0, 60)]; } }
            foreach (['data-url', 'data-action', 'onchange', 'data-ajax', 'data-source'] as $a) if ($e->hasAttribute($a)) $it[$a] = mb_substr($e->getAttribute($a), 0, 200);
            $fl[] = $it;
          }
          $pg['forms'][] = ['id' => $f->getAttribute('id'), 'action' => $f->getAttribute('action'), 'method' => $f->getAttribute('method'), 'cls' => mb_substr($f->getAttribute('class'), 0, 80), 'fields' => array_slice($fl, 0, 40)];
        }
        $pg['scripts'] = []; foreach ($x->query('//script[@src]') as $s) $pg['scripts'][] = mb_substr($s->getAttribute('src'), 0, 200);
        // шматки вбудованого коду про вулиці/будинки/ajax і налаштування Drupal (там адреси ajax-обробників)
        $pg['inline'] = [];
        foreach ($x->query('//script[not(@src)]') as $s) {
          $c = (string)$s->textContent;
          if (preg_match('/ajax|street|house|vulyc|bud|gao|getinfo|\.post|\$\.get|fetch\(|url\s*:|Drupal\.settings|drupalSettings/i', $c)) $pg['inline'][] = mb_substr(preg_replace('/\s+/', ' ', $c), 0, 4000);
        }
        $pg['inline'] = array_slice($pg['inline'], 0, 6);
        // скрипти самого сайту (не бібліотеки) — шматки навколо ajax/street/house
        $pg['js'] = [];
        foreach (array_slice(array_values(array_filter($pg['scripts'], fn($u) => !preg_match('/jquery|google|gtag|analytics|facebook|bootstrap\.min|cloudflare/i', $u))), 0, 6) as $src) {
          $abs = preg_match('~^https?://~', $src) ? $src : (str_starts_with($src, '//') ? 'https:' . $src : 'https://www.oblenergo.kharkov.ua' . (str_starts_with($src, '/') ? '' : '/') . $src);
          if (!preg_match('~^https://(www\.)?oblenergo\.kharkov\.ua/~', $abs)) continue;
          $js = (string)self::get($abs)['body']; $hits = [];
          if (preg_match_all('/.{0,220}(?:ajax|street|house|getinfo|gao|vulyc|\.post\(|\$\.get|fetch\(|url\s*:).{0,260}/si', $js, $mm)) foreach (array_slice($mm[0], 0, 12) as $h) $hits[] = preg_replace('/\s+/', ' ', $h);
          $pg['js'][] = ['src' => mb_substr($abs, 0, 200), 'bytes' => strlen($js), 'hits' => $hits];
        }
        $pg['links'] = []; foreach ($x->query('//a[@href]') as $a) { $h = $a->getAttribute('href'); if (preg_match('/gao|ingao|getinfo|street|house|chergy|cherg|grafik/i', $h)) $pg['links'][] = mb_substr($h, 0, 160); }
        $pg['links'] = array_slice(array_values(array_unique($pg['links'])), 0, 20);
        // видимий текст біля форми (підказки, результат)
        $pg['text'] = mb_substr(preg_replace('/\s+/u', ' ', trim((string)($x->query('//main|//*[@id="content"]|//body')->item(0)?->textContent ?? ''))), 0, 1500);
      }
      $out['pages'][] = $pg;
    }
    $out['retry'] = !array_filter($out['pages'], fn($p) => $p['code'] !== 0) && $out['tries'] < 3;   // 403 Cloudflare — не повторяем (проверку не обходим)
    @mkdir(dirname(self::siteFile()), 0700, true); @file_put_contents(self::siteFile(), json_encode($out, JSON_UNESCAPED_UNICODE), LOCK_EX);
    return $out;
  }

  // ---------- офіційний перелік «Адреси та черги» (PDF з каналу Харківобленерго) ----------
  // Сайт обленерго закритий для нашого сервера перевіркою Cloudflare (не обходимо). Перелік адрес за чергами Харківобленерго публікує
  // PDF-файлом у каналі t.me/kharkivenergy. Пост із файлом пересилають нашому боту → зберігаємо (SITE_DATA/uploads/gpv/list.pdf),
  // GET /api/gpv/list.pdf — віддаємо (публічний документ обленерго). З нього — довідник адрес, за яким сервер визначає чергу квартири.
  const LIST_CHANNEL = 'kharkivenergy';
  public static function listDir(): string { return Cfg::data() . '/uploads/gpv'; }
  public static function listMeta(): ?array { $j = json_decode((string)@file_get_contents(self::listDir() . '/list.json'), true); return is_array($j) ? $j : null; }
  public static function listFile(): ?array { $f = self::listDir() . '/list.pdf'; return is_file($f) ? ['path' => $f, 'mime' => 'application/pdf'] : null; }
  /** PDF «Адреси та черги»: переслано з каналу Харківобленерго або надіслано адміном сервісу (завантажив з каналу сам). */
  public static function isListDoc(array $msg): bool {
    $d = $msg['document'] ?? null; if (!is_array($d)) return false;
    $name = (string)($d['file_name'] ?? '');
    if ((string)($d['mime_type'] ?? '') !== 'application/pdf' && !preg_match('/\.pdf$/i', $name)) return false;
    if (!preg_match('/адрес|черг|перелік/iu', $name . ' ' . ($msg['caption'] ?? ''))) return false;
    $o = $msg['forward_origin'] ?? null; $ch = is_array($o) ? (string)($o['chat']['username'] ?? '') : (string)($msg['forward_from_chat']['username'] ?? '');
    if (strcasecmp($ch, self::LIST_CHANNEL) === 0) return true;
    $idn = Db::one("SELECT user_id FROM user_identities WHERE type = 'telegram' AND external_id = ?", [(string)($msg['from']['id'] ?? '')]);
    $u = $idn ? Db::one('SELECT * FROM users WHERE id = ?', [(int)$idn['user_id']]) : null;
    return $u ? Admin::is($u) : false;
  }
  public static function listFromBot(array $msg, string $lang): array {
    $ru = $lang === 'ru'; $ok = false; $d = (array)$msg['document'];
    try {
      $body = (int)($d['file_size'] ?? 0) <= 10 * 1024 * 1024 ? Telegram::file((string)($d['file_id'] ?? '')) : null;
      if (is_string($body) && str_starts_with($body, '%PDF')) {
        @mkdir(self::listDir(), 0700, true);
        $ok = @file_put_contents(self::listDir() . '/list.pdf', $body, LOCK_EX) !== false;
        if ($ok) @file_put_contents(self::listDir() . '/list.json', json_encode(['at' => time(), 'name' => mb_substr((string)($d['file_name'] ?? ''), 0, 80), 'bytes' => strlen($body), 'sha1' => sha1($body),
          'posted' => (int)($msg['forward_origin']['date'] ?? $msg['forward_date'] ?? 0), 'post' => (int)($msg['forward_origin']['message_id'] ?? $msg['forward_from_message_id'] ?? 0)], JSON_UNESCAPED_UNICODE), LOCK_EX);
      }
    } catch (Throwable $e) { $ok = false; }
    $nm = (string)($d['file_name'] ?? 'PDF');
    $p = ['chat_id' => $msg['chat']['id'], 'text' => $ok
      ? ($ru ? "✅ Сохранил перечень адресов Харьковоблэнерго («{$nm}»). Очередь отключений по адресу квартиры будет определяться сама." : "✅ Зберіг перелік адрес Харківобленерго («{$nm}»). Черга відключень за адресою квартири визначатиметься сама.")
      : ($ru ? 'Не удалось сохранить файл. Перешлите его ещё раз.' : 'Не вдалося зберегти файл. Перешліть його ще раз.')];
    Telegram::call('sendMessage', $p);
    return $p + ['gpvList' => $ok];
  }

  // ---------- черга за адресою квартири: довідник з переліку «Адреси та черги» (app/data/gpv_addr.json) ----------
  // Довідник: {v, src, items: [{c: 'м. Харків', s: 'вул. Сумська', k: скелет назви, h: ['10', '12а'] | null (уся вулиця), q: '3.1'}, …]}.
  // Адресу людини розбираємо на вулицю й будинок (укр./рос., скорочення, без «кв.» і міста), шукаємо вулицю за «скелетом» назви
  // (і/и/ы/й → и, є/е/э → е, без м’якого знака й апострофа, рос. «-ская» → «-ська»), допускаємо 1–2 описки; далі — будинок.
  public static ?array $addrIdx = null;
  public static function addrFile(): string { return (string)Cfg::get('gpv_addr_file', __DIR__ . '/data/gpv_addr.json'); }
  public static function addrIndex(): array {
    if (self::$addrIdx === null) { self::$cities = null; $j = json_decode((string)@file_get_contents(self::addrFile()), true); self::$addrIdx = is_array($j) && !empty($j['items']) ? $j : []; }
    return self::$addrIdx;
  }
  const STREET_TYPES = 'вулиця|вул|улица|ул|проспект|просп|пр-т|пр|провулок|пров|переулок|пер|площа|площадь|пл|бульвар|бульв|б-р|узвіз|спуск|в\'їзд|в’їзд|вʼїзд|въезд|проїзд|проезд|шосе|шоссе|набережна|набережная|наб|майдан|тупик|лінія|линия|селище|поселок|мікрорайон|микрорайон|мкр|квартал|кв-л|дорога|алея|аллея|сад|парк';
  /** Скелет назви вулиці для порівняння без різниці укр./рос. і дрібних описок. */
  public static function skel(string $s): string {
    $s = mb_strtolower(trim($s)); $s = str_replace(['ё', '’', 'ʼ', '`', '´'], ['е', "'", "'", "'", "'"], $s);
    $s = preg_replace('/\b(' . self::STREET_TYPES . ')\b\.?/u', ' ', $s);
    // рос. закінчення прикметників → укр.: Сумская → Сумська, Гагаринский → Гагаринський (скелет однаковий)
    $s = preg_replace(['/ская\b/u', '/цкая\b/u', '/ская\s/u', '/ая\b/u', '/ое\b/u'], ['ська', 'цька', 'ська ', 'а', 'е'], $s);
    $s = strtr($s, ['і' => 'и', 'ї' => 'и', 'ы' => 'и', 'й' => 'и', 'є' => 'е', 'э' => 'е', 'ґ' => 'г', 'ь' => '', 'ъ' => '', "'" => '', '-' => ' ', '.' => ' ', ',' => ' ']);
    return trim(preg_replace('/\s+/u', ' ', $s));
  }
  /** Номер будинку до порівняння: «12-А» → «12а», «5/7» → «5/7», «10 корп. 2» → «10к2». */
  public static function houseKey(string $h): string {
    $h = mb_strtolower(trim($h)); $h = preg_replace('/\s*(корпус|корп|к)\.?\s*(\d+)/u', 'к$2', $h);
    return preg_replace('/[\s\-"«»]+/u', '', strtr($h, ['a' => 'а', 'b' => 'б', 'v' => 'в']));
  }
  const CITY = 'Харків';
  /** Скелет назви населеного пункту: без «м.», «с.», «смт» тощо. */
  public static function skelCity(string $c): string { return self::skel(preg_replace('/^\s*(м|г|с|смт|сел|селище|село|місто|город|пос|поселок)\.?\s+/iu', '', $c)); }
  private static ?array $cities = null;
  private static function cities(): array {
    if (self::$cities === null) { self::$cities = []; foreach ((array)(self::addrIndex()['items'] ?? []) as $it) self::$cities[(string)$it['ck']] = (self::$cities[(string)$it['ck']] ?? 0) + 1; }
    return self::$cities;
  }
  /** Той самий населений пункт? Скелети: точно; описка (1 літера, від 5 літер); ініціал у переліку — «ч бишкин» ↔ «червонии бишкин»,
   *  «ст мерчик» ↔ «старии мерчик», «м рогань» ↔ «мала рогань» (кожне коротке слово — початок довгого, хоч одне слово — повне). */
  public static function cityLike(string $a, string $b): bool {
    if ($a === $b) return true;
    if (mb_strlen($a) >= 5 && mb_strlen($b) >= 5 && self::lev($a, $b) <= 1) return true;
    $A = explode(' ', $a); $B = explode(' ', $b); if (count($A) !== count($B) || count($A) < 2) return false;
    $full = 0;
    foreach ($A as $i => $x) {
      $y = $B[$i]; if ($x === $y || (mb_strlen($x) >= 5 && self::lev($x, $y) <= 1)) { $full++; continue; }
      [$s, $l] = mb_strlen($x) <= mb_strlen($y) ? [$x, $y] : [$y, $x];
      if (mb_strlen($s) > 2 || mb_strlen($l) < 3 || !str_starts_with($l, $s)) return false;
    }
    return $full > 0;
  }
  /** Скелет пункту з переліку для введеного: точно або cityLike; null — такого немає. */
  public static function findCity(string $k): ?string {
    if ($k === '' ) return null; $c = self::cities(); if (isset($c[$k])) return $k;
    foreach ($c as $ck => $_) if (self::cityLike((string)$ck, $k)) return (string)$ck;
    return null;
  }
  /** Адреса людини → ['city' => скелет пункту (немає — Харків), 'street' => 'сумська', 'house' => '10'] (кв., індекс — відкидаємо). */
  public static function splitAddr(string $a): array {
    $a = mb_strtolower(str_replace(['ё', '№'], ['е', ' '], $a)); $city = null;
    // явно: «м. Люботин», «с. Мала Данилівка», «смт Солоницівка» — до коми
    if (preg_match('/(^|[\s,])(м|г|місто|город|с|село|смт|сел|селище|пос|поселок)(?:\.\s*|\s+)((?:\p{L}{1,2}\.\s*)?[\p{L}\'’ʼ\-]+(?:(?<=-)\d+)?(?:\s+[\p{L}\'’ʼ\-]+){0,2}?)\s*(?=,|$)/u', $a, $m)) {
      $city = self::skel($m[3]); $a = str_replace($m[0], $m[1] === ',' ? ',' : ' ', $a);
    } else {
      // перший шматок до коми — відомий населений пункт («Люботин, Глінки 5»)
      $seg = explode(',', $a);
      if (count($seg) > 1 && !preg_match('/\d|\b(' . self::STREET_TYPES . ')\b/u', $seg[0]) && self::findCity(self::skel($seg[0])) !== null) { $city = self::skel($seg[0]); array_shift($seg); $a = implode(',', $seg); }
    }
    $a = preg_replace('/\b(кв|квартира|оф|офис|офіс|под|під\'їзд|подъезд|эт|етаж|этаж)\b\.?\s*\d+[\p{L}]?.*$/u', '', $a);
    $a = preg_replace('/\b\d{5}\b/u', ' ', $a);   // поштовий індекс
    // «м. Харків,» / «Харьков,» — лише назва міста, не «вул. Харківська» / «пров. Харківський»
    $a = preg_replace('/(^|[\s,])(м|г|місто|город|смт|с|село)\.?\s*харь?к[іо]в[еі]?(?!\p{L})\s*,?/u', ' ', $a);
    $a = preg_replace('/(^|[\s,])харь?к[іо]в[еі]?(?!\p{L})\s*,/u', ' ', $a);
    // будинок — номер (з літерою, дробом, корпусом), після якого не йде слово; вулиця — усе до нього. Число на початку назви
    // вулиці — частина назви: «вул. 8 Березня, 1», «пров. 1-й Московський 3», «вул. Героїв 93-ї бригади 5»
    $s = trim($a);
    if (preg_match_all('/(?<=^|[\s,.])(?:(?:буд|будинок|дом|д)\.?\s*)?(\d+(?:\s*-?\s*\p{L}(?!\p{L}))?(?:\s*\/\s*\d+(?:\s*-?\s*\p{L}(?!\p{L}))?)?(?:\s*(?:корпус|корп|к)\.?\s*\d+)?)(?=$|[\s,.;])/u', $s, $mm, PREG_SET_ORDER | PREG_OFFSET_CAPTURE)) {
      foreach ($mm as $m) {
        $pre = substr($s, 0, $m[0][1]); $post = substr($s, $m[0][1] + strlen($m[0][0]));
        if (mb_strlen(self::skel(preg_replace('/\b(буд|будинок|дом|д)\.?\s*$/u', '', $pre))) < 3 || preg_match('/^\s+\p{L}{3,}/u', $post)) continue;
        return ['city' => $city ?? self::skel(self::CITY), 'street' => trim($pre, " ,.\t"), 'house' => self::houseKey($m[1][0])];
      }
    }
    return ['city' => $city ?? self::skel(self::CITY), 'street' => trim($a, " ,.\t"), 'house' => ''];
  }
  private static function lev(string $a, string $b): int {
    if ($a === $b) return 0;
    $A = preg_split('//u', $a, -1, PREG_SPLIT_NO_EMPTY); $B = preg_split('//u', $b, -1, PREG_SPLIT_NO_EMPTY);
    $n = count($A); $m = count($B); if (abs($n - $m) > 3) return 99; $p = range(0, $m);
    for ($i = 1; $i <= $n; $i++) { $c = [$i]; for ($j = 1; $j <= $m; $j++) $c[$j] = min($p[$j] + 1, $c[$j - 1] + 1, $p[$j - 1] + ($A[$i - 1] === $B[$j - 1] ? 0 : 1)); $p = $c; }
    return $p[$m];
  }
  /** Наскільки назва з довідника схожа на введену: 0 — точно, 1–2 — описка / інший порядок слів, null — ні. */
  private static function streetScore(string $want, string $k): ?int {
    if ($want === $k) return 0;
    $tol = fn($s) => mb_strlen($s) >= 9 ? 2 : (mb_strlen($s) >= 5 ? 1 : 0);
    if (self::lev($want, $k) <= $tol($k)) return 1;
    // за словами: усі довгі слова введеної назви є в назві з довідника (ак. Павлова ↔ академіка павлова)
    $w = array_values(array_filter(explode(' ', $want), fn($x) => mb_strlen($x) >= 4)); $kk = explode(' ', $k);
    if (!$w) return null;
    foreach ($w as $x) { $hit = false; foreach ($kk as $y) if (mb_strlen($y) >= 4 && self::lev($x, $y) <= $tol($y)) { $hit = true; break; } if (!$hit) return null; }
    return 2;
  }
  /** GET /api/gpv/addr?q=адреса → черга. found: true + q; або варіанти (вулиця в кількох чергах, будинок не знайшли); або не знайшли вулицю. */
  public static function lookup(string $addr): array {
    $idx = self::addrIndex(); $addr = mb_substr(trim($addr), 0, 160);
    if (!$idx) return ['ready' => false, 'found' => false];
    $p = self::splitAddr($addr); $want = self::skel($p['street']); $kh = $p['city'] === self::skel(self::CITY);
    $meta = ['ready' => true, 'src' => $idx['src'] ?? null, 'house' => $p['house'], 'kharkiv' => $kh];
    // спершу — населений пункт (перелік обленерго — переважно область; без пункту в адресі вважаємо, що це Харків)
    $cand = array_values(array_filter($idx['items'], fn($it) => ($it['ck'] ?? '') === $p['city']));
    if (!$cand) foreach ($idx['items'] as $it) if (self::cityLike((string)($it['ck'] ?? ''), $p['city'])) $cand[] = $it;
    if (!$cand) return $meta + ['found' => false, 'reason' => 'city'];
    // Харків у переліку обленерго — лише окремі підприємства, не місто: «весь пункт» для нього не підставляємо ніколи
    $whole = $kh ? [] : array_values(array_filter($cand, fn($i) => ($i['k'] ?? '') === ''));
    $wq = array_values(array_unique(array_map(fn($i) => (string)$i['q'], $whole))); sort($wq);
    $cityName = $cand[0]['c'];
    $aq = array_values(array_unique(array_map(fn($i) => (string)$i['q'], $cand))); sort($aq);
    if (mb_strlen($want) < 3) {
      if ($kh) return $meta + ['found' => false, 'reason' => 'street', 'city' => $cityName];
      if (count($wq) === 1) return $meta + ['found' => true, 'q' => $wq[0], 'street' => '', 'city' => $cityName, 'how' => 'city'];
      return $meta + ['found' => false, 'reason' => 'nostreet', 'city' => $cityName, 'options' => array_slice($aq, 0, 12)];
    }
    $best = null; $hits = [];
    foreach ($cand as $it) {
      if (($it['k'] ?? '') === '') continue;
      $sc = self::streetScore($want, (string)$it['k']); if ($sc === null) continue;
      if ($best === null || $sc < $best) { $best = $sc; $hits = []; }
      if ($sc === $best) $hits[] = $it;
    }
    if (!$hits) {
      // вулиці в переліку немає, але весь пункт в одній черзі (село) — його черга
      if (count($wq) === 1) return $meta + ['found' => true, 'q' => $wq[0], 'street' => '', 'city' => $cityName, 'how' => 'city'];
      if ($kh) return $meta + ['found' => false, 'reason' => 'street', 'city' => $cityName];
      // увесь пункт у переліку в одній черзі (перелічені лише вулиці) — вона; у кількох (до 6) — їх на вибір
      if (!$wq && count($aq) === 1) return $meta + ['found' => true, 'q' => $aq[0], 'street' => '', 'city' => $cityName, 'how' => 'city'];
      return $meta + ['found' => false, 'reason' => 'street', 'city' => $cityName] + (count($aq) <= 6 ? ['options' => $aq] : []);
    }
    $street = $hits[0]['s']; $city = $hits[0]['c'];
    $qs = array_values(array_unique(array_map(fn($i) => (string)$i['q'], $hits))); sort($qs);
    $h = $p['house'];
    if ($h !== '') {
      $num = preg_replace('/\D.*$/u', '', $h); $byNum = [];
      foreach ($hits as $it) foreach ((array)($it['h'] ?? []) as $x) { $x = self::houseKey((string)$x); if ($x === $h) return $meta + ['found' => true, 'q' => $it['q'], 'street' => $it['s'], 'city' => $it['c'], 'how' => 'house'];
        if (preg_replace('/\D.*$/u', '', $x) === $num) $byNum[(string)$it['q']] = $it; }
      if (count($byNum) === 1) { $it = reset($byNum); return $meta + ['found' => true, 'q' => $it['q'], 'street' => $it['s'], 'city' => $it['c'], 'how' => 'num']; }
    }
    $wholeS = array_values(array_filter($hits, fn($i) => !isset($i['h']) || $i['h'] === null || $i['h'] === []));
    $sq = array_values(array_unique(array_map(fn($i) => (string)$i['q'], $wholeS)));
    if (count($sq) === 1 && ($h !== '' || count($qs) === 1)) return $meta + ['found' => true, 'q' => $sq[0], 'street' => $street, 'city' => $city, 'how' => 'street'];
    if (count($qs) === 1) return $meta + ['found' => true, 'q' => $qs[0], 'street' => $street, 'city' => $city, 'how' => 'street'];
    return $meta + ['found' => false, 'reason' => $h === '' ? 'nohouse' : 'house', 'street' => $street, 'city' => $city, 'options' => $qs];
  }

  // ---------- ранкове повідомлення в Telegram ----------
  public static function hm(int $m): string { return sprintf('%02d:%02d', intdiv($m, 60), $m % 60); }
  public static function span(array $iv): string { return self::hm($iv[0]) . '–' . self::hm($iv[1]); }
  public static function total(array $ivs, bool $ru): string {
    $m = array_sum(array_map(fn($i) => $i[1] - $i[0], $ivs)); $h = intdiv($m, 60); $r = $m % 60;
    return trim(($h ? $h . ($ru ? ' ч' : ' год') : '') . ($r ? ' ' . $r . ($ru ? ' мин' : ' хв') : '')) ?: '0';
  }
  /** Квартири з адресою й обраною чергою, де ранкове повідомлення не вимкнули: [['id', 'label', 'addr', 'q'], …]. */
  public static function placesFor(array $st): array {
    $out = [];
    foreach (array_values(array_filter((array)($st['places'] ?? []), fn($p) => is_array($p) && empty($p['deleted']))) as $i => $p) {
      $addr = trim((string)($p['address'] ?? '')); $q = (string)($p['gpv'] ?? '');
      if ($addr === '' || (isset($p['gpvTg']) && $p['gpvTg'] === false)) continue;
      // черги ще не підставив застосунок (людина не відкривала) або адресу змінили після автопідбору — визначаємо за адресою самі
      if ($q === '' || (is_array($p['gpvAuto'] ?? null) && ($p['gpvAuto']['addr'] ?? '') !== $addr)) { $l = self::lookup($addr); $q = !empty($l['found']) ? (string)$l['q'] : ($q !== '' && empty($p['gpvAuto']) ? $q : ''); }
      if (!in_array($q, self::QUEUES, true)) continue;
      $label = trim((string)($p['name'] ?? '')) ?: ($i === 0 ? 'Моя квартира' : 'Квартира ' . ($i + 1));
      $out[] = ['id' => (string)($p['id'] ?? ''), 'label' => mb_substr($label, 0, 40), 'addr' => mb_substr($addr, 0, 60), 'q' => $q];
    }
    return $out;
  }
  /** Скільки людей отримають ранковий графік — лише числа, для /api/health (cron раз на 10 хв, нічого не надсилає):
   *  tg — увійшли через Telegram; ready — є квартира з адресою й чергою; noQueue — адреса є, а черги немає (Харків-місто, не обрали /
   *  не знайшли за адресою) — їм нічого не прийде; off — у всіх квартирах з адресою повідомлення вимкнули. */
  public static function readiness(): array {
    $c = ['tg' => 0, 'ready' => 0, 'noQueue' => 0, 'off' => 0];
    foreach (Db::q("SELECT s.data FROM user_identities i JOIN user_state s ON s.user_id = i.user_id WHERE i.type = 'telegram'")->fetchAll() as $row) {
      $c['tg']++; $st = json_decode((string)$row['data'], true); if (!is_array($st)) continue;
      if (self::placesFor($st)) { $c['ready']++; continue; }
      $ps = array_filter((array)($st['places'] ?? []), fn($p) => is_array($p) && empty($p['deleted']) && trim((string)($p['address'] ?? '')) !== '');
      if (!$ps) continue;
      if (array_filter($ps, fn($p) => !(isset($p['gpvTg']) && $p['gpvTg'] === false))) $c['noQueue']++; else $c['off']++;
    }
    return $c;
  }
  /** Текст на сьогодні; null — у жодній квартирі сьогодні відключень за графіком немає (тоді не пишемо). */
  public static function text(string $lang, array $ps, array $day, string $date): ?array {
    $ru = $lang === 'ru'; $any = false;
    $mon = $ru ? ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
               : ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
    $d = DateTimeImmutable::createFromFormat('!Y-m-d', $date); $dt = (int)$d->format('j') . ' ' . $mon[(int)$d->format('n') - 1];
    $blocks = [];
    foreach ($ps as $p) {
      $iv = (array)($day[$p['q']]['off'] ?? []); $may = (array)($day[$p['q']]['may'] ?? []); if ($iv || $may) $any = true;
      $head = (count($ps) > 1 ? '▌' . $p['label'] . ' (' . $p['addr'] . ')' : $p['addr']) . ' — ' . ($ru ? 'очередь ' : 'черга ') . $p['q'];
      if (!$iv && !$may) { $blocks[] = $head . "\n" . ($ru ? 'Отключений по графику нет.' : 'Відключень за графіком немає.'); continue; }
      $b = $head;
      if ($iv) $b .= "\n" . ($ru ? 'Без света: ' : 'Без світла: ') . implode(', ', array_map([self::class, 'span'], $iv)) . ' (' . ($ru ? 'всего ' : 'разом ') . self::total($iv, $ru) . ')';
      if ($may) $b .= "\n" . ($ru ? 'Возможны отключения: ' : 'Можливі відключення: ') . implode(', ', array_map([self::class, 'span'], $may));
      $blocks[] = $b;
    }
    if (!$any) return null;
    $t = ($ru ? "💡 Графики отключений света на сегодня, $dt:" : "💡 Графік відключень світла на сьогодні, $dt:") . "\n\n" . implode("\n\n", $blocks) . "\n\n" .
      ($ru ? 'По данным Харьковоблэнерго. Графики могут меняться в течение дня, возможны аварийные отключения — актуальный график в «Счётчиках».'
           : 'За даними Харківобленерго. Графік може змінюватися протягом дня, можливі аварійні відключення — актуальний графік у «Лічильниках».') . "\n" .
      ($ru ? 'Отключить эти сообщения — в «Счётчиках» под графиком.' : 'Вимкнути ці повідомлення — у «Лічильниках» під графіком.');
    $one = count($ps) === 1 ? '&place=' . rawurlencode($ps[0]['id']) : '';
    return ['text' => $t, 'buttons' => [[$ru ? 'Открыть график' : 'Відкрити графік', Cfg::appUrl() . '?go=gpv' . $one]]];
  }
  /** Ранкова розсилка (cron раз на 10 хв з 7:00 до 12:00 за Києвом): кожному — раз на день, коли графік на сьогодні вже є. → [[user_id, kind, status], …] */
  public static function morning(int $now): array {
    if (!Cfg::get('bot_token')) return [];
    $d = self::kyiv($now); $h = (int)$d->format('G'); if ($h < 7 || $h >= 12) return [];
    $date = $d->format('Y-m-d'); $day = self::read()['days'][$date] ?? null; if (!is_array($day)) return [];
    $kind = 'gpv-' . $d->format('d'); $ym = $d->format('Y-m'); $out = [];
    $rows = Db::q("SELECT i.user_id, i.external_id, s.data FROM user_identities i JOIN user_state s ON s.user_id = i.user_id WHERE i.type = 'telegram'")->fetchAll();
    foreach ($rows as $row) {
      $uid = (int)$row['user_id'];
      if (Db::one('SELECT 1 AS x FROM reminders_sent WHERE user_id = ? AND kind = ? AND ym = ?', [$uid, $kind, $ym])) continue;
      $st = json_decode((string)$row['data'], true); $ps = is_array($st) ? self::placesFor($st) : []; if (!$ps) continue;
      $m = self::text((string)($st['remind']['lang'] ?? 'uk'), $ps, $day, $date); if (!$m) continue;
      Db::q('INSERT INTO reminders_sent (user_id, kind, ym, sent_at) VALUES (?, ?, ?, ?)', [$uid, $kind, $ym, Http::iso()]);
      try {
        $msg = ['chat_id' => $row['external_id'], 'text' => $m['text']];
        if (Cfg::appUrlKnown()) $msg['reply_markup'] = ['inline_keyboard' => array_map(fn($b) => [['text' => $b[0], 'web_app' => ['url' => $b[1]]]], $m['buttons'])];
        $r = Telegram::call('sendMessage', $msg);
      } catch (Throwable $e) { error_log('teplo gpv: ' . $e->getMessage()); $r = []; }
      $s = Reminders::status($r);
      if ($s === null) Db::q('DELETE FROM reminders_sent WHERE user_id = ? AND kind = ? AND ym = ?', [$uid, $kind, $ym]);   // сбой связи — через 10 хв ще раз
      else Db::q('UPDATE reminders_sent SET status = ? WHERE user_id = ? AND kind = ? AND ym = ?', [$s, $uid, $kind, $ym]);
      $out[] = [$uid, $kind, $s ?? 'retry'];
      if (!Telegram::$send) usleep(50000);
    }
    return $out;
  }
}
