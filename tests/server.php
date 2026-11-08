<?php
// Тесты сервера без веб-сервера и без зависимостей, только синтетика. Запуск: php tests/server.php
declare(strict_types=1);
define('TEPLO', 1);
require __DIR__ . '/../app/core.php';
require __DIR__ . '/../app/telegram.php';
require __DIR__ . '/../app/reminders.php';
require __DIR__ . '/../app/recognize.php';
require __DIR__ . '/../app/admin.php';
require __DIR__ . '/../app/vkcab.php';
require __DIR__ . '/../app/cabs.php';
require __DIR__ . '/../app/htmsvc.php';
require __DIR__ . '/../app/vksvc.php';
require __DIR__ . '/../app/gpv.php';
require __DIR__ . '/../app/providers.php';
require __DIR__ . '/../app/visits.php';
require __DIR__ . '/../app/journal.php';
require __DIR__ . '/../app/docs.php';
require __DIR__ . '/../app/indexnow.php';
require __DIR__ . '/../app/relay.php';
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
    $server = $extraServer + ['REMOTE_ADDR' => $this->ip, 'HTTP_USER_AGENT' => 'test'];
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
$dv = $boss->req('GET', '/api/admin/devices', null, ['QUERY_STRING' => 'days=30&all=1']);
ok('устройства: телефон 1 браузер / 2 открытия, компьютер вошедший, неизвестное → по UA (Android без Mobile = планшет)', $dv->status === 200
  && $dv->body['device']['mobile']['v'] === 1 && $dv->body['device']['mobile']['h'] === 2 && $dv->body['device']['desktop']['u'] === 1
  && $dv->body['device']['tablet']['v'] === 1 && $dv->body['device']['desktop']['v'] === 2 && isset($dv->body['os']['other']) && $dv->body['tg']['tg']['v'] === 1 && $dv->body['tg']['web']['v'] === 3 && $dv->body['width']['360–430'] === 1, $dv->body);
ok('устройства — только админу', $anon->req('GET', '/api/admin/devices')->status === 401);
// отклик (03.11.2026): без входа — открыл, клацал, добавил счётчик, внёс показания; act-пинг не считается новым открытием
$anon->req('POST', '/api/visit', ['vid' => 'abc12345phone', 'device' => 'mobile', 'os' => 'iOS', 'act' => 1, 'stage' => 1, 'meters' => 0, 'recs' => 0]);
$anon->req('POST', '/api/visit', ['vid' => 'abc12345phone', 'device' => 'mobile', 'os' => 'iOS', 'act' => 1, 'stage' => 3, 'meters' => 2, 'recs' => 1]);
$anon->req('POST', '/api/visit', ['vid' => 'abc12345phone', 'device' => 'mobile', 'os' => 'iOS', 'act' => 1, 'stage' => 1, 'meters' => 1, 'recs' => 0]);   // меньше — не убавляет
$pad->req('POST', '/api/visit', ['vid' => 'pad12345', 'device' => 'tablet', 'os' => 'Android', 'act' => 1, 'stage' => 1]);
$vr = Db::one("SELECT hits, stage, meters, recs FROM visits WHERE vid = 'abc12345phone'");
ok('отклик: этап и числа — максимум за день, act-пинг не добавляет открытий', (int)$vr['hits'] === 2 && (int)$vr['stage'] === 3 && (int)$vr['meters'] === 2 && (int)$vr['recs'] === 1, $vr);
$da = $boss->req('GET', '/api/admin/devices', null, ['QUERY_STRING' => 'days=7&all=1'])->body; $today = Visits::day(); $ta = $da['act'][$today] ?? [];
ok('отклик по дням: открыли 4, клацали 2, внесли показания 1 (без входа 1), вошёл 1', ($ta['v'] ?? 0) === 4 && $ta['s1'] === 2 && $ta['s3'] === 1 && $ta['anon3'] === 1 && $ta['u'] === 1 && $da['actSum']['s3'] === 1 && $da['actSum']['new'] === 4, [$ta, $da['actSum'] ?? null]);
$dx = $boss->req('GET', '/api/admin/devices', null, ['QUERY_STRING' => 'days=7'])->body; $tx = $dx['act'][$today] ?? [];
ok('статистика без своих: браузер, где входил админ, не считается (открыли 3, вошёл 0); ?all=1 — все', ($tx['v'] ?? 0) === 3 && ($tx['u'] ?? -1) === 0 && $dx['device']['desktop']['v'] === 1, [$tx, $dx['device'] ?? null]);
// журнал действий: пачка событий → сеансы в /admin (свои и тест скрыты), лента сеанса, пометки, чистка
$je = fn(Browser $b, string $vid, string $sid, array $ev, array $srv = []) => $b->req('POST', '/api/events', ['vid' => $vid, 'sid' => $sid, 'now' => 10000, 'ev' => $ev], $srv);
$j1 = $je($anon, 'abc12345phone', 'sessA1', [['t' => 1000, 'n' => 'open', 's' => 'home', 'p' => ['tg' => 1, 'w' => 390]], ['t' => 2000, 'n' => 'tap', 's' => 'home', 'p' => ['a' => 'wadd', 'x' => 'Додати лічильник']],
  ['t' => 3000, 'n' => 'field', 's' => 'wnew', 'p' => ['f' => 'wn-c1', 'v' => 1, 'ok' => 0]], ['t' => 4000, 'n' => 'alert', 's' => 'wnew', 'p' => ['m' => 'Показання менше за попередні']],
  ['t' => 5000, 'n' => 'saved', 's' => 'wnew', 'p' => ['m' => 1, 'li' => 0]], ['t' => 6000, 'n' => 'ocr', 's' => 'wnew', 'p' => ['ok' => 0, 'ms' => 2100]], ['t' => 7000, 'n' => 'api_error', 's' => 'wnew', 'p' => ['p' => '/vk/cab/check', 'c' => 422]],
  ['t' => 7500, 'n' => 'BAD name!', 's' => 'x'], ['t' => 8000, 'n' => 'tap', 's' => 'home', 'p' => ['x' => str_repeat('я', 300), 'nested' => ['a' => 1]]]]);
ok('журнал: пачка событий принята (кривое имя пропущено), без vid/sid — 400', $j1->status === 200 && $j1->body['n'] === 8 && $je($anon, '1', 'sessA1', [])->status === 400 && $je($anon, 'abc12345phone', '1', [])->status === 400, $j1->body);
$je($boss, 'boss1234desk', 'sessB1', [['t' => 9000, 'n' => 'screen', 's' => 'home']]);
$je($pad, 'pad12345', 'sessP1', [['t' => 9000, 'n' => 'screen', 's' => 'home']], ['HTTP_USER_AGENT' => 'Mozilla/5.0 HeadlessChrome/153.0']);
ok('журнал: браузер админа помечен «это я» сам, Headless — «тест»', (Db::one("SELECT tag FROM vid_tags WHERE vid = 'boss1234desk'")['tag'] ?? '') === 'me' && (Db::one("SELECT tag FROM vid_tags WHERE vid = 'pad12345'")['tag'] ?? '') === 'test');
$js = $boss->req('GET', '/api/admin/journal', null, ['QUERY_STRING' => 'days=7'])->body; $jall = $boss->req('GET', '/api/admin/journal', null, ['QUERY_STRING' => 'days=7&all=1'])->body;
$sa = array_values(array_filter($js['sessions'] ?? [], fn($x) => $x['sid'] === 'sessA1'))[0] ?? null;
ok('журнал в /admin: сеансы людей (свои и тест скрыты — 2), итог сеанса (ошибки, сообщения, сохранения), шаги', count($js['sessions'] ?? []) === 1 && $js['hidden'] === 2 && count($jall['sessions']) === 3
  && $sa && $sa['n'] === 8 && $sa['errs'] === 1 && $sa['saves'] === 1 && str_starts_with($sa['label'], 'Гость ') && $js['funnel']['meter'] === 1 && $js['funnel']['photoFail'] === 1 && $js['funnel']['errors'] === 1 && $js['funnel']['opened'] === 1, $js);
$jt = $boss->req('GET', '/api/admin/journal/session', null, ['QUERY_STRING' => 'vid=abc12345phone&sid=sessA1'])->body; $ev = $jt['events'] ?? [];
ok('лента сеанса: по порядку, длинный текст обрезан (120), вложенные поля отброшены', count($ev) === 8 && $ev[0]['n'] === 'open' && $ev[3]['p']['m'] === 'Показання менше за попередні' && mb_strlen($ev[7]['p']['x']) === 120 && !isset($ev[7]['p']['nested']) && $ev[0]['at'] <= $ev[7]['at'], $ev[7] ?? $jt);
$boss->req('POST', '/api/admin/journal/tag', ['vid' => 'abc12345phone', 'tag' => 'test']);
$jsx = $boss->req('GET', '/api/admin/journal', null, ['QUERY_STRING' => 'days=7'])->body;
$boss->req('POST', '/api/admin/journal/tag', ['vid' => 'abc12345phone', 'tag' => '']);
ok('пометка вручную: «тест» — сеанс скрыт; снять — снова виден; журнал — только админу', count($jsx['sessions']) === 0 && count($boss->req('GET', '/api/admin/journal', null, ['QUERY_STRING' => 'days=7'])->body['sessions']) === 1
  && $anon->req('GET', '/api/admin/journal')->status === 401 && $boss->req('POST', '/api/admin/journal/tag', ['vid' => 'abc12345phone', 'tag' => 'zzz'])->status === 400);
Db::q("UPDATE events SET day = '2020-01-01' WHERE sid = 'sessB1'");
ok('чистка журнала: старше 60 дней — удалено', Journal::cleanup() === 1 && !Db::one("SELECT 1 AS x FROM events WHERE sid = 'sessB1'"));
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
// ответ бота Водоканала, пересланный нам: подтверждение передачи воды
$fw = fn($text, $date, $user = ['id' => 555, 'is_bot' => true, 'username' => 'hvk_user_bot', 'first_name' => 'КП Харківводоканал']) => ['chat' => ['id' => 9001], 'date' => time(), 'from' => ['id' => 9001, 'first_name' => 'Фото', 'language_code' => 'uk'],
  'forward_origin' => ['type' => 'user', 'sender_user' => $user, 'date' => $date], 'text' => $text];
$n0 = count($sent); $hook($fw("Показання прийнято. Дякуємо!\nЛічильник 12345 — 458", time() - 30));
$vr = Db::one("SELECT r.* FROM vk_replies r JOIN user_identities i ON i.user_id = r.user_id WHERE i.external_id = '9001' ORDER BY r.id DESC");
ok('переслали ответ @hvk_user_bot «прийнято» → сохранён как ok, время — когда ответил бот', $vr && $vr['kind'] === 'ok' && (int)$vr['msg_at'] === time() - 30 && str_contains($vr['text'], '12345'), $vr);
ok('…наш бот отвечает «Зберіг підтвердження» с кнопкой в воду', str_contains($sent[count($sent) - 1][1]['text'] ?? '', 'Зберіг підтвердження') && ($sent[count($sent) - 1][1]['reply_markup']['inline_keyboard'][0][0]['web_app']['url'] ?? '') === 'https://teplo.example/?go=water-cold');
$hook($fw("Помилка: невірне прізвище або особовий рахунок", time() - 20));
$hook($fw("Особовий рахунок 905614. Лічильники: ID 12345 (холодна), ID 12346 (гаряча)", time() - 10));
$hook(['chat' => ['id' => 9001], 'date' => time(), 'from' => ['id' => 9001, 'language_code' => 'uk'], 'forward_origin' => ['type' => 'user', 'sender_user' => ['id' => 7, 'is_bot' => true, 'username' => 'other_bot'], 'date' => time()], 'text' => 'Показання прийнято']);
$vl = $tgb->req('GET', '/api/vk/replies')->body['replies'] ?? [];
ok('/api/vk/replies: ошибка → err, ID счётчиков → info, чужой бот не сохраняется; новые сверху', count($vl) === 3 && $vl[0]['kind'] === 'info' && $vl[1]['kind'] === 'err' && $vl[2]['kind'] === 'ok', $vl);
ok('чужим ответы не видны, без входа — 401', count($rb->req('GET', '/api/vk/replies')->body['replies'] ?? []) === 0 && (new Browser('10.0.12.9'))->req('GET', '/api/vk/replies')->status === 401);
ok('Telegram::vkKind: «не прийнято» — ошибка, «успішно збережено» — ok', Telegram::vkKind('Показання не прийнято') === 'err' && Telegram::vkKind('Дані успішно збережено') === 'ok' && Telegram::vkKind('Баланс: 120 грн') === 'info');
// ответы ботов света (@Kooz2bot) и газа (@mygrmu_bot), пересланные нам: подтверждение передачи
$obl = ['id' => 556, 'is_bot' => true, 'username' => 'Kooz2bot', 'first_name' => 'ХарківОбленергоБот'];
$grm = ['id' => 557, 'is_bot' => true, 'username' => 'mygrmu_bot', 'first_name' => 'Газмережі'];
$hook($fw("Дякуємо! Ваші показники успішно передано.", time() - 25, $obl));
ok('переслали ответ @Kooz2bot «показники передано» → src obl, ok; наш бот — «підтвердження Харківобленерго», кнопка в свет',
  ($x = Db::one("SELECT * FROM vk_replies ORDER BY id DESC")) && $x['src'] === 'obl' && $x['kind'] === 'ok'
  && str_contains($sent[count($sent) - 1][1]['text'] ?? '', 'Харківобленерго') && ($sent[count($sent) - 1][1]['reply_markup']['inline_keyboard'][0][0]['web_app']['url'] ?? '') === 'https://teplo.example/?go=elec', $x);
$hook($fw("Номер телефону збережено. Тепер ви можете передавати показники лічильника", time() - 24, $obl));
ok('…«номер телефону збережено» — не подтверждение показаний (info)', Db::one("SELECT kind FROM vk_replies ORDER BY id DESC")['kind'] === 'info');
$hook($fw("Показання лічильника прийнято", time() - 23, $grm));
ok('переслали ответ @mygrmu_bot → src grm, ok, кнопка в газ', ($x = Db::one("SELECT * FROM vk_replies ORDER BY id DESC")) && $x['src'] === 'grm' && $x['kind'] === 'ok'
  && ($sent[count($sent) - 1][1]['reply_markup']['inline_keyboard'][0][0]['web_app']['url'] ?? '') === 'https://teplo.example/?go=gas', $x);
$q = fn($b, $src) => $b->req('GET', '/api/bot/replies', null, ['QUERY_STRING' => 'src=' . $src]);
$bo = $q($tgb, 'obl')->body['replies'] ?? []; $bg = $q($tgb, 'grm')->body['replies'] ?? [];
ok('/api/bot/replies: свет — 2 (новые сверху), газ — 1; в /api/vk/replies они не попадают (вода — те же 3)',
  count($bo) === 2 && $bo[0]['kind'] === 'info' && $bo[1]['kind'] === 'ok' && count($bg) === 1 && $bg[0]['kind'] === 'ok'
  && count($tgb->req('GET', '/api/vk/replies')->body['replies'] ?? []) === 3, [$bo, $bg]);
ok('/api/bot/replies: src=vk или мусор — 422, без входа — 401, чужим — пусто', $q($tgb, 'vk')->status === 422 && $q($tgb, 'x')->status === 422
  && $q(new Browser('10.0.12.8'), 'obl')->status === 401 && count($q($rb, 'obl')->body['replies'] ?? []) === 0);
ok('Telegram::botKind: «Показники день … ніч … прийнято», «Прийнято показники» — ok; «Дані збережено», «Введіть показники» — info; «не прийнято» — err',
  Telegram::botKind('obl', 'Показники день 10250 ніч 5130 прийнято') === 'ok' && Telegram::botKind('grm', 'Прийнято показники за жовтень') === 'ok'
  && Telegram::botKind('obl', 'Дані збережено') === 'info' && Telegram::botKind('obl', 'Введіть показники') === 'info' && Telegram::botKind('grm', 'Показання не прийнято') === 'err'
  && Telegram::botKind('vk', 'Дані успішно збережено') === 'ok');
// работает ли бот Водоканала: признаки жизни — пересланные ответы и «Прийняв», жалобы «не відповідає» после них
$sil = new Browser('10.0.12.20'); $sil->req('POST', '/api/auth/telegram/webapp', ['initData' => initData($TOKEN, ['id' => 9002, 'first_name' => 'Тиша'])]);
ok('статус бота без входа: ok (только что пересылали ответы)', ($tgb->req('GET', '/api/vk/status')->body['bot']['state'] ?? '') === 'ok' && (new Browser('10.0.12.21'))->req('GET', '/api/vk/status')->status === 200);
ok('событие без входа — 401, мусор — 422', (new Browser('10.0.12.22'))->req('POST', '/api/vk/event', ['kind' => 'silent'])->status === 401 && $sil->req('POST', '/api/vk/event', ['kind' => 'boom'])->status === 422);
Db::q('UPDATE vk_replies SET msg_at = msg_at - 7200'); Db::q("UPDATE vk_events SET at = at - 7200");
$ev = $sil->req('POST', '/api/vk/event', ['kind' => 'silent'])->body;
ok('«Не відповідає» после последнего ответа → бот «не відповідає з …», 1 человек', ($ev['status']['bot']['state'] ?? '') === 'silent' && $ev['status']['bot']['users'] === 1 && $ev['status']['bot']['since'] >= time() - 5, $ev);
$n0 = count($sent); $hook($fw("Показання прийнято", time()));
$tell = array_values(array_filter(array_slice($sent, $n0), fn($x) => ($x[1]['chat_id'] ?? null) === '9002'));
ok('кто-то переслал ответ бота → тому, кто жаловался, наш бот пишет «знову відповідає» с кнопкой', count($tell) === 1 && str_contains($tell[0][1]['text'], 'знову відповідає') && str_contains($tell[0][1]['reply_markup']['inline_keyboard'][0][0]['web_app']['url'] ?? '', '?go=water-cold'), $tell);
ok('…статус снова ok, повторно не пишем', ($tgb->req('GET', '/api/vk/status')->body['bot']['state'] ?? '') === 'ok' && VkStatus::aliveAgain(['state' => 'silent']) === 0);
// кабинет: сервер открывает страницу входа
VkStatus::$fetch = fn($u) => ['code' => 200, 'body' => '<title>Сторінка авторизації | Інформаційна система КП "Харківводоканал"</title>', 'err' => null, 'ms' => 300];
$c1 = VkStatus::probeCabinet(1000);
VkStatus::$fetch = fn($u) => ['code' => 0, 'body' => '', 'err' => 'Connection timed out', 'ms' => 12000];
$c2 = VkStatus::probeCabinet(1600); $c3 = VkStatus::probeCabinet(2200);
VkStatus::$fetch = fn($u) => ['code' => 502, 'body' => 'Bad gateway', 'err' => null, 'ms' => 100];
$c4 = VkStatus::probeCabinet(2800);
ok('кабинет: открылся → ok; не открылся → down «с» первого провала; 502 — тоже down; everOk помнит', $c1['state'] === 'ok' && $c2['state'] === 'down' && $c3['since'] === 1600 && $c4['state'] === 'down' && $c4['since'] === 1600 && $c4['everOk'] && $c4['lastOk'] === 1000, [$c1, $c3, $c4]);
VkStatus::$fetch = fn($u) => ['code' => 200, 'body' => '<html>Харківводоканал вхід</html>', 'err' => null, 'ms' => 200];
ok('кабинет снова открылся → ok с нового времени; статус для приложения', VkStatus::probeCabinet(3400)['since'] === 3400 && ($tgb->req('GET', '/api/vk/status')->body['cab']['state'] ?? '') === 'ok');
VkStatus::$fetch = null;
// кабинет Водоканала «без реєстрації»: наш сервер вводит рахунок і прізвище, заполняет показания (синтетический кабинет tests/vk-mock)
echo "\nКабинет Водоканала (VkCab, синтетический кабинет):\n";
require_once __DIR__ . '/vk-mock/pages.php';
$VKM = []; $vkCalls = [];
VkCab::$http = function ($m, $url, $body, $cookie) use (&$VKM, &$vkCalls) { $vkCalls[] = [$m, $url, $cookie];
  [$code, $html, $h] = vkm_request($m, $url, $body, $cookie, $VKM); $out = ['code' => $code, 'body' => $html, 'cookies' => [], 'location' => null];
  foreach ($h as $x) { if (stripos($x, 'Set-Cookie:') === 0) $out['cookies'][] = trim(substr($x, 11)); if (stripos($x, 'Location:') === 0) $out['location'] = trim(substr($x, 9)); }
  return $out; };
$cab = fn($path, $body) => $tgb->req('POST', $path, $body);
$vkSent = function () use (&$VKM) { $n = 0; foreach ($VKM as $k => $x) if ($k[0] !== '_' && is_array($x)) $n += (int)($x['sent'] ?? 0); return $n; };
ok('без входа — 401; кривой рахунок / прізвище — 422 с подсказкой', (new Browser('10.0.12.30'))->req('POST', '/api/vk/cab/check', ['acc' => '905614', 'fam' => 'Шевченко'])->status === 401
  && ($r = $cab('/api/vk/cab/check', ['acc' => '12', 'fam' => 'Шевченко']))->status === 422 && str_contains($r->body['human'] ?? '', 'особовий рахунок')
  && $cab('/api/vk/cab/check', ['acc' => '905614', 'fam' => 'x'])->status === 422 && count($vkCalls) === 0);
$r = $cab('/api/vk/cab/check', ['acc' => '905614', 'fam' => 'Шевченко']); $ck = $r->body;
ok('проверка: сайт нашёл рахунок → 2 лічильники (ключ поля, №, вид, прошлые показания), даты, адрес', $r->status === 200 && count($ck['meters'] ?? []) === 2
  && $ck['meters'][0]['key'] === 'DynamicModel[newIndication][1282444]' && $ck['meters'][0]['serial'] === '0123456' && $ck['meters'][0]['kind'] === 'cold' && $ck['meters'][0]['prev'] == 430
  && $ck['meters'][1]['kind'] === 'hot' && $ck['meters'][1]['prevDate'] === '01.10.2026' && ($ck['dates'][0]['v'] ?? '') === '2026-11-04' && $ck['dates'][0]['sel'] && str_contains((string)$ck['addr'], 'Сумська'), $ck);
ok('…как браузер: GET /login → cookie → POST с _csrf-frontend и NoLoginForm[acc|fam] → редирект с той же сессией; на сайт ничего не отправлено', $vkCalls[0][0] === 'GET' && str_ends_with($vkCalls[0][1], '/login')
  && str_contains($vkCalls[1][2], '_csrf-frontend=c00kie') && $VKM['_last']['path'] === '/send-indications' && $vkSent() === 0);
$r = $cab('/api/vk/cab/check', ['acc' => '905615', 'fam' => 'Шевченко']);
ok('чужой рахунок (как живой сайт: страница без форм «Не коректні дані…») → 422 cab_not_found: наше объяснение + слова сайта', $r->status === 422 && $r->body['error'] === 'cab_not_found' && str_contains($r->body['human'], '905615') && str_contains($r->body['human'], 'українською') && str_contains(implode(' ', $r->body['site'] ?? []), 'Не коректні дані'), $r->body);
$r = $cab('/api/vk/cab/check', ['acc' => '977770', 'fam' => 'Шевченко']);
ok('…и старый вариант: снова форма входа с ошибкой → тоже cab_not_found', $r->status === 422 && $r->body['error'] === 'cab_not_found' && str_contains(implode(' ', $r->body['site'] ?? []), 'не знайдено'), $r->body);
$r = $cab('/api/vk/cab/check', ['acc' => '905615', 'fam' => 'Шевчэнко']);
ok('…в прізвищі русские буквы → подсказка «впишіть українською»', $r->status === 422 && str_contains($r->body['human'], 'російські літери'), $r->body['human'] ?? null);
// живой сайт 07.11.2026 (рахунок владельца): показания за листопад уже приняты — полей ввода нет, блоки «Передані показання … ПРИЙНЯТІ»
$r = $cab('/api/vk/cab/check', ['acc' => '905616', 'fam' => 'Шевченко']); $dn = $r->body['done'] ?? [];
ok('показания периода уже на сайте → 200, meters пусто, done: вид, №, цифры, период, «прийняті», повірка; адрес «пр. …»', $r->status === 200 && ($r->body['meters'] ?? null) === [] && count($dn) === 2
  && $dn[0]['kind'] === 'hot' && $dn[0]['serial'] === '8221019' && $dn[0]['value'] == 132 && $dn[0]['period'] === '2026-11' && $dn[0]['accepted'] === true && $dn[0]['verify'] === '2026-02-07'
  && $dn[1]['kind'] === 'cold' && $dn[1]['serial'] === '8254605' && $dn[1]['value'] == 179 && $dn[1]['verify'] === '2026-11-07' && str_contains((string)($r->body['addr'] ?? ''), 'Перемоги'), $r->body);
$p0 = count($vkCalls);
$dr = VkCab::deliver(1, '905616', 'Шевченко', [['key' => null, 'value' => '132', 'serial' => '8221019', 'name' => 'Гаряча', 'kind' => 'hot'], ['key' => null, 'value' => '179', 'serial' => null, 'name' => 'Холодна', 'kind' => 'cold']], null, 'bgsend', true);
ok('…очередь с теми же цифрами → ok «вже прийняті», на сайт ничего не шлём', $dr['result'] === 'ok' && !empty($dr['already']) && str_contains($dr['text'], 'прийняті') && count($vkCalls) === $p0 + 2, $dr);
try { VkCab::deliver(1, '905616', 'Шевченко', [['key' => null, 'value' => '140', 'serial' => '8221019', 'name' => 'Гаряча', 'kind' => 'hot']], null, 'bgsend', true); $de = null; } catch (HttpError $e) { $de = $e; }
ok('…другие цифры → 409 cab_done: что уже на сайте, повторно не принимает', $de && $de->status === 409 && $de->err === 'cab_done' && str_contains($de->extra['human'], 'гаряча № 8221019 — 132') && str_contains($de->extra['human'], 'холодна № 8254605 — 179'), $de ? $de->extra : null);
$vkReal = VkCab::$http; VkCab::$http = fn($m, $url, $b, $c) => str_contains($url, 'get-form-send') ? ['code' => 200, 'body' => '<html><body><div class="alert alert-danger">Сервіс тимчасово недоступний</div></body></html>'] : $vkReal($m, $url, $b, $c);
$r = $cab('/api/vk/cab/check', ['acc' => '905615', 'fam' => 'Шевченко']);
ok('…страница без форм с другой ошибкой — не «не знайдено», а cab_changed со словами сайта', $r->status === 424 && $r->body['error'] === 'cab_changed' && str_contains(implode(' ', $r->body['site'] ?? []), 'недоступний'), $r->body);
// живой «Перевірити» 07.11 01:42 UTC: сайт показал страницу, которую не узнали → журнал пишет, что на ней есть (поля, скрипты, AJAX-адреса)
VkCab::$http = fn($m, $url, $b, $c) => str_contains($url, 'get-form-send') ? ['code' => 200, 'ctype' => 'text/html; charset=UTF-8', 'body' => '<html><head><title>Абонент Шевченко, о/р 905615</title><script src="/js/common.js?v=17"></script></head><body>'
  . '<h3>Показання лічильників</h3><p>вул. Сумська, 10</p><input type="hidden" name="acc" value="905615"><div id="counters"></div><a href="/site/logout">Вихід</a><a href="/abonent/905615/history">Історія</a>'
  . '<script>$(function(){ $.post("/get-counters", {acc: "905615"}, function(h){ $("#counters").html(h); }); });</script></body></html>'] : $vkReal($m, $url, $b, $c);
$r = $cab('/api/vk/cab/check', ['acc' => '905615', 'fam' => 'Шевченко']); $vle = VkCab::summary()['lastErr'] ?? []; $vlj = json_encode($vle, JSON_UNESCAPED_UNICODE);
$vlast = VkCab::log(); $vlast = $vlast[count($vlast) - 1]['page'] ?? []; $vlaj = json_encode($vlast, JSON_UNESCAPED_UNICODE);
ok('…страница без формы показаний → cab_changed; /api/health → vkcab.lastErr: шаги и структура (скрипты, AJAX-адреса, поля, ссылки), без слов сайта, рахунку и прізвища', $r->status === 424
  && ($vle['result'] ?? '') === 'changed' && ($vle['where'] ?? '') === 'check' && in_array('/get-counters', $vle['page']['ajax'] ?? [], true) && in_array('/js/common.js', $vle['page']['scripts'] ?? [], true)
  && in_array('input:acc', $vle['page']['names'] ?? [], true) && in_array('/abonent/######/history', $vle['page']['links'] ?? [], true) && str_starts_with($vle['page']['ctype'] ?? '', 'text/html') && !isset($vle['page']['text'])
  && !preg_match('/905615|Шевченко|Показання|Сумськ/u', $vlj), $vle);
ok('…в журнале /admin — ещё и заголовки страницы: прізвище и рахунок — ***, цифры — #, адрес не пишем', in_array('Показання лічильників', $vlast['text'] ?? [], true)
  && !preg_match('/905615|Шевченко|Сумськ/u', $vlaj) && str_contains($vlaj, 'Абонент ***'), $vlast);
VkCab::$http = $vkReal;
$pc0 = count($vkCalls); $pr = VkStatus::probeNotFound(); $vs = $tgb->req('GET', '/api/vk/status')->body;
ok('проба «не знайдено» (cron): выдуманный рахунок → cab_not_found, слова сайта и структура — в /api/vk/status без цифр; показания не шлём', ($pr['error'] ?? '') === 'cab_not_found'
  && ($pr['result'] ?? '') === 'notfound' && str_contains(implode(' ', $pr['site']), 'Не коректні дані') && ($vs['probe']['error'] ?? '') === 'cab_not_found' && count($vs['probe']['steps'] ?? []) === 2
  && !preg_match('/\d{4}/', json_encode($vs['probe']['site'] + $vs['probe']['msgs'], JSON_UNESCAPED_UNICODE)) && !array_filter(array_slice($vkCalls, $pc0), fn($c) => str_contains($c[1], '/send-indications')), $pr);
ok('…раз на версию разбора: повторно не пробуем', VkStatus::probeNotFound() === null && count($vkCalls) === $pc0 + 2);
$k1 = $ck['meters'][0]['key']; $k2 = $ck['meters'][1]['key']; $n0 = count($sent);
$r = $cab('/api/vk/cab/send', ['acc' => '905614', 'fam' => 'шевченко', 'items' => [['key' => $k1, 'value' => '458', 'serial' => '0123456', 'name' => 'Холодна'], ['key' => $k2, 'value' => '175', 'serial' => '0654321', 'name' => 'Гаряча']], 'date' => '2026-11-03']);
$post = $VKM['_lastPost']['post'] ?? [];
ok('отправка: сайт принял → ok, текст ответа сайта', $r->status === 200 && $r->body['ok'] === true && $r->body['result'] === 'ok' && str_contains($r->body['text'], 'прийнято'), $r->body);
ok('…в форму ушли наши цифры, выбранная дата, CSRF и кнопка — как из браузера', ($post['DynamicModel']['newIndication']['1282444'] ?? '') === '458' && ($post['DynamicModel']['newIndication']['1282445'] ?? '') === '175'
  && ($post['DynamicModel']['dataIndication']['1282444'] ?? '') === '2026-11-03' && ($post['_csrf-frontend'] ?? '') === VKM_TOKEN && array_key_exists('send-button', $post), $post);
$tm = array_values(array_filter(array_slice($sent, $n0), fn($x) => ($x[1]['chat_id'] ?? null) === '9001'));
ok('…наш бот пишет в Telegram «✅ Водоканал прийняв» с цифрами и кнопкой в воду', count($tm) === 1 && str_contains($tm[0][1]['text'], 'Водоканал прийняв') && str_contains($tm[0][1]['text'], 'Холодна — 458') && str_contains($tm[0][1]['text'], 'рахунок 905614'), $tm);
$r = $cab('/api/vk/cab/send', ['acc' => '905614', 'fam' => 'Шевченко', 'items' => [['key' => $k1, 'value' => '400']]]);
ok('меньше прошлых → сайт вернул форму с ошибкой у поля → ok=false, result err, слова сайта', $r->status === 200 && $r->body['ok'] === false && $r->body['result'] === 'err' && str_contains($r->body['text'], 'меншими'), $r->body);
$s0 = $vkSent(); $p0 = count($vkCalls);
$r = $cab('/api/vk/cab/send', ['acc' => '905614', 'fam' => 'Шевченко', 'items' => [['key' => $k1, 'value' => '470', 'serial' => '9999999']]]);
ok('номер лічильника не совпал с тем, что на сайте → 409 cab_mismatch (форму показаний не отправляли)', $r->status === 409 && $r->body['error'] === 'cab_mismatch' && count($r->body['meters'] ?? []) === 2 && $vkSent() === $s0
  && !array_filter(array_slice($vkCalls, $p0), fn($c) => $c[0] === 'POST' && str_contains($c[1], '/send-indications')), $r->body);
$r = $cab('/api/vk/cab/send', ['acc' => '905614', 'fam' => 'Шевченко', 'items' => [['key' => 'evil', 'value' => '1'], ['key' => $k1, 'value' => 'abc']]]);
ok('мусор вместо показаний / чужие поля → 422 cab_no_items', $r->status === 422 && $r->body['error'] === 'cab_no_items');
VkCab::$http = fn($m, $url, $b, $c) => ['code' => 0, 'body' => '', 'err' => 'Connection timed out'];
$r = $cab('/api/vk/cab/check', ['acc' => '905614', 'fam' => 'Шевченко']);
ok('сайт не отвечает → 424 cab_down с подсказкой про бот (502 Cloudflare подменил бы своей страницей)', $r->status === 424 && $r->body['error'] === 'cab_down' && str_contains($r->body['human'], 'бот'));
VkCab::$http = fn($m, $url, $b, $c) => ['code' => 200, 'body' => '<html><body><form id="other"><input name="x"></form></body></html>'];
ok('страница входа другая → 424 cab_changed', ($r = $cab('/api/vk/cab/check', ['acc' => '905614', 'fam' => 'Шевченко']))->status === 424 && $r->body['error'] === 'cab_changed');
VkCab::$http = fn($m, $url, $b, $c) => ['code' => 302, 'body' => '', 'location' => 'https://evil.example/steal'];
ok('редирект на чужой сайт — не идём (cab_changed)', ($r = $cab('/api/vk/cab/check', ['acc' => '905614', 'fam' => 'Шевченко']))->status === 424 && $r->body['error'] === 'cab_changed');
$lg = VkCab::log(); $all = json_encode($lg, JSON_UNESCAPED_UNICODE);
ok('журнал для /admin: проверки и отправки с итогом и структурой формы; рахунок, прізвище, адрес и цифры не пишем', count($lg) >= 6 && in_array('ok', array_column($lg, 'result'), true) && in_array('notfound', array_column($lg, 'result'), true)
  && !str_contains($all, '905614') && !str_contains($all, 'Шевченко') && !str_contains($all, 'Сумська') && !str_contains($all, '0123456') && str_contains($all, 'newIndication'), $lg[count($lg) - 1] ?? null);
ok('/api/vk/status: у кабинета флаг send (можно отправлять через сайт)', ($tgb->req('GET', '/api/vk/status')->body['cab']['send'] ?? null) === true);
// диагностика «незнайома сторінка» (cron, VkStatus::recheck): живой сайт 07.11 — форма показаний без полей (их строит common.js) → сервер сам,
// только чтение, входит рахунком и прізвищем из квартир учёток админа; скелет страницы — в журнал и /api/health, куски скрипта сайта — в /api/vk/status
$adm = Db::one("SELECT id FROM users WHERE email = 'admin@teplo.test'"); if (!$adm) { Db::q("INSERT INTO users (email, created_at) VALUES ('admin@teplo.test', ?)", [Http::iso()]); $adm = Db::one("SELECT id FROM users WHERE email = 'admin@teplo.test'"); }
Db::q('DELETE FROM user_state WHERE user_id = ?', [$adm['id']]);
Db::q('INSERT INTO user_state (user_id, data, version, updated_at) VALUES (?, ?, 1, ?)', [$adm['id'], json_encode(['places' => [['id' => 'p1', 'water' => ['account' => '905614', 'surname' => 'Шевченко']], ['id' => 'p2', 'water' => ['account' => '', 'surname' => '']]]], JSON_UNESCAPED_UNICODE), Http::iso()]);
$vkJs = []; VkCab::$http = function ($m, $url, $b, $c) use ($vkReal, &$vkJs) {
  if (str_contains($url, '/js/common.js')) { $vkJs[] = $url; return ['code' => 200, 'body' => "var x = 1;\n$(document).on('click', '.ind-edit', function () { var id = $(this).data('counter');\n  $('#send-counters-form').append('<input name=\"DynamicModel[newIndication][' + id + ']\">'); });"]; }
  if (str_contains($url, 'get-form-send')) return ['code' => 200, 'body' => '<html><head><script src="/js/common.js?v=3"></script><script src="/assets/ab12/jquery.min.js"></script></head><body><div class="wrap"><form id="send-counters-form" action="/counters#">'
    . '<input type="hidden" name="_csrf-frontend" value="t"><input type="hidden" name="DynamicModel[acc]" value="905614"></form><table class="table"><tr><th>Лічильник</th></tr><tr data-id="1282444"><td>Шевченко</td><td><input type="text" class="ind" data-counter="0123456"></td></tr></table></div></body></html>'];
  return $vkReal($m, $url, $b, $c); };
$lu0 = VkCab::summary()['lastUser']; $rc = VkStatus::recheck(); $rl = VkCab::log(); $rl = $rl[count($rl) - 1]; $rlj = json_encode($rl, JSON_UNESCAPED_UNICODE);
ok('диагностика: одна квартира админа с рахунком → вход только на чтение (форму показаний не шлём), итог cab_changed', count($rc['res'] ?? []) === 1 && $rc['res'][0]['error'] === 'cab_changed'
  && ($rl['op'] ?? '') === 'recheck' && !array_filter(array_slice($vkCalls, -3), fn($c) => str_contains($c[1], '/counters')), $rc);
ok('…скелет страницы: теги, классы, data-* без текста; рахунок, прізвище и цифры не пишем', str_contains($rl['page']['skel'] ?? '', '<form id="send-counters-form"') && str_contains($rl['page']['skel'], 'data-counter="#######"')
  && str_contains($rl['page']['skel'], 'value?') && !preg_match('/905614|Шевченко|0123456/u', json_encode($rl['page']['skel'], JSON_UNESCAPED_UNICODE)), $rl['page']['skel'] ?? null);
ok('…куски скрипта сайта (не jQuery) — в /api/vk/status → recheck.js; «человек» в /api/health не сдвинулся; второй раз не входим', ($rc['js'][0]['src'] ?? '') === '/js/common.js' && count($vkJs) === 1
  && str_contains(implode(' ', $rc['js'][0]['bits']), 'newIndication') && ($tgb->req('GET', '/api/vk/status')->body['recheck']['js'][0]['src'] ?? '') === '/js/common.js'
  && VkCab::summary()['lastUser'] === $lu0 && (VkCab::summary()['lastErr']['op'] ?? '') === 'recheck' && VkStatus::recheck() === null, $rc['js'] ?? null);
$t7 = gmmktime(5, 30, 0, 11, 8, 2026);   // 07:30 по Киеву
$closed = ['v' => VkStatus::RECHECK_V, 'at' => $t7 - 21 * 3600, 'res' => [['error' => 'ok', 'meters' => 0], ['error' => 'cab_not_found', 'meters' => 0]]];
ok('Водоканал: период закрыт («прийняті») — заходим снова раз в сутки в 7-м часу по Киеву, до открытой формы', VkStatus::recheckDue($closed, $t7) && !VkStatus::recheckDue($closed, $t7 + 3 * 3600)
  && !VkStatus::recheckDue(['at' => $t7 - 2 * 3600] + $closed, $t7) && !VkStatus::recheckDue(['res' => [['error' => 'ok', 'meters' => 2]]] + $closed, $t7)
  && !VkStatus::recheckDue(['res' => [['error' => 'cab_changed', 'meters' => 0]]] + $closed, $t7) && !VkStatus::recheckDue(['res' => [['error' => 'cab_not_found', 'meters' => 0]]] + $closed, $t7) && VkStatus::recheckDue(['v' => 0] + $closed, $t7));
// квитанции Водоканала в фоне, без человека (VkBills, cron; владелец 07.11.2026)
echo "\nКвитанции Водоканала в фоне (VkBills):\n";
$vkPdf = "%PDF-1.4\n% kvyt-zhovten\n%%EOF\n"; $vkPdfN = 0;
$vkJsForm = '<html><body><div class="wrap"><form id="send-counters-form" action="/counters#"><input type="hidden" name="_csrf-frontend" value="t"><input type="hidden" name="DynamicModel[acc]" value="905614"></form>'
  . '<table class="table"><tr><th>Лічильник</th></tr><tr data-id="1282444"><td><input type="text" class="ind" data-counter="0123456"></td></tr></table><p>Завантажити квитанцію:</p><iframe src="/tmp/1.654321.checkPDF.pdf"></iframe></div></body></html>';
VkCab::$http = function ($m, $url, $b, $c) use ($vkReal, &$vkPdf, &$vkPdfN, $vkJsForm) {
  $path = (string)parse_url($url, PHP_URL_PATH);
  if (preg_match('~^/tmp/[\w.]+\.checkPDF\.pdf$~', $path)) { $vkPdfN++; return ['code' => 200, 'body' => $vkPdf]; }
  if (str_contains($url, 'get-form-send') && str_contains((string)$b, '905614')) return ['code' => 200, 'body' => $vkJsForm];   // живой открытый период: форма без полей
  return $vkReal($m, $url, $b, $c); };
$mkU = function (string $email, array $st) { Db::q('INSERT INTO users (email, created_at) VALUES (?, ?)', [$email, Http::iso()]); $id = (int)Db::one('SELECT id FROM users WHERE email = ?', [$email])['id'];
  Db::q('INSERT INTO user_state (user_id, data, version, updated_at) VALUES (?, ?, 1, ?)', [$id, json_encode($st, JSON_UNESCAPED_UNICODE), Http::iso()]); return $id; };
$stOf = fn(int $id) => Db::one('SELECT data, version FROM user_state WHERE user_id = ?', [$id]);
$recW = fn(string $id, string $place, string $date, array $x = []) => ['id' => $id, 'place' => $place, 'date' => $date, 'vals' => ['m1' => 12.5], 'createdAt' => $date . 'T08:00:00Z', 'updatedAt' => 1000] + $x;
$plW = fn(string $id, string $acc, string $fam, array $w = []) => ['id' => $id, 'name' => 'Мамина', 'updatedAt' => 5, 'water' => ['account' => $acc, 'surname' => $fam, 'meters' => [['id' => 'm1', 'kind' => 'cold']]] + $w];
// выбор квартир
$st = ['places' => [$plW('a', '905616', 'Шевченко'), $plW('b', '905617', 'Шевченко', ['billAuto' => false]), $plW('c', '12', 'Шевченко'), $plW('d', '905618', 'Коваль')],
  'water' => [$recW('w1', 'a', '2026-10-14'), $recW('w2', 'b', '2026-10-14'), $recW('w3', 'c', '2026-10-14'), $recW('w4', 'd', '2026-10-01', ['base' => true]), $recW('w5', 'a', '2026-09-14')]];
$tg = VkBills::targets($st, '2026-10');
ok('квитанции: подходит квартира с рахунком і прізвищем и записью за прошлый месяц; «Квитанції самі» выключено, кривой рахунок, только стартовая — нет', count($tg) === 1 && $tg[0] === ['place' => 'a', 'acc' => '905616', 'fam' => 'Шевченко'], $tg);
$wy = array_map(fn($x) => $x[0], VkBills::why($st, '2026-10'));
ok('…причины по квартирам: ok, off («Квитанції самі» выключено), noacc (кривой рахунок), norec (только стартовая)', $wy === ['ok', 'off', 'noacc', 'norec'], $wy);
$st2 = $st; $st2['water'][0]['bills'] = [['id' => 'x', 'auto' => 'vk']];
$st3 = ['places' => [$plW('main', '905616', 'Шевченко')], 'water' => [['id' => 'old', 'date' => '2026-10-03', 'vals' => []]]];
ok('…у записи месяца уже есть квитанция с сайта — нет; старая запись без place — к первой квартире', VkBills::targets($st2, '2026-10') === [] && count(VkBills::targets($st3, '2026-10')) === 1 && VkBills::recIdx($st['water'], 'a', 'a', '2026-10') === 0);
// окно и состояние сайта
$tB = gmmktime(8, 0, 0, 11, 7, 2026);   // 10:00 по Киеву, 7 листопада → квитанция за жовтень
VkStatus::$fetch = fn($u) => ['code' => 200, 'body' => '<html>Харківводоканал вхід</html>', 'err' => null, 'ms' => 200]; VkStatus::probeCabinet($tB - 300); VkStatus::$fetch = null;
Db::q('DELETE FROM user_state'); Db::q('DELETE FROM docs'); @unlink(VkBills::file());
$uA = $mkU('bill-a@example.ua', ['readings' => [], 'tariff' => new stdClass(), 'remind' => new stdClass(), 'updatedAt' => 777,
  'places' => [$plW('a', '905616', 'Шевченко')], 'water' => [$recW('w1', 'a', '2026-10-14'), $recW('w0', 'a', '2026-09-12')]]);
$n0 = count($vkCalls);
ok('квитанции: 26-го, ночью (23:30 по Киеву) и рано утром — не ходим', VkBills::cron(gmmktime(8, 0, 0, 11, 26, 2026)) === [] && VkBills::cron(gmmktime(21, 30, 0, 11, 7, 2026)) === [] && VkBills::cron(gmmktime(4, 0, 0, 11, 7, 2026)) === [] && count($vkCalls) === $n0);
$lu0 = VkCab::summary()['lastUser']; $v0 = (int)$stOf($uA)['version'];
$cr = VkBills::cron($tB); $sA = json_decode($stOf($uA)['data'], true); $bl = $sA['water'][0]['bills'] ?? [];
$dA = Db::one('SELECT * FROM docs WHERE user_id = ?', [$uA]);
ok('квитанции: 7-го в 10:00 — вход (только чтение), PDF в документы (src vk, ym 2026-10, место a), к записи жовтня — bills auto vk', $cr === [[$uA, 'got']] && $dA && $dA['src'] === 'vk' && $dA['ym'] === '2026-10' && $dA['place'] === 'a' && $dA['kind'] === 'bill'
  && count($bl) === 1 && $bl[0]['auto'] === 'vk' && $bl[0]['id'] === $dA['id'] && $bl[0]['mime'] === 'application/pdf' && str_contains($bl[0]['name'], 'жовтень 2026') && $vkPdfN === 1 && !array_filter(array_slice($vkCalls, $n0), fn($c) => $c[0] === 'POST' && str_contains($c[1], '/counters')), [$cr, $bl, $dA]);
$rawA = $stOf($uA)['data'];
ok('…в данных человека: новая версия, запись новее (updatedAt), остальное как было ({} осталось {}), прошлая версия — в историю (vkbill)', (int)$stOf($uA)['version'] === $v0 + 1 && $sA['water'][0]['updatedAt'] > 1000 && ($sA['water'][1]['bills'] ?? null) === null
  && $sA['updatedAt'] === 777 && str_contains($rawA, '"tariff":{}') && str_contains($rawA, '"remind":{}') && (Db::one("SELECT reason FROM user_state_hist WHERE user_id = ? ORDER BY id DESC LIMIT 1", [$uA])['reason'] ?? '') === 'vkbill', $rawA);
ok('…«человек» в журнале кабинета не сдвинулся; через минуту — некуда идти (уже прикрепили) → пауза, на сайт не ходим', VkCab::summary()['lastUser'] === $lu0 && VkBills::cron($tB + 60) === [] && $vkPdfN === 1 && !empty(VkBills::read()['idle']));
$sc = (array)(VkBills::summary()['scan'] ?? []);
ok('…/api/health → vkBills.scan: почему обход никуда не пошёл — квитанция уже есть (hasbill), месяц жовтень', ($sc['ym'] ?? '') === '2026-10' && (array)($sc['k'] ?? []) === ['hasbill' => 1], $sc);
// та же квитанция (сайт не обновил) → через RETRY снова; новая — к своему месяцу
@unlink(VkBills::file());
$uB = $mkU('bill-b@example.ua', ['readings' => [], 'places' => [$plW('p1', '905616', 'Шевченко')], 'water' => [$recW('b1', 'p1', '2026-10-20')]]);
Db::q('INSERT INTO docs (id, user_id, place, kind, file, mime, bytes, name, created_at, src, ym, sha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [str_repeat('b', 24), $uB, 'p1', 'bill', 'x.pdf', 'application/pdf', 10, 'Квитанція Водоканалу, вересень 2026', Http::iso(), 'vk', '2026-09', sha1($vkPdf)]);
$c1 = VkBills::cron($tB + 120); $c2 = VkBills::cron($tB + 180); $vkPdf = "%PDF-1.4\n% kvyt-zhovten-nova\n%%EOF\n";
$c3 = VkBills::cron($tB + 3 * 3600); $c4 = VkBills::cron($tB + 21 * 3600); $sB = json_decode($stOf($uB)['data'], true);
ok('квитанции: сайт ещё показывает прошлую (тот же отпечаток, вересень) → same, не кладём; раньше чем через 20 ч не повторяем; новая — got', $c1 === [[$uB, 'same']] && $c2 === [] && $c3 === [] && $c4 === [[$uB, 'got']]
  && count($sB['water'][0]['bills'] ?? []) === 1 && (VkBills::read()['p'][$uB . '|p1']['got'] ?? '') === '2026-10' && (VkBills::read()['p'][$uB . '|p1']['n'] ?? 0) === 2, [$c1, $c2, $c3, $c4, VkBills::read()['p'] ?? null]);
$h = json_decode(json_encode((new Browser())->req('GET', '/api/health')->body['vkBills'] ?? [], JSON_UNESCAPED_UNICODE), true); $hj = json_encode($h, JSON_UNESCAPED_UNICODE);
ok('…/api/health → vkBills: последний итог и счёт за месяц, без рахунків, прізвищ и людей', ($h['last']['res'] ?? '') === 'got' && ($h['n']['2026-10']['got'] ?? 0) === 1 && !preg_match('/905616|Шевченко|bill-b|"' . $uB . '\|/u', $hj), $h);
// «не знайдено» — не ходим, пока не изменят рахунок/прізвище; «Квитанції самі» выключили — не ходим
@unlink(VkBills::file()); Db::q('DELETE FROM user_state WHERE user_id IN (?, ?)', [$uA, $uB]);
$uD = $mkU('bill-d@example.ua', ['readings' => [], 'places' => [$plW('q', '905615', 'Шевченко')], 'water' => [$recW('d1', 'q', '2026-10-20')]]);
$d1 = VkBills::cron($tB); $d2 = VkBills::cron($tB + 22 * 3600);
Db::q('UPDATE user_state SET data = ? WHERE user_id = ?', [json_encode(['readings' => [], 'places' => [$plW('q', '905614', 'Шевченко')], 'water' => [$recW('d1', 'q', '2026-10-20')]], JSON_UNESCAPED_UNICODE), $uD]);
$vkPdf = "%PDF-1.4\n% kvyt-d\n%%EOF\n"; @unlink(VkBills::file());
$d3 = VkBills::cron($tB + 23 * 3600);
ok('квитанции: чужой рахунок → notfound, на следующий день не ходим; исправили на свой (страница «форма без полей», как живой сайт в открытый период) → got', $d1 === [[$uD, 'notfound']] && $d2 === [] && $d3 === [[$uD, 'got']], [$d1, $d2, $d3]);
Db::q('UPDATE user_state SET data = ? WHERE user_id = ?', [json_encode(['readings' => [], 'places' => [$plW('q', '905614', 'Шевченко', ['billAuto' => false])], 'water' => [$recW('d2', 'q', '2026-11-20')]], JSON_UNESCAPED_UNICODE), $uD]);
@unlink(VkBills::file());
ok('…«Квитанції самі» выключено — не ходим', VkBills::cron(gmmktime(8, 0, 0, 12, 3, 2026)) === []);
$r = $cab('/api/vk/bill', ['acc' => '905614', 'fam' => 'Шевченко', 'place' => 'main']);
ok('кнопка/приложение: страница «форма без полей» (открытый период) — квитанция всё равно берётся (раньше — «форма змінилась»)', $r->status === 200 && (!empty($r->body['doc']) || !empty($r->body['same'])), $r->body);
VkCab::$http = null;
Telegram::$send = null; Telegram::$fetch = null;

echo "\nНапоминания ботом:\n";
$kyiv = fn(string $local) => (new DateTimeImmutable($local, new DateTimeZone('Europe/Kyiv')))->getTimestamp();
ok('16-го в 10:17 по Киеву — вода (за 4 дня до 20-го)', (Reminders::due($kyiv('2026-11-16 10:17'))['kind'] ?? '') === 'water16');
ok('рано утром и в другие дни — ничего', Reminders::due($kyiv('2026-11-16 08:17')) === null && Reminders::due($kyiv('2026-11-15 12:17')) === null);
ok('21-го — тепло (за 4 дня до 25-го); 5, 15, 19, 22-го и 2, 4-го — ничего (одно напоминание, владелец 05.11)', Reminders::due($kyiv('2026-11-21 19:17'))['kind'] === 'heat21'
  && !array_filter(['05', '15', '19', '22'], fn($d) => Reminders::due($kyiv("2026-11-$d 11:17")) !== null) && Reminders::due($kyiv('2026-12-02 11:17')) === null && Reminders::due($kyiv('2026-12-04 11:17')) === null);
$wst = ['places' => [['id' => 'main', 'meter' => ['modelId' => 'sharky774'], 'water' => ['meters' => [['id' => 'h1', 'kind' => 'hot']]]]],
  'readings' => [['id' => 'r1', 'htm' => ['date' => '2026-11-06', 'energy' => '10']]], 'water' => [['id' => 'b', 'place' => 'main', 'date' => '2026-11-01', 'base' => true, 'vals' => ['h1' => '5']]]];
ok('вода: в этом месяце только стартовые — напоминаем', Reminders::needs($wst, 'water16', '2026-11'));
$w2 = $wst; $w2['water'][] = ['id' => 'w', 'place' => 'main', 'date' => '2026-11-10', 'vals' => ['h1' => '7']];
ok('вода: запись этого месяца есть — молчим', !Reminders::needs($w2, 'water16', '2026-11'));
$w3 = $wst; $w3['water'][] = ['id' => 'wo', 'place' => 'main', 'date' => '2026-11-10', 'vals' => ['h1' => '7'], 'own' => true];
$w3['readings'] = [['id' => 'r9', 'htm' => ['date' => '2026-11-06', 'energy' => '10'], 'own' => true]];
ok('«лише для себе» — не передача: вода и тепло этого месяца «для себя» — всё равно напоминаем', Reminders::needs($w3, 'water16', '2026-11') && Reminders::needs($w3, 'heat21', '2026-11'));
ok('тепло: показания в окне 5–25 есть — молчим; в прошлом месяце — напоминаем', !Reminders::needs($wst, 'heat21', '2026-11') && Reminders::needs($wst, 'heat21', '2026-12'));
ok('без водомеров про воду не пишем; выключено в настройках — не пишем', !Reminders::needs(['places' => [['id' => 'main']]], 'water16', '2026-11') && !Reminders::needs($wst + ['remind' => ['off' => true]], 'water16', '2026-11'));
$wg = $wst; $wg['places'][0]['gaps'] = [['id' => 'g1', 'what' => 'h1', 'from' => '2026-11-03', 'to' => ''], ['id' => 'g2', 'what' => 'heat', 'from' => '2026-12-01', 'to' => '2026-12-10']];
ok('лічильник знято (ремонт/повірка): водомір — не нагадуємо; тепло — лише поки знято', !Reminders::needs($wg, 'water16', '2026-11', '2026-11-15')
  && !Reminders::needs($wg, 'heat21', '2026-12', '2026-12-05') && Reminders::needs($wg, 'heat21', '2026-12', '2026-12-22'));
// прибрали лічильник з квартири (removed): про нього не нагадуємо; друга квартира лише з холодною — нагадуємо про воду
$wr = $wst; $wr['places'][0]['meter']['removed'] = '2026-11-02'; $wr['places'][0]['water']['meters'][0]['removed'] = '2026-11-02';
ok('прибраний теплолічильник і водомір — не нагадуємо', !Reminders::needs($wr, 'heat21', '2026-12') && !Reminders::needs($wr, 'water16', '2026-11'));
$wr['places'][] = ['id' => 'p2', 'name' => 'Мамина', 'water' => ['meters' => [['id' => 'c9', 'kind' => 'cold']]]];
ok('друга квартира лише з холодною: вода — нагадуємо, тепло — ні', Reminders::needs($wr, 'water16', '2026-11') && !Reminders::needs($wr, 'heat21', '2026-12'));
// несколько квартир (этап 2): одно сообщение со списком квартир, кнопка в каждую; выключатель у квартиры
$wm = $wst; $wm['places'][] = ['id' => 'p2', 'name' => 'Мамина', 'water' => ['meters' => [['id' => 'c9', 'kind' => 'cold']]]];
$pd = Reminders::placesDue($wm, 'water16', '2026-11');
ok('две квартиры без воды за месяц — обе в списке, без названия — «Моя квартира»', array_column($pd, 'label') === ['Моя квартира', 'Мамина'] && $pd[0]['all'] === 2, $pd);
$wm2 = $wm; $wm2['places'][1]['remindOff'] = true;
ok('квартира выключена (remindOff) — про неё молчим, про другую — пишем', array_column(Reminders::placesDue($wm2, 'water16', '2026-11'), 'id') === ['main']);
$wm3 = $wm2; $wm3['places'][0]['remindOff'] = true;
ok('обе выключены — не пишем вовсе', !Reminders::needs($wm3, 'water16', '2026-11'));
$tx = Reminders::text('water16', 'uk', $pd);
ok('текст: «Квартири: «Моя квартира», «Мамина»», кнопка в каждую (?go=wnew&place=…)', str_contains($tx['text'], 'Квартири: «Моя квартира», «Мамина»') && count($tx['buttons']) === 2
  && str_ends_with($tx['buttons'][1][1], '?go=wnew&place=p2') && str_contains($tx['buttons'][1][0], 'Мамина'), $tx);
$tx1 = Reminders::text('heat21', 'ru', [['id' => 'p2', 'label' => 'Мамина', 'all' => 2]]);
ok('одна из двух ждёт — «Квартира: «Мамина»», кнопка с place', str_contains($tx1['text'], 'Квартира: «Мамина»') && count($tx1['buttons']) === 1 && str_ends_with($tx1['url'], '?go=heat&place=p2'), $tx1);
$tx0 = Reminders::text('water16', 'uk', Reminders::placesDue($wst, 'water16', '2026-11'));
ok('одна квартира — как раньше: без списка, кнопка без place', !str_contains($tx0['text'], 'Квартира') && count($tx0['buttons']) === 1 && str_ends_with($tx0['url'], '?go=wnew'), $tx0);
$rm = new Browser('10.0.13.1'); $rm->req('POST', '/api/auth/telegram/webapp', ['initData' => initData($TOKEN, ['id' => 7777, 'first_name' => 'Нагадай'])]);
$put = $rm->req('PUT', '/api/state', ['state' => $wst + ['remind' => ['lang' => 'ru']], 'baseVersion' => 0]);
$sent = []; Telegram::$send = function ($m, $p, $tok = null) use (&$sent) { $sent[] = [$m, $p]; return ['ok' => true]; };
$res = Reminders::run($kyiv('2026-11-16 10:17'));
$mine = array_values(array_filter($sent, fn($x) => (string)$x[1]['chat_id'] === '7777'));
ok('рассылка: человеку с водомерами — по-русски, кнопка открывает ввод воды', $put->status === 200 && count($mine) === 1 && str_contains($mine[0][1]['text'], 'Водоканал') && str_contains($mine[0][1]['text'], 'Настройках')
  && ($mine[0][1]['reply_markup']['inline_keyboard'][0][0]['web_app']['url'] ?? '') === 'https://teplo.example/?go=wnew', $mine);
$n1 = count($sent); Reminders::run($kyiv('2026-11-16 11:17'));
ok('через час — повторно не шлём', count($sent) === $n1);
$rm2 = new Browser('10.0.13.2'); $rm2->req('POST', '/api/auth/telegram/webapp', ['initData' => initData($TOKEN, ['id' => 7788, 'first_name' => 'Дві'])]);
$rm2->req('PUT', '/api/state', ['state' => $wm, 'baseVersion' => 0]);
$sent = []; Reminders::run($kyiv('2026-11-16 12:17'));
$two = array_values(array_filter($sent, fn($x) => (string)$x[1]['chat_id'] === '7788'));
$kb = $two[0][1]['reply_markup']['inline_keyboard'] ?? [];
ok('рассылка двум квартирам: одно сообщение, две кнопки — по одной на квартиру', count($two) === 1 && count($kb) === 2 && str_ends_with($kb[1][0]['web_app']['url'], '&place=p2') && str_contains($two[0][1]['text'], 'Мамина'), $two);
$row = Db::one("SELECT status FROM reminders_sent WHERE user_id = (SELECT user_id FROM user_identities WHERE external_id = '7777') AND kind = 'water16'");
ok('итог доставки записан: ok', ($row['status'] ?? '') === 'ok', $row);
// cron (CLI) без app_url: HTTP_HOST нет — адрес из вебхука бота, а не https://localhost (02.11.2026 elec2 → error)
$cfgKeep = ['app_url' => 'https://teplo.example/', 'bot_token' => $TOKEN, 'webhook_secret' => 'hook-secret'];
$hostKeep = $_SERVER['HTTP_HOST'] ?? null; unset($_SERVER['HTTP_HOST']);
Cfg::set(['app_url' => '', 'bot_token' => $TOKEN, 'webhook_secret' => 'hook-secret']);
$hookCalls = 0; Telegram::$send = function ($m, $p, $tok = null) use (&$sent, &$hookCalls) { if ($m === 'getWebhookInfo') { $hookCalls++; return ['ok' => true, 'result' => ['url' => 'https://pokabot.xyz/teplo_test/api/bot/webhook']]; } $sent[] = [$m, $p]; return ['ok' => true]; };
ok('cron без app_url: адрес сайта — из вебхука бота (один запрос)', Cfg::appUrl() === 'https://pokabot.xyz/teplo_test/' && Cfg::appUrl() === 'https://pokabot.xyz/teplo_test/' && $hookCalls === 1 && Cfg::appUrlKnown(), Cfg::appUrl());
$tx2 = Reminders::text('heat21', 'uk');
ok('кнопка напоминания — на настоящий адрес, не localhost', $tx2['url'] === 'https://pokabot.xyz/teplo_test/?go=heat', $tx2['url']);
Cfg::set(['app_url' => '', 'bot_token' => $TOKEN, 'webhook_secret' => 'hook-secret']);
Telegram::$send = function ($m, $p, $tok = null) use (&$sent) { if ($m === 'getWebhookInfo') return ['ok' => true, 'result' => ['url' => '']]; $sent[] = [$m, $p]; return ['ok' => true]; };
ok('вебхука нет — адрес неизвестен (кнопок не будет, текст дойдёт)', !Cfg::appUrlKnown());
Db::q("DELETE FROM reminders_sent WHERE kind = 'water16'"); $sent = []; Reminders::run($kyiv('2026-11-16 13:17'));
$nb = array_values(array_filter($sent, fn($x) => (string)$x[1]['chat_id'] === '7777'));
ok('…и напоминание уходит без кнопки, а не с ошибкой', count($nb) === 1 && !isset($nb[0][1]['reply_markup']), $nb);
if ($hostKeep !== null) $_SERVER['HTTP_HOST'] = $hostKeep;
Cfg::set($cfgKeep); Telegram::$send = function ($m, $p, $tok = null) use (&$sent) { $sent[] = [$m, $p]; return ['ok' => true]; };
ok('ближайшее после 4 ноября — 16-е, вода; 16-го в 21:00 — 21-е, тепло; 25.11 — 29.11, свет; 30.11 — 1.12, газ за ноябрь', Reminders::next($kyiv('2026-11-04 20:54')) === ['date' => '2026-11-16', 'kind' => 'water16', 'ym' => '2026-11']
  && Reminders::next($kyiv('2026-11-16 21:00')) === ['date' => '2026-11-21', 'kind' => 'heat21', 'ym' => '2026-11'] && Reminders::next($kyiv('2026-11-25 12:00'))['kind'] === 'elec1' && Reminders::next($kyiv('2026-11-30 21:00')) === ['date' => '2026-12-01', 'kind' => 'gas1', 'ym' => '2026-11']);
// світло: передостанній день місяця (вікно відкрилось) і 2-ге (завтра останній), ym — місяць, за який показання
ok('свет: 29.11 — elec1 за ноябрь (за 4 дня до 3.12), 2.12 — ничего, 27.02.2027 — elec1; 2.11 после 20:00 → следующее 16-е', (Reminders::due($kyiv('2026-11-29 10:17')) ?? []) === ['ym' => '2026-11', 'kind' => 'elec1']
  && Reminders::due($kyiv('2026-12-02 12:17')) === null && (Reminders::due($kyiv('2027-02-27 10:17'))['kind'] ?? '') === 'elec1'
  && Reminders::next($kyiv('2026-11-02 20:30'))['date'] === '2026-11-16' && Reminders::elecWindow('2026-11') === ['2026-11-29', '2026-12-03']);
$es = ['places' => [['id' => 'main', 'meters' => [['id' => 'e1', 'kind' => 'elec', 'zones' => 2]]], ['id' => 'p2', 'name' => 'Мамина', 'meters' => [['id' => 'e2', 'kind' => 'elec', 'removed' => '2026-10-01']]]],
  'mrecs' => [['id' => 'b', 'place' => 'main', 'meter' => 'e1', 'date' => '2026-11-29', 'base' => true, 'z' => ['day' => '1', 'night' => '1']]]];
ok('свет: только стартовые в окне — напоминаем; прибранный счётчик — нет', array_column(Reminders::placesDue($es, 'elec1', '2026-11'), 'id') === ['main']);
$es['mrecs'][] = ['id' => 'o', 'place' => 'main', 'meter' => 'e1', 'date' => '2026-11-30', 'own' => true, 'z' => ['day' => '3', 'night' => '1']];
ok('свет: показания «лише для себе» в окне — всё равно напоминаем', Reminders::needs($es, 'elec1', '2026-11'));
$ws = ['places' => [['id' => 'main', 'water' => ['meters' => [['id' => 'c1', 'kind' => 'cold']]]]], 'water' => [['id' => 'w', 'place' => 'main', 'date' => '2026-11-10', 'own' => true, 'vals' => ['c1' => '5']]]];
ok('вода: только «лише для себе» в месяце — напоминаем', Reminders::needs($ws, 'water16', '2026-11'));
$es['mrecs'][] = ['id' => 'r', 'place' => 'main', 'meter' => 'e1', 'date' => '2026-12-01', 'z' => ['day' => '5', 'night' => '2']];
ok('свет: показания 1.12 (в окне за ноябрь) — молчим; за декабрь — напоминаем', !Reminders::needs($es, 'elec1', '2026-11') && Reminders::needs($es, 'elec1', '2026-12'));
// газ: 1-го і 4-го за попередній місяць; вікно — з 28-го по 5-те
$gs = ['places' => [['id' => 'main', 'meters' => [['id' => 'g1', 'kind' => 'gas']]]], 'mrecs' => []];
ok('газ: 1.12 — gas1 за ноябрь (за 4 дня до 5-го), 4.12 — ничего; окно 28.11–5.12', (Reminders::due($kyiv('2026-12-01 10:17')) ?? []) === ['ym' => '2026-11', 'kind' => 'gas1'] && Reminders::due($kyiv('2026-12-04 15:17')) === null && Reminders::gasWindow('2026-11') === ['2026-11-28', '2026-12-05']);
ok('газ: без показаний — напоминаем; показания 30.11 (SMS с 28-го) — молчим', Reminders::needs($gs, 'gas1', '2026-11') && !Reminders::needs(array_merge($gs, ['mrecs' => [['id' => 'x', 'place' => 'main', 'meter' => 'g1', 'date' => '2026-11-30', 'z' => ['all' => '5']]]]), 'gas1', '2026-11'));
ok('газ: кнопка ?go=gnew, до 27.11 — про SMS 4647', str_ends_with(Reminders::text('gas1', 'uk', Reminders::placesDue($gs, 'gas1', '2026-11'))['url'], '?go=gnew') && str_contains(Reminders::text('gas1', 'ru', [], '2026-11-01')['text'], '4647'));
$g12 = [Reminders::text('gas1', 'uk', [], '2026-12-01')['text'], Reminders::text('gas1', 'ru', [], '2026-12-01')['text']];
ok('газ: с 28.11 (SMS 4647 закрыли) — без SMS, «Куб» и 0 800 303 104', !str_contains($g12[0] . $g12[1], '4647') && !str_contains($g12[0] . $g12[1], 'SMS') && str_contains($g12[0], '«Куб»') && str_contains($g12[1], '0 800 303 104'), $g12);
$te = Reminders::text('elec1', 'uk', Reminders::placesDue($es, 'elec1', '2026-12'));
ok('свет: текст про Харківобленерго, кнопка ?go=enew', str_contains($te['text'], 'Харківобленерго') && str_contains($te['url'], '?go=enew&place=main') && str_contains($te['button'], 'світло'), $te);
ok('ответы Telegram: 403 → blocked, нет чата → no_chat, сбой связи/429 → повторить', Reminders::status(['ok' => false, 'error_code' => 403, 'description' => 'Forbidden: bot was blocked by the user']) === 'blocked'
  && Reminders::status(['ok' => false, 'error_code' => 400, 'description' => 'Bad Request: chat not found']) === 'no_chat' && Reminders::status([]) === null && Reminders::status(['ok' => false, 'error_code' => 429]) === null);
$pv = Reminders::preview('heat21', '2026-12'); $me7 = array_values(array_filter($pv, fn($x) => $x['lang'] === 'ru'));
ok('предпросмотр на 21 декабря: человек в списке, ещё не отправлено', count($me7) === 1 && $me7[0]['sent'] === null, $pv);
$tries = 0; Telegram::$send = function () use (&$tries) { $tries++; return []; };
Reminders::run($kyiv('2026-12-21 10:17'));
$cnt = fn() => (int)(Db::one("SELECT COUNT(*) n FROM reminders_sent WHERE kind = 'heat21' AND ym = '2026-12'")['n'] ?? 0);
ok('сбой связи — отметки нет, через час повтор', $tries >= 1 && $cnt() === 0);
Telegram::$send = fn() => ['ok' => false, 'error_code' => 403, 'description' => 'Forbidden: bot can\'t initiate conversation with a user'];
Reminders::run($kyiv('2026-12-21 11:17'));
$bl = Db::q("SELECT status FROM reminders_sent WHERE kind = 'heat21' AND ym = '2026-12'")->fetchAll(PDO::FETCH_COLUMN);
ok('не нажимал «Старт» — blocked, больше не пробуем', $bl && !array_diff($bl, ['blocked']), $bl);
Telegram::$send = null;
Cfg::set(['app_url' => 'https://teplo.example/', 'bot_token' => $TOKEN, 'webhook_secret' => 'hook-secret', 'admins' => ['emails' => ['boss@example.ua']]]);
$boss = new Browser('10.0.13.9'); $boss->req('POST', '/api/auth/login', ['email' => 'boss@example.ua', 'password' => 'boss pass 123']);
$ar = $boss->req('GET', '/api/admin/reminders');
ok('/admin: вкладка напоминаний — ближайшее, журнал с итогами', $ar->status === 200 && !empty($ar->body['next']['date']) && count(array_filter($ar->body['log'], fn($x) => $x['status'] === 'blocked')) >= 1, $ar->body['next'] ?? $ar->status);
@unlink(Cron::file()); $h0 = (new Browser('10.0.13.8'))->req('GET', '/api/health');
Cron::write(['last' => gmdate('c', time() - 120)]); $h1 = (new Browser('10.0.13.7'))->req('GET', '/api/health');
ok('/api/health: cron ни разу → null, был 2 мин назад → ~120 с', $h0->body['cronAgo'] === null && abs(($h1->body['cronAgo'] ?? 0) - 120) <= 2, [$h0->body, $h1->body]);
ok('/api/health: пересланные ответы ботов — только счёт по боту и итогу, без текстов', (((array)$h1->body['fwd'])['obl ok'] ?? 0) >= 1 && (((array)$h1->body['fwd'])['vk ok'] ?? 0) >= 1 && !preg_match('/прийнят|збережен/iu', json_encode($h1->body['fwd'], JSON_UNESCAPED_UNICODE)), $h1->body['fwd'] ?? null);

echo "\nГрафики отключений света (ГПВ Харьковоблэнерго, синтетический файл в формате OE_OUTAGE_DATA):\n";
$gday = fn(string $ymd) => (new DateTimeImmutable($ymd . ' 00:00', new DateTimeZone('Europe/Kyiv')))->getTimestamp();
$hrs = fn(array $no, array $first = [], array $second = [], array $may = []) => array_combine(range(1, 24), array_map(fn($h) => in_array($h, $no, true) ? 'no' : (in_array($h, $first, true) ? 'first' : (in_array($h, $second, true) ? 'second' : (in_array($h, $may, true) ? 'maybe' : 'yes'))), range(1, 24)));
$gq = []; foreach (Gpv::QUEUES as $q) $gq['GPV' . $q] = $hrs([]);
$g4 = $gq; $g4['GPV1.1'] = $hrs([7, 8, 9, 14, 15, 16, 17, 18, 19, 24], [20], [13]); $g4['GPV3.1'] = $hrs([1, 2], [], [], [10]);
$g5 = $gq; $g5['GPV1.1'] = $hrs([12]);
$gsrc = json_encode(['regionId' => 'Kharkiv', 'lastUpdated' => '2026-11-04T05:05:00Z', 'fact' => ['data' => [(string)$gday('2026-11-03') => $gq, (string)$gday('2026-11-04') => $g4, (string)$gday('2026-11-05') => $g5], 'update' => '04.11.2026 07:05', 'today' => $gday('2026-11-04')],
  'preset' => ['time_type' => ['yes' => 'Світло є', 'no' => 'Світла немає']]]);
$gp = Gpv::parse($gsrc);
ok('разбор: 1.1 на 4.11 — 06:00–09:00, 12:30–19:30, 23:00–24:00 (first/second — по 30 хв, сусідні зливаються)', ($gp['days']['2026-11-04']['1.1']['off'] ?? null) === [[360, 540], [750, 1170], [1380, 1440]] && $gp['update'] === '04.11.2026 07:05', $gp['days']['2026-11-04']['1.1'] ?? $gp);
ok('…«можливе» — окремо, 12 підчерг; мусор — null', ($gp['days']['2026-11-04']['3.1']['may'] ?? null) === [[540, 600]] && count($gp['days']['2026-11-04']) === 12 && Gpv::parse('{"x":1}') === null && Gpv::parse('<html>') === null);
@unlink(Gpv::file()); Gpv::$http = fn($u) => ['code' => 200, 'body' => $gsrc];
$now4 = $kyiv('2026-11-04 07:10'); $rf = Gpv::refresh($now4); $ga = Gpv::api($now4);
ok('cron забрал график → /api/gpv: сегодня и завтра (вчера — нет), время обновления, ссылка на поиск очереди', $rf['ok'] && array_keys((array)$ga['days']) === ['2026-11-04', '2026-11-05'] && $ga['update'] === '04.11.2026 07:05' && !$ga['stale'] && str_contains($ga['lookup'], 'oblenergo.kharkiv.ua'), $ga);
Gpv::$http = fn($u) => ['code' => 503, 'body' => ''];
$rf2 = Gpv::refresh($now4 + 600);
ok('источник не ответил — прежний график остаётся, ошибка записана', !$rf2['ok'] && $rf2['err'] === 'HTTP 503' && count((array)Gpv::api($now4 + 600)['days']) === 2 && Gpv::api($now4 + 4 * 3600)['stale']);
Gpv::$http = fn($u) => ['code' => 200, 'body' => $gsrc]; Gpv::refresh($now4);
Gpv::$http = fn($u) => str_contains($u, '.pdf') ? ['code' => 200, 'body' => "%PDF-1.4 test"] : ['code' => 200, 'body' => $gsrc];
$fd = Gpv::fetchDocs($now4); $fd2 = Gpv::fetchDocs($now4 + 600);
$dd = (new Browser('10.0.13.24'))->req('GET', '/api/gpv/doc', null, ['QUERY_STRING' => 'k=vul']);
ok('офіційний PDF з сайту обленерго: сервер забрав (раз на добу), /api/gpv/doc?k=vul віддає; невідомий k — 404', $fd['ok'] && $fd['docs']['vul']['bytes'] === 13 && $fd2 === null && $dd->status === 200 && (new Browser('10.0.13.24'))->req('GET', '/api/gpv/doc', null, ['QUERY_STRING' => 'k=../x'])->status === 404, [$fd, $dd->status]);
Gpv::$http = fn($u) => ['code' => 200, 'body' => $gsrc];
$gst = ['readings' => [], 'places' => [['id' => 'main', 'name' => '', 'address' => 'вул. Сумська, 10', 'gpv' => '1.1'], ['id' => 'p2', 'name' => 'Мамина', 'address' => 'пр. Науки, 5', 'gpv' => '3.1'],
  ['id' => 'p3', 'name' => 'Дача', 'address' => '', 'gpv' => '2.1'], ['id' => 'p4', 'name' => 'Здаю', 'address' => 'вул. Пушкінська, 1', 'gpv' => '4.1', 'gpvTg' => false], ['id' => 'p5', 'address' => 'x', 'gpv' => '9.9']]];
ok('кому писать: квартиры с адресом и очередью; без адреса, «не надсилати», кривая очередь — нет', array_column(Gpv::placesFor($gst), 'id') === ['main', 'p2'] && Gpv::placesFor($gst)[0]['label'] === 'Моя квартира');
$gt = Gpv::text('uk', Gpv::placesFor($gst), Gpv::read()['days']['2026-11-04'], '2026-11-04');
ok('текст: «на сьогодні, 4 листопада», по квартирі — черга й години без світла, разом; «можливі»; кнопка ?go=gpv', str_contains($gt['text'], 'на сьогодні, 4 листопада') && str_contains($gt['text'], '▌Моя квартира (вул. Сумська, 10) — черга 1.1')
  && str_contains($gt['text'], 'Без світла: 06:00–09:00, 12:30–19:30, 23:00–24:00 (разом 11 год)') && str_contains($gt['text'], 'Можливі відключення: 09:00–10:00') && str_contains($gt['text'], 'Без світла: 00:00–02:00')
  && str_ends_with($gt['buttons'][0][1], '?go=gpv'), $gt['text'] ?? $gt);
$g1 = Gpv::text('ru', [Gpv::placesFor($gst)[1]], Gpv::read()['days']['2026-11-05'], '2026-11-05');
ok('у этой очереди сегодня отключений нет — не пишем; одна квартира — кнопка с place', $g1 === null && str_ends_with(Gpv::text('ru', [Gpv::placesFor($gst)[0]], Gpv::read()['days']['2026-11-05'], '2026-11-05')['buttons'][0][1], '?go=gpv&place=main'));
$gb = new Browser('10.0.13.21'); $gb->req('POST', '/api/auth/telegram/webapp', ['initData' => initData($TOKEN, ['id' => 7781, 'first_name' => 'Світло'])]);
$gpu = $gb->req('PUT', '/api/state', ['state' => $gst, 'baseVersion' => 0]); if ($gpu->status !== 200) echo '   (PUT state: ' . $gpu->status . ' ' . json_encode($gpu->body) . ")\n";
$sent = []; Telegram::$send = function ($m, $p, $tok = null) use (&$sent) { $sent[] = [$m, $p]; return ['ok' => true]; };
$gm0 = Gpv::morning($kyiv('2026-11-04 06:55'));
$gm = Gpv::morning($kyiv('2026-11-04 07:15')); $mine = array_values(array_filter($sent, fn($x) => (string)$x[1]['chat_id'] === '7781'));
ok('утро: до 7:00 — молчим; в 7:15 — одно сообщение с графиком и кнопкой «Відкрити графік»', $gm0 === [] && count($mine) === 1 && str_contains($mine[0][1]['text'], 'черга 1.1')
  && ($mine[0][1]['reply_markup']['inline_keyboard'][0][0]['text'] ?? '') === 'Відкрити графік', $mine);
Gpv::morning($kyiv('2026-11-04 08:15')); $mine2 = array_values(array_filter($sent, fn($x) => (string)$x[1]['chat_id'] === '7781'));
ok('…раз в день: в 8:15 повторно не пишем; отметка gpv-04 — в журнале напоминаний', count($mine2) === 1 && Db::one("SELECT status FROM reminders_sent WHERE kind = 'gpv-04' AND ym = '2026-11'")['status'] === 'ok');
@unlink(Gpv::file()); $sent = [];
ok('графика на сегодня нет (не публиковали) — ничего не шлём', Gpv::morning($kyiv('2026-11-06 07:15')) === [] && !$sent);
// кому придёт график и ближайшее напоминание — только числа в /api/health (считает cron)
$gr0 = Gpv::readiness();
$gb2 = new Browser('10.0.13.22'); $gb2->req('POST', '/api/auth/telegram/webapp', ['initData' => initData($TOKEN, ['id' => 7782, 'first_name' => 'Без черги'])]);
$gb2->req('PUT', '/api/state', ['state' => ['readings' => [], 'places' => [['id' => 'main', 'address' => 'вул. Неіснуюча, 999']]], 'baseVersion' => 0]);
$gr1 = Gpv::readiness();
ok('сколько получат график: с адресом и очередью — ready; адрес без очереди (не нашли) — noQueue', $gr0['ready'] >= 1 && $gr1['tg'] === $gr0['tg'] + 1 && $gr1['noQueue'] === $gr0['noQueue'] + 1 && $gr1['ready'] === $gr0['ready'], [$gr0, $gr1]);
$rn = Reminders::nextPreview($kyiv('2026-11-04 21:00'));
ok('ближайшее напоминание 4.11 вечером — water16 16.11, сколько положено и сколько уже ушло', ($rn['kind'] ?? '') === 'water16' && $rn['date'] === '2026-11-16' && $rn['ym'] === '2026-11' && is_int($rn['n']) && is_int($rn['sent']), $rn);
$vkl0 = @file_get_contents(VkCab::logFile());
file_put_contents(VkCab::logFile(), json_encode([['at' => time() - 100, 'op' => 'probe', 'result' => 'notfound', 'msgs' => ['err' => ['Не коректні дані: рахунок ###']]], ['at' => time() - 50, 'op' => 'check', 'result' => 'ok', 'user' => 5],
  ['at' => time() - 40, 'op' => 'send', 'result' => 'unknown', 'user' => 5]], JSON_UNESCAPED_UNICODE));
Cron::write(Cron::read() + ['gpvReady' => $gr1 + ['at' => gmdate('c')], 'remindNext' => $rn]);
$hh = (new Browser('10.0.13.23'))->req('GET', '/api/health'); $hv = (array)($hh->body['vkcab']['n'] ?? []);
ok('/api/health: gpvReady и remindNext из cron; vkcab — счёт «операция итог» и время последней проверки человеком, без слов сайта',
  ($hh->body['gpvReady']['ready'] ?? null) === $gr1['ready'] && ($hh->body['remindNext']['kind'] ?? '') === 'water16' && $hv === ['check ok' => 1, 'probe notfound' => 1, 'send unknown' => 1]
  && abs(strtotime((string)$hh->body['vkcab']['lastUser']) - (time() - 40)) <= 2 && !preg_match('/коректн|###/u', json_encode($hh->body, JSON_UNESCAPED_UNICODE)), $hh->body);
if ($vkl0 === false) @unlink(VkCab::logFile()); else file_put_contents(VkCab::logFile(), $vkl0);
// очередь по адресу квартиры — синтетический справочник
$gcfg = ['app_url' => 'https://teplo.example/', 'bot_token' => $TOKEN, 'webhook_secret' => 'hook-secret', 'admins' => ['emails' => ['boss@example.ua']]];
Gpv::$addrIdx = null; Cfg::set($gcfg + ['gpv_addr_file' => '/nonexistent/gpv_addr.json']);
ok('справочника ещё нет → ready: false', Gpv::lookup('вул. Сумська, 10') === ['ready' => false, 'found' => false]);
$gidx = ['v' => 1, 'src' => ['name' => 'Адреси та черги.pdf'], 'items' => array_map(fn($x) => ['c' => $x[0], 'ck' => Gpv::skelCity($x[0]), 's' => $x[1], 'k' => $x[1] === '' ? '' : Gpv::skel($x[1]), 'h' => $x[2], 'q' => $x[3]], [
  ['Харків', 'вул. Сумська', ['10', '12а', '14'], '3.1'], ['Харків', 'вул. Сумська', ['50', '52'], '5.2'], ['Харків', 'просп. Науки', null, '4.2'],
  ['Харків', 'вул. Академіка Павлова', ['120', '122'], '1.1'], ['Харків', 'вул. Гвардійців-Широнінців', null, '6.1'], ['Харків', 'вул. Шевченка', ['5'], '2.1'], ['Харків', 'вул. Шевченка', null, '2.2'],
  ['Мала Данилівка', '', null, '6.2'], ['Люботин', 'вул. Глінки', null, '2.2'], ['Люботин', 'вул. Будянська', ['5', '7'], '2.1'],
  ['Харків', '', null, '5.2'],   // «м. Харків» при підприємстві — не місто (такий запис пошук не використовує)
  ['Першотравневе', 'вул. 8 Березня', null, '1.2'], ['Першотравневе', 'вул. Миру', null, '4.1'], ['Високий', 'вул. Харківська', null, '2.1'], ['Високий', 'вул. Миру', null, '1.1'],
  ['Ч.Бишкин', '', null, '4.2'], ['Ст. Мерчик', 'вул. Миру', null, '1.2'], ['Ст. Мерчик', 'вул. Шкільна', null, '5.2'], ['Буди', 'вул. Залізнична', null, '2.1'],
  ['Чугуїв', 'вул. Рєпіна', null, '5.2'], ['Чугуїв', 'вул. Харківська', null, '4.1']])];
$gtmp = sys_get_temp_dir() . '/gpv_addr_test.json'; file_put_contents($gtmp, json_encode($gidx, JSON_UNESCAPED_UNICODE)); Cfg::set($gcfg + ['gpv_addr_file' => $gtmp]); Gpv::$addrIdx = null;
$gL = fn($a) => Gpv::lookup($a);
ok('«вул. Сумська, 10, кв. 61» → 3.1 (будинок у переліку)', ($r = $gL('вул. Сумська, 10, кв. 61'))['found'] && $r['q'] === '3.1' && $r['street'] === 'вул. Сумська' && $r['city'] === 'Харків', $r);
ok('по-русски «г. Харьков, ул. Сумская 52» → 5.2; «12-А» → 3.1', ($r = $gL('г. Харьков, ул. Сумская 52'))['found'] && $r['q'] === '5.2' && $gL('Сумська 12-А')['q'] === '3.1', $r);
ok('вся улица в одной очереди: «пр. Науки, 5» → 4.2; «ак. Павлова 120» → 1.1; описка «Гвардейцев Широнинцев 3» → 6.1',
  $gL('пр. Науки, 5')['q'] === '4.2' && $gL('ак. Павлова 120')['q'] === '1.1' && ($gL('Гвардейцев Широнинцев 3')['q'] ?? '') === '6.1', [$gL('ак. Павлова 120'), $gL('Гвардейцев Широнинцев 3')]);
ok('улица в нескольких очередях без номера дома → варианты 3.1 и 5.2', ($r = $gL('Сумська'))['found'] === false && $r['reason'] === 'nohouse' && $r['options'] === ['3.1', '5.2'], $r);
ok('дом не из списков, но есть «вся остальная улица» → её очередь (Шевченка 7 → 2.2, Шевченка 5 → 2.1)', $gL('Шевченка 7')['q'] === '2.2' && $gL('вул. Шевченка, 5')['q'] === '2.1');
ok('улицы нет в перечне → found: false, reason street', ($r = $gL('вул. Неіснуюча, 5'))['found'] === false && $r['reason'] === 'street', $r);
// як на бою: у переліку області в Харкова лише 1–2 вулиці при в/ч в одній черзі — російське «Харьков» не має давати цю чергу «за пунктом»
$gmini = sys_get_temp_dir() . '/gpv_addr_mini.json'; file_put_contents($gmini, json_encode(['v' => 1, 'items' => [['c' => 'Харків', 'ck' => 'харкив', 's' => 'проїзд Кільцевий', 'k' => Gpv::skel('проїзд Кільцевий'), 'h' => null, 'q' => '6.1'],
  ['c' => 'Люботин', 'ck' => 'люботин', 's' => 'вул. Глінки', 'k' => 'глинки', 'h' => null, 'q' => '2.2']]], JSON_UNESCAPED_UNICODE));
Cfg::set($gcfg + ['gpv_addr_file' => $gmini]); Gpv::$addrIdx = null;
$ru = array_map($gL, ['г. Харьков, ул. Сумская, 10, кв. 5', 'Харьков, просп. Науки 45', 'в Харькове, ул. Клочковская 100']);
ok('російською «г. Харьков, …», «Харьков, …», «в Харькове» — це Харків (kharkiv), черги «за пунктом» немає', count(array_filter($ru, fn($r) => $r['kharkiv'] && !$r['found'] && empty($r['options']))) === 3 && $gL('Люботин, Глінки 5')['q'] === '2.2', $ru);
$gst2 = ['places' => [['id' => 'a', 'address' => 'г. Харьков, ул. Сумская, 10', 'gpv' => '6.1', 'gpvAuto' => ['addr' => 'г. Харьков, ул. Сумская, 10', 'city' => 'Харків']],
  ['id' => 'b', 'address' => 'г. Харьков, ул. Сумская, 10', 'gpv' => '6.1'], ['id' => 'c', 'address' => 'Люботин, Глінки 5', 'gpv' => '1.1', 'gpvAuto' => ['addr' => 'Люботин, Глінки 5']]]];
ok('ранкова розсилка: черга «за адресою» звіряється з довідником (неправильну 6.1 не шлемо, Люботин 1.1 → 2.2), обрана вручну — як є',
  array_map(fn($x) => $x['id'] . $x['q'], Gpv::placesFor($gst2)) === ['b6.1', 'c2.2'], Gpv::placesFor($gst2));
Cfg::set($gcfg + ['gpv_addr_file' => $gtmp]); Gpv::$addrIdx = null;
ok('Харків: «весь Харків» з переліку не підставляємо — вулиці немає → reason street без варіантів', ($r = $gL('вул. Неіснуюча, 5'))['kharkiv'] && empty($r['options']) && ($gL('м. Харків')['found'] ?? true) === false, $r);
ok('число в назві вулиці: «вул. 8 Березня, 1» → 1.2 (будинок 1, не 8); «вул. Харківська» не вирізаємо як «Харків,» → 2.1',
  ($r = $gL('с. Першотравневе, вул. 8 Березня, 1'))['q'] === '1.2' && $r['house'] === '1' && ($gL('с. Високий, вул. Харківська, 1')['q'] ?? '') === '2.1', [$r, $gL('с. Високий, вул. Харківська, 1')]);
ok('пункт з ініціалом у переліку: «с. Червоний Бишкин» → 4.2 (Ч.Бишкин); «Старий Мерчик, вул. Миру 3» → 1.2 (Ст. Мерчик)',
  ($gL('с. Червоний Бишкин')['q'] ?? '') === '4.2' && ($gL('Старий Мерчик, вул. Миру 3')['q'] ?? '') === '1.2' && ($gL('с. Ст. Мерчик, вул. Шкільна, 2')['q'] ?? '') === '5.2', [$gL('с. Червоний Бишкин'), $gL('Старий Мерчик, вул. Миру 3')]);
ok('вулиці немає, а пункт перелічено вулицями: одна черга (Буди) → вона; кілька (Чугуїв) → варіанти 4.1 і 5.2',
  ($r = $gL('смт Буди, вул. Нова, 4'))['found'] && $r['q'] === '2.1' && $r['how'] === 'city' && ($r2 = $gL('м. Чугуїв, вул. Вигадана, 10'))['found'] === false && $r2['reason'] === 'street' && $r2['options'] === ['4.1', '5.2'], [$r, $r2 ?? null]);
ok('населённый пункт: «м. Люботин, вул. Глінки, 3» → 2.2; «Люботин, Будянська 7» → 2.1; «с. Мала Данилівка, вул. Сумська, 3» → 6.2 (все село), а не харківська Сумська',
  ($gL('м. Люботин, вул. Глінки, 3')['q'] ?? '') === '2.2' && ($gL('Люботин, Будянська 7')['q'] ?? '') === '2.1' && ($r = $gL('с. Мала Данилівка, вул. Сумська, 3'))['q'] === '6.2' && $r['how'] === 'city', $r);
ok('пункта нет в перечне → reason city; Харків — признак kharkiv', ($r = $gL('м. Вигаданськ, вул. Ватутіна, 1'))['reason'] === 'city' && !$r['kharkiv'] && $gL('вул. Сумська, 10')['kharkiv'] === true, $r);
ok('/api/gpv/addr — тот же ответ (без входа)', ((new Browser('10.0.13.25'))->req('GET', '/api/gpv/addr', null, ['QUERY_STRING' => 'q=' . rawurlencode('вул. Сумська, 14')])->body['q'] ?? '') === '3.1');
@unlink($gtmp); Cfg::set($gcfg); Gpv::$addrIdx = null;
// перечень «Адреси та черги»: пост из канала Харківобленерго с PDF переслали нашему боту → сохранили, отдаём /api/gpv/list.pdf
$gpdf = "%PDF-1.4\n% синтетика\n"; Telegram::$fetch = fn($id) => $id === 'pdf-1' ? $gpdf : null; $sent = [];
$ghook = fn(array $m) => (new Browser('10.0.13.22'))->req('POST', '/api/bot/webhook', ['message' => $m + ['chat' => ['id' => 7781], 'from' => ['id' => 7781, 'first_name' => 'Світло'], 'date' => time()]], ['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN' => (string)Cfg::get('webhook_secret')]);
$ghook(['document' => ['file_id' => 'pdf-1', 'file_name' => 'Адреси та черги.pdf', 'mime_type' => 'application/pdf', 'file_size' => 20], 'forward_origin' => ['type' => 'channel', 'chat' => ['id' => -100123, 'username' => 'kharkivenergy', 'type' => 'channel'], 'message_id' => 1445, 'date' => 1761120000]]);
$gl = (new Browser('10.0.13.23'))->req('GET', '/api/gpv/list.pdf');
ok('PDF «Адреси та черги» из канала обленерго → сохранён, бот: «Зберіг перелік адрес», /api/gpv/list.pdf отдаёт файл', ($gl->file['mime'] ?? '') === 'application/pdf' && file_get_contents($gl->file['path']) === $gpdf
  && str_contains(end($sent)[1]['text'] ?? '', 'Зберіг перелік адрес') && (Gpv::listMeta()['post'] ?? 0) === 1445, end($sent));
$gpdf2 = "%PDF-1.4\n% місто\n"; Telegram::$fetch = fn($id) => $id === 'pdf-1' ? $gpdf : ($id === 'pdf-2' ? $gpdf2 : null);
$ghook(['document' => ['file_id' => 'pdf-2', 'file_name' => 'Вулиці та черги.pdf', 'mime_type' => 'application/pdf', 'file_size' => 20], 'forward_origin' => ['type' => 'channel', 'chat' => ['id' => -100123, 'username' => 'kharkivenergy', 'type' => 'channel'], 'message_id' => 1500, 'date' => 1761120000]]);
$f1 = substr(sha1($gpdf), 0, 10); $g1 = (new Browser('10.0.13.23'))->req('GET', '/api/gpv/list.pdf', null, ['QUERY_STRING' => 'f=' . $f1]); $g2 = (new Browser('10.0.13.23'))->req('GET', '/api/gpv/list.pdf');
ok('другий перелік («Вулиці та черги») не затирає перший: list.pdf — останній, ?f=<sha10> — кожен окремо, у list.json — обидва', file_get_contents($g2->file['path']) === $gpdf2 && file_get_contents($g1->file['path']) === $gpdf
  && count(Gpv::listMeta()['all'] ?? []) === 2 && (new Browser('10.0.13.23'))->req('GET', '/api/gpv/list.pdf', null, ['QUERY_STRING' => 'f=../../x'])->file['path'] === $g2->file['path'], Gpv::listMeta());
foreach (glob(Gpv::listDir() . '/list-*.pdf') as $x) @unlink($x);
@unlink(Gpv::listDir() . '/list.pdf'); @unlink(Gpv::listDir() . '/list.json');
$ghook(['document' => ['file_id' => 'pdf-1', 'file_name' => 'Адреси та черги.pdf', 'mime_type' => 'application/pdf', 'file_size' => 20]]);
ok('…тот же файл от обычного человека (не из канала, не админ) — не берём', Gpv::listFile() === null && (new Browser('10.0.13.24'))->req('GET', '/api/gpv/list.pdf')->status === 404);
Gpv::$http = null; Telegram::$send = null; Telegram::$fetch = null;

echo "\nАналитика: квартиры и все виды счётчиков:\n";
$mv = new Browser('10.0.14.1'); $mv->req('POST', '/api/auth/register', ['email' => 'many@example.ua', 'password' => 'many pass 123']);
$mst = ['v' => 1, 'onboarded' => true, 'meter' => ['modelId' => 'sharky774', 'unit' => 'Gcal'], 'contacts' => ['phone' => '', 'email' => ''],
  'places' => [
    ['id' => 'main', 'name' => '', 'address' => 'вул. Сумська, 10', 'meter' => ['modelId' => 'sharky774', 'unit' => 'Gcal'],
      'water' => ['account' => '123', 'meters' => [['id' => 'h1', 'kind' => 'hot', 'removed' => '2026-10-01'], ['id' => 'c1', 'kind' => 'cold']]],
      'meters' => [['id' => 'e1', 'kind' => 'elec', 'zones' => 2], ['id' => 'g1', 'kind' => 'gas', 'deleted' => true]]],
    ['id' => 'p2', 'name' => 'Мамина', 'meters' => [['id' => 'g2', 'kind' => 'gas']], 'water' => ['meters' => [['id' => 'c9', 'kind' => 'cold']]]],
    ['id' => 'p3', 'deleted' => true, 'meters' => [['id' => 'e9', 'kind' => 'elec']]]],
  'readings' => [
    ['id' => 'r1', 'place' => 'main', 'htm' => ['date' => '2026-10-10', 'energy' => '1.000'], 'status' => 'accepted'],
    ['id' => 'r2', 'place' => 'main', 'htm' => ['date' => '2026-09-10', 'energy' => '0.500'], 'status' => 'handed', 'own' => true],
    ['id' => 'r3', 'place' => 'main', 'htm' => ['date' => '2026-11-01', 'energy' => '1.200'], 'status' => 'handed', 'deleted' => true]],
  'water' => [
    ['id' => 'w0', 'place' => 'main', 'date' => '2026-08-01', 'vals' => ['c1' => '100'], 'base' => true],
    ['id' => 'w1', 'place' => 'main', 'date' => '2026-10-15', 'vals' => ['c1' => '105'], 'sent' => ['vk' => '2026-10-15']],
    ['id' => 'w2', 'place' => 'p2', 'date' => '2026-10-20', 'vals' => ['c9' => '7'], 'own' => true, 'photos' => [['id' => 'x1']]],
    ['id' => 'w3', 'place' => 'main', 'date' => '2026-11-02', 'vals' => ['c1' => '108'], 'deleted' => true]],
  'mrecs' => [
    ['id' => 'm1', 'place' => 'main', 'meter' => 'e1', 'kind' => 'elec', 'date' => '2026-10-31', 'z' => ['day' => '100', 'night' => '50'], 'sent' => ['obl' => '2026-10-31']],
    ['id' => 'm2', 'place' => 'p2', 'meter' => 'g2', 'kind' => 'gas', 'date' => '2026-11-01', 'z' => ['all' => '12.5'], 'sent' => []],
    ['id' => 'm3', 'place' => 'p2', 'meter' => 'g2', 'kind' => 'gas', 'date' => '2026-10-01', 'z' => ['all' => '10'], 'base' => true]]];
ok('состояние с квартирами сохранено', $mv->req('PUT', '/api/state', ['state' => $mst, 'baseVersion' => 0])->status === 200);
$mu = $boss->req('GET', '/api/admin/users', null, ['QUERY_STRING' => 'q=many@'])->body['users'][0]['state'] ?? [];
ok('сводка: 2 квартиры (удалённая не в счёт), виды без прибранных и удалённых', ($mu['places'] ?? 0) === 2 && $mu['kinds'] === ['heat' => 1, 'hot' => 0, 'cold' => 2, 'elec' => 1, 'gas' => 1], $mu);
ok('сводка: показаний без удалённых и стартовых — тепло 2, вода 2, свет 1, газ 1; «для себя» 2; передано тепла 1 (не «для себя»)',
  $mu['recs'] === ['heat' => 2, 'water' => 2, 'elec' => 1, 'gas' => 1] && $mu['own'] === 2 && $mu['handed'] === 1 && $mu['readings'] === 2, $mu);
ok('сводка: последнее — самое позднее по дате среди всех видов (газ 1.11, не удалённое тепло 1.11)', ($mu['last']['date'] ?? '') === '2026-11-01' && $mu['last']['kind'] === 'gas' && $mu['last']['sent'] === false, $mu['last'] ?? null);
ok('сводка: адрес первой квартиры, модель, фото в записях', $mu['apartment'] === 'вул. Сумська, 10' && $mu['meter'] === 'sharky774' && $mu['photos'] === 1 && $mu['onboarded'] === true);
ok('старые данные без квартир: тепло и показания считаются', Admin::stateSummary(json_encode(['meter' => ['modelId' => 't330'], 'readings' => [['htm' => ['date' => '2026-01-01'], 'status' => 'checked']]]))['kinds']['heat'] === 1
  && Admin::stateSummary(null)['places'] === 0);
$ovm = $boss->req('GET', '/api/admin/overview')->body;
ok('сводка /admin: «что ведут» — с 2+ квартирами, люди по видам, показания по видам', ($ovm['tracking']['multi'] ?? 0) >= 1 && $ovm['tracking']['users']['gas'] >= 1 && $ovm['tracking']['recs']['elec'] >= 1, $ovm['tracking'] ?? null);
$states = Db::q('SELECT data FROM user_state')->fetchAll(); $nonEmpty = count(array_filter($states, function ($r) { $m = Admin::stateSummary($r['data']); return array_sum($m['kinds']) + array_sum($m['recs']) > 0; }));
ok('«сохранили данные» — только с счётчиками или показаниями (пустое состояние — не данные)', $ovm['withData'] === $nonEmpty && $ovm['withData'] === $ovm['tracking']['withData'] && array_sum(Admin::stateSummary('{"v":1,"lang":"uk","places":[]}')['recs']) === 0, [$ovm['withData'], $nonEmpty, count($states)]);
// «входили за 7 дней»: вход давно, но открывал сайт вошедшим (visits) — активен
Db::q("UPDATE users SET last_login_at = ? WHERE email = 'many@example.ua'", [gmdate('c', time() - 30 * 86400)]);
$a0 = $boss->req('GET', '/api/admin/overview')->body['activeWeek'];
Db::q("UPDATE users SET last_login_at = ? WHERE email = 'many@example.ua'", [gmdate('c', time() - 30 * 86400)]); Db::q("DELETE FROM visits WHERE user_id = (SELECT id FROM users WHERE email = 'many@example.ua')");
$a1 = $boss->req('GET', '/api/admin/overview')->body['activeWeek'];
$mv->req('POST', '/api/visit', ['vid' => 'many1234phone', 'device' => 'mobile', 'os' => 'Android']);
$a2 = $boss->req('GET', '/api/admin/overview')->body['activeWeek'];
ok('«входили за 7 дней» считает и открывавших сайт уже вошедшими', $a2 === $a1 + 1, [$a0, $a1, $a2]);
// світло/газ «з фото» — в аналитику с причинами по-русски
$r7l = $up($mv, $png, 'image/png'); $r8l = $up($mv, $png, 'image/png');
$re = $mv->req('POST', '/api/recognize/local', ['ids' => [$r7l->body['id'], $r8l->body['id']], 'results' => [
  ['photo' => ['index' => 0, 'kind' => 'elec', 'meterType' => 'electric', 'readings' => [['field' => 'elec_day', 'meter' => 'e1', 'value' => 10530, 'guess' => true]]], 'ms' => 3000, 'ocr' => [['t' => '010530.5', 's' => 1]]],
  ['photo' => ['index' => 1, 'kind' => 'gas', 'meterType' => 'gas', 'where' => 'setup', 'readings' => []], 'ms' => 2000]]]);
$pl7 = Db::one('SELECT * FROM photos WHERE id = ?', [$r7l->body['id']]); $pl8 = Db::one('SELECT * FROM photos WHERE id = ?', [$r8l->body['id']]);
ok('світло з фото → в аналитике: зона не подписана — «взяли по порядку», не «счётчик электроэнергии, а не тепла»', $re->status === 200 && $pl7['status'] === 'recognized'
  && str_contains((string)$pl7['problem'], 'свет, день: зона не подписана') && !str_contains((string)$pl7['problem'], 'не тепла'), $pl7['problem']);
ok('газ при настройке без цифр → «показаний газового счётчика не найдено (настройка нового счётчика)»', str_contains((string)$pl8['problem'], 'газового счётчика на фото не найдено (настройка нового счётчика)'), $pl8['problem']);

echo "\nИстория версий данных и восстановление из /admin:\n";
$hu = new Browser('10.0.21.1'); $hu->req('POST', '/api/auth/register', ['email' => 'hist@example.ua', 'password' => 'hist pass 123']);
$huid = (int)Db::one("SELECT id FROM users WHERE email = 'hist@example.ua'")['id'];
$good = ['updatedAt' => 1000, 'onboarded' => true, 'places' => [['id' => 'main', 'name' => 'Победа', 'meter' => ['modelId' => 'sharky774'], 'water' => ['meters' => [['id' => 'c1', 'kind' => 'cold']]], 'updatedAt' => 900]],
  'readings' => [['id' => 'r1', 'createdAt' => '2026-10-20T08:00:00Z', 'updatedAt' => 800, 'photos' => [['id' => str_repeat('ab', 12)]]]]];
$bad = ['updatedAt' => 2000, 'onboarded' => true, 'places' => [['id' => 'main', 'name' => '', 'meter' => null, 'water' => ['meters' => []], 'updatedAt' => 2000], ['id' => 'p2', 'name' => 'Чужая', 'updatedAt' => 2000]],
  'readings' => [['id' => 'r1', 'createdAt' => '2026-10-20T08:00:00Z', 'updatedAt' => 800, 'deleted' => true], ['id' => 'junk', 'createdAt' => '2026-11-03T08:00:00Z', 'updatedAt' => 1990]], 'wipedAt' => 1500];
ok('первое сохранение — истории ещё нет', $hu->req('PUT', '/api/state', ['state' => $good, 'baseVersion' => 0])->body['version'] === 1 && !Db::one('SELECT id FROM user_state_hist WHERE user_id = ?', [$huid]));
ok('то же самое ещё раз — версия растёт, копии одинаковых данных не множатся', $hu->req('PUT', '/api/state', ['state' => $good, 'baseVersion' => 1])->body['version'] === 2 && !Db::one('SELECT id FROM user_state_hist WHERE user_id = ?', [$huid]));
ok('сохранение, затёршее квартиру, — прошлая версия ушла в историю', $hu->req('PUT', '/api/state', ['state' => $bad, 'baseVersion' => 2])->body['version'] === 3);
$hr = Db::one('SELECT * FROM user_state_hist WHERE user_id = ? ORDER BY id DESC', [$huid]);
ok('в истории — версия 2, сжатая, с временем сохранения и замены', $hr && (int)$hr['version'] === 2 && $hr['enc'] === (function_exists('gzdeflate') ? 'gz' : '') && $hr['reason'] === 'put'
  && json_decode((string)StateHist::raw($hr), true)['places'][0]['name'] === 'Победа' && (int)$hr['bytes'] === strlen(json_encode($good, JSON_UNESCAPED_UNICODE)), $hr);
ok('история не админу — 403', $hu->req('GET', '/api/admin/state/history', null, ['QUERY_STRING' => 'id=' . $huid])->status === 403
  && $hu->req('POST', '/api/admin/state/restore', ['user' => $huid, 'id' => (int)$hr['id']])->status === 403);
$hl = $boss->req('GET', '/api/admin/state/history', null, ['QUERY_STRING' => 'id=' . $huid])->body['history'] ?? [];
ok('история в /admin: сначала текущая (v3, 2 квартиры, тепла нет), дальше v2 (Победа, тепло и холодная)', count($hl) === 2 && !empty($hl[0]['current']) && $hl[0]['version'] === 3 && $hl[0]['summary']['places'] === 2
  && $hl[0]['summary']['kinds']['heat'] === 0 && $hl[1]['version'] === 2 && $hl[1]['labels'] === ['Победа'] && $hl[1]['summary']['kinds']['heat'] === 1 && $hl[1]['summary']['kinds']['cold'] === 1, $hl);
ok('версию можно посмотреть целиком; чужой пользователь / нет такой — 404', ($boss->req('GET', '/api/admin/state/version', null, ['QUERY_STRING' => 'user=' . $huid . '&id=' . $hr['id']])->body['state']['places'][0]['name'] ?? '') === 'Победа'
  && $boss->req('GET', '/api/admin/state/version', null, ['QUERY_STRING' => 'user=' . ($huid + 99) . '&id=' . $hr['id']])->status === 404);
Db::q('INSERT INTO photos (id, user_id, file, mime, bytes, status, created_at, kept) VALUES (?, ?, ?, ?, ?, ?, ?, 0)', [str_repeat('ab', 12), $huid, 'x.png', 'image/png', 10, 'recognized', Http::iso()]);
$rs = $boss->req('POST', '/api/admin/state/restore', ['user' => $huid, 'id' => (int)$hr['id']]);
$now = json_decode((string)Db::one('SELECT data FROM user_state WHERE user_id = ?', [$huid])['data'], true);
ok('«Восстановить»: версия 2 стала текущей под новым номером 4', $rs->status === 200 && $rs->body['version'] === 4 && $rs->body['from'] === 2 && $now['places'][0]['name'] === 'Победа' && $now['places'][0]['meter']['modelId'] === 'sharky774', $rs->body);
$ms = $now['restoredAt'] ?? 0;
ok('…с метками «сейчас» (побеждает копии в браузерах) и restoredAt', $ms > 1700000000000 && $now['updatedAt'] === $ms && $now['places'][0]['updatedAt'] === $ms && $now['readings'][0]['updatedAt'] === $ms && empty($now['readings'][0]['deleted']));
$pl = array_column($now['places'], null, 'id'); $rr = array_column($now['readings'], null, 'id');
ok('…квартира и запись, которых в ней не было, — «надгробия»', !empty($pl['p2']['deleted']) && $pl['p2']['updatedAt'] === $ms && !empty($rr['junk']['deleted']) && count($now['readings']) === 2);
ok('…«стереть всё» из затёртой версии не переносится', !isset($now['wipedAt']));
ok('…фото записи снова хранится, пока есть запись', (int)Db::one('SELECT kept FROM photos WHERE id = ?', [str_repeat('ab', 12)])['kept'] === 1);
$hr2 = Db::one('SELECT * FROM user_state_hist WHERE user_id = ? ORDER BY id DESC', [$huid]);
ok('…а затёртая версия 3 — в истории («заменена восстановлением»), её тоже можно вернуть', (int)$hr2['version'] === 3 && $hr2['reason'] === 'restore' && json_decode((string)StateHist::raw($hr2), true)['places'][1]['name'] === 'Чужая');
ok('…в «Входах и действиях» человека — кто и что восстановил', str_contains((string)Db::one('SELECT action FROM audit_log WHERE user_id = ? ORDER BY id DESC', [$huid])['action'], 'восстановлена версия 2 → 4 (boss@example.ua)'));
$c9 = $hu->req('PUT', '/api/state', ['state' => $bad, 'baseVersion' => 3]);
ok('устройство человека со старой версией → 409 и получает восстановленные данные для слияния', $c9->status === 409 && $c9->body['version'] === 4 && $c9->body['state']['places'][0]['name'] === 'Победа');
ok('восстановить несуществующую версию — 404', $boss->req('POST', '/api/admin/state/restore', ['user' => $huid, 'id' => 999999])->status === 404);
// чистка: старше 48 ч — по одной за день, старше 30 дней — нет, за 48 ч — не больше 200
Db::q('DELETE FROM user_state_hist WHERE user_id = ?', [$huid]);
$ins = function (int $ago, int $v) use ($huid) { Db::q('INSERT INTO user_state_hist (user_id, version, data, enc, bytes, saved_at, replaced_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [$huid, $v, '{"readings":[]}', '', 15, gmdate('c', time() - $ago - 60), gmdate('c', time() - $ago), 'put']); };
$d5 = strtotime(gmdate('Y-m-d', time() - 5 * 86400) . 'T12:00:00Z'); $off = time() - $d5;
$ins($off + 3600, 1); $ins($off + 1800, 2); $ins($off, 3);   // три за один день 5 дней назад
$ins(40 * 86400, 0);                                          // старше 30 дней
for ($i = 0; $i < 205; $i++) $ins(3600 + 204 - $i, 100 + $i);  // свежие, по порядку: v100 — самая старая
$gone = StateHist::cleanup();
$left = array_map('intval', array_column(Db::q('SELECT version FROM user_state_hist WHERE user_id = ? ORDER BY id', [$huid])->fetchAll(), 'version'));
ok('чистка истории: за день 5 дней назад осталась последняя (v3), старше 30 дней — нет, свежих — 200', $gone === 8 && in_array(3, $left, true) && !in_array(1, $left, true) && !in_array(2, $left, true) && !in_array(0, $left, true) && count($left) === 201 && !in_array(104, $left, true) && in_array(105, $left, true) && in_array(304, $left, true), [$gone, count($left)]);

// кнопка меню бота: «Відкрити» для всіх, «Открыть» — у чаті російськомовного після /start; команда /start — двома мовами
$mc = []; Telegram::$send = function ($m, $p, $tok = null) use (&$mc) { $mc[] = [$m, $p]; return ['ok' => true]; };
Telegram::menuSetup(); Telegram::handleUpdate(['message' => ['chat' => ['id' => 555], 'from' => ['id' => 555, 'language_code' => 'ru'], 'text' => '/start']]);
Telegram::handleUpdate(['message' => ['chat' => ['id' => 556], 'from' => ['id' => 556, 'language_code' => 'uk'], 'text' => '/start']]);
$mb = array_values(array_filter($mc, fn($x) => $x[0] === 'setChatMenuButton'));
ok('кнопка меню бота: «Відкрити» за замовчуванням, «Открыть» у чаті рос. після /start (укр. — без окремої), /start описано укр. і рос.', count($mb) === 2 && $mb[0][1]['menu_button']['text'] === 'Відкрити' && !isset($mb[0][1]['chat_id'])
  && $mb[1][1]['chat_id'] === 555 && $mb[1][1]['menu_button']['text'] === 'Открыть' && count(array_filter($mc, fn($x) => $x[0] === 'setMyCommands' && ($x[1]['language_code'] ?? '') === 'ru')) === 1
  && str_contains(end($mc)[1]['text'] ?? '', 'Що вміє сервіс'), $mb);
Telegram::$send = null;
// смена бота из чата: админ пересылает сообщение @BotFather с токеном нового бота (владелец 07.11: «перенеси и настрой бот сам»)
{
  $NEW = '7777777777:AAHnewTokenForTestsOnly_0123456789ab'; $rt0 = Cfg::runtime(); $calls = [];
  Telegram::$send = function ($m, $p, $tok = null) use (&$calls, $NEW, $TOKEN) {
    $calls[] = [$m, $p, $tok];
    if ($m === 'getMe') return $tok === $NEW ? ['ok' => true, 'result' => ['username' => 'NewTeploBot']] : ($tok === $TOKEN ? ['ok' => true, 'result' => ['username' => 'TeploTestBot']] : ['ok' => false, 'description' => 'Unauthorized']);
    if ($m === 'getMyDescription') return ['ok' => true, 'result' => ['description' => ($p['language_code'] ?? '') === 'ru' ? 'Описание' : 'Опис']];
    if ($m === 'getMyShortDescription') return ['ok' => true, 'result' => ['short_description' => '']];
    if ($m === 'getMyCommands') return ['ok' => true, 'result' => [['command' => 'start', 'description' => 'Почати'], ['command' => 'help', 'description' => 'Довідка']]];
    return ['ok' => true];
  };
  $bf = "Done! Congratulations on your new bot. You will find it at t.me/NewTeploBot.\n\nUse this token to access the HTTP API:\n$NEW\nKeep your token secure and store it safely.";
  $r0 = Telegram::handleUpdate(['message' => ['message_id' => 41, 'chat' => ['id' => 4241, 'type' => 'private'], 'from' => ['id' => 4241, 'language_code' => 'uk'], 'text' => $bf]]);
  $del = array_values(array_filter($calls, fn($c) => $c[0] === 'deleteMessage'));
  ok('бот из чата: токен от НЕ админа — не меняем, сообщение с токеном удалено (старым ботом), ответ «лише адміністратор»', ($r0['bot'] ?? '') === 'not_admin' && Cfg::get('bot_token') === $TOKEN
    && count($del) === 1 && $del[0][1]['message_id'] === 41 && $del[0][2] === $TOKEN && str_contains((string)($r0['text'] ?? ''), 'адміністратор') && !array_filter($calls, fn($c) => $c[0] === 'getMe'), $calls);
  $bossId = (int)(Db::one('SELECT id FROM users WHERE email = ?', ['boss@example.ua'])['id'] ?? 0);
  if (!$bossId) { Db::q('INSERT INTO users (email, created_at) VALUES (?, ?)', ['boss@example.ua', Http::iso()]); $bossId = (int)Db::id(); }
  $bossTg = Db::one("SELECT * FROM user_identities WHERE user_id = ? AND type = 'telegram'", [$bossId]); Db::q("DELETE FROM user_identities WHERE user_id = ? AND type = 'telegram'", [$bossId]);
  Db::q("INSERT INTO user_identities (user_id, type, external_id, username, linked_at) VALUES (?, 'telegram', '4242', 'boss_tg', ?)", [$bossId, Http::iso()]);
  ok('…у админа есть Telegram (привязан к учётке админа) — /api/health → bot.adminTg', Admin::hasTg() === true && Admin::isTg(['id' => 4242]) && !Admin::isTg(['id' => 4241]));
  $calls = [];
  $r1 = Telegram::handleUpdate(['message' => ['message_id' => 42, 'chat' => ['id' => 4242, 'type' => 'private'], 'from' => ['id' => 4242, 'language_code' => 'uk'],
    'forward_origin' => ['type' => 'user', 'sender_user' => ['id' => 93372553, 'username' => 'BotFather']], 'text' => $bf]]);
  $by = fn($m, $tok = null) => array_values(array_filter($calls, fn($c) => $c[0] === $m && ($tok === null || $c[2] === $tok)));
  $last = end($calls);
  ok('бот из чата: админ переслал сообщение @BotFather — новый токен сохранён, вебхук новому (тот же secret), описание и команды перенесены, у старого вебхук снят',
    ($r1['bot'] ?? '') === 'ok' && Cfg::get('bot_token') === $NEW && Cfg::get('bot_username') === 'NewTeploBot' && Cfg::get('bot_token_prev') === $TOKEN && Cfg::get('webhook_secret') === 'hook-secret'
    && count($by('setWebhook', null)) === 1 && ($by('setWebhook')[0][1]['secret_token'] ?? '') === 'hook-secret' && count($by('setMyDescription', $NEW)) === 4 && count($by('setMyCommands', $NEW)) >= 1
    && count($by('deleteWebhook', $TOKEN)) === 1 && ($by('deleteMessage')[0][2] ?? '') === $TOKEN, $calls);
  ok('…ответ — от старого бота (чат с ним): «тепер сервіс — @NewTeploBot», что перенесено, /setdomain с адресом сайта, кнопка на нового; токена в ответе нет',
    $last[0] === 'sendMessage' && $last[2] === $TOKEN && str_contains($last[1]['text'], '@NewTeploBot') && str_contains($last[1]['text'], 'опис, команди') && str_contains($last[1]['text'], '/setdomain → @NewTeploBot → teplo.example')
    && ($last[1]['reply_markup']['inline_keyboard'][0][0]['url'] ?? '') === 'https://t.me/NewTeploBot' && !str_contains(json_encode($last[1]), 'AAHnew'), $last);
  $hb = (new Browser('10.0.13.5'))->req('GET', '/api/health')->body['bot'] ?? []; $hj = json_encode($hb);
  ok('…/api/health → bot: имя нового, прежний есть, смена (с кого на кого, что перенесено), попытка из чата ok — без токенов', ($hb['username'] ?? '') === 'NewTeploBot' && ($hb['prev'] ?? null) === true
    && ($hb['moved']['from'] ?? '') === 'TeploTestBot' && ($hb['moved']['to'] ?? '') === 'NewTeploBot' && ($hb['chat']['res'] ?? '') === 'ok' && !str_contains($hj, 'AAHnew') && !str_contains($hj, 'TEST-TOKEN'), $hb);
  $wa = (new Browser('10.0.13.6'))->req('POST', '/api/auth/telegram/webapp', ['initData' => initData($TOKEN, ['id' => 9070, 'first_name' => 'Старий'])]);
  $wb = (new Browser('10.0.13.7'))->req('POST', '/api/auth/telegram/webapp', ['initData' => initData($NEW, ['id' => 9071, 'first_name' => 'Новий'])]);
  $wc = (new Browser('10.0.13.8'))->req('POST', '/api/auth/telegram/webapp', ['initData' => initData('555:SOMEONE-ELSE-token-xx', ['id' => 9072, 'first_name' => 'Чужий'])]);
  ok('…вход в Mini App: из меню нового бота и ещё из меню прежнего — да, подпись чужого бота — 401', $wa->status === 200 && $wb->status === 200 && $wc->status === 401, [$wa->status, $wb->status, $wc->status]);
  $calls = []; $r2 = Telegram::handleUpdate(['message' => ['message_id' => 43, 'chat' => ['id' => 4242, 'type' => 'private'], 'from' => ['id' => 4242, 'language_code' => 'ru'], 'text' => $NEW]]);
  $r3 = Telegram::handleUpdate(['message' => ['message_id' => 44, 'chat' => ['id' => 4242, 'type' => 'private'], 'from' => ['id' => 4242, 'language_code' => 'uk'], 'text' => '8888888888:AAHrejectedTokenForTests_0123456789']]);
  ok('…тот же токен ещё раз — «уже подключён», ничего не меняем; токен, который Telegram не принял, — «Не вийшло», бот прежний', ($r2['bot'] ?? '') === 'same' && ($r3['bot'] ?? '') === 'err'
    && str_contains((string)$r3['text'], 'Telegram не принял') && Cfg::get('bot_token') === $NEW, [$r2, $r3]);
  // вернуть тестовый бот: дальше тесты ждут TeploTestBot
  Cfg::saveRuntime(['bot_token' => null, 'bot_username' => null, 'bot_token_prev' => null, 'webhook_secret' => $rt0['webhook_secret'] ?? null]);
  Db::q("DELETE FROM user_identities WHERE external_id = '4242'");
  if ($bossTg) Db::q('INSERT INTO user_identities (user_id, type, external_id, username, linked_at) VALUES (?, ?, ?, ?, ?)', [$bossId, 'telegram', $bossTg['external_id'], $bossTg['username'], $bossTg['linked_at']]);
}
Telegram::$send = null;
// постачальники й тарифи за адресою (app/data/providers.json); дата — фіксована, бо тарифи датовані
Providers::$today = '2026-11-05';
$pv = fn($q) => Providers::lookup($q);
$a1 = $pv('Малая Даниловка, ул.Академическая 10, кв.20'); $a2 = $pv('смт Мала Данилівка, вул. Академічна, 10, кв. 20'); $a3 = $pv('с-ще Мала Данилівка, Академічна 10');
ok('постачальники: «Малая Даниловка, ул.Академическая 10» / «смт Мала Данилівка…» / «с-ще …» → Мала Данилівка (КАТОТТГ), громада, Газмережі Харківська філія 2,388, вода — КП «Малоданилівський комунальник» без тарифу',
  $a1['found'] && $a1['place']['name'] === 'Мала Данилівка' && $a2['place']['id'] === $a1['place']['id'] && $a3['place']['id'] === $a1['place']['id'] && $a1['how'] === 'name'
  && $a1['place']['hromada'] === 'Малоданилівська' && $a1['place']['district'] === 'Харківський' && $a1['kinds']['gas']['dist'] === 2.388 && $a1['kinds']['water']['supply'] === null && str_contains($a1['kinds']['water']['org'], 'Малоданилівський'), $a1);
$k1 = $pv('пр. Победы 86А, кв. 61'); $k2 = $pv('Харьков, ул. Сумская 10'); $k3 = $pv('с. Неіснуюче, вул. Миру 1');
ok('Харків: адреса з вулиці без пункту → Харків (how default), «Харьков, …» → Харків (name); незнайомий пункт → found false (не вигадуємо Харків); світло 4,32 і газ 7,96 — загальнодержавні з джерелом',
  $k1['found'] && $k1['place']['name'] === 'Харків' && $k1['how'] === 'default' && $k2['place']['name'] === 'Харків' && $k2['how'] === 'name' && !$k3['found'] && $k3['reason'] === 'place'
  && $k1['national']['elec']['price'] === 4.32 && $k1['national']['gas']['price'] === 7.96 && $k1['national']['elec']['to'] === '2027-04-30' && $k1['kinds']['water']['supply'] === 49.446 && $k1['kinds']['gas']['dist'] === 0.516, [$k1['how'] ?? null, $k3]);
// довідник v2: уся область — описки, рос. назви, старі назви, уточнення
$v = fn($q, $n = null, $h = null) => Providers::lookup($q, $n, $h);
$c1 = $v('Чугуев, ул. Мира 2'); $c2 = $v('Балаклея, Жовтнева 5'); $c3 = $v('Красноград, Полтавская 10'); $c4 = $v('г. Первомайский, ул. Мира 1'); $c5 = $v('Южный, Кирова 5');
ok('v2: рос. назви (Чугуев, Балаклея) і старі (Красноград → Берестин, Первомайский → Златопіль, Южный → Південне — місто, не село) → пункт і громада',
  $c1['place']['name'] === 'Чугуїв' && $c2['place']['name'] === 'Балаклія' && $c3['place']['name'] === 'Берестин' && $c3['how'] === 'old' && $c3['place']['hromada'] === 'Берестинська'
  && $c4['place']['name'] === 'Златопіль' && $c4['place']['hromada'] === 'Златопільська' && $c5['place']['name'] === 'Південне' && $c5['place']['kind'] === 'M', [$c1['place'] ?? $c1, $c3['place'] ?? $c3, $c5['place'] ?? $c5]);
$t1 = $v('Волчанск'); $t2 = $v('Двуречная'); $t3 = $v('Малоданилівка'); $t4 = $v('Песочин, Набережная 3');
ok('v2: описки й рос. форми (Волчанск, Двуречная, «Малоданилівка» разом, Песочин) → how typo; Песочин — селище, «Не той?» — село в Богодухівській',
  $t1['place']['name'] === 'Вовчанськ' && $t1['how'] === 'typo' && $t2['place']['name'] === 'Дворічна' && $t3['place']['name'] === 'Мала Данилівка' && $t4['place']['name'] === 'Пісочин' && $t4['place']['kind'] === 'X'
  && count($t4['alts']) === 1 && $t4['alts'][0]['hromada'] === 'Богодухівська', [$t1['how'] ?? $t1, $t4]);
$m1 = $v('Миколаївка, вул. Миру 5'); $m2 = $v('с. Олександрівка, Дергачівський р-н'); $m3 = $v('Миколаївка, вул. Миру 5', $m1['candidates'][3]['n'] ?? '', $m1['candidates'][3]['h'] ?? '');
ok('v2: Миколаївка (17 у області, 13 громад) → reason ambiguous і список «Уточніть» (пункт, громада, район); старий район звужує; уточнення n+h → how settled',
  !$m1['found'] && $m1['reason'] === 'ambiguous' && count($m1['candidates']) >= 12 && !empty($m1['candidates'][0]['hromada']) && !empty($m1['candidates'][0]['district'])
  && !$m2['found'] && count($m2['candidates']) === 2 && $m3['found'] && $m3['how'] === 'settled' && $m3['place']['h'] === $m1['candidates'][3]['h'], [count($m1['candidates'] ?? []), $m2['candidates'] ?? $m2, $m3['how'] ?? $m3]);
// довідник, 26-та сесія: датований тариф Харківводоканалу, виправлення й нові громади
$hw = $k1['kinds']['water'];
Providers::$today = '2027-01-02'; Providers::reset(); $hw2 = $pv('пр. Победы 86А, кв. 61')['kinds']['water']; Providers::$today = '2026-11-05'; Providers::reset();
ok('Харківводоканал: до 01.01.2027 — 49,446 / 20,82 і next 57,504 / 27,992; з 02.01.2027 — уже 57,504 / 27,992 з 2027-01-01, без next',
  $hw['supply'] === 49.446 && $hw['drain'] === 20.82 && ($hw['next']['from'] ?? '') === '2027-01-01' && $hw['next']['supply'] === 57.504 && $hw['next']['drain'] === 27.992
  && $hw2['supply'] === 57.504 && $hw2['drain'] === 27.992 && $hw2['from'] === '2027-01-01' && !isset($hw2['next']), [$hw, $hw2]);
ok('Providers::dated: список кроків — чинний останній, що настав; наступний — у next; без next — як є',
  Providers::dated(['supply' => 1, 'next' => [['from' => '2027-06-01', 'supply' => 3], ['from' => '2026-01-01', 'supply' => 2]]], '2026-11-05') === ['supply' => 2, 'from' => '2026-01-01', 'next' => ['from' => '2027-06-01', 'supply' => 3]]
  && Providers::dated(['supply' => 5], '2026-11-05') === ['supply' => 5]);
$w = fn($q) => $pv($q)['kinds'] ?? [];
$bl = $w('Балаклія, вул. Жовтнева 5'); $lz = $w('м. Лозова, вул. Ломоносова 2'); $cg = $w('Чугуїв, вул. Миру 2'); $mf = $w('Мерефа, вул. Дніпровська 1');
ok('вода: Балаклія — населення 19,40 / 35,00 (не 47,08 — то бюджет); Лозова 48 / 51 з 01.11.2024 і бот; Чугуїв 31,62 / 22,62; Мерефа — водовідведення 54,33',
  $bl['water']['supply'] === 19.4 && $bl['water']['drain'] === 35.0 && $lz['water']['supply'] === 48.0 && $lz['water']['drain'] === 51.0 && $lz['water']['from'] === '2024-11-01'
  && str_contains($lz['water']['bot'] ?? '', 't.me/') && $cg['water']['supply'] === 31.62 && $cg['water']['drain'] === 22.62 && $mf['water']['drain'] === 54.33, [$bl['water'] ?? null, $lz['water'] ?? null]);
$bg = $w('Богодухов, ул. Шевченко 1'); $rg = $w('смт Рогань, вул. Шкільна 3'); $pd = $w('Южный, Кирова 5'); $bz = $w('Безлюдовка, ул. Мира 2'); $sl = $w('Слобожанське, вул. Ювілейна 4'); $zl = $w('г. Первомайский, мкр 1/2');
ok('нові громади: Богодухів 29,26 / 48,19; Рогань — вода 21,54 / 16,97 і тепло 1 839,62 (не ХТМ); Південне 28,84 без водовідведення; Безлюдівка 23,072 / 23,667; Слобожанське — тепло від Зміївської ТЕС; Златопіль — КП «Тепломережі»',
  $bg['water']['supply'] === 29.26 && $bg['water']['drain'] === 48.19 && $rg['water']['supply'] === 21.54 && $rg['heat']['price'] === 1839.62 && !isset($rg['heat']['via'])
  && $pd['water']['supply'] === 28.84 && $pd['water']['drain'] === null && $bz['water']['supply'] === 23.072 && str_contains($sl['heat']['org'] ?? '', 'Зміївська ТЕС')
  && str_contains($zl['water']['org'] ?? '', 'Тепломережі') && str_contains($zl['heat']['org'] ?? '', 'Тепломережі'), [$bg['water'] ?? null, $rg['heat'] ?? null, $pd['water'] ?? null]);
$lb = $w('Люботин, вул. Слобожанська 26'); $zv = $w('Зміїв, вул. Харківська 1'); $iz = $w('Ізюм, вул. Соборна 1'); $dr = $w('Дергачі, вул. Сумський шлях 1'); $sn = $w('Солоницівка, вул. Пушкіна 3');
ok('27-ма сесія: Люботин 56,88 / 76,68 з 01.10.2026 (рішення № 423); Зміїв 70 / 80,70 з 01.08.2026; Ізюм 26,904 / 22,968; Дергачі 29,70 / 9,65 і тепло КП «Постачальник послуг»; Солоницівка — вода 69,72 від КП, тепло лишається ХТМ',
  $lb['water']['supply'] === 56.88 && $lb['water']['drain'] === 76.68 && $lb['water']['from'] === '2026-10-01' && $zv['water']['supply'] === 70.0 && $zv['water']['drain'] === 80.7
  && $iz['water']['supply'] === 26.904 && $iz['water']['drain'] === 22.968 && $dr['water']['supply'] === 29.7 && str_contains($dr['heat']['org'] ?? '', 'Постачальник послуг')
  && $sn['water']['supply'] === 69.72 && $sn['water']['drain'] === null && str_contains($sn['water']['org'] ?? '', 'Солоницівське') && ($sn['heat']['via'] ?? '') === 'htm', [$lb['water'] ?? null, $sn['water'] ?? null]);
$kt = $w('с. Котлярі, вул. Миру 1'); $bu = $w('смт Буди, вул. Шевченка 2'); $fs = $w('с. Феськи, вул. Центральна 3'); $es = $w('Есхар, вул. Шевченка 1'); $mr = $w('с. Мала Рогань, вул. Миру 4');
ok('пункти зі своїм постачальником: Котлярі 16,29 / 11,75 (решта Безлюдівської — 23,072); Буди — КП «Будиводоканал»; Феськи — «Феськівське ЖКГ»; Есхар — «Вода Есхара»; Мала Рогань — «Малороганський комунгосп»',
  $kt['water']['supply'] === 16.29 && $kt['water']['drain'] === 11.75 && $bz['water']['supply'] === 23.072 && str_contains($bu['water']['org'] ?? '', 'Будиводоканал') && $bu['water']['supply'] === null
  && str_contains($fs['water']['org'] ?? '', 'Феськівське') && str_contains($es['water']['org'] ?? '', 'Вода Есхара') && str_contains($mr['water']['org'] ?? '', 'Малороганський'), [$kt['water'] ?? null, $bu['water'] ?? null]);
$iy = $pv('с. Іськів Яр'); $sb = $pv('Сосновий Бір, вул. Лісна 1'); $dk = $v('Олександрівка, Дергачівський р.');
ok('назва на «-р» — не район: Есхар, Іськів Яр, Сосновий Бір знаходяться; «Дергачівський р.» і далі — підказка району',
  ($es['org'] ?? null) === null && ($iy['place']['name'] ?? '') === 'Іськів Яр' && ($sb['place']['name'] ?? '') === 'Сосновий Бір' && ($dk['reason'] ?? '') === 'ambiguous'
  && Providers::parse('Олександрівка, Дергачівський р.')['d'] === [Providers::nk('Дергачівський')], [$iy['place'] ?? $iy, $sb['place'] ?? $sb]);
$sh = $w('смт Сахновщина, вул. Шевченка 10'); $bv = $w('Барвінкове, вул. Соборна 1'); $bo = $w('Борова, вул. Миру 76');
ok('нові громади 27-ї: Сахновщина 29,15 / 27,92 з 10.01.2022 і телефони КВКП; Барвінкове — водовідведення 108,11, вода невідома; Борова — Борівське КВКП без тарифу',
  $sh['water']['supply'] === 29.15 && $sh['water']['drain'] === 27.92 && count($sh['water']['phones'] ?? []) === 3 && $bv['water']['supply'] === null && $bv['water']['drain'] === 108.11
  && str_contains($bo['water']['org'] ?? '', 'Борівське') && $bo['water']['supply'] === null, [$sh['water'] ?? null, $bv['water'] ?? null]);
$kp = $w('м. Куп’янськ, вул. Соборна 1'); $vb = $w('смт Великий Бурлук, вул. Шевченка 2'); $pc = $w('Печенеги, ул. Независимости 5'); $ol = $w('с. Картамиш, вул. Миру 3');
$vh = $w('с. Вільхівка, вул. Центральна 1'); $np = $w('смт Новопокровка, вул. Дворянська 9'); $kg = $w('смт Кегичівка, вул. Волошина 7');
ok('28-ма сесія: Куп’янськ — КП «Куп’янський водоканал» і тепло «Куп’янськтеплоенерго»; Великий Бурлук — КВКП «Водоканал»; Печеніги — КП «Джерело»; Картамиш (Олексіївська) — «Агрокомунгосп»; Вільхівка — «Малороганський комунгосп» (як і Мала Рогань); Новопокровка — без чужого КП «Новопокровське» (то Дніпропетровщина), Есхар — «Вода Есхара»; Кегичівка — ціна з платіжки',
  str_contains($kp['water']['org'] ?? '', 'Куп’янський водоканал') && str_contains($kp['heat']['org'] ?? '', 'Куп’янськтеплоенерго') && $kp['water']['supply'] === null
  && str_contains($vb['water']['org'] ?? '', 'Великобурлуцьке') && str_contains($pc['water']['org'] ?? '', 'Джерело') && str_contains($ol['water']['org'] ?? '', 'Агрокомунгосп')
  && str_contains($vh['water']['org'] ?? '', 'Малороганський') && str_contains($mr['water']['org'] ?? '', 'Малороганський')
  && array_key_exists('org', $np['water'] ?? []) && $np['water']['org'] === null && !str_contains(json_encode($np, JSON_UNESCAPED_UNICODE), 'Новопокровське') && str_contains($es['water']['org'] ?? '', 'Вода Есхара')
  && $kg['water']['supply'] === null && str_contains($kg['water']['note'] ?? '', '2025–2030'), [$kp['water'] ?? null, $np['water'] ?? null, $pc['water'] ?? null]);
$sv = $w('смт Савинці, вул. Соборна 43'); $mz = $w('с. Морозівка, Ізюмський р-н'); $zm = $w('с. Залиман'); $ck = $w('смт Чкаловське, вул. Світла 1'); $ml = $w('смт Малинівка, вул. Соїча 5');
$vv = $w('м. Вовчанськ, вул. Соборна 92'); $dr2 = $w('Дергачі, вул. Сумський шлях 1');
ok('29-та сесія: Савинці — дільниця КП «Балаклійський водоканал», решта Савинської — з платіжки (8,14 була абонплата за сміття), Залиман — 2021; Чкаловське → Пролісне, КП «Пролісненське ЖКЕУ-2013»; Малинівка — тепло 1 463,06; Борова — тепло КПТМ; Вовчанськ — КП «Вовчанськ» і ПТМ; Дергачі — програма відшкодування в note',
  str_contains($sv['water']['org'] ?? '', 'Балаклійський водоканал') && array_key_exists('org', $mz['water'] ?? []) && $mz['water']['org'] === null && !str_contains(json_encode($mz, JSON_UNESCAPED_UNICODE), '8,14')
  && str_contains($zm['water']['note'] ?? '', '2021') && str_contains($ck['water']['org'] ?? '', 'Пролісненське') && $ml['heat']['price'] === 1463.06 && str_contains($ml['heat']['org'] ?? '', 'Малинівка')
  && str_contains($bo['heat']['org'] ?? '', 'теплових мереж') && str_contains($vv['water']['org'] ?? '', 'КП «Вовчанськ»') && str_contains($vv['heat']['org'] ?? '', 'Вовчанське')
  && $dr2['water']['supply'] === 29.7 && str_contains($dr2['water']['note'] ?? '', 'відшкодування'), [$sv['water'] ?? null, $mz['water'] ?? null, $ck['water'] ?? null, $ml['heat'] ?? null]);
// 30-та сесія: Чкаловська громада → Пролісненська (розпорядження КМУ № 1331-р від 26.11.2025): нова назва в місці й довіднику, стара в адресі теж звужує
{ $p1 = $v('смт Пролісне, вул. Світла 1'); $p2 = $v('с. Миколаївка, Чкаловська громада'); $p3 = $v('с. Миколаївка, Пролісненська громада'); $p4 = $v('с. Миколаївка, Пролисненская громада');
  ok('Пролісненська громада: назва, стара «Чкаловська» в адресі, рос. написання; вода — КП «Пролісненське ЖКЕУ-2013»',
    ($p1['place']['hromada'] ?? '') === 'Пролісненська' && str_contains($p1['kinds']['water']['org'] ?? '', 'Пролісненське')
    && $p2['found'] && $p2['place']['n'] === 'Миколаївка' && $p2['place']['hromada'] === 'Пролісненська' && $p3['found'] && $p3['place']['h'] === $p2['place']['h'] && $p4['found'] && $p4['place']['h'] === $p2['place']['h']
    && !isset(Providers::data()['hromadas']['Чкаловська']), [$p1['place'] ?? $p1, $p2['candidates'] ?? $p2['place'] ?? null]); }
// кожна громада довідника є в КАТОТТГ (інакше її ніхто не знайде), у кожного тарифу — джерело; кожен «громада/пункт» — справжній пункт цієї громади
$kh = array_map(fn($id) => Providers::hname((string)$id), array_keys(Providers::kat()['hromadas'])); $bad = [];
$tariffs = function ($hn, $x) use (&$bad) { foreach ($x as $kd => $o) if ((isset($o['supply']) && $o['supply'] !== null) || (isset($o['drain']) && $o['drain'] !== null) || (isset($o['price']) && $o['price'] !== null)) if (empty($o['src']) || empty($o['src_ru'])) $bad[] = "$hn/$kd без src"; };
foreach (Providers::data()['hromadas'] as $hn => $x) { if (!in_array($hn, $kh, true)) $bad[] = $hn; $tariffs($hn, $x); }
$katSt = []; foreach (Providers::kat()['settlements'] as $s) $katSt[Providers::hname((string)$s['h']) . '/' . $s['n']] = true;
foreach ((array)(Providers::data()['settlements'] ?? []) as $key => $x) { if (!isset($katSt[$key])) $bad[] = "пункт $key"; $tariffs($key, $x); }
ok('довідник: усі громади й пункти є в КАТОТТГ, у кожного тарифу є джерело (укр. і рос.)', !$bad, $bad);
{ $res = $phone->req('GET', '/api/providers', null, ['QUERY_STRING' => 'q=' . rawurlencode('Малая Даниловка, Академическая 10')]);
  ok('GET /api/providers?q= → 200, Мала Данилівка', $res->status === 200 && ($res->body['place']['name'] ?? '') === 'Мала Данилівка', [$res->status, $res->body]); }
{ // журнал сбоев сервера для /admin: пишется, новые сверху, без лишнего; обрезается до последних KEEP
  ErrLog::add('GET', '/api/bot/replies', new RuntimeException('SQLSTATE[HY000] boom'));
  ErrLog::add('POST', '/api/state', new LogicException('second'));
  $el = ErrLog::list(5);
  ok('ErrLog: новые сверху, метод/путь/текст/где', count($el) === 2 && $el[0]['p'] === '/api/state' && str_contains($el[1]['e'], 'RuntimeException: SQLSTATE') && preg_match('/\.php:\d+$/', $el[0]['w']), $el);
  $ov = Admin::route('GET /api/admin/overview', [], [], ['id' => 1, 'email' => 'a@b.c']);
  ok('сводка /admin отдаёт errors', isset($ov['errors']) && count($ov['errors']) === 2);
  for ($i = 0; $i < 700; $i++) ErrLog::add('GET', '/api/x' . $i, new RuntimeException(str_repeat('x', 150)));
  $n = count(file(ErrLog::file())); ok('ErrLog обрезается (≤ ' . (ErrLog::KEEP + 400) . ' строк)', $n <= ErrLog::KEEP + 400 && ErrLog::list(1)[0]['p'] === '/api/x699', $n);
  @unlink(ErrLog::file()); }
{ // лимит одним запросом (INSERT … ON CONFLICT): счёт точный, строка уже есть (соседний запрос успел) — не 500, а +1; на пределе — 429
  $lk = 'rl_test:' . bin2hex(random_bytes(3)); [$lmax, $lwin] = Cfg::get('limits')['login_ip']; $lst = intdiv(Http::now(), $lwin) * $lwin;
  Db::q('INSERT INTO rate_limits (k, window_start, cnt) VALUES (?, ?, 1)', ['login_ip:' . $lk, $lst]);   // как будто соседний запрос вставил между SELECT и INSERT
  $codes = []; for ($i = 0; $i < $lmax; $i++) { try { RateLimit::hit('login_ip', $lk); $codes[] = 200; } catch (HttpError $e) { $codes[] = $e->status; } }
  $cnt = (int)Db::one('SELECT cnt FROM rate_limits WHERE k = ? AND window_start = ?', ['login_ip:' . $lk, $lst])['cnt'];
  ok("RateLimit: строка уже есть — +1 без ошибки, на {$lmax}-м — 429, счёт $lmax", $codes === array_merge(array_fill(0, $lmax - 1, 200), [429]) && $cnt === $lmax, [$codes, $cnt]); }
{ // журнал: «#tgWebAppData=…» (Mini App открылся со своими данными входа) — экран «home», данных входа в журнале нет
  $je($anon, 'tgw12345hash', 'sessTG1', [['t' => 1000, 'n' => 'screen', 's' => 'tgWebAppData=query_id%3DAAH0XucP%26user%3D%257B%257D&tgWebAppVersion=8.0']]);
  $sc = Db::one("SELECT screen FROM events WHERE vid = 'tgw12345hash'")['screen'] ?? null;
  ok('журнал: экран «tgWebAppData=…» записан как home', $sc === 'home', $sc); }
echo "\nВыход:\n";
$phone->req('POST', '/api/auth/logout');
ok('после выхода /api/me → 401', $phone->req('GET', '/api/me')->status === 401);

echo "\n— кабинеты поставщиков: проба страниц входа (CabProbe)\n";
CabWeb::$http = function ($m, $url, $b, $c, $h) {
  if (str_contains($url, 'hts.kharkov.ua/cabinet')) return ['code' => 200, 'body' => mb_convert_encoding('<html><script src="https://www.google.com/recaptcha/api.js"></script><form><input name="email"><input name="passw" type="password"></form>Кабінет</html>', 'Windows-1251', 'UTF-8')];
  if (str_contains($url, 'pa.oblenergo')) return ['code' => 302, 'body' => '', 'location' => 'https://evil.example/login'];
  if (str_contains($url, 'my.grmu.com.ua')) return ['code' => 200, 'body' => '<div id="app" data-page="' . htmlspecialchars(json_encode(['component' => 'Auth/Login', 'props' => ['captcha' => 'sitekey123']]), ENT_QUOTES) . '"></div>'];
  return ['code' => 0, 'body' => '', 'err' => 'no route'];
};
$pr = CabProbe::run();
ok('ХТМ: форма входа есть, скрипт reCAPTCHA без виджета → ok', ($pr['htm']['ok'] ?? null) === true && $pr['htm']['script'] === true && $pr['htm']['widget'] === false, $pr['htm']);
ok('обленерго: редирект на чужой сайт → не ok, offsite', ($pr['obl']['ok'] ?? null) === false && ($pr['obl']['offsite'] ?? '') === 'evil.example', $pr['obl']);
ok('Газмережі: Inertia с captcha в props → не ok', ($pr['grm']['ok'] ?? null) === false && ($pr['grm']['captchaProp'] ?? null) === true && ($pr['grm']['component'] ?? '') === 'Auth/Login', $pr['grm']);
ok('…форма настройки капчи без значений: строка → длина, включена', ($pr['grm']['captchaShape'] ?? null) === 'str:10' && ($pr['grm']['captchaOn'] ?? null) === true && ($pr['grm']['props'] ?? null) === ['captcha'], $pr['grm']);
ok('captchaOn: {enabled: false, siteKey} → выключена; {siteKey} → не поняли; null → нет; shape прячет значения', CabProbe::captchaOn(['enabled' => false, 'siteKey' => 'abc']) === false && CabProbe::captchaOn(['siteKey' => 'abc']) === null
  && CabProbe::captchaKind('0x4AAAAAAABkMYinukE8nzYS') === 'turnstile' && CabProbe::captchaKind('6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI') === 'recaptcha' && CabProbe::captchaKind('sitekey123') === null
  && CabProbe::captchaOn(null) === false && CabProbe::shape(['enabled' => false, 'siteKey' => '6LcAAAAA', 'driver' => 'turnstile']) === ['enabled' => false, 'siteKey' => 'str:8', 'driver' => 'turnstile']);
ok('проба записана и видна в /api/health', (CabProbe::read()['v'] ?? 0) === CabProbe::V && ($pr['htm']['lastOk'] ?? null) !== null && $pr['obl']['lastOk'] === null);
ok('турникет Cloudflare → widget', CabWeb::captcha('<input type="hidden" name="cf-turnstile-response">')['widget'] === true);
// вид отказа Cloudflare: от него зависит, пустит ли обленерго ретранслятор из Украины
$geo = '<!DOCTYPE html><title>Access denied | pa.oblenergo.kharkov.ua used Cloudflare to restrict access</title><h1><span>Error</span><span class="cf-error-code">1009</span></h1>'
  . '<p>The owner of this website (pa.oblenergo.kharkov.ua) has banned the country or region your IP address is in (DE) from accessing this website.</p>Cloudflare Ray ID';
$robots = [];
CabWeb::$http = function ($m, $url, $b, $c, $h) use (&$geo, &$robots) {
  if (str_ends_with($url, '/robots.txt')) { $robots[] = $url; return ['code' => str_contains($geo, '1009') ? 403 : 200, 'body' => 'User-agent: *', 'h' => ['server' => 'cloudflare']]; }
  if (str_contains($url, 'pa.oblenergo')) return ['code' => 403, 'body' => $geo, 'h' => ['server' => 'cloudflare'] + (str_contains($geo, 'Just a moment') ? ['cf-mitigated' => 'challenge'] : [])];
  return ['code' => 200, 'body' => '<form><input name="passw"></form>'];
};
$o = CabProbe::one('obl');
ok('обленерго 1009 → cfKind geo, страна DE, robots тоже закрыт', ($o['cfKind'] ?? '') === 'geo' && ($o['cfCode'] ?? 0) === 1009 && ($o['cfCc'] ?? '') === 'DE' && ($o['robots'] ?? 0) === 403 && $o['ok'] === false
  && $robots === ['https://pa.oblenergo.kharkov.ua/robots.txt'], $o);
$geo = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script></body></html>';
$o = CabProbe::one('obl');
ok('обленерго «Just a moment» + cf-mitigated → challenge, robots открыт', ($o['cfKind'] ?? '') === 'challenge' && !isset($o['cfCode']) && ($o['cf'] ?? null) === true && ($o['robots'] ?? 0) === 200, $o);
$geo = '<title>Attention Required! | Cloudflare</title><h1>Sorry, you have been blocked</h1><span class="cf-error-code">1020</span>';
ok('1020 → block', (CabProbe::one('obl')['cfKind'] ?? '') === 'block');
$o = CabProbe::one('htm');
ok('без Cloudflare — ни cfKind, ни robots', !isset($o['cfKind']) && !isset($o['robots']) && $o['ok'] === true, $o);
ok('403 своего сайта без Cloudflare → не cfKind', CabWeb::cfKind('<h1>Forbidden</h1>', 403, ['server' => 'nginx']) === []);
CabWeb::$http = null;
$hj = (array)(new Browser('10.0.13.9'))->req('GET', '/api/health')->body;
ok('/api/health → rev совпадает с tests/rev.php', ($hj['rev'] ?? '') === trim((string)shell_exec('php ' . escapeshellarg(__DIR__ . '/rev.php'))) && preg_match('/^[0-9a-f]{12}$/', $hj['rev'] ?? ''), $hj['rev'] ?? null);

echo "\n— Проба обленерго из Украины: NAS шлёт вывод curl -i -L, сервер разбирает (RelayProbe)\n";
$cfOut = "HTTP/2 403 \r\ndate: Sat, 07 Nov 2026 03:00:00 GMT\r\ncontent-type: text/html; charset=UTF-8\r\ncf-mitigated: challenge\r\nserver: cloudflare\r\ncf-ray: 8f00-KBP\r\n\r\n"
  . '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><div id="challenge-error-text">Enable JavaScript and cookies to continue</div><script>(function(){window._cf_chl_opt={cType: "managed"};var a=document.createElement("script");a.src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1?ray=8f00";})();</script></body></html>'
  . "\n#lichylnyky 403 0 0.41\n";
$sp = RelayProbe::split($cfOut);
ok('split: код, заголовки, тело и метка curl -w', $sp['codes'] === [403] && ($sp['h']['cf-mitigated'] ?? '') === 'challenge' && str_starts_with($sp['body'], '<!DOCTYPE') && !str_contains($sp['body'], '#lichylnyky') && ($sp['w'] ?? null) === ['code' => 403, 'redirects' => 0, 's' => 0.41], $sp['w'] ?? $sp['codes']);
$a = RelayProbe::analyze('obl', $cfOut);
ok('managed challenge → cloudflare/challenge, формы нет', $a['verdict'] === 'cloudflare' && ($a['cfKind'] ?? '') === 'challenge' && $a['form'] === false && $a['code'] === 403 && !empty($a['cfRay']), $a);
$loginHtml = '<html><head><title>Особистий кабінет</title><script src="/frontend/web/assets/1a2b/yii.js"></script></head><body><div class="site-login"><form id="login-form" action="/frontend/web/index.php/uk/site/login" method="post">'
  . '<input type="hidden" name="_csrf-frontend" value="abc"><input type="text" name="LoginForm[email]" required><input type="password" name="LoginForm[password]" required><input type="checkbox" name="LoginForm[rememberMe]" value="1"><button type="submit" name="login-button">Увійти</button></form></div></body></html>';
$redir = "HTTP/1.1 301 Moved Permanently\r\nLocation: https://pa.oblenergo.kharkov.ua/frontend/web/index.php/uk/site/login\r\nServer: cloudflare\r\n\r\nHTTP/1.1 200 OK\r\nServer: cloudflare\r\nContent-Type: text/html\r\n\r\n" . $loginHtml . "\n#lichylnyky 200 1 0.88\n";
$a = RelayProbe::analyze('obl', $redir);
ok('кабинет пустил (200 после редиректа) → ok: форма входа, поля, без капчи', $a['verdict'] === 'ok' && $a['codes'] === [301, 200] && ($a['final'] ?? '') === '/frontend/web/index.php/uk/site/login' && $a['form'] === true && !isset($a['cfKind']) && !isset($a['captchaKind'])
  && in_array('password:LoginForm[password]*', $a['forms'][0]['fields'] ?? [], true) && in_array('hidden:_csrf-frontend', $a['forms'][0]['fields'], true) && ($a['forms'][0]['method'] ?? '') === 'post' && ($a['title'] ?? '') === 'Особистий кабінет', $a);
ok('…скелет формы: теги и имена без значений', str_contains($a['skel'] ?? '', '<form id="login-form"') && str_contains($a['skel'], 'name="LoginForm[password]"') && !str_contains($a['skel'], 'abc'), $a['skel'] ?? null);
$formTs = "HTTP/2 200\r\nserver: cloudflare\r\n\r\n" . '<html><body><form id="pokaz" action="/uk/transmissionofmeterreadings" method="post"><input name="account" type="text"><input name="value1" type="number"><div class="cf-turnstile" data-sitekey="0x4AAAAAAABBBBBBBBCCCCCC"></div><button type="submit">Передати</button></form><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async></script></body></html>';
$a = RelayProbe::analyze('form', $formTs);
ok('онлайн-форма с Turnstile → captcha turnstile (в фоне не подать — не обходим)', $a['verdict'] === 'captcha' && ($a['captchaKind'] ?? '') === 'turnstile' && $a['form'] === true && !empty($a['widget']), $a);
$formJs = "HTTP/2 200\r\nserver: nginx\r\n\r\n" . '<html><body><div id="app"><input id="acc" name="acc" type="text"><input name="zone1" type="text"><button id="send">OK</button></div><script>$("#send").on("click",function(){$.post("/api/meter-readings/send",{acc:$("#acc").val()});});</script></body></html>';
$a = RelayProbe::analyze('form', $formJs);
ok('онлайн-форма на JS (поля вне <form>, AJAX) → ok, поля и адрес отправки', $a['verdict'] === 'ok' && $a['form'] === true && in_array('text:acc', $a['loose'] ?? [], true) && in_array('/api/meter-readings/send', $a['ajax'] ?? [], true), $a);
ok('пустой вывод (curl не достучался) → down', RelayProbe::analyze('obl', "\n#lichylnyky 000 0 25.00\n")['verdict'] === 'down');
ok('команда для NAS: обе страницы, наш адрес, синтаксис sh', str_contains(RelayProbe::command('https://peredai.com.ua'), RelayProbe::T['obl']['url']) && str_contains(RelayProbe::command('https://peredai.com.ua'), 'https://peredai.com.ua/api/relay/probe?t=$t&via=nas')
  && (function () { $f = tempnam(sys_get_temp_dir(), 'cmd'); file_put_contents($f, RelayProbe::command()); exec('sh -n ' . escapeshellarg($f) . ' 2>&1', $o, $rc); @unlink($f); return $rc === 0; })());
$nas = new Browser('10.0.14.1');
$r = $nas->req('POST', '/api/relay/probe', null, ['QUERY_STRING' => 't=obl&via=nas', 'HTTP_CF_IPCOUNTRY' => 'UA', 'CONTENT_TYPE' => 'text/plain'], false, $cfOut);
ok('API: без cookie и X-CSRF (curl с NAS) принимается, страна из CF-IPCountry', $r->status === 200 && $r->body['verdict'] === 'cloudflare' && $r->body['cc'] === 'UA' && ($r->body['cfKind'] ?? '') === 'challenge', [$r->status, $r->body]);
$r = (new Browser('10.0.14.2'))->req('POST', '/api/relay/probe', null, ['QUERY_STRING' => 't=form&via=nas', 'HTTP_CF_IPCOUNTRY' => 'UA'], false, $formJs . "\n#lichylnyky 200 0 0.3\n");
$hj = (array)(new Browser('10.0.14.3'))->req('GET', '/api/health')->body; $up = json_decode(json_encode($hj['uaProbe'] ?? []), true);
ok('/api/health → uaProbe: obl и form, страна, via, без скелета', ($up['obl']['verdict'] ?? '') === 'cloudflare' && ($up['form']['verdict'] ?? '') === 'ok' && ($up['obl']['cc'] ?? '') === 'UA' && ($up['obl']['via'] ?? '') === 'nas' && !isset($up['form']['skel']) && ($up['obl']['n'] ?? 0) === 1, $up);
$g = (new Browser('10.0.14.3'))->req('GET', '/api/relay/probe', null, ['QUERY_STRING' => 't=form'])->body;
ok('GET /api/relay/probe?t=form — целиком (поля вне форм, AJAX) и команда', ($g['probe']['loose'][0] ?? '') === 'text:acc' && str_contains($g['command'], 'curl -s -i -L'), $g);
ok('чужая цель → 422', (new Browser('10.0.14.4'))->req('POST', '/api/relay/probe', null, ['QUERY_STRING' => 't=evil'], false, 'x')->status === 422);
$pj = RelayProbe::dir() . '/probe.json'; $jj = json_decode((string)file_get_contents($pj), true); $jj['obl']['v'] = 0; $jj['obl']['verdict'] = 'stale'; file_put_contents($pj, json_encode($jj));
$rd = RelayProbe::read();
ok('старая версия разбора перечитывается из сохранённого вывода (время и страна — прежние)', ($rd['obl']['v'] ?? 0) === RelayProbe::V && $rd['obl']['verdict'] === 'cloudflare' && $rd['obl']['cc'] === 'UA' && $rd['obl']['at'] === $jj['obl']['at'], $rd['obl'] ?? null);
ok('лимит тела: документы и фото — max_photo_bytes, вывод curl — max_probe_bytes, прочее — max_body_bytes', Api::bodyLimit('/api/docs/upload') === Cfg::get('max_photo_bytes') && Api::bodyLimit('/api/recognize/upload') === Cfg::get('max_photo_bytes')
  && Api::bodyLimit('/api/relay/probe') === 3 * 1024 * 1024 && Api::bodyLimit('/api/state') === Cfg::get('max_body_bytes'));

echo "\n— Обленерго с украинских узлов check-host.net (UaCheck): только коды ответа, раз на версию\n";
$hosts = ['nodes' => ['de1.node.check-host.net' => ['location' => ['de', 'Germany', 'Frankfurt']], 'ua1.node.check-host.net' => ['location' => ['ua', 'Ukraine', 'Kyiv']],
  'ua3.node.check-host.net' => ['location' => ['ua', 'Ukraine', 'Khmelnytskyi']], 'pl1.node.check-host.net' => ['location' => ['pl', 'Poland', 'Poznan']]]];
ok('украинские узлы: по location и только они', UaCheck::uaNodes($hosts) === ['ua1.node.check-host.net' => 'Kyiv', 'ua3.node.check-host.net' => 'Khmelnytskyi'] && UaCheck::uaNodes(['nodes' => ['ua2.node.check-host.net' => []]]) === ['ua2.node.check-host.net' => '']);
ok('ответ узла: 200 / таймаут без кода / ещё идёт', UaCheck::cell([[1, 0.13, 'OK', '200', '1.2.3.4']]) === ['code' => 200, 'ok' => true, 'msg' => 'OK', 'ms' => 130]
  && UaCheck::cell([[0, 3.0, 'Connection timed out', null, null]])['code'] === null && UaCheck::cell(null) === null && UaCheck::cell([null]) === null);
ok('вердикт: есть 200 → ok, все 403/503 → blocked, иначе unknown', UaCheck::verdict([['code' => 403], ['code' => 200]]) === 'ok' && UaCheck::verdict([['code' => 403], ['code' => 503]]) === 'blocked'
  && UaCheck::verdict([['code' => null]]) === 'unknown' && UaCheck::verdict([]) === 'unknown' && UaCheck::verdict([['code' => 403], ['code' => null]]) === 'blocked');
$uc = []; $pollN = 0;
UaCheck::$http = function (string $url) use (&$uc, &$pollN, $hosts) {
  $uc[] = $url;
  if (str_ends_with($url, '/nodes/hosts')) return ['code' => 200, 'body' => json_encode($hosts)];
  if (str_contains($url, '/check-http?')) return ['code' => 200, 'body' => json_encode(['ok' => 1, 'request_id' => str_contains($url, 'pa.oblenergo') ? 'r-obl' : 'r-form'])];
  if (str_contains($url, '/check-result/r-obl')) { $pollN++; return ['code' => 200, 'body' => json_encode(['ua1.node.check-host.net' => [[0, 0.1, 'Forbidden', '403', '1.1.1.1']], 'ua3.node.check-host.net' => $pollN > 1 ? [[0, 0.2, 'Forbidden', '403', '1.1.1.1']] : null])]; }
  if (str_contains($url, '/check-result/r-form')) return ['code' => 200, 'body' => json_encode(['ua1.node.check-host.net' => [[1, 0.3, 'OK', '200', '2.2.2.2']], 'ua3.node.check-host.net' => [[0, 0.2, 'Forbidden', '403', '2.2.2.2']]])];
  return ['code' => 404, 'body' => ''];
};
$t0 = 1_800_000_000; $u1 = UaCheck::run($t0);
ok('шаг 1: узлы, check-http обеих страниц только с украинских узлов', ($u1['req'] ?? []) === ['obl' => 'r-obl', 'form' => 'r-form'] && count($uc) === 3
  && str_contains($uc[1], 'host=' . rawurlencode(RelayProbe::T['obl']['url'])) && str_contains($uc[1], '&node=ua1.node.check-host.net&node=ua3.node.check-host.net') && !str_contains($uc[1], 'de1'), [$u1, $uc]);
ok('результат не раньше чем через 20 с', UaCheck::run($t0 + 10) === null && count($uc) === 3);
$u2 = UaCheck::run($t0 + 25);
ok('шаг 2: один узел ещё идёт → не готово, форма уже ok', empty($u2['done']) && $u2['res']['form']['verdict'] === 'ok' && count($u2['res']['obl']['nodes']) === 1, $u2);
$u3 = UaCheck::run($t0 + 50);
ok('все ответили → готово: кабинет blocked (403 с Украины), форма ok', !empty($u3['done']) && $u3['res']['obl']['verdict'] === 'blocked' && $u3['tries'] === 2, $u3);
ok('готово — больше не ходим', UaCheck::run($t0 + 500) === null && count($uc) === 7);
$hj = (array)(new Browser('10.0.14.5'))->req('GET', '/api/health')->body; $uk = json_decode(json_encode($hj['uaCheck'] ?? []), true);
ok('/api/health → uaCheck: вердикты и «код сообщение» по узлам, без IP сайта', ($uk['obl']['verdict'] ?? '') === 'blocked' && ($uk['form']['nodes']['ua1.node.check-host.net'] ?? '') === '200 OK'
  && ($uk['nodes']['ua1.node.check-host.net'] ?? '') === 'Kyiv' && !str_contains(json_encode($uk), '1.1.1.1'), $uk);
@unlink(UaCheck::file()); $uc = [];
UaCheck::$http = fn(string $url) => ['code' => 200, 'body' => json_encode(['nodes' => ['de1.node.check-host.net' => ['location' => ['de', 'Germany', 'Frankfurt']]]])];
$u4 = UaCheck::run($t0);
ok('нет украинских узлов → готово с no_ua_nodes и подсказкой (сколько узлов всего), проверок не запускаем', !empty($u4['done']) && $u4['err'] === 'no_ua_nodes' && ($u4['hint']['n'] ?? 0) === 1 && UaCheck::run($t0 + 100) === null, $u4);
@unlink(UaCheck::file());
UaCheck::$http = fn(string $url) => str_ends_with($url, '/nodes/hosts') ? ['code' => 200, 'body' => json_encode($hosts)] : ['code' => 200, 'body' => json_encode(['error' => 'limit_exceeded'])];
$u5 = UaCheck::run($t0);
ok('check-http не дал request_id → start_failed с текстом error', !empty($u5['done']) && ($u5['res']['obl']['hint']['error'] ?? '') === 'limit_exceeded' && ($u5['err'] ?? '') === 'start_failed', $u5);
@unlink(UaCheck::file()); UaCheck::$http = null;

echo "\n— IndexNow (Bing и др.): ключ сайта и пинг раз на сборку\n";
$calls = []; IndexNow::$http = function ($url) use (&$calls) { $calls[] = $url; return ['code' => count($calls) === 1 ? 429 : 202, 'err' => null]; };
ok('ключа ещё нет — /<hex>.txt не отдаём', IndexNow::key() === '' && IndexNow::serve('/' . str_repeat('a', 32) . '.txt') === false);
ok('localhost — не пингуем и ключ не создаём', IndexNow::run('https://localhost/') === null && IndexNow::key() === '' && !$calls);
$t0 = 1_800_000_000; $r1 = IndexNow::run('https://teplo.example/', $t0); $k = IndexNow::key();
ok('первый пинг: ключ создан, адрес и ключ в запросе', preg_match('/^[0-9a-f]{32}$/', $k) && count($calls) === 1 && $calls[0] === IndexNow::API . '?url=' . rawurlencode('https://teplo.example/') . '&key=' . $k && $r1['code'] === 429, [$calls, $r1]);
ok('429 — повтор не раньше чем через сутки', IndexNow::run('https://teplo.example/', $t0 + 3600) === null && count($calls) === 1);
$r2 = IndexNow::run('https://teplo.example/', $t0 + 86400 + 60);
ok('через сутки — повтор, 202 → принято', count($calls) === 2 && $r2['code'] === 202);
ok('та же сборка после 202 — молчим', IndexNow::run('https://teplo.example/', $t0 + 2 * 86400) === null && count($calls) === 2);
ok('другой адрес сайта — пингуем снова', IndexNow::run('https://peredai.example/', $t0 + 2 * 86400) !== null && count($calls) === 3);
ob_start(); $sv = IndexNow::serve('/' . $k . '.txt'); $body = ob_get_clean();
ok('/<ключ>.txt отдаёт ключ, чужой — нет', $sv === true && $body === $k && IndexNow::serve('/' . strrev($k) . '.txt') === false);
$hs = IndexNow::summary();
ok('/api/health → indexnow: код и дата, без ключа', ($hs['code'] ?? 0) === 202 && $hs['key'] === true && !str_contains(json_encode($hs), $k), $hs);
IndexNow::$http = null;

echo "\n— Ретранслятор на NAS (Relay): ключ, протокол next/done, разбор формы обленерго\n";
$rb = new Browser('10.9.9.9');
$r = $rb->req('GET', '/api/relay/next', null, ['HTTP_X_RELAY_KEY' => 'nope']);
ok('relay: без токена — 403 relay_key', $r->status === 403 && ($r->body['error'] ?? '') === 'relay_key', $r->body);
Relay::newToken(); $tok = Relay::conf()['token'];
$r = $rb->req('GET', '/api/relay/next', null, ['QUERY_STRING' => 'v=1', 'HTTP_X_RELAY_KEY' => $tok, 'HTTP_CF_IPCOUNTRY' => 'UA']);
ok('relay: первое задание — проба формы, текстом', $r->status === 200 && $r->text !== null && preg_match('/^job (\d+) 0\nmethod GET\nurl https:\/\/oblenergo\.kharkiv\.ua\/uk\/transmissionofmeterreadings\nh Accept: /', $r->text), $r->text);
preg_match('/^job (\d+)/', (string)$r->text, $m); $pid = (int)($m[1] ?? 0);
$r2 = $rb->req('GET', '/api/relay/next', null, ['QUERY_STRING' => 'v=1', 'HTTP_X_RELAY_KEY' => $tok]);
ok('relay: пока шаг не вернулся — idle', str_starts_with((string)$r2->text, 'idle '), $r2->text);
$formHtml = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body><form action=\"/uk/send\" method=\"post\"><input type=hidden name=_t value=abc><label for=a>Особовий рахунок</label><input id=a name=acc required>"
  . "<label for=v>Показники лічильника</label><input id=v name=val required><button name=go value=1>OK</button></form></body></html>\n#lichylnyky 200 0 0.4\n";
$r = $rb->req('POST', '/api/relay/done', null, ['QUERY_STRING' => 'id=' . $pid . '&s=0', 'HTTP_X_RELAY_KEY' => $tok, 'HTTP_CF_IPCOUNTRY' => 'UA'], false, $formHtml);
ok('relay: done без CSRF-заголовка, «ok» и следующий шаг — кабинет', $r->status === 200 && $r->text === "ok\n" && Relay::job($pid)['step'] === 1 && str_contains(Relay::job($pid)['req']['u'], 'pa.oblenergo'), [$r->status, $r->text, $r->body]);
$r = $rb->req('POST', '/api/relay/done', null, ['QUERY_STRING' => 'id=' . $pid . '&s=0', 'HTTP_X_RELAY_KEY' => $tok], false, $formHtml);
ok('relay: повтор старого шага — stale', $r->text === "stale\n", $r->text);
$r = $rb->req('GET', '/api/relay/next', null, ['QUERY_STRING' => 'v=1', 'HTTP_X_RELAY_KEY' => $tok]);
$cf = "HTTP/2 403\r\nserver: cloudflare\r\ncf-mitigated: challenge\r\n\r\n<html><title>Just a moment...</title></html>\n#lichylnyky 403 0 0.1\n";
$r = $rb->req('POST', '/api/relay/done', null, ['QUERY_STRING' => 'id=' . $pid . '&s=1', 'HTTP_X_RELAY_KEY' => $tok, 'HTTP_CF_IPCOUNTRY' => 'UA'], false, $cf);
$pj = Relay::job($pid);
ok('relay: проба готова — форма ok + план, кабинет cloudflare; «ok end»', $r->text === "ok end\n" && $pj['state'] === 'done' && $pj['result']['form'] === 'ok' && $pj['result']['obl'] === 'cloudflare' && ($pj['result']['plan']['roles'] ?? []) === ['acc' => 'acc', 'val' => 'all'], $pj['result']);
$h = (new Browser())->req('GET', '/api/health')->body['relay'] ?? [];
ok('relay: /api/health — на связи, UA, v 1, без ключа', $h['online'] === true && $h['cc'] === 'UA' && $h['v'] === 1 && !str_contains(json_encode($h), $tok), $h);
$pl = RelayForm::plan('<form method="post"><input type="hidden" name="_csrf" value="x"><label for="a">Номер особового рахунку</label><input id="a" name="F[ls]" required><button type="submit">Далі</button></form>', 'https://oblenergo.kharkiv.ua/uk/x', ['acc' => '123456', 'zones' => ['all' => '5']]);
ok('relay: форма только с рахунком — шаг «acc» (двухшаговая)', $pl['ok'] && ($pl['step'] ?? '') === 'acc' && $pl['pairs'][1] === ['F[ls]', '123456'], $pl);
$pl = RelayForm::plan('<form method="post"><label for="a">Особовий рахунок</label><input id="a" name="acc" required><label for="n">Номер лічильника</label><input id="n" name="num" required><label for="v">Показання</label><input id="v" name="v" required></form>', 'https://oblenergo.kharkiv.ua/uk/x', ['acc' => '123456', 'zones' => ['all' => '5']]);
ok('relay: «номер лічильника» — не показання; нет номера → unknown_fields', !$pl['ok'] && $pl['err'] === 'unknown_fields' && $pl['unknown'] === ['num:serial'] && $pl['roles'] === ['acc' => 'acc', 'v' => 'all'], $pl);
$pl = RelayForm::plan('<form method="post"><input name="acc" placeholder="Особовий рахунок"><input name="z1" placeholder="Пік"><input name="z2" placeholder="Напівпік"><input name="z3" placeholder="Ніч"></form>', 'https://oblenergo.kharkiv.ua/uk/x', ['acc' => '1', 'zones' => ['peak' => '3', 'half' => '2', 'night' => '1']]);
ok('relay: трёхзонна — пік, напівпік, ніч', $pl['ok'] && $pl['roles'] === ['acc' => 'acc', 'z1' => 'peak', 'z2' => 'half', 'z3' => 'night'], $pl);
$v = RelayForm::verdict(RelayProbe::split("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"success\":false,\"message\":\"Невірний рахунок 123\"}"));
$v2 = RelayForm::verdict(RelayProbe::split("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"status\":\"ok\",\"message\":\"Показники прийнято\"}"));
ok('relay: ответ JSON — ошибка / принято, цифры → #', $v['kind'] === 'err' && str_contains($v['msg'], '###') && $v2['kind'] === 'ok', [$v, $v2]);
$e = null; try { Relay::send(['acc' => '12', 'zones' => ['all' => '1']], ['id' => 1], true); } catch (HttpError $x) { $e = $x->err; }
$e2 = null; try { Relay::send(['acc' => '123456', 'zones' => ['day' => '1']], ['id' => 1], true); } catch (HttpError $x) { $e2 = $x->err; }
ok('relay: проверка ввода — короткий рахунок, одна зона из двух', $e === 'bad_acc' && $e2 === 'bad_zones', [$e, $e2]);
ok('relay: окно света — 29.11 и 2.12 да, 15.11 нет (Киев)', Relay::elecWin(strtotime('2026-11-29 10:00 UTC')) && Relay::elecWin(strtotime('2026-12-02 10:00 UTC')) && !Relay::elecWin(strtotime('2026-11-15 10:00 UTC')) && !Relay::elecWin(strtotime('2026-11-28 10:00 UTC')));
$sc = Relay::script('https://peredai.com.ua', 'abc123');
ok('relay: сценарий — ключ в заголовке, белый список адресов, без -L', str_contains($sc, "K='abc123'") && str_contains($sc, 'X-Relay-Key: $K') && str_contains($sc, "P='https://oblenergo.kharkiv.ua/ ") && !preg_match('/curl[^\n]* -L /', $sc), null);

Db::q('INSERT INTO reminders_sent (user_id, kind, ym, sent_at, status) VALUES (?, ?, ?, ?, ?)', [424242, 'elec2', '2026-10', '2026-11-02T16:17:01+00:00', 'error: Bad Request: chat 777001 is deactivated']);
$re = json_decode(json_encode((new Browser())->req('GET', '/api/health')->body['remindErr'] ?? []), true);
ok('/api/health → remindErr: вид, месяц, ответ Telegram, цифры замаскированы', ($re[0]['kind'] ?? '') === 'elec2' && str_contains($re[0]['status'], 'chat ###### is deactivated') && !str_contains(json_encode($re), '777001'), $re);
echo "\nИтог: $pass OK, $fail FAIL\n";
exit($fail ? 1 : 0);
