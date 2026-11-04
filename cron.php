<?php
// Запускается сервером раз в минуту (снаружи закрыт). Раз в час: удалить фото старше photo_keep_days,
// старые лимиты, истёкшие сессии и лишние версии из истории данных (StateHist::cleanup); напоминания ботом (вода 15/19, тепло 5/22 — см. app/reminders.php).
// Каждый запуск отмечается в SITE_DATA/cache/cron.json — по нему /api/health и /admin видят, что cron жив.
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
define('TEPLO', 1);
require __DIR__ . '/app/core.php';
require __DIR__ . '/app/telegram.php';
require __DIR__ . '/app/reminders.php';
require __DIR__ . '/app/recognize.php';
require __DIR__ . '/app/api.php';
require __DIR__ . '/app/admin.php';
require __DIR__ . '/app/vkcab.php';
$beat = Cron::read(); $beat['last'] = gmdate('c');
// кабинет Водоканала — открывается ли (раз в 10 минут; статус видят приложение и /admin)
if ((int)gmdate('i') % 10 === 7) { try { $beat['vkCab'] = VkStatus::probeCabinet()['state']; } catch (Throwable $e) { error_log('teplo vk probe: ' . $e->getMessage()); } }
// проба «не знайдено»: выдуманный рахунок — узнаём ли мы ответ живого сайта (раз на версию разбора, VkCab::PROBE_V)
if ((int)gmdate('i') % 10 === 3) { try { $p = VkStatus::probeNotFound(); if ($p) $beat['vkProbe'] = $p['error']; } catch (Throwable $e) { error_log('teplo vk notfound probe: ' . $e->getMessage()); } }
if ((int)gmdate('i') !== 17) { Cron::write($beat); exit; }
$h = ['at' => gmdate('c')];
try { $n = Admin::cleanup(); $h['photos'] = $n; if ($n) echo gmdate('c') . " удалено старых фото: $n\n"; $h['hist'] = StateHist::cleanup(); }
catch (Throwable $e) { $h['error'] = mb_substr($e->getMessage(), 0, 200); error_log('teplo cron: ' . $e->getMessage()); }
try {
  $s = Reminders::run(time());
  if ($s) {
    $h['reminders'] = array_count_values(array_map(fn($x) => $x[1] . ' ' . (str_starts_with($x[2], 'error') ? 'error' : $x[2]), $s));
    // итог рассылки за месяц по видам (только числа) — виден в /api/health без входа
    $due = Reminders::due(time()); $key = $due['kind'] . ' ' . $due['ym'];
    $r = (array)($beat['remind'] ?? []); $c = (array)($r[$key]['n'] ?? []);
    foreach ($s as $x) { $st = str_starts_with($x[2], 'error') ? 'error' : $x[2]; $c[$st] = ($c[$st] ?? 0) + 1; }
    $r[$key] = ['at' => gmdate('c'), 'n' => $c]; $beat['remind'] = array_slice($r, -4, null, true);
    echo gmdate('c') . ' напоминаний: ' . count($s) . "\n";
  }
} catch (Throwable $e) { $h['remindError'] = mb_substr($e->getMessage(), 0, 200); error_log('teplo remind: ' . $e->getMessage()); }
$beat['hourly'] = $h; Cron::write($beat);
