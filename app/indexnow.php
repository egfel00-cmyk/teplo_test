<?php
// IndexNow — сообщить Bing (и прочим участникам: Seznam, Naver…) о новой версии сайта без аккаунта в Bing Webmaster Tools.
// Ключ — 32 hex в SITE_DATA/uploads/settings/indexnow.key (создаётся сам); index.php отдаёт его по адресу /<ключ>.txt —
// так поисковик проверяет, что пинг от владельца сайта. cron раз в час: дата сборки (web/dist/site.html) сменилась — один
// GET https://api.indexnow.org/indexnow?url=…&key=…. Итог — SITE_DATA/cache/indexnow.json и /api/health → indexnow.
// Ответы: 200/202 — принято; 403 — ключ не нашли по адресу; 422 — адрес не того сайта; 429 — слишком часто.
declare(strict_types=1);
defined('TEPLO') || exit;

final class IndexNow {
  public const API = 'https://api.indexnow.org/indexnow';
  /** @var null|callable(string): array{code:int,err:?string} — подмена HTTP в тестах */
  public static $http = null;

  public static function keyFile(): string { return rtrim((string)getenv('SITE_DATA'), '/') . '/uploads/settings/indexnow.key'; }
  public static function file(): string { return rtrim((string)getenv('SITE_DATA'), '/') . '/cache/indexnow.json'; }
  public static function read(): array { $j = json_decode((string)@file_get_contents(self::file()), true); return is_array($j) ? $j : []; }
  private static function save(array $j): void { @mkdir(dirname(self::file()), 0700, true); @file_put_contents(self::file(), json_encode($j, JSON_UNESCAPED_UNICODE), LOCK_EX); }

  /** Ключ сайта: есть — читаем, нет и $make — создаём. Пустая строка — ключа нет (не отдаём ничего). */
  public static function key(bool $make = false): string {
    $k = trim((string)@file_get_contents(self::keyFile()));
    if (preg_match('/^[0-9a-f]{32}$/', $k)) return $k;
    if (!$make) return '';
    $k = bin2hex(random_bytes(16));
    @mkdir(dirname(self::keyFile()), 0700, true);
    return @file_put_contents(self::keyFile(), $k, LOCK_EX) === 32 ? $k : '';
  }
  /** index.php: /<32 hex>.txt — отдать ключ, если это наш. Иначе false (дальше — обычный разбор адреса). */
  public static function serve(string $path): bool {
    if (!preg_match('~^/([0-9a-f]{32})\.txt$~', $path, $m)) return false;
    $k = self::key(); if ($k === '' || !hash_equals($k, $m[1])) return false;
    if (!headers_sent()) { header('Content-Type: text/plain; charset=utf-8'); header('Cache-Control: public, max-age=86400'); } echo $k; return true;
  }
  /** Дата сборки сайта — как <lastmod> в sitemap.xml. */
  public static function build(): string { return date('Y-m-d', (int)@filemtime(dirname(__DIR__) . '/web/dist/site.html')); }

  /** cron (раз в час): новая сборка → пинг. $site — адрес сайта (Cfg::appUrl), localhost — не шлём. */
  public static function run(string $site, ?int $now = null): ?array {
    $now = $now ?? time(); $st = self::read(); $b = self::build();
    if (!preg_match('~^https://(?!localhost[:/])[^/]+/~', $site)) return null;
    $same = ($st['build'] ?? '') === $b && ($st['site'] ?? '') === $site;
    if ($same && in_array((int)($st['code'] ?? 0), [200, 202], true)) return null;
    // ошибка — повтор той же сборки не чаще раза в сутки (429/403 не долбим)
    if ($same && $now - (int)strtotime((string)($st['at'] ?? '')) < 86400) return null;
    $k = self::key(true); if ($k === '') return null;
    $url = self::API . '?url=' . rawurlencode($site) . '&key=' . $k;
    $r = self::$http ? (self::$http)($url) : self::get($url);
    $st = ['at' => gmdate('c', $now), 'build' => $b, 'site' => $site, 'code' => (int)$r['code'], 'err' => $r['err'] ?? null];
    self::save($st); return $st;
  }
  private static function get(string $url): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 6, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 2,
      CURLOPT_USERAGENT => 'Lichylnyky/1.0 (IndexNow)']);
    $b = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = $b === false ? curl_error($ch) : null; curl_close($ch);
    return ['code' => $code, 'err' => $err];
  }
  /** /api/health: без ключа и тела — когда и с каким кодом пинговали. */
  public static function summary(): array { $s = self::read(); unset($s['err']); return $s + ['key' => self::key() !== '']; }
}
