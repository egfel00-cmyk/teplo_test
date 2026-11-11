<?php
// Почта (81-я, 09.11.2026): письма по SMTP — аналитика владельцу (сводка за сутки), нагадування людям без Telegram,
// дальше — подача показаний e-mail (Львівобленерго, Львівводоканал). Без mail()/exec: свой SMTP-клиент на сокетах.
// Hetzner закрывает исходящие 25 и 465 → внешний сервис по 587 + STARTTLS (Brevo — 300 писем/сутки бесплатно, Gmail — пароль приложения).
// Настройки — /admin → «Настройки» → «Пошта» (Cfg::RUNTIME smtp_* / mail_*; ключ — только на сервере, наружу — маской).
// Журнал — таблица mail_log (кому, тема, итог), в /api/health — только числа.
declare(strict_types=1);
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class Mail {
  /** Тесты: перехват вместо сети — callable(array $conf, string $from, array $rcpt, string $data): ?string (null — ушло, строка — ошибка). */
  public static $send = null;
  const DAY_MAX = 250;    // за 24 ч всего (Brevo free — 300/сутки; запас на ручные проверки)
  const KEYS = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_from_name', 'mail_admin_to', 'mail_digest', 'mail_draft'];

  public static function conf(): array {
    return ['host' => trim((string)Cfg::get('smtp_host')), 'port' => (int)(Cfg::get('smtp_port') ?: 587), 'user' => (string)Cfg::get('smtp_user'),
      'pass' => (string)Cfg::get('smtp_pass'), 'from' => trim((string)Cfg::get('smtp_from')), 'name' => (string)(Cfg::get('smtp_from_name') ?: 'Лічильники'),
      'admin' => trim((string)Cfg::get('mail_admin_to')), 'digest' => (string)(Cfg::get('mail_digest') ?: 'day')];
  }
  /** Черновик /admin «Пошта» (113-я): host, port, user, from, name, admin, digest — без ключа; null — нет. */
  public static function draft(): ?array {
    $d = json_decode((string)Cfg::get('mail_draft'), true); if (!is_array($d) || empty($d['host'])) return null;
    return array_intersect_key($d, array_flip(['host', 'port', 'user', 'from', 'name', 'admin', 'digest']));
  }
  public static function on(): bool { $c = self::conf(); return $c['host'] !== '' && self::valid($c['from']); }
  public static function valid(string $a): bool { return strlen($a) <= 190 && (bool)filter_var($a, FILTER_VALIDATE_EMAIL) && !preg_match('/[\r\n<>,;"]/', $a); }
  /** Адреса, куда письма не дойдут (учётки-заглушки вроде admin@teplo.test) — не шлём, чтобы не портить репутацию отправителя. */
  public static function deliverable(string $a): bool { return self::valid($a) && !preg_match('/\.(test|example|invalid|localhost|local)$/i', $a); }

  /** Отправить письмо. $m: to (строка | массив), subject, text, html?, replyTo?, cc?, kind (test|digest|remind|submit), user?, headers? (доп. заголовки).
   *  → ['ok' => true, 'id' => Message-ID]; не ушло — HttpError 'mail_failed' с human (пароль в тексте не бывает). $c — проверка ещё не сохранённых настроек. */
  public static function send(array $m, ?array $c = null): array {
    $c = $c ?? self::conf(); $kind = (string)($m['kind'] ?? 'other');
    if ($c['host'] === '' || !self::valid($c['from'])) throw self::fail('not_configured', 'Почта не настроена: /admin → «Настройки» → «Пошта».');
    $to = array_values(array_filter(array_map('trim', (array)($m['to'] ?? [])), fn($a) => $a !== ''));
    $cc = array_values(array_filter(array_map('trim', (array)($m['cc'] ?? [])), fn($a) => $a !== ''));
    foreach (array_merge($to, $cc) as $a) if (!self::valid($a)) throw self::fail('bad_rcpt', 'Неверный адрес получателя: ' . mb_substr($a, 0, 80));
    if (!$to) throw self::fail('no_rcpt', 'Не указан получатель.');
    $reply = trim((string)($m['replyTo'] ?? '')); if ($reply !== '' && !self::valid($reply)) $reply = '';
    if ($kind !== 'test' && self::count24() >= self::DAY_MAX) throw self::fail('day_limit', 'За сутки уже ' . self::DAY_MAX . ' писем — остальные завтра (лимит бесплатного тарифа).');
    $dom = substr(strrchr($c['from'], '@'), 1) ?: 'localhost';
    $id = bin2hex(random_bytes(12)) . '@' . $dom;
    $data = self::build($c, $to, $cc, $reply, (string)($m['subject'] ?? ''), (string)($m['text'] ?? ''), isset($m['html']) ? (string)$m['html'] : null, $id, (array)($m['headers'] ?? []), $kind);
    $err = null;
    try { $err = self::$send ? (self::$send)($c, $c['from'], array_merge($to, $cc), $data) : self::smtp($c, $c['from'], array_merge($to, $cc), $data); }
    catch (HttpError $e) { $err = (string)($e->extra['human'] ?? $e->err); }
    catch (Throwable $e) { $err = 'Сбой отправки: ' . mb_substr($e->getMessage(), 0, 120); }
    if ($err !== null && $c['pass'] !== '') $err = str_replace($c['pass'], '•••', $err);
    self::log($kind, isset($m['user']) ? (int)$m['user'] : null, implode(', ', array_merge($to, $cc)), (string)($m['subject'] ?? ''), $err === null ? 'sent' : 'failed', $err, $id);
    if ($err !== null) throw self::fail('mail_failed', $err);
    return ['ok' => true, 'id' => $id];
  }

  private static function fail(string $code, string $human): HttpError { return new HttpError(422, $code, ['human' => $human]); }

  // ---------- письмо (MIME): UTF-8, base64, текст и (по желанию) HTML ----------
  /** Заголовок с не-ASCII — encoded-word (RFC 2047) кусками по ~45 байт, без разрыва UTF-8. Переводы строк вырезаются (инъекция заголовков). */
  public static function hdr(string $s): string {
    $s = trim(preg_replace('/[\r\n\t]+/', ' ', $s));
    if (!preg_match('/[^\x20-\x7e]/', $s)) return $s;
    $out = []; $buf = '';
    foreach (preg_split('//u', $s, -1, PREG_SPLIT_NO_EMPTY) as $ch) {
      if (strlen($buf . $ch) > 45) { $out[] = '=?UTF-8?B?' . base64_encode($buf) . '?='; $buf = ''; }
      $buf .= $ch;
    }
    if ($buf !== '') $out[] = '=?UTF-8?B?' . base64_encode($buf) . '?=';
    return implode("\r\n ", $out);
  }
  private static function addr(string $a, string $name = ''): string {
    $a = preg_replace('/[\r\n<>]/', '', $a); $name = trim(str_replace('"', '', preg_replace('/[\r\n]/', ' ', $name)));
    return $name === '' ? $a : (preg_match('/[^\x20-\x7e]/', $name) ? self::hdr($name) : '"' . $name . '"') . ' <' . $a . '>';
  }
  public static function build(array $c, array $to, array $cc, string $reply, string $subject, string $text, ?string $html, string $id, array $extra = [], string $kind = ''): string {
    $h = ['Date: ' . gmdate('D, d M Y H:i:s') . ' +0000', 'From: ' . self::addr($c['from'], $c['name']),
      'To: ' . implode(', ', array_map(fn($a) => self::addr($a), $to))];
    if ($cc) $h[] = 'Cc: ' . implode(', ', array_map(fn($a) => self::addr($a), $cc));
    if ($reply !== '') $h[] = 'Reply-To: ' . self::addr($reply);
    $h[] = 'Subject: ' . self::hdr($subject);
    $h[] = 'Message-ID: <' . $id . '>';
    $h[] = 'MIME-Version: 1.0';
    if (in_array($kind, ['digest', 'remind', 'test'], true)) $h[] = 'Auto-Submitted: auto-generated';
    foreach ($extra as $k => $v) if (preg_match('/^[A-Za-z][A-Za-z0-9-]{1,40}$/', (string)$k)) $h[] = $k . ': ' . preg_replace('/[\r\n]+/', ' ', (string)$v);
    $b64 = fn(string $s) => rtrim(chunk_split(base64_encode($s), 76, "\r\n"));
    $text = str_replace(["\r\n", "\r"], "\n", $text);
    if ($html === null) {
      $h[] = 'Content-Type: text/plain; charset=UTF-8'; $h[] = 'Content-Transfer-Encoding: base64';
      return implode("\r\n", $h) . "\r\n\r\n" . $b64(str_replace("\n", "\r\n", $text)) . "\r\n";
    }
    $bd = 'b' . bin2hex(random_bytes(10));
    $h[] = 'Content-Type: multipart/alternative; boundary="' . $bd . '"';
    return implode("\r\n", $h) . "\r\n\r\n"
      . "--$bd\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . $b64(str_replace("\n", "\r\n", $text)) . "\r\n"
      . "--$bd\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . $b64($html) . "\r\n--$bd--\r\n";
  }

  // ---------- SMTP: 587 + STARTTLS (465 — сразу TLS); без TLS — только на localhost (тесты); AUTH PLAIN/LOGIN ----------
  /** → null (ушло) или текст ошибки по-человечески. */
  public static function smtp(array $c, string $from, array $rcpt, string $data): ?string {
    $host = $c['host']; $port = $c['port']; $local = in_array($host, ['127.0.0.1', 'localhost', '::1'], true);
    $ssl = $port === 465;
    $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true, 'peer_name' => $host, 'SNI_enabled' => true]]);
    $s = @stream_socket_client(($ssl ? 'ssl://' : 'tcp://') . $host . ':' . $port, $en, $es, 15, STREAM_CLIENT_CONNECT, $ctx);
    if ($es !== '' && preg_match('/getaddrinfo|Name or service|nodename/i', $es)) $es = 'сервер с таким именем не найден — проверьте адрес';
    elseif ($es !== '' && preg_match('/timed out/i', $es)) $es = 'нет ответа за 15 секунд';
    if (!$s) return "Не удалось подключиться к $host:$port" . ($es ? " ($es)" : '') . '.' . (in_array($port, [25, 465], true) ? ' Hetzner закрывает исходящие порты 25 и 465 — укажите порт 587.' : '');
    stream_set_timeout($s, 25);
    $read = function () use ($s): array {
      $code = 0; $text = [];
      while (($l = fgets($s, 4096)) !== false) { $text[] = rtrim($l); $code = (int)substr($l, 0, 3); if (strlen($l) < 4 || $l[3] !== '-') break; }
      return [$code, $text];
    };
    $say = function (string $line) use ($s): void { fwrite($s, $line . "\r\n"); };
    $why = fn(array $r, string $step) => $step . ': ' . ($r[0] ? $r[0] . ' ' : 'нет ответа ') . mb_substr(preg_replace('/^\d{3}[ -]/', '', implode(' ', $r[1])), 0, 160);
    try {
      $r = $read(); if ($r[0] !== 220) return $why($r, 'Сервер не поздоровался');
      $me = (string)(parse_url(Cfg::appUrl(), PHP_URL_HOST) ?: 'localhost');
      $say("EHLO $me"); $r = $read(); if ($r[0] !== 250) return $why($r, 'EHLO');
      $ext = strtoupper(implode("\n", $r[1]));
      if (!$ssl) {
        if (str_contains($ext, 'STARTTLS')) {
          $say('STARTTLS'); $r = $read(); if ($r[0] !== 220) return $why($r, 'STARTTLS');
          $m = STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT | (defined('STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT') ? STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT : 0);
          if (!@stream_socket_enable_crypto($s, true, $m)) return 'Не удалось включить шифрование (TLS) с ' . $host . ' — проверьте адрес сервера.';
          $say("EHLO $me"); $r = $read(); if ($r[0] !== 250) return $why($r, 'EHLO после TLS');
          $ext = strtoupper(implode("\n", $r[1]));
        } elseif (!$local) return "Сервер $host:$port не предлагает шифрование (STARTTLS) — пароль по открытому каналу не отправляем. Укажите порт 587.";
      }
      if ($c['user'] !== '') {
        if (preg_match('/AUTH[ =][^\n]*PLAIN/', $ext)) { $say('AUTH PLAIN ' . base64_encode("\0" . $c['user'] . "\0" . $c['pass'])); $r = $read(); }
        elseif (preg_match('/AUTH[ =][^\n]*LOGIN/', $ext)) {
          $say('AUTH LOGIN'); $r = $read();
          if ($r[0] === 334) { $say(base64_encode($c['user'])); $r = $read(); }
          if ($r[0] === 334) { $say(base64_encode($c['pass'])); $r = $read(); }
        } else return 'Сервер не предлагает вход по логину (AUTH PLAIN/LOGIN).';
        if ($r[0] !== 235) return $r[0] === 535 || $r[0] === 534 ? 'Сервер не принял логин или пароль (ключ SMTP): ' . mb_substr(preg_replace('/^\d{3}[ -]/', '', implode(' ', $r[1])), 0, 120) : $why($r, 'Вход');
      }
      $say('MAIL FROM:<' . $from . '>'); $r = $read(); if ($r[0] !== 250) return $why($r, 'Отправитель ' . $from . ' не принят');
      foreach ($rcpt as $a) { $say('RCPT TO:<' . $a . '>'); $r = $read(); if ($r[0] !== 250 && $r[0] !== 251) return $why($r, 'Получатель ' . $a . ' не принят'); }
      $say('DATA'); $r = $read(); if ($r[0] !== 354) return $why($r, 'DATA');
      $body = preg_replace('/^\./m', '..', str_replace("\r\n", "\n", $data));   // dot-stuffing
      fwrite($s, str_replace("\n", "\r\n", rtrim($body, "\n")) . "\r\n.\r\n");
      $r = $read(); if ($r[0] !== 250) return $why($r, 'Письмо не принято');
      $say('QUIT');
      return null;
    } finally { @fclose($s); }
  }

  // ---------- журнал ----------
  private static function table(): void {
    static $done = false; if ($done) return; $done = true;
    $my = Db::driver() !== 'sqlite';
    Db::pdo()->exec('CREATE TABLE IF NOT EXISTS mail_log (id ' . ($my ? 'INT UNSIGNED AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT')
      . ', at INT NOT NULL, kind VARCHAR(10) NOT NULL, user_id INT NULL, rcpt VARCHAR(255) NOT NULL, subject VARCHAR(200) NOT NULL, status VARCHAR(8) NOT NULL, err VARCHAR(250) NULL, msg_id VARCHAR(120) NULL)'
      . ($my ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : ''));
    // отписка от нагадувань на e-mail (ссылка в каждом письме) — отдельно от state, чтобы не спорить с синхронизацией
    Db::pdo()->exec('CREATE TABLE IF NOT EXISTS mail_optout (user_id INT PRIMARY KEY, at INT NOT NULL)');
  }
  private static function log(string $kind, ?int $uid, string $rcpt, string $subj, string $status, ?string $err, string $id): void {
    try { self::table(); Db::q('INSERT INTO mail_log (at, kind, user_id, rcpt, subject, status, err, msg_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [time(), substr($kind, 0, 10), $uid, mb_substr($rcpt, 0, 255), mb_substr($subj, 0, 200), $status, $err === null ? null : mb_substr($err, 0, 250), $id]);
      if (random_int(1, 100) === 1) Db::q('DELETE FROM mail_log WHERE at < ?', [time() - 90 * 86400]); } catch (Throwable $e) { error_log('teplo mail log: ' . $e->getMessage()); }
  }
  public static function count24(): int { self::table(); return (int)(Db::one("SELECT COUNT(*) n FROM mail_log WHERE at > ? AND status = 'sent' AND kind <> 'test'", [time() - 86400])['n'] ?? 0); }
  /** Последние письма для /admin (с адресами — это видит только владелец). */
  public static function recent(int $n = 15): array { self::table(); return Db::q('SELECT at, kind, user_id, rcpt, subject, status, err FROM mail_log ORDER BY id DESC LIMIT ' . max(1, $n))->fetchAll(); }
  /** /api/health: включена ли, сколько за сутки по видам и итогам, последний сбой (без адресов). */
  public static function health(): array {
    $o = ['on' => self::on(), 'digest' => self::on() ? self::conf()['digest'] : null];
    try {
      self::table(); $n = [];
      foreach (Db::q('SELECT kind, status, COUNT(*) AS n FROM mail_log WHERE at > ? GROUP BY kind, status', [time() - 86400])->fetchAll() as $x) $n[$x['kind'] . ' ' . $x['status']] = (int)$x['n'];
      $f = Db::one("SELECT at, kind, err FROM mail_log WHERE status = 'failed' ORDER BY id DESC LIMIT 1");
      $o['day'] = (object)$n;
      $o['lastFail'] = $f ? ['at' => gmdate('c', (int)$f['at']), 'kind' => $f['kind'], 'err' => preg_replace('/[\w.+-]+@[\w.-]+/', '…@…', (string)$f['err'])] : null;
      $o['digestAt'] = Cron::read()['mailDigest'] ?? null;
    } catch (Throwable $e) { $o['err'] = mb_substr($e->getMessage(), 0, 120); }
    return $o;
  }

  // ---------- отписка ----------
  public static function optoutToken(int $uid): string { return substr(hash_hmac('sha256', 'mail-off:' . $uid, Cfg::secret()), 0, 24); }
  public static function optoutUrl(int $uid): string { return Cfg::appUrl() . 'api/mail/off?u=' . $uid . '&t=' . self::optoutToken($uid); }
  public static function optedOut(int $uid): bool { self::table(); return (bool)Db::one('SELECT 1 AS x FROM mail_optout WHERE user_id = ?', [$uid]); }
  /** GET/POST /api/mail/off?u&t — без входа, по подписи; повтор — то же. → true, если подпись верна. */
  public static function optout(int $uid, string $t): bool {
    if ($uid <= 0 || !hash_equals(self::optoutToken($uid), $t)) return false;
    self::table(); if (!self::optedOut($uid)) Db::q('INSERT INTO mail_optout (user_id, at) VALUES (?, ?)', [$uid, time()]);
    return true;
  }
  /** Простая страница отписки (без JS): кнопка — POST на тот же адрес. */
  public static function optoutPage(bool $ok, bool $done, int $uid, string $t): string {
    $h = fn($s) => htmlspecialchars($s, ENT_QUOTES);
    $body = !$ok ? '<h1>Посилання застаріле або пошкоджене</h1><p>Вимкнути нагадування можна в «Налаштуваннях» сервісу.</p>'
      : ($done ? '<h1>Готово: нагадування на e-mail вимкнено</h1><p>Більше листів-нагадувань не буде. Увімкнути знову — у «Налаштуваннях» сервісу.</p>'
        : '<h1>Вимкнути нагадування на e-mail?</h1><p>Листи про строки передачі показань більше не приходитимуть. Telegram-нагадування це не зачіпає.</p>'
          . '<form method="post" action="?u=' . $uid . '&amp;t=' . $h($t) . '"><button type="submit">Вимкнути нагадування</button></form>');
    return '<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">'
      . '<title>Лічильники — нагадування на e-mail</title><style>body{font:17px/1.5 system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 20px;color:#1d2433}'
      . 'h1{font-size:22px}button{font:inherit;padding:12px 20px;border-radius:10px;border:0;background:#1d4ed8;color:#fff;min-height:48px}a{color:#1d4ed8}</style></head><body>'
      . $body . '<p><a href="' . $h(Cfg::appUrl()) . '">Відкрити «Лічильники»</a></p></body></html>';
  }
  public static function optin(int $uid): void { self::table(); Db::q('DELETE FROM mail_optout WHERE user_id = ?', [$uid]); }

  // ---------- /admin → «Настройки» → «Пошта» ----------
  public static function adminView(): array {
    $c = self::conf(); $mask = fn(string $v) => $v === '' ? '' : (strlen($v) > 14 ? substr($v, 0, 4) . '…' . substr($v, -4) : '••••');
    $d = self::on() ? null : self::draft(); if ($d) $c = array_replace($c, $d);   // 113-я: поля без ключа — с любого устройства останется вставить ключ
    return ['on' => self::on(), 'draft' => (bool)$d, 'host' => $c['host'], 'port' => $c['port'], 'user' => $c['user'], 'pass' => $mask($c['pass']), 'from' => $c['from'], 'name' => $c['name'],
      'admin' => $c['admin'], 'digest' => $c['digest'], 'source' => Cfg::source('smtp_host'), 'day' => self::on() ? self::count24() : 0, 'dayMax' => self::DAY_MAX,
      'recent' => self::on() ? self::recent(15) : []];
  }
  /** Проверить (тестовое письмо на mail_admin_to, иначе на адрес отправителя) и только потом сохранить. clear — удалить все настройки почты. */
  public static function adminSave(array $in): array {
    if (!empty($in['clear'])) { Cfg::saveRuntime(array_fill_keys(self::KEYS, null)); return ['ok' => true]; }
    $cur = self::conf(); if (!self::on() && ($d = self::draft())) $cur = array_replace($cur, $d);
    $host = strtolower(trim((string)($in['host'] ?? $cur['host']))); $port = (int)($in['port'] ?? $cur['port'] ?: 587);
    $user = trim((string)($in['user'] ?? $cur['user'])); $pass = (string)($in['pass'] ?? ''); if ($pass === '') $pass = $cur['pass'];
    $from = trim((string)($in['from'] ?? $cur['from'])); $name = trim((string)($in['name'] ?? $cur['name']));
    $admin = trim((string)($in['admin'] ?? $cur['admin'])); $digest = (string)($in['digest'] ?? $cur['digest']);
    if (!preg_match('/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/', $host) && !in_array($host, ['localhost', '127.0.0.1'], true))
      throw self::fail('bad_host', 'Сервер — имя вроде smtp-relay.brevo.com или smtp.gmail.com.');
    if (!in_array($port, [25, 465, 587, 2525], true)) throw self::fail('bad_port', 'Порт — 587 (обычно), 2525 или 465.');
    if (in_array($port, [25, 465], true) && !in_array($host, ['localhost', '127.0.0.1'], true)) throw self::fail('port_blocked', 'Наш сервер (Hetzner) не выпускает порты 25 и 465 — укажите 587.');
    if (!self::valid($from)) throw self::fail('bad_from', 'Адрес отправителя — e-mail, например noreply@peredai.com.ua.');
    if ($admin !== '' && !self::valid($admin)) throw self::fail('bad_admin', 'Куда присылать аналитику — e-mail.');
    if (!in_array($digest, ['day', 'week', 'off'], true)) $digest = 'day';
    if (mb_strlen($name) > 60) $name = mb_substr($name, 0, 60);
    $c = ['host' => $host, 'port' => $port, 'user' => $user, 'pass' => $pass, 'from' => $from, 'name' => $name ?: 'Лічильники', 'admin' => $admin, 'digest' => $digest];
    // 113-я: почта ещё не работает — поля без ключа сохраняем черновиком (Mail::on() от него не включается; ключ в черновик не попадает)
    if (!self::on()) Cfg::saveRuntime(['mail_draft' => json_encode(array_diff_key($c, ['pass' => 1]), JSON_UNESCAPED_UNICODE)]);
    if ($pass === '') throw self::fail('no_key', 'Вставьте ключ SMTP (Brevo → SMTP & API → «Generate SMTP key») и нажмите ещё раз. Остальные поля сохранены — с любого устройства останется только ключ.');
    $to = $admin !== '' ? $admin : $from;
    try {
      $r = self::send(['to' => $to, 'kind' => 'test', 'subject' => 'Лічильники: пошта працює',
        'text' => "Це тестовий лист із сервісу «Лічильники» (" . Cfg::appUrl() . ").\n\nЯкщо ви його бачите — відправка листів налаштована: щоденна зведення, нагадування людям без Telegram і подача показань e-mail.\n\nСервер: $host:$port, відправник: $from.",
      ], $c);
    } catch (HttpError $e) { throw self::fail('mail_check_failed', 'Проверка не прошла, ничего не сохранено' . (self::on() ? '' : ' (кроме полей без ключа)') . '. ' . ($e->extra['human'] ?? $e->err)); }
    Cfg::saveRuntime(['smtp_host' => $host, 'smtp_port' => (string)$port, 'smtp_user' => $user, 'smtp_pass' => $pass, 'smtp_from' => $from,
      'smtp_from_name' => $name, 'mail_admin_to' => $admin, 'mail_digest' => $digest, 'mail_draft' => null]);
    return ['ok' => true, 'sent' => $to, 'id' => $r['id']];
  }

  // ---------- сводка владельцу (cron, часовой запуск :17): каждый день в 8-м часу по Киеву (week — по понедельникам) ----------
  public static function digestDue(int $now, ?string $last): ?string {
    $c = self::conf(); if (!self::on() || $c['digest'] === 'off' || !self::deliverable($c['admin'])) return null;
    $d = (new DateTimeImmutable('@' . $now))->setTimezone(new DateTimeZone('Europe/Kyiv'));
    if ((int)$d->format('G') < 8) return null;
    if ($c['digest'] === 'week' && $d->format('N') !== '1') return null;
    $key = $d->format('Y-m-d');
    return $last === $key ? null : $key;
  }
  /** Цифры за период (сутки или неделя) — без личных данных, кроме текстов отзывов (их пишут нам). */
  public static function digestData(int $now, int $days = 1): array {
    $since = $now - $days * 86400; $iso = gmdate('c', $since); $day0 = Visits::day($since);
    $c = fn(string $sql, array $p = []) => (int)(Db::one($sql, $p)['n'] ?? 0);
    $o = ['days' => $days, 'users' => $c('SELECT COUNT(*) n FROM users'), 'newUsers' => $c('SELECT COUNT(*) n FROM users WHERE created_at >= ?', [$iso])];
    // люди без своих/тестовых браузеров (vid_tags): открыли сайт, внесли показания (stage 3), добавили счётчик (stage ≥ 2)
    $v = Db::one("SELECT COUNT(DISTINCT v.vid) n, COUNT(DISTINCT CASE WHEN v.stage >= 3 THEN v.vid END) rec, COUNT(DISTINCT CASE WHEN v.stage >= 2 THEN v.vid END) met,
      COUNT(DISTINCT v.user_id) usr FROM visits v LEFT JOIN vid_tags t ON t.vid = v.vid WHERE v.day >= ? AND t.vid IS NULL", [$day0]) ?? [];
    $o['visits'] = ['browsers' => (int)($v['n'] ?? 0), 'readings' => (int)($v['rec'] ?? 0), 'meters' => (int)($v['met'] ?? 0), 'users' => (int)($v['usr'] ?? 0)];
    $o['feedback'] = Db::q('SELECT text, page, created_at FROM feedback WHERE created_at >= ? ORDER BY id DESC LIMIT 5', [$iso])->fetchAll();
    $o['feedbackNew'] = $c("SELECT COUNT(*) n FROM feedback WHERE status = 'new'");
    $o['photos'] = $c('SELECT COUNT(*) n FROM photos WHERE created_at >= ?', [$iso]);
    $o['photosBad'] = $c("SELECT COUNT(*) n FROM photos WHERE created_at >= ? AND (status = 'failed' OR problem IS NOT NULL)", [$iso]);
    $o['reportsBad'] = $c('SELECT COUNT(*) n FROM recog_reports WHERE created_at >= ? AND ok = 0', [$iso]);
    $o['server500'] = count(array_filter(ErrLog::list(200), fn($e) => (int)($e['at'] ?? 0) >= $since));
    try { $e = Journal::errSummary($days); $o['errs'] = ['js' => array_sum(array_map(fn($x) => (int)($x['n'] ?? 0), (array)($e['js'] ?? []))), 'api' => array_sum(array_map(fn($x) => (int)($x['n'] ?? 0), (array)($e['api'] ?? [])))]; } catch (Throwable $e) { $o['errs'] = null; }
    $o['remind'] = [];
    foreach (Db::q('SELECT kind, status, COUNT(*) n FROM reminders_sent WHERE sent_at >= ? GROUP BY kind, status', [$iso])->fetchAll() as $x) $o['remind'][$x['kind'] . ' ' . ($x['status'] ?? '…')] = (int)$x['n'];
    $o['mail'] = [];
    foreach (Db::q("SELECT kind, status, COUNT(*) n FROM mail_log WHERE at >= ? GROUP BY kind, status", [$since])->fetchAll() as $x) $o['mail'][$x['kind'] . ' ' . $x['status']] = (int)$x['n'];
    $o['cronAgo'] = Cron::age(); $o['bot'] = class_exists('Telegram') ? (Telegram::health()['needStart'] ?? null) : null;
    return $o;
  }
  public static function digestText(array $d): array {
    $p = $d['days'] > 1 ? 'за тиждень' : 'за добу';
    $L = ['Лічильники — зведення ' . $p, ''];
    $L[] = "Люди: усього {$d['users']}, нових {$d['newUsers']}.";
    $L[] = "Відкривали сайт: {$d['visits']['browsers']} браузерів (з входом — {$d['visits']['users']}), додали лічильник — {$d['visits']['meters']}, внесли показання — {$d['visits']['readings']}.";
    $L[] = "Фото на розпізнавання: {$d['photos']}" . ($d['photosBad'] ? ", з проблемою — {$d['photosBad']}" : '') . ($d['reportsBad'] ? "; люди скаржились на розпізнавання — {$d['reportsBad']}" : '') . '.';
    $bad = [];
    if ($d['server500']) $bad[] = "збої сервера (500): {$d['server500']}";
    if (!empty($d['errs']['js'])) $bad[] = "помилок JS у людей: {$d['errs']['js']}";
    if (!empty($d['errs']['api'])) $bad[] = "помилок API: {$d['errs']['api']}";
    if ($d['cronAgo'] === null || $d['cronAgo'] > 600) $bad[] = 'cron не запускався ' . ($d['cronAgo'] === null ? 'ні разу' : round($d['cronAgo'] / 60) . ' хв');
    if ($d['bot']) $bad[] = "бот не може писати {$d['bot']} людям (плашка «натисніть Старт»)";
    $L[] = $bad ? 'Що не так: ' . implode('; ', $bad) . '.' : 'Збоїв не було.';
    if ($d['remind']) $L[] = 'Нагадування: ' . implode(', ', array_map(fn($k, $v) => "$k — $v", array_keys($d['remind']), $d['remind'])) . '.';
    if ($d['mail']) $L[] = 'Листи: ' . implode(', ', array_map(fn($k, $v) => "$k — $v", array_keys($d['mail']), $d['mail'])) . '.';
    $L[] = 'Відгуків нових (не розібраних): ' . $d['feedbackNew'] . '.';
    foreach ($d['feedback'] as $f) $L[] = '  — «' . mb_substr(preg_replace('/\s+/', ' ', (string)$f['text']), 0, 160) . '»' . ($f['page'] ? ' (' . $f['page'] . ')' : '');
    $L[] = ''; $L[] = 'Аналітика: ' . Cfg::appUrl() . 'admin';
    $L[] = 'Частота — /admin → «Настройки» → «Пошта» (щодня, щотижня або вимкнути).';
    $issues = count($bad) + ($d['feedback'] ? 1 : 0);
    return ['subject' => 'Лічильники ' . $p . ': ' . $d['visits']['browsers'] . ' відвідувачів, ' . $d['newUsers'] . ' нових' . ($bad ? ' · є збої' : ''), 'text' => implode("\n", $L), 'issues' => $issues];
  }
  /** Зовёт cron в часовом запуске ($last — Cron mailDigest; cron сам пишет итог в cron.json). → дата сводки (отправили или сбой записан) или null. */
  public static function digest(int $now, ?string $last): ?string {
    $key = self::digestDue($now, $last); if ($key === null) return null;
    $c = self::conf(); $t = self::digestText(self::digestData($now, $c['digest'] === 'week' ? 7 : 1));
    try { self::send(['to' => $c['admin'], 'kind' => 'digest', 'subject' => $t['subject'], 'text' => $t['text']]); }
    catch (HttpError $e) { if ($e->err === 'day_limit') return null; }   // сбой — записан в mail_log; повтор завтра (не долбим сервер каждый час)
    return $key;
  }
}
