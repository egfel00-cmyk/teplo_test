<?php
// 179-я: спільна квартира — сервер без веб-сервера, лише синтетика. Запуск: php tests/share.php
declare(strict_types=1);
define('TEPLO', 1);
foreach (['core', 'telegram', 'apple', 'mail', 'reminders', 'widget', 'recognize', 'admin', 'vkcab', 'cabs', 'htmsvc', 'vksvc', 'localbot', 'gpv', 'providers', 'visits', 'journal', 'docs', 'indexnow', 'relay', 'share', 'api'] as $f) require __DIR__ . "/../app/$f.php";
BotWidget::$off = true;
$TMP = sys_get_temp_dir() . '/teplo_share_' . getmypid(); putenv('SITE_DATA=' . $TMP); @mkdir($TMP, 0700, true);
Cfg::set(['app_url' => 'https://teplo.example/', 'bot_token' => '123456:TEST', 'bot_username' => 'TeploTestBot', 'webhook_secret' => 'hook-secret',
  'smtp_host' => 'smtp.example', 'smtp_from' => 'noreply@peredai.example', 'limits' => ['ip_all' => [5000, 60]]]);
Db::set(new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC])); Db::migrate();
$MAILS = []; Mail::$send = function ($c, $from, $rcpt, $data) use (&$MAILS) { $MAILS[] = ['to' => $rcpt, 'data' => $data]; return null; };
$TG = []; Telegram::$send = function ($m, $p) use (&$TG) { $TG[] = [$m, $p]; return ['ok' => true, 'result' => ['message_id' => 77]]; };

$pass = 0; $fail = 0;
function ok(string $n, bool $c, $info = null): void { global $pass, $fail; echo ($c ? '  OK  ' : ' FAIL ') . $n . (!$c && $info !== null ? '  → ' . json_encode($info, JSON_UNESCAPED_UNICODE) : '') . "\n"; $c ? $pass++ : $fail++; }
final class Browser {
  public array $jar = []; public int $ver = 0;
  public function __construct(public string $ip = '10.0.0.1') {}
  public function req(string $m, string $path, ?array $body = null): Res {
    if (empty($this->jar['ts_csrf'])) $this->take(Api::handle(new Req('GET', '/api/config', ['REMOTE_ADDR' => $this->ip], $this->jar)));
    [$pth, $qs] = array_pad(explode('?', $path, 2), 2, '');
    $server = ['REMOTE_ADDR' => $this->ip, 'HTTP_USER_AGENT' => 'test', 'QUERY_STRING' => $qs]; if ($m !== 'GET') $server['HTTP_X_CSRF'] = $this->jar['ts_csrf'] ?? '';
    $res = Api::handle(new Req($m, $pth, $server, $this->jar, $body === null ? '' : json_encode($body, JSON_UNESCAPED_UNICODE))); $this->take($res); return $res;
  }
  private function take(Res $r): void { foreach ($r->cookies as [$n, $v, $o]) { if ($o['expires'] < time()) unset($this->jar[$n]); else $this->jar[$n] = $v; } }
  /** Стан як у застосунку: забрати, змінити, віддати (з baseVersion; конфлікт — забрати й повторити). */
  public function get(): array { $r = $this->req('GET', '/api/state'); $this->ver = (int)($r->body['version'] ?? 0); return json_decode(json_encode($r->body['state']), true) ?? []; }
  public function put(array $st): Res { $r = $this->req('PUT', '/api/state', ['state' => $st, 'baseVersion' => $this->ver]); if ($r->status === 200) $this->ver = (int)$r->body['version']; return $r; }
  public function edit(callable $fn): Res { $st = $this->get(); $st = $fn($st); return $this->put($st); }
}
function ms(): int { static $t = 1763900000000; return $t += 1000; }
function place(array $st, string $id): ?array { foreach ($st['places'] ?? [] as $p) if (($p['id'] ?? '') === $id) return $p; return null; }
function recs(array $st, string $k, string $pid): array { return array_values(array_filter($st[$k] ?? [], fn($r) => ($r['place'] ?? '') === $pid && empty($r['deleted']))); }
function tokOf(string $url): string { return preg_match('/#join-([A-Za-z0-9_-]{24})/', $url, $m) ? $m[1] : (preg_match('/start=j([A-Za-z0-9_-]{24})/', $url, $m) ? $m[1] : ''); }
function joinUrl(array $mails): string { $d = end($mails)['data'] ?? ''; $d = quoted_printable_decode($d); foreach (preg_split('/\r?\n/', $d) as $l) { $x = base64_decode(trim($l), true); if ($x !== false && preg_match('/#join-[A-Za-z0-9_-]{24}/', $x, $m)) return $m[0]; } return preg_match('/#join-[A-Za-z0-9_-]{24}/', $d, $m) ? $m[0] : ''; }

echo "Власник і його квартира:\n";
$A = new Browser('10.0.0.1');
ok('А реєструється', $A->req('POST', '/api/auth/register', ['email' => 'olga@example.ua', 'password' => 'password-123'])->status === 200);
$t0 = ms();
$stA = ['v' => 1, 'onboarded' => true, 'readings' => [], 'mrecs' => [['id' => 'e1', 'place' => 'main', 'meter' => 'm1', 'kind' => 'elec', 'date' => '2026-11-01', 'z' => ['t' => 1200], 'createdAt' => '2026-11-01T10:00:00Z', 'updatedAt' => $t0]],
  'water' => [['id' => 'w1', 'place' => 'main', 'date' => '2026-11-01', 'vals' => ['c1' => '430'], 'createdAt' => '2026-11-01T10:00:00Z', 'updatedAt' => $t0], ['id' => 'w9', 'place' => 'p2', 'date' => '2026-11-01', 'vals' => ['c9' => '5'], 'createdAt' => '2026-11-01T10:00:00Z', 'updatedAt' => $t0]],
  'places' => [['id' => 'main', 'name' => 'Мамина', 'color' => 'teal', 'v' => 2, 'city' => ['n' => 'Харків'], 'street' => 'вул. Сумська, 10', 'water' => ['meters' => [['id' => 'c1', 'kind' => 'cold']]], 'meters' => [['id' => 'm1', 'kind' => 'elec']], 'prov' => (object)[], 'updatedAt' => $t0, '_kt' => (object)[]],
    ['id' => 'p2', 'name' => 'Гараж', 'v' => 2, 'water' => ['meters' => [['id' => 'c9', 'kind' => 'cold']]], 'updatedAt' => $t0]], 'updatedAt' => $t0];
$A->get(); ok('А зберігає стан', $A->put($stA)->status === 200);

echo "Запрошення посиланням:\n";
$r = $A->req('POST', '/api/share/invite', ['pid' => 'main']);
ok('посилання є: сайт і бот', $r->status === 200 && str_contains((string)$r->body['url'], '#join-') && str_contains((string)$r->body['tg'], 't.me/TeploTestBot?start=j'), $r->body);
$tok = tokOf((string)$r->body['url']); $sid = (int)$r->body['sid'];
$r2 = $A->req('POST', '/api/share/invite', ['pid' => 'main']);
ok('вдруге — те саме посилання (не множимо)', tokOf((string)$r2->body['url']) === $tok && count($r2->body['shares'][0]['invites']) === 1, $r2->body);
ok('у списку власника — посилання можна скопіювати знову', tokOf((string)($r2->body['shares'][0]['invites'][0]['url'] ?? '')) === $tok);
ok('чужа квартира (нема в стані) — відмова', $A->req('POST', '/api/share/invite', ['pid' => 'nope'])->status === 409);
$stA2 = $A->get(); ok('квартира власника позначена спільною (sh, роль owner)', (place($stA2, 'main')['sh']['role'] ?? '') === 'owner' && (place($stA2, 'main')['sh']['n'] ?? 0) === 1, place($stA2, 'main')['sh'] ?? null);

$G = new Browser('10.0.0.9');
$pv = $G->req('GET', '/api/share/join?t=' . $tok)->body;
ok('без входу: що за запрошення — хто, квартира, адреса, лічильники', ($pv['state'] ?? '') === 'ok' && $pv['owner'] === 'olga' && $pv['place'] === 'Мамина' && $pv['addr'] === 'Харків, вул. Сумська, 10' && $pv['kinds'] === ['elec', 'cold'], $pv);
ok('поганий токен — bad', ($G->req('GET', '/api/share/join?t=AAAAAAAAAAAAAAAAAAAAAAAA')->body['state'] ?? '') === 'bad');
ok('без входу приєднатися — потрібен вхід', $G->req('POST', '/api/share/join', ['t' => $tok])->body['error'] === 'login_needed');
$MAILS = [];
$r = $G->req('POST', '/api/share/join', ['t' => $tok, 'email' => 'Ivan@Example.ua']);
ok('без входу з e-mail — лист для підтвердження', $r->status === 200 && ($r->body['sent'] ?? '') === 'iv•••@example.ua' && count($MAILS) === 1 && $MAILS[0]['to'] === ['ivan@example.ua'], $r->body);
$u2 = joinUrl($MAILS); ok('у листі — посилання #join-…', $u2 !== '' && tokOf($u2) !== $tok, $u2);
$r = $G->req('POST', '/api/share/join', ['t' => tokOf($u2), 'state' => ['v' => 1, 'readings' => [], 'places' => [['id' => 'main', 'name' => '', 'v' => 2]], 'water' => [], 'mrecs' => []]]);
ok('посилання з листа — вхід без пароля й квартира', $r->status === 200 && ($r->body['pid'] ?? '') === 'sh' . $sid && !empty($r->body['user']['id']) && !empty($G->jar['ts_sid']), $r->body);
$stG = $G->get(); $pG = place($stG, 'sh' . $sid);
ok('у нового — спільна квартира з лічильниками, адресою й тією ж назвою, що в власника (180-я)', $pG && ($pG['water']['meters'][0]['id'] ?? '') === 'c1' && ($pG['street'] ?? '') === 'вул. Сумська, 10' && ($pG['name'] ?? '') === 'Мамина' && empty($pG['color']), $pG);
ok('порожню «Моя квартира» з пристрою прибрано', !empty(place($stG, 'main')['deleted']), place($stG, 'main'));
ok('записи — з її id квартири; гаража немає', count(recs($stG, 'water', 'sh' . $sid)) === 1 && count(recs($stG, 'mrecs', 'sh' . $sid)) === 1 && !array_filter($stG['water'], fn($x) => $x['id'] === 'w9'));
ok('позначка: учасник, власник Ольга, двоє', ($pG['sh']['role'] ?? '') === 'member' && ($pG['sh']['own'] ?? '') === 'olga' && ($pG['sh']['n'] ?? 0) === 2 && isset($pG['sh']['ppl'][(string)$r->body['user']['id']]), $pG['sh'] ?? null);
ok('посилання з листа вдруге — «ви вже тут»', ($G->req('GET', '/api/share/join?t=' . tokOf($u2))->body['state'] ?? '') === 'member');
$X = new Browser('10.0.0.5'); $X->req('POST', '/api/auth/register', ['email' => 'x@example.ua', 'password' => 'password-123']);
ok('перше посилання вже не діє: лист замінив його', in_array($X->req('POST', '/api/share/join', ['t' => tokOf($u2)])->body['error'] ?? '', ['invite_used'], true));

echo "Учасник вносить — власник бачить:\n";
$t1 = ms();
$r = $G->edit(function ($st) use ($sid, $t1) { $st['water'][] = ['id' => 'w2', 'place' => 'sh' . $sid, 'date' => '2026-11-20', 'vals' => ['c1' => '436'], 'by' => 2, 'createdAt' => '2026-11-20T09:00:00Z', 'updatedAt' => $t1]; $st['updatedAt'] = $t1; return $st; });
ok('учасник зберіг', $r->status === 200);
$stA3 = $A->get(); $w = recs($stA3, 'water', 'main');
ok('власник бачить нові показання у своїй квартирі (place main)', count($w) === 2 && $w[1]['vals']['c1'] === '436' && ($w[1]['by'] ?? 0) === 2, $w);
ok('гараж власника не зачеплено', count(recs($stA3, 'water', 'p2')) === 1);
$t2 = ms();
$r = $A->edit(function ($st) use ($t2) { foreach ($st['places'] as &$p) if ($p['id'] === 'main') { $p['prov'] = ['water' => ['own' => 1, 'name' => 'ОСББ «Сумська»', 'ts' => $t2]]; $p['_kt']['prov'] = $t2; $p['name'] = 'Мамина квартира'; $p['_kt']['name'] = $t2; $p['updatedAt'] = $t2; } $st['updatedAt'] = $t2; return $st; });
$stG2 = $G->get(); $pG2 = place($stG2, 'sh' . $sid);
ok('власник змінив постачальника — у учасника той самий', ($pG2['prov']['water']['name'] ?? '') === 'ОСББ «Сумська»', $pG2['prov'] ?? null);
ok('назва — спільна: власник перейменував — у учасника та сама (180-я)', ($pG2['name'] ?? '') === 'Мамина квартира', $pG2['name'] ?? null);
$t2b = ms();
$G->edit(function ($st) use ($sid, $t2b) { foreach ($st['places'] as &$p) if ($p['id'] === 'sh' . $sid) { $p['name'] = 'Квартира на Сумській'; $p['_kt']['name'] = $t2b; $p['updatedAt'] = $t2b; } $st['updatedAt'] = $t2b; return $st; });
ok('учасник перейменував — у власника та сама назва', (place($A->get(), 'main')['name'] ?? '') === 'Квартира на Сумській');
$t2c = ms();
$A->edit(function ($st) use ($t2c) { foreach ($st['places'] as &$p) if ($p['id'] === 'main') { $p['name'] = 'Мамина квартира'; $p['_kt']['name'] = $t2c; $p['updatedAt'] = $t2c; } $st['updatedAt'] = $t2c; return $st; });
echo "«У фоні» учасника через кабінети власника (180-я):\n";
$uA = (int)Db::one("SELECT id FROM users WHERE email = 'olga@example.ua'")['id']; $uG = (int)Db::one("SELECT user_id FROM share_members WHERE share_id = ? AND role = 'member'", [$sid])['user_id'];
// у власника — кабінет ХТМ із двома рахунками (цієї квартири й іншої); рахунок квартири — в теплолічильнику
Db::q("INSERT INTO cab_creds (user_id, prov, login, secret, extra, state, info, created_at, checked_at) VALUES (?, 'htm', 'olga@cab', ?, '{}', 'ok', ?, ?, ?)", [$uA, CabVault::enc('pw'), json_encode(['accounts' => [['acc' => '1000000061', 'sur' => 'О'], ['acc' => '2000000099', 'sur' => 'О']], 'hot' => ['1000000061' => ['found' => true, 'open' => true, 'n' => 1]]]), Http::iso(), Http::iso()]);
$A->edit(function ($st) { foreach ($st['places'] as &$p) if ($p['id'] === 'main') { $p['meter'] = ['account' => '1000000061', 'model' => 'sharky774']; $p['_kt']['meter'] = ms(); $p['updatedAt'] = ms(); } $st['updatedAt'] = ms(); return $st; });
ok('власник ще не дозволив — учасник надсилає своїм (кабінету немає)', HtmSvc::credFor($uG, 'sh' . $sid, '1000000061')['u'] === $uG);
ok('у GET /api/cab/htm учасника — без кабінету власника', !isset($G->req('GET', '/api/cab/htm')->body['shared']));
$r = $G->req('POST', '/api/share/bg', ['sid' => $sid, 'on' => true]); ok('галочку вмикає лише власник', $r->status === 403, $r->status);
$r = $A->req('POST', '/api/share/bg', ['sid' => $sid, 'on' => true]);
ok('власник увімкнув «у фоні через мої кабінети»; бачить, через що (ХТМ)', $r->status === 200 && ($r->body['shares'][0]['bg'] ?? false) === true && in_array('htm', $r->body['shares'][0]['bgVia'] ?? [], true), $r->body['shares'][0] ?? null);
ok('у квартирі учасника — позначка sh.bg', (place($G->get(), 'sh' . $sid)['sh']['bg'] ?? 0) === 1);
$hs = $G->req('GET', '/api/cab/htm')->body;
ok('учасник: кабінет власника для цієї квартири — лише її рахунок (іншого не видно), розділ гарячої', isset($hs['shared']['sh' . $sid]) && array_column($hs['shared']['sh' . $sid]['accounts'], 'acc') === ['1000000061'] && !empty($hs['shared']['sh' . $sid]['hot']->{'1000000061'} ?? $hs['shared']['sh' . $sid]['hot']['1000000061'] ?? null) && $hs['shared']['sh' . $sid]['by'] === 'olga', $hs['shared'] ?? null);
ok('надсилання на рахунок квартири — кабінетом власника', HtmSvc::credFor($uG, 'sh' . $sid, '1000000061')['u'] === $uA);
ok('на інший рахунок власника (не цієї квартири) — ні', HtmSvc::credFor($uG, 'sh' . $sid, '2000000099')['u'] === $uG);
$r = $G->req('POST', '/api/cab/htm/hot', ['acc' => '1000000061', 'rid' => 'w2', 'place' => 'sh' . $sid, 'date' => '2026-11-20', 'items' => [['sn' => '1', 'value' => '180']]]);
$jp = json_decode((string)Db::one('SELECT payload FROM cab_jobs WHERE id = ?', [(int)($r->body['job']['id'] ?? 0)])['payload'], true);
ok('гаряча учасника — у його черзі, кабінетом власника (cu)', $r->status === 200 && ($jp['cu'] ?? 0) === $uA && (int)Db::one('SELECT user_id FROM cab_jobs WHERE id = ?', [(int)$r->body['job']['id']])['user_id'] === $uG, [$r->status, $r->body, $jp]);
$A->req('POST', '/api/share/bg', ['sid' => $sid, 'on' => false]);
ok('власник вимкнув — знову своїм', HtmSvc::credFor($uG, 'sh' . $sid, '1000000061')['u'] === $uG && !isset($G->req('GET', '/api/cab/htm')->body['shared']));
Db::q("UPDATE cab_jobs SET next_at = 0 WHERE id = ?", [(int)$r->body['job']['id']]); HtmSvc::cron();
$jr = Db::one('SELECT status, result FROM cab_jobs WHERE id = ?', [(int)$r->body['job']['id']]);
ok('черга, поставлена до вимкнення, не йде кабінетом власника: «більше не дозволяє»', $jr['status'] === 'failed' && (json_decode((string)$jr['result'], true)['why'] ?? '') === 'share_off', $jr);
// місцевий КП: підключення власника для його квартири → учасник бачить «підключено» (з іменем власника, без даних входу)
$A->req('POST', '/api/share/bg', ['sid' => $sid, 'on' => true]);
$lbId = array_key_first(LocalBot::BOTS);
Db::q("INSERT INTO cab_creds (user_id, prov, login, secret, extra, state, info, created_at, checked_at) VALUES (?, ?, '', ?, ?, 'ok', NULL, ?, ?)", [$uA, 'L' . $lbId, CabVault::enc(json_encode(['main' => ['name' => 'Ольга', 'phone' => '0501112233']])), json_encode(['main' => ['acc' => '555', 'consentAt' => gmdate('c')]]), Http::iso(), Http::iso()]);
$ls = LocalBot::status($uG, ['bot' => $lbId, 'place' => 'sh' . $sid]);
ok('місцевий КП: учасник — «підключено через olga», без імені й телефону власника', ($ls['conn']['by'] ?? '') === 'olga' && ($ls['conn']['acc'] ?? '') === '555' && !isset($ls['conn']['name']) && !isset($ls['conn']['phone']), $ls['conn'] ?? null);
$A->req('POST', '/api/share/bg', ['sid' => $sid, 'on' => false]);
ok('вимкнув — у місцевого КП учасник не підключений', LocalBot::status($uG, ['bot' => $lbId, 'place' => 'sh' . $sid])['conn'] === null);
Db::q("DELETE FROM cab_creds WHERE user_id = ?", [$uA]); Db::q("DELETE FROM cab_jobs");
// 183-я (власник 23.11: «у каждой квартиры свой вход для всех поставщиков»): вхід ХТМ квартири — спільний для всіх, хто її веде, без галочки й без імен
echo "Вхід ХТМ квартири — спільний (183-я):\n";
Db::q("INSERT INTO cab_creds (user_id, prov, login, secret, extra, state, info, created_at, checked_at) VALUES (?, 'hp1', 'apt@cab', ?, ?, 'ok', ?, ?, ?)", [$uA, CabVault::enc('pw'), json_encode(['place' => 'main']), json_encode(['accounts' => [['acc' => '1000000061', 'sur' => 'О']]]), Http::iso(), Http::iso()]);
ok('учасник надсилає входом квартири, який вписав власник (без галочки «у фоні»)', HtmSvc::credFor($uG, 'sh' . $sid, '1000000061') === ['u' => $uA, 'p' => 'hp1'] && HtmSvc::credFor($uG, 'sh' . $sid, '') === ['u' => $uA, 'p' => 'hp1']);
$hs = $G->req('GET', '/api/cab/htm')->body;
ok('GET /api/cab/htm учасника: вхід цієї квартири (mate), рахунок — її', ($hs['places']['sh' . $sid]['login'] ?? '') === 'apt@cab' && !empty($hs['places']['sh' . $sid]['mate']) && array_column($hs['places']['sh' . $sid]['accounts'], 'acc') === ['1000000061'], $hs['places'] ?? null);
$r = $G->req('POST', '/api/cab/forget', ['prov' => 'htm', 'place' => 'sh' . $sid]);
ok('«Відв’язати» в учасника — у квартири більше немає входу (і у власника)', $r->status === 200 && !isset($r->body['places']) && !Db::one("SELECT id FROM cab_creds WHERE user_id = ? AND prov = 'hp1'", [$uA]) && HtmSvc::credFor($uG, 'sh' . $sid, '1000000061')['u'] === $uG, $r->body['places'] ?? null);
ok('чужа квартира (не спільна) — входу іншої людини не бере', HtmSvc::aptCab($uG, 'main') === null);
Db::q("DELETE FROM cab_creds WHERE user_id IN (?, ?)", [$uA, $uG]); Db::q("DELETE FROM cab_jobs");

// одночасно: учасник змінює вивіз сміття, власник — тариф; у кожного стара копія чужого поля
$t3 = ms(); $t4 = ms();
$A->get(); $G->get();
$sA = $A->get(); foreach ($sA['places'] as &$p) if ($p['id'] === 'main') { $p['gasPrice'] = 7.95; $p['_kt']['gasPrice'] = $t4; $p['updatedAt'] = $t4; } unset($p);
$sG = $G->get(); foreach ($sG['places'] as &$p) if ($p['id'] === 'sh' . $sid) { $p['waste'] = ['on' => true, 'persons' => 2]; $p['_kt']['waste'] = $t3; $p['updatedAt'] = $t3; $p['gasPrice'] = 1; } unset($p);
$A->put($sA); $G->get(); $G->put($sG);   // G записує стару копію (не бачив правки А) — сервер зводить по полях
$fa = place($A->get(), 'main'); $fg = place($G->get(), 'sh' . $sid);
ok('одночасні правки різних полів — обидві лишились (по полях, а не «хто новіший — той цілий»)', ($fa['waste']['persons'] ?? 0) === 2 && ($fa['gasPrice'] ?? 0) == 7.95 && ($fg['gasPrice'] ?? 0) == 7.95 && ($fg['waste']['on'] ?? false) === true, [$fa['gasPrice'] ?? null, $fg['gasPrice'] ?? null, $fa['waste'] ?? null]);
ok('стара копія чужого поля без своєї мітки не затирає новішу (gasPrice 1 → лишилось 7,95)', ($fg['gasPrice'] ?? 0) == 7.95);
$fa2 = $A->get(); $v0 = $A->ver; $fa2['updatedAt'] = ms();
$r = $A->put($fa2); ok('повторне збереження без змін — нікого не переписуємо (немає «пінг-понгу»)', $r->status === 200 && empty($r->body['pull']), $r->body);

echo "Telegram: запрошення кнопкою в боті:\n";
$r = $A->req('POST', '/api/share/invite', ['pid' => 'main', 'fresh' => 1]); $tok3 = tokOf((string)$r->body['tg']);
ok('нове посилання (fresh) — інший токен', $tok3 !== '' && $tok3 !== $tok);
$TG = [];
Telegram::handleUpdate(['message' => ['chat' => ['id' => 5551, 'type' => 'private'], 'from' => ['id' => 5551, 'first_name' => 'Петро', 'language_code' => 'uk'], 'text' => '/start j' . $tok3]]);
$card = $TG[0][1] ?? [];
ok('бот показує картку: хто, квартира, адреса, «Приєднатися»', ($TG[0][0] ?? '') === 'sendMessage' && str_contains((string)($card['text'] ?? ''), 'olga') && str_contains((string)$card['text'], '«Мамина квартира»') && str_contains((string)$card['text'], 'Сумська') && ($card['reply_markup']['inline_keyboard'][0][0]['callback_data'] ?? '') === 'sj:' . $tok3, $card);
$TG = [];
Telegram::handleUpdate(['callback_query' => ['id' => 'cq1', 'data' => 'sj:' . $tok3, 'from' => ['id' => 5551, 'first_name' => 'Петро', 'language_code' => 'uk'], 'message' => ['message_id' => 77, 'chat' => ['id' => 5551]]]]);
$ed = array_values(array_filter($TG, fn($x) => $x[0] === 'editMessageText'))[0][1] ?? [];
ok('«Приєднатися» → готово, кнопка відкриває квартиру', str_contains((string)($ed['text'] ?? ''), 'Готово') && str_contains((string)($ed['reply_markup']['inline_keyboard'][0][0]['web_app']['url'] ?? ''), '?go=home&place=sh' . $sid), $ed);
$pid3 = Db::one("SELECT i.user_id FROM user_identities i WHERE i.external_id = '5551'"); $u3 = (int)$pid3['user_id'];
$st3 = json_decode((string)Db::one('SELECT data FROM user_state WHERE user_id = ?', [$u3])['data'], true);
ok('у Петра — акаунт Telegram і квартира з показаннями', ($st3['onboarded'] ?? false) === true && count(recs($st3, 'water', 'sh' . $sid)) === 2 && (place($st3, 'sh' . $sid)['sh']['n'] ?? 0) === 3, place($st3, 'sh' . $sid)['sh'] ?? null);
$TG = [];
Telegram::handleUpdate(['message' => ['chat' => ['id' => 5552, 'type' => 'private'], 'from' => ['id' => 5552, 'first_name' => 'Чужий'], 'text' => '/start j' . $tok3]]);
ok('те саме посилання вдруге (інша людина) — «вже приєдналися»', str_contains((string)($TG[0][1]['text'] ?? ''), 'уже приєдналися'), $TG);
ok('Telegram::UPDATES — з callback_query, HOOK_V 3', in_array('callback_query', Telegram::UPDATES, true) && Telegram::HOOK_V === 3);

echo "Меню бота «Спільний доступ» (/dostup):\n";
$TG = [];
Telegram::handleUpdate(['message' => ['chat' => ['id' => 5551, 'type' => 'private'], 'from' => ['id' => 5551, 'first_name' => 'Петро', 'language_code' => 'uk'], 'text' => '/dostup']]);
$mn = $TG[0][1] ?? []; $kb = json_encode($mn['reply_markup'] ?? [], JSON_UNESCAPED_UNICODE);
ok('учасник бачить «веде olga, ви учасник» і «Вийти»', str_contains((string)($mn['text'] ?? ''), 'веде olga') && str_contains($kb, '"sl:' . $sid . '"'), $mn);
$uA0 = (int)Db::one("SELECT id FROM users WHERE email = 'olga@example.ua'")['id'];
Db::q("INSERT INTO user_identities (user_id, type, external_id, username, linked_at) VALUES (?, 'telegram', '6661', 'olga_tg', ?)", [$uA0, Http::iso()]);
$TG = [];
Telegram::handleUpdate(['message' => ['chat' => ['id' => 6661, 'type' => 'private'], 'from' => ['id' => 6661, 'first_name' => 'Ольга', 'language_code' => 'uk'], 'text' => '/dostup']]);
$mn = $TG[0][1] ?? []; $kb = json_encode($mn['reply_markup'] ?? [], JSON_UNESCAPED_UNICODE);
ok('власник: квартири з людьми, «Запросити в …» для кожної, «Прибрати Петро»', str_contains((string)$mn['text'], '«Мамина квартира» — ви, ivan, Петро') && str_contains((string)$mn['text'], '«Гараж» — лише ви') && str_contains($kb, '"sp:main"') && str_contains($kb, '"sp:p2"') && str_contains($kb, 'Прибрати Петро'), $mn);
$TG = [];
Telegram::handleUpdate(['callback_query' => ['id' => 'c2', 'data' => 'sp:p2', 'from' => ['id' => 6661, 'language_code' => 'uk'], 'message' => ['message_id' => 90, 'chat' => ['id' => 6661]]]]);
$inv = array_values(array_filter($TG, fn($x) => $x[0] === 'sendMessage'));
ok('«Запросити в «Гараж»» → повідомлення для пересилання з t.me-посиланням і сайтом', count($inv) === 2 && str_contains((string)$inv[1][1]['text'], 'квартиру «Гараж»') && preg_match('/t\.me\/TeploTestBot\?start=j[A-Za-z0-9_-]{24}/', (string)$inv[1][1]['text']) && str_contains((string)$inv[1][1]['text'], '#join-'), $inv);
ok('гараж став спільним (поки лише власник)', (bool)Db::one("SELECT 1 AS x FROM share_members WHERE user_id = ? AND pid = 'p2' AND role = 'owner'", [$uA0]));
$TG = [];
Telegram::handleUpdate(['callback_query' => ['id' => 'c3', 'data' => 'sr:' . $sid . ':' . $u3, 'from' => ['id' => 6661, 'language_code' => 'uk'], 'message' => ['message_id' => 90, 'chat' => ['id' => 6661]]]]);
$q = array_values(array_filter($TG, fn($x) => $x[0] === 'editMessageText'))[0][1] ?? [];
ok('«Прибрати Петро» → питання з «Так, прибрати» / «Скасувати»', str_contains((string)($q['text'] ?? ''), 'Прибрати Петро з квартири?') && ($q['reply_markup']['inline_keyboard'][0][0]['callback_data'] ?? '') === 'sR:' . $sid . ':' . $u3, $q);
Db::q("DELETE FROM user_identities WHERE external_id = '6661'"); Db::q("DELETE FROM share_members WHERE pid = 'p2'"); Db::q("DELETE FROM shares WHERE id NOT IN (SELECT share_id FROM share_members)");

echo "Хто має доступ, прибрати, вийти:\n";
$mine = $A->req('GET', '/api/share')->body['shares'][0] ?? [];
ok('власник бачить трьох: себе, Івана (пошта), Петра (Telegram)', count($mine['people'] ?? []) === 3 && $mine['people'][0]['me'] === true && $mine['people'][1]['via'] === 'mail' && $mine['people'][2]['via'] === 'tg' && $mine['people'][2]['name'] === 'Петро', $mine['people'] ?? null);
ok('учасник не може запрошувати', $G->req('POST', '/api/share/invite', ['pid' => 'sh' . $sid])->body['error'] === 'not_owner');
ok('учасник не може прибирати', $G->req('POST', '/api/share/remove', ['sid' => $sid, 'user' => $u3])->body['error'] === 'not_owner');
$TG = [];
$r = $A->req('POST', '/api/share/remove', ['sid' => $sid, 'user' => $u3]);
ok('власник прибрав Петра', $r->status === 200 && count($r->body['shares'][0]['people']) === 2);
$st3 = json_decode((string)Db::one('SELECT data FROM user_state WHERE user_id = ?', [$u3])['data'], true);
ok('у Петра квартира зникла (надгробок), позначки немає', !empty(place($st3, 'sh' . $sid)['deleted']) && !isset(place($st3, 'sh' . $sid)['sh']));
ok('Петру — повідомлення в Telegram', str_contains((string)($TG[0][1]['text'] ?? ''), 'прибрав'), $TG);
ok('Петро більше не синхронізується: нові показання власника до нього не йдуть', (function () use ($A, $u3, $sid) { $A->edit(function ($st) { $st['water'][] = ['id' => 'w3', 'place' => 'main', 'date' => '2026-11-21', 'vals' => ['c1' => '437'], 'createdAt' => '2026-11-21T09:00:00Z', 'updatedAt' => ms()]; $st['updatedAt'] = ms(); return $st; });
  $s = json_decode((string)Db::one('SELECT data FROM user_state WHERE user_id = ?', [$u3])['data'], true); return !array_filter($s['water'], fn($x) => $x['id'] === 'w3'); })());

echo "Фото й платіжки записів:\n";
$uA = (int)$A->req('GET', '/api/me')->body['user']['id']; $uG = (int)$G->req('GET', '/api/me')->body['user']['id'];
Db::q('INSERT INTO photos (id, user_id, file, mime, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)', ['aaaaaaaaaaaaaaaaaaaaaaaa', $uA, 'f1.jpg', 'image/jpeg', 3, Http::iso()]);
@mkdir(Recognize::root() . '/' . $uA, 0700, true); file_put_contents(Recognize::root() . '/' . $uA . '/f1.jpg', 'jpg');
ok('учасник бачить фото власника до запису', $G->req('GET', '/api/photo?id=aaaaaaaaaaaaaaaaaaaaaaaa')->file !== null);
ok('чужий (не в квартирі) — ні', $X->req('GET', '/api/photo?id=aaaaaaaaaaaaaaaaaaaaaaaa')->status === 404);

echo "Робот змінив стан власника (не PUT) — cron зводить:\n";
$row = Db::one('SELECT data FROM user_state WHERE user_id = ?', [$uA]); $s = json_decode((string)$row['data']);
foreach ($s->water as $wr) if ($wr->id === 'w2') { $wr->sent = (object)['vk' => '2026-11-22']; $wr->updatedAt = ms(); }
Db::q('UPDATE user_state SET data = ?, version = version + 1 WHERE user_id = ?', [json_encode($s, JSON_UNESCAPED_UNICODE), $uA]);
$c = Share::cron();
$w2 = array_values(array_filter($G->get()['water'], fn($x) => $x['id'] === 'w2'))[0] ?? [];
ok('позначка «передано Водоканалу» дійшла до учасника', ($w2['sent']['vk'] ?? '') === '2026-11-22' && count($c) === 1, [$w2, $c]);
ok('повторний cron — нічого (усе зведено)', Share::cron() === []);
$h = $A->req('GET', '/api/health')->body['share'] ?? [];
ok('/api/health → share: квартир, людей, запрошень (лише числа)', ($h['shares'] ?? 0) === 1 && ($h['people'] ?? 0) === 1 && ($h['stale'] ?? 1) === 0, $h);

echo "Учасник видаляє квартиру в себе — це «вийти»:\n";
$G->edit(function ($st) use ($sid) { foreach ($st['places'] as &$p) if ($p['id'] === 'sh' . $sid) { $p['deleted'] = true; $p['updatedAt'] = ms(); } $st['updatedAt'] = ms(); return $st; });
$mine = $A->req('GET', '/api/share')->body['shares'][0] ?? [];
ok('Іван вийшов: у власника лишився сам, квартира й показання на місці', count($mine['people'] ?? []) === 1 && count(recs($A->get(), 'water', 'main')) === 3, $mine);
ok('квартира власника: n = 1', (place($A->get(), 'main')['sh']['n'] ?? 0) === 1);

echo "Лист на пошту людині з акаунтом:\n";
$MAILS = [];
$r = $A->req('POST', '/api/share/invite', ['pid' => 'main', 'email' => 'ivan@example.ua', 'lang' => 'uk']);
ok('лист-запрошення пішов', $r->status === 200 && count($MAILS) === 1 && ($r->body['email'] ?? '') === 'ivan@example.ua', $r->body);
$B2 = new Browser('10.0.0.7');
$r = $B2->req('POST', '/api/share/join', ['t' => tokOf(joinUrl($MAILS))]);
ok('посилання з листа на інший браузер — вхід у той самий акаунт Івана', $r->status === 200 && (int)($r->body['user']['id'] ?? 0) === $uG, $r->body);
$stG3 = $B2->get(); $live = array_values(array_filter($stG3['places'], fn($p) => empty($p['deleted'])));
ok('повернувся: нова копія квартири (sh…_2), стара лишилась видаленою', count($live) === 1 && $live[0]['id'] === 'sh' . $sid . '_2' && count(recs($stG3, 'water', 'sh' . $sid . '_2')) === 3, array_map(fn($p) => [$p['id'], $p['deleted'] ?? null], $stG3['places']));
ok('запрошення не можна скасувати чужому', $G->req('POST', '/api/share/revoke', ['id' => (int)$r->body['sid']])->status === 404);

echo "Власник видаляє квартиру — у всіх зникає:\n";
$TG = [];
$A->edit(function ($st) { foreach ($st['places'] as &$p) if ($p['id'] === 'main') { $p['deleted'] = true; $p['updatedAt'] = ms(); } $st['updatedAt'] = ms(); return $st; });
$stG4 = $B2->get();
ok('у Івана квартири немає', !array_filter($stG4['places'], fn($p) => empty($p['deleted'])));
ok('спільну розпущено, запрошень немає', !Db::one('SELECT 1 AS x FROM shares') && !Db::one('SELECT 1 AS x FROM share_members') && $A->req('GET', '/api/share')->body['shares'] === []);
ok('фото власника більше не видно', $G->req('GET', '/api/photo?id=aaaaaaaaaaaaaaaaaaaaaaaa')->status === 404);

echo "Видалення акаунта власника:\n";
$C = new Browser('10.0.0.11'); $C->req('POST', '/api/auth/register', ['email' => 'c@example.ua', 'password' => 'password-123']);
$C->get(); $C->put(['v' => 1, 'readings' => [], 'water' => [], 'mrecs' => [], 'places' => [['id' => 'main', 'v' => 2, 'name' => 'Моя', 'meters' => [['id' => 'g1', 'kind' => 'gas']], 'updatedAt' => ms()]], 'updatedAt' => ms()]);
$tc = tokOf((string)$C->req('POST', '/api/share/invite', ['pid' => 'main'])->body['url']);
$r = $X->req('POST', '/api/share/join', ['t' => $tc]); ok('Х приєднався (вже мав акаунт)', $r->status === 200 && ($r->body['pid'] ?? '') !== '', $r->body);
ok('Х — та сама квартира з газом', (place($X->get(), (string)$r->body['pid'])['meters'][0]['kind'] ?? '') === 'gas');
$C->req('POST', '/api/account/delete', ['confirm' => 'delete']);
ok('акаунт власника видалено — у Х квартиру прибрано', !empty(place($X->get(), (string)$r->body['pid'])['deleted']) && !Db::one('SELECT 1 AS x FROM share_members'));

echo "Захист:\n";
ok('без входу — список недоступний', (new Browser('10.0.0.30'))->req('GET', '/api/share')->status === 401);
ok('запрошення в чужу квартиру — ні (квартири немає в стані людини)', $X->req('POST', '/api/share/invite', ['pid' => 'sh999'])->status === 409);
ok('токен у базі — лише хеш', !Db::one('SELECT 1 AS x FROM share_invites WHERE token_hash = ?', [$tok]) && (bool)Db::one('SELECT 1 AS x FROM share_invites WHERE token_hash = ?', [hash('sha256', $tok)]));
$D = new Browser('10.0.0.12'); $D->req('POST', '/api/auth/register', ['email' => 'd@example.ua', 'password' => 'password-123']);
$D->get(); $D->put(['v' => 1, 'readings' => [], 'water' => [], 'mrecs' => [], 'places' => [['id' => 'main', 'v' => 2, 'updatedAt' => ms()]], 'updatedAt' => ms()]);
$td = tokOf((string)$D->req('POST', '/api/share/invite', ['pid' => 'main'])->body['url']);
Db::q('UPDATE share_invites SET expires_at = ? WHERE token_hash = ?', [time() - 5, hash('sha256', $td)]);
$E = new Browser('10.0.0.13'); $E->req('POST', '/api/auth/register', ['email' => 'e@example.ua', 'password' => 'password-123']);
$td0 = tokOf((string)$D->req('POST', '/api/share/invite', ['pid' => 'main'])->body['url']);
$re = $E->req('POST', '/api/share/join', ['t' => $td0]);
ok('власник назви не давав — у всіх «Моя квартира», як бачить він (180-я)', (place($E->get(), (string)($re->body['pid'] ?? ''))['name'] ?? '') === 'Моя квартира' && (place($D->get(), 'main')['name'] ?? '') === 'Моя квартира', [place($E->get(), (string)($re->body['pid'] ?? ''))['name'] ?? null, place($D->get(), 'main')['name'] ?? null]);
// стара спільна (зведена до зміни правил): назва в учасника порожня — cron зводить ще раз
$pe = (string)($re->body['pid'] ?? ''); $sidE = (int)substr($pe, 2);
$E->edit(function ($st) use ($pe) { foreach ($st['places'] as &$p) if ($p['id'] === $pe) { $p['name'] = ''; unset($p['_kt']['name']); } return $st; });
$D->edit(function ($st) { foreach ($st['places'] as &$p) if ($p['id'] === 'main') { $p['name'] = ''; unset($p['_kt']['name']); } return $st; });
Db::q('UPDATE shares SET rv = 1 WHERE id = ?', [$sidE]); Db::q('UPDATE share_members SET ver = (SELECT version FROM user_state WHERE user_state.user_id = share_members.user_id) WHERE share_id = ?', [$sidE]);
Share::cron();
ok('cron: старі спільні зведено ще раз — назва однакова', (place($E->get(), $pe)['name'] ?? '') === 'Моя квартира' && (place($D->get(), 'main')['name'] ?? '') === 'Моя квартира', place($E->get(), $pe)['name'] ?? null);
Db::q('UPDATE share_invites SET expires_at = ? WHERE token_hash = ?', [time() - 5, hash('sha256', $td)]);
ok('застаріле посилання — expired, приєднатися не можна', ($X->req('GET', '/api/share/join?t=' . $td)->body['state'] ?? '') === 'expired' && ($X->req('POST', '/api/share/join', ['t' => $td])->body['error'] ?? '') === 'invite_expired');
$X->req('POST', '/api/share/revoke', ['id' => 1]);
$r = $D->req('GET', '/api/share')->body['shares'][0]['invites'] ?? null; $D->req('POST', '/api/share/invite', ['pid' => 'main', 'fresh' => 1]);
$iv = $D->req('GET', '/api/share')->body['shares'][0]['invites'][0] ?? [];
$D->req('POST', '/api/share/revoke', ['id' => (int)$iv['id']]);
ok('скасоване посилання — revoked', ($X->req('GET', '/api/share/join?t=' . tokOf((string)$iv['url']))->body['state'] ?? '') === 'revoked' && $D->req('GET', '/api/share')->body['shares'][0]['invites'] === []);

echo "\nИтог: $pass OK, $fail FAIL\n";
exit($fail ? 1 : 0);
