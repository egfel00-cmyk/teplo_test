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
if (PHP_SAPI === 'cli-server' && preg_match('~^/web/ocr/[\w.-]+\.(js|mjs|wasm|onnx|txt)$~', $path) && is_file(__DIR__ . $path)) {   // распознаватель в браузере
  $ext = pathinfo($path, PATHINFO_EXTENSION);
  header('Content-Type: ' . (['js' => 'text/javascript', 'mjs' => 'text/javascript', 'wasm' => 'application/wasm', 'txt' => 'text/plain; charset=utf-8'][$ext] ?? 'application/octet-stream')); readfile(__DIR__ . $path); exit;
}
if (PHP_SAPI === 'cli-server' && preg_match('~^/web/fonts/[\w.-]+\.(woff2|css|txt)$~', $path, $fm) && is_file(__DIR__ . $path)) {   // свои шрифты (IBM Plex)
  header('Content-Type: ' . ['woff2' => 'font/woff2', 'css' => 'text/css; charset=utf-8', 'txt' => 'text/plain; charset=utf-8'][$fm[1]]); readfile(__DIR__ . $path); exit;
}
if (PHP_SAPI === 'cli-server' && $path !== '/' && preg_match('~^/web/[\w.-]+\.(png|jpg|svg)$~', $path) && is_file(__DIR__ . $path)) {
  header('Content-Type: ' . (str_ends_with($path, '.svg') ? 'image/svg+xml' : 'image/' . (str_ends_with($path, '-2.jpg') ? 'png' : 'jpeg'))); readfile(__DIR__ . $path); exit;
}
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

if (str_starts_with($path, '/api/')) {
  require __DIR__ . '/app/core.php';
  require __DIR__ . '/app/telegram.php';
  require __DIR__ . '/app/reminders.php';
  require __DIR__ . '/app/recognize.php';
  require __DIR__ . '/app/admin.php';
  require __DIR__ . '/app/vkcab.php';
  require __DIR__ . '/app/cabs.php';
  require __DIR__ . '/app/htmsvc.php';
  require __DIR__ . '/app/vksvc.php';
  require __DIR__ . '/app/gpv.php';
  require __DIR__ . '/app/providers.php';
  require __DIR__ . '/app/visits.php';
  require __DIR__ . '/app/journal.php';
  require __DIR__ . '/app/docs.php';
  require __DIR__ . '/app/indexnow.php';
  require __DIR__ . '/app/relay.php';
  require __DIR__ . '/app/api.php';
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  header('X-Robots-Tag: noindex');
  try {
    $limit = Api::bodyLimit($path);   // было: только /api/recognize/upload — документы (PDF платёжки) больше 300 КБ обрезались молча
    $body = (string)file_get_contents('php://input', false, null, 0, $limit + 1);
    $res = Api::handle(new Req($_SERVER['REQUEST_METHOD'] ?? 'GET', $path, $_SERVER, $_COOKIE, $body));
  } catch (Throwable $e) {
    error_log('teplo: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    // журнал сбоев сервера для /admin (логов сервера у сессий нет): последние ~200 — SITE_DATA/tmp/errors.jsonl
    try { ErrLog::add($_SERVER['REQUEST_METHOD'] ?? 'GET', $path, $e); } catch (Throwable $e2) { /* без журнала */ }
    $res = new Res(500, ['error' => 'server']);
  }
  http_response_code($res->status);
  if ($res->file && $res->status === 200) {   // фото для аналитики: папка данных наружу не отдаётся, только так
    header('Content-Type: ' . $res->file['mime']); header('Cache-Control: private, max-age=86400'); header('Content-Length: ' . filesize($res->file['path']));
    // копия рахунку ХТМ (страница сайта, Docs src htm): без скриптов и без запросов наружу — даже если в копии что-то осталось
    if ($res->file['mime'] === 'text/html') { header('Content-Type: text/html; charset=utf-8'); header("Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"); header('X-Content-Type-Options: nosniff'); header('Referrer-Policy: no-referrer'); }
    readfile($res->file['path']); exit;
  }
  if ($res->text !== null) { header('Content-Type: text/plain; charset=utf-8'); echo $res->text; exit; }   // ретранслятор NAS читает текст строками (sh)
  if ($res->status === 429 && isset($res->body['retryAfter'])) header('Retry-After: ' . (int)$res->body['retryAfter']);
  foreach ($res->cookies as [$n, $v, $o]) setcookie($n, $v, $o);
  echo json_encode($res->body, JSON_UNESCAPED_UNICODE);
  exit;
}

if ($path === '/admin' || $path === '/admin/') {   // аналитика владельца; данные отдаёт /api/admin/* только админам
  header('Content-Type: text/html; charset=utf-8');
  header('Cache-Control: no-cache');
  header('X-Robots-Tag: noindex');
  header("Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  // шрифты — свои (web/fonts); путь от корня сайта, чтобы /admin/ со слешем тоже их находил
  echo str_replace(["'__TEPLO_API__'", 'href="web/fonts/'], [json_encode($base . '/api'), 'href="' . $base . '/web/fonts/'], (string)file_get_contents(__DIR__ . '/web/admin.html'));
  exit;
}

if ($path === '/' || $path === '/index.php') {
  $html = (string)file_get_contents(__DIR__ . '/web/dist/site.html');
  $html = str_replace("'__TEPLO_API__'", json_encode($base . '/api'), $html);
  // версия сборки: открытая давно вкладка сверяет её с /api/config и перезагружается на свежую
  $html = str_replace("'__TEPLO_BUILD__'", json_encode(substr((string)md5_file(__DIR__ . '/web/dist/site.html'), 0, 12)), $html);
  // превью ссылки в мессенджерах: абсолютные адреса строим из запроса (домен не зашиваем)
  $host = preg_replace('/[^A-Za-z0-9.:-]/', '', (string)($_SERVER['HTTP_HOST'] ?? 'localhost'));
  $scheme = preg_match('/^(localhost|127\.0\.0\.1)(:\d+)?$/', $host) ? 'http' : 'https';
  $site = $scheme . '://' . $host . $base . '/';
  $ru = str_starts_with(strtolower((string)($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '')), 'ru');
  // поиск (Google) и превью ссылки: заголовок и описание под запросы «передати показання … Харків»; картинка — og-*-4.jpg (tools_og.cjs)
  $og = $ru
    ? ['Передать показания счётчиков в Харькове — тепло, вода, свет, газ | Счётчики', 'Бесплатно: сфотографируйте счётчик — цифры распознаются прямо в телефоне. Подскажем, куда и до какого числа передать показания: ХТМ, Харьковводоканал, Харьковоблэнерго, Газсети, Нафтогаз. Напоминания в Telegram.', 'ru', 'ru_UA',
       'Счётчики — показания за минуту', 'Отопление, вода, свет и газ: фото → цифры → передать в ХТМ, Водоканал, Облэнерго, Газсети. Харьков и область, бесплатно.']
    : ['Передати показання лічильників у Харкові — тепло, вода, світло, газ | Лічильники', 'Безкоштовно: сфотографуйте лічильник — цифри розпізнаються прямо в телефоні. Підкажемо, куди й до якого числа передати показання: ХТМ, Харківводоканал, Харківобленерго, Газмережі, Нафтогаз. Нагадування в Telegram.', 'uk', 'uk_UA',
       'Лічильники — показання за хвилину', 'Опалення, вода, світло й газ: фото → цифри → передати в ХТМ, Водоканал, Обленерго, Газмережі. Харків і область, безкоштовно.'];
  $e = fn($s) => htmlspecialchars($s, ENT_QUOTES);
  $img = $site . 'web/og-' . $og[2] . '-4.jpg';
  $ld = ['@context' => 'https://schema.org', '@type' => 'WebApplication', 'name' => $ru ? 'Счётчики' : 'Лічильники', 'alternateName' => [$ru ? 'Лічильники' : 'Счётчики', 'peredai'],
    'url' => $site, 'image' => $img, 'description' => $og[1], 'applicationCategory' => 'UtilitiesApplication', 'operatingSystem' => 'Web, Telegram',
    'inLanguage' => ['uk', 'ru'], 'isAccessibleForFree' => true, 'offers' => ['@type' => 'Offer', 'price' => '0', 'priceCurrency' => 'UAH'],
    'areaServed' => ['@type' => 'AdministrativeArea', 'name' => $ru ? 'Харьковская область' : 'Харківська область']];
  $meta = '<meta name="description" content="' . $e($og[1]) . '"><meta name="robots" content="index, follow, max-image-preview:large"><link rel="canonical" href="' . $e($site) . '">' .
    '<meta property="og:type" content="website"><meta property="og:site_name" content="' . ($ru ? 'Счётчики' : 'Лічильники') . '"><meta property="og:url" content="' . $e($site) . '">' .
    '<meta property="og:title" content="' . $e($og[4]) . '"><meta property="og:description" content="' . $e($og[5]) . '"><meta property="og:locale" content="' . $og[3] . '">' .
    '<meta property="og:image" content="' . $e($img) . '"><meta property="og:image:secure_url" content="' . $e($img) . '"><meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="' . $e($og[4]) . '">' .
    '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' . $e($og[4]) . '"><meta name="twitter:description" content="' . $e($og[5]) . '"><meta name="twitter:image" content="' . $e($img) . '">' .
    '<script type="application/ld+json">' . json_encode($ld, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) . '</script>';
  // роботы превью (Telegram, Facebook/Instagram, WhatsApp, Viber, Slack…) получают крошечную страницу только с превью — быстро и наверняка
  if (preg_match('~TelegramBot|facebookexternalhit|Facebot|meta-externalagent|Instagram|Twitterbot|WhatsApp|Viber|Slackbot|Discordbot|LinkedInBot|SkypeUriPreview|Pinterest|vkShare|redditbot|Snapchat|Embedly|Iframely~i', (string)($_SERVER['HTTP_USER_AGENT'] ?? ''))) {
    header('Content-Type: text/html; charset=utf-8'); header('Cache-Control: public, max-age=600');
    echo '<!DOCTYPE html><html lang="' . ($ru ? 'ru' : 'uk') . '"><head><meta charset="utf-8"><title>' . $e($og[4]) . '</title>' . $meta . '</head><body><h1>' . $e($og[4]) . '</h1><p>' . $e($og[5]) . '</p><p><img src="' . $e($img) . '" width="1200" height="630" alt=""></p></body></html>';
    exit;
  }
  if ($ru) $html = preg_replace('~<html lang="uk"~', '<html lang="ru"', $html, 1);
  $html = preg_replace('~<title>.*?</title>~s', '<title>' . $e($og[0]) . '</title>' . $meta, $html, 1);
  // текст лендинга прямо в HTML (для поисковиков без JavaScript); приложение заменяет его при первой отрисовке. Тексты — из web/src/i18n.js (lp_*)
  $html = str_replace('<div id="root"></div>', '<div id="root">' . seoStatic($ru, $e) . '</div>', $html);
  header('Content-Type: text/html; charset=utf-8');
  header('Cache-Control: no-cache');
  // CSRF-cookie — уже со страницей (08.11): иначе первые запросы приложения (баннер cookie → согласие, журнал, /visit) параллельно просили её у
  // сервера, каждый ответ выдавал свою — и заголовок X-CSRF расходился с cookie (403 csrf у 207 из 255 посетителей за 3 дня)
  if (empty($_COOKIE['ts_csrf'])) setcookie('ts_csrf', bin2hex(random_bytes(16)), ['expires' => time() + 86400 * 365, 'path' => ($base ?: '') . '/', 'secure' => $scheme === 'https', 'httponly' => false, 'samesite' => 'Lax']);
  header("Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://telegram.org; frame-src https://oauth.telegram.org; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https://t.me https://telegram.org; connect-src 'self'; base-uri 'none'; form-action 'self'");
  echo $html;
  exit;
}

// IndexNow (Bing и др.): ключ сайта по адресу /<32 hex>.txt — поисковик проверяет им пинг из cron (app/indexnow.php)
if (preg_match('~^/[0-9a-f]{32}\.txt$~', $path)) { require __DIR__ . '/app/indexnow.php'; if (IndexNow::serve($path)) exit; }

// поисковики: robots.txt и sitemap.xml — адрес из запроса (домен не зашиваем). Cloudflare дописывает свои строки (content signals) сверху.
if ($path === '/robots.txt' || $path === '/sitemap.xml') {
  $host = preg_replace('/[^A-Za-z0-9.:-]/', '', (string)($_SERVER['HTTP_HOST'] ?? 'localhost'));
  $site = (preg_match('/^(localhost|127\.0\.0\.1)(:\d+)?$/', $host) ? 'http' : 'https') . '://' . $host . $base . '/';
  header('Cache-Control: public, max-age=3600');
  if ($path === '/robots.txt') { header('Content-Type: text/plain; charset=utf-8'); echo "User-agent: *\nAllow: /\nDisallow: " . $base . "/admin\n\nSitemap: " . $site . "sitemap.xml\n"; exit; }
  header('Content-Type: application/xml; charset=utf-8');
  echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' . htmlspecialchars($site) . '</loc><lastmod>' . date('Y-m-d', (int)filemtime(__DIR__ . '/web/dist/site.html')) . '</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url></urlset>' . "\n";
  exit;
}

/** Текст лендинга без JavaScript (поисковики, читалки). Строки берём из web/src/i18n.js — те же, что видит человек. */
function seoStatic(bool $ru, callable $e): string {
  $src = (string)@file_get_contents(__DIR__ . '/web/src/i18n.js');
  $t = function (string $k) use ($src, $ru): string {
    if (!preg_match_all('~\b' . preg_quote($k, '~') . ":\s*'((?:\\\\.|[^'\\\\])*)'~u", $src, $m) || !$m[1]) return '';
    return stripcslashes($m[1][$ru && isset($m[1][1]) ? 1 : 0]);
  };
  $li = fn(array $ks) => implode('', array_map(fn($k) => '<li>' . $e($t($k)) . '</li>', $ks));
  $card = fn(string $h, string $p) => '<li><h3>' . $e($t($h)) . '</h3><p>' . $e($t($p)) . '</p></li>';
  return '<main class="seo-static" style="max-width:760px;margin:0 auto;padding:32px 20px;font-family:system-ui,sans-serif;line-height:1.5">' .
    '<p>' . $e($t('lp_badge')) . '</p><h1>' . $e($t('lp_h1a') . ' ' . $t('lp_h1b')) . '</h1><p>' . $e($t('lp_lead')) . '</p><ul>' . $li(['lp_tr1', 'lp_tr2', 'lp_tr3']) . '</ul>' .
    '<p><a href="#start">' . $e($t('lp_cta')) . '</a></p>' .
    '<h2>' . $e($t('lp_dest_t')) . '</h2><ul><li>' . ($ru ? 'ХТМ (Харьковские тепловые сети)' : 'ХТМ (Харківські теплові мережі)') . '</li>' . $li(['lp_d_vk', 'lp_d_obl', 'lp_d_grm', 'lp_d_naf']) . '</ul>' .
    '<h2>' . $e($t('lp_steps_t')) . '</h2><ol>' . $card('lp_s1_t', 'lp_s1') . $card('lp_s2_t', 'lp_s2') . $card('lp_s3_t', 'lp_s3') . '</ol>' .
    '<h2>' . $e($t('lp_bento_t')) . '</h2><ul>' . $card('lp_due_t', 'lp_due') . $card('lp_tg_t', 'lp_tg') . $card('lp_pl_t', 'lp_pl') . $card('lp_cost_t', 'lp_cost') . $card('lp_gpv_t', 'lp_gpv') . '</ul>' .
    '<h2>' . $e($t('lp_end_t')) . '</h2><p>' . $e($t('lp_end')) . '</p>' .
    '<footer><p>' . $e($t('lf_about')) . '</p><p><a href="#privacy">' . $e($t('lg_privacy')) . '</a> · <a href="#terms">' . $e($t('lg_terms')) . '</a> · <a href="#help">' . $e($t('nav_help')) . '</a></p><p>' . $e($t('lf_indep')) . '</p></footer></main>';
}

http_response_code(404);
header('Content-Type: text/plain; charset=utf-8');
echo 'Not found';
