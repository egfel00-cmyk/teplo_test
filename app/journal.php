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
      // чим скінчилось (120-а): остання подія «пішов із сайту» — лишилось на пристрої чи в акаунті, Telegram
      $lv = Db::one("SELECT props, user_id FROM events WHERE vid = ? AND sid = ? AND name = 'leave' ORDER BY id DESC LIMIT 1", [$x['vid'], $x['sid']]);
      $end = $lv ? (json_decode((string)$lv['props'], true) ?: []) : null;
      $out[] = ['vid' => $x['vid'], 'sid' => $x['sid'], 'label' => self::label((string)$x['vid']), 'tag' => $tag, 'from' => $x['a0'], 'to' => $x['a1'], 'n' => (int)$x['n'], 'end' => $end,
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
    // 127-а: вошёл в этом сеансе — в заголовке email (или @telegram), а не «Гость XXXX»
    $uid = 0; foreach ($ev as $e) if ($e['u']) $uid = $e['u'];
    $u = $uid ? Db::one('SELECT u.id, u.email, (SELECT username FROM user_identities i WHERE i.user_id = u.id AND i.type = \'telegram\' LIMIT 1) AS tg FROM users u WHERE u.id = ?', [$uid]) : null;
    return ['vid' => $vid, 'sid' => $sid, 'label' => self::label($vid), 'tag' => self::internal()[$vid] ?? null, 'user' => $u ? ['id' => (int)$u['id'], 'email' => $u['email'], 'tg' => $u['tg']] : null, 'events' => $ev];
  }
  /** /api/health → errs: ошибки у людей за $days дней одной сводкой — без людей (разобрать без /admin, когда браузер владельца недоступен).
   *  JS-ошибки и ошибки API — по тексту/месту, сколько раз и у скольких браузеров, на каких экранах; тосты — только те, что видели ≥ 3 браузера
   *  (системные сообщения, не личные); устройства браузеров с ошибками. Длинные числа замаскированы. Свои и тестовые не считаем. */
  public static function errSummary(int $days = 3): array {
    $from = Visits::day(time() - (max(1, $days) - 1) * 86400); $ex = self::exclSql();
    $mask = fn($v) => preg_replace('/\d{5,}/', '#', (string)$v);
    $pv = function ($props) { $p = json_decode((string)$props, true); return is_array($p) ? $p : []; };
    $grp = []; $scr = []; $errVids = [];
    foreach (Db::q("SELECT vid, name, screen, props, at FROM events WHERE day >= ? AND name IN ('js_error', 'api_error')$ex ORDER BY id", [$from])->fetchAll() as $e) {
      $p = $pv($e['props']); $errVids[(string)$e['vid']] = true;
      $k = $e['name'] === 'js_error' ? 'js|' . $mask($p['m'] ?? '') . '|' . ($p['at'] ?? '') : 'api|' . ($p['p'] ?? '') . '|' . ($p['c'] ?? '') . '|' . ($p['e'] ?? '');
      $g = &$grp[$k]; $g = $g ?? ['n' => 0, 'vids' => [], 'last' => '', 'scr' => []];
      $g['n']++; $g['vids'][(string)$e['vid']] = true; $g['last'] = (string)$e['at']; $sc = (string)($e['screen'] ?? ''); $g['scr'][$sc] = ($g['scr'][$sc] ?? 0) + 1; unset($g);
    }
    uasort($grp, fn($a, $b) => count($b['vids']) <=> count($a['vids']) ?: $b['n'] <=> $a['n']);
    $js = []; $api = [];
    foreach ($grp as $k => $g) {
      arsort($g['scr']); $row = ['n' => $g['n'], 'vids' => count($g['vids']), 'last' => $g['last'], 'scr' => array_slice(array_keys($g['scr']), 0, 3)];
      $f = explode('|', $k);
      if ($f[0] === 'js' && count($js) < 15) $js[] = ['m' => $f[1], 'at' => $f[2]] + $row;
      if ($f[0] === 'api' && count($api) < 15) $api[] = ['p' => $f[1], 'c' => (int)$f[2], 'e' => $f[3]] + $row;
    }
    $toasts = [];
    foreach (Db::q("SELECT props, COUNT(*) AS n, COUNT(DISTINCT vid) AS v FROM events WHERE day >= ? AND name = 'toast'$ex GROUP BY props HAVING COUNT(DISTINCT vid) >= 3 ORDER BY v DESC LIMIT 15", [$from])->fetchAll() as $t)
      $toasts[] = ['m' => $mask($pv($t['props'])['m'] ?? ''), 'n' => (int)$t['n'], 'vids' => (int)$t['v']];
    $int = self::internal(); $dev = [];
    if ($errVids) foreach (Db::q('SELECT vid, device, os, tg FROM visits WHERE day >= ?', [$from])->fetchAll() as $v) if (isset($errVids[(string)$v['vid']]) && !isset($int[(string)$v['vid']])) {
      $k = $v['device'] . ' ' . $v['os'] . ((int)$v['tg'] ? ' tg' : ''); $dev[$k][(string)$v['vid']] = true; }
    $dev = array_map('count', $dev); arsort($dev);
    $people = 0; foreach (Db::q('SELECT DISTINCT vid FROM visits WHERE day >= ?', [$from])->fetchAll() as $v) if (!isset($int[(string)$v['vid']])) $people++;
    $withEv = (int)(Db::one("SELECT COUNT(DISTINCT vid) AS n FROM events WHERE day >= ?$ex", [$from])['n'] ?? 0);
    // iOS 26: поправка нижніх вкладок після клавіатури спрацювала (nav_shift) — скільки разів, у скількох, зсув і висоти, без людей (89-а)
    // 111-а: останні 8 (не перші) і з прокруткою sy / висотою документа dh; big — зсув більший за висоту вікна (ot росте з прокруткою — лендинг на iPhone 11.11)
    $ns = ['n' => 0, 'vids' => 0, 'last' => null, 'big' => 0, 'g' => []]; $nv = [];
    foreach (Db::q("SELECT vid, props, at FROM events WHERE day >= ? AND name = 'nav_shift'$ex ORDER BY id", [$from])->fetchAll() as $e) {
      $p = $pv($e['props']); $ns['n']++; $nv[(string)$e['vid']] = 1; $ns['last'] = (string)$e['at'];
      $g = ['g' => (int)($p['g'] ?? 0), 'ih' => (int)($p['ih'] ?? 0), 'vh' => (int)($p['vh'] ?? 0), 'ot' => (int)($p['ot'] ?? 0)];
      if (isset($p['sy'])) { $g['sy'] = (int)$p['sy']; $g['dh'] = (int)($p['dh'] ?? 0); }
      if ($g['ih'] > 0 && abs($g['g']) > $g['ih']) $ns['big']++;
      $ns['g'][] = $g; if (count($ns['g']) > 8) array_shift($ns['g']);
    }
    $ns['vids'] = count($nv);
    // 126-а: камера з підказками (подія «cam» при закритті) числами — щоб звіряти без /admin: скільки разів, знімки, помилки доступу, розпізнавач
    // не догрузився (eng), ліхтарик (tf); за пристроями — середній (ms) і найдовший (mx) час читання кадру, мс
    $cam = ['n' => 0, 'vids' => 0, 'shots' => 0, 'auto' => 0, 'err' => [], 'eng' => 0, 'tf' => 0, 'dev' => []]; $cv = [];
    foreach (Db::q("SELECT vid, props FROM events WHERE day >= ? AND name = 'cam'$ex ORDER BY id", [$from])->fetchAll() as $e) {
      $p = $pv($e['props']); $cam['n']++; $cam['shots'] += (int)($p['n'] ?? 0); $cam['auto'] += (int)($p['auto'] ?? 0);
      if (!empty($p['e'])) { $ek = mb_substr((string)$p['e'], 0, 20); $cam['err'][$ek] = ($cam['err'][$ek] ?? 0) + 1; }
      if (!empty($p['eng'])) $cam['eng']++; if (!empty($p['tf'])) $cam['tf']++;
      $cv[(string)$e['vid']][] = $p;
    }
    if ($cv) {
      $vd = []; foreach (Db::q('SELECT vid, device, os, tg FROM visits WHERE day >= ?', [$from])->fetchAll() as $v) $vd[(string)$v['vid']] = $v['device'] . ' ' . $v['os'] . ((int)$v['tg'] ? ' tg' : '');
      foreach ($cv as $vid => $ps) if (!isset($int[$vid])) {
        $k = $vd[$vid] ?? '?'; $d = &$cam['dev'][$k]; $d = $d ?? ['n' => 0, 'vids' => 0, 'ms' => 0, 'mx' => 0, '_s' => 0, '_c' => 0]; $d['vids']++;
        foreach ($ps as $p) { $d['n']++; if (isset($p['ms'])) { $d['_s'] += (int)$p['ms']; $d['_c']++; } $d['mx'] = max($d['mx'], (int)($p['mx'] ?? 0)); }
        unset($d);
      }
      foreach ($cam['dev'] as &$d) { $d['ms'] = $d['_c'] ? (int)round($d['_s'] / $d['_c']) : null; unset($d['_s'], $d['_c']); } unset($d);
      $cam['vids'] = count(array_diff_key($cv, $int)); arsort($cam['err']);
    }
    $cam['err'] = (object)$cam['err']; $cam['dev'] = (object)$cam['dev'];
    // 128-а: «Рахунки з monobank» — чим закінчився пошук (подія «mono», лише числа: вікон/сторінок/операцій, відсіяних держплатежів, групи «вид+рахунок»);
    // разом зі своїми (власник перевіряє сам) — у них own: 1
    $mono = ['n' => 0, 'vids' => 0, 'last' => []]; $mv = [];
    foreach (Db::q("SELECT vid, props, at FROM events WHERE day >= ? AND name = 'mono' ORDER BY id", [$from])->fetchAll() as $e) {
      $p = $pv($e['props']); $mono['n']++; $mv[(string)$e['vid']] = 1;
      $row = ['at' => (string)$e['at']] + array_map(fn($v) => is_string($v) ? mb_substr($mask($v), 0, 120) : $v, array_intersect_key($p, array_flip(['how', 'e', 'w', 'of', 'pg', 'c', 'n', 'gov', 'ut', 'g', 'r429', 's'])));
      if (isset($int[(string)$e['vid']])) $row['own'] = 1;
      $mono['last'][] = $row; if (count($mono['last']) > 8) array_shift($mono['last']);
    }
    $mono['vids'] = count($mv);
    return ['from' => $from, 'people' => $people, 'journal' => $withEv, 'withErr' => count(array_diff_key($errVids, $int)), 'js' => $js, 'api' => $api, 'toasts' => $toasts, 'dev' => (object)$dev, 'navShift' => $ns, 'cam' => $cam, 'mono' => $mono];
  }
  public static function cleanup(?int $now = null): int {
    $d = Visits::day(($now ?? time()) - self::KEEP_DAYS * 86400);
    // отметки «открыли сайт» (visits) — до 12 месяцев: так написано в политике и в баннере cookie (07.11.2026)
    Db::q('DELETE FROM visits WHERE day < ?', [Visits::day(($now ?? time()) - 365 * 86400)]);
    return Db::q('DELETE FROM events WHERE day < ?', [$d])->rowCount();
  }
}
