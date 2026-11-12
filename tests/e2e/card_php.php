<?php
// Помічник e2e_cardsend.cjs: дотик картки фото («Відправити», «st») і cron роботів — як на сервері, але Telegram підмінено.
// SITE_DATA=/tmp/teplo_data php tests/e2e/card_php.php query <card> <uid> <data> | cron
declare(strict_types=1);
define('TEPLO', 1);
$R = dirname(__DIR__, 2);
foreach (['core', 'telegram', 'mail', 'reminders', 'widget', 'recognize', 'api', 'admin', 'vkcab', 'cabs', 'htmsvc', 'vksvc', 'localbot', 'relay', 'docs', 'gpv', 'providers', 'visits', 'journal'] as $f) require "$R/app/$f.php";
$log = []; Telegram::$send = function ($m, $p) use (&$log) { $log[] = $m; return ['ok' => true, 'result' => ['message_id' => 1]]; };
BotWidget::$off = false;
if (($argv[1] ?? '') === 'query') {
  $c = BotCard::get((int)$argv[2]);
  $r = BotCard::query($c, (int)$argv[3], (string)$argv[4], fn($d) => ['data' => $d === null ? null : BotWidget::enc($d)]);
  echo json_encode(['data' => json_decode((string)($r['data'] ?? 'null'), true), 'tg' => $log], JSON_UNESCAPED_UNICODE);
} else {
  $h = HtmSvc::cron(); $b = BotCard::cron();
  echo json_encode(['htm' => $h, 'cards' => $b, 'tg' => $log], JSON_UNESCAPED_UNICODE);
}
