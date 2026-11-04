<?php
// Сирий довідник з tools_gpv_parse.py → app/data/gpv_addr.json з ключами пошуку (ті самі Gpv::skel, що й на сервері).
//   php tools_gpv_index.php raw.json app/data/gpv_addr.json "Адреси та черги 26-27.pdf" sha1
declare(strict_types=1);
define('TEPLO', 1); putenv('SITE_DATA=' . sys_get_temp_dir());
require __DIR__ . '/app/core.php'; require __DIR__ . '/app/telegram.php'; require __DIR__ . '/app/reminders.php'; require __DIR__ . '/app/gpv.php';
[$_, $src, $dst] = $argv; $raw = json_decode((string)file_get_contents($src), true);
$items = [];
foreach ($raw['items'] as $it) {
  $ck = Gpv::skelCity((string)$it['c']); if (mb_strlen($ck) < 3) continue;
  $items[] = ['c' => $it['c'], 'ck' => $ck, 's' => $it['s'], 'k' => $it['s'] !== '' ? Gpv::skel((string)$it['s']) : '', 'h' => $it['h'], 'q' => $it['q']];
}
file_put_contents($dst, json_encode(['v' => 1, 'src' => ['name' => $argv[3] ?? '', 'sha1' => $argv[4] ?? '', 'rows' => $raw['rows'], 'built' => gmdate('Y-m-d')], 'items' => $items], JSON_UNESCAPED_UNICODE));
echo count($items), " записів → $dst\n";
