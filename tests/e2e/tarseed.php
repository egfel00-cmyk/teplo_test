<?php
// 194-я: засев «Тарифы» для e2e_taradmin — без сети: таблицы minfin подставлены (CabWeb::$http), два прохода (точка отсчёта → изменение).
// Запуск: SITE_DATA=/tmp/teplo_data php tests/e2e/tarseed.php
declare(strict_types=1);
define('TEPLO', 1);
foreach (['core', 'telegram', 'mail', 'reminders', 'admin', 'cabs', 'providers', 'tarwatch'] as $f) require __DIR__ . '/../../app/' . $f . '.php';
Telegram::$send = fn() => ['ok' => true];   // владельцу не пишем
$W = 'https://index.minfin.com.ua/ua/tariff/water/'; $G = 'https://index.minfin.com.ua/ua/tariff/gas/distrib/';
$t = fn(string $cap, array $regs) => '<table class="grid"><caption>' . $cap . '</caption>' . implode('', array_map(fn($r, $rows) => '<tr><th colspan="6" class="region">' . $r . '</th></tr>'
  . implode('', array_map(fn($x) => '<tr><td>' . implode('</td><td>', $x) . '</td></tr>', $rows)), array_keys($regs), $regs)) . '</table>';
$H = [$W => $t('Тарифи на воду', ['Запорізька обл.' => [['КП "Водоканал" Запоріжжя', '41,688', '27,684', '', '69,372', 'з 01.06.2026']]]),
  $G => $t('Вартість доставки газу операторами ГРМз 1.11.2026', ['Хмельницька обл.' => [['"Газмережі", Хмельницька філія', '1,848']]])];
CabWeb::$http = function ($m, $u) use (&$H) { return isset($H[$u]) ? ['code' => 200, 'body' => $H[$u]] : ['code' => 404, 'body' => '']; };
TarWatch::table(); Db::q('DELETE FROM tar_changes'); Db::q('DELETE FROM tar_src');
TarWatch::check($W); TarWatch::check($G);
$H[$W] = str_replace(['41,688', '27,684', 'з 01.06.2026'], ['45,130', '32,890', 'з 01.01.2027'], $H[$W]);
$H[$G] = str_replace('1,848', '1,990', $H[$G]);
$a = TarWatch::check($W); $b = TarWatch::check($G);
echo json_encode(['water' => $a['changes'], 'gas' => $b['changes']]), "\n";
