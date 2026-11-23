<?php
// 186-я: пуші iPhone (APNs) — токени, JWT ES256, відправка (HTTP підмінено), Live Activity з сервера, тексти робота пушем замість Telegram. Лише синтетика.
// Запуск: php tests/push.php
declare(strict_types=1);
define('TEPLO', 1);
foreach (['core', 'telegram', 'apple', 'mail', 'reminders', 'widget', 'recognize', 'admin', 'vkcab', 'cabs', 'htmsvc', 'vksvc', 'localbot', 'gpv', 'providers', 'visits', 'journal', 'docs', 'indexnow', 'relay', 'share', 'push', 'api'] as $f) require __DIR__ . "/../app/$f.php";
BotWidget::$off = true;
$TMP = sys_get_temp_dir() . '/teplo_push_' . getmypid(); putenv('SITE_DATA=' . $TMP); @mkdir($TMP . '/cache', 0700, true);
$key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']); openssl_pkey_export($key, $PEM); $PUB = openssl_pkey_get_details($key)['key'];
$CFG = ['app_url' => 'https://teplo.example/', 'bot_token' => '123456:TEST', 'bot_username' => 'TeploTestBot', 'limits' => ['ip_all' => [5000, 60]]];
Cfg::set($CFG);
Db::set(new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC])); Db::migrate();
$TG = []; Telegram::$send = function ($m, $p) use (&$TG) { $TG[] = [$m, $p]; return ['ok' => true, 'result' => ['message_id' => 1]]; };
$SENT = []; $CODE = 200; Push::$http = function ($url, $h, $b) use (&$SENT, &$CODE) { $SENT[] = ['url' => $url, 'h' => $h, 'b' => json_decode($b, true)]; return ['code' => $CODE, 'body' => $CODE === 200 ? '' : '{"reason":"Unregistered"}']; };
$pass = 0; $fail = 0;
function ok(string $n, bool $c, $info = null): void { global $pass, $fail; echo ($c ? '  OK  ' : ' FAIL ') . $n . (!$c && $info !== null ? '  → ' . json_encode($info, JSON_UNESCAPED_UNICODE) : '') . "\n"; $c ? $pass++ : $fail++; }
$hdr = fn(array $s, string $k) => (string)(array_values(array_filter($s['h'], fn($x) => str_starts_with($x, $k . ': ')))[0] ?? '');

echo "Ключ і JWT:\n";
ok('ключа немає — не готово, пуш не йде', !Push::ready() && Push::alert(1, "a\nb") === 0 && !$SENT);
ok('перевірка ключа: Key ID не 10 знаків / не .p8 — текст помилки; справжній — null',
  Push::checkKey($PEM, 'ABC', 'TEAM123456') !== null && Push::checkKey('hello', 'KEY1234567', 'TEAM123456') !== null && Push::checkKey($PEM, 'KEY1234567', 'TEAM123456') === null);
Cfg::set($CFG + ['apns_key' => $PEM, 'apns_key_id' => 'KEY1234567', 'apns_team_id' => 'TEAM123456']);
$jwt = Push::jwt(1795000000); [$h64, $c64, $s64] = explode('.', $jwt); $d = fn($x) => base64_decode(strtr($x, '-_', '+/'));
$raw = $d($s64); $der = (function ($r) { $i = function ($x) { $x = ltrim($x, "\0"); if (ord($x[0]) & 0x80) $x = "\0" . $x; return "\x02" . chr(strlen($x)) . $x; }; $b = $i(substr($r, 0, 32)) . $i(substr($r, 32)); return "\x30" . chr(strlen($b)) . $b; })($raw);
ok('JWT: ES256, kid, iss = Team ID, iat; підпис r‖s 64 байти перевіряється відкритим ключем', json_decode($d($h64), true) === ['alg' => 'ES256', 'kid' => 'KEY1234567'] && json_decode($d($c64), true) === ['iss' => 'TEAM123456', 'iat' => 1795000000]
  && strlen($raw) === 64 && openssl_verify($h64 . '.' . $c64, $der, $PUB, OPENSSL_ALGO_SHA256) === 1);
ok('JWT 50 хв той самий (кеш), через годину — новий', Push::jwt(1795000000 + 2000) === $jwt && Push::jwt(1795000000 + 3600) !== $jwt);

echo "Токени:\n";
$A = 7; $B = 8; $t1 = str_repeat('ab', 32); $t2 = str_repeat('cd', 40);
$e = null; try { Push::save($A, ['token' => 'xyz', 'kind' => 'apns']); } catch (HttpError $x) { $e = $x->status; }
ok('поганий токен — 422', $e === 422);
ok('збережено apns (prod) і las (sandbox)', Push::save($A, ['token' => $t1, 'kind' => 'apns', 'env' => 'prod'])['ok'] && Push::save($A, ['token' => $t2, 'kind' => 'las', 'env' => 'sandbox'])['ready'] === true
  && count(Push::tokens($A, 'apns')) === 1 && Push::tokens($A, 'las')[0]['env'] === 'sandbox' && Push::has($A) && !Push::has($B));

echo "Пуш:\n";
$SENT = []; $n = Push::alert($A, "✅ ХТМ прийняв показання тепла від 2026-11-20.\n«Показання прийнято»", 'heat', 'main'); $s = $SENT[0] ?? ['h' => [], 'b' => []];
ok('пуш: api.push.apple.com/3/device/<токен>, topic застосунку, alert, заголовок — перший рядок, решта — текст, дотик — heat квартири main',
  $n === 1 && $s['url'] === 'https://api.push.apple.com/3/device/' . $t1 && $hdr($s, 'apns-topic') === 'apns-topic: ua.com.peredai.app' && $hdr($s, 'apns-push-type') === 'apns-push-type: alert'
  && str_starts_with($hdr($s, 'authorization'), 'authorization: bearer ey') && $s['b']['aps']['alert']['title'] === '✅ ХТМ прийняв показання тепла від 2026-11-20.' && $s['b']['aps']['alert']['body'] === '«Показання прийнято»'
  && $s['b']['g'] === 'heat' && $s['b']['p'] === 'main', $s);

echo "Тексти робота — пушем, не в Telegram:\n";
$SENT = []; $TG = [];
VkSvc::notify($A, ['id' => 1, 'status' => 'rejected', 'acc' => '905618', 'items' => [['name' => 'Кухня', 'value' => '176']], 'text' => 'Показання менші', 'human' => '', 'place' => 'main', 'card' => null]);
ok('Водоканал не прийняв: пуш із тим самим текстом (рахунок, лічильник), у Telegram нічого', count($SENT) === 1 && !$TG && str_contains($SENT[0]['b']['aps']['alert']['title'], 'не прийняв') && str_contains($SENT[0]['b']['aps']['alert']['body'], 'Кухня — 176') && $SENT[0]['b']['g'] === 'water-cold', [$SENT, $TG]);
Db::q("INSERT INTO user_identities (user_id, type, external_id, username, linked_at) VALUES (?, 'telegram', '555', 'b', ?)", [$B, Http::iso()]);
$SENT = []; $TG = [];
VkSvc::notify($B, ['id' => 2, 'status' => 'rejected', 'acc' => '905618', 'items' => [['name' => 'Кухня', 'value' => '176']], 'text' => '', 'human' => '', 'place' => 'main', 'card' => null]);
ok('людина без iPhone (лише Telegram) — як було: повідомлення в Telegram, пушу немає', !$SENT && count($TG) === 1 && $TG[0][1]['chat_id'] === '555');

echo "Live Activity з сервера:\n";
$pl = Push::laPayload('water16', 'uk', [['id' => 'main', 'label' => 'Мамина'], ['id' => 'p2', 'label' => 'Гараж']], '2026-11-16', 1795000000);
$due = (new DateTimeImmutable('2026-11-20 00:00', new DateTimeZone('Europe/Kyiv')))->getTimestamp() - 978307200;
ok('push-to-start: event start, WindowActivityAttributes, підписи uk, елементи — холодна вода обох квартир до 20-го (Date — від 2001 р.), маршрут water-cold',
  $pl['aps']['event'] === 'start' && $pl['aps']['attributes-type'] === 'WindowActivityAttributes' && $pl['aps']['attributes'] === ['title' => 'Відкрите вікно передачі', 'goLabel' => 'Зняти показання', 'doneLabel' => 'Передано']
  && count($pl['aps']['content-state']['items']) === 2 && $pl['aps']['content-state']['items'][0] === ['id' => 'main|cold', 'kind' => 'cold', 'title' => 'Вода', 'place' => 'Мамина', 'placeId' => 'main', 'due' => $due, 'done' => false, 'pay' => false, 'route' => 'water-cold']
  && $pl['aps']['content-state']['updatedAt'] === 1795000000 - 978307200 && $pl['aps']['alert']['body'] === 'Вода · Мамина', $pl);
ok('вивіз сміття (оплата) — без Live Activity; ru — підписи російською', Push::laPayload('waste10', 'uk', [['id' => 'main']], '2026-11-10', 1) === null && Push::laPayload('heat21', 'ru', [['id' => 'main', 'label' => 'Дом']], '2026-11-21', 1)['aps']['attributes']['title'] === 'Открыто окно передачи');
$st = ['places' => [['id' => 'main', 'name' => 'Мамина', 'meter' => ['modelId' => 'sharky774'], 'water' => ['meters' => [['id' => 'h1', 'kind' => 'hot']]]]],
  'readings' => [['id' => 'r1', 'htm' => ['date' => '2026-11-06', 'energy' => '10']]], 'water' => [['id' => 'b', 'place' => 'main', 'date' => '2026-11-01', 'base' => true, 'vals' => ['h1' => '5']]]];
Db::q('INSERT INTO user_state (user_id, data, version, updated_at) VALUES (?, ?, 1, ?)', [$A, json_encode($st, JSON_UNESCAPED_UNICODE), Http::iso()]);
$at = (new DateTimeImmutable('2026-11-16 12:17', new DateTimeZone('Europe/Kyiv')))->getTimestamp();
$SENT = []; $r1 = Push::runLive($at); $s = $SENT[0] ?? ['h' => [], 'b' => []];
ok('16-го о 12:17: токен las — Live Activity (topic …push-type.liveactivity, sandbox), квартира «Мамина» лише з гарячою — на water-hot', $r1 === [[$A, 'water16', 'ok']] && count($SENT) === 1
  && str_starts_with($s['url'], 'https://api.sandbox.push.apple.com/3/device/' . $t2) && $hdr($s, 'apns-topic') === 'apns-topic: ua.com.peredai.app.push-type.liveactivity' && $hdr($s, 'apns-push-type') === 'apns-push-type: liveactivity'
  && ($s['b']['aps']['content-state']['items'][0]['place'] ?? '') === 'Мамина' && ($s['b']['aps']['content-state']['items'][0]['route'] ?? '') === 'water-hot', [$r1, $s]);
$SENT = []; ok('за годину — не вдруге (push_sent); о 8:00 — нічого', Push::runLive($at + 3600) === [] && !$SENT && Push::runLive((new DateTimeImmutable('2026-11-16 08:00', new DateTimeZone('Europe/Kyiv')))->getTimestamp()) === []);

echo "Токен зник:\n";
$CODE = 410; $SENT = [];
ok('APNs 410 Unregistered — токен позначено, наступний пуш не йде', Push::alert($A, 'x') === 0 && count($SENT) === 1 && !Push::tokens($A, 'apns') && !Push::has($A));
$CODE = 200;
ok('той самий телефон знову надіслав токен — живий', Push::save($A, ['token' => $t1, 'kind' => 'apns'])['ok'] && Push::has($A));
ok('/api/health → push: лише числа', (function () { $s = Push::summary(); return $s['ready'] === true && $s['tokens']['apns prod']['n'] === 1 && $s['tokens']['las sandbox']['n'] === 1 && ($s['la']['ok'] ?? 0) == 1; })(), Push::summary());
Push::forget($A); ok('вийшов з акаунта — токенів немає', !Push::tokens($A, 'apns') && !Push::tokens($A, 'las'));

@array_map('unlink', glob($TMP . '/cache/*') ?: []);
echo "\nИтог: $pass OK, $fail FAIL\n";
exit($fail ? 1 : 0);
