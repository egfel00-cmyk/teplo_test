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
      if ($addr === '' || !in_array($q, self::QUEUES, true) || (isset($p['gpvTg']) && $p['gpvTg'] === false)) continue;
      $label = trim((string)($p['name'] ?? '')) ?: ($i === 0 ? 'Моя квартира' : 'Квартира ' . ($i + 1));
      $out[] = ['id' => (string)($p['id'] ?? ''), 'label' => mb_substr($label, 0, 40), 'addr' => mb_substr($addr, 0, 60), 'q' => $q];
    }
    return $out;
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
