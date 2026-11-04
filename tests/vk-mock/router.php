<?php
// php -S 127.0.0.1:8099 tests/vk-mock/router.php — синтетический кабинет Водоканала для e2e (config.php: 'vk_cab_base' => 'http://127.0.0.1:8099').
require __DIR__ . '/pages.php'; $GLOBALS['VKM_HOST'] = $_SERVER['HTTP_HOST'] ?? '127.0.0.1:8099';
$f = sys_get_temp_dir() . '/vkm_store.json'; $store = json_decode((string)@file_get_contents($f), true) ?: [];
if (($_SERVER['REQUEST_URI'] ?? '') === '/__reset') { @unlink($f); echo 'ok'; return; }
if (($_SERVER['REQUEST_URI'] ?? '') === '/__store') { header('Content-Type: application/json'); echo json_encode($store, JSON_UNESCAPED_UNICODE); return; }
[$code, $html, $h] = vkm_request($_SERVER['REQUEST_METHOD'], $_SERVER['REQUEST_URI'], file_get_contents('php://input'), (string)($_SERVER['HTTP_COOKIE'] ?? ''), $store);
file_put_contents($f, json_encode($store, JSON_UNESCAPED_UNICODE));
http_response_code($code); foreach ($h as $x) header($x, false); header('Content-Type: text/html; charset=UTF-8'); echo $html;
