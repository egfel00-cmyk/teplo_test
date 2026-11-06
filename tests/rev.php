<?php
// Отпечаток серверного кода — тот же, что /api/health → rev на бою (Api::rev). Совпал — пуш уже выложен.
$root = dirname(__DIR__); $h = '';
foreach (array_merge([$root . '/index.php', $root . '/cron.php'], glob($root . '/app/*.php') ?: []) as $f) $h .= basename($f) . ':' . (string)md5_file($f) . ';';
echo substr(md5($h), 0, 12), "\n";
