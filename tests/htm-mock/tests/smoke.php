<?php
// Smoke-тест стенда v2 по контракту снятия 01.11.2026. Запуск: php tests/smoke.php [http://127.0.0.1:8099]
declare(strict_types=1);
$base = rtrim($argv[1] ?? 'http://127.0.0.1:8099', '/');
$jar = tempnam(sys_get_temp_dir(), 'jar'); $pass = 0; $fail = 0;
const ACC = '1000000061'; const SN = '70000061';
$SUR = rawurlencode('ТЕСТОВИЙ'); $HEAT = "/cabinet/heat/" . ACC . "/$SUR";

function req(string $m, string $path, ?array $post = null, array $hdr = [], bool $follow = true): array {
  global $base, $jar;
  $ch = curl_init($base . $path);
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_FOLLOWLOCATION => $follow, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar]);
  $h = []; foreach ($hdr as $k => $v) $h[] = "$k: $v";
  if ($post !== null) {
    // тело — в windows-1251, как отправит адаптер
    $body = http_build_query(array_map(fn($v) => mb_convert_encoding((string)$v, 'Windows-1251', 'UTF-8'), $post));
    curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $h[] = 'Content-Type: application/x-www-form-urlencoded';
  }
  if ($h) curl_setopt($ch, CURLOPT_HTTPHEADER, $h);
  $r = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); $hl = curl_getinfo($ch, CURLINFO_HEADER_SIZE); curl_close($ch);
  $headers = substr((string)$r, 0, $hl);
  $raw = substr((string)$r, $hl);
  return ['code' => $code, 'headers' => $headers, 'raw' => $raw, 'body' => mb_convert_encoding($raw, 'UTF-8', 'Windows-1251')];
}
function ok(string $n, bool $c, string $info = ''): void { global $pass, $fail; echo ($c ? "  OK  " : " FAIL ") . $n . ($c || !$info ? '' : "  → $info") . "\n"; $c ? $pass++ : $fail++; }
function login(): array { return req('POST', '/cabinet/login', ['email' => 'test@stand.local', 'passw' => 'stand-pass-123', 'email-signin' => '']); }
$OPEN = ['X-Mock-Today' => date('Y-m-') . '10'];

echo "Стенд v2: $base\n";
req('POST', '/stand/admin', ['act' => 'reset']); req('POST', '/stand/admin', ['act' => 'clear']);
ok('health', req('GET', '/stand/health')['body'] === 'ok');

$r = req('GET', '/cabinet/login');
ok('кодировка windows-1251', stripos($r['headers'], 'charset=windows-1251') !== false);
ok('форма входа: поля email/passw/rash/lastn', str_contains($r['body'], 'name="email"') && str_contains($r['body'], 'name="passw"') && str_contains($r['body'], 'name="rash"') && str_contains($r['body'], 'name="lastn"'));
ok('плашка ТЕСТОВИЙ СТЕНД и noindex', str_contains($r['body'], 'ТЕСТОВИЙ СТЕНД') && stripos($r['headers'], 'X-Robots-Tag: noindex') !== false);

$r = req('POST', '/cabinet/login', ['rash' => ACC, 'lastn' => 'Тестовий', 'acc-signin' => '']);
ok('вход по счёту закрыт после регистрации', str_contains($r['body'], 'stand-account-login-closed'));
$r = req('POST', '/cabinet/login', ['email' => 'test@stand.local', 'passw' => 'wrong', 'email-signin' => ''], ['X-Mock-Scenario' => 'bad_credentials']);
ok('bad_credentials → ошибка', str_contains($r['body'], 'stand-login-error'));

$r = login();
ok('вход email+пароль → маркер a[href=/cabinet/logout]', str_contains($r['body'], 'href="/cabinet/logout"'));
ok('title содержит «Стан особового рахунку»', str_contains($r['body'], 'Стан особового рахунку'));
ok('cookie CABSESSID', str_contains((string)file_get_contents($jar), 'CABSESSID'));

$r = req('GET', '/cabinet/list');
ok('список квартир → ссылка на /cabinet/{ACCOUNT}/{SURNAME}', str_contains($r['body'], '/cabinet/' . ACC . '/' . $SUR));

$r = req('GET', $HEAT, null, ['X-Mock-Today' => date('Y-m-') . '28']);
ok('после 25-го: тега <form> нет, текст «тимчасово зупинений»', !str_contains($r['body'], '<form') && str_contains($r['body'], 'тимчасово зупинений'));
ok('заголовок прибора «ПУ Sharky 774, №…»', (bool)preg_match('/ПУ Sharky 774, №\s*(\d+)/u', $r['body']));
ok('база: id head_LastValuePok', str_contains($r['body'], 'id="head_LastValuePok"'));

$r = req('GET', $HEAT, null, $OPEN);
ok('10-е: форма открыта, поле #LastDtPok, min_date', str_contains($r['body'], 'id="LastDtPok"') && str_contains($r['body'], 'var min_date'));

$d = date('Y-m-') . '10'; $base10 = (new DateTime(date('Y-m-01')))->modify('-1 month')->format('Y-m-20');
$days = (int)((strtotime($d) - strtotime($base10)) / 86400);
$good = ['LastDtPok' => date('10.m.Y'), 'LastValuePok' => '14.100', 'LastRashPok' => '2440.000', 'HeatRash' => '0.600', 'HeatPower' => '3.489', 'TempPod' => '55.00', 'TempO' => '50.00',
  'LastTimePok' => (string)(34598 + $days * 24), 'ErrorTime' => '153', 'ErrorKod' => 'E---', 'Phone' => '0500000000', 'Email' => 'test@stand.local', 'Note' => 'тест', 'save-pok' => ''];
$bad = $good; $bad['LastValuePok'] = '14,100';
$r = req('POST', $HEAT, $bad, $OPEN);
ok('запятая → .alert-danger.flash «крапка»', str_contains($r['body'], 'alert-danger flash') && str_contains($r['body'], 'крапка'));
$r = req('POST', $HEAT, $good, $OPEN + ['X-Mock-Robot-Delay' => '3600']);
ok('сохранено → .alert-success.flash, статус «очікують перевірки»', str_contains($r['body'], 'stand-saved') && str_contains($r['body'], 'очікують перевірки'));
$r = req('GET', $HEAT, null, $OPEN + ['X-Mock-Robot-Delay' => '0']);
ok('робот: принято → td.bg-success и «успішно додані»', str_contains($r['body'], 'class="bg-success"') && str_contains($r['body'], 'Показання успішно додані в базу даних.'));

// отклонение: часы не по календарю, редактирование последней записи той же датой
$bad2 = $good; $bad2['LastTimePok'] = (string)(34598 + 10);
req('POST', $HEAT, $bad2, $OPEN + ['X-Mock-Robot-Delay' => '3600']);
$r = req('GET', "/cabinet/heat/viewall/" . ACC . "/$SUR/" . SN, null, $OPEN + ['X-Mock-Robot-Delay' => '0']);
ok('робот: отклонено → td.bg-danger и «не принйяті … має бути не більше 24»', str_contains($r['body'], 'class="bg-danger"') && (bool)preg_match('/не\s+при[йн]{1,2}яті.*має бути не більше 24/u', $r['body']));

$r = req('GET', $HEAT, null, $OPEN + ['X-Mock-Scenario' => 'markup_changed']);
ok('markup_changed → LastValuePok_v2', str_contains($r['body'], 'LastValuePok_v2'));
$r = req('GET', '/cabinet', null, ['X-Mock-Scenario' => 'session_expired'], false);
ok('session_expired → редирект на /cabinet/login', $r['code'] === 302 && stripos($r['headers'], 'Location: /cabinet/login') !== false);
ok('server_500', req('GET', '/cabinet/login', null, ['X-Mock-Scenario' => 'server_500'])['code'] === 500);
req('GET', '/cabinet/logout');
$r = req('GET', '/cabinet/login', null, ['X-Mock-Scenario' => 'captcha']);
ok('captcha → виджет на странице входа', str_contains($r['body'], 'stand-captcha'));
ok('журнал запросов без паролей', !str_contains(req('GET', '/stand/journal')['raw'], 'stand-pass-123'));

@unlink($jar);
echo "\nИтог: $pass OK, $fail FAIL\n";
exit($fail ? 1 : 0);
