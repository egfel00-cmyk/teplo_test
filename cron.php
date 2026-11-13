<?php
// Запускается сервером раз в минуту (снаружи закрыт). Раз в час: удалить фото старше photo_keep_days,
// старые лимиты, истёкшие сессии и лишние версии из истории данных (StateHist::cleanup); напоминания ботом (вода 15/19, тепло 5/22 — см. app/reminders.php).
// Каждый запуск отмечается в SITE_DATA/cache/cron.json — по нему /api/health и /admin видят, что cron жив.
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
define('TEPLO', 1);
require __DIR__ . '/app/core.php';
require __DIR__ . '/app/telegram.php';
require __DIR__ . '/app/mail.php';
require __DIR__ . '/app/reminders.php';
require __DIR__ . '/app/widget.php';
require __DIR__ . '/app/recognize.php';
require __DIR__ . '/app/api.php';
require __DIR__ . '/app/admin.php';
require __DIR__ . '/app/vkcab.php';
require __DIR__ . '/app/cabs.php';
require __DIR__ . '/app/htmsvc.php';
require __DIR__ . '/app/vksvc.php';
require __DIR__ . '/app/localbot.php';
require __DIR__ . '/app/relay.php';   // RelayForm — розбір форм для LocalBot (102-а: без нього проба падала «class not found»)
require __DIR__ . '/app/docs.php';
require __DIR__ . '/app/gpv.php';
require __DIR__ . '/app/providers.php';
require __DIR__ . '/app/visits.php';
require __DIR__ . '/app/journal.php';
require __DIR__ . '/app/indexnow.php';
$beat = Cron::read(); $beat['last'] = gmdate('c');
// кабинет Водоканала — открывается ли (раз в 10 минут; статус видят приложение и /admin)
if ((int)gmdate('i') % 10 === 7) { try { $beat['vkCab'] = VkStatus::probeCabinet()['state']; } catch (Throwable $e) { error_log('teplo vk probe: ' . $e->getMessage()); } }
// проба «не знайдено»: выдуманный рахунок — узнаём ли мы ответ живого сайта (раз на версию разбора, VkCab::PROBE_V)
if ((int)gmdate('i') % 10 === 3) { try { $p = VkStatus::probeNotFound(); if ($p) $beat['vkProbe'] = $p['error']; } catch (Throwable $e) { error_log('teplo vk notfound probe: ' . $e->getMessage()); } }
// диагностика «незнайома сторінка» Водоканала: раз на версию — учётки админа, только чтение (VkStatus::recheck); пока период закрыт — раз в сутки утром,
// чтобы первую открытую форму показаний (новый период) записать в журнал ещё до первой живой отправки
try { $rc = VkStatus::recheck(); if ($rc) $beat['vkRecheck'] = ['at' => gmdate('c'), 'res' => $rc['res']]; } catch (Throwable $e) { error_log('teplo vk recheck: ' . $e->getMessage()); }
// кабинеты ХТМ, обленерго, Газмереж — пускают ли наш сервер и нет ли капчи (раз в 30 минут; /api/health → cabs)
if (CabProbe::due()) { try { CabProbe::run(); } catch (Throwable $e) { error_log('teplo cab probe: ' . $e->getMessage()); } }
// правки справочника из /admin, уже перенесённые сессией в репозиторий, — убрать (раз в час)
if ((int)gmdate('i') === 17) { try { $pn = ProvEdit::prune(); if ($pn) $beat['provPrune'] = $pn; } catch (Throwable $e) { error_log('teplo prov prune: ' . $e->getMessage()); } }
// кабинеты и формы из справочника областей (ProvProbe): пустят ли наш сервер, есть ли капча — одна адрес в 2 минуты, каждая раз в 7 дней (/api/health → prov.probe)
if ((int)gmdate('i') % 2 === 1) { try { $pp = ProvProbe::run(); if ($pp) $beat['provProbe'] = ['at' => gmdate('c'), 'host' => parse_url($pp, PHP_URL_HOST)]; } catch (Throwable $e) { error_log('teplo prov probe: ' . $e->getMessage()); } }
// обленерго с украинских узлов check-host.net — только коды ответа страниц, раз на версию (UaCheck; /api/health → uaCheck)
try { UaCheck::run(); } catch (Throwable $e) { error_log('teplo ua check: ' . $e->getMessage()); }
// «Перевірити» кабинета ХТМ без кнопки: раз на версию — учётки админа, только чтение (HtmSvc::lookAdmins; /api/health → htmcab.seen, by cron)
try { $lk = HtmSvc::lookAdmins(); if ($lk !== null) $beat['htmLook'] = ['at' => gmdate('c'), 'res' => $lk]; } catch (Throwable $e) { error_log('teplo htm look: ' . $e->getMessage()); }
// внесённые роботом показания ХТМ — перечитать журнал кабинета (20/40/70/130/360 мин), итог → Telegram
try { $hc = HtmSvc::cron(); if ($hc) $beat['htmRecheck'] = ['at' => gmdate('c'), 'n' => array_count_values(array_map(fn($x) => explode(' ', $x[1])[0], $hc))]; } catch (Throwable $e) { error_log('teplo htm recheck: ' . $e->getMessage()); }
// вода → сайт Водоканалу у фоні / автоподача: очередь по сроку (VkSvc)
try { $vq = VkSvc::cron(); if ($vq) $beat['vkQueue'] = ['at' => gmdate('c'), 'n' => array_count_values(array_map(fn($x) => $x[1], $vq))]; } catch (Throwable $e) { error_log('teplo vk queue: ' . $e->getMessage()); }
// автоподача місцевим КП (LocalBot: форма на сайті, кабінет, e-mail) — черга за строком, не більше 2 за хвилину
if ((int)gmdate('i') % 10 === 9) { try { $lp = LocalBot::probe(); if ($lp) $beat['lbProbe'] = ['at' => gmdate('c'), 'bot' => $lp[0], 'res' => $lp[1]]; } catch (Throwable $e) { error_log('teplo lb probe: ' . $e->getMessage()); } }
try { $lq = LocalBot::cron(); if ($lq) $beat['lbQueue'] = ['at' => gmdate('c'), 'n' => array_count_values(array_map(fn($x) => $x[1], $lq))]; } catch (Throwable $e) { error_log('teplo lb queue: ' . $e->getMessage()); }
// картки фото в чаті (121-а): свіжі статуси роботів — у ту саму картку («в черзі → відправлено → прийнято ✓»)
try { $bc = BotCard::cron(); if ($bc) $beat['botCards'] = ['at' => gmdate('c'), 'n' => count($bc)]; } catch (Throwable $e) { error_log('teplo bot cards: ' . $e->getMessage()); }
// квитанции Водоканала в фоне, без человека: 1–25 число, 7–22 по Киеву, один вход за минуту (VkBills; /api/health → vkBills)
try { $vb = VkBills::cron(); if ($vb) $beat['vkBills'] = ['at' => gmdate('c'), 'res' => $vb[0][1]]; } catch (Throwable $e) { error_log('teplo vk bills: ' . $e->getMessage()); }
// квитанции ХТМ в фоне, без человека: у кого подключён кабинет ХТМ — каждый день 7–22 по Киеву, один вход за минуту, только чтение (HtmBills; /api/health → htmBills)
// в одну минуту с Водоканалом не ходим: та минута уже занята входом на сайт Водоканала
try { if (empty($vb)) { $hb = HtmBills::cron(); if ($hb) $beat['htmBills'] = ['at' => gmdate('c'), 'res' => $hb[0][1]]; } } catch (Throwable $e) { error_log('teplo htm bills: ' . $e->getMessage()); }
// графики отключений света (ГПВ Харьковоблэнерго) — раз в 10 минут; утром (7–12 по Киеву) — сегодняшний график в Telegram
if ((int)gmdate('i') % 10 === 5) {
  try { Gpv::probeSite(); } catch (Throwable $e) { error_log('teplo gpv site: ' . $e->getMessage()); }
  try { Gpv::fetchDocs(); } catch (Throwable $e) { error_log('teplo gpv docs: ' . $e->getMessage()); }   // офіційні PDF-переліки (раз на добу)
  try { $g = Gpv::refresh(); $beat['gpv'] = $g['ok'] ? ['ok' => true, 'update' => $g['update']] : ['ok' => false, 'err' => $g['err']]; } catch (Throwable $e) { error_log('teplo gpv: ' . $e->getMessage()); }
  try {
    $s = Gpv::morning(time());
    // итог утренней рассылки по дням (только числа) — /api/health → gpvSent
    if ($s) { $k = Gpv::kyiv(time())->format('Y-m-d'); $r = (array)($beat['gpvSent'] ?? []); $c = (array)($r[$k]['n'] ?? []);
      foreach ($s as $x) { $st = str_starts_with($x[2], 'error') ? 'error' : $x[2]; $c[$st] = ($c[$st] ?? 0) + 1; }
      $r[$k] = ['at' => gmdate('c'), 'n' => $c]; $beat['gpvSent'] = array_slice($r, -7, null, true); }
  } catch (Throwable $e) { error_log('teplo gpv morning: ' . $e->getMessage()); }
  // кому завтра/сегодня придут график и ближайшее напоминание — только числа (/api/health → gpvReady, remindNext), ничего не шлём
  try { $beat['gpvReady'] = Gpv::readiness() + ['at' => gmdate('c')]; } catch (Throwable $e) { error_log('teplo gpv ready: ' . $e->getMessage()); }
  try { $beat['remindNext'] = Reminders::nextPreview(time()); } catch (Throwable $e) { error_log('teplo remind next: ' . $e->getMessage()); }
}
// кнопка меню бота й команди — раз на версію (Telegram::MENU_V): «Відкрити» / «Открыть»
if (Cfg::get('bot_token') && Cfg::appUrlKnown() && (int)($beat['botMenuV'] ?? 0) !== Telegram::MENU_V) {
  try { $mo = Telegram::menuSetup(); if (!empty($mo['setChatMenuButton']['ok'])) $beat['botMenuV'] = Telegram::MENU_V; } catch (Throwable $e) { error_log('teplo bot menu: ' . $e->getMessage()); }
}
// вебхук — раз на версію переліку оновлень (Telegram::HOOK_V): з 10.4 ще й widget_query (дотики в картках-нагадуваннях)
if (Cfg::get('bot_token') && Cfg::appUrlKnown() && (string)Cfg::get('webhook_secret') !== '' && (int)($beat['hookV'] ?? 0) !== Telegram::HOOK_V) {
  try { $hk = Telegram::hookUpdate(); if (!empty($hk['ok'])) $beat['hookV'] = Telegram::HOOK_V; } catch (Throwable $e) { error_log('teplo bot hook: ' . $e->getMessage()); }
}
if ((int)gmdate('i') !== 17) { Cron::write($beat); exit; }
// app — какой адрес сайта cron (CLI, без HTTP_HOST) подставит в кнопки Telegram: проверка из /api/health, что не localhost (elec2 02.11.2026)
$h = ['at' => gmdate('c'), 'app' => (string)parse_url(Cfg::appUrl(), PHP_URL_HOST)];
try { $n = Admin::cleanup(); $h['photos'] = $n; if ($n) echo gmdate('c') . " удалено старых фото: $n\n"; $h['hist'] = StateHist::cleanup(); $h['events'] = Journal::cleanup(); }
catch (Throwable $e) { $h['error'] = mb_substr($e->getMessage(), 0, 200); error_log('teplo cron: ' . $e->getMessage()); }
// новая сборка сайта → IndexNow (Bing и др.), раз на сборку; /api/health → indexnow
if (Cfg::appUrlKnown()) { try { IndexNow::run(Cfg::appUrl()); } catch (Throwable $e) { error_log('teplo indexnow: ' . $e->getMessage()); } }
try {
  $s = Reminders::run(time());
  if ($s) {
    $h['reminders'] = array_count_values(array_map(fn($x) => $x[1] . ' ' . (str_starts_with($x[2], 'error') ? 'error' : $x[2]), $s));
    // итог рассылки за месяц по видам (только числа) — виден в /api/health без входа; 142-я: видов за час может быть несколько (местные окна)
    $r = (array)($beat['remind'] ?? []);
    foreach ($s as $x) { $key = $x[1] . ' ' . ($x[3] ?? ''); $st = str_starts_with($x[2], 'error') ? 'error' : $x[2]; $c = (array)($r[$key]['n'] ?? []); $c[$st] = ($c[$st] ?? 0) + 1; $r[$key] = ['at' => gmdate('c'), 'n' => $c]; }
    $beat['remind'] = array_slice($r, -6, null, true);
    echo gmdate('c') . ' напоминаний: ' . count($s) . "\n";
  }
} catch (Throwable $e) { $h['remindError'] = mb_substr($e->getMessage(), 0, 200); error_log('teplo remind: ' . $e->getMessage()); }
// «Нагадати завтра» з картки-нагадування (app/widget.php)
try { $sz = Reminders::runSnooze(time()); if ($sz) $h['snooze'] = array_count_values(array_map(fn($x) => $x[1] . ' ' . (str_starts_with($x[2], 'error') ? 'error' : $x[2]), $sz)); }
catch (Throwable $e) { error_log('teplo snooze: ' . $e->getMessage()); }
// почта (81-я): нагадування на e-mail — тем, у кого нет Telegram или Telegram не дошёл; сводка владельцу — в 8-м часу по Киеву (app/mail.php)
try {
  $sm = Reminders::runMail(time());
  if ($sm) { $h['remindMail'] = array_count_values(array_map(fn($x) => str_starts_with($x[2], 'error') ? 'error' : $x[2], $sm));
    $r = (array)($beat['remind'] ?? []);
    foreach ($sm as $x) { $key = $x[1] . ' ' . ($x[3] ?? ''); $st = str_starts_with($x[2], 'error') ? 'error' : $x[2]; $c = (array)($r[$key]['n'] ?? []); $c[$st] = ($c[$st] ?? 0) + 1; $r[$key] = ['at' => gmdate('c'), 'n' => $c]; }
    $beat['remind'] = array_slice($r, -6, null, true); }
} catch (Throwable $e) { $h['remindMailError'] = mb_substr($e->getMessage(), 0, 200); error_log('teplo remind mail: ' . $e->getMessage()); }
try { $dg = Mail::digest(time(), $beat['mailDigest'] ?? null); if ($dg) $beat['mailDigest'] = $dg; } catch (Throwable $e) { error_log('teplo mail digest: ' . $e->getMessage()); }
$beat['hourly'] = $h; Cron::write($beat);
