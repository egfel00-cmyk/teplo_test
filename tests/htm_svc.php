<?php
// Сервис автоподачи ХТМ (HtmSvc) через API против стенда tests/htm-mock: подключить, проверить, внести, перепроверка журнала cron, «Забути пароль».
// Запуск: стенд на 127.0.0.1:8099 (скопировать tests/htm-mock во /tmp, php -S 127.0.0.1:8099 -t public public/router.php), затем php tests/htm_svc.php
declare(strict_types=1);
define('TEPLO', 1);
foreach (['core', 'telegram', 'reminders', 'recognize', 'admin', 'vkcab', 'cabs', 'htmsvc', 'vksvc', 'gpv', 'providers', 'visits', 'journal', 'docs', 'api'] as $f) require __DIR__ . "/../app/$f.php";
$TMP = sys_get_temp_dir() . '/teplo_htmsvc_' . getmypid(); putenv('SITE_DATA=' . $TMP);
$BASE = getenv('HTM_BASE') ?: 'http://127.0.0.1:8099';
Cfg::set(['app_url' => 'https://teplo.example/', 'bot_token' => '1:TEST', 'htm_cab_base' => $BASE, 'cookie_secure' => false]);
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
stand('act=reset'); stand('act=set&scenario=ok&today=2026-11-10&robot_delay=99999');
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
stand('act=set&scenario=ok&today=2026-11-21&robot_delay=99999'); Db::q('DELETE FROM rate_limits');

// «Забути пароль»: вход удалён, внесения на проверке → unknown без сообщения
stand('act=set&today=2026-11-21&robot_delay=99999');
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'r6', 'vals' => ['date' => '21.11.2026', 'energy' => '15.300', 'volume' => '2341', 'hours' => '35200', 'errHours' => '153'] + $V]); ok('ещё внесение', ($r->body['job']['status'] ?? '') === 'pending', $r->body);
$r = $b->req('POST', '/api/cab/forget', ['prov' => 'htm']);
ok('забыть пароль: входа нет', $r->status === 200 && $r->body['connected'] === false && !Db::one('SELECT id FROM cab_creds'), $r->body);
$jf = array_values(array_filter($r->body['jobs'], fn($j) => $j['rid'] === 'r6'))[0] ?? [];
ok('…внесение на проверке → unknown (forgot)', ($jf['status'] ?? '') === 'unknown' && $jf['why'] === 'forgot', $jf);
ok('…очередь автоподачи → cancelled', Db::one('SELECT status FROM cab_jobs WHERE id = ?', [$c7])['status'] === 'cancelled');
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'r7', 'vals' => $V]); ok('без кабинета — cab_off', $r->status === 409 && $r->body['error'] === 'cab_off', $r->body);
$b2 = new B(); $r = $b2->req('GET', '/api/cab/htm'); ok('без входа в сервис — 401', $r->status === 401);
stand('act=reset'); stand('act=set&scenario=ok');
echo "\nИтог: $pass OK, $fail FAIL\n"; exit($fail ? 1 : 0);
