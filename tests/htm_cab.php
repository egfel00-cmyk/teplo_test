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
// постоянные плашки сайта (красный баннер, подсказка help-block у даты) и журнал, который обновляется не сразу:
// после отправки — «на перевірці» (unseen), а не form_error из-за баннера, что был на странице и до отправки
stand('act=reset'); stand('act=set&scenario=banners&today=2026-11-10&robot_delay=1200');
$h = new HtmCab(); $h->login('test@stand.local', 'stand-pass-123');
try { $r = $h->save('1000000061', 'Тестовий', $V, $C); ok('плашки сайта до отправки — не ошибка: pending, unseen, flash — «збережено»', $r['status'] === 'pending' && !empty($r['unseen']) && str_contains($r['flash'], 'збережено'), $r); }
catch (CabErr $e) { ok('плашки сайта до отправки — не ошибка: pending, unseen, flash — «збережено»', false, [$e->err, $e->site]); }
stand('act=reset'); stand('act=set&scenario=banners&today=2026-11-10&robot_delay=0');
$h = new HtmCab(); $h->login('test@stand.local', 'stand-pass-123');
try { $h->save('1000000061', 'Тестовий', $V, ['phone' => ''] + $C); ok('настоящая ошибка при плашках → form_error словами сайта, без баннера', false); }
catch (CabErr $e) { ok('настоящая ошибка при плашках → form_error словами сайта, без баннера', $e->err === 'form_error' && str_contains($e->site, 'телефон') && !str_contains($e->site, 'пароль'), [$e->err, $e->site]); }
stand('act=reset'); stand('act=set&scenario=ok');
// пароли
$e = CabVault::enc('секрет-пароль'); ok('пароль шифруется и расшифровывается', $e !== 'секрет-пароль' && CabVault::dec($e) === 'секрет-пароль' && is_file(CabVault::keyFile()));
ok('испорченный шифр → null', CabVault::dec('g1:' . base64_encode(random_bytes(40))) === null);
// телефон — по подсказке формы (живой кабинет: «(067) ***-**-45»), дата окна — в дд.мм.рррр
ok('телефон по подсказке «(0XX) ***-**-XX» → «(050) 111-22-33»', HtmCab::phoneFor('+380501112233', '(067) ***-**-45') === '(050) 111-22-33' && HtmCab::phoneFor('0501112233', '(___)___-__-__') === '(050)111-22-33');
ok('без подсказки и чужой номер — как есть', HtmCab::phoneFor('+380501112233', '') === '+380501112233' && HtmCab::phoneFor('+48123456789', '(067) ***-**-45') === '+48123456789');
ok('окно дат: «2026-11-05» и «5.11.2026» → 05.11.2026', HtmCab::dmy('2026-11-05') === '05.11.2026' && HtmCab::dmy('5.11.2026') === '05.11.2026');

// осмотр кабинета (как живой 07.11): главная → «Сформувати рахунок» — HTML-страница «Рахунок за вересень 2026 року», PDF нет; без рахунку, прізвища и цифр
stand('act=reset'); stand('act=set&scenario=ok&today=2026-11-10&robot_delay=0&bill_ym=&bill_pay=');
$h = new HtmCab(); $home = $h->login('test@stand.local', 'stand-pass-123'); $acc = $h->accounts($home); $p = $h->heat($acc[0]['acc'], $acc[0]['sur']);
$ex = $h->explore([$h->home['url'] => $h->home['body'], $p['url'] => $p['html']], $acc[0]['acc'], $acc[0]['sur']); unset($ex['billBody'], $ex['billRaw']);
$ej = json_encode($ex, JSON_UNESCAPED_UNICODE); $pp = array_column($ex['pages'], 'p'); $tr = array_column($ex['tried'] ?? [], 'p');
ok('осмотр: главная, тепло, карточка рахунку и «Архів платежів» (+ довідка); «Сформувати рахунок» — HTML, не PDF', in_array('/cabinet/{acc}/{sur}', $pp, true) && in_array('/cabinet/payments/{acc}/{sur}', $pp, true)
  && in_array('/cabinet/spravka/{acc}/{sur}', $pp, true) && in_array('/cabinet/bill/print/{acc}/{sur}', $tr, true) && $ex['bill'] === null, $ex);
$strs = []; array_walk_recursive($ex, function ($v) use (&$strs) { if (is_string($v)) $strs[] = $v; });
ok('…в осмотре нет рахунку, прізвища и цифр', !preg_match('/1000000061|ТЕСТОВИЙ|Тестовий|\d/u', str_replace('windows-1251', '', implode(' ', $strs))), $ej);
$bp = $h->billPage($acc[0]['acc'], $acc[0]['sur']);
ok('рахунок: по ссылке «Сформувати рахунок» (не ?hint=pdf) — месяц из заголовка 2026-09, до сплати 245.30', ($bp['ym'] ?? '') === '2026-09' && ($bp['pay'] ?? '') === '245.30' && str_contains((string)($bp['url'] ?? ''), '/cabinet/bill/print/') && !str_contains((string)$bp['url'], 'hint'), $bp ? array_diff_key($bp, ['html' => 1, 'text' => 1]) : null);
$bd = $h->billDoc($bp);
ok('…копия: стиль и картинка сайта внутри, без скриптов/кнопок/ссылок', $bd['css'] >= 1 && $bd['img'] === 1 && !preg_match('/<script|onclick|<button|href=|Друкувати/iu', $bd['html']) && str_contains($bd['html'], 'Рахунок за послуги за вересень 2026'), [$bd['css'], $bd['img']]);
ok('monthOf: «Рахунок за вересень 2026 року» → 2026-09, «грудень 2025» → 2025-12', HtmCab::monthOf('Рахунок за вересень 2026 року') === '2026-09' && HtmCab::monthOf('за грудень 2025') === '2025-12');
$bad = array_filter(array_column(array_slice($h->w->steps, 0), 1), fn($x) => preg_match('~logout|/add|remove|settings~', $x));
ok('…только GET и не трогает add/remove/settings', !array_filter($h->w->steps, fn($s) => $s[0] !== 'GET' && !str_contains($s[1], '/cabinet/login')) && !$bad, $h->w->steps);

// живой кабинет 06.11 22:14: новое соединение на /cabinet/list не установилось за 6 с → «сайт не відповідає», хотя вход прошёл
$n = 0; CabWeb::$http = function ($m, $u, $b, $c, $h) use (&$n) { $n++; return $n === 1 ? ['code' => 0, 'body' => '', 'err' => 'Connection timed out after 6001 milliseconds'] : ['code' => 200, 'body' => 'ok']; };
$w = new CabWeb('/^x\.test$/i'); $r = $w->req('GET', 'https://x.test/a');
ok('GET не соединился — ещё раз; в шагах видно ошибку сети', $r['code'] === 200 && count($w->steps) === 2 && str_contains((string)($w->steps[0][4] ?? ''), 'timed out'), $w->steps);
$n = 0; $w = new CabWeb('/^x\.test$/i'); $r = $w->req('POST', 'https://x.test/a', 'x=1');
ok('POST не соединился — не повторяем (мог сохраниться)', $r['code'] === 0 && count($w->steps) === 1, $w->steps);
CabWeb::$http = fn($m, $u, $b, $c, $h) => str_contains($u, '/cabinet/list') ? ['code' => 0, 'body' => '', 'err' => 'Connection timed out'] : ['code' => 200, 'body' => '<html></html>'];
$acc = (new HtmCab())->accounts(['body' => '<a href="/cabinet/heat/1000000061/%D0%A2%D0%95%D0%A1%D0%A2%D0%9E%D0%92%D0%98%D0%99">Тепло</a>']);
ok('/cabinet/list не ответил, рахунок есть на главной — берём его', ($acc[0]['acc'] ?? '') === '1000000061' && ($acc[0]['sur'] ?? '') === 'ТЕСТОВИЙ', $acc);
try { (new HtmCab())->accounts(['body' => '<html>без рахунків</html>']); ok('…на главной рахунків нет — честно «сайт не відповідає»', false); } catch (CabErr $e) { ok('…на главной рахунків нет — честно «сайт не відповідає»', $e->err === 'down', $e->err); }
CabWeb::$http = null;
echo "\nИтог: $pass OK, $fail FAIL\n"; exit($fail ? 1 : 0);
