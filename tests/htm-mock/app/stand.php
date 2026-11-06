<?php
// Стенд v2 — общие хелперы. Локальный тестовый двойник КОНТРАКТА кабинета ХТМ (поля, маршруты, маркеры, тексты статусов).
// Вёрстка нейтральная, на каждой странице плашка «ТЕСТОВИЙ СТЕНД». Только localhost/LAN, не публиковать.
declare(strict_types=1);

const ROOT = __DIR__ . '/..';
const SCENARIOS = ['ok', 'bad_credentials', 'account_login_closed', 'window_open', 'period_closed', 'robot_reject', 'captcha',
  'session_expired', 'server_500', 'maintenance', 'markup_changed', 'slow', 'nominmax', 'banners', 'heat_down'];

function cfg(): array { static $c; return $c ??= json_decode((string)file_get_contents(ROOT . '/config/stand.json'), true); }
function F(string $k): string { return cfg()['form'][$k]; }
function TX(string $k, array $v = []): string { $s = cfg()['texts'][$k]; foreach ($v as $a => $b) $s = str_replace('{' . $a . '}', $b, $s); return $s; }

function st_path(): string { return ROOT . '/storage/state.json'; }
function st(): array { if (!isset($GLOBALS['__ST'])) { if (!is_file(st_path())) st_reset(); $GLOBALS['__ST'] = json_decode((string)file_get_contents(st_path()), true); } return $GLOBALS['__ST']; }
function st_save(array $s): void { $GLOBALS['__ST'] = $s; file_put_contents(st_path(), json_encode($s, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)); }
function st_reset(): void {
  $s = json_decode((string)file_get_contents(ROOT . '/config/state.sample.json'), true);
  // база «прошло раньше за расчётом» — 20-е прошлого месяца относительно даты стенда
  $t = new DateTimeImmutable(today());
  $s['baseline']['date'] = $t->modify('first day of last month')->format('Y-m-20');
  $s['journal'] = [];
  st_save($s);
}

function opt(string $name, string $default = ''): string { $f = ROOT . "/storage/$name.txt"; return is_file($f) ? trim((string)file_get_contents($f)) : $default; }
function opt_set(string $name, string $v): void { $v === '' ? @unlink(ROOT . "/storage/$name.txt") : file_put_contents(ROOT . "/storage/$name.txt", $v); }

/** Сценарий: заголовок X-Mock-Scenario > ?scenario= > админка > ok */
function scenario(): string {
  foreach ([$_SERVER['HTTP_X_MOCK_SCENARIO'] ?? '', $_GET['scenario'] ?? '', opt('scenario')] as $c) if ($c && in_array($c, SCENARIOS, true)) return $c;
  return 'ok';
}
/** Дата стенда: X-Mock-Today > админка > сегодня (Y-m-d). */
function today(): string {
  foreach ([$_SERVER['HTTP_X_MOCK_TODAY'] ?? '', opt('today')] as $c) if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $c)) return $c;
  return date('Y-m-d');
}
function robot_delay(): int { $h = $_SERVER['HTTP_X_MOCK_ROBOT_DELAY'] ?? ''; if ($h !== '' && ctype_digit($h)) return (int)$h; $o = opt('robot_delay'); return $o !== '' ? (int)$o : (int)cfg()['robot_delay_sec_default']; }

function window_open(): bool {
  $sc = scenario(); if ($sc === 'window_open') return true; if ($sc === 'period_closed') return false;
  $d = (int)substr(today(), 8, 2); $w = cfg()['window'];
  return $d >= $w['from'] && $d <= $w['to'];
}

function log_req(string $event, array $data = []): void {
  // значения паролей в журнал не пишем
  array_walk_recursive($data, function (&$v, $k) { if (in_array($k, [cfg()['login']['password'], 'passw', 'password'], true)) $v = '***'; });
  file_put_contents(ROOT . '/storage/journal.jsonl', json_encode(['ts' => date('c'), 'event' => $event, 'method' => $_SERVER['REQUEST_METHOD'] ?? '', 'uri' => $_SERVER['REQUEST_URI'] ?? '', 'scenario' => scenario(), 'today' => today(), 'data' => $data], JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND);
}

/** Тело POST в windows-1251 → UTF-8 (как у боевого сайта). */
function post(string $name): ?string {
  if (!isset($_POST[$name])) return null;
  $v = (string)$_POST[$name];
  return mb_check_encoding($v, 'UTF-8') && !preg_match('/[\x80-\xff]/', $v) ? $v : mb_convert_encoding($v, 'UTF-8', 'Windows-1251');
}

function sess(): void { if (session_status() !== PHP_SESSION_ACTIVE) { session_name('CABSESSID'); session_set_cookie_params(['httponly' => false, 'path' => '/']); session_start(); } }
function logged_in(): bool { sess(); return !empty($_SESSION['uid']); }

function h(?string $s): string { return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8'); }
function ua_date(string $ymd): string { return substr($ymd, 8, 2) . '.' . substr($ymd, 5, 2) . '.' . substr($ymd, 0, 4); }
function ymd_from_ua(string $s): ?string { return preg_match('/^(\d{2})\.(\d{2})\.(\d{4})$/', trim($s), $m) ? "$m[3]-$m[2]-$m[1]" : null; }
function month_ua(string $ymd, bool $genitive = true): string {
  $n = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
  $g = ['Січня', 'Лютого', 'Березня', 'Квітня', 'Травня', 'Червня', 'Липня', 'Серпня', 'Вересня', 'Жовтня', 'Листопада', 'Грудня'];
  return ($genitive ? $g : $n)[(int)substr($ymd, 5, 2) - 1];
}
function acc_url(string $prefix = '/cabinet'): string { $c = st()['credentials']; return $prefix . '/' . $c['account'] . '/' . rawurlencode(mb_strtoupper($c['surname'])); }

/** Вывод в windows-1251, как у боевого сайта. Плашка и noindex — всегда. */
function page(string $title, string $body, int $code = 200, bool $auth = false): void {
  http_response_code($code);
  header('Content-Type: text/html; charset=windows-1251');
  header('X-Robots-Tag: noindex, nofollow');
  setcookie('cablang', 'u', ['path' => '/']);
  $menu = $auth ? '<nav class="stand-menu"><a href="/cabinet">Стан рахунку</a> <a href="/cabinet/list">Квартири</a> <a href="' . h(acc_url('/cabinet/heat')) . '">Показання тепла</a> <a href="/cabinet/logout">Вихід</a></nav>' : '';
  $html = '<!doctype html><html lang="uk"><head><meta charset="windows-1251"><meta name="robots" content="noindex,nofollow"><meta name="viewport" content="width=device-width, initial-scale=1">'
    . '<title>' . h(TX('title_prefix') . $title) . '</title><link rel="stylesheet" href="/assets/stand.css"></head><body>'
    . '<div class="stand-banner" role="alert">ТЕСТОВИЙ СТЕНД — локальна імітація для розробки адаптера. Це НЕ сайт ХТМ. Дані вигадані.</div>'
    . '<div class="stand-topbar"><span class="stand-badge">MOCK</span> <a href="/stand/admin">адмінка стенда</a>'
    . '<span class="stand-scn">дата стенда: <b>' . h(ua_date(today())) . '</b> · сценарій: <b>' . h(scenario()) . '</b></span></div>'
    . '<main class="stand-main">' . $menu . $body . '</main><footer class="stand-foot">htm-mock v2 · контракт зі зняття 01.11.2026 · тільки localhost/LAN</footer></body></html>';
  echo mb_convert_encoding($html, 'Windows-1251', 'UTF-8');
}

function global_scenarios(string $path): bool {
  $sc = scenario();
  if ($sc === 'slow') sleep(3);
  if (str_starts_with($path, '/stand/') || str_starts_with($path, '/assets/')) return false;
  if ($sc === 'server_500') { page('500', '<p data-marker="stand-500">Внутрішня помилка сервера.</p>', 500); return true; }
  if ($sc === 'maintenance') { page('Техроботи', '<p data-marker="stand-maintenance">Ведуться технічні роботи.</p>', 503); return true; }
  return false;
}
