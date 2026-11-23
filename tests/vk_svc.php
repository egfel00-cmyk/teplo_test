<?php
// Вода → сайт Водоканалу «у фоні» и автоподача после фото в бот (VkSvc) — против синтетического кабинета tests/vk-mock (без сети).
// Запуск: php tests/vk_svc.php
declare(strict_types=1);
define('TEPLO', 1);
foreach (['core', 'telegram', 'reminders', 'recognize', 'admin', 'vkcab', 'cabs', 'htmsvc', 'vksvc', 'gpv', 'providers', 'visits', 'journal', 'docs', 'relay', 'localbot', 'share', 'widget', 'mail', 'api'] as $f) require_once __DIR__ . "/../app/$f.php";
require __DIR__ . '/vk-mock/pages.php';
$TMP = sys_get_temp_dir() . '/teplo_vksvc_' . getmypid(); putenv('SITE_DATA=' . $TMP);
Cfg::set(['app_url' => 'https://teplo.example/', 'bot_token' => '1:TEST', 'vk_cab_base' => 'https://billing.vodokanal.kharkov.ua', 'cookie_secure' => false]);
Db::set(new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC])); Db::migrate();
$SENT = []; Telegram::$send = function ($m, $p) use (&$SENT) { $SENT[] = $p; return ['ok' => true]; };
$VKM = []; $DOWN = false;
VkCab::$http = function ($m, $url, $body, $cookie) use (&$VKM, &$DOWN) {
  if ($DOWN) return ['code' => 0, 'body' => '', 'err' => 'timeout'];
  [$code, $html, $h] = vkm_request($m, $url, $body, $cookie, $VKM); $out = ['code' => $code, 'body' => $html, 'cookies' => [], 'location' => null];
  foreach ($h as $x) { if (stripos($x, 'Set-Cookie:') === 0) $out['cookies'][] = trim(substr($x, 11)); if (stripos($x, 'Location:') === 0) $out['location'] = trim(substr($x, 9)); }
  return $out; };
$vkSent = function () use (&$VKM) { $n = 0; foreach ($VKM as $k => $x) if ($k[0] !== '_' && is_array($x)) $n += (int)($x['sent'] ?? 0); return $n; };
$pass = 0; $fail = 0;
function ok(string $n, bool $c, $info = null): void { global $pass, $fail; echo ($c ? '  OK  ' : ' FAIL ') . $n . (!$c && $info !== null ? '  → ' . json_encode($info, JSON_UNESCAPED_UNICODE) : '') . "\n"; $c ? $pass++ : $fail++; }
final class B {
  public array $jar = [];
  public function req(string $m, string $path, ?array $body = null): Res {
    if (empty($this->jar['ts_csrf'])) $this->take(Api::handle(new Req('GET', '/api/config', ['REMOTE_ADDR' => '10.0.0.9'], $this->jar)));
    $sv = ['REMOTE_ADDR' => '10.0.0.9', 'HTTP_USER_AGENT' => 'test']; if ($m !== 'GET') $sv['HTTP_X_CSRF'] = $this->jar['ts_csrf'] ?? '';
    $r = Api::handle(new Req($m, $path, $sv, $this->jar, $body === null ? '' : json_encode($body))); $this->take($r); return $r;
  }
  private function take(Res $r): void { foreach ($r->cookies as [$n, $v, $o]) { if ($o['expires'] < time()) unset($this->jar[$n]); else $this->jar[$n] = $v; } }
}
$b = new B();
$r = $b->req('POST', '/api/auth/register', ['email' => 'w1@example.com', 'password' => 'long-pass-1']); $uid = (int)$r->body['user']['id'];
Db::q("INSERT INTO user_identities (user_id, type, external_id, username, linked_at) VALUES (?, 'telegram', '555', 'w1', ?)", [$uid, Http::iso()]);
$ACC = ['acc' => '905614', 'fam' => 'Шевченко', 'lang' => 'uk'];

$r = $b->req('GET', '/api/vk/jobs'); ok('пусто: автоотправка выключена', $r->status === 200 && $r->body['auto'] === false && $r->body['jobs'] === [], $r->body);
// «Відправити у фоні»: ключа поля сайта не знаем — сервер найдёт по номеру
$r = $b->req('POST', '/api/vk/queue', $ACC + ['rid' => 'w1', 'place' => 'p1', 'items' => [['value' => '458', 'serial' => '123456', 'kind' => 'cold', 'name' => 'Холодна']]]);
$j1 = $r->body['job'] ?? [];
ok('у фоні: в очереди сразу, без 📝, рахунок — в строке, прізвище зашифровано', $r->status === 200 && $j1['status'] === 'queued' && $j1['nextAt'] <= time() && !$j1['auto'] && $SENT === []
  && !str_contains((string)Db::one('SELECT payload FROM cab_jobs')['payload'], 'Шевченко'), $r->body);
$r = $b->req('POST', '/api/vk/queue', $ACC + ['rid' => 'w1', 'items' => [['value' => '458', 'serial' => '123456', 'kind' => 'cold', 'name' => 'Холодна']]]); ok('второе нажатие — то же, не дубль', !empty($r->body['dup']) && $r->body['job']['id'] === $j1['id'], $r->body);
$out = VkSvc::cron(); $row = Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$j1['id']]);
ok('cron: отправлено на сайт → ok', ($out[0][1] ?? '') === 'ok' && $vkSent() === 1 && ($VKM['_lastPost']['post']['DynamicModel']['newIndication']['1282444'] ?? '') === '458', $out);
ok('…Telegram «✅ Водоканал прийняв» с цифрой', str_contains($SENT[0]['text'] ?? '', 'Водоканал прийняв') && str_contains($SENT[0]['text'], 'Холодна — 458'), $SENT);
ok('…прізвище из очереди стёрто, ключ поля — в итоге', !str_contains($row['payload'], '"sec"') && str_contains((string)$row['result'], '1282444'), $row);
$r = $b->req('GET', '/api/vk/jobs'); ok('статус в приложении: ok, rid', ($r->body['jobs'][0]['status'] ?? '') === 'ok' && $r->body['jobs'][0]['rid'] === 'w1', $r->body['jobs'] ?? null);
// меньше, чем сайт уже знает (458) — не шлём
$SENT = []; $n0 = $vkSent();
$r = $b->req('POST', '/api/vk/queue', $ACC + ['rid' => 'w2', 'items' => [['value' => '450', 'serial' => '0123456', 'kind' => 'cold', 'name' => 'Холодна']]]); VkSvc::cron();
$j = VkSvc::pubJob(Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$r->body['job']['id']]));
ok('меньше прошлого на сайте → failed less, на сайт ничего', $j['status'] === 'failed' && $j['why'] === 'less' && $vkSent() === $n0 && str_contains((string)$j['human'], '458'), $j);
ok('…⚠️ в Telegram с причиной', str_starts_with($SENT[0]['text'] ?? '', '⚠️ Не надіслали') && str_contains($SENT[0]['text'], 'менше'), $SENT);
// два холодных у нас, на сайте один холодный и один горячий — по виду не понять
$r = $b->req('POST', '/api/vk/queue', $ACC + ['rid' => 'w3', 'items' => [['value' => '470', 'kind' => 'cold', 'name' => 'Кухня'], ['value' => '471', 'kind' => 'cold', 'name' => 'Ванна']]]); VkSvc::cron();
$j = VkSvc::pubJob(Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$r->body['job']['id']])); ok('не поняли, какой лічильник какой → failed which', $j['status'] === 'failed' && $j['why'] === 'which', $j);
// сайт не отвечает: ещё 2 попытки через 15 минут, потом ⚠️
$DOWN = true; $SENT = [];
$r = $b->req('POST', '/api/vk/queue', $ACC + ['rid' => 'w4', 'items' => [['value' => '480', 'kind' => 'cold', 'name' => 'Холодна']]]); $id4 = $r->body['job']['id'];
VkSvc::cron(); $j = Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$id4]); ok('сайт молчит → снова в очереди через 15 мин, без сообщений', $j['status'] === 'queued' && (int)$j['tries'] === 1 && (int)$j['next_at'] > time() + 800 && $SENT === [], $j);
VkSvc::cron(time() + 1000); VkSvc::cron(time() + 2000); $j = VkSvc::pubJob(Db::one('SELECT * FROM cab_jobs WHERE id = ?', [$id4]));
ok('…3 раза подряд → failed down и ⚠️', $j['status'] === 'failed' && $j['why'] === 'down' && str_starts_with($SENT[0]['text'] ?? '', '⚠️'), [$j, $SENT]);
$DOWN = false;
// автоподача: без согласия — нет; с согласием — очередь на 10 мин, 📝, отмена, «зараз»
$r = $b->req('POST', '/api/vk/queue', $ACC + ['rid' => 'a1', 'auto' => true, 'items' => [['value' => '490', 'kind' => 'cold', 'name' => 'Холодна']]]); ok('автоподача без согласия — 409', $r->status === 409 && $r->body['error'] === 'vk_auto_off', $r->body);
$r = $b->req('POST', '/api/vk/auto', ['on' => true]); ok('включить без галочки — 422', $r->status === 422 && $r->body['error'] === 'vk_consent', $r->body);
$r = $b->req('POST', '/api/vk/auto', ['on' => true, 'consent' => true]); ok('включено, согласие с датой', $r->status === 200 && $r->body['auto'] === true && VkSvc::autoOn($uid) && str_contains((string)Db::one("SELECT extra FROM cab_creds WHERE prov = 'vk'")['extra'], 'consentAt'), $r->body);
$SENT = []; $r = $b->req('POST', '/api/vk/queue', $ACC + ['rid' => 'a1', 'place' => 'p1', 'auto' => true, 'items' => [['value' => '490', 'kind' => 'cold', 'name' => 'Холодна']]]); $a1 = $r->body['job'];
ok('автоподача: очередь на 10 мин + 📝 с временем', $a1['status'] === 'queued' && $a1['auto'] && $a1['nextAt'] >= time() + 590 && str_starts_with($SENT[0]['text'] ?? '', '📝') && str_contains($SENT[0]['text'], 'Холодна — 490'), [$a1, $SENT]);
ok('cron до срока не трогает', VkSvc::cron() === []);
$r = $b->req('POST', '/api/vk/job/cancel', ['job' => $a1['id']]); ok('скасувати → cancelled, прізвище стёрто', ($r->body['job']['status'] ?? '') === 'cancelled' && !str_contains(Db::one('SELECT payload FROM cab_jobs WHERE id = ?', [$a1['id']])['payload'], '"sec"'), $r->body);
$r = $b->req('POST', '/api/vk/job/cancel', ['job' => $a1['id']]); ok('повторная отмена — 409 no_job', $r->status === 409 && $r->body['error'] === 'vk_no_job', $r->body);
Db::q('DELETE FROM rate_limits');
$r = $b->req('POST', '/api/vk/queue', $ACC + ['rid' => 'a2', 'auto' => true, 'items' => [['value' => '491', 'kind' => 'cold', 'name' => 'Холодна']]]); $a2 = $r->body['job'];
$r = $b->req('POST', '/api/vk/job/now', ['job' => $a2['id']]); ok('«Надіслати зараз» → ok', ($r->body['job']['status'] ?? '') === 'ok', $r->body);
// выключить автоотправку: очередь автоподачи отменяется, «у фоні» — нет
$r = $b->req('POST', '/api/vk/queue', $ACC + ['rid' => 'a3', 'auto' => true, 'items' => [['value' => '495', 'kind' => 'cold', 'name' => 'Холодна']]]); $a3 = $r->body['job'];
$r = $b->req('POST', '/api/vk/auto', ['on' => false]); ok('выключить → автоподача в очереди отменена', $r->body['auto'] === false && Db::one('SELECT status FROM cab_jobs WHERE id = ?', [$a3['id']])['status'] === 'cancelled', $r->body);
$r = $b->req('POST', '/api/vk/auto', ['on' => true, 'consent' => true]);
$r = $b->req('POST', '/api/cab/forget', ['prov' => 'vk']); ok('«Відключити» Водоканал: согласие удалено', $r->status === 200 && $r->body['auto'] === false && !Db::one("SELECT id FROM cab_creds WHERE prov = 'vk'"), $r->body);
// бот: включена автоотправка воды — кнопка «Розпізнати й внести» и слова про Водоканал
$b->req('POST', '/api/vk/auto', ['on' => true, 'consent' => true]);
Telegram::$fetch = fn($id) => base64_decode('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=');
@unlink((Cfg::data() ?: sys_get_temp_dir() . '/teplo_data') . '/cache/tgreply_555');
$tp = Telegram::photo(['chat' => ['id' => 555], 'from' => ['id' => 555], 'date' => time(), 'photo' => [['file_id' => 'f1']]], 'uk');
ok('бот: «Розпізнати й внести» → сайт Водоканалу', !empty($tp['auto']) && str_contains($tp['text'], 'сайт Водоканалу') && str_ends_with($tp['reply_markup']['inline_keyboard'][0][0]['web_app']['url'] ?? '', 'auto=1'), $tp);
$h = $b->req('GET', '/api/health')->body; ok('/api/health → vksvc без рахунков', isset($h['vksvc']['jobs']) && !str_contains(json_encode($h['vksvc']), '905614'), $h['vksvc'] ?? null);
$b2 = new B(); ok('без входа — 401', $b2->req('POST', '/api/vk/queue', $ACC + ['items' => [['value' => '1']]])->status === 401);
// 181-я (власник 23.11, скрін: «не подтянулся номер холодной воды ванны»): живий сайт — блоки без таблиці, кімната в номері (Хкух / Гс/у), останні — перед підписом;
// холодної у ванній на сайті немає → решта зіставляється за кімнатою, а зайвий водомір — «which» з лічильниками сайту (кімната й останні)
$it4 = [['key' => null, 'value' => '176', 'serial' => null, 'kind' => 'hot', 'name' => 'Гаряча · Кухня'], ['key' => null, 'value' => '0', 'serial' => null, 'kind' => 'hot', 'name' => 'Гаряча · Ванна'],
  ['key' => null, 'value' => '460', 'serial' => null, 'kind' => 'cold', 'name' => 'Холодна'], ['key' => null, 'value' => '201', 'serial' => null, 'kind' => 'cold', 'name' => 'Холодна · Ванна']];
$it4x = $it4; $it4x[3]['value'] = '202';   // без номера, а прийнятий на сайті — 201: не він автоматично? — він: один холодний без пари й один прийнятий холодний
$it5 = array_merge($it4, [['key' => null, 'value' => '50', 'serial' => null, 'kind' => 'cold', 'name' => 'Холодна · Туалет']]);
try { VkCab::deliver($uid, '905618', 'Шевченко', $it5, null, 'bgsend', true); $we = null; } catch (HttpError $e) { $we = $e; }
$wm = $we ? array_column((array)($we->extra['meters'] ?? []), null, 'serial') : [];
ok('кімнати: 5 наших, на сайті 3 з полем + 1 прийнятий → which; лічильники — з кімнатою й останніми, прийнятий — у done', $we && $we->err === 'cab_which' && count($wm) === 3 && ($we->extra['done'][0]['serial'] ?? '') === '79539995' && ($wm['847046']['room'] ?? '') === 'kitchen' && ($wm['79109406']['room'] ?? '') === 'bath'
  && ($wm['796991']['room'] ?? '') === 'kitchen' && abs((float)($wm['847046']['prev'] ?? 0) - 459.123) < 1e-6 && ($wm['847046']['kind'] ?? '') === 'cold', $we ? $we->extra : null);
$dr = VkCab::deliver($uid, '905618', 'Шевченко', $it4, null, 'bgsend', true);
$rp = $VKM['_lastPost']['post']['DynamicModel'] ?? [];
ok('кімнати: без ключів — гаряча кухня → Гкух, ванна → Гс/у (0 при 0.412 — не «менше»), холодна → Хкух; холодна ванна — уже прийнята, не шлемо', $dr['result'] === 'ok' && ($rp['newIndication_5468828'] ?? '') === '176' && ($rp['newIndication_5468819'] ?? '') === '0' && ($rp['newIndication_4853176'] ?? '') === '460'
  && count($rp) >= 3 && !preg_grep('/79539995/', array_keys($rp)) && ($dr['skipped'][0]['name'] ?? '') === 'Холодна · Ванна' && (float)($dr['skipped'][0]['site'] ?? 0) === 201.0, [$dr, $rp]);
// номер іншого виду (у власника «Холодна · Кухня № 796991», а 796991 на сайті — Гкух): за номером не беремо, кімната й вид → Хкух; ванна з номером прийнятого — пропуск
$VKM['_prev'] = [];
$dr = VkCab::deliver($uid, '905618', 'Шевченко', [['key' => null, 'value' => '177', 'serial' => null, 'kind' => 'hot', 'name' => 'Гаряча · Кухня'], ['key' => null, 'value' => '1', 'serial' => '79109406', 'kind' => 'hot', 'name' => 'Гаряча · Ванна'],
  ['key' => null, 'value' => '461', 'serial' => '796991', 'kind' => 'cold', 'name' => 'Холодна · Кухня'], ['key' => null, 'value' => '201', 'serial' => '79539995', 'kind' => 'cold', 'name' => 'Холодна · Ванна']], null, 'bgsend', true);
$rp = $VKM['_lastPost']['post']['DynamicModel'] ?? [];
ok('номер гарячої на холодній — не за номером: холодна кухня → Хкух, гаряча кухня → Гкух', $dr['result'] === 'ok' && ($rp['newIndication_4853176'] ?? '') === '461' && ($rp['newIndication_5468828'] ?? '') === '177' && count($dr['skipped'] ?? []) === 1, [$dr, $rp]);
// усі наші — уже прийняті → нічого не шлемо, «прийнято»
$n0 = $vkSent();
$dr = VkCab::deliver($uid, '905618', 'Шевченко', [['key' => null, 'value' => '201', 'serial' => '79539995', 'kind' => 'cold', 'name' => 'Холодна · Ванна']], null, 'bgsend', true);
ok('лише прийнятий → ok без надсилання', $dr['result'] === 'ok' && !empty($dr['skipped']) && $vkSent() === $n0, $dr);
// за останніми показаннями: дві холодні без кімнат проти двох на сайті — хто ближче (і не менше)
$pk = VkCab::pick([0 => ['kind' => 'cold', 'room' => null, 'value' => '210'], 1 => ['kind' => 'cold', 'room' => null, 'value' => '462']],
  [['key' => 'a', 'kind' => 'cold', 'room' => null, 'prev' => 459.1], ['key' => 'b', 'kind' => 'cold', 'room' => null, 'prev' => 198.0]]);
ok('pick: дві холодні — за останніми на сайті', $pk === [0 => 'b', 1 => 'a'], $pk);
$pk = VkCab::pick([0 => ['kind' => 'cold', 'room' => null, 'value' => '460'], 1 => ['kind' => 'cold', 'room' => null, 'value' => '461']],
  [['key' => 'a', 'kind' => 'cold', 'room' => null, 'prev' => 459.1], ['key' => 'b', 'kind' => 'cold', 'room' => null, 'prev' => 458.0]]);
ok('pick: близькі — не вгадуємо', $pk === [], $pk);
ok('room: «Хкух», «Гс/у», «Ванна», «Туалет», без кімнати', VkCab::room('Холодна вода (№ Хкух 847046) дата') === 'kitchen' && VkCab::room('Гаряча вода (№ Гс/у 79109406)') === 'bath'
  && VkCab::room('Холодна · Ванна') === 'bath' && VkCab::room('Туалет') === 'wc' && VkCab::room('Холодна вода (№ 0123456)') === null);
echo "\nИтог: $pass OK, $fail FAIL\n"; exit($fail ? 1 : 0);
