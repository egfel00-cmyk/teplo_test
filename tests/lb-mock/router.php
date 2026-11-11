<?php
// Стенд «сайт КП без входу» для автоподачі (LocalBot, 102-а): як mtve.kp.km.ua — код абонента в p1–p3 → сторінка абонента →
// «Передати поточні покази водолічильника» → форма з двома лічильниками → «Зберегти». Запуск: php -S 127.0.0.1:8096 tests/lb-mock/router.php
// Сайт: config.php 'lb_base_mtve' => 'http://127.0.0.1:8096/'. Останнє надіслане — GET /__last, скинути — /__reset, капча — /__captcha.
$f = sys_get_temp_dir() . '/lb_mock.json'; $st = json_decode((string)@file_get_contents($f), true) ?: [];
$p = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$acc = <<<H
<html><body><h1>Переглянути стан оплати послуг. Передати поточні показники лічильників</h1><div>Введіть код абонента</div>
<form class="js-ind-form"><input type="text" name="p1"><input type="text" name="p2"><input type="text" name="p3"><button type="submit">Далі</button></form></body></html>
H;
if ($p === '/__reset') { @unlink($f); exit('ok'); }
if ($p === '/__captcha') { $st['captcha'] = true; file_put_contents($f, json_encode($st)); exit('ok'); }
if ($p === '/__last') { header('Content-Type: application/json'); exit(json_encode($st['last'] ?? null)); }
if (!empty($st['captcha'])) exit('<form><div class="g-recaptcha" data-sitekey="x"></div>' . $acc . '</form>');
// ASP.NET-кабінет без входу (LocalBot flow aspx, 105-а) — як debt.crewingcrm.com/brovk; сайт: config.php 'lb_base_brovk' => 'http://127.0.0.1:8096/aspx/'
if (str_starts_with((string)$p, '/aspx')) {
  require __DIR__ . '/aspx.php';
  [$code, $html] = lb_aspx($_SERVER['REQUEST_METHOD'], $_POST, $st); file_put_contents($f, json_encode($st));
  http_response_code($code); exit($html);
}
// Кабінет із входом (LocalBot t:cab, 104-а) — як voda-berezan.telsys.net.ua: на головній вхід особовим рахунком + паролем, поруч реєстрація (теж із паролем)
// і форма «Передати показник» без входу (її веде скрипт — бот не чіпає); після входу — меню «Показники» → форма з лічильником → «Зберегти».
// Сайт: config.php 'lb_base_brz' => 'http://127.0.0.1:8096/cab/'. Логін 1234567, пароль Berezan-2026.
if (str_starts_with((string)$p, '/cab')) {
  $in = ($_COOKIE['sid'] ?? '') === 'ok';
  $home = '<html><body><h1>КП «Міськводоканал»</h1><form name="auth" action="functions.php" method="post"><input type="text" name="auth_no_os" placeholder="Особовий рахунок">'
    . '<input type="password" name="auth_password" required><input type="submit" name="auth_submit" value="Увійти"></form>'
    . '<form method="post"><input type="hidden" name="registration" value="1"><input type="text" name="reg_no_os"><input type="password" name="reg_password"><button type="button" name="reg_submit">Реєстрація</button></form>'
    . '<form name="send_meter"><input type="number" name="meter_no_os" placeholder="Особовий рахунок"><button type="button" onclick="return CheckNoOsMeter()">Продовжити</button></form></body></html>';
  if ($p === '/cab/' || $p === '/cab') exit($in ? '<html><body><nav><a href="/cab/news">Новини</a> <a href="/cab/pokaz">Показники</a> <a href="/cab/exit">Вихід</a></nav><p>Особовий рахунок 1234567</p></body></html>' : $home);
  if ($p === '/cab/functions.php' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    if (($_POST['auth_no_os'] ?? '') === '1234567' && ($_POST['auth_password'] ?? '') === 'Berezan-2026') { setcookie('sid', 'ok', 0, '/'); header('Location: /cab/', true, 302); exit; }
    exit(str_replace('<h1>', '<p class="error">Невірний особовий рахунок або пароль</p><h1>', $home));
  }
  if (!$in) { header('Location: /cab/', true, 302); exit; }
  if ($p === '/cab/pokaz' && $_SERVER['REQUEST_METHOD'] === 'GET') exit('<html><body><form method="post" action="/cab/pokaz"><input type="hidden" name="no_os" value="1234567">'
    . '<table><tr><td>Лічильник № 1234567 (холодна вода)</td><td>попередній 400</td><td><input type="number" name="pokaz[1]"></td></tr></table><button type="submit" name="save" value="1">Зберегти</button></form></body></html>');
  if ($p === '/cab/pokaz') { $st['last'] = $_POST; file_put_contents($f, json_encode($st)); exit('<div class="alert alert-success">Показники прийнято. Дякуємо!</div>'); }
  http_response_code(404); exit('nf');
}

if ($p === '/' && !isset($_GET['p1'])) exit($acc);
if ($p === '/') {
  if (($_GET['p1'] ?? '') . '-' . ($_GET['p2'] ?? '') . '-' . ($_GET['p3'] ?? '') !== '74-108-61') exit('<p class="error">Абонента не знайдено</p>' . $acc);
  exit('<html><body><h2>Абонент 74-108-61</h2><p>Нараховано: 0,00</p><a href="/indications/?id=7">Передати поточні покази водолічильника</a></body></html>');
}
if ($p === '/indications/' && $_SERVER['REQUEST_METHOD'] === 'GET') exit('<html><body><form method="post" action="/indications/save"><input type="hidden" name="id" value="7"><table>'
  . '<tr><td>Лічильник № 1234567 (холодна вода)</td><td><input type="text" name="ind[1]"></td></tr>'
  . '<tr><td>Лічильник № 7654321 (гаряча вода)</td><td><input type="text" name="ind[2]"></td></tr></table><button type="submit" name="save" value="1">Зберегти</button></form></body></html>');
if ($p === '/indications/save') { $st['last'] = $_POST; file_put_contents($f, json_encode($st)); exit('<div class="alert alert-success">Показники збережено. Дякуємо!</div>'); }
http_response_code(404); echo 'nf';
