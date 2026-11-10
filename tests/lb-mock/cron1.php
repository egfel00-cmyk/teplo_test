<?php
// Один прогін черги автоподачі (LocalBot::cron) для e2e — без решти cron.php (проб зовнішніх сайтів). SITE_DATA=/tmp/teplo_data php tests/lb-mock/cron1.php
declare(strict_types=1);
define('TEPLO', 1);
foreach (['core', 'telegram', 'mail', 'vkcab', 'cabs', 'relay', 'localbot'] as $m) require __DIR__ . '/../../app/' . $m . '.php';
echo json_encode(LocalBot::cron()), "\n";
