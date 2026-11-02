<?php
// Аналитика и поддержка для владельца: /admin (страница) + /api/admin/* (JSON).
// Доступ — только тем, кто перечислен в config.php: 'admins' => ['emails' => [...], 'telegram' => ['id или username']].
// Отзывы с плавающей кнопки принимаются здесь же (Feedback::create) — для них вход не нужен.
declare(strict_types=1);
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class Feedback {
  public static function create(?array $user, array $in, Req $r, string $ip): array {
    $text = trim((string)($in['text'] ?? ''));
    if (mb_strlen($text) < 2) throw new HttpError(422, 'empty');
    RateLimit::hit('feedback_ip', $ip);
    $cut = fn($v, $n) => ($v = trim((string)$v)) === '' ? null : mb_substr($v, 0, $n);
    Db::q('INSERT INTO feedback (user_id, text, contact, page, screen, lang, ua, ip, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      $user ? (int)$user['id'] : null, mb_substr($text, 0, 4000), $cut($in['contact'] ?? '', 190), $cut($in['page'] ?? '', 120), $cut($in['screen'] ?? '', 16),
      $cut($in['lang'] ?? '', 5), mb_substr($r->header('User-Agent'), 0, 200), $ip, 'new', Http::iso()]);
    return ['ok' => true];
  }
}

final class Admin {
  public static function is(?array $u): bool {
    if (!$u) return false;
    $a = (array)Cfg::get('admins', []);
    $emails = array_map('mb_strtolower', (array)($a['emails'] ?? []));
    if ($u['email'] && in_array(mb_strtolower($u['email']), $emails, true)) return true;
    $tgList = array_map(fn($x) => mb_strtolower(ltrim((string)$x, '@')), (array)($a['telegram'] ?? []));
    if (!$tgList) return false;
    $tg = Db::one("SELECT external_id, username FROM user_identities WHERE user_id = ? AND type = 'telegram'", [$u['id']]);
    return $tg && (in_array((string)$tg['external_id'], $tgList, true) || ($tg['username'] && in_array(mb_strtolower($tg['username']), $tgList, true)));
  }

  /** Сводка по сохранённому состоянию пользователя (то, что он видит у себя). */
  private static function stateSummary(?string $json): array {
    $s = $json ? json_decode($json, true) : null;
    if (!is_array($s)) return ['meter' => null, 'readings' => 0, 'handed' => 0, 'last' => null, 'phone' => null];
    $rd = array_values(array_filter((array)($s['readings'] ?? []), 'is_array'));
    $last = $rd ? end($rd) : null;
    return ['meter' => $s['meter']['modelId'] ?? null, 'unit' => $s['meter']['unit'] ?? null, 'readings' => count($rd),
      'handed' => count(array_filter($rd, fn($x) => in_array($x['status'] ?? '', ['handed', 'accepted'], true))),
      'last' => $last ? ['date' => $last['htm']['date'] ?? substr((string)($last['createdAt'] ?? ''), 0, 10), 'status' => $last['status'] ?? null, 'verdict' => $last['verdict'] ?? null, 'source' => $last['source'] ?? null] : null,
      'phone' => ($s['contacts']['phone'] ?? '') ?: null, 'contactEmail' => ($s['contacts']['email'] ?? '') ?: null, 'apartment' => $s['meter']['apartment'] ?? null];
  }

  private static function users(string $where = '', array $p = []): array {
    $rows = Db::q("SELECT u.id, u.email, u.name, u.created_at, u.last_login_at, i.external_id AS tg_id, i.username AS tg_username, s.data, s.updated_at AS state_at,
        (SELECT COUNT(*) FROM photos ph WHERE ph.user_id = u.id) AS photos,
        (SELECT COUNT(*) FROM feedback f WHERE f.user_id = u.id) AS feedback
      FROM users u LEFT JOIN user_identities i ON i.user_id = u.id AND i.type = 'telegram' LEFT JOIN user_state s ON s.user_id = u.id
      $where ORDER BY u.id DESC LIMIT 1000", $p)->fetchAll();
    return array_map(function ($u) { $sum = self::stateSummary($u['data']); unset($u['data']); return $u + ['state' => $sum]; }, $rows);
  }

  private static function photos(string $where = '', array $p = [], int $limit = 300): array {
    $rows = Db::q("SELECT ph.id, ph.user_id, ph.file, ph.mime, ph.bytes, ph.w, ph.h, ph.status, ph.result, ph.problem, ph.created_at, u.email, i.username AS tg_username
      FROM photos ph LEFT JOIN users u ON u.id = ph.user_id LEFT JOIN user_identities i ON i.user_id = ph.user_id AND i.type = 'telegram'
      $where ORDER BY ph.created_at DESC LIMIT $limit", $p)->fetchAll();
    foreach ($rows as &$r) { $j = $r['result'] ? json_decode($r['result'], true) : null; $r['result'] = $j; $r['exists'] = is_file(Recognize::path($r)); unset($r['file']); }
    return $rows;
  }

  public static function route(string $key, array $q, array $in, array $me): array {
    switch ($key) {
      case 'GET /api/admin/overview': {
        $c = fn($sql, $p = []) => (int)(Db::one($sql, $p)['n'] ?? 0);
        $week = gmdate('c', time() - 7 * 86400);
        return [
          'users' => $c('SELECT COUNT(*) n FROM users'), 'usersWeek' => $c('SELECT COUNT(*) n FROM users WHERE created_at >= ?', [$week]),
          'activeWeek' => $c('SELECT COUNT(*) n FROM users WHERE last_login_at >= ?', [$week]),
          'withTelegram' => $c("SELECT COUNT(DISTINCT user_id) n FROM user_identities WHERE type = 'telegram'"),
          'withData' => $c('SELECT COUNT(*) n FROM user_state'),
          'feedback' => $c('SELECT COUNT(*) n FROM feedback'), 'feedbackNew' => $c("SELECT COUNT(*) n FROM feedback WHERE status = 'new'"),
          'photos' => $c('SELECT COUNT(*) n FROM photos'), 'photosFailed' => $c("SELECT COUNT(*) n FROM photos WHERE status = 'failed' OR problem IS NOT NULL"),
          'reports' => $c('SELECT COUNT(*) n FROM recog_reports'), 'reportsBad' => $c('SELECT COUNT(*) n FROM recog_reports WHERE ok = 0'),
          'recognition' => (bool)Cfg::get('anthropic_api_key'), 'telegram' => (bool)Cfg::get('bot_token'), 'photoKeepDays' => (int)Cfg::get('photo_keep_days', 90),
          'me' => $me['email'] ?: ('tg:' . $me['id']),
        ];
      }
      case 'GET /api/admin/users': {
        $s = trim((string)($q['q'] ?? ''));
        if ($s === '') return ['users' => self::users()];
        $like = '%' . str_replace(['%', '_'], ['\%', '\_'], mb_strtolower($s)) . '%';
        return ['users' => self::users('WHERE LOWER(COALESCE(u.email, \'\')) LIKE ? OR LOWER(COALESCE(i.username, \'\')) LIKE ? OR i.external_id = ? OR u.id = ? OR LOWER(COALESCE(s.data, \'\')) LIKE ?', [$like, $like, $s, (int)$s, $like])];
      }
      case 'GET /api/admin/user': {
        $id = (int)($q['id'] ?? 0);
        $u = self::users('WHERE u.id = ?', [$id]); if (!$u) throw new HttpError(404, 'not_found');
        $st = Db::one('SELECT data FROM user_state WHERE user_id = ?', [$id]);
        return ['user' => $u[0], 'state' => $st ? json_decode($st['data'], true) : null,
          'feedback' => Db::q('SELECT * FROM feedback WHERE user_id = ? ORDER BY id DESC LIMIT 100', [$id])->fetchAll(),
          'photos' => self::photos('WHERE ph.user_id = ?', [$id], 100),
          'reports' => Db::q('SELECT * FROM recog_reports WHERE user_id = ? ORDER BY id DESC LIMIT 100', [$id])->fetchAll(),
          'audit' => Db::q('SELECT action, ip, created_at FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT 50', [$id])->fetchAll()];
      }
      case 'GET /api/admin/feedback':
        return ['feedback' => Db::q("SELECT f.*, u.email, i.username AS tg_username FROM feedback f LEFT JOIN users u ON u.id = f.user_id
          LEFT JOIN user_identities i ON i.user_id = f.user_id AND i.type = 'telegram' ORDER BY f.id DESC LIMIT 500")->fetchAll()];
      case 'POST /api/admin/feedback': {
        $st = (string)($in['status'] ?? '');
        if (!in_array($st, ['new', 'done', 'spam'], true)) throw new HttpError(422, 'bad_status');
        Db::q('UPDATE feedback SET status = ? WHERE id = ?', [$st, (int)($in['id'] ?? 0)]);
        return ['ok' => true];
      }
      case 'GET /api/admin/photos': {
        $f = (string)($q['filter'] ?? '');
        return ['photos' => $f === 'problems' ? self::photos("WHERE ph.status = 'failed' OR ph.problem IS NOT NULL") : self::photos()];
      }
      case 'GET /api/admin/settings': return self::settings();
      case 'POST /api/admin/settings/anthropic': {
        if (!empty($in['clear'])) { Cfg::saveRuntime(['anthropic_api_key' => null]); return ['ok' => true, 'settings' => self::settings()]; }
        $key = trim((string)($in['key'] ?? '')); $model = trim((string)($in['model'] ?? ''));
        if ($model !== '' && !preg_match('/^[a-z0-9][a-z0-9.\-]{2,80}$/', $model)) throw new HttpError(422, 'bad_model', ['human' => 'Имя модели — латиница, цифры, точки и дефисы, например claude-sonnet-5-5.']);
        if ($key === '' && !Cfg::get('anthropic_api_key')) throw new HttpError(422, 'no_key', ['human' => 'Вставьте ключ API (начинается с sk-ant-).']);
        if ($key !== '' && !preg_match('/^sk-ant-[A-Za-z0-9_\-]{20,250}$/', $key)) throw new HttpError(422, 'bad_key', ['human' => 'Это не похоже на ключ Anthropic: он начинается с sk-ant- и без пробелов.']);
        $useKey = $key !== '' ? $key : (string)Cfg::get('anthropic_api_key'); $useModel = $model !== '' ? $model : (string)Cfg::get('anthropic_model');
        try { $chk = Recognize::checkKey($useKey, $useModel); }
        catch (HttpError $e) { throw new HttpError(422, 'key_check_failed', ['human' => 'Проверка не прошла, ничего не сохранено. ' . ($e->extra['human'] ?? $e->err)]); }
        Cfg::saveRuntime(['anthropic_api_key' => $key !== '' ? $key : (Cfg::runtime()['anthropic_api_key'] ?? null), 'anthropic_model' => $model !== '' ? $model : (Cfg::runtime()['anthropic_model'] ?? null)]);
        return ['ok' => true, 'checked' => $chk, 'settings' => self::settings()];
      }
      case 'POST /api/admin/settings/telegram': {
        if (!empty($in['clear'])) {
          if (Cfg::get('bot_token')) try { Telegram::call('deleteWebhook', []); } catch (Throwable $e) {}
          Cfg::saveRuntime(['bot_token' => null, 'bot_username' => null, 'webhook_secret' => null]); return ['ok' => true, 'settings' => self::settings()];
        }
        $token = trim((string)($in['token'] ?? ''));
        if ($token === '') { $token = (string)Cfg::get('bot_token'); if ($token === '') throw new HttpError(422, 'no_token', ['human' => 'Вставьте токен бота от @BotFather.']); }
        if (!preg_match('/^\d{5,15}:[A-Za-z0-9_\-]{30,60}$/', $token)) throw new HttpError(422, 'bad_token', ['human' => 'Токен выглядит как 1234567890:AA… — скопируйте его из сообщения @BotFather целиком.']);
        $me = Telegram::call('getMe', [], $token);
        if (empty($me['ok']) || empty($me['result']['username'])) throw new HttpError(422, 'token_rejected', ['human' => 'Telegram не принял токен: ' . ($me['description'] ?? 'нет ответа') . '. Ничего не сохранено.']);
        Cfg::saveRuntime(['bot_token' => $token, 'bot_username' => (string)$me['result']['username'],
          'webhook_secret' => Cfg::runtime()['webhook_secret'] ?? (Cfg::get('webhook_secret') ?: bin2hex(random_bytes(24)))]);
        $setup = Telegram::setup();
        return ['ok' => $setup['ok'], 'bot' => $me['result']['username'], 'setup' => $setup, 'settings' => self::settings()];
      }
      case 'GET /api/admin/weather': return Weather::range((string)($q['from'] ?? ''), (string)($q['to'] ?? ''));
      case 'GET /api/admin/reports':
        return ['reports' => Db::q("SELECT r.*, u.email, i.username AS tg_username FROM recog_reports r LEFT JOIN users u ON u.id = r.user_id
          LEFT JOIN user_identities i ON i.user_id = r.user_id AND i.type = 'telegram' ORDER BY r.id DESC LIMIT 500")->fetchAll()];
    }
    throw new HttpError(404, 'not_found');
  }

  private static function mask(string $v): string { return $v === '' ? '' : (strlen($v) > 14 ? substr($v, 0, 7) . '…' . substr($v, -4) : '••••'); }
  /** Что сейчас включено — без раскрытия секретов. */
  private static function settings(): array {
    $tg = null;
    if (Cfg::get('bot_token')) { $w = Telegram::call('getWebhookInfo', []); $r = $w['result'] ?? [];
      $tg = ['ok' => !empty($w['ok']), 'url' => $r['url'] ?? null, 'pending' => $r['pending_update_count'] ?? null, 'lastError' => $r['last_error_message'] ?? null, 'lastErrorAt' => isset($r['last_error_date']) ? gmdate('c', (int)$r['last_error_date']) : null]; }
    return [
      'anthropic' => ['key' => self::mask((string)Cfg::get('anthropic_api_key')), 'source' => Cfg::source('anthropic_api_key'), 'model' => (string)Cfg::get('anthropic_model'), 'modelSource' => Cfg::source('anthropic_model') ?? 'default'],
      'telegram' => ['token' => self::mask((string)Cfg::get('bot_token')), 'source' => Cfg::source('bot_token'), 'username' => (string)Cfg::get('bot_username'), 'webhook' => $tg,
        'webhookExpected' => Cfg::appUrl() . 'api/bot/webhook'],
      'appUrl' => Cfg::appUrl(), 'host' => parse_url(Cfg::appUrl(), PHP_URL_HOST),
    ];
  }

  /** Байты фото для админки (папка данных наружу не отдаётся). */
  public static function photoFile(string $id): array {
    if (!preg_match('/^[a-f0-9]{24}$/', $id)) throw new HttpError(404, 'not_found');
    $p = Db::one('SELECT * FROM photos WHERE id = ?', [$id]);
    if (!$p || !is_file(Recognize::path($p))) throw new HttpError(404, 'not_found');
    return ['path' => Recognize::path($p), 'mime' => $p['mime']];
  }

  /** Удалить фото старше photo_keep_days (зовёт cron.php). */
  public static function cleanup(): int {
    $before = gmdate('c', time() - 86400 * max(1, (int)Cfg::get('photo_keep_days', 90))); $n = 0;
    // фото записей истории (kept = 1) живут, пока человек не удалил запись
    foreach (Db::q('SELECT * FROM photos WHERE created_at < ? AND kept = 0', [$before])->fetchAll() as $p) { @unlink(Recognize::path($p)); $n++; }
    Db::q('DELETE FROM photos WHERE created_at < ? AND kept = 0', [$before]);
    Db::q('DELETE FROM rate_limits WHERE window_start < ?', [time() - 86400 * 2]);
    Db::q('DELETE FROM sessions WHERE expires_at < ?', [time()]);
    return $n;
  }
}

/** Средняя суточная температура в Харькове (Open-Meteo: архив + последние дни из прогноза), кэш в SITE_DATA/cache. */
final class Weather {
  const LAT = 49.99, LON = 36.23;
  public static $fetch = null;   // в тестах подменяется: fn(string $url): ?array
  private static function get(string $url): ?array {
    if (self::$fetch) return (self::$fetch)($url);
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 12, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_USERAGENT => 'teplo_test']);
    $r = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
    if ($code !== 200) return null;
    $j = json_decode((string)$r, true); return is_array($j) ? $j : null;
  }
  private static function merge(?array $j, array &$out): void {
    $d = $j['daily'] ?? null; if (!$d) return;
    foreach ((array)($d['time'] ?? []) as $i => $day) { $t = $d['temperature_2m_mean'][$i] ?? null; if (is_numeric($t) && !isset($out[$day])) $out[$day] = round((float)$t, 1); }
  }
  public static function range(string $from, string $to): array {
    $re = '/^\d{4}-\d{2}-\d{2}$/';
    if (!preg_match($re, $from) || !preg_match($re, $to) || $from > $to) throw new HttpError(422, 'bad_range');
    $today = gmdate('Y-m-d'); if ($to > $today) $to = $today;
    if ($from < '2015-01-01') $from = '2015-01-01';
    if ($from < gmdate('Y-m-d', strtotime($to . ' -6 years'))) $from = gmdate('Y-m-d', strtotime($to . ' -6 years'));
    $dir = Cfg::data() . '/cache'; @mkdir($dir, 0700, true);
    $f = $dir . '/weather_' . $from . '_' . $to . '.json';
    // старые периоды не меняются — кэш навсегда; если захватывает последние 10 дней — на 6 часов
    $fresh = $to < gmdate('Y-m-d', time() - 10 * 86400) ? PHP_INT_MAX : 6 * 3600;
    if (is_file($f) && time() - filemtime($f) < $fresh) { $c = json_decode((string)file_get_contents($f), true); if (is_array($c)) return ['days' => $c, 'cached' => true]; }
    $out = []; $q = '&daily=temperature_2m_mean&timezone=Europe%2FKyiv';
    self::merge(self::get('https://archive-api.open-meteo.com/v1/archive?latitude=' . self::LAT . '&longitude=' . self::LON . '&start_date=' . $from . '&end_date=' . $to . $q), $out);
    if ($to >= gmdate('Y-m-d', time() - 92 * 86400)) self::merge(self::get('https://api.open-meteo.com/v1/forecast?latitude=' . self::LAT . '&longitude=' . self::LON . '&past_days=92&forecast_days=1' . $q), $out);
    $out = array_filter($out, fn($k) => $k >= $from && $k <= $to, ARRAY_FILTER_USE_KEY); ksort($out);
    if (!$out) throw new HttpError(502, 'weather_unavailable', ['human' => 'Сервис погоды не ответил.']);
    @file_put_contents($f, json_encode($out));
    return ['days' => $out, 'cached' => false];
  }
}
