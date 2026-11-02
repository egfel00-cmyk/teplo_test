<?php
// Запускается сервером раз в минуту (снаружи закрыт). Раз в час: удалить фото старше photo_keep_days,
// старые лимиты и истёкшие сессии; напоминания ботом (вода 15/19, тепло 5/22 — см. app/reminders.php).
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
define('TEPLO', 1);
require __DIR__ . '/app/core.php';
require __DIR__ . '/app/telegram.php';
require __DIR__ . '/app/reminders.php';
require __DIR__ . '/app/recognize.php';
require __DIR__ . '/app/api.php';
require __DIR__ . '/app/admin.php';
if ((int)gmdate('i') !== 17) exit;
try { $n = Admin::cleanup(); if ($n) echo gmdate('c') . " удалено старых фото: $n\n"; }
catch (Throwable $e) { error_log('teplo cron: ' . $e->getMessage()); }
try { $s = Reminders::run(time()); if ($s) echo gmdate('c') . ' напоминаний: ' . count($s) . "\n"; }
catch (Throwable $e) { error_log('teplo remind: ' . $e->getMessage()); }
