<?php
// Теплосервис — фронт-контроллер. Любой путь, которого нет файлом, приходит сюда.
//   <SITE_BASE>/        → приложение (web/dist/site.html, адрес API подставляется из SITE_BASE)
//   <SITE_BASE>/api/... → JSON API (app/api.php)
// Локально: SITE_BASE= SITE_DATA=/tmp/teplo_data php -S 127.0.0.1:8000 index.php
declare(strict_types=1);
define('TEPLO', 1);

$base = rtrim((string)getenv('SITE_BASE'), '/');
$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if ($base !== '' && $uri === $base) { header('Location: ' . $base . '/' . (isset($_SERVER['QUERY_STRING']) && $_SERVER['QUERY_STRING'] !== '' ? '?' . $_SERVER['QUERY_STRING'] : ''), true, 301); exit; }
$path = ($base !== '' && str_starts_with($uri, $base . '/')) ? substr($uri, strlen($base)) : $uri;

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

if (str_starts_with($path, '/api/')) {
  require __DIR__ . '/app/core.php';
  require __DIR__ . '/app/telegram.php';
  require __DIR__ . '/app/recognize.php';
  require __DIR__ . '/app/api.php';
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  try {
    $limit = (int)Cfg::get($path === '/api/recognize/upload' ? 'max_photo_bytes' : 'max_body_bytes');
    $body = (string)file_get_contents('php://input', false, null, 0, $limit + 1);
    $res = Api::handle(new Req($_SERVER['REQUEST_METHOD'] ?? 'GET', $path, $_SERVER, $_COOKIE, $body));
  } catch (Throwable $e) {
    error_log('teplo: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    $res = new Res(500, ['error' => 'server']);
  }
  http_response_code($res->status);
  if ($res->status === 429 && isset($res->body['retryAfter'])) header('Retry-After: ' . (int)$res->body['retryAfter']);
  foreach ($res->cookies as [$n, $v, $o]) setcookie($n, $v, $o);
  echo json_encode($res->body, JSON_UNESCAPED_UNICODE);
  exit;
}

if ($path === '/' || $path === '/index.php') {
  $html = (string)file_get_contents(__DIR__ . '/web/dist/site.html');
  $html = str_replace("'__TEPLO_API__'", json_encode($base . '/api'), $html);
  header('Content-Type: text/html; charset=utf-8');
  header('Cache-Control: no-cache');
  header("Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://telegram.org; frame-src https://oauth.telegram.org; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://t.me https://telegram.org; connect-src 'self'; base-uri 'none'; form-action 'self'");
  echo $html;
  exit;
}

http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
echo 'Not found';
