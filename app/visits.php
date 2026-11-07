<?php
declare(strict_types=1);
// С чего работают с сайтом: телефон / планшет / компьютер, система, Telegram Mini App, установлен ли как приложение.
// Браузер при открытии сайта шлёт POST /api/visit {vid, device, os, tg, pwa, sw}: vid — случайный id браузера (localStorage),
// не человек; IP и User-Agent не храним. Одна строка на браузер в сутки (по Киеву), hits — сколько раз открывали.
// Вошёл — к строке пишется user_id (видно в карточке человека в /admin). Сводка — GET /api/admin/devices?days=30.

/** Согласие на cookie (баннер «Файли cookie» на сайте, 07.11.2026). Браузер шлёт выбор: «Прийняти все» / «Відхилити» / «Зберегти вибір»
 *  (в т.ч. позже — изменил или отозвал). Храним каждое решение — так можно подтвердить, что согласие было (GDPR ст. 7(1)); IP и UA — нет.
 *  Аналитика (журнал действий, отметки «открыли сайт» с vid) в браузере включается только после согласия — см. web/src/app.js (CC). */
final class Consent {
  const V = 1;                                   // версия категорий: сменится состав — баннер спросит заново
  const HOW = ['accept', 'reject', 'save'];
  public static function record(?array $user, array $in, string $ip): array {
    RateLimit::hit('consent_ip', $ip);
    $cid = substr(preg_replace('/[^A-Za-z0-9]/', '', (string)($in['id'] ?? '')), 0, 24);
    if (strlen($cid) < 8) throw new HttpError(400, 'bad_id');
    $how = in_array($in['how'] ?? '', self::HOW, true) ? $in['how'] : 'save';
    $v = max(1, min(999, (int)($in['v'] ?? self::V)));
    Db::q('INSERT INTO consents (cid, user_id, v, analytics, how, at) VALUES (?, ?, ?, ?, ?, ?)', [$cid, $user ? (int)$user['id'] : null, $v, empty($in['a']) ? 0 : 1, $how, Http::iso()]);
    return ['ok' => true];
  }
  /** Для /admin: последнее решение каждого браузера за $days дней — сколько разрешили аналитику, сколько нет, сколько меняли решение. */
  public static function summary(int $days = 30): array {
    $from = gmdate('c', time() - max(1, $days) * 86400);
    $rows = Db::q('SELECT c.analytics, c.how FROM consents c WHERE c.at >= ? AND c.id = (SELECT MAX(c2.id) FROM consents c2 WHERE c2.cid = c.cid)', [$from])->fetchAll();
    $yes = count(array_filter($rows, fn($r) => (int)$r['analytics'] === 1));
    $chg = (int)(Db::one('SELECT COUNT(*) n FROM (SELECT cid FROM consents WHERE at >= ? GROUP BY cid HAVING COUNT(*) > 1) x', [$from])['n'] ?? 0);
    return ['days' => $days, 'total' => count($rows), 'yes' => $yes, 'no' => count($rows) - $yes, 'changed' => $chg];
  }
}

final class Visits {
  const DEVICES = ['mobile', 'tablet', 'desktop'];
  const OS = ['iOS', 'Android', 'Windows', 'macOS', 'Linux', 'other'];

  /** Запасной разбор, если браузер не прислал своё (старые клиенты): по User-Agent. iPad в режиме «как Mac» отсюда не видно. */
  public static function guess(string $ua): array {
    $tablet = (bool)preg_match('/iPad|Tablet|PlayBook|Silk|Kindle/i', $ua) || (preg_match('/Android/i', $ua) && !preg_match('/Mobile/i', $ua));
    $mobile = !$tablet && (bool)preg_match('/Mobi|iPhone|iPod|Android|Windows Phone/i', $ua);
    $os = preg_match('/iPhone|iPad|iPod/i', $ua) ? 'iOS' : (preg_match('/Android/i', $ua) ? 'Android' : (preg_match('/Windows/i', $ua) ? 'Windows'
      : (preg_match('/Macintosh|Mac OS X/i', $ua) ? 'macOS' : (preg_match('/Linux|CrOS/i', $ua) ? 'Linux' : 'other'))));
    return ['device' => $tablet ? 'tablet' : ($mobile ? 'mobile' : 'desktop'), 'os' => $os];
  }

  public static function day(?int $t = null): string { return (new DateTime('@' . ($t ?? time())))->setTimezone(new DateTimeZone('Europe/Kyiv'))->format('Y-m-d'); }

  public static function hit(?array $user, array $in, Req $r, string $ip): array {
    RateLimit::hit('visit_ip', $ip);
    $vid = substr(preg_replace('/[^A-Za-z0-9]/', '', (string)($in['vid'] ?? '')), 0, 24);
    if (strlen($vid) < 8) throw new HttpError(400, 'bad_vid');
    $g = self::guess($r->header('User-Agent'));
    $dev = in_array($in['device'] ?? '', self::DEVICES, true) ? $in['device'] : $g['device'];
    $os = in_array($in['os'] ?? '', self::OS, true) ? $in['os'] : $g['os'];
    $tg = !empty($in['tg']) ? 1 : 0; $pwa = !empty($in['pwa']) ? 1 : 0;
    $sw = (int)($in['sw'] ?? 0); $sw = $sw > 0 && $sw < 10000 ? $sw : null;
    $day = self::day(); $now = Http::iso(); $uid = $user ? (int)$user['id'] : null;
    // что успел сделать (числа из состояния браузера, без данных): этап, счётчиков, показаний; повторный пинг (act) — не новое открытие
    $stage = max(0, min(3, (int)($in['stage'] ?? 0))); $meters = max(0, min(99, (int)($in['meters'] ?? 0))); $recs = max(0, min(9999, (int)($in['recs'] ?? 0)));
    $hit = empty($in['act']) ? 1 : 0;
    $row = Db::one('SELECT stage, meters, recs FROM visits WHERE day = ? AND vid = ?', [$day, $vid]);
    $upd = function (?array $old) use ($now, $uid, $dev, $os, $tg, $pwa, $sw, $day, $vid, $stage, $meters, $recs, $hit) {
      Db::q('UPDATE visits SET hits = hits + ?, last_at = ?, user_id = COALESCE(?, user_id), device = ?, os = ?, tg = ?, pwa = ?, sw = COALESCE(?, sw), stage = ?, meters = ?, recs = ? WHERE day = ? AND vid = ?',
        [$hit, $now, $uid, $dev, $os, $tg, $pwa, $sw, max($stage, (int)($old['stage'] ?? 0)), max($meters, (int)($old['meters'] ?? 0)), max($recs, (int)($old['recs'] ?? 0)), $day, $vid]);
    };
    if ($row) $upd($row);
    else {
      try { Db::q('INSERT INTO visits (day, vid, user_id, device, os, tg, pwa, sw, hits, first_at, last_at, stage, meters, recs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)', [$day, $vid, $uid, $dev, $os, $tg, $pwa, $sw, $now, $now, $stage, $meters, $recs]); }
      catch (PDOException $e) { $upd(Db::one('SELECT stage, meters, recs FROM visits WHERE day = ? AND vid = ?', [$day, $vid])); }   // два запроса одновременно — второй дописывает
    }
    return ['ok' => true];
  }

  /** Сводка для /admin: браузеры (vid), вошедшие люди (user_id), открытия (hits) — по устройствам, системам, Telegram, ширине экрана, дням. */
  public static function summary(int $days, bool $all = false): array {
    $days = max(1, min(365, $days)); $from = self::day(time() - ($days - 1) * 86400);
    // свои (админ) и тестовые браузеры не считаем — Journal::internal(); ?all=1 — все
    $ex = !$all && class_exists('Journal') ? Journal::exclSql() : '';
    $grp = function (string $col, ?array $names = null) use ($from, $ex) {   // ключи — строки (иначе 0/1 уйдут в JSON списком)
      $out = [];
      foreach (Db::q("SELECT $col AS k, COUNT(DISTINCT vid) AS v, COUNT(DISTINCT user_id) AS u, SUM(hits) AS h FROM visits WHERE day >= ?$ex GROUP BY $col", [$from])->fetchAll() as $x)
        $out[$names ? $names[(int)$x['k']] : (string)$x['k']] = ['v' => (int)$x['v'], 'u' => (int)$x['u'], 'h' => (int)$x['h']];
      return $out;
    };
    $tot = Db::one("SELECT COUNT(DISTINCT vid) AS v, COUNT(DISTINCT user_id) AS u, SUM(hits) AS h FROM visits WHERE day >= ?$ex", [$from]) ?: [];
    $daily = [];
    foreach (Db::q("SELECT day, device, COUNT(DISTINCT vid) AS v FROM visits WHERE day >= ?$ex GROUP BY day, device ORDER BY day DESC", [$from])->fetchAll() as $x) $daily[$x['day']][$x['device']] = (int)$x['v'];
    $w = ['до 360' => 0, '360–430' => 0, '431–767' => 0, '768–1023' => 0, '1024–1439' => 0, '1440+' => 0];
    foreach (Db::q("SELECT vid, MAX(sw) AS sw FROM visits WHERE day >= ? AND sw IS NOT NULL$ex GROUP BY vid", [$from])->fetchAll() as $x) {
      $s = (int)$x['sw']; $w[$s < 360 ? 'до 360' : ($s <= 430 ? '360–430' : ($s <= 767 ? '431–767' : ($s <= 1023 ? '768–1023' : ($s <= 1439 ? '1024–1439' : '1440+'))))]++;
    }
    // отклик по дням — все браузеры, и без входа: открыли, впервые, клацали по экранам, добавили счётчик, внесли показания, вошли
    $first = [];
    foreach (Db::q('SELECT vid, MIN(day) AS d FROM visits GROUP BY vid')->fetchAll() as $x) $first[$x['vid']] = $x['d'];
    $act = []; $sum = ['v' => 0, 'new' => 0, 's1' => 0, 's2' => 0, 's3' => 0, 'anon3' => 0, 'u' => 0]; $seen = [];
    foreach (Db::q("SELECT day, vid, user_id, stage FROM visits WHERE day >= ?$ex ORDER BY day DESC", [$from])->fetchAll() as $x) {
      $d = $x['day']; $a = $act[$d] ?? ['v' => 0, 'new' => 0, 's1' => 0, 's2' => 0, 's3' => 0, 'anon3' => 0, 'u' => 0]; $st = (int)$x['stage'];
      $a['v']++; if (($first[$x['vid']] ?? '') === $d) $a['new']++; if ($st >= 1) $a['s1']++; if ($st >= 2) $a['s2']++; if ($st >= 3) { $a['s3']++; if (!$x['user_id']) $a['anon3']++; } if ($x['user_id']) $a['u']++;
      $act[$d] = $a;
      // за период — по браузеру его лучший этап
      $o = $seen[$x['vid']] ?? ['st' => 0, 'u' => false, 'new' => false]; $o['st'] = max($o['st'], $st); $o['u'] = $o['u'] || (bool)$x['user_id']; $o['new'] = $o['new'] || ($first[$x['vid']] ?? '') >= $from; $seen[$x['vid']] = $o;
    }
    foreach ($seen as $o) { $sum['v']++; if ($o['new']) $sum['new']++; if ($o['st'] >= 1) $sum['s1']++; if ($o['st'] >= 2) $sum['s2']++; if ($o['st'] >= 3) { $sum['s3']++; if (!$o['u']) $sum['anon3']++; } if ($o['u']) $sum['u']++; }
    $since = Db::one('SELECT MIN(day) AS d FROM visits');
    return ['days' => $days, 'from' => $from, 'since' => $since['d'] ?? null,
      'total' => ['v' => (int)($tot['v'] ?? 0), 'u' => (int)($tot['u'] ?? 0), 'h' => (int)($tot['h'] ?? 0)],
      'device' => $grp('device'), 'os' => $grp('os'), 'tg' => $grp('tg', ['web', 'tg']), 'pwa' => $grp('pwa', ['web', 'pwa']), 'width' => $w, 'daily' => $daily, 'act' => $act, 'actSum' => $sum];
  }

  /** Устройства человека (для карточки в /admin). */
  public static function ofUser(int $id): array {
    return Db::q('SELECT device, os, tg, pwa, MAX(sw) AS sw, SUM(hits) AS hits, MIN(day) AS first_day, MAX(last_at) AS last_at FROM visits WHERE user_id = ? GROUP BY device, os, tg, pwa ORDER BY last_at DESC', [$id])->fetchAll();
  }
}
