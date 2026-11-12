<?php
// Сервис автоподачи ХТМ (HtmSvc) через API против стенда tests/htm-mock: подключить, проверить, внести, перепроверка журнала cron, «Забути пароль».
// Запуск: стенд на 127.0.0.1:8099 (скопировать tests/htm-mock во /tmp, php -S 127.0.0.1:8099 -t public public/router.php), затем php tests/htm_svc.php
declare(strict_types=1);
define('TEPLO', 1);
foreach (['core', 'telegram', 'reminders', 'recognize', 'admin', 'vkcab', 'cabs', 'htmsvc', 'vksvc', 'gpv', 'providers', 'visits', 'journal', 'docs', 'localbot', 'widget', 'mail', 'relay', 'indexnow', 'api'] as $f) require_once __DIR__ . "/../app/$f.php";
$TMP = sys_get_temp_dir() . '/teplo_htmsvc_' . getmypid(); putenv('SITE_DATA=' . $TMP);
$BASE = getenv('HTM_BASE') ?: 'http://127.0.0.1:8099';
Cfg::set(['app_url' => 'https://teplo.example/', 'bot_token' => '1:TEST', 'htm_cab_base' => $BASE, 'cookie_secure' => false, 'admins' => ['emails' => ['u1@example.com'], 'telegram' => []]]);
Db::set(new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC])); Db::migrate();
$SENT = []; Telegram::$send = function ($m, $p) use (&$SENT) { $SENT[] = $p; return ['ok' => true]; };
$pass = 0; $fail = 0;
function ok(string $n, bool $c, $info = null): void { global $pass, $fail; echo ($c ? '  OK  ' : ' FAIL ') . $n . (!$c && $info !== null ? '  → ' . json_encode($info, JSON_UNESCAPED_UNICODE) : '') . "\n"; $c ? $pass++ : $fail++; }
function stand(string $body): void { global $BASE; $ch = curl_init($BASE . '/stand/admin'); curl_setopt_array($ch, [CURLOPT_POST => 1, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => 1]); curl_exec($ch); curl_close($ch); }
final class B {
  public array $jar = [];
  public function req(string $m, string $path, ?array $body = null): Res {
    if (empty($this->jar['ts_csrf'])) $this->take(Api::handle(new Req('GET', '/api/config', ['REMOTE_ADDR' => '10.0.0.9'], $this->jar)));
    $sv = ['REMOTE_ADDR' => '10.0.0.9', 'HTTP_USER_AGENT' => 'test']; if ($m !== 'GET') $sv['HTTP_X_CSRF'] = $this->jar['ts_csrf'] ?? '';
    $r = Api::handle(new Req($m, $path, $sv, $this->jar, $body === null ? '' : json_encode($body))); $this->take($r); return $r;
  }
  private function take(Res $r): void { foreach ($r->cookies as [$n, $v, $o]) { if ($o['expires'] < time()) unset($this->jar[$n]); else $this->jar[$n] = $v; } }
}
stand('act=reset'); stand('act=set&scenario=ok&today=2026-11-10&robot_delay=99999&bill_ym=&bill_pay=');   // рахунок — по умолчанию (прошлый прогон мог оставить свой)
$b = new B();
$r = $b->req('POST', '/api/auth/register', ['email' => 'u1@example.com', 'password' => 'long-pass-1']); ok('вход в сервис', $r->status === 200);
$uid = (int)$r->body['user']['id'];
Db::q("INSERT INTO user_identities (user_id, type, external_id, username, linked_at) VALUES (?, 'telegram', '777', 'u1', ?)", [$uid, Http::iso()]);

$r = $b->req('GET', '/api/cab/htm'); ok('не подключено', $r->status === 200 && $r->body['connected'] === false, $r->body);
$r = $b->req('POST', '/api/cab/htm/connect', ['email' => 'test@stand.local', 'password' => 'stand-pass-123']); ok('без согласия — нет', $r->status === 422 && $r->body['error'] === 'cab_consent', $r->body);
$r = $b->req('POST', '/api/cab/htm/connect', ['email' => 'test@stand.local', 'password' => 'wrong', 'consent' => true]);
ok('неверный пароль → cab_bad_login, ничего не храним', $r->status === 401 && $r->body['error'] === 'cab_bad_login' && !Db::one('SELECT id FROM cab_creds'), $r->body);
$r = $b->req('POST', '/api/cab/htm/connect', ['email' => 'Test@Stand.local', 'password' => 'stand-pass-123', 'phone' => '050 111 22 33', 'consent' => true, 'lang' => 'uk']);
ok('подключено: рахунок из кабинета', $r->status === 200 && $r->body['connected'] && ($r->body['accounts'][0]['acc'] ?? '') === '1000000061' && $r->body['phone'] === '+380501112233', $r->body);
$row = Db::one('SELECT * FROM cab_creds'); ok('пароль в базе зашифрован', $row && !str_contains($row['secret'], 'stand-pass') && CabVault::dec($row['secret']) === 'stand-pass-123');

$r = $b->req('POST', '/api/cab/htm/check', ['lang' => 'uk']);
ok('check: прибор, последние принятые, окно открыто', $r->status === 200 && ($r->body['meter']['serial'] ?? '') === '70000061' && $r->body['open'] && ($r->body['base']->energy ?? '') === '13.245', $r->body);
ok('check: форма как ждали, есть телефон', ($r->body['form']['match'] ?? null) === true && $r->body['form']['phone'] === true, $r->body['form'] ?? null);
$h = HtmSvc::summary(); ok('/api/health → htmcab.form: имена полей без значений', ($h['form']['match'] ?? null) === true && in_array('LastValuePok:text→energy', $h['form']['fields'], true) && !str_contains(json_encode($h), '1000000061'), $h['form'] ?? null);
// «Перевірити» без кнопки (cron): учётка админа, только чтение, раз на LOOK_V; «человек» в /api/health не сдвигается
$lu0 = HtmSvc::summary()['lastUser']; $jobs0 = (int)Db::one('SELECT COUNT(*) AS c FROM cab_jobs')['c']; sleep(1);
$lk = HtmSvc::lookAdmins(); $hs = HtmSvc::summary();
ok('cron look: кабинет админа прочитан, seen.by cron, ничего не внесено', $lk === ['ok', 'arch ok'] && ($hs['seen']['by'] ?? '') === 'cron' && $hs['seen']['open'] === true && $hs['lastUser'] === $lu0
  && (int)Db::one('SELECT COUNT(*) AS c FROM cab_jobs')['c'] === $jobs0 && ($hs['look']['res'] ?? null) === ['ok', 'arch ok'] && ($hs['n']->{'look ok'} ?? 0) === 1, [$lk, $hs['seen'] ?? null, $hs['look'] ?? null]);
$ar = $hs['archive'] ?? []; $arj = json_encode($ar, JSON_UNESCAPED_UNICODE); $sp0 = $ar['docs']['spravka'] ?? [];
ok('…архив рахунків (LOOK_V 6): нынешний — вересень 2026, адрес за березень — 8 вариантов (на стенде 404), довідка — строки без цифр и прізвища, месяцы и «нараховано/оплачено» посчитаны',
  ($ar['result'] ?? '') === 'ok' && ($ar['base'] ?? '') === '2026-09' && count($ar['probe'] ?? []) === 8 && ($ar['probe'][0][1] ?? 0) === 404 && ($sp0['code'] ?? 0) === 200 && ($sp0['pre'] ?? 0) === 1
  && ($sp0['n'] ?? 0) === 19 && ($sp0['pre'] ?? 0) === 1 && str_contains(implode("\n", $sp0['lines'] ?? []), '|М|Р |___') && !preg_match('/\d|тестов|100000006/iu', implode("\n", $sp0['lines'] ?? []))
  && ($ar['docs']['sprvds']['code'] ?? 0) === 404 && ($ar['page']['sel'] ?? -1) === 0, $ar);
$nsh = HtmSpr::summary()['nar'] ?? [];
ok('…нарахування по всіх місяцях («Довідка щодо нарахувань»): 6 місяців 2025-10…2026-05, колонки опалення, без сум (/api/health → htmSpr.nar)',
  ($nsh['n'] ?? 0) === 6 && ($nsh['from'] ?? '') === '2025-10' && ($nsh['to'] ?? '') === '2026-05' && (((array)($nsh['filled'] ?? []))['heat.gcal'] ?? 0) === 3 && (((array)($nsh['filled'] ?? []))['heat.recalc'] ?? 0) === 2
  && ($nsh['check']['withGcal'] ?? 0) === 3 && !preg_match('/2437|3781|1190/', json_encode($nsh)), $nsh);
$shp = HtmSpr::summary()['shape'] ?? [];
ok('…и структура «Довідки по теплу»: 14 заголовков, 1 строка шапки, строки — 14 ячеек масками без цифр (/api/health → htmSpr.shape)', count($shp['heads'] ?? []) === 14 && ($shp['thRows'] ?? 0) === 1
  && count($shp['rows'] ?? []) === 6 && str_starts_with($shp['rows'][0] ?? '', '14: ##.#### | Гкал') && !preg_match('/\d/', preg_replace('/^\d+: /m', '', implode("\n", $shp['rows'] ?? []))) && ($shp['map']['flat'] ?? 0) === 9, $shp);
ok('…второй раз на той же версии — не входим', HtmSvc::lookAdmins() === null && HtmSvc::lookAdmins(time() + 3600) === null);
@unlink(HtmSvc::lookFile()); Cfg::set(['app_url' => 'https://teplo.example/', 'bot_token' => '1:TEST', 'htm_cab_base' => $BASE, 'cookie_secure' => false, 'admins' => ['emails' => ['boss@example.com'], 'telegram' => []]]);
ok('…не админ — его кабинет cron не трогает', HtmSvc::lookAdmins() === [] && (HtmSvc::summary()['n']->{'look ok'} ?? 0) === 1);
Cfg::set(['app_url' => 'https://teplo.example/', 'bot_token' => '1:TEST', 'htm_cab_base' => $BASE, 'cookie_secure' => false, 'admins' => ['emails' => ['u1@example.com'], 'telegram' => []]]);
$lg = json_encode(HtmSvc::log(), JSON_UNESCAPED_UNICODE); ok('журнал без пароля, email и рахунку', !str_contains($lg, 'stand-pass') && !str_contains($lg, 'test@stand') && !str_contains($lg, '1000000061'));

$V = ['date' => '10.11.2026', 'energy' => '14.445', 'volume' => '2332.676', 'flow' => '0.063', 'power' => '1.5', 'tSupply' => '50.12', 'tReturn' => '30.4', 'hours' => '35078', 'errHours' => '153', 'errCode' => 'E---'];
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'r1', 'place' => 'p1', 'vals' => ['energy' => '13.000'] + $V]);
ok('меньше последних принятых — не вносим', $r->status === 422 && $r->body['error'] === 'cab_bad_value' && ($r->body['field'] ?? '') === 'energy', $r->body);
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'r1', 'place' => 'p1', 'vals' => ['tSupply' => '0'] + $V]);
ok('температура 0 — не вносим', $r->status === 422 && ($r->body['field'] ?? '') === 'tSupply', $r->body);
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'r1', 'place' => 'p1', 'vals' => $V, 'lang' => 'uk']);
ok('внесено → на проверке у робота ХТМ', $r->status === 200 && ($r->body['job']['status'] ?? '') === 'pending' && $r->body['job']['rid'] === 'r1' && $r->body['job']['nextAt'] > time() + 1000, $r->body);
$jid = (int)($r->body['job']['id'] ?? 0);
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'r1', 'place' => 'p1', 'vals' => $V]); ok('второе нажатие — то же внесение, не дубль', $r->status === 200 && !empty($r->body['dup']) && $r->body['job']['id'] === $jid, $r->body);
ok('cron до срока ничего не делает', HtmSvc::cron() === []);
$out = HtmSvc::cron(time() + 21 * 60); ok('cron через 20 мин: робот ХТМ ещё не проверил → ждём', ($out[0][1] ?? '') === 'wait', $out);
stand('act=robot'); $SENT = [];
$out = HtmSvc::cron(time() + 45 * 60); ok('cron через 40 мин: «прийнято»', ($out[0][1] ?? '') === 'ok', $out);
ok('Telegram «✅ ХТМ прийняв»', isset($SENT[0]) && str_starts_with($SENT[0]['text'], '✅ ХТМ прийняв') && str_contains($SENT[0]['reply_markup']['inline_keyboard'][0][0]['web_app']['url'], '?go=heat&place=p1'), $SENT);
$r = $b->req('GET', '/api/cab/htm'); ok('статус в приложении: ok', ($r->body['jobs'][0]['status'] ?? '') === 'ok' && $r->body['jobs'][0]['rid'] === 'r1', $r->body['jobs'] ?? null);

// отклонено роботом: новая дата позже, часы не сходятся с календарём
stand('act=set&today=2026-11-12&robot_delay=99999');
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'r2', 'place' => 'p1', 'vals' => ['date' => '12.11.2026', 'energy' => '14.900', 'hours' => '40000'] + $V]);
ok('второе внесение — на проверке', ($r->body['job']['status'] ?? '') === 'pending', $r->body);
stand('act=robot'); $SENT = [];
$out = HtmSvc::cron(time() + 25 * 60); ok('робот ХТМ не принял → rejected', ($out[0][1] ?? '') === 'rejected', $out);
$r = $b->req('GET', '/api/cab/htm'); $j = $r->body['jobs'][0] ?? [];
ok('причина отказа — словами ХТМ', $j['status'] === 'rejected' && $j['reason'] !== '' && preg_match('/не\s+при[йн]{1,2}ят/u', $j['text']), $j);
ok('Telegram «❌ не прийняв» с причиной', isset($SENT[0]) && str_starts_with($SENT[0]['text'], '❌ ХТМ не прийняв') && str_contains($SENT[0]['text'], 'Причина'), $SENT);

// не дождались: робот ХТМ так и не проверил
stand('act=set&today=2026-11-14&robot_delay=99999');
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'r3', 'place' => 'p1', 'vals' => ['date' => '14.11.2026', 'energy' => '15.100', 'volume' => '2340', 'hours' => '35100', 'errHours' => '153'] + $V]);
ok('третье внесение — на проверке', ($r->body['job']['status'] ?? '') === 'pending', $r->body);
$SENT = []; $t = time(); foreach (HtmSvc::AFTER as $m) $out = HtmSvc::cron($t + $m * 60 + 30);
ok('после 6 ч без ответа → unknown, «перевірте самі»', ($out[0][1] ?? '') === 'unknown' && str_starts_with($SENT[0]['text'] ?? '', '⏳'), [$out, $SENT]);

// окно закрыто, форма изменилась — ничего не шлём
stand('act=set&today=2026-11-27&robot_delay=0');
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'r4', 'vals' => ['date' => '27.11.2026', 'energy' => '16'] + $V]); ok('27-го → cab_closed', $r->status === 409 && $r->body['error'] === 'cab_closed', $r->body);
stand('act=set&scenario=markup_changed&today=2026-11-20');
$n0 = (int)Db::one('SELECT COUNT(*) AS c FROM cab_jobs')['c'];
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'r5', 'vals' => ['date' => '20.11.2026', 'energy' => '16'] + $V]);
ok('форма другая → cab_form_changed, внесения нет', $r->status === 409 && $r->body['error'] === 'cab_form_changed' && (int)Db::one('SELECT COUNT(*) AS c FROM cab_jobs')['c'] === $n0, $r->body);
ok('в /api/health видно, какие поля незнакомы', (HtmSvc::summary()['form']['match'] ?? null) === false, HtmSvc::summary()['form'] ?? null);
stand('act=set&scenario=captcha');
$r = $b->req('POST', '/api/cab/htm/check', []); ok('капча → cab_captcha, не обходим', $r->status === 423 && $r->body['error'] === 'cab_captcha', $r->body);
stand('act=set&scenario=ok&today=2026-11-20');

// пароль сменили на сайте ХТМ → «підключіть знову», больше не пробуем
Db::q('UPDATE cab_creds SET secret = ?', [CabVault::enc('old-pass')]);
$r = $b->req('POST', '/api/cab/htm/check', []); ok('пароль не подходит → cab_relogin', $r->status === 401 && $r->body['error'] === 'cab_relogin', $r->body);
ok('…и state bad_login', Db::one('SELECT state FROM cab_creds')['state'] === 'bad_login');
$r = $b->req('POST', '/api/cab/htm/connect', ['email' => 'test@stand.local', 'password' => 'stand-pass-123', 'consent' => true]); ok('подключить заново', $r->status === 200 && $r->body['state'] === 'ok', $r->body);

// автоподача: фото в бот → приложение проверило → в очередь; cron вносит сам через autoDelay(); можно отменить или «внести зараз»
stand('act=set&today=2026-11-16&robot_delay=99999'); Db::q('DELETE FROM rate_limits');   // тестов больше, чем 20 заходов в час на человека
$VA = ['date' => '16.11.2026', 'energy' => '15.200', 'volume' => '2362.7', 'hours' => '35222', 'errHours' => '153'] + $V;   // часы: 10.11 35078 + 6 сут
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'a1', 'place' => 'p1', 'vals' => $VA, 'delay' => true]); ok('автоподача выключена → в очередь нельзя', $r->status === 409 && $r->body['error'] === 'cab_auto_off', $r->body);
$r = $b->req('GET', '/api/cab/htm'); ok('статус: auto false', $r->body['auto'] === false && $r->body['autoDelay'] >= 60, $r->body);
$r = $b->req('POST', '/api/cab/htm/auto', ['on' => true]); ok('включить автоподачу', $r->status === 200 && $r->body['auto'] === true, $r->body);
ok('бот: автоподача включена у человека', HtmSvc::autoOn($uid));
// бот: фото при автоподаче → кнопка «Розпізнати й внести»
Telegram::$fetch = fn($id) => base64_decode('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=');
@unlink((Cfg::data() ?: sys_get_temp_dir() . '/teplo_data') . '/cache/tgreply_777'); $SENT = [];
$tp = Telegram::photo(['chat' => ['id' => 777], 'from' => ['id' => 777], 'date' => time(), 'photo' => [['file_id' => 'f1']]], 'uk');
ok('бот: «Розпізнати й внести» → ?inbox=1&auto=1', !empty($tp['auto']) && str_contains($tp['reply_markup']['inline_keyboard'][0][0]['web_app']['url'] ?? '', '?inbox=1&auto=1') && str_contains($tp['text'], 'у кабінет ХТМ'), $tp);
$SENT = [];
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'a1', 'place' => 'p1', 'vals' => $VA, 'delay' => true, 'lang' => 'uk']);
$qj = $r->body['job'] ?? []; $qid = (int)($qj['id'] ?? 0);
ok('в очередь: queued, срок через autoDelay', $r->status === 200 && $qj['status'] === 'queued' && $qj['auto'] === true && $qj['nextAt'] >= time() + HtmSvc::autoDelay() - 5, $r->body);
ok('Telegram «📝 внесемо о HH:MM» (по-киевски)', str_starts_with($SENT[0]['text'] ?? '', '📝 Розпізнали') && preg_match('/о \d{2}:\d{2}/u', $SENT[0]['text']) && str_contains($SENT[0]['text'], 'Скасувати'), $SENT);
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'a1', 'place' => 'p1', 'vals' => $VA, 'delay' => true]); ok('повтор того же — та же очередь, не дубль', !empty($r->body['dup']) && $r->body['job']['id'] === $qid, $r->body);
$n0 = count(HtmSvc::cron(time() + 60)); ok('cron до срока очередь не трогает', Db::one('SELECT status FROM cab_jobs WHERE id = ?', [$qid])['status'] === 'queued');
$SENT = []; $out = HtmSvc::cron(time() + HtmSvc::autoDelay() + 30);
ok('cron по сроку внёс сам → на проверке робота ХТМ', in_array([$qid, 'auto pending'], $out, true) && Db::one('SELECT status FROM cab_jobs WHERE id = ?', [$qid])['status'] === 'pending', $out);
$r = $b->req('GET', '/api/cab/htm'); $jq = array_values(array_filter($r->body['jobs'], fn($j) => $j['id'] === $qid))[0] ?? [];
ok('…рахунок из кабинета, auto, следующая проверка через 20 мин', $jq['acc'] === '1000000061' && $jq['auto'] === true && $jq['status'] === 'pending' && $jq['nextAt'] > time() + 1000, $jq);
stand('act=robot'); $SENT = [];
$out = HtmSvc::cron(time() + 25 * 60); ok('…потом «прийнято» и ✅ в Telegram', in_array([$qid, 'ok'], $out, true) && str_starts_with($SENT[0]['text'] ?? '', '✅'), [$out, $SENT]);
// отмена
stand('act=set&today=2026-11-17&robot_delay=99999');
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'a2', 'place' => 'p1', 'vals' => ['date' => '17.11.2026', 'energy' => '15.400', 'hours' => '35246'] + $VA, 'delay' => true]); $c2 = (int)($r->body['job']['id'] ?? 0);
$r = $b->req('POST', '/api/cab/htm/cancel', ['job' => $c2]); ok('«Скасувати» → cancelled', $r->status === 200 && $r->body['job']['status'] === 'cancelled', $r->body);
HtmSvc::cron(time() + HtmSvc::autoDelay() + 30); ok('…и cron не вносит', Db::one('SELECT status FROM cab_jobs WHERE id = ?', [$c2])['status'] === 'cancelled');
$r = $b->req('POST', '/api/cab/htm/cancel', ['job' => $c2]); ok('отменить уже отменённое — cab_no_job', $r->status === 409 && $r->body['error'] === 'cab_no_job', $r->body);
// «Внести зараз»
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'a3', 'place' => 'p1', 'vals' => ['date' => '17.11.2026', 'energy' => '15.410', 'hours' => '35246'] + $VA, 'delay' => true]); $c3 = (int)($r->body['job']['id'] ?? 0);
$r = $b->req('POST', '/api/cab/htm/now', ['job' => $c3]); ok('«Внести зараз» → внесено сразу', $r->status === 200 && $r->body['job']['status'] === 'pending' && $r->body['job']['id'] === $c3, $r->body);
// не прошло правила кабинета на момент внесения → failed с человеческим текстом и ⚠️ в Telegram
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'a4', 'place' => 'p1', 'vals' => ['date' => '17.11.2026', 'energy' => '13.000', 'hours' => '35246'] + $VA, 'delay' => true]); $c4 = (int)($r->body['job']['id'] ?? 0);
$SENT = []; $out = HtmSvc::cron(time() + HtmSvc::autoDelay() + 30);
$f4 = HtmSvc::pubJob(Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$c4]));
ok('меньше последних принятых → failed, ничего не внесено', $f4['status'] === 'failed' && $f4['why'] === 'bad_value' && str_contains((string)$f4['human'], 'Накопичена енергія'), $f4);
ok('…⚠️ в Telegram с причиной', str_starts_with($SENT[0]['text'] ?? '', '⚠️ Не внесли') && str_contains($SENT[0]['text'], 'Накопичена'), $SENT);
// окно закрыто к сроку очереди
stand('act=set&today=2026-11-26&robot_delay=99999');
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'a5', 'place' => 'p1', 'vals' => ['date' => '19.11.2026', 'energy' => '15.600', 'hours' => '35200'] + $VA, 'delay' => true]); $c5 = (int)($r->body['job']['id'] ?? 0);
HtmSvc::cron(time() + HtmSvc::autoDelay() + 30); $f5 = HtmSvc::pubJob(Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$c5]));
ok('прийом закрито → failed closed', $f5['status'] === 'failed' && $f5['why'] === 'closed', $f5);
// выключить автоподачу — очередь отменяется
stand('act=set&today=2026-11-18&robot_delay=99999');
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'a6', 'place' => 'p1', 'vals' => ['date' => '18.11.2026', 'energy' => '15.700', 'hours' => '35210'] + $VA, 'delay' => true]); $c6 = (int)($r->body['job']['id'] ?? 0);
$r = $b->req('POST', '/api/cab/htm/auto', ['on' => false]); ok('выключить автоподачу → очередь отменена', $r->body['auto'] === false && Db::one('SELECT status FROM cab_jobs WHERE id = ?', [$c6])['status'] === 'cancelled', $r->body);
@unlink((Cfg::data() ?: sys_get_temp_dir() . '/teplo_data') . '/cache/tgreply_777');
$tp = Telegram::photo(['chat' => ['id' => 777], 'from' => ['id' => 777], 'date' => time(), 'photo' => [['file_id' => 'f2']]], 'uk');
ok('бот без автоподачи — прежняя кнопка «Розпізнати фото»', empty($tp['auto']) && str_ends_with($tp['reply_markup']['inline_keyboard'][0][0]['web_app']['url'] ?? '', '?inbox=1'), $tp);
Db::q('DELETE FROM rate_limits');
$r = $b->req('POST', '/api/cab/htm/auto', ['on' => true]); $r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'a7', 'place' => 'p1', 'vals' => ['date' => '18.11.2026', 'energy' => '15.800', 'hours' => '35220'] + $VA, 'delay' => true]); $c7 = (int)($r->body['job']['id'] ?? 0);

// окно дат без min/max на странице (живой кабинет 06.11 их так не показал): по календарю Киева — 1-е число … сегодня
ok('окно по календарю Киева (30.11 22:30 UTC = 01.12 у Києві) и со страницы', HtmSvc::window(['min' => null, 'max' => null], gmmktime(22, 30, 0, 11, 30, 2026)) === ['01.12.2026', '01.12.2026']
  && HtmSvc::window(['min' => '05.11.2026', 'max' => '20.11.2026']) === ['05.11.2026', '20.11.2026']);
ok('журнал: дата без нуля и энергия с запятой — та же строка', (HtmCab::find([['date' => '6.11.2026', 'energy' => '14,445', 'status' => 'ok']], '06.11.2026', '14.445')['status'] ?? '') === 'ok');
$kv = new DateTimeImmutable('now', new DateTimeZone('Europe/Kyiv'));
stand('act=set&scenario=nominmax&today=' . $kv->format('Y-m-d') . '&robot_delay=99999'); Db::q('DELETE FROM rate_limits');
$r = $b->req('POST', '/api/cab/htm/check', ['lang' => 'uk']);
ok('check без min/max: окно по календарю', $r->status === 200 && ($r->body['winSrc'] ?? '') === 'calendar' && $r->body['min'] === $kv->format('01.m.Y') && $r->body['max'] === $kv->format('d.m.Y'), $r->body);
$sn = HtmSvc::summary()['seen'] ?? []; ok('…/api/health → seen.dateJs: как страница задаёт дату', str_contains(json_encode($sn['dateJs'] ?? [], JSON_UNESCAPED_UNICODE), 'datetimepicker') && ($sn['minMax'] ?? null) === false, $sn);
ok('…/api/health → seen.alerts: сколько плашек на странице, без текста', is_array($sn['alerts'] ?? null) && isset($sn['alerts']['err'], $sn['alerts']['ok']) && !str_contains(json_encode($sn), 'Увага'), $sn['alerts'] ?? null);
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'w1', 'vals' => ['date' => $kv->modify('+1 day')->format('d.m.Y'), 'energy' => '16.000', 'hours' => '35300'] + $V]);
ok('…дата «завтра» — не вносим', $r->status === 422 && ($r->body['field'] ?? '') === 'date', $r->body);
$ls = HtmSvc::summary()['lastSend'] ?? [];
ok('…/api/health → lastSend: отказ правил и окно страницы (как у «Перевірити»), без текста', ($ls['op'] ?? '') === 'send' && ($ls['result'] ?? '') === 'bad_value' && ($ls['field'] ?? '') === 'date'
  && ($ls['minMax'] ?? null) === false && str_contains(json_encode($ls['dateJs'] ?? []), 'datetimepicker') && isset($ls['alerts']['err']), $ls);
stand('act=set&scenario=ok&today=2026-11-21&robot_delay=99999'); Db::q('DELETE FROM rate_limits');
// сайт ХТМ не отвечает: 424 со словами для человека (502 Cloudflare подменил бы своей страницей), в /api/health — шаги сбоя без рахунку
stand('act=set&scenario=heat_down&today=2026-11-21&robot_delay=99999'); $r = $b->req('POST', '/api/cab/htm/check', ['lang' => 'uk']);
ok('страница тепла 503 → 424 cab_down «Сайт ХТМ зараз не відповідає»', $r->status === 424 && ($r->body['error'] ?? '') === 'cab_down' && str_contains((string)($r->body['human'] ?? ''), 'не відповідає'), $r->body);
$le = HtmSvc::summary()['lastErr'] ?? []; $lj = json_encode($le, JSON_UNESCAPED_UNICODE);
ok('…/api/health → lastErr: шаг, на котором упало, без рахунку и прізвища', ($le['op'] ?? '') === 'check' && ($le['result'] ?? '') === 'down' && str_contains($lj, '"\/cabinet\/heat\/{acc}\/{sur}",503') && !str_contains($lj, '1000000061'), $le);
stand('act=set&scenario=ok&today=2026-11-21&robot_delay=99999'); Db::q('DELETE FROM rate_limits');

// квитанции ХТМ в фоне, без человека (HtmBills; владелец 07.11.2026): кабинет подключён, запись тепла за жовтень → квитанция из «Платежі» к ней
$tB = gmmktime(8, 0, 0, 11, 7, 2026);   // 10:00 по Киеву, 7 листопада → квитанция за жовтень
$stH = fn(array $pl, array $rd) => ['readings' => $rd, 'tariff' => new stdClass(), 'updatedAt' => 555, 'places' => $pl];
$plH = fn(string $id, string $acc, array $m = []) => ['id' => $id, 'name' => 'Моя', 'meter' => ['model' => 'Sharky 774', 'account' => $acc] + $m];
$rdH = fn(string $id, string $place, string $date) => ['id' => $id, 'place' => $place, 'htm' => ['date' => $date, 'energy' => 13.5], 'status' => 'accepted', 'updatedAt' => 1000];
$accs = [['acc' => '1000000061', 'sur' => 'ТЕСТОВИЙ']];
$wy = array_map(fn($x) => $x[0], HtmBills::why($stH([$plH('a', '1000000061'), $plH('b', '1000000061', ['billAuto' => false]), $plH('c', '555555'), $plH('d', '1000000061')], [$rdH('h1', 'a', '2026-10-20')]), $accs));
ok('квитанции ХТМ: причины по квартирам — ok, off («Квитанції самі» выключено), noacc (рахунок не из кабинета), ok и без записи за месяц', $wy === ['ok', 'off', 'noacc', 'ok'], $wy);
$w1 = HtmBills::why($stH([['id' => 'a', 'meter' => ['model' => 'X']]], [$rdH('h1', 'a', '2026-10-20')]), $accs);
ok('…без рахунку у счётчика: одна квартира с теплом и один рахунок в кабинете — берём его', ($w1[0][1]['acc'] ?? '') === '1000000061', $w1);
Db::q('DELETE FROM user_state WHERE user_id = ?', [$uid]);
Db::q('INSERT INTO user_state (user_id, data, version, updated_at) VALUES (?, ?, 1, ?)', [$uid, json_encode($stH([$plH('p1', '1000000061')], [$rdH('h1', 'p1', '2026-10-20'), $rdH('h2', 'p1', '2026-09-18')]), JSON_UNESCAPED_UNICODE), Http::iso()]);
@unlink(HtmBills::file()); $lu0 = HtmSvc::summary()['lastUser']; Db::q('DELETE FROM rate_limits');
$SD = fn() => json_decode(Db::one('SELECT data FROM user_state WHERE user_id = ?', [$uid])['data'], true);
ok('квитанции ХТМ: ночью (23:30 по Киеву) и рано утром — не ходим', HtmBills::cron(gmmktime(21, 30, 0, 11, 7, 2026)) === [] && HtmBills::cron(gmmktime(4, 0, 0, 11, 7, 2026)) === []);
// кабинет (как живой 07.11): «Сформувати рахунок» → HTML «Рахунок за вересень 2026 року» → к показаниям ВЕРЕСНЯ (месяц рахунку = месяц показаний)
$cr = HtmBills::cron($tB); $sH = $SD(); $bl = $sH['readings'][1]['bills'] ?? [];
$dH = Db::one("SELECT * FROM docs WHERE user_id = ? AND src = 'htm'", [$uid]); $hh = $dH ? (string)@file_get_contents(Docs::root() . '/' . $uid . '/' . $dH['file']) : '';
ok('квитанции ХТМ: 7-го в 10:00 — вход (только чтение), рахунок за вересень (HTML) в документы (src htm, ym 2026-09), к записи тепла 18.09 — bills auto htm, до сплати', $cr === [[$uid, 'got']] && $dH && $dH['ym'] === '2026-09' && $dH['mime'] === 'text/html' && $dH['place'] === 'p1'
  && count($bl) === 1 && $bl[0]['auto'] === 'htm' && $bl[0]['id'] === $dH['id'] && ($bl[0]['ym'] ?? '') === '2026-09' && ($bl[0]['pay'] ?? '') === '245.30' && str_contains($bl[0]['name'], 'ХТМ, вересень 2026')
  && ($sH['readings'][0]['bills'] ?? null) === null && $sH['updatedAt'] === 555, [$cr, $bl, $dH]);
ok('…копия рахунку: без скриптов, кнопок «Друкувати/Назад», ссылок и обработчиков; стиль и картинка сайта — внутри (data:), UTF-8', $hh !== '' && !preg_match('/<script|onclick|javascript:|<button|href=|Друкувати|history\.back/iu', $hh)
  && str_contains($hh, 'data:image/png;base64,') && str_contains($hh, '.bill{') && str_contains($hh, 'ДО СПЛАТИ') && str_contains($hh, '<meta charset="utf-8">') && str_contains($hh, 'Копія рахунку з кабінету'), mb_substr($hh, 0, 400));
ok('…прошлая версия — в историю (htmbill); «человек» в журнале кабинета не сдвинулся', (Db::one('SELECT reason FROM user_state_hist WHERE user_id = ? ORDER BY id DESC LIMIT 1', [$uid])['reason'] ?? '') === 'htmbill'
  && HtmSvc::summary()['lastUser'] === $lu0 && (HtmSvc::summary()['n']->{'autobill bill'} ?? 0) === 1);
$spm = HtmSpr::mine($uid); $sps = HtmSpr::summary(); $spj = json_encode($sps, JSON_UNESCAPED_UNICODE);
$nr = []; foreach ((array)($spm[0]['nar']['rows'] ?? []) as $r) $nr[$r['ym']] = $r;
ok('…тим самим входом — нарахування по місяцях у дані квартири (GET /api/htm/spr → nar): березень 2,437 Гкал, 3781,20 грн; квітень — перерахунок −1190,31; сальдо на початок',
  ($nr['2026-03']['heat']['gcal'] ?? null) === 2.437 && ($nr['2026-03']['heat']['cost'] ?? null) === 3781.2 && ($nr['2026-04']['heat']['recalc'] ?? null) === -1190.31 && ($spm[0]['nar']['from'] ?? '') === '01.10.2021'
  && isset($spm[0]['nar']['start']['heat']) && $spm[0]['nar']['start']['heat'] == 0 && ($nr['2026-02']['heat']['paid'] ?? null) == 3000, $spm[0]['nar'] ?? null);
ok('…тем же входом — «Довідка по теплу»: 6 місяців нарахувань ХТМ сохранены для этого человека и квартиры; /api/health → htmSpr — сколько и какие колонки, без чисел и людей',
  count($spm) === 1 && count($spm[0]['rows']) === 6 && ($spm[0]['rows'][5]['ym'] ?? '') === '2026-03' && ($sps['rows'] ?? 0) === 6 && count($sps['cols'] ?? []) === 14 && ($sps['from'] ?? '') === '2025-10'
  && ($sps['filled']->flat ?? $sps['filled']['flat'] ?? 0) === 6 && !preg_match('/1000000061|ТЕСТОВИЙ|7902|12\.91|1 ?500/u', $spj) && HtmSpr::mine($uid + 999) === [], [$spm, $sps]);
$ck = $sps['check'] ?? [];
ok('…сверка довідки в /api/health → htmSpr.check: витрата = різниця + втрати × S_кв/S_буд (6 из 6), тариф 1539,50 по месяцам, «надходження» ≠ нарахованому, наш расчёт — в пределах 15 %, без личных сумм',
  ($ck['formula']['of'] ?? 0) === 6 && ($ck['formula']['ok'] ?? 0) === 6 && array_values(array_unique($ck['tariff'] ?? [])) === [1539.5] && ($ck['abon'] ?? []) === [29.4]
  && ($ck['paid']['of'] ?? 0) === 5 && ($ck['paid']['same'] ?? 9) === 0 && ($ck['calc']['max'] ?? 99) < 15 && count($ck['calc']['err'] ?? []) === 6 && ($ck['k'] ?? 0) > 1.9
  && array_key_first($ck['hyp'] ?? []) === 'diff+loss*s' && ($ck['curPrev']['ok'] ?? 0) === 6 && ($ck['units'] ?? []) === ['Гкал'] && isset($ck['toFlat']['2026-01']['diff']), $ck);
$cb = $ck['bills'] ?? [];
ok('…квитанції тієї ж квартири против довідки (check.bills): рахунок за вересень, мітки рядків рахунку (борг, нараховано, абонплата, до сплати); сусідніх місяців у довідці нема — порівнювати нема з чим; без сум',
  ($cb['of'] ?? 0) === 1 && ($cb['months'] ?? []) === ['2026-09'] && count($cb['lines'] ?? []) === 4 && preg_match('/ПЕРЕПЛАТА.*Нараховано за послугу.*абонентське.*ДО СПЛАТИ/u', implode(' | ', $cb['lines'] ?? []))
  && ($cb['ok'] ?? []) === ['same' => 0, 'prev' => 0, 'next' => 0] && !preg_match('/245\.3|1000000061|ТЕСТОВИЙ/u', $spj), $cb);
$ow = $spm[0]['own'] ?? null;
ok('…и журнал свого лічильника («Всі записи») — к довідке этого человека (GET /api/htm/spr → own: дата, Гкал, статус); в /api/health → check.own — только счёт и % (без показаний)',
  is_array($ow) && count($ow) >= 1 && !array_filter($ow, fn($r) => !preg_match('/^\d{4}-\d\d-\d\d$/', $r['date']) || !is_float($r['energy'])) && ($ck['own']['n'] ?? 0) === count($ow)
  && !preg_match('/"energy"|"date"/', $spj), [$ow, $ck['own'] ?? null]);
// LOOK_V 5 на бою: осмотр кабинета админа дописывает журнал к УЖЕ сохранённой довідке (квартиру знает bill), не создаёт новых файлов
$sf = glob(HtmSpr::dir() . '/' . $uid . '_*.json'); $fj = json_decode(file_get_contents($sf[0]), true); unset($fj['own']); file_put_contents($sf[0], json_encode($fj));
$lf = json_decode(file_get_contents(HtmSvc::lookFile()), true); $lf['v'] = HtmSvc::LOOK_V - 1; file_put_contents(HtmSvc::lookFile(), json_encode($lf));
$lk2 = HtmSvc::lookAdmins(); $sm2 = HtmSpr::mine($uid);
ok('…осмотр кабинета админа (новая LOOK_V) — журнал свого лічильника к его довідке, квартира та же, файлов не прибавилось', $lk2 === ['ok', 'arch ok'] && count($sm2) === 1 && $sm2[0]['place'] === 'p1'
  && count($sm2[0]['own'] ?? []) === count($ow) && count(glob(HtmSpr::dir() . '/' . $uid . '_*.json')) === 1, [$lk2, $sm2]);
$c2 = HtmBills::cron($tB + 60); $hb = HtmBills::summary(); $hj = json_encode($hb, JSON_UNESCAPED_UNICODE);
ok('…через минуту — квартиру уже смотрели (раз в 20 ч): пауза, /api/health → htmBills: месяц рахунку, вид, без рахунку и людей', $c2 === [] && ($hb['last']['res'] ?? '') === 'got' && ($hb['last']['ym'] ?? '') === '2026-09' && ($hb['last']['kind'] ?? '') === 'html'
  && (array)($hb['scan']['k'] ?? []) === ['retry' => 1] && ($hb['scan']['cabs'] ?? 0) === 1 && !preg_match('/1000000061|ТЕСТОВИЙ|u1@example/u', $hj), $hb);
$c2b = HtmBills::cron($tB + 21 * 3600);
ok('…через 21 ч в кабинете тот же рахунок за вересень — same, второй раз не кладём', $c2b === [[$uid, 'same']] && count($SD()['readings'][1]['bills'] ?? []) === 1, $c2b);
// новый рахунок за жовтень, а показаний за жовтень нет → отдельная «Платіжка ХТМ» за жовтень в истории тепла
stand('act=set&scenario=ok&today=2026-11-21&robot_delay=99999&bill_ym=2026-10&bill_pay=1234.56');
Db::q('UPDATE user_state SET data = ? WHERE user_id = ?', [json_encode($stH([$plH('p1', '1000000061')], [$rdH('h3', 'p1', '2026-11-20')]), JSON_UNESCAPED_UNICODE), $uid]); @unlink(HtmBills::file());
$c3 = HtmBills::cron(gmmktime(8, 0, 0, 12, 3, 2026)); $c4 = HtmBills::cron(gmmktime(9, 0, 0, 12, 3, 2026)); $sN = $SD(); $hbr = array_values(array_filter($sN['readings'], fn($r) => !empty($r['billOnly'])));
ok('квитанции ХТМ: рахунок за жовтень, показаний за жовтень нет → «Платіжка ХТМ» (billOnly, ym 2026-10, дата 31.10) с квитанцией; запись листопада не тронута; раньше 20 ч не ходим',
  $c3 === [[$uid, 'new']] && $c4 === [] && count($hbr) === 1 && $hbr[0]['ym'] === '2026-10' && $hbr[0]['htm']['date'] === '2026-10-31' && $hbr[0]['place'] === 'p1' && ($hbr[0]['bills'][0]['pay'] ?? '') === '1234.56'
  && !isset($sN['readings'][0]['bills']), [$c3, $c4, $hbr]);
// человек убрал файл из «Платіжки» — за этот месяц больше не кладём
$sN['readings'] = array_map(function ($r) { if (!empty($r['billOnly'])) $r['bills'] = []; return $r; }, $sN['readings']); Db::q('UPDATE user_state SET data = ? WHERE user_id = ?', [json_encode($sN, JSON_UNESCAPED_UNICODE), $uid]);
$c5 = HtmBills::cron(gmmktime(8, 0, 0, 12, 4, 2026));
ok('…человек убрал квитанцию — через сутки тот же месяц не возвращаем (same)', $c5 === [[$uid, 'same']] && (array_values(array_filter($SD()['readings'], fn($r) => !empty($r['billOnly'])))[0]['bills'] ?? null) === [], $c5);
stand('act=set&scenario=ok&today=2026-11-21&robot_delay=99999&bill_ym=none');
ok('…рахунок ещё не сформован («рахунок ще не сформовано») — nobill, ничего не кладём', HtmBills::cron(gmmktime(8, 0, 0, 12, 5, 2026)) === [[$uid, 'nobill']]);
stand('act=set&scenario=ok&today=2026-11-21&robot_delay=99999&bill_ym=');
$plOff = $plH('p1', '1000000061', ['billAuto' => false]); Db::q('UPDATE user_state SET data = ? WHERE user_id = ?', [json_encode($stH([$plOff], [$rdH('h3', 'p1', '2026-11-20')]), JSON_UNESCAPED_UNICODE), $uid]); @unlink(HtmBills::file());
ok('…«Квитанції самі» выключено — не ходим', HtmBills::cron(gmmktime(8, 0, 0, 12, 4, 2026)) === [] && (array)(HtmBills::summary()['scan']['k'] ?? []) === ['off' => 1]);
Db::q('DELETE FROM rate_limits');

// «Забути пароль»: вход удалён, внесения на проверке → unknown без сообщения
stand('act=set&today=2026-11-21&robot_delay=99999');
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'r6', 'vals' => ['date' => '21.11.2026', 'energy' => '15.300', 'volume' => '2341', 'hours' => '35200', 'errHours' => '153'] + $V]); ok('ещё внесение', ($r->body['job']['status'] ?? '') === 'pending', $r->body);
$ls = HtmSvc::summary()['lastSend'] ?? []; $lj = json_encode(array_diff_key($ls, ['dateJs' => 1]), JSON_UNESCAPED_UNICODE);   // dateJs — куски скрипта страницы, как в seen
ok('…lastSend: итог внесения, окно и плашки; ни слов сайта, ни рахунку', in_array($ls['result'] ?? '', ['pending', 'unseen'], true) && is_bool($ls['flash'] ?? null) && array_key_exists('win', $ls) && isset($ls['alerts'])
  && !str_contains($lj, '1000000061') && !preg_match('/[А-Яа-яІіЇїЄє]{4,}/u', $lj), $ls);
$r = $b->req('POST', '/api/cab/forget', ['prov' => 'htm']);
ok('забыть пароль: входа нет', $r->status === 200 && $r->body['connected'] === false && !Db::one('SELECT id FROM cab_creds'), $r->body);
$jf = array_values(array_filter($r->body['jobs'], fn($j) => $j['rid'] === 'r6'))[0] ?? [];
ok('…внесение на проверке → unknown (forgot)', ($jf['status'] ?? '') === 'unknown' && $jf['why'] === 'forgot', $jf);
ok('…очередь автоподачи → cancelled', Db::one('SELECT status FROM cab_jobs WHERE id = ?', [$c7])['status'] === 'cancelled');
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'r7', 'vals' => $V]); ok('без кабинета — cab_off', $r->status === 409 && $r->body['error'] === 'cab_off', $r->body);
$b2 = new B(); $r = $b2->req('GET', '/api/cab/htm'); ok('без входа в сервис — 401', $r->status === 401);
// 125-а: кабінет іншого приладу (ГДж, Bd/Fd/Pd) — «Перевірити» каже застосунку одиницю й третій час; без Pd не вносимо; Гкал застосунку → ГДж
stand('act=reset'); stand('act=set&scenario=gj_pd&today=2026-11-21&robot_delay=99999'); Db::q('DELETE FROM rate_limits');
$r = $b->req('POST', '/api/cab/htm/connect', ['email' => 'test@stand.local', 'password' => 'stand-pass-123', 'phone' => '050 111 22 33', 'consent' => true, 'lang' => 'uk']); ok('ГДж-кабінет: підключено заново', $r->status === 200 && $r->body['connected'], $r->body);
$r = $b->req('POST', '/api/cab/htm/check', ['lang' => 'uk']);
ok('ГДж-кабінет: check → form.unit GJ, times3, forms[рахунок] = {u: GJ, t3: true}', $r->status === 200 && ($r->body['form']['unit'] ?? '') === 'GJ' && ($r->body['form']['times3'] ?? null) === true
  && (array)($r->body['forms']->{'1000000061'} ?? []) === ['u' => 'GJ', 't3' => true], $r->body['form'] ?? $r->body);
$r = $b->req('GET', '/api/cab/htm'); ok('…і в статусі (застосунок ставить «Як у вашому кабінеті» сам)', (array)($r->body['forms']->{'1000000061'} ?? []) === ['u' => 'GJ', 't3' => true], $r->body['forms'] ?? null);
$vg = ['date' => '21.11.2026', 'hours' => '35366'] + $V;
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'g1', 'vals' => $vg, 'lang' => 'uk']);
ok('…без Pd — 422 need_pd «впишіть його з лічильника»', $r->status === 422 && ($r->body['error'] ?? '') === 'cab_need_pd' && str_contains((string)($r->body['human'] ?? ''), 'Pd'), $r->body);
Db::q('DELETE FROM rate_limits');
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'g1', 'vals' => $vg + ['flowHours' => '35100', 'eunit' => 'Gcal'], 'lang' => 'uk']);
ok('…з Pd: внесено в ГДж (60.478), задача — в одиниці кабінету', $r->status === 200 && ($r->body['job']['energy'] ?? '') === '60.478' && ($r->body['job']['unit'] ?? '') === 'GJ', $r->body);
Db::q('DELETE FROM rate_limits');
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'g1', 'vals' => $vg + ['flowHours' => '35100', 'eunit' => 'Gcal'], 'lang' => 'uk']);
ok('…повтор того ж (у Гкал) — та сама задача, не вносимо вдруге', $r->status === 200 && !empty($r->body['dup']), $r->body);
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'g2', 'vals' => ['date' => '21.11.2026', 'energy' => '120.000', 'eunit' => 'GJ', 'hours' => '35366', 'flowHours' => '35100'] + $V, 'lang' => 'uk']);
ok('…приріст у ГДж: 64,5 ГДж (> 15 Гкал) — «перевірте крапку»', $r->status === 422 && ($r->body['field'] ?? '') === 'energy', $r->body);
stand('act=reset'); stand('act=set&scenario=ok');
echo "\nИтог: $pass OK, $fail FAIL\n"; exit($fail ? 1 : 0);
