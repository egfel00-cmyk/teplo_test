<?php
// Синтетический сайт обленерго для ретранслятора: онлайн-форма «передача показників» и вход в кабинет.
// php -S 127.0.0.1:8097 tests/obl-mock/router.php ; сценарий — файл /tmp/obl_mock_scn: ok | twozone | twostep | cf | captcha | redirect_off
// /__last — что пришло последним POST (поля, cookie), /__scn?s=… — сменить сценарий.
$scn = trim((string)@file_get_contents('/tmp/obl_mock_scn')) ?: 'ok';
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path === '/__scn') { file_put_contents('/tmp/obl_mock_scn', (string)($_GET['s'] ?? 'ok')); echo 'ok'; return true; }
if ($path === '/__last') { header('Content-Type: application/json'); echo @file_get_contents('/tmp/obl_mock_last.json') ?: '{}'; return true; }
if ($scn === 'cf') { http_response_code(403); header('cf-mitigated: challenge'); header('Server: cloudflare'); echo '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><div id="challenge-platform">cf-chl</div></body></html>'; return true; }
$page = fn(string $body) => '<!DOCTYPE html><html lang="uk"><head><meta charset="utf-8"><title>Передача показників</title><script src="/js/app.js"></script></head><body><header><nav>Меню</nav></header><main>' . $body . '</main><footer>© АТ «Харківобленерго»</footer></body></html>';
if ($path === '/frontend/web/index.php/uk/site/login') {
  echo $page('<form id="login-form" action="/frontend/web/index.php/uk/site/login" method="post"><input type="hidden" name="_csrf-frontend" value="x"><label for="e">Email</label><input id="e" name="LoginForm[email]"><label for="p">Пароль</label><input id="p" type="password" name="LoginForm[password]"><button type="submit">Увійти</button></form>');
  return true;
}
if ($path !== '/uk/transmissionofmeterreadings') { http_response_code(404); echo 'nf'; return true; }
session_start();
$csrf = $_SESSION['csrf'] ??= bin2hex(random_bytes(8));
$acc = '<label for="acc">Особовий рахунок</label><input id="acc" name="MeterForm[account]" required>';
$cons = '<label><input type="checkbox" name="MeterForm[agree]" value="1" required> Погоджуюсь на обробку персональних даних</label>';
$read = $scn === 'twozone' ? '<label for="d">Показники (день)</label><input id="d" name="MeterForm[day]" required><label for="n">Показники (ніч)</label><input id="n" name="MeterForm[night]" required>'
  : '<label for="v">Показники лічильника, кВт·год</label><input id="v" name="MeterForm[value]" required>';
$widget = $scn === 'captcha' ? '<div class="cf-turnstile" data-sitekey="0x4AAAAAAA"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>' : '';
$form = fn(string $inner, string $btn = 'Передати') => '<form id="meter-form" action="/uk/transmissionofmeterreadings" method="post"><input type="hidden" name="_csrf" value="' . $csrf . '">' . $inner . $widget . '<button type="submit" name="send" value="1">' . $btn . '</button></form>';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  file_put_contents('/tmp/obl_mock_last.json', json_encode(['post' => $_POST, 'cookie' => array_keys($_COOKIE), 'ua' => $_SERVER['HTTP_USER_AGENT'] ?? '', 'ref' => $_SERVER['HTTP_REFERER'] ?? '', 'origin' => $_SERVER['HTTP_ORIGIN'] ?? '', 'ct' => $_SERVER['CONTENT_TYPE'] ?? ''], JSON_UNESCAPED_UNICODE));
  $f = $_POST['MeterForm'] ?? [];
  if (($_POST['_csrf'] ?? '') !== $csrf) { http_response_code(400); echo $page('<div class="alert alert-danger">Помилка: сесія застаріла</div>'); return true; }
  if (!preg_match('/^\d{5,12}$/', (string)($f['account'] ?? ''))) { echo $page('<div class="alert alert-danger">Невірний особовий рахунок</div>' . $form($acc . ($scn === 'twostep' ? '' : $read) . $cons)); return true; }
  if ($f['account'] === '000000') { echo $page('<div class="alert alert-danger">Особовий рахунок не знайдено</div>' . $form($acc . $read . $cons)); return true; }
  if ($scn === 'twostep' && !isset($f['value'])) { $_SESSION['acc'] = $f['account']; echo $page('<p>Рахунок ' . htmlspecialchars($f['account']) . '. Внесіть показники.</p>' . $form('<input type="hidden" name="MeterForm[account]" value="' . htmlspecialchars($f['account']) . '">' . $read)); return true; }
  if ($scn === 'redirect_off') { header('Location: https://evil.example/thanks'); http_response_code(302); return true; }
  $_SESSION['flash'] = 'Показники успішно прийнято. Дякуємо!'; header('Location: /uk/transmissionofmeterreadings?done=1'); http_response_code(302); return true;
}
$flash = $_SESSION['flash'] ?? ''; unset($_SESSION['flash']);
echo $page(($flash ? '<div class="alert alert-success">' . $flash . '</div>' : '') . '<h1>Передача показників лічильника</h1>' . $form($acc . ($scn === 'twostep' ? '' : $read) . $cons, $scn === 'twostep' ? 'Далі' : 'Передати'));
return true;
