<?php
// Для лендинга (web/build.py): сколько громад в справочнике по областям, у скольких названа вода и есть её цена. Снаружи — 404 (tools_*).
declare(strict_types=1);
define('TEPLO', 1);
putenv('SITE_DATA=' . sys_get_temp_dir() . '/teplo_counts');
require __DIR__ . '/app/core.php';
require __DIR__ . '/app/providers.php';
$out = [];
foreach (Providers::REGIONS as $r => $name) {
  $hm = []; foreach ((array)Providers::kat()['hromadas'] as $id => $h) if (($h['r'] ?? '') === $r) $hm[(string)$id] = $h;
  $d = Providers::rdata($r); $w = 0; $wt = 0; $ht = 0;
  foreach ($hm as $id => $x) { $e = (array)($d['hromadas'][Providers::hkey((string)$id)] ?? []);
    if (!empty($e['water']['org'])) $w++; if (isset($e['water']['supply']) && $e['water']['supply'] !== null) $wt++; if (!empty($e['heat']['org'])) $ht++; }
  // 193-я: тимчасово окуповані громади (цілком, без part) — не «в довіднику»: постачальників там немає
  $tot = count(array_filter((array)($d['tot'] ?? []), fn($t) => is_array($t) && empty($t['part'])));
  $out[] = ['r' => $r, 'h' => count($hm) - $tot, 'w' => $w, 'wt' => $wt, 'heat' => $ht];
}
echo json_encode($out, JSON_UNESCAPED_UNICODE);
