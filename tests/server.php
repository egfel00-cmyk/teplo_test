<?php
// Тесты сервера без веб-сервера и без зависимостей, только синтетика. Запуск: php tests/server.php
declare(strict_types=1);
define('TEPLO', 1);
require __DIR__ . '/../app/core.php';
require __DIR__ . '/../app/telegram.php';
require __DIR__ . '/../app/recognize.php';
require __DIR__ . '/../app/admin.php';
require __DIR__ . '/../app/api.php';
$TMP = sys_get_temp_dir() . '/teplo_test_' . getmypid(); putenv('SITE_DATA=' . $TMP);

$TOKEN = '123456:TEST-TOKEN-not-real';
Cfg::set(['app_url' => 'https://teplo.example/', 'bot_token' => $TOKEN, 'bot_username' => 'TeploTestBot', 'webhook_secret' => 'hook-secret', 'anthropic_api_key' => 'test-key',
  'limits' => ['ip_all' => [1000, 60], 'login_ip' => [10, 300], 'login_fail_acc' => [5, 900], 'register_ip' => [5, 3600], 'telegram_ip' => [30, 300], 'state_user' => [60, 60], 'recog_upload' => [120, 3600], 'recog_run' => [40, 86400], 'feedback_ip' => [3, 3600]], 'admins' => ['emails' => ['boss@example.ua'], 'telegram' => []]]);
Db::set(new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC])); Db::migrate();

$pass = 0; $fail = 0;
function ok(string $n, bool $c, $info = null): void { global $pass, $fail; echo ($c ? '  OK  ' : ' FAIL ') . $n . (!$c && $info !== null ? '  → ' . json_encode($info, JSON_UNESCAPED_UNICODE) : '') . "\n"; $c ? $pass++ : $fail++; }

/** Мини-браузер: держит cookie, шлёт X-CSRF, как sync.js. */
final class Browser {
  public array $jar = []; public string $ip;
  public function __construct(string $ip = '10.0.0.1') { $this->ip = $ip; }
  public function req(string $m, string $path, ?array $body = null, array $extraServer = [], bool $csrf = true, ?string $raw = null): Res {
    if (empty($this->jar['ts_csrf'])) { $r0 = Api::handle(new Req('GET', '/api/config', ['REMOTE_ADDR' => $this->ip], $this->jar)); $this->take($r0); }
    $server = ['REMOTE_ADDR' => $this->ip, 'HTTP_USER_AGENT' => 'test'] + $extraServer;
    if ($csrf && $m !== 'GET') $server['HTTP_X_CSRF'] = $this->jar['ts_csrf'] ?? '';
    $res = Api::handle(new Req($m, $path, $server, $this->jar, $raw ?? ($body === null ? '' : json_encode($body))));
    $this->take($res); return $res;
  }
  private function take(Res $r): void { foreach ($r->cookies as [$n, $v, $o]) { if ($o['expires'] < time()) unset($this->jar[$n]); else $this->jar[$n] = $v; } }
}
function initData(string $token, array $user, ?int $authDate = null, bool $tamper = false): string {
  $p = ['auth_date' => (string)($authDate ?? time()), 'query_id' => 'AAH', 'user' => json_encode($user)];
  ksort($p); $dcs = implode("\n", array_map(fn($k) => "$k=" . $p[$k], array_keys($p)));
  $p['hash'] = hash_hmac('sha256', $dcs, hash_hmac('sha256', $token, 'WebAppData', true));
  if ($tamper) $p['user'] = json_encode(['id' => 999] + $user);
  return http_build_query($p);
}
function widget(string $token, array $u): array {
  $p = $u + ['auth_date' => (string)time()]; ksort($p);
  $dcs = implode("\n", array_map(fn($k) => "$k=" . $p[$k], array_keys($p)));
  $p['hash'] = hash_hmac('sha256', $dcs, hash('sha256', $token, true)); return $p;
}

echo "Подписи Telegram:\n";
$u = ['id' => 777001, 'first_name' => 'Микола', 'username' => 'reva_test', 'language_code' => 'uk'];
ok('Mini App: верная подпись принимается', Telegram::verifyWebApp(initData($TOKEN, $u), $TOKEN)['id'] === '777001');
foreach (['подменённый пользователь' => initData($TOKEN, $u, null, true), 'чужой токен' => initData('999:OTHER', $u), 'старше суток' => initData($TOKEN, $u, time() - 90000)] as $n => $d) {
  try { Telegram::verifyWebApp($d, $TOKEN); ok("Mini App: $n — отказ", false); } catch (HttpError $e) { ok("Mini App: $n — отказ ($e->err)", true); }
}
ok('Login Widget: верная подпись', Telegram::verifyWidget(widget($TOKEN, ['id' => '777001', 'first_name' => 'Микола', 'username' => 'reva_test']), $TOKEN)['username'] === 'reva_test');
try { $w = widget($TOKEN, ['id' => '777001', 'first_name' => 'Микола']); $w['id'] = '1'; Telegram::verifyWidget($w, $TOKEN); ok('Login Widget: подмена id — отказ', false); } catch (HttpError $e) { ok('Login Widget: подмена id — отказ', true); }

echo "\nВход по паролю и CSRF:\n";
$phone = new Browser('10.0.0.1');
$r = $phone->req('POST', '/api/auth/register', ['email' => 'a@b.ua', 'password' => 'short']);
ok('слабый пароль → 422', $r->status === 422 && $r->body['error'] === 'weak_password');
$r = $phone->req('POST', '/api/auth/register', ['email' => 'Reva@Example.ua', 'password' => 'correct horse 1'], [], false);
ok('без X-CSRF → 403', $r->status === 403 && $r->body['error'] === 'csrf');
$r = $phone->req('POST', '/api/auth/register', ['email' => 'Reva@Example.ua', 'password' => 'correct horse 1']);
ok('регистрация → сессия', $r->status === 200 && !empty($phone->jar['ts_sid']) && $r->body['user']['email'] === 'reva@example.ua');
$sidCookie = array_values(array_filter($r->cookies, fn($c) => $c[0] === 'ts_sid'))[0][2];
ok('cookie сессии: HttpOnly, Secure, SameSite=Lax', $sidCookie['httponly'] && $sidCookie['secure'] && $sidCookie['samesite'] === 'Lax');
ok('повторная регистрация того же email → 409', (new Browser('10.0.0.2'))->req('POST', '/api/auth/register', ['email' => 'reva@example.ua', 'password' => 'another pass 2'])->status === 409);

echo "\nСинхронизация двух устройств:\n";
$laptop = new Browser('10.0.0.3');
$r = $laptop->req('POST', '/api/auth/login', ['email' => 'reva@example.ua', 'password' => 'correct horse 1']);
ok('вход с другого устройства', $r->status === 200);
$s1 = ['readings' => [['id' => 'r1', 'createdAt' => '2026-11-10T08:00:00Z']], 'meter' => ['modelId' => 'sharky774'], 'updatedAt' => 1];
$r = $phone->req('PUT', '/api/state', ['state' => $s1, 'baseVersion' => 0]);
ok('телефон сохранил (версия 1)', $r->status === 200 && $r->body['version'] === 1);
$r = $laptop->req('GET', '/api/state');
ok('ноутбук видит данные телефона', $r->status === 200 && $r->body['state']['readings'][0]['id'] === 'r1' && $r->body['version'] === 1);
$r = $laptop->req('PUT', '/api/state', ['state' => $s1 + ['x' => 1], 'baseVersion' => 0]);
ok('устаревшая версия → 409 с актуальными данными для слияния', $r->status === 409 && $r->body['version'] === 1 && isset($r->body['state']));
ok('без входа данные недоступны', (new Browser('10.0.0.9'))->req('GET', '/api/state')->status === 401);

echo "\nTelegram-вход и связывание:\n";
$tgPhone = new Browser('10.0.0.4');
$r = $tgPhone->req('POST', '/api/auth/telegram/webapp', ['initData' => initData($TOKEN, $u)]);
ok('вход из бота (Mini App) создаёт аккаунт', $r->status === 200 && $r->body['user']['telegram']['username'] === 'reva_test' && !$r->body['user']['hasPassword']);
$tgUid = $r->body['user']['id'];
$r = (new Browser('10.0.0.5'))->req('POST', '/api/auth/telegram/widget', widget($TOKEN, ['id' => '777001', 'first_name' => 'Микола', 'username' => 'reva_test']));
ok('кнопка на сайте входит в ТОТ ЖЕ аккаунт', $r->status === 200 && $r->body['user']['id'] === $tgUid);
$r = $tgPhone->req('POST', '/api/auth/password', ['email' => 'tg@example.ua', 'password' => 'telegram pass 3']);
ok('аккаунту из Telegram добавлен email+пароль', $r->status === 200 && $r->body['user']['hasPassword'] && $r->body['user']['email'] === 'tg@example.ua');
$r = (new Browser('10.0.0.6'))->req('POST', '/api/auth/login', ['email' => 'tg@example.ua', 'password' => 'telegram pass 3']);
ok('…и теперь вход по паролю попадает в тот же аккаунт', $r->status === 200 && $r->body['user']['id'] === $tgUid);
$r = $phone->req('POST', '/api/auth/link-telegram', widget($TOKEN, ['id' => '777001', 'first_name' => 'Микола']));
ok('чужой Telegram к другому аккаунту не привязать → 409', $r->status === 409 && $r->body['error'] === 'telegram_linked_elsewhere');
$r = $phone->req('POST', '/api/auth/link-telegram', widget($TOKEN, ['id' => '555', 'first_name' => 'Інший']));
ok('свой Telegram к аккаунту с паролем привязывается', $r->status === 200 && $r->body['user']['telegram']['id'] === '555');

echo "\nЗащита от перебора и флуда:\n";
$att = new Browser('10.0.1.1'); $codes = [];
for ($i = 0; $i < 7; $i++) $codes[] = $att->req('POST', '/api/auth/login', ['email' => 'reva@example.ua', 'password' => 'wrong-' . $i])->status;
ok('после 5 неверных паролей аккаунт заблокирован (429)', $codes[4] === 401 && $codes[5] === 429, $codes);
ok('…даже с верным паролем, пока идёт блокировка', (new Browser('10.0.1.2'))->req('POST', '/api/auth/login', ['email' => 'reva@example.ua', 'password' => 'correct horse 1'])->status === 429);
$flood = new Browser('10.0.2.1'); $last = 0;
for ($i = 0; $i < 12; $i++) $last = $flood->req('POST', '/api/auth/login', ['email' => "x$i@e.ua", 'password' => 'whatever1'])->status;
ok('с одного IP не больше 10 попыток входа за 5 минут', $last === 429);
$r = Api::handle(new Req('GET', '/api/config', ['REMOTE_ADDR' => '127.0.0.1', 'HTTP_CF_CONNECTING_IP' => '203.0.113.7']));
ok('за Cloudflare берём реальный IP из CF-Connecting-IP', Http::ip(['REMOTE_ADDR' => '172.68.10.20', 'HTTP_CF_CONNECTING_IP' => '203.0.113.7']) === '203.0.113.7');
ok('…и от локального прокси (Caddy)', Http::ip(['REMOTE_ADDR' => '127.0.0.1', 'HTTP_CF_CONNECTING_IP' => '203.0.113.7']) === '203.0.113.7');
ok('…но не верим этому заголовку от чужих адресов', Http::ip(['REMOTE_ADDR' => '198.51.100.1', 'HTTP_CF_CONNECTING_IP' => '203.0.113.7']) === '198.51.100.1');
$big = str_repeat('x', 310 * 1024);
ok('слишком большой запрос → 413', Api::handle(new Req('PUT', '/api/state', ['REMOTE_ADDR' => '10.0.3.1'], [], $big))->status === 413);

echo "\nБот:\n";
$sent = null; Telegram::$send = function ($m, $p) use (&$sent) { $sent = [$m, $p]; return ['ok' => true]; };
$r = Api::handle(new Req('POST', '/api/bot/webhook', ['REMOTE_ADDR' => '149.154.167.1', 'HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN' => 'nope'], [], '{}'));
ok('вебхук с неверным секретом → 403', $r->status === 403);
$upd = ['message' => ['chat' => ['id' => 42], 'from' => ['language_code' => 'ru'], 'text' => '/start']];
$r = Api::handle(new Req('POST', '/api/bot/webhook', ['REMOTE_ADDR' => '149.154.167.1', 'HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN' => 'hook-secret'], [], json_encode($upd)));
ok('/start → кнопка web_app на сайт (русский пользователь — русский текст)', $r->status === 200 && $sent[0] === 'sendMessage' && $sent[1]['reply_markup']['inline_keyboard'][0][0]['web_app']['url'] === 'https://teplo.example/' && str_contains($sent[1]['text'], 'Нажмите'));

echo "\nРаспознавание фото (сырое тело, синтетика):\n";
$img = imagecreatetruecolor(40, 20); ob_start(); imagepng($img); $png = ob_get_clean();
$up = function (Browser $b, string $body, string $type) { return $b->req('POST', '/api/recognize/upload', null, ['HTTP_CONTENT_TYPE' => $type], true, $body); };
ok('без входа фото не принимается', $up(new Browser('10.0.4.1'), $png, 'image/png')->status === 401);
$rb = new Browser('10.0.4.2'); $rb->req('POST', '/api/auth/register', ['email' => 'photo@example.ua', 'password' => 'photo pass 77']);
$r1 = $up($rb, $png, 'image/png'); $r2 = $up($rb, $png, 'image/png');
ok('PNG сырым телом → id', $r1->status === 200 && preg_match('/^[a-f0-9]{24}$/', $r1->body['id'] ?? ''));
ok('не картинка под видом image/png → 415', $up($rb, '<?php echo 1;', 'image/png')->status === 415);
$seen = null; Recognize::$call = function ($payload) use (&$seen) { $seen = $payload; return ['content' => [['type' => 'text', 'text' => 'Ось: {"meter":{"modelId":"sharky774","confidence":0.9},"photos":[{"index":0,"readings":[{"field":"energy","value":"14.100","confidence":0.97}]}]}']]]; };
$rr = $rb->req('POST', '/api/recognize/run', ['ids' => [$r1->body['id'], $r2->body['id']], 'offset' => 0, 'ctx' => ['expectedModel' => 'sharky774', 'prev' => ['energy' => 13.245], 'lang' => 'uk']]);
ok('распознавание: модель и поле из ответа', $rr->status === 200 && $rr->body['meter']['modelId'] === 'sharky774' && $rr->body['photos'][0]['readings'][0]['value'] === '14.100');
ok('в нейросеть ушли 2 фото и промпт сервера', count($seen['messages'][0]['content']) === 3 && str_contains(end($seen['messages'][0]['content'])['text'], 'SHARKY 774'));
$p1 = Db::one('SELECT * FROM photos WHERE id = ?', [$r1->body['id']]); $p2 = Db::one('SELECT * FROM photos WHERE id = ?', [$r2->body['id']]);
ok('фото сохранено на диске и в базе, результат записан', is_file(Recognize::path($p1)) && $p1['status'] === 'recognized' && str_contains($p1['result'], '14.100'));
ok('фото, о котором нейросеть промолчала, — проблема по-русски', $p2['status'] === 'failed' && str_contains((string)$p2['problem'], 'ничего не сказала'));
Recognize::$call = function () { throw new HttpError(504, 'timeout', ['human' => 'Нейросеть не ответила за 26 с']); };
ok('таймаут нейросети → 504 клиенту', $rb->req('POST', '/api/recognize/run', ['ids' => [$r1->body['id']]])->status === 504);
ok('…и причина в журнале человеческим языком', str_contains(Db::one("SELECT text FROM recog_reports WHERE kind = 'run_error' ORDER BY id DESC")['text'], 'не ответила'));
Recognize::$call = null; Cfg::set(['anthropic_api_key' => null] + ['admins' => ['emails' => ['boss@example.ua']], 'limits' => ['ip_all' => [1000, 60], 'login_ip' => [10, 300], 'login_fail_acc' => [5, 900], 'register_ip' => [50, 3600], 'telegram_ip' => [30, 300], 'state_user' => [60, 60], 'recog_upload' => [120, 3600], 'recog_run' => [40, 86400], 'feedback_ip' => [3, 3600]]]);
$r3 = $up($rb, $png, 'image/png');
ok('без ключа: фото принимается (тестовый режим)', $r3->status === 200);
$rr = $rb->req('POST', '/api/recognize/run', ['ids' => [$r3->body['id']]]);
ok('без ключа: 503 recognition_off, причина записана в фото', $rr->status === 503 && str_contains((string)Db::one('SELECT problem FROM photos WHERE id = ?', [$r3->body['id']])['problem'], 'не задан ключ API'));
$rr = $rb->req('POST', '/api/recognize/report', ['ids' => [$r1->body['id']], 'missing' => ['flow'], 'corrections' => [['field' => 'energy', 'recognized' => '14.100', 'final' => '14.160']]]);
ok('итог распознавания — по-русски: что не найдено и что исправил человек', $rr->status === 200 && str_contains($t = Db::one("SELECT text FROM recog_reports WHERE kind = 'summary'")['text'], 'расход') && str_contains($t, '14.160'));
ok('больше 3 фото за запрос → 422', $rb->req('POST', '/api/recognize/run', ['ids' => array_fill(0, 4, str_repeat('a', 24))])->status === 422);

echo "\nОтзывы и аналитика:\n";
$anon = new Browser('10.0.5.1');
ok('отзыв без входа принимается со страницей', $anon->req('POST', '/api/feedback', ['text' => 'Не понял шаг 3', 'page' => '#step-3', 'screen' => 'S05', 'contact' => '@someone'])->status === 200
  && Db::one('SELECT page, screen FROM feedback ORDER BY id DESC')['page'] === '#step-3');
ok('пустой отзыв → 422', $anon->req('POST', '/api/feedback', ['text' => ' '])->status === 422);
$anon->req('POST', '/api/feedback', ['text' => 'два']); $anon->req('POST', '/api/feedback', ['text' => 'три']);
ok('лимит отзывов с одного IP → 429', $anon->req('POST', '/api/feedback', ['text' => 'четыре'])->status === 429);
ok('аналитика без входа → 401', $anon->req('GET', '/api/admin/overview')->status === 401);
ok('аналитика обычному пользователю → 403', $rb->req('GET', '/api/admin/users')->status === 403 && $rb->req('GET', '/api/admin/me')->body['admin'] === false);
$boss = new Browser('10.0.5.2'); $boss->req('POST', '/api/auth/register', ['email' => 'Boss@example.ua', 'password' => 'boss pass 123']);
$ov = $boss->req('GET', '/api/admin/overview');
ok('админ: сводка', $ov->status === 200 && $ov->body['feedback'] === 3 && $ov->body['photos'] >= 3 && $ov->body['photosFailed'] >= 2);
$us = $boss->req('GET', '/api/admin/users', null, ['QUERY_STRING' => 'q=photo@']);
ok('админ: поиск пользователя по email', $us->status === 200 && count($us->body['users']) === 1 && (int)$us->body['users'][0]['photos'] === 3);
$ud = $boss->req('GET', '/api/admin/user', null, ['QUERY_STRING' => 'id=' . $us->body['users'][0]['id']]);
ok('админ: карточка пользователя с фото и журналом', $ud->status === 200 && count($ud->body['photos']) === 3 && count($ud->body['reports']) >= 2);
$ph = $boss->req('GET', '/api/admin/photos', null, ['QUERY_STRING' => 'filter=problems']);
ok('админ: фото с проблемами', $ph->status === 200 && count($ph->body['photos']) >= 2);
$pf = $boss->req('GET', '/api/admin/photo', null, ['QUERY_STRING' => 'id=' . $r1->body['id']]);
ok('админ: байты фото отдаются через PHP', $pf->status === 200 && $pf->file['mime'] === 'image/png' && is_file($pf->file['path']));
ok('чужому — фото не отдаётся', $rb->req('GET', '/api/admin/photo', null, ['QUERY_STRING' => 'id=' . $r1->body['id']])->status === 403);
$fid = (int)Db::one('SELECT id FROM feedback ORDER BY id LIMIT 1')['id'];
ok('админ: отметить отзыв обработанным', $boss->req('POST', '/api/admin/feedback', ['id' => $fid, 'status' => 'done'])->status === 200 && Db::one('SELECT status FROM feedback WHERE id = ?', [$fid])['status'] === 'done');
Db::q('UPDATE photos SET created_at = ? WHERE id = ?', [gmdate('c', time() - 100 * 86400), $r1->body['id']]);
ok('очистка: фото старше 90 дней удаляются', Admin::cleanup() === 1 && !is_file(Recognize::path($p1)));

echo "\nНастройки из /admin (ключ API, бот):\n";
$calls = []; $goodKey = 'sk-ant-api03-' . str_repeat('x', 40);
Recognize::$check = function ($key, $payload) use ($goodKey) { if ($key !== $goodKey) throw new HttpError(503, 'recognition_off', ['human' => 'Ключ API отклонён (HTTP 401)']); return ['ok' => true, 'model' => $payload['model']]; };
Telegram::$send = function ($m, $p, $tok = null) use (&$calls) { $calls[] = [$m, $tok];
  if ($m === 'getMe') return $tok === '1234567890:AAbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' ? ['ok' => true, 'result' => ['username' => 'TeploNewBot']] : ['ok' => false, 'description' => 'Unauthorized'];
  if ($m === 'getWebhookInfo') return ['ok' => true, 'result' => ['url' => 'https://teplo.example/api/bot/webhook']]; return ['ok' => true]; };
ok('настройки: обычному пользователю → 403', $rb->req('GET', '/api/admin/settings')->status === 403 && $rb->req('POST', '/api/admin/settings/anthropic', ['key' => $goodKey])->status === 403);
$st = $boss->req('GET', '/api/admin/settings');
ok('настройки: ключа нет — распознавание выключено', $st->status === 200 && $st->body['anthropic']['key'] === '' && $st->body['anthropic']['model'] === 'claude-sonnet-5-5');
$r = $boss->req('POST', '/api/admin/settings/anthropic', ['key' => 'sk-ant-api03-' . str_repeat('y', 40)]);
ok('ключ, который API отклонил, не сохраняется', $r->status === 422 && $r->body['error'] === 'key_check_failed' && !Cfg::get('anthropic_api_key'));
ok('мусор вместо ключа → 422', $boss->req('POST', '/api/admin/settings/anthropic', ['key' => 'hello world'])->body['error'] === 'bad_key');
$r = $boss->req('POST', '/api/admin/settings/anthropic', ['key' => $goodKey]);
ok('верный ключ сохраняется, наружу — только маска', $r->status === 200 && Cfg::get('anthropic_api_key') === $goodKey && $r->body['settings']['anthropic']['source'] === 'admin'
  && !str_contains(json_encode($r->body), $goodKey) && is_file(Cfg::settingsFile()) && (fileperms(Cfg::settingsFile()) & 0077) === 0);
Cfg::set(['admins' => ['emails' => ['boss@example.ua']], 'app_url' => 'https://teplo.example/']);
ok('ключ переживает перезапуск (читается из файла)', Cfg::get('anthropic_api_key') === $goodKey && $boss->req('GET', '/api/config')->body['recognition'] === true);
ok('сменить модель без повторного ввода ключа', $boss->req('POST', '/api/admin/settings/anthropic', ['model' => 'claude-opus-5-5'])->status === 200 && Cfg::get('anthropic_model') === 'claude-opus-5-5');
$r = $boss->req('POST', '/api/admin/settings/telegram', ['token' => '1234567890:AAzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz']);
ok('чужой токен бота не сохраняется', $r->status === 422 && $r->body['error'] === 'token_rejected' && !Cfg::get('bot_token'));
$calls = [];
$r = $boss->req('POST', '/api/admin/settings/telegram', ['token' => '1234567890:AAbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']);
$sec = (string)Cfg::get('webhook_secret');
ok('бот подключается: имя из getMe, секрет придуман, вебхук поставлен', $r->status === 200 && $r->body['bot'] === 'TeploNewBot' && Cfg::get('bot_username') === 'TeploNewBot' && strlen($sec) === 48
  && in_array('setWebhook', array_column($calls, 0), true) && in_array('setChatMenuButton', array_column($calls, 0), true));
ok('после подключения вебхук принимает секрет', $anon->req('POST', '/api/bot/webhook', ['message' => ['chat' => ['id' => 5], 'from' => ['language_code' => 'uk']]], ['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN' => $sec])->status === 200);
ok('отключить бота и удалить ключ', $boss->req('POST', '/api/admin/settings/telegram', ['clear' => 1])->status === 200 && !Cfg::get('bot_token')
  && $boss->req('POST', '/api/admin/settings/anthropic', ['clear' => 1])->status === 200 && !Cfg::get('anthropic_api_key'));
Recognize::$check = null; Telegram::$send = null;

echo "\nВыход:\n";
$phone->req('POST', '/api/auth/logout');
ok('после выхода /api/me → 401', $phone->req('GET', '/api/me')->status === 401);

echo "\nИтог: $pass OK, $fail FAIL\n";
exit($fail ? 1 : 0);
