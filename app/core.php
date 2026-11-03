<?php
// Теплосервис — ядро: конфиг, БД, ответы, IP, лимиты. PHP 8.0+, без зависимостей.
// Сервер pokabot: адрес — getenv('SITE_BASE'), запись — только в getenv('SITE_DATA'), база и секреты — SITE_DATA/config.php.
declare(strict_types=1);
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class Cfg {
  private static ?array $c = null;
  private static ?array $o = null;
  /** Ключи, которые владелец может задать из /admin → «Настройки» (лежат в SITE_DATA/uploads/settings/settings.json, не в git).
   *  Непустое значение оттуда главнее config.php — чтобы включать/менять без доступа к серверу. */
  const RUNTIME = ['anthropic_api_key', 'anthropic_model', 'bot_token', 'bot_username', 'webhook_secret'];

  /** Значения по умолчанию; секреты и база — только из SITE_DATA/config.php (не из git). */
  private static function defaults(): array {
    return [
      'db' => null,               // ['host','name','user','pass'] или ['dsn' => 'sqlite:…'] для локального запуска
      'app_url' => null,          // по умолчанию — https://<хост><SITE_BASE>/
      'bot_token' => '', 'bot_username' => '', 'webhook_secret' => '',
      'anthropic_api_key' => '', 'anthropic_model' => 'claude-sonnet-5-5',
      'cookie_secure' => true, 'session_days' => 30,
      // кто видит аналитику (/admin): email аккаунта или Telegram id
      'admins' => ['emails' => ['admin@teplo.test'], 'telegram' => []],   // тестовый период: учётка владельца уже создана на бою; заменить в config.php
      'photo_keep_days' => 90,    // фото на распознавание хранятся столько дней (cron.php чистит)
      // кому верить в заголовке CF-Connecting-IP: Cloudflare + локальные адреса (Caddy на том же сервере)
      'trusted_proxies' => array_merge(['127.0.0.1/32', '::1/128'], self::cloudflare()),
      'limits' => [
        'ip_all' => [120, 60], 'login_ip' => [10, 300], 'login_fail_acc' => [5, 900], 'register_ip' => [5, 3600],
        'telegram_ip' => [30, 300], 'state_user' => [60, 60],
        'recog_upload' => [120, 3600],   // фото на распознавание: в час на пользователя
        'recog_run' => [40, 86400],      // запросов к нейросети: в сутки на пользователя (пачки по 3 фото)
        'feedback_ip' => [10, 3600],     // отзывов с одного IP в час
        'visit_ip' => [120, 3600],       // отметок «открыли сайт» с одного IP в час (устройства в аналитике)
        'bot_photo' => [60, 3600],       // фото боту в Telegram: в час на пользователя
      ],
      'max_body_bytes' => 300 * 1024,
      'max_photo_bytes' => 12 * 1024 * 1024,
    ];
  }
  /** Диапазоны Cloudflare (cloudflare.com/ips). */
  public static function cloudflare(): array {
    return ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20',
      '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
      '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32'];
  }
  private static ?string $hook = null;   // адрес сайта из вебхука бота (cron)
  public static function set(array $c): void { self::$c = array_replace(self::defaults(), $c); self::$o = null; self::$hook = null; }
  public static function settingsFile(): string { return self::data() . '/uploads/settings/settings.json'; }
  /** Секрет сервера для подписанных ссылок (создаётся сам при первом обращении, лежит рядом с настройками, 0600, не в git). */
  public static function secret(): string {
    static $k = null; if ($k !== null) return $k;
    $f = dirname(self::settingsFile()) . '/link.key';
    $v = is_file($f) ? trim((string)file_get_contents($f)) : '';
    if (!preg_match('/^[a-f0-9]{64}$/', $v)) {
      $v = bin2hex(random_bytes(32)); $d = dirname($f);
      if (!is_dir($d)) @mkdir($d, 0700, true);
      if (@file_put_contents($f, $v, LOCK_EX) !== false) @chmod($f, 0600);
    }
    return $k = $v;
  }
  /** Значения, сохранённые из /admin. */
  public static function runtime(): array {
    if (self::$o === null) {
      $f = self::settingsFile();
      $j = is_file($f) ? json_decode((string)file_get_contents($f), true) : null;
      self::$o = is_array($j) ? array_filter(array_intersect_key($j, array_flip(self::RUNTIME)), fn($v) => is_string($v) && $v !== '') : [];
    }
    return self::$o;
  }
  /** Сохранить настройки из /admin: пустая строка или null — удалить ключ (вернётся значение из config.php). */
  public static function saveRuntime(array $patch): void {
    $o = self::runtime();
    foreach (array_intersect_key($patch, array_flip(self::RUNTIME)) as $k => $v) { if ($v === null || $v === '') unset($o[$k]); else $o[$k] = (string)$v; }
    $f = self::settingsFile(); $dir = dirname($f);
    if (!is_dir($dir) && !@mkdir($dir, 0700, true)) throw new HttpError(500, 'settings_write', ['human' => 'Не удалось создать папку настроек в SITE_DATA/uploads.']);
    $tmp = $f . '.tmp' . bin2hex(random_bytes(3));
    if (@file_put_contents($tmp, json_encode($o, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT)) === false || !@rename($tmp, $f)) { @unlink($tmp); throw new HttpError(500, 'settings_write', ['human' => 'Не удалось записать файл настроек.']); }
    @chmod($f, 0600);
    self::$o = $o;
  }
  /** Откуда взято значение: 'admin' (из /admin), 'config' (config.php) или null (не задано). */
  public static function source(string $k): ?string {
    if (isset(self::runtime()[$k])) return 'admin';
    self::get('db'); return !empty(self::$c[$k]) && self::$c[$k] !== (self::defaults()[$k] ?? null) ? 'config' : null;
  }
  public static function get(string $k, $default = null) {
    if (in_array($k, self::RUNTIME, true) && isset(self::runtime()[$k])) return self::runtime()[$k];
    if (self::$c === null) {
      $f = rtrim((string)getenv('SITE_DATA'), '/') . '/config.php';
      $cfg = is_file($f) ? require $f : [];
      self::$c = array_replace(self::defaults(), is_array($cfg) ? $cfg : []);
    }
    return self::$c[$k] ?? $default;
  }
  public static function base(): string { return rtrim((string)getenv('SITE_BASE'), '/'); }
  public static function data(): string { return rtrim((string)getenv('SITE_DATA'), '/'); }
  public static function appUrl(): string {
    $u = (string)self::get('app_url', '');
    if ($u !== '') return rtrim($u, '/') . '/';
    $host = preg_replace('/[^a-z0-9.:-]/i', '', (string)($_SERVER['HTTP_HOST'] ?? ''));
    if ($host !== '') return 'https://' . $host . self::base() . '/';
    // cron (CLI): запроса нет — HTTP_HOST пуст. Адрес берём из вебхука бота (его ставит /admin с настоящим адресом), иначе
    // кнопки напоминаний вели на https://localhost/… и Telegram отвечал ошибкой (02.11.2026: elec2 → error)
    if (self::$hook === null) {
      self::$hook = '';
      if (class_exists('Telegram', false) && self::get('bot_token')) {
        $r = Telegram::call('getWebhookInfo', []);
        if (preg_match('~^(https://[^/?#\s]+/(?:[^?#\s]*/)?)api/bot/webhook~', (string)($r['result']['url'] ?? ''), $m)) self::$hook = $m[1];
      }
    }
    return self::$hook !== '' ? self::$hook : 'https://localhost' . self::base() . '/';
  }
  /** Адрес сайта известен (не заглушка localhost) — можно давать ссылки наружу (кнопки в Telegram). */
  public static function appUrlKnown(): bool { return !preg_match('~^https://localhost[:/]~', self::appUrl()); }
}

final class Db {
  private static ?PDO $pdo = null;
  public static function set(PDO $p): void { self::$pdo = $p; }
  public static function pdo(): PDO {
    if (!self::$pdo) {
      $c = Cfg::get('db');
      if (!is_array($c)) throw new HttpError(503, 'db_not_configured');
      $opt = [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC];
      self::$pdo = !empty($c['dsn'])
        ? new PDO($c['dsn'], $c['user'] ?? null, $c['pass'] ?? null, $opt)
        : new PDO('mysql:host=' . ($c['host'] ?? '127.0.0.1') . ';dbname=' . $c['name'] . ';charset=utf8mb4', $c['user'], $c['pass'], $opt);
      if (self::driver() === 'sqlite') self::$pdo->exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
      self::migrate();
    }
    return self::$pdo;
  }
  public static function driver(): string { return self::$pdo->getAttribute(PDO::ATTR_DRIVER_NAME); }
  public static function q(string $sql, array $p = []): PDOStatement { $s = self::pdo()->prepare($sql); $s->execute($p); return $s; }
  public static function one(string $sql, array $p = []): ?array { $r = self::q($sql, $p)->fetch(); return $r === false ? null : $r; }
  public static function id(): int { return (int)self::pdo()->lastInsertId(); }

  /** Схема создаётся кодом при первом обращении (руками в базу никто не заходит). */
  public static function migrate(): void {
    $my = self::driver() !== 'sqlite';
    $ai = $my ? 'INT UNSIGNED AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $txt = $my ? 'MEDIUMTEXT' : 'TEXT';
    $tail = $my ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';
    $sql = [
      "CREATE TABLE IF NOT EXISTS users (id $ai, email VARCHAR(190) NULL UNIQUE, password_hash VARCHAR(255) NULL, name VARCHAR(120) NULL, created_at VARCHAR(25) NOT NULL, last_login_at VARCHAR(25) NULL)$tail",
      "CREATE TABLE IF NOT EXISTS user_identities (id $ai, user_id INT NOT NULL, type VARCHAR(16) NOT NULL, external_id VARCHAR(64) NOT NULL, username VARCHAR(64) NULL, linked_at VARCHAR(25) NOT NULL, UNIQUE (type, external_id))$tail",
      "CREATE TABLE IF NOT EXISTS sessions (token_hash CHAR(64) PRIMARY KEY, user_id INT NOT NULL, created_at INT NOT NULL, expires_at INT NOT NULL, ip VARCHAR(45) NULL, ua VARCHAR(200) NULL)$tail",
      "CREATE TABLE IF NOT EXISTS rate_limits (k VARCHAR(190) NOT NULL, window_start INT NOT NULL, cnt INT NOT NULL, PRIMARY KEY (k, window_start))$tail",
      "CREATE TABLE IF NOT EXISTS user_state (user_id INT PRIMARY KEY, data $txt NOT NULL, version INT NOT NULL, updated_at VARCHAR(25) NOT NULL)$tail",
      "CREATE TABLE IF NOT EXISTS audit_log (id $ai, user_id INT NULL, action VARCHAR(60) NOT NULL, ip VARCHAR(45) NULL, created_at VARCHAR(25) NOT NULL)$tail",
      // отзывы с плавающей кнопки
      "CREATE TABLE IF NOT EXISTS feedback (id $ai, user_id INT NULL, text TEXT NOT NULL, contact VARCHAR(190) NULL, page VARCHAR(120) NULL, screen VARCHAR(16) NULL, lang VARCHAR(5) NULL, ua VARCHAR(200) NULL, ip VARCHAR(45) NULL, status VARCHAR(12) NOT NULL DEFAULT 'new', created_at VARCHAR(25) NOT NULL)$tail",
      // фото на распознавание (файлы — SITE_DATA/uploads/photos/<user>/), результат и проблема человеческим языком
      "CREATE TABLE IF NOT EXISTS photos (id CHAR(24) PRIMARY KEY, user_id INT NOT NULL, file VARCHAR(80) NOT NULL, mime VARCHAR(20) NOT NULL, bytes INT NOT NULL, w INT NULL, h INT NULL, status VARCHAR(12) NOT NULL DEFAULT 'uploaded', result TEXT NULL, problem TEXT NULL, created_at VARCHAR(25) NOT NULL)$tail",
      // журнал распознавания: ошибки запросов и итог (что не нашлось, что человек исправил)
      // документы к счётчику (паспорт, поверка) — файлы в SITE_DATA/uploads/docs/<user>/
      "CREATE TABLE IF NOT EXISTS docs (id CHAR(24) PRIMARY KEY, user_id INT NOT NULL, place VARCHAR(40) NOT NULL, kind VARCHAR(16) NOT NULL, file VARCHAR(80) NOT NULL, mime VARCHAR(40) NOT NULL, bytes INT NOT NULL, name VARCHAR(120) NULL, created_at VARCHAR(25) NOT NULL)$tail",
      // одноразовые ссылки «привязать Telegram через бота» (t.me/<бот>?start=link_<token>)
      "CREATE TABLE IF NOT EXISTS link_tokens (token CHAR(32) PRIMARY KEY, user_id INT NOT NULL, expires_at INT NOT NULL)$tail",
      // фото, присланные боту в Telegram: ждут, пока человек откроет сервис — там их распознаёт браузер (бесплатно)
      "CREATE TABLE IF NOT EXISTS bot_inbox (photo_id CHAR(24) PRIMARY KEY, user_id INT NOT NULL, taken_at INT NOT NULL, done TINYINT NOT NULL DEFAULT 0, created_at VARCHAR(25) NOT NULL)$tail",
      // напоминания ботом: какое уже отправлено в этом месяце (не чаще раза)
      "CREATE TABLE IF NOT EXISTS reminders_sent (user_id INT NOT NULL, kind VARCHAR(16) NOT NULL, ym CHAR(7) NOT NULL, sent_at VARCHAR(25) NOT NULL, PRIMARY KEY (user_id, kind, ym))$tail",
      // с чего работают: телефон / планшет / компьютер (одна строка на браузер в сутки, app/visits.php)
      "CREATE TABLE IF NOT EXISTS visits (day CHAR(10) NOT NULL, vid VARCHAR(24) NOT NULL, user_id INT NULL, device VARCHAR(8) NOT NULL, os VARCHAR(10) NOT NULL, tg TINYINT NOT NULL DEFAULT 0, pwa TINYINT NOT NULL DEFAULT 0, sw SMALLINT NULL, hits INT NOT NULL DEFAULT 1, first_at VARCHAR(25) NOT NULL, last_at VARCHAR(25) NOT NULL, PRIMARY KEY (day, vid))$tail",
      "CREATE TABLE IF NOT EXISTS recog_reports (id $ai, user_id INT NOT NULL, photo_ids TEXT NULL, kind VARCHAR(16) NOT NULL, ok TINYINT NOT NULL DEFAULT 0, text TEXT NOT NULL, data TEXT NULL, created_at VARCHAR(25) NOT NULL)$tail",
    ];
    foreach ($sql as $s) self::$pdo->exec($s);
    // фото, приложенные к записи истории (тепло/вода), не удаляются по сроку хранения, пока запись есть
    self::addColumn('photos', 'kept', 'TINYINT NOT NULL DEFAULT 0');
    // итог отправки напоминания: ok / blocked / no_chat / error: …
    self::addColumn('reminders_sent', 'status', 'VARCHAR(80) NULL');
    // что делал браузер за день (и без входа): stage 0 открыл · 1 клацал по экранам · 2 добавил счётчик · 3 внёс показания; сколько счётчиков/показаний
    self::addColumn('visits', 'stage', 'TINYINT NOT NULL DEFAULT 0');
    self::addColumn('visits', 'meters', 'INT NOT NULL DEFAULT 0');
    self::addColumn('visits', 'recs', 'INT NOT NULL DEFAULT 0');
  }
  /** ALTER … ADD COLUMN IF NOT EXISTS (в SQLite такого нет — смотрим список колонок). */
  private static function addColumn(string $t, string $c, string $def): void {
    if (self::driver() === 'sqlite') {
      foreach (self::$pdo->query("PRAGMA table_info($t)")->fetchAll() as $col) if (($col['name'] ?? '') === $c) return;
      self::$pdo->exec("ALTER TABLE $t ADD COLUMN $c $def");
    } elseif (!self::$pdo->query("SHOW COLUMNS FROM $t LIKE '$c'")->fetch()) self::$pdo->exec("ALTER TABLE $t ADD COLUMN IF NOT EXISTS $c $def");   // без DDL на каждом запросе
  }
}

final class HttpError extends Exception {
  public function __construct(public int $status, public string $err, public array $extra = []) { parent::__construct($err); }
}

final class Http {
  public static function now(): int { return time(); }
  public static function iso(): string { return gmdate('c'); }

  /** Реальный IP: CF-Connecting-IP / X-Forwarded-For — только если запрос пришёл от доверенного адреса (Cloudflare, локальный прокси). */
  public static function ip(array $server): string {
    $remote = $server['REMOTE_ADDR'] ?? '0.0.0.0';
    if (self::inList($remote, (array)Cfg::get('trusted_proxies', []))) {
      $cf = $server['HTTP_CF_CONNECTING_IP'] ?? '';
      if ($cf && filter_var($cf, FILTER_VALIDATE_IP)) return $cf;
      $xff = trim(explode(',', $server['HTTP_X_FORWARDED_FOR'] ?? '')[0]);
      if ($xff && filter_var($xff, FILTER_VALIDATE_IP)) return $xff;
    }
    return $remote;
  }
  public static function inList(string $ip, array $cidrs): bool {
    $bin = @inet_pton($ip); if ($bin === false) return false;
    foreach ($cidrs as $c) {
      [$net, $bits] = array_pad(explode('/', $c, 2), 2, null);
      $nb = @inet_pton($net); if ($nb === false || strlen($nb) !== strlen($bin)) continue;
      $bits = $bits === null ? strlen($bin) * 8 : (int)$bits;
      $bytes = intdiv($bits, 8); $rem = $bits % 8;
      if (substr($bin, 0, $bytes) !== substr($nb, 0, $bytes)) continue;
      if ($rem && ((ord($bin[$bytes]) ^ ord($nb[$bytes])) & (0xFF << (8 - $rem)) & 0xFF)) continue;
      return true;
    }
    return false;
  }
}

/** Фиксированное окно: не больше N событий за T секунд на ключ. Хранится в БД. */
final class RateLimit {
  public static function hit(string $name, string $key, bool $count = true): void {
    $l = Cfg::get('limits')[$name] ?? null; if (!$l) return;   // лимит не задан — не ограничиваем
    [$max, $win] = $l;
    $start = intdiv(Http::now(), $win) * $win; $k = substr($name . ':' . $key, 0, 190);
    $row = Db::one('SELECT cnt FROM rate_limits WHERE k = ? AND window_start = ?', [$k, $start]);
    $cnt = $row ? (int)$row['cnt'] : 0;
    if ($cnt >= $max) throw new HttpError(429, 'rate_limited', ['retryAfter' => $start + $win - Http::now()]);
    if ($count) {
      if ($row) Db::q('UPDATE rate_limits SET cnt = cnt + 1 WHERE k = ? AND window_start = ?', [$k, $start]);
      else Db::q('INSERT INTO rate_limits (k, window_start, cnt) VALUES (?, ?, 1)', [$k, $start]);
    }
    if (random_int(1, 200) === 1) Db::q('DELETE FROM rate_limits WHERE window_start < ?', [Http::now() - 86400 * 2]);
  }
  public static function check(string $name, string $key): void { self::hit($name, $key, false); }
}

/** Отметки cron.php (SITE_DATA/cache/cron.json): last — последний запуск (раз в минуту), hourly — итог часовых дел. */
final class Cron {
  public static function file(): string { return Cfg::data() . '/cache/cron.json'; }
  public static function read(): array { $j = json_decode((string)@file_get_contents(self::file()), true); return is_array($j) ? $j : []; }
  public static function write(array $j): void { @mkdir(dirname(self::file()), 0700, true); @file_put_contents(self::file(), json_encode($j, JSON_UNESCAPED_UNICODE), LOCK_EX); }
  /** Сколько секунд назад запускался cron (null — ни разу). */
  public static function age(): ?int { $t = strtotime((string)(self::read()['last'] ?? '')); return $t ? max(0, time() - $t) : null; }
}
