<?php
// Для e2e_vkbill: один запуск VkBills::cron (как cron.php) в заданное время. php tests/e2e/vkbills_cron.php <unix-время> [reset]
declare(strict_types=1);
define('TEPLO', 1);
foreach (['core', 'telegram', 'reminders', 'recognize', 'api', 'admin', 'vkcab', 'cabs', 'htmsvc', 'vksvc', 'docs', 'gpv'] as $f) require __DIR__ . '/../../app/' . $f . '.php';
if (($argv[2] ?? '') === 'reset') @unlink(VkBills::file());
echo json_encode(VkBills::cron((int)($argv[1] ?? time())), JSON_UNESCAPED_UNICODE), "\n";
