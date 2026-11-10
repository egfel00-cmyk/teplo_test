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
