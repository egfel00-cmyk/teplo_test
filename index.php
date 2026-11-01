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

// локальный php -S: настоящие файлы (картинки) отдаёт сам; на бою их отдаёт Caddy
if (PHP_SAPI === 'cli-server' && $path !== '/' && preg_match('~^/web/[\w.-]+\.(png|jpg|svg)$~', $path) && is_file(__DIR__ . $path)) {
  header('Content-Type: ' . (str_ends_with($path, '.svg') ? 'image/svg+xml' : 'image/' . (str_ends_with($path, '.png') ? 'png' : 'jpeg'))); readfile(__DIR__ . $path); exit;
}
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

if (str_starts_with($path, '/api/')) {
  require __DIR__ . '/app/core.php';
  require __DIR__ . '/app/telegram.php';
  require __DIR__ . '/app/recognize.php';
  require __DIR__ . '/app/admin.php';
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
  if ($res->file && $res->status === 200) {   // фото для аналитики: папка данных наружу не отдаётся, только так
    header('Content-Type: ' . $res->file['mime']); header('Cache-Control: private, max-age=86400'); header('Content-Length: ' . filesize($res->file['path']));
    readfile($res->file['path']); exit;
  }
  if ($res->status === 429 && isset($res->body['retryAfter'])) header('Retry-After: ' . (int)$res->body['retryAfter']);
  foreach ($res->cookies as [$n, $v, $o]) setcookie($n, $v, $o);
  echo json_encode($res->body, JSON_UNESCAPED_UNICODE);
  exit;
}

if ($path === '/admin' || $path === '/admin/') {   // аналитика владельца; данные отдаёт /api/admin/* только админам
  header('Content-Type: text/html; charset=utf-8');
  header('Cache-Control: no-cache');
  header('X-Robots-Tag: noindex');
  header("Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  echo str_replace("'__TEPLO_API__'", json_encode($base . '/api'), (string)file_get_contents(__DIR__ . '/web/admin.html'));
  exit;
}

if ($path === '/' || $path === '/index.php') {
  $html = (string)file_get_contents(__DIR__ . '/web/dist/site.html');
  $html = str_replace("'__TEPLO_API__'", json_encode($base . '/api'), $html);
  // превью ссылки в мессенджерах: абсолютные адреса строим из запроса (домен не зашиваем)
  $host = preg_replace('/[^A-Za-z0-9.:-]/', '', (string)($_SERVER['HTTP_HOST'] ?? 'localhost'));
  $scheme = preg_match('/^(localhost|127\.0\.0\.1)(:\d+)?$/', $host) ? 'http' : 'https';
  $site = $scheme . '://' . $host . $base . '/';
  $ru = str_starts_with(strtolower((string)($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '')), 'ru');
  $og = $ru
    ? ['Теплосервис — показания тепла без отказов ХТМ', 'Подскажем, что нажимать на счётчике, проверим цифры как робот ХТМ и подготовим всё для кабинета. Харьков, бесплатно.', 'ru', 'ru_UA']
    : ['Теплосервіс — показання тепла без відмов ХТМ', 'Підкажемо, що натискати на лічильнику, перевіримо цифри як робот ХТМ і підготуємо все для кабінету. Харків, безкоштовно.', 'uk', 'uk_UA'];
  $e = fn($s) => htmlspecialchars($s, ENT_QUOTES);
  $meta = '<meta name="description" content="' . $e($og[1]) . '">' .
    '<meta property="og:type" content="website"><meta property="og:site_name" content="Теплосервіс"><meta property="og:url" content="' . $e($site) . '">' .
    '<meta property="og:title" content="' . $e($og[0]) . '"><meta property="og:description" content="' . $e($og[1]) . '"><meta property="og:locale" content="' . $og[3] . '">' .
    '<meta property="og:image" content="' . $e($site . 'web/og-' . $og[2] . '.png') . '"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="' . $e($og[0]) . '">' .
    '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="' . $e($site . 'web/og-' . $og[2] . '.png') . '">';
  $html = preg_replace('~</title>~', '</title>' . $meta, $html, 1);
  header('Content-Type: text/html; charset=utf-8');
  header('Cache-Control: no-cache');
  header("Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://telegram.org; frame-src https://oauth.telegram.org; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://t.me https://telegram.org; connect-src 'self'; base-uri 'none'; form-action 'self'");
  echo $html;
  exit;
}

http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
echo 'Not found';
