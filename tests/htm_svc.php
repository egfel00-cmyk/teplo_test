<?php
// Сервис автоподачи ХТМ (HtmSvc) через API против стенда tests/htm-mock: подключить, проверить, внести, перепроверка журнала cron, «Забути пароль».
// Запуск: стенд на 127.0.0.1:8099 (скопировать tests/htm-mock во /tmp, php -S 127.0.0.1:8099 -t public public/router.php), затем php tests/htm_svc.php
declare(strict_types=1);
define('TEPLO', 1);
foreach (['core', 'telegram', 'reminders', 'recognize', 'admin', 'vkcab', 'cabs', 'htmsvc', 'gpv', 'providers', 'visits', 'journal', 'docs', 'api'] as $f) require __DIR__ . "/../app/$f.php";
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

// «Забути пароль»: вход удалён, внесения на проверке → unknown без сообщения
stand('act=set&today=2026-11-21&robot_delay=99999');
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'r6', 'vals' => ['date' => '21.11.2026', 'energy' => '15.300', 'volume' => '2341', 'hours' => '35200', 'errHours' => '153'] + $V]); ok('ещё внесение', ($r->body['job']['status'] ?? '') === 'pending', $r->body);
$r = $b->req('POST', '/api/cab/forget', ['prov' => 'htm']);
ok('забыть пароль: входа нет', $r->status === 200 && $r->body['connected'] === false && !Db::one('SELECT id FROM cab_creds'), $r->body);
ok('…внесение на проверке → unknown (forgot)', ($r->body['jobs'][0]['status'] ?? '') === 'unknown' && $r->body['jobs'][0]['why'] === 'forgot', $r->body['jobs'][0] ?? null);
$r = $b->req('POST', '/api/cab/htm/send', ['rid' => 'r7', 'vals' => $V]); ok('без кабинета — cab_off', $r->status === 409 && $r->body['error'] === 'cab_off', $r->body);
$b2 = new B(); $r = $b2->req('GET', '/api/cab/htm'); ok('без входа в сервис — 401', $r->status === 401);
stand('act=reset'); stand('act=set&scenario=ok');
echo "\nИтог: $pass OK, $fail FAIL\n"; exit($fail ? 1 : 0);
