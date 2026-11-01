<?php
// Запускается сервером раз в минуту (снаружи закрыт). Раз в час: удалить фото старше photo_keep_days,
// старые лимиты и истёкшие сессии.
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
define('TEPLO', 1);
require __DIR__ . '/app/core.php';
require __DIR__ . '/app/recognize.php';
require __DIR__ . '/app/api.php';
require __DIR__ . '/app/admin.php';
if ((int)gmdate('i') !== 17) exit;
try { $n = Admin::cleanup(); if ($n) echo gmdate('c') . " удалено старых фото: $n\n"; }
catch (Throwable $e) { error_log('teplo cron: ' . $e->getMessage()); }
