<?php
declare(strict_types=1);
// Журнал действий — чтобы видеть, что люди делали в приложении, где запутались и что сломалось (не для слежки).
// Браузер копит события и раз в несколько секунд (и при уходе со страницы) шлёт POST /api/events {vid, sid, ev: [{t, n, s, p}]}:
//   vid — тот же случайный id браузера, что у визитов (localStorage), sid — сеанс (новый после 30 мин бездействия),
//   n — событие (screen, tap, toast, api_error, js_error, saved, ocr…), s — экран, p — до 8 коротких полей (коды, не тексты людей).
// Вошёл — к событию пишется user_id. Храним 60 дней (Journal::cleanup, cron раз в час). IP и User-Agent не храним.
// «Свои» и тестовые не портят статистику: браузер, где входил админ, метится «me» сам; Headless/e2e — «test»; в /admin можно
// пометить браузер вручную («это я» / «тест» / снять). /admin → «Журнал»: сеансы людей (свои и тест скрыты), лента событий сеанса.
if (!defined('TEPLO')) { http_response_code(404); exit; }

final class Journal {
  const KEEP_DAYS = 60;
  const TAGS = ['me', 'test'];

  private static function vid($v): string { return substr(preg_replace('/[^A-Za-z0-9]/', '', (string)$v), 0, 24); }
  /** Экран: «#tgWebAppData=…» (старые клиенты слали данные входа Telegram как экран) — это главная. */
  private static function screen(string $s): ?string { if (str_starts_with($s, 'tgWebApp')) return 'home'; return substr(preg_replace('/[^A-Za-z0-9_.:#-]/', '', $s), 0, 40) ?: null; }
  private static function clean($v, int $len): string { return mb_substr(preg_replace('/[\x00-\x1F\x7F]+/u', ' ', (string)$v), 0, $len); }

  /** POST /api/events — пачка событий браузера. → ['ok' => true, 'n' => сколько записали] */
  public static function push(?array $user, array $in, Req $r, string $ip): array {
    RateLimit::hit('events_ip', $ip);
    $vid = self::vid($in['vid'] ?? ''); $sid = substr(preg_replace('/[^A-Za-z0-9]/', '', (string)($in['sid'] ?? '')), 0, 16);
    if (strlen($vid) < 8 || strlen($sid) < 6) throw new HttpError(400, 'bad_vid');
    $ev = array_slice(array_values(array_filter((array)($in['ev'] ?? []), 'is_array')), 0, 40);
    $uid = $user ? (int)$user['id'] : null;
    // свой браузер и тестовые — метим сами (вручную в /admin можно поправить)
    if ($user && Admin::is($user)) self::tag($vid, 'me', false);
    elseif (preg_match('/HeadlessChrome|Playwright|PhantomJS|puppeteer/i', $r->header('User-Agent'))) self::tag($vid, 'test', false);
    $now = time(); $cnow = (int)($in['now'] ?? 0); $n = 0;
    foreach ($ev as $e) {
      $name = (string)($e['n'] ?? ''); if (!preg_match('/^[a-z][a-z0-9_.:-]{1,39}$/', $name)) continue;
      // время — серверное, но с тем же отступом, что у браузера (порядок событий в пачке сохраняется), не дальше 10 минут назад
      $ago = $cnow > 0 && isset($e['t']) ? max(0, min(600, (int)round(($cnow - (int)$e['t']) / 1000))) : 0;
      $at = gmdate('Y-m-d\TH:i:s', $now - $ago) . '+00:00';
      $props = [];
      foreach (array_slice((array)($e['p'] ?? []), 0, 8, true) as $k => $v) {
        $k = substr(preg_replace('/[^A-Za-z0-9_]/', '', (string)$k), 0, 20); if ($k === '' || is_array($v) || is_object($v)) continue;
        $props[$k] = is_bool($v) ? (int)$v : (is_int($v) || is_float($v) ? $v : self::clean($v, 120));
      }
      $pj = $props ? json_encode($props, JSON_UNESCAPED_UNICODE) : null; if ($pj !== null && strlen($pj) > 900) $pj = mb_strcut($pj, 0, 900);
      Db::q('INSERT INTO events (at, day, vid, sid, user_id, name, screen, props) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [$at, Visits::day($now - $ago), $vid, $sid, $uid, $name, self::screen((string)($e['s'] ?? '')), $pj]);
      $n++;
    }
    return ['ok' => true, 'n' => $n];
  }

  /** Пометить браузер: me (это я) / test / '' (снять). $force = false — не перетирать ручную пометку. */
  public static function tag(string $vid, string $tag, bool $force = true): void {
    $vid = self::vid($vid); if (strlen($vid) < 8) throw new HttpError(400, 'bad_vid');
    if ($tag === '') { Db::q('DELETE FROM vid_tags WHERE vid = ?', [$vid]); return; }
    if (!in_array($tag, self::TAGS, true)) throw new HttpError(400, 'bad_tag');
    $old = Db::one('SELECT tag, manual FROM vid_tags WHERE vid = ?', [$vid]);
    if ($old && !$force && ((int)$old['manual'] || $old['tag'] === $tag)) return;
    if ($old) Db::q('UPDATE vid_tags SET tag = ?, manual = ?, at = ? WHERE vid = ?', [$tag, $force ? 1 : 0, Http::iso(), $vid]);
    else try { Db::q('INSERT INTO vid_tags (vid, tag, manual, at) VALUES (?, ?, ?, ?)', [$vid, $tag, $force ? 1 : 0, Http::iso()]); }
    catch (PDOException $e) { if ($force) Db::q('UPDATE vid_tags SET tag = ?, manual = 1, at = ? WHERE vid = ?', [$tag, Http::iso(), $vid]); }   // соседний запрос успел пометить
  }
  /** Свои и тестовые браузеры: [vid => 'me'|'test'] — помеченные + те, где входил админ (по визитам и журналу). */
  public static function internal(): array {
    $out = [];
    foreach (Db::q('SELECT vid, tag FROM vid_tags')->fetchAll() as $x) $out[(string)$x['vid']] = (string)$x['tag'];
    $admins = self::adminIds();
    if ($admins) {
      $in = implode(',', array_map('intval', $admins));
      foreach (Db::q("SELECT DISTINCT vid FROM visits WHERE user_id IN ($in)")->fetchAll() as $x) $out[(string)$x['vid']] = $out[(string)$x['vid']] ?? 'me';
      foreach (Db::q("SELECT DISTINCT vid FROM events WHERE user_id IN ($in)")->fetchAll() as $x) $out[(string)$x['vid']] = $out[(string)$x['vid']] ?? 'me';
    }
    return $out;
  }
  public static function adminIds(): array {
    $ids = [];
    foreach (Db::q('SELECT u.*, (SELECT external_id FROM user_identities i WHERE i.user_id = u.id AND i.type = \'telegram\' LIMIT 1) AS tg_id, (SELECT username FROM user_identities i WHERE i.user_id = u.id AND i.type = \'telegram\' LIMIT 1) AS tg_username FROM users u')->fetchAll() as $u)
      if (Admin::is($u)) $ids[] = (int)$u['id'];
    return $ids;
  }
  /** SQL-кусок «без своих и тестовых» для таблиц с колонкой vid (vid — только буквы/цифры, вставляем как есть). */
  public static function exclSql(string $col = 'vid'): string {
    $v = array_keys(self::internal()); if (!$v) return '';
    return " AND $col NOT IN ('" . implode("','", array_map([self::class, 'vid'], $v)) . "')";
  }

  /** Короткое имя браузера для админки: «Гость 7KQ2». */
  public static function label(string $vid): string { return 'Гость ' . strtoupper(substr(base_convert(substr(md5($vid), 0, 8), 16, 36), 0, 4)); }

  /** GET /api/admin/journal?days=7&all=0 — сеансы (новые сверху) и итог по ключевым шагам у людей (без своих и тестовых). */
  public static function sessions(int $days, bool $all): array {
    $days = max(1, min(60, $days)); $from = Visits::day(time() - ($days - 1) * 86400); $int = self::internal();
    $rows = Db::q('SELECT vid, sid, MIN(at) AS a0, MAX(at) AS a1, COUNT(*) AS n, MAX(user_id) AS uid,
        SUM(CASE WHEN name IN (\'js_error\', \'api_error\') THEN 1 ELSE 0 END) AS errs, SUM(CASE WHEN name = \'toast\' THEN 1 ELSE 0 END) AS toasts,
        SUM(CASE WHEN name = \'screen\' THEN 1 ELSE 0 END) AS screens, SUM(CASE WHEN name = \'saved\' THEN 1 ELSE 0 END) AS saves
      FROM events WHERE day >= ? GROUP BY vid, sid ORDER BY a1 DESC LIMIT 400', [$from])->fetchAll();
    $users = []; $dev = [];
    foreach ($rows as $x) if ($x['uid']) $users[(int)$x['uid']] = true;
    if ($users) foreach (Db::q('SELECT u.id, u.email, (SELECT username FROM user_identities i WHERE i.user_id = u.id AND i.type = \'telegram\' LIMIT 1) AS tg FROM users u WHERE u.id IN (' . implode(',', array_keys($users)) . ')')->fetchAll() as $u)
      $users[(int)$u['id']] = ['email' => $u['email'], 'tg' => $u['tg']];
    foreach (Db::q('SELECT vid, device, os, tg FROM visits WHERE day >= ? ORDER BY day', [$from])->fetchAll() as $v) $dev[(string)$v['vid']] = ['device' => $v['device'], 'os' => $v['os'], 'tgapp' => (int)$v['tg']];
    $out = []; $hidden = 0;
    foreach ($rows as $x) {
      $tag = $int[(string)$x['vid']] ?? null; if ($tag && !$all) { $hidden++; continue; }
      $u = $x['uid'] ? ($users[(int)$x['uid']] ?? null) : null;
      // путь по экранам: первые экраны сеанса (подряд одинаковые — один раз)
      $path = []; foreach (Db::q('SELECT screen FROM events WHERE vid = ? AND sid = ? AND name = \'screen\' ORDER BY id LIMIT 40', [$x['vid'], $x['sid']])->fetchAll() as $s) if (end($path) !== $s['screen']) $path[] = $s['screen'];
      $out[] = ['vid' => $x['vid'], 'sid' => $x['sid'], 'label' => self::label((string)$x['vid']), 'tag' => $tag, 'from' => $x['a0'], 'to' => $x['a1'], 'n' => (int)$x['n'],
        'errs' => (int)$x['errs'], 'toasts' => (int)$x['toasts'], 'saves' => (int)$x['saves'], 'user' => $u ? ['id' => (int)$x['uid']] + $u : null, 'dev' => $dev[(string)$x['vid']] ?? null, 'path' => array_slice($path, 0, 12)];
    }
    // итог по шагам у людей (свои и тест не считаем): сколько браузеров дошло до шага
    $ex = self::exclSql(); $step = function (string $where) use ($from, $ex) { return (int)(Db::one("SELECT COUNT(DISTINCT vid) AS n FROM events WHERE day >= ? AND ($where)$ex", [$from])['n'] ?? 0); };
    $funnel = ['opened' => $step("name IN ('open', 'screen')"), 'tapped' => $step("name = 'tap'"), 'meter' => $step("name = 'saved' AND props LIKE '%\"m\":%'"),
      'reading' => $step("name = 'saved' AND props LIKE '%\"r\":%'"), 'photo' => $step("name LIKE 'ocr%'"), 'photoFail' => $step("name = 'ocr' AND props LIKE '%\"ok\":0%'"),
      'errors' => $step("name IN ('js_error', 'api_error')"), 'login' => (int)(Db::one("SELECT COUNT(DISTINCT vid) AS n FROM events WHERE day >= ? AND user_id IS NOT NULL$ex", [$from])['n'] ?? 0)];
    return ['days' => $days, 'sessions' => $out, 'hidden' => $hidden, 'funnel' => $funnel];
  }
  /** GET /api/admin/journal/session?vid=&sid= — лента событий сеанса. */
  public static function session(string $vid, string $sid): array {
    $vid = self::vid($vid); $sid = substr(preg_replace('/[^A-Za-z0-9]/', '', $sid), 0, 16);
    $ev = array_map(fn($e) => ['at' => $e['at'], 'n' => $e['name'], 's' => $e['screen'], 'p' => $e['props'] ? json_decode((string)$e['props'], true) : null, 'u' => $e['user_id'] ? (int)$e['user_id'] : null],
      Db::q('SELECT at, name, screen, props, user_id FROM events WHERE vid = ? AND sid = ? ORDER BY id LIMIT 1500', [$vid, $sid])->fetchAll());
    return ['vid' => $vid, 'sid' => $sid, 'label' => self::label($vid), 'tag' => self::internal()[$vid] ?? null, 'events' => $ev];
  }
  public static function cleanup(?int $now = null): int {
    $d = Visits::day(($now ?? time()) - self::KEEP_DAYS * 86400);
    return Db::q('DELETE FROM events WHERE day < ?', [$d])->rowCount();
  }
}
