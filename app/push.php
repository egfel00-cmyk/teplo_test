<?php
// 186-я — iOS этап 2: пуши на iPhone (APNs) из приложения «передай».
// Телефон шлёт токены через сайт внутри приложения (TeploHost.pushToken → POST /api/push/token): apns — обычные уведомления,
// las — push-to-start Live Activity (iOS 17.2+, запустить «окно передачи» без открытия приложения).
// Отправка — HTTP/2 на api.push.apple.com с JWT ES256 по ключу .p8 (Key ID и Team ID) из /admin → «Настройки» → «Пуші iPhone»;
// ключа нет — ничего не шлём (Push::ready() = false), всё как раньше (Telegram, локальные нагадування телефона).
// Что шлём: итоги фоновой отправки (ХТМ, Водоканал, местные КП — те же тексты, что в Telegram; есть пуши — в Telegram не дублируем)
// и старт Live Activity за 4 дня до конца окна (те же виды и дни, что Reminders). Сами нагадування за 4 дня — локальные, на телефоне.
declare(strict_types=1);
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class Push {
  const KINDS = ['apns', 'las'];
  const BUNDLE = 'ua.com.peredai.app';
  const REF = 978307200;   // 2001-01-01 — ActivityKit читає Date як секунди від цієї дати (JSONDecoder за замовчуванням)
  /** Підміна HTTP у тестах: fn(string $url, array $headers, string $body) → ['code' => int, 'body' => string]. */
  public static $http = null;
  private static bool $tbl = false;

  public static function table(): void {
    if (self::$tbl) return; self::$tbl = true;
    $my = Db::driver() !== 'sqlite'; $ai = $my ? 'INT UNSIGNED AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'; $tail = $my ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';
    Db::pdo()->exec("CREATE TABLE IF NOT EXISTS push_tokens (id $ai, user_id INT NOT NULL, kind VARCHAR(8) NOT NULL, token VARCHAR(200) NOT NULL UNIQUE, env VARCHAR(8) NOT NULL, created_at VARCHAR(25) NOT NULL, seen_at VARCHAR(25) NOT NULL, bad VARCHAR(40) NULL)$tail");
    Db::pdo()->exec("CREATE TABLE IF NOT EXISTS push_sent (user_id INT NOT NULL, kind VARCHAR(16) NOT NULL, ym CHAR(7) NOT NULL, at VARCHAR(25) NOT NULL, status VARCHAR(40) NULL, PRIMARY KEY (user_id, kind, ym))$tail");
  }

  // ---------------------------------------------------------------- токени
  /** POST /api/push/token {token: hex, kind: apns|las, env: sandbox|prod} — токен телефона цієї людини (інша людина на тому ж телефоні — токен переходить до неї). */
  public static function save(int $uid, array $in): array {
    self::table();
    $tok = strtolower((string)($in['token'] ?? '')); $kind = (string)($in['kind'] ?? ''); $env = ($in['env'] ?? '') === 'sandbox' ? 'sandbox' : 'prod';
    if (!preg_match('/^[a-f0-9]{32,200}$/', $tok) || !in_array($kind, self::KINDS, true)) throw new HttpError(422, 'bad_token');
    $now = Http::iso(); $row = Db::one('SELECT id FROM push_tokens WHERE token = ?', [$tok]);
    if ($row) Db::q('UPDATE push_tokens SET user_id = ?, kind = ?, env = ?, seen_at = ?, bad = NULL WHERE id = ?', [$uid, $kind, $env, $now, (int)$row['id']]);
    else Db::q('INSERT INTO push_tokens (user_id, kind, token, env, created_at, seen_at) VALUES (?, ?, ?, ?, ?, ?)', [$uid, $kind, $tok, $env, $now, $now]);
    // у людини на телефоні один токен кожного виду — старі (перевстановлення) за 60 днів прибирає Push::cleanup
    return ['ok' => true, 'ready' => self::ready()];
  }
  /** POST /api/push/off {token?} — вийшли з акаунта на телефоні: токен (або всі цієї людини) більше не її. */
  public static function forget(int $uid, array $in = []): array {
    self::table(); $tok = strtolower((string)($in['token'] ?? ''));
    if ($tok !== '') Db::q('DELETE FROM push_tokens WHERE user_id = ? AND token = ?', [$uid, $tok]); else Db::q('DELETE FROM push_tokens WHERE user_id = ?', [$uid]);
    return ['ok' => true];
  }
  public static function tokens(int $uid, string $kind): array {
    self::table(); return Db::q('SELECT * FROM push_tokens WHERE user_id = ? AND kind = ? AND bad IS NULL ORDER BY seen_at DESC LIMIT 5', [$uid, $kind])->fetchAll();
  }
  /** Є куди слати звичайний пуш (і є ключ) — тоді тексти робота йдуть пушем, не в Telegram. */
  public static function has(int $uid): bool { try { return self::ready() && (bool)self::tokens($uid, 'apns'); } catch (Throwable $e) { return false; } }

  // ---------------------------------------------------------------- ключ і JWT
  public static function ready(): bool { return (bool)(Cfg::get('apns_key') && Cfg::get('apns_key_id') && Cfg::get('apns_team_id')); }
  /** Перевірка ключа з /admin: PEM «BEGIN PRIVATE KEY», крива P-256; Key ID і Team ID — по 10 латинських літер/цифр. → null або текст помилки. */
  public static function checkKey(string $pem, string $kid, string $team): ?string {
    if (!preg_match('/^[A-Z0-9]{10}$/', $kid)) return 'Key ID — 10 латинских букв и цифр (как в имени файла AuthKey_XXXXXXXXXX.p8).';
    if (!preg_match('/^[A-Z0-9]{10}$/', $team)) return 'Team ID — 10 латинских букв и цифр (developer.apple.com → Membership).';
    $k = @openssl_pkey_get_private($pem); $d = $k ? openssl_pkey_get_details($k) : null;
    if (!$d || ($d['type'] ?? -1) !== OPENSSL_KEYTYPE_EC || ($d['ec']['curve_name'] ?? '') !== 'prime256v1') return 'Это не ключ APNs: нужен файл .p8 целиком, от «-----BEGIN PRIVATE KEY-----» до «-----END PRIVATE KEY-----».';
    return null;
  }
  /** JWT для APNs (ES256), живе до години — тримаємо 50 хв у кеші процесу й у SITE_DATA/cache (Apple не любить новий токен на кожен запит). */
  public static function jwt(?int $now = null): string {
    $now = $now ?? time(); $kid = (string)Cfg::get('apns_key_id'); $team = (string)Cfg::get('apns_team_id');
    $f = (Cfg::data() ?: sys_get_temp_dir()) . '/cache/apns_jwt.json';
    $c = is_file($f) ? json_decode((string)@file_get_contents($f), true) : null;
    if (is_array($c) && ($c['kid'] ?? '') === $kid && ($c['team'] ?? '') === $team && $now - (int)($c['iat'] ?? 0) < 3000 && $now >= (int)($c['iat'] ?? 0)) return (string)$c['t'];
    $b = fn($s) => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
    $in = $b(json_encode(['alg' => 'ES256', 'kid' => $kid])) . '.' . $b(json_encode(['iss' => $team, 'iat' => $now]));
    $k = openssl_pkey_get_private((string)Cfg::get('apns_key')); if (!$k || !openssl_sign($in, $der, $k, OPENSSL_ALGO_SHA256)) throw new RuntimeException('apns_key');
    $t = $in . '.' . $b(self::derToRaw($der));
    @mkdir(dirname($f), 0700, true); @file_put_contents($f, json_encode(['t' => $t, 'iat' => $now, 'kid' => $kid, 'team' => $team]), LOCK_EX);
    return $t;
  }
  /** Підпис openssl (DER: SEQUENCE { INTEGER r, INTEGER s }) → JWS ES256 (r‖s, по 32 байти). */
  public static function derToRaw(string $der): string {
    $p = 2; if (ord($der[1]) & 0x80) $p += ord($der[1]) & 0x7f;
    $int = function () use ($der, &$p) { $p++; $n = ord($der[$p++]); $v = substr($der, $p, $n); $p += $n; return str_pad(ltrim($v, "\0"), 32, "\0", STR_PAD_LEFT); };
    return $int() . $int();
  }

  // ---------------------------------------------------------------- відправка
  /** Один пуш на один токен. → ['code', 'reason'] (410/BadDeviceToken — токен позначаємо поганим, більше не шлемо). */
  public static function send(array $tok, array $payload, string $type = 'alert', int $prio = 10): array {
    $host = $tok['env'] === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
    $topic = $type === 'liveactivity' ? self::BUNDLE . '.push-type.liveactivity' : self::BUNDLE;
    $hdr = ['authorization: bearer ' . self::jwt(), 'apns-topic: ' . $topic, 'apns-push-type: ' . $type, 'apns-priority: ' . $prio, 'content-type: application/json'];
    $body = json_encode($payload, JSON_UNESCAPED_UNICODE);
    $url = $host . '/3/device/' . $tok['token'];
    if (self::$http) $r = (self::$http)($url, $hdr, $body);
    else {
      $ch = curl_init($url);
      curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_HTTPHEADER => $hdr, CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_2_0, CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 5]);
      $out = curl_exec($ch); $r = ['code' => (int)curl_getinfo($ch, CURLINFO_HTTP_CODE), 'body' => is_string($out) ? $out : '', 'err' => curl_error($ch)]; curl_close($ch);
    }
    $reason = (string)(json_decode((string)($r['body'] ?? ''), true)['reason'] ?? ($r['err'] ?? ''));
    if ((int)$r['code'] === 410 || in_array($reason, ['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'], true))
      Db::q('UPDATE push_tokens SET bad = ? WHERE id = ?', [mb_substr($reason ?: 'gone', 0, 40), (int)$tok['id']]);
    return ['code' => (int)$r['code'], 'reason' => $reason];
  }
  /** Звичайний пуш людині на всі її телефони: перший рядок тексту — заголовок, решта — текст; дотик — на маршрут go квартири place. → скільки дійшло. */
  public static function alert(int $uid, string $text, string $go = 'home', string $place = ''): int {
    if (!self::ready()) return 0;
    $lines = preg_split('/\R/u', trim($text)); $title = trim((string)array_shift($lines)); $body = trim(implode("\n", $lines));
    $p = ['aps' => ['alert' => ['title' => mb_substr($title, 0, 160), 'body' => mb_substr($body, 0, 900)], 'sound' => 'default', 'thread-id' => 'cab'], 'g' => $go, 'p' => $place];
    $n = 0; foreach (self::tokens($uid, 'apns') as $t) { try { if (self::send($t, $p)['code'] === 200) $n++; } catch (Throwable $e) { error_log('teplo push: ' . $e->getMessage()); } }
    return $n;
  }

  // ---------------------------------------------------------------- Live Activity з сервера
  const KT = ['uk' => ['elec' => 'Світло', 'cold' => 'Вода', 'hot' => 'Гаряча вода', 'gas' => 'Газ', 'heat' => 'Опалення'],
              'ru' => ['elec' => 'Свет', 'cold' => 'Вода', 'hot' => 'Горячая вода', 'gas' => 'Газ', 'heat' => 'Отопление']];
  const LA = ['uk' => ['Відкрите вікно передачі', 'Зняти показання', 'Передано'], 'ru' => ['Открыто окно передачи', 'Снять показания', 'Передано']];
  /** Payload push-to-start: ті самі WindowActivityAttributes / ContentState, що в застосунку (apps/ios/Shared/WindowActivity.swift). */
  public static function laPayload(string $kind, string $lang, array $places, string $today, int $now): ?array {
    if (str_starts_with($kind, 'waste')) return null;   // оплата вивозу — не «вікно показань»
    $k = preg_match('/^(water|hot|heat|elec|gas)/', $kind, $m) ? $m[1] : ''; if ($k === '') return null;
    $k0 = $k === 'water' ? 'cold' : $k; $ru = $lang === 'ru' ? 'ru' : 'uk';
    // нагадування Reminders завжди за 4 дні до кінця вікна → кінець вікна = сьогодні + 4 (00:00 Києва)
    $due = (new DateTimeImmutable($today . ' 00:00', new DateTimeZone('Europe/Kyiv')))->modify('+4 days')->getTimestamp() - self::REF;
    $items = [];
    foreach (array_slice($places, 0, 6) as $p) {
      $pid = (string)($p['id'] ?? ''); if ($pid === '') continue;
      $k = $k0 === 'cold' && ($p['k'] ?? '') === 'hot' ? 'hot' : $k0;   // квартира лише з гарячою — на її сторінку
      $items[] = ['id' => $pid . '|' . $k, 'kind' => $k, 'title' => self::KT[$ru][$k], 'place' => (string)($p['label'] ?? $p['name'] ?? ''), 'placeId' => $pid, 'due' => $due, 'done' => false, 'pay' => false,
        'route' => in_array($k, ['cold', 'hot'], true) ? 'water-' . $k : $k];
    }
    if (!$items) return null;
    [$la, $go, $done] = self::LA[$ru];
    return ['aps' => ['timestamp' => $now, 'event' => 'start', 'attributes-type' => 'WindowActivityAttributes',
      'attributes' => ['title' => $la, 'goLabel' => $go, 'doneLabel' => $done],
      'content-state' => ['items' => $items, 'updatedAt' => $now - self::REF],
      'stale-date' => $due + self::REF + 86400, 'dismissal-date' => $due + self::REF + 86400,
      'alert' => ['title' => $la, 'body' => $items[0]['title'] . ($items[0]['place'] !== '' ? ' · ' . $items[0]['place'] : '')]]];
  }
  /** cron щогодини (10–20 за Києвом): тим, у кого є токен las, — Live Activity того ж дня, що й нагадування. → [[uid, kind, status], …] */
  public static function runLive(int $now): array {
    if (!self::ready()) return [];
    self::table(); $d = (new DateTimeImmutable('@' . $now))->setTimezone(new DateTimeZone('Europe/Kyiv'));
    if ((int)$d->format('G') < 10 || (int)$d->format('G') >= 20) return [];
    $today = $d->format('Y-m-d'); $fixed = Reminders::due($now); $out = [];
    foreach (Db::q("SELECT DISTINCT t.user_id, s.data FROM push_tokens t JOIN user_state s ON s.user_id = t.user_id WHERE t.kind = 'las' AND t.bad IS NULL")->fetchAll() as $row) {
      $uid = (int)$row['user_id']; $st = json_decode((string)$row['data'], true); if (!is_array($st)) continue;
      if (!empty($st['remind']['off'])) continue;
      foreach (Reminders::dueFor($st, $fixed, $today) as $due) {
        if (Db::one('SELECT 1 AS x FROM push_sent WHERE user_id = ? AND kind = ? AND ym = ?', [$uid, 'la:' . $due['kind'], $due['ym']])) continue;
        $ps = Reminders::placesDue($st, $due['kind'], $due['ym'], $today); if (!$ps) continue;
        foreach ($ps as &$p0) foreach ((array)($st['places'] ?? []) as $sp) if (is_array($sp) && ($sp['id'] ?? '') === $p0['id']) {
          $wk = array_map(fn($m) => (string)($m['kind'] ?? ''), array_filter((array)($sp['water']['meters'] ?? []), fn($m) => is_array($m) && empty($m['deleted']) && empty($m['removed'])));
          if ($wk && !in_array('cold', $wk, true)) $p0['k'] = 'hot';
        }
        unset($p0);
        $pl = self::laPayload($due['kind'], (string)($st['remind']['lang'] ?? $st['lang'] ?? 'uk'), $ps, $today, $now); if (!$pl) continue;
        Db::q('INSERT INTO push_sent (user_id, kind, ym, at) VALUES (?, ?, ?, ?)', [$uid, 'la:' . $due['kind'], $due['ym'], Http::iso()]);
        $st0 = 'none';
        foreach (self::tokens($uid, 'las') as $t) { try { $r = self::send($t, $pl, 'liveactivity', 10); $st0 = $r['code'] === 200 ? 'ok' : 'error ' . $r['code'] . ' ' . $r['reason']; } catch (Throwable $e) { $st0 = 'error'; } }
        Db::q('UPDATE push_sent SET status = ? WHERE user_id = ? AND kind = ? AND ym = ?', [mb_substr($st0, 0, 40), $uid, 'la:' . $due['kind'], $due['ym']]);
        $out[] = [$uid, $due['kind'], $st0];
      }
    }
    return $out;
  }
  /** Старі й погані токени (60 днів без оновлення) — геть. */
  public static function cleanup(?int $now = null): int {
    self::table(); return Db::q('DELETE FROM push_tokens WHERE seen_at < ?', [gmdate('Y-m-d\TH:i:s', ($now ?? time()) - 60 * 86400) . '+00:00'])->rowCount();
  }
  /** /api/health → push: лише числа. */
  public static function summary(): array {
    try { self::table(); } catch (Throwable $e) { return ['err' => 'db']; }
    $n = []; foreach (Db::q('SELECT kind, env, COUNT(*) AS c, SUM(CASE WHEN bad IS NULL THEN 0 ELSE 1 END) AS b FROM push_tokens GROUP BY kind, env')->fetchAll() as $r) $n[$r['kind'] . ' ' . $r['env']] = ['n' => (int)$r['c'], 'bad' => (int)$r['b']];
    return ['ready' => self::ready(), 'tokens' => $n, 'la' => Db::q("SELECT status, COUNT(*) AS c FROM push_sent WHERE kind LIKE 'la:%' GROUP BY status")->fetchAll(PDO::FETCH_KEY_PAIR)];
  }
}
