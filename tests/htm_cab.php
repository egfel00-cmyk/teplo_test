<?php
// Робот кабинета ХТМ против стенда tests/htm-mock. Запуск: стенд на 127.0.0.1:8099 (tests/htm-mock/start.sh), затем php tests/htm_cab.php
declare(strict_types=1);
define('TEPLO', 1);
require __DIR__ . '/../app/core.php';
require __DIR__ . '/../app/cabs.php';
$TMP = sys_get_temp_dir() . '/teplo_htm_' . getmypid(); putenv('SITE_DATA=' . $TMP);
$BASE = getenv('HTM_BASE') ?: 'http://127.0.0.1:8099';
Cfg::set(['app_url' => 'https://teplo.example/', 'htm_cab_base' => $BASE]);
$pass = 0; $fail = 0;
function ok(string $n, bool $c, $info = null): void { global $pass, $fail; echo ($c ? '  OK  ' : ' FAIL ') . $n . (!$c && $info !== null ? '  → ' . json_encode($info, JSON_UNESCAPED_UNICODE) : '') . "\n"; $c ? $pass++ : $fail++; }
function stand(string $body): void { global $BASE; $ch = curl_init($BASE . '/stand/admin'); curl_setopt_array($ch, [CURLOPT_POST => 1, CURLOPT_POSTFIELDS => $body, CURLOPT_RETURNTRANSFER => 1]); curl_exec($ch); curl_close($ch); }
stand('act=reset'); stand('act=set&scenario=ok&today=2026-11-10&robot_delay=0');

$V = ['date' => '10.11.2026', 'energy' => '14.445', 'volume' => '2332,676', 'flow' => '0.063', 'power' => '1.5', 'tSupply' => '50.12', 'tReturn' => '30.4', 'hours' => '35078', 'errHours' => '153', 'errCode' => 'E---'];
$C = ['phone' => '+380501112233', 'email' => 'test@stand.local', 'note' => ''];

$h = new HtmCab();
try { $h->login('test@stand.local', 'wrong-pass'); ok('неверный пароль → bad_login', false); } catch (CabErr $e) { ok('неверный пароль → bad_login', $e->err === 'bad_login', $e->site); }
$h = new HtmCab(); $home = $h->login('test@stand.local', 'stand-pass-123'); ok('вход по email и паролю', str_contains($home['body'], '/cabinet/logout'));
$acc = $h->accounts($home); ok('особовий рахунок найден', ($acc[0]['acc'] ?? '') === '1000000061' && mb_strtoupper($acc[0]['sur'] ?? '') === 'ТЕСТОВИЙ', $acc);
$p = $h->heat($acc[0]['acc'], $acc[0]['sur']);
ok('прибор и номер из заголовка', ($p['meter']['model'] ?? '') === 'Sharky 774' && ($p['meter']['serial'] ?? '') === '70000061', $p['meter']);
ok('последние принятые (head_*)', ($p['base']['energy'] ?? '') === '13.245' && ($p['base']['hours'] ?? '') === '34598', $p['base']);
ok('форма открыта 10-го, есть min/max', $p['open'] && $p['min'] && $p['max'], [$p['open'], $p['min'], $p['max']]);
$r = $h->save($acc[0]['acc'], $acc[0]['sur'], $V, $C);
ok('сохранено, в журнале строка нашей даты', in_array($r['status'], ['pending', 'ok'], true), $r);
$h2 = new HtmCab(); $h2->login('test@stand.local', 'stand-pass-123'); stand('act=robot');
$row = HtmCab::find($h2->heat($acc[0]['acc'], $acc[0]['sur'])['journal'], '10.11.2026', '14.445');
ok('робот ХТМ принял → ok', ($row['status'] ?? '') === 'ok', $row);
// робот отклонил: энергия меньше прошлой
stand('act=reset'); stand('act=set&scenario=ok&today=2026-11-10&robot_delay=0');
$h = new HtmCab(); $h->login('test@stand.local', 'stand-pass-123');
$bad = ['energy' => '13.100'] + $V; $r = $h->save('1000000061', 'Тестовий', $bad, $C); stand('act=robot');
$h2 = new HtmCab(); $h2->login('test@stand.local', 'stand-pass-123'); $row = HtmCab::find($h2->heat('1000000061', 'Тестовий')['journal'], '10.11.2026', '13.100');
ok('робот ХТМ отклонил → rejected с причиной', ($row['status'] ?? '') === 'rejected' && ($row['reason'] ?? '') !== '', $row);
// окно закрыто
stand('act=reset'); stand('act=set&scenario=ok&today=2026-11-27&robot_delay=0');
$h = new HtmCab(); $h->login('test@stand.local', 'stand-pass-123');
try { $h->save('1000000061', 'Тестовий', ['date' => '27.11.2026'] + $V, $C); ok('27-го форма закрыта → closed', false); } catch (CabErr $e) { ok('27-го форма закрыта → closed', $e->err === 'closed' && str_contains($e->site, 'тимчасово'), [$e->err, $e->site]); }
// разметка изменилась — ничего не шлём
stand('act=reset'); stand('act=set&scenario=markup_changed&today=2026-11-10&robot_delay=0');
$h = new HtmCab(); $h->login('test@stand.local', 'stand-pass-123');
try { $h->save('1000000061', 'Тестовий', $V, $C); ok('другие имена полей → form_changed, без отправки', false); } catch (CabErr $e) { ok('другие имена полей → form_changed, без отправки', $e->err === 'form_changed', $e->site); }
// капча
stand('act=reset'); stand('act=set&scenario=captcha&today=2026-11-10&robot_delay=0');
try { (new HtmCab())->login('test@stand.local', 'stand-pass-123'); ok('капча → captcha (не обходим)', false); } catch (CabErr $e) { ok('капча → captcha (не обходим)', $e->err === 'captcha', $e->err); }
// сайт лёг
stand('act=reset'); stand('act=set&scenario=server_500&today=2026-11-10&robot_delay=0');
try { (new HtmCab())->login('test@stand.local', 'stand-pass-123'); ok('500 → down', false); } catch (CabErr $e) { ok('500 → down', $e->err === 'down', $e->err); }
stand('act=reset'); stand('act=set&scenario=ok');
// пароли
$e = CabVault::enc('секрет-пароль'); ok('пароль шифруется и расшифровывается', $e !== 'секрет-пароль' && CabVault::dec($e) === 'секрет-пароль' && is_file(CabVault::keyFile()));
ok('испорченный шифр → null', CabVault::dec('g1:' . base64_encode(random_bytes(40))) === null);
// телефон — по подсказке формы (живой кабинет: «(067) ***-**-45»), дата окна — в дд.мм.рррр
ok('телефон по подсказке «(0XX) ***-**-XX» → «(050) 111-22-33»', HtmCab::phoneFor('+380501112233', '(067) ***-**-45') === '(050) 111-22-33' && HtmCab::phoneFor('0501112233', '(___)___-__-__') === '(050)111-22-33');
ok('без подсказки и чужой номер — как есть', HtmCab::phoneFor('+380501112233', '') === '+380501112233' && HtmCab::phoneFor('+48123456789', '(067) ***-**-45') === '+48123456789');
ok('окно дат: «2026-11-05» и «5.11.2026» → 05.11.2026', HtmCab::dmy('2026-11-05') === '05.11.2026' && HtmCab::dmy('5.11.2026') === '05.11.2026');
echo "\nИтог: $pass OK, $fail FAIL\n"; exit($fail ? 1 : 0);
