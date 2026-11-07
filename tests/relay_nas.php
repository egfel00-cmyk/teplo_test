<?php
// Ретранслятор целиком: наш сервер (127.0.0.1:8013) ↔ настоящий sh-сценарий из /admin ↔ синтетический сайт обленерго (127.0.0.1:8097).
// Нужно: SITE_BASE= SITE_DATA=/tmp/teplo_data php -S 127.0.0.1:8013 index.php ; php -S 127.0.0.1:8097 tests/obl-mock/router.php ;
// в /tmp/teplo_data/config.php — sqlite, admins boss@teplo.test, relay_prefixes ['http://127.0.0.1:8097/'], relay_url_form / relay_url_obl на стенд.
// Запуск: php tests/relay_nas.php [sh|dash|busybox sh]
$SRV = 'http://127.0.0.1:8013'; $MOCK = 'http://127.0.0.1:8097'; $SH = $argv[1] ?? 'sh';
$pass = 0; $fail = 0;
function ok(string $n, bool $c, $i = null): void { global $pass, $fail; echo ($c ? '  OK  ' : ' FAIL ') . $n . (!$c && $i !== null ? '  → ' . json_encode($i, JSON_UNESCAPED_UNICODE) : '') . "\n"; $c ? $pass++ : $fail++; }
$jar = tempnam('/tmp', 'rj'); $csrf = '';
function api(string $m, string $p, ?array $b = null): array {
  global $SRV, $jar, $csrf; $c = curl_init($SRV . $p);
  curl_setopt_array($c, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CUSTOMREQUEST => $m, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_HEADER => true,
    CURLOPT_HTTPHEADER => array_merge(['Content-Type: application/json'], $csrf ? ['X-CSRF: ' . $csrf] : [])] + ($b !== null ? [CURLOPT_POSTFIELDS => json_encode($b)] : []));
  $r = curl_exec($c); $hs = curl_getinfo($c, CURLINFO_HEADER_SIZE); $code = curl_getinfo($c, CURLINFO_RESPONSE_CODE);
  if (preg_match('/ts_csrf=([0-9a-f]+)/', substr($r, 0, $hs), $m2)) $csrf = $m2[1];
  return ['code' => $code] + (json_decode(substr($r, $hs), true) ?: []);
}
function mock(string $p): string { global $MOCK; return (string)file_get_contents($MOCK . $p); }
function runNas(string $script, int $secs = 14): string {
  global $SH; $f = '/tmp/relay_nas_test.sh';
  file_put_contents($f, str_replace('-lt 50 ]', "-lt $secs ]", $script));
  @exec('rm -rf /tmp/lichylnyky/lock'); exec("$SH $f 2>&1", $o, $rc); return implode("\n", $o) . " rc=$rc";
}
function job(int $id): ?array { foreach (api('GET', '/api/admin/relay')['jobsList'] ?? [] as $j) if ($j['id'] === $id) return $j; return null; }

api('GET', '/api/config');
$r = api('POST', '/api/auth/register', ['email' => 'boss@teplo.test', 'password' => 'Boss-12345678']);
if ($r['code'] !== 200) $r = api('POST', '/api/auth/login', ['email' => 'boss@teplo.test', 'password' => 'Boss-12345678']);
ok('вход админа', $r['code'] === 200, $r);
api('POST', '/api/admin/relay/resume');
mock('/__scn?s=ok');

echo "\n— токен → сценарий → первое задание: проба формы и кабинета с «украинского» адреса\n";
$a = api('POST', '/api/admin/relay/token');
ok('токен создан, сценарий с ним', !empty($a['on']) && is_string($a['script']) && str_contains($a['script'], "K='") && str_contains($a['script'], 'http://127.0.0.1:8097/'), array_intersect_key($a, ['on' => 1, 'code' => 1]));
$probe = $a['jobsList'][0] ?? null;
ok('в очереди — проба', $probe && $probe['kind'] === 'probe' && $probe['state'] === 'new', $probe);
$h = json_decode((string)file_get_contents($SRV . '/api/health'), true)['relay'] ?? [];
ok('/api/health → relay: on, без токена и рахунков', $h['on'] === true && !str_contains(json_encode($h), $a['script'] ? substr(explode("K='", $a['script'])[1], 0, 40) : 'x') && !str_contains(json_encode($h), '1234567'), $h);
$out = runNas($a['script']);
$j = job($probe['id']);
ok('проба выполнена NAS-ом: форма ok, кабинет ok', $j['state'] === 'done' && ($j['result']['form'] ?? '') === 'ok' && ($j['result']['obl'] ?? '') === 'ok', [$j, $out]);
ok('план формы: рахунок, показання, согласие; лишнего нет', ($j['result']['plan']['ok'] ?? false) && in_array('acc', $j['result']['plan']['roles'] ?? [], true) && in_array('all', $j['result']['plan']['roles'] ?? [], true) && in_array('consent', $j['result']['plan']['roles'] ?? [], true), $j['result']['plan'] ?? null);
$up = json_decode((string)file_get_contents($SRV . '/api/health'), true);
ok('uaProbe обновлена: via relay', ($up['uaProbe']['form']['via'] ?? '') === 'relay' && ($up['uaProbe']['obl']['verdict'] ?? '') === 'ok', $up['uaProbe'] ?? null);
ok('NAS на связи, версия сценария 1', ($up['relay']['online'] ?? false) === true && ($up['relay']['v'] ?? 0) === 1, $up['relay'] ?? null);

echo "\n— сухая проверка: заполнили бы форму, но не отправили\n";
$d = api('POST', '/api/admin/relay/dry', ['acc' => '1234567', 'zones' => ['all' => '10420']]);
ok('задание создано', ($d['ok'] ?? false) === true, $d);
@unlink('/tmp/obl_mock_last.json'); runNas($a['script'], 8); $j = job($d['id']);
$pairs = []; foreach ($j['result']['pairs'] ?? [] as [$k, $v]) $pairs[$k] = $v;
ok('пары: CSRF, рахунок, показання, согласие, кнопка', $j['state'] === 'done' && ($pairs['MeterForm[account]'] ?? '') === '1234567' && ($pairs['MeterForm[value]'] ?? '') === '10420' && ($pairs['MeterForm[agree]'] ?? '') === '1' && strlen($pairs['_csrf'] ?? '') === 16 && ($pairs['send'] ?? '') === '1', $j);
ok('на сайт ничего не отправлено', !is_file('/tmp/obl_mock_last.json'));

echo "\n— подача: окно закрыто → отказ; force → GET, POST, редирект → «прийнято»\n";
$w = api('POST', '/api/admin/relay/send', ['acc' => '1234567', 'zones' => ['all' => '10420']]);
$winOpen = !empty(api('GET', '/api/admin/relay')['win']);
ok('вне окна — 409 window_closed (или окно открыто)', $winOpen ? ($w['ok'] ?? false) : ($w['code'] === 409 && $w['error'] === 'window_closed'), $w);
if (!$winOpen) $w = api('POST', '/api/admin/relay/send', ['acc' => '1234567', 'zones' => ['all' => '10420'], 'force' => 1]);
ok('подача в очереди', ($w['ok'] ?? false) === true, $w);
$b = api('POST', '/api/admin/relay/send', ['acc' => '7654321', 'zones' => ['all' => '1'], 'force' => 1]);
ok('вторая подача, пока первая не прошла — 409 busy', $b['code'] === 409 && $b['error'] === 'busy', $b);
runNas($a['script'], 10); $j = job($w['id']); $last = json_decode(mock('/__last'), true);
ok('сайт получил POST: рахунок, цифры, согласие, CSRF и cookie сессии', ($last['post']['MeterForm']['account'] ?? '') === '1234567' && ($last['post']['MeterForm']['value'] ?? '') === '10420' && ($last['post']['MeterForm']['agree'] ?? '') === '1' && in_array('PHPSESSID', $last['cookie'] ?? [], true), $last);
ok('честный UA, Referer, Origin, urlencoded', str_contains($last['ua'] ?? '', 'Lichylnyky') && str_contains($last['ref'] ?? '', '/uk/transmissionofmeterreadings') && ($last['origin'] ?? '') === 'http://127.0.0.1:8097' && str_contains($last['ct'] ?? '', 'urlencoded'), $last);
ok('итог — прийнято, текст сайта', $j['state'] === 'done' && str_contains((string)($j['result']['msg'] ?? ''), 'прийнято'), $j);
ok('шаги: GET 200 → POST 302 → GET 200', array_column($j['log'], 'code') === [200, 302, 200] && array_column($j['log'], 'm') === ['GET', 'POST', 'GET'], $j['log']);

echo "\n— не чаще раза в минуту; ошибка в данных — только это задание\n";
$e = api('POST', '/api/admin/relay/send', ['acc' => '000000', 'zones' => ['all' => '5'], 'force' => 1]);
runNas($a['script'], 6); $j = job($e['id']);
ok('сразу после подачи — ждёт (GAP 60 с)', $j['state'] === 'new' && (int)$j['step'] === 0, $j);
if (getenv('RELAY_FULL')) {
  sleep(55); runNas($a['script'], 12); $j = job($e['id']);
  ok('сайт: «рахунок не знайдено» → site_err, без паузы', $j['state'] === 'fail' && $j['err'] === 'site_err' && str_contains((string)($j['result']['msg'] ?? ''), 'не знайдено') && empty(api('GET', '/api/admin/relay')['paused']), $j);
}
echo "\n— стоп на первом отказе: Cloudflare → пауза; NAS не открывает адрес не из своего списка\n";
$st = api('GET', '/api/admin/relay');
// чтобы не ждать минуту: снимаем ожидающую подачу и шлём сухую проверку (сухая — без GAP)
mock('/__scn?s=cf'); $c = api('POST', '/api/admin/relay/dry', ['acc' => '1234567', 'zones' => ['all' => '1']]);
foreach ($st['jobsList'] as $x) if ($x['state'] === 'new' && $x['kind'] === 'send') { /* ждёт GAP — не мешает dry */ }
runNas($a['script'], 6); $j = job($c['id']);
ok('Cloudflare → fail cloudflare + пауза', $j['state'] === 'fail' && $j['err'] === 'cloudflare' && (api('GET', '/api/admin/relay')['paused']['why'] ?? '') === 'cloudflare', $j);
$p = api('POST', '/api/admin/relay/send', ['acc' => '1234567', 'zones' => ['all' => '1'], 'force' => 1]);
ok('на паузе подача не принимается — 409 relay_paused', $p['code'] === 409 && $p['error'] === 'relay_paused', $p);
api('POST', '/api/admin/relay/resume'); mock('/__scn?s=captcha');
$c = api('POST', '/api/admin/relay/dry', ['acc' => '1234567', 'zones' => ['all' => '1']]); runNas($a['script'], 6); $j = job($c['id']);
ok('капча на форме → fail captcha + пауза', $j['state'] === 'fail' && $j['err'] === 'captcha', $j);
api('POST', '/api/admin/relay/resume'); mock('/__scn?s=twozone');
$c = api('POST', '/api/admin/relay/dry', ['acc' => '1234567', 'zones' => ['all' => '1']]); runNas($a['script'], 6); $j = job($c['id']);
ok('двозонна форма, а цифра одна → missing (day/night), пауза', $j['state'] === 'fail' && $j['err'] === 'missing', $j['result'] ?? $j);
api('POST', '/api/admin/relay/resume');
$c = api('POST', '/api/admin/relay/dry', ['acc' => '1234567', 'zones' => ['day' => '100', 'night' => '50']]); runNas($a['script'], 6); $j = job($c['id']);
$pairs = []; foreach ($j['result']['pairs'] ?? [] as [$k, $v]) $pairs[$k] = $v;
ok('день и ніч — в свои поля', $j['state'] === 'done' && ($pairs['MeterForm[day]'] ?? '') === '100' && ($pairs['MeterForm[night]'] ?? '') === '50', $j);
// адрес вне списка NAS: сервер его разрешает (новый префикс), сценарий — старый → отказ NAS
$cfg = file_get_contents('/tmp/teplo_data/config.php');
file_put_contents('/tmp/teplo_data/config.php', str_replace("'relay_url_form' => 'http://127.0.0.1:8097/", "'relay_url_form' => 'http://localhost:8097/", str_replace("'relay_prefixes' => ['http://127.0.0.1:8097/']", "'relay_prefixes' => ['http://127.0.0.1:8097/', 'http://localhost:8097/']", $cfg)));
mock('/__scn?s=ok'); @unlink('/tmp/obl_mock_last.json'); sleep(3);   // opcache php -S перечитывает config.php не чаще раза в 2 с
$c = api('POST', '/api/admin/relay/dry', ['acc' => '1234567', 'zones' => ['all' => '1']]); runNas($a['script'], 6); $j = job($c['id']);
file_put_contents('/tmp/teplo_data/config.php', $cfg); sleep(3);
ok('NAS отказался открыть адрес не из своего списка → nas_refused + пауза', $j['state'] === 'fail' && $j['err'] === 'nas_refused' && (api('GET', '/api/admin/relay')['paused']['why'] ?? '') === 'nas_refused', $j);
api('POST', '/api/admin/relay/resume');

echo "\n— неверный ключ: 403, сценарий выходит\n";
$bad = preg_replace("/K='[0-9a-f]+'/", "K='deadbeef'", $a['script']); $t0 = time(); $o = runNas($bad, 14);
ok('сценарий с чужим ключом сразу выходит', time() - $t0 < 5, $o);
foreach (api('GET', '/api/admin/relay')['jobsList'] as $x) if ($x['state'] === 'new') {}
echo "\nИтог: $pass OK, $fail FAIL\n";
exit($fail ? 1 : 0);
