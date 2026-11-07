<?php
// Для e2e_htmbill: один запуск HtmBills::cron (как cron.php) в заданное время. php tests/e2e/htmbills_cron.php <unix-время> [reset]
declare(strict_types=1);
define('TEPLO', 1);
foreach (['core', 'telegram', 'reminders', 'recognize', 'api', 'admin', 'vkcab', 'cabs', 'htmsvc', 'vksvc', 'docs', 'gpv'] as $f) require __DIR__ . '/../../app/' . $f . '.php';
if (($argv[2] ?? '') === 'reset') @unlink(HtmBills::file());
echo json_encode(HtmBills::cron((int)($argv[1] ?? time())), JSON_UNESCAPED_UNICODE), "\n";
