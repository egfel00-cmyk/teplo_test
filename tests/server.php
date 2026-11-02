<?php
// Тесты сервера без веб-сервера и без зависимостей, только синтетика. Запуск: php tests/server.php
declare(strict_types=1);
define('TEPLO', 1);
require __DIR__ . '/../app/core.php';
require __DIR__ . '/../app/telegram.php';
require __DIR__ . '/../app/reminders.php';
require __DIR__ . '/../app/recognize.php';
require __DIR__ . '/../app/admin.php';
require __DIR__ . '/../app/visits.php';
require __DIR__ . '/../app/docs.php';
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
$r3l = $up($rb, $png, 'image/png'); $r4l = $up($rb, $png, 'image/png');
$rl = $rb->req('POST', '/api/recognize/local', ['ids' => [$r3l->body['id'], $r4l->body['id']], 'results' => [
  ['photo' => ['index' => 0, 'kind' => 'screen', 'readings' => [['field' => 'energy', 'value' => '15.482', 'unit' => 'Gcal', 'confidence' => 0.9]], 'quality' => 'ok', 'meterType' => 'heat'], 'ms' => 1200, 'ocr' => [['t' => '00015.482', 's' => 0.93, 'h' => 66]]],
  ['photo' => ['index' => 1, 'kind' => 'other', 'readings' => [], 'quality' => 'ok', 'meterType' => 'water'], 'ms' => 900]]]);
$pl3 = Db::one('SELECT * FROM photos WHERE id = ?', [$r3l->body['id']]); $pl4 = Db::one('SELECT * FROM photos WHERE id = ?', [$r4l->body['id']]);
ok('распознано в браузере → результат и текст распознавателя в аналитике', $rl->status === 200 && $rl->body['saved'] === 2 && $pl3['status'] === 'recognized' && $pl3['problem'] === null
  && json_decode($pl3['result'], true)['engine'] === 'local' && json_decode($pl3['result'], true)['ocr'][0]['t'] === '00015.482');
ok('…фото водомера — причина «счётчик воды, а не тепла»', str_contains((string)$pl4['problem'], 'воды, а не тепла'));
// вода «з фото»: итог по водомерам и окна барабанов — тоже в аналитику, с причинами по-русски
$r5l = $up($rb, $png, 'image/png'); $r6l = $up($rb, $png, 'image/png');
$rw = $rb->req('POST', '/api/recognize/local', ['ids' => [$r5l->body['id'], $r6l->body['id']], 'results' => [
  ['photo' => ['index' => 0, 'kind' => 'water', 'meterType' => 'water', 'readings' => [['field' => 'water_hot', 'meter' => 'h1', 'value' => 502, 'partial' => null, 'half' => false, 'guess' => true, 'lead' => false]]], 'ms' => 6800,
    'drums' => [['text' => '00502', 'red' => '310', 'score' => 0.6, 'votes' => 1, 'tint' => 'red', 'shifted' => [['i' => 2, 'd' => 5]]]]],
  ['photo' => ['index' => 1, 'kind' => 'water', 'meterType' => 'water', 'readings' => [['field' => 'water_cold', 'meter' => 'c1', 'value' => null, 'partial' => '0023?', 'half' => true]]], 'ms' => 5000]]]);
$pl5 = Db::one('SELECT * FROM photos WHERE id = ?', [$r5l->body['id']]); $pl6 = Db::one('SELECT * FROM photos WHERE id = ?', [$r6l->body['id']]);
ok('вода з фото → в аналитике: водомер, окно барабана; «наугад» — замечание, не «счётчик воды, а не тепла»', $rw->status === 200 && $pl5['status'] === 'recognized'
  && json_decode($pl5['result'], true)['drums'][0]['text'] === '00502' && str_contains((string)$pl5['problem'], 'наугад') && !str_contains((string)$pl5['problem'], 'не тепла'));
ok('…ролик между цифрами не узнан — «0023?», человек допишет', str_contains((string)$pl6['problem'], 'холодная вода: ролик между цифрами не узнан («0023?»)'));
ok('чужие фото так не перезаписать', (new Browser('10.0.4.9'))->req('POST', '/api/recognize/local', ['ids' => [$r3l->body['id']], 'results' => []])->status === 401);
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
ok('админ: поиск пользователя по email', $us->status === 200 && count($us->body['users']) === 1 && (int)$us->body['users'][0]['photos'] === 7);
$ud = $boss->req('GET', '/api/admin/user', null, ['QUERY_STRING' => 'id=' . $us->body['users'][0]['id']]);
ok('админ: карточка пользователя с фото и журналом', $ud->status === 200 && count($ud->body['photos']) === 7 && count($ud->body['reports']) >= 2);
// с чего работают: отметки браузеров → сводка в /admin
$anon->req('POST', '/api/visit', ['vid' => 'abc12345phone', 'device' => 'mobile', 'os' => 'iOS', 'tg' => true, 'sw' => 390]);
$anon->req('POST', '/api/visit', ['vid' => 'abc12345phone', 'device' => 'mobile', 'os' => 'iOS', 'tg' => true, 'sw' => 390]);
$boss->req('POST', '/api/visit', ['vid' => 'boss1234desk', 'device' => 'desktop', 'os' => 'macOS', 'sw' => 1512]);
$pad = new Browser('10.0.5.9'); $pad->req('POST', '/api/visit', ['vid' => 'pad12345', 'device' => 'tablet', 'os' => 'Android', 'sw' => 800]);
$anon->req('POST', '/api/visit', ['vid' => 'junk12345', 'device' => 'фигня', 'os' => 'x']);   // чужие значения → по User-Agent ('test' → компьютер, other)
ok('разбор User-Agent: Android без Mobile — планшет, Android Mobile — телефон, iPhone — телефон iOS', Visits::guess('Mozilla/5.0 (Linux; Android 13; SM-X200) Safari/537.36') === ['device' => 'tablet', 'os' => 'Android']
  && Visits::guess('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36')['device'] === 'mobile' && Visits::guess('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)') === ['device' => 'mobile', 'os' => 'iOS']);
ok('отметка без vid → 400', $anon->req('POST', '/api/visit', ['vid' => '1'])->status === 400);
$dv = $boss->req('GET', '/api/admin/devices', null, ['QUERY_STRING' => 'days=30']);
ok('устройства: телефон 1 браузер / 2 открытия, компьютер вошедший, неизвестное → по UA (Android без Mobile = планшет)', $dv->status === 200
  && $dv->body['device']['mobile']['v'] === 1 && $dv->body['device']['mobile']['h'] === 2 && $dv->body['device']['desktop']['u'] === 1
  && $dv->body['device']['tablet']['v'] === 1 && $dv->body['device']['desktop']['v'] === 2 && isset($dv->body['os']['other']) && $dv->body['tg']['tg']['v'] === 1 && $dv->body['tg']['web']['v'] === 3 && $dv->body['width']['360–430'] === 1, $dv->body);
ok('устройства — только админу', $anon->req('GET', '/api/admin/devices')->status === 401);
$bid = Db::one("SELECT id FROM users WHERE email = 'boss@example.ua'")['id'];
$bu = $boss->req('GET', '/api/admin/user', null, ['QUERY_STRING' => 'id=' . $bid]);
ok('карточка человека: его устройства', $bu->status === 200 && count($bu->body['devices']) === 1 && $bu->body['devices'][0]['device'] === 'desktop', $bu->body['devices'] ?? null);
$ph = $boss->req('GET', '/api/admin/photos', null, ['QUERY_STRING' => 'filter=problems']);
ok('админ: фото с проблемами', $ph->status === 200 && count($ph->body['photos']) >= 2);
$pf = $boss->req('GET', '/api/admin/photo', null, ['QUERY_STRING' => 'id=' . $r1->body['id']]);
ok('админ: байты фото отдаются через PHP', $pf->status === 200 && $pf->file['mime'] === 'image/png' && is_file($pf->file['path']));
ok('чужому — фото не отдаётся', $rb->req('GET', '/api/admin/photo', null, ['QUERY_STRING' => 'id=' . $r1->body['id']])->status === 403);
$fid = (int)Db::one('SELECT id FROM feedback ORDER BY id LIMIT 1')['id'];
ok('админ: отметить отзыв обработанным', $boss->req('POST', '/api/admin/feedback', ['id' => $fid, 'status' => 'done'])->status === 200 && Db::one('SELECT status FROM feedback WHERE id = ?', [$fid])['status'] === 'done');
Db::q('UPDATE photos SET created_at = ? WHERE id = ?', [gmdate('c', time() - 100 * 86400), $r1->body['id']]);
ok('очистка: фото старше 90 дней удаляются', Admin::cleanup() === 1 && !is_file(Recognize::path($p1)));

echo "\nФото в записях истории:\n";
$id2 = $r2->body['id'];
$g = $rb->req('GET', '/api/photo', null, ['QUERY_STRING' => 'id=' . $id2]);
ok('хозяину фото записи отдаётся байтами', $g->status === 200 && $g->file['mime'] === 'image/png' && is_file($g->file['path']));
ok('чужому — 404 (не 403: не выдаём, что фото есть)', $boss->req('GET', '/api/photo', null, ['QUERY_STRING' => 'id=' . $id2])->status === 404);
ok('без входа — 401', (new Browser('10.0.4.9'))->req('GET', '/api/photo', null, ['QUERY_STRING' => 'id=' . $id2])->status === 401);
$k = $rb->req('POST', '/api/photo/keep', ['ids' => [$id2, 'zz', str_repeat('a', 24)], 'keep' => true]);
ok('keep: хранить фото записи (чужие/кривые id пропускаются)', $k->status === 200 && $k->body['n'] === 1 && (int)Db::one('SELECT kept FROM photos WHERE id = ?', [$id2])['kept'] === 1);
ok('keep: чужое фото пометить нельзя', $boss->req('POST', '/api/photo/keep', ['ids' => [$id2], 'keep' => false])->body['n'] === 0);
Db::q('UPDATE photos SET created_at = ? WHERE id = ?', [gmdate('c', time() - 100 * 86400), $id2]);
ok('очистка не трогает фото записей истории', Admin::cleanup() === 0 && is_file(Recognize::path(Db::one('SELECT * FROM photos WHERE id = ?', [$id2]))));
$rb->req('POST', '/api/photo/keep', ['ids' => [$id2], 'keep' => false]);
$p2 = Db::one('SELECT * FROM photos WHERE id = ?', [$id2]);
ok('запись удалили (keep=false) — фото снова уходит по сроку', Admin::cleanup() === 1 && !is_file(Recognize::path($p2)));

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

echo "\nПривязка Telegram через бота:\n";
Cfg::set(['admins' => ['emails' => ['boss@example.ua']], 'app_url' => 'https://teplo.example/', 'bot_token' => $TOKEN, 'bot_username' => 'TeploTestBot', 'webhook_secret' => 'hook-secret',
  'limits' => ['ip_all' => [1000, 60], 'login_ip' => [10, 300], 'login_fail_acc' => [5, 900], 'register_ip' => [50, 3600], 'telegram_ip' => [30, 300], 'state_user' => [60, 60], 'recog_upload' => [120, 3600], 'recog_run' => [40, 86400], 'feedback_ip' => [3, 3600]]]);
$sent = []; Telegram::$send = function ($m, $p, $tok = null) use (&$sent) { $sent[] = [$m, $p]; return ['ok' => true]; };
$lb = new Browser('10.0.9.1'); $lb->req('POST', '/api/auth/register', ['email' => 'link@example.ua', 'password' => 'link pass 123']);
$lk = $lb->req('POST', '/api/auth/link-bot');
ok('ссылка на бота с одноразовым токеном', $lk->status === 200 && preg_match('~^https://t\.me/[^?]+\?start=link_([a-f0-9]{32})$~', $lk->body['url'], $mm));
$from = ['id' => 555777, 'username' => 'linker', 'language_code' => 'uk'];
$hook = fn($text) => $anon->req('POST', '/api/bot/webhook', ['message' => ['chat' => ['id' => 555777], 'from' => $from, 'text' => $text]], ['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN' => (string)Cfg::get('webhook_secret')]);
$hook('/start link_' . $mm[1]);
$linkedTo = Db::one("SELECT user_id FROM user_identities WHERE type = 'telegram' AND external_id = '555777'");
ok('«Старт» в боте → Telegram привязан к этому аккаунту, бот ответил', $linkedTo && (int)$linkedTo['user_id'] === (int)$lb->req('GET', '/api/me')->body['user']['id'] && str_contains(end($sent)[1]['text'], 'прив’язано'));
$hook('/start link_' . $mm[1]);
ok('повторно та же ссылка не работает', str_contains(end($sent)[1]['text'], 'застаріло'));
Telegram::$send = null;

echo "\nДокументы к счётчику:\n";
$du = fn(Browser $b, string $body, string $type, string $q) => $b->req('POST', '/api/docs/upload', null, ['HTTP_CONTENT_TYPE' => $type, 'QUERY_STRING' => $q], true, $body);
ok('без входа документ не принимается', $du(new Browser('10.0.9.9'), $png, 'image/png', 'kind=passport')->status === 401);
$d1 = $du($lb, $png, 'image/png', 'place=p1&kind=passport'); $d2 = $du($lb, "%PDF-1.4\n%fake", 'application/pdf', 'place=p1&kind=verification');
ok('фото паспорта и PDF поверки сохраняются', $d1->status === 200 && $d2->status === 200 && $d1->body['doc']['kind'] === 'passport' && $d2->body['doc']['mime'] === 'application/pdf');
ok('не PDF под видом PDF → 415', $du($lb, '<?php 1;', 'application/pdf', 'kind=other')->status === 415);
$dl = $lb->req('GET', '/api/docs');
ok('список своих документов', count($dl->body['docs']) === 2 && $dl->body['docs'][0]['place'] === 'p1');
ok('чужой не видит и не скачивает', count($rb->req('GET', '/api/docs')->body['docs']) === 0 && $rb->req('GET', '/api/docs/file', null, ['QUERY_STRING' => 'id=' . $d1->body['doc']['id']])->status === 404);
ok('свой файл отдаётся через PHP', $lb->req('GET', '/api/docs/file', null, ['QUERY_STRING' => 'id=' . $d1->body['doc']['id']])->file['mime'] === 'image/png');
ok('удаление', $lb->req('POST', '/api/docs/delete', ['id' => $d2->body['doc']['id']])->status === 200 && count($lb->req('GET', '/api/docs')->body['docs']) === 1);

echo "\nПлатёжки к записям истории:\n";
$b1 = $du($lb, "%PDF-1.4\n%bill", 'application/pdf', 'place=p1&kind=bill&name=' . rawurlencode('Платіжка жовтень.pdf'));
ok('платёжка PDF сохраняется (kind=bill) с именем файла', $b1->status === 200 && $b1->body['doc']['kind'] === 'bill' && $b1->body['doc']['name'] === 'Платіжка жовтень.pdf');
$lk = $lb->req('GET', '/api/docs/link', null, ['QUERY_STRING' => 'id=' . $b1->body['doc']['id']]);
ok('подписанная ссылка — только хозяину', $lk->status === 200 && str_starts_with($lk->body['url'], 'docs/open?id=') && $rb->req('GET', '/api/docs/link', null, ['QUERY_STRING' => 'id=' . $b1->body['doc']['id']])->status === 404);
parse_str(parse_url($lk->body['url'], PHP_URL_QUERY), $lq);
ok('по ссылке файл открывается без входа', (new Browser('10.0.9.8'))->req('GET', '/api/docs/open', null, ['QUERY_STRING' => http_build_query($lq)])->file['mime'] === 'application/pdf');
$bad = $lq; $bad['e'] = (string)((int)$lq['e'] + 60);
$old = $lq; $old['e'] = (string)(time() - 5);
ok('подделка срока или просроченная — 404', (new Browser('10.0.9.8'))->req('GET', '/api/docs/open', null, ['QUERY_STRING' => http_build_query($bad)])->status === 404 && (new Browser('10.0.9.8'))->req('GET', '/api/docs/open', null, ['QUERY_STRING' => http_build_query($old)])->status === 404);

echo "\nПогода для статистики (только владельцу):\n";
$urls = []; Weather::$fetch = function ($u) use (&$urls) { $urls[] = $u; return ['daily' => ['time' => ['2025-01-01', '2025-01-02'], 'temperature_2m_mean' => [-3.24, null]]]; };
ok('погода: обычному пользователю — нет', $rb->req('GET', '/api/admin/weather', null, ['QUERY_STRING' => 'from=2025-01-01&to=2025-01-02'])->status === 403);
$wr = $boss->req('GET', '/api/admin/weather', null, ['QUERY_STRING' => 'from=2025-01-01&to=2025-01-02']);
ok('погода: средняя за сутки, пропуски не выдумываем', $wr->status === 200 && $wr->body['days'] === ['2025-01-01' => -3.2] && str_contains($urls[0], 'archive-api.open-meteo.com'));
$n = count($urls); $boss->req('GET', '/api/admin/weather', null, ['QUERY_STRING' => 'from=2025-01-01&to=2025-01-02']);
ok('погода: старый период — из кэша, без запроса', count($urls) === $n);
ok('погода: мусор в датах → 422', $boss->req('GET', '/api/admin/weather', null, ['QUERY_STRING' => 'from=x&to=y'])->status === 422);
Weather::$fetch = null;

echo "\nФото боту в Telegram → входящие аккаунта:\n";
Cfg::set(['app_url' => 'https://teplo.example/', 'bot_token' => $TOKEN, 'webhook_secret' => 'hook-secret']);
$sent = []; Telegram::$send = function ($m, $p, $tok = null) use (&$sent) { $sent[] = [$m, $p]; return ['ok' => true]; };
Telegram::$fetch = fn($id) => $id === 'BIG' ? $png : null;
@unlink((Cfg::data() ?: sys_get_temp_dir() . '/teplo_data') . '/cache/tgreply_9001');
$hook = fn(array $msg) => Api::handle(new Req('POST', '/api/bot/webhook', ['REMOTE_ADDR' => '149.154.167.1', 'HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN' => 'hook-secret'], [], json_encode(['message' => $msg])));
$pm = fn($date) => ['chat' => ['id' => 9001], 'date' => $date, 'from' => ['id' => 9001, 'first_name' => 'Фото', 'language_code' => 'uk'], 'photo' => [['file_id' => 'SMALL'], ['file_id' => 'BIG']]];
$t0 = time() - 600; $r = $hook($pm($t0));
$ib = Db::one("SELECT COUNT(*) AS n FROM bot_inbox b JOIN user_identities i ON i.user_id = b.user_id WHERE i.external_id = '9001'");
ok('фото сохранено во входящие (берётся самый большой размер), аккаунт Telegram создан', $r->status === 200 && (int)$ib['n'] === 1);
ok('ответ — кнопка Mini App «Розпізнати фото» с ?inbox=1', ($sent[0][1]['reply_markup']['inline_keyboard'][0][0]['web_app']['url'] ?? '') === 'https://teplo.example/?inbox=1');
$n0 = count($sent); $hook($pm($t0 + 60));
ok('второе фото альбома — без повторного ответа', count($sent) === $n0);
$bad = $pm($t0 + 100); $bad['photo'] = [['file_id' => 'GONE']]; $hook($bad);
ok('не скачалось — честно просим прислать ещё раз', str_contains($sent[count($sent) - 1][1]['text'] ?? '', 'ще раз'));
$tgb = new Browser('10.0.12.1'); $tgb->req('POST', '/api/auth/telegram/webapp', ['initData' => initData($TOKEN, ['id' => 9001, 'first_name' => 'Фото'])]);
$in = $tgb->req('GET', '/api/inbox');
ok('Mini App видит 2 фото по порядку съёмки', $in->status === 200 && count($in->body['items']) === 2 && $in->body['items'][0]['takenAt'] < $in->body['items'][1]['takenAt']);
ok('файл отдаётся владельцу', $tgb->req('GET', '/api/inbox/file', null, ['QUERY_STRING' => 'id=' . $in->body['items'][0]['id']])->file['mime'] === 'image/png');
ok('чужому — нет', $rb->req('GET', '/api/inbox/file', null, ['QUERY_STRING' => 'id=' . $in->body['items'][0]['id']])->status === 404 && count($rb->req('GET', '/api/inbox')->body['items']) === 0);
$tgb->req('POST', '/api/inbox/done', ['ids' => array_column($in->body['items'], 'id')]);
ok('после «разобрано» входящие пусты', count($tgb->req('GET', '/api/inbox')->body['items']) === 0);
Telegram::$send = null; Telegram::$fetch = null;

echo "\nНапоминания ботом:\n";
$kyiv = fn(string $local) => (new DateTimeImmutable($local, new DateTimeZone('Europe/Kyiv')))->getTimestamp();
ok('15-го в 10:17 по Киеву — вода', (Reminders::due($kyiv('2026-11-15 10:17'))['kind'] ?? '') === 'water15');
ok('рано утром и в другие дни — ничего', Reminders::due($kyiv('2026-11-15 08:17')) === null && Reminders::due($kyiv('2026-11-16 12:17')) === null);
ok('5-го — тепло, 22-го — тепло, 19-го — вода', Reminders::due($kyiv('2026-11-05 11:17'))['kind'] === 'heat5' && Reminders::due($kyiv('2026-11-22 19:17'))['kind'] === 'heat22' && Reminders::due($kyiv('2026-11-19 10:17'))['kind'] === 'water19');
$wst = ['places' => [['id' => 'main', 'meter' => ['modelId' => 'sharky774'], 'water' => ['meters' => [['id' => 'h1', 'kind' => 'hot']]]]],
  'readings' => [['id' => 'r1', 'htm' => ['date' => '2026-11-06', 'energy' => '10']]], 'water' => [['id' => 'b', 'place' => 'main', 'date' => '2026-11-01', 'base' => true, 'vals' => ['h1' => '5']]]];
ok('вода: в этом месяце только стартовые — напоминаем', Reminders::needs($wst, 'water15', '2026-11'));
$w2 = $wst; $w2['water'][] = ['id' => 'w', 'place' => 'main', 'date' => '2026-11-10', 'vals' => ['h1' => '7']];
ok('вода: запись этого месяца есть — молчим', !Reminders::needs($w2, 'water15', '2026-11'));
ok('тепло: показания в окне 5–25 есть — молчим; в прошлом месяце — напоминаем', !Reminders::needs($wst, 'heat22', '2026-11') && Reminders::needs($wst, 'heat22', '2026-12'));
ok('без водомеров про воду не пишем; выключено в настройках — не пишем', !Reminders::needs(['places' => [['id' => 'main']]], 'water15', '2026-11') && !Reminders::needs($wst + ['remind' => ['off' => true]], 'water15', '2026-11'));
$wg = $wst; $wg['places'][0]['gaps'] = [['id' => 'g1', 'what' => 'h1', 'from' => '2026-11-03', 'to' => ''], ['id' => 'g2', 'what' => 'heat', 'from' => '2026-12-01', 'to' => '2026-12-10']];
ok('лічильник знято (ремонт/повірка): водомір — не нагадуємо; тепло — лише поки знято', !Reminders::needs($wg, 'water15', '2026-11', '2026-11-15')
  && !Reminders::needs($wg, 'heat5', '2026-12', '2026-12-05') && Reminders::needs($wg, 'heat22', '2026-12', '2026-12-22'));
// прибрали лічильник з квартири (removed): про нього не нагадуємо; друга квартира лише з холодною — нагадуємо про воду
$wr = $wst; $wr['places'][0]['meter']['removed'] = '2026-11-02'; $wr['places'][0]['water']['meters'][0]['removed'] = '2026-11-02';
ok('прибраний теплолічильник і водомір — не нагадуємо', !Reminders::needs($wr, 'heat22', '2026-12') && !Reminders::needs($wr, 'water15', '2026-11'));
$wr['places'][] = ['id' => 'p2', 'name' => 'Мамина', 'water' => ['meters' => [['id' => 'c9', 'kind' => 'cold']]]];
ok('друга квартира лише з холодною: вода — нагадуємо, тепло — ні', Reminders::needs($wr, 'water15', '2026-11') && !Reminders::needs($wr, 'heat22', '2026-12'));
// несколько квартир (этап 2): одно сообщение со списком квартир, кнопка в каждую; выключатель у квартиры
$wm = $wst; $wm['places'][] = ['id' => 'p2', 'name' => 'Мамина', 'water' => ['meters' => [['id' => 'c9', 'kind' => 'cold']]]];
$pd = Reminders::placesDue($wm, 'water15', '2026-11');
ok('две квартиры без воды за месяц — обе в списке, без названия — «Квартира 1»', array_column($pd, 'label') === ['Квартира 1', 'Мамина'] && $pd[0]['all'] === 2, $pd);
$wm2 = $wm; $wm2['places'][1]['remindOff'] = true;
ok('квартира выключена (remindOff) — про неё молчим, про другую — пишем', array_column(Reminders::placesDue($wm2, 'water15', '2026-11'), 'id') === ['main']);
$wm3 = $wm2; $wm3['places'][0]['remindOff'] = true;
ok('обе выключены — не пишем вовсе', !Reminders::needs($wm3, 'water15', '2026-11'));
$tx = Reminders::text('water15', 'uk', $pd);
ok('текст: «Квартири: «Квартира 1», «Мамина»», кнопка в каждую (?go=wnew&place=…)', str_contains($tx['text'], 'Квартири: «Квартира 1», «Мамина»') && count($tx['buttons']) === 2
  && str_ends_with($tx['buttons'][1][1], '?go=wnew&place=p2') && str_contains($tx['buttons'][1][0], 'Мамина'), $tx);
$tx1 = Reminders::text('heat5', 'ru', [['id' => 'p2', 'label' => 'Мамина', 'all' => 2]]);
ok('одна из двух ждёт — «Квартира: «Мамина»», кнопка с place', str_contains($tx1['text'], 'Квартира: «Мамина»') && count($tx1['buttons']) === 1 && str_ends_with($tx1['url'], '?go=heat&place=p2'), $tx1);
$tx0 = Reminders::text('water15', 'uk', Reminders::placesDue($wst, 'water15', '2026-11'));
ok('одна квартира — как раньше: без списка, кнопка без place', !str_contains($tx0['text'], 'Квартира') && count($tx0['buttons']) === 1 && str_ends_with($tx0['url'], '?go=wnew'), $tx0);
$rm = new Browser('10.0.13.1'); $rm->req('POST', '/api/auth/telegram/webapp', ['initData' => initData($TOKEN, ['id' => 7777, 'first_name' => 'Нагадай'])]);
$put = $rm->req('PUT', '/api/state', ['state' => $wst + ['remind' => ['lang' => 'ru']], 'baseVersion' => 0]);
$sent = []; Telegram::$send = function ($m, $p, $tok = null) use (&$sent) { $sent[] = [$m, $p]; return ['ok' => true]; };
$res = Reminders::run($kyiv('2026-11-15 10:17'));
$mine = array_values(array_filter($sent, fn($x) => (string)$x[1]['chat_id'] === '7777'));
ok('рассылка: человеку с водомерами — по-русски, кнопка открывает ввод воды', $put->status === 200 && count($mine) === 1 && str_contains($mine[0][1]['text'], 'Водоканал') && str_contains($mine[0][1]['text'], 'Настройках')
  && ($mine[0][1]['reply_markup']['inline_keyboard'][0][0]['web_app']['url'] ?? '') === 'https://teplo.example/?go=wnew', $mine);
$n1 = count($sent); Reminders::run($kyiv('2026-11-15 11:17'));
ok('через час — повторно не шлём', count($sent) === $n1);
$rm2 = new Browser('10.0.13.2'); $rm2->req('POST', '/api/auth/telegram/webapp', ['initData' => initData($TOKEN, ['id' => 7788, 'first_name' => 'Дві'])]);
$rm2->req('PUT', '/api/state', ['state' => $wm, 'baseVersion' => 0]);
$sent = []; Reminders::run($kyiv('2026-11-19 10:17'));
$two = array_values(array_filter($sent, fn($x) => (string)$x[1]['chat_id'] === '7788'));
$kb = $two[0][1]['reply_markup']['inline_keyboard'] ?? [];
ok('рассылка двум квартирам: одно сообщение, две кнопки — по одной на квартиру', count($two) === 1 && count($kb) === 2 && str_ends_with($kb[1][0]['web_app']['url'], '&place=p2') && str_contains($two[0][1]['text'], 'Мамина'), $two);
$row = Db::one("SELECT status FROM reminders_sent WHERE user_id = (SELECT user_id FROM user_identities WHERE external_id = '7777') AND kind = 'water15'");
ok('итог доставки записан: ok', ($row['status'] ?? '') === 'ok', $row);
ok('ближайшее после 2 ноября — 5-е, тепло; 5-го в 21:00 — уже 15-е', Reminders::next($kyiv('2026-11-02 10:54')) === ['date' => '2026-11-05', 'kind' => 'heat5', 'ym' => '2026-11'] && Reminders::next($kyiv('2026-11-05 21:00'))['date'] === '2026-11-15');
ok('ответы Telegram: 403 → blocked, нет чата → no_chat, сбой связи/429 → повторить', Reminders::status(['ok' => false, 'error_code' => 403, 'description' => 'Forbidden: bot was blocked by the user']) === 'blocked'
  && Reminders::status(['ok' => false, 'error_code' => 400, 'description' => 'Bad Request: chat not found']) === 'no_chat' && Reminders::status([]) === null && Reminders::status(['ok' => false, 'error_code' => 429]) === null);
$pv = Reminders::preview('heat5', '2026-12'); $me7 = array_values(array_filter($pv, fn($x) => $x['lang'] === 'ru'));
ok('предпросмотр на 5 декабря: человек в списке, ещё не отправлено', count($me7) === 1 && $me7[0]['sent'] === null, $pv);
$tries = 0; Telegram::$send = function () use (&$tries) { $tries++; return []; };
Reminders::run($kyiv('2026-12-05 10:17'));
$cnt = fn() => (int)(Db::one("SELECT COUNT(*) n FROM reminders_sent WHERE kind = 'heat5' AND ym = '2026-12'")['n'] ?? 0);
ok('сбой связи — отметки нет, через час повтор', $tries >= 1 && $cnt() === 0);
Telegram::$send = fn() => ['ok' => false, 'error_code' => 403, 'description' => 'Forbidden: bot can\'t initiate conversation with a user'];
Reminders::run($kyiv('2026-12-05 11:17'));
$bl = Db::q("SELECT status FROM reminders_sent WHERE kind = 'heat5' AND ym = '2026-12'")->fetchAll(PDO::FETCH_COLUMN);
ok('не нажимал «Старт» — blocked, больше не пробуем', $bl && !array_diff($bl, ['blocked']), $bl);
Telegram::$send = null;
Cfg::set(['app_url' => 'https://teplo.example/', 'bot_token' => $TOKEN, 'webhook_secret' => 'hook-secret', 'admins' => ['emails' => ['boss@example.ua']]]);
$boss = new Browser('10.0.13.9'); $boss->req('POST', '/api/auth/login', ['email' => 'boss@example.ua', 'password' => 'boss pass 123']);
$ar = $boss->req('GET', '/api/admin/reminders');
ok('/admin: вкладка напоминаний — ближайшее, журнал с итогами', $ar->status === 200 && !empty($ar->body['next']['date']) && count(array_filter($ar->body['log'], fn($x) => $x['status'] === 'blocked')) >= 1, $ar->body['next'] ?? $ar->status);
@unlink(Cron::file()); $h0 = (new Browser('10.0.13.8'))->req('GET', '/api/health');
Cron::write(['last' => gmdate('c', time() - 120)]); $h1 = (new Browser('10.0.13.7'))->req('GET', '/api/health');
ok('/api/health: cron ни разу → null, был 2 мин назад → ~120 с', $h0->body['cronAgo'] === null && abs(($h1->body['cronAgo'] ?? 0) - 120) <= 2, [$h0->body, $h1->body]);

echo "\nВыход:\n";
$phone->req('POST', '/api/auth/logout');
ok('после выхода /api/me → 401', $phone->req('GET', '/api/me')->status === 401);

echo "\nИтог: $pass OK, $fail FAIL\n";
exit($fail ? 1 : 0);
