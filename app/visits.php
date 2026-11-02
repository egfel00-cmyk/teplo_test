<?php
declare(strict_types=1);
// С чего работают с сайтом: телефон / планшет / компьютер, система, Telegram Mini App, установлен ли как приложение.
// Браузер при открытии сайта шлёт POST /api/visit {vid, device, os, tg, pwa, sw}: vid — случайный id браузера (localStorage),
// не человек; IP и User-Agent не храним. Одна строка на браузер в сутки (по Киеву), hits — сколько раз открывали.
// Вошёл — к строке пишется user_id (видно в карточке человека в /admin). Сводка — GET /api/admin/devices?days=30.

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
    $upd = fn() => Db::q('UPDATE visits SET hits = hits + 1, last_at = ?, user_id = COALESCE(?, user_id), device = ?, os = ?, tg = ?, pwa = ?, sw = COALESCE(?, sw) WHERE day = ? AND vid = ?',
      [$now, $uid, $dev, $os, $tg, $pwa, $sw, $day, $vid]);
    if (Db::one('SELECT 1 AS x FROM visits WHERE day = ? AND vid = ?', [$day, $vid])) $upd();
    else {
      try { Db::q('INSERT INTO visits (day, vid, user_id, device, os, tg, pwa, sw, hits, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)', [$day, $vid, $uid, $dev, $os, $tg, $pwa, $sw, $now, $now]); }
      catch (PDOException $e) { $upd(); }   // два запроса одновременно — второй просто дописывает
    }
    return ['ok' => true];
  }

  /** Сводка для /admin: браузеры (vid), вошедшие люди (user_id), открытия (hits) — по устройствам, системам, Telegram, ширине экрана, дням. */
  public static function summary(int $days): array {
    $days = max(1, min(365, $days)); $from = self::day(time() - ($days - 1) * 86400);
    $grp = function (string $col, ?array $names = null) use ($from) {   // ключи — строки (иначе 0/1 уйдут в JSON списком)
      $out = [];
      foreach (Db::q("SELECT $col AS k, COUNT(DISTINCT vid) AS v, COUNT(DISTINCT user_id) AS u, SUM(hits) AS h FROM visits WHERE day >= ? GROUP BY $col", [$from])->fetchAll() as $x)
        $out[$names ? $names[(int)$x['k']] : (string)$x['k']] = ['v' => (int)$x['v'], 'u' => (int)$x['u'], 'h' => (int)$x['h']];
      return $out;
    };
    $tot = Db::one('SELECT COUNT(DISTINCT vid) AS v, COUNT(DISTINCT user_id) AS u, SUM(hits) AS h FROM visits WHERE day >= ?', [$from]) ?: [];
    $daily = [];
    foreach (Db::q('SELECT day, device, COUNT(DISTINCT vid) AS v FROM visits WHERE day >= ? GROUP BY day, device ORDER BY day DESC', [$from])->fetchAll() as $x) $daily[$x['day']][$x['device']] = (int)$x['v'];
    $w = ['до 360' => 0, '360–430' => 0, '431–767' => 0, '768–1023' => 0, '1024–1439' => 0, '1440+' => 0];
    foreach (Db::q('SELECT vid, MAX(sw) AS sw FROM visits WHERE day >= ? AND sw IS NOT NULL GROUP BY vid', [$from])->fetchAll() as $x) {
      $s = (int)$x['sw']; $w[$s < 360 ? 'до 360' : ($s <= 430 ? '360–430' : ($s <= 767 ? '431–767' : ($s <= 1023 ? '768–1023' : ($s <= 1439 ? '1024–1439' : '1440+'))))]++;
    }
    $since = Db::one('SELECT MIN(day) AS d FROM visits');
    return ['days' => $days, 'from' => $from, 'since' => $since['d'] ?? null,
      'total' => ['v' => (int)($tot['v'] ?? 0), 'u' => (int)($tot['u'] ?? 0), 'h' => (int)($tot['h'] ?? 0)],
      'device' => $grp('device'), 'os' => $grp('os'), 'tg' => $grp('tg', ['web', 'tg']), 'pwa' => $grp('pwa', ['web', 'pwa']), 'width' => $w, 'daily' => $daily];
  }

  /** Устройства человека (для карточки в /admin). */
  public static function ofUser(int $id): array {
    return Db::q('SELECT device, os, tg, pwa, MAX(sw) AS sw, SUM(hits) AS hits, MIN(day) AS first_day, MAX(last_at) AS last_at FROM visits WHERE user_id = ? GROUP BY device, os, tg, pwa ORDER BY last_at DESC', [$id])->fetchAll();
  }
}
