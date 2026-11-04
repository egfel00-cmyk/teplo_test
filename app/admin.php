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

  const KINDS = ['heat' => 0, 'hot' => 0, 'cold' => 0, 'elec' => 0, 'gas' => 0];
  /** Сводка по сохранённому состоянию пользователя (то, что он видит у себя): квартиры, счётчики по видам (без прибранных),
   *  показания по видам (без удалённых и стартовых), «для себя», самое позднее показание среди всех видов. */
  public static function stateSummary(?string $json): array {
    $s = $json ? json_decode($json, true) : null;
    $out = ['meter' => null, 'unit' => null, 'readings' => 0, 'handed' => 0, 'last' => null, 'phone' => null, 'contactEmail' => null, 'apartment' => null,
      'places' => 0, 'kinds' => self::KINDS, 'recs' => ['heat' => 0, 'water' => 0, 'elec' => 0, 'gas' => 0], 'own' => 0, 'photos' => 0, 'onboarded' => false];
    if (!is_array($s)) return $out;
    $live = fn($x) => is_array($x) && empty($x['deleted']);
    $alive = fn($m) => is_array($m) && empty($m['deleted']) && empty($m['removed']);
    $places = array_values(array_filter((array)($s['places'] ?? []), $live));
    if (!$places && !empty($s['meter'])) $places = [['meter' => $s['meter']]];   // старые данные — без квартир
    $meter = null;
    foreach ($places as $p) {
      if ($alive($p['meter'] ?? null)) { $out['kinds']['heat']++; $meter = $meter ?? $p['meter']; }
      foreach (array_merge((array)($p['water']['meters'] ?? []), (array)($p['meters'] ?? [])) as $m)
        if ($alive($m) && isset($out['kinds'][$m['kind'] ?? ''])) $out['kinds'][$m['kind']]++;
    }
    $rd = array_values(array_filter((array)($s['readings'] ?? []), $live));
    $wr = array_values(array_filter((array)($s['water'] ?? []), fn($x) => $live($x) && empty($x['base'])));
    $mr = array_values(array_filter((array)($s['mrecs'] ?? []), fn($x) => $live($x) && empty($x['base'])));
    $all = array_merge($rd, $wr, $mr);
    // последнее — самое позднее по дате показаний (после синхронизации порядок в массиве любой)
    $cand = [];
    foreach ($rd as $x) $cand[] = ['date' => (string)($x['htm']['date'] ?? substr((string)($x['createdAt'] ?? ''), 0, 10)), 'kind' => 'heat', 'status' => $x['status'] ?? null,
      'verdict' => $x['verdict'] ?? null, 'source' => $x['source'] ?? null, 'own' => !empty($x['own'])];
    foreach ($wr as $x) $cand[] = ['date' => (string)($x['date'] ?? ''), 'kind' => 'water', 'sent' => !empty($x['sent']['vk']), 'own' => !empty($x['own']), 'source' => !empty($x['photos']) ? 'photo' : null];
    foreach ($mr as $x) { $g = ($x['kind'] ?? '') === 'gas';
      $cand[] = ['date' => (string)($x['date'] ?? ''), 'kind' => $g ? 'gas' : 'elec', 'sent' => !empty($x['sent'][$g ? 'grm' : 'obl']), 'own' => !empty($x['own']), 'source' => !empty($x['photos']) ? 'photo' : null]; }
    usort($cand, fn($a, $b) => strcmp($b['date'], $a['date']));
    $first = $places[0] ?? [];
    return ['meter' => $meter['modelId'] ?? null, 'unit' => $meter['unit'] ?? null, 'readings' => count($rd),
      'handed' => count(array_filter($rd, fn($x) => empty($x['own']) && in_array($x['status'] ?? '', ['handed', 'accepted'], true))),
      'last' => $cand[0] ?? null,
      'phone' => ($s['contacts']['phone'] ?? '') ?: null, 'contactEmail' => ($s['contacts']['email'] ?? '') ?: null,
      'apartment' => ($first['address'] ?? '') ?: ($s['meter']['apartment'] ?? null),
      'places' => count($places), 'kinds' => $out['kinds'],
      'recs' => ['heat' => count($rd), 'water' => count($wr), 'elec' => count(array_filter($mr, fn($x) => ($x['kind'] ?? '') !== 'gas')), 'gas' => count(array_filter($mr, fn($x) => ($x['kind'] ?? '') === 'gas'))],
      'own' => count(array_filter($all, fn($x) => !empty($x['own']))),
      'photos' => array_sum(array_map(fn($x) => count((array)($x['photos'] ?? [])), $all)),
      'onboarded' => !empty($s['onboarded'])];
  }
  /** Что ведут все вместе: сколько людей с каждым видом счётчика, показаний по видам, с 2+ квартирами, «для себя». */
  private static function tracking(): array {
    $t = ['users' => self::KINDS, 'recs' => ['heat' => 0, 'water' => 0, 'elec' => 0, 'gas' => 0], 'multi' => 0, 'own' => 0, 'onboarded' => 0, 'withMeters' => 0, 'withData' => 0];
    foreach (Db::q('SELECT data FROM user_state')->fetchAll() as $row) {
      $sm = self::stateSummary($row['data']);
      foreach ($sm['kinds'] as $k => $n) if ($n > 0) $t['users'][$k]++;
      foreach ($sm['recs'] as $k => $n) $t['recs'][$k] += $n;
      if ($sm['places'] >= 2) $t['multi']++;
      if (array_sum($sm['kinds']) > 0) $t['withMeters']++;
      if (array_sum($sm['kinds']) > 0 || array_sum($sm['recs']) > 0) $t['withData']++;   // пустое состояние (только язык) — не «сохранил данные»
      if ($sm['onboarded']) $t['onboarded']++;
      $t['own'] += $sm['own'];
    }
    return $t;
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
        $week = gmdate('c', time() - 7 * 86400); $tr = self::tracking();
        return [
          'users' => $c('SELECT COUNT(*) n FROM users'), 'usersWeek' => $c('SELECT COUNT(*) n FROM users WHERE created_at >= ?', [$week]),
          // «входили за 7 дней»: вход (новая сессия) или открывали сайт уже вошедшими (visits) — сессия живёт долго, last_login_at редко меняется
          'activeWeek' => $c('SELECT COUNT(*) n FROM users u WHERE u.last_login_at >= ? OR EXISTS (SELECT 1 FROM visits v WHERE v.user_id = u.id AND v.day >= ?)', [$week, Visits::day(time() - 6 * 86400)]),
          'withTelegram' => $c("SELECT COUNT(DISTINCT user_id) n FROM user_identities WHERE type = 'telegram'"),
          'withData' => $tr['withData'],
          'feedback' => $c('SELECT COUNT(*) n FROM feedback'), 'feedbackNew' => $c("SELECT COUNT(*) n FROM feedback WHERE status = 'new'"),
          'photos' => $c('SELECT COUNT(*) n FROM photos'), 'photosFailed' => $c("SELECT COUNT(*) n FROM photos WHERE status = 'failed' OR problem IS NOT NULL"),
          'reports' => $c('SELECT COUNT(*) n FROM recog_reports'), 'reportsBad' => $c('SELECT COUNT(*) n FROM recog_reports WHERE ok = 0'),
          'recognition' => (bool)Cfg::get('anthropic_api_key'), 'telegram' => (bool)Cfg::get('bot_token'), 'photoKeepDays' => (int)Cfg::get('photo_keep_days', 90), 'cronAgo' => Cron::age(),
          'me' => $me['email'] ?: ('tg:' . $me['id']), 'tracking' => $tr, 'vk' => VkStatus::status(),
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
          'audit' => Db::q('SELECT action, ip, created_at FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT 50', [$id])->fetchAll(),
          'devices' => Visits::ofUser($id)];
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
      case 'GET /api/admin/devices': return Visits::summary((int)($q['days'] ?? 30));
      case 'GET /api/admin/reminders': {
        $next = Reminders::next(time());
        return ['next' => $next, 'preview' => $next ? Reminders::preview($next['kind'], $next['ym']) : [], 'log' => Reminders::log(), 'cron' => Cron::read() + ['ago' => Cron::age()],
          'telegram' => (bool)Cfg::get('bot_token')];
      }
      case 'GET /api/admin/weather': return Weather::range((string)($q['from'] ?? ''), (string)($q['to'] ?? ''));
      // история версий данных пользователя и «Восстановить эту версию»
      case 'GET /api/admin/state/history': return ['history' => StateHist::list((int)($q['id'] ?? 0))];
      case 'GET /api/admin/state/version': return ['state' => StateHist::get((int)($q['user'] ?? 0), (int)($q['id'] ?? 0))];
      case 'POST /api/admin/state/restore': return StateHist::restore((int)($in['user'] ?? 0), (int)($in['id'] ?? 0), $me);
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
    Db::q('DELETE FROM vk_replies WHERE msg_at < ?', [time() - 60 * 86400]);
    Db::q('DELETE FROM vk_events WHERE at < ?', [time() - 60 * 86400]);
    return $n;
  }
}

/** История версий данных пользователя (user_state_hist). При каждом PUT /api/state прошлая версия уходит сюда — если сохранение
 *  что-то затёрло (03.11.2026 вход затёр квартиру владельца), её можно вернуть из /admin → карточка → «История версий».
 *  Хранится сжатой (gz + base64). Чистка (cron, раз в час): за последние 48 ч — все (до 200 на человека), старше — последняя за
 *  каждый день, старше 30 дней — удаляется. */
final class StateHist {
  const KEEP_ALL_H = 48, KEEP_ALL_MAX = 200, KEEP_DAYS = 30, LIST_MAX = 300;

  public static function pack(string $json): array {
    if (function_exists('gzdeflate')) { $z = gzdeflate($json, 6); if ($z !== false) return [base64_encode($z), 'gz']; }
    return [$json, ''];
  }
  public static function raw(array $row): ?string {
    if (($row['enc'] ?? '') === 'gz') { $b = base64_decode((string)$row['data'], true); $j = $b === false ? false : @gzinflate($b); return is_string($j) ? $j : null; }
    return (string)$row['data'];
  }
  /** Положить версию в историю: json — данные, version — её номер, savedAt — когда она стала текущей. */
  public static function put(int $uid, string $json, int $version, string $savedAt, string $reason = 'put'): void {
    [$d, $e] = self::pack($json);
    Db::q('INSERT INTO user_state_hist (user_id, version, data, enc, bytes, saved_at, replaced_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [$uid, $version, $d, $e, strlen($json), $savedAt, Http::iso(), $reason]);
  }

  /** Названия квартир (как в приложении: своё имя, иначе адрес, иначе «Моя квартира» / «Квартира N»). */
  private static function labels(?array $s): array {
    $out = []; $i = 0;
    foreach ((array)($s['places'] ?? []) as $p) {
      if (!is_array($p) || !empty($p['deleted'])) continue;
      $out[] = trim((string)($p['name'] ?? '')) ?: (trim((string)($p['address'] ?? '')) ?: ($i ? 'Квартира ' . ($i + 1) : 'Моя квартира')); $i++;
    }
    return $out;
  }
  private static function item(array $r): array {
    $j = self::raw($r); $s = $j === null ? null : json_decode($j, true);
    return ['id' => (int)$r['id'], 'version' => (int)$r['version'], 'savedAt' => $r['saved_at'], 'replacedAt' => $r['replaced_at'], 'reason' => $r['reason'],
      'bytes' => (int)$r['bytes'], 'ok' => is_array($s), 'summary' => is_array($s) ? Admin::stateSummary($j) : null, 'labels' => is_array($s) ? self::labels($s) : []];
  }
  /** Версии пользователя для /admin: сначала текущая (current: true), дальше прошлые — от новых к старым, со сводкой каждой. */
  public static function list(int $uid): array {
    $out = [];
    $cur = Db::one('SELECT data, version, updated_at FROM user_state WHERE user_id = ?', [$uid]);
    if ($cur) { $s = json_decode((string)$cur['data'], true);
      $out[] = ['id' => 0, 'current' => true, 'version' => (int)$cur['version'], 'savedAt' => $cur['updated_at'], 'replacedAt' => null, 'reason' => null,
        'bytes' => strlen((string)$cur['data']), 'ok' => true, 'summary' => Admin::stateSummary((string)$cur['data']), 'labels' => self::labels(is_array($s) ? $s : null),
        'restoredAt' => is_array($s) && !empty($s['restoredAt']) ? gmdate('c', intdiv((int)$s['restoredAt'], 1000)) : null]; }
    foreach (Db::q('SELECT * FROM user_state_hist WHERE user_id = ? ORDER BY id DESC LIMIT ' . self::LIST_MAX, [$uid])->fetchAll() as $r) $out[] = self::item($r);
    return $out;
  }
  /** Данные одной версии целиком. */
  public static function get(int $uid, int $id): array {
    $r = Db::one('SELECT * FROM user_state_hist WHERE id = ? AND user_id = ?', [$id, $uid]);
    if (!$r) throw new HttpError(404, 'not_found');
    $s = json_decode((string)self::raw($r), true);
    if (!is_array($s)) throw new HttpError(422, 'broken', ['human' => 'Версия повреждена — восстановить её нельзя.']);
    return $s;
  }

  /** Восстановленная версия должна победить копии в браузерах человека (там слияние по меткам времени, sync.js): всем квартирам и
   *  записям — свежая метка; квартиры и записи, которых в этой версии не было (появились позже), — «надгробия» (deleted), чтобы
   *  устройства их тоже убрали; restoredAt — отменяет более ранний «стереть всё» (wipedAt) на устройствах. Текущая версия при этом
   *  уходит в историю — восстановление можно отменить, вернув её. */
  public static function freshen(array $old, ?array $cur, int $ms): array {
    $s = $old; $s['updatedAt'] = $ms; $s['restoredAt'] = $ms;
    $fix = function (string $k) use (&$s, $cur, $ms): void {
      $have = []; $list = [];
      foreach ((array)($s[$k] ?? []) as $x) { if (!is_array($x)) continue; $x['updatedAt'] = $ms; $list[] = $x; if (isset($x['id'])) $have[(string)$x['id']] = true; }
      foreach ((array)($cur[$k] ?? []) as $x) { if (!is_array($x) || !isset($x['id']) || isset($have[(string)$x['id']])) continue; $x['deleted'] = true; $x['updatedAt'] = $ms; $list[] = $x; }
      if ($list || isset($s[$k])) $s[$k] = $list;
    };
    foreach (['places', 'readings', 'water', 'mrecs'] as $k) $fix($k);
    if (!isset($s['readings'])) $s['readings'] = [];
    return $s;
  }

  /** «Восстановить эту версию»: данные версии id становятся текущими (новый номер версии), текущие — в историю. */
  public static function restore(int $uid, int $id, array $admin): array {
    $old = self::get($uid, $id);
    $from = (int)Db::one('SELECT version FROM user_state_hist WHERE id = ?', [$id])['version'];
    $row = Db::one('SELECT data, version, updated_at FROM user_state WHERE user_id = ?', [$uid]);
    $cur = $row ? json_decode((string)$row['data'], true) : null;
    $new = self::freshen($old, is_array($cur) ? $cur : null, (int)floor(microtime(true) * 1000));
    $json = json_encode($new, JSON_UNESCAPED_UNICODE);
    if ($row) {
      if (Db::q('UPDATE user_state SET data = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?', [$json, Http::iso(), $uid, (int)$row['version']])->rowCount() !== 1)
        throw new HttpError(409, 'conflict', ['human' => 'Человек как раз сохранял данные — обновите карточку и повторите.']);
      self::put($uid, (string)$row['data'], (int)$row['version'], (string)$row['updated_at'], 'restore');
    } else Db::q('INSERT INTO user_state (user_id, data, version, updated_at) VALUES (?, ?, 1, ?)', [$uid, $json, Http::iso()]);
    $ver = $row ? (int)$row['version'] + 1 : 1;
    // фото записей восстановленной версии снова хранятся, пока есть запись (удаление записи снимало отметку)
    $ids = [];
    foreach (['readings', 'water', 'mrecs'] as $k) foreach ((array)($old[$k] ?? []) as $x)
      if (is_array($x) && empty($x['deleted'])) foreach ((array)($x['photos'] ?? []) as $p) { $pid = is_array($p) ? (string)($p['id'] ?? '') : ''; if (preg_match('/^[a-f0-9]{24}$/', $pid)) $ids[] = $pid; }
    foreach (array_unique($ids) as $pid) Db::q('UPDATE photos SET kept = 1 WHERE id = ? AND user_id = ?', [$pid, $uid]);
    $who = $admin['email'] ?: ('#' . $admin['id']);
    Db::q('INSERT INTO audit_log (user_id, action, ip, created_at) VALUES (?, ?, ?, ?)', [$uid, mb_substr("восстановлена версия $from → $ver ($who)", 0, 60), null, Http::iso()]);
    return ['ok' => true, 'version' => $ver, 'from' => $from, 'summary' => Admin::stateSummary($json)];
  }

  /** Чистка (cron.php, раз в час). → сколько версий удалено. */
  public static function cleanup(?int $now = null): int {
    $now = $now ?? time(); $n = 0;
    $all = gmdate('c', $now - self::KEEP_ALL_H * 3600);
    $n += Db::q('DELETE FROM user_state_hist WHERE replaced_at < ?', [gmdate('c', $now - self::KEEP_DAYS * 86400)])->rowCount();
    $del = []; $seen = []; $cnt = [];
    // старше 48 ч — последняя версия каждого дня
    foreach (Db::q('SELECT id, user_id, replaced_at FROM user_state_hist WHERE replaced_at < ? ORDER BY user_id, id DESC', [$all])->fetchAll() as $r) {
      $k = $r['user_id'] . ' ' . substr((string)$r['replaced_at'], 0, 10);
      if (isset($seen[$k])) $del[] = (int)$r['id']; else $seen[$k] = true;
    }
    // за 48 ч — все, но не больше KEEP_ALL_MAX на человека
    foreach (Db::q('SELECT id, user_id FROM user_state_hist WHERE replaced_at >= ? ORDER BY user_id, id DESC', [$all])->fetchAll() as $r) {
      $u = (int)$r['user_id']; $cnt[$u] = ($cnt[$u] ?? 0) + 1; if ($cnt[$u] > self::KEEP_ALL_MAX) $del[] = (int)$r['id'];
    }
    foreach (array_chunk($del, 400) as $ch) $n += Db::q('DELETE FROM user_state_hist WHERE id IN (' . implode(',', array_fill(0, count($ch), '?')) . ')', $ch)->rowCount();
    return $n;
  }
}

/** Работают ли бот и кабинет Водоканала. Кабинет — сервер сам открывает страницу входа (cron, раз в 10 мин; итог — SITE_DATA/cache/
 *  vk_status.json). Бот — проверить напрямую нельзя (бот не может писать другому боту): признак жизни — любой пересланный нам ответ
 *  бота (vk_replies) или «Прийняв» в приложении; «не відповідає» — жалобы после последнего признака жизни (vk_events, за сутки).
 *  Бот снова ответил — тем, кто жаловался, наш бот пишет «знову працює» (один раз). */
final class VkStatus {
  const CAB_URL = 'https://billing.vodokanal.kharkov.ua/login';
  public static $fetch = null;   // в тестах: fn(string $url): ['code' => int, 'body' => string, 'err' => ?string, 'ms' => int]
  public static function file(): string { return Cfg::data() . '/cache/vk_status.json'; }
  public static function read(): array { $j = json_decode((string)@file_get_contents(self::file()), true); return is_array($j) ? $j : []; }
  private static function write(array $j): void { @mkdir(dirname(self::file()), 0700, true); @file_put_contents(self::file(), json_encode($j, JSON_UNESCAPED_UNICODE), LOCK_EX); }
  private static function get(string $url): array {
    $t0 = microtime(true); $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 12, CURLOPT_CONNECTTIMEOUT => 6, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3,
      CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; teplo-status/1.0)', CURLOPT_RANGE => '0-200000']);
    $body = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = $body === false ? curl_error($ch) : null; curl_close($ch);
    return ['code' => $code, 'body' => is_string($body) ? $body : '', 'err' => $err, 'ms' => (int)round((microtime(true) - $t0) * 1000)];
  }
  /** Проверить кабинет: страница входа открылась (200 и текст похож на кабинет) — ok, иначе down. */
  public static function probeCabinet(?int $now = null): array {
    $now = $now ?? time(); $r = self::$fetch ? (self::$fetch)(self::CAB_URL) : self::get(self::CAB_URL);
    $ok = (int)$r['code'] === 200 && preg_match('/водоканал|авториз|логін|логин|пароль|login/iu', (string)$r['body']);
    $j = self::read(); $c = (array)($j['cab'] ?? []); $state = $ok ? 'ok' : 'down';
    $c = ['state' => $state, 'at' => $now, 'code' => (int)$r['code'], 'ms' => (int)($r['ms'] ?? 0), 'err' => $r['err'] ? mb_substr((string)$r['err'], 0, 120) : null,
      'since' => ($c['state'] ?? null) === $state ? (int)($c['since'] ?? $now) : $now, 'everOk' => !empty($c['everOk']) || $ok, 'lastOk' => $ok ? $now : ($c['lastOk'] ?? null)];
    $j['cab'] = $c; $j['log'] = array_slice(array_merge((array)($j['log'] ?? []), [[$now, $state, (int)$r['code']]]), -144);
    self::write($j); return $c;
  }
  public static function bot(?int $now = null): array {
    $now = $now ?? time();
    $alive = max((int)(Db::one("SELECT MAX(msg_at) AS n FROM vk_replies WHERE src = 'vk'")['n'] ?? 0), (int)(Db::one("SELECT MAX(at) AS n FROM vk_events WHERE kind = 'ok'")['n'] ?? 0));
    $sil = Db::one("SELECT COUNT(DISTINCT user_id) AS n, MIN(at) AS a FROM vk_events WHERE kind = 'silent' AND at > ? AND at > ?", [$alive, $now - 86400]);
    if ((int)($sil['n'] ?? 0) > 0) return ['state' => 'silent', 'since' => (int)$sil['a'], 'users' => (int)$sil['n'], 'lastOk' => $alive ?: null];
    if ($alive && $now - $alive < 7 * 86400) return ['state' => 'ok', 'lastOk' => $alive];
    return ['state' => 'unknown', 'lastOk' => $alive ?: null];
  }
  /** Для приложения и /admin. Кабинет, который ни разу не открылся с нашего сервера (может не пускать заграничные адреса), — everOk: false. */
  public static function status(): array {
    $c = self::read()['cab'] ?? null;
    return ['bot' => self::bot(), 'cab' => is_array($c) ? array_intersect_key($c, array_flip(['state', 'at', 'since', 'everOk', 'lastOk', 'code'])) : null];
  }
  public static function event(int $uid, string $kind): array {
    if (!in_array($kind, ['send', 'ok', 'silent', 'err'], true)) throw new HttpError(422, 'bad_kind');
    $before = self::bot();
    Db::q('INSERT INTO vk_events (user_id, kind, at, notified) VALUES (?, ?, ?, 0)', [$uid, $kind, time()]);
    if ($kind === 'ok') self::aliveAgain($before, $uid);
    return ['ok' => true, 'status' => self::status()];
  }
  /** Бот снова отвечает (был «не відповідає») — пишем тем, кто жаловался за 3 дня (кроме того, кто сам это заметил). → сколько написали. */
  public static function aliveAgain(array $before, int $except = 0): int {
    if (($before['state'] ?? '') !== 'silent') return 0;
    $rows = Db::q("SELECT DISTINCT e.user_id, i.external_id, s.data FROM vk_events e JOIN user_identities i ON i.user_id = e.user_id AND i.type = 'telegram'
      LEFT JOIN user_state s ON s.user_id = e.user_id WHERE e.kind = 'silent' AND e.notified = 0 AND e.at > ? AND e.user_id <> ?", [time() - 3 * 86400, $except])->fetchAll();
    $n = 0;
    foreach ($rows as $r) {
      $st = json_decode((string)($r['data'] ?? ''), true); $ru = (($st['remind']['lang'] ?? '') === 'ru');
      $p = ['chat_id' => $r['external_id'], 'text' => $ru ? "Бот Водоканала снова отвечает. Откройте «Счётчики» и нажмите «Отправить в Водоканал» ещё раз." : "Бот Водоканалу знову відповідає. Відкрийте «Лічильники» й натисніть «Відправити у Водоканал» ще раз."];
      if (Cfg::appUrlKnown()) $p['reply_markup'] = ['inline_keyboard' => [[['text' => $ru ? 'Открыть «Счётчики»' : 'Відкрити «Лічильники»', 'web_app' => ['url' => Cfg::appUrl() . '?go=water-cold']]]]];
      try { Telegram::call('sendMessage', $p); $n++; } catch (Throwable $e) { /* не дошло — не страшно */ }
    }
    Db::q("UPDATE vk_events SET notified = 1 WHERE kind = 'silent' AND notified = 0");
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
